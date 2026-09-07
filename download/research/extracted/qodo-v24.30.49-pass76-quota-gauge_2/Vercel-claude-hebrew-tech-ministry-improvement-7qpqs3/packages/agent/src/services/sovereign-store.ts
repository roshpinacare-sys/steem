/**
 * sovereign-store.ts — a dependency-free, filesystem-backed implementation of
 * the resume-loop's durable store (ADR-005), replacing Upstash Redis.
 *
 * The resume queue never needed a *database*; it needed exactly two primitives:
 *   1. atomic list operations (push / atomic move-between-lists / remove / range)
 *   2. a durable key with a TTL (the per-task ack)
 * `RedisTriggerQueue` is already written against a narrow 7-method interface
 * (`RedisListOps`), not against Redis — so the sovereign move is simply to
 * implement that same interface over a substrate we already own and cannot
 * lose: the local filesystem (and, one layer up, the Git repository). No vendor,
 * no network, no credentials, no bill.
 *
 * Storage layout under `root`:
 *   root/l/<b64url(key)>   — a JSON array of strings; index 0 is the LEFT end
 *                            (LPUSH prepends), matching Redis list orientation.
 *   root/k/<b64url(key)>   — a JSON `{ v, exp }` KV entry; `exp` is an ms-epoch
 *                            expiry (0 = never), honoured lazily on read.
 *   root/.lock/            — a mkdir-based mutex making each op atomic even
 *                            across concurrent processes (the drain workflow's
 *                            concurrency group already serializes drainers, so
 *                            contention is near-zero; the lock is the belt to
 *                            that suspenders).
 *
 * Every write is a write-to-temp-then-rename, so a crash mid-write can never
 * leave a torn file — the reader sees either the old bytes or the new bytes.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, rmdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * The narrow durable-store contract the trigger queue consumes. Structurally
 * identical to `RedisListOps` in trigger-queue.ts, re-declared here so this
 * module carries no import from the Redis path — the two are wired together
 * only at the call site (the CLI), keeping either swappable.
 */
export interface DurableListOps {
  lpush(key: string, value: string): Promise<void>;
  lmove(source: string, dest: string, from: "LEFT" | "RIGHT", to: "LEFT" | "RIGHT"): Promise<string | null>;
  lrem(key: string, count: number, value: string): Promise<number>;
  lrange(key: string, start: number, stop: number): Promise<string[]>;
  llen(key: string): Promise<number>;
  exists(key: string): Promise<boolean>;
  setWithTTL(key: string, value: string, ttlSec: number): Promise<void>;
}

interface KvEntry {
  v: string;
  /** ms-epoch expiry; 0 means never expires. */
  exp: number;
}

function b64url(key: string): string {
  return Buffer.from(key, "utf8").toString("base64url");
}

/** Inclusive Redis-style range → JS slice, normalizing negative indices. */
function rangeSlice<T>(arr: T[], start: number, stop: number): T[] {
  const n = arr.length;
  if (n === 0) return [];
  let s = start < 0 ? n + start : start;
  let e = stop < 0 ? n + stop : stop;
  if (s < 0) s = 0;
  if (e >= n) e = n - 1;
  if (s > e) return [];
  return arr.slice(s, e + 1);
}

export class FileDurableStore implements DurableListOps {
  private readonly listsDir: string;
  private readonly kvDir: string;
  private readonly lockDir: string;

  constructor(
    private readonly root: string,
    private readonly now: () => number = Date.now,
  ) {
    this.listsDir = join(root, "l");
    this.kvDir = join(root, "k");
    this.lockDir = join(root, ".lock");
    mkdirSync(this.listsDir, { recursive: true });
    mkdirSync(this.kvDir, { recursive: true });
  }

  // ── Atomicity ──────────────────────────────────────────────────────────────

  /** Acquire the mkdir-mutex, run `fn`, always release. Spins briefly on hold. */
  private async withLock<T>(fn: () => T): Promise<T> {
    const deadline = this.now() + 5_000;
    // mkdir is atomic: it throws EEXIST if the lock is already held.
    for (;;) {
      try {
        mkdirSync(this.lockDir);
        break;
      } catch {
        if (this.now() > deadline) {
          // A stale lock (crashed holder) must not wedge the queue forever.
          try { rmdirSync(this.lockDir); } catch { /* raced */ }
          continue;
        }
        await new Promise((r) => setTimeout(r, 15));
      }
    }
    try {
      return fn();
    } finally {
      try { rmdirSync(this.lockDir); } catch { /* already gone */ }
    }
  }

  // ── List file I/O ────────────────────────────────────────────────────────────

  private listPath(key: string): string {
    return join(this.listsDir, b64url(key));
  }

  private readList(key: string): string[] {
    const p = this.listPath(key);
    if (!existsSync(p)) return [];
    try {
      const parsed = JSON.parse(readFileSync(p, "utf8")) as unknown;
      return Array.isArray(parsed) ? parsed.map((x) => String(x)) : [];
    } catch {
      return [];
    }
  }

  private writeList(key: string, arr: string[]): void {
    const p = this.listPath(key);
    const tmp = `${p}.tmp.${Math.random().toString(36).slice(2)}`;
    writeFileSync(tmp, JSON.stringify(arr));
    renameSync(tmp, p); // atomic replace
  }

  // ── DurableListOps ───────────────────────────────────────────────────────────

  async lpush(key: string, value: string): Promise<void> {
    await this.withLock(() => {
      const arr = this.readList(key);
      arr.unshift(value); // LEFT end = index 0
      this.writeList(key, arr);
    });
  }

  async lmove(source: string, dest: string, from: "LEFT" | "RIGHT", to: "LEFT" | "RIGHT"): Promise<string | null> {
    return this.withLock(() => {
      const src = this.readList(source);
      if (src.length === 0) return null;
      const value = from === "LEFT" ? src.shift()! : src.pop()!;
      this.writeList(source, src);
      // Same list moved onto itself: re-read after the source write.
      const dst = source === dest ? this.readList(dest) : this.readList(dest);
      if (to === "LEFT") dst.unshift(value);
      else dst.push(value);
      this.writeList(dest, dst);
      return value;
    });
  }

  async lrem(key: string, count: number, value: string): Promise<number> {
    return this.withLock(() => {
      const arr = this.readList(key);
      let removed = 0;
      let out: string[];
      if (count >= 0) {
        // Head→tail; count 0 means "all".
        const limit = count === 0 ? Infinity : count;
        out = [];
        for (const item of arr) {
          if (item === value && removed < limit) { removed++; continue; }
          out.push(item);
        }
      } else {
        // Tail→head, up to |count| matches.
        const limit = -count;
        out = [];
        for (let i = arr.length - 1; i >= 0; i--) {
          if (arr[i] === value && removed < limit) { removed++; continue; }
          out.unshift(arr[i]);
        }
      }
      if (removed > 0) this.writeList(key, out);
      return removed;
    });
  }

  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    return this.withLock(() => rangeSlice(this.readList(key), start, stop));
  }

  async llen(key: string): Promise<number> {
    return this.withLock(() => this.readList(key).length);
  }

  // ── KV with TTL (the ack keys) ───────────────────────────────────────────────

  private kvPath(key: string): string {
    return join(this.kvDir, b64url(key));
  }

  async setWithTTL(key: string, value: string, ttlSec: number): Promise<void> {
    await this.withLock(() => {
      const entry: KvEntry = { v: value, exp: ttlSec > 0 ? this.now() + ttlSec * 1000 : 0 };
      const p = this.kvPath(key);
      const tmp = `${p}.tmp.${Math.random().toString(36).slice(2)}`;
      writeFileSync(tmp, JSON.stringify(entry));
      renameSync(tmp, p);
    });
  }

  async exists(key: string): Promise<boolean> {
    return this.withLock(() => {
      const p = this.kvPath(key);
      if (!existsSync(p)) return false;
      try {
        const entry = JSON.parse(readFileSync(p, "utf8")) as KvEntry;
        if (entry.exp !== 0 && this.now() > entry.exp) {
          try { renameSync(p, `${p}.expired`); } catch { /* raced */ }
          return false;
        }
        return true;
      } catch {
        return false;
      }
    });
  }

  /**
   * Prune expired KV entries and left-over temp/expired files. Cheap
   * housekeeping the drain can call once per tick; never required for
   * correctness (expiry is honoured lazily on read).
   */
  async vacuum(): Promise<number> {
    return this.withLock(() => {
      let pruned = 0;
      for (const name of readdirSync(this.kvDir)) {
        const p = join(this.kvDir, name);
        if (name.endsWith(".expired") || name.includes(".tmp.")) {
          try { renameSync(p, `${p}.gc`); } catch { /* ignore */ }
          continue;
        }
        try {
          const entry = JSON.parse(readFileSync(p, "utf8")) as KvEntry;
          if (entry.exp !== 0 && this.now() > entry.exp) {
            try { renameSync(p, `${p}.expired`); pruned++; } catch { /* ignore */ }
          }
        } catch { /* skip unreadable */ }
      }
      return pruned;
    });
  }
}
