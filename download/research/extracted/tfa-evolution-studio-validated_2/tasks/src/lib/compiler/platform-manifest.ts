/**
 * TFA Evolution Studio v28 — Platform Manifest
 *
 * Canonical manifest generation for compiled outputs.
 * V24 fix: targets/adapters are now sourced from the live adapter registry
 * instead of a hardcoded list that drifted as adapters were added/removed.
 */

import { listAdapters, listAdapterManifests } from "./adapter-registry";

export interface PlatformManifest {
  platform: string;
  version: string;
  targets: string[];
  adapters: string[];
  generatedAt: string;
}

export function buildPlatformManifest(version: string): PlatformManifest {
  const targets = listAdapters().map((t) => t.targetId);
  const adapters = listAdapterManifests().map((m) => m.pluginId);
  return {
    platform: "TFA Evolution Studio",
    version,
    targets,
    adapters,
    generatedAt: new Date().toISOString(),
  };
}
