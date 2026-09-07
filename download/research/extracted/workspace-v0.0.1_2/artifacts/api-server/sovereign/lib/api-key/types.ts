/**
 * lib/api-key/types.ts — API-Key types and store interface.
 *
 * Per-tenant API keys replace the exposed x-tenant-id header.
 * Each key carries a tenantId, scopes, and expiry; validation is tenant-scoped.
 */

export interface ApiKey {
  keyId: string;
  tenantId: string;
  name: string;
  /** SHA-256 hash of the raw secret (base64url). Never store the raw secret. */
  hashedSecret: string;
  scopes: string[];
  createdAt: string;
  /** ISO timestamp when the key was revoked. */
  revokedAt?: string;
  /** ISO timestamp when the key expires. */
  expiresAt?: string;
}

export interface ApiKeyStore {
  put(key: ApiKey): Promise<void>;
  /** Global lookup by keyId (unique across tenants). */
  get(keyId: string): Promise<ApiKey | null>;
  /** Global lookup by hashed secret for middleware validation. */
  getByHashedSecret(hashedSecret: string): Promise<ApiKey | null>;
  /** List all non-revoked keys for a tenant (hashedSecret omitted). */
  list(tenantId: string): Promise<Omit<ApiKey, "hashedSecret">[]>;
  /** Revoke a key globally by keyId. Returns true if found. */
  revoke(keyId: string): Promise<boolean>;
}
