/**
 * TFA Evolution Studio v28 — Connector Registry
 */

import { ConnectorKind } from "./connector-types";

const connectors = new Map<string, ConnectorKind>();

export function registerConnector(id: string, kind: ConnectorKind): void {
  connectors.set(id, kind);
}

export function getConnectorKind(id: string): ConnectorKind | undefined {
  return connectors.get(id);
}

export function listConnectors(_projectId?: string): { id: string; kind: ConnectorKind }[] {
  return Array.from(connectors.entries()).map(([id, kind]) => ({ id, kind }));
}

// ── Additional exports required by API routes ──────────────────────────────

import type { Integration } from "@/lib/types";

const integrationStore = new Map<string, Integration>();

export const CONNECTOR_CATALOG: { kind: ConnectorKind; label: string; description: string }[] = [
  { kind: "webhook", label: "Webhook", description: "Generic HTTP webhook" },
  { kind: "slack", label: "Slack", description: "Slack notifications" },
  { kind: "github", label: "GitHub", description: "GitHub integration" },
  { kind: "jira", label: "Jira", description: "Jira issue tracking" },
  { kind: "rest", label: "Generic REST", description: "Generic REST API" },
];

export function createConnector(data: Omit<Integration, "id" | "healthStatus" | "lastTestedAt">): Integration {
  const integration: Integration = {
    ...data,
    id: `int_${Date.now()}`,
    healthStatus: "unknown",
  };
  integrationStore.set(integration.id, integration);
  return integration;
}

export function getConnector(id: string): Integration | undefined {
  return integrationStore.get(id);
}

export function updateConnector(id: string, updates: Partial<Integration>): Integration | undefined {
  const existing = integrationStore.get(id);
  if (!existing) return undefined;
  const updated = { ...existing, ...updates };
  integrationStore.set(id, updated);
  return updated;
}

export function deleteConnector(id: string): boolean {
  return integrationStore.delete(id);
}

export function maskSensitiveConfig<T extends object>(config: T): T {
  const sensitiveKeys = ["token", "secret", "password", "apiKey", "api_key", "key"];
  return Object.fromEntries(
    Object.entries(config).map(([k, v]) =>
      sensitiveKeys.some((s) => k.toLowerCase().includes(s)) ? [k, "***"] : [k, v]
    )
  ) as T;
}
