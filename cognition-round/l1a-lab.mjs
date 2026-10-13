/* L-1a adversarial lab — offline, isolated. The module under test is a COPY at
 * /tmp/l1a-lab/adaptations.mjs which derives its own state dir (/tmp/l1a-lab/state) —
 * the live engine's state file is NEVER touched by this script. */
import { verifyStateIntegrity, resolveAdaptedRoleFrom, planAdaptations, adaptationState, noteAdaptationOutcome, ADAPT_LIMITS } from "/tmp/l1a-lab/adaptations.mjs";
import * as fs from "node:fs";
import * as crypto from "node:crypto";

const LAB = "/tmp/l1a-lab/state/adaptations.json";
const R = (label, v) => console.log(label, "=>", JSON.stringify(v));
const seal = (payload) => crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
const put = (doc) => fs.writeFileSync(LAB, JSON.stringify(doc));

/* E1 · tamper: hostile edit WITHOUT resealing (the corrupt-state claim) */
const live = JSON.parse(fs.readFileSync(LAB, "utf8"));
const tampered = JSON.parse(JSON.stringify(live));
tampered.payload.adaptations[0].toRole = "owner";
put(tampered);
R("E1 verifyStateIntegrity(tampered)", verifyStateIntegrity(tampered)); // false
R("E1 adaptationState().intact", adaptationState().intact); // false
R("E1 resolve via empty payload", resolveAdaptedRoleFrom(adaptationState().payload, "claim_reward_balance", "active")); // baseRole

/* E2 · deleted file */
fs.rmSync(LAB);
R("E2 deleted: adaptationState().intact", adaptationState().intact); // false
R("E2 noteOutcome on missing file", noteAdaptationOutcome("claim_reward_balance", { verdict: "ROLE-KEY-ABSENT" })); // false, no throw

/* E3 · VALID-SEAL garbage (only a custom writer can produce these) */
const cases = {
  "adaptations:string": { adaptations: "string", contradictions: [], meta: {} },
  "adaptations:[null]": { adaptations: [null], contradictions: [], meta: {} },
  "toRole:42": { adaptations: [{ op: "claim_reward_balance", state: "ACTIVE", toRole: 42, expiresAt: "2027-01-01T00:00:00.000Z" }], contradictions: [], meta: {} },
  "toRole:owner": { adaptations: [{ op: "claim_reward_balance", state: "ACTIVE", toRole: "owner", expiresAt: "2027-01-01T00:00:00.000Z" }], contradictions: [], meta: {} },
  "expiresAt:garbage": { adaptations: [{ op: "claim_reward_balance", state: "ACTIVE", toRole: "posting", expiresAt: "garbage" }], contradictions: [], meta: {} },
  "state:lowercase": { adaptations: [{ op: "claim_reward_balance", state: "active", toRole: "posting", expiresAt: "2027-01-01T00:00:00.000Z" }], contradictions: [], meta: {} },
  "payload:array": ["not", "an", "object"],
  "payload:int": 42,
};
for (const [k, payload] of Object.entries(cases)) {
  put({ schema: "saos.adaptations.v1", updatedAt: new Date().toISOString(), integrity: seal(payload), payload });
  try {
    const s = adaptationState();
    const out = s.intact ? resolveAdaptedRoleFrom(s.payload, "claim_reward_balance", "active") : "INTEGRITY-FALSE->base";
    R(`E3 ${k}`, out);
  } catch (e) { R(`E3 ${k}`, "THROWS: " + String(e?.message ?? e).slice(0, 70)); }
}

/* E4 · noteAdaptationOutcome neutralizing a sealed poison-owner entry */
const poisonActive = { adaptations: [{ id: "x", op: "claim_reward_balance", kind: "signing-role", state: "ACTIVE", toRole: "owner", fromRole: "active", createdAt: "2026-10-05T00:00:00.000Z", expiresAt: "2027-01-01T00:00:00.000Z" }], contradictions: [], meta: {} };
put({ schema: "saos.adaptations.v1", integrity: seal(poisonActive), payload: poisonActive });
R("E4 noteOutcome (retire sealed owner-ACTIVE)", noteAdaptationOutcome("claim_reward_balance", { verdict: "ROLE-KEY-ABSENT" }));
R("E4 after", JSON.parse(fs.readFileSync(LAB, "utf8")).payload.adaptations.map((a) => `${a.id}:${a.state}`));

/* E6 · owner-escalation attempt through the PLANNER (the only legit writer) */
const NOW = "2026-10-05T16:00:00.000Z";
const ownFail = (at) => ({ at, ok: false, txid: "o" + at.slice(18, 20), ops: ["claim_reward_balance"], error: "missing required owner authority:Missing Owner Authority headcorner" });
const okCurateLegacy = { at: "2026-10-05T15:00:00.000Z", ok: true, txid: "v1", tag: "curate", ops: ["vote"] };
const pOwner = planAdaptations(null, [ownFail("2026-10-05T15:30:00.000Z"), ownFail("2026-10-05T15:40:00.000Z"), okCurateLegacy], NOW);
R("E6 owner-demand summary", pOwner.summary);
R("E6 records", pOwner.nextState.payload.adaptations.map((a) => ({ id: a.id, state: a.state, toRole: a.toRole })));
R("E6 resolve ignores DECLINED", resolveAdaptedRoleFrom(pOwner.nextState.payload, "claim_reward_balance", "active", NOW));

/* E7 · supersede-to-owner attack on an ACTIVE posting adaptation */
const activePosting = { adaptations: [{ id: "adapt-claim_reward_balance-posting", op: "claim_reward_balance", kind: "signing-role", state: "ACTIVE", fromRole: "active", toRole: "posting", attempts: 0, maxAttempts: 3, createdAt: "2026-10-05T15:01:50.115Z", expiresAt: "2026-10-07T15:01:50.115Z", evidence: [], hypothesis: "h", expected: "e", confidence: 0.8, authorityImpact: "none" }], contradictions: [], meta: { evalCount: 1 } };
const failUnderPosting = (at, err) => ({ at, ok: false, txid: "p" + at.slice(18, 20), role: "posting", ops: ["claim_reward_balance"], error: err });
const pSup = planAdaptations({ payload: activePosting }, [failUnderPosting("2026-10-05T15:50:00.000Z", "missing required owner authority:Missing Owner Authority headcorner")], "2026-10-05T15:55:00.000Z");
R("E7 owner-demand-on-retry", pSup.nextState.payload.adaptations.map((a) => ({ state: a.state, toRole: a.toRole })));

/* E5 · fabricated legacy rows -> transfer mapped to posting (worst realistic poison) */
const xferFail = (at) => ({ at, ok: false, txid: "t" + at.slice(18, 20), tag: "cycle-execute", ops: ["transfer"], error: "missing required posting authority:Missing Posting Authority headcorner" });
const pXfer = planAdaptations(null, [xferFail("2026-10-05T15:30:00.000Z"), xferFail("2026-10-05T15:40:00.000Z"), okCurateLegacy], NOW);
R("E5 fabricated-transfer-adapt", pXfer.summary.active);

/* E7b · legal supersede: posting->active demand on retry (allowed target) */
const pSup2 = planAdaptations({ payload: activePosting }, [failUnderPosting("2026-10-05T15:50:00.000Z", "missing required active authority:Missing Active Authority headcorner")], "2026-10-05T15:55:00.000Z");
R("E7b legal-supersede", pSup2.nextState.payload.adaptations.map((a) => ({ state: a.state, toRole: a.toRole })));

/* E8 · TTL + VERIFIED forever */
R("E8 expired-ACTIVE(+2d)", resolveAdaptedRoleFrom(activePosting, "claim_reward_balance", "active", "2026-10-09T00:00:00.000Z"));
const verified = JSON.parse(JSON.stringify(activePosting)); verified.adaptations[0].state = "VERIFIED";
R("E8 VERIFIED(+1y)", resolveAdaptedRoleFrom(verified, "claim_reward_balance", "active", "2027-10-05T00:00:00.000Z"));

/* E9 · THE LANDMINE: VERIFIED adaptation + key no longer held */
put({ schema: "saos.adaptations.v1", integrity: seal(verified), payload: verified });
R("E9 noteOutcome on VERIFIED", noteAdaptationOutcome("claim_reward_balance", { verdict: "ROLE-KEY-ABSENT" }));
const after9 = JSON.parse(fs.readFileSync(LAB, "utf8"));
R("E9 state-after", after9.payload.adaptations.map((a) => `${a.id}:${a.state}`));
R("E9 resolve still returns learned role", resolveAdaptedRoleFrom(after9.payload, "claim_reward_balance", "active"));
console.log("LIMITS", JSON.stringify(ADAPT_LIMITS));
