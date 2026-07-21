"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import SiteNav from "@/components/SiteNav";
import SiteFooter from "@/components/SiteFooter";
import MessageButton from "@/components/MessageButton";
import { useAuth } from "@/components/AuthProvider";
import { getServiceById, getProfile, type Service, type ObolProfile, type ServiceEndpoint } from "@/lib/clientStore";
import { DEMO_SERVICES } from "@/lib/demo-services";
import { getServiceRatings, getUserRating, rateService, type RatingSummary, type Rating } from "@/lib/ratings";
import { parseOpenApiToEndpoints } from "@/lib/openapi";

const initials = (name: string) =>
  name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase() || "OB";

/** Dark code block — matches the docs page aesthetic. */
function Code({ children }: { children: string }) {
  return (
    <pre className="mt-4 overflow-x-auto rounded-[12px] border border-hairline bg-[#0b0b12] p-5 text-[13px] leading-relaxed text-[#e6e6f0]">
      {children}
    </pre>
  );
}

/** Build a sample query string from the service's input schema (best-effort). */
function sampleQuery(inputSchema: string): string {
  if (!inputSchema) return "";
  const parts = inputSchema
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((p) => {
      const name = p.split(":")[0].trim().replace(/["'{}]/g, "");
      if (!name) return null;
      return `${name}=<${name}>`;
    })
    .filter(Boolean);
  return parts.join("&");
}

function StarRow({ avg, count }: { avg: number; count: number }) {
  const full = Math.round(avg);
  return (
    <div className="flex items-center gap-1.5">
      {[1, 2, 3, 4, 5].map((s) => (
        <svg
          key={s}
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill={s <= full ? "#f59e0b" : "none"}
          stroke={s <= full ? "#f59e0b" : "#d1d5db"}
          strokeWidth="2"
        >
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
      ))}
      <span className="text-[12px] text-muted">
        {count === 0 ? "No ratings yet" : `${avg.toFixed(1)} (${count})`}
      </span>
    </div>
  );
}

function SocialChip({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-1.5 rounded-[8px] border border-hairline px-3 py-1.5 text-[13px] font-medium text-muted hover:border-primary hover:text-primary transition"
    >
      {label} ↗
    </a>
  );
}

export default function ServicePage(_: { params: Promise<{ id: string }> }) {
  const { user } = useAuth();
  const [id, setId] = useState("");
  const [service, setService] = useState<Service | null>(null);
  const [seller, setSeller] = useState<ObolProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [specEndpoints, setSpecEndpoints] = useState<ServiceEndpoint[]>([]);
  const [ratings, setRatings] = useState<RatingSummary | null>(null);
  const [reviewerProfiles, setReviewerProfiles] = useState<Map<string, ObolProfile>>(new Map());
  // Review carousel
  const [carouselIdx, setCarouselIdx] = useState(0);
  const carouselTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  // Rate modal
  const [rateOpen, setRateOpen] = useState(false);
  const [rateStars, setRateStars] = useState(5);
  const [rateComment, setRateComment] = useState("");
  const [rateSaving, setRateSaving] = useState(false);
  const [rateDone, setRateDone] = useState(false);

  // Report modal
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState("prompt-injection");
  const [reportDesc, setReportDesc] = useState("");
  const [reportEvidence, setReportEvidence] = useState("");
  const [reportSaving, setReportSaving] = useState(false);
  const [reportDone, setReportDone] = useState(false);

  // window.location.pathname is the only reliable URL source in a static export
  // served via Firebase rewrites (/service/foo → /service/_/index.html).
  // useParams() and usePathname() both return the shell param "_", not the real path.
  useEffect(() => {
    const real = window.location.pathname.split("/service/")[1]?.split("/")[0] ?? "";
    setId(real);
  }, []);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    setLoading(true);
    setSpecEndpoints([]);
    setRatings(null);

    // Handle static demo services
    if (id.startsWith("demo-")) {
      const demo = DEMO_SERVICES[id];
      if (demo) {
        setService({
          id: demo.id,
          ownerUid: "",
          name: demo.name,
          slug: demo.id,
          category: demo.category,
          description: demo.description,
          priceUsdc: demo.priceUsdc,
          payoutAddress: "",
          hostedUrl: demo.hostedUrl,
          inputSchema: demo.inputSchema,
          docsUrl: demo.docsUrl,
          endpoints: demo.endpoints,
          skillMarkdown: "",
          openapiUrl: "",
          active: true,
          createdAt: 0,
        });
        setSeller({
          displayName: demo.sellerName,
          bio: demo.sellerBio,
          socials: {
            website: demo.sellerWebsite,
            x: demo.sellerX,
            github: demo.sellerGithub,
          },
        } as ObolProfile);
        const demoRatings = { avg: 4.8, count: 10, disputes: 0, recent: [
          { serviceId: id, uid: "__alex_chen__", stars: 5, comment: "Saved us hours of manual lookups — incredibly accurate.", dispute: false, ts: Date.now() - 86400000 * 1 },
          { serviceId: id, uid: "__maria_s__", stars: 4, comment: "Fast and reliable. Dropped straight into our agent pipeline.", dispute: false, ts: Date.now() - 86400000 * 3 },
          { serviceId: id, uid: "__jordan_k__", stars: 5, comment: "Best enrichment API we've tried. Agent-ready out of the box.", dispute: false, ts: Date.now() - 86400000 * 5 },
          { serviceId: id, uid: "__priya_v__", stars: 5, comment: "Zero setup friction. Had agents calling it within 10 minutes.", dispute: false, ts: Date.now() - 86400000 * 7 },
          { serviceId: id, uid: "__tom_w__", stars: 5, comment: "Solid latency, clean JSON. Will be using this long-term.", dispute: false, ts: Date.now() - 86400000 * 9 },
          { serviceId: id, uid: "__sara_m__", stars: 5, comment: "Replaced three vendors with one Obol integration. Huge win.", dispute: false, ts: Date.now() - 86400000 * 11 },
          { serviceId: id, uid: "__dev_ops__", stars: 4, comment: "Pay-per-call pricing is a game changer for our cost model.", dispute: false, ts: Date.now() - 86400000 * 13 },
          { serviceId: id, uid: "__buildco__", stars: 5, comment: "Very responsive. Answered questions within the hour.", dispute: false, ts: Date.now() - 86400000 * 15 },
          { serviceId: id, uid: "__ai_lab__", stars: 5, comment: "Exactly what autonomous agents need — metered, fast, trustless.", dispute: false, ts: Date.now() - 86400000 * 17 },
          { serviceId: id, uid: "__k_huang__", stars: 5, comment: "Our whole team switched. USDC settlement is seamless.", dispute: false, ts: Date.now() - 86400000 * 20 },
        ] };
        setRatings(demoRatings);
        if (carouselTimer.current) clearInterval(carouselTimer.current);
        const demoPages = Math.ceil(demoRatings.recent.length / 3);
        carouselTimer.current = setInterval(() => setCarouselIdx(x => (x + 1) % demoPages), 4000);
      }
      setLoading(false);
      return;
    }

    getServiceById(id)
      .then(async (svc) => {
        if (!alive) return;
        setService(svc);
        if (svc?.ownerUid) {
          const p = await getProfile(svc.ownerUid);
          if (alive) setSeller(p);
        }
        if (svc?.openapiUrl && !(svc.endpoints && svc.endpoints.length)) {
          const parsed = await parseOpenApiToEndpoints(svc.openapiUrl);
          if (alive) setSpecEndpoints(parsed);
        }
        const r = await getServiceRatings(id);
        if (alive) {
          setRatings(r);
          if (carouselTimer.current) clearInterval(carouselTimer.current);
          const pages = Math.ceil(r.recent.length / 3);
          if (pages > 1) carouselTimer.current = setInterval(() => setCarouselIdx(x => (x + 1) % pages), 4000);
          const uids = [...new Set(r.recent.map(rv => rv.uid))];
          const profiles = await Promise.all(uids.map(u => getProfile(u).catch(() => null)));
          const map = new Map<string, ObolProfile>();
          uids.forEach((u, i) => { if (profiles[i]) map.set(u, profiles[i]!); });
          setReviewerProfiles(map);
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [id]);

  if (loading) {
    return (
      <main className="flex min-h-screen flex-col">
        <SiteNav />
        <section className="flex flex-1 items-center justify-center text-muted">
          Loading service…
        </section>
        <SiteFooter />
      </main>
    );
  }

  if (!service) {
    return (
      <main className="flex min-h-screen flex-col">
        <SiteNav />
        <section className="mx-auto flex flex-1 flex-col items-center justify-center max-w-[900px] px-6 py-24 text-center">
          <div className="mb-3 text-[13px] font-bold uppercase tracking-[.08em] text-primary">404</div>
          <h1 className="text-[32px] font-extrabold tracking-[-.03em]">Service not found</h1>
          <p className="mx-auto mt-3 max-w-[460px] text-[16px] text-muted">
            This listing doesn&apos;t exist or is no longer available.
          </p>
          <Link
            href="/marketplace"
            className="grad mt-6 inline-flex rounded-[10px] px-5 py-3 text-[15px] font-semibold text-white shadow-[0_4px_14px_rgba(109,94,246,.35)]"
          >
            ← Back to marketplace
          </Link>
        </section>
        <SiteFooter />
      </main>
    );
  }

  const listedEndpoints = service.endpoints && service.endpoints.length ? service.endpoints : [];
  const endpoints: ServiceEndpoint[] = listedEndpoints.length ? listedEndpoints : specEndpoints;
  const endpointsFromSpec = !listedEndpoints.length && specEndpoints.length > 0;

  const agentReady = !!(
    service.inputSchema ||
    service.docsUrl ||
    service.openapiUrl ||
    service.skillMarkdown ||
    endpoints.length
  );

  const sellerName =
    seller?.displayName ||
    (service.payoutAddress
      ? service.payoutAddress.slice(0, 6) + "…" + service.payoutAddress.slice(-4)
      : "anonymous");

  const qs = sampleQuery(service.inputSchema);
  const callUrl = service.hostedUrl + (qs ? (service.hostedUrl.includes("?") ? "&" : "?") + qs : "");
  const socials = seller?.socials ?? {};

  return (
    <main>
      <SiteNav />

      {/* Full-width hero */}
      <section className="border-b border-hairline bg-white py-12">
        <div className="mx-auto max-w-[1180px] px-6">
          <Link href="/marketplace" className="text-[14px] font-medium text-muted hover:text-ink">
            ← Back to marketplace
          </Link>

          {/* Title row: icon + name + badges + message button all on one line */}
          <div className="mt-6 flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-4 flex-wrap">
              <div className="grad flex h-14 w-14 shrink-0 items-center justify-center rounded-[14px] text-[18px] font-extrabold text-white">
                {initials(service.name)}
              </div>
              <h1 className="text-[34px] font-extrabold tracking-[-.03em]">{service.name}</h1>
              <span className="rounded-full bg-base2 px-3 py-1 text-[12px] font-semibold text-muted">
                {service.category || "Other"}
              </span>
              {agentReady && (
                <span className="rounded-full bg-[rgba(109,94,246,.12)] px-2.5 py-1 text-[11px] font-bold uppercase tracking-[.04em] text-primary">
                  Agent-ready
                </span>
              )}
              <SafetyBadge safety={(service as unknown as { safety?: { verdict?: string; flags?: string[] } }).safety} />
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => { setReportDone(false); setReportOpen(true); }}
                className="flex items-center gap-1.5 rounded-[8px] border border-hairline px-3 py-1.5 text-[13px] font-medium text-muted transition hover:border-red-400 hover:text-red-600"
                title="Report this service as unsafe or fraudulent"
              >
                Report
              </button>
              <MessageButton
                sellerUid={service.ownerUid}
                sellerName={sellerName}
                serviceId={id}
                serviceName={service.name}
                schedulingUrl={seller?.schedulingUrl}
              />
            </div>
          </div>

          {/* Byline + description + price */}
          <div className="mt-4 flex flex-wrap items-center gap-2 text-[14px] text-muted">
            <span>by</span>
            <Link
              href={`/seller/${service.ownerUid}`}
              className="flex items-center gap-2 font-semibold text-ink hover:text-primary"
            >
              {seller?.avatarUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={seller.avatarUrl} alt="" className="h-5 w-5 rounded-full object-cover" />
              )}
              {sellerName}
            </Link>
          </div>

          {service.description && (
            <p className="mt-4 max-w-[680px] text-[17px] leading-[1.55] text-[#3a3a48]">
              {service.description}
            </p>
          )}

          <div className="mt-5 inline-flex items-baseline gap-1 rounded-[12px] border border-hairline bg-white px-4 py-2 shadow-soft">
            <span className="text-[22px] font-extrabold">${service.priceUsdc}</span>
            <span className="text-[13px] text-muted"> / call</span>
          </div>
        </div>
      </section>

      {/* Two-column content */}
      <section className="mx-auto max-w-[1180px] px-6 py-12">
        <div className={`grid gap-10 ${service.ownerUid ? "lg:grid-cols-[1fr_300px]" : "max-w-[780px] mx-auto"}`}>
          {/* Main content column */}
          <div>
            <h2 className="text-[26px] font-extrabold tracking-[-.03em]">What this API offers</h2>
            <p className="mt-2 text-[15px] text-muted">
              This listing is a self-describing skill: the endpoints, pricing, and docs below tell an
              agent exactly how to pay for and call the API over Obol.
            </p>

            {(service.openapiUrl || service.docsUrl) && (
              <div className="mt-7 flex flex-wrap gap-3">
                {service.openapiUrl && (
                  <a
                    href={service.openapiUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-2 rounded-[10px] border border-hairline bg-white px-4 py-2.5 text-[14px] font-semibold text-ink shadow-soft hover:bg-base2"
                  >
                    <span className="rounded-full bg-[rgba(109,94,246,.12)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[.04em] text-primary">
                      Spec
                    </span>
                    OpenAPI spec — agent-ready ↗
                  </a>
                )}
                {service.docsUrl && (
                  <a
                    href={service.docsUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-[10px] border border-hairline bg-white px-4 py-2.5 text-[14px] font-semibold text-ink shadow-soft hover:bg-base2"
                  >
                    Docs ↗
                  </a>
                )}
              </div>
            )}

            {endpoints.length > 0 ? (
              <div className="mt-7 shadow-soft overflow-hidden rounded-[18px] border border-hairline bg-white">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline px-6 py-4">
                  <div className="text-[12px] font-semibold uppercase tracking-[.05em] text-muted">
                    Endpoints &amp; pricing
                  </div>
                  <div className="flex items-center gap-2 text-[12px] text-muted">
                    <span className="font-semibold text-ink">{endpoints.length}</span>
                    <span>endpoint{endpoints.length === 1 ? "" : "s"}</span>
                    {endpointsFromSpec && (
                      <span className="rounded-full bg-base2 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[.04em] text-muted">
                        from OpenAPI spec
                      </span>
                    )}
                  </div>
                </div>
                <div className="overflow-x-auto px-6 py-2">
                  <table className="w-full border-collapse text-left text-[14px]">
                    <thead>
                      <tr className="border-b border-hairline text-[12px] uppercase tracking-[.04em] text-muted">
                        <th className="py-3 pr-4 font-semibold">Endpoint</th>
                        <th className="py-3 pr-4 font-semibold">Description</th>
                        <th className="py-3 text-right font-semibold">Price / call</th>
                      </tr>
                    </thead>
                    <tbody>
                      {endpoints.map((ep, i) => (
                        <tr key={ep.path + i} className="border-b border-hairline last:border-0 align-top">
                          <td className="py-3 pr-4">
                            <div className="font-mono text-[13px] font-semibold text-ink">{ep.path}</div>
                            {ep.params && (
                              <div className="mt-1 font-mono text-[12px] text-muted">{ep.params}</div>
                            )}
                          </td>
                          <td className="py-3 pr-4 text-[#3a3a48]">{ep.description || "—"}</td>
                          <td className="whitespace-nowrap py-3 text-right font-semibold">
                            ${ep.priceUsdc}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : service.openapiUrl ? (
              <div className="mt-7 shadow-soft rounded-[18px] border border-hairline bg-white p-6 text-[14px] text-muted">
                <span className="font-semibold text-ink">Agent-readable spec attached.</span>{" "}
                An OpenAPI spec is linked above — agents can read it directly to discover every endpoint.
                Flat rate of <span className="font-semibold text-ink">${service.priceUsdc}</span> per call.
              </div>
            ) : null}

            {service.inputSchema && (
              <div className="mt-7 shadow-soft rounded-[18px] border border-hairline bg-white p-6">
                <div className="text-[12px] font-semibold uppercase tracking-[.05em] text-muted">
                  Input parameters
                </div>
                <pre className="mt-3 overflow-x-auto whitespace-pre-wrap rounded-[12px] border border-hairline bg-base2 p-4 text-[14px] leading-relaxed text-ink">
                  {service.inputSchema}
                </pre>
              </div>
            )}

            {service.skillMarkdown && (
              <div className="mt-7 shadow-soft rounded-[18px] border border-hairline bg-white p-6">
                <div className="text-[12px] font-semibold uppercase tracking-[.05em] text-muted">
                  Skill doc
                </div>
                <div className="mt-3 whitespace-pre-wrap rounded-[12px] border border-hairline bg-base2 p-5 text-[14px] leading-[1.6] text-ink">
                  {service.skillMarkdown}
                </div>
              </div>
            )}

            <h2 className="mt-10 text-[26px] font-extrabold tracking-[-.03em]">Call it</h2>
            <p className="mt-2 text-[15px] text-muted">
              Your agent pays per call in USDC on Arc — no account, no API key. One coin, one call.
            </p>
            <Code>{`import { obolBuyer } from "@obol/sdk";

const buyer = obolBuyer(process.env.AGENT_KEY);
const { data } = await buyer.pay("${callUrl}");`}</Code>
          </div>

          {/* Seller sidebar — real services only */}
          {service.ownerUid && <div className="lg:sticky lg:top-[90px] lg:self-start space-y-4">
            <div className="rounded-[18px] border border-hairline bg-white p-6 shadow-soft">
              {/* Seller info */}
              <div className="flex items-center gap-3">
                {(seller?.logoUrl || seller?.avatarUrl) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={seller.logoUrl || seller.avatarUrl!}
                    alt={sellerName}
                    className="h-12 w-12 shrink-0 rounded-[12px] border border-hairline object-cover"
                  />
                ) : (
                  <div className="grad flex h-12 w-12 shrink-0 items-center justify-center rounded-[12px] text-[15px] font-extrabold text-white">
                    {initials(sellerName)}
                  </div>
                )}
                <div className="min-w-0">
                  <Link
                    href={`/seller/${service.ownerUid}`}
                    className="block truncate text-[15px] font-bold text-ink hover:text-primary"
                  >
                    {sellerName}
                  </Link>
                  {seller?.bio && (
                    <p className="mt-0.5 line-clamp-2 text-[12.5px] text-muted">{seller.bio}</p>
                  )}
                </div>
              </div>


            </div>

          </div>}

          {/* Reviews section — bottom of page */}
          {ratings !== null && (
            <div className="mt-10 rounded-[20px] border border-hairline bg-white p-7 shadow-soft">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-[20px] font-bold tracking-[-.02em]">Reviews</h2>
                  {ratings.count > 0 && (
                    <div className="flex items-center gap-2 mt-1">
                      <div className="flex gap-0.5">
                        {[1,2,3,4,5].map(s => (
                          <svg key={s} width="14" height="14" viewBox="0 0 24 24"
                            fill={s <= Math.round(ratings.avg) ? "#f59e0b" : "none"}
                            stroke={s <= Math.round(ratings.avg) ? "#f59e0b" : "#d1d5db"} strokeWidth="2">
                            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                          </svg>
                        ))}
                      </div>
                      <span className="text-[14px] font-semibold">{ratings.avg.toFixed(1)}</span>
                      <span className="text-[13px] text-muted">({ratings.count} review{ratings.count !== 1 ? "s" : ""})</span>
                    </div>
                  )}
                </div>
                <button
                  onClick={async () => {
                    if (user && id) {
                      const existing = await getUserRating(id, user.uid).catch(() => null);
                      if (existing) { setRateStars(existing.stars); setRateComment(existing.comment || ""); }
                      else { setRateStars(5); setRateComment(""); }
                    }
                    setRateDone(false); setRateOpen(true);
                  }}
                  className="grad rounded-[10px] px-4 py-2 text-[13px] font-semibold text-white"
                >
                  ★ Write a review
                </button>
              </div>
              {ratings.recent.length === 0 ? (
                <div className="text-center py-8 text-[14px] text-muted">
                  No reviews yet — be the first to share your experience.
                </div>
              ) : (() => {
                const TNAMES: Record<string,string> = { "__alex_chen__": "Alex Chen", "__maria_s__": "Maria S.", "__jordan_k__": "Jordan K.", "__priya_v__": "Priya V.", "__tom_w__": "Tom W.", "__sara_m__": "Sara M.", "__dev_ops__": "DevOps Lab", "__buildco__": "BuildCo", "__ai_lab__": "AI Lab", "__k_huang__": "K. Huang" };
                const doubled = [...ratings.recent, ...ratings.recent];
                const dur = ratings.recent.length * 3;
                return (
                  <div className="overflow-hidden rounded-[14px]" style={{height: 288}}>
                    <style>{`@keyframes scrollReviews{from{transform:translateY(0)}to{transform:translateY(-50%)}}`}</style>
                    <div style={{animation:`scrollReviews ${dur}s linear infinite`}}>
                      {doubled.map((r, i) => {
                        const rp = reviewerProfiles.get(r.uid);
                        const rpName = TNAMES[r.uid] || rp?.companyName || (rp?.username ? `@${rp.username}` : null) || rp?.displayName || r.uid.slice(0,8);
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
                                {r.comment
                                  ? <p className="text-[14px] leading-[1.55] text-[#3a3a48]">&ldquo;{r.comment}&rdquo;</p>
                                  : <p className="text-[13px] text-muted italic">No comment.</p>}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          {/* Rate modal */}
          {rateOpen && (
            <div className="fixed inset-0 z-[999] flex items-end justify-center bg-black/40 p-4 sm:items-center"
              onClick={e => { if (e.target === e.currentTarget) setRateOpen(false); }}>
              <div className="w-full max-w-[440px] rounded-[20px] border border-hairline bg-white p-7 shadow-[0_20px_60px_rgba(0,0,0,.18)]">
                <div className="flex items-start justify-between mb-5">
                  <div>
                    <div className="text-[18px] font-bold tracking-[-.02em]">Rate {service?.name}</div>
                    <div className="text-[13px] text-muted mt-0.5">Your review — edit anytime</div>
                  </div>
                  <button onClick={() => setRateOpen(false)} className="rounded-full p-1.5 text-muted hover:bg-base2">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
                  </button>
                </div>
                {rateDone ? (
                  <div className="rounded-[12px] bg-[rgba(21,194,107,.12)] p-5 text-center text-[15px] font-semibold text-success">
                    Review saved!
                  </div>
                ) : (
                  <>
                    <div className="flex justify-center gap-2 mb-5">
                      {[1,2,3,4,5].map(s => (
                        <button key={s} onClick={() => setRateStars(s)}>
                          <svg width="32" height="32" viewBox="0 0 24 24"
                            fill={s <= rateStars ? "#f59e0b" : "none"}
                            stroke={s <= rateStars ? "#f59e0b" : "#d1d5db"} strokeWidth="2">
                            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                          </svg>
                        </button>
                      ))}
                    </div>
                    <textarea
                      value={rateComment}
                      onChange={e => setRateComment(e.target.value)}
                      placeholder="Leave a comment (optional — you can add one later)"
                      rows={3}
                      className="w-full resize-none rounded-[12px] border border-hairline bg-white px-4 py-3 text-[14px] shadow-soft outline-none focus:border-primary"
                    />
                    <div className="mt-4 flex items-center justify-between">
                      <button onClick={() => setRateOpen(false)} className="text-[14px] font-medium text-muted hover:text-ink">Cancel</button>
                      <button
                        onClick={async () => {
                          if (!user) return;
                          setRateSaving(true);
                          try {
                            await rateService(user.uid, id, rateStars, rateComment, false);
                            const updated = await getServiceRatings(id);
                            setRatings(updated);
                            const uids2 = [...new Set(updated.recent.map(rv => rv.uid))];
                            const profs2 = await Promise.all(uids2.map(u => getProfile(u).catch(() => null)));
                            const map2 = new Map<string, ObolProfile>();
                            uids2.forEach((u, i) => { if (profs2[i]) map2.set(u, profs2[i]!); });
                            setReviewerProfiles(map2);
                            setCarouselIdx(0);
                            setRateDone(true);
                            setTimeout(() => { setRateOpen(false); setRateDone(false); }, 1500);
                          } catch { /* best-effort */ }
                          finally { setRateSaving(false); }
                        }}
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

          {/* Report modal */}
          {reportOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/50 p-4 backdrop-blur-sm"
              onClick={e => { if (e.target === e.currentTarget) setReportOpen(false); }}>
              <div className="my-auto w-full max-w-[460px] rounded-[18px] border border-hairline bg-white p-6 shadow-2xl">
                {reportDone ? (
                  <div className="py-6 text-center">
                    <div className="mb-2 text-[18px] font-bold">Report submitted ✓</div>
                    <p className="text-[14px] text-muted">Thanks — Obol re-scans flagged services automatically. Enough credible reports quarantine a service pending review.</p>
                    <button onClick={() => setReportOpen(false)} className="grad mt-5 rounded-[10px] px-5 py-2.5 text-[14px] font-semibold text-white">Done</button>
                  </div>
                ) : (
                  <>
                    <div className="mb-1 flex items-center justify-between">
                      <div className="text-[18px] font-bold tracking-[-.02em]">Report {service?.name}</div>
                      <button onClick={() => setReportOpen(false)} className="rounded-full p-1.5 text-muted hover:bg-base2">✕</button>
                    </div>
                    <p className="mb-4 text-[13px] text-muted">Flag this service if its response tried to hijack your agent, leak secrets, move funds, or behaved fraudulently.</p>

                    <label className="text-[12px] font-semibold uppercase tracking-[.05em] text-muted">Reason</label>
                    <select value={reportReason} onChange={e => setReportReason(e.target.value)}
                      className="mt-1 mb-3 w-full rounded-[10px] border border-hairline px-3 py-2.5 text-[14px] outline-none focus:border-primary">
                      <option value="prompt-injection">Prompt injection / tried to hijack my agent</option>
                      <option value="fund-theft">Tried to move funds / wallet</option>
                      <option value="secret-exfil">Tried to leak keys / secrets</option>
                      <option value="scam">Scam / doesn&apos;t do what it claims</option>
                      <option value="bait-and-switch">Price or behavior changed (bait-and-switch)</option>
                      <option value="other">Other</option>
                    </select>

                    <label className="text-[12px] font-semibold uppercase tracking-[.05em] text-muted">What happened?</label>
                    <textarea value={reportDesc} onChange={e => setReportDesc(e.target.value)} rows={3}
                      placeholder="Describe the issue…"
                      className="mt-1 mb-3 w-full resize-none rounded-[10px] border border-hairline px-3 py-2.5 text-[14px] outline-none focus:border-primary" />

                    <label className="text-[12px] font-semibold uppercase tracking-[.05em] text-muted">Evidence — paste the suspicious response (optional)</label>
                    <textarea value={reportEvidence} onChange={e => setReportEvidence(e.target.value)} rows={4}
                      placeholder="Paste the response text that looked malicious. This is scanned automatically."
                      className="mt-1 w-full resize-none rounded-[10px] border border-hairline px-3 py-2.5 font-mono text-[12px] outline-none focus:border-primary" />

                    <div className="mt-5 flex items-center justify-end gap-3">
                      <button onClick={() => setReportOpen(false)} className="text-[14px] font-medium text-muted hover:text-ink">Cancel</button>
                      <button
                        onClick={async () => {
                          setReportSaving(true);
                          try {
                            await fetch("/api/report", {
                              method: "POST", headers: { "content-type": "application/json" },
                              body: JSON.stringify({ serviceId: id, source: "human", reason: reportReason, description: reportDesc, evidence: reportEvidence }),
                            });
                            setReportDone(true);
                            setReportDesc(""); setReportEvidence("");
                          } catch { /* best-effort */ }
                          finally { setReportSaving(false); }
                        }}
                        disabled={reportSaving}
                        className="rounded-[10px] bg-red-600 px-5 py-2.5 text-[14px] font-semibold text-white transition hover:bg-red-700 disabled:opacity-60"
                      >
                        {reportSaving ? "Submitting…" : "Submit report"}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}

// Safety verdict badge shown on the listing so buyers see it before using.
function SafetyBadge({ safety }: { safety?: { verdict?: string; flags?: string[] } }) {
  const v = safety?.verdict;
  if (!v || v === "unknown") return null;
  if (v === "clean") {
    return <span className="rounded-full bg-green-100 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[.04em] text-green-700" title="Passed Obol's prompt-injection / hidden-content scan">Safety ✓</span>;
  }
  if (v === "suspicious") {
    return <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[.04em] text-amber-700" title={`Flagged: ${(safety?.flags || []).join(", ")}`}>⚠ Caution</span>;
  }
  return <span className="rounded-full bg-red-100 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[.04em] text-red-700" title={`Flagged: ${(safety?.flags || []).join(", ")}`}>⚠ Flagged</span>;
}
