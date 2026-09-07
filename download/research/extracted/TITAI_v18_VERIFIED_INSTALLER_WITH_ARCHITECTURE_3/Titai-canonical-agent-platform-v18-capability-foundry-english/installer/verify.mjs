import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { checkNode, installationFile, root, runNpm } from "./common.mjs";
const deep = process.argv.includes("--deep");
const checks = [
  ["node", () => checkNode()],
  ["environment", () => { if (!existsSync(join(root, ".env"))) throw new Error("missing_.env"); }],
  ["database", () => { if (!existsSync(join(root, "data", "titai.db"))) throw new Error("missing_database"); }],
  ["build", () => { if (!existsSync(join(root, ".next", "BUILD_ID"))) throw new Error("missing_build"); }],
  ["installation_record", () => { if (!existsSync(installationFile)) throw new Error("missing_INSTALLATION.json"); JSON.parse(readFileSync(installationFile, "utf8")); }],
];
const results = [];
for (const [id, fn] of checks) { try { const value = fn(); results.push({ id, status: "passed", value: value ?? null }); } catch (error) { results.push({ id, status: "failed", error: String(error) }); } }
try { runNpm(["run", "db:migrations:validate"]); results.push({ id: "migrations", status: "passed" }); } catch (error) { results.push({ id: "migrations", status: "failed", error: String(error) }); }
try { runNpm(["run", "release:audit"]); results.push({ id: "release_audit", status: "passed" }); } catch (error) { results.push({ id: "release_audit", status: "failed", error: String(error) }); }
if (deep) {
  try { runNpm(["run", "v18:safe"], { timeout: 45 * 60_000 }); results.push({ id: "deep_v18_validation", status: "passed" }); } catch (error) { results.push({ id: "deep_v18_validation", status: "failed", error: String(error) }); }
}
console.log(JSON.stringify({ status: results.every((x) => x.status === "passed") ? "passed" : "failed", results }, null, 2));
if (results.some((x) => x.status === "failed")) process.exitCode = 2;
