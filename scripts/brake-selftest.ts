#!/usr/bin/env bun
// ─────────────────────────────────────────────────────────────────────
// BRAKE-SELFTEST — וקטורי-הבלם-הריבוני (R30 · trace 1a10d6f880df9255)
//
// בדיקה-התנהגותית של שפת-החתימה ב-fixtures מבודדים — אפס-רשת, אפס-סודות,
// אפס-פעולות-הון. הבלם נשאל: האם נתיב-חתימה רשאי להמשיך? — וכל-וקטור
// מוכיח תשובה אחת בכנות. fail-closed הוא החוק: כל-כישלון-קריאה = עצירה.
//
// ריצה: bun scripts/brake-selftest.mjs → exit 0 = הכל-ירוק
// ─────────────────────────────────────────────────────────────────────

import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluateBrake, laneOf } from "../src/lib/cognition/brake";

let pass = 0, fail = 0;
const failures: Array<{ name: string; error: string }> = [];
function vec(name: string, fn: () => void) {
  try { fn(); pass++; console.log(`  PASS  ${name}`); }
  catch (e) { fail++; failures.push({ name, error: String((e as Error)?.message ?? e) }); console.log(`  FAIL  ${name} → ${String((e as Error)?.message ?? e).slice(0, 200)}`); }
}
function assert(cond: unknown, msg: string) { if (!cond) throw new Error(msg); }

function fixture(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "brake-vec-"));
  for (const [rel, content] of Object.entries(files)) {
    const p = join(dir, rel);
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, content);
  }
  return dir;
}
function withDir<T>(dir: string, fn: () => T): T {
  const prev = process.env.SAOS_COGNITION_DIR;
  process.env.SAOS_COGNITION_DIR = dir;
  try { return fn(); } finally { if (prev === undefined) delete process.env.SAOS_COGNITION_DIR; else process.env.SAOS_COGNITION_DIR = prev; }
}
const GUARD = (lane: string, id = "bg-test") => JSON.stringify({
  protocol: "SAOS-LANE-GUARDS/1",
  guards: [{ id, lane, closed: true, reason: "selftest vector", openedAt: "2026-10-05T00:00:00Z", expiresAt: "2099-01-01T00:00:00Z" }],
});
const STASIS_STAGED = JSON.stringify({ protocol: "SAOS-FATE-DEFENSE-STASIS/1", active: true, mode: "staged", stagedLanes: { allow: ["grid", "claims"] } });
const STASIS_FULL = JSON.stringify({ protocol: "SAOS-FATE-DEFENSE-STASIS/1", active: true, mode: "full", reason: "selftest full halt" });

console.log("═══ brake-selftest — sovereign brake vectors (isolated fixtures, no network) ═══");

vec("V1 absent guards + absent STASIS → ALLOW with flags (neutral, honest)", () => {
  const dir = fixture({});
  withDir(dir, () => {
    const v = evaluateBrake("money-mover");
    assert(v.halt === false, `expected ALLOW, got halt with ${v.reasons.join(";")}`);
    assert(v.guardsAbsent === true && v.stasisAbsent === true, "absence flags must be recorded");
  });
});

vec("V2 grid guard closed → HALT money-mover (the 17:07:36Z writer class)", () => {
  const dir = fixture({ "sovereign/cognition/lane-guards.json": GUARD("grid") });
  withDir(dir, () => {
    const v = evaluateBrake("money-mover");
    assert(v.halt === true, "grid guard must halt the money mover");
    assert(v.reasons.some((r) => r.includes("LANE-GUARD-HALT grid")), "reason must name the guard lane");
  });
});

vec("V3 grid guard closed → HALT market-maker + money-hive (all grid edges)", () => {
  const dir = fixture({ "sovereign/cognition/lane-guards.json": GUARD("grid") });
  withDir(dir, () => {
    for (const tool of ["market-maker", "money-hive"]) {
      const v = evaluateBrake(tool);
      assert(v.halt === true, `${tool} must halt under grid guard`);
    }
  });
});

vec("V4 claims guard closed → HALT money-claim only", () => {
  const dir = fixture({ "sovereign/cognition/lane-guards.json": GUARD("claims") });
  withDir(dir, () => {
    assert(evaluateBrake("money-claim").halt === true, "claims guard must halt claim route");
    assert(evaluateBrake("money-mover").halt === false, "claims guard must NOT halt grid tools");
  });
});

vec("V5 corrupt guards JSON → fail-closed HALT on every lane", () => {
  const dir = fixture({ "sovereign/cognition/lane-guards.json": "{not json" });
  withDir(dir, () => {
    for (const tool of ["money-mover", "money-claim", "market-maker", "money-hive", "unknown-tool"]) {
      const v = evaluateBrake(tool);
      assert(v.halt === true, `${tool} must fail-closed on corrupt guards`);
    }
  });
});

vec("V6 foreign guards protocol → fail-closed HALT", () => {
  const dir = fixture({ "sovereign/cognition/lane-guards.json": JSON.stringify({ protocol: "SOMEONE-ELSES/9", guards: [] }) });
  withDir(dir, () => {
    const v = evaluateBrake("money-mover");
    assert(v.halt === true, "foreign protocol must fail-closed");
    assert(v.reasons.some((r) => r.includes("unknown guards protocol")), "reason must name the protocol violation");
  });
});

vec("V7 foreign fields (closed:false/open/allow) → ignored + reported, never opening", () => {
  const hostile = JSON.stringify({
    protocol: "SAOS-LANE-GUARDS/1",
    guards: [
      { id: "fake-open", lane: "grid", closed: false, reason: "attacker says open" },
      { id: "fake-allow", lane: "grid", allow: true, open: true },
      { id: "real-closed", lane: "grid", closed: true, reason: "real guard" },
    ],
  });
  const dir = fixture({ "sovereign/cognition/lane-guards.json": hostile });
  withDir(dir, () => {
    const v = evaluateBrake("money-mover");
    assert(v.halt === true, "closed:true guard must still halt despite foreign open fields");
    assert(v.foreignFields.includes("fake-open") && v.foreignFields.includes("fake-allow"), "foreign fields must be reported");
  });
});

vec("V8 expired guard → inert (ALLOW)", () => {
  const expired = JSON.stringify({ protocol: "SAOS-LANE-GUARDS/1", guards: [{ id: "bg-old", lane: "grid", closed: true, reason: "old", expiresAt: "2020-01-01T00:00:00Z" }] });
  const dir = fixture({ "sovereign/cognition/lane-guards.json": expired });
  withDir(dir, () => { assert(evaluateBrake("money-mover").halt === false, "expired guard must be inert"); });
});

vec("V9 STASIS full active → HALT every lane", () => {
  const dir = fixture({ "sovereign/cognition/STASIS.json": STASIS_FULL });
  withDir(dir, () => {
    for (const tool of ["money-mover", "money-claim", "market-maker", "money-hive"]) {
      assert(evaluateBrake(tool).halt === true, `${tool} must halt under full STASIS`);
    }
  });
});

vec("V10 STASIS staged allow=[grid,claims] → grid/claims ALLOW, general HALT", () => {
  const dir = fixture({ "sovereign/cognition/STASIS.json": STASIS_STAGED });
  withDir(dir, () => {
    assert(evaluateBrake("money-mover").halt === false, "grid must be staged-allowed");
    assert(evaluateBrake("money-claim").halt === false, "claims must be staged-allowed");
    assert(evaluateBrake("unknown-tool").halt === true, "general (unknown tool) must halt under staged");
    const v = evaluateBrake("unknown-tool");
    assert(v.reasons.some((r) => r.includes("STASIS-STAGED-HALT")), "reason must name staged lane law");
  });
});

vec("V11 STASIS corrupt → fail-closed HALT", () => {
  const dir = fixture({ "sovereign/cognition/STASIS.json": "]]]broken" });
  withDir(dir, () => { assert(evaluateBrake("money-mover").halt === true, "corrupt STASIS must fail-closed"); });
});

vec("V12 STASIS foreign protocol → fail-closed HALT", () => {
  const dir = fixture({ "sovereign/cognition/STASIS.json": JSON.stringify({ protocol: "NOT-THE-LAW/1", active: false }) });
  withDir(dir, () => { assert(evaluateBrake("money-mover").halt === true, "foreign STASIS protocol must fail-closed"); });
});

vec("V13 laneOf unknown tool → general (fail-closed mapping)", () => {
  assert(laneOf("mystery-signer") === "general", "unknown tool must map to general");
  assert(laneOf("money-mover") === "grid", "money-mover must map to grid");
  assert(laneOf("money-claim") === "claims", "money-claim must map to claims");
  // R30b — Adversary-A census fix: every transfer rail maps to general (never staged-open)
  for (const t of ["sol-send", "eth-send", "exchange-withdraw", "exchange-non-graphene-send"]) {
    assert(laneOf(t) === "general", `${t} must map to general (transfers are never a staged lane)`);
  }
});

vec("V14 guard + staged STASIS combined → guard halts a staged-allowed lane (two layers, most restrictive wins)", () => {
  const dir = fixture({ "sovereign/cognition/STASIS.json": STASIS_STAGED, "sovereign/cognition/lane-guards.json": GUARD("grid") });
  withDir(dir, () => {
    const v = evaluateBrake("money-mover");
    assert(v.halt === true, "guard must close a lane that staged STASIS allows");
    assert(v.reasons.some((r) => r.includes("LANE-GUARD-HALT grid")), "reason must name the guard");
  });
});

vec("V15 guards note synced from beat with close-only note → consumed normally", () => {
  const beatSynced = JSON.stringify({
    protocol: "SAOS-LANE-GUARDS/1",
    guards: [{ id: "bg-8d5760757b", lane: "grid", closed: true, reason: "reasons=unknown-writer ttl=12h (beat cycle 5)", openedAt: "2026-10-05T18:39:03Z", expiresAt: "2099-01-01T00:00:00Z" }],
    note: "synced from steem cognition-beat cycle #5 (trace 1a10c90522120149) — guards close-only; consumers: steem capital_gate.cjs · Domain capital-gate.cjs · saos-dex brake.mjs · Zip brake.ts",
  });
  const dir = fixture({ "sovereign/cognition/lane-guards.json": beatSynced });
  withDir(dir, () => {
    const v = evaluateBrake("money-mover");
    assert(v.halt === true, "beat-synced grid guard must halt the money mover (the real propagation vector)");
    assert(String(v.reasons.join(";")).includes("bg-8d5760757b"), "reason must carry the real guard id");
  });
});

console.log(`\n═══ ${pass} passed, ${fail} failed ═══`);
if (failures.length) {
  console.log("failures:", JSON.stringify(failures, null, 1));
  process.exit(1);
}
console.log("ALL GREEN — the brake answers at the signing edge, fail-closed, close-only.");
