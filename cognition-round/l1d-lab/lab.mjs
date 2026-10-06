/**
 * L-1d durability & noise audit lab — PURE functions only, sandboxed lab dir.
 * Imports engine adaptations.mjs (no import-time side effects, verified by read).
 * NO fs writes, NO network, NO live-state mutation.
 */
import { planAdaptations, verifyStateIntegrity, resolveAdaptedRoleFrom, classifyFailure, ADAPT_LIMITS } from "/home/z/my-project/mini-services/saos-engine/adaptations.mjs";
import * as crypto from "node:crypto";

const seal = (p) => crypto.createHash("sha256").update(JSON.stringify(p)).digest("hex");
const NOW = "2026-10-05T16:00:00.000Z";
const NOW_MS = Date.parse(NOW);
const iso = (ms) => new Date(ms).toISOString();

let pass = 0, fail = 0;
const check = (id, cond, detail) => {
  if (cond) { pass++; console.log(`PASS ${id} :: ${detail}`); }
  else { fail++; console.log(`FAIL ${id} :: ${detail}`); }
};
const row = (at, ok, ops, role, error, txid = null) => ({ at, ok, ops, ...(role ? { role } : {}), ...(error ? { error } : {}), ...(txid ? { txid } : {}) });
const AUTH_ERR = "missing required posting authority:Missing Posting Authority headcorner";
const freshState = (adaptations = [], contradictions = [], meta = {}) => ({ schema: "saos.adaptations.v1", payload: { adaptations, contradictions, meta } });
const okPosting = () => row(iso(NOW_MS - 60_000), true, ["vote"], "posting"); // held-key evidence (a curator-style ok row)

console.log(`# ADAPT_LIMITS maxAttempts=${ADAPT_LIMITS.maxAttempts} ttlMs=${ADAPT_LIMITS.ttlMs} noiseGate=${ADAPT_LIMITS.noiseGate} evidenceWindowMs=${ADAPT_LIMITS.evidenceWindowMs} allowed=${ADAPT_LIMITS.allowedTargetRoles.join("/")}`);

/* ════════ 1 · NOISE IMMUNITY ════════ */

/* N-a: 20 rows, 20 DIFFERENT error strings (all authority-class!) → no adaptation */
{
  const rows = Array.from({ length: 20 }, (_, i) => row(iso(NOW_MS - (i + 1) * 60_000), false, ["claim_reward_balance"], "active", `missing required posting authority:acct-variant-${i}`));
  rows.push(okPosting());
  const p = planAdaptations(null, rows, NOW);
  check("N-a", p.nextState.payload.adaptations.length === 0 && p.events.length === 0,
    `20 unique authority-class errors → ${p.nextState.payload.adaptations.length} adaptations, events=${JSON.stringify(p.events.map(e => e.type))} (noiseGate needs ≥2 identical)`);
}

/* N-b1: ONE identical error → no proposal; N-b2: TWO identical 1-min apart → proposal (designed sensitivity) */
{
  const one = [row(iso(NOW_MS - 60_000), false, ["claim_reward_balance"], "active", AUTH_ERR), okPosting()];
  const p1 = planAdaptations(null, one, NOW);
  check("N-b1", p1.nextState.payload.adaptations.length === 0, `1 identical failure → ${p1.nextState.payload.adaptations.length} adaptations (gate=2 holds)`);

  const two = [row(iso(NOW_MS - 120_000), false, ["claim_reward_balance"], "active", AUTH_ERR), row(iso(NOW_MS - 60_000), false, ["claim_reward_balance"], "active", AUTH_ERR), okPosting()];
  const p2 = planAdaptations(null, two, NOW);
  const a = p2.nextState.payload.adaptations[0];
  check("N-b2", p2.nextState.payload.adaptations.length === 1 && a?.state === "ACTIVE" && a?.toRole === "posting",
    `2 identical 1-min-apart → state=${a?.state} toRole=${a?.toRole} confidence=${a?.confidence} (designed sensitivity)`);
}

/* N-b3: two identical failures but NO held-key evidence → DECLINED (bounded abstention), nothing active */
{
  const two = [row(iso(NOW_MS - 120_000), false, ["claim_reward_balance"], "active", AUTH_ERR), row(iso(NOW_MS - 60_000), false, ["claim_reward_balance"], "active", AUTH_ERR)];
  const p = planAdaptations(null, two, NOW);
  const a = p.nextState.payload.adaptations[0];
  check("N-b3", p.nextState.payload.adaptations.length === 1 && a?.state === "DECLINED",
    `2 identical, no held-key ok row → state=${a?.state} reason="${(a?.declinedReason ?? "").slice(0, 60)}…"`);
}

/* N-c: transient-only storm (10 identical timeouts) → no adaptation */
{
  const rows = Array.from({ length: 10 }, (_, i) => row(iso(NOW_MS - (i + 1) * 60_000), false, ["claim_reward_balance"], "active", "fetch failed: connection timeout after 30000ms"));
  rows.push(okPosting());
  const p = planAdaptations(null, rows, NOW);
  const c = classifyFailure(rows[0].error);
  check("N-c", p.nextState.payload.adaptations.length === 0 && c.deterministic === false,
    `10 identical timeouts → ${p.nextState.payload.adaptations.length} adaptations; classify=${c.type}/deterministic=${c.deterministic}`);
}

/* N-d: window filtering — 30h-old+fresh (both within 36h) propose; 40h-old+fresh does NOT */
{
  const inWindow = [row(iso(NOW_MS - 30 * 3600_000), false, ["claim_reward_balance"], "active", AUTH_ERR), row(iso(NOW_MS - 60_000), false, ["claim_reward_balance"], "active", AUTH_ERR), okPosting()];
  const pIn = planAdaptations(null, inWindow, NOW);
  check("N-d1", pIn.nextState.payload.adaptations.length === 1 && pIn.nextState.payload.adaptations[0].state === "ACTIVE",
    `30h-old + fresh (both ≤36h) → ${pIn.nextState.payload.adaptations.length} adaptation (window does not over-filter)`);

  const decayed = [row(iso(NOW_MS - 40 * 3600_000), false, ["claim_reward_balance"], "active", AUTH_ERR), row(iso(NOW_MS - 60_000), false, ["claim_reward_balance"], "active", AUTH_ERR), okPosting()];
  const pOut = planAdaptations(null, decayed, NOW);
  check("N-d2", pOut.nextState.payload.adaptations.length === 0,
    `40h-old + fresh (1 inside 36h window) → ${pOut.nextState.payload.adaptations.length} adaptations (window filter holds)`);
}

/* N-e: newest group transient, older group eligible → only the eligible one proposes */
{
  const rows = [
    row(iso(NOW_MS - 60_000), false, ["vote"], "active", "fetch failed: connection timeout after 30000ms"),
    row(iso(NOW_MS - 120_000), false, ["vote"], "active", "fetch failed: connection timeout after 30000ms"),
    row(iso(NOW_MS - 10 * 60_000), false, ["claim_reward_balance"], "active", AUTH_ERR),
    row(iso(NOW_MS - 11 * 60_000), false, ["claim_reward_balance"], "active", AUTH_ERR),
    okPosting(),
  ];
  const p = planAdaptations(null, rows, NOW);
  const ids = p.nextState.payload.adaptations.map(a => `${a.op}:${a.state}`);
  check("N-e1", p.nextState.payload.adaptations.length === 1 && p.nextState.payload.adaptations[0].op === "claim_reward_balance" && p.nextState.payload.adaptations[0].state === "ACTIVE",
    `newest=transient(vote), older=authority(claim) → exactly [${ids.join(", ")}]`);

  /* control: TWO eligible groups (different ops) — measure actual semantics */
  const rows2 = [
    row(iso(NOW_MS - 60_000), false, ["claim_reward_balance"], "active", AUTH_ERR),
    row(iso(NOW_MS - 120_000), false, ["claim_reward_balance"], "active", AUTH_ERR),
    row(iso(NOW_MS - 5 * 60_000), false, ["vote"], "active", "missing required posting authority:voting-auth"),
    row(iso(NOW_MS - 6 * 60_000), false, ["vote"], "active", "missing required posting authority:voting-auth"),
    okPosting(),
  ];
  const p2 = planAdaptations(null, rows2, NOW);
  const ids2 = p2.nextState.payload.adaptations.map(a => `${a.op}:${a.state}`);
  console.log(`INFO N-e2 (control) two eligible ops → [${ids2.join(", ")}] — one adaptation PER OP (no per-op spam; loop does not stop after the newest eligible group)`);
}

/* N-f (self-falsification probe): garbage timestamps — at:"banana" must be
 * excluded from the evidence window (NaN math) → no proposal, no throw */
{
  const rows = [
    row("banana", false, ["claim_reward_balance"], "active", AUTH_ERR),
    row("also-not-a-date", false, ["claim_reward_balance"], "active", AUTH_ERR),
    row(iso(NOW_MS - 60_000), false, ["claim_reward_balance"], "active", AUTH_ERR),
    okPosting(),
  ];
  let threw = null, n = -1;
  try { n = planAdaptations(null, rows, NOW).nextState.payload.adaptations.length; } catch (e) { threw = e.message; }
  check("N-f", threw === null && n === 0, `2 garbage-at rows + 1 real → ${n} adaptations, throw=${threw} (NaN evidence fail-closed to no-proposal)`);
}

/* ════════ 2 · DURABILITY MATRIX ════════ */

const goodPayload = {
  adaptations: [{ id: "adapt-claim_reward_balance-posting", op: "claim_reward_balance", kind: "signing-role", state: "ACTIVE", fromRole: "active", toRole: "posting", createdAt: iso(NOW_MS - 3600_000), expiresAt: iso(NOW_MS + 48 * 3600_000), attempts: 0, evidence: [] }],
  contradictions: [], meta: { evalCount: 1 },
};

/* D-a: one-byte flip in payload (valid JSON, wrong hash) */
{
  const tampered = JSON.parse(JSON.stringify(goodPayload));
  tampered.adaptations[0].hypothesis = (tampered.adaptations[0].hypothesis ?? "x") + "TAMPERED";
  const store = { schema: "saos.adaptations.v1", integrity: seal(goodPayload), payload: tampered };
  check("D-a", verifyStateIntegrity(store) === false, `byte-flip payload vs valid-format seal → verifyStateIntegrity=${verifyStateIntegrity(store)}`);
}

/* D-b: VALID seal over poisoned payload (toRole:"owner") → resolver STILL returns baseRole */
{
  const poisoned = JSON.parse(JSON.stringify(goodPayload));
  poisoned.adaptations[0].toRole = "owner";
  const store = { schema: "saos.adaptations.v1", integrity: seal(poisoned), payload: poisoned };
  const integ = verifyStateIntegrity(store);
  const r1 = resolveAdaptedRoleFrom(poisoned, "claim_reward_balance", "active", NOW);
  const poisonedVerified = JSON.parse(JSON.stringify(poisoned)); poisonedVerified.adaptations[0].state = "VERIFIED";
  const r2 = resolveAdaptedRoleFrom(poisonedVerified, "claim_reward_balance", "active", NOW);
  check("D-b", integ === true && r1 === "active" && r2 === "active",
    `valid seal over owner-poison → integrity=${integ}, resolve(ACTIVE)=${r1}, resolve(VERIFIED)=${r2} (F2 guard holds despite valid seal)`);
}

/* D-c: integrity field removed / schema removed / null */
{
  const noIntegrity = { schema: "saos.adaptations.v1", payload: goodPayload };
  const noSchema = { integrity: seal(goodPayload), payload: goodPayload };
  check("D-c", verifyStateIntegrity(noIntegrity) === false && verifyStateIntegrity(noSchema) === false && verifyStateIntegrity(null) === false,
    `no-integrity=${verifyStateIntegrity(noIntegrity)}, no-schema=${verifyStateIntegrity(noSchema)}, null=${verifyStateIntegrity(null)}`);
}

/* D-d: wrong types everywhere → no throw, baseRole */
{
  let threw = null; const results = [];
  const cases = {
    "adaptations-as-string": { adaptations: "garbage" },
    "adaptations-as-number": { adaptations: 42 },
    "entries-as-arrays": { adaptations: [["claim_reward_balance", "posting", "ACTIVE"]] },
    "wrong-field-types": { adaptations: [{ op: 5, kind: ["signing-role"], state: true, toRole: { r: "posting" } }] },
    "payload-as-array": [1, 2, 3],
    "payload-null": null,
    "active-missing-expiresAt": { adaptations: [{ op: "claim_reward_balance", kind: "signing-role", state: "ACTIVE", toRole: "posting" }] },
    "active-expiresAt-past": { adaptations: [{ op: "claim_reward_balance", kind: "signing-role", state: "ACTIVE", toRole: "posting", expiresAt: "2020-01-01T00:00:00.000Z" }] },
  };
  for (const [k, payload] of Object.entries(cases)) {
    try { results.push(`${k}=${resolveAdaptedRoleFrom(payload, "claim_reward_balance", "active", NOW)}`); }
    catch (e) { threw = `${k}: ${e.message}`; break; }
  }
  check("D-d", threw === null && results.every(r => r.endsWith("=active")),
    `no throw across ${results.length} type-poison cases; all → baseRole${threw ? " THREW: " + threw : ""} [${results.join("; ")}]`);
}

/* D-e: Date garbage (expiresAt:"banana") → no throw, baseRole for ACTIVE; VERIFIED ignores TTL by design */
{
  let threw = null;
  let rA = null, rV = null;
  try {
    rA = resolveAdaptedRoleFrom({ adaptations: [{ op: "claim_reward_balance", kind: "signing-role", state: "ACTIVE", toRole: "posting", expiresAt: "banana" }] }, "claim_reward_balance", "active", NOW);
    rV = resolveAdaptedRoleFrom({ adaptations: [{ op: "claim_reward_balance", kind: "signing-role", state: "VERIFIED", toRole: "posting", expiresAt: "banana" }] }, "claim_reward_balance", "active", NOW);
  } catch (e) { threw = e.message; }
  check("D-e", threw === null && rA === "active" && rV === "posting",
    `expiresAt:"banana" → ACTIVE resolves ${rA} (inert, fail-closed), VERIFIED resolves ${rV} (TTL ignored by design — verified knowledge is durable), throw=${threw}`);
}

/* ════════ 3 · REVERSE LESSON + BOUNDED BEHAVIOR ════════ */

/* R-1: supersede posting→active demanded later; then verified under active */
{
  const st = freshState([{ id: "adapt-claim_reward_balance-posting", op: "claim_reward_balance", kind: "signing-role", state: "ACTIVE", fromRole: "active", toRole: "posting", createdAt: iso(NOW_MS - 3600_000), expiresAt: iso(NOW_MS + 48 * 3600_000), attempts: 0, evidence: [] }]);
  const rows = [row(iso(NOW_MS - 60_000), false, ["claim_reward_balance"], "posting", "missing required active authority:headcorner")];
  const p = planAdaptations(st, rows, NOW);
  const a = p.nextState.payload.adaptations[0];
  const evTypes = p.events.map(e => e.type).join(",");
  check("R-1a", a.toRole === "active" && a.state === "ACTIVE" && a.attempts === 1 && evTypes === "adaptation.superseded",
    `chain names ACTIVE on retry → toRole=${a.toRole}, state=${a.state}, attempts=${a.attempts}, events=[${evTypes}]`);

  const rows2 = [row(iso(NOW_MS - 30_000), true, ["claim_reward_balance"], "active", null, "tx123")];
  const p2 = planAdaptations(p.nextState, rows2, NOW);
  const a2 = p2.nextState.payload.adaptations[0];
  check("R-1b", a2.state === "VERIFIED" && a2.verified?.predictionScore?.error === "none",
    `ok broadcast under superseded role → state=${a2.state}, predictionScore.error=${a2.verified?.predictionScore?.error}`);
}

/* R-2: attempts-exhausted after exactly 3 non-deterministic failures under the learned role */
{
  const mk = () => freshState([{ id: "adapt-x-posting", op: "claim_reward_balance", kind: "signing-role", state: "ACTIVE", toRole: "posting", createdAt: iso(NOW_MS - 3600_000), expiresAt: iso(NOW_MS + 48 * 3600_000), attempts: 0, evidence: [] }]);
  const failRows = (n) => Array.from({ length: n }, (_, i) => row(iso(NOW_MS - (i + 1) * 60_000), false, ["claim_reward_balance"], "posting", "RPC returned gibberish 0xZZ"));
  const p2 = planAdaptations(mk(), failRows(2), NOW);
  const p3 = planAdaptations(mk(), failRows(3), NOW);
  const a2 = p2.nextState.payload.adaptations[0], a3 = p3.nextState.payload.adaptations[0];
  check("R-2", a2.state === "ACTIVE" && a3.state === "RETIRED" && a3.retired?.reason === "attempts-exhausted",
    `2 failures → ${a2.state}; 3 failures → ${a3.state} (${a3.retired?.reason}) — bounded exactly at maxAttempts=3`);
}

/* R-3: TTL expiry then fresh-evidence re-proposal */
{
  const stale = freshState([{ id: "adapt-claim_reward_balance-posting", op: "claim_reward_balance", kind: "signing-role", state: "ACTIVE", toRole: "posting", createdAt: iso(NOW_MS - 49 * 3600_000), expiresAt: iso(NOW_MS - 3600_000), attempts: 0, evidence: [] }]);
  const p = planAdaptations(stale, [], NOW);
  const a = p.nextState.payload.adaptations[0];
  check("R-3a", a.state === "RETIRED" && a.retired?.reason === "ttl-unverified",
    `49h-old unverified hypothesis → ${a.state} (${a.retired?.reason}), revisits="${a.retired?.revisits}"`);

  const freshRows = [row(iso(NOW_MS - 120_000), false, ["claim_reward_balance"], "active", AUTH_ERR), row(iso(NOW_MS - 60_000), false, ["claim_reward_balance"], "active", AUTH_ERR), okPosting()];
  const p2 = planAdaptations(p.nextState, freshRows, NOW);
  const list = p2.nextState.payload.adaptations;
  const activeNew = list.find(x => x.state === "ACTIVE");
  check("R-3b", list.length === 2 && activeNew?.state === "ACTIVE" && activeNew?.toRole === "posting",
    `fresh evidence after retire → ${list.length} records (retired kept as history + new ACTIVE toRole=${activeNew?.toRole}); NOTE id reuse: [${list.map(x => x.id).join(", ")}]`);
}

/* R-4: DECLINED → ACTIVE promotion when held-key evidence appears later */
{
  const declined = { id: "adapt-claim_reward_balance-posting", op: "claim_reward_balance", kind: "signing-role", state: "DECLINED", fromRole: "active", toRole: "posting", createdAt: iso(NOW_MS - 7200_000), declinedReason: "no ok broadcast under posting yet", evidence: [] };
  const st = freshState([declined]);
  const rows = [row(iso(NOW_MS - 120_000), false, ["claim_reward_balance"], "active", AUTH_ERR), row(iso(NOW_MS - 60_000), false, ["claim_reward_balance"], "active", AUTH_ERR), okPosting()];
  const p = planAdaptations(st, rows, NOW);
  const list = p.nextState.payload.adaptations;
  const activeNew = list.find(x => x.state === "ACTIVE");
  const r = resolveAdaptedRoleFrom({ adaptations: list }, "claim_reward_balance", "active", NOW);
  check("R-4", list.length === 2 && activeNew?.state === "ACTIVE" && list.some(x => x.state === "DECLINED") && r === "posting",
    `held-key ok row later → DECLINED kept + new ACTIVE(toRole=${activeNew?.toRole}); resolver on resulting payload=${r} (DECLINED ignored, ACTIVE honored)`);
}

/* R-5: idempotency — re-planning with the result state + same rows proposes nothing new */
{
  const rows = [row(iso(NOW_MS - 120_000), false, ["claim_reward_balance"], "active", AUTH_ERR), row(iso(NOW_MS - 60_000), false, ["claim_reward_balance"], "active", AUTH_ERR), okPosting()];
  const p1 = planAdaptations(null, rows, NOW);
  const p2 = planAdaptations(p1.nextState, rows, NOW);
  check("R-5", p1.nextState.payload.adaptations.length === 1 && p2.nextState.payload.adaptations.length === 1 && p2.events.length === 0,
    `eval#1 proposes 1; eval#2 on same evidence → adaptations=${p2.nextState.payload.adaptations.length}, newEvents=${p2.events.length} (no spam across evals)`);
}

console.log(`\n# LAB RESULT pass=${pass} fail=${fail}`);
