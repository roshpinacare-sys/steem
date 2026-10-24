// W49-d · steem-mesh-bridge · breaker.ts vectors — pure deterministic state machine.
// Zero network, zero timers — every transition driven by an explicit `now`.
import { describe, expect, test } from "bun:test";
import { CircuitBreaker } from "../breaker";

describe("CircuitBreaker", () => {
  test("starts closed and allows attempts", () => {
    const b = new CircuitBreaker();
    expect(b.state).toBe("closed");
    expect(b.canAttempt(0)).toBe(true);
    expect(b.snapshot()).toEqual({ state: "closed", openedAt: null, consecFails: 0 });
  });

  test("opens after failThreshold consecutive fails (default 3)", () => {
    const b = new CircuitBreaker();
    b.recordFail(1000);
    b.recordFail(1001);
    expect(b.state).toBe("closed");
    b.recordFail(1002);
    expect(b.state).toBe("open");
    expect(b.snapshot().openedAt).toBe(1002);
  });

  test("open fast-rejects within cooldown", () => {
    const b = new CircuitBreaker({ cooldownMs: 30000 });
    b.recordFail(0); b.recordFail(1); b.recordFail(2); // opens at t=2
    expect(b.canAttempt(2)).toBe(false);
    expect(b.canAttempt(15000)).toBe(false);
    expect(b.canAttempt(30001)).toBe(false); // 30001-2 < 30000 — still inside
  });

  test("after cooldown the probe is due; beginProbe flips open→halfOpen (pure view + explicit transition)", () => {
    const b = new CircuitBreaker({ cooldownMs: 30000 });
    b.recordFail(0); b.recordFail(1); b.recordFail(2);
    expect(b.canAttempt(30001)).toBe(false); // 29999ms elapsed < 30000
    expect(b.canAttempt(30002)).toBe(true); // 30002 - 2 >= 30000 — probe due
    expect(b.state).toBe("open"); // canAttempt is a pure view — it never mutates
    b.beginProbe(30002); // the pool calls this right before sending the probe
    expect(b.state).toBe("halfOpen");
    expect(b.snapshot()).toEqual({ state: "halfOpen", openedAt: 2, consecFails: 3 });
  });

  test("halfOpen probe success → closed with consecFails reset", () => {
    const b = new CircuitBreaker();
    b.recordFail(0); b.recordFail(1); b.recordFail(2);
    b.canAttempt(30002); // → halfOpen
    b.recordSuccess(30003);
    expect(b.state).toBe("closed");
    expect(b.snapshot()).toEqual({ state: "closed", openedAt: null, consecFails: 0 });
  });

  test("halfOpen probe fail → open again, cooldown restarts from the new failure", () => {
    const b = new CircuitBreaker({ cooldownMs: 30000 });
    b.recordFail(0); b.recordFail(1); b.recordFail(2);
    b.canAttempt(30002); // → halfOpen
    b.recordFail(30003); // probe failed
    expect(b.state).toBe("open");
    expect(b.snapshot().openedAt).toBe(30003);
    expect(b.canAttempt(30010)).toBe(false);        // old cooldown window must NOT apply
    expect(b.canAttempt(60002)).toBe(false);        // 60002 - 30003 < 30000
    expect(b.canAttempt(60003)).toBe(true);         // fresh window elapsed
  });

  test("non-consecutive fails never open (success resets the streak)", () => {
    const b = new CircuitBreaker();
    b.recordFail(0); b.recordFail(1);
    b.recordSuccess(2);
    b.recordFail(3);
    expect(b.state).toBe("closed");
    expect(b.snapshot().consecFails).toBe(1);
  });

  test("custom failThreshold + cooldown are honored", () => {
    const b = new CircuitBreaker({ failThreshold: 1, cooldownMs: 5000 });
    b.recordFail(10);
    expect(b.state).toBe("open");
    expect(b.canAttempt(5009)).toBe(false);
    expect(b.canAttempt(5010)).toBe(true);
  });
});
