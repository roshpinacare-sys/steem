import { log } from "./logger.js";
import { RedisState } from "./redis-state.js";
import type { Telemetry } from "./telemetry.js";

// Per-lock entry tracking path, fencing token, and heartbeat interval.
interface LockEntry {
  path: string;
  token: string;
  heartbeat: ReturnType<typeof setInterval>;
}

/**
 * SemanticDagLock acquires fenced file locks across a set of symbol IDs in a
 * deterministically sorted order to prevent distributed deadlocks.  On any
 * failure the class performs a full rollback of all previously acquired locks.
 */
export class SemanticDagLock {
  private readonly state: RedisState;
  private readonly telemetry: Telemetry | undefined;
  private readonly DAG_PREFIX = "dag:";

  constructor(state: RedisState, telemetry?: Telemetry) {
    this.state = state;
    this.telemetry = telemetry;
  }

  /**
   * Acquire fenced locks for every symbolId.
   * IDs are sorted lexicographically before locking to guarantee a
   * consistent global acquisition order and prevent circular waits.
   *
   * @returns Array of LockEntry objects (path + fencing token) on success.
   * @throws  Error if any single lock cannot be acquired within the timeout.
   *          All previously acquired locks are released before throwing.
   */
  async acquireConceptLock(
    symbolIds: string[],
    ttlMs = 30_000,
    timeoutMs = 10_000,
  ): Promise<LockEntry[]> {
    // Deterministic order prevents deadlocks across concurrent agents.
    const sorted = [...symbolIds].sort();
    const acquired: LockEntry[] = [];

    for (const id of sorted) {
      const path = `${this.DAG_PREFIX}${id}`;
      const token = await this.state.waitForFileLock(path, timeoutMs);
      if (token === null) {
        // Rollback all locks acquired so far before surfacing the error.
        await this.releaseAll(acquired);
        const err = `[semantic-dag] Deadlock prevention: could not acquire lock for "${id}" within ${timeoutMs}ms`;
        await this.telemetry?.decision("semantic-dag", "lock-timeout", { symbolId: id, acquired: acquired.map((l) => l.path) });
        throw new Error(err);
      }

      // Heartbeat: renew the lock every ttlMs/3 ms so it never expires while
      // the agent is still holding it (fixes silent concurrent-write bug).
      const heartbeat = setInterval(() => {
        this.state.renewFileLock(path, token, ttlMs).catch((err: unknown) => {
          log.warn('semantic-dag: heartbeat renew failed', { path, error: err instanceof Error ? err.message : String(err) });
        });
      }, Math.floor(ttlMs / 3));

      acquired.push({ path, token, heartbeat });
    }

    await this.telemetry?.decision("semantic-dag", "locks-acquired", {
      count: acquired.length,
      paths: acquired.map((l) => l.path),
    });

    return acquired;
  }

  /**
   * Release every lock in the supplied array using the stored fencing tokens.
   * Heartbeat intervals are cleared first so no renewal fires after release.
   * Failures are swallowed so a partial release never masks the original error.
   */
  async releaseAll(locks: LockEntry[]): Promise<void> {
    // Stop all heartbeats before releasing so no stale renewals fire.
    for (const l of locks) clearInterval(l.heartbeat);

    await Promise.allSettled(
      locks.map((l) => this.state.releaseFileLock(l.path, l.token)),
    );
    await this.telemetry?.decision("semantic-dag", "locks-released", { count: locks.length });
  }
}
