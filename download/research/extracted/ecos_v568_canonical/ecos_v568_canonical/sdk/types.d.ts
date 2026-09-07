/**
 * @ecos/client — TypeScript type definitions [V103-P3]
 */

export interface EcosClientOptions {
  baseUrl: string;
  depositApiKey?: string;
  validatorJwt?: string;
  timeoutMs?: number;
}

// ─── Task / Chat ─────────────────────────────────────────────────────────────

export interface SubmitTaskParams {
  clientAccountId: string;
  priceUsd: string;
  rawConfidence: number;
  aiOutput: Record<string, unknown>;
  taskType?: string;
  idempotencyKey?: string;
}

export interface TaskResult {
  verdict: 'AUTO_FLOW' | 'HITL_QUEUE' | 'BLOCK' | 'HARD_REJECT';
  approvalId: string;
  missionId: string;
}

export interface ChatParams {
  text: string;
  clientAccountId: string;
  priceUsd: string;
}

export interface ChatResult {
  verdict: 'AUTO_FLOW' | 'HITL_QUEUE' | 'BLOCK' | 'HARD_REJECT';
  approvalId: string;
  aiResponse: string;
  confidence: number | null;
}

// ─── Approvals ────────────────────────────────────────────────────────────────

export interface ListApprovalsOptions {
  status?: 'pending' | 'approved' | 'all';
  limit?: number;
}

export interface Approval {
  id: string;
  missionId: string;
  clientAccountId: string;
  status: 'pending' | 'approved' | 'rejected';
  priceUsd: string;
  confidence: number | null;
  autoFlow: boolean;
  createdAt: string;
  resolvedAt?: string;
}

export interface ListApprovalsResult {
  approvals: Approval[];
  count: number;
}

export interface ResolveApprovalParams {
  validatorAccountId: string;
  decision: 'approve' | 'reject';
  note?: string;
}

export interface ResolveApprovalResult {
  approval: Approval;
  receipt: Record<string, unknown>;
}

export interface BulkResolveItem {
  id: string;
  decision: 'approve' | 'reject';
  validatorAccountId: string;
  note?: string;
}

// ─── Missions ─────────────────────────────────────────────────────────────────

export interface TopClient {
  clientAccountId: string;
  missionCount: number;
}

export interface MissionDashboard {
  totalMissions: number;
  pending: number;
  approved: number;
  rejected: number;
  blocked: number;
  autoFlow: number;
  hitlQueue: number;
  avgConfidence: number | null;
  chainIntact: boolean;
  topClients: TopClient[];
  generatedAt: string;
  ecosVersion: string;
}

export interface SearchMissionsOptions {
  q?: string;
  status?: string;
  clientId?: string;
  limit?: number;
  cursor?: string;
}

export interface SearchMissionsResult {
  missions: Record<string, unknown>[];
  count: number;
  hasMore: boolean;
  cursor: string | null;
}

// ─── Finance ─────────────────────────────────────────────────────────────────

export interface DepositParams {
  clientAccountId: string;
  amountUsd: string;
  idempotencyKey: string;
}

export interface DepositResult {
  credited: string;
  balanceUsd: string;
}

export interface BalanceResult {
  id: string;
  balance_micro: string;
  balance_usd: string;
}

// ─── Trust Infrastructure ─────────────────────────────────────────────────────

export interface RecentHash {
  index: number;
  hash: string;
  ts: string;
  event: string | null;
}

export interface ChainProof {
  intact: boolean;
  chainLength: number;
  headHash: string | null;
  tailHash: string | null;
  recentHashes: RecentHash[];
  brokenAt: number | null;
  reason: string | null;
  verifiedAt: string;
  ecosVersion: string;
}

export interface AgentIdentity {
  agentId: string;
  source: string;
  ecosVersion: string;
}

// ─── Health ───────────────────────────────────────────────────────────────────

export interface HealthResult {
  status: string;
  version: string;
  uptime: number;
  calibrator: { ready: boolean; sampleCount: number };
  chain: { length: number; headHash: string | null };
  db: string;
  timestamp: string;
}

// ─── EcosClient ───────────────────────────────────────────────────────────────

export declare class EcosClient {
  constructor(options: EcosClientOptions);

  // Core
  submitTask(task: SubmitTaskParams): Promise<TaskResult>;
  chat(params: ChatParams): Promise<ChatResult>;

  // Approvals
  listApprovals(options?: ListApprovalsOptions): Promise<ListApprovalsResult>;
  resolveApproval(approvalId: string, resolution: ResolveApprovalParams): Promise<ResolveApprovalResult>;
  bulkResolve(items: BulkResolveItem[]): Promise<Record<string, unknown>>;

  // Missions
  getMission(missionId: string): Promise<Record<string, unknown>>;
  getMissionDashboard(): Promise<MissionDashboard>;
  searchMissions(options?: SearchMissionsOptions): Promise<SearchMissionsResult>;

  // Finance
  deposit(params: DepositParams): Promise<DepositResult>;
  payout(params: { validatorAccountId: string; amountUsd: string }): Promise<Record<string, unknown>>;
  getBalance(accountId: string): Promise<BalanceResult>;
  getEarnings(validatorId: string): Promise<Record<string, unknown>>;

  // Trust
  getChainProof(): Promise<ChainProof>;
  getAgentIdentity(): Promise<AgentIdentity>;

  // Calibrator
  getCalibratorStatus(): Promise<Record<string, unknown>>;

  // Health
  healthCheck(): Promise<HealthResult>;
}

// ─── V117 P13-08: P12 + V117 Types ──────────────────────────────────────────

export interface GraduationStage {
  stageId: number;
  stageName: 'USE' | 'VERIFY' | 'OWN' | 'RECRUIT' | 'MENTOR';
  unlockedAt: string | null;
}

export interface GraduationReport {
  currentStage: { stageId: number; name: string; description: string };
  allStages: Array<{ stageId: number; name: string; description: string; requirement: Record<string, unknown> }>;
  advanced: boolean;
  newStage?: GraduationStage;
  generatedAt?: string;
}

export interface OnboardingTask {
  taskId: string;
  title: string;
  description: string;
  domain: string;
  difficulty: string;
  correctAnswer?: string;
  sampleAnswer?: string;
}

export interface OnboardingProgress {
  userId: string;
  completed: number;
  total: number;
  totalEarned: number;
  done: boolean;
  completedTaskIds: string[];
}

export interface GoldenTaskScore {
  correct: number;
  total: number;
  accuracy: number;
  passing: boolean;
  lastSubmittedAt?: string;
}

export interface GoldenTaskResult {
  taskId: string;
  correct: boolean;
  accuracy: number;
  passing: boolean;
  feedback?: string;
}

export interface SybilDecision {
  userId: string;
  verdict: 'ALLOW' | 'REVIEW' | 'BLOCK';
  score: number;
  signals: string[];
  decidedAt: string;
}

export interface StablecoinTransaction {
  ref: string;
  type: 'deposit' | 'withdrawal';
  provider: string;
  currency: string;
  amountMicro: string;
  status: 'pending' | 'confirmed' | 'failed';
  accountId: string;
  createdAt: string;
}

export interface ISO20022Event {
  id?: number;
  event_type: 'HITL_PAYOUT' | 'ROYALTY_PAYOUT' | 'TASK_CHARGE';
  originator_id: string;
  beneficiary_id: string;
  amount_micro: string;
  currency: string;
  reference_id: string | null;
  iso20022_json?: Record<string, unknown>;
  created_at: string;
}

export interface ValidatorDashboard {
  ok: boolean;
  validatorId: string;
  graduation: GraduationStage;
  goldenTask: GoldenTaskScore;
  sybilVerdict: 'ALLOW' | 'REVIEW' | 'BLOCK' | 'UNKNOWN';
  earnings: {
    taskUsd: string;
    royaltyUsd: string;
    totalUsd: string;
  };
  generatedAt: string;
}

export interface AdminDbHealth {
  ok: boolean;
  db: boolean;
  tables: Record<string, { status: 'ok' | 'missing' | 'unavailable'; rows: number | null; note?: string }>;
  allTablesPresent: boolean;
  generatedAt: string;
}

// ─── Extended EcosClient — V117 ───────────────────────────────────────────────

export declare class EcosClient {
  // V117: ISO 20022 Wiring
  wrapHitlPayout(params: { beneficiaryId: string; amountMicro: string; originatorId?: string; currency?: string; referenceId?: string }): Promise<{ ok: boolean; event: string; iso20022: Record<string, unknown> }>;
  wrapRoyaltyPayout(params: { authorId: string; amountMicro: string; patchId?: string; currency?: string }): Promise<{ ok: boolean; event: string; iso20022: Record<string, unknown> }>;
  wrapTaskCharge(params: { clientId: string; amountMicro: string; taskId?: string; currency?: string }): Promise<{ ok: boolean; event: string; iso20022: Record<string, unknown> }>;
  getISO20022Events(options?: { type?: string; limit?: number }): Promise<{ ok: boolean; events: ISO20022Event[]; count: number; source: string }>;

  // V117: Validator Dashboard
  getValidatorDashboard(validatorId: string): Promise<ValidatorDashboard>;

  // V117: Admin
  getAdminDbHealth(): Promise<AdminDbHealth>;

  // V117: Memory search with cursor
  searchMemoryPaginated(query: string, options?: { limit?: number; cursor?: string }): Promise<{ ok: boolean; results: unknown[]; nextCursor: string | null; hasMore: boolean }>;

  // P12 types already in use
  getGraduationStage(userId: string): Promise<GraduationStage>;
  getGraduationReport(userId: string): Promise<GraduationReport>;
  getOnboardingProgress(userId: string): Promise<OnboardingProgress>;
  getGoldenTaskScore(validatorId: string): Promise<GoldenTaskScore>;
  getSybilFlagged(): Promise<SybilDecision[]>;
}

// ─── V125/V126 Types ──────────────────────────────────────────────────────────

export interface NonceResponse {
  scope: string;
  accountId: string;
  currentNonce: number;
  nextExpected: number;
  ecosVersion: string;
}

export interface CompactionResult {
  compacted: boolean;
  leavesArchived?: number;
  leavesRemaining?: number;
  rootBefore?: string;
  rootAfter?: string;
  ecosVersion: string;
}

export interface BackfillResult {
  processed: number;
  skipped: number;
  errors: number;
  done: boolean;
  ecosVersion: string;
}

export interface CheckpointScheduleStatus {
  enabled: boolean;
  interval: number;
  lastLeafCount: number;
  configLoaded: boolean;
  ecosVersion: string;
}

export interface CompactionLogEvent {
  id: number;
  leaves_archived: number;
  leaves_remaining: number;
  root_before: string;
  root_after: string;
  ecos_version: string;
  compacted_at: string;
}

// ─── Extended EcosClient — V126 ───────────────────────────────────────────────

export declare class EcosClient {
  // V126 / V125: Nonce
  getNonce(scope: string, accountId: string): Promise<NonceResponse>;
  resolveApproval(approvalId: string, params: { validatorAccountId: string; decision: string; finalOutput?: string; note?: string; nonce?: number }): Promise<object>;

  // V125: Chain Ops
  compactMMR(opts?: { threshold?: number; archiveCount?: number }): Promise<CompactionResult>;
  backfillAuditEntries(opts?: { batchSize?: number; maxBatches?: number }): Promise<BackfillResult>;
  getCheckpointSchedule(): Promise<CheckpointScheduleStatus>;
  updateCheckpointSchedule(params: { interval?: number; enabled?: boolean }): Promise<CheckpointScheduleStatus>;

  // V126: Compaction log
  getCompactionLog(opts?: { limit?: number }): Promise<{ events: CompactionLogEvent[]; count: number; limit: number; compactorStats: object; ecosVersion: string }>;
}
