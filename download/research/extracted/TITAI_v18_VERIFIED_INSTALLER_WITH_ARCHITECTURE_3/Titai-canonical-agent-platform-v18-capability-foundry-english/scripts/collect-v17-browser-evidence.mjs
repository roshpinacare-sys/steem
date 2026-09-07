import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const output = resolve(process.env.TITAI_V17_BROWSER_EVIDENCE ?? "docs/canonical/evidence/v17/browser/evidence.json");
const policyDirectories = ["/etc/chromium/policies/managed", "/etc/opt/chrome/policies/managed"];
const policies = [];
for (const directory of policyDirectories) {
  if (!existsSync(directory)) continue;
  for (const name of readdirSync(directory).filter((entry) => entry.endsWith(".json")).sort()) {
    const path = `${directory}/${name}`;
    try { policies.push({ path, sha256: createHash("sha256").update(readFileSync(path)).digest("hex"), policy: JSON.parse(readFileSync(path, "utf8")) }); }
    catch (error) { policies.push({ path, error: String(error) }); }
  }
}
const denyAll = policies.some((entry) => Array.isArray(entry.policy?.URLBlocklist) && entry.policy.URLBlocklist.includes("*"));
let testInventory = null;
try { testInventory = execFileSync("npx", ["playwright", "test", "--list"], { encoding: "utf8", timeout: 30_000 }); }
catch (error) { testInventory = String(error.stdout ?? error.message ?? error); }
const evidence = {
  format: "titai-v17-browser-evidence",
  version: 1,
  generatedAt: new Date().toISOString(),
  status: denyAll ? "blocked" : "not_run",
  executionKind: "real_browser",
  policies,
  testInventory,
  blockers: denyAll ? ["managed_browser_url_blocklist_denies_all_navigation"] : ["browser_workflow_not_executed"],
  limitation: denyAll
    ? "The managed browser blocks all URLs, including loopback. The policy was not modified or bypassed."
    : "Run the signed browser collector in a disposable environment with Chromium and a secondary engine.",
};
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify({ output, status: evidence.status, blockers: evidence.blockers }));
process.exit(evidence.status === "passed" ? 0 : 2);
