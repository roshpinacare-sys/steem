/**
 * src/routes/eval-routes.ts — framework-agnostic eval harness routes.
 *
 * Routes:
 *   GET  /api/eval/run           — run all golden tasks; return aggregate + per-task results
 *   GET  /api/eval/run/:taskId   — run a single golden task by id
 *
 * Design:
 *   • Same Ctx/Res contract as sovereign-routes.ts — no framework lock-in.
 *   • No tenant isolation required (eval is internal; the golden tasks manage their own
 *     sandboxed tenants). tenantId is still threaded through Ctx (by convention) but not
 *     used to filter results.
 *   • BigInt amounts in EvalRunResult are serialised as strings by the server's JSON
 *     replacer — no special handling needed here.
 *   • Errors propagate as 500 (eval failures are infrastructure problems, not user errors).
 */

import type { Route } from "./sovereign-routes.ts";
import { GOLDEN_TASKS, runAllGoldenTasks } from "../../lib/eval/golden-tasks.ts";
import type { EvalRunResult } from "../../lib/eval/types.ts";

// ─── Serialisation helpers ────────────────────────────────────────────────────

/** Replace BigInt with string for JSON-safe transport. */
function safeResult(r: EvalRunResult): unknown {
  return JSON.parse(JSON.stringify(r, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
}

// ─── Route factory ────────────────────────────────────────────────────────────

export function evalRoutes(): Route[] {
  return [
    // ── GET /api/eval/run — run all golden tasks ───────────────────────────
    {
      method: "GET",
      pattern: "/api/eval/run",
      handler: async (_ctx) => {
        try {
          const report = await runAllGoldenTasks();
          return {
            status: 200,
            body: {
              ok: true,
              overallMean: report.overallMean,
              scorecardMeans: report.scorecardMeans,
              taskCount: report.tasks.length,
              tasks: report.tasks.map(safeResult),
            },
          };
        } catch (e: any) {
          return {
            status: 500,
            body: { ok: false, error: e?.message ?? "eval failed" },
          };
        }
      },
    },

    // ── GET /api/eval/run/:taskId — run a single golden task ──────────────
    {
      method: "GET",
      pattern: "/api/eval/run/:taskId",
      handler: async (ctx) => {
        const { taskId } = ctx.params;
        const task = GOLDEN_TASKS.find((t) => t.id === taskId);
        if (!task) {
          return { status: 404, body: { ok: false, error: `task '${taskId}' not found` } };
        }
        try {
          const result = await task.run();
          return { status: 200, body: { ok: true, task: safeResult(result) } };
        } catch (e: any) {
          return { status: 500, body: { ok: false, error: e?.message ?? "eval task failed" } };
        }
      },
    },
  ];
}
