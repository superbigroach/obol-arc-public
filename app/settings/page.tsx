"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/components/AuthProvider";
import SiteNav from "@/components/SiteNav";
import { getProfile, saveProfile, type ObolProfile } from "@/lib/clientStore";
import { functions, auth } from "@/lib/firebase";
import { httpsCallable } from "firebase/functions";
import { signOut } from "firebase/auth";
import { buildObolSkill } from "@/lib/obolSkill";
import QRCode from "qrcode";

const INPUT =
  "w-full rounded-[10px] border border-hairline px-3.5 py-2.5 text-[14px] outline-none focus:border-primary";

type ApiKey = {
  id: string;
  keyPrefix: string;
  agentAddress: string;
  createdAt: string | null;
  lastUsedAt: string | null;
  revoked: boolean;
};

const isAddress = (s: string) => /^0x[0-9a-fA-F]{40}$/.test(s.trim());

type Schedule = "manual" | "hourly" | "daily" | "weekly" | "monthly" | "threshold";
const SCHEDULES: { value: Schedule; label: string; desc: string }[] = [
  { value: "manual",     label: "Manual",    desc: "You trigger every withdrawal." },
  { value: "hourly",    label: "Hourly",    desc: "Auto-payout every hour." },
  { value: "daily",     label: "Daily",     desc: "Auto-payout once a day." },
  { value: "weekly",    label: "Weekly",    desc: "Auto-payout every Monday." },
  { value: "monthly",   label: "Monthly",   desc: "Auto-payout on the 1st of each month." },
  { value: "threshold", label: "Threshold", desc: "Auto-payout when balance reaches a set amount." },
];


// ─── TOTP modal — 6-digit authenticator code ──────────────────────────────────
function TotpModal({
  actionLabel,
  onSubmit,
  onCancel,
}: {
  actionLabel: string;
  onSubmit: (code: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (code.length < 6) return;
    setBusy(true); setErr(null);
    try {
      await onSubmit(code.trim());
    } catch (e) {
      setErr((e as Error).message || "Invalid code — try again.");
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-[380px] rounded-[20px] border border-hairline bg-white p-7 shadow-2xl">
        <div className="mb-1 text-[18px] font-extrabold tracking-[-.02em]">Authenticator code</div>
        <p className="mb-5 text-[13.5px] text-muted">Enter the 6-digit code from your authenticator app to {actionLabel}.</p>
        <input
          type="text"
          inputMode="numeric"
          className={`${INPUT} font-mono tracking-[.3em] text-[22px] text-center`}
          placeholder="000000"
          maxLength={6}
          value={code}
          onChange={e => { setCode(e.target.value.replace(/\D/g, "")); setErr(null); }}
          onKeyDown={e => e.key === "Enter" && submit()}
          autoFocus
        />
        {err && <p className="mt-2 text-[12.5px] text-red-600">{err}</p>}
        <div className="mt-5 flex gap-3">
          <button onClick={submit} disabled={busy || code.length < 6}
            className="grad flex-1 rounded-[10px] py-2.5 text-[14px] font-semibold text-white disabled:opacity-60">
            {busy ? "Verifying…" : "Confirm"}
          </button>
          <button onClick={onCancel}
            className="rounded-[10px] border border-hairline px-4 py-2.5 text-[14px] font-semibold text-muted hover:bg-base2">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function SettingsPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  const [profile, setProfile] = useState<ObolProfile | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [payoutAddress, setPayoutAddress] = useState("");
  const [payoutSchedule, setPayoutSchedule] = useState<Schedule>("manual");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // API keys
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [keysLoading, setKeysLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [newKey, setNewKey] = useState<{ apiKey: string; agentAddress: string } | null>(null);
  const [keyError, setKeyError] = useState<string | null>(null);

  // TOTP 2FA state
  const [totpConfirmed, setTotpConfirmed] = useState(false);
  const [totpSetupPhase, setTotpSetupPhase] = useState<"idle" | "scanning" | "confirming">("idle");
  const [totpSetupQr, setTotpSetupQr] = useState("");
  const [totpSetupUri, setTotpSetupUri] = useState("");
  const [totpSetupCode, setTotpSetupCode] = useState("");
  const [totpSetupBusy, setTotpSetupBusy] = useState(false);
  const [totpSetupErr, setTotpSetupErr] = useState<string | null>(null);

  // Privacy & data (GDPR export / delete)
  const [exporting, setExporting] = useState(false);
  const [exportErr, setExportErr] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleteTotp, setDeleteTotp] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);

  async function exportMyData() {
    setExporting(true); setExportErr(null);
    try {
      const res = await httpsCallable<unknown, Record<string, unknown>>(functions, "exportMyData")({});
      const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `obol-data-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) { setExportErr((e as Error).message); }
    finally { setExporting(false); }
  }

  async function deleteMyAccount() {
    if (deleteConfirm !== "DELETE") { setDeleteErr('Type DELETE to confirm.'); return; }
    if (totpConfirmed && !deleteTotp) { setDeleteErr("Enter your authenticator code."); return; }
    setDeleting(true); setDeleteErr(null);
    try {
      await httpsCallable(functions, "deleteMyAccount")({ confirm: "DELETE", totpCode: deleteTotp || undefined });
      await signOut(auth);
      router.replace("/");
    } catch (e) { setDeleteErr((e as Error).message); setDeleting(false); }
  }

  // TOTP gate: action + target
  const [pendingAction, setPendingAction] = useState<{ action: "generate" | "rotate" | "revoke" | "reveal" | "setLimits"; keyId: string } | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);

  // Spending limits (default daily 50, applied server-side at read time)
  const [limits, setLimits] = useState<{ daily: string; weekly: string; monthly: string }>({ daily: "", weekly: "", monthly: "" });
  const [limitsLoading, setLimitsLoading] = useState(true);
  const [limitsSaved, setLimitsSaved] = useState(false);
  const [limitsError, setLimitsError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [user, loading, router]);

  const reload = useCallback(async () => {
    if (!user) return;
    const p = await getProfile(user.uid);
    setProfile(p);
    setPayoutAddress(p?.payoutAddress ?? "");
    setPayoutSchedule(p?.payoutSchedule ?? "manual");
    setLoaded(true);
  }, [user]);

  useEffect(() => { reload(); }, [reload]);

  const loadApiKeys = useCallback(async () => {
    if (!user) return;
    setKeysLoading(true);
    try {
      const fn = httpsCallable<unknown, ApiKey[]>(functions, "getMyApiKeys");
      const res = await fn({});
      setApiKeys(res.data);
    } catch (e) {
      setKeyError((e as Error).message);
    } finally {
      setKeysLoading(false);
    }
  }, [user]);

  useEffect(() => { loadApiKeys(); }, [loadApiKeys]);

  // Load TOTP status
  useEffect(() => {
    if (!user) return;
    httpsCallable<unknown, { confirmed: boolean }>(functions, "getTotpStatus")({})
      .then(r => setTotpConfirmed(r.data.confirmed))
      .catch(() => {});
  }, [user]);

  // Load spending limits (server defaults daily → 50 if never set)
  const loadLimits = useCallback(async () => {
    if (!user) return;
    setLimitsLoading(true);
    try {
      const r = await httpsCallable<unknown, { daily: number | null; weekly: number | null; monthly: number | null }>(functions, "getUserAgentLimits")({});
      const fmt = (v: number | null) => (v === null || v === undefined ? "" : String(v));
      setLimits({ daily: fmt(r.data.daily), weekly: fmt(r.data.weekly), monthly: fmt(r.data.monthly) });
    } catch {
      // If the read fails, still show the 50/day default so the user isn't confused by 0.
      setLimits({ daily: "50", weekly: "", monthly: "" });
    } finally {
      setLimitsLoading(false);
    }
  }, [user]);

  useEffect(() => { loadLimits(); }, [loadLimits]);

  async function startTotpSetup() {
    setTotpSetupBusy(true); setTotpSetupErr(null);
    try {
      const res = await httpsCallable<unknown, { otpauthUri: string }>(functions, "setupTotp")({});
      const uri = res.data.otpauthUri;
      setTotpSetupUri(uri);
      const qr = await QRCode.toDataURL(uri, { width: 200, margin: 1 });
      setTotpSetupQr(qr);
      setTotpSetupPhase("scanning");
    } catch (e) {
      setTotpSetupErr((e as Error).message);
    } finally {
      setTotpSetupBusy(false);
    }
  }

  async function confirmTotpSetup() {
    setTotpSetupBusy(true); setTotpSetupErr(null);
    try {
      await httpsCallable(functions, "confirmTotpSetup")({ code: totpSetupCode });
      setTotpConfirmed(true);
      setTotpSetupPhase("idle");
      setTotpSetupCode(""); setTotpSetupUri(""); setTotpSetupQr("");
    } catch (e) {
      setTotpSetupErr((e as Error).message);
    } finally {
      setTotpSetupBusy(false);
    }
  }

  async function handleTotpAction(code: string) {
    if (!pendingAction) return;
    const { action, keyId } = pendingAction;
    if (action === "generate") {
      setGenerating(true); setKeyError(null); setNewKey(null); setRevealedKey(null);
      try {
        const fn = httpsCallable<unknown, { apiKey: string; agentAddress: string }>(functions, "generateApiKey");
        const res = await fn({ totpCode: code });
        setNewKey({ apiKey: res.data.apiKey, agentAddress: res.data.agentAddress });
        await loadApiKeys();
      } finally {
        setGenerating(false);
      }
    } else if (action === "reveal") {
      const res = await httpsCallable<unknown, { apiKey: string }>(functions, "revealApiKey")({ keyId, totpCode: code });
      setRevealedKey(res.data.apiKey);
    } else if (action === "revoke") {
      setRevoking(keyId); setKeyError(null);
      try {
        await httpsCallable(functions, "revokeApiKey")({ keyId, totpCode: code });
        await loadApiKeys();
      } finally {
        setRevoking(null);
      }
    } else if (action === "setLimits") {
      setLimitsError(null); setLimitsSaved(false);
      const num = (s: string) => (s.trim() === "" ? null : Number(s));
      await httpsCallable(functions, "setUserAgentLimits")({
        daily: num(limits.daily), weekly: num(limits.weekly), monthly: num(limits.monthly), totpCode: code,
      });
      setLimitsSaved(true);
      setTimeout(() => setLimitsSaved(false), 2500);
      await loadLimits();
    } else {
      setGenerating(true); setKeyError(null); setNewKey(null); setRevealedKey(null);
      try {
        await httpsCallable(functions, "revokeApiKey")({ keyId, totpCode: code });
        const fn = httpsCallable<unknown, { apiKey: string; agentAddress: string }>(functions, "generateApiKey");
        const res = await fn({ totpCode: code });
        setNewKey({ apiKey: res.data.apiKey, agentAddress: res.data.agentAddress });
        await loadApiKeys();
      } finally {
        setGenerating(false);
      }
    }
    setPendingAction(null);
  }

  async function onSave() {
    setSaving(true); setSaved(false); setSaveError(null);
    try {
      const addr = payoutAddress.trim();
      if (addr && !isAddress(addr)) throw new Error("Enter a valid address (0x followed by 40 hex characters).");
      await saveProfile(user!.uid, { payoutAddress: addr, payoutSchedule });
      setSaved(true);
      await reload();
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setSaveError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (loading || !user) {
    return <div className="flex min-h-screen items-center justify-center text-muted">Loading…</div>;
  }

  const payoutValid = !payoutAddress.trim() || isAddress(payoutAddress);
  const currentPayout = profile?.payoutAddress?.trim() || "";
  const agentWallet = profile?.obolWalletAddress || profile?.address || "";
  const isFirstTime = apiKeys.length === 0;

  const actionLabel = pendingAction?.action === "generate"
    ? "generate a new API key"
    : pendingAction?.action === "reveal"
    ? "reveal this key"
    : pendingAction?.action === "revoke"
    ? "delete this key"
    : pendingAction?.action === "setLimits"
    ? "change your spending limits"
    : "rotate this key";

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50">
      {pendingAction && (
        <TotpModal
          actionLabel={actionLabel}
          onSubmit={handleTotpAction}
          onCancel={() => { setPendingAction(null); setRevoking(null); setGenerating(false); }}
        />
      )}

      <SiteNav />

      <main className="mx-auto max-w-[920px] px-6 py-12">
        {/* Hero section */}
        <div className="mb-12 rounded-[28px] border border-white/40 bg-gradient-to-br from-white/60 to-white/40 backdrop-blur-xl p-10 shadow-[0_8px_32px_rgba(0,0,0,.06)]">
          <div className="mb-2 flex items-center gap-3 text-[13px] text-muted">
            <Link href="/dashboard" className="hover:text-ink">← Dashboard</Link>
          </div>
          <h1 className="text-[40px] font-extrabold tracking-[-.04em] text-ink">API Keys &amp; Setup</h1>
          <p className="mt-3 max-w-[640px] text-[16px] text-muted">
            Generate your API key, set up 2FA, configure spending limits, and give your agent everything it needs to start earning.
          </p>
        </div>

        {/* ── Build with AI — copy-the-skill gradient card (matches dashboard/home) ── */}
        <ObolSkillCard sellerAddr={agentWallet} />

        {/* ── API Keys ── */}
        <section id="api-keys" className="scroll-mt-24 rounded-[24px] border border-white/40 bg-gradient-to-br from-white/80 to-white/60 backdrop-blur-sm shadow-[0_8px_32px_rgba(0,0,0,.06)] p-8 mb-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-[18px] font-bold tracking-[-.02em]">API Keys</h2>
              <p className="mt-1.5 text-[13.5px] text-muted">
                Agents use these to access Obol on your behalf. Each key has its own signing wallet — no private keys to manage.
              </p>
            </div>
            <button
              onClick={() => setPendingAction({ action: "generate", keyId: "" })}
              disabled={generating}
              className="grad shrink-0 rounded-[10px] px-4 py-2.5 text-[13px] font-semibold text-white shadow-[0_4px_12px_rgba(109,94,246,.25)] disabled:opacity-60"
            >
              {generating ? "Generating…" : "+ New key"}
            </button>
          </div>

          {keyError && (
            <div className="mt-4 flex items-start justify-between gap-3 rounded-[10px] border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
              <span>{keyError}</span>
              <button onClick={() => setKeyError(null)} className="shrink-0 text-red-400 hover:text-red-700 text-[16px] leading-none">×</button>
            </div>
          )}

          {/* One-time reveal after create / rotate */}
          {(newKey || revealedKey) && (
            <KeyRevealBox
              apiKey={newKey?.apiKey ?? revealedKey ?? ""}
              agentAddress={newKey?.agentAddress}
              isRotate={!newKey && !!revealedKey}
              onDismiss={() => { setNewKey(null); setRevealedKey(null); }}
            />
          )}

          {/* Keys table */}
          <div className="mt-5">
            {keysLoading ? (
              <div className="py-6 text-center text-[13px] text-muted">Loading…</div>
            ) : apiKeys.filter(k => !k.revoked).length === 0 ? (
              <div className="rounded-[12px] border border-dashed border-hairline py-10 text-center text-[13px] text-muted">
                No API keys yet — click <b>+ New key</b> above.
              </div>
            ) : (
              <div className="overflow-hidden rounded-[12px] border border-hairline">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="border-b border-hairline bg-base2 text-left">
                      <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[.05em] text-muted">Key</th>
                      <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[.05em] text-muted">Created</th>
                      <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[.05em] text-muted">Last used</th>
                      <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[.05em] text-muted">Status</th>
                      <th className="px-4 py-2.5"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {apiKeys.filter(k => !k.revoked).map((k, i) => (
                      <tr key={k.id} className={`${i > 0 ? "border-t border-hairline" : ""}`}>
                        <td className="px-4 py-3">
                          {/* Masked key display */}
                          <span className="font-mono text-[12px] text-ink">
                            {k.keyPrefix}
                            <span className="text-muted">{"•".repeat(16)}</span>
                          </span>
                          <div className="mt-0.5 font-mono text-[10px] text-muted">
                            wallet {k.agentAddress.slice(0, 8)}…{k.agentAddress.slice(-4)}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-[12px] text-muted">
                          {k.createdAt ? new Date(k.createdAt).toLocaleDateString() : "—"}
                        </td>
                        <td className="px-4 py-3 text-[12px] text-muted">
                          {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleDateString() : "Never"}
                        </td>
                        <td className="px-4 py-3">
                          {k.revoked ? (
                            <span className="rounded-full bg-base2 px-2 py-0.5 text-[11px] font-semibold text-muted">Revoked</span>
                          ) : (
                            <span className="rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-semibold text-green-700">Active</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {!k.revoked && (
                            <div className="flex items-center justify-end gap-2">
                              <button
                                onClick={() => { setRevealedKey(null); setNewKey(null); setPendingAction({ action: "reveal", keyId: k.id }); }}
                                className="rounded-[8px] border border-hairline px-3 py-1.5 text-[12px] font-semibold text-muted hover:border-primary hover:text-primary"
                                title="Verify identity to view the full key"
                              >
                                Reveal
                              </button>
                              <button
                                onClick={() => setPendingAction({ action: "rotate", keyId: k.id })}
                                disabled={generating && pendingAction?.keyId === k.id}
                                className="rounded-[8px] border border-hairline px-3 py-1.5 text-[12px] font-semibold text-muted hover:border-primary hover:text-primary disabled:opacity-50"
                                title="Verify identity, then get a new key"
                              >
                                Rotate
                              </button>
                              <button
                                onClick={() => setPendingAction({ action: "revoke", keyId: k.id })}
                                disabled={revoking === k.id}
                                className="rounded-[8px] border border-hairline px-3 py-1.5 text-[12px] font-semibold text-muted hover:border-red-400 hover:text-red-600 disabled:opacity-50"
                              >
                                {revoking === k.id ? "…" : "Delete"}
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <p className="mt-4 text-[12px] text-muted">
            Reveal, Rotate, and Delete all require a 6-digit code from your authenticator app.
          </p>
        </section>

        {/* ── Authenticator App (2FA) ── */}
        <section className="rounded-[24px] border border-white/40 bg-gradient-to-br from-white/80 to-white/60 backdrop-blur-sm shadow-[0_8px_32px_rgba(0,0,0,.06)] p-8 mb-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-[18px] font-bold tracking-[-.02em]">Authenticator app</h2>
              <p className="mt-2 text-[13.5px] text-muted">
                Required to generate, reveal, rotate, or delete API keys. Use Google Authenticator, Authy, or any TOTP app.
              </p>
            </div>
            {totpConfirmed && (
              <span className="mt-1 shrink-0 rounded-full bg-green-100 px-3 py-1 text-[12px] font-bold text-green-700">✓ Active</span>
            )}
          </div>

          {totpConfirmed && totpSetupPhase === "idle" ? (
            <div className="mt-5 rounded-[12px] border border-green-200 bg-green-50 p-4">
              <div className="text-[14px] font-semibold text-green-800">Authenticator app connected</div>
              <div className="mt-1 text-[12.5px] text-green-700">Your app generates the 6-digit code needed for all key operations.</div>
              <div className="mt-3"></div>
              <button
                onClick={() => { setTotpSetupPhase("idle"); startTotpSetup(); }}
                disabled={totpSetupBusy}
                className="mt-4 rounded-[10px] border border-green-300 bg-white px-4 py-2 text-[13px] font-semibold text-green-800 hover:bg-green-50 transition"
              >
                Re-link authenticator
              </button>
            </div>
          ) : totpSetupPhase === "idle" ? (
            <div className="mt-5">
              {totpSetupErr && <p className="mb-3 text-[12.5px] text-red-600">{totpSetupErr}</p>}
              <button
                onClick={startTotpSetup}
                disabled={totpSetupBusy}
                className="grad rounded-[10px] px-5 py-2.5 text-[14px] font-semibold text-white disabled:opacity-60"
              >
                {totpSetupBusy ? "Setting up…" : "Set up authenticator app"}
              </button>
            </div>
          ) : (
            <div className="mt-6 flex flex-col items-center text-center space-y-6">
              {/* Step 1 */}
              <div className="w-full rounded-[14px] border border-hairline bg-base2 p-6 flex flex-col items-center gap-4">
                <div className="text-[13px] font-semibold text-ink">1. Scan this QR code in Google Authenticator</div>
                {totpSetupQr && (
                  <>
                    <img src={totpSetupQr} alt="QR code" className="h-[180px] w-[180px] rounded-[12px] border border-hairline bg-white p-2" />
                    <div className="flex flex-col items-center gap-1">
                      <div className="text-[11px] font-semibold uppercase tracking-[.06em] text-muted">Or enter this key manually</div>
                      <div className="font-mono text-[14px] font-bold text-ink tracking-[.1em]">{totpSetupUri.match(/secret=([A-Z2-7]+)/i)?.[1] ?? "—"}</div>
                    </div>
                  </>
                )}
              </div>

              {/* Step 2 */}
              <div className="w-full flex flex-col items-center gap-3">
                <div className="text-[13px] font-semibold text-ink">2. Enter the 6-digit code to confirm</div>
                <input
                  type="text"
                  inputMode="numeric"
                  className="w-[200px] rounded-[12px] border border-hairline px-4 py-3 font-mono tracking-[.35em] text-[24px] text-center outline-none focus:border-primary"
                  placeholder="000000"
                  maxLength={6}
                  value={totpSetupCode}
                  onChange={e => { setTotpSetupCode(e.target.value.replace(/\D/g, "")); setTotpSetupErr(null); }}
                  onKeyDown={e => e.key === "Enter" && totpSetupCode.length === 6 && confirmTotpSetup()}
                  autoFocus
                />
                {totpSetupErr && <p className="text-[12.5px] text-red-600">{totpSetupErr}</p>}
                <div className="flex gap-3">
                  <button
                    onClick={confirmTotpSetup}
                    disabled={totpSetupBusy || totpSetupCode.length < 6}
                    className="grad rounded-[10px] px-6 py-2.5 text-[14px] font-semibold text-white disabled:opacity-60"
                  >
                    {totpSetupBusy ? "Verifying…" : "Activate"}
                  </button>
                  <button
                    onClick={() => { setTotpSetupPhase("idle"); setTotpSetupCode(""); setTotpSetupErr(null); }}
                    className="rounded-[10px] border border-hairline px-4 py-2.5 text-[14px] font-semibold text-muted hover:bg-base2"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* ── Spending Limits ── */}
        <section className="rounded-[24px] border border-white/40 bg-gradient-to-br from-white/80 to-white/60 backdrop-blur-sm shadow-[0_8px_32px_rgba(0,0,0,.06)] p-8 mb-8">
          <h2 className="text-[18px] font-bold tracking-[-.02em]">Spending Limits</h2>
          <p className="mt-2 text-[13.5px] text-muted">
            Hard caps your agent can never exceed. New accounts start at <b>50 USDC/day</b>. Leave a field blank for no cap on that window.
            Your API key can spend up to these limits but can never raise them — changing a limit requires your 2FA code.
          </p>

          <div className="mt-5 grid gap-4 sm:grid-cols-3">
            {([
              { label: "Daily", key: "daily" as const },
              { label: "Weekly", key: "weekly" as const },
              { label: "Monthly", key: "monthly" as const },
            ]).map(l => (
              <div key={l.key}>
                <label className="text-[12px] font-semibold uppercase tracking-[.05em] text-muted">{l.label} limit</label>
                <div className="mt-1 flex gap-1">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    placeholder={limitsLoading ? "…" : (l.key === "daily" ? "50" : "none")}
                    className={`${INPUT} flex-1 text-[14px]`}
                    value={limits[l.key]}
                    disabled={limitsLoading}
                    onChange={e => { setLimits(p => ({ ...p, [l.key]: e.target.value })); setLimitsError(null); setLimitsSaved(false); }}
                  />
                  <span className="flex items-center px-3 text-[13px] font-semibold text-muted">USDC</span>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-5 flex items-center gap-3">
            <button
              onClick={() => {
                if (!totpConfirmed) { setLimitsError("Set up the authenticator app below first — changing limits requires 2FA."); return; }
                setLimitsError(null);
                setPendingAction({ action: "setLimits", keyId: "" });
              }}
              disabled={limitsLoading}
              className="grad rounded-[10px] px-5 py-2.5 text-[14px] font-semibold text-white disabled:opacity-60"
            >
              Save limits
            </button>
            {limitsSaved && <span className="text-[14px] font-semibold text-success">Saved ✓</span>}
            {limitsError && <span className="text-[13px] text-red-600">{limitsError}</span>}
          </div>
        </section>

        {/* ── Agent Setup ── */}
        <section className="rounded-[24px] border border-white/40 bg-gradient-to-br from-white/80 to-white/60 backdrop-blur-sm shadow-[0_8px_32px_rgba(0,0,0,.06)] p-8 mb-8">
          <h2 className="text-[18px] font-bold tracking-[-.02em]">How to connect your agent</h2>
          <p className="mt-2 text-[13.5px] text-muted">
            Generate a key above, then follow these four steps to wire Obol into Claude, Cursor, ChatGPT, or any MCP client.
          </p>

          <div className="mt-6 space-y-0">
            {[
              { h: "Generate & copy your key", p: <>Click <b>+ New key</b> above. Copy the key and the MCP config block it shows you.</> },
              { h: "Give it to your agent", p: <>Tell your agent: <em>&ldquo;Add this to my MCP config file and paste my key in.&rdquo;</em> It writes the config into <code className="rounded bg-base2 px-1.5 py-0.5 font-mono text-[12px]">mcp.json</code> and fills in <code className="rounded bg-base2 px-1.5 py-0.5 font-mono text-[12px]">OBOL_API_KEY</code> for you.</> },
              { h: "Restart your agent", p: <>Restart the app so it loads the new config. Obol is now connected — your agent can discover and pay for services automatically.</> },
              { h: "List your own services", p: <>Tell your agent what endpoints it can sell and the price per call. It registers them on Obol; other agents discover, pay in USDC, and you earn instantly.</> },
            ].map((s, i, arr) => (
              <div key={s.h} className="flex gap-3.5">
                <div className="flex flex-col items-center">
                  <div className="grad flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[13px] font-bold text-white">{i + 1}</div>
                  {i < arr.length - 1 && <div className="mt-1 w-px flex-1 bg-hairline" />}
                </div>
                <div className={i < arr.length - 1 ? "pb-5" : ""}>
                  <div className="text-[14px] font-bold text-ink">{s.h}</div>
                  <p className="mt-0.5 text-[13px] leading-[1.55] text-muted">{s.p}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── Payout ── (hidden on first visit) */}
        {!isFirstTime && (
        <section className="shadow-soft mt-6 rounded-[18px] border border-hairline bg-white p-7">
          <h2 className="text-[18px] font-bold tracking-[-.02em]">Payout</h2>
          <p className="mt-2 text-[13.5px] text-muted">
            API call revenue settles to your agent wallet on Arc Testnet. Forward to an external address (optional).
          </p>

          {agentWallet ? (
            <div className="mt-5 rounded-[12px] border border-green-200 bg-green-50 p-4">
              <div className="text-[12px] font-semibold uppercase tracking-[.05em] text-green-700">Agent wallet (receives revenue)</div>
              <div className="mt-1 flex items-center gap-2">
                <span className="break-all font-mono text-[13px] text-ink">{agentWallet}</span>
                <CopyBtn text={agentWallet} />
              </div>
              <div className="mt-1 text-[12px] text-green-700">Managed by Obol on Arc Testnet · revenue settles directly to this address</div>
            </div>
          ) : (
            <div className="mt-5 rounded-[12px] border border-amber-200 bg-amber-50 p-4 text-[13.5px] text-amber-800">
              No wallet yet — <Link href="/dashboard" className="font-semibold underline">set up your wallet</Link> in the dashboard first.
            </div>
          )}

          <div className="mt-5">
            <label className="text-[12px] font-semibold uppercase tracking-[.05em] text-muted">Forward earnings to external address (optional)</label>
            <div className="mt-1 flex gap-2">
              <input
                className={`${INPUT} flex-1 font-mono text-[13px] ${payoutValid ? "" : "border-red-500 focus:border-red-500"}`}
                placeholder="0x… external wallet or treasury"
                value={payoutAddress}
                onChange={(e) => { setPayoutAddress(e.target.value); setSaveError(null); setSaved(false); }}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
              />
              {payoutAddress.trim() && payoutValid && <CopyBtn text={payoutAddress.trim()} />}
            </div>
            <p className="mt-1.5 text-[12px] text-muted">
              {currentPayout
                ? <>Forwarding to: <span className="font-mono text-ink">{currentPayout}</span></>
                : "Optional. Leave blank to keep earnings in your Arc wallet above."}
            </p>
            {!payoutValid && <p className="mt-1 text-[12px] text-red-600">Enter a valid 0x address.</p>}
          </div>

          <div className="mt-6">
            <div className="text-[12px] font-semibold uppercase tracking-[.05em] text-muted">Payout schedule</div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {SCHEDULES.map((s) => (
                <button key={s.value} type="button" onClick={() => setPayoutSchedule(s.value)}
                  className={`rounded-[12px] border px-4 py-3 text-left transition ${payoutSchedule === s.value ? "border-primary bg-[rgba(109,94,246,.06)]" : "border-hairline hover:border-primary/50"}`}>
                  <div className={`text-[14px] font-semibold ${payoutSchedule === s.value ? "text-primary" : "text-ink"}`}>{s.label}</div>
                  <div className="text-[12.5px] text-muted">{s.desc}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="mt-6 flex items-center gap-3">
            <button onClick={onSave} disabled={saving || !loaded || !payoutValid}
              className="grad rounded-[10px] px-5 py-2.5 text-[14px] font-semibold text-white disabled:opacity-60">
              {saving ? "Saving…" : "Save"}
            </button>
            {saved && <span className="text-[14px] font-semibold text-success">Saved ✓</span>}
            {saveError && <span className="text-[13px] text-red-600">{saveError}</span>}
          </div>
        </section>
        )}

        {/* ── Privacy & data (GDPR rights) ── */}
        <section id="privacy" className="scroll-mt-24 rounded-[24px] border border-white/40 bg-gradient-to-br from-white/80 to-white/60 backdrop-blur-sm shadow-[0_8px_32px_rgba(0,0,0,.06)] p-8 mb-8">
          <h2 className="text-[18px] font-bold tracking-[-.02em]">Privacy &amp; data</h2>
          <p className="mt-1 text-[13.5px] text-muted">Your data rights. See our <Link href="/privacy" className="text-primary hover:underline">Privacy Policy</Link> and <Link href="/terms" className="text-primary hover:underline">Terms</Link>.</p>

          <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-hairline pt-5">
            <div className="flex-1 min-w-[220px]">
              <div className="text-[14px] font-semibold text-ink">Export my data</div>
              <div className="text-[12.5px] text-muted">Download everything Obol holds about you as JSON (secrets redacted).</div>
            </div>
            <button onClick={exportMyData} disabled={exporting}
              className="rounded-[10px] border border-primary/40 px-4 py-2 text-[13px] font-semibold text-primary hover:bg-[rgba(109,94,246,.06)] disabled:opacity-60">
              {exporting ? "Preparing…" : "Export →"}
            </button>
          </div>
          {exportErr && <p className="mt-2 text-[12.5px] text-red-600">{exportErr}</p>}

          <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-hairline pt-5">
            <div className="flex-1 min-w-[220px]">
              <div className="text-[14px] font-semibold text-red-600">Delete account</div>
              <div className="text-[12.5px] text-muted">Permanently erase your account and all records. Irreversible — withdraw any USDC first.</div>
            </div>
            <button onClick={() => { setDeleteOpen(true); setDeleteErr(null); setDeleteConfirm(""); setDeleteTotp(""); }}
              className="rounded-[10px] border border-red-300 px-4 py-2 text-[13px] font-semibold text-red-600 hover:bg-red-50">
              Delete account
            </button>
          </div>
        </section>
      </main>

      {deleteOpen && (
        <div className="fixed inset-0 z-[999] flex items-end justify-center bg-black/40 p-4 sm:items-center"
             onClick={(e) => { if (e.target === e.currentTarget && !deleting) setDeleteOpen(false); }}>
          <div className="w-full max-w-[440px] rounded-[20px] border border-hairline bg-white p-7 shadow-[0_20px_60px_rgba(0,0,0,.18)]">
            <h2 className="text-[18px] font-bold tracking-[-.02em] text-red-600">Delete account</h2>
            <p className="mt-2 text-[13.5px] text-muted">This <b>permanently</b> deletes your account, profile, API keys, listings, 2FA, and login. Transaction records are <b>anonymized</b> (identity removed, amounts kept for tax/audit per our <Link href="/privacy" className="text-primary underline">Privacy Policy</Link>). It cannot be undone. <b>Withdraw any USDC first</b> — on-chain funds are not recoverable through Obol after deletion.</p>

            <label className="mt-5 block text-[11px] font-bold uppercase tracking-[.05em] text-muted">Type DELETE to confirm</label>
            <input value={deleteConfirm} onChange={(e) => { setDeleteConfirm(e.target.value); setDeleteErr(null); }}
              placeholder="DELETE"
              className="mt-1.5 w-full rounded-[10px] border border-hairline px-4 py-3 text-[14px] outline-none focus:border-red-400" />

            {totpConfirmed && (
              <>
                <label className="mt-4 block text-[11px] font-bold uppercase tracking-[.05em] text-muted">Authenticator code</label>
                <input value={deleteTotp} onChange={(e) => { setDeleteTotp(e.target.value.replace(/\D/g, "").slice(0, 6)); setDeleteErr(null); }}
                  inputMode="numeric" placeholder="000000"
                  className="mt-1.5 w-full rounded-[10px] border border-hairline px-4 py-3 font-mono text-[16px] tracking-[.3em] outline-none focus:border-red-400" />
              </>
            )}

            {deleteErr && <p className="mt-3 text-[13px] text-red-600">{deleteErr}</p>}

            <div className="mt-5 flex gap-3">
              <button onClick={() => setDeleteOpen(false)} disabled={deleting}
                className="flex-1 rounded-[10px] border border-hairline py-2.5 text-[14px] font-semibold text-muted hover:bg-base2 disabled:opacity-60">Cancel</button>
              <button onClick={deleteMyAccount} disabled={deleting || deleteConfirm !== "DELETE"}
                className="flex-1 rounded-[10px] bg-red-600 py-2.5 text-[14px] font-semibold text-white hover:bg-red-700 disabled:opacity-60">
                {deleting ? "Deleting…" : "Delete forever"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Key reveal box (create + rotate + reveal) ────────────────────────────────
function KeyRevealBox({
  apiKey,
  agentAddress,
  isRotate,
  onDismiss,
}: {
  apiKey: string;
  agentAddress?: string;
  isRotate: boolean;
  onDismiss: () => void;
}) {
  const mcpConfig = `{
  "mcpServers": {
    "obol": {
      "command": "npx",
      "args": ["-y", "@obol/mcp"],
      "env": { "OBOL_API_KEY": "${apiKey}" }
    }
  }
}`;

  return (
    <div className="mt-5 rounded-[16px] border border-amber-200 bg-amber-50 p-6">
      <div className="mb-1 flex items-center gap-2">
        <span className="text-[15px] font-bold text-amber-900">
          {isRotate ? "Your API key" : "Your API key is ready"}
        </span>
        <span className="rounded-full bg-amber-200 px-2 py-0.5 text-[11px] font-semibold text-amber-900">
          {isRotate ? "revealed" : "shown once"}
        </span>
      </div>
      <p className="mb-5 text-[12.5px] text-amber-700">
        Follow the 4 steps below to connect it to your agent. {!isRotate && <>To see it again later, use <b>Reveal</b> (requires your 2FA code).</>}
      </p>

      {/* Step 1 — copy the key */}
      <Step n="1" title="Copy your API key">
        <div className="flex items-center gap-2 rounded-[10px] border border-amber-200 bg-white px-4 py-3">
          <span className="flex-1 break-all font-mono text-[13px] text-ink">{apiKey}</span>
          <CopyBtn text={apiKey} />
        </div>
        {agentAddress && (
          <div className="mt-2 text-[12px] text-amber-700">
            Signing wallet: <span className="font-mono">{agentAddress}</span> — this is where your earnings land.
          </div>
        )}
      </Step>

      {/* Step 2 — copy the config (skill) */}
      <Step n="2" title="Copy the Obol MCP config below">
        <div className="relative rounded-[10px] border border-amber-200 bg-white">
          <pre className="overflow-x-auto px-4 py-3 text-[12px] text-ink">{mcpConfig}</pre>
          <div className="absolute right-3 top-3">
            <CopyBtn text={mcpConfig} />
          </div>
        </div>
      </Step>

      {/* Step 3 — give to agent */}
      <Step n="3" title="Give it to your agent">
        <p className="text-[13px] leading-[1.55] text-amber-800">
          Tell your agent (Claude, Cursor, ChatGPT, or any MCP client): <em>&ldquo;Add this to my MCP config file and paste my key in.&rdquo;</em> The agent
          writes the config above into its <code className="rounded bg-amber-100 px-1.5 py-0.5 font-mono text-[12px]">mcp.json</code> (or <code className="rounded bg-amber-100 px-1.5 py-0.5 font-mono text-[12px]">claude_desktop_config.json</code>) and drops your key into the <code className="rounded bg-amber-100 px-1.5 py-0.5 font-mono text-[12px]">OBOL_API_KEY</code> field.
        </p>
      </Step>

      {/* Step 4 — restart */}
      <Step n="4" title="Restart your agent" last>
        <p className="text-[13px] leading-[1.55] text-amber-800">
          Restart the app so it loads the new config. Obol is now wired in — your agent can discover services, pay per call in USDC,
          and list your own services for sale. <b>That&apos;s it.</b>
        </p>
      </Step>

      {/* Dismiss */}
      <div className="mt-5 flex items-center gap-3">
        <button
          onClick={onDismiss}
          className="rounded-[10px] bg-amber-100 border border-amber-300 px-4 py-2 text-[13px] font-semibold text-amber-900 hover:bg-amber-200 transition"
        >
          I&apos;ve saved it — dismiss
        </button>
      </div>
    </div>
  );
}

// ─── Build with AI — Obol Skill card (gradient, matches dashboard + home) ──────
function ObolSkillCard({ sellerAddr }: { sellerAddr: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(buildObolSkill(sellerAddr || "your-arc-wallet-address")).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }
  return (
    <div className="relative mb-8 overflow-hidden rounded-[24px] border border-[#6d5ef6]/30 bg-gradient-to-br from-[#0c0a1f] to-[#1a1340] p-8 text-white shadow-[0_20px_60px_rgba(109,94,246,.18)]">
      <div className="pointer-events-none absolute -right-16 -top-16 h-[240px] w-[240px] rounded-full bg-[#6d5ef6]/25 blur-[70px]" />
      <div className="relative">
        <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[.06] px-3 py-1 text-[11px] font-bold uppercase tracking-[.06em] text-[#cfd2ff]">
          Build with AI · 2-min setup
        </div>
        <h3 className="text-[24px] font-extrabold tracking-[-.03em]">
          Don&apos;t write code. Let your AI build the service.
        </h3>
        <p className="mt-2.5 max-w-[560px] text-[14px] leading-relaxed text-[#a9abbd]">
          Copy the Obol Skill and paste it into <b className="text-white">Claude, ChatGPT, or Cursor</b>.
          Your Arc payout address is already baked in — your AI will scaffold, wire, and deploy a live paid API for you.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <button
            onClick={copy}
            className="grad inline-flex items-center gap-2 rounded-[10px] px-5 py-2.5 text-[14px] font-bold text-white shadow-[0_4px_14px_rgba(109,94,246,.4)] transition hover:-translate-y-px"
          >
            {copied ? "Copied to clipboard ✓" : "Copy the Obol Skill"}
          </button>
          <Link href="/docs#ai-quickstart" className="inline-flex items-center gap-2 rounded-[10px] border border-white/20 bg-white/[.07] px-5 py-2.5 text-[14px] font-semibold text-white transition hover:bg-white/[.14]">
            Full docs →
          </Link>
        </div>
      </div>
    </div>
  );
}

function Step({ n, title, children, last }: { n: string; title: string; children: React.ReactNode; last?: boolean }) {
  return (
    <div className="flex gap-3.5">
      <div className="flex flex-col items-center">
        <div className="grad flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[13px] font-bold text-white">{n}</div>
        {!last && <div className="mt-1 w-px flex-1 bg-amber-300" />}
      </div>
      <div className={last ? "pb-0" : "pb-5"}>
        <div className="mb-2 text-[14px] font-bold text-amber-900">{title}</div>
        {children}
      </div>
    </div>
  );
}

function CopyBtn({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button"
      onClick={async () => { await navigator.clipboard.writeText(text).catch(() => {}); setDone(true); setTimeout(() => setDone(false), 1200); }}
      className="shrink-0 rounded-[8px] border border-hairline px-3 py-2 text-[12px] font-semibold text-muted hover:border-primary hover:text-primary">
      {done ? "Copied ✓" : "Copy"}
    </button>
  );
}
