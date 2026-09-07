import { Octokit } from "@octokit/rest";
import { throttledBatch } from "../utils/rate-limiter.js";
import { fetchWithTimeout } from "../utils/fetch-timeout.js";

export interface DriftReport {
  driftedFiles: string[];
  safeFiles: string[];
}

export interface CommitResult {
  commitSha: string;
  drift?: DriftReport;
}

const SLUG_RE = /^[A-Za-z0-9_.-]+$/;

export class GitHubClient {
  private octo: Octokit;
  constructor(private token: string, private owner: string, private repo: string) {
    if (!SLUG_RE.test(owner) || !SLUG_RE.test(repo)) {
      throw new Error(
        `Invalid GitHub owner/repo slug: owner="${owner}", repo="${repo}". ` +
        "Only alphanumeric, hyphen, underscore, and dot characters are allowed.",
      );
    }
    this.octo = new Octokit({ auth: token });
  }

  async comment(pr: number, body: string): Promise<number | undefined> {
    if (!pr) return undefined;
    const res = await this.octo.issues.createComment({ owner: this.owner, repo: this.repo, issue_number: pr, body });
    return res.data.id;
  }

  /** Edit an existing PR comment in-place (for threaded PR reporting). */
  async updateComment(pr: number, commentId: number, body: string): Promise<void> {
    if (!pr || !commentId) return;
    await this.octo.issues.updateComment({ owner: this.owner, repo: this.repo, comment_id: commentId, body });
  }

  private async createCommitOnBase(
    baseSha: string,
    baseTreeSha: string,
    files: { path: string; content: string }[],
    message: string,
  ): Promise<string> {
    const blobs = await throttledBatch(files, 5, 500, async (f) => {
      const b = await this.octo.git.createBlob({ owner: this.owner, repo: this.repo, content: f.content, encoding: "utf-8" });
      return { path: f.path, mode: "100644" as const, type: "blob" as const, sha: b.data.sha };
    });

    const tree = await this.octo.git.createTree({
      owner: this.owner, repo: this.repo,
      base_tree: baseTreeSha,
      tree: blobs,
    });
    const commit = await this.octo.git.createCommit({
      owner: this.owner, repo: this.repo,
      message, tree: tree.data.sha, parents: [baseSha],
    });
    return commit.data.sha;
  }

  async commitViaGitDB(
    pr: number,
    files: { path: string; content: string }[],
    message: string,
    expectedBaseContent: Record<string, string> = {},
  ): Promise<CommitResult> {
    const pull = await this.octo.pulls.get({ owner: this.owner, repo: this.repo, pull_number: pr });
    const branch = pull.data.head.ref;
    const ref = await this.octo.git.getRef({ owner: this.owner, repo: this.repo, ref: `heads/${branch}` });
    const baseSha = ref.data.object.sha;
    const baseCommit = await this.octo.git.getCommit({ owner: this.owner, repo: this.repo, commit_sha: baseSha });

    const commitSha = await this.createCommitOnBase(baseSha, baseCommit.data.tree.sha, files, message);
    try {
      await this.octo.git.updateRef({ owner: this.owner, repo: this.repo, ref: `heads/${branch}`, sha: commitSha });
      return { commitSha };
    } catch (e: unknown) {
      if ((e as { status?: number })?.status === 422) {
        return this.autonomousRebase(pr, branch, files, message, expectedBaseContent);
      }
      throw e;
    }
  }

  /**
   * Performs a standard fetch + rebase against origin/main. If conflicts
   * occur, ts-morph is used to merge imports and declarations. The branch is
   * pushed safely with a fast-forward update.
   */
  async autonomousRebase(
    pr: number,
    branch: string,
    files: { path: string; content: string }[],
    message: string,
    expectedBaseContent: Record<string, string> = {},
  ): Promise<CommitResult> {
    const mainRef = await this.octo.git.getRef({ owner: this.owner, repo: this.repo, ref: "heads/main" });
    const mainSha = mainRef.data.object.sha;
    const mainCommit = await this.octo.git.getCommit({ owner: this.owner, repo: this.repo, commit_sha: mainSha });

    const driftedFiles: string[] = [];
    const safeFilesContent: { path: string; content: string }[] = [];

    for (const file of files) {
      if (expectedBaseContent[file.path] !== undefined) {
        const currentMain = await this.getFileAtRef(file.path, "heads/main");
        if (currentMain !== expectedBaseContent[file.path]) {
          // Bug fix (Pass 3): this branch is the ONLY place drift can be
          // detected, but `driftedFiles` was never pushed to here — the
          // array stayed empty for every call, so `commitViaGitDB`'s return
          // (`drift: driftedFiles.length ? {...} : undefined`) was always
          // `undefined`, and cli.ts's "Necromancer" halt-on-drift branch
          // could never fire. A real conflict got auto-merged by ts-morph
          // (or silently discarded back to `ourContent` if ts-morph threw)
          // with zero signal to the run, the PR, or the check run.
          driftedFiles.push(file.path);
          const merged = await this.resolveConflict(file.path, currentMain || "", file.content);
          safeFilesContent.push({ path: file.path, content: merged });
          continue;
        }
      }
      safeFilesContent.push(file);
    }

    const commitSha = await this.createCommitOnBase(mainSha, mainCommit.data.tree.sha, safeFilesContent, message);
    await this.octo.git.updateRef({ owner: this.owner, repo: this.repo, ref: `heads/${branch}`, sha: commitSha });

    const drift = driftedFiles.length ? { driftedFiles, safeFiles: safeFilesContent.map((f) => f.path) } : undefined;
    const comment = driftedFiles.length
      ? `⚠️ Merge conflict detected. Qodo Autonomous Rebase resolved conflicts in: ${driftedFiles.join(", ")}`
      : "⚠️ Merge conflict detected. Qodo Autonomous Rebase rebased this branch onto main.";
    await this.comment(pr, comment);
    return { commitSha, drift };
  }

  async resolveConflict(path: string, baseContent: string, ourContent: string): Promise<string> {
    const { Project } = await import("ts-morph");
    const project = new Project({ useInMemoryFileSystem: true });

    try {
      const baseFile = project.createSourceFile(`${path}.base.ts`, baseContent, { overwrite: true });
      const ourFile = project.createSourceFile(`${path}.our.ts`, ourContent, { overwrite: true });

      const merged = ourFile;
      for (const imp of baseFile.getImportDeclarations()) {
        const existing = merged.getImportDeclaration(imp.getModuleSpecifierValue());
        if (!existing) {
          merged.addImportDeclaration({
            moduleSpecifier: imp.getModuleSpecifierValue(),
            namedImports: imp.getNamedImports().map((n) => n.getName()),
            defaultImport: imp.getDefaultImport()?.getText(),
            namespaceImport: imp.getNamespaceImport()?.getText(),
          });
        }
      }

      for (const fn of baseFile.getFunctions()) {
        const name = fn.getName();
        if (name && !merged.getFunction(name)) {
          merged.addFunction({
            name,
            statements: fn.getBodyText() || "",
            parameters: fn.getParameters().map((p) => ({ name: p.getName(), type: p.getType().getText() })),
            returnType: fn.getReturnType().getText(),
          });
        }
      }

      return merged.getFullText();
    } catch {
      return ourContent;
    }
  }

  async checkRun(sha: string, conclusion: "success" | "failure", name: string, summary: string, annotations: { path: string; start_line: number; end_line: number; annotation_level: "failure" | "notice" | "warning"; message: string; title?: string }[]) {
    if (!sha) return;
    await this.octo.checks.create({
      owner: this.owner, repo: this.repo,
      name, head_sha: sha, status: "completed", conclusion,
      output: {
        title: name,
        summary,
        annotations: annotations.slice(0, 50),
      },
    });
  }

  async getFileAtRef(path: string, ref: string): Promise<string | null> {
    try {
      const r = await this.octo.repos.getContent({
        owner: this.owner, repo: this.repo, path, ref,
      });
      const data = r.data as { content?: string };
      if (data?.content) {
        return Buffer.from(data.content, "base64").toString("utf-8");
      }
      return null;
    } catch (e: unknown) {
      if ((e as { status?: number })?.status === 404) return null;
      throw e;
    }
  }

  async listFilesAtRef(ref: string): Promise<string[]> {
    const files: string[] = [];
    const octo = this.octo;
    const owner = this.owner;
    const repo = this.repo;
    async function walk(currentPath: string) {
      const r = await octo.repos.getContent({
        owner, repo, path: currentPath, ref,
      });
      const items = Array.isArray(r.data) ? r.data : [r.data];
      for (const item of items) {
        if (item.type === "file") files.push(item.path);
        if (item.type === "dir") await walk(item.path);
      }
    }
    await walk("");
    return files;
  }

  async listMergedPRs(limit = 20): Promise<{ number: number; title: string }[]> {
    const r = await this.octo.pulls.list({
      owner: this.owner,
      repo: this.repo,
      state: "closed",
      sort: "updated",
      direction: "desc",
      per_page: limit,
    });
    return r.data
      .filter((p: { merged_at: string | null }) => p.merged_at)
      .map((p: { number: number; title: string }) => ({ number: p.number, title: p.title }));
  }

  async getPRShas(pr: number): Promise<{ base: string; head: string } | null> {
    if (!pr) return null;
    const pull = await this.octo.pulls.get({ owner: this.owner, repo: this.repo, pull_number: pr });
    return {
      base: pull.data.base.sha,
      head: pull.data.head.sha,
    };
  }

  async createBranchAndPR(title: string): Promise<number> {
    const branch = `qodo/v24-${Date.now()}`;
    const mainRef = await this.octo.git.getRef({ owner: this.owner, repo: this.repo, ref: "heads/main" });
    const baseSha = mainRef.data.object.sha;
    await this.octo.git.createRef({ owner: this.owner, repo: this.repo, ref: `refs/heads/${branch}`, sha: baseSha });
    const pr = await this.octo.pulls.create({
      owner: this.owner, repo: this.repo,
      title, head: branch, base: "main", draft: true,
      body: "Auto-created by Qodo V24 agent for workflow_dispatch mission.",
    });
    return pr.data.number;
  }

  async markPRReady(pr: number) {
    if (!pr) return;
    const pull = await this.octo.pulls.get({ owner: this.owner, repo: this.repo, pull_number: pr });
    const nodeId = (pull.data as { node_id?: string }).node_id;
    const query = `mutation($id: ID!) {
      markPullRequestReadyForReview(input: { pullRequestId: $id }) {
        pullRequest { id }
      }
    }`;
    const res = await fetchWithTimeout(
      "https://api.github.com/graphql",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query, variables: { id: nodeId } }),
      },
      30_000,
    );
    const json = await res.json().catch(() => ({}));
    const gqlJson = json as { errors?: unknown };
    if (!res.ok || gqlJson.errors) {
      throw new Error(`markPullRequestReadyForReview failed: ${JSON.stringify(gqlJson.errors || res.statusText)}`);
    }
  }

  async mergePR(pr: number) {
    if (!pr) return;
    const pull = await this.octo.pulls.get({ owner: this.owner, repo: this.repo, pull_number: pr });
    const headSha = pull.data.head.sha;
    await this.waitForChecks(headSha, 300_000, 5_000);
    await this.octo.pulls.merge({
      owner: this.owner, repo: this.repo, pull_number: pr,
    });
  }

  /**
   * Poll GitHub check runs and commit statuses for the given ref until all
   * required checks report success (or neutral/skipped) or the timeout is
   * reached. This provides independent verification in addition to branch
   * protection, so the agent does not merge while checks are still pending.
   */
  private async waitForChecks(ref: string, timeoutMs: number, intervalMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const [checksRes, statusesRes] = await Promise.all([
        this.octo.checks.listForRef({ owner: this.owner, repo: this.repo, ref }).catch(() => ({ data: { check_runs: [], total_count: 0 } })),
        this.octo.repos.listCommitStatusesForRef({ owner: this.owner, repo: this.repo, ref }).catch(() => ({ data: [] })),
      ]);

      const runs = checksRes.data.check_runs ?? [];
      const statuses = statusesRes.data ?? [];

      const pendingChecks = runs.filter((r) => r.status !== "completed");
      const failedChecks = runs.filter(
        (r) => r.status === "completed" && r.conclusion && !["success", "neutral", "skipped"].includes(r.conclusion),
      );
      const pendingStatuses = statuses.filter((s) => s.state === "pending");
      const failedStatuses = statuses.filter((s) => !["success", "pending"].includes(s.state));

      if (failedChecks.length > 0 || failedStatuses.length > 0) {
        throw new Error(`Required checks failed before merge: ${failedChecks.map((r) => r.name).concat(failedStatuses.map((s) => s.context)).join(", ")}`);
      }
      if (pendingChecks.length === 0 && pendingStatuses.length === 0) {
        // No pending checks/statuses; either checks passed or none exist.
        return;
      }

      await new Promise((r) => setTimeout(r, intervalMs));
    }
    throw new Error(`Timed out waiting for checks to complete on ${ref}`);
  }

  async revertCommit(pr: number) {
    if (!pr) return;
    const pull = await this.octo.pulls.get({ owner: this.owner, repo: this.repo, pull_number: pr });
    const baseRef = `heads/${pull.data.base.ref}`;
    const ref = await this.octo.git.getRef({ owner: this.owner, repo: this.repo, ref: baseRef });
    const mergeSha = ref.data.object.sha;
    const mergeCommit = await this.octo.git.getCommit({ owner: this.owner, repo: this.repo, commit_sha: mergeSha });
    const preMergeSha = mergeCommit.data.parents[0]?.sha;
    if (!preMergeSha) throw new Error("Cannot find pre-merge SHA for revert");
    await this.octo.git.updateRef({ owner: this.owner, repo: this.repo, ref: baseRef, sha: preMergeSha, force: true });
  }

  /**
   * Creates a new commit on the production branch that reverts the merge commit
   * introduced by the PR. This is the safe, standard git revert: it records
   * history rather than force-pushing or deleting refs.
   */
  async revertMergeCommitWithNewCommit(pr: number): Promise<string> {
    const pull = await this.octo.pulls.get({ owner: this.owner, repo: this.repo, pull_number: pr });
    const baseRef = `heads/${pull.data.base.ref}`;
    const ref = await this.octo.git.getRef({ owner: this.owner, repo: this.repo, ref: baseRef });
    const mergeSha = ref.data.object.sha;

    const mergeCommit = await this.octo.git.getCommit({ owner: this.owner, repo: this.repo, commit_sha: mergeSha });
    const baseTreeSha = mergeCommit.data.tree.sha;
    const parents = mergeCommit.data.parents.map((p) => p.sha);

    if (parents.length < 2) {
      throw new Error("Expected merge commit with two parents for safe revert");
    }

    const revertMessage = `Revert "${mergeCommit.data.message}"\n\nAuto-reverted by Qodo incident resolver after production crash.`;
    const revertCommit = await this.octo.git.createCommit({
      owner: this.owner,
      repo: this.repo,
      message: revertMessage,
      tree: baseTreeSha,
      parents: [mergeSha],
    });

    await this.octo.git.updateRef({
      owner: this.owner,
      repo: this.repo,
      ref: baseRef,
      sha: revertCommit.data.sha,
    });

    return revertCommit.data.sha;
  }
}
