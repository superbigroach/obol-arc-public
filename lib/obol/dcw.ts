// Developer-controlled wallets (server-only) — the frictionless "wallet on
// account creation" path. Circle custodies the EOA key (via the entity secret);
// Obol's backend signs on the user's behalf, so non-crypto users never touch a
// key. Provisioning is already proven live (a LIVE Arc EOA was created in the
// wallet set). This module wires it into the app + exposes a BatchEvmSigner so
// the SAME Gateway/x402 pay flow runs through a dev-controlled wallet.
//
// Requires (server env / Secret Manager): CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET,
// OBOL_WALLET_SET_ID. Never expose these to the client.
import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";
import { randomUUID } from "crypto";
import type { Address, Hex } from "viem";

const API_KEY = process.env.CIRCLE_API_KEY;
const ENTITY_SECRET = process.env.CIRCLE_ENTITY_SECRET;
const WALLET_SET_ID = process.env.OBOL_WALLET_SET_ID || "fd87738b-24f2-513e-8be1-5c0a968bac41";

export const isDcwConfigured = Boolean(API_KEY && ENTITY_SECRET);

type DcwClient = ReturnType<typeof initiateDeveloperControlledWalletsClient>;
let _client: DcwClient | null = null;
function client(): DcwClient {
  if (!isDcwConfigured) throw new Error("Dev-controlled wallets not configured (CIRCLE_API_KEY / CIRCLE_ENTITY_SECRET).");
  if (!_client) _client = initiateDeveloperControlledWalletsClient({ apiKey: API_KEY!, entitySecret: ENTITY_SECRET! });
  return _client;
}

export type ProvisionedWallet = { walletId: string; address: Address };

/** Provision a Circle-custodied EOA on Arc testnet for a new account. */
export async function provisionWallet(refId?: string): Promise<ProvisionedWallet> {
  const r = await client().createWallets({
    walletSetId: WALLET_SET_ID,
    // ARC-TESTNET is valid at runtime but missing from the SDK's stale type union.
    blockchains: ["ARC-TESTNET"] as unknown as Parameters<ReturnType<typeof client>["createWallets"]>[0]["blockchains"],
    accountType: "EOA",
    count: 1,
    metadata: refId ? [{ refId }] : undefined,
    idempotencyKey: randomUUID(),
  });
  const w = r?.data?.wallets?.[0];
  if (!w?.id || !w?.address) throw new Error("Wallet provisioning returned no wallet");
  return { walletId: w.id, address: w.address as Address };
}

/**
 * A BatchEvmSigner backed by a Circle dev-controlled wallet. `signTypedData`
 * delegates to Circle's signing API, so this object drops straight into
 * `new BatchEvmScheme(signer)` / `registerBatchScheme(client, { signer })` —
 * the dev-controlled wallet then pays per call through the normal Gateway flow.
 */
// EIP-712 domain field types — Circle's signTypedData needs EIP712Domain
// declared explicitly in `types` (viem-style params omit it).
const EIP712_DOMAIN_FIELDS = [
  { name: "name", type: "string" },
  { name: "version", type: "string" },
  { name: "chainId", type: "uint256" },
  { name: "verifyingContract", type: "address" },
];

export function dcwSigner(walletId: string, address: Address) {
  return {
    address,
    signTypedData: async (params: {
      domain: Record<string, unknown>;
      types: Record<string, unknown>;
      primaryType: string;
      message: Record<string, unknown>;
    }): Promise<Hex> => {
      // Rebuild the full EIP-712 object the way Circle's API expects it:
      // EIP712Domain must be present in `types`, only listing the domain fields
      // actually provided. (Confirmed against Circle's x402 + DCW sample:
      // circleSdk.signTypedData({ walletId, data: JSON.stringify(typedData) }).)
      const domainFields = EIP712_DOMAIN_FIELDS.filter((f) => f.name in params.domain);
      const data = {
        types: { EIP712Domain: domainFields, ...params.types },
        domain: params.domain,
        primaryType: params.primaryType,
        message: params.message,
      };
      // EIP-712 messages carry uint256 values as BigInt — JSON.stringify can't
      // serialize those, so stringify them (Circle's API wants string numerics).
      const json = JSON.stringify(data, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
      const r = await client().signTypedData({ walletId, data: json });
      const sig = r?.data?.signature;
      if (!sig) throw new Error("Circle DCW signTypedData returned no signature");
      return sig as Hex;
    },
  };
}
