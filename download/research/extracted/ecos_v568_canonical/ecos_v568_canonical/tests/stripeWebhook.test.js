'use strict';
/**
 * Tests for StripeProvider V109 additions:
 *   - constructEvent() — webhook signature verification
 *   - handleDepositWebhook() — event processing
 *   - handleWebhookRequest() — convenience wrapper
 */

import { describe, it, expect, beforeEach } from 'vitest';
import crypto from 'node:crypto';

const { StripeProvider } = await import('../lib/stripeProvider.js');

// ── Test helpers ──────────────────────────────────────────────────────────────

const TEST_SECRET = 'whsec_test_secret_1234567890abcdef';

function buildSignature(rawBody, secret, timestampOffset = 0) {
  const ts = Math.floor(Date.now() / 1000) + timestampOffset;
  const signedPayload = `${ts}.${rawBody}`;
  const sig = crypto.createHmac('sha256', secret).update(signedPayload, 'utf8').digest('hex');
  return { sigHeader: `t=${ts},v1=${sig}`, ts };
}

function buildEvent(type, dataObject = {}, meta = {}) {
  return JSON.stringify({
    id: 'evt_test_' + crypto.randomBytes(8).toString('hex'),
    type,
    data: { object: dataObject },
    ...meta,
  });
}

// ── constructEvent ────────────────────────────────────────────────────────────

describe('StripeProvider.constructEvent', () => {
  let sp;
  beforeEach(() => {
    sp = new StripeProvider();
    sp.webhookSecret = TEST_SECRET;
  });

  it('verifies a valid Stripe signature', () => {
    const body = buildEvent('payment_intent.succeeded', { id: 'pi_test', amount: 5000, currency: 'usd' });
    const { sigHeader } = buildSignature(body, TEST_SECRET);
    const result = sp.constructEvent(body, sigHeader);
    expect(result.ok).toBe(true);
    expect(result.event).toBeDefined();
    expect(result.event.type).toBe('payment_intent.succeeded');
  });

  it('rejects a tampered body', () => {
    const body = buildEvent('payment_intent.succeeded', { id: 'pi_test', amount: 5000 });
    const { sigHeader } = buildSignature(body, TEST_SECRET);
    const tamperedBody = body + '_tampered';
    const result = sp.constructEvent(tamperedBody, sigHeader);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/signature verification failed/i);
  });

  it('rejects a wrong secret', () => {
    const body = buildEvent('payment_intent.succeeded', {});
    const { sigHeader } = buildSignature(body, 'wrong_secret');
    const result = sp.constructEvent(body, sigHeader);
    expect(result.ok).toBe(false);
  });

  it('rejects a stale timestamp (>300s)', () => {
    const body = buildEvent('payment_intent.succeeded', {});
    const { sigHeader } = buildSignature(body, TEST_SECRET, -400); // 400s in the past
    const result = sp.constructEvent(body, sigHeader);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/too old/i);
  });

  it('returns error when secret not configured', () => {
    const sp2 = new StripeProvider();
    sp2.webhookSecret = null;
    const body = buildEvent('payment_intent.succeeded', {});
    const { sigHeader } = buildSignature(body, TEST_SECRET);
    const result = sp2.constructEvent(body, sigHeader);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/STRIPE_WEBHOOK_SECRET not set/);
  });

  it('returns error when rawBody is empty', () => {
    const result = sp.constructEvent('', 't=1234,v1=abc');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/rawBody required/);
  });

  it('returns error when sigHeader is missing', () => {
    const result = sp.constructEvent('{}', '');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Stripe-Signature header missing/);
  });

  it('returns error for malformed signature header', () => {
    const body = buildEvent('payment_intent.succeeded', {});
    const result = sp.constructEvent(body, 'not-a-valid-header');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Malformed/);
  });

  it('accepts Buffer as rawBody', () => {
    const body = buildEvent('payment_intent.succeeded', { id: 'pi_1', amount: 100, currency: 'usd' });
    const { sigHeader } = buildSignature(body, TEST_SECRET);
    const result = sp.constructEvent(Buffer.from(body, 'utf8'), sigHeader);
    expect(result.ok).toBe(true);
  });

  it('accepts explicit secret override', () => {
    const altSecret = 'whsec_alternative_secret_xyz123';
    const body = buildEvent('payment_intent.succeeded', {});
    const { sigHeader } = buildSignature(body, altSecret);
    sp.webhookSecret = 'wrong_secret'; // would fail if not overridden
    const result = sp.constructEvent(body, sigHeader, altSecret);
    expect(result.ok).toBe(true);
  });
});

// ── handleDepositWebhook ───────────────────────────────────────────────────────

describe('StripeProvider.handleDepositWebhook', () => {
  let sp;
  beforeEach(() => { sp = new StripeProvider(); });

  it('handles payment_intent.succeeded with client_account_id', () => {
    const event = {
      id:   'evt_1',
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id:              'pi_1',
          amount_received: 5000,
          currency:        'usd',
          metadata:        { client_account_id: 'client_abc' },
        },
      },
    };
    const action = sp.handleDepositWebhook(event);
    expect(action.handled).toBe(true);
    expect(action.action).toBe('deposit');
    expect(action.accountId).toBe('client_abc');
    expect(action.amountMicrocents).toBe(BigInt(5000 * 10000)); // 5000 cents → microcents
    expect(action.currency).toBe('usd');
    expect(action.stripeEventId).toBe('evt_1');
  });

  it('converts cents to microcents correctly (BigInt)', () => {
    const event = {
      id: 'evt_2', type: 'payment_intent.succeeded',
      data: { object: { amount_received: 1, currency: 'usd', metadata: { client_account_id: 'c1' } } },
    };
    const action = sp.handleDepositWebhook(event);
    expect(action.amountMicrocents).toBe(10000n);
  });

  it('returns handled=false when client_account_id missing', () => {
    const event = {
      id: 'evt_3', type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_1', amount_received: 500, currency: 'usd', metadata: {} } },
    };
    const action = sp.handleDepositWebhook(event);
    expect(action.handled).toBe(false);
    expect(action.reason).toMatch(/client_account_id/);
  });

  it('handles payment_intent.payment_failed', () => {
    const event = {
      id: 'evt_4', type: 'payment_intent.payment_failed',
      data: { object: { last_payment_error: { message: 'Card declined' } } },
    };
    const action = sp.handleDepositWebhook(event);
    expect(action.handled).toBe(true);
    expect(action.action).toBe('payment_failed');
  });

  it('handles charge.refunded', () => {
    const event = {
      id: 'evt_5', type: 'charge.refunded',
      data: { object: { amount_refunded: 500 } },
    };
    const action = sp.handleDepositWebhook(event);
    expect(action.handled).toBe(true);
    expect(action.action).toBe('refund');
    expect(action.amountRefunded).toBe(BigInt(500 * 10000));
  });

  it('returns handled=false for unhandled event types', () => {
    const event = { id: 'evt_6', type: 'customer.updated', data: { object: {} } };
    const action = sp.handleDepositWebhook(event);
    expect(action.handled).toBe(false);
    expect(action.reason).toMatch(/Unhandled event type/);
  });

  it('returns handled=false for null event', () => {
    expect(sp.handleDepositWebhook(null).handled).toBe(false);
    expect(sp.handleDepositWebhook(undefined).handled).toBe(false);
  });
});

// ── handleWebhookRequest ──────────────────────────────────────────────────────

describe('StripeProvider.handleWebhookRequest', () => {
  it('returns ok=false when signature verification fails', () => {
    const sp = new StripeProvider();
    sp.webhookSecret = TEST_SECRET;
    const result = sp.handleWebhookRequest('{}', 'invalid-header');
    expect(result.ok).toBe(false);
  });

  it('returns ok=true + action on valid signature + payment_intent.succeeded', () => {
    const sp = new StripeProvider();
    sp.webhookSecret = TEST_SECRET;
    const body = buildEvent('payment_intent.succeeded', {
      id: 'pi_1', amount_received: 2500, currency: 'usd',
      metadata: { client_account_id: 'client_xyz' },
    });
    const { sigHeader } = buildSignature(body, TEST_SECRET);
    const result = sp.handleWebhookRequest(body, sigHeader);
    expect(result.ok).toBe(true);
    expect(result.action).toBeDefined();
    expect(result.action.action).toBe('deposit');
    expect(result.action.accountId).toBe('client_xyz');
  });
});

// ── createPayout (existing — unchanged) ───────────────────────────────────────

describe('StripeProvider.createPayout (regression)', () => {
  it('returns mock payout when no API key', async () => {
    const sp = new StripeProvider();
    sp.apiKey = null;
    const result = await sp.createPayout('acct_test', 50000000n);
    expect(result.success).toBe(true);
    expect(result.mock).toBe(true);
    expect(result.payoutId).toMatch(/^po_mock_/);
  });

  it('throws on zero amount', async () => {
    const sp = new StripeProvider();
    sp.apiKey = null;
    await expect(sp.createPayout('acct_test', 0n)).rejects.toThrow('amount must be > 0');
  });

  it('throws when validatorAccountId missing', async () => {
    const sp = new StripeProvider();
    await expect(sp.createPayout('', 1000n)).rejects.toThrow('validatorAccountId required');
  });
});
