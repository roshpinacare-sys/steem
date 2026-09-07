/**
 * git-ref-store.test.ts — cross-tick durability of the sovereign queue via a
 * Git ref (Step 2), proven end-to-end against a REAL local bare repository.
 *
 * A bare repo stands in for GitHub: no network, no credentials, just `git`.
 * Two independent GitRefQueue sessions (distinct working dirs, like two drain
 * ticks on ephemeral runners) share state only through the ref — exactly the
 * production topology. If the round-trip works here, the queue is durable
 * across runs with GitHub as the sole backend.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitRefQueue, CliGitRunner, githubRemote, DEFAULT_QUEUE_REF } from "../src/services/git-ref-store.js";
import { StoreTriggerQueue } from "../src/services/trigger-queue.js";

function hasGit(): boolean {
  try { execFileSync("git", ["--version"], { stdio: "ignore" }); return true; } catch { return false; }
}

let root: string;
let origin: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "qodo-gitq-"));
  origin = join(root, "origin.git");
  mkdirSync(origin, { recursive: true });
  execFileSync("git", ["init", "--bare", "-q", origin], { stdio: "ignore" });
});
afterEach(() => { if (root) rmSync(root, { recursive: true, force: true }); });

/** A GitRefQueue session on a fresh working dir, all pointing at `origin`. */
function session(name: string): GitRefQueue {
  const dir = join(root, name);
  const runner = new CliGitRunner({ dir, remoteUrl: origin, identity: { name: "T", email: "t@t" } });
  return new GitRefQueue(dir, DEFAULT_QUEUE_REF, runner);
}

describe.skipIf(!hasGit())("GitRefQueue — durability through a Git ref", () => {
  it("a task enqueued in one session is popped in another (survives a 'restart')", async () => {
    // Producer tick: enqueue and persist to the ref.
    const s1 = session("tick-1");
    const q1 = new StoreTriggerQueue(s1.store);
    const task = await q1.push({ owner: "acme", repo: "api", prNumber: 42, trigger: "webhook:proceed" });
    expect(s1.persist("enqueue")).toBe("pushed");

    // Consumer tick: a brand-new working dir, state only via the ref.
    const s2 = session("tick-2");
    const q2 = new StoreTriggerQueue(s2.store);
    const popped = await q2.pop();
    expect(popped?.taskId).toBe(task.taskId);
    expect(popped?.prNumber).toBe(42);
    expect(s2.persist("pop-into-processing")).toBe("pushed");

    // A third tick sees the item in processing, not the queue (durable move).
    const s3 = session("tick-3");
    const q3 = new StoreTriggerQueue(s3.store);
    expect(await q3.depth()).toEqual({ queued: 0, processing: 1, dead: 0 });
  });

  it("an absent ref yields an empty queue; an unchanged tick persists 'nochange'", async () => {
    // First session materializes the (empty) queue scaffolding into the ref.
    const s1 = session("fresh");
    expect(await new StoreTriggerQueue(s1.store).depth()).toEqual({ queued: 0, processing: 0, dead: 0 });
    expect(s1.persist("scaffold")).toBe("pushed");

    // A later tick that changes nothing has nothing to commit.
    const s2 = session("idle");
    expect(await new StoreTriggerQueue(s2.store).depth()).toEqual({ queued: 0, processing: 0, dead: 0 });
    expect(s2.persist("noop")).toBe("nochange");
  });

  it("a stale writer's push is rejected as a conflict (compare-and-swap)", async () => {
    // Two sessions branch from the same (empty) base.
    const a = session("writer-a");
    const b = session("writer-b");
    const qa = new StoreTriggerQueue(a.store);
    const qb = new StoreTriggerQueue(b.store);
    await qa.push({ owner: "o", repo: "r", trigger: "t1" });
    await qb.push({ owner: "o", repo: "r", trigger: "t2" });

    expect(a.persist("a first")).toBe("pushed");   // creates the ref
    expect(b.persist("b stale")).toBe("conflict");  // ref moved under b

    // The winner's task is what a later tick reads.
    const s = session("reader");
    const popped = await new StoreTriggerQueue(s.store).pop();
    expect(popped?.trigger).toBe("t1");
  });
});

describe("githubRemote", () => {
  it("builds an HTTPS remote + Basic auth header, token kept out of the URL", () => {
    const r = githubRemote("acme/api", "ghs_secret");
    expect(r?.remoteUrl).toBe("https://github.com/acme/api.git");
    expect(r?.authHeader).toMatch(/^Basic /);
    expect(r?.remoteUrl).not.toContain("ghs_secret");
  });

  it("returns null for malformed repo or missing token", () => {
    expect(githubRemote("not-a-repo", "t")).toBeNull();
    expect(githubRemote("acme/api", "")).toBeNull();
  });
});
