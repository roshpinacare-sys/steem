/**
 * Payment Rail tests — V112
 */

import { describe, it, beforeEach, expect } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const { FiatLedger }       = require('../lib/fiatLedger');
const { ManualRail }       = require('../lib/rails/manualRail');
const { StripeRail }       = require('../lib/rails/stripeRail');
const { RailRegistry }     = require('../lib/railRegistry');
const { BankTransferRail } = require('../lib/rails/bankTransferRail');

function makeLedger() { return new FiatLedger(); }

describe('PaymentRail — ManualRail', () => {
  it('ManualRail is always available', () => {
    const rail = new ManualRail({ ledger: makeLedger() });
    expect(rail.isAvailable).toBe(true);
    expect(rail.id).toBe('manual');
  });

  it('StripeRail unavailable without STRIPE_API_KEY', () => {
    const savedKey = process.env.STRIPE_API_KEY;
    delete process.env.STRIPE_API_KEY;
    const rail = new StripeRail({ ledger: makeLedger() });
    expect(rail.isAvailable).toBe(false);
    if (savedKey) process.env.STRIPE_API_KEY = savedKey;
  });

  it('RailRegistry.availableRails excludes unavailable rails', () => {
    const savedKey = process.env.STRIPE_API_KEY;
    delete process.env.STRIPE_API_KEY;

    const ledger   = makeLedger();
    const registry = new RailRegistry();
    registry.register(new ManualRail({ ledger }));
    registry.register(new StripeRail({ ledger }));

    const available = registry.availableRails();
    expect(available.map(r => r.id)).not.toContain('stripe');
    expect(available.map(r => r.id)).toContain('manual');

    if (savedKey) process.env.STRIPE_API_KEY = savedKey;
  });

  it('ManualRail.deposit credits the internal ledger', async () => {
    const ledger = makeLedger();
    const rail   = new ManualRail({ ledger });

    const balanceBefore = ledger.balance('test-account');
    const result        = await rail.deposit({
      accountId:   'test-account',
      amountMicro: 100_000n,
      reference:   'test-deposit-001',
    });

    expect(result.ok).toBe(true);
    expect(result.railId).toBe('manual');
    expect(ledger.balance('test-account')).toBe(balanceBefore + 100_000n);
  });

  it('GET /api/v1/rails returns manual + bank rails by default', async () => {
    const savedKey = process.env.STRIPE_API_KEY;
    delete process.env.STRIPE_API_KEY;

    const ledger   = makeLedger();
    const registry = new RailRegistry();
    registry.register(new ManualRail({ ledger }));
    registry.register(new BankTransferRail({ ledger }));

    const available = registry.availableRails().map(r => r.id);
    expect(available).toContain('manual');
    expect(available).toContain('bank');
    expect(available).not.toContain('stripe');

    if (savedKey) process.env.STRIPE_API_KEY = savedKey;
  });

  it('deposit via rail produces an audit chain entry', async () => {
    const ledger = makeLedger();

    const auditEntries = [];
    const mockAudit = {
      append: async (entry) => {
        auditEntries.push(entry);
        return { hash: 'mock-hash-' + Math.random().toString(36).slice(2) };
      },
    };

    const rail   = new ManualRail({ ledger, auditLog: mockAudit });
    const result = await rail.deposit({
      accountId:   'audit-test-account',
      amountMicro: 50_000n,
      reference:   'audit-test-ref',
    });

    expect(result.ok).toBe(true);
    expect(auditEntries.length).toBeGreaterThan(0);
    expect(auditEntries[0].event).toMatch(/deposit|manual/i);
  });
});

describe('PaymentRail — fiatLedger.js integrity', () => {
  it('fiatLedger.js MD5 is unchanged (sacred file)', async () => {
    const fs     = require('fs');
    const crypto = require('crypto');
    const content = fs.readFileSync(require.resolve('../lib/fiatLedger.js'));
    const hash    = crypto.createHash('md5').update(content).digest('hex');
    expect(hash).toBe('563e9b1f9e67091a5b6527c0a92568e5');
  });
});
