"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import SiteNav from "@/components/SiteNav";
import { useAuth } from "@/components/AuthProvider";
import { createService, getProfile, type ServiceEndpoint } from "@/lib/clientStore";
import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";
import SkillUpload from "@/components/SkillUpload";

type EndpointRow = { path: string; priceUsdc: string; params: string; description: string };

const emptyEndpoint = (): EndpointRow => ({ path: "", priceUsdc: "", params: "", description: "" });

export default function NewServicePage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [walletLoading, setWalletLoading] = useState(true);
  const [provisioningWallet, setProvisioningWallet] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [endpoints, setEndpoints] = useState<EndpointRow[]>([]);
  const [f, setF] = useState({
    name: "",
    category: "Data",
    priceUsdc: "0.002",
    description: "",
    longDescription: "",
    hostedUrl: "",
    payoutAddress: "",
    inputSchema: "",
    docsUrl: "",
    openapiUrl: "",
    skillMarkdown: "",
    logoUrl: "",
  });

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [user, loading, router]);

  useEffect(() => {
    if (!user) return;
    getProfile(user.uid).then((p) => {
      const addr: string | null = p?.obolWalletAddress ?? p?.address ?? null;
      setWalletAddress(addr);
      if (addr) setF((prev) => ({ ...prev, payoutAddress: addr! }));
    }).finally(() => setWalletLoading(false));
  }, [user]);

  async function provisionWallet() {
    if (!user) return;
    setProvisioningWallet(true);
    setError(null);
    try {
      const fn = httpsCallable(functions, "provisionObolWallet");
      await fn({});
      const p = await getProfile(user.uid);
      const addr = p?.obolWalletAddress ?? p?.address ?? null;
      if (addr) {
        setWalletAddress(addr);
        setF((prev) => ({ ...prev, payoutAddress: addr }));
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setProvisioningWallet(false);
    }
  }

  const input =
    "w-full rounded-[10px] border border-hairline bg-white px-3.5 py-2.5 text-[14px] outline-none focus:border-primary";

  const set =
    (k: string) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setF((prev) => ({ ...prev, [k]: e.target.value }));

  const setEndpoint =
    (i: number, k: keyof EndpointRow) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setEndpoints((prev) => prev.map((row, idx) => (idx === i ? { ...row, [k]: e.target.value } : row)));

  const addEndpoint = () => setEndpoints((prev) => [...prev, emptyEndpoint()]);
  const removeEndpoint = (i: number) => setEndpoints((prev) => prev.filter((_, idx) => idx !== i));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    setError(null);
    if (!f.name.trim()) { setError("Service name is required"); return; }
    if (!f.priceUsdc || Number(f.priceUsdc) <= 0) { setError("A positive price is required"); return; }
    if (!/^0x[0-9a-fA-F]{40}$/.test(f.payoutAddress)) {
      setError("A valid payout address (0x…) is required"); return;
    }
    if (!/^https?:\/\//.test(f.hostedUrl)) {
      setError("A valid hosted URL (https://…) is required"); return;
    }
    setBusy(true);
    try {
      const cleaned: ServiceEndpoint[] = endpoints
        .filter((r) => r.path.trim())
        .map((r) => ({
          path: r.path.trim(),
          priceUsdc: r.priceUsdc.trim(),
          params: r.params.trim(),
          description: r.description.trim(),
        }));
      await createService(user.uid, {
        ...f,
        skillMarkdown: f.skillMarkdown || f.longDescription || "",
        endpoints: cleaned,
      });
      setSuccess(true);
      setTimeout(() => router.push("/dashboard"), 1500);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (loading || !user || walletLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted">Loading…</div>
    );
  }

  return (
    <div className="min-h-screen bg-base2">
      <SiteNav />
      <div className="mx-auto max-w-[760px] px-6 py-10">
        <div className="mb-6">
          <Link href="/dashboard" className="text-[14px] font-medium text-muted hover:text-ink">
            ← Back to dashboard
          </Link>
        </div>
        <h1 className="text-[30px] font-extrabold tracking-[-.03em]">List a new service</h1>
        <p className="mt-2 text-[15px] text-muted">
          Host your API with{" "}
          <code className="rounded bg-white px-1.5 py-0.5 text-[13px] border border-hairline">
            @obol/sdk
          </code>
          , then register it here so agents can discover and pay for it.
        </p>

        {!walletAddress && (
          <div className="mt-8 rounded-[18px] border border-amber-300 bg-amber-50 p-8 text-center">
            <div className="text-[32px]">🔑</div>
            <h2 className="mt-3 text-[20px] font-bold tracking-[-.02em]">Create your Obol wallet</h2>
            <p className="mt-2 text-[14px] text-muted">
              Payments from agents go directly to your self-custody wallet. You set a PIN — Obol never holds your keys.
            </p>
            <button
              onClick={provisionWallet}
              disabled={provisioningWallet}
              className="grad mt-6 rounded-[12px] px-6 py-3 text-[15px] font-semibold text-white disabled:opacity-60"
            >
              {provisioningWallet ? "Setting up…" : "Create my wallet →"}
            </button>
            {error && <p className="mt-3 text-[13px] text-red-600">{error}</p>}
            <p className="mt-4 text-[12px] text-muted">
              Payments settle directly to your self-custody wallet address.
            </p>
          </div>
        )}

        {walletAddress && success && (
          <div className="mt-8 rounded-[14px] bg-[rgba(21,194,107,.12)] p-6 text-center text-[15px] font-semibold text-success">
            Service listed! Taking you to your dashboard…
          </div>
        )}

        {walletAddress && !success && (
          <form
            onSubmit={submit}
            className="mt-8 grid gap-5 rounded-[18px] border border-hairline bg-white p-7 shadow-soft sm:grid-cols-2"
          >
            {/* Logo */}
            <div className="sm:col-span-2">
              <label className="mb-1 block text-[12px] font-semibold uppercase tracking-[.05em] text-muted">
                Logo / icon (optional)
              </label>
              <div className="flex items-center gap-3">
                {f.logoUrl ? (
                  <img src={f.logoUrl} alt="logo preview" className="h-12 w-12 rounded-[10px] border border-hairline object-cover bg-base2" onError={(e) => (e.currentTarget.style.display = "none")} />
                ) : (
                  <div className="grad flex h-12 w-12 shrink-0 items-center justify-center rounded-[10px] text-[18px] font-extrabold text-white">
                    {f.name ? f.name.slice(0, 2).toUpperCase() : "?"}
                  </div>
                )}
                <input
                  className={`${input} flex-1`}
                  placeholder="https://your-site.com/logo.png (or leave blank for initials)"
                  value={f.logoUrl}
                  onChange={set("logoUrl")}
                  type="url"
                />
              </div>
              <p className="mt-1 text-[12px] text-muted">Shown on your listing card in the marketplace. Upload to Imgur, GitHub, or any image host.</p>
            </div>

            {/* Basic info */}
            <div>
              <label className="mb-1 block text-[12px] font-semibold uppercase tracking-[.05em] text-muted">
                Service name *
              </label>
              <input
                className={input}
                placeholder="My Weather API"
                value={f.name}
                onChange={set("name")}
                required
              />
            </div>
            <div>
              <label className="mb-1 block text-[12px] font-semibold uppercase tracking-[.05em] text-muted">
                Category
              </label>
              <select className={input} value={f.category} onChange={set("category")}>
                {["Data", "Search", "AI", "Finance", "Other"].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-[12px] font-semibold uppercase tracking-[.05em] text-muted">
                Price per call (USDC) *
              </label>
              <input
                className={input}
                type="number"
                step="0.0001"
                min="0.0001"
                placeholder="0.002"
                value={f.priceUsdc}
                onChange={set("priceUsdc")}
                required
              />
            </div>
            <div>
              <label className="mb-1 block text-[12px] font-semibold uppercase tracking-[.05em] text-muted">
                Payout address *
              </label>
              <input
                className={input}
                placeholder="0x…"
                value={f.payoutAddress}
                onChange={set("payoutAddress")}
                required
              />
            </div>

            <div className="sm:col-span-2">
              <label className="mb-1 block text-[12px] font-semibold uppercase tracking-[.05em] text-muted">
                Hosted URL *
              </label>
              <input
                className={input}
                placeholder="https://my-api.example.com"
                value={f.hostedUrl}
                onChange={set("hostedUrl")}
                required
              />
              <p className="mt-1 text-[12px] text-muted">
                Where you run the Obol middleware (must be publicly reachable).
              </p>
            </div>

            <div className="sm:col-span-2">
              <label className="mb-1 block text-[12px] font-semibold uppercase tracking-[.05em] text-muted">
                Short description
              </label>
              <textarea
                className={`${input} resize-none`}
                rows={3}
                placeholder="What does your API do? What data does it return?"
                value={f.description}
                onChange={set("description")}
              />
            </div>

            {/* Per-endpoint pricing */}
            <div className="sm:col-span-2 border-t border-hairline pt-4">
              <div className="text-[12px] font-semibold uppercase tracking-[.05em] text-muted">
                Per-endpoint pricing
              </div>
              <p className="mt-1 text-[12.5px] text-muted">
                Leave empty for a single-endpoint API priced above. Add rows to price specific
                paths differently — no price means free for that path.
              </p>
            </div>
            {endpoints.map((row, i) => (
              <div
                key={i}
                className="sm:col-span-2 grid gap-2 rounded-[10px] border border-hairline bg-base2 p-3 sm:grid-cols-[1fr_1fr_auto]"
              >
                <input
                  className={input}
                  placeholder="Path, e.g. /forecast"
                  value={row.path}
                  onChange={setEndpoint(i, "path")}
                />
                <input
                  className={input}
                  placeholder="Price per call (empty = free)"
                  value={row.priceUsdc}
                  onChange={setEndpoint(i, "priceUsdc")}
                />
                <button
                  type="button"
                  onClick={() => removeEndpoint(i)}
                  className="rounded-[10px] border border-hairline bg-white px-3 py-2.5 text-[13px] font-semibold text-muted hover:bg-base2 hover:text-ink"
                >
                  Remove
                </button>
                <input
                  className={`${input} sm:col-span-3`}
                  placeholder="Params, e.g. lat: number, lon: number"
                  value={row.params}
                  onChange={setEndpoint(i, "params")}
                />
                <input
                  className={`${input} sm:col-span-3`}
                  placeholder="Endpoint description (optional)"
                  value={row.description}
                  onChange={setEndpoint(i, "description")}
                />
              </div>
            ))}
            <button
              type="button"
              onClick={addEndpoint}
              className="sm:col-span-2 rounded-[10px] border border-dashed border-hairline px-4 py-2.5 text-[13px] font-semibold text-muted hover:bg-base2 hover:text-ink"
            >
              + Add endpoint
            </button>

            {/* Long description */}
            <div className="sm:col-span-2 border-t border-hairline pt-4">
              <div className="text-[12px] font-semibold uppercase tracking-[.05em] text-muted">
                Full description / README
              </div>
              <p className="mt-1 text-[12.5px] text-muted">
                Markdown supported. Buyers and agents read this to understand exactly what your API does,
                what it returns, and when to use it.
              </p>
            </div>
            <div className="sm:col-span-2">
              <textarea
                className={`${input} resize-y min-h-[120px]`}
                rows={6}
                placeholder={`## What this API does\n\nDescribe the problem it solves...\n\n## Response format\n\nDescribe what data comes back...\n\n## Example use case\n\nGive a concrete agent workflow...`}
                value={f.skillMarkdown}
                onChange={set("skillMarkdown")}
              />
              <p className="mt-1 text-[12px] text-muted">
                This is shown on your listing page and also readable by AI agents via the Obol MCP server.
              </p>
            </div>

            {/* Agent skill */}
            <div className="sm:col-span-2 border-t border-hairline pt-4">
              <div className="text-[12px] font-semibold uppercase tracking-[.05em] text-muted">
                Agent-readiness — how agents discover and call your API
              </div>
              <p className="mt-1 text-[12.5px] text-muted">
                Fill in the input params so agents know how to call you. Upload an OpenAPI spec
                for full agent-readiness — agents will auto-discover your endpoints from it.
              </p>
            </div>
            <div>
              <label className="mb-1 block text-[12px] font-semibold uppercase tracking-[.05em] text-muted">
                Input params
              </label>
              <input
                className={input}
                placeholder="e.g. domain: string, language?: string"
                value={f.inputSchema}
                onChange={set("inputSchema")}
              />
              <p className="mt-1 text-[12px] text-muted">Simple type annotations — agents pass these as query params.</p>
            </div>
            <div>
              <label className="mb-1 block text-[12px] font-semibold uppercase tracking-[.05em] text-muted">
                External docs URL
              </label>
              <input
                className={input}
                placeholder="https://…/docs (optional)"
                value={f.docsUrl}
                onChange={set("docsUrl")}
              />
            </div>

            <div className="sm:col-span-2">
              <label className="mb-1.5 block text-[12px] font-semibold uppercase tracking-[.05em] text-muted">
                Upload skill file — OpenAPI spec or Markdown
              </label>
              <p className="mb-2 text-[12.5px] text-muted">
                <b className="text-ink">OpenAPI (.json/.yaml)</b> → shows "Agent-ready" badge; agents parse endpoints automatically.{" "}
                <b className="text-ink">Markdown (.md)</b> → shown inline on your listing so buyers and agents understand the API at a glance.
                Both are accessible via the Obol MCP server.
              </p>
              <SkillUpload
                uid={user.uid}
                onUploaded={(url, kind) =>
                  setF((prev) => ({
                    ...prev,
                    ...(kind === "spec" ? { openapiUrl: url } : { docsUrl: url }),
                  }))
                }
              />
              {f.openapiUrl && (
                <p className="mt-2 text-[12.5px] text-success">✓ Skill spec attached — your listing will show "Agent-ready".</p>
              )}
            </div>

            {error && <p className="sm:col-span-2 text-[13px] text-red-600">{error}</p>}

            <div className="sm:col-span-2 flex items-center justify-between border-t border-hairline pt-4">
              <Link href="/dashboard" className="text-[14px] font-medium text-muted hover:text-ink">
                Cancel
              </Link>
              <button
                type="submit"
                disabled={busy}
                className="grad rounded-[10px] px-6 py-3 text-[15px] font-semibold text-white disabled:opacity-60"
              >
                {busy ? "Listing…" : "List service →"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
