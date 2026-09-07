/**
 * tests/risk/action-simulator.test.ts — v234.
 * simulateAction: pre-action dry-run / predicted-effect preview (MetaMask-parity, generalized).
 *
 *   FEATURE       known actions → correct reversibility, blast radius, predicted effect.
 *   VALUE         value-moving actions surface value-at-risk (μ¢ BigInt).
 *   EDGE          read-only → reversible/no blast; shell.exec → unbounded + warning.
 *   FAIL-CLOSED   unknown action → worst-case (irreversible/unknown/warned); bad input throws.
 */
import { test, assert, eq } from "../_harness.mjs";
import { simulateAction } from "../../lib/risk/action-simulator.ts";

test("destructive known action → irreversible with correct blast radius", () => {
  const del = simulateAction({ actionType: "file.delete", resourceRef: "/etc/x" });
  eq(del.reversible, false, "file.delete is irreversible");
  eq(del.blastRadius, "single_resource");
  assert(del.predictedEffect.includes("file.delete"), "names the action");
  assert(del.warnings.some((w) => w.includes("irreversible")), "warns irreversible");

  const mig = simulateAction({ actionType: "db.migration" });
  eq(mig.blastRadius, "datastore");
  eq(mig.requiresBackup, true, "datastore change requires backup");

  const infra = simulateAction({ actionType: "infra.destroy" });
  assert(infra.blastRadius === "infrastructure" || infra.blastRadius === "single_resource");
  eq(infra.reversible, false);
});

test("value-moving action surfaces value-at-risk in μ¢ BigInt", () => {
  const swap = simulateAction({ actionType: "token.swap", valueMicrounits: 5_000_000n });
  eq(swap.blastRadius, "funds");
  eq(swap.valueAtRiskMicrounits, 5_000_000n);
  eq(typeof swap.valueAtRiskMicrounits, "bigint", "stays BigInt");
  assert(swap.warnings.some((w) => w.includes("5000000")), "warns value at risk");
  // missing value defaults to 0n at-risk, not undefined behavior
  const noVal = simulateAction({ actionType: "token.swap" });
  eq(noVal.valueAtRiskMicrounits, 0n);
});

test("edge: read-only is reversible/no-blast; shell.exec is unbounded", () => {
  const read = simulateAction({ actionType: "file.read" });
  eq(read.reversible, true);
  eq(read.blastRadius, "none");
  eq(read.requiresBackup, false);
  eq(read.warnings.length, 0, "no warnings for a safe read");

  const shell = simulateAction({ actionType: "shell.exec" });
  eq(shell.blastRadius, "unbounded");
  assert(shell.warnings.some((w) => w.includes("unbounded")), "warns unbounded");
  assert(!shell.reversible, "shell.exec irreversible");
});

test("fail-closed: unknown action → worst-case; bad input throws", () => {
  const unknown = simulateAction({ actionType: "totally.made.up.action" });
  eq(unknown.reversible, false, "unknown → irreversible");
  eq(unknown.blastRadius, "unknown");
  eq(unknown.riskSource, "fail_closed_default");
  assert(unknown.warnings.some((w) => w.includes("unknown action")), "warns unknown");

  for (const bad of [null, undefined, {}, { actionType: "" }, { actionType: 5 }]) {
    let threw = false;
    try { simulateAction(bad as any); } catch { threw = true; }
    assert(threw, `bad input ${JSON.stringify(bad)} throws`);
  }
  // non-bigint value throws
  let t = false;
  try { simulateAction({ actionType: "token.swap", valueMicrounits: 5 as any }); } catch { t = true; }
  assert(t, "number value throws (must be BigInt)");
});

test("deterministic: same input + clock → identical result", () => {
  const now = "2026-06-15T00:00:00.000Z";
  const a = simulateAction({ actionType: "db.migration" }, now);
  const b = simulateAction({ actionType: "db.migration" }, now);
  eq(JSON.stringify(a), JSON.stringify(b), "pure & deterministic");
});
