import type { Telemetry } from "./telemetry.js";
import { fetchWithTimeout } from "../utils/fetch-timeout.js";
import { throttledBatch } from "../utils/rate-limiter.js";

export interface SourceChunk {
  index: number;
  content: string;
}

export interface FragmentResult {
  exports: string[];
  imports: string[];
  envRefs: string[];
}

/**
 * Split source text into roughly equal chunks for parallel edge processing.
 * Each chunk is guaranteed to contain complete lines to avoid splitting tokens.
 *
 * @param overlapLines - Number of lines from the end of the previous chunk to
 *   prepend to the next chunk.  Defaults to 8 so that multi-line import/export
 *   statements that straddle a boundary are visible in both adjacent chunks,
 *   preventing statement fragmentation.
 */
export function chunkSource(content: string, chunkSize = 256, overlapLines = 8): SourceChunk[] {
  const lines = content.split("\n");
  const chunks: SourceChunk[] = [];
  let buffer: string[] = [];
  let index = 0;

  for (const line of lines) {
    buffer.push(line);
    if (buffer.length >= chunkSize) {
      chunks.push({ index: index++, content: buffer.join("\n") });
      // Seed the next buffer with the trailing overlap from the current chunk
      // so multi-line statements spanning a boundary appear in both chunks.
      buffer = buffer.slice(-overlapLines);
    }
  }

  if (buffer.length > 0) {
    chunks.push({ index: index, content: buffer.join("\n") });
  }

  return chunks;
}

/**
 * Dispatch chunks to edge workers in parallel and merge their FragmentResults.
 * Falls back to in-process parsing when no workerUrl is supplied (e.g., tests).
 */
export async function parseViaEdgeSwarm(
  chunks: SourceChunk[],
  workerUrl?: string,
  telemetry?: Telemetry,
): Promise<FragmentResult> {
  // Cap concurrency so a file with many chunks cannot overwhelm the worker
  // or consume excessive in-flight memory. 5 concurrent chunks with 50ms
  // jitter keeps latency low while being polite to the edge runtime.
  const results: FragmentResult[] = await throttledBatch(
    chunks,
    5,
    50,
    (chunk) => dispatchChunk(chunk, workerUrl),
  );

  const merged: FragmentResult = {
    exports: [],
    imports: [],
    envRefs: [],
  };

  for (const r of results) {
    merged.exports.push(...r.exports);
    merged.imports.push(...r.imports);
    merged.envRefs.push(...r.envRefs);
  }

  // Deduplicate across all chunks.
  merged.exports = [...new Set(merged.exports)].sort();
  merged.imports = [...new Set(merged.imports)].sort();
  merged.envRefs = [...new Set(merged.envRefs)].sort();

  await telemetry?.decision("edge-fragment", "swarm-complete", {
    chunks: chunks.length,
    exports: merged.exports.length,
    imports: merged.imports.length,
    envRefs: merged.envRefs.length,
  });

  return merged;
}

/** Send one chunk to the edge worker or parse in-process if no URL. */
async function dispatchChunk(
  chunk: SourceChunk,
  workerUrl?: string,
): Promise<FragmentResult> {
  if (!workerUrl) {
    return parseChunkInProcess(chunk.content);
  }

  try {
    const res = await fetchWithTimeout(
      workerUrl,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ index: chunk.index, content: chunk.content }),
      },
      5_000,
    );
    if (!res.ok) throw new Error(`Worker responded ${res.status}`);
    return (await res.json()) as FragmentResult;
  } catch {
    // Graceful degradation: parse locally if the worker is unreachable.
    return parseChunkInProcess(chunk.content);
  }
  // Note: no finally { clearTimeout(timeout) } — the timeout handle is owned
  // and cleared internally by fetchWithTimeout. A stray clearTimeout(timeout)
  // here previously referenced an undeclared variable, causing a ReferenceError
  // in strict mode (Bug 16-D).
}

/** In-process regex-based parsing used as a fallback and by the worker itself. */
export function parseChunkInProcess(content: string): FragmentResult {
  const exports: string[] = [];
  const imports: string[] = [];
  const envRefs: string[] = [];

  // Named exports: export function/const/class/type/interface Foo
  const exportRe = /export\s+(?:async\s+)?(?:function|const|class|type|interface|enum)\s+(\w+)/g;
  let m: RegExpExecArray | null;
  while ((m = exportRe.exec(content)) !== null) exports.push(m[1]);

  // Default exports with identifiers
  const defaultExportRe = /export\s+default\s+(?:function|class)\s+(\w+)/g;
  while ((m = defaultExportRe.exec(content)) !== null) exports.push(m[1]);

  // Import declarations
  const importRe = /import\s+.*?\s+from\s+['"]([^'"]+)['"]/g;
  while ((m = importRe.exec(content)) !== null) imports.push(m[1]);

  // Side-effect imports
  const sideEffectRe = /import\s+['"]([^'"]+)['"]/g;
  while ((m = sideEffectRe.exec(content)) !== null) imports.push(m[1]);

  // process.env references
  const envRe = /process\.env\.(\w+)/g;
  while ((m = envRe.exec(content)) !== null) envRefs.push(m[1]);

  return { exports, imports, envRefs };
}
