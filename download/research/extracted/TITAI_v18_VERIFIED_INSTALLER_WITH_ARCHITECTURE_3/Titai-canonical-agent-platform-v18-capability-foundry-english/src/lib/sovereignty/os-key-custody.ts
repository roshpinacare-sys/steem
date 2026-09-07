import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { platform } from "node:os";
import type { CustodyPurpose, KeyScope } from "./portable-keystore";

export type OsCustodyOperation = "seal" | "unseal" | "delete" | "attest";

export interface OsCustodyHelperDescriptor {
  helperPath: string;
  helperSha256: string;
  platform: NodeJS.Platform;
  backendId: string;
  purposes: CustodyPurpose[];
}

export interface OsCustodyRequest {
  operation: OsCustodyOperation;
  keyId: string;
  purpose: CustodyPurpose;
  scope: KeyScope;
  plaintextBase64?: string;
  sealedBase64?: string;
}

export interface OsCustodyResponse {
  ok: boolean;
  backendId: string;
  sealedBase64?: string;
  plaintextBase64?: string;
  attestation?: Record<string, unknown>;
  error?: string;
}

export interface OsCustodyCapabilityReport {
  platform: NodeJS.Platform;
  dpapiAvailable: boolean;
  tpmDevicePresent: boolean;
  tpmToolAvailable: boolean;
  secretServiceToolAvailable: boolean;
  provenBackend: "none" | "external_helper";
  blockers: string[];
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export class VerifiedExternalOsKeyCustody {
  constructor(private readonly descriptor: OsCustodyHelperDescriptor) {
    if (descriptor.platform !== platform()) throw new Error("custody_helper_platform_mismatch");
    if (!existsSync(descriptor.helperPath)) throw new Error("custody_helper_missing");
    if (sha256File(descriptor.helperPath) !== descriptor.helperSha256) throw new Error("custody_helper_hash_mismatch");
    if (!descriptor.backendId.trim()) throw new Error("custody_backend_id_required");
  }

  execute(request: OsCustodyRequest): OsCustodyResponse {
    if (!this.descriptor.purposes.includes(request.purpose)) throw new Error("custody_purpose_denied");
    if (!request.keyId.trim()) throw new Error("custody_key_id_required");
    const result = spawnSync(this.descriptor.helperPath, ["--titai-json"], {
      input: JSON.stringify(request),
      encoding: "utf8",
      shell: false,
      windowsHide: true,
      timeout: 15_000,
      maxBuffer: 1_000_000,
      env: { NODE_ENV: process.env.NODE_ENV ?? "production", PATH: process.env.PATH ?? "", SYSTEMROOT: process.env.SYSTEMROOT ?? "", HOME: process.env.HOME ?? "" },
    });
    if (result.error) throw new Error(`custody_helper_spawn_failed:${result.error.message}`);
    if (result.status !== 0) throw new Error(`custody_helper_failed:${result.status}:${String(result.stderr).slice(0, 300)}`);
    let response: OsCustodyResponse;
    try { response = JSON.parse(result.stdout); } catch { throw new Error("custody_helper_response_invalid"); }
    if (response.backendId !== this.descriptor.backendId) throw new Error("custody_backend_identity_mismatch");
    if (!response.ok) throw new Error(`custody_operation_denied:${response.error ?? "unknown"}`);
    return response;
  }
}

function commandAvailable(command: string, args: string[] = ["--help"]): boolean {
  const result = spawnSync(command, args, { stdio: "ignore", shell: false, timeout: 5_000, windowsHide: true });
  return result.status === 0 || result.status === 1;
}

export function detectOsCustodyCapabilities(): OsCustodyCapabilityReport {
  const current = platform();
  const dpapiAvailable = current === "win32";
  const tpmDevicePresent = existsSync("/dev/tpmrm0") || existsSync("/dev/tpm0");
  const tpmToolAvailable = current === "win32" && commandAvailable("tpmtool", ["getdeviceinformation"]);
  const secretServiceToolAvailable = current === "linux" && commandAvailable("secret-tool", ["--help"]);
  const blockers: string[] = [];
  if (current === "win32" && !tpmToolAvailable) blockers.push("windows_tpm_not_observed");
  if (current === "linux" && !tpmDevicePresent) blockers.push("linux_tpm_device_not_exposed");
  if (current === "linux" && !secretServiceToolAvailable) blockers.push("linux_secret_service_tool_missing");
  if (!dpapiAvailable && !tpmDevicePresent && !secretServiceToolAvailable) blockers.push("os_custody_backend_unavailable");
  return {
    platform: current,
    dpapiAvailable,
    tpmDevicePresent,
    tpmToolAvailable,
    secretServiceToolAvailable,
    provenBackend: "none",
    blockers: [...new Set(blockers)].sort(),
  };
}
