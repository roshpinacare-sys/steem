import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // preview panel origins (space-z.ai iframe) must be allowed to fetch /_next/* dev assets
  allowedDevOrigins: ["*.space-z.ai", "space-z.ai", "localhost", "127.0.0.1"],
};

export default nextConfig;
