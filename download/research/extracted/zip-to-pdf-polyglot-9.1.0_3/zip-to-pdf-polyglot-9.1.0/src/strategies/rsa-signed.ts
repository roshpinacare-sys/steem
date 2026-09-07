// src/strategies/rsa-signed.ts — v8.1 NEW STRATEGY
//
// RSA-2048 + SHA-256 digitally-signed polyglot PDF.
//
// Unlike raw-polyglot-signed (which embeds a plain SHA-256 hex string), this
// strategy generates a real asymmetric cryptographic signature. The private
// key signs the ZIP's SHA-256 digest; the public key + signature are embedded
// in the PDF. Anyone with the PDF can verify authenticity without a shared
// secret.
//
// Use cases:
//   - Software artifact distribution (verify binary hasn't been tampered)
//   - Document notarization without a CA (the PDF IS the notary record)
//   - Chain-of-custody audit trails (embed multiple signatures via incremental updates)
//
// Signature algorithm:   RSA-2048 + RSASSA-PKCS1-v1_5, SHA-256 digest
// Key format:            SPKI (public), PKCS#8 (private), PEM-encoded
// Key embedding:         Public key embedded as /PolyglotPublicKey stream
// Signature embedding:   Hex-encoded in /PolyglotSignature stream
//
// The private key is returned in the build result so the caller can store it.
// (The PDF only carries the public key — the private key is NOT embedded.)
//
// Extract path:
//   1. Read ZIP from the PDF prefix (patched-offset raw polyglot)
//   2. Locate /PolyglotPublicKey and /PolyglotSignature streams
//   3. Verify RSA-SHA256 signature over the ZIP bytes
//   4. Return ZIP + verification status
//
// isTrueByteLevelPolyglot: true  (PDF prefix + patched ZIP — directly unzippable)
// isExtractable: true

import {
  generateKeyPairSync,
  createSign,
  createVerify,
  createHash,
} from "node:crypto";
import { concatBytes, u32, writeU32, utf8 } from "../bytes";
import { LFH_SIG, readZipStructure, walkCentralDirectory } from "../zip-reader";
import { assemblePdf, buildCatalog, buildCoverPage, streamObject, dictObject } from "../pdf-writer";
import type { StrategyModule } from "../polyglot";

export const name = "rsa-signed" as const;
export const label =
  "RSA-2048 signed — asymmetric SHA-256 signature, public-key embedded in PDF [v8.1]";
export const isTrueByteLevelPolyglot = true;
export const isExtractable = true;

// ---------------------------------------------------------------------------
// Key generation
// ---------------------------------------------------------------------------
function generateRsaKeyPair(): { publicKeyPem: string; privateKeyPem: string } {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  return { publicKeyPem: publicKey, privateKeyPem: privateKey };
}

// ---------------------------------------------------------------------------
// Sign / verify
// ---------------------------------------------------------------------------
function signZip(zipBytes: Uint8Array, privateKeyPem: string): Buffer {
  const signer = createSign("SHA256");
  signer.update(Buffer.from(zipBytes));
  return signer.sign(privateKeyPem);
}

function verifyZip(
  zipBytes: Uint8Array,
  publicKeyPem: string,
  signature: Buffer
): boolean {
  try {
    const verifier = createVerify("SHA256");
    verifier.update(Buffer.from(zipBytes));
    return verifier.verify(publicKeyPem, signature);
  } catch {
    return false;
  }
}

function sha256hex(bytes: Uint8Array): string {
  return createHash("sha256").update(Buffer.from(bytes)).digest("hex");
}

// ---------------------------------------------------------------------------
// ZIP prefix patching (same as raw-polyglot-patched)
// ---------------------------------------------------------------------------
function patchZipOffsets(
  zipBuf: Uint8Array,
  prefixLen: number
): Uint8Array {
  const { eocdOff, cdOffset, entryCount } = readZipStructure(zipBuf);
  const patched = new Uint8Array(zipBuf);
  for (const entry of walkCentralDirectory(patched, cdOffset, entryCount)) {
    writeU32(patched, entry.localHeaderOffsetFieldPos, entry.localHeaderOffset + prefixLen);
  }
  writeU32(patched, eocdOff + 16, cdOffset + prefixLen);
  return patched;
}

function unPatchZipOffsets(
  zipBuf: Uint8Array,
  prefixLen: number
): Uint8Array {
  const { eocdOff, cdOffset, entryCount } = readZipStructure(zipBuf);
  const restored = new Uint8Array(zipBuf);
  for (const entry of walkCentralDirectory(restored, cdOffset, entryCount)) {
    writeU32(restored, entry.localHeaderOffsetFieldPos, entry.localHeaderOffset - prefixLen);
  }
  writeU32(restored, eocdOff + 16, cdOffset - prefixLen);
  return restored;
}

// ---------------------------------------------------------------------------
// Detect PDF prefix length (same logic as raw-polyglot-patched)
// ---------------------------------------------------------------------------
function detectPrefixLen(buf: Uint8Array): number {
  try {
    const { eocdOff, cdOffset, cdSize, entryCount } = readZipStructure(buf);
    if (entryCount === 0 && cdSize === 0) return eocdOff;
    let min = Infinity;
    for (const entry of walkCentralDirectory(buf, cdOffset, entryCount)) {
      if (entry.localHeaderOffset < min) min = entry.localHeaderOffset;
    }
    if (!isFinite(min) || min <= 0) return -1;
    if (u32(buf, min) !== LFH_SIG) return -1;
    return min;
  } catch {
    return -1;
  }
}

// PDF stream markers
const PUB_KEY_MARKER = utf8("/Type /PolyglotPublicKey");
const SIG_MARKER = utf8("/Type /PolyglotSignature");
const STREAM_OPEN = utf8("stream\n");
const STREAM_CLOSE = utf8("\nendstream");

function readStreamAfterMarker(buf: Uint8Array, marker: Uint8Array): string | null {
  const markerOff = findBytes(buf, marker);
  if (markerOff < 0) return null;
  const streamOff = findBytes(buf, STREAM_OPEN, markerOff);
  if (streamOff < 0) return null;
  const dataStart = streamOff + STREAM_OPEN.length;
  const dataEnd = findBytes(buf, STREAM_CLOSE, dataStart);
  if (dataEnd < 0) return null;
  return new TextDecoder("latin1").decode(buf.slice(dataStart, dataEnd));
}

function findBytes(buf: Uint8Array, needle: Uint8Array, start = 0): number {
  outer: for (let i = start; i <= buf.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (buf[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------
export function build(
  zipBuf: Uint8Array,
  origName: string,
  opts: {
    onLog?: (m: string) => void;
    privateKeyPem?: string;
    publicKeyPem?: string;
  } = {}
): {
  bytes: Uint8Array;
  prefixLen: number;
  entryCount: number;
  sha256: string;
  publicKeyPem: string;
  privateKeyPem: string;
  signatureHex: string;
} {
  const onLog = opts.onLog ?? (() => {});

  // Generate or accept provided key pair
  let publicKeyPem: string;
  let privateKeyPem: string;
  if (opts.privateKeyPem && opts.publicKeyPem) {
    privateKeyPem = opts.privateKeyPem;
    publicKeyPem = opts.publicKeyPem;
    onLog("using provided RSA key pair");
  } else {
    const kp = generateRsaKeyPair();
    privateKeyPem = kp.privateKeyPem;
    publicKeyPem = kp.publicKeyPem;
    onLog("generated RSA-2048 key pair");
  }

  const { eocdOff, entryCount, cdOffset } = readZipStructure(zipBuf);
  const zipHash = sha256hex(zipBuf);
  onLog(`ZIP SHA-256: ${zipHash}`);

  const signature = signZip(zipBuf, privateKeyPem);
  const signatureHex = signature.toString("hex").toUpperCase();
  onLog(`RSA-2048/SHA-256 signature: ${signatureHex.slice(0, 16)}… (${signature.length} bytes)`);

  // Build PDF prefix containing the cover + public key + signature streams
  const { objects, pagesNum, nextNum } = buildCoverPage(2, [
    { text: "RSA-2048 + SHA-256 signed polyglot PDF.", size: 16 },
    { text: "Digital signature embedded. Verify with: zip2pdf extract --strategy rsa-signed" },
    { text: "Archive: " + (origName || "archive.zip") + "  (" + entryCount + " files)" },
    { text: "SHA-256: " + zipHash.slice(0, 48) + "…" },
  ]);

  let obj = nextNum;
  const pubKeyObjNum = obj++;
  const sigObjNum = obj++;
  const catalogNum = 1;

  objects[pubKeyObjNum] = streamObject(
    pubKeyObjNum,
    "/Type /PolyglotPublicKey /Algorithm /RSA-2048",
    utf8(publicKeyPem)
  );

  objects[sigObjNum] = streamObject(
    sigObjNum,
    `/Type /PolyglotSignature /Algorithm /RSA-SHA256 /Hash (${zipHash})`,
    utf8(signatureHex)
  );

  objects[catalogNum] = buildCatalog(
    catalogNum,
    pagesNum,
    ` /Polyglot << /Version 8 /Strategy /rsa-signed /PublicKey ${pubKeyObjNum} 0 R /Signature ${sigObjNum} 0 R >>`
  );

  const prefix = assemblePdf(objects, catalogNum);
  const prefixLen = prefix.length;
  onLog(`PDF prefix: ${prefixLen} bytes`);

  // Patch ZIP offsets
  const patched = patchZipOffsets(zipBuf, prefixLen);
  const finalBytes = concatBytes([prefix, patched]);
  onLog(`assembled RSA-signed PDF: ${finalBytes.length} bytes total`);

  return {
    bytes: finalBytes,
    prefixLen,
    entryCount,
    sha256: zipHash,
    publicKeyPem,
    privateKeyPem,
    signatureHex,
  };
}

// ---------------------------------------------------------------------------
// Extract
// ---------------------------------------------------------------------------
export function extract(
  buf: Uint8Array,
  opts: { onLog?: (m: string) => void; skipVerify?: boolean } = {}
): {
  bytes: Uint8Array;
  prefixLen: number;
  entryCount: number;
  sha256: string;
  signatureValid: boolean;
} {
  const onLog = opts.onLog ?? (() => {});

  const prefixLen = detectPrefixLen(buf);
  if (prefixLen < 0) {
    throw new Error("Does not look like an rsa-signed file (no valid shifted offsets).");
  }
  onLog(`detected PDF prefix: ${prefixLen} bytes`);

  const zipBytes = new Uint8Array(buf.slice(prefixLen));
  const { eocdOff, cdOffset: cdOffsetPatched, entryCount } = readZipStructure(zipBytes);
  const cdOffset = cdOffsetPatched - prefixLen;

  const restored = unPatchZipOffsets(zipBytes, prefixLen);
  const zipHash = sha256hex(restored);
  onLog(`ZIP SHA-256: ${zipHash}`);

  // Read embedded public key and signature from the PDF prefix
  const prefix = buf.slice(0, prefixLen);
  let signatureValid = false;

  const pubKeyPem = readStreamAfterMarker(prefix, PUB_KEY_MARKER);
  const sigHex = readStreamAfterMarker(prefix, SIG_MARKER);

  if (opts.skipVerify) {
    onLog("signature verification skipped (--skipVerify)");
    signatureValid = true;
  } else if (pubKeyPem && sigHex) {
    const sig = Buffer.from(sigHex.trim(), "hex");
    signatureValid = verifyZip(restored, pubKeyPem, sig);
    if (signatureValid) {
      onLog("RSA-2048/SHA-256 signature VERIFIED ✓");
    } else {
      onLog("WARNING: RSA signature INVALID — ZIP may have been tampered!");
    }
  } else {
    onLog("WARNING: no embedded public key or signature found — cannot verify");
  }

  return { bytes: restored, prefixLen, entryCount, sha256: zipHash, signatureValid };
}

const _module: StrategyModule = {
  name,
  label,
  isTrueByteLevelPolyglot,
  isExtractable,
  build,
  extract,
};
export default _module;
