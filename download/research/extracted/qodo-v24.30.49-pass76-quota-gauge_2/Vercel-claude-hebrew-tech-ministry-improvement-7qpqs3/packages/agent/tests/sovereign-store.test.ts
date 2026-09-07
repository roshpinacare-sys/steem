/**
 * sovereign-store.test.ts — the filesystem durable store that replaces Redis.
 *
 * Verifies it honours the exact `RedisListOps` contract the trigger queue
 * consumes: Redis list orientation (LPUSH prepends), atomic move-between-lists
 * (LMOVE), targeted removal (LREM), inclusive ranges with negative indices, and
 * a TTL KV that expires on a controllable clock. All on a real temp directory —
 * no mocks, no network, no vendor.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileDurableStore } from "../src/services/sovereign-store.js";

function clock(startMs = 1_000_000) {
  let t = startMs;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

let dir: string;
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "qodo-store-")); });

describe("FileDurableStore — list operations", () => {
  it("lpush prepends (LEFT end) and lrange returns newest-first", async () => {
    const s = new FileDurableStore(dir);
    await s.lpush("k", "a");
    await s.lpush("k", "b");
    await s.lpush("k", "c");
    expect(await s.lrange("k", 0, -1)).toEqual(["c", "b", "a"]);
    expect(await s.llen("k")).toBe(3);
  });

  it("lmove RIGHT→LEFT is FIFO between queue and processing", async () => {
    const s = new FileDurableStore(dir);
    // Producers LPUSH; oldest sits at the RIGHT end.
    await s.lpush("q", "first");
    await s.lpush("q", "second");
    const moved = await s.lmove("q", "p", "RIGHT", "LEFT");
    expect(moved).toBe("first"); // oldest drained first
    expect(await s.lrange("q", 0, -1)).toEqual(["second"]);
    expect(await s.lrange("p", 0, -1)).toEqual(["first"]);
  });

  it("lmove on an empty source returns null and writes nothing", async () => {
    const s = new FileDurableStore(dir);
    expect(await s.lmove("empty", "p", "RIGHT", "LEFT")).toBeNull();
    expect(await s.llen("p")).toBe(0);
  });

  it("lrem removes the matching entry and reports the count", async () => {
    const s = new FileDurableStore(dir);
    await s.lpush("k", "x");
    await s.lpush("k", "dup");
    await s.lpush("k", "dup");
    expect(await s.lrem("k", 1, "dup")).toBe(1); // head→tail, one copy
    expect(await s.lrange("k", 0, -1)).toEqual(["dup", "x"]);
    expect(await s.lrem("k", 0, "dup")).toBe(1); // count 0 = all remaining
    expect(await s.lrange("k", 0, -1)).toEqual(["x"]);
  });

  it("lrange handles inclusive negative indices like Redis", async () => {
    const s = new FileDurableStore(dir);
    for (const v of ["a", "b", "c", "d"]) await s.lpush("k", v); // d,c,b,a
    expect(await s.lrange("k", 0, 1)).toEqual(["d", "c"]);
    expect(await s.lrange("k", -2, -1)).toEqual(["b", "a"]);
    expect(await s.lrange("k", 0, -1)).toEqual(["d", "c", "b", "a"]);
  });

  it("survives a fresh store instance on the same directory (durable)", async () => {
    const a = new FileDurableStore(dir);
    await a.lpush("k", "persisted");
    const b = new FileDurableStore(dir); // simulate a later process
    expect(await b.lrange("k", 0, -1)).toEqual(["persisted"]);
  });
});

describe("FileDurableStore — TTL KV (ack keys)", () => {
  it("setWithTTL then exists is true, and false after expiry", async () => {
    const c = clock();
    const s = new FileDurableStore(dir, c.now);
    await s.setWithTTL("ack:1", String(c.now()), 60);
    expect(await s.exists("ack:1")).toBe(true);
    c.advance(59_000);
    expect(await s.exists("ack:1")).toBe(true);
    c.advance(2_000); // now past the 60s TTL
    expect(await s.exists("ack:1")).toBe(false);
  });

  it("exists is false for a key that was never set", async () => {
    const s = new FileDurableStore(dir);
    expect(await s.exists("nope")).toBe(false);
  });

  it("vacuum prunes expired ack keys", async () => {
    const c = clock();
    const s = new FileDurableStore(dir, c.now);
    await s.setWithTTL("ack:1", "t", 10);
    await s.setWithTTL("ack:2", "t", 10);
    c.advance(11_000);
    expect(await s.vacuum()).toBe(2);
  });
});
