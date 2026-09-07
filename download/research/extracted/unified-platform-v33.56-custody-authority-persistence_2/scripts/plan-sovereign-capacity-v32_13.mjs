import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { parseStrictJsonV32_12 } from '../dist/src/validation/strict-json-v32_12.js';
import { planSovereignCapacityV32_13 } from '../dist/src/operations/sovereign-capacity-controller-v32_13.js';

const [snapshotPath, policyPath, offersPath, outputPath] = process.argv.slice(2);
if ([snapshotPath, policyPath, offersPath, outputPath].some((value) => value === undefined || value.trim() === '')) {
  throw new Error('usage: plan-sovereign-capacity-v32_13.mjs <snapshot.json> <policy.json> <offers.json> <output.json>');
}
const readStrict = (path) => parseStrictJsonV32_12(readFileSync(resolve(path), 'utf8'));
const output = resolve(outputPath);
const plan = planSovereignCapacityV32_13(readStrict(snapshotPath), readStrict(policyPath), readStrict(offersPath));
mkdirSync(dirname(output), { recursive: true });
const temporary = `${output}.tmp-${process.pid}`;
writeFileSync(temporary, `${JSON.stringify(plan, null, 2)}\n`, { mode: 0o600 });
renameSync(temporary, output);
console.log(JSON.stringify({ status: plan.status, proposalOnly: plan.proposalOnly, actions: plan.actions, planDigest: plan.planDigest }, null, 2));
if (plan.status !== 'PLANNED') process.exit(2);
