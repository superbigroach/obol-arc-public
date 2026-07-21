# Obol Nanopayment Flow (x402 + Circle Gateway)

## The Architecture

**Three-layer stack:**

```
┌─────────────────────────────────────────────────────┐
│ Layer 3: SELLER SETTLEMENT (On-Chain)              │
│ Gateway batches nanopayments → 1 tx/hour to Seller │
│ Settlement: Arc blockchain (CCTP to other chains)  │
└─────────────────────────────────────────────────────┘
                        ▲
                        │ Batched once/hour
                        │
┌─────────────────────────────────────────────────────┐
│ Layer 2: NANOPAYMENTS (Gasless, x402)              │
│ Agent calls pay_and_call() → NO blockchain needed  │
│ Cost: $0 gas, instant settlement to gateway        │
│ Gateway tracks balance in real-time                │
└─────────────────────────────────────────────────────┘
                        ▲
                        │ Pre-funded
                        │
┌─────────────────────────────────────────────────────┐
│ Layer 1: DEPOSIT (Gateway Account)                 │
│ Agent deposits $50 to Circle Gateway (Arc testnet) │
│ Fund gateway account ONCE, make unlimited calls    │
└─────────────────────────────────────────────────────┘
```

---

## Step-by-Step Flow

### 1️⃣ Agent Deposits to Gateway (Once)
```typescript
// MCP Tool: depositToGateway
const deposit = await agent.mcp.call('depositToGateway', {
  amount: "50",  // $50 USDC
  network: "arc" // Arc testnet
});

// What happens:
// ✓ Agent's Arc wallet: -$50 USDC
// ✓ Circle Gateway account: +$50 balance
// ✓ On-chain: 1 transaction, ~2-3 seconds
// ✓ Agent ready for ~50,000 nanopayment calls at $0.001 each
```

**Result in dashboard:**
```
Agent Wallet (Arc Testnet): $0 USDC (was $50)
Gateway Account Balance:    $50 USDC (NEW)
```

---

### 2️⃣ Agent Calls Services (Nanopayments, Gasless)
```typescript
// MCP Tool: pay_and_call
const result = await agent.mcp.call('pay_and_call', {
  callUrl: "https://seller-api.com/weather",
  params: { coin: "bitcoin" },
  price: "0.001"  // $0.001 per call
});

// What happens:
// ✓ No blockchain transaction
// ✓ NO gas fees
// ✓ Circle Gateway validates x402 header (EIP-3009)
// ✓ Service receives payment proof
// ✓ Agent balance: $50.000 → $49.999 instantly
// ✓ Seller credited: +$0.00099 (after 1% Obol fee)
// 
// Return to agent:
// { result: { bitcoin: 45230.50 }, paidBy: "0xABC..." }
```

**Gateway balance in real-time:**
```
Call 1: $50.000 → $49.999
Call 2: $49.999 → $49.998
Call 3: $49.998 → $49.997
(... 49,997 more calls possible ...)
```

---

### 3️⃣ Gateway Batches & Settles to Seller (Hourly)
```
[Hour 1: Calls 1-50]
├─ Agent A: 50 × $0.001 = $0.05
├─ Agent B: 20 × $0.001 = $0.02
└─ Agent C: 10 × $0.001 = $0.01
   Total for Seller: $0.08
   
[Settlement TX on Arc]
Seller wallet receives: $0.072 (after 1% Obol fee on $0.08)
Timestamp: 1 block (~2 seconds)

[Seller Dashboard Updates]
✓ Earned: +$0.072
✓ Calls served: +80
✓ Recent activity: Shows all 80 calls + payers
```

---

## Key Differences from Traditional Payments

| Aspect | Traditional | Obol Nanopayment |
|--------|-----------|------------------|
| **Per-call cost** | $0.001 + gas ($0.50+) | $0.001 total |
| **Confirmation time** | 12 seconds | Instant (gateway) |
| **Settlement** | Immediate | Batched hourly |
| **Blockchain calls** | 50 = 50 transactions | 50 = 0 transactions* |
| **Agent experience** | Wait for each tx | Instant response |
| **Seller experience** | Micro-spam of 50 txs | 1 batched settlement |

*Only 1 on-chain transaction per hour for the entire seller's revenue, not per call.

---

## MCP Tools for Agents

### 1. `depositToGateway` — Fund your gateway account
```
Input:
  amount: "50"     (USDC)
  network: "arc"   (deployment chain)

Output:
  txHash: "0x..."
  gatewayBalance: "50"
  status: "confirmed"
```

### 2. `pay_and_call` — Make a nanopayment call
```
Input:
  callUrl: "https://..."
  params: { ... }
  price: "0.001"

Output:
  result: { ... }       (service response)
  paidBy: "0xABC..."    (payer address)
  txId: "uop_..."       (userOp hash, not tx)
  gatewayBalance: "49.999"
```

### 3. `getGatewayBalance` — Check remaining balance
```
Output:
  balance: "49.999" USDC
  availableCalls: 49999  (at $0.001 each)
  nextSettlementAt: "2026-06-30T15:00:00Z"
```

### 4. `withdrawFromGateway` — Pull money back out
```
Input:
  amount: "10"     (USDC to withdraw)
  recipient: "0x..." (external address)

Output:
  txHash: "0x..."  (on-chain settlement to your wallet)
  newBalance: "39.999"
```

---

## Seller Dashboard View

After agents make nanopayment calls:

```
EARNED:              $0.0792
  (from 80 calls × $0.001 - 1% fee)

CALLS SERVED:        80
  (this hour)

RECENT ACTIVITY:
  ├─ 50 calls from Agent A (0x111...)
  ├─ 20 calls from Agent B (0x222...)
  └─ 10 calls from Agent C (0x333...)

Next settlement:     in 47 minutes (batched to your Arc wallet)
```

---

## Security Model

✅ **Agent funds are safe:**
- Deposited to Circle (FDIC-insured custodian)
- Only withdrawn by agent's private key
- No Obol custody

✅ **Nanopayments are verified:**
- x402 + EIP-3009 standard (Circle Gateway)
- Signature validated server-side
- Cannot replay or forge

✅ **Seller always gets paid:**
- Gateway holds funds in escrow
- Settlement is deterministic and automated
- No refund disputes (buyer already paid)
- **Marketplace fee: 1%** (Obol takes 1%, you get 99%)

---

## Example: End-to-End Flow

```
TIME: 14:00 UTC
─────────────────
Agent deposits $10 to gateway
  → Agent Arc wallet: -$10
  → Gateway account: +$10
  → 1 on-chain tx

TIME: 14:05 UTC
─────────────────
Agent calls Weather API (3 times):
  pay_and_call(weatherUrl, {coin: "bitcoin"})
  pay_and_call(weatherUrl, {coin: "ethereum"})
  pay_and_call(weatherUrl, {coin: "doge"})
  
  → 3 nanopayment calls (NO gas, ~50ms each)
  → Gateway balance: $10 → $9.997
  → Agent gets results instantly

TIME: 14:10 UTC
─────────────────
Seller's dashboard updates in real-time:
  ✓ Earned: +$0.0027 (3 × $0.001 - 1% fee)
  ✓ Calls served: +3
  ✓ Recent: "Agent 0x... called 3 times"

TIME: 15:00 UTC
─────────────────
Circle Gateway settlement fires:
  All nanopayments from ALL agents this hour
  → Batched into 1 on-chain transaction
  → Seller Arc wallet: +$X (all earnings for the hour)
  → Confirmed in ~2 seconds
```

---

## FAQ

**Q: Why deposit first? Can't I pay per-call directly?**
A: No. x402/nanopayments require pre-funded gateway account. Think of it like loading a prepaid card before buying coffee — faster and cheaper than paying per-call on-chain.

**Q: What if I run out of gateway balance mid-call?**
A: Call is rejected BEFORE execution. Service never runs. You need to top up and retry.

**Q: Do I pay gas for each nanopayment?**
A: No. $0 gas. Only the service price ($0.001) is deducted.

**Q: When do I get paid as a seller?**
A: Real-time ledger update (dashboard), but on-chain settlement is hourly (batched).

**Q: Can I withdraw from gateway anytime?**
A: Yes. `withdrawFromGateway(amount)` settles to any address on-chain instantly.

**Q: Is this production-ready?**
A: Yes. x402 + Circle Gateway is live on testnet. Obol batching is ready for mainnet.
