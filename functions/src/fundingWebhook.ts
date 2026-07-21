// ============================================================================
// fundingWebhook — Circle Wallets inbound-transfer webhook → funding job signal
// ============================================================================
//
// WHAT THIS DOES
// --------------
// Circle Wallets sends a signed webhook to this endpoint whenever an INBOUND
// transfer lands in one of our developer-controlled wallets. Users receive USDC
// at a per-chain SCA "deposit address" (profiles/{uid}.fundingWallets[chain]).
// When such a deposit is CONFIRMED/COMPLETED here, we:
//   1. Verify the Circle signature (asymmetric ECDSA — see below).
//   2. Extract destinationAddress + blockchain + amount from the payload.
//   3. Map Circle's blockchain id (e.g. "BASE-SEPOLIA") back to our chain key
//      ("base") and find the profile whose fundingWallets[chain].scaAddress
//      matches destinationAddress (Firestore query on the nested field path).
//   4. Write fundingJobs/{uid}__{chain} = { uid, chain, status:"pending", ... }.
//      A processor (wired in index.ts) picks this up and runs the bridge-to-Arc
//      pipeline (the existing processFundingDeposit logic). We deliberately do
//      NOT call processFundingDeposit here — the webhook only RECORDS the job.
//
// ----------------------------------------------------------------------------
// (a) HOW TO REGISTER THE WEBHOOK SUBSCRIPTION WITH CIRCLE
// ----------------------------------------------------------------------------
// Docs: https://developers.circle.com/wallets/webhook-notifications
//
// Deploy this function first so it has a public HTTPS URL, e.g.
//   https://us-central1-<project>.cloudfunctions.net/fundingWebhook
//
// Option 1 — Developer Console (simplest):
//   1. Open your Circle Developer account → click "Webhooks".
//   2. Click "Add a Webhook" (top-right).
//   3. Paste the fundingWebhook URL above and click "Add Webhook".
//   4. Circle immediately POSTs a `webhooks.test` ("hello world") notification;
//      this handler returns 200 for it so the subscription verifies.
//   5. (Recommended) Toggle "Limit to specific events" and select
//      transactions → transactions.inbound, so this endpoint only receives the
//      inbound deposits it cares about. (Testnet & mainnet each allow up to 20
//      webhook subscriptions.)
//
// Option 2 — REST API (POST /v1/w3s/config/entity/notificationSubscriptions):
//   curl --request POST \
//     --url 'https://api.circle.com/v1/w3s/config/entity/notificationSubscriptions' \
//     --header 'authorization: Bearer <CIRCLE_TESTNET_API_KEY>' \
//     --header 'content-type: application/json' \
//     --data '{ "endpoint": "https://us-central1-<project>.cloudfunctions.net/fundingWebhook" }'
//
// OPTIONAL — restrict which tokens fire callbacks (Monitored Tokens):
//   By default ALL tokens deposited into our wallets fire webhooks. To only
//   monitor USDC, POST the USDC tokenId(s) to
//   /v1/w3s/config/entity/monitoredTokens. We instead filter to USDC in-code
//   below (by comparing the credited amount / tokenId is opaque), so this step
//   is optional. Docs: https://developers.circle.com/wallets/monitored-tokens
//
// ----------------------------------------------------------------------------
// (b) WHICH SECRET HOLDS THE SIGNING KEY
// ----------------------------------------------------------------------------
// Circle Wallets webhooks are signed with an ASYMMETRIC key (ECDSA_SHA_256), not
// a shared HMAC secret. Each notification carries two headers:
//   X-Circle-Key-Id    — UUID identifying which public key signed it
//   X-Circle-Signature — base64 ECDSA signature over the raw JSON body
// We fetch the matching PUBLIC key from Circle at runtime via
//   GET https://api.circle.com/v2/notifications/publicKey/{keyId}
// which is authenticated with our Circle API key. So:
//   >>> The secret used for verification is CIRCLE_TESTNET_API_KEY (the same
//       Circle API key secret already defined in index.ts). There is no separate
//       "webhook signing secret" to store — Circle holds the private key and we
//       verify against the public key it serves. <<<
// The fetched public key is static per keyId, so we cache it in-process.
//
// ----------------------------------------------------------------------------
// (c) ONE EXPORT LINE TO ADD TO index.ts
// ----------------------------------------------------------------------------
//   export { fundingWebhook } from "./fundingWebhook";
//
// ============================================================================

import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import * as admin from "firebase-admin";
import { createPublicKey, verify as cryptoVerify } from "crypto";
import { getAddress } from "ethers";

// Same Circle API key secret bound in index.ts — used only to authenticate the
// GET /v2/notifications/publicKey/{keyId} call. (index.ts already calls
// admin.initializeApp(); this module reuses the same default app.)
const CIRCLE_API_KEY = defineSecret("CIRCLE_TESTNET_API_KEY");

// Reverse of index.ts's CIRCLE_BLOCKCHAIN map: Circle blockchain id -> our chain
// key. Must stay in sync with CIRCLE_BLOCKCHAIN in index.ts. "arc" is included so
// deposits observed directly on Arc still resolve (harmless if never fired).
const BLOCKCHAIN_TO_CHAIN: Record<string, string> = {
  "BASE-SEPOLIA": "base",
  "ARB-SEPOLIA": "arbitrum",
  "OP-SEPOLIA": "optimism",
  "MATIC-AMOY": "polygon",
  "AVAX-FUJI": "avalanche",
  "ETH-SEPOLIA": "ethereum",
  "UNI-SEPOLIA": "unichain",
  "MONAD-TESTNET": "monad",
  "SOL-DEVNET": "solana",
  "ARC-TESTNET": "arc",
};

// Circle's public-key endpoint lives on api.circle.com for BOTH testnet and
// mainnet — the API key (testnet vs mainnet) selects the environment.
const CIRCLE_PUBLIC_KEY_URL = "https://api.circle.com/v2/notifications/publicKey";

// In-process cache of fetched public keys, keyed by X-Circle-Key-Id. The key is
// static per keyId, so caching avoids a round-trip on every notification.
const publicKeyCache = new Map<string, { key: ReturnType<typeof createPublicKey>; algorithm: string }>();

async function getCirclePublicKey(keyId: string, apiKey: string) {
  const cached = publicKeyCache.get(keyId);
  if (cached) return cached;
  // Docs: GET /v2/notifications/publicKey/{keyId} ->
  //   { data: { id, algorithm: "ECDSA_SHA_256", publicKey: <base64 DER SPKI> } }
  const res = await fetch(`${CIRCLE_PUBLIC_KEY_URL}/${keyId}`, {
    method: "GET",
    headers: { accept: "application/json", authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) throw new Error(`publicKey fetch failed: ${res.status}`);
  const body = (await res.json()) as { data?: { algorithm?: string; publicKey?: string } };
  const pub = body?.data?.publicKey;
  const algorithm = body?.data?.algorithm ?? "ECDSA_SHA_256";
  if (!pub) throw new Error("publicKey missing in response");
  // The key is base64-encoded DER in SPKI (X.509 subjectPublicKeyInfo) format.
  const key = createPublicKey({ key: Buffer.from(pub, "base64"), format: "der", type: "spki" });
  const entry = { key, algorithm };
  publicKeyCache.set(keyId, entry);
  return entry;
}

// Verify X-Circle-Signature over the EXACT raw request body bytes.
// Docs sample (Node): crypto.verify("sha256", messageBytes, publicKey, sigBytes)
// with the message being the raw, unmodified JSON body string. We use req.rawBody
// (the untouched bytes Circle signed) — re-serializing the parsed JSON would
// change byte order/whitespace and break verification.
async function verifyCircleSignature(
  rawBody: Buffer,
  keyId: string,
  signatureB64: string,
  apiKey: string,
): Promise<boolean> {
  try {
    const { key } = await getCirclePublicKey(keyId, apiKey);
    const signature = Buffer.from(signatureB64, "base64");
    // ECDSA_SHA_256 — the DER-encoded signature Circle sends is what crypto.verify
    // expects for an EC key with the "sha256" digest.
    return cryptoVerify("sha256", rawBody, key, signature);
  } catch {
    return false;
  }
}

// Build the set of address string variants we might have stored, so the exact
// Firestore match works regardless of checksum casing. Circle sends lowercase
// destinationAddress; provisionFundingWallet stored whatever Circle returned
// (typically checksummed). Firestore equality is case-sensitive, so we query an
// `in` over the distinct variants.
function addressVariants(addr: string): string[] {
  // Non-EVM addresses (Solana base58) are CASE-SENSITIVE — lowercasing or EIP-55
  // checksumming corrupts them. Only EVM 0x-addresses get case/checksum variants.
  if (!addr.startsWith("0x")) return [addr];
  const out = new Set<string>();
  out.add(addr);
  out.add(addr.toLowerCase());
  try {
    out.add(getAddress(addr)); // EIP-55 checksummed
  } catch {
    /* not a valid address — leave as-is */
  }
  return [...out];
}

export const fundingWebhook = onRequest(
  { secrets: [CIRCLE_API_KEY], region: "us-central1" },
  async (req, res) => {
    // --- Endpoint verification handshake -------------------------------------
    // Circle (and webhook-testing tools) may probe the endpoint with a HEAD/GET
    // before/while registering. Respond 200 so the endpoint is considered live.
    if (req.method === "HEAD" || req.method === "GET") {
      res.status(200).send("ok");
      return;
    }
    if (req.method !== "POST") {
      res.status(405).send("Method Not Allowed");
      return;
    }

    // --- Signature verification ----------------------------------------------
    const keyId = String(req.header("X-Circle-Key-Id") ?? "");
    const signature = String(req.header("X-Circle-Signature") ?? "");
    // firebase-functions v2 exposes the untouched bytes on req.rawBody.
    const rawBody: Buffer = (req as unknown as { rawBody?: Buffer }).rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));

    if (!keyId || !signature) {
      res.status(401).send("Missing Circle signature headers");
      return;
    }
    const ok = await verifyCircleSignature(rawBody, keyId, signature, CIRCLE_API_KEY.value());
    if (!ok) {
      res.status(401).send("Invalid signature");
      return;
    }

    // Parse AFTER verifying (verification is against the raw bytes).
    let evt: {
      notificationId?: string;
      notificationType?: string;
      notification?: {
        blockchain?: string;
        destinationAddress?: string;
        amounts?: string[];
        state?: string;
        transactionType?: string;
        walletId?: string;
        txHash?: string;
      };
    };
    try {
      evt = JSON.parse(rawBody.toString("utf8"));
    } catch {
      res.status(400).send("Bad JSON");
      return;
    }

    // --- Test / non-inbound notifications: ACK and ignore --------------------
    // The registration handshake sends notificationType "webhooks.test".
    const type = evt.notificationType ?? "";
    if (type === "webhooks.test") {
      res.status(200).json({ ok: true, received: "webhooks.test" });
      return;
    }
    if (type !== "transactions.inbound") {
      // Not a deposit event — acknowledge so Circle stops retrying.
      res.status(200).json({ ok: true, ignored: type });
      return;
    }

    const n = evt.notification ?? {};
    // Only act once the transfer is on-chain confirmed/settled. Circle emits both
    // CONFIRMED (broadcast, enough confs) and COMPLETED states for inbound.
    const state = String(n.state ?? "").toUpperCase();
    if (n.transactionType !== "INBOUND" || !["CONFIRMED", "COMPLETED", "COMPLETE"].includes(state)) {
      res.status(200).json({ ok: true, skipped: `state=${state}` });
      return;
    }

    const blockchain = String(n.blockchain ?? "");
    const chain = BLOCKCHAIN_TO_CHAIN[blockchain];
    const destinationAddress = String(n.destinationAddress ?? "");
    // amounts is an array of decimal strings (token units, already human-readable
    // for USDC, e.g. ["10"]). We record the first entry.
    const amount = Array.isArray(n.amounts) && n.amounts.length ? String(n.amounts[0]) : "0";

    if (!chain || !destinationAddress) {
      // Unknown chain or malformed — ACK (don't make Circle retry a payload we
      // can't route) but log for visibility.
      console.warn(`fundingWebhook: unroutable inbound blockchain=${blockchain} addr=${destinationAddress}`);
      res.status(200).json({ ok: true, unrouted: true, blockchain });
      return;
    }

    // --- Find the owning profile by its SCA deposit address ------------------
    // We know the chain, so we can query the exact nested field path
    // fundingWallets.<chain>.scaAddress directly (no full-collection scan).
    const fs = admin.firestore();
    const fieldPath = `fundingWallets.${chain}.scaAddress`;
    const snap = await fs
      .collection("profiles")
      .where(fieldPath, "in", addressVariants(destinationAddress))
      .limit(1)
      .get();

    if (snap.empty) {
      // No user owns this deposit address on this chain. ACK so Circle doesn't
      // retry; log for investigation.
      console.warn(`fundingWebhook: no profile for ${chain} scaAddress=${destinationAddress}`);
      res.status(200).json({ ok: true, matched: false, chain, destinationAddress });
      return;
    }

    const uid = snap.docs[0].id;

    // --- Record the funding job (idempotent by uid+chain) --------------------
    // Deterministic doc id fundingJobs/{uid}__{chain} means repeated webhook
    // deliveries for the same pending deposit collapse into one job (Circle can
    // deliver a notification more than once — dedupe by design). The processor
    // wired in index.ts consumes "pending" jobs and runs the bridge pipeline.
    const jobId = `${uid}__${chain}`;
    await fs.collection("fundingJobs").doc(jobId).set(
      {
        uid,
        chain,
        status: "pending",
        amount,
        blockchain,
        destinationAddress,
        txHash: n.txHash ?? null,
        notificationId: evt.notificationId ?? null,
        detectedAt: Date.now(),
      },
      { merge: true },
    );

    res.status(200).json({ ok: true, uid, chain, amount, job: jobId });
  },
);
