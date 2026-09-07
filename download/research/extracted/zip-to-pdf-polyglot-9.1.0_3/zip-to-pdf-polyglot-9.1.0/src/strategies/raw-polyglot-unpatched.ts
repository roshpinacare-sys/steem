// src/lib/polyglot/strategies/raw-polyglot-unpatched.ts
//
// Ported from v1.2.0. PDF prefix + ZIP appended completely untouched.
// Relies on the extracting tool's base-offset correction. Fully reversible
// (just slices the prefix off).

import { concatBytes } from "../bytes";
import { readZipStructure } from "../zip-reader";
import { assemblePdf, buildCatalog, buildCoverPage } from "../pdf-writer";
import type { StrategyModule } from "../polyglot";

export const name = "raw-polyglot-unpatched" as const;
export const label =
  "Raw polyglot — unpatched (ZIP bytes untouched, relies on reader offset-tolerance)";
export const isTrueByteLevelPolyglot = true;
export const isExtractable = true;

function buildPdfPrefix(origName: string, cdEntryCount: number): Uint8Array {
  const { objects, pagesNum } = buildCoverPage(2, [
    { text: "This PDF is also a ZIP file.", size: 16 },
    { text: "Rename to .zip, or run: unzip " + origName.replace(/\.zip$/i, ".pdf") },
    {
      text:
        cdEntryCount +
        " file(s) embedded (unpatched offsets — needs a tolerant unzip tool).",
    },
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
  const { entryCount: cdEntryCount, cdOffset } = readZipStructure(zipBuf);
  onLog(
    `found central directory: ${cdEntryCount} entries @ offset ${cdOffset} (will NOT be repointed)`
  );

  const prefix = buildPdfPrefix(origName, cdEntryCount);
  const prefixLen = prefix.length;
  onLog("appended zip unmodified — relying on the extracting tool's base-offset correction");

  const finalBytes = concatBytes([prefix, zipBuf]);
  return { bytes: finalBytes, prefixLen, entryCount: cdEntryCount };
}

export function detectPrefixLen(buf: Uint8Array): number {
  try {
    const { eocdOff, cdOffset, cdSize } = readZipStructure(buf);
    const prefixLen = eocdOff - (cdOffset + cdSize);
    if (prefixLen <= 0) return -1;
    return prefixLen;
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
      "Does not look like a raw-polyglot-unpatched file (EOCD/CD geometry does not resolve)."
    );
  }
  const zipBytes = new Uint8Array(buf.slice(prefixLen));
  const { entryCount } = readZipStructure(zipBytes);
  onLog(`detected PDF prefix: ${prefixLen} bytes — zip payload sliced out unmodified`);
  return { bytes: zipBytes, prefixLen, entryCount };
}

const _module: StrategyModule = { name, label, isTrueByteLevelPolyglot, isExtractable, build, extract };
export default _module;
