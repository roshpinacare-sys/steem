/**
 * launchdarkly.ts — Integration: LaunchDarkly Feature Flag Evaluation
 *
 * Evaluates a LaunchDarkly boolean feature flag using the server-side SDK
 * evaluation REST endpoint — no SDK package required.
 *
 * Endpoint: GET https://sdk.launchdarkly.com/sdk/eval/v1/users/{base64User}
 *           /flags/{flagKey}
 * Auth:     Authorization: {sdkKey}   (the SDK key, not the API/access key)
 *
 * The user context is a minimal JSON object `{ "key": userKey }` encoded as
 * URL-safe base64. For the canary use case the user key is the repo + commit
 * SHA so each canary decision is deterministic for the same change.
 *
 * Opt-in via LD_SDK_KEY env var.  When the key is absent or the API call
 * fails the function returns the supplied defaultValue — never blocks the
 * pipeline on an absent feature-flag service.
 *
 * Doc: https://docs.launchdarkly.com/sdk/features/evaluating
 */
import { log as logger } from '../logger.js';
import { fetchWithTimeout } from '../../utils/fetch-timeout.js';

const LD_EVAL_BASE = 'https://sdk.launchdarkly.com/sdk/eval/v1/users';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type FlagSource = 'launchdarkly' | 'default';

export interface FlagEvalResult {
  /** Evaluated flag value. */
  value: boolean;
  /** Raw LaunchDarkly variation index (0/1 for booleans). */
  variation?: number;
  /** Human-readable reason string from LD (e.g. "RULE_MATCH", "FALLTHROUGH"). */
  reason?: string;
  /** Whether the value came from a live LD evaluation or the local default. */
  source: FlagSource;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface LdSingleFlagResponse {
  value?: boolean;
  variation?: number;
  reason?: { kind?: string; ruleId?: string };
}

/**
 * Encode a minimal LaunchDarkly user context as URL-safe base64.
 * LD expects a JSON object with at minimum a `key` field.
 */
function encodeUserContext(userKey: string): string {
  const json = JSON.stringify({ key: userKey });
  return Buffer.from(json).toString('base64url');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Evaluate a LaunchDarkly boolean feature flag for a given user key.
 *
 * Returns `defaultValue` immediately when:
 *   - `LD_SDK_KEY` is not set (opt-in)
 *   - The LD API returns a non-OK status
 *   - A network error occurs
 *
 * This ensures the canary pipeline never blocks on an unavailable flag service.
 *
 * @param flagKey     The LaunchDarkly feature flag key (e.g. "canary-rollout-enabled")
 * @param userKey     A stable identifier for this evaluation context
 *                    (e.g. "owner/repo@sha" for canary decisions)
 * @param defaultValue Value to return when LD is not configured or unreachable
 * @param env         Environment variable source (defaults to process.env)
 */
export async function evaluateFlag(
  flagKey: string,
  userKey: string,
  defaultValue: boolean,
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): Promise<FlagEvalResult> {
  const sdkKey = env.LD_SDK_KEY;
  if (!sdkKey) {
    logger.debug('LD_SDK_KEY not set; skipping LaunchDarkly flag evaluation', { flagKey });
    return { value: defaultValue, source: 'default' };
  }

  const encodedUser = encodeUserContext(userKey);
  const url = `${LD_EVAL_BASE}/${encodedUser}/flags/${encodeURIComponent(flagKey)}`;

  try {
    const res = await fetchWithTimeout(
      url,
      { headers: { Authorization: sdkKey, Accept: 'application/json' } },
      10_000,
    );

    if (res.status === 404) {
      // Flag key not found in this environment — treat as default
      logger.warn('LaunchDarkly flag not found; using default value', { flagKey, default: defaultValue });
      return { value: defaultValue, source: 'default' };
    }

    if (!res.ok) {
      logger.warn('LaunchDarkly eval non-OK; using default value', { flagKey, status: res.status });
      return { value: defaultValue, source: 'default' };
    }

    const data = (await res.json()) as LdSingleFlagResponse;
    const value = typeof data.value === 'boolean' ? data.value : defaultValue;
    const reason = data.reason?.kind ?? undefined;

    logger.info('LaunchDarkly flag evaluated', { flagKey, value, variation: data.variation, reason });
    return { value, variation: data.variation, reason, source: 'launchdarkly' };
  } catch (err) {
    logger.warn('LaunchDarkly eval error; using default value', {
      flagKey,
      err: err instanceof Error ? err.message : String(err),
    });
    return { value: defaultValue, source: 'default' };
  }
}

/**
 * Convenience: evaluate whether a canary rollout should proceed for a given
 * repo/sha context.  Returns true (allow) by default when LD is not configured.
 *
 * Flag naming convention: `canary-{owner}-{repo}` or `canary-rollout-enabled`
 * (callers choose the key that matches their LD project setup).
 */
export async function isCanaryEnabled(
  flagKey: string,
  context: { owner: string; repo: string; sha: string },
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): Promise<FlagEvalResult> {
  const userKey = `${context.owner}/${context.repo}@${context.sha}`;
  // Default = true: absent LD config should not block the canary pipeline
  return evaluateFlag(flagKey, userKey, true, env);
}
