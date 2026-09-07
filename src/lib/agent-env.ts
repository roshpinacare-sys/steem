import fs from "fs";
import path from "path";

// ─────────────────────────────────────────────────────────────────────────────
// agent-env.ts — local key-vault / autonomy file helpers for the Brain.
// Manages agent/.env (the ONLY sanctioned place a role key may live, per the
// documented SAOS architecture: "agent keys live in the local .env").
// Rules:
//   - Atomic writes (tmp file → rename).
//   - Readers get values; writers never log them; nothing here returns a
//     secret over HTTP (routes return masked public fingerprints only).
//   - agent/.env is git-ignored (agent/.gitignore) and stays on this machine.
// Pure module: no db, no fetch — unit-testable standalone.
// ─────────────────────────────────────────────────────────────────────────────

export const AGENT_DIR = path.join(process.cwd(), "agent");
export const AGENT_ENV_PATH = path.join(AGENT_DIR, ".env");
export const AGENT_STATUS_PATH = path.join(AGENT_DIR, "agent-status.json");

/** Parse a KEY=VALUE dotenv-ish file (ignores comments/blank lines). */
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (key) out[key] = val;
  }
  return out;
}

/** Read agent/.env values ({} when missing). */
export function readAgentEnv(
  envPath: string = AGENT_ENV_PATH,
): Record<string, string> {
  try {
    return parseEnvFile(fs.readFileSync(envPath, "utf8"));
  } catch {
    return {};
  }
}

/**
 * Upsert KEY=VALUE lines into agent/.env. A `null` value REMOVES the key.
 * Existing unrelated lines (comments etc.) are preserved. Atomic write.
 */
export function upsertAgentEnv(
  updates: Record<string, string | null>,
  envPath: string = AGENT_ENV_PATH,
): void {
  let text = "";
  try {
    text = fs.readFileSync(envPath, "utf8");
  } catch {
    text = "# SAOS agent — local configuration (git-ignored, machine-local)\n";
  }

  const lines = text.split(/\r?\n/);
  for (const [key, val] of Object.entries(updates)) {
    const re = new RegExp(`^\\s*${key}\\s*=`);
    const idx = lines.findIndex((l) => re.test(l));
    if (val === null) {
      if (idx >= 0) lines.splice(idx, 1);
    } else if (idx >= 0) {
      lines[idx] = `${key}=${val}`;
    } else {
      lines.push(`${key}=${val}`);
    }
  }

  const next = lines.join("\n").replace(/\n{3,}/g, "\n\n");
  const tmp = `${envPath}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, next.endsWith("\n") ? next : `${next}\n`, "utf8");
  fs.renameSync(tmp, envPath);
}

/** Read agent-status.json (null when missing/corrupt). */
export function readAgentStatus(statusPath: string = AGENT_STATUS_PATH):
  | { updatedAt?: string; account?: string; dryRun?: boolean; [k: string]: unknown }
  | null {
  try {
    return JSON.parse(fs.readFileSync(statusPath, "utf8"));
  } catch {
    return null;
  }
}
