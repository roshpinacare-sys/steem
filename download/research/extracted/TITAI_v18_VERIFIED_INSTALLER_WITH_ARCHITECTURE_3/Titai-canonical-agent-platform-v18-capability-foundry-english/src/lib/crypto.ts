import "server-only";
import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";

const PURPOSE = "titai:provider-keys:v2";

function masterKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "ENCRYPTION_KEY is not set. Generate one with `openssl rand -base64 32`.",
    );
  }
  const buf = Buffer.from(raw, "base64");
  if (buf.length < 32) {
    throw new Error("ENCRYPTION_KEY must decode to at least 32 bytes.");
  }
  return buf.subarray(0, 32);
}

function subkey(version: 1 | 2): Buffer {
  const purpose = version === 1 ? "titai:provider-keys:v1" : PURPOSE;
  return Buffer.from(
    hkdfSync("sha256", masterKey(), Buffer.alloc(0), Buffer.from(purpose), 32),
  );
}

function aad(context: string): Buffer {
  if (!context || context.length > 512) throw new Error("invalid_encryption_context");
  return Buffer.from(`titai-secret:${context}`, "utf8");
}

export interface Sealed {
  version?: 1 | 2;
  ciphertext: string;
  iv: string;
  tag: string;
}

export function encryptSecret(plaintext: string, context = "legacy"): Sealed {
  const iv = randomBytes(12);
  const key = subkey(2);
  try {
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(aad(context));
    const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return {
      version: 2,
      ciphertext: enc.toString("base64"),
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
    };
  } finally {
    key.fill(0);
  }
}

export function decryptSecret(sealed: Sealed, context = "legacy"): string {
  const version = sealed.version ?? 1;
  const key = subkey(version);
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(sealed.iv, "base64"),
    );
    if (version === 2) decipher.setAAD(aad(context));
    decipher.setAuthTag(Buffer.from(sealed.tag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(sealed.ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } finally {
    key.fill(0);
  }
}

export function maskSecret(plaintext: string): string {
  return `••••${plaintext.slice(-4)}`;
}
