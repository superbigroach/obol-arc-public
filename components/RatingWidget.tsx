"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { rateService, getServiceRatings, type RatingSummary } from "@/lib/ratings";

/** Render `n` filled gold stars out of 5 (rounds the average). */
function Stars({ value }: { value: number }) {
  const filled = Math.round(value);
  return (
    <span className="text-[18px] tracking-[1px] text-[#f5a623]" aria-label={`${value.toFixed(1)} out of 5`}>
      {"★".repeat(Math.max(0, Math.min(5, filled)))}
      <span className="text-hairline">{"★".repeat(5 - Math.max(0, Math.min(5, filled)))}</span>
    </span>
  );
}

export default function RatingWidget({ serviceId }: { serviceId: string }) {
  const { user } = useAuth();

  const [summary, setSummary] = useState<RatingSummary>({ avg: 0, count: 0, disputes: 0, recent: [] });
  const [stars, setStars] = useState(5);
  const [comment, setComment] = useState("");
  const [dispute, setDispute] = useState(false);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  const refresh = useCallback(() => {
    getServiceRatings(serviceId).then(setSummary).catch(() => {});
  }, [serviceId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const submit = async () => {
    if (!user) return;
    setSaving(true);
    setDone(false);
    try {
      await rateService(user.uid, serviceId, stars, comment, dispute);
      setComment("");
      setDispute(false);
      setDone(true);
      refresh();
    } catch {
      // rateService already logs; keep the form usable.
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-7 shadow-soft rounded-[18px] border border-hairline bg-white p-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-[12px] font-semibold uppercase tracking-[.05em] text-muted">
          Ratings &amp; disputes
        </div>
        {summary.disputes > 0 && (
          <span className="rounded-full bg-[rgba(231,76,60,.12)] px-2.5 py-1 text-[11px] font-bold uppercase tracking-[.04em] text-[#e74c3c]">
            ⚠ {summary.disputes} dispute{summary.disputes === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {/* summary */}
      <div className="mt-4 flex items-center gap-3">
        <Stars value={summary.avg} />
        <span className="text-[18px] font-extrabold text-primary">
          {summary.count ? summary.avg.toFixed(1) : "—"}
        </span>
        <span className="text-[14px] text-muted">
          {summary.count} rating{summary.count === 1 ? "" : "s"}
        </span>
      </div>

      {/* recent comments */}
      {summary.recent.some((r) => r.comment) && (
        <div className="mt-5 space-y-3">
          {summary.recent
            .filter((r) => r.comment)
            .map((r) => (
              <div key={r.uid + r.ts} className="rounded-[12px] border border-hairline bg-base2 p-4">
                <div className="flex items-center gap-2">
                  <Stars value={r.stars} />
                  {r.dispute && (
                    <span className="rounded-full bg-[rgba(231,76,60,.12)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[.04em] text-[#e74c3c]">
                      Disputed
                    </span>
                  )}
                </div>
                <p className="mt-2 text-[14px] leading-[1.5] text-[#3a3a48]">{r.comment}</p>
              </div>
            ))}
        </div>
      )}

      {/* form (logged in only) */}
      {user ? (
        <div className="mt-6 border-t border-hairline pt-6">
          <div className="text-[14px] font-semibold text-ink">Leave a rating</div>

          <div className="mt-3 flex items-center gap-1" role="radiogroup" aria-label="Star rating">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setStars(n)}
                aria-label={`${n} star${n === 1 ? "" : "s"}`}
                aria-checked={stars === n}
                role="radio"
                className={`text-[26px] leading-none transition ${n <= stars ? "text-[#f5a623]" : "text-hairline hover:text-[#f5a623]"}`}
              >
                ★
              </button>
            ))}
          </div>

          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Optional — how did it perform?"
            rows={3}
            className="mt-4 w-full rounded-[12px] border border-hairline bg-white px-4 py-3 text-[15px] shadow-soft outline-none focus:border-primary"
          />

          <label className="mt-3 flex items-center gap-2 text-[14px] text-muted">
            <input
              type="checkbox"
              checked={dispute}
              onChange={(e) => setDispute(e.target.checked)}
              className="h-4 w-4 accent-[#e74c3c]"
            />
            Report a problem (dispute)
          </label>

          <div className="mt-4 flex items-center gap-3">
            <button
              type="button"
              onClick={submit}
              disabled={saving}
              className="grad rounded-[10px] px-5 py-2.5 text-[15px] font-semibold text-white shadow-[0_4px_14px_rgba(109,94,246,.35)] disabled:opacity-60"
            >
              {saving ? "Submitting…" : "Submit rating"}
            </button>
            {done && <span className="text-[14px] font-medium text-success">Saved — thanks!</span>}
          </div>
        </div>
      ) : (
        <p className="mt-6 border-t border-hairline pt-6 text-[14px] text-muted">
          Sign in to rate this service or report a problem.
        </p>
      )}
    </div>
  );
}
