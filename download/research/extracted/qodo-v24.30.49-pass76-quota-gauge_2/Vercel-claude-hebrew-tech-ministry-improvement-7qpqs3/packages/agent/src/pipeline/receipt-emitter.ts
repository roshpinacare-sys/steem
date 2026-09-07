/**
 * receipt-emitter.ts — node-side glue that assembles and writes the
 * Verifiable Autonomy Receipt at the end of EVERY run (done / halted /
 * failed). Best-effort like audit(): a receipt failure never breaks a run.
 *
 * Mutual anchoring order (documented in docs/RECEIPTS.md): the receipt
 * records the audit-chain head as it stood at issuance, the file is written,
 * and only THEN is a `receipt-issued` event (carrying the receipt's own
 * sha256) appended to the chain — so the chain proves the receipt and the
 * receipt pins the chain.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { WORKSPACE_ROOT, audit } from "./helpers.js";
import { resolveRelayLineage } from "./relay-lineage.js";
import { verifyAuditChain, type AuditEntry } from "../services/audit-log.js";
import { budgetStatus } from "../services/budget-governor.js";
import { getBond, canAutoMerge } from "../services/trust-ledger.js";
import { log } from "../services/logger.js";
import {
  RECEIPT_SCHEMA, sha256Hex, signReceipt, receiptSha256,
  type AutonomyReceipt, type RehearsalEnvelope,
} from "../services/receipt.js";
import type { LoadedPolicy } from "../services/policy.js";
import type { PhaseContext } from "./context.js";

const AUDIT_FILE = ".audit-log.ndjson";
const RECEIPT_FILE = "receipt.json";

// ── Run-scoped stashes (set by the orchestrator / CLI before phases run) ────

let stashedPolicy: LoadedPolicy | null = null;
let stashedRehearsal: (RehearsalEnvelope & { envelopeSha256: string }) | null = null;

export function stashLoadedPolicy(p: LoadedPolicy): void {
  stashedPolicy = p;
}

export function stashRehearsalEnvelope(env: RehearsalEnvelope & { envelopeSha256: string }): void {
  stashedRehearsal = env;
}

const APPROVAL_EVENTS = new Set([
  "approval-manual", "approval-trust", "approval-auto-override",
  "mentor-pre-commit-approved", "mentor-pre-commit-rejected",
]);

function readAuditEntries(root: string): AuditEntry[] {
  const path = resolve(root, AUDIT_FILE);
  if (!existsSync(path)) return [];
  const out: AuditEntry[] = [];
  for (const line of readFileSync(path, "utf8").trim().split("\n")) {
    if (!line) continue;
    try { out.push(JSON.parse(line) as AuditEntry); } catch { /* partial tail line */ }
  }
  return out;
}

/** Assemble, sign (when QODO_RECEIPT_KEY is set), write, and chain-anchor. */
export async function emitReceipt(
  ctx: PhaseContext,
  outcome: "done" | "halted" | "failed",
  pipelineStart: number,
): Promise<AutonomyReceipt | null> {
  try {
    const { s, owner, repo, prNumber, runId, policy, ledgerCategory, state } = ctx;

    const entries = readAuditEntries(WORKSPACE_ROOT);
    const head = entries[entries.length - 1] ?? null;
    const chain = verifyAuditChain(WORKSPACE_ROOT);

    const gates = s.gate
      ? (() => {
          const v = {
            lockCheck: Boolean(s.gate!.lockCheck?.allowed),
            blast: Boolean(s.gate!.blast?.allowed),
            dom: Boolean(s.gate!.dom?.allowed),
            shadow: Boolean(s.gate!.shadow?.allowed),
            chaos: Boolean(s.gate!.chaos?.allowed),
            test: Boolean(s.gate!.test?.allowed),
            ...(s.gate!.contractGuard ? { contractGuard: Boolean(s.gate!.contractGuard.passed) } : {}),
          };
          return { ...v, gateOpen: Object.values(v).every(Boolean) };
        })()
      : null;

    const approvalDecision =
      [...entries].reverse().find((e) => e.actor === runId && APPROVAL_EVENTS.has(e.event))?.event
        ?? "none-required";

    const bond = await getBond(owner, repo, ledgerCategory, state).catch(() => null);
    const b = budgetStatus();

    let receipt: AutonomyReceipt = {
      schema: RECEIPT_SCHEMA,
      subject: {
        owner,
        repo,
        prNumber,
        commitSha: s.commitSha ?? null,
        diffSha256: s.patch ? await sha256Hex(s.patch.diff) : null,
        filesTouched: s.patch?.files.map((f) => f.path) ?? [],
      },
      run: {
        runId,
        startedAt: s.startedAt,
        finishedAt: new Date().toISOString(),
        durationMs: Date.now() - pipelineStart,
        outcome,
      },
      controls: {
        policy: {
          source: stashedPolicy?.source ?? null,
          sha256: stashedPolicy?.sha256 ?? null,
          autonomy: policy.autonomy,
          approval: policy.approval ?? null,
          budgetCapCents: policy.budget?.maxUsdCents ?? null,
        },
        approval: {
          mode: policy.autonomy === "mentor" ? "mentor-forced" : policy.approval ?? "inherit",
          decision: approvalDecision,
        },
        gates,
        // capCents 0 means "no cap armed" (initBudget(undefined)) — a receipt
        // must say null there, or any real spend would look inconsistent.
        budget: { capCents: b.capCents > 0 ? b.capCents : null, spentCents: Math.round(b.spentCents), exceeded: b.exceeded },
        trust: {
          category: ledgerCategory,
          score: bond?.score ?? 0,
          canAutoMerge: bond ? canAutoMerge(bond) : false,
        },
      },
      evidence: {
        auditHead: head ? { seq: head.seq, hash: head.hash } : { seq: -1, hash: "0".repeat(64) },
        auditEntries: entries.length,
        chainValid: chain.valid,
      },
      ...(stashedRehearsal ? { rehearsal: stashedRehearsal } : {}),
      ...(() => {
        const { parentReceipt, hopIndex, genesis } = resolveRelayLineage(WORKSPACE_ROOT);
        return parentReceipt
          ? { lineage: { hopIndex, parentReceiptSha256: genesis, genesis } }
          : {};
      })(),
    };
    stashedRehearsal = null; // consume-once: never bleed into a later run

    const key = process.env.QODO_RECEIPT_KEY;
    if (key && key.trim() !== "") receipt = await signReceipt(receipt, key.trim());

    writeFileSync(resolve(WORKSPACE_ROOT, RECEIPT_FILE), JSON.stringify(receipt, null, 2) + "\n");
    audit(runId, "receipt-issued", { receiptSha256: await receiptSha256(receipt), outcome });
    log.info("autonomy receipt issued", { runId, outcome, signed: Boolean(receipt.signature) });
    return receipt;
  } catch (e: unknown) {
    log.warn("receipt emission failed (run unaffected)", { err: e instanceof Error ? e.message : String(e) });
    return null;
  }
}
