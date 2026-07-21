// ============================================================================
// NETWORK CONFIG — single source of truth for testnet vs mainnet.
// Flip with the env var OBOL_NETWORK=mainnet (default: testnet). Everything
// network-specific (chain names, USDC addresses, RPCs, Gateway API, minter
// wallets, the Circle API key secret) resolves from here, so going live is a
// one-line change + funding, not a scramble across 50 hardcoded values.
//
// CCTP domains are identical on testnet & mainnet (per-chain, not per-env), so
// they're shared. Gateway Wallet/Minter contract addresses are ALSO the same on
// every chain and env (0x0077.. / 0x0022..).
// ============================================================================
import { SOLANA_USDC_MINT } from "./chains/solana";

export const NETWORK: "testnet" | "mainnet" = process.env.OBOL_NETWORK === "mainnet" ? "mainnet" : "testnet";
export const IS_MAINNET = NETWORK === "mainnet";

// Gateway Wallet + Minter — same address on every chain and environment.
export const GATEWAY_WALLET = "0x0077777d7EBA4688BDeF3E311b846F25870A19B9";
export const GATEWAY_MINTER = "0x0022222ABE238Cc2C7Bb1f21003F0a260052475B";
const ZERO = "0x0000000000000000000000000000000000000000";

type ChainCfg = { domain: number; gatewayMinter: string; usdc: string; rpc: string; label: string; explorerTx: (h: string) => string };

// ---- TESTNET ---------------------------------------------------------------
const TESTNET = {
  circleApiKeySecret: "CIRCLE_TESTNET_API_KEY",
  gatewayApi: "https://gateway-api-testnet.circle.com/v1",
  provisionBlockchain: "ARC-TESTNET",     // where each user's agent wallet is provisioned
  gatewayClientChain: "arcTestnet",       // @circle-fin/x402-batching chain name
  arcRpc: "https://rpc.testnet.arc.network",
  arcUsdc: "0x3600000000000000000000000000000000000000",
  chains: {
    arc:       { domain: 26, gatewayMinter: GATEWAY_MINTER, usdc: "0x3600000000000000000000000000000000000000", rpc: "https://rpc.testnet.arc.network", label: "Arc Testnet", explorerTx: (h: string) => `https://testnet.arcscan.app/tx/${h}` },
    base:      { domain: 6,  gatewayMinter: GATEWAY_MINTER, usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", rpc: "https://sepolia.base.org", label: "Base Sepolia", explorerTx: (h: string) => `https://sepolia.basescan.org/tx/${h}` },
    ethereum:  { domain: 0,  gatewayMinter: GATEWAY_MINTER, usdc: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238", rpc: "https://ethereum-sepolia-rpc.publicnode.com", label: "Ethereum Sepolia", explorerTx: (h: string) => `https://sepolia.etherscan.io/tx/${h}` },
    avalanche: { domain: 1,  gatewayMinter: GATEWAY_MINTER, usdc: "0x5425890298aed601595a70AB815c96711a31Bc65", rpc: "https://api.avax-test.network/ext/bc/C/rpc", label: "Avalanche Fuji", explorerTx: (h: string) => `https://testnet.snowscan.xyz/tx/${h}` },
    optimism:  { domain: 2,  gatewayMinter: GATEWAY_MINTER, usdc: "0x5fd84259d66Cd46123540766Be93DFE6D43130D7", rpc: "https://sepolia.optimism.io", label: "OP Sepolia", explorerTx: (h: string) => `https://sepolia-optimism.etherscan.io/tx/${h}` },
    arbitrum:  { domain: 3,  gatewayMinter: GATEWAY_MINTER, usdc: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d", rpc: "https://sepolia-rollup.arbitrum.io/rpc", label: "Arbitrum Sepolia", explorerTx: (h: string) => `https://sepolia.arbiscan.io/tx/${h}` },
    polygon:   { domain: 7,  gatewayMinter: GATEWAY_MINTER, usdc: "0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582", rpc: "https://rpc-amoy.polygon.technology", label: "Polygon Amoy", explorerTx: (h: string) => `https://amoy.polygonscan.com/tx/${h}` },
    unichain:  { domain: 10, gatewayMinter: GATEWAY_MINTER, usdc: "0x31d0220469e10c4E71834a79b1f276d740d3768F", rpc: "https://sepolia.unichain.org", label: "Unichain Sepolia", explorerTx: (h: string) => `https://unichain-sepolia.blockscout.com/tx/${h}` },
    monad:     { domain: 15, gatewayMinter: ZERO, usdc: "0x534b2f3A21130d7a60830c2Df862319e593943A3", rpc: "https://testnet-rpc.monad.xyz", label: "Monad Testnet", explorerTx: (h: string) => `https://testnet.monadexplorer.com/tx/${h}` },
    solana:    { domain: 5,  gatewayMinter: ZERO, usdc: SOLANA_USDC_MINT, rpc: "", label: "Solana Devnet", explorerTx: (h: string) => `https://explorer.solana.com/tx/${h}?cluster=devnet` },
  } as Record<string, ChainCfg>,
  // Obol-owned Gas-Station minter wallets (Circle wallet IDs) per chain.
  minterWallets: {
    arc: "8e233ad4-9cb2-5612-b1cb-7bb115b1c953",
    base: "b5424071-d307-589a-8db1-366bb73edbce", arbitrum: "6fdf9944-3764-519f-99f4-b2d8fd51866e",
    optimism: "f9079e21-6a74-55c1-9d1c-4c7e40c2bcbb", polygon: "243b59a4-9e4c-55ef-9793-b5009812b792",
    avalanche: "72793d5c-9da9-5ce1-9aa3-0c7479255fda", ethereum: "c56357d6-63b1-5e87-b4e2-a2b4fbd2a1b9",
    unichain: "0db249c9-e96e-5fa5-a4a1-58fac28e6fbd",
  } as Record<string, string>,
  minterBlockchain: {
    arc: "ARC-TESTNET", base: "BASE-SEPOLIA", arbitrum: "ARB-SEPOLIA", optimism: "OP-SEPOLIA",
    polygon: "MATIC-AMOY", avalanche: "AVAX-FUJI", ethereum: "ETH-SEPOLIA", unichain: "UNI-SEPOLIA",
  } as Record<string, string>,
  nonGatewayMinters: {
    monad: { walletId: "4558b025-e5af-53d2-8892-7249a581b621", address: "0xadc23286c14ccfd7ef12939f3aad3351c310ee19", blockchain: "MONAD-TESTNET", appkitChain: "Monad_Testnet" },
    solana: { walletId: "8c53923a-eb8d-598a-9195-0c1139181fcd", address: "HdztrKJrFmA3sxstQ6e5hSMbBiBAmZbZaQ9RiNAdFm9N", blockchain: "SOL-DEVNET", appkitChain: "Solana_Devnet" },
  } as Record<string, { walletId: string; address: string; blockchain: string; appkitChain: string }>,
};

// ---- MAINNET ---------------------------------------------------------------
// USDC addresses + RPCs are the canonical mainnet values. Gateway contracts are
// the same as testnet. ⚠️ TODO before go-live: (1) create the CIRCLE_MAINNET_API_KEY
// secret (live Circle key); (2) provision mainnet minter wallets + fill their IDs;
// (3) confirm Arc mainnet USDC/RPC (Arc mainnet may not be GA — until then, anchor
// on Base by setting provisionBlockchain="BASE").
const MAINNET = {
  circleApiKeySecret: "CIRCLE_MAINNET_API_KEY",
  gatewayApi: "https://gateway-api.circle.com/v1",
  provisionBlockchain: "BASE",             // Base = most liquid + where the Bazaar lives; switch to "ARC" if/when Arc mainnet is GA
  gatewayClientChain: "base",
  arcRpc: "https://rpc.arc.network",        // ⚠️ confirm Arc mainnet RPC
  arcUsdc: "0x3600000000000000000000000000000000000000", // ⚠️ confirm Arc mainnet USDC
  chains: {
    arc:       { domain: 26, gatewayMinter: GATEWAY_MINTER, usdc: "0x3600000000000000000000000000000000000000", rpc: "https://rpc.arc.network", label: "Arc", explorerTx: (h: string) => `https://arcscan.app/tx/${h}` }, // ⚠️ confirm Arc mainnet
    base:      { domain: 6,  gatewayMinter: GATEWAY_MINTER, usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", rpc: "https://mainnet.base.org", label: "Base", explorerTx: (h: string) => `https://basescan.org/tx/${h}` },
    ethereum:  { domain: 0,  gatewayMinter: GATEWAY_MINTER, usdc: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", rpc: "https://ethereum-rpc.publicnode.com", label: "Ethereum", explorerTx: (h: string) => `https://etherscan.io/tx/${h}` },
    avalanche: { domain: 1,  gatewayMinter: GATEWAY_MINTER, usdc: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E", rpc: "https://api.avax.network/ext/bc/C/rpc", label: "Avalanche", explorerTx: (h: string) => `https://snowscan.xyz/tx/${h}` },
    optimism:  { domain: 2,  gatewayMinter: GATEWAY_MINTER, usdc: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", rpc: "https://mainnet.optimism.io", label: "OP Mainnet", explorerTx: (h: string) => `https://optimistic.etherscan.io/tx/${h}` },
    arbitrum:  { domain: 3,  gatewayMinter: GATEWAY_MINTER, usdc: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", rpc: "https://arb1.arbitrum.io/rpc", label: "Arbitrum One", explorerTx: (h: string) => `https://arbiscan.io/tx/${h}` },
    polygon:   { domain: 7,  gatewayMinter: GATEWAY_MINTER, usdc: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", rpc: "https://polygon-rpc.com", label: "Polygon", explorerTx: (h: string) => `https://polygonscan.com/tx/${h}` },
    unichain:  { domain: 10, gatewayMinter: GATEWAY_MINTER, usdc: "0x078D782b760474a361dDA0AF3839290b0EF57AD6", rpc: "https://mainnet.unichain.org", label: "Unichain", explorerTx: (h: string) => `https://unichain.blockscout.com/tx/${h}` },
    monad:     { domain: 15, gatewayMinter: ZERO, usdc: "", rpc: "", label: "Monad", explorerTx: (h: string) => `https://monadexplorer.com/tx/${h}` }, // ⚠️ Monad mainnet USDC when live
    solana:    { domain: 5,  gatewayMinter: ZERO, usdc: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", rpc: "", label: "Solana", explorerTx: (h: string) => `https://explorer.solana.com/tx/${h}` },
  } as Record<string, ChainCfg>,
  minterWallets: {} as Record<string, string>,     // ⚠️ provision mainnet minter wallets, fill IDs
  minterBlockchain: {
    arc: "ARC", base: "BASE", arbitrum: "ARB", optimism: "OP",
    polygon: "MATIC", avalanche: "AVAX", ethereum: "ETH", unichain: "UNI",
  } as Record<string, string>,
  nonGatewayMinters: {} as Record<string, { walletId: string; address: string; blockchain: string; appkitChain: string }>, // ⚠️ provision if using Monad/Solana on mainnet
};

const CFG = IS_MAINNET ? MAINNET : TESTNET;

export const CIRCLE_API_KEY_SECRET = CFG.circleApiKeySecret;
export const GATEWAY_API = CFG.gatewayApi;
export const PROVISION_BLOCKCHAIN = CFG.provisionBlockchain;
export const GATEWAY_CLIENT_CHAIN = CFG.gatewayClientChain;
export const ARC_RPC = CFG.arcRpc;
export const ARC = { domain: 26, gatewayWallet: GATEWAY_WALLET, gatewayMinter: GATEWAY_MINTER, usdc: CFG.arcUsdc };
export const CHAINS = CFG.chains;
export const MINTER_WALLETS = CFG.minterWallets;
export const MINTER_BLOCKCHAIN = CFG.minterBlockchain;
export const NON_GATEWAY_MINTERS = CFG.nonGatewayMinters;
