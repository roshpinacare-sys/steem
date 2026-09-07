import {
  createHmac,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  sign,
  timingSafeEqual,
  verify,
} from "node:crypto";
import { canonicalJson, sha256 } from "@/lib/durable/canonical-json";

export type SovereignKeyPurpose =
  | "installation"
  | "tenant"
  | "workspace"
  | "data_encryption"
  | "backup"
  | "signing";

export interface DerivedKeyMaterial {
  version: number;
  purpose: SovereignKeyPurpose;
  context: string;
  keyBase64: string;
  keyId: string;
}

export interface SovereignSigningIdentity {
  keyId: string;
  algorithm: "ed25519";
  publicKeyPem: string;
  privateKeyPem: string;
  createdAt: string;
  revokedAt?: string;
}

function requireContext(context: string): string {
  const value = context.trim();
  if (!value || value.length > 500) throw new Error("key_context_invalid");
  return value;
}

export function deriveSovereignKey(options: {
  rootKey: Buffer;
  purpose: SovereignKeyPurpose;
  context: string;
  version?: number;
}): DerivedKeyMaterial {
  if (options.rootKey.byteLength < 32) throw new Error("root_key_too_short");
  const context = requireContext(options.context);
  const version = options.version ?? 1;
  if (!Number.isInteger(version) || version <= 0) throw new Error("key_version_invalid");
  const salt = createHmac("sha256", options.rootKey)
    .update(`titai-sovereign:${options.purpose}:v${version}`)
    .digest();
  const derived = Buffer.from(
    hkdfSync(
      "sha256",
      options.rootKey,
      salt,
      Buffer.from(`titai:${options.purpose}:${context}:v${version}`, "utf8"),
      32,
    ),
  );
  const keyId = sha256({ purpose: options.purpose, context, version, material: derived.toString("base64") }).slice(0, 24);
  const result = {
    version,
    purpose: options.purpose,
    context,
    keyBase64: derived.toString("base64"),
    keyId,
  };
  derived.fill(0);
  return result;
}

export function generateRootRecoveryKey(): Buffer {
  return randomBytes(32);
}

export function generateSovereignSigningIdentity(
  now = new Date(),
): SovereignSigningIdentity {
  const pair = generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  return {
    keyId: sha256(pair.publicKey).slice(0, 24),
    algorithm: "ed25519",
    publicKeyPem: pair.publicKey,
    privateKeyPem: pair.privateKey,
    createdAt: now.toISOString(),
  };
}

export interface SignedCanonicalPayload<T> {
  format: "titai-signed-payload";
  version: 1;
  keyId: string;
  algorithm: "ed25519";
  payload: T;
  payloadSha256: string;
  signedAt: string;
  signatureBase64: string;
}

export function signCanonicalPayload<T>(options: {
  payload: T;
  identity: SovereignSigningIdentity;
  now?: Date;
}): SignedCanonicalPayload<T> {
  if (options.identity.revokedAt) throw new Error("signing_key_revoked");
  const payloadSha256 = sha256(options.payload);
  const signedAt = (options.now ?? new Date()).toISOString();
  const material = canonicalJson({
    format: "titai-signed-payload",
    version: 1,
    keyId: options.identity.keyId,
    algorithm: options.identity.algorithm,
    payloadSha256,
    signedAt,
  });
  const signature = sign(null, Buffer.from(material, "utf8"), options.identity.privateKeyPem);
  return {
    format: "titai-signed-payload",
    version: 1,
    keyId: options.identity.keyId,
    algorithm: "ed25519",
    payload: structuredClone(options.payload),
    payloadSha256,
    signedAt,
    signatureBase64: signature.toString("base64"),
  };
}

export function verifyCanonicalPayload<T>(options: {
  envelope: SignedCanonicalPayload<T>;
  publicKeyPem: string;
  expectedKeyId?: string;
}): boolean {
  const envelope = options.envelope;
  if (
    envelope.format !== "titai-signed-payload" ||
    envelope.version !== 1 ||
    envelope.algorithm !== "ed25519"
  ) {
    return false;
  }
  if (options.expectedKeyId && options.expectedKeyId !== envelope.keyId) return false;
  const expectedHash = Buffer.from(envelope.payloadSha256, "hex");
  const actualHash = Buffer.from(sha256(envelope.payload), "hex");
  if (expectedHash.length !== actualHash.length || !timingSafeEqual(expectedHash, actualHash)) {
    return false;
  }
  const material = canonicalJson({
    format: envelope.format,
    version: envelope.version,
    keyId: envelope.keyId,
    algorithm: envelope.algorithm,
    payloadSha256: envelope.payloadSha256,
    signedAt: envelope.signedAt,
  });
  return verify(
    null,
    Buffer.from(material, "utf8"),
    options.publicKeyPem,
    Buffer.from(envelope.signatureBase64, "base64"),
  );
}
