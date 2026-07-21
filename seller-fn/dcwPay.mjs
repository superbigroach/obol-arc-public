// ============================================================
// dcwPay — pay x402 sellers from a USER's OWN Circle dev-controlled wallet,
// settling from that wallet's OWN Circle Gateway balance. No central relayer,
// no pooled funds, no raw private key (Circle custodies the EOA key; we sign
// via Circle's signTypedData API).
//
// This is the "Option 3" money path. It is EOA + Arc-first by design:
//   - Gateway requires EOA (ECDSA) signatures for burn/authorization — SCA
//     (ERC-1271) sigs are rejected — so the per-user wallet is a Circle EOA.
//   - On Arc, USDC is the gas token, so deposits are effectively gasless.
//
// Requires (Secret Manager / env): CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET.
// ============================================================
// NOTE: heavy SDKs (@circle-fin/developer-controlled-wallets, x402-batching, viem)
// are imported LAZILY via dynamic import() inside each function. Importing them at
// module top level pushes Firebase's 10s load-analysis budget over the limit and
// the deploy fails with "Cannot determine backend specification. Timeout".

// ── Own-service (Gateway) rail constants — network-resolved via ./network.mjs ──
import { NET } from "./network.mjs";
export const ARC = { ...NET.arc, domain: 26 };
const GATEWAY_API_TESTNET = NET.gatewayApi;
const CIRCLE_BATCHING_NAME = "GatewayWalletBatched";

// Read creds lazily — Firebase v2 injects declared secrets into process.env at
// invocation time, not at module import, so we must not capture them at top level.
function creds() {
  // Secret is bound as CIRCLE_TESTNET_API_KEY; accept CIRCLE_API_KEY as a fallback.
  return {
    apiKey: process.env[NET.circleKeySecret] || process.env.CIRCLE_TESTNET_API_KEY || process.env.CIRCLE_API_KEY,
    entitySecret: process.env.CIRCLE_ENTITY_SECRET,
  };
}
export function isDcwConfigured() {
  const { apiKey, entitySecret } = creds();
  return Boolean(apiKey && entitySecret);
}

let _client = null;
export async function getCircleClient() { return circle(); }
async function circle() {
  const { apiKey, entitySecret } = creds();
  if (!apiKey || !entitySecret) throw new Error("Dev-controlled wallets not configured (CIRCLE_API_KEY / CIRCLE_ENTITY_SECRET).");
  if (!_client) {
    const { initiateDeveloperControlledWalletsClient } = await import("@circle-fin/developer-controlled-wallets");
    _client = initiateDeveloperControlledWalletsClient({ apiKey, entitySecret });
  }
  return _client;
}

// ── Circle-backed BatchEvmSigner ──────────────────────────────────────────────
// signTypedData delegates to Circle's signing API, so it drops straight into
// `new BatchEvmScheme(signer)` and produces the raw ECDSA signature Gateway
// requires — without any private key leaving Circle custody.
const EIP712_DOMAIN_FIELDS = [
  { name: "name", type: "string" },
  { name: "version", type: "string" },
  { name: "chainId", type: "uint256" },
  { name: "verifyingContract", type: "address" },
];

export function dcwSigner(walletId, address) {
  return {
    address,
    signTypedData: async (params) => {
      const domainFields = EIP712_DOMAIN_FIELDS.filter((f) => f.name in params.domain);
      const data = {
        types: { EIP712Domain: domainFields, ...params.types },
        domain: params.domain,
        primaryType: params.primaryType,
        message: params.message,
      };
      // EIP-712 uint256 values arrive as BigInt; Circle's API wants string numerics.
      const json = JSON.stringify(data, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
      const c = await circle();
      const r = await c.signTypedData({ walletId, data: json });
      const sig = r?.data?.signature;
      if (!sig) throw new Error("Circle DCW signTypedData returned no signature");
      return sig;
    },
  };
}

// ── Real Gateway balance (available, in USDC) for an address on Arc ────────────
export async function getUserGatewayAvailable(address) {
  const { getAddress } = await import("viem");
  const res = await fetch(`${GATEWAY_API_TESTNET}/balances`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: "USDC", sources: [{ domain: ARC.domain, depositor: getAddress(address) }] }),
  });
  if (!res.ok) throw new Error(`Gateway balance read failed (HTTP ${res.status})`);
  const j = await res.json().catch(() => ({}));
  const bal = (j.balances || []).find((b) => b.domain === ARC.domain) || (j.balances || [])[0];
  return parseFloat(bal?.balance ?? "0");
}

// ── Pay an x402 seller from the user's OWN wallet + Gateway balance ────────────
// Full 402 → sign (via Circle) → resubmit → parse settlement flow.
export async function payFromUserWallet({ walletId, address, url, method = "GET", chainId = ARC.chainId }) {
  const [{ BatchEvmScheme }, { getAddress }] = await Promise.all([
    import("@circle-fin/x402-batching/client"),
    import("viem"),
  ]);
  const scheme = new BatchEvmScheme(dcwSigner(walletId, getAddress(address)));

  // 1. Trigger the 402 challenge.
  const first = await fetch(url, { method });
  if (first.status !== 402) {
    if (first.ok) return { data: await first.json().catch(() => ({})), tx: null, note: "no payment required" };
    throw new Error(`Upstream ${first.status} before payment`);
  }
  const prHeader = first.headers.get("payment-required");
  if (!prHeader) throw new Error("402 without payment-required header");
  const paymentRequired = JSON.parse(Buffer.from(prHeader, "base64").toString("utf8"));
  const accepts = paymentRequired.accepts || [];

  // 2. Select the GatewayWalletBatched rail for our chain.
  const opt = accepts.find(
    (a) => a?.network === `eip155:${chainId}` && a?.extra?.name === CIRCLE_BATCHING_NAME && typeof a?.extra?.verifyingContract === "string"
  );
  if (!opt) throw new Error(`No GatewayWalletBatched rail for eip155:${chainId} in the 402 challenge.`);
  const x402Version = paymentRequired.x402Version ?? 2;

  // 3. Build + sign the payment payload from the user's own wallet (Circle signs).
  const paymentPayload = await scheme.createPaymentPayload(x402Version, opt);

  // 4. Resubmit with the Payment-Signature header (seller forwards to Circle Gateway).
  const header = Buffer.from(
    JSON.stringify({ ...paymentPayload, resource: paymentRequired.resource, accepted: opt })
  ).toString("base64");
  const paid = await fetch(url, { method, headers: { "Payment-Signature": header } });
  if (!paid.ok) {
    const body = await paid.text().catch(() => "");
    throw new Error(`Payment settlement failed (HTTP ${paid.status}) ${body.slice(0, 160)}`);
  }
  const data = await paid.json().catch(() => ({}));

  // 5. Settlement tx from the PAYMENT-RESPONSE header, if present.
  let tx = null;
  const respHeader = paid.headers.get("payment-response");
  if (respHeader) {
    try { tx = JSON.parse(Buffer.from(respHeader, "base64").toString("utf8"))?.transaction ?? null; } catch { /* header optional */ }
  }
  return { data, tx };
}

// ── Deposit USDC from the user's wallet INTO its own Gateway balance ───────────
// approve(GatewayWallet, amount) then GatewayWallet.deposit(usdc, amount), both
// executed by Circle from the user's dev-controlled wallet. On Arc this is
// gasless (USDC is the gas token). Returns { approveTx, depositTx }.
export async function depositToUserGateway({ walletAddress, amountUsdc }) {
  const c = await circle();
  const atomic = BigInt(Math.round(parseFloat(amountUsdc) * 1e6)).toString();

  const waitForTx = async (txId, label) => {
    for (let i = 0; i < 40; i++) {
      const { data } = await c.getTransaction({ id: txId });
      const state = data?.transaction?.state;
      if (["COMPLETE", "CONFIRMED"].includes(state)) return data.transaction;
      if (["FAILED", "DENIED", "CANCELLED"].includes(state)) throw new Error(`${label} ${state}`);
      await new Promise((r) => setTimeout(r, 3000));
    }
    throw new Error(`${label} timed out`);
  };

  const approve = await c.createContractExecutionTransaction({
    walletAddress,
    blockchain: ARC.blockchain,
    contractAddress: ARC.usdc,
    abiFunctionSignature: "approve(address,uint256)",
    abiParameters: [ARC.gatewayWallet, atomic],
    fee: { type: "level", config: { feeLevel: "MEDIUM" } },
  });
  await waitForTx(approve.data?.id, "USDC approve");

  const deposit = await c.createContractExecutionTransaction({
    walletAddress,
    blockchain: ARC.blockchain,
    contractAddress: ARC.gatewayWallet,
    abiFunctionSignature: "deposit(address,uint256)",
    abiParameters: [ARC.usdc, atomic],
    fee: { type: "level", config: { feeLevel: "MEDIUM" } },
  });
  await waitForTx(deposit.data?.id, "Gateway deposit");

  return { approveTx: approve.data?.id, depositTx: deposit.data?.id };
}
