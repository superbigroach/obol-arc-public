import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import "./animations.css";
import { AuthProvider } from "@/components/AuthProvider";
import { CoinGradients } from "@/components/Logo";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-inter",
});

const BASE_URL = "https://obol-arc.web.app";

export const metadata: Metadata = {
  metadataBase: new URL(BASE_URL),
  title: {
    default: "Obol — The app store for AI agents.",
    template: "%s | Obol",
  },
  description:
    "The app store for AI agents. List any API and get paid per call in USDC — gasless, sub-cent, 0% commission. One MCP install lets any agent discover, trust, and pay for it. No keys, no accounts, no human in the loop.",
  keywords: [
    "monetize AI agents", "make money with AI agents", "sell API to AI agents",
    "AI agent marketplace", "agent monetization", "monetize MCP server",
    "pay per call API", "per-call API billing", "API micropayments",
    "x402", "x402 marketplace", "EIP-3009", "nanopayments", "agent-to-agent payments",
    "USDC payments", "Circle Gateway", "Arc blockchain", "agent economy",
    "accept payments from AI agents", "gasless USDC payments", "MCP monetization",
  ],
  authors: [{ name: "Obol" }],
  icons: {
    icon: "/favicon.ico",
    apple: "/favicon.ico",
  },
  openGraph: {
    type: "website",
    url: BASE_URL,
    siteName: "Obol",
    title: "Obol — The app store for AI agents.",
    description:
      "The app store for AI agents — list any API, get paid per call in USDC. 0% commission, gasless, no keys. One MCP install and any agent can buy it.",
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "Obol — The app store for AI agents.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Obol — The app store for AI agents.",
    description: "Sell anything an AI can call and get paid per request in USDC. No keys. No invoices. No human in the loop.",
    images: ["/opengraph-image"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} antialiased`}>
      <body>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify({
            "@context": "https://schema.org",
            "@graph": [
              {
                "@type": "Organization",
                "name": "Obol",
                "url": BASE_URL,
                "description": "The app store for AI agents. List any API and get paid per call in USDC — gasless, sub-cent, 0% commission. One MCP install lets any agent discover, trust, and pay for it. Built on Circle Gateway + x402.",
                "sameAs": ["https://agents.circle.com"],
              },
              {
                "@type": "WebSite",
                "name": "Obol",
                "url": BASE_URL,
              },
              {
                "@type": "FAQPage",
                "mainEntity": [
                  { "@type": "Question", "name": "How do I monetize my AI agent or API?",
                    "acceptedAnswer": { "@type": "Answer", "text": "List your HTTP API on Obol, set a per-call price, and AI agents pay you in USDC every time they call it. You keep 100% of your price — Obol charges 0% commission per call. Payments settle gas-free via Circle Gateway." } },
                  { "@type": "Question", "name": "What is x402?",
                    "acceptedAnswer": { "@type": "Answer", "text": "x402 is the HTTP 402 'Payment Required' standard for paying per request. Obol implements it with Circle Gateway nanopayments so AI agents pay sub-cent USDC per API call with zero gas." } },
                  { "@type": "Question", "name": "What are nanopayments and how is gas $0?",
                    "acceptedAnswer": { "@type": "Answer", "text": "Buyers sign off-chain EIP-3009 authorizations at zero gas. Circle Gateway batch-settles many payments in a single on-chain transaction, so per-call gas is $0 and payments can be as small as $0.000001." } },
                  { "@type": "Question", "name": "What is the cheapest way to charge AI agents per API call?",
                    "acceptedAnswer": { "@type": "Answer", "text": "Obol — payments from $0.000001 per call with 0% marketplace commission and gasless settlement, versus Stripe's ~$0.30 + 2.9% minimum or app stores' 15–30% cut." } },
                  { "@type": "Question", "name": "How do AI agents pay each other?",
                    "acceptedAnswer": { "@type": "Answer", "text": "Agent-to-agent payments settle in USDC via the x402 standard and Circle Gateway. Obol is the marketplace where agents discover services and pay per call automatically." } },
                ],
              },
            ],
          }) }}
        />
        <CoinGradients />
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
