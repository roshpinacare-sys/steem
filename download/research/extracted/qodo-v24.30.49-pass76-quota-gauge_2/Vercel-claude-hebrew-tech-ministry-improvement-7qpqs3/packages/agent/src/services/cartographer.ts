import { createHash } from "node:crypto";
import { aiRoute, type RouterEnv } from "./ai-router.js";
import type { Telemetry } from "./telemetry.js";
import { RedisState } from "./redis-state.js";
import { R2Storage, type R2Config } from "./r2-storage.js";

/** Cartographer needs both R2 credentials and AI-router credentials. */
type CartographerEnv = RouterEnv & R2Config;

/** Byte threshold above which a file is summarised rather than inlined. */
const EDGE_FRAGMENT_THRESHOLD_BYTES = 50_000;
const SUMMARY_LINES = 50;

// Reuse a single R2Storage instance for the process lifetime. The client is
// stateless except for a degraded flag, so sharing it avoids repeatedly creating
// AWS SDK clients and re-resolving environment variables. It is created lazily
// so that module import does not capture process.env values before they have
// been validated or injected by the runtime.
let sharedStorage: R2Storage | null = null;
function getSharedStorage(env?: R2Config): R2Storage {
  if (!sharedStorage) sharedStorage = new R2Storage(env);
  return sharedStorage;
}

export function isLargeFile(content: string): boolean {
  return Buffer.byteLength(content, "utf8") > EDGE_FRAGMENT_THRESHOLD_BYTES;
}

function contentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

export async function summarizeFile(
  path: string,
  content: string,
  state: RedisState,
  telemetry?: Telemetry,
  env?: CartographerEnv,
): Promise<string> {
  const hash = contentHash(content);
  const cacheKey = `file_map:${path}`;
  const hashKey = `ast_cache:${hash}`;

  const local = await state.getJSON<string>(cacheKey);
  if (local) return local;

  // Distributed AST cache in R2 keyed by content hash.
  const remote = await getSharedStorage(env).getText(hashKey);
  if (remote) {
    await state.setJSON(cacheKey, remote);
    await telemetry?.decision("cartographer", "ast-cache-hit-r2", { path, hash });
    return remote;
  }

  const prompt = `Summarize the following code file in at most ${SUMMARY_LINES} lines. Describe its public API, key functions, and how it relates to the rest of the codebase. Do not include code blocks.\n\nFile: ${path}\n\n${content}`;
  const summary = await aiRoute(path, "fast", prompt, { telemetry, env });
  const trimmed = summary.split("\n").slice(0, SUMMARY_LINES).join("\n");
  await state.setJSON(cacheKey, trimmed);
  await getSharedStorage().putText(hashKey, trimmed);
  await telemetry?.decision("cartographer", "file-summarized", { path, summary: trimmed, lines: trimmed.split("\n").length, hash });
  return trimmed;
}

export async function buildFileMap(
  prefetch: Record<string, string>,
  targetFiles: Set<string>,
  state: RedisState,
  telemetry?: Telemetry,
  env?: CartographerEnv,
): Promise<Record<string, string>> {
  const fileMap: Record<string, string> = {};
  for (const [path, content] of Object.entries(prefetch)) {
    if (targetFiles.has(path)) continue;
    if (isLargeFile(content)) {
      fileMap[path] = await summarizeFile(path, content, state, telemetry, env);
    }
  }
  return fileMap;
}
