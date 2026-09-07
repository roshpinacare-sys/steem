/**
 * EngagementEngine tests — V112
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const { FiatLedger }       = require('../lib/fiatLedger');
const { CreditSystem }     = require('../lib/creditSystem');
const { EngagementEngine } = require('../lib/engagementEngine');

function makeUser(overrides = {}) {
  return {
    userId:               'test-user-' + Math.random().toString(36).slice(2),
    accountId:            'test-account-' + Math.random().toString(36).slice(2),
    displayName:          'Test User',
    validationsCompleted: 0,
    patchesAuthored:      0,
    totalEarned:          0,
    badges:               [],
    activityLog:          [],
    streak:               { current: 0, longest: 0, lastActiveDate: null },
    ...overrides,
  };
}

function makeEngine(users = []) {
  const ledger  = new FiatLedger();
  const userMap = new Map(users.map(u => [u.userId, u]));
  const engine  = new EngagementEngine({
    ledger,
    userStore: { getUser: id => userMap.get(id), getAllUsers: () => Array.from(userMap.values()) },
  });
  return { engine, userMap };
}

describe('EngagementEngine', () => {
  it('computeLevel returns Observer for new user', async () => {
    const user  = makeUser();
    const { engine } = makeEngine([user]);
    const level = await engine.computeLevel(user.userId);
    expect(level.level).toBe(1);
    expect(level.title).toBe('Observer');
  });

  it('computeLevel advances with contributions', async () => {
    const user = makeUser({ validationsCompleted: 20, patchesAuthored: 5 });
    const { engine } = makeEngine([user]);
    const level = await engine.computeLevel(user.userId);
    expect(level.level).toBeGreaterThan(1);
  });

  it('checkBadges awards first_validation badge', async () => {
    const user = makeUser({ validationsCompleted: 1 });
    const { engine } = makeEngine([user]);
    const badges = await engine.checkBadges(user.userId);
    expect(badges).toContain('first_validation');
  });

  it('updateStreak increments on consecutive days', async () => {
    const user = makeUser();
    const { engine, userMap } = makeEngine([user]);

    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    engine._streakDb.set(user.userId, { current: 2, longest: 2, lastDate: yesterday });

    const result = await engine.updateStreak(user.userId);
    expect(result.current).toBe(3);
    expect(result.longest).toBeGreaterThanOrEqual(3);
  });

  it('ownershipSnapshot returns lifetimeRoyaltiesEarned', async () => {
    const user = makeUser({ patchesAuthored: 5, totalEarned: 47.5 });
    const { engine } = makeEngine([user]);
    const snap = await engine.ownershipSnapshot(user.userId);
    expect(snap.lifetimeRoyaltiesEarned).toBeCloseTo(47.5, 2);
    expect(snap.patchesAuthored).toBe(5);
    expect(snap.shareOfKnowledgeBase).toBeTruthy();
  });

  it('community leaderboard sorts by royalties', async () => {
    const users = [
      makeUser({ displayName: 'A', totalEarned: 10 }),
      makeUser({ displayName: 'B', totalEarned: 500 }),
      makeUser({ displayName: 'C', totalEarned: 100 }),
    ];
    const { engine } = makeEngine(users);
    const board = await engine.communityLeaderboard('royalties');
    expect(board[0].totalEarned).toBeGreaterThanOrEqual(board[1].totalEarned);
    expect(board[1].totalEarned).toBeGreaterThanOrEqual(board[2].totalEarned);
  });
});
