/**
 * launchdarkly-canary.test.ts — Pass 68 / task-39
 *
 * Tests for the LaunchDarkly feature-flag-gated canary rollout:
 *   F1 — evaluateFlag() in integrations/launchdarkly.ts
 *   F2 — isCanaryEnabled() in integrations/launchdarkly.ts
 *   R1 — routeTrafficWithFeatureFlag() in canary.ts
 *   DB — design-boundary invariants
 *
 * All external fetch calls are intercepted via vi.stubGlobal('fetch', ...).
 * No real network access occurs.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';

import { evaluateFlag, isCanaryEnabled } from '../src/services/integrations/launchdarkly.js';
import { routeTrafficWithFeatureFlag, routeTrafficToCanary, rollbackCanary } from '../src/services/canary.js';

// ── helpers ──────────────────────────────────────────────────────────────────

const VERCEL_ENV = {
  VERCEL_TOKEN: 'tok_test',
  VERCEL_EDGE_CONFIG_ID: 'ecfg_test',
};

const CTX = { owner: 'acme', repo: 'api', sha: 'abc1234' };

function ldOkResponse(value: boolean, variation = value ? 1 : 0, reasonKind = 'FALLTHROUGH') {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ value, variation, reason: { kind: reasonKind } }),
  }));
}

function vercelOkFetch() {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    text: async () => '{"url":"https://preview.vercel.app","id":"dpl_1"}',
  }));
}

function combinedFetch(ldValue: boolean) {
  return vi.fn(async (url: string) => {
    if (url.includes('launchdarkly')) {
      return { ok: true, status: 200, json: async () => ({ value: ldValue, variation: ldValue ? 1 : 0, reason: { kind: 'FALLTHROUGH' } }) };
    }
    // Vercel edge-config PATCH
    return { ok: true, status: 200, text: async () => '{}', json: async () => ({}) };
  });
}

// ── F1: evaluateFlag ──────────────────────────────────────────────────────

describe('F1 — evaluateFlag: absent LD_SDK_KEY returns default', () => {
  it('returns defaultValue=false and source=default when LD_SDK_KEY missing', async () => {
    const result = await evaluateFlag('my-flag', 'user-1', false, {});
    expect(result.value).toBe(false);
    expect(result.source).toBe('default');
    expect(result.variation).toBeUndefined();
  });

  it('returns defaultValue=true and source=default when LD_SDK_KEY missing', async () => {
    const result = await evaluateFlag('my-flag', 'user-1', true, {});
    expect(result.value).toBe(true);
    expect(result.source).toBe('default');
  });
});

describe('F1 — evaluateFlag: live LD evaluation', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns value=true from LD when flag is on', async () => {
    vi.stubGlobal('fetch', ldOkResponse(true, 1, 'RULE_MATCH'));
    const result = await evaluateFlag('canary-enabled', 'repo@sha', false, { LD_SDK_KEY: 'sdk-key' });
    expect(result.value).toBe(true);
    expect(result.variation).toBe(1);
    expect(result.reason).toBe('RULE_MATCH');
    expect(result.source).toBe('launchdarkly');
  });

  it('returns value=false from LD when flag is off', async () => {
    vi.stubGlobal('fetch', ldOkResponse(false, 0, 'FALLTHROUGH'));
    const result = await evaluateFlag('canary-enabled', 'repo@sha', true, { LD_SDK_KEY: 'sdk-key' });
    expect(result.value).toBe(false);
    expect(result.source).toBe('launchdarkly');
  });

  it('falls back to defaultValue when LD returns 404 (flag not found)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })));
    const result = await evaluateFlag('nonexistent-flag', 'user', true, { LD_SDK_KEY: 'sdk-key' });
    expect(result.value).toBe(true);
    expect(result.source).toBe('default');
  });

  it('falls back to defaultValue when LD returns 401 (bad SDK key)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })));
    const result = await evaluateFlag('canary-flag', 'user', false, { LD_SDK_KEY: 'bad-key' });
    expect(result.value).toBe(false);
    expect(result.source).toBe('default');
  });

  it('falls back to defaultValue on network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    const result = await evaluateFlag('canary-flag', 'user', true, { LD_SDK_KEY: 'sdk-key' });
    expect(result.value).toBe(true);  // defaultValue=true → fail-open
    expect(result.source).toBe('default');
  });

  it('constructs correct URL with flag key and user context', async () => {
    let capturedUrl: string | undefined;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      capturedUrl = url;
      return { ok: true, status: 200, json: async () => ({ value: true, variation: 1, reason: { kind: 'FALLTHROUGH' } }) };
    }));

    await evaluateFlag('my-feature', 'acme-user', false, { LD_SDK_KEY: 'sdk-test' });

    expect(capturedUrl).toContain('sdk.launchdarkly.com');
    expect(capturedUrl).toContain('my-feature');
    // User key should be base64url-encoded JSON
    const urlParts = capturedUrl!.split('/');
    const encodedUser = urlParts[urlParts.indexOf('users') + 1];
    const decoded = Buffer.from(encodedUser, 'base64url').toString('utf8');
    expect(JSON.parse(decoded)).toEqual({ key: 'acme-user' });
  });

  it('sends Authorization header with SDK key', async () => {
    let capturedHeaders: HeadersInit | undefined;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      capturedHeaders = init?.headers;
      return { ok: true, status: 200, json: async () => ({ value: true, variation: 1, reason: { kind: 'FALLTHROUGH' } }) };
    }));

    await evaluateFlag('flag-key', 'user', false, { LD_SDK_KEY: 'sdk-my-key' });

    const headers = capturedHeaders as Record<string, string>;
    expect(headers['Authorization'] ?? headers['authorization']).toBe('sdk-my-key');
  });
});

// ── F2: isCanaryEnabled ───────────────────────────────────────────────────

describe('F2 — isCanaryEnabled: convenience wrapper', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns enabled=true (default) when LD_SDK_KEY absent', async () => {
    const result = await isCanaryEnabled('canary-rollout', CTX, {});
    expect(result.value).toBe(true);
    expect(result.source).toBe('default');
  });

  it('encodes owner/repo@sha as the user key', async () => {
    let capturedUrl: string | undefined;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      capturedUrl = url;
      return { ok: true, status: 200, json: async () => ({ value: true, variation: 1, reason: { kind: 'FALLTHROUGH' } }) };
    }));

    await isCanaryEnabled('canary-rollout', CTX, { LD_SDK_KEY: 'key' });

    const urlParts = capturedUrl!.split('/');
    const encodedUser = urlParts[urlParts.indexOf('users') + 1];
    const decoded = JSON.parse(Buffer.from(encodedUser, 'base64url').toString('utf8'));
    // Must encode the full owner/repo@sha context
    expect(decoded.key).toBe('acme/api@abc1234');
  });

  it('propagates variation and reason from LD', async () => {
    vi.stubGlobal('fetch', ldOkResponse(false, 0, 'TARGET_MATCH'));
    const result = await isCanaryEnabled('canary-rollout', CTX, { LD_SDK_KEY: 'key' });
    expect(result.value).toBe(false);
    expect(result.reason).toBe('TARGET_MATCH');
    expect(result.variation).toBe(0);
  });
});

// ── R1: routeTrafficWithFeatureFlag ───────────────────────────────────────

describe('R1 — routeTrafficWithFeatureFlag: no LD_SDK_KEY → routes unconditionally', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns outcome=routed and calls vercel edge-config when LD absent', async () => {
    vi.stubGlobal('fetch', vercelOkFetch());
    const result = await routeTrafficWithFeatureFlag(
      'https://preview.vercel.app',
      'canary-rollout',
      CTX,
      VERCEL_ENV,
    );
    expect(result.outcome).toBe('routed');
    expect(result.flagEval).toBeUndefined(); // LD was not queried
    expect(result.previewUrl).toBe('https://preview.vercel.app');
  });
});

describe('R1 — routeTrafficWithFeatureFlag: LD enabled + flag=true → routes', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('routes traffic when LD flag is on', async () => {
    vi.stubGlobal('fetch', combinedFetch(true));
    const result = await routeTrafficWithFeatureFlag(
      'https://preview.vercel.app',
      'canary-rollout',
      CTX,
      { ...VERCEL_ENV, LD_SDK_KEY: 'sdk-key' },
    );
    expect(result.outcome).toBe('routed');
    expect(result.flagEval?.value).toBe(true);
    expect(result.flagEval?.source).toBe('launchdarkly');
  });
});

describe('R1 — routeTrafficWithFeatureFlag: LD enabled + flag=false → skip', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('skips traffic routing when LD flag is off', async () => {
    let vercelCalled = false;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('launchdarkly')) {
        return { ok: true, status: 200, json: async () => ({ value: false, variation: 0, reason: { kind: 'FALLTHROUGH' } }) };
      }
      vercelCalled = true; // Should NOT be called
      return { ok: true, status: 200, text: async () => '{}', json: async () => ({}) };
    }));

    const result = await routeTrafficWithFeatureFlag(
      'https://preview.vercel.app',
      'canary-rollout',
      CTX,
      { ...VERCEL_ENV, LD_SDK_KEY: 'sdk-key' },
    );

    expect(result.outcome).toBe('skipped-by-flag');
    expect(result.flagEval?.value).toBe(false);
    expect(vercelCalled).toBe(false); // Vercel Edge Config NOT touched
  });

  it('skipped-by-flag result contains previewUrl for logging', async () => {
    vi.stubGlobal('fetch', combinedFetch(false));
    const result = await routeTrafficWithFeatureFlag(
      'https://preview-abc.vercel.app',
      'canary-rollout',
      CTX,
      { ...VERCEL_ENV, LD_SDK_KEY: 'sdk-key' },
    );
    expect(result.previewUrl).toBe('https://preview-abc.vercel.app');
    expect(result.outcome).toBe('skipped-by-flag');
  });
});

describe('R1 — routeTrafficWithFeatureFlag: LD error → fail-open (routes)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('routes traffic when LD API is unreachable (fail-open)', async () => {
    let vercelCalled = false;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('launchdarkly')) throw new Error('ECONNREFUSED');
      vercelCalled = true;
      return { ok: true, status: 200, text: async () => '{}', json: async () => ({}) };
    }));

    const result = await routeTrafficWithFeatureFlag(
      'https://preview.vercel.app',
      'canary-flag',
      CTX,
      { ...VERCEL_ENV, LD_SDK_KEY: 'sdk-key' },
    );

    // LD error → defaultValue=true → routed
    expect(result.outcome).toBe('routed');
    expect(result.flagEval?.source).toBe('default');
    expect(vercelCalled).toBe(true);
  });

  it('routes traffic when LD returns 401 (fail-open)', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('launchdarkly')) {
        return { ok: false, status: 401, json: async () => ({}) };
      }
      return { ok: true, status: 200, text: async () => '{}', json: async () => ({}) };
    }));

    const result = await routeTrafficWithFeatureFlag(
      'https://preview.vercel.app',
      'canary-flag',
      CTX,
      { ...VERCEL_ENV, LD_SDK_KEY: 'bad-key' },
    );

    expect(result.outcome).toBe('routed');
  });
});

// ── Regression guard: existing canary.ts surface unchanged ───────────────

describe('Regression — existing canary surface still works (Pass 14 guards)', () => {
  it('routeTrafficToCanary still throws clear error when VERCEL_TOKEN missing', async () => {
    await expect(
      routeTrafficToCanary('https://preview.example.com', {
        VERCEL_EDGE_CONFIG_ID: 'ecfg_test123',
      }),
    ).rejects.toThrow('VERCEL_TOKEN is required for canary traffic routing');
  });

  it('routeTrafficToCanary still throws clear error when VERCEL_EDGE_CONFIG_ID missing', async () => {
    await expect(
      routeTrafficToCanary('https://preview.example.com', {
        VERCEL_TOKEN: 'tok_test',
      }),
    ).rejects.toThrow('VERCEL_EDGE_CONFIG_ID is required for canary traffic routing');
  });

  it('rollbackCanary still returns without throwing when credentials absent', async () => {
    await expect(rollbackCanary({})).resolves.toBeUndefined();
  });
});

// ── Design Boundaries ─────────────────────────────────────────────────────

describe('Design Boundaries (Pass 68)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('DB-1: LD gate is fail-open — pipeline cannot be blocked by LD outage', async () => {
    // An LD outage produces defaultValue=true which always results in routing
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('launchdarkly')) throw new Error('timeout');
      return { ok: true, status: 200, text: async () => '{}', json: async () => ({}) };
    }));

    const result = await routeTrafficWithFeatureFlag(
      'https://preview.vercel.app', 'any-flag', CTX,
      { ...VERCEL_ENV, LD_SDK_KEY: 'sdk' },
    );
    expect(result.outcome).toBe('routed');
  });

  it('DB-2: LD gate adds signal without removing existing Vercel credential guards', async () => {
    // Even with LD enabled and flag=true, Vercel token guard still fires
    vi.stubGlobal('fetch', combinedFetch(true));
    await expect(
      routeTrafficWithFeatureFlag(
        'https://preview.vercel.app', 'canary-flag', CTX,
        { LD_SDK_KEY: 'sdk-key' }, // No VERCEL_TOKEN or VERCEL_EDGE_CONFIG_ID
      ),
    ).rejects.toThrow('VERCEL_TOKEN is required');
  });

  it('DB-3: flagEval is undefined in result when LD_SDK_KEY absent (no LD query)', async () => {
    vi.stubGlobal('fetch', vercelOkFetch());
    const result = await routeTrafficWithFeatureFlag(
      'https://preview.vercel.app', 'flag', CTX, VERCEL_ENV,
    );
    expect(result.flagEval).toBeUndefined();
  });

  it('DB-4: CanaryRoutingOutcome type covers routed and skipped-by-flag', async () => {
    // Type safety check — both variants are reachable
    vi.stubGlobal('fetch', combinedFetch(true));
    const routed = await routeTrafficWithFeatureFlag(
      'https://p.vercel.app', 'flag', CTX, { ...VERCEL_ENV, LD_SDK_KEY: 'k' },
    );
    expect(routed.outcome).toBe('routed');

    vi.unstubAllGlobals();
    vi.stubGlobal('fetch', combinedFetch(false));
    const skipped = await routeTrafficWithFeatureFlag(
      'https://p.vercel.app', 'flag', CTX, { ...VERCEL_ENV, LD_SDK_KEY: 'k' },
    );
    expect(skipped.outcome).toBe('skipped-by-flag');
  });
});

// ── End-to-end fail-open: routeTrafficWithFeatureFlag with LD 404 ─────────

describe('R2 — routeTrafficWithFeatureFlag: LD 404 end-to-end → routes (fail-open)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('routes unconditionally when LD returns 404 for unknown flag', async () => {
    let vercelCalled = false;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('launchdarkly')) {
        return { ok: false, status: 404, json: async () => ({}) };
      }
      vercelCalled = true;
      return { ok: true, status: 200, text: async () => '{}', json: async () => ({}) };
    }));

    const result = await routeTrafficWithFeatureFlag(
      'https://preview.vercel.app',
      'unknown-flag-key',
      CTX,
      { ...VERCEL_ENV, LD_SDK_KEY: 'sdk-key' },
    );

    expect(result.outcome).toBe('routed');
    expect(result.flagEval?.source).toBe('default');  // LD 404 → defaultValue=true → routed
    expect(vercelCalled).toBe(true);
  });
});

// ── Malformed LD JSON payload → fail-open ────────────────────────────────

describe('R3 — routeTrafficWithFeatureFlag: malformed LD payload → fail-open', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('routes when LD response is missing the value field', async () => {
    let vercelCalled = false;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('launchdarkly')) {
        // LD returns 200 OK but no value field — e.g. a schema change or partial response
        return { ok: true, status: 200, json: async () => ({ variation: 0, reason: { kind: 'OFF' } }) };
      }
      vercelCalled = true;
      return { ok: true, status: 200, text: async () => '{}', json: async () => ({}) };
    }));

    const result = await routeTrafficWithFeatureFlag(
      'https://preview.vercel.app',
      'canary-flag',
      CTX,
      { ...VERCEL_ENV, LD_SDK_KEY: 'sdk-key' },
    );

    // No boolean value → falls back to defaultValue=true → routed
    expect(result.outcome).toBe('routed');
    expect(vercelCalled).toBe(true);
  });

  it('routes when LD response value is not a boolean (e.g. string)', async () => {
    let vercelCalled = false;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('launchdarkly')) {
        return { ok: true, status: 200, json: async () => ({ value: 'yes', variation: 1 }) };
      }
      vercelCalled = true;
      return { ok: true, status: 200, text: async () => '{}', json: async () => ({}) };
    }));

    const result = await routeTrafficWithFeatureFlag(
      'https://preview.vercel.app',
      'canary-flag',
      CTX,
      { ...VERCEL_ENV, LD_SDK_KEY: 'sdk-key' },
    );

    // Non-boolean value field → falls back to defaultValue=true → routed
    expect(result.outcome).toBe('routed');
    expect(vercelCalled).toBe(true);
  });

  it('evaluateFlag returns defaultValue when LD response JSON is unparseable', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('launchdarkly')) {
        return {
          ok: true, status: 200,
          json: async () => { throw new SyntaxError('Unexpected token < in JSON'); },
        };
      }
      return { ok: true, status: 200, text: async () => '{}', json: async () => ({}) };
    }));

    const result = await evaluateFlag('my-flag', 'user', false, { LD_SDK_KEY: 'sdk-key' });
    expect(result.value).toBe(false);  // defaultValue preserved
    expect(result.source).toBe('default');
  });
});
