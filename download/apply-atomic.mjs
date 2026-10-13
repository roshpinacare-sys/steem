#!/usr/bin/env bun
/* apply-atomic.mjs — one-shot patcher (R235): tmp+rename for the 6 remaining non-atomic writeJson sites */
import { readFileSync, writeFileSync } from "fs";
const FILES = ["curator.mjs", "discovery.mjs", "intel.mjs", "learning.mjs", "signer.mjs", "soldiers.mjs"];
const OLD = "const writeJson = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(v, null, 2)); };";
const NEW = "const writeJson = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); const t = `${p}.tmp.${process.pid}`; fs.writeFileSync(t, JSON.stringify(v, null, 2)); fs.renameSync(t, p); }; /* R235: atomic — rename is the commit point */";
const BASE = "/home/z/my-project/mini-services/saos-engine/";
let done = 0;
for (const f of FILES) {
  const p = BASE + f;
  const s = readFileSync(p, "utf8");
  if (s.includes(NEW)) { console.log("already ✓", f); continue; }
  if (!s.includes(OLD)) { console.log("PATTERN MISS ✗", f); continue; }
  writeFileSync(p, s.replace(OLD, NEW));
  console.log("ATOMIC ✓", f);
  done++;
}
console.log(`patched: ${done}/${FILES.length}`);
