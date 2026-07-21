import Link from "next/link";
import { LogoMark } from "@/components/Logo";

export default function SiteFooter() {
  return (
    <footer className="border-t border-hairline bg-white py-10">
      <div className="mx-auto grid max-w-[1180px] grid-cols-1 items-center gap-5 px-6 text-sm text-muted md:grid-cols-3">
        <span className="flex items-center justify-center gap-2 text-[18px] font-extrabold text-ink md:justify-self-start">
          <LogoMark size={22} /> Obol
        </span>
        <div className="flex flex-wrap justify-center gap-x-6 gap-y-2">
          <Link href="/marketplace" className="hover:text-ink">Marketplace</Link>
          <Link href="/#pricing" className="hover:text-ink">Pricing</Link>
          <Link href="/docs" className="hover:text-ink">Docs</Link>
          <Link href="/privacy" className="hover:text-ink">Privacy</Link>
          <Link href="/terms" className="hover:text-ink">Terms</Link>
          <Link href="/dpa" className="hover:text-ink">DPA</Link>
        </div>
        <div className="text-center md:justify-self-end md:text-right">© 2026 Obol · Agents buy from agents.</div>
      </div>
    </footer>
  );
}
