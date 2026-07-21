"use client";

// MetaMask / browser-wallet helpers using ethers v6 BrowserProvider.
// All exports are browser-only — only call inside useEffect / event handlers
// on pages that already have "use client". Never import at SSR module-scope.

import { BrowserProvider, Contract, parseUnits } from "ethers";

// ─── Chain metadata ────────────────────────────────────────────────────────

/** Full MetaMask chain descriptor for each supported network. */
export const CHAIN_META: Record<string, {
  chainId: string;
  chainName: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  rpcUrls: string[];
  blockExplorerUrls: string[];
}> = {
  arc:        { chainId: "0x4CEF52",  chainName: "Arc Testnet",          nativeCurrency: { name: "USDC",  symbol: "USDC",  decimals: 18 }, rpcUrls: ["https://rpc.testnet.arc.network"],                   blockExplorerUrls: ["https://testnet.arcscan.app"]                        },
  base:       { chainId: "0x14A34",   chainName: "Base Sepolia",          nativeCurrency: { name: "Ether", symbol: "ETH",   decimals: 18 }, rpcUrls: ["https://sepolia.base.org"],                         blockExplorerUrls: ["https://sepolia.basescan.org"]                       },
  ethereum:   { chainId: "0xAA36A7",  chainName: "Ethereum Sepolia",      nativeCurrency: { name: "Ether", symbol: "ETH",   decimals: 18 }, rpcUrls: ["https://ethereum-sepolia-rpc.publicnode.com"],      blockExplorerUrls: ["https://sepolia.etherscan.io"]                       },
  avalanche:  { chainId: "0xA869",    chainName: "Avalanche Fuji",        nativeCurrency: { name: "AVAX",  symbol: "AVAX",  decimals: 18 }, rpcUrls: ["https://api.avax-test.network/ext/bc/C/rpc"],       blockExplorerUrls: ["https://testnet.snowscan.xyz"]                       },
  optimism:   { chainId: "0xAA37DC",  chainName: "OP Sepolia",            nativeCurrency: { name: "Ether", symbol: "ETH",   decimals: 18 }, rpcUrls: ["https://sepolia.optimism.io"],                     blockExplorerUrls: ["https://sepolia-optimism.etherscan.io"]              },
  arbitrum:   { chainId: "0x66EEE",   chainName: "Arbitrum Sepolia",      nativeCurrency: { name: "Ether", symbol: "ETH",   decimals: 18 }, rpcUrls: ["https://sepolia-rollup.arbitrum.io/rpc"],          blockExplorerUrls: ["https://sepolia.arbiscan.io"]                        },
  polygon:    { chainId: "0x13882",   chainName: "Polygon Amoy",          nativeCurrency: { name: "MATIC", symbol: "MATIC", decimals: 18 }, rpcUrls: ["https://rpc-amoy.polygon.technology"],             blockExplorerUrls: ["https://amoy.polygonscan.com"]                       },
  unichain:   { chainId: "0x515",     chainName: "Unichain Sepolia",      nativeCurrency: { name: "Ether", symbol: "ETH",   decimals: 18 }, rpcUrls: ["https://sepolia.unichain.org"],                    blockExplorerUrls: ["https://unichain-sepolia.blockscout.com"]            },
  sonic:      { chainId: "0xDEDE",    chainName: "Sonic Testnet",         nativeCurrency: { name: "Sonic", symbol: "S",     decimals: 18 }, rpcUrls: ["https://rpc.testnet.soniclabs.com"],               blockExplorerUrls: ["https://testnet.soniclabs.com"]                      },
  worldchain: { chainId: "0x12C1",    chainName: "World Chain Sepolia",   nativeCurrency: { name: "Ether", symbol: "ETH",   decimals: 18 }, rpcUrls: ["https://worldchain-sepolia.g.alchemy.com/public"], blockExplorerUrls: ["https://worldchain-sepolia.explorer.alchemy.com"]   },
  sei:        { chainId: "0x530",     chainName: "Sei Atlantic",          nativeCurrency: { name: "SEI",   symbol: "SEI",   decimals: 18 }, rpcUrls: ["https://evm-rpc-testnet.sei-apis.com"],            blockExplorerUrls: ["https://testnet.seitrace.com"]                       },
  hyperevm:   { chainId: "0x3E6",     chainName: "HyperEVM Testnet",      nativeCurrency: { name: "Ether", symbol: "ETH",   decimals: 18 }, rpcUrls: ["https://rpc.hyperliquid-testnet.xyz/evm"],         blockExplorerUrls: ["https://app.hyperliquid-testnet.xyz"]                },
};

/** Chain ID hex strings by key. */
export const CHAIN_IDS: Record<string, string> = Object.fromEntries(
  Object.entries(CHAIN_META).map(([k, v]) => [k, v.chainId]),
);

/** USDC token addresses by chain key (testnet). Chains without a confirmed
 *  address are omitted — balance checks and on-chain sends are disabled for them. */
export const USDC_ADDRESSES: Record<string, string> = {
  arc:       "0x3600000000000000000000000000000000000000",
  base:      "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  ethereum:  "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
  avalanche: "0x5425890298aed601595a70AB815c96711a31Bc65",
  optimism:  "0x5fd84259d66Cd46123540766Be93DFE6D43130D",
  arbitrum:  "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
  polygon:   "0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582",
  unichain:  "0x31d0220469e10c4E71834a79b1f276d740d3768F",
  // sonic / worldchain / sei / hyperevm: USDC address unknown — excluded
};

/** Circle Gateway Wallet address (same on all testnets). */
export const GATEWAY_WALLET = "0x0077777d7EBA4688BDeF3E311b846F25870A19B9";

// ─── ABIs ─────────────────────────────────────────────────────────────────

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function transfer(address to, uint256 amount) returns (bool)",
];

const GATEWAY_ABI = [
  // Gateway credits msg.sender — token + amount only
  "function deposit(address token, uint256 amount)",
  // Alternative form (credits explicit account)
  "function depositFor(address account, address token, uint256 amount)",
];

// ─── Internal helper ──────────────────────────────────────────────────────

type EthProvider = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, handler: (...args: unknown[]) => void): void;
  removeListener?(event: string, handler: (...args: unknown[]) => void): void;
};

function getEthereum(): EthProvider | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { ethereum?: EthProvider }).ethereum;
}

// ─── Public API ───────────────────────────────────────────────────────────

/** Returns true when MetaMask (or compatible injected wallet) is present. */
export function hasMetaMask(): boolean {
  return !!getEthereum();
}

/** Request wallet access; returns the connected address (lowercased). */
export async function connectWallet(): Promise<string> {
  const eth = getEthereum();
  if (!eth) throw new Error("MetaMask not installed. Install it at metamask.io.");
  const provider = new BrowserProvider(eth as never);
  const accounts = (await provider.send("eth_requestAccounts", [])) as string[];
  if (!accounts[0]) throw new Error("No account selected.");
  return accounts[0].toLowerCase();
}

/** Returns the currently connected address without prompting, or null. */
export async function getConnectedAccount(): Promise<string | null> {
  const eth = getEthereum();
  if (!eth) return null;
  try {
    const provider = new BrowserProvider(eth as never);
    const accounts = (await provider.send("eth_accounts", [])) as string[];
    return accounts[0]?.toLowerCase() ?? null;
  } catch { return null; }
}

/** Switch MetaMask to the given chain key; adds the chain to MetaMask if needed. */
export async function switchToChain(chainKey: string): Promise<void> {
  const eth = getEthereum();
  if (!eth) throw new Error("MetaMask not installed.");
  const meta = CHAIN_META[chainKey];
  if (!meta) throw new Error(`Unknown chain: ${chainKey}`);
  try {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: meta.chainId }] });
  } catch (e: unknown) {
    if ((e as { code?: number }).code === 4902) {
      // Chain not added yet — add it
      await eth.request({ method: "wallet_addEthereumChain", params: [meta] });
    } else {
      throw e;
    }
  }
}

/** Approve + deposit USDC from the user's wallet into the Circle Gateway.
 *  Sends two MetaMask confirmations: approve then deposit.
 *  Returns the deposit transaction hash. */
export async function depositToGateway(chainKey: string, amount: string): Promise<string> {
  const eth = getEthereum();
  if (!eth) throw new Error("MetaMask not installed.");
  await switchToChain(chainKey);
  const provider = new BrowserProvider(eth as never);
  const signer = await provider.getSigner();
  const usdcAddr = USDC_ADDRESSES[chainKey];
  if (!usdcAddr) throw new Error(`No USDC address known for ${chainKey}`);
  const usdc = new Contract(usdcAddr, ERC20_ABI, signer);
  const gateway = new Contract(GATEWAY_WALLET, GATEWAY_ABI, signer);
  const parsed = parseUnits(amount, 6);

  // Step 1 — approve
  const approveTx = await usdc.approve(GATEWAY_WALLET, parsed) as { wait(): Promise<unknown>; hash: string };
  await approveTx.wait();

  // Step 2 — deposit (Gateway credits msg.sender)
  const depositTx = await (gateway["deposit(address,uint256)"](usdcAddr, parsed)) as { wait(): Promise<unknown>; hash: string };
  await depositTx.wait();
  return depositTx.hash;
}

/** Send USDC on the given chain from the user's connected wallet to `to`.
 *  Returns the transaction hash. */
export async function sendUsdc(chainKey: string, to: string, amount: string): Promise<string> {
  const eth = getEthereum();
  if (!eth) throw new Error("MetaMask not installed.");
  await switchToChain(chainKey);
  const provider = new BrowserProvider(eth as never);
  const signer = await provider.getSigner();
  const usdcAddr = USDC_ADDRESSES[chainKey];
  if (!usdcAddr) throw new Error(`No USDC address known for ${chainKey}`);
  const usdc = new Contract(usdcAddr, ERC20_ABI, signer);
  const parsed = parseUnits(amount, 6);
  const tx = await usdc.transfer(to, parsed) as { wait(): Promise<unknown>; hash: string };
  await tx.wait();
  return tx.hash;
}
