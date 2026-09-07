import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { canonicalJson, sha256 } from "@/lib/durable/canonical-json";

export interface EncryptedSovereignArchive {
  format: "titai-sovereign-archive";
  version: 1;
  cipher: "aes-256-gcm";
  keyId: string;
  context: string;
  ivBase64: string;
  tagBase64: string;
  ciphertextBase64: string;
  plaintextSha256: string;
  createdAt: string;
}

function decodeKey(keyBase64: string): Buffer {
  const key = Buffer.from(keyBase64, "base64");
  if (key.byteLength !== 32) throw new Error("archive_key_invalid");
  return key;
}

export function createEncryptedSovereignArchive<T>(options: {
  payload: T;
  keyBase64: string;
  keyId: string;
  context: string;
  now?: Date;
}): EncryptedSovereignArchive {
  const key = decodeKey(options.keyBase64);
  const iv = randomBytes(12);
  const aad = Buffer.from(`titai-sovereign-archive:v1:${options.keyId}:${options.context}`, "utf8");
  const plaintext = Buffer.from(canonicalJson(options.payload), "utf8");
  try {
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(aad);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return {
      format: "titai-sovereign-archive",
      version: 1,
      cipher: "aes-256-gcm",
      keyId: options.keyId,
      context: options.context,
      ivBase64: iv.toString("base64"),
      tagBase64: cipher.getAuthTag().toString("base64"),
      ciphertextBase64: ciphertext.toString("base64"),
      plaintextSha256: sha256(JSON.parse(plaintext.toString("utf8")) as T),
      createdAt: (options.now ?? new Date()).toISOString(),
    };
  } finally {
    key.fill(0);
  }
}

export function restoreEncryptedSovereignArchive<T>(options: {
  archive: EncryptedSovereignArchive;
  keyBase64: string;
  expectedKeyId?: string;
  expectedContext?: string;
}): T {
  const archive = options.archive;
  if (archive.format !== "titai-sovereign-archive" || archive.version !== 1 || archive.cipher !== "aes-256-gcm") {
    throw new Error("archive_format_unsupported");
  }
  if (options.expectedKeyId && archive.keyId !== options.expectedKeyId) throw new Error("archive_key_id_mismatch");
  if (options.expectedContext && archive.context !== options.expectedContext) throw new Error("archive_context_mismatch");
  const key = decodeKey(options.keyBase64);
  const aad = Buffer.from(`titai-sovereign-archive:v1:${archive.keyId}:${archive.context}`, "utf8");
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(archive.ivBase64, "base64"));
    decipher.setAAD(aad);
    decipher.setAuthTag(Buffer.from(archive.tagBase64, "base64"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(archive.ciphertextBase64, "base64")),
      decipher.final(),
    ]);
    const parsed = JSON.parse(plaintext.toString("utf8")) as T;
    const actual = Buffer.from(sha256(parsed), "hex");
    const expected = Buffer.from(archive.plaintextSha256, "hex");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      throw new Error("archive_integrity_mismatch");
    }
    return parsed;
  } finally {
    key.fill(0);
  }
}
