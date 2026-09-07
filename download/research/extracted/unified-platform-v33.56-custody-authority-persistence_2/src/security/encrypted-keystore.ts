import {
  createCipheriv,
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  randomBytes,
  scryptSync,
} from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { canonicalJson, sha256, sha256Bytes, type SigningIdentity } from '../contracts/crypto.js';
import { KeyLifecycleRegistry, type TrustSnapshot } from './key-lifecycle.js';

interface StoredIdentity {
  readonly keyId: string;
  readonly publicKeyPem: string;
  readonly privateKeyPem: string;
}

interface StorePayload {
  readonly formatVersion: 1;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly identities: readonly StoredIdentity[];
  readonly secrets: Readonly<Record<string, string>>;
  readonly trustSnapshot?: TrustSnapshot;
}

interface EncryptedEnvelope {
  readonly format: 'sovereign-encrypted-keystore';
  readonly version: 1;
  readonly kdf: {
    readonly name: 'scrypt';
    readonly salt: string;
    readonly cost: number;
    readonly blockSize: number;
    readonly parallelization: number;
  };
  readonly cipher: {
    readonly name: 'aes-256-gcm';
    readonly iv: string;
    readonly tag: string;
  };
  readonly ciphertext: string;
  readonly encryptedAt: string;
}

const SCRYPT_COST = 16_384;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 1;

export class EncryptedKeyStore {
  readonly #path: string;
  readonly #passphrase: string;
  #payload: StorePayload;

  private constructor(path: string, passphrase: string, payload: StorePayload) {
    this.#path = resolve(path);
    this.#passphrase = passphrase;
    this.#payload = structuredClone(payload);
  }

  static create(path: string, passphrase: string, now = new Date()): EncryptedKeyStore {
    validatePassphrase(passphrase);
    const resolved = resolve(path);
    if (existsSync(resolved)) throw new Error('keystore_already_exists');
    const timestamp = now.toISOString();
    const store = new EncryptedKeyStore(resolved, passphrase, {
      formatVersion: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      identities: [],
      secrets: {},
    });
    store.save(now);
    return store;
  }

  static open(path: string, passphrase: string): EncryptedKeyStore {
    validatePassphrase(passphrase);
    const resolved = resolve(path);
    if (!existsSync(resolved)) throw new Error('keystore_not_found');
    const envelope = JSON.parse(readFileSync(resolved, 'utf8')) as EncryptedEnvelope;
    const payload = decryptEnvelope(envelope, passphrase);
    validatePayload(payload);
    const mode = statSync(resolved).mode & 0o777;
    if ((mode & 0o077) !== 0) throw new Error('keystore_permissions_too_open');
    return new EncryptedKeyStore(resolved, passphrase, payload);
  }

  addIdentity(identity: SigningIdentity, now = new Date()): void {
    const publicKeyPem = identity.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const privateKeyPem = identity.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const existing = this.#payload.identities.find((item) => item.keyId === identity.keyId);
    if (existing !== undefined && existing.publicKeyPem !== publicKeyPem) throw new Error('keystore_key_id_conflict');
    const identities = existing === undefined
      ? [...this.#payload.identities, { keyId: identity.keyId, publicKeyPem, privateKeyPem }]
      : this.#payload.identities;
    this.#payload = { ...this.#payload, identities, updatedAt: now.toISOString() };
    this.save(now);
  }

  getIdentity(keyId: string): SigningIdentity {
    const stored = this.#payload.identities.find((item) => item.keyId === keyId);
    if (stored === undefined) throw new Error('keystore_identity_not_found');
    return {
      keyId,
      publicKey: createPublicKey(stored.publicKeyPem),
      privateKey: createPrivateKey(stored.privateKeyPem),
    };
  }

  listIdentityIds(): readonly string[] {
    return this.#payload.identities.map((item) => item.keyId).sort();
  }

  setSecret(name: string, value: string, now = new Date()): void {
    if (!/^[a-z][a-z0-9._-]{2,127}$/.test(name)) throw new Error('invalid_secret_name');
    if (value.length < 16) throw new Error('secret_value_too_short');
    this.#payload = {
      ...this.#payload,
      secrets: { ...this.#payload.secrets, [name]: value },
      updatedAt: now.toISOString(),
    };
    this.save(now);
  }

  getSecret(name: string): string {
    const value = this.#payload.secrets[name];
    if (value === undefined) throw new Error('keystore_secret_not_found');
    return value;
  }

  setTrustSnapshot(snapshot: TrustSnapshot, now = new Date()): void {
    if (!KeyLifecycleRegistry.verifySnapshot(snapshot)) throw new Error('invalid_trust_snapshot');
    this.#payload = { ...this.#payload, trustSnapshot: structuredClone(snapshot), updatedAt: now.toISOString() };
    this.save(now);
  }

  getTrustSnapshot(): TrustSnapshot {
    if (this.#payload.trustSnapshot === undefined) throw new Error('trust_snapshot_not_found');
    return structuredClone(this.#payload.trustSnapshot);
  }

  save(now = new Date()): void {
    mkdirSync(dirname(this.#path), { recursive: true });
    const payload = { ...this.#payload, updatedAt: now.toISOString() };
    const envelope = encryptPayload(payload, this.#passphrase, now);
    const temporary = `${this.#path}.tmp-${process.pid}`;
    writeFileSync(temporary, `${JSON.stringify(envelope, null, 2)}\n`, { mode: 0o600 });
    chmodSync(temporary, 0o600);
    renameSync(temporary, this.#path);
    chmodSync(this.#path, 0o600);
    this.#payload = payload;
  }

  backupTo(destination: string): string {
    const target = resolve(destination);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(this.#path, target);
    chmodSync(target, 0o600);
    return sha256Bytes(readFileSync(target));
  }

  get metadata(): { readonly createdAt: string; readonly updatedAt: string; readonly identityCount: number; readonly secretCount: number; readonly trustRoot?: string } {
    const base = {
      createdAt: this.#payload.createdAt,
      updatedAt: this.#payload.updatedAt,
      identityCount: this.#payload.identities.length,
      secretCount: Object.keys(this.#payload.secrets).length,
    };
    return this.#payload.trustSnapshot === undefined ? base : { ...base, trustRoot: this.#payload.trustSnapshot.root };
  }
}

function encryptPayload(payload: StorePayload, passphrase: string, now: Date): EncryptedEnvelope {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = deriveKey(passphrase, salt);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(canonicalJson(payload), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    format: 'sovereign-encrypted-keystore',
    version: 1,
    kdf: { name: 'scrypt', salt: salt.toString('base64url'), cost: SCRYPT_COST, blockSize: SCRYPT_BLOCK_SIZE, parallelization: SCRYPT_PARALLELIZATION },
    cipher: { name: 'aes-256-gcm', iv: iv.toString('base64url'), tag: cipher.getAuthTag().toString('base64url') },
    ciphertext: ciphertext.toString('base64url'),
    encryptedAt: now.toISOString(),
  };
}

function decryptEnvelope(envelope: EncryptedEnvelope, passphrase: string): StorePayload {
  try {
    if (envelope.format !== 'sovereign-encrypted-keystore' || envelope.version !== 1) throw new Error('unsupported_keystore_format');
    if (envelope.kdf.name !== 'scrypt' || envelope.cipher.name !== 'aes-256-gcm') throw new Error('unsupported_keystore_crypto');
    if (envelope.kdf.cost !== SCRYPT_COST || envelope.kdf.blockSize !== SCRYPT_BLOCK_SIZE || envelope.kdf.parallelization !== SCRYPT_PARALLELIZATION) throw new Error('unsupported_keystore_kdf_parameters');
    const salt = Buffer.from(envelope.kdf.salt, 'base64url');
    const key = deriveKey(passphrase, salt);
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.cipher.iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(envelope.cipher.tag, 'base64url'));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64url')), decipher.final()]);
    return JSON.parse(plaintext.toString('utf8')) as StorePayload;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('unsupported_keystore_')) throw error;
    throw new Error('keystore_decryption_failed');
  }
}

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return scryptSync(passphrase, salt, 32, {
    N: SCRYPT_COST,
    r: SCRYPT_BLOCK_SIZE,
    p: SCRYPT_PARALLELIZATION,
    maxmem: 64 * 1024 * 1024,
  });
}

function validatePassphrase(passphrase: string): void {
  if (passphrase.length < 16) throw new Error('keystore_passphrase_too_short');
}

function validatePayload(payload: StorePayload): void {
  if (payload.formatVersion !== 1) throw new Error('invalid_keystore_payload');
  if (!Number.isFinite(Date.parse(payload.createdAt)) || !Number.isFinite(Date.parse(payload.updatedAt))) throw new Error('invalid_keystore_timestamp');
  const ids = new Set<string>();
  for (const identity of payload.identities) {
    if (identity.keyId.trim() === '' || ids.has(identity.keyId)) throw new Error('invalid_keystore_identity');
    createPrivateKey(identity.privateKeyPem);
    const derivedPublic = createPublicKey(createPrivateKey(identity.privateKeyPem)).export({ type: 'spki', format: 'pem' }).toString();
    if (derivedPublic !== identity.publicKeyPem) throw new Error('keystore_public_private_mismatch');
    ids.add(identity.keyId);
  }
  if (payload.trustSnapshot !== undefined && !KeyLifecycleRegistry.verifySnapshot(payload.trustSnapshot)) throw new Error('invalid_trust_snapshot');
}
