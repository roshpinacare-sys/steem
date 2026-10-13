#!/usr/bin/env bun
/**
 * chaos-atomicity.mjs — chaos engineering proof (R235 review)
 * Proof A: SIGKILL a writer mid-loop; OLD-style direct writeFileSync vs NEW tmp+rename.
 *          Expect: old-style file torn in some trials; new-style target NEVER torn
 *          (rename is the single atomic commit point).
 * Proof B: the REAL shipped readPacingState glue (imported from daily.mjs) against
 *          torn/missing state — pacing law must survive via journal rebuild, and
 *          dead-journal must fail closed (block the cycle), never reset the law.
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "fs";
import { spawn } from "child_process";
import path from "path";

const ENGINE = "/home/z/my-project/mini-services/saos-engine";
const WORK = "/tmp/chaos-atomic";
rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });

/* the child writer: both styles alternate, big payload so a kill lands mid-write often */
const CHILD = `${WORK}/writer.mjs`;
writeFileSync(CHILD, `
import { writeFileSync, renameSync } from "fs";
const payload = JSON.stringify({ blob: "x".repeat(2 * 1024 * 1024), done: false });
const oldFile = ${JSON.stringify(WORK + "/old.json")};
const newFile = ${JSON.stringify(WORK + "/new.json")};
let i = 0;
while (true) {
  i++;
  const p = JSON.stringify({ blob: "x".repeat(2 * 1024 * 1024), done: true, i });
  writeFileSync(oldFile, p);                                    // OLD: direct write, torn on kill
  const t = newFile + ".tmp." + process.pid;
  writeFileSync(t, p); renameSync(t, newFile);                   // NEW: rename = atomic commit
}
`);

let tornOld = 0, tornNew = 0, killed = 0;
const TRIALS = 12;
for (let trial = 0; trial < TRIALS; trial++) {
  for (const f of ["old.json", "new.json"]) { try { rmSync(`${WORK}/${f}`, { force: true }); } catch {} }
  const child = spawn("bun", [CHILD], { stdio: "ignore" });
  const delay = 30 + Math.floor(Math.random() * 220); // 30–250ms — deep inside the write loop
  await new Promise((r) => setTimeout(r, delay));
  if (child.exitCode === null) { child.kill("SIGKILL"); killed++; }
  await new Promise((r) => setTimeout(r, 120));
  const check = (f) => {
    try {
      const j = JSON.parse(readFileSync(`${WORK}/${f}`, "utf8"));
      return j.done === true && j.blob.length === 2 * 1024 * 1024;
    } catch { return false; } // unparseable = torn
  };
  if (!check("old.json")) tornOld++;
  if (!check("new.json")) tornNew++;
}
console.log(`PROOF A (SIGKILL × ${killed} trials): old-style torn ${tornOld}/${TRIALS} · new(tmp+rename) torn ${tornNew}/${TRIALS}`);
const proofA = tornNew === 0;
console.log(`  → ${proofA ? "PASS: rename-style survived every kill" : "FAIL: atomic style torn!"}${tornOld > 0 ? " (old-style demonstrably torn)" : " (old-style not caught this run — kills landed between writes)"}`);

/* ── Proof B: the real glue against torn state ── */
const { readPacingState } = await import(`${ENGINE}/daily.mjs`);
const B = `${WORK}/stateB`;
mkdirSync(B, { recursive: true });
const T = new Date().toISOString().slice(0, 10);
const NOW = new Date().toISOString();
const mkEvents = (n) => Array.from({ length: n }, (_, i) => JSON.stringify({ type: "redeploy.powerup-op", at: `${T}T0${i}:00:00.000Z`, amountSteem: 5 + i })).join("\n") + "\n";

let bFails = 0;
const bCheck = (label, cond) => { console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}`); if (!cond) bFails++; };

// B1: missing RS + journal(2) → rebuilt from journal, not corrupt
writeFileSync(`${B}/events.jsonl`, mkEvents(2));
let r = readPacingState(`${B}/rs.json`, T, NOW, `${B}/events.jsonl`);
bCheck("B1 missing-RS rebuilt-from-journal (count=2)", !r.corrupt && r.rs.powerUpsToday === 2 && r.rs.lastPowerUpAt === `${T}T01:00:00.000Z` && r.rs.rebuilt === "journal");

// B2: torn RS + journal(3) → corrupt flagged, rebuilt, FILE HEALED on disk
writeFileSync(`${B}/rs.json`, '{"day":"2026-10-07","powerUpsToday":99,"lastPowerUpAt":"2026-10-07T00'); // torn mid-write
writeFileSync(`${B}/events.jsonl`, mkEvents(3));
r = readPacingState(`${B}/rs.json`, T, NOW, `${B}/events.jsonl`);
bCheck("B2 torn-RS flagged corrupt + count=3 (law survives)", r.corrupt && r.rs.powerUpsToday === 3);
bCheck("B2b torn-RS file HEALED on disk", (() => { try { const j = JSON.parse(readFileSync(`${B}/rs.json`, "utf8")); return j.powerUpsToday === 3; } catch { return false; } })());

// B3: torn RS + DEAD journal → fail-closed (lastPowerUpAt=now → interval blocks), never reset
writeFileSync(`${B}/rs.json`, '{"torn":');
rmSync(`${B}/events.jsonl`, { force: true });
const before = Date.now();
r = readPacingState(`${B}/rs.json`, T, NOW, `${B}/events.jsonl`);
const since = Math.round((Date.now() - Date.parse(r.rs.lastPowerUpAt)) / 1000);
bCheck("B3 dead-journal fail-closed (blocks this cycle)", r.corrupt && r.rs.rebuilt === "fail-closed" && since <= 5);

// B4: clean RS → returned untouched
writeFileSync(`${B}/rs.json`, JSON.stringify({ day: T, powerUpsToday: 4, lastPowerUpAt: NOW }));
r = readPacingState(`${B}/rs.json`, T, NOW, `${B}/events.jsonl`);
bCheck("B4 clean-RS passthrough", !r.corrupt && r.rs.powerUpsToday === 4 && !r.rs.rebuilt);

console.log(`\nPROOF B: ${bFails === 0 ? "ALL GLUE BRANCHES PASS ✓" : bFails + " FAILURES ✗"}`);
const verdict = proofA && bFails === 0;
console.log(verdict ? "\nCHAOS VERDICT: laws survive crashes — pacing rebuildable from journal, writes atomic" : "\nCHAOS VERDICT: FAILURES FOUND");
process.exit(verdict ? 0 : 1);
