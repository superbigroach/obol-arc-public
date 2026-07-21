"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/components/AuthProvider";
import SiteNav from "@/components/SiteNav";
import {
  getProfile, saveProfile, submitKyb, listMyServices,
  SOCIAL_KEYS, type SocialKey,
  type ObolProfile, type Socials,
} from "@/lib/clientStore";
import SocialConnect from "@/components/SocialConnect";
import { functions } from "@/lib/firebase";
import { httpsCallable } from "firebase/functions";

const INPUT =
  "w-full rounded-[10px] border border-hairline px-3.5 py-2.5 text-[14px] outline-none focus:border-primary";

// ─── Social meta ─────────────────────────────────────────────────────────────
const SOCIAL_META: Record<SocialKey, { label: string; placeholder: string; icon: string; prefix?: string }> = {
  website:  { label: "Website",         icon: "🌐", placeholder: "https://yoursite.com" },
  x:        { label: "X / Twitter",     icon: "𝕏",  placeholder: "@handle or https://x.com/you" },
  linkedin: { label: "LinkedIn",        icon: "in", placeholder: "https://linkedin.com/in/you" },
  youtube:  { label: "YouTube",         icon: "▶",  placeholder: "https://youtube.com/@channel" },
  github:   { label: "GitHub",          icon: "⌥",  placeholder: "@handle or https://github.com/you" },
  discord:  { label: "Discord",         icon: "💬", placeholder: "https://discord.gg/yourserver" },
};

// ─── Page ────────────────────────────────────────────────────────────────────
export default function ProfilePage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  const [profile, setProfile] = useState<ObolProfile | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [ackDid, setAckDid] = useState<string | null>(null);

  // Public info
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [bio, setBio] = useState("");
  const [schedulingUrl, setSchedulingUrl] = useState("");

  // Logo
  const [logoUrl, setLogoUrl] = useState("");
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Socials (values)
  const [socials, setSocials] = useState<Record<SocialKey, string>>({
    website: "", x: "", linkedin: "", youtube: "", github: "", discord: "",
  });
  // Which socials to show on marketplace listing
  const [showOnListing, setShowOnListing] = useState<Set<SocialKey>>(new Set(SOCIAL_KEYS));

  // Save state
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // KYB
  const [businessName, setBusinessName] = useState("");
  const [country, setCountry] = useState("United States");
  const [submittingKyb, setSubmittingKyb] = useState(false);
  const [kybError, setKybError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [user, loading, router]);

  const reload = useCallback(async () => {
    if (!user) return;
    const p = await getProfile(user.uid);
    setProfile(p);
    // ACK-ID is account-level — it lives on your profile and exists as soon as you
    // have a wallet. If it's missing (or the wallet just changed), auto-issue it once.
    const pAck = (p as unknown as { ackDid?: string; ackPayoutAddress?: string }) || {};
    const wallet = p?.obolWalletAddress || p?.address || null;
    if (pAck.ackDid && (!wallet || pAck.ackPayoutAddress?.toLowerCase() === wallet.toLowerCase())) {
      setAckDid(pAck.ackDid);
    } else if (wallet) {
      // No credential yet, or it's on an old wallet → ensure it on the current wallet.
      httpsCallable<unknown, { ackDid?: string }>(functions, "reissueAck")({})
        .then((r) => setAckDid(r.data?.ackDid ?? null))
        .catch(() => setAckDid(pAck.ackDid ?? null));
    } else {
      setAckDid(pAck.ackDid ?? null);
    }
    setUsername(p?.username ?? "");
    setDisplayName(p?.displayName ?? user.displayName ?? "");
    setCompanyName(p?.companyName ?? "");
    setBio(p?.bio ?? "");
    setLogoUrl(p?.logoUrl ?? "");
    setSchedulingUrl(p?.schedulingUrl ?? "");
    setSocials({
      website:  p?.socials?.website  ?? "",
      x:        p?.socials?.x        ?? "",
      linkedin: p?.socials?.linkedin ?? "",
      youtube:  p?.socials?.youtube  ?? "",
      github:   p?.socials?.github   ?? "",
      discord:  p?.socials?.discord  ?? "",
    });
    const visible = p?.socialsShowOnListing;
    setShowOnListing(visible ? new Set(visible as SocialKey[]) : new Set(SOCIAL_KEYS));
    if (p?.verification?.kybBusinessName) setBusinessName(p.verification.kybBusinessName);
    if (p?.verification?.kybCountry) setCountry(p.verification.kybCountry);
    setLoaded(true);
  }, [user]);

  useEffect(() => { reload(); }, [reload]);

  // ── Logo upload — compress to 256×256 JPEG data URL, store in Firestore ──
  async function handleLogoFile(file: File) {
    if (!user) return;
    if (!file.type.startsWith("image/")) { setUploadError("Please select an image file."); return; }
    setUploadError(null);
    setUploading(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const img = new Image();
        const objectUrl = URL.createObjectURL(file);
        img.onload = () => {
          URL.revokeObjectURL(objectUrl);
          const MAX = 256;
          const ratio = Math.min(MAX / img.width, MAX / img.height, 1);
          const canvas = document.createElement("canvas");
          canvas.width = Math.round(img.width * ratio);
          canvas.height = Math.round(img.height * ratio);
          canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL("image/jpeg", 0.88));
        };
        img.onerror = reject;
        img.src = objectUrl;
      });
      setLogoUrl(dataUrl);
      setLogoPreview(dataUrl);
    } catch {
      setUploadError("Could not process image — try a PNG or JPG.");
    } finally {
      setUploading(false);
    }
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleLogoFile(file);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) handleLogoFile(file);
  }

  // ── Toggle social visibility ──────────────────────────────────────────────
  function toggleListing(key: SocialKey) {
    setShowOnListing(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  // ── Save ─────────────────────────────────────────────────────────────────
  async function onSave() {
    if (!user) return;
    setSaving(true); setSaved(false); setSaveError(null);
    try {
      const socialsPayload: Socials = {
        ...(profile?.socials ?? {}),
        website:  socials.website.trim(),
        x:        socials.x.trim(),
        linkedin: socials.linkedin.trim(),
        youtube:  socials.youtube.trim(),
        github:   socials.github.trim(),
        discord:  socials.discord.trim(),
      };
      await saveProfile(user.uid, {
        username:             username.trim().replace(/^@/, "").toLowerCase(),
        displayName:          displayName.trim(),
        companyName:          companyName.trim(),
        bio:                  bio.trim(),
        logoUrl:              logoUrl,
        socials:              socialsPayload,
        socialsShowOnListing: Array.from(showOnListing),
        schedulingUrl:        schedulingUrl.trim(),
      });
      setSaved(true);
      await reload();
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setSaveError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function onSubmitKyb() {
    if (!user) return;
    setSubmittingKyb(true); setKybError(null);
    try {
      if (!businessName.trim()) throw new Error("Business legal name is required");
      await submitKyb(user.uid, { businessName: businessName.trim(), country: country.trim() });
      await reload();
    } catch (e) {
      setKybError((e as Error).message);
    } finally {
      setSubmittingKyb(false);
    }
  }

  if (loading || !user) {
    return <div className="flex min-h-screen items-center justify-center text-muted">Loading…</div>;
  }

  const kybStatus = profile?.verification?.kybStatus ?? "none";
  const avatarSrc = logoUrl || logoPreview || profile?.avatarUrl || user.photoURL || "";
  const avatarInitial = ((companyName || displayName || user.email || "U").trim()[0] || "U").toUpperCase();
  const displayLogo = logoPreview ?? logoUrl ?? "";

  return (
    <div className="min-h-screen bg-base2">
      <SiteNav />

      <main className="mx-auto max-w-[760px] px-6 py-8">
        <div className="mb-4 flex items-center gap-3 text-[13px] text-muted">
          <Link href="/dashboard" className="hover:text-ink">← Dashboard</Link>
          <span>·</span>
          <Link href="/settings" className="hover:text-ink">Settings</Link>
        </div>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-[26px] font-extrabold tracking-[-.03em]">Profile</h1>
            <p className="mt-1.5 text-[14px] text-muted">
              Your public identity on the marketplace. A complete profile builds trust and ranks higher.
            </p>
          </div>
          {user && (
            <Link
              href={`/seller/${user.uid}`}
              target="_blank"
              className="shrink-0 rounded-[10px] border border-hairline bg-white px-4 py-2.5 text-[13px] font-semibold text-ink shadow-soft hover:border-primary hover:text-primary transition"
            >
              👁 Preview public page →
            </Link>
          )}
        </div>

        {/* ── Public info ── */}
        <section className="shadow-soft mt-6 rounded-[18px] border border-hairline bg-white p-7">
          <div className="flex items-center justify-between">
            <h2 className="text-[18px] font-bold tracking-[-.02em]">Public info</h2>
            <span className="text-[13px] text-muted">{user.email}</span>
          </div>

          <div className="mt-5 flex items-center gap-4">
            {avatarSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatarSrc} alt="" className="h-16 w-16 rounded-full border border-hairline object-cover" />
            ) : (
              <div className="grad flex h-16 w-16 items-center justify-center rounded-full text-[22px] font-bold text-white">
                {avatarInitial}
              </div>
            )}
            <div>
              <div className="text-[14px] font-semibold">{companyName || (username ? `@${username}` : null) || displayName || user.email?.split("@")[0]}</div>
              {username && <div className="text-[13px] text-muted">@{username}</div>}
            </div>
          </div>

          <div className="mt-6 grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Username / handle">
                <div className="relative">
                  <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[14px] text-muted">@</span>
                  <input className={`${INPUT} pl-7`} placeholder="yourhandle" value={username} onChange={e => setUsername(e.target.value.replace(/[^a-z0-9_.-]/gi, ""))} />
                </div>
              </Field>
              <Field label="Company / brand name">
                <input className={INPUT} placeholder="Acme Inc. — shown on listings" value={companyName} onChange={e => setCompanyName(e.target.value)} />
              </Field>
            </div>
            <Field label="Display name">
              <input className={INPUT} placeholder="Full name (optional fallback if no username)" value={displayName} onChange={e => setDisplayName(e.target.value)} />
            </Field>
            <Field label="Bio">
              <textarea className={`${INPUT} min-h-[80px] resize-y`} placeholder="What you build, who you serve…" value={bio} onChange={e => setBio(e.target.value)} />
            </Field>
            <Field label="Booking / demo link">
              <input className={INPUT} type="url" placeholder="https://cal.com/you/demo" value={schedulingUrl} onChange={e => setSchedulingUrl(e.target.value)} />
            </Field>
          </div>

        </section>

        {/* ── Logo & Branding ── */}
        <section className="shadow-soft mt-6 rounded-[18px] border border-hairline bg-white p-7">
          <h2 className="text-[18px] font-bold tracking-[-.02em]">Logo &amp; branding</h2>
          <p className="mt-1.5 text-[13.5px] text-muted">
            Your logo appears on every service card and your public profile page.
          </p>

          <div className="mt-5 flex items-start gap-5">
            {/* Preview */}
            <div className="shrink-0">
              {displayLogo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={displayLogo} alt="" className="h-20 w-20 rounded-[14px] border border-hairline object-cover" onError={e => (e.currentTarget.style.display = "none")} />
              ) : (
                <div className="grad flex h-20 w-20 items-center justify-center rounded-[14px] text-[26px] font-extrabold text-white">
                  {avatarInitial}
                </div>
              )}
              {uploading && <div className="mt-1.5 text-center text-[11px] text-muted">Uploading…</div>}
            </div>

            {/* Upload zone */}
            <div
              className="flex-1 cursor-pointer rounded-[12px] border-2 border-dashed border-hairline bg-base2 p-5 text-center transition hover:border-primary/50 hover:bg-[rgba(109,94,246,.03)]"
              onClick={() => fileInputRef.current?.click()}
              onDragOver={e => e.preventDefault()}
              onDrop={onDrop}
            >
              <div className="text-[14px] font-semibold text-ink">Drop your logo here or click to upload</div>
              <div className="mt-1 text-[12.5px] text-muted">PNG, JPG, SVG · square recommended · max 2 MB</div>
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={onFileChange} />
              {uploadError && <div className="mt-2 text-[12px] text-red-600">{uploadError}</div>}
            </div>
          </div>
        </section>

        {/* ── Socials ── */}
        <section className="shadow-soft mt-6 rounded-[18px] border border-hairline bg-white p-7">
          <h2 className="text-[18px] font-bold tracking-[-.02em]">Social links</h2>
          <p className="mt-1.5 text-[13.5px] text-muted">
            Add your links below, then toggle which ones appear on your marketplace service cards.
          </p>

          <div className="mt-5 flex flex-col gap-3">
            {SOCIAL_KEYS.map(key => {
              const meta = SOCIAL_META[key];
              const val = socials[key];
              const showing = showOnListing.has(key);
              return (
                <div key={key} className="flex items-center gap-3">
                  {/* Icon */}
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border border-hairline bg-base2 text-[15px] font-bold text-muted">
                    {meta.icon}
                  </div>
                  {/* Input */}
                  <div className="flex-1">
                    <input
                      className={INPUT}
                      placeholder={meta.placeholder}
                      value={val}
                      onChange={e => setSocials(prev => ({ ...prev, [key]: e.target.value }))}
                    />
                  </div>
                  {/* Show on listing toggle */}
                  <button
                    type="button"
                    onClick={() => toggleListing(key)}
                    disabled={!val.trim()}
                    title={val.trim() ? (showing ? "Showing on listings — click to hide" : "Hidden from listings — click to show") : "Enter a link first"}
                    className={`shrink-0 rounded-[8px] border px-3 py-2 text-[12px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-30 ${
                      showing && val.trim()
                        ? "border-primary bg-[rgba(109,94,246,.08)] text-primary"
                        : "border-hairline text-muted hover:border-primary/40 hover:text-ink"
                    }`}
                  >
                    {showing && val.trim() ? "On listing ✓" : "Show on listing"}
                  </button>
                </div>
              );
            })}
          </div>

        </section>

        {/* ── Verified socials (OAuth) ── */}
        <section className="shadow-soft mt-6 rounded-[18px] border border-hairline bg-white p-7">
          <h2 className="text-[18px] font-bold tracking-[-.02em]">Verified socials</h2>
          <p className="mt-2 text-[13.5px] text-muted">
            Connect via OAuth to prove ownership — adds a verification badge vs. a pasted URL.
          </p>
          <div className="mt-5">
            <SocialConnect socials={profile?.socials} onConnected={reload} />
          </div>
        </section>

        {/* ── Verification ── */}
        <section className="shadow-soft mt-6 rounded-[18px] border border-hairline bg-white p-7">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-[18px] font-bold tracking-[-.02em]">Verification</h2>
            <span className={`rounded-full px-3 py-1 text-[12.5px] font-semibold ${kybStatus === "verified" ? "bg-[#e7f9f0] text-success" : "border border-hairline text-muted"}`}>
              {kybStatus === "verified" ? "Verified business" : "Anonymous"}
            </span>
          </div>
          <p className="mt-2 text-[13.5px] text-muted">
            A verified business lifts your trust score and ranks your listings higher.
          </p>

          {/* ACK-ID — your account-level verifiable identity credential */}
          {ackDid ? (
            <div className="mt-5 rounded-[12px] border border-[#6d5ef6]/30 bg-[rgba(109,94,246,.05)] p-5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[14px] font-bold text-ink">🪪 Verified identity</span>
                <span className="rounded-full bg-[rgba(21,194,107,.14)] px-2.5 py-0.5 text-[11px] font-bold text-success">Verified ✓</span>
              </div>
              <p className="mt-1.5 text-[13px] text-muted">
                Your <b>Agent Commerce Kit</b> identity — a W3C Verifiable Credential, issued by Obol, that cryptographically proves you control your wallet. It&apos;s tied to your account and shown to buyers as a trust badge on every listing.
              </p>
              <div className="mt-3 rounded-[8px] border border-hairline bg-white px-3 py-2 font-mono text-[12px] text-ink break-all">
                {ackDid}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <a href={`/api/ack?did=${encodeURIComponent(ackDid)}`} target="_blank" rel="noreferrer"
                  className="rounded-[9px] border border-primary/40 px-4 py-2 text-[12.5px] font-semibold text-primary hover:bg-[rgba(109,94,246,.06)]">
                  View credential ↗
                </a>
              </div>
              <p className="mt-2 text-[12px] text-muted">Maintained automatically — always linked to your current wallet.</p>
            </div>
          ) : (
            <div className="mt-5 rounded-[12px] border border-dashed border-hairline bg-base2 p-5">
              <div className="text-[14px] font-semibold text-ink">🪪 Verified identity</div>
              <p className="mt-1 text-[13px] text-muted">
                Set up your wallet and Obol automatically issues your verified identity — a W3C Verifiable Credential proving you control it, shown to buyers as a trust badge on every listing.
              </p>
            </div>
          )}

          {kybStatus !== "verified" && (
            <div className="mt-5 rounded-[12px] border border-hairline bg-base2 p-5">
              <div className="text-[14px] font-semibold">Business verification (KYB)</div>
              <p className="mt-1 text-[13px] text-muted">
                {kybStatus === "pending" ? "Submitted — under review." : "Verify to unlock higher trust and better ranking."}
              </p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <Field label="Business legal name">
                  <input className={INPUT} placeholder="Acme Inc." value={businessName} onChange={e => setBusinessName(e.target.value)} />
                </Field>
                <Field label="Country">
                  <select className={INPUT} value={country} onChange={e => setCountry(e.target.value)}>
                    {["United States", "Canada", "United Kingdom", "Germany", "France", "Singapore", "Australia", "Japan", "India", "Brazil", "Other"].map(c => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </Field>
              </div>
              <div className="mt-4 flex items-center gap-3">
                <button onClick={onSubmitKyb} disabled={submittingKyb}
                  className="grad rounded-[10px] px-5 py-2.5 text-[14px] font-semibold text-white disabled:opacity-60">
                  {submittingKyb ? "Submitting…" : kybStatus === "pending" ? "Resubmit" : "Submit for verification"}
                </button>
                {kybStatus === "pending" && <span className="text-[13px] text-muted font-semibold">Pending review</span>}
                {kybError && <span className="text-[13px] text-red-600">{kybError}</span>}
              </div>
            </div>
          )}
          {kybStatus === "verified" && <p className="mt-4 text-[14px] font-semibold text-success">Business verified ✓</p>}
        </section>

        {/* bottom spacer so content isn't hidden behind sticky bar */}
        <div className="h-24" />
      </main>

      {/* ── Sticky save bar ── */}
      <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-hairline bg-white/90 px-6 py-4 backdrop-blur-md">
        <div className="mx-auto flex max-w-[760px] items-center justify-between gap-4">
          <span className="text-[13px] text-muted">
            {uploading ? "Uploading logo…" : saved ? "" : "Changes are not saved yet"}
          </span>
          <div className="flex items-center gap-3">
            {saved && <span className="text-[14px] font-semibold text-success">Saved ✓</span>}
            {saveError && <span className="text-[13px] text-red-600">{saveError}</span>}
            <button
              onClick={onSave}
              disabled={saving || !loaded}
              className="grad rounded-[10px] px-6 py-2.5 text-[14px] font-semibold text-white shadow-[0_4px_14px_rgba(109,94,246,.3)] disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save profile"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[12px] font-semibold uppercase tracking-[.05em] text-muted">{label}</label>
      <div className="mt-1">{children}</div>
    </div>
  );
}
