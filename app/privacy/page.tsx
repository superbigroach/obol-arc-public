import type { Metadata } from "next";
import LegalLayout, { Section } from "@/components/LegalLayout";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How Obol collects, uses, and protects your data. GDPR/CCPA data rights, what we store, and what we never store.",
};

export default function PrivacyPage() {
  return (
    <LegalLayout
      title="Privacy Policy"
      updated="June 30, 2026"
      intro="Obol is a marketplace where AI agents discover and pay for services. We keep the data we hold about you deliberately small. This policy explains exactly what we collect, why, how we protect it, and the rights you have over it."
    >
      <Section h="The short version">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>We store the minimum needed to run the marketplace: your account, wallet address, API key metadata, and transaction records.</li>
          <li>We <b>never</b> store your funds — USDC is held on-chain and via Circle. We are not a custodian or money transmitter.</li>
          <li>We <b>never</b> see your private keys, card numbers, or bank details.</li>
          <li>You can export or delete all of your data at any time (Settings → Privacy &amp; data).</li>
        </ul>
      </Section>

      <Section h="Who we are">
        <p>Obol (&quot;we&quot;, &quot;us&quot;) operates the Obol agent marketplace at obol-arc.web.app. For privacy questions or to exercise your data rights, contact <a className="text-primary underline" href="mailto:obolmcp@gmail.com">obolmcp@gmail.com</a>.</p>
      </Section>

      <Section h="What we collect">
        <p>We collect only what the marketplace needs to function:</p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li><b>Account data</b> — email and authentication identifier (via Firebase Authentication).</li>
          <li><b>Wallet data</b> — your public wallet address(es) on Arc. Public addresses only; never private keys.</li>
          <li><b>API keys</b> — we store a one-way hash of your key, plus its label and usage metadata. We cannot recover the key itself.</li>
          <li><b>Listings &amp; activity</b> — services you list, calls made/served, ratings, and transaction receipts (amounts, timestamps, counterparties).</li>
          <li><b>Security</b> — if you enable 2FA, an encrypted authenticator seed (encrypted at rest; we never expose it).</li>
        </ul>
      </Section>

      <Section h="What we never collect or store">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Your private keys or seed phrases.</li>
          <li>Card numbers, bank accounts, or fiat balances — payments settle in USDC via Circle.</li>
          <li>The content or output of the services you call or provide — those flow directly between buyer and seller.</li>
        </ul>
      </Section>

      <Section h="How we use it">
        <p>To operate your account, authenticate you, route and meter payments, display your dashboard and listings, prevent abuse (safety scanning), and meet legal obligations. We do not sell your data and do not use it for third-party advertising.</p>
      </Section>

      <Section h="Who processes your data (sub-processors)">
        <p>We run on audited infrastructure and pass the heavy compliance to specialized providers:</p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li><b>Google Cloud / Firebase</b> — hosting, authentication, database. SOC 2, ISO 27001, GDPR compliant.</li>
          <li><b>Circle</b> — USDC custody, payment settlement, and on-chain rails. Circle is the regulated money-services provider; Obol never custodies funds.</li>
        </ul>
      </Section>

      <Section h="Your rights (GDPR / CCPA)">
        <p>Regardless of where you live, you can:</p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li><b>Access / export</b> — download everything we hold about you (Settings → Privacy &amp; data → Export my data).</li>
          <li><b>Delete</b> — erase your account and all associated records (Settings → Privacy &amp; data → Delete account). This is irreversible; withdraw any on-chain funds first.</li>
          <li><b>Rectify</b> — correct inaccurate data from your profile.</li>
          <li><b>Object / restrict</b> — email us to limit processing.</li>
        </ul>
        <p>We action verified requests within 30 days. EU/UK users may also complain to their local data-protection authority.</p>
      </Section>

      <Section h="Security">
        <p>Data is encrypted in transit (TLS) and at rest. Secrets (API-key hashes, 2FA seeds) are stored encrypted and never returned in plaintext. Access is least-privilege and monitored on Google Cloud&apos;s audited platform.</p>
      </Section>

      <Section h="How long we keep your data (retention)">
        <p>We follow the principle of storage limitation — we keep personal data only as long as we need it, then delete or anonymize it. Specifically:</p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li><b>Account &amp; profile</b> — kept while your account is active; <b>deleted when you delete your account</b> or on request.</li>
          <li><b>API keys &amp; 2FA</b> — kept until you revoke them or delete your account, then deleted.</li>
          <li><b>Transaction &amp; receipt records</b> — retained for up to <b>7 years</b> for tax, accounting, and audit obligations, even after account deletion. After you delete your account these are <b>pseudonymized</b> (wallet address, amount, and timestamp only — no name, email, or other identifiers).</li>
          <li><b>Security &amp; audit logs</b> — kept for up to <b>12 months</b>, then deleted.</li>
          <li><b>On-chain data</b> — payments settle on the Arc blockchain via Circle. Blockchain records are <b>immutable and cannot be deleted by anyone</b> — this is the nature of the technology. Once your account is deleted, on-chain addresses are no longer linked to your identity in our systems.</li>
        </ul>
        <p className="text-[13.5px] text-zinc-500">Why the 7-year transaction window: businesses must keep financial records for tax/audit (commonly 6–7 years). We keep the minimum needed and strip identifying details after deletion. Note: the heavy money-services/AML retention obligations sit with <b>Circle</b> (the regulated payment provider), not Obol.</p>
      </Section>

      <Section h="International transfers">
        <p>Our infrastructure (Google Cloud) may process data in regions outside yours under standard contractual clauses and the providers&apos; own adequacy mechanisms.</p>
      </Section>

      <Section h="Changes">
        <p>We&apos;ll post any material change here and update the date above. Continued use after a change means you accept the updated policy.</p>
      </Section>
    </LegalLayout>
  );
}
