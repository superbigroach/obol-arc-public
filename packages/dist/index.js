#!/usr/bin/env node
// Obol MCP server — lets an AI agent discover and pay for metered APIs on its
// own, using Circle's official @circle-fin/x402-batching GatewayClient.
// Self-custody (Model A): signs with the agent's OWN key (OBOL_AGENT_KEY);
// Circle Gateway batches + settles on Arc.
//
// Env:
//   OBOL_AGENT_KEY    0x… private key of the agent's EOA (funded with testnet USDC)
//   OBOL_FACILITATOR  Obol directory base URL (default https://obol.dev)
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { GatewayClient } from "@circle-fin/x402-batching/client";
const FACILITATOR = (process.env.OBOL_FACILITATOR || "https://obol-arc.web.app").replace(/\/$/, "");
function client() {
    const key = process.env.OBOL_AGENT_KEY;
    if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) {
        throw new Error("OBOL_AGENT_KEY (0x… 32-byte hex) is required to pay for calls.");
    }
    return new GatewayClient({ chain: "arcTestnet", privateKey: key });
}
const server = new McpServer({ name: "obol", version: "0.1.0" });
server.tool("find_service", "Search the Obol directory for metered APIs an agent can pay for per call. Returns id, price (USDC), description, and the callable URL.", { query: z.string().optional().describe("keyword to match name/description/category") }, async ({ query }) => {
    const r = await fetch(`${FACILITATOR}/api/services`);
    const { services = [] } = (await r.json());
    const q = (query || "").toLowerCase();
    const matched = services
        .filter((s) => !q || JSON.stringify(s).toLowerCase().includes(q))
        .map((s) => ({
        id: s.id,
        name: s.name,
        price: s.priceUsdc + " USDC/call",
        category: s.category,
        description: s.description,
        // self-describing "skill" so the agent knows how to call it
        inputParams: s.inputSchema || "(see docs)",
        docs: s.docsUrl || null,
        callUrl: s.hostedUrl || `${FACILITATOR}/api/call/${s.id}`,
    }));
    return { content: [{ type: "text", text: JSON.stringify(matched, null, 2) }] };
});
server.tool("deposit", "Fund the agent's Gateway balance once (gas-free spending afterward). Amount in USDC, e.g. '5'.", { amount: z.string().describe("USDC amount to deposit, e.g. '5'") }, async ({ amount }) => {
    try {
        const r = await client().deposit(amount);
        return { content: [{ type: "text", text: `Deposited ${r.formattedAmount} USDC · tx ${r.depositTxHash}` }] };
    }
    catch (e) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
    }
});
server.tool("pay_and_call", "Pay for and call an Obol metered service via Circle Gateway. Pass the service's callUrl from find_service. Returns the API result and the settlement tx.", {
    callUrl: z.string().describe("the service's callUrl (hosted URL) from find_service"),
    params: z.record(z.string()).optional().describe("query params to pass to the API"),
    method: z.enum(["GET", "POST"]).optional(),
    maxPrice: z.number().optional().describe("max USDC to pay for this call (default 1.0)"),
}, async ({ callUrl, params, method, maxPrice }) => {
    const u = new URL(callUrl);
    for (const [k, v] of Object.entries(params || {}))
        u.searchParams.set(k, v);
    try {
        const c = client();
        const cap = maxPrice ?? 1.0;
        c.onBeforePaymentCreation(async (ctx) => {
            if (Number(BigInt(ctx.selectedRequirements.amount)) / 1e6 > cap) {
                return { abort: true, reason: `price exceeds maxPrice ${cap}` };
            }
        });
        const r = await c.pay(u.toString(), { method: method ?? "GET" });
        return {
            content: [{
                    type: "text",
                    text: JSON.stringify({ data: r.data, paid: r.formattedAmount + " USDC", tx: r.transaction }, null, 2),
                }],
        };
    }
    catch (e) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
    }
});
server.tool("list_service", "List (publish) a new service on the Obol marketplace so other agents can discover and pay for it. " +
    "Requires the seller's Obol API key (OBOL_API_KEY env). Obol auto-issues a real ACK-ID verifiable " +
    "credential for the seller's wallet and returns the marketplace URL. The seller just describes the " +
    "service in natural language — you fill in these fields.", {
    name: z.string().describe("short service name shown to buyers, e.g. 'Crypto Price API'"),
    hostedUrl: z.string().describe("the public https:// endpoint agents will call"),
    priceUsdc: z.string().describe("USDC price per call, e.g. '0.001'"),
    description: z.string().optional().describe("what the service does and what it returns"),
    category: z.string().optional().describe("e.g. Data, AI, Scraper, Tools"),
    inputSchema: z.string().optional().describe("input params, e.g. 'coin: string'"),
    docsUrl: z.string().optional(),
    skillMarkdown: z.string().optional().describe("optional markdown skill doc; auto-generated if omitted"),
}, async (args) => {
    const apiKey = process.env.OBOL_API_KEY;
    if (!apiKey || !apiKey.startsWith("obl_sk_live_")) {
        return { content: [{ type: "text", text: "Set OBOL_API_KEY (obl_sk_live_…) to list a service. Create one in Settings on obol-arc.web.app." }], isError: true };
    }
    try {
        const r = await fetch(`${FACILITATOR}/api/register-service`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ apiKey, ...args }),
        });
        const out = (await r.json());
        if (!r.ok || !out.ok) {
            return { content: [{ type: "text", text: `Error: ${out.error ?? r.statusText}` }], isError: true };
        }
        return {
            content: [{
                    type: "text",
                    text: `✅ ${out.message}\nMarketplace: ${out.marketplaceUrl}\nACK-ID: ${out.ackDid}\nIssuer: ${out.ackIssuer}`,
                }],
        };
    }
    catch (e) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
    }
});
server.tool("get_balance", "Get the agent wallet + Gateway USDC balances on Arc testnet.", {}, async () => {
    try {
        const c = client();
        const b = await c.getBalances();
        return {
            content: [{
                    type: "text",
                    text: `${c.address}\nwallet: ${b.wallet.formatted} USDC\nGateway available: ${b.gateway.formattedAvailable} USDC`,
                }],
        };
    }
    catch (e) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
    }
});
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("Obol MCP server running on stdio →", FACILITATOR);
