# Obol Security Hardening — Surviving an Entity-Secret Compromise

**Status:** research + implementation plan. **Date:** 2026-07-01.
**Scope:** Custodial "keyless" agent-payment app on Circle developer-controlled wallets (Arc EOA + per-chain SCA deposit wallets, funds moved via CCTP/Gateway).

**Goal being tested:** "make it so no one can drain even if they get the entity secret," while keeping spending keyless (no user device signature per payment).

---

## 0. TL;DR verdict

**The blunt answer: Circle does NOT offer a native, turnkey control that makes a leaked entity secret harmless for developer-controlled wallets.** In the developer-controlled (custodial) model, the entity secret *is* the signing authority. Whoever holds the raw entity secret + a valid API key can generate a fresh, single-use ciphertext for every request and sign arbitrary transfers to arbitrary addresses. Circle's per-request replay protection, spend-limit APIs (Gas Station), and app-level limits all sit *above* the signature and do not stop this.

There is **one Circle-server-side control that can actually block an attacker-chosen destination even with a valid signature**: the **Compliance Engine transaction-screening rules (Watchlists: Blocklist/Allowlist + Transaction Decision "deny outgoing" + Wallet Freeze)**. It is configured in the **Console** (a separate credential surface from the entity secret) and enforced by Circle before broadcast. **But** it is (a) gated to "eligible customers" by application, (b) built for AML/sanctions risk screening, not as a general spend firewall, and (c) has real limitations (default-deny-to-allowlist is not a first-class toggle; amount/day caps are not documented as native rule conditions). So it is a strong *mitigation* and *containment* layer, **not** a complete answer.

**The only architecture that truly removes the "entity secret can drain everything" property is to stop custodying the withdrawal key** — i.e., make *moving funds out to a user's own address* require a **passkey (WebAuthn) the server never holds**, via Circle **Modular Wallets**. Spending can stay keyless; withdrawal cannot. That is the recommended target architecture (Section 3 + the hybrid in Section 6).

Everything below is the concrete path to get as close to the goal as Circle allows.

---

## 1. What actually protects vs. what does NOT (against entity-secret compromise)

| Control | Circle-native? | Server-side enforced regardless of valid signature? | Protects against leaked entity secret? |
|---|---|---|---|
| App-level spend limits (Obol backend) | No (yours) | No — attacker bypasses your backend and calls Circle directly | **No** |
| Entity-secret single-use ciphertext / replay protection | Yes | N/A | **No** — attacker with the raw secret mints fresh ciphertexts at will |
| Entity-secret rotation | Yes | N/A | **Only reduces the exposure window** after you detect a leak |
| Gas Station paymaster policy (daily / per-tx USD caps, sender blocklist) | Yes | Yes, but only for **gas sponsorship** | **No** — limits gas, not the transferred USDC value; attacker can pay gas from the wallet |
| Gateway 7-day trustless-withdrawal delay | Yes | Only on the *trustless* onchain path | **No** — the fast API mint/burn path (what your app uses) is signed by the wallet key = entity secret |
| CCTP `destinationCaller` restriction | Yes | Yes (only named caller can mint) | **Partial/niche** — restricts *who mints* on destination, not *where the burn sends*; attacker controls both sides |
| OFAC sanctions auto-blocklist | Yes | Yes | **No** — attacker withdraws to a fresh clean address |
| **Compliance Engine: Blocklist / Allowlist watchlists + "deny outgoing" + Wallet Freeze** | Yes (gated) | **Yes — evaluated before broadcast** | **Partial — the best available containment** (see Section 2) |
| **Passkey withdrawal (Modular Wallet, key on user device)** | Yes | Yes (chain enforces owner signature) | **Yes — this is the real fix for withdrawals** |

**Cited sources**
- Entity secret model, single-use ciphertext, not stored by Circle, not tied to API key: https://developers.circle.com/wallets/dev-controlled/register-entity-secret and https://developers.circle.com/wallets/dev-controlled/entity-secret-management (error `177602` "reusing an entity secret ciphertext is not allowed": https://developers.circle.com/w3s/synchronous-errors)
- Gas Station policy = gas-only limits (errors `177019`–`177023`, sender blocklist `177023`): https://developers.circle.com/wallets/gas-station and https://developers.circle.com/w3s/synchronous-errors
- Compliance Engine screening rules, Watchlists, Transaction Decision / Wallet Freeze, Console-configured, gated to eligible customers: https://developers.circle.com/wallets/compliance-engine/tx-screening and https://developers.circle.com/wallets/compliance-engine/tx-screening-rule-management
- OFAC auto-restriction: https://developers.circle.com/w3s/compliance-requirements
- Gateway 7-day trustless withdrawal delay + "no removal without a user signature": https://developers.circle.com/gateway/references/technical-guide
- CCTP `destinationCaller`: https://developers.circle.com/cctp/howtos/retry-failed-mint
- Modular Wallets / passkeys (secp256r1 WebAuthn, key in device secure enclave, server never holds): https://developers.circle.com/wallets/modular/passkeys and https://developers.circle.com/wallets/key-management
- Wallet freeze as a state (error `177301` "wallet is Frozen"): https://developers.circle.com/w3s/synchronous-errors

---

## 2. Circle transaction POLICIES / allowlists — exact capability & limits

**Question:** can you restrict outbound transfers to allowlisted destinations + per-wallet/day caps, enforced by Circle server-side, protected by a *separate* credential from the entity secret?

**Answer: Partially, via the Compliance Engine — not via a general "wallet spend policy."** Findings:

1. **There is no general-purpose "developer-controlled wallet transfer policy" product.** The only "Policy" object in the Wallets stack is the **Gas Station paymaster policy**, which governs *gas sponsorship* (max daily tx, max USD/tx, max USD/day, sender blocklist), **not** the USDC value or destination of a transfer. Do not mistake it for a spend firewall. Ref: https://developers.circle.com/wallets/gas-station

2. **The Compliance Engine transaction-screening rules CAN block an outbound transfer server-side, before broadcast, even with a valid signature.** Available primitives (Console-configured):
   - **Watchlists → Allowlist / Blocklist** of blockchain addresses. Blocklist "will deny any transaction where the associated address has been added." Allowlist "will allow any transaction where the associated address has been added."
   - **Restrictive rule actions:** *Transaction Decision* = "prevent outgoing transactions from being broadcast"; *Wallet Freeze* = "freeze the funds in the associated Circle Wallet."
   - Rules are evaluated when you generate an onchain transaction via the Transactions API, and results/alerts show in Console.
   Refs: https://developers.circle.com/wallets/compliance-engine/tx-screening-rule-management , https://developers.circle.com/wallets/compliance-engine/tx-screening

3. **Separate credential? Yes — in practice.** Rules live in the **Circle Console**, gated by Console login + team-member roles (Owner/Admin/View-only), and the entity secret "is not tied to individual API keys" and is not what edits Console rules. So an attacker who steals *only* the entity secret + an API key **cannot** by that fact alone edit or disable your Compliance rules — they would additionally need Console/Admin access. This is the crux of why the Compliance Engine is your best containment: it is defended by a *different* credential than the one you're assuming is breached. Refs: https://developers.circle.com/w3s/manage-team-members , https://developers.circle.com/wallets/dev-controlled/register-entity-secret (note: entity secret not tied to API keys)

4. **Honest limitations — read carefully:**
   - The rule engine is documented around **risk category / risk type / risk score** (sanctions, PEP, illicit, etc.) plus the address Watchlists. **Per-wallet daily amount caps and per-transaction USD ceilings are NOT documented as native rule conditions.** Do not assume you can express "max $X/day per wallet" in Circle rules. Enforce amount caps in your own backend and treat Circle rules as the *destination* firewall.
   - The Allowlist watchlist is an **allow** rule, not automatically a **default-deny-everything-else** posture. Achieving "only allowlisted destinations may receive funds" requires designing the rule set so non-allowlisted outbound is denied (confirm the exact configuration with Circle during onboarding; whitepaper Part 3 walks through requirement-setting). Whitepaper: linked from https://developers.circle.com/wallets/compliance-engine/tx-screening
   - **Gated:** Compliance Engine is "only available for eligible customers" and requires an application via the request form. You must apply and be approved. https://developers.circle.com/wallets/compliance-engine/tx-screening

**Net:** Circle *does* give you a server-side, separately-credentialed way to pin outbound destinations to an allowlist and to deny/freeze — but it's an AML tool you must be approved for, it doesn't do amount/day caps, and default-deny needs deliberate rule design. Treat it as containment, not immunity.

---

## 3. Entity-secret protection (rotation + exfiltration resistance)

- **Not stored by Circle; you own it.** 32-byte key; Circle keeps only the RSA public key you encrypt against. Storage guidance is *yours*: secrets manager / HSM / encrypted password manager. Circle does **not** offer a managed HSM that holds the secret for you. Ref: https://developers.circle.com/wallets/dev-controlled/entity-secret-management
- **Ciphertext is single-use** (replay-protected, error `177602`). Helps against a captured *ciphertext*; does **nothing** against a captured *raw secret*. Ref: https://developers.circle.com/wallets/dev-controlled/register-entity-secret
- **Rotation is supported and takes effect immediately**, deprecating the old secret and its recovery file. Provide current ciphertext + newly-derived ciphertext (new 32-byte secret); done via SDK `registerEntitySecretCiphertext` flow / Console. In-flight requests on the old secret fail after rotation. Ref: https://developers.circle.com/wallets/dev-controlled/entity-secret-management
- **Exfiltration resistance you must build (Circle won't):** keep the raw secret out of application memory. The strongest posture short of removing custody is to move the *encrypt-with-Circle-public-key* step into an isolated boundary (see checklist P2): the app service holds no plaintext secret; a minimal, separately-permissioned signer service (or KMS/HSM-backed function) fetches the secret, produces the per-request ciphertext, and returns only the ciphertext. A breach of the main backend then yields ciphertexts (single-use, rate-limitable, destination-screened) rather than the master secret.

---

## 4. Passkey-gated withdrawals (the real fix) — Modular Wallets

**Circle Modular Wallets** are MSCA smart accounts whose signer is a **passkey (WebAuthn, secp256r1) stored in the user device's secure enclave**. The server never holds the key; the chain enforces that only a valid passkey signature can authorize a transaction. This is genuinely immune to a backend/entity-secret breach because there is no server-side key to steal. Refs: https://developers.circle.com/wallets/modular/passkeys , https://developers.circle.com/wallets/key-management

**Why you can't just "add a passkey" to the existing dev-controlled EOA:** custody models don't mix on one account. A developer-controlled EOA is MPC/entity-secret-signed by definition; a passkey signer requires an MSCA. So the hybrid is an *architecture split*, not a config flag — see Section 6.

---

## 5. Gateway / CCTP-level protections

- **Gateway 7-day trustless withdrawal delay** exists but only guards the *onchain trustless* exit used when Circle's API is down. The **instant API path your app uses is signed by the wallet key** (= entity secret in your model), so it does not gate an attacker. Gateway's design explicitly ensures "no methods of removing USDC that don't involve a user signature" — but in the custodial model, that "user signature" is produced by the entity secret. Ref: https://developers.circle.com/gateway/references/technical-guide
- **CCTP `destinationCaller`** can pin which address may call `receiveMessage` to mint on the destination — useful to stop griefing/front-running of mints, but it does not constrain where a burn's proceeds ultimately land when the attacker controls both origination and the caller. Ref: https://developers.circle.com/cctp/howtos/retry-failed-mint
- **OFAC/sanctions auto-blocklist** restricts sanctioned counterparties only; a competent attacker withdraws to a fresh, un-sanctioned address. Ref: https://developers.circle.com/w3s/compliance-requirements
- **There is no configurable CCTP/Gateway withdrawal delay or denylist you can point at "everything except the user's wallet."** Destination pinning must come from the Compliance Engine (Section 2) or from the passkey architecture (Section 4).

---

## 6. Recommended target architecture — keyless spend, passkey withdrawal (hybrid)

```
                 ┌──────────────────────────────────────────────┐
   Agent (API    │  SPEND LANE (keyless, custodial)             │
   key, bounded) │  Dev-controlled EOA on Arc                   │
        ───────► │  - pays allowlisted MERCHANT/service addrs   │
                 │  - Compliance allowlist = merchants + USER'S  │
                 │    OWN passkey vault ONLY                     │
                 └───────────────┬──────────────────────────────┘
                                 │ sweep-out is ALSO destination-pinned:
                                 │ the ONLY non-merchant allowlisted dest
                                 │ is the user's passkey Modular Wallet
                                 ▼
                 ┌──────────────────────────────────────────────┐
   User device   │  WITHDRAWAL LANE (non-custodial)             │
   passkey ───►  │  Circle Modular Wallet (MSCA, WebAuthn key)  │
   (WebAuthn)    │  - transfers OUT to arbitrary addresses      │
                 │    require the device passkey signature      │
                 │  - server/entity-secret CANNOT move these    │
                 └──────────────────────────────────────────────┘
```

**Key property:** even with a full backend breach (entity secret + API key + your DB), the attacker can, at worst, push funds from the custodial EOA to **only** the Compliance-allowlisted destinations — merchants (whose payout addresses you control/know) and the **user's own passkey vault**. They cannot send to an attacker address (blocked by the destination allowlist, defended by Console credentials they don't have), and they cannot move funds *out of* the passkey vault (no server-side key). The breach becomes "attacker can prepay the user's legitimate merchants and/or shove money into the user's own cold vault" — annoying, not draining.

This preserves keyless spending (no passkey prompt per payment) while making withdrawal require a device passkey.

---

## 7. Prioritized implementation checklist

Priorities: **P0** = do now, biggest breach-containment per effort. **P1** = strong hardening. **P2** = defense-in-depth. **P3** = target-architecture migration.

### P0 — Containment that survives an entity-secret leak (Console-side; no code)
- [ ] **P0.1 Apply for Circle Compliance Engine.** Submit the request form (linked from the tx-screening page). Blocks funds/hardening below depend on approval. Owner: whoever owns the Circle account.
- [ ] **P0.2 Build a destination Allowlist watchlist** in Console → Compliance Engine → Watchlists: add (a) each supported chain's known merchant/service payout addresses, and (b) each user's own withdrawal/passkey-vault address. Ref: https://developers.circle.com/wallets/compliance-engine/tx-screening-rule-management
- [ ] **P0.3 Configure a default-deny-outbound rule set** so any outbound transfer to a non-allowlisted address triggers **Transaction Decision = deny (do not broadcast)**. Confirm the exact rule composition with Circle during onboarding (default-deny is not a single toggle; the whitepaper Part 3 covers requirement design). Verify with a testnet transfer to a non-allowlisted address (should be denied) and to an allowlisted one (should pass).
- [ ] **P0.4 Lock down Console access as the "break-glass over the entity secret."** Circle team roles: minimize Admins, require SSO+MFA on every Console login, put Owner on a hardware-key account. This is the credential that must NOT fall with the backend — the whole containment story assumes the attacker has the entity secret but not Console/Admin. Ref: https://developers.circle.com/w3s/manage-team-members
- [ ] **P0.5 Document and drill the Wallet Freeze kill-switch.** Know how to freeze wallets from Console (state surfaces as error `177301`). Add a runbook: on anomaly (see P1.2), freeze affected wallets in one action.

### P1 — Reduce exposure window & detect abuse
- [ ] **P1.1 Automate entity-secret rotation.** Scheduled rotation (e.g., ≤30 days) + immediate on-demand rotation triggered by the incident runbook, via `registerEntitySecretCiphertext` rotation flow. Ensure in-flight requests drain first (old secret fails post-rotation). Ref: https://developers.circle.com/wallets/dev-controlled/entity-secret-management
- [ ] **P1.2 Anomaly detection + auto-freeze.** Subscribe to Circle transaction webhooks; alert + auto-freeze on: outbound to any address not in the allowlist, velocity spikes, or off-hours drains. (Webhook IPs to trust: `54.243.112.156`, `100.24.191.35`, `54.165.52.248`, `54.87.106.46` — https://developers.circle.com/wallets/webhook-notifications )
- [ ] **P1.3 Keep app-level spend limits, but treat them as UX/abuse control only** — document that they do NOT survive a backend breach, so nobody over-relies on them.
- [ ] **P1.4 Separate API keys per environment/service, least-privilege Console roles, rotate API keys on the same cadence as the entity secret.**

### P2 — Shrink the raw-secret blast radius
- [ ] **P2.1 Isolate the entity secret behind a minimal signer boundary.** The main app never holds the plaintext secret; a small, separately-deployed, separately-permissioned function (KMS/HSM-decrypts the secret, produces the single-use ciphertext, returns only the ciphertext). Rate-limit and destination-check inside this boundary. A breach of the main backend then yields ciphertexts (single-use, screened) not the master key. (Circle offers no managed version of this — it's yours to build. Storage guidance: https://developers.circle.com/wallets/dev-controlled/entity-secret-management )
- [ ] **P2.2 Egress-lock the signer boundary** so it can only reach `api.circle.com` (an exfiltrated ciphertext still must be spent through Circle, where P0.3 screening applies).
- [ ] **P2.3 Do NOT rely on Gas Station policy for value limits** — configure it (daily/per-tx caps, sender blocklist) as a minor gas-abuse cap only. Refs: errors `177019`–`177023`, https://developers.circle.com/wallets/gas-station

### P3 — Target architecture: passkey-gated withdrawal (removes custody from the exit)
- [ ] **P3.1 Introduce a Circle Modular (passkey/WebAuthn) Wallet per user** as the withdrawal vault. SDK: https://developers.circle.com/wallets/modular/create-a-wallet-and-send-gasless-txn , sample: https://github.com/circlefin/modularwallets-web-sdk/tree/master/examples/circle-smart-account
- [ ] **P3.2 Make the custodial EOA's only non-merchant allowlisted destination the user's passkey vault** (ties P0.2/P0.3 to the vault address). Sweeps in are keyless; sweeps out require the device passkey.
- [ ] **P3.3 Route all user "withdraw to external address" flows through the passkey wallet** (device WebAuthn prompt). Server/entity-secret cannot authorize these — this is the property that finally makes "even with the entity secret, no drain" literally true for withdrawals.
- [ ] **P3.4 Passkey recovery** via BIP-39 mnemonic backup so device loss ≠ fund loss. Ref: modular wallets passkey recovery docs.

---

## 8. Honest residual risk after ALL mitigations

Even with P0–P3 fully implemented, these remain:

1. **Console/Admin compromise = game over.** The entire containment story rests on the Compliance rules and Wallet Freeze being defended by Console credentials that fall *separately* from the backend. If an attacker phishes an Admin/Owner (or steals a Console session), they can disable the allowlist rule, unfreeze wallets, or change roles — then drain with the (also-stolen) entity secret. **Mitigation ceiling:** hardware-key MFA + minimal Admins + alerting on Console rule changes. Circle does not offer a "rules are append-only / n-of-m to disable" control, so this is a real single point of failure.

2. **Funds parked in the custodial spend-EOA are drainable *to allowlisted destinations*.** A breach can still prepay merchants or shove all balances into the user's passkey vault. If any allowlisted "merchant" payout address is attacker-influenceable, that's an exfil path. **Mitigation:** keep spend-EOA balances minimal (just-in-time funding), vet merchant addresses, monitor. This is capital-at-risk = "float in the hot wallet," not "everything."

3. **Compliance Engine is gated, AML-shaped, and not amount-aware.** If Circle declines eligibility, P0.2/P0.3 are unavailable and your only real defense collapses to detect-and-rotate (P1) plus the P3 passkey split. Per-day/per-tx *value* caps are not Circle-enforced at all — a breach within your allowlist has no Circle-side value ceiling.

4. **Rotation and freeze are reactive.** They shrink the window but assume detection. A fast, quiet drain to an allowlisted address between webhook and freeze can still complete. Sub-second finality on Arc makes the detection→freeze race tight.

5. **Passkey model shifts, doesn't eliminate, risk.** It removes server-side custody of *withdrawals* but adds device-loss / passkey-phishing / recovery-mnemonic-theft risk, now borne by the user.

6. **Supply-chain / dependency compromise** of the signer boundary (P2) can still exfiltrate ciphertexts in real time and spend them within the allowlist before egress controls trip.

**Bottom line:** You can get to *"a full backend + entity-secret breach cannot send funds to an attacker-chosen address and cannot touch the passkey vault"* — which defeats the total-drain scenario for withdrawals and caps spend-lane loss to hot-wallet float bound for known merchants. You **cannot** get to *"a breach can do literally nothing"* while (a) keeping spending keyless and (b) relying on Circle's custodial signing, because the entity secret remains a valid signer within whatever destination envelope you configure. The residual, irreducible trust is in **Circle Console access control** and in **keeping the hot spend-wallet balance small**.
