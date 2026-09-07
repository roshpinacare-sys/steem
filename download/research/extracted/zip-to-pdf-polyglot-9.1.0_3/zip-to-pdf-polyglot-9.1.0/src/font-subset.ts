// src/lib/polyglot/font-subset.ts
//
// v2.4: TTF font embedding for the agent-readable text layer.
//
// BACKGROUND
// ----------
// The v2.0–v2.3 Type0 font is GLYPHLESS: the CIDFontType2 has no /FontFile2,
// so PDF viewers fall back to rendering `.notdef` (a blank or box) for every
// glyph. Text EXTRACTION still works because the ToUnicode CMap (independent
// of the glyph table) maps each CID to its Unicode codepoint — but the PDF
// LOOKS empty to a human reader. v2.4 fixes this by embedding a REAL TTF
// (FontFile2) so glyphs render visibly, while leaving the ToUnicode CMap
// alone so text extraction keeps working.
//
// APPROACH: SUBSET (compact GIDs) + CIDToGIDMap stream
// ----------------------------------------------------
// The task spec suggested `/CIDToGIDMap /Identity` (CID = GID). That would
// require the embedded TTF to have GID = codepoint for BMP / GID = surrogate
// slot for astral — i.e. glyphs scattered across a 65536-entry GID space,
// which bloats `loca`/`hmtx` (mostly empty) and is barely smaller than the
// full font. Instead we use the standard PDF subsetting pattern:
//
//   1. Subset the TTF to ONLY the glyphs actually used (BMP codepoints from
//      the text layer + astral codepoints via the surrogate-slot map).
//      Renumber them to COMPACT GIDs 0..N-1 (`.notdef` stays at GID 0).
//   2. Build a /CIDToGIDMap STREAM: a 65536-entry big-endian Uint16 table
//      indexed by CID, where each entry gives the new GID for that CID.
//      The table is sparse (only the codepoints actually used are non-zero),
//      so it FlateDecode-compresses to a few KB.
//   3. Reference the CIDToGIDMap stream from the CIDFont dict (instead of
//      `/CIDToGIDMap /Identity`). The PDF viewer maps CID → new GID, then
//      looks up the glyph at that GID in the subset glyf table.
//
// This is the same pattern FontTools, HarfBuzz, and most PDF subsetting
// libraries use. It produces the smallest embed (~50–150 KB compressed for
// typical codebases, vs. ~340 KB for the full DejaVu Sans).
//
// FALLBACK
// --------
// If subsetting fails for any reason (parse error, unexpected table layout,
// composite-glyph edge case), `prepareEmbeddedFont` falls back to embedding
// the FULL TTF + a CIDToGIDMap built from the full cmap. A working full-TTF
// embed beats a broken subsetter (per the task spec).
//
// BASE FONT
// ---------
// DejaVu Sans (public domain) at `fonts/base.ttf`. Covers Latin, Latin
// Extended, Greek, Cyrillic, Hebrew, Arabic, IPA, punctuation, box drawing,
// and more — but NOT CJK or emoji. For codepoints the base font doesn't
// cover, the subsetter still allocates a CID slot but the GID will be 0
// (.notdef), so the viewer renders a box for that one character. Text
// extraction is unaffected (the ToUnicode CMap is independent).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { concatBytes } from "./bytes";

// ---------------------------------------------------------------------------
// Big-endian readers/writers (TTF is big-endian; the bytes.ts helpers are
// little-endian for ZIP/PDF use).
// ---------------------------------------------------------------------------

function beU16(buf: Uint8Array, off: number): number {
  return (buf[off] << 8) | buf[off + 1];
}
function beU32(buf: Uint8Array, off: number): number {
  return ((buf[off] << 24) | (buf[off + 1] << 16) | (buf[off + 2] << 8) | buf[off + 3]) >>> 0;
}
function beI16(buf: Uint8Array, off: number): number {
  const v = (buf[off] << 8) | buf[off + 1];
  return v >= 0x8000 ? v - 0x10000 : v;
}
function writeBeU16(buf: Uint8Array, off: number, v: number): void {
  buf[off] = (v >>> 8) & 0xff;
  buf[off + 1] = v & 0xff;
}
function writeBeU32(buf: Uint8Array, off: number, v: number): void {
  buf[off] = (v >>> 24) & 0xff;
  buf[off + 1] = (v >>> 16) & 0xff;
  buf[off + 2] = (v >>> 8) & 0xff;
  buf[off + 3] = v & 0xff;
}
function tagStr(buf: Uint8Array, off: number): string {
  return String.fromCharCode(buf[off], buf[off + 1], buf[off + 2], buf[off + 3]);
}

// ---------------------------------------------------------------------------
// TTF parsing
// ---------------------------------------------------------------------------

interface TtfTable {
  tag: string;
  offset: number;
  length: number;
  data: Uint8Array;
}

export interface ParsedTtf {
  sfntVersion: number;
  tables: Map<string, TtfTable>;
  // head
  unitsPerEm: number;
  indexToLocFormat: number; // 0=short, 1=long
  xMin: number; yMin: number; xMax: number; yMax: number;
  // maxp
  numGlyphs: number;
  // hhea
  numOfHMetrics: number;
  ascent: number; descent: number;
  // loca (offsets into glyf)
  loca: number[];
  // cmap: codepoint → GID
  codepointToGid: Map<number, number>;
  // raw table data
  glyfData: Uint8Array;
  hmtxData: Uint8Array;
  headData: Uint8Array;
}

/** Parse the sfnt header + table directory + the tables we care about. */
export function parseTtf(bytes: Uint8Array): ParsedTtf {
  if (bytes.length < 12) throw new Error("TTF too short (header)");
  const sfntVersion = beU32(bytes, 0);
  // Accept standard TrueType (0x00010000) and OpenType (0x4F54544F = 'OTTO').
  // We only handle TrueType glyf/loca, so reject OTTO (CFF) for now.
  if (sfntVersion !== 0x00010000) {
    throw new Error(`Unsupported sfnt version 0x${sfntVersion.toString(16)} (only 0x00010000 TrueType)`);
  }
  const numTables = beU16(bytes, 4);

  const tables = new Map<string, TtfTable>();
  let off = 12;
  for (let i = 0; i < numTables; i++) {
    if (off + 16 > bytes.length) throw new Error("TTF table directory truncated");
    const t = tagStr(bytes, off);
    const offset = beU32(bytes, off + 8);
    const length = beU32(bytes, off + 12);
    tables.set(t, { tag: t, offset, length, data: bytes.subarray(offset, offset + length) });
    off += 16;
  }

  const head = tables.get("head");
  if (!head) throw new Error("TTF missing 'head' table");
  const headData = head.data;
  const unitsPerEm = beU16(headData, 18);
  const xMin = beI16(headData, 36);
  const yMin = beI16(headData, 38);
  const xMax = beI16(headData, 40);
  const yMax = beI16(headData, 42);
  const indexToLocFormat = beI16(headData, 50);

  const maxp = tables.get("maxp");
  if (!maxp) throw new Error("TTF missing 'maxp' table");
  const numGlyphs = beU16(maxp.data, 4);

  const hhea = tables.get("hhea");
  if (!hhea) throw new Error("TTF missing 'hhea' table");
  const ascent = beI16(hhea.data, 4);
  const descent = beI16(hhea.data, 6);
  const numOfHMetrics = beU16(hhea.data, 34);

  const glyf = tables.get("glyf");
  if (!glyf) throw new Error("TTF missing 'glyf' table");
  const locaTab = tables.get("loca");
  if (!locaTab) throw new Error("TTF missing 'loca' table");

  // Parse loca: numGlyphs+1 entries.
  const loca: number[] = new Array(numGlyphs + 1);
  if (indexToLocFormat === 0) {
    // short: each entry is offset/2
    for (let i = 0; i <= numGlyphs; i++) {
      loca[i] = beU16(locaTab.data, i * 2) * 2;
    }
  } else {
    // long: each entry is the actual offset
    for (let i = 0; i <= numGlyphs; i++) {
      loca[i] = beU32(locaTab.data, i * 4);
    }
  }

  const hmtx = tables.get("hmtx");
  if (!hmtx) throw new Error("TTF missing 'hmtx' table");

  const cmap = tables.get("cmap");
  if (!cmap) throw new Error("TTF missing 'cmap' table");
  const codepointToGid = parseCmap(cmap.data);

  return {
    sfntVersion,
    tables,
    unitsPerEm,
    indexToLocFormat,
    xMin, yMin, xMax, yMax,
    numGlyphs,
    numOfHMetrics,
    ascent, descent,
    loca,
    codepointToGid,
    glyfData: glyf.data,
    hmtxData: hmtx.data,
    headData,
  };
}

/** Parse the cmap table, merging all format-4 and format-12 subtables. */
function parseCmap(cmapData: Uint8Array): Map<number, number> {
  const map = new Map<number, number>();
  if (cmapData.length < 4) return map;
  const numSubtables = beU16(cmapData, 2);
  for (let i = 0; i < numSubtables; i++) {
    const recOff = 4 + i * 8;
    if (recOff + 8 > cmapData.length) break;
    const platformID = beU16(cmapData, recOff);
    const encodingID = beU16(cmapData, recOff + 2);
    const subOff = beU32(cmapData, recOff + 4);
    if (subOff + 2 > cmapData.length) continue;
    const format = beU16(cmapData, subOff);
    // We only care about format 4 (BMP) and format 12 (full Unicode).
    // Prefer platform 3 (Windows) / platform 0 (Unicode). Skip platform 1 (Mac).
    if (platformID === 1) continue;
    if (format === 4) {
      parseCmapFormat4(cmapData, subOff, map);
    } else if (format === 12) {
      parseCmapFormat12(cmapData, subOff, map);
    }
    // Other formats (0, 2, 6, 13, 14) — skip for simplicity; DejaVu has 4 + 12.
  }
  return map;
}

function parseCmapFormat4(data: Uint8Array, off: number, map: Map<number, number>): void {
  // format(2) length(2) language(2) segCountX2(2) searchRange(2) entrySelector(2) rangeShift(2)
  if (off + 14 > data.length) return;
  const segCountX2 = beU16(data, off + 6);
  const segCount = segCountX2 >>> 1;
  const endCodeOff = off + 14;
  const startCodeOff = endCodeOff + segCountX2 + 2; // +2 for reservedPad
  const idDeltaOff = startCodeOff + segCountX2;
  const idRangeOffsetOff = idDeltaOff + segCountX2;
  const glyphIdArrayOff = idRangeOffsetOff + segCountX2;
  for (let i = 0; i < segCount; i++) {
    const endCode = beU16(data, endCodeOff + i * 2);
    const startCode = beU16(data, startCodeOff + i * 2);
    const idDelta = beI16(data, idDeltaOff + i * 2);
    const idRangeOffset = beU16(data, idRangeOffsetOff + i * 2);
    for (let c = startCode; c <= endCode; c++) {
      let gid: number;
      if (idRangeOffset === 0) {
        gid = (c + idDelta) & 0xffff;
      } else {
        // gidIndex = idRangeOffset/2 + (c - startCode) + (segCount - i - 1)? No.
        // Per spec: glyphIDAddress = idRangeOffset[i] + 2*(c - startCode) + addressof(idRangeOffset[i])
        // The addressof(idRangeOffset[i]) = idRangeOffsetOff + i*2.
        const ptr = idRangeOffsetOff + i * 2 + idRangeOffset + (c - startCode) * 2;
        if (ptr + 2 > data.length) continue;
        const raw = beU16(data, ptr);
        if (raw === 0) {
          gid = 0; // missing glyph
        } else {
          gid = (raw + idDelta) & 0xffff;
        }
      }
      if (gid !== 0 && !map.has(c)) {
        map.set(c, gid);
      }
    }
  }
}

function parseCmapFormat12(data: Uint8Array, off: number, map: Map<number, number>): void {
  // format(2) reserved(2) length(4) language(4) numGroups(4)
  if (off + 16 > data.length) return;
  const numGroups = beU32(data, off + 12);
  let gOff = off + 16;
  for (let i = 0; i < numGroups; i++) {
    if (gOff + 12 > data.length) break;
    const startCharCode = beU32(data, gOff);
    const endCharCode = beU32(data, gOff + 4);
    const startGlyphID = beU32(data, gOff + 8);
    for (let c = startCharCode; c <= endCharCode; c++) {
      const gid = startGlyphID + (c - startCharCode);
      if (gid !== 0 && !map.has(c)) {
        map.set(c, gid);
      }
    }
    gOff += 12;
  }
}

// ---------------------------------------------------------------------------
// Metrics extraction (for the FontDescriptor)
// ---------------------------------------------------------------------------

export interface TtfMetrics {
  fontName: string;        // PostScript name (nameID 6)
  fontFamily: string;      // Family name (nameID 1)
  flags: number;           // PDF font flags (32 = Nonsymbolic)
  fontBBox: [number, number, number, number]; // in PDF units (1000 units/em)
  italicAngle: number;     // degrees
  ascent: number;          // PDF units
  descent: number;         // PDF units (negative)
  capHeight: number;       // PDF units
  stemV: number;           // PDF units (no TTF field; default 80)
}

/** Extract FontDescriptor metrics from the parsed TTF. */
export function parseTtfMetrics(parsed: ParsedTtf): TtfMetrics {
  const scale = 1000 / parsed.unitsPerEm;

  // Read PostScript name + family from the name table.
  let fontName = "SubsetFont";
  let fontFamily = "Subset Font";
  const nameTab = parsed.tables.get("name");
  if (nameTab) {
    const data = nameTab.data;
    if (data.length >= 6) {
      const count = beU16(data, 2);
      const stringOffset = beU16(data, 4);
      let off = 6;
      for (let i = 0; i < count; i++) {
        if (off + 12 > data.length) break;
        const platformID = beU16(data, off);
        const encodingID = beU16(data, off + 2);
        const nameID = beU16(data, off + 6);
        const length = beU16(data, off + 8);
        const soff = beU16(data, off + 10);
        off += 12;
        // Prefer Windows (platform 3) names; fall back to Mac (platform 1).
        if (nameID === 6 && (platformID === 3 || (fontName === "SubsetFont" && platformID === 1))) {
          const sdata = data.subarray(stringOffset + soff, stringOffset + soff + length);
          try {
            fontName = platformID === 3 ? decodeUtf16Be(sdata) : decodeMacRoman(sdata);
          } catch { /* keep default */ }
        } else if (nameID === 1 && (platformID === 3 || (fontFamily === "Subset Font" && platformID === 1))) {
          const sdata = data.subarray(stringOffset + soff, stringOffset + soff + length);
          try {
            fontFamily = platformID === 3 ? decodeUtf16Be(sdata) : decodeMacRoman(sdata);
          } catch { /* keep default */ }
        }
      }
    }
  }

  // ItalicAngle from post table (Fixed 16.16, signed).
  let italicAngle = 0;
  const postTab = parsed.tables.get("post");
  if (postTab && postTab.data.length >= 8) {
    italicAngle = beI16(postTab.data, 4) + beU16(postTab.data, 6) / 65536;
  }

  // CapHeight from OS/2 (sCapHeight). Fall back to 0.7 * ascent.
  let capHeight = 0;
  const os2Tab = parsed.tables.get("OS/2");
  if (os2Tab && os2Tab.data.length >= 90) {
    capHeight = beI16(os2Tab.data, 88);
  }

  // Ascent/Descent: prefer OS/2 sTypoAscender/Descender, fall back to hhea.
  let ascent = parsed.ascent;
  let descent = parsed.descent;
  if (os2Tab && os2Tab.data.length >= 72) {
    const typoAsc = beI16(os2Tab.data, 68);
    const typoDesc = beI16(os2Tab.data, 70);
    if (typoAsc !== 0 || typoDesc !== 0) {
      ascent = typoAsc;
      descent = typoDesc;
    }
  }

  // Scale all metrics to PDF units (1000 units/em).
  const ascentPdf = Math.round(ascent * scale);
  const descentPdf = Math.round(descent * scale);
  let capHeightPdf = Math.round(capHeight * scale);
  if (capHeightPdf === 0) {
    // Fallback: 70% of ascent (reasonable for most sans-serif fonts).
    capHeightPdf = Math.round(ascentPdf * 0.7);
  }

  const fontBBox: [number, number, number, number] = [
    Math.round(parsed.xMin * scale),
    Math.round(parsed.yMin * scale),
    Math.round(parsed.xMax * scale),
    Math.round(parsed.yMax * scale),
  ];

  return {
    fontName: sanitizeFontName(fontName),
    fontFamily,
    flags: 32, // Nonsymbolic (Unicode font)
    fontBBox,
    italicAngle,
    ascent: ascentPdf,
    descent: descentPdf,
    capHeight: capHeightPdf,
    stemV: 80, // TTF has no StemV; standard default
  };
}

function decodeUtf16Be(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i + 1 < b.length; i += 2) {
    s += String.fromCharCode((b[i] << 8) | b[i + 1]);
  }
  return s;
}
function decodeMacRoman(b: Uint8Array): string {
  // For ASCII range, this is identity. For non-ASCII MacRoman, approximate.
  let s = "";
  for (let i = 0; i < b.length; i++) {
    s += String.fromCharCode(b[i] <= 0x7f ? b[i] : 0x3f);
  }
  return s;
}
function sanitizeFontName(s: string): string {
  // PostScript font names must be ASCII, no spaces, no special chars.
  return s.replace(/[^A-Za-z0-9]/g, "");
}

// ---------------------------------------------------------------------------
// Glyph utilities (composite-glyph handling)
// ---------------------------------------------------------------------------

/** Read the numberOfContours field of a glyph. Returns -1 if empty glyph. */
function glyphNumContours(glyphData: Uint8Array): number {
  if (glyphData.length < 10) return -1;
  return beI16(glyphData, 0);
}

/** If the glyph is composite, return the GIDs of its components. */
function compositeComponentGids(glyphData: Uint8Array): number[] {
  const gids: number[] = [];
  if (glyphNumContours(glyphData) >= 0) return gids;
  let off = 10; // skip header
  while (true) {
    if (off + 4 > glyphData.length) break;
    const flags = beU16(glyphData, off);
    const gid = beU16(glyphData, off + 2);
    gids.push(gid);
    // Skip args
    let size = 4;
    if (flags & 0x0001) {
      // ARG_1_AND_2_ARE_WORDS: 4 bytes
      size += 4;
    } else {
      // 2 bytes
      size += 2;
    }
    // Skip scale
    if (flags & 0x0008) {
      // WE_HAVE_A_SCALE: 2 bytes
      size += 2;
    } else if (flags & 0x0040) {
      // WE_HAVE_AN_X_AND_Y_SCALE: 4 bytes
      size += 4;
    } else if (flags & 0x0080) {
      // WE_HAVE_A_TWO_BY_TWO: 8 bytes
      size += 8;
    }
    off += size;
    if ((flags & 0x0020) === 0) break; // MORE_COMPONENTS
  }
  return gids;
}

/** Patch a composite glyph's component GIDs (old → new). Returns a new byte array. */
function patchCompositeGlyph(glyphData: Uint8Array, oldToNew: Map<number, number>): Uint8Array {
  if (glyphNumContours(glyphData) >= 0) return glyphData;
  const out = new Uint8Array(glyphData);
  let off = 10;
  while (true) {
    if (off + 4 > out.length) break;
    const flags = beU16(out, off);
    const oldGid = beU16(out, off + 2);
    const newGid = oldToNew.get(oldGid);
    if (newGid !== undefined) {
      writeBeU16(out, off + 2, newGid);
    }
    let size = 4;
    if (flags & 0x0001) size += 4; else size += 2;
    if (flags & 0x0008) size += 2;
    else if (flags & 0x0040) size += 4;
    else if (flags & 0x0080) size += 8;
    off += size;
    if ((flags & 0x0020) === 0) break;
  }
  return out;
}

/** Get the raw glyph bytes for a GID (returns a 0-length array for empty glyphs). */
function getGlyphData(parsed: ParsedTtf, gid: number): Uint8Array {
  if (gid < 0 || gid >= parsed.numGlyphs) return new Uint8Array(0);
  const start = parsed.loca[gid];
  const end = parsed.loca[gid + 1];
  if (start >= end) return new Uint8Array(0);
  return parsed.glyfData.subarray(start, end);
}

/** Get the advanceWidth + lsb for a GID from the hmtx table. */
function getGlyphMetrics(parsed: ParsedTtf, gid: number): { advanceWidth: number; lsb: number } {
  const data = parsed.hmtxData;
  if (gid < parsed.numOfHMetrics) {
    const off = gid * 4;
    if (off + 4 > data.length) return { advanceWidth: 0, lsb: 0 };
    return { advanceWidth: beU16(data, off), lsb: beI16(data, off + 2) };
  }
  // lsb-only entry: advanceWidth = last longHorMetric's advanceWidth
  const lastLongOff = (parsed.numOfHMetrics - 1) * 4;
  if (lastLongOff + 4 > data.length) return { advanceWidth: 0, lsb: 0 };
  const advanceWidth = beU16(data, lastLongOff);
  const lsbOff = parsed.numOfHMetrics * 4 + (gid - parsed.numOfHMetrics) * 2;
  if (lsbOff + 2 > data.length) return { advanceWidth, lsb: 0 };
  return { advanceWidth, lsb: beI16(data, lsbOff) };
}

// ---------------------------------------------------------------------------
// Subsetting
// ---------------------------------------------------------------------------

export interface SubsetResult {
  bytes: Uint8Array;       // subsetted TTF bytes
  cidToGid: Uint16Array;   // 65536-entry big-endian-ready table (CID → new GID)
}

/**
 * Subset the TTF to ONLY the glyphs for the requested codepoints (BMP +
 * astral). Renumber glyphs to compact GIDs 0..N-1. Returns the subset TTF
 * bytes + a 65536-entry Uint16Array mapping CID → new GID (big-endian ready).
 *
 * @param parsed      ParsedTtf from parseTtf()
 * @param codepoints  All Unicode codepoints used in the text layer (BMP + astral, deduped)
 * @param astralMap   CID (surrogate slot 0xD800-0xDFFF) → astral codepoint
 */
export function subsetTtf(
  parsed: ParsedTtf,
  codepoints: number[],
  astralMap: Record<number, number> = {}
): SubsetResult {
  // 1. Determine the set of needed GIDs (in the ORIGINAL font's GID space).
  const neededGids = new Set<number>();
  neededGids.add(0); // .notdef always kept (at GID 0)
  for (const cp of codepoints) {
    const gid = parsed.codepointToGid.get(cp);
    if (gid !== undefined && gid !== 0) {
      neededGids.add(gid);
    }
  }
  // Also include astral codepoints (mapped via surrogate slots).
  for (const cid in astralMap) {
    const cp = astralMap[cid];
    const gid = parsed.codepointToGid.get(cp);
    if (gid !== undefined && gid !== 0) {
      neededGids.add(gid);
    }
  }

  // 2. Walk composite glyphs to find component GIDs (recursive, fixpoint).
  //    DejaVu Sans has composites for accented Latin (é, ü, etc.) — we must
  //    keep the base glyphs too or the composite won't render.
  let added = true;
  while (added) {
    added = false;
    for (const gid of neededGids) {
      const gd = getGlyphData(parsed, gid);
      if (glyphNumContours(gd) < 0) {
        for (const compGid of compositeComponentGids(gd)) {
          if (!neededGids.has(compGid)) {
            neededGids.add(compGid);
            added = true;
          }
        }
      }
    }
  }

  // 3. Sort needed GIDs ascending and build old → new GID map.
  const sortedGids = Array.from(neededGids).sort((a, b) => a - b);
  const oldToNew = new Map<number, number>();
  for (let i = 0; i < sortedGids.length; i++) {
    oldToNew.set(sortedGids[i], i);
  }
  const newNumGlyphs = sortedGids.length;

  // 4. Build new glyf + loca tables.
  //    Each glyph is padded to 2-byte alignment. Decide loca format based on
  //    the total glyf size (short if <= 0x1FFFE, else long).
  const glyfParts: Uint8Array[] = [];
  const newLoca: number[] = new Array(newNumGlyphs + 1);
  let glyfOffset = 0;
  for (let i = 0; i < newNumGlyphs; i++) {
    newLoca[i] = glyfOffset;
    const oldGid = sortedGids[i];
    let gd = getGlyphData(parsed, oldGid);
    if (glyphNumContours(gd) < 0) {
      // Composite: patch component GIDs.
      gd = patchCompositeGlyph(gd, oldToNew);
    }
    glyfParts.push(gd);
    glyfOffset += gd.length;
    // Pad to 2-byte alignment.
    if (glyfOffset & 1) {
      glyfParts.push(new Uint8Array(1));
      glyfOffset += 1;
    }
  }
  newLoca[newNumGlyphs] = glyfOffset;
  const newGlyf = concatBytes(glyfParts);
  const useShortLoca = glyfOffset <= 0x1fffe;
  const newLocaBytes = new Uint8Array((newNumGlyphs + 1) * (useShortLoca ? 2 : 4));
  if (useShortLoca) {
    for (let i = 0; i <= newNumGlyphs; i++) {
      writeBeU16(newLocaBytes, i * 2, newLoca[i] >>> 1);
    }
  } else {
    for (let i = 0; i <= newNumGlyphs; i++) {
      writeBeU32(newLocaBytes, i * 4, newLoca[i]);
    }
  }

  // 5. Build new hmtx table. Set numberOfHMetrics = newNumGlyphs (each glyph
  //    gets its own longHorMetric). Simpler than tracking lsb-only ranges.
  const newHmtx = new Uint8Array(newNumGlyphs * 4);
  for (let i = 0; i < newNumGlyphs; i++) {
    const oldGid = sortedGids[i];
    const m = getGlyphMetrics(parsed, oldGid);
    writeBeU16(newHmtx, i * 4, m.advanceWidth);
    writeBeU16(newHmtx, i * 4 + 2, m.lsb & 0xffff);
  }

  // 6. Build new cmap table (format 4 for BMP + format 12 for astral).
  const newCmap = buildCmapTable(codepoints, astralMap, parsed, oldToNew);

  // 7. Build new maxp table (copy original, update numGlyphs).
  const maxpTab = parsed.tables.get("maxp");
  if (!maxpTab) throw new Error("missing maxp");
  const newMaxp = new Uint8Array(maxpTab.data.length);
  newMaxp.set(maxpTab.data);
  writeBeU16(newMaxp, 4, newNumGlyphs);

  // 8. Build new head table (copy original, update indexToLocFormat).
  const newHead = new Uint8Array(parsed.headData.length);
  newHead.set(parsed.headData);
  writeBeU16(newHead, 50, useShortLoca ? 0 : 1);
  // Clear checksumAdjustment; we'll recompute it after assembly.
  writeBeU32(newHead, 8, 0);

  // 8b. Build new hhea table (copy original, update numberOfHMetrics).
  const hheaTab = parsed.tables.get("hhea");
  if (!hheaTab) throw new Error("missing hhea");
  const newHhea = new Uint8Array(hheaTab.data.length);
  newHhea.set(hheaTab.data);
  writeBeU16(newHhea, 34, newNumGlyphs);

  // 9. Build a fresh post table (version 3.0 = no glyph names). The original
  //    post table's glyphNameIndex references OLD GIDs, which are now invalid.
  //    Rebuilding as version 3.0 (32-byte header, no per-glyph data) is the
  //    simplest fix; PDF viewers don't use post for rendering, and TTF
  //    validators accept version 3.0.
  const postTab = parsed.tables.get("post");
  if (!postTab) throw new Error("missing post");
  const newPost = new Uint8Array(32);
  // Copy italicAngle, underlinePosition, underlineThickness, isFixedPitch from original.
  newPost.set(postTab.data.subarray(4, 16), 4);
  writeBeU32(newPost, 0, 0x00030000); // version 3.0
  // minMemType42/maxMemType42/minMemType1/maxMemType1: 0 (already zeroed)

  // Copy optional hinting tables (cvt, fpgm, prep) verbatim — they reference
  // points in the glyph data, not GIDs, so they're safe to keep.
  const optionalTables = ["name", "OS/2", "cvt ", "fpgm", "prep", "gasp"];
  const tablesToWrite: { tag: string; data: Uint8Array }[] = [
    { tag: "head", data: newHead },
    { tag: "hhea", data: newHhea },
    { tag: "maxp", data: newMaxp },
    { tag: "hmtx", data: newHmtx },
    { tag: "cmap", data: newCmap },
    { tag: "post", data: newPost },
    { tag: "loca", data: newLocaBytes },
    { tag: "glyf", data: newGlyf },
  ];
  for (const tag of optionalTables) {
    const t = parsed.tables.get(tag);
    if (t) tablesToWrite.push({ tag, data: t.data });
  }

  // 10. Assemble the new TTF: sfnt header + table directory + tables.
  const bytes = assembleTtf(tablesToWrite);

  // 11. Build the CID → new GID map (65536-entry big-endian Uint16Array).
  const cidToGid = buildCidToGidMap(parsed, codepoints, astralMap, oldToNew);

  return { bytes, cidToGid };
}

/**
 * Build a fresh cmap table. We ALWAYS include a format 12 subtable covering
 * ALL entries (BMP + astral). Some PDF viewers / font validators prefer
 * format 12 over format 4 when both are present and only look up entries in
 * the format 12 subtable, so the format 12 MUST cover BMP codepoints too.
 * We also include a format 4 subtable (BMP only) for older viewers that
 * don't support format 12.
 */
function buildCmapTable(
  codepoints: number[],
  astralMap: Record<number, number>,
  parsed: ParsedTtf,
  oldToNew: Map<number, number>
): Uint8Array {
  // Build codepoint → newGID entries (BMP + astral).
  const bmpEntries: { cp: number; gid: number }[] = [];
  const allEntries: { cp: number; gid: number }[] = [];
  for (const cp of codepoints) {
    const oldGid = parsed.codepointToGid.get(cp);
    if (oldGid === undefined || oldGid === 0) continue;
    const newGid = oldToNew.get(oldGid);
    if (newGid === undefined) continue;
    allEntries.push({ cp, gid: newGid });
    if (cp <= 0xffff) bmpEntries.push({ cp, gid: newGid });
  }
  // Astral codepoints are accessed via surrogate slots. Add them too.
  for (const cidStr in astralMap) {
    const cp = astralMap[cidStr];
    const oldGid = parsed.codepointToGid.get(cp);
    if (oldGid === undefined || oldGid === 0) continue;
    const newGid = oldToNew.get(oldGid);
    if (newGid === undefined) continue;
    allEntries.push({ cp, gid: newGid });
  }

  bmpEntries.sort((a, b) => a.cp - b.cp);
  allEntries.sort((a, b) => a.cp - b.cp);

  const fmt4 = buildCmapFormat4(bmpEntries);
  // Format 12 covers ALL entries (BMP + astral) — required because some
  // viewers (freetype, Poppler) prefer format 12 over format 4 and look up
  // ALL codepoints there, ignoring format 4 entirely.
  const fmt12 = buildCmapFormat12(allEntries);

  // cmap header: version(2) + numTables(2) + 2 records (8 bytes each)
  const headerSize = 4 + 2 * 8;
  const subtableOff0 = headerSize;
  const subtableOff1 = headerSize + fmt4.length;

  const totalLen = headerSize + fmt4.length + fmt12.length;
  const out = new Uint8Array(totalLen);
  writeBeU16(out, 0, 0); // version
  writeBeU16(out, 2, 2);
  // Record 0: platform 3 (Windows), encoding 1 (Unicode BMP), format 4.
  writeBeU16(out, 4, 3);
  writeBeU16(out, 6, 1);
  writeBeU32(out, 8, subtableOff0);
  // Record 1: platform 3, encoding 10 (Unicode full), format 12.
  writeBeU16(out, 12, 3);
  writeBeU16(out, 14, 10);
  writeBeU32(out, 16, subtableOff1);
  out.set(fmt4, subtableOff0);
  out.set(fmt12, subtableOff1);
  return out;
}

/** Build a format 4 cmap subtable from sorted BMP entries. */
function buildCmapFormat4(entries: { cp: number; gid: number }[]): Uint8Array {
  // Group into contiguous ranges where both cp and gid increment by 1.
  // For each group, use idDelta = gid - cp (so glyph = (cp + delta) mod 65536).
  interface Group { startCp: number; endCp: number; delta: number; }
  const groups: Group[] = [];
  for (const e of entries) {
    const last = groups[groups.length - 1];
    // Merge iff: contiguous cp (last.endCp + 1 == e.cp) AND consistent delta
    // (e.gid - e.cp == last.delta). Both conditions as signed integers.
    if (last && last.endCp + 1 === e.cp && (e.gid - e.cp) === last.delta) {
      last.endCp = e.cp;
    } else {
      groups.push({ startCp: e.cp, endCp: e.cp, delta: e.gid - e.cp });
    }
  }
  // Always add the sentinel segment 0xFFFF → gid 0. delta = 0 - 0xFFFF = 1
  // (after mod 65536), which maps 0xFFFF → 0.
  groups.push({ startCp: 0xffff, endCp: 0xffff, delta: 1 });

  const segCount = groups.length;
  const segCountX2 = segCount * 2;
  // searchRange = 2 * (2^floor(log2(segCount)))
  let sr = 2;
  while (sr * 2 <= segCountX2) sr *= 2;
  const searchRange = sr;
  const entrySelector = Math.floor(Math.log2(searchRange / 2));
  const rangeShift = segCountX2 - searchRange;

  // Layout: format(2) + length(2) + language(2) + segCountX2(2) + searchRange(2) + entrySelector(2) + rangeShift(2)
  //       + endCode[segCount] + reservedPad(2) + startCode[segCount] + idDelta[segCount] + idRangeOffset[segCount]
  //       + glyphIdArray (0 bytes — we use idDelta for all segments)
  const headerSize = 14;
  const bodySize = segCountX2 * 4 + 2; // 4 arrays of segCount uint16 + reservedPad
  const length = headerSize + bodySize;
  const out = new Uint8Array(length);
  writeBeU16(out, 0, 4);           // format
  writeBeU16(out, 2, length);      // length
  writeBeU16(out, 4, 0);           // language
  writeBeU16(out, 6, segCountX2);
  writeBeU16(out, 8, searchRange);
  writeBeU16(out, 10, entrySelector);
  writeBeU16(out, 12, rangeShift);
  let off = 14;
  // endCode
  for (const g of groups) { writeBeU16(out, off, g.endCp); off += 2; }
  // reservedPad
  writeBeU16(out, off, 0); off += 2;
  // startCode
  for (const g of groups) { writeBeU16(out, off, g.startCp); off += 2; }
  // idDelta (signed 16-bit)
  for (const g of groups) { writeBeU16(out, off, g.delta); off += 2; }
  // idRangeOffset (all 0)
  for (let i = 0; i < segCount; i++) { writeBeU16(out, off, 0); off += 2; }
  return out;
}

/** Build a format 12 cmap subtable from sorted astral entries. */
function buildCmapFormat12(entries: { cp: number; gid: number }[]): Uint8Array {
  if (entries.length === 0) return new Uint8Array(0);
  // Group into contiguous ranges (cp increments by 1, gid increments by 1).
  interface Group { startCp: number; endCp: number; startGid: number; }
  const groups: Group[] = [];
  for (const e of entries) {
    const last = groups[groups.length - 1];
    if (last && last.endCp + 1 === e.cp && (last.startGid + (e.cp - last.startCp)) === e.gid) {
      last.endCp = e.cp;
    } else {
      groups.push({ startCp: e.cp, endCp: e.cp, startGid: e.gid });
    }
  }
  // Header: format(2) + reserved(2) + length(4) + language(4) + numGroups(4) = 16 bytes
  // Body: numGroups * 12 bytes
  const length = 16 + groups.length * 12;
  const out = new Uint8Array(length);
  writeBeU16(out, 0, 12);          // format
  writeBeU16(out, 2, 0);           // reserved
  writeBeU32(out, 4, length);      // length
  writeBeU32(out, 8, 0);           // language
  writeBeU32(out, 12, groups.length); // numGroups
  let off = 16;
  for (const g of groups) {
    writeBeU32(out, off, g.startCp);
    writeBeU32(out, off + 4, g.endCp);
    writeBeU32(out, off + 8, g.startGid);
    off += 12;
  }
  return out;
}

/**
 * Build the CID → GID map (65536-entry big-endian Uint16Array).
 * Used both for the subset (oldToNew applied) and the full-TTF fallback.
 */
function buildCidToGidMap(
  parsed: ParsedTtf,
  codepoints: number[],
  astralMap: Record<number, number>,
  oldToNew?: Map<number, number>
): Uint16Array {
  // CID → GID lookup. For BMP CIDs (codepoint), use the codepoint directly.
  // For astral CIDs (surrogate slots 0xD800-0xDFFF), use the astral codepoint.
  const cidToOldGid = new Map<number, number>();
  for (const cp of codepoints) {
    if (cp > 0xffff) continue; // astral: handled via astralMap below
    if (cp >= 0xd800 && cp <= 0xdfff) continue; // surrogate range: skip (it's an astral slot)
    const gid = parsed.codepointToGid.get(cp);
    if (gid !== undefined && gid !== 0) {
      cidToOldGid.set(cp, gid);
    }
  }
  for (const cidStr in astralMap) {
    const cid = parseInt(cidStr, 10);
    const cp = astralMap[cid];
    const gid = parsed.codepointToGid.get(cp);
    if (gid !== undefined && gid !== 0) {
      cidToOldGid.set(cid, gid);
    }
  }

  // Build the 65536-entry table.
  const out = new Uint16Array(65536);
  for (const [cid, oldGid] of cidToOldGid) {
    const newGid = oldToNew ? (oldToNew.get(oldGid) ?? 0) : oldGid;
    out[cid] = newGid;
  }
  return out;
}

/** Assemble a TTF from a list of (tag, data) pairs. Computes checksums. */
function assembleTtf(tables: { tag: string; data: Uint8Array }[]): Uint8Array {
  const numTables = tables.length;
  // Sort tables by tag (spec recommends, though not required for validity).
  tables.sort((a, b) => a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0);

  // Compute searchRange, entrySelector, rangeShift per spec.
  let sr = 2;
  while (sr * 2 <= numTables) sr *= 2;
  const searchRange = sr * 16;
  const entrySelector = Math.floor(Math.log2(sr));
  const rangeShift = numTables * 16 - searchRange;

  // Layout: 12-byte header + 16-byte directory + tables (each padded to 4 bytes).
  const headerSize = 12;
  const directorySize = numTables * 16;
  let tableDataSize = 0;
  const paddedSizes: number[] = [];
  for (const t of tables) {
    const padded = (t.data.length + 3) & ~3;
    paddedSizes.push(padded);
    tableDataSize += padded;
  }
  const totalSize = headerSize + directorySize + tableDataSize;
  const out = new Uint8Array(totalSize);

  // Header
  writeBeU32(out, 0, 0x00010000); // sfnt version
  writeBeU16(out, 4, numTables);
  writeBeU16(out, 6, searchRange);
  writeBeU16(out, 8, entrySelector);
  writeBeU16(out, 10, rangeShift);

  // Compute table offsets + write directory.
  let dataOff = headerSize + directorySize;
  for (let i = 0; i < numTables; i++) {
    const t = tables[i];
    const off = 12 + i * 16;
    // tag (4 bytes)
    for (let j = 0; j < 4; j++) out[off + j] = t.tag.charCodeAt(j);
    // checksum (4 bytes) — computed below
    // offset (4 bytes)
    writeBeU32(out, off + 8, dataOff);
    // length (4 bytes)
    writeBeU32(out, off + 12, t.data.length);
    // Copy table data.
    out.set(t.data, dataOff);
    // Pad with zeros.
    for (let j = t.data.length; j < paddedSizes[i]; j++) out[dataOff + j] = 0;
    // Compute checksum: sum of all big-endian uint32 values (padded).
    let checksum = 0;
    for (let j = 0; j < paddedSizes[i]; j += 4) {
      checksum = (checksum + beU32(out, dataOff + j)) >>> 0;
    }
    writeBeU32(out, off + 4, checksum);
    dataOff += paddedSizes[i];
  }

  // Recompute head.checksumAdjustment.
  // Per spec: checksumAdjustment = 0xB1B0AFBA - checksum_of_entire_file.
  // Find head table offset.
  for (let i = 0; i < numTables; i++) {
    if (tables[i].tag === "head") {
      const headOff = beU32(out, 12 + i * 16 + 8);
      // Compute whole-file checksum (treating file as padded to 4 bytes — it already is).
      let fileChecksum = 0;
      for (let j = 0; j < totalSize; j += 4) {
        fileChecksum = (fileChecksum + beU32(out, j)) >>> 0;
      }
      const adjustment = (0xb1b0afba - fileChecksum) >>> 0;
      writeBeU32(out, headOff + 8, adjustment);
      break;
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// CIDToGIDMap bytes (big-endian, for the PDF stream)
// ---------------------------------------------------------------------------

/** Convert a 65536-entry Uint16Array to a 131072-byte big-endian Uint8Array. */
export function cidToGidMapToBytes(map: Uint16Array): Uint8Array {
  const out = new Uint8Array(map.length * 2);
  for (let i = 0; i < map.length; i++) {
    writeBeU16(out, i * 2, map[i]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// High-level: load base.ttf, parse, subset, return everything the PDF writer needs
// ---------------------------------------------------------------------------

export interface PreparedFont {
  fontBytes: Uint8Array;         // TTF bytes (subset or full fallback)
  cidToGidMapBytes: Uint8Array;  // big-endian 131072-byte table
  metrics: TtfMetrics;
  subsetted: boolean;
  numGlyphs: number;
}

const MODULE_DIR = typeof __dirname !== "undefined"
  ? __dirname
  : dirname(fileURLToPath(import.meta.url));
const FONT_PATH = join(MODULE_DIR, "fonts", "base.ttf");

let cachedFont: Uint8Array | null = null;
let cachedParsed: ParsedTtf | null = null;

/** Load and cache the base TTF (DejaVu Sans). */
export function loadBaseTtf(): Uint8Array {
  if (cachedFont) return cachedFont;
  const buf = readFileSync(FONT_PATH);
  cachedFont = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  return cachedFont;
}

/** Load + parse + cache the base TTF. */
export function loadBaseTtfParsed(): ParsedTtf {
  if (cachedParsed) return cachedParsed;
  cachedParsed = parseTtf(loadBaseTtf());
  return cachedParsed;
}

/**
 * High-level entry point: load base.ttf, parse, subset (or fall back to full
 * TTF), return the bytes + CIDToGIDMap + metrics needed to embed the font.
 *
 * @param codepoints  All Unicode codepoints used in the text layer (BMP + astral, deduped)
 * @param astralMap   CID (surrogate slot 0xD800-0xDFFF) → astral codepoint
 */
export function prepareEmbeddedFont(
  codepoints: number[],
  astralMap: Record<number, number> = {}
): PreparedFont {
  const parsed = loadBaseTtfParsed();
  const metrics = parseTtfMetrics(parsed);

  // Try subsetting. On ANY error, fall back to the full TTF + a CIDToGIDMap
  // built from the full cmap. (A working full-TTF embed beats a broken subsetter.)
  try {
    const subset = subsetTtf(parsed, codepoints, astralMap);
    if (subset.bytes.length === 0) throw new Error("subsetter returned empty bytes");
    return {
      fontBytes: subset.bytes,
      cidToGidMapBytes: cidToGidMapToBytes(subset.cidToGid),
      metrics,
      subsetted: true,
      numGlyphs: subset.bytes.length > 0 ? countGlyphsInSubset(subset.bytes) : 0,
    };
  } catch (err) {
    // Fallback: full TTF + CIDToGIDMap from the full cmap.
    const cidToGid = buildCidToGidMap(parsed, codepoints, astralMap);
    return {
      fontBytes: loadBaseTtf(),
      cidToGidMapBytes: cidToGidMapToBytes(cidToGid),
      metrics,
      subsetted: false,
      numGlyphs: parsed.numGlyphs,
    };
  }
}

/** Read numGlyphs from a subset TTF's maxp table (for logging). */
function countGlyphsInSubset(ttfBytes: Uint8Array): number {
  try {
    const p = parseTtf(ttfBytes);
    return p.numGlyphs;
  } catch {
    return 0;
  }
}
