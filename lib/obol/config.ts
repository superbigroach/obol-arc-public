// Obol config — Arc testnet + Circle Gateway. Settlement is handled by Circle's
// hosted Gateway facilitator (we do not hand-roll any on-chain settlement).
export const ARC_CHAIN_ID = 5042002;
/** CAIP-2 id for Arc testnet, used by @circle-fin/x402-batching. */
export const ARC_TESTNET_CAIP2 = "eip155:5042002";
/** The official chain name key for @circle-fin/x402-batching GatewayClient. */
export const ARC_CHAIN_NAME = "arcTestnet" as const;

export const USDC_DECIMALS = 6;

/** Circle Gateway testnet facilitator (verify + batched settlement). */
export const GATEWAY_FACILITATOR_URL = "https://gateway-api-testnet.circle.com";

export const ARC_EXPLORER = "https://testnet.arcscan.app";
export const ARC_FAUCET = "https://faucet.circle.com";

/** Per-call commission (0 bps = 0%; Obol monetizes via subscriptions, not a take
 *  rate). Env OBOL_FEE_BPS can re-enable a take rate later without a code change. */
export const PLATFORM_FEE_BPS = Number(process.env.OBOL_FEE_BPS || 0);

/** Format atomic USDC (6dp) to a human string. */
export function fromAtomic(atomic: bigint | string): string {
  const a = BigInt(atomic);
  const neg = a < 0n;
  const v = neg ? -a : a;
  const whole = v / 1_000_000n;
  const frac = (v % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? "." + frac : ""}`;
}
