// G71-2c — steem-mesh-bridge · receipts.test.ts
// Contract tests for the sha256 hash-linked receipt chain (prevHash→hash),
// canonical JSON hashing, and tamper-evidence.
import { describe, expect, test } from "bun:test";
import { GENESIS, ReceiptChain, canonicalJson, verifyChain, type Receipt } from "./receipts";

function fixedClock(start = 1_000_000, stepMs = 1) {
  let now = start;
  return () => (now += stepMs);
}

/** Narrows the undefined-index branch of noUncheckedIndexedAccess. */
function at(rs: Receipt[], i: number): Receipt {
  const r = rs[i];
  if (!r) throw new Error("missing receipt at " + i);
  return r;
}

describe("canonicalJson", () => {
  test("object keys are sorted recursively", () => {
    expect(canonicalJson({ b: 1, a: { z: 1, y: 2 } })).toBe('{"a":{"y":2,"z":1},"b":1}');
  });

  test("array order is preserved", () => {
    expect(canonicalJson([2, 1])).toBe("[2,1]");
  });

  test("types are distinct", () => {
    expect(canonicalJson(1)).not.toBe(canonicalJson("1"));
  });
});

describe("ReceiptChain", () => {
  test("appends hash-linked receipts with genesis prevHash and increasing seq", () => {
    const chain = new ReceiptChain({ clock: fixedClock() });
    const r1 = chain.append("node_chosen", { url: "https://a.test" });
    const r2 = chain.append("cache_hit", { key: "k" });
    expect(r1.seq).toBe(1);
    expect(r1.prevHash).toBe(GENESIS);
    expect(r2.seq).toBe(2);
    expect(r2.prevHash).toBe(r1.hash);
    expect(r2.hash).not.toBe(r1.hash);
  });

  test("hash is sha256 over prev|seq|at|kind|payload (recomputed independently)", () => {
    const chain = new ReceiptChain({ clock: fixedClock() });
    const r = chain.append("failover", { from: "a", to: "b" });
    // recompute with a second identical chain → identical hash (deterministic)
    const chain2 = new ReceiptChain({ clock: fixedClock() });
    const r2 = chain2.append("failover", { from: "a", to: "b" });
    expect(r2.hash).toBe(r.hash);
  });

  test("payload key order does not change the hash (canonical)", () => {
    const c1 = new ReceiptChain({ clock: fixedClock() });
    const c2 = new ReceiptChain({ clock: fixedClock() });
    const h1 = c1.append("request", { b: 1, a: 2 }).hash;
    const h2 = c2.append("request", { a: 2, b: 1 }).hash;
    expect(h1).toBe(h2);
  });

  test("verify() passes on an intact chain", () => {
    const chain = new ReceiptChain({ clock: fixedClock() });
    chain.append("request", {});
    chain.append("cache_hit", {});
    chain.append("upstream_ok", {});
    expect(chain.verify()).toEqual({ ok: true });
  });

  test("tampered payload breaks verification at the exact seq", () => {
    const chain = new ReceiptChain({ clock: fixedClock() });
    chain.append("request", { n: 1 });
    chain.append("cache_hit", { n: 2 });
    chain.append("upstream_ok", { n: 3 });
    const exported = chain.exportAll();
    (at(exported, 1).payload as { n: number }).n = 999; // tamper
    const verdict = verifyChain(exported);
    expect(verdict.ok).toBe(false);
    expect(verdict.brokenAt).toBe(2);
  });

  test("tampered hash breaks verification at the exact seq", () => {
    const chain = new ReceiptChain({ clock: fixedClock() });
    chain.append("request", {});
    chain.append("cache_hit", {});
    const exported = chain.exportAll();
    at(exported, 0).hash = "f".repeat(64);
    const verdict = verifyChain(exported);
    expect(verdict.ok).toBe(false);
    expect(verdict.brokenAt).toBe(1);
  });

  test("broken linkage (prevHash rewrite) breaks verification", () => {
    const chain = new ReceiptChain({ clock: fixedClock() });
    chain.append("request", {});
    chain.append("cache_hit", {});
    const exported = chain.exportAll();
    at(exported, 1).prevHash = GENESIS; // pretend it is the genesis receipt
    expect(verifyChain(exported).ok).toBe(false);
  });

  test("head() exposes the honest chain head; recent(n) returns copies", () => {
    const chain = new ReceiptChain({ clock: fixedClock() });
    chain.append("request", { i: 1 });
    chain.append("cache_hit", { i: 2 });
    const head = chain.head();
    expect(head.seq).toBe(2);
    const last = chain.recent(1)[0] as Receipt;
    expect(last.kind).toBe("cache_hit");
    last.payload = { mutated: true };
    expect(chain.verify().ok).toBe(true); // internal chain untouched by copies
  });

  test("sink receives JSONL lines; sink failures are counted, never thrown", () => {
    const lines: string[] = [];
    const chain = new ReceiptChain({
      clock: fixedClock(),
      sink: (line) => {
        if (lines.length > 0) throw new Error("disk full");
        lines.push(line);
      },
    });
    chain.append("request", {});
    chain.append("cache_hit", {});
    expect(lines).toHaveLength(1);
    expect(chain.stats().writeFailures).toBe(1);
    expect(chain.verify().ok).toBe(true); // in-memory truth intact
    const parsed = JSON.parse(lines[0] as string);
    expect(parsed.seq).toBe(1);
    expect(parsed.kind).toBe("request");
  });
});
