// W49-d · steem-mesh-bridge · nodes.ts vectors — health-ranked pool, failover, breaker
// integration, timeout race, boot measurement. ZERO NETWORK: fetch is injected,
// clock is injected; the only real timers are sub-second timeout-race delays.
import { describe, expect, test } from "bun:test";
import { NodePool, UpstreamError } from "../nodes";
import type { NodeCandidate } from "../nodes";

type UrlHandler = (url: string, body: any) => Promise<Response> | Response;

const rpcReply = (result: unknown) =>
  new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

function spyFetch(handler: UrlHandler) {
  const calls: { url: string; method: string; body: any }[] = [];
  const impl = async (url: string, init?: any) => {
    const body = init?.body ? JSON.parse(init.body) : null;
    calls.push({ url, method: init?.method ?? "GET", body });
    return handler(url, body);
  };
  return { calls, impl };
}

const cands = (...names: string[]): NodeCandidate[] =>
  names.map((n) => ({ name: n, url: `https://${n}.test` }));

const PROBE = "mesh.probe";

function basePool(names: string[], handler: UrlHandler, extra: any = {}) {
  const spyNow = { value: 1000 };
  const spy = spyFetch(handler);
  const pool = new NodePool(cands(...names), {
    fetchImpl: spy.impl,
    clock: () => spyNow.value,
    probeMethod: PROBE,
    ...extra,
  });
  return { pool, spy, spyNow };
}

describe("NodePool.measure — boot reachability census", () => {
  test("keeps only reachable candidates; drops are honest with errors", async () => {
    const { pool } = basePool(["up", "down"], async (url) => {
      if (url.includes("down")) throw new Error("connection refused");
      return rpcReply({ ok: true });
    });
    const m = await pool.measure();
    expect(m.kept).toEqual(["up"]);
    expect(m.dropped).toHaveLength(1);
    expect(m.dropped[0].name).toBe("down");
    expect(m.dropped[0].error).toContain("connection refused");
    expect(pool.health().find((n) => n.name === "down")?.reachable).toBe(false);
    expect(pool.rank().map((n) => n.candidate.name)).toEqual(["up"]);
  });
});

describe("NodePool.rank — deterministic health ranking", () => {
  test("healthy nodes rank by EWMA ascending regardless of candidate order", async () => {
    const clock = { value: 1000 };
    const pool = new NodePool(cands("slow", "fast"), {
      fetchImpl: async (url) => {
        clock.value += url.includes("slow") ? 50 : 5;
        return rpcReply({ v: 1 });
      },
      clock: () => clock.value,
      probeMethod: PROBE,
    });
    await pool.measure(); // seeds ewma: slow≈50, fast=5
    expect(pool.rank().map((n) => n.candidate.name)).toEqual(["fast", "slow"]);
  });

  test("an open breaker excludes the node from ranking even if it is the fastest", async () => {
    const clock = { value: 0 };
    let fastCalls = 0;
    const pool = new NodePool(cands("fast", "slow"), {
      fetchImpl: async (url) => {
        if (url.includes("fast")) {
          fastCalls++;
          if (fastCalls === 1) {
            clock.value += 5; // first call succeeds — seeds the (best) EWMA
            return rpcReply({ v: 1 });
          }
          throw new Error("dead");
        }
        clock.value += 50;
        return rpcReply({ v: 1 });
      },
      clock: () => clock.value,
      probeMethod: PROBE,
      breaker: { failThreshold: 3, cooldownMs: 60000 },
    });
    await pool.call("m", []); // fast serves first (ewma 5) — ranked ahead from now on
    for (let i = 0; i < 3; i++) await pool.call("m", []).catch(() => null); // fast fails 3× → opens; slow serves each round
    expect(pool.health().find((n) => n.name === "fast")?.breakerState).toBe("open");
    expect(pool.rank().map((n) => n.candidate.name)).toEqual(["slow"]);
    const r = await pool.call("m", []);
    expect(r.attempts.map((a) => a.node)).toEqual([]); // fast-rejected: zero attempts on the open node
    expect(r.node).toBe("slow");
  });
});

describe("NodePool.call — failover + breaker + timeout", () => {
  test("failover determinism: node1 fails → node2 serves the identical result", async () => {
    const { pool, spy } = basePool(["n1", "n2"], async (url) => {
      if (url.includes("n1")) throw new Error("socket hang up");
      return rpcReply({ h: 1 });
    });
    const r1 = await pool.call("condenser_api.get_dynamic_global_properties", []);
    expect(r1.node).toBe("n2");
    expect(r1.result).toEqual({ jsonrpc: "2.0", id: 1, result: { h: 1 } });
    expect(r1.attempts).toEqual([{ node: "n1", url: "https://n1.test", ms: 0, error: "socket hang up" }]);
    const r2 = await pool.call("condenser_api.get_dynamic_global_properties", []);
    expect(r2.node).toBe("n2");
    expect(r2.result).toEqual(r1.result);
    expect(spy.calls.length).toBe(3); // n1 + n2 (call 1), then n2 only (call 2 — ranked first by seeded EWMA)
  });

  test("all upstreams failing 3 rounds opens breakers; next call fast-rejects with zero fetches", async () => {
    const { pool, spy } = basePool(["a", "b"], async () => {
      throw new Error("500");
    });
    for (let i = 0; i < 3; i++) {
      await pool.call("m", []).catch((e) => {
        expect(e).toBeInstanceOf(UpstreamError);
        expect(e.attempts.map((a: any) => a.node)).toEqual(["a", "b"]);
      });
    }
    const callsAfterOpen = spy.calls.length; // 6 = 2 nodes × 3 rounds
    const health = pool.health();
    expect(health.map((n) => n.breakerState)).toEqual(["open", "open"]);
    expect(health.map((n) => n.lastError)).toEqual(["500", "500"]);
    await expect(pool.call("m", [])).rejects.toMatchObject({ code: "no-upstream-available" });
    expect(spy.calls.length).toBe(callsAfterOpen); // fast-reject: not a single fetch fired
  });

  test("timeout → failover: slow node loses the race, healthy node serves", async () => {
    const { pool } = basePool(
      ["t", "ok"],
      async (url) => {
        if (url.includes("/t.")) {
          await new Promise((res) => setTimeout(res, 250));
          return rpcReply({ late: true });
        }
        return rpcReply({ fast: true });
      },
      { timeoutMs: 30 },
    );
    const r = await pool.call("m", []);
    expect(r.node).toBe("ok");
    expect(r.result).toEqual({ jsonrpc: "2.0", id: 1, result: { fast: true } });
    expect(r.attempts).toHaveLength(1);
    expect(r.attempts[0].error).toContain("timeout");
    expect(r.attempts[0].node).toBe("t");
  });

  test("half-open probe recovery: open node is re-probed after cooldown and closes on success", async () => {
    let dead = true;
    const clock = { value: 0 };
    const pool = new NodePool(cands("solo"), {
      fetchImpl: async () => {
        if (dead) throw new Error("down");
        clock.value += 3;
        return rpcReply({ back: true });
      },
      clock: () => clock.value,
      probeMethod: PROBE,
      breaker: { failThreshold: 3, cooldownMs: 1000 },
    });
    for (let i = 0; i < 3; i++) await pool.call("m", []).catch(() => null);
    expect(pool.health()[0].breakerState).toBe("open");
    await expect(pool.call("m", [])).rejects.toMatchObject({ code: "no-upstream-available" });
    clock.value = 500; // still inside cooldown → fast-reject
    await expect(pool.call("m", [])).rejects.toBeInstanceOf(UpstreamError);
    clock.value = 1500; // cooldown elapsed → probe due
    dead = false;
    const r = await pool.call("m", []);
    expect(r.node).toBe("solo");
    expect(r.result).toEqual({ jsonrpc: "2.0", id: 1, result: { back: true } });
    expect(pool.health()[0].breakerState).toBe("closed");
    expect(pool.health()[0].consecFails).toBe(0);
  });

  test("single half-open probe: a probed node is invisible to concurrent rankings until resolved", async () => {
    let dead = true;
    let probeGate: Promise<Response> | null = null;
    const clock = { value: 0 };
    const pool = new NodePool(cands("solo"), {
      fetchImpl: async () => {
        if (dead) throw new Error("down");
        clock.value += 1;
        return probeGate ?? rpcReply({ ok: 1 });
      },
      clock: () => clock.value,
      probeMethod: PROBE,
      breaker: { failThreshold: 3, cooldownMs: 1000 },
    });
    for (let i = 0; i < 3; i++) await pool.call("m", []).catch(() => null);
    clock.value = 5000; // probe due
    dead = false;
    let releaseProbe!: (v: Response) => void;
    const gate = new Promise<Response>((res) => (releaseProbe = res));
    probeGate = gate; // the next upstream call (the probe) hangs until released
    const inflight = pool.call("m", []); // enters the gated probe fetch
    await new Promise((r) => setTimeout(r, 10));
    expect(pool.rank()).toEqual([]); // probeActive hides the node from other rankings
    releaseProbe(rpcReply({ ok: 1 }));
    const r = await inflight;
    expect(r.node).toBe("solo");
    expect(pool.rank().map((n) => n.candidate.name)).toEqual(["solo"]); // visible again
    expect(pool.health()[0].breakerState).toBe("closed");
  });
});

describe("NodePool observability — EWMA + honest status", () => {
  test("EWMA follows alpha=0.3: first sample seeds, next blends", async () => {
    const clock = { value: 0 };
    let call = 0;
    const pool = new NodePool(cands("a"), {
      fetchImpl: async () => {
        clock.value += call++ === 0 ? 100 : 200;
        return rpcReply({ i: call });
      },
      clock: () => clock.value,
      probeMethod: PROBE,
    });
    await pool.call("m", []);
    await pool.call("m", []);
    const ew = pool.health()[0].ewmaMs ?? -1;
    expect(Math.abs(ew - 130) < 1e-6).toBe(true); // 0.3*200 + 0.7*100
  });

  test("status exposes candidates, dropped, per-node detail and limits", async () => {
    const { pool } = basePool(["up", "down"], async (url) => {
      if (url.includes("down")) throw new Error("refused");
      return rpcReply({});
    });
    await pool.measure();
    const s: any = pool.status();
    expect(s.active).toEqual(["up"]);
    expect(s.dropped[0]).toEqual({ name: "down", url: "https://down.test", error: "refused" });
    const up = s.nodes.find((n: any) => n.name === "up");
    expect(up).toMatchObject({ name: "up", url: "https://up.test", reachable: true, breakerState: "closed" });
    expect(s.limits).toMatchObject({ failThreshold: 3, cooldownMs: 30000, timeoutMs: 2000 });
  });

  test("upstream POST bodies are real steem JSON-RPC envelopes", async () => {
    const { pool, spy } = basePool(["a"], async () => rpcReply({}));
    await pool.call("condenser_api.get_block", [12345]);
    expect(spy.calls[0].method).toBe("POST");
    expect(spy.calls[0].body).toMatchObject({ jsonrpc: "2.0", method: "condenser_api.get_block", params: [12345] });
    expect(typeof spy.calls[0].body.id).toBe("number");
  });
});
