/**
 * logger.test.ts — Unit tests for the structured logger.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { log, subscribeToLogs } from "../src/services/logger.js";

describe("logger", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("emits records to subscribers", () => {
    const received: unknown[] = [];
    const unsub = subscribeToLogs((r) => received.push(r));
    log.info("hello", { phase: "coder" });
    unsub();
    expect(received).toHaveLength(1);
    const r = received[0] as Record<string, unknown>;
    expect(r.level).toBe("info");
    expect(r.msg).toBe("hello");
    expect(r.phase).toBe("coder");
  });

  it("child logger merges context", () => {
    const received: unknown[] = [];
    const unsub = subscribeToLogs((r) => received.push(r));
    const child = log.child({ runId: "run-123", phase: "gate" });
    child.warn("gate warning");
    unsub();
    const r = received[0] as Record<string, unknown>;
    expect(r.runId).toBe("run-123");
    expect(r.phase).toBe("gate");
    expect(r.level).toBe("warn");
  });

  it("child context can be overridden per call", () => {
    const received: unknown[] = [];
    const unsub = subscribeToLogs((r) => received.push(r));
    const child = log.child({ runId: "run-abc" });
    child.error("err", { phase: "commit" });
    unsub();
    const r = received[0] as Record<string, unknown>;
    expect(r.runId).toBe("run-abc");
    expect(r.phase).toBe("commit");
    expect(r.level).toBe("error");
  });

  it("unsubscribe stops receiving records", () => {
    const received: unknown[] = [];
    const unsub = subscribeToLogs((r) => received.push(r));
    log.info("before");
    unsub();
    log.info("after");
    expect(received).toHaveLength(1);
  });

  it("subscriber errors do not crash the logger", () => {
    const unsub = subscribeToLogs(() => { throw new Error("subscriber crash"); });
    expect(() => log.info("safe")).not.toThrow();
    unsub();
  });
});
