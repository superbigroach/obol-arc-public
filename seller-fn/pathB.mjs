// ============================================================
// Path B — gasless MULTI-CHAIN FUNDING via Circle SCA + Gas Station.
//
// Corrected design (verified against Circle's signature rules + a live prototype):
//   • x402 nanopayment PAYMENT requires an EOA depositor/signer (EIP-3009: `from`
//     must sign; Gateway rejects SCA/ERC-1271 sigs). So paying stays EOA + Arc.
//   • But FUNDING can be gasless on any chain: a Circle SCA deposits USDC on
//     chain X gaslessly (Gas Station sponsors), then a Gateway TRANSFER (burn
//     intent) — which DOES support an EOA delegate as `sourceSigner` — moves that
//     balance to the user's Arc EOA, where they pay x402 gaslessly.
//
// Flow per user, per non-Arc chain X:
//   1. provisionScaWallet(X)                 → SCA holder (gasless via Gas Station)
//   2. addDelegate(sca, X, EOA)              → authorize the user's EOA to sign spends
//   3. gaslessDeposit(sca, X, amount)        → approve + deposit, gas sponsored
//   4. transferToArc(...)  [NEEDS LIVE TEST] → EOA-delegate-signed burn intent → Arc
//
// STATUS: steps 1-3 use mechanisms proven live (SCA provisioning + a gasless
// Gas-Station tx on Base Sepolia confirmed). Step 4 (delegate-signed cross-chain
// transfer) is modeled but UNVERIFIED — it needs a faucet-funded SCA to run.
// Gate the whole path behind OBOL_PATH_B=1; it is OFF by default.
//
// Requires: CIRCLE_TESTNET_API_KEY, CIRCLE_ENTITY_SECRET.
// ============================================================
import { randomUUID } from "node:crypto";

const WALLET_SET_ID = process.env.OBOL_WALLET_SET_ID || "fd87738b-24f2-513e-8be1-5c0a968bac41";
const GATEWAY_WALLET = "0x0077777d7EBA4688BDeF3E311b846F25870A19B9"; // same on every EVM testnet

// Supported non-Arc funding chains (Gas-Station gasless EVM set ∩ Gateway nanopayments).
export const FUNDING_CHAINS = {
  base:      { blockchain: "BASE-SEPOLIA", domain: 6,  usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" },
  arbitrum:  { blockchain: "ARB-SEPOLIA",  domain: 3,  usdc: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d" },
  optimism:  { blockchain: "OP-SEPOLIA",   domain: 2,  usdc: "0x5fd84259d66Cd46123540766Be93DFE6D43130D7" },
  polygon:   { blockchain: "MATIC-AMOY",   domain: 7,  usdc: "0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582" },
  avalanche: { blockchain: "AVAX-FUJI",    domain: 1,  usdc: "0x5425890298aed601595a70AB815c96711a31Bc65" },
  ethereum:  { blockchain: "ETH-SEPOLIA",  domain: 0,  usdc: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238" },
  unichain:  { blockchain: "UNI-SEPOLIA",  domain: 10, usdc: "0x31d0220469e10c4E71834a79b1f276d740d3768F" },
};

let _client = null;
async function circle() {
  const apiKey = process.env.CIRCLE_TESTNET_API_KEY || process.env.CIRCLE_API_KEY;
  const entitySecret = process.env.CIRCLE_ENTITY_SECRET;
  if (!apiKey || !entitySecret) throw new Error("Path B not configured (CIRCLE_TESTNET_API_KEY / CIRCLE_ENTITY_SECRET).");
  if (!_client) {
    const { initiateDeveloperControlledWalletsClient } = await import("@circle-fin/developer-controlled-wallets");
    _client = initiateDeveloperControlledWalletsClient({ apiKey, entitySecret });
  }
  return _client;
}

async function waitTx(c, txId, label) {
  for (let i = 0; i < 40; i++) {
    const r = await c.getTransaction({ id: txId });
    const st = r?.data?.transaction?.state;
    if (["COMPLETE", "CONFIRMED"].includes(st)) return r.data.transaction;
    if (["FAILED", "DENIED", "CANCELLED"].includes(st)) throw new Error(`${label} ${st}`);
    await new Promise((res) => setTimeout(res, 3000));
  }
  throw new Error(`${label} timed out`);
}

// ── Step 1: provision an SCA holder wallet on a funding chain ──────────────────
// PROVEN: an SCA on Base Sepolia executed a gasless Gas-Station tx (CONFIRMED).
export async function provisionScaWallet(chainKey, refId) {
  const cfg = FUNDING_CHAINS[chainKey];
  if (!cfg) throw new Error(`Unsupported funding chain: ${chainKey}`);
  const c = await circle();
  const r = await c.createWallets({
    walletSetId: WALLET_SET_ID, blockchains: [cfg.blockchain], accountType: "SCA", count: 1,
    metadata: refId ? [{ refId }] : undefined, idempotencyKey: randomUUID(),
  });
  const w = r?.data?.wallets?.[0];
  if (!w?.id) throw new Error("SCA provisioning returned no wallet");
  return { walletId: w.id, address: w.address, chain: chainKey };
}

// ── Step 2: authorize the user's EOA to sign spends of the SCA's balance ───────
// Gateway rejects SCA sigs, so an EOA delegate signs on the SCA's behalf. Gasless
// via Gas Station (contract call from the SCA). Must be done per funding chain.
export async function addDelegate(scaWalletId, chainKey, delegateEoaAddress) {
  const cfg = FUNDING_CHAINS[chainKey];
  const c = await circle();
  const tx = await c.createContractExecutionTransaction({
    walletId: scaWalletId, blockchain: cfg.blockchain, contractAddress: GATEWAY_WALLET,
    abiFunctionSignature: "addDelegate(address,address)", abiParameters: [cfg.usdc, delegateEoaAddress],
    idempotencyKey: randomUUID(), fee: { type: "level", config: { feeLevel: "MEDIUM" } },
  });
  return waitTx(c, tx?.data?.id, `addDelegate(${chainKey})`);
}

// ── Step 3: gasless deposit of USDC into the SCA's Gateway balance ─────────────
// PROVEN mechanism: the approve() half ran gaslessly from an SCA (Gas Station).
export async function gaslessDeposit(scaWalletId, chainKey, amountUsdc) {
  const cfg = FUNDING_CHAINS[chainKey];
  const c = await circle();
  const atomic = BigInt(Math.round(parseFloat(amountUsdc) * 1e6)).toString();
  const approve = await c.createContractExecutionTransaction({
    walletId: scaWalletId, blockchain: cfg.blockchain, contractAddress: cfg.usdc,
    abiFunctionSignature: "approve(address,uint256)", abiParameters: [GATEWAY_WALLET, atomic],
    idempotencyKey: randomUUID(), fee: { type: "level", config: { feeLevel: "MEDIUM" } },
  });
  await waitTx(c, approve?.data?.id, `approve(${chainKey})`);
  const deposit = await c.createContractExecutionTransaction({
    walletId: scaWalletId, blockchain: cfg.blockchain, contractAddress: GATEWAY_WALLET,
    abiFunctionSignature: "deposit(address,uint256)", abiParameters: [cfg.usdc, atomic],
    idempotencyKey: randomUUID(), fee: { type: "level", config: { feeLevel: "MEDIUM" } },
  });
  await waitTx(c, deposit?.data?.id, `deposit(${chainKey})`);
  return { approveTx: approve?.data?.id, depositTx: deposit?.data?.id };
}

// ── Step 4: move the SCA's chain-X balance to the user's Arc EOA balance ───────
// UNVERIFIED — needs a faucet-funded SCA to test. The user's EOA (registered as a
// delegate in step 2) signs a Gateway burn intent whose sourceDepositor = the SCA
// and sourceSigner = the EOA delegate, sourceDomain = X, destinationDomain = Arc.
// Model after functions/src/index.ts bridgeChain / withdrawObolWallet (which already
// sign burn intents), but with the delegate (from != signer) shape. Then the user
// pays x402 on Arc from the moved balance via the existing EOA path (dcwPay.mjs).
export async function transferToArc({ delegateWalletId, delegateAddress, scaAddress, arcRecipient, chainKey, amountUsdc, relayerPrivateKey }) {
  const cfg = FUNDING_CHAINS[chainKey];
  const { getAddress, pad, createWalletClient, createPublicClient, http } = await import("viem");
  const { arcTestnet } = await import("viem/chains");
  const { privateKeyToAccount } = await import("viem/accounts");
  const { randomBytes } = await import("node:crypto");
  const c = await circle();

  const ARC = { domain: 26, usdc: "0x3600000000000000000000000000000000000000", minter: "0x0022222ABE238Cc2C7Bb1f21003F0a260052475B" };
  const ZERO = "0x0000000000000000000000000000000000000000";
  const b32 = (a) => pad(getAddress(a).toLowerCase(), { size: 32 });
  const atomic = BigInt(Math.round(parseFloat(amountUsdc) * 1e6));
  const MAX_UINT256 = (1n << 256n) - 1n;
  const big = (_k, v) => (typeof v === "bigint" ? v.toString() : v);

  // Burn intent: SCA is the depositor (holds the balance); the registered EOA
  // delegate is the sourceSigner. Gateway's BurnIntent domain has no chainId, so
  // the delegate can sign a source-chain burn without a cross-chain signing issue.
  const burnIntent = {
    maxBlockHeight: MAX_UINT256, maxFee: 2010000n,
    spec: {
      version: 1, sourceDomain: cfg.domain, destinationDomain: ARC.domain,
      sourceContract: b32(GATEWAY_WALLET), destinationContract: b32(ARC.minter),
      sourceToken: b32(cfg.usdc), destinationToken: b32(ARC.usdc),
      sourceDepositor: b32(scaAddress), destinationRecipient: b32(arcRecipient),
      sourceSigner: b32(delegateAddress), destinationCaller: b32(ZERO),
      value: atomic, salt: `0x${randomBytes(32).toString("hex")}`, hookData: "0x",
    },
  };
  const typedData = {
    domain: { name: "GatewayWallet", version: "1" },
    types: {
      EIP712Domain: [{ name: "name", type: "string" }, { name: "version", type: "string" }],
      TransferSpec: [
        { name: "version", type: "uint32" }, { name: "sourceDomain", type: "uint32" }, { name: "destinationDomain", type: "uint32" },
        { name: "sourceContract", type: "bytes32" }, { name: "destinationContract", type: "bytes32" },
        { name: "sourceToken", type: "bytes32" }, { name: "destinationToken", type: "bytes32" },
        { name: "sourceDepositor", type: "bytes32" }, { name: "destinationRecipient", type: "bytes32" },
        { name: "sourceSigner", type: "bytes32" }, { name: "destinationCaller", type: "bytes32" },
        { name: "value", type: "uint256" }, { name: "salt", type: "bytes32" }, { name: "hookData", type: "bytes" },
      ],
      BurnIntent: [{ name: "maxBlockHeight", type: "uint256" }, { name: "maxFee", type: "uint256" }, { name: "spec", type: "TransferSpec" }],
    },
    primaryType: "BurnIntent", message: burnIntent,
  };

  // The delegate EOA signs (via Circle) — Gateway accepts its ECDSA sig for the SCA.
  const sig = (await c.signTypedData({ walletId: delegateWalletId, data: JSON.stringify(typedData, big) }))?.data?.signature;
  if (!sig) throw new Error("delegate signTypedData returned no signature");

  const resp = await fetch("https://gateway-api-testnet.circle.com/v1/transfer", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify([{ burnIntent, signature: sig }], big),
  });
  const result = await resp.json();
  if (!result?.attestation || !result?.signature) throw new Error("Gateway transfer failed: " + JSON.stringify(result).slice(0, 240));

  // Mint on Arc (relayer submits; Arc gas is USDC so the relayer's USDC covers it).
  const relayer = privateKeyToAccount(relayerPrivateKey.startsWith("0x") ? relayerPrivateKey : "0x" + relayerPrivateKey);
  const wc = createWalletClient({ account: relayer, chain: arcTestnet, transport: http() });
  const pc = createPublicClient({ chain: arcTestnet, transport: http() });
  const hash = await wc.writeContract({
    address: ARC.minter, abi: [{ type: "function", name: "gatewayMint", stateMutability: "nonpayable", inputs: [{ name: "attestation", type: "bytes" }, { name: "signature", type: "bytes" }], outputs: [] }],
    functionName: "gatewayMint", args: [result.attestation, result.signature],
  });
  await pc.waitForTransactionReceipt({ hash });
  return { mintTx: hash, arcRecipient };
}
