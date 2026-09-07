/**
 * Support Ticket Bridge (T1/T2) — Customer Loop entry point.
 *
 * Pulls open support tickets from Zendesk or Intercom, classifies complaint-
 * shaped tickets as candidate objectives, fingerprints them against open
 * Sentry issues / GitHub issues / in-flight objectives to avoid duplicates,
 * and returns a ranked list of new objectives ready for the Supervisor.
 */
import { z } from "zod";
import { log } from "./logger.js";
import { fetchWithTimeout } from "../utils/fetch-timeout.js";
import type { Telemetry } from "./telemetry.js";
import type { RedisState } from "./redis-state.js";

export interface SupportTicket {
  id: string;
  subject: string;
  body: string;
  source: "zendesk" | "intercom";
  url: string;
  createdAt: string;
  priority?: "low" | "normal" | "high" | "urgent";
}

export interface TicketObjective {
  ticketId: string;
  source: "zendesk" | "intercom";
  objective: string;
  customerWords: string;
  affectedUserCount: number;
  priorityBoost: number; // multiplier for mission-priority impact score
  url: string;
  fingerprint: string;
}

export interface TicketDedupResult {
  newObjectives: TicketObjective[];
  duplicates: TicketObjective[];
}

// ---------------------------------------------------------------------------
// Config schemas
// ---------------------------------------------------------------------------

export const ZendeskConfigSchema = z.object({
  provider: z.literal("zendesk"),
  subdomain: z.string().min(1),
  token: z.string().min(1),
  email: z.string().email(),
}).strict();

export const IntercomConfigSchema = z.object({
  provider: z.literal("intercom"),
  accessToken: z.string().min(1),
}).strict();

export const SupportTicketConfigSchema = z.union([ZendeskConfigSchema, IntercomConfigSchema]);
export type SupportTicketConfig = z.infer<typeof SupportTicketConfigSchema>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isComplaintShaped(text: string): boolean {
  const negative = /\b(broken|not working|doesn'?t work|fails?|error|bug|issue|crash|slow|timeout|can't|unable|wrong|missing)\b/i;
  const positiveFeature = /\b(feature request|would be nice|enhancement|improvement|please add|wish)\b/i;
  return negative.test(text) && !positiveFeature.test(text);
}

function normalizeFingerprint(text: string): string {
  // Strip common stop words, sort remaining stems, take first 8 unique words
  const stops = new Set(["the", "a", "an", "is", "are", "was", "were", "be", "been", "being", "have", "has", "had", "do", "does", "did", "will", "would", "could", "should", "may", "might", "must", "shall", "can", "need", "dare", "ought", "used", "to", "of", "in", "for", "on", "with", "at", "by", "from", "as", "into", "through", "during", "before", "after", "above", "below", "between", "among", "and", "but", "or", "yet", "so", "if", "because", "although", "though", "while", "where", "when", "that", "which", "who", "whom", "whose", "what", "this", "these", "those", "i", "me", "my", "we", "us", "our", "you", "your", "he", "him", "his", "she", "her", "it", "its", "they", "them", "their"]);
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stops.has(w))
    .sort()
    .slice(0, 4)
    .join(" ");
}

async function fetchZendeskTickets(cfg: z.infer<typeof ZendeskConfigSchema>): Promise<SupportTicket[]> {
  const auth = Buffer.from(`${cfg.email}/token:${cfg.token}`).toString("base64");
  const url = `https://${cfg.subdomain}.zendesk.com/api/v2/tickets.json?status=open&per_page=100`;
  const res = await fetchWithTimeout(
    url,
    { headers: { Authorization: `Basic ${auth}`, Accept: "application/json" } },
    15_000,
  );
  if (!res.ok) throw new Error(`Zendesk HTTP ${res.status}`);
  const data = (await res.json()) as { tickets?: Array<{ id: number; subject: string; description?: string; created_at: string; priority?: string; url: string }> };
  return (data.tickets || []).map((t) => ({
    id: `zendesk-${t.id}`,
    subject: t.subject,
    body: (t.description ?? "").slice(0, 2000),
    source: "zendesk" as const,
    url: t.url,
    createdAt: t.created_at,
    priority: (t.priority as SupportTicket["priority"]) || "normal",
  }));
}

async function fetchIntercomTickets(cfg: z.infer<typeof IntercomConfigSchema>): Promise<SupportTicket[]> {
  const res = await fetchWithTimeout(
    "https://api.intercom.io/conversations?open=true&per_page=50",
    {
      headers: {
        Authorization: `Bearer ${cfg.accessToken}`,
        Accept: "application/json",
        "Intercom-Version": "2.11",
      },
    },
    15_000,
  );
  if (!res.ok) throw new Error(`Intercom HTTP ${res.status}`);
  const data = (await res.json()) as { conversations?: Array<{ id: string; source?: { subject?: string; body?: string }; created_at: number; priority?: string; links?: { conversation_web?: string } }> };
  return (data.conversations || []).map((c) => ({
    id: `intercom-${c.id}`,
    subject: c.source?.subject ?? "(no subject)",
    body: (c.source?.body ?? "").slice(0, 2000),
    source: "intercom" as const,
    url: c.links?.conversation_web ?? `https://app.intercom.com/a/inbox/conversations/${c.id}`,
    createdAt: new Date((c.created_at || 0) * 1000).toISOString(),
    priority: (c.priority as SupportTicket["priority"]) || "normal",
  }));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function resolveSupportTicketConfig(
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): SupportTicketConfig | null {
  if (env.ZENDESK_SUBDOMAIN && env.ZENDESK_TOKEN && env.ZENDESK_EMAIL) {
    return SupportTicketConfigSchema.parse({
      provider: "zendesk",
      subdomain: env.ZENDESK_SUBDOMAIN,
      token: env.ZENDESK_TOKEN,
      email: env.ZENDESK_EMAIL,
    });
  }
  if (env.INTERCOM_ACCESS_TOKEN) {
    return SupportTicketConfigSchema.parse({ provider: "intercom", accessToken: env.INTERCOM_ACCESS_TOKEN });
  }
  return null;
}

/** Fetch complaint-shaped support tickets. */
export async function fetchSupportTickets(
  cfg: SupportTicketConfig,
  telemetry?: Telemetry,
): Promise<SupportTicket[]> {
  if (process.env.QODO_PRIVACY_MODE === "strict") {
    await telemetry?.decision("support-ticket-bridge", "skipped-privacy-mode", {});
    return [];
  }

  try {
    const tickets = cfg.provider === "zendesk"
      ? await fetchZendeskTickets(cfg)
      : await fetchIntercomTickets(cfg);
    const complaints = tickets.filter((t) => isComplaintShaped(`${t.subject} ${t.body}`));
    await telemetry?.decision("support-ticket-bridge", "tickets-fetched", {
      provider: cfg.provider,
      total: tickets.length,
      complaints: complaints.length,
    });
    return complaints;
  } catch (e: unknown) {
    log.warn("support-ticket-bridge: fetch failed", { error: e instanceof Error ? e.message : String(e) });
    await telemetry?.decision("support-ticket-bridge", "fetch-error", { error: e instanceof Error ? e.message : String(e) });
    return [];
  }
}

/**
 * Build candidate objectives and deduplicate them against known fingerprints.
 * `knownFingerprints` should come from:
 *   - open Sentry issue titles
 *   - open GitHub issue titles
 *   - in-flight mission queue objectives (mission-priority.ts)
 */
export function buildTicketObjectives(
  tickets: SupportTicket[],
  knownFingerprints: string[] = [],
): TicketDedupResult {
  const newObjectives: TicketObjective[] = [];
  const duplicates: TicketObjective[] = [];

  const complaints = tickets.filter((t) => isComplaintShaped(`${t.subject} ${t.body}`));
  const seen = new Set(knownFingerprints.map(normalizeFingerprint));

  for (const ticket of complaints) {
    const combined = `${ticket.subject} ${ticket.body}`.slice(0, 3000);
    const fingerprint = normalizeFingerprint(combined);
    const priorityBoost = { low: 1, normal: 1.2, high: 1.5, urgent: 2 }[ticket.priority || "normal"];

    const objective: TicketObjective = {
      ticketId: ticket.id,
      source: ticket.source,
      objective: `[${ticket.source}] ${ticket.subject}`,
      customerWords: combined,
      affectedUserCount: 1, // single ticket; aggregation handled by caller
      priorityBoost,
      url: ticket.url,
      fingerprint,
    };

    if (seen.has(fingerprint)) {
      duplicates.push(objective);
    } else {
      seen.add(fingerprint);
      newObjectives.push(objective);
    }
  }

  return { newObjectives, duplicates };
}

/** Aggregate duplicate tickets under the same objective with affected-user counts. */
export function aggregateDuplicates(objectives: TicketObjective[]): TicketObjective[] {
  const groups = new Map<string, TicketObjective[]>();
  for (const o of objectives) {
    const list = groups.get(o.fingerprint) || [];
    list.push(o);
    groups.set(o.fingerprint, list);
  }
  return Array.from(groups.values()).map((group) => ({
    ...group[0],
    affectedUserCount: group.length,
  }));
}

/**
 * Convenience: fetch + dedup + aggregate. Returns a list of unique
 * customer-driven objectives ready to be scored by mission-priority.
 */
export async function discoverTicketObjectives(
  cfg: SupportTicketConfig,
  state: RedisState,
  telemetry?: Telemetry,
): Promise<TicketObjective[]> {
  const tickets = await fetchSupportTickets(cfg, telemetry);
  if (!tickets.length) return [];

  // Load known fingerprints from in-flight mission queue
  let known: string[] = [];
  try {
    const { peekQueue } = await import("./mission-priority.js");
    const queue = await peekQueue(state);
    known = queue.map((m) => normalizeFingerprint(m.objective));
  } catch {
    // best-effort
  }

  const { newObjectives, duplicates } = buildTicketObjectives(tickets, known);
  const aggregated = aggregateDuplicates([...newObjectives, ...duplicates]);

  await telemetry?.decision("support-ticket-bridge", "objectives-discovered", {
    unique: aggregated.length,
    duplicates: duplicates.length,
  });
  return aggregated;
}
