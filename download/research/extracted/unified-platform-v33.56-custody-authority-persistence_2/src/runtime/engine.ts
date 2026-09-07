import { authorityAllows, validateAuthorityGrant, type EvidenceRecord, type SignedAuthorityGrant } from '../contracts/canonical.js';
import { KeyRegistry } from '../contracts/crypto.js';
import { SqliteRuntimeStore } from './sqlite-store.js';
import type { EffectReceipt, Lease, MissionRequest, MissionRow, OutboxRow } from './types.js';

export type EffectExecutor = (
  payload: Readonly<Record<string, unknown>>,
) => Promise<Readonly<Record<string, unknown>>> | Readonly<Record<string, unknown>>;

export class DurableRuntimeEngine {
  constructor(
    readonly store: SqliteRuntimeStore,
    readonly keyRegistry: KeyRegistry,
  ) {}

  createAuthorizedMission(
    signedGrant: SignedAuthorityGrant,
    request: MissionRequest,
    now = new Date(),
  ): MissionRow {
    if (!this.keyRegistry.verify(signedGrant)) throw new Error('grant_signature_invalid');
    validateAuthorityGrant(signedGrant.payload, now);
    if (!authorityAllows(signedGrant.payload, {
      tenantId: request.tenantId,
      subjectId: request.subjectId,
      scope: request.scope,
    }, now)) {
      throw new Error('authority_denied');
    }
    return this.store.createMission(request, now);
  }

  acquire(missionId: string, workerId: string, ttlMs = 30_000, nowMs = Date.now()): Lease {
    return this.store.acquireLease(missionId, workerId, ttlMs, nowMs);
  }

  prepare(lease: Lease, payload: Readonly<Record<string, unknown>>, nowMs = Date.now()): OutboxRow | null {
    return this.store.prepareOutbox(lease, payload, nowMs);
  }

  approve(missionId: string, reviewerId: string, expectedRevision: number, now = new Date()): MissionRow {
    return this.store.approveMission(missionId, reviewerId, expectedRevision, now);
  }

  async execute(
    outbox: OutboxRow,
    lease: Lease,
    executor: EffectExecutor,
    options: { crashAfterEffect?: boolean; now?: Date } = {},
  ): Promise<EffectReceipt> {
    let receipt: EffectReceipt;
    try {
      receipt = this.store.getEffect(outbox.effectKey);
    } catch {
      const result = await executor(outbox.payload);
      receipt = this.store.recordEffect(outbox.outboxId, lease, result, options.now ?? new Date());
    }
    if (options.crashAfterEffect === true) throw new Error('injected_crash_after_effect');
    this.store.acknowledgeOutbox(outbox.outboxId, lease, options.now ?? new Date());
    return receipt;
  }

  appendEvidence(record: EvidenceRecord): string {
    return this.store.appendEvidence(record);
  }
}
