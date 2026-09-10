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
  /* 117p2+R7 — Turbopack persistent-caching: ב-Next-16.1.3 מפתח-ה-persistentCaching
   * אינו-מוכר-עוד (אזהרה-בכל-אתחול) — ברירת-המחדל-היציבה-היא-cache-בזיכרון-בלבד,
   * שהיא-בדיוק-ההתנהגות-שההגדרה-ביקשה (מניעת-קורופשן-DB-בהריגת-שרת). המפתח-המת
   * הוסר; הגרדיאן-ממשיך-לטפל-בכל-פאניקת-טורבופק-שרידית (wipe-cache+revive). */
};

export default nextConfig;
