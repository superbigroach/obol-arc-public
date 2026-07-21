# Obol — the payment rail for the agent economy

**One coin, one call.** Obol lets any API charge AI agents **per call in USDC on [Arc](https://arc.network)** — Circle's stablecoin-native L1 where USDC *is* the gas token. No subscriptions, no invoices, no human in the loop.

**Live:** [obol-arc.web.app](https://obol-arc.web.app) · **Network:** Arc testnet + Base Sepolia · **Built for:** Programmable Money Hackathon (Agentic Economy track)

---

## The problem

An AI agent that needs a weather lookup, a price feed, or a scraper has exactly two options today: a human signs up for a monthly plan and pastes an API key into the agent, or the agent doesn't get the data. Neither is autonomous. Subscriptions can't price a single call, and card rails can't clear $0.001 — the interchange floor alone is 30×.

Stablecoins fix the floor. Arc fixes the rest: USDC is the native gas token, so an agent holding only USDC can pay *and* transact without ever touching a second asset, at sub-second finality.

## What Obol does

| Role | What they get |
|------|---------------|
| **API sellers** | Publish any HTTPS endpoint. Two lines of middleware, and it charges per call. Keep 100% of revenue. |
| **AI agents / buyers** | Discover services and pay for them autonomously — **keyless**, using only an API key. No private key, no seed phrase. |
| **Both** | Settlement in USDC on Arc, per call, at sub-cent prices. |

Obol is a **routing and trust layer over x402**, not another directory. It aggregates Coinbase's x402 Bazaar alongside its own listings, prices the cheapest rail for each call, and scans every response for prompt injection before it reaches the agent.

## Why this isn't just an x402 directory

Four things Obol adds on top of the raw protocol:

1. **Arc-first routing.** Every call prices Arc Gateway first (sub-cent, USDC-as-gas) and falls back to the Base facilitator only when a seller doesn't accept Arc. Cheapest rail wins, automatically.
2. **Keyless payment.** Agents pay with an API key alone. Obol's relayer signs and settles from the account's funded spending balance. Self-custody (`OBOL_AGENT_KEY`) remains available as an advanced path — but requiring every agent operator to manage a hot private key is the single biggest adoption blocker in x402 today.
3. **Response safety scanning.** Every service response is scanned for prompt injection and hidden content, and returned with a `safety.verdict` of `clean` / `suspicious`. `dangerous` services are hidden outright. An agent paying strangers for data is a supply-chain attack surface; nobody else in x402 treats it as one.
4. **ACK-ID credentials.** Sellers are auto-issued a verifiable credential bound to their wallet (`did:pkh:eip155:5042002:0x…`), so buyers can tell a real listing from a squatted one.

## Architecture

```
   Agent (MCP / REST)
          │  find_service  → ranked directory: Obol listings + x402 Bazaar
          │  pay_and_call  → maxPrice + spending limits enforced, idempotent
          ▼
   ┌──────────────────────────────────────────────┐
   │  Obol router  (Firebase Functions)           │
   │   • prefer-Arc pricing, Base fallback        │
   │   • keyless relayer signs the x402 payload   │
   │   • response safety scanner                  │
   └───────────────┬──────────────────┬───────────┘
                   │                  │
        Arc Gateway (unified)   Base facilitator (x402)
        USDC = native gas       raw USDC, gasless via EIP-3009
                   │                  │
                   └────► seller endpoint ◄────┘
                          402 → pay → 200
```

**Deposit from anywhere, spend on Arc.** Each user gets a per-chain deposit wallet on any of **8 EVM testnets + Solana**. Send USDC to it and the funding pipeline runs hands-free: detect the deposit → bridge to your Arc EOA via **Circle App Kit / CCTP** (Fast Transfer where it beats standard finality) → `approve` + `deposit` into your **Gateway balance**, gasless on Arc. A webhook plus a 2-minute scheduler completes it even if you close the tab, and a 5-minute auto-sweep catches any stray USDC sitting in your Arc wallet. One spendable balance, regardless of where the money came from.

**One balance, not two.** Base bridges in like every other chain, so users never juggle pools. The alternative — holding raw Base USDC to pay x402 Bazaar sellers directly — is preserved behind the `BASE_RAW_FOR_BAZAAR` flag and turns on for the mainnet build, since Bazaar listings are mainnet-only and buy nothing on testnet.

Withdrawals reverse the flow — source is always the Arc Gateway balance, with a destination-chain picker.

## Circle stack used

- **Arc** — settlement chain, USDC as native gas (`eip155:5042002`)
- **Circle Gateway / Nanopayments** — unified cross-chain USDC balance, `@circle-fin/x402-batching`
- **App Kit + CCTP** — `kit.bridge()` moves deposits from 8 EVM chains and Solana into the Arc balance
- **Circle Developer-Controlled Wallets** — frictionless EOAs for non-crypto sellers (Gateway requires EOA signatures; SCA/ERC-1271 is rejected)
- **Gas Station** — sponsors gasless funding deposits on non-Arc chains

## Network status

Everything below runs on **testnet today**. `OBOL_NETWORK=mainnet` flips the config (see `seller-fn/network.mjs`).

| Rail | Testnet (live) | Mainnet (scaffolded) |
|------|----------------|----------------------|
| Arc | `arcTestnet`, USDC `0x3600…0000` | pending Arc mainnet GA |
| Base | Base Sepolia `eip155:84532`, x402.org facilitator | Base `eip155:8453`, Coinbase CDP facilitator — needs CDP auth headers |

Note that third-party x402 sellers (including the Bazaar) list on **mainnet only** — there is no testnet Bazaar — so testnet counterparties are Obol's own demo services.

## Quick start — connect an agent (MCP)

```json
{
  "mcpServers": {
    "obol": {
      "command": "npx",
      "args": ["-y", "@superbigroach/obol-mcp"],
      "env": { "OBOL_API_KEY": "obl_sk_live_YOUR_KEY_HERE" }
    }
  }
}
```

Get a key at [obol-arc.web.app/settings](https://obol-arc.web.app/settings) and fund it with free testnet USDC from [faucet.circle.com](https://faucet.circle.com). No private key required.

| Tool | Purpose |
|------|---------|
| `find_service` | Search the directory — returns name, price, `callUrl`, safety verdict |
| `pay_and_call` | Pay and call in one step, with `maxPrice` and spending limits |
| `get_balance` | Agent wallet + Gateway USDC balance |
| `list_service` | Publish your own metered API (issues an ACK-ID credential) |

## Quick start — sell an API

```js
import { obol } from "@obol/sdk";
app.use(obol({ sellerAddress: "0xYourPayout", price: "$0.001" }));
```

That's the whole integration. Requests without payment get a 402 challenge; paid requests pass through and settle to your address.

## REST API

```bash
GET  /api/services                       # browse the directory
POST /api/pay-and-call                   # { apiKey, callUrl, params }
GET  /api/agent-balance?apiKey=…         # balance + remaining spend limit
```

Hosted MCP (HTTP/Smithery): `https://us-central1-obol-arc.cloudfunctions.net/mcpServer` with an `X-Obol-Api-Key` header.

## Repo layout

```
app/         Next.js 15 frontend — landing, dashboard (Use/Provide tabs), marketplace, docs
components/  UI
lib/         chain config, Gateway reads, client-side Firestore access
seller-fn/   Firebase Functions — router, keyless relayer, facilitator pay,
             ACK-ID issuance, multi-chain funding (pathB)
functions/   supporting Cloud Functions
packages/    @superbigroach/obol-mcp — the MCP server agents connect to
docs/        integration guides, nanopayment flow, security architecture
```

## Running locally

```bash
npm install
npm run dev          # http://localhost:3000
npm run build        # production build
```

Firestore access is client-side via the Web SDK plus `firestore.rules` (the Firebase frameworks SSR adapter duplicates `firebase-admin`'s app registry, so admin-in-SSR is deliberately avoided). Server-side secrets live in Google Secret Manager, never in the repo.

## Security

- No private keys, service-account JSON, or `.env` files are committed — enforced by `.gitignore`.
- Buyer spending is bounded per call (`maxPrice`) and per account (spending limits); `pay_and_call` is idempotent on retry.
- Service responses are treated as untrusted data, never as instructions, and are injection-scanned before reaching the agent.
- See `docs/security-architecture.md` and `docs/security-hardening.md`.

## License

Source-available, not open source. Copyright 2026 Sebastian Borjas / Lucilla Inc.

| Scope | License |
|-------|---------|
| The platform — everything except `packages/` | [Elastic License 2.0](LICENSE) |
| `packages/` — the `@superbigroach/obol-mcp` client | [MIT](packages/LICENSE) |

You may read, modify, self-host, and build on the platform code. You **may not** offer it to third parties as a hosted or managed service. The MCP client package is MIT so agents can depend on it freely.

"Obol" and the Obol logo are trademarks of Lucilla Inc. — see the Trademarks section of [LICENSE](LICENSE). The license grants no rights to the name or branding.
