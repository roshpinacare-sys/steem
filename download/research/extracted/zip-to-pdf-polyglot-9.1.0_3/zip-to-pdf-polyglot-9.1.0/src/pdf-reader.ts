// src/lib/polyglot/pdf-reader.ts
//
// A purpose-built, minimal PDF reader. It only needs to understand the exact
// layout our writer produces: indirect objects (`N 0 obj ... endobj`), stream
// bodies (`<< ... >>\nstream\n<bytes>\nendstream`), FlateDecode, and the
// `/Polyglot` extension dict on the Catalog. It is NOT a general PDF parser —
// it will refuse rather than guess on anything else, which is the right
// safety posture for an agent-driven round trip.

import { concatBytes, findBytes, fromHex, fromUtf8, unescapePdfLiteral, utf8 } from "./bytes";
import { flateInflate, brotliInflate } from "./flate";

const RE_STREAM_START = utf8("stream\n");
const RE_STREAM_END = utf8("\nendstream");
const RE_ENDOBJ = utf8("\nendobj");

/** Find the body bytes of object `num` (between `N 0 obj\n` and `\nendobj`). */
export function findObjectBody(buf: Uint8Array, num: number): Uint8Array {
  const header = utf8(num + " 0 obj\n");
  const start = findBytes(buf, header);
  if (start < 0) throw new Error(`pdf-reader: object ${num} not found`);
  const bodyStart = start + header.length;
  const end = findBytes(buf, RE_ENDOBJ, bodyStart);
  if (end < 0) throw new Error(`pdf-reader: object ${num} has no endobj`);
  return buf.slice(bodyStart, end);
}

/** Quick scan: does the buffer start with %PDF? */
export function hasPdfMagic(buf: Uint8Array): boolean {
  return (
    buf.length >= 4 &&
    buf[0] === 0x25 &&
    buf[1] === 0x50 &&
    buf[2] === 0x44 &&
    buf[3] === 0x46
  );
}

interface ParsedStream {
  dictStr: string;
  raw: Uint8Array;
}

/** Parse an object body into its dict string and raw stream bytes (if any). */
function parseObjectBody(body: Uint8Array): ParsedStream {
  // body looks like: << ...dict... >>\nstream\n<bytes>\nendstream
  const dictEnd = findBytes(body, utf8(">>"));
  if (dictEnd < 0) throw new Error("pdf-reader: no dict >> in object body");
  const dictStr = fromUtf8(body.slice(0, dictEnd + 2));
  const sStart = findBytes(body, RE_STREAM_START, dictEnd);
  if (sStart < 0) {
    return { dictStr, raw: new Uint8Array(0) };
  }
  const dataStart = sStart + RE_STREAM_START.length;
  // Use /Length if present and trustworthy; otherwise scan for endstream.
  const lenMatch = /\/Length\s+(\d+)/.exec(dictStr);
  let dataEnd: number;
  if (lenMatch) {
    const len = parseInt(lenMatch[1], 10);
    dataEnd = dataStart + len;
    // sanity: the bytes after should be \nendstream
    if (
      dataEnd > body.length ||
      findBytes(body, RE_STREAM_END, dataEnd) !== dataEnd
    ) {
      // fall back to scanning
      dataEnd = findBytes(body, RE_STREAM_END, dataStart);
      if (dataEnd < 0) throw new Error("pdf-reader: stream has no endstream");
    }
  } else {
    dataEnd = findBytes(body, RE_STREAM_END, dataStart);
    if (dataEnd < 0) throw new Error("pdf-reader: stream has no endstream");
  }
  return { dictStr, raw: body.slice(dataStart, dataEnd) };
}

/** Read an object's stream, applying FlateDecode / Brotli / ASCIIHexDecode as declared. */
export function readObjectStream(buf: Uint8Array, num: number): Uint8Array {
  const body = findObjectBody(buf, num);
  const { dictStr, raw } = parseObjectBody(body);
  // v2.2: Brotli-compressed streams use a custom /Brotli true dict key (no
  // standard /Filter, since PDF doesn't define /BrotliDecode). qpdf sees a
  // valid raw stream; our reader checks the marker.
  if (/\/Brotli\s+true/.test(dictStr)) {
    return brotliInflate(raw);
  }
  if (/\/Filter\s*\/FlateDecode/.test(dictStr)) {
    return flateInflate(raw);
  }
  if (/\/Filter\s*\/ASCIIHexDecode/.test(dictStr)) {
    return fromHex(raw);
  }
  return raw;
}

/** True if object `num` exists in the buffer. */
export function hasObject(buf: Uint8Array, num: number): boolean {
  const header = utf8(num + " 0 obj\n");
  return findBytes(buf, header) >= 0;
}

/**
 * Scan the Catalog (object 1) for `/Polyglot << /Manifest N 0 R /BinaryStore M 0 R >>`
 * and return the referenced object numbers, or null if absent.
 */
export function findPolyglotRefs(buf: Uint8Array): {
  manifest: number;
  binaryStore: number;
} | null {
  const body = findObjectBody(buf, 1);
  const dictStr = fromUtf8(body);
  const m = /\/Polyglot\s*<<([^>]*)>>/.exec(dictStr);
  if (!m) return null;
  const inner = m[1];
  const manifestMatch = /\/Manifest\s+(\d+)\s+0\s+R/.exec(inner);
  const binaryMatch = /\/BinaryStore\s+(\d+)\s+0\s+R/.exec(inner);
  if (!manifestMatch || !binaryMatch) return null;
  return {
    manifest: parseInt(manifestMatch[1], 10),
    binaryStore: parseInt(binaryMatch[1], 10),
  };
}

/**
 * Parse a content stream (already inflated) and return every string operand
 * shown via `Tj`/`TJ`, in order. Handles both PDF literal strings `(...)` and
 * hex strings `<...>`. For literal strings, returns the un-escaped raw bytes.
 * For hex strings, parses 2-byte CIDs (Identity-H), interprets them as Unicode
 * code units, and returns their UTF-8 encoding. v2.2: if `astralMap` is
 * provided, CIDs in the map are decoded to their astral codepoint (via
 * `String.fromCodePoint`) instead of being treated as BMP codepoints.
 */
export function extractTjLines(
  content: Uint8Array,
  astralMap: Record<number, number> = {}
): Uint8Array[] {
  const lines: Uint8Array[] = [];
  let i = 0;
  const n = content.length;
  const HEX = "0123456789ABCDEFabcdef";
  const hexVal: Record<string, number> = {};
  for (const c of HEX) hexVal[c] = parseInt(c, 16);
  const te = new TextEncoder();

  const isWs = (b: number) => b === 0x20 || b === 0x09 || b === 0x0a || b === 0x0d;
  const isTjAfter = (j: number) =>
    (content[j] === 0x54 && content[j + 1] === 0x6a) || // Tj
    (content[j] === 0x54 && content[j + 1] === 0x4a); // TJ

  while (i < n) {
    const b = content[i];
    if (b === 0x28) {
      // literal string (...)
      const { bytes, next } = unescapePdfLiteral(content, i + 1);
      let j = next;
      while (j < n && isWs(content[j])) j++;
      if (isTjAfter(j)) lines.push(bytes);
      i = next;
    } else if (b === 0x3c) {
      // hex string <...>
      let j = i + 1;
      const digits: number[] = [];
      while (j < n && content[j] !== 0x3e) {
        const ch = String.fromCharCode(content[j]);
        if (ch in hexVal) digits.push(hexVal[ch]);
        j++;
      }
      const next = j < n ? j + 1 : j;
      if (digits.length % 2 === 1) digits.push(0);
      // CIDs are 2-byte (4 hex digits) under Identity-H.
      const cids: number[] = [];
      for (let k = 0; k + 3 < digits.length; k += 4) {
        cids.push(
          (digits[k] << 12) | (digits[k + 1] << 8) | (digits[k + 2] << 4) | digits[k + 3]
        );
      }
      // v2.2: reverse CIDs → string. BMP CIDs (not in astralMap) → codepoint
      // = CID via fromCharCode. Astral CIDs (in astralMap) → codepoint via
      // fromCodePoint (handles surrogate pairs correctly).
      let str = "";
      for (const cid of cids) {
        const cp = astralMap[cid];
        if (cp !== undefined) {
          str += String.fromCodePoint(cp);
        } else {
          str += String.fromCharCode(cid);
        }
      }
      const bytes = te.encode(str);
      let m = next;
      while (m < n && isWs(content[m])) m++;
      if (isTjAfter(m)) lines.push(bytes);
      i = next;
    } else {
      i++;
    }
  }
  return lines;
}

/** Read /Pages kids to enumerate page object numbers (best-effort scan). */
export function findPageContentsRefs(buf: Uint8Array): number[] {
  // Object 2 is /Pages in our writer. Read its /Kids [n 0 R m 0 R ...].
  const body = findObjectBody(buf, 2);
  const dictStr = fromUtf8(body);
  const kidsMatch = /\/Kids\s*\[([^\]]*)\]/.exec(dictStr);
  if (!kidsMatch) return [];
  const refs: number[] = [];
  const re = /(\d+)\s+0\s+R/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(kidsMatch[1]))) {
    refs.push(parseInt(m[1], 10));
  }
  return refs;
}

/** For a page object, return its /Contents object number (if single ref). */
export function pageContentsRef(buf: Uint8Array, pageObjNum: number): number | null {
  const body = findObjectBody(buf, pageObjNum);
  const dictStr = fromUtf8(body);
  const m = /\/Contents\s+(\d+)\s+0\s+R/.exec(dictStr);
  return m ? parseInt(m[1], 10) : null;
}

export { concatBytes };
