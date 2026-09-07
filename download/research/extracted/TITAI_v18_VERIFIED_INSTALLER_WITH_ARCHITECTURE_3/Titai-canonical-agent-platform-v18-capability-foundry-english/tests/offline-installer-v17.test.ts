import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalJson } from "@/lib/durable/canonical-json";
import { validateOfflineInstallerManifest, verifyOfflineInstallerSignature, type OfflineInstallerManifest } from "@/lib/sovereignty/offline-installer";

function manifest(): OfflineInstallerManifest {
  return {
    format: "titai-v17-offline-installer",
    version: 1,
    release: "v17-test",
    releaseSha256: "a".repeat(64),
    createdAt: "2026-07-11T12:00:00.000Z",
    platform: "linux",
    architecture: "x64",
    nodeVersion: "v22.16.0",
    signingMode: "development_ephemeral",
    files: [{ path: "runtime/node", sha256: "b".repeat(64), bytes: 42, mode: 0o755, component: "runtime" }],
    startup: { command: ["runtime/node", "application/server.js"], loopbackHost: "127.0.0.1", defaultPort: 3210 },
    capabilities: { publicRegistryRequiredAtInstall: false, cloudIdentityRequired: false, commercialApiKeyRequired: false, modelWeightsIncluded: false },
    limitations: ["test fixture"],
  };
}

describe("v17 offline installer manifest", () => {
  it("verifies a canonical Ed25519 signature", () => {
    const pair = generateKeyPairSync("ed25519");
    const publicDer = pair.publicKey.export({ format: "der", type: "spki" });
    const keyId = createHash("sha256").update(publicDer).digest("hex").slice(0, 24);
    const value = manifest();
    const signature = sign(null, Buffer.from(canonicalJson(value)), pair.privateKey);
    expect(validateOfflineInstallerManifest(value)).toEqual([]);
    expect(verifyOfflineInstallerSignature({
      manifest: value,
      signatureAlgorithm: "Ed25519",
      signatureBase64: signature.toString("base64"),
      publicKeySpkiBase64: publicDer.toString("base64"),
      keyId,
    })).toBe(true);
  });

  it("rejects traversal, secrets, model weights, and non-loopback startup", () => {
    const value = manifest();
    value.files.push(
      { path: "../escape", sha256: "c".repeat(64), bytes: 1, mode: 0o644, component: "application" },
      { path: "config/.env", sha256: "d".repeat(64), bytes: 1, mode: 0o600, component: "application" },
      { path: "models/demo.gguf", sha256: "e".repeat(64), bytes: 1, mode: 0o644, component: "application" },
    );
    value.startup.loopbackHost = "0.0.0.0";
    const errors = validateOfflineInstallerManifest(value);
    expect(errors.some((error) => error.startsWith("unsafe_installer_path"))).toBe(true);
    expect(errors.some((error) => error.startsWith("installer_secret_path_forbidden"))).toBe(true);
    expect(errors.some((error) => error.startsWith("installer_model_weight_forbidden"))).toBe(true);
    expect(errors).toContain("installer_startup_not_loopback");
  });
});
