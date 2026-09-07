/**
 * pass-24-webhook-boundaries.test.ts
 *
 * Regression tests for the Pass 24 hardening of worker/webhook-receiver.js:
 *   - self-loop prevention (ignore Qodo bot/app events)
 *   - issue_comment restricted to pull requests
 *   - request body size cap
 */

import { describe, it, expect } from "vitest";
import { isQodoSender, isQodoApp } from "../../worker/webhook-receiver.js";

describe("isQodoSender", () => {
  it("returns true for the configured Qodo login", () => {
    expect(isQodoSender({ login: "qodo" }, "qodo")).toBe(true);
    expect(isQodoSender({ login: "qodo" }, "")).toBe(true);
  });

  it("returns true for the Qodo bot account", () => {
    expect(isQodoSender({ login: "qodo[bot]" }, "")).toBe(true);
  });

  it("returns false for other senders", () => {
    expect(isQodoSender({ login: "alice" }, "qodo")).toBe(false);
    expect(isQodoSender({ login: "dependabot[bot]" }, "qodo")).toBe(false);
  });

  it("returns false when sender is missing", () => {
    expect(isQodoSender(undefined, "qodo")).toBe(false);
    expect(isQodoSender(null, "qodo")).toBe(false);
  });
});

describe("isQodoApp", () => {
  it("returns true for the configured Qodo app slug", () => {
    expect(isQodoApp({ slug: "qodo" }, "qodo")).toBe(true);
    expect(isQodoApp({ slug: "qodo" }, "")).toBe(true);
  });

  it("returns false for other apps", () => {
    expect(isQodoApp({ slug: "github-actions" }, "qodo")).toBe(false);
    expect(isQodoApp({ slug: "dependabot" }, "qodo")).toBe(false);
  });

  it("returns false when app is missing", () => {
    expect(isQodoApp(undefined, "qodo")).toBe(false);
    expect(isQodoApp(null, "qodo")).toBe(false);
  });
});
