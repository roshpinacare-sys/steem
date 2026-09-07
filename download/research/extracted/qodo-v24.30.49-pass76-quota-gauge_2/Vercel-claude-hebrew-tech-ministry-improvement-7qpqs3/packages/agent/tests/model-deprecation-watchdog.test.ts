/**
 * model-deprecation-watchdog.test.ts — Pass 34 regression suite
 *
 * Tests the watchdog using a fetch mock so no real network calls are made.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { checkModelDeprecations, _resetWatchdogCache } from "../src/services/model-deprecation-watchdog.js";

// Minimal Env stub — only the fields the watchdog reads.
function makeEnv(overrides: Record<string, string> = {}): Parameters<typeof checkModelDeprecations>[0] {
  return {
    GITHUB_TOKEN:    "ghp_test",
    GROQ_API_KEY:    overrides.GROQ_API_KEY    ?? "groq_test_key",
    CEREBRAS_API_KEY:overrides.CEREBRAS_API_KEY ?? "",
    MISTRAL_API_KEY: overrides.MISTRAL_API_KEY  ?? "",
    ...overrides,
  } as Parameters<typeof checkModelDeprecations>[0];
}

afterEach(() => {
  _resetWatchdogCache();
  vi.restoreAllMocks();
});

describe("checkModelDeprecations", () => {
  it("does not throw when all configured models are present", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { id: "openai/gpt-oss-20b" },
          { id: "openai/gpt-oss-120b" },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(checkModelDeprecations(makeEnv())).resolves.toBeUndefined();
  });

  it("resolves (does not throw) when a model is missing from the catalogue", async () => {
    // Only returns the heavy model — fast model is absent (simulates deprecation).
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: "openai/gpt-oss-120b" }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    // Should still resolve, never throw — watchdog is advisory, not blocking.
    await expect(checkModelDeprecations(makeEnv())).resolves.toBeUndefined();
  });

  it("skips provider gracefully when the list endpoint returns non-200", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 403 });
    vi.stubGlobal("fetch", fetchMock);

    await expect(checkModelDeprecations(makeEnv())).resolves.toBeUndefined();
  });

  it("skips provider gracefully when fetch throws (network error)", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network timeout"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(checkModelDeprecations(makeEnv())).resolves.toBeUndefined();
  });

  it("skips a provider silently when no API key is configured for it", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    // GROQ_API_KEY empty → Groq provider skipped; no fetch expected for it.
    await checkModelDeprecations(makeEnv({ GROQ_API_KEY: "" }));
    // fetch may still be called for cerebras/mistral if keys configured,
    // but must not be called for groq (no key).
    const groqCalls = fetchMock.mock.calls.filter(
      ([url]: unknown[]) => typeof url === "string" && url.includes("groq.com"),
    );
    expect(groqCalls).toHaveLength(0);
  });

  it("caches model-list per provider across multiple calls", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: "openai/gpt-oss-20b" }, { id: "openai/gpt-oss-120b" }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const env = makeEnv();
    await checkModelDeprecations(env);
    await checkModelDeprecations(env); // second call — should hit cache, not re-fetch

    const groqFetches = fetchMock.mock.calls.filter(
      ([url]: unknown[]) => typeof url === "string" && url.includes("groq.com"),
    );
    // Cache should have prevented a second fetch for Groq.
    expect(groqFetches.length).toBe(1);
  });
});
