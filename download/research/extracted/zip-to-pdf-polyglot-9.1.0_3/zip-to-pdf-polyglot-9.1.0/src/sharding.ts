// src/lib/polyglot/sharding.ts
//
// v2.6 MULTI-PDF SHARDING for huge codebases (>100MB, >10k files). A single
// agent-readable PDF becomes unwieldy at that scale: too many text-layer pages,
// too-large manifest stream, PDF viewers stall. Sharding splits a large ZIP
// across N smaller PDFs plus a small INDEX PDF that an agent reads first.
//
// Layout:
//   indexPdf  — special agent-readable PDF. Its /PolyglotManifest lists ALL
//               files with a `shard` field (0-based shard index) instead of
//               `lineStart`/`blob`. Its text layer is a human-readable table
//               of contents (file name -> shard number). No codebase text
//               layer; empty binary store. Carries the Merkle root over ALL
//               files (so integrity is verifiable from the index alone).
//   shards[N] — N full standalone agent-readable PDFs (one per shard). Each
//               has its own cover, (optional) diagram, manifest, text layer,
//               and binary store holding its subset of files. Round-trips on
//               its own via extractPolyglot for the subset it carries.
//
// Extract path: read index manifest -> for each file, look up its shard ->
// extract that shard PDF (recovering a per-shard canonical ZIP) -> fetch the
// file's bytes by name -> assemble the full canonical ZIP.
//
// Per-shard dedup is local (a file deduped across shards is stored in each
// shard it appears in — acceptable; cross-shard dedup is a v2.7 target).

import { sha256HexSync, utf8 } from "./bytes";
import { readZipStructure, walkCentralDirectory, extractEntryBytes } from "./zip-reader";
import { buildCanonicalZip } from "./zip-writer";
import { assemblePdf, buildCatalog, buildTextPages, dictObject, streamObject } from "./pdf-writer";
import { findPolyglotRefs, readObjectStream } from "./pdf-reader";
import { brotliDeflate } from "./flate";
import { buildParContainer } from "./par";
import { merkleRoot, fileHash } from "./merkle";
import * as agentReadable from "./strategies/agent-readable";
import type { FullManifest, ManifestFile } from "./types";

// Re-export the text-classification helper so callers can audit the boundary.
export const isTextBytes = agentReadable.isTextBytes;

export interface ShardFile {
  name: string;
  bytes: Uint8Array;
}

export interface ShardedBuildOptions {
  /** Explicit shard count. If set, files are distributed round-robin into N
   * shards (each file goes to shard `i % N`). Useful for predictable parallel
   * extraction. */
  shardCount?: number;
  /** Shard size limits. Used only when shardCount is unset. Defaults:
   *   maxFiles = 500, maxBytes = 20 MB. A new shard is started when EITHER
   *   limit would be exceeded by adding the next file. */
  shardSize?: { maxFiles?: number; maxBytes?: number };
  /** Embed a visual diagram page in each shard PDF. Default false — shards are
   * split for size reasons, and per-shard diagrams add overhead without much
   * value (the index PDF is the overview). */
  embedDiagramInShards?: boolean;
  /** Exclude cruft (node_modules/.git/dist/...) from shards. Default false —
   * sharding is typically for huge archives where the user has already
   * filtered what they want. */
  excludeCruft?: boolean;
  /** Embed a subsetted TTF in each shard PDF so glyphs render visibly. Default
   * true (matches v2.4+ behavior). */
  embedFont?: boolean;
  /** Content-stream compression for shard text layers. Default "flate"
   * (pdftotext-readable). Use "brotli" for smaller shards (NOT pdftotext-
   * readable; agent reads via /api/preview). */
  contentCompression?: "flate" | "brotli";
  onLog?: (msg: string) => void;
}

export interface ShardedBuildResult {
  /** The shard PDFs (one Uint8Array per shard, in shard order). */
  shards: Uint8Array[];
  /** The index PDF. */
  indexPdf: Uint8Array;
  /** Number of shards actually produced (may be less than requested if some
   * shards would be empty). */
  shardCount: number;
  /** Total file count (across all shards). */
  fileCount: number;
  /** Total bytes of all file contents (excludes ZIP/PDF framing). */
  totalOriginalBytes: number;
  /** Merkle root over ALL files (computed from the full set, not per-shard). */
  merkleRoot: string;
  logs: string[];
}

/**
 * Compute the shard assignment for a list of files.
 *
 * If `shardCount` is set, files are distributed round-robin (file i -> shard
 * i % shardCount). This gives roughly equal-sized shards when files are
 * similarly sized, and lets an agent parallelize extraction.
 *
 * Otherwise, files are packed greedily into shards, starting a new shard when
 * either `maxFiles` (default 500) or `maxBytes` (default 20 MB) would be
 * exceeded. This minimizes the number of shards for a given size budget.
 */
export function computeShardAssignment(
  files: ShardFile[],
  opts: { shardCount?: number; shardSize?: { maxFiles?: number; maxBytes?: number } } = {}
): ShardFile[][] {
  if (opts.shardCount && opts.shardCount > 0) {
    const n = opts.shardCount;
    const shards: ShardFile[][] = Array.from({ length: n }, () => []);
    for (let i = 0; i < files.length; i++) {
      shards[i % n].push(files[i]);
    }
    // Drop empty shards (happens when shardCount > fileCount).
    return shards.filter((s) => s.length > 0);
  }
  const maxFiles = opts.shardSize?.maxFiles ?? 500;
  const maxBytes = opts.shardSize?.maxBytes ?? 20 * 1024 * 1024;
  const shards: ShardFile[][] = [];
  let cur: ShardFile[] = [];
  let curBytes = 0;
  for (const f of files) {
    if (cur.length >= maxFiles || (cur.length > 0 && curBytes + f.bytes.length > maxBytes)) {
      shards.push(cur);
      cur = [];
      curBytes = 0;
    }
    cur.push(f);
    curBytes += f.bytes.length;
  }
  if (cur.length > 0) shards.push(cur);
  // Edge case: empty ZIP -> one empty shard so the index has something to point at.
  if (shards.length === 0) shards.push([]);
  return shards;
}

/**
 * Build a sharded polyglot: N shard PDFs + 1 index PDF.
 *
 * Pipeline:
 *   1. Extract all entries from the source ZIP (lossless).
 *   2. Compute the shard assignment (round-robin or size-bounded).
 *   3. For each shard, build a canonical ZIP from its files, then build a
 *      standalone agent-readable PDF via agentReadable.build.
 *   4. Build the index PDF: a special agent-readable PDF whose manifest lists
 *      ALL files with a `shard` field, plus a TOC text page.
 *   5. Compute the Merkle root over ALL files and store it in the index
 *      manifest (covers the full set, not per-shard).
 */
export function buildSharded(
  zipBuf: Uint8Array,
  origName: string,
  opts: ShardedBuildOptions = {}
): ShardedBuildResult {
  const onLog = opts.onLog || (() => {});
  const logs: string[] = [];
  const log = (m: string) => {
    logs.push(m);
    onLog(m);
  };

  // 1. Extract all entries from the source ZIP.
  const struct = readZipStructure(zipBuf);
  const cdEntries = [...walkCentralDirectory(zipBuf, struct.cdOffset, struct.entryCount)];
  log(`zip: ${struct.entryCount} entries`);

  const allFiles: ShardFile[] = [];
  for (const entry of cdEntries) {
    const bytes = extractEntryBytes(zipBuf, entry);
    allFiles.push({ name: entry.name, bytes });
  }

  // 2. Compute shard assignment.
  const shardGroups = computeShardAssignment(allFiles, {
    shardCount: opts.shardCount,
    shardSize: opts.shardSize,
  });
  const shardCount = shardGroups.length;
  log(
    `sharded into ${shardCount} shards (sizes: ${shardGroups.map((s) => s.length).join(", ")})`
  );

  // 3. Build each shard PDF (a full standalone agent-readable PDF).
  const shards: Uint8Array[] = [];
  for (let i = 0; i < shardCount; i++) {
    const shardFiles = shardGroups[i];
    // Build a canonical ZIP from the shard's files — this is the input
    // agentReadable.build expects. The shard PDF will carry these files.
    const shardZip = buildCanonicalZip(shardFiles);
    const shardName = `${origName || "archive"}.shard-${i}-of-${shardCount}.zip`;
    const result = agentReadable.build(shardZip, shardName, {
      excludeCruft: opts.excludeCruft ?? false,
      embedFont: opts.embedFont ?? true,
      embedDiagram: opts.embedDiagramInShards ?? false,
      contentCompression: opts.contentCompression ?? "flate",
      onLog: (m: string) => log(`[shard ${i}] ${m}`),
    });
    shards.push(result.bytes);
    log(`shard ${i} PDF: ${result.bytes.length} bytes (${shardFiles.length} files)`);
  }

  // 4. Build the index manifest (lists ALL files with `shard` field).
  const manifestFiles: ManifestFile[] = [];
  let textFileCount = 0;
  let binaryFileCount = 0;
  let totalOriginalBytes = 0;
  let shardIdx = 0;
  for (const shardFiles of shardGroups) {
    for (const f of shardFiles) {
      const isDir = f.name.endsWith("/");
      const isText = isDir || isTextBytes(f.bytes);
      const sha = sha256HexSync(f.bytes);
      manifestFiles.push({
        i: manifestFiles.length,
        name: f.name,
        size: f.bytes.length,
        sha,
        type: isText ? "text" : "binary",
        shard: shardIdx,
      });
      if (isText) textFileCount++;
      else binaryFileCount++;
      totalOriginalBytes += f.bytes.length;
    }
    shardIdx++;
  }

  // 5. Compute the Merkle root over ALL files (excluding directory entries,
  // which have no content). The root covers the full set across all shards,
  // NOT per-shard — an agent can verify integrity from the index alone.
  const merkleLeaves = allFiles
    .filter((f) => !f.name.endsWith("/"))
    .map((f) => ({ name: f.name, hash: fileHash(f.bytes) }));
  const root = merkleRoot(merkleLeaves);
  log(`merkle root: ${root.slice(0, 16)}... (${merkleLeaves.length} leaves)`);

  // 6. Build the index PDF.
  const indexPdf = buildIndexPdf({
    origName: origName || "archive.zip",
    manifestFiles,
    shardCount,
    merkleRoot: root,
    textFileCount,
    binaryFileCount,
    totalOriginalBytes,
  });
  log(`index PDF: ${indexPdf.length} bytes`);

  return {
    shards,
    indexPdf,
    shardCount,
    fileCount: manifestFiles.length,
    totalOriginalBytes,
    merkleRoot: root,
    logs,
  };
}

interface IndexBuildArgs {
  origName: string;
  manifestFiles: ManifestFile[];
  shardCount: number;
  merkleRoot: string;
  textFileCount: number;
  binaryFileCount: number;
  totalOriginalBytes: number;
}

/**
 * Build the index PDF. Layout:
 *   obj 1: Catalog with /Polyglot << /Manifest N /BinaryStore M >>
 *   obj 2: /Pages
 *   obj 3: Helvetica font
 *   obj 4..: TOC page(s) — page + contents stream per page (uses buildTextPages)
 *   obj N: Manifest stream (Brotli-compressed JSON; isIndex:true, shardCount:N)
 *   obj N+1: BinaryStore stream (empty PAR2 container, Brotli-compressed)
 *
 * The TOC text page is a human-readable table of contents: source archive
 * name, summary stats, Merkle root, and a file-by-file listing with shard
 * assignments (capped at 5000 lines to bound the index PDF size — the full
 * list lives in the manifest stream).
 */
function buildIndexPdf(args: IndexBuildArgs): Uint8Array {
  const {
    origName,
    manifestFiles,
    shardCount,
    merkleRoot,
    textFileCount,
    binaryFileCount,
    totalOriginalBytes,
  } = args;

  const catalogNum = 1;
  const pagesNum = 2;
  const helvFontNum = 3;

  // Build the TOC text lines (ASCII, Helvetica literal strings).
  const tocLines: Uint8Array[] = [];
  const pushLine = (s: string) => tocLines.push(utf8(s));
  pushLine("=== zip-to-pdf-polyglot v2.6 — SHARDED INDEX ===");
  pushLine("");
  pushLine("Source archive : " + (origName || "archive.zip"));
  pushLine("Files encoded  : " + manifestFiles.length);
  pushLine("  text files   : " + textFileCount + "  (rendered into shard PDF text layers)");
  pushLine("  binary files : " + binaryFileCount + "  (in shard PDF binary stores)");
  pushLine("Shard count    : " + shardCount);
  pushLine("Total bytes    : " + totalOriginalBytes);
  pushLine("Merkle root    : " + merkleRoot);
  pushLine("");
  pushLine("HOW AN AGENT USES THIS INDEX");
  pushLine("  1. Read the /PolyglotManifest stream of this PDF. Every file carries");
  pushLine("     a `shard` field (0-based) identifying which shard PDF contains it.");
  pushLine("  2. Fetch the shard PDFs you need. The shard PDFs are full standalone");
  pushLine("     agent-readable PDFs (qpdf-clean, round-trip on their own).");
  pushLine("  3. POST /api/extract-sharded with this index + all shard PDFs, or call");
  pushLine("     extractPolyglotSharded(indexPdf, shardPdfs) in the core library.");
  pushLine("  4. The extractor reads the index, then for each file fetches its bytes");
  pushLine("     from the appropriate shard's text layer + binary store.");
  pushLine("  5. The Merkle root above covers ALL files across ALL shards — verify");
  pushLine("     integrity WITHOUT trusting the extractor: recompute the tree from");
  pushLine("     the extracted files and compare to this root.");
  pushLine("");
  pushLine("=== TABLE OF CONTENTS (file name -> shard) ===");
  const CAP = 5000;
  let shown = 0;
  for (const mf of manifestFiles) {
    if (shown >= CAP) {
      pushLine(
        `... (${manifestFiles.length - shown} more entries — see /PolyglotManifest stream)`
      );
      break;
    }
    const kind = mf.type === "text" ? "txt" : "bin";
    pushLine(`[shard ${mf.shard}] (${kind}) ${mf.name}`);
    shown++;
  }

  // TOC pages via buildTextPages (handles pagination at 5000 lines/page).
  let obj = 4;
  const tocPages = buildTextPages(obj, pagesNum, helvFontNum, tocLines);
  obj = tocPages.nextNum;

  const manifestObj = obj++;
  const binaryStoreObj = obj++;

  const fullManifest: FullManifest = {
    v: 2,
    strategy: "agent-readable",
    origName: origName || "archive.zip",
    // The index PDF has no codebase text layer. textStartPage=0 + textPageCount=0
    // tells the standard extractor there are no codebase text pages to read.
    // (The TOC pages exist but are NOT codebase content — they're metadata.)
    textStartPage: 0,
    textPageCount: 0,
    binaryStoreObj,
    textFiles: manifestFiles.filter((m) => m.type === "text"),
    files: manifestFiles,
    summary: {
      fileCount: manifestFiles.length,
      textFileCount,
      binaryFileCount,
      dedupCount: 0,
      excludedCount: 0,
      totalOriginalBytes,
    },
    compression: "brotli",
    merkleRoot,
    // v2.6 sharding fields:
    isIndex: true,
    shardCount,
  };

  const manifestStream = brotliDeflate(utf8(JSON.stringify(fullManifest)), 11);
  // Empty binary store (PAR2 container with 0 blobs). The index PDF carries
  // no file content itself — bytes live in the shard PDFs.
  const binaryStream = brotliDeflate(buildParContainer([]), 11);

  // Assemble objects.
  const objects: Record<number, Uint8Array> = {};
  Object.assign(objects, tocPages.objects);
  objects[pagesNum] = dictObject(
    pagesNum,
    `<< /Type /Pages /Kids [${tocPages.pageObjNums.map((n) => n + " 0 R").join(" ")}] /Count ${tocPages.pageObjNums.length} >>`
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
  objects[catalogNum] = buildCatalog(
    catalogNum,
    pagesNum,
    ` /Polyglot << /Version 2 /Strategy /agent-readable /Manifest ${manifestObj} 0 R /BinaryStore ${binaryStoreObj} 0 R >>`
  );

  return assemblePdf(objects, catalogNum);
}

// ---- Extraction (reversal to a canonical ZIP) ----

export interface ShardedExtractOptions {
  onLog?: (msg: string) => void;
}

export interface ShardedExtractResult {
  bytes: Uint8Array;
  zipSize: number;
  entryCount: number;
  files: { name: string; size: number; type: "text" | "binary" }[];
  logs: string[];
}

/**
 * Read the manifest of an index PDF. Throws if the PDF is not a sharded index.
 */
export function readIndexManifest(indexPdf: Uint8Array): FullManifest {
  const refs = findPolyglotRefs(indexPdf);
  if (!refs) {
    throw new Error(
      "Index PDF is not a valid polyglot (no /Polyglot extension on Catalog)."
    );
  }
  const manifestBytes = readObjectStream(indexPdf, refs.manifest);
  const manifest = JSON.parse(new TextDecoder("utf-8").decode(manifestBytes)) as FullManifest;
  if (!manifest.isIndex) {
    throw new Error(
      "The provided PDF is not a sharded index (manifest.isIndex is false/absent). " +
        "Use extractPolyglot for a single-PDF polyglot."
    );
  }
  return manifest;
}

/**
 * Extract a sharded polyglot back to a canonical ZIP.
 *
 * Pipeline:
 *   1. Read the index manifest (validates isIndex + shardCount).
 *   2. For each shard PDF, run agentReadable.extract -> recover the shard's
 *      canonical ZIP -> read its entries into a name -> bytes map.
 *   3. For each file in the index manifest, look up its name in the
 *      appropriate shard's map -> fetch the bytes.
 *   4. Build the full canonical ZIP from all file bytes (sorted by name,
 *      fixed timestamps, deflate — same canonical form as single-PDF extract).
 */
export function extractSharded(
  indexPdf: Uint8Array,
  shardPdfs: Uint8Array[],
  opts: ShardedExtractOptions = {}
): ShardedExtractResult {
  const onLog = opts.onLog || (() => {});
  const logs: string[] = [];
  const log = (m: string) => {
    logs.push(m);
    onLog(m);
  };

  // 1. Read the index manifest.
  const manifest = readIndexManifest(indexPdf);
  log(
    `index manifest: ${manifest.files.length} files across ${manifest.shardCount} shards`
  );

  // 2. Validate shard count.
  if (shardPdfs.length < (manifest.shardCount ?? 0)) {
    throw new Error(
      `Index references ${manifest.shardCount} shards, but only ${shardPdfs.length} were provided.`
    );
  }

  // 3. Extract each shard PDF into a name -> bytes map.
  const shardMaps: Map<string, Uint8Array>[] = [];
  for (let i = 0; i < (manifest.shardCount ?? 0); i++) {
    const shardPdf = shardPdfs[i];
    log(`extracting shard ${i}...`);
    const r = agentReadable.extract(shardPdf, {
      canonical: true,
      onLog: (m: string) => log(`[shard ${i}] ${m}`),
    });
    // Read the shard's canonical ZIP to get per-file bytes by name.
    const shardStruct = readZipStructure(r.bytes);
    const shardEntries = [
      ...walkCentralDirectory(r.bytes, shardStruct.cdOffset, shardStruct.entryCount),
    ];
    const m = new Map<string, Uint8Array>();
    for (const e of shardEntries) {
      if (e.isDirectory) {
        m.set(e.name, new Uint8Array(0));
      } else {
        m.set(e.name, extractEntryBytes(r.bytes, e));
      }
    }
    shardMaps.push(m);
    log(`shard ${i}: ${shardEntries.length} entries recovered`);
  }

  // 4. For each file in the index manifest, look up its bytes from the right shard.
  const entries: { name: string; bytes: Uint8Array }[] = [];
  const fileMeta: { name: string; size: number; type: "text" | "binary" }[] = [];
  for (const mf of manifest.files) {
    if (mf.shard === undefined) {
      throw new Error(`File ${mf.name} has no shard assignment in the index manifest.`);
    }
    const shardMap = shardMaps[mf.shard];
    if (!shardMap) {
      throw new Error(`Shard ${mf.shard} (referenced by ${mf.name}) was not provided.`);
    }
    const bytes = shardMap.get(mf.name);
    if (!bytes) {
      throw new Error(
        `File ${mf.name} not found in shard ${mf.shard} (shard has ${shardMap.size} entries).`
      );
    }
    entries.push({ name: mf.name, bytes });
    fileMeta.push({ name: mf.name, size: bytes.length, type: mf.type });
  }

  // 5. Build the canonical ZIP from the full file set.
  const zipBytes = buildCanonicalZip(entries);
  log(`built canonical ZIP: ${zipBytes.length} bytes, ${entries.length} entries`);

  return { bytes: zipBytes, zipSize: zipBytes.length, entryCount: entries.length, files: fileMeta, logs };
}
