/**
 * lib/api-key/api-key-store.ts — InMemoryApiKeyStore (reference impl).
 *
 * Tenant-isolated in-memory storage for API keys. Production: pg-backed store
 * behind the same ApiKeyStore interface.
 */

import type { ApiKey, ApiKeyStore } from "./types.ts";

export class InMemoryApiKeyStore implements ApiKeyStore {
  private byKeyId = new Map<string, ApiKey>();
  private byHash = new Map<string, ApiKey>();
  private byTenant = new Map<string, Map<string, ApiKey>>();

  async put(key: ApiKey): Promise<void> {
    this.byKeyId.set(key.keyId, key);
    this.byHash.set(key.hashedSecret, key);
    let m = this.byTenant.get(key.tenantId);
    if (!m) { m = new Map(); this.byTenant.set(key.tenantId, m); }
    m.set(key.keyId, key);
  }

  async get(keyId: string): Promise<ApiKey | null> {
    return this.byKeyId.get(keyId) ?? null;
  }

  async getByHashedSecret(hashedSecret: string): Promise<ApiKey | null> {
    return this.byHash.get(hashedSecret) ?? null;
  }

  async list(tenantId: string): Promise<Omit<ApiKey, "hashedSecret">[]> {
    const m = this.byTenant.get(tenantId);
    if (!m) return [];
    const out: Omit<ApiKey, "hashedSecret">[] = [];
    for (const key of m.values()) {
      const { hashedSecret: _h, ...rest } = key;
      out.push(rest);
    }
    return out;
  }

  async revoke(keyId: string): Promise<boolean> {
    const key = this.byKeyId.get(keyId);
    if (!key) return false;
    if (key.revokedAt) return false;
    key.revokedAt = new Date().toISOString();
    return true;
  }
}
