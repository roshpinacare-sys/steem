#!/usr/bin/env bun
/**
 * chaos-enospc.mjs — deterministic ENOSPC-analogue proof (R235)
 * ulimit -f 1 (1KB file-size cap) makes the OS abort a large write mid-flight —
 * the same partial-write state ENOSPC produces. OLD style: target torn.
 * NEW style: tmp torn, target untouched.
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "fs";
import { spawnSync } from "child_process";

const WORK = "/tmp/chaos-enospc";
rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });

const CHILD = `${WORK}/writer.mjs`;
writeFileSync(CHILD, `
import { writeFileSync, renameSync } from "fs";
const MB = 8 * 1024 * 1024;
const p = JSON.stringify({ blob: "x".repeat(MB), done: true });
// OLD: direct write — the ENOSPC-analogue abort leaves a PARTIAL target
try { writeFileSync(${JSON.stringify(WORK + "/old.json")}, p); } catch { /* write failed mid-flight */ }
// NEW: tmp+rename — the abort leaves the tmp torn, target untouched
try { const t = ${JSON.stringify(WORK + "/new.json")} + ".tmp." + process.pid; writeFileSync(t, p); renameSync(t, ${JSON.stringify(WORK + "/new.json")}); } catch { /* tmp failed, target untouched */ }
`);

const r = spawnSync("bash", ["-c", `ulimit -f 1; bun ${CHILD}`], { cwd: WORK, timeout: 30000 });
const classify = (f) => {
  if (!existsSync(`${WORK}/${f}`)) return "absent";
  try {
    const j = JSON.parse(readFileSync(`${WORK}/${f}`, "utf8"));
    return j.done && j.blob.length === 8 * 1024 * 1024 ? "complete" : "torn";
  } catch { return "torn"; }
};
const o = classify("old.json"), n = classify("new.json");
console.log(`ENOSPC-analogue (ulimit -f 1, 8MB payload):`);
console.log(`  OLD (direct write): ${o}`);
console.log(`  NEW (tmp+rename)  : ${n}`);
const pass = o === "torn" && n !== "torn"; // NEW: target never torn — absent (first-write failed, untouched) or complete
console.log(pass
  ? "VERDICT: deterministic tear on OLD; NEW target NEVER torn (untouched when tmp write aborts) — atomic commit is the real fix ✓"
  : `VERDICT: ${o === "torn" && n === "torn" ? "UNEXPECTED — new style also torn" : "old-style tear not reproduced (see stderr)"}`);
if (r.stderr?.length) console.log("  child stderr:", r.stderr.toString().slice(0, 200));
process.exit(pass ? 0 : 1);
