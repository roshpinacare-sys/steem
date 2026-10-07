#!/usr/bin/env bun
/**
 * chaos-tear.mjs — Proof A harder (R235): force-demonstrate old-style tearing.
 * 32MB payloads, dense kill grid over the write window; old (direct write) vs new (tmp+rename).
 * Honest reporting either way — if old-style never tears here, that is recorded too.
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "fs";
import { spawn } from "child_process";

const WORK = "/tmp/chaos-tear";
rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });

const CHILD = `${WORK}/writer.mjs`;
writeFileSync(CHILD, `
import { writeFileSync, renameSync } from "fs";
const MB = 32 * 1024 * 1024;
const oldFile = ${JSON.stringify(WORK + "/old.json")};
const newFile = ${JSON.stringify(WORK + "/new.json")};
let i = 0;
while (true) {
  i++;
  const p = JSON.stringify({ blob: "x".repeat(MB), i });
  writeFileSync(oldFile, p);                     // OLD
  const t = newFile + ".tmp." + process.pid;
  writeFileSync(t, p); renameSync(t, newFile);   // NEW
}
`);

const classify = (f) => {
  try {
    const j = JSON.parse(readFileSync(`${WORK}/${f}`, "utf8"));
    return typeof j.i === "number" && j.blob.length === 32 * 1024 * 1024 ? "complete" : "torn";
  } catch (e) {
    if (e.code === "ENOENT") return "absent"; // killed before first commit — legitimate in BOTH styles
    return "torn";                           // EXISTS but unreadable/partial — the real tearing
  }
};

let oldStats = { complete: 0, torn: 0, absent: 0 }, newStats = { complete: 0, torn: 0, absent: 0 };
const TRIALS = 8;
for (let trial = 0; trial < TRIALS; trial++) {
  for (const f of ["old.json", "new.json"]) { try { rmSync(`${WORK}/${f}`, { force: true }); } catch {} }
  const child = spawn("bun", [CHILD], { stdio: "ignore" });
  const delay = 40 + trial * 25; // sweep 40..215ms across the write window
  await new Promise((r) => setTimeout(r, delay));
  child.kill("SIGKILL");
  await new Promise((r) => setTimeout(r, 150));
  oldStats[classify("old.json")]++;
  newStats[classify("new.json")]++;
}
console.log(`PROOF A+ (SIGKILL sweep × ${TRIALS}, 32MB payloads):`);
console.log(`  OLD (direct write) : complete=${oldStats.complete} TORN=${oldStats.torn} absent=${oldStats.absent}`);
console.log(`  NEW (tmp+rename)   : complete=${newStats.complete} TORN=${newStats.torn} absent=${newStats.absent}`);
if (oldStats.torn > 0 && newStats.torn === 0) console.log("VERDICT: old-style demonstrably TORN, atomic style ZERO torn — the fix addresses a REAL, reproducible failure ✓");
else if (oldStats.torn === 0 && newStats.torn === 0) console.log("VERDICT (honest): tearing not reproducible via SIGKILL on this box — atomic writes kept as defense-in-depth (ENOSPC / larger states / future payloads remain real vectors)");
else console.log(`VERDICT: UNEXPECTED — atomic style torn ${newStats.torn}×, investigate!`);
process.exit(newStats.torn === 0 ? 0 : 1);
