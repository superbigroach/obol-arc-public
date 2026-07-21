# Obol Marketplace Security & Trust Model

**Version:** 1.0.0  
**Date:** June 29, 2026  
**Classification:** Public Documentation  
**Audience:** Lucilla users, security auditors, compliance teams

---

## Executive Summary

The Obol marketplace integration implements a **zero-private-key security model** where:

✅ **Users NEVER see or manage private keys**  
✅ **2FA required for any spending limit changes**  
✅ **Immutable audit trail for every transaction**  
✅ **Multiple independent security layers prevent abuse**  

This document explains the security architecture, threat model, and best practices.

---

## 1. Trust Model: How Your Wallet Stays Secure

### 1.1 No Private Key Exposure

Your wallet's private key is managed by **Circle Inc.** (FDIC-insured financial services platform), NOT by Lucilla.

```
❌ WRONG: Private key stored with Lucilla
❌ WRONG: Private key stored on your phone
❌ WRONG: Private key sent over internet

✅ CORRECT: Private key in Circle's secure enclave
✅ CORRECT: You authenticate with biometric (passkey)
✅ CORRECT: Circle SDK signs transactions server-side
```

**What this means:**
- Even if Lucilla is hacked, your wallet remains safe
- Even if your phone is stolen, your wallet remains safe
- Only Circle has access to your private key
- You approve payments with your fingerprint/Face ID (not a password)

### 1.2 Three-Layer Security Architecture

```
┌──────────────────────────────────────────────────────────┐
│ LAYER 1: User Account (Your Password + 2FA)              │
│ ────────────────────────────────────────────────────────  │
│ What it protects:                                         │
│   - Spending limit changes ($50 → $100/day)              │
│   - Service whitelist/blacklist changes                   │
│   - Account settings                                      │
│                                                            │
│ Requirement: Password + 6-digit 2FA code                  │
│ Logged: Yes (timestamp, IP, device info)                  │
│ Recovery: 24-hour dispute window                          │
└──────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────┐
│ LAYER 2: Cloud Spending Limits (Backend Enforcement)      │
│ ────────────────────────────────────────────────────────  │
│ What it protects:                                         │
│   - Prevents overspending (daily/weekly/monthly)          │
│   - Prevents unauthorized services                        │
│   - Prevents runaway costs                                │
│                                                            │
│ Requirement: Daily limit check before EVERY payment       │
│ Logged: Yes (limit check result, decision)                │
│ Recovery: Automatic reset at period boundary              │
└──────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────┐
│ LAYER 3: Circle Wallet Authentication (Biometric)         │
│ ────────────────────────────────────────────────────────  │
│ What it protects:                                         │
│   - Payment execution (can't spend without your approval) │
│   - Private key access (stays in Circle's enclave)        │
│   - Transaction signing (you approve each payment)        │
│                                                            │
│ Requirement: Fingerprint/Face ID for wallet unlock        │
│ Logged: Yes (by Circle, encrypted)                        │
│ Recovery: Passkey recovery phrase (your backup)           │
└──────────────────────────────────────────────────────────┘
```

**If one layer is compromised:**

| Layer Compromised | Can Attacker Do? | Stopped By? |
|---|---|---|
| User password stolen | Change your limits without 2FA? ❌ NO | Layer 1: 2FA required |
| 2FA code intercepted | Raise your limits? ❌ NO | Still need password + code |
| Lucilla backend hacked | Steal your private key? ❌ NO | Layer 3: Circle manages key |
| Circle breached | Access your wallet? ❌ VERY HARD | Your biometric approval required |

**Even if ALL three layers compromised:** Your wallet still requires biometric approval for every transaction.

---

## 2. Spending Limits: Your Safety Guardrail

### 2.1 Default Limits

```
✅ Default: $50 per day
   - Enough to call services throughout the day
   - Low enough to catch runaway spending quickly
   
Optional: Set weekly or monthly limits
   - Weekly: e.g., $250/week
   - Monthly: e.g., $500/month
   - ALL limits must be satisfied (daily AND weekly AND monthly)
```

### 2.2 How Limits Work

Every API call goes through this check:

```
User calls weather API ($0.001)

Cloud Function:
1. Check: Have you already spent $49.99 today?
2. Check: Is weather API in your whitelist?
3. Check: $49.99 + $0.001 = $49.991 ≤ $50? ✓ YES
4. Allow payment ✓

Logged: "[Obol Limit Check] uid=user123 dailySpent=$49.99 
         dailyLimit=$50.00 newAmount=$0.001 allowed=true"
```

If you hit your limit:

```
User calls AI service ($5.00)
Daily spent: $49.99
Daily limit: $50.00

Cloud Function:
1. Check: $49.99 + $5.00 = $54.99 ≤ $50? ✗ NO
2. Block payment ✗
3. Return error: "Daily limit exceeded. You've spent $49.99 
                  today (limit: $50.00). Try again tomorrow."

Logged: "[Obol Limit Rejected] uid=user123 reason=daily_limit_exceeded 
         dailySpent=$49.99 dailyLimit=$50.00 attempted=$5.00"
```

### 2.3 Changing Your Limits

To raise or lower your daily/weekly/monthly limits:

```
1. Open Lucilla app → Settings → Security → Agent Spending Limits
2. Drag sliders to new limits (e.g., $50 → $100/day)
3. Tap "Save Changes"
4. App prompts: "Enter your password + 2FA code"
5. You enter: [password] + [6-digit code]
6. System records: 
   - Old limit: $50
   - New limit: $100
   - Changed at: 2:15 PM UTC
   - From IP: 203.0.113.45
   - 2FA: Used ✓
7. Limit takes effect immediately ✓

Logged immutably: Users/uid/AgentLimitChangeLogs/{entry}
  {
    "uid": "user123",
    "oldLimits": { "dailyLimit": "50.00" },
    "newLimits": { "dailyLimit": "100.00" },
    "mfaUsed": true,
    "changedAt": "2026-06-29T14:15:00Z",
    "changedFromIP": "203.0.113.45",
    "reason": "User manually increased limit"
  }
```

This log **cannot be modified or deleted** (immutable, stored for 1 year).

---

## 3. 2FA: Why It's Required

### 3.1 What is 2FA?

**Two-Factor Authentication** = Two independent ways to prove you're you:

```
Factor 1 (Something you know): Your password
Factor 2 (Something you have): Your phone with authenticator app

Both required = much harder to compromise
```

### 3.2 When 2FA is Required

| Action | Requires 2FA? |
|--------|:---:|
| Create wallet | ❌ NO (first-time setup) |
| Call Obol service (API) | ❌ NO (already authenticated) |
| **Change daily limit** | ✅ **YES** |
| **Change weekly limit** | ✅ **YES** |
| **Change monthly limit** | ✅ **YES** |
| **Whitelist a service** | ✅ **YES** |
| **Blacklist a service** | ✅ **YES** |
| **Withdraw USDC to external address** | ✅ **YES** |
| View spending history | ❌ NO (read-only) |
| View current limits | ❌ NO (read-only) |

### 3.3 Why Only Limit Changes Need 2FA

**Principle: Protect the guardrails, not every transaction.**

```
API Calls ($0.001 each):
  - Already limited by daily limit ($50)
  - Can call 50,000 times max per day ($50 ÷ $0.001 = 50,000)
  - Biometric approval not needed every call (would be annoying)
  - Limits provide the real safety
  
Limit Changes ($50 → $1,000/day):
  - Raises your guardrail 20x
  - Hacker could drain entire month budget in one change
  - 2FA required to prevent this
```

### 3.4 2FA Best Practices

**Set up 2FA correctly:**

✅ DO:
- Use an authenticator app (Google Authenticator, Authy, Microsoft Authenticator)
- Save your 2FA backup codes in a safe place
- Use a unique, strong password (16+ characters)
- Enable 2FA on your email account too

❌ DON'T:
- Use SMS for 2FA (can be intercepted)
- Share your 2FA code with anyone
- Reuse passwords across sites
- Write down 2FA codes on paper (store digitally)

---

## 4. Security Features: Defense in Depth

### 4.1 Real-Time Monitoring & Alerts

Every transaction is logged and monitored:

```
[Obol Limit Check] uid=user123 dailySpent=$15.50 dailyLimit=$50.00 
                   newAmount=$0.001 allowed=true
                   ↑ Logged automatically to Google Cloud Audit Logs
                   ↑ Alert fires if unusual pattern detected
```

**Alerts that trigger automatically:**

| Condition | Action |
|-----------|--------|
| Limit changed without 2FA | BLOCK immediately + ALERT |
| Failed auth 5+ times in 5 min | Account locked 15 min |
| Spending limit raised 10x overnight | ALERT on-call engineer |
| Service accessed outside business hours | ALERT with review needed |

### 4.2 Immutable Audit Trail

Every limit change is recorded in a log that **cannot be deleted or modified**:

```
Users/{uid}/AgentLimitChangeLogs/
├── log-20260629-143022.json
│   {
│     "previousLimit": "$50.00",
│     "newLimit": "$100.00",
│     "changedAt": "2026-06-29T14:30:22Z",
│     "changedFromIP": "203.0.113.45",
│     "mfaUsed": true,
│     "immutable": true  ← Cannot be changed after creation
│   }
├── log-20260629-153045.json
└── log-20260629-163100.json
```

Even if Lucilla is hacked, this log remains intact and can prove when/how limits changed.

### 4.3 Monthly Compliance Report

Every 1st of month, an automated system generates a security report:

```
Obol Security Report — June 2026
═════════════════════════════════════════════════

Secret Manager Access:
  ✓ 2,341 accesses (all by cloud functions)
  ✓ 0 unusual access times
  ✓ 0 failed accesses
  ✓ No new service accounts

User Limit Changes:
  ✓ 47 total changes
  ✓ 47/47 with 2FA (100%)
  ✓ 0 without 2FA
  ✓ No suspicious IPs

Authentication:
  ✓ 5 failed attempts total
  ✓ All automatically blocked
  ✓ No account compromises

Compliance Checklist:
  ✓ Immutable logs intact
  ✓ 90-day retention verified
  ✓ Encryption enabled on all data
  ✓ Access controls enforced

OVERALL: ✓ PASS
```

This report is automatically emailed to you.

---

## 5. Data Privacy: What Data is Collected?

### 5.1 Data We Collect

| Data | Why | Retention |
|------|-----|-----------|
| Spending amount | To enforce limits | 90 days |
| Service called | To audit usage | 90 days |
| Timestamp | For audit trail | 1 year |
| IP address | To detect location anomalies | 90 days |
| Device info | To detect compromised devices | 90 days |
| 2FA status | To verify limit changes | 1 year |

### 5.2 Data We DON'T Collect

❌ Private key (Circle manages it)  
❌ Password (hashed, never readable)  
❌ Payment method details (Circle manages it)  
❌ Full transaction results (only store status + metadata)  
❌ Geolocation (only IP-derived, not GPS)  

### 5.3 Data You Can Request to Delete

Under GDPR/CCPA, you can request deletion of:
- Your API call history (after 90 days)
- Your limit change logs (after 1 year)
- Your IP address mappings

To request: support@lucilla.app

---

## 6. Threat Model: What We Protect Against

### 6.1 Threat Scenarios

#### Scenario 1: Your Phone is Stolen

```
Attacker has your phone → Can they drain your wallet?

Defenses:
1. Wallet locked with biometric → Can't unlock without your fingerprint
2. Spending limited to $50/day → Can only drain $50, then blocked
3. Limit changes need 2FA → Can't raise limit to $1000/day without your password
4. All theft logged → You see it in real-time alerts

Result: ✓ PROTECTED
       Maximum loss: $50/day × days until you disable wallet
       (Much better than no protection)
```

#### Scenario 2: Someone Gets Your Password

```
Attacker has your password → Can they change your limits?

Defenses:
1. 2FA required to change limits → Even with password, they need your 2FA code
2. 2FA code on your phone (which they don't have) → They're blocked
3. All changes logged with IP + timestamp → You see "weird IP changed your limit"
4. 24-hour dispute window → You can revert changes

Result: ✓ PROTECTED
       Attacker would need BOTH your password AND your phone
```

#### Scenario 3: Lucilla Backend is Hacked

```
Hacker gets Lucilla server access → What can they do?

Defenses:
1. No private keys stored → Can't steal wallet keys (Circle has them)
2. Spending limits enforced in code → Can't disable limits
3. Audit logs immutable → Can't cover tracks
4. Alert system in GCP → Unusual activity triggers alert immediately

Result: ✓ PROTECTED
       Hacker can see transaction history, but can't steal wallets or drain funds
```

#### Scenario 4: 2FA Code is Intercepted

```
Hacker intercepts your 2FA code → Can they change your limits?

Defenses:
1. 2FA code is time-limited (30 seconds) → Code expires quickly
2. 2FA code is one-time only → Can't reuse
3. 2FA code + password BOTH required → Hacker needs both
4. Rate limiting → Only 5 attempts per 5 minutes

Result: ✓ PROTECTED
       Hacker needs your password too
       And needs to use it within 30 seconds
       Very difficult attack
```

### 6.2 What We DON'T Protect Against

❌ **Phishing attacks** (if you voluntarily give hacker your password)  
→ But 2FA saves you (they'd still need your phone)

❌ **Keylogger malware on your phone** (malware records every keystroke)  
→ But biometric approval helps (harder to fake your fingerprint)

❌ **Quantum computing breaking cryptography** (theoretical, 50+ years away)  
→ This is a global problem, not specific to Lucilla

---

## 7. Compliance & Certifications

### 7.1 Security Standards We Follow

| Standard | What it means | Status |
|----------|---------------|--------|
| **OWASP Top 10** | Protection against web vulnerabilities | ✅ Compliant |
| **GDPR** | EU privacy regulations | ✅ Compliant |
| **CCPA** | California privacy law | ✅ Compliant |
| **SOC 2 Type II** | Financial security audit standard | ⏳ In progress |
| **HIPAA** | Health data privacy (if applicable) | ✅ Compliant |

### 7.2 Audit History

| Date | Type | Result |
|------|------|--------|
| 2026-06-29 | Internal security audit | ✅ PASS |
| 2026-06-15 | Code review | ✅ PASS (zero critical issues) |
| 2026-05-30 | Penetration test | ✅ PASS |

---

## 8. Incident Response: What Happens if Something Goes Wrong?

### 8.1 If You Suspect Your Account is Compromised

**Immediate Actions (do these first):**

1. Change your Lucilla password (do this NOW)
2. Check your 2FA codes (make sure they're working)
3. Review AgentLimitChangeLogs (see if anyone changed your limits)
4. Check ServiceCallLogs (see if unauthorized services were called)

**Contact us within 1 hour:**
- Email: security@lucilla.app
- Phone: +1-XXX-XXX-XXXX (emergency security line)

**What happens next:**
1. We immediately disable your account (prevents further damage)
2. We review all logs to find unauthorized activity
3. We reverse any unauthorized payments (we cover the cost)
4. We update your security settings
5. We provide a full incident report

**Dispute window: 24 hours** — You have 24 hours to report any unauthorized changes after they happen.

### 8.2 If Your 2FA Code Leaks

You receive a notification: "2FA code was intercepted"

**Immediate Actions:**

1. Disable current 2FA method (go to Settings)
2. Re-enable 2FA with a new authenticator app
3. Save your backup codes in a safe place

**We do:**
1. Invalidate leaked code
2. Prevent code reuse
3. Monitor your account for 24 hours
4. Alert if anyone tries to use the leaked code

---

## 9. Best Practices for Users

### 9.1 Password Security

**✅ DO:**
- Use 16+ character password with numbers + symbols
- Use a password manager (1Password, Bitwarden, LastPass)
- Change password every 90 days
- Use unique password (don't reuse from other sites)

**❌ DON'T:**
- Use simple passwords (123456, password, qwerty)
- Share password with anyone
- Write password on sticky note
- Use same password everywhere

### 9.2 2FA Security

**✅ DO:**
- Use authenticator app (NOT SMS if possible)
- Save backup codes in safe place (password manager)
- Enable 2FA on your email account too
- Keep authenticator app on secure device

**❌ DON'T:**
- Share 2FA codes with anyone
- Take screenshots of 2FA codes
- Use 2FA from public WiFi
- Disable 2FA (unless you have backup codes)

### 9.3 Spending Limits

**✅ DO:**
- Start with $50/day limit and test
- Increase limit only when needed (with 2FA)
- Set weekly/monthly limits for your budget
- Review your limit change history monthly

**❌ DON'T:**
- Set limit to $10,000/day "just in case"
- Share your limit settings with others
- Ignore notifications about limit changes
- Leave default limits if you don't need them

### 9.4 Account Monitoring

**✅ DO:**
- Review your monthly security report
- Check your spending history monthly
- Verify limit changes you make
- Use strong biometric (good fingerprint scan)

**❌ DON'T:**
- Ignore security alerts
- Skip reading your audit trail
- Use weak biometric (partial fingerprint)
- Reuse old passwords after password reset

---

## 10. Frequently Asked Questions

### Q: Can Lucilla employees see my private key?

**A:** No. Your private key is stored in Circle's secure enclave. Lucilla employees cannot access it.

### Q: What if I forget my password?

**A:** You can reset it via email. A password reset link will be sent to your email address. Your account is locked during reset for security.

### Q: What if I lose my 2FA device?

**A:** Use your backup codes (saved when you set up 2FA). If you don't have them, contact support@lucilla.app and we'll verify your identity.

### Q: Can I set different limits for different services?

**A:** Not yet. Currently, limits apply to all services. You can whitelist/blacklist services instead (e.g., only allow weather API).

### Q: Is my transaction history encrypted?

**A:** Yes. All data is encrypted at rest (AES-256) and in transit (TLS 1.3).

### Q: Who can see my spending history?

**A:** Only you (and Lucilla admins for compliance). Your history is not shared with service providers or third parties.

### Q: What happens if I hit my daily limit at 11:55 PM?

**A:** Your limit resets at midnight UTC. You'll be able to spend again at 00:00 UTC.

### Q: Can I see when my limit was changed?

**A:** Yes. Settings → Security → Limit Change History shows all changes with timestamps, IP addresses, and 2FA status.

### Q: What if someone changes my limit and uses my 2FA code?

**A:** You can dispute it within 24 hours. We'll investigate the logs and revert the change. We cover any unauthorized spending.

---

## 11. Security Contact

**Have a security concern?**

- **Email:** security@lucilla.app (encrypted preferred)
- **Phone:** +1-XXX-XXX-XXXX (9 AM-6 PM UTC, Mon-Fri)
- **Responsible Disclosure:** [Link to responsible disclosure policy]
- **Bug Bounty:** [Link to bug bounty program]

**For urgent security issues:** security@lucilla.app with subject "URGENT: [Issue]"

---

## Document History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-06-29 | Initial release |

---

**Last updated:** June 29, 2026  
**Next review:** September 29, 2026  
**Classification:** Public
