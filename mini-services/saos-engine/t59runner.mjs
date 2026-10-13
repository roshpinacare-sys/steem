/**
 * T-59 shared vector runner — parallel build fleet uses ONE runner, N vector files.
 * Contract: each vector file exports `export async function run({ eq, ok })`.
 * Usage:  bun t59runner.mjs t59a.vectors.mjs [t59b.vectors.mjs ...]
 * Exit 0 only when every vector passed. Integrates into selftest.mjs as
 *   { const m = await import("./t59a.vectors.mjs"); await m.run({ eq, ok }); }
 * so the ONE selftest counter stays the single source of truth.
 */
import { pathToFileURL } from "node:url";

let pass = 0;
let fail = 0;
const eq = (name, a, b) => {
  const ja = JSON.stringify(a);
  const jb = JSON.stringify(b);
  if (ja === jb) pass++;
  else {
    fail++;
    console.error(`FAIL ${name}\n  got: ${ja}\n  want: ${jb}`);
  }
};
const ok = (name, cond) => (cond ? pass++ : (fail++, console.error(`FAIL ${name}`)));

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("usage: bun t59runner.mjs <vector-file.mjs> [...]");
  process.exit(2);
}
for (const f of files) {
  const m = await import(pathToFileURL(f).href);
  if (typeof m.run !== "function") {
    console.error(`FAIL runner: ${f} does not export run({eq,ok})`);
    fail++;
    continue;
  }
  await m.run({ eq, ok });
}
console.log(`T59RUNNER ${pass}/${pass + fail} ${fail === 0 ? "PASS" : "FAIL"}`);
process.exit(fail === 0 ? 0 : 1);
