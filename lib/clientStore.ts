// Client-side Firestore data layer (Web SDK). Gated by firestore.rules. No
// firebase-admin → sidesteps the Firebase-frameworks SSR bundling issue.
//
// Includes an append-only `events` audit log: every wallet/listing action
// writes an acknowledgement row (uid, wallet, type, detail, ts) so there's a
// verifiable trail per wallet — the Agent-Commerce-Kit "ack" pattern.
"use client";

import {
  collection, query, where, orderBy, limit, getDocs, addDoc, doc, getDoc, setDoc,
} from "firebase/firestore";
import { fdb } from "./firebase";

export type Service = {
  id: string;
  ownerUid: string;
  name: string;
  slug: string;
  category: string;
  description: string;
  priceUsdc: string;
  payoutAddress: string;
  hostedUrl: string;
  /** Self-describing "skill" so agents know how to call it. */
  inputSchema: string; // e.g. "domain: string" or a JSON-schema string
  docsUrl: string;     // link to API docs / OpenAPI
  /** Optional per-endpoint pricing for multi-endpoint APIs. */
  endpoints?: ServiceEndpoint[];
  /** Markdown skill doc (uploaded) describing the API for agents/humans. */
  skillMarkdown?: string;
  openapiUrl?: string;
  active: boolean;
  createdAt: number;
  /** ACK-ID (Agent Commerce Kit) — verifiable seller identity, issued by Obol. */
  ackVerified?: boolean;
  ackDid?: string;          // seller wallet identity (did:pkh)
  ackIssuer?: string;       // Obol issuer DID (did:key)
  ackCredential?: string;   // signed Verifiable Credential (JWT)
};

export type ServiceEndpoint = {
  path: string;        // e.g. "/forecast"
  priceUsdc: string;   // per-call price for this endpoint
  description?: string;
  params?: string;     // e.g. "lat: number, lon: number"
};

export type ObolEvent = {
  id: string;
  uid: string;
  wallet: string | null;
  type: string;
  detail: string;
  ts: number;
  /** Chain key (e.g. "base", "arc") when the action is chain-specific. */
  network?: string;
  /** On-chain tx hash, when the backend records one alongside the detail string. */
  txHash?: string;
  tx?: string;
};

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

/** Structured client logger — visible in the browser console + forwardable. */
function log(level: "info" | "error", scope: string, msg: string, extra?: unknown) {
  const line = `[obol:${scope}] ${msg}`;
  if (level === "error") console.error(line, extra ?? "");
  else console.info(line, extra ?? "");
}

// ---------- audit / ack log ----------

/** Append an acknowledgement row for a wallet/listing action. Never throws. */
export async function logEvent(
  uid: string,
  type: string,
  detail: string,
  wallet?: string | null,
): Promise<void> {
  try {
    await addDoc(collection(fdb, "events"), {
      uid,
      wallet: wallet ?? null,
      type,
      detail,
      ts: Date.now(),
    });
    log("info", "ack", `${type} — ${detail}`, wallet);
  } catch (e) {
    // Audit logging must never break the user action.
    log("error", "ack", `failed to record ${type}`, e);
  }
}

export async function listMyEvents(uid: string, max = 25): Promise<ObolEvent[]> {
  try {
    const snap = await getDocs(
      query(collection(fdb, "events"), where("uid", "==", uid), orderBy("ts", "desc"), limit(max)),
    );
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ObolEvent, "id">) }));
  } catch (e) {
    log("error", "events", "list failed", e);
    return [];
  }
}

// ---------- services directory ----------

export async function listActiveServices(): Promise<Service[]> {
  try {
    const snap = await getDocs(
      query(collection(fdb, "services"), where("active", "==", true), orderBy("createdAt", "desc"), limit(200)),
    );
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Service, "id">) }));
  } catch (e) {
    log("error", "services", "listActive failed", e);
    return [];
  }
}

export async function listMyServices(uid: string): Promise<Service[]> {
  try {
    const snap = await getDocs(
      query(collection(fdb, "services"), where("ownerUid", "==", uid), orderBy("createdAt", "desc"), limit(200)),
    );
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Service, "id">) }));
  } catch (e) {
    log("error", "services", "listMine failed", e);
    return [];
  }
}

export async function createService(
  uid: string,
  input: { name: string; category: string; description: string; priceUsdc: string; payoutAddress: string; hostedUrl: string; inputSchema?: string; docsUrl?: string; endpoints?: ServiceEndpoint[]; skillMarkdown?: string; openapiUrl?: string },
): Promise<Service> {
  const data: Omit<Service, "id"> = {
    ownerUid: uid,
    name: input.name.trim(),
    slug: slugify(input.name),
    category: input.category,
    description: input.description.trim(),
    priceUsdc: String(input.priceUsdc).trim(),
    payoutAddress: input.payoutAddress.trim(),
    hostedUrl: input.hostedUrl.trim(),
    inputSchema: (input.inputSchema || "").trim(),
    docsUrl: (input.docsUrl || "").trim(),
    endpoints: input.endpoints ?? [],
    skillMarkdown: (input.skillMarkdown || "").trim(),
    openapiUrl: (input.openapiUrl || "").trim(),
    active: true,
    createdAt: Date.now(),
  };
  try {
    const ref = await addDoc(collection(fdb, "services"), data);
    await logEvent(uid, "service_registered", `${data.name} @ $${data.priceUsdc}/call`, data.payoutAddress);
    log("info", "services", `created ${ref.id}`);
    return { id: ref.id, ...data };
  } catch (e) {
    log("error", "services", "create failed", e);
    throw e instanceof Error ? e : new Error("Failed to save service");
  }
}

// ---------- profile (linked wallet address) ----------

export async function getProfileAddress(uid: string): Promise<string | null> {
  try {
    const snap = await getDoc(doc(fdb, "profiles", uid));
    return snap.exists() ? ((snap.data().address as string) ?? null) : null;
  } catch (e) {
    log("error", "profile", "get failed", e);
    return null;
  }
}

export async function setProfileAddress(uid: string, address: string): Promise<void> {
  try {
    await setDoc(doc(fdb, "profiles", uid), { uid, address, updatedAt: Date.now() }, { merge: true });
    await logEvent(uid, "wallet_linked", "linked self-custody wallet", address);
    log("info", "profile", "address linked");
  } catch (e) {
    log("error", "profile", "set failed", e);
    throw e instanceof Error ? e : new Error("Failed to save wallet address");
  }
}

// ---------- full profile (public) + verification ----------

export type Socials = { x?: string; github?: string; linkedin?: string; website?: string; youtube?: string; discord?: string };
export const SOCIAL_KEYS = ["website", "x", "linkedin", "youtube", "github", "discord"] as const;
export type SocialKey = typeof SOCIAL_KEYS[number];
export type KybStatus = "none" | "pending" | "verified";
export type Verification = {
  walletVerified?: boolean;     // proved control of payout address (ACK-ID)
  kybStatus?: KybStatus;        // business verification
  kybBusinessName?: string;
  kybCountry?: string;
  verifiedAt?: number;
};
export type ObolProfile = {
  uid: string;
  address?: string;             // mirrors obolWalletAddress; kept for backward compat
  obolWalletAddress?: string;   // Circle dev-controlled wallet address (Obol custodies entity secret)
  obolWalletId?: string;        // Circle wallet id (for server-side transfers)
  spendingBalance?: string;     // pre-paid USDC API credits (Firestore string, 6 dp)
  payoutAddress?: string;       // external address withdrawals/sweeps go TO
  payoutSchedule?: "manual" | "hourly" | "daily" | "weekly" | "monthly" | "threshold";
  username?: string;
  displayName?: string;
  companyName?: string;
  bio?: string;
  avatarUrl?: string;
  logoUrl?: string;
  socials?: Socials;
  socialsShowOnListing?: string[]; // subset of SOCIAL_KEYS to display on marketplace cards
  verification?: Verification;
  /** Incoming webhook (Slack/Discord/etc.) pinged on connect + future sales. */
  webhookUrl?: string;
  /** Scheduling link (Cal.com/Calendly/Google) → "Book a demo" on public profile. */
  schedulingUrl?: string;
  updatedAt?: number;
};

export async function getProfile(uid: string): Promise<ObolProfile | null> {
  try {
    const snap = await getDoc(doc(fdb, "profiles", uid));
    return snap.exists() ? ({ uid, ...(snap.data() as Omit<ObolProfile, "uid">) }) : null;
  } catch (e) {
    log("error", "profile", "get failed", e);
    return null;
  }
}

/** Merge-update the caller's own profile. */
export async function saveProfile(uid: string, patch: Partial<ObolProfile>): Promise<void> {
  try {
    await setDoc(doc(fdb, "profiles", uid), { uid, ...patch, updatedAt: Date.now() }, { merge: true });
    await logEvent(uid, "profile_updated", Object.keys(patch).join(","), patch.address ?? null);
  } catch (e) {
    log("error", "profile", "save failed", e);
    throw e instanceof Error ? e : new Error("Failed to save profile");
  }
}

/** Submit business (KYB) details → status pending (MVP: manual review). */
export async function submitKyb(uid: string, kyb: { businessName: string; country: string }): Promise<void> {
  await saveProfile(uid, {
    verification: { kybStatus: "pending", kybBusinessName: kyb.businessName, kybCountry: kyb.country },
  });
  await logEvent(uid, "kyb_submitted", kyb.businessName);
}

// ---------- services: public detail + per-seller ----------

export async function getServiceById(id: string): Promise<Service | null> {
  try {
    const snap = await getDoc(doc(fdb, "services", id));
    return snap.exists() ? ({ id, ...(snap.data() as Omit<Service, "id">) }) : null;
  } catch (e) {
    log("error", "services", "getById failed", e);
    return null;
  }
}

/** A seller's public (active) listings — for their profile page. */
export async function listSellerServices(ownerUid: string): Promise<Service[]> {
  try {
    const snap = await getDocs(
      query(collection(fdb, "services"), where("ownerUid", "==", ownerUid), where("active", "==", true), limit(100)),
    );
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Service, "id">) })).sort((a, b) => b.createdAt - a.createdAt);
  } catch (e) {
    log("error", "services", "listSeller failed", e);
    return [];
  }
}

// ---------- trust score ----------

/**
 * 0–100 trust score: identity (KYB/wallet) + activity (calls) + revenue + tenure.
 * Cheap, transparent, and tunable — the thing a raw Circle integration lacks.
 */
export function trustScore(p: ObolProfile | null, metrics: { calls: number; earned: number; ageDays?: number }): number {
  let s = 0;
  const v = p?.verification;
  if (v?.kybStatus === "verified") s += 45;
  else if (v?.walletVerified) s += 20;
  s += Math.min(25, Math.log10(Math.max(1, metrics.calls)) * 12);      // activity
  s += Math.min(20, Math.log10(Math.max(1, metrics.earned + 1)) * 14); // revenue
  s += Math.min(10, (metrics.ageDays ?? 0) / 9);                        // tenure
  return Math.round(Math.min(100, s));
}

export function trustLabel(score: number): string {
  if (score >= 80) return "Highly trusted";
  if (score >= 55) return "Trusted";
  if (score >= 30) return "Established";
  return "New";
}
