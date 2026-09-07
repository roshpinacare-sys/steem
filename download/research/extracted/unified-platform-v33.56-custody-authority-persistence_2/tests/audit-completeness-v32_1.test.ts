import assert from 'node:assert/strict';
import test from 'node:test';
import { createAuditEvent, probeAuditCompleteness, type AuditEvent, type AuditEventKind } from '../src/platform/audit-completeness.js';
import { sha256 } from '../src/contracts/crypto.js';

function chain(kinds: readonly AuditEventKind[], operationId = 'op-1'): AuditEvent[] {
  const rows: AuditEvent[] = [];
  for (const [index, kind] of kinds.entries()) {
    rows.push(createAuditEvent({
      sequence: index + 1,
      eventId: `event-${index + 1}`,
      operationId,
      tenantId: 'tenant-1',
      actorId: kind === 'AUTHORIZED' ? 'reviewer-1' : 'agent-1',
      kind,
      occurredAt: new Date(Date.parse('2026-07-18T00:00:00Z') + index * 1000).toISOString(),
      payloadDigest: sha256({ kind, index }),
      previousDigest: rows.at(-1)?.digest ?? null,
    }));
  }
  return rows;
}

const expected = [{ operationId: 'op-1', tenantId: 'tenant-1', actorId: 'agent-1', sideEffecting: true }] as const;

test('complete side-effect audit chain passes with full coverage', () => {
  const result = probeAuditCompleteness(expected, chain(['REQUESTED', 'AUTHORIZED', 'STARTED', 'SIDE_EFFECT_RECEIPT', 'COMPLETED']));
  assert.equal(result.status, 'PASS');
  assert.equal(result.coverage, 1);
  assert.equal(result.completeOperationCount, 1);
});

test('missing receipt and terminal events block', () => {
  const result = probeAuditCompleteness(expected, chain(['REQUESTED', 'AUTHORIZED', 'STARTED']));
  assert.equal(result.status, 'BLOCK');
  assert.ok(result.findings.some((finding) => finding.code === 'MISSING_SIDE_EFFECT_RECEIPT'));
  assert.ok(result.findings.some((finding) => finding.code === 'TERMINAL_EVENT_INVALID'));
});

test('tampering, orphan events and tenant mismatch are detected', () => {
  const rows = chain(['REQUESTED', 'AUTHORIZED', 'STARTED', 'SIDE_EFFECT_RECEIPT', 'COMPLETED']);
  const tampered = { ...rows[2]!, tenantId: 'tenant-2' };
  const orphan = createAuditEvent({ sequence: 6, eventId: 'orphan', operationId: 'unknown', tenantId: 'tenant-1', actorId: 'agent-1', kind: 'COMPLETED', occurredAt: '2026-07-18T00:00:06Z', payloadDigest: sha256('orphan'), previousDigest: rows.at(-1)!.digest });
  const result = probeAuditCompleteness(expected, [rows[0]!, rows[1]!, tampered, rows[3]!, rows[4]!, orphan]);
  assert.ok(result.findings.some((finding) => finding.code === 'EVENT_DIGEST_INVALID'));
  assert.ok(result.findings.some((finding) => finding.code === 'TENANT_MISMATCH'));
  assert.ok(result.findings.some((finding) => finding.code === 'ORPHAN_EVENT'));
});

test('duplicate expected operations and invalid event material fail closed', () => {
  assert.throws(() => probeAuditCompleteness([...expected, ...expected], []), /duplicate/);
  assert.throws(() => createAuditEvent({ sequence: 0, eventId: 'x', operationId: 'x', tenantId: 't', actorId: 'a', kind: 'REQUESTED', occurredAt: 'bad', payloadDigest: 'x', previousDigest: null }), /sequence_invalid/);
});
