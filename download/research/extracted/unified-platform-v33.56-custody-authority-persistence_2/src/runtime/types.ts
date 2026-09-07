export type MissionState =
  | 'CREATED'
  | 'WAITING_APPROVAL'
  | 'READY'
  | 'EFFECT_PENDING'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'FAILED';

export interface MissionRequest {
  readonly missionId: string;
  readonly tenantId: string;
  readonly subjectId: string;
  readonly builderId: string;
  readonly scope: string;
  readonly effectKey: string;
  readonly approvalRequired: boolean;
}

export interface MissionRow extends MissionRequest {
  readonly state: MissionState;
  readonly revision: number;
  readonly approvalStatus: 'NOT_REQUIRED' | 'PENDING' | 'APPROVED';
  readonly leaseOwner: string | null;
  readonly leaseUntil: number | null;
  readonly fenceToken: number;
  readonly cancelled: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface Lease {
  readonly missionId: string;
  readonly workerId: string;
  readonly fenceToken: number;
  readonly expiresAt: number;
}

export interface OutboxRow {
  readonly outboxId: string;
  readonly missionId: string;
  readonly tenantId: string;
  readonly effectKey: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly status: 'PENDING' | 'DELIVERED';
  readonly attemptCount: number;
  readonly fenceToken: number;
  readonly createdAt: string;
  readonly deliveredAt: string | null;
}

export interface EffectReceipt {
  readonly effectKey: string;
  readonly tenantId: string;
  readonly payloadDigest: string;
  readonly result: Readonly<Record<string, unknown>>;
  readonly appliedAt: string;
}

export interface EventRow {
  readonly sequence: number;
  readonly missionId: string;
  readonly tenantId: string;
  readonly type: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
  readonly previousDigest: string | null;
  readonly digest: string;
}
