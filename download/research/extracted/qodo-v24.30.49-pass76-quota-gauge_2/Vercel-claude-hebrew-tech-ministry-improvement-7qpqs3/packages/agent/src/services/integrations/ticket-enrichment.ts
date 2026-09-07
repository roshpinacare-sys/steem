/**
 * ticket-enrichment.ts — Integration 7: Linear / Jira → Objective Enrichment
 *
 * Detects ticket ID patterns (LIN-123, PROJ-456) in the objective string.
 * When detected, fetches title, description, and acceptance criteria from
 * Linear (GraphQL) or Jira (REST v3) and returns an enriched objective.
 */
import { z } from "zod";
import { fetchWithTimeout } from "../../utils/fetch-timeout.js";
import type { Telemetry } from "../telemetry.js";

// ---------------------------------------------------------------------------
// Config schema
// ---------------------------------------------------------------------------

export const TicketEnrichmentConfigSchema = z.discriminatedUnion("provider", [
  z.object({
    provider: z.literal("linear"),
    linearApiKey: z.string().min(1),
  }).strict(),
  z.object({
    provider: z.literal("jira"),
    jiraBaseUrl: z.string().url(),
    jiraToken: z.string().min(1),
  }).strict(),
]);

export type TicketEnrichmentConfig = z.infer<typeof TicketEnrichmentConfigSchema>;

export interface TicketDetails {
  id: string;
  title: string;
  description: string;
  acceptanceCriteria: string;
  url: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TICKET_REGEX = /\b([A-Z][A-Z0-9]+-\d+)\b/;

function detectTicketId(objective: string): string | null {
  return TICKET_REGEX.exec(objective)?.[1] ?? null;
}

async function fetchLinearIssue(id: string, apiKey: string): Promise<TicketDetails | null> {
  const query = `{
    issue(id: "${id}") {
      identifier title description url
      team { name }
    }
  }`;
  const res = await fetchWithTimeout(
    "https://api.linear.app/graphql",
    {
      method: "POST",
      headers: { Authorization: apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    },
    10_000,
  );
  if (!res.ok) return null;
  const body = (await res.json()) as { data?: { issue?: { identifier: string; title: string; description?: string; url: string } } };
  const issue = body.data?.issue;
  if (!issue) return null;
  return {
    id: issue.identifier,
    title: issue.title,
    description: (issue.description ?? "").slice(0, 3000),
    acceptanceCriteria: "",
    url: issue.url,
  };
}

async function fetchJiraIssue(
  id: string,
  baseUrl: string,
  token: string,
): Promise<TicketDetails | null> {
  const url = `${baseUrl}/rest/api/3/issue/${encodeURIComponent(id)}?fields=summary,description,acceptanceCriteria`;
  const res = await fetchWithTimeout(
    url,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    },
    10_000,
  );
  if (!res.ok) return null;
  const body = (await res.json()) as {
    key: string;
    fields?: {
      summary?: string;
      description?: { content?: Array<{ content?: Array<{ text?: string }> }> };
      acceptanceCriteria?: string;
    };
    self: string;
  };
  const f = body.fields ?? {};
  const descText = f.description?.content
    ?.flatMap((b) => b.content?.map((n) => n.text ?? "") ?? [])
    .join(" ")
    .slice(0, 3000) ?? "";
  return {
    id: body.key,
    title: f.summary ?? body.key,
    description: descText,
    acceptanceCriteria: f.acceptanceCriteria ?? "",
    url: `${baseUrl}/browse/${body.key}`,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Enriches an objective string with ticket details when a ticket ID is found.
 * Returns the original objective unchanged if no ticket ID is detected or
 * the API call fails.
 */
export async function enrichObjectiveFromTicket(
  objective: string,
  cfg: TicketEnrichmentConfig,
  telemetry?: Telemetry,
): Promise<string> {
  if (process.env.QODO_PRIVACY_MODE === "strict") return objective;

  const ticketId = detectTicketId(objective);
  if (!ticketId) {
    await telemetry?.decision("ticket-enrichment", "no-ticket-detected", {});
    return objective;
  }

  let details: TicketDetails | null = null;
  try {
    if (cfg.provider === "linear") {
      details = await fetchLinearIssue(ticketId, cfg.linearApiKey);
    } else {
      details = await fetchJiraIssue(ticketId, cfg.jiraBaseUrl, cfg.jiraToken);
    }
  } catch (e: unknown) {
    await telemetry?.decision("ticket-enrichment", "fetch-error", { error: e instanceof Error ? e.message : String(e) });
    return objective;
  }

  if (!details) {
    await telemetry?.decision("ticket-enrichment", "not-found", { ticketId });
    return objective;
  }

  await telemetry?.decision("ticket-enrichment", "enriched", { ticketId, provider: cfg.provider });

  const parts = [
    objective,
    `\n--- Ticket ${details.id}: ${details.title} (${details.url}) ---`,
  ];
  if (details.description) parts.push(`Description: ${details.description}`);
  if (details.acceptanceCriteria) parts.push(`Acceptance Criteria: ${details.acceptanceCriteria}`);

  return parts.join("\n");
}

/**
 * Build a TicketEnrichmentConfig from environment variables.
 * Returns null when neither Linear nor Jira vars are present.
 */
export function resolveTicketConfig(
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): TicketEnrichmentConfig | null {
  if (env.LINEAR_API_KEY) {
    return TicketEnrichmentConfigSchema.parse({ provider: "linear", linearApiKey: env.LINEAR_API_KEY });
  }
  if (env.JIRA_BASE_URL && env.JIRA_TOKEN) {
    return TicketEnrichmentConfigSchema.parse({ provider: "jira", jiraBaseUrl: env.JIRA_BASE_URL, jiraToken: env.JIRA_TOKEN });
  }
  return null;
}
