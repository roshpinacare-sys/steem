/**
 * Regression tests for the 8 Tier-1 power-expansion integrations.
 * All external HTTP calls are stubbed via vi.stubGlobal("fetch", ...).
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

// ── helpers ──────────────────────────────────────────────────────────────────

function makeFetch(responses: Array<{ ok: boolean; status?: number; body: unknown }>) {
  let idx = 0;
  return vi.fn(async () => {
    const r = responses[Math.min(idx++, responses.length - 1)];
    return {
      ok: r.ok,
      status: r.status ?? (r.ok ? 200 : 500),
      json: async () => r.body,
      text: async () => JSON.stringify(r.body),
    };
  }) as unknown as typeof fetch;
}

afterEach(() => vi.restoreAllMocks());

// ── Integration 1: GitHub Issues ─────────────────────────────────────────────

import {
  fetchRelevantIssues,
  formatIssuesContext,
  GitHubIssuesConfigSchema,
} from "../../src/services/integrations/github-issues.js";

describe("github-issues — fetchRelevantIssues", () => {
  it("returns relevant issues filtered by keyword", async () => {
    const stub = makeFetch([{
      ok: true,
      body: [
        { number: 1, title: "fix login timeout bug", body: "users cannot login", labels: [{ name: "bug" }], html_url: "https://github.com/o/r/issues/1" },
        { number: 2, title: "add dark mode", body: "feature request for dark mode", labels: [{ name: "enhancement" }], html_url: "https://github.com/o/r/issues/2" },
        { number: 3, title: "unrelated database migration", body: "migrate schema", labels: [{ name: "chore" }], html_url: "https://github.com/o/r/issues/3" },
      ],
    }]);
    vi.stubGlobal("fetch", stub);

    const cfg = GitHubIssuesConfigSchema.parse({ token: "tok", owner: "o", repo: "r" });
    const issues = await fetchRelevantIssues("fix login issue", cfg);
    expect(issues.length).toBeGreaterThanOrEqual(1);
    expect(issues.some((i) => i.number === 1)).toBe(true);
  });

  it("returns empty array on HTTP error", async () => {
    vi.stubGlobal("fetch", makeFetch([{ ok: false, status: 403, body: {} }]));
    const cfg = GitHubIssuesConfigSchema.parse({ token: "tok", owner: "o", repo: "r" });
    expect(await fetchRelevantIssues("anything", cfg)).toEqual([]);
  });

  it("returns empty array when privacy mode is strict", async () => {
    process.env.QODO_PRIVACY_MODE = "strict";
    const cfg = GitHubIssuesConfigSchema.parse({ token: "tok", owner: "o", repo: "r" });
    expect(await fetchRelevantIssues("anything", cfg)).toEqual([]);
    delete process.env.QODO_PRIVACY_MODE;
  });

  it("formatIssuesContext produces non-empty string from valid issues", () => {
    const result = formatIssuesContext([{ number: 7, title: "test", body: "", labels: ["bug"], url: "u" }]);
    expect(result).toContain("#7");
  });

  it("schema rejects missing token", () => {
    expect(() => GitHubIssuesConfigSchema.parse({ owner: "o", repo: "r" })).toThrow();
  });
});

// ── Integration 2: Slack Webhook ─────────────────────────────────────────────

import {
  notifySlack,
  resolveSlackConfig,
  SlackWebhookConfigSchema,
} from "../../src/services/integrations/slack-webhook.js";

describe("slack-webhook — notifySlack", () => {
  it("posts to webhook URL", async () => {
    const stub = makeFetch([{ ok: true, body: "ok" }]);
    vi.stubGlobal("fetch", stub);
    const cfg = SlackWebhookConfigSchema.parse({ webhookUrl: "https://hooks.slack.com/x" });
    await notifySlack({ type: "phase_transition", phase: "architect", message: "done" }, cfg);
    expect(stub).toHaveBeenCalledOnce();
  });

  it("retries once on failure then gives up silently", async () => {
    const stub = makeFetch([{ ok: false, status: 500, body: {} }, { ok: false, status: 500, body: {} }]);
    vi.stubGlobal("fetch", stub);
    const cfg = SlackWebhookConfigSchema.parse({ webhookUrl: "https://hooks.slack.com/x" });
    await expect(notifySlack({ type: "gate_failure", message: "gate failed" }, cfg)).resolves.toBeUndefined();
    expect(stub).toHaveBeenCalledTimes(2);
  });

  it("resolveSlackConfig returns null when env var absent", () => {
    expect(resolveSlackConfig({})).toBeNull();
  });

  it("resolveSlackConfig returns config when env var present", () => {
    const cfg = resolveSlackConfig({ SLACK_WEBHOOK_URL: "https://hooks.slack.com/x", SLACK_CHANNEL: "#alerts" });
    expect(cfg).not.toBeNull();
    expect(cfg?.channel).toBe("#alerts");
  });

  it("schema rejects extra property (.strict)", () => {
    expect(() => SlackWebhookConfigSchema.parse({ webhookUrl: "https://hooks.slack.com/x", extra: 1 })).toThrow();
  });
});

// ── Integration 3: Sentry Gate ───────────────────────────────────────────────

import {
  checkSentryRisk,
  resolveSentryConfig,
  SentryGateConfigSchema,
} from "../../src/services/integrations/sentry-gate.js";

const SENTRY_ISSUE = {
  id: "1",
  title: "TypeError in login.ts",
  culprit: "login.ts",
  metadata: { filename: "src/login.ts" },
  entries: [],
};

describe("sentry-gate — checkSentryRisk", () => {
  it("returns riskBonus=20 when a target file is in Sentry stack traces", async () => {
    vi.stubGlobal("fetch", makeFetch([{ ok: true, body: [SENTRY_ISSUE] }]));
    const cfg = SentryGateConfigSchema.parse({ authToken: "t", org: "o", project: "p" });
    const result = await checkSentryRisk(["src/login.ts"], cfg);
    expect(result.hasUnresolvedErrors).toBe(true);
    expect(result.riskBonus).toBe(20);
  });

  it("returns riskBonus=0 when no target files match", async () => {
    vi.stubGlobal("fetch", makeFetch([{ ok: true, body: [SENTRY_ISSUE] }]));
    const cfg = SentryGateConfigSchema.parse({ authToken: "t", org: "o", project: "p" });
    const result = await checkSentryRisk(["src/unrelated.ts"], cfg);
    expect(result.riskBonus).toBe(0);
  });

  it("returns zero result on HTTP error", async () => {
    vi.stubGlobal("fetch", makeFetch([{ ok: false, status: 401, body: {} }]));
    const cfg = SentryGateConfigSchema.parse({ authToken: "t", org: "o", project: "p" });
    const result = await checkSentryRisk(["src/login.ts"], cfg);
    expect(result.riskBonus).toBe(0);
  });

  it("resolveSentryConfig returns null when env vars missing", () => {
    expect(resolveSentryConfig({})).toBeNull();
  });

  it("schema rejects extra property (.strict)", () => {
    expect(() => SentryGateConfigSchema.parse({ authToken: "t", org: "o", project: "p", extra: 1 })).toThrow();
  });
});

// ── Integration 4: QStash Async ──────────────────────────────────────────────

import {
  publishAsyncTask,
  resolveQStashConfig,
  QStashConfigSchema,
} from "../../src/services/integrations/qstash-async.js";

describe("qstash-async — publishAsyncTask", () => {
  it("returns published=true on 200 response", async () => {
    vi.stubGlobal("fetch", makeFetch([{ ok: true, body: { messageId: "msg-1" } }]));
    const cfg = QStashConfigSchema.parse({ token: "t", signingKey: "sk" });
    const result = await publishAsyncTask(
      { type: "sre_feedback", agentId: "a1", payload: {}, callbackUrl: "https://example.com/cb" },
      cfg,
    );
    expect(result.published).toBe(true);
    expect(result.messageId).toBe("msg-1");
  });

  it("returns published=false on HTTP error", async () => {
    vi.stubGlobal("fetch", makeFetch([{ ok: false, status: 429, body: {} }]));
    const cfg = QStashConfigSchema.parse({ token: "t", signingKey: "sk" });
    const result = await publishAsyncTask(
      { type: "astdoc_generation", agentId: "a1", payload: {}, callbackUrl: "https://example.com/cb" },
      cfg,
    );
    expect(result.published).toBe(false);
  });

  it("resolveQStashConfig returns null when env vars absent", () => {
    expect(resolveQStashConfig({})).toBeNull();
  });

  it("schema rejects extra property (.strict)", () => {
    expect(() => QStashConfigSchema.parse({ token: "t", signingKey: "sk", extra: 1 })).toThrow();
  });
});

// ── Integration 5: GitHub Actions Flaky Tests ────────────────────────────────

import {
  buildFlakyTestIndex,
  matchFlakyTests,
  loadFlakyTestIndex,
  GitHubActionsFlakyConfigSchema,
} from "../../src/services/integrations/github-actions-flaky.js";
import type { RedisState } from "../../src/services/redis-state.js";

function makeRedis(stored: string | null): RedisState {
  return {
    get: async () => stored,
    set: async () => {},
  } as unknown as RedisState;
}

describe("github-actions-flaky", () => {
  it("matchFlakyTests returns only entries whose files overlap target list", () => {
    const index = [
      { testName: "src/login.test.ts", failureCount: 5, associatedFiles: ["src/login.ts"], lastFailedAt: "2026-01-01" },
      { testName: "src/other.test.ts", failureCount: 3, associatedFiles: ["src/other.ts"], lastFailedAt: "2026-01-01" },
    ];
    const matched = matchFlakyTests(["src/login.ts"], index);
    expect(matched).toHaveLength(1);
    expect(matched[0].testName).toBe("src/login.test.ts");
  });

  it("loadFlakyTestIndex returns empty array when Redis key absent", async () => {
    const result = await loadFlakyTestIndex(makeRedis(null));
    expect(result).toEqual([]);
  });

  it("loadFlakyTestIndex returns empty array when stored value is corrupt JSON", async () => {
    const result = await loadFlakyTestIndex(makeRedis("{broken"));
    expect(result).toEqual([]);
  });

  it("schema rejects extra property (.strict)", () => {
    expect(() => GitHubActionsFlakyConfigSchema.parse({ token: "t", owner: "o", repo: "r", extra: 1 })).toThrow();
  });
});

// ── Integration 6: Git Blame Risk ────────────────────────────────────────────

import {
  computeGitBlameRisk,
  totalRiskBonus,
  GitBlameRiskConfigSchema,
} from "../../src/services/integrations/git-blame-risk.js";

const FAKE_COMMITS = [
  { commit: { author: { date: "2026-06-01", email: "a@x.com" } }, author: { login: "alice" } },
  { commit: { author: { date: "2026-06-15", email: "b@x.com" } }, author: { login: "bob" } },
  { commit: { author: { date: "2026-07-01", email: "a@x.com" } }, author: { login: "alice" } },
];

describe("git-blame-risk — computeGitBlameRisk", () => {
  it("computes risk bonus from churn and author count", async () => {
    vi.stubGlobal("fetch", makeFetch([{ ok: true, body: FAKE_COMMITS }]));
    const cfg = GitBlameRiskConfigSchema.parse({ token: "t", owner: "o", repo: "r" });
    const results = await computeGitBlameRisk(["src/login.ts"], cfg);
    expect(results).toHaveLength(1);
    // 3 commits * 0.5 + 2 authors * 2 = 1.5 + 4 = 5.5
    expect(results[0].riskBonus).toBeCloseTo(5.5);
  });

  it("returns zero bonus on HTTP error", async () => {
    vi.stubGlobal("fetch", makeFetch([{ ok: false, status: 404, body: {} }]));
    const cfg = GitBlameRiskConfigSchema.parse({ token: "t", owner: "o", repo: "r" });
    const results = await computeGitBlameRisk(["src/login.ts"], cfg);
    expect(results[0].riskBonus).toBe(0);
  });

  it("totalRiskBonus sums all file bonuses", () => {
    const bonuses = [
      { file: "a.ts", churn: 2, authorCount: 1, riskBonus: 3 },
      { file: "b.ts", churn: 4, authorCount: 2, riskBonus: 6 },
    ];
    expect(totalRiskBonus(bonuses)).toBe(9);
  });

  it("schema rejects extra property (.strict)", () => {
    expect(() => GitBlameRiskConfigSchema.parse({ token: "t", owner: "o", repo: "r", extra: 1 })).toThrow();
  });
});

// ── Integration 7: Ticket Enrichment ─────────────────────────────────────────

import {
  enrichObjectiveFromTicket,
  resolveTicketConfig,
  TicketEnrichmentConfigSchema,
} from "../../src/services/integrations/ticket-enrichment.js";

describe("ticket-enrichment — enrichObjectiveFromTicket", () => {
  it("enriches objective when a Linear ticket is found", async () => {
    vi.stubGlobal("fetch", makeFetch([{
      ok: true,
      body: { data: { issue: { identifier: "LIN-42", title: "Fix auth flow", description: "User cannot log in with SSO", url: "https://linear.app/t/LIN-42" } } },
    }]));
    const cfg = TicketEnrichmentConfigSchema.parse({ provider: "linear", linearApiKey: "lin_api_key" });
    const result = await enrichObjectiveFromTicket("implement LIN-42", cfg);
    expect(result).toContain("Fix auth flow");
    expect(result).toContain("LIN-42");
  });

  it("returns original objective when no ticket ID found", async () => {
    const cfg = TicketEnrichmentConfigSchema.parse({ provider: "linear", linearApiKey: "k" });
    const result = await enrichObjectiveFromTicket("add dark mode", cfg);
    expect(result).toBe("add dark mode");
  });

  it("resolveTicketConfig returns null when no env vars present", () => {
    expect(resolveTicketConfig({})).toBeNull();
  });

  it("resolveTicketConfig picks linear when LINEAR_API_KEY set", () => {
    const cfg = resolveTicketConfig({ LINEAR_API_KEY: "k" });
    expect(cfg?.provider).toBe("linear");
  });

  it("schema rejects jira provider without jiraBaseUrl", () => {
    expect(() => TicketEnrichmentConfigSchema.parse({ provider: "jira", jiraToken: "t" })).toThrow();
  });
});

// ── Integration 8: Codecov Intelligence ─────────────────────────────────────

import {
  getFileCoverage,
  formatCoverageHint,
  resolveCodecovConfig,
  CodecovConfigSchema,
} from "../../src/services/integrations/codecov-intelligence.js";

describe("codecov-intelligence — getFileCoverage", () => {
  it("flags files below the threshold as lowCoverage", async () => {
    vi.stubGlobal("fetch", makeFetch([{
      ok: true,
      body: { results: [{ name: "src/auth.ts", totals: { coverage: 30 } }] },
    }]));
    const cfg = CodecovConfigSchema.parse({ token: "t", owner: "o", repo: "r" });
    const results = await getFileCoverage(["src/auth.ts"], cfg);
    expect(results[0].lowCoverage).toBe(true);
    expect(results[0].coverage).toBe(30);
  });

  it("does not flag files above the threshold", async () => {
    vi.stubGlobal("fetch", makeFetch([{
      ok: true,
      body: { results: [{ name: "src/auth.ts", totals: { coverage: 80 } }] },
    }]));
    const cfg = CodecovConfigSchema.parse({ token: "t", owner: "o", repo: "r" });
    const results = await getFileCoverage(["src/auth.ts"], cfg);
    expect(results[0].lowCoverage).toBe(false);
  });

  it("returns empty array on HTTP error", async () => {
    vi.stubGlobal("fetch", makeFetch([{ ok: false, status: 401, body: {} }]));
    const cfg = CodecovConfigSchema.parse({ token: "t", owner: "o", repo: "r" });
    expect(await getFileCoverage(["src/auth.ts"], cfg)).toEqual([]);
  });

  it("formatCoverageHint returns empty string when no low-coverage files", () => {
    expect(formatCoverageHint([{ file: "a.ts", coverage: 90, lowCoverage: false }])).toBe("");
  });

  it("formatCoverageHint includes file name and coverage %", () => {
    const hint = formatCoverageHint([{ file: "src/auth.ts", coverage: 30, lowCoverage: true }]);
    expect(hint).toContain("src/auth.ts");
    expect(hint).toContain("30.0%");
  });

  it("resolveCodecovConfig returns null when CODECOV_TOKEN absent", () => {
    expect(resolveCodecovConfig("o", "r", {})).toBeNull();
  });

  it("schema rejects extra property (.strict)", () => {
    expect(() => CodecovConfigSchema.parse({ token: "t", owner: "o", repo: "r", extra: 1 })).toThrow();
  });
});

// ── Pass-19 regression suite ─────────────────────────────────────────────────

describe("github-actions-flaky — Pass-19 regression: deriveSourceFile", () => {
  it("matchFlakyTests matches target source files, not raw test file paths", () => {
    const index = [
      {
        testName: "src/services/foo.test.ts",
        failureCount: 5,
        associatedFiles: ["src/services/foo.ts"],
        lastFailedAt: new Date().toISOString(),
      },
    ];
    const matches = matchFlakyTests(["src/services/foo.ts"], index);
    expect(matches).toHaveLength(1);
    expect(matches[0].testName).toBe("src/services/foo.test.ts");
  });

  it("matchFlakyTests returns empty when no overlap", () => {
    const index = [
      {
        testName: "src/auth.test.ts",
        failureCount: 4,
        associatedFiles: ["src/auth.ts"],
        lastFailedAt: new Date().toISOString(),
      },
    ];
    expect(matchFlakyTests(["src/payment.ts"], index)).toHaveLength(0);
  });

  it("loadFlakyTestIndex returns [] on empty Redis", async () => {
    const mockState = {
      get: vi.fn(async () => null),
    } as unknown as import("../../src/services/redis-state.js").RedisState;
    expect(await loadFlakyTestIndex(mockState)).toEqual([]);
  });

  it("buildFlakyTestIndex returns [] in privacy mode", async () => {
    process.env.QODO_PRIVACY_MODE = "strict";
    const cfg = GitHubActionsFlakyConfigSchema.parse({ token: "t", owner: "o", repo: "r" });
    const mockState = { set: vi.fn(), setWithTTL: vi.fn(), get: vi.fn(async () => null) } as unknown as import("../../src/services/redis-state.js").RedisState;
    const result = await buildFlakyTestIndex(cfg, mockState);
    expect(result).toEqual([]);
    delete process.env.QODO_PRIVACY_MODE;
  });

  it("buildFlakyTestIndex handles empty workflow_runs", async () => {
    vi.stubGlobal("fetch", makeFetch([{ ok: true, body: { workflow_runs: [] } }]));
    const cfg = GitHubActionsFlakyConfigSchema.parse({ token: "t", owner: "o", repo: "r" });
    const mockState = { set: vi.fn(), setWithTTL: vi.fn(), get: vi.fn(async () => null) } as unknown as import("../../src/services/redis-state.js").RedisState;
    const result = await buildFlakyTestIndex(cfg, mockState);
    expect(result).toEqual([]);
  });

  it("schema rejects missing token", () => {
    expect(() => GitHubActionsFlakyConfigSchema.parse({ owner: "o", repo: "r" })).toThrow();
  });
});

describe("qstash-async — Pass-19 regression: publishAsyncTask", () => {
  it("returns published:true on success", async () => {
    vi.stubGlobal("fetch", makeFetch([{ ok: true, body: { messageId: "msg-1" } }]));
    const cfg = QStashConfigSchema.parse({ token: "t", signingKey: "sk" });
    const result = await publishAsyncTask(
      { type: "sre_feedback", agentId: "run-1", payload: {}, callbackUrl: "https://example.com/cb" },
      cfg,
    );
    expect(result.published).toBe(true);
    expect(result.messageId).toBe("msg-1");
  });

  it("returns published:false when QStash returns non-ok", async () => {
    vi.stubGlobal("fetch", makeFetch([{ ok: false, status: 503, body: {} }]));
    const cfg = QStashConfigSchema.parse({ token: "t", signingKey: "sk" });
    const result = await publishAsyncTask(
      { type: "astdoc_generation", agentId: "run-1", payload: {}, callbackUrl: "https://example.com/cb" },
      cfg,
    );
    expect(result.published).toBe(false);
  });

  it("returns published:false in privacy mode", async () => {
    process.env.QODO_PRIVACY_MODE = "strict";
    const cfg = QStashConfigSchema.parse({ token: "t", signingKey: "sk" });
    const result = await publishAsyncTask(
      { type: "compliance_scan", agentId: "run-1", payload: {}, callbackUrl: "https://example.com/cb" },
      cfg,
    );
    expect(result.published).toBe(false);
    delete process.env.QODO_PRIVACY_MODE;
  });

  it("resolveQStashConfig returns null when env vars absent", () => {
    expect(resolveQStashConfig({})).toBeNull();
  });

  it("resolveQStashConfig returns config when both vars present", () => {
    const cfg = resolveQStashConfig({ QSTASH_TOKEN: "t", QSTASH_CURRENT_SIGNING_KEY: "sk" });
    expect(cfg).not.toBeNull();
    expect(cfg?.token).toBe("t");
  });

  it("schema rejects extra property (.strict)", () => {
    expect(() => QStashConfigSchema.parse({ token: "t", signingKey: "sk", extra: 1 })).toThrow();
  });
});

// ── Pass-20: H1 — Quota Guardian ─────────────────────────────────────────────

import {
  recordQuotaFromHeaders,
  markProviderExhausted,
  loadQuotaSnapshot,
  hasHeadroom,
  filterByHeadroom,
  type QuotaProvider,
} from "../../src/services/quota-guardian.js";

function makeRedisStore(initial: Record<string, string> = {}): import("../../src/services/redis-state.js").RedisState {
  const store: Record<string, string> = { ...initial };
  return {
    get:  async (k: string) => store[k] ?? null,
    set:  async (k: string, v: string) => { store[k] = v; },
    setWithTTL: async (k: string, v: string) => { store[k] = v; },
    getJSON: async (k: string) => { const r = store[k]; return r ? JSON.parse(r) : null; },
    setJSON: async (k: string, v: unknown) => { store[k] = JSON.stringify(v); },
    setJSONWithTTL: async (k: string, v: unknown) => { store[k] = JSON.stringify(v); },
  } as unknown as import("../../src/services/redis-state.js").RedisState;
}

describe("quota-guardian — recordQuotaFromHeaders", () => {
  it("stores a snapshot when headers contain remaining counts", async () => {
    const state = makeRedisStore();
    const headers = { "x-ratelimit-remaining-requests": "900", "x-ratelimit-remaining-tokens": "5000", "x-ratelimit-reset-requests": "60" };
    await recordQuotaFromHeaders("groq", headers as unknown as Headers, state);
    const snap = await loadQuotaSnapshot("groq", state);
    expect(snap).not.toBeNull();
    expect(snap?.requestsRemaining).toBe(900);
    expect(snap?.tokensRemaining).toBe(5000);
  });

  it("hasHeadroom returns true when snapshot is null (unknown = assume available)", () => {
    expect(hasHeadroom(null)).toBe(true);
  });

  it("hasHeadroom returns false when requestsRemaining is 0", () => {
    expect(hasHeadroom({
      provider: "groq",
      requestsRemaining: 0,
      tokensRemaining: 100,
      resetAt: null,
      recordedAt: new Date().toISOString(),
    })).toBe(false);
  });

  it("markProviderExhausted sets requests and tokens to 0", async () => {
    const state = makeRedisStore();
    await markProviderExhausted("gemini", 60, state);
    const snap = await loadQuotaSnapshot("gemini", state);
    expect(snap?.requestsRemaining).toBe(0);
    expect(snap?.tokensRemaining).toBe(0);
  });

  it("filterByHeadroom removes exhausted providers", async () => {
    const state = makeRedisStore();
    await markProviderExhausted("mistral", 60, state);
    const available = await filterByHeadroom(["groq", "mistral", "cerebras"], state);
    // groq and cerebras have no snapshot (unknown = headroom), mistral is exhausted
    expect(available).not.toContain("mistral");
    expect(available).toContain("groq");
  });

  it("filterByHeadroom returns all providers when all are exhausted (safety fallback)", async () => {
    const state = makeRedisStore();
    const providers: QuotaProvider[] = ["groq", "gemini"];
    for (const p of providers) await markProviderExhausted(p, 60, state);
    const result = await filterByHeadroom(providers, state);
    expect(result).toEqual(providers);
  });
});

// ── Pass-20: I2 — Mission Priority ───────────────────────────────────────────

import {
  scoreMission,
  enqueueMission,
  dequeueMission,
  peekQueue,
  classifyObjectiveComplexity,
  type MissionMeta,
} from "../../src/services/mission-priority.js";

function makeMission(overrides: Partial<MissionMeta> = {}): MissionMeta {
  return {
    id: "owner/repo#1",
    objective: "add dark mode",
    complexity: "cosmetic",
    urgency: "none",
    impact: "none",
    enqueuedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("mission-priority — scoreMission", () => {
  it("security objective scores higher than cosmetic", () => {
    const secScore  = scoreMission(makeMission({ complexity: "security",  urgency: "critical", impact: "critical" }));
    const cosScore  = scoreMission(makeMission({ complexity: "cosmetic",  urgency: "none",     impact: "none"     }));
    expect(secScore).toBeGreaterThan(cosScore);
  });

  it("critical urgency multiplies score", () => {
    const low  = scoreMission(makeMission({ complexity: "medium", urgency: "low",      impact: "low"     }));
    const high = scoreMission(makeMission({ complexity: "medium", urgency: "critical", impact: "critical" }));
    expect(high).toBeGreaterThan(low);
  });

  it("enqueue + dequeue returns highest-scored mission first", async () => {
    const state = makeRedisStore();
    await enqueueMission(makeMission({ id: "r#1", complexity: "cosmetic",  urgency: "none",     impact: "none"     }), state);
    await enqueueMission(makeMission({ id: "r#2", complexity: "security",  urgency: "critical", impact: "critical" }), state);
    await enqueueMission(makeMission({ id: "r#3", complexity: "medium",    urgency: "medium",   impact: "medium"   }), state);
    const top = await dequeueMission(state);
    expect(top?.id).toBe("r#2");
  });

  it("dequeueMission returns null on empty queue", async () => {
    const state = makeRedisStore();
    expect(await dequeueMission(state)).toBeNull();
  });

  it("peekQueue does not remove items", async () => {
    const state = makeRedisStore();
    await enqueueMission(makeMission({ id: "r#1" }), state);
    await peekQueue(state);
    expect(await dequeueMission(state)).not.toBeNull();
  });

  it("classifyObjectiveComplexity — security keywords", () => {
    expect(classifyObjectiveComplexity("fix CVE-2024-1234 in auth service")).toBe("security");
  });

  it("classifyObjectiveComplexity — cosmetic keywords", () => {
    expect(classifyObjectiveComplexity("fix typo in README")).toBe("cosmetic");
  });

  it("classifyObjectiveComplexity — architecture keywords", () => {
    expect(classifyObjectiveComplexity("refactor database schema migration")).toBe("architecture");
  });
});

// ── Pass-20: I1 — Supervisor ─────────────────────────────────────────────────

import { supervisorDecide } from "../../src/agents/supervisor.js";

describe("supervisor — supervisorDecide", () => {
  it("routes security objective to mentor variant", () => {
    const d = supervisorDecide({ objective: "patch CVE-2025-9999 in oauth handler" });
    expect(d.variant).toBe("mentor");
    expect(d.forceMentorMode).toBe(true);
    expect(d.skipHeavyValidators).toBe(false);
  });

  it("routes cosmetic objective to fast variant", () => {
    const d = supervisorDecide({ objective: "fix typo in comments" });
    expect(d.variant).toBe("fast");
    expect(d.skipHeavyValidators).toBe(true);
    expect(d.coderTierOverride).toBe("fast");
  });

  it("routes high-urgency medium objective to full variant", () => {
    const d = supervisorDecide({ objective: "update user profile component", urgency: "critical" });
    expect(d.variant).toBe("full");
  });

  it("respects mentorModeEnabled flag for non-security objectives", () => {
    const d = supervisorDecide({ objective: "add pagination to list view", mentorModeEnabled: true });
    expect(d.forceMentorMode).toBe(true);
  });

  it("architecture objective forces mentor regardless of urgency/impact", () => {
    const d = supervisorDecide({ objective: "refactor entire database schema", urgency: "none", impact: "none" });
    expect(d.variant).toBe("mentor");
  });
});

// ── Pass-20: J4 — Rationale Bank ─────────────────────────────────────────────

import { recordRationale, loadRunRationale } from "../../src/services/rationale-bank.js";

describe("rationale-bank — recordRationale / loadRunRationale", () => {
  it("stores and retrieves a rationale entry", async () => {
    const state = makeRedisStore();
    await recordRationale(
      { runId: "run-1", owner: "o", repo: "r", agent: "supervisor", decisionPoint: "routing", reasoning: "high risk file" },
      state,
    );
    const entries = await loadRunRationale("o", "r", "run-1", state);
    expect(entries).toHaveLength(1);
    expect(entries[0].reasoning).toBe("high risk file");
    expect(entries[0].agent).toBe("supervisor");
  });

  it("loadRunRationale returns empty array when nothing recorded", async () => {
    const state = makeRedisStore();
    expect(await loadRunRationale("o", "r", "run-x", state)).toEqual([]);
  });

  it("multiple entries are all retrievable for same run", async () => {
    const state = makeRedisStore();
    await recordRationale({ runId: "r1", owner: "o", repo: "r", agent: "architect",  decisionPoint: "approach",  reasoning: "chose minimal diff" }, state);
    await recordRationale({ runId: "r1", owner: "o", repo: "r", agent: "coder",      decisionPoint: "escalation", reasoning: "heavy tier needed" }, state);
    const entries = await loadRunRationale("o", "r", "r1", state);
    expect(entries).toHaveLength(2);
  });
});

// ── Pass-20: C1 — D1 Run History ─────────────────────────────────────────────

import { saveRunRecord, queryHistory, computeLatencyPercentiles, type RunRecord } from "../../src/services/d1-history.js";

function makeRunRecord(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    id: "o/r/run-1",
    runId: "run-1",
    owner: "o",
    repo: "r",
    objective: "fix bug",
    complexity: "medium",
    outcome: "success",
    durationMs: 10_000,
    coderRetries: 0,
    wardenRejections: 0,
    gateConfidence: 80,
    targetFiles: ["src/auth.ts"],
    recordedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("d1-history — saveRunRecord / queryHistory", () => {
  it("saves and retrieves a run record", async () => {
    const state = makeRedisStore();
    await saveRunRecord(makeRunRecord(), state);
    const results = await queryHistory("o", "r", { limit: 10 }, state);
    expect(results).toHaveLength(1);
    expect(results[0].runId).toBe("run-1");
  });

  it("queryHistory filters by outcome", async () => {
    const state = makeRedisStore();
    await saveRunRecord(makeRunRecord({ id: "o/r/run-1", runId: "run-1", outcome: "success" }), state);
    await saveRunRecord(makeRunRecord({ id: "o/r/run-2", runId: "run-2", outcome: "failure" }), state);
    const failures = await queryHistory("o", "r", { outcome: "failure" }, state);
    expect(failures).toHaveLength(1);
    expect(failures[0].outcome).toBe("failure");
  });

  it("queryHistory filters by minCoderRetries", async () => {
    const state = makeRedisStore();
    await saveRunRecord(makeRunRecord({ id: "o/r/run-1", runId: "run-1", coderRetries: 1 }), state);
    await saveRunRecord(makeRunRecord({ id: "o/r/run-2", runId: "run-2", coderRetries: 4 }), state);
    const highRetry = await queryHistory("o", "r", { minCoderRetries: 2 }, state);
    expect(highRetry).toHaveLength(1);
    expect(highRetry[0].coderRetries).toBe(4);
  });

  it("returns empty array when no records exist", async () => {
    const state = makeRedisStore();
    expect(await queryHistory("o", "r", {}, state)).toEqual([]);
  });

  it("computeLatencyPercentiles returns null with fewer than 5 records", async () => {
    const state = makeRedisStore();
    for (let i = 0; i < 3; i++) {
      await saveRunRecord(makeRunRecord({ id: `o/r/run-${i}`, runId: `run-${i}`, durationMs: 5000 * (i + 1) }), state);
    }
    expect(await computeLatencyPercentiles("o", "r", 10, state)).toBeNull();
  });
});

// ── Pass-20: D2 — Dependency Graph ───────────────────────────────────────────

import { getFanOut, getHighFanOutPackages, type DependencyGraph } from "../../src/services/dependency-graph.js";

describe("dependency-graph — getFanOut / getHighFanOutPackages", () => {
  const graph: DependencyGraph = {
    builtAt: new Date().toISOString(),
    packageCount: 3,
    nodes: {
      "express":  { name: "express",  version: "4.18.0", dev: false, dependencies: ["qs", "body-parser"], dependents: ["app", "test-utils", "middleware", "router", "proxy", "auth"] },
      "qs":       { name: "qs",       version: "6.11.0", dev: false, dependencies: [],                   dependents: ["express"] },
      "lodash":   { name: "lodash",   version: "4.17.21",dev: false, dependencies: [],                   dependents: ["utils"] },
    },
  };

  it("getFanOut returns correct dependent count", () => {
    expect(getFanOut(graph, "express")).toBe(6);
    expect(getFanOut(graph, "lodash")).toBe(1);
    expect(getFanOut(graph, "nonexistent")).toBe(0);
  });

  it("getHighFanOutPackages returns packages above threshold", () => {
    const high = getHighFanOutPackages(graph, 5);
    expect(high).toHaveLength(1);
    expect(high[0].name).toBe("express");
  });

  it("getHighFanOutPackages returns empty when threshold is not met", () => {
    expect(getHighFanOutPackages(graph, 10)).toHaveLength(0);
  });
});

// ── Pass-20: Bridge 1 — Blame × Sentry context formatting ────────────────────

import { formatBridgeContext, type BlameSentryResult } from "../../src/services/integrations/blame-sentry-bridge.js";

describe("blame-sentry-bridge — formatBridgeContext", () => {
  it("returns empty string when no enriched context", () => {
    const result: BlameSentryResult = { hasEnrichedContext: false, contexts: [] };
    expect(formatBridgeContext(result)).toBe("");
  });

  it("includes file name in output when context is present", () => {
    const result: BlameSentryResult = {
      hasEnrichedContext: true,
      contexts: [{
        file: "src/auth.ts",
        sentryIssues: ["TypeError in auth.ts"],
        authorCount: 2,
        churn: 5,
        promptFragment: "### File: `src/auth.ts`\n**Open Sentry errors:** TypeError in auth.ts",
      }],
    };
    const out = formatBridgeContext(result);
    expect(out).toContain("src/auth.ts");
    expect(out).toContain("BLAME-SENTRY CONTEXT");
  });
});

