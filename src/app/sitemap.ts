import type { MetadataRoute } from "next";

/**
 * T-24 · SEO INFRASTRUCTURE — the sovereign's public face is crawlable.
 * The operator's directive: smart network presence that promotes SEO without
 * exposing the machine's internals. The sitemap lists the public cockpit
 * only; every engine route (state, credentials, arbitration) stays outside.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "https://saos.local";
  const now = new Date();
  return [
    {
      url: `${base}/`,
      lastModified: now,
      changeFrequency: "hourly",
      priority: 1,
    },
  ];
}
