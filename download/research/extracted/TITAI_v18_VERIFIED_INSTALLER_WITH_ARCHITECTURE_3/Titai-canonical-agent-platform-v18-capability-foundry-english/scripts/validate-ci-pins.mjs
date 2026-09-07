import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const workflows = [
  ".github/workflows/ci.yml",
  ".github/workflows/pilot-validation.yml",
];
const allowed = new Map([
  ["actions/checkout", "11bd71901bbe5b1630ceea73d27597364c9af683"],
  ["actions/setup-node", "49933ea5288caeca8642d1e84afbd3f7d6820020"],
  ["actions/upload-artifact", "ea165f8d65b6e75b540449e92b4886f43607fa02"],
]);
const violations = [];
for (const file of workflows) {
  const text = readFileSync(resolve(file), "utf8");
  for (const match of text.matchAll(/uses:\s*([\w.-]+\/[\w.-]+)@([^\s#]+)/g)) {
    const [, action, ref] = match;
    if (!/^[a-f0-9]{40}$/.test(ref)) {
      violations.push(`${file}: ${action} is not pinned to a 40-character commit SHA (${ref})`);
      continue;
    }
    const expected = allowed.get(action);
    if (expected && expected !== ref) violations.push(`${file}: ${action} SHA differs from the reviewed pin`);
  }
  if (/permissions:\s*write-all/.test(text)) violations.push(`${file}: write-all permissions are forbidden`);
}
if (violations.length) {
  console.error(violations.join("\n"));
  process.exit(1);
}
console.log(`CI pin validation passed for ${workflows.length} workflows.`);
