# @obol/mcp

An MCP server that gives any AI agent a wallet for the API economy. It can
**find** metered services, **pay** for them per call in USDC on Arc, and read
its **balance** — signing with the agent's own key (self-custody).

## Tools

| Tool | What it does |
|------|--------------|
| `find_service` | Search the Obol directory; returns id, price, description, call URL |
| `pay_and_call` | Pay for + call a service; returns the API result + on-chain receipt |
| `get_balance` | The agent wallet's USDC balance on Arc testnet |

## Configure (Claude Desktop / any MCP client)

```json
{
  "mcpServers": {
    "obol": {
      "command": "node",
      "args": ["/abs/path/packages/obol-mcp/dist/index.js"],
      "env": {
        "OBOL_AGENT_KEY": "0xYOUR_AGENT_PRIVATE_KEY",
        "OBOL_FACILITATOR": "https://obol.dev"
      }
    }
  }
}
```

The agent wallet must hold testnet USDC — get some at <https://faucet.circle.com>.
For local dev, point `OBOL_FACILITATOR` at `http://localhost:3000`.

## Build & run

```bash
npm install
npm run build
npm start
```
