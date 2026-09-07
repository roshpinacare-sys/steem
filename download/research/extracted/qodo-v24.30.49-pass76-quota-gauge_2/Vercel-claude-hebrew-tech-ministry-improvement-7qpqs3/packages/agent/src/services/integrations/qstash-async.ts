/**
 * qstash-async.ts — Integration 4: Upstash QStash → Async Task Queue
 *
 * Publishes background tasks (astdoc generation, SRE feedback, compliance
 * scan) to Upstash QStash so they run after pipeline completion instead of
 * blocking the hot path.
 *
 * Falls back to synchronous execution when QStash is not configured.
 */
import { z } from "zod";
import { fetchWithTimeout } from "../../utils/fetch-timeout.js";
import type { Telemetry } from "../telemetry.js";

// ---------------------------------------------------------------------------
// Config schema
// ---------------------------------------------------------------------------

export const QStashConfigSchema = z.object({
  token: z.string().min(1),
  signingKey: z.string().min(1),
  apiBaseUrl: z.string().url().default("https://qstash.upstash.io/v2"),
}).strict();

export type QStashConfig = z.infer<typeof QStashConfigSchema>;

export type QStashTaskType = "astdoc_generation" | "sre_feedback" | "compliance_scan";

export interface QStashTask {
  type: QStashTaskType;
  agentId: string;
  /** Serializable payload forwarded to the receiving endpoint. */
  payload: Record<string, unknown>;
  /** Absolute URL the QStash delivery will POST the task to. */
  callbackUrl: string;
  /** Optional delay in seconds (QStash not-before). */
  delaySeconds?: number;
}

export interface QStashPublishResult {
  /** Whether the task was published (false = fell back to sync or misconfigured). */
  published: boolean;
  messageId?: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Publishes an async task to QStash.
 * Returns `{ published: false }` when QStash is not configured or on error,
 * signalling the caller to execute the task synchronously.
 */
export async function publishAsyncTask(
  task: QStashTask,
  cfg: QStashConfig,
  telemetry?: Telemetry,
): Promise<QStashPublishResult> {
  if (process.env.QODO_PRIVACY_MODE === "strict") {
    return { published: false };
  }

  const destination = encodeURIComponent(task.callbackUrl);
  const url = `${cfg.apiBaseUrl}/publish/${destination}`;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${cfg.token}`,
    "Content-Type": "application/json",
    "Upstash-Retries": "3",
  };
  if (task.delaySeconds) {
    headers["Upstash-Delay"] = `${task.delaySeconds}s`;
  }

  const body = JSON.stringify({
    type: task.type,
    agentId: task.agentId,
    payload: task.payload,
  });

  try {
    const res = await fetchWithTimeout(url, { method: "POST", headers, body }, 10_000);
    if (!res.ok) {
      await telemetry?.decision("qstash-async", "publish-failed", { status: res.status, taskType: task.type });
      return { published: false };
    }
    const data = (await res.json()) as { messageId?: string };
    await telemetry?.decision("qstash-async", "published", { taskType: task.type, messageId: data.messageId });
    return { published: true, messageId: data.messageId };
  } catch (e: unknown) {
    await telemetry?.decision("qstash-async", "publish-error", { error: e instanceof Error ? e.message : String(e), taskType: task.type });
    return { published: false };
  }
}

/**
 * Build a QStashConfig from environment variables.
 * Returns null when required vars are absent (opt-in integration).
 */
export function resolveQStashConfig(
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): QStashConfig | null {
  if (!env.QSTASH_TOKEN || !env.QSTASH_CURRENT_SIGNING_KEY) return null;
  return QStashConfigSchema.parse({
    token: env.QSTASH_TOKEN,
    signingKey: env.QSTASH_CURRENT_SIGNING_KEY,
  });
}
