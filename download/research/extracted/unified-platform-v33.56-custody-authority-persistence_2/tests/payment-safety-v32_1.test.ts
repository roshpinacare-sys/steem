import assert from 'node:assert/strict';
import test from 'node:test';
import { PaymentSafetyLedger, type PaymentEventKind } from '../src/platform/payment-safety.js';

const intent = { intentId: 'pay-1', tenantId: 'tenant-1', amountMinor: 12500, currency: 'ILS', providerId: 'provider-1' };
function event(kind: PaymentEventKind, sequence: number) { return { providerEventId: `provider-${sequence}`, idempotencyKey: `idem-${sequence}`, intentId: intent.intentId, tenantId: intent.tenantId, providerId: intent.providerId, kind, amountMinor: intent.amountMinor, currency: intent.currency, signatureVerified: true, observedAt: new Date(Date.parse('2026-07-18T00:00:00Z') + sequence * 1000).toISOString() }; }

test('provider-neutral payment safety state machine enforces ordered settlement', () => {
  const ledger = new PaymentSafetyLedger(); ledger.create(intent);
  assert.equal(ledger.apply(event('AUTHORIZE', 1)).state, 'AUTHORIZED');
  assert.equal(ledger.apply(event('CAPTURE', 2)).state, 'CAPTURED');
  assert.equal(ledger.apply(event('SETTLE', 3)).state, 'SETTLED');
  assert.equal(ledger.reconcile(intent.intentId, intent.amountMinor).status, 'MATCH');
  assert.equal(ledger.apply(event('REFUND', 4)).state, 'REFUNDED');
});

test('invalid order, unsigned webhook and authority mismatch fail closed', () => {
  const ledger = new PaymentSafetyLedger(); ledger.create(intent);
  assert.throws(() => ledger.apply(event('SETTLE', 1)), /transition_invalid/);
  assert.throws(() => ledger.apply({ ...event('AUTHORIZE', 2), signatureVerified: false }), /signature_unverified/);
  assert.throws(() => ledger.apply({ ...event('AUTHORIZE', 3), tenantId: 'other' }), /boundary_mismatch/);
});

test('provider event and idempotency collisions are detected', () => {
  const ledger = new PaymentSafetyLedger(); ledger.create(intent);
  const first = event('AUTHORIZE', 1); ledger.apply(first);
  assert.equal(ledger.apply(first).state, 'AUTHORIZED');
  assert.throws(() => ledger.apply({ ...event('CAPTURE', 2), providerEventId: first.providerEventId }), /provider_event_conflict/);
  assert.throws(() => ledger.apply({ ...event('CAPTURE', 2), idempotencyKey: first.idempotencyKey }), /idempotency_conflict/);
});

test('reconciliation exposes exact mismatch without hiding it', () => {
  const ledger = new PaymentSafetyLedger(); ledger.create(intent); ledger.apply(event('AUTHORIZE', 1)); ledger.apply(event('CAPTURE', 2)); ledger.apply(event('SETTLE', 3));
  const result = ledger.reconcile(intent.intentId, 12000);
  assert.equal(result.status, 'MISMATCH');
  assert.equal(result.deltaMinor, -500);
});
