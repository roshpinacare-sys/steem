/**
 * src/routes/sovereign-routes.ts — framework-agnostic handlers for the sovereign API.
 * Each handler takes a Ctx ({tenantId, body, params}) and returns {status, body}. The same handlers
 * mount under Node's built-in http (offline tests) OR Express (real TFA) — no framework lock-in.
 * tenantId is mandatory (x-tenant-id) — tenant isolation is sacred. Money flows only through the
 * LedgerOrchestrator guard chokepoint; invalid input → 400; guard denial → 403; not found → 404.
 */
import type { SovereignStack } from "../composition.ts";
import { bridgeForTenant, TenantPlanRegistry, PLAN_LIMITS } from "../composition.ts";
import { computeTrackRecord, getCachedOrCompute, buildTrustProofBundle, buildTrustProofBundleV2, PROOF_BUNDLE_DEFAULT_VALID_MS, type ProofPassportEntry, buildCountProof, verifyCountProof, buildPredicateProof, verifyPredicateProof, buildRedactedProofBundle, verifyRedactedProofBundle } from "../../lib/track-record/index.ts";
import { MarketplaceError } from "../../lib/marketplace/index.ts";
import { issuePassport, PassportError, buildPassportClaim, ClaimError } from "../../lib/passport/index.ts";
import { buildChainView, buildBalancesView, buildPassportListView } from "../../lib/transparency/index.ts";
import { introductionRoutes } from "./introduction-routes.ts";
import { requireScope } from "../../lib/rbac/require-scope.ts";
import { enforceBreakGlassTicket } from "../sovereignty/break-glass-middleware.ts";
import { WebhookService } from "../../lib/escrow/webhook.ts";
import { randomUUID } from "node:crypto";

export interface Ctx { tenantId: string; body: any; params: Record<string, string>; query?: Record<string, string>; headers?: Record<string, string | string[] | undefined>; scopes?: string[]; }
export interface Res { status: number; body: any; headers?: Record<string, string>; }
export interface Route {
  method: string;
  pattern: string;
  handler: (ctx: Ctx) => Promise<Res> | Res;
  /**
   * When true, the server REQUIRES an `Idempotency-Key` header on this route.
   * Missing key → 400 { error: "Idempotency-Key header is required for this endpoint" }.
   */
  requiresIdempotencyKey?: boolean;
}

const ok = (body: any, status = 200): Res => ({ status, body });
const err = (status: number, message: string): Res => ({ status, body: { error: message } });
const toMC = (v: unknown): bigint => { if (typeof v === "string" && /^-?\d+$/.test(v)) return BigInt(v); if (typeof v === "number" && Number.isInteger(v)) return BigInt(v); throw new Error("amount must be an integer micro-cent string"); };
/**
 * mapOp — translate a LedgerOpResult into an HTTP Res.
 * v27 → v28 (B.6.3): when the LedgerOrchestrator auto-issued an ActionPassport
 * (mint / withdraw / transfer success path), forward it inline so callers
 * receive the signed passport in the same response — no extra GET /api/passport
 * round-trip required. Other ops (e.g. proofOfSolvency) have no passport,
 * so the field is simply omitted (not `null`) to keep response shape minimal.
 */
const mapOp = (r: any): Res => r && r.ok
  ? ok({ ok: true, data: r.value ?? r.data ?? r.result ?? null, auditId: r.auditId, ...(r.passport ? { passport: r.passport } : {}) })
  : err(403, (r && (r.reason || r.error?.message || r.error)) || "denied by guard (fail-closed)");

export function sovereignRoutes(stack: SovereignStack): Route[] {
  const { ledger, potential, personalityMapper, successPathRouter, collaborationMatcher, personalityStore, successPathStore, collaborationStore, catalog, escrow, identities, signer, publicKey, monitor, indexerEventBus, webhookService } = stack;

  /** emit escrow projection to indexer (fail-closed best-effort, tolerates missing bus). */
  function emitEscrowProjection(tenantId: string, agreement: any): void {
    if (!indexerEventBus) return;
    try { indexerEventBus.emit({ type: "escrow.updated", tenantId, agreement }); } catch { /* best-effort */ }
  }

  /** dispatch webhook event for escrow/settlement state changes (best-effort, never abort request). */
  function dispatchEvent(tenantId: string, eventType: string, agreement: any): void {
    if (!webhookService) return;
    const payload = serializeAgreement(agreement);
    webhookService
      .dispatch(tenantId, {
        id: randomUUID(),
        event: eventType,
        tenantId,
        occurredAt: new Date().toISOString(),
        data: payload,
      })
      .catch(() => { /* swallow — delivery failure must not abort caller */ });
  }

  /** dispatch generic webhook event for any domain payload (best-effort, never abort request). */
  function dispatchWebhookEvent(tenantId: string, eventType: string, data: Record<string, unknown>): void {
    if (!webhookService) return;
    webhookService
      .dispatch(tenantId, {
        id: randomUUID(),
        event: eventType,
        tenantId,
        occurredAt: new Date().toISOString(),
        data,
      })
      .catch(() => { /* swallow — delivery failure must not abort caller */ });
  }

  return [
    { method: "POST", pattern: "/api/ledger/accounts", handler: async (c) => {
      const { ownerId, type, name } = c.body || {};
      if (!ownerId || !type || !name) return err(400, "ownerId, type, name required");
      const acct = await (ledger as any).createAccount(c.tenantId, ownerId, type, name);
      return ok({ account: acct }, 201);
    }},
    { method: "GET", pattern: "/api/ledger/accounts/:id", handler: async (c) => {
      try { return ok({ account: await (ledger as any).getAccount(c.tenantId, c.params.id) }); }
      catch { return err(404, "account not found"); }
    }},
    { method: "POST", pattern: "/api/ledger/mint", handler: async (c) => {
      // v199 — opt-in break-glass enforcement (substep 1 of "wire-up — המשך"):
      // if the caller presents an `x-break-glass-ticket` header, verify+consume
      // it via the chokepoint (src/sovereignty/break-glass-middleware.ts)
      // instead of the standard scope check. Fail-closed: malformed, expired,
      // replayed, cross-tenant, or insufficiently-scoped tickets deny WITHOUT
      // falling back to RBAC. With no header, the existing requireScope path
      // is preserved unchanged (zero regression for all existing mint tests).
      const rawTicket = c.headers?.["x-break-glass-ticket"];
      const encodedTicket = Array.isArray(rawTicket) ? rawTicket[0] : rawTicket;
      if (typeof encodedTicket === "string" && encodedTicket.length > 0) {
        const result = enforceBreakGlassTicket({
          encodedTicket,
          tenantId: c.tenantId,
          requiredScope: "ledger:mint",
          signer: stack.signer,
          nonceRegistry: stack.nonceRegistry,
          auditStore: stack.auditStore,
        });
        if (!result.ok) return { status: result.denial.status, body: result.denial.body };
      } else {
        const denial = requireScope(c.scopes, "ledger:mint");
        if (denial) return denial;
      }
      const { toAccountId, amount, memo } = c.body || {};
      if (!toAccountId) return err(400, "toAccountId required");
      try {
        monitor.registerTenant(c.tenantId);
        return mapOp(await ledger.mint(c.tenantId, toAccountId, toMC(amount), String(memo || "mint"), String(c.body?.initiatedBy || "api"), false));
      } catch (e: any) { return err(400, e.message); }
    }},
    { method: "POST", pattern: "/api/ledger/withdraw", handler: async (c) => {
      // v201 — opt-in break-glass enforcement (substep 3 of "wire-up — המשך"):
      // mirrors `ledger/mint` (v199) and `ledger/transfer` (v200). With an
      // `x-break-glass-ticket` header the chokepoint verifies+consumes the ticket
      // for scope `ledger:transfer` (same scope as transfer and withdraw — a single
      // scope gates all value-moving ledger operations). Fail-closed in every branch:
      // malformed, expired, replayed, cross-tenant, or wrong-scope tickets → deny,
      // no fallback to RBAC. Without the header, the existing `requireScope` path is
      // preserved unchanged (zero regression for all withdraw tests).
      const rawTicket = c.headers?.["x-break-glass-ticket"];
      const encodedTicket = Array.isArray(rawTicket) ? rawTicket[0] : rawTicket;
      if (typeof encodedTicket === "string" && encodedTicket.length > 0) {
        const result = enforceBreakGlassTicket({
          encodedTicket,
          tenantId: c.tenantId,
          requiredScope: "ledger:transfer",
          signer: stack.signer,
          nonceRegistry: stack.nonceRegistry,
          auditStore: stack.auditStore,
        });
        if (!result.ok) return { status: result.denial.status, body: result.denial.body };
      } else {
        const denial = requireScope(c.scopes, "ledger:transfer");
        if (denial) return denial;
      }
      const { fromAccountId, amount, memo } = c.body || {};
      if (!fromAccountId) return err(400, "fromAccountId required");
      try {
        monitor.registerTenant(c.tenantId);
        return mapOp(await ledger.withdraw(c.tenantId, fromAccountId, toMC(amount), String(memo || "withdraw"), String(c.body?.initiatedBy || "api"), false));
      } catch (e: any) { return err(400, e.message); }
    }},
    { method: "POST", pattern: "/api/ledger/transfer", handler: async (c) => {
      // v200 — opt-in break-glass enforcement (substep 2 of "wire-up — המשך"):
      // mirrors the `ledger/mint` wire-up (v199). With an `x-break-glass-ticket`
      // header, the chokepoint (src/sovereignty/break-glass-middleware.ts)
      // verifies+consumes the ticket for scope `ledger:transfer` INSTEAD of
      // the standard RBAC check. Fail-closed in every branch: malformed,
      // expired, replayed, cross-tenant, or wrong-scope tickets DENY without
      // falling back to RBAC. With no header, the existing `requireScope`
      // path is preserved unchanged (zero regression for all transfer tests).
      const rawTicket = c.headers?.["x-break-glass-ticket"];
      const encodedTicket = Array.isArray(rawTicket) ? rawTicket[0] : rawTicket;
      if (typeof encodedTicket === "string" && encodedTicket.length > 0) {
        const result = enforceBreakGlassTicket({
          encodedTicket,
          tenantId: c.tenantId,
          requiredScope: "ledger:transfer",
          signer: stack.signer,
          nonceRegistry: stack.nonceRegistry,
          auditStore: stack.auditStore,
        });
        if (!result.ok) return { status: result.denial.status, body: result.denial.body };
      } else {
        const denial = requireScope(c.scopes, "ledger:transfer");
        if (denial) return denial;
      }
      const { fromAccountId, toAccountId, amount, memo } = c.body || {};
      if (!fromAccountId || !toAccountId) return err(400, "fromAccountId, toAccountId required");
      try {
        monitor.registerTenant(c.tenantId);
        return mapOp(await ledger.transfer(c.tenantId, fromAccountId, toAccountId, toMC(amount), String(memo || "transfer"), String(c.body?.initiatedBy || "api"), false));
      } catch (e: any) { return err(400, e.message); }
    }},
    { method: "GET", pattern: "/api/ledger/solvency", handler: async (c) => mapOp(await ledger.proofOfSolvency(c.tenantId, c.body?.requestedBy || "system")) },
    { method: "POST", pattern: "/api/potential/profile", handler: async (c) => {
      const b = c.body || {};
      if (!b.userId) return err(400, "userId required");
      const input = { userId: b.userId, tenantId: c.tenantId, knowledgeSignals: b.knowledgeSignals || [], analyticsSignals: b.analyticsSignals || [] };
      try { return mapOp(await potential.analyze(input)); }
      catch (e: any) { return err(400, e.message || "could not build profile"); }
    }},
    { method: "POST", pattern: "/api/potential/personality", handler: async (c) => {
      const b = c.body || {};
      if (!b.userId) return err(400, "userId required");
      const input = {
        userId: b.userId,
        tenantId: c.tenantId,
        knowledgeSignals: b.knowledgeSignals || [],
        analyticsSignals: b.analyticsSignals || [],
      };
      // PersonalityMapper is pure computation — no guard needed (not autonomous, not financial).
      // It does enforce tenant isolation internally (discards cross-tenant signals).
      const profile = personalityMapper.map(input);
      // Auto-save: persist the freshly computed profile for future GET retrieval.
      await personalityStore.save(profile);
      return ok({ ok: true, data: profile });
    }},
    // ─── GET /api/potential/personality/:userId ──────────────────────────────
    // Load a previously-saved PersonalityProfile. 404 if never computed+saved.
    // Tenant isolation: only returns profiles belonging to the request tenant.
    { method: "GET", pattern: "/api/potential/personality/:userId", handler: async (c) => {
      const userId = c.params?.userId;
      if (!userId) return err(400, "userId required");
      const profile = await personalityStore.load(c.tenantId, userId);
      if (!profile) return err(404, "personality profile not found");
      return ok({ ok: true, data: profile });
    }},
    // ─── POST /api/potential/success-path ────────────────────────────────────
    // Compute a learning path from a user's current StrengthProfile toward
    // a target opportunity in the same tenant's catalog.
    //
    // Body: { userId, profile: StrengthProfile, targetOpportunityId, gaps? }
    // gaps: Array<{ category, gap }> — if omitted, computed from profile vs opportunity.
    //
    // Returns SuccessPath: ordered LearningSteps with expectedGain, difficulty,
    // estimatedHours, and projectedFitScore.
    //
    // Tenant isolation: target opportunity must belong to the request tenant.
    // Computation only — no guard, no audit, no ledger.
    { method: "POST", pattern: "/api/potential/success-path", handler: async (c) => {
      const b = c.body || {};
      if (!b.userId) return err(400, "userId required");
      if (!b.targetOpportunityId) return err(400, "targetOpportunityId required");
      if (!b.profile) return err(400, "profile required");

      // Resolve target opportunity — tenant-scoped
      const opp = await catalog.get(c.tenantId, b.targetOpportunityId);
      if (!opp) return err(404, "opportunity not found");

      // Compute gaps if not supplied: find categories where user is below minScore
      const profile = b.profile as import("../../lib/potential/types.ts").StrengthProfile;
      const strengthMap = new Map<string, number>(
        (profile.strengths || []).map((s: any) => [s.category, s.score])
      );
      const gaps: Array<{ category: string; gap: number }> =
        b.gaps ??
        (opp.requiredStrengths || [])
          .filter((req: any) => {
            const score = strengthMap.get(req.category) ?? 0;
            return score < req.minScore;
          })
          .map((req: any) => ({
            category: req.category,
            gap: req.minScore - (strengthMap.get(req.category) ?? 0),
          }));

      const input = {
        userId: b.userId as string,
        tenantId: c.tenantId,
        profile: { ...profile, userId: b.userId, tenantId: c.tenantId },
        targetOpportunityId: b.targetOpportunityId as string,
        gaps,
      };

      try {
        const path = successPathRouter.plan(input, [opp]);
        // Auto-save: persist the computed path so it can be retrieved later
        // without re-computation. Fire-and-forget — save errors don't fail the response.
        successPathStore.save(path).catch((e: unknown) => {
          console.error("[sovereign] successPathStore.save failed:", e);
        });
        return ok({ ok: true, data: path });
      } catch (e: any) {
        return err(400, e.message || "could not compute success path");
      }
    }},

    // ─── GET /api/potential/success-path/:userId/:opportunityId ──────────────
    // Load a previously computed SuccessPath from the store.
    // Returns the last persisted path for (tenant, user, opportunity).
    // Does NOT re-compute — clients call POST to refresh.
    //
    // Path params: userId, opportunityId (= targetOpportunityId)
    // Returns: { ok: true, data: SuccessPath } or 404 if not found.
    // Tenant isolation: path must belong to x-tenant-id.
    { method: "GET", pattern: "/api/potential/success-path/:userId/:opportunityId", handler: async (c) => {
      const { userId, opportunityId } = c.params;
      if (!userId) return err(400, "userId required");
      if (!opportunityId) return err(400, "opportunityId required");
      const path = await successPathStore.load(c.tenantId, userId, opportunityId);
      if (!path) return err(404, "success path not found");
      return ok({ ok: true, data: path });
    }},
    // ─── POST /api/potential/collaboration ───────────────────────────────────
    // Find the best collaboration partners for a user within the same tenant.
    //
    // Body: { userId, userProfile: StrengthProfile, candidates: Array<{userId, profile}>, minCompatibility? }
    //
    // Returns: Array<CollaborationMatch> sorted by compatibilityScore desc.
    // Only candidates in the same tenant are allowed (fail-closed: throws on cross-tenant).
    //
    // Computation only — no guard, no audit, no ledger.
    { method: "POST", pattern: "/api/potential/collaboration", handler: async (c) => {
      const b = c.body || {};
      if (!b.userId) return err(400, "userId required");
      if (!b.userProfile) return err(400, "userProfile required");
      if (!Array.isArray(b.candidates)) return err(400, "candidates must be an array");

      // Enforce tenant isolation: all candidate profiles must match request tenant
      const candidates = b.candidates as Array<{ userId: string; profile: any }>;
      for (const cand of candidates) {
        if (!cand.userId) return err(400, "each candidate must have a userId");
        if (!cand.profile) return err(400, "each candidate must have a profile");
        // Force tenantId on candidate profiles to the request tenant (can't trust body)
        cand.profile.tenantId = c.tenantId;
      }

      const input = {
        tenantId: c.tenantId,
        userId: b.userId as string,
        userProfile: { ...b.userProfile, userId: b.userId, tenantId: c.tenantId },
        candidates,
        minCompatibility: typeof b.minCompatibility === "number" ? b.minCompatibility : 40,
      };

      try {
        const matches = collaborationMatcher.match(input);
        // Auto-save top matches to cache for GET retrieval (fire-and-forget).
        collaborationStore.save(c.tenantId, b.userId as string, matches).catch((e: unknown) => {
          console.error("[sovereign] collaborationStore.save failed:", e);
        });

        // ─── Potential→Escrow loop (v75): auto-open an escrow per match when a budget is given ──
        // Body opts: escrowBudget (integer μ¢ string), payerAccountId, workerAccountId(s) optional —
        // if a match's parties have ledger accounts supplied via accountsByUserId, we use those.
        if (b.escrowBudget !== undefined && b.opportunityId && b.payerAccountId) {
          let budget: bigint;
          try { budget = toMC(b.escrowBudget); } catch { return err(400, "escrowBudget must be an integer micro-cent string"); }
          if (budget <= 0n) return err(400, "escrowBudget must be positive");
          const accounts = (b.accountsByUserId || {}) as Record<string, string>;
          const withEscrow = [] as Array<Record<string, unknown>>;
          for (const m of matches as unknown as Array<Record<string, unknown>>) {
            const partnerId = String((m as any).userB ?? (m as any).userBId ?? (m as any).partnerId ?? "");
            const workerAccountId = accounts[partnerId];
            if (!workerAccountId) { withEscrow.push({ ...m, escrowId: null, escrowSkipped: "no ledger account supplied for partner" }); continue; }
            try {
              const res = await bridgeForTenant(stack, c.tenantId).openEscrow({
                tenantId: c.tenantId, match: m as any, opportunityId: String(b.opportunityId),
                payerAccountId: String(b.payerAccountId), workerAccountId, amount: budget,
                initiatedBy: String(b.userId),
              });
              if (!(res as any).ok) { withEscrow.push({ ...m, escrowId: null, escrowDenied: (res as any).reason || "denied by guard" }); continue; }
              withEscrow.push({ ...m, escrowId: (res as any).agreement?.id ?? null, escrowPassport: (res as any).passport ?? undefined });
            } catch (e: any) {
              // fail-closed per-match: a denied escrow doesn't kill the whole response; it's reported
              withEscrow.push({ ...m, escrowId: null, escrowDenied: e?.message || "denied" });
            }
          }
          return ok({ ok: true, data: withEscrow });
        }
        return ok({ ok: true, data: matches });
      } catch (e: any) {
        return err(400, e.message || "could not compute collaboration matches");
      }
    }},
    // ─── GET /api/potential/collaboration/:userId ────────────────────────────
    // Load cached top-N collaboration matches for a user.
    // Returns 200 + matches array if found, 404 if no cache exists yet.
    // Tenant isolation: only returns data belonging to the request tenant.
    { method: "GET", pattern: "/api/potential/collaboration/:userId", handler: async (c) => {
      const userId = c.params?.userId;
      if (!userId) return err(400, "userId required");
      const matches = await collaborationStore.load(c.tenantId, userId);
      if (matches === null) return err(404, "no cached collaboration matches found");
      // Return both `matches` (spec-declared required field) and `data` (backward compat).
      return ok({ ok: true, matches, data: matches });
    }},

    // ─── POST /api/potential/collaboration/:escrowId/complete ────────────────
    // Mark a collaboration as complete: fund the escrow (if not yet funded) then
    // release to the worker.  Both steps flow through the bridge → ledger orchestrator
    // (guard→audit→passport).  Returns the final agreement (state "released") and the
    // bridge-issued ActionPassport when a signer is wired.
    //
    // Body: { initiatedBy? }
    { method: "POST", pattern: "/api/potential/collaboration/:escrowId/complete", handler: async (c) => {
      const b = c.body || {};
      const initiatedBy = String(b.initiatedBy || b.userId || "api");
      try {
        const res = await bridgeForTenant(stack, c.tenantId).completeCollaboration({
          tenantId: c.tenantId,
          escrowId: c.params.escrowId,
          initiatedBy,
        });
        if (!res.ok) {
          const reason = res.reason || "denied";
          const lower = reason.toLowerCase();
          if (lower.includes("wrong_state") || lower.includes("operation requires")) return err(409, reason);
          if (lower.includes("not found")) return err(404, reason);
          return err(403, reason);
        }
        return ok({
          ok: true,
          agreement: serializeAgreement(res.agreement),
          ...(res.passport ? { passport: res.passport } : {}),
        });
      } catch (e: any) {
        if (e?.message?.includes("not found")) return err(404, e.message);
        if (e?.message?.includes("tenant isolation")) return err(403, e.message);
        if (e?.code === "wrong_state") return err(409, e.message);
        if (e?.code === "unauthorized") return err(403, e.message);
        if (e?.code === "not_found") return err(404, e.message);
        return err(400, e?.message || "completion failed");
      }
    }},
    /**
     * GET /api/passport/public-key — return the kernel signer's public key so
     * external verifiers (third-party integrations, auditors) can verify passport
     * signatures without a shared secret.
     *
     * Returns:
     *   200 { algorithm: "ed25519", publicKey: "<SPKI PEM>" }  — when Ed25519 signer is wired.
     *   200 { algorithm: "hmac-sha256", publicKey: null }       — when HMAC signer is wired
     *                                                             (public key is undefined for symmetric algos).
     *
     * No tenant-specific data is returned. The same public key signs passports for
     * all tenants on this server, so no tenant isolation risk. Still requires a
     * valid x-tenant-id header (server contract) but the response is public info.
     *
     * MUST appear before /api/passport/:auditId to prevent "public-key" being
     * captured as an auditId by the dynamic segment.
     */
    { method: "GET", pattern: "/api/passport/public-key", handler: (_c) => {
      return ok({
        algorithm: publicKey ? "ed25519" : "hmac-sha256",
        publicKey: publicKey ?? null,
      });
    }},

    /**
     * GET /api/passport/:auditId — lazily issue a signed Action Passport for any
     * audit record in the stack's audit store. Tenant-isolated via x-tenant-id:
     * cross-tenant lookups → 404 (tenant_mismatch is treated as "not yours, not here").
     * Returns 404 when the auditId is unknown. Always uses the kernel signer +
     * identity store, so passports stay verifiable with the canonical verifier.
     */
    { method: "GET", pattern: "/api/passport/:auditId", handler: (c) => {
      const auditId = c.params.auditId;
      if (!auditId) return err(400, "auditId required");
      try {
        const passport = issuePassport({
          auditId,
          auditStore: ledger.orchestrator.audit,
          signer,
          identityStore: identities,
          expectedTenantId: c.tenantId,
        });
        stack.indexerEventBus?.emit({ type: "passport.issued", tenantId: c.tenantId, passport });
        dispatchWebhookEvent(c.tenantId, "passport.issued", { passport });
        return ok({ passport });
      } catch (e: any) {
        if (e instanceof PassportError) {
          if (e.code === "audit_not_found" || e.code === "tenant_mismatch") return err(404, "passport not found");
          return err(400, e.message);
        }
        return err(500, e?.message || "passport issuance failed");
      }
    }},

    /**
     * GET /api/passports/:id/status — return a signed PassportClaim about the
     * status of a passport (identified by its auditId). The claim is a portable,
     * versioned assertion (issuer, subject, scope, evidenceRefs, revocationStatus)
     * that can be verified offline by the claim verifier.
     *
     * Tenant-isolated: cross-tenant lookups → 404.
     */
    { method: "GET", pattern: "/api/passports/:id/status", handler: (c) => {
      const id = c.params.id;
      if (!id) return err(400, "id required");
      try {
        const passport = issuePassport({
          auditId: id,
          auditStore: ledger.orchestrator.audit,
          signer,
          identityStore: identities,
          expectedTenantId: c.tenantId,
        });
        const claim = buildPassportClaim({
          issuer: c.tenantId,
          subject: passport.passportId,
          scope: "passport.status",
          evidenceRefs: [passport.audit.id],
          revocationStatus: "active",
          signer,
          riskEvidence: passport.riskEvidence,
        });
        return ok({ claim });
      } catch (e: any) {
        if (e instanceof PassportError || e instanceof ClaimError) {
          if (e.code === "audit_not_found" || e.code === "tenant_mismatch") return err(404, "passport not found");
          return err(400, e.message);
        }
        return err(500, e?.message || "claim issuance failed");
      }
    }},

    // ─── Transparency Dashboard (read-only, no side effects) ──────────────────

    /**
     * GET /api/transparency/chain
     * Returns the tenant's full audit chain in insertion order with a chain-integrity
     * flag (tamper-evident: SHA-256 hash links verified on every call).
     * Tenant isolation: x-tenant-id scopes every record returned.
     */
    { method: "GET", pattern: "/api/transparency/chain", handler: (c) => {
      const view = buildChainView(c.tenantId, ledger.orchestrator.audit);
      return ok(view);
    }},

    /**
     * GET /api/transparency/balances
     * Returns all accounts for the tenant with their current μ¢ balances (as
     * decimal strings) plus a live solvency proof (totalAssets ≥ totalLiabilities).
     * Read-only — does NOT route through the financial chokepoint.
     */
    { method: "GET", pattern: "/api/transparency/balances", handler: async (c) => {
      try {
        const view = await buildBalancesView(c.tenantId, (ledger as any).provider);
        return ok(view);
      } catch (e: any) {
        return err(500, e?.message || "failed to build balances view");
      }
    }},

    /**
     * GET /api/transparency/passports
     * Returns lightweight summaries of all "allowed" audit records for the tenant,
     * each carrying a passportHref pointing to GET /api/passport/:auditId for the
     * full signed ActionPassport. Efficient: no passport issuance on this call.
     */
    { method: "GET", pattern: "/api/transparency/passports", handler: (c) => {
      const view = buildPassportListView(c.tenantId, ledger.orchestrator.audit);
      return ok(view);
    }},

    // ─── Monitor (cron status & on-demand trigger) ────────────────────────────

    /**
     * GET /api/monitor/status
     * Returns the cron's current state: running flag, intervalMs, lastRunAt,
     * nextRunAt, registered tenants, total sweep count, and the last AuditResult
     * per tenant. Does NOT re-run the audit.
     */
    { method: "GET", pattern: "/api/monitor/status", handler: (_c) => {
      return ok(monitor.getStatus());
    }},

    /**
     * POST /api/monitor/run
     * Triggers an immediate on-demand audit for the caller's tenant (x-tenant-id).
     * Also registers the tenant in the cron sweep so future periodic runs include it.
     * Returns the full AuditResult for this run.
     */
    { method: "POST", pattern: "/api/monitor/run", handler: async (c) => {
      try {
        const result = await monitor.runNow(c.tenantId);
        return ok(result);
      } catch (e: any) {
        return err(500, e?.message || "monitor run failed");
      }
    }},

    // ── שלב E: Marketplace ──────────────────────────────────────────────────────

    /**
     * POST /api/marketplace/opportunities
     * Create an opportunity in the tenant's catalog.
     * Body: { title, description, requiredStrengths?, fromAccountId?, listingFee? (integer μ¢ string, default 5000), userId? }
     * Returns 201 + { ok: true, opportunity, listingFee?, ledgerEffect?, auditId? }
     *
     * Listing fee: when `fromAccountId` is supplied, a fee (default 5,000 μ¢) is charged
     * via LedgerOrchestrator.withdraw() BEFORE the opportunity is persisted.
     * If the withdraw fails (guard deny, insufficient funds), the opportunity is NOT
     * created and 403 is returned. When `fromAccountId` is omitted, listing is free.
     *
     * Fail-closed: if listingFee is provided but fromAccountId is missing → 400.
     */
    { method: "POST", pattern: "/api/marketplace/opportunities", handler: async (c) => {
      const b = c.body || {};
      if (!b.title) return err(400, "title required");

      // If listingFee supplied without fromAccountId → invalid
      if (b.listingFee !== undefined && !b.fromAccountId) {
        return err(400, "fromAccountId required when listingFee is specified");
      }

      let ledgerResult: Awaited<ReturnType<typeof ledger.withdraw>> | null = null;
      let listingFee: bigint = 0n;

      if (b.fromAccountId) {
        // Parse listing fee (default 5,000 μ¢ = 0.05 USD)
        try {
          listingFee = b.listingFee !== undefined ? toMC(b.listingFee) : 5_000n;
          if (listingFee < 0n) return err(400, "listingFee must be non-negative");
        } catch {
          return err(400, "listingFee must be an integer micro-cent string");
        }

        const memo = `marketplace.list:${b.title}`;
        const initiatedBy = String(b.initiatedBy || b.userId || b.fromAccountId || "api");

        // Charge the listing fee through the LedgerOrchestrator chokepoint FIRST
        // Skip the ledger call if fee is 0 (guardPositive rejects 0n)
        if (listingFee > 0n) {
          ledgerResult = await ledger.withdraw(
            c.tenantId,
            b.fromAccountId,
            listingFee,
            memo,
            initiatedBy,
            false, // not autonomous — human-initiated listing
          );

          if (!ledgerResult.ok) {
            return err(403, ledgerResult.reason || "listing denied by guard (fail-closed)");
          }
        }
      }

      // Fee charged (or free listing) — now persist the opportunity
      try {
        // Parse optional budget (μ¢ BigInt, decimal string in JSON)
        let budget: bigint | undefined;
        if (b.budget !== undefined) {
          try {
            budget = toMC(b.budget);
            if (budget < 0n) return err(400, "budget must be non-negative");
          } catch {
            return err(400, "budget must be a non-negative integer micro-cent string");
          }
        }

        const opportunity = await catalog.create({
          tenantId: c.tenantId,
          title: b.title,
          description: b.description ?? "",
          requiredStrengths: b.requiredStrengths,
          id: b.id,
          ...(budget !== undefined ? { budget } : {}),
        });
        // Serialize BigInt budget for JSON (budget field → decimal string)
        const oppForJson = {
          ...opportunity,
          ...(opportunity.budget !== undefined ? { budget: opportunity.budget.toString() } : {}),
        };
        return ok({
          ok: true,
          opportunity: oppForJson,
          ...(b.fromAccountId ? {
            listingFee: listingFee.toString(),
            ...(ledgerResult ? {
              ledgerEffect: ledgerResult.value,
              auditId: ledgerResult.auditId,
              ...(ledgerResult.passport ? { passport: ledgerResult.passport } : {}),
            } : {}),
          } : {}),
        }, 201);
      } catch (e: any) {
        if (e instanceof MarketplaceError) return err(400, e.message);
        return err(500, e?.message || "create failed");
      }
    }},

    /**
     * GET /api/marketplace/opportunities
     * List all opportunities for the requesting tenant.
     * Returns { ok: true, opportunities: Opportunity[] }
     */
    { method: "GET", pattern: "/api/marketplace/opportunities", handler: async (c) => {
      const opps = await catalog.list(c.tenantId);
      return ok({ ok: true, opportunities: opps.map(serializeOpportunity) });
    }},

    /**
     * GET /api/marketplace/opportunities/:id
     * Fetch a single opportunity by id within the tenant.
     * Returns 200 + { ok: true, opportunity } or 404 if not found / wrong tenant.
     * Tenant isolation: cross-tenant id returns 404 (not 403) to avoid id enumeration.
     */
    { method: "GET", pattern: "/api/marketplace/opportunities/:id", handler: async (c) => {
      const opportunity = await catalog.get(c.tenantId, c.params.id);
      if (!opportunity) return err(404, "opportunity not found");
      return ok({ ok: true, opportunity: serializeOpportunity(opportunity) });
    }},

    /**
     * DELETE /api/marketplace/opportunities/:id
     * Delete an opportunity by id within the tenant.
     * Returns 200 + { ok: true } or 404 if not found.
     */
    { method: "DELETE", pattern: "/api/marketplace/opportunities/:id", handler: async (c) => {
      const deleted = await catalog.delete(c.tenantId, c.params.id);
      if (!deleted) return err(404, "opportunity not found");
      return ok({ ok: true });
    }},

    /**
     * POST /api/marketplace/route
     * Route a user against the tenant's opportunity catalog using PotentialEngine.route().
     * Body: { userId, knowledgeSignals?, analyticsSignals? }
     * Returns { ok: true, auditId, data: RoutingDecision }
     *
     * The routing decision flows through TfaOrchestrator (guard + audit),
     * so all autonomous-action rules apply (delegation chain, policy allowlist).
     */
    { method: "POST", pattern: "/api/marketplace/route", handler: async (c) => {
      const b = c.body || {};
      if (!b.userId) return err(400, "userId required");
      const opportunities = await catalog.list(c.tenantId);
      if (opportunities.length === 0) return ok({ ok: true, auditId: null, data: { userId: b.userId, tenantId: c.tenantId, profile: null, matches: [], decidedAt: new Date().toISOString() } });
      const input = {
        userId: b.userId,
        tenantId: c.tenantId,
        knowledgeSignals: b.knowledgeSignals || [],
        analyticsSignals: b.analyticsSignals || [],
        opportunities,
      };
      try {
        return mapOp(await potential.route(input));
      } catch (e: any) {
        return err(400, e.message || "routing failed");
      }
    }},

    /**
     * POST /api/marketplace/opportunities/:id/claim
     * Claim an opportunity by deducting a fee (μ¢) from the caller's account
     * via LedgerOrchestrator.withdraw() (guarded + audited).
     *
     * If the opportunity carries a `budget` AND the body includes both
     * `payerAccountId` and `workerAccountId`, an escrow agreement is created
     * and immediately funded (create→fund in one call). The escrow holds the
     * budget until release (completion) or refund (cancellation).
     *
     * Body: { fromAccountId, claimFee? (integer μ¢ string, default 10000),
     *         workerAccountId?, userId? }
     * Returns 200 + { ok: true, opportunityId, ledgerEffect, auditId, passport?,
     *                 escrow? (EscrowAgreement with amounts as strings) }
     *
     * Errors:
     *   400 — missing fromAccountId
     *   404 — opportunity not found (or belongs to another tenant)
     *   403 — guard denied (insufficient funds, spending cap, or unknown action)
     */
    { method: "POST", pattern: "/api/marketplace/opportunities/:id/claim", handler: async (c) => {
      const b = c.body || {};
      const opportunityId = c.params.id;

      // Validate required fields
      if (!b.fromAccountId) return err(400, "fromAccountId required");

      // Look up the opportunity — fail-closed: returns null for wrong tenant
      const opportunity = await catalog.get(c.tenantId, opportunityId);
      if (!opportunity) return err(404, "opportunity not found");

      // Parse claim fee (default 10,000 μ¢ = 0.10 USD)
      let claimFee: bigint;
      try {
        claimFee = b.claimFee !== undefined ? toMC(b.claimFee) : 10_000n;
        if (claimFee < 0n) return err(400, "claimFee must be non-negative");
      } catch {
        return err(400, "claimFee must be an integer micro-cent string");
      }

      // ── Budget pre-validation: if opportunity has budget + workerAccountId,
      // verify payer can cover BOTH claimFee AND escrow budget before any money moves.
      // Fail-closed: insufficient balance → 403, no ledger side-effects.
      if (opportunity.budget !== undefined && opportunity.budget > 0n && b.workerAccountId) {
        const required = claimFee + opportunity.budget;
        try {
          const payerAccount = await ledger.getAccount(c.tenantId, b.fromAccountId);
          if (payerAccount.balance < required) {
            return err(403, `insufficient balance: need ${required.toString()} μ¢ (claimFee ${claimFee.toString()} + budget ${opportunity.budget.toString()}), have ${payerAccount.balance.toString()} μ¢`);
          }
        } catch {
          return err(404, "payer account not found");
        }
      }

      const memo = `marketplace.claim:${opportunityId}`;
      const initiatedBy = String(b.initiatedBy || b.userId || b.fromAccountId || "api");

      // Charge the fee through the LedgerOrchestrator chokepoint
      const result = await ledger.withdraw(
        c.tenantId,
        b.fromAccountId,
        claimFee,
        memo,
        initiatedBy,
        false, // not autonomous — human-initiated claim
      );

      if (!result.ok) {
        return err(403, result.reason || "claim denied by guard (fail-closed)");
      }

      // ── Auto-escrow: if opportunity has a budget and workerAccountId supplied ──
      // payer = fromAccountId (the claimer funds the escrow for the worker)
      let escrowAgreement: import("../../lib/escrow/types.ts").EscrowAgreement | null = null;
      if (opportunity.budget !== undefined && opportunity.budget > 0n && b.workerAccountId) {
        try {
          const created = await escrow.create({
            tenantId: c.tenantId,
            opportunityId,
            payerAccountId: b.fromAccountId,
            workerAccountId: b.workerAccountId,
            amount: opportunity.budget,
          });
          escrowAgreement = await escrow.fund(c.tenantId, created.id, initiatedBy);
        } catch (e: any) {
          // ── Atomic rollback (saga compensation) ─────────────────────────────────────
          // Escrow failed after claim fee was charged. Compensate via ledger.mint
          // (restores exactly the μ¢ that withdraw removed — no treasury account exists).
          const rollbackMemo = `rollback:claim-fee:${opportunityId}`;
          let rollbackNote = "claim fee refunded";
          let rollbackAuditId: string | undefined;
          try {
            const rb = await ledger.mint(c.tenantId, b.fromAccountId, claimFee, rollbackMemo, initiatedBy, false);
            if (!rb.ok) {
              rollbackNote = `refund denied by guard: ${rb.reason ?? "unknown"}. Manual reconciliation needed. claimFee: ${claimFee.toString()} μ¢`;
            } else {
              rollbackAuditId = rb.auditId; // compensation audit trail (v64)
            }
          } catch (rbErr: any) {
            rollbackNote = `refund failed: ${rbErr?.message ?? "unknown"}. Manual reconciliation needed. claimFee: ${claimFee.toString()} μ¢`;
          }
          // Return 503 with rollbackAuditId in body for auditability
          return {
            status: 503,
            body: {
              error: `escrow failed: ${e?.message || "unknown"}. ${rollbackNote}`,
              ...(rollbackAuditId !== undefined ? { rollbackAuditId } : {}),
            },
          };
        }
      }

      return ok({
        ok: true,
        opportunityId,
        claimFee: claimFee.toString(),
        ledgerEffect: result.value,
        auditId: result.auditId,
        ...(result.passport ? { passport: result.passport } : {}),
        ...(escrowAgreement ? { escrow: serializeAgreement(escrowAgreement) } : {}),
      });
    }},

    // ─── Sovereign Escrow ──────────────────────────────────────────────────────────

    /**
     * POST /api/escrow — create an escrow agreement (and its dedicated ledger account).
     * Body: { opportunityId, payerAccountId, workerAccountId, amount }
     * No money moves yet — use POST /api/escrow/:id/fund to fund.
     * Returns: { ok:true, agreement }  (amount as decimal string, BigInt-safe)
     */
    { method: "POST", pattern: "/api/escrow", handler: async (c) => {
      const b = c.body || {};
      if (!b.opportunityId) return err(400, "opportunityId required");
      if (!b.payerAccountId) return err(400, "payerAccountId required");
      if (!b.workerAccountId) return err(400, "workerAccountId required");
      if (b.amount === undefined || b.amount === null || b.amount === "") return err(400, "amount required");

      let amount: bigint;
      try {
        amount = BigInt(b.amount);
        if (amount <= 0n) return err(400, "amount must be positive (μ¢)");
      } catch {
        return err(400, "amount must be a valid integer (μ¢)");
      }

      try {
        const agreement = await escrow.create({
          tenantId: c.tenantId,
          opportunityId: String(b.opportunityId),
          payerAccountId: String(b.payerAccountId),
          workerAccountId: String(b.workerAccountId),
          amount,
        });
        emitEscrowProjection(c.tenantId, agreement);
        dispatchEvent(c.tenantId, "escrow.created", agreement);
        return { status: 201, body: { ok: true, agreement: serializeAgreement(agreement) } };
      } catch (e: any) {
        if (e?.code === "invalid_input") return err(400, e.message);
        return err(500, e?.message || "escrow create failed");
      }
    }},

    /**
     * POST /api/escrow/:id/fund — payer→escrow transfer (created→funded).
     * Body: { initiatedBy? }
     * Returns: { ok:true, agreement }
     */
    { method: "POST", pattern: "/api/escrow/:id/fund", handler: async (c) => {
      const b = c.body || {};
      const initiatedBy = String(b.initiatedBy || b.userId || "api");
      try {
        const agreement = await escrow.fund(c.tenantId, c.params.id, initiatedBy);
        emitEscrowProjection(c.tenantId, agreement);
        dispatchEvent(c.tenantId, "escrow.funded", agreement);
        return ok({ ok: true, agreement: serializeAgreement(agreement) });
      } catch (e: any) {
        if (e?.code === "not_found") return err(404, e.message);
        if (e?.code === "wrong_state") return err(409, e.message);
        if (e?.code === "unauthorized") return err(403, e.message);
        if (e?.code === "ledger_denied") return err(403, e.message);
        if (e?.code === "invalid_input") return err(400, e.message);
        return err(500, e?.message || "escrow fund failed");
      }
    }},

    /**
     * POST /api/escrow/:id/release — escrow→worker on completion (funded→released).
     * Body: { initiatedBy? }
     * Returns: { ok:true, agreement }
     */
    { method: "POST", pattern: "/api/escrow/:id/release", handler: async (c) => {
      const b = c.body || {};
      const initiatedBy = String(b.initiatedBy || b.userId || "api");
      try {
        const agreement = await escrow.release(c.tenantId, c.params.id, initiatedBy);
        emitEscrowProjection(c.tenantId, agreement);
        dispatchEvent(c.tenantId, "escrow.released", agreement);
        return ok({ ok: true, agreement: serializeAgreement(agreement) });
      } catch (e: any) {
        if (e?.code === "not_found") return err(404, e.message);
        if (e?.code === "wrong_state") return err(409, e.message);
        if (e?.code === "unauthorized") return err(403, e.message);
        if (e?.code === "ledger_denied") return err(403, e.message);
        if (e?.code === "invalid_input") return err(400, e.message);
        return err(500, e?.message || "escrow release failed");
      }
    }},

    /**
     * POST /api/escrow/:id/refund — escrow→payer on cancellation (funded→refunded).
     * Body: { initiatedBy? }
     * Returns: { ok:true, agreement }
     */
    { method: "POST", pattern: "/api/escrow/:id/refund", handler: async (c) => {
      const b = c.body || {};
      const initiatedBy = String(b.initiatedBy || b.userId || "api");
      try {
        const agreement = await escrow.refund(c.tenantId, c.params.id, initiatedBy);
        emitEscrowProjection(c.tenantId, agreement);
        dispatchEvent(c.tenantId, "escrow.refunded", agreement);
        return ok({ ok: true, agreement: serializeAgreement(agreement) });
      } catch (e: any) {
        if (e?.code === "not_found") return err(404, e.message);
        if (e?.code === "wrong_state") return err(409, e.message);
        if (e?.code === "unauthorized") return err(403, e.message);
        if (e?.code === "ledger_denied") return err(403, e.message);
        if (e?.code === "invalid_input") return err(400, e.message);
        return err(500, e?.message || "escrow refund failed");
      }
    }},

    /**
     * POST /api/escrow/:id/dispute — freeze a funded escrow (funded→disputed).
     * Either party (funder or any identity) may raise a dispute. No money moves.
     * Body: { initiatedBy?, reason? }
     * Returns: { ok:true, agreement }
     */
    { method: "POST", pattern: "/api/escrow/:id/dispute", handler: async (c) => {
      const b = c.body || {};
      const initiatedBy = String(b.initiatedBy || b.userId || "api");
      const reason = b.reason ? String(b.reason) : undefined;
      try {
        const agreement = await escrow.dispute(c.tenantId, c.params.id, initiatedBy, reason);
        emitEscrowProjection(c.tenantId, agreement);
        dispatchEvent(c.tenantId, "escrow.disputed", agreement);
        dispatchEvent(c.tenantId, "dispute.opened", agreement);
        return ok({ ok: true, agreement: serializeAgreement(agreement) });
      } catch (e: any) {
        if (e?.code === "not_found") return err(404, e.message);
        if (e?.code === "wrong_state") return err(409, e.message);
        if (e?.code === "invalid_input") return err(400, e.message);
        return err(500, e?.message || "escrow dispute failed");
      }
    }},

    /**
     * POST /api/escrow/:id/undispute — unfreeze a disputed escrow (disputed→funded).
     * Only the funder (settlement authority) may unfreeze.
     * Body: { initiatedBy? }
     * Returns: { ok:true, agreement }
     */
    { method: "POST", pattern: "/api/escrow/:id/undispute", handler: async (c) => {
      const b = c.body || {};
      const initiatedBy = String(b.initiatedBy || b.userId || "api");
      try {
        const agreement = await escrow.undispute(c.tenantId, c.params.id, initiatedBy);
        emitEscrowProjection(c.tenantId, agreement);
        dispatchEvent(c.tenantId, "escrow.undisputed", agreement);
        return ok({ ok: true, agreement: serializeAgreement(agreement) });
      } catch (e: any) {
        if (e?.code === "not_found") return err(404, e.message);
        if (e?.code === "wrong_state") return err(409, e.message);
        if (e?.code === "unauthorized") return err(403, e.message);
        if (e?.code === "invalid_input") return err(400, e.message);
        return err(500, e?.message || "escrow undispute failed");
      }
    }},

    /**
     * GET /api/escrow/:id — fetch an escrow agreement by id (tenant-scoped).
     * Returns: { ok:true, agreement } | 404
     */
    // ─── GET /api/track-record/:identityId ─────────────────────────────────────
    // Verified Track Record (trust price discovery, step 1): a pure read-model over the SIGNED
    // audit chain. Deterministic + explainable; anyone with the chain recomputes the same score.
    { method: "GET", pattern: "/api/track-record/:identityId", handler: async (c) => {
      const identityId = c.params?.identityId;
      if (!identityId) return err(400, "identityId required");
      try {
        const record = await getCachedOrCompute(
          stack.trackRecordCache,
          (stack as any).orchestrator.audit,
          (stack as any).escrowStore,
          c.tenantId,
          identityId,
          {
            accountOwnerResolver: async (tenantId: string, accountId: string) => {
              try {
                const acct = await stack.ledger.getAccount(tenantId, accountId);
                return acct?.ownerId ?? null;
              } catch { return null; }
            },
            identityStore: (stack as any).identities,
          },
        );
        return ok({ ok: true, data: record });
      } catch (e: any) { return err(400, e?.message || "could not compute track record"); }
    }},
    // ─── GET /api/track-record/:identityId/proof — PUBLIC Trust API (K7) ──────
    // A portable, externally-verifiable bundle: the score + the supporting passports + the issuer
    // public key + a bundle hash. Any third party verifies it offline — trust becomes portable.
    { method: "GET", pattern: "/api/track-record/:identityId/proof", handler: async (c) => {
      const identityId = c.params?.identityId;
      if (!identityId) return err(400, "identityId required");
      try {
        const resolver = async (tid: string, accId: string) => {
          try { const a = await stack.ledger.getAccount(tid, accId); return a?.ownerId ?? null; } catch { return null; }
        };
        const record = await computeTrackRecord((stack as any).orchestrator.audit, (stack as any).escrowStore, c.tenantId, identityId, { accountOwnerResolver: resolver, identityStore: (stack as any).identities });
        // supporting passports: allowed audit records of this tenant that touch the identity
        const chain = (stack as any).orchestrator.audit.getChain(c.tenantId) as Array<Record<string, unknown>>;
        const passports: ProofPassportEntry[] = chain
          .filter((r) => r.outcome === "allowed")
          .map((r) => ({ passportId: String((r as any).id ?? ""), auditId: String((r as any).id ?? ""), actionType: String((r as any).actionType ?? ""), outcome: String((r as any).outcome ?? ""), signature: (r as any).signature }))
          .slice(0, 200);
        const bundle = buildTrustProofBundle({ tenantId: c.tenantId, identityId, record, passports, publicKey: (stack as any).publicKey ?? null, algorithm: (stack as any).signer?.algorithm ?? "hmac-sha256" });
        return ok({ ok: true, data: bundle });
      } catch (e: any) { return err(400, e?.message || "could not build proof bundle"); }
    }},
    // ─── GET /api/track-record/:identityId/proof-v2 — PUBLIC Trust API v2 (K7+) ─
    { method: "GET", pattern: "/api/track-record/:identityId/proof-v2", handler: async (c) => {
      const identityId = c.params?.identityId;
      if (!identityId) return err(400, "identityId required");
      try {
        const resolver = async (tid: string, accId: string) => {
          try { const a = await stack.ledger.getAccount(tid, accId); return a?.ownerId ?? null; } catch { return null; }
        };
        const record = await computeTrackRecord((stack as any).orchestrator.audit, (stack as any).escrowStore, c.tenantId, identityId, { accountOwnerResolver: resolver, identityStore: (stack as any).identities });
        const chain = (stack as any).orchestrator.audit.getChain(c.tenantId) as Array<Record<string, unknown>>;
        const passports: ProofPassportEntry[] = chain
          .filter((r) => r.outcome === "allowed")
          .map((r) => ({ passportId: String((r as any).id ?? ""), auditId: String((r as any).id ?? ""), actionType: String((r as any).actionType ?? ""), outcome: String((r as any).outcome ?? ""), signature: (r as any).signature }))
          .slice(0, 200);
        const pk = (stack as any).publicKey ?? null;
        const signerKeys = pk ? [{ kid: "kernel", algorithm: (stack as any).signer?.algorithm ?? "hmac-sha256", publicKey: pk }] : undefined;
        const bundle = buildTrustProofBundleV2({
          tenantId: c.tenantId,
          identityId,
          record,
          passports,
          signerKeys,
          validForMs: PROOF_BUNDLE_DEFAULT_VALID_MS,
        });
        return ok({ ok: true, data: bundle });
      } catch (e: any) { return err(400, e?.message || "could not build proof bundle v2"); }
    }},
    // ─── POST /api/track-record/count-proof — build a selective-disclosure count proof ─
    // Body: { identityId, leafHashes: string[], deniedCount: number, minCount: number, signerId?: string }
    // Returns: { ok: true, proof: CountProof }
    { method: "POST", pattern: "/api/track-record/count-proof", handler: async (c) => {
      if (!c.tenantId) return err(400, "x-tenant-id required");
      const body = c.body;
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return err(400, "request body must be a JSON object");
      }
      const { identityId, leafHashes, deniedCount, minCount, signerId } = body as Record<string, unknown>;
      if (!identityId || typeof identityId !== "string") return err(400, "identityId must be a non-empty string");
      if (!Array.isArray(leafHashes) || leafHashes.length === 0) return err(400, "leafHashes must be a non-empty array");
      if (typeof deniedCount !== "number" && typeof deniedCount !== "string") return err(400, "deniedCount must be a number");
      if (typeof minCount !== "number" && typeof minCount !== "string") return err(400, "minCount must be a number");
      const dc = Number(deniedCount);
      const mc = Number(minCount);
      if (!Number.isInteger(dc) || dc < 0) return err(400, "deniedCount must be a non-negative integer");
      if (!Number.isInteger(mc) || mc < 1) return err(400, "minCount must be a positive integer");
      try {
        const proof = buildCountProof({
          tenantId: c.tenantId,
          identityId: String(identityId),
          leafHashes: leafHashes as string[],
          deniedCount: dc,
          minCount: mc,
          signer: (stack as any).signer,
          signerId: signerId ? String(signerId) : ((stack as any).kid ?? "kernel"),
        });
        return ok({ ok: true, proof });
      } catch (e: any) { return err(400, e?.message || "could not build count proof"); }
    }},
    // ─── POST /api/track-record/count-proof/verify — verify a count proof ──────────────
    // Body: { proof: CountProof }
    // Returns: { ok: true, valid: boolean }
    { method: "POST", pattern: "/api/track-record/count-proof/verify", handler: async (c) => {
      if (!c.tenantId) return err(400, "x-tenant-id required");
      const body = c.body;
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return err(400, "request body must be a JSON object");
      }
      const { proof } = body as Record<string, unknown>;
      if (!proof || typeof proof !== "object") return err(400, "proof must be an object");
      try {
        const valid = verifyCountProof(proof, (stack as any).signer);
        return ok({ ok: true, valid });
      } catch (e: any) { return err(400, e?.message || "could not verify count proof"); }
    }},
    // ─── POST /api/track-record/predicate-proof — build a selective-disclosure predicate proof ─
    // Body: { identityId, leafHashes: string[], threshold: string (micro-cents BigInt),
    //         allBelowThreshold: boolean, minCount: number, signerId?: string }
    // Returns: { ok: true, proof: PredicateProof }
    { method: "POST", pattern: "/api/track-record/predicate-proof", handler: async (c) => {
      if (!c.tenantId) return err(400, "x-tenant-id required");
      const body = c.body;
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return err(400, "request body must be a JSON object");
      }
      const { identityId, leafHashes, threshold, allBelowThreshold, minCount, signerId } = body as Record<string, unknown>;
      if (!identityId || typeof identityId !== "string") return err(400, "identityId must be a non-empty string");
      if (!Array.isArray(leafHashes) || leafHashes.length === 0) return err(400, "leafHashes must be a non-empty array");
      if (threshold === undefined || threshold === null) return err(400, "threshold (micro-cents) required");
      if (typeof allBelowThreshold !== "boolean") return err(400, "allBelowThreshold must be a boolean");
      if (typeof minCount !== "number" && typeof minCount !== "string") return err(400, "minCount must be a number");
      const mc = Number(minCount);
      if (!Number.isInteger(mc) || mc < 1) return err(400, "minCount must be a positive integer");
      let thresholdBigInt: bigint;
      try { thresholdBigInt = BigInt(String(threshold)); } catch { return err(400, "threshold must be a valid integer string (micro-cents)"); }
      if (thresholdBigInt <= 0n) return err(400, "threshold must be > 0");
      try {
        const proof = buildPredicateProof({
          tenantId: c.tenantId,
          identityId: String(identityId),
          leafHashes: leafHashes as string[],
          threshold: thresholdBigInt,
          allBelowThreshold,
          minCount: mc,
          signer: (stack as any).signer,
          signerId: signerId ? String(signerId) : ((stack as any).kid ?? "kernel"),
        });
        return ok({ ok: true, proof });
      } catch (e: any) { return err(400, e?.message || "could not build predicate proof"); }
    }},
    // ─── POST /api/track-record/predicate-proof/verify — verify a predicate proof ──────
    // Body: { proof: PredicateProof }
    // Returns: { ok: true, valid: boolean }
    { method: "POST", pattern: "/api/track-record/predicate-proof/verify", handler: async (c) => {
      if (!c.tenantId) return err(400, "x-tenant-id required");
      const body = c.body;
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return err(400, "request body must be a JSON object");
      }
      const { proof } = body as Record<string, unknown>;
      if (!proof || typeof proof !== "object") return err(400, "proof must be an object");
      try {
        const valid = verifyPredicateProof(proof, (stack as any).signer);
        return ok({ ok: true, valid });
      } catch (e: any) { return err(400, e?.message || "could not verify predicate proof"); }
    }},
    // ─── POST /api/track-record/redacted-proof-bundle — build a redacted proof bundle ─
    // Takes a full TrustProofBundleV2 and produces a version-"2r" redacted bundle:
    // verdict counts + SHA-256 commitments to all sensitive arrays, no raw content.
    // Body: { bundle: TrustProofBundleV2 }
    // Returns: { ok: true, redacted: RedactedTrustProofBundle }
    { method: "POST", pattern: "/api/track-record/redacted-proof-bundle", handler: async (c) => {
      if (!c.tenantId) return err(400, "x-tenant-id required");
      const body = c.body;
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return err(400, "request body must be a JSON object");
      }
      const { bundle } = body as Record<string, unknown>;
      if (!bundle || typeof bundle !== "object" || Array.isArray(bundle)) {
        return err(400, "bundle must be a TrustProofBundleV2 object");
      }
      // Tenant-scope check: the bundle's tenantId must match the caller's tenant.
      const bObj = bundle as Record<string, unknown>;
      if (typeof bObj.tenantId === "string" && bObj.tenantId !== c.tenantId) {
        return err(403, "bundle.tenantId does not match x-tenant-id");
      }
      try {
        const redacted = buildRedactedProofBundle(bundle as any);
        return ok({ ok: true, redacted });
      } catch (e: any) { return err(400, e?.message || "could not build redacted proof bundle"); }
    }},
    // ─── POST /api/track-record/redacted-proof-bundle/verify — verify a redacted bundle ─
    // Offline deterministic verification: recomputes redactedBundleHash and
    // optionally enforces freshness and passport-presence requirements.
    // Body: { bundle: RedactedTrustProofBundle, options?: RedactedBundleVerifyOptions }
    // Returns: { ok: true, valid: boolean }
    { method: "POST", pattern: "/api/track-record/redacted-proof-bundle/verify", handler: async (c) => {
      if (!c.tenantId) return err(400, "x-tenant-id required");
      const body = c.body;
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return err(400, "request body must be a JSON object");
      }
      const { bundle, options } = body as Record<string, unknown>;
      if (!bundle || typeof bundle !== "object") return err(400, "bundle must be an object");
      // Tenant-scope check: a caller can only verify bundles scoped to their tenant.
      const bObj2 = bundle as Record<string, unknown>;
      if (typeof bObj2.tenantId === "string" && bObj2.tenantId !== c.tenantId) {
        return err(403, "bundle.tenantId does not match x-tenant-id");
      }
      try {
        const valid = verifyRedactedProofBundle(
          bundle,
          (options && typeof options === "object" && !Array.isArray(options))
            ? options as any
            : {},
        );
        return ok({ ok: true, valid });
      } catch (e: any) { return err(400, e?.message || "could not verify redacted proof bundle"); }
    }},
    // ─── GET /api/escrow — list the tenant's agreements (dashboard/read-only) ──
    { method: "GET", pattern: "/api/escrow", handler: async (c) => {
      const list = await (stack as any).escrowStore.list(c.tenantId);
      return ok({ ok: true, data: { agreements: list.map((a: any) => serializeAgreement(a)) } });
    }},
    { method: "GET", pattern: "/api/escrow/:id", handler: async (c) => {
      const agreement = await escrow.get(c.tenantId, c.params.id);
      if (!agreement) return err(404, "escrow agreement not found");
      return ok({ ok: true, agreement: serializeAgreement(agreement) });
    }},

    /**
     * POST /api/auth/api-keys — Create a new API key for the current tenant.
     * Body: { name, scopes?, expiresAt? }
     * Returns: 201 { ok: true, key: { keyId, tenantId, name, scopes, createdAt, expiresAt }, secret }
     * The secret is shown exactly once.
     */
    { method: "POST", pattern: "/api/auth/api-keys", handler: async (c) => {
      const b = c.body || {};
      if (!b.name || typeof b.name !== "string") return err(400, "name required");
      const result = await stack.apiKeyService.create({
        tenantId: c.tenantId,
        name: String(b.name),
        scopes: Array.isArray(b.scopes) ? b.scopes.map(String) : undefined,
        expiresAt: b.expiresAt ? String(b.expiresAt) : undefined,
      });
      return ok({ ok: true, key: result.key, secret: result.secret }, 201);
    }},

    /**
     * GET /api/auth/api-keys — List active API keys for the current tenant.
     * Returns: 200 { ok: true, keys: Array<ApiKeyWithoutHash> }
     */
    { method: "GET", pattern: "/api/auth/api-keys", handler: async (c) => {
      const keys = await stack.apiKeyService.list(c.tenantId);
      return ok({ ok: true, keys });
    }},

    /**
     * DELETE /api/auth/api-keys/:keyId — Revoke an API key.
     * Returns: 204 on success, 404 if key not found or belongs to another tenant.
     */
    { method: "DELETE", pattern: "/api/auth/api-keys/:keyId", handler: async (c) => {
      const key = await stack.apiKeyStore.get(c.params.keyId);
      if (!key || key.tenantId !== c.tenantId) return err(404, "key not found");
      const revoked = await stack.apiKeyService.revoke(c.params.keyId);
      if (!revoked) return err(404, "key not found");
      return ok({ ok: true }, 204);
    }},

    /**
     * POST /api/tenants — Tenant Onboarding API (v90, step G.5; v99→14b: + plan).
     * Creates a new tenant with a root person, default policies, and first ledger account
     * in a single call. Idempotent: calling again for the same tenant returns the existing
     * state without error.
     *
     * Body (optional): { rootPersonName?, accountName?, accountType?, plan? }
     *   plan: "free" | "pro" (default "free" on first creation; on a repeat call, an
     *   explicit `plan` re-assigns the tenant's plan — e.g. an upgrade — while omitting
     *   it leaves the existing plan untouched). Compiled automatically into this
     *   tenant's policy set via the "tenant-plan-limit" guard (TenantPlanRegistry) —
     *   no separate policy-compose step required.
     *
     * Returns: { ok: true, tenantId, rootPerson, account, policies, plan, created }
     */
    { method: "POST", pattern: "/api/tenants", handler: async (c) => {
      const tenantId = c.tenantId;
      if (!tenantId) return err(400, "x-tenant-id header required (tenant isolation)");
      const b = c.body || {};

      // Plan assignment: validate before touching any state (fail-closed on bad input).
      if (b.plan !== undefined && !TenantPlanRegistry.isValidPlan(b.plan)) {
        return err(400, `invalid plan "${b.plan}" — must be one of: ${Object.keys(PLAN_LIMITS).join(", ")}`);
      }

      const rootId = `human-root:${tenantId}`;

      // Idempotent root-person creation
      let rootPerson = identities.getById(rootId);
      let createdPerson = false;
      if (!rootPerson) {
        try {
          rootPerson = identities.create({
            id: rootId,
            tenantId,
            type: "human",
            parentId: null,
            createdAt: new Date().toISOString(),
            metadata: b.rootPersonName ? { name: String(b.rootPersonName) } : undefined,
          } as any);
          createdPerson = true;
        } catch (e: any) {
          return err(400, e?.message || "failed to create root person");
        }
      }

      // Idempotent first-ledger-account creation
      let account: any = null;
      let createdAccount = false;
      try {
        const accounts = await ledger.listAccounts(tenantId);
        account = accounts.find((a) => a.ownerId === rootId) ?? null;
        if (!account) {
          const type = b.accountType || "asset";
          if (!["asset", "liability", "equity", "revenue", "expense"].includes(type)) {
            return err(400, "invalid accountType");
          }
          account = await ledger.createAccount(
            tenantId,
            rootId,
            type as import("../../lib/ledger/types.ts").AccountType,
            b.accountName ? String(b.accountName) : "Root Account",
          );
          createdAccount = true;
        }
      } catch (e: any) {
        return err(400, e?.message || "failed to create ledger account");
      }

      // Plan: explicit `plan` always (re-)assigns; first creation defaults to "free"
      // (PLAN_LIMITS["free"]); a repeat call with no `plan` leaves it unchanged.
      if (b.plan !== undefined) {
        stack.tenantPlans.set(tenantId, b.plan);
      } else if (createdPerson && stack.tenantPlans.get(tenantId) === undefined) {
        stack.tenantPlans.set(tenantId, "free");
      }

      return ok({
        ok: true,
        tenantId,
        rootPerson,
        account: { ...account, balance: account.balance.toString() },
        policies: stack.policies.map((p) => p.name),
        plan: stack.tenantPlans.get(tenantId),
        created: createdPerson || createdAccount,
      }, createdPerson || createdAccount ? 201 : 200);
    }},

    /**
     * GET /api/tenants — Return the current tenant's registered plan.
     * Read-only. Returns { ok: true, tenantId, plan } where plan is "free" | "pro" | undefined.
     * Used by the dashboard plan badge (v104).
     */
    { method: "GET", pattern: "/api/tenants", handler: (c) => {
      if (!c.tenantId) return err(400, "x-tenant-id header required");
      const plan = stack.tenantPlans.get(c.tenantId);
      return ok({ ok: true, tenantId: c.tenantId, plan: plan ?? null });
    }},
    ...introductionRoutes(stack),
  ];
}

/** Serialize an EscrowAgreement for JSON — convert BigInt amount to decimal string. */
function serializeAgreement(a: import("../../lib/escrow/types.ts").EscrowAgreement): Record<string, unknown> {
  return { ...a, amount: a.amount.toString() };
}

/** Serialize an Opportunity for JSON: BigInt budget → decimal string. */
function serializeOpportunity(o: import("../../lib/potential/types.ts").Opportunity): Record<string, unknown> {
  const { budget, ...rest } = o as any;
  return budget !== undefined ? { ...rest, budget: budget.toString() } : rest;
}
