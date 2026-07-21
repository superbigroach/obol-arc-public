import type { Metadata } from "next";
import LegalLayout, { Section } from "@/components/LegalLayout";

export const metadata: Metadata = {
  title: "Data Processing Agreement",
  description: "Obol's GDPR Data Processing Agreement for business and enterprise customers — roles, sub-processors, security, and data-subject rights.",
};

export default function DpaPage() {
  return (
    <LegalLayout
      title="Data Processing Agreement"
      updated="June 30, 2026"
      intro="This DPA forms part of the Terms of Service between Obol (&quot;Processor&quot;) and a business customer (&quot;Controller&quot;) where Obol processes personal data on the Controller's behalf. Enterprise customers can countersign a copy — email obolmcp@gmail.com."
    >
      <Section h="1. Roles">
        <p>For data the Controller submits to Obol (e.g. their team&apos;s accounts), Obol acts as <b>Processor</b> and the customer as <b>Controller</b>. For Obol&apos;s own account data, Obol is the Controller (see our Privacy Policy). Where a seller&apos;s service processes its buyers&apos; personal data, the <b>seller is the controller</b> for that processing — Obol does not process the content of seller services.</p>
      </Section>

      <Section h="2. Scope & purpose">
        <p>Obol processes personal data only to provide the marketplace: authentication, listing, payment routing/metering, security, and support. Obol processes data per the Controller&apos;s documented instructions (these terms and use of the product) and will not process it for any other purpose.</p>
      </Section>

      <Section h="3. Categories of data & subjects">
        <ul className="list-disc space-y-1.5 pl-5">
          <li><b>Subjects:</b> the Controller&apos;s authorized users / agents.</li>
          <li><b>Data:</b> account identifiers (email), public wallet addresses, API-key metadata (hashed), listings, transaction records. No special-category data is required by Obol.</li>
        </ul>
      </Section>

      <Section h="4. Sub-processors">
        <p>The Controller authorizes these sub-processors; Obol remains responsible for their compliance and will give notice of changes:</p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li><b>Google Cloud / Firebase</b> — hosting, auth, database (SOC 2, ISO 27001, GDPR).</li>
          <li><b>Circle</b> — USDC settlement and on-chain rails (regulated money-services provider).</li>
        </ul>
      </Section>

      <Section h="5. Security">
        <p>Obol maintains appropriate technical and organizational measures: encryption in transit (TLS) and at rest, least-privilege access controls, secret management, audit logging, and monitoring on Google Cloud&apos;s audited platform. Secrets (API-key hashes, 2FA seeds) are encrypted and never exposed.</p>
      </Section>

      <Section h="6. Data-subject rights & assistance">
        <p>Obol provides self-service export and deletion in-product and will assist the Controller in responding to data-subject requests (access, rectification, erasure, portability, restriction) without undue delay.</p>
      </Section>

      <Section h="7. Breach notification">
        <p>Obol will notify the Controller without undue delay (and within 72 hours where feasible) after becoming aware of a personal-data breach affecting the Controller&apos;s data, with the information needed to meet the Controller&apos;s own notification duties.</p>
      </Section>

      <Section h="8. International transfers">
        <p>Where personal data is transferred outside the EEA/UK, transfers rely on Standard Contractual Clauses and the sub-processors&apos; transfer mechanisms.</p>
      </Section>

      <Section h="9. Deletion & return">
        <p>On termination or request, Obol deletes or returns the Controller&apos;s personal data, except where retention is legally required. In-product deletion erases the user&apos;s records and authentication identity.</p>
      </Section>

      <Section h="10. Audit">
        <p>Obol will make available the information necessary to demonstrate compliance, including third-party audit reports of its sub-processors (e.g. Google Cloud SOC 2) and, for enterprise customers, completed security questionnaires.</p>
      </Section>

      <Section h="11. Compliance status">
        <p>Obol inherits SOC 2 / ISO 27001 / GDPR-compliant infrastructure from Google Cloud and Circle, and operates a minimal-data design. Obol&apos;s own SOC 2 Type II is available to enterprise customers on request or in progress; contact <a className="text-primary underline" href="mailto:obolmcp@gmail.com">obolmcp@gmail.com</a> for current status and a countersigned DPA.</p>
      </Section>
    </LegalLayout>
  );
}
