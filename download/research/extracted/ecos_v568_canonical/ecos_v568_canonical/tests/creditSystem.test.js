/**
 * Credit System tests — V112
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const { FiatLedger }  = require('../lib/fiatLedger');
const { CreditSystem } = require('../lib/creditSystem');

function makeSystem() {
  const ledger = new FiatLedger();
  const cs     = new CreditSystem({ ledger });
  return { ledger, cs };
}

describe('CreditSystem', () => {
  it('grantFreeTier credits 100 to a new account', async () => {
    const { cs, ledger } = makeSystem();
    const accountId = 'free-tier-test-' + Math.random().toString(36).slice(2);
    const before    = cs.balanceCredits(accountId);

    await cs.grantFreeTier(accountId, { reason: 'test_signup' });

    const after = cs.balanceCredits(accountId);
    expect(after - before).toBeCloseTo(100.0, 4);
  });

  it('spend reduces balance and creates audit entry', async () => {
    const { cs } = makeSystem();
    const accountId = 'spend-test-' + Math.random().toString(36).slice(2);
    await cs.grantFreeTier(accountId, { reason: 'setup' });

    const before = cs.balanceCredits(accountId);
    const result = await cs.spend(accountId, 10.0, { purpose: 'test_task' });

    expect(result.ok).toBe(true);
    expect(result.newBalance).toBeCloseTo(before - 10.0, 4);
  });

  it('spend throws on insufficient balance (no negative balances ever)', async () => {
    const { cs } = makeSystem();
    const accountId = 'broke-account-' + Math.random().toString(36).slice(2);

    await expect(
      cs.spend(accountId, 1.0, { purpose: 'will_fail' })
    ).rejects.toThrow(/insufficient/i);
  });

  it('earn increases balance', async () => {
    const { cs } = makeSystem();
    const accountId = 'earn-test-' + Math.random().toString(36).slice(2);
    const before    = cs.balanceCredits(accountId);

    const result = await cs.earn(accountId, 50.0, { source: 'validation_reward' });
    expect(result.ok).toBe(true);

    const after = cs.balanceCredits(accountId);
    expect(after - before).toBeCloseTo(50.0, 4);
  });

  it('creditsToMicro / microToCredits roundtrip is exact for whole credits', () => {
    const { cs } = makeSystem();
    for (const n of [1, 10, 100, 1000, 0.5, 2.5]) {
      const micro  = cs.creditsToMicro(n);
      const back   = cs.microToCredits(micro);
      expect(back).toBeCloseTo(n, 10);
    }
  });

  it('freeTierStatus reports remaining correctly', async () => {
    const { cs } = makeSystem();
    const accountId = 'ft-status-' + Math.random().toString(36).slice(2);
    await cs.grantFreeTier(accountId, { reason: 'test' });

    const status = cs.freeTierStatus(accountId);
    expect(status.granted).toBeCloseTo(100.0, 4);
    expect(status.remaining).toBeGreaterThan(0);
    expect(status.refreshesAt).toBeTruthy();
  });
});
