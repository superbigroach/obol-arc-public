"use client";

import { feeFromGross, feeRatePct, fmtUsd } from "@/lib/fees";

/**
 * Presentational card showing what the seller owes Obol, derived purely from
 * the gross USDC they've received on-chain (which already includes the fee).
 * No fetching — pass `earned` (gross USDC string) and `calls`.
 */
export default function FeesPanel({ earned, calls }: { earned: string; calls: number }) {
  const gross = Number(earned) || 0;
  const fee = feeFromGross(gross);

  const zeroFee = fee === 0;
  return (
    <div className="shadow-soft rounded-[16px] border border-hairline bg-white p-6">
      <div className="text-[13px] font-semibold uppercase tracking-[.05em] text-muted">
        {zeroFee ? "Obol commission" : `Obol network fee (${feeRatePct()})`}
      </div>

      <div className="mt-2 text-[32px] font-extrabold tracking-[-.03em] grad-text">
        {zeroFee ? "0%" : fmtUsd(fee)}
      </div>

      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-[13px] text-muted">
        <span>You keep: <span className="font-semibold text-ink">{fmtUsd(gross)}</span> (100%)</span>
        <span>Calls: <span className="font-semibold text-ink">{calls}</span></span>
      </div>

      <p className="mt-3 text-[12.5px] text-muted">
        {zeroFee
          ? "0% commission — you keep 100% of every call. Gasless & non-custodial, settled to your wallet by Circle Gateway."
          : `You collect the ${feeRatePct()} on Obol's behalf and remit it — keeps every call gasless & non-custodial.`}
      </p>
    </div>
  );
}
