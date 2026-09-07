/**
 * model-deprecation-watchdog-soft.test.ts — Task-23 (Pass 61)
 *
 * ADVERSARIAL AUDIT: Soft-deprecation detection in model-deprecation-watchdog.ts
 *
 * ─── Background ─────────────────────────────────────────────────────────────
 * `model-deprecation-watchdog.ts` was introduced in Pass 34 to detect the
 * hard-absence failure mode that caused all Groq calls to fail silently on
 * 2026-06-17 when both configured model names were deprecated without warning.
 * It queries each provider's model-list endpoint and emits a structured
 * "model-deprecation-warning" log if any router model is absent from the
 * provider's live catalogue.
 *
 * The watchdog currently catches hard absence: a model ID completely missing
 * from the catalogue. Task-23 audits the harder real-world failure mode:
 * "soft deprecation" — model still present in the catalogue, but deprecated,
 * sunset-dated, heavily rate-limited, or explicitly flagged as degraded.
 *
 * A model going through a graceful soft-deprecation cycle (announced → listed
 * with a sunset date → eventually removed) will never trigger the current
 * watchdog until the very last moment of hard removal. Operators therefore get
 * no advance warning of the impending production failure.
 *
 * ─── Methodology ────────────────────────────────────────────────────────────
 * All tests use mocked `fetch` responses shaped like real provider catalogues
 * that include soft-deprecation fields. No live network calls are made.
 * Warnings are captured via `subscribeToLogs` from the shared logger.
 * `_resetWatchdogCache()` is called in afterEach to prevent state leakage.
 *
 * ─── Findings summary ────────────────────────────────────────────────────────
 *
 * A. Hard-absence detection (baseline — correctly catches)
 *    A1. Model absent → "model-deprecation-warning" IS emitted        → RESISTANT
 *    A2. All models present → no warning                               → RESISTANT
 *    A3. Partial absence → warns only for missing model               → RESISTANT
 *    A4. _resetWatchdogCache unblocks re-fetch after cache warms      → RESISTANT
 *
 * B. Soft-deprecation via boolean/status fields (silently ignored)
 *    B1. { id, deprecated: true } → NOT warned                        → GAP-1 (Medium)
 *    B2. { id, status: "deprecated" } → NOT warned                    → GAP-2 (Medium)
 *    B3. { id, deprecation_notice: "…" } → NOT warned                 → GAP-3 (Medium)
 *    B4. deprecated + status together → NOT warned                    → GAP-1+2 combined
 *    B5. all models deprecated → none warned                          → GAP-1 at scale
 *
 * C. Temporal soft-deprecation via sunset / deprecation-at dates (silently ignored)
 *    C1. { id, deprecated_at: <past date> } → NOT warned              → GAP-4 (Medium)
 *    C2. { id, sunset_date: <future 30 days> } → NOT warned           → GAP-4 (Medium)
 *    C3. { id, sunset_date: <tomorrow> } → NOT warned (24 h warning!) → GAP-4 (Medium)
 *    C4. { id, sunset_date: <past> } but model still listed → NOT warned → GAP-4
 *
 * D. Rate-limiting / degradation signals (silently ignored)
 *    D1. { id, rate_limited: true } → NOT warned                      → GAP-5 (Low)
 *    D2. { id, max_requests_per_minute: 1 } → NOT warned              → GAP-5 (Low)
 *
 * E. Gemini: authHeader always returns null — provider always skipped  → GAP-6 (High)
 *    E1. GEMINI_API_KEY set, model absent → NOT warned (skipped)       → GAP-6
 *    E2. GEMINI_API_KEY set, model present → fetch never called        → GAP-6
 *    E3. GEMINI_API_KEY unset, behaviour same (both null)              → GAP-6
 *    E4. No GEMINI fetch calls are made regardless of key/model state  → GAP-6
 *
 * F. Gemini-specific: supportedGenerationMethods signals (silently ignored)
 *    F1. { name, supportedGenerationMethods: [] } (no methods = can't generate)
 *        → model in catalogue → NOT warned                             → GAP-7 (Medium)
 *    F2. { name, deprecationDate: <future> } → NOT warned             → GAP-7 (Medium)
 *
 * G. Full-sweep: all soft-deprecation signals across all non-Gemini providers
 *    G1. Groq, Cerebras, Mistral all return soft-deprecated catalogues → zero warnings
 *
 * ─── Design Boundaries Documented ───────────────────────────────────────────
 *
 * DB-1 (Hard-absence is the only detection axis)
 *   The watchdog's `extractIds` functions return `string[]` of model IDs only.
 *   All other catalogue fields — deprecated, status, sunset_date, rate_limited,
 *   supportedGenerationMethods — are discarded at extraction time. The Set-based
 *   `has()` check is therefore equivalent to "is the ID string present?", nothing
 *   more. Soft-deprecation detection requires extending `extractIds` to return
 *   `{id, deprecated?, sunsetDate?}` objects and updating the check loop.
 *
 * DB-2 (Gemini monitoring is dead code)
 *   `PROVIDERS.gemini.authHeader` always returns `null`, regardless of whether
 *   `GEMINI_API_KEY` is set. `fetchModelIds` interprets a null auth header as
 *   "provider not configured" and silently skips it. The Gemini provider entry
 *   exists in `PROVIDERS` but is never evaluated. No Gemini deprecation can be
 *   detected until this is fixed.
 *
 * DB-3 (Cache inherits soft-deprecation blindness)
 *   The in-process cache stores `Set<string>` of IDs. Once a soft-deprecated
 *   model's ID is cached as "present," all subsequent calls within the same
 *   process will return the same Set without re-fetching. The soft-deprecation
 *   gap persists for the entire process lifetime.
 *
 * ─── Recommended Fixes ───────────────────────────────────────────────────────
 *
 * GAP-1/2/3 fix: Extend OpenAI-compatible `extractIds` to return
 *   `{ id: string, deprecated?: boolean, status?: string, deprecationNotice?: string }[]`,
 *   then check each field in `checkModelDeprecations` and emit a "soft-deprecation-warning"
 *   log distinct from the hard-absence "model-deprecation-warning".
 *
 * GAP-4 fix: Parse `deprecated_at` and `sunset_date` fields; emit a warning
 *   when `sunsetDate - now < 30 days` so operators have an advance notice window.
 *
 * GAP-5 fix: Add `rate_limited` detection to the extraction chain, or consider
 *   making a lightweight test call when a model is found but rate-limited.
 *
 * GAP-6 fix (High): Fix `authHeader` for Gemini to return
 *   `env.GEMINI_API_KEY ?? null` (a non-null truthy string when the key is
 *   present), then pass the key as a query parameter by modifying `fetchModelIds`
 *   to append `?key=<auth>` for providers that use query-param auth instead of
 *   `Authorization: Bearer`.
 *
 * GAP-7 fix: Extend the Gemini `extractIds` to also inspect
 *   `supportedGenerationMethods` and `deprecationDate`; flag models with empty
 *   methods or a past/near-future deprecation date.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  checkModelDeprecations,
  _resetWatchdogCache,
} from "../src/services/model-deprecation-watchdog.js";
import { subscribeToLogs } from "../src/services/logger.js";
import type { LogRecord } from "../src/services/logger.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Minimal Env stub — mirrors the existing watchdog test helper. */
function makeEnv(
  overrides: Record<string, string> = {},
): Parameters<typeof checkModelDeprecations>[0] {
  return {
    GITHUB_TOKEN:     "ghp_test",
    GROQ_API_KEY:     "groq_test_key",
    CEREBRAS_API_KEY: "cerebras_test_key",
    MISTRAL_API_KEY:  "mistral_test_key",
    GEMINI_API_KEY:   "gemini_test_key",
    ...overrides,
  } as Parameters<typeof checkModelDeprecations>[0];
}

/** Collects all "warn"-level log records emitted during a block. */
function captureWarnings(): { records: LogRecord[]; unsub: () => void } {
  const records: LogRecord[] = [];
  const unsub = subscribeToLogs((r) => {
    if (r.level === "warn") records.push(r);
  });
  return { records, unsub };
}

/** Returns the model-deprecation-warning records from a captured set. */
function deprecationWarnings(records: LogRecord[]): LogRecord[] {
  return records.filter((r) => r.msg === "model-deprecation-warning");
}

/** A valid OpenAI-compatible catalogue containing both Groq router models. */
const groqFullCatalogue = {
  data: [
    { id: "openai/gpt-oss-20b" },
    { id: "openai/gpt-oss-120b" },
  ],
};

/** OpenAI-compatible response factory — wraps IDs into `{ data: [{id}] }`. */
function openAiResponse(ids: string[]): { data: Array<{ id: string }> } {
  return { data: ids.map((id) => ({ id })) };
}

/** Stub fetch to return a JSON body for every call. */
function stubFetch(body: unknown, ok = true): ReturnType<typeof vi.fn> {
  const mock = vi.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

afterEach(() => {
  _resetWatchdogCache();
  vi.restoreAllMocks();
});

// ─── A: Hard-absence detection (baseline) ───────────────────────────────────

describe("A: Hard-absence detection (baseline — existing behavior)", () => {
  it("A1: model absent from catalogue → 'model-deprecation-warning' IS emitted", async () => {
    // Only fast model listed — heavy model (120b) is absent.
    stubFetch({ data: [{ id: "openai/gpt-oss-20b" }] });
    const { records, unsub } = captureWarnings();
    await checkModelDeprecations(makeEnv({ CEREBRAS_API_KEY: "", MISTRAL_API_KEY: "", GEMINI_API_KEY: "" }));
    unsub();
    const warns = deprecationWarnings(records);
    expect(warns.length).toBeGreaterThanOrEqual(1);
    expect(warns[0].modelId).toBe("openai/gpt-oss-120b");
    expect(warns[0].provider).toBe("groq");
  });

  it("A2: all models present → no deprecation warnings emitted", async () => {
    stubFetch(groqFullCatalogue);
    const { records, unsub } = captureWarnings();
    await checkModelDeprecations(makeEnv({ CEREBRAS_API_KEY: "", MISTRAL_API_KEY: "", GEMINI_API_KEY: "" }));
    unsub();
    expect(deprecationWarnings(records)).toHaveLength(0);
  });

  it("A3: partial absence → warns for missing model only, not present model", async () => {
    // Only heavy model listed; fast model absent.
    stubFetch({ data: [{ id: "openai/gpt-oss-120b" }] });
    const { records, unsub } = captureWarnings();
    await checkModelDeprecations(makeEnv({ CEREBRAS_API_KEY: "", MISTRAL_API_KEY: "", GEMINI_API_KEY: "" }));
    unsub();
    const warns = deprecationWarnings(records);
    const warnedIds = warns.map((w) => w.modelId as string);
    expect(warnedIds).toContain("openai/gpt-oss-20b");
    expect(warnedIds).not.toContain("openai/gpt-oss-120b");
  });

  it("A4: _resetWatchdogCache unblocks re-detection after cache warms", async () => {
    // First call: both present → cached.
    stubFetch(groqFullCatalogue);
    const env = makeEnv({ CEREBRAS_API_KEY: "", MISTRAL_API_KEY: "", GEMINI_API_KEY: "" });
    await checkModelDeprecations(env);

    // Reset cache, then return an empty catalogue.
    _resetWatchdogCache();
    stubFetch({ data: [] });
    const { records, unsub } = captureWarnings();
    await checkModelDeprecations(env);
    unsub();
    // Both models now absent — two warnings expected.
    expect(deprecationWarnings(records).length).toBeGreaterThanOrEqual(2);
  });
});

// ─── B: Soft-deprecation via boolean/status fields ──────────────────────────

describe("B: Soft-deprecation via boolean/status fields (GAP-1, GAP-2, GAP-3)", () => {
  /**
   * GAP-1 (Medium) — `deprecated: true` field in OpenAI-compatible catalogue entry
   *
   * The watchdog's `openAiExtract` function maps `data` to `m.id` strings only.
   * The `deprecated` boolean is discarded. A model entering its deprecation cycle
   * (still listed but flagged) will produce no warning — operators get no advance notice.
   *
   * Recommended fix: Extend `openAiExtract` to return `{id, deprecated?}` objects;
   * emit a distinct "model-soft-deprecation-warning" in `checkModelDeprecations`.
   */
  it("B1: { id, deprecated: true } → model present in Set → no deprecation-warning emitted (GAP-1)", async () => {
    stubFetch({
      data: [
        { id: "openai/gpt-oss-20b",  deprecated: true  },
        { id: "openai/gpt-oss-120b", deprecated: false },
      ],
    });
    const { records, unsub } = captureWarnings();
    await checkModelDeprecations(makeEnv({ CEREBRAS_API_KEY: "", MISTRAL_API_KEY: "", GEMINI_API_KEY: "" }));
    unsub();
    // Both models are in the catalogue despite deprecated:true — watchdog sees no absence.
    expect(deprecationWarnings(records)).toHaveLength(0);
  });

  /**
   * GAP-2 (Medium) — `status: "deprecated"` field silently ignored.
   * Some providers (Mistral, custom) use a status string rather than a boolean flag.
   */
  it("B2: { id, status: 'deprecated' } → model present in Set → no warning (GAP-2)", async () => {
    stubFetch({
      data: [
        { id: "openai/gpt-oss-20b",  status: "deprecated" },
        { id: "openai/gpt-oss-120b", status: "active"     },
      ],
    });
    const { records, unsub } = captureWarnings();
    await checkModelDeprecations(makeEnv({ CEREBRAS_API_KEY: "", MISTRAL_API_KEY: "", GEMINI_API_KEY: "" }));
    unsub();
    expect(deprecationWarnings(records)).toHaveLength(0);
  });

  /**
   * GAP-3 (Medium) — `deprecation_notice` string field silently ignored.
   * OpenAI's own model list has included human-readable deprecation notices in model objects.
   */
  it("B3: { id, deprecation_notice: '...' } → no warning (GAP-3)", async () => {
    stubFetch({
      data: [
        {
          id: "openai/gpt-oss-20b",
          deprecation_notice:
            "This model will be removed on 2026-09-01. Migrate to gpt-oss-40b.",
        },
        { id: "openai/gpt-oss-120b" },
      ],
    });
    const { records, unsub } = captureWarnings();
    await checkModelDeprecations(makeEnv({ CEREBRAS_API_KEY: "", MISTRAL_API_KEY: "", GEMINI_API_KEY: "" }));
    unsub();
    expect(deprecationWarnings(records)).toHaveLength(0);
  });

  it("B4: deprecated: true AND status: 'deprecated' combined → still no warning (GAP-1+GAP-2)", async () => {
    stubFetch({
      data: [
        { id: "openai/gpt-oss-20b",  deprecated: true, status: "deprecated" },
        { id: "openai/gpt-oss-120b", deprecated: true, status: "deprecated" },
      ],
    });
    const { records, unsub } = captureWarnings();
    await checkModelDeprecations(makeEnv({ CEREBRAS_API_KEY: "", MISTRAL_API_KEY: "", GEMINI_API_KEY: "" }));
    unsub();
    // Both models present in the Set despite both flags — zero warnings.
    expect(deprecationWarnings(records)).toHaveLength(0);
  });

  it("B5: all router models for all providers are deprecated → still no warnings (GAP-1 at scale)", async () => {
    // Groq, Cerebras, Mistral all return fully-deprecated catalogues.
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes("groq.com")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: [
              { id: "openai/gpt-oss-20b",  deprecated: true },
              { id: "openai/gpt-oss-120b", deprecated: true },
            ],
          }),
        });
      }
      if (url.includes("cerebras.ai")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: [
              { id: "llama3.1-8b",    deprecated: true },
              { id: "llama-3.3-70b",  deprecated: true },
            ],
          }),
        });
      }
      if (url.includes("mistral.ai")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: [
              { id: "mistral-small-latest", deprecated: true },
              { id: "mistral-large-latest", deprecated: true },
            ],
          }),
        });
      }
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { records, unsub } = captureWarnings();
    await checkModelDeprecations(makeEnv({ GEMINI_API_KEY: "" }));
    unsub();

    // Six models across three providers (2 Groq + 2 Cerebras + 2 Mistral), all deprecated — watchdog emits zero warnings.
    expect(deprecationWarnings(records)).toHaveLength(0);
  });
});

// ─── C: Temporal soft-deprecation via sunset / deprecated-at dates ───────────

describe("C: Temporal soft-deprecation via sunset / deprecated-at dates (GAP-4)", () => {
  /**
   * GAP-4 (Medium) — Temporal deprecation fields silently ignored.
   *
   * Real provider catalogues (especially OpenAI) publish `deprecated_at` (past date of
   * announcement) and `sunset_date` (future date of final removal). The watchdog could
   * emit an advance warning when `sunsetDate - now < 30 days`, giving operators a planned
   * migration window. Currently, these fields are stripped by `openAiExtract`.
   *
   * Recommended fix: Parse `deprecated_at` and `sunset_date` from the data array;
   * emit "model-sunset-warning" with days-remaining when inside the advance-notice window.
   */
  it("C1: { id, deprecated_at: <past date> } → model present → no warning (GAP-4)", async () => {
    stubFetch({
      data: [
        { id: "openai/gpt-oss-20b",  deprecated_at: "2026-06-01T00:00:00Z" },
        { id: "openai/gpt-oss-120b", deprecated_at: "2026-06-15T00:00:00Z" },
      ],
    });
    const { records, unsub } = captureWarnings();
    await checkModelDeprecations(makeEnv({ CEREBRAS_API_KEY: "", MISTRAL_API_KEY: "", GEMINI_API_KEY: "" }));
    unsub();
    expect(deprecationWarnings(records)).toHaveLength(0);
  });

  it("C2: { id, sunset_date: <30 days from now> } → no advance warning (GAP-4)", async () => {
    // sunset_date 30 days out — operator should get a migration window warning.
    const soonDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    stubFetch({
      data: [
        { id: "openai/gpt-oss-20b",  sunset_date: soonDate },
        { id: "openai/gpt-oss-120b" },
      ],
    });
    const { records, unsub } = captureWarnings();
    await checkModelDeprecations(makeEnv({ CEREBRAS_API_KEY: "", MISTRAL_API_KEY: "", GEMINI_API_KEY: "" }));
    unsub();
    // No hard-absence → no warning. Gap: sunset proximity check absent.
    expect(deprecationWarnings(records)).toHaveLength(0);
  });

  it("C3: { id, sunset_date: tomorrow } → no 24-hour-warning (GAP-4)", async () => {
    const tomorrowDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    stubFetch({
      data: [
        { id: "openai/gpt-oss-20b",  sunset_date: tomorrowDate },
        { id: "openai/gpt-oss-120b", sunset_date: tomorrowDate },
      ],
    });
    const { records, unsub } = captureWarnings();
    await checkModelDeprecations(makeEnv({ CEREBRAS_API_KEY: "", MISTRAL_API_KEY: "", GEMINI_API_KEY: "" }));
    unsub();
    // 24 hours from hard-removal — watchdog still silent.
    expect(deprecationWarnings(records)).toHaveLength(0);
  });

  it("C4: sunset_date is already past but model still listed → no warning (GAP-4)", async () => {
    // Model should have been removed but is still in the catalogue. No warning.
    stubFetch({
      data: [
        { id: "openai/gpt-oss-20b",  sunset_date: "2026-01-01T00:00:00Z" },
        { id: "openai/gpt-oss-120b" },
      ],
    });
    const { records, unsub } = captureWarnings();
    await checkModelDeprecations(makeEnv({ CEREBRAS_API_KEY: "", MISTRAL_API_KEY: "", GEMINI_API_KEY: "" }));
    unsub();
    expect(deprecationWarnings(records)).toHaveLength(0);
  });
});

// ─── D: Rate-limiting / degradation signals ──────────────────────────────────

describe("D: Rate-limiting / degradation signals (GAP-5)", () => {
  /**
   * GAP-5 (Low) — Rate-limiting and degradation fields silently ignored.
   *
   * Some providers expose `rate_limited: true` or heavily-reduced throughput
   * indicators on models being sunset. These are proxies for impending removal
   * and should trigger a soft warning. The watchdog currently ignores them.
   *
   * Recommended fix: Add `rate_limited` and `max_requests_per_minute` to the
   * extraction contract and emit a "model-degradation-warning" log for affected models.
   */
  it("D1: { id, rate_limited: true } → model present → no warning (GAP-5)", async () => {
    stubFetch({
      data: [
        { id: "openai/gpt-oss-20b",  rate_limited: true  },
        { id: "openai/gpt-oss-120b", rate_limited: false },
      ],
    });
    const { records, unsub } = captureWarnings();
    await checkModelDeprecations(makeEnv({ CEREBRAS_API_KEY: "", MISTRAL_API_KEY: "", GEMINI_API_KEY: "" }));
    unsub();
    expect(deprecationWarnings(records)).toHaveLength(0);
  });

  it("D2: { id, max_requests_per_minute: 1 } (severely throttled) → no warning (GAP-5)", async () => {
    stubFetch({
      data: [
        { id: "openai/gpt-oss-20b",  max_requests_per_minute: 1   },
        { id: "openai/gpt-oss-120b", max_requests_per_minute: 600 },
      ],
    });
    const { records, unsub } = captureWarnings();
    await checkModelDeprecations(makeEnv({ CEREBRAS_API_KEY: "", MISTRAL_API_KEY: "", GEMINI_API_KEY: "" }));
    unsub();
    expect(deprecationWarnings(records)).toHaveLength(0);
  });
});

// ─── E: Gemini — authHeader always returns null (GAP-6, High) ────────────────

describe("E: Gemini provider always skipped (GAP-6 — High)", () => {
  /**
   * GAP-6 (High) — Gemini `authHeader` always returns `null`.
   *
   * `PROVIDERS.gemini.authHeader` is defined as:
   *   `(env) => env.GEMINI_API_KEY ? null : null`
   *
   * This returns `null` in BOTH branches. `fetchModelIds` interprets a null
   * auth header as "provider not configured" and skips silently. The Gemini
   * entry in `PROVIDERS` is therefore dead code — it can never be evaluated.
   *
   * Consequence: the router model "gemini-1.5-flash-8b" can go hard-absent
   * from the Google catalogue and the watchdog will never emit a warning.
   * Every Gemini deprecation event is undetectable regardless of configuration.
   *
   * Recommended fix: Return `env.GEMINI_API_KEY ?? null` (truthy when set).
   * Then pass the key as a query parameter by extending `fetchModelIds` to
   * support a `queryAuth` mode for providers that use `?key=` rather than
   * `Authorization: Bearer`.
   */
  it("E1: GEMINI_API_KEY set + Gemini model absent → no warning (fetch never called for Gemini)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ models: [] }), // empty Gemini catalogue
    });
    vi.stubGlobal("fetch", fetchMock);

    const { records, unsub } = captureWarnings();
    await checkModelDeprecations(makeEnv({
      GROQ_API_KEY: "",
      CEREBRAS_API_KEY: "",
      MISTRAL_API_KEY: "",
      GEMINI_API_KEY: "real-gemini-key",
    }));
    unsub();

    // No providers have keys except Gemini — but Gemini is always skipped.
    const geminiCalls = fetchMock.mock.calls.filter(
      ([url]: unknown[]) => typeof url === "string" && url.includes("generativelanguage"),
    );
    expect(geminiCalls).toHaveLength(0); // fetch never called for Gemini
    expect(deprecationWarnings(records)).toHaveLength(0); // no warning emitted
  });

  it("E2: GEMINI_API_KEY set + model present → fetch still never called (GAP-6)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        models: [{ name: "models/gemini-1.5-flash-8b" }],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await checkModelDeprecations(makeEnv({
      GROQ_API_KEY: "",
      CEREBRAS_API_KEY: "",
      MISTRAL_API_KEY: "",
      GEMINI_API_KEY: "real-gemini-key",
    }));

    const geminiCalls = fetchMock.mock.calls.filter(
      ([url]: unknown[]) => typeof url === "string" && url.includes("generativelanguage"),
    );
    expect(geminiCalls).toHaveLength(0);
  });

  it("E3: GEMINI_API_KEY unset behaves identically to key-set (both paths return null)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ models: [] }) });
    vi.stubGlobal("fetch", fetchMock);

    // With key.
    await checkModelDeprecations(makeEnv({ GROQ_API_KEY: "", CEREBRAS_API_KEY: "", MISTRAL_API_KEY: "", GEMINI_API_KEY: "key" }));
    _resetWatchdogCache();
    // Without key.
    await checkModelDeprecations(makeEnv({ GROQ_API_KEY: "", CEREBRAS_API_KEY: "", MISTRAL_API_KEY: "", GEMINI_API_KEY: "" }));

    const geminiCalls = fetchMock.mock.calls.filter(
      ([url]: unknown[]) => typeof url === "string" && url.includes("generativelanguage"),
    );
    // Neither invocation triggered a Gemini fetch — both `null` paths lead to the same skip.
    expect(geminiCalls).toHaveLength(0);
  });

  it("E4: fetch call count for Gemini endpoint is always zero regardless of configuration", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ models: [{ name: "models/gemini-1.5-flash-8b" }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    // Run with all providers including Gemini fully configured.
    await checkModelDeprecations(makeEnv());
    _resetWatchdogCache();

    const geminiCalls = fetchMock.mock.calls.filter(
      ([url]: unknown[]) => typeof url === "string" && url.includes("generativelanguage"),
    );
    expect(geminiCalls).toHaveLength(0);
  });
});

// ─── F: Gemini-specific soft-deprecation signals ─────────────────────────────

describe("F: Gemini soft-deprecation via supportedGenerationMethods / deprecationDate (GAP-7)", () => {
  /**
   * GAP-7 (Medium) — Gemini soft-deprecation signals not inspected.
   *
   * NOTE: GAP-7 is contingent on GAP-6 being fixed first (Gemini must actually
   * be fetched before its response fields can be inspected). These tests document
   * the extraction-level gap that would persist even after the auth fix.
   *
   * Google's Gemini model list includes:
   *   - `supportedGenerationMethods: []` → model can no longer generate (deprecated in practice)
   *   - `deprecationDate: "2026-09-15"` → announced future removal date
   *
   * The `extractIds` for Gemini only reads `m.name` (stripping "models/" prefix).
   * All other fields including `supportedGenerationMethods` and `deprecationDate`
   * are discarded. Even with GAP-6 fixed, a Gemini model that can no longer generate
   * will still not trigger a warning.
   *
   * Recommended fix: After fixing GAP-6, extend Gemini `extractIds` to return
   * `{id, supportedGenerationMethods, deprecationDate}` and emit a warning when
   * `supportedGenerationMethods` is empty or `deprecationDate` is within 30 days.
   */

  // For these tests we bypass the Gemini auth gap by directly invoking the extraction
  // logic implicitly: the Gemini extractor is unreachable via checkModelDeprecations
  // until GAP-6 is fixed, so we document the extraction contract gap here by confirming
  // that the _mock_ fetch for Gemini is never called (re-asserting GAP-6) and noting
  // that the fields below would be silently dropped even if it were.

  it("F1: Gemini model with supportedGenerationMethods:[] — fetch never called (GAP-6 blocks, GAP-7 would also miss)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        models: [
          {
            name: "models/gemini-1.5-flash-8b",
            supportedGenerationMethods: [], // model can no longer generate
            description: "Deprecated; use gemini-2.0-flash.",
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { records, unsub } = captureWarnings();
    await checkModelDeprecations(makeEnv({ GROQ_API_KEY: "", CEREBRAS_API_KEY: "", MISTRAL_API_KEY: "" }));
    unsub();

    const geminiCalls = fetchMock.mock.calls.filter(
      ([url]: unknown[]) => typeof url === "string" && url.includes("generativelanguage"),
    );
    expect(geminiCalls).toHaveLength(0); // GAP-6 blocks entirely
    expect(deprecationWarnings(records)).toHaveLength(0); // and GAP-7 would too
  });

  it("F2: Gemini model with deprecationDate in the near future — fetch never called (GAP-6 blocks, GAP-7 would also miss)", async () => {
    const nearFuture = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10); // "YYYY-MM-DD"

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        models: [
          {
            name: "models/gemini-1.5-flash-8b",
            deprecationDate: nearFuture,
            supportedGenerationMethods: ["generateContent"],
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { records, unsub } = captureWarnings();
    await checkModelDeprecations(makeEnv({ GROQ_API_KEY: "", CEREBRAS_API_KEY: "", MISTRAL_API_KEY: "" }));
    unsub();

    expect(fetchMock.mock.calls.filter(
      ([url]: unknown[]) => typeof url === "string" && url.includes("generativelanguage"),
    )).toHaveLength(0);
    expect(deprecationWarnings(records)).toHaveLength(0);
  });
});

// ─── G: Full-sweep with all soft-deprecation signals ─────────────────────────

describe("G: Full-sweep — all non-Gemini providers returning soft-deprecated catalogues", () => {
  /**
   * DB-3 — Cache inherits soft-deprecation blindness.
   *
   * Once a soft-deprecated model's ID is stored in the in-process cache as
   * "present," all subsequent calls within the same process see the cached Set
   * and cannot detect the soft-deprecation. The gap persists for the entire
   * process lifetime without a cache reset.
   */
  it("G1: Groq, Cerebras, and Mistral all return fully-deprecated-flagged catalogues → zero warnings emitted", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes("groq.com")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: [
              { id: "openai/gpt-oss-20b",  deprecated: true, status: "deprecated",
                deprecation_notice: "Sunset 2026-09-01", sunset_date: "2026-09-01T00:00:00Z" },
              { id: "openai/gpt-oss-120b", deprecated: true, status: "deprecated",
                deprecation_notice: "Sunset 2026-09-01", sunset_date: "2026-09-01T00:00:00Z" },
            ],
          }),
        });
      }
      if (url.includes("cerebras.ai")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: [
              { id: "llama3.1-8b",   deprecated: true, rate_limited: true },
              { id: "llama-3.3-70b", deprecated: true, rate_limited: true },
            ],
          }),
        });
      }
      if (url.includes("mistral.ai")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: [
              { id: "mistral-small-latest", status: "deprecated",
                deprecated_at: "2026-06-01T00:00:00Z", sunset_date: "2026-10-01T00:00:00Z" },
              { id: "mistral-large-latest", status: "deprecated",
                deprecated_at: "2026-06-01T00:00:00Z", sunset_date: "2026-10-01T00:00:00Z" },
            ],
          }),
        });
      }
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { records, unsub } = captureWarnings();
    await checkModelDeprecations(makeEnv({ GEMINI_API_KEY: "" }));
    unsub();

    // All six non-Gemini models are in their respective catalogues (just flagged).
    // Watchdog emits zero model-deprecation-warning events.
    expect(deprecationWarnings(records)).toHaveLength(0);
  });

  it("G2: cache warm from soft-deprecated catalogue → subsequent call still sees no warnings (DB-3)", async () => {
    // Warm the cache with soft-deprecated models.
    stubFetch({
      data: [
        { id: "openai/gpt-oss-20b",  deprecated: true },
        { id: "openai/gpt-oss-120b", deprecated: true },
      ],
    });
    const env = makeEnv({ CEREBRAS_API_KEY: "", MISTRAL_API_KEY: "", GEMINI_API_KEY: "" });
    await checkModelDeprecations(env); // populates cache

    // Second call: no re-fetch (cache hit) — soft-deprecation blindness persists.
    const { records, unsub } = captureWarnings();
    await checkModelDeprecations(env);
    unsub();
    expect(deprecationWarnings(records)).toHaveLength(0);
  });

  it("G3: never-throws invariant holds across all soft-deprecation signal combinations", async () => {
    // Combinations of all identified soft-deprecation fields — watchdog must never throw.
    stubFetch({
      data: [
        {
          id: "openai/gpt-oss-20b",
          deprecated: true,
          status: "deprecated",
          deprecation_notice: "Migrate before 2026-09-01",
          deprecated_at: "2026-06-01T00:00:00Z",
          sunset_date: "2026-09-01T00:00:00Z",
          rate_limited: true,
          max_requests_per_minute: 1,
        },
        {
          id: "openai/gpt-oss-120b",
          deprecated: true,
          rate_limited: true,
          sunset_date: new Date(Date.now() + 60 * 60 * 1000).toISOString(), // 1 hour away
        },
      ],
    });
    await expect(
      checkModelDeprecations(makeEnv({ CEREBRAS_API_KEY: "", MISTRAL_API_KEY: "", GEMINI_API_KEY: "" })),
    ).resolves.toBeUndefined();
  });
});
