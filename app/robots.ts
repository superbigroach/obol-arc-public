import type { MetadataRoute } from "next";

export const dynamic = "force-static";

// We WANT AI agents, LLM crawlers, and search engines to read the public
// directory — that's the product. Private data is protected by Firestore
// security rules, so allow-all crawling here is correct.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
      },
    ],
    sitemap: "https://obol-arc.web.app/sitemap.xml",
  };
}
