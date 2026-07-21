# Obol — Security Architecture & Mainnet Hardening

## The two-wallet model (custody matched to risk)

Buyers and sellers have **opposite** risk profiles, so they get different wallets:

| | Buyer (spender) | Seller (earner) |
|---|---|---|
| Money size | Small — a spending float | Grows large — earnings accumulate |
| Needs auto-signing? | **Yes** (agent pays per call) | **No** (just receive + withdraw) |
| Model | **Custodial** (Obol-managed) | **Self-custody** (seller holds keys) |

- **Buyer wallet = custodial spending float.** Obol-managed (Circle dev-controlled), multi-chain, agent auto-spends. Kept **small by design** ("top up what you'll spend", like a prepaid card). A breach can only ever take the small active floats — not user savings.
- **Seller wallet = self-custody payout.** The seller points earnings at **their own wallet address** (`setPayoutWallet`). Earnings land there directly, outside Obol's custody — a platform breach **cannot** touch accumulated earnings. Sellers don't need auto-spend on earnings, so self-custody costs them nothing.

**One-liner:** *Spend from a custodial float you top up (safe because it's small); earn into a wallet you own (safe because we never hold your keys).*

### Implemented (testnet)
- `setPayoutWallet(address)` callable → sets `profiles/{uid}.payoutAddress` (+ `selfCustodyPayout: true`) and updates the seller's active services' `payoutAddress`.
- Dashboard SellerView: "Earnings wallet" card — set a self-custody address; earnings are fetched from the payout address (dashboard `reload()` queries `/api/wallet?address=<payout>` separately from the buyer wallet).
- Withdrawals gated by **2FA (TOTP)** — passkey removed in favor of one mechanism (authenticator code) for both settings and withdrawals. Enforced in `withdrawObolWallet` (`userTotp/{uid}` confirmed → require+verify code).

## The honest truth about custodial agentic wallets

You **cannot** have all three: (1) fully automated, (2) custodial, (3) perfectly breach-proof. Agentic spend needs an always-on signer; whoever controls that machine can make it sign. So the goal is **bound the loss**, not eliminate it.

**App-level controls (2FA, spend caps, app allowlist) do NOT survive a full entity-secret breach** — an attacker calls Circle directly and skips your code. They only stop leaked *API keys/sessions*. This is why the app-level withdrawal allowlist was removed (false sense of security).

## What actually survives a full entity-secret breach (mainnet hardening)

Do these when moving to real money — NOT needed on testnet:

1. **Keep balances small (biggest lever, zero infra).** Buyer floats are prepaid spending money by design → breach blast radius is inherently tiny. Frame deposits as "top up spending credits."
2. **Protect the entity-secret credential.**
   - **KMS** — envelope-encrypt the entity secret (encrypted at rest, access-logged, restricted decrypt). *Do carefully — rewiring entity-secret loading breaks every Circle call if wrong.*
   - **IP-allowlist the Circle API key** — restrict to your servers' egress IPs (needs static egress: VPC connector + Cloud NAT + reserved IP). A stolen key is then useless off your infrastructure.
3. **Circle Compliance Engine allowlist** (permissioned — request at circle.com/wallets/compliance-engine). Circle enforces outbound-to-approved-addresses on *their* servers, and the allowlist is changed only via the **Console login (separate auth, NOT the entity secret)** — so a stolen entity secret can send only to approved addresses and can't add new ones. **Caveat:** per-user allowlist automation doesn't scale + automating it with backend creds defeats it → use it for **fixed treasury paths** (hot→cold), not per-user.
4. **Hot/cold split** — keep a small operational float in the automated wallets; sweep the bulk to a **cold treasury (Safe multisig / MPC)** that needs humans to move. Caps automated blast radius.
5. **Per-user withdrawal caps + velocity limits + anomaly auto-freeze + alerts** — detect and halt abnormal outflows fast.
6. **MPC** (gold standard) — key split across systems; no single machine holds it, so a breach can't sign. Circle already MPC-secures the wallet keys; your residual exposure is the entity secret credential.

### Withdrawal address: delay-and-alert (scalable alternative to per-user allowlist)
- User adds a withdrawal address + 2FA → held 24–48h + email "cancel if not you" → then active. Withdrawals only to active addresses.
- Stops a thief: their address isn't approved, and adding one triggers a delay + out-of-band alert.
- **Only truly breach-proof if the approval/alert path is isolated** from the spend backend (else a full breach disables it). App-level delay is bypassable by direct Circle calls.

## Stage guidance
- **Testnet / building (now):** 2FA + small spending floats. Genuinely enough — no real money.
- **Mainnet:** IP-allowlist + KMS + hot/cold split + withdrawal caps/monitoring + self-custody seller payouts. Allowlist for treasury path only.
- **Scale / large balances:** MPC + Compliance allowlist + insurance.
