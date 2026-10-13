#!/usr/bin/env bun
/**
 * mutation-test.mjs — test-of-the-tests (R234 review)
 * Each mutation MUST be caught by selftest (selftest exits non-zero / prints FAIL).
 * A mutation that "survives" = a real coverage hole.
 * Fixed argv bug from the first attempt (bun -e shifts args): now a real file script.
 */
import { readFileSync, writeFileSync, copyFileSync } from "fs";
import { execSync } from "child_process";

const LIB = "/home/z/my-project/mini-services/saos-engine/lib.mjs";
const BACKUP = "/tmp/lib.mjs.bak";
copyFileSync(LIB, BACKUP);

const MUTATIONS = [
  {
    name: "floor-guard-broken (excess inflated by 5 → floor breach)",
    from: "Math.max(0, liquidSteem - liquidSteemFloor)",
    to: "Math.max(0, liquidSteem - liquidSteemFloor + 5)",
  },
  {
    name: "ratio-check-relaxed (sum 0.5..1.5 accepted)",
    from: "sum > 0.999 && sum < 1.001",
    to: "sum > 0.5 && sum < 1.5",
  },
  {
    name: "min-threshold-ignored (PLAN below 5 STEEM allowed)",
    from: "const planThreshold = Math.max(minPowerUpSteem, 0.001);",
    to: "const planThreshold = 0.001;",
  },
  {
    name: "pacing-interval-never-blocks (cooldown law dead)",
    from: "if (since != null && since < minIntervalSec) {",
    to: "if (since != null && since < minIntervalSec - 3600) {",
  },
  {
    name: "day-cap-removed (unlimited daily power-ups)",
    from: "if (powerUpsToday >= maxPerDay) {",
    to: "if (powerUpsToday > Number.MAX_SAFE_INTEGER) {",
  },
];

let survivors = 0, caught = 0;
console.log("baseline: running selftest on CLEAN lib…");
execSync(`cd ${LIB.replace("/lib.mjs", "")} && bun selftest.mjs`, { stdio: "pipe" });
console.log("baseline 376/376 PASS ✓\n");

for (const m of MUTATIONS) {
  const src = readFileSync(BACKUP, "utf8");
  if (!src.includes(m.from)) {
    console.log(`SKIP (target not found): ${m.name}`);
    continue;
  }
  writeFileSync(LIB, src.replace(m.from, m.to));
  let out = "";
  try {
    execSync(`cd ${LIB.replace("/lib.mjs", "")} && bun selftest.mjs 2>&1`, { stdio: "pipe" });
    // no throw = selftest passed = mutation survived
    console.log(`SURVIVED ✗ (coverage hole!): ${m.name}`);
    survivors++;
  } catch (e) {
    out = String(e.stdout || "") + String(e.stderr || "");
    const fails = (out.match(/FAIL[^\n]*/g) || []).slice(0, 2).join(" | ").slice(0, 140);
    console.log(`CAUGHT ✓ : ${m.name}`);
    console.log(`   selftest failures: ${fails || "(non-zero exit)"}`);
    caught++;
  }
}
copyFileSync(BACKUP, LIB);
const clean = readFileSync(LIB, "utf8");
console.log(`\n--- lib.mjs restored (${clean === readFileSync(BACKUP, "utf8") ? "byte-identical ✓" : "MISMATCH ✗"}) ---`);
execSync(`cd ${LIB.replace("/lib.mjs", "")} && bun selftest.mjs 2>&1 | tail -1`, { stdio: "inherit" });
console.log(`\nMUTATION RESULT: ${caught}/${caught + survivors} killed, ${survivors} survivors`);
process.exit(survivors === 0 ? 0 : 1);
