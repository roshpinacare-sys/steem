/**
 * in-memory-adapters.ts — sovereign, zero-network stand-ins for the three
 * external services the pipeline depends on: Upstash Redis (state), R2 (blob
 * storage), and GitHub (the repo API). They subclass the REAL classes and
 * override only the I/O surface, so the pipeline exercises its genuine code
 * paths — checkpoints, telemetry, trust ledger, audit, the 5 gates — against
 * an in-process backing store instead of the network.
 *
 * This is the substrate for `--eval`: the premium, fully-local evaluation
 * mode. Nothing here reaches out; everything is observable afterwards through
 * the same objects the report reads.
 *
 * (These began life as the `Fake*` classes in tests/e2e/local-simulator.test.ts
 * and are promoted here so both the e2e test and the shipped `--eval` command
 * share one honest, maintained implementation.)
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RedisState, type RedisEnv } from "../redis-state.js";
import { R2Storage } from "../r2-storage.js";
import { GitHubClient } from "../github-client.js";

// ---------------------------------------------------------------------------
// State — in-memory key/value + list model
// ---------------------------------------------------------------------------

/** In-memory RedisState: a Map-backed KV store plus a list model, with the
 *  lock always acquirable (single local runner). TTLs are ignored — a local
 *  eval run is short-lived and single-process. */
export class LocalRedisState extends RedisState {
  private kv = new Map<string, string>();
  private lists = new Map<string, string[]>();

  // Pass an env with NO Redis URLs so every inherited method that isn't
  // overridden below (acquireFileLock, waitForFileLock, publish, brpop, …)
  // takes its built-in "Redis not configured" no-op path instead of dialling
  // the network. The overrides below back the KV/list surface with Maps.
  constructor() { super({} as RedisEnv); }

  override async acquireLock(): Promise<boolean> { return true; }
  override async releaseLock(): Promise<void> {}

  override async get(key: string): Promise<string | null> {
    return this.kv.get(key) ?? null;
  }
  override async set(key: string, value: string): Promise<void> {
    this.kv.set(key, value);
  }
  override async setWithTTL(key: string, value: string): Promise<void> {
    this.kv.set(key, value);
  }
  override async delete(key: string): Promise<void> {
    this.kv.delete(key);
    this.lists.delete(key);
  }
  override async exists(key: string): Promise<boolean> {
    return this.kv.has(key) || this.lists.has(key);
  }

  override async pushEvent(listKey: string, event: Record<string, unknown>): Promise<void> {
    const arr = this.lists.get(listKey) ?? [];
    arr.unshift(JSON.stringify(event));
    if (arr.length > 10000) arr.length = 10000;
    this.lists.set(listKey, arr);
  }
  override async lpush(key: string, value: string): Promise<void> {
    const arr = this.lists.get(key) ?? [];
    arr.unshift(value);
    this.lists.set(key, arr);
  }
  override async rpop(key: string): Promise<string | null> {
    const arr = this.lists.get(key);
    return arr && arr.length ? arr.pop()! : null;
  }
  override async lrange(key: string, start: number, stop: number): Promise<string[]> {
    const arr = this.lists.get(key) ?? [];
    const end = stop < 0 ? arr.length + stop + 1 : stop + 1;
    return arr.slice(start, end);
  }
  override async llen(key: string): Promise<number> {
    return this.lists.get(key)?.length ?? 0;
  }
  override async ltrim(key: string, start: number, stop: number): Promise<void> {
    const arr = this.lists.get(key);
    if (!arr) return;
    const end = stop < 0 ? arr.length + stop + 1 : stop + 1;
    this.lists.set(key, arr.slice(start, end));
  }

  /** Read a telemetry/event list back as parsed objects (newest first). */
  readEvents(listKey = "qodo:v24:telemetry:events"): Record<string, unknown>[] {
    return (this.lists.get(listKey) ?? [])
      .map((s) => {
        try { return JSON.parse(s) as Record<string, unknown>; } catch { return null; }
      })
      .filter((x): x is Record<string, unknown> => x !== null);
  }
}

// ---------------------------------------------------------------------------
// Storage — in-memory blob store
// ---------------------------------------------------------------------------

/** In-memory R2Storage: never degraded, never on the network. */
export class LocalR2Storage extends R2Storage {
  private store = new Map<string, string>();
  override async putText(key: string, body: string): Promise<void> { this.store.set(key, body); }
  override async getText(key: string): Promise<string> { return this.store.get(key) ?? ""; }
  override isDegraded(): boolean { return false; }
}

// ---------------------------------------------------------------------------
// GitHub — in-memory repo API
// ---------------------------------------------------------------------------

export interface RecordedCheckRun {
  sha: string;
  conclusion: "success" | "failure";
  name: string;
  summary: string;
}

/**
 * In-memory GitHubClient. Serves the owner's real on-disk `.qodo/policy.*`
 * from `policyDir` (so the sovereign control layer genuinely governs the eval
 * run — exactly as it would from trunk in production), returns empty content
 * for every other file, and records the mutating calls (comments, commit,
 * merge, check runs) so the evaluation report can prove what the pipeline did.
 */
export class LocalGitHubClient extends GitHubClient {
  comments: string[] = [];
  checkRuns: RecordedCheckRun[] = [];
  committed: { files: { path: string; content: string }[]; message: string }[] = [];
  merged = false;
  reverted = false;
  markedReady = false;

  constructor(owner: string, repo: string, private policyDir: string = process.cwd()) {
    super("", owner, repo);
  }

  override async getPRShas(_pr?: number): Promise<{ base: string; head: string }> {
    return { base: "base-sha", head: "head-sha" };
  }

  override async getFileAtRef(path: string, _ref?: string): Promise<string> {
    // Serve the owner's committed policy from disk so `.qodo/policy.yml`
    // governs the run just like it would when read from the repo's trunk.
    if (path.startsWith(".qodo/policy.")) {
      try { return readFileSync(join(this.policyDir, path), "utf8"); } catch { return ""; }
    }
    // Serve a canonical, identical lockfile at every ref so the REAL
    // lockfile-guardian gate parses and diffs it (finding no major bumps and
    // passing) instead of failing on a missing file — the gate genuinely runs.
    if (path === "package-lock.json") {
      return JSON.stringify({ name: this.repoName(), lockfileVersion: 3, packages: {} });
    }
    return "";
  }

  private repoName(): string { return "sovereign-eval"; }

  override async listFilesAtRef(_ref?: string): Promise<string[]> { return []; }

  override async comment(_pr: number, body: string): Promise<number | undefined> {
    this.comments.push(body);
    return undefined;
  }

  override async checkRun(
    sha: string,
    conclusion: "success" | "failure",
    name: string,
    summary: string,
  ): Promise<void> {
    this.checkRuns.push({ sha, conclusion, name, summary });
  }

  override async commitViaGitDB(
    _pr: number,
    files: { path: string; content: string }[],
    message: string,
    _expected?: Record<string, string>,
  ): Promise<{ commitSha: string }> {
    this.committed.push({ files, message });
    return { commitSha: `local-commit-${this.committed.length}` };
  }

  override async createBranchAndPR(_title?: string): Promise<number> { return 1; }
  override async markPRReady(_pr?: number): Promise<void> { this.markedReady = true; }
  override async mergePR(_pr?: number): Promise<void> { this.merged = true; }
  override async revertCommit(_pr?: number): Promise<void> { this.reverted = true; }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export interface LocalDeps {
  state: LocalRedisState;
  storage: LocalR2Storage;
  gh: LocalGitHubClient;
}

/** Build a complete set of sovereign, in-memory pipeline dependencies. */
export function createLocalDeps(owner: string, repo: string, policyDir: string = process.cwd()): LocalDeps {
  return {
    state: new LocalRedisState(),
    storage: new LocalR2Storage(),
    gh: new LocalGitHubClient(owner, repo, policyDir),
  };
}
