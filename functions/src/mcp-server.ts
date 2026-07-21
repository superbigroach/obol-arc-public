import { onRequest } from "firebase-functions/v2/https";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { createHash } from "node:crypto";
import * as admin from "firebase-admin";

const FACILITATOR = "https://obol-arc.web.app";

async function verifyApiKey(rawKey: string) {
  if (!rawKey?.startsWith("obl_sk_live_")) return null;
  const keyHash = createHash("sha256").update(rawKey).digest("hex");
  const doc = await admin.firestore().collection("apiKeys").doc(keyHash).get();
  if (!doc.exists || doc.data()?.revoked) return null;
  return { uid: doc.data()!.uid };
}

function registerTools(server: McpServer, apiKey: string) {
  server.tool(
    "find_service",
    "Search the Obol marketplace for metered APIs agents can pay for per call.",
    { query: z.string().optional().describe("keyword to match name/description/category") },
    async ({ query }) => {
      const r = await fetch(`${FACILITATOR}/api/services`);
      const { services = [] } = (await r.json()) as { services?: Record<string, unknown>[] };
      const q = (query || "").toLowerCase();
      const matched = services
        .filter((s) => !q || JSON.stringify(s).toLowerCase().includes(q))
        .map((s) => {
          // A listing can bundle many endpoints (each its own path + price). Surface
          // them so the agent sees the whole menu and can pay_and_call any one. Each
          // endpoint's live x402 price is charged at call time; `endpoints[].priceUsdc`
          // is the advertised price. Falls back to the single callUrl if none listed.
          const eps = Array.isArray(s.endpoints) ? (s.endpoints as Record<string, unknown>[]) : [];
          const endpoints = eps.map((e) => ({
            callUrl: String(e.url ?? e.path ?? e.callUrl ?? ""),
            price: (e.priceUsdc != null ? `${e.priceUsdc} USDC/call` : `${s.priceUsdc} USDC/call`),
            description: String(e.description ?? e.desc ?? ""),
          })).filter((e) => e.callUrl);
          return { id: s.id, name: s.name, price: `${s.priceUsdc} USDC/call`, category: s.category, description: s.description, callUrl: s.hostedUrl, ...(endpoints.length ? { endpoints } : {}) };
        });
      return { content: [{ type: "text" as const, text: JSON.stringify(matched, null, 2) }] };
    }
  );

  server.tool(
    "pay_and_call",
    "Pay for and call an Obol metered service. Deducts from your Obol API credits.",
    {
      callUrl: z.string().describe("the service callUrl from find_service"),
      params: z.record(z.string(), z.unknown()).optional(),
      method: z.enum(["GET", "POST"]).optional(),
      maxPrice: z.number().optional(),
    },
    async ({ callUrl, params, method, maxPrice }) => {
      const r = await fetch(`${FACILITATOR}/api/pay-and-call`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ apiKey, callUrl, params, method, maxPrice }),
      });
      const data = await r.json() as Record<string, unknown>;
      if (!r.ok) return { content: [{ type: "text" as const, text: `Error: ${data.error}` }], isError: true };
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "get_balance",
    "Get your Obol API credits balance (pre-paid USDC for calling services).",
    {},
    async () => {
      const r = await fetch(`${FACILITATOR}/api/agent-balance?apiKey=${encodeURIComponent(apiKey)}`);
      const data = await r.json() as { spendingBalance?: string; agentWallet?: string; error?: string };
      if (!r.ok) return { content: [{ type: "text" as const, text: `Error: ${data.error}` }], isError: true };
      return { content: [{ type: "text" as const, text: `Balance: $${data.spendingBalance} USDC\nWallet: ${data.agentWallet}` }] };
    }
  );

  server.tool(
    "list_service",
    "Publish a new metered API on the Obol marketplace so other agents can discover and pay for it. To bundle several endpoints under one listing, pass `endpoints` (each with its own url + price); otherwise a single hostedUrl + priceUsdc is fine.",
    {
      name: z.string(),
      hostedUrl: z.string(),
      priceUsdc: z.string(),
      description: z.string().optional(),
      category: z.string().optional(),
      inputSchema: z.string().optional(),
      endpoints: z.array(z.object({
        url: z.string().describe("full https URL of this endpoint"),
        priceUsdc: z.string().optional().describe("price for this endpoint (defaults to the listing price / live x402 price)"),
        description: z.string().optional(),
      })).optional().describe("optional: bundle multiple priced endpoints under this one listing"),
    },
    async (args) => {
      const r = await fetch(`${FACILITATOR}/api/register-service`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ apiKey, ...args }),
      });
      const data = await r.json() as { ok?: boolean; error?: string; marketplaceUrl?: string; ackDid?: string };
      if (!r.ok || !data.ok) return { content: [{ type: "text" as const, text: `Error: ${data.error}` }], isError: true };
      return { content: [{ type: "text" as const, text: `Listed "${args.name}"\nMarketplace: ${data.marketplaceUrl}\nACK-ID: ${data.ackDid}` }] };
    }
  );

  server.tool(
    "rate_service",
    "Rate a service you just used on Obol (1-5 stars). Your rating helps other agents find quality services.",
    {
      serviceId: z.string().describe("the service ID from find_service"),
      rating: z.number().min(1).max(5).describe("your rating: 1 (poor) to 5 (excellent)"),
      comment: z.string().optional().describe("optional feedback comment"),
    },
    async ({ serviceId, rating, comment }) => {
      const r = await fetch(`${FACILITATOR}/api/rate-service`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ apiKey, serviceId, rating: Math.round(rating), comment }),
      });
      const data = await r.json() as { ok?: boolean; error?: string; avgRating?: number; ratingCount?: number };
      if (!r.ok || !data.ok) return { content: [{ type: "text" as const, text: `Error: ${data.error}` }], isError: true };
      return { content: [{ type: "text" as const, text: `Rated ⭐ ${rating}/5${comment ? ` with comment: "${comment}"` : ""}\nService now has ${data.avgRating?.toFixed(1)} avg rating from ${data.ratingCount} ratings.` }] };
    }
  );

  server.tool(
    "depositToGateway",
    "Deposit USDC to your Circle Gateway account to make nanopayment API calls (x402 standard, zero gas).",
    {
      amount: z.string().describe("amount in USDC (e.g. '50')"),
      network: z.enum(["arc", "base", "ethereum"]).optional().describe("network to deposit on (default: arc testnet)"),
    },
    async ({ amount, network = "arc" }) => {
      const r = await fetch(`${FACILITATOR}/api/deposit-gateway`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ apiKey, amount, network }),
      });
      const data = await r.json() as { ok?: boolean; error?: string; txHash?: string; gatewayBalance?: string };
      if (!r.ok || !data.ok) return { content: [{ type: "text" as const, text: `Error: ${data.error}` }], isError: true };
      return { content: [{ type: "text" as const, text: `✅ Deposited $${amount} USDC to Gateway on ${network}\nTx: ${data.txHash}\nGateway balance: $${data.gatewayBalance}` }] };
    }
  );

  server.tool(
    "getGatewayBalance",
    "Check your Circle Gateway account balance (available for nanopayment API calls).",
    {},
    async () => {
      const r = await fetch(`${FACILITATOR}/api/gateway-balance?apiKey=${encodeURIComponent(apiKey)}`);
      const data = await r.json() as { balance?: string; availableCalls?: number; error?: string };
      if (!r.ok) return { content: [{ type: "text" as const, text: `Error: ${data.error}` }], isError: true };
      return { content: [{ type: "text" as const, text: `Gateway Balance: $${data.balance} USDC\nAvailable calls: ~${data.availableCalls} (at $0.001 each)\n\nYou can make ${data.availableCalls} nanopayment API calls before topping up.` }] };
    }
  );

  server.tool(
    "withdrawFromGateway",
    "Withdraw USDC from your Circle Gateway account back to your wallet on any supported chain.",
    {
      amount: z.string().describe("amount in USDC to withdraw"),
      recipient: z.string().describe("recipient wallet address (0x...)"),
      network: z.enum(["arc", "base", "ethereum", "avalanche", "optimism", "arbitrum", "polygon"]).optional().describe("settlement network (default: arc)"),
    },
    async ({ amount, recipient, network = "arc" }) => {
      const r = await fetch(`${FACILITATOR}/api/withdraw-gateway`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ apiKey, amount, recipient, network }),
      });
      const data = await r.json() as { ok?: boolean; error?: string; txHash?: string; newBalance?: string };
      if (!r.ok || !data.ok) return { content: [{ type: "text" as const, text: `Error: ${data.error}` }], isError: true };
      return { content: [{ type: "text" as const, text: `✅ Withdrawing $${amount} USDC to ${recipient}\nTx: ${data.txHash}\nNew gateway balance: $${data.newBalance}` }] };
    }
  );
}

export const mcpServer = onRequest(
  { region: "us-central1", cors: true, memory: "256MiB" },
  async (req, res) => {
    const apiKey = (req.headers["x-obol-api-key"] as string) || (req.query.apiKey as string) || "";

    const server = new McpServer({ name: "obol", version: "0.1.1" });
    registerTools(server, apiKey);

    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } finally {
      await server.close();
    }
  }
);
