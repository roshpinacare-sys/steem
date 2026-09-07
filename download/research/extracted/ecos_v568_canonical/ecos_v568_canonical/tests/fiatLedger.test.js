/**
 * fiatLedger.test.js — V19
 * Unit tests for lib/fiatLedger.js.
 * Run: npx vitest run tests/fiatLedger.test.js
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { FiatLedger, SYSTEM_ACCOUNTS, usdToMicrocents, microcentsToUsdString } = require('../lib/fiatLedger');

describe('FiatLedger — core invariants', () => {
  let ledger;
  beforeEach(() => { ledger = new FiatLedger(); });

  it('starts with zero balance for unknown accounts', () => {
    expect(ledger.balance('client::x')).toBe(0n);
  });

  it('credit increases balance by exact amount', () => {
    ledger.ensureAccount('client::a');
    ledger.credit('client::a', 10_000n);
    expect(ledger.balance('client::a')).toBe(10_000n);
  });

  it('debit decreases balance by exact amount', () => {
    ledger.ensureAccount('client::a');
    ledger.credit('client::a', 10_000n);
    ledger.debit('client::a', 4_000n);
    expect(ledger.balance('client::a')).toBe(6_000n);
  });

  it('debit throws on insufficient balance', () => {
    ledger.ensureAccount('client::a');
    ledger.credit('client::a', 100n);
    expect(() => ledger.debit('client::a', 101n)).toThrow();
  });

  it('distributeTaskPayment — sum === gross (no rounding loss)', () => {
    const clientId = 'client::test';
    const validatorId = 'validator::v1';
    ledger.ensureAccount(clientId);
    ledger.ensureAccount(validatorId);
    ledger.ensureAccount(SYSTEM_ACCOUNTS.PLATFORM);
    ledger.ensureAccount(SYSTEM_ACCOUNTS.INSURANCE);
    ledger.credit(clientId, 100_000n);

    const result = ledger.distributeTaskPayment({
      clientAccountId: clientId,
      validatorAccountId: validatorId,
      grossAmountUsd: '10.00',
    });

    expect(result.platform + result.validator + result.insurance).toBe(result.gross);
  });

  it('distributeTaskPayment — 40/40/20 split is correct', () => {
    const clientId = 'client::test';
    const validatorId = 'validator::v1';
    ledger.ensureAccount(clientId);
    ledger.ensureAccount(validatorId);
    ledger.ensureAccount(SYSTEM_ACCOUNTS.PLATFORM);
    ledger.ensureAccount(SYSTEM_ACCOUNTS.INSURANCE);
    ledger.credit(clientId, 1_000_000n);  // $100

    const result = ledger.distributeTaskPayment({
      clientAccountId: clientId,
      validatorAccountId: validatorId,
      grossAmountUsd: '100.00',
    });

    const gross = result.gross;
    expect(result.platform).toBe((gross * 40n) / 100n);
    expect(result.validator).toBe((gross * 40n) / 100n);
    // insurance = remainder (≥ 20%)
    expect(result.insurance).toBeGreaterThanOrEqual((gross * 20n) / 100n);
  });

  it('distributeAutoFlowPayment — validator leg is 0', () => {
    const clientId = 'client::auto';
    ledger.ensureAccount(clientId);
    ledger.ensureAccount(SYSTEM_ACCOUNTS.PLATFORM);
    ledger.ensureAccount(SYSTEM_ACCOUNTS.INSURANCE);
    ledger.credit(clientId, 100_000n);

    const result = ledger.distributeAutoFlowPayment({
      clientAccountId: clientId,
      grossAmountUsd: '10.00',
    });

    expect(result.validator).toBe(0n);
    expect(result.platform + result.insurance).toBe(result.gross);
  });

  it('usdToMicrocents converts correctly', () => {
    expect(usdToMicrocents('10.00')).toBe(100_000n);
    expect(usdToMicrocents('0.01')).toBe(100n);
  });

  it('microcentsToUsdString formats correctly', () => {
    expect(microcentsToUsdString(100_000n)).toBe('10.0000');
    expect(microcentsToUsdString(1n)).toBe('0.0001');
  });

  it('credit throws on zero or negative amount', () => {
    ledger.ensureAccount('client::x');
    expect(() => ledger.credit('client::x', 0n)).toThrow();
    expect(() => ledger.credit('client::x', -1n)).toThrow();
  });
});
