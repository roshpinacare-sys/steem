import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { canonicalJson, sha256 } from "./canonical-json";
import type { DurableSnapshot } from "./types";

export interface EncryptedBackupEnvelope {
  format: "titai-durable-backup";
  version: 1;
  kdf: "scrypt";
  cipher: "aes-256-gcm";
  salt: string;
  iv: string;
  tag: string;
  ciphertext: string;
  plaintextSha256: string;
  createdAt: string;
}

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  if (passphrase.length < 12) throw new Error("backup_passphrase_too_short");
  return scryptSync(passphrase, salt, 32, { N: 16_384, r: 8, p: 1 });
}

export function createEncryptedBackup(
  snapshot: DurableSnapshot,
  passphrase: string,
  now = new Date(),
): EncryptedBackupEnvelope {
  const plaintext = Buffer.from(canonicalJson(snapshot), "utf8");
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = deriveKey(passphrase, salt);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  key.fill(0);
  return {
    format: "titai-durable-backup",
    version: 1,
    kdf: "scrypt",
    cipher: "aes-256-gcm",
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    plaintextSha256: sha256(snapshot),
    createdAt: now.toISOString(),
  };
}

export function restoreEncryptedBackup(
  envelope: EncryptedBackupEnvelope,
  passphrase: string,
): DurableSnapshot {
  if (
    envelope.format !== "titai-durable-backup" ||
    envelope.version !== 1 ||
    envelope.kdf !== "scrypt" ||
    envelope.cipher !== "aes-256-gcm"
  ) {
    throw new Error("unsupported_backup_format");
  }
  const salt = Buffer.from(envelope.salt, "base64");
  const iv = Buffer.from(envelope.iv, "base64");
  const tag = Buffer.from(envelope.tag, "base64");
  const ciphertext = Buffer.from(envelope.ciphertext, "base64");
  const key = deriveKey(passphrase, salt);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    const parsed = JSON.parse(plaintext.toString("utf8")) as DurableSnapshot;
    const actual = Buffer.from(sha256(parsed), "hex");
    const expected = Buffer.from(envelope.plaintextSha256, "hex");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      throw new Error("backup_integrity_mismatch");
    }
    if (parsed.schemaVersion !== 1) {
      throw new Error(`unsupported_snapshot_version:${parsed.schemaVersion}`);
    }
    return parsed;
  } finally {
    key.fill(0);
  }
}
