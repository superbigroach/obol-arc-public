"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import SiteNav from "@/components/SiteNav";
import SiteFooter from "@/components/SiteFooter";
import { listActiveServices, getProfile, trustScore, type ObolProfile } from "@/lib/clientStore";
import { getServiceRatings, getUserRating, rateService, type Rating } from "@/lib/ratings";
import { useAuth } from "@/components/AuthProvider";
import { useRouter } from "next/navigation";

type Service = {
  id?: string;
  ownerUid?: string;
  name: string;
  by: string;
  logoUrl?: string | null;
  website?: string | null;
  twitter?: string | null;
  linkedin?: string | null;
  youtube?: string | null;
  github?: string | null;
  discord?: string | null;
  socialsVisible?: Set<string> | null;
  category: string;
  desc: string;
  price: string;
  priceNum: number;
  calls: string;
  initials: string;
  createdAt: number;
  trust: number;
  verified?: boolean;
  ackVerified?: boolean;
  ackDid?: string;
  live?: boolean;
  agentReady?: boolean;
  docsUrl?: string;
  demoId?: string;
  source?: string;
  network?: string;
  callUrl?: string;
};

type SortKey = "trust" | "newest" | "price";

const SORTS: { key: SortKey; label: string }[] = [
  { key: "trust", label: "Trust" },
  { key: "newest", label: "Newest" },
  { key: "price", label: "Price ↑" },
];

const initials = (name?: string | null) =>
  (name ?? "").split(/\s+/).map((w) => w[0]).filter(Boolean).join("").slice(0, 2).toUpperCase() || "OB";

const shortAddr = (addr?: string | null): string => {
  const a = (addr ?? "").trim();
  if (!a) return "unknown";
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
};

const parseCalls = (s: string): number => {
  const m = /^([\d.]+)\s*([KM]?)$/i.exec(s.trim());
  if (!m) return Number(s) || 0;
  const n = parseFloat(m[1]);
  const mult = m[2].toUpperCase() === "M" ? 1e6 : m[2].toUpperCase() === "K" ? 1e3 : 1;
  return n * mult;
};

// Demo/template services removed — the marketplace now shows only real, live
// listings from the `services` collection (e.g. the ACK-verified Crypto Price
// and Weather APIs registered via the dashboard or the MCP list_service tool).
const RAW_SERVICES: { name: string; by: string; category: string; desc: string; price: string; calls: string; initials: string; demoId: string }[] = [];

const SERVICES: Service[] = RAW_SERVICES.map((s) => ({
  ...s,
  priceNum: Number(s.price.replace(/[^0-9.]/g, "")) || 0,
  createdAt: 0,
  trust: trustScore(null, { calls: parseCalls(s.calls), earned: 0, ageDays: 30 }),
  demoId: s.demoId,
}));

const CATEGORIES = ["All", "Data", "Search", "AI", "Finance"];

function StarRow({ avg, count }: { avg: number; count: number }) {
  if (count === 0) return <span className="text-[12px] text-muted">No reviews yet</span>;
  const filled = Math.max(0, Math.min(5, Math.round(avg)));
  return (
    <span className="flex items-center gap-1">
      <span className="text-[14px] leading-none text-amber-400 tracking-[-0.05em]">
        {"★".repeat(filled)}{"☆".repeat(5 - filled)}
      </span>
      <span className="text-[12px] text-muted">
        {avg.toFixed(1)} <span className="text-[11px]">({count})</span>
      </span>
    </span>
  );
}

export default function Marketplace() {
  const { user } = useAuth();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("All");
  const [sort, setSort] = useState<SortKey>("trust");
  const [live, setLive] = useState<Service[]>([]);
  const [ratings, setRatings] = useState<Map<string, { avg: number; count: number }>>(new Map());

  // Rating modal state
  const [rateModal, setRateModal] = useState<{ serviceId: string; name: string } | null>(null);
  const [rateStars, setRateStars] = useState(5);
  const [rateComment, setRateComment] = useState("");
  const [rateSaving, setRateSaving] = useState(false);
  const [rateDone, setRateDone] = useState(false);
  const [modalReviews, setModalReviews] = useState<Rating[]>([]);

  async function submitRating() {
    if (!user) { router.push("/login"); return; }
    if (!rateModal) return;
    setRateSaving(true);
    try {
      await rateService(user.uid, rateModal.serviceId, rateStars, rateComment, false);
      setRateDone(true);
      // refresh rating for this service
      const updated = await getServiceRatings(rateModal.serviceId);
      setRatings(prev => new Map(prev).set(rateModal.serviceId, { avg: updated.avg, count: updated.count }));
      setTimeout(() => { setRateModal(null); setRateDone(false); setRateStars(5); setRateComment(""); }, 1500);
    } catch { /* keep modal open */ }
    finally { setRateSaving(false); }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const rows = await listActiveServices().catch(() => []);
      const ownerUids = [...new Set(rows.map((s) => s.ownerUid).filter(Boolean))];
      const profiles = new Map<string, ObolProfile | null>();
      await Promise.all(
        ownerUids.map(async (uid) => {
          profiles.set(uid, await getProfile(uid).catch(() => null));
        }),
      );
      if (cancelled) return;
      setLive(
        rows.map((s) => {
          const profile = (s.ownerUid ? profiles.get(s.ownerUid) : null) ?? null;
          const createdAt = typeof s.createdAt === "number" ? s.createdAt : 0;
          const ageDays = createdAt ? Math.max(0, (Date.now() - createdAt) / 86_400_000) : 0;
          const trust = trustScore(profile, { calls: 0, earned: 0, ageDays });
          const name = s.name?.trim() || "Untitled service";
          return {
            id: s.id,
            source: "obol",
            ownerUid: s.ownerUid,
            name,
            by: profile?.companyName || (profile?.username ? `@${profile.username}` : null) || profile?.displayName || shortAddr(s.payoutAddress),
            logoUrl: profile?.logoUrl || profile?.avatarUrl || null,
            website: profile?.socials?.website || null,
            twitter: profile?.socials?.x || null,
            linkedin: profile?.socials?.linkedin || null,
            youtube: profile?.socials?.youtube || null,
            github: profile?.socials?.github || null,
            discord: profile?.socials?.discord || null,
            socialsVisible: profile?.socialsShowOnListing ? new Set(profile.socialsShowOnListing) : null,
            category: s.category || "Other",
            desc: s.description || "",
            price: s.priceUsdc != null ? "$" + s.priceUsdc : "$0",
            priceNum: Number(s.priceUsdc) || 0,
            calls: "0",
            initials: initials(name),
            createdAt,
            trust,
            verified: profile?.verification?.kybStatus === "verified",
            ackVerified: !!s.ackVerified,
            ackDid: s.ackDid,
            live: true,
            agentReady: !!(s.inputSchema || s.docsUrl),
            docsUrl: s.docsUrl,
          };
        }),
      );

      // Federate Coinbase x402 Bazaar listings (discovery only) — tagged + appended.
      try {
        const r = await fetch("https://obol-arc.web.app/api/services?bazaar=1&bazaarLimit=60");
        const j = await r.json();
        const bz = ((j.services as Record<string, unknown>[]) || [])
          .filter((s) => s.source === "bazaar")
          .map((s) => ({
            id: String(s.id),
            source: "bazaar",
            name: String(s.name || "x402 service"),
            by: "Coinbase Bazaar",
            category: String(s.category || "x402"),
            desc: String(s.description || ""),
            price: "$" + (Number(s.priceUsdc) || 0),
            priceNum: Number(s.priceUsdc) || 0,
            calls: "0",
            initials: initials(String(s.name || "x4")),
            createdAt: 0,
            trust: 0,
            live: true,
            agentReady: true,
            network: String(s.network || ""),
            callUrl: String(s.callUrl || ""),
          } as Service));
        if (!cancelled && bz.length) setLive((prev) => [...prev, ...bz]);
      } catch { /* bazaar federation optional */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // Fetch ratings for all visible cards (live + demo).
  const ratingIds = useMemo(() => {
    const ids: string[] = [];
    live.forEach((s) => { if (s.id) ids.push(s.id); });
    SERVICES.forEach((s) => { if (s.demoId) ids.push(s.demoId); });
    return ids;
  }, [live]);

  useEffect(() => {
    if (ratingIds.length === 0) return;
    let cancelled = false;
    Promise.all(
      ratingIds.map(async (id) => {
        const r = await getServiceRatings(id);
        return [id, { avg: r.avg, count: r.count }] as const;
      }),
    ).then((entries) => {
      if (!cancelled) setRatings(new Map(entries));
    });
    return () => { cancelled = true; };
  }, [ratingIds]);

  const filtered = useMemo(() => {
    const all = [...live, ...SERVICES];
    const matched = all.filter(
      (s) =>
        (cat === "All" || s.category === cat) &&
        (q === "" || (s.name + " " + s.by + " " + s.desc + " " + s.category).toLowerCase().includes(q.toLowerCase())),
    );
    const sorted = [...matched];
    if (sort === "trust") sorted.sort((a, b) => b.trust - a.trust || b.createdAt - a.createdAt);
    else if (sort === "newest") sorted.sort((a, b) => b.createdAt - a.createdAt);
    else if (sort === "price") sorted.sort((a, b) => a.priceNum - b.priceNum);
    return sorted;
  }, [live, q, cat, sort]);

  return (
    <main>
      <SiteNav />

      {/* header */}
      <section className="border-b border-hairline bg-white py-14">
        <div className="mx-auto max-w-[1180px] px-6">
          <div className="mb-3 text-[13px] font-bold uppercase tracking-[.08em] text-primary">Directory</div>
          <h1 className="text-[40px] font-extrabold tracking-[-.035em]">Services your agent can pay for</h1>
          <p className="mt-3 max-w-[620px] text-[18px] text-muted">
            Every service here accepts per-call payment in USDC over Obol. No accounts, no API keys —
            your agent finds it, pays a coin, and gets the result.
          </p>

          <div className="mt-7 flex flex-wrap items-center gap-3">
            <div className="relative w-full max-w-[420px]">
              <svg className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
              </svg>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search services by name, seller, category…"
                className="w-full rounded-[12px] border border-hairline bg-white pl-11 pr-10 py-3 text-[15px] shadow-soft outline-none focus:border-primary"
              />
              {q && (
                <button onClick={() => setQ("")} aria-label="Clear search"
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted hover:bg-base2 hover:text-ink">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
                </button>
              )}
            </div>
            <div className="flex gap-2">
              {CATEGORIES.map((c) => (
                <button
                  key={c}
                  onClick={() => setCat(c)}
                  className={`rounded-full px-4 py-2 text-[14px] font-semibold transition ${cat === c ? "grad text-white" : "border border-hairline bg-white text-muted hover:text-ink"}`}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-semibold uppercase tracking-[.05em] text-muted">Sort</span>
            {SORTS.map((s) => (
              <button
                key={s.key}
                onClick={() => setSort(s.key)}
                className={`rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition ${sort === s.key ? "bg-ink text-white" : "border border-hairline bg-white text-muted hover:text-ink"}`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* grid */}
      <section className="py-12">
        <div className="mx-auto max-w-[1180px] px-6">
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {filtered.map((s, i) => {
              const cardHref = s.source === "bazaar"
                ? (s.callUrl || null)          // Bazaar: external x402 endpoint, no Obol page
                : s.live && s.id
                ? `/service/${s.id}`
                : s.demoId
                ? `/service/${s.demoId}`
                : null;
              const ratingKey = (s.live && s.id) ? s.id : s.demoId;
              const cardRating = ratingKey ? ratings.get(ratingKey) : null;

              const vis = s.socialsVisible;
              const show = (key: string, val: string | null | undefined) =>
                val && (vis === null || vis === undefined || vis.has(key));

              return (
                <div
                  key={s.id || s.name + i}
                  className="relative shadow-soft group flex flex-col rounded-[18px] border border-hairline bg-white p-6 transition hover:-translate-y-1 hover:shadow-lg2"
                >
                  <div className="flex flex-col flex-1">

                    {/* Top row: logo + chips */}
                    <div className="flex items-start justify-between">
                      {s.logoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={s.logoUrl} alt={s.by} className="h-11 w-11 rounded-[12px] border border-hairline object-cover" onError={(e) => { e.currentTarget.style.display = "none"; }} />
                      ) : (
                        <div className="grad flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] text-[15px] font-extrabold text-white">{s.initials}</div>
                      )}
                      <div className="flex flex-wrap items-center justify-end gap-1.5">
                        {s.source === "bazaar" && (
                          <span className="flex items-center gap-1 rounded-full bg-[rgba(37,99,235,.12)] px-2.5 py-1 text-[11px] font-bold uppercase tracking-[.04em] text-[#2563eb]" title="Discovered via Coinbase x402 Bazaar">Bazaar</span>
                        )}
                        {s.verified && (
                          <span className="flex items-center gap-1 rounded-full bg-[rgba(21,194,107,.12)] px-2.5 py-1 text-[11px] font-bold uppercase tracking-[.04em] text-success">✓ Verified</span>
                        )}
                        {s.live && (
                          <span className="flex items-center gap-1 rounded-full bg-[rgba(21,194,107,.12)] px-2.5 py-1 text-[11px] font-bold uppercase tracking-[.04em] text-success">
                            <span className="h-[6px] w-[6px] rounded-full bg-success" /> Live
                          </span>
                        )}
                        {s.agentReady && (
                          <span className="rounded-full bg-[rgba(109,94,246,.12)] px-2.5 py-1 text-[11px] font-bold uppercase tracking-[.04em] text-primary">Agent-ready</span>
                        )}
                        {s.ackVerified && (
                          <a
                            href={`/api/ack?${s.ackDid ? `did=${encodeURIComponent(s.ackDid)}` : ""}`}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            title="ACK-ID verified — click to open the W3C Verifiable Credential (Agent Commerce Kit) proving this seller controls their payout wallet."
                            className="relative z-[3] flex items-center gap-1 rounded-full bg-[rgba(59,158,255,.12)] px-2.5 py-1 text-[11px] font-bold uppercase tracking-[.04em] text-glow hover:bg-[rgba(59,158,255,.22)]"
                          >
                            🛡 ACK Verified ↗
                          </a>
                        )}
                        <span className="rounded-full bg-base2 px-3 py-1 text-[12px] font-semibold text-muted">{s.category}</span>
                      </div>
                    </div>

                    {/* Service name — the stretched full-card link via ::after overlay */}
                    <h3 className="mt-4 text-[19px] font-bold tracking-[-.02em]">
                      {cardHref ? (
                        <Link
                          href={cardHref}
                          className="after:absolute after:inset-0 after:content-[''] after:rounded-[18px] hover:text-primary"
                        >
                          {s.name}
                        </Link>
                      ) : (
                        s.name
                      )}
                    </h3>

                    {/* Seller identity row — relative so it sits above the ::after overlay */}
                    <div className="relative mt-1 flex flex-wrap items-center gap-2">
                      <span className="text-[13px] text-muted">
                        by{" "}
                        {s.live && s.ownerUid ? (
                          <Link href={`/seller/${s.ownerUid}`} className="font-medium text-ink hover:text-primary">{s.by}</Link>
                        ) : (
                          <span className="font-medium text-ink">{s.by}</span>
                        )}
                      </span>
                      <span className="flex items-center gap-1.5">
                        {show("website", s.website) && (
                          <a href={s.website!} target="_blank" rel="noreferrer" title="Website"
                            className="flex h-[22px] w-[22px] items-center justify-center rounded-full border border-hairline text-[10px] text-muted hover:border-primary hover:text-primary">
                            🌐
                          </a>
                        )}
                        {show("x", s.twitter) && (
                          <a href={s.twitter!.startsWith("http") ? s.twitter! : `https://x.com/${s.twitter}`} target="_blank" rel="noreferrer" title="X / Twitter"
                            className="flex h-[22px] w-[22px] items-center justify-center rounded-full border border-hairline text-[10px] font-bold text-muted hover:border-ink hover:text-ink">
                            𝕏
                          </a>
                        )}
                        {show("linkedin", s.linkedin) && (
                          <a href={s.linkedin!} target="_blank" rel="noreferrer" title="LinkedIn"
                            className="flex h-[22px] w-[22px] items-center justify-center rounded-full border border-hairline text-[10px] font-bold text-muted hover:border-[#0077b5] hover:text-[#0077b5]">
                            in
                          </a>
                        )}
                        {show("youtube", s.youtube) && (
                          <a href={s.youtube!} target="_blank" rel="noreferrer" title="YouTube"
                            className="flex h-[22px] w-[22px] items-center justify-center rounded-full border border-hairline text-[10px] text-muted hover:border-red-500 hover:text-red-500">
                            ▶
                          </a>
                        )}
                        {show("github", s.github) && (
                          <a href={s.github!.startsWith("http") ? s.github! : `https://github.com/${s.github}`} target="_blank" rel="noreferrer" title="GitHub"
                            className="flex h-[22px] w-[22px] items-center justify-center rounded-full border border-hairline text-[10px] font-bold text-muted hover:border-ink hover:text-ink">
                            ⌥
                          </a>
                        )}
                        {show("discord", s.discord) && (
                          <a href={s.discord!} target="_blank" rel="noreferrer" title="Discord"
                            className="flex h-[22px] w-[22px] items-center justify-center rounded-full border border-hairline text-[10px] text-muted hover:border-[#5865f2] hover:text-[#5865f2]">
                            💬
                          </a>
                        )}
                      </span>
                    </div>

                    {/* Description — NOT positioned, clicks go to the ::after overlay */}
                    <p className="mt-2.5 flex-1 min-h-[42px] text-[14px] leading-[1.55] text-[#3a3a48]">{s.desc}</p>

                    {/* Ratings row — relative to sit above the overlay */}
                    {cardHref && (
                      <div className="relative mt-3 flex items-center justify-between gap-2">
                        <StarRow avg={cardRating?.avg ?? 0} count={cardRating?.count ?? 0} />
                        <button
                          type="button"
                          onClick={async () => {
                            const sid = ratingKey ?? "";
                            setRateStars(5); setRateComment(""); setRateDone(false); setModalReviews([]);
                            setRateModal({ serviceId: sid, name: s.name });
                            const [existing, summary] = await Promise.all([
                              user ? getUserRating(sid, user.uid).catch(() => null) : Promise.resolve(null),
                              getServiceRatings(sid).catch(() => null),
                            ]);
                            if (existing) { setRateStars(existing.stars); setRateComment(existing.comment || ""); }
                            if (summary?.recent) setModalReviews(summary.recent);
                          }}
                          className="shrink-0 rounded-[8px] border border-hairline bg-base2 px-3 py-1 text-[12px] font-semibold text-ink hover:bg-[rgba(109,94,246,.1)] hover:border-primary hover:text-primary"
                        >
                          ★ Rate
                        </button>
                      </div>
                    )}

                    {/* Price + actions row — relative to sit above the overlay */}
                    <div className="relative mt-4 flex items-center justify-between border-t border-hairline pt-4">
                      <div>
                        <span className="text-[18px] font-extrabold">{s.price}</span>
                        <span className="text-[13px] text-muted"> / call</span>
                      </div>
                      {s.live && s.id ? (
                        <span className="flex items-center gap-3">
                          {s.docsUrl && <a href={s.docsUrl} target="_blank" rel="noreferrer" className="text-[13px] font-medium text-muted hover:text-ink">Docs ↗</a>}
                          <Link href={`/service/${s.id}`} className="text-[13px] font-semibold text-primary hover:underline">View →</Link>
                        </span>
                      ) : (
                        <span className="text-[13px] text-muted">{s.calls} calls</span>
                      )}
                    </div>

                  </div>
                </div>
              );
            })}
          </div>

          {filtered.length === 0 && (
            <div className="py-20 text-center text-muted">No services match &ldquo;{q}&rdquo;.</div>
          )}

          <div className="mt-12 rounded-[20px] border border-dashed border-hairline bg-white p-10 text-center">
            <h3 className="text-[22px] font-bold tracking-[-.02em]">Have an API? List it here.</h3>
            <p className="mx-auto mt-2 max-w-[460px] text-[15px] text-muted">
              Wrap it in two lines, set a price, and every AI agent on Obol can find and pay for it.
            </p>
            <a href="/login" className="grad mt-5 inline-flex rounded-[10px] px-5 py-3 text-[15px] font-semibold text-white shadow-[0_4px_14px_rgba(109,94,246,.35)]">
              List your service →
            </a>
          </div>
        </div>
      </section>

      <SiteFooter />

      {/* ── Rating modal ── */}
      {rateModal && (
        <div
          className="fixed inset-0 z-[999] flex items-end justify-center bg-black/40 p-4 sm:items-center"
          onClick={(e) => { if (e.target === e.currentTarget) setRateModal(null); }}
        >
          <div className="w-full max-w-[440px] rounded-[20px] border border-hairline bg-white p-7 shadow-[0_20px_60px_rgba(0,0,0,.18)]">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-[17px] font-bold tracking-[-.02em]">Rate {rateModal.name}</div>
                <div className="mt-0.5 text-[13px] text-muted">Your rating is public and helps other agents choose</div>
              </div>
              <button onClick={() => setRateModal(null)} className="rounded-full p-1.5 text-muted hover:bg-base2">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
              </button>
            </div>

            {/* Recent reviews */}
            {modalReviews.length > 0 && (
              <div className="mt-4 max-h-[140px] overflow-y-auto space-y-3 border-b border-hairline pb-4">
                {modalReviews.map((r, i) => (
                  <div key={i} className="rounded-[10px] bg-base2 px-3 py-2.5">
                    <div className="flex items-center gap-1 mb-1">
                      {[1,2,3,4,5].map(s => (
                        <svg key={s} width="11" height="11" viewBox="0 0 24 24"
                          fill={s <= r.stars ? "#f59e0b" : "none"}
                          stroke={s <= r.stars ? "#f59e0b" : "#d1d5db"} strokeWidth="2">
                          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                        </svg>
                      ))}
                      <span className="text-[10px] text-muted ml-1">{r.uid.slice(0,6)}…</span>
                    </div>
                    {r.comment && <p className="text-[12px] text-[#3a3a48] leading-[1.4]">&ldquo;{r.comment}&rdquo;</p>}
                  </div>
                ))}
              </div>
            )}

            {rateDone ? (
              <div className="mt-6 rounded-[12px] bg-[rgba(21,194,107,.12)] p-5 text-center text-[15px] font-semibold text-success">
                Review saved! ✓
              </div>
            ) : (
              <>
                <div className="mt-5 flex items-center gap-1" role="radiogroup">
                  {[1,2,3,4,5].map(n => (
                    <button
                      key={n} type="button"
                      onClick={() => setRateStars(n)}
                      className={`text-[32px] leading-none transition ${n <= rateStars ? "text-amber-400" : "text-hairline hover:text-amber-300"}`}
                    >★</button>
                  ))}
                  <span className="ml-2 text-[14px] font-semibold text-muted">{rateStars}/5</span>
                </div>

                <textarea
                  value={rateComment}
                  onChange={e => setRateComment(e.target.value)}
                  placeholder="Comment (optional — add or change anytime)"
                  rows={3}
                  className="mt-4 w-full resize-none rounded-[12px] border border-hairline px-4 py-3 text-[15px] outline-none focus:border-primary"
                />

                <div className="mt-4 flex items-center justify-between">
                  <button onClick={() => setRateModal(null)} className="text-[14px] text-muted hover:text-ink">Cancel</button>
                  <button
                    onClick={submitRating}
                    disabled={rateSaving}
                    className="grad rounded-[10px] px-5 py-2.5 text-[14px] font-semibold text-white disabled:opacity-60"
                  >
                    {rateSaving ? "Saving…" : "Submit"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
