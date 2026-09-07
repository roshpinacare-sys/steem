// src/lib/polyglot/strategies/raw-polyglot-patched.ts
//
// Ported from v1.2.0. A minimal PDF is prepended to the ZIP bytes; every
// central-directory entry's local-header offset and the EOCD's CD offset are
// repointed forward by exactly the prefix length. No ZIP payload byte is
// touched. `unzip` works directly on the output. Fully reversible.

import { concatBytes, u32, writeU32 } from "../bytes";
import { LFH_SIG, readZipStructure, walkCentralDirectory } from "../zip-reader";
import { assemblePdf, buildCatalog, buildCoverPage } from "../pdf-writer";
import type { StrategyModule } from "../polyglot";

export const name = "raw-polyglot-patched" as const;
export const label =
  "Raw polyglot — patched offsets (v1 default, most compatible, directly unzippable)";
export const isTrueByteLevelPolyglot = true;
export const isExtractable = true;

function buildPdfPrefix(origName: string, cdEntryCount: number): Uint8Array {
  const { objects, pagesNum } = buildCoverPage(2, [
    { text: "This PDF is also a ZIP file.", size: 16 },
    { text: "Rename to .zip, or run: unzip " + origName.replace(/\.zip$/i, ".pdf") },
    { text: cdEntryCount + " file(s) embedded." },
  ]);
  const catalogNum = 1;
  objects[catalogNum] = buildCatalog(catalogNum, pagesNum);
  return assemblePdf(objects, catalogNum);
}

export function build(
  zipBuf: Uint8Array,
  origName: string,
  opts: { onLog?: (m: string) => void } = {}
): { bytes: Uint8Array; prefixLen: number; entryCount: number } {
  const onLog = opts.onLog || (() => {});
  const { eocdOff, entryCount: cdEntryCount, cdOffset } = readZipStructure(zipBuf);
  onLog(`found central directory: ${cdEntryCount} entries @ offset ${cdOffset}`);

  const prefix = buildPdfPrefix(origName, cdEntryCount);
  const prefixLen = prefix.length;

  const patched = new Uint8Array(zipBuf);
  let patchedEntries = 0;
  for (const entry of walkCentralDirectory(patched, cdOffset, cdEntryCount)) {
    writeU32(patched, entry.localHeaderOffsetFieldPos, entry.localHeaderOffset + prefixLen);
    patchedEntries++;
  }
  writeU32(patched, eocdOff + 16, cdOffset + prefixLen);
  onLog(`repointed ${patchedEntries} local-file-header offsets + central directory offset`);

  const finalBytes = concatBytes([prefix, patched]);
  return { bytes: finalBytes, prefixLen, entryCount: patchedEntries };
}

export function detectPrefixLen(buf: Uint8Array): number {
  try {
    const { eocdOff, cdOffset, cdSize, entryCount } = readZipStructure(buf);
    // v2.1 fix: a 0-entry zip is EOCD-only (no central directory, no local
    // headers). The prefix is everything before the EOCD. The patched build()
    // shifted cdOffset from 0 to prefixLen, and cdSize stays 0, so we can
    // anchor on the EOCD's physical position directly.
    if (entryCount === 0 && cdSize === 0) {
      return eocdOff;
    }
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

export function extract(
  buf: Uint8Array,
  opts: { onLog?: (m: string) => void } = {}
): { bytes: Uint8Array; prefixLen: number; entryCount: number } {
  const onLog = opts.onLog || (() => {});
  const prefixLen = detectPrefixLen(buf);
  if (prefixLen < 0) {
    throw new Error(
      "Does not look like a raw-polyglot-patched file (no valid shifted offsets found)."
    );
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
  onLog(`restored ${restored} local-header offset(s) + EOCD central-directory offset`);
  return { bytes: zipBytes, prefixLen, entryCount: restored };
}

const _module: StrategyModule = { name, label, isTrueByteLevelPolyglot, isExtractable, build, extract };
export default _module;
