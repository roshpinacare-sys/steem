// G76-i — steem-mesh-bridge · soldiers.test.ts
// Deterministic contract tests for the multi-soldier parallel voting scheduler:
//   · injected clock + injected sleep (zero real timers, zero Date.now in logic)
//   · seeded jitter (mulberry32 — same seed ⇒ same stagger, byte-stable runs)
//   · per-soldier failure isolation: one soldier's RPC failure never stalls the mesh
//   · per-soldier circuit breaker (CLOSED → OPEN → HALF_OPEN single-probe)
//   · custody-wound registry respected: open wounds are NEVER attempted
//   · honest hash-linked receipts (reuse of the bridge receipt chain)
//
// RED→GREEN law: written before soldiers.ts existed; every test is deterministic
// (fake clock advanced by the injected sleep; no awaits on wall time).
import { describe, expect, test } from "bun:test";
import {
  mulberry32,
  openWounds,
  parseWoundsJsonl,
  runSoldierMesh,
  type Receipt,
  type SoldierMeshConfig,
  type UnitOutcome,
} from "./soldiers";

/* ── deterministic harness ──────────────────────────────────────────────── */

function harness() {
  let now = 1_000_000;
  const clock = () => now;
  // injected sleep: records the requested delay, advances the SAME fake clock
  // the unit/clock see, and yields a macrotask — so an immediately-resolving
  // unit reliably wins the timeout race while a hung unit reliably loses.
  // Deterministic: bun's macrotask FIFO is stable.
  const sleep = (ms: number) => {
    now += Math.max(0, ms);
    return new Promise<void>((resolve) => setTimeout(resolve, 0));
  };
  return { clock, sleep, time: () => now };
}

/** Report receipts are handed out as a bounded array (last 200). */
function recentOf(r: { receipts: { recent: ReturnType<typeof Array.of> | unknown[] } }): Receipt[] {
  return r.receipts.recent as Receipt[];
}

const ok = (): UnitOutcome => ({ ok: true, txids: [] });

/** Unit that fails for the named soldiers (counted per call), ok otherwise. */
function failingFor(failSet: ReadonlySet<string>, error = "rpc boom") {
  const calls: string[] = [];
  const unit = async (soldier: string): Promise<UnitOutcome> => {
    calls.push(soldier);
    if (failSet.has(soldier)) return { ok: false, error };
    return ok();
  };
  return { unit, calls };
}

/* ── roster + basics ────────────────────────────────────────────────────── */

describe("roster + fail-closed validation", () => {
  test("empty roster is refused (fail-closed, no silent empty mesh)", async () => {
    const h = harness();
    expect(
      runSoldierMesh({ soldiers: [], clock: h.clock, sleep: h.sleep, unit: async () => ok() }),
    ).rejects.toThrow(/roster/i);
  });

  test("duplicate roster entries are deduped; attempts happen once per soldier per round", async () => {
    const h = harness();
    const { unit, calls } = failingFor(new Set());
    const r = await runSoldierMesh({
      soldiers: ["tov", "wic", "tov", "wic", "tov"],
      clock: h.clock,
      sleep: h.sleep,
      unit,
    });
    expect(r.soldiers).toHaveLength(2);
    expect(calls.filter((s) => s === "tov")).toHaveLength(1);
    expect(r.counted.attempted).toBe(2);
  });

  test("all-ok run: MESH-OK, every soldier OK, receipt chain verifies", async () => {
    const h = harness();
    const { unit, calls } = failingFor(new Set());
    const r = await runSoldierMesh({
      soldiers: ["cashmachine", "macrame", "wog"],
      clock: h.clock,
      sleep: h.sleep,
      unit,
      rounds: 2,
    });
    expect(r.verdict).toBe("MESH-OK");
    expect(r.soldiers.every((s) => s.verdict === "OK")).toBe(true);
    expect(r.soldiers.every((s) => s.attempts === 2 && s.okCount === 2)).toBe(true);
    expect(calls).toHaveLength(6);
    expect(r.receipts.verify.ok).toBe(true);
    expect(r.receipts.seq).toBeGreaterThan(0);
  });
});

/* ── failure isolation ──────────────────────────────────────────────────── */

describe("per-soldier failure isolation", () => {
  test("one soldier's persistent RPC failure never stalls the mesh", async () => {
    const h = harness();
    const { unit } = failingFor(new Set(["lsa"]));
    const r = await runSoldierMesh({
      soldiers: ["tov", "lsa", "wog"],
      clock: h.clock,
      sleep: h.sleep,
      unit,
      rounds: 3,
    });
    expect(r.verdict).toBe("MESH-PARTIAL");
    const lsa = r.soldiers.find((s) => s.soldier === "lsa");
    const tov = r.soldiers.find((s) => s.soldier === "tov");
    expect(lsa?.verdict).toBe("FAIL");
    expect(lsa?.failCount).toBe(3);
    expect(tov?.verdict).toBe("OK");
    expect(tov?.okCount).toBe(3); // tov completed every round despite lsa failing
    expect(r.receipts.verify.ok).toBe(true);
  });

  test("unit that THROWS is isolated, sanitized into the receipt, never rejects the run", async () => {
    const h = harness();
    const unit = async (soldier: string): Promise<UnitOutcome> => {
      if (soldier === "siq") throw new Error("ECONNRESET at https://api.internal.example x".repeat(30));
      return ok();
    };
    const r = await runSoldierMesh({
      soldiers: ["siq", "wic"],
      clock: h.clock,
      sleep: h.sleep,
      unit,
    });
    expect(r.verdict).toBe("MESH-PARTIAL");
    const siq = r.soldiers.find((s) => s.soldier === "siq");
    expect(siq?.verdict).toBe("FAIL");
    expect((siq?.error ?? "").length).toBeLessThanOrEqual(200);
    // the long error must be sliced, never thrown out of the scheduler
    const r2 = await runSoldierMesh({
      soldiers: ["siq"],
      clock: h.clock,
      sleep: h.sleep,
      unit,
    });
    expect(r2.verdict).toBe("MESH-FAILED");
    expect(r2.receipts.verify.ok).toBe(true);
  });

  test("all attempted soldiers failing ⇒ MESH-FAILED (honest, not partial)", async () => {
    const h = harness();
    const r = await runSoldierMesh({
      soldiers: ["haran", "lsa"],
      clock: h.clock,
      sleep: h.sleep,
      unit: async () => ({ ok: false, error: "node down" }),
    });
    expect(r.verdict).toBe("MESH-FAILED");
    expect(r.counted.fail).toBe(2);
    expect(r.counted.ok).toBe(0);
  });

  test("unit skip verdicts are verdicts-not-errors: MESH-IDLE when nothing is due", async () => {
    const h = harness();
    const r = await runSoldierMesh({
      soldiers: ["tov", "wic"],
      clock: h.clock,
      sleep: h.sleep,
      unit: async () => ({ ok: false, skipped: "no-task" }),
    });
    expect(r.verdict).toBe("MESH-IDLE");
    expect(r.soldiers.every((s) => s.verdict === "SKIP-TASK")).toBe(true);
    expect(r.counted.fail).toBe(0);
  });
});

/* ── custody-wound registry ─────────────────────────────────────────────── */

describe("custody-wound registry (owner-only heal, never attempted)", () => {
  test("open wounds are skipped BEFORE any unit call, receipted, and never attempted", async () => {
    const h = harness();
    const { unit, calls } = failingFor(new Set());
    const r = await runSoldierMesh({
      soldiers: ["haran", "lsa", "siq", "tov"],
      clock: h.clock,
      sleep: h.sleep,
      unit,
      wounds: [
        { soldier: "haran", schema: "custody-wound/1" },
        { soldier: "lsa", schema: "custody-wound/1" },
        { soldier: "siq", schema: "custody-wound/1" },
      ],
      woundsSource: "vaults/steem-secrets/CUSTODY-WOUNDS.jsonl",
    });
    expect(r.verdict).toBe("MESH-OK"); // the eligible mesh (tov) is healthy
    expect(calls).toEqual(["tov"]); // the three wounds were NEVER called
    expect(r.soldiers.find((s) => s.soldier === "haran")?.verdict).toBe("SKIP-CUSTODY-WOUND");
    expect(r.soldiers.find((s) => s.soldier === "haran")?.attempts).toBe(0);
    expect(r.counted.woundSkipped).toBe(3);
    expect(r.woundsSource).toBe("vaults/steem-secrets/CUSTODY-WOUNDS.jsonl");
    expect(r.receipts.verify.ok).toBe(true);
  });

  test("every soldier wounded ⇒ MESH-BLOCKED-CUSTODY with zero attempts (fail-honest)", async () => {
    const h = harness();
    const { unit, calls } = failingFor(new Set());
    const r = await runSoldierMesh({
      soldiers: ["haran", "lsa", "siq"],
      clock: h.clock,
      sleep: h.sleep,
      unit,
      wounds: [{ soldier: "haran" }, { soldier: "lsa" }, { soldier: "siq" }],
    });
    expect(r.verdict).toBe("MESH-BLOCKED-CUSTODY");
    expect(calls).toHaveLength(0);
    expect(r.counted.attempted).toBe(0);
  });

  test("healed wounds are not wounds: the soldier is eligible again", async () => {
    const h = harness();
    const { unit, calls } = failingFor(new Set());
    const r = await runSoldierMesh({
      soldiers: ["haran"],
      clock: h.clock,
      sleep: h.sleep,
      unit,
      wounds: [{ soldier: "haran", status: "healed" }],
    });
    expect(r.verdict).toBe("MESH-OK");
    expect(calls).toEqual(["haran"]);
    expect(r.counted.woundSkipped).toBe(0);
  });
});

/* ── per-soldier breaker ────────────────────────────────────────────────── */

describe("per-soldier circuit breaker", () => {
  test("consecutive failures trip OPEN per soldier; others unaffected; OPEN skips later rounds", async () => {
    const h = harness();
    const { unit, calls } = failingFor(new Set(["siq"]));
    const r = await runSoldierMesh({
      soldiers: ["siq", "wic"],
      clock: h.clock,
      sleep: h.sleep,
      unit,
      rounds: 5,
      // cooldown far exceeds anything the shared fake clock can advance during
      // this run (other soldiers' timeout timers advance it) — the soldier must
      // stay OPEN for the rest of the run, deterministically
      breaker: { failureThreshold: 2, cooldownMs: 1_000_000 },
    });
    const siq = r.soldiers.find((s) => s.soldier === "siq");
    const wic = r.soldiers.find((s) => s.soldier === "wic");
    expect(siq?.failCount).toBe(2); // tripped after 2 consecutive failures
    expect(siq?.skipBreakerCount).toBe(3); // rounds 3..5 skipped while OPEN
    expect(siq?.attempts).toBe(2);
    expect(siq?.breaker).toBe("OPEN");
    expect(wic?.okCount).toBe(5); // isolation: wic ran every round
    expect(wic?.breaker).toBe("CLOSED");
    expect(calls.filter((s) => s === "siq")).toHaveLength(2);
    const breakerReceipts = recentOf(r).filter((x) => x.kind === "soldier_breaker");
    expect(breakerReceipts.length).toBeGreaterThanOrEqual(1);
    expect(breakerReceipts[0]?.payload).toMatchObject({ soldier: "siq", from: "CLOSED", to: "OPEN" });
  });

  test("OPEN→HALF_OPEN after cooldown: exactly ONE probe; probe success closes the breaker", async () => {
    const h = harness();
    const { clock, sleep } = h;
    let calls = 0;
    let failUntilCall = 1; // r1 fails → OPEN; r2 probe succeeds → CLOSED; r3 ok
    const unit = async (): Promise<UnitOutcome> => {
      calls++;
      return calls <= failUntilCall ? { ok: false, error: "down" } : ok();
    };
    const r = await runSoldierMesh({
      soldiers: ["haran"],
      clock,
      sleep,
      unit,
      rounds: 3,
      breaker: { failureThreshold: 1, cooldownMs: 5_000 },
      roundGapMs: 6_000, // each round-gap advances past the cooldown
    });
    // r1: fail → OPEN. r2: cooldown elapsed → HALF_OPEN probe → ok → CLOSED. r3: ok.
    const haran = r.soldiers.find((s) => s.soldier === "haran");
    expect(haran?.okCount).toBe(2);
    expect(haran?.failCount).toBe(1);
    expect(haran?.breaker).toBe("CLOSED");
    const kinds = recentOf(r).filter((x) => x.kind === "soldier_breaker");
    expect(kinds.map((k) => (k.payload as { to: string }).to)).toEqual([
      "OPEN",
      "HALF_OPEN",
      "CLOSED",
    ]);
  });

  test("HALF_OPEN probe failure REOPENs and the soldier stays isolated", async () => {
    const h = harness();
    const { clock, sleep } = h;
    const r = await runSoldierMesh({
      soldiers: ["siq"],
      clock,
      sleep,
      unit: async () => ({ ok: false, error: "still down" }),
      rounds: 2,
      breaker: { failureThreshold: 1, cooldownMs: 1_000 },
      roundGapMs: 2_000,
    });
    const siq = r.soldiers.find((s) => s.soldier === "siq");
    expect(siq?.failCount).toBe(2);
    expect(siq?.breaker).toBe("OPEN");
    const tos = recentOf(r)
      .filter((x) => x.kind === "soldier_breaker")
      .map((k) => (k.payload as { to: string }).to);
    expect(tos).toEqual(["OPEN", "HALF_OPEN", "OPEN"]); // REOPEN lands as OPEN
  });
});

/* ── seeded jitter + injected clock ─────────────────────────────────────── */

describe("seeded jitter (mulberry32) + injected clock", () => {
  test("same seed ⇒ identical stagger schedule (byte-stable runs)", async () => {
    const h = harness();
    const delays: number[] = [];
    const sleepSpy = async (ms: number) => {
      delays.push(ms);
      await h.sleep(ms);
    };
    const cfg: SoldierMeshConfig = {
      soldiers: ["a", "b", "c", "d", "e"],
      clock: h.clock,
      sleep: sleepSpy,
      unit: async () => ok(),
      seed: 1234,
      jitterMs: 500,
      rounds: 2,
    };
    const r1 = await runSoldierMesh(cfg);
    const first = delays.slice(0, 5);
    delays.length = 0;
    const r2 = await runSoldierMesh({ ...cfg, sleep: sleepSpy });
    expect(delays.slice(0, 5)).toEqual(first); // per-soldier stagger is per-RUN stable
    expect(r1.seed).toBe(r2.seed);
    expect(first.every((d) => d >= 0 && d < 500)).toBe(true);
  });

  test("different seeds ⇒ different stagger sequences (seeded, not clock-derived)", () => {
    const a = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => Math.floor(mulberry32(7)() * 1000) + i * 0);
    const b = [0, 1, 2, 3, 4, 5, 6, 7].map(() => Math.floor(mulberry32(8)() * 1000));
    expect(a).not.toEqual(b);
    // and the sequence is repeatable for a given seed
    const a2 = [0, 1, 2, 3, 4, 5, 6, 7].map(() => Math.floor(mulberry32(7)() * 1000));
    expect(a2).toEqual(a);
  });

  test("receipt timestamps come from the injected clock only", async () => {
    const h = harness();
    const r = await runSoldierMesh({
      soldiers: ["tov"],
      clock: h.clock,
      sleep: h.sleep,
      unit: async () => ok(),
    });
    const recs = recentOf(r);
    expect(recs.length).toBeGreaterThan(0);
    expect(recs.every((x) => x.at >= 1_000_000)).toBe(true); // fake-epoch, never wall time
    expect(recs[recs.length - 1]?.kind).toBe("soldier_mesh_done");
  });
});

/* ── timeout ────────────────────────────────────────────────────────────── */

describe("per-attempt timeout (injected-clock driven)", () => {
  test("a hung unit is TIMEOUT, counted as breaker failure, mesh continues", async () => {
    const h = harness();
    const unit = async (): Promise<UnitOutcome> =>
      new Promise<UnitOutcome>(() => {}); // never resolves
    const r = await runSoldierMesh({
      soldiers: ["tov", "wog"],
      clock: h.clock,
      sleep: h.sleep,
      unit: async (soldier) => (soldier === "tov" ? unit() : ok()),
      timeoutMs: 5_000,
    });
    const tov = r.soldiers.find((s) => s.soldier === "tov");
    expect(tov?.verdict).toBe("TIMEOUT");
    expect(tov?.timeoutCount).toBe(1);
    expect(r.soldiers.find((s) => s.soldier === "wog")?.verdict).toBe("OK");
    expect(r.verdict).toBe("MESH-PARTIAL");
  });

  test("timeouts trip the per-soldier breaker like any failure", async () => {
    const h = harness();
    const unit = async (): Promise<UnitOutcome> => new Promise<UnitOutcome>(() => {});
    const r = await runSoldierMesh({
      soldiers: ["siq"],
      clock: h.clock,
      sleep: h.sleep,
      unit,
      rounds: 3,
      timeoutMs: 1_000,
      breaker: { failureThreshold: 2, cooldownMs: 60_000 },
    });
    const siq = r.soldiers.find((s) => s.soldier === "siq");
    expect(siq?.timeoutCount).toBe(2);
    expect(siq?.skipBreakerCount).toBe(1);
    expect(siq?.breaker).toBe("OPEN");
  });
});

/* ── concurrency cap ────────────────────────────────────────────────────── */

describe("bounded parallelism", () => {
  test("max in-flight never exceeds the concurrency cap (cap=1 serializes)", async () => {
    const h = harness();
    let inFlight = 0;
    let maxInFlight = 0;
    const unit = async (): Promise<UnitOutcome> => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await h.sleep(10);
      inFlight--;
      return ok();
    };
    const r = await runSoldierMesh({
      soldiers: ["a", "b", "c", "d", "e", "f"],
      clock: h.clock,
      sleep: h.sleep,
      unit,
      concurrency: 1,
    });
    expect(maxInFlight).toBe(1);
    expect(r.verdict).toBe("MESH-OK");
  });

  test("without a cap the roster runs fully parallel (max in-flight == roster size)", async () => {
    const h = harness();
    let inFlight = 0;
    let maxInFlight = 0;
    const unit = async (): Promise<UnitOutcome> => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await h.sleep(10);
      inFlight--;
      return ok();
    };
    await runSoldierMesh({
      soldiers: ["a", "b", "c", "d"],
      clock: h.clock,
      sleep: h.sleep,
      unit,
    });
    expect(maxInFlight).toBe(4);
  });
});

/* ── receipts + hygiene ─────────────────────────────────────────────────── */

describe("receipts + secret hygiene", () => {
  test("receipt chain is hash-linked and verifies; mesh_done closes the run", async () => {
    const h = harness();
    const sinkLines: string[] = [];
    const r = await runSoldierMesh({
      soldiers: ["tov", "wic"],
      clock: h.clock,
      sleep: h.sleep,
      unit: async () => ok(),
      receiptsSink: (line) => sinkLines.push(line),
    });
    expect(r.receipts.verify.ok).toBe(true);
    expect(sinkLines.length).toBe(r.receipts.seq);
    expect(() => JSON.parse(sinkLines[0] ?? "")).not.toThrow();
    const kinds = recentOf(r).map((x) => x.kind);
    expect(kinds[0]).toBe("soldier_mesh_start");
    expect(kinds[kinds.length - 1]).toBe("soldier_mesh_done");
  });

  test("no key material can leak: payloads carry soldier names, txids, errors only", async () => {
    const h = harness();
    const r = await runSoldierMesh({
      soldiers: ["haran"],
      clock: h.clock,
      sleep: h.sleep,
      unit: async () => ({ ok: true, txids: ["abc123"] }),
    });
    const blobs = recentOf(r).map((x) => JSON.stringify(x));
    expect(blobs.every((b) => !/5[JK][A-Za-z0-9]{20,}/.test(b))).toBe(true); // no WIF-shaped strings
    expect(blobs.every((b) => !/"wif"/i.test(b))).toBe(true);
  });
});

/* ── wound registry parsing (pure) ──────────────────────────────────────── */

describe("parseWoundsJsonl + openWounds", () => {
  test("parses custody-wound/1 lines; healed excluded; malformed counted, never thrown", () => {
    const text = [
      JSON.stringify({ schema: "custody-wound/1", at: "t1", soldier: "haran", kind: "posting-authority-mismatch" }),
      JSON.stringify({ schema: "custody-wound/1", at: "t2", soldier: "lsa", status: "open" }),
      JSON.stringify({ schema: "custody-wound/1", at: "t3", soldier: "old", status: "healed" }),
      "{not json",
      JSON.stringify({ nope: true }),
      "",
    ].join("\n");
    const p = parseWoundsJsonl(text);
    expect(p.wounds.map((w) => w.soldier).sort()).toEqual(["haran", "lsa"]);
    expect(p.healed).toBe(1);
    expect(p.malformed).toBe(2); // "{not json" + {nope:true}; empty line ignored
  });

  test("openWounds filters healed and drops nameless entries", () => {
    expect(
      openWounds([
        { soldier: "siq" },
        { soldier: "haran", status: "healed" },
        { soldier: "" },
        { soldier: "lsa", status: "OPEN" },
      ]).map((w) => w.soldier),
    ).toEqual(["siq", "lsa"]); // case-insensitive status, healed excluded
  });
});
