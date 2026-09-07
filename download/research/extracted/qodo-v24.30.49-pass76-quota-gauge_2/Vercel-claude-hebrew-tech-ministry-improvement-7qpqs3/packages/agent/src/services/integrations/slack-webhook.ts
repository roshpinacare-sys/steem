/**
 * slack-webhook.ts — Integration 2: Slack Webhook → Decision Broadcast
 *
 * Sends structured Slack messages for phase transitions, gate failures,
 * and revert events using an incoming webhook URL.
 */
import { z } from "zod";
import { fetchWithTimeout } from "../../utils/fetch-timeout.js";
import type { Telemetry } from "../telemetry.js";

// ---------------------------------------------------------------------------
// Config schema
// ---------------------------------------------------------------------------

export const SlackWebhookConfigSchema = z.object({
  webhookUrl: z.string().url(),
  channel: z.string().optional(),
  username: z.string().default("Qodo Agent"),
  iconEmoji: z.string().default(":robot_face:"),
}).strict();

export type SlackWebhookConfig = z.infer<typeof SlackWebhookConfigSchema>;

export type SlackEventType = "phase_transition" | "gate_failure" | "revert";

export interface SlackEvent {
  type: SlackEventType;
  /** Phase that was completed / failed. */
  phase?: string;
  /** Human-readable description of what happened. */
  message: string;
  /** Optional PR or run identifier. */
  ref?: string | number;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Posts a Slack message for the given event.  Retries once on transient
 * network error.  Never throws — failures are logged via telemetry only.
 */
export async function notifySlack(
  event: SlackEvent,
  cfg: SlackWebhookConfig,
  telemetry?: Telemetry,
): Promise<void> {
  if (process.env.QODO_PRIVACY_MODE === "strict") return;

  const emoji: Record<SlackEventType, string> = {
    phase_transition: ":white_check_mark:",
    gate_failure: ":x:",
    revert: ":rewind:",
  };

  const text = `${emoji[event.type] ?? ":bell:"} *${event.type.replace("_", " ").toUpperCase()}*${event.phase ? ` — \`${event.phase}\`` : ""}${event.ref !== undefined ? ` (ref: ${event.ref})` : ""}\n${event.message}`;

  const payload: Record<string, unknown> = { text };
  if (cfg.channel) payload.channel = cfg.channel;
  if (cfg.username) payload.username = cfg.username;
  if (cfg.iconEmoji) payload.icon_emoji = cfg.iconEmoji;

  const send = async () =>
    fetchWithTimeout(
      cfg.webhookUrl,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
      10_000,
    );

  try {
    const res = await send();
    if (!res.ok) {
      // One retry
      const retry = await send();
      if (!retry.ok) {
        await telemetry?.decision("slack-webhook", "send-failed", { status: retry.status, event: event.type });
        return;
      }
    }
    await telemetry?.decision("slack-webhook", "sent", { event: event.type, phase: event.phase });
  } catch (e: unknown) {
    await telemetry?.decision("slack-webhook", "send-error", { error: e instanceof Error ? e.message : String(e) });
  }
}

/**
 * Build a SlackWebhookConfig from environment variables.
 * Returns null when SLACK_WEBHOOK_URL is absent (Slack integration opt-in).
 */
export function resolveSlackConfig(
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): SlackWebhookConfig | null {
  const webhookUrl = env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) return null;
  return SlackWebhookConfigSchema.parse({
    webhookUrl,
    channel: env.SLACK_CHANNEL,
  });
}
