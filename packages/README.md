# @superbigroach/obol-mcp

MCP server for the [Obol](https://obol-arc.web.app) pay-per-call API marketplace. Lets any AI agent discover and pay for metered APIs in USDC on Arc testnet — no subscription, no account needed.

## Install

```bash
npx @superbigroach/obol-mcp
```

## Configure (Claude Desktop / Cursor / Windsurf)

```json
{
  "mcpServers": {
    "obol": {
      "command": "npx",
      "args": ["-y", "@superbigroach/obol-mcp"],
      "env": {
        "OBOL_AGENT_KEY": "0xYOUR_ARC_WALLET_PRIVATE_KEY"
      }
    }
  }
}
```

Get a funded wallet: sign up at [obol-arc.web.app](https://obol-arc.web.app), get free testnet USDC at [faucet.circle.com](https://faucet.circle.com).

## Tools

| Tool | What it does |
|------|--------------|
| `find_service` | Search the Obol marketplace by keyword. Returns name, price, callUrl. |
| `pay_and_call` | Pay in USDC and call a service in one step. Returns result + on-chain receipt. |
| `get_balance` | Check your API credits balance. |
| `list_service` | Publish your own metered API for other agents to discover and pay for. |

## Example agent flow

```
> find_service("crypto price")
→ [{ name: "Crypto Price API", price: "0.001 USDC/call", callUrl: "https://..." }]

> pay_and_call("https://...", { coin: "bitcoin" })
→ { data: { usd: 104231 }, charged: 0.00105, remainingBalance: "3.99" }
```

## Hosted HTTP endpoint (for Smithery / Claude.ai)

```
https://us-central1-obol-arc.cloudfunctions.net/mcpServer
```

Pass `X-Obol-Api-Key: obl_sk_live_...` header (get a key at [obol-arc.web.app/settings](https://obol-arc.web.app/settings)).

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `OBOL_AGENT_KEY` | Yes | `0x...` private key of an Arc testnet wallet with USDC |
| `OBOL_FACILITATOR` | No | Obol base URL (default: `https://obol-arc.web.app`) |

## Links

- Marketplace: [obol-arc.web.app](https://obol-arc.web.app)
- Package source: [superbigroach/obol-mcp](https://github.com/superbigroach/obol-mcp)
- Platform source: [superbigroach/obol-arc-public](https://github.com/superbigroach/obol-arc-public)
- Arc faucet: [faucet.circle.com](https://faucet.circle.com)

## License

MIT — see [LICENSE](LICENSE). (The Obol platform itself is Elastic License 2.0; this client package
is MIT so agents can depend on it freely.)
