import { isIP } from "node:net";

export type SovereignNetworkMode = "online" | "local_only" | "air_gapped";

export interface NetworkAttempt {
  id: string;
  attemptedAt: string;
  mode: SovereignNetworkMode;
  url: string;
  hostname: string;
  allowed: boolean;
  reason: string;
  actor: string;
  toolId?: string;
  tenantId?: string;
  workspaceId?: string;
}

const LOCAL_HOSTS = new Set(["localhost", "localhost.localdomain"]);

function isLoopbackAddress(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (LOCAL_HOSTS.has(normalized)) return true;
  if (normalized === "::1" || normalized.startsWith("127.")) return true;
  if (isIP(normalized) === 6 && normalized.toLowerCase() === "0:0:0:0:0:0:0:1") return true;
  return false;
}

export function evaluateNetworkRequest(options: {
  mode: SovereignNetworkMode;
  url: string;
  actor: string;
  toolId?: string;
  tenantId?: string;
  workspaceId?: string;
  allowLocalhost?: boolean;
  now?: Date;
}): NetworkAttempt {
  let parsed: URL;
  try {
    parsed = new URL(options.url);
  } catch {
    throw new Error("network_url_invalid");
  }
  const hostname = parsed.hostname.toLowerCase();
  const local = isLoopbackAddress(hostname);
  let allowed = true;
  let reason = "online_mode_allowed";
  if (options.mode === "local_only") {
    allowed = local && options.allowLocalhost !== false;
    reason = allowed ? "local_endpoint_allowed" : "remote_endpoint_blocked_local_only";
  } else if (options.mode === "air_gapped") {
    allowed = local && options.allowLocalhost === true;
    reason = allowed ? "explicit_local_endpoint_allowed" : "network_blocked_air_gap";
  }
  return {
    id: `${(options.now ?? new Date()).getTime()}-${hostname}-${Math.random().toString(16).slice(2, 10)}`,
    attemptedAt: (options.now ?? new Date()).toISOString(),
    mode: options.mode,
    url: parsed.toString(),
    hostname,
    allowed,
    reason,
    actor: options.actor,
    toolId: options.toolId,
    tenantId: options.tenantId,
    workspaceId: options.workspaceId,
  };
}

export class SovereignNetworkGuard {
  private readonly attempts: NetworkAttempt[] = [];

  constructor(
    readonly mode: SovereignNetworkMode,
    readonly allowLocalhost = false,
  ) {}

  authorize(options: Omit<Parameters<typeof evaluateNetworkRequest>[0], "mode" | "allowLocalhost">): NetworkAttempt {
    const attempt = evaluateNetworkRequest({
      ...options,
      mode: this.mode,
      allowLocalhost: this.allowLocalhost,
    });
    this.attempts.push(attempt);
    if (!attempt.allowed) throw new Error(`${attempt.reason}:${attempt.hostname}`);
    return attempt;
  }

  getEvidence(): NetworkAttempt[] {
    return this.attempts.map((attempt) => ({ ...attempt }));
  }
}
