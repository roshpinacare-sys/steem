/**
 * rateLimiter.test.js — V96
 * Unit tests for engine/lib/rateLimiter.js
 * 6 tests covering: allow, block, reset, independence, decrement, allowed:false
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { RateLimiter } = require('../lib/rateLimiter');

// Collect limiters so we can destroy them after each test
const limiters = [];
function mkLimiter(windowMs, max) {
  const rl = new RateLimiter(windowMs, max);
  limiters.push(rl);
  return rl;
}

afterEach(() => {
  while (limiters.length) limiters.pop().destroy();
});

describe('RateLimiter', () => {
  it('test 1: allows requests under limit', () => {
    const rl = mkLimiter(60_000, 5);
    for (let i = 0; i < 5; i++) {
      const result = rl.check('ip1');
      expect(result.allowed).toBe(true);
    }
  });

  it('test 2: blocks request at limit', () => {
    const rl = mkLimiter(60_000, 3);
    rl.check('ip2');
    rl.check('ip2');
    rl.check('ip2');
    // 4th request should be blocked
    const result = rl.check('ip2');
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it('test 3: resets window after windowMs', () => {
    const rl = mkLimiter(50, 2); // 50ms window
    rl.check('ip3');
    rl.check('ip3');
    // At limit — now exhausted
    expect(rl.check('ip3').allowed).toBe(false);

    // Wait for window to expire, then allow again
    return new Promise(resolve => setTimeout(() => {
      const result = rl.check('ip3');
      expect(result.allowed).toBe(true);
      resolve();
    }, 60));
  });

  it('test 4: different keys are independent', () => {
    const rl = mkLimiter(60_000, 2);
    rl.check('ipA');
    rl.check('ipA');
    // ipA is exhausted
    expect(rl.check('ipA').allowed).toBe(false);
    // ipB is unaffected
    const resultB = rl.check('ipB');
    expect(resultB.allowed).toBe(true);
  });

  it('test 5: remaining count decrements correctly', () => {
    const rl = mkLimiter(60_000, 4);
    expect(rl.check('ip5').remaining).toBe(3); // after 1st call: 4-1=3
    expect(rl.check('ip5').remaining).toBe(2);
    expect(rl.check('ip5').remaining).toBe(1);
    expect(rl.check('ip5').remaining).toBe(0);
  });

  it('test 6: returns allowed:false when limit reached', () => {
    const rl = mkLimiter(60_000, 1);
    rl.check('ip6'); // uses the single allowed slot
    const result = rl.check('ip6');
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.resetAt).toBeInstanceOf(Date);
  });

  // [V101 BUG-G / P1] Rate limit headers
  it('test 7: resetAt is always a valid future Date', () => {
    const rl = mkLimiter(60_000, 5);
    const before = Date.now();
    const { resetAt } = rl.check('ip7');
    expect(resetAt).toBeInstanceOf(Date);
    expect(resetAt.getTime()).toBeGreaterThan(before);
  });

  it('test 8: remaining is 0 and resetAt is set when blocked', () => {
    const rl = mkLimiter(60_000, 2);
    rl.check('ip8');
    rl.check('ip8');
    const { allowed, remaining, resetAt } = rl.check('ip8');
    expect(allowed).toBe(false);
    expect(remaining).toBe(0);
    expect(resetAt).toBeInstanceOf(Date);
    // resetAt should be within the window from now
    expect(resetAt.getTime()).toBeGreaterThan(Date.now());
  });
});
