import type { Metadata } from "next";
import LegalLayout, { Section } from "@/components/LegalLayout";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "Obol is a marketplace connecting buyers and sellers of agent services. Sellers are responsible for their own services and compliance.",
};

export default function TermsPage() {
  return (
    <LegalLayout
      title="Terms of Service"
      updated="June 30, 2026"
      intro="These terms govern your use of Obol. The most important thing to understand: Obol is a marketplace and payment relay. We connect buyers and sellers — we do not provide the underlying services ourselves, and sellers remain responsible for what they sell."
    >
      <Section h="1. What Obol is (and is not)">
        <ul className="list-disc space-y-1.5 pl-5">
          <li><b>Obol is a marketplace and discovery layer.</b> We let sellers list HTTP services and let buyers (including AI agents) discover and pay for them per call in USDC.</li>
          <li><b>Obol is not the service provider.</b> Each service is provided solely by its seller. We do not create, control, verify the accuracy of, or guarantee any seller&apos;s service or its output.</li>
          <li><b>Obol is not a custodian or money transmitter.</b> Funds are held and settled on-chain via Circle and the Arc network. We never custody your money.</li>
        </ul>
      </Section>

      <Section h="2. Seller responsibilities (important)">
        <p>If you list a service, <b>you are solely responsible</b> for it, including:</p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>The legality, accuracy, safety, and quality of your service and its output.</li>
          <li>All licenses, permissions, and rights needed to operate it.</li>
          <li><b>Domain-specific compliance.</b> If your service handles regulated data or activities (e.g. health, financial, personal, or biometric data), you are responsible for the applicable laws and certifications (e.g. HIPAA, PCI-DSS, GDPR as a data controller). Obol does not assume your compliance obligations.</li>
          <li>Honoring the price and terms you publish, and supporting your own buyers.</li>
        </ul>
        <p>You grant Obol the right to list, display, scan for safety, and rate your service. We may quarantine or remove listings that fail safety scanning, violate these terms, or are reported as harmful.</p>
      </Section>

      <Section h="3. Buyer responsibilities">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>You are responsible for the calls your account or agents make and the funds you spend.</li>
          <li>Payments are final once a service is called and settled. Disputes about a service&apos;s output are between you and the seller.</li>
          <li>You must keep your API keys and credentials secure. You are responsible for activity under your keys.</li>
        </ul>
      </Section>

      <Section h="4. Fees">
        <p>Listing is free and Obol currently charges <b>0% commission</b> per call — sellers keep 100% of their price. Obol monetizes through optional paid subscription tiers (e.g. Featured, Scale) for placement and premium features. Network/gas and Circle fees are determined by the underlying infrastructure, not by Obol. We may change fees with notice posted here.</p>
      </Section>

      <Section h="5. Payments & settlement">
        <p>Payments settle in USDC via Circle Gateway on the Arc network. On-chain transactions are irreversible. Obol does not control settlement timing or reverse transactions. You are responsible for withdrawing your balance; withdraw before deleting your account.</p>
      </Section>

      <Section h="6. Acceptable use">
        <p>Don&apos;t use Obol to list or call services that are illegal, fraudulent, malicious (malware, phishing, credential theft), infringing, or designed to abuse the platform or other users. We may suspend accounts that do.</p>
      </Section>

      <Section h="7. Disclaimers">
        <p>Obol is provided &quot;as is.&quot; To the maximum extent permitted by law, we disclaim warranties about any seller&apos;s service, uptime, fitness, or output. The marketplace and any testnet features may change or be discontinued.</p>
      </Section>

      <Section h="8. Limitation of liability">
        <p>To the maximum extent permitted by law, Obol is not liable for indirect, incidental, or consequential damages, or for losses arising from a seller&apos;s service, your use of funds, on-chain transactions, or third-party providers (Circle, Arc, Google Cloud). Obol is a marketplace; claims about a service belong against its seller.</p>
      </Section>

      <Section h="9. Indemnity">
        <p>You agree to indemnify Obol against claims arising from your listings, your services, your use of the platform, or your breach of these terms.</p>
      </Section>

      <Section h="10. Changes & contact">
        <p>We may update these terms; material changes will be posted here with a new date. Questions: <a className="text-primary underline" href="mailto:obolmcp@gmail.com">obolmcp@gmail.com</a>.</p>
      </Section>
    </LegalLayout>
  );
}
