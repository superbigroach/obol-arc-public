"use client";

// "Book a demo" CTA for a public seller profile. Renders nothing unless the
// seller has pasted a scheduling link (Cal.com / Calendly / Google booking).
export default function BookDemo({
  schedulingUrl,
  sellerName,
}: {
  schedulingUrl?: string;
  sellerName?: string;
}) {
  const url = (schedulingUrl || "").trim();
  if (!url) return null;

  const href = /^https?:\/\//.test(url) ? url : `https://${url}`;

  return (
    <div className="flex flex-col items-start gap-1.5">
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="grad rounded-[10px] px-5 py-3 text-[15px] font-semibold text-white shadow-[0_4px_14px_rgba(109,94,246,.35)]"
      >
        📅 Book a demo
      </a>
      <span className="text-[12.5px] text-muted">
        Schedule a call with {sellerName || "this provider"}
      </span>
    </div>
  );
}
