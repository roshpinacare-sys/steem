/**
 * src/routes/introduction-routes.ts — Cross-tenant introduction routes (K8 step 1).
 *
 * Route:
 *   POST /api/introduction/request
 *     Body: { targetTenantId: string, proofTarget: { kind: "track-record"|"passport", identityId: string } }
 *     Response: 200 IntroductionRequest JSON (signed by the kernel signer)
 *
 * Invariants:
 *   • tenantId from x-tenant-id is mandatory — fail-closed.
 *   • targetTenantId must be a non-empty string.
 *   • proofTarget.kind must be a known kind (fail-closed).
 *   • proofTarget.identityId must be a non-empty string.
 *   • The returned request carries a kernel signature over its canonical JSON
 *     (excluding the signature field itself), so the target tenant can verify provenance.
 */

import { randomUUID } from "node:crypto";
import type { SovereignStack } from "../composition.ts";
import type { Ctx, Res, Route } from "./sovereign-routes.ts";
import type { IntroductionRequest, ProofTarget } from "../../lib/introduction/index.ts";
import {
  buildTrustProofBundle,
  computeTrackRecord,
  getCachedOrCompute,
  type ProofPassportEntry,
} from "../../lib/track-record/index.ts";
import { issuePassport, PassportError } from "../../lib/passport/index.ts";

const ok = (body: unknown, status = 200): Res => ({ status, body });
const err = (status: number, message: string): Res => ({ status, body: { error: message } });

/** Stable JSON canonicalization for signing (same rules as tenant-export). */
export function canonicalize(value: unknown): string {
  if (value === null || (typeof value !== "object" && typeof value !== "bigint")) {
    if (typeof value === "bigint") return String(value);
    return JSON.stringify(value);
  }
  if (typeof value === "bigint") return String(value);
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalize).join(",") + "]";
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalize(obj[k])).join(",") + "}";
}

const ALLOWED_KINDS = new Set<string>(["track-record", "passport"]);

function validateProofTarget(pt: unknown): { valid: true; target: ProofTarget } | { valid: false; reason: string } {
  if (!pt || typeof pt !== "object") return { valid: false, reason: "proofTarget must be an object" };
  const { kind, identityId } = pt as Record<string, unknown>;
  if (typeof kind !== "string" || !ALLOWED_KINDS.has(kind)) {
    return { valid: false, reason: 'proofTarget.kind must be "track-record" or "passport"' };
  }
  if (typeof identityId !== "string" || identityId.length === 0) {
    return { valid: false, reason: "proofTarget.identityId must be a non-empty string" };
  }
  return { valid: true, target: { kind, identityId } };
}

export function introductionRoutes(stack: SovereignStack): Route[] {
  return [
    {
      method: "POST",
      pattern: "/api/introduction/request",
      handler: async (c: Ctx): Promise<Res> => {
        if (!c.tenantId) return err(400, "x-tenant-id header required");
        const b = c.body ?? {};
        if (!b.targetTenantId || typeof b.targetTenantId !== "string") {
          return err(400, "targetTenantId (string) is required");
        }
        const ptCheck = validateProofTarget(b.proofTarget);
        if (!ptCheck.valid) return err(400, ptCheck.reason);

        const req: IntroductionRequest = {
          id: `intro-${randomUUID()}`,
          sourceTenantId: c.tenantId,
          targetTenantId: b.targetTenantId,
          proofTarget: ptCheck.target,
          signature: "", // populated after canonicalization
          createdAt: new Date().toISOString(),
        };

        // Sign everything except the signature field itself
        const { signature: _sig, ...payload } = req;
        const canonical = canonicalize(payload);
        req.signature = stack.signer.sign(canonical);

        await Promise.resolve(stack.introductionStore.save(req));
        return ok(req, 201);
      },
    },
    {
      method: "GET",
      pattern: "/api/introduction/inbox",
      handler: async (c: Ctx): Promise<Res> => {
        if (!c.tenantId) return err(400, "x-tenant-id header required");
        const list = await Promise.resolve(stack.introductionStore.listForTarget(c.tenantId));
        return ok(list);
      },
    },
    {
      method: "GET",
      pattern: "/api/introduction/:id",
      handler: async (c: Ctx): Promise<Res> => {
        if (!c.tenantId) return err(400, "x-tenant-id header required");
        const id = c.params.id;
        if (!id || typeof id !== "string") return err(400, "id parameter required");
        const req = await Promise.resolve(stack.introductionStore.getWithAccess(id, c.tenantId));
        if (!req) return err(404, "introduction not found or access denied");
        return ok(req);
      },
    },
    {
      method: "POST",
      pattern: "/api/introduction/:id/accept",
      handler: async (c: Ctx): Promise<Res> => {
        if (!c.tenantId) return err(400, "x-tenant-id header required");
        const id = c.params.id;
        if (!id || typeof id !== "string") return err(400, "id parameter required");

        const intro = await Promise.resolve(stack.introductionStore.getWithAccess(id, c.tenantId));
        if (!intro) return err(404, "introduction not found or access denied");
        if (intro.targetTenantId !== c.tenantId) {
          return err(403, "only the target tenant can accept");
        }

        // Verify kernel signature over the introduction request (tamper-evident)
        const { signature: _sig, ...payload } = intro;
        const canonical = canonicalize(payload);
        if (!stack.signer.verify(canonical, intro.signature)) {
          return err(403, "signature verification failed");
        }

        if (intro.proofTarget.kind === "track-record") {
          try {
            const resolver = async (tid: string, accId: string) => {
              try {
                const a = await stack.ledger.getAccount(tid, accId);
                return a?.ownerId ?? null;
              } catch {
                return null;
              }
            };
            const record = await getCachedOrCompute(
              stack.trackRecordCache,
              (stack as any).orchestrator.audit,
              (stack as any).escrowStore,
              intro.sourceTenantId,
              intro.proofTarget.identityId,
              { accountOwnerResolver: resolver, identityStore: (stack as any).identities },
            );
            const chain = (stack as any).orchestrator.audit.getChain(intro.sourceTenantId) as Array<
              Record<string, unknown>
            >;
            const passports: ProofPassportEntry[] = chain
              .filter((r) => r.outcome === "allowed")
              .map((r) => ({
                passportId: String((r as any).id ?? ""),
                auditId: String((r as any).id ?? ""),
                actionType: String((r as any).actionType ?? ""),
                outcome: String((r as any).outcome ?? ""),
                signature: (r as any).signature,
              }))
              .slice(0, 200);
            const bundle = buildTrustProofBundle({
              tenantId: intro.sourceTenantId,
              identityId: intro.proofTarget.identityId,
              record,
              passports,
              publicKey: (stack as any).publicKey ?? null,
              algorithm: (stack as any).signer?.algorithm ?? "hmac-sha256",
            });
            return ok({ accepted: true, proofBundle: bundle });
          } catch (e: any) {
            return err(400, e?.message || "could not build proof bundle");
          }
        }

        if (intro.proofTarget.kind === "passport") {
          try {
            const chain = (stack as any).orchestrator.audit.getChain(intro.sourceTenantId) as Array<
              Record<string, unknown>
            >;
            const rec = chain
              .filter(
                (r) =>
                  r.outcome === "allowed" &&
                  String((r as any).source ?? "") === intro.proofTarget.identityId,
              )
              .pop();
            if (!rec) return err(404, "no passport record found for identity");
            const auditId = String((rec as any).id ?? "");
            const passport = issuePassport({
              auditId,
              auditStore: (stack as any).orchestrator.audit,
              signer: stack.signer,
              identityStore: (stack as any).identities,
              expectedTenantId: intro.sourceTenantId,
            });
            return ok({ accepted: true, passport });
          } catch (e: any) {
            if (e instanceof PassportError) {
              if (e.code === "audit_not_found" || e.code === "tenant_mismatch") {
                return err(404, "passport not found");
              }
              return err(400, e.message);
            }
            return err(500, e?.message || "passport issuance failed");
          }
        }

        return err(400, "unknown proof target kind");
      },
    },
  ];
}
