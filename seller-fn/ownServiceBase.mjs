// ownServiceBase — serve Obol's OWN services on the x402 v2 Base FACILITATOR rail.
//
// This is the SELLER counterpart to seller-fn/facilitatorPay.mjs (the buyer). It lets
// Obol's own endpoints (/weather, /price) be paid with RAW Base USDC via the same
// facilitator rail the Bazaar uses — so a Base-default user (raw USDC in their EOA,
// no Arc Gateway balance) can buy Obol's services identically to any Bazaar service.
//
// Keyless + gasless for BOTH sides:
//   - buyer signs an EIP-3009 TransferWithAuthorization via Circle (no private key),
//   - the facilitator (x402.org on testnet, Coinbase CDP on mainnet) SETTLES on-chain
//     and pays the gas. Obol holds NO key and pays NO gas here.
//   - earnings land DIRECTLY in the seller's payTo wallet as raw Base USDC (no Gateway
//     balance, no withdrawal step) — unlike the Arc/Gateway rail.
//
// Wire format is x402 v2 (matches facilitatorPay.mjs exactly, verified interoperable):
//   402  → `PAYMENT-REQUIRED` header  = base64(JSON(PaymentRequired {accepts:[...]}))
//   pay  → `PAYMENT-SIGNATURE` header = base64(JSON(PaymentPayload {accepted, payload}))
//   200  → `PAYMENT-RESPONSE` header  = base64(JSON(SettleResponse {transaction,...}))
// NOTE: @x402/core/http is imported LAZILY (dynamic import) inside the handler —
// importing it at module top pushes Firebase's 10s load-analysis budget over the
// limit and the deploy fails with "Cannot determine backend specification. Timeout".
import { NET } from "./network.mjs";

// Cache the loaded SDK + facilitator client across invocations (warm containers).
let _x402http = null;
async function x402http() {
  if (!_x402http) _x402http = await import("@x402/core/http");
  return _x402http;
}
let _facilitator = null;
async function facilitator() {
  if (_facilitator) return _facilitator;
  const { HTTPFacilitatorClient } = await x402http();
  const cfg = NET.baseFacilitator || {};
  // No url → SDK default (https://x402.org/facilitator, free + gasless on testnet).
  // Mainnet CDP needs createAuthHeaders (CDP API key) — added when OBOL_NETWORK=mainnet.
  _facilitator = cfg.url ? new HTTPFacilitatorClient({ url: cfg.url, createAuthHeaders: cfg.createAuthHeaders })
                         : new HTTPFacilitatorClient();
  return _facilitator;
}

// Build the x402 v2 PaymentRequired (the 402 challenge) for one endpoint/price.
function buildChallenge({ req, path, priceAtomic, payTo }) {
  const bf = NET.baseFacilitator;
  const url = `https://${req.headers.host}${path}`;
  return {
    x402Version: 2,
    resource: { url, description: `Obol own service (${path}) — paid on Base via x402 facilitator.`, mimeType: "application/json", serviceName: "Obol" },
    accepts: [{
      scheme: "exact",
      network: bf.network,           // CAIP-2, e.g. eip155:84532 (Base Sepolia) / eip155:8453 (Base)
      asset: bf.usdc,                // Base USDC contract
      amount: String(priceAtomic),   // atomic USDC (6dp); "1000" = $0.001
      payTo,                         // seller's Base wallet — receives raw USDC directly
      maxTimeoutSeconds: 60,
      extra: { name: "USDC", version: "2" }, // EIP-712 domain the buyer signs over
    }],
  };
}

// Mount a facilitator-rail GET route. `serve(req)` returns { status?, body } with the
// real API payload, called ONLY after settlement succeeds.
export function mountBaseFacilitatorRoute(app, { path, priceAtomic, payTo, serve }) {
  app.get(path, async (req, res) => {
    // Let browsers (web-app buyer) read our custom x402 headers through CORS.
    res.set("Access-Control-Expose-Headers", "PAYMENT-REQUIRED, PAYMENT-RESPONSE");

    const { encodePaymentRequiredHeader, encodePaymentResponseHeader, decodePaymentSignatureHeader } = await x402http();

    const sigHeader = req.headers["payment-signature"] || req.headers["x-payment"];
    if (!sigHeader) {
      // No payment yet → issue the standard x402 v2 402 challenge.
      const challenge = buildChallenge({ req, path, priceAtomic, payTo });
      res.set("PAYMENT-REQUIRED", encodePaymentRequiredHeader(challenge));
      res.status(402).json({ x402Version: 2, error: "payment required", accepts: challenge.accepts });
      return;
    }

    // Payment present → decode, verify + settle via the facilitator (it pays the gas).
    let paymentPayload;
    try {
      paymentPayload = decodePaymentSignatureHeader(String(sigHeader));
    } catch {
      res.status(400).json({ error: "Malformed PAYMENT-SIGNATURE header." });
      return;
    }
    const requirements = paymentPayload.accepted;
    if (!requirements || requirements.payTo?.toLowerCase() !== payTo.toLowerCase()) {
      res.status(400).json({ error: "Payment payTo does not match this service." });
      return;
    }

    try {
      const fac = await facilitator();
      const verify = await fac.verify(paymentPayload, requirements);
      if (!verify.isValid) {
        res.status(402).json({ error: "Payment verification failed", reason: verify.invalidReason, detail: verify.invalidMessage });
        return;
      }
      const settle = await fac.settle(paymentPayload, requirements);
      if (!settle.success) {
        res.status(402).json({ error: "Settlement failed", reason: settle.errorReason, detail: settle.errorMessage });
        return;
      }

      // Paid + settled → serve the real data, attach the settlement receipt.
      const out = await serve(req);
      res.set("PAYMENT-RESPONSE", encodePaymentResponseHeader(settle));
      const body = out?.body ?? out ?? {};
      if (body && typeof body === "object") {
        body.rail = "base-facilitator";
        body.network = settle.network;
        body.paidBy = settle.payer;
        body.settlementTx = settle.transaction;
      }
      res.status(out?.status ?? 200).json(body);
    } catch (e) {
      res.status(502).json({ error: `Facilitator error: ${String(e?.message || e)}` });
    }
  });
}
