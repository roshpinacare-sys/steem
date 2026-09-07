/**
 * src/routes/witness-routes.ts — HTTP routes for transparency-log witness co-signing.
 *
 * Exposes the v387 witness core (lib/transparency-log/witness.ts) and its
 * v388 registry (lib/transparency-log/witness-registry.ts) over HTTP: a
 * provisioned witness POSTs its co-signed tree-head statement; a receipt
 * holder GETs whether a quorum of distinct, verified witnesses agree on a
 * given root.
 *
 * Routes:
 *   POST /api/transparency-log/witness
 *     Body: WitnessStatement (version, logId, root, treeSize, observedAt,
 *           witnessId, algorithm, signature)
 *     Response: 200 { ok: true, statement }   — accepted and stored.
 *     Response: 400 { error }                 — missing x-tenant-id, malformed body.
 *     Response: 403 { error }                 — witnessId not registered for tenant,
 *                                                 or signature does not verify against
 *                                                 its registered key. The statement is
 *                                                 NOT stored in either case (fail-closed:
 *                                                 we never persist an unverifiable claim).
 *     requiresIdempotencyKey: true — state-changing; caller must supply Idempotency-Key.
 *
 *   GET /api/transparency-log/witness/quorum?logId=&root=&treeSize=&threshold=
 *     Response: 200 { ok: true, result: WitnessQuorumResult }
 *       result.reached tells the caller whether enough distinct witnesses
 *       co-signed exactly this root at this position.
 *     Response: 400 { error } — missing x-tenant-id or any required/invalid query param.
 *     Response: 409 { error, code: "SPLIT_VIEW", roots }
 *       — a verified witness signed a DIFFERENT root at this exact (logId,
 *       treeSize). This is the split-view alarm; the caller must NOT trust
 *       the target root.
 *
 *   GET /api/transparency-log/witness/statements?logId=&treeSize=
 *     Response: 200 { ok: true, statements, total }
 *     Returns the raw stored statements for the tenant, optionally filtered
 *     to one log position. Useful for audit / debugging quorum results.
 *     Response: 400 { error } — missing x-tenant-id.
 *
 * Invariants:
 *   • Missing x-tenant-id → 400 on every route.
 *   • Cross-tenant isolation enforced by WitnessRegistry (all reads/writes
 *     are scoped to c.tenantId; a wrong-tenant submission cannot be verified
 *     against another tenant's registered witnesses and is rejected).
 *   • A statement is stored only after independent server-side re-verification
 *     (submit() never trusts that a POST body's signature is genuine without
 *     checking it against the registered key) — never a pass-through write.
 *   • SplitViewError is surfaced as 409, never swallowed into a 200.
 */

import type { SovereignStack } from "../composition.ts";
import type { Route } from "./sovereign-routes.ts";
import { SplitViewError, WitnessError, type WitnessStatement } from "../../lib/transparency-log/witness.ts";

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

const HEX64_RE = /^[a-f0-9]{64}$/i;

function isWellFormedStatement(b: any): b is WitnessStatement {
  return (
    !!b &&
    typeof b === "object" &&
    typeof b.version === "string" &&
    typeof b.logId === "string" && b.logId.length > 0 &&
    typeof b.root === "string" && HEX64_RE.test(b.root) &&
    Number.isInteger(b.treeSize) && b.treeSize >= 1 &&
    typeof b.observedAt === "string" && b.observedAt.length > 0 &&
    typeof b.witnessId === "string" && b.witnessId.length > 0 &&
    typeof b.algorithm === "string" &&
    typeof b.signature === "string" && b.signature.length > 0
  );
}

function parsePositiveInt(raw: string | undefined): number | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || String(n) !== raw.trim()) return null;
  return n;
}

export function witnessRoutes(stack: SovereignStack): Route[] {
  const { witnessRegistry } = stack;

  return [
    // ── POST /api/transparency-log/witness ──────────────────────────────────
    {
      method: "POST",
      pattern: "/api/transparency-log/witness",
      requiresIdempotencyKey: true,
      handler: async (c: Ctx): Promise<Res> => {
        if (!c.tenantId) return err(400, "x-tenant-id header required");
        if (!isWellFormedStatement(c.body)) {
          return err(400, "body must be a well-formed WitnessStatement");
        }

        const accepted = witnessRegistry.submit(c.tenantId, c.body);
        if (!accepted) {
          return err(
            403,
            "witness statement rejected: witnessId not registered for tenant, or signature does not verify",
          );
        }

        return ok({ ok: true, statement: accepted });
      },
    },

    // ── GET /api/transparency-log/witness/quorum ────────────────────────────
    {
      method: "GET",
      pattern: "/api/transparency-log/witness/quorum",
      handler: async (c: Ctx): Promise<Res> => {
        if (!c.tenantId) return err(400, "x-tenant-id header required");

        const { logId, root, treeSize: rawTreeSize, threshold: rawThreshold } = c.query;
        if (typeof logId !== "string" || logId.length === 0) return err(400, "logId query param required");
        if (typeof root !== "string" || !HEX64_RE.test(root)) return err(400, "root query param must be 64-hex sha256");

        const treeSize = parsePositiveInt(rawTreeSize);
        if (treeSize === null) return err(400, "treeSize query param must be a positive integer");

        const threshold = parsePositiveInt(rawThreshold);
        if (threshold === null) return err(400, "threshold query param must be a positive integer");

        try {
          const result = witnessRegistry.quorumFor(c.tenantId, { logId, root, treeSize }, threshold);
          return ok({ ok: true, result });
        } catch (e) {
          if (e instanceof SplitViewError) {
            return { status: 409, body: { error: e.message, code: e.code, roots: e.roots } };
          }
          if (e instanceof WitnessError) {
            return err(400, e.message);
          }
          throw e;
        }
      },
    },

    // ── GET /api/transparency-log/witness/statements ────────────────────────
    {
      method: "GET",
      pattern: "/api/transparency-log/witness/statements",
      handler: async (c: Ctx): Promise<Res> => {
        if (!c.tenantId) return err(400, "x-tenant-id header required");

        const { logId, treeSize: rawTreeSize } = c.query;
        let statements = witnessRegistry.list(c.tenantId);

        if (typeof logId === "string" && logId.length > 0) {
          statements = statements.filter((s) => s.logId === logId);
        }
        if (typeof rawTreeSize === "string" && rawTreeSize.length > 0) {
          const treeSize = parsePositiveInt(rawTreeSize);
          if (treeSize === null) return err(400, "treeSize query param must be a positive integer");
          statements = statements.filter((s) => s.treeSize === treeSize);
        }

        return ok({ ok: true, statements, total: statements.length });
      },
    },
  ];
}
