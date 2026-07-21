# Obol MCP Setup & Integration Guide

## Overview

The Obol MCP (Model Context Protocol) server enables Claude Code and Cloud Functions to interact with the Obol metered API marketplace. It allows the system to:

- Discover available AI services (via `find_service`, `list_service`)
- Execute metered API calls with automatic billing (via `pay_and_call`)
- Check wallet balances (via `get_balance`)
- Deposit USDC to the facilitator wallet (via `deposit`)

Obol runs on **Arc** (Circle's testnet/mainnet EVM L2) and uses USDC for payments.

---

## Architecture

```
Claude Code / Cloud Function
    ↓
MCP Server (@superbigroach/obol-mcp)
    ↓ (via OBOL_API_KEY, OBOL_AGENT_KEY, OBOL_FACILITATOR_PRIVATE_KEY)
    ↓
Obol Metered API (obol-arc.web.app)
    ↓ (query + pay)
    ↓
Target AI Service (e.g., OpenAI, Vertex)
    ↓ (usage cost)
    ↓
Obol Ledger & Escrow (Arc blockchain)
```

---

## Configuration

### Location
- **File**: `C:\Lucilla\.mcp.json`
- **Environment variables**: Loaded from `.env.local` (local dev) or Secret Manager (Cloud Functions)

### Current Configuration

```json
{
  "mcpServers": {
    "obol": {
      "command": "npx",
      "args": ["-y", "@superbigroach/obol-mcp"],
      "env": {
        "OBOL_API_KEY": "obl_sk_live_...",
        "OBOL_AGENT_KEY": "${OBOL_AGENT_KEY}",
        "OBOL_FACILITATOR_PRIVATE_KEY": "${OBOL_FACILITATOR_PRIVATE_KEY}",
        "OBOL_NETWORK": "arc-mainnet",
        "OBOL_BASE_URL": "https://obol-arc.web.app/api",
        "OBOL_TIMEOUT_MS": "30000",
        "OBOL_RETRY_MAX": "3",
        "OBOL_RETRY_DELAY_MS": "1000"
      }
    }
  }
}
```

### Key Environment Variables

| Variable | Purpose | Visibility | Source |
|----------|---------|------------|--------|
| `OBOL_API_KEY` | Seller/service provider key (public facing) | **Public OK** | [Obol Dashboard](https://dashboard.obol-arc.web.app) |
| `OBOL_AGENT_KEY` | Buyer/agent key for test calls | **Sensitive** | Test wallet private key (can rotate) |
| `OBOL_FACILITATOR_PRIVATE_KEY` | Arc testnet facilitator (metering contract owner) | **PRIVATE** | Arc testnet Safe / Key management vault |
| `OBOL_NETWORK` | Target network: `arc-testnet` or `arc-mainnet` | **Public** | Configuration |
| `OBOL_BASE_URL` | Obol API endpoint | **Public** | Configuration |
| `OBOL_TIMEOUT_MS` | HTTP request timeout (ms) | **Public** | Configuration (default 30s) |
| `OBOL_RETRY_MAX` | Max retry attempts on transient failure | **Public** | Configuration (default 3) |
| `OBOL_RETRY_DELAY_MS` | Delay between retries (ms) | **Public** | Configuration (default 1s) |

---

## Setup Steps

### 1. Get the Seller API Key

Already configured in `.mcp.json`:
```
OBOL_API_KEY=obl_sk_live_<your-key-here>   # get yours at obol-arc.web.app/settings
```

This is the **public** seller key — it's safe to have in the repo and logs.

**Rotation**: If leaked, regenerate at [Obol Dashboard](https://dashboard.obol-arc.web.app) → Settings → API Keys.

### 2. Create / Locate Agent Buyer Key

The **agent buyer key** is a wallet private key used for `pay_and_call` operations (when Claude Code / a CF makes an API call on behalf of a buyer).

#### For Local Development (Arc Testnet)
1. Create a test wallet (e.g., via [MetaMask](https://metamask.io) or [Ethers.js Wallet](https://docs.ethers.org/v6/api/wallet/))
2. Fund it with **testnet USDC** (see [Testnet Faucet](#testnet-faucet-links) below)
3. Export the private key (⚠️ **NEVER commit this to git**)
4. Store in `.env.local`:
   ```
   OBOL_AGENT_KEY=0x...privatekey...
   ```

#### For Cloud Functions (Arc Mainnet)
- Store the **production buyer key** in Google Cloud Secret Manager:
  ```bash
  gcloud secrets create OBOL_AGENT_KEY --data-file=- <<< "0x...prodkey..."
  ```
- Access in Cloud Function via:
  ```typescript
  import { getObolAgentKey } from './core/secrets';
  const agentKey = await getObolAgentKey();
  ```

### 3. Setup Arc Testnet Facilitator (for local dev / testing)

The **facilitator** is the metering contract owner that handles escrow and operator fees.

#### Arc Testnet Setup
1. Create a Safe on Arc Testnet: https://safe.arc-testnet.obol-arc.web.app
2. Fund the Safe with testnet USDC (see faucet links)
3. Export the Safe's private key / signer credentials
4. Store in `.env.local`:
   ```
   OBOL_FACILITATOR_PRIVATE_KEY=0x...facilitator_key...
   OBOL_NETWORK=arc-testnet
   ```

#### Arc Mainnet Setup (Production)
- The **mainnet facilitator** is managed by a 2-of-4 Gnosis Safe (custody shared with team)
- Private key is **NEVER exposed** in code or logs
- Access only via:
  - GCP Secret Manager (`OBOL_FACILITATOR_PRIVATE_KEY`)
  - Safe transaction signing UI (https://safe.arc.obol-arc.web.app)
- Rotation requires Safe quorum approval

### 4. Configure for Cloud Functions

Update `functions/.env`:
```bash
OBOL_API_KEY=obl_sk_live_YOUR_KEY_HERE
OBOL_AGENT_KEY=0x...                          # Buyer key (may diff per environment)
OBOL_FACILITATOR_PRIVATE_KEY=0x...            # Only in prod Secret Manager
OBOL_NETWORK=arc-mainnet                      # or arc-testnet
OBOL_BASE_URL=https://obol-arc.web.app/api
```

Deploy with Secret Manager bindings:
```bash
firebase deploy --only functions --project lucilla-b0493
```

---

## MCP Tools Reference

### 1. `find_service(query: string)`

Find a service by name or description.

**Example:**
```
Claude Code:
> Use MCP tool: find_service
> Query: "openai-gpt4"

Response:
{
  "service_id": "svc_openai_gpt4",
  "name": "OpenAI GPT-4",
  "description": "OpenAI's GPT-4 model via Obol metering",
  "pricing": {
    "input_tokens": "0.000003",
    "output_tokens": "0.000006"
  },
  "network": "arc-mainnet"
}
```

### 2. `list_service()`

List all available services.

**Example:**
```
Claude Code:
> Use MCP tool: list_service

Response:
[
  {
    "service_id": "svc_openai_gpt4",
    "name": "OpenAI GPT-4",
    "pricing": { ... }
  },
  {
    "service_id": "svc_vertex_gemini_2",
    "name": "Google Vertex Gemini 2",
    "pricing": { ... }
  },
  ...
]
```

### 3. `pay_and_call(service_id, request, buyer_key)`

Execute a metered API call with automatic USDC billing.

**Example:**
```
Claude Code:
> Use MCP tool: pay_and_call
> service_id: "svc_openai_gpt4"
> request: { "prompt": "What is AI?", "model": "gpt-4" }
> buyer_key: "0x..." (from OBOL_AGENT_KEY)

Response:
{
  "result": "AI is...",
  "cost_usdc": 0.0042,
  "transaction_hash": "0x...",
  "timestamp": "2026-06-29T14:23:00Z"
}
```

### 4. `get_balance(wallet_address)`

Check the facilitator or buyer wallet's USDC balance.

**Example:**
```
Claude Code:
> Use MCP tool: get_balance
> wallet_address: "0x..." (facilitator address)

Response:
{
  "balance_usdc": 1234.567,
  "network": "arc-mainnet",
  "asset": "USDC"
}
```

### 5. `deposit(wallet_address, amount_usdc)`

Deposit USDC to the facilitator wallet.

**Example:**
```
Claude Code:
> Use MCP tool: deposit
> wallet_address: "0x..." (facilitator)
> amount_usdc: 100.00

Response:
{
  "transaction_hash": "0x...",
  "amount_usdc": 100.00,
  "status": "confirmed",
  "timestamp": "2026-06-29T14:25:00Z"
}
```

---

## Usage Examples

### Example 1: Query Available Services

```typescript
// Cloud Function: List available Obol services
const { executeObolMCP } = require('../mcp/obol-client');

export const listObolServices = onCall(async (request) => {
  const services = await executeObolMCP('list_service', {});
  return {
    services: services,
    count: services.length
  };
});
```

### Example 2: Make a Metered API Call

```typescript
// Cloud Function: Call an OpenAI endpoint via Obol
const { executeObolMCP } = require('../mcp/obol-client');
const { getObolAgentKey } = require('../core/secrets');

export const callOpenAIViaObol = onCall(async (request) => {
  const agentKey = await getObolAgentKey();
  
  const result = await executeObolMCP('pay_and_call', {
    service_id: 'svc_openai_gpt4',
    request: {
      prompt: request.data.prompt,
      model: 'gpt-4'
    },
    buyer_key: agentKey
  });
  
  return {
    response: result.result,
    cost: result.cost_usdc,
    tx_hash: result.transaction_hash
  };
});
```

### Example 3: Check Facilitator Balance

```typescript
// Cloud Function: Monitor Obol facilitator wallet
const { executeObolMCP } = require('../mcp/obol-client');

export const getObolBalance = onCall(async (request) => {
  const balance = await executeObolMCP('get_balance', {
    wallet_address: request.data.facilitator_address
  });
  
  if (balance.balance_usdc < 100) {
    console.warn('⚠️ Obol balance low:', balance.balance_usdc, 'USDC');
  }
  
  return balance;
});
```

---

## Testing the Configuration

### Step 1: Verify MCP Server Loads

**In Claude Code CLI:**
```bash
# Restart Claude Code to load the updated .mcp.json
# Then in the session, try:

> Use MCP tool: list_service

# Should return a list of available services (not an error about missing env vars)
```

### Step 2: Test with Arc Testnet

**Set up `.env.local`:**
```bash
OBOL_API_KEY=obl_sk_live_YOUR_KEY_HERE
OBOL_AGENT_KEY=0x...testnet_buyer_key...
OBOL_FACILITATOR_PRIVATE_KEY=0x...testnet_facilitator...
OBOL_NETWORK=arc-testnet
```

**Test find_service:**
```
> Use MCP tool: find_service
> Query: "openai"

# Should find services available on Arc testnet
```

### Step 3: Test get_balance

```
> Use MCP tool: get_balance
> wallet_address: 0x...your_testnet_safe_address...

# Should return USDC balance (must be >0 to call pay_and_call)
```

### Step 4: Test pay_and_call (Small Amount)

```
> Use MCP tool: pay_and_call
> service_id: svc_openai_gpt4
> request: { "prompt": "Hello", "model": "gpt-4" }
> buyer_key: (from OBOL_AGENT_KEY)

# Should return result + cost_usdc + transaction_hash
```

---

## Troubleshooting

### Issue: MCP Server Not Loading

**Error**: `Unknown tool: find_service`

**Fix**:
1. Restart Claude Code (`Ctrl+Shift+P` → Restart)
2. Verify `.mcp.json` syntax: `npx jsonlint .mcp.json`
3. Check `~/.claude/logs` for MCP startup errors

### Issue: OBOL_AGENT_KEY Not Found

**Error**: `Error: env var OBOL_AGENT_KEY is required but not set`

**Fix**:
1. **Local dev**: Add to `.env.local` (not git-tracked)
   ```bash
   echo "OBOL_AGENT_KEY=0x..." >> .env.local
   ```
2. **Cloud Functions**: Create Secret Manager entry:
   ```bash
   gcloud secrets create OBOL_AGENT_KEY --data-file=- <<< "0x..."
   gcloud secrets add-iam-policy-binding OBOL_AGENT_KEY \
     --member=serviceAccount:lucilla-functions@lucilla-b0493.iam.gserviceaccount.com \
     --role=roles/secretmanager.secretAccessor
   ```

### Issue: Balance Insufficient

**Error**: `Error: Insufficient USDC balance. Required: 0.10, Available: 0.02`

**Fix**:
1. Check current balance: `Use MCP tool: get_balance`
2. Deposit more USDC: `Use MCP tool: deposit` (if you own the facilitator Safe)
3. Use Arc testnet faucet to fund the facilitator wallet (see links below)

### Issue: pay_and_call Timeout

**Error**: `Error: Request timeout after 30s`

**Fix**:
1. Increase timeout in `.mcp.json`:
   ```json
   "OBOL_TIMEOUT_MS": "60000"  // 60 seconds
   ```
2. Check Arc network status: https://status.obol-arc.web.app
3. Retry the call (MCP will auto-retry up to 3×)

### Issue: Transaction Hash Not Found

**Error**: `Error: Transaction 0x... not found on Arc`

**Fix**:
1. RPC read lag (normal): Wait 30–60 seconds, retry
2. Transaction failed: Check Obol dashboard for rejected escrow
3. Network mismatch: Verify `OBOL_NETWORK` matches the service's network

---

## Arc Testnet Faucet Links

Use these to fund test wallets / safes:

1. **USDC Faucet (Arc Testnet)**:
   - https://faucet.arc-testnet.obol-arc.web.app/usdc
   - Gives 1,000 testnet USDC per request

2. **ETH Faucet (Arc Testnet)**:
   - https://faucet.arc-testnet.obol-arc.web.app/eth
   - Gives 0.1 testnet ETH for gas

3. **Obol Dashboard (Testnet)**:
   - https://dashboard.arc-testnet.obol-arc.web.app
   - View your balance and service history

4. **Arc Explorer (Testnet)**:
   - https://arc-testnet.blockscout.com
   - Look up transactions and contracts

---

## Security Checklist

- [ ] `OBOL_API_KEY` (public) is in `.mcp.json` ✓
- [ ] `OBOL_AGENT_KEY` (sensitive) is **NOT** in `.mcp.json` — loaded from `.env.local` or Secret Manager
- [ ] `OBOL_FACILITATOR_PRIVATE_KEY` (private) is **NEVER** committed to git
- [ ] `.env.local` is in `.gitignore`
- [ ] Secret Manager keys are restricted to service accounts (not humans)
- [ ] MCP timeout is set to reasonable value (30s–60s)
- [ ] Retry settings prevent infinite loops (max 3 retries)
- [ ] Balance monitoring is in place (alerts if <$100)
- [ ] All logs sanitize transaction hashes, never expose private keys

---

## Next Steps

1. **Generate keys** (see [Setup Steps](#setup-steps) above)
2. **Add to `.env.local`** for local development
3. **Test with Arc testnet** (find_service → list_service → get_balance)
4. **Deploy to Cloud Functions** with Secret Manager bindings
5. **Monitor usage** via Obol Dashboard

---

## Reference

- **Obol Docs**: https://obol-arc.web.app/docs
- **Arc Network**: https://arc.obol-arc.web.app
- **MCP Spec**: https://spec.modelcontextprotocol.io
- **Security Best Practices**: See `KEY_MANAGEMENT.md`
