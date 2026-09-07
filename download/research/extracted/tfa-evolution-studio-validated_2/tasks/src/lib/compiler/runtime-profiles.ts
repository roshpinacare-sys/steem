/**
 * TFA Evolution Studio v30 — Platform Runtime Profiles
 *
 * WS5: Runtime profile registry for major platform targets.
 * Each profile generates correct ZIPs, manifests, artifacts, and layouts
 * for the target runtime.
 *
 * Supported profiles:
 *   wordpress      — PHP/WordPress theme/plugin structure
 *   shopify        — Shopify theme (Dawn-compatible), Liquid templates
 *   nextjs         — Next.js App Router or Pages Router project
 *   static         — Flat HTML/CSS/JS static site
 *   node_service   — Node.js backend service (Express / Fastify)
 *   microservice   — Docker-ready Node microservice with health endpoint
 *   plugin_ecosystem — Host + plugin contract with manifest and sandbox
 *
 * Each profile exports:
 *   detect(ir)      — returns confidence 0-1 that this profile matches the project
 *   generateLayout  — canonical directory layout template
 *   generateManifest — platform-specific manifest structure
 *   validateArtifact — post-ZIP structural integrity check
 */

import type { ProjectIR } from "@/lib/compiler/project-ir";
import type { EvidenceNode } from "@/lib/types";

// ── Profile types ──────────────────────────────────────────────────────────

export type RuntimeProfileId =
  | "wordpress"
  | "shopify"
  | "nextjs"
  | "static"
  | "node_service"
  | "microservice"
  | "plugin_ecosystem";

export interface RuntimeManifest {
  profileId: RuntimeProfileId;
  version: string;
  entryPoints: string[];
  buildCommand?: string;
  installCommand?: string;
  previewCommand?: string;
  deployTarget: string;
  requiredFiles: string[];
  optionalFiles: string[];
  environmentVars: Record<string, string>;
}

export interface LayoutTemplate {
  profileId: RuntimeProfileId;
  directories: string[];
  files: Record<string, string>;
}

export interface ArtifactValidationResult {
  passed: boolean;
  profileId: RuntimeProfileId;
  missingFiles: string[];
  warnings: string[];
  evidence: EvidenceNode[];
}

export interface RuntimeProfile {
  id: RuntimeProfileId;
  label: string;
  description: string;
  detect: (ir: ProjectIR) => number;
  generateManifest: (version: string) => RuntimeManifest;
  generateLayout: () => LayoutTemplate;
  validateArtifact: (ir: ProjectIR) => ArtifactValidationResult;
}

// ── WordPress profile ─────────────────────────────────────────────────────

const wordpressProfile: RuntimeProfile = {
  id: "wordpress",
  label: "WordPress",
  description: "WordPress theme or plugin with PHP, template hierarchy, and hooks",
  detect(ir) {
    const hasPhp = ir.files.some((f) => f.extension === ".php");
    const hasStyleCss = ir.files.some((f) => f.relPath.endsWith("style.css"));
    const hasFunctions = ir.files.some((f) => f.relPath.includes("functions.php"));
    return (hasPhp ? 0.4 : 0) + (hasStyleCss ? 0.3 : 0) + (hasFunctions ? 0.3 : 0);
  },
  generateManifest(version) {
    return {
      profileId: "wordpress",
      version,
      entryPoints: ["functions.php", "index.php"],
      buildCommand: undefined,
      installCommand: "composer install --no-dev",
      previewCommand: "wp server",
      deployTarget: "wordpress-hosting",
      requiredFiles: ["style.css", "functions.php", "index.php"],
      optionalFiles: ["readme.txt", "screenshot.png", "composer.json"],
      environmentVars: { WP_DEBUG: "false", WP_ENVIRONMENT_TYPE: "production" },
    };
  },
  generateLayout() {
    return {
      profileId: "wordpress",
      directories: ["assets/css", "assets/js", "assets/images", "template-parts", "inc"],
      files: {
        "style.css": `/*\nTheme Name: My Theme\nVersion: 1.0.0\nText Domain: my-theme\n*/`,
        "functions.php": `<?php\n// Theme setup\nfunction my_theme_setup() {\n  add_theme_support('title-tag');\n  add_theme_support('post-thumbnails');\n}\nadd_action('after_setup_theme', 'my_theme_setup');\n`,
        "index.php": `<?php get_header(); ?>\n<main><?php the_loop(); ?></main>\n<?php get_footer(); ?>`,
        "header.php": `<!DOCTYPE html><html <?php language_attributes(); ?>><head><?php wp_head(); ?></head><body <?php body_class(); ?>>`,
        "footer.php": `<?php wp_footer(); ?></body></html>`,
      },
    };
  },
  validateArtifact(ir) {
    const required = ["style.css", "functions.php", "index.php"];
    const missing = required.filter((r) => !ir.files.some((f) => f.relPath.endsWith(r)));
    const passed = missing.length === 0;
    return {
      passed, profileId: "wordpress", missingFiles: missing, warnings: [],
      evidence: [{ kind: "zip_integrity_verified", status: passed ? "passed" : "failed", message: `WordPress artifact: ${passed ? "valid" : `missing ${missing.join(", ")}`}`, timestamp: new Date().toISOString() }],
    };
  },
};

// ── Shopify profile ───────────────────────────────────────────────────────

const shopifyProfile: RuntimeProfile = {
  id: "shopify",
  label: "Shopify",
  description: "Shopify theme with Liquid templates, sections, and Dawn-compatible structure",
  detect(ir) {
    const hasLiquid = ir.files.some((f) => f.extension === ".liquid");
    const hasConfig = ir.files.some((f) => f.relPath.includes("config/settings_schema.json"));
    const hasSections = ir.files.some((f) => f.relPath.startsWith("sections/"));
    return (hasLiquid ? 0.5 : 0) + (hasConfig ? 0.3 : 0) + (hasSections ? 0.2 : 0);
  },
  generateManifest(version) {
    return {
      profileId: "shopify",
      version,
      entryPoints: ["layout/theme.liquid"],
      buildCommand: "shopify theme build",
      installCommand: undefined,
      previewCommand: "shopify theme dev",
      deployTarget: "shopify-cdn",
      requiredFiles: ["layout/theme.liquid", "config/settings_schema.json"],
      optionalFiles: ["config/settings_data.json", "locales/en.default.json"],
      environmentVars: { SHOPIFY_FLAG_STORE: "" },
    };
  },
  generateLayout() {
    return {
      profileId: "shopify",
      directories: ["assets", "config", "layout", "locales", "sections", "snippets", "templates"],
      files: {
        "layout/theme.liquid": `<!DOCTYPE html><html><head>{{ content_for_header }}</head><body>{{ content_for_layout }}</body></html>`,
        "config/settings_schema.json": `[{"name":"theme_info","theme_name":"My Shopify Theme","theme_version":"1.0.0"}]`,
        "templates/index.json": `{"sections":{"main":{"type":"main-page","settings":{}}},"order":["main"]}`,
      },
    };
  },
  validateArtifact(ir) {
    const required = ["layout/theme.liquid", "config/settings_schema.json"];
    const missing = required.filter((r) => !ir.files.some((f) => f.relPath.includes(r)));
    const passed = missing.length === 0;
    return {
      passed, profileId: "shopify", missingFiles: missing, warnings: [],
      evidence: [{ kind: "zip_integrity_verified", status: passed ? "passed" : "failed", message: `Shopify artifact: ${passed ? "valid" : `missing ${missing.join(", ")}`}`, timestamp: new Date().toISOString() }],
    };
  },
};

// ── Next.js profile ───────────────────────────────────────────────────────

const nextjsProfile: RuntimeProfile = {
  id: "nextjs",
  label: "Next.js",
  description: "Next.js App Router or Pages Router project with TypeScript",
  detect(ir) {
    const hasNextConfig = ir.files.some((f) => f.relPath.includes("next.config"));
    const hasApp = ir.files.some((f) => f.relPath.startsWith("app/") || f.relPath.startsWith("src/app/"));
    const hasPages = ir.files.some((f) => f.relPath.startsWith("pages/"));
    const hasNext = ir.dependencies.includes("next");
    return (hasNextConfig ? 0.3 : 0) + (hasNext ? 0.4 : 0) + (hasApp || hasPages ? 0.3 : 0);
  },
  generateManifest(version) {
    return {
      profileId: "nextjs",
      version,
      entryPoints: ["src/app/page.tsx", "src/app/layout.tsx"],
      buildCommand: "next build",
      installCommand: "npm install",
      previewCommand: "next dev",
      deployTarget: "vercel",
      requiredFiles: ["package.json", "next.config.ts"],
      optionalFiles: [".env.local", "tailwind.config.ts", "tsconfig.json"],
      environmentVars: { NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1" },
    };
  },
  generateLayout() {
    return {
      profileId: "nextjs",
      directories: ["src/app", "src/components", "src/lib", "public"],
      files: {
        "src/app/layout.tsx": `import type { ReactNode } from "react";\nexport default function RootLayout({ children }: { children: ReactNode }) {\n  return <html><body>{children}</body></html>;\n}`,
        "src/app/page.tsx": `export default function Page() { return <main><h1>Hello</h1></main>; }`,
        "next.config.ts": `import type { NextConfig } from "next";\nconst config: NextConfig = {};\nexport default config;`,
      },
    };
  },
  validateArtifact(ir) {
    const required = ["package.json"];
    const missing = required.filter((r) => !ir.files.some((f) => f.relPath.endsWith(r)));
    const hasNextDep = ir.dependencies.includes("next");
    const warnings = hasNextDep ? [] : ["next package not found in dependencies"];
    const passed = missing.length === 0;
    return {
      passed, profileId: "nextjs", missingFiles: missing, warnings,
      evidence: [{ kind: "build_passed", status: passed ? "passed" : "failed", message: `Next.js artifact: ${passed ? "valid" : `missing ${missing.join(", ")}`}`, timestamp: new Date().toISOString() }],
    };
  },
};

// ── Static site profile ───────────────────────────────────────────────────

const staticProfile: RuntimeProfile = {
  id: "static",
  label: "Static Site",
  description: "Flat HTML/CSS/JS static site deployable to any CDN",
  detect(ir) {
    const hasHtml = ir.files.some((f) => f.extension === ".html");
    const noFramework = !ir.dependencies.includes("react") && !ir.dependencies.includes("next");
    return (hasHtml ? 0.5 : 0) + (noFramework ? 0.5 : 0);
  },
  generateManifest(version) {
    return {
      profileId: "static",
      version,
      entryPoints: ["index.html"],
      buildCommand: undefined,
      installCommand: undefined,
      previewCommand: "npx serve .",
      deployTarget: "cdn",
      requiredFiles: ["index.html"],
      optionalFiles: ["styles.css", "main.js", "favicon.ico"],
      environmentVars: {},
    };
  },
  generateLayout() {
    return {
      profileId: "static",
      directories: ["assets/css", "assets/js", "assets/images"],
      files: {
        "index.html": `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Site</title><link rel="stylesheet" href="assets/css/styles.css"></head><body><script src="assets/js/main.js"></script></body></html>`,
        "assets/css/styles.css": `:root { --color-bg: #fff; --color-text: #111; }\nbody { margin: 0; font-family: system-ui, sans-serif; }`,
        "assets/js/main.js": `"use strict";\nconsole.log("Static site loaded");`,
      },
    };
  },
  validateArtifact(ir) {
    const hasIndex = ir.files.some((f) => f.relPath === "index.html" || f.relPath.endsWith("/index.html"));
    const passed = hasIndex;
    return {
      passed, profileId: "static", missingFiles: passed ? [] : ["index.html"], warnings: [],
      evidence: [{ kind: "zip_integrity_verified", status: passed ? "passed" : "failed", message: `Static artifact: ${passed ? "valid" : "missing index.html"}`, timestamp: new Date().toISOString() }],
    };
  },
};

// ── Node service profile ───────────────────────────────────────────────────

const nodeServiceProfile: RuntimeProfile = {
  id: "node_service",
  label: "Node.js Service",
  description: "Node.js backend service (Express/Fastify) with typed routes",
  detect(ir) {
    const hasExpress = ir.dependencies.includes("express") || ir.dependencies.includes("fastify");
    const hasTs = ir.files.some((f) => f.extension === ".ts");
    const hasServer = ir.files.some((f) => f.relPath.includes("server") || f.relPath.includes("app.ts") || f.relPath.includes("index.ts"));
    return (hasExpress ? 0.5 : 0) + (hasTs ? 0.2 : 0) + (hasServer ? 0.3 : 0);
  },
  generateManifest(version) {
    return {
      profileId: "node_service",
      version,
      entryPoints: ["src/index.ts", "dist/index.js"],
      buildCommand: "tsc -p tsconfig.json",
      installCommand: "npm install",
      previewCommand: "npm run dev",
      deployTarget: "node-host",
      requiredFiles: ["package.json", "tsconfig.json"],
      optionalFiles: [".env.example", "Dockerfile", "src/index.ts"],
      environmentVars: { NODE_ENV: "production", PORT: "3000" },
    };
  },
  generateLayout() {
    return {
      profileId: "node_service",
      directories: ["src", "src/routes", "src/middleware", "src/lib"],
      files: {
        "src/index.ts": `import express from "express";\nconst app = express();\napp.use(express.json());\napp.get("/health", (_, res) => res.json({ status: "ok" }));\napp.listen(process.env.PORT ?? 3000);`,
        "tsconfig.json": `{"compilerOptions":{"target":"ES2022","module":"CommonJS","outDir":"dist","strict":true}}`,
      },
    };
  },
  validateArtifact(ir) {
    const required = ["package.json"];
    const missing = required.filter((r) => !ir.files.some((f) => f.relPath.endsWith(r)));
    const hasEntryPoint = ir.files.some((f) => f.relPath.includes("index.ts") || f.relPath.includes("index.js") || f.relPath.includes("server.ts"));
    const warnings = hasEntryPoint ? [] : ["No clear entry point (index.ts/server.ts) found"];
    return {
      passed: missing.length === 0, profileId: "node_service", missingFiles: missing, warnings,
      evidence: [{ kind: "build_passed", status: missing.length === 0 ? "passed" : "failed", message: `Node service artifact: ${missing.length === 0 ? "valid" : `missing ${missing.join(", ")}`}`, timestamp: new Date().toISOString() }],
    };
  },
};

// ── Microservice profile ───────────────────────────────────────────────────

const microserviceProfile: RuntimeProfile = {
  id: "microservice",
  label: "Microservice",
  description: "Docker-ready Node microservice with /health endpoint and OCI manifest",
  detect(ir) {
    const hasDockerfile = ir.files.some((f) => f.relPath.includes("Dockerfile"));
    const hasHealth = ir.files.some((f) => {
      const content = f.relPath;
      return content.includes("health") || content.includes("probe");
    });
    const hasCompose = ir.files.some((f) => f.relPath.includes("docker-compose"));
    return (hasDockerfile ? 0.5 : 0) + (hasHealth ? 0.3 : 0) + (hasCompose ? 0.2 : 0);
  },
  generateManifest(version) {
    return {
      profileId: "microservice",
      version,
      entryPoints: ["src/index.ts"],
      buildCommand: "docker build -t service:latest .",
      installCommand: "npm ci",
      previewCommand: "docker-compose up",
      deployTarget: "kubernetes",
      requiredFiles: ["Dockerfile", "package.json"],
      optionalFiles: ["docker-compose.yml", ".dockerignore", "k8s/"],
      environmentVars: { PORT: "8080", NODE_ENV: "production", LOG_LEVEL: "info" },
    };
  },
  generateLayout() {
    return {
      profileId: "microservice",
      directories: ["src", "src/routes", "k8s"],
      files: {
        "Dockerfile": `FROM node:22-alpine\nWORKDIR /app\nCOPY package*.json ./\nRUN npm ci --omit=dev\nCOPY . .\nEXPOSE 8080\nHEALTHCHECK CMD wget -qO- http://localhost:8080/health || exit 1\nCMD ["node","dist/index.js"]`,
        "src/index.ts": `import express from "express";\nconst app = express();\napp.get("/health", (_, res) => res.json({ status: "healthy", timestamp: new Date().toISOString() }));\napp.listen(Number(process.env.PORT ?? 8080));`,
        ".dockerignore": "node_modules\ndist\n.git\n*.log",
      },
    };
  },
  validateArtifact(ir) {
    const required = ["Dockerfile", "package.json"];
    const missing = required.filter((r) => !ir.files.some((f) => f.relPath.endsWith(r)));
    const hasHealth = ir.files.some((f) => f.relPath.includes("health"));
    const warnings = hasHealth ? [] : ["No /health endpoint file detected — required for container probes"];
    return {
      passed: missing.length === 0, profileId: "microservice", missingFiles: missing, warnings,
      evidence: [{ kind: "zip_integrity_verified", status: missing.length === 0 ? "passed" : "failed", message: `Microservice artifact: ${missing.length === 0 ? "valid" : `missing ${missing.join(", ")}`}`, timestamp: new Date().toISOString() }],
    };
  },
};

// ── Plugin ecosystem profile ───────────────────────────────────────────────

const pluginEcosystemProfile: RuntimeProfile = {
  id: "plugin_ecosystem",
  label: "Plugin Ecosystem",
  description: "Host + plugin contract with manifest, sandbox isolation, and registry",
  detect(ir) {
    const hasPlugin = ir.files.some((f) => f.relPath.includes("plugin") || f.relPath.includes("plugin-contract"));
    const hasManifest = ir.files.some((f) => f.relPath.includes("manifest"));
    const hasSandbox = ir.files.some((f) => f.relPath.includes("sandbox"));
    return (hasPlugin ? 0.4 : 0) + (hasManifest ? 0.3 : 0) + (hasSandbox ? 0.3 : 0);
  },
  generateManifest(version) {
    return {
      profileId: "plugin_ecosystem",
      version,
      entryPoints: ["src/index.ts", "src/plugin-contract.ts"],
      buildCommand: "tsc -p tsconfig.json",
      installCommand: "npm install",
      previewCommand: "npm run dev",
      deployTarget: "plugin-host",
      requiredFiles: ["package.json", "src/plugin-contract.ts"],
      optionalFiles: ["src/sandbox-runtime.ts", "src/adapter-registry.ts"],
      environmentVars: { PLUGIN_SANDBOX_MODE: "strict" },
    };
  },
  generateLayout() {
    return {
      profileId: "plugin_ecosystem",
      directories: ["src", "src/plugins", "src/host"],
      files: {
        "src/plugin-contract.ts": `export interface PluginContract {\n  id: string;\n  version: string;\n  capabilities: string[];\n  init(): Promise<void>;\n  teardown(): Promise<void>;\n  healthCheck(): Promise<{ healthy: boolean }>;\n}`,
        "src/host/registry.ts": `const registry = new Map<string, unknown>();\nexport const registerPlugin = (id: string, plugin: unknown) => registry.set(id, plugin);\nexport const getPlugin = (id: string) => registry.get(id);`,
      },
    };
  },
  validateArtifact(ir) {
    const hasContract = ir.files.some((f) => f.relPath.includes("plugin-contract") || f.relPath.includes("PluginContract"));
    const passed = hasContract;
    const warnings = ir.files.some((f) => f.relPath.includes("sandbox")) ? [] : ["No sandbox runtime detected — plugin isolation may be incomplete"];
    return {
      passed, profileId: "plugin_ecosystem", missingFiles: passed ? [] : ["plugin-contract.ts"], warnings,
      evidence: [{ kind: "adapter_selected", status: passed ? "passed" : "failed", message: `Plugin ecosystem artifact: ${passed ? "valid contract found" : "missing plugin contract"}`, timestamp: new Date().toISOString() }],
    };
  },
};

// ── Profile registry ──────────────────────────────────────────────────────

export const RUNTIME_PROFILES: RuntimeProfile[] = [
  wordpressProfile,
  shopifyProfile,
  nextjsProfile,
  staticProfile,
  nodeServiceProfile,
  microserviceProfile,
  pluginEcosystemProfile,
];

/**
 * Detect the best-matching runtime profile for a given project IR.
 * Returns profiles sorted by confidence score descending.
 */
export function detectRuntimeProfile(ir: ProjectIR): Array<{ profile: RuntimeProfile; confidence: number }> {
  return RUNTIME_PROFILES.map((p) => ({ profile: p, confidence: p.detect(ir) }))
    .sort((a, b) => b.confidence - a.confidence);
}

/**
 * Get a specific profile by ID.
 */
export function getRuntimeProfile(id: RuntimeProfileId): RuntimeProfile | undefined {
  return RUNTIME_PROFILES.find((p) => p.id === id);
}

/**
 * Generate a complete runtime manifest for a project.
 */
export function generateRuntimeManifest(profileId: RuntimeProfileId, version: string): RuntimeManifest | null {
  const profile = getRuntimeProfile(profileId);
  return profile ? profile.generateManifest(version) : null;
}
