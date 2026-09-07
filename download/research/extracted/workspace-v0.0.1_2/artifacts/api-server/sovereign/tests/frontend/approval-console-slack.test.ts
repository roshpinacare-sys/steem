/**
 * tests/frontend/approval-console-slack.test.ts — Slack notifier for
 * real-time approval console.
 *
 * HAPPY     escalated/pending/error/critical events dispatched to Slack.
 * EDGE      dedup, flush, custom filter, approved without critical skipped.
 * FAIL-CLOSED  null/missing-id throws; post error propagates.
 */

import "../_flush.mjs";
import { test, assert, eq, deepEq } from "../_harness.mjs";
import {
  defaultSlackFilter,
  formatSlackPayload,
  createSlackNotifier,
} from "../../frontend/approval-console/slack.ts";
import type { ApprovalConsoleEvent, ConsoleRiskAssessment } from "../../frontend/approval-console/types.ts";

// ─── Fixtures ───────────────────────────────────────────────────────────────

function event(p: Partial<ApprovalConsoleEvent> & { id: string; tenantId: string }): ApprovalConsoleEvent {
  return {
    timestamp: new Date().toISOString(),
    actorId: "actor-1",
    actionType: "file_delete",
    status: "pending",
    ...p,
  } as ApprovalConsoleEvent;
}

function assessment(score: number, factors: ConsoleRiskAssessment["factors"] = []): ConsoleRiskAssessment {
  return {
    riskScore: score,
    baseApprovalClass: "auto",
    effectiveApprovalClass: "human",
    escalated: true,
    factors,
    explanation: [],
  };
}

function mockPost(): { calls: Array<{ text: string; blocks?: unknown[] }>; post: (p: { text: string; blocks?: unknown[] }) => Promise<void> } {
  const calls: Array<{ text: string; blocks?: unknown[] }> = [];
  async function post(payload: { text: string; blocks?: unknown[] }): Promise<void> {
    calls.push(payload);
  }
  return { calls, post };
}

// ─── Happy path ────────────────────────────────────────────────────────────

test("defaultSlackFilter passes escalated", () => {
  eq(defaultSlackFilter(event({ id: "e1", tenantId: "t1", status: "escalated" })), true);
});

test("defaultSlackFilter passes pending", () => {
  eq(defaultSlackFilter(event({ id: "e2", tenantId: "t1", status: "pending" })), true);
});

test("defaultSlackFilter passes error", () => {
  eq(defaultSlackFilter(event({ id: "e3", tenantId: "t1", status: "error" })), true);
});

test("defaultSlackFilter passes approved with critical factor", () => {
  const ev = event({
    id: "e4",
    tenantId: "t1",
    status: "approved",
    assessment: assessment(30, [{ factor: "x", contribution: 25, detail: "d" }]),
  });
  eq(defaultSlackFilter(ev), true);
});

test("formatSlackPayload includes channel and status", () => {
  const ev = event({ id: "e5", tenantId: "t1", status: "escalated", actionType: "db_migration" });
  const payload = formatSlackPayload(ev, "#alerts");
  assert(payload.text.includes("escalated"), "text mentions status");
  assert(payload.text.includes("db_migration"), "text mentions action");
  assert(payload.text.includes("#alerts"), "text mentions channel");
  assert(payload.blocks && payload.blocks.length >= 2, "has blocks");
  const header = payload.blocks![0].text?.text || "";
  assert(header.includes("escalated"), "header contains status");
});

test("notify sends escalated event via injected post", async () => {
  const { calls, post } = mockPost();
  const notifier = createSlackNotifier({ channel: "#alerts", post });
  const ev = event({ id: "e6", tenantId: "t1", status: "escalated" });
  const sent = await notifier.notify(ev);
  eq(sent, true, "notify returns true");
  eq(calls.length, 1, "post called once");
  assert(calls[0].text.includes("escalated"), "payload text escalated");
});

test("notify includes assessment fields when present", async () => {
  const { calls, post } = mockPost();
  const notifier = createSlackNotifier({ channel: "#alerts", post });
  const ev = event({
    id: "e7",
    tenantId: "t1",
    status: "pending",
    assessment: assessment(55, [
      { factor: "velocity", contribution: 15, detail: "3× baseline" },
    ]),
  });
  await notifier.notify(ev);
  const payload = calls[0];
  const blocksText = JSON.stringify(payload.blocks);
  assert(blocksText.includes("55"), "risk score in blocks");
  assert(blocksText.includes("velocity"), "factor name in blocks");
  assert(blocksText.includes("3× baseline"), "factor detail in blocks");
});

// ─── Edge cases ────────────────────────────────────────────────────────────

test("defaultSlackFilter skips approved without critical factors", () => {
  const ev = event({ id: "e8", tenantId: "t1", status: "approved", assessment: assessment(10) });
  eq(defaultSlackFilter(ev), false);
});

test("defaultSlackFilter skips denied without critical factors", () => {
  const ev = event({ id: "e9", tenantId: "t1", status: "denied" });
  eq(defaultSlackFilter(ev), false);
});

test("dedup suppresses second notify within window", async () => {
  const { calls, post } = mockPost();
  const notifier = createSlackNotifier({ channel: "#alerts", post, dedupWindowMs: 10000 });
  const ev = event({ id: "e10", tenantId: "t1", status: "escalated" });
  const s1 = await notifier.notify(ev);
  const s2 = await notifier.notify(ev);
  eq(s1, true, "first send succeeds");
  eq(s2, false, "second send suppressed");
  eq(calls.length, 1, "post called only once");
});

test("flush clears dedup allowing resend", async () => {
  const { calls, post } = mockPost();
  const notifier = createSlackNotifier({ channel: "#alerts", post, dedupWindowMs: 10000 });
  const ev = event({ id: "e11", tenantId: "t1", status: "escalated" });
  await notifier.notify(ev);
  notifier.flush();
  const s2 = await notifier.notify(ev);
  eq(s2, true, "resend after flush succeeds");
  eq(calls.length, 2, "post called twice");
});

test("custom filter overrides default", async () => {
  const { calls, post } = mockPost();
  const notifier = createSlackNotifier({
    channel: "#alerts",
    post,
    filter: () => false,
  });
  const ev = event({ id: "e12", tenantId: "t1", status: "escalated" });
  const sent = await notifier.notify(ev);
  eq(sent, false, "custom filter blocks all");
  eq(calls.length, 0, "post never called");
});

test("wouldFilter returns true for blocked event", () => {
  const { post } = mockPost();
  const notifier = createSlackNotifier({ channel: "#alerts", post });
  const ev = event({ id: "e13", tenantId: "t1", status: "approved", assessment: assessment(5) });
  eq(notifier.wouldFilter(ev), true, "wouldFilter true for approved");
});

test("wouldFilter returns false for alert-worthy event", () => {
  const { post } = mockPost();
  const notifier = createSlackNotifier({ channel: "#alerts", post });
  const ev = event({ id: "e14", tenantId: "t1", status: "error" });
  eq(notifier.wouldFilter(ev), false, "wouldFilter false for error");
});

// ─── Fail-closed ────────────────────────────────────────────────────────────

test("notify throws on null event", async () => {
  const { post } = mockPost();
  const notifier = createSlackNotifier({ channel: "#alerts", post });
  let threw = false;
  try {
    await notifier.notify(null as any);
  } catch {
    threw = true;
  }
  eq(threw, true, "null event throws");
});

test("notify throws on missing event.id", async () => {
  const { post } = mockPost();
  const notifier = createSlackNotifier({ channel: "#alerts", post });
  let threw = false;
  try {
    await notifier.notify({ status: "escalated" } as any);
  } catch {
    threw = true;
  }
  eq(threw, true, "missing id throws");
});

test("post error propagates (fail-closed)", async () => {
  const post = async () => {
    throw new Error("slack down");
  };
  const notifier = createSlackNotifier({ channel: "#alerts", post });
  const ev = event({ id: "e15", tenantId: "t1", status: "escalated" });
  let threw = false;
  try {
    await notifier.notify(ev);
  } catch (e: any) {
    threw = true;
    assert(e.message.includes("slack down"), "error message preserved");
  }
  eq(threw, true, "post error propagates");
});
