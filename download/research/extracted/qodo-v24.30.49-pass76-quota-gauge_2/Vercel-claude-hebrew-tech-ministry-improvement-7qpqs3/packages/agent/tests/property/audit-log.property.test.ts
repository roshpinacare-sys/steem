/**
 * Property-based tests for audit log hash chain.
 * Verifies append-only integrity under arbitrary event sequences.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { appendAuditEntry, verifyAuditChain } from '../../src/services/audit-log.js';

describe('audit-log hash chain — property-based', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'qodo-audit-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('chain is always valid after N sequential appends', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            event: fc.string({ minLength: 1, maxLength: 30 }),
            actor: fc.string({ minLength: 1, maxLength: 20 }),
            payload: fc.dictionary(
              fc.string({ minLength: 1, maxLength: 10 }),
              fc.string({ minLength: 0, maxLength: 20 }),
            ),
          }),
          { minLength: 1, maxLength: 20 },
        ),
        (entries) => {
          // Create fresh dir per property run
          const dir = mkdtempSync(join(tmpdir(), 'qodo-prop-'));
          try {
            for (const e of entries) {
              appendAuditEntry(dir, e.event, e.actor, e.payload as Record<string, unknown>);
            }
            const result = verifyAuditChain(dir);
            expect(result.valid).toBe(true);
            expect(result.brokenAt).toBeUndefined();
          } finally {
            rmSync(dir, { recursive: true, force: true });
          }
        },
      ),
    );
  });

  it('sequential numbers are monotonically increasing', () => {
    const entries: ReturnType<typeof appendAuditEntry>[] = [];
    for (let i = 0; i < 5; i++) {
      entries.push(appendAuditEntry(tmpDir, `event-${i}`, 'test', {}));
    }
    for (let i = 1; i < entries.length; i++) {
      expect(entries[i].seq).toBe(entries[i - 1].seq + 1);
    }
  });
});
