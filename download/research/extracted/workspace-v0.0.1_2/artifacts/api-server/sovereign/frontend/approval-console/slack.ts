/**
 * frontend/approval-console/slack.ts — Slack channel notifier for the TFA
 * real-time approval console.
 *
 * Formats approval events into Slack webhook payloads, filters noise, and
 * deduplicates so a single escalated action does not spam the channel.
 *
 * Zero external dependencies.  The actual HTTP transport is injected via the
 * `post` callback so this stays sandbox-safe and testable.
 */

import type { ApprovalConsoleEvent, ConsoleRiskAssessment } from "./types.ts";

/** Minimal Slack payload — enough for Block Kit simple messages. */
export interface SlackPost {
  text: string;
  blocks?: Array<{
    type: string;
    text?: { type: string; text: string };
    fields?: Array<{ type: string; text: string }>;
  }>;
}

export interface SlackNotifier {
  /** Send a single event to Slack if it passes the filter & dedup gate. */
  notify(event: ApprovalConsoleEvent): Promise<boolean>;
  /** Clear the deduplication cache (useful in tests or after long pauses). */
  flush(): void;
  /** Return true if the event would be filtered out (not sent). */
  wouldFilter(event: ApprovalConsoleEvent): boolean;
}

export interface SlackNotifierOptions {
  /** Target channel name (embedded in payload for audit trail). */
  channel: string;
  /** Injected transport — called when an event passes all gates. */
  post: (payload: SlackPost) => Promise<void>;
  /** Custom predicate. Default notifies on pending / escalated / error / critical. */
  filter?: (event: ApprovalConsoleEvent) => boolean;
  /** Deduplication window in milliseconds. Default = 60_000. */
  dedupWindowMs?: number;
}

/** Default filter: only events that require human attention. */
export function defaultSlackFilter(event: ApprovalConsoleEvent): boolean {
  const status = event.status;
  if (status === "escalated" || status === "pending" || status === "error") {
    return true;
  }
  const critical = event.assessment?.factors?.some(
    (f) => f.contribution >= 25,
  );
  if (critical) return true;
  return false;
}

/** Format an approval event as a Slack Block Kit payload. */
export function formatSlackPayload(
  event: ApprovalConsoleEvent,
  channel: string,
): SlackPost {
  const statusEmoji = statusToEmoji(event.status);
  const headline = `${statusEmoji} Approval *${event.status}* — \`${event.actionType}\``;

  const fields: SlackPost["blocks"][number]["fields"] = [
    { type: "mrkdwn", text: `*Actor*\n${event.actorId}` },
    { type: "mrkdwn", text: `*Event ID*\n${event.id}` },
    { type: "mrkdwn", text: `*Tenant*\n${event.tenantId}` },
    { type: "mrkdwn", text: `*Time*\n${event.timestamp}` },
  ];

  if (event.assessment) {
    fields.push(
      {
        type: "mrkdwn",
        text: `*Risk Score*\n${Math.round(event.assessment.riskScore)}/100`,
      },
      {
        type: "mrkdwn",
        text: `*Effective Class*\n${event.assessment.effectiveApprovalClass}`,
      },
    );
  }

  const blocks: SlackPost["blocks"] = [
    {
      type: "header",
      text: { type: "plain_text", text: headline },
    },
    {
      type: "section",
      fields,
    },
  ];

  if (event.assessment?.factors?.length) {
    const factorText = event.assessment.factors
      .map((f) => `• *${f.factor}* (+${f.contribution}) — ${f.detail}`)
      .join("\n");
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*Risk Factors*\n${factorText}` },
    });
  }

  const text = `${statusEmoji} Approval ${event.status} for ${event.actionType} (actor: ${event.actorId}, tenant: ${event.tenantId}) — ${channel}`;

  return { text, blocks };
}

function statusToEmoji(status: ApprovalConsoleEvent["status"]): string {
  switch (status) {
    case "approved":
      return "✅";
    case "denied":
      return "🚫";
    case "pending":
      return "⏳";
    case "escalated":
      return "🔺";
    case "error":
      return "⚠️";
    default:
      return "ℹ️";
  }
}

/** Create a Slack notifier with filtering and deduplication. */
export function createSlackNotifier(
  opts: SlackNotifierOptions,
): SlackNotifier {
  const channel = opts.channel;
  const post = opts.post;
  const filter = opts.filter ?? defaultSlackFilter;
  const dedupWindowMs = opts.dedupWindowMs ?? 60_000;

  const sent = new Map<string, number>();

  function prune(now: number): void {
    const cutoff = now - dedupWindowMs;
    for (const [id, ts] of sent) {
      if (ts < cutoff) sent.delete(id);
    }
  }

  function isDuplicate(id: string, now: number): boolean {
    prune(now);
    return sent.has(id);
  }

  return {
    async notify(event: ApprovalConsoleEvent): Promise<boolean> {
      if (!event || typeof event !== "object") {
        throw new Error("slack-notify: event must be an object");
      }
      if (!event.id || typeof event.id !== "string") {
        throw new Error("slack-notify: event.id must be a non-empty string");
      }

      if (!filter(event)) return false;

      const now = Date.now();
      if (isDuplicate(event.id, now)) return false;

      const payload = formatSlackPayload(event, channel);
      await post(payload);
      sent.set(event.id, now);
      return true;
    },

    flush(): void {
      sent.clear();
    },

    wouldFilter(event: ApprovalConsoleEvent): boolean {
      return !filter(event);
    },
  };
}
