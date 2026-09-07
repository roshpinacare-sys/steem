// Upstash Redis via REST — no client library required.
export interface RedisEnv {
  UPSTASH_REDIS_REST_URLS?: string;
  UPSTASH_REDIS_REST_URL?: string;
  UPSTASH_REDIS_REST_TOKENS?: string;
  UPSTASH_REDIS_REST_TOKEN?: string;
}

function parseTokens(env?: string): string[] {
  if (!env) return [];
  return env.split(",").map((t) => t.trim()).filter(Boolean);
}

function getURLs(env: RedisEnv = process.env as RedisEnv): string[] {
  return (env.UPSTASH_REDIS_REST_URLS || env.UPSTASH_REDIS_REST_URL || "")
    .split(",").map((u) => u.trim()).filter(Boolean);
}

type RedisResponse = { result?: unknown } | null;

export class RedisState {
  private tokenIndex = 0;

  constructor(private env: RedisEnv = process.env as RedisEnv) {}

  /**
   * Rotate both URL and token with the same index. Previously the URL was
   * hardcoded to `urls[0]`, so a second or third Redis endpoint configured
   * via `UPSTASH_REDIS_REST_URLS` was never used.
   */
  private roundRobinToken(): { url: string; token: string } | null {
    const urls = getURLs(this.env);
    const tokens = parseTokens(this.env.UPSTASH_REDIS_REST_TOKENS || this.env.UPSTASH_REDIS_REST_TOKEN);
    if (!urls.length || !tokens.length) return null;
    const index = this.tokenIndex;
    this.tokenIndex++;
    return {
      url: urls[index % urls.length],
      token: tokens[index % tokens.length],
    };
  }

  private async call(cmd: (string | number)[]): Promise<RedisResponse> {
    const endpoint = this.roundRobinToken();
    if (!endpoint) return null;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    try {
      const r = await fetch(`${endpoint.url}/${cmd.map(encodeURIComponent).join("/")}`, {
        headers: { Authorization: `Bearer ${endpoint.token}` },
        signal: controller.signal,
      });
      return await r.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  async acquireLock(key: string, ttlSec = 600): Promise<boolean> {
    // Previously read the bare identifier `URL`, which resolves to the
    // global URL constructor (always truthy) instead of the module-level
    // `URLS` array. That made the "Redis not configured" fast path dead
    // code: call() returns null when unconfigured, so `j.result` threw a
    // TypeError instead of letting the pipeline proceed lock-free.
    if (!getURLs(this.env).length) return true;
    const j = await this.call(["set", "qodo:v24:lock:" + key, "1", "EX", ttlSec, "NX"]);
    return j?.result === "OK";
  }

  /**
   * Renews the TTL on an existing run lock so a long-running pipeline cannot
   * lose its lock to a second dispatch mid-run.
   *
   * Uses an atomic Lua compare-and-extend: only extends the TTL if the lock
   * key still exists (i.e. was not already released or expired). The lock
   * value is "1" — we do not store a fencing token because acquireLock uses
   * SET NX, not SET NX GET, so there is no existing token to compare against.
   * The invariant is: if the key is present the current holder owns it (a
   * second dispatch would have been blocked by the NX guard).
   *
   * Callers should invoke this on a setInterval during the pipeline and clear
   * the interval in a finally block after releaseLock().
   *
   * Returns true if the TTL was successfully extended, false if the key was
   * gone (lock already expired or released).
   */
  async renewLock(key: string, ttlSec = 600): Promise<boolean> {
    if (!getURLs(this.env).length) return true;
    // EXPIRE returns 1 if the key exists and the TTL was set, 0 if not found.
    const j = await this.call(["expire", "qodo:v24:lock:" + key, ttlSec]);
    return j?.result === 1;
  }

  async releaseLock(key: string) { await this.call(["del", "qodo:v24:lock:" + key]); }
  async set(key: string, value: string) { await this.call(["set", key, value]); }
  async setWithTTL(key: string, value: string, ttlSec: number) {
    await this.call(["set", key, value, "EX", ttlSec]);
  }
  async get(key: string): Promise<string | null> {
    const r = await this.call(["get", key]);
    return typeof r?.result === "string" ? r.result : null;
  }
  async setJSON<T>(key: string, value: T, ttlSec?: number): Promise<void> {
    if (ttlSec) {
      await this.setWithTTL(key, JSON.stringify(value), ttlSec);
    } else {
      await this.set(key, JSON.stringify(value));
    }
  }
  async setJSONWithTTL<T>(key: string, value: T, ttlSec: number): Promise<void> {
    await this.setWithTTL(key, JSON.stringify(value), ttlSec);
  }
  async getJSON<T>(key: string): Promise<T | null> {
    const raw = await this.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }
  async delete(key: string): Promise<void> {
    await this.call(["del", key]);
  }
  async pushEvent(listKey: string, event: Record<string, unknown>): Promise<void> {
    const payload = JSON.stringify(event);
    await this.call(["lpush", listKey, payload]);
    await this.call(["ltrim", listKey, 0, 9999]);
  }

  async publish(channel: string, message: string): Promise<void> {
    await this.call(["publish", channel, message]);
  }

  async lpush(key: string, value: string): Promise<void> {
    await this.call(["lpush", key, value]);
  }

  async brpop(key: string, timeoutSec: number): Promise<string | null> {
    const r = await this.call(["brpop", key, timeoutSec]);
    return Array.isArray(r?.result) ? String(r.result[1]) : null;
  }

  async rpop(key: string): Promise<string | null> {
    const r = await this.call(["rpop", key]);
    return typeof r?.result === "string" ? r.result : null;
  }

  async ltrim(key: string, start: number, stop: number): Promise<void> {
    await this.call(["ltrim", key, start, stop]);
  }

  // ── Generic list primitives used by the trigger-queue adapter (ADR-005) ──
  // Thin passthroughs over the same Redis command channel as lpush/brpop/rpop
  // above; kept vendor-neutral so the resume-loop queue works against any
  // Redis-compatible store (Upstash, Valkey, Dragonfly, self-hosted).

  /** Atomically move one element between lists. Returns the moved value or null. */
  async lmove(
    source: string,
    destination: string,
    from: "LEFT" | "RIGHT",
    to: "LEFT" | "RIGHT",
  ): Promise<string | null> {
    const r = await this.call(["lmove", source, destination, from, to]);
    return typeof r?.result === "string" ? r.result : null;
  }

  /** Remove up to `count` copies of `value` from a list. Returns removals. */
  async lrem(key: string, count: number, value: string): Promise<number> {
    const r = await this.call(["lrem", key, count, value]);
    return typeof r?.result === "number" ? r.result : 0;
  }

  /** Return a range of list elements (inclusive). */
  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    const r = await this.call(["lrange", key, start, stop]);
    return Array.isArray(r?.result) ? r.result.map((x) => String(x)) : [];
  }

  /** Length of a list (0 when the key is unset or unconfigured). */
  async llen(key: string): Promise<number> {
    const r = await this.call(["llen", key]);
    return typeof r?.result === "number" ? r.result : 0;
  }

  /** True when the key exists. */
  async exists(key: string): Promise<boolean> {
    const r = await this.call(["exists", key]);
    return r?.result === 1;
  }

  async acquireFileLock(path: string, ttlMs = 60_000): Promise<string | null> {
    const key = `qodo:v24:file-lock:${path}`;
    const token = crypto.randomUUID();
    const acquired = await this.call(["set", key, token, "nx", "px", ttlMs]);
    return acquired?.result === "OK" ? token : null;
  }

  async releaseFileLock(path: string, token: string): Promise<void> {
    const key = `qodo:v24:file-lock:${path}`;
    // Atomic compare-and-delete: only delete if the stored token matches.
    const luaScript =
      "if redis.call('get',KEYS[1])==ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end";
    await this.call(["eval", luaScript, "1", key, token]);
  }

  async renewFileLock(path: string, token: string, ttlMs: number): Promise<boolean> {
    const key = `qodo:v24:file-lock:${path}`;
    // Atomic compare-and-extend: only update TTL if the stored token matches.
    const luaScript =
      "if redis.call('get',KEYS[1])==ARGV[1] then return redis.call('pexpire',KEYS[1],ARGV[2]) else return 0 end";
    const result = await this.call(["eval", luaScript, "1", key, token, ttlMs]);
    return result?.result === 1;
  }

  async waitForFileLock(path: string, timeoutMs = 10_000): Promise<string | null> {
    // Bug fix (Pass 3): every other method in this class treats Redis as
    // configured via getURLs().length, which also honors the plural
    // UPSTASH_REDIS_REST_URLS (multi-instance rotation). This check only
    // looked at the singular UPSTASH_REDIS_REST_URL, so a deployment using
    // only the plural var would silently skip real file-locking here and
    // hand back an unrecorded random token — a fake "lock" nothing else
    // knows about — while acquireLock/renewLock correctly used real Redis.
    if (!getURLs(this.env).length) return crypto.randomUUID();
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const token = await this.acquireFileLock(path);
      if (token !== null) return token;
      await new Promise((r) => setTimeout(r, 250));
    }
    return null;
  }
}
