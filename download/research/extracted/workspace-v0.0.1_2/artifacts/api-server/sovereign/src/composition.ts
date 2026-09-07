/**
 * src/composition.ts — Sovereign Composition Root.
 * The single place that wires the agents' sovereign modules into one coherent stack:
 *   InMemoryLedger (μ¢) → TfaOrchestrator (guard+audit spine) → LedgerOrchestrator → PotentialEngine.
 * Financial ops are allowed only via an explicit policy (fail-closed otherwise). One stack per process;
 * every tenant is isolated inside it. Drop-in: the real TFA server calls buildSovereignStack() once.
 */
import { randomBytes, createHash } from "node:crypto";
import { InMemoryLedger } from "../lib/ledger/in-memory-ledger.ts";
import { DrizzlePaymentProvider } from "../lib/ledger/drizzle-payment-provider.ts";
import type { PaymentProvider } from "../lib/ledger/types.ts";
import type { DbPool } from "../lib/db/types.ts";
import { InMemoryPool } from "../lib/db/in-memory-driver.ts";
import { TfaOrchestrator } from "../lib/orchestrator/orchestrator.ts";
import { InMemoryAuditStore } from "../lib/orchestrator/audit.ts";
import { PgAuditSync } from "../lib/orchestrator/pg-audit-sync.ts";
import { PgPlanSync } from "./pg-plan-sync.ts";
import { HmacSigner, Ed25519Signer, HybridSigner, MlDsaStubSigner, createHybridSigner, generateAuditKeyPair } from "../lib/orchestrator/signer.ts";
import type { Ed25519KeyPair } from "../lib/orchestrator/signer.ts";
import { MutableSigner } from "../lib/orchestrator/mutable-signer.ts";
import { adaptPqcProvider } from "../lib/orchestrator/pqc-adapter.ts";
import { resolveHybridMlDsaProvider, resolveHybridMlDsaProviderSync } from "../lib/orchestrator/pqc-loader.ts";
import type { Signer, GuardPolicy } from "../lib/orchestrator/types.ts";
import { LedgerOrchestrator } from "../lib/ledger-orchestrator/ledger-orchestrator.ts";
import { LEDGER_ACTION_TYPES } from "../lib/ledger-orchestrator/types.ts";
import { PotentialEngine } from "../lib/potential/potential-engine.ts";
import { PersonalityMapper } from "../lib/potential/personality-mapper.ts";
import { PgPersonalityStore } from "../lib/potential/pg-personality-store.ts";
import { PgSuccessPathStore } from "../lib/potential/pg-success-path-store.ts";
import { PgCollaborationStore } from "../lib/potential/pg-collaboration-store.ts";
import { SuccessPathRouter } from "../lib/potential/success-path-router.ts";
import { CollaborationMatcher } from "../lib/potential/collaboration-matcher.ts";
import { POTENTIAL_ACTION_TYPES } from "../lib/potential/types.ts";
import { compilePolicies } from "../lib/policy/index.ts";
import { KillSwitch } from "../lib/policy/kill-switch.ts";
import { CollaborationEscrowBridge } from "../lib/potential/collaboration-escrow-bridge.ts";
import { SpendBudgetGuard, spendBudgetPolicy } from "../lib/policy/index.ts";
import type { DeclarativePolicy } from "../lib/policy/index.ts";
import type { UsageCountProvider } from "../lib/policy/index.ts";
import type { AuditStore } from "../lib/orchestrator/types.ts";
import { InMemoryIdentityStore, requireValidDelegation, PgIdentityStore } from "../lib/agent-identity/index.ts";
import { injectRiskClass } from "../lib/risk/action-risk.ts";
import { approvalPolicyRouter } from "../lib/risk/approval-policy.ts";
import { injectActorBaseline, InMemoryActorBaselineStore } from "../lib/risk/actor-baseline.ts";
import type { ActorBaselineStore } from "../lib/risk/actor-baseline.ts";
import { LedgerCron } from "./monitor/ledger-cron.ts";
import type { CronConfig } from "./monitor/ledger-cron.ts";
import { InMemoryOpportunityCatalog } from "../lib/marketplace/catalog.ts";
import { PgOpportunityCatalog } from "../lib/marketplace/pg-catalog.ts";
import type { OpportunityCatalog } from "../lib/marketplace/types.ts";
import { MARKETPLACE_ACTION_TYPES } from "../lib/marketplace/types.ts";
import { EscrowService, InMemoryEscrowStore } from "../lib/escrow/escrow.ts";
import { PgEscrowStore } from "../lib/escrow/pg-escrow-store.ts";
import { SettlementService, InMemorySettlementStore } from "../lib/escrow/settlement.ts";
import { PgSettlementStore } from "../lib/escrow/pg-settlement-store.ts";
import type { SettlementStore } from "../lib/escrow/settlement.ts";
import { ManualSettlementRail, InMemoryRailRegistry } from "../lib/settlement-rails/manual-rail.ts";
import type { RailRegistry } from "../lib/settlement-rails/types.ts";
import { WebhookService, InMemoryWebhookStore, InMemoryWebhookRelayer, InMemoryWebhookDeliveryLog, type WebhookDeliveryLog } from "../lib/escrow/webhook.ts";
import type { WebhookStore, WebhookRelayer } from "../lib/escrow/webhook.ts";
import { PgWebhookStore } from "../lib/escrow/pg-webhook-store.ts";
import { PgWebhookDeliveryLog } from "../lib/escrow/pg-webhook-delivery-log.ts";
import { InMemoryThresholdApprovalStore } from "../lib/escrow/threshold-approval.ts";
import type { ThresholdApprovalStore } from "../lib/escrow/threshold-approval.ts";
import { PgThresholdApprovalStore } from "../lib/escrow/pg-threshold-approval-store.ts";
import { HttpWebhookRelayer } from "../lib/escrow/http-webhook-relayer.ts";
import { InMemoryTrackRecordCache, PgTrackRecordCache, type TrackRecordCache } from "../lib/track-record/index.ts";
import { InMemoryApiKeyStore, PgApiKeyStore, ApiKeyService, type ApiKeyStore } from "../lib/api-key/index.ts";
import type { FeeConfig } from "../lib/escrow/index.ts";
import { InMemoryExecutionStore } from "../lib/orchestrator/execution-workflow.ts";
import { PgExecutionStore } from "../lib/orchestrator/pg-execution-store.ts";
import type { ExecutionStore, AsyncExecutionStore } from "../lib/orchestrator/types.ts";
import { ExecutionScheduler } from "../lib/orchestrator/execution-scheduler.ts";
import { InMemoryReadModelStore, PgReadModelStore, IndexerEventBus } from "../lib/indexer/index.ts";
import { InMemoryIntroductionStore, PgIntroductionStore, type IntroductionStore } from "../lib/introduction/index.ts";
import { InMemoryNonceRegistry, PgNonceRegistry, type NonceRegistry } from "../lib/mcp-server/nonce-registry.ts";
import { TfaMcpServer } from "../lib/mcp-server/mcp-server.ts";
import type { TfaMcpServerConfig } from "../lib/mcp-server/mcp-server.ts";
import { InMemoryKnowledgeGraphSource, PgKnowledgeGraphSource } from "../lib/potential/index.ts";
import type { KnowledgeGraphSource } from "../lib/potential/types.ts";
import { InMemoryTransparencyLog, PgTransparencyLogStore, type TransparencyLog } from "../lib/transparency-log/index.ts";
import { PassportRevocationList } from "../lib/passport/passport-revocation-list.ts";
import { WitnessRegistry } from "../lib/transparency-log/witness-registry.ts";

export interface SovereignStack {
  /** Honest persistence map: which trust primitives are durable (pg) vs in-memory right now. */
  persistenceReport: Record<string, "pg" | "in-memory">;
  ledger: LedgerOrchestrator;
  potential: PotentialEngine;
  /** PersonalityMapper — extracts deep traits (extroversion, focus, etc.) from signals. */
  personalityMapper: PersonalityMapper;
  /** SuccessPathRouter — computes ordered learning paths toward a target opportunity. */
  successPathRouter: SuccessPathRouter;
  /** CollaborationMatcher — finds complementary collaborators within a tenant. */
  collaborationMatcher: CollaborationMatcher;
  /**
   * PersonalityStore — persists and retrieves PersonalityProfile objects.
   * InMemoryPool (dev/test) or PgPool (production) depending on `pool` option.
   */
  personalityStore: PgPersonalityStore;
  /**
   * SuccessPathStore — persists and retrieves computed SuccessPath objects.
   * InMemoryPool (dev/test) or PgPool (production) depending on `pool` option.
   */
  successPathStore: PgSuccessPathStore;
  /**
   * CollaborationStore — caches top-N CollaborationMatch[] per user.
   * InMemoryPool (dev/test) or PgPool (production) depending on `pool` option.
   */
  collaborationStore: PgCollaborationStore;
  /** Tenant-scoped opportunity catalog for שלב E marketplace. */
  catalog: OpportunityCatalog;
  /** Sovereign Escrow — completion-contingent payments (create/fund/release/refund). */
  escrow: EscrowService;
  collaborationEscrowBridge: CollaborationEscrowBridge;
  policies: GuardPolicy[];
  orchestrator: TfaOrchestrator;
  escrowStore: import("../lib/escrow/escrow.ts").EscrowStore;
  identities: InMemoryIdentityStore | PgIdentityStore;
  /**
   * Kernel signer — exposed so passport issuance reuses the same provenance key.
   * Concrete type depends on `signerKind`: HmacSigner (default) or Ed25519Signer.
   * Wrapped in MutableSigner to enable live key rotation via POST /api/sovereignty/rotate-key.
   */
  signer: MutableSigner;
  /**
   * Ed25519 SPKI PEM public key, exposed when `signerKind === "ed25519"` so
   * external verifiers (scripts/verify-passport.mjs --public-key-file) can
   * verify passport signatures without a shared secret. `null` for HMAC.
   */
  publicKey: string | null;
  /**
   * Scheduled solvency & anomaly auditor.
   * Call `.start(intervalMs)` after mounting routes to enable automatic sweeps.
   * Tenants are auto-registered by the sovereign routes on first financial op.
   */
  monitor: LedgerCron;
  /**
   * TrackRecordCache — stores computed track records (PgTrackRecordCache in production,
   * InMemoryTrackRecordCache in tests). Invalidated automatically on escrow state changes.
   */
  trackRecordCache: TrackRecordCache;
  /**
   * API-Key store — per-tenant key issuance and revocation.
   * PgApiKeyStore when `pool` is provided (durable, survives restart — J1 sub-step 2),
   * else InMemoryApiKeyStore (dev/test, zero-config).
   */
  apiKeyStore: ApiKeyStore;
  /** API-Key service — generate, validate, revoke, list. */
  apiKeyService: ApiKeyService;
  /**
   * Per-tenant plan assignment (v99 → 14b). Populated by POST /api/tenants
   * (`plan` field) and consulted by the "tenant-plan-limit" guard installed
   * automatically in `buildSovereignStack`. See `TenantPlanRegistry`.
   */
  tenantPlans: TenantPlanRegistry | import("./pg-plan-sync.ts").PgPlanSync;
  /**
   * ExecutionStore — durable lifecycle store for ExecutionWorkflows.
   * PgExecutionStore (async, pg-backed) when `pool` is provided;
   * InMemoryExecutionStore (sync) in dev/test.
   */
  executionStore: ExecutionStore | AsyncExecutionStore;
  /**
   * ExecutionScheduler — timer-based supervisor loop.
   * Call `.start(intervalMs)` after mounting routes to enable automatic retry sweeps.
   * Call `.registerTenant(tenantId)` on first autonomous/financial op for each tenant.
   * Call `.stop()` on graceful shutdown.
   */
  executionScheduler: ExecutionScheduler;
  /**
   * SettlementService — post-fund disbursement with partial/full release, dispute, reversal.
   * Backed by PgSettlementStore (pool present) or InMemorySettlementStore (dev/test).
   */
  settlement: SettlementService;
  /**
   * SettlementStore — direct access for admin/diagnostic queries.
   */
  settlementStore: SettlementStore;
  /**
   * RailRegistry — per-tenant settlement rail lookup.
   * Platform default: ManualSettlementRail registered under "*".
   * In production: register tenant-specific rails via `railRegistry.register(tenantId, rail)`.
   */
  railRegistry: RailRegistry;
  /**
   * WebhookService — per-tenant HMAC-signed webhook registration and dispatch.
   * Uses InMemoryWebhookRelayer in dev/test; swap for HttpWebhookRelayer in production.
   */
  webhookService: WebhookService;
  /**
   * WebhookRelayer — injectable HTTP adapter (InMemoryWebhookRelayer in dev/test).
   * Exposed on the stack so integration tests can inspect delivered payloads.
   */
  webhookRelayer: WebhookRelayer;
  /** Durable replay-protection store for threshold approvals (Pg when pooled). */
  approvalStore: ThresholdApprovalStore;
  /**
   * Trust-Graph read-model store (Indexer #5).
   * InMemoryReadModelStore (dev/test) or PgReadModelStore (pool present, TFA_PERSIST=pg).
   * The indexer-routes expose query APIs over this store.
   */
  readModelStore: InMemoryReadModelStore | PgReadModelStore;
  /**
   * IndexerEventBus — event-driven auto-projection dispatcher.
   * Emit domain events (execution.updated, passport.issued, etc.) to automatically
   * project them into the readModelStore without manual projectXxx() calls.
   * Errors are caught and logged; they never interrupt the calling flow.
   */
  indexerEventBus: IndexerEventBus;
  /**
   * KnowledgeGraphSource — real signal store for PotentialEngine route()/analyze().
   * PgKnowledgeGraphSource when pool is present (durable KG signals);
   * InMemoryKnowledgeGraphSource in dev/test (zero-config).
   */
  kgSource: KnowledgeGraphSource;
  /**
   * IntroductionStore — cross-tenant introduction requests (step K8).
   * In-memory in dev/test; PgIntroductionStore in production.
   */
  introductionStore: IntroductionStore;
  /**
   * NonceRegistry — replay-protection registry for ApprovalCapabilityToken nonces.
   * InMemoryNonceRegistry (dev/test, TTL-pruned) when `pool` is absent.
   * PgNonceRegistry (durable, preloaded via init()) when `pool` is provided —
   * so replay protection survives process restart.
   *
   * Pass this to TfaMcpServerConfig.nonceRegistry when constructing TfaMcpServer.
   * This is the single source of truth; do NOT construct a separate NonceRegistry.
   */
  nonceRegistry: NonceRegistry;
  /**
   * AuditStore — the signed, append-only chain backing every tenant's audit log.
   * Exposed (v198) so consumers of the stack (HTTP routes, MCP server, the
   * break-glass enforcement chokepoint) can append signed records through the
   * same instance the orchestrator writes to.
   */
  auditStore: AuditStore;
  /**
   * KillSwitch — emergency stop / circuit breaker for the guard/approval path.
   * When tripped, forces all adapter decisions to "denied" regardless of policy.
   * Admin endpoints (admin:kill-switch scope) control engagement/disengagement.
   */
  killSwitch: KillSwitch;
  /**
   * TransparencyLog — append-only Merkle-anchored log of every approved receipt.
   * InMemoryTransparencyLog in dev/test; PgTransparencyLogStore when pool is present.
   * Provides GET /api/transparency/log/root and /proof/:receiptId for offline
   * inclusion-proof verification.
   */
  transparencyLog: TransparencyLog;
  /**
   * PassportRevocationList — per-passport, tenant-scoped revocation registry.
   * In-memory (additive-only, fast O(1) lookup). Exposed on the stack so HTTP
   * routes and the verifier can share the single authoritative instance.
   * Always in-memory (v382): persisted revocations follow the Pg path in a
   * future cycle when durable revocation is required for cross-restart safety.
   */
  revocationList: PassportRevocationList;
  /**
   * WitnessRegistry — per-tenant witness verifying-key registry + submitted
   * co-signature statements (v388). In-memory, always (same trust boundary
   * as KeyRing/revocationList — witnesses are provisioned operationally).
   * Exposed on the stack so HTTP routes share the single authoritative instance.
   */
  witnessRegistry: WitnessRegistry;
  /**
   * SpendBudgetGuard — cumulative spend cap (runaway-cost protection, v415/v417).
   * Exposed on the stack so the HTTP budget routes can set/query/delete budgets
   * without a server restart. Keyed by tenantId (and composite actorKey for
   * per-actor sub-budgets). In-memory, always.
   */
  spendBudgetGuard: SpendBudgetGuard;
  /**
   * ActorBaselineStore — per-actor anomaly baseline for velocity detection.
   * InMemoryActorBaselineStore in dev/test. Wired into the orchestrator so
   * successful actions update the baseline (baseline learns only approved ops).
   */
  actorBaselineStore: ActorBaselineStore;
}

/**
 * Default governance as DATA (not code). A tenant admin or third party can ship their own JSON to
 * replace this without touching the kernel. Two policies (AND-composed by the orchestrator):
 *  1) allow-list the known ledger action types; anything else is denied (fail-closed).
 *  2) cap a single mint/transfer at DEFAULT_TX_CAP μ¢ (spending limit as data).
 */
export const DEFAULT_TX_CAP = "100000000"; // 1,000.00 USD in μ¢
export function defaultPolicies(txCap: string = DEFAULT_TX_CAP): DeclarativePolicy[] {
  const known = [
    ...Object.values(LEDGER_ACTION_TYPES),
    ...Object.values(POTENTIAL_ACTION_TYPES),
    ...Object.values(MARKETPLACE_ACTION_TYPES),
  ] as string[];
  return [
    { name: "ledger-allowlist", rules: [{ if: { actionTypeNotIn: known }, then: "deny", reason: "unknown action (fail-closed)" }], default: "allow" },
    { name: "tx-spending-cap", rules: [{ if: { actionType: ["ledger.mint", "ledger.transfer"], amountAbove: txCap }, then: "deny", reason: "exceeds spending cap (governance-as-data)" }], default: "allow" },
  ];
}

/**
 * Build a UsageCountProvider backed by an AuditStore.
 *
 * Counts financial ledger actions (mint/withdraw/transfer) with outcome="allowed"
 * whose `occurredAt` falls in the current calendar month (UTC). This is the metric
 * `PolicyCondition.maxMonthlyActions` compares against — the basis for Pricing &
 * Limits as policy-as-data (free/pro plans).
 *
 * Pure read over the audit chain — no separate counter table, no double-bookkeeping:
 * the audit chain IS the usage record (same source of truth as proofOfSolvency).
 */
export function makeUsageCountProvider(auditStore: AuditStore): UsageCountProvider {
  const FINANCIAL_ACTION_TYPES = new Set<string>([
    LEDGER_ACTION_TYPES.MINT,
    LEDGER_ACTION_TYPES.WITHDRAW,
    LEDGER_ACTION_TYPES.TRANSFER,
  ]);
  return async (tenantId: string): Promise<number> => {
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth();
    const chain = auditStore.getChain(tenantId);
    let count = 0;
    for (const rec of chain) {
      if (rec.outcome !== "allowed") continue;
      if (!FINANCIAL_ACTION_TYPES.has(rec.actionType)) continue;
      const d = new Date(rec.occurredAt);
      if (d.getUTCFullYear() === year && d.getUTCMonth() === month) count++;
    }
    return count;
  };
}

/**
 * Pricing & Limits as policy-as-data (v99).
 *
 * Each plan is a DeclarativePolicy whose `maxMonthlyActions` rule denies further
 * financial actions once the tenant's monthly usage (see makeUsageCountProvider)
 * reaches the plan's cap. The cap is DATA — changing plans means swapping which
 * policy a tenant is compiled with, never touching kernel code.
 *
 * Compose with defaultPolicies(), e.g.:
 *   buildSovereignStack([...defaultPolicies(), planPolicy("free")], opts)
 *
 * "unlimited" plans (or any plan not listed here) simply omit the maxMonthlyActions
 * rule — defaultPolicies() alone already allow-lists + caps per-transaction amounts.
 */
export const PLAN_LIMITS = {
  free: 50,
  pro: 5000,
} as const;
export type PlanName = keyof typeof PLAN_LIMITS;

/**
 * TenantPlanRegistry — per-tenant plan assignment (v99 → 14b: "plan per tenant").
 *
 * Pure in-memory map from tenantId → plan name. Populated by the Tenant Onboarding
 * API (POST /api/tenants, `plan` field) and consulted by the per-tenant plan guard
 * installed in `buildSovereignStack`. A tenant with no entry has NO plan-limit
 * applied (same fail-soft semantics as "no UsageCountProvider": the limit is simply
 * not enforced) — this preserves backward compatibility for stacks/tests that never
 * call the onboarding API.
 */
export class TenantPlanRegistry {
  private readonly plans = new Map<string, PlanName>();

  /** Returns the tenant's plan, or `undefined` if none was ever assigned. */
  get(tenantId: string): PlanName | undefined {
    return this.plans.get(tenantId);
  }

  /** Assign (or change) a tenant's plan. Must be one of `PLAN_LIMITS`'s keys. */
  set(tenantId: string, plan: PlanName): void {
    this.plans.set(tenantId, plan as "free" | "pro");
  }

  /** True if the given string is a recognised plan name (free|pro). */
  static isValidPlan(plan: unknown): plan is PlanName {
    return typeof plan === "string" && Object.prototype.hasOwnProperty.call(PLAN_LIMITS, plan);
  }
}

export function planPolicy(plan: PlanName): DeclarativePolicy {
  const limit = PLAN_LIMITS[plan];
  return {
    name: `plan-limit-${plan}`,
    rules: [
      {
        if: {
          actionType: ["ledger.mint", "ledger.withdraw", "ledger.transfer"],
          maxMonthlyActions: limit,
        },
        then: "deny",
        reason: `monthly action limit reached for plan "${plan}" (${limit}/mo) — upgrade plan or wait for next month (policy-as-data)`,
      },
    ],
    default: "allow",
  };
}

/**
 * Options for `buildSovereignStack`.
 *
 * Backward compat: the legacy two-arg form `buildSovereignStack(policies, "secret-string")`
 * still works — a bare string is interpreted as `{ auditSecret: "...", signerKind: "hmac" }`.
 */
export interface BuildSovereignStackOptions {
  /** "pg" forces full persistence; without a pool the build throws (fail-closed). Also via TFA_PERSIST=pg. */
  persist?: "pg";
  /**
   * Which signing algorithm to wire into the kernel.
   *   - "ed25519" (default) — Asymmetric. Non-repudiation. Public key exposed
   *                            on `SovereignStack.publicKey` for external verifiers.
   *   - "hmac"    — HMAC-SHA256, single-secret. Zero external config.
   *                 Use `{ signerKind: "hmac" }` or `TFA_SIGNER_KIND=hmac` to opt in.
   *
   * If omitted, falls back to `process.env.TFA_SIGNER_KIND`, then "ed25519" (M4 sub-step 3).
   * Explicit `signerKind` (including the legacy string-arg form, which always normalizes
   * to `{ signerKind: "hmac" }`) always wins for selection. fail-closed: if TFA_SIGNER_KIND
   * is set, it must be exactly "ed25519" or "hmac" — any other value throws UNCONDITIONALLY.
   */
  signerKind?: "hmac" | "ed25519" | "hybrid-ed25519-mldsa";
  /** HMAC secret (signerKind="hmac"). If omitted, a random 32-byte secret is generated. */
  auditSecret?: string;
  /**
   * Ed25519 key pair (signerKind="ed25519"). If omitted, a fresh pair is generated
   * via `generateAuditKeyPair()` — suitable for tests / ephemeral stacks. Production
   * must inject a stable pair from a secrets manager so verifiers have a stable public key.
   */
  ed25519KeyPair?: Ed25519KeyPair;
  /**
   * Real ML-DSA-44 provider for hybrid mode (signerKind="hybrid-ed25519-mldsa").
   * If omitted, `resolveHybridMlDsaProviderSync` is used: it tries real OQS/WASM
   * modules first, then falls back to `MlDsaDeterministicProvider` (functional
   * simulation, clearly labeled — not post-quantum secure). The fallback keeps the
   * hybrid pipeline working in zero-dep sandboxes until ops installs a real provider.
   * Interface: { sign(msg: Uint8Array): Uint8Array; verify(msg: Uint8Array, sig: Uint8Array): boolean }.
   * Drop-in: supply this when a real WebAssembly OQS or native Node.js ML-DSA provider lands.
   *
   * `buildSovereignStackAsync` widens this to also accept a full `Signer` so the
   * async loader can pass a pre-resolved real provider through without re-adaptation.
   */
  hybridMlDsaProvider?: { sign(msg: Uint8Array): Uint8Array; verify(msg: Uint8Array, sig: Uint8Array): boolean } | Signer;
  /**
   * Custom PaymentProvider to inject into the stack.
   * Defaults to `InMemoryLedger` (zero-dependency, suitable for tests and local dev).
   *
   * For production Drizzle+Postgres persistence:
   * ```ts
   * import { DrizzlePaymentProvider } from "../lib/ledger/index.ts";
   * const provider = await DrizzlePaymentProvider.create(pgPool);
   * buildSovereignStack(defaultPolicies(), { provider });
   * ```
   */
  provider?: PaymentProvider;
  /**
   * DbPool to auto-create a DrizzlePaymentProvider as the default provider.
   * When provided, the composition root instantiates DrizzlePaymentProvider
   * automatically. In tests or local dev omit this to keep InMemoryLedger.
   * Takes precedence over the fallback, but an explicit `provider` wins.
   *
   * The same `pool` is also used to build a `PgOpportunityCatalog` (see below).
   */
  pool?: DbPool;
  /**
   * Pre-built OpportunityCatalog to inject directly into the stack.
   * When provided, takes precedence over automatic construction from `pool`.
   * Used internally by `buildSovereignStackAsync` to pass an already-initialised
   * PgOpportunityCatalog, and by tests that want a custom catalog.
   * When absent and `pool` is present, a PgOpportunityCatalog is built from `pool`.
   * When absent and no `pool`, falls back to InMemoryOpportunityCatalog.
   */
  catalog?: OpportunityCatalog;
  /**
   * Fee Engine (v97): coordination fee collected on escrow release.
   * basisPoints = 0–10000 (500 = 5%). Omit or 0 = no fee (backward compat).
   */
  feeConfig?: FeeConfig;
  /**
   * Optional pre-built WebhookRelayer to inject (additive, additive only). When
   * provided, the composition root uses it instead of the default selection
   * (HttpWebhookRelayer when `pool` is set, otherwise InMemoryWebhookRelayer).
   * Used by tests that need a fast / short-timeout HTTP relayer to avoid 30s+
   * waits against unreachable hosts. Production callers should normally omit
   * this and let the composition pick by pool presence.
   */
  webhookRelayer?: WebhookRelayer;
}

/**
 * Build the sovereign stack with audit signing and delegation enforcement enabled by default.
 *
 * @param policies - Declarative governance policies (default = allow-list + spending cap).
 * @param opts     - Either a legacy HMAC secret string (backward compat) OR an options object
 *                   choosing the signer kind and providing keys. See `BuildSovereignStackOptions`.
 */
export function buildSovereignStack(
  policies: DeclarativePolicy[] = defaultPolicies(),
  opts?: string | BuildSovereignStackOptions,
): SovereignStack {
  const normalized: BuildSovereignStackOptions =
    typeof opts === "string"
      ? { signerKind: "hmac", auditSecret: opts }
      : opts ?? {};

  // ── TFA_PERSIST=pg — the global persistence flag (J1 sub-step 4, deep-audit critical) ──
  // Trust that resets on restart is not trust. When the flag is set, a pg pool is REQUIRED:
  // refusing to boot beats silently booting an amnesiac trust kernel (fail-closed).
  const persistEnv = (globalThis as any).process?.env?.TFA_PERSIST;
  if ((persistEnv === "pg" || normalized.persist === "pg") && !normalized.pool) {
    throw new Error(
      "TFA_PERSIST=pg requires a database pool: pass { pool } to buildSovereignStack(). " +
      "Refusing to start with in-memory trust primitives in persistent mode (fail-closed).",
    );
  }
  // ── TFA_SIGNER_KIND — global signer-kind override ─────────────────────────
  // The in-code default is now "ed25519" (M4 sub-step 3 flip). TFA_SIGNER_KIND
  // env var still lets ops pin a whole deployment to "hmac" or "ed25519".
  // An explicit opts.signerKind always wins. fail-closed: any value other than
  // exactly "ed25519" or "hmac" throws at boot.
  const signerKindEnv = (globalThis as any).process?.env?.TFA_SIGNER_KIND;
  const VALID_SIGNER_KINDS = ["ed25519", "hmac", "hybrid-ed25519-mldsa"] as const;
  if (signerKindEnv !== undefined && !(VALID_SIGNER_KINDS as readonly string[]).includes(signerKindEnv)) {
    throw new Error(
      `TFA_SIGNER_KIND must be one of ${VALID_SIGNER_KINDS.map(k => JSON.stringify(k)).join(", ")} if set, ` +
      `got: ${JSON.stringify(signerKindEnv)} ` +
      "(fail-closed: refusing to silently pick a signer the operator didn't request).",
    );
  }
  const signerKind = (normalized.signerKind ?? signerKindEnv ?? "ed25519") as "hmac" | "ed25519" | "hybrid-ed25519-mldsa";

  // ── Ed25519-first: default is now "ed25519" (M4 sub-step 3) ───────────────
  // The in-code default flipped from "hmac" to "ed25519" here. HMAC is still
  // fully supported via opts.signerKind="hmac" or TFA_SIGNER_KIND=hmac.
  // The deprecation warning (sub-step 2) is removed — the default IS ed25519.

  let signer: MutableSigner;
  let publicKey: string | null;
  if (signerKind === "hybrid-ed25519-mldsa") {
    // ── PQC hybrid: Ed25519 (classical) + ML-DSA-44 (post-quantum) ─────────
    // createHybridSigner wires both signers into a single HybridSigner whose
    // algorithm = "hybrid-ed25519-mldsa". sign() concatenates both signatures;
    // verify() checks both (AND semantics — fail-closed).
    //
    // Provider resolution (v308 — drop-in loader):
    //   1. Explicit opts.hybridMlDsaProvider wins (real module or custom).
    //   2. If absent, resolveHybridMlDsaProviderSync tries known OQS/WASM modules
    //      via dynamic import, then falls back to MlDsaDeterministicProvider.
    //   3. The deterministic fallback is functional and conformance-passing,
    //      but clearly labeled "-sim" — ops must replace with a real provider
    //      for production PQC security.
    const pair = normalized.ed25519KeyPair ?? generateAuditKeyPair();
    let mlDsaProvider: Signer | undefined;
    if (normalized.hybridMlDsaProvider) {
      const raw = normalized.hybridMlDsaProvider;
      // Support both full Signer implementations (e.g. MlDsaDeterministicProvider)
      // and raw Uint8Array-based modules (OQS, WASM) via the adapter bridge.
      if (
        typeof (raw as any).algorithm === "string" &&
        typeof (raw as any).sign === "function" &&
        typeof (raw as any).verify === "function"
      ) {
        mlDsaProvider = raw as Signer;
      } else {
        mlDsaProvider = adaptPqcProvider(raw as any);
      }
    } else {
      // Derive a stable deterministic secret from the Ed25519 private key so
      // the fallback signatures are reproducible for the same key pair.
      const deterministicSecret = createHash("sha256")
        .update(pair.privateKey)
        .digest();
      mlDsaProvider = resolveHybridMlDsaProviderSync({
        deterministicSecret,
      });
    }
    signer = new MutableSigner(createHybridSigner({
      ed25519KeyPair: pair,
      mlDsaProvider,
    }));
    publicKey = pair.publicKey; // Expose Ed25519 half for classical verifiers
  } else if (signerKind === "ed25519") {
    const pair = normalized.ed25519KeyPair ?? generateAuditKeyPair();
    signer = new MutableSigner(new Ed25519Signer(pair.privateKey, pair.publicKey));
    publicKey = pair.publicKey;
  } else {
    const secret = normalized.auditSecret ?? randomBytes(32).toString("base64");
    signer = new MutableSigner(new HmacSigner(secret));
    publicKey = null;
  }

  let provider = normalized.provider;
  if (!provider) {
    if (normalized.pool) {
      // ── The LAST persistence seam (v126, deep-audit "persistence truth" critical) ──
      // Every other trust primitive (audit, identities, apiKeys, escrow, catalog, plans…)
      // already becomes durable the moment a pool is present. The ledger — the FINANCIAL
      // truth — was the lone exception: it only went pg under NODE_ENV=production, so a
      // pooled-but-not-"production" boot ran money in-memory. A balance that resets on
      // restart is not trust. Now the ledger follows the same rule as its siblings:
      // pool present ⇒ DrizzlePaymentProvider, regardless of NODE_ENV.
      const drizzle = new DrizzlePaymentProvider(normalized.pool);
      // Fail-closed: a money ledger that cannot initialise must NOT run half-broken.
      // In production, crash loudly (same as the other pg-stores) rather than serving an
      // unverified ledger; in dev/test the in-memory pool's idempotent DDL won't fail.
      drizzle.init().catch((err: unknown) => {
        console.error("[sovereign] DrizzlePaymentProvider init failed — refusing to run with an unverified ledger:", err);
        if (process.env.NODE_ENV === "production") process.exit(1);
      });
      provider = drizzle;
    } else if (process.env.NODE_ENV === "production") {
      // Production with neither an explicit provider nor a pool — refuse to boot an
      // amnesiac money ledger (fail-closed).
      throw new Error("DbPool is required to initialize DrizzlePaymentProvider in production");
    } else {
      provider = new InMemoryLedger();
    }
  }
  let identities: InMemoryIdentityStore | PgIdentityStore;
  if (normalized.pool) {
    const pgIdentities = new PgIdentityStore(normalized.pool);
    pgIdentities.init().catch((err: unknown) => {
      console.error("[sovereign] PgIdentityStore init failed:", err);
      if (process.env.NODE_ENV === "production") process.exit(1);
    });
    identities = pgIdentities;
  } else {
    identities = new InMemoryIdentityStore();
  }
  // Audit store is created explicitly (rather than left to TfaOrchestrator's default)
  // so it can be shared with the usageCountProvider for maxMonthlyActions plan limits
  // (Pricing & Limits as policy-as-data, v99).
  // J1 part C: when pool is present, use PgAuditSync (sync facade + write-through to pg).
  let auditStore: InMemoryAuditStore | PgAuditSync;
  if (normalized.pool) {
    const pgAuditSync = new PgAuditSync(normalized.pool, signer);
    pgAuditSync.init().catch((err: unknown) => {
      console.error("[sovereign] PgAuditSync init failed:", err);
      if (process.env.NODE_ENV === "production") process.exit(1);
    });
    auditStore = pgAuditSync;
  } else {
    auditStore = new InMemoryAuditStore(signer);
  }
  const usageCountProvider = makeUsageCountProvider(auditStore);
  const compiled = compilePolicies(policies, { usageCountProvider });
  // ── Per-tenant plan limits (v99 → 14b) ──────────────────────────────────────
  // tenantPlans maps tenantId → "free"|"pro" (set by POST /api/tenants onboarding).
  // For each known plan we precompile its planPolicy() once (sharing usageCountProvider),
  // then a single tenant-plan-limit guard dispatches to the right compiled policy per
  // request based on ctx.tenantId. Tenants with no entry pass through unaffected
  // (fail-soft, same as "no plan configured" — matches defaultPolicies()-only stacks).
  // ── PgPlanSync: persist tenant→plan mapping across restarts (v117) ──────────
  // When a pool is available, swap TenantPlanRegistry for PgPlanSync (same sync
  // get/set API, write-through to pg). Without a pool, plain in-memory (dev/test).
  let tenantPlans: TenantPlanRegistry | PgPlanSync = new TenantPlanRegistry();
  if (normalized.pool) {
    const pgPlans = new PgPlanSync(normalized.pool);
    pgPlans.init().catch((err: unknown) => {
      console.error("[sovereign] PgPlanSync init failed:", err);
      if (process.env.NODE_ENV === "production") process.exit(1);
    });
    tenantPlans = pgPlans;
  }
  const compiledPlanGuards = new Map<PlanName, GuardPolicy>(
    (Object.keys(PLAN_LIMITS) as PlanName[]).map((plan) => [plan, compilePolicies([planPolicy(plan)], { usageCountProvider })[0]]),
  );
  const tenantPlanGuard: GuardPolicy = {
    name: "tenant-plan-limit",
    evaluate: (ctx) => {
      const plan = tenantPlans.get(ctx.tenantId);
      if (!plan) return { allow: true };
      const guard = compiledPlanGuards.get(plan as "free" | "pro");
      return guard ? guard.evaluate(ctx) : { allow: true };
    },
  };
  // Actor baseline store: memory-bounded, deterministic per-actor anomaly detection.
  // In production this may be backed by PostgreSQL; in dev/test InMemory is zero-config.
  const actorBaselineStore = new InMemoryActorBaselineStore();

  // injectRiskClass runs FIRST: it annotates ctx.riskClass (ActionRiskClass taxonomy).
  // injectActorBaseline runs SECOND: reads historical baseline + recent count and injects
  // into riskContext so the approval router can detect velocity anomalies.
  // approvalPolicyRouter runs THIRD: it reads ctx.riskClass, resolves ApprovalClass,
  // creates a signed decision trace, and denies if the class maps to "deny" (fail-closed).
  // Delegation policy is injected fourth (fail-closed on autonomous actions without a valid
  // chain ending in a human root). The per-tenant plan guard is appended last
  // (policy-as-data for the tenant's plan).
  const spendBudgetGuard = new SpendBudgetGuard();
  const allPolicies = [
    injectRiskClass(),
    injectActorBaseline(actorBaselineStore, { recordDuringEvaluate: false }),
    approvalPolicyRouter(signer),
    requireValidDelegation(identities),
    ...compiled,
    tenantPlanGuard,
    spendBudgetPolicy(spendBudgetGuard, { requireBudget: false }),
  ];
  // ── ExecutionStore: PgExecutionStore when pool provided, else InMemory (dev/test) ──
  // Created BEFORE the orchestrator so it can be wired in as the 4th constructor arg.
  // The orchestrator uses it to create/advance ExecutionWorkflows for every autonomous
  // or financial action (fail-closed: if the store is unavailable the action is denied).
  let executionStore: ExecutionStore | AsyncExecutionStore;
  if (normalized.pool) {
    const pgExecution = new PgExecutionStore(normalized.pool);
    pgExecution.init().catch((err: unknown) => {
      console.error("[sovereign] PgExecutionStore init failed:", err);
      if (process.env.NODE_ENV === "production") process.exit(1);
    });
    executionStore = pgExecution;
  } else {
    executionStore = new InMemoryExecutionStore();
  }
  // ── ExecutionScheduler: background retry loop for failed workflows ──────────
  // start() is NOT called here — the server or test calls it after mounting routes.
  const executionScheduler = new ExecutionScheduler(executionStore);
  const orchestrator = new TfaOrchestrator(allPolicies, auditStore, signer, executionStore, actorBaselineStore, spendBudgetGuard);
  // Wire auto-passport issuance: every successful mint/withdraw/transfer
  // is anchored on the audit record and signed by the same kernel signer.
  const ledger = new LedgerOrchestrator(provider, orchestrator, {
    signer,
    identityStore: identities,
  });
  // ── KnowledgeGraphSource: PgKnowledgeGraphSource when pool provided
  // (durable KG signals survive restart), else InMemoryKnowledgeGraphSource (dev/test).
  let kgSource: KnowledgeGraphSource;
  if (normalized.pool) {
    const pgKg = new PgKnowledgeGraphSource(normalized.pool);
    pgKg.init().catch((err: unknown) => {
      console.error("[sovereign] PgKnowledgeGraphSource init failed:", err);
      if (process.env.NODE_ENV === "production") process.exit(1);
    });
    kgSource = pgKg;
  } else {
    kgSource = new InMemoryKnowledgeGraphSource();
  }
  const potential = new PotentialEngine(compiled, undefined, {}, "PotentialEngine", kgSource);
  const personalityMapper = new PersonalityMapper();
  const successPathRouter = new SuccessPathRouter();
  const collaborationMatcher = new CollaborationMatcher();
  // ── PersonalityStore: PgPersonalityStore over DbPool ──────────────────────
  // Uses the provided pool if available; otherwise creates a fresh InMemoryPool
  // so tests / local dev work with zero config. Both paths call init() to ensure
  // the schema exists (idempotent IF NOT EXISTS).
  let personalityStore: PgPersonalityStore;
  if (normalized.pool) {
    personalityStore = new PgPersonalityStore(normalized.pool);
    personalityStore.init().catch((err: unknown) => {
      console.error("[sovereign] PgPersonalityStore init failed:", err);
      if (process.env.NODE_ENV === "production") process.exit(1);
    });
  } else {
    // No shared pool — create a dedicated in-process InMemoryPool for personality data.
    // This keeps dev/test at zero-config while production injects a real pool.
    const devPool = new InMemoryPool();
    personalityStore = new PgPersonalityStore(devPool);
    personalityStore.init().catch(() => {});
  }
  // ── SuccessPathStore: PgSuccessPathStore over DbPool ──────────────────────
  let successPathStore: PgSuccessPathStore;
  if (normalized.pool) {
    successPathStore = new PgSuccessPathStore(normalized.pool);
    successPathStore.init().catch((err: unknown) => {
      console.error("[sovereign] PgSuccessPathStore init failed:", err);
      if (process.env.NODE_ENV === "production") process.exit(1);
    });
  } else {
    const devPool2 = new InMemoryPool();
    successPathStore = new PgSuccessPathStore(devPool2);
    successPathStore.init().catch(() => {});
  }
  // ── CollaborationStore: PgCollaborationStore over DbPool ────────────────
  let collaborationStore: PgCollaborationStore;
  if (normalized.pool) {
    collaborationStore = new PgCollaborationStore(normalized.pool);
    collaborationStore.init().catch((err: unknown) => {
      console.error("[sovereign] PgCollaborationStore init failed:", err);
      if (process.env.NODE_ENV === "production") process.exit(1);
    });
  } else {
    const collabPool = new InMemoryPool();
    collaborationStore = new PgCollaborationStore(collabPool);
    collaborationStore.init().catch(() => {});
  }
  const monitor = new LedgerCron(provider);
  // ── Catalog: PgOpportunityCatalog if pool provided, else InMemory (dev/test) ──
  let catalog: OpportunityCatalog;
  if (normalized.catalog) {
    // Pre-built catalog injected (e.g. from buildSovereignStackAsync after await init())
    catalog = normalized.catalog;
  } else if (normalized.pool) {
    const pgCatalog = new PgOpportunityCatalog(normalized.pool);
    // Fire-and-forget: init() is idempotent (IF NOT EXISTS). In production, a failure
    // means the table is missing — fail loudly rather than silently serving a broken catalog.
    pgCatalog.init().catch((err: unknown) => {
      console.error("[sovereign] PgOpportunityCatalog init failed:", err);
      if (process.env.NODE_ENV === "production") process.exit(1);
    });
    catalog = pgCatalog;
  } else {
    catalog = new InMemoryOpportunityCatalog();
  }
  // Use PgEscrowStore when a pool is available (same pattern as PgOpportunityCatalog).
  let escrowStore: import("../lib/escrow/escrow.ts").EscrowStore;
  if (normalized.pool) {
    const pgEscrow = new PgEscrowStore(normalized.pool);
    pgEscrow.init().catch((err: unknown) => {
      console.error("[sovereign] PgEscrowStore init failed:", err);
      if (process.env.NODE_ENV === "production") process.exit(1);
    });
    escrowStore = pgEscrow;
  } else {
    escrowStore = new InMemoryEscrowStore();
  }
  // ── TrackRecordCache: PgTrackRecordCache when pool provided, else InMemory (dev/test) ──
  let trackRecordCache: TrackRecordCache;
  if (normalized.pool) {
    const pgCache = new PgTrackRecordCache(normalized.pool);
    pgCache.init().catch((err: unknown) => {
      console.error("[sovereign] PgTrackRecordCache init failed:", err);
      if (process.env.NODE_ENV === "production") process.exit(1);
    });
    trackRecordCache = pgCache;
  } else {
    trackRecordCache = new InMemoryTrackRecordCache();
  }
  const escrow = new EscrowService(ledger, escrowStore, trackRecordCache, normalized.feeConfig);
  // Potential→Escrow loop (v74): collaboration recommendations can open escrows under policy+passport.
  const collaborationEscrowBridge = new CollaborationEscrowBridge(allPolicies, ledger, escrowStore, undefined, { signer });
  // ── SettlementStore + SettlementService (Settlement #3) ─────────────────────
  // PgSettlementStore when pool provided (durable across restarts),
  // else InMemorySettlementStore (dev/test, zero-config).
  let settlementStore: SettlementStore;
  if (normalized.pool) {
    const pgSettlement = new PgSettlementStore(normalized.pool);
    pgSettlement.init().catch((err: unknown) => {
      console.error("[sovereign] PgSettlementStore init failed:", err);
      if (process.env.NODE_ENV === "production") process.exit(1);
    });
    settlementStore = pgSettlement;
  } else {
    settlementStore = new InMemorySettlementStore();
  }
  // ── RailRegistry: wire before SettlementService so release()/partialRelease() disburse ──
  // Platform default: ManualSettlementRail registered under "*".
  // Production: railRegistry.register(tenantId, new StripeSettlementRail({...}))
  const railRegistry = new InMemoryRailRegistry();
  railRegistry.register("*", new ManualSettlementRail({}, "manual-default"));

  const settlement = new SettlementService(ledger, settlementStore, railRegistry);
  // ── WebhookService (Settlement #4 wiring) ─────────────────────────────────
  // PgWebhookStore + HttpWebhookRelayer when pool is provided (production/TFA_PERSIST=pg);
  // InMemoryWebhookStore + InMemoryWebhookRelayer in dev/test (no external dependencies).
  let webhookStore: WebhookStore;
  let webhookDeliveryLog: WebhookDeliveryLog;
  const webhookRelayer: WebhookRelayer = normalized.webhookRelayer
    ?? (normalized.pool ? new HttpWebhookRelayer() : new InMemoryWebhookRelayer());
  if (normalized.pool) {
    const pgWebhookStore = new PgWebhookStore(normalized.pool);
    pgWebhookStore.init().catch((err: unknown) => {
      console.error("[sovereign] PgWebhookStore init failed:", err);
      if (process.env.NODE_ENV === "production") process.exit(1);
    });
    webhookStore = pgWebhookStore;
    // Delivery log durability (MANIFEST v318 "next missing" #1): without this the
    // log of dispatch outcomes — including swallowed failures after the relayer's
    // retries are exhausted — reverted to in-memory-only even under TFA_PERSIST=pg.
    const pgWebhookDeliveryLog = new PgWebhookDeliveryLog(normalized.pool);
    pgWebhookDeliveryLog.init().catch((err: unknown) => {
      console.error("[sovereign] PgWebhookDeliveryLog init failed:", err);
      if (process.env.NODE_ENV === "production") process.exit(1);
    });
    webhookDeliveryLog = pgWebhookDeliveryLog;
  } else {
    webhookStore = new InMemoryWebhookStore();
    webhookDeliveryLog = new InMemoryWebhookDeliveryLog();
  }
  const webhookService = new WebhookService(webhookStore, webhookRelayer, webhookDeliveryLog);
  // ── Threshold-approval store (Settlement #4 wiring) ───────────────────────
  // PgThresholdApprovalStore when a pool is present so REPLAY PROTECTION SURVIVES
  // RESTART (a spent approval token stays spent); InMemory in dev/test. Same
  // pool-present ⇒ durable rule as every other trust store.
  let approvalStore: ThresholdApprovalStore;
  if (normalized.pool) {
    const pgApprovals = new PgThresholdApprovalStore(normalized.pool);
    pgApprovals.init().catch((err: unknown) => {
      console.error("[sovereign] PgThresholdApprovalStore init failed:", err);
      if (process.env.NODE_ENV === "production") process.exit(1);
    });
    approvalStore = pgApprovals;
  } else {
    approvalStore = new InMemoryThresholdApprovalStore();
  }
  // ── NonceRegistry: PgNonceRegistry when pool provided (replay protection ──
  // survives restart), else InMemoryNonceRegistry (dev/test, TTL-pruned).
  // Same pool-present ⇒ durable rule as every other trust store.
  // PgNonceRegistry.init() must be awaited before serving traffic;
  // buildSovereignStackAsync handles this (same pattern as PgThresholdApprovalStore).
  let nonceRegistry: NonceRegistry;
  if (normalized.pool) {
    const pgNonces = new PgNonceRegistry(normalized.pool);
    pgNonces.init().catch((err: unknown) => {
      console.error("[sovereign] PgNonceRegistry init failed:", err);
      if (process.env.NODE_ENV === "production") process.exit(1);
    });
    nonceRegistry = pgNonces;
  } else {
    nonceRegistry = new InMemoryNonceRegistry();
  }
  // J1 sub-step 2 (part A: api-keys). Same pattern as PgPersonalityStore/PgEscrowStore:
  // a revocation must survive a restart, same trust guarantee as audit/escrow.
  let apiKeyStore: ApiKeyStore;
  if (normalized.pool) {
    const pgApiKeys = new PgApiKeyStore(normalized.pool);
    pgApiKeys.init().catch((err: unknown) => {
      console.error("[sovereign] PgApiKeyStore init failed:", err);
      if (process.env.NODE_ENV === "production") process.exit(1);
    });
    apiKeyStore = pgApiKeys;
  } else {
    apiKeyStore = new InMemoryApiKeyStore();
  }
  const apiKeyService = new ApiKeyService(apiKeyStore);
  // ── Trust-Graph read-model store (Indexer #5) ─────────────────────────────
  // InMemoryReadModelStore in dev/test; PgReadModelStore when pool is provided
  // (same pattern as PgAuditSync, PgEscrowStore, etc. — pool present ⇒ durable).
  let readModelStore: InMemoryReadModelStore | PgReadModelStore;
  if (normalized.pool) {
    const pgReadModel = new PgReadModelStore(normalized.pool);
    pgReadModel.init().catch((err: unknown) => {
      console.error("[sovereign] PgReadModelStore init failed:", err);
      if (process.env.NODE_ENV === "production") process.exit(1);
    });
    readModelStore = pgReadModel;
  } else {
    readModelStore = new InMemoryReadModelStore();
  }
  // IndexerEventBus — auto-projection dispatcher wired to the store.
  const indexerEventBus = new IndexerEventBus(readModelStore as any);
  // IntroductionStore — cross-tenant introduction requests (K8 step 1).
  // PgIntroductionStore when pool is present (durable, survives restart);
  // InMemoryIntroductionStore in dev/test (zero-config).
  let introductionStore: IntroductionStore;
  if (normalized.pool) {
    const pgIntro = new PgIntroductionStore(normalized.pool);
    pgIntro.init().catch((err: unknown) => {
      console.error("[sovereign] PgIntroductionStore init failed:", err);
      if (process.env.NODE_ENV === "production") process.exit(1);
    });
    introductionStore = pgIntro;
  } else {
    introductionStore = new InMemoryIntroductionStore();
  }
  const killSwitch = new KillSwitch();

  // ── TransparencyLog — append-only Merkle-anchored receipt log (v230) ───────
  let transparencyLog: TransparencyLog;
  if (normalized.pool) {
    const pgLog = new PgTransparencyLogStore(normalized.pool);
    pgLog.init().catch((err: unknown) => {
      console.error("[sovereign] PgTransparencyLogStore init failed:", err);
      if (process.env.NODE_ENV === "production") process.exit(1);
    });
    transparencyLog = pgLog;
  } else {
    transparencyLog = new InMemoryTransparencyLog();
  }

  // ── Honest persistence report (v114): no green illusions about durability ──
  const persistenceReport: Record<string, "pg" | "in-memory"> = {
    ledger: provider instanceof DrizzlePaymentProvider ? "pg" : "in-memory",
    identities: identities instanceof PgIdentityStore ? "pg" : "in-memory",
    audit: auditStore instanceof PgAuditSync ? "pg" : "in-memory",
    apiKeys: apiKeyStore.constructor?.name === "PgApiKeyStore" ? "pg" : "in-memory",
    escrow: escrowStore.constructor?.name === "PgEscrowStore" ? "pg" : "in-memory",
    catalog: normalized.pool ? "pg" : "in-memory",
    personality: normalized.pool ? "pg" : "in-memory",
    successPath: normalized.pool ? "pg" : "in-memory",
    collaboration: normalized.pool ? "pg" : "in-memory",
    tenantPlans: normalized.pool ? "pg" : "in-memory",
    execution: normalized.pool ? "pg" : "in-memory",
    settlement: normalized.pool ? "pg" : "in-memory",
    webhooks: normalized.pool ? "pg" : "in-memory",
    webhookDeliveryLog: webhookDeliveryLog.constructor?.name === "PgWebhookDeliveryLog" ? "pg" : "in-memory",
    approvals: approvalStore.constructor?.name === "PgThresholdApprovalStore" ? "pg" : "in-memory",
    readModel: normalized.pool ? "pg" : "in-memory",
    kgSource: normalized.pool ? "pg" : "in-memory",
    introduction: introductionStore.constructor?.name === "PgIntroductionStore" ? "pg" : "in-memory",
    nonceRegistry: nonceRegistry instanceof PgNonceRegistry ? "pg" : "in-memory",
    transparencyLog: transparencyLog instanceof PgTransparencyLogStore ? "pg" : "in-memory",
    trackRecord: trackRecordCache.constructor?.name === "PgTrackRecordCache" ? "pg" : "in-memory",
    revocationList: "in-memory",
  };

  // Single shared PassportRevocationList instance — in-memory, always (v382).
  // All routes and the verifier share this one instance via the stack.
  const revocationList = new PassportRevocationList();

  // Single shared WitnessRegistry instance — in-memory, always (v388).
  // Holds provisioned witness verifying keys + submitted co-signature statements.
  const witnessRegistry = new WitnessRegistry();

  return { persistenceReport, ledger, potential, personalityMapper, successPathRouter, collaborationMatcher, personalityStore, successPathStore, collaborationStore, catalog, escrow, collaborationEscrowBridge, identities, signer, publicKey, monitor, policies: allPolicies, escrowStore, orchestrator, trackRecordCache, apiKeyStore, apiKeyService, tenantPlans, executionStore, executionScheduler, settlement, settlementStore, railRegistry, webhookService, webhookRelayer, approvalStore, readModelStore, indexerEventBus, kgSource, introductionStore, nonceRegistry, auditStore, killSwitch, transparencyLog, actorBaselineStore, revocationList, witnessRegistry, spendBudgetGuard };
}

/**
 * Async composition root for production.
 *
 * When `pool` is provided, creates a DrizzlePaymentProvider automatically.
 * Otherwise falls back to InMemoryLedger (tests / local dev).
 * An explicit `provider` always takes precedence.
 */
export async function buildSovereignStackAsync(
  policies: DeclarativePolicy[] = defaultPolicies(),
  opts?: BuildSovereignStackOptions,
): Promise<SovereignStack> {
  const normalized = opts ?? {};
  let provider = normalized.provider;
  if (!provider) {
    if (process.env.NODE_ENV === "production" || normalized.pool) {
      if (!normalized.pool) {
        throw new Error("DbPool is required to initialize DrizzlePaymentProvider in production");
      }
      provider = await DrizzlePaymentProvider.create(normalized.pool);
    } else {
      provider = new InMemoryLedger();
    }
  }
  // ── Catalog: await init() so it's ready before routes are mounted ──────────
  // Only build PgOpportunityCatalog when no explicit catalog is injected.
  let catalog: OpportunityCatalog | undefined;
  if (normalized.pool && !normalized.catalog) {
    const pgCatalog = new PgOpportunityCatalog(normalized.pool);
    await pgCatalog.init();
    catalog = pgCatalog;
  }
  // ── PQC provider: async resolution for real OQS/WASM modules (PQC stage-2b) ─
  // buildSovereignStack uses the sync resolver which skips dynamic-import probing.
  // In the async boot path we can await real-module discovery, so a compiled
  // provider that IS installed is discovered and wired automatically.
  // Falls back to the local simulation in zero-dep sandboxes — identical
  // behaviour, just through the async loader instead of the sync one.
  let hybridOverride: { hybridMlDsaProvider?: Signer | any; ed25519KeyPair?: Ed25519KeyPair } = {};
  const effectiveSignerKind = normalized.signerKind ?? process.env.TFA_SIGNER_KIND ?? "ed25519";
  if (effectiveSignerKind === "hybrid-ed25519-mldsa" && !normalized.hybridMlDsaProvider) {
    const pair = normalized.ed25519KeyPair ?? generateAuditKeyPair();
    const deterministicSecret = createHash("sha256").update(pair.privateKey).digest();
    const mlDsaProvider = await resolveHybridMlDsaProvider({ deterministicSecret });
    hybridOverride = { hybridMlDsaProvider: mlDsaProvider, ed25519KeyPair: pair };
  }
  // Pass catalog as pre-built to buildSovereignStack (skip its fire-and-forget path)
  // Only override catalog if we built a new one; otherwise let normalized.catalog flow through.
  const catalogOverride = catalog !== undefined ? { catalog } : {};
  const stack = buildSovereignStack(policies, { ...normalized, provider, ...catalogOverride, ...hybridOverride });
  // Await PgIdentityStore init explicitly in the async path so identities are
  // preloaded from pg before the server accepts traffic. In the sync
  // buildSovereignStack the same init runs as fire-and-forget (best-effort).
  if (stack.identities instanceof PgIdentityStore) {
    await (stack.identities as PgIdentityStore).init().catch((err: unknown) => {
      console.error("[sovereign] PgIdentityStore async init failed:", err);
      if (process.env.NODE_ENV === "production") process.exit(1);
    });
  }
  // Await approval-store init in the async path so replay protection is preloaded
  // from pg BEFORE the server accepts traffic (security-critical: a spent approval
  // must stay spent across restart). In the sync path the same init is best-effort.
  if (stack.approvalStore instanceof PgThresholdApprovalStore) {
    await (stack.approvalStore as PgThresholdApprovalStore).init().catch((err: unknown) => {
      console.error("[sovereign] PgThresholdApprovalStore async init failed:", err);
      if (process.env.NODE_ENV === "production") process.exit(1);
    });
  }
  // ── PgNonceRegistry: await init() so nonces preloaded before traffic ──────
  // Security-critical: a replayed (consumed) capability token must stay invalid
  // across a process restart. PgNonceRegistry.init() preloads all non-expired
  // nonces from pg into the in-memory mirror before any handleApproveExecution
  // call can succeed. In the sync path above init() is fire-and-forget (best-effort).
  if (stack.nonceRegistry instanceof PgNonceRegistry) {
    await (stack.nonceRegistry as PgNonceRegistry).init().catch((err: unknown) => {
      console.error("[sovereign] PgNonceRegistry async init failed:", err);
      if (process.env.NODE_ENV === "production") process.exit(1);
    });
  }
  return stack;
}

/**
 * bridgeForTenant — per-tenant CollaborationEscrowBridge with a registered delegation chain.
 * Canonical pattern: even system agents act under a chain ending in a root human — no exceptions.
 * Lazily (idempotently) registers `human-root:<tenant>` → `agent:collab-escrow-bridge:<tenant>`
 * and returns a bridge whose action source is that per-tenant agent id. Cached per stack+tenant.
 */
const _bridgeCache = new WeakMap<object, Map<string, CollaborationEscrowBridge>>();
export function bridgeForTenant(stack: SovereignStack, tenantId: string): CollaborationEscrowBridge {
  let m = _bridgeCache.get(stack);
  if (!m) { m = new Map(); _bridgeCache.set(stack, m); }
  const hit = m.get(tenantId);
  if (hit) return hit;
  const rootId = `human-root:${tenantId}`;
  const agentId = `agent:collab-escrow-bridge:${tenantId}`;
  const ids = stack.identities;
  if (!ids.getById(rootId)) ids.create({ id: rootId, tenantId, type: "human", parentId: null, createdAt: new Date().toISOString() } as any);
  if (!ids.getById(agentId)) ids.create({ id: agentId, tenantId, type: "agent", parentId: rootId, createdAt: new Date().toISOString() } as any);
  const bridge = new CollaborationEscrowBridge(stack.policies, stack.ledger, stack.escrowStore, undefined, { signer: stack.signer }, agentId);
  m.set(tenantId, bridge);
  return bridge;
}

/**
 * mcpServerFromStack — canonical factory for TfaMcpServer wired to a SovereignStack.
 *
 * Guarantees that the MCP server uses the stack's `nonceRegistry` (PgNonceRegistry
 * in production, InMemoryNonceRegistry in dev/test) so replay protection for
 * approval capability tokens is durable and survives process restart.
 *
 * Callers should prefer this factory over `new TfaMcpServer(...)` directly;
 * the constructor still accepts a bare config for library consumers that manage
 * their own registry, but this is the fail-safe path for TFA deployments.
 *
 * @param stack  — A built SovereignStack (call buildSovereignStack() once per process).
 * @param opts   — Optional overrides for signer, executionStore, serverVersion, etc.
 *                 `nonceRegistry` is ALWAYS taken from `stack.nonceRegistry` and cannot
 *                 be overridden — this is the invariant the factory enforces.
 */
export function mcpServerFromStack(
  stack: SovereignStack,
  opts?: Omit<TfaMcpServerConfig, "nonceRegistry">,
): TfaMcpServer {
  if (!stack.nonceRegistry) {
    throw new Error(
      "mcpServerFromStack: stack.nonceRegistry is missing. " +
      "Ensure buildSovereignStack() completed successfully (fail-closed).",
    );
  }
  return new TfaMcpServer({
    ...opts,
    signer: opts?.signer ?? stack.signer,
    executionStore: opts?.executionStore ?? stack.executionStore,
    nonceRegistry: stack.nonceRegistry,
    settlementService: opts?.settlementService ?? stack.settlement,
    trackRecordCache: opts?.trackRecordCache ?? stack.trackRecordCache,
    actorBaselineStore: opts?.actorBaselineStore ?? stack.actorBaselineStore,
  });
}
