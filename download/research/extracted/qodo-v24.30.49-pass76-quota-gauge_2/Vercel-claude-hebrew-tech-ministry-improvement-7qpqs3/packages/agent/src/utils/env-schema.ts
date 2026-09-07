const required = [
  "GITHUB_TOKEN",
  "GROQ_API_KEY",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "REPO",
  "OBJECTIVE",
];

const optional = [
  // LLM fallbacks
  "OPENROUTER_API_KEY",
  "HF_API_KEY",
  "GROQ_API_KEYS",
  "GEMINI_API_KEY",
  "CEREBRAS_API_KEY",
  "MISTRAL_API_KEY",
  "TOGETHER_API_KEY",
  "SAMBANOVA_API_KEY",
  // Cloudflare R2 storage
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET",
  // Vercel deployment & canary
  "VERCEL_PREVIEW_URL",
  "VERCEL_AUTOMATION_BYPASS_SECRET",
  "VERCEL_TOKEN",
  "VERCEL_PROJECT_ID",
  "VERCEL_EDGE_CONFIG_ID",
  "VERCEL_PRODUCTION_URL",
  // Upstash multi-Redis
  "UPSTASH_REDIS_REST_URLS",
  "UPSTASH_REDIS_REST_TOKENS",
  "UPSTASH_REDIS_READ_ONLY_TOKEN",
  // Upstash Vector (for vector skill exchange)
  "UPSTASH_VECTOR_REST_URL",
  "UPSTASH_VECTOR_REST_TOKEN",
  "UPSTASH_EMBEDDING_REST_URL",
  // Qodo behavior flags
  "QODO_HIVE_SHARE",
  "QODO_PRIVACY_MODE",
  "QODO_MENTOR_MODE",
  "QODO_SKILL_ID",
  "QODO_TEST_COMMAND",
  // Pipeline context (injected by CI/CD)
  "PR_NUMBER",
  "PR_SHA",
  // Edge testing
  "EDGE_FRAGMENT_WORKER_URL",
  // Runtime
  "NODE_ENV",
  "QODO_DISPATCH_SECRET",

  // Observability
  "AXIOM_TOKEN",
  "AXIOM_DATASET",

  // Integration: Slack Webhook (opt-in)
  "SLACK_WEBHOOK_URL",
  "SLACK_CHANNEL",

  // Integration: Sentry Gate (opt-in)
  "SENTRY_AUTH_TOKEN",
  "SENTRY_ORG",
  "SENTRY_PROJECT",

  // Integration: QStash Async Queue (opt-in)
  "QSTASH_TOKEN",
  "QSTASH_CURRENT_SIGNING_KEY",

  // Integration: Linear / Jira Objective Enrichment (opt-in, pick one)
  "LINEAR_API_KEY",
  "JIRA_BASE_URL",
  "JIRA_TOKEN",

  // Integration: Codecov Coverage Intelligence (opt-in)
  "CODECOV_TOKEN",
];

export function validateEnv() {
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    throw new Error(`[env-schema] missing required secrets: ${missing.join(", ")}`);
  }
  if (process.env.QODO_PRIVACY_MODE === "strict" && process.env.QODO_HIVE_SHARE && process.env.QODO_HIVE_SHARE !== "off") {
    console.warn("[env-schema] QODO_PRIVACY_MODE=strict disables QODO_HIVE_SHARE. Hive sharing is off.");
  }
  const env: Record<string, string | undefined> = {};
  for (const k of [...required, ...optional]) {
    env[k] = process.env[k];
  }
  return env as Record<string, string>;
}
