// Obol — passkey (WebAuthn) gating for withdrawals. SECURITY P0.
//
// Moving funds OUT of a user's Obol wallet is the one action that must require a
// signature from the USER'S DEVICE, not merely a valid Firebase session or a
// leaked backend/API credential. This module implements an APP-LEVEL passkey gate:
//   • the user registers a WebAuthn credential (credentialId + public key) stored
//     on profiles/{uid}.passkey after we verify a genuine attestation;
//   • every withdrawal must be accompanied by a fresh, one-time WebAuthn assertion
//     over a server-issued challenge, verified against that stored public key.
//
// What this buys (see docs/security-hardening.md): an attacker holding only the
// Obol API key, or who has partially breached the backend (read secrets / DB) but
// does NOT control a registered user device, cannot authorize a withdrawal.
//
// What it does NOT buy: a FULL backend breach that controls THIS code can still
// skip the check — the only breach-proof design holds funds in a Circle Modular
// (passkey) wallet where the chain enforces the passkey signature (v2, Section 4/6
// of the hardening doc). This app-level gate is the pragmatic, buildable P0.
import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type RegistrationResponseJSON,
  type AuthenticationResponseJSON,
} from "@simplewebauthn/server";

const RP_NAME = "Obol";
// Challenges are single-use and short-lived. 5 minutes covers a real user tapping
// through the OS passkey prompt without leaving a long replay window.
const CHALLENGE_TTL_MS = 5 * 60 * 1000;

// Origins the passkey ceremony is allowed to run from. The rpID is the hostname of
// the origin (WebAuthn scopes a credential to its rpID). Configure extra origins via
// PASSKEY_ORIGINS (comma-separated); localhost + the known prod hosts are defaults.
function allowedOrigins(): string[] {
  const extra = (process.env.PASSKEY_ORIGINS || "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  return Array.from(new Set([
    "https://obol-arc.web.app",
    "https://obol-mcp.web.app",
    "http://localhost:3000",
    ...extra,
  ]));
}

// Validate the client-supplied origin against the allowlist and derive its rpID.
function resolveOrigin(rawOrigin: unknown): { origin: string; rpID: string } {
  const origin = String(rawOrigin ?? "");
  if (!allowedOrigins().includes(origin)) {
    throw new HttpsError("permission-denied", `Origin "${origin}" is not allowed for passkeys.`);
  }
  return { origin, rpID: new URL(origin).hostname };
}

type StoredPasskey = {
  credentialId: string; // base64url
  publicKey: string;    // base64url of the COSE public key bytes
  counter: number;
  transports?: string[];
  createdAt: number;
};

const b64uToBytes = (s: string) => new Uint8Array(Buffer.from(s, "base64url"));
const bytesToB64u = (b: Uint8Array) => Buffer.from(b).toString("base64url");

// ---------- getPasskeyStatus — does this user have a registered passkey? ----------
export const getPasskeyStatus = onCall({ region: "us-central1" }, async (req) => {
  const uid = req.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in required.");
  const prof = (await admin.firestore().collection("profiles").doc(uid).get()).data();
  const pk = prof?.passkey as StoredPasskey | undefined;
  return { registered: !!pk?.credentialId };
});

// ---------- getPasskeyRegisterOptions — issue a registration challenge ----------
// Returns WebAuthn creation options for navigator.credentials.create (via
// @simplewebauthn/browser startRegistration). The challenge is stashed server-side
// so registerPasskey can verify the attestation was produced for THIS challenge.
export const getPasskeyRegisterOptions = onCall({ region: "us-central1" }, async (req) => {
  const uid = req.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in required.");
  const { origin, rpID } = resolveOrigin(req.data?.origin);

  const prof = (await admin.firestore().collection("profiles").doc(uid).get()).data();
  const existing = prof?.passkey as StoredPasskey | undefined;

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID,
    userID: new TextEncoder().encode(uid),
    userName: req.auth?.token?.email ?? uid,
    attestationType: "none",
    authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
    excludeCredentials: existing?.credentialId
      ? [{ id: existing.credentialId, transports: existing.transports as never }]
      : [],
  });

  await admin.firestore().collection("passkeyRegChallenges").doc(uid).set({
    challenge: options.challenge, origin, rpID, expiresAt: Date.now() + CHALLENGE_TTL_MS,
  });
  return { options };
});

// ---------- registerPasskey — verify attestation + store the credential ----------
export const registerPasskey = onCall({ region: "us-central1" }, async (req) => {
  const uid = req.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in required.");
  const attestationResponse = req.data?.attestationResponse as RegistrationResponseJSON | undefined;
  if (!attestationResponse) throw new HttpsError("invalid-argument", "attestationResponse required.");

  const chRef = admin.firestore().collection("passkeyRegChallenges").doc(uid);
  const ch = (await chRef.get()).data();
  if (!ch || typeof ch.expiresAt !== "number" || ch.expiresAt < Date.now()) {
    throw new HttpsError("failed-precondition", "Registration challenge expired — start over.");
  }
  await chRef.delete(); // one-time use

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: attestationResponse,
      expectedChallenge: ch.challenge,
      expectedOrigin: ch.origin,
      expectedRPID: ch.rpID,
      requireUserVerification: false,
    });
  } catch (e) {
    throw new HttpsError("invalid-argument", "Passkey attestation invalid: " + (e as Error).message);
  }
  if (!verification.verified || !verification.registrationInfo) {
    throw new HttpsError("invalid-argument", "Passkey attestation could not be verified.");
  }

  const cred = verification.registrationInfo.credential;
  const stored: StoredPasskey = {
    credentialId: cred.id,
    publicKey: bytesToB64u(cred.publicKey),
    counter: cred.counter,
    transports: cred.transports ?? attestationResponse.response.transports,
    createdAt: Date.now(),
  };
  await admin.firestore().collection("profiles").doc(uid).set({ passkey: stored }, { merge: true });
  return { ok: true };
});

// ---------- getWithdrawChallenge — issue a one-time withdrawal challenge ----------
// Called right before a withdrawal. Stores {challenge, origin, rpID} on
// withdrawChallenges/{uid} with a short TTL; verifyPasskeyAssertion consumes it.
export const getWithdrawChallenge = onCall({ region: "us-central1" }, async (req) => {
  const uid = req.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in required.");
  const { origin, rpID } = resolveOrigin(req.data?.origin);

  const prof = (await admin.firestore().collection("profiles").doc(uid).get()).data();
  const pk = prof?.passkey as StoredPasskey | undefined;
  if (!pk?.credentialId) throw new HttpsError("failed-precondition", "No passkey registered.");

  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: "preferred",
    allowCredentials: [{ id: pk.credentialId, transports: pk.transports as never }],
  });

  await admin.firestore().collection("withdrawChallenges").doc(uid).set({
    challenge: options.challenge, origin, rpID, expiresAt: Date.now() + CHALLENGE_TTL_MS,
  });
  return { options, challenge: options.challenge };
});

// ---------- verifyPasskeyAssertion — verify a withdrawal assertion (EXPORTED) ----------
// Called by withdrawObolWallet. Verifies `assertionResponse` against the user's
// stored public key AND the one-time challenge stored by getWithdrawChallenge.
// Throws HttpsError on any failure; consumes the challenge (single-use). The stored
// challenge doc also carries origin/rpID so the fixed (uid, assertion, challenge)
// signature is enough — the trust anchors come from the server, not the caller.
export async function verifyPasskeyAssertion(
  uid: string,
  assertionResponse: AuthenticationResponseJSON,
  challenge: string,
): Promise<{ verified: true }> {
  const db = admin.firestore();
  const pk = (await db.collection("profiles").doc(uid).get()).data()?.passkey as StoredPasskey | undefined;
  if (!pk?.credentialId) throw new HttpsError("failed-precondition", "No passkey registered.");

  const chRef = db.collection("withdrawChallenges").doc(uid);
  const ch = (await chRef.get()).data();
  if (!ch || typeof ch.expiresAt !== "number" || ch.expiresAt < Date.now()) {
    throw new HttpsError("failed-precondition", "Withdrawal challenge expired — request a new one.");
  }
  if (ch.challenge !== challenge) {
    throw new HttpsError("permission-denied", "Withdrawal challenge mismatch.");
  }
  await chRef.delete(); // one-time use — prevents assertion replay

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: assertionResponse,
      expectedChallenge: ch.challenge,
      expectedOrigin: ch.origin,
      expectedRPID: ch.rpID,
      requireUserVerification: false,
      credential: {
        id: pk.credentialId,
        publicKey: b64uToBytes(pk.publicKey),
        counter: pk.counter,
        transports: pk.transports as never,
      },
    });
  } catch (e) {
    throw new HttpsError("permission-denied", "Passkey assertion invalid: " + (e as Error).message);
  }
  if (!verification.verified) {
    throw new HttpsError("permission-denied", "Passkey assertion could not be verified.");
  }

  // Advance the signature counter (clone-detection hygiene where authenticators
  // support it; many platform passkeys report 0 and this is a no-op).
  const newCounter = verification.authenticationInfo.newCounter;
  if (newCounter > pk.counter) {
    await db.collection("profiles").doc(uid).set({ passkey: { counter: newCounter } }, { merge: true });
  }
  return { verified: true };
}
