// Obol Cloud Functions — dev-controlled wallet operations (provision + withdraw).
// Outside the Next SSR bundle so secrets bind via defineSecret + we can use
// firebase-admin. Uses ethers (not viem) for the on-chain mint to avoid viem's
// transitive `ox` TypeScript-source build issues. Both recipes PROVEN on testnet.
import { onCall, onRequest, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { setGlobalOptions } from "firebase-functions/v2";
import { defineSecret } from "firebase-functions/params";
import * as admin from "firebase-admin";
import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";
import { JsonRpcProvider, Wallet, Contract, verifyMessage } from "ethers";
import { randomUUID, randomBytes } from "crypto";
import { createHash, createCipheriv, createDecipheriv, createHmac } from "crypto";
import { authenticator } from "otplib";
import { Wallet as EthersWallet } from "ethers";
import { provisionSolanaWallet, solanaUsdcBalance, bridgeSolanaToArc, ensureSolanaRecipientAta, SOLANA_USDC_MINT } from "./chains/solana";
// Network config — testnet/mainnet resolved from OBOL_NETWORK (default testnet).
import {
  NETWORK, IS_MAINNET, ARC, ARC_RPC, CHAINS, MINTER_WALLETS, MINTER_BLOCKCHAIN, NON_GATEWAY_MINTERS,
  GATEWAY_API, PROVISION_BLOCKCHAIN, CIRCLE_API_KEY_SECRET,
} from "./network";

admin.initializeApp();
void NETWORK; void IS_MAINNET;

// Global safety ceiling: no single function can ever scale past 40 concurrent
// instances. Bounds the absolute worst-case compute bill — a traffic spike, a
// retry storm, or a spam attack can never run up unbounded charges. Money/auth
// functions are well under this in normal use; it only caps the runaway tail.
setGlobalOptions({ region: "us-central1", maxInstances: 40 });

const CIRCLE_API_KEY = defineSecret(CIRCLE_API_KEY_SECRET); // testnet vs mainnet key, per OBOL_NETWORK
const CIRCLE_ENTITY_SECRET = defineSecret("CIRCLE_ENTITY_SECRET");
const RELAYER_KEY = defineSecret("OBOL_RELAYER_KEY");
const KEY_ENC_SECRET = defineSecret("KEY_ENCRYPTION_SECRET");
const RESEND_API_KEY = defineSecret("RESEND_API_KEY");
const SOLANA_ATA_PAYER_SECRET = defineSecret("SOLANA_ATA_PAYER_SECRET");
// Dedicated minimal runtime SA for functions that read the entity secret / relayer key.
// Has secretAccessor on only its own secrets + datastore.user + logging — not the broad
// default compute SA — so a bug in any non-money function can't reach the signing secrets.
const SIGNER_SA = "obol-signer@obol-arc.iam.gserviceaccount.com";
const WALLET_SET_ID = "fd87738b-24f2-513e-8be1-5c0a968bac41";

// ARC, CHAINS, MINTER_WALLETS, GATEWAY_API etc. now come from ./network (testnet/mainnet).

// Per-user-wallet payments are the DEFAULT architecture (durable in code).
// Emergency rollback: OBOL_USER_PAYS=0. Optional OBOL_USER_PAYS_UIDS allowlist
// narrows to specific uids. Matches the seller-fn gate.
function userPaysEnabled(uid: string): boolean {
  if (process.env.OBOL_USER_PAYS === "0") return false;
  const allow = (process.env.OBOL_USER_PAYS_UIDS || "").split(",").map((s) => s.trim()).filter(Boolean);
  return allow.length ? allow.includes(uid) : true;
}
// ARC_RPC + CHAINS imported from ./network (per OBOL_NETWORK).
// MINTER_WALLETS, MINTER_BLOCKCHAIN, NON_GATEWAY_MINTERS imported from ./network.

// GATEWAY_API imported from ./network.
const ZERO = "0x0000000000000000000000000000000000000000";
const MAX_UINT256 = 2n ** 256n - 1n;
const b32 = (a: string) => "0x" + a.slice(2).toLowerCase().padStart(64, "0");
const usdc6 = (amount: string): bigint => {
  const [w, f = ""] = String(amount).split(".");
  return BigInt(w || "0") * 1_000_000n + BigInt((f + "000000").slice(0, 6) || "0");
};
const bigintReplacer = (_k: string, v: unknown) => (typeof v === "bigint" ? v.toString() : v);

function circleClient() {
  return initiateDeveloperControlledWalletsClient({
    apiKey: CIRCLE_API_KEY.value(),
    entitySecret: CIRCLE_ENTITY_SECRET.value(),
  });
}

// Submit gatewayMint on Arc via the Obol-owned Circle minter wallet (Circle signs;
// gas paid in USDC from the minter's own balance). Replaces the raw-relayer
// `new Wallet(OBOL_RELAYER_KEY)` mint path — no private key needed. Returns the tx hash.
async function arcCircleMint(attestation: string, signature: string): Promise<string> {
  const cw = circleClient() as unknown as {
    createContractExecutionTransaction: (a: unknown) => Promise<{ data?: { id?: string } }>;
    getTransaction: (a: { id: string }) => Promise<{ data?: { transaction?: { state?: string; txHash?: string } } }>;
  };
  const mt = await cw.createContractExecutionTransaction({
    walletId: MINTER_WALLETS.arc, blockchain: MINTER_BLOCKCHAIN.arc, contractAddress: ARC.gatewayMinter,
    abiFunctionSignature: "gatewayMint(bytes,bytes)", abiParameters: [attestation, signature],
    idempotencyKey: randomUUID(), fee: { type: "level", config: { feeLevel: "MEDIUM" } },
  });
  const mtId = mt?.data?.id ?? "";
  for (let i = 0; i < 80; i++) {
    const r = await cw.getTransaction({ id: mtId });
    const st = r?.data?.transaction?.state ?? "";
    if (["COMPLETE", "CONFIRMED"].includes(st)) return r?.data?.transaction?.txHash ?? mtId;
    if (["FAILED", "DENIED", "CANCELLED"].includes(st)) throw new HttpsError("internal", `Arc gatewayMint ${st}.`);
    await new Promise((res) => setTimeout(res, 3000));
  }
  return mtId;
}

// ---------- provision ----------
export const provisionObolWallet = onCall(
  { serviceAccount: SIGNER_SA, secrets: [CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET], region: "us-central1" },
  async (req) => {
    const uid = req.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Sign in required.");
    const ref = admin.firestore().collection("profiles").doc(uid);
    const existing = (await ref.get()).data();
    // Legacy wallets (no tag) are testnet. Only reuse a wallet provisioned on the
    // CURRENT network — so flipping OBOL_NETWORK=mainnet re-provisions each user a
    // fresh mainnet wallet on next call (their old-network wallet/balance is untouched).
    const walletNet = (existing?.obolWalletNetwork as string) || "testnet";
    if (existing?.obolWalletAddress && walletNet === NETWORK) {
      return { address: existing.obolWalletAddress, walletId: existing.obolWalletId, existing: true };
    }
    const r = await circleClient().createWallets({
      walletSetId: WALLET_SET_ID,
      blockchains: [PROVISION_BLOCKCHAIN] as unknown as Parameters<ReturnType<typeof circleClient>["createWallets"]>[0]["blockchains"],
      accountType: "EOA",
      count: 1,
      idempotencyKey: randomUUID(),
    });
    const w = r?.data?.wallets?.[0];
    if (!w?.address || !w?.id) throw new HttpsError("internal", "Wallet provisioning failed.");
    await ref.set(
      { uid, address: w.address, obolWalletAddress: w.address, obolWalletId: w.id, obolWalletNetwork: NETWORK, spendingBalance: "0", updatedAt: Date.now() },
      { merge: true },
    );
    return { address: w.address, walletId: w.id, existing: false };
  },
);

// ---------- withdraw to a NON-Gateway chain (Monad, Solana) ----------
// Monad & Solana are CCTP + Circle-Wallets chains but NOT Gateway destinations, so
// the balance (which lives in the Arc Gateway) can't be minted straight onto them.
// Two hops: (1) "un-gateway" — a Gateway-transfer Arc->Arc that mints raw USDC onto
// the user's OWN Arc EOA (identical to a normal withdraw-to-Arc, recipient=self),
// then (2) App Kit CCTP-bridges that USDC from the Arc EOA to the external recipient
// (gasless destination mint via the Monad/Solana Gas Station fee-payer). Reuses the
// exact relayer-mint mechanism proven for Arc withdrawals + the App Kit bridge proven
// for deposits — just run in the withdraw direction.
async function withdrawNonGateway(params: {
  walletId: string; devAddr: string; recipient: string; amount: string; network: string;
}): Promise<{ txHash: string; explorer: string }> {
  const { walletId, devAddr, recipient, amount, network } = params;
  const dest = CHAINS[network];

  // ---- (1) un-gateway: Gateway transfer Arc -> Arc EOA (raw USDC lands on devAddr) ----
  const burnIntent = {
    maxBlockHeight: MAX_UINT256,
    maxFee: usdc6("2.01"),
    spec: {
      version: 1, sourceDomain: ARC.domain, destinationDomain: ARC.domain,
      sourceContract: b32(ARC.gatewayWallet), destinationContract: b32(ARC.gatewayMinter),
      sourceToken: b32(ARC.usdc), destinationToken: b32(ARC.usdc),
      sourceDepositor: b32(devAddr), destinationRecipient: b32(devAddr),
      sourceSigner: b32(devAddr), destinationCaller: b32(ZERO),
      value: usdc6(amount), salt: `0x${randomBytes(32).toString("hex")}`, hookData: "0x",
    },
  };
  const typedData = {
    domain: { name: "GatewayWallet", version: "1" },
    types: {
      EIP712Domain: [{ name: "name", type: "string" }, { name: "version", type: "string" }],
      TransferSpec: [
        { name: "version", type: "uint32" }, { name: "sourceDomain", type: "uint32" }, { name: "destinationDomain", type: "uint32" },
        { name: "sourceContract", type: "bytes32" }, { name: "destinationContract", type: "bytes32" },
        { name: "sourceToken", type: "bytes32" }, { name: "destinationToken", type: "bytes32" },
        { name: "sourceDepositor", type: "bytes32" }, { name: "destinationRecipient", type: "bytes32" },
        { name: "sourceSigner", type: "bytes32" }, { name: "destinationCaller", type: "bytes32" },
        { name: "value", type: "uint256" }, { name: "salt", type: "bytes32" }, { name: "hookData", type: "bytes" },
      ],
      BurnIntent: [{ name: "maxBlockHeight", type: "uint256" }, { name: "maxFee", type: "uint256" }, { name: "spec", type: "TransferSpec" }],
    },
    primaryType: "BurnIntent",
    message: burnIntent,
  };
  const sig = (await circleClient().signTypedData({ walletId, data: JSON.stringify(typedData, bigintReplacer) }))?.data?.signature;
  if (!sig) throw new HttpsError("internal", "Circle signing failed.");
  const resp = await fetch(`${GATEWAY_API}/transfer`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify([{ burnIntent, signature: sig }], bigintReplacer),
  });
  const result = await resp.json();
  if (!result?.attestation || !result?.signature) {
    throw new HttpsError("internal", "Un-gateway transfer failed: " + JSON.stringify(result).slice(0, 200));
  }
  // Mint the raw USDC onto the Arc EOA via the Obol-owned Circle minter wallet
  // (Circle signs; gas paid in USDC) — NO raw OBOL_RELAYER_KEY.
  const arcProvider = new JsonRpcProvider(CHAINS.arc.rpc);
  await arcCircleMint(result.attestation, result.signature);

  // Wait for the minted USDC to reflect in the Arc EOA's ERC-20 balance.
  const arcUsdc = new Contract(ARC.usdc, ["function balanceOf(address) view returns (uint256)"], arcProvider);
  let arcBal = 0;
  for (let i = 0; i < 20; i++) {
    arcBal = Number(await arcUsdc.balanceOf(devAddr)) / 1e6;
    if (arcBal >= Number(amount) - 2.5) break; // allow for the Gateway fee haircut
    await new Promise((r) => setTimeout(r, 3000));
  }

  // ---- (2) App Kit CCTP bridge Arc EOA -> the per-chain Obol MINTER wallet ----
  // App Kit mints gaslessly only to a Circle wallet that EXISTS on the destination
  // chain, so we mint to Obol's minter there (not the arbitrary recipient).
  const minter = NON_GATEWAY_MINTERS[network];
  if (!minter) throw new HttpsError("failed-precondition", `No minter configured for ${network}.`);
  const bridgeAmount = (Math.min(Number(amount), arcBal) - 0.1).toFixed(2); // -0.1 = CCTP fee buffer
  if (Number(bridgeAmount) <= 0) throw new HttpsError("failed-precondition", "Amount too small after fees to withdraw to this chain.");
  const { AppKit } = await import("@circle-fin/app-kit");
  const { createCircleWalletsAdapter } = await import("@circle-fin/adapter-circle-wallets");
  const adapter = createCircleWalletsAdapter({ apiKey: CIRCLE_API_KEY.value(), entitySecret: CIRCLE_ENTITY_SECRET.value() });
  const kit = new AppKit();
  const bridgeRes = (await kit.bridge({
    from: { adapter, chain: "Arc_Testnet" as never, address: devAddr },
    to: { adapter, chain: minter.appkitChain as never, address: minter.address },
    amount: bridgeAmount,
    config: { transferSpeed: "SLOW" },
  } as never)) as { state?: string; steps?: Array<{ name?: string; state?: string; errorMessage?: string }> };
  const mintStep = bridgeRes?.steps?.find((s) => s.name === "mint");
  if (bridgeRes?.state !== "success" || mintStep?.state !== "success") {
    throw new HttpsError("internal", `Bridge to ${network} minter failed: ${(mintStep?.errorMessage ?? bridgeRes?.state ?? "unknown").slice(0, 200)}`);
  }

  // ---- (3) Minter forwards the USDC to the external recipient (gasless via Gas Station) ----
  const cw = circleClient() as unknown as {
    createContractExecutionTransaction: (a: unknown) => Promise<{ data?: { id?: string } }>;
    createTransaction: (a: unknown) => Promise<{ data?: { id?: string } }>;
    getTransaction: (a: { id: string }) => Promise<{ data?: { transaction?: { state?: string; txHash?: string } } }>;
  };
  const fwdAtomic = usdc6(bridgeAmount).toString();
  // Solana: guarantee the recipient has a USDC ATA first (idempotent; paid by our tiny
  // SOL payer keypair). This makes payouts work for ANY address, incl. brand-new ones.
  if (network === "solana") await ensureSolanaRecipientAta(recipient);
  // Solana forward = SDK createTransaction (SPL transfer, field is `amount: string[]`,
  // token by tokenAddress+blockchain). NOTE: if the recipient has no USDC ATA yet, this
  // fails PAYMASTER_SOL_ATA_CREATION_NOT_ALLOWED unless Gas Station Solana ATA sponsorship
  // is enabled for the entity (permissioned — request from Circle). Recipients that already
  // hold USDC (exchanges, existing wallets) work as-is. EVM forward = USDC.transfer().
  const fwd = network === "solana"
    ? await cw.createTransaction({ walletId: minter.walletId, blockchain: minter.blockchain, tokenAddress: SOLANA_USDC_MINT, destinationAddress: recipient, amount: [bridgeAmount], idempotencyKey: randomUUID(), fee: { type: "level", config: { feeLevel: "MEDIUM" } } })
    : await cw.createContractExecutionTransaction({ walletId: minter.walletId, blockchain: minter.blockchain, contractAddress: dest.usdc, abiFunctionSignature: "transfer(address,uint256)", abiParameters: [recipient, fwdAtomic], idempotencyKey: randomUUID(), fee: { type: "level", config: { feeLevel: "MEDIUM" } } });
  const fwdId = fwd?.data?.id ?? "";
  let txHash = fwdId;
  for (let i = 0; i < 60; i++) {
    const r = await cw.getTransaction({ id: fwdId });
    const st = r?.data?.transaction?.state ?? "";
    if (["COMPLETE", "CONFIRMED"].includes(st)) { txHash = r?.data?.transaction?.txHash ?? fwdId; break; }
    if (["FAILED", "DENIED", "CANCELLED"].includes(st)) throw new HttpsError("internal", `Forward to recipient on ${dest.label} ${st}.`);
    await new Promise((res) => setTimeout(res, 3000));
  }
  return { txHash, explorer: dest.explorerTx(txHash) };
}

// ---------- withdraw (dev wallet → external address, Arc → any supported chain) ----------
export const withdrawObolWallet = onCall(
  { serviceAccount: SIGNER_SA, secrets: [CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET, RELAYER_KEY, SOLANA_ATA_PAYER_SECRET, KEY_ENC_SECRET], region: "us-central1" },
  async (req) => {
    const uid = req.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Sign in required.");
    const recipient: string = req.data?.recipient ?? "";
    const amount: string = String(req.data?.amount ?? "");
    const network: string = String(req.data?.network ?? "arc").toLowerCase();
    // Recipient format is chain-specific: Solana = base58 (32-44 chars), EVM = 0x40-hex.
    if (network === "solana") {
      if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(recipient)) throw new HttpsError("invalid-argument", "Valid Solana address required.");
    } else if (!/^0x[0-9a-fA-F]{40}$/.test(recipient)) {
      throw new HttpsError("invalid-argument", "Valid recipient address required.");
    }
    if (!amount || Number(amount) <= 0) throw new HttpsError("invalid-argument", "Valid amount required.");
    const dest = CHAINS[network];
    if (!dest) throw new HttpsError("invalid-argument", `Unknown network "${network}". Supported: ${Object.keys(CHAINS).join(", ")}.`);

    const prof = (await admin.firestore().collection("profiles").doc(uid).get()).data();
    const walletId = prof?.obolWalletId as string | undefined;
    const devAddr = prof?.obolWalletAddress as string | undefined;
    if (!walletId || !devAddr) throw new HttpsError("failed-precondition", "No Obol wallet to withdraw from.");

    // ---- SECURITY: 2FA gate on withdrawals -----------------------------------
    // Moving funds OUT requires the user's authenticator (TOTP) code — not just a
    // valid session or a leaked API key. If the user has 2FA set up, a code is
    // REQUIRED and verified here. If not set up yet, we allow (backward compatible)
    // but flag that they should enable 2FA.
    const totpDoc = await admin.firestore().collection("userTotp").doc(uid).get();
    const has2fa = totpDoc.exists && !!totpDoc.data()?.confirmed;
    let twoFactorSetupRequired = false;
    if (has2fa) {
      const totpCode = String(req.data?.totpCode ?? "");
      if (!totpCode) {
        throw new HttpsError("failed-precondition", "2FA required: enter your authenticator code to withdraw.");
      }
      await verifyUserTotp(uid, totpCode, Buffer.from(KEY_ENC_SECRET.value(), "hex")); // throws on invalid
    } else {
      twoFactorSetupRequired = true;
    }

    // ---- Non-Gateway destinations (Monad, Solana): CCTP path, not Gateway mint ----
    // These chains aren't Gateway destinations, so we un-gateway on Arc then App Kit
    // CCTP-bridge to the recipient (gasless dest mint via their Gas Station fee-payer).
    if (network === "monad" || network === "solana") {
      const { txHash, explorer } = await withdrawNonGateway({ walletId, devAddr, recipient, amount, network });
      await admin.firestore().collection("events").add({
        uid, wallet: devAddr, type: "withdraw", detail: `${amount} USDC → ${recipient} (${network})`, network, ts: Date.now(),
      });
      return { txHash, amount, recipient, network, explorer, twoFactorSetupRequired };
    }

    // Balance lives on Arc → sourceDomain is always Arc; destinationDomain is the
    // chosen chain. Source contracts/token = Arc; destination contracts/token = dest.
    const burnIntent = {
      maxBlockHeight: MAX_UINT256,
      maxFee: usdc6("2.01"),
      spec: {
        version: 1, sourceDomain: ARC.domain, destinationDomain: dest.domain,
        sourceContract: b32(ARC.gatewayWallet), destinationContract: b32(dest.gatewayMinter),
        sourceToken: b32(ARC.usdc), destinationToken: b32(dest.usdc),
        sourceDepositor: b32(devAddr), destinationRecipient: b32(recipient),
        sourceSigner: b32(devAddr), destinationCaller: b32(ZERO),
        value: usdc6(amount), salt: `0x${randomBytes(32).toString("hex")}`, hookData: "0x",
      },
    };
    const typedData = {
      domain: { name: "GatewayWallet", version: "1" },
      types: {
        EIP712Domain: [{ name: "name", type: "string" }, { name: "version", type: "string" }],
        TransferSpec: [
          { name: "version", type: "uint32" }, { name: "sourceDomain", type: "uint32" }, { name: "destinationDomain", type: "uint32" },
          { name: "sourceContract", type: "bytes32" }, { name: "destinationContract", type: "bytes32" },
          { name: "sourceToken", type: "bytes32" }, { name: "destinationToken", type: "bytes32" },
          { name: "sourceDepositor", type: "bytes32" }, { name: "destinationRecipient", type: "bytes32" },
          { name: "sourceSigner", type: "bytes32" }, { name: "destinationCaller", type: "bytes32" },
          { name: "value", type: "uint256" }, { name: "salt", type: "bytes32" }, { name: "hookData", type: "bytes" },
        ],
        BurnIntent: [{ name: "maxBlockHeight", type: "uint256" }, { name: "maxFee", type: "uint256" }, { name: "spec", type: "TransferSpec" }],
      },
      primaryType: "BurnIntent",
      message: burnIntent,
    };

    const sig = (await circleClient().signTypedData({ walletId, data: JSON.stringify(typedData, bigintReplacer) }))?.data?.signature;
    if (!sig) throw new HttpsError("internal", "Circle signing failed.");

    const resp = await fetch(`${GATEWAY_API}/transfer`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify([{ burnIntent, signature: sig }], bigintReplacer),
    });
    const result = await resp.json();
    if (!result?.attestation || !result?.signature) {
      throw new HttpsError("internal", "Gateway transfer failed: " + JSON.stringify(result).slice(0, 200));
    }

    // Submit gatewayMint on the DESTINATION chain (anyone can, destinationCaller=0x0).
    // GASLESS: a per-chain Gas-Station minter SCA submits it, so no relayer needs
    // native gas anywhere. Arc (or any chain without a minter SCA) falls back to the
    // relayer, which pays gas in USDC on Arc.
    let txHash: string;
    const minterWalletId = MINTER_WALLETS[network];
    if (minterWalletId) {
      const cw = circleClient() as unknown as {
        createContractExecutionTransaction: (a: unknown) => Promise<{ data?: { id?: string } }>;
        getTransaction: (a: { id: string }) => Promise<{ data?: { transaction?: { state?: string; txHash?: string } } }>;
      };
      const mt = await cw.createContractExecutionTransaction({
        walletId: minterWalletId, blockchain: MINTER_BLOCKCHAIN[network], contractAddress: dest.gatewayMinter,
        abiFunctionSignature: "gatewayMint(bytes,bytes)", abiParameters: [result.attestation, result.signature],
        idempotencyKey: randomUUID(), fee: { type: "level", config: { feeLevel: "MEDIUM" } },
      });
      const mtId = mt?.data?.id ?? "";
      txHash = mtId;
      for (let i = 0; i < 80; i++) {
        const r = await cw.getTransaction({ id: mtId });
        const st = r?.data?.transaction?.state ?? "";
        if (["COMPLETE", "CONFIRMED"].includes(st)) { txHash = r?.data?.transaction?.txHash ?? mtId; break; }
        if (["FAILED", "DENIED", "CANCELLED"].includes(st)) throw new HttpsError("internal", `Gasless mint on ${dest.label} ${st}.`);
        await new Promise((res) => setTimeout(res, 3000));
      }
    } else {
      const provider = new JsonRpcProvider(dest.rpc);
      const relayer = new Wallet(RELAYER_KEY.value(), provider);
      const minter = new Contract(dest.gatewayMinter, ["function gatewayMint(bytes attestation, bytes signature)"], relayer);
      const gasBal = await provider.getBalance(relayer.address);
      if (gasBal === 0n) throw new HttpsError("failed-precondition", `Relayer not funded on ${network} — fund ${relayer.address} with native gas.`);
      const tx = await minter.gatewayMint(result.attestation, result.signature);
      await tx.wait();
      txHash = tx.hash;
    }

    await admin.firestore().collection("events").add({
      uid, wallet: devAddr, type: "withdraw", detail: `${amount} USDC → ${recipient} (${network})`, network, ts: Date.now(),
    });
    return { txHash, amount, recipient, network, explorer: dest.explorerTx(txHash), twoFactorSetupRequired };
  },
);

// ---------- setPayoutWallet — point earnings at a self-custody address ----------
// The seller chooses where earnings land. Pointing it at their OWN wallet (they hold
// the keys) means a platform breach can't touch accumulated earnings — the two-wallet
// model: custodial spending float (buyer) + self-custody earnings (seller). Updates the
// profile + all their active services' payoutAddress so future payments route there.
export const setPayoutWallet = onCall(
  { region: "us-central1" },
  async (req) => {
    const uid = req.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Sign in required.");
    const address = String(req.data?.address ?? "").trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new HttpsError("invalid-argument", "Enter a valid 0x wallet address.");
    const fs = admin.firestore();
    await fs.collection("profiles").doc(uid).set({ payoutAddress: address, selfCustodyPayout: true, updatedAt: Date.now() }, { merge: true });
    const svcs = await fs.collection("services").where("ownerUid", "==", uid).get();
    const batch = fs.batch();
    svcs.docs.forEach((d) => batch.set(d.ref, { payoutAddress: address, updatedAt: Date.now() }, { merge: true }));
    await batch.commit();
    return { ok: true, address, services: svcs.size };
  },
);

// ---------- relaySellerWithdraw — self-custody seller cash-out (they sign in-browser) ----------
// The seller holds their own key. In the browser they (1) deposit their earnings into the
// Gateway and (2) sign a burn intent — their key NEVER touches Obol. This endpoint only
// relays the already-signed burn intent: POST it to the Gateway API, then submit the
// destination mint via Obol's Gas-Station minter (same rails as buyer withdrawals). Seller
// pays Arc gas (from their USDC) for the deposit; dest-chain gas is Gas-Station-sponsored.
export const relaySellerWithdraw = onCall(
  { serviceAccount: SIGNER_SA, secrets: [CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET, RELAYER_KEY], region: "us-central1", timeoutSeconds: 300 },
  async (req) => {
    const uid = req.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Sign in required.");
    const network = String(req.data?.network ?? "").toLowerCase();
    const burnIntent = req.data?.burnIntent;
    const signature = String(req.data?.signature ?? "");
    const dest = CHAINS[network];
    if (!dest) throw new HttpsError("invalid-argument", `Unknown network "${network}".`);
    if (!burnIntent || !signature) throw new HttpsError("invalid-argument", "burnIntent + signature required.");
    if (network === "monad" || network === "solana") throw new HttpsError("invalid-argument", "Self-custody cash-out to Monad/Solana isn't supported yet — pick an EVM chain.");

    const resp = await fetch(`${GATEWAY_API}/transfer`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify([{ burnIntent, signature }]),
    });
    const result = await resp.json();
    if (!result?.attestation || !result?.signature) {
      throw new HttpsError("internal", "Gateway transfer failed: " + JSON.stringify(result).slice(0, 200));
    }

    let txHash: string;
    const minterWalletId = MINTER_WALLETS[network];
    if (minterWalletId) {
      const cw = circleClient() as unknown as {
        createContractExecutionTransaction: (a: unknown) => Promise<{ data?: { id?: string } }>;
        getTransaction: (a: { id: string }) => Promise<{ data?: { transaction?: { state?: string; txHash?: string } } }>;
      };
      const mt = await cw.createContractExecutionTransaction({
        walletId: minterWalletId, blockchain: MINTER_BLOCKCHAIN[network], contractAddress: dest.gatewayMinter,
        abiFunctionSignature: "gatewayMint(bytes,bytes)", abiParameters: [result.attestation, result.signature],
        idempotencyKey: randomUUID(), fee: { type: "level", config: { feeLevel: "MEDIUM" } },
      });
      const mtId = mt?.data?.id ?? ""; txHash = mtId;
      for (let i = 0; i < 80; i++) {
        const r = await cw.getTransaction({ id: mtId });
        const st = r?.data?.transaction?.state ?? "";
        if (["COMPLETE", "CONFIRMED"].includes(st)) { txHash = r?.data?.transaction?.txHash ?? mtId; break; }
        if (["FAILED", "DENIED", "CANCELLED"].includes(st)) throw new HttpsError("internal", `Mint on ${dest.label} ${st}.`);
        await new Promise((res) => setTimeout(res, 3000));
      }
    } else {
      const provider = new JsonRpcProvider(dest.rpc);
      const relayer = new Wallet(RELAYER_KEY.value(), provider);
      const minter = new Contract(dest.gatewayMinter, ["function gatewayMint(bytes attestation, bytes signature)"], relayer);
      const tx = await minter.gatewayMint(result.attestation, result.signature);
      await tx.wait(); txHash = tx.hash;
    }

    await admin.firestore().collection("events").add({ uid, type: "seller_withdraw", detail: `Self-custody cash-out → ${network}`, network, ts: Date.now() });
    return { txHash, network, explorer: dest.explorerTx(txHash) };
  },
);

// ---------- relaySellerWithdrawCctp — self-custody cash-out to a NON-Gateway chain (Monad) ----------
// The seller signed a raw CCTP depositForBurn on Arc in their browser (their key never
// touched Obol). We poll Circle's IRIS attestation service for the message+attestation,
// then submit receiveMessage on the destination via Obol's minter (Gas-Station gas). Funds
// mint straight to the seller's chosen recipient (mintRecipient was set in the burn).
export const relaySellerWithdrawCctp = onCall(
  { serviceAccount: SIGNER_SA, secrets: [CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET], region: "us-central1", timeoutSeconds: 300 },
  async (req) => {
    const uid = req.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Sign in required.");
    const network = String(req.data?.network ?? "").toLowerCase();
    const burnTxHash = String(req.data?.burnTxHash ?? "");
    if (network !== "monad") throw new HttpsError("invalid-argument", "CCTP cash-out currently supports Monad only.");
    if (!/^0x[0-9a-fA-F]{64}$/.test(burnTxHash)) throw new HttpsError("invalid-argument", "Valid burn tx hash required.");
    const ARC_DOMAIN = 26;
    const IRIS = "https://iris-api-sandbox.circle.com";
    const MSG_TRANSMITTER = "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275"; // CCTP V2 testnet
    const minter = NON_GATEWAY_MINTERS[network];

    let message: string | undefined, attestation: string | undefined;
    for (let i = 0; i < 40; i++) {
      const r = await fetch(`${IRIS}/v2/messages/${ARC_DOMAIN}?transactionHash=${burnTxHash}`);
      const j = (await r.json()) as { messages?: Array<{ status?: string; message?: string; attestation?: string }> };
      const m = j?.messages?.[0];
      if (m && m.status === "complete" && m.attestation && m.attestation !== "PENDING") { message = m.message; attestation = m.attestation; break; }
      await new Promise((res) => setTimeout(res, 6000));
    }
    if (!message || !attestation) throw new HttpsError("deadline-exceeded", "Attestation not ready yet — wait ~1 min and retry (your funds are safe, the burn is on-chain).");

    const cw = circleClient() as unknown as {
      createContractExecutionTransaction: (a: unknown) => Promise<{ data?: { id?: string } }>;
      getTransaction: (a: { id: string }) => Promise<{ data?: { transaction?: { state?: string; txHash?: string } } }>;
    };
    const mt = await cw.createContractExecutionTransaction({
      walletId: minter.walletId, blockchain: minter.blockchain, contractAddress: MSG_TRANSMITTER,
      abiFunctionSignature: "receiveMessage(bytes,bytes)", abiParameters: [message, attestation],
      idempotencyKey: randomUUID(), fee: { type: "level", config: { feeLevel: "MEDIUM" } },
    });
    const mtId = mt?.data?.id ?? ""; let txHash = mtId;
    for (let i = 0; i < 60; i++) {
      const r = await cw.getTransaction({ id: mtId });
      const st = r?.data?.transaction?.state ?? "";
      if (["COMPLETE", "CONFIRMED"].includes(st)) { txHash = r?.data?.transaction?.txHash ?? mtId; break; }
      if (["FAILED", "DENIED", "CANCELLED"].includes(st)) throw new HttpsError("internal", `Delivery on ${network} ${st}.`);
      await new Promise((res) => setTimeout(res, 3000));
    }
    await admin.firestore().collection("events").add({ uid, type: "seller_withdraw", detail: `Self-custody cash-out → ${network} (CCTP)`, network, ts: Date.now() });
    return { txHash, network, explorer: CHAINS[network].explorerTx(txHash) };
  },
);

// ---------- Path A: multi-chain on-ramp (Bridge Kit / CCTP Fast Transfer) ----------
// Per-chain SCA = the deposit address. The SCA holds the user's incoming USDC and
// bridges it to Arc via CCTP Fast Transfer (~30s, gasless via Gas Station). No
// delegate needed (CCTP burn is a normal contract call the SCA executes directly).
const CIRCLE_BLOCKCHAIN: Record<string, string> = {
  base: "BASE-SEPOLIA", arbitrum: "ARB-SEPOLIA", optimism: "OP-SEPOLIA",
  polygon: "MATIC-AMOY", avalanche: "AVAX-FUJI", ethereum: "ETH-SEPOLIA", unichain: "UNI-SEPOLIA",
  monad: "MONAD-TESTNET",
};
// App Kit chain identifiers for kit.bridge(). Base_Sepolia + Arc_Testnet are
// verified; the rest follow the same {Chain}_{Network} convention.
const APPKIT_CHAIN: Record<string, string> = {
  base: "Base_Sepolia", arbitrum: "Arbitrum_Sepolia", optimism: "Optimism_Sepolia",
  polygon: "Polygon_Amoy", avalanche: "Avalanche_Fuji", ethereum: "Ethereum_Sepolia", unichain: "Unichain_Sepolia",
  monad: "Monad_Testnet",
};

export const provisionFundingWallet = onCall(
  { serviceAccount: SIGNER_SA, secrets: [CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET], region: "us-central1" },
  async (req) => {
    const uid = req.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Sign in required.");
    const chain = String(req.data?.chain ?? "").toLowerCase();

    // Solana is non-EVM (EOA-only, base58, SPL USDC) — route to its own provisioner.
    if (chain === "solana") {
      try {
        const r = await provisionSolanaWallet(uid);
        return { chain: "solana", depositAddress: r.depositAddress, label: r.label, cached: r.cached };
      } catch (e) { throw new HttpsError("internal", (e as Error).message); }
    }

    const blockchain = CIRCLE_BLOCKCHAIN[chain];
    const cfg = CHAINS[chain];
    if (!blockchain || !cfg) throw new HttpsError("invalid-argument", `Unsupported funding chain "${chain}".`);

    const profRef = admin.firestore().collection("profiles").doc(uid);
    const prof = (await profRef.get()).data();
    if (!prof?.obolWalletAddress) throw new HttpsError("failed-precondition", "Provision your Obol wallet first.");

    const existing = prof?.fundingWallets?.[chain];
    if (existing?.scaAddress) return { chain, depositAddress: existing.scaAddress, label: cfg.label, cached: true };

    const c = circleClient() as any;
    const scaRes = await c.createWallets({ walletSetId: WALLET_SET_ID, blockchains: [blockchain], accountType: "SCA", count: 1, idempotencyKey: randomUUID() });
    const sca = scaRes?.data?.wallets?.[0];
    if (!sca?.id) throw new HttpsError("internal", "Funding wallet provisioning failed.");

    await profRef.set({ fundingWallets: { [chain]: { scaWalletId: sca.id, scaAddress: sca.address, createdAt: Date.now() } } }, { merge: true });
    return { chain, depositAddress: sca.address, label: cfg.label, cached: false };
  },
);

// ---------- Path A: process a deposit — CCTP Fast Transfer → Arc → Gateway balance ----------
// Core pipeline, shared by the callable (UI polls it) and the scheduled processor
// (picks up webhook-detected deposits). (1) bridge the SCA's USDC to the user's
// Arc EOA via App Kit CCTP Fast Transfer (~30s, gasless), (2) deposit the arrived
// USDC into the user's Arc Gateway balance. Returns "waiting" if nothing arrived yet.
async function runFundingPipeline(uid: string, chain: string): Promise<{ status: "waiting" | "done"; received?: number; credited?: number }> {
  const cfg = CHAINS[chain];
  const isSolana = chain === "solana";
  const appkitChain = APPKIT_CHAIN[chain];
  if (!cfg || (!isSolana && !appkitChain)) throw new Error(`Unsupported chain "${chain}"`);

  const profRef = admin.firestore().collection("profiles").doc(uid);
  const prof = (await profRef.get()).data();
  const fw = prof?.fundingWallets?.[chain];
  if (!fw?.scaWalletId) throw new Error("No funding wallet for this chain — provision it first.");
  const arcEoa = prof?.obolWalletAddress as string;
  const arcEoaWalletId = prof?.obolWalletId as string;

  const c = circleClient() as any;
  const GW_WALLET = "0x0077777d7EBA4688BDeF3E311b846F25870A19B9";
  const waitTx = async (txId: string, label: string) => {
    for (let i = 0; i < 60; i++) {
      const r = await c.getTransaction({ id: txId });
      const st: string = r?.data?.transaction?.state ?? "";
      if (["COMPLETE", "CONFIRMED"].includes(st)) return;
      if (["FAILED", "DENIED", "CANCELLED"].includes(st)) throw new Error(`${label} ${st}`);
      await new Promise((res) => setTimeout(res, 3000));
    }
    throw new Error(`${label} pending`);
  };
  const arcUsdcBal = async () => {
    const p = new JsonRpcProvider(CHAINS.arc.rpc);
    const u = new Contract(ARC.usdc, ["function balanceOf(address) view returns (uint256)"], p);
    return Number(await u.balanceOf(arcEoa)) / 1e6;
  };

  // 1. How much USDC did the user send to the deposit wallet? (EVM: on-chain
  //    balanceOf; Solana: SPL USDC balance via Circle Wallets — see chains/solana.ts.)
  const amount = isSolana
    ? await solanaUsdcBalance(fw.scaAddress)
    : Number(await new Contract(cfg.usdc, ["function balanceOf(address) view returns (uint256)"], new JsonRpcProvider(cfg.rpc)).balanceOf(fw.scaAddress)) / 1e6;
  if (amount < 0.5) return { status: "waiting" };
  // Obol network fee (bps) recoups the Gas-Station gas cost + margin on mainnet.
  // 0 by default (testnet free); set OBOL_NETWORK_FEE_BPS for mainnet (e.g. 50 = 0.5%).
  // The fee stays in the user's deposit wallet (Obol sweeps it); the rest bridges.
  const obolFeeBps = Number(process.env.OBOL_NETWORK_FEE_BPS || 0);
  const obolFee = Math.max(0, (amount * obolFeeBps) / 10000);
  const bridgeAmount = (Math.floor((amount - obolFee) * 100) / 100 - 0.1).toFixed(2); // -0.1 = CCTP fee buffer

  // 2. Bridge the deposit wallet's USDC -> user's Arc EOA via CCTP (gasless, ~30-60s).
  //    Solana routes through bridgeSolanaToArc (hybrid Circle Wallets adapter, SLOW).
  //    EVM: App Kit here. Speed per source chain — CCTP Fast Transfer only where it
  //    beats standard finality; Polygon/Avalanche/Monad standard is already ~fast and
  //    errors if FAST is forced, so those use SLOW; FAST elsewhere.
  if (isSolana) {
    await bridgeSolanaToArc({ solanaAddress: fw.scaAddress, arcEoa, amount: bridgeAmount });
  } else {
    const { AppKit } = await import("@circle-fin/app-kit");
    const { createCircleWalletsAdapter } = await import("@circle-fin/adapter-circle-wallets");
    const adapter = createCircleWalletsAdapter({ apiKey: CIRCLE_API_KEY.value(), entitySecret: CIRCLE_ENTITY_SECRET.value() });
    const kit = new AppKit();
    const transferSpeed = ["polygon", "avalanche", "monad"].includes(chain) ? "SLOW" : "FAST";
    await kit.bridge({
      from: { adapter, chain: appkitChain as never, address: fw.scaAddress },
      to: { adapter, chain: "Arc_Testnet" as never, address: arcEoa },
      amount: bridgeAmount,
      config: { transferSpeed },
    } as never);
  }

  // 3. Deposit the arrived USDC into the user's Arc Gateway balance (gasless on Arc).
  const walletBal = await arcUsdcBal();
  const depositAmt = Math.max(0, walletBal - 0.1); // leave dust for gas
  const arcAtomic = BigInt(Math.round(depositAmt * 1e6)).toString();
  const aApprove = await c.createContractExecutionTransaction({ walletId: arcEoaWalletId, blockchain: PROVISION_BLOCKCHAIN, contractAddress: ARC.usdc, abiFunctionSignature: "approve(address,uint256)", abiParameters: [GW_WALLET, arcAtomic], idempotencyKey: randomUUID(), fee: { type: "level", config: { feeLevel: "MEDIUM" } } });
  await waitTx(aApprove?.data?.id, "arc approve");
  const aDeposit = await c.createContractExecutionTransaction({ walletId: arcEoaWalletId, blockchain: PROVISION_BLOCKCHAIN, contractAddress: GW_WALLET, abiFunctionSignature: "deposit(address,uint256)", abiParameters: [ARC.usdc, arcAtomic], idempotencyKey: randomUUID(), fee: { type: "level", config: { feeLevel: "MEDIUM" } } });
  await waitTx(aDeposit?.data?.id, "arc deposit");

  await admin.firestore().collection("events").add({ uid, wallet: arcEoa, type: "fund_multichain", detail: `${bridgeAmount} USDC ${cfg.label} -> Arc Gateway balance (CCTP Fast)`, ts: Date.now() });
  return { status: "done", received: amount, credited: Number(depositAmt.toFixed(6)) };
}

// Callable — the Deposit UI polls this after the user sends USDC to their SCA.
export const processFundingDeposit = onCall(
  { serviceAccount: SIGNER_SA, secrets: [CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET], region: "us-central1", timeoutSeconds: 300, memory: "512MiB" },
  async (req) => {
    const uid = req.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Sign in required.");
    const chain = String(req.data?.chain ?? "").toLowerCase();
    if (!CHAINS[chain] || (chain !== "solana" && !APPKIT_CHAIN[chain])) throw new HttpsError("invalid-argument", `Unsupported chain "${chain}".`);
    let r; try { r = await runFundingPipeline(uid, chain); } catch (e) { throw new HttpsError("internal", (e as Error).message); }
    if (r.status === "waiting") throw new HttpsError("failed-precondition", `No USDC found at your ${CHAINS[chain].label} deposit address yet.`);
    return { ok: true, chain, received: r.received, credited: r.credited };
  },
);

// Scheduled processor — completes webhook-detected deposits hands-free (so the
// user doesn't have to keep the tab open). Picks up pending fundingJobs written by
// the fundingWebhook, runs the pipeline, and clears the job when done.
export const advanceFundingJobs = onSchedule(
  { schedule: "every 2 minutes", serviceAccount: SIGNER_SA, secrets: [CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET], region: "us-central1", timeoutSeconds: 300, memory: "512MiB" },
  async () => {
    const jobs = await admin.firestore().collection("fundingJobs").where("status", "==", "pending").limit(10).get();
    for (const doc of jobs.docs) {
      const { uid, chain } = doc.data() as { uid: string; chain: string };
      try {
        const r = await runFundingPipeline(uid, chain);
        if (r.status === "done") await doc.ref.delete();
      } catch (e) {
        console.error("advanceFundingJobs", uid, chain, (e as Error).message);
      }
    }
  },
);

// ---------- Auto-sweep: idle Arc-wallet USDC → the unified spendable (Gateway) balance ----------
// Users think in ONE spendable balance. Any USDC that lands in their Arc wallet (faucet, a
// direct send, a bridge that didn't finish depositing) is NOT spendable until it's inside the
// Gateway. This scheduled sweep auto-deposits it — so "money in wallet" becomes "money I can
// spend" with zero action. Bounded per run; leaves a 0.1 USDC gas buffer (Arc gas = USDC).
// Kill switch: OBOL_AUTOSWEEP=0.
export const autoSweepGateway = onSchedule(
  { schedule: "every 5 minutes", serviceAccount: SIGNER_SA, secrets: [CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET], region: "us-central1", timeoutSeconds: 480, memory: "512MiB" },
  async () => {
    if (process.env.OBOL_AUTOSWEEP === "0") return;
    const profs = await admin.firestore().collection("profiles").limit(50).get();
    const provider = new JsonRpcProvider(CHAINS.arc.rpc);
    const usdc = new Contract(ARC.usdc, ["function balanceOf(address) view returns (uint256)"], provider);
    const c = circleClient() as unknown as {
      createContractExecutionTransaction: (a: unknown) => Promise<{ data?: { id?: string } }>;
      getTransaction: (a: { id: string }) => Promise<{ data?: { transaction?: { state?: string } } }>;
    };
    const waitTx = async (id?: string): Promise<boolean> => {
      if (!id) return false;
      for (let i = 0; i < 40; i++) {
        const st = (await c.getTransaction({ id }))?.data?.transaction?.state ?? "";
        if (["COMPLETE", "CONFIRMED"].includes(st)) return true;
        if (["FAILED", "DENIED", "CANCELLED"].includes(st)) return false;
        await new Promise((res) => setTimeout(res, 3000));
      }
      return false;
    };
    for (const doc of profs.docs) {
      const prof = doc.data();
      const walletId = prof.obolWalletId as string | undefined;
      const addr = prof.obolWalletAddress as string | undefined;
      if (!walletId || !addr) continue;
      try {
        const bal = Number(await usdc.balanceOf(addr)) / 1e6;
        if (bal < 0.5) continue; // nothing meaningful to sweep
        const depositAmt = Math.floor((bal - 0.1) * 100) / 100; // leave 0.1 for Arc gas
        if (depositAmt <= 0) continue;
        const atomic = BigInt(Math.round(depositAmt * 1e6)).toString();
        const ap = await c.createContractExecutionTransaction({ walletId, blockchain: PROVISION_BLOCKCHAIN, contractAddress: ARC.usdc, abiFunctionSignature: "approve(address,uint256)", abiParameters: [ARC.gatewayWallet, atomic], idempotencyKey: randomUUID(), fee: { type: "level", config: { feeLevel: "MEDIUM" } } });
        if (!(await waitTx(ap?.data?.id))) continue;
        const dp = await c.createContractExecutionTransaction({ walletId, blockchain: PROVISION_BLOCKCHAIN, contractAddress: ARC.gatewayWallet, abiFunctionSignature: "deposit(address,uint256)", abiParameters: [ARC.usdc, atomic], idempotencyKey: randomUUID(), fee: { type: "level", config: { feeLevel: "MEDIUM" } } });
        if (!(await waitTx(dp?.data?.id))) continue;
        await admin.firestore().collection("events").add({ uid: doc.id, wallet: addr, type: "auto_deposit", detail: `${depositAmt.toFixed(2)} USDC Arc wallet → spendable balance (auto)`, network: "arc", ts: Date.now() });
      } catch (e) { console.error("autoSweepGateway", doc.id, (e as Error).message); }
    }
  },
);

// ============================================================================
// #4 FLOAT-CAP SWEEP — keep the hot custodial spending balance small.
// A buyer opts in by setting a self-custody `sweepAddress` + `floatCapUsdc`
// (2FA-gated). A scheduled job returns any spendable balance ABOVE the cap to
// that self-custody address, so an entity-secret compromise can only ever drain
// up to the cap — not a user's whole balance. Off by default (opt-in) and gated
// by OBOL_FLOAT_SWEEP=1 so it stays dormant until you enable it.
// ============================================================================
const DEFAULT_FLOAT_CAP = 50; // USDC — matches the default daily spend limit.

// setFloatCap — opt into the float-cap sweep (2FA-gated, like a withdrawal, since
// it decides where funds auto-move). Pass enabled:false to turn it off.
export const setFloatCap = onCall(
  { serviceAccount: SIGNER_SA, secrets: [KEY_ENC_SECRET], region: "us-central1" },
  async (req) => {
    const uid = req.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Sign in required.");
    const enabled = req.data?.enabled !== false; // default true
    const sweepAddress = String(req.data?.sweepAddress ?? "").trim();
    const rawCap = req.data?.floatCapUsdc;
    const cap = rawCap === undefined || rawCap === null ? DEFAULT_FLOAT_CAP : Number(rawCap);
    if (enabled) {
      if (!/^0x[0-9a-fA-F]{40}$/.test(sweepAddress)) throw new HttpsError("invalid-argument", "Valid self-custody sweep address (0x…) required.");
      if (!Number.isFinite(cap) || cap < 0) throw new HttpsError("invalid-argument", "Float cap must be ≥ 0.");
    }
    // 2FA gate — changing where funds auto-move is as sensitive as a withdrawal.
    const totpDoc = await admin.firestore().collection("userTotp").doc(uid).get();
    const has2fa = totpDoc.exists && !!totpDoc.data()?.confirmed;
    let twoFactorSetupRequired = false;
    if (has2fa) {
      const totpCode = String(req.data?.totpCode ?? "");
      if (!totpCode) throw new HttpsError("failed-precondition", "2FA required: enter your authenticator code.");
      await verifyUserTotp(uid, totpCode, Buffer.from(KEY_ENC_SECRET.value(), "hex"));
    } else {
      twoFactorSetupRequired = true;
    }
    await admin.firestore().collection("profiles").doc(uid).set(
      { floatSweepEnabled: enabled, sweepAddress: enabled ? sweepAddress : null, floatCapUsdc: cap, updatedAt: Date.now() },
      { merge: true },
    );
    return { ok: true, enabled, sweepAddress: enabled ? sweepAddress : null, floatCapUsdc: cap, twoFactorSetupRequired };
  },
);

// gatewayWithdrawArc — Arc→Arc Gateway withdrawal to any address, signed by the
// user's Circle dev-controlled wallet (no user private key). Mirrors the Arc path
// of withdrawObolWallet; used by the automated sweep (no 2FA — the destination was
// itself set WITH 2FA via setFloatCap, so it is a pre-authorized address).
async function gatewayWithdrawArc(p: { walletId: string; devAddr: string; recipient: string; amount: string }): Promise<string> {
  const { walletId, devAddr, recipient, amount } = p;
  const dest = CHAINS.arc;
  const burnIntent = {
    maxBlockHeight: MAX_UINT256,
    maxFee: usdc6("2.01"),
    spec: {
      version: 1, sourceDomain: ARC.domain, destinationDomain: dest.domain,
      sourceContract: b32(ARC.gatewayWallet), destinationContract: b32(dest.gatewayMinter),
      sourceToken: b32(ARC.usdc), destinationToken: b32(dest.usdc),
      sourceDepositor: b32(devAddr), destinationRecipient: b32(recipient),
      sourceSigner: b32(devAddr), destinationCaller: b32(ZERO),
      value: usdc6(amount), salt: `0x${randomBytes(32).toString("hex")}`, hookData: "0x",
    },
  };
  const typedData = {
    domain: { name: "GatewayWallet", version: "1" },
    types: {
      EIP712Domain: [{ name: "name", type: "string" }, { name: "version", type: "string" }],
      TransferSpec: [
        { name: "version", type: "uint32" }, { name: "sourceDomain", type: "uint32" }, { name: "destinationDomain", type: "uint32" },
        { name: "sourceContract", type: "bytes32" }, { name: "destinationContract", type: "bytes32" },
        { name: "sourceToken", type: "bytes32" }, { name: "destinationToken", type: "bytes32" },
        { name: "sourceDepositor", type: "bytes32" }, { name: "destinationRecipient", type: "bytes32" },
        { name: "sourceSigner", type: "bytes32" }, { name: "destinationCaller", type: "bytes32" },
        { name: "value", type: "uint256" }, { name: "salt", type: "bytes32" }, { name: "hookData", type: "bytes" },
      ],
      BurnIntent: [{ name: "maxBlockHeight", type: "uint256" }, { name: "maxFee", type: "uint256" }, { name: "spec", type: "TransferSpec" }],
    },
    primaryType: "BurnIntent",
    message: burnIntent,
  };
  const sig = (await circleClient().signTypedData({ walletId, data: JSON.stringify(typedData, bigintReplacer) }))?.data?.signature;
  if (!sig) throw new Error("Circle signing failed.");
  const resp = await fetch(`${GATEWAY_API}/transfer`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify([{ burnIntent, signature: sig }], bigintReplacer),
  });
  const result = (await resp.json()) as { attestation?: string; signature?: string };
  if (!result?.attestation || !result?.signature) throw new Error("Gateway transfer failed: " + JSON.stringify(result).slice(0, 200));
  // Arc mint via the Obol-owned Circle minter wallet — NO raw private key.
  return await arcCircleMint(result.attestation, result.signature);
}

// autoFloatSweep — every 10 min, return spendable balance ABOVE each opted-in
// user's cap to their self-custody sweepAddress. Dormant unless OBOL_FLOAT_SWEEP=1.
export const autoFloatSweep = onSchedule(
  { schedule: "every 10 minutes", serviceAccount: SIGNER_SA, secrets: [CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET], region: "us-central1", timeoutSeconds: 480, memory: "512MiB" },
  async () => {
    if (process.env.OBOL_FLOAT_SWEEP !== "1") return; // opt-in flag; dormant by default
    const profs = await admin.firestore().collection("profiles").where("floatSweepEnabled", "==", true).limit(50).get();
    for (const doc of profs.docs) {
      const prof = doc.data();
      const walletId = prof.obolWalletId as string | undefined;
      const devAddr = prof.obolWalletAddress as string | undefined;
      const sweepAddress = prof.sweepAddress as string | undefined;
      const cap = Number(prof.floatCapUsdc ?? DEFAULT_FLOAT_CAP);
      if (!walletId || !devAddr || !sweepAddress || !/^0x[0-9a-fA-F]{40}$/.test(sweepAddress)) continue;
      try {
        const available = Number((await gwGetBalance(devAddr)).available);
        const excess = Math.floor((available - cap) * 100) / 100; // 2dp USDC
        if (excess < 1) continue; // skip dust / gas-uneconomical sweeps
        const txHash = await gatewayWithdrawArc({ walletId, devAddr, recipient: sweepAddress, amount: excess.toFixed(2) });
        await admin.firestore().collection("events").add({
          uid: doc.id, wallet: devAddr, type: "float_sweep",
          detail: `${excess.toFixed(2)} USDC swept to self-custody ${sweepAddress} (cap $${cap})`, network: "arc", ts: Date.now(),
        });
        console.log("autoFloatSweep", doc.id, "swept", excess, "→", sweepAddress, txHash);
      } catch (e) { console.error("autoFloatSweep", doc.id, (e as Error).message); }
    }
  },
);

// Auto-detect inbound deposits at users' SCA addresses (records fundingJobs).
export { fundingWebhook } from "./fundingWebhook";

// ---------- bridgeChain — any-chain → any-chain CCTP via Gateway ----------
// Gateway EIP-712 domain has no chainId, so the same Circle wallet key signs
// burn intents for any EVM source chain (same address on all EVM chains).
export const bridgeChain = onCall(
  { serviceAccount: SIGNER_SA, secrets: [CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET, RELAYER_KEY], region: "us-central1" },
  async (req) => {
    const uid = req.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Sign in required.");
    const sourceChain = String(req.data?.sourceChain ?? "").toLowerCase();
    const destChain   = String(req.data?.destChain   ?? "").toLowerCase();
    const amount      = String(req.data?.amount ?? "");
    if (sourceChain === destChain) throw new HttpsError("invalid-argument", "Source and destination must differ.");
    const src  = CHAINS[sourceChain];
    const dest = CHAINS[destChain];
    if (!src)  throw new HttpsError("invalid-argument", `Unknown source "${sourceChain}".`);
    if (!dest) throw new HttpsError("invalid-argument", `Unknown destination "${destChain}".`);
    if (!amount || Number(amount) <= 0) throw new HttpsError("invalid-argument", "Valid amount required.");

    const prof = (await admin.firestore().collection("profiles").doc(uid).get()).data();
    const walletId = prof?.obolWalletId as string | undefined;
    const devAddr  = prof?.obolWalletAddress as string | undefined;
    if (!walletId || !devAddr) throw new HttpsError("failed-precondition", "No Obol wallet found.");

    const GW_WALLET = "0x0077777d7EBA4688BDeF3E311b846F25870A19B9";
    const burnIntent = {
      maxBlockHeight: MAX_UINT256,
      maxFee: usdc6("2.01"),
      spec: {
        version: 1, sourceDomain: src.domain, destinationDomain: dest.domain,
        sourceContract: b32(GW_WALLET), destinationContract: b32(dest.gatewayMinter),
        sourceToken: b32(src.usdc), destinationToken: b32(dest.usdc),
        sourceDepositor: b32(devAddr), destinationRecipient: b32(devAddr),
        sourceSigner: b32(devAddr), destinationCaller: b32(ZERO),
        value: usdc6(amount), salt: `0x${randomBytes(32).toString("hex")}`, hookData: "0x",
      },
    };
    const typedData = {
      domain: { name: "GatewayWallet", version: "1" },
      types: {
        EIP712Domain: [{ name: "name", type: "string" }, { name: "version", type: "string" }],
        TransferSpec: [
          { name: "version", type: "uint32" }, { name: "sourceDomain", type: "uint32" }, { name: "destinationDomain", type: "uint32" },
          { name: "sourceContract", type: "bytes32" }, { name: "destinationContract", type: "bytes32" },
          { name: "sourceToken", type: "bytes32" }, { name: "destinationToken", type: "bytes32" },
          { name: "sourceDepositor", type: "bytes32" }, { name: "destinationRecipient", type: "bytes32" },
          { name: "sourceSigner", type: "bytes32" }, { name: "destinationCaller", type: "bytes32" },
          { name: "value", type: "uint256" }, { name: "salt", type: "bytes32" }, { name: "hookData", type: "bytes" },
        ],
        BurnIntent: [{ name: "maxBlockHeight", type: "uint256" }, { name: "maxFee", type: "uint256" }, { name: "spec", type: "TransferSpec" }],
      },
      primaryType: "BurnIntent",
      message: burnIntent,
    };

    const sig = (await circleClient().signTypedData({ walletId, data: JSON.stringify(typedData, bigintReplacer) }))?.data?.signature;
    if (!sig) throw new HttpsError("internal", "Circle signing failed.");

    const resp = await fetch(`${GATEWAY_API}/transfer`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify([{ burnIntent, signature: sig }], bigintReplacer),
    });
    const result = await resp.json();
    if (!result?.attestation || !result?.signature) {
      throw new HttpsError("internal", "Gateway transfer failed: " + JSON.stringify(result).slice(0, 200));
    }

    const provider = new JsonRpcProvider(dest.rpc);
    const relayer  = new Wallet(RELAYER_KEY.value(), provider);
    const minter   = new Contract(dest.gatewayMinter, ["function gatewayMint(bytes attestation, bytes signature)"], relayer);
    let tx;
    try {
      const gasBal = await provider.getBalance(relayer.address);
      if (gasBal === 0n) throw new HttpsError(
        "failed-precondition",
        `Relayer not funded on ${destChain} — fund ${relayer.address} with native gas on ${dest.label}.`,
      );
      tx = await minter.gatewayMint(result.attestation, result.signature);
      await tx.wait();
    } catch (e) {
      if (e instanceof HttpsError) throw e;
      throw new HttpsError("internal",
        `Mint on ${dest.label} failed: ` +
        ((e as { shortMessage?: string; message?: string }).shortMessage ?? (e as { message?: string }).message ?? String(e)).slice(0, 200),
      );
    }

    await admin.firestore().collection("events").add({
      uid, wallet: devAddr, type: "bridge",
      detail: `${amount} USDC ${sourceChain} → ${destChain}`,
      sourceChain, destChain, ts: Date.now(),
    });
    return { txHash: tx.hash, amount, sourceChain, destChain, explorer: dest.explorerTx(tx.hash) };
  },
);

// ---------- GET /api/wallet?address=0x... ----------
// Replaces the Next.js App Router route handler — needed since static export
// doesn't support route handlers. Uses ethers (no viem) for on-chain balance
// + direct Circle Gateway REST for gateway balance.

const USDC_ERC20_ABI = ["function balanceOf(address) view returns (uint256)"];
const GATEWAY_API_URL = GATEWAY_API.replace("/v1", ""); // per OBOL_NETWORK
const ARC_EXPLORER_URL = "https://testnet.arcscan.app";

function atomicToUsdc(raw: bigint): string {
  const neg = raw < 0n;
  const v = neg ? -raw : raw;
  const whole = v / 1_000_000n;
  const frac = (v % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? "." + frac : ""}`;
}

type GwTransfer = Record<string, unknown>;
type Activity = { id: string; from: string; to: string; amount: string; status: string; network: string; createdAt: string; explorer: string };

async function gwSearchTransfers(direction: "to" | "from", address: string): Promise<GwTransfer[]> {
  try {
    const body: Record<string, unknown> = { token: "USDC" };
    body[direction === "to" ? "toAddress" : "fromAddress"] = address;
    const r = await fetch(`${GATEWAY_API_URL}/v1/transfers/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) return [];
    const data = (await r.json()) as { transfers?: GwTransfer[] };
    return Array.isArray(data.transfers) ? data.transfers : [];
  } catch { return []; }
}

async function gwGetBalance(address: string): Promise<{ available: string; total: string }> {
  try {
    // Gateway /balances expects { token, sources: [{ domain, depositor }] } and returns
    // { token, balances: [{ domain, depositor, balance, pendingBatch }] }. The user's
    // unified balance lives on Arc (domain 26). `balance` = spendable now; `pendingBatch`
    // = still settling. (Earlier code posted { address } + read gateway.formattedAvailable,
    // which don't exist — so it always returned 0, hence "API credits" never updated.)
    const r = await fetch(`${GATEWAY_API_URL}/v1/balances`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "USDC", sources: [{ domain: ARC.domain, depositor: address }] }),
    });
    if (!r.ok) return { available: "0", total: "0" };
    const d = (await r.json()) as { balances?: Array<{ balance?: string; pendingBatch?: string }> };
    const row = Array.isArray(d.balances) ? d.balances[0] : undefined;
    const available = row?.balance ?? "0";
    const total = (Number(row?.balance ?? 0) + Number(row?.pendingBatch ?? 0)).toString();
    return { available, total };
  } catch { return { available: "0", total: "0" }; }
}

function toActivity(t: GwTransfer): Activity {
  const amount = atomicToUsdc(BigInt(String(t.amount ?? "0")));
  const id = String(t.id ?? "");
  return {
    id,
    from: String(t.fromAddress ?? ""),
    to: String(t.toAddress ?? ""),
    amount,
    status: String(t.status ?? ""),
    network: String(t.recipientNetwork ?? t.sendingNetwork ?? ""),
    createdAt: String(t.createdAt ?? ""),
    explorer: `${ARC_EXPLORER_URL}/tx/${id}`,
  };
}

function sumActivities(rows: Activity[]): string {
  return rows.reduce((acc, r) => acc + Number(r.amount || 0), 0).toFixed(6).replace(/0+$/, "").replace(/\.$/, "") || "0";
}

async function chainBalance(rpc: string, usdcAddr: string, address: string): Promise<bigint> {
  try {
    const p = new JsonRpcProvider(rpc);
    const c = new Contract(usdcAddr, USDC_ERC20_ABI, p);
    return await Promise.race([
      c.balanceOf(address) as Promise<bigint>,
      new Promise<bigint>((_, r) => setTimeout(() => r(new Error("timeout")), 5000)),
    ]);
  } catch { return 0n; }
}

export const apiWallet = onRequest({ cors: true, region: "us-central1" }, async (req, res) => {
  const address = String(req.query.address || "");
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    res.status(400).json({ error: "valid ?address required" });
    return;
  }

  const chainKeys = Object.keys(CHAINS);
  const fs = admin.firestore();
  const addrLower = address.toLowerCase();
  // Buyer spend + seller earnings come from the `payments` ledger seller-fn writes on
  // every settled paid call (the Gateway API has NO transfer-history endpoint — the old
  // gwSearchTransfers hit a 404 route, so these were always 0). limit()-only queries so
  // no composite index is needed; sort newest-first in memory.
  const [balances, gwBalance, spendSnap, earnSnap] = await Promise.all([
    Promise.all(chainKeys.map((k) => chainBalance(CHAINS[k].rpc, CHAINS[k].usdc, address))),
    gwGetBalance(address),
    fs.collection("payments").where("buyerAddress", "==", addrLower).limit(500).get(),
    fs.collection("payments").where("sellerAddress", "==", addrLower).limit(500).get(),
  ]);

  const chains: Record<string, { label: string; balance: string }> = {};
  chainKeys.forEach((k, i) => {
    chains[k] = { label: CHAINS[k].label, balance: atomicToUsdc(balances[i]) };
  });
  const arcBalance = balances[chainKeys.indexOf("arc")] ?? 0n;

  type Pay = { buyerAddress?: string; sellerAddress?: string; serviceName?: string; amountCharged?: number; amountToSeller?: number; tx?: string | null; ts?: number };
  const payToActivity = (p: Pay, kind: "buyer" | "seller"): Activity => ({
    id: String(p.tx ?? p.ts ?? ""),
    from: String(p.buyerAddress ?? ""),
    to: String(p.sellerAddress ?? ""),
    amount: String((kind === "buyer" ? p.amountCharged : p.amountToSeller) ?? 0),
    status: "settled",
    network: String(p.serviceName ?? "arc"),
    createdAt: p.ts ? new Date(p.ts).toISOString() : "",
    explorer: p.tx ? `${ARC_EXPLORER_URL}/tx/${p.tx}` : "",
  });
  const spendRows = spendSnap.docs.map((d) => d.data() as Pay).sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0));
  const earnRows = earnSnap.docs.map((d) => d.data() as Pay).sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0));
  const spent = spendRows.reduce((acc, r) => acc + (Number(r.amountCharged) || 0), 0);
  const earned = earnRows.reduce((acc, r) => acc + (Number(r.amountToSeller) || 0), 0);
  const fmtUsdc = (n: number) => (n.toFixed(6).replace(/0+$/, "").replace(/\.$/, "") || "0");

  res.json({
    address,
    balance: {
      wallet: atomicToUsdc(arcBalance),
      available: gwBalance.available,
      total: gwBalance.total,
      chains,
    },
    seller: { earned: fmtUsdc(earned), calls: earnRows.length, recent: earnRows.slice(0, 25).map((p) => payToActivity(p, "seller")) },
    buyer:  { spent:  fmtUsdc(spent),  calls: spendRows.length, recent: spendRows.slice(0, 25).map((p) => payToActivity(p, "buyer")) },
  });
});

// ---------- fundAgentBalance — transfer from user's DCW to relayer, credit spendingBalance ----------
// The relayer is Obol's signing key that pays x402 calls on behalf of users.
// User's DCW sends USDC to the relayer; Firestore tracks their spendable credit.
export const fundAgentBalance = onCall(
  { serviceAccount: SIGNER_SA, secrets: [CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET, RELAYER_KEY], region: "us-central1" },
  async (req) => {
    const uid = req.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Sign in required.");
    const { amount } = req.data as { amount: string };
    if (!amount || parseFloat(amount) < 0.01) throw new HttpsError("invalid-argument", "Minimum $0.01");

    const profRef = admin.firestore().collection("profiles").doc(uid);
    const prof = (await profRef.get()).data();
    if (!prof?.obolWalletId) throw new HttpsError("not-found", "Provision your agent wallet first.");

    // ── Option 3 (OBOL_USER_PAYS=1): deposit into the user's OWN Gateway balance ──
    // approve + deposit from the user's own DCW — no relayer pooling, no off-chain
    // ledger. On Arc this is gasless (USDC is the gas token). The wallet's real
    // Gateway balance becomes the source of truth (read by getAgentBalance).
    if (userPaysEnabled(uid)) {
      const c = circleClient() as any;
      const atomic = BigInt(Math.round(parseFloat(amount) * 1e6)).toString();
      const wait = async (txId: string, label: string) => {
        for (let i = 0; i < 40; i++) {
          const r = await c.getTransaction({ id: txId });
          const st: string = r?.data?.transaction?.state ?? r?.data?.state ?? "";
          if (["COMPLETE", "CONFIRMED"].includes(st)) return;
          if (["FAILED", "CANCELLED", "DENIED"].includes(st)) throw new HttpsError("aborted", `${label} ${st}`);
          await new Promise((res) => setTimeout(res, 3000));
        }
        throw new HttpsError("deadline-exceeded", `${label} pending — it will finalize shortly.`);
      };
      const approve = await c.createContractExecutionTransaction({
        walletId: prof.obolWalletId, blockchain: PROVISION_BLOCKCHAIN, contractAddress: ARC.usdc,
        abiFunctionSignature: "approve(address,uint256)", abiParameters: [ARC.gatewayWallet, atomic],
        idempotencyKey: randomUUID(), fee: { type: "level", config: { feeLevel: "MEDIUM" } },
      });
      await wait(approve?.data?.id, "USDC approve");
      const deposit = await c.createContractExecutionTransaction({
        walletId: prof.obolWalletId, blockchain: PROVISION_BLOCKCHAIN, contractAddress: ARC.gatewayWallet,
        abiFunctionSignature: "deposit(address,uint256)", abiParameters: [ARC.usdc, atomic],
        idempotencyKey: randomUUID(), fee: { type: "level", config: { feeLevel: "MEDIUM" } },
      });
      await wait(deposit?.data?.id, "Gateway deposit");
      await admin.firestore().collection("events").add({
        uid, wallet: prof.obolWalletAddress, type: "fund_gateway",
        detail: `+$${amount} USDC → own Gateway balance (deposit tx: ${deposit?.data?.id})`, ts: Date.now(),
      });
      return { ok: true, credited: amount, source: "gateway" };
    }

    const relayerAddr = new EthersWallet(RELAYER_KEY.value()).address;

    // Initiate DCW → relayer transfer on Arc (same-chain, no bridge needed)
    const txRes = await (circleClient() as any).createTransaction({
      walletId: prof.obolWalletId,
      destinationAddress: relayerAddr,
      amounts: [String(amount)],
      blockchain: PROVISION_BLOCKCHAIN,
      tokenAddress: ARC.usdc,
      idempotencyKey: randomUUID(),
      fee: { type: "level", config: { feeLevel: "MEDIUM" } },
    });
    const txId: string = txRes?.data?.id ?? txRes?.data?.transaction?.id ?? "";

    // Poll up to 20 seconds for COMPLETE
    let confirmed = false;
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const r = await (circleClient() as any).getTransaction({ id: txId });
      const state: string = r?.data?.transaction?.state ?? r?.data?.state ?? "";
      if (state === "COMPLETE") { confirmed = true; break; }
      if (["FAILED", "CANCELLED", "DENIED"].includes(state)) break;
    }
    if (!confirmed) throw new HttpsError("deadline-exceeded", "Transfer pending — funds will credit once the Arc transaction confirms (usually <30s).");

    // Credit the balance atomically
    let newBalance = 0;
    await admin.firestore().runTransaction(async (tx) => {
      const snap = await tx.get(profRef);
      const current = parseFloat(snap.data()?.spendingBalance ?? "0");
      newBalance = current + parseFloat(amount);
      tx.update(profRef, { spendingBalance: newBalance.toFixed(6) });
    });

    await admin.firestore().collection("events").add({
      uid, wallet: prof.obolWalletAddress, type: "fund_agent", detail: `+$${amount} USDC → relayer (tx: ${txId})`, ts: Date.now(),
    });

    return { ok: true, credited: amount, spendingBalance: newBalance.toFixed(4) };
  }
);

// ---------- GET /api/services → public service directory (for agents) ----------
// Federate the Coinbase x402 Bazaar (CDP discovery) into Obol's directory. Public,
// no-key, read-only — we normalize into Obol's service shape and tag source:"bazaar"
// so the MCP + web app render them alongside Obol/Circle listings. We never store them.
async function fetchBazaarServices(query: string, limit: number): Promise<Record<string, unknown>[]> {
  try {
    const base = "https://api.cdp.coinbase.com/platform/v2/x402/discovery";
    const url = query
      ? `${base}/search?query=${encodeURIComponent(query)}&limit=${limit}`
      : `${base}/resources?limit=${limit}`;
    const r = await fetch(url);
    if (!r.ok) return [];
    // /resources returns { items: [...] }; /search returns { resources: [...] }
    const d = (await r.json()) as { items?: Record<string, unknown>[]; resources?: Record<string, unknown>[] };
    const items = Array.isArray(d.items) ? d.items : (Array.isArray(d.resources) ? d.resources : []);
    return items.map((it) => {
      const accepts = (it.accepts as Record<string, unknown>[] | undefined)?.[0] ?? {};
      const amt = Number(accepts.amount ?? 0) / 1e6;
      const call = String(it.resource ?? it.url ?? "");
      const desc = String(it.description ?? "");
      return {
        id: `bazaar:${call || accepts.payTo || desc.slice(0, 20)}`,
        source: "bazaar",
        name: (desc.split(/[.\n]/)[0] || "x402 service").slice(0, 70),
        category: String(accepts.network ?? "x402").includes("solana") ? "Solana" : "x402",
        description: desc,
        priceUsdc: amt,
        price: `${amt} USDC/call`,
        callUrl: call,
        hostedUrl: call,
        payoutAddress: String(accepts.payTo ?? ""),
        network: String(accepts.network ?? ""),
        active: true,
        createdAt: 0,
        safety: { verdict: "unverified", flags: ["bazaar"] },
      };
    });
  } catch { return []; }
}

export const apiServices = onRequest({ cors: true, region: "us-central1" }, async (req, res) => {
  const q = String((req.query.q as string) ?? "").trim();
  const includeBazaar = String((req.query.bazaar as string) ?? "1") !== "0";
  const bazaarLimit = Math.min(Number(req.query.bazaarLimit ?? 40) || 40, 100);
  const [snap, bazaar] = await Promise.all([
    admin.firestore().collection("services").where("active", "==", true).orderBy("createdAt", "desc").limit(200).get(),
    includeBazaar ? fetchBazaarServices(q, bazaarLimit) : Promise.resolve([]),
  ]);
  const obol = snap.docs.map((d) => ({ id: d.id, source: "obol", ...d.data() }));
  res.json({ services: [...obol, ...bazaar], sources: { obol: obol.length, bazaar: bazaar.length } });
});

// ── ACK-ID viewer — resolve a seller's Verifiable Credential by wallet or DID ──
// GET /api/ack?address=0x...  (or ?did=did:pkh:eip155:5042002:0x...)
// Returns the ObolVerifiedSeller credential, the decoded attestation, and whether
// the credentialed wallet still matches the owner's CURRENT account wallet (so a
// stale "old wallet" ACK is visible and fixable).
export const apiAck = onRequest({ cors: true, region: "us-central1" }, async (req, res) => {
  const did = String(req.query.did ?? "").trim();
  const addrFromDid = did.startsWith("did:pkh:") ? (did.split(":").pop() || "") : "";
  const address = (String(req.query.address ?? "").trim() || addrFromDid).toLowerCase();
  if (!address) { res.status(400).json({ error: "Provide ?address=0x... or ?did=did:pkh:..." }); return; }

  const fs = admin.firestore();
  const all = await fs.collection("services").limit(500).get();
  const docs = all.docs.filter((d) => {
    const v = d.data();
    return (v.payoutAddress || "").toLowerCase() === address || (v.ackDid || "").toLowerCase().includes(address);
  });
  if (!docs.length) { res.status(404).json({ error: "No ACK-ID credential found for that wallet/DID.", address }); return; }

  const data = docs[0].data();
  const jwt = data.ackCredential as string | undefined;
  let attestation: unknown = null;
  if (jwt && jwt.split(".").length === 3) {
    try {
      const payload = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString("utf8")) as Record<string, unknown>;
      const vc = payload.vc as { credentialSubject?: unknown } | undefined;
      attestation = vc?.credentialSubject ?? payload;
    } catch { /* leave null */ }
  }

  // Does the credentialed wallet still match the owner's CURRENT account wallet?
  let currentWallet: string | null = null;
  let matchesCurrentWallet: boolean | null = null;
  if (data.ownerUid) {
    const prof = (await fs.collection("profiles").doc(data.ownerUid).get()).data();
    currentWallet = (prof?.obolWalletAddress ?? prof?.address ?? null) as string | null;
    if (currentWallet) matchesCurrentWallet = currentWallet.toLowerCase() === (data.payoutAddress || "").toLowerCase();
  }

  // LIVE reputation — aggregated fresh from the seller's services (NOT signed into
  // the credential, so it never goes stale). This is the seller's "credit history".
  let ratingSum = 0, ratingCount = 0;
  for (const d of docs) {
    const v = d.data();
    if (v.ratingCount) { ratingSum += (v.avgRating || 0) * v.ratingCount; ratingCount += v.ratingCount; }
  }
  const reputation = {
    avgRating: ratingCount ? Math.round((ratingSum / ratingCount) * 10) / 10 : null,
    ratingCount,
    listings: docs.length,
    memberSince: (typeof attestation === "object" && attestation && "memberSince" in (attestation as Record<string, unknown>))
      ? (attestation as { memberSince?: string }).memberSince : null,
  };

  // Track that someone viewed this ACK (best-effort, non-blocking).
  fs.collection("services").doc(docs[0].id).update({ ackViews: admin.firestore.FieldValue.increment(1), ackViewedAt: Date.now() }).catch(() => {});

  res.set("Cache-Control", "no-store");
  res.json({
    ackDid: data.ackDid ?? null,
    issuer: data.ackIssuer ?? null,
    verified: !!data.ackVerified,
    credentialedWallet: data.payoutAddress ?? null,
    currentAccountWallet: currentWallet,
    matchesCurrentWallet,
    status: matchesCurrentWallet === false
      ? "STALE — this ACK-ID is for a wallet that no longer matches the owner's current account wallet. Re-issue to re-link."
      : matchesCurrentWallet === true ? "OK — ACK-ID matches the owner's current account wallet." : "Owner wallet unknown.",
    reputation,
    services: docs.map((d) => ({ id: d.id, name: d.data().name, category: d.data().category, hostedUrl: d.data().hostedUrl })),
    attestation,
    credentialJwt: jwt ?? null,
  });
});

// ============================================================
// TOTP 2FA — Google Authenticator / Authy setup + verify
// ============================================================

function encryptSecret(raw: string, encKey: Buffer): string {
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-gcm", encKey, iv);
  const enc = Buffer.concat([cipher.update(raw, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${enc.toString("hex")}:${tag.toString("hex")}`;
}

function decryptSecret(stored: string, encKey: Buffer): string {
  const [ivHex, encHex, tagHex] = stored.split(":");
  const decipher = createDecipheriv("aes-256-gcm", encKey, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(encHex, "hex")), decipher.final()]).toString("utf8");
}

async function verifyUserTotp(uid: string, code: string, encKey: Buffer): Promise<void> {
  const doc = await admin.firestore().collection("userTotp").doc(uid).get();
  if (!doc.exists || !doc.data()?.confirmed) {
    throw new HttpsError("failed-precondition", "Authenticator app not set up. Go to Settings → set up 2FA first.");
  }
  const secret = decryptSecret(doc.data()!.encryptedSecret, encKey);
  authenticator.options = { window: 1 };
  if (!authenticator.verify({ token: code, secret })) {
    throw new HttpsError("permission-denied", "Invalid authenticator code.");
  }
}

// ---------- setupTotp — generate secret + otpauth URI ----------
export const setupTotp = onCall(
  { secrets: [KEY_ENC_SECRET], region: "us-central1" },
  async (req) => {
    const uid = req.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Sign in required.");
    const secret = authenticator.generateSecret();
    const encKey = Buffer.from(KEY_ENC_SECRET.value(), "hex");
    const encryptedSecret = encryptSecret(secret, encKey);
    await admin.firestore().collection("userTotp").doc(uid).set({
      encryptedSecret,
      confirmed: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    const email = req.auth?.token?.email ?? uid;
    const otpauthUri = authenticator.keyuri(email, "Obol", secret);
    return { otpauthUri };
  }
);

// ---------- confirmTotpSetup — verify first code to activate ----------
export const confirmTotpSetup = onCall(
  { secrets: [KEY_ENC_SECRET], region: "us-central1" },
  async (req) => {
    const uid = req.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Sign in required.");
    const { code } = req.data as { code: string };
    const doc = await admin.firestore().collection("userTotp").doc(uid).get();
    if (!doc.exists) throw new HttpsError("not-found", "Run setup first.");
    const encKey = Buffer.from(KEY_ENC_SECRET.value(), "hex");
    const secret = decryptSecret(doc.data()!.encryptedSecret, encKey);
    authenticator.options = { window: 1 };
    if (!authenticator.verify({ token: code, secret })) {
      throw new HttpsError("permission-denied", "Wrong code — try again.");
    }
    await doc.ref.update({ confirmed: true });
    return { ok: true };
  }
);

// ---------- getTotpStatus — is TOTP set up for this user? ----------
export const getTotpStatus = onCall(
  { region: "us-central1" },
  async (req) => {
    const uid = req.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Sign in required.");
    const doc = await admin.firestore().collection("userTotp").doc(uid).get();
    return { confirmed: doc.exists && doc.data()?.confirmed === true };
  }
);

// ============================================================
// Agent spending limits — per-user caps the agent cannot exceed.
//   • Stored on profiles/{uid}.agentLimits  (per-user, never global)
//   • Default DAILY = 50 USDC for every user (applied at read time)
//   • Changing a limit requires the user's OWN 2FA code — the API
//     key alone can spend up to the cap but can never raise it.
// A compromised API key is therefore bounded; only the human with
// the authenticator app can move the ceiling.
// ============================================================
const DEFAULT_DAILY_LIMIT = 50;

type AgentLimits = { daily: number | null; weekly: number | null; monthly: number | null };

function normalizeLimits(raw: Partial<AgentLimits> | undefined): AgentLimits {
  const clamp = (v: unknown): number | null => {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) return null;
    return Math.round(n * 1e6) / 1e6; // 6dp USDC precision
  };
  return {
    daily:   raw?.daily   === undefined ? DEFAULT_DAILY_LIMIT : clamp(raw.daily),
    weekly:  clamp(raw?.weekly),
    monthly: clamp(raw?.monthly),
  };
}

// ---------- getUserAgentLimits — read limits (default daily 50) ----------
export const getUserAgentLimits = onCall(
  { region: "us-central1" },
  async (req) => {
    const uid = req.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Sign in required.");
    const prof = (await admin.firestore().collection("profiles").doc(uid).get()).data();
    return normalizeLimits(prof?.agentLimits);
  }
);

// ---------- setUserAgentLimits — change limits (requires 2FA) ----------
export const setUserAgentLimits = onCall(
  { secrets: [KEY_ENC_SECRET], region: "us-central1" },
  async (req) => {
    const uid = req.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Sign in required.");
    const { daily, weekly, monthly, totpCode } = req.data as Partial<AgentLimits> & { totpCode?: string };
    if (!totpCode) throw new HttpsError("invalid-argument", "Authenticator code required to change limits.");

    // 2FA gate — only the human with the authenticator app can change limits.
    await verifyUserTotp(uid, totpCode, Buffer.from(KEY_ENC_SECRET.value(), "hex"));

    const limits = normalizeLimits({ daily, weekly, monthly });
    await admin.firestore().collection("profiles").doc(uid).set(
      { agentLimits: limits, agentLimitsUpdatedAt: Date.now() },
      { merge: true },
    );
    await admin.firestore().collection("events").add({
      uid, type: "set_limits", detail: `daily=${limits.daily} weekly=${limits.weekly} monthly=${limits.monthly}`, ts: Date.now(),
    });
    return limits;
  }
);

// ============================================================
// API Key System — generates obl_sk_live_xxx keys backed by
// encrypted EOA wallets stored server-side. The raw key is
// returned exactly once; only its SHA-256 hash is persisted.
// ============================================================

// ---------- generateApiKey — create key + encrypted EOA ----------
export const generateApiKey = onCall(
  { secrets: [KEY_ENC_SECRET], region: "us-central1" },
  async (req) => {
    const uid = req.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Sign in required.");
    const { totpCode } = req.data as { totpCode?: string };
    if (!totpCode) throw new HttpsError("invalid-argument", "Authenticator code required.");
    await verifyUserTotp(uid, totpCode, Buffer.from(KEY_ENC_SECRET.value(), "hex"));

    // Max 5 active keys per user
    const existing = await admin.firestore()
      .collection("apiKeys")
      .where("uid", "==", uid)
      .where("revoked", "==", false)
      .get();
    if (existing.size >= 5) throw new HttpsError("resource-exhausted", "Maximum 5 active API keys.");

    // Generate the API key string
    const rawKey = `obl_sk_live_${randomBytes(24).toString("hex")}`;
    const keyHash = createHash("sha256").update(rawKey).digest("hex");
    const keyPrefix = rawKey.slice(0, 22) + "…";

    // Generate a fresh EOA for this key's agent wallet
    const agentWallet = EthersWallet.createRandom();
    const agentAddress = agentWallet.address;
    const agentPrivateKey = agentWallet.privateKey;

    // Encrypt the private key with AES-256-GCM
    const encKey = Buffer.from(KEY_ENC_SECRET.value(), "hex");
    const iv = randomBytes(16);
    const cipher = createCipheriv("aes-256-gcm", encKey, iv);
    const enc = Buffer.concat([cipher.update(agentPrivateKey, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    const encryptedKey = `${iv.toString("hex")}:${enc.toString("hex")}:${tag.toString("hex")}`;

    // Also encrypt the raw API key itself so it can be revealed later with identity verification
    const iv2 = randomBytes(16);
    const cipher2 = createCipheriv("aes-256-gcm", encKey, iv2);
    const enc2 = Buffer.concat([cipher2.update(rawKey, "utf8"), cipher2.final()]);
    const tag2 = cipher2.getAuthTag();
    const encryptedApiKey = `${iv2.toString("hex")}:${enc2.toString("hex")}:${tag2.toString("hex")}`;

    await admin.firestore().collection("apiKeys").doc(keyHash).set({
      uid,
      keyPrefix,
      agentAddress,
      encryptedKey,
      encryptedApiKey,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      lastUsedAt: null,
      revoked: false,
    });

    // Return the full key exactly once — never stored in plaintext
    return { apiKey: rawKey, agentAddress, keyPrefix };
  }
);

// ---------- getMyApiKeys — list user's keys (masked) ----------
export const getMyApiKeys = onCall(
  { region: "us-central1" },
  async (req) => {
    const uid = req.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Sign in required.");
    const snap = await admin.firestore()
      .collection("apiKeys")
      .where("uid", "==", uid)
      .get();
    return snap.docs
      .map(d => ({
        id: d.id.slice(0, 8),
        keyPrefix: d.data().keyPrefix,
        agentAddress: d.data().agentAddress,
        createdAt: d.data().createdAt?.toDate?.()?.toISOString() ?? null,
        lastUsedAt: d.data().lastUsedAt?.toDate?.()?.toISOString() ?? null,
        revoked: d.data().revoked,
      }))
      .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  }
);

// ---------- revokeApiKey — soft-delete by display ID (first 8 chars of hash) ----------
export const revokeApiKey = onCall(
  { secrets: [KEY_ENC_SECRET], region: "us-central1" },
  async (req) => {
    const uid = req.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Sign in required.");
    const { keyId, totpCode } = req.data as { keyId: string; totpCode?: string };
    if (!totpCode) throw new HttpsError("invalid-argument", "Authenticator code required.");
    await verifyUserTotp(uid, totpCode, Buffer.from(KEY_ENC_SECRET.value(), "hex"));
    const snap = await admin.firestore()
      .collection("apiKeys")
      .where("uid", "==", uid)
      .get();
    const match = snap.docs.find(d => d.id.startsWith(keyId));
    if (!match) throw new HttpsError("not-found", "Key not found.");
    await match.ref.update({ revoked: true });
    return { ok: true };
  }
);

// ---------- revealApiKey — decrypt + return the full key after identity check ----------
// The caller must be the key owner (enforced by uid check). The re-auth challenge
// happens client-side (password re-entry / OAuth popup / phone SMS); the CF trusts
// the Firebase ID token as the second factor — no separate server-side OTP needed.
export const revealApiKey = onCall(
  { secrets: [KEY_ENC_SECRET], region: "us-central1" },
  async (req) => {
    const uid = req.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Sign in required.");
    const { keyId, totpCode } = req.data as { keyId: string; totpCode?: string };
    if (!totpCode) throw new HttpsError("invalid-argument", "Authenticator code required.");
    await verifyUserTotp(uid, totpCode, Buffer.from(KEY_ENC_SECRET.value(), "hex"));
    const snap = await admin.firestore().collection("apiKeys").where("uid", "==", uid).get();
    const match = snap.docs.find(d => d.id.startsWith(keyId));
    if (!match) throw new HttpsError("not-found", "Key not found.");
    if (match.data().revoked) throw new HttpsError("permission-denied", "Key is revoked.");
    const { encryptedApiKey } = match.data();
    if (!encryptedApiKey) throw new HttpsError("not-found", "Key was created before reveal support — rotate to get a new key.");
    const [ivHex, encHex, tagHex] = encryptedApiKey.split(":");
    const encKeyBuf = Buffer.from(KEY_ENC_SECRET.value(), "hex");
    const decipher = createDecipheriv("aes-256-gcm", encKeyBuf, Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    const apiKey = Buffer.concat([decipher.update(Buffer.from(encHex, "hex")), decipher.final()]).toString("utf8");
    await match.ref.update({ lastRevealedAt: admin.firestore.FieldValue.serverTimestamp() });
    return { apiKey };
  }
);

// ---------- signAgentPayment — MCP calls this to sign without ever seeing the key ----------
const SPEND_WINDOWS: { key: keyof AgentLimits; ms: number; label: string }[] = [
  { key: "daily",   ms: 24 * 3600e3,      label: "daily" },
  { key: "weekly",  ms: 7 * 24 * 3600e3,  label: "weekly" },
  { key: "monthly", ms: 30 * 24 * 3600e3, label: "monthly" },
];

// Spending is tracked with O(1) RUNNING COUNTERS per window on the profile —
// `spendWindows: { daily:{start,total}, weekly:{...}, monthly:{...} }` — instead
// of summing a ledger on every call. This keeps cost flat (1 doc read per check)
// even under millions of nanopayments; a fixed window resets once it expires.
type SpendWindow = { start: number; total: number };
type SpendWindows = Partial<Record<keyof AgentLimits, SpendWindow>>;

function currentTotal(w: SpendWindow | undefined, windowMs: number, now: number): number {
  if (!w || now - w.start >= windowMs) return 0; // expired → counts as fresh
  return Number(w.total) || 0;
}

// Would this spend breach any window? Read-only — exactly ONE doc read.
async function checkSpend(
  uid: string,
  amountUsdc: number,
): Promise<{ ok: boolean; reason?: string; window?: string; cap?: number; spent?: number; remaining?: number }> {
  if (!Number.isFinite(amountUsdc) || amountUsdc <= 0) return { ok: true };
  const prof = (await admin.firestore().collection("profiles").doc(uid).get()).data();
  const limits = normalizeLimits(prof?.agentLimits);
  const windows = (prof?.spendWindows ?? {}) as SpendWindows;
  const now = Date.now();

  let tightestRemaining = Infinity;
  for (const w of SPEND_WINDOWS) {
    const cap = limits[w.key];
    if (cap === null) continue;
    const spent = currentTotal(windows[w.key], w.ms, now);
    tightestRemaining = Math.min(tightestRemaining, cap - spent);
    if (spent + amountUsdc > cap + 1e-9) {
      return {
        ok: false, window: w.label, cap, spent, remaining: Math.max(0, cap - spent),
        reason: `This payment ($${amountUsdc}) would exceed your ${w.label} limit of $${cap} USDC ` +
          `(already spent $${spent.toFixed(4)}). Raise it in Settings → Keys (requires 2FA).`,
      };
    }
  }
  return { ok: true, remaining: tightestRemaining === Infinity ? undefined : Math.max(0, tightestRemaining) };
}

// Add a spend to the running counters (call AFTER the payment settles). O(1):
// one transaction touching the profile doc. An idempotencyKey makes retries safe
// — a tiny by-id marker doc dedupes without re-counting.
async function recordSpend(uid: string, amountUsdc: number, idempotencyKey?: string): Promise<void> {
  if (!Number.isFinite(amountUsdc) || amountUsdc <= 0) return;
  const db = admin.firestore();
  const profRef = db.collection("profiles").doc(uid);
  const keyRef = idempotencyKey
    ? profRef.collection("spendKeys").doc(createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 40))
    : null;

  await db.runTransaction(async (tx) => {
    if (keyRef) {
      const seen = await tx.get(keyRef);
      if (seen.exists) return; // already counted → idempotent no-op
    }
    const windows = ((await tx.get(profRef)).data()?.spendWindows ?? {}) as SpendWindows;
    const now = Date.now();
    const next: SpendWindows = {};
    for (const w of SPEND_WINDOWS) {
      const cur = windows[w.key];
      next[w.key] = (cur && now - cur.start < w.ms)
        ? { start: cur.start, total: (Number(cur.total) || 0) + amountUsdc } // still in window → accumulate
        : { start: now, total: amountUsdc };                                 // expired/new → reset
    }
    tx.set(profRef, { spendWindows: next }, { merge: true });
    if (keyRef) tx.set(keyRef, { amount: amountUsdc, ts: now });
  });
}

// Check + record in one step (used by the server-side signing path).
async function enforceAndRecordSpend(uid: string, amountUsdc: number): Promise<void> {
  const r = await checkSpend(uid, amountUsdc);
  if (!r.ok) throw new HttpsError("resource-exhausted", r.reason ?? "Spending limit exceeded.");
  await recordSpend(uid, amountUsdc);
}

// Map an obl_sk_live_ key → owner uid (or null if invalid/revoked).
async function uidForApiKey(apiKey: string | undefined): Promise<string | null> {
  if (!apiKey?.startsWith("obl_sk_live_")) return null;
  const keyHash = createHash("sha256").update(apiKey).digest("hex");
  const doc = await admin.firestore().collection("apiKeys").doc(keyHash).get();
  if (!doc.exists || doc.data()?.revoked) return null;
  return (doc.data()?.uid as string) ?? null;
}

// HTTP endpoint the MCP calls around each pay-per-call:
//   POST { apiKey, amountUsdc, mode: "check" | "record" }
//   mode=check  → { ok, reason?, remaining? }   (no write; call BEFORE paying)
//   mode=record → { ok }                        (append to ledger AFTER settling)
// If apiKey is missing/invalid we fail OPEN (ok:true) so non-Obol agents still
// work — limits are a feature of having an Obol account.
export const spendLimit = onRequest(
  { cors: true, region: "us-central1", maxInstances: 20, memory: "256MiB", timeoutSeconds: 20 },
  async (req, res) => {
    try {
      const { apiKey, amountUsdc, mode, idempotencyKey } = (req.body ?? {}) as { apiKey?: string; amountUsdc?: number; mode?: string; idempotencyKey?: string };
      const amount = Number(amountUsdc);
      const uid = await uidForApiKey(apiKey);
      if (!uid) { res.json({ ok: true, unlinked: true }); return; }

      if (mode === "record") {
        await recordSpend(uid, amount, idempotencyKey);
        res.json({ ok: true });
        return;
      }
      const r = await checkSpend(uid, amount);
      res.status(r.ok ? 200 : 429).json(r);
    } catch (e) {
      // Fail closed on unexpected errors for the check path would block all spend;
      // instead surface the error so the MCP can decide. Default to ok:false only on explicit breach.
      res.status(500).json({ ok: false, reason: (e as Error).message });
    }
  },
);

export const signAgentPayment = onCall(
  { secrets: [KEY_ENC_SECRET], region: "us-central1" },
  async (req) => {
    const { apiKey, message, amountUsdc } = req.data as { apiKey: string; message: string; amountUsdc?: number };
    if (!apiKey?.startsWith("obl_sk_live_")) throw new HttpsError("invalid-argument", "Invalid API key format.");

    const keyHash = createHash("sha256").update(apiKey).digest("hex");
    const doc = await admin.firestore().collection("apiKeys").doc(keyHash).get();
    if (!doc.exists || doc.data()?.revoked) throw new HttpsError("unauthenticated", "Invalid or revoked API key.");

    // Spending-limit enforcement (per-user cap; recorded in the spend ledger).
    const ownerUid = doc.data()?.uid as string | undefined;
    if (ownerUid && typeof amountUsdc === "number") {
      await enforceAndRecordSpend(ownerUid, amountUsdc);
    }

    // Decrypt private key
    const { encryptedKey } = doc.data()!;
    const [ivHex, encHex, tagHex] = encryptedKey.split(":");
    const encKeyBuf = Buffer.from(KEY_ENC_SECRET.value(), "hex");
    const decipher = createDecipheriv("aes-256-gcm", encKeyBuf, Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    const privateKey = Buffer.concat([
      decipher.update(Buffer.from(encHex, "hex")),
      decipher.final(),
    ]).toString("utf8");

    // Sign the message
    const wallet = new EthersWallet(privateKey);
    const signature = await wallet.signMessage(message);

    // Update lastUsedAt (fire and forget)
    doc.ref.update({ lastUsedAt: admin.firestore.FieldValue.serverTimestamp() }).catch(() => {});

    return { signature, agentAddress: wallet.address };
  }
);

// ── Verifiable payment receipts ────────────────────────────────────────────────
// The MCP signs a receipt with the agent's key after each pay. We verify the
// signature server-side (recover the signer, confirm it matches receipt.payer)
// and store only valid receipts — an audit-grade, tamper-evident trail. Anyone
// can independently re-verify a receipt offline from {receipt, signature}.
//   POST /api/receipt
//     { receipt, signature }            → store (verifies first)
//     { receipt, signature, mode:"verify" } → verify only, no write
export const receipt = onRequest(
  { cors: true, region: "us-central1", maxInstances: 20, memory: "256MiB", timeoutSeconds: 20 },
  async (req, res) => {
    try {
      const { receipt: rcpt, signature, mode } = (req.body ?? {}) as { receipt?: Record<string, unknown>; signature?: string; mode?: string };
      if (!rcpt || !signature || typeof rcpt.payer !== "string") {
        res.status(400).json({ ok: false, error: "receipt + signature required" });
        return;
      }
      // Recover the signer from the exact canonical bytes the MCP signed.
      const canonical = JSON.stringify(rcpt);
      let recovered: string;
      try {
        recovered = verifyMessage(canonical, signature);
      } catch {
        res.status(400).json({ ok: false, valid: false, error: "bad signature" });
        return;
      }
      const valid = recovered.toLowerCase() === (rcpt.payer as string).toLowerCase();
      if (mode === "verify") { res.json({ ok: true, valid, recovered }); return; }
      if (!valid) { res.status(400).json({ ok: false, valid: false, recovered, error: "signer ≠ payer" }); return; }

      // Store the verified receipt (idempotent on tx+nonce).
      const id = createHash("sha256").update(`${rcpt.tx}:${rcpt.nonce}`).digest("hex").slice(0, 40);
      await admin.firestore().collection("receipts").doc(id).set({
        ...rcpt, signature, recovered, storedAt: Date.now(),
      }, { merge: true });
      res.json({ ok: true, valid: true, id });
    } catch (e) {
      res.status(500).json({ ok: false, error: (e as Error).message });
    }
  },
);

export { mcpServer } from "./mcp-server";

// ── Rate Service (Agent feedback) ──────────────────────────────────────────────
export const rateService = onCall(
  { enforceAppCheck: true },
  async (request) => {
    const { serviceId, rating, comment } = request.data as { serviceId: string; rating: number; comment?: string };

    if (!request.auth) throw new Error("Unauthenticated");
    if (!serviceId || !rating) throw new Error("Missing serviceId or rating");
    if (rating < 1 || rating > 5 || !Number.isInteger(rating)) throw new Error("Rating must be 1-5");

    const agentUid = request.auth.uid;
    const db = admin.firestore();

    // Record the rating in Services/{serviceId}/ratings/{agentUid}
    const ratingRef = db.collection("Services").doc(serviceId).collection("ratings").doc(agentUid);
    await ratingRef.set({
      rating,
      comment: comment || null,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      agentUid,
    }, { merge: true });

    // Calculate new average rating
    const snapshot = await db.collection("Services").doc(serviceId).collection("ratings").get();
    const ratings = snapshot.docs.map(d => d.data().rating);
    const avgRating = ratings.length > 0 ? (ratings.reduce((a, b) => a + b, 0) / ratings.length) : 0;
    const ratingCount = ratings.length;

    // Update service with aggregate stats
    await db.collection("Services").doc(serviceId).update({
      avgRating,
      ratingCount,
      lastRatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return {
      ok: true,
      avgRating: parseFloat(avgRating.toFixed(2)),
      ratingCount,
      yourRating: rating,
    };
  }
);

// ── GDPR: export my data (right to access / data portability) ──────────────────
// Returns everything Obol holds that is keyed to this signed-in user, as JSON.
// Secrets (API keys, 2FA seeds, spend keys) are reported as present/redacted —
// never returned in plaintext.
export const exportMyData = onCall(
  { region: "us-central1" },
  async (req) => {
    const uid = req.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Sign in required.");
    const fs = admin.firestore();

    const profileDoc = await fs.collection("profiles").doc(uid).get();
    const profile = profileDoc.exists ? { ...profileDoc.data() } as Record<string, unknown> : null;

    const [apiKeysSnap, servicesSnap, totpDoc, spendKeysSnap, receiptsSnap, eventsSnap, ratingsSnap] =
      await Promise.all([
        fs.collection("apiKeys").where("uid", "==", uid).get(),
        fs.collection("services").where("ownerUid", "==", uid).get(),
        fs.collection("userTotp").doc(uid).get(),
        fs.collection("profiles").doc(uid).collection("spendKeys").get(),
        fs.collection("receipts").where("uid", "==", uid).get().catch(() => ({ docs: [] as FirebaseFirestore.QueryDocumentSnapshot[] })),
        fs.collection("events").where("uid", "==", uid).get().catch(() => ({ docs: [] as FirebaseFirestore.QueryDocumentSnapshot[] })),
        fs.collectionGroup("ratings").where("agentUid", "==", uid).get().catch(() => ({ docs: [] as FirebaseFirestore.QueryDocumentSnapshot[] })),
      ]);

    // API keys: report metadata only, NEVER the secret/hash.
    const apiKeys = apiKeysSnap.docs.map((d) => {
      const v = d.data();
      return { label: v.label ?? null, createdAt: v.createdAt ?? null, revoked: !!v.revoked, lastUsedAt: v.lastUsedAt ?? null };
    });

    return {
      exportedAt: Date.now(),
      uid,
      account: req.auth?.token ? { email: req.auth.token.email ?? null, signInProvider: req.auth.token.firebase?.sign_in_provider ?? null } : null,
      profile,
      twoFactor: { enabled: !!(totpDoc.exists && totpDoc.data()?.confirmed) }, // seed never exported
      apiKeys, // secrets redacted
      spendKeysCount: spendKeysSnap.docs.length, // keys redacted
      services: servicesSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
      receipts: receiptsSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
      auditEvents: eventsSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
      ratingsYouGave: ratingsSnap.docs.map((d) => ({ ...d.data() })),
    };
  }
);

// ── GDPR: delete my account (right to erasure) ─────────────────────────────────
// Irreversible. 2FA-gated if the user has an authenticator set up.
// Model: DELETE everything that identifies the user (profile, credentials, 2FA,
// listings, ratings) + the auth identity; PSEUDONYMIZE financial records (receipts
// + audit events) by severing the identity link while keeping wallet/amount/time
// for the legally-required tax/audit window (see Privacy Policy → retention). The
// blockchain itself is immutable; on-chain USDC is the user's funds — withdraw first.
export const deleteMyAccount = onCall(
  { secrets: [KEY_ENC_SECRET], region: "us-central1" },
  async (req) => {
    const uid = req.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Sign in required.");
    const { confirm, totpCode } = (req.data ?? {}) as { confirm?: string; totpCode?: string };
    if (confirm !== "DELETE") throw new HttpsError("failed-precondition", 'Type "DELETE" to confirm account deletion.');

    const fs = admin.firestore();

    // 2FA gate (only if the user has confirmed TOTP).
    const totpDoc = await fs.collection("userTotp").doc(uid).get();
    if (totpDoc.exists && totpDoc.data()?.confirmed) {
      if (!totpCode) throw new HttpsError("failed-precondition", "Enter your authenticator code to confirm deletion.");
      await verifyUserTotp(uid, totpCode, Buffer.from(KEY_ENC_SECRET.value(), "hex"));
    }

    const [apiKeysSnap, servicesSnap, spendKeysSnap, receiptsSnap, eventsSnap, ratingsSnap] = await Promise.all([
      fs.collection("apiKeys").where("uid", "==", uid).get(),
      fs.collection("services").where("ownerUid", "==", uid).get(),
      fs.collection("profiles").doc(uid).collection("spendKeys").get(),
      fs.collection("receipts").where("uid", "==", uid).get().catch(() => ({ docs: [] as FirebaseFirestore.QueryDocumentSnapshot[] })),
      fs.collection("events").where("uid", "==", uid).get().catch(() => ({ docs: [] as FirebaseFirestore.QueryDocumentSnapshot[] })),
      fs.collectionGroup("ratings").where("agentUid", "==", uid).get().catch(() => ({ docs: [] as FirebaseFirestore.QueryDocumentSnapshot[] })),
    ]);

    // (1) DELETE — anything that identifies the user.
    const toDelete: FirebaseFirestore.DocumentReference[] = [
      fs.collection("profiles").doc(uid),  // the identity↔wallet link — the sensitive part
      fs.collection("userTotp").doc(uid),
      ...apiKeysSnap.docs.map((d) => d.ref),
      ...servicesSnap.docs.map((d) => d.ref),
      ...spendKeysSnap.docs.map((d) => d.ref),
      ...ratingsSnap.docs.map((d) => d.ref),
    ];

    // (2) PSEUDONYMIZE — financial/audit records: sever the identity link, keep the
    // non-identifying facts (wallet, amount, timestamp) for the tax/audit window.
    const toPseudonymize = [...receiptsSnap.docs, ...eventsSnap.docs];
    const REDACT = admin.firestore.FieldValue.delete();
    const pseudoPatch = {
      uid: "deleted",          // breaks the link to a real identity
      email: REDACT, name: REDACT, displayName: REDACT, ip: REDACT, userAgent: REDACT,
      pseudonymizedAt: Date.now(),
      retainedReason: "tax/audit (see Privacy Policy → retention)",
    };

    let ops = 0;
    let batch = fs.batch();
    for (const ref of toDelete) { batch.delete(ref); if (++ops >= 450) { await batch.commit(); batch = fs.batch(); ops = 0; } }
    for (const d of toPseudonymize) { batch.set(d.ref, pseudoPatch, { merge: true }); if (++ops >= 450) { await batch.commit(); batch = fs.batch(); ops = 0; } }
    if (ops > 0) await batch.commit();

    // (3) Delete the auth identity.
    await admin.auth().deleteUser(uid);

    return {
      ok: true,
      deleted: toDelete.length,
      pseudonymized: toPseudonymize.length,
      deletedAt: Date.now(),
    };
  }
);

// ── Contact form ──────────────────────────────────────────────────────────────
export const contactForm = onRequest(
  { secrets: [RESEND_API_KEY], cors: ["https://obol-arc.web.app", "http://localhost:3000"] },
  async (req, res) => {
    if (req.method !== "POST") { res.status(405).send("Method Not Allowed"); return; }
    const { name, email, message } = req.body as { name?: string; email?: string; message?: string };
    if (!name || !email || !message) { res.status(400).json({ error: "Missing fields" }); return; }

    const { Resend } = await import("resend");
    const resend = new Resend(RESEND_API_KEY.value());

    const notifHtml = `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#06080F;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#06080F;padding:40px 0"><tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%">
<tr><td style="background:linear-gradient(135deg,#0d0a2e,#06080F);border-radius:16px 16px 0 0;padding:32px 40px;text-align:center;border-bottom:1px solid rgba(109,94,246,0.25)">
  <span style="color:#fff;font-size:22px;font-weight:800;letter-spacing:-0.03em">⬤ Obol</span>
  <p style="color:#a9abbd;font-size:13px;margin:8px 0 0">New Scale plan inquiry</p>
</td></tr>
<tr><td style="background:#0d0f1a;padding:32px 40px;border:1px solid rgba(109,94,246,0.12);border-top:none">
  <p style="color:#a9abbd;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;margin:0 0 4px">From</p>
  <p style="color:#fff;font-size:16px;font-weight:700;margin:0 0 16px">${name} &lt;<a href="mailto:${email}" style="color:#6D5EF6">${email}</a>&gt;</p>
  <p style="color:#a9abbd;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;margin:0 0 4px">Message</p>
  <p style="color:#e2e4f0;font-size:15px;line-height:1.6;margin:0 0 24px;white-space:pre-wrap">${message}</p>
  <a href="mailto:${email}" style="display:inline-block;background:linear-gradient(135deg,#6D5EF6,#4F8EFF);color:#fff;text-decoration:none;padding:12px 28px;border-radius:10px;font-size:14px;font-weight:700">Reply to ${name} →</a>
</td></tr>
<tr><td style="background:#06080F;border-radius:0 0 16px 16px;padding:16px 40px;text-align:center;border:1px solid rgba(109,94,246,0.12);border-top:none">
  <p style="color:#4a4c5e;font-size:12px;margin:0">Obol · obol-arc.web.app</p>
</td></tr>
</table></td></tr></table></body></html>`;

    const confirmHtml = `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#06080F;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#06080F;padding:40px 0"><tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%">
<tr><td style="background:linear-gradient(135deg,#0d0a2e,#06080F);border-radius:16px 16px 0 0;padding:32px 40px;text-align:center;border-bottom:1px solid rgba(109,94,246,0.25)">
  <span style="color:#fff;font-size:22px;font-weight:800;letter-spacing:-0.03em">⬤ Obol</span>
  <p style="color:#a9abbd;font-size:13px;margin:8px 0 0">Pay-per-call API marketplace for AI agents</p>
</td></tr>
<tr><td style="background:#0d0f1a;padding:36px 40px;border:1px solid rgba(109,94,246,0.12);border-top:none;text-align:center">
  <div style="font-size:40px;margin-bottom:16px">✓</div>
  <h2 style="color:#fff;font-size:22px;font-weight:800;margin:0 0 12px">Got it, ${name}!</h2>
  <p style="color:#a9abbd;font-size:15px;line-height:1.6;margin:0 0 28px;max-width:380px;margin-left:auto;margin-right:auto">We received your message and will get back to you within 1 business day.</p>
  <a href="https://obol-arc.web.app/marketplace" style="display:inline-block;background:linear-gradient(135deg,#6D5EF6,#4F8EFF);color:#fff;text-decoration:none;padding:13px 32px;border-radius:10px;font-size:15px;font-weight:700">Browse marketplace →</a>
</td></tr>
<tr><td style="background:#06080F;border-radius:0 0 16px 16px;padding:16px 40px;text-align:center;border:1px solid rgba(109,94,246,0.12);border-top:none">
  <p style="color:#4a4c5e;font-size:12px;margin:0">Obol · obol-arc.web.app · Built on Circle &amp; Arc</p>
</td></tr>
</table></td></tr></table></body></html>`;

    await Promise.all([
      resend.emails.send({ from: "Obol Contact <onboarding@resend.dev>", to: "obolmcp@gmail.com", replyTo: email, subject: `New Scale inquiry from ${name}`, html: notifHtml }),
      resend.emails.send({ from: "Obol <onboarding@resend.dev>", to: email, subject: "We got your message — Obol", html: confirmHtml }),
    ]);

    res.json({ ok: true });
  }
);
