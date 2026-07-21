// Obol demo seller — deployed as a Firebase HTTPS function (v2, runs on Cloud Run).
// Wraps real third-party APIs and charges per call in USDC on Arc testnet via
// Circle's official @circle-fin/x402-batching middleware. Earnings settle to
// SELLER_ADDRESS. Mirrors packages/obol-demo-seller/server.mjs but as a function.
import { onRequest, onCall, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineString, defineSecret } from "firebase-functions/params";
import { GatewayClient } from "@circle-fin/x402-batching/client";
import express from "express";
import { createGatewayMiddleware } from "@circle-fin/x402-batching/server";
import admin from "firebase-admin";
import { createHash } from "node:crypto";
import { issueSellerCredential, obolIssuerDid } from "./ack.mjs";
import { validateServiceUrl, scanServiceSafety } from "./safety.mjs";
import { geminiJudge, learnPatterns, loadLearnedPhrases, geminiEnabled } from "./gemini.mjs";
import { payFromUserWallet, getUserGatewayAvailable, isDcwConfigured, getCircleClient } from "./dcwPay.mjs";
import { payViaFacilitator } from "./facilitatorPay.mjs";
import { mountBaseFacilitatorRoute } from "./ownServiceBase.mjs";
import { NET } from "./network.mjs";

if (!admin.apps.length) admin.initializeApp();
const db = () => admin.firestore();

// The Arc wallet that receives earnings. Override at deploy via the
// SELLER_ADDRESS env/param without touching code.
const SELLER_ADDRESS = defineString("SELLER_ADDRESS", {
  default: "0x8E7590dD632977DC988a7703680450EDE5d991B9",
});
const OBOL_RELAYER_KEY = defineSecret("OBOL_RELAYER_KEY");
// Circle dev-controlled wallets — used by the "user pays from their own wallet"
// path (OBOL_USER_PAYS=1). Signing happens in Circle's custody; no raw key here.
// Secret is named CIRCLE_TESTNET_API_KEY (same as the functions codebase binds).
const CIRCLE_API_KEY = defineSecret(NET.circleKeySecret); // testnet vs mainnet key, per OBOL_NETWORK
const CIRCLE_ENTITY_SECRET = defineSecret("CIRCLE_ENTITY_SECRET");
// Base URL for internal API calls (spend-limit enforcement). Override via env.
const OBOL_BASE = process.env.OBOL_BASE || "https://obol-arc.web.app";

// Per-user-wallet payments are the DEFAULT architecture (durable in code, so it
// survives redeploys and applies to all new signups). Emergency rollback: set
// OBOL_USER_PAYS=0 to fall back to the legacy relayer+ledger path. An optional
// OBOL_USER_PAYS_UIDS allowlist narrows it to specific uids if ever needed.
function userPaysEnabled(uid) {
  if (process.env.OBOL_USER_PAYS === "0") return false;
  const allow = (process.env.OBOL_USER_PAYS_UIDS || "").split(",").map((s) => s.trim()).filter(Boolean);
  return allow.length ? allow.includes(uid) : true;
}

// Windowed spend-limit enforcement — reuse the SAME /api/spend-limit endpoint the
// MCP self-custody path uses, so the user-pays path shares one limit ledger.
async function checkSpendLimit(apiKey, amountUsdc) {
  try {
    const r = await fetch(`${OBOL_BASE}/api/spend-limit`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ apiKey, amountUsdc, mode: "check" }),
    });
    return await r.json();
  } catch { return { ok: true }; } // fail-open on transient net error (balance gate still bounds spend)
}
async function recordSpend(apiKey, amountUsdc, idempotencyKey) {
  try {
    await fetch(`${OBOL_BASE}/api/spend-limit`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ apiKey, amountUsdc, mode: "record", idempotencyKey }),
    });
  } catch { /* best-effort; recorded post-settlement */ }
}
// Optional — the Gemini Flash security judge. If unset, the scanner runs on the
// free regex + learned-pattern layers only (no Gemini cost, graceful degrade).
const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");

// Escalate a flagged/reported sample to Gemini ONLY (cost-gated) — confirm the
// threat and LEARN any novel attack phrase so the free layer blocks it next time.
async function geminiEscalate(sample, source) {
  const key = GEMINI_API_KEY.value();
  if (!geminiEnabled(key) || !sample) return null;
  const judge = await geminiJudge(key, sample);
  if (judge?.malicious && judge.patterns?.length) {
    await learnPatterns(judge.patterns, { source: source || "gemini", category: judge.category }).catch(() => {});
  }
  return judge;
}

const COIN_RE = /^[a-z0-9-]{1,40}$/;

function buildApp(seller) {
  const app = express();

  // Multi-chain: accept on Arc testnet + Base Sepolia (+ any other Gateway-supported
  // testnet). One listing is automatically payable on all of these, funded from the
  // buyer's UNIFIED Circle Gateway balance (deposit on any chain, spend on any chain).
  // Omitting `networks` would accept ALL Gateway-supported networks; we list explicitly
  // for a controlled rollout.
  const gateway = createGatewayMiddleware({
    sellerAddress: seller,
    networks: ["eip155:5042002", "eip155:84532"], // Arc Testnet + Base Sepolia
    facilitatorUrl: "https://gateway-api-testnet.circle.com",
  });

  // ── Shared API fetchers — reused by BOTH the Arc/Gateway rail and the Base
  // facilitator rail, so /weather and /weather-base serve identical data. ──────
  async function fetchWeatherData(req) {
    const lat = req.query.lat ?? "40.71";
    const lon = req.query.lon ?? "-74.01";
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&temperature_unit=celsius`);
    if (!r.ok) return { status: 502, body: { error: "Upstream weather error" } };
    const data = await r.json();
    return { body: { lat, lon, temperature_c: data.current_weather?.temperature, windspeed_kmh: data.current_weather?.windspeed, weathercode: data.current_weather?.weathercode, time: data.current_weather?.time } };
  }
  async function fetchPriceData(req) {
    const coin = String(req.query.coin || "bitcoin").toLowerCase();
    if (!COIN_RE.test(coin)) return { status: 400, body: { error: "Invalid coin id. Use a CoinGecko id like 'bitcoin', 'ethereum', 'solana'." } };
    const r = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${coin}&vs_currencies=usd&include_24hr_change=true`, { headers: { accept: "application/json" } });
    if (!r.ok) return { status: 502, body: { error: `Upstream CoinGecko error (${r.status})` } };
    const data = await r.json();
    const row = data[coin];
    if (!row || typeof row.usd !== "number") return { status: 404, body: { error: `Unknown coin id '${coin}'. Check the id at coingecko.com.` } };
    return { body: { coin, usd: row.usd, change_24h_pct: row.usd_24h_change != null ? Number(row.usd_24h_change.toFixed(2)) : null, ts: new Date().toISOString() } };
  }

  // ── BASE FACILITATOR RAIL — Obol's OWN services payable with RAW Base USDC ───
  // The SAME rail the Bazaar uses. Lets a Base-default user (raw USDC, no Arc
  // Gateway balance) buy Obol's services exactly like any Bazaar service. Keyless
  // + gasless (facilitator settles + pays gas); earnings land straight in `seller`.
  // At $0.001 (1000 atomic). Standard x402 v2 — the shape Coinbase's Bazaar indexes.
  mountBaseFacilitatorRoute(app, { path: "/weather-base", priceAtomic: 1000, payTo: seller, serve: fetchWeatherData });
  mountBaseFacilitatorRoute(app, { path: "/price-base",   priceAtomic: 1000, payTo: seller, serve: fetchPriceData });

  // ── /price — live crypto price via CoinGecko (free, no API key) ──────────
  // $0.001 USDC per call. ?coin=bitcoin (CoinGecko id), defaults to bitcoin.
  app.get("/price", gateway.require("$0.001"), async (req, res) => {
    const coin = String(req.query.coin || "bitcoin").toLowerCase();
    if (!COIN_RE.test(coin)) {
      res.status(400).json({ error: "Invalid coin id. Use a CoinGecko id like 'bitcoin', 'ethereum', 'solana'." });
      return;
    }
    try {
      const r = await fetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=${coin}&vs_currencies=usd&include_24hr_change=true`,
        { headers: { accept: "application/json" } }
      );
      if (!r.ok) { res.status(502).json({ error: `Upstream CoinGecko error (${r.status})` }); return; }
      const data = await r.json();
      const row = data[coin];
      if (!row || typeof row.usd !== "number") {
        res.status(404).json({ error: `Unknown coin id '${coin}'. Check the id at coingecko.com.` });
        return;
      }
      res.json({
        coin,
        usd:            row.usd,
        change_24h_pct: row.usd_24h_change != null ? Number(row.usd_24h_change.toFixed(2)) : null,
        ts:             new Date().toISOString(),
        paidBy:         req.payment?.payer,
        settlementTx:   req.payment?.transaction,
      });
    } catch (e) {
      res.status(500).json({ error: String(e.message) });
    }
  });

  // ── /weather — live Open-Meteo data, no API key needed ───────────────────
  app.get("/weather", gateway.require("$0.001"), async (req, res) => {
    const lat = req.query.lat ?? "40.71";
    const lon = req.query.lon ?? "-74.01";
    try {
      const r = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&temperature_unit=celsius`
      );
      if (!r.ok) { res.status(502).json({ error: "Upstream weather error" }); return; }
      const data = await r.json();
      res.json({
        lat, lon,
        temperature_c: data.current_weather?.temperature,
        windspeed_kmh: data.current_weather?.windspeed,
        weathercode:   data.current_weather?.weathercode,
        time:          data.current_weather?.time,
        paidBy:        req.payment?.payer,
        settlementTx:  req.payment?.transaction,
      });
    } catch (e) {
      res.status(500).json({ error: String(e.message) });
    }
  });

  // ── /nano — proves Circle's $0.000001 nanopayment floor empirically ──────
  // Priced at the documented Gateway minimum ($0.000001 USDC = 1 micro-USDC).
  app.get("/nano", gateway.require("$0.000001"), async (req, res) => {
    res.json({
      ok: true,
      note: "Paid at Circle Gateway's documented $0.000001 minimum — gasless.",
      paidBy:       req.payment?.payer,
      settlementTx: req.payment?.transaction,
      ts: new Date().toISOString(),
    });
  });

  // ── index — free, advertises endpoints ───────────────────────────────────
  app.get("/", (_req, res) =>
    res.json({
      service: "Obol Crypto Price API",
      endpoints: {
        // Arc / Gateway rail — sub-cent nanopayments (buyer needs an Arc Gateway balance).
        price:        { url: "/price?coin=bitcoin",           price: "$0.001/call",     rail: "arc-gateway" },
        weather:      { url: "/weather?lat=40.71&lon=-74.01", price: "$0.001/call",     rail: "arc-gateway" },
        nano:         { url: "/nano",                          price: "$0.000001/call", rail: "arc-gateway" },
        // Base facilitator rail — raw USDC, gasless (buyer pays from a plain Base balance).
        "price-base":   { url: "/price-base?coin=bitcoin",           price: "$0.001/call", rail: "base-facilitator" },
        "weather-base": { url: "/weather-base?lat=40.71&lon=-74.01", price: "$0.001/call", rail: "base-facilitator" },
      },
      seller,
      network: `Arc testnet (eip155:5042002) + Base facilitator (${NET.baseFacilitator.network})`,
    })
  );

  return app;
}

let app;
export const seller = onRequest(
  { region: "us-central1", cors: true, memory: "256MiB" },
  (req, res) => {
    if (!app) app = buildApp(SELLER_ADDRESS.value());
    return app(req, res);
  }
);

// ============================================================
// registerService — list a service from an Obol API key (MCP / curl).
// Auth: Obol API key (obl_sk_live_…). The seller's LLM calls this via the
// Obol MCP "list_service" tool. Issues a real ACK-ID Verifiable Credential
// for the seller and writes the service to the marketplace.
// ============================================================
const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

function autoSkillMarkdown({ name, description, priceUsdc, hostedUrl, inputSchema }) {
  return [
    `# ${name}`,
    ``,
    description || "",
    ``,
    `**Price:** $${priceUsdc} USDC per call · paid automatically via Obol (x402 on Arc).`,
    `**Endpoint:** \`${hostedUrl}\``,
    inputSchema ? `**Input:** ${inputSchema}` : ``,
    ``,
    `## How an agent calls it`,
    `Use the Obol MCP \`pay_and_call\` tool with this service's URL. Payment in USDC is`,
    `signed off-chain and settled on Arc — no API key or account needed by the caller.`,
  ].filter(Boolean).join("\n");
}

async function verifyApiKey(rawKey) {
  if (!rawKey || !rawKey.startsWith("obl_sk_live_")) return null;
  const keyHash = createHash("sha256").update(rawKey).digest("hex");
  const doc = await db().collection("apiKeys").doc(keyHash).get();
  if (!doc.exists || doc.data()?.revoked) return null;
  return { uid: doc.data().uid, agentAddress: doc.data().agentAddress };
}

export const registerService = onRequest(
  { region: "us-central1", cors: true, memory: "256MiB", secrets: [GEMINI_API_KEY], maxInstances: 20 },
  async (req, res) => {
    try {
      if (req.method !== "POST") { res.status(405).json({ error: "POST only." }); return; }
      const body = req.body || {};
      const rawKey = body.apiKey || (req.get("authorization") || "").replace(/^Bearer\s+/i, "");
      const auth = await verifyApiKey(rawKey);
      if (!auth) { res.status(401).json({ error: "Invalid or missing Obol API key." }); return; }

      const name = String(body.name || "").trim();
      const hostedUrl = String(body.hostedUrl || "").trim();
      const priceUsdc = String(body.priceUsdc ?? "0.001").trim();
      if (!name || !hostedUrl) { res.status(400).json({ error: "name and hostedUrl are required." }); return; }
      if (!/^https:\/\//.test(hostedUrl)) { res.status(400).json({ error: "hostedUrl must be https://" }); return; }

      // SSRF guard — reject internal/private/metadata hosts before we ever touch the URL.
      const urlCheck = await validateServiceUrl(hostedUrl);
      if (!urlCheck.ok) { res.status(400).json({ error: `Rejected: ${urlCheck.reason}` }); return; }

      // Safety scan — free regex + learned-pattern layer first (sandboxed test call).
      // If it comes back ambiguous/suspicious, escalate ONLY that case to Gemini
      // (cost-gated) to confirm and to learn any new attack phrase.
      let safety;
      try {
        const learned = await loadLearnedPhrases();
        safety = await scanServiceSafety(hostedUrl, learned);
        if ((safety.verdict === "suspicious" || safety.verdict === "dangerous") && safety.sample) {
          const judge = await geminiEscalate(safety.sample, "listing");
          if (judge) {
            safety.gemini = { malicious: judge.malicious, confidence: judge.confidence, category: judge.category };
            if (judge.malicious && judge.confidence >= 0.6) safety.verdict = "dangerous";
            else if (!judge.malicious && safety.verdict === "suspicious") safety.verdict = "clean"; // Gemini cleared a false positive
          }
        }
      } catch (e) {
        safety = { scannedAt: Date.now(), verdict: "unknown", score: 0, flags: ["scan-error"], reason: String(e.message || e), sample: null };
      }
      const quarantined = safety.verdict === "dangerous";

      // Resolve the seller's payout wallet + display name from their profile.
      const prof = (await db().collection("profiles").doc(auth.uid).get()).data() || {};
      const payoutAddress = (prof.obolWalletAddress || prof.address || auth.agentAddress || "").trim();
      const displayName = prof.companyName || prof.displayName || prof.username || null;

      // Issue a real ACK-ID Verifiable Credential for this seller (best-effort —
      // a listing must not fail if issuance hiccups).
      let ack = null;
      try {
        if (payoutAddress) {
          const memberSince = prof.createdAt ? new Date(prof.createdAt).toISOString().slice(0, 10) : null;
          const c = await issueSellerCredential({ payoutAddress, displayName, serviceName: name, category: String(body.category || "").trim() || null, memberSince });
          ack = { did: c.sellerDid, credentialJwt: c.credentialJwt, issuer: c.issuerDid, verifiedAt: Date.now() };
        }
      } catch (e) {
        console.error("ACK issuance failed:", e.message);
      }

      const description = String(body.description || "").trim();
      const inputSchema = String(body.inputSchema || "").trim();
      const skillMarkdown = String(body.skillMarkdown || "").trim()
        || autoSkillMarkdown({ name, description, priceUsdc, hostedUrl, inputSchema });

      let hostname = "";
      try { hostname = new URL(hostedUrl).hostname; } catch { /* validated above */ }

      const doc = {
        ownerUid: auth.uid,
        name,
        slug: slugify(name),
        category: String(body.category || "Data").trim(),
        description,
        priceUsdc,
        payoutAddress,
        hostedUrl,
        hostname,                 // indexed for O(1) lookup in payAndCall (no full scan)
        inputSchema,
        docsUrl: String(body.docsUrl || "").trim(),
        endpoints: Array.isArray(body.endpoints) ? body.endpoints : [],
        skillMarkdown,
        openapiUrl: String(body.openapiUrl || "").trim(),
        // Quarantined listings are inactive until reviewed → never served to buyers.
        active: !quarantined,
        quarantined,
        safety,                   // { verdict, score, flags, sample, scannedAt } — shown on the listing
        createdAt: Date.now(),
        ...(ack ? { ackDid: ack.did, ackCredential: ack.credentialJwt, ackIssuer: ack.issuer, ackVerified: true, ackVerifiedAt: ack.verifiedAt } : {}),
      };

      const ref = await db().collection("services").add(doc);

      // Mirror ACK identity onto the seller's profile (so the badge shows site-wide).
      if (ack) {
        await db().collection("profiles").doc(auth.uid).set({
          verification: { ackDid: ack.did, ackCredential: ack.credentialJwt, ackIssuer: ack.issuer, ackVerified: true, verifiedAt: ack.verifiedAt },
          updatedAt: Date.now(),
        }, { merge: true });
      }

      res.json({
        ok: true,
        id: ref.id,
        marketplaceUrl: `https://obol-arc.web.app/service/${ref.id}`,
        ackDid: ack?.did || null,
        ackIssuer: obolIssuerDid(),
        ackVerified: !!ack,
        safety: { verdict: safety.verdict, score: safety.score, flags: safety.flags },
        quarantined,
        message: quarantined
          ? `"${name}" was QUARANTINED — its test response tripped the safety scanner (${safety.flags.join(", ")}). Fix the endpoint and re-list. It is NOT visible to buyers.`
          : `Listed "${name}" at $${priceUsdc}/call${ack ? " · ACK-ID verified ✓" : ""}${safety.verdict === "suspicious" ? " · ⚠ flagged suspicious (buyers will see a warning)" : " · safety: clean ✓"}.`,
      });
    } catch (e) {
      console.error("registerService error:", e);
      res.status(500).json({ error: String(e.message) });
    }
  }
);

// ── reissueAck — re-link a seller's ACK-ID to their CURRENT account wallet ─────
// The ACK-ID is issued for the account wallet at listing time. If the wallet
// later changes (re-provision), the credential goes stale. This re-issues the
// "ObolVerifiedSeller" credential for every one of the user's services against
// their current obolWalletAddress, so the verified badge always proves control
// of the wallet money actually goes to.
// ── ensureAck — the ACK-ID is account-level: it exists as soon as you have a
// wallet, stored on your PROFILE (independent of any service). This issues the
// credential for your CURRENT wallet, stores it on the profile, and re-links any
// listings whose wallet is stale. Safe to call anytime — it's idempotent (skips
// work if the profile credential is already on the current wallet). The frontend
// calls it on wallet creation / profile load so the badge is "always just there".
export const reissueAck = onCall(
  { region: "us-central1" },
  async (req) => {
    const uid = req.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Sign in required.");
    const profRef = db().collection("profiles").doc(uid);
    const prof = (await profRef.get()).data() || {};
    const currentWallet = String(prof.obolWalletAddress || prof.address || "").trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(currentWallet)) {
      throw new HttpsError("failed-precondition", "No account wallet found. Set up your wallet first.");
    }
    const memberSince = prof.createdAt ? new Date(prof.createdAt).toISOString().slice(0, 10) : null;
    const displayName = prof.companyName || prof.displayName || null;

    // 1. Ensure the ACCOUNT credential (on the profile) is on the current wallet.
    let profileIssued = false;
    if (String(prof.ackPayoutAddress || "").toLowerCase() !== currentWallet.toLowerCase() || !prof.ackDid) {
      const c = await issueSellerCredential({ payoutAddress: currentWallet, displayName, serviceName: null, category: null, memberSince });
      await profRef.set({
        ackDid: c.sellerDid, ackCredential: c.credentialJwt, ackIssuer: c.issuerDid,
        ackVerified: true, ackPayoutAddress: currentWallet, ackUpdatedAt: Date.now(),
      }, { merge: true });
      profileIssued = true;
    }

    // 2. Re-link any listings whose payout wallet is stale.
    const svcs = await db().collection("services").where("ownerUid", "==", uid).get();
    let updated = 0, alreadyCurrent = 0;
    for (const doc of svcs.docs) {
      const data = doc.data();
      if (String(data.payoutAddress || "").toLowerCase() === currentWallet.toLowerCase()) { alreadyCurrent++; continue; }
      const c = await issueSellerCredential({
        payoutAddress: currentWallet, displayName, serviceName: data.name,
        category: data.category || null, memberSince,
      });
      await doc.ref.update({
        payoutAddress: currentWallet, ackDid: c.sellerDid, ackCredential: c.credentialJwt,
        ackIssuer: c.issuerDid, ackVerified: true, ackReissuedAt: Date.now(),
        "verification.ackDid": c.sellerDid, "verification.ackCredential": c.credentialJwt,
        "verification.ackIssuer": c.issuerDid, "verification.ackVerified": true,
      });
      updated++;
    }
    return { ok: true, currentWallet, ackDid: `did:pkh:eip155:5042002:${currentWallet}`, profileIssued, updated, alreadyCurrent };
  }
);

// Read the ACTUAL x402 price the endpoint demands, by sending an unpaid GET and
// decoding the `payment-required` header (x402 v2). `accepts[0].amount` is atomic
// USDC (6dp), so amount "1" = $0.000001, "1000" = $0.001. Returns the USDC number,
// or null if the endpoint isn't x402 / the header is missing. This is what makes
// per-endpoint pricing work (one service can have many endpoints at different
// prices) — instead of charging a single flat per-service price.
async function readX402Price(url) {
  try {
    const r = await fetch(url, { method: "GET" });
    if (r.status !== 402) return null;
    const hdr = r.headers.get("payment-required");
    if (!hdr) return null;
    const challenge = JSON.parse(Buffer.from(hdr, "base64").toString("utf8"));
    const atomic = challenge?.accepts?.[0]?.amount;
    if (atomic == null) return null;
    return Number(atomic) / 1e6; // atomic (6dp) → USDC
  } catch {
    return null;
  }
}

// ============================================================
// payAndCall — hosted buyer payments via Obol API key.
// Verifies the caller's API key, checks their spendingBalance,
// has the relayer pay the x402 seller endpoint, then deducts.
// POST /api/pay-and-call  { apiKey, callUrl, params?, method?, maxPrice? }
// ============================================================
// Persist every settled paid call so the dashboard can show buyer spend + seller
// earnings + calls. The Gateway API has NO transfer-history endpoint, so this is the
// ONLY durable record of who paid whom. Read back by apiWallet (obol codebase) keyed
// by address (buyerAddress / sellerAddress, lowercased). Fire-and-forget-safe: a
// logging failure must never fail the actual paid call.
async function recordPayment({ buyerUid, buyerAddress, service, amountCharged, amountToSeller, tx }) {
  try {
    const sd = service.data();
    await db().collection("payments").add({
      buyerUid: buyerUid ?? null,
      buyerAddress: String(buyerAddress || "").toLowerCase(),
      sellerUid: sd.ownerUid ?? sd.uid ?? null,
      sellerAddress: String(sd.payoutAddress || "").toLowerCase(),
      serviceId: service.id,
      serviceName: sd.name || sd.displayName || sd.title || sd.hostname || "",
      amountCharged: Number(amountCharged) || 0, // what the buyer paid (incl. any platform fee)
      amountToSeller: Number(amountToSeller) || 0, // what the seller earned
      tx: tx || null,
      ts: Date.now(),
    });
  } catch (e) { console.error("recordPayment failed:", e.message); }
}

export const payAndCall = onRequest(
  // Runs as a dedicated minimal SA (secretAccessor on only its own secrets + Firestore/logging),
  // not the broad default compute SA — shrinks the entity-secret blast radius.
  { region: "us-central1", cors: true, memory: "512MiB", serviceAccount: "obol-signer@obol-arc.iam.gserviceaccount.com", secrets: [OBOL_RELAYER_KEY, CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET] },
  async (req, res) => {
    if (req.method !== "POST") { res.status(405).json({ error: "POST only." }); return; }
    try {
      const { apiKey, callUrl, params, method = "GET", maxPrice = 1.0 } = req.body || {};

      // 1. Verify API key
      const auth = await verifyApiKey(apiKey);
      if (!auth) { res.status(401).json({ error: "Invalid or missing Obol API key." }); return; }

      // 2. Validate callUrl — must be a registered active service (allowlist)
      let parsedUrl;
      try { parsedUrl = new URL(callUrl); } catch { res.status(400).json({ error: "Invalid callUrl." }); return; }

      // Find candidate listings on this hostname (indexed), else back-compat scan.
      let candidates = (await db().collection("services")
        .where("hostname", "==", parsedUrl.hostname)
        .where("active", "==", true)
        .limit(25).get()).docs;
      if (!candidates.length) {
        const legacy = await db().collection("services").where("active", "==", true).limit(500).get();
        candidates = legacy.docs.filter((d) => { try { return new URL(d.data().hostedUrl).hostname === parsedUrl.hostname; } catch { return false; } });
      }
      // Disambiguate when several services share a host: prefer the one whose hostedUrl
      // PATH matches the call (so /price → "Crypto Price API", /weather → "Weather API"),
      // then a bundled endpoint whose path matches, then fall back to the first listing.
      const callPath = parsedUrl.pathname;
      const pathOf = (u) => { try { return new URL(u).pathname; } catch { return null; } };
      const service =
        candidates.find((d) => pathOf(d.data().hostedUrl) === callPath) ||
        candidates.find((d) => Array.isArray(d.data().endpoints) && d.data().endpoints.some((e) => pathOf(e.url ?? e.path ?? e.callUrl) === callPath)) ||
        candidates[0];
      // Not a registered Obol (Gateway) service → treat as an EXTERNAL x402 service
      // (e.g. Coinbase Bazaar). Pay via the facilitator rail: the user's EOA signs an
      // EIP-3009 authorization (keyless via Circle), the seller's facilitator settles +
      // pays gas. Bounded by the caller's maxPrice + the same windowed spend limits.
      if (!service) {
        const prof = (await db().collection("profiles").doc(auth.uid).get()).data() || {};
        if (!prof.obolWalletId || !prof.obolWalletAddress) {
          res.status(402).json({ error: "No provisioned wallet to pay from. Fund your Obol account first." }); return;
        }
        try {
          const client = await getCircleClient();
          const result = await payViaFacilitator({
            circleClient: client, walletId: prof.obolWalletId, fromAddress: prof.obolWalletAddress,
            callUrl, method, maxPriceUsdc: Number(maxPrice),
          });
          const limit = await checkSpendLimit(apiKey, result.charged);
          if (!limit.ok) { res.status(402).json({ error: limit.reason || "Spending limit exceeded." }); return; }
          await recordSpend(apiKey, result.charged, `${auth.uid}:${Date.now()}`);
          res.json({
            data: result.data, charged: result.charged, gas: 0, rail: "facilitator",
            payer: result.payer, network: result.network, source: "bazaar", settlement: result.settlement ?? null,
          });
        } catch (e) {
          res.status(502).json({ error: `Facilitator payment failed: ${e.message}` });
        }
        return;
      }
      if (service.data().quarantined) { res.status(403).json({ error: "This service is quarantined by the Obol safety scanner and cannot be called." }); return; }

      // Obol takes 0% commission per call — the buyer pays EXACTLY the seller's
      // price, seller keeps 100%. Obol monetizes via subscriptions (Featured/Scale),
      // not a per-call take rate. (Env override OBOL_FEE_BPS can re-enable a take
      // rate later without a code change, e.g. once buyer demand is proven.)
      const PLATFORM_FEE_BPS = Number(process.env.OBOL_FEE_BPS || 0);

      // Price the agent is charged = the ACTUAL amount the called endpoint demands
      // (read live from its x402 402 challenge), so per-endpoint pricing works.
      // Fall back to the service's registered flat price only if the live read fails.
      const fullUrl = new URL(callUrl);
      for (const [k, v] of Object.entries(params || {})) fullUrl.searchParams.set(k, String(v));
      const livePrice = await readX402Price(fullUrl.toString());
      const registeredPrice = parseFloat(service.data().priceUsdc ?? "0.001");
      const priceUsdc = livePrice != null ? livePrice : registeredPrice;
      const priceSource = livePrice != null ? "x402-endpoint" : "registered-fallback";

      // Fee = price × bps/10000, rounded to 6dp (USDC precision). 0 bps → $0.
      const platformFee = Math.round((priceUsdc * PLATFORM_FEE_BPS / 10000) * 1e6) / 1e6;
      const totalCharge = parseFloat((priceUsdc + platformFee).toFixed(6));

      if (priceUsdc > maxPrice) { res.status(402).json({ error: `Service costs $${priceUsdc} which exceeds maxPrice $${maxPrice}.` }); return; }

      const profRef = db().collection("profiles").doc(auth.uid);

      // ── Option 3: pay from the user's OWN Circle wallet + Gateway balance ──
      // Flag-gated (OBOL_USER_PAYS=1). No pooled relayer, no off-chain ledger:
      // the user's dev-controlled EOA signs (via Circle) and settles from its own
      // unified Gateway balance. Falls back to the legacy path when off / no wallet.
      if (userPaysEnabled(auth.uid) && isDcwConfigured()) {
        const prof = (await profRef.get()).data() || {};
        if (prof.obolWalletId && prof.obolWalletAddress) {
          // Gate 1 — real Gateway balance must cover the charge (replaces the ledger gate).
          let available;
          try { available = await getUserGatewayAvailable(prof.obolWalletAddress); }
          catch (e) { res.status(502).json({ error: `Balance check failed: ${e.message}` }); return; }
          // ── PREFER-ARC ROUTING ─────────────────────────────────────────────
          // Arc/Gateway is the cheaper rail (sub-cent, USDC-gas, no facilitator
          // fee), so spend from the Arc Gateway balance FIRST whenever it covers
          // the charge. If it can't, and the service also exposes a Base facilitator
          // rail (baseRailUrl — dual-rail services), fall back to paying from the
          // buyer's RAW Base USDC via the facilitator (same EOA, gasless, facilitator
          // settles). Only if NEITHER rail can cover it do we return "insufficient".
          const baseRailUrl = service.data().baseRailUrl;
          if (available >= totalCharge) {
            // Gate 2 — windowed spend limit bounds a compromised API key (no ledger cap here).
            const limit = await checkSpendLimit(apiKey, totalCharge);
            if (!limit.ok) { res.status(402).json({ error: limit.reason || "Spending limit exceeded." }); return; }

            // Pay from the user's own wallet on ARC (Circle signs; settles from Gateway balance).
            let data, tx;
            try {
              const r = await payFromUserWallet({ walletId: prof.obolWalletId, address: prof.obolWalletAddress, url: fullUrl.toString(), method });
              data = r.data; tx = r.tx;
            } catch (e) { res.status(502).json({ error: `Payment failed: ${e.message}` }); return; }

            await recordSpend(apiKey, totalCharge, tx || `${auth.uid}:${Date.now()}`);
            await recordPayment({ buyerUid: auth.uid, buyerAddress: prof.obolWalletAddress, service, amountCharged: totalCharge, amountToSeller: priceUsdc, tx });
            res.json({
              data, tx: tx ?? null, charged: totalCharge, serviceFee: priceUsdc, platformFee,
              feeRate: `${PLATFORM_FEE_BPS / 100}%`, priceSource, gas: 0, rail: "arc-gateway",
              payer: prof.obolWalletAddress, // paid from the USER's own wallet, not a relayer
              remainingBalance: Math.max(0, available - totalCharge).toFixed(4),
            });
            return;
          }
          if (baseRailUrl) {
            // Arc balance short → pay from RAW Base USDC via the facilitator. Same EOA
            // (Circle wallet address is identical on Base), keyless + gasless; earnings
            // land directly in the seller's wallet on Base.
            const baseUrlObj = new URL(baseRailUrl);
            for (const [k, v] of Object.entries(params || {})) baseUrlObj.searchParams.set(k, String(v));
            const limit = await checkSpendLimit(apiKey, priceUsdc);
            if (!limit.ok) { res.status(402).json({ error: limit.reason || "Spending limit exceeded." }); return; }
            let result;
            try {
              const client = await getCircleClient();
              result = await payViaFacilitator({ circleClient: client, walletId: prof.obolWalletId, fromAddress: prof.obolWalletAddress, callUrl: baseUrlObj.toString(), method, maxPriceUsdc: Number(maxPrice) });
            } catch (e) { res.status(502).json({ error: `Base facilitator payment failed: ${e.message}` }); return; }
            await recordSpend(apiKey, result.charged, `${auth.uid}:${Date.now()}`);
            await recordPayment({ buyerUid: auth.uid, buyerAddress: prof.obolWalletAddress, service, amountCharged: result.charged, amountToSeller: result.charged, tx: result.settlement?.transaction ?? null });
            res.json({
              data: result.data, charged: result.charged, serviceFee: result.charged, platformFee: 0,
              priceSource, gas: 0, rail: "base-facilitator", payer: result.payer, network: result.network,
              source: "own-dual-rail", settlement: result.settlement ?? null,
              note: "Arc balance was short — paid from raw Base USDC via facilitator.",
            });
            return;
          }
          // Neither rail can cover it.
          res.status(402).json({ error: `Insufficient balance. Need $${totalCharge.toFixed(4)}; Arc Gateway has $${available.toFixed(4)} and this service has no Base rail. Fund your Arc wallet to continue.` });
          return;
        }
        // no provisioned wallet → fall through to legacy relayer path
      }

      // 3. (Legacy) Check + reserve spending balance (Firestore transaction)
      let currentBalance = 0;
      await db().runTransaction(async (tx) => {
        const snap = await tx.get(profRef);
        currentBalance = parseFloat(snap.data()?.spendingBalance ?? "0");
        if (currentBalance < totalCharge) throw new Error(`Insufficient balance. Need $${totalCharge.toFixed(4)}, have $${currentBalance.toFixed(4)}.`);
        tx.update(profRef, { spendingBalance: Math.max(0, currentBalance - totalCharge).toFixed(6) });
      });

      // 4. Pay via relayer and call the service (relayer pays seller priceUsdc; Obol keeps platformFee)
      // fullUrl already built above (with params) for the live price read.
      const relayerClient = new GatewayClient({ chain: NET.gatewayClientChain, privateKey: OBOL_RELAYER_KEY.value() });
      let data, settlementTx;
      try {
        const r = await relayerClient.pay(fullUrl.toString(), { method });
        data = r.data;
        settlementTx = r.transaction; // surface the on-chain settlement ref to keyless buyers
      } catch (e) {
        // Refund on upstream failure
        await profRef.update({ spendingBalance: currentBalance.toFixed(6) });
        res.status(502).json({ error: `Upstream call failed: ${e.message}` });
        return;
      }
      await recordPayment({ buyerUid: auth.uid, buyerAddress: (await profRef.get()).data()?.obolWalletAddress, service, amountCharged: totalCharge, amountToSeller: priceUsdc, tx: settlementTx });

      res.json({
        data,
        tx: settlementTx ?? null, // on-chain settlement reference (batched)
        charged: totalCharge,
        serviceFee: priceUsdc,
        platformFee,
        feeRate: `${PLATFORM_FEE_BPS / 100}%`, // 0% commission — seller keeps 100%
        priceSource, // "x402-endpoint" (live per-endpoint price) or "registered-fallback"
        gas: 0,      // nanopayments are gasless (offchain EIP-3009, batched settlement)
        remainingBalance: Math.max(0, currentBalance - totalCharge).toFixed(4),
      });
    } catch (e) {
      console.error("payAndCall error:", e);
      res.status(e.message?.includes("Insufficient") ? 402 : 500).json({ error: String(e.message) });
    }
  }
);

// ============================================================
// getAgentBalance — returns a user's spending balance by API key.
// GET /api/agent-balance  ?apiKey=obl_sk_live_…
// ============================================================
export const getAgentBalance = onRequest(
  { region: "us-central1", cors: true, memory: "256MiB" },
  async (req, res) => {
    const rawKey = String(req.query.apiKey || (req.get("authorization") || "").replace(/^Bearer\s+/i, ""));
    const auth = await verifyApiKey(rawKey);
    if (!auth) { res.status(401).json({ error: "Invalid or missing Obol API key." }); return; }
    const prof = (await db().collection("profiles").doc(auth.uid).get()).data() || {};
    // In user-pays mode the source of truth is the wallet's REAL Gateway balance,
    // not the off-chain ledger. Fall back to the ledger value on the legacy path.
    if (userPaysEnabled(auth.uid) && prof.obolWalletAddress) {
      try {
        const available = await getUserGatewayAvailable(prof.obolWalletAddress);
        res.json({ spendingBalance: available.toFixed(4), agentWallet: prof.obolWalletAddress, source: "gateway" });
        return;
      } catch { /* fall through to ledger value on read error */ }
    }
    res.json({
      spendingBalance: parseFloat(prof.spendingBalance ?? "0").toFixed(4),
      agentWallet: prof.obolWalletAddress ?? null,
      source: "ledger",
    });
  }
);

// ============================================================
// reportService — community + agent reports of bad services.
//   POST /api/report
//     { serviceId, source?: "agent"|"human", reason?, description?, evidence?, flags?[], reporterApiKey? }
// Anyone can report (no auth required — agents report autonomously). On enough
// reports OR an agent-flagged dangerous response, the service is RE-SCANNED and
// auto-quarantined if confirmed. Reports are append-only and tamper-evident.
// ============================================================
const AUTO_QUARANTINE_REPORTS = 3;   // distinct credible reports → quarantine pending review
const DANGEROUS_FLAGS = new Set(["fund-theft", "secret-exfil", "instruction-override", "code-exec", "markdown-exfil", "hidden-unicode"]);

export const reportService = onRequest(
  { region: "us-central1", cors: true, memory: "256MiB", maxInstances: 20, timeoutSeconds: 30, secrets: [GEMINI_API_KEY] },
  async (req, res) => {
    if (req.method !== "POST") { res.status(405).json({ error: "POST only." }); return; }
    try {
      const b = req.body || {};
      const serviceId = String(b.serviceId || "").trim();
      if (!serviceId) { res.status(400).json({ error: "serviceId is required." }); return; }
      const svcRef = db().collection("services").doc(serviceId);
      const svc = await svcRef.get();
      if (!svc.exists) { res.status(404).json({ error: "Service not found." }); return; }

      const source = b.source === "agent" ? "agent" : "human";
      const flags = Array.isArray(b.flags) ? b.flags.slice(0, 20).map(String) : [];
      // Optional reporter identity (agents pass their API key; humans are anonymous-ok).
      let reporterUid = null;
      if (b.reporterApiKey) { const a = await verifyApiKey(String(b.reporterApiKey)); reporterUid = a?.uid ?? null; }

      // Append the report (idempotent per reporter+service when an API key is given).
      const reportId = reporterUid
        ? createHash("sha256").update(`${serviceId}:${reporterUid}:${source}`).digest("hex").slice(0, 40)
        : undefined;
      const report = {
        serviceId, source, reporterUid,
        reason: String(b.reason || "unspecified").slice(0, 120),
        description: String(b.description || "").slice(0, 2000),
        evidence: String(b.evidence || "").slice(0, 2000),
        flags, ts: Date.now(),
      };
      if (reportId) await db().collection("reports").doc(reportId).set(report, { merge: true });
      else await db().collection("reports").add(report);

      // Tally distinct reports and decide on action.
      const tally = await db().collection("reports").where("serviceId", "==", serviceId).limit(50).get();
      const reportCount = tally.size;
      const agentDanger = source === "agent" && flags.some((f) => DANGEROUS_FLAGS.has(f));

      // Learn from the reported evidence: escalate it to Gemini (cost-gated) so a
      // novel attack phrase the agent saw gets distilled into the free layer.
      let geminiVerdict = null;
      if (report.evidence) geminiVerdict = await geminiEscalate(report.evidence, "report").catch(() => null);

      let action = "logged";
      // An agent that observed a dangerous response, Gemini-confirmed evidence, or
      // enough independent reports → fresh re-scan; confirmed-bad → quarantine now.
      const geminiConfirmed = geminiVerdict?.malicious && geminiVerdict.confidence >= 0.6;
      if (agentDanger || geminiConfirmed || reportCount >= AUTO_QUARANTINE_REPORTS) {
        const learned = await loadLearnedPhrases();
        const safety = await scanServiceSafety(svc.data().hostedUrl, learned);
        const update = { reportCount, lastReportAt: Date.now(), safety, lastRescanAt: Date.now() };
        if (safety.verdict === "dangerous" || geminiConfirmed || reportCount >= AUTO_QUARANTINE_REPORTS) {
          update.active = false; update.quarantined = true;
          update.quarantineReason = geminiConfirmed ? "gemini-confirmed" : safety.verdict === "dangerous" ? "rescan-confirmed" : "report-threshold";
          action = "quarantined";
        }
        await svcRef.set(update, { merge: true });
      } else {
        await svcRef.set({ reportCount, lastReportAt: Date.now() }, { merge: true });
      }

      res.json({ ok: true, action, reportCount, ...(geminiVerdict ? { gemini: { malicious: geminiVerdict.malicious, confidence: geminiVerdict.confidence } } : {}) });
    } catch (e) {
      console.error("reportService error:", e);
      res.status(500).json({ error: String(e.message) });
    }
  }
);

// ============================================================
// rescanServices — daily safety sweep of all active listings.
// Catches services that turned malicious AFTER listing (bait-and-switch).
// Bounded + chunked so one run stays well under the timeout.
// ============================================================
export const rescanServices = onSchedule(
  { schedule: "every 24 hours", region: "us-central1", memory: "512MiB", timeoutSeconds: 540, secrets: [GEMINI_API_KEY] },
  async () => {
    const learned = await loadLearnedPhrases(); // load the learned layer once for the whole sweep
    const snap = await db().collection("services").where("active", "==", true).limit(500).get();
    const docs = snap.docs;
    const CHUNK = 8;
    let scanned = 0, quarantined = 0;
    for (let i = 0; i < docs.length; i += CHUNK) {
      const batch = docs.slice(i, i + CHUNK);
      await Promise.all(batch.map(async (d) => {
        try {
          const safety = await scanServiceSafety(d.data().hostedUrl, learned);
          scanned++;
          // Escalate only the ambiguous few to Gemini (cost-gated) — never clean ones.
          if (safety.verdict === "suspicious" && safety.sample) {
            const judge = await geminiEscalate(safety.sample, "rescan").catch(() => null);
            if (judge?.malicious && judge.confidence >= 0.6) safety.verdict = "dangerous";
          }
          const update = { safety, lastRescanAt: Date.now() };
          if (safety.verdict === "dangerous") {
            update.active = false; update.quarantined = true; update.quarantineReason = "rescan";
            quarantined++;
          }
          await d.ref.set(update, { merge: true });
        } catch (e) {
          console.error("rescan failed for", d.id, e.message);
        }
      }));
    }
    console.log(`rescanServices: scanned ${scanned}, quarantined ${quarantined}`);
  }
);
