#!/usr/bin/env node
/**
 * swarm-dispatch.mjs — GitHub Actions Matrix Strategy dispatcher.
 *
 * Queries for up to MATRIX_SIZE open issues tagged with QODO_TASK_LABEL and
 * fires all workflow_dispatch runs concurrently via Promise.all, maximising
 * parallel execution within standard GitHub Actions quotas (max-parallel: 5).
 */
import { Octokit } from "@octokit/rest";

const token    = process.env.GITHUB_TOKEN;
const owner    = process.env.GITHUB_OWNER;
const repo     = process.env.GITHUB_REPO;
const workflow = process.env.QODO_WORKFLOW_FILE || "agent-pipeline.yml";
const label    = process.env.QODO_TASK_LABEL    || "qodo-task";

/** Matches the GitHub Actions matrix strategy max-parallel default. */
const MATRIX_SIZE = 5;

if (!token || !owner || !repo) {
  console.error("[swarm-dispatch] Missing GITHUB_TOKEN, GITHUB_OWNER, or GITHUB_REPO");
  process.exit(1);
}

const octo = new Octokit({ auth: token });

/**
 * Fetch up to MATRIX_SIZE open issues carrying the task label.
 */
async function getTaskIssues() {
  const res = await octo.rest.issues.listForRepo({
    owner,
    repo,
    labels: label,
    state: "open",
    per_page: MATRIX_SIZE,
  });
  return res.data.slice(0, MATRIX_SIZE);
}

/**
 * Trigger one workflow_dispatch for a single issue.
 * Never throws — returns a result object so Promise.all completes the full matrix.
 */
async function dispatchWorkflow(issue) {
  try {
    await octo.rest.actions.createWorkflowDispatch({
      owner,
      repo,
      workflow_id: workflow,
      ref: "main",
      inputs: {
        objective:    `${issue.title} (issue #${issue.number})`,
        issue_number: String(issue.number),
      },
    });
    console.log(`[swarm-dispatch] dispatched issue #${issue.number}: ${issue.title}`);
    return { issue: issue.number, status: "dispatched" };
  } catch (e) {
    console.warn(`[swarm-dispatch] failed issue #${issue.number}: ${e.message}`);
    return { issue: issue.number, status: "failed", error: e.message };
  }
}

/**
 * Entry point.
 * 1. Fetch up to MATRIX_SIZE (5) open task issues.
 * 2. Dispatch all 5 runs concurrently via Promise.all (matrix swarming).
 * 3. Print structured result summary.
 */
async function main() {
  const issues = await getTaskIssues();

  if (issues.length === 0) {
    console.log(`[swarm-dispatch] No open issues with label "${label}" — nothing to dispatch.`);
    return;
  }

  console.log(`[swarm-dispatch] Matrix: dispatching ${issues.length}/${MATRIX_SIZE} workflow(s) in parallel`);

  // All MATRIX_SIZE dispatches fire concurrently — standard matrix swarming pattern.
  const results = await Promise.all(issues.map((issue) => dispatchWorkflow(issue)));

  const dispatched = results.filter((r) => r.status === "dispatched").length;
  const failed     = results.filter((r) => r.status === "failed").length;

  console.log(`[swarm-dispatch] Summary: ${dispatched} dispatched, ${failed} failed`);
  console.log(JSON.stringify({ matrix: results }, null, 2));

  if (dispatched === 0 && failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("[swarm-dispatch] fatal:", err);
  process.exit(1);
});
