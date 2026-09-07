import "../_flush.mjs";
/**
 * tests/potential/action-types.test.ts
 *
 * Unit tests for POTENTIAL_ACTION_TYPES constant and its integration with
 * defaultPolicies() in src/composition.ts.
 *
 * Verifies (v47):
 *   1. POTENTIAL_ACTION_TYPES is exported with correct string values.
 *   2. defaultPolicies() allows potential.analyze + potential.route (no longer fail-closed).
 *   3. Unknown action types are still denied (fail-closed remains correct for truly unknown actions).
 *   4. LEDGER_ACTION_TYPES still allowed (backward compat).
 *   5. PotentialEngine.analyze() succeeds through the sovereign stack (policy integration).
 */

import { test, eq, assert } from "../_harness.mjs";
import { POTENTIAL_ACTION_TYPES } from "../../lib/potential/types.ts";
import { LEDGER_ACTION_TYPES } from "../../lib/ledger-orchestrator/types.ts";
import { MARKETPLACE_ACTION_TYPES } from "../../lib/marketplace/types.ts";
import { defaultPolicies, buildSovereignStack } from "../../src/composition.ts";
import { compilePolicies } from "../../lib/policy/index.ts";
import { PotentialEngine } from "../../lib/potential/potential-engine.ts";
import { TfaOrchestrator } from "../../lib/orchestrator/orchestrator.ts";

// ─── POTENTIAL_ACTION_TYPES constant ─────────────────────────────────────────

test("POTENTIAL_ACTION_TYPES: ANALYZE is 'potential.analyze'", () => {
  eq(POTENTIAL_ACTION_TYPES.ANALYZE, "potential.analyze");
});

test("POTENTIAL_ACTION_TYPES: ROUTE is 'potential.route'", () => {
  eq(POTENTIAL_ACTION_TYPES.ROUTE, "potential.route");
});

test("POTENTIAL_ACTION_TYPES: has exactly 5 entries", () => {
  eq(Object.keys(POTENTIAL_ACTION_TYPES).length, 5);
});

test("POTENTIAL_ACTION_TYPES: values are distinct strings", () => {
  const vals = Object.values(POTENTIAL_ACTION_TYPES);
  eq(new Set(vals).size, vals.length, "no duplicates");
  for (const v of vals) {
    assert(typeof v === "string" && v.startsWith("potential."), `'${v}' has 'potential.' prefix`);
  }
});

// ─── defaultPolicies() includes POTENTIAL_ACTION_TYPES ───────────────────────

test("defaultPolicies: potential.analyze is in allowlist (guard allows)", async () => {
  // PotentialEngine(policies, auditStore?) — auditStore optional (defaults to InMemory)
  const engine = new PotentialEngine(compilePolicies(defaultPolicies()));
  const result = await engine.analyze({
    userId: "u-test-1",
    tenantId: "t-actiontype-1",
    knowledgeSignals: [],
    analyticsSignals: [],
  });
  eq(result.ok, true, "analyze succeeds — policy allows potential.analyze");
});

test("defaultPolicies: potential.route allowed when opportunities provided", async () => {
  const engine = new PotentialEngine(compilePolicies(defaultPolicies()));
  // potential.route should also be allowed by defaultPolicies
  const routeResult = await engine.route({
    userId: "u-test-route",
    tenantId: "t-route-test",
    knowledgeSignals: [],
    analyticsSignals: [],
    opportunities: [],
  });
  eq(routeResult.ok, true, "route succeeds — policy allows potential.route");
});

test("defaultPolicies: unknown action type still denied (fail-closed preserved)", async () => {
  const compiled = compilePolicies(defaultPolicies());
  // Simulate guard check for a completely unknown action
  const orchResult = await new TfaOrchestrator(compiled).run(
    {
      id: "test-unknown",
      tenantId: "t-unknown",
      type: "completely.unknown.action",
      payload: {},
      source: "test",
      isFinancial: false,
      isAutonomous: true,
      requestedAt: new Date().toISOString(),
    },
    async () => "should not reach",
  );
  eq(orchResult.ok, false, "unknown action type is denied");
  assert(
    typeof orchResult.reason === "string" && orchResult.reason.length > 0,
    "reason provided",
  );
});

test("defaultPolicies: all LEDGER_ACTION_TYPES still allowed (backward compat)", () => {
  const policies = defaultPolicies();
  const allowlistPolicy = policies.find(p => p.name === "ledger-allowlist");
  assert(allowlistPolicy !== undefined, "ledger-allowlist policy exists");

  // The allowlist rule should include all ledger action types
  const knownInRule = allowlistPolicy!.rules[0]?.if?.actionTypeNotIn as string[] | undefined;
  assert(Array.isArray(knownInRule), "actionTypeNotIn is an array");

  for (const ledgerType of Object.values(LEDGER_ACTION_TYPES)) {
    assert(
      knownInRule!.includes(ledgerType),
      `LEDGER_ACTION_TYPES.${ledgerType} is in allowlist`,
    );
  }
  for (const potentialType of Object.values(POTENTIAL_ACTION_TYPES)) {
    assert(
      knownInRule!.includes(potentialType),
      `POTENTIAL_ACTION_TYPES.${potentialType} is in allowlist`,
    );
  }
});

test("defaultPolicies: allowlist covers all known action types (ledger + potential + marketplace)", () => {
  const policies = defaultPolicies();
  const rule = policies.find(p => p.name === "ledger-allowlist")!.rules[0];
  const known = rule.if?.actionTypeNotIn as string[];
  const expectedCount =
    Object.keys(LEDGER_ACTION_TYPES).length +
    Object.keys(POTENTIAL_ACTION_TYPES).length +
    Object.keys(MARKETPLACE_ACTION_TYPES).length;
  eq(known.length, expectedCount, `allowlist covers exactly ${expectedCount} action types (ledger + potential + marketplace)`);
});
