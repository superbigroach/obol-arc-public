// Network config for the seller codebase — mirrors functions/src/network.ts.
// Flip with OBOL_NETWORK=mainnet (default testnet). Only the Gateway (own-service)
// path is network-specific here; the facilitator/Bazaar path (facilitatorPay.mjs)
// is already network-agnostic (it reads the chain from each service's 402).
export const NETWORK = process.env.OBOL_NETWORK === "mainnet" ? "mainnet" : "testnet";
export const IS_MAINNET = NETWORK === "mainnet";

const TESTNET = {
  circleKeySecret: "CIRCLE_TESTNET_API_KEY",
  gatewayApi: "https://gateway-api-testnet.circle.com/v1",
  gatewayClientChain: "arcTestnet",
  arc: { chainId: 5042002, blockchain: "ARC-TESTNET", usdc: "0x3600000000000000000000000000000000000000", gatewayWallet: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9", gatewayMinter: "0x0022222ABE238Cc2C7Bb1f21003F0a260052475B" },
  // Own services on the Base FACILITATOR rail (raw USDC, gasless via facilitator).
  // No url → SDK default https://x402.org/facilitator (free + gas-sponsored on testnet).
  baseFacilitator: { network: "eip155:84532", usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", url: null },
};
const MAINNET = {
  circleKeySecret: "CIRCLE_MAINNET_API_KEY",
  gatewayApi: "https://gateway-api.circle.com/v1",
  gatewayClientChain: "arc",                 // own services stay Arc-native; use Arc mainnet when GA
  arc: { chainId: 5042002, blockchain: "ARC", usdc: "0x3600000000000000000000000000000000000000", gatewayWallet: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9", gatewayMinter: "0x0022222ABE238Cc2C7Bb1f21003F0a260052475B" }, // ⚠️ confirm Arc mainnet chainId/USDC
  // Base mainnet USDC + Coinbase CDP facilitator (free 1000 tx/mo, then $0.001/tx).
  // ⚠️ CDP settle needs auth: set createAuthHeaders (CDP API key/secret) before flipping mainnet.
  baseFacilitator: { network: "eip155:8453", usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", url: "https://api.cdp.coinbase.com/platform/v2/x402", createAuthHeaders: null },
};

export const NET = IS_MAINNET ? MAINNET : TESTNET;
