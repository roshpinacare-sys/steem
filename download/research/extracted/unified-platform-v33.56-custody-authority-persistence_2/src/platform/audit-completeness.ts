import { sha256 } from '../contracts/crypto.js';

export type AuditEventKind = 'REQUESTED' | 'AUTHORIZED' | 'STARTED' | 'SIDE_EFFECT_RECEIPT' | 'COMPLETED' | 'FAILED' | 'ROLLED_BACK';

export interface AuditEvent {
  readonly sequence: number;
  readonly eventId: string;
  readonly operationId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly kind: AuditEventKind;
  readonly occurredAt: string;
  readonly payloadDigest: string;
  readonly previousDigest: string | null;
  readonly digest: string;
}

export interface ExpectedAuditedOperation {
  readonly operationId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly sideEffecting: boolean;
  readonly requiredKinds?: readonly AuditEventKind[];
}

export interface AuditCompletenessResult {
  readonly status: 'PASS' | 'BLOCK';
  readonly eventCount: number;
  readonly operationCount: number;
  readonly completeOperationCount: number;
  readonly coverage: number;
  readonly root: string | null;
  readonly findings: readonly { readonly code: string; readonly operationId?: string; readonly eventId?: string }[];
  readonly resultDigest: string;
}

export function createAuditEvent(input: Omit<AuditEvent, 'digest'>): AuditEvent {
  validateEventMaterial(input);
  return { ...input, digest: sha256(input) };
}

/** ECOS-derived audit-completeness behavior, reimplemented against canonical contracts. */
export function probeAuditCompleteness(expected: readonly ExpectedAuditedOperation[], events: readonly AuditEvent[]): AuditCompletenessResult {
  const findings: Array<{ code: string; operationId?: string; eventId?: string }> = [];
  const operationIds = new Set<string>();
  for (const operation of expected) {
    if (operation.operationId.trim() === '' || operation.tenantId.trim() === '' || operation.actorId.trim() === '') throw new Error('audit_expected_operation_invalid');
    if (operationIds.has(operation.operationId)) throw new Error(`audit_expected_operation_duplicate:${operation.operationId}`);
    operationIds.add(operation.operationId);
  }

  let previous: string | null = null;
  const eventIds = new Set<string>();
  const byOperation = new Map<string, AuditEvent[]>();
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (event === undefined) continue;
    try { validateEventMaterial(event); } catch { findings.push({ code: 'EVENT_INVALID', eventId: event.eventId }); }
    if (event.sequence !== index + 1) findings.push({ code: 'SEQUENCE_GAP', eventId: event.eventId });
    if (event.previousDigest !== previous) findings.push({ code: 'CHAIN_BROKEN', eventId: event.eventId });
    const { digest: _digest, ...material } = event;
    if (sha256(material) !== event.digest) findings.push({ code: 'EVENT_DIGEST_INVALID', eventId: event.eventId });
    if (eventIds.has(event.eventId)) findings.push({ code: 'EVENT_ID_DUPLICATE', eventId: event.eventId });
    eventIds.add(event.eventId);
    previous = event.digest;
    if (!operationIds.has(event.operationId)) findings.push({ code: 'ORPHAN_EVENT', operationId: event.operationId, eventId: event.eventId });
    const bucket = byOperation.get(event.operationId) ?? [];
    bucket.push(event);
    byOperation.set(event.operationId, bucket);
  }

  let completeOperationCount = 0;
  for (const operation of expected) {
    const rows = byOperation.get(operation.operationId) ?? [];
    const required = operation.requiredKinds ?? (operation.sideEffecting
      ? ['REQUESTED', 'AUTHORIZED', 'STARTED', 'SIDE_EFFECT_RECEIPT', 'COMPLETED']
      : ['REQUESTED', 'AUTHORIZED', 'STARTED', 'COMPLETED']);
    let complete = true;
    for (const kind of required) {
      if (!rows.some((event) => event.kind === kind)) {
        findings.push({ code: `MISSING_${kind}`, operationId: operation.operationId });
        complete = false;
      }
    }
    if (rows.some((event) => event.tenantId !== operation.tenantId)) { findings.push({ code: 'TENANT_MISMATCH', operationId: operation.operationId }); complete = false; }
    if (rows.some((event) => event.actorId !== operation.actorId && event.kind !== 'AUTHORIZED')) { findings.push({ code: 'ACTOR_MISMATCH', operationId: operation.operationId }); complete = false; }
    const terminal = rows.filter((event) => event.kind === 'COMPLETED' || event.kind === 'FAILED' || event.kind === 'ROLLED_BACK');
    if (terminal.length !== 1) { findings.push({ code: 'TERMINAL_EVENT_INVALID', operationId: operation.operationId }); complete = false; }
    if (complete) completeOperationCount += 1;
  }

  const material = {
    status: findings.length === 0 ? 'PASS' as const : 'BLOCK' as const,
    eventCount: events.length,
    operationCount: expected.length,
    completeOperationCount,
    coverage: expected.length === 0 ? 1 : Number((completeOperationCount / expected.length).toFixed(6)),
    root: previous,
    findings: findings.sort((a, b) => `${a.operationId ?? ''}:${a.eventId ?? ''}:${a.code}`.localeCompare(`${b.operationId ?? ''}:${b.eventId ?? ''}:${b.code}`)),
  };
  return { ...material, resultDigest: sha256(material) };
}

function validateEventMaterial(event: Omit<AuditEvent, 'digest'> | AuditEvent): void {
  if (!Number.isSafeInteger(event.sequence) || event.sequence < 1) throw new Error('audit_event_sequence_invalid');
  if (event.eventId.trim() === '' || event.operationId.trim() === '' || event.tenantId.trim() === '' || event.actorId.trim() === '') throw new Error('audit_event_identity_invalid');
  if (!Number.isFinite(Date.parse(event.occurredAt))) throw new Error('audit_event_time_invalid');
  if (!/^[a-f0-9]{64}$/.test(event.payloadDigest)) throw new Error('audit_payload_digest_invalid');
  if (event.previousDigest !== null && !/^[a-f0-9]{64}$/.test(event.previousDigest)) throw new Error('audit_previous_digest_invalid');
}
