# Solana (Devnet) on-ramp integration

Adds **Solana Devnet** as a deposit chain to the Obol multi-chain on-ramp. Solana
fits the exact same shape as the EVM chains in `functions/src/index.ts`:

> per-chain Circle-managed wallet = deposit address → App Kit `kit.bridge()` CCTP
> → user's Arc EOA → deposit into the user's Arc Gateway balance.

The only differences are non-EVM specifics: EOA-only wallets, base58 addresses,
SPL/ATA balances, and Gas-Station **fee-payer** (not paymaster/SCA) gasless.

New code: `functions/src/chains/solana.ts` (self-contained, lazy imports).

---

## 1. The bridge: adapter + exact `kit.bridge()` call

**Headline finding — no new adapter is needed.** The `createCircleWalletsAdapter`
that `index.ts` already uses for every EVM chain is a **hybrid adapter that also
covers Solana**. From `@circle-fin/adapter-circle-wallets`'s own type doc
(`index.d.cts`, `createCircleWalletsAdapter`):

> "Factory function that initializes a hybrid adapter **capable of operating
> across both EVM and Solana ecosystems** using Circle Wallets infrastructure."

So you do **NOT** need `@circle-fin/adapter-solana-kit`. That package
(`createSolanaKitAdapter*`) is for `@solana/kit` **private-key** or **browser
wallet-provider** signers (e.g. `window.solana`) — the non-Circle-managed path
shown in the public "bridge between Solana and EVM" quickstart. For a
Circle-**managed** (developer-controlled) Solana wallet, the Circle Wallets
adapter signs and broadcasts the burn via the DCW SDK, exactly as on EVM.

Corroboration: Circle release note **2025.11.17** — "Added Circle Wallets adapter
to Bridge Kit" + new quickstart "Bridge USDC between Solana and EVM" and the
"Bridge with Circle Wallets" quickstart, whose `from`/`to` legs are interchangeable
between `Solana_Devnet` and an EVM chain using one Circle Wallets adapter.

**Chain identifiers** (App Kit `BridgeChain` literals, both verified present in
`@circle-fin/app-kit`'s `.d.cts`):

| Leg          | App Kit `chain`  |
| ------------ | ---------------- |
| Solana source | `"Solana_Devnet"` |
| Arc dest      | `"Arc_Testnet"`   |

**Exact call** (identical to the EVM pipeline, source chain swapped):

```ts
const { AppKit } = await import("@circle-fin/app-kit");
const { createCircleWalletsAdapter } = await import("@circle-fin/adapter-circle-wallets");

const adapter = createCircleWalletsAdapter({
  apiKey: CIRCLE_API_KEY.value(),
  entitySecret: CIRCLE_ENTITY_SECRET.value(),
});
const kit = new AppKit();

await kit.bridge({
  from: { adapter, chain: "Solana_Devnet", address: solanaAddress },
  to:   { adapter, chain: "Arc_Testnet",   address: arcEoa },
  amount,                                   // decimal USDC string
  config: { transferSpeed: "STANDARD" },    // see gap #4 on FAST
});
```

The adapter's addressing model is `developer-controlled`: the wallet used for each
leg is selected by the `address` field (Circle resolves it to the walletId), so no
`walletId` goes into the adapter constructor — same as the EVM pipeline.

Implemented as `bridgeSolanaToArc({ solanaAddress, arcEoa, amount })`.

---

## 2. Provisioning a Circle Solana wallet + reading its SPL USDC balance

**Provision (EOA, `SOLANA-DEVNET`)** — same DCW `createWallets` call as
`provisionFundingWallet`, but `accountType: "EOA"` (Solana has no SCA) and the
Solana blockchain id:

```ts
await circleClient().createWallets({
  walletSetId: WALLET_SET_ID,
  blockchains: ["SOLANA-DEVNET"],
  accountType: "EOA",
  count: 1,
  idempotencyKey: randomUUID(),
});
```

> Note on the blockchain id: Circle docs show both `SOL-DEVNET` and
> `SOLANA-DEVNET`; the DCW Node SDK examples and the verified project config use
> **`SOLANA-DEVNET`** — that is what this module uses.

Stored under the existing shape `profiles/{uid}.fundingWallets.solana` with field
names `scaWalletId` / `scaAddress` **kept only for pipeline/webhook compatibility**
(the account is an EOA, not an SCA). Implemented as `provisionSolanaWallet(uid)`.

**SPL USDC balance** — Circle manages the wallet's USDC **Associated Token Account
(ATA)** internally, so we don't touch `@solana/web3.js` or derive the ATA. Read
the already-parsed, human-readable amount via `getWalletTokenBalance`:

```ts
const { data } = await circleClient().getWalletTokenBalance({
  id: walletId,
  tokenAddresses: ["4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"], // Devnet USDC mint
  includeAll: true,
});
// data.tokenBalances[].amount is the decimal USDC balance
```

`solanaUsdcBalance(address)` resolves the walletId from the base58 address with
`listWallets({ blockchain: "SOLANA-DEVNET", address })` (never lowercase a Solana
address — base58 is case-sensitive), then reads the USDC balance.

---

## 3. Gasless: how the fee-payer covers the Solana-side burn

Circle Gas Station abstracts gas on Solana with **fee-payers** (wallets that pay
the network fee), not the EVM paymaster/SCA model. From the docs:

- "Circle's Gas Station utilizes paymasters (on EVM) and **fee-payers (on
  Solana)**." Solana natively supports Gas Station with `feePayer`, so **EOA**
  wallets can be sponsored (EVM needs an SCA to be gasless; Solana does not).
- Gas Station is available on Solana **mainnet and devnet**. Devnet fee-payer
  addresses are published (e.g. `99TfgApJDd6WSpVq5wBhbwqieoFYs4buzv8p9Uv5monw`).
- First-time USDC receipt creates an **ATA** (~0.00209 SOL / ~$0.32 rent). Gas
  Station can sponsor the ATA rent (`/wallets/gas-station/solana-ata-sponsorship`),
  or you create/fund the ATA yourself.

When the Circle Wallets adapter submits the CCTP burn on Solana, it goes through
the DCW transaction API, which routes through the Gas Station fee-payer **if a Gas
Station policy for `SOLANA-DEVNET` exists for this wallet set**. That policy is a
Console/API setup step, not code (see gap #3).

---

## 4. Deposit detection: inbound SPL USDC → Solana wallet

Same mechanism as EVM: Circle Wallets emits a signed **`transactions.inbound`**
webhook when USDC lands in a managed wallet, including on `SOLANA-DEVNET`. The
existing `functions/src/fundingWebhook.ts` already verifies the signature and
records a `fundingJobs` doc; it needs two Solana-aware tweaks (see integration
notes) because it was written for EVM addresses:

1. Add `"SOLANA-DEVNET": "solana"` to `BLOCKCHAIN_TO_CHAIN`.
2. `addressVariants()` lowercases and EIP-55-checksums the address — both are
   EVM-only and **corrupt** a base58 Solana address. For Solana, match the exact
   address string only.

The scheduled `advanceFundingJobs` processor then completes the deposit
hands-free, the same as for EVM chains.

---

## 5. Integration notes for `index.ts` (do NOT need to touch this module)

`index.ts` is intentionally not edited here. To expose `"solana"` as a deposit
chain, wire the new module in at these four points:

1. **Provision endpoint** — in `provisionFundingWallet`, special-case
   `chain === "solana"` to call `provisionSolanaWallet(uid)` instead of the EVM
   `createWallets({ accountType: "SCA" })` path (Solana is EOA-only, so the
   generic EVM branch would fail). Ensure the callable lists the Circle secrets
   (it already does).

2. **Pipeline** — in `runFundingPipeline`, branch when `chain === "solana"`:
   - balance: `await solanaUsdcBalance(fw.scaAddress)` (replaces the ethers
     `usdc.balanceOf` read — there is no EVM RPC for Solana);
   - bridge: `await bridgeSolanaToArc({ solanaAddress: fw.scaAddress, arcEoa,
     amount: bridgeAmount })` (replaces the EVM `kit.bridge` block);
   - **Arc-side deposit is unchanged** — steps 3's approve + `deposit(address,
     uint256)` into the Arc Gateway wallet is pure Arc/EVM logic and is reused
     verbatim once the USDC arrives on the Arc EOA.
   Keep the `< 0.5` USDC "waiting" guard and the ~0.1 USDC dust buffer.

3. **Guards / maps** — the `processFundingDeposit` callable and any UI chain list
   gate on `CHAINS[chain] && APPKIT_CHAIN[chain]`. Add a `"solana"` entry (label
   "Solana Devnet", `explorerTx: h => \`https://solscan.io/tx/${h}?cluster=devnet\``)
   or relax the guard to also accept `"solana"`. Solana has no EVM `usdc`/`rpc`/
   `domain`, so if you extend `CHAINS`, make those fields optional or keep Solana
   in a separate small map — the module already exports `SOLANA_*` constants.

4. **Webhook** — apply the two `fundingWebhook.ts` tweaks from §4.

Secrets: every caller must keep `secrets: [CIRCLE_TESTNET_API_KEY,
CIRCLE_ENTITY_SECRET, ...]` — `solana.ts` re-declares those same-named secrets
(idempotent) and reads them via `.value()`.

---

## 6. Honest gaps / risks

1. **Fast Transfer on Solana↔Arc devnet is unconfirmed.** The module defaults to
   `transferSpeed: "STANDARD"` (the same defensive choice `index.ts` makes for
   Polygon/Avalanche, where forcing FAST errors). Confirm FAST support before
   flipping it; STANDARD is slower but reliable.

2. **`getWalletTokenBalance` shape.** The USDC row is matched by SPL mint address
   first, then by `symbol === "USDC"`. If Circle returns a different token-object
   shape on Solana, adjust the matcher. Balance is `0` until the ATA exists / USDC
   arrives.

3. **Gas Station policy is a prerequisite, not code.** Truly gasless Solana burns
   require a `SOLANA-DEVNET` Gas Station **policy** configured in the Circle
   Console for the wallet set, plus ATA-rent sponsorship (or a small SOL balance
   in the EOA for the first inbound USDC). Without it, the bridge burn will fail
   for lack of SOL. This is the single most likely operational blocker.

4. **Webhook base58 handling.** Until the `fundingWebhook.ts` tweaks in §4 land,
   Solana deposits will not auto-route (the EIP-55/lowercase variants never match
   a base58 address). The polled `processFundingDeposit` path still works.

5. **Bridge is not amount-verified end-to-end here.** The App Kit Solana→Arc route
   is confirmed *supported and typed*, and the call compiles against the installed
   SDKs, but a live devnet round-trip (deposit → bridge → Arc credit) has not been
   executed in this task. Everything upstream (adapter capability, chain ids,
   provisioning, balance read) is verified against installed types + Circle docs.
