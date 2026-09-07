import type { GitHubClient } from "../services/github-client.js";
import type { R2Storage } from "../services/r2-storage.js";
import type { Telemetry } from "../services/telemetry.js";
import type { CoderOutput } from "../schemas/coder-schema.js";

export interface InfraPatch {
  path: string;
  content: string;
}

/**
 * Scans the Coder's patch for process.env.* variables. For each missing
 * variable in .env.example, it generates a patch to add it and updates
 * vercel.json / wrangler.toml default configurations so deployment config
 * stays in sync with application code.
 */
export async function runInfraOracle(
  patch: CoderOutput,
  gh: GitHubClient,
  storage: R2Storage,
  telemetry?: Telemetry,
): Promise<InfraPatch[]> {
  const envVars = extractEnvVariables(patch);
  if (!envVars.length) {
    await telemetry?.decision("infra-oracle", "no-env-vars", {});
    return [];
  }

  const existingExample = await gh.getFileAtRef(".env.example", "HEAD");
  const existingVars = existingExample ? parseEnvExample(existingExample) : new Set<string>();
  const missing = envVars.filter((v) => !existingVars.has(v));

  const patches: InfraPatch[] = [];
  if (missing.length) {
    const updatedExample = existingExample
      ? `${existingExample.trim()}\n${missing.map((v) => `${v}=`).join("\n")}\n`
      : `${missing.map((v) => `${v}=`).join("\n")}\n`;
    patches.push({ path: ".env.example", content: updatedExample });
  }

  const existingVercel = await gh.getFileAtRef("vercel.json", "HEAD");
  const vercelDefaults = generateVercelDefaults(missing, existingVercel);
  if (vercelDefaults) patches.push({ path: "vercel.json", content: vercelDefaults });

  const existingWrangler = await gh.getFileAtRef("wrangler.toml", "HEAD");
  const wranglerDefaults = generateWranglerDefaults(missing, existingWrangler);
  if (wranglerDefaults) patches.push({ path: "wrangler.toml", content: wranglerDefaults });

  await telemetry?.decision("infra-oracle", "infra-patches-generated", {
    missing,
    patches: patches.map((p) => p.path),
  });

  return patches;
}

function extractEnvVariables(patch: CoderOutput): string[] {
  const regex = /process\.env\.(\w+)/g;
  const found = new Set<string>();
  for (const file of patch.files) {
    // Reset lastIndex before each file so the stateful /g flag does not
    // carry over from the previous file's content and skip leading matches.
    regex.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(file.content)) !== null) {
      found.add(m[1]);
    }
  }
  return Array.from(found).sort();
}

function parseEnvExample(content: string): Set<string> {
  const vars = new Set<string>();
  for (const line of content.split("\n")) {
    const key = line.split("=")[0]?.trim();
    if (key && !key.startsWith("#")) vars.add(key);
  }
  return vars;
}

function generateVercelDefaults(missing: string[], existingContent: string | null): string | null {
  if (!missing.length) return null;
  // Parse existing vercel.json to preserve all current configuration.
  type VercelJson = { env?: Record<string, string> };
  let existing: VercelJson = {};
  if (existingContent) {
    try {
      existing = JSON.parse(existingContent) as VercelJson;
    } catch {
      existing = {};
    }
  }
  const existingEnv: Record<string, string> = existing.env ?? {};
  // Only add env vars that are not already present — never overwrite.
  for (const v of missing) {
    if (!(v in existingEnv)) existingEnv[v] = "";
  }
  const merged = { ...existing, env: existingEnv };
  return JSON.stringify(merged, null, 2);
}

function generateWranglerDefaults(missing: string[], existingContent: string | null): string | null {
  if (!missing.length) return null;
  // Parse the existing [vars] block to avoid overwriting unrelated wrangler config.
  // Strategy: if a [vars] section already exists, append only truly-missing keys inside it.
  // If no [vars] section exists, append a new one at the end.
  const existingVars = new Set<string>();
  if (existingContent) {
    // Extract keys already declared under [vars] (lines of the form KEY = "...")
    const inVarsSection = /\[vars\]([\s\S]*?)(?=\n\[|$)/.exec(existingContent);
    if (inVarsSection) {
      for (const line of inVarsSection[1].split("\n")) {
        const key = line.split("=")[0]?.trim();
        if (key && !key.startsWith("#")) existingVars.add(key);
      }
    }
  }
  const toAdd = missing.filter((v) => !existingVars.has(v));
  if (!toAdd.length) return null;
  const newVars = toAdd.map((v) => `${v} = ""`).join("\n");
  if (existingContent) {
    // Merge: if [vars] block exists, append inside it; otherwise append a new block.
    if (/\[vars\]/.test(existingContent)) {
      return existingContent.replace(/(\[vars\][^\n]*\n)([\s\S]*?)(\n\[|$)/, (_m, header, body, tail) =>
        `${header}${body}${newVars}\n${tail}`,
      );
    }
    return `${existingContent.trimEnd()}\n\n[vars]\n${newVars}\n`;
  }
  return `[vars]\n${newVars}\n`;
}
