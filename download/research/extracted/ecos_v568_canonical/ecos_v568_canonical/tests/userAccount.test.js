/**
 * UserAccount tests — V112
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const { FiatLedger }         = require('../lib/fiatLedger');
const { CreditSystem }       = require('../lib/creditSystem');
const { UserAccountService } = require('../lib/userAccount');

function makeService() {
  const ledger = new FiatLedger();
  const cs     = new CreditSystem({ ledger });
  const svc    = new UserAccountService({ ledger, creditSystem: cs });
  return { ledger, cs, svc };
}

describe('UserAccountService', () => {
  it('signup grants free-tier credits', async () => {
    const { cs, svc } = makeService();
    const result = await svc.signup({ email: 'alice@test.com', displayName: 'Alice' });
    expect(result.userId).toBeTruthy();
    expect(result.accountId).toBeTruthy();
    expect(result.credits).toBeCloseTo(100.0, 2);
  });

  it('signup generates a unique referral code', async () => {
    const { svc } = makeService();
    const r1 = await svc.signup({ email: 'bob@test.com', displayName: 'Bob' });
    const r2 = await svc.signup({ email: 'carol@test.com', displayName: 'Carol' });
    expect(r1.referralCode).toBeTruthy();
    expect(r2.referralCode).toBeTruthy();
    expect(r1.referralCode).not.toBe(r2.referralCode);
  });

  it('referral bonus applied after referee first action (not before)', async () => {
    const { cs, svc } = makeService();

    const referrer = await svc.signup({ email: 'referrer@test.com', displayName: 'Referrer' });
    const referrerBalBefore = cs.balanceCredits(referrer.accountId);

    const referee = await svc.signup({
      email:        'referee@test.com',
      displayName:  'Referee',
      referralCode: referrer.referralCode,
    });

    const referrerBalMid = cs.balanceCredits(referrer.accountId);
    expect(referrerBalMid).toBeCloseTo(referrerBalBefore, 2);

    await svc.recordActivity(referee.userId, 'task');

    const referrerBalAfter = cs.balanceCredits(referrer.accountId);
    const refereeBalAfter  = cs.balanceCredits(referee.accountId);

    expect(referrerBalAfter).toBeGreaterThan(referrerBalBefore);
    expect(refereeBalAfter).toBeGreaterThan(100.0);
  });

  it('getProfile returns level and credits', async () => {
    const { svc } = makeService();
    const created = await svc.signup({ email: 'dave@test.com', displayName: 'Dave' });
    const profile = await svc.getProfile(created.userId);

    expect(profile.userId).toBe(created.userId);
    expect(profile.displayName).toBe('Dave');
    expect(profile.credits).toBeGreaterThan(0);
    expect(profile.level).toBeGreaterThanOrEqual(1);
  });

  it('duplicate email signup is rejected', async () => {
    const { svc } = makeService();
    await svc.signup({ email: 'dup@test.com', displayName: 'First' });
    await expect(
      svc.signup({ email: 'dup@test.com', displayName: 'Second' })
    ).rejects.toThrow(/already registered/i);
  });
});
