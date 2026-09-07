/**
 * src/routes/transparency-log-routes.ts — Transparency Log query routes.
 *
 * Routes:
 *   GET /api/transparency/log/root
 *     Response: 200 { ok, root: AnchoredRoot|null }
 *     Returns the latest Merkle root for the tenant.
 *
 *   GET /api/transparency/log/proof/:receiptId
 *     Response: 200 { ok, proof: MerkleProof, root: AnchoredRoot, leafIndex }
 *     Response: 404 { error } — receipt not found in log for this tenant.
 *
 *   GET /api/transparency-log/consistency?oldSize=N
 *     Response: 200 { ok, proof: ConsistencyProof, oldRoot: string, newRoot: string }
 *     Response: 400 { error } — missing tenant-id or invalid oldSize param.
 *     Response: 404 { error } — no leaves yet, or oldSize out of [1, leafCount].
 *     Returns a consistency proof that the first N leaves are a prefix of the
 *     current tree. A monitor that holds an older AnchoredRoot can independently
 *     verify (verifyConsistencyProof) that the log only grew since that root.
 *
 *   GET /api/transparency-log/consistency/monitor
 *     Response: 200 { ok, checked, failures, rootCount }
 *     Runs the consistency monitor over all root transitions for the tenant.
 *     ok=false means at least one root transition failed consistency — tamper signal.
 *
 * Invariants:
 *   • Missing x-tenant-id → 400
 *   • Cross-tenant isolation enforced by TransparencyLog (returns null → 404)
 *   • No admin scope required — transparency is public within the tenant.
 */

import type { SovereignStack } from "../composition.ts";
import type { Route } from "./sovereign-routes.ts";
import { runConsistencyMonitor } from "../../lib/transparency-log/consistency-monitor.ts";

interface Ctx {
  tenantId: string;
  body: any;
  params: Record<string, string>;
  query: Record<string, string>;
  scopes?: string[];
  headers?: Record<string, string | string[] | undefined>;
}
interface Res { status: number; body: unknown; }

const ok = (body: unknown, status = 200): Res => ({ status, body });
const err = (status: number, message: string): Res => ({ status, body: { error: message } });

export function transparencyLogRoutes(stack: SovereignStack): Route[] {
  return [
    // ── GET /api/transparency/log/root ──────────────────────────────────────
    {
      method: "GET",
      pattern: "/api/transparency/log/root",
      handler: async (c: Ctx): Promise<Res> => {
        if (!c.tenantId) return err(400, "x-tenant-id header required");
        const root = await stack.transparencyLog.currentRoot(c.tenantId);
        return ok({ ok: true, root });
      },
    },

    // ── GET /api/transparency/log/proof/:receiptId ─────────────────────────
    {
      method: "GET",
      pattern: "/api/transparency/log/proof/:receiptId",
      handler: async (c: Ctx): Promise<Res> => {
        if (!c.tenantId) return err(400, "x-tenant-id header required");
        const receiptId = c.params.receiptId;
        if (!receiptId) return err(400, "receiptId required");

        const result = await stack.transparencyLog.getProofByReceiptId(c.tenantId, receiptId);
        if (!result) {
          return err(404, "receipt not found in transparency log for tenant");
        }

        return ok({
          ok: true,
          proof: result.proof,
          root: result.root,
          leafIndex: result.leafIndex,
        });
      },
    },

    // ── GET /api/transparency-log/consistency?oldSize=N ────────────────────
    {
      method: "GET",
      pattern: "/api/transparency-log/consistency",
      handler: async (c: Ctx): Promise<Res> => {
        if (!c.tenantId) return err(400, "x-tenant-id header required");

        const rawOldSize = c.query.oldSize;
        if (!rawOldSize) return err(400, "oldSize query param required (integer >= 1)");
        const oldSize = parseInt(rawOldSize, 10);
        if (!Number.isInteger(oldSize) || oldSize < 1 || String(oldSize) !== rawOldSize.trim()) {
          return err(400, "oldSize must be a positive integer");
        }

        // Fetch the current root to return oldRoot + newRoot alongside the proof
        // so the caller can immediately verify without a second round-trip.
        const currentRoot = await stack.transparencyLog.currentRoot(c.tenantId);
        if (!currentRoot) return err(404, "no leaves in transparency log for tenant");

        const proof = await stack.transparencyLog.getConsistencyProof(c.tenantId, oldSize);
        if (!proof) {
          return err(404, `oldSize ${oldSize} out of range [1, ${currentRoot.leafCount}] for tenant`);
        }

        // We carry the two roots from the live log so the caller can call verifyConsistencyProof locally.
        // Derive oldRoot from the historical roots list if available; fall back to recomputation.
        const roots = await stack.transparencyLog.getRoots(c.tenantId);
        const oldRootEntry = roots.find((r) => r.leafCount === oldSize) ?? null;

        return ok({
          ok: true,
          proof,
          newRoot: currentRoot.root,
          newSize: currentRoot.leafCount,
          oldRoot: oldRootEntry?.root ?? null,
          oldRootEntry,
        });
      },
    },

    // ── GET /api/transparency-log/consistency/monitor ──────────────────────
    {
      method: "GET",
      pattern: "/api/transparency-log/consistency/monitor",
      handler: async (c: Ctx): Promise<Res> => {
        if (!c.tenantId) return err(400, "x-tenant-id header required");

        const result = await runConsistencyMonitor(c.tenantId, stack.transparencyLog);
        return ok({ ok: result.ok, checked: result.checked, failures: result.failures, rootCount: result.rootCount });
      },
    },
  ];
}
