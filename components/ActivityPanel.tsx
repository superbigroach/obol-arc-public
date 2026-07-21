"use client";

// Activity feed — reads the caller's own append-only `events` audit log from
// Firestore (owner-scoped by firestore.rules) and renders a clean history list.
//
// This is purely a history view of the "one wallet + unified Gateway balance"
// model: deposits bridged in, per-call payments, withdrawals, and bridges. It
// never surfaces the hidden plumbing (deposit SCAs / Solana wallets) as wallets.

import { useEffect, useState } from "react";
import { listMyEvents, type ObolEvent } from "@/lib/clientStore";
import { CHAIN_META } from "@/lib/walletConnect";

// ─── Type → visual classification ─────────────────────────────────────────
type Kind = "deposit" | "payment" | "withdrawal" | "bridge" | "other";

function classify(type: string): { kind: Kind; label: string; glyph: string } {
  const t = (type || "").toLowerCase();
  if (t.includes("withdraw")) return { kind: "withdrawal", label: "Withdrawal", glyph: "↑" };
  if (t.includes("bridge")) return { kind: "bridge", label: "Bridge", glyph: "⇄" };
  if (t === "pay" || t.includes("pay") || t.includes("call")) return { kind: "payment", label: "Payment", glyph: "→" };
  // fund_multichain / fund_agent / fund_gateway / deposit → money coming in.
  if (t.includes("fund") || t.includes("deposit")) return { kind: "deposit", label: "Deposit", glyph: "↓" };
  return { kind: "other", label: prettyType(type), glyph: "•" };
}

function prettyType(type: string): string {
  return (type || "activity").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

const KIND_STYLE: Record<Kind, string> = {
  deposit: "bg-[rgba(21,194,107,.12)] text-success",
  payment: "bg-[rgba(109,94,246,.12)] text-primary",
  withdrawal: "bg-[rgba(240,101,149,.14)] text-[#d6336c]",
  bridge: "bg-[rgba(59,130,246,.12)] text-[#2563eb]",
  other: "bg-base2 text-muted",
};

// ─── Parsing helpers ──────────────────────────────────────────────────────

/** Pull an "amount USDC" figure out of the human detail string. */
function parseAmount(detail: string): string | null {
  const m = detail?.match(/(\d[\d,]*\.?\d*)\s*USDC/i);
  return m ? `${m[1]} USDC` : null;
}

/** Resolve a chain label + explorer base from an event's network key or its detail. */
function resolveChain(ev: ObolEvent): { label: string | null; explorer: string | null } {
  // 1) explicit network field (preferred)
  if (ev.network && CHAIN_META[ev.network]) {
    const meta = CHAIN_META[ev.network];
    return { label: meta.chainName, explorer: meta.blockExplorerUrls[0] ?? null };
  }
  // 2) otherwise, match a known chain name inside the detail string
  const detail = ev.detail || "";
  for (const [, meta] of Object.entries(CHAIN_META)) {
    if (detail.includes(meta.chainName)) {
      return { label: meta.chainName, explorer: meta.blockExplorerUrls[0] ?? null };
    }
  }
  return { label: null, explorer: null };
}

/** Find a tx hash from a dedicated field or embedded in the detail string. */
function parseTxHash(ev: ObolEvent): string | null {
  const direct = ev.txHash || ev.tx;
  if (direct && /^0x[0-9a-fA-F]{64}$/.test(direct)) return direct;
  const m = ev.detail?.match(/0x[0-9a-fA-F]{64}/);
  return m ? m[0] : null;
}

/** Compact relative time, e.g. "just now", "2h ago", "3d ago". */
function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (!Number.isFinite(diff) || diff < 0) return "just now";
  const s = Math.floor(diff / 1000);
  if (s < 45) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

// ─── Component ────────────────────────────────────────────────────────────

export default function ActivityPanel({ uid }: { uid: string | null | undefined }) {
  const [events, setEvents] = useState<ObolEvent[] | null>(null);

  useEffect(() => {
    let live = true;
    if (!uid) { setEvents([]); return; }
    setEvents(null);
    listMyEvents(uid, 50).then((rows) => { if (live) setEvents(rows); });
    return () => { live = false; };
  }, [uid]);

  return (
    <div className="shadow-soft mt-6 rounded-[18px] border border-hairline bg-white p-7">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[18px] font-bold tracking-[-.02em]">Activity</h3>
        <span className="text-[12.5px] text-muted">Deposits · payments · withdrawals · bridges</span>
      </div>

      <div className="mt-4 overflow-hidden rounded-[12px] border border-hairline">
        {events === null ? (
          <div className="px-5 py-10 text-center text-[14px] text-muted">Loading activity…</div>
        ) : events.length === 0 ? (
          <div className="px-5 py-10 text-center text-[14px] text-muted">No activity yet</div>
        ) : (
          <div className="max-h-[420px] overflow-y-auto">
            {events.map((ev) => {
              const { kind, label, glyph } = classify(ev.type);
              const amount = parseAmount(ev.detail || "");
              const { label: chainLabel, explorer } = resolveChain(ev);
              const txHash = parseTxHash(ev);
              const txUrl = txHash && explorer ? `${explorer.replace(/\/$/, "")}/tx/${txHash}` : null;
              const abs = new Date(ev.ts).toLocaleString();

              return (
                <div
                  key={ev.id}
                  className="flex items-center gap-3 border-t border-hairline px-5 py-3 first:border-t-0"
                >
                  <span
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[15px] font-bold ${KIND_STYLE[kind]}`}
                    aria-hidden="true"
                  >
                    {glyph}
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[14px] font-semibold text-ink">{label}</span>
                      {chainLabel && (
                        <span className="shrink-0 rounded-full bg-base2 px-2 py-0.5 text-[11px] font-semibold text-muted">
                          {chainLabel}
                        </span>
                      )}
                    </div>
                    <div className="truncate text-[12.5px] text-muted" title={ev.detail}>
                      {ev.detail || prettyType(ev.type)}
                    </div>
                  </div>

                  <div className="shrink-0 text-right">
                    {amount && <div className="text-[14px] font-bold text-ink">{amount}</div>}
                    <div className="text-[12px] text-muted" title={abs}>{timeAgo(ev.ts)}</div>
                    {txUrl && (
                      <a
                        href={txUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[11.5px] font-semibold text-primary hover:underline"
                      >
                        View tx ↗
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
