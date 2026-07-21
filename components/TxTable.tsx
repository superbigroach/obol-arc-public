"use client";

import { toCsv, downloadCsv, exportPdf, type Column } from "@/lib/exportData";

// Mirrors the row shape returned by /api/wallet (see lib/obol/gateway.ts).
// createdAt + network are present in the payload even though the dashboard's
// local type historically omitted them — we surface createdAt as "Time".
export type Activity = {
  id: string;
  from: string;
  to: string;
  amount: string;
  status: string;
  explorer: string;
  createdAt?: string;
  network?: string;
};

const short = (a: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "—");

function fmtTime(ts?: string): string {
  if (!ts) return "—";
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? ts : d.toLocaleString();
}

export default function TxTable({
  title,
  rows,
  kind,
}: {
  title: string;
  rows: Activity[];
  kind: "spend" | "earn";
}) {
  // Spend → show who we paid (To); Earn → show who paid us (From).
  const partyHeader = kind === "spend" ? "To" : "From";
  const party = (r: Activity) => (kind === "spend" ? r.to : r.from);

  // Column spec drives both the on-screen table and the CSV/PDF exports,
  // so exports always match what the user sees (full addresses, no truncation).
  const columns: Column<Activity>[] = [
    { header: partyHeader, value: (r) => party(r) || "" },
    { header: "Amount (USDC)", value: (r) => r.amount ?? "" },
    { header: "Status", value: (r) => r.status ?? "" },
    { header: "Time", value: (r) => fmtTime(r.createdAt) },
    { header: "Tx / Receipt", value: (r) => r.explorer || r.id || "" },
  ];

  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const stamp = new Date().toISOString().slice(0, 10);

  const onCsv = () => downloadCsv(`obol-${slug}-${stamp}.csv`, toCsv(rows, columns));
  const onPdf = () => exportPdf(`Obol — ${title}`, columns, rows);

  const btn =
    "rounded-[8px] border border-hairline px-3 py-1 text-[12.5px] font-semibold text-muted hover:bg-base2 hover:text-ink disabled:opacity-50 disabled:hover:bg-transparent";

  return (
    <div className="shadow-soft mt-6 rounded-[18px] border border-hairline bg-white p-7">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[18px] font-bold tracking-[-.02em]">{title}</h3>
        <div className="flex items-center gap-2">
          <button onClick={onCsv} disabled={rows.length === 0} className={btn}>Export CSV</button>
          <button onClick={onPdf} disabled={rows.length === 0} className={btn}>Export PDF</button>
        </div>
      </div>

      <div className="mt-4 overflow-hidden rounded-[12px] border border-hairline">
        <div className="grid grid-cols-[1.2fr_1fr_1fr_1.4fr_1fr] gap-2 bg-base2 px-5 py-3 text-[12.5px] font-semibold uppercase tracking-[.04em] text-muted">
          <div>{partyHeader}</div>
          <div>Amount</div>
          <div>Status</div>
          <div>Time</div>
          <div>Receipt</div>
        </div>
        {rows.length === 0 ? (
          <div className="px-5 py-10 text-center text-[14px] text-muted">No transactions yet</div>
        ) : (
          <div className="max-h-[360px] overflow-y-auto">
            {rows.map((r) => (
              <div
                key={r.id}
                className="grid grid-cols-[1.2fr_1fr_1fr_1.4fr_1fr] gap-2 border-t border-hairline px-5 py-3 text-[14px]"
              >
                <div className="font-mono text-[13px]" title={party(r)}>{short(party(r))}</div>
                <div>${r.amount}</div>
                <div className="text-muted">{r.status}</div>
                <div className="text-muted text-[13px]" title={r.createdAt}>{fmtTime(r.createdAt)}</div>
                <a
                  href={r.explorer}
                  target="_blank"
                  rel="noreferrer"
                  className="truncate text-primary hover:underline"
                  title={r.id}
                >
                  {r.id ? `${r.id.slice(0, 10)}…` : "—"}
                </a>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
