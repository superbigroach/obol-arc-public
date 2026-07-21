# Monad Testnet integration — Obol multi-chain on-ramp / off-ramp

Research + integration spec for adding **Monad Testnet** to the Obol
deposit/withdraw/bridge flows in `functions/src/index.ts`.

**Do NOT blind-copy the withdrawal path from the EVM chains** — Monad is not a
Gateway chain, so its off-ramp is materially different. See §4.

---

## 0. GO / NO-GO verdict — App Kit Monad support

**GO.** `@circle-fin/app-kit@1.8.1` (the exact version installed in
`functions/node_modules`, pinned `^1.8.1` in `functions/package.json`) fully
supports Monad Testnet for `kit.bridge()`:

- `Monad_Testnet` is in the top-level `Blockchain` enum
  (`app-kit/chains.d.ts:62`), **and**
- `Monad_Testnet` is in the **`BridgeChain`** enum — the CCTPv2-bridgeable subset
  that `kit.bridge()`'s `BridgeChainIdentifier` type accepts
  (`app-kit/bridge.d.ts:932`). Being in `Blockchain` alone is *not* enough;
  membership in `BridgeChain` is the real gate, and Monad passes.
- A full runtime chain definition exists in the compiled bundle
  (`app-kit/chains.cjs`): `chainId 10143`, USDC
  `0x534b2f3A21130d7a60830c2Df862319e593943A3`, RPC
  `https://testnet-rpc.monad.xyz`, CCTP v2 `domain 15`.

So **deposits work** via the existing App Kit CCTP path with **no SDK upgrade**.

**Confirmed App Kit identifier: `Monad_Testnet`.**

---

## 1. Confirmed constants

| Field | Value | Source |
|---|---|---|
| App Kit chain id (`APPKIT_CHAIN`) | `Monad_Testnet` | app-kit `BridgeChain` enum, verified |
| Circle W3S blockchain (`CIRCLE_BLOCKCHAIN`) | `MONAD-TESTNET` | Circle W3S API (verified by requester) |
| CCTP domain | **15** | app-kit `chains.cjs` runtime def (`cctp.domain: 15`) |
| chainId | `10143` | app-kit runtime def |
| USDC (testnet) | `0x534b2f3A21130d7a60830c2Df862319e593943A3` | app-kit runtime def + Circle docs |
| RPC | `https://testnet-rpc.monad.xyz` | app-kit runtime def |
| Explorer | `https://testnet.monadscan.com/tx/{hash}` | app-kit runtime def |
| CCTP version | **v2 only** (no v1) | app-kit runtime def |
| Deposit `transferSpeed` | **STANDARD** | see §3 |
| Gateway support | **NONE** | see §4 |
| Minter SCA needed? | **NO** | see §4 |

Note: the app-kit `MonadTestnet` runtime object has **no `gateway` field** (unlike
Base/Arbitrum/etc. which carry `gateway.contracts.v1.{wallet,minter}`). This is
the SDK-level confirmation that Circle Gateway is not available on Monad.

---

## 2. Deposit (on-ramp) — WORKS as-is with the EVM pattern

Deposit is identical in shape to the other EVM chains:

1. `provisionFundingWallet` creates a Circle **SCA** on `MONAD-TESTNET` — the
   user's Monad deposit address.
2. User sends USDC to that SCA on Monad.
3. `runFundingPipeline` calls `kit.bridge()` CCTP: `from` Monad SCA →
   `to` Arc EOA (`Arc_Testnet`), then deposits the arrived USDC into the user's
   Arc Gateway balance (unchanged Arc-side logic).

The only Monad-specific requirement is `transferSpeed: "STANDARD"` (§3).

## 3. Deposit speed — MUST be STANDARD

Circle CCTP "Supported chains and domains" lists Monad as:
**Source (Standard transfer) ✅ · Source (Fast transfer) ❌ · Forwarding Service ✅.**

The app-kit runtime def shows `confirmations: 1, fastConfirmations: 1` — standard
finality is already ~1 block, so Fast Transfer offers no benefit and is **not
offered as a source**. Forcing `FAST` will error. → Add `monad` to the STANDARD
list in `runFundingPipeline` (same bucket as `polygon`/`avalanche`):

```ts
const transferSpeed = ["polygon", "avalanche", "monad"].includes(chain) ? "STANDARD" : "FAST";
```

(As a destination, Monad's forwarding/CCTP mint is fully supported, which is what
matters for the withdrawal in §4.)

## 4. Withdrawal (off-ramp) — DIFFERENT: Gateway does NOT support Monad

`withdrawObolWallet` today burns from the user's **Arc Gateway balance** and mints
on the destination via `dest.gatewayMinter` (`gatewayMint(bytes,bytes)`), gaslessly
through a per-chain minter SCA. **This path cannot work for Monad**: Monad is not a
Gateway chain — there is no Gateway Wallet / Gateway Minter contract on Monad, and
Circle's Gateway `/transfer` will not attest a burn whose `destinationDomain` is
Monad. The app-kit chain def confirms this (no `gateway` field).

### Correct alternative flow: Gateway → Arc EOA → App Kit CCTP → Monad

The user's spendable balance lives in the **Arc Gateway balance**, not in the Arc
EOA, and Gateway can only mint to Gateway-supported chains. Monad is not one, so
funds must first be pulled back onto the Arc EOA (a Gateway same-chain mint on
Arc), then bridged to Monad over plain CCTP. Two steps:

**Step A — Gateway burn (Arc) → mint to the user's Arc EOA (same-chain, Arc→Arc).**
Reuse the exact existing withdraw machinery but with `destinationDomain = ARC.domain`
and `destinationRecipient = devAddr` (the user's own Arc EOA). Arc *is* a Gateway
chain, so `gatewayMint` on Arc works. This mints native USDC into the Arc EOA.
Arc gas is USDC, submitted by the relayer fallback exactly as Arc withdrawals do
today (no minter SCA for Arc).

**Step B — App Kit CCTP bridge: Arc EOA → Monad recipient.**
```ts
await kit.bridge({
  from: { adapter, chain: "Arc_Testnet" as never, address: devAddr },
  to:   { adapter, chain: "Monad_Testnet" as never, address: recipient },
  amount: amountMinusCctpFee,
  config: { transferSpeed: "STANDARD" }, // Arc is standard-source only too
});
```
CCTP burns on Arc (domain 26) and mints on Monad (domain 15). Monad is a supported
CCTP **destination** (Forwarding Service ✅), and the Circle Wallets adapter drives
the burn + attestation + mint. Gasless on Monad via the Forwarding Service / Gas
Station; the Arc-side burn pays USDC gas from the EOA.

**Why not "direct CCTP"?** Because the balance is in Gateway custody on Arc, not in
the EOA. You cannot CCTP-burn Gateway-held funds directly; Step A (moving
Gateway→EOA on Arc) is mandatory before any CCTP burn.

### Minter SCA: NOT needed for Monad
`MINTER_WALLETS` / `MINTER_BLOCKCHAIN` exist only to submit `gatewayMint` gaslessly
on Gateway destination chains. Monad has no `gatewayMint`; its mint is handled by
the App Kit CCTP bridge in Step B. So **do not** add a Monad minter SCA. (Step A's
mint happens on Arc, which already uses the relayer fallback.)

### `bridgeChain` (any-chain ↔ any-chain) caveat
`bridgeChain` also uses the Gateway burn+`gatewayMint` path and `dest.gatewayMinter`.
It will fail for `destChain === "monad"` (and for `sourceChain === "monad"`, since
that route reads a Monad Gateway balance that doesn't exist). Either exclude Monad
from `bridgeChain`, or special-case it onto the same App Kit CCTP path as the
withdrawal. Recommend gating it out until a CCTP route is wired.

---

## 5. Ready-to-paste config additions for `index.ts`

### 5a. `CHAINS` — add `monad`
`gatewayMinter` is intentionally the zero address: Monad has no Gateway Minter and
must never be routed through the `gatewayMint` path (see §4). The `domain` (15) is
the CCTP domain, used only if/when Monad is wired into a CCTP-based bridge; the
deposit pipeline and balance UI only read `rpc` + `usdc`.

```ts
  monad: {
    domain: 15, // CCTP domain (NOT a Gateway domain — Monad has no Gateway)
    gatewayMinter: ZERO, // no Gateway Minter on Monad; never use the gatewayMint path here
    usdc: "0x534b2f3A21130d7a60830c2Df862319e593943A3",
    rpc: "https://testnet-rpc.monad.xyz",
    label: "Monad Testnet",
    explorerTx: (h) => `https://testnet.monadscan.com/tx/${h}`,
  },
```
(`ZERO` is already defined in `index.ts`. If you prefer to keep the type's
`gatewayMinter: string` non-empty for clarity, use `GW_MINTER` but add an explicit
guard so Monad never reaches `gatewayMint`.)

### 5b. `CIRCLE_BLOCKCHAIN` — add Monad (deposit SCA provisioning)
```ts
  monad: "MONAD-TESTNET",
```

### 5c. `APPKIT_CHAIN` — add Monad (App Kit CCTP identifier)
```ts
  monad: "Monad_Testnet",
```

### 5d. `MINTER_WALLETS` / `MINTER_BLOCKCHAIN` — **no entry** (see §4)

### 5e. Deposit speed bucket in `runFundingPipeline`
```ts
const transferSpeed = ["polygon", "avalanche", "monad"].includes(chain) ? "STANDARD" : "FAST";
```

### 5f. Withdrawal routing in `withdrawObolWallet` (design note — you integrate)
Add a branch: `if (network === "monad")` → run **Step A** (Gateway burn on Arc with
`destinationDomain = ARC.domain`, `destinationRecipient = devAddr`) then **Step B**
(`kit.bridge` Arc EOA → Monad recipient, `transferSpeed: "STANDARD"`). All other
`network` values keep the existing Gateway `gatewayMint` path unchanged.

---

## 6. Summary of code touch-points (for the integrator)
1. `CHAINS.monad` — add (§5a). Guard so `monad` never hits `gatewayMint`.
2. `CIRCLE_BLOCKCHAIN.monad = "MONAD-TESTNET"` (§5b).
3. `APPKIT_CHAIN.monad = "Monad_Testnet"` (§5c).
4. `runFundingPipeline` speed bucket includes `monad` → STANDARD (§5e).
5. `withdrawObolWallet` — new Monad branch: Gateway→Arc-EOA, then App Kit CCTP
   Arc→Monad (§4 / §5f).
6. `bridgeChain` — exclude Monad or reroute via CCTP (§4).
7. No `MINTER_WALLETS` entry for Monad.
