/**
 * Regression tests for incident-resolver workflow dispatch (Bug 17-G).
 *
 * resolveIncident must pass the original objective to the dispatched fix
 * workflow so the agent has meaningful context. Previously it sent the
 * hardcoded issue title, causing every auto-remediation run to start with the
 * same generic objective.
 */

import { describe, it, expect, vi } from "vitest";
import { resolveIncident, type IncidentInput } from "../src/services/incident-resolver.js";
import type { GitHubClient } from "../src/services/github-client.js";

function makeGh(): GitHubClient {
  return {
    revertMergeCommitWithNewCommit: vi.fn().mockResolvedValue(undefined),
  } as unknown as GitHubClient;
}

function captureDispatches(): { token: string; captured: { owner: string; repo: string; objective: string }[] } {
  const captured: { owner: string; repo: string; objective: string }[] = [];
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/actions/workflows/")) {
      const body = init?.body ? JSON.parse(init.body as string) : {};
      const urlMatch = url.match(/repos\/([^/]+)\/([^/]+)\/actions/);
      if (urlMatch) {
        captured.push({ owner: urlMatch[1], repo: urlMatch[2], objective: body.inputs?.objective });
      }
    }
    if (url.includes("/issues")) {
      return new Response(JSON.stringify({ number: 99 }), { status: 201 });
    }
    return new Response(null, { status: 204 });
  }) as typeof fetch;
  return { token: "gh-token", captured };
}

describe("incident-resolver — fix workflow dispatch", () => {
  it("dispatches the original objective to the fix workflow (Bug 17-G regression)", async () => {
    const gh = makeGh();
    const { token, captured } = captureDispatches();
    const input: IncidentInput = {
      prNumber: 42,
      errorLog: "TypeError: cannot read property of undefined",
      objective: "Add user profile page with avatar upload",
      commitSha: "abc123",
    };

    await resolveIncident(gh, input, "acme", "app", token);

    expect(gh.revertMergeCommitWithNewCommit).toHaveBeenCalledWith(42);
    expect(captured).toHaveLength(1);
    expect(captured[0].owner).toBe("acme");
    expect(captured[0].repo).toBe("app");
    expect(captured[0].objective).toBe("Add user profile page with avatar upload");
  });
});
