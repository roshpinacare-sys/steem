/**
 * lib/api-key/api-key-service.ts — API-Key issuance, validation, revocation.
 *
 * Uses node:crypto only (SHA-256 for secret hashing, randomBytes for generation).
 * Zero external dependencies. Fail-closed: invalid / expired / revoked → null.
 */

import { randomBytes, createHash } from "node:crypto";
import type { ApiKey, ApiKeyStore } from "./types.ts";

function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("base64url");
}

export interface CreateApiKeyInput {
  tenantId: string;
  name: string;
  scopes?: string[];
  expiresAt?: string;
}

export interface CreatedApiKeyResult {
  key: Omit<ApiKey, "hashedSecret">;
  /** The raw secret — shown exactly once to the caller. */
  secret: string;
}

export class ApiKeyService {
  private store: ApiKeyStore;
  constructor(store: ApiKeyStore) {
    this.store = store;
  }

  async create(input: CreateApiKeyInput): Promise<CreatedApiKeyResult> {
    const keyId = randomBytes(16).toString("hex");
    const secret = `tfa_${randomBytes(32).toString("base64url")}`;
    const key: ApiKey = {
      keyId,
      tenantId: input.tenantId,
      name: input.name,
      hashedSecret: hashSecret(secret),
      scopes: input.scopes ?? [],
      createdAt: new Date().toISOString(),
      expiresAt: input.expiresAt,
    };
    await this.store.put(key);
    const { hashedSecret: _h, ...rest } = key;
    return { key: rest, secret };
  }

  /** Validate a raw secret. Returns the key (with hashedSecret) or null. */
  async validate(secret: string): Promise<ApiKey | null> {
    const hashed = hashSecret(secret);
    const key = await this.store.getByHashedSecret(hashed);
    if (!key) return null;
    if (key.revokedAt) return null;
    if (key.expiresAt && new Date(key.expiresAt) < new Date()) return null;
    return key;
  }

  async revoke(keyId: string): Promise<boolean> {
    return this.store.revoke(keyId);
  }

  async list(tenantId: string): Promise<Omit<ApiKey, "hashedSecret">[]> {
    return this.store.list(tenantId);
  }
}
