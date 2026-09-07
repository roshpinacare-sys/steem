// src/lib/polyglot/strategies/portfolio.ts
//
// Strategy: PDF 1.7 Portfolio (/Collection).
//
// A PDF Portfolio (ISO 32000-1 §12.3.5, Acrobat 8+ extension) stores files
// in a /Collection dictionary that modern viewers (Adobe Acrobat, Foxit)
// display as a native portfolio UI — file grid with icons, names, and sizes.
// This is distinct from pdf-attachment (/Names /EmbeddedFiles): that embeds
// one nameless file in the attachment panel; portfolio embeds any number of
// named files with rich metadata in a full portfolio UI.
//
// In this strategy the original ZIP is embedded as a portfolio item alongside
// a brief README. Professional viewers show a "portfolio" screen on open.
// Extraction reads the portfolio's embedded file stream.

import { findBytes, fromHex, toHex, utf8 } from "../bytes";
import { readZipStructure } from "../zip-reader";
import {
  assemblePdf,
  buildCatalog,
  buildCoverPage,
  dictObject,
  pdfLiteral,
  streamObject,
} from "../pdf-writer";
import type { StrategyModule } from "../polyglot";

export const name = "portfolio" as const;
export const label = "PDF Portfolio — /Collection with native attachment UI (Acrobat 8+)";
export const isTrueByteLevelPolyglot = false;
export const isExtractable = true;

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

export function build(
  zipBuf: Uint8Array,
  origName: string,
  opts: { onLog?: (m: string) => void } = {}
): { bytes: Uint8Array; entryCount: number } {
  const onLog = opts.onLog ?? (() => {});
  const { entryCount } = readZipStructure(zipBuf);
  onLog(`portfolio: ${entryCount} entries, building PDF Portfolio`);

  const attachName = origName || "archive.zip";
  const readmeName = "README.txt";
  const readmeContent = utf8(
    `ZIP archive: ${attachName}\n` +
    `Entries: ${entryCount}\n` +
    `Strategy: portfolio (PDF 1.7 /Collection)\n` +
    `Extract with: zip2pdf extract --strategy portfolio file.pdf\n`
  );

  const { objects, pagesNum, nextNum } = buildCoverPage(4, [
    { text: "PDF Portfolio — " + attachName, size: 16 },
    { text: `${entryCount} file(s) embedded as a PDF Portfolio.` },
    { text: "Open in Adobe Acrobat or Foxit Reader to see the portfolio UI." },
    { text: "Or extract with: zip2pdf extract --strategy portfolio file.pdf" },
  ]);

  // Object numbering starting after cover page objects
  let n = nextNum;
  const readmeEFNum  = n++;  // EmbeddedFile stream for README
  const readmeFSNum  = n++;  // Filespec for README
  const zipEFNum     = n++;  // EmbeddedFile stream for the ZIP (hex-encoded)
  const zipFSNum     = n++;  // Filespec for the ZIP
  const collFieldNum = n++;  // /Collection /Fields schema
  const collNum      = n++;  // /Collection dict

  // README embedded file
  objects[readmeEFNum] = streamObject(
    readmeEFNum,
    `/Type /EmbeddedFile /Subtype /text#2Fplain /Params << /Size ${readmeContent.length} >>`,
    readmeContent
  );
  objects[readmeFSNum] = dictObject(
    readmeFSNum,
    `<< /Type /Filespec /F ${pdfLiteral(readmeName)} /UF ${pdfLiteral(readmeName)} ` +
    `/EF << /F ${readmeEFNum} 0 R /UF ${readmeEFNum} 0 R >> ` +
    `/Desc ${pdfLiteral("Portfolio README")} /CI << /N ${pdfLiteral(readmeName)} >> >>`
  );

  // ZIP embedded file (ASCIIHexDecode so stream body is safe bytes)
  const hexBytes = toHex(zipBuf);
  onLog(`hex-encoding ZIP: ${zipBuf.length} -> ${hexBytes.length} bytes`);
  objects[zipEFNum] = streamObject(
    zipEFNum,
    `/Type /EmbeddedFile /Subtype /application#2Fzip ` +
    `/Filter /ASCIIHexDecode /Params << /Size ${zipBuf.length} >>`,
    hexBytes
  );
  objects[zipFSNum] = dictObject(
    zipFSNum,
    `<< /Type /Filespec /F ${pdfLiteral(attachName)} /UF ${pdfLiteral(attachName)} ` +
    `/EF << /F ${zipEFNum} 0 R /UF ${zipEFNum} 0 R >> ` +
    `/Desc ${pdfLiteral(`Original archive (${entryCount} entries)`)} ` +
    `/CI << /N ${pdfLiteral(attachName)} >> >>`
  );

  // /Collection schema: defines sortable columns for the portfolio UI
  objects[collFieldNum] = dictObject(
    collFieldNum,
    `<< /Type /CollectionSchema ` +
    `/N << /Subtype /S /O 0 /V true /E false >> ` +
    `/D << /Subtype /D /O 1 /V false /E false >> >>`
  );

  // /Collection: initial view, sort, and schema reference
  objects[collNum] = dictObject(
    collNum,
    `<< /Type /Collection ` +
    `/Schema ${collFieldNum} 0 R ` +
    `/View /D ` +
    `/Sort << /S /N /A true >> >>`
  );

  // Catalog: /Collection, /PageMode /UseAttachments, /Names /EmbeddedFiles
  const catalogNum = 1;
  const catalogBody =
    `<< /Type /Catalog /Pages ${pagesNum} 0 R ` +
    `/Collection ${collNum} 0 R ` +
    `/PageMode /UseAttachments ` +
    `/Names << /EmbeddedFiles << /Names [` +
    `${pdfLiteral(readmeName)} ${readmeFSNum} 0 R ` +
    `${pdfLiteral(attachName)} ${zipFSNum} 0 R` +
    `] >> >> >>`;
  objects[catalogNum] = utf8(`${catalogNum} 0 obj\n${catalogBody}\nendobj\n`);

  const bytes = assemblePdf(objects, catalogNum);
  onLog(`assembled PDF Portfolio: ${bytes.length} bytes`);
  return { bytes, entryCount };
}

// ---------------------------------------------------------------------------
// Extract — find the ZIP's ASCIIHexDecode EmbeddedFile stream
// ---------------------------------------------------------------------------

const NEEDLE_ZIP_EF = utf8("/application#2Fzip");
const NEEDLE_STREAM = utf8("stream\n");
const NEEDLE_ENDSTREAM = utf8("\nendstream");

export function extract(
  buf: Uint8Array,
  opts: { onLog?: (m: string) => void } = {}
): { bytes: Uint8Array; entryCount: number } {
  const onLog = opts.onLog ?? (() => {});

  // Locate the ZIP embedded file stream by its MIME subtype marker.
  const typeOff = findBytes(buf, NEEDLE_ZIP_EF);
  if (typeOff < 0) {
    throw new Error("No /application#2Fzip EmbeddedFile found — not a portfolio file.");
  }
  const streamStart = findBytes(buf, NEEDLE_STREAM, typeOff);
  if (streamStart < 0) throw new Error("Found ZIP EmbeddedFile object but no stream keyword.");
  const dataStart = streamStart + NEEDLE_STREAM.length;
  const dataEnd = findBytes(buf, NEEDLE_ENDSTREAM, dataStart);
  if (dataEnd < 0) throw new Error("Found stream start but no matching endstream — malformed.");

  onLog(`located ZIP EmbeddedFile stream: ${dataEnd - dataStart} hex bytes`);
  const hexBody = buf.slice(dataStart, dataEnd);
  const zipBytes = fromHex(hexBody);
  onLog(`decoded ASCIIHexDecode: ${hexBody.length} -> ${zipBytes.length} bytes`);

  const { entryCount } = readZipStructure(zipBytes);
  onLog(`validated ZIP: ${entryCount} entries`);
  return { bytes: zipBytes, entryCount };
}

const _module: StrategyModule = {
  name, label, isTrueByteLevelPolyglot, isExtractable, build, extract,
};
export default _module;
