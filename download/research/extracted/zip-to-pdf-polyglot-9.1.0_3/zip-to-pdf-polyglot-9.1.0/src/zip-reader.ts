// src/lib/polyglot/zip-reader.ts
//
// Read-only ZIP structure parsing. v2.2: adds Zip64 read support (EOCD
// sentinel detection, Zip64 EOCD locator + record parsing, Zip64 extra-field
// parsing for 8-byte sizes/offsets). Never mutates the buffer it's given.

import { u16, u32 } from "./bytes";
import { inflateRawSync } from "node:zlib";

export const EOCD_SIG = 0x06054b50;
export const CD_SIG = 0x02014b50;
export const LFH_SIG = 0x04034b50;
export const ZIP64_EOCD_SIG = 0x06064b50;
export const ZIP64_LOCATOR_SIG = 0x07064b50;
const ZIP64_EXTRA_ID = 0x0001;

export interface Eocd {
  entryCount: number;
  cdSize: number;
  cdOffset: number;
}

export interface CentralDirEntry {
  index: number;
  entryStart: number;
  nameLen: number;
  extraLen: number;
  commentLen: number;
  localHeaderOffsetFieldPos: number;
  localHeaderOffset: number;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  crc32: number;
  flags: number;
  name: string;
  isDirectory: boolean;
  cdNamePos: number;
}

/** Read an 8-byte little-endian value as a JS number (safe up to 2^53). */
function u64(buf: Uint8Array, off: number): number {
  const lo = u32(buf, off);
  const hi = u32(buf, off + 4);
  return lo + hi * 0x100000000;
}

/** Locate the End Of Central Directory record by scanning backward. */
export function findEOCD(buf: Uint8Array): number {
  const sig = [0x50, 0x4b, 0x05, 0x06];
  const minPos = Math.max(0, buf.length - (22 + 65535));
  for (let i = buf.length - 22; i >= minPos; i--) {
    if (
      buf[i] === sig[0] &&
      buf[i + 1] === sig[1] &&
      buf[i + 2] === sig[2] &&
      buf[i + 3] === sig[3]
    ) {
      return i;
    }
  }
  throw new Error("Not a valid zip file (EOCD signature not found).");
}

export function parseEOCD(buf: Uint8Array, eocdOff: number): Eocd {
  return {
    entryCount: u16(buf, eocdOff + 10),
    cdSize: u32(buf, eocdOff + 12),
    cdOffset: u32(buf, eocdOff + 16),
  };
}

/**
 * v2.2: If the EOCD has Zip64 sentinel values (0xFFFF entry count or
 * 0xFFFFFFFF cdOffset/cdSize), find and parse the Zip64 EOCD locator +
 * record to get the real values. Returns the corrected Eocd, or the original
 * if no Zip64 extension is present.
 */
function resolveZip64(buf: Uint8Array, eocdOff: number, eocd: Eocd): Eocd {
  const needsZip64 =
    eocd.entryCount === 0xffff ||
    eocd.cdOffset === 0xffffffff ||
    eocd.cdSize === 0xffffffff;
  if (!needsZip64) return eocd;

  // The Zip64 EOCD locator sits immediately before the standard EOCD (20 bytes).
  const locatorOff = eocdOff - 20;
  if (locatorOff < 0 || u32(buf, locatorOff) !== ZIP64_LOCATOR_SIG) {
    throw new Error("EOCD has Zip64 sentinels but no Zip64 locator found.");
  }
  const zip64EocdDisk = u32(buf, locatorOff + 4);
  const zip64EocdOff = u64(buf, locatorOff + 8);
  // (totalDisks at locatorOff + 16 — not needed for single-disk archives)

  // Parse the Zip64 EOCD record.
  if (u32(buf, zip64EocdOff) !== ZIP64_EOCD_SIG) {
    throw new Error("Zip64 EOCD signature mismatch.");
  }
  // Layout: sig(4) + sizeOfRecord(8) + versionMadeBy(2) + versionNeeded(2) +
  //         disk(4) + diskWithCd(4) + entriesOnDisk(8) + totalEntries(8) +
  //         cdSize(8) + cdOffset(8)
  const totalEntries = u64(buf, zip64EocdOff + 32);
  const cdSize64 = u64(buf, zip64EocdOff + 40);
  const cdOffset64 = u64(buf, zip64EocdOff + 48);
  void zip64EocdDisk;

  return {
    entryCount: totalEntries,
    cdSize: cdSize64,
    cdOffset: cdOffset64,
  };
}

/** @deprecated Use readZipStructure (now Zip64-aware). Kept for v1 compat. */
export function assertNotZip64(eocd: Eocd): void {
  if (eocd.entryCount === 0xffff || eocd.cdOffset === 0xffffffff) {
    // No longer throws — Zip64 is supported in v2.2. This is a no-op stub.
  }
}

const td = new TextDecoder("utf-8", { fatal: false });

/**
 * Parse a Zip64 extra field (header 0x0001) to extract 8-byte values for any
 * fields that have the 0xFFFFFFFF sentinel in the CD entry. Returns the
 * corrected values (or the originals if no Zip64 extra field is present).
 */
function parseZip64Extra(
  buf: Uint8Array,
  extraStart: number,
  extraLen: number,
  orig: { uncompressedSize: number; compressedSize: number; localHeaderOffset: number }
): { uncompressedSize: number; compressedSize: number; localHeaderOffset: number } {
  let p = extraStart;
  const end = extraStart + extraLen;
  let uncomp = orig.uncompressedSize;
  let comp = orig.compressedSize;
  let offset = orig.localHeaderOffset;

  while (p + 4 <= end) {
    const headerId = u16(buf, p);
    const dataSize = u16(buf, p + 2);
    const dataStart = p + 4;
    if (dataStart + dataSize > end) break;

    if (headerId === ZIP64_EXTRA_ID) {
      let dp = dataStart;
      // Fields appear IN ORDER, only those with sentinel values:
      if (orig.uncompressedSize === 0xffffffff && dp + 8 <= dataStart + dataSize) {
        uncomp = u64(buf, dp);
        dp += 8;
      }
      if (orig.compressedSize === 0xffffffff && dp + 8 <= dataStart + dataSize) {
        comp = u64(buf, dp);
        dp += 8;
      }
      if (orig.localHeaderOffset === 0xffffffff && dp + 8 <= dataStart + dataSize) {
        offset = u64(buf, dp);
        dp += 8;
      }
      break; // only one Zip64 extra field per entry
    }
    p = dataStart + dataSize;
  }

  return { uncompressedSize: uncomp, compressedSize: comp, localHeaderOffset: offset };
}

/** Walk every central directory entry. v2.2: handles Zip64 extra fields. */
export function* walkCentralDirectory(
  buf: Uint8Array,
  cdOffset: number,
  entryCount: number
): Generator<CentralDirEntry> {
  let p = cdOffset;
  for (let i = 0; i < entryCount; i++) {
    if (u32(buf, p) !== CD_SIG) {
      throw new Error(
        "Central directory entry signature mismatch at offset " + p + " — file may be non-standard."
      );
    }
    const flags = u16(buf, p + 8);
    const compressionMethod = u16(buf, p + 10);
    const crc32 = u32(buf, p + 16);
    let compressedSize = u32(buf, p + 20);
    let uncompressedSize = u32(buf, p + 24);
    const nameLen = u16(buf, p + 28);
    const extraLen = u16(buf, p + 30);
    const commentLen = u16(buf, p + 32);
    let localHeaderOffset = u32(buf, p + 42);
    const cdNamePos = p + 46;
    const nameBytes = buf.slice(cdNamePos, cdNamePos + nameLen);
    const name = td.decode(nameBytes);

    // v2.2: parse Zip64 extra field if any sentinel values are present.
    if (
      uncompressedSize === 0xffffffff ||
      compressedSize === 0xffffffff ||
      localHeaderOffset === 0xffffffff
    ) {
      const z64 = parseZip64Extra(buf, cdNamePos + nameLen, extraLen, {
        uncompressedSize,
        compressedSize,
        localHeaderOffset,
      });
      uncompressedSize = z64.uncompressedSize;
      compressedSize = z64.compressedSize;
      localHeaderOffset = z64.localHeaderOffset;
    }

    yield {
      index: i,
      entryStart: p,
      nameLen,
      extraLen,
      commentLen,
      localHeaderOffsetFieldPos: p + 42,
      localHeaderOffset,
      compressionMethod,
      compressedSize,
      uncompressedSize,
      crc32,
      flags,
      name,
      isDirectory: name.endsWith("/"),
      cdNamePos,
    };
    p += 46 + nameLen + extraLen + commentLen;
  }
}

export interface ZipStructure extends Eocd {
  eocdOff: number;
}

/**
 * Parse the EOCD record (and Zip64 extension if present). v2.2: Zip64-aware.
 * Does NOT walk the central directory (v1 strategies depend on this).
 */
export function readZipStructure(buf: Uint8Array): ZipStructure {
  const eocdOff = findEOCD(buf);
  const rawEocd = parseEOCD(buf, eocdOff);
  const eocd = resolveZip64(buf, eocdOff, rawEocd);
  return { eocdOff, ...eocd };
}

/** Convenience: read EOCD + walk the central directory. */
export function readZipEntries(buf: Uint8Array): CentralDirEntry[] {
  const s = readZipStructure(buf);
  return [...walkCentralDirectory(buf, s.cdOffset, s.entryCount)];
}

/**
 * Extract a single entry's uncompressed bytes. Supports method 0 (stored) and
 * method 8 (deflate). v2.2: handles Zip64 8-byte sizes/offsets.
 */
export function extractEntryBytes(buf: Uint8Array, entry: CentralDirEntry): Uint8Array {
  const lhOff = entry.localHeaderOffset;
  if (u32(buf, lhOff) !== LFH_SIG) {
    throw new Error("Local file header signature mismatch at offset " + lhOff);
  }
  const lhNameLen = u16(buf, lhOff + 26);
  const lhExtraLen = u16(buf, lhOff + 28);
  const dataStart = lhOff + 30 + lhNameLen + lhExtraLen;
  const comp = buf.slice(dataStart, dataStart + entry.compressedSize);

  if (entry.isDirectory) return new Uint8Array(0);

  if (entry.compressionMethod === 0) {
    return comp;
  } else if (entry.compressionMethod === 8) {
    // v2.5 SECURITY FIX (SEC-02): cap inflation at 256 MB to block zip bombs.
    // A 10KB compressed stream can inflate to 4GB; this prevents OOM.
    const MAX_INFLATED = 256 * 1024 * 1024;
    const result = inflateRawSync(comp, { level: 9, maxOutputLength: MAX_INFLATED });
    if (result.length >= MAX_INFLATED && comp.length > 1024) {
      throw new Error(
        `Entry ${entry.name} inflation exceeded 256MB limit (possible zip bomb)`
      );
    }
    return result;
  } else {
    throw new Error(
      "Unsupported compression method " + entry.compressionMethod + " for entry " + entry.name
    );
  }
}
