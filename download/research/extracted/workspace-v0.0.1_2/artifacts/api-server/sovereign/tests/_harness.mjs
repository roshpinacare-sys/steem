// ECOS micro test harness — zero dependencies. Runs on Node's native TypeScript.
// A .test.ts file imports { test, assert, eq } and calls them; results print a footer
// ("Passed: N / Failed: M") that the intelligent audit engine parses. No vitest/jest needed.
const _q = [];
let _scheduled = false;
export function test(name, fn) { _q.push({ name, fn }); if (!_scheduled) { _scheduled = true; setTimeout(_run, 0); } }
export function assert(c, msg) { if (!c) throw new Error(msg || 'assertion failed'); }
export function eq(a, b, msg) { if (a !== b) throw new Error((msg || 'not equal') + ` (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); }
export async function deepEq(a, b, msg) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(msg || 'deep not equal'); }
let _ran = false;
async function _run() {
  if (_ran) return; _ran = true;
  let pass = 0, fail = 0; const fails = [];
  for (const t of _q) {
    try { await t.fn(); console.log('  \u2713 ' + t.name); pass++; }
    catch (e) { console.log('  \u2717 ' + t.name + ': ' + (e && e.message)); fail++; fails.push(t.name); }
  }
  console.log('\nResult: ' + pass + ' pass, ' + fail + ' fail');
  console.log('Passed: ' + pass); console.log('Failed: ' + fail);
  if (fail) { process.exitCode = 1; }
}
// auto-run after the importing module finishes registering tests
process.once('beforeExit', _run);
