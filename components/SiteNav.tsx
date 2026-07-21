"use client";

import { Suspense } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Wordmark } from "@/components/Logo";
import { useAuth } from "@/components/AuthProvider";
import AccountMenu from "@/components/AccountMenu";

export default function SiteNav() {
  return (
    <Suspense fallback={<NavShell />}>
      <SiteNavInner />
    </Suspense>
  );
}

// Bare shell shown while the search-params-dependent nav hydrates
function NavShell() {
  return (
    <nav className="sticky top-0 z-50 border-b border-hairline bg-white/90 backdrop-blur-md">
      <div className="mx-auto flex h-[68px] max-w-[1180px] items-center gap-6 px-6">
        <Link href="/" className="shrink-0"><Wordmark /></Link>
      </div>
    </nav>
  );
}

function SiteNavInner() {
  const { user } = useAuth();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Marketing nav (logged out) — section anchors on the home page
  const homeNavLinks = [
    { href: "/#what",    label: "What you can sell" },
    { href: "/#how",     label: "How it works" },
    { href: "/#pricing", label: "Pricing" },
  ];

  // App nav (logged in) — identical on EVERY page.
  // Normalize trailing slash (next.config has trailingSlash: true → "/dashboard/").
  const path = (pathname ?? "/").replace(/\/+$/, "") || "/";
  const onDashboard = path === "/dashboard";
  const activeTab = searchParams?.get("tab") ?? "use";

  return (
    <nav className="sticky top-0 z-50 border-b border-hairline bg-white/90 backdrop-blur-md">
      <div className="mx-auto flex h-[68px] max-w-[1180px] items-center gap-6 px-6">
        <Link href={user ? "/dashboard" : "/"} className="shrink-0">
          <Wordmark />
        </Link>

        {user ? (
          /* ── Logged-in nav: same on every page, uniform links, equal spacing ── */
          <>
            <div className="ml-4 hidden items-center gap-1.5 md:flex">
              {[
                { href: "/dashboard?tab=use",     label: "Use services",     active: onDashboard && activeTab === "use" },
                { href: "/dashboard?tab=provide", label: "Provide services", active: onDashboard && activeTab === "provide" },
                { href: "/marketplace",           label: "Marketplace",      active: path.startsWith("/marketplace") },
                { href: "/settings",              label: "Keys",             active: path.startsWith("/settings") },
                { href: "/docs",                  label: "Docs",             active: path.startsWith("/docs") },
              ].map(item => (
                <Link key={item.label} href={item.href}
                  className={`rounded-[9px] px-3.5 py-2 text-[14.5px] font-medium transition ${
                    item.active ? "grad text-white shadow-[0_2px_8px_rgba(109,94,246,.3)]" : "text-muted hover:bg-base2 hover:text-ink"
                  }`}>
                  {item.label}
                </Link>
              ))}
            </div>

            <div className="ml-auto flex items-center gap-3">
              <AccountMenu uid={user.uid} />
            </div>
          </>
        ) : (
          /* ── Logged-out marketing nav ── */
          <>
            <div className="ml-2 hidden gap-6 md:flex">
              {homeNavLinks.map(link => (
                <Link key={link.href} href={link.href}
                  className="text-[15px] font-medium text-muted transition hover:text-ink">
                  {link.label}
                </Link>
              ))}
              <Link href="/marketplace"
                className={`text-[15px] font-medium transition ${pathname?.startsWith("/marketplace") ? "text-primary" : "text-muted hover:text-ink"}`}>
                Marketplace
              </Link>
              <Link href="/docs"
                className={`text-[15px] font-medium transition ${pathname?.startsWith("/docs") ? "text-primary" : "text-muted hover:text-ink"}`}>
                Docs
              </Link>
            </div>

            <div className="ml-auto flex items-center gap-3">
              <Link href="/login" className="text-[15px] font-medium text-muted hover:text-ink">Log in</Link>
              <Link href="/login" className="grad rounded-[10px] px-[18px] py-2.5 text-[15px] font-semibold text-white shadow-[0_4px_14px_rgba(109,94,246,.35)] transition hover:-translate-y-px">
                Get started →
              </Link>
            </div>
          </>
        )}
      </div>
    </nav>
  );
}
