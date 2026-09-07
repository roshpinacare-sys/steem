import { describe, it, expect, beforeEach } from "vitest";
import { CircuitBreaker, CircuitBreakerOpenError } from "../src/services/circuit-breaker.js";

describe("CircuitBreaker", () => {
  let cb: CircuitBreaker;

  beforeEach(() => {
    cb = new CircuitBreaker({ name: "test", failureThreshold: 3, resetTimeoutMs: 50 });
  });

  it("starts CLOSED and passes calls through", async () => {
    const result = await cb.call(() => Promise.resolve("ok"));
    expect(result).toBe("ok");
    expect(cb.currentState).toBe("CLOSED");
  });

  it("opens after failureThreshold consecutive failures", async () => {
    const fail = () => Promise.reject(new Error("boom"));
    for (let i = 0; i < 3; i++) {
      await cb.call(fail).catch(() => {});
    }
    expect(cb.currentState).toBe("OPEN");
  });

  it("throws CircuitBreakerOpenError when OPEN", async () => {
    const fail = () => Promise.reject(new Error("boom"));
    for (let i = 0; i < 3; i++) await cb.call(fail).catch(() => {});

    await expect(cb.call(() => Promise.resolve("ok"))).rejects.toBeInstanceOf(CircuitBreakerOpenError);
  });

  it("transitions to HALF_OPEN after resetTimeoutMs and closes on success", async () => {
    const fail = () => Promise.reject(new Error("boom"));
    for (let i = 0; i < 3; i++) await cb.call(fail).catch(() => {});
    expect(cb.currentState).toBe("OPEN");

    // Wait past resetTimeoutMs
    await new Promise((r) => setTimeout(r, 60));

    const result = await cb.call(() => Promise.resolve("healed"));
    expect(result).toBe("healed");
    expect(cb.currentState).toBe("CLOSED");
  });

  it("re-opens from HALF_OPEN on failure", async () => {
    const fail = () => Promise.reject(new Error("boom"));
    for (let i = 0; i < 3; i++) await cb.call(fail).catch(() => {});
    await new Promise((r) => setTimeout(r, 60));
    // Probe fails again
    await cb.call(fail).catch(() => {});
    expect(cb.currentState).toBe("OPEN");
  });

  it("resets correctly via reset()", async () => {
    const fail = () => Promise.reject(new Error("boom"));
    for (let i = 0; i < 3; i++) await cb.call(fail).catch(() => {});
    cb.reset();
    expect(cb.currentState).toBe("CLOSED");
    const result = await cb.call(() => Promise.resolve("after-reset"));
    expect(result).toBe("after-reset");
  });
});
