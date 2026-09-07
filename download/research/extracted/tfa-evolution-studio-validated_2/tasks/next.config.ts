import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Declare Node.js-only packages so Next.js never attempts to bundle them
  // for the browser or edge runtime.  adm-zip and fast-glob use native Node
  // APIs (fs, child_process) and must stay server-side only.
  serverExternalPackages: ["adm-zip", "fast-glob"],
  experimental: {
    serverActions: {
      bodySizeLimit: "100mb",
    },
  },
  // Prevent Next.js from watching or bundling workspace data files
  // (extracted ZIPs, versioned project snapshots, pipeline artifacts).
  // Workspace data lives under TFA_WORKSPACE_ROOT (/tmp/tfa-studio-data by default),
  // already outside the source tree. This guard additionally covers the edge case
  // where TFA_WORKSPACE_ROOT is explicitly pointed at a path inside the project (e.g. ./data).
  webpack(config) {
    // Merge workspace data paths into watchOptions.ignored using only string
    // globs — webpack schema requires non-empty strings; RegExp entries from
    // Next.js defaults are deliberately excluded to avoid schema violations.
    const existingIgnored: string[] = Array.isArray(config.watchOptions?.ignored)
      ? (config.watchOptions.ignored as Array<string | RegExp>).filter(
          (x): x is string => typeof x === "string" && x.length > 0
        )
      : typeof config.watchOptions?.ignored === "string" && config.watchOptions.ignored.length > 0
      ? [config.watchOptions.ignored]
      : [];
    config.watchOptions = {
      ...config.watchOptions,
      ignored: [
        ...existingIgnored,
        "**/data/**",
        "**/tfa-studio-data/**",
        "**/.tfa-workspace/**",
      ],
    };
    return config;
  },
};

export default nextConfig;
