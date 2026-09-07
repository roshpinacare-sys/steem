import { readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { spawnSync } from "child_process";
import { createInterface } from "readline";

const rl = createInterface({ input: process.stdin, output: process.stdout });

function prompt(question) {
  return new Promise((resolve) => {
    rl.question(question, resolve);
  });
}

function ghSecretSet(key, value) {
  console.log(`[bootstrap] setting GitHub secret ${key}`);
  const result = spawnSync("gh", ["secret", "set", key, "--body-file", "-"], {
    input: value,
    stdio: ["pipe", "inherit", "inherit"],
  });
  if (result.status !== 0) {
    throw new Error(`gh secret set ${key} failed with exit code ${result.status}`);
  }
}

function ghApiPost(path, body, token) {
  const args = [
    "api", "-X", "POST", path, "-H", "Accept: application/vnd.github+json",
    "-f", `objective=${body.objective}`,
    "-f", `ref=${body.ref || "main"}`,
  ];
  const result = spawnSync("gh", args, { stdio: "pipe", env: { ...process.env, GH_TOKEN: token } });
  if (result.status !== 0) {
    throw new Error(`gh api ${path} failed: ${result.stderr?.toString() || result.status}`);
  }
  return result.stdout?.toString();
}

// ---------------------------------------------------------------------------
// Provider registry — every credential this wizard knows how to collect.
// `required: true` means the pipeline cannot run at all without it.
// LLM providers are individually optional, but at least one must be set —
// enforced after the prompt loop, not per-field.
// ---------------------------------------------------------------------------

const CORE = [
  {
    key: "GITHUB_TOKEN",
    label: "GitHub Token",
    hint: "Needs repo, contents, pull-requests, checks scopes.\n    Get one at: https://github.com/settings/tokens (classic) or run `gh auth token` if you have the GitHub CLI installed.",
    required: true,
  },
  {
    key: "UPSTASH_REDIS_REST_URL",
    label: "Upstash Redis REST URL",
    hint: "Free tier is enough. Create a Redis database at: https://console.upstash.com\n    Copy the \"UPSTASH_REDIS_REST_URL\" shown on the database's REST API tab.",
    required: true,
  },
  {
    key: "UPSTASH_REDIS_REST_TOKEN",
    label: "Upstash Redis REST Token",
    hint: "Same page as above — copy the \"UPSTASH_REDIS_REST_TOKEN\" value.",
    required: true,
  },
  {
    key: "REPO",
    label: "Target repo (owner/name)",
    hint: "The GitHub repo Qodo will operate on, e.g. myusername/my-project.",
    required: true,
  },
  {
    key: "OBJECTIVE",
    label: "Initial mission objective",
    hint: "A plain-English description of the first thing you want the agent to do, e.g. \"Add input validation to the signup form\".",
    required: true,
    default: "Bootstrap mission",
  },
];

const LLM_PROVIDERS = [
  {
    key: "GROQ_API_KEY",
    label: "Groq API Key",
    hint: "Primary / fastest free-tier provider. Get one at: https://console.groq.com/keys",
  },
  {
    key: "OPENROUTER_API_KEY",
    label: "OpenRouter API Key",
    hint: "Fallback tier — some free models available. Get one at: https://openrouter.ai/keys",
  },
  {
    key: "GEMINI_API_KEY",
    label: "Google Gemini API Key",
    hint: "Free tier via Google AI Studio: https://aistudio.google.com/app/apikey",
  },
  {
    key: "CEREBRAS_API_KEY",
    label: "Cerebras API Key",
    hint: "Free tier, very fast inference: https://cloud.cerebras.ai",
  },
  {
    key: "MISTRAL_API_KEY",
    label: "Mistral API Key",
    hint: "Free tier via La Plateforme: https://console.mistral.ai/api-keys",
  },
  {
    key: "TOGETHER_API_KEY",
    label: "Together.ai API Key",
    hint: "Free \"Turbo Free\" models: https://api.together.ai/settings/api-keys",
  },
  {
    key: "SAMBANOVA_API_KEY",
    label: "SambaNova API Key",
    hint: "Free tier: https://cloud.sambanova.ai/apis",
  },
  {
    key: "HF_API_KEY",
    label: "Hugging Face API Key",
    hint: "Free Inference Router access: https://huggingface.co/settings/tokens",
  },
];

const OPTIONAL_INFRA = [
  {
    key: "R2_ACCOUNT_ID",
    label: "Cloudflare R2 Account ID",
    hint: "Only needed for semantic-cache / Hive sharing. https://dash.cloudflare.com -> R2",
  },
  { key: "R2_ACCESS_KEY_ID", label: "Cloudflare R2 Access Key ID", hint: "Same R2 dashboard, \"Manage API Tokens\"." },
  { key: "R2_SECRET_ACCESS_KEY", label: "Cloudflare R2 Secret Access Key", hint: "Shown once when the R2 API token is created." },
  { key: "R2_BUCKET", label: "Cloudflare R2 Bucket name", hint: "The bucket you created for Qodo's cache/artifacts." },
  { key: "VERCEL_TOKEN", label: "Vercel Token", hint: "Only needed for canary traffic routing. https://vercel.com/account/tokens" },
  { key: "VERCEL_PROJECT_ID", label: "Vercel Project ID", hint: "Found in your Vercel project's Settings page." },
  { key: "VERCEL_EDGE_CONFIG_ID", label: "Vercel Edge Config ID", hint: "Found under Storage -> Edge Config in Vercel." },
];

// ---------------------------------------------------------------------------
// .env read/write helpers
// ---------------------------------------------------------------------------

async function loadEnv() {
  try {
    const content = await readFile(".env", "utf-8");
    const env = {};
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx === -1) continue;
      env[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
    }
    return env;
  } catch {
    return {};
  }
}

async function saveEnv(values) {
  const lines = ["# Written by bootstrap.mjs — do not commit this file.", ""];
  for (const [key, value] of Object.entries(values)) {
    if (value) lines.push(`${key}=${value}`);
  }
  await writeFile(".env", lines.join("\n") + "\n", "utf-8");
  console.log("[bootstrap] wrote .env (local run / docker-compose can use this directly)");
}

// ---------------------------------------------------------------------------
// Prompt flow
// ---------------------------------------------------------------------------

async function promptGroup(title, intro, fields, existing) {
  console.log("");
  console.log(`── ${title} ${"─".repeat(Math.max(0, 60 - title.length))}`);
  if (intro) console.log(intro);
  const values = {};
  for (const field of fields) {
    const existingValue = existing[field.key];
    const suffix = existingValue
      ? " [already set, press Enter to keep]"
      : field.required
        ? " [required]"
        : " [optional, press Enter to skip]";
    if (field.hint) console.log(`\n  ${field.hint}`);
    const answer = await prompt(`  ${field.label}${suffix}: `);
    values[field.key] = answer.trim() || existingValue || field.default || "";
  }
  return values;
}


// ---------------------------------------------------------------------------
// --verify: non-interactive configuration check
// ---------------------------------------------------------------------------

/**
 * Checks the local .env (plus current process env) against the same
 * requirements the pipeline enforces, prints a grouped summary, and exits
 * 0 when runnable / 1 when not — without launching anything.
 *
 * With --live it also pings GitHub, Upstash Redis and Groq using the
 * credentials found, so a typo'd token is caught before the first mission.
 */
async function verifyConfig(live) {
  const fileEnv = await loadEnv();
  const env = { ...fileEnv, ...process.env };
  const mark = (ok) => (ok ? "  ✓" : "  ✗");
  let runnable = true;

  console.log("[bootstrap] configuration check" + (live ? " (with live credential pings)" : ""));
  console.log("");

  console.log("Required — core pipeline");
  for (const field of CORE) {
    const ok = Boolean(env[field.key]);
    // OBJECTIVE is per-mission input (workflow_dispatch / CLI env), not
    // standing configuration — report it, but don't block on it.
    if (field.key === "OBJECTIVE") {
      console.log(`${ok ? "  ✓" : "  –"} ${field.key.padEnd(26)} ${ok ? "set" : "not set (supplied per mission at dispatch time)"}`);
      continue;
    }
    if (!ok) runnable = false;
    console.log(`${mark(ok)} ${field.key.padEnd(26)} ${ok ? "set" : "MISSING — " + field.label}`);
  }

  console.log("");
  console.log("LLM providers (at least one required)");
  let anyProvider = false;
  for (const field of LLM_PROVIDERS) {
    const ok = Boolean(env[field.key]);
    anyProvider = anyProvider || ok;
    console.log(`${ok ? "  ✓" : "  –"} ${field.key.padEnd(26)} ${ok ? "set" : "not set (optional)"}`);
  }
  if (!anyProvider) {
    runnable = false;
    console.log("  ✗ no LLM provider key found — set at least one of the above");
  }

  console.log("");
  console.log("Optional infrastructure (features degrade gracefully without these)");
  for (const field of OPTIONAL_INFRA) {
    const ok = Boolean(env[field.key]);
    console.log(`${ok ? "  ✓" : "  –"} ${field.key.padEnd(26)} ${ok ? "set" : "not set — " + field.hint.split(".")[0]}`);
  }

  if (live) {
    console.log("");
    console.log("Live credential checks");
    const ping = async (name, url, headers) => {
      try {
        const r = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
        const ok = r.ok;
        if (!ok) runnable = false;
        console.log(`${mark(ok)} ${name.padEnd(26)} ${ok ? "reachable, credentials accepted" : `HTTP ${r.status}`}`);
      } catch (e) {
        runnable = false;
        console.log(`  ✗ ${name.padEnd(26)} ${e instanceof Error ? e.message : String(e)}`);
      }
    };
    if (env.GITHUB_TOKEN) {
      await ping("GitHub", "https://api.github.com/user", { Authorization: `Bearer ${env.GITHUB_TOKEN}`, "User-Agent": "qodo-bootstrap" });
    }
    if (env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN) {
      await ping("Upstash Redis", `${env.UPSTASH_REDIS_REST_URL}/ping`, { Authorization: `Bearer ${env.UPSTASH_REDIS_REST_TOKEN}` });
    }
    if (env.GROQ_API_KEY) {
      await ping("Groq", "https://api.groq.com/openai/v1/models", { Authorization: `Bearer ${env.GROQ_API_KEY}` });
    }
  }

  console.log("");
  if (runnable) {
    console.log("[bootstrap] ✓ configuration is runnable." + (live ? "" : " Add --live to also verify the credentials against the real services."));
  } else {
    console.log("[bootstrap] ✗ configuration is NOT runnable yet — fix the ✗ items above, or run `node bootstrap.mjs` for the guided setup.");
  }
  process.exit(runnable ? 0 : 1);
}

async function main() {
  console.log("[bootstrap] Qodo V24 guided setup");
  console.log("This wizard collects your credentials, saves them to a local .env,");
  console.log("and (if you have the GitHub CLI installed and authenticated) also");
  console.log("pushes them as GitHub Actions secrets so the pipeline can run in CI.");
  const existing = await loadEnv();

  const core = await promptGroup(
    "Required — core pipeline",
    "These four are needed for Qodo to run at all.",
    CORE,
    existing,
  );

  const llm = await promptGroup(
    "LLM providers — set at least ONE",
    "Every one of these has a free tier. You only need one to get started;\n" +
    "adding more just gives the agent more free-tier fallback capacity.\n" +
    "Leave any you don't want blank and press Enter.",
    LLM_PROVIDERS,
    existing,
  );

  const hasAnyLlmKey = Object.values(llm).some((v) => v);
  if (!hasAnyLlmKey) {
    console.error("\n[bootstrap] No LLM provider key was set. At least one is required.");
    console.error("[bootstrap] The easiest to get is Groq: https://console.groq.com/keys");
    rl.close();
    process.exit(1);
  }

  const infra = await promptGroup(
    "Optional infra — safe to skip for a first run",
    "R2 (semantic cache / Hive) and Vercel (canary traffic) are both optional.\n" +
    "Skip these for now if you just want to see Qodo run once.",
    OPTIONAL_INFRA,
    existing,
  );

  const allValues = { ...core, ...llm, ...infra };

  if (!allValues.GITHUB_TOKEN || !allValues.UPSTASH_REDIS_REST_URL ||
      !allValues.UPSTASH_REDIS_REST_TOKEN || !allValues.REPO) {
    console.error("\n[bootstrap] Missing a required core value. Re-run and fill in all four.");
    rl.close();
    process.exit(1);
  }

  await saveEnv(allValues);

  const hasGh = spawnSync("gh", ["--version"], { stdio: "ignore" }).status === 0;
  if (hasGh) {
    console.log("\n[bootstrap] GitHub CLI detected — pushing secrets to the repo too.");
    for (const [key, value] of Object.entries(allValues)) {
      if (key === "REPO" || key === "OBJECTIVE" || !value) continue;
      // GitHub REJECTS any secret whose name starts with the reserved
      // GITHUB_ prefix, and the committed workflow reads the token as
      // QODO_GITHUB_TOKEN — push it under that name.
      ghSecretSet(key === "GITHUB_TOKEN" ? "QODO_GITHUB_TOKEN" : key, value);
    }
    await ensureWorkflowFile(allValues.REPO, allValues.GITHUB_TOKEN);

    const runNow = (await prompt("\nTrigger the first run now via workflow_dispatch? [y/N]: "))
      .trim().toLowerCase();
    if (runNow === "y" || runNow === "yes") {
      ghApiPost(
        `repos/${allValues.REPO}/actions/workflows/agent-pipeline.yml/dispatches`,
        { objective: allValues.OBJECTIVE },
        allValues.GITHUB_TOKEN,
      );
      console.log("[bootstrap] workflow_dispatch triggered — check the Actions tab on GitHub.");
    }
  } else {
    console.log("\n[bootstrap] GitHub CLI (`gh`) not found — skipped pushing secrets to GitHub.");
    console.log("[bootstrap] Your .env is saved for a local run:");
    console.log("[bootstrap]   npm install && npm run build && node packages/agent/dist/cli.js");
    console.log("[bootstrap] To use GitHub Actions instead, install `gh`, run `gh auth login`,");
    console.log("[bootstrap] then re-run `node bootstrap.mjs` to push these values as secrets.");
  }

  console.log("\n[bootstrap] done. See SETUP.md for the full guided walkthrough.");
  rl.close();
}

async function ensureWorkflowFile(repo, token) {
  const workflowPath = ".github/workflows/agent-pipeline.yml";
  if (existsSync(workflowPath)) {
    console.log("[bootstrap] workflow file already exists locally");
    return;
  }
  console.log("[bootstrap] workflow file not found locally; checking remote");
  const check = spawnSync("gh", ["api", `repos/${repo}/contents/${workflowPath}`, "-H", "Accept: application/vnd.github+json"], {
    stdio: "pipe",
    env: { ...process.env, GH_TOKEN: token },
  });
  if (check.status === 0) {
    console.log("[bootstrap] workflow file already exists in remote repo");
    return;
  }

  // Single source of truth: the committed .github/workflows/agent-pipeline.yml.
  // This script used to write its own inline workflow template here; that
  // template had drifted from the committed pipeline (different secret names,
  // no typecheck/test/security jobs) and provisioning from it produced repos
  // whose CI contradicted the repo they were scaffolded from.
  console.error(
    `[bootstrap] ${workflowPath} is missing locally AND in ${repo}.\n` +
    "  Copy it from the Qodo repository (it ships at that exact path) and re-run.\n" +
    "  Refusing to generate an ad-hoc workflow so the committed pipeline stays the single source of truth.",
  );
  process.exit(1);
}

/**
 * --mobile-setup-code: print the one-line code the Mission Control mobile
 * app's Connect wizard accepts (base64 JSON {url, secret}). Sources: the
 * local .env plus the current process env. No secret is sent anywhere —
 * the user carries the line to their phone themselves.
 */
async function printMobileSetupCode() {
  const fileEnv = await loadEnv();
  const env = { ...fileEnv, ...process.env };
  const url = (env.VITE_TELEMETRY_PROXY_URL || env.TELEMETRY_PROXY_URL || "").replace(/\/+$/, "");
  const secret = env.QODO_DISPATCH_SECRET || "";
  if (!url) {
    console.error(
      "[bootstrap] no telemetry proxy URL found.\n" +
      "  Set VITE_TELEMETRY_PROXY_URL in .env (your deployed worker/telemetry-proxy.js URL) and re-run.",
    );
    process.exit(1);
  }
  if (!secret) {
    console.error("[bootstrap] QODO_DISPATCH_SECRET is not set in .env — the app can't authenticate without it.");
    process.exit(1);
  }
  const code = Buffer.from(JSON.stringify({ url, secret }), "utf-8").toString("base64");
  console.log("\n[bootstrap] Mobile setup code — in the app: Settings → Connection → Setup code, paste this line:\n");
  console.log(code);
  console.log("\n[bootstrap] The code contains your dispatch passphrase; treat it like a password.");
}

if (process.argv.includes("--mobile-setup-code")) {
  rl.close();
  printMobileSetupCode().catch((e) => {
    console.error("[bootstrap] mobile-setup-code failed", e);
    process.exit(1);
  });
} else if (process.argv.includes("--verify")) {
  rl.close();
  verifyConfig(process.argv.includes("--live")).catch((e) => {
    console.error("[bootstrap] verify failed", e);
    process.exit(1);
  });
} else {
  main().catch((e) => {
  console.error("[bootstrap] fatal", e);
  rl.close();
  process.exit(1);
});
}
