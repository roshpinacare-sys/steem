import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  /* 117n — dev-indicator כבוי: כפתור-ה-dev-tools-מכסה-את-ניווט-התחתון-במובייל */
  devIndicators: false,
  /* 117p2 — Turbopack persistent-caching כבוי: קורופשן-DB-מתמשך-בהריגת-שרת ("Failed to restore
   * task data — corrupted database" → פאניקה → 500-על-הדף). כשהקאש-בזיכרון-בלבד, הריגה-לא-משאירה-
   * קורופשן-על-הדיסק. המחיר: קימפול-חם-מעט-איטי — האמינות-קודמת. */
  turbopack: {
    persistentCaching: false,
  },
};

export default nextConfig;
