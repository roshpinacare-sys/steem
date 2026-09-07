/**
 * env-validator.test.ts — Unit tests for Zod-powered env validation.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { validateAndCoerce, _resetEnvCache } from "../src/services/env-validator.js";

const BASE_ENV = {
  GITHUB_TOKEN:             "ghp_test_token_1234567890",
  GROQ_API_KEY:             "gsk_test_key_1234567890",
  UPSTASH_REDIS_REST_URL:   "https://redis.upstash.io",
  UPSTASH_REDIS_REST_TOKEN: "AZtest_token_1234567890",
  REPO:                     "owner/repo",
  OBJECTIVE:                "fix the bug",
};

describe("validateAndCoerce", () => {
  let savedEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    savedEnv = { ...process.env };
    _resetEnvCache();
    // Clear all qodo-related env vars
    Object.keys(BASE_ENV).forEach((k) => delete process.env[k]);
  });

  afterEach(() => {
    Object.assign(process.env, savedEnv);
    _resetEnvCache();
  });

  it("passes with all required env vars set", () => {
    Object.assign(process.env, BASE_ENV);
    const env = validateAndCoerce();
    expect(env.GITHUB_TOKEN).toBe(BASE_ENV.GITHUB_TOKEN);
    expect(env.REPO).toBe("owner/repo");
  });

  it("throws on missing required vars", () => {
    expect(() => validateAndCoerce()).toThrow(/missing required secrets|validation failed/i);
  });

  it("throws when REPO is not owner/repo format", () => {
    Object.assign(process.env, { ...BASE_ENV, REPO: "invalid-no-slash" });
    expect(() => validateAndCoerce()).toThrow();
  });

  it("defaults QODO_HIVE_SHARE to off", () => {
    Object.assign(process.env, BASE_ENV);
    const env = validateAndCoerce();
    expect(env.QODO_HIVE_SHARE).toBe("off");
  });

  it("coerces QODO_HIVE_SHARE to off when QODO_PRIVACY_MODE=strict", () => {
    Object.assign(process.env, {
      ...BASE_ENV,
      QODO_PRIVACY_MODE: "strict",
      QODO_HIVE_SHARE:   "public",
    });
    const env = validateAndCoerce();
    expect(env.QODO_HIVE_SHARE).toBe("off");
  });

  it("caches result on repeated calls", () => {
    Object.assign(process.env, BASE_ENV);
    const a = validateAndCoerce();
    const b = validateAndCoerce();
    expect(a).toBe(b);
  });

  it("rejects a short GROQ_API_KEY (Bug 14-B regression — min(10) must be enforced)", () => {
    Object.assign(process.env, { ...BASE_ENV, GROQ_API_KEY: "short" });
    expect(() => validateAndCoerce()).toThrow();
  });

  it("accepts a GROQ_API_KEY of exactly 10 chars", () => {
    Object.assign(process.env, { ...BASE_ENV, GROQ_API_KEY: "0123456789" });
    const env = validateAndCoerce();
    expect(env.GROQ_API_KEY).toBe("0123456789");
  });

  it("throws when no LLM provider key is configured", () => {
    const envWithout = { ...BASE_ENV };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (envWithout as any).GROQ_API_KEY;
    Object.assign(process.env, envWithout);
    // All LLM keys are absent → validation must fail fast.
    expect(() => validateAndCoerce()).toThrow(/No LLM API key found/i);
  });
});
