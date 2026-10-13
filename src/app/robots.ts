import type { MetadataRoute } from "next";

/**
 * T-24 · ROBOTS — index the public cockpit, never the state surfaces.
 * The engine's truth routes (/api/saos/*) carry live account + arbitration
 * data that is machinery, not marketing: crawled pages teach, API routes
 * are for the cockpit itself.
 */
export default function robots(): MetadataRoute.Robots {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "https://saos.local";
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/"],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
  };
}
