/**
 * quota-guardian.ts — H1: Per-provider free-tier quota tracker.
 *
 * Reads remaining rate-limit capacity from response headers (or explicit
 * updates) and stores it in Redis with a short TTL so the AI router can
 * pick the provider with headroom before dispatching, converting mid-pipeline
 * 429s into a scheduling decision made upfront.
 *
 * Supported providers: groq, openrouter, gemini, cerebras, mistral, cf-workers-ai,
 * together, sambanova, huggingface, fireworks, deepinfra, novita, cf-workers-ai-rest
 *
 * DESIGN INVARIANTS
 * - All mutations are best-effort: failures never throw or block the caller.
 * - Redis TTL matches the provider's reset window so stale data auto-expires.
 * - Privacy mode has no relevance here (no external API call).
 * - Returns conservative defaults (headroom=0) when data is absent so the
 *   router treats an untracked provider as exhausted rather than unlimited.
 */

import type { RedisState } from "./redis-state.js";
import type { Telemetry } from "./telemetry.js";
import { log } from "./logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type QuotaProvider =
  | "groq"
  | "openrouter"
  | "gemini"
  | "cerebras"
  | "mistral"
  | "cf-workers-ai"
  | "together"
  | "sambanova"
  | "huggingface"
  // A3: Additional free-tier racing providers
  | "fireworks"
  | "deepinfra"
  | "novita"
  | "cf-workers-ai-rest";

export interface QuotaSnapshot {
  provider: QuotaProvider;
  /** Requests remaining in the current window (null = unknown). */
  requestsRemaining: number | null;
  /** task-47: the window's total request cap, when the provider reports it
   *  (absent/null = provider doesn't send a limit header, or none seen yet).
   *  Needed to turn "remaining" into a percentage — a bare remaining count
   *  says nothing about how close to exhaustion that actually is. Optional
   *  so every pre-existing QuotaSnapshot literal (tests, stored snapshots
   *  written before this field existed) still satisfies the type. */
  requestsLimit?: number | null;
  /** Tokens remaining in the current window (null = unknown). */
  tokensRemaining: number | null;
  /** task-47: same idea as requestsLimit, for the token bucket. Optional
   *  for the same backward-compatibility reason. */
  tokensLimit?: number | null;
  /** Unix-seconds when the window resets. */
  resetAt: number | null;
  /** ISO timestamp of the last snapshot write. */
  recordedAt: string;
}

// Header names vary by provider; map them to a canonical shape.
// requests/tokens = REMAINING-count headers (pre-existing). requestsLimit/
// tokensLimit (task-47) = the window's total cap, only filled in where a
// provider is confirmed to send a distinct limit header — left undefined
// elsewhere rather than guessed, so percentUsed stays null (honest "don't
// know") instead of silently wrong for providers we haven't verified.
const HEADER_MAP: Record<QuotaProvider, {
  requests?: string; requestsLimit?: string;
  tokens?: string; tokensLimit?: string;
  reset?: string;
}> = {
  // Groq's remaining/limit header pair is documented and stable — see
  // console.groq.com/docs/rate-limits (x-ratelimit-limit-requests /
  // x-ratelimit-remaining-requests / x-ratelimit-limit-tokens /
  // x-ratelimit-remaining-tokens). Verified 2026-07.
  groq: {
    requests: "x-ratelimit-remaining-requests", requestsLimit: "x-ratelimit-limit-requests",
    tokens: "x-ratelimit-remaining-tokens", tokensLimit: "x-ratelimit-limit-tokens",
    reset: "x-ratelimit-reset-requests",
  },
  // FIX (task-47): `requests` previously read "x-ratelimit-limit-requests"
  // — the LIMIT header — straight into the REMAINING slot, the only entry
  // in this table that did that. Since a limit doesn't count down, this
  // made OpenRouter look like it always had full headroom even when
  // actually near/at exhaustion — hasHeadroom()/rankByHeadroom() would
  // never have caught it. Corrected to the remaining-count header, matching
  // every other provider's convention in this table, and the limit is now
  // captured separately in `requestsLimit` where it belongs.
  openrouter: {
    requests: "x-ratelimit-remaining-requests", requestsLimit: "x-ratelimit-limit-requests",
    tokens: "x-ratelimit-remaining-tokens",
    reset: "x-ratelimit-reset",
  },
  gemini:          { requests: "x-ratelimit-remaining-requests", tokens: "x-ratelimit-remaining-tokens",     reset: "x-ratelimit-reset" },
  cerebras:        { requests: "x-ratelimit-remaining-requests", tokens: "x-ratelimit-remaining-tokens",     reset: "x-ratelimit-reset-tokens" },
  mistral:         { requests: "x-ratelimit-remaining-requests", tokens: "x-ratelimit-remaining-tokens",     reset: "x-ratelimit-reset" },
  "cf-workers-ai": {},
  together:        { requests: "x-ratelimit-remaining",          tokens: undefined,                          reset: "x-ratelimit-reset" },
  sambanova:          { requests: "x-ratelimit-remaining-requests", tokens: "x-ratelimit-remaining-tokens", reset: "x-ratelimit-reset" },
  huggingface:        {},
  // A3: Additional free-tier racing providers
  fireworks:          { requests: "x-ratelimit-remaining-requests", tokens: "x-ratelimit-remaining-tokens", reset: "x-ratelimit-reset" },
  deepinfra:          { requests: "x-ratelimit-remaining-requests", tokens: "x-ratelimit-remaining-tokens", reset: "x-ratelimit-reset" },
  novita:             { requests: "x-ratelimit-remaining-requests", tokens: "x-ratelimit-remaining-tokens", reset: "x-ratelimit-reset" },
  "cf-workers-ai-rest": {},
};

/** Default reset window (seconds) used when the header is absent. */
const DEFAULT_RESET_WINDOW_S: Record<QuotaProvider, number> = {
  groq:            60,
  openrouter:      60,
  gemini:          60,
  cerebras:        60,
  mistral:         60,
  "cf-workers-ai": 60,
  together:        60,
  sambanova:          60,
  huggingface:        60,
  // A3: Additional free-tier racing providers
  fireworks:          60,
  deepinfra:          60,
  novita:             60,
  "cf-workers-ai-rest": 1440, // CF Workers AI REST: daily allotment; reset window 24h
};

function redisKey(provider: QuotaProvider): string {
  return `qodo:v24:quota:${provider}`;
}

function parsePossiblyRelativeReset(value: string | null): number | null {
  if (!value) return null;
  const n = Number(value);
  if (!isNaN(n)) {
    // If small, treat as seconds-from-now; otherwise as unix timestamp
    return n < 100_000 ? Math.floor(Date.now() / 1000) + n : n;
  }
  // ISO date string
  const d = Date.parse(value);
  return isNaN(d) ? null : Math.floor(d / 1000);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Record quota information extracted from a provider's response headers.
 * Call this immediately after every successful or 429-failed API response.
 */
export async function recordQuotaFromHeaders(
  provider: QuotaProvider,
  headers: Headers | Record<string, string | null>,
  state: RedisState,
  telemetry?: Telemetry,
): Promise<void> {
  try {
    const map = HEADER_MAP[provider];
    const get = (name: string | undefined): string | null => {
      if (!name) return null;
      return typeof (headers as Headers).get === "function"
        ? (headers as Headers).get(name)
        : ((headers as Record<string, string | null>)[name] ?? null);
    };

    // NB: never use `|| null` here — a legitimate '0' header (quota
    // exhausted) is falsy and would be silently discarded as null.
    const parseRemaining = (name: string | undefined): number | null => {
      const raw = get(name);
      if (raw === null || raw === "") return null;
      const n = Number(raw);
      return Number.isNaN(n) ? null : n;
    };
    const requestsRemaining = parseRemaining(map.requests);
    const requestsLimit     = parseRemaining(map.requestsLimit);
    const tokensRemaining   = parseRemaining(map.tokens);
    const tokensLimit       = parseRemaining(map.tokensLimit);
    const resetAt = parsePossiblyRelativeReset(get(map.reset ?? undefined));
    const now               = new Date().toISOString();

    const snapshot: QuotaSnapshot = {
      provider,
      requestsRemaining,
      requestsLimit,
      tokensRemaining,
      tokensLimit,
      resetAt,
      recordedAt: now,
    };

    const ttlS = resetAt
      ? Math.max(10, resetAt - Math.floor(Date.now() / 1000) + 5)
      : DEFAULT_RESET_WINDOW_S[provider];

    await state.setWithTTL(redisKey(provider), JSON.stringify(snapshot), ttlS);
    await telemetry?.decision("quota-guardian", "snapshot-recorded", {
      provider,
      requestsRemaining: snapshot.requestsRemaining,
      tokensRemaining:   snapshot.tokensRemaining,
    });
  } catch (e: unknown) {
    // Best-effort: never throw
    log.warn("quota-guardian: failed to record snapshot", {
      provider,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

/**
 * Explicitly mark a provider as exhausted (e.g. after receiving a 429).
 * Sets requests/tokens remaining to 0 and keeps the entry until the
 * default reset window expires.
 */
export async function markProviderExhausted(
  provider: QuotaProvider,
  resetInSeconds: number | null,
  state: RedisState,
  telemetry?: Telemetry,
): Promise<void> {
  try {
    const ttlS = resetInSeconds ?? DEFAULT_RESET_WINDOW_S[provider];
    const snapshot: QuotaSnapshot = {
      provider,
      requestsRemaining: 0,
      requestsLimit: null,
      tokensRemaining:   0,
      tokensLimit: null,
      resetAt: Math.floor(Date.now() / 1000) + ttlS,
      recordedAt: new Date().toISOString(),
    };
    await state.setWithTTL(redisKey(provider), JSON.stringify(snapshot), ttlS);
    await telemetry?.decision("quota-guardian", "provider-exhausted", { provider, resetInSeconds: ttlS });
    log.warn("quota-guardian: provider marked exhausted", { provider, resetInSeconds: ttlS });
  } catch {
    // Best-effort
  }
}

/**
 * Load the current quota snapshot for a provider.
 * Returns null when no snapshot is available (unknown state).
 */
export async function loadQuotaSnapshot(
  provider: QuotaProvider,
  state: RedisState,
): Promise<QuotaSnapshot | null> {
  try {
    const raw = await state.get(redisKey(provider));
    if (!raw) return null;
    return JSON.parse(raw) as QuotaSnapshot;
  } catch {
    return null;
  }
}

/**
 * Returns true when the provider has known headroom (requests AND tokens > 0,
 * or the snapshot is simply absent — absence means "not yet tracked").
 * Returns false only when we *know* a provider is at 0.
 */
export function hasHeadroom(snapshot: QuotaSnapshot | null): boolean {
  if (!snapshot) return true; // unknown = assume available
  const rOk = snapshot.requestsRemaining === null || snapshot.requestsRemaining > 0;
  const tOk = snapshot.tokensRemaining   === null || snapshot.tokensRemaining   > 0;
  return rOk && tOk;
}

/**
 * Given a list of candidate providers, return them filtered to those
 * with known headroom, preserving original order.  If none have headroom,
 * returns the full list (fallback: let the provider reject with a 429 itself).
 */
export async function filterByHeadroom(
  providers: QuotaProvider[],
  state: RedisState,
  telemetry?: Telemetry,
): Promise<QuotaProvider[]> {
  const snapshots = await Promise.all(providers.map((p) => loadQuotaSnapshot(p, state)));
  const available = providers.filter((_, i) => hasHeadroom(snapshots[i]));

  await telemetry?.decision("quota-guardian", "filter-result", {
    candidates: providers,
    available,
    exhausted: providers.filter((p) => !available.includes(p)),
  });

  return available.length > 0 ? available : providers;
}

/**
 * Rank a list of candidate providers by headroom, best first.
 * Providers with more remaining requests are sorted to the front.
 * Unknown providers (no snapshot) receive a mid-range optimistic score so
 * they are tried, but not prioritised over a provider with confirmed room.
 * Falls back to original order when all scores are identical.
 */
export async function rankByHeadroom(
  providers: QuotaProvider[],
  state: RedisState,
  telemetry?: Telemetry,
): Promise<QuotaProvider[]> {
  const snapshots = await Promise.all(providers.map((p) => loadQuotaSnapshot(p, state)));

  const scored = providers.map((provider, i) => {
    const snap = snapshots[i];
    const score =
      snap === null                         ? 500   // never seen — assume mid-range
      : snap.requestsRemaining === null     ? 500   // no header data — neutral
      : snap.requestsRemaining;
    return { provider, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const ranked = scored.map((s) => s.provider);

  await telemetry?.decision("quota-guardian", "ranked-by-headroom", {
    original: providers,
    ranked,
  });

  return ranked;
}

/**
 * task-47: turn a raw remaining/limit snapshot into a percentage, the form
 * an alert threshold or a dashboard gauge actually wants.
 *
 * A remaining count of exactly 0 is unambiguous (100% used) even when we
 * never saw a limit header for this provider — treated as a special case
 * rather than falling through to "unknown", since `markProviderExhausted`
 * legitimately has no limit to report but still knows the provider is spent.
 * Otherwise requires both a known remaining count AND a known limit; returns
 * null (not 0, not a guess) when either is missing — an untracked provider
 * should read as "no data", not as "0% used".
 */
export function quotaPercentUsed(snapshot: QuotaSnapshot | null): number | null {
  if (!snapshot) return null;
  if (snapshot.requestsRemaining === 0) return 100;
  if (snapshot.requestsLimit == null || snapshot.requestsLimit <= 0) return null;
  if (snapshot.requestsRemaining == null) return null;
  const pct = (1 - snapshot.requestsRemaining / snapshot.requestsLimit) * 100;
  return Math.max(0, Math.min(100, Math.round(pct)));
}

/**
 * task-47: "about to exhaust quota before reset" — the literal alert this
 * task asked for. Null percentUsed (no limit data) never counts as near
 * exhaustion; silence here means "we don't know", not "it's fine".
 */
export function isNearExhaustion(snapshot: QuotaSnapshot | null, thresholdPercent = 90): boolean {
  const pct = quotaPercentUsed(snapshot);
  return pct !== null && pct >= thresholdPercent;
}

export interface QuotaHealthEntry {
  provider: QuotaProvider;
  percentUsed: number | null;
  nearExhaustion: boolean;
  resetAt: number | null;
}

/**
 * task-47: the per-provider quota-gauge view the ledger/preflight layer
 * needs "alongside the existing USD figures" — built on top of the
 * snapshots quota-guardian already tracks live from response headers,
 * rather than a second, separately-maintained EnergyQuotaState duplicating
 * the same data with its own (necessarily stale) hardcoded limits.
 */
export async function getQuotaHealthReport(
  providers: QuotaProvider[],
  state: RedisState,
  thresholdPercent = 90,
): Promise<QuotaHealthEntry[]> {
  const snapshots = await Promise.all(providers.map((p) => loadQuotaSnapshot(p, state)));
  return providers.map((provider, i) => {
    const snap = snapshots[i];
    return {
      provider,
      percentUsed: quotaPercentUsed(snap),
      nearExhaustion: isNearExhaustion(snap, thresholdPercent),
      resetAt: snap?.resetAt ?? null,
    };
  });
}

/**
 * Stricter headroom check for planning ahead of a batched phase (e.g. before
 * fanning out several architect calls onto a single provider).
 *
 * @param assumedLimit  The known or assumed maximum requests-per-window for
 *                      this provider.  Used to compute the remaining fraction.
 * @param threshold     Fraction below which the provider is considered "low".
 *                      Defaults to 0.1 (10 %).
 */
export async function hasComfortableHeadroom(
  provider: QuotaProvider,
  assumedLimit: number,
  state: RedisState,
  threshold = 0.1,
): Promise<boolean> {
  const snap = await loadQuotaSnapshot(provider, state);
  if (!snap || snap.requestsRemaining === null) return true; // unknown = optimistic
  if (assumedLimit <= 0) return snap.requestsRemaining > 0;
  return snap.requestsRemaining / assumedLimit > threshold;
}
