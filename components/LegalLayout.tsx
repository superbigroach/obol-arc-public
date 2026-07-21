import SiteNav from "@/components/SiteNav";
import SiteFooter from "@/components/SiteFooter";

/** Shared shell for legal pages (privacy, terms, DPA). */
export default function LegalLayout({
  title,
  updated,
  intro,
  children,
}: {
  title: string;
  updated: string;
  intro?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-white">
      <SiteNav />
      <main className="mx-auto max-w-[820px] px-6 py-14">
        <h1 className="text-[34px] font-extrabold tracking-[-.03em] text-ink md:text-[42px]">{title}</h1>
        <p className="mt-2 text-[13px] font-medium uppercase tracking-[.06em] text-muted">Last updated {updated}</p>
        {intro && <p className="mt-6 text-[16px] leading-relaxed text-zinc-600">{intro}</p>}
        <div className="legal mt-8 space-y-7 text-[15px] leading-relaxed text-zinc-700">{children}</div>
      </main>
      <SiteFooter />
    </div>
  );
}

export function Section({ id, h, children }: { id?: string; h: string; children: React.ReactNode }) {
  return (
    <section id={id}>
      <h2 className="mb-2 text-[20px] font-bold tracking-[-.02em] text-ink">{h}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}
