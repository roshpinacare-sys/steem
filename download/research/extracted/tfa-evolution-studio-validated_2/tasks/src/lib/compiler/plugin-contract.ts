/**
 * TFA Evolution Studio v28 — Plugin Contract
 *
 * Formal contract for the adapter/plugin ecosystem.
 * Every plugin must satisfy this contract to be registered.
 *
 * Design goals:
 *   - Stable versioned interface that evolves without breaking existing adapters
 *   - Manifest declares capabilities — platform routes only to capable adapters
 *   - Lifecycle hooks allow safe load/unload without touching core logic
 *   - Health check allows the registry to fail-closed on degraded adapters
 *   - minPlatformVersion lets plugins declare their compatibility floor
 */

import { PLATFORM_VERSION } from "@/lib/version-coherence";
import type {
  PluginManifest,
  PluginCapability,
  AdapterTarget,
  AdapterLifecycle,
} from "@/lib/types";

// ── Version comparison ─────────────────────────────────────────────────────

function semverToInt(v: string): number {
  const parts = v.replace(/[^0-9.]/g, "").split(".").map(Number);
  return (parts[0] || 0) * 1_000_000 + (parts[1] || 0) * 1_000 + (parts[2] || 0);
}

export function isPlatformCompatible(minPlatformVersion: string): boolean {
  return semverToInt(PLATFORM_VERSION) >= semverToInt(minPlatformVersion);
}

// ── Plugin registration bundle ────────────────────────────────────────────

export interface PluginBundle {
  manifest: PluginManifest;
  target: AdapterTarget;
  lifecycle: AdapterLifecycle;
}

// ── Contract validation ────────────────────────────────────────────────────

export interface PluginValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validatePluginBundle(bundle: PluginBundle): PluginValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Manifest presence
  if (!bundle.manifest.pluginId) errors.push("manifest.pluginId is required");
  if (!bundle.manifest.targetId) errors.push("manifest.targetId is required");
  if (!bundle.manifest.version) errors.push("manifest.version is required");
  if (!bundle.manifest.minPlatformVersion) errors.push("manifest.minPlatformVersion is required");
  if (!bundle.manifest.capabilities || bundle.manifest.capabilities.length === 0) {
    errors.push("manifest.capabilities must declare at least one capability");
  }

  // Target / manifest alignment
  if (bundle.manifest.targetId !== bundle.target.targetId) {
    errors.push(
      `manifest.targetId (${bundle.manifest.targetId}) does not match target.targetId (${bundle.target.targetId})`
    );
  }

  // Platform compatibility
  if (bundle.manifest.minPlatformVersion && !isPlatformCompatible(bundle.manifest.minPlatformVersion)) {
    errors.push(
      `Plugin requires platform >= ${bundle.manifest.minPlatformVersion}, current platform is ${PLATFORM_VERSION}`
    );
  }

  // Lifecycle completeness
  const REQUIRED_HOOKS: (keyof AdapterLifecycle)[] = ["discover", "install", "build", "export"];
  for (const hook of REQUIRED_HOOKS) {
    if (typeof bundle.lifecycle[hook] !== "function") {
      errors.push(`lifecycle.${hook} must be a function`);
    }
  }

  const OPTIONAL_HOOKS: (keyof AdapterLifecycle)[] = ["preview", "onLoad", "onUnload", "healthCheck"];
  for (const hook of OPTIONAL_HOOKS) {
    if (bundle.lifecycle[hook] && typeof bundle.lifecycle[hook] !== "function") {
      warnings.push(`lifecycle.${hook} is defined but not a function — will be ignored`);
    }
  }

  // Capability / lifecycle alignment
  const capSet = new Set<PluginCapability>(bundle.manifest.capabilities);
  if (capSet.has("build") && typeof bundle.lifecycle.build !== "function") {
    errors.push("Capability 'build' declared but lifecycle.build is missing");
  }
  if (capSet.has("install") && typeof bundle.lifecycle.install !== "function") {
    errors.push("Capability 'install' declared but lifecycle.install is missing");
  }
  if (capSet.has("preview") && typeof bundle.lifecycle.preview !== "function") {
    warnings.push("Capability 'preview' declared but lifecycle.preview is missing — preview calls will fail");
  }
  if (capSet.has("export") && typeof bundle.lifecycle.export !== "function") {
    errors.push("Capability 'export' declared but lifecycle.export is missing");
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ── Plugin lifecycle execution ─────────────────────────────────────────────

export async function invokePluginLoad(bundle: PluginBundle, log: (msg: string) => void): Promise<void> {
  if (typeof bundle.lifecycle.onLoad === "function") {
    log(`[plugin-contract] onLoad: ${bundle.manifest.pluginId}`);
    await bundle.lifecycle.onLoad();
  }
}

export async function invokePluginUnload(bundle: PluginBundle, log: (msg: string) => void): Promise<void> {
  if (typeof bundle.lifecycle.onUnload === "function") {
    log(`[plugin-contract] onUnload: ${bundle.manifest.pluginId}`);
    await bundle.lifecycle.onUnload();
  }
}

export async function invokeHealthCheck(
  bundle: PluginBundle
): Promise<{ healthy: boolean; detail?: string }> {
  if (typeof bundle.lifecycle.healthCheck !== "function") {
    return { healthy: true, detail: "no healthCheck defined — assumed healthy" };
  }
  try {
    return await bundle.lifecycle.healthCheck();
  } catch (e) {
    return { healthy: false, detail: `healthCheck threw: ${(e as Error).message}` };
  }
}

// ── Capability query helpers ──────────────────────────────────────────────

export function hasCapability(manifest: PluginManifest, cap: PluginCapability): boolean {
  return manifest.capabilities.includes(cap);
}

export function requiresCapability(
  manifest: PluginManifest,
  cap: PluginCapability,
  callerContext: string
): void {
  if (!hasCapability(manifest, cap)) {
    throw new Error(
      `Plugin "${manifest.pluginId}" does not declare capability "${cap}" required by ${callerContext}. ` +
      `Platform is fail-closed.`
    );
  }
}
