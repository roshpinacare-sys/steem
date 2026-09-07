/**
 * TFA Evolution Studio v28 — Adapter Registry
 *
 * Versioned, pluggable adapter ecosystem with:
 *   - Manifest-validated plugin registration
 *   - External adapter registration via registerExternalAdapter()
 *   - Per-adapter health status cache
 *   - Fail-closed: any unknown targetId throws immediately
 *   - Discovery priority: exact targetId match → auto-discover
 */

import type { AdapterTarget, AdapterLifecycle, PluginManifest } from "@/lib/types";
import { PythonAdapter } from "./adapters/python-adapter";
import { NodeAdapter } from "./adapters/node-adapter";
import { NextJsAdapter } from "./adapters/nextjs-adapter";
import { StaticAdapter } from "./adapters/static-adapter";
import {
  validatePluginBundle,
  invokePluginLoad,
  invokePluginUnload,
  invokeHealthCheck,
  type PluginBundle,
} from "./plugin-contract";

interface RegistryEntry {
  target: AdapterTarget;
  lifecycle: AdapterLifecycle;
  manifest: PluginManifest;
  healthStatus: "healthy" | "degraded" | "unknown";
  healthCheckedAt?: string;
}

const ADAPTERS: Map<string, RegistryEntry> = new Map();

// ── Built-in adapter manifests ─────────────────────────────────────────────

function builtInManifest(targetId: string, version = "21.0.0"): PluginManifest {
  return {
    pluginId: `builtin:${targetId}`,
    targetId,
    version,
    minPlatformVersion: "20.0.0",
    capabilities: ["build", "install", "export", "preview"],
    author: "TFA Evolution Studio",
    description: `Built-in adapter for ${targetId}`,
    registeredAt: new Date().toISOString(),
  };
}

function registerBuiltIn(target: AdapterTarget, lifecycle: AdapterLifecycle): void {
  ADAPTERS.set(target.targetId, {
    target,
    lifecycle,
    manifest: builtInManifest(target.targetId),
    healthStatus: "healthy",
  });
}

registerBuiltIn(NodeAdapter.target, NodeAdapter.lifecycle);
registerBuiltIn(NextJsAdapter.target, NextJsAdapter.lifecycle);
registerBuiltIn(PythonAdapter.target, PythonAdapter.lifecycle);
registerBuiltIn(StaticAdapter.target, StaticAdapter.lifecycle);

// ── External adapter registration ─────────────────────────────────────────

export interface ExternalRegistrationResult {
  success: boolean;
  errors: string[];
  warnings: string[];
  targetId: string;
}

export async function registerExternalAdapter(
  bundle: PluginBundle,
  log: (msg: string) => void = () => {}
): Promise<ExternalRegistrationResult> {
  const { valid, errors, warnings } = validatePluginBundle(bundle);

  if (!valid) {
    return { success: false, errors, warnings, targetId: bundle.manifest.targetId };
  }

  // Invoke onLoad lifecycle hook
  try {
    await invokePluginLoad(bundle, log);
  } catch (e) {
    return {
      success: false,
      errors: [`onLoad failed: ${(e as Error).message}`],
      warnings,
      targetId: bundle.manifest.targetId,
    };
  }

  ADAPTERS.set(bundle.manifest.targetId, {
    target: bundle.target,
    lifecycle: bundle.lifecycle,
    manifest: { ...bundle.manifest, registeredAt: new Date().toISOString() },
    healthStatus: "unknown",
  });

  log(`[adapter-registry] Registered external adapter: ${bundle.manifest.pluginId}`);
  return { success: true, errors: [], warnings, targetId: bundle.manifest.targetId };
}

export async function unregisterAdapter(
  targetId: string,
  log: (msg: string) => void = () => {}
): Promise<boolean> {
  const entry = ADAPTERS.get(targetId);
  if (!entry) return false;
  const bundle: PluginBundle = {
    manifest: entry.manifest,
    target: entry.target,
    lifecycle: entry.lifecycle,
  };
  try {
    await invokePluginUnload(bundle, log);
  } catch {
    // best-effort unload
  }
  ADAPTERS.delete(targetId);
  return true;
}

// ── Health checks ─────────────────────────────────────────────────────────

export async function checkAdapterHealth(
  targetId: string
): Promise<{ healthy: boolean; detail?: string }> {
  const entry = ADAPTERS.get(targetId);
  if (!entry) return { healthy: false, detail: "Adapter not registered" };

  const bundle: PluginBundle = {
    manifest: entry.manifest,
    target: entry.target,
    lifecycle: entry.lifecycle,
  };
  const result = await invokeHealthCheck(bundle);
  entry.healthStatus = result.healthy ? "healthy" : "degraded";
  entry.healthCheckedAt = new Date().toISOString();
  return result;
}

export function getAdapterHealthStatus(
  targetId: string
): { status: RegistryEntry["healthStatus"]; checkedAt?: string } {
  const entry = ADAPTERS.get(targetId);
  if (!entry) return { status: "unknown" };
  return { status: entry.healthStatus, checkedAt: entry.healthCheckedAt };
}

// ── Public read API ────────────────────────────────────────────────────────

export function listAdapters(): AdapterTarget[] {
  return Array.from(ADAPTERS.values()).map((a) => a.target);
}

export function listAdapterManifests(): PluginManifest[] {
  return Array.from(ADAPTERS.values()).map((a) => a.manifest);
}

export function getAdapter(targetId: string): { target: AdapterTarget; lifecycle: AdapterLifecycle } {
  const entry = ADAPTERS.get(targetId);
  if (!entry) {
    throw new Error(`No adapter registered for target "${targetId}". Platform is fail-closed.`);
  }
  // Fail-closed on degraded health
  if (entry.healthStatus === "degraded") {
    throw new Error(
      `Adapter "${targetId}" is marked DEGRADED. Refusing to dispatch work. ` +
      `Run checkAdapterHealth("${targetId}") to re-probe.`
    );
  }
  return { target: entry.target, lifecycle: entry.lifecycle };
}

export function getAdapterManifest(targetId: string): PluginManifest | undefined {
  return ADAPTERS.get(targetId)?.manifest;
}

export async function discoverAdapter(projectRoot: string): Promise<AdapterTarget | undefined> {
    // Previously they were sorted last (degraded: 2) and could be "discovered",
  // but getAdapter() throws on degraded — making the discovery→dispatch path
  // incoherent. Now only healthy/unknown adapters are candidates; degraded
  // adapters must be explicitly requested after recovery via getAdapter().
  const sorted = Array.from(ADAPTERS.values())
    .filter(({ healthStatus }) => healthStatus !== "degraded")
    .sort((a, b) => {
      const rank = { healthy: 0, unknown: 1, degraded: 2 };
      return rank[a.healthStatus] - rank[b.healthStatus];
    });

  for (const { target, lifecycle } of sorted) {
    try {
      const discovered = await lifecycle.discover(projectRoot);
      if (discovered) return target;
    } catch {
      // discovery failed for this adapter — try next
    }
  }
  return undefined;
}

export function adapterExists(targetId: string): boolean {
  return ADAPTERS.has(targetId);
}
