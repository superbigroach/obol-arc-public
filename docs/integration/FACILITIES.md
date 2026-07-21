# Obol Facilities & Mainnet Setup

## Overview

This document describes the Arc network facilitator wallets and Gnosis Safe multisig setups for Obol integration.

---

## Arc Mainnet Facilitator Safe

### Safe Details

| Property | Value |
|----------|-------|
| **Safe Address** | `0xb414...4505` |
| **Network** | Arc Mainnet |
| **Signers** | 2-of-4 quorum |
| **Signer List** | See [Signers](#signers) below |
| **Safe URL** | https://safe.arc.obol-arc.web.app/app/home?safe=0xb414...4505 |
| **Created** | 2026-06-01 |
| **Status** | Active |

### Signers

| Signer | Address | Role | Key Location |
|--------|---------|------|--------------|
| Sebastian Borjash (superbigroach) | `0x1111...1111` | Owner | Personal key |
| Circle Finance (Institutional) | `0x2222...2222` | Signer | Circle internal |
| Lucilla Treasury | `0x3333...3333` | Signer | Secret Manager |
| Governance | `0x4444...4444` | Signer | Multisig contract |

### Safe Ownership

The Safe holds the Obol metering contract and is responsible for:
- Minting/burning metering tokens
- Setting operator fees
- Pausing/unpausing the system
- Withdrawing accumulated fees

Changes require 2-of-4 approval.

---

## Arc Testnet Facilitator (Local Development)

### Setup

For **local development only**, use a simple wallet (not a Safe):

```bash
# Generate a random testnet facilitator wallet
node << 'EOF'
const ethers = require('ethers');
const wallet = ethers.Wallet.createRandom();
console.log('Testnet Facilitator Address:', wallet.address);
console.log('Testnet Facilitator Private Key:', wallet.privateKey);
EOF
```

### Configuration

Add to `.env.local`:
```bash
OBOL_FACILITATOR_PRIVATE_KEY=0x...testnet_key...
OBOL_NETWORK=arc-testnet
```

### Funding

Fund the testnet facilitator with:
- **Testnet ETH**: https://faucet.arc-testnet.obol-arc.web.app/eth (0.1+ for gas)
- **Testnet USDC**: https://faucet.arc-testnet.obol-arc.web.app/usdc (1000+ for metering)

---

## Safe Transaction Types

### 1. Owner/Signer Management

**Scenario**: Add a new signer or remove a compromised signer

**Safe Transaction**:
```
Call: addOwnerWithThreshold(address, uint256)
To: Safe contract
Data: { owner: 0x..., threshold: 2 }
```

**Approval**: 2-of-4 signers

**Timeline**: Immediate execution after 2 approvals

---

### 2. Metering Contract Ownership Transfer

**Scenario**: Rotate the metering contract owner (e.g., new Safe)

**Safe Transaction**:
```
Call: transferOwnership(address)
To: LucillaEcosystemV2 (0x...)
Data: { newOwner: 0x... }
```

**Approval**: 2-of-4 signers

**Timeline**: Immediate

---

### 3. Update Operator Fees

**Scenario**: Change the Obol operator fee percentage

**Safe Transaction**:
```
Call: setOperatorFeePercent(uint256)
To: LucillaEcosystemV2 (0x...)
Data: { feePercent: 500 } // 5% = 500 basis points
```

**Approval**: 2-of-4 signers

**Timeline**: Immediate

---

### 4. Pause/Unpause System

**Scenario**: Emergency pause if malicious activity detected

**Safe Transaction**:
```
Call: pause() or unpause()
To: LucillaEcosystemV2 (0x...)
Data: {}
```

**Approval**: 1 signer (fast pause) or 2-of-4 (normal)

**Timeline**: Immediate (pause), 24h delay (unpause)

---

### 5. Withdraw Accumulated Fees

**Scenario**: Transfer operator fees from Safe to treasury

**Safe Transaction**:
```
Call: withdrawOperatorFees()
To: LucillaEcosystemV2 (0x...)
Data: {}
```

**Approval**: 2-of-4 signers

**Timeline**: Monthly or as needed

---

## Safe Operation Workflow

### Initiating a Transaction

1. **Open Safe App**:
   - Mainnet: https://safe.arc.obol-arc.web.app/app/home?safe=0xb414...4505
   - Testnet: https://safe.arc-testnet.obol-arc.web.app

2. **Click "New Transaction"**

3. **Fill in transaction details**:
   - Recipient: Contract address (e.g., `0x...LucillaEcosystem`)
   - Amount: 0 (for contract calls)
   - Data: Encoded function call
   - Safe Nonce: Auto-filled

4. **Review & Sign**:
   - Click "Review"
   - Verify all details
   - Click "Submit"
   - Sign with your wallet (MetaMask, WalletConnect, etc.)

5. **Collect Signatures**:
   - Notify other signers via email/Slack
   - Each signer opens Safe app, signs the pending transaction
   - After 2 approvals, transaction executes automatically

### Monitoring Transaction Status

```bash
# Check pending transactions
curl https://safe-transactions-arc.safe.global/api/v1/safes/0xb414...4505/multisig-transactions/

# Look for:
# - isExecuted: false (pending)
# - confirmations: [array of signers who approved]
```

---

## Emergency Procedures

### If Mainnet Facilitator Key is Compromised

1. **IMMEDIATE**: Alert all Safe signers on Slack (#security-alerts)
2. **URGENT**: Propose Safe transaction to remove the compromised signer
3. **CRITICAL**: Require 2-of-4 approval within 1 hour
4. **FOLLOW-UP**: Post-mortem with signers, review security procedures

### If Safe Multisig is Broken (e.g., < 2 signers available)

1. **FALLBACK**: Use the legacy Lucilla Treasury Safe (if configured)
2. **TEMPORARY**: Allow single-signer approval (if emergency authorized)
3. **RESOLUTION**: Recruit new signers, transfer ownership to new Safe

### If Metering Contract is Paused

1. **Assess**: Check Safe transaction history for who paused it
2. **DECIDE**: Is it a legitimate emergency or a mistake?
3. **UNPAUSE**: Propose Safe transaction to unpause (2-of-4 approval)
4. **DELAY**: Unpause has 24-hour delay to prevent abuse

---

## Access & Permissions

### Who Can Sign Safe Transactions?

| Signer | Can Sign? | Notes |
|--------|-----------|-------|
| Sebastian Borjash | ✅ Yes | Primary signer |
| Circle Finance | ✅ Yes | Institutional approval required |
| Lucilla Treasury | ✅ Yes | Automated wallet (if HSM-backed) |
| Governance | ✅ Yes | Governance DAO or contract |

### How to Grant Access to New Signer

1. Propose Safe transaction to add new signer:
   ```
   addOwnerWithThreshold(0xNewSigner, 2)
   ```
2. Require 2-of-4 approval
3. Execute automatically
4. New signer can now sign future transactions

---

## Monitoring & Alerts

### Safe Transaction Alerts

Set up alerts for suspicious Safe activity:

```bash
# Alert: Large fee withdrawal
gcloud monitoring policies create \
  --notification-channels <CHANNEL_ID> \
  --display-name "Obol: Large Fee Withdrawal" \
  --condition-filter 'resource.type="custom.googleapis.com/safe_transaction" AND labels.method="withdrawOperatorFees" AND labels.amount > 10000'

# Alert: Signer removed
gcloud monitoring policies create \
  --notification-channels <CHANNEL_ID> \
  --display-name "Obol: Signer Removed" \
  --condition-filter 'resource.type="custom.googleapis.com/safe_transaction" AND labels.method="removeOwner"'

# Alert: Ownership transferred
gcloud monitoring policies create \
  --notification-channels <CHANNEL_ID> \
  --display-name "Obol: Ownership Transferred" \
  --condition-filter 'resource.type="custom.googleapis.com/safe_transaction" AND labels.method="transferOwnership"'
```

### Manual Audit (Monthly)

Run this monthly to audit Safe activity:

```bash
# Check all Safe transactions in the last 30 days
curl -s https://safe-transactions-arc.safe.global/api/v1/safes/0xb414...4505/multisig-transactions/?executed=true \
  | jq '.results | map({date:.submissionDate, method:.data[:10], executor:.executor, status:.isExecuted})'

# Manually review for:
# - Unexpected transactions
# - Unusual signers
# - Abnormal amounts
```

---

## Testnet vs Mainnet Comparison

| Property | Testnet | Mainnet |
|----------|---------|---------|
| **Facilitator Type** | Single wallet | Gnosis Safe (2-of-4) |
| **Key Storage** | `.env.local` (local dev) | Secret Manager + Safe |
| **Transaction Approval** | Instant (single sig) | 2-of-4 approval (may take hours) |
| **RPC Endpoint** | https://rpc.arc-testnet.obol-arc.web.app | https://rpc.arc.obol-arc.web.app |
| **USDC** | Testnet USDC (faucet) | Mainnet USDC (real money) |
| **Risk Level** | Low (testnet only) | High (real funds at risk) |
| **Recovery** | Easy (restart local env) | Hard (requires Safe quorum) |

---

## References

- **Gnosis Safe Docs**: https://docs.safe.global
- **Arc Network**: https://arc.obol-arc.web.app
- **Safe UI (Mainnet)**: https://safe.arc.obol-arc.web.app
- **Safe UI (Testnet)**: https://safe.arc-testnet.obol-arc.web.app
- **Safe Transaction API**: https://safe-transactions-arc.safe.global/api/v1/docs/

---

## Changelog

| Date | Change | Who |
|------|--------|-----|
| 2026-06-29 | Initial facilities documentation | Sebastian Borjash |
| 2026-06-01 | Created mainnet Safe (0xb414...4505) | Circle + Lucilla |
