// src/lib/polyglot/zip-writer.ts
//
// Canonical (deterministic) ZIP writer. v2.2: adds Zip64 write support
// (Zip64 EOCD record + locator, Zip64 extra fields for >4GB sizes/offsets,
// >65535 entries). Stable entry order, fixed timestamps, UTF-8 names, deflate.

import { concatBytes, u16, writeU16, writeU32 } from "./bytes";
import { deflateRaw } from "./flate";

// CRC-32 (IEEE) table.
const CRC_TABLE: number[] = (() => {
  const t: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

export interface CanonicalEntry {
  name: string;
  bytes: Uint8Array;
}

const te = new TextEncoder();
const FIXED_DOS_TIME = 0x0000;
const FIXED_DOS_DATE = 0x0021; // 1980-01-01

/** Write an 8-byte little-endian value (for Zip64 fields). */
function writeU64(buf: Uint8Array, off: number, val: number): void {
  writeU32(buf, off, val & 0xffffffff);
  writeU32(buf, off + 4, Math.floor(val / 0x100000000) & 0xffffffff);
}

export function sortCanonical(entries: CanonicalEntry[]): CanonicalEntry[] {
  return [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/**
 * SECURITY FIX (SEC-01 + M3): sanitize entry names to prevent zip-slip / path
 * traversal on BOTH Unix and Windows. Normalizes backslashes to forward
 * slashes, strips leading slashes + drive letters, and collapses `..`/`.`
 * segments so the canonical ZIP is safe to extract anywhere.
 */
function sanitizeZipName(name: string): string {
  const wasDir = name.endsWith("/") || name.endsWith("\\");
  let n = name.replace(/^[a-zA-Z]:[\\/]?/, ""); // strip Windows drive letter + slash
  n = n.replace(/\\/g, "/"); // normalize backslashes to forward slashes
  n = n.replace(/^[/]+/, ""); // strip leading slashes
  // Collapse any `..` / `.` segments (now uniform on /).
  const parts: string[] = [];
  for (const seg of n.split("/")) {
    if (seg === ".." || seg === ".") continue;
    if (seg.length > 0) parts.push(seg);
  }
  let result = parts.join("/") || "unnamed";
  // Preserve trailing slash for directory entries.
  if (wasDir && !result.endsWith("/")) result += "/";
  return result;
}

export function buildCanonicalZip(entries: CanonicalEntry[]): Uint8Array {
  // v2.5: sanitize names before sorting/building.
  const safeEntries = entries.map((e) => ({ ...e, name: sanitizeZipName(e.name) }));
  const sorted = sortCanonical(safeEntries);
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  const U32MAX = 0xffffffff;
  const U16MAX = 0xffff;

  for (const e of sorted) {
    const nameBytes = te.encode(e.name);
    const isDir = e.name.endsWith("/");
    const data = isDir ? new Uint8Array(0) : e.bytes;
    let comp: Uint8Array;
    let method: number;
    if (isDir || data.length === 0) {
      comp = new Uint8Array(0);
      method = 0;
    } else {
      const deflated = deflateRaw(data, 9);
      if (deflated.length < data.length) {
        comp = deflated;
        method = 8;
      } else {
        comp = data;
        method = 0;
      }
    }
    const crc = crc32(data);
    const compLen = comp.length;
    const uncompLen = data.length;

    // v2.2: determine if this entry needs Zip64 extra fields.
    const needZip64Size = uncompLen > U32MAX || compLen > U32MAX;
    const needZip64Offset = offset > U32MAX;
    const needZip64 = needZip64Size || needZip64Offset;

    // Build the Zip64 extra field for the CD entry (and LFH if needed).
    // Layout: headerId(2) + dataSize(2) + [uncompSize(8)] + [compSize(8)] + [offset(8)]
    let zip64ExtraCd: Uint8Array | null = null;
    if (needZip64) {
      const fields: number[] = [];
      if (uncompLen > U32MAX) fields.push(uncompLen);
      if (compLen > U32MAX) fields.push(compLen);
      if (offset > U32MAX) fields.push(offset);
      const dataSize = fields.length * 8;
      zip64ExtraCd = new Uint8Array(4 + dataSize);
      writeU16(zip64ExtraCd, 0, 0x0001); // Zip64 extra header ID
      writeU16(zip64ExtraCd, 2, dataSize);
      for (let i = 0; i < fields.length; i++) {
        writeU64(zip64ExtraCd, 4 + i * 8, fields[i]);
      }
    }

    // Local file header (LFH also needs Zip64 extra if sizes > 4GB).
    const lfhExtraLen = zip64ExtraCd && needZip64Size ? zip64ExtraCd.length : 0;
    const lfh = new Uint8Array(30 + nameBytes.length + lfhExtraLen);
    writeU32(lfh, 0, 0x04034b50);
    writeU16(lfh, 4, 0x0800); // version needed (quirk preserved for byte-equality with Rust ref)
    writeU16(lfh, 6, 0x0800); // flags: bit 11 = UTF-8 name
    writeU16(lfh, 8, method);
    writeU16(lfh, 10, FIXED_DOS_TIME);
    writeU16(lfh, 12, FIXED_DOS_DATE);
    writeU32(lfh, 14, crc);
    writeU32(lfh, 18, compLen > U32MAX ? U32MAX : compLen);
    writeU32(lfh, 22, uncompLen > U32MAX ? U32MAX : uncompLen);
    writeU16(lfh, 26, nameBytes.length);
    writeU16(lfh, 28, lfhExtraLen);
    lfh.set(nameBytes, 30);
    if (lfhExtraLen > 0 && zip64ExtraCd) lfh.set(zip64ExtraCd, 30 + nameBytes.length);

    localParts.push(lfh, comp);

    // Central directory entry.
    const cdExtraLen = zip64ExtraCd ? zip64ExtraCd.length : 0;
    const cdh = new Uint8Array(46 + nameBytes.length + cdExtraLen);
    writeU32(cdh, 0, 0x02014b50);
    writeU16(cdh, 4, 0x0314); // version made by: UNIX, 2.0
    writeU16(cdh, 6, needZip64 ? 0x002d : 0x0014); // version needed: 4.5 for Zip64, else 2.0
    writeU16(cdh, 8, 0x0800); // flags: UTF-8 name
    writeU16(cdh, 10, method);
    writeU16(cdh, 12, FIXED_DOS_TIME);
    writeU16(cdh, 14, FIXED_DOS_DATE);
    writeU32(cdh, 16, crc);
    writeU32(cdh, 20, compLen > U32MAX ? U32MAX : compLen);
    writeU32(cdh, 24, uncompLen > U32MAX ? U32MAX : uncompLen);
    writeU16(cdh, 28, nameBytes.length);
    writeU16(cdh, 30, cdExtraLen);
    writeU16(cdh, 32, 0); // comment
    writeU16(cdh, 34, 0); // disk number
    writeU16(cdh, 36, 0); // internal attrs
    writeU32(cdh, 38, isDir ? 0x10 : 0); // external attrs (dir flag)
    writeU32(cdh, 42, offset > U32MAX ? U32MAX : offset); // local header offset
    cdh.set(nameBytes, 46);
    if (cdExtraLen > 0 && zip64ExtraCd) cdh.set(zip64ExtraCd, 46 + nameBytes.length);

    centralParts.push(cdh);

    offset += lfh.length + comp.length;
  }

  const cdStart = offset;
  const cdBytes = concatBytes(centralParts);
  const cdSize = cdBytes.length;
  const entryCount = sorted.length;

  // v2.2: determine if we need Zip64 EOCD records.
  const needZip64Eocd = entryCount > U16MAX || cdSize > U32MAX || cdStart > U32MAX;

  const parts: Uint8Array[] = [...localParts, cdBytes];

  if (needZip64Eocd) {
    // Zip64 EOCD record (56 bytes).
    const z64Eocd = new Uint8Array(56);
    writeU32(z64Eocd, 0, 0x06064b50); // signature
    writeU64(z64Eocd, 4, 44); // size of remaining record
    writeU16(z64Eocd, 12, 0x031e); // version made by: UNIX, 3.0
    writeU16(z64Eocd, 14, 0x002d); // version needed: 4.5
    writeU32(z64Eocd, 16, 0); // disk number
    writeU32(z64Eocd, 20, 0); // disk with CD
    writeU64(z64Eocd, 24, entryCount); // entries on this disk
    writeU64(z64Eocd, 32, entryCount); // total entries
    writeU64(z64Eocd, 40, cdSize); // CD size
    writeU64(z64Eocd, 48, cdStart); // CD offset
    parts.push(z64Eocd);

    // Zip64 EOCD locator (20 bytes).
    const z64Loc = new Uint8Array(20);
    writeU32(z64Loc, 0, 0x07064b50); // signature
    writeU32(z64Loc, 4, 0); // disk with Zip64 EOCD
    writeU64(z64Loc, 8, cdStart + cdSize); // offset of Zip64 EOCD
    writeU32(z64Loc, 16, 1); // total disks
    parts.push(z64Loc);
  }

  // Standard EOCD (with sentinels if Zip64).
  const eocd = new Uint8Array(22);
  writeU32(eocd, 0, 0x06054b50);
  writeU16(eocd, 4, 0);
  writeU16(eocd, 6, 0);
  writeU16(eocd, 8, entryCount > U16MAX ? U16MAX : entryCount);
  writeU16(eocd, 10, entryCount > U16MAX ? U16MAX : entryCount);
  writeU32(eocd, 12, cdSize > U32MAX ? U32MAX : cdSize);
  writeU32(eocd, 16, cdStart > U32MAX ? U32MAX : cdStart);
  writeU16(eocd, 20, 0);
  parts.push(eocd);

  return concatBytes(parts);
}

export { u16 };
