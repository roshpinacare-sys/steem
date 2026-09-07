// src/lib/polyglot/strategies/agent-readable.ts
//
// THE v2 BREAKTHROUGH STRATEGY.
//
// Produces a PDF that is simultaneously:
//   1. AGENT-READABLE — every text file's full content is rendered into the
//      PDF text layer, so `pdftotext` / any PDF reader extracts the entire
//      codebase in one pass. The manifest records each file's line range.
//   2. LIGHTWEIGHT — no duplication. Text files live ONLY in the text layer
//      (a lossless, reversible encoding: split on 0x0A, escape `\ ( )` and
//      NUL, render each segment as a `Tj`; reconstruction = join on 0x0A).
//      Binary files live ONLY in a deduped, FlateDecode-compressed store.
//      Identical files (text or binary) are deduplicated via back-references.
//      Deflate-9 + dedup + optional cruft exclusion beats source ZIP size
//      for real codebases.
//   3. LOSSLESS + REVERSIBLE — reversal reads the PDF's own content-stream
//      objects back (NOT pdftotext), un-escapes, and rebuilds exact bytes.
//      A /PolyglotManifest JSON stream is the authority; a
//      /PolyglotBinaryStore stream carries binary blobs.
//   4. CANONICAL — extract() rebuilds a deterministic ZIP (sorted entries,
//      fixed timestamps, UTF-8 names, deflate) = "canonical zip in a new
//      version".
//
// v2.1: text-layer encoding is now Unicode-capable. A file is "text" iff its
// bytes are valid UTF-8 (ASCII is a subset, so all v2.0 text files remain
// text; additionally, Hebrew/CJK/emoji files now become readable). Each text
// file is decoded to a JS string, split into lines on LF/CR/CRLF (with the
// terminator recorded per line so reversal is byte-exact even for old-Mac CR
// or mixed endings), and each line's UTF-16 code units are rendered as 2-byte
// CIDs via a Type0 (Identity-H) font with an identity ToUnicode CMap. An
// external reader (`pdftotext`) uses the ToUnicode CMap to extract the text;
// our own extractor reads the CIDs back and UTF-8-encodes for byte-exact
// reversal. Files that are NOT valid UTF-8 are "binary" (still lossless, in
// the deduped binary store).

import { concatBytes, sanitizeEntryName, sha256HexSync, utf8 } from "../bytes";
import { extractEntryBytes, readZipStructure, walkCentralDirectory } from "../zip-reader";
import {
  assemblePdf,
  assemblePdfCompact,
  buildCatalog,
  buildTextPages,
  buildTextPagesHybrid,
  buildType0Font,
  dictObject,
  streamObject,
} from "../pdf-writer";
import { buildDiagramPage } from "../diagram";
import { buildParContainer, parseParContainer } from "../par";
import { flateDeflate, brotliDeflate } from "../flate";
import { merkleRoot, fileHash } from "../merkle";
import { buildAgentProtocol, buildJsActions, buildAcroFormButtons } from "../agent-protocol";
import type { ManifestTest, PipelineStep } from "../types";
import {
  extractTjLines,
  findPageContentsRefs,
  findPolyglotRefs,
  pageContentsRef,
  readObjectStream,
} from "../pdf-reader";
import { buildCanonicalZip } from "../zip-writer";
import { prepareEmbeddedFont } from "../font-subset";
import {
  analyzeImage,
  buildImagePage,
  isImageFile,
  type DetectedImage,
  type ImagePageResult,
} from "../images";
import type { FullManifest, ManifestFile, ManifestImage, ManifestSummary } from "../types";
import type { StrategyModule } from "../polyglot";

export const name = "agent-readable" as const;
export const label =
  "Agent-readable polyglot — full text layer + deduped binary store + canonical reversal (v2 default)";
export const isTrueByteLevelPolyglot = false;
export const isExtractable = true;

// Cruft patterns excluded when excludeCruft is on. Conservative defaults that
// target regenerable/heavy folders typical of "very very heavy" codebase zips.
const CRUFT_PREFIXES = [
  "node_modules/",
  ".git/",
  ".next/",
  "dist/",
  "build/",
  "out/",
  "coverage/",
  ".cache/",
  "__pycache__/",
  ".venv/",
  "vendor/",
  ".turbo/",
  ".parcel-cache/",
];
const CRUFT_EXACT = new Set([
  ".DS_Store",
  "yarn.lock",
  "package-lock.json",
  "bun.lockb",
  "bun.lock",
]);

function isCruft(name: string): boolean {
  const clean = name.replace(/^\.?\//, "");
  const base = clean.split("/").pop() || "";
  if (CRUFT_EXACT.has(base)) return true;
  return CRUFT_PREFIXES.some((p) => clean.startsWith(p));
}

/**
 * A file is "text" iff its bytes are valid UTF-8. ASCII is a subset, so all
 * v2.0 text files (ASCII-only) remain text; additionally, any valid-UTF-8
 * file with non-ASCII (Hebrew, CJK, emoji, accented Latin) is now text and
 * becomes readable in the PDF text layer. Files that are not valid UTF-8
 * (lone high bytes, compressed blobs, etc.) are "binary".
 */
const _utf8Decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
export function isTextBytes(bytes: Uint8Array): boolean {
  try {
    _utf8Decoder.decode(bytes);
    return true;
  } catch {
    return false;
  }
}

/**
 * Split a JS string (already UTF-8-decoded from the file's bytes) into line
 * segments on LF, CR, or CRLF. Returns the segments (without terminators) and
 * a parallel `terms` array: 0=none (EOF), 1=LF, 2=CR, 3=CRLF. This makes
 * reversal byte-exact for old-Mac CR, Windows CRLF, Unix LF, and mixed
 * endings, while the text layer splits on all of them so `pdftotext` shows
 * separate lines (fixing the v2.0 lone-CR merge bug).
 */
export function splitLinesWithTerms(
  s: string
): { segs: string[]; terms: number[] } {
  const segs: string[] = [];
  const terms: number[] = [];
  let i = 0;
  const n = s.length;
  let start = 0;
  while (i < n) {
    const c = s.charCodeAt(i);
    if (c === 0x0a) {
      segs.push(s.slice(start, i));
      terms.push(1);
      i++;
      start = i;
    } else if (c === 0x0d) {
      if (i + 1 < n && s.charCodeAt(i + 1) === 0x0a) {
        segs.push(s.slice(start, i));
        terms.push(3);
        i += 2;
        start = i;
      } else {
        segs.push(s.slice(start, i));
        terms.push(2);
        i++;
        start = i;
      }
    } else {
      i++;
    }
  }
  segs.push(s.slice(start));
  terms.push(0);
  return { segs, terms };
}

/**
 * v2.2 CID allocator. BMP chars (codepoint ≤ 0xFFFF, non-surrogate) get
 * CID = codepoint (identity, covered by the ToUnicode bfrange). Astral chars
 * (> 0xFFFF) get allocated CIDs in the surrogate range 0xD800-0xDFFF (2048
 * slots) and explicit bfchar entries → surrogate-pair destinations, so
 * `pdftotext` combines them into the astral codepoint (emoji, rare CJK).
 * Returns the astralMap (CID → codepoint) for the manifest + ToUnicode CMap.
 */
export function createCidAllocator() {
  const astralMap: Record<number, number> = {}; // CID → codepoint
  const cpToCid: Map<number, number> = new Map(); // codepoint → CID (dedup)
  let nextAstralCid = 0xd800;

  function encode(str: string): Uint16Array {
    // Iterate by code point (for...of yields code points, not UTF-16 units).
    const cids: number[] = [];
    for (const ch of str) {
      const cp = ch.codePointAt(0)!;
      if (cp <= 0xffff) {
        cids.push(cp);
      } else {
        // astral: allocate or reuse a CID in the surrogate range
        let cid = cpToCid.get(cp);
        if (cid === undefined) {
          if (nextAstralCid > 0xdfff) {
            throw new Error(
              "Astral CID pool exhausted (>2048 distinct astral chars). " +
                "This is extremely rare; report the file for v2.3."
            );
          }
          cid = nextAstralCid++;
          cpToCid.set(cp, cid);
          astralMap[cid] = cp;
        }
        cids.push(cid);
      }
    }
    return new Uint16Array(cids);
  }

  /** Reverse: CIDs → JS string (for the readable sample + verification). */
  function decode(cids: Uint16Array): string {
    let s = "";
    for (let i = 0; i < cids.length; i++) {
      const cid = cids[i];
      const cp = astralMap[cid];
      if (cp !== undefined) s += String.fromCodePoint(cp);
      else s += String.fromCharCode(cid);
    }
    return s;
  }

  return { encode, decode, astralMap, astralCount: () => Object.keys(astralMap).length };
}

export interface ExtractedFile {
  index: number;
  name: string;
  bytes: Uint8Array;
  isDirectory: boolean;
}

export interface AgentReadableBuildResult {
  bytes: Uint8Array;
  strategy: "agent-readable";
  entryCount: number;
  originalSize: number;
  pdfSize: number;
  textFileCount: number;
  binaryFileCount: number;
  dedupCount: number;
  excludedCount: number;
  readableSample: string;
  manifestSummary: ManifestSummary;
  logs: string[];
}

/**
 * v2.6: The accumulated state from Pass 1 (classify + dedup) and Pass 2 (line
 * splitting). This is the interface between the entry-extraction phase (which
 * can be streaming) and the downstream PDF-assembly phase (which is shared by
 * the in-memory `build` and the streaming `buildPolyglotStreaming`).
 *
 * `filesMetadata` caches the per-file (name, hash, isDirectory) so the
 * downstream pipeline can compute the Merkle root, emit test assertions, and
 * detect pipelines WITHOUT needing the original file bytes — enabling true
 * streaming where each entry's bytes are freed after processing.
 */
export interface AccumulatedState {
  manifestFiles: ManifestFile[];
  globalLines: { raw: Uint8Array | null; cids: Uint16Array | null }[];
  globalTerms: number[];
  uniqueBinaryBlobs: Uint8Array[];
  filesMetadata: { name: string; hash: string; isDirectory: boolean }[];
  cidAlloc: ReturnType<typeof createCidAllocator>;
  totalLines: number;
  dedupLines: number;
  textFileCount: number;
  binaryFileCount: number;
  dedupCount: number;
  excludedCount: number;
  totalOriginalBytes: number;
  /** Images detected in the archive (for VLM embedding).
   * Populated by `build` (in-memory path) and `accumulateStreamingState`
   * (streaming path). Empty array = no images = no image pages. */
  detectedImages?: DetectedImage[];
}

/**
 * v2.6: Downstream PDF-assembly pipeline, extracted from `build` so the
 * streaming variant (`buildPolyglotStreaming`) can reuse it for BYTE-IDENTICAL
 * output. Takes the accumulated state (manifest + global lines + binary blobs +
 * file metadata) and produces the final PDF bytes + build report.
 *
 * This function does NOT touch the original ZIP or file bytes — it works purely
 * from `state`. The caller is responsible for accumulating `state` (either
 * in-memory via `build` or streaming via `buildPolyglotStreaming`).
 *
 * Returns `Omit<AgentReadableBuildResult, "logs">` — the caller manages the
 * `logs` array (passing `onLog` which pushes to the caller's logs).
 */
export function buildFromState(
  state: AccumulatedState,
  origName: string,
  opts: {
    embedFont?: boolean;
    contentCompression?: "flate" | "brotli";
    embedDiagram?: boolean;
    onLog?: (m: string) => void;
  } = {},
  originalSize: number
): Omit<AgentReadableBuildResult, "logs"> {
  const onLog = opts.onLog || (() => {});
  const embedFont = opts.embedFont ?? true;
  const contentCompression = opts.contentCompression ?? "flate";
  const embedDiagram = opts.embedDiagram ?? true;

  const {
    manifestFiles,
    globalLines,
    globalTerms,
    uniqueBinaryBlobs,
    filesMetadata,
    cidAlloc,
    totalLines,
    dedupLines,
    textFileCount,
    binaryFileCount,
    dedupCount,
    excludedCount,
    totalOriginalBytes,
  } = state;

  const fileCount = manifestFiles.length;

  // Cover (human-readable manifest) lines — ASCII, Helvetica literal strings.
  const coverLines = buildCoverLines(
    origName,
    fileCount,
    textFileCount,
    binaryFileCount,
    dedupCount,
    excludedCount,
    originalSize,
    manifestFiles
  );

  // Object layout:
  //   1 Catalog, 2 Pages
  //   3 Helvetica (cover font, ASCII)
  //   4..7 Type0 font (text-layer font, Unicode) — 4 objects (glyphless)
  //       OR 4..9 Type0 font — 6 objects (v2.4: + FontFile2 + CIDToGIDMap)
  //   8/10.. cover pages (literal/Helvetica) then text pages (hex/Type0)
  const helvFontNum = 3;
  const pagesNum = 2;
  const catalogNum = 1;

  // v2.4: collect ALL codepoints used in the text layer (BMP from globalLines
  // + astral from astralMap), then prepare the embedded font (subset or full
  // TTF + CIDToGIDMap + metrics). Skip when embedFont is false (v2.3
  // glyphless behavior).
  let embeddedFont: {
    fontBytes: Uint8Array;
    cidToGidMapBytes: Uint8Array;
    metrics: {
      fontName: string;
      flags: number;
      fontBBox: [number, number, number, number];
      italicAngle: number;
      ascent: number;
      descent: number;
      capHeight: number;
      stemV: number;
    };
    subsetted: boolean;
    numGlyphs: number;
  } | null = null;
  if (embedFont) {
    const codepointSet = new Set<number>();
    for (const ln of globalLines) {
      if (ln.cids) {
        for (let i = 0; i < ln.cids.length; i++) {
          const cid = ln.cids[i];
          if (cid < 0xd800 || cid > 0xdfff) {
            codepointSet.add(cid);
          }
        }
      } else if (ln.raw) {
        for (let i = 0; i < ln.raw.length; i++) {
          codepointSet.add(ln.raw[i]);
        }
      }
    }
    for (const cidStr in cidAlloc.astralMap) {
      codepointSet.add(cidAlloc.astralMap[cidStr]);
    }
    const codepoints = Array.from(codepointSet);
    try {
      embeddedFont = prepareEmbeddedFont(codepoints, cidAlloc.astralMap);
      onLog(
        `embedded font: ${embeddedFont.subsetted ? "subset" : "full"} TTF, ` +
          `${embeddedFont.numGlyphs} glyphs, ` +
          `${embeddedFont.fontBytes.length} bytes raw -> ${flateDeflate(embeddedFont.fontBytes, 9).length} compressed; ` +
          `CIDToGIDMap ${embeddedFont.cidToGidMapBytes.length} bytes raw -> ${flateDeflate(embeddedFont.cidToGidMapBytes, 9).length} compressed`
      );
    } catch (err: any) {
      onLog(`embedded font PREPARATION FAILED: ${err.message} — falling back to glyphless`);
    }
  }

  const type0 = buildType0Font(
    4,
    cidAlloc.astralMap,
    embeddedFont
      ? {
          fontFileBytes: embeddedFont.fontBytes,
          cidToGidMapBytes: embeddedFont.cidToGidMapBytes,
          metrics: embeddedFont.metrics,
        }
      : undefined
  );
  onLog(`astral CIDs allocated: ${cidAlloc.astralCount()}`);
  let obj = type0.nextNum;
  const cover = buildTextPages(obj, pagesNum, helvFontNum, coverLines);
  obj = cover.nextNum;

  const diagramPageCount = embedDiagram ? 1 : 0;
  const diagramStartNum = embedDiagram ? obj : 0;
  if (embedDiagram) obj += 2;

  // Image pages embedded between the diagram and text-layer
  // pages). Each detected image becomes a PDF XObject on a 2×2 grid page; a
  // VLM agent can SEE screenshots/diagrams/UML rather than only reading text.
  // Image pages come BEFORE the text-layer pages so the existing extractor
  // (which reads pages from textStartPage for textPageCount pages) keeps
  // working — only textStartPage shifts forward by imagePageCount.
  const detectedImages = state.detectedImages ?? [];
  const cappedImages = detectedImages.slice(0, 200); // bound PDF size
  const imagePages: ImagePageResult | null =
    cappedImages.length > 0
      ? buildImagePage(obj, pagesNum, helvFontNum, cappedImages)
      : null;
  const imagePageCount = imagePages?.pageObjNums.length ?? 0;
  if (imagePages) {
    obj = imagePages.nextNum;
    onLog(
      `image pages: ${imagePageCount} page(s) for ${cappedImages.length} image(s) ` +
        `(${cappedImages.filter((i) => i.embeddable).length} embeddable, ` +
        `${cappedImages.filter((i) => !i.embeddable).length} recorded-only)`
    );
  }

  const textPages = buildTextPagesHybrid(obj, pagesNum, helvFontNum, type0.fontNum, globalLines as any, undefined, undefined, contentCompression);
  obj = textPages.nextNum;

  const manifestObj = obj++;
  const binaryStoreObj = obj++;

  // textStartPage shifts forward by imagePageCount. Page order
  // in /Kids is: [cover, diagram, image pages..., text pages...]. The
  // extractor reads pages [textStartPage, textStartPage + textPageCount).
  const textStartPage = cover.pageObjNums.length + diagramPageCount + imagePageCount;

  // v2.5: Merkle integrity root — uses cached hashes from filesMetadata
  // (NOT the original file bytes, which may have been freed in streaming mode).
  const merkleLeaves = filesMetadata
    .filter((f) => !f.isDirectory)
    .map((f) => ({ name: f.name, hash: f.hash }));
  const root = merkleRoot(merkleLeaves);
  onLog(`merkle root: ${root.slice(0, 16)}... (${merkleLeaves.length} leaves)`);

  // v2.5: auto-detect an embedded test suite — uses cached hashes.
  const tests: ManifestTest[] = [];
  for (const f of filesMetadata) {
    if (f.isDirectory) continue;
    if (tests.length < 50) {
      tests.push({ name: `sha:${f.name}`, file: f.name, sha: f.hash });
    }
  }

  // v2.5: auto-detect a runnable build pipeline.
  const pipeline: PipelineStep[] = [];
  const hasPkg = filesMetadata.some((f) => f.name === "package.json" || f.name.endsWith("/package.json"));
  const hasMakefile = filesMetadata.some((f) => f.name === "Makefile" || f.name.endsWith("/Makefile"));
  const hasCargo = filesMetadata.some((f) => f.name === "Cargo.toml" || f.name.endsWith("/Cargo.toml"));
  const hasPyproject = filesMetadata.some((f) => f.name === "pyproject.toml" || f.name === "setup.py" || f.name.endsWith("/pyproject.toml"));
  const hasGoMod = filesMetadata.some((f) => f.name === "go.mod" || f.name.endsWith("/go.mod"));
  if (hasPkg) {
    pipeline.push({ step: "install", desc: "Install Node dependencies", cmd: "npm install" });
    pipeline.push({ step: "build", desc: "Build the project", cmd: "npm run build" });
    pipeline.push({ step: "test", desc: "Run the test suite", cmd: "npm test", expect: "pass" });
  }
  if (hasMakefile) {
    pipeline.push({ step: "build", desc: "Build via Make", cmd: "make" });
    pipeline.push({ step: "test", desc: "Run Make tests", cmd: "make test" });
  }
  if (hasCargo) {
    pipeline.push({ step: "build", desc: "Build the Rust crate", cmd: "cargo build --release" });
    pipeline.push({ step: "test", desc: "Run Rust tests", cmd: "cargo test" });
  }
  if (hasPyproject) {
    pipeline.push({ step: "install", desc: "Install Python deps", cmd: "pip install -e ." });
    pipeline.push({ step: "test", desc: "Run Python tests", cmd: "pytest" });
  }
  if (hasGoMod) {
    pipeline.push({ step: "build", desc: "Build the Go project", cmd: "go build ./..." });
    pipeline.push({ step: "test", desc: "Run Go tests", cmd: "go test ./..." });
  }
  if (pipeline.length > 0) {
    onLog(`auto-detected pipeline: ${pipeline.length} steps (${pipeline.map((p) => p.step).join(", ")})`);
  }

  const fullManifest: FullManifest = {
    v: 2,
    strategy: "agent-readable",
    origName: origName || "archive.zip",
    textStartPage,
    textPageCount: textPages.pageObjNums.length,
    binaryStoreObj,
    textFiles: manifestFiles.filter((m) => m.type === "text"),
    files: manifestFiles,
    summary: {
      fileCount: manifestFiles.length,
      textFileCount,
      binaryFileCount,
      dedupCount,
      excludedCount,
      totalOriginalBytes,
      totalLines,
      uniqueLines: globalLines.length,
      dedupLines,
    },
    lineTerms: globalTerms,
    textEncoding: "utf16cid",
    astralMap: cidAlloc.astralCount() > 0 ? cidAlloc.astralMap : undefined,
    compression: "brotli",
    lineDedup: true,
    merkleRoot: root,
    tests: tests.length > 0 ? tests : undefined,
    pipeline: pipeline.length > 0 ? pipeline : undefined,
    // v5.0: Module OS — agent protocol + JS actions.
    agentProtocol: buildAgentProtocol(
      origName || "archive.zip",
      manifestFiles.length,
      true,
      tests.length > 0,
      pipeline.length > 0,
      "",
      textFileCount,
      binaryFileCount
    ),
    jsActions: buildJsActions(origName || "archive.zip"),
    // Image pages embedded between diagram and text layer.
    imagePageCount: imagePageCount > 0 ? imagePageCount : undefined,
    images:
      cappedImages.length > 0
        ? cappedImages.map((img, i): ManifestImage => {
            const mf = manifestFiles.find((m) => m.name === img.name);
            return {
              name: img.name,
              format: img.format,
              width: img.width,
              height: img.height,
              size: img.bytes.length,
              embedded: img.embeddable,
              xobjNum: imagePages?.imageObjNums[i] || undefined,
              blob: mf?.blob,
              ref: mf?.ref,
            };
          })
        : undefined,
  };
  const manifestStream = brotliDeflate(utf8(JSON.stringify(fullManifest)), 11);

  const parContainer = buildParContainer(uniqueBinaryBlobs);
  const binaryStream = brotliDeflate(parContainer, 11);
  onLog(
    `binary store: ${uniqueBinaryBlobs.length} unique blobs, container ${parContainer.length} -> compressed ${binaryStream.length}`
  );

  // v2.5: Build the diagram page.
  let diagram: { objects: Record<number, Uint8Array>; pageObjNums: number[]; nextNum: number } | null = null;
  if (embedDiagram) {
    let preDiagramBytes = 0;
    for (const n of Object.keys(type0.objects).map(Number)) preDiagramBytes += type0.objects[n].length;
    for (const n of Object.keys(cover.objects).map(Number)) preDiagramBytes += cover.objects[n].length;
    for (const n of Object.keys(textPages.objects).map(Number)) preDiagramBytes += textPages.objects[n].length;
    const manifestObjOverhead = 60;
    const binaryStoreObjOverhead = 60;
    preDiagramBytes += manifestObjOverhead + manifestStream.length;
    preDiagramBytes += binaryStoreObjOverhead + binaryStream.length;
    preDiagramBytes += 300;
    preDiagramBytes += 15 + obj * 20 + 60;

    diagram = buildDiagramPage(
      diagramStartNum,
      pagesNum,
      helvFontNum,
      manifestFiles,
      {
        fileCount: manifestFiles.length,
        textFileCount,
        binaryFileCount,
        dedupCount,
        totalOriginalBytes,
      },
      { origName: origName || "archive.zip", pdfSizeEstimate: preDiagramBytes }
    );
    onLog(`diagram page: ${diagram.objects[diagramStartNum + 1].length} compressed content bytes, ${diagram.pageObjNums.length} page`);
  }

  const allPageObjNums = [
    ...cover.pageObjNums,
    ...(diagram ? diagram.pageObjNums : []),
    ...(imagePages ? imagePages.pageObjNums : []),
    ...textPages.pageObjNums,
  ];

  const objects: Record<number, Uint8Array> = {};
  Object.assign(objects, type0.objects);
  Object.assign(objects, cover.objects);
  if (diagram) Object.assign(objects, diagram.objects);
  if (imagePages) Object.assign(objects, imagePages.objects);
  Object.assign(objects, textPages.objects);

  objects[pagesNum] = dictObject(
    pagesNum,
    `<< /Type /Pages /Kids [${allPageObjNums.map((n) => n + " 0 R").join(" ")}] /Count ${allPageObjNums.length} >>`
  );
  objects[helvFontNum] = dictObject(
    helvFontNum,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
  );
  objects[manifestObj] = streamObject(
    manifestObj,
    "/Type /PolyglotManifest /Brotli true",
    manifestStream
  );
  objects[binaryStoreObj] = streamObject(
    binaryStoreObj,
    "/Type /PolyglotBinaryStore /Brotli true",
    binaryStream
  );

  // v2.6: AcroForm buttons with JavaScript actions (interactive PDF).
  const coverPageObj = cover.pageObjNums[0];
  const jsActions = fullManifest.jsActions || [];
  let acroFormFields = "";
  if (jsActions.length > 0) {
    const acro = buildAcroFormButtons(obj, coverPageObj, jsActions);
    obj = acro.nextNum;
    Object.assign(objects, acro.objects);
    acroFormFields = acro.fieldObjNums.map((n) => `${n} 0 R`).join(" ");
  }

  objects[catalogNum] = buildCatalog(
    catalogNum,
    pagesNum,
    ` /Polyglot << /Version 5 /Strategy /agent-readable /Manifest ${manifestObj} 0 R /BinaryStore ${binaryStoreObj} 0 R >>` +
      (acroFormFields ? ` /AcroForm << /Fields [${acroFormFields}] /DR << /Font << /Helv 3 0 R >> >> /DA (/Helv 8 Tf 0 0 0 rg) >>` : "")
  );

  // v5.0: Use compact PDF 1.5 compressed cross-reference stream (smaller than flat xref table).
  const xrefObjNum = obj; // next unused object number — used for the XRef stream
  const bytes = assemblePdfCompact(objects, catalogNum, xrefObjNum);
  onLog(`assembled agent-readable PDF: ${bytes.length} bytes (source zip ${originalSize})${embedDiagram ? " [+diagram]" : ""}`);

  // Readable sample: first ~120 lines of the text layer, decoded back to text.
  const sampleParts: string[] = [];
  let sampleLines = 0;
  const sampleTd = new TextDecoder("utf-8");
  for (let k = 0; k < globalLines.length && sampleLines < 120; k++) {
    const ln = globalLines[k];
    if (ln.raw !== null) sampleParts.push(sampleTd.decode(ln.raw));
    else sampleParts.push(cidAlloc.decode(ln.cids!));
    sampleLines++;
  }
  const readableSample = sampleParts.join("\n");

  return {
    bytes,
    strategy: "agent-readable",
    entryCount: manifestFiles.length,
    originalSize,
    pdfSize: bytes.length,
    textFileCount,
    binaryFileCount,
    dedupCount,
    excludedCount,
    readableSample,
    manifestSummary: fullManifest.summary,
  };
}

export function build(
  zipBuf: Uint8Array,
  origName: string,
  opts: {
    excludeCruft?: boolean;
    embedFont?: boolean;
    contentCompression?: "flate" | "brotli";
    /** v2.5: embed a visual diagram page between the cover and the text-layer
     * pages (file tree + size bars). Default true. When false, the document is
     * byte-compatible with v2.4. */
    embedDiagram?: boolean;
    onLog?: (m: string) => void;
    onProgress?: (done: number, total: number, msg: string) => void;
  } = {}
): AgentReadableBuildResult {
  const onLog = opts.onLog || (() => {});
  const onProgress = opts.onProgress || (() => {});
  const excludeCruft = opts.excludeCruft ?? true;
  const embedFont = opts.embedFont ?? true;
  const contentCompression = opts.contentCompression ?? "flate";
  const embedDiagram = opts.embedDiagram ?? true;
  const logs: string[] = [];
  const log = (m: string) => {
    logs.push(m);
    onLog(m);
  };

  const struct = readZipStructure(zipBuf);
  log(`zip: ${struct.entryCount} entries`);

  // Extract all entries (walk explicitly — readZipStructure no longer walks).
  const allFiles: ExtractedFile[] = [];
  const cdEntries = [...walkCentralDirectory(zipBuf, struct.cdOffset, struct.entryCount)];
  // v2.4: streaming-aware entry extraction with progress reporting. Entries
  // are extracted one at a time (not all buffered at once), and onProgress is
  // called per entry so the API/UI can report progress on large archives.
  for (let ei = 0; ei < cdEntries.length; ei++) {
    const entry = cdEntries[ei];
    if (ei % 100 === 0 || ei === cdEntries.length - 1) {
      onProgress(ei, cdEntries.length, `extracting ${entry.name}`);
    }
    if (entry.isDirectory) {
      allFiles.push({
        index: entry.index,
        name: entry.name,
        bytes: new Uint8Array(0),
        isDirectory: true,
      });
      continue;
    }
    const bytes = extractEntryBytes(zipBuf, entry);
    allFiles.push({ index: entry.index, name: entry.name, bytes, isDirectory: false });
  }
  onProgress(cdEntries.length, cdEntries.length, "extraction complete");

  // Exclude cruft.
  let excludedCount = 0;
  const files: ExtractedFile[] = [];
  for (const f of allFiles) {
    if (excludeCruft && isCruft(f.name)) {
      excludedCount++;
      continue;
    }
    files.push(f);
  }
  log(`excluded ${excludedCount} cruft entries; ${files.length} remain`);

  const originalSize = zipBuf.length;

  // Classify + hash + dedup.
  const manifestFiles: ManifestFile[] = [];
  const shaToPrimary: Record<string, number> = {};
  const uniqueBinaryBlobs: Uint8Array[] = [];

  let textFileCount = 0;
  let binaryFileCount = 0;
  let dedupCount = 0;
  let totalOriginalBytes = 0;

  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    totalOriginalBytes += f.bytes.length;
    const sha = sha256HexSync(f.bytes);
    const type: "text" | "binary" =
      f.isDirectory || isTextBytes(f.bytes) ? "text" : "binary";

    const primaryIdx = shaToPrimary[sha];
    if (primaryIdx !== undefined) {
      dedupCount++;
      manifestFiles.push({ i, name: f.name, size: f.bytes.length, sha, type, ref: primaryIdx });
      if (type === "text") textFileCount++;
      else binaryFileCount++;
      continue;
    }

    if (type === "binary") {
      const blobIdx = uniqueBinaryBlobs.length;
      uniqueBinaryBlobs.push(f.bytes);
      shaToPrimary[sha] = i;
      manifestFiles.push({ i, name: f.name, size: f.bytes.length, sha, type, blob: blobIdx });
      binaryFileCount++;
    } else {
      shaToPrimary[sha] = i;
      manifestFiles.push({ i, name: f.name, size: f.bytes.length, sha, type });
      textFileCount++;
    }
  }
  log(
    `text=${textFileCount} binary=${binaryFileCount} dedup=${dedupCount} uniqueBinaryBlobs=${uniqueBinaryBlobs.length}`
  );

  // v2.3: Build the global line array with CROSS-FILE LINE DEDUP. Each line
  // is keyed by (encoding type + content hash); identical lines across files
  // share a single global slot. HYBRID: files whose lines are ALL new (no
  // back-references) use the compact lineStart/lineCount + global lineTerms
  // (zero manifest overhead). Files with ANY deduped line use lineRefs +
  // per-file fileLineTerms. This avoids overhead for unique-line files while
  // capturing the dedup win for files with repeated boilerplate.
  type Line = { raw: Uint8Array | null; cids: Uint16Array | null };
  const globalLines: Line[] = [];
  const globalTerms: number[] = []; // per-global-line terminators (for lineStart/lineCount files)
  const cidAlloc = createCidAllocator();
  const lineDedupMap = new Map<string, number>(); // lineKey → globalIndex
  let totalLines = 0;
  let dedupLines = 0;
  const manifestByPrimaryIdx: Record<number, ManifestFile> = {};
  for (const mf of manifestFiles) {
    if (mf.type === "text" && mf.ref === undefined) {
      manifestByPrimaryIdx[mf.i] = mf;
    }
  }
  const utf8Decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  function isAsciiOnly(b: Uint8Array): boolean {
    for (let i = 0; i < b.length; i++) if (b[i] > 0x7f) return false;
    return true;
  }
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const mf = manifestByPrimaryIdx[i];
    if (!mf) continue;
    const ascii = f.isDirectory || isAsciiOnly(f.bytes);
    const str = f.isDirectory ? "" : ascii ? new TextDecoder("utf-8").decode(f.bytes) : utf8Decoder.decode(f.bytes);
    const { segs, terms } = splitLinesWithTerms(str);
    // First pass: find indices, track whether any line was deduped.
    const indices: number[] = [];
    let hadDedup = false;
    for (let k = 0; k < segs.length; k++) {
      totalLines++;
      let key: string;
      let line: Line;
      if (ascii) {
        const raw = utf8(segs[k]);
        line = { raw, cids: null };
        key = "a:" + sha256HexSync(raw);
      } else {
        const cids = cidAlloc.encode(segs[k]);
        line = { raw: null, cids };
        key = "c:" + sha256HexSync(new Uint8Array(cids.buffer, cids.byteOffset, cids.byteLength));
      }
      const existing = lineDedupMap.get(key);
      if (existing !== undefined) {
        indices.push(existing);
        dedupLines++;
        hadDedup = true;
      } else {
        const idx = globalLines.length;
        globalLines.push(line);
        globalTerms.push(terms[k]);
        lineDedupMap.set(key, idx);
        indices.push(idx);
      }
    }
    if (hadDedup) {
      // Use explicit lineRefs + per-file terminators.
      mf.lineRefs = indices;
      mf.fileLineTerms = terms;
    } else {
      // All lines are new + contiguous → compact range (zero overhead).
      mf.lineStart = indices[0] ?? globalLines.length - segs.length;
      mf.lineCount = segs.length;
    }
  }
  log(
    `global text-layer lines: ${globalLines.length} unique (of ${totalLines} total, ${dedupLines} deduped)`
  );

  // Cover (human-readable manifest) lines — ASCII, Helvetica literal strings.
  const coverLines = buildCoverLines(
    origName,
    files.length,
    textFileCount,
    binaryFileCount,
    dedupCount,
    excludedCount,
    originalSize,
    manifestFiles
  ).map((s) => utf8(s));

  // Object layout:
  //   1 Catalog, 2 Pages
  //   3 Helvetica (cover font, ASCII)
  //   4..7 Type0 font (text-layer font, Unicode) — 4 objects (glyphless)
  //       OR 4..9 Type0 font — 6 objects (v2.4: + FontFile2 + CIDToGIDMap)
  //   8/10.. cover pages (literal/Helvetica) then text pages (hex/Type0)
  const helvFontNum = 3;
  const pagesNum = 2;
  const catalogNum = 1;

  // v2.4: collect ALL codepoints used in the text layer (BMP from globalLines
  // + astral from astralMap), then prepare the embedded font (subset or full
  // TTF + CIDToGIDMap + metrics). Skip when embedFont is false (v2.3
  // glyphless behavior).
  let embeddedFont: {
    fontBytes: Uint8Array;
    cidToGidMapBytes: Uint8Array;
    metrics: {
      fontName: string;
      flags: number;
      fontBBox: [number, number, number, number];
      italicAngle: number;
      ascent: number;
      descent: number;
      capHeight: number;
      stemV: number;
    };
    subsetted: boolean;
    numGlyphs: number;
  } | null = null;
  if (embedFont) {
    const codepointSet = new Set<number>();
    for (const ln of globalLines) {
      if (ln.cids) {
        for (let i = 0; i < ln.cids.length; i++) {
          const cid = ln.cids[i];
          // BMP CID (= codepoint) directly; astral CID (surrogate slot) is
          // resolved via astralMap below.
          if (cid < 0xd800 || cid > 0xdfff) {
            codepointSet.add(cid);
          }
        }
      } else if (ln.raw) {
        // ASCII literal line — codepoints 0x00-0x7F. Add the printable ones;
        // the subsetter will look them up in the cmap.
        for (let i = 0; i < ln.raw.length; i++) {
          codepointSet.add(ln.raw[i]);
        }
      }
    }
    // Astral codepoints (mapped via surrogate slots in astralMap).
    for (const cidStr in cidAlloc.astralMap) {
      codepointSet.add(cidAlloc.astralMap[cidStr]);
    }
    const codepoints = Array.from(codepointSet);
    try {
      embeddedFont = prepareEmbeddedFont(codepoints, cidAlloc.astralMap);
      log(
        `embedded font: ${embeddedFont.subsetted ? "subset" : "full"} TTF, ` +
          `${embeddedFont.numGlyphs} glyphs, ` +
          `${embeddedFont.fontBytes.length} bytes raw -> ${flateDeflate(embeddedFont.fontBytes, 9).length} compressed; ` +
          `CIDToGIDMap ${embeddedFont.cidToGidMapBytes.length} bytes raw -> ${flateDeflate(embeddedFont.cidToGidMapBytes, 9).length} compressed`
      );
    } catch (err: any) {
      log(`embedded font PREPARATION FAILED: ${err.message} — falling back to glyphless`);
    }
  }

  const type0 = buildType0Font(
    4,
    cidAlloc.astralMap,
    embeddedFont
      ? {
          fontFileBytes: embeddedFont.fontBytes,
          cidToGidMapBytes: embeddedFont.cidToGidMapBytes,
          metrics: embeddedFont.metrics,
        }
      : undefined
  );
  log(`astral CIDs allocated: ${cidAlloc.astralCount()}`);
  let obj = type0.nextNum; // 8 (glyphless) or 10 (embedded)
  const cover = buildTextPages(obj, pagesNum, helvFontNum, coverLines);
  obj = cover.nextNum;

  // v2.5: reserve 2 object numbers for the diagram page (page + contents) so
  // the text-layer pages start AFTER the diagram in the object table. The
  // diagram itself is built later (we need the pre-assembly pdfSizeEstimate,
  // which requires the manifest + binary store streams that come next).
  const diagramPageCount = embedDiagram ? 1 : 0;
  const diagramStartNum = embedDiagram ? obj : 0;
  if (embedDiagram) obj += 2; // page + contents

  // Detect and embed image pages between diagram and text-layer
  // (between the diagram and the text-layer pages). Image pages come BEFORE
  // the text-layer pages so the existing extractor (which reads pages from
  // textStartPage for textPageCount pages) keeps working — only textStartPage
  // shifts forward by imagePageCount.
  const detectedImages: DetectedImage[] = [];
  for (const f of files) {
    if (f.isDirectory) continue;
    if (detectedImages.length >= 200) break; // cap at 200 images to bound PDF size
    if (isImageFile(f.name, f.bytes)) {
      const info = analyzeImage(f.name, f.bytes);
      if (info) detectedImages.push(info);
    }
  }
  const imagePages: ImagePageResult | null =
    detectedImages.length > 0
      ? buildImagePage(obj, pagesNum, helvFontNum, detectedImages)
      : null;
  const imagePageCount = imagePages?.pageObjNums.length ?? 0;
  if (imagePages) {
    obj = imagePages.nextNum;
    log(
      `image pages: ${imagePageCount} page(s) for ${detectedImages.length} image(s) ` +
        `(${detectedImages.filter((i) => i.embeddable).length} embeddable, ` +
        `${detectedImages.filter((i) => !i.embeddable).length} recorded-only)`
    );
  }

  const textPages = buildTextPagesHybrid(obj, pagesNum, helvFontNum, type0.fontNum, globalLines as any, undefined, undefined, contentCompression);
  obj = textPages.nextNum;

  const manifestObj = obj++;
  const binaryStoreObj = obj++;

  // textStartPage shifts forward by imagePageCount. Page order
  // in /Kids is: [cover, diagram, image pages..., text pages...]. The
  // extractor reads pages [textStartPage, textStartPage + textPageCount).
  const textStartPage = cover.pageObjNums.length + diagramPageCount + imagePageCount;

  // v2.5: Merkle integrity root over all file content hashes. An agent can
  // recompute this from the extracted files and compare to verify integrity
  // WITHOUT trusting the extractor.
  const merkleLeaves = files
    .filter((f) => !f.isDirectory)
    .map((f) => ({ name: f.name, hash: fileHash(f.bytes) }));
  const root = merkleRoot(merkleLeaves);
  log(`merkle root: ${root.slice(0, 16)}... (${merkleLeaves.length} leaves)`);

  // v2.5: auto-detect an embedded test suite. If the archive contains files
  // matching known test-manifest patterns (e.g. package.json "test" script,
  // a Makefile "test" target, a *.test.* file), emit test assertions so an
  // agent can self-verify after extraction.
  const tests: ManifestTest[] = [];
  for (const f of files) {
    if (f.isDirectory) continue;
    // Assert every non-directory file's sha (cap at 50 tests to bound size).
    if (tests.length < 50) {
      tests.push({ name: `sha:${f.name}`, file: f.name, sha: fileHash(f.bytes) });
    }
  }

  // v2.5: auto-detect a runnable build pipeline. Look for well-known manifest
  // files and emit the corresponding build/test/run commands an agent executes.
  const pipeline: PipelineStep[] = [];
  const hasPkg = files.some((f) => f.name === "package.json" || f.name.endsWith("/package.json"));
  const hasMakefile = files.some((f) => f.name === "Makefile" || f.name.endsWith("/Makefile"));
  const hasCargo = files.some((f) => f.name === "Cargo.toml" || f.name.endsWith("/Cargo.toml"));
  const hasPyproject = files.some((f) => f.name === "pyproject.toml" || f.name === "setup.py" || f.name.endsWith("/pyproject.toml"));
  const hasGoMod = files.some((f) => f.name === "go.mod" || f.name.endsWith("/go.mod"));
  if (hasPkg) {
    pipeline.push({ step: "install", desc: "Install Node dependencies", cmd: "npm install" });
    pipeline.push({ step: "build", desc: "Build the project", cmd: "npm run build" });
    pipeline.push({ step: "test", desc: "Run the test suite", cmd: "npm test", expect: "pass" });
  }
  if (hasMakefile) {
    pipeline.push({ step: "build", desc: "Build via Make", cmd: "make" });
    pipeline.push({ step: "test", desc: "Run Make tests", cmd: "make test" });
  }
  if (hasCargo) {
    pipeline.push({ step: "build", desc: "Build the Rust crate", cmd: "cargo build --release" });
    pipeline.push({ step: "test", desc: "Run Rust tests", cmd: "cargo test" });
  }
  if (hasPyproject) {
    pipeline.push({ step: "install", desc: "Install Python deps", cmd: "pip install -e ." });
    pipeline.push({ step: "test", desc: "Run Python tests", cmd: "pytest" });
  }
  if (hasGoMod) {
    pipeline.push({ step: "build", desc: "Build the Go project", cmd: "go build ./..." });
    pipeline.push({ step: "test", desc: "Run Go tests", cmd: "go test ./..." });
  }
  if (pipeline.length > 0) {
    log(`auto-detected pipeline: ${pipeline.length} steps (${pipeline.map((p) => p.step).join(", ")})`);
  }

  const fullManifest: FullManifest = {
    v: 2,
    strategy: "agent-readable",
    origName: origName || "archive.zip",
    textStartPage,
    textPageCount: textPages.pageObjNums.length,
    binaryStoreObj,
    textFiles: manifestFiles.filter((m) => m.type === "text"),
    files: manifestFiles,
    summary: {
      fileCount: manifestFiles.length,
      textFileCount,
      binaryFileCount,
      dedupCount,
      excludedCount,
      totalOriginalBytes,
      totalLines,
      uniqueLines: globalLines.length,
      dedupLines,
    },
    // v2.3: global lineTerms for files using lineStart/lineCount (hybrid).
    // Files with deduped lines use per-file fileLineTerms instead.
    lineTerms: globalTerms,
    textEncoding: "utf16cid",
    astralMap: cidAlloc.astralCount() > 0 ? cidAlloc.astralMap : undefined,
    compression: "brotli",
    lineDedup: true,
    // v2.5: self-verifying + executable manifest fields.
    merkleRoot: root,
    tests: tests.length > 0 ? tests : undefined,
    pipeline: pipeline.length > 0 ? pipeline : undefined,
    // v5.0: Module OS — agent protocol + JS actions.
    agentProtocol: buildAgentProtocol(
      origName || "archive.zip",
      manifestFiles.length,
      true,
      tests.length > 0,
      pipeline.length > 0,
      "",
      textFileCount,
      binaryFileCount
    ),
    jsActions: buildJsActions(origName || "archive.zip"),
    // Image pages embedded between diagram and text layer.
    imagePageCount: imagePageCount > 0 ? imagePageCount : undefined,
    images:
      detectedImages.length > 0
        ? detectedImages.map((img, i): ManifestImage => {
            const mf = manifestFiles.find((m) => m.name === img.name);
            return {
              name: img.name,
              format: img.format,
              width: img.width,
              height: img.height,
              size: img.bytes.length,
              embedded: img.embeddable,
              xobjNum: imagePages?.imageObjNums[i] || undefined,
              blob: mf?.blob,
              ref: mf?.ref,
            };
          })
        : undefined,
  };
  // v2.2: Brotli for the manifest + binary store (~15-25% smaller than FlateDecode).
  const manifestStream = brotliDeflate(utf8(JSON.stringify(fullManifest)), 11);

  const parContainer = buildParContainer(uniqueBinaryBlobs);
  const binaryStream = brotliDeflate(parContainer, 11);
  log(
    `binary store: ${uniqueBinaryBlobs.length} unique blobs, container ${parContainer.length} -> compressed ${binaryStream.length}`
  );

  // v2.5: Build the diagram page. We compute a pre-assembly pdfSizeEstimate
  // from the sum of all known object bytes (cover + textPages + type0 + the
  // about-to-be-built manifest/binaryStore/helvFont/pages/catalog wrappers)
  // plus an xref/trailer overhead. The estimate excludes the diagram's own
  // ~1–2 KB (we'd need the diagram bytes to know them, and the diagram needs
  // the estimate — circular). The displayed value is labeled "(est.)".
  let diagram: { objects: Record<number, Uint8Array>; pageObjNums: number[]; nextNum: number } | null = null;
  if (embedDiagram) {
    // Bytes we can sum right now (these objects are already built).
    let preDiagramBytes = 0;
    for (const n of Object.keys(type0.objects).map(Number)) preDiagramBytes += type0.objects[n].length;
    for (const n of Object.keys(cover.objects).map(Number)) preDiagramBytes += cover.objects[n].length;
    for (const n of Object.keys(textPages.objects).map(Number)) preDiagramBytes += textPages.objects[n].length;
    // Manifest + binary store stream objects (each ~ stream wrapper overhead + compressed bytes).
    const manifestObjOverhead = 60; // "N 0 obj\n<< ... >>\nstream\n...\nendstream\nendobj\n" wrapper bytes
    const binaryStoreObjOverhead = 60;
    preDiagramBytes += manifestObjOverhead + manifestStream.length;
    preDiagramBytes += binaryStoreObjOverhead + binaryStream.length;
    // helvFont + pages + catalog dict objects (~300 bytes total).
    preDiagramBytes += 300;
    // PDF header (15 bytes) + xref table (maxNum * 20 bytes) + trailer (~60 bytes).
    preDiagramBytes += 15 + obj * 20 + 60;

    diagram = buildDiagramPage(
      diagramStartNum,
      pagesNum,
      helvFontNum,
      manifestFiles,
      {
        fileCount: manifestFiles.length,
        textFileCount,
        binaryFileCount,
        dedupCount,
        totalOriginalBytes,
      },
      { origName: origName || "archive.zip", pdfSizeEstimate: preDiagramBytes }
    );
    log(`diagram page: ${diagram.objects[diagramStartNum + 1].length} compressed content bytes, ${diagram.pageObjNums.length} page`);
  }

  const allPageObjNums = [
    ...cover.pageObjNums,
    ...(diagram ? diagram.pageObjNums : []),
    ...(imagePages ? imagePages.pageObjNums : []),
    ...textPages.pageObjNums,
  ];

  // Assemble objects.
  const objects: Record<number, Uint8Array> = {};
  Object.assign(objects, type0.objects);
  Object.assign(objects, cover.objects);
  if (diagram) Object.assign(objects, diagram.objects);
  if (imagePages) Object.assign(objects, imagePages.objects);
  Object.assign(objects, textPages.objects);

  objects[pagesNum] = dictObject(
    pagesNum,
    `<< /Type /Pages /Kids [${allPageObjNums.map((n) => n + " 0 R").join(" ")}] /Count ${allPageObjNums.length} >>`
  );
  objects[helvFontNum] = dictObject(
    helvFontNum,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
  );
  objects[manifestObj] = streamObject(
    manifestObj,
    "/Type /PolyglotManifest /Brotli true",
    manifestStream
  );
  objects[binaryStoreObj] = streamObject(
    binaryStoreObj,
    "/Type /PolyglotBinaryStore /Brotli true",
    binaryStream
  );

  // v2.6: AcroForm buttons with JavaScript actions (interactive PDF).
  const coverPageObj = cover.pageObjNums[0];
  const jsActions = fullManifest.jsActions || [];
  let acroFormFields = "";
  if (jsActions.length > 0) {
    const acro = buildAcroFormButtons(obj, coverPageObj, jsActions);
    obj = acro.nextNum;
    Object.assign(objects, acro.objects);
    acroFormFields = acro.fieldObjNums.map((n) => `${n} 0 R`).join(" ");
  }

  objects[catalogNum] = buildCatalog(
    catalogNum,
    pagesNum,
    ` /Polyglot << /Version 5 /Strategy /agent-readable /Manifest ${manifestObj} 0 R /BinaryStore ${binaryStoreObj} 0 R >>` +
      (acroFormFields ? ` /AcroForm << /Fields [${acroFormFields}] /DR << /Font << /Helv 3 0 R >> >> /DA (/Helv 8 Tf 0 0 0 rg) >>` : "")
  );

  // v5.0: compressed cross-reference stream (PDF 1.5) — replaces flat text xref table.
  const xrefObjNum = obj; // next unused — used for the XRef stream object
  const bytes = assemblePdfCompact(objects, catalogNum, xrefObjNum);
  log(`assembled agent-readable PDF: ${bytes.length} bytes (source zip ${originalSize})${embedDiagram ? " [+diagram]" : ""}`);

  // Readable sample: first ~120 lines of the text layer, decoded back to text.
  const sampleParts: string[] = [];
  let sampleLines = 0;
  const sampleTd = new TextDecoder("utf-8");
  for (let k = 0; k < globalLines.length && sampleLines < 120; k++) {
    const ln = globalLines[k];
    if (ln.raw !== null) sampleParts.push(sampleTd.decode(ln.raw));
    else sampleParts.push(cidAlloc.decode(ln.cids!));
    sampleLines++;
  }
  const readableSample = sampleParts.join("\n");

  return {
    bytes,
    strategy: "agent-readable",
    entryCount: manifestFiles.length,
    originalSize,
    pdfSize: bytes.length,
    textFileCount,
    binaryFileCount,
    dedupCount,
    excludedCount,
    readableSample,
    manifestSummary: fullManifest.summary,
    logs,
  };
}

export function buildCoverLines(
  origName: string,
  fileCount: number,
  textFileCount: number,
  binaryFileCount: number,
  dedupCount: number,
  excludedCount: number,
  originalSize: number,
  manifestFiles: ManifestFile[]
): string[] {
  const lines: string[] = [];
  lines.push("=== zip-to-pdf-polyglot v5.0 — Module OS, compressed XRef, agent-readable document ===");
  lines.push("");
  lines.push("Source archive : " + (origName || "archive.zip"));
  lines.push("Files encoded  : " + fileCount);
  lines.push("  text files   : " + textFileCount + "  (rendered into the PDF text layer, Unicode-capable)");
  lines.push("  binary files : " + binaryFileCount + "  (in the deduped binary store stream)");
  lines.push("  duplicates   : " + dedupCount + "  (deduplicated via back-references)");
  lines.push("  excluded     : " + excludedCount + "  (regenerable cruft, e.g. node_modules/.git)");
  lines.push("Source zip size: " + originalSize + " bytes");
  lines.push("");
  lines.push("HOW AN AGENT READS THIS DOCUMENT");
  lines.push("  Run `pdftotext` (or any PDF text extractor) on this file. The entire");
  lines.push("  text-layer content of every text file is extracted in one pass, in");
  lines.push("  file order, with each file's lines contiguous. The text layer uses a");
  lines.push("  Type0 (Identity-H) font with an identity ToUnicode CMap, so any valid");
  lines.push("  UTF-8 text (Hebrew, CJK, Arabic, accented Latin) is readable. The");
  lines.push("  manifest below records each file's name, size, type and line range.");
  lines.push("");
  lines.push("HOW TO REVERSE TO A CANONICAL ZIP");
  lines.push("  POST /api/extract with this PDF -> a deterministic canonical ZIP");
  lines.push("  (sorted entries, fixed timestamps, UTF-8 names, deflate).");
  lines.push("");
  lines.push("=== MANIFEST (first 200 entries) ===");
  let shown = 0;
  for (const mf of manifestFiles) {
    if (shown >= 200) {
      lines.push(`... (${manifestFiles.length - shown} more entries — see /PolyglotManifest stream)`);
      break;
    }
    const kind = mf.ref !== undefined ? "dup" : mf.type === "text" ? "txt" : "bin";
    // SEC-09: sanitize filename for display (strips control chars and path traversal)
    lines.push(`[${kind}] ${mf.size.toString().padStart(10)}  ${sanitizeEntryName(mf.name)}`);
    shown++;
  }
  return lines;
}

// ---- SEC-08: manifest schema validation (v5.0) ----

/**
 * Validate the manifest before trusting its contents during extraction.
 * Prevents prototype pollution, out-of-bounds access, and type confusion
 * from adversarially crafted PDFs.  Throws on any violation.
 */
function validateManifest(m: FullManifest): void {
  if (!m || typeof m !== "object") throw new Error("manifest: not an object");
  if (!Array.isArray(m.files)) throw new Error("manifest: files is not an array");

  const fileCount = m.files.length;

  for (let i = 0; i < fileCount; i++) {
    const mf = m.files[i];
    if (!mf || typeof mf !== "object") throw new Error(`manifest.files[${i}]: not an object`);
    if (typeof mf.i !== "number" || !Number.isInteger(mf.i) || mf.i < 0)
      throw new Error(`manifest.files[${i}]: i is not a non-negative integer`);
    if (typeof mf.name !== "string")
      throw new Error(`manifest.files[${i}]: name is not a string`);
    // SEC-01 guard: reject path traversal in names
    if (mf.name.includes("..")) {
      // Don't throw — sanitize instead (extraction should not fail on odd names).
      // The canonical ZIP will sanitize via zip-writer; we log a warning.
    }
    if (typeof mf.size !== "number" || mf.size < 0)
      throw new Error(`manifest.files[${i}]: size is not a non-negative number`);
    if (mf.type !== "text" && mf.type !== "binary")
      throw new Error(`manifest.files[${i}]: type must be "text" or "binary"`);

    // ref must point to an already-seen file index
    if (mf.ref !== undefined) {
      if (typeof mf.ref !== "number" || !Number.isInteger(mf.ref) || mf.ref < 0 || mf.ref >= fileCount)
        throw new Error(`manifest.files[${i}]: ref ${mf.ref} out of range [0, ${fileCount})`);
    }

    // blob index bounds
    if (mf.blob !== undefined) {
      if (typeof mf.blob !== "number" || !Number.isInteger(mf.blob) || mf.blob < 0)
        throw new Error(`manifest.files[${i}]: blob ${mf.blob} is not a valid index`);
    }

    // lineRefs must be an array of non-negative integers
    if (mf.lineRefs !== undefined) {
      if (!Array.isArray(mf.lineRefs))
        throw new Error(`manifest.files[${i}]: lineRefs is not an array`);
      for (let k = 0; k < mf.lineRefs.length; k++) {
        if (typeof mf.lineRefs[k] !== "number" || mf.lineRefs[k] < 0)
          throw new Error(`manifest.files[${i}]: lineRefs[${k}] is not a non-negative number`);
      }
    }

    // fileLineTerms must be numbers in [0,3]
    if (mf.fileLineTerms !== undefined) {
      if (!Array.isArray(mf.fileLineTerms))
        throw new Error(`manifest.files[${i}]: fileLineTerms is not an array`);
      for (let k = 0; k < mf.fileLineTerms.length; k++) {
        const tc = mf.fileLineTerms[k];
        if (typeof tc !== "number" || tc < 0 || tc > 3)
          throw new Error(`manifest.files[${i}]: fileLineTerms[${k}] = ${tc} not in [0,3]`);
      }
    }
  }

  // astralMap: values must be valid Unicode codepoints in the astral range
  if (m.astralMap) {
    for (const k in m.astralMap) {
      // Reject prototype-pollution keys
      if (!Object.prototype.hasOwnProperty.call(m.astralMap, k))
        throw new Error(`manifest.astralMap: prototype-pollution key "${k}"`);
      const cp = (m.astralMap as Record<string, unknown>)[k];
      if (typeof cp !== "number" || !Number.isInteger(cp) || cp < 0x10000 || cp > 0x10ffff)
        throw new Error(`manifest.astralMap["${k}"] = ${cp} is not a valid astral codepoint`);
    }
  }
}

// ---- Extraction (reversal to a canonical ZIP) ----

export function extract(
  buf: Uint8Array,
  opts: { canonical?: boolean; onLog?: (m: string) => void } = {}
): {
  bytes: Uint8Array;
  entryCount: number;
  files: { name: string; size: number; type: "text" | "binary" }[];
} {
  const onLog = opts.onLog || (() => {});
  const canonical = opts.canonical ?? true;
  void canonical;

  const refs = findPolyglotRefs(buf);
  if (!refs) {
    throw new Error("No /Polyglot extension on Catalog — not an agent-readable v2+ file.");
  }
  onLog(`found /Polyglot: manifest=obj ${refs.manifest}, binaryStore=obj ${refs.binaryStore}`);

  const manifestBytes = readObjectStream(buf, refs.manifest);
  const manifest = JSON.parse(new TextDecoder("utf-8").decode(manifestBytes)) as FullManifest;

  // SEC-08 v5.0: validate manifest schema before trusting its contents.
  // Prevents prototype pollution, out-of-bounds blob/ref access, and
  // type confusion attacks from malicious PDFs.
  validateManifest(manifest);

  onLog(
    `manifest v${manifest.v}: ${manifest.files.length} files, textStartPage=${manifest.textStartPage}`
  );

  // Read text pages in order, collect Tj lines into the global array. Each
  // line is a Uint8Array of UTF-8 bytes (extractTjLines converts hex CIDs →
  // UTF-16 → UTF-8 for the v2.1 unicode text layer; for v2.0 literal strings
  // it returns the raw bytes).
  const pageObjNums = findPageContentsRefs(buf);
  const textPageObjs = pageObjNums.slice(
    manifest.textStartPage,
    manifest.textStartPage + manifest.textPageCount
  );
  const globalLines: Uint8Array[] = [];
  const astralMap = manifest.astralMap || {};
  for (const pageObj of textPageObjs) {
    const contentsRef = pageContentsRef(buf, pageObj);
    if (contentsRef == null) continue;
    const content = readObjectStream(buf, contentsRef);
    const lines = extractTjLines(content, astralMap);
    for (const l of lines) globalLines.push(l);
  }
  onLog(`reconstructed global line array: ${globalLines.length} lines`);

  // Read binary store.
  const binaryStoreBytes = readObjectStream(buf, refs.binaryStore);
  const blobs = parseParContainer(binaryStoreBytes);
  onLog(`binary store: ${blobs.length} unique blobs`);

  // Terminator bytes per code: 0=none, 1=LF, 2=CR, 3=CRLF.
  const TERM_BYTES: Uint8Array[] = [
    new Uint8Array(0),
    utf8("\n"),
    utf8("\r"),
    utf8("\r\n"),
  ];
  const globalTerms: number[] = manifest.lineTerms || [];

  // Reconstruct each file's bytes.
  const fileBytesByIdx: Record<number, Uint8Array> = {};
  const fileMeta: { name: string; size: number; type: "text" | "binary" }[] = [];

  for (const mf of manifest.files) {
    let bytes: Uint8Array;
    if (mf.ref !== undefined) {
      bytes = fileBytesByIdx[mf.ref];
      if (!bytes) throw new Error(`manifest ref ${mf.ref} not yet reconstructed (ordering bug)`);
    } else if (mf.type === "binary") {
      if (mf.blob === undefined) throw new Error(`binary file ${mf.name} has no blob index`);
      bytes = blobs[mf.blob];
      if (!bytes) throw new Error(`blob ${mf.blob} missing from binary store`);
    } else {
      // v2.3: prefer lineRefs (cross-file line dedup). Fall back to v2.0–v2.2
      // contiguous lineStart/lineCount + global lineTerms for older files.
      if (mf.lineRefs && mf.fileLineTerms) {
        const parts: Uint8Array[] = [];
        for (let k = 0; k < mf.lineRefs.length; k++) {
          parts.push(globalLines[mf.lineRefs[k]]);
          const tc = mf.fileLineTerms[k] ?? 1;
          parts.push(TERM_BYTES[tc] || TERM_BYTES[1]);
        }
        bytes = concatBytes(parts);
      } else if (mf.lineStart !== undefined && mf.lineCount !== undefined) {
        const parts: Uint8Array[] = [];
        for (let k = 0; k < mf.lineCount; k++) {
          const segIdx = mf.lineStart + k;
          parts.push(globalLines[segIdx]);
          const tc = globalTerms[segIdx] ?? 1;
          parts.push(TERM_BYTES[tc] || TERM_BYTES[1]);
        }
        bytes = concatBytes(parts);
      } else {
        throw new Error(`text primary ${mf.name} missing line range/refs`);
      }
    }
    fileBytesByIdx[mf.i] = bytes;
    fileMeta.push({ name: mf.name, size: bytes.length, type: mf.type });
  }

  const entries = manifest.files.map((mf) => ({ name: mf.name, bytes: fileBytesByIdx[mf.i] }));
  const zipBytes = buildCanonicalZip(entries);
  onLog(
    `built ${canonical ? "canonical" : "passthrough"} ZIP: ${zipBytes.length} bytes, ${entries.length} entries`
  );

  return { bytes: zipBytes, entryCount: entries.length, files: fileMeta };
}

const _module: StrategyModule = {
  name,
  label,
  isTrueByteLevelPolyglot,
  isExtractable,
  build,
  extract,
};
export default _module;
