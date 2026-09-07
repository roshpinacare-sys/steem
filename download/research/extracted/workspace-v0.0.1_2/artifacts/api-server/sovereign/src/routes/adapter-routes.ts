/**
 * src/routes/adapter-routes.ts -- framework-agnostic HTTP handlers for the TFA
 * Agent Adapter API.
 *
 * Routes:
 *   POST /api/adapter/run
 *     Accept an ActionIntent JSON body, evaluate it through TFA, open an
 *     ExecutionWorkflow when appropriate, and return a signed ExecutionReceipt.
 *     This is the primary end-to-end entry-point: intent -> adapter -> execution.
 *
 *   POST /api/execution/:id/approve
 *     Transition a workflow that is in "planned" state (decision === approval_required)
 *     to "approved" -> "running". Returns the updated workflow and a re-signed receipt.
 *     fail-closed: only "planned" workflows may be approved; any other status -> 422.
 *
 * Invariants:
 *   - tenantId from x-tenant-id is mandatory -- fail-closed.
 *   - Cross-tenant access -> 404.
 *   - Money is BigInt μ¢; the body field `valueMicrounits` is accepted as a decimal
 *     string or integer and converted before being passed to the adapter.
 *   - The ExecutionReceipt is always re-verified before returning (fail-closed: if
 *     signer is misconfigured the route returns 500, not a bad receipt).
 *
 * Zero external dependencies.
 */

import type { Signer, ExecutionStore, AsyncExecutionStore } from "../../lib/orchestrator/types.ts";
import type { ActionIntent } from "../../lib/orchestrator/types.ts";
import { InMemoryExecutionStore } from "../../lib/orchestrator/execution-workflow.ts";
import { ExecutionError } from "../../lib/orchestrator/execution-workflow.ts";
import {
  runActionThroughTfa,
  verifyExecutionReceipt,
  buildStatusReceipt,
  verifyStatusReceipt,
  type ExecutionReceipt,
} from "../../lib/adapter/agent-adapter.ts";
import type { IndexerEventBus } from "../../lib/indexer/index.ts";
import type { ExecutionWorkflow } from "../../lib/orchestrator/types.ts";
import { createHash } from "node:crypto";
import {
  issueCapabilityToken,
  encodeCapabilityToken,
  decodeCapabilityToken,
  verifyCapabilityToken,
  CAPABILITY_TOKEN_DEFAULT_TTL_MS,
} from "../../lib/mcp-server/capability-token.ts";
import {
  InMemoryNonceRegistry,
  type NonceRegistry,
} from "../../lib/mcp-server/nonce-registry.ts";
import type { KillSwitch } from "../../lib/policy/kill-switch.ts";
import type { TransparencyLog } from "../../lib/transparency-log/types.ts";
import {
  linkReceiptToMandates,
  verifyMandateLinkage,
} from "../../lib/adapter/ap2-mandate-link.ts";
import type { Ap2MandateRef, MandateLinkage } from "../../lib/adapter/ap2-mandate-link.ts";

/**
 * Optional configuration for adapterRoutes -- additive, backward-compatible.
 *
 *   capabilityTtlMs -- lifetime (ms) of the signed ApprovalCapabilityToken
 *                     emitted alongside a raw approvalToken. Defaults to
 *                     CAPABILITY_TOKEN_DEFAULT_TTL_MS (15 minutes).
 *   nonceRegistry   -- used to detect capability-token replay on
 *                     POST /api/execution/:id/approve. If omitted an
 *                     in-memory registry is created (sufficient for a single
 *                     process; share an instance across routes for HA).
 *   transparencyLog -- anchors every approved receipt into the append-only
 *                     Merkle log (v230). Optional: the route works without it.
 */
export interface AdapterRoutesOptions {
  capabilityTtlMs?: number;
  nonceRegistry?: NonceRegistry;
  transparencyLog?: TransparencyLog;
}

export interface Ctx {
  tenantId: string;
  body: any;
  params: Record<string, string>;
  /** Lowercased request headers (e.g. "if-none-match") for conditional requests. */
  headers?: Record<string, string | string[] | undefined>;
}

export interface Res {
  status: number;
  body: any;
  /** Optional response headers (e.g. ETag, Last-Modified) merged by the server. */
  headers?: Record<string, string>;
}

export interface Route {
  method: string;
  pattern: string;
  handler: (ctx: Ctx) => Promise<Res>;
}

const ok = (body: any, status = 200): Res => ({ status, body });
const err = (status: number, message: string): Res => ({ status, body: { error: message } });

type AnyExecutionStore = ExecutionStore | AsyncExecutionStore;

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

/**
 * Parse and coerce a valueMicrounits field from the request body.
 * Accepts a decimal-string or integer. Defaults to 0n when absent.
 * fail-closed: rejects non-integer strings.
 */
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

/**
 * Build an ActionIntent from a request body, applying strict fail-closed
 * validation later via validateActionIntent inside runActionThroughTfa.
 */
function buildIntentFromBody(tenantId: string, body: any): ActionIntent {
  const b = body ?? {};
  // valueMicrounits: parse from body or default 0
  const valueMicrounits = parseValueMicrounits(b.valueMicrounits);

  return {
    tenantId,
    actorId: b.actorId,
    toolId: b.toolId,
    resourceRef: b.resourceRef,
    riskClass: b.riskClass,
    valueMicrounits,
    privacyLevel: b.privacyLevel ?? "internal",
    approvalPolicyRef: b.approvalPolicyRef ?? "default",
    nonce: b.nonce,
    expiry: b.expiry,
    provenance: b.provenance ?? "api",
    evidencePolicy: b.evidencePolicy ?? "default",
  } as ActionIntent;
}

export function adapterRoutes(
  signer: Signer,
  executionStore: AnyExecutionStore,
  indexerEventBus?: IndexerEventBus,
  opts: AdapterRoutesOptions = {},
  killSwitch?: KillSwitch,
): Route[] {
  const capabilityTtlMs = opts.capabilityTtlMs ?? CAPABILITY_TOKEN_DEFAULT_TTL_MS;
  const nonceRegistry: NonceRegistry = opts.nonceRegistry ?? new InMemoryNonceRegistry();
  const transparencyLog: TransparencyLog | undefined = opts.transparencyLog;
  return [
    // -- POST /api/adapter/run -------------------------------------------------
    // intent -> policy evaluation -> ExecutionWorkflow -> signed receipt
    {
      method: "POST",
      pattern: "/api/adapter/run",
      handler: async (c) => {
        if (!c.tenantId) return err(400, "x-tenant-id header required");

        let intent: ActionIntent;
        try {
          intent = buildIntentFromBody(c.tenantId, c.body);
        } catch (e: any) {
          return err(400, e?.message ?? "invalid intent body");
        }

        let result: ReturnType<typeof runActionThroughTfa>;
        try {
          result = runActionThroughTfa(intent, signer, {
            executionStore: executionStore as ExecutionStore,
            killSwitch,
          });
        } catch (e: any) {
          if (e instanceof ExecutionError) {
            return err(422, e.message);
          }
          // validateActionIntent throws plain Error on bad fields
          return err(400, e?.message ?? "intent validation failed");
        }

        // fail-closed: verify the receipt we just produced
        if (!verifyExecutionReceipt(result.receipt, signer)) {
          return err(500, "receipt signature verification failed (internal error)");
        }

        // Anchor every approved receipt into the TransparencyLog (v230)
        // ReceiptId = intentId (unique, replay-protected) for later proof lookup.
        if (transparencyLog) {
          try {
            await transparencyLog.appendReceipt(c.tenantId, result.receipt, result.receipt.intentId);
          } catch (e: any) {
            // Log but do not fail the request -- the receipt is already verified;
            // transparency anchoring is best-effort observability, not a chokepoint.
            console.error("[adapter] transparency log append failed:", e?.message ?? e);
          }
        }

        // Emit indexer event when a workflow was opened
        if (indexerEventBus && result.receipt.executionId) {
          const wf = await Promise.resolve(
            executionStore.get(result.receipt.executionId, c.tenantId),
          );
          if (wf) indexerEventBus.emit({ type: "execution.updated", tenantId: c.tenantId, workflow: wf });
        }

        const body: Record<string, unknown> = {
          ok: true,
          decision: result.decision,
          approvalClass: result.approvalClass,
          riskClass: result.riskClass,
          receipt: result.receipt,
        };
        if (result.receipt.executionId) {
          const wf = await Promise.resolve(
            executionStore.get(result.receipt.executionId, c.tenantId),
          );
          if (wf) body.workflow = serializeWorkflow(wf);
        }
        if (result.receipt.approvalToken) {
          const wfId = result.receipt.approvalToken;
          const wf = await Promise.resolve(
            executionStore.get(wfId, c.tenantId),
          );
          if (wf) body.workflow = serializeWorkflow(wf);

          // Issue a signed ApprovalCapabilityToken alongside the raw
          // approvalToken. Mirrors the MCP server: the raw token is the legacy
          // contract (backward-compatible), the capabilityToken is the
          // hardened path -- bound to executionId + tenantId, single-use via
          // nonce, expiry-protected.
          const capToken = issueCapabilityToken(
            wfId,
            c.tenantId,
            signer,
            capabilityTtlMs,
          );
          body.capabilityToken = encodeCapabilityToken(capToken);
          // Canonical mirror of the receipt field name -- clients should prefer
          // `approvalCapabilityToken` (matches ExecutionReceipt). The legacy
          // `capabilityToken` is retained for backward compatibility.
          body.approvalCapabilityToken = body.capabilityToken;
          body.capabilityTokenExpiry = capToken.expiresAt;
        }


        return ok(body, 201);
      },
    },

    // -- POST /api/execution/:id/approve -------------------------------------
    // Advance a "planned" (approval_required) workflow to approved -> running.
    {
      method: "POST",
      pattern: "/api/execution/:id/approve",
      handler: async (c) => {
        if (!c.tenantId) return err(400, "x-tenant-id header required");
        const { id } = c.params;
        if (!id) return err(400, "id param required");

        const b = c.body ?? {};
        // actor is optional; defaults to "tfa-approval"
        const actor = (b.actor && typeof b.actor === "string") ? b.actor : "tfa-approval";
        const reason = b.reason ? String(b.reason) : "approved via POST /api/execution/:id/approve";

        // -- Optional capability token (hardened path) -----------------------
        // Two accepted field names, both equivalent:
        //   - `approvalCapabilityToken` -- canonical: matches the field name on
        //     ExecutionReceipt (clients echo what they got from /run).
        //   - `capabilityToken` -- legacy alias, kept for backward compatibility
        //     with early callers and the existing capability test.
        // When supplied, the token is decoded, signature-verified, bound to
        // {executionId=id, tenantId=c.tenantId}, and its nonce is checked for
        // replay. fail-closed: any structural/semantic/replay error -> 401,
        // and we never advance the workflow. Absence preserves the legacy
        // bearer-of-the-workflow-id contract (backward-compatible).
        // If both names are supplied they must be identical -> otherwise 401.
        let capabilityVerified = false;
        const capCanonical = b.approvalCapabilityToken;
        const capLegacy = b.capabilityToken;
        let capTokenInput: unknown = undefined;
        if (capCanonical !== undefined && capLegacy !== undefined) {
          if (capCanonical !== capLegacy) {
            return err(401, "approvalCapabilityToken and capabilityToken disagree (conflicting tokens)");
          }
          capTokenInput = capCanonical;
        } else if (capCanonical !== undefined) {
          capTokenInput = capCanonical;
        } else if (capLegacy !== undefined) {
          capTokenInput = capLegacy;
        }
        if (capTokenInput !== undefined) {
          if (typeof capTokenInput !== "string" || capTokenInput.length === 0) {
            return err(401, "approvalCapabilityToken must be a non-empty string");
          }
          const decoded = decodeCapabilityToken(capTokenInput);
          if (!decoded) {
            return err(401, "approvalCapabilityToken is not a valid base64url-encoded capability token");
          }
          const vr = verifyCapabilityToken(decoded, signer, id, c.tenantId);
          if (!vr.valid) {
            return err(401, `capability token invalid: ${vr.reason}`);
          }
          if (nonceRegistry.has(vr.nonce)) {
            return err(401, "capability token nonce has already been used (replay attack prevented)");
          }
          nonceRegistry.add(vr.nonce, decoded.expiresAt);
          capabilityVerified = true;
        }

        try {
          const wf = await Promise.resolve(executionStore.get(id, c.tenantId));
          if (!wf) return err(404, "workflow not found");
          if (wf.status !== "planned") {
            return err(
              422,
              `only a "planned" workflow can be approved (current status: "${wf.status}")`,
            );
          }

          // planned -> approved -> running
          await Promise.resolve(
            executionStore.transition(id, c.tenantId, "approved", actor, reason),
          );
          const running = await Promise.resolve(
            executionStore.transition(id, c.tenantId, "running", actor, "execution started"),
          );

          if (indexerEventBus) {
            indexerEventBus.emit({ type: "execution.updated", tenantId: c.tenantId, workflow: running });
          }

          return ok({ ok: true, workflow: serializeWorkflow(running), capabilityVerified });
        } catch (e: any) {
          if (e instanceof ExecutionError) {
            switch (e.code) {
              case "workflow_not_found": return err(404, e.message);
              case "tenant_mismatch":   return err(404, "not found");
              case "invalid_transition": return err(422, e.message);
              default: return err(500, e.message);
            }
          }
          return err(500, e?.message ?? "approval failed");
        }
      },
    },
    // -- GET /api/execution/:id/receipt --------------------------------------
    // Return a freshly-signed ExecutionStatusReceipt for polling / webhook use.
    // This is the "post-approval signed proof" -- call after /approve to confirm
    // the workflow is now in "running" (or any other current) status.
    // fail-closed: 404 on cross-tenant or unknown id; 500 if receipt fails verify.
    {
      method: "GET",
      pattern: "/api/execution/:id/receipt",
      handler: async (c) => {
        if (!c.tenantId) return err(400, "x-tenant-id header required");
        const { id } = c.params;
        if (!id) return err(400, "id param required");

        let wf: ExecutionWorkflow | null = null;
        try {
          wf = await Promise.resolve(executionStore.get(id, c.tenantId));
        } catch {
          return err(500, "failed to load workflow");
        }
        if (!wf) return err(404, "workflow not found");

        let receipt;
        try {
          receipt = buildStatusReceipt(wf, signer);
        } catch (e: any) {
          return err(500, e?.message ?? "failed to build status receipt");
        }

        // fail-closed: verify before returning
        if (!verifyStatusReceipt(receipt, signer)) {
          return err(500, "status receipt signature verification failed (internal error)");
        }

        // -- Conditional GET support (receipt polling for agents/CI) ----------
        // ETag is derived from workflow state (status + updatedAt + runLog length),
        // NOT from the receipt signature (which includes issuedAt and changes on
        // every call). This ensures the ETag is stable while the workflow state is
        // unchanged and rotates only when the workflow actually transitions.
        // Last-Modified reflects the workflow's updatedAt. A matching If-None-Match
        // returns 304 with no body -- cheap polling, the receipt is the product.
        const etagBasis = JSON.stringify([wf.status, wf.updatedAt, wf.runLog.length]);
        const etag = `"${createHash("sha256").update(etagBasis).digest("hex").slice(0, 32)}"`;
        const lastModified = new Date(wf.updatedAt).toUTCString();
        const condHeaders = { etag, "last-modified": lastModified, "cache-control": "no-cache" };

        const ifNoneMatch = c.headers?.["if-none-match"];
        const inm = Array.isArray(ifNoneMatch) ? ifNoneMatch[0] : ifNoneMatch;
        if (typeof inm === "string" && inm === etag) {
          return { status: 304, body: undefined, headers: condHeaders };
        }

        return { status: 200, body: { ok: true, receipt, workflow: serializeWorkflow(wf) }, headers: condHeaders };
      },
    },

    // -- POST /api/receipt/:workflowId/link-mandates ---------------------------
    // Bind an existing ExecutionWorkflow (by id) to an AP2 mandate chain and
    // return a W3C Verifiable Credential carrying the MandateLinkage as its
    // credentialSubject. This is the final wiring of the AP2 interop path:
    //   AP2 (authorized) -> TFA (policy-gated + executed) -> VC (portable proof).
    //
    // Request body:
    //   mandates: Ap2MandateRef[]  -- at least one; order: intent -> cart -> payment
    //
    // Response (201):
    //   { ok, workflowId, status, linkage, vc }
    //   linkage: MandateLinkage -- signed, tamper-evident binding
    //   vc: W3C Verifiable Credential with linkage as credentialSubject evidence
    //
    // fail-closed:
    //   - Missing x-tenant-id -> 400
    //   - Missing / invalid mandates -> 400
    //   - Workflow not found / cross-tenant -> 404
    //   - Non-linkable status (planned, failed) -> 422
    //   - linkage signature verification fails -> 500
    {
      method: "POST",
      pattern: "/api/receipt/:workflowId/link-mandates",
      handler: async (c) => {
        if (!c.tenantId) return err(400, "x-tenant-id header required");
        const id = c.params.workflowId ?? c.params.id;
        if (!id) return err(400, "id param required");

        // -- Validate mandates from body -------------------------------------
        const raw = c.body ?? {};
        const mandatesRaw = raw.mandates;
        if (!Array.isArray(mandatesRaw) || mandatesRaw.length === 0) {
          return err(400, "mandates must be a non-empty array of Ap2MandateRef");
        }
        for (let i = 0; i < mandatesRaw.length; i++) {
          const m = mandatesRaw[i];
          if (!m || typeof m !== "object") return err(400, `mandates[${i}]: must be an object`);
          if (typeof m.type !== "string" || !["intent", "cart", "payment"].includes(m.type)) {
            return err(400, `mandates[${i}].type must be "intent" | "cart" | "payment"`);
          }
          if (typeof m.id !== "string" || m.id.trim().length === 0) {
            return err(400, `mandates[${i}].id must be a non-empty string`);
          }
        }
        const mandates: Ap2MandateRef[] = mandatesRaw;

        // -- Load workflow ---------------------------------------------------
        let wf: ExecutionWorkflow | null = null;
        try {
          wf = await Promise.resolve(executionStore.get(id, c.tenantId));
        } catch {
          return err(500, "failed to load workflow");
        }
        if (!wf) return err(404, "workflow not found");

        // -- Guard: only link receipts for workflows that actually ran --------
        const LINKABLE_STATUSES = new Set(["approved", "running", "succeeded"]);
        if (!LINKABLE_STATUSES.has(wf.status)) {
          return err(422, `workflow status "${wf.status}" is not linkable -- must be approved, running, or succeeded`);
        }

        // -- Build a signed status receipt to anchor the linkage signature ----
        // We use the status receipt's signature as the stable receipt fingerprint.
        // The linkage binds: receiptSignature (tamper-evident) + mandate IDs.
        let statusReceipt: ReturnType<typeof buildStatusReceipt>;
        try {
          statusReceipt = buildStatusReceipt(wf, signer);
        } catch (e: any) {
          return err(500, e?.message ?? "failed to build status receipt");
        }
        if (!verifyStatusReceipt(statusReceipt, signer)) {
          return err(500, "receipt signature verification failed (signer misconfigured)");
        }

        // Minimal ExecutionReceipt-compatible shim -- linkReceiptToMandates only
        // uses .signature (receipt fingerprint) and .intentId (human-traceable).
        const receiptShim = {
          signature: statusReceipt.signature,
          intentId: wf.intentId ?? wf.id, // intentId from original intent; fallback to workflowId
        } as ExecutionReceipt;

        // -- Produce the MandateLinkage --------------------------------------
        let linkage: MandateLinkage;
        try {
          linkage = linkReceiptToMandates(receiptShim, mandates, signer);
        } catch (e: any) {
          return err(400, e?.message ?? "failed to link mandates");
        }

        // fail-closed: verify the linkage we just produced
        const linkageVerification = verifyMandateLinkage(linkage, signer);
        if (!linkageVerification.valid) {
          return err(500, `linkage signature verification failed: ${linkageVerification.reason}`);
        }

        // -- Build a W3C-shaped VC with the linkage as evidence --------------
        // This is a linkage-centric VC (not a full ExecutionReceipt VC).
        // It proves: "workflow <id> for tenant <t> fulfilled AP2 mandates <m...>".
        const now = new Date().toISOString();
        const vc = {
          "@context": [
            "https://www.w3.org/ns/credentials/v2",
            "https://tfa.dev/ns/v1",
          ],
          id: `urn:tfa:linkage:${wf.id}:${linkage.boundAt}`,
          type: ["VerifiableCredential", "TfaAp2LinkageCredential"],
          issuer: { id: `urn:tfa:tenant:${wf.tenantId}` },
          validFrom: now,
          credentialSubject: {
            id: `urn:tfa:workflow:${wf.tenantId}:${wf.id}`,
            workflowId: wf.id,
            workflowStatus: wf.status,
            tenantId: wf.tenantId,
            linkage,
          },
          proof: {
            type: "DataIntegrityProof",
            cryptosuite: "tfa-hmac-sha256",
            created: now,
            proofPurpose: "assertionMethod",
            verificationMethod: "urn:tfa:key:hmac",
            proofValue: linkage.signature, // linkage sig covers receipt + mandates
          },
        };

        return ok({
          ok: true,
          workflowId: wf.id,
          status: wf.status,
          linkage,
          vc,
        }, 201);
      },
    },
  ];
}
