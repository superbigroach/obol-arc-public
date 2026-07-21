"use client";

import { useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { connectGithub, connectX, connectLinkedIn } from "@/lib/socialAuth";
import { saveProfile, logEvent, type Socials } from "@/lib/clientStore";

type Props = {
  socials?: Socials;
  onConnected?: () => void;
};

const BTN =
  "grad w-full inline-flex items-center justify-center gap-2 rounded-[10px] border border-hairline px-4 py-2.5 text-[14px] font-semibold text-white disabled:opacity-60";

export default function SocialConnect({ socials, onConnected }: Props) {
  const { user } = useAuth();
  const [busy, setBusy] = useState<"github" | "x" | "linkedin" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [github, setGithub] = useState<string | undefined>(socials?.github);
  const [x, setX] = useState<string | undefined>(socials?.x);
  const [linkedin, setLinkedin] = useState<string | undefined>(socials?.linkedin);

  async function connect(which: "github" | "x" | "linkedin") {
    if (!user) { setError("Sign in first."); return; }
    setBusy(which); setError(null);
    try {
      const fn = which === "github" ? connectGithub : which === "x" ? connectX : connectLinkedIn;
      const { handle } = await fn(user);
      const nextSocials: Socials = {
        ...(socials ?? {}),
        ...(which === "github" ? { github: handle } : which === "x" ? { x: handle } : { linkedin: handle }),
      };
      await saveProfile(user.uid, { socials: nextSocials });
      await logEvent(user.uid, "social_connected", which, null);
      if (which === "github") setGithub(handle);
      else if (which === "x") setX(handle);
      else setLinkedin(handle);
      onConnected?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      {(github || x || linkedin) && (
        <div className="rounded-[14px] border border-hairline bg-base2 p-4">
          <div className="mb-2.5 text-[12px] font-semibold uppercase tracking-[.05em] text-muted">Connected accounts</div>
          <div className="flex flex-wrap gap-2">
            {github && (
              <a href={`https://github.com/${github}`} target="_blank" rel="noreferrer"
                 className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-white px-3 py-1.5 text-[13px] font-semibold text-ink transition hover:border-primary hover:text-primary">
                GH · {github} ↗
              </a>
            )}
            {x && (
              <a href={`https://x.com/${x}`} target="_blank" rel="noreferrer"
                 className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-white px-3 py-1.5 text-[13px] font-semibold text-ink transition hover:border-primary hover:text-primary">
                X · @{x} ↗
              </a>
            )}
            {linkedin && (
              <a href={`https://linkedin.com/in/${linkedin}`} target="_blank" rel="noreferrer"
                 className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-white px-3 py-1.5 text-[13px] font-semibold text-ink transition hover:border-primary hover:text-primary">
                in · {linkedin} ↗
              </a>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-3 gap-3">
        <div className="flex flex-col gap-1.5">
          <button type="button" onClick={() => connect("github")} disabled={busy !== null} className={BTN}>
            {busy === "github" ? "Connecting…" : github ? "Reconnect GitHub" : "Connect GitHub"}
          </button>
          {github && (
            <a href={`https://github.com/${github}`} target="_blank" rel="noreferrer" className="text-center text-[12px] font-semibold text-primary hover:underline">
              github.com/{github} ↗
            </a>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <button type="button" onClick={() => connect("x")} disabled={busy !== null} className={BTN}>
            {busy === "x" ? "Connecting…" : x ? "Reconnect X" : "Connect X"}
          </button>
          {x && (
            <a href={`https://x.com/${x}`} target="_blank" rel="noreferrer" className="text-center text-[12px] font-semibold text-primary hover:underline">
              x.com/{x} ↗
            </a>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <button type="button" onClick={() => connect("linkedin")} disabled={busy !== null} className={BTN}>
            {busy === "linkedin" ? "Connecting…" : linkedin ? "Reconnect LinkedIn" : "Connect LinkedIn"}
          </button>
          {linkedin && (
            <a href={`https://linkedin.com/in/${linkedin}`} target="_blank" rel="noreferrer" className="text-center text-[12px] font-semibold text-primary hover:underline">
              linkedin.com/in/{linkedin} ↗
            </a>
          )}
        </div>
      </div>

      {error && <span className="mt-1 block text-[13px] text-red-600">{error}</span>}
    </div>
  );
}
