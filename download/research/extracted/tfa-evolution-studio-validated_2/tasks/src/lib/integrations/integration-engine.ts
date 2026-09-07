/**
 * TFA Evolution Studio v28 — Integration Engine
 *
 * Connector management with health checks,
 * test flows, and configuration validation.
 */

import fs from "fs";
import path from "path";
import { getIntegrationDir, ensureDir } from "@/lib/paths";
import type { Integration } from "@/lib/types";

const INTEGRATIONS_FILE = path.join(getIntegrationDir(), "integrations.json");

function loadIntegrations(): Integration[] {
  if (!fs.existsSync(INTEGRATIONS_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(INTEGRATIONS_FILE, "utf-8")) as Integration[];
  } catch {
    return [];
  }
}

function saveIntegrations(integrations: Integration[]): void {
  ensureDir(path.dirname(INTEGRATIONS_FILE));
  fs.writeFileSync(INTEGRATIONS_FILE, JSON.stringify(integrations, null, 2));
}

export function listIntegrations(): Integration[] {
  return loadIntegrations();
}

export function getIntegration(id: string): Integration | undefined {
  return loadIntegrations().find((i) => i.id === id);
}

export function createIntegration(
  integration: Omit<Integration, "id" | "healthStatus" | "lastTestedAt">
): Integration {
  const integrations = loadIntegrations();
  const newIntegration: Integration = {
    ...integration,
    id: `int_${Date.now()}`,
    healthStatus: "unknown",
  };
  integrations.push(newIntegration);
  saveIntegrations(integrations);
  return newIntegration;
}

export function updateIntegration(id: string, updates: Partial<Integration>): Integration | undefined {
  const integrations = loadIntegrations();
  const idx = integrations.findIndex((i) => i.id === id);
  if (idx === -1) return undefined;
  integrations[idx] = { ...integrations[idx], ...updates };
  saveIntegrations(integrations);
  return integrations[idx];
}

export function deleteIntegration(id: string): boolean {
  const integrations = loadIntegrations();
  const idx = integrations.findIndex((i) => i.id === id);
  if (idx === -1) return false;
  integrations.splice(idx, 1);
  saveIntegrations(integrations);
  return true;
}

export async function testIntegration(id: string): Promise<{ success: boolean; message: string }> {
  const integration = getIntegration(id);
  if (!integration) return { success: false, message: "Integration not found" };

  // Simulated test based on kind
  let success = false;
  let message: string;

  switch (integration.kind) {
    case "webhook": {
      const url = integration.config.url as string;
      success = typeof url === "string" && url.startsWith("http");
      message = success ? "Webhook URL is valid." : "Webhook URL is missing or invalid.";
      break;
    }
    case "slack": {
      const token = integration.config.token as string;
      success = typeof token === "string" && token.length > 10;
      message = success ? "Slack token looks valid." : "Slack token is missing or too short.";
      break;
    }
    case "github": {
      const token = integration.config.token as string;
      success = typeof token === "string" && token.startsWith("ghp_");
      message = success ? "GitHub token format is valid." : "GitHub token format is invalid.";
      break;
    }
    default:
      message = "Test not implemented for this integration kind.";
  }

  const healthStatus: Integration["healthStatus"] = success ? "healthy" : "unhealthy";
  updateIntegration(id, { healthStatus, lastTestedAt: new Date().toISOString() });
  return { success, message };
}
