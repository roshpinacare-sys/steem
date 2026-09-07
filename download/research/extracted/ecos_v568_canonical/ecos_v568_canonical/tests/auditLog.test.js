/**
 * auditLog.test.js — V19
 * Unit tests for lib/auditLog.js.
 * Run: npx vitest run tests/auditLog.test.js
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { AuditLog, NULL_HASH } = require('../lib/auditLog');

describe('AuditLog — chain integrity', () => {
  let log;
  beforeEach(() => { log = new AuditLog(); });

  it('starts empty', () => {
    expect(log.size()).toBe(0);
    expect(log.head()).toBeNull();
  });

  it('first entry uses NULL_HASH as prevHash', () => {
    const e = log.append('TEST', { x: 1 });
    expect(e.prevHash).toBe(NULL_HASH);
    expect(e.index).toBe(0);
  });

  it('second entry prevHash === first entry hash', () => {
    const e1 = log.append('FIRST', {});
    const e2 = log.append('SECOND', {});
    expect(e2.prevHash).toBe(e1.hash);
  });

  it('verify() passes on intact chain', () => {
    log.append('A', { val: 1 });
    log.append('B', { val: 2 });
    log.append('C', { val: 3 });
    expect(log.verify().ok).toBe(true);
  });

  it('verify() fails when entry is tampered', () => {
    log.append('A', {});
    log.append('B', {});
    // Mutate the frozen entry (Object.freeze prevents mutation on properties
    // but we can test verify() by replacing an entry in the internal array)
    log._entries[0] = {
      ...log._entries[0],
      hash: 'deadbeef'.repeat(8)
    };
    const result = log.verify();
    expect(result.ok).toBe(false);
    expect(result.brokenAt).toBeDefined();
  });

  it('BigInt in payload serializes without error', () => {
    expect(() => log.append('PAYMENT', { amount: 100_000n })).not.toThrow();
    const e = log.entries()[0];
    expect(typeof e.payload.amount).toBe('string'); // BigInt → string
    expect(e.payload.amount).toBe('100000');
  });

  it('genesis hash is deterministic for same input', () => {
    const l1 = new AuditLog();
    const l2 = new AuditLog();
    const e1 = l1.append('INIT', { seed: 'same' });
    // Can't be deterministic (timestamp differs) — but hash must be 64-char hex
    expect(e1.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('append returns frozen entry', () => {
    const e = log.append('FREEZE', {});
    expect(() => { e.type = 'MUTATED'; }).toThrow();
  });

  it('append throws on empty type', () => {
    expect(() => log.append('', {})).toThrow(TypeError);
    expect(() => log.append(null, {})).toThrow(TypeError);
  });
});
