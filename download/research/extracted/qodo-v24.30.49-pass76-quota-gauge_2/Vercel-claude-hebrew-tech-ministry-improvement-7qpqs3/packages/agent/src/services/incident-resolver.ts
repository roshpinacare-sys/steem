import { GitHubClient } from "./github-client.js";
import type { Telemetry } from "./telemetry.js";
import { fetchWithTimeout } from "../utils/fetch-timeout.js";

export interface IncidentInput {
  prNumber: number;
  errorLog: string;
  objective: string;
  commitSha?: string;
}

/**
 * Executes a safe incident response playbook after a production crash is
 * detected: revert the merge cleanly with a new commit, open a tracking GitHub
 * issue, and dispatch a workflow to autonomously generate a fix patch.
 */
export async function resolveIncident(
  gh: GitHubClient,
  input: IncidentInput,
  owner: string,
  repo: string,
  githubToken: string,
  telemetry?: Telemetry,
): Promise<void> {
  await telemetry?.decision("incident", "started", { prNumber: input.prNumber, commitSha: input.commitSha });

  // 1. Safe git revert via a new commit on the production branch.
  await safeRevertCommit(gh, input.prNumber);
  await telemetry?.decision("incident", "revert-committed", { prNumber: input.prNumber });

  // 2. Open a GitHub issue with the crash details.
  const issueTitle = "Alert: Auto-Detected Production Crash";
  const issueBody = `An automated incident response was triggered after a production crash was detected.

- Original objective: ${input.objective}
- PR: #${input.prNumber}
- Commit: ${input.commitSha || "unknown"}

## Error log
\`\`\`
${input.errorLog}
\`\`\`

A follow-up fix workflow has been dispatched.`;

  const issueNumber = await openIssue(owner, repo, githubToken, issueTitle, issueBody);
  await telemetry?.decision("incident", "issue-opened", { issueNumber });

  // 3. Dispatch a workflow run using the original objective so the fix
  //    agent receives meaningful context instead of a generic issue title.
  await dispatchFixWorkflow(owner, repo, githubToken, input.objective);
  await telemetry?.decision("incident", "fix-dispatched", { issueNumber });
}

/**
 * Reverts the merge commit by creating a new commit on the base branch.
 * No force pushes or ref deletions are performed.
 */
async function safeRevertCommit(gh: GitHubClient, prNumber: number): Promise<void> {
  await gh.revertMergeCommitWithNewCommit(prNumber);
}

async function openIssue(owner: string, repo: string, token: string, title: string, body: string): Promise<number> {
  const res = await fetchWithTimeout(
    `https://api.github.com/repos/${owner}/${repo}/issues`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({ title, body, labels: ["qodo-incident", "auto-detected"] }),
    },
    30_000,
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "unknown");
    throw new Error(`GitHub issue creation failed ${res.status}: ${text}`);
  }

  const data = (await res.json()) as { number: number };
  return data.number;
}

async function dispatchFixWorkflow(owner: string, repo: string, token: string, objective: string): Promise<void> {
  const res = await fetchWithTimeout(
    `https://api.github.com/repos/${owner}/${repo}/actions/workflows/agent-pipeline.yml/dispatches`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({ ref: "main", inputs: { objective } }),
    },
    30_000,
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "unknown");
    throw new Error(`GitHub workflow dispatch failed ${res.status}: ${text}`);
  }
}
