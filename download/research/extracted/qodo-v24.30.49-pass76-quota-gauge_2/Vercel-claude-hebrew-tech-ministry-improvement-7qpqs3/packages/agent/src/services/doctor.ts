/**
 * doctor.ts — the owner's one-command readiness check (`cli.js --doctor`).
 *
 * Answers, in a single local, zero-network, zero-secret-leaking view, the three
 * questions you actually have before a run: "Am I set up?", "What's in
 * control?", and "What will the next run do?". Every failure is actionable —
 * it names the exact setting and where to put it. Complements
 * `bootstrap.mjs --verify` (which pings live services); this one is instant,
 * offline, and folds in the `.qodo/policy.yml` control surface.
 */
import { loadPolicyFromDisk, describePolicy, type QodoPolicy } from "./policy.js";

export interface ReadinessCheck {
  name: string;
  ok: boolean;
  required: boolean;
  detail: string;
  hint?: string;
}

export interface DoctorReport {
  checks: ReadinessCheck[];
  ready: boolean;
  policyValid: boolean;
  text: string;
}

/** Provider keys — any one is enough to run the pipeline. */
const PROVIDER_KEYS = [
  "GROQ_API_KEY",
  "OPENROUTER_API_KEY",
  "GEMINI_API_KEY",
  "CEREBRAS_API_KEY",
  "MISTRAL_API_KEY",
  "TOGETHER_API_KEY",
  "SAMBANOVA_API_KEY",
  "HF_API_KEY",
  "FIREWORKS_API_KEY",
  "DEEPINFRA_API_KEY",
  "NOVITA_API_KEY",
  "CLOUDFLARE_API_TOKEN",
];

function present(env: NodeJS.ProcessEnv, key: string): boolean {
  const v = env[key];
  return typeof v === "string" && v.trim().length > 0;
}

/** The plain-English pipeline path for the resolved policy. */
function nextRunLines(policy: QodoPolicy): string[] {
  const out: string[] = [];
  if (policy.autonomy === "dry-run") {
    out.push("  • Plan → code → 5-gate validate → SIMULATE (no commit / deploy / merge)");
  } else {
    const gate =
      policy.autonomy === "mentor"
        ? " → ⏸ wait for your approval"
        : policy.approval === "manual"
          ? " → ⏸ wait for your approval"
          : policy.approval === "trust"
            ? " → (approval only if the trust bond is low)"
            : policy.approval === "auto"
              ? " → (no approval gate — you pre-approved)"
              : "";
    out.push(`  • Plan → code → 5-gate validate${gate} → commit → canary → merge → review`);
  }
  const cap = policy.budget?.maxUsdCents;
  out.push(`  • Budget:   ${cap ? `halt at $${(cap / 100).toFixed(2)} / run` : "unbounded (operator cost alert only)"}`);
  out.push(`  • Autonomy: ${policy.autonomy}${policy.approval ? ` · approval: ${policy.approval}` : ""}`);
  return out;
}

/**
 * Build the readiness report. `env`/`cwd` are injectable for tests; defaults
 * read the live process environment and working directory.
 */
export function runDoctor(env: NodeJS.ProcessEnv = process.env, cwd: string = process.cwd()): DoctorReport {
  const checks: ReadinessCheck[] = [];

  const hasProvider = PROVIDER_KEYS.some((k) => present(env, k));
  checks.push({
    name: "LLM provider key",
    ok: hasProvider,
    required: true,
    detail: hasProvider ? `set (${PROVIDER_KEYS.filter((k) => present(env, k)).join(", ")})` : "none set",
    hint: "Set one of GROQ_API_KEY (free tier), OPENROUTER_API_KEY, GEMINI_API_KEY, … in .env or repo secrets.",
  });
  checks.push({
    name: "GITHUB_TOKEN",
    ok: present(env, "GITHUB_TOKEN"),
    required: true,
    detail: present(env, "GITHUB_TOKEN") ? "set" : "missing",
    hint: "A PAT (or GitHub App token) with repo + workflow scope.",
  });
  checks.push({
    name: "UPSTASH_REDIS_REST_URL",
    ok: present(env, "UPSTASH_REDIS_REST_URL"),
    required: true,
    detail: present(env, "UPSTASH_REDIS_REST_URL") ? "set" : "missing",
    hint: "Free Upstash Redis REST URL — used for run state, locks and the resume queue.",
  });
  checks.push({
    name: "UPSTASH_REDIS_REST_TOKEN",
    ok: present(env, "UPSTASH_REDIS_REST_TOKEN"),
    required: true,
    detail: present(env, "UPSTASH_REDIS_REST_TOKEN") ? "set" : "missing",
    hint: "Paired with the Upstash URL above.",
  });
  // Optional but useful — surfaced, never fails readiness.
  checks.push({
    name: "Mission Control proxy",
    ok: present(env, "VITE_TELEMETRY_PROXY_URL"),
    required: false,
    detail: present(env, "VITE_TELEMETRY_PROXY_URL") ? "set" : "not set",
    hint: "Optional: VITE_TELEMETRY_PROXY_URL to watch runs live in the dashboard / mobile app.",
  });

  const loaded = loadPolicyFromDisk(cwd);
  const policyValid = !loaded.error;
  const ready = checks.filter((c) => c.required).every((c) => c.ok) && policyValid;

  // ── Compose the report ──────────────────────────────────────────────────
  const lines: string[] = [];
  lines.push("Qodo readiness check");
  lines.push("════════════════════");
  lines.push("");
  lines.push("Configuration (local presence only — no network calls)");
  for (const c of checks) {
    const mark = c.ok ? "✓" : c.required ? "✗" : "–";
    lines.push(`  ${mark} ${c.name.padEnd(24)} ${c.detail}`);
    if (!c.ok && (c.required || c.name === "Mission Control proxy") && c.hint) {
      lines.push(`      → ${c.hint}`);
    }
  }
  lines.push("");
  lines.push(describePolicy(loaded).split("\n").map((l) => (l ? `  ${l}` : l)).join("\n"));
  if (!loaded.source) {
    lines.push("");
    lines.push("  Tip: add .qodo/policy.yml (see .qodo/policy.example.yml) to set a");
    lines.push("  budget cap, autonomy floor and approval mode owned by this repo.");
  }
  lines.push("");
  lines.push("Next run will");
  lines.push(...nextRunLines(loaded.policy));
  lines.push("");
  const missingRequired = checks.filter((c) => c.required && !c.ok).map((c) => c.name);
  if (ready) {
    lines.push("Verdict: READY ✓  — configuration present and policy valid.");
  } else if (!policyValid) {
    lines.push("Verdict: NOT READY ✗  — .qodo/policy is invalid (see above); fix it and re-run --doctor.");
  } else {
    lines.push(`Verdict: NOT READY ✗  — ${missingRequired.length} required setting(s) missing: ${missingRequired.join(", ")}.`);
  }

  return { checks, ready, policyValid, text: lines.join("\n") };
}
