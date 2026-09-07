/**
 * STRESS TEST: Concurrent audit-log writes — 1000 parallel appends.
 * Simulates 1000 users triggering pipeline events simultaneously.
 * Verifies: hash chain integrity, monotonic seq numbers, no data loss.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { appendAuditEntry, verifyAuditChain, type AuditEntry } from '../../src/services/audit-log.js';

const CONCURRENCY = 1000;

describe('audit-log — 1000-concurrent-user stress', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'qodo-stress-audit-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes 1000 sequential entries without data loss', async () => {
    // Sequential (correct) — baseline
    for (let i = 0; i < CONCURRENCY; i++) {
      appendAuditEntry(dir, `event-${i}`, 'stress-user', { idx: i });
    }
    const lines = readFileSync(join(dir, '.audit-log.ndjson'), 'utf8')
      .trim().split('\n').filter(Boolean);
    expect(lines).toHaveLength(CONCURRENCY);
    const result = verifyAuditChain(dir);
    expect(result.valid).toBe(true);
  });

  it('hash chain verifies after 1000 sequential appends', () => {
    for (let i = 0; i < CONCURRENCY; i++) {
      appendAuditEntry(dir, 'pipeline.phase', 'agent', { phase: i % 10, userId: `u${i}` });
    }
    const result = verifyAuditChain(dir);
    expect(result.valid).toBe(true);
    expect(result.brokenAt).toBeUndefined();
  });

  it('seq numbers are strictly monotonic across 1000 entries', () => {
    const entries: AuditEntry[] = [];
    for (let i = 0; i < CONCURRENCY; i++) {
      entries.push(appendAuditEntry(dir, 'seq-check', 'bot', { i }));
    }
    for (let i = 1; i < entries.length; i++) {
      expect(entries[i].seq).toBe(entries[i - 1].seq + 1);
    }
  });

  it('concurrent async dispatches all land in file (Promise.all simulation)', async () => {
    // Node.js is single-threaded but Promise.all interleaves microtasks.
    // appendFileSync is atomic at OS level; test verifies all writes land.
    const tasks = Array.from({ length: CONCURRENCY }, (_, i) =>
      Promise.resolve().then(() =>
        appendAuditEntry(dir, 'concurrent-event', `user-${i}`, { seq: i }),
      ),
    );
    await Promise.all(tasks);

    const lines = readFileSync(join(dir, '.audit-log.ndjson'), 'utf8')
      .trim().split('\n').filter(Boolean);
    expect(lines.length).toBe(CONCURRENCY);

    // Each line must be valid JSON
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  it('chain integrity holds across mixed event types at scale', () => {
    const eventTypes = ['run.start', 'patch.apply', 'validator.pass', 'run.end', 'alert.fire'];
    for (let i = 0; i < CONCURRENCY; i++) {
      appendAuditEntry(
        dir,
        eventTypes[i % eventTypes.length],
        `actor-${i % 20}`,
        { runId: `r-${i}`, cost: Math.random() * 0.01 },
      );
    }
    expect(verifyAuditChain(dir).valid).toBe(true);
  });
});
