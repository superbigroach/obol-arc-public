"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useAuth } from "@/components/AuthProvider";
import { ContactModal } from "@/app/components/ContactModal";
import { getTotalUnread } from "@/lib/messages";
import { getProfile } from "@/lib/clientStore";

function Avatar({ src, name, email, size = 32 }: { src?: string | null; name?: string | null; email?: string | null; size?: number }) {
  const initial = ((name || email || "U").trim()[0] || "U").toUpperCase();
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" width={size} height={size} className="rounded-full border border-hairline object-cover" style={{ width: size, height: size }} />;
  }
  return (
    <div className="grad flex shrink-0 items-center justify-center rounded-full text-white font-bold" style={{ width: size, height: size, fontSize: size * 0.4 }}>
      {initial}
    </div>
  );
}

export default function AccountMenu({ uid }: { uid: string }) {
  const { user, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(user?.photoURL ?? null);
  const [displayName, setDisplayName] = useState(user?.displayName ?? "");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getTotalUnread(uid).then(setUnread).catch(() => {});
    getProfile(uid).then(p => {
      if (p?.logoUrl || p?.avatarUrl) setAvatarUrl(p.logoUrl || p.avatarUrl!);
      const handle = p?.username ? `@${p.username}`
        : p?.companyName || p?.displayName
        || user?.email?.split("@")[0] || "";
      if (handle) setDisplayName(handle);
    }).catch(() => {});
  }, [uid, user?.email]);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const name = displayName || user?.displayName || user?.email?.split("@")[0] || "Account";
  const email = user?.email ?? "";

  const items = [
    { href: "/dashboard", label: "Dashboard" },
    { href: "/profile",   label: "Profile" },
    { href: "/settings",  label: "Keys" },
    { href: "/messages",  label: "Messages", badge: unread > 0 ? unread : null },
    { href: "/docs",      label: "Docs" },
  ];

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 rounded-full border border-hairline bg-white px-2 py-1.5 shadow-sm transition hover:border-primary/40"
      >
        <Avatar src={avatarUrl} name={name} email={email} size={28} />
        <span className="hidden max-w-[110px] truncate text-[13px] font-semibold text-ink sm:block">{name}</span>
        <svg className={`h-3.5 w-3.5 text-muted transition-transform ${open ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
        {unread > 0 && (
          <span className="grad absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-[calc(100%+8px)] z-50 w-[220px] overflow-hidden rounded-[16px] border border-hairline bg-white shadow-[0_12px_40px_rgba(0,0,0,.12)]">
          <div className="flex items-center gap-3 border-b border-hairline px-4 py-3">
            <Avatar src={avatarUrl} name={name} email={email} size={36} />
            <div className="min-w-0">
              <div className="truncate text-[13px] font-bold text-ink">{name}</div>
              <div className="truncate text-[11px] text-muted">{email}</div>
            </div>
          </div>
          <div className="py-1.5">
            {items.map(item => (
              <Link key={item.href} href={item.href} onClick={() => setOpen(false)}
                className="flex items-center gap-2.5 px-4 py-2 text-[13.5px] text-ink hover:bg-base2">
                <span className="flex-1">{item.label}</span>
                {item.badge && (
                  <span className="grad flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-bold text-white">
                    {item.badge > 9 ? "9+" : item.badge}
                  </span>
                )}
              </Link>
            ))}
          </div>
          <div className="border-t border-hairline py-1.5">
            <button onClick={() => { setOpen(false); setContactOpen(true); }}
              className="flex w-full items-center gap-2.5 px-4 py-2 text-[13.5px] text-ink hover:bg-base2">
              Contact
            </button>
            <button onClick={() => { setOpen(false); signOut(); }}
              className="flex w-full items-center gap-2.5 px-4 py-2 text-[13.5px] text-red-600 hover:bg-red-50">
              Sign out
            </button>
          </div>
        </div>
      )}

      {contactOpen && <ContactModal onClose={() => setContactOpen(false)} />}
    </div>
  );
}
