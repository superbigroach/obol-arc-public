// Shared "Obol Skill" prompt — paste into Claude/ChatGPT/Cursor to scaffold a paid service.
// Used by the dashboard (Provide services) and the Keys/Setup page.
export function buildObolSkill(sellerAddr: string): string {
  return `You are helping me publish a paid service on Obol — a marketplace where AI agents
discover services and pay per HTTP call in USDC on the Arc blockchain (no accounts,
no API keys for the buyer, no invoices). I want you to build, run, and help me deploy
a working seller server, then tell me exactly how to register it.

# CONTEXT YOU NEED

- Network: Arc testnet (EVM, chain ID 5042002).
- Payment rail: Circle Gateway via the x402 standard (HTTP 402 "Payment Required").
- The seller (me) runs a normal Express server. Each paid route is wrapped with one
  middleware call that sets a price. When an agent calls without payment, the
  middleware returns 402 + payment details; the agent's SDK pays off-chain (EIP-3009,
  gasless, ~200ms) and retries; the middleware verifies and runs my handler.
- My earnings settle to MY Arc wallet address: ${sellerAddr}
- I keep 100% of each call price; Obol charges 0% commission per call (it monetizes via optional subscriptions, not a take rate).

# THE STACK (use these EXACT packages)

  npm install express @circle-fin/x402-batching

Server skeleton (ESM, Node 18+):

  import express from "express";
  import { createGatewayMiddleware } from "@circle-fin/x402-batching/server";

  const app = express();
  app.use(express.json());

  const SELLER = process.env.SELLER_ADDRESS;
  const gateway = createGatewayMiddleware({
    sellerAddress: SELLER,
    networks: "eip155:5042002",
    facilitatorUrl: "https://gateway-api-testnet.circle.com",
  });

  app.get("/price", gateway.require("$0.001"), async (req, res) => {
    res.json({ result: "your data here", paidBy: req.payment?.payer });
  });

  app.get("/health", (_req, res) => res.json({ ok: true }));
  app.listen(process.env.PORT || 4021);

# WHAT TO BUILD

A Crypto Price API wrapping CoinGecko's free public endpoint:
  GET /price?coin=bitcoin → charge $0.001 USDC → return { coin, usd, ts }

# STEPS

1. Create project files: package.json, server.mjs, .env (SELLER_ADDRESS=${sellerAddr}, PORT=4021), .gitignore
2. Write the complete server with validation and error handling
3. Commands to install and run locally
4. How to expose publicly: npx localtunnel --port 4021
5. How to deploy to Railway (free tier) and get a permanent URL
6. Exactly what to enter at obol-arc.web.app/dashboard → Provide services → + New service
7. One curl command to verify the 402 response: curl -i <url>/price?coin=bitcoin

Output complete files I can copy verbatim.`;
}
