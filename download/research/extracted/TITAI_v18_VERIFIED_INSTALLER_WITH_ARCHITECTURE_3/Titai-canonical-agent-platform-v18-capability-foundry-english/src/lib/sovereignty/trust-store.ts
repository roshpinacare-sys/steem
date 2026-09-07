import { sha256 } from "@/lib/durable/canonical-json";

export interface TrustedSigningKey {
  keyId: string;
  publicKeyPem: string;
  identity: string;
  tenantId: string;
  workspaceId?: string;
  purposes: Array<"handoff_task" | "handoff_result" | "offline_update" | "verification">;
  validFrom: string;
  validUntil?: string;
  revokedAt?: string;
  revokedReason?: string;
}

export class SovereignTrustStore {
  private readonly keys = new Map<string, TrustedSigningKey>();

  add(key: TrustedSigningKey): void {
    if (!key.keyId.trim() || sha256(key.publicKeyPem).slice(0, 24) !== key.keyId) throw new Error("trust_key_identity_invalid");
    if (!Number.isFinite(new Date(key.validFrom).getTime())) throw new Error("trust_key_valid_from_invalid");
    if (key.validUntil && new Date(key.validUntil).getTime() <= new Date(key.validFrom).getTime()) {
      throw new Error("trust_key_validity_invalid");
    }
    this.keys.set(key.keyId, structuredClone(key));
  }

  revoke(keyId: string, options: { at?: Date; reason: string }): void {
    const current = this.keys.get(keyId);
    if (!current) throw new Error("trust_key_unknown");
    this.keys.set(keyId, { ...current, revokedAt: (options.at ?? new Date()).toISOString(), revokedReason: options.reason });
  }

  require(options: {
    keyId: string;
    purpose: TrustedSigningKey["purposes"][number];
    tenantId: string;
    workspaceId?: string;
    now?: Date;
  }): TrustedSigningKey {
    const key = this.keys.get(options.keyId);
    if (!key) throw new Error("trust_key_unknown");
    const now = options.now ?? new Date();
    if (new Date(key.validFrom).getTime() > now.getTime()) throw new Error("trust_key_not_yet_valid");
    if (key.validUntil && new Date(key.validUntil).getTime() <= now.getTime()) throw new Error("trust_key_expired");
    if (key.revokedAt && new Date(key.revokedAt).getTime() <= now.getTime()) throw new Error("trust_key_revoked");
    if (!key.purposes.includes(options.purpose)) throw new Error("trust_key_purpose_denied");
    if (key.tenantId !== options.tenantId) throw new Error("trust_key_tenant_mismatch");
    if (key.workspaceId && key.workspaceId !== options.workspaceId) throw new Error("trust_key_workspace_mismatch");
    return structuredClone(key);
  }
}
