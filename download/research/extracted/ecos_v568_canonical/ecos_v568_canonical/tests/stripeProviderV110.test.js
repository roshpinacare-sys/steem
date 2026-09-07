'use strict';
/**
 * Tests for StripeProvider V110 additions:
 *   - createPaymentIntent() (BUG-K-2)
 *   - handleDepositWebhook() charge.refunded with accountId (P8-05)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { StripeProvider } = await import('../lib/stripeProvider.js');

// ── createPaymentIntent — mock path (no STRIPE_API_KEY) ───────────────────────

describe('StripeProvider.createPaymentIntent — mock path', () => {
  it('returns mock PaymentIntent when STRIPE_API_KEY not set', async () => {
    const sp = new StripeProvider();
    // Ensure no API key
    sp.apiKey = null;

    const result = await sp.createPaymentIntent('client::test-123', 2000, 'usd');

    expect(result.success).toBe(true);
    expect(result.mock).toBe(true);
    expect(result.paymentIntentId).toMatch(/^pi_mock_/);
    expect(result.clientSecret).toMatch(/^pi_mock_/);
    expect(result.clientSecret).toContain('_secret_mock');
    expect(result.amount).toBe(2000);
    expect(result.currency).toBe('usd');
    expect(result.timestamp).toBeTruthy();
  });

  it('rounds amountCents to integer', async () => {
    const sp = new StripeProvider();
    sp.apiKey = null;

    const result = await sp.createPaymentIntent('client::xyz', 19.9, 'usd');
    expect(result.amount).toBe(20);
  });

  it('defaults currency to usd when not provided', async () => {
    const sp = new StripeProvider();
    sp.apiKey = null;

    const result = await sp.createPaymentIntent('client::abc', 500);
    expect(result.currency).toBe('usd');
  });

  it('supports non-usd currency', async () => {
    const sp = new StripeProvider();
    sp.apiKey = null;

    const result = await sp.createPaymentIntent('client::eur-1', 1000, 'eur');
    expect(result.currency).toBe('eur');
    expect(result.success).toBe(true);
  });

  it('generates unique paymentIntentIds per call', async () => {
    const sp = new StripeProvider();
    sp.apiKey = null;

    const [r1, r2] = await Promise.all([
      sp.createPaymentIntent('client::a', 100),
      sp.createPaymentIntent('client::b', 100),
    ]);
    expect(r1.paymentIntentId).not.toBe(r2.paymentIntentId);
  });
});

// ── createPaymentIntent — validation ─────────────────────────────────────────

describe('StripeProvider.createPaymentIntent — validation', () => {
  it('throws TypeError when clientAccountId is missing', async () => {
    const sp = new StripeProvider();
    sp.apiKey = null;

    await expect(sp.createPaymentIntent('', 1000)).rejects.toThrow(TypeError);
    await expect(sp.createPaymentIntent(null, 1000)).rejects.toThrow(TypeError);
  });

  it('throws RangeError when amountCents is zero or negative', async () => {
    const sp = new StripeProvider();
    sp.apiKey = null;

    await expect(sp.createPaymentIntent('client::x', 0)).rejects.toThrow(RangeError);
    await expect(sp.createPaymentIntent('client::x', -100)).rejects.toThrow(RangeError);
  });

  it('throws RangeError when amountCents is NaN', async () => {
    const sp = new StripeProvider();
    sp.apiKey = null;

    await expect(sp.createPaymentIntent('client::x', NaN)).rejects.toThrow(RangeError);
  });
});

// ── createPaymentIntent — real path (mocked https) ───────────────────────────

describe('StripeProvider.createPaymentIntent — real path (mocked https)', () => {
  it('posts to /v1/payment_intents with correct parameters', async () => {
    const sp = new StripeProvider();
    sp.apiKey = 'sk_test_mock_key';

    // Mock _httpsPost
    let capturedPath, capturedBody, capturedHeaders;
    sp._httpsPost = async (hostname, path, body, headers) => {
      capturedPath    = path;
      capturedBody    = body;
      capturedHeaders = headers;
      return {
        id:            'pi_real_test_abc123',
        client_secret: 'pi_real_test_abc123_secret_xyz',
        amount:        5000,
        currency:      'usd',
        status:        'requires_payment_method',
      };
    };

    const result = await sp.createPaymentIntent('client::live-1', 5000, 'usd');

    expect(capturedPath).toBe('/v1/payment_intents');
    expect(capturedBody).toContain('amount=5000');
    expect(capturedBody).toContain('currency=usd');
    expect(capturedBody).toContain('client_account_id');
    expect(result.success).toBe(true);
    expect(result.mock).toBe(false);
    expect(result.paymentIntentId).toBe('pi_real_test_abc123');
    expect(result.clientSecret).toBe('pi_real_test_abc123_secret_xyz');
    expect(result.amount).toBe(5000);
  });

  it('embeds client_account_id in metadata', async () => {
    const sp = new StripeProvider();
    sp.apiKey = 'sk_test_mock_key';

    let capturedBody;
    sp._httpsPost = async (_h, _p, body) => {
      capturedBody = body;
      return { id: 'pi_meta_test', client_secret: 'pi_meta_test_secret', amount: 1000, currency: 'usd' };
    };

    await sp.createPaymentIntent('client::metadata-check', 1000);
    expect(capturedBody).toContain('metadata');
    expect(capturedBody).toContain('client_account_id');
  });

  it('throws Error when Stripe returns no id', async () => {
    const sp = new StripeProvider();
    sp.apiKey = 'sk_test_mock_key';

    sp._httpsPost = async () => ({
      error: { message: 'Your card was declined.' },
    });

    await expect(sp.createPaymentIntent('client::fail', 1000))
      .rejects.toThrow('StripeProvider');
  });
});

// ── handleDepositWebhook — charge.refunded with accountId (P8-05) ─────────────

describe('StripeProvider.handleDepositWebhook — charge.refunded', () => {
  it('returns action=refund with amountRefunded as BigInt', () => {
    const sp = new StripeProvider();

    const event = {
      id:   'evt_refund_001',
      type: 'charge.refunded',
      data: {
        object: {
          id:              'ch_test_123',
          amount_refunded: 2000, // Stripe cents
          metadata:        { client_account_id: 'client::refund-test' },
        },
      },
    };

    const action = sp.handleDepositWebhook(event);

    expect(action.handled).toBe(true);
    expect(action.action).toBe('refund');
    expect(action.amountRefunded).toBe(20_000_000n); // 2000 cents × 10000 = 20M microcents
    expect(action.accountId).toBe('client::refund-test');
    expect(action.stripeEventId).toBe('evt_refund_001');
  });

  it('returns accountId=null when metadata.client_account_id missing', () => {
    const sp = new StripeProvider();

    const event = {
      id:   'evt_refund_002',
      type: 'charge.refunded',
      data: {
        object: {
          amount_refunded: 500,
          metadata:        {},
        },
      },
    };

    const action = sp.handleDepositWebhook(event);
    expect(action.handled).toBe(true);
    expect(action.action).toBe('refund');
    expect(action.accountId).toBeNull();
  });

  it('returns amountRefunded=0n when charge data missing', () => {
    const sp = new StripeProvider();

    const event = { id: 'evt_refund_003', type: 'charge.refunded', data: null };
    const action = sp.handleDepositWebhook(event);

    expect(action.handled).toBe(true);
    expect(action.amountRefunded).toBe(0n);
  });
});

// ── constructEvent — still passes existing behaviour ─────────────────────────

describe('StripeProvider.constructEvent (regression)', () => {
  it('rejects missing webhookSecret', () => {
    const sp = new StripeProvider();
    sp.webhookSecret = null;
    const r = sp.constructEvent('body', 't=1,v1=abc');
    expect(r.ok).toBe(false);
    expect(r.error).toContain('STRIPE_WEBHOOK_SECRET');
  });

  it('rejects malformed Stripe-Signature header', () => {
    const sp = new StripeProvider();
    sp.webhookSecret = 'whsec_test';
    const r = sp.constructEvent('body', 'bad-header');
    expect(r.ok).toBe(false);
  });
});
