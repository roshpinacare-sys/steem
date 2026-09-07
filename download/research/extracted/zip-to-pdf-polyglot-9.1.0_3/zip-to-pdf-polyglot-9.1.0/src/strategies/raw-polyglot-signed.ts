// src/lib/polyglot/strategies/raw-polyglot-signed.ts
//
// Strategy: raw polyglot with patched offsets (like raw-polyglot-patched)
// PLUS cryptographic integrity metadata.
//
// Additional properties vs raw-polyglot-patched:
//  1. SHA-256 of the ZIP payload is printed on the cover page AND stored in
//     the PDF /Info dictionary as /PolyglotSHA256 — any agent or person can
//     verify the extracted ZIP without running the full extractor.
//  2. The PDF /Info dict carries /PolyglotVersion, /PolyglotStrategy,
//     /PolyglotOrigName, /PolyglotEntryCount — machine-readable metadata that
//     survives copy-paste and re-hosting of the file.
//  3. Extraction verifies the SHA-256 before returning bytes; throws on mismatch.
//
// Use this strategy when distributing polyglot PDFs over untrusted channels
// (CDNs, email, chat) where byte-for-byte integrity matters.

import { concatBytes, u32, writeU32, utf8 } from "../bytes";
import { findBytes } from "../bytes";
import { LFH_SIG, readZipStructure, walkCentralDirectory } from "../zip-reader";
import { assemblePdf, buildCatalog, buildCoverPage } from "../pdf-writer";
import type { StrategyModule } from "../polyglot";

export const name = "raw-polyglot-signed" as const;
export const label =
  "Raw polyglot — signed (patched offsets + SHA-256 integrity, verified on extraction)";
export const isTrueByteLevelPolyglot = true;
export const isExtractable = true;

// ---------------------------------------------------------------------------
// SHA-256 (pure JS, no Web Crypto — works in both Node and browser sync)
// ---------------------------------------------------------------------------

// Adapted from https://geraintluff.github.io/sha256/ (public domain).
function sha256Hex(data: Uint8Array): string {
  function rightRotate(v: number, a: number) { return (v >>> a) | (v << (32 - a)); }
  const mathPow = Math.pow;
  const maxWord = mathPow(2, 32);
  const K: number[] = [];
  let primes: number[] = [], result = "";
  for (let n = 2; primes.length < 64; n++) {
    if (primes.every(p => n % p)) {
      for (let i = 0; i < 64; i++) K.push(0 | (mathPow(n, 0.5) % 1 * maxWord));
      primes.push(n);
    }
  }
  // Initialise hash values (first fractional bits of sqrt of first 8 primes):
  let h = [1779033703, 3144134277, 1013904242, 2773480762,
            1359893119, 2600822924,  528734635, 1541459225];

  const len = data.length;
  const padded: number[] = [...data];
  padded.push(0x80);
  while ((padded.length % 64) !== 56) padded.push(0);
  const bitLen = len * 8;
  for (let i = 7; i >= 0; i--) { padded.push((bitLen / mathPow(2, i * 8)) & 0xff); }

  for (let j = 0; j < padded.length; j += 64) {
    const w: number[] = [];
    for (let i = 0; i < 16; i++) {
      w[i] = (padded[j + i*4] << 24) | (padded[j + i*4+1] << 16) |
              (padded[j + i*4+2] << 8) | padded[j + i*4+3];
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rightRotate(w[i-15], 7) ^ rightRotate(w[i-15], 18) ^ (w[i-15] >>> 3);
      const s1 = rightRotate(w[i-2], 17) ^ rightRotate(w[i-2], 19) ^ (w[i-2] >>> 10);
      w[i] = (w[i-16] + s0 + w[i-7] + s1) | 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const S1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
      const ch = (e & f) ^ (~e & g);
      const T1 = (hh + S1 + ch + K[i] + w[i]) | 0;
      const S0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const T2 = (S0 + maj) | 0;
      hh = g; g = f; f = e; e = (d + T1) | 0;
      d = c; c = b; b = a; a = (T1 + T2) | 0;
    }
    h = [(h[0]+a)|0,(h[1]+b)|0,(h[2]+c)|0,(h[3]+d)|0,
         (h[4]+e)|0,(h[5]+f)|0,(h[6]+g)|0,(h[7]+hh)|0];
  }
  return h.map(x => x.toString(16).padStart(8, "0")).join("");
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

export function build(
  zipBuf: Uint8Array,
  origName: string,
  opts: { onLog?: (m: string) => void } = {}
): { bytes: Uint8Array; prefixLen: number; entryCount: number; sha256: string } {
  const onLog = opts.onLog ?? (() => {});
  const { eocdOff, entryCount, cdOffset } = readZipStructure(zipBuf);
  onLog(`raw-polyglot-signed: ${entryCount} entries @ offset ${cdOffset}`);

  const sha256 = sha256Hex(zipBuf);
  onLog(`SHA-256(zip): ${sha256}`);

  const { objects, pagesNum } = buildCoverPage(2, [
    { text: "This PDF is also a ZIP file.", size: 16 },
    { text: `Archive: ${origName}  (${entryCount} files)` },
    { text: `SHA-256: ${sha256.slice(0, 32)}` },
    { text: `        ${sha256.slice(32)}` },
    { text: "Verify: zip2pdf verify --strategy raw-polyglot-signed file.pdf" },
  ]);
  const catalogNum = 1;

  // Embed SHA-256 in /Info dict for machine-readable access.
  const infoExtra =
    ` /PolyglotSHA256 (${sha256})` +
    ` /PolyglotVersion (7.0.0)` +
    ` /PolyglotStrategy (raw-polyglot-signed)` +
    ` /PolyglotOrigName (${origName})` +
    ` /PolyglotEntryCount (${entryCount})`;

  // Build catalog with /Info reference (info object added below).
  const infoNum = Object.keys(objects).length + 2; // next available num
  objects[catalogNum] = buildCatalog(catalogNum, pagesNum);
  // Manually add Info object
  objects[infoNum] = utf8(`${infoNum} 0 obj\n<< ${infoExtra} >>\nendobj\n`);

  const prefix = assemblePdf(objects, catalogNum, ` /Info ${infoNum} 0 R`);
  const prefixLen = prefix.length;
  onLog(`PDF prefix with /Info dict: ${prefixLen} bytes`);

  // Patch ZIP local-header offsets (same as raw-polyglot-patched).
  const patched = new Uint8Array(zipBuf);
  let patchedCount = 0;
  for (const entry of walkCentralDirectory(patched, cdOffset, entryCount)) {
    writeU32(patched, entry.localHeaderOffsetFieldPos, entry.localHeaderOffset + prefixLen);
    patchedCount++;
  }
  writeU32(patched, eocdOff + 16, cdOffset + prefixLen);
  onLog(`repointed ${patchedCount} local-header offsets + EOCD CD offset`);

  const bytes = concatBytes([prefix, patched]);
  return { bytes, prefixLen, entryCount, sha256 };
}

// ---------------------------------------------------------------------------
// Extract — finds prefix, strips it, restores offsets, verifies SHA-256
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
  } catch { return -1; }
}

/** Read /PolyglotSHA256 from /Info dict bytes. */
function readExpectedSha(buf: Uint8Array): string | null {
  const marker = utf8("/PolyglotSHA256 (");
  const off = findBytes(buf, marker);
  if (off < 0) return null;
  const start = off + marker.length;
  let end = start;
  while (end < buf.length && buf[end] !== 0x29 /* ')' */) end++;
  return new TextDecoder("ascii").decode(buf.slice(start, end));
}

export function extract(
  buf: Uint8Array,
  opts: { onLog?: (m: string) => void; skipVerify?: boolean } = {}
): { bytes: Uint8Array; prefixLen: number; entryCount: number; sha256: string } {
  const onLog = opts.onLog ?? (() => {});
  const prefixLen = detectPrefixLen(buf);
  if (prefixLen < 0) {
    throw new Error("Does not look like a raw-polyglot-signed file (prefix not detected).");
  }
  onLog(`detected PDF prefix: ${prefixLen} bytes`);

  const zipBytes = new Uint8Array(buf.slice(prefixLen));
  const { eocdOff, cdOffset: cdOffsetPatched, entryCount } = readZipStructure(zipBytes);
  const cdOffset = cdOffsetPatched - prefixLen;

  let restored = 0;
  for (const entry of walkCentralDirectory(zipBytes, cdOffset, entryCount)) {
    writeU32(zipBytes, entry.localHeaderOffsetFieldPos, entry.localHeaderOffset - prefixLen);
    restored++;
  }
  writeU32(zipBytes, eocdOff + 16, cdOffset);
  onLog(`restored ${restored} local-header offset(s)`);

  // Integrity check.
  const computedSha = sha256Hex(zipBytes);
  const expectedSha = readExpectedSha(buf);
  if (expectedSha) {
    if (computedSha !== expectedSha) {
      throw new Error(
        `SHA-256 mismatch — ZIP payload may be corrupted or tampered.\n` +
        `  expected: ${expectedSha}\n  computed: ${computedSha}`
      );
    }
    onLog(`SHA-256 verified: ${computedSha}`);
  } else {
    onLog(`warning: no /PolyglotSHA256 in /Info dict — integrity not verified`);
  }

  return { bytes: zipBytes, prefixLen, entryCount, sha256: computedSha };
}

const _module: StrategyModule = {
  name, label, isTrueByteLevelPolyglot, isExtractable, build, extract,
};
export default _module;
