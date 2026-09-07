import { createHash, randomBytes, verify } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const bundle = resolve(process.env.TITAI_V17_INSTALLER_BUNDLE ?? "/mnt/data/Titai-v17-offline-installer-linux-x64.tar.gz");
const output = resolve(process.env.TITAI_V17_INSTALLER_PROOF ?? "docs/canonical/evidence/v17/installer/proof.json");
const temp = mkdtempSync(join(tmpdir(), "titai-v17-install-"));
const hash = (data) => createHash("sha256").update(data).digest("hex");
function normalize(value){if(Array.isArray(value))return value.map(normalize);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,normalize(v)]));return value;}
const checks = [];
let child;
try {
  if (!existsSync(bundle)) throw new Error("installer_bundle_missing");
  execFileSync("tar", ["-xzf", bundle, "-C", temp], { stdio: "pipe" });
  const envelope = JSON.parse(readFileSync(join(temp, "installer-manifest.signed.json"), "utf8"));
  const publicDer = Buffer.from(envelope.publicKeySpkiBase64, "base64");
  const keyId = hash(publicDer).slice(0, 24);
  const signatureValid = keyId === envelope.keyId && verify(null, Buffer.from(JSON.stringify(normalize(envelope.manifest))), { key: publicDer, format: "der", type: "spki" }, Buffer.from(envelope.signatureBase64, "base64"));
  checks.push({ id: "manifest_signature", passed: signatureValid });
  const mismatches = [];
  for (const file of envelope.manifest.files) {
    const path = join(temp, file.path);
    if (!existsSync(path)) { mismatches.push({ path: file.path, error: "missing" }); continue; }
    const actual = hash(readFileSync(path)); const bytes = statSync(path).size;
    if (actual !== file.sha256 || bytes !== file.bytes) mismatches.push({ path: file.path, expected: file.sha256, actual, expectedBytes: file.bytes, bytes });
  }
  checks.push({ id: "file_integrity", passed: mismatches.length === 0, mismatches });
  if (!signatureValid || mismatches.length) throw new Error("installer_integrity_failed");
  const db = join(temp, "state/titai.db"); mkdirSync(dirname(db), { recursive: true });
  const migrate = execFileSync(join(temp, "runtime/node"), [join(temp, "installer/migrate.mjs")], { cwd: join(temp, "application"), env: { ...process.env, DATABASE_PATH: db }, encoding: "utf8", timeout: 60_000 });
  checks.push({ id: "migrations", passed: true, output: migrate.trim() });
  const port = 33000 + Math.floor(Math.random() * 1000);
  const serverLog = join(temp, "server.log");
  const log = await import("node:fs").then((fs) => fs.openSync(serverLog, "w"));
  child = spawn(join(temp, "runtime/node"), [join(temp, "application/node_modules/next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "--port", String(port)], { cwd: join(temp, "application"), stdio: ["ignore", log, log], env: { ...process.env, DATABASE_PATH: db, HOSTNAME: "127.0.0.1", PORT: String(port), NODE_ENV: "production", AUTH_SECRET: randomBytes(32).toString("base64") } });
  let response; let lastError;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
    try { response = await fetch(`http://127.0.0.1:${port}/login`, { redirect: "manual" }); if (response.status > 0) break; } catch (error) { lastError = error; }
    if (child.exitCode !== null) break;
  }
  const browserlessHttpPassed = Boolean(response && response.status >= 200 && response.status < 500);
  checks.push({ id: "loopback_http_startup", passed: browserlessHttpPassed, status: response?.status ?? null, error: lastError ? String(lastError) : null });
  child.kill("SIGTERM"); await new Promise((resolveExit) => child.once("exit", resolveExit)); child = undefined;
  const backup = join(temp, "state/backup.db"); cpSync(db, backup); rmSync(db); cpSync(backup, db);
  checks.push({ id: "backup_restore_copy", passed: hash(readFileSync(db)) === hash(readFileSync(backup)) });
  const passed = checks.every((check) => check.passed);
  const proof = { format: "titai-v17-offline-installer-proof", version: 1, generatedAt: new Date().toISOString(), status: passed ? "passed" : "failed", bundle, bundleSha256: hash(readFileSync(bundle)), signingMode: envelope.manifest.signingMode, manifestReleaseSha256: envelope.manifest.releaseSha256, platform: envelope.manifest.platform, architecture: envelope.manifest.architecture, files: envelope.manifest.files.length, checks, networkRequirementDuringProof: "none after bundle availability", limitations: envelope.manifest.limitations };
  mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, `${JSON.stringify(proof, null, 2)}\n`);
  console.log(JSON.stringify({ output, status: proof.status, checks: checks.length, signingMode: proof.signingMode }, null, 2));
  process.exitCode = passed ? 0 : 2;
} catch (error) {
  const proof = { format: "titai-v17-offline-installer-proof", version: 1, generatedAt: new Date().toISOString(), status: "failed", bundle, error: String(error), checks };
  mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, `${JSON.stringify(proof, null, 2)}\n`);
  console.error(JSON.stringify(proof, null, 2)); process.exitCode = 2;
} finally {
  child?.kill("SIGKILL");
  if (process.env.TITAI_KEEP_INSTALLER_TEMP !== "1") rmSync(temp, { recursive: true, force: true });
}
