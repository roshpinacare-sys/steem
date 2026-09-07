import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { checkNode, ensureDirs, generateEnvFile, installationFile, root, runNpm, sha256File, writeInstallation } from "./common.mjs";

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
let suppliedPassword = process.env.TITAI_INSTALL_PASSWORD;
const started = new Date();
console.log("TITAI v18 portable installation");
console.log(`Application directory: ${root}`);
console.log(`Node.js: ${checkNode()}`);
if (!existsSync(join(root, "package-lock.json"))) throw new Error("package_lock_missing");
ensureDirs();
const envResult = generateEnvFile();
console.log(envResult.created ? "Created a new local .env with random secrets." : "Existing .env preserved.");

if (!suppliedPassword && !dryRun) {
  const rl = createInterface({ input, output });
  suppliedPassword = await rl.question("Choose the first-login password (minimum 12 characters): ");
  rl.close();
}
if (!dryRun && (!suppliedPassword || suppliedPassword.length < 12)) throw new Error("first_login_password_must_be_at_least_12_characters");

const steps = [];
function step(id, action) {
  const at = Date.now();
  console.log(`\n[${id}]`);
  if (!dryRun) action();
  steps.push({ id, status: dryRun ? "dry_run" : "passed", durationMs: Date.now() - at });
}

step("install_dependencies", () => runNpm(["ci", "--ignore-scripts", "--no-audit", "--no-fund"], { timeout: 45 * 60_000 }));
step("validate_migrations", () => runNpm(["run", "db:migrations:validate"], { timeout: 5 * 60_000 }));
step("apply_migrations", () => runNpm(["run", "db:migrate"], { timeout: 5 * 60_000 }));
step("create_first_user_and_defaults", () => runNpm(["run", "seed"], {
  timeout: 10 * 60_000,
  env: { TITAI_ALLOW_DESTRUCTIVE_SEED: "1", TITAI_DEMO_PASSWORD: suppliedPassword },
}));
step("production_build", () => runNpm(["run", "build"], { timeout: 45 * 60_000 }));
step("release_audit", () => runNpm(["run", "release:audit"], { timeout: 10 * 60_000 }));

const installation = {
  format: "titai-v18-portable-installation",
  version: 1,
  status: dryRun ? "dry_run" : "installed",
  installedAt: new Date().toISOString(),
  durationMs: Date.now() - started.getTime(),
  nodeVersion: process.versions.node,
  platform: process.platform,
  architecture: process.arch,
  packageVersion: JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version,
  packageLockSha256: sha256File(join(root, "package-lock.json")),
  buildId: existsSync(join(root, ".next", "BUILD_ID")) ? readFileSync(join(root, ".next", "BUILD_ID"), "utf8").trim() : null,
  databasePath: "./data/titai.db",
  loginEmail: "demo@titai.dev",
  passwordStored: false,
  loopbackUrl: "http://127.0.0.1:3210",
  steps,
};
writeInstallation(installation);
writeFileSync(join(root, "FIRST_LOGIN.txt"), [
  "TITAI v18 first login",
  "",
  "URL: http://127.0.0.1:3210",
  "Email: demo@titai.dev",
  "Password: the password entered during INSTALL.cmd",
  "",
  "The password is not stored in this file.",
].join("\r\n"));
console.log(`\n${dryRun ? "Dry run complete" : "Installation complete"}.`);
console.log("Login email: demo@titai.dev");
console.log("Run START.cmd to launch TITAI.");
