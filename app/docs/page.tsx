"use client";

import Link from "next/link";
import { useState, useEffect, useRef } from "react";
import SiteNav from "@/components/SiteNav";
import SiteFooter from "@/components/SiteFooter";
import { useAuth } from "@/components/AuthProvider";
import { getProfile } from "@/lib/clientStore";

// ─── Types ────────────────────────────────────────────────────────────────────
type Section = { id: string; label: string; sub?: { id: string; label: string }[] };

// ─── The Obol Skill — paste into any LLM to scaffold + deploy a service ────────
function buildObolSkill(sellerAddr: string): string {
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

# THE STACK (use these EXACT packages — do not substitute)

  npm install express @circle-fin/x402-batching

Server skeleton (ESM, Node 18+):

  import express from "express";
  import { createGatewayMiddleware } from "@circle-fin/x402-batching/server";

  const app = express();
  app.use(express.json());

  const SELLER = process.env.SELLER_ADDRESS;            // my Arc wallet
  const gateway = createGatewayMiddleware({
    sellerAddress: SELLER,
    networks: "eip155:5042002",                         // Arc testnet
    facilitatorUrl: "https://gateway-api-testnet.circle.com",
  });

  // Each paid route: gateway.require("$<price>") sets the USDC price per call.
  app.get("/price", gateway.require("$0.001"), async (req, res) => {
    // ... my logic ...
    res.json({ /* result */, paidBy: req.payment?.payer });
  });

  app.get("/health", (_req, res) => res.json({ ok: true })); // free, unmetered
  app.listen(process.env.PORT || 4021);

# THE SERVICE I WANT TO BUILD (default — change if I tell you otherwise)

A **Crypto Price API**. It wraps CoinGecko's FREE public endpoint (no API key needed):

  GET https://api.coingecko.com/api/v3/simple/price?ids=<coin>&vs_currencies=usd

Expose one paid route:
  GET /price?coin=bitcoin   → charge $0.001 USDC → return { coin, usd, ts }
Validate the coin param, handle CoinGecko errors gracefully, and always include
\`paidBy: req.payment?.payer\` in the response so I can see who called.

# WHAT TO DO, STEP BY STEP

1. Create the project: package.json (type: module), the server file, a .env with
   SELLER_ADDRESS=${sellerAddr} and PORT=4021, and a .gitignore that excludes .env.
2. Write the full server. Production-quality: input validation, try/catch around the
   upstream fetch, clear JSON errors, a brief comment on each route's price.
3. Give me the exact commands to install deps and run it locally.
4. Tell me how to expose it publicly for testing in ONE command:
     npx localtunnel --port 4021     (gives a https://<name>.loca.lt URL)
   …and how to deploy permanently to Railway or Render (free tier): push to GitHub,
   create the project, set env var SELLER_ADDRESS=${sellerAddr}, get the public URL.
5. Tell me precisely what to enter when I register it at obol-arc.web.app/dashboard
   → Provide services → + New service:
     - Service name, Category, Description
     - Price per call (USDC), Payout address (${sellerAddr}), Hosted URL (my public URL)
     - Input params (e.g. "coin: string")
6. Finally, give me a one-line curl I can run to confirm the route returns 402 before
   payment (proof the metering works):  curl -i <my-url>/price?coin=bitcoin

Build everything now. Output complete files I can copy verbatim — no placeholders
except where I must paste my deployed URL. Be concise but complete.`;
}

// ─── Sidebar structure ────────────────────────────────────────────────────────
const NAV: Section[] = [
  { id: "overview",      label: "Overview" },
  { id: "ai-quickstart", label: "Build with AI ✨" },
  { id: "quickstart",    label: "Quick start" },
  {
    id: "providers", label: "Providers (Sellers)",
    sub: [
      { id: "provider-how",      label: "How it works" },
      { id: "provider-code",     label: "Wrap your API" },
      { id: "provider-multiep",  label: "Per-endpoint pricing" },
      { id: "provider-keys",     label: "API keys & secrets" },
      { id: "provider-examples", label: "Real examples" },
      { id: "provider-deploy",   label: "Deploying your server" },
      { id: "provider-register", label: "Register in dashboard" },
    ],
  },
  {
    id: "buyers", label: "Buyers (Agents)",
    sub: [
      { id: "buyer-how",     label: "How it works" },
      { id: "buyer-fund",    label: "Fund your agent" },
      { id: "buyer-sdk",     label: "SDK usage" },
      { id: "buyer-mcp",     label: "MCP configuration" },
    ],
  },
  {
    id: "dashboard", label: "Dashboard guide",
    sub: [
      { id: "dash-wallet",    label: "Wallet setup" },
      { id: "dash-provide",  label: "Provide services" },
      { id: "dash-use",      label: "Use services" },
      { id: "dash-withdraw", label: "Bridge & withdraw" },
    ],
  },
  {
    id: "reference", label: "Reference",
    sub: [
      { id: "ref-networks", label: "Supported networks" },
      { id: "ref-fees",     label: "Pricing & fees" },
      { id: "ref-402",      label: "HTTP 402 explained" },
      { id: "ref-wallets",  label: "Wallet types" },
    ],
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function Code({ children, lang = "js" }: { children: string; lang?: string }) {
  const [copied, setCopied] = useState(false);
  void lang;
  return (
    <div className="relative my-4">
      <pre className="overflow-x-auto rounded-xl border border-zinc-800 bg-[#0c0a1f] p-5 font-mono text-[12.5px] leading-relaxed text-zinc-100 whitespace-pre">
        {children}
      </pre>
      <button
        onClick={async () => { await navigator.clipboard.writeText(children).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 1400); }}
        className="absolute right-3 top-3 rounded-[7px] border border-zinc-700 bg-zinc-800 px-2.5 py-1 text-[11px] font-semibold text-zinc-300 hover:bg-zinc-700"
      >{copied ? "Copied ✓" : "Copy"}</button>
    </div>
  );
}

function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="mt-14 scroll-mt-24 text-[26px] font-extrabold tracking-[-.03em] text-zinc-900 border-b border-zinc-200 pb-3">
      {children}
    </h2>
  );
}

function H3({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h3 id={id} className="mt-10 scroll-mt-24 text-[19px] font-bold tracking-[-.02em] text-zinc-900">
      {children}
    </h3>
  );
}

function Callout({ color = "blue", children }: { color?: "blue" | "amber" | "green" | "purple"; children: React.ReactNode }) {
  const styles = {
    blue:   "border-blue-200 bg-blue-50 text-blue-900",
    amber:  "border-amber-200 bg-amber-50 text-amber-900",
    green:  "border-green-200 bg-green-50 text-green-900",
    purple: "border-purple-200 bg-purple-50 text-purple-900",
  };
  return <div className={`my-4 rounded-[12px] border px-5 py-4 text-[14px] leading-relaxed ${styles[color]}`}>{children}</div>;
}

function Table({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div className="my-4 overflow-x-auto rounded-[12px] border border-zinc-200">
      <table className="w-full text-[13.5px]">
        <thead className="bg-zinc-50">
          <tr>{headers.map(h => <th key={h} className="px-4 py-3 text-left font-semibold text-zinc-700 border-b border-zinc-200">{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className={i % 2 === 0 ? "bg-white" : "bg-zinc-50/50"}>
              {row.map((cell, j) => <td key={j} className="px-4 py-3 text-zinc-700 border-b border-zinc-100 font-mono">{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── AI Quickstart — the headline "build it with your LLM" block ───────────────
function AiQuickstart({ sellerAddr }: { sellerAddr: string }) {
  const [copied, setCopied] = useState(false);
  const skill = buildObolSkill(sellerAddr);

  async function copy() {
    await navigator.clipboard.writeText(skill).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  function download() {
    const blob = new Blob([skill], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "obol-skill.md";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section id="ai-quickstart" className="scroll-mt-24 mt-12">
      <div className="relative overflow-hidden rounded-[20px] border border-[#6d5ef6]/30 bg-gradient-to-br from-[#0c0a1f] to-[#1a1340] p-7 sm:p-9 text-white shadow-[0_20px_60px_rgba(109,94,246,.18)]">
        {/* glow */}
        <div className="pointer-events-none absolute -right-20 -top-20 h-[260px] w-[260px] rounded-full bg-[#6d5ef6]/30 blur-[80px]" />
        <div className="relative">
          <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[.06] px-3 py-1 text-[12px] font-bold uppercase tracking-[.06em] text-[#cfd2ff]">
            ✨ Build with AI · 2-minute setup
          </div>
          <h2 className="text-[26px] sm:text-[30px] font-extrabold tracking-[-.03em] leading-tight">
            Don&apos;t write a line of code.<br />Let your AI build your service.
          </h2>
          <p className="mt-3 max-w-[620px] text-[15px] leading-relaxed text-[#a9abbd]">
            Obol is built for the agent economy — so building <i>on</i> Obol should use an agent too.
            Copy the Obol Skill below, paste it into <b className="text-white">Claude, ChatGPT, or Cursor</b>,
            and it will scaffold a working paid service, wire in your wallet, and walk you through deploying it.
            Your Arc payout address is already baked in.
          </p>

          <div className="mt-6 flex flex-wrap gap-3">
            <button
              onClick={copy}
              className="grad inline-flex items-center gap-2 rounded-[11px] px-5 py-3 text-[14px] font-bold text-white shadow-[0_4px_16px_rgba(109,94,246,.4)] transition hover:-translate-y-px"
            >
              {copied ? "Copied to clipboard ✓" : "📋 Copy the Obol Skill"}
            </button>
            <button
              onClick={download}
              className="inline-flex items-center gap-2 rounded-[11px] border border-white/20 bg-white/[.08] px-5 py-3 text-[14px] font-semibold text-white transition hover:bg-white/[.14]"
            >
              ⬇ Download obol-skill.md
            </button>
          </div>

          {/* mini-steps */}
          <div className="mt-7 grid gap-3 sm:grid-cols-3">
            {[
              ["1", "Copy the skill", "One click above — your wallet is already in it."],
              ["2", "Paste into your AI", "Claude, ChatGPT, Cursor — any capable model."],
              ["3", "Deploy & register", "Your AI hands you the server + deploy steps."],
            ].map(([n, h, p]) => (
              <div key={n} className="rounded-[12px] border border-white/10 bg-white/[.04] p-4">
                <div className="flex h-7 w-7 items-center justify-center rounded-[8px] bg-white/10 text-[12px] font-bold text-[#cfd2ff]">{n}</div>
                <div className="mt-2.5 text-[13.5px] font-bold text-white">{h}</div>
                <div className="mt-0.5 text-[12.5px] text-[#9a9cb0]">{p}</div>
              </div>
            ))}
          </div>

          {/* preview of the skill */}
          <details className="mt-6 group">
            <summary className="cursor-pointer list-none text-[13px] font-semibold text-[#cfd2ff] hover:text-white">
              <span className="group-open:hidden">▸ Preview the skill prompt</span>
              <span className="hidden group-open:inline">▾ Hide preview</span>
            </summary>
            <pre className="mt-3 max-h-[320px] overflow-auto rounded-[12px] border border-white/10 bg-black/30 p-4 font-mono text-[11.5px] leading-relaxed text-zinc-300 whitespace-pre-wrap">
              {skill}
            </pre>
          </details>
        </div>
      </div>

      <Callout color="blue">
        <b>Prefer to do it by hand?</b> The full manual walkthrough is right below — install the SDK,
        wrap your endpoint, deploy, and register. The AI skill just does all of it for you.
      </Callout>
    </section>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function DocsPage() {
  const { user } = useAuth();
  const [agentAddress, setAgentAddress] = useState<string | null>(null);
  const [activeId, setActiveId] = useState("overview");
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!user) return;
    getProfile(user.uid).then(p => setAgentAddress(p?.obolWalletAddress ?? p?.address ?? null)).catch(() => {});
  }, [user]);

  // Scrollspy
  useEffect(() => {
    const allIds = NAV.flatMap(s => [s.id, ...(s.sub?.map(x => x.id) ?? [])]);
    const observer = new IntersectionObserver(
      entries => {
        const visible = entries.filter(e => e.isIntersecting);
        if (visible.length > 0) setActiveId(visible[0].target.id);
      },
      { rootMargin: "-20% 0px -70% 0px" }
    );
    allIds.forEach(id => { const el = document.getElementById(id); if (el) observer.observe(el); });
    return () => observer.disconnect();
  }, []);

  const sellerAddr = agentAddress ?? "0xYourArcAddress";

  return (
    <div className="flex min-h-screen flex-col bg-white text-zinc-900">
      <SiteNav />

      <div className="mx-auto flex w-full max-w-[1200px] flex-1 gap-0 px-4 sm:px-6">

        {/* ── Sidebar ── */}
        <aside className="hidden lg:block w-[220px] shrink-0 sticky top-[68px] self-start h-[calc(100vh-68px)] overflow-y-auto py-10 pr-6">
          <div className="text-[11px] font-bold uppercase tracking-[.08em] text-zinc-400 mb-3">Documentation</div>
          <nav className="flex flex-col gap-0.5">
            {NAV.map(section => (
              <div key={section.id}>
                <a
                  href={`#${section.id}`}
                  className={`block rounded-[7px] px-3 py-1.5 text-[13px] font-semibold transition ${activeId === section.id ? "bg-[rgba(109,94,246,.1)] text-[#6d5ef6]" : "text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100"}`}
                >
                  {section.label}
                </a>
                {section.sub && (
                  <div className="ml-3 mt-0.5 flex flex-col gap-0.5 border-l border-zinc-200 pl-3">
                    {section.sub.map(sub => (
                      <a
                        key={sub.id}
                        href={`#${sub.id}`}
                        className={`block rounded-[6px] px-2 py-1 text-[12px] transition ${activeId === sub.id ? "text-[#6d5ef6] font-semibold" : "text-zinc-500 hover:text-zinc-800"}`}
                      >
                        {sub.label}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </nav>
        </aside>

        {/* ── Content ── */}
        <main ref={contentRef} className="flex-1 min-w-0 py-10 lg:pl-10 max-w-[760px]">

          {/* ── OVERVIEW ── */}
          <div className="mb-2 text-[12px] font-bold uppercase tracking-[.08em] text-[#6d5ef6]">Obol Docs</div>
          <h1 id="overview" className="scroll-mt-24 text-[42px] font-extrabold tracking-[-.04em] text-zinc-900 leading-tight">
            Developer documentation
          </h1>
          <p className="mt-4 text-[17px] text-zinc-600 leading-relaxed max-w-[600px]">
            Obol is a marketplace where any API, scraper, bot, model, or data process can charge AI agents per call in USDC — with no billing system, no subscriptions, and no user accounts.
          </p>
          <p className="mt-3 text-[15px] text-zinc-500 leading-relaxed max-w-[600px]">
            New here? Skip the reading — <a href="#ai-quickstart" className="font-semibold text-[#6d5ef6] hover:underline">build your first service with AI in 2 minutes ↓</a>
          </p>

          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            {[
              ["Network", "Arc testnet · chain 5042002"],
              ["Payment", "USDC via Circle Gateway (x402)"],
              ["Fee", "0% commission · free per call"],
            ].map(([k, v]) => (
              <div key={k} className="rounded-[14px] border border-zinc-200 bg-zinc-50 p-5">
                <div className="text-[11px] font-bold uppercase tracking-[.05em] text-zinc-400">{k}</div>
                <div className="mt-1 text-[14px] font-semibold text-zinc-900">{v}</div>
              </div>
            ))}
          </div>

          <div className="mt-8 rounded-[14px] border border-zinc-200 bg-white p-6">
            <div className="text-[15px] font-bold text-zinc-900">Two roles, one marketplace</div>
            <div className="mt-4 grid sm:grid-cols-2 gap-4">
              <div className="rounded-[10px] bg-[rgba(109,94,246,.06)] border border-[#6d5ef6]/20 p-4">
                <div className="text-[13px] font-bold text-[#6d5ef6] mb-1">Provider (Seller)</div>
                <div className="text-[13px] text-zinc-700">You own something useful — an API, a scraper, a model. You wrap it with Obol middleware and get paid per call in USDC, settled to your Arc wallet.</div>
              </div>
              <div className="rounded-[10px] bg-amber-50 border border-amber-200 p-4">
                <div className="text-[13px] font-bold text-amber-700 mb-1">Buyer (Agent)</div>
                <div className="text-[13px] text-zinc-700">Your AI agent discovers services in the Obol marketplace, deposits USDC into Circle Gateway once, then pays per call automatically — no manual signing per request.</div>
              </div>
            </div>
          </div>

          {/* ── AI QUICKSTART ── */}
          <AiQuickstart sellerAddr={sellerAddr} />

          {/* ── QUICK START ── */}
          <H2 id="quickstart">Quick start</H2>
          <p className="mt-1 text-[14px] text-zinc-500">Prefer the manual route? Here&apos;s every step by hand.</p>
          <p className="mt-3 text-[15px] text-zinc-600">Get from zero to a live paid API endpoint in under 10 minutes.</p>

          <div className="mt-6 flex flex-col gap-4">
            {[
              { n: "1", title: "Create your wallet", body: "Go to Dashboard → Use services → click \"Create my wallet\". Set a PIN — Obol never holds your keys. You'll get an Arc testnet EOA address. Copy it." },
              { n: "2", title: "Get testnet USDC", body: "Visit faucet.circle.com and request USDC on Arc testnet to your new wallet address. You'll need this to test both sending and receiving payments." },
              { n: "3", title: "For sellers: wrap an endpoint", body: "Install the SDK, add one middleware call to your Express route, run the server. See Providers section for the full code." },
              { n: "4", title: "For buyers: deposit & call", body: "Deposit USDC into Gateway once via your dashboard. After that, every API call is automatically paid — no confirmation per request." },
            ].map(({ n, title, body }) => (
              <div key={n} className="flex gap-4">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-gradient-to-br from-[#6d5ef6] to-[#3b9eff] text-[13px] font-bold text-white">{n}</div>
                <div>
                  <div className="text-[15px] font-bold text-zinc-900">{title}</div>
                  <div className="mt-1 text-[14px] text-zinc-600">{body}</div>
                </div>
              </div>
            ))}
          </div>

          <Callout color="blue">
            <b>Testnet only.</b> Obol currently runs on Arc testnet (chain ID 5042002). All USDC is testnet USDC — no real money. Get free testnet USDC at <b>faucet.circle.com</b>.
          </Callout>

          {/* ── PROVIDERS ── */}
          <H2 id="providers">Providers (Sellers)</H2>
          <p className="mt-3 text-[15px] text-zinc-600">
            A provider runs a server that does something useful and charges agents per HTTP call. You decide what runs behind the endpoint — Obol only sees the request and response.
          </p>

          <H3 id="provider-how">How it works</H3>
          <p className="mt-2 text-[14px] text-zinc-600 leading-relaxed">
            You add Obol middleware to any Express route. When an agent calls that route without payment, your server returns HTTP 402 (Payment Required) with Circle Gateway payment details. The agent's SDK automatically pays and retries. Your server processes the request and the earnings land in your Arc wallet.
          </p>
          <Code>{`Agent calls your URL
  → No payment header → your server returns 402 + payment details
  → Agent's SDK pays Circle Gateway (~200ms, off-chain)
  → Agent retries with payment proof
  → Your middleware verifies payment
  → Your handler runs, returns data
  → Earnings settle to your Arc address`}</Code>

          <H3 id="provider-code">Wrap your API</H3>
          <p className="mt-2 text-[14px] text-zinc-600">Install the SDK and add middleware to any Express route.</p>

          <Code lang="bash">{`# In your server project
npm install @circle-fin/x402-batching express`}</Code>

          <p className="mt-4 text-[14px] font-semibold text-zinc-900">Minimal example — single endpoint</p>
          <Code>{`import express from "express";
import { createGatewayMiddleware } from "@circle-fin/x402-batching/server";

const app = express();

// Replace with your UCW wallet address from the Obol dashboard
const SELLER = process.env.SELLER_ADDRESS;

const gateway = createGatewayMiddleware({
  sellerAddress: SELLER,
  networks: "eip155:5042002",                          // Arc testnet
  facilitatorUrl: "https://gateway-api-testnet.circle.com",
});

// $0.002 USDC per call to this route
app.get("/enrich", gateway.require("$0.002"), (req, res) => {
  const domain = req.query.domain || "example.com";
  res.json({
    domain,
    company: "Acme Inc.",
    // req.payment is populated after a successful payment
    paidBy: req.payment?.payer,
    txHash: req.payment?.transaction,
  });
});

app.listen(4021);`}</Code>

          <Callout color="green">
            <b>req.payment</b> is injected by the middleware after a verified payment. It contains <b>payer</b> (the buyer's Arc address) and <b>transaction</b> (the settlement tx hash). Use these for receipts, usage logging, or per-user rate limiting.
          </Callout>

          <H3 id="provider-multiep">Per-endpoint pricing</H3>
          <p className="mt-2 text-[14px] text-zinc-600">
            Different routes can have different prices. Call <code className="rounded bg-zinc-100 px-1.5 font-mono text-[12px]">gateway.require()</code> independently on each route.
          </p>
          <Code>{`const gateway = createGatewayMiddleware({
  sellerAddress: SELLER,
  networks: "eip155:5042002",
  facilitatorUrl: "https://gateway-api-testnet.circle.com",
});

// Cheap: basic lookup
app.get("/company/basic", gateway.require("$0.001"), (req, res) => {
  res.json({ name: "Acme Inc.", country: "US" });
});

// Medium: full profile
app.get("/company/full", gateway.require("$0.005"), (req, res) => {
  res.json({ name: "Acme Inc.", headcount: 420, revenue: "$12M", ... });
});

// Expensive: bulk batch (up to 50 domains per call)
app.post("/company/bulk", gateway.require("$0.050"), async (req, res) => {
  const { domains } = req.body;
  const results = await enrichAll(domains);   // your own logic
  res.json({ results, count: results.length });
});

// Free: health check (no middleware = no payment required)
app.get("/health", (_req, res) => res.json({ ok: true }));`}</Code>

          <Callout color="amber">
            Register each endpoint path + its price separately in the Obol dashboard under <b>Per-endpoint pricing</b>. This lets agents discover which paths exist and what each costs before calling. You can also leave a route unlisted if you only want direct callers.
          </Callout>

          <H3 id="provider-keys">API keys &amp; secrets</H3>
          <p className="mt-2 text-[14px] text-zinc-600 leading-relaxed">
            When you wrap a paid third-party API, <b>your API key stays on your server</b>. Buyers never see it. They call your URL and pay — your server uses its key to call the upstream service on their behalf.
          </p>
          <Code>{`# Your server's environment — buyers never see any of this
SELLER_ADDRESS=0xYourArcWallet
OPENAI_API_KEY=sk-...
SOME_DATA_API_KEY=abc123
SCRAPER_PROXY_PASSWORD=xyz789`}</Code>

          <div className="mt-4 rounded-[12px] border border-zinc-200 bg-zinc-50 p-5 text-[13.5px] text-zinc-700 leading-relaxed">
            <b className="text-zinc-900">The economics:</b> You pay your upstream API $0.01/call. You charge agents $0.015/call through Obol. You keep $0.005 per call. The agent doesn't need an API key, a credit card, or an account anywhere — they just have USDC.
          </div>

          <H3 id="provider-examples">Real examples</H3>

          <p className="mt-2 mb-1 text-[14px] font-semibold text-zinc-900">Example 1 — Wrap OpenAI completions</p>
          <Code>{`import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// You pay OpenAI ~$0.002/call (GPT-4o-mini).
// You charge agents $0.004/call → $0.002 margin per call.
app.post("/complete", gateway.require("$0.004"), async (req, res) => {
  const { prompt } = req.body;
  const chat = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
  });
  res.json({
    result: chat.choices[0].message.content,
    paidBy: req.payment?.payer,
  });
});`}</Code>

          <p className="mt-4 mb-1 text-[14px] font-semibold text-zinc-900">Example 2 — Wrap a Puppeteer scraper</p>
          <Code>{`import puppeteer from "puppeteer";

// Agents pay $0.01 per page scrape. You pay server costs (~$0.001).
app.get("/scrape", gateway.require("$0.010"), async (req, res) => {
  const { url } = req.query;
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: "networkidle2" });
  const text = await page.evaluate(() => document.body.innerText);
  await browser.close();
  res.json({ url, text, charCount: text.length, paidBy: req.payment?.payer });
});`}</Code>

          <p className="mt-4 mb-1 text-[14px] font-semibold text-zinc-900">Example 3 — Wrap a premium weather API (you hold the key)</p>
          <Code>{`// Agents call your endpoint and pay $0.001.
// Your server calls the premium API with your key.
// Agents never see your key.
app.get("/weather", gateway.require("$0.001"), async (req, res) => {
  const { city } = req.query;
  const r = await fetch(
    \`https://api.weatherapi.com/v1/current.json?key=\${process.env.WEATHER_KEY}&q=\${city}\`
  );
  const data = await r.json();
  res.json({
    city: data.location.name,
    temp_c: data.current.temp_c,
    condition: data.current.condition.text,
    paidBy: req.payment?.payer,
  });
});`}</Code>

          <H3 id="provider-deploy">Deploying your server</H3>
          <p className="mt-2 text-[14px] text-zinc-600">
            Your server needs a permanent public HTTPS URL. Any Node.js host works. For testing you can use localtunnel (no install needed). For production deploy to Railway, Fly.io, or Google Cloud Run.
          </p>

          <Table
            headers={["Option", "Cost", "Setup time", "Best for"]}
            rows={[
              ["localtunnel (npx)", "Free", "10 seconds", "Local testing only"],
              ["Railway", "Free tier", "5 minutes", "Hackathons, demos"],
              ["Fly.io", "Free tier", "10 minutes", "Persistent low-traffic"],
              ["Google Cloud Run", "Free tier", "15 minutes", "Production"],
              ["Render", "Free tier", "5 minutes", "Simple deploys"],
            ]}
          />

          <p className="mt-4 mb-1 text-[14px] font-semibold text-zinc-900">Local testing with localtunnel</p>
          <Code lang="bash">{`# Terminal 1 — run your server
SELLER_ADDRESS=0xYourArcAddress node server.mjs

# Terminal 2 — expose it publicly (no install needed)
npx localtunnel --port 4021
# → your url is: https://happy-dogs-fly.loca.lt`}</Code>

          <p className="mt-4 mb-1 text-[14px] font-semibold text-zinc-900">Deploy to Railway (permanent URL)</p>
          <Code lang="bash">{`# 1. Push your server code to a GitHub repo

# 2. Go to railway.app → New Project → Deploy from GitHub

# 3. Set environment variables in Railway dashboard:
#    SELLER_ADDRESS = 0xYourArcAddress
#    PORT           = 4021
#    (any API keys your server needs)

# 4. Railway gives you a URL like:
#    https://your-project.railway.app
# Use that URL when registering in the Obol dashboard.`}</Code>

          <H3 id="provider-register">Register in the dashboard</H3>
          <p className="mt-2 text-[14px] text-zinc-600">
            Go to <b>Dashboard → Provide services → + New service</b> and fill in each field:
          </p>

          <Table
            headers={["Field", "What to enter", "Example"]}
            rows={[
              ["Service name", "Short name agents see in search", "Company Enrichment API"],
              ["Category", "Pick the closest match", "Data"],
              ["Price per call", "Default USDC price for one call", "0.002"],
              ["Payout address", "Your Arc wallet — auto-filled if wallet created", sellerAddr],
              ["Hosted URL", "Your server's public HTTPS URL", "https://your-app.railway.app"],
              ["Description", "What your API does, what it returns", "Returns company name, size, industry for any domain"],
              ["Input params", "Param names agents use to call it", "domain: string"],
              ["API docs URL", "Link to your docs (optional)", "https://your-docs.example.com"],
            ]}
          />

          <p className="mt-4 mb-1 text-[14px] font-semibold text-zinc-900">Per-endpoint pricing rows (optional)</p>
          <p className="mt-1 text-[14px] text-zinc-600">
            If your server has multiple routes at different prices, add one row per route. Leave empty to use the single price above for all routes.
          </p>
          <Table
            headers={["Path", "Price per call", "Description"]}
            rows={[
              ["/company/basic", "0.001", "Name and country only"],
              ["/company/full", "0.005", "Full profile with headcount and revenue"],
              ["/company/bulk", "0.050", "Batch of up to 50 domains"],
            ]}
          />

          <Callout color="purple">
            Once registered, your service appears in the <b>Marketplace</b> where agents can discover it. Agents call your hosted URL directly — Obol doesn&apos;t proxy the traffic. Payment happens between agent and your server via Circle Gateway.
          </Callout>

          {/* ── BUYERS ── */}
          <H2 id="buyers">Buyers (Agents)</H2>
          <p className="mt-3 text-[15px] text-zinc-600">
            A buyer is any AI agent or script that discovers services on Obol and pays per call automatically using Circle Gateway.
          </p>

          <H3 id="buyer-how">How it works</H3>
          <Code>{`1. Agent deposits USDC into Circle Gateway (one time, any amount)
2. Agent calls a paid API endpoint
3. Server returns 402 + payment details (seller address, amount, network)
4. Agent's SDK signs an EIP-3009 off-chain authorization (~200ms, no gas)
5. Circle Gateway verifies and records the payment
6. Agent retries the request with the payment header
7. Server verifies → processes → returns data
8. Gateway settles to seller on Arc (batched, gasless)`}</Code>

          <Callout color="blue">
            <b>No gas. No wallet popup. No signing per call.</b> The agent signs once per payment using EIP-3009 (off-chain). Circle Gateway handles verification and batch settlement. Once the Gateway balance is funded, calls are automatic.
          </Callout>

          <H3 id="buyer-fund">Fund your account</H3>
          <p className="mt-2 text-[14px] text-zinc-600">Buying is <b>keyless</b>. All you need is an Obol account and API key — no private key, no wallet to manage. Obol&apos;s relayer pays sellers on your behalf and deducts from your funded balance.</p>

          <Code lang="bash">{`# 1. Create an account and copy your API key from Settings on obol-arc.web.app
#    (looks like obl_sk_live_…)

# 2. Deposit USDC into your Obol spending balance (Dashboard → Deposit,
#    or the MCP "deposit" tool). Fund from any chain via Circle Gateway.

# 3. That's it — set your API key and start paying:
export OBOL_API_KEY=obl_sk_live_your_key_here`}</Code>

          <Callout color="blue">
            <b>No private key required.</b> Your API key authorizes payments through Obol&apos;s hosted relayer + Circle Gateway. Keep the API key secret (env var or secrets manager) — it can spend your balance, so treat it like a password.
          </Callout>

          <H3 id="buyer-mcp">MCP configuration</H3>
          <p className="mt-2 text-[14px] text-zinc-600">
            Add Obol to any MCP-compatible AI agent (Claude, Cursor, etc.) so it can find and pay for services automatically — with just your API key.
          </p>
          <Code lang="json">{`// Add to your claude_desktop_config.json or mcp settings:
{
  "mcpServers": {
    "obol": {
      "command": "npx",
      "args": ["-y", "@superbigroach/obol-mcp"],
      "env": {
        "OBOL_API_KEY": "obl_sk_live_…"
      }
    }
  }
}`}</Code>

          <H3 id="buyer-advanced">Advanced: self-custody (optional)</H3>
          <p className="mt-2 text-[14px] text-zinc-600">
            Prefer to hold your own funds and sign payments locally instead of using the hosted relayer? Set <code>OBOL_AGENT_KEY</code> to a funded EOA private key and the MCP/SDK will sign directly. Most buyers do <b>not</b> need this.
          </p>
          <Code lang="bash">{`# Generate an EOA key, fund it at faucet.circle.com (Arc testnet), then:
export OBOL_AGENT_KEY=0xYourPrivateKey   # replaces the keyless path`}</Code>
          <Code>{`import { GatewayClient } from "@circle-fin/x402-batching/client";

const buyer = new GatewayClient({ chain: "arcTestnet", privateKey: process.env.OBOL_AGENT_KEY });
await buyer.deposit("10");                          // one-time Gateway deposit
const { data, transaction } = await buyer.pay(     // 402 → pay → retry, automatic
  "https://your-provider.railway.app/enrich?domain=acme.com"
);`}</Code>

          <p className="mt-4 text-[14px] text-zinc-600">MCP tools available to the agent once connected:</p>
          <Table
            headers={["Tool", "What it does"]}
            rows={[
              ["find_service", "Search the Obol marketplace by name or category"],
              ["get_balance", "Check your Gateway USDC balance"],
              ["deposit", "Deposit USDC from your wallet into Gateway"],
              ["pay_and_call", "Pay for and call any Obol service URL"],
            ]}
          />

          {/* ── DASHBOARD GUIDE ── */}
          <H2 id="dashboard">Dashboard guide</H2>
          <p className="mt-3 text-[15px] text-zinc-600">
            The dashboard at <a href="https://obol-arc.web.app/dashboard" className="text-[#6d5ef6] hover:underline">obol-arc.web.app/dashboard</a> has two tabs: <b>Use services</b> (buyer) and <b>Provide services</b> (seller).
          </p>

          <H3 id="dash-wallet">Wallet setup</H3>
          <p className="mt-2 text-[14px] text-zinc-600 leading-relaxed">
            Your Obol wallet is a self-custody EOA on Arc testnet powered by Circle User-Controlled Wallets (UCW). You hold the keys via a PIN — Obol never has custody.
          </p>
          <p className="mt-3 text-[14px] font-semibold text-zinc-900">To create:</p>
          <ol className="mt-2 flex flex-col gap-2 text-[14px] text-zinc-600 list-decimal list-inside">
            <li>Go to Dashboard → Use services tab</li>
            <li>Click <b>"Create my wallet →"</b></li>
            <li>Circle's PIN overlay appears — set a 6-digit PIN and three security questions</li>
            <li>Your Arc address appears and is saved to your profile automatically</li>
            <li>This address is your payout address for services you sell</li>
          </ol>
          <Callout color="amber">
            <b>Don't lose your PIN or security answers.</b> They&apos;re the only way to recover your wallet. Obol cannot reset them.
          </Callout>

          <H3 id="dash-provide">Provide services tab</H3>
          <p className="mt-2 text-[14px] text-zinc-600">Everything a seller needs in one tab.</p>
          <div className="mt-4 flex flex-col gap-3 text-[14px] text-zinc-700">
            {[
              ["Earned", "Total USDC you've received from all API calls across all services. Settled to your Arc wallet via Circle Gateway."],
              ["Calls served", "Total number of paid API calls across all your listed services. Useful for tracking usage."],
              ["Active services", "Number of services you've published to the marketplace."],
              ["Obol commission (0%)", "Obol takes 0% per call — you keep 100% of the price you set. Obol monetizes via optional Featured/Scale subscriptions, not a per-call take rate."],
              ["Withdraw earnings", "Move your earned USDC from your Arc wallet to any address on any supported network. Choose destination chain from the dropdown — Obol uses Circle CCTP to bridge if needed."],
              ["Your services", "List of all services you've registered. Click + New service to add one."],
            ].map(([label, desc]) => (
              <div key={label} className="rounded-[10px] border border-zinc-200 bg-zinc-50 px-4 py-3">
                <div className="font-semibold text-zinc-900">{label}</div>
                <div className="mt-0.5 text-zinc-600">{desc}</div>
              </div>
            ))}
          </div>

          <H3 id="dash-use">Use services tab</H3>
          <p className="mt-2 text-[14px] text-zinc-600">The buyer view — fund your agent and monitor spending.</p>
          <div className="mt-4 flex flex-col gap-3 text-[14px] text-zinc-700">
            {[
              ["Gateway balance", "Your unified USDC balance managed by Circle Gateway. This is what agents spend when they call paid APIs. Deposit here from any chain."],
              ["Total across chains", "Total USDC you hold across all networks (Arc, Base, Ethereum Sepolia, etc.). Only Gateway balance can be spent on API calls — other chain balances need to be deposited first."],
              ["USDC by chain", "Cards showing your balance on each chain with balance > 0, plus Arc always. Use Bridge → to move between chains. Use Deposit to Gateway to put Arc USDC into the unified balance."],
              ["Create my wallet", "Sets up your UCW if you haven't already. Required before you can deposit, bridge, or withdraw."],
            ].map(([label, desc]) => (
              <div key={label} className="rounded-[10px] border border-zinc-200 bg-zinc-50 px-4 py-3">
                <div className="font-semibold text-zinc-900">{label}</div>
                <div className="mt-0.5 text-zinc-600">{desc}</div>
              </div>
            ))}
          </div>

          <H3 id="dash-withdraw">Bridge &amp; withdraw</H3>
          <p className="mt-2 text-[14px] text-zinc-600">Move USDC between chains and out of the platform.</p>
          <Code>{`Buyer dashboard — "Deposit to Gateway":
  Arc wallet → Circle Gateway unified balance
  Used to fund the agent's spending pool.
  Requires PIN confirmation (UCW).

Buyer dashboard — "Bridge →" on a chain card:
  Any chain → Any other chain
  Uses Circle CCTP behind the scenes.
  ~30 seconds to arrive.

Buyer dashboard — "Withdraw →" on Gateway balance card:
  Gateway balance → Any chain, any recipient address
  Pick destination network from dropdown (all 8 chains supported).

Seller dashboard — "Withdraw earnings":
  Your Arc wallet → Any address on any network
  Same cross-chain capability via CCTP.
  Enter recipient address manually.`}</Code>

          {/* ── REFERENCE ── */}
          <H2 id="reference">Reference</H2>

          <H3 id="ref-networks">Supported networks</H3>
          <p className="mb-3 text-[14px] text-zinc-600">
            Your unified USDC balance lives on <b>Arc</b> (where per-call payments settle). You can
            <b> deposit from</b> and <b>withdraw to</b> any network below — Obol bridges via Circle
            Gateway (EVM chains) or CCTP (Monad, Solana), gaslessly. <b>10 networks</b> total.
          </p>
          <Table
            headers={["Network", "Chain key", "USDC address / SPL mint", "CCTP domain"]}
            rows={[
              ["Arc Testnet · settles here", "arc", "0x3600000000000000000000000000000000000000", "26"],
              ["Base Sepolia", "base", "0x036CbD53842c5426634e7929541eC2318f3dCF7e", "6"],
              ["Ethereum Sepolia", "ethereum", "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238", "0"],
              ["Avalanche Fuji", "avalanche", "0x5425890298aed601595a70AB815c96711a31Bc65", "1"],
              ["OP Sepolia", "optimism", "0x5fd84259d66Cd46123540766Be93DFE6D43130D7", "2"],
              ["Arbitrum Sepolia", "arbitrum", "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d", "3"],
              ["Polygon Amoy", "polygon", "0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582", "7"],
              ["Unichain Sepolia", "unichain", "0x31d0220469e10c4E71834a79b1f276d740d3768F", "10"],
              ["Monad Testnet", "monad", "0x534b2f3A21130d7a60830c2Df862319e593943A3", "15"],
              ["Solana Devnet", "solana", "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU", "5"],
            ]}
          />

          <H3 id="ref-fees">Pricing &amp; fees</H3>
          <Table
            headers={["Fee", "Amount", "Who pays", "Where it goes"]}
            rows={[
              ["Obol commission", "0% per call", "—", "You keep 100%"],
              ["Circle Gateway fee", "0% (testnet)", "—", "—"],
              ["Gas (per call)", "$0 (gasless nanopayments)", "—", "Circle covers settlement"],
              ["Deposit gas (one-time)", "~$0.0014 on Arc", "Depositor funding their balance", "Network"],
              ["CCTP bridge fee", "~$0.001", "Initiator of the bridge", "Circle/CCTP"],
            ]}
          />
          <p className="mt-3 text-[14px] text-zinc-600">
            Example: You set your price at <b>$0.002/call</b>. The agent pays exactly $0.002. You receive the full $0.002 (100%). Obol takes <b>$0</b> per call — we monetize via optional Featured/Scale subscriptions, not your transactions.
          </p>

          <div className="mt-5 rounded-[14px] border border-emerald-200 bg-emerald-50 p-5">
            <div className="text-[13px] font-bold uppercase tracking-[.05em] text-emerald-700">✓ Proven on Arc testnet — real transactions</div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="rounded-[10px] border border-emerald-200 bg-white p-4">
                <div className="text-[12px] font-semibold text-zinc-500">Weather API · $0.001/call</div>
                <div className="mt-1 font-mono text-[13px] text-zinc-900">
                  serviceFee $0.001 · <b className="text-emerald-700">commission $0 (0%)</b> · <b className="text-emerald-700">gas $0</b>
                </div>
                <div className="mt-1 truncate font-mono text-[11px] text-zinc-400">settlementTx 7f3bdec6-8bc6-4b8a-9f10-81aade1baaff</div>
              </div>
              <div className="rounded-[10px] border border-emerald-200 bg-white p-4">
                <div className="text-[12px] font-semibold text-zinc-500">Nano endpoint · $0.000001/call (floor)</div>
                <div className="mt-1 font-mono text-[13px] text-zinc-900">
                  serviceFee $0.000001 · <b className="text-emerald-700">gasless</b> · charged $0.000001
                </div>
                <div className="mt-1 truncate font-mono text-[11px] text-zinc-400">settlementTx 52e46668-482c-4374-a368-1f07cedbbfbb</div>
              </div>
            </div>
            <p className="mt-3 text-[12.5px] text-emerald-800">
              <b>To be clear:</b> $0.000001 is the <b>minimum payment</b> (the smallest price a seller can charge) — <b>not a gas fee</b>. Gas is <b>$0</b>: buyers and sellers pay no gas at all. Nanopayments are offchain EIP-3009 signatures, batch-settled by Circle Gateway, so per Circle <a href="https://developers.circle.com/gateway/nanopayments" target="_blank" rel="noreferrer" className="underline">&quot;neither party pays per-transaction fees&quot;</a>.
            </p>
            <p className="mt-2 text-[12.5px] text-emerald-800">
              Every <code>pay-and-call</code> receipt includes <code>feeRate: &quot;0%&quot;</code>, <code>gas: 0</code>, and <code>priceSource: &quot;x402-endpoint&quot;</code> (the live per-endpoint x402 price was billed). You pay <b>only the seller&apos;s price</b> — Obol takes 0% commission.
            </p>
          </div>

          <H3 id="ref-402">HTTP 402 explained</H3>
          <p className="mt-2 text-[14px] text-zinc-600 leading-relaxed">
            HTTP 402 ("Payment Required") is the standard status code for paywalled content. Obol's middleware returns a 402 with a <code className="rounded bg-zinc-100 px-1.5 font-mono text-[12px]">X-Payment-Required</code> header containing Circle Gateway payment instructions. Compatible buyers (those using the GatewayClient SDK or the Obol MCP) handle this automatically.
          </p>
          <Code>{`# What an unpaid request looks like:
HTTP/1.1 402 Payment Required
X-Payment-Required: {
  "scheme": "circle-gateway",
  "network": "eip155:5042002",
  "maxAmountRequired": "2000",    // in USDC micro-units (6 decimals)
  "sellerAddress": "0xSeller...",
  "facilitatorUrl": "https://gateway-api-testnet.circle.com"
}

# The GatewayClient SDK reads this header, signs an off-chain EIP-3009
# authorization, submits to Circle Gateway, then retries the original
# request with a signed payment proof in the Authorization header.`}</Code>

          <H3 id="ref-wallets">Wallet types</H3>
          <Table
            headers={["Wallet type", "Used for", "How it works", "Keys"]}
            rows={[
              ["UCW (User-Controlled)", "Sellers, dashboard humans", "PIN overlay via Circle SDK. Human approves each spend.", "You hold via PIN"],
              ["Agent EOA (raw private key)", "Buyers, AI agents", "Script signs autonomously with OBOL_AGENT_KEY. No PIN, no popup.", "You hold private key"],
              ["DCW (Developer-Controlled)", "Legacy Obol platform wallet", "Circle holds keys server-side. Used before UCW was added.", "Circle holds"],
            ]}
          />
          <Callout color="purple">
            <b>Why agents can&apos;t use UCW:</b> UCW requires a human to enter a PIN for every spend. Agents run autonomously without human input. Agents use a raw EOA private key instead — they fund it, set <b>OBOL_AGENT_KEY</b>, and the SDK signs payments automatically.
          </Callout>

          <div className="mt-16 border-t border-zinc-200 pt-8 flex flex-wrap gap-3">
            <Link href="/dashboard" className="rounded-[10px] bg-gradient-to-br from-[#6d5ef6] to-[#3b9eff] px-5 py-3 text-[14px] font-semibold text-white shadow-sm transition hover:-translate-y-px">
              Open dashboard →
            </Link>
            <Link href="/marketplace" className="rounded-[10px] border border-zinc-200 bg-white px-5 py-3 text-[14px] font-semibold text-zinc-900 transition hover:bg-zinc-50">
              Browse marketplace
            </Link>
            <a href="https://faucet.circle.com" target="_blank" rel="noreferrer" className="rounded-[10px] border border-zinc-200 bg-white px-5 py-3 text-[14px] font-semibold text-zinc-900 transition hover:bg-zinc-50">
              Get testnet USDC ↗
            </a>
          </div>

        </main>
      </div>
      <SiteFooter />
    </div>
  );
}
