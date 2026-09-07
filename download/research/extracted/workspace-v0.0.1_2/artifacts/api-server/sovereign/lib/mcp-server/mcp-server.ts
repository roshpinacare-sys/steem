/**
 * lib/mcp-server/mcp-server.ts — TFA MCP Server (wedge #1).
 *
 * Seventeen MCP tools that wire TFA as a Trust Gate for AI agents:
 *   tfa_check_action              — server-side risk check (no side-effects)
 *   tfa_assess_risk               — unified risk assessment with score + factors + escalation + optional cross-vendor provenance fingerprint (no side-effects)
 *   tfa_start_execution           — run ActionIntent through adapter + open workflow
 *   tfa_approve_execution         — approve a planned ExecutionWorkflow
 *   tfa_get_execution             — fetch an ExecutionWorkflow by id (read-only)
 *   tfa_get_receipt               — fetch signed StatusReceipt for a workflow
 *   tfa_verify_receipt            — verify receipt signature
 *   tfa_settlement_status         — fetch SettlementAgreement state
 *   tfa_dispute_settlement        — dispute a funded settlement
 *   tfa_create_settlement         — create a new SettlementAgreement
 *   tfa_fund_settlement           — fund a settlement (payer → escrow)
 *   tfa_release_settlement        — release all remaining funds to worker
 *   tfa_partial_release_settlement — release a portion of held funds to worker
 *   tfa_reverse_settlement        — reverse a disputed settlement (return funds to payer)
 *   tfa_threshold_approval        — generate a signed threshold-approval token for large releases
 *   tfa_simulate_action           — dry-run prediction of action effect (no side-effects)
 *   tfa_simulate_policy           — what-if simulation: run intent against policy chain without executing (no side-effects)
 *
 * INVARIANTS
 * • zero-dep: no external dependencies — simple JSON-RPC 2.0 over stdio/HTTP.
 * • fail-closed: every missing/invalid input returns an error; full tenant isolation.
 * • tfa_check_action calls classifyActionServerSide (does not trust client claim).
 * • every side-effect goes through the existing executionStore — no new chokepoints.
 * • tool annotations are DERIVED from MCP_TOOL_RISK_MAP (data-driven, not hardcoded).
 */

import type { Signer, ExecutionStore, AsyncExecutionStore, ExecutionWorkflow, ActionRiskClass } from "../orchestrator/types.ts";
import type { ActionIntent } from "../orchestrator/types.ts";
import { validateActionIntent } from "../orchestrator/action-intent.ts";
import { classifyActionServerSide, CODING_ACTION_METADATA } from "../risk/coding-actions.ts";
import { resolveApprovalClass, createDecisionTrace } from "../risk/approval-policy.ts";
import {
  STATIC_RESOURCES,
  TFA_PROMPTS,
  parseTfaUri,
  readStaticResource,
  renderPrompt,
  formatReceiptResource,
  formatPassportResource,
} from "./mcp-resources-prompts.ts";
import type { ApprovalClass } from "../risk/approval-policy.ts";
import {
  runActionThroughTfa,
  verifyExecutionReceipt,
  buildStatusReceipt,
  verifyStatusReceipt,
  decisionForApprovalClass,
  type AdapterDecision,
  type ExecutionReceipt,
  type ExecutionStatusReceipt,
} from "../adapter/agent-adapter.ts";
import { verifyDecisionIntegrity } from "../adapter/decision-integrity.ts";
import { simulateAction } from "../risk/action-simulator.ts";
import { runPolicySimulation } from "../risk/policy-simulator.ts";
import type { PolicySimulationResult } from "../risk/policy-simulator.ts";
import { injectRiskClass } from "../risk/action-risk.ts";
import { approvalPolicyRouter } from "../risk/approval-policy.ts";
import { verifyTfaProof } from "../adapter/verify-tfa-proof.ts";
import { verifyArdAgent } from "../adapter/ard-verifier.ts";
import type { MandateLinkage } from "../adapter/ap2-mandate-link.ts";
import { ExecutionError } from "../orchestrator/execution-workflow.ts";
import {
  issueCapabilityToken,
  verifyCapabilityToken,
  decodeCapabilityToken,
  encodeCapabilityToken,
  CAPABILITY_TOKEN_DEFAULT_TTL_MS,
  type ApprovalCapabilityToken,
} from "./capability-token.ts";
import { InMemoryNonceRegistry, type NonceRegistry } from "./nonce-registry.ts";
import { SettlementService, SettlementError } from "../escrow/settlement.ts";
import { generateThresholdApproval, ThresholdApprovalError } from "../escrow/threshold-approval.ts";
import { assessRisk } from "../risk/risk-intelligence.ts";
import type { TrackRecordCache } from "../track-record/track-record-cache.ts";
import type { ActorBaselineStore } from "../risk/actor-baseline.ts";
import type { RiskContext } from "../risk/contextual-risk.ts";
import { resolveProvenance } from "../passport/passport.ts";
import type { AgentProvenance, AgentProvenanceInput } from "../adapter/agent-provenance.ts";

// ─── JSON-RPC 2.0 types ─────────────────────────────────────────────────────

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id?: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

// ─── MCP tool schema types ──────────────────────────────────────────────────

/**
 * MCP 2025-03-26 tool annotations — tell MCP hosts (Claude Code, Cursor, etc.)
 * the safety profile of each tool so they can show warnings before execution.
 *
 * readOnlyHint:   true → tool reads state only, never writes (safe to auto-approve).
 * destructiveHint: true → tool may irreversibly modify state (show safety warning).
 * idempotentHint: true → calling N times has same effect as calling once (safe to retry).
 *
 * Derived from risk taxonomy: read-only tools from `classifyActionServerSide` METADATA
 * map to readOnlyHint=true; tools with value-transfer map to destructiveHint=true.
 * Source: https://spec.modelcontextprotocol.io/specification/2025-03-26/server/tools/#annotations
 */
export interface McpToolAnnotations {
  /** True if tool reads only, no side-effects. Enables auto-approval by host. */
  readOnlyHint?: boolean;
  /** True if tool may permanently modify/destroy state. Triggers safety prompt. */
  destructiveHint?: boolean;
  /** True if repeating the call is safe (same result, no double-effects). */
  idempotentHint?: boolean;
}

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** MCP tool annotations for host safety UI (Claude Code, Cursor, etc.) */
  annotations?: McpToolAnnotations;
}

export interface McpServerCapabilities {
  protocolVersion: string;
  capabilities: {
    tools: { listChanged: boolean };
    resources?: { listChanged: boolean; subscribe?: boolean };
    prompts?: { listChanged: boolean };
  };
  serverInfo: { name: string; version: string };
}

// ─── Tool annotation derivation from risk classification ─────────────────────

/**
 * MCP_TOOL_RISK_MAP — maps every MCP tool name to its canonical ActionRiskClass.
 * Annotations are DERIVED from this map via deriveToolAnnotations(), ensuring
 * consistency between risk taxonomy and MCP host safety hints.
 *
 * Governance-as-DATA: changing a tool's risk class here updates its annotations
 * automatically; drift-check tests enforce that every tool in getTfaMcpTools()
 * has an entry in this map.
 */
export const MCP_TOOL_RISK_MAP: Readonly<Record<string, ActionRiskClass>> = {
  // read-only / safe tools
  "tfa_check_action": "read_only",
  "tfa_assess_risk": "read_only",
  "tfa_simulate_action": "read_only",
  "tfa_simulate_policy": "read_only",
  "tfa_get_execution": "read_only",
  "tfa_get_receipt": "read_only",
  "tfa_verify_receipt": "read_only",
  "tfa_verify_ard_agent": "read_only",
  "tfa_settlement_status": "read_only",
  "tfa_threshold_approval": "read_only",

  // destructive / value-moving tools
  "tfa_start_execution": "irreversible",
  "tfa_approve_execution": "write_destructive",
  "tfa_dispute_settlement": "write_destructive",
  "tfa_fund_settlement": "value_moving",
  "tfa_release_settlement": "value_moving",
  "tfa_partial_release_settlement": "value_moving",
  "tfa_reverse_settlement": "value_moving",

  // neutral: creates state but not destructive
  "tfa_create_settlement": "write_safe",
} as const;

/**
 * deriveToolAnnotations — compute MCP 2025-03-26 annotation hints from an
 * ActionRiskClass. fail-closed: unknown risk classes return the most
 * restrictive annotation profile (destructive + non-idempotent).
 */
export function deriveToolAnnotations(riskClass: ActionRiskClass): McpToolAnnotations {
  switch (riskClass) {
    case "read_only":
    case "privacy_sensitive":
      return { readOnlyHint: true, destructiveHint: false, idempotentHint: true };
    case "write_safe":
      // write_safe is neutral: not read-only, not destructive, but also not
      // guaranteed idempotent (e.g. create_settlement creates new state each time).
      return { readOnlyHint: false, destructiveHint: false, idempotentHint: false };
    case "write_destructive":
    case "value_moving":
    case "irreversible":
    case "regulated":
      return { readOnlyHint: false, destructiveHint: true, idempotentHint: false };
    default:
      // fail-closed: unrecognised risk class = most restrictive
      return { readOnlyHint: false, destructiveHint: true, idempotentHint: false };
  }
}

// ─── Server config ──────────────────────────────────────────────────────────

export interface TfaMcpServerConfig {
  signer: Signer;
  executionStore: ExecutionStore | AsyncExecutionStore;
  protocolVersion?: string;
  serverName?: string;
  serverVersion?: string;
  /** TTL in ms for issued ApprovalCapabilityTokens (default: 15 min). */
  capabilityTtlMs?: number;
  /**
   * Replay-protection registry for capability-token nonces.
   * Required since v212 — the constructor is fail-closed when absent.
   * Use InMemoryNonceRegistry for dev/test, or PgNonceRegistry (preloaded via
   * `await registry.init()`) for durability across restarts.
   */
  nonceRegistry: NonceRegistry;
  /** Optional SettlementService for settlement-aware MCP tools (tfa_settlement_status, tfa_dispute_settlement). */
  settlementService?: SettlementService;
  /** Optional TrackRecordCache for reputation-aware risk assessment (tfa_assess_risk). */
  trackRecordCache?: TrackRecordCache;
  /** Optional ActorBaselineStore for velocity-aware risk assessment (tfa_assess_risk). */
  actorBaselineStore?: ActorBaselineStore;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function rpcError(id: string | number | null | undefined, code: number, message: string, data?: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message, data } };
}

function rpcResult(id: string | number | null | undefined, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id: id ?? null, result };
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${field} is required and must be a non-empty string`);
  }
  return value;
}

function parseValueMicrounits(v: unknown): bigint {
  if (v === undefined || v === null) return 0n;
  if (typeof v === "bigint") return v;
  if (typeof v === "number") {
    if (!Number.isInteger(v)) throw new Error("valueMicrounits must be an integer");
    return BigInt(v);
  }
  if (typeof v === "string") {
    if (!/^-?\d+$/.test(v)) throw new Error("valueMicrounits must be an integer decimal string");
    return BigInt(v);
  }
  throw new Error("valueMicrounits must be a number or decimal string");
}

/** בניית ActionIntent מ-params של כלי MCP — fail-closed. */
function buildIntentFromParams(params: Record<string, unknown>): ActionIntent {
  const valueMicrounits = parseValueMicrounits(params.valueMicrounits);
  const intent = {
    tenantId: params.tenantId,
    actorId: params.actorId,
    toolId: params.toolId,
    resourceRef: params.resourceRef,
    riskClass: params.riskClass ?? "read_only",
    valueMicrounits,
    privacyLevel: params.privacyLevel ?? "internal",
    approvalPolicyRef: params.approvalPolicyRef ?? "default",
    nonce: params.nonce,
    expiry: params.expiry,
    provenance: params.provenance ?? "mcp",
    evidencePolicy: params.evidencePolicy ?? "default",
  } as ActionIntent;
  return validateActionIntent(intent);
}

async function handleAssessRisk(
  params: Record<string, unknown>,
  cfg: TfaMcpServerConfig,
): Promise<Record<string, unknown>> {
  const valid = buildIntentFromParams(params);

  // Server-side classification overrides client claim.
  const { riskClass: serverRiskClass } = classifyActionServerSide(valid.toolId);
  const baseApprovalClass = resolveApprovalClass(serverRiskClass);

  // Build behavioural context from intent value.
  const riskContext: RiskContext = {
    valueMicrounits: valid.valueMicrounits > 0n ? valid.valueMicrounits : undefined,
  };

  // Enrich with actor baseline if store is available.
  if (cfg.actorBaselineStore) {
    try {
      const baseline = cfg.actorBaselineStore.getBaseline(valid.tenantId, valid.actorId);
      const recent = cfg.actorBaselineStore.getRecentCount(valid.tenantId, valid.actorId);
      if (baseline > 0) riskContext.actorBaselineCount = baseline;
      if (recent > 0) riskContext.actorRecentCount = recent;
    } catch {
      // best-effort: baseline unavailable → assess without it
    }
  }

  // Enrich with reputation score if cache is available.
  let reputationScore: number | undefined;
  if (cfg.trackRecordCache) {
    try {
      const record = await Promise.resolve(cfg.trackRecordCache.get(valid.tenantId, valid.actorId));
      if (record) reputationScore = record.score;
    } catch {
      // best-effort: cache unavailable → assess without it
    }
  }

  const assessment = assessRisk({ baseApprovalClass, context: riskContext, reputationScore });

  // Optional cross-vendor agent identity (v316): same normalization as the
  // passport subsystem, so a provenanceId computed here is stable and
  // comparable against the one later embedded in the issued passport.
  // NOTE: deliberately read from `params.agentProvenance`, NOT
  // `params.provenance` — ActionIntent already owns an unrelated string
  // field called `provenance` (the intent's origin channel, e.g. "mcp"),
  // consumed above inside buildIntentFromParams. Reusing that key here
  // would silently feed an object where a string is required and fail
  // ActionIntent validation instead of doing what the caller intended.
  // fail-closed: invalid agentProvenance (missing vendor/agentId) throws
  // and is surfaced as a JSON-RPC error by the tools/call dispatcher.
  const provenance = resolveProvenance(
    params.agentProvenance as AgentProvenanceInput | AgentProvenance | undefined,
  );

  return {
    assessment: {
      riskScore: assessment.riskScore,
      baseApprovalClass: assessment.baseApprovalClass,
      effectiveApprovalClass: assessment.effectiveApprovalClass,
      escalated: assessment.escalated,
      reputationBand: assessment.reputationBand,
      factors: assessment.factors,
      contextual: assessment.contextual,
      explanation: assessment.explanation,
    },
    serverRiskClass,
    intentSummary: {
      tenantId: valid.tenantId,
      actorId: valid.actorId,
      toolId: valid.toolId,
      resourceRef: valid.resourceRef,
      valueMicrounits: valid.valueMicrounits.toString(),
    },
    // provenance is included only when the caller supplied agent identity —
    // mirrors the same optional-field convention used on ActionPassport.
    ...(provenance !== undefined ? { provenance } : {}),
  };
}

/** רשימת הכלים הקנוניים של MCP server. אנוטציות נגזרות מ-MCP_TOOL_RISK_MAP. */
export function getTfaMcpTools(): McpTool[] {
  return [
    {
      name: "tfa_check_action",
      description: "Server-side risk classification + policy decision for an ActionIntent. No side-effects.",
      inputSchema: {
        type: "object",
        required: ["tenantId", "actorId", "toolId", "resourceRef", "nonce", "expiry"],
        properties: {
          tenantId: { type: "string", description: "Tenant that owns the intent" },
          actorId: { type: "string", description: "Unique actor identifier" },
          toolId: { type: "string", description: "Canonical tool identifier (e.g. file.read, shell.exec)" },
          resourceRef: { type: "string", description: "Resource being acted upon" },
          riskClass: { type: "string", description: "Client-supplied risk claim (overridden by server)" },
          valueMicrounits: { type: "string", description: "Monetary value in micro-cents (μ¢) as decimal string" },
          nonce: { type: "string", description: "Unique nonce for replay protection" },
          expiry: { type: "string", description: "ISO-8601 timestamp after which the intent is invalid" },
        },
      },
      annotations: deriveToolAnnotations(MCP_TOOL_RISK_MAP["tfa_check_action"]),
    },
    {
      name: "tfa_assess_risk",
      description: "Unified risk assessment: fuses static floor, behavioural signals (velocity/value), and actor reputation into a single explainable risk score (0-100) with escalation path. Optionally accepts cross-vendor agent provenance (vendor/agentId) and echoes back a deterministic provenanceId for cross-vendor audit correlation. No side-effects. Use before tfa_start_execution to preview risk.",
      inputSchema: {
        type: "object",
        required: ["tenantId", "actorId", "toolId", "resourceRef", "nonce", "expiry"],
        properties: {
          tenantId: { type: "string", description: "Tenant that owns the intent" },
          actorId: { type: "string", description: "Unique actor identifier" },
          toolId: { type: "string", description: "Canonical tool identifier (e.g. file.delete, token.swap)" },
          resourceRef: { type: "string", description: "Resource being acted upon" },
          riskClass: { type: "string", description: "Client-supplied risk claim (overridden by server)" },
          valueMicrounits: { type: "string", description: "Monetary value in micro-cents (μ¢) as decimal string" },
          nonce: { type: "string", description: "Unique nonce for replay protection" },
          expiry: { type: "string", description: "ISO-8601 timestamp after which the intent is invalid" },
          provenance: { type: "string", description: "Internal: intent origin channel, defaults to 'mcp'. Not agent identity — see agentProvenance." },
          agentProvenance: {
            type: "object",
            description: "Optional cross-vendor agent identity (distinct from the unrelated 'provenance' channel field above). Normalized into a deterministic provenanceId (fail-closed: invalid vendor/agentId returns an error) so the same calling agent fingerprints identically here and in any passport later issued for the same action.",
            required: ["vendor", "agentId"],
            properties: {
              vendor: { type: "string", description: "Vendor/platform running the agent (e.g. anthropic, openai, cursor)" },
              agentId: { type: "string", description: "Stable agent identifier within the vendor" },
              product: { type: "string", description: "Optional product surface (e.g. claude-code, cursor)" },
              model: { type: "string", description: "Optional model identifier" },
              sessionId: { type: "string", description: "Optional session/run id for correlating multi-step work" },
            },
          },
        },
      },
      annotations: deriveToolAnnotations(MCP_TOOL_RISK_MAP["tfa_assess_risk"]),
    },
    {
      name: "tfa_start_execution",
      description: "Evaluate an ActionIntent through TFA, open an ExecutionWorkflow, and return a signed receipt.",
      inputSchema: {
        type: "object",
        required: ["tenantId", "actorId", "toolId", "resourceRef", "nonce", "expiry"],
        properties: {
          tenantId: { type: "string" },
          actorId: { type: "string" },
          toolId: { type: "string" },
          resourceRef: { type: "string" },
          riskClass: { type: "string" },
          valueMicrounits: { type: "string" },
          nonce: { type: "string" },
          expiry: { type: "string" },
          privacyLevel: { type: "string" },
          approvalPolicyRef: { type: "string" },
          evidencePolicy: { type: "string" },
        },
      },
      annotations: deriveToolAnnotations(MCP_TOOL_RISK_MAP["tfa_start_execution"]),
    },
    {
      name: "tfa_approve_execution",
      description: "Approve a planned ExecutionWorkflow and advance it to running. Provide `approvalCapabilityToken` (canonical; matches the field on ExecutionReceipt) — or its legacy alias `capabilityToken` — from tfa_start_execution for hardened, replay-protected approval. Bare-executionId approval (no capability token) is DEPRECATED and emits a warning.",
      inputSchema: {
        type: "object",
        required: ["tenantId", "executionId"],
        properties: {
          tenantId: { type: "string" },
          executionId: { type: "string" },
          approvalCapabilityToken: {
            type: "string",
            description: "Canonical: signed, expiry-bound capability token from tfa_start_execution (base64url). Mirrors ExecutionReceipt.approvalCapabilityToken. Preferred over `capabilityToken`.",
          },
          capabilityToken: {
            type: "string",
            description: "Legacy alias for `approvalCapabilityToken` (kept for backward compatibility). If both are provided they must be identical.",
          },
          actor: { type: "string", description: "Optional actor label (defaults to mcp-approval)" },
          reason: { type: "string", description: "Optional approval reason" },
        },
      },
      annotations: deriveToolAnnotations(MCP_TOOL_RISK_MAP["tfa_approve_execution"]),
    },
    {
      name: "tfa_get_execution",
      description: "Fetch an ExecutionWorkflow by id. Read-only; returns workflow state, run log length, and timestamps. Fail-closed: wrong tenant or missing id returns error.",
      inputSchema: {
        type: "object",
        required: ["tenantId", "executionId"],
        properties: {
          tenantId: { type: "string", description: "Tenant that owns the workflow" },
          executionId: { type: "string", description: "Execution workflow identifier" },
        },
      },
      annotations: deriveToolAnnotations(MCP_TOOL_RISK_MAP["tfa_get_execution"]),
    },
    {
      name: "tfa_get_receipt",
      description: "Retrieve a signed ExecutionStatusReceipt for a workflow (polling / webhook proof).",
      inputSchema: {
        type: "object",
        required: ["tenantId", "executionId"],
        properties: {
          tenantId: { type: "string" },
          executionId: { type: "string" },
        },
      },
      annotations: deriveToolAnnotations(MCP_TOOL_RISK_MAP["tfa_get_receipt"]),
    },
    {
      name: "tfa_verify_receipt",
      description: "Verify an ExecutionReceipt or ExecutionStatusReceipt: signature authenticity AND decision correctness via the unified verifier (verifyTfaProof). Optional AP2 mandateLinkage is verified when supplied. Returns {valid, signatureValid, decisionValid, mandateLinkageValid?, reasons}.",
      inputSchema: {
        type: "object",
        required: ["receipt"],
        properties: {
          receipt: { type: "object", description: "The receipt object to verify" },
          mandateLinkage: { type: "object", description: "Optional AP2 MandateLinkage to verify and bind to this receipt" },
        },
      },
      annotations: deriveToolAnnotations(MCP_TOOL_RISK_MAP["tfa_verify_receipt"]),
    },
    {
      name: "tfa_verify_ard_agent",
      description: "Verify an ARD (Agentic Resource Discovery) v0.9-draft agent identity: check URN well-formedness, domain↔identity alignment, detached JWS signature (alg allow-list EdDSA/HS256), and attestation digest presence. Given a urn:ai:... and a trustManifest, returns {valid, checks, reasons}. Zero-dep; fail-closed.",
      inputSchema: {
        type: "object",
        required: ["urn", "trustManifest"],
        properties: {
          urn: { type: "string", description: "Agent URN, e.g. urn:ai:example.com:ns:agent-name" },
          trustManifest: {
            type: "object",
            description: "ARD trustManifest object (identity, attestations, provenance, signature)",
          },
        },
      },
      annotations: deriveToolAnnotations(MCP_TOOL_RISK_MAP["tfa_verify_ard_agent"]),
    },
    {
      name: "tfa_settlement_status",
      description: "Retrieve the current state of a SettlementAgreement by id. Fail-closed: wrong tenant or missing id returns error.",
      inputSchema: {
        type: "object",
        required: ["tenantId", "settlementId"],
        properties: {
          tenantId: { type: "string", description: "Tenant that owns the settlement" },
          settlementId: { type: "string", description: "Settlement agreement identifier" },
        },
      },
      annotations: deriveToolAnnotations(MCP_TOOL_RISK_MAP["tfa_settlement_status"]),
    },
    {
      name: "tfa_dispute_settlement",
      description: "Dispute a funded settlement, freezing further releases. Returns the updated agreement state.",
      inputSchema: {
        type: "object",
        required: ["tenantId", "settlementId", "disputedBy"],
        properties: {
          tenantId: { type: "string", description: "Tenant that owns the settlement" },
          settlementId: { type: "string", description: "Settlement agreement identifier" },
          disputedBy: { type: "string", description: "Identity raising the dispute" },
          disputeReason: { type: "string", description: "Optional human-readable reason for the dispute" },
        },
      },
      annotations: deriveToolAnnotations(MCP_TOOL_RISK_MAP["tfa_dispute_settlement"]),
    },
    {
      name: "tfa_create_settlement",
      description: "Create a new SettlementAgreement between payer and worker. No money moves yet. Returns the created agreement.",
      inputSchema: {
        type: "object",
        required: ["tenantId", "opportunityId", "payerAccountId", "workerAccountId", "totalAmount", "settledBy"],
        properties: {
          tenantId: { type: "string", description: "Tenant that owns the settlement" },
          opportunityId: { type: "string", description: "Opportunity identifier" },
          payerAccountId: { type: "string", description: "Payer ledger account id" },
          workerAccountId: { type: "string", description: "Worker ledger account id" },
          totalAmount: { type: "string", description: "Total amount in μ¢ (decimal string, e.g. '200000')" },
          settledBy: { type: "string", description: "Identity authorized to release/dispute/reverse funds" },
          thresholdAmount: { type: "string", description: "Optional threshold in μ¢ (decimal string). Releases above this require a ThresholdApproval token." },
        },
      },
      annotations: deriveToolAnnotations(MCP_TOOL_RISK_MAP["tfa_create_settlement"]),
    },
    {
      name: "tfa_fund_settlement",
      description: "Fund a settlement by transferring totalAmount from payer to the escrow account. Settlement state becomes 'held'.",
      inputSchema: {
        type: "object",
        required: ["tenantId", "settlementId", "initiatedBy"],
        properties: {
          tenantId: { type: "string", description: "Tenant that owns the settlement" },
          settlementId: { type: "string", description: "Settlement agreement identifier" },
          initiatedBy: { type: "string", description: "Identity initiating the fund (must match settledBy)" },
        },
      },
      annotations: deriveToolAnnotations(MCP_TOOL_RISK_MAP["tfa_fund_settlement"]),
    },
    {
      name: "tfa_release_settlement",
      description: "Release all remaining held funds to the worker. Settlement state becomes 'released'.",
      inputSchema: {
        type: "object",
        required: ["tenantId", "settlementId", "initiatedBy"],
        properties: {
          tenantId: { type: "string", description: "Tenant that owns the settlement" },
          settlementId: { type: "string", description: "Settlement agreement identifier" },
          initiatedBy: { type: "string", description: "Identity initiating the release (must match settledBy)" },
        },
      },
      annotations: deriveToolAnnotations(MCP_TOOL_RISK_MAP["tfa_release_settlement"]),
    },
    {
      name: "tfa_partial_release_settlement",
      description: "Release a portion of held funds to the worker. Settlement state becomes 'partially_released' (or 'released' if fully drained).",
      inputSchema: {
        type: "object",
        required: ["tenantId", "settlementId", "amount", "initiatedBy"],
        properties: {
          tenantId: { type: "string", description: "Tenant that owns the settlement" },
          settlementId: { type: "string", description: "Settlement agreement identifier" },
          amount: { type: "string", description: "Amount to release in μ¢ (decimal string, must be positive and ≤ remaining)" },
          initiatedBy: { type: "string", description: "Identity initiating the partial release (must match settledBy)" },
        },
      },
      annotations: deriveToolAnnotations(MCP_TOOL_RISK_MAP["tfa_partial_release_settlement"]),
    },
    {
      name: "tfa_reverse_settlement",
      description: "Reverse a disputed settlement, returning all unreleased funds to the payer. Settlement state becomes 'reversed'.",
      inputSchema: {
        type: "object",
        required: ["tenantId", "settlementId", "initiatedBy"],
        properties: {
          tenantId: { type: "string", description: "Tenant that owns the settlement" },
          settlementId: { type: "string", description: "Settlement agreement identifier" },
          initiatedBy: { type: "string", description: "Identity initiating the reverse (must match settledBy)" },
        },
      },
      annotations: deriveToolAnnotations(MCP_TOOL_RISK_MAP["tfa_reverse_settlement"]),
    },
    {
      name: "tfa_threshold_approval",
      description: "Generate a signed, single-use threshold-approval token for a large release on a settlement that has a thresholdAmount. The token must be presented when releasing/partial-releasing an amount above the threshold.",
      inputSchema: {
        type: "object",
        required: ["tenantId", "settlementId", "maxAmount", "approvedBy"],
        properties: {
          tenantId: { type: "string", description: "Tenant that owns the settlement" },
          settlementId: { type: "string", description: "Settlement agreement identifier" },
          maxAmount: { type: "string", description: "Maximum amount this token authorises in μ¢ (decimal string, must be positive)" },
          approvedBy: { type: "string", description: "Identity issuing the approval (must match settledBy)" },
        },
      },
      annotations: deriveToolAnnotations(MCP_TOOL_RISK_MAP["tfa_threshold_approval"]),
    },
    {
      name: "tfa_simulate_action",
      description: "Pre-action dry-run: predict an action's effect (reversibility, blast radius, value-at-risk, warnings) WITHOUT executing. Lets an AI agent preview a risky action before deciding. No side-effects.",
      inputSchema: {
        type: "object",
        required: ["actionType"],
        properties: {
          actionType: { type: "string", description: "Canonical action/tool id (e.g. file.delete, db.migration, token.swap)" },
          valueMicrounits: { type: "string", description: "Value at stake in micro-cents (μ¢) as a decimal string, for value-moving actions" },
          resourceRef: { type: "string", description: "Optional resource reference for a human-readable predicted effect" },
        },
      },
      annotations: deriveToolAnnotations(MCP_TOOL_RISK_MAP["tfa_simulate_action"]),
    },
    {
      name: "tfa_simulate_policy",
      description: "What-if policy simulation: run an ActionIntent against the server's policy chain WITHOUT executing. Returns per-policy decisions, effective approval class, risk assessment, predicted effect, and a human-readable summary. Ideal for pre-flight checks and governance comparison. No side-effects.",
      inputSchema: {
        type: "object",
        required: ["tenantId", "actorId", "toolId", "resourceRef"],
        properties: {
          tenantId: { type: "string", description: "Tenant identifier" },
          actorId: { type: "string", description: "Actor identifier" },
          toolId: { type: "string", description: "Canonical action/tool id (e.g. ledger.transfer, file.delete)" },
          resourceRef: { type: "string", description: "Resource reference being acted upon" },
          riskClass: { type: "string", description: "Client-claimed risk class (overridden by server-side classification)" },
          valueMicrounits: { type: "string", description: "Value at stake in μ¢ as a decimal string" },
          reputationScore: { type: "number", description: "Optional reputation score (0–100) for risk-intelligence fusion" },
          nonce: { type: "string", description: "Unique nonce (replay protection). Generated if omitted." },
          expiry: { type: "string", description: "ISO-8601 expiry. Defaults to +1h if omitted." },
        },
      },
      annotations: deriveToolAnnotations(MCP_TOOL_RISK_MAP["tfa_simulate_policy"]),
    },
  ];
}

// ─── Tool implementations ───────────────────────────────────────────────────

async function handleSimulateAction(
  params: Record<string, unknown>,
  _cfg: TfaMcpServerConfig,
): Promise<Record<string, unknown>> {
  const actionType = params.actionType;
  if (typeof actionType !== "string" || actionType.length === 0) {
    throw new ExecutionError("invalid_params", "tfa_simulate_action: actionType must be a non-empty string");
  }
  let valueMicrounits: bigint | undefined;
  if (params.valueMicrounits !== undefined && params.valueMicrounits !== null && params.valueMicrounits !== "") {
    try {
      valueMicrounits = BigInt(String(params.valueMicrounits));
    } catch {
      throw new ExecutionError("invalid_params", "tfa_simulate_action: valueMicrounits must be an integer string (μ¢)");
    }
  }
  const resourceRef = typeof params.resourceRef === "string" ? params.resourceRef : undefined;
  const sim = simulateAction({ actionType, valueMicrounits, resourceRef });
  // BigInt → decimal string for JSON transport (canonical μ¢ representation).
  return {
    ...sim,
    valueAtRiskMicrounits: sim.valueAtRiskMicrounits !== undefined ? sim.valueAtRiskMicrounits.toString() : undefined,
  };
}

async function handleSimulatePolicy(
  params: Record<string, unknown>,
  cfg: TfaMcpServerConfig,
): Promise<Record<string, unknown>> {
  const valid = buildIntentFromParams(params);

  // Default policy chain: same as the live orchestrator uses.
  const policies = [injectRiskClass(), approvalPolicyRouter(cfg.signer)];

  const reputationScore = typeof params.reputationScore === "number" ? params.reputationScore : undefined;

  const sim = await runPolicySimulation({
    intent: valid,
    policies,
    signer: cfg.signer,
    reputationScore,
  });

  // Strip non-serialisable / large fields for JSON-RPC transport.
  return {
    wouldAllow: sim.wouldAllow,
    adapterDecision: sim.adapterDecision,
    riskClass: sim.riskClass,
    baseApprovalClass: sim.baseApprovalClass,
    effectiveApprovalClass: sim.effectiveApprovalClass,
    guardDecision: sim.guardDecision,
    policyDecisions: sim.policyDecisions.map((pd) => ({
      name: pd.name,
      allow: pd.decision.allow,
      reason: pd.decision.reason,
    })),
    simulation: sim.simulation,
    contextualRisk: sim.contextualRisk,
    riskAssessment: sim.riskAssessment
      ? {
          riskScore: sim.riskAssessment.riskScore,
          reputationBand: sim.riskAssessment.reputationBand,
          factors: sim.riskAssessment.factors,
          explanation: sim.riskAssessment.explanation,
        }
      : undefined,
    summary: sim.summary,
    decisionTracePreview: sim.decisionTracePreview
      ? {
          approvedAt: sim.decisionTracePreview.approvedAt,
          approvedBy: sim.decisionTracePreview.approvedBy,
          hasSignature: !!sim.decisionTracePreview.signature,
        }
      : undefined,
  };
}

async function handleCheckAction(
  params: Record<string, unknown>,
  _cfg: TfaMcpServerConfig,
): Promise<Record<string, unknown>> {
  const valid = buildIntentFromParams(params);

  // Server-side classification overrides client claim.
  const { riskClass: serverRiskClass, source: riskSource } = classifyActionServerSide(valid.toolId);
  const approvalClass = resolveApprovalClass(serverRiskClass);
  const decision = decisionForApprovalClass(approvalClass);

  const meta = (CODING_ACTION_METADATA as Record<string, { description: string; rationale: string }>)[valid.toolId];

  return {
    decision,
    serverRiskClass,
    clientClaimedRiskClass: valid.riskClass,
    riskSource,
    approvalClass,
    metadata: meta
      ? { description: meta.description, rationale: meta.rationale }
      : { description: "Unknown action type", rationale: "No metadata available for this toolId" },
  };
}

async function handleStartExecution(
  params: Record<string, unknown>,
  cfg: TfaMcpServerConfig,
): Promise<Record<string, unknown>> {
  const valid = buildIntentFromParams(params);
  const result = runActionThroughTfa(valid, cfg.signer, {
    executionStore: cfg.executionStore as ExecutionStore,
  });

  const body: Record<string, unknown> = {
    ok: true,
    decision: result.decision,
    approvalClass: result.approvalClass,
    riskClass: result.riskClass,
    serverRiskClass: result.serverRiskClass,
    clientClaimedRiskClass: result.clientClaimedRiskClass,
    riskSource: result.riskSource,
    receipt: result.receipt,
  };

  if (result.receipt.executionId) {
    body.executionId = result.receipt.executionId;
    const wf = await Promise.resolve(cfg.executionStore.get(result.receipt.executionId, valid.tenantId));
    if (wf) body.workflow = serializeWorkflow(wf);
  }
  if (result.receipt.approvalToken) {
    body.approvalToken = result.receipt.approvalToken;
    const wfId = result.receipt.approvalToken;
    const wf = await Promise.resolve(cfg.executionStore.get(wfId, valid.tenantId));
    if (wf) body.workflow = serializeWorkflow(wf);

    // Issue a signed capability token for tfa_approve_execution.
    // This upgrades the weak workflow-id approvalToken to a cryptographically
    // bound, expiry-protected, nonce-carrying capability.
    const capToken = issueCapabilityToken(
      wfId,
      valid.tenantId,
      cfg.signer,
      cfg.capabilityTtlMs ?? CAPABILITY_TOKEN_DEFAULT_TTL_MS,
    );
    body.capabilityToken = encodeCapabilityToken(capToken);
    // Canonical mirror of the receipt field name — clients should prefer
    // `approvalCapabilityToken` (matches ExecutionReceipt). The legacy
    // `capabilityToken` is retained for backward compatibility.
    body.approvalCapabilityToken = body.capabilityToken;
    body.capabilityTokenExpiry = capToken.expiresAt;
  }

  return body;
}

async function handleApproveExecution(
  params: Record<string, unknown>,
  cfg: TfaMcpServerConfig,
  nonceRegistry: NonceRegistry,
): Promise<Record<string, unknown>> {
  const tenantId = requireString(params.tenantId, "tenantId");
  const executionId = requireString(params.executionId, "executionId");
  const actor = (typeof params.actor === "string" && params.actor.length > 0) ? params.actor : "mcp-approval";
  const reason = typeof params.reason === "string" ? params.reason : "approved via MCP tfa_approve_execution";

  // ── Capability token verification (preferred, hardened path) ─────────────
  // Two accepted field names, both equivalent:
  //   • `approvalCapabilityToken` — canonical: matches the field on
  //     ExecutionReceipt (clients should echo what they got from
  //     tfa_start_execution / receipt.approvalCapabilityToken).
  //   • `capabilityToken` — legacy alias, kept for backward compatibility.
  // If both are supplied they MUST be identical (fail-closed otherwise).
  // Absence preserves the legacy bearer-of-the-workflow-id contract, but
  // is now DEPRECATED and surfaced via a warning + `deprecated:true` flag.
  let capabilityVerified = false;
  const capCanonical = params.approvalCapabilityToken;
  const capLegacy = params.capabilityToken;
  let capTokenInput: unknown = undefined;
  if (capCanonical !== undefined && capLegacy !== undefined) {
    if (capCanonical !== capLegacy) {
      return { ok: false, error: "approvalCapabilityToken and capabilityToken disagree (conflicting tokens)" };
    }
    capTokenInput = capCanonical;
  } else if (capCanonical !== undefined) {
    capTokenInput = capCanonical;
  } else if (capLegacy !== undefined) {
    capTokenInput = capLegacy;
  }
  if (capTokenInput !== undefined) {
    if (typeof capTokenInput !== "string" || capTokenInput.length === 0) {
      return { ok: false, error: "approvalCapabilityToken must be a non-empty string" };
    }
    const decoded = decodeCapabilityToken(capTokenInput);
    if (!decoded) {
      return { ok: false, error: "approvalCapabilityToken is not a valid base64url-encoded capability token" };
    }
    const result = verifyCapabilityToken(decoded, cfg.signer, executionId, tenantId);
    if (!result.valid) {
      return { ok: false, error: `capability token invalid: ${(result as {valid: false; reason: string}).reason}` };
    }
    const nonce = (result as {valid: true; nonce: string}).nonce;
    if (nonceRegistry.has(nonce)) {
      return { ok: false, error: "capability token nonce has already been used (replay attack prevented)" };
    }
    // Record until the token's own expiry — after that, replay is already
    // blocked by verifyCapabilityToken's expiry check above.
    nonceRegistry.add(nonce, decoded.expiresAt);
    capabilityVerified = true;
  }

  const wf = await Promise.resolve(cfg.executionStore.get(executionId, tenantId));
  if (!wf) {
    return { ok: false, error: "workflow not found" };
  }
  if (wf.status !== "planned") {
    return { ok: false, error: `only a "planned" workflow can be approved (current status: "${wf.status}")` };
  }

  await Promise.resolve(cfg.executionStore.transition(executionId, tenantId, "approved", actor as string, reason));
  const running = await Promise.resolve(
    cfg.executionStore.transition(executionId, tenantId, "running", actor as string, "execution started"),
  );

  const response: Record<string, unknown> = { ok: true, workflow: serializeWorkflow(running), capabilityVerified };
  if (!capabilityVerified) {
    // DEPRECATED: bare-executionId approval. Emit a warning + machine-readable
    // flag so callers can migrate. A future major bump may make this 401.
    response.warning =
      "DEPRECATED: bare-executionId approval (no approvalCapabilityToken). " +
      "Echo `approvalCapabilityToken` from tfa_start_execution / receipt to harden against replay.";
    response.deprecated = true;
    try {
      // eslint-disable-next-line no-console
      console.warn(
        "[tfa_approve_execution] DEPRECATED bare-executionId approval (no approvalCapabilityToken)",
        { tenantId, executionId, actor },
      );
    } catch { /* logging is best-effort */ }
  }
  return response;
}

async function handleGetExecution(
  params: Record<string, unknown>,
  cfg: TfaMcpServerConfig,
): Promise<Record<string, unknown>> {
  const tenantId = requireString(params.tenantId, "tenantId");
  const executionId = requireString(params.executionId, "executionId");

  const wf = await Promise.resolve(cfg.executionStore.get(executionId, tenantId));
  if (!wf) {
    return { ok: false, error: "workflow not found" };
  }

  return { ok: true, workflow: serializeWorkflow(wf) };
}

async function handleGetReceipt(
  params: Record<string, unknown>,
  cfg: TfaMcpServerConfig,
): Promise<Record<string, unknown>> {
  const tenantId = requireString(params.tenantId, "tenantId");
  const executionId = requireString(params.executionId, "executionId");

  const wf = await Promise.resolve(cfg.executionStore.get(executionId, tenantId));
  if (!wf) {
    return { ok: false, error: "workflow not found" };
  }

  const receipt = buildStatusReceipt(wf, cfg.signer);
  if (!verifyStatusReceipt(receipt, cfg.signer)) {
    return { ok: false, error: "status receipt signature verification failed (internal error)" };
  }

  return { ok: true, receipt, workflow: serializeWorkflow(wf) };
}

async function handleVerifyReceipt(
  params: Record<string, unknown>,
  cfg: TfaMcpServerConfig,
): Promise<Record<string, unknown>> {
  const receipt = params.receipt;
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) {
    return { ok: false, error: "receipt must be an object" };
  }

  const r = receipt as Record<string, unknown>;
  const version = r.version;

  if (version === "tfa-receipt-v1") {
    const ml = params.mandateLinkage;
    const mandateLinkage = (ml && typeof ml === "object" && !Array.isArray(ml))
      ? (ml as MandateLinkage)
      : undefined;

    const verdict = verifyTfaProof(r as unknown as ExecutionReceipt, {
      keys: cfg.signer,
      mandateLinkage,
    });

    const result: Record<string, unknown> = {
      ok: true,
      valid: verdict.valid,
      signatureValid: verdict.checks.authenticity,
      decisionValid: verdict.checks.decisionIntegrity,
      reasons: verdict.reasons,
    };
    if (verdict.checks.mandateLinkage !== undefined) {
      result.mandateLinkageValid = verdict.checks.mandateLinkage;
    }
    return result;
  }
  if (version === "tfa-status-receipt-v1") {
    const signatureValid = verifyStatusReceipt(r as unknown as ExecutionStatusReceipt, cfg.signer);
    return {
      ok: true,
      valid: signatureValid, // backward-compat aggregate
      signatureValid,
      decisionValid: true, // status receipts carry no policy decision to re-derive
      reasons: [],
    };
  }

  return { ok: false, error: "unknown receipt version" };
}

async function handleVerifyArdAgent(
  params: Record<string, unknown>,
  cfg: TfaMcpServerConfig,
): Promise<Record<string, unknown>> {
  const urn = params.urn;
  if (!urn || typeof urn !== "string") {
    return { ok: false, error: "urn is required and must be a string" };
  }
  const trustManifest = params.trustManifest;
  if (!trustManifest || typeof trustManifest !== "object" || Array.isArray(trustManifest)) {
    return { ok: false, error: "trustManifest is required and must be an object" };
  }

  const verdict = verifyArdAgent({
    urn,
    trustManifest: trustManifest as any,
    signer: cfg.signer,
  });

  return {
    ok: true,
    valid: verdict.valid,
    checks: verdict.checks,
    reasons: verdict.reasons,
  };
}

function serializeSettlement(a: { id: string; tenantId: string; opportunityId: string; payerAccountId: string; workerAccountId: string; escrowAccountId: string; totalAmount: bigint; releasedAmount: bigint; state: string; createdAt: string; settledBy: string; releaseAuditIds?: string[]; reversalAuditId?: string; fundAuditId?: string; disputedBy?: string; disputeReason?: string; thresholdAmount?: bigint }): Record<string, unknown> {
  return {
    id: a.id,
    tenantId: a.tenantId,
    opportunityId: a.opportunityId,
    payerAccountId: a.payerAccountId,
    workerAccountId: a.workerAccountId,
    escrowAccountId: a.escrowAccountId,
    totalAmount: a.totalAmount.toString(),
    releasedAmount: a.releasedAmount.toString(),
    state: a.state,
    createdAt: a.createdAt,
    settledBy: a.settledBy,
    releaseAuditIds: a.releaseAuditIds ?? null,
    reversalAuditId: a.reversalAuditId ?? null,
    fundAuditId: a.fundAuditId ?? null,
    disputedBy: a.disputedBy ?? null,
    disputeReason: a.disputeReason ?? null,
    thresholdAmount: a.thresholdAmount !== undefined ? a.thresholdAmount.toString() : null,
  };
}

async function handleSettlementStatus(
  params: Record<string, unknown>,
  cfg: TfaMcpServerConfig,
): Promise<Record<string, unknown>> {
  const tenantId = requireString(params.tenantId, "tenantId");
  const settlementId = requireString(params.settlementId, "settlementId");

  if (!cfg.settlementService) {
    return { ok: false, error: "settlement service not configured" };
  }

  const agreement = await Promise.resolve(cfg.settlementService.get(tenantId, settlementId));
  if (!agreement) {
    return { ok: false, error: "settlement not found" };
  }

  return { ok: true, settlement: serializeSettlement(agreement) };
}

async function handleDisputeSettlement(
  params: Record<string, unknown>,
  cfg: TfaMcpServerConfig,
): Promise<Record<string, unknown>> {
  const tenantId = requireString(params.tenantId, "tenantId");
  const settlementId = requireString(params.settlementId, "settlementId");
  const disputedBy = requireString(params.disputedBy, "disputedBy");
  const disputeReason = typeof params.disputeReason === "string" ? params.disputeReason : undefined;

  if (!cfg.settlementService) {
    return { ok: false, error: "settlement service not configured" };
  }

  try {
    const agreement = await Promise.resolve(cfg.settlementService.dispute(tenantId, settlementId, disputedBy, disputeReason));
    return { ok: true, settlement: serializeSettlement(agreement) };
  } catch (e: any) {
    if (e instanceof SettlementError) {
      return { ok: false, error: e.message, code: e.code };
    }
    throw e;
  }
}

async function handleCreateSettlement(
  params: Record<string, unknown>,
  cfg: TfaMcpServerConfig,
): Promise<Record<string, unknown>> {
  const tenantId = requireString(params.tenantId, "tenantId");
  const opportunityId = requireString(params.opportunityId, "opportunityId");
  const payerAccountId = requireString(params.payerAccountId, "payerAccountId");
  const workerAccountId = requireString(params.workerAccountId, "workerAccountId");
  const totalAmount = parseValueMicrounits(params.totalAmount);
  if (totalAmount <= 0n) {
    throw new Error("totalAmount must be a positive integer (μ¢)");
  }
  const settledBy = requireString(params.settledBy, "settledBy");
  const thresholdAmount = params.thresholdAmount !== undefined ? parseValueMicrounits(params.thresholdAmount) : undefined;

  if (!cfg.settlementService) {
    return { ok: false, error: "settlement service not configured" };
  }

  try {
    const agreement = await Promise.resolve(
      cfg.settlementService.create({
        tenantId,
        opportunityId,
        payerAccountId,
        workerAccountId,
        totalAmount,
        settledBy,
        thresholdAmount,
      }),
    );
    return { ok: true, settlement: serializeSettlement(agreement) };
  } catch (e: any) {
    if (e instanceof SettlementError) {
      return { ok: false, error: e.message, code: e.code };
    }
    throw e;
  }
}

async function handleFundSettlement(
  params: Record<string, unknown>,
  cfg: TfaMcpServerConfig,
): Promise<Record<string, unknown>> {
  const tenantId = requireString(params.tenantId, "tenantId");
  const settlementId = requireString(params.settlementId, "settlementId");
  const initiatedBy = requireString(params.initiatedBy, "initiatedBy");

  if (!cfg.settlementService) {
    return { ok: false, error: "settlement service not configured" };
  }

  try {
    const agreement = await Promise.resolve(cfg.settlementService.fund(tenantId, settlementId, initiatedBy));
    return { ok: true, settlement: serializeSettlement(agreement) };
  } catch (e: any) {
    if (e instanceof SettlementError) {
      return { ok: false, error: e.message, code: e.code };
    }
    throw e;
  }
}

async function handleReleaseSettlement(
  params: Record<string, unknown>,
  cfg: TfaMcpServerConfig,
): Promise<Record<string, unknown>> {
  const tenantId = requireString(params.tenantId, "tenantId");
  const settlementId = requireString(params.settlementId, "settlementId");
  const initiatedBy = requireString(params.initiatedBy, "initiatedBy");

  if (!cfg.settlementService) {
    return { ok: false, error: "settlement service not configured" };
  }

  try {
    const agreement = await Promise.resolve(cfg.settlementService.release(tenantId, settlementId, initiatedBy));
    return { ok: true, settlement: serializeSettlement(agreement) };
  } catch (e: any) {
    if (e instanceof SettlementError) {
      return { ok: false, error: e.message, code: e.code };
    }
    throw e;
  }
}

async function handlePartialReleaseSettlement(
  params: Record<string, unknown>,
  cfg: TfaMcpServerConfig,
): Promise<Record<string, unknown>> {
  const tenantId = requireString(params.tenantId, "tenantId");
  const settlementId = requireString(params.settlementId, "settlementId");
  const amount = parseValueMicrounits(params.amount);
  if (amount <= 0n) {
    throw new Error("amount must be a positive integer (μ¢)");
  }
  const initiatedBy = requireString(params.initiatedBy, "initiatedBy");

  if (!cfg.settlementService) {
    return { ok: false, error: "settlement service not configured" };
  }

  try {
    const agreement = await Promise.resolve(cfg.settlementService.partialRelease(tenantId, settlementId, amount, initiatedBy));
    return { ok: true, settlement: serializeSettlement(agreement) };
  } catch (e: any) {
    if (e instanceof SettlementError) {
      return { ok: false, error: e.message, code: e.code };
    }
    throw e;
  }
}

async function handleReverseSettlement(
  params: Record<string, unknown>,
  cfg: TfaMcpServerConfig,
): Promise<Record<string, unknown>> {
  const tenantId = requireString(params.tenantId, "tenantId");
  const settlementId = requireString(params.settlementId, "settlementId");
  const initiatedBy = requireString(params.initiatedBy, "initiatedBy");

  if (!cfg.settlementService) {
    return { ok: false, error: "settlement service not configured" };
  }

  try {
    const agreement = await Promise.resolve(cfg.settlementService.reverse(tenantId, settlementId, initiatedBy));
    return { ok: true, settlement: serializeSettlement(agreement) };
  } catch (e: any) {
    if (e instanceof SettlementError) {
      return { ok: false, error: e.message, code: e.code };
    }
    throw e;
  }
}

async function handleThresholdApproval(
  params: Record<string, unknown>,
  cfg: TfaMcpServerConfig,
): Promise<Record<string, unknown>> {
  const tenantId = requireString(params.tenantId, "tenantId");
  const settlementId = requireString(params.settlementId, "settlementId");
  const maxAmount = parseValueMicrounits(params.maxAmount);
  if (maxAmount <= 0n) {
    throw new Error("maxAmount must be a positive integer (μ¢)");
  }
  const approvedBy = requireString(params.approvedBy, "approvedBy");

  if (!cfg.settlementService) {
    return { ok: false, error: "settlement service not configured" };
  }

  const existing = await Promise.resolve(cfg.settlementService.get(tenantId, settlementId));
  if (!existing) {
    return { ok: false, error: "settlement not found", code: "not_found" };
  }
  if (approvedBy !== existing.settledBy) {
    return {
      ok: false,
      error: `threshold approval must be issued by the settlement authority ('${existing.settledBy}')`,
      code: "unauthorized",
    };
  }

  try {
    const approval = generateThresholdApproval(
      cfg.signer.sign("threshold-secret-context"),
      {
        agreementId: settlementId,
        tenantId,
        maxAmount,
        approvedBy,
      },
    );
    return {
      ok: true,
      approval: {
        id: approval.id,
        agreementId: approval.agreementId,
        maxAmount: approval.maxAmount,
        approvedBy: approval.approvedBy,
        issuedAt: approval.issuedAt,
        expiresAt: approval.expiresAt,
        token: approval.token,
      },
    };
  } catch (e: any) {
    if (e instanceof ThresholdApprovalError) {
      return { ok: false, error: e.message, code: e.code };
    }
    throw e;
  }
}

function serializeWorkflow(wf: ExecutionWorkflow): Record<string, unknown> {
  return {
    id: wf.id,
    tenantId: wf.tenantId,
    actionId: wf.actionId,
    intentId: wf.intentId ?? null,
    status: wf.status,
    createdAt: wf.createdAt,
    updatedAt: wf.updatedAt,
    leaseExpiresAt: wf.leaseExpiresAt,
    claimedBy: wf.claimedBy,
    executionRef: wf.executionRef ?? null,
    approvalId: wf.approvalId ?? null,
    runLogLength: wf.runLog.length,
  };
}

// ─── Server class ───────────────────────────────────────────────────────────

export class TfaMcpServer {
  private readonly cfg: TfaMcpServerConfig;
  private initialized = false;
  /** Nonce deduplication registry for capability tokens (replay protection, TTL-pruned). */
  private readonly nonceRegistry: NonceRegistry;

  constructor(cfg: TfaMcpServerConfig) {
    this.cfg = cfg;
    if (!cfg.nonceRegistry) {
      throw new Error(
        "TfaMcpServer: nonceRegistry is required. " +
          "Use mcpServerFromStack(stack) which wires the stack's nonceRegistry automatically, " +
          "or pass opts.nonceRegistry explicitly (InMemoryNonceRegistry for dev/test, PgNonceRegistry for production).",
      );
    }
    this.nonceRegistry = cfg.nonceRegistry;
  }

  /** עיבוד בקשת JSON-RPC 2.0 יחידה והחזרת תשובה. מחזיר Promise<null> עבור התראות (notifications). */
  async handleRequest(req: JsonRpcRequest): Promise<JsonRpcResponse | null> {
    if (req.jsonrpc !== "2.0") {
      return rpcError(req.id, -32600, "Invalid Request: jsonrpc must be \"2.0\"");
    }

    switch (req.method) {
      case "initialize":
        return this.handleInitialize(req);
      case "notifications/initialized":
        // התראה — אין תשובה
        this.initialized = true;
        return null;
      case "tools/list":
        return this.handleToolsList(req);
      case "tools/call":
        return await this.handleToolsCall(req);
      case "resources/list":
        return this.handleResourcesList(req);
      case "resources/read":
        return await this.handleResourcesRead(req);
      case "prompts/list":
        return this.handlePromptsList(req);
      case "prompts/get":
        return this.handlePromptsGet(req);
      default:
        return rpcError(req.id, -32601, `Method not found: ${req.method}`);
    }
  }

  private handleInitialize(req: JsonRpcRequest): JsonRpcResponse {
    const params = (req.params ?? {}) as Record<string, unknown>;
    const clientProtocol = typeof params.protocolVersion === "string" ? params.protocolVersion : "2024-11-05";
    const supported = this.cfg.protocolVersion ?? "2024-11-05";

    // פשוט מאוד: תומך בכל גרסה שמתחילה באותו תאריך
    if (!clientProtocol.startsWith(supported.slice(0, 7))) {
      return rpcError(req.id, -32602, `Unsupported protocol version: ${clientProtocol}`);
    }

    const result: McpServerCapabilities = {
      protocolVersion: supported,
      capabilities: {
        tools: { listChanged: false },
        resources: { listChanged: false, subscribe: false },
        prompts: { listChanged: false },
      },
      serverInfo: {
        name: this.cfg.serverName ?? "tfa-mcp-server",
        version: this.cfg.serverVersion ?? "1.0.0",
      },
    };
    return rpcResult(req.id, result);
  }

  private handleToolsList(req: JsonRpcRequest): JsonRpcResponse {
    return rpcResult(req.id, { tools: getTfaMcpTools() });
  }

  // ── Resources ──────────────────────────────────────────────────────────────

  /** resources/list — returns static + dynamic-template resources. */
  private handleResourcesList(req: JsonRpcRequest): JsonRpcResponse {
    return rpcResult(req.id, { resources: STATIC_RESOURCES });
  }

  /** resources/read — reads a tfa:// resource URI. */
  private async handleResourcesRead(req: JsonRpcRequest): Promise<JsonRpcResponse> {
    const params = (req.params ?? {}) as Record<string, unknown>;
    const uri = typeof params.uri === "string" ? params.uri : "";
    if (!uri) return rpcError(req.id, -32602, "resources/read requires a uri param");

    // Try static resources first
    const staticContent = readStaticResource(uri);
    if (staticContent) {
      return rpcResult(req.id, { contents: [staticContent] });
    }

    // Parse dynamic resource URIs
    const parsed = parseTfaUri(uri);
    if (!parsed) {
      return rpcError(req.id, -32602, `Unrecognised TFA resource URI: ${uri}`);
    }

    const { kind, id } = parsed;

    switch (kind) {
      case "receipt": {
        // Look up receipt by executionId (best-effort from executionStore)
        const store = this.cfg.executionStore;
        if (!store) {
          return rpcError(req.id, -32603, "No executionStore configured — cannot read receipt resources");
        }
        try {
          const wf = await Promise.resolve((store as any).get?.(id) ?? null);
          if (!wf) {
            return rpcError(req.id, -32002, `Receipt not found: ${id}`);
          }
          const content = formatReceiptResource(uri, wf as Record<string, unknown>);
          return rpcResult(req.id, { contents: [content] });
        } catch (e: any) {
          return rpcError(req.id, -32603, `Receipt read error: ${e?.message ?? "unknown"}`);
        }
      }

      case "passport": {
        // Look up passport by auditId (best-effort from auditStore via config)
        const auditStore = (this.cfg as any).auditStore;
        if (!auditStore) {
          return rpcError(req.id, -32603, "No auditStore in config — cannot read passport resources");
        }
        try {
          const record = await Promise.resolve(auditStore.getRecord?.(id) ?? null);
          if (!record) {
            return rpcError(req.id, -32002, `Passport/audit record not found: ${id}`);
          }
          const content = formatPassportResource(uri, record as Record<string, unknown>);
          return rpcResult(req.id, { contents: [content] });
        } catch (e: any) {
          return rpcError(req.id, -32603, `Passport read error: ${e?.message ?? "unknown"}`);
        }
      }

      default:
        return rpcError(req.id, -32602, `Unknown TFA resource kind: ${kind}. Supported: receipt, passport, gate-flow`);
    }
  }

  // ── Prompts ────────────────────────────────────────────────────────────────

  /** prompts/list — returns all TFA prompt templates. */
  private handlePromptsList(req: JsonRpcRequest): JsonRpcResponse {
    return rpcResult(req.id, { prompts: TFA_PROMPTS });
  }

  /** prompts/get — renders a prompt with the given arguments. */
  private handlePromptsGet(req: JsonRpcRequest): JsonRpcResponse {
    const params = (req.params ?? {}) as Record<string, unknown>;
    const name = typeof params.name === "string" ? params.name : "";
    const args = (params.arguments ?? {}) as Record<string, string>;

    if (!name) return rpcError(req.id, -32602, "prompts/get requires a name param");

    const messages = renderPrompt(name, args);
    if (!messages) {
      return rpcError(req.id, -32602, `Unknown TFA prompt: ${name}`);
    }

    const prompt = TFA_PROMPTS.find((p) => p.name === name);
    return rpcResult(req.id, {
      description: prompt?.description ?? "",
      messages,
    });
  }

  private async handleToolsCall(req: JsonRpcRequest): Promise<JsonRpcResponse> {
    const params = (req.params ?? {}) as Record<string, unknown>;
    const name = typeof params.name === "string" ? params.name : "";
    const args = (params.arguments ?? {}) as Record<string, unknown>;

    if (!name) {
      return rpcError(req.id, -32602, "Tool name is required");
    }

    const cfg = this.cfg;

    try {
      let result: Record<string, unknown>;
      switch (name) {
        case "tfa_check_action":
          result = await handleCheckAction(args, cfg);
          break;
        case "tfa_assess_risk":
          result = await handleAssessRisk(args, cfg);
          break;
        case "tfa_simulate_action":
          result = await handleSimulateAction(args, cfg);
          break;
        case "tfa_simulate_policy":
          result = await handleSimulatePolicy(args, cfg);
          break;
        case "tfa_start_execution":
          result = await handleStartExecution(args, cfg);
          break;
        case "tfa_approve_execution":
          result = await handleApproveExecution(args, cfg, this.nonceRegistry);
          break;
        case "tfa_get_execution":
          result = await handleGetExecution(args, cfg);
          break;
        case "tfa_get_receipt":
          result = await handleGetReceipt(args, cfg);
          break;
        case "tfa_verify_receipt":
          result = await handleVerifyReceipt(args, cfg);
          break;
        case "tfa_verify_ard_agent":
          result = await handleVerifyArdAgent(args, cfg);
          break;
        case "tfa_settlement_status":
          result = await handleSettlementStatus(args, cfg);
          break;
        case "tfa_dispute_settlement":
          result = await handleDisputeSettlement(args, cfg);
          break;
        case "tfa_create_settlement":
          result = await handleCreateSettlement(args, cfg);
          break;
        case "tfa_fund_settlement":
          result = await handleFundSettlement(args, cfg);
          break;
        case "tfa_release_settlement":
          result = await handleReleaseSettlement(args, cfg);
          break;
        case "tfa_partial_release_settlement":
          result = await handlePartialReleaseSettlement(args, cfg);
          break;
        case "tfa_reverse_settlement":
          result = await handleReverseSettlement(args, cfg);
          break;
        case "tfa_threshold_approval":
          result = await handleThresholdApproval(args, cfg);
          break;
        default:
          return rpcError(req.id, -32602, `Unknown tool: ${name}`);
      }
      return rpcResult(req.id, { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] });
    } catch (e: any) {
      const message = e instanceof Error ? e.message : String(e);
      if (e instanceof ExecutionError) {
        return rpcError(req.id, -32000, `Execution error: ${message}`);
      }
      return rpcError(req.id, -32603, `Internal error: ${message}`);
    }
  }
}
