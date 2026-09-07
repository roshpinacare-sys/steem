/**
 * dispatch.ts — send a mission to the agent through the proxy's /dispatch
 * route (which triggers the GitHub workflow_dispatch). Shared by the mobile
 * dispatch sheet; the desktop CommandPalette keeps its own inline flow.
 */
import { fetchWithTimeout } from "./fetch-timeout.js";
import { getSessionToken } from "./session.js";

export async function postDispatch(
  proxyUrl: string,
  objective: string,
  repo: string,
  feedback?: string,
): Promise<void> {
  const body: Record<string, string> = { objective: objective.trim(), repo: repo.trim() };
  if (feedback) body.feedback = feedback;
  const token = await getSessionToken(proxyUrl);
  const r = await fetchWithTimeout(
    `${proxyUrl}/dispatch`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Qodo-Session": token },
      body: JSON.stringify(body),
    },
    30_000,
  );
  const data = (await r.json().catch(() => ({}))) as { error?: string };
  if (!r.ok) throw new Error(data.error || `dispatch failed (${r.status})`);
}
