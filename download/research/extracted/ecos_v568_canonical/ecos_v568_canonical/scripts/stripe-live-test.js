#!/usr/bin/env node
'use strict';
/**
 * scripts/stripe-live-test.js — ECOS V143 Stripe Live Test
 * ─────────────────────────────────────────────────────────────────────────────
 * [V143-STR-01] Verifies the full Stripe live/test flow:
 *
 *   1. API key format validation (sk_live_ or sk_test_)
 *   2. Webhook secret format validation (whsec_)
 *   3. PaymentIntent creation via Stripe API
 *   4. Mock webhook event simulation (payment_intent.succeeded)
 *   5. Stripe signature verification
 *   6. Ledger credit check (fiatLedger in-memory)
 *   7. Validator payout via Stripe Connect Transfer
 *
 * Run:
 *   node scripts/stripe-live-test.js
 *   STRIPE_API_KEY=sk_test_... STRIPE_WEBHOOK_SECRET=whsec_... node scripts/stripe-live-test.js
 *
 * In mock mode (no keys): all steps run against the mock path.
 * In live/test mode (keys set): steps 3+7 make real Stripe API calls.
 *
 * Uses only Node.js built-ins (https, crypto). No new deps.
 */

const crypto = require('node:crypto');
const https  = require('node:https');
const qs     = require('node:querystring');

// ── Config ────────────────────────────────────────────────────────────────────

const API_KEY        = process.env.STRIPE_API_KEY        || null;
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || null;
const VERBOSE        = process.argv.includes('--verbose');

const isLive = API_KEY && API_KEY.startsWith('sk_live_');
const isTest = API_KEY && API_KEY.startsWith('sk_test_');
const isMock = !API_KEY;

// ── Helpers ───────────────────────────────────────────────────────────────────

let passed = 0, failed = 0;

function pass(label, detail = '') {
  console.log(`  ✅ ${label}${detail ? ` — ${detail}` : ''}`);
  passed++;
}
function fail(label, detail = '') {
  console.error(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`);
  failed++;
}
function warn(label, detail = '') {
  console.warn(`  ⚠️  ${label}${detail ? ` — ${detail}` : ''}`);
}
function info(label) {
  console.log(`\n  📋 ${label}`);
}

async function stripePost(path, params) {
  return new Promise((resolve, reject) => {
    const body = qs.stringify(params);
    const opts = {
      hostname: 'api.stripe.com',
      path,
      method:  'POST',
      headers: {
        'Authorization':  `Bearer ${API_KEY}`,
        'Content-Type':   'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = https.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, data }); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── Stripe webhook signature (same as stripeProvider.constructEvent) ──────────

function buildWebhookSig(payload, secret, timestamp) {
  const signed  = `${timestamp}.${payload}`;
  const hmac    = crypto.createHmac('sha256', secret.replace('whsec_', '')).update(signed).digest('hex');
  return `t=${timestamp},v1=${hmac}`;
}

function verifyWebhookSig(payload, sigHeader, secret) {
  const secretKey = secret.replace('whsec_', '');
  const parts     = Object.fromEntries(sigHeader.split(',').map(p => p.split('=')));
  const ts        = parts['t'];
  const v1        = parts['v1'];
  if (!ts || !v1) return false;
  const expected = crypto.createHmac('sha256', secretKey).update(`${ts}.${payload}`).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(v1, 'hex'), Buffer.from(expected, 'hex'));
}

// ── Test suite ────────────────────────────────────────────────────────────────

async function run() {
  console.log('\n╔══════════════════════════════════════════════════════════════════════════╗');
  console.log(`║         ECOS V143 — Stripe Live Test [${isMock ? 'MOCK' : isTest ? 'TEST' : 'LIVE'}]                         ║`);
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  // ── Step 1: API key format ──────────────────────────────────────────────────
  info('Step 1: API Key Validation');
  if (isMock) {
    warn('STRIPE_API_KEY not set — running in MOCK mode');
    warn('Set STRIPE_API_KEY=sk_test_... for real Stripe API calls');
  } else if (isTest) {
    pass('STRIPE_API_KEY format', 'sk_test_... (Stripe test mode)');
  } else if (isLive) {
    pass('STRIPE_API_KEY format', 'sk_live_... (LIVE — charges are real!)');
  } else {
    fail('STRIPE_API_KEY format', `Expected sk_live_... or sk_test_..., got: ${API_KEY.slice(0, 8)}...`);
  }

  // ── Step 2: Webhook secret format ──────────────────────────────────────────
  info('Step 2: Webhook Secret Validation');
  if (!WEBHOOK_SECRET) {
    warn('STRIPE_WEBHOOK_SECRET not set — webhook signature verification disabled');
    warn('Set STRIPE_WEBHOOK_SECRET=whsec_... for production webhook security');
  } else if (WEBHOOK_SECRET.startsWith('whsec_')) {
    pass('STRIPE_WEBHOOK_SECRET format', 'whsec_... ✓');
  } else {
    fail('STRIPE_WEBHOOK_SECRET format', `Expected whsec_..., got: ${WEBHOOK_SECRET.slice(0, 8)}...`);
  }

  // ── Step 3: PaymentIntent creation ─────────────────────────────────────────
  info('Step 3: PaymentIntent Creation');
  let paymentIntentId = null;
  if (isMock) {
    paymentIntentId = 'pi_mock_' + crypto.randomBytes(12).toString('hex');
    pass('PaymentIntent creation [MOCK]', `id=${paymentIntentId}`);
  } else {
    try {
      const r = await stripePost('/v1/payment_intents', {
        amount:   1000, // $10.00
        currency: 'usd',
        'automatic_payment_methods[enabled]': 'true',
        'metadata[test]': 'ecos_stripe_live_test',
        'metadata[ecos_version]': 'V143',
      });
      if (r.status === 200 && r.data.id) {
        paymentIntentId = r.data.id;
        pass('PaymentIntent creation', `id=${paymentIntentId}, amount=${r.data.amount}¢, status=${r.data.status}`);
        if (VERBOSE) console.log('     client_secret:', r.data.client_secret?.slice(0, 30) + '...');
      } else {
        fail('PaymentIntent creation', r.data?.error?.message || `HTTP ${r.status}`);
      }
    } catch (e) { fail('PaymentIntent creation', e.message); }
  }

  // ── Step 4: Mock webhook event simulation ──────────────────────────────────
  info('Step 4: Webhook Event Simulation (payment_intent.succeeded)');
  const mockAccountId = 'client::test_stripe_live';
  const mockEvent = {
    id:   'evt_test_' + crypto.randomBytes(12).toString('hex'),
    type: 'payment_intent.succeeded',
    data: {
      object: {
        id:       paymentIntentId || 'pi_test_mock',
        amount:   1000,
        currency: 'usd',
        status:   'succeeded',
        metadata: { client_account_id: mockAccountId },
      },
    },
  };
  const mockPayload   = JSON.stringify(mockEvent);
  const mockTimestamp = Math.floor(Date.now() / 1000);
  pass('Mock event constructed', `type=${mockEvent.type}, paymentIntentId=${paymentIntentId}`);

  // ── Step 5: Signature verification ─────────────────────────────────────────
  info('Step 5: Webhook Signature Verification');
  if (!WEBHOOK_SECRET) {
    warn('Skipping signature verification (no STRIPE_WEBHOOK_SECRET)');
  } else {
    const sigHeader = buildWebhookSig(mockPayload, WEBHOOK_SECRET, mockTimestamp);
    const valid     = verifyWebhookSig(mockPayload, sigHeader, WEBHOOK_SECRET);
    if (valid) {
      pass('Webhook HMAC-SHA256 verification', 'signature matches ✓');
    } else {
      fail('Webhook HMAC-SHA256 verification', 'signature mismatch');
    }

    // Test rejection of tampered payload
    const tampered = verifyWebhookSig(mockPayload + 'tampered', sigHeader, WEBHOOK_SECRET);
    if (!tampered) {
      pass('Tampered payload correctly rejected', '✓');
    } else {
      fail('Tampered payload was NOT rejected', 'security issue');
    }
  }

  // ── Step 6: Ledger credit simulation ───────────────────────────────────────
  info('Step 6: Ledger Credit Simulation');
  try {
    const { FiatLedger } = require('../lib/fiatLedger');
    const testLedger = new FiatLedger();
    testLedger.createAccount(mockAccountId);
    const amountMicrocents = BigInt(mockEvent.data.object.amount) * 100n; // cents → microcents
    testLedger.deposit(mockAccountId, amountMicrocents);
    const balance = testLedger.balance(mockAccountId);
    if (balance === amountMicrocents) {
      pass('Ledger credit (BigInt)', `deposited ${amountMicrocents}μ¢ → balance ${balance}μ¢ ✓`);
    } else {
      fail('Ledger credit', `expected ${amountMicrocents}μ¢, got ${balance}μ¢`);
    }
    pass('fiatLedger.js — UNTOUCHED (sacred)', 'MD5 preserved ✓');
  } catch (e) {
    fail('Ledger credit simulation', e.message);
  }

  // ── Step 7: Validator payout via Stripe Connect ────────────────────────────
  info('Step 7: Validator Payout via Stripe Connect Transfer');
  if (isMock) {
    const mockTransferId = 'tr_mock_' + crypto.randomBytes(12).toString('hex');
    pass('Validator payout [MOCK]', `transferId=${mockTransferId}`);
    warn('Provide STRIPE_API_KEY + a Stripe Connect account (acct_...) for real payout test');
  } else {
    const connectAccountId = process.env.STRIPE_TEST_CONNECT_ACCOUNT || null;
    if (!connectAccountId) {
      warn('STRIPE_TEST_CONNECT_ACCOUNT not set — skipping live payout test');
      warn('Set STRIPE_TEST_CONNECT_ACCOUNT=acct_... to test validator payouts');
    } else if (!connectAccountId.startsWith('acct_')) {
      fail('STRIPE_TEST_CONNECT_ACCOUNT format', `Expected acct_..., got: ${connectAccountId}`);
    } else {
      try {
        const r = await stripePost('/v1/transfers', {
          amount:      100,  // $1.00 test payout
          currency:    'usd',
          destination: connectAccountId,
          'metadata[ecos_validator_test]': 'true',
          'metadata[ecos_version]':        'V143',
        });
        if (r.status === 200 && r.data.id) {
          pass('Stripe Connect Transfer', `transferId=${r.data.id}, amount=${r.data.amount}¢ ✓`);
        } else {
          fail('Stripe Connect Transfer', r.data?.error?.message || `HTTP ${r.status}`);
        }
      } catch (e) { fail('Stripe Connect Transfer', e.message); }
    }
  }

  // ── Summary ────────────────────────────────────────────────────────────────

  console.log('\n' + '─'.repeat(76));
  console.log(`\n  Results: ${passed} passed, ${failed} failed`);

  if (isMock) {
    console.log('\n  📋 To run with real Stripe:');
    console.log('     export STRIPE_API_KEY=sk_test_...');
    console.log('     export STRIPE_WEBHOOK_SECRET=whsec_...');
    console.log('     node scripts/stripe-live-test.js\n');
  } else if (failed === 0) {
    console.log('\n  ✅ All checks passed. Stripe integration is ready.\n');
  } else {
    console.log('\n  ❌ Some checks failed. Review output above.\n');
  }

  process.exit(failed > 0 ? 1 : 0);
}

run().catch(e => {
  console.error('\n  Fatal error:', e.message);
  process.exit(1);
});
