// W49-d · steem-mesh-bridge · cache.ts vectors — TTL classes, honest staleness, LRU cap.
// Zero network, zero real timers — injected clock drives every expiry.
import { describe, expect, test } from "bun:test";
import { QueryCache, canonicalJSON, ttlForMethod } from "../cache";

describe("canonicalJSON + ttlForMethod", () => {
  test("canonicalJSON is order-stable for object keys", () => {
    expect(canonicalJSON({ b: 2, a: 1 })).toBe(canonicalJSON({ a: 1, b: 2 }));
    expect(canonicalJSON({ a: [3, { z: 1, y: 2 }] })).toBe(canonicalJSON({ a: [3, { y: 2, z: 1 }] }));
  });
  test("TTL classes: dynamic-props 1500ms, get_block 60000ms, default 5000ms", () => {
    expect(ttlForMethod("get_dynamic_global_properties")).toBe(1500);
    expect(ttlForMethod("condenser_api.get_dynamic_global_properties")).toBe(1500);
    expect(ttlForMethod("get_block")).toBe(60000);
    expect(ttlForMethod("condenser_api.get_block")).toBe(60000);
    expect(ttlForMethod("condenser_api.get_accounts")).toBe(5000);
    expect(ttlForMethod("database_api.find_accounts")).toBe(5000);
  });
});

describe("QueryCache", () => {
  test("miss then hit; stats counted honestly", () => {
    const c = new QueryCache({ clock: () => 0 });
    expect(c.get("m", [1]).hit).toBe(false);
    c.set("m", [1], { v: "x" });
    const h = c.get("m", [1]);
    expect(h.hit).toBe(true);
    if (h.hit) expect((h as any).value).toEqual({ v: "x" });
    const s = c.stats();
    expect(s.hits).toBe(1);
    expect(s.misses).toBe(1);
    expect(s.size).toBe(1);
  });

  test("fresh hit inside TTL, expired after TTL (injected clock)", () => {
    let now = 1000;
    const c = new QueryCache({ clock: () => now });
    c.set("get_block", [42], "block-42");
    now = 60_000; // stored 1000, ttl 60000 → fresh until 61000
    expect(c.get("get_block", [42]).hit).toBe(true);
    now = 61_001;
    expect(c.get("get_block", [42]).hit).toBe(false);
  });

  test("short 1500ms class expires fast for dynamic global properties", () => {
    let now = 0;
    const c = new QueryCache({ clock: () => now });
    c.set("condenser_api.get_dynamic_global_properties", [], { head_block_number: 1 });
    now = 1499;
    expect(c.get("condenser_api.get_dynamic_global_properties", []).hit).toBe(true);
    now = 1501;
    expect(c.get("condenser_api.get_dynamic_global_properties", []).hit).toBe(false);
  });

  test("getStale serves expired values with the honest stale flag", () => {
    let now = 0;
    const c = new QueryCache({ clock: () => now });
    c.set("m", ["k"], { r: 7 });
    now = 999_999; // long expired
    expect(c.get("m", ["k"]).hit).toBe(false);
    const stale = c.getStale("m", ["k"]);
    expect(stale.hit).toBe(true);
    if (stale.hit) {
      expect((stale as any).stale).toBe(true);
      expect((stale as any).value).toEqual({ r: 7 });
    }
    expect(c.getStale("m", ["absent"]).hit).toBe(false);
    expect(c.stats().staleHits).toBe(1);
  });

  test("LRU cap evicts least-recently-used and counts evictions", () => {
    let now = 0;
    const c = new QueryCache({ clock: () => now, maxEntries: 2 });
    c.set("m", ["a"], 1);
    c.set("m", ["b"], 2);
    c.get("m", ["a"]); // bump "a" recency
    c.set("m", ["c"], 3); // evicts "b" (LRU)
    expect(c.get("m", ["b"]).hit).toBe(false);
    expect(c.get("m", ["a"]).hit).toBe(true);
    expect(c.get("m", ["c"]).hit).toBe(true);
    expect(c.stats().evictions).toBe(1);
    expect(c.stats().size).toBe(2);
  });

  test("keys are canonical: param key order never splits the cache", () => {
    const c = new QueryCache({ clock: () => 0 });
    c.set("get_accounts", [["alice", "bob"]], "res");
    c.set("m2", { z: 1, a: 2 }, "res2");
    expect(c.get("get_accounts", [["alice", "bob"]]).hit).toBe(true);
    expect(c.get("m2", { a: 2, z: 1 }).hit).toBe(true);
    expect(c.key("m2", { z: 1, a: 2 })).toBe(c.key("m2", { a: 2, z: 1 }));
  });

  test("distinct methods/params never collide", () => {
    const c = new QueryCache({ clock: () => 0 });
    c.set("a", [1], "ra");
    c.set("b", [1], "rb");
    expect((c.get("a", [1]) as any).value).toBe("ra");
    expect((c.get("b", [1]) as any).value).toBe("rb");
  });
});
