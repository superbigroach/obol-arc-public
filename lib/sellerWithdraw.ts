// Self-custody seller cash-out — everything key-related happens in the BROWSER.
// The seller's private key never leaves this function's scope / never hits Obol.
// Flow: (1) deposit their Arc USDC into the Gateway, (2) sign a burn intent (EIP-712).
// The signed intent is handed to the `relaySellerWithdraw` function, which only relays
// it to the Gateway API + submits the destination mint via Obol's minter. Reuses the
// exact Gateway-transfer rails proven for buyer withdrawals.
import { createWalletClient, createPublicClient, http, parseAbi, defineChain, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const ARC_RPC = "https://rpc.testnet.arc.network";
const arc = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [ARC_RPC] } },
});

const ARC_USDC = "0x3600000000000000000000000000000000000000";
const GATEWAY_WALLET = "0x0077777d7EBA4688BDeF3E311b846F25870A19B9";
const GATEWAY_MINTER = "0x0022222ABE238Cc2C7Bb1f21003F0a260052475B";
const ZERO = "0x0000000000000000000000000000000000000000";
const MAX_UINT256 = 2n ** 256n - 1n;

// Gateway EVM destinations (domain + native USDC). Monad/Solana handled elsewhere.
export const SELLER_WITHDRAW_CHAINS: Record<string, { domain: number; usdc: string; label: string }> = {
  base:     { domain: 6,  usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", label: "Base Sepolia" },
  ethereum: { domain: 0,  usdc: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238", label: "Ethereum Sepolia" },
  avalanche:{ domain: 1,  usdc: "0x5425890298aed601595a70AB815c96711a31Bc65", label: "Avalanche Fuji" },
  optimism: { domain: 2,  usdc: "0x5fd84259d66Cd46123540766Be93DFE6D43130D7", label: "OP Sepolia" },
  arbitrum: { domain: 3,  usdc: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d", label: "Arbitrum Sepolia" },
  polygon:  { domain: 7,  usdc: "0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582", label: "Polygon Amoy" },
  unichain: { domain: 10, usdc: "0x31d0220469e10c4E71834a79b1f276d740d3768F", label: "Unichain Sepolia" },
  arc:      { domain: 26, usdc: ARC_USDC, label: "Arc Testnet" },
};

const b32 = (a: string) => ("0x" + a.slice(2).toLowerCase().padStart(64, "0")) as Hex;
const usdc6 = (amount: string): bigint => {
  const [w, f = ""] = String(amount).split(".");
  return BigInt(w || "0") * 1_000_000n + BigInt((f + "000000").slice(0, 6) || "0");
};

const ERC20 = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address a) view returns (uint256)",
]);
const GW = parseAbi(["function deposit(address token, uint256 amount)"]);

const TYPES = {
  TransferSpec: [
    { name: "version", type: "uint32" }, { name: "sourceDomain", type: "uint32" }, { name: "destinationDomain", type: "uint32" },
    { name: "sourceContract", type: "bytes32" }, { name: "destinationContract", type: "bytes32" },
    { name: "sourceToken", type: "bytes32" }, { name: "destinationToken", type: "bytes32" },
    { name: "sourceDepositor", type: "bytes32" }, { name: "destinationRecipient", type: "bytes32" },
    { name: "sourceSigner", type: "bytes32" }, { name: "destinationCaller", type: "bytes32" },
    { name: "value", type: "uint256" }, { name: "salt", type: "bytes32" }, { name: "hookData", type: "bytes" },
  ],
  BurnIntent: [
    { name: "maxBlockHeight", type: "uint256" }, { name: "maxFee", type: "uint256" }, { name: "spec", type: "TransferSpec" },
  ],
} as const;

/** Returns the seller's raw Arc USDC balance (what they can cash out). */
export async function sellerArcBalance(address: string): Promise<number> {
  const pub = createPublicClient({ chain: arc, transport: http() });
  const bal = await pub.readContract({ address: ARC_USDC as Hex, abi: ERC20, functionName: "balanceOf", args: [address as Hex] });
  return Number(bal) / 1e6;
}

/** All client-side: deposit into Gateway + sign the burn intent. Key stays local. */
export async function buildSellerWithdraw(opts: { privateKey: string; network: string; recipient: string; amount: string }):
  Promise<{ burnIntent: unknown; signature: string }> {
  const { network, recipient, amount } = opts;
  const dest = SELLER_WITHDRAW_CHAINS[network];
  if (!dest) throw new Error(`Unsupported network "${network}"`);
  const pk = (opts.privateKey.trim().startsWith("0x") ? opts.privateKey.trim() : "0x" + opts.privateKey.trim()) as Hex;
  const account = privateKeyToAccount(pk);
  const wallet = createWalletClient({ account, chain: arc, transport: http() });
  const pub = createPublicClient({ chain: arc, transport: http() });

  const atomic = usdc6(amount);

  // 1. approve USDC → Gateway, then 2. deposit into the Gateway balance (seller pays Arc gas in USDC)
  const approveHash = await wallet.writeContract({ address: ARC_USDC as Hex, abi: ERC20, functionName: "approve", args: [GATEWAY_WALLET as Hex, atomic] });
  await pub.waitForTransactionReceipt({ hash: approveHash });
  const depositHash = await wallet.writeContract({ address: GATEWAY_WALLET as Hex, abi: GW, functionName: "deposit", args: [ARC_USDC as Hex, atomic] });
  await pub.waitForTransactionReceipt({ hash: depositHash });

  // 3. build + sign the burn intent (EIP-712) with the seller's own key
  const saltBytes = crypto.getRandomValues(new Uint8Array(32));
  const salt = ("0x" + Array.from(saltBytes).map((b) => b.toString(16).padStart(2, "0")).join("")) as Hex;
  const message = {
    maxBlockHeight: MAX_UINT256,
    maxFee: usdc6("2.01"),
    spec: {
      version: 1, sourceDomain: 26, destinationDomain: dest.domain,
      sourceContract: b32(GATEWAY_WALLET), destinationContract: b32(GATEWAY_MINTER),
      sourceToken: b32(ARC_USDC), destinationToken: b32(dest.usdc),
      sourceDepositor: b32(account.address), destinationRecipient: b32(recipient),
      sourceSigner: b32(account.address), destinationCaller: b32(ZERO),
      // Burn slightly less than deposited so there's room for the small Gateway fee
      // (deposit `atomic`, burn `atomic − 0.01`). The dust stays in the balance.
      value: atomic - usdc6("0.01"), salt, hookData: "0x" as Hex,
    },
  };
  const signature = await account.signTypedData({
    domain: { name: "GatewayWallet", version: "1" },
    types: TYPES,
    primaryType: "BurnIntent",
    message,
  });

  // Stringify bigints for JSON transport to the relay (must match what was signed).
  const burnIntent = JSON.parse(JSON.stringify(message, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
  return { burnIntent, signature };
}

// ---- Non-Gateway chains (Monad): raw CCTP burn signed by the seller ----
const CCTP_TOKEN_MESSENGER = "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA"; // CCTP V2 testnet (same on all chains)
const CCTP_DOMAINS: Record<string, number> = { monad: 15 };
const TM_ABI = parseAbi([
  "function depositForBurn(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold)",
]);

export function cctpSupported(network: string): boolean { return network in CCTP_DOMAINS; }

/** Seller signs a raw CCTP burn on Arc (approve + depositForBurn). Key stays local.
 *  Returns the burn tx hash; the relay polls IRIS + submits receiveMessage on the dest. */
export async function buildSellerCctpBurn(opts: { privateKey: string; network: string; recipient: string; amount: string }):
  Promise<{ burnTxHash: string }> {
  const { network, recipient, amount } = opts;
  const domain = CCTP_DOMAINS[network];
  if (domain === undefined) throw new Error(`CCTP cash-out not supported for "${network}"`);
  const pk = (opts.privateKey.trim().startsWith("0x") ? opts.privateKey.trim() : "0x" + opts.privateKey.trim()) as Hex;
  const account = privateKeyToAccount(pk);
  const wallet = createWalletClient({ account, chain: arc, transport: http() });
  const pub = createPublicClient({ chain: arc, transport: http() });
  const atomic = usdc6(amount);

  const approveHash = await wallet.writeContract({ address: ARC_USDC as Hex, abi: ERC20, functionName: "approve", args: [CCTP_TOKEN_MESSENGER as Hex, atomic] });
  await pub.waitForTransactionReceipt({ hash: approveHash });
  const burnHash = await wallet.writeContract({
    address: CCTP_TOKEN_MESSENGER as Hex, abi: TM_ABI, functionName: "depositForBurn",
    args: [atomic, domain, b32(recipient), ARC_USDC as Hex, b32(ZERO), usdc6("0.5"), 1000],
  });
  await pub.waitForTransactionReceipt({ hash: burnHash });
  return { burnTxHash: burnHash };
}
