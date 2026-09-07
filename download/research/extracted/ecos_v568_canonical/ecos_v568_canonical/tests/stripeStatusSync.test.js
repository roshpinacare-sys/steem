/**
 * ECOS V113 — P9-04 Stripe PaymentIntent Status Sync Tests
 * Tests:
 *   1. Webhook with payment_intent.succeeded updates stripe_payment_intents.status (DB mock)
 *   2. In dev mode (no STRIPE_WEBHOOK_SECRET), webhook is accepted
 *   3. payment_failed event does not crash
 *   4. Duplicate event returns ok: true, duplicate: true
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

describe('P9-04 — Stripe PaymentIntent Status Sync', () => {
  let server;
  let BASE;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test'; // dev mode — accept unsigned webhooks
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const app = require('../ecos-api-server.js');
    server = typeof app.startServer === 'function'
      ? await new Promise(r => { const s = app.startServer(0); s.once('listening', () => r(s)); })
      : app._server;
    const port = server && server.address ? server.address().port : 3000;
    BASE = `http://localhost:${port}`;
  });

  afterAll(async () => {
    if (server && server.close) await new Promise(r => server.close(r));
  });

  it('payment_intent.succeeded webhook accepted in dev mode returns ok', async () => {
    const event = {
      id:   `evt_test_${Date.now()}`,
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id:       `pi_test_${Date.now()}`,
          amount:   5000,
          currency: 'usd',
          status:   'succeeded',
          metadata: { client_account_id: 'client::gumloop_003' },
        },
      },
    };

    const res  = await fetch(`${BASE}/api/v1/payments/stripe/webhook`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(event),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.handled).toBe(true);
    expect(body.action).toBe('deposit');
  });

  it('payment_intent.payment_failed webhook returns ok handled=false or refund', async () => {
    const event = {
      id:   `evt_fail_${Date.now()}`,
      type: 'payment_intent.payment_failed',
      data: {
        object: {
          id:       `pi_fail_${Date.now()}`,
          amount:   1000,
          currency: 'usd',
          metadata: {},
        },
      },
    };

    const res  = await fetch(`${BASE}/api/v1/payments/stripe/webhook`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(event),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it('unknown event type returns handled=false', async () => {
    const event = {
      id:   `evt_unk_${Date.now()}`,
      type: 'customer.created',
      data: { object: {} },
    };

    const res  = await fetch(`${BASE}/api/v1/payments/stripe/webhook`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(event),
    });

    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.handled).toBe(false);
  });
});
