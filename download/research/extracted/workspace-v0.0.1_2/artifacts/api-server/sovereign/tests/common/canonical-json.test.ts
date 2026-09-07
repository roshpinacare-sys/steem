import "../_flush.mjs";
/**
 * tests/common/canonical-json.test.ts — hardening test for canonicalJson utility.
 *
 * Covers:
 *   • deterministic output (same input → same string)
 *   • key sorting (objects with different insertion order collapse to same string)
 *   • nested objects and arrays
 *   • BigInt → decimal string
 *   • null preservation
 *   • cyclic reference handling (drops cycle, does not throw)
 *   • empty object/array
 */

import { test, eq, assert } from "../_harness.mjs";
import { canonicalJson } from "../../lib/common/canonical-json.ts";

test("canonicalJson is deterministic for identical objects", () => {
  const a = canonicalJson({ b: 2, a: 1 });
  const b = canonicalJson({ a: 1, b: 2 });
  eq(a, b);
});

test("canonicalJson sorts keys recursively", () => {
  const input = { z: { b: 1, a: 2 }, y: 3 };
  const out = canonicalJson(input);
  eq(out, '{"y":3,"z":{"a":2,"b":1}}');
});

test("canonicalJson preserves arrays in order", () => {
  const input = { items: [3, 1, 2] };
  eq(canonicalJson(input), '{"items":[3,1,2]}');
});

test("canonicalJson converts BigInt to string", () => {
  const input = { amount: 9007199254740993n };
  eq(canonicalJson(input), '{"amount":"9007199254740993"}');
});

test("canonicalJson preserves null", () => {
  const input = { a: null, b: 1 };
  eq(canonicalJson(input), '{"a":null,"b":1}');
});

test("canonicalJson handles empty structures", () => {
  eq(canonicalJson({}), '{}');
  eq(canonicalJson([]), '[]');
});

test("canonicalJson drops cyclic references without throwing", () => {
  const obj: Record<string, unknown> = { a: 1 };
  obj.self = obj;
  const out = canonicalJson(obj);
  // JSON.stringify omits keys whose value is undefined, so the cyclic key disappears.
  eq(out, '{"a":1}');
});

test("canonicalJson output is stable across repeated calls", () => {
  const input = { nested: { deep: { value: 42 } }, list: [1, 2] };
  const first = canonicalJson(input);
  const second = canonicalJson(input);
  eq(first, second);
  assert(first.includes('"nested"'));
  assert(first.includes('"list"'));
});

// ── efficiency/direct-serialise ────────────────────────────────────────────
// These tests verify correctness is preserved after canonicalSort (which built
// an intermediate object tree before calling JSON.stringify) was replaced by
// canonicalSerialise (which writes the output string directly, eliminating
// O(nodes) intermediate {} allocations on deeply-nested proof payloads).

test("efficiency/direct-serialise: undefined values are dropped without intermediate object", () => {
  // Keys whose value is undefined must be omitted — identical to JSON.stringify behaviour.
  // In the old implementation this fell out of JSON.stringify(undefined) → undefined →
  // key dropped by outer JSON.stringify. The new implementation must drop them explicitly.
  const input = { a: 1, b: undefined, c: 3 };
  eq(canonicalJson(input), '{"a":1,"c":3}');
});

test("efficiency/direct-serialise: deeply-nested objects produce correct sorted output", () => {
  // Regression for the direct-serialise path: proves each layer sorts its own
  // keys without relying on an accumulator object (which used to carry the sort).
  const input = {
    z: { zz: { b: 2, a: 1 }, ya: 0 },
    a: { m: [3, { q: 9, p: 8 }], b: null },
  };
  const out = canonicalJson(input);
  // Expected: top-level keys a < z; within each level, keys sorted recursively.
  eq(out, '{"a":{"b":null,"m":[3,{"p":8,"q":9}]},"z":{"ya":0,"zz":{"a":1,"b":2}}}');
});

test("efficiency/direct-serialise: cyclic ref in array slot serialises as null (not throw)", () => {
  // In a plain object, a cyclic key is dropped. In an array, JSON.stringify
  // serialises undefined slots as "null"; the direct-serialise path must match.
  const arr: unknown[] = [1, 2, 3];
  arr.push(arr); // arr[3] is cyclic
  const out = canonicalJson(arr);
  eq(out, "[1,2,3,null]");
});
