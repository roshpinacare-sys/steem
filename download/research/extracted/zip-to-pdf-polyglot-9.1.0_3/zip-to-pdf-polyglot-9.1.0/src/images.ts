// src/lib/polyglot/images.ts
//
// v3.6 MULTI-MODAL PDF — IMAGE EMBEDDING.
//
// The agent-readable strategy renders every text file into the PDF text layer
// (Helvetica literal strings + Type0 hex CIDs). v2.5 added a vector diagram
// page so a human/VLM can SEE the file tree. v3.6 completes the multi-modal
// picture: image files in the archive (JPEG, PNG, GIF, SVG) are DETECTED and
// embedded as PDF XObject images on dedicated "image pages" sitting BETWEEN
// the diagram and the text-layer pages.
//
// An agent with vision (VLM) can now SEE the architecture — screenshots,
// UML diagrams, logos, diagrams — not just read the surrounding code. The PDF
// becomes a true multi-modal artifact: text layer (extractable via pdftotext),
// vector diagram (visible structure), and raster image pages (visible pixels).
//
// Image formats supported:
//   - JPEG: embedded directly with /Filter /DCTDecode (the raw JPEG bytes go
//     straight into the PDF stream — trivial, lossless, no re-encoding).
//   - PNG: embedded with /Filter /FlateDecode + /DecodeParms << /Predictor 15
//     /Columns W /Colors C /BitsPerComponent D >> (PDF spec reuses PNG's
//     predictors). The PNG's concatenated IDAT chunks (a single zlib stream)
//     become the PDF stream body; the predictor params let the PDF reader
//     de-filter the scanlines. Works for color types 0 (gray), 2 (RGB);
//     types 3/4/6 (palette/alpha) are skipped for simplicity.
//   - GIF / SVG: skipped (recorded in the manifest only). GIF has LZW (patent
//     risk, complex); SVG is vector (PDF can embed via XObject Form but it's
//     beyond this scope).
//
// Page layout: 2-column grid on letter (612×792, 50px margins → 512×692 usable).
// Each cell holds one image scaled to fit (preserving aspect ratio) + a caption
// strip below with the filename + dimensions. Up to 4 images per page.

import { concatBytes, sanitizeForPdfText, utf8 } from "./bytes";
import { flateDeflate } from "./flate";
import { dictObject, streamObject, DEFAULT_MEDIA_BOX } from "./pdf-writer";

// ---------- Page geometry (letter, matches diagram.ts) ----------

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 50;
const HEADER_H = 28; // space for the page title strip
const CAPTION_H = 16; // space below each image cell for the filename caption
const GAP = 12;

// Usable area for the image grid.
const GRID_X = MARGIN;
const GRID_Y = MARGIN; // bottom margin (grid grows upward from here)
const GRID_W = PAGE_W - MARGIN * 2; // 512
const GRID_H = PAGE_H - MARGIN * 2 - HEADER_H; // 692 - 28 = 664
const COLS = 2;
const ROWS = 2;
const IMAGES_PER_PAGE = COLS * ROWS; // 4
const CELL_W = (GRID_W - GAP * (COLS - 1)) / COLS; // 250
const CELL_H = (GRID_H - GAP * (ROWS - 1)) / ROWS - CAPTION_H; // 314

// ---------- Image detection ----------

export type ImageFormat = "jpeg" | "png" | "gif" | "svg";

export interface DetectedImage {
  name: string;
  format: ImageFormat;
  bytes: Uint8Array;
  width: number;
  height: number;
  /** True when the format can be embedded as a visible PDF XObject. */
  embeddable: boolean;
}

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_MAGIC = [0xff, 0xd8, 0xff];
const GIF_MAGIC = [0x47, 0x49, 0x46, 0x38];

function bytesStartWith(bytes: Uint8Array, magic: number[]): boolean {
  if (bytes.length < magic.length) return false;
  for (let i = 0; i < magic.length; i++) {
    if (bytes[i] !== magic[i]) return false;
  }
  return true;
}

/**
 * Detect an image file by magic bytes. PNG (89 50 4E 47), JPEG (FF D8 FF),
 * and GIF (47 49 46 38) are detected by their leading bytes. SVG is detected
 * by the file extension (.svg) — it has no magic bytes (it's XML text).
 */
export function isImageFile(name: string, bytes: Uint8Array): boolean {
  if (bytesStartWith(bytes, PNG_MAGIC)) return true;
  if (bytesStartWith(bytes, JPEG_MAGIC)) return true;
  if (bytesStartWith(bytes, GIF_MAGIC)) return true;
  // SVG: text-based, detected by extension only.
  if (/\.(svg)$/i.test(name) && bytes.length > 0) return true;
  return false;
}

function detectImageFormat(name: string, bytes: Uint8Array): ImageFormat | null {
  if (bytesStartWith(bytes, PNG_MAGIC)) return "png";
  if (bytesStartWith(bytes, JPEG_MAGIC)) return "jpeg";
  if (bytesStartWith(bytes, GIF_MAGIC)) return "gif";
  if (/\.(svg)$/i.test(name)) return "svg";
  return null;
}

// ---------- PNG parsing (IHDR dimensions + color type, concatenated IDAT) ----------

interface PngInfo {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number; // 0=gray, 2=RGB, 3=indexed, 4=gray+alpha, 6=RGBA
  interlaced: boolean;
  idat: Uint8Array; // concatenated IDAT chunk data (single zlib stream)
}

/** Big-endian unsigned 32-bit read (PNG chunk lengths + IHDR dimensions are BE). */
function u32be(bytes: Uint8Array, off: number): number {
  return (
    ((bytes[off] << 24) |
      (bytes[off + 1] << 16) |
      (bytes[off + 2] << 8) |
      bytes[off + 3]) >>>
    0
  );
}

function parsePng(bytes: Uint8Array): PngInfo | null {
  if (!bytesStartWith(bytes, PNG_MAGIC)) return null;
  let offset = PNG_MAGIC.length; // skip signature
  let width = 0,
    height = 0,
    bitDepth = 0,
    colorType = 0,
    interlaced = false;
  const idatChunks: Uint8Array[] = [];
  while (offset + 8 <= bytes.length) {
    const length = u32be(bytes, offset); // big-endian
    const type = String.fromCharCode(
      bytes[offset + 4],
      bytes[offset + 5],
      bytes[offset + 6],
      bytes[offset + 7]
    );
    offset += 8;
    if (offset + length > bytes.length) break;
    const data = bytes.subarray(offset, offset + length);
    if (type === "IHDR") {
      width = u32be(data, 0); // big-endian
      height = u32be(data, 4); // big-endian
      bitDepth = data[8];
      colorType = data[9];
      interlaced = data[12] === 1;
    } else if (type === "IDAT") {
      idatChunks.push(Uint8Array.from(data));
    } else if (type === "IEND") {
      break;
    }
    offset += length + 4; // skip data + CRC32
  }
  if (idatChunks.length === 0 || width === 0 || height === 0) return null;
  return { width, height, bitDepth, colorType, interlaced, idat: concatBytes(idatChunks) };
}

/** PNG color type → PDF color space + Colors count (for /DecodeParms). */
function pngColorSpec(colorType: number): { cs: string; colors: number } | null {
  switch (colorType) {
    case 0:
      return { cs: "/DeviceGray", colors: 1 };
    case 2:
      return { cs: "/DeviceRGB", colors: 3 };
    // 3 (indexed): needs /ColorSpace [/Indexed /DeviceRGB N <palette>]
    // — skip (caller falls back to recording name only).
    // 4 (gray+alpha) / 6 (RGBA): need /SMask for alpha — skip.
    default:
      return null;
  }
}

// ---------- JPEG parsing (scan for SOF marker → dimensions + components) ----------

interface JpegInfo {
  width: number;
  height: number;
  components: number; // 1=gray, 3=RGB, 4=CMYK
}

function parseJpeg(bytes: Uint8Array): JpegInfo | null {
  if (!bytesStartWith(bytes, JPEG_MAGIC)) return null;
  let i = 2; // skip SOI marker (0xFF 0xD8)
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = bytes[i + 1];
    // SOF markers: C0–C3, C5–C7, C9–CB, CD–CF (excluding C4=DHT, C8=JPG, CC=DAC).
    if (
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc
    ) {
      // SOF: FF marker, length(2), precision(1), height(2), width(2), components(1).
      const height = (bytes[i + 5] << 8) | bytes[i + 6];
      const width = (bytes[i + 7] << 8) | bytes[i + 8];
      const components = bytes[i + 9];
      return { width, height, components };
    }
    // Standalone markers (no length field): SOI/EOI/RSTn.
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      i += 2;
      continue;
    }
    // Other markers: skip length-prefixed segment.
    const length = (bytes[i + 2] << 8) | bytes[i + 3];
    i += 2 + length;
  }
  return null;
}

function jpegColorSpace(components: number): string {
  switch (components) {
    case 1:
      return "/DeviceGray";
    case 3:
      return "/DeviceRGB";
    case 4:
      return "/DeviceCMYK";
    default:
      return "/DeviceRGB";
  }
}

/**
 * Analyze an image file: detect format, parse dimensions + color info, and
 * decide whether it's embeddable as a PDF XObject. Returns null for non-images.
 */
export function analyzeImage(name: string, bytes: Uint8Array): DetectedImage | null {
  const format = detectImageFormat(name, bytes);
  if (!format) return null;
  if (format === "png") {
    const p = parsePng(bytes);
    if (!p) return { name, format, bytes, width: 0, height: 0, embeddable: false };
    const spec = pngColorSpec(p.colorType);
    const embeddable = !p.interlaced && p.bitDepth === 8 && spec !== null;
    return {
      name,
      format,
      bytes,
      width: p.width,
      height: p.height,
      embeddable,
    };
  }
  if (format === "jpeg") {
    const j = parseJpeg(bytes);
    if (!j) return { name, format, bytes, width: 0, height: 0, embeddable: false };
    return {
      name,
      format,
      bytes,
      width: j.width,
      height: j.height,
      embeddable: true,
    };
  }
  // gif / svg: not embedded, but recorded in the manifest.
  return { name, format, bytes, width: 0, height: 0, embeddable: false };
}

// ---------- PDF image XObject construction ----------

/**
 * Build the PDF stream object bytes for a single image XObject.
 *
 * - JPEG: `/Filter /DCTDecode` — the raw JPEG bytes are the stream body.
 * - PNG:  `/Filter /FlateDecode /DecodeParms << /Predictor 15 /Columns W
 *          /Colors C /BitsPerComponent 8 >>` — the PNG's concatenated IDAT
 *          chunks (a single zlib stream) are the stream body. The PDF reader
 *          inflates the IDAT then applies the PNG predictor (per-scanline
 *          de-filtering) to recover raw pixel data.
 *
 * @param objNum   the object number to allocate
 * @param img      the detected image
 * @returns the stream object bytes, or null if the image isn't embeddable
 */
export function buildImageXObject(objNum: number, img: DetectedImage): Uint8Array | null {
  if (!img.embeddable) return null;

  if (img.format === "jpeg") {
    const j = parseJpeg(img.bytes);
    if (!j) return null;
    const cs = jpegColorSpace(j.components);
    const dictFields =
      `/Type /XObject /Subtype /Image /Width ${j.width} /Height ${j.height} ` +
      `/ColorSpace ${cs} /BitsPerComponent 8 /Filter /DCTDecode`;
    return streamObject(objNum, dictFields, img.bytes);
  }

  if (img.format === "png") {
    const p = parsePng(img.bytes);
    if (!p) return null;
    const spec = pngColorSpec(p.colorType);
    if (!spec || p.interlaced || p.bitDepth !== 8) return null;
    // IDAT data is already a zlib stream → use it directly as the PDF stream
    // body with /FlateDecode + PNG predictor DecodeParms. The PDF reader
    // inflates IDAT (recovering the filtered scanlines) then applies the
    // predictor (removing the per-scanline filter byte) to get raw pixels.
    const dictFields =
      `/Type /XObject /Subtype /Image /Width ${p.width} /Height ${p.height} ` +
      `/ColorSpace ${spec.cs} /BitsPerComponent 8 /Filter /FlateDecode ` +
      `/DecodeParms << /Predictor 15 /Columns ${p.width} /Colors ${spec.colors} /BitsPerComponent 8 >>`;
    return streamObject(objNum, dictFields, p.idat);
  }

  return null;
}

// ---------- Image page construction ----------

export interface ImagePageResult {
  objects: Record<number, Uint8Array>;
  pageObjNums: number[];
  /** Object number of each embedded image XObject, parallel to the input
   * `images` array (0 if the image was not embeddable). */
  imageObjNums: number[];
  nextNum: number;
}

/**
 * Build a sequence of PDF pages that display images as XObjects. Each image
 * becomes a PDF XObject (`/Type /XObject /Subtype /Image`); the page content
 * stream uses `q <scale> cm /ImgN Do Q` to paint each image scaled to fit a
 * grid cell (preserving aspect ratio), plus a Helvetica caption with the
 * filename + dimensions below each cell.
 *
 * Layout: 2×2 grid on letter, 50px margins, 4 images per page (caption strip
 * under each cell). Non-embeddable images (GIF/SVG/PNG-palette/alpha) are
 * SKIPPED — they get a "[not embedded: <format>]" placeholder cell so the
 * page count stays predictable and the VLM sees that they existed.
 *
 * @param startNum   first object number to allocate
 * @param pagesNum   /Pages parent dict object number
 * @param fontNum    Helvetica (/F1) font object number (shared with cover/diagram)
 * @param images     detected images (embeddable + non-embeddable)
 */
export function buildImagePage(
  startNum: number,
  pagesNum: number,
  fontNum: number,
  images: DetectedImage[]
): ImagePageResult {
  const objects: Record<number, Uint8Array> = {};
  const pageObjNums: number[] = [];
  const imageObjNums: number[] = new Array(images.length).fill(0);

  if (images.length === 0) {
    return { objects, pageObjNums, imageObjNums, nextNum: startNum };
  }

  // Pre-allocate XObject numbers for embeddable images, then build the
  // per-page content streams. Each page allocates: 1 page + 1 contents +
  // (one XObject per embeddable image on that page).
  let obj = startNum;
  const pageCount = Math.max(1, Math.ceil(images.length / IMAGES_PER_PAGE));

  // First pass: assign object numbers.
  const pageAllocations: {
    pageNum: number;
    contentsNum: number;
    cellImages: { img: DetectedImage; index: number; xobjNum: number }[];
  }[] = [];
  for (let p = 0; p < pageCount; p++) {
    const pageNum = obj++;
    const contentsNum = obj++;
    const slice = images.slice(p * IMAGES_PER_PAGE, (p + 1) * IMAGES_PER_PAGE);
    const cellImages: { img: DetectedImage; index: number; xobjNum: number }[] = [];
    for (let c = 0; c < slice.length; c++) {
      const img = slice[c];
      const index = p * IMAGES_PER_PAGE + c;
      let xobjNum = 0;
      if (img.embeddable) {
        xobjNum = obj++;
        imageObjNums[index] = xobjNum;
      }
      cellImages.push({ img, index, xobjNum });
    }
    pageAllocations.push({ pageNum, contentsNum, cellImages });
  }

  // Second pass: build XObject streams + page content streams.
  for (let p = 0; p < pageCount; p++) {
    const { pageNum, contentsNum, cellImages } = pageAllocations[p];

    // Build XObject streams for embeddable images on this page.
    const xobjResources: string[] = [];
    for (const cell of cellImages) {
      if (cell.xobjNum === 0) continue;
      const xobj = buildImageXObject(cell.xobjNum, cell.img);
      if (xobj) {
        objects[cell.xobjNum] = xobj;
        xobjResources.push(`/Img${cell.xobjNum} ${cell.xobjNum} 0 R`);
      }
    }

    // Build the page content stream: title + 2×2 grid of cells.
    const parts: string[] = [];

    // ===== Title strip =====
    const titleStart = p * IMAGES_PER_PAGE + 1;
    const titleEnd = Math.min((p + 1) * IMAGES_PER_PAGE, images.length);
    const title = sanitizeForPdfText(
      `Embedded Images (${titleStart}-${titleEnd} of ${images.length}) — v3.6 multi-modal`,
      110
    );
    parts.push(`BT /F1 13 Tf ${GRID_X} ${PAGE_H - MARGIN - 18} Td (${title}) Tj ET`);
    // Thin horizontal rule below the title.
    parts.push(
      `0.7 0.7 0.7 rg ${GRID_X} ${PAGE_H - MARGIN - HEADER_H + 6} ${GRID_W} 0.4 re f`
    );

    // ===== 2×2 grid of cells =====
    for (let c = 0; c < cellImages.length; c++) {
      const cell = cellImages[c];
      const col = c % COLS;
      const row = Math.floor(c / COLS);

      // Cell origin (bottom-left of the image area, excluding caption).
      const cellX = GRID_X + col * (CELL_W + GAP);
      // Grid is laid out top-down visually, so row 0 is the TOP row.
      const cellTop = PAGE_H - MARGIN - HEADER_H - row * (CELL_H + CAPTION_H + GAP);
      const cellY = cellTop - CELL_H;

      // Light gray cell border (1px rectangle).
      parts.push(`0.85 0.85 0.85 rg ${cellX} ${cellY} ${CELL_W} ${CELL_H} re f`);
      parts.push(`0.5 0.5 0.5 RG 0.5 w ${cellX} ${cellY} ${CELL_W} ${CELL_H} re S`);

      if (cell.xobjNum !== 0 && cell.img.width > 0 && cell.img.height > 0) {
        // Scale image to fit the cell (preserve aspect ratio).
        const scale = Math.min(CELL_W / cell.img.width, CELL_H / cell.img.height);
        const drawW = cell.img.width * scale;
        const drawH = cell.img.height * scale;
        // Center inside the cell.
        const drawX = cellX + (CELL_W - drawW) / 2;
        const drawY = cellY + (CELL_H - drawH) / 2;
        // cm operator: a b c d e f → identity = 1 0 0 1 0 0. To scale by (drawW, drawH)
        // and translate to (drawX, drawY): drawW 0 0 drawH drawX drawY.
        parts.push(`q ${drawW.toFixed(2)} 0 0 ${drawH.toFixed(2)} ${drawX.toFixed(2)} ${drawY.toFixed(2)} cm /Img${cell.xobjNum} Do Q`);
      } else {
        // Non-embeddable image: placeholder text.
        const placeholder = sanitizeForPdfText(
          `[${cell.img.format} not embedded]`,
          36
        );
        parts.push(
          `BT /F1 9 Tf ${cellX + 8} ${cellY + CELL_H / 2} Td (${placeholder}) Tj ET`
        );
      }

      // Caption strip below the cell: filename + dimensions.
      const baseName = cell.img.name.split("/").pop() || cell.img.name;
      const dims =
        cell.img.width > 0
          ? `${cell.img.width}×${cell.img.height}`
          : "—";
      const caption = sanitizeForPdfText(`${baseName} (${cell.img.format}, ${dims})`, 56);
      parts.push(
        `BT /F1 8 Tf ${cellX} ${cellY - 12} Td (${caption}) Tj ET`
      );
    }

    // ===== Assemble content stream =====
    const rawContent = utf8(parts.join("\n") + "\n");
    const content = flateDeflate(rawContent, 9);

    objects[contentsNum] = streamObject(contentsNum, "/Filter /FlateDecode", content);

    // Page dict — /Resources lists the XObject map + Helvetica font.
    const xobjDict =
      xobjResources.length > 0
        ? `/XObject << ${xobjResources.join(" ")} >> `
        : "";
    objects[pageNum] = dictObject(
      pageNum,
      `<< /Type /Page /Parent ${pagesNum} 0 R /MediaBox [${DEFAULT_MEDIA_BOX.join(" ")}] ` +
        `/Resources << /Font << /F1 ${fontNum} 0 R >> ${xobjDict}>> /Contents ${contentsNum} 0 R >>`
    );
    pageObjNums.push(pageNum);
  }

  return { objects, pageObjNums, imageObjNums, nextNum: obj };
}

// ---------- Image extraction (for /api/extract-images) ----------

/**
 * Find all image XObjects embedded in the PDF by scanning every object body
 * for `/Subtype /Image`. Returns the object numbers in document order.
 *
 * This is the fallback path when the manifest doesn't carry an `images` array.
 * The preferred path reads manifest.images (which has names + formats +
 * dimensions). This scan path is used for PDFs without the v3.6 manifest
 * extension or for ad-hoc inspection.
 */
export function scanImageXObjects(buf: Uint8Array): number[] {
  // Look for `N 0 obj\n<< ... /Subtype /Image ... >>` patterns.
  const results: number[] = [];
  const text = new TextDecoder("latin1").decode(buf);
  // Match object headers + their dicts in one pass.
  const re = /(\d+)\s+0\s+obj\s*<<([^>]*)\/Subtype\s*\/Image/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const num = parseInt(m[1], 10);
    if (!results.includes(num)) results.push(num);
  }
  return results;
}
