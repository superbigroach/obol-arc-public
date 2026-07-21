// Pay an x402 (Bazaar / facilitator) service keyless + gasless.
// The buyer signs an EIP-3009 TransferWithAuthorization via Circle (dev-controlled
// wallet — no private key), and the seller's facilitator settles + pays the gas.
// Supports x402 v2 (PAYMENT-SIGNATURE header) with v1 (X-PAYMENT) fallback.
//
// VERIFIED live 2026-07-12 against sandbox.node4all.com (Base Sepolia): keyless
// Circle signing → HTTP 200 real response, wallet held 0 ETH (fully gasless).
//
// Usage: payViaFacilitator({ circleClient, walletId, fromAddress, callUrl, method, maxPriceUsdc })
import { randomBytes } from "node:crypto";

// x402 network (eip155:chainId) -> Circle blockchain enum. Signing must happen on the
// SERVICE's chain (Circle rejects typed-data whose chainId != the wallet's chain).
const NET_TO_BLOCKCHAIN = {
  "eip155:8453": "BASE", "eip155:84532": "BASE-SEPOLIA",
  "eip155:137": "MATIC", "eip155:80002": "MATIC-AMOY",
  "eip155:42161": "ARB", "eip155:421614": "ARB-SEPOLIA",
  "eip155:10": "OP", "eip155:11155420": "OP-SEPOLIA",
  "eip155:1": "ETH", "eip155:11155111": "ETH-SEPOLIA",
  "eip155:43114": "AVAX", "eip155:43113": "AVAX-FUJI",
  "eip155:130": "UNI", "eip155:1301": "UNI-SEPOLIA",
};

export async function payViaFacilitator({ circleClient, walletId, fromAddress, callUrl, method = "GET", maxPriceUsdc = 1.0 }) {
  // 1. Trigger the 402 challenge
  const r1 = await fetch(callUrl, { method });
  if (r1.status !== 402) {
    // Some servers 200 without payment (free) — just return the body.
    if (r1.ok) return { ok: true, data: await r1.json().catch(() => r1.text()), charged: 0, gas: 0 };
    throw new Error(`Expected 402, got ${r1.status}`);
  }
  const hdr = r1.headers.get("payment-required") || r1.headers.get("x-payment-required");
  if (!hdr) throw new Error("No Payment-Required header on 402.");
  const challenge = JSON.parse(Buffer.from(hdr, "base64").toString("utf8"));
  const acc = (challenge.accepts || [])[0];
  if (!acc) throw new Error("No accepts[] in challenge.");
  if (acc.scheme !== "exact") throw new Error(`Unsupported scheme ${acc.scheme}`);

  const priceUsdc = Number(acc.amount || 0) / 1e6;
  if (priceUsdc > maxPriceUsdc) throw new Error(`Price $${priceUsdc} exceeds maxPrice $${maxPriceUsdc}.`);

  // 2. Build + sign the EIP-3009 authorization (keyless via Circle)
  const chainId = Number(String(acc.network).split(":")[1]);
  const now = Math.floor(Date.now() / 1000);
  const validBefore = String(now + (acc.maxTimeoutSeconds || 60) + 120);
  const nonce = "0x" + randomBytes(32).toString("hex");
  const authorization = { from: fromAddress, to: acc.payTo, value: acc.amount, validAfter: "0", validBefore, nonce };

  const typedData = {
    domain: { name: acc.extra?.name || "USDC", version: acc.extra?.version || "2", chainId, verifyingContract: acc.asset },
    types: {
      EIP712Domain: [
        { name: "name", type: "string" }, { name: "version", type: "string" },
        { name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" },
      ],
      TransferWithAuthorization: [
        { name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" },
      ],
    },
    primaryType: "TransferWithAuthorization",
    message: authorization,
  };
  // Sign on the SERVICE's chain (blockchain+address), not the wallet's home chain.
  const blockchain = NET_TO_BLOCKCHAIN[acc.network];
  const signArgs = blockchain
    ? { blockchain, walletAddress: fromAddress, data: JSON.stringify(typedData) }
    : { walletId, data: JSON.stringify(typedData) };
  const sig = (await circleClient.signTypedData(signArgs))?.data?.signature;
  if (!sig) throw new Error("Circle signing failed.");

  // 3. Resend with the payment header (v2 shape, v1 fallback)
  const payment = { x402Version: challenge.x402Version || 2, resource: challenge.resource, accepted: acc, payload: { signature: sig, authorization } };
  const b64 = Buffer.from(JSON.stringify(payment)).toString("base64");
  const r2 = await fetch(callUrl, { method, headers: { "PAYMENT-SIGNATURE": b64, "X-PAYMENT": b64 } });
  if (!r2.ok) throw new Error(`Facilitator payment failed (HTTP ${r2.status}).`);

  const data = await r2.json().catch(() => r2.text());
  let settlement = null;
  const sh = r2.headers.get("payment-response") || r2.headers.get("x-payment-response");
  if (sh) { try { settlement = JSON.parse(Buffer.from(sh, "base64").toString("utf8")); } catch { /* ignore */ } }
  return { ok: true, data, charged: priceUsdc, gas: 0, payer: fromAddress, network: acc.network, settlement };
}
