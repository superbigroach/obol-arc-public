// Static data for the example marketplace demo cards.
// These render in the same service detail page as real services.
export type DemoService = {
  id: string;
  name: string;
  category: string;
  description: string;
  priceUsdc: string;
  hostedUrl: string;
  inputSchema: string;
  docsUrl: string;
  sellerName: string;
  sellerBio: string;
  sellerWebsite?: string;
  sellerGithub?: string;
  sellerX?: string;
  endpoints: { path: string; priceUsdc: string; description: string; params?: string }[];
};

export const DEMO_SERVICES: Record<string, DemoService> = {
  "demo-lead-enrich": {
    id: "demo-lead-enrich",
    name: "LeadEnrich",
    category: "Data",
    description: "Enrich any email or domain into a full company + person profile. Get firmographics, technographics, and contact data in a single call — perfect for agent-driven outreach pipelines.",
    priceUsdc: "0.002",
    hostedUrl: "https://api.example-clearbit.com/enrich",
    inputSchema: "email: string, domain?: string",
    docsUrl: "https://clearbit.com/docs",
    sellerName: "clearbit-labs",
    sellerBio: "Data enrichment for the modern stack. Trusted by 10,000+ companies.",
    sellerWebsite: "https://clearbit.com",
    sellerGithub: "clearbit",
    endpoints: [
      { path: "/person", priceUsdc: "0.002", description: "Enrich a person by email address", params: "email: string" },
      { path: "/company", priceUsdc: "0.002", description: "Enrich a company by domain", params: "domain: string" },
    ],
  },
  "demo-web-search": {
    id: "demo-web-search",
    name: "WebSearch",
    category: "Search",
    description: "Real-time web search results as clean structured JSON. No scraping, no rate limits — agents get ranked results, snippets, and source URLs in milliseconds.",
    priceUsdc: "0.0008",
    hostedUrl: "https://api.example-serp.com/search",
    inputSchema: "q: string, num?: number",
    docsUrl: "",
    sellerName: "serp.run",
    sellerBio: "Reliable search infrastructure for AI agents.",
    sellerWebsite: "https://serp.run",
    sellerX: "serprun",
    endpoints: [
      { path: "/search", priceUsdc: "0.0008", description: "Web search — returns top N results", params: "q: string, num?: number (default 10)" },
      { path: "/news", priceUsdc: "0.0008", description: "News search — returns recent articles", params: "q: string, num?: number" },
    ],
  },
  "demo-vision-ocr": {
    id: "demo-vision-ocr",
    name: "VisionOCR",
    category: "AI",
    description: "Extract text, tables, and layout from any image or PDF page. Handles scanned documents, receipts, invoices, and mixed-language content with state-of-the-art accuracy.",
    priceUsdc: "0.004",
    hostedUrl: "https://api.example-pixelparse.com/ocr",
    inputSchema: "url: string, page?: number",
    docsUrl: "",
    sellerName: "pixelparse",
    sellerBio: "Document AI for the agentic era.",
    sellerWebsite: "https://pixelparse.ai",
    sellerGithub: "pixelparse",
    endpoints: [
      { path: "/text", priceUsdc: "0.004", description: "Extract plain text from image or PDF page", params: "url: string, page?: number" },
      { path: "/table", priceUsdc: "0.005", description: "Extract structured table data as JSON", params: "url: string, page?: number" },
    ],
  },
  "demo-geoip": {
    id: "demo-geoip",
    name: "GeoIP",
    category: "Data",
    description: "Resolve an IP to country, city, ASN, and risk score. Sub-millisecond response from a globally distributed edge network. Ideal for fraud checks and personalisation.",
    priceUsdc: "0.0003",
    hostedUrl: "https://api.example-netatlas.com/ip",
    inputSchema: "ip: string",
    docsUrl: "",
    sellerName: "netatlas",
    sellerBio: "IP intelligence at the edge.",
    endpoints: [
      { path: "/lookup", priceUsdc: "0.0003", description: "Full geo + ASN + risk lookup for an IP", params: "ip: string" },
    ],
  },
  "demo-summarize": {
    id: "demo-summarize",
    name: "Summarize",
    category: "AI",
    description: "Condense any URL or document into a structured summary with key points, sentiment, and reading time. Works on articles, PDFs, research papers, and YouTube transcripts.",
    priceUsdc: "0.005",
    hostedUrl: "https://api.example-tldr.com/summarize",
    inputSchema: "url: string, maxPoints?: number",
    docsUrl: "",
    sellerName: "tldr-ai",
    sellerBio: "Distilling the web into signal.",
    endpoints: [
      { path: "/url", priceUsdc: "0.005", description: "Summarise a web page or article URL", params: "url: string, maxPoints?: number" },
      { path: "/pdf", priceUsdc: "0.006", description: "Summarise a PDF by URL", params: "url: string" },
    ],
  },
  "demo-fxrates": {
    id: "demo-fxrates",
    name: "FXRates",
    category: "Finance",
    description: "Live multi-currency FX + stablecoin conversion rates. Updated every 500ms from major exchanges. Agents use this to price cross-border payments and DeFi strategies.",
    priceUsdc: "0.0005",
    hostedUrl: "https://api.example-stablefx.com/rates",
    inputSchema: "from: string, to: string, amount?: number",
    docsUrl: "",
    sellerName: "stablefx",
    sellerBio: "Real-time FX for the on-chain world.",
    endpoints: [
      { path: "/convert", priceUsdc: "0.0005", description: "Convert amount from one currency to another", params: "from: string, to: string, amount?: number" },
      { path: "/rates", priceUsdc: "0.0003", description: "Get all live rates for a base currency", params: "base: string" },
    ],
  },
  "demo-sentiment": {
    id: "demo-sentiment",
    name: "Sentiment",
    category: "AI",
    description: "Score sentiment and emotion across text in 40+ languages. Returns polarity (positive/negative/neutral), intensity score, and detected emotions with confidence.",
    priceUsdc: "0.001",
    hostedUrl: "https://api.example-moodmetric.com/analyze",
    inputSchema: "text: string, lang?: string",
    docsUrl: "",
    sellerName: "moodmetric",
    sellerBio: "Emotion AI for agent decision-making.",
    endpoints: [
      { path: "/analyze", priceUsdc: "0.001", description: "Full sentiment + emotion breakdown", params: "text: string, lang?: string" },
    ],
  },
  "demo-pricefeed": {
    id: "demo-pricefeed",
    name: "PriceFeed",
    category: "Finance",
    description: "On-demand token + commodity price feeds, cryptographically signed. Each response includes a signature agents can use to prove price authenticity on-chain.",
    priceUsdc: "0.0006",
    hostedUrl: "https://api.example-oraclelite.com/price",
    inputSchema: "symbol: string",
    docsUrl: "",
    sellerName: "oraclelite",
    sellerBio: "Signed price feeds for on-chain agents.",
    endpoints: [
      { path: "/token", priceUsdc: "0.0006", description: "Get signed price for a token symbol", params: "symbol: string" },
      { path: "/commodity", priceUsdc: "0.0006", description: "Get signed price for a commodity", params: "symbol: string (e.g. XAU, OIL)" },
    ],
  },
  "demo-translate": {
    id: "demo-translate",
    name: "Translate",
    category: "AI",
    description: "Translate text between 100+ languages with context-awareness. Preserves formatting, handles idiomatic expressions, and supports HTML input without stripping tags.",
    priceUsdc: "0.0012",
    hostedUrl: "https://api.example-lingobridge.com/translate",
    inputSchema: "text: string, to: string, from?: string",
    docsUrl: "",
    sellerName: "lingobridge",
    sellerBio: "Context-aware translation for AI pipelines.",
    endpoints: [
      { path: "/text", priceUsdc: "0.0012", description: "Translate plain text", params: "text: string, to: string, from?: string" },
      { path: "/html", priceUsdc: "0.0014", description: "Translate HTML without breaking markup", params: "html: string, to: string" },
    ],
  },
};
