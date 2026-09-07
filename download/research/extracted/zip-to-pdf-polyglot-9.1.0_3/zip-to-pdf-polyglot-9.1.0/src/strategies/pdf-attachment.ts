// src/lib/polyglot/strategies/pdf-attachment.ts
//
// Ported from v1.2.0. Embeds the ZIP as a proper PDF /EmbeddedFile stream
// (ISO 32000-1 §7.11.4), hex-encoded via ASCIIHexDecode so the stream body
// can never contain a stray `endstream` token. Spec-compliant, survives PDF
// re-optimization, but NOT directly unzippable. Fully reversible.

import { findBytes, fromHex, toHex, utf8 } from "../bytes";
import { readZipStructure } from "../zip-reader";
import { assemblePdf, buildCatalog, buildCoverPage, dictObject, pdfLiteral, streamObject } from "../pdf-writer";
import type { StrategyModule } from "../polyglot";

export const name = "pdf-attachment" as const;
export const label = "PDF attachment — spec-compliant, not directly unzippable";
export const isTrueByteLevelPolyglot = false;
export const isExtractable = true;

export function build(
  zipBuf: Uint8Array,
  origName: string,
  opts: { onLog?: (m: string) => void } = {}
): { bytes: Uint8Array; entryCount: number; attachmentSize: number } {
  const onLog = opts.onLog || (() => {});
  const { entryCount: cdEntryCount } = readZipStructure(zipBuf);
  onLog(`found central directory: ${cdEntryCount} entries — validated, will not be repointed`);

  const attachName = origName || "archive.zip";

  const { objects, pagesNum, nextNum } = buildCoverPage(4, [
    { text: "This PDF carries a ZIP file as an attachment.", size: 16 },
    { text: "Open the Attachments/Paperclip panel in your PDF viewer to extract it." },
    { text: "File: " + attachName + "  (" + cdEntryCount + " file(s) inside)" },
  ]);

  const filespecNum = nextNum;
  const embeddedFileNum = nextNum + 1;
  const catalogNum = 1;

  const hexBytes = toHex(zipBuf);
  onLog(`hex-encoding attachment via ASCIIHexDecode: ${zipBuf.length} -> ${hexBytes.length} bytes`);

  objects[embeddedFileNum] = streamObject(
    embeddedFileNum,
    `/Type /EmbeddedFile /Subtype /application#2Fzip /Filter /ASCIIHexDecode /Params << /Size ${zipBuf.length} >>`,
    hexBytes
  );

  objects[filespecNum] = dictObject(
    filespecNum,
    `<< /Type /Filespec /F ${pdfLiteral(attachName)} /UF ${pdfLiteral(attachName)} ` +
      `/EF << /F ${embeddedFileNum} 0 R >> /Desc ${pdfLiteral(
        "Original zip archive (" + cdEntryCount + " files)"
      )} >>`
  );

  objects[catalogNum] = buildCatalog(
    catalogNum,
    pagesNum,
    ` /Names << /EmbeddedFiles << /Names [${pdfLiteral(attachName)} ${filespecNum} 0 R] >> >> /PageMode /UseAttachments`
  );

  const bytes = assemblePdf(objects, catalogNum);
  onLog("assembled spec-compliant PDF with embedded-file attachment");
  return { bytes, entryCount: cdEntryCount, attachmentSize: zipBuf.length };
}

const NEEDLE_TYPE = utf8("/Type /EmbeddedFile");
const NEEDLE_STREAM_START = utf8("stream\n");
const NEEDLE_STREAM_END = utf8("\nendstream");

export function extract(
  buf: Uint8Array,
  opts: { onLog?: (m: string) => void } = {}
): { bytes: Uint8Array; entryCount: number } {
  const onLog = opts.onLog || (() => {});
  const typeOff = findBytes(buf, NEEDLE_TYPE);
  if (typeOff < 0) {
    throw new Error("No /Type /EmbeddedFile object found — not a pdf-attachment file.");
  }
  const streamStart = findBytes(buf, NEEDLE_STREAM_START, typeOff);
  if (streamStart < 0) {
    throw new Error("Found /Type /EmbeddedFile but no following stream keyword — malformed file.");
  }
  const dataStart = streamStart + NEEDLE_STREAM_START.length;
  const dataEnd = findBytes(buf, NEEDLE_STREAM_END, dataStart);
  if (dataEnd < 0) {
    throw new Error("Found embedded-file stream start but no matching endstream — malformed file.");
  }
  onLog(`located embedded-file stream: ${dataEnd - dataStart} hex bytes`);

  const hexBody = buf.slice(dataStart, dataEnd);
  const zipBytes = fromHex(hexBody);
  onLog(`decoded ASCIIHexDecode: ${hexBody.length} -> ${zipBytes.length} bytes`);

  const { entryCount } = readZipStructure(zipBytes);
  onLog(`decoded payload validates as a standard ZIP: ${entryCount} entries`);
  return { bytes: zipBytes, entryCount };
}

const _module: StrategyModule = { name, label, isTrueByteLevelPolyglot, isExtractable, build, extract };
export default _module;
