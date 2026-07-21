import type { MetadataRoute } from "next";

export const dynamic = "force-static";

const BASE = "https://obol-arc.web.app";

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return [
    { url: `${BASE}/`, lastModified, changeFrequency: "weekly", priority: 1 },
    { url: `${BASE}/marketplace`, lastModified, changeFrequency: "daily", priority: 0.9 },
    { url: `${BASE}/docs`, lastModified, changeFrequency: "weekly", priority: 0.8 },
    { url: `${BASE}/login`, lastModified, changeFrequency: "monthly", priority: 0.5 },
  ];
}
