// Pure fee math for Obol's network fee. The agent pays price × (1 + fee), so
// the gross the seller receives already includes Obol's cut — these helpers
// recover that cut for display (no fetching, no side effects).

/** Obol's per-call commission in basis points (0 = 0%, free per call; Obol
 *  monetizes via subscriptions, not a take rate). */
export const NETWORK_FEE_BPS = 0;

/**
 * Obol's fee portion out of a gross amount that ALREADY includes the fee.
 * gross = base × (1 + bps/10000) → fee = gross × bps / (10000 + bps).
 */
export function feeFromGross(grossUsdc: number): number {
  const g = Number.isFinite(grossUsdc) ? grossUsdc : 0;
  return (g * NETWORK_FEE_BPS) / (10000 + NETWORK_FEE_BPS);
}

/** Human-readable fee rate, e.g. "1%". */
export function feeRatePct(): string {
  return `${NETWORK_FEE_BPS / 100}%`;
}

/** Format a USD amount to a `$`-string, up to 6dp, trailing zeros trimmed. */
export function fmtUsd(n: number): string {
  const v = Number.isFinite(n) ? n : 0;
  let s = v.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
  if (s === "" || s === "-0") s = "0";
  return `$${s}`;
}
