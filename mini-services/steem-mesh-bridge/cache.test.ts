// G71-2c — steem-mesh-bridge · cache.test.ts
// Contract tests for the idempotent-query cache: canonical keys, per-class TTL,
// honest stale flags, volatile methods never cached, deterministic eviction.
import { describe, expect, test } from "bun:test";
import { RpcCache, canonicalKey, methodClass, ttlFor, type GetResult, type TtlTable } from "./cache";

function stepClock(start = 1_000_000, stepMs = 10) {
  let now = start;
  return () => (now += stepMs);
}

/** Narrows the miss branch — a test that expects a hit says so loudly. */
function expectHit(r: GetResult): { value: unknown; stale: boolean; cachedAt: number } {
  if (!r.hit) throw new Error("expected cache hit, got miss");
  return { value: r.value, stale: r.stale, cachedAt: r.cachedAt };
}

const TTLS = { dynamicMs: 100, stableMs: 5_000, defaultMs: 300 };

describe("canonicalKey (cache-key canonicalization)", () => {
  test("object key order does not change the key", () => {
    expect(canonicalKey("m", { b: 1, a: 2 })).toBe(canonicalKey("m", { a: 2, b: 1 }));
  });

  test("nested objects are sorted recursively", () => {
    expect(canonicalKey("m", { o: { z: 1, y: 2 } })).toBe(canonicalKey("m", { o: { y: 2, z: 1 } }));
  });

  test("array order is preserved (order is meaningful)", () => {
    expect(canonicalKey("m", [1, 2])).not.toBe(canonicalKey("m", [2, 1]));
  });

  test("types are distinct: number 1 vs string \"1\"", () => {
    expect(canonicalKey("m", 1)).not.toBe(canonicalKey("m", "1"));
  });

  test("method is part of the key", () => {
    expect(canonicalKey("a", { x: 1 })).not.toBe(canonicalKey("b", { x: 1 }));
  });

  test("missing vs explicit empty params are the same key", () => {
    expect(canonicalKey("m", undefined)).toBe(canonicalKey("m", []));
  });
});

describe("method classification (volatile law)", () => {
  test("broadcast methods are volatile — every naming convention", () => {
    for (const m of [
      "broadcast_block",
      "broadcast_transaction",
      "network_broadcast_api.broadcast_transaction",
      "condenser_api.broadcast_transaction_synchronous",
      "condenser_api.broadcast_block",
      "chain_api.broadcast_transaction",
    ]) {
      expect(methodClass(m)).toBe("volatile");
    }
  });

  test("dynamic reads are classified dynamic", () => {
    for (const m of [
      "condenser_api.get_dynamic_global_properties",
      "condenser_api.get_block",
      "condenser_api.get_account_history",
      "condenser_api.get_order_book",
      "market_history_api.get_ticker",
      "database_api.get_dynamic_global_properties",
    ]) {
      expect(methodClass(m)).toBe("dynamic");
    }
  });

  test("stable chain facts are classified stable", () => {
    for (const m of [
      "condenser_api.get_chain_properties",
      "condenser_api.get_config",
      "condenser_api.get_hardfork_version",
      "condenser_api.get_account_count",
    ]) {
      expect(methodClass(m)).toBe("stable");
    }
  });

  test("account reads are dynamic (balances move every block), slow aggregates stable", () => {
    expect(methodClass("condenser_api.get_account_count")).toBe("stable");
    expect(methodClass("condenser_api.get_accounts")).toBe("dynamic");
  });

  test("everything else falls back to default class", () => {
    expect(methodClass("condenser_api.get_witnesses_by_vote")).toBe("dynamic");
    expect(methodClass("jsonrpc.get_methods")).toBe("default");
  });

  test("ttlFor returns the per-class TTL deterministically", () => {
    expect(ttlFor("condenser_api.get_chain_properties", TTLS)).toBe(5_000);
    expect(ttlFor("condenser_api.get_dynamic_global_properties", TTLS)).toBe(100);
    expect(ttlFor("condenser_api.get_accounts", TTLS)).toBe(100);
    expect(ttlFor("condenser_api.get_account_count", TTLS)).toBe(5_000);
    expect(ttlFor("jsonrpc.get_methods", TTLS)).toBe(300);
  });
});

describe("RpcCache", () => {
  test("fresh hit within TTL; stale:false", () => {
    const c = new RpcCache({ clock: stepClock(), ttls: TTLS });
    c.set("condenser_api.get_account_count", [], 12345);
    const got = expectHit(c.get("condenser_api.get_account_count", []));
    expect(got).toEqual({ value: 12345, stale: false, cachedAt: expect.any(Number) });
  });

  test("expired-but-held value serves with honest stale:true", () => {
    const clock = stepClock();
    const c = new RpcCache({ clock, ttls: { dynamicMs: 50, stableMs: 5_000, defaultMs: 300 } });
    c.set("condenser_api.get_dynamic_global_properties", [], { head_block_number: 1 });
    clock(); // +10ms
    expect(expectHit(c.get("condenser_api.get_dynamic_global_properties", [])).stale).toBe(false);
    for (let i = 0; i < 6; i++) clock(); // +60ms → past the 50ms dynamic TTL
    const got = expectHit(c.get("condenser_api.get_dynamic_global_properties", []));
    expect(got.stale).toBe(true);
    expect(got.value).toEqual({ head_block_number: 1 });
  });

  test("absent key is a miss with counters", () => {
    const c = new RpcCache({ clock: stepClock(), ttls: TTLS });
    expect(c.get("condenser_api.get_accounts", ["ghost"]).hit).toBe(false);
    const s = c.stats();
    expect(s.misses).toBe(1);
    expect(s.hits).toBe(0);
  });

  test("volatile methods are NEVER cached (fail-closed idempotence law)", () => {
    const c = new RpcCache({ clock: stepClock(), ttls: TTLS });
    expect(c.set("condenser_api.broadcast_transaction", [{}], { ok: true })).toBe(false);
    expect(c.get("condenser_api.broadcast_transaction", [{}]).hit).toBe(false);
    expect(c.stats().entries).toBe(0);
    expect(c.stats().volatileRejects).toBe(1);
  });

  test("hit/stale counters are measured honestly", () => {
    const clock = stepClock();
    const c = new RpcCache({ clock, ttls: { dynamicMs: 20, stableMs: 5_000, defaultMs: 300 } });
    c.set("condenser_api.get_dynamic_global_properties", [], { h: 1 });
    c.get("condenser_api.get_dynamic_global_properties", []); // fresh hit
    for (let i = 0; i < 4; i++) clock(); // +40ms
    c.get("condenser_api.get_dynamic_global_properties", []); // stale hit
    const s = c.stats();
    expect(s.hits).toBe(1);
    expect(s.staleServes).toBe(1);
  });

  test("deterministic eviction under cap: expired first, then oldest expiry/key", () => {
    const clock = stepClock();
    const c = new RpcCache({
      clock,
      ttls: { dynamicMs: 100, stableMs: 100, defaultMs: 100 },
      maxEntries: 2,
    });
    c.set("m1", [], "a");
    c.set("m2", [], "b");
    c.set("m3", [], "c"); // cap exceeded → m1 evicted (same ttl → oldest cachedAt, key tiebreak)
    expect(c.stats().evictions).toBe(1);
    expect(c.get("m1", []).hit).toBe(false);
    expect(c.get("m2", []).hit).toBe(true);
    expect(c.get("m3", []).hit).toBe(true);
  });

  test("different params are different entries", () => {
    const c = new RpcCache({ clock: stepClock(), ttls: TTLS });
    c.set("condenser_api.get_block", [1], { id: "b1" });
    c.set("condenser_api.get_block", [2], { id: "b2" });
    expect(c.get("condenser_api.get_block", [1]).hit).toBe(true);
    expect(c.get("condenser_api.get_block", [2]).hit).toBe(true);
    expect(c.stats().entries).toBe(2);
  });
});
