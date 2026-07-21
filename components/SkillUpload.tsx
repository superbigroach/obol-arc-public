// Upload a self-describing "skill" file (Markdown / OpenAPI) for a service so
// agents know how to call it. Stores under skills/{uid} and returns the URL.
"use client";

import { useState } from "react";
import { uploadSkill } from "@/lib/storage";

// kind "spec" = OpenAPI (machine-readable → agent-ready); "doc" = human docs (md/pdf).
export default function SkillUpload({ uid, onUploaded }: { uid: string; onUploaded: (url: string, kind: "spec" | "doc") => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const input = "w-full rounded-[10px] border border-hairline px-3.5 py-2.5 text-[14px] outline-none focus:border-primary";

  async function upload() {
    if (!file) return;
    setBusy(true); setError(null);
    try {
      const u = await uploadSkill(uid, file);
      setUrl(u);
      const ext = file.name.toLowerCase().split(".").pop() || "";
      const kind: "spec" | "doc" = ["json", "yaml", "yml"].includes(ext) ? "spec" : "doc";
      onUploaded(u, kind);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sm:col-span-2 flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="file"
          accept=".md,.json,.yaml,.yml,.pdf"
          onChange={(e) => { setFile(e.target.files?.[0] ?? null); setUrl(null); }}
          className={`${input} flex-1 file:mr-3 file:rounded-[8px] file:border-0 file:bg-base2 file:px-3 file:py-1.5 file:text-[13px] file:font-semibold`}
          title="OpenAPI (.json/.yaml) → agent-ready · Markdown/PDF → human docs"
        />
        <button
          type="button"
          disabled={!file || busy}
          onClick={upload}
          className="rounded-[10px] border border-hairline px-4 py-2.5 text-[14px] font-semibold hover:bg-base2 disabled:opacity-60"
        >
          {busy ? "Uploading…" : "Upload skill"}
        </button>
      </div>
      {url && (
        <a href={url} target="_blank" rel="noreferrer" className="truncate text-[12.5px] text-primary hover:underline">
          {url}
        </a>
      )}
      {error && <p className="text-[12.5px] text-red-600">{error}</p>}
    </div>
  );
}
