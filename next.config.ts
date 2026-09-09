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
};

export default nextConfig;
