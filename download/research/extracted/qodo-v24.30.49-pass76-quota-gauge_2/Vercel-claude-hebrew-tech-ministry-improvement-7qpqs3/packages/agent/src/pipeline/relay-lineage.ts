/**
 * relay-lineage.ts — task-56: automatic pickup of a relay hop's parent
 * receipt, so a fresh ZIP handed to a new agent instance seeds its OWN
 * audit chain from the prior hop's receipt hash instead of the fixed
 * all-zero genesis (task-55, `docs/RECEIPTS.md` § "Lineage across relay
 * hops"). Read-only, best-effort, additive: a workspace with no parent
 * receipt file behaves exactly as every workspace always has.
 *
 * On-disk convention (the decision task-56 in `tasks/agent-task-queue.json`
 * flagged as needing to be made explicitly, rather than assumed — recorded
 * here, not left implicit): a relay orchestrator that hands a ZIP to the
 * next hop copies that hop's own `receipt.json` into the NEW workspace
 * root as `.relay-parent-receipt.json` before the next agent instance
 * runs. This pipeline never writes that file itself — only an external
 * relay script does — so a standalone run with no relay in play never
 * sees one and is unaffected. Chosen over an env var or CLI flag because
 * it travels INSIDE the handed-off workspace the same way `.audit-log
 * .ndjson` and `receipt.json` already do, with no extra plumbing through
 * whatever launches the agent (CI job, script, human) — the constraint
 * the original composability question asked for.
 *
 * Deliberately NOT wired into `cli.ts`: the actual first audit-chain write
 * and the actual `emitReceipt()` call both live in `run-pipeline.ts` (see
 * `pipeline/helpers.ts`'s `audit()` and `pipeline/receipt-emitter.ts`),
 * which is NOT a SACRED_FILES entry — cli.ts itself never touches the
 * audit chain or the receipt directly. Task-55's note that this follow-up
 * would need a second sacred-file change was based on an assumption about
 * where the bootstrap lived, not on having traced the actual call sites;
 * tracing them here shows zero sacred files need to change for this
 * feature to work end to end.
 */
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { defaultGenesis } from "../services/audit-log.js";
import { canonicalJson, type AutonomyReceipt } from "../services/receipt.js";
import { log } from "../services/logger.js";

export const PARENT_RECEIPT_FILE = ".relay-parent-receipt.json";

export interface RelayLineage {
  /** Genesis this run's audit chain should start from: the all-zero
   *  constant when there is no parent, or sha256(canonicalJson(parent)). */
  genesis: string;
  parentReceipt: AutonomyReceipt | null;
  hopIndex: number;
}

// Resolved once per process — the parent receipt file, if any, does not
// change mid-run — same caching shape WORKSPACE_ROOT itself already uses
// in helpers.ts. `_resetRelayLineageCache` exists purely for tests that
// need to simulate more than one workspace in a single process.
let cached: RelayLineage | null = null;

export function resolveRelayLineage(workspaceRoot: string): RelayLineage {
  if (cached) return cached;

  const path = resolve(workspaceRoot, PARENT_RECEIPT_FILE);
  if (!existsSync(path)) {
    cached = { genesis: defaultGenesis(), parentReceipt: null, hopIndex: 0 };
    return cached;
  }

  try {
    const parentReceipt = JSON.parse(readFileSync(path, "utf8")) as AutonomyReceipt;
    // Same hash the receiving side of `lineage` recomputes in
    // services/receipt.ts's verifyReceipt: sha256 of the parent's own
    // canonical JSON, not anything the parent claimed about itself.
    const genesis = createHash("sha256").update(canonicalJson(parentReceipt)).digest("hex");
    const hopIndex = (parentReceipt.lineage?.hopIndex ?? 0) + 1;
    cached = { genesis, parentReceipt, hopIndex };
    log.info("relay-lineage: parent receipt found, chaining genesis", {
      hopIndex, genesis: genesis.slice(0, 8),
    });
  } catch (e: unknown) {
    // A present-but-corrupt parent file must never block the run — it
    // degrades to "no lineage", the same as if the file were absent.
    log.warn("relay-lineage: parent receipt file present but unreadable; starting a fresh chain", {
      err: e instanceof Error ? e.message : String(e),
    });
    cached = { genesis: defaultGenesis(), parentReceipt: null, hopIndex: 0 };
  }
  return cached;
}

/** Test-only: clear the process-level cache between isolated test runs. */
export function _resetRelayLineageCache(): void {
  cached = null;
}
