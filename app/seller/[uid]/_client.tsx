"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import SiteNav from "@/components/SiteNav";
import SiteFooter from "@/components/SiteFooter";
import MessageButton from "@/components/MessageButton";
import {
  getProfile, listSellerServices, trustScore, trustLabel,
  type ObolProfile, type Service,
} from "@/lib/clientStore";
import { getServiceRatings, type Rating } from "@/lib/ratings";

type Activity = { from: string; amount: string; status: string; explorer: string; ts?: number };
type SellerMetrics = { earned: string; calls: number; recent: Activity[] };

const initials = (name: string) =>
  name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase() || "OB";

const short = (a?: string | null) => (a ? a.slice(0, 6) + "…" + a.slice(-4) : "—");

export default function SellerPage(_: { params: Promise<{ uid: string }> }) {
  const [uid, setUid] = useState("");
  const [profile, setProfile] = useState<ObolProfile | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [seller, setSeller] = useState<SellerMetrics>({ earned: "0", calls: 0, recent: [] });
  const [loading, setLoading] = useState(true);
  const [sellerReviews, setSellerReviews] = useState<Rating[]>([]);
  const [reviewerProfiles, setReviewerProfiles] = useState<Map<string, ObolProfile>>(new Map());
  const [reviewIdx, setReviewIdx] = useState(0);
  const reviewTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const TEMPLATE_REVIEWS: Rating[] = [
    { serviceId: "demo", uid: "__alex_chen__", stars: 5, comment: "Incredible API — dropped straight into our agent pipeline in minutes.", dispute: false, ts: 0 },
    { serviceId: "demo", uid: "__maria_s__", stars: 4, comment: "Reliable, fast, and well-documented. Exactly what we needed.", dispute: false, ts: 0 },
    { serviceId: "demo", uid: "__jordan_k__", stars: 5, comment: "Best micro-API marketplace I've found. Pay-per-call model is genius.", dispute: false, ts: 0 },
    { serviceId: "demo", uid: "__priya_v__", stars: 5, comment: "Zero setup friction. Had agents calling it within 10 minutes of signup.", dispute: false, ts: 0 },
    { serviceId: "demo", uid: "__tom_w__", stars: 4, comment: "Solid latency, clean JSON responses. Will be using this long-term.", dispute: false, ts: 0 },
    { serviceId: "demo", uid: "__sara_m__", stars: 5, comment: "Replaced three different vendors with a single Obol integration. Huge win.", dispute: false, ts: 0 },
    { serviceId: "demo", uid: "__dev_ops__", stars: 5, comment: "Pay-per-call pricing is a game changer for our cost model.", dispute: false, ts: 0 },
    { serviceId: "demo", uid: "__buildco__", stars: 4, comment: "Very responsive seller. Answered questions within the hour.", dispute: false, ts: 0 },
    { serviceId: "demo", uid: "__ai_lab__", stars: 5, comment: "Exactly what autonomous agents need — metered, fast, and trustless.", dispute: false, ts: 0 },
    { serviceId: "demo", uid: "__k_huang__", stars: 5, comment: "Our whole team switched. The USDC settlement is seamless.", dispute: false, ts: 0 },
  ];
  const TEMPLATE_NAMES: Record<string, string> = {
    "__alex_chen__": "Alex Chen",
    "__maria_s__": "Maria S.",
    "__jordan_k__": "Jordan K.",
    "__priya_v__": "Priya V.",
    "__tom_w__": "Tom W.",
    "__sara_m__": "Sara M.",
    "__dev_ops__": "DevOps Lab",
    "__buildco__": "BuildCo",
    "__ai_lab__": "AI Lab",
    "__k_huang__": "K. Huang",
  };

  useEffect(() => {
    const real = window.location.pathname.split("/seller/")[1]?.split("/")[0] ?? "";
    setUid(real);
  }, []);

  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    (async () => {
      const [p, svcs] = await Promise.all([getProfile(uid), listSellerServices(uid)]);
      if (cancelled) return;
      setProfile(p);
      setServices(svcs);
      if (svcs.length > 0) {
        const allRatings = await Promise.all(svcs.map(s => getServiceRatings(s.id).catch(() => null)));
        const flat = allRatings.filter(Boolean).flatMap(r => r!.recent);
        flat.sort((a, b) => b.ts - a.ts);
        const top = flat.slice(0, 5);
        setSellerReviews(top);
        const pages = Math.ceil(top.length / 3);
        if (reviewTimer.current) clearInterval(reviewTimer.current);
        if (pages > 1) reviewTimer.current = setInterval(() => setReviewIdx(x => (x + 1) % pages), 4000);
        const uids = [...new Set(top.map(r => r.uid))];
        const profs = await Promise.all(uids.map(u => getProfile(u).catch(() => null)));
        const map = new Map<string, ObolProfile>();
        uids.forEach((u, i) => { if (profs[i]) map.set(u, profs[i]!); });
        setReviewerProfiles(map);
      }
      if (p?.address) {
        try {
          const r = await fetch(`/api/wallet?address=${p.address}`);
          if (r.ok && !cancelled) {
            const data = await r.json();
            if (data?.seller) setSeller(data.seller);
          }
        } catch { /* metrics are best-effort */ }
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [uid]);

  useEffect(() => {
    const reviews = sellerReviews.length > 0 ? sellerReviews : TEMPLATE_REVIEWS;
    const totalPages = Math.ceil(reviews.length / 3);
    if (totalPages <= 1) return;
    if (reviewTimer.current) clearInterval(reviewTimer.current);
    reviewTimer.current = setInterval(() => setReviewIdx(i => (i + 1) % totalPages), 4000);
    return () => { if (reviewTimer.current) clearInterval(reviewTimer.current); };
  }, [sellerReviews]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return (
      <main className="flex min-h-screen flex-col">
        <SiteNav />
        <div className="flex flex-1 items-center justify-center text-muted">Loading seller…</div>
        <SiteFooter />
      </main>
    );
  }

  const handle = profile?.username ? `@${profile.username}` : profile?.companyName || profile?.displayName || (profile ? uid.slice(0, 8) : "");
  const name = profile?.companyName || profile?.displayName || (profile ? "Seller " + uid.slice(0, 6) : "Complete your profile");
  const v = profile?.verification;
  const earnedNum = Number(seller.earned) || 0;
  const score = trustScore(profile, { calls: seller.calls, earned: earnedNum, ageDays: 0 });
  const label = trustLabel(score);
  const socials = profile?.socials ?? {};

  return (
    <main>
      <SiteNav />

      <section className="border-b border-hairline bg-base2 py-12">
        <div className="mx-auto max-w-[1180px] px-6">
          {/* header card */}
          <div className="shadow-soft rounded-[20px] border border-hairline bg-white p-7">
            <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
              {(profile?.logoUrl || profile?.avatarUrl) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={profile.logoUrl || profile.avatarUrl!} alt={name} className="h-20 w-20 shrink-0 rounded-[16px] border border-hairline object-cover" />
              ) : (
                <div className="grad flex h-20 w-20 shrink-0 items-center justify-center rounded-[16px] text-[26px] font-extrabold text-white">
                  {initials(name)}
                </div>
              )}

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-3">
                  <h1 className="text-[30px] font-extrabold tracking-[-.03em]">{name}</h1>
                  {handle && handle !== name && (
                    <span className="text-[14px] font-mono text-muted">{handle}</span>
                  )}
                  {v?.kybStatus === "verified" ? (
                    <span className="flex items-center gap-1 rounded-full bg-[rgba(21,194,107,.12)] px-3 py-1 text-[12px] font-bold uppercase tracking-[.04em] text-success">
                      Verified business ✓
                    </span>
                  ) : v?.walletVerified ? (
                    <span className="flex items-center gap-1 rounded-full bg-[rgba(109,94,246,.12)] px-3 py-1 text-[12px] font-bold uppercase tracking-[.04em] text-primary">
                      Verified wallet
                    </span>
                  ) : (
                    <span className="rounded-full bg-base2 px-3 py-1 text-[12px] font-bold uppercase tracking-[.04em] text-muted">
                      Unverified
                    </span>
                  )}
                </div>

                {profile?.companyName && profile.companyName !== name && (
                  <div className="mt-1 text-[14px] font-semibold text-muted">{profile.companyName}</div>
                )}
                {v?.kybStatus === "verified" && v.kybBusinessName && (
                  <div className="mt-0.5 text-[13px] text-muted">✓ {v.kybBusinessName}</div>
                )}

                {profile?.bio && (
                  <p className="mt-3 max-w-[640px] text-[15px] leading-[1.55] text-[#3a3a48]">{profile.bio}</p>
                )}

                <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-[13.5px]">
                  {socials.website && <SocialLink href={socials.website} label="🌐 Website" />}
                  {socials.x && <SocialLink href={socials.x.startsWith("http") ? socials.x : `https://x.com/${socials.x}`} label="𝕏" />}
                  {socials.github && <SocialLink href={socials.github.startsWith("http") ? socials.github : `https://github.com/${socials.github}`} label="GitHub" />}
                  {socials.linkedin && <SocialLink href={socials.linkedin.startsWith("http") ? socials.linkedin : `https://linkedin.com/in/${socials.linkedin}`} label="LinkedIn" />}
                  {socials.youtube && <SocialLink href={socials.youtube} label="▶ YouTube" />}
                  {socials.discord && <SocialLink href={socials.discord} label="💬 Discord" />}
                  {profile?.schedulingUrl && <SocialLink href={profile.schedulingUrl} label="📅 Book a demo" />}
                </div>
              </div>

              <div className="shrink-0 sm:ml-auto">
                <MessageButton
                  sellerUid={uid}
                  sellerName={name}
                  serviceId=""
                  serviceName="General inquiry"
                />
              </div>
            </div>
          </div>

          {/* trust score */}
          <div className="shadow-soft mt-5 rounded-[20px] border border-hairline bg-white p-7">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <div className="text-[13px] font-semibold uppercase tracking-[.05em] text-muted">Trust score</div>
                <div className="mt-1 flex items-baseline gap-3">
                  <span className="grad-text text-[52px] font-extrabold leading-none tracking-[-.04em]">{score}</span>
                  <span className="text-[15px] font-semibold text-muted">/ 100 · {label}</span>
                </div>
              </div>
            </div>
            <div className="mt-5 h-[8px] w-full overflow-hidden rounded-full bg-base2">
              <div className="grad h-full rounded-full transition-all" style={{ width: `${score}%` }} />
            </div>
            <p className="mt-3 text-[13px] text-muted">
              Computed from identity verification + calls served + revenue earned + tenure on Obol.
            </p>
          </div>
        </div>
      </section>

      {/* metrics row */}
      <section className="py-10">
        <div className="mx-auto max-w-[1180px] px-6">
          <div className="grid gap-5 sm:grid-cols-3">
            <Stat label="Calls served" value={String(seller.calls)} sub="all time" />
            <Stat label="Total earned" value={`$${seller.earned} USDC`} sub="settled by Gateway" accent />
            <Stat label="Active listings" value={String(services.length)} sub="in the directory" />
          </div>


          {/* AI view of listings */}
          {services.length > 0 && (
            <div className="mt-8 shadow-soft rounded-[20px] border border-hairline bg-white p-7">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[11px] font-bold uppercase tracking-[.06em] text-primary bg-[rgba(109,94,246,.1)] px-2.5 py-1 rounded-full">AI view</span>
                <h2 className="text-[18px] font-bold tracking-[-.02em]">How agents see these listings</h2>
              </div>
              <p className="text-[13px] text-muted mb-5">This is the structured skill info an AI agent reads to discover, pay for, and call each API automatically.</p>
              <div className="space-y-4">
                {services.map(s => (
                  <div key={s.id} className="rounded-[14px] border border-hairline bg-base2 p-5">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-[13px] font-bold text-ink">{s.name}</span>
                          <span className="rounded-full bg-white border border-hairline px-2 py-0.5 text-[11px] text-muted">{s.category}</span>
                        </div>
                        <p className="mt-1 text-[13px] text-[#3a3a48] max-w-[520px]">{s.description}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="font-mono text-[15px] font-extrabold">${s.priceUsdc}<span className="text-[11px] font-normal text-muted"> /call</span></div>
                      </div>
                    </div>
                    {s.inputSchema && (
                      <div className="mt-3 font-mono text-[12px] text-muted bg-white rounded-[8px] border border-hairline px-3 py-2">
                        <span className="text-[10px] uppercase tracking-[.05em] text-primary font-semibold mr-2">Input</span>{s.inputSchema}
                      </div>
                    )}
                    {(s.endpoints?.length ?? 0) > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {s.endpoints!.map((ep, i) => (
                          <span key={i} className="font-mono text-[11px] bg-white border border-hairline rounded-[6px] px-2 py-1 text-ink">{ep.path}</span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* listings */}
          <div className="mt-10">
            <h2 className="text-[22px] font-bold tracking-[-.02em]">Listings</h2>
            {services.length === 0 ? (
              <div className="mt-4">
                <div className="shadow-soft rounded-[18px] border border-dashed border-hairline bg-white p-10 text-center text-[14px] text-muted mb-4">
                  No active listings yet.
                </div>
                {/* Ghost example card showing what a listing looks like */}
                <div className="opacity-40 pointer-events-none">
                  <div className="text-[11px] font-semibold uppercase tracking-[.08em] text-muted mb-3">Example listing preview</div>
                  <div className="shadow-soft rounded-[18px] border border-dashed border-hairline bg-white p-6 max-w-[360px]">
                    <div className="flex items-start justify-between">
                      <div className="grad flex h-11 w-11 items-center justify-center rounded-[12px] text-[15px] font-extrabold text-white">
                        {initials(name || "My")}
                      </div>
                      <span className="rounded-full bg-base2 px-3 py-1 text-[12px] font-semibold text-muted">AI</span>
                    </div>
                    <h3 className="mt-4 text-[19px] font-bold tracking-[-.02em]">My API Service</h3>
                    <p className="mt-2 text-[14px] text-muted">A short description of what your API does for agents.</p>
                    <div className="mt-4 flex items-center justify-between border-t border-hairline pt-4">
                      <div>
                        <span className="text-[18px] font-extrabold">$0.001</span>
                        <span className="text-[13px] text-muted"> / call</span>
                      </div>
                      <span className="text-[13px] font-semibold text-primary">View endpoints →</span>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="mt-4 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
                {services.map((s) => (
                  <Link
                    key={s.id}
                    href={`/service/${s.id}`}
                    className="shadow-soft group rounded-[18px] border border-hairline bg-white p-6 transition hover:-translate-y-1 hover:shadow-lg2"
                  >
                    <div className="flex items-start justify-between">
                      <div className="grad flex h-11 w-11 items-center justify-center rounded-[12px] text-[15px] font-extrabold text-white">{initials(s.name)}</div>
                      <span className="rounded-full bg-base2 px-3 py-1 text-[12px] font-semibold text-muted">{s.category || "Other"}</span>
                    </div>
                    <h3 className="mt-4 text-[19px] font-bold tracking-[-.02em]">{s.name}</h3>
                    <p className="mt-2 min-h-[42px] text-[14px] leading-[1.55] text-[#3a3a48]">{s.description}</p>
                    {(() => {
                      const n = s.endpoints?.length ?? 0;
                      return (
                        <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px]">
                          {n > 0 ? (
                            <span className="rounded-full bg-base2 px-2.5 py-1 font-semibold text-muted">
                              {n} endpoint{n === 1 ? "" : "s"}
                            </span>
                          ) : s.openapiUrl ? (
                            <span className="rounded-full bg-[rgba(109,94,246,.12)] px-2.5 py-1 font-semibold text-primary">
                              OpenAPI spec
                            </span>
                          ) : (
                            <span className="rounded-full bg-base2 px-2.5 py-1 font-semibold text-muted">
                              Single endpoint
                            </span>
                          )}
                        </div>
                      );
                    })()}
                    <div className="mt-4 flex items-center justify-between border-t border-hairline pt-4">
                      <div>
                        <span className="text-[18px] font-extrabold">${s.priceUsdc}</span>
                        <span className="text-[13px] text-muted"> / call</span>
                      </div>
                      <span className="text-[13px] font-semibold text-primary group-hover:underline">View endpoints →</span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* recent activity */}
          <div className="shadow-soft mt-10 rounded-[18px] border border-hairline bg-white p-7">
            <h2 className="text-[18px] font-bold tracking-[-.02em]">Recent activity</h2>
            <div className="mt-4 overflow-hidden rounded-[12px] border border-hairline">
              <div className="grid grid-cols-4 gap-2 bg-base2 px-5 py-3 text-[12.5px] font-semibold uppercase tracking-[.04em] text-muted">
                <div>From</div><div>Amount</div><div>Status</div><div>Receipt</div>
              </div>
              {seller.recent.length === 0 ? (
                <div className="px-5 py-10 text-center text-[14px] text-muted">
                  No paid calls yet for this seller.
                </div>
              ) : (
                <div className="max-h-[480px] overflow-y-auto">
                  {seller.recent.slice(0, 20).map((r, i) => (
                    <div key={(r.explorer || "") + i} className="grid grid-cols-4 gap-2 border-t border-hairline px-5 py-3 text-[14px]">
                      <div className="font-mono text-[13px]">{short(r.from)}</div>
                      <div>${r.amount}</div>
                      <div className="text-muted">{r.status}</div>
                      {r.explorer ? (
                        <a href={r.explorer} target="_blank" rel="noreferrer" className="truncate text-primary hover:underline">Receipt ↗</a>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Reviews — infinite upward scroll, at bottom */}
          {(() => {
            const reviews = sellerReviews.length > 0 ? sellerReviews : TEMPLATE_REVIEWS;
            const doubled = [...reviews, ...reviews];
            const dur = reviews.length * 3;
            return (
              <div className="shadow-soft mt-10 rounded-[20px] border border-hairline bg-white p-7">
                <h2 className="text-[18px] font-bold tracking-[-.02em] mb-5">What buyers say</h2>
                <style>{`@keyframes scrollReviews{from{transform:translateY(0)}to{transform:translateY(-50%)}}`}</style>
                <div className="overflow-hidden rounded-[14px]" style={{height: 288}}>
                  <div style={{animation:`scrollReviews ${dur}s linear infinite`}}>
                    {doubled.map((r, i) => {
                      const rp = reviewerProfiles.get(r.uid);
                      const rpName = TEMPLATE_NAMES[r.uid] || rp?.companyName || (rp?.username ? `@${rp.username}` : null) || rp?.displayName || "User";
                      const rpAvatar = rp?.logoUrl || rp?.avatarUrl;
                      const rpInitials = rpName.slice(0,2).toUpperCase();
                      return (
                        <div key={i} className="rounded-[14px] border border-hairline bg-base2 p-5 mb-3">
                          <div className="flex items-start gap-3">
                            {rpAvatar
                              ? <img src={rpAvatar} alt={rpName} className="h-9 w-9 shrink-0 rounded-full object-cover border border-hairline" />
                              : <div className="grad flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[12px] font-bold text-white">{rpInitials}</div>
                            }
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap mb-1">
                                <span className="text-[13px] font-semibold text-ink">{rpName}</span>
                                <div className="flex gap-0.5">
                                  {[1,2,3,4,5].map(s => (
                                    <svg key={s} width="12" height="12" viewBox="0 0 24 24"
                                      fill={s <= r.stars ? "#f59e0b" : "none"}
                                      stroke={s <= r.stars ? "#f59e0b" : "#d1d5db"} strokeWidth="2">
                                      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                                    </svg>
                                  ))}
                                </div>
                              </div>
                              {r.comment && <p className="text-[14px] leading-[1.55] text-[#3a3a48]">&ldquo;{r.comment}&rdquo;</p>}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}

function SocialLink({ href, label }: { href: string; label: string }) {
  const url = /^https?:\/\//.test(href) ? href : `https://${href}`;
  return (
    <a href={url} target="_blank" rel="noreferrer" className="font-medium text-primary hover:underline">
      {label} ↗
    </a>
  );
}

function Stat({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className="shadow-soft rounded-[16px] border border-hairline bg-white p-6">
      <div className="text-[13px] font-semibold uppercase tracking-[.05em] text-muted">{label}</div>
      <div className={`mt-2 text-[32px] font-extrabold tracking-[-.03em] ${accent ? "grad-text" : ""}`}>{value}</div>
      {sub && <div className="mt-1 text-[13px] text-success">{sub}</div>}
    </div>
  );
}
