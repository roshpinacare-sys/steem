/**
 * Unit tests for canary.ts deployment helpers.
 * Focus: credential-guard regressions from Pass 14 (V24.15.0).
 */
import { describe, it, expect } from 'vitest';
import { routeTrafficToCanary, rollbackCanary } from '../src/services/canary.js';

describe('canary — credential guards (Bug 15-A regression)', () => {
  it('routeTrafficToCanary throws a clear error when VERCEL_TOKEN is missing', async () => {
    // Supplying edgeConfigId but NOT token — previously this silently sent
    // `Authorization: Bearer ` (empty string) to Vercel, producing an opaque
    // 401 with no hint that the env var was unset.
    await expect(
      routeTrafficToCanary('https://preview.example.com', {
        VERCEL_EDGE_CONFIG_ID: 'ecfg_test123',
        // VERCEL_TOKEN intentionally absent
      }),
    ).rejects.toThrow('VERCEL_TOKEN is required for canary traffic routing');
  });

  it('routeTrafficToCanary throws a clear error when VERCEL_EDGE_CONFIG_ID is missing', async () => {
    await expect(
      routeTrafficToCanary('https://preview.example.com', {
        VERCEL_TOKEN: 'tok_test',
        // VERCEL_EDGE_CONFIG_ID intentionally absent
      }),
    ).rejects.toThrow('VERCEL_EDGE_CONFIG_ID is required for canary traffic routing');
  });

  it('rollbackCanary returns without throwing when both credentials are absent', async () => {
    // rollbackCanary is best-effort: if nothing is configured it should be a no-op,
    // not an unhandled rejection. Previously it would proceed with an empty token.
    await expect(rollbackCanary({})).resolves.toBeUndefined();
  });
});
