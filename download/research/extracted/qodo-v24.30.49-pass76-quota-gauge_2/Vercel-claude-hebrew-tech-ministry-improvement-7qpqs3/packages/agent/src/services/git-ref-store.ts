/**
 * git-ref-store.ts — cross-tick durability for the sovereign resume queue,
 * using a dedicated Git ref as the sole backend (ADR-005, sovereign Step 2).
 *
 * The drain runs every 2 minutes in an EPHEMERAL GitHub Actions runner, so a
 * plain FileDurableStore starts empty each tick. This makes the queue durable
 * BETWEEN ticks with no external service: the queue state lives in an orphan
 * Git ref (default `refs/qodo/trigger-queue`) — the same GitHub we already
 * depend on, and strictly more auditable than opaque Redis (every enqueue,
 * dispatch, and reap is a commit).
 *
 * Transaction model:
 *   1. syncDown(ref) → materialize the ref into a FileDurableStore working copy.
 *   2. run the drain (reap + pop + dispatch) against that working copy.
 *   3. commitAndPush(ref) → the push IS the compare-and-swap. A non-fast-forward
 *      rejection means another writer (a producer enqueue, or — impossibly, given
 *      the workflow's single-consumer concurrency group — a second drainer)
 *      moved the ref. On conflict we do NOT force: we return "conflict" and let
 *      the next tick reconcile. Any dispatch that already fired is safe to repeat
 *      because the resumed pipeline is idempotent behind its run lock (the
 *      webhook receiver documents the same guarantee).
 *
 * The Git plumbing is behind a `GitRunner` seam so the whole thing is unit-
 * tested against a real local bare repo — no network, no GitHub — in
 * git-ref-store.test.ts.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { FileDurableStore } from "./sovereign-store.js";

export const DEFAULT_QUEUE_REF = "refs/qodo/trigger-queue";

export type PushResult = "pushed" | "nochange" | "conflict";

/** The narrow Git surface the ref-queue needs. Mockable; see CliGitRunner. */
export interface GitRunner {
  /** Make the working dir a repo wired to the backend (idempotent). */
  ensure(): void;
  /** Populate the working dir from `ref`; empty if the ref does not exist yet. */
  syncDown(ref: string): void;
  /** Stage all, commit, and push to `ref`. Push rejection → "conflict". */
  commitAndPush(ref: string, message: string): PushResult;
}

/**
 * A Git-ref-backed durable queue working copy. Open it, use `.store` for the
 * whole drain, then `persist()` to commit the result back to the ref.
 */
export class GitRefQueue {
  readonly store: FileDurableStore;

  constructor(
    private readonly dir: string,
    private readonly ref: string,
    private readonly runner: GitRunner,
    now: () => number = Date.now,
  ) {
    this.runner.ensure();
    this.runner.syncDown(ref);
    // The FileDurableStore lives inside the git working tree; a .gitignore keeps
    // its transient lock/temp files out of commits.
    writeFileSync(join(dir, ".gitignore"), ".lock/\n*.tmp.*\n*.expired\n*.gc\n");
    this.store = new FileDurableStore(dir, now);
  }

  /** Commit the current queue state back to the ref. */
  persist(message: string): PushResult {
    return this.runner.commitAndPush(this.ref, message);
  }
}

// ── Concrete Git CLI runner ──────────────────────────────────────────────────

export interface CliGitRunnerOptions {
  /** Working directory (its own git repo, distinct from the code checkout). */
  dir: string;
  /** Remote the ref lives on, e.g. https://github.com/owner/repo.git or a path. */
  remoteUrl: string;
  /** Optional `Authorization` header value for HTTPS remotes (keeps the token
   *  out of the remote URL and out of logs). */
  authHeader?: string;
  identity?: { name: string; email: string };
}

/** GitRunner backed by the `git` CLI via child_process (no libraries). */
export class CliGitRunner implements GitRunner {
  private readonly dir: string;
  private readonly remoteUrl: string;
  private readonly authHeader?: string;
  private readonly identity: { name: string; email: string };

  constructor(opts: CliGitRunnerOptions) {
    this.dir = opts.dir;
    this.remoteUrl = opts.remoteUrl;
    this.authHeader = opts.authHeader;
    this.identity = opts.identity ?? { name: "Qodo Drain", email: "qodo-drain@users.noreply.github.com" };
  }

  private git(args: string[], allowFail = false): { code: number; out: string } {
    // Auth (if any) is injected per-invocation as an http.extraheader config, so
    // the token never appears in a stored remote URL or in git's error output.
    const authArgs = this.authHeader
      ? ["-c", `http.extraheader=Authorization: ${this.authHeader}`]
      : [];
    try {
      const out = execFileSync("git", [...authArgs, ...args], {
        cwd: this.dir,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      return { code: 0, out };
    } catch (e: unknown) {
      const err = e as { status?: number; stderr?: Buffer | string; stdout?: Buffer | string };
      if (!allowFail) {
        const msg = String(err.stderr ?? err.stdout ?? "").slice(0, 300);
        throw new Error(`git ${args.join(" ")} failed: ${msg}`);
      }
      return { code: err.status ?? 1, out: String(err.stdout ?? "") + String(err.stderr ?? "") };
    }
  }

  ensure(): void {
    mkdirSync(this.dir, { recursive: true });
    if (!existsSync(join(this.dir, ".git"))) {
      this.git(["init", "-q"]);
      this.git(["remote", "add", "origin", this.remoteUrl]);
    }
    this.git(["config", "user.name", this.identity.name]);
    this.git(["config", "user.email", this.identity.email]);
    // Keep commits self-contained and cheap.
    this.git(["config", "commit.gpgsign", "false"], true);
  }

  syncDown(ref: string): void {
    const fetched = this.git(["fetch", "--depth", "1", "origin", ref], true);
    if (fetched.code === 0) {
      // Materialize the ref's tree into the working directory.
      this.git(["reset", "--hard", "FETCH_HEAD"]);
      this.git(["clean", "-fdx", "-e", ".lock"], true);
    } else {
      // Ref doesn't exist yet → start from an empty queue on an orphan branch.
      this.git(["checkout", "--orphan", "qodo-queue"], true);
      this.git(["reset", "--hard"], true);
    }
  }

  commitAndPush(ref: string, message: string): PushResult {
    this.git(["add", "-A"]);
    const staged = this.git(["diff", "--cached", "--quiet"], true);
    if (staged.code === 0) return "nochange"; // nothing changed
    this.git(["commit", "-q", "-m", message]);
    const pushed = this.git(["push", "origin", `HEAD:${ref}`], true);
    if (pushed.code === 0) return "pushed";
    if (/\b(rejected|non-fast-forward|fetch first|stale info)\b/i.test(pushed.out)) return "conflict";
    throw new Error(`git push failed: ${pushed.out.slice(0, 300)}`);
  }
}

/**
 * Build the HTTPS remote URL + auth header for a GitHub repo from a token,
 * keeping the token out of the URL. Returns null when inputs are incomplete.
 */
export function githubRemote(ownerRepo: string, token: string): { remoteUrl: string; authHeader: string } | null {
  if (!/^[^/\s]+\/[^/\s]+$/.test(ownerRepo) || !token) return null;
  const basic = Buffer.from(`x-access-token:${token}`, "utf8").toString("base64");
  return { remoteUrl: `https://github.com/${ownerRepo}.git`, authHeader: `Basic ${basic}` };
}

/** Remove a working directory tree, ignoring errors (best-effort cleanup). */
export function cleanupDir(dir: string): void {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}
