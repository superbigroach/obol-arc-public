// Dependency-free data export helpers for dashboard tables.
// - toCsv: serialize rows -> RFC-4180 CSV using a column spec
// - downloadCsv: trigger a browser download via Blob + anchor click
// - exportPdf: print a styled HTML table in a new window (browser "Save as PDF")
// No heavy libs (no jsPDF / papaparse) — keeps the bundle lean.

export type Column<T> = {
  /** Column header shown in CSV/PDF. */
  header: string;
  /** Extract the cell's string value from a row. */
  value: (row: T) => string;
};

function escapeCsv(value: string): string {
  const v = value ?? "";
  // Quote if the value contains a comma, quote, or newline; escape quotes.
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Serialize rows to a CSV string given a column spec. */
export function toCsv<T>(rows: T[], columns: Column<T>[]): string {
  const head = columns.map((c) => escapeCsv(c.header)).join(",");
  const body = rows
    .map((r) => columns.map((c) => escapeCsv(String(c.value(r) ?? ""))).join(","))
    .join("\r\n");
  return body ? `${head}\r\n${body}` : head;
}

/** Download a CSV string as a file. */
export function downloadCsv(filename: string, csv: string): void {
  // Prepend BOM so Excel reads UTF-8 correctly.
  const blob = new Blob(["﻿", csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke after the click has had a chance to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function escapeHtml(value: string): string {
  return (value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Open a printable window with a simple styled table and invoke print().
 * The user picks "Save as PDF" in the browser print dialog — no PDF lib needed.
 */
export function exportPdf<T>(title: string, columns: Column<T>[], rows: T[]): void {
  const win = window.open("", "_blank", "noopener,noreferrer,width=900,height=700");
  if (!win) return; // popup blocked — silently no-op

  const generated = new Date().toLocaleString();
  const thead = columns.map((c) => `<th>${escapeHtml(c.header)}</th>`).join("");
  const tbody = rows.length
    ? rows
        .map(
          (r) =>
            `<tr>${columns
              .map((c) => `<td>${escapeHtml(String(c.value(r) ?? ""))}</td>`)
              .join("")}</tr>`
        )
        .join("")
    : `<tr><td colspan="${columns.length}" class="empty">No transactions yet</td></tr>`;

  win.document.write(`<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #14141f; margin: 32px; }
  h1 { font-size: 20px; font-weight: 800; letter-spacing: -.02em; margin: 0 0 4px; }
  .meta { font-size: 12px; color: #6b6b7b; margin-bottom: 20px; }
  table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #e6e6ee; vertical-align: top; }
  th { text-transform: uppercase; font-size: 10.5px; letter-spacing: .05em; color: #6b6b7b; background: #f6f6fb; }
  td.empty { text-align: center; color: #6b6b7b; padding: 32px; }
  tbody tr:nth-child(even) td { background: #fafafd; }
  .brand { font-weight: 800; }
  @media print { body { margin: 12px; } }
</style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <div class="meta"><span class="brand">Obol</span> · exported ${escapeHtml(generated)} · ${rows.length} row(s)</div>
  <table>
    <thead><tr>${thead}</tr></thead>
    <tbody>${tbody}</tbody>
  </table>
</body>
</html>`);
  win.document.close();
  win.focus();
  // Give the new window a tick to render before printing.
  setTimeout(() => {
    win.print();
  }, 300);
}
