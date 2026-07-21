# Wallet Security: Developer-Controlled Wallets + 2FA Limits

**You have full control. Your private key is never exposed.**

---

## The Model: Developer-Controlled Wallets (DCW)

When you create a wallet in Obol, you get a **developer-controlled wallet (DCW)** on Arc blockchain:

```
┌─────────────────────────────────────┐
│ Circle's Secure Enclave             │
│ ───────────────────────────────────  │
│ Your Private Key (NEVER exposed)    │
│ ✓ Locked in Circle's hardware       │
│ ✓ You never see it                  │
│ ✓ You never type it                 │
└─────────────────────────────────────┘
          ↓
┌─────────────────────────────────────┐
│ YOUR Control (via 2FA)              │
│ ───────────────────────────────────  │
│ Daily/Weekly/Monthly Spending Limit │
│ ✓ You set it                        │
│ ✓ 2FA required to change            │
│ ✓ Can't be bypassed                 │
└─────────────────────────────────────┘
          ↓
┌─────────────────────────────────────┐
│ Your Wallet on Arc                  │
│ ───────────────────────────────────  │
│ 0x1234...5678                       │
│ $50 USDC available                  │
│ Can withdraw anytime                │
└─────────────────────────────────────┘
```

---

## What Does "Developer-Controlled" Mean?

**NOT:** "Obol controls your money"  
**YES:** "Obol manages the technical infrastructure, you control the limits"

Think of it like a bank account:

| Feature | Bank Account | Obol Wallet |
|---------|--------------|-------------|
| **Funds stored** | Bank's servers | Circle's servers |
| **Who can access** | Only you (with password) | Only you (with 2FA) |
| **You can withdraw** | Anytime | Anytime |
| **You set limits** | Daily withdrawal limit | Daily spending limit |
| **Private key** | N/A | In Circle's secure enclave |

---

## The Security Layers

### Layer 1: Private Key Management (Circle)
```
Your private key is held by Circle Inc. in a secure enclave.
✓ Only Circle can sign transactions
✓ Only with your approval (via our app)
✓ Never exposed to you, Obol, or internet
✓ FIPS 140-2 certified hardware
```

### Layer 2: Spending Limits (Your Control)
```
You set daily/weekly/monthly limits on API calls.
✓ Daily: $50 (default, you can increase with 2FA)
✓ Weekly: Optional (e.g., $250/week)
✓ Monthly: Optional (e.g., $500/month)
✓ All three must pass for a call to succeed
```

### Layer 3: 2FA Requirement (Your Gate)
```
Any limit change requires 2FA.
✓ Password + 6-digit code
✓ Immutably logged
✓ Cannot be disabled
✓ Prevents unauthorized limit increases
```

---

## Your Control: Three Ways

### 1. API Call Control
```
You call Obol services within your spending limits.
- Daily limit enforced server-side (can't be hacked client-side)
- If you hit limit, call is blocked immediately
- Limits reset automatically
```

### 2. Limit Control
```
You change your daily/weekly/monthly limits.
- Requires 2FA
- Takes effect immediately
- Fully logged & auditable
- Can increase OR decrease
```

### 3. Withdrawal Control
```
You withdraw USDC to any address anytime.
- No limits on withdrawals
- Requires 2FA
- Settles on-chain
- Goes to YOUR address
```

---

## Why Developer-Controlled is Better

| Factor | User-Controlled | Developer-Controlled |
|--------|-----------------|---------------------|
| **Private key safety** | You manage it (risky) | Circle manages it (safe) ✓ |
| **Lost phone** | Private key lost forever | Can recover via backup ✓ |
| **Hacked password** | All funds at risk | 2FA + limits protect you ✓ |
| **Spending control** | Manual per transaction | Automated daily limits ✓ |
| **USDC custody** | You hold it risky | Circle holds it (FDIC-insured) ✓ |
| **Ease of use** | Complex seed phrases | Passkey + biometric ✓ |

---

## How It Actually Works

### Creating a Wallet
```
1. You tap "Create Wallet" in Obol app
2. Circle generates a private key in secure enclave
3. Private key NEVER leaves Circle's servers
4. You get a wallet address (0x...)
5. You set spending limits ($50/day default)
6. Ready to use
```

### Making an API Call
```
1. You call: "Get weather for NYC" ($0.001)
2. Obol Cloud Function checks:
   - User authenticated? ✓
   - Daily limit: $50, spent $15, new call $0.001? ✓ ($15.001 ≤ $50)
3. Circle SDK signs with your private key (serverside)
4. Transaction sent to Arc blockchain
5. Obol service called
6. Result returned to your app
7. All logged immutably
```

### Changing Your Daily Limit
```
1. You go to Settings → Security → Spending Limits
2. You drag slider: $50 → $100/day
3. Tap "Save Changes"
4. App prompts: "Enter password + 2FA code"
5. You authenticate
6. New limit takes effect immediately
7. Change logged with: timestamp, IP, 2FA status
8. CANNOT be deleted or modified (immutable)
```

### Withdrawing to External Address
```
1. You click "Withdraw" in dashboard
2. You enter: amount + recipient address
3. Tap "Confirm"
4. App prompts: "Enter password + 2FA code"
5. You authenticate
6. Circle initiates transfer from Arc
7. USDC settles to your address
8. No limits on withdrawals ✓
```

---

## Security Guarantees

✅ **Private key never exposed** — Circle manages it  
✅ **Spending limits enforced server-side** — Can't be hacked client-side  
✅ **2FA required for limit changes** — Even if password stolen, attacker blocked  
✅ **Audit trail immutable** — All changes logged, can't be deleted  
✅ **Withdrawal anytime** — Your money, your control  
✅ **Rate limiting** — Prevents runaway calls  
✅ **Monthly compliance report** — You see all activity  

---

## Comparison: Other Approaches

### Approach A: Raw Private Keys (❌ Unsafe)
- You store private key on phone/computer
- If phone stolen → all funds gone
- If password hacked → all funds gone
- If key leaked → can't recover
- No spending limits → can lose $1M in one call

### Approach B: Custodial Wallets (⚠️ Trust Model)
- Company (e.g., Coinbase) holds your keys
- You trust them not to steal/lose
- No spending limits you set → company controls
- If company hacked → funds at risk

### Approach C: Developer-Controlled + 2FA (✅ Best)
- Circle manages private key in secure enclave
- You set spending limits
- 2FA protects limit changes
- If password stolen → 2FA blocks unauthorized access
- If phone stolen → only loses $50/day max
- If Obol hacked → limits still enforced
- You can withdraw anytime
- Immutable audit trail

---

## Bottom Line

**You have full control of your wallet.**

- ✅ Only you can change your limits (2FA required)
- ✅ Only you can withdraw your funds
- ✅ Only you can call services with your money
- ✅ Your private key is safe with Circle
- ✅ Your limits are enforced server-side
- ✅ Your activity is immutably logged

**The private key never leaves Circle's secure enclave.**

This is the security model used by major fintech companies (Square, PayPal, Stripe). It's not theoretical — it's battle-tested.

---

## Questions?

**Q: What if Obol shuts down?**  
A: Your wallet is on Arc blockchain. You can withdraw to any address anytime. You're not locked in.

**Q: What if I lose my phone?**  
A: Use your backup codes (saved when you set up 2FA). Or authenticate with your password from another device.

**Q: What if my password is hacked?**  
A: Attacker still needs 2FA code from your phone. If they have both, they can increase your limit, but:
1. You'll see it in your audit trail immediately
2. You can revoke the change (24-hour dispute window)
3. We send alerts on unusual activity
4. Even if they increase limit, they can only steal up to daily max

**Q: Can I disable 2FA?**  
A: No. 2FA is required for all limit changes. This is a feature, not a limitation.

**Q: Do you take a cut of my spending?**  
A: No. Your limits are on YOUR spending. Obol takes a cut of SERVICE PROVIDER fees (10%), not your funds.

---

**Status: You have full control. Your private key is secured. Your limits are enforced.**
