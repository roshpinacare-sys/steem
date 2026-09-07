/**
 * cost-alert.test.ts
 *
 * Tests for the cost-alert feature in PrReporter.
 * Verifies: threshold not exceeded (no banner), threshold exceeded (banner),
 * zero threshold (never alerts), and banner content format.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RunState } from "../src/types/run-state.js";
import type { GitHubClient } from "../src/services/github-client.js";
import type { RedisState } from "../src/services/redis-state.js";
import { PrReporter } from "../src/services/pr-reporter.js";

// ---------------------------------------------------------------------------
// Minimal stubs
// ---------------------------------------------------------------------------

function makeRunState(phase = "done"): RunState {
  return {
    runId:     "test-run-1",
    objective: "Test cost alert",
    phase,
    owner:     "acme",
    repo:      "app",
    prNumber:  42,
    prSha:     "abc123",
  } as RunState;
}

function makeGh(capturedBodies: string[]): GitHubClient {
  return {
    comment: vi.fn(async (_pr: number, body: string) => {
      capturedBodies.push(body);
      return 9001;
    }),
    updateComment: vi.fn(async (_pr: number, _id: number, body: string) => {
      capturedBodies.push(body);
    }),
  } as unknown as GitHubClient;
}

function makeState(existingCommentId: number | null): RedisState {
  return {
    getJSON: vi.fn(async () =>
      existingCommentId ? { commentId: existingCommentId } : null,
    ),
    setJSON: vi.fn(async () => {}),
  } as unknown as RedisState;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PrReporter — cost alert", () => {
  let bodies: string[];

  beforeEach(() => {
    bodies = [];
  });

  it("does NOT show alert banner when cost is below threshold", async () => {
    const reporter = new PrReporter(
      makeGh(bodies),
      makeState(null),
      42, "acme", "app",
      undefined,
      50, // 50 cents threshold
    );
    await reporter.report(makeRunState(), {
      cost: {
        totalTokens:       1000,
        estimatedUsd:      0.30,  // 30 cents — under threshold
        estimatedUsdCents: 30,
        breakdown:         {},
      },
    });
    expect(bodies[0]).not.toContain("Cost Alert");
  });

  it("shows 🚨 Cost Alert banner when cost exceeds threshold", async () => {
    const reporter = new PrReporter(
      makeGh(bodies),
      makeState(null),
      42, "acme", "app",
      undefined,
      50, // 50 cents threshold
    );
    await reporter.report(makeRunState(), {
      cost: {
        totalTokens:       5000,
        estimatedUsd:      0.75,  // 75 cents — over threshold
        estimatedUsdCents: 75,
        breakdown:         {},
      },
    });
    expect(bodies[0]).toContain("🚨 **Cost Alert:**");
    expect(bodies[0]).toContain("$0.75");
  });

  it("includes both actual cost and threshold value in the alert", async () => {
    const reporter = new PrReporter(
      makeGh(bodies),
      makeState(null),
      42, "acme", "app",
      undefined,
      100, // $1.00 threshold
    );
    await reporter.report(makeRunState(), {
      cost: {
        totalTokens:       10_000,
        estimatedUsd:      1.50,
        estimatedUsdCents: 150,
        breakdown:         {},
      },
    });
    const body = bodies[0];
    expect(body).toContain("$1.50");   // actual
    expect(body).toContain("$1.00");   // threshold
  });

  it("never alerts when threshold is 0 (default — disabled)", async () => {
    const reporter = new PrReporter(
      makeGh(bodies),
      makeState(null),
      42, "acme", "app",
      undefined,
      0, // disabled
    );
    await reporter.report(makeRunState(), {
      cost: {
        totalTokens:       999_999,
        estimatedUsd:      9999.99,
        estimatedUsdCents: 999_999,
        breakdown:         {},
      },
    });
    expect(bodies[0]).not.toContain("Cost Alert");
  });

  it("edits the existing anchor comment (no new comment created)", async () => {
    const gh      = makeGh(bodies);
    const reporter = new PrReporter(
      gh,
      makeState(9001), // existing comment
      42, "acme", "app",
      undefined,
      25,
    );
    await reporter.report(makeRunState(), {
      cost: {
        totalTokens:       2000,
        estimatedUsd:      0.40,
        estimatedUsdCents: 40,
        breakdown:         {},
      },
    });
    expect(gh.comment).not.toHaveBeenCalled();
    expect(gh.updateComment).toHaveBeenCalledOnce();
    expect(bodies[0]).toContain("🚨 **Cost Alert:**");
  });
});
