import { createHash, verify } from "node:crypto";
import { posix } from "node:path";
import { canonicalJson } from "@/lib/durable/canonical-json";

export interface OfflineInstallerFile {
  path: string;
  sha256: string;
  bytes: number;
  mode: number;
  component: "runtime" | "application" | "public" | "migration" | "installer" | "evidence";
}

export interface OfflineInstallerManifest {
  format: "titai-v17-offline-installer";
  version: 1;
  release: string;
  releaseSha256: string;
  createdAt: string;
  platform: string;
  architecture: string;
  nodeVersion: string;
  signingMode: "trusted_external" | "development_ephemeral";
  files: OfflineInstallerFile[];
  startup: { command: string[]; loopbackHost: string; defaultPort: number };
  capabilities: {
    publicRegistryRequiredAtInstall: false;
    cloudIdentityRequired: false;
    commercialApiKeyRequired: false;
    modelWeightsIncluded: false;
  };
  limitations: string[];
}

export interface SignedOfflineInstallerManifest {
  manifest: OfflineInstallerManifest;
  signatureAlgorithm: "Ed25519";
  signatureBase64: string;
  publicKeySpkiBase64: string;
  keyId: string;
}

export function installerPathIsSafe(path: string): boolean {
  if (!path || path.includes("\\") || path.startsWith("/") || /^[A-Za-z]:/.test(path)) return false;
  const normalized = posix.normalize(path);
  return normalized === path && !normalized.startsWith("../") && normalized !== ".." && !normalized.includes("/../");
}

export function validateOfflineInstallerManifest(manifest: OfflineInstallerManifest): string[] {
  const errors: string[] = [];
  if (manifest.format !== "titai-v17-offline-installer" || manifest.version !== 1) errors.push("installer_manifest_format_invalid");
  if (!/^[a-f0-9]{64}$/.test(manifest.releaseSha256)) errors.push("installer_release_hash_invalid");
  if (!manifest.release.trim() || !manifest.platform.trim() || !manifest.architecture.trim() || !manifest.nodeVersion.trim()) errors.push("installer_identity_missing");
  if (!Number.isFinite(Date.parse(manifest.createdAt))) errors.push("installer_timestamp_invalid");
  if (!manifest.files.length) errors.push("installer_files_missing");
  const paths = new Set<string>();
  for (const file of manifest.files) {
    if (!installerPathIsSafe(file.path)) errors.push(`unsafe_installer_path:${file.path}`);
    if (paths.has(file.path)) errors.push(`duplicate_installer_path:${file.path}`);
    paths.add(file.path);
    if (!/^[a-f0-9]{64}$/.test(file.sha256)) errors.push(`installer_hash_invalid:${file.path}`);
    if (!Number.isInteger(file.bytes) || file.bytes < 0) errors.push(`installer_size_invalid:${file.path}`);
    if (!Number.isInteger(file.mode) || file.mode < 0 || file.mode > 0o7777) errors.push(`installer_mode_invalid:${file.path}`);
    if (/(^|\/)(\.env|credentials?|secrets?)(\.|\/|$)/i.test(file.path)) errors.push(`installer_secret_path_forbidden:${file.path}`);
    if (/model.*\.(gguf|safetensors|bin)$/i.test(file.path)) errors.push(`installer_model_weight_forbidden:${file.path}`);
  }
  if (manifest.capabilities.publicRegistryRequiredAtInstall !== false) errors.push("installer_registry_independence_invalid");
  if (manifest.capabilities.cloudIdentityRequired !== false) errors.push("installer_cloud_identity_invalid");
  if (manifest.capabilities.commercialApiKeyRequired !== false) errors.push("installer_commercial_key_invalid");
  if (manifest.capabilities.modelWeightsIncluded !== false) errors.push("installer_model_weights_flag_invalid");
  if (manifest.startup.loopbackHost !== "127.0.0.1" && manifest.startup.loopbackHost !== "::1") errors.push("installer_startup_not_loopback");
  return [...new Set(errors)].sort();
}

export function verifyOfflineInstallerSignature(envelope: SignedOfflineInstallerManifest): boolean {
  if (envelope.signatureAlgorithm !== "Ed25519") return false;
  const keyDer = Buffer.from(envelope.publicKeySpkiBase64, "base64");
  const actualKeyId = createHash("sha256").update(keyDer).digest("hex").slice(0, 24);
  if (actualKeyId !== envelope.keyId) return false;
  try {
    return verify(null, Buffer.from(canonicalJson(envelope.manifest)), { key: keyDer, format: "der", type: "spki" }, Buffer.from(envelope.signatureBase64, "base64"));
  } catch {
    return false;
  }
}
