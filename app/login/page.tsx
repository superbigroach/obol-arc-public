"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/components/AuthProvider";
import { LogoMark, HeroCoin } from "@/components/Logo";
import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";

export default function LoginPage() {
  const { user, loading, configured, signInWithGoogle } = useAuth();
  const router = useRouter();
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (!loading && user) {
      setChecking(true);
      // Check if user has any API keys (first-time check)
      httpsCallable<unknown, { count: number }>(functions, "getMyApiKeys")()
        .then(res => {
          const hasKeys = (res.data as any)?.length > 0;
          router.replace(hasKeys ? "/dashboard" : "/settings");
        })
        .catch(() => router.replace("/settings")); // Default to setup on error
    }
  }, [user, loading, router]);

  return (
    <main className="grid min-h-screen md:grid-cols-2">
      {/* left: glowing brand panel */}
      <div className="hero-card hidden flex-col justify-between rounded-none p-12 md:flex">
        <Link href="/" className="relative z-[2] flex items-center gap-2.5 text-[20px] font-extrabold text-white">
          <LogoMark /> Obol
        </Link>
        <div className="relative z-[2] flex flex-1 items-center justify-center">
          <div className="coin-glow" />
          <HeroCoin />
        </div>
        <div className="relative z-[2]">
          <p className="text-[22px] font-bold leading-snug text-white">Agents buy from agents.</p>
          <p className="mt-1 text-[15px] text-[#a9abbd]">The marketplace for the agent economy.</p>
        </div>
      </div>

      {/* right: sign-in */}
      <div className="flex items-center justify-center bg-base2 px-6 py-12">
        <div className="w-full max-w-[380px]">
          <Link href="/" className="mb-8 flex items-center gap-2.5 text-[20px] font-extrabold md:hidden">
            <LogoMark /> Obol
          </Link>
          <h1 className="text-[28px] font-extrabold tracking-[-.03em]">Welcome to Obol</h1>
          <p className="mt-2 text-[15px] text-muted">Sign in to sell a service or fund your agent.</p>

          <button
            onClick={() => signInWithGoogle()}
            className="mt-8 flex w-full items-center justify-center gap-3 rounded-[12px] border border-hairline bg-white px-5 py-3.5 text-[15px] font-semibold shadow-soft transition hover:-translate-y-px hover:shadow-lg2"
          >
            <GoogleIcon /> Continue with Google
          </button>

          {!configured && (
            <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-800">
              Firebase keys aren&apos;t loaded yet. Add them to <code>.env.local</code> and restart the dev server.
            </p>
          )}

          <p className="mt-6 text-[13px] leading-relaxed text-muted">
            By continuing you agree to Obol&apos;s Terms and acknowledge the Privacy Policy. Your
            wallet stays self-custody — we never hold your keys.
          </p>

          <Link href="/" className="mt-8 inline-block text-[14px] font-medium text-primary hover:underline">← Back to home</Link>
        </div>
      </div>
    </main>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.3-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19 13 24 13c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2c-2 1.5-4.6 2.4-7.2 2.4-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.6 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.2 4.2-4.1 5.6l6.2 5.2c-.4.4 6.6-4.8 6.6-14.8 0-1.3-.1-2.3-.4-3.5z" />
    </svg>
  );
}
