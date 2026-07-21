import Link from "next/link";
import SiteNav from "@/components/SiteNav";
import SiteFooter from "@/components/SiteFooter";
import { HeroCoin } from "@/components/Logo";
import { ContactButton } from "./components/ContactModal";

export default function Home() {
  return (
    <main>
      <SiteNav />

      {/* HERO */}
      <section className="pt-7 pb-16">
        <div className="mx-auto max-w-[1180px] px-6">
          <div className="hero-card px-8 py-16 md:px-16 md:py-[88px] animate-fade-in-up">
            <div className="relative z-[2] grid items-center gap-10 md:grid-cols-[1.18fr_.82fr]">
              <div>
                <span className="mb-6 inline-flex items-center gap-2 rounded-full border border-[rgba(109,94,246,.35)] bg-[rgba(109,94,246,.18)] px-3.5 py-1.5 text-[13px] font-semibold text-[#cfd2ff] animate-fade-in-down animate-delay-100">
                  <span className="h-[7px] w-[7px] rounded-full bg-glow shadow-[0_0_10px_#3b9eff] animate-pulse-glow" />
                  Built on Circle &amp; Arc · Live on Base · Arc mainnet soon
                </span>
                <h1 className="mb-5 text-[46px] font-extrabold leading-[1.02] tracking-[-.038em] text-white md:text-[66px] animate-fade-in-up animate-delay-200">
                  The app store<br /><span className="grad-text text-gradient-animated">for AI agents.</span>
                </h1>
                <p className="mb-8 max-w-[540px] text-[19px] leading-[1.55] text-[#a9abbd] animate-fade-in-up animate-delay-300">
                  One MCP install and your agent can discover, trust, and pay for any service — in USDC, gasless, from $0.000001. List your API once; every agent can buy it.
                </p>
                <p className="mb-8 max-w-[540px] text-[16px] leading-[1.55] text-[#71748a] animate-fade-in-up animate-delay-400">
                  <span className="font-semibold text-white">Works with any agent, any MCP, any chain.</span> APIs, bots, data feeds, models — anything callable, instantly monetized.
                </p>
                <div className="flex flex-wrap gap-3.5 animate-fade-in-up animate-delay-400">
                  <Link href="/login" className="grad inline-flex items-center gap-2 rounded-[10px] px-[20px] py-3 text-[15px] font-semibold text-white shadow-[0_4px_14px_rgba(109,94,246,.35)] transition hover:-translate-y-px button-glow hover-lift">
                    Start selling →
                  </Link>
                  <Link href="/marketplace" className="inline-flex items-center gap-2 rounded-[10px] border border-white/[.18] bg-white/[.08] px-[20px] py-3 text-[15px] font-semibold text-white transition hover:bg-white/[.14] hover-glow">
                    Browse the marketplace
                  </Link>
                </div>
                <div className="mt-8 flex flex-wrap gap-5 text-[13.5px] text-[#71748a] animate-fade-in-up animate-delay-500">
                  <span className="flex items-center gap-1.5"><span className="text-glow animate-bounce-subtle">✓</span> 0% commission — keep 100%</span>
                  <span className="flex items-center gap-1.5"><span className="text-glow animate-bounce-subtle">✓</span> No keys, no accounts</span>
                  <span className="flex items-center gap-1.5"><span className="text-glow animate-bounce-subtle">✓</span> Gas-free, from $0.000001</span>
                </div>
              </div>
              <div className="relative flex min-h-[300px] items-center justify-center animate-fade-in-right animate-delay-300">
                <div className="coin-glow animate-pulse-glow" />
                <div className="animate-float">
                  <HeroCoin />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>


      {/* TECH STACK */}
      <div className="border-t border-hairline bg-white py-[30px]">
        <div className="mx-auto flex max-w-[1180px] flex-wrap items-center justify-center gap-3.5 px-6 text-sm font-medium text-muted">
          <span>Powered by</span> <b className="text-ink">Circle Nanopayments</b> <span>·</span>
          <b className="text-ink">Gateway</b> <span>·</span> <b className="text-ink">x402</b> <span>·</span>
          <span>Settled on</span> <b className="text-ink">Arc</b>
        </div>
      </div>

      {/* SUPPORTED NETWORKS — verified against Circle Gateway supported-blockchains.
          "Live rail" = where per-call payments run today; "Fund from" = chains whose
          USDC deposits into the one unified Gateway balance. Update as Circle expands. */}
      <div className="border-y border-hairline bg-white py-[42px]">
        <div className="mx-auto max-w-[1180px] px-6">
          <div className="text-center">
            <span className="text-[11.5px] font-bold uppercase tracking-[.14em] text-muted">Available across 10 networks</span>
          </div>
          <div className="mx-auto mt-5 flex max-w-[900px] flex-wrap items-center justify-center gap-2.5">
            {[
              { name: "Arc", img: "/networks/arc.webp", settle: true },
              { name: "Base", img: "/networks/base.webp" },
              { name: "Ethereum", img: "/networks/ethereum.webp" },
              { name: "Arbitrum", img: "/networks/arbitrum.webp" },
              { name: "Optimism", img: "/networks/optimism.webp" },
              { name: "Polygon", img: "/networks/polygon.webp" },
              { name: "Avalanche", img: "/networks/avalanche.webp" },
              { name: "Unichain", img: "/networks/unichain.webp" },
              { name: "Monad", img: "/networks/monad.webp" },
              { name: "Solana", img: "/networks/solana.webp" },
            ].map((n) => (
              <div key={n.name}
                className={`flex items-center gap-2 rounded-full border px-3.5 py-2 transition ${n.settle
                  ? "border-[rgba(21,194,107,.4)] bg-[rgba(21,194,107,.08)]"
                  : "border-hairline bg-white hover:border-primary/40"}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={n.img} alt={`${n.name} logo`} width={22} height={22} loading="lazy"
                  className="h-[22px] w-[22px] rounded-full object-cover" />
                <span className="text-[13px] font-semibold text-ink">{n.name}</span>
                {n.settle && <span className="text-[10px] font-bold uppercase tracking-wide text-success">settles here</span>}
              </div>
            ))}
          </div>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2 text-muted">
            <span className="text-[12.5px]">Powered by</span>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/networks/circle.svg" alt="Circle logo" width={18} height={18} className="h-[18px] w-[18px]" />
            <span className="text-[13px] font-bold text-ink">Circle</span>
            <span className="text-[12.5px]">Gateway — one unified USDC balance, deposit from any chain, gasless settlement on Arc.</span>
          </div>
        </div>
      </div>


      {/* THE WEDGE — one punch, no defensive table */}
      <section className="py-[96px]">
        <div className="mx-auto max-w-[920px] px-6 text-center">
          <div className="mb-5 text-[13px] font-bold uppercase tracking-[.08em] text-primary">The difference</div>
          <h2 className="text-[34px] font-extrabold leading-[1.12] tracking-[-.03em] md:text-[48px]">
            Every other platform requires<br className="hidden md:block" /> a human: to apply, paste a key, approve charges.
          </h2>
          <h2 className="mt-2 text-[34px] font-extrabold leading-[1.12] tracking-[-.03em] md:text-[48px]">
            <span className="grad-text">Obol skips the human entirely.</span>
          </h2>
          <p className="mx-auto mt-7 max-w-[600px] text-[18.5px] leading-[1.55] text-muted">
            No applications, no API-key spreadsheets, no approval clicks, no monthly bills.
            <span className="font-semibold text-ink"> Just your endpoint and a price — the agent does the rest.</span>
          </p>
        </div>
      </section>

      {/* AGENTS HIRE AGENTS — the moat */}
      <div className="dark-glow py-[88px] text-white">
        <div className="relative mx-auto max-w-[1180px] px-6">
          <div className="mb-3.5 text-center text-[13px] font-bold uppercase tracking-[.08em] text-[#8b8fff]">It&apos;s not a marketplace. It&apos;s an economy.</div>
          <h2 className="mb-12 text-center text-[32px] font-extrabold tracking-[-.03em] md:text-[44px]">
            Agents hire agents.
          </h2>
          <div className="mx-auto flex max-w-[920px] flex-col items-stretch gap-3 md:flex-row md:items-stretch md:justify-center">
            {[
              { who: "Research agent", do: "needs a web page", pay: "", tag: "THE BUYER" },
              { who: "Scraper agent", do: "returns clean data", pay: "$0.002", tag: "" },
              { who: "Parser agent", do: "structures it", pay: "$0.005", tag: "" },
              { who: "Summarizer agent", do: "compresses it", pay: "$0.01", tag: "" },
            ].map((step, i, arr) => (
              <div key={step.who} className="contents">
                <div className="flex flex-1 flex-col items-center justify-center rounded-[16px] border border-white/[.12] bg-white/[.05] px-5 py-6 text-center">
                  <div className="text-[15px] font-bold text-white">{step.who}</div>
                  <div className="mt-1 text-[13px] text-[#9a9cb0]">{step.do}</div>
                  {step.pay ? (
                    <div className="mt-3 inline-block rounded-full bg-[rgba(59,158,255,.16)] px-2.5 py-0.5 text-[12px] font-bold text-glow">{step.pay} USDC</div>
                  ) : (
                    <div className="mt-3 inline-block rounded-full bg-[rgba(109,94,246,.18)] px-2.5 py-0.5 text-[12px] font-bold text-[#b3a9ff]">{step.tag}</div>
                  )}
                </div>
                {i < arr.length - 1 && <div className="hidden shrink-0 items-center text-[22px] text-[#5a5d75] md:flex">→</div>}
              </div>
            ))}
          </div>
          <p className="mx-auto mt-10 max-w-[620px] text-center text-[17px] text-[#9a9cb0]">
            One agent conversation. A four-link supply chain. Every payment on-chain, automatic, sub-cent —
            and <span className="font-semibold text-white">not a single human approved any of it.</span>
          </p>
        </div>
      </div>

      {/* THE CAPABILITY — give your agent a wallet (the moat) */}
      <section className="py-[96px]">
        <div className="mx-auto max-w-[920px] px-6 text-center">
          <div className="mb-5 text-[13px] font-bold uppercase tracking-[.08em] text-primary">The moat</div>
          <h2 className="text-[34px] font-extrabold leading-[1.12] tracking-[-.03em] md:text-[48px]">
            Give your agent a wallet —<br /><span className="grad-text">and a store to spend it in.</span>
          </h2>
          <p className="mx-auto mt-7 max-w-[640px] text-[18.5px] leading-[1.55] text-muted">
            One MCP install, and your agent can <span className="font-semibold text-ink">find, pay for, and use thousands of tools</span> — on its own. It buys what it needs mid-task: a scrape, a dataset, a model. Gasless, no keys, no fees, spending limits you set.
          </p>
          <p className="mx-auto mt-4 max-w-[640px] text-[16px] leading-[1.55] text-muted">
            Not a directory your agent <em>visits</em> — a wallet and a storefront <span className="font-semibold text-ink">inside the LLM</span>. Fund from any chain (Base, Solana, more) into one unified balance; payments settle on Arc — no side to pick.
          </p>
        </div>
      </section>

      {/* TRUST — beats a free directory */}
      <section className="py-[88px] bg-base2">
        <div className="mx-auto max-w-[1180px] px-6">
          <div className="mb-3.5 text-center text-[13px] font-bold uppercase tracking-[.08em] text-primary">Trust, not just a list</div>
          <h2 className="mb-3.5 text-center text-[32px] font-extrabold tracking-[-.03em] md:text-[44px]">Anyone can list. Obol verifies.</h2>
          <p className="mx-auto mb-14 max-w-[640px] text-center text-[18px] text-muted">
            A directory indexes everything — including the junk and the scams. Obol is the layer that curates what&apos;s actually safe for an agent to pay.
          </p>
          <div className="grid gap-6 md:grid-cols-3">
            {[
              { icon: "🪪", h: "ACK-ID verified", p: "Every seller's payout wallet is cryptographically verified with a W3C Verifiable Credential. Agents know exactly who they're paying." },
              { icon: "⭐", h: "Agent ratings", p: "Agents rate the services they actually paid for. Quality rises to the top; junk sinks. Real reputation, not vanity stars." },
              { icon: "🛡️", h: "Safety-scanned", p: "Every endpoint is scanned for malicious behavior. Bad actors are quarantined before an agent ever sends a cent." },
            ].map((s) => (
              <div key={s.h} className="shadow-soft rounded-[18px] border border-hairline bg-white p-8 transition hover:-translate-y-1 hover:shadow-lg2">
                <div className="mb-3 text-[28px]">{s.icon}</div>
                <h3 className="mb-2 text-[20px] font-bold tracking-[-.02em]">{s.h}</h3>
                <p className="text-[15px] leading-[1.6] text-muted">{s.p}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* BOTH SIDES — two-audience, replaces the generic 3-step */}
      <section id="how" className="py-[88px] bg-base2">
        <div className="mx-auto max-w-[1180px] px-6">
          <div className="mb-3.5 text-center text-[13px] font-bold uppercase tracking-[.08em] text-primary">Both sides of the trade</div>
          <h2 className="mb-3.5 text-center text-[32px] font-extrabold tracking-[-.03em] md:text-[44px]">Sell a service. Or let your agent buy one.</h2>
          <p className="mx-auto mb-14 max-w-[620px] text-center text-[18px] text-muted">
            Obol is a two-sided market. Whichever side you&apos;re on, it&apos;s one step.
          </p>
          <div className="grid gap-6 md:grid-cols-2">
            <div className="shadow-soft rounded-[18px] border border-hairline bg-white p-8">
              <div className="mb-2 text-[13px] font-bold uppercase tracking-[.06em] text-primary">If you sell</div>
              <h3 className="mb-4 text-[22px] font-bold tracking-[-.02em]">List once, earn per call</h3>
              <ul className="space-y-3 text-[15px] leading-[1.5] text-muted">
                <li className="flex gap-2.5"><span className="font-extrabold text-success">✓</span> Register any HTTPS URL and set a price — no code changes.</li>
                <li className="flex gap-2.5"><span className="font-extrabold text-success">✓</span> Agents discover it and pay per request in USDC.</li>
                <li className="flex gap-2.5"><span className="font-extrabold text-success">✓</span> Keep 100% — settles to your wallet, withdraw to any chain.</li>
              </ul>
              <Link href="/login" className="grad mt-6 inline-flex rounded-[10px] px-5 py-2.5 text-[14px] font-semibold text-white">Start selling →</Link>
            </div>
            <div className="shadow-soft rounded-[18px] border border-hairline bg-white p-8">
              <div className="mb-2 text-[13px] font-bold uppercase tracking-[.06em] text-primary">If your agent buys</div>
              <h3 className="mb-4 text-[22px] font-bold tracking-[-.02em]">One install, full control</h3>
              <ul className="space-y-3 text-[15px] leading-[1.5] text-muted">
                <li className="flex gap-2.5"><span className="font-extrabold text-success">✓</span> Connect the Obol MCP — your agent discovers and pays automatically.</li>
                <li className="flex gap-2.5"><span className="font-extrabold text-success">✓</span> Developer-controlled wallet — private keys are never exposed, secured by Circle.</li>
                <li className="flex gap-2.5"><span className="font-extrabold text-success">✓</span> 2FA-protected spending limits — you set the budget; it can&apos;t overspend.</li>
              </ul>
              <Link href="/docs" className="mt-6 inline-flex rounded-[10px] border border-hairline px-5 py-2.5 text-[14px] font-semibold text-primary hover:bg-[rgba(109,94,246,.06)]">Connect an agent →</Link>
            </div>
          </div>
        </div>
      </section>

      {/* 2-MINUTE SETUP — let your AI build it */}
      <section className="py-[96px]">
        <div className="mx-auto max-w-[920px] px-6 text-center">
          <div className="mb-5 text-[13px] font-bold uppercase tracking-[.08em] text-primary">2-minute setup</div>
          <h2 className="text-[34px] font-extrabold leading-[1.12] tracking-[-.03em] md:text-[48px]">
            Don&apos;t write the code.<br /><span className="grad-text">Let your AI build it.</span>
          </h2>
          <p className="mx-auto mt-7 max-w-[640px] text-[18.5px] leading-[1.55] text-muted">
            Copy the <span className="font-semibold text-ink">Obol Skill</span>, paste it into Claude, ChatGPT, or Cursor, and it scaffolds a working paid API, wires in your wallet, and walks you through deploying — your payout address already baked in. About two minutes, no boilerplate.
          </p>
          <div className="mt-8 flex justify-center">
            <Link href="/docs#ai-quickstart" className="grad inline-flex items-center gap-2 rounded-[10px] px-[22px] py-3 text-[15px] font-semibold text-white shadow-[0_4px_14px_rgba(109,94,246,.35)] transition hover:-translate-y-px">
              ✨ Get the Obol Skill →
            </Link>
          </div>
        </div>
      </section>

      {/* STAT */}
      <div className="dark-glow py-[72px] text-white">
        <div className="relative mx-auto max-w-[1180px] px-6 text-center">
          <div className="text-[44px] font-extrabold tracking-[-.04em] md:text-[64px]">
            Stripe&apos;s floor is $0.30.<br />
            <span className="grad-text drop-shadow-[0_0_24px_rgba(59,158,255,.4)]">Ours is $0.000001.</span>
          </div>
          <div className="mt-3.5 text-[18px] text-[#9a9cb0]">The marketplace layer for machine-speed commerce — on top of the rails, where agents find and trust what to buy.</div>
        </div>
      </div>

      {/* PRICING */}
      <section id="pricing" className="py-[88px]">
        <div className="mx-auto max-w-[1180px] px-6">
          <div className="mb-3.5 text-center text-[13px] font-bold uppercase tracking-[.08em] text-primary">Pricing</div>
          <h2 className="mb-3.5 text-center text-[32px] font-extrabold tracking-[-.03em] md:text-[44px]">Free to list. Pay as you grow.</h2>
          <p className="mx-auto mb-14 max-w-[600px] text-center text-[18px] text-muted">
            <b className="text-ink">0% commission — you keep every cent.</b> We earn on premium placement and trust, never your transactions.
          </p>
          <div className="grid items-stretch gap-6 md:grid-cols-3">
            <PriceCard
              name="Launch"
              amount={<>0%<small className="text-[18px] font-semibold text-muted"> commission</small></>}
              desc="Always free per call — you keep 100%. List, sell, and get paid with no cut taken."
              feats={["Free marketplace listing", "SDK + MCP access", "Basic analytics", "Settlement on Arc + Base"]}
              cta="Start for free →"
              dark
            />
            <PriceCard
              name="Featured"
              amount="$99/mo"
              desc="For sellers serious about discovery and trust."
              feats={["Priority placement in directory", "Featured badge on listings", "Extended analytics & insights", "Priority support"]}
              cta="Get featured →"
              featured
            />
            <PriceCard
              name="Scale"
              amount="$499/mo"
              desc="For high-volume platforms & enterprise marketplaces. Still 0% per call."
              feats={["SLA guarantee", "Dedicated facilitator", "Enterprise compliance (DPA/SOC 2)", "White-glove onboarding"]}
              ctaNode={<ContactButton />}
              dark
            />
          </div>
        </div>
      </section>

      {/* FAQ — visible answers to the questions people (and AIs) ask */}
      <section id="faq" className="py-[60px]">
        <div className="mx-auto max-w-[820px] px-6">
          <div className="mb-3.5 text-center text-[13px] font-bold uppercase tracking-[.08em] text-primary">FAQ</div>
          <h2 className="mb-10 text-center text-[32px] font-extrabold tracking-[-.03em] md:text-[44px]">Common questions</h2>
          <div className="space-y-3">
            {[
              { q: "How do I monetize my AI agent or API?", a: "List your HTTP API on Obol, set a per-call price, and AI agents pay you in USDC every time they call it. You keep 100% of your price — Obol charges 0% commission. Payments settle gas-free via Circle Gateway." },
              { q: "What is x402?", a: "x402 is the HTTP 402 “Payment Required” standard (created by Coinbase) for paying per request. Obol implements it with Circle Gateway nanopayments so agents pay sub-cent USDC per API call with zero gas." },
              { q: "How are nanopayments gasless ($0 gas)?", a: "Buyers sign off-chain EIP-3009 authorizations at zero gas. Circle Gateway batch-settles many payments in one on-chain transaction, so per-call gas is $0 and payments can be as small as $0.000001." },
              { q: "What's the cheapest way to charge AI agents per call?", a: "Obol — payments from $0.000001 per call, 0% marketplace commission, gasless settlement. Compare to Stripe (~$0.30 + 2.9% minimum) or app stores (15–30% cut)." },
              { q: "How do AI agents pay each other?", a: "Agent-to-agent payments settle in USDC via the x402 standard + Circle Gateway. Obol is the marketplace where agents discover services and pay per call automatically — no accounts, no API keys." },
              { q: "How do agents find my service?", a: "Add the Obol MCP server to any MCP-compatible agent (Claude, Cursor, ChatGPT). It discovers your listing, pays per call, and returns results — automatically. Your service also appears in the public directory at /api/services." },
            ].map(({ q, a }) => (
              <details key={q} className="group rounded-[14px] border border-hairline bg-white px-5 py-4 open:shadow-soft">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[16px] font-semibold text-ink">
                  {q}
                  <span className="shrink-0 text-muted transition group-open:rotate-45">+</span>
                </summary>
                <p className="mt-3 text-[14.5px] leading-relaxed text-muted">{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* FINAL CTA */}
      <div className="pb-24 pt-[30px]">
        <div className="mx-auto max-w-[1180px] px-6">
          <div className="final-glow relative overflow-hidden rounded-[28px] px-10 py-[72px] text-center text-white">
            <h2 className="text-[32px] font-extrabold tracking-[-.03em] text-white md:text-[44px]">The machines are ready to pay.</h2>
            <p className="mx-auto mb-[30px] mt-3.5 max-w-[540px] text-[18px] text-[#a9abbd]">
              List your scraper, bot, model, or API. Or give your agent a wallet and let it hire what it needs.
            </p>
            <div className="flex flex-wrap justify-center gap-3.5">
              <Link href="/login" className="grad inline-flex items-center gap-2 rounded-[10px] px-[20px] py-3 text-[15px] font-semibold text-white shadow-[0_4px_14px_rgba(109,94,246,.35)] transition hover:-translate-y-px">Start selling →</Link>
              <Link href="/marketplace" className="inline-flex items-center gap-2 rounded-[10px] border border-white/[.18] bg-white/[.08] px-[20px] py-3 text-[15px] font-semibold text-white transition hover:bg-white/[.14]">Browse marketplace</Link>
            </div>
          </div>
        </div>
      </div>

      <SiteFooter />
    </main>
  );
}

function PriceCard({
  name, amount, desc, feats, cta, ctaNode, featured, dark,
}: {
  name: string; amount: React.ReactNode; desc: string; feats: string[]; cta?: string; ctaNode?: React.ReactNode; featured?: boolean; dark?: boolean;
}) {
  return (
    <div className={`shadow-soft relative flex flex-col rounded-[18px] border bg-white p-8 ${featured ? "border-primary shadow-[0_0_0_1px_var(--color-primary),0_20px_60px_rgba(10,10,15,.10)]" : "border-hairline"}`}>
      {featured && (
        <span className="grad absolute -top-3 left-1/2 -translate-x-1/2 rounded-full px-3.5 py-[5px] text-[12px] font-bold text-white">Most popular</span>
      )}
      <div className="text-[14px] font-bold uppercase tracking-[.04em] text-muted">{name}</div>
      <div className="my-[14px] text-[42px] font-extrabold tracking-[-.03em]">{amount}</div>
      <div className="mb-[22px] min-h-[42px] text-[14.5px] text-muted">{desc}</div>
      <div className="mb-[26px] flex flex-col gap-[11px]">
        {feats.map((f) => (
          <div key={f} className="flex gap-2.5 text-[14.5px] text-[#3a3a48]"><span className="font-extrabold text-success">✓</span> {f}</div>
        ))}
      </div>
      {ctaNode ?? (
        <Link href="/login" className={`mt-auto inline-flex items-center justify-center gap-2 rounded-[10px] px-[18px] py-2.5 text-[15px] font-semibold transition hover:-translate-y-px ${featured ? "grad text-white shadow-[0_4px_14px_rgba(109,94,246,.35)]" : "bg-ink text-white"}`}>{cta}</Link>
      )}
    </div>
  );
}
