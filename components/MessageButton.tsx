"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { initiateThread } from "@/lib/messages";
import { getProfile } from "@/lib/clientStore";

type Props = {
  sellerUid: string;
  sellerName: string;
  serviceId: string;
  serviceName: string;
  schedulingUrl?: string;
  className?: string;
};

export default function MessageButton({ sellerUid, sellerName, serviceId, serviceName, schedulingUrl, className = "" }: Props) {
  const { user } = useAuth();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function send() {
    if (!user) { router.push("/login"); return; }
    if (!body.trim()) { setErr("Write a message first."); return; }
    setSending(true); setErr(null);
    try {
      const profile = await getProfile(user.uid).catch(() => null);
      const name = profile?.username ? `@${profile.username}`
        : profile?.companyName || profile?.displayName
        || user.email?.split("@")[0] || "Someone";
      await initiateThread(user.uid, name, sellerUid, sellerName, serviceId, serviceName, body.trim());
      setSent(true);
      setTimeout(() => { setOpen(false); setSent(false); setBody(""); router.push("/messages"); }, 1800);
    } catch (e) {
      setErr((e as Error).message);
    } finally { setSending(false); }
  }

  return (
    <>
      <div className={`flex flex-wrap items-center gap-3 ${className}`}>
        <button
          type="button"
          onClick={() => user ? setOpen(true) : router.push("/login")}
          className="inline-flex items-center gap-2 rounded-[10px] border border-hairline bg-white px-4 py-2.5 text-[14px] font-semibold text-ink shadow-soft transition hover:border-primary hover:text-primary"
        >
          Message seller
        </button>
        {schedulingUrl && (
          <a
            href={schedulingUrl} target="_blank" rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-[10px] border border-hairline bg-white px-4 py-2.5 text-[14px] font-semibold text-ink shadow-soft transition hover:border-primary hover:text-primary"
          >
            Book a meeting →
          </a>
        )}
      </div>

      {open && (
        <div
          className="fixed inset-0 z-[999] flex items-end justify-center bg-black/40 p-4 sm:items-center"
          onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
        >
          <div className="w-full max-w-[480px] rounded-[20px] border border-hairline bg-white p-7 shadow-[0_20px_60px_rgba(0,0,0,.18)]">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-[18px] font-bold tracking-[-.02em]">Message {sellerName}</div>
                <div className="mt-0.5 text-[13px] text-muted">Re: {serviceName}</div>
              </div>
              <button onClick={() => setOpen(false)} className="rounded-full p-1.5 text-muted hover:bg-base2 hover:text-ink">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
              </button>
            </div>

            {sent ? (
              <div className="mt-6 rounded-[12px] bg-[rgba(21,194,107,.12)] p-5 text-center text-[15px] font-semibold text-success">
                Sent! Taking you to your inbox…
              </div>
            ) : (
              <>
                <textarea
                  autoFocus
                  value={body}
                  onChange={(e) => { setBody(e.target.value); setErr(null); }}
                  placeholder={`Ask ${sellerName} about integration, pricing, or custom use cases…`}
                  rows={5}
                  className="mt-5 w-full resize-none rounded-[12px] border border-hairline bg-white px-4 py-3 text-[15px] shadow-soft outline-none focus:border-primary"
                />
                {err && <p className="mt-2 text-[13px] text-red-600">{err}</p>}
                <div className="mt-4 flex items-center justify-between">
                  <button onClick={() => setOpen(false)} className="text-[14px] font-medium text-muted hover:text-ink">Cancel</button>
                  <button
                    onClick={send} disabled={sending || !body.trim()}
                    className="grad rounded-[10px] px-5 py-2.5 text-[14px] font-semibold text-white disabled:opacity-60"
                  >
                    {sending ? "Sending…" : "Send message"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
