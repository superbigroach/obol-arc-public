// ============================================================================
// solana.ts — Solana (Devnet) on-ramp leg for the Obol multi-chain deposit flow.
// ============================================================================
//
// WHY THIS FILE EXISTS
// --------------------
// index.ts already implements the EVM on-ramp: a per-chain Circle-managed wallet
// is handed to the user as a *deposit address*; when USDC arrives, App Kit's
// `kit.bridge()` CCTPs it to the user's Arc EOA, which then deposits into their
// Arc Gateway balance. Solana must fit the SAME shape, but Solana is non-EVM:
//
//   • Circle Wallets on Solana are **EOA only** (no SCA — SCA is ERC-4337-specific).
//   • Gasless is via Circle **Gas Station fee-payer** (sponsors the EOA's SOL /
//     ATA rent), NOT the EVM paymaster/SCA model.
//   • Addresses are base58 (case-sensitive), and USDC is an SPL token held in an
//     Associated Token Account (ATA) that Circle manages under the wallet.
//
// THE KEY FINDING (see docs/solana-integration.md for the full write-up):
//   The SAME `createCircleWalletsAdapter` that index.ts already uses for EVM ALSO
//   covers Solana. Its type doc states it is "a hybrid adapter capable of
//   operating across both EVM and Solana ecosystems using Circle Wallets
//   infrastructure." You do NOT need `@circle-fin/adapter-solana-kit` — that
//   adapter is for @solana/kit private-key / browser-wallet signers, not for
//   Circle-managed (developer-controlled) wallets. So the Solana bridge call is
//   byte-for-byte the EVM call with `chain: "Solana_Devnet"` on the `from` leg.
//
// This module exports the three Solana-specific primitives index.ts needs:
//   provisionSolanaWallet(uid)                        -> deposit address
//   solanaUsdcBalance(address)                        -> SPL USDC balance (number)
//   bridgeSolanaToArc({ solanaAddress, arcEoa, amount }) -> App Kit CCTP to Arc
//
// Heavy imports (@circle-fin/app-kit, adapter-circle-wallets, the DCW SDK) are
// loaded lazily via dynamic import(), exactly like index.ts, so Firebase's
// deploy-time load-analysis of the module graph stays fast.
// ============================================================================

import { defineSecret } from "firebase-functions/params";
import * as admin from "firebase-admin";
import { randomUUID } from "crypto";

// Same secret NAMES index.ts binds — defineSecret is keyed by name, so declaring
// them here is idempotent and lets this module be imported/tested standalone.
// Any function that calls these exports MUST list these secrets in its onCall/
// onSchedule `secrets: [...]` so the values are available at runtime.
const CIRCLE_API_KEY = defineSecret("CIRCLE_TESTNET_API_KEY");
const CIRCLE_ENTITY_SECRET = defineSecret("CIRCLE_ENTITY_SECRET");
// Raw Solana keypair (JSON array of 64 secret-key bytes) that pays the one-time SOL
// rent to create recipients' USDC Associated Token Accounts on withdrawal. This wallet
// ONLY holds a little SOL and can ONLY create ATAs / pay fees — it never touches user
// USDC, so its blast radius is negligible. Address: FpvNg3MmEuHyTPhYkDxAnj1yuJwzKWy57Lwm2YBVpYQc.
const SOLANA_ATA_PAYER_SECRET = defineSecret("SOLANA_ATA_PAYER_SECRET");

// Reuse the same wallet set index.ts provisions into.
const WALLET_SET_ID = "fd87738b-24f2-513e-8be1-5c0a968bac41";
const SOLANA_RPC = "https://api.devnet.solana.com";

// VERIFIED CONFIG (Solana Devnet).
export const SOLANA_BLOCKCHAIN = "SOL-DEVNET"; // Circle Wallets blockchain id (SOL-DEVNET; "SOLANA-DEVNET" is rejected by the API)
export const SOLANA_APPKIT_CHAIN = "Solana_Devnet"; // App Kit `kit.bridge()` chain id
export const ARC_APPKIT_CHAIN = "Arc_Testnet"; // destination (same as index.ts EVM pipeline)
export const SOLANA_USDC_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"; // Devnet USDC SPL mint
export const SOLANA_LABEL = "Solana Devnet";

// firebase-admin is initialized in index.ts; guard so this module is safe if it
// is ever the first thing loaded (e.g. a unit test importing it directly).
function db() {
  if (!admin.apps.length) admin.initializeApp();
  return admin.firestore();
}

// Lazy Circle developer-controlled-wallets client (typed loosely — the DCW SDK's
// per-method typings are narrow; index.ts casts to `any` for the same reason).
async function circleClient(): Promise<any> {
  const { initiateDeveloperControlledWalletsClient } = await import(
    "@circle-fin/developer-controlled-wallets"
  );
  return initiateDeveloperControlledWalletsClient({
    apiKey: CIRCLE_API_KEY.value(),
    entitySecret: CIRCLE_ENTITY_SECRET.value(),
  });
}

// ---------------------------------------------------------------------------
// provisionSolanaWallet — create (or return cached) the user's Solana deposit
// address. Mirrors provisionFundingWallet in index.ts, but forces EOA (Solana
// has no SCA) and the SOLANA-DEVNET blockchain. Stored under the SAME shape the
// EVM pipeline uses: profiles/{uid}.fundingWallets.solana = { scaWalletId,
// scaAddress, ... }. We keep the `sca*` field names ONLY so the existing
// runFundingPipeline / fundingWebhook lookups work unchanged — the wallet is an
// EOA, not an SCA.
// ---------------------------------------------------------------------------
export async function provisionSolanaWallet(uid: string): Promise<{
  chain: "solana";
  depositAddress: string;
  walletId: string;
  label: string;
  cached: boolean;
}> {
  if (!uid) throw new Error("uid required");
  const profRef = db().collection("profiles").doc(uid);
  const prof = (await profRef.get()).data();
  if (!prof?.obolWalletAddress) {
    throw new Error("Provision your Obol wallet first.");
  }

  const existing = prof?.fundingWallets?.solana;
  if (existing?.scaAddress && existing?.scaWalletId) {
    return {
      chain: "solana",
      depositAddress: existing.scaAddress,
      walletId: existing.scaWalletId,
      label: SOLANA_LABEL,
      cached: true,
    };
  }

  const c = await circleClient();
  const res = await c.createWallets({
    walletSetId: WALLET_SET_ID,
    blockchains: [SOLANA_BLOCKCHAIN], // "SOLANA-DEVNET"
    accountType: "EOA", // Solana is EOA-only
    count: 1,
    idempotencyKey: randomUUID(),
  });
  const w = res?.data?.wallets?.[0];
  if (!w?.id || !w?.address) throw new Error("Solana wallet provisioning failed.");

  await profRef.set(
    {
      fundingWallets: {
        solana: {
          scaWalletId: w.id, // field name kept for pipeline/webhook compatibility (it is an EOA)
          scaAddress: w.address,
          accountType: "EOA",
          blockchain: SOLANA_BLOCKCHAIN,
          createdAt: Date.now(),
        },
      },
    },
    { merge: true },
  );

  return { chain: "solana", depositAddress: w.address, walletId: w.id, label: SOLANA_LABEL, cached: false };
}

// ---------------------------------------------------------------------------
// solanaUsdcBalance — read the SPL USDC balance held by the Solana wallet at
// `address`. Circle manages the wallet's USDC Associated Token Account (ATA)
// internally, so we do NOT need @solana/web3.js or to derive the ATA ourselves:
// getWalletTokenBalance returns the already-parsed, human-readable USDC amount
// for the wallet. We resolve the walletId from the address via listWallets so
// the exported signature can stay address-based (matching the EVM balance reads
// in index.ts, which are also address-keyed).
// ---------------------------------------------------------------------------
export async function solanaUsdcBalance(address: string): Promise<number> {
  if (!address) return 0;
  const c = await circleClient();

  // Resolve walletId from the base58 address (case-sensitive — do NOT lowercase).
  const list = await c.listWallets({ blockchain: SOLANA_BLOCKCHAIN, address });
  const wallet = list?.data?.wallets?.[0];
  if (!wallet?.id) return 0;

  // includeAll:true so a zero/near-zero balance is still returned; filter to USDC
  // by its SPL mint address.
  const bal = await c.getWalletTokenBalance({
    id: wallet.id,
    tokenAddresses: [SOLANA_USDC_MINT],
    includeAll: true,
  });
  const rows: Array<{ amount?: string; token?: { tokenAddress?: string; symbol?: string } }> =
    bal?.data?.tokenBalances ?? [];
  const usdc =
    rows.find((r) => r.token?.tokenAddress === SOLANA_USDC_MINT) ??
    rows.find((r) => (r.token?.symbol ?? "").toUpperCase() === "USDC");
  return usdc?.amount ? Number(usdc.amount) : 0;
}

// ---------------------------------------------------------------------------
// bridgeSolanaToArc — CCTP the Solana wallet's USDC to the user's Arc EOA via
// App Kit. This is the EXACT EVM bridge call from index.ts's runFundingPipeline,
// with the source leg's chain set to "Solana_Devnet". The Circle Wallets adapter
// is the SAME hybrid adapter (EVM + Solana); the wallet is selected per-leg by
// its `address`, and the DCW SDK signs + broadcasts the Solana burn.
//
// GASLESS: the Solana-side burn's SOL network fee (and the one-time USDC ATA rent)
// is covered by Circle Gas Station's Solana fee-payer — PROVIDED a Gas Station
// policy for SOLANA-DEVNET is configured in the Circle Console for this wallet
// set. Without a policy the EOA must hold a little SOL (see docs — honest gap #3).
//
// transferSpeed defaults to SLOW for Solana. App Kit's enum is FAST | SLOW ("SLOW"
// = CCTP standard transfer); "STANDARD" is NOT a valid value and errors. Solana↔Arc
// Fast Transfer support on devnet is not confirmed here, and forcing FAST on an
// unsupported route errors (same defensive choice index.ts makes for Polygon/
// Avalanche). Override with FAST if you confirm it's available.
// ---------------------------------------------------------------------------
export async function bridgeSolanaToArc(params: {
  solanaAddress: string;
  arcEoa: string;
  amount: string; // decimal USDC, e.g. "1.50"
  transferSpeed?: "SLOW" | "FAST";
}): Promise<{ ok: true; amount: string; result: unknown }> {
  const { solanaAddress, arcEoa, amount } = params;
  if (!solanaAddress) throw new Error("solanaAddress required");
  if (!arcEoa) throw new Error("arcEoa required");
  if (!amount || Number(amount) <= 0) throw new Error("amount required");

  const { AppKit } = await import("@circle-fin/app-kit");
  const { createCircleWalletsAdapter } = await import("@circle-fin/adapter-circle-wallets");

  const adapter = createCircleWalletsAdapter({
    apiKey: CIRCLE_API_KEY.value(),
    entitySecret: CIRCLE_ENTITY_SECRET.value(),
  });
  const kit = new AppKit();

  const result = await kit.bridge({
    from: { adapter, chain: SOLANA_APPKIT_CHAIN as never, address: solanaAddress },
    to: { adapter, chain: ARC_APPKIT_CHAIN as never, address: arcEoa },
    amount,
    config: { transferSpeed: params.transferSpeed ?? "SLOW" },
  } as never);

  return { ok: true, amount, result };
}

// ---------------------------------------------------------------------------
// ensureSolanaRecipientAta — make Solana withdrawals work for ANY recipient,
// including brand-new addresses that have never held USDC. Solana SPL transfers
// require the recipient to own an Associated Token Account (ATA) for USDC; creating
// one costs a small SOL rent deposit. Circle's Gas Station paymaster refuses ATA
// creation unless the permissioned "Solana ATA sponsorship" feature is enabled
// (PAYMASTER_SOL_ATA_CREATION_NOT_ALLOWED), and Circle-managed wallets can't sign a
// raw web3.js instruction. So we keep a tiny SOL-funded payer keypair (secret in
// SOLANA_ATA_PAYER_SECRET) and use it to create the recipient's ATA idempotently
// BEFORE the Circle SPL transfer runs. Idempotent = a no-op if the ATA already exists.
// Any caller MUST bind SOLANA_ATA_PAYER_SECRET in its `secrets: [...]`.
// ---------------------------------------------------------------------------
export async function ensureSolanaRecipientAta(recipient: string): Promise<void> {
  const { Connection, Keypair, PublicKey, Transaction } = await import("@solana/web3.js");
  const { getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction } = await import("@solana/spl-token");
  const secret = JSON.parse(SOLANA_ATA_PAYER_SECRET.value()) as number[];
  const payer = Keypair.fromSecretKey(Uint8Array.from(secret));
  const conn = new Connection(SOLANA_RPC, "confirmed");
  const owner = new PublicKey(recipient);
  const mint = new PublicKey(SOLANA_USDC_MINT);
  const ata = getAssociatedTokenAddressSync(mint, owner, true);
  const info = await conn.getAccountInfo(ata);
  if (info) return; // ATA already exists — nothing to do
  const ix = createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, ata, owner, mint);
  const tx = new Transaction().add(ix);
  tx.feePayer = payer.publicKey;
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.sign(payer);
  const sig = await conn.sendRawTransaction(tx.serialize());
  await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
}
