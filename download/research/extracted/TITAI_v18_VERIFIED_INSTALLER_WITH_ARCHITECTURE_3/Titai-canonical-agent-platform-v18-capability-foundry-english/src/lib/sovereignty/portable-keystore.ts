import {
  createCipheriv,
  createDecipheriv,
  createHash,
  generateKeyPairSync,
  randomBytes,
  scryptSync,
} from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { canonicalJson, sha256 } from "@/lib/durable/canonical-json";

export type CustodyPurpose =
  | "installation_identity"
  | "tenant_encryption"
  | "workspace_encryption"
  | "data_encryption"
  | "backup_encryption"
  | "handoff_signing"
  | "update_signing"
  | "verifier_signing";

export interface KeyScope {
  tenantId?: string;
  workspaceId?: string;
}

interface StoredKeyBase {
  keyId: string;
  purpose: CustodyPurpose;
  version: number;
  createdAt: string;
  notBefore?: string;
  expiresAt?: string;
  revokedAt?: string;
  revocationReason?: string;
  scope: KeyScope;
  status: "active" | "retired" | "revoked";
}

export interface StoredSymmetricKey extends StoredKeyBase {
  type: "symmetric";
  keyBase64: string;
}

export interface StoredSigningKey extends StoredKeyBase {
  type: "ed25519";
  publicKeyPem: string;
  privateKeyPem: string;
}

export type StoredCustodyKey = StoredSymmetricKey | StoredSigningKey;

interface KeystorePayload {
  format: "titai-portable-keystore";
  version: 1;
  installationId: string;
  createdAt: string;
  updatedAt: string;
  keys: StoredCustodyKey[];
  audit: Array<{
    at: string;
    action: "create" | "read" | "rotate" | "revoke" | "retire";
    keyId: string;
    purpose: CustodyPurpose;
    actor: string;
    outcome: "allowed" | "denied";
    reason?: string;
  }>;
}

interface EncryptedEnvelope {
  format: "titai-encrypted-keystore";
  version: 1;
  kdf: "scrypt";
  cipher: "aes-256-gcm";
  saltBase64: string;
  ivBase64: string;
  tagBase64: string;
  ciphertextBase64: string;
  payloadSha256: string;
}

function deriveFileKey(passphrase: string, salt: Buffer): Buffer {
  if (passphrase.length < 12) throw new Error("keystore_passphrase_too_short");
  return scryptSync(passphrase, salt, 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
}

function matchesScope(key: StoredCustodyKey, scope: KeyScope): boolean {
  if (key.scope.tenantId && key.scope.tenantId !== scope.tenantId) return false;
  if (key.scope.workspaceId && key.scope.workspaceId !== scope.workspaceId) return false;
  return true;
}

function validateTime(key: StoredCustodyKey, now: Date): void {
  if (key.notBefore && new Date(key.notBefore).getTime() > now.getTime()) throw new Error("custody_key_not_yet_valid");
  if (key.expiresAt && new Date(key.expiresAt).getTime() <= now.getTime()) throw new Error("custody_key_expired");
  if (key.revokedAt || key.status === "revoked") throw new Error("custody_key_revoked");
  if (key.status !== "active") throw new Error("custody_key_not_active");
}

function atomicWrite(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.tmp-${process.pid}-${randomBytes(6).toString("hex")}`;
  writeFileSync(temp, content, { mode: 0o600 });
  renameSync(temp, path);
}

function encryptPayload(payload: KeystorePayload, passphrase: string): EncryptedEnvelope {
  const plaintext = Buffer.from(canonicalJson(payload), "utf8");
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = deriveFileKey(passphrase, salt);
  try {
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(Buffer.from("titai-portable-keystore:v1", "utf8"));
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return {
      format: "titai-encrypted-keystore",
      version: 1,
      kdf: "scrypt",
      cipher: "aes-256-gcm",
      saltBase64: salt.toString("base64"),
      ivBase64: iv.toString("base64"),
      tagBase64: cipher.getAuthTag().toString("base64"),
      ciphertextBase64: ciphertext.toString("base64"),
      payloadSha256: createHash("sha256").update(plaintext).digest("hex"),
    };
  } finally {
    key.fill(0);
    plaintext.fill(0);
  }
}

function decryptEnvelope(envelope: EncryptedEnvelope, passphrase: string): KeystorePayload {
  if (envelope.format !== "titai-encrypted-keystore" || envelope.version !== 1 || envelope.kdf !== "scrypt" || envelope.cipher !== "aes-256-gcm") {
    throw new Error("keystore_format_invalid");
  }
  const salt = Buffer.from(envelope.saltBase64, "base64");
  const iv = Buffer.from(envelope.ivBase64, "base64");
  const key = deriveFileKey(passphrase, salt);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(Buffer.from("titai-portable-keystore:v1", "utf8"));
    decipher.setAuthTag(Buffer.from(envelope.tagBase64, "base64"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertextBase64, "base64")),
      decipher.final(),
    ]);
    const actual = createHash("sha256").update(plaintext).digest("hex");
    if (actual !== envelope.payloadSha256) throw new Error("keystore_payload_integrity_invalid");
    const parsed = JSON.parse(plaintext.toString("utf8")) as KeystorePayload;
    plaintext.fill(0);
    if (parsed.format !== "titai-portable-keystore" || parsed.version !== 1 || !Array.isArray(parsed.keys)) {
      throw new Error("keystore_payload_invalid");
    }
    return parsed;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("keystore_")) throw error;
    throw new Error("keystore_decryption_failed");
  } finally {
    key.fill(0);
  }
}

export class PortableEncryptedKeystore {
  private constructor(
    readonly path: string,
    private readonly passphrase: string,
    private payload: KeystorePayload,
  ) {}

  static create(options: { path: string; passphrase: string; installationId?: string; now?: Date }): PortableEncryptedKeystore {
    const path = resolve(options.path);
    if (existsSync(path)) throw new Error("keystore_already_exists");
    const now = options.now ?? new Date();
    const store = new PortableEncryptedKeystore(path, options.passphrase, {
      format: "titai-portable-keystore",
      version: 1,
      installationId: options.installationId ?? `installation-${randomBytes(12).toString("hex")}`,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      keys: [],
      audit: [],
    });
    store.persist(now);
    return store;
  }

  static open(options: { path: string; passphrase: string }): PortableEncryptedKeystore {
    const path = resolve(options.path);
    const envelope = JSON.parse(readFileSync(path, "utf8")) as EncryptedEnvelope;
    return new PortableEncryptedKeystore(path, options.passphrase, decryptEnvelope(envelope, options.passphrase));
  }

  get installationId(): string { return this.payload.installationId; }

  createSymmetricKey(options: { purpose: CustodyPurpose; scope?: KeyScope; actor: string; expiresAt?: string; now?: Date }): Omit<StoredSymmetricKey, "keyBase64"> {
    const now = options.now ?? new Date();
    const version = this.nextVersion(options.purpose, options.scope ?? {});
    const material = randomBytes(32);
    const key: StoredSymmetricKey = {
      type: "symmetric",
      keyId: sha256({ purpose: options.purpose, scope: options.scope ?? {}, version, public: material.toString("base64") }).slice(0, 32),
      purpose: options.purpose,
      version,
      createdAt: now.toISOString(),
      expiresAt: options.expiresAt,
      scope: structuredClone(options.scope ?? {}),
      status: "active",
      keyBase64: material.toString("base64"),
    };
    material.fill(0);
    this.retireActive(options.purpose, key.scope, options.actor, now);
    this.payload.keys.push(key);
    this.audit("create", key, options.actor, "allowed", undefined, now);
    this.persist(now);
    return this.publicKeyRecord(key);
  }

  createSigningKey(options: { purpose: Extract<CustodyPurpose, "installation_identity" | "handoff_signing" | "update_signing" | "verifier_signing">; scope?: KeyScope; actor: string; expiresAt?: string; now?: Date }): Omit<StoredSigningKey, "privateKeyPem"> {
    const now = options.now ?? new Date();
    const version = this.nextVersion(options.purpose, options.scope ?? {});
    const pair = generateKeyPairSync("ed25519", {
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    const key: StoredSigningKey = {
      type: "ed25519",
      keyId: sha256(pair.publicKey).slice(0, 32),
      purpose: options.purpose,
      version,
      createdAt: now.toISOString(),
      expiresAt: options.expiresAt,
      scope: structuredClone(options.scope ?? {}),
      status: "active",
      publicKeyPem: pair.publicKey,
      privateKeyPem: pair.privateKey,
    };
    this.retireActive(options.purpose, key.scope, options.actor, now);
    this.payload.keys.push(key);
    this.audit("create", key, options.actor, "allowed", undefined, now);
    this.persist(now);
    return this.publicKeyRecord(key);
  }

  readKey(options: { keyId: string; purpose: CustodyPurpose; scope?: KeyScope; actor: string; now?: Date }): StoredCustodyKey {
    const now = options.now ?? new Date();
    const key = this.payload.keys.find((candidate) => candidate.keyId === options.keyId);
    if (!key) throw new Error("custody_key_not_found");
    try {
      if (key.purpose !== options.purpose) throw new Error("custody_key_purpose_mismatch");
      if (!matchesScope(key, options.scope ?? {})) throw new Error("custody_key_scope_mismatch");
      validateTime(key, now);
      this.audit("read", key, options.actor, "allowed", undefined, now);
      this.persist(now);
      return structuredClone(key);
    } catch (error) {
      this.audit("read", key, options.actor, "denied", error instanceof Error ? error.message : "denied", now);
      this.persist(now);
      throw error;
    }
  }

  activeKey(options: { purpose: CustodyPurpose; scope?: KeyScope; actor: string; now?: Date }): StoredCustodyKey {
    const key = this.payload.keys
      .filter((candidate) => candidate.purpose === options.purpose && matchesScope(candidate, options.scope ?? {}) && candidate.status === "active")
      .sort((a, b) => b.version - a.version)[0];
    if (!key) throw new Error("custody_active_key_not_found");
    return this.readKey({ keyId: key.keyId, purpose: options.purpose, scope: options.scope, actor: options.actor, now: options.now });
  }

  revoke(options: { keyId: string; actor: string; reason: string; at?: Date }): void {
    const key = this.payload.keys.find((candidate) => candidate.keyId === options.keyId);
    if (!key) throw new Error("custody_key_not_found");
    const at = options.at ?? new Date();
    key.status = "revoked";
    key.revokedAt = at.toISOString();
    key.revocationReason = options.reason.trim().slice(0, 500);
    this.audit("revoke", key, options.actor, "allowed", key.revocationReason, at);
    this.persist(at);
  }

  publicInventory(): Array<Omit<StoredCustodyKey, "keyBase64" | "privateKeyPem">> {
    return this.payload.keys.map((key) => this.publicKeyRecord(key));
  }

  auditLog(): KeystorePayload["audit"] { return structuredClone(this.payload.audit); }

  private nextVersion(purpose: CustodyPurpose, scope: KeyScope): number {
    return Math.max(0, ...this.payload.keys.filter((key) => key.purpose === purpose && matchesScope(key, scope)).map((key) => key.version)) + 1;
  }

  private retireActive(purpose: CustodyPurpose, scope: KeyScope, actor: string, now: Date): void {
    for (const key of this.payload.keys) {
      if (key.purpose === purpose && key.status === "active" && matchesScope(key, scope)) {
        key.status = "retired";
        this.audit("retire", key, actor, "allowed", "superseded_by_rotation", now);
      }
    }
  }

  private audit(action: KeystorePayload["audit"][number]["action"], key: StoredCustodyKey, actor: string, outcome: "allowed" | "denied", reason: string | undefined, at: Date): void {
    this.payload.audit.push({ at: at.toISOString(), action, keyId: key.keyId, purpose: key.purpose, actor: actor.trim().slice(0, 200), outcome, reason });
    if (this.payload.audit.length > 10_000) this.payload.audit.splice(0, this.payload.audit.length - 10_000);
  }

  private publicKeyRecord<T extends StoredCustodyKey>(key: T): Omit<T, "keyBase64" | "privateKeyPem"> {
    const clone = structuredClone(key) as T & { keyBase64?: string; privateKeyPem?: string };
    delete clone.keyBase64;
    delete clone.privateKeyPem;
    return clone;
  }

  private persist(now = new Date()): void {
    this.payload.updatedAt = now.toISOString();
    atomicWrite(this.path, `${JSON.stringify(encryptPayload(this.payload, this.passphrase), null, 2)}\n`);
  }
}
