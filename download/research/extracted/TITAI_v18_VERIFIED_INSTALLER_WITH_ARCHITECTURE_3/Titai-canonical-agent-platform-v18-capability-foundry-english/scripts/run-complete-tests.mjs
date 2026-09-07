import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";

const root = process.cwd();
const testsDir = resolve(root, "tests");
const evidenceDir = resolve(root, process.env.TITAI_TEST_EVIDENCE_DIR ?? "docs/canonical/evidence/v16/full-tests");
const concurrency = Math.max(1, Math.min(4, Number.parseInt(process.env.TITAI_TEST_CONCURRENCY ?? "2", 10) || 2));
const timeoutMs = Math.max(10_000, Number.parseInt(process.env.TITAI_TEST_FILE_TIMEOUT_MS ?? "90000", 10) || 90_000);
const files = readdirSync(testsDir).filter((name) => name.endsWith(".test.ts")).sort().map((name) => `tests/${name}`);
const selected = process.argv.slice(2).filter((arg) => arg.endsWith(".test.ts"));
const queue = selected.length ? selected : files;
const vitest = resolve(root, "node_modules/vitest/vitest.mjs");
mkdirSync(evidenceDir, { recursive: true });

function hash(value) { return createHash("sha256").update(value).digest("hex"); }
function sanitize(file) { return file.replaceAll("/", "__").replaceAll("\\", "__"); }

async function runOne(file) {
  const stem = sanitize(file);
  const jsonPath = join(evidenceDir, `${stem}.json`);
  const logPath = join(evidenceDir, `${stem}.log`);
  rmSync(jsonPath, { force: true });
  const args = [vitest, "run", file, "--maxWorkers=1", "--fileParallelism=false", "--reporter=json", `--outputFile=${jsonPath}`];
  const started = performance.now();
  const child = spawn(process.execPath, args, {
    cwd: root,
    env: { ...process.env, NODE_NO_WARNINGS: "1", TITAI_SQLITE_DRIVER: process.env.TITAI_SQLITE_DRIVER ?? "auto" },
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });
  let stdout = ""; let stderr = ""; let timedOut = false;
  child.stdout?.on("data", (chunk) => { stdout += String(chunk); });
  child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
  const timer = setTimeout(() => {
    timedOut = true;
    try {
      if (process.platform !== "win32") process.kill(-child.pid, "SIGKILL"); else child.kill("SIGKILL");
    } catch { child.kill("SIGKILL"); }
  }, timeoutMs);
  const exit = await new Promise((resolveExit) => child.once("exit", (code, signal) => resolveExit({ code: code ?? 1, signal })));
  clearTimeout(timer);
  const durationMs = Math.round(performance.now() - started);
  writeFileSync(logPath, `${stdout}${stderr}`);
  let report;
  if (existsSync(jsonPath)) {
    try { report = JSON.parse(readFileSync(jsonPath, "utf8")); } catch { report = undefined; }
  }
  return {
    file,
    exitCode: exit.code,
    signal: exit.signal,
    timedOut,
    durationMs,
    logSha256: hash(`${stdout}${stderr}`),
    report,
    passed: !timedOut && exit.code === 0 && report?.success === true,
  };
}

const results = [];
let cursor = 0;
async function worker() {
  while (true) {
    const index = cursor++;
    if (index >= queue.length) return;
    const result = await runOne(queue[index]);
    results[index] = result;
    const state = result.passed ? "PASS" : result.timedOut ? "TIMEOUT" : "FAIL";
    console.log(`${state} ${result.file} ${result.durationMs}ms`);
  }
}
await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, () => worker()));

const totals = results.reduce((acc, item) => {
  acc.files += 1;
  acc.passedFiles += item.passed ? 1 : 0;
  acc.failedFiles += item.passed ? 0 : 1;
  acc.tests += item.report?.numTotalTests ?? 0;
  acc.passedTests += item.report?.numPassedTests ?? 0;
  acc.failedTests += item.report?.numFailedTests ?? 0;
  acc.durationMs += item.durationMs;
  if (item.timedOut) acc.timedOutFiles += 1;
  return acc;
}, { files: 0, passedFiles: 0, failedFiles: 0, timedOutFiles: 0, tests: 0, passedTests: 0, failedTests: 0, durationMs: 0 });
const summary = {
  format: "titai-isolated-test-suite",
  version: 1,
  generatedAt: new Date().toISOString(),
  concurrency,
  timeoutMs,
  success: totals.failedFiles === 0,
  totals,
  results: results.map(({ report, ...item }) => ({ ...item, reportSummary: report ? { success: report.success, numTotalTests: report.numTotalTests, numPassedTests: report.numPassedTests, numFailedTests: report.numFailedTests } : undefined })),
};
writeFileSync(join(evidenceDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(totals));
process.exit(summary.success ? 0 : 1);
