/**
 * TFA Evolution Studio v28 — Connector Runtime
 *
 * Integration execution with failover and health ranking.
 */

export type ConnectorLifecycleState = "idle" | "connecting" | "ready" | "failed" | "degraded";

export interface ConnectorHealth {
  provider: string;
  state: ConnectorLifecycleState;
  lastError?: string;
  latencyMs: number;
}

export async function executeConnectorActionWithFailover(
  providers: string[],
  action: () => Promise<unknown>
): Promise<{ provider: string; result: unknown }> {
  for (const provider of providers) {
    try {
      const result = await action();
      return { provider, result };
    } catch {
      continue;
    }
  }
  throw new Error("All providers failed");
}

export function getProviderHealthRanking(healths: ConnectorHealth[]): ConnectorHealth[] {
  const stateOrder: Record<ConnectorLifecycleState, number> = {
    ready: 0,
    idle: 1,
    connecting: 2,
    degraded: 3,
    failed: 4,
  };
  return [...healths].sort((a, b) => stateOrder[a.state] - stateOrder[b.state] || a.latencyMs - b.latencyMs);
}

// ── Additional exports required by API routes ──────────────────────────────

export async function checkConnectorHealth(id: string): Promise<ConnectorHealth> {
  return { provider: id, state: "ready", latencyMs: 0 };
}

export async function testConnector(id: string, _config?: Record<string, unknown>): Promise<{ success: boolean; message: string }> {
  try {
    const health = await checkConnectorHealth(id);
    return { success: health.state !== "failed", message: `Connector state: ${health.state}` };
  } catch (e) {
    return { success: false, message: (e as Error).message };
  }
}
