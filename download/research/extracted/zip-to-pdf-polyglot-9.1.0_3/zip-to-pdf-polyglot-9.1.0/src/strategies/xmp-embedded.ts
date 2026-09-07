// src/lib/polyglot/strategies/xmp-embedded.ts
//
// Strategy: embed the ZIP as base64 inside the PDF's XMP metadata stream
// (ISO 32000-1 §14.3, XMP spec §C.2 custom namespace).
//
// Key properties:
//  - ZIP survives PDF re-compression / re-save: XMP metadata is treated as
//    opaque XML by optimizer tools and is typically preserved verbatim.
//  - Pure UTF-8 XML output — no binary bytes outside the base64 value.
//    Safe for document management systems that scan byte content.
//  - NOT a true byte-level polyglot (ZIP is base64-wrapped in XML) but the
//    output IS a valid, standard PDF.
//  - Reversible: extraction locates the <polyglot:ZipData> element and
//    decodes the base64 value.

import { assemblePdf, buildCatalog, buildCoverPage, streamObject } from "../pdf-writer";
import { utf8 } from "../bytes";
import { readZipStructure } from "../zip-reader";
import type { StrategyModule } from "../polyglot";

export const name = "xmp-embedded" as const;
export const label = "XMP metadata — ZIP as base64 in XMP stream (survives PDF re-optimization)";
export const isTrueByteLevelPolyglot = false;
export const isExtractable = true;

// ---------------------------------------------------------------------------
// Base64 helpers (Node-free, browser-compatible)
// ---------------------------------------------------------------------------

function toBase64(bytes: Uint8Array): string {
  const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const len = bytes.length;
  let result = "";
  for (let i = 0; i < len; i += 3) {
    const b0 = bytes[i], b1 = bytes[i + 1] ?? 0, b2 = bytes[i + 2] ?? 0;
    result += CHARS[b0 >> 2];
    result += CHARS[((b0 & 3) << 4) | (b1 >> 4)];
    result += i + 1 < len ? CHARS[((b1 & 0xf) << 2) | (b2 >> 6)] : "=";
    result += i + 2 < len ? CHARS[b2 & 0x3f] : "=";
  }
  return result;
}

function fromBase64(s: string): Uint8Array {
  const TABLE: Record<string, number> = {};
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
    .split("").forEach((c, i) => (TABLE[c] = i));
  const clean = s.replace(/[^A-Za-z0-9+/=]/g, "");
  const len = (clean.length * 3) >> 2;
  const out = new Uint8Array(len);
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const a = TABLE[clean[i]] ?? 0, b = TABLE[clean[i + 1]] ?? 0;
    const c = TABLE[clean[i + 2]] ?? 0, d = TABLE[clean[i + 3]] ?? 0;
    out[o++] = (a << 2) | (b >> 4);
    if (clean[i + 2] !== "=") out[o++] = ((b & 0xf) << 4) | (c >> 2);
    if (clean[i + 3] !== "=") out[o++] = ((c & 3) << 6) | d;
  }
  return out.slice(0, o);
}

// ---------------------------------------------------------------------------
// XMP packet builder
// ---------------------------------------------------------------------------

function buildXmpPacket(zipBase64: string, origName: string, entryCount: number): string {
  const ts = new Date().toISOString();
  // Break base64 into 76-char lines (MIME convention) for XML readability.
  const wrapped = zipBase64.match(/.{1,76}/g)?.join("\n      ") ?? zipBase64;
  return `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about=""
        xmlns:polyglot="https://polyglot-pdf.dev/xmp/1.0/"
        xmlns:xmp="http://ns.adobe.com/xap/1.0/"
        xmlns:dc="http://purl.org/dc/elements/1.1/">
      <xmp:CreateDate>${ts}</xmp:CreateDate>
      <xmp:Creator>zip-to-pdf-polyglot v7</xmp:Creator>
      <dc:format>application/pdf</dc:format>
      <dc:title>
        <rdf:Alt><rdf:li xml:lang="x-default">${origName} (polyglot PDF)</rdf:li></rdf:Alt>
      </dc:title>
      <polyglot:Strategy>xmp-embedded</polyglot:Strategy>
      <polyglot:OriginalName>${origName}</polyglot:OriginalName>
      <polyglot:EntryCount>${entryCount}</polyglot:EntryCount>
      <polyglot:ZipSize></polyglot:ZipSize>
      <polyglot:ZipData>
      ${wrapped}
      </polyglot:ZipData>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

export function build(
  zipBuf: Uint8Array,
  origName: string,
  opts: { onLog?: (m: string) => void } = {}
): { bytes: Uint8Array; entryCount: number; xmpSize: number } {
  const onLog = opts.onLog ?? (() => {});
  const { entryCount } = readZipStructure(zipBuf);
  onLog(`xmp-embedded: ${entryCount} entries, encoding ${zipBuf.length} bytes as base64`);

  const b64 = toBase64(zipBuf);
  onLog(`base64 length: ${b64.length} chars`);

  const xmpStr = buildXmpPacket(b64, origName, entryCount);
  const xmpBytes = utf8(xmpStr);
  onLog(`XMP packet: ${xmpBytes.length} bytes`);

  const { objects, pagesNum, nextNum } = buildCoverPage(4, [
    { text: "This PDF carries a ZIP via XMP metadata.", size: 16 },
    { text: "Extract with: zip2pdf extract --strategy xmp-embedded file.pdf" },
    { text: `Archive: ${origName}  (${entryCount} entries)` },
    { text: "The ZIP is base64-encoded in the /Metadata XMP stream." },
  ]);

  // XMP metadata stream: use /Type /Metadata /Subtype /XML (ISO 32000 §14.3.2).
  // No filter — XMP must be raw UTF-8 so any processor can find it.
  const metaNum = nextNum;
  objects[metaNum] = streamObject(
    metaNum,
    `/Type /Metadata /Subtype /XML`,
    xmpBytes
  );

  const catalogNum = 1;
  objects[catalogNum] = (() => {
    const body = `<< /Type /Catalog /Pages ${pagesNum} 0 R /Metadata ${metaNum} 0 R >>`;
    const { utf8: u } = { utf8: (s: string) => new TextEncoder().encode(s) };
    return new TextEncoder().encode(`${catalogNum} 0 obj\n${body}\nendobj\n`);
  })();

  const bytes = assemblePdf(objects, catalogNum);
  onLog("assembled PDF with XMP metadata stream");
  return { bytes, entryCount, xmpSize: xmpBytes.length };
}

// ---------------------------------------------------------------------------
// Extract
// ---------------------------------------------------------------------------

const OPEN_TAG  = "<polyglot:ZipData>";
const CLOSE_TAG = "</polyglot:ZipData>";

export function extract(
  buf: Uint8Array,
  opts: { onLog?: (m: string) => void } = {}
): { bytes: Uint8Array; entryCount: number } {
  const onLog = opts.onLog ?? (() => {});

  // Find the XMP metadata stream via its well-known marker.
  const pdfStr = new TextDecoder("latin1").decode(buf);
  const openIdx = pdfStr.indexOf(OPEN_TAG);
  if (openIdx < 0) throw new Error("No <polyglot:ZipData> element found — not an xmp-embedded file.");
  const dataStart = openIdx + OPEN_TAG.length;
  const closeIdx = pdfStr.indexOf(CLOSE_TAG, dataStart);
  if (closeIdx < 0) throw new Error("Found <polyglot:ZipData> open tag but no closing tag — malformed XMP.");

  const b64Raw = pdfStr.slice(dataStart, closeIdx).trim();
  onLog(`located ZipData: ${b64Raw.length} base64 chars`);

  const zipBytes = fromBase64(b64Raw);
  onLog(`decoded to ${zipBytes.length} bytes`);

  const { entryCount } = readZipStructure(zipBytes);
  onLog(`validated ZIP: ${entryCount} entries`);
  return { bytes: zipBytes, entryCount };
}

const _module: StrategyModule = { name, label, isTrueByteLevelPolyglot, isExtractable, build, extract };
export default _module;
