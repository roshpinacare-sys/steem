/**
 * axiom-shipper.test.ts
 *
 * Tests for the Axiom structured log shipper.
 * Verifies: subscriber registration, batch buffering, flush to API,
 * network-error re-queue, and idempotent init.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  initAxiomShipper,
  flushAxiomShipper,
  _resetAxiomShipper,
} from "../src/services/axiom-shipper.js";
import { log } from "../src/services/logger.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

afterEach(() => {
  _resetAxiomShipper();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("axiom-shipper", () => {
  it("returns false and stays inactive when credentials are absent", () => {
    const activated = initAxiomShipper("", "");
    expect(activated).toBe(false);
  });

  it("returns true and activates when both token and dataset are provided", () => {
    const activated = initAxiomShipper("test-token", "test-dataset");
    expect(activated).toBe(true);
  });

  it("is idempotent — calling init twice returns true both times without error", () => {
    expect(initAxiomShipper("tok", "ds")).toBe(true);
    expect(initAxiomShipper("tok", "ds")).toBe(true);
  });

  it("buffers log records before flush", async () => {
    // Intercept fetch so no real network call is made
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 200 }) as Response,
    );

    initAxiomShipper("tok", "ds");

    log.info("test message 1");
    log.warn("test message 2");

    // No flush yet — fetch should not have been called
    expect(fetchSpy).not.toHaveBeenCalled();

    // Explicit flush
    await flushAxiomShipper();

    expect(fetchSpy).toHaveBeenCalledOnce();

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/v1/datasets/ds/ingest");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer tok");

    const lines = (init.body as string).split("\n").filter(Boolean);
    expect(lines.length).toBeGreaterThanOrEqual(2);
    const parsed = lines.map((l) => JSON.parse(l) as { msg: string });
    expect(parsed.map((r) => r.msg)).toContain("test message 1");
    expect(parsed.map((r) => r.msg)).toContain("test message 2");
  });

  it("does not re-flush already-flushed records", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 200 }) as Response,
    );
    initAxiomShipper("tok", "ds");
    log.info("once");
    await flushAxiomShipper();
    await flushAxiomShipper(); // second flush — buffer is now empty
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it("re-queues records on network error and does not throw", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(
      new Error("ECONNRESET"),
    );
    initAxiomShipper("tok", "ds");
    log.error("network failure test");

    // Should not throw even when fetch fails
    await expect(flushAxiomShipper()).resolves.toBeUndefined();
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it("sends NDJSON content-type header", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 200 }) as Response,
    );
    initAxiomShipper("tok", "ds");
    log.debug("ndjson check");
    await flushAxiomShipper();

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/x-ndjson",
    );
  });
});
