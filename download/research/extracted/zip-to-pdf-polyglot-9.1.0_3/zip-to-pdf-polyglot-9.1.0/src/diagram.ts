// src/lib/polyglot/diagram.ts
//
// v2.5 VISUAL STRUCTURE DIAGRAM PAGE.
//
// The v2.0–v2.4 cover page is text-only (Helvetica lines). v2.5 adds a visual
// diagram page — a rendered file-tree + size-bar visualization embedded as a
// PDF page, so a human (or a VLM agent) can SEE the archive structure at a
// glance. This is the "vision" breakthrough: the PDF becomes visually
// understandable, not just text-extractable.
//
// Layout (letter, 612×792, origin bottom-left, y↑):
//
//   ┌──────────────────────────────────────────────────────────────────┐
//   │  Title (16pt)                                          y=770     │
//   │  Summary panel: counts + original size + ratio        y=720–760  │
//   │  Column headers: "Path" / "Size (log scale)"          y=700      │
//   │                                                                  │
//   │  ┌────────────────────────────┐  ┌──────────────────────────┐    │
//   │  │ file tree (indented)       │  │ size bars (log-scaled)    │   │
//   │  │   src/                     │  │   ▓▓▓▓▓                   │   │
//   │  │     lib/                   │  │   ▓▓▓▓▓▓▓▓▓▓              │   │
//   │  │       polyglot.ts          │  │   ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓         │   │
//   │  │       types.ts             │  │   ▓                       │   │
//   │  │     index.ts               │  │   ▓▓                      │   │
//   │  │   components/              │  │   ▓▓▓▓▓▓                  │   │
//   │  │   ...                       │  │   ...                     │   │
//   │  └────────────────────────────┘  └──────────────────────────┘    │
//   │                                                                  │
//   │  Legend (bottom): green=text  orange=binary  gray=deduped        │
//   └──────────────────────────────────────────────────────────────────┘
//
// Vector ops used (PDF content stream):
//   R G B RG   set stroke color (0–1)
//   R G B rg   set fill color
//   x y w h re rectangle path (lower-left corner + dimensions)
//   f          fill the current path
//   S          stroke the current path
//   BT /F1 N Tf x y Td (text) Tj ET   text in Helvetica size N at (x,y)
//
// All text uses the Helvetica font (object 3, /F1) — the same font the cover
// page uses. The content stream is FlateDecode-compressed (~1–2 KB on disk
// for typical codebases, since the vector ops + text labels compress well).

import { concatBytes, sanitizeForPdfText, utf8 } from "./bytes";
import { flateDeflate } from "./flate";
import { dictObject, streamObject } from "./pdf-writer";
import type { ManifestFile } from "./types";

/** Page geometry (letter). */
const PAGE_W = 612;
const PAGE_H = 792;

/** Diagram layout constants. */
const TREE_X = 50; // left edge of file-tree column
const TREE_W = 290; // file-tree column width (50 → 340)
const BAR_X = 360; // left edge of size-bar column
const BAR_MAX_W = 200; // max bar width (360 → 560)
const BAR_H = 6; // bar height
const ROW_H = 10; // row pitch
const ROW_TOP = 685; // y of first row (text baseline)
const ROW_BOTTOM = 90; // y of last row (text baseline)
const MAX_ROWS = 60; // cap; if entries exceed this, show first 30 + "... N more" + last 30
const HEAD_TAIL = 30; // head/tail sizes when capping
const INDENT_PX = 12; // indent per path-depth level

/** Fill colors (RGB, 0–1) by file kind. */
const COLOR_TEXT = "0.20 0.60 0.40"; // green
const COLOR_BINARY = "0.70 0.40 0.20"; // orange
const COLOR_DEDUP = "0.50 0.50 0.50"; // gray

export interface DiagramSummary {
  fileCount: number;
  textFileCount: number;
  binaryFileCount: number;
  dedupCount: number;
  totalOriginalBytes: number;
}

export interface DiagramOptions {
  origName?: string;
  /** Pre-assembly estimate of the final PDF size (sum of all non-diagram object
   * bytes + a small xref/trailer overhead). Shown in the summary panel as
   * "PDF (est.)" — the actual assembled size will be this + ~1–2 KB (the
   * diagram's own bytes). If omitted, the panel shows "n/a" for the size +
   * ratio fields. */
  pdfSizeEstimate?: number;
}

/**
 * Build a single visual-diagram page (1 page object + 1 content stream).
 *
 * @param startNum   first object number to allocate (page + contents = 2)
 * @param pagesNum   /Pages parent dict object number
 * @param fontNum    Helvetica (/F1) font object number (shared with cover)
 * @param manifest   the full manifest entries (text + binary + deduped)
 * @param summary    high-level counts for the summary panel
 * @param options    origName + pdfSizeEstimate
 * @returns objects map, the single page object number, and nextNum
 */
export function buildDiagramPage(
  startNum: number,
  pagesNum: number,
  fontNum: number,
  manifest: ManifestFile[],
  summary: DiagramSummary,
  options: DiagramOptions = {}
): {
  objects: Record<number, Uint8Array>;
  pageObjNums: number[];
  nextNum: number;
} {
  const pageNum = startNum;
  const contentsNum = startNum + 1;

  // ---- Prepare the row list (apply the 60-entry cap if needed) ----
  type Row =
    | { kind: "file"; name: string; size: number; type: "text" | "binary"; dedup: boolean; depth: number; baseName: string }
    | { kind: "gap"; count: number };

  const fileRows: Row[] = manifest.map((mf) => {
    const parts = mf.name.split("/");
    const depth = Math.max(0, parts.length - 1);
    const baseName = parts[parts.length - 1] || mf.name;
    return {
      kind: "file" as const,
      name: mf.name,
      size: mf.size,
      type: mf.type,
      dedup: mf.ref !== undefined,
      depth,
      baseName,
    };
  });

  let rows: Row[];
  if (fileRows.length <= MAX_ROWS) {
    rows = fileRows;
  } else {
    const omitted = fileRows.length - HEAD_TAIL * 2;
    rows = [
      ...fileRows.slice(0, HEAD_TAIL),
      { kind: "gap" as const, count: omitted },
      ...fileRows.slice(-HEAD_TAIL),
    ];
  }

  // ---- Compute the log-scale max for bar widths ----
  // Bars are proportional to log(size+1) so sizes from 1 byte to 1 MB all
  // render visibly. We use the max file size in the visible rows as the
  // denominator; that's the longest bar. Empty/directory entries (size 0)
  // render as a 1-px-wide stub so they're still visible.
  let maxSize = 0;
  for (const r of rows) {
    if (r.kind === "file" && r.size > maxSize) maxSize = r.size;
  }
  const logMax = Math.log(maxSize + 1) || 1; // guard against empty manifest

  // ---- Build the content stream (text + vector ops) ----
  const parts: string[] = [];

  // ===== Title =====
  parts.push(
    `BT /F1 16 Tf ${TREE_X} 770 Td (${sanitizeForPdfText(
      "Archive Structure Diagram (v2.5)",
      80
    )}) Tj ET`
  );

  // ===== Summary panel =====
  const ratioPct =
    options.pdfSizeEstimate && options.pdfSizeEstimate > 0
      ? ((options.pdfSizeEstimate / summary.totalOriginalBytes) * 100).toFixed(1) + "%"
      : "n/a";
  const pdfSizeStr =
    options.pdfSizeEstimate != null
      ? options.pdfSizeEstimate.toLocaleString("en-US") + " bytes (est.)"
      : "n/a (pre-assembly)";

  // Two summary lines, 10pt,Helvetica, dropped 12pt per line.
  parts.push(`BT /F1 10 Tf ${TREE_X} 752 Td`);
  parts.push(
    `(${sanitizeForPdfText(
      `Source: ${options.origName || "archive.zip"}    Files: ${summary.fileCount}    Text: ${summary.textFileCount}    Binary: ${summary.binaryFileCount}    Dedup: ${summary.dedupCount}`,
      110
    )}) Tj`
  );
  parts.push(`0 -13 Td`);
  parts.push(
    `(${sanitizeForPdfText(
      `Original: ${summary.totalOriginalBytes.toLocaleString("en-US")} bytes    PDF: ${pdfSizeStr}    Ratio: ${ratioPct}`,
      110
    )}) Tj`
  );
  parts.push(`ET`);

  // ===== Column headers + horizontal rule =====
  parts.push(`BT /F1 9 Tf ${TREE_X} 705 Td (Path) Tj ET`);
  parts.push(`BT /F1 9 Tf ${BAR_X} 705 Td (Size  log-scaled bars  bytes shown after bar) Tj ET`);
  // Thin horizontal rule under the headers (use a 0.4-pt black rectangle).
  parts.push(`0.7 0.7 0.7 rg ${TREE_X} 695.5 ${PAGE_W - TREE_X * 2} 0.4 re f`);

  // ===== Rows: file tree + size bars =====
  // Each row: y baseline = ROW_TOP - i * ROW_H. Bar is vertically centered
  // around the text baseline (text baseline + 2 → bar lower-left y).
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const y = ROW_TOP - i * ROW_H;
    if (y < ROW_BOTTOM) break; // clip overflow (shouldn't happen with cap)

    if (row.kind === "gap") {
      const label = sanitizeForPdfText(`... ${row.count} more entries (see manifest) ...`, 80);
      parts.push(`BT /F1 8 Tf ${TREE_X + 16} ${y} Td (${label}) Tj ET`);
      continue;
    }

    // ---- File name (left column, indented by depth) ----
    // Use the directory prefix as a faint guide + base name in normal weight.
    // We render only the base name (single Tj) at the indented position; the
    // tree structure is conveyed by the indentation alone (matching the
    // common `tree` CLI output style).
    const x = TREE_X + row.depth * INDENT_PX;
    const label = sanitizeForPdfText(row.baseName || row.name, 36);
    // Tree connector: ASCII "- " for nested entries (avoids the non-ASCII
    // middle dot which sanitizeForPdfText would mangle to "?").
    const connector = row.depth > 0 ? "- " : "";
    parts.push(`BT /F1 8 Tf ${x} ${y} Td (${connector}${label}) Tj ET`);

    // ---- Size bar (right column, log-scaled width, color by kind) ----
    const color = row.dedup
      ? COLOR_DEDUP
      : row.type === "text"
        ? COLOR_TEXT
        : COLOR_BINARY;
    // log-scaled width: log(size+1)/logMax * BAR_MAX_W. Min 1.0 so size-0
    // entries still render as a visible stub.
    const width = Math.max(1.0, (Math.log(row.size + 1) / logMax) * BAR_MAX_W);
    const barY = y - 1.5; // visually centered on the 8pt text baseline
    parts.push(`${color} rg ${BAR_X} ${barY.toFixed(2)} ${width.toFixed(2)} ${BAR_H} re f`);

    // ---- Size label after the bar (right-aligned to bar end + 3pt) ----
    const sizeLabel = sanitizeForPdfText(row.size.toLocaleString("en-US"), 16);
    parts.push(
      `BT /F1 7 Tf ${(BAR_X + width + 3).toFixed(2)} ${y} Td (${sizeLabel}) Tj ET`
    );
  }

  // ===== Legend (bottom) =====
  const legendY = 60;
  // Three colored swatches with labels.
  const swatchW = 12;
  const swatchH = 7;
  const swatchY = legendY - 1;
  parts.push(`${COLOR_TEXT} rg ${TREE_X} ${swatchY} ${swatchW} ${swatchH} re f`);
  parts.push(
    `BT /F1 8 Tf ${TREE_X + swatchW + 4} ${legendY} Td (${sanitizeForPdfText(
      "text - UTF-8 readable",
      40
    )}) Tj ET`
  );
  parts.push(
    `${COLOR_BINARY} rg ${TREE_X + 170} ${swatchY} ${swatchW} ${swatchH} re f`
  );
  parts.push(
    `BT /F1 8 Tf ${TREE_X + 170 + swatchW + 4} ${legendY} Td (${sanitizeForPdfText(
      "binary - deduped store",
      40
    )}) Tj ET`
  );
  parts.push(`${COLOR_DEDUP} rg ${TREE_X + 340} ${swatchY} ${swatchW} ${swatchH} re f`);
  parts.push(
    `BT /F1 8 Tf ${TREE_X + 340 + swatchW + 4} ${legendY} Td (${sanitizeForPdfText(
      "deduped - back-ref",
      40
    )}) Tj ET`
  );

  // Footer note.
  parts.push(
    `BT /F1 7 Tf ${TREE_X} 40 Td (${sanitizeForPdfText(
      "v2.5 visual diagram - bar widths are log-scaled. See /PolyglotManifest stream for full file metadata.",
      110
    )}) Tj ET`
  );

  // ===== Assemble the content stream =====
  const rawContent = utf8(parts.join("\n") + "\n");
  const content = flateDeflate(rawContent, 9);

  // ===== Build the PDF objects =====
  const objects: Record<number, Uint8Array> = {};
  objects[contentsNum] = streamObject(contentsNum, "/Filter /FlateDecode", content);
  objects[pageNum] = dictObject(
    pageNum,
    `<< /Type /Page /Parent ${pagesNum} 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
      `/Resources << /Font << /F1 ${fontNum} 0 R >> >> /Contents ${contentsNum} 0 R >>`
  );

  return { objects, pageObjNums: [pageNum], nextNum: startNum + 2 };
}
