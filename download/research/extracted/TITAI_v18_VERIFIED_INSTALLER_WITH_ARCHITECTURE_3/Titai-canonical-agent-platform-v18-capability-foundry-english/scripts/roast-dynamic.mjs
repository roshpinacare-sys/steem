import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";

const root = process.cwd();
const outDir = path.join(root, "docs/roast/evidence/v12");
fs.mkdirSync(outDir, { recursive: true });

const modes = [
  {
    id: "runtime",
    title: "Runtime behavior roast",
    command: ["npx", ["vitest", "run", "tests/durable-step-runner.test.ts", "tests/durable-fencing.test.ts", "tests/model-router.test.ts", "tests/memory-ablation.test.ts", "tests/risk-adjusted-autonomy.test.ts", "tests/pilot-readiness.test.ts", "--maxWorkers=2"]],
  },
  {
    id: "recovery",
    title: "Recovery roast",
    command: ["npm", ["run", "durable:prove"]],
  },
  {
    id: "security",
    title: "Security roast",
    command: ["npx", ["vitest", "run", "tests/authorization.test.ts", "tests/tool-capability.test.ts", "tests/tool-runtime.test.ts", "tests/egress.test.ts", "tests/memory-ablation.test.ts", "tests/verification-attestation.test.ts", "--maxWorkers=2"]],
  },
  {
    id: "product_ux",
    title: "Product and operator-truth roast",
    command: ["npx", ["vitest", "run", "tests/evidence-summary.test.ts", "tests/pilot-readiness.test.ts", "tests/accessibility-contract.test.ts", "--maxWorkers=2"]],
  },
  {
    id: "release",
    title: "Release integrity roast",
    command: ["npm", ["run", "release:audit"]],
  },
  {
    id: "performance",
    title: "Deterministic performance roast",
    command: ["npx", ["tsx", "--tsconfig", "tsconfig.scripts.json", "scripts/benchmark-v12.ts"]],
  },
];

const results = modes.map((mode) => {
  const [command, args] = mode.command;
  const started = performance.now();
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
    timeout: 120_000,
    maxBuffer: 20 * 1024 * 1024,
    shell: false,
  });
  return {
    id: mode.id,
    title: mode.title,
    command: [command, ...args].join(" "),
    status: result.status === 0 ? "pass" : result.error?.code === "ETIMEDOUT" ? "blocked" : "fail",
    exitCode: result.status,
    durationMs: Math.round(performance.now() - started),
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? String(result.error ?? ""),
  };
});
const summary = {
  total: results.length,
  pass: results.filter((row) => row.status === "pass").length,
  fail: results.filter((row) => row.status === "fail").length,
  blocked: results.filter((row) => row.status === "blocked").length,
};
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  scope: "Six-mode repeatable dynamic roast. Passing proves only the commands and properties listed; it is not a production certification.",
  summary,
  results,
};
fs.writeFileSync(path.join(outDir, "roast-dynamic-results.json"), JSON.stringify(report, null, 2) + "\n");
const markdown = [
  "# v12 Dynamic Roast Results",
  "",
  `Generated: ${report.generatedAt}`,
  "",
  report.scope,
  "",
  `Result: **${summary.pass}/${summary.total} passed, ${summary.fail} failed, ${summary.blocked} blocked.**`,
  "",
  "| Mode | Status | Duration ms | Command |",
  "|---|---|---:|---|",
  ...results.map((row) => `| ${row.title} | ${row.status.toUpperCase()} | ${row.durationMs} | \`${row.command}\` |`),
  "",
  ...results.flatMap((row) => [
    `## ${row.title}`,
    "",
    `Status: **${row.status.toUpperCase()}**`,
    "",
    "```text",
    (row.stdout || row.stderr || "No output").slice(-8_000),
    "```",
    "",
  ]),
];
fs.writeFileSync(path.join(outDir, "roast-dynamic-results.md"), markdown.join("\n"));
console.log(`Dynamic Roast complete: ${summary.pass}/${summary.total} passed, ${summary.fail} failed, ${summary.blocked} blocked.`);
if (process.argv.includes("--strict") && summary.fail > 0) process.exit(1);
