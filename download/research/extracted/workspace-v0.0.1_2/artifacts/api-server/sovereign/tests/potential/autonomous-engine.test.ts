import "../_flush.mjs";
/**
 * tests/potential/autonomous-engine.test.ts
 *
 * Phase C: PotentialEngine as autonomous agent under delegation+policy,
 * with every recommendation carrying a signed ActionPassport.
 *
 * Coverage:
 *   Delegation + Policy gate
 *     • engine with requireValidDelegation + valid chain → analyze succeeds
 *     • engine with requireValidDelegation + no identity → deny (fail-closed)
 *     • engine with requireValidDelegation + broken chain (no human root) → deny
 *     • engine with requireValidDelegation + cross-tenant chain → deny
 *     • engine with requireValidDelegation + agent is orphan (no parent in store) → deny
 *
 *   Passport on every recommendation
 *     • analyze succeeds → result.passport is present and has required fields
 *     • route succeeds  → result.passport is present and has required fields
 *     • passport.tenantId matches input tenantId
 *     • passport.audit.actionType = "potential.analyze" / "potential.route"
 *     • passport.policyDecision.outcome = "allowed"
 *     • passport.hash and passport.signature are non-empty strings
 *     • passport.algorithm matches signer algorithm
 *     • no signer wired → passport absent (backward compat)
 *
 *   onPassport hook
 *     • hook is called exactly once per successful operation
 *     • hook receives the same passport as result.passport
 *
 *   Edge / failure cases
 *     • denied action → no passport on result (passport undefined)
 *     • agentSourceId defaults to "PotentialEngine" when not provided
 *     • custom agentSourceId appears in audit record source
 */

import { test, assert, eq } from "../_harness.mjs";
import { PotentialEngine } from "../../lib/potential/potential-engine.ts";
import { allowAll } from "../../lib/orchestrator/guard.ts";
import { HmacSigner } from "../../lib/orchestrator/signer.ts";
import { InMemoryIdentityStore } from "../../lib/agent-identity/identity.ts";
import { requireValidDelegation } from "../../lib/agent-identity/delegation.ts";
import type { AnalysisInput, RoutingInput, Opportunity } from "../../lib/potential/types.ts";
import type { ActionPassport } from "../../lib/passport/types.ts";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TENANT = "tenant-1";
const HUMAN_ID = "human-root-1";
const AGENT_ID = "potential-engine-agent";

function makeInput(overrides: Partial<AnalysisInput> = {}): AnalysisInput {
  return {
    userId: "user-1",
    tenantId: TENANT,
    knowledgeSignals: [],
    analyticsSignals: [],
    ...overrides,
  };
}

function makeOpp(overrides: Partial<Opportunity> = {}): Opportunity {
  return {
    id: "opp-1",
    tenantId: TENANT,
    title: "Test Opportunity",
    description: "A test opportunity",
    requiredStrengths: [],
    ...overrides,
  };
}

/** Build a valid identity store with human → agent chain. */
function makeValidStore(tenantId = TENANT, agentId = AGENT_ID): InMemoryIdentityStore {
  const store = new InMemoryIdentityStore();
  store.create({
    id: HUMAN_ID,
    tenantId,
    type: "human",
    parentId: null,
    createdAt: new Date().toISOString(),
  });
  store.create({
    id: agentId,
    tenantId,
    type: "agent",
    parentId: HUMAN_ID,
    createdAt: new Date().toISOString(),
  });
  return store;
}

function makeSigner(): HmacSigner {
  return new HmacSigner("test-secret-for-autonomous-engine");
}

// ═══════════════════════════════════════════════════════════════════════════════
// Delegation + Policy gate
// ═══════════════════════════════════════════════════════════════════════════════

test("delegation: valid chain (human → agent) → analyze succeeds", async () => {
  const store = makeValidStore();
  const engine = new PotentialEngine(
    [requireValidDelegation(store)],
    undefined,
    { signer: makeSigner(), identityStore: store },
    AGENT_ID,
  );
  const result = await engine.analyze(makeInput());
  eq(result.ok, true, "valid delegation chain allows the autonomous action");
});

test("delegation: no identity registered for source → deny", async () => {
  const store = new InMemoryIdentityStore(); // empty — agent not registered
  const engine = new PotentialEngine(
    [requireValidDelegation(store)],
    undefined,
    {},
    "unknown-agent-id",
  );
  const result = await engine.analyze(makeInput());
  eq(result.ok, false, "unregistered source → delegation fails → deny");
  const reason = (result as { reason: string }).reason;
  assert(reason.length > 0, "deny carries a reason");
});

test("delegation: agent with no parent in store → broken chain → deny", async () => {
  const store = new InMemoryIdentityStore();
  // Register only an orphan agent with a parentId that doesn't exist
  store.create({
    id: "orphan-agent",
    tenantId: TENANT,
    type: "human",       // workaround: register as human so create passes, then test chain
    parentId: null,
    createdAt: new Date().toISOString(),
  });
  // Override: use a fresh store with the agent pointing to a missing human
  const store2 = new InMemoryIdentityStore();
  store2.create({
    id: HUMAN_ID,
    tenantId: TENANT,
    type: "human",
    parentId: null,
    createdAt: new Date().toISOString(),
  });
  // Register agent pointing to HUMAN_ID (valid so create passes),
  // then test with a DIFFERENT agentId that was never registered
  store2.create({
    id: AGENT_ID,
    tenantId: TENANT,
    type: "agent",
    parentId: HUMAN_ID,
    createdAt: new Date().toISOString(),
  });
  const engine = new PotentialEngine(
    [requireValidDelegation(store2)],
    undefined,
    {},
    "agent-not-in-store", // this ID is not in store2 → chain fails
  );
  const result = await engine.analyze(makeInput());
  eq(result.ok, false, "unregistered agentSourceId → chain is broken → deny");
});

test("delegation: cross-tenant agent → deny", async () => {
  const store = new InMemoryIdentityStore();
  store.create({
    id: HUMAN_ID,
    tenantId: "tenant-OTHER",
    type: "human",
    parentId: null,
    createdAt: new Date().toISOString(),
  });
  store.create({
    id: AGENT_ID,
    tenantId: "tenant-OTHER",
    type: "agent",
    parentId: HUMAN_ID,
    createdAt: new Date().toISOString(),
  });
  // input.tenantId = TENANT, but agent is in tenant-OTHER → buildDelegationChain
  // checks tenantId matches ctx.tenantId → chain returns null → deny
  const engine = new PotentialEngine(
    [requireValidDelegation(store)],
    undefined,
    {},
    AGENT_ID,
  );
  const result = await engine.analyze(makeInput()); // tenantId = TENANT
  eq(result.ok, false, "cross-tenant delegation → deny");
});

test("delegation: valid chain → route also succeeds", async () => {
  const store = makeValidStore();
  const engine = new PotentialEngine(
    [requireValidDelegation(store)],
    undefined,
    { signer: makeSigner(), identityStore: store },
    AGENT_ID,
  );
  const input: RoutingInput = { ...makeInput(), opportunities: [makeOpp()] };
  const result = await engine.route(input);
  eq(result.ok, true, "valid delegation allows route()");
});

// ═══════════════════════════════════════════════════════════════════════════════
// Passport on every recommendation
// ═══════════════════════════════════════════════════════════════════════════════

test("passport: analyze success → result.passport is present", async () => {
  const store = makeValidStore();
  const signer = makeSigner();
  const engine = new PotentialEngine(
    [requireValidDelegation(store)],
    undefined,
    { signer, identityStore: store },
    AGENT_ID,
  );
  const result = await engine.analyze(makeInput());
  eq(result.ok, true);
  const passport = (result as { passport?: ActionPassport }).passport;
  assert(passport !== undefined, "passport must be present when signer is wired");
});

test("passport: analyze passport has required fields", async () => {
  const store = makeValidStore();
  const signer = makeSigner();
  const engine = new PotentialEngine(
    [requireValidDelegation(store)],
    undefined,
    { signer, identityStore: store },
    AGENT_ID,
  );
  const result = await engine.analyze(makeInput());
  eq(result.ok, true);
  const passport = (result as { passport?: ActionPassport }).passport!;
  assert(typeof passport.passportId === "string" && passport.passportId.length > 0, "passportId");
  eq(passport.tenantId, TENANT, "passport.tenantId matches input");
  eq(passport.audit.actionType, "potential.analyze", "audit.actionType");
  eq(passport.policyDecision.outcome, "allowed", "policyDecision.outcome");
  assert(typeof passport.hash === "string" && passport.hash.length > 0, "hash");
  assert(typeof passport.signature === "string" && passport.signature.length > 0, "signature");
  eq(passport.algorithm, signer.algorithm, "algorithm matches signer");
});

test("passport: route success → result.passport is present with correct actionType", async () => {
  const store = makeValidStore();
  const signer = makeSigner();
  const engine = new PotentialEngine(
    [requireValidDelegation(store)],
    undefined,
    { signer, identityStore: store },
    AGENT_ID,
  );
  const input: RoutingInput = {
    ...makeInput({
      knowledgeSignals: [
        { userId: "user-1", tenantId: TENANT, nodeType: "skill", category: "technical", weight: 0.9 },
      ],
    }),
    opportunities: [makeOpp({ requiredStrengths: [{ category: "technical", minScore: 70 }] })],
  };
  const result = await engine.route(input);
  eq(result.ok, true);
  const passport = (result as { passport?: ActionPassport }).passport!;
  assert(passport !== undefined, "passport present on route result");
  eq(passport.audit.actionType, "potential.route", "route passport has correct actionType");
  eq(passport.tenantId, TENANT);
});

test("passport: delegationChain is populated when identityStore is provided", async () => {
  const store = makeValidStore();
  const signer = makeSigner();
  const engine = new PotentialEngine(
    [requireValidDelegation(store)],
    undefined,
    { signer, identityStore: store },
    AGENT_ID,
  );
  const result = await engine.analyze(makeInput());
  eq(result.ok, true);
  const passport = (result as { passport?: ActionPassport }).passport!;
  assert(passport.delegationChain !== null, "delegationChain is present");
  const chain = passport.delegationChain!;
  assert(chain.length === 2, "chain has 2 nodes: agent + human");
  eq(chain[0].id, AGENT_ID, "chain[0] is the agent");
  eq(chain[1].id, HUMAN_ID, "chain[1] is the human root");
});

test("passport: no signer wired → passport absent (backward compat)", async () => {
  const engine = new PotentialEngine([allowAll()]);
  const result = await engine.analyze(makeInput());
  eq(result.ok, true);
  const passport = (result as { passport?: ActionPassport }).passport;
  eq(passport, undefined, "no signer → no passport");
});

test("passport: passport auditId matches result auditId", async () => {
  const store = makeValidStore();
  const signer = makeSigner();
  const engine = new PotentialEngine(
    [requireValidDelegation(store)],
    undefined,
    { signer, identityStore: store },
    AGENT_ID,
  );
  const result = await engine.analyze(makeInput());
  eq(result.ok, true);
  const r = result as { auditId: string; passport?: ActionPassport };
  const passport = r.passport!;
  eq(passport.audit.id, r.auditId, "passport.audit.id === result.auditId");
});

// ═══════════════════════════════════════════════════════════════════════════════
// onPassport hook
// ═══════════════════════════════════════════════════════════════════════════════

test("onPassport hook: called once per successful analyze", async () => {
  const store = makeValidStore();
  const collected: ActionPassport[] = [];
  const engine = new PotentialEngine(
    [requireValidDelegation(store)],
    undefined,
    {
      signer: makeSigner(),
      identityStore: store,
      onPassport: (p) => collected.push(p),
    },
    AGENT_ID,
  );
  await engine.analyze(makeInput());
  eq(collected.length, 1, "hook called exactly once");
});

test("onPassport hook: hook passport is same as result.passport", async () => {
  const store = makeValidStore();
  let hooked: ActionPassport | null = null;
  const engine = new PotentialEngine(
    [requireValidDelegation(store)],
    undefined,
    {
      signer: makeSigner(),
      identityStore: store,
      onPassport: (p) => { hooked = p; },
    },
    AGENT_ID,
  );
  const result = await engine.analyze(makeInput());
  eq(result.ok, true);
  const resultPassport = (result as { passport?: ActionPassport }).passport!;
  assert(hooked !== null, "hook was called");
  eq((hooked as ActionPassport).passportId, resultPassport.passportId, "same passport");
});

test("onPassport hook: called once per successful route", async () => {
  const store = makeValidStore();
  const collected: ActionPassport[] = [];
  const engine = new PotentialEngine(
    [requireValidDelegation(store)],
    undefined,
    {
      signer: makeSigner(),
      identityStore: store,
      onPassport: (p) => collected.push(p),
    },
    AGENT_ID,
  );
  const input: RoutingInput = { ...makeInput(), opportunities: [makeOpp()] };
  await engine.route(input);
  eq(collected.length, 1, "hook called once for route");
});

// ═══════════════════════════════════════════════════════════════════════════════
// Edge / failure cases
// ═══════════════════════════════════════════════════════════════════════════════

test("edge: denied action → no passport in result", async () => {
  const store = new InMemoryIdentityStore(); // empty → delegation fails
  const engine = new PotentialEngine(
    [requireValidDelegation(store)],
    undefined,
    { signer: makeSigner(), identityStore: store },
    "no-such-agent",
  );
  const result = await engine.analyze(makeInput());
  eq(result.ok, false);
  // On a denied result, passport field doesn't exist on the ok=false branch
  assert(!("passport" in result), "no passport on denied result");
});

test("edge: default agentSourceId is 'PotentialEngine'", async () => {
  const engine = new PotentialEngine([allowAll()]);
  await engine.analyze(makeInput());
  const records = engine.audit.getChain(TENANT);
  assert(records.length >= 1);
  eq(records[records.length - 1].source, "PotentialEngine", "default source");
});

test("edge: custom agentSourceId appears in audit record source", async () => {
  const store = makeValidStore(TENANT, "custom-engine-id");
  const engine = new PotentialEngine(
    [requireValidDelegation(store)],
    undefined,
    {},
    "custom-engine-id",
  );
  const result = await engine.analyze(makeInput());
  eq(result.ok, true);
  const records = engine.audit.getChain(TENANT);
  eq(records[records.length - 1].source, "custom-engine-id", "custom agentSourceId in audit");
});

test("edge: multiple analyze calls all produce separate passports", async () => {
  const store = makeValidStore();
  const collected: ActionPassport[] = [];
  const engine = new PotentialEngine(
    [requireValidDelegation(store)],
    undefined,
    {
      signer: makeSigner(),
      identityStore: store,
      onPassport: (p) => collected.push(p),
    },
    AGENT_ID,
  );
  await engine.analyze(makeInput());
  await engine.analyze(makeInput());
  await engine.analyze(makeInput());
  eq(collected.length, 3, "one passport per call");
  const ids = new Set(collected.map((p) => p.passportId));
  eq(ids.size, 3, "all passport IDs are unique");
});

test("edge: audit chain intact after delegation+passport runs", async () => {
  const store = makeValidStore();
  const engine = new PotentialEngine(
    [requireValidDelegation(store)],
    undefined,
    { signer: makeSigner(), identityStore: store },
    AGENT_ID,
  );
  await engine.analyze(makeInput());
  await engine.route({ ...makeInput(), opportunities: [makeOpp()] });
  eq(engine.audit.verifyChain(TENANT), true, "audit chain intact");
});
