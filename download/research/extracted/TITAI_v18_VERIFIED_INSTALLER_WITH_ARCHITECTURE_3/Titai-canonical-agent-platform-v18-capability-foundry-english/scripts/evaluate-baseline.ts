import fs from "node:fs";
import path from "node:path";
import { runBaselineEvaluation } from "@/lib/evaluation/baseline";

const result = runBaselineEvaluation();
const outputDir = path.resolve("docs/canonical/evidence");
fs.mkdirSync(outputDir, { recursive: true });

const jsonPath = path.join(outputDir, "baseline-evaluation.json");
const markdownPath = path.join(outputDir, "baseline-evaluation.md");
fs.writeFileSync(jsonPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");

const rows = result.cases
  .map(
    (item) =>
      `| ${item.id} | ${item.passed ? "PASS" : "FAIL"} | ${escapeCell(item.title)} | ${escapeCell(item.criterion)} |`,
  )
  .join("\n");
const markdown = `# Titai Baseline Evaluation\n\n` +
  `Deterministic simulation baseline. This report does not claim database integration coverage.\n\n` +
  `- Cases: ${result.totals.cases}\n` +
  `- Passed: ${result.totals.passed}\n` +
  `- Failed: ${result.totals.failed}\n` +
  `- Pass rate: ${result.totals.passRate}%\n\n` +
  `| ID | Result | Title | Criterion |\n` +
  `| --- | --- | --- | --- |\n${rows}\n`;
fs.writeFileSync(markdownPath, markdown, "utf8");

console.log(
  `Baseline evaluation: ${result.totals.passed}/${result.totals.cases} passed.`,
);
if (result.totals.failed > 0) process.exit(1);

function escapeCell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}
