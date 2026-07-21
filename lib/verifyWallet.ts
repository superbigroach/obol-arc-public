// Cryptographic wallet verification (ACK-ID).
//
// Agents are headless — there is no browser wallet-connect. Instead we hand the
// seller a deterministic challenge string, they sign it OFFLINE with their key
// (a tiny viem CLI snippet), paste the signature back, and we recover it against
// their linked payout address with viem's `verifyMessage`. A match proves they
// control the address's private key.
"use client";

import { verifyMessage } from "viem";

/**
 * Deterministic, human-readable challenge for a given user + payout address.
 * Intentionally has NO timestamp/nonce so it's reproducible: the seller can
 * sign the exact same string offline and the result still verifies.
 */
export function challengeFor(uid: string, address: string): string {
  return [
    "Obol wallet verification",
    `uid: ${uid}`,
    `address: ${address}`,
    "I control this wallet.",
  ].join("\n");
}

/**
 * Verify that `signature` over `message` recovers to `address`. Returns false on
 * any error (malformed signature/address, mismatch, etc.) — never throws.
 */
export async function verifySignature(
  address: string,
  message: string,
  signature: string,
): Promise<boolean> {
  try {
    return await verifyMessage({
      address: address as `0x${string}`,
      message,
      signature: signature as `0x${string}`,
    });
  } catch {
    return false;
  }
}
