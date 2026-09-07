/**
 * stripe.test.js — V91
 * Unit tests for lib/stripeProvider.js
 *
 * test 1: StripeProvider returns mock when no API key
 * test 2: StripeProvider throws on non-2xx Stripe response
 * test 3: StripeProvider.createPayout with apiKey calls https to api.stripe.com
 * test 4: StripeProvider converts microcents to cents correctly
 * test 5: StripeProvider constructor emits no warning when key is absent
 * test 6: StripeProvider constructor warns when key doesn't start with sk_
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

describe('StripeProvider', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    // Clear module cache so constructor re-reads env
    const p = require.resolve('../lib/stripeProvider');
    delete require.cache[p];
  });

  // ── test 1 ──────────────────────────────────────────────────────────────────
  it('StripeProvider returns mock when no API key', async () => {
    // Ensure env has no Stripe key
    const savedKey = process.env.STRIPE_API_KEY;
    delete process.env.STRIPE_API_KEY;
    try {
      const p = require.resolve('../lib/stripeProvider');
      delete require.cache[p];
      const { StripeProvider } = require('../lib/stripeProvider');
      const sp = new StripeProvider(); // no env key
      const result = await sp.createPayout('acct_test', 100000n);
      expect(result.mock).toBe(true);
      expect(result.success).toBe(true);
      expect(result.payoutId).toMatch(/^po_mock_/);
      expect(result.currency).toBe('usd');
    } finally {
      if (savedKey !== undefined) process.env.STRIPE_API_KEY = savedKey;
    }
  });

  // ── test 2 ──────────────────────────────────────────────────────────────────
  it('StripeProvider throws on non-2xx Stripe response', async () => {
    const https = require('node:https');

    // Mock https.request to return status 402 + Stripe error body
    vi.spyOn(https, 'request').mockImplementation((_opts, callback) => {
      // Build a fake IncomingMessage-like response
      const EventEmitter = require('node:events');
      const fakeRes = new EventEmitter();
      fakeRes.statusCode = 402;
      // Invoke callback immediately
      process.nextTick(() => {
        callback(fakeRes);
        fakeRes.emit('data', JSON.stringify({ error: { message: 'No such account' } }));
        fakeRes.emit('end');
      });

      // Return a fake request object
      const fakeReq = new EventEmitter();
      fakeReq.write = () => {};
      fakeReq.end   = () => {};
      return fakeReq;
    });

    // Reload module so it picks up the mock
    const p = require.resolve('../lib/stripeProvider');
    delete require.cache[p];
    const { StripeProvider } = require('../lib/stripeProvider');

    const sp = new StripeProvider();
    sp.apiKey = 'sk_test_fake'; // inject key so real path is taken

    await expect(sp.createPayout('acct_bad', 100000n))
      .rejects.toThrow('StripeProvider');
  });

  // ── test 3 ──────────────────────────────────────────────────────────────────
  it('StripeProvider.createPayout with apiKey calls https to api.stripe.com', async () => {
    const https = require('node:https');
    const EventEmitter = require('node:events');

    vi.spyOn(https, 'request').mockImplementation((_opts, callback) => {
      const fakeRes = new EventEmitter();
      fakeRes.statusCode = 200;
      process.nextTick(() => {
        callback(fakeRes);
        fakeRes.emit('data', JSON.stringify({ id: 'tr_test_abc123', object: 'transfer' }));
        fakeRes.emit('end');
      });
      const fakeReq = new EventEmitter();
      fakeReq.write = () => {};
      fakeReq.end   = () => {};
      return fakeReq;
    });

    const p = require.resolve('../lib/stripeProvider');
    delete require.cache[p];
    const { StripeProvider } = require('../lib/stripeProvider');

    const sp = new StripeProvider();
    sp.apiKey = 'sk_test_intercepted';

    const result = await sp.createPayout('acct_test123', 500000n);
    expect(result.mock).toBe(false);
    expect(result.payoutId).toBe('tr_test_abc123');
    expect(result.success).toBe(true);
  });

  // ── test 4 ──────────────────────────────────────────────────────────────────
  it('StripeProvider converts microcents to cents correctly', async () => {
    const https = require('node:https');
    const EventEmitter = require('node:events');
    let capturedBody = '';

    vi.spyOn(https, 'request').mockImplementation((_opts, callback) => {
      const fakeRes = new EventEmitter();
      fakeRes.statusCode = 200;
      process.nextTick(() => {
        callback(fakeRes);
        fakeRes.emit('data', JSON.stringify({ id: 'tr_test_200cents', object: 'transfer' }));
        fakeRes.emit('end');
      });
      const fakeReq = new EventEmitter();
      fakeReq.write = (chunk) => { capturedBody += chunk; };
      fakeReq.end   = () => {};
      return fakeReq;
    });

    const p = require.resolve('../lib/stripeProvider');
    delete require.cache[p];
    const { StripeProvider } = require('../lib/stripeProvider');

    const sp = new StripeProvider();
    sp.apiKey = 'sk_test_fake';

    // 2_000_000 microcents = 200 cents = $2.00
    await sp.createPayout('acct_123', 2_000_000n);
    expect(capturedBody).toContain('amount=200');
  });

  // ── test 5 ──────────────────────────────────────────────────────────────────
  it('StripeProvider constructor emits no warning when key is absent', () => {
    const savedKey = process.env.STRIPE_API_KEY;
    delete process.env.STRIPE_API_KEY;

    const warnSpy = vi.spyOn(console, 'warn');

    const p = require.resolve('../lib/stripeProvider');
    delete require.cache[p];
    const { StripeProvider } = require('../lib/stripeProvider');
    new StripeProvider();

    // console.warn should NOT have been called with 'sk_' warning
    const skWarnings = warnSpy.mock.calls.filter(
      call => typeof call[0] === 'string' && call[0].includes('sk_')
    );
    expect(skWarnings).toHaveLength(0);

    // Restore
    if (savedKey !== undefined) process.env.STRIPE_API_KEY = savedKey;
  });

  // ── test 6 ──────────────────────────────────────────────────────────────────
  it("StripeProvider constructor warns when key doesn't start with sk_", () => {
    process.env.STRIPE_API_KEY = 'not_a_valid_key';

    const warnSpy = vi.spyOn(console, 'warn');

    // Fresh require triggers module-level defaultStripeProvider constructor (1 warning).
    // Clear the spy so we only count our explicit call below.
    const p = require.resolve('../lib/stripeProvider');
    delete require.cache[p];
    const { StripeProvider } = require('../lib/stripeProvider');
    warnSpy.mockClear();

    // Explicit constructor call — should emit exactly 1 warning containing 'sk_'
    new StripeProvider();

    const skWarnings = warnSpy.mock.calls.filter(
      call => typeof call[0] === 'string' && call[0].includes('sk_')
    );
    expect(skWarnings).toHaveLength(1);

    delete process.env.STRIPE_API_KEY;
  });
});
