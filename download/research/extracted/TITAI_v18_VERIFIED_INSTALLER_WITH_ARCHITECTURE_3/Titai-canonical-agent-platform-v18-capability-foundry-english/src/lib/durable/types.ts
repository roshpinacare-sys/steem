export type DurableJobStatus =
  | "queued"
  | "leased"
  | "completed"
  | "failed"
  | "cancelled"
  | "needs_reconciliation";

export type ReceiptStatus = "started" | "completed" | "failed" | "unknown";

export interface DurableCheckpoint {
  nextStepIndex: number;
  outputs: Record<string, unknown>;
  completedStepIds: string[];
  revision: number;
}

export interface DurableLease {
  owner: string;
  token: number;
  acquiredAt: string;
  expiresAt: string;
  heartbeatAt: string;
}

export interface DurableJob<TPayload = unknown, TResult = unknown> {
  id: string;
  tenantId?: string;
  workspaceId?: string;
  workflowName: string;
  payload: TPayload;
  status: DurableJobStatus;
  checkpoint: DurableCheckpoint;
  result?: TResult;
  error?: string;
  attempt: number;
  maxAttempts: number;
  availableAt: string;
  lease?: DurableLease;
  createdAt: string;
  updatedAt: string;
}

export interface SideEffectReceipt {
  key: string;
  tenantId?: string;
  workspaceId?: string;
  jobId: string;
  stepId: string;
  operation: string;
  inputHash: string;
  status: ReceiptStatus;
  output?: unknown;
  error?: string;
  startedAt: string;
  completedAt?: string;
  workerId: string;
}

export interface DurableSnapshot {
  schemaVersion: 1;
  exportedAt: string;
  jobs: DurableJob[];
  receipts: SideEffectReceipt[];
}

export interface DurableStore {
  createJob<TPayload>(job: DurableJob<TPayload>): Promise<void>;
  getJob<TPayload = unknown, TResult = unknown>(
    jobId: string,
  ): Promise<DurableJob<TPayload, TResult> | undefined>;
  listJobs(): Promise<DurableJob[]>;
  claimJob(
    jobId: string,
    workerId: string,
    now: Date,
    leaseMs: number,
  ): Promise<DurableJob | undefined>;
  heartbeat(
    jobId: string,
    workerId: string,
    leaseToken: number,
    now: Date,
    leaseMs: number,
  ): Promise<boolean>;
  updateCheckpoint(
    jobId: string,
    workerId: string,
    leaseToken: number,
    checkpoint: DurableCheckpoint,
    now: Date,
  ): Promise<void>;
  completeJob(
    jobId: string,
    workerId: string,
    leaseToken: number,
    result: unknown,
    now: Date,
  ): Promise<void>;
  failJob(
    jobId: string,
    workerId: string,
    leaseToken: number,
    error: string,
    now: Date,
  ): Promise<void>;
  markNeedsReconciliation(
    jobId: string,
    workerId: string,
    leaseToken: number,
    error: string,
    now: Date,
  ): Promise<void>;
  releaseJob(
    jobId: string,
    workerId: string,
    leaseToken: number,
    now: Date,
    delayMs?: number,
  ): Promise<void>;
  getReceipt(key: string): Promise<SideEffectReceipt | undefined>;
  startReceipt(receipt: SideEffectReceipt): Promise<"created" | "exists">;
  completeReceipt(key: string, output: unknown, now: Date): Promise<void>;
  failReceipt(key: string, error: string, now: Date): Promise<void>;
  snapshot(now?: Date): Promise<DurableSnapshot>;
  restore(snapshot: DurableSnapshot): Promise<void>;
}

export interface DurableStepContext<TPayload = unknown> {
  jobId: string;
  workerId: string;
  leaseToken: number;
  payload: TPayload;
  outputs: Readonly<Record<string, unknown>>;
  signal: AbortSignal;
}

export interface DurableStep<TPayload = unknown> {
  id: string;
  operation: string;
  kind: "pure" | "idempotent" | "side_effect";
  run(context: DurableStepContext<TPayload>): Promise<unknown>;
  idempotencyInput?(context: DurableStepContext<TPayload>): unknown;
}

export interface DurableWorkflow<TPayload = unknown, TResult = unknown> {
  name: string;
  steps: readonly DurableStep<TPayload>[];
  buildResult(
    outputs: Readonly<Record<string, unknown>>,
    payload: TPayload,
  ): TResult;
}

export type FaultPoint =
  | "after_claim"
  | "before_step"
  | "after_receipt_started"
  | "after_idempotent_step"
  | "after_side_effect"
  | "after_checkpoint"
  | "before_complete";

export interface FaultContext {
  point: FaultPoint;
  jobId: string;
  stepId?: string;
  workerId: string;
}

export type FaultInjector = (context: FaultContext) => void | Promise<void>;

export class DurablePauseError extends Error {
  constructor(public readonly reason: string, public readonly retryAfterMs = 24 * 60 * 60 * 1000) {
    super(`durable_paused:${reason}`);
    this.name = "DurablePauseError";
  }
}

export interface DurableRunOptions {
  workerId: string;
  leaseMs?: number;
  now?: () => Date;
  signal?: AbortSignal;
  faultInjector?: FaultInjector;
}

export type DurableRunOutcome =
  | { status: "completed"; job: DurableJob }
  | { status: "lease_unavailable" }
  | { status: "waiting"; job: DurableJob; reason: string }
  | { status: "needs_reconciliation"; job: DurableJob; error: string }
  | { status: "failed"; job: DurableJob; error: string };
