#!/usr/bin/env node
/**
 * scripts/contract-coverage-report.ts — Contract-strictness report.
 *
 * For every generated `tests/contract/*.contract.test.ts` file, extract the embedded
 * SPEC / PAYLOAD / REQUIRED_RESPONSE_FIELDS literals (already resolved by gen-contract-tests.mjs)
 * and fire ONE live request per operation against a single shared in-memory sovereign server.
 * Classify each operation's live result:
 *
 *   - "verified"       : live status === SPEC.expectStatus, AND
 *                         (no REQUIRED_RESPONSE_FIELDS declared, OR all declared fields present
 *                          on the response body). The happy path was exercised AND, where a
 *                          response shape is declared, that shape was confirmed.
 *   - "reachable-only"  : route registered, no crash (status < 500, !== 405), but live status
 *                         did not match SPEC.expectStatus (e.g. 404/400/403 instead of 2xx) —
 *                         the route exists and didn't crash, but the declared happy path was
 *                         not exercised by this generic probe.
 *   - "shape-mismatch"  : live status === SPEC.expectStatus, but a declared required response
 *                         field is MISSING from the body — a contract violation.
 *   - "not-registered"  : live status === 405 — method not registered on this path.
 *   - "crash"           : live status >= 500 — server crashed handling this operation.
 *
 * Fail-closed: exit code is 1 if (shape-mismatch + not-registered + crash) > 0, else 0.
 * Writes a machine-readable report to tests/contract/COVERAGE_REPORT.json and a human summary
 * to stdout.
 *
 * Usage: node scripts/contract-coverage-report.ts
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startSovereignServer } from "../src/http/sovereign-server.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOV = path.join(__dirname, "..");
const CONTRACT_DIR = path.join(SOV, "tests", "contract");
const REPORT_PATH = path.join(CONTRACT_DIR, "COVERAGE_REPORT.json");

// ─── Extract embedded literals from a generated contract test file ───────────

interface OpSpec {
  opId: string;
  method: string;
  path: string;
  expectStatus: number;
  payload: unknown | null;
  requiredResponseFields: string[] | null;
}

function parseContractFile(file: string): OpSpec | null {
  const src = fs.readFileSync(file, "utf8");
  const specMatch = src.match(/const SPEC = \{ method: "(\w+)", path: "([^"]+)", expectStatus: (\d+) \};/);
  if (!specMatch) return null;
  const [, method, opPath, expectStatusStr] = specMatch;

  const payloadMatch = src.match(/const PAYLOAD = (\{[\s\S]*?\});/);
  const payload = payloadMatch ? JSON.parse(payloadMatch[1]) : null;

  const reqFieldsMatch = src.match(/const REQUIRED_RESPONSE_FIELDS = (\[[\s\S]*?\]);/);
  const requiredResponseFields = reqFieldsMatch ? JSON.parse(reqFieldsMatch[1]) : null;

  const opId = path.basename(file, ".contract.test.ts");
  return { opId, method, path: opPath, expectStatus: parseInt(expectStatusStr, 10), payload, requiredResponseFields };
}

// ─── Classification ────────────────────────────────────────────────────────

export type Classification = "verified" | "reachable-only" | "shape-mismatch" | "not-registered" | "crash";

export interface CoverageEntry {
  opId: string;
  method: string;
  path: string;
  expectStatus: number;
  liveStatus: number;
  hasResponseShape: boolean;
  classification: Classification;
  missingFields?: string[];
  statefulFlow?: string;
}

// ─── Stateful flow verification ─────────────────────────────────────────────
// Live-flow tests prove that certain operations work end-to-end when state is
// carried between steps. The generic probe (one dummy-id request per operation)
// cannot exercise these, so we run explicit stateful flows and upgrade
// "reachable-only" entries to "verified" when the flow succeeds.

interface FlowStep {
  opId: string;
  method: string;
  path: string;
  expectStatus: number;
  payload?: Record<string, unknown> | ((state: Record<string, unknown>) => Record<string, unknown>);
  requiredResponseFields: string[] | null;
  extract?: { key: string; fieldPath: string };
  /** When true, fetch base + path directly (no /api prefix). For health-check-style routes. */
  noApiPrefix?: boolean;
}

interface StatefulFlow {
  name: string;
  tenantId: string;
  steps: FlowStep[];
}

function getValueAtPath(obj: any, path: string): any {
  const parts = path.split(".");
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

function resolvePath(path: string, state: Record<string, unknown>): string {
  return path.replace(/\{([^}]+)\}/g, (_m, key) => {
    const v = state[key];
    return typeof v === "string" ? v : "state-missing-" + key;
  });
}

async function runStatefulFlow(base: string, flow: StatefulFlow): Promise<{ upgraded: string[]; failed: string[] }> {
  const upgraded: string[] = [];
  const failed: string[] = [];
  const state: Record<string, unknown> = {};

  for (const step of flow.steps) {
    const resolvedPath = resolvePath(step.path, state);
    const init: RequestInit = {
      method: step.method.toUpperCase(),
      headers: { "x-tenant-id": flow.tenantId, "content-type": "application/json" },
    };
    const payload = typeof step.payload === "function" ? step.payload(state) : step.payload;
    if (payload !== undefined) init.body = JSON.stringify(payload);

    const res = await fetch(base + (step.noApiPrefix ? "" : "/api") + resolvedPath, init);
    const hasResponseShape = step.requiredResponseFields !== null;

    if (res.status === step.expectStatus) {
      const body = await res.json().catch(() => ({}));
      if (step.extract) {
        const val = getValueAtPath(body, step.extract.fieldPath);
        if (val !== undefined) state[step.extract.key] = val;
      }
      if (hasResponseShape && step.requiredResponseFields) {
        const missing = step.requiredResponseFields.filter((f) => !(f in body));
        if (missing.length === 0) {
          upgraded.push(step.opId);
        } else {
          failed.push(step.opId + " (shape-mismatch: " + missing.join(", ") + ")");
        }
      } else {
        upgraded.push(step.opId);
      }
    } else {
      failed.push(step.opId + " (expected " + step.expectStatus + ", got " + res.status + ")");
    }
  }

  return { upgraded, failed };
}

const STATEFUL_FLOWS: StatefulFlow[] = [
  // ── Adapter / execution / indexer flow ────────────────────────────────────
  {
    name: "adapter-allowed",
    tenantId: "stateful-flow-adapter-allowed",
    steps: [
      {
        opId: "adapterRun",
        method: "post",
        path: "/adapter/run",
        expectStatus: 201,
        payload: {
          actorId: "agent:alpha",
          toolId: "file.read",
          resourceRef: "resource:doc-1",
          riskClass: "read_only",
          valueMicrounits: "0",
          privacyLevel: "internal",
          approvalPolicyRef: "pol:default",
          nonce: "stateful-nonce-001",
          expiry: "2099-01-01T00:00:00.000Z",
          provenance: "test",
          evidencePolicy: "ev:default",
        },
        requiredResponseFields: ["ok", "decision", "receipt"],
        extract: { key: "id", fieldPath: "receipt.executionId" },
      },
      {
        opId: "getExecutionReceipt",
        method: "get",
        path: "/execution/{id}/receipt",
        expectStatus: 200,
        requiredResponseFields: ["ok", "receipt", "workflow"],
      },
      {
        opId: "indexGetExecution",
        method: "get",
        path: "/index/executions/{id}",
        expectStatus: 200,
        requiredResponseFields: ["execution"],
      },
      {
        opId: "indexGetExecutionByAction",
        method: "get",
        path: "/index/executions/by-action/stateful-nonce-001",
        expectStatus: 200,
        requiredResponseFields: ["execution"],
      },
      {
        opId: "indexGetActorSummary",
        method: "get",
        path: "/index/actors/agent:alpha/summary",
        expectStatus: 200,
        requiredResponseFields: ["actor", "executionCount"],
      },
    ],
  },
  {
    name: "adapter-approval",
    tenantId: "stateful-flow-adapter-approval",
    steps: [
      {
        opId: "adapterRun",
        method: "post",
        path: "/adapter/run",
        expectStatus: 201,
        payload: {
          actorId: "agent:alpha",
          toolId: "file.delete",
          resourceRef: "resource:doc-1",
          riskClass: "write_destructive",
          valueMicrounits: "0",
          privacyLevel: "internal",
          approvalPolicyRef: "pol:default",
          nonce: "stateful-nonce-002",
          expiry: "2099-01-01T00:00:00.000Z",
          provenance: "test",
          evidencePolicy: "ev:default",
        },
        requiredResponseFields: ["ok", "decision", "receipt"],
        extract: { key: "id", fieldPath: "receipt.approvalToken" },
      },
      {
        opId: "approveExecution",
        method: "post",
        path: "/execution/{id}/approve",
        expectStatus: 200,
        payload: {},
        requiredResponseFields: ["ok", "workflow"],
      },
      {
        opId: "getExecutionReceipt",
        method: "get",
        path: "/execution/{id}/receipt",
        expectStatus: 200,
        requiredResponseFields: ["ok", "receipt", "workflow"],
      },
      {
        opId: "indexGetExecution",
        method: "get",
        path: "/index/executions/{id}",
        expectStatus: 200,
        requiredResponseFields: ["execution"],
      },
    ],
  },
  // ── Ledger / escrow flow ──────────────────────────────────────────────────
  {
    name: "ledger-escrow-happy",
    tenantId: "stateful-flow-escrow",
    steps: [
      {
        opId: "createLedgerAccount",
        method: "post",
        path: "/ledger/accounts",
        expectStatus: 201,
        payload: { ownerId: "payer-1", type: "personal", name: "Payer" },
        requiredResponseFields: null,
        extract: { key: "payerAccountId", fieldPath: "account.id" },
      },
      {
        opId: "createLedgerAccount",
        method: "post",
        path: "/ledger/accounts",
        expectStatus: 201,
        payload: { ownerId: "worker-1", type: "personal", name: "Worker" },
        requiredResponseFields: null,
        extract: { key: "workerAccountId", fieldPath: "account.id" },
      },
      {
        opId: "ledgerMint",
        method: "post",
        path: "/ledger/mint",
        expectStatus: 200,
        payload: (s) => ({ toAccountId: s.payerAccountId as string, amount: "1000000", memo: "mint" }),
        requiredResponseFields: ["ok", "auditId"],
        extract: { key: "mintAuditId", fieldPath: "auditId" },
      },
      {
        opId: "createEscrow",
        method: "post",
        path: "/escrow",
        expectStatus: 201,
        payload: (s) => ({
          opportunityId: "opp-stateful-001",
          payerAccountId: s.payerAccountId,
          workerAccountId: s.workerAccountId,
          amount: "500000",
        }),
        requiredResponseFields: ["ok", "agreement"],
        extract: { key: "escrowId", fieldPath: "agreement.id" },
      },
      {
        opId: "getEscrow",
        method: "get",
        path: "/escrow/{escrowId}",
        expectStatus: 200,
        requiredResponseFields: ["ok", "agreement"],
      },
      {
        opId: "getLedgerAccount",
        method: "get",
        path: "/ledger/accounts/{payerAccountId}",
        expectStatus: 200,
        requiredResponseFields: ["account"],
      },
      {
        opId: "fundEscrow",
        method: "post",
        path: "/escrow/{escrowId}/fund",
        expectStatus: 200,
        payload: { initiatedBy: "payer" },
        requiredResponseFields: ["ok", "agreement"],
      },
      {
        opId: "releaseEscrow",
        method: "post",
        path: "/escrow/{escrowId}/release",
        expectStatus: 200,
        payload: { initiatedBy: "payer" },
        requiredResponseFields: ["ok", "agreement"],
      },
      {
        opId: "indexGetEscrow",
        method: "get",
        path: "/index/escrows/{escrowId}",
        expectStatus: 200,
        requiredResponseFields: ["escrow"],
      },
      {
        // GET /api/passport/:auditId — issuance endpoint (not itself a tracked
        // contract op; not in openapi.yaml). Used here only to mint a
        // PassportClaim from the mint's auditId so indexGetPassport has a real
        // passportId to look up.
        opId: "issuePassport",
        method: "get",
        path: "/passport/{mintAuditId}",
        expectStatus: 200,
        requiredResponseFields: null,
        extract: { key: "passportId", fieldPath: "passport.passportId" },
      },
      {
        opId: "indexGetPassport",
        method: "get",
        path: "/index/passports/{passportId}",
        expectStatus: 200,
        requiredResponseFields: ["passport"],
      },
    ],
  },
  {
    name: "ledger-escrow-dispute",
    tenantId: "stateful-flow-escrow-dispute",
    steps: [
      {
        opId: "createLedgerAccount",
        method: "post",
        path: "/ledger/accounts",
        expectStatus: 201,
        payload: { ownerId: "payer-2", type: "personal", name: "Payer" },
        requiredResponseFields: null,
        extract: { key: "payerAccountId", fieldPath: "account.id" },
      },
      {
        opId: "createLedgerAccount",
        method: "post",
        path: "/ledger/accounts",
        expectStatus: 201,
        payload: { ownerId: "worker-2", type: "personal", name: "Worker" },
        requiredResponseFields: null,
        extract: { key: "workerAccountId", fieldPath: "account.id" },
      },
      {
        opId: "ledgerMint",
        method: "post",
        path: "/ledger/mint",
        expectStatus: 200,
        payload: (s) => ({ toAccountId: s.payerAccountId as string, amount: "1000000", memo: "mint" }),
        requiredResponseFields: ["ok", "auditId"],
      },
      {
        opId: "createEscrow",
        method: "post",
        path: "/escrow",
        expectStatus: 201,
        payload: (s) => ({
          opportunityId: "opp-stateful-002",
          payerAccountId: s.payerAccountId,
          workerAccountId: s.workerAccountId,
          amount: "500000",
        }),
        requiredResponseFields: ["ok", "agreement"],
        extract: { key: "escrowId", fieldPath: "agreement.id" },
      },
      {
        opId: "fundEscrow",
        method: "post",
        path: "/escrow/{escrowId}/fund",
        expectStatus: 200,
        payload: { initiatedBy: "payer" },
        requiredResponseFields: ["ok", "agreement"],
      },
      {
        opId: "disputeEscrow",
        method: "post",
        path: "/escrow/{escrowId}/dispute",
        expectStatus: 200,
        payload: { initiatedBy: "payer", reason: "test dispute" },
        requiredResponseFields: ["ok", "agreement"],
      },
      {
        opId: "undisputeEscrow",
        method: "post",
        path: "/escrow/{escrowId}/undispute",
        expectStatus: 200,
        payload: { initiatedBy: "payer" },
        requiredResponseFields: ["ok", "agreement"],
      },
      {
        opId: "refundEscrow",
        method: "post",
        path: "/escrow/{escrowId}/refund",
        expectStatus: 200,
        payload: { initiatedBy: "payer" },
        requiredResponseFields: ["ok", "agreement"],
      },
      {
        opId: "indexGetDispute",
        method: "get",
        path: "/index/disputes/{escrowId}:dispute",
        expectStatus: 200,
        requiredResponseFields: ["dispute"],
      },
    ],
  },
  // ── API-key lifecycle flow ────────────────────────────────────────────────
  {
    name: "api-key-lifecycle",
    tenantId: "stateful-flow-api-keys",
    steps: [
      {
        opId: "authApiKeysCreate",
        method: "post",
        path: "/auth/api-keys",
        expectStatus: 201,
        payload: { name: "stateful-flow-key" },
        requiredResponseFields: ["ok", "key", "secret"],
        extract: { key: "keyId", fieldPath: "key.keyId" },
      },
      {
        opId: "authApiKeysRevoke",
        method: "delete",
        path: "/auth/api-keys/{keyId}",
        expectStatus: 204,
        requiredResponseFields: null,
      },
    ],
  },
  // ── Track-record flow ─────────────────────────────────────────────────────
  {
    name: "track-record",
    tenantId: "stateful-flow-track-record",
    steps: [
      {
        opId: "adapterRun",
        method: "post",
        path: "/adapter/run",
        expectStatus: 201,
        payload: {
          actorId: "actor-tr-001",
          toolId: "file.read",
          resourceRef: "resource:doc-1",
          riskClass: "read_only",
          valueMicrounits: "0",
          privacyLevel: "internal",
          approvalPolicyRef: "pol:default",
          nonce: "stateful-nonce-tr-001",
          expiry: "2099-01-01T00:00:00.000Z",
          provenance: "test",
          evidencePolicy: "ev:default",
        },
        requiredResponseFields: ["ok", "decision", "receipt"],
        extract: { key: "actorId", fieldPath: "receipt.actorId" },
      },
      {
        opId: "getTrackRecord",
        method: "get",
        path: "/track-record/{actorId}",
        expectStatus: 200,
        requiredResponseFields: ["ok", "data"],
      },
    ],
  },

  // ── Potential Engine flows ─────────────────────────────────────────────────

  // Flow: potentialProfile + potentialPersonalityMap + getPotentialPersonality
  {
    name: "potential-personality",
    tenantId: "stateful-flow-potential-personality",
    steps: [
      {
        opId: "potentialProfile",
        method: "post",
        path: "/potential/profile",
        expectStatus: 200,
        payload: {
          userId: "user-pot-001",
          knowledgeSignals: [{ category: "typescript", value: 80, source: "test" }],
          analyticsSignals: [],
        },
        requiredResponseFields: ["ok", "auditId"],
        extract: { key: "profileUserId", fieldPath: "auditId" },
      },
      {
        opId: "potentialPersonalityMap",
        method: "post",
        path: "/potential/personality",
        expectStatus: 200,
        payload: {
          userId: "user-pot-001",
          knowledgeSignals: [{ category: "typescript", value: 80, source: "test" }],
          analyticsSignals: [],
        },
        requiredResponseFields: ["ok", "data"],
      },
      {
        opId: "getPotentialPersonality",
        method: "get",
        path: "/potential/personality/user-pot-001",
        expectStatus: 200,
        requiredResponseFields: null,
      },
    ],
  },

  // Flow: computeSuccessPath + getSuccessPath (requires catalog opportunity)
  {
    name: "potential-success-path",
    tenantId: "stateful-flow-success-path",
    steps: [
      // Create opportunity in catalog (no listing fee → no ledger required)
      {
        opId: "createCatalogOpportunity" as any,
        method: "post",
        path: "/marketplace/opportunities",
        expectStatus: 201,
        payload: {
          title: "TypeScript Engineer",
          description: "Build reliable backend systems",
          requiredStrengths: [{ category: "typescript", minScore: 60 }],
        },
        requiredResponseFields: null,
        extract: { key: "opportunityId", fieldPath: "opportunity.id" },
      },
      {
        opId: "computeSuccessPath",
        method: "post",
        path: "/potential/success-path",
        expectStatus: 200,
        payload: (state: Record<string, unknown>) => ({
          userId: "user-sp-001",
          targetOpportunityId: state["opportunityId"] ?? "opp-fallback",
          profile: {
            userId: "user-sp-001",
            tenantId: "stateful-flow-success-path",
            strengths: [{ category: "typescript", score: 40 }],
          },
        }),
        requiredResponseFields: null,
      },
      {
        opId: "getSuccessPath",
        method: "get",
        path: "/potential/success-path/user-sp-001/{opportunityId}",
        expectStatus: 200,
        requiredResponseFields: null,
      },
    ],
  },

  // Flow: findCollaborators + getCachedCollaborators
  {
    name: "potential-collaboration",
    tenantId: "stateful-flow-potential-collab",
    steps: [
      {
        opId: "findCollaborators",
        method: "post",
        path: "/potential/collaboration",
        expectStatus: 200,
        payload: {
          userId: "user-collab-001",
          userProfile: {
            userId: "user-collab-001",
            tenantId: "stateful-flow-potential-collab",
            strengths: [{ category: "typescript", score: 80 }, { category: "leadership", score: 70 }],
          },
          candidates: [
            {
              userId: "user-collab-002",
              profile: {
                userId: "user-collab-002",
                tenantId: "stateful-flow-potential-collab",
                strengths: [{ category: "design", score: 90 }, { category: "typescript", score: 60 }],
              },
            },
          ],
          minCompatibility: 30,
        },
        requiredResponseFields: null,
      },
      {
        opId: "getCachedCollaborators",
        method: "get",
        path: "/potential/collaboration/user-collab-001",
        expectStatus: 200,
        requiredResponseFields: ["matches"],
      },
    ],
  },

  // ── Ledger transfer flow ───────────────────────────────────────────────────
  {
    name: "ledger-transfer",
    tenantId: "stateful-flow-ledger-transfer",
    steps: [
      {
        opId: "createLedgerAccount" as any,
        method: "post",
        path: "/ledger/accounts",
        expectStatus: 201,
        payload: { ownerId: "user-lt-payer", type: "personal", name: "Payer" },
        requiredResponseFields: null,
        extract: { key: "fromAccountId", fieldPath: "account.id" },
      },
      {
        opId: "createLedgerAccountB" as any,
        method: "post",
        path: "/ledger/accounts",
        expectStatus: 201,
        payload: { ownerId: "user-lt-worker", type: "personal", name: "Worker" },
        requiredResponseFields: null,
        extract: { key: "toAccountId", fieldPath: "account.id" },
      },
      {
        opId: "ledgerMint" as any,
        method: "post",
        path: "/ledger/mint",
        expectStatus: 200,
        payload: (state: Record<string, unknown>) => ({
          toAccountId: state["fromAccountId"] ?? "acct-missing",
          amount: "500000",
          memo: "stateful-flow-mint",
        }),
        requiredResponseFields: null,
      },
      {
        opId: "ledgerTransfer",
        method: "post",
        path: "/ledger/transfer",
        expectStatus: 200,
        payload: (state: Record<string, unknown>) => ({
          fromAccountId: state["fromAccountId"] ?? "acct-missing",
          toAccountId: state["toAccountId"] ?? "acct-missing",
          amount: "100000",
          memo: "stateful-flow-transfer",
        }),
        requiredResponseFields: ["ok", "auditId"],
      },
    ],
  },

  // ── Index approval flow ───────────────────────────────────────────────────
  // Use POST /api/execution with an explicit approvalId to trigger
  // emitApprovalDecided → projectApproval → indexer projection.
  // Then GET /index/approvals/{approvalId} to confirm it was indexed.
  {
    name: "index-approval",
    tenantId: "stateful-flow-index-approval",
    steps: [
      {
        opId: "createExecutionWithApproval" as any,
        method: "post",
        path: "/execution",
        expectStatus: 201,
        payload: {
          actionId: "action-approval-index-001",
          approvalId: "approval-idx-fixed-001",
          riskClass: "read_only",
          approvalClass: "auto",
          approvalOutcome: "allowed",
          decisionTrace: "stateful-flow-auto-allowed",
        },
        requiredResponseFields: null,
        extract: { key: "approvalId", fieldPath: "workflow.approvalId" },
      },
      {
        opId: "indexGetApproval",
        method: "get",
        path: "/index/approvals/{approvalId}",
        expectStatus: 200,
        requiredResponseFields: null,
      },
    ],
  },

  // ── Settlement happy path ────────────────────────────────────────────────
  // create → fund → release, with ledger setup (accounts + mint) first.
  {
    name: "settlement-happy",
    tenantId: "stateful-flow-settlement",
    steps: [
      {
        opId: "createLedgerAccount",
        method: "post",
        path: "/ledger/accounts",
        expectStatus: 201,
        payload: { ownerId: "payer-st", type: "asset", name: "Payer" },
        requiredResponseFields: null,
        extract: { key: "payerAccountId", fieldPath: "account.id" },
      },
      {
        opId: "createLedgerAccount",
        method: "post",
        path: "/ledger/accounts",
        expectStatus: 201,
        payload: { ownerId: "worker-st", type: "asset", name: "Worker" },
        requiredResponseFields: null,
        extract: { key: "workerAccountId", fieldPath: "account.id" },
      },
      {
        opId: "ledgerMint",
        method: "post",
        path: "/ledger/mint",
        expectStatus: 200,
        payload: (s) => ({ toAccountId: s.payerAccountId as string, amount: "1000000", memo: "seed" }),
        requiredResponseFields: ["ok", "auditId"],
      },
      {
        opId: "createSettlement",
        method: "post",
        path: "/settlement",
        expectStatus: 201,
        payload: (s) => ({
          opportunityId: "opp-settlement-001",
          payerAccountId: s.payerAccountId,
          workerAccountId: s.workerAccountId,
          totalAmount: "500000",
          settledBy: "auth-1",
        }),
        requiredResponseFields: ["ok", "agreement"],
        extract: { key: "settlementId", fieldPath: "agreement.id" },
      },
      {
        opId: "getSettlement",
        method: "get",
        path: "/settlement/{settlementId}",
        expectStatus: 200,
        requiredResponseFields: ["ok", "agreement"],
      },
      {
        opId: "fundSettlement",
        method: "post",
        path: "/settlement/{settlementId}/fund",
        expectStatus: 200,
        payload: { initiatedBy: "auth-1" },
        requiredResponseFields: ["ok", "agreement"],
      },
      {
        opId: "releaseSettlement",
        method: "post",
        path: "/settlement/{settlementId}/release",
        expectStatus: 200,
        payload: { initiatedBy: "auth-1" },
        requiredResponseFields: ["ok", "agreement"],
      },
    ],
  },

  // ── Webhook happy path ────────────────────────────────────────────────────
  // register → list → delete
  {
    name: "webhook-happy",
    tenantId: "stateful-flow-webhook",
    steps: [
      {
        opId: "registerWebhook",
        method: "post",
        path: "/webhooks",
        expectStatus: 201,
        payload: { url: "https://example.com/hook", events: ["settlement.released"] },
        requiredResponseFields: ["ok", "registration"],
        extract: { key: "webhookId", fieldPath: "registration.id" },
      },
      {
        opId: "listWebhooks",
        method: "get",
        path: "/webhooks",
        expectStatus: 200,
        requiredResponseFields: ["ok", "registrations"],
      },
      {
        opId: "deleteWebhook",
        method: "delete",
        path: "/webhooks/{webhookId}",
        expectStatus: 200,
        requiredResponseFields: ["ok", "deleted"],
      },
    ],
  },

  // ── Settlement dispute + reverse flow ────────────────────────────────────
  // create → fund → dispute → reverse
  {
    name: "settlement-dispute-reverse",
    tenantId: "stateful-flow-settlement-dispute-reverse",
    steps: [
      {
        opId: "createLedgerAccount",
        method: "post",
        path: "/ledger/accounts",
        expectStatus: 201,
        payload: { ownerId: "payer-sdr", type: "asset", name: "Payer" },
        requiredResponseFields: null,
        extract: { key: "payerAccountId", fieldPath: "account.id" },
      },
      {
        opId: "createLedgerAccount",
        method: "post",
        path: "/ledger/accounts",
        expectStatus: 201,
        payload: { ownerId: "worker-sdr", type: "asset", name: "Worker" },
        requiredResponseFields: null,
        extract: { key: "workerAccountId", fieldPath: "account.id" },
      },
      {
        opId: "ledgerMint",
        method: "post",
        path: "/ledger/mint",
        expectStatus: 200,
        payload: (s) => ({ toAccountId: s.payerAccountId as string, amount: "1000000", memo: "seed" }),
        requiredResponseFields: ["ok", "auditId"],
      },
      {
        opId: "createSettlement",
        method: "post",
        path: "/settlement",
        expectStatus: 201,
        payload: (s) => ({
          opportunityId: "opp-settlement-sdr-001",
          payerAccountId: s.payerAccountId,
          workerAccountId: s.workerAccountId,
          totalAmount: "500000",
          settledBy: "auth-sdr",
        }),
        requiredResponseFields: ["ok", "agreement"],
        extract: { key: "settlementId", fieldPath: "agreement.id" },
      },
      {
        opId: "fundSettlement",
        method: "post",
        path: "/settlement/{settlementId}/fund",
        expectStatus: 200,
        payload: { initiatedBy: "auth-sdr" },
        requiredResponseFields: ["ok", "agreement"],
      },
      {
        opId: "disputeSettlement",
        method: "post",
        path: "/settlement/{settlementId}/dispute",
        expectStatus: 200,
        payload: { initiatedBy: "payer", reason: "test dispute" },
        requiredResponseFields: ["ok", "agreement"],
      },
      {
        opId: "reverseSettlement",
        method: "post",
        path: "/settlement/{settlementId}/reverse",
        expectStatus: 200,
        payload: { initiatedBy: "auth-sdr" },
        requiredResponseFields: ["ok", "agreement"],
      },
    ],
  },

  // ── Settlement partial-release flow ────────────────────────────────────────
  // create → fund → partial-release
  {
    name: "settlement-partial-release",
    tenantId: "stateful-flow-settlement-partial",
    steps: [
      {
        opId: "createLedgerAccount",
        method: "post",
        path: "/ledger/accounts",
        expectStatus: 201,
        payload: { ownerId: "payer-spr", type: "asset", name: "Payer" },
        requiredResponseFields: null,
        extract: { key: "payerAccountId", fieldPath: "account.id" },
      },
      {
        opId: "createLedgerAccount",
        method: "post",
        path: "/ledger/accounts",
        expectStatus: 201,
        payload: { ownerId: "worker-spr", type: "asset", name: "Worker" },
        requiredResponseFields: null,
        extract: { key: "workerAccountId", fieldPath: "account.id" },
      },
      {
        opId: "ledgerMint",
        method: "post",
        path: "/ledger/mint",
        expectStatus: 200,
        payload: (s) => ({ toAccountId: s.payerAccountId as string, amount: "1000000", memo: "seed" }),
        requiredResponseFields: ["ok", "auditId"],
      },
      {
        opId: "createSettlement",
        method: "post",
        path: "/settlement",
        expectStatus: 201,
        payload: (s) => ({
          opportunityId: "opp-settlement-spr-001",
          payerAccountId: s.payerAccountId,
          workerAccountId: s.workerAccountId,
          totalAmount: "500000",
          settledBy: "auth-spr",
        }),
        requiredResponseFields: ["ok", "agreement"],
        extract: { key: "settlementId", fieldPath: "agreement.id" },
      },
      {
        opId: "fundSettlement",
        method: "post",
        path: "/settlement/{settlementId}/fund",
        expectStatus: 200,
        payload: { initiatedBy: "auth-spr" },
        requiredResponseFields: ["ok", "agreement"],
      },
      {
        opId: "partialReleaseSettlement",
        method: "post",
        path: "/settlement/{settlementId}/partial-release",
        expectStatus: 200,
        payload: { initiatedBy: "auth-spr", amount: "100000" },
        requiredResponseFields: ["ok", "agreement"],
      },
    ],
  },

  // ── Settlement threshold-approval flow ─────────────────────────────────────
  // create (with thresholdAmount) → generateThresholdApproval
  {
    name: "settlement-threshold",
    tenantId: "stateful-flow-settlement-threshold",
    steps: [
      {
        opId: "createLedgerAccount",
        method: "post",
        path: "/ledger/accounts",
        expectStatus: 201,
        payload: { ownerId: "payer-sth", type: "asset", name: "Payer" },
        requiredResponseFields: null,
        extract: { key: "payerAccountId", fieldPath: "account.id" },
      },
      {
        opId: "createLedgerAccount",
        method: "post",
        path: "/ledger/accounts",
        expectStatus: 201,
        payload: { ownerId: "worker-sth", type: "asset", name: "Worker" },
        requiredResponseFields: null,
        extract: { key: "workerAccountId", fieldPath: "account.id" },
      },
      {
        opId: "ledgerMint",
        method: "post",
        path: "/ledger/mint",
        expectStatus: 200,
        payload: (s) => ({ toAccountId: s.payerAccountId as string, amount: "1000000", memo: "seed" }),
        requiredResponseFields: ["ok", "auditId"],
      },
      {
        opId: "createSettlement",
        method: "post",
        path: "/settlement",
        expectStatus: 201,
        payload: (s) => ({
          opportunityId: "opp-settlement-sth-001",
          payerAccountId: s.payerAccountId,
          workerAccountId: s.workerAccountId,
          totalAmount: "500000",
          settledBy: "auth-sth",
          thresholdAmount: "100000",
        }),
        requiredResponseFields: ["ok", "agreement"],
        extract: { key: "settlementId", fieldPath: "agreement.id" },
      },
      {
        opId: "generateThresholdApproval",
        method: "post",
        path: "/settlement/{settlementId}/threshold-approval",
        expectStatus: 201,
        payload: { approvedBy: "auth-sth", maxAmount: "100000" },
        requiredResponseFields: ["ok", "approval"],
      },
    ],
  },

  // ── Health check flow ─────────────────────────────────────────────────────
  // /healthz is served at root (no /api prefix), by design for k8s probes.
  // The auto-generated probe fetches /api/healthz → 404 (routing gap, not a bug).
  // This flow fetches /healthz directly to upgrade the entry to "verified".
  {
    name: "health-check",
    tenantId: "stateful-flow-health",
    steps: [
      {
        opId: "healthCheck",
        method: "get",
        path: "/healthz",
        expectStatus: 200,
        requiredResponseFields: null,
        noApiPrefix: true,
      },
    ],
  },

  // ── AP2 mandate linkage flow ──────────────────────────────────────────────
  // The generic probe (dummy workflowId) cannot reach link-mandates' happy
  // path: it requires a real, linkable (approved/running/succeeded) workflow.
  // This flow opens one via an "allowed" adapter run (read_only → auto-running),
  // then links it to a 3-mandate AP2 chain (intent → cart → payment) and
  // verifies the signed linkage + W3C VC envelope come back.
  {
    name: "ap2-mandate-linkage",
    tenantId: "stateful-flow-ap2-linkage",
    steps: [
      {
        opId: "adapterRun",
        method: "post",
        path: "/adapter/run",
        expectStatus: 201,
        payload: {
          actorId: "agent:ap2-linker",
          toolId: "file.read",
          resourceRef: "resource:ap2-doc-1",
          riskClass: "read_only",
          valueMicrounits: "0",
          privacyLevel: "internal",
          approvalPolicyRef: "pol:default",
          nonce: "stateful-nonce-ap2-link-001",
          expiry: "2099-01-01T00:00:00.000Z",
          provenance: "test",
          evidencePolicy: "ev:default",
        },
        requiredResponseFields: ["ok", "decision", "receipt"],
        extract: { key: "workflowId", fieldPath: "receipt.executionId" },
      },
      {
        opId: "linkMandates",
        method: "post",
        path: "/receipt/{workflowId}/link-mandates",
        expectStatus: 201,
        payload: {
          mandates: [
            { type: "intent", id: "urn:ap2:intent:stateful-001" },
            { type: "cart", id: "urn:ap2:cart:stateful-001" },
            { type: "payment", id: "urn:ap2:payment:stateful-001" },
          ],
        },
        requiredResponseFields: ["ok", "workflowId", "status", "linkage", "vc"],
      },
    ],
  },
  // ── Execution core flow ───────────────────────────────────────────────────
  {
    name: "execution-core",
    tenantId: "stateful-flow-execution-core",
    steps: [
      {
        opId: "createExecution",
        method: "post",
        path: "/execution",
        expectStatus: 201,
        payload: {
          actionId: "action:exec-001",
        },
        requiredResponseFields: ["ok", "workflow"],
        extract: { key: "executionId", fieldPath: "workflow.id" },
      },
      {
        opId: "listExecution",
        method: "get",
        path: "/execution",
        expectStatus: 200,
        requiredResponseFields: ["ok", "workflows"],
      },
      {
        opId: "getExecution",
        method: "get",
        path: "/execution/{executionId}",
        expectStatus: 200,
        requiredResponseFields: ["ok", "workflow"],
      },
      {
        opId: "transitionExecution",
        method: "post",
        path: "/execution/{executionId}/transition",
        expectStatus: 200,
        payload: { toStatus: "approved", actor: "agent:exec-001" },
        requiredResponseFields: ["ok", "workflow"],
      },
      {
        opId: "transitionExecution",
        method: "post",
        path: "/execution/{executionId}/transition",
        expectStatus: 200,
        payload: { toStatus: "running", actor: "agent:exec-001" },
        requiredResponseFields: ["ok", "workflow"],
      },
    ],
  },
  // ── Execution supervision flow ────────────────────────────────────────────
  {
    name: "execution-supervise",
    tenantId: "stateful-flow-execution-supervise",
    steps: [
      {
        opId: "createExecution",
        method: "post",
        path: "/execution",
        expectStatus: 201,
        payload: {
          actionId: "action:exec-002",
        },
        requiredResponseFields: ["ok", "workflow"],
        extract: { key: "executionId", fieldPath: "workflow.id" },
      },
      {
        opId: "transitionExecution",
        method: "post",
        path: "/execution/{executionId}/transition",
        expectStatus: 200,
        payload: { toStatus: "approved", actor: "agent:exec-002" },
        requiredResponseFields: ["ok", "workflow"],
      },
      {
        opId: "transitionExecution",
        method: "post",
        path: "/execution/{executionId}/transition",
        expectStatus: 200,
        payload: { toStatus: "running", actor: "agent:exec-002" },
        requiredResponseFields: ["ok", "workflow"],
      },
      {
        opId: "transitionExecution",
        method: "post",
        path: "/execution/{executionId}/transition",
        expectStatus: 200,
        payload: { toStatus: "failed", actor: "agent:exec-002" },
        requiredResponseFields: ["ok", "workflow"],
      },
      {
        opId: "superviseExecution",
        method: "post",
        path: "/execution/{executionId}/supervise",
        expectStatus: 200,
        payload: { workerId: "worker-001" },
        requiredResponseFields: ["ok", "plan", "original"],
      },
    ],
  },
  // ── Readiness probe (root path, no /api prefix) ───────────────────────────
  {
    name: "readiness-check",
    tenantId: "stateful-flow-readiness",
    steps: [
      {
        opId: "readinessCheck",
        method: "get",
        path: "/readyz",
        expectStatus: 200,
        requiredResponseFields: ["ok", "ready"],
        noApiPrefix: true,
      },
    ],
  },
];

/**
 * Operations where a 5xx from the generic probe is *expected* and should be
 * classified as "reachable-only" rather than "crash" in the coverage summary.
 *
 * installPqcProvider (POST /admin/pqc/install) always returns 503 in the
 * sealed, no-network sandbox — a failed PQC install is documented as a normal,
 * audited outcome (spec responses["503"]), not a server error. The probe
 * receives superadmin scopes, so requireScope passes and the installer runs,
 * but the sandbox blocks outbound npm → 503 is inevitable and intentional.
 *
 * Defined at module scope so both probe() (classification) and main()
 * (CLI exit-code) use the same authoritative set.
 */
const ALLOWED_CRASH_OPIDS = new Set(["installPqcProvider"]);

async function probe(base: string, op: OpSpec): Promise<CoverageEntry> {
  const livePath = op.path.replace(/\{[^}]+\}/g, "contract-test-id-0000");
  const init: RequestInit = {
    method: op.method.toUpperCase(),
    headers: { "x-tenant-id": "contract-coverage-" + op.opId, "content-type": "application/json" },
  };
  if (op.payload !== null) init.body = JSON.stringify(op.payload);

  const res = await fetch(base + "/api" + livePath, init);
  const hasResponseShape = op.requiredResponseFields !== null;

  if (res.status === 405) {
    return { opId: op.opId, method: op.method, path: op.path, expectStatus: op.expectStatus,
      liveStatus: res.status, hasResponseShape, classification: "not-registered" };
  }
  if (res.status >= 500) {
    // ALLOWED_CRASH_OPIDS: ops where 5xx is documented behaviour, not a crash.
    const classification = ALLOWED_CRASH_OPIDS.has(op.opId) ? "reachable-only" : "crash";
    return { opId: op.opId, method: op.method, path: op.path, expectStatus: op.expectStatus,
      liveStatus: res.status, hasResponseShape, classification };
  }
  if (res.status === op.expectStatus) {
    if (hasResponseShape) {
      const body = await res.json().catch(() => ({}));
      const missing = (op.requiredResponseFields as string[]).filter((f) => !(f in body));
      if (missing.length > 0) {
        return { opId: op.opId, method: op.method, path: op.path, expectStatus: op.expectStatus,
          liveStatus: res.status, hasResponseShape, classification: "shape-mismatch", missingFields: missing };
      }
    }
    return { opId: op.opId, method: op.method, path: op.path, expectStatus: op.expectStatus,
      liveStatus: res.status, hasResponseShape, classification: "verified" };
  }
  return { opId: op.opId, method: op.method, path: op.path, expectStatus: op.expectStatus,
    liveStatus: res.status, hasResponseShape, classification: "reachable-only" };
}

// ─── Main ──────────────────────────────────────────────────────────────────

export async function generateReport(): Promise<{ entries: CoverageEntry[]; summary: Record<string, number> }> {
  const files = fs.readdirSync(CONTRACT_DIR)
    .filter((f) => f.endsWith(".contract.test.ts"))
    .sort();

  const ops: OpSpec[] = [];
  for (const f of files) {
    const parsed = parseContractFile(path.join(CONTRACT_DIR, f));
    if (parsed) ops.push(parsed);
  }

  const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
  const port = (server.address() as { port: number }).port;
  const base = "http://127.0.0.1:" + port;

  const entries: CoverageEntry[] = [];
  try {
    for (const op of ops) {
      entries.push(await probe(base, op));
    }

    // ── Stateful flow pass: upgrade reachable-only entries where flows prove the
    //    happy path actually works with real state carried between operations.
    const entryByOpId = new Map<string, CoverageEntry>();
    for (const e of entries) entryByOpId.set(e.opId, e);

    for (const flow of STATEFUL_FLOWS) {
      const { upgraded, failed } = await runStatefulFlow(base, flow);
      for (const opId of upgraded) {
        const entry = entryByOpId.get(opId);
        if (entry && entry.classification === "reachable-only") {
          entry.classification = "verified";
          entry.statefulFlow = flow.name;
        }
      }
      // Log failures for debugging but do not downgrade already-verified entries.
      if (failed.length > 0) {
        console.error(`[stateful flow "${flow.name}"] failures:`, failed);
      }
    }
  } finally {
    server.close();
  }

  const summary: Record<string, number> = {
    total: entries.length,
    verified: 0,
    "reachable-only": 0,
    "shape-mismatch": 0,
    "not-registered": 0,
    crash: 0,
  };
  for (const e of entries) summary[e.classification]++;

  return { entries, summary };
}

async function main(): Promise<void> {
  const { entries, summary } = await generateReport();

  fs.writeFileSync(REPORT_PATH, JSON.stringify({ generatedAt: new Date().toISOString(), summary, entries }, null, 2));

  console.log("=== Contract Coverage Report ===");
  console.log(`total            : ${summary.total}`);
  console.log(`verified         : ${summary.verified}`);
  console.log(`reachable-only   : ${summary["reachable-only"]}`);
  console.log(`shape-mismatch   : ${summary["shape-mismatch"]}`);
  console.log(`not-registered   : ${summary["not-registered"]}`);
  console.log(`crash            : ${summary.crash}`);
  console.log(`report written to ${path.relative(SOV, REPORT_PATH)}`);

  // installPqcProvider is in ALLOWED_CRASH_OPIDS (module-level) — its 503 is
  // classified as "reachable-only" in probe(), so summary.crash reflects only
  // genuine unexpected crashes.
  const unexpectedCrashes = entries.filter(
    (e) => e.classification === "crash" && !ALLOWED_CRASH_OPIDS.has(e.opId),
  ).length;

  const violations = summary["shape-mismatch"] + summary["not-registered"] + unexpectedCrashes;
  if (violations > 0) {
    console.error(`\n${violations} contract violation(s) — see entries with classification !== "verified"/"reachable-only" in COVERAGE_REPORT.json`);
    process.exit(1);
  }
}

// Only run main() when executed directly (not when imported by the test).
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
