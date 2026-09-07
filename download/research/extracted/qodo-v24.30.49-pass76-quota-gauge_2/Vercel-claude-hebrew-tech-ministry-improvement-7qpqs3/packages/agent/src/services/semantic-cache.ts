import { log } from "./logger.js";
import { createHash } from "crypto";
import { pipeline, env as transformersEnv } from "@xenova/transformers";
import type { Telemetry } from "./telemetry.js";
import type { R2Storage } from "./r2-storage.js";
import type { Patch } from "../types/domain.js";

transformersEnv.cacheDir = "node_modules/.cache/transformers";

export interface CacheEnv {
  QODO_PRIVACY_MODE?: string;
  QODO_HIVE_SHARE?: string;
}

function sha256Short(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

interface CacheEntry {
  objective: string;
  planJson: string;
  embedding: number[];
  patch: Patch;
  /** SHA-256 fingerprints of the file contents used when the entry was saved.
   *  Drift checks compare these hashes instead of full file contents. */
  fileHashes: Record<string, string>;
}

interface HiveCacheEntry extends CacheEntry {
  owner: string;
  repo: string;
}

const INDEX_KEY = "semantic-cache/index.json";
const HIVE_INDEX_KEY = "hive/global-index.json";
const QUARANTINE_KEY = "semantic-cache/quarantine.json";
let embedder: unknown = null;

/** Typed wrapper around the @xenova/transformers pipeline call.
 *  The library's overloaded signature does not accept a plain options object
 *  at the TypeScript level; we isolate the cast here so the rest of the file
 *  is clean. */
async function embed(emb: Awaited<ReturnType<typeof pipeline>>, text: string): Promise<{ data: Float32Array }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (emb as any)(text, { pooling: "mean", normalize: true }) as Promise<{ data: Float32Array }>;
}

export type HiveShareMode = "off" | "public" | "org-private";

function getHiveShareMode(cacheEnv?: CacheEnv): HiveShareMode {
  if ((cacheEnv?.QODO_PRIVACY_MODE ?? process.env.QODO_PRIVACY_MODE) === "strict") return "off";
  const mode = cacheEnv?.QODO_HIVE_SHARE ?? process.env.QODO_HIVE_SHARE;
  if (mode === "public" || mode === "org-private") return mode;
  return "off";
}

function isCrossRepoSafe(entry: HiveCacheEntry, owner: string, cacheEnv?: CacheEnv): boolean {
  const mode = getHiveShareMode(cacheEnv);
  if (mode === "off") return false;
  if (mode === "public") return true;
  if (mode === "org-private") {
    return entry.owner === owner;
  }
  return false;
}

async function getEmbedder() {
  if (!embedder) embedder = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
  return embedder as Awaited<ReturnType<typeof pipeline>>;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

function normalize(v: number[]): number[] {
  const mag = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return v.map((x) => x / (mag || 1));
}

interface QuarantineEntry {
  objective: string;
  planJson: string;
  patchFiles: number;
  quarantinedAt: string;
}

async function loadQuarantine(storage: R2Storage): Promise<QuarantineEntry[]> {
  try {
    const raw = await storage.getText(QUARANTINE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e: unknown) {
    // A quarantine list that silently reads as empty would let a
    // known-poisoned hive patch be served again — make the failure visible.
    log.warn("semantic-cache: quarantine list unreadable; treating as empty", {
      error: e instanceof Error ? e.message : String(e),
    });
    return [];
  }
}

async function isQuarantined(
  objective: string,
  plan: Record<string, unknown>,
  storage: R2Storage,
): Promise<boolean> {
  const list = await loadQuarantine(storage);
  const planJson = JSON.stringify(plan);
  return list.some((q) => q.objective === objective && q.planJson === planJson);
}

export async function quarantinePatch(
  objective: string,
  plan: Record<string, unknown>,
  patch: Patch,
  storage: R2Storage,
): Promise<void> {
  try {
    const list = await loadQuarantine(storage);
    list.push({
      objective,
      planJson: JSON.stringify(plan),
      patchFiles: patch.files.length,
      quarantinedAt: new Date().toISOString(),
    });
    await storage.putText(QUARANTINE_KEY, JSON.stringify(list.slice(-500)));
  } catch (e: unknown) {
    log.warn('semantic-cache: quarantine save failed', { error: e instanceof Error ? e.message : String(e) });
  }
}

export async function findCachedPatch(
  objective: string,
  plan: Record<string, unknown>,
  prefetch: Record<string, string>,
  storage: R2Storage,
  telemetry?: Telemetry,
  _cacheEnv?: CacheEnv,
): Promise<Patch | null> {
  try {
    if (await isQuarantined(objective, plan, storage)) {
      await telemetry?.decision("semantic-cache", "quarantine-skip", { provider: "local" });
      return null;
    }

    const indexRaw = await storage.getText(INDEX_KEY);
    const entries: CacheEntry[] = indexRaw ? JSON.parse(indexRaw) : [];
    if (!entries.length) return null;

    const query = `${objective}\n${JSON.stringify(plan)}`;
    const emb = await getEmbedder();
    const out = await embed(emb, query);
    const qvec = normalize(Array.from(out.data));

    let best: CacheEntry | null = null;
    let bestScore = 0;
    for (const e of entries) {
      const score = cosine(qvec, e.embedding);
      if (score > bestScore) {
        bestScore = score;
        best = e;
      }
    }

    if (best && bestScore > 0.95) {
      const drifted = best.patch.files.some((file) => {
        const current = prefetch[file.path];
        if (current === undefined) return true;
        const cachedHash = best.fileHashes[file.path];
        if (!cachedHash) return true;
        return sha256Short(current) !== cachedHash;
      });
      if (drifted) {
        await telemetry?.decision("semantic-cache", "cache-drift", { provider: "local", score: bestScore });
        return null;
      }
      await telemetry?.decision("semantic-cache", "cache-hit", { provider: "local", score: bestScore });
      return best.patch;
    }
  } catch (e: unknown) {
    log.warn('semantic-cache: lookup failed', { error: e instanceof Error ? e.message : String(e) });
  }
  return null;
}

export async function saveCachedPatch(
  objective: string,
  plan: Record<string, unknown>,
  patch: Patch,
  storage: R2Storage,
): Promise<void> {
  try {
    const query = `${objective}\n${JSON.stringify(plan)}`;
    const emb = await getEmbedder();
    const out = await embed(emb, query);
    const embedding = normalize(Array.from(out.data));

    const indexRaw = await storage.getText(INDEX_KEY);
    const entries: CacheEntry[] = indexRaw ? JSON.parse(indexRaw) : [];
    const fileHashes: Record<string, string> = {};
    for (const file of patch.files) fileHashes[file.path] = sha256Short(file.content);
    entries.push({ objective, planJson: JSON.stringify(plan), embedding, patch, fileHashes });
    await storage.putText(INDEX_KEY, JSON.stringify(entries.slice(-100)));
  } catch (e: unknown) {
    log.warn('semantic-cache: save failed', { error: e instanceof Error ? e.message : String(e) });
  }
}

export async function findHiveReference(
  objective: string,
  plan: Record<string, unknown>,
  owner: string,
  prefetch: Record<string, string>,
  storage: R2Storage,
  telemetry?: Telemetry,
  cacheEnv?: CacheEnv,
): Promise<Patch | null> {
  if (getHiveShareMode(cacheEnv) === "off") return null;
  if (await isQuarantined(objective, plan, storage)) {
    await telemetry?.decision("semantic-cache", "quarantine-skip", { provider: "global" });
    return null;
  }
  try {
    const indexRaw = await storage.getText(HIVE_INDEX_KEY);
    const entries: HiveCacheEntry[] = indexRaw ? JSON.parse(indexRaw) : [];
    if (!entries.length) return null;

    const query = `${objective}\n${JSON.stringify(plan)}`;
    const emb = await getEmbedder();
    const out = await embed(emb, query);
    const qvec = normalize(Array.from(out.data));

    let best: HiveCacheEntry | null = null;
    let bestScore = 0;
    for (const e of entries) {
      if (!isCrossRepoSafe(e, owner, cacheEnv)) continue;
      const score = cosine(qvec, e.embedding);
      if (score > bestScore) {
        bestScore = score;
        best = e;
      }
    }

    if (best && bestScore > 0.92) {
      const drifted = best.patch.files.some((file) => {
        const current = prefetch[file.path];
        if (current === undefined) return true;
        const cachedHash = best!.fileHashes[file.path];
        if (!cachedHash) return true;
        return sha256Short(current) !== cachedHash;
      });
      if (drifted) {
        await telemetry?.decision("semantic-cache", "hive-drift", { provider: "global", score: bestScore });
        return null;
      }
      await telemetry?.decision("semantic-cache", "hive-hit", { provider: "global", score: bestScore });
      return best.patch;
    }
  } catch (e: unknown) {
    log.warn('semantic-cache: hive lookup failed', { error: e instanceof Error ? e.message : String(e) });
  }
  return null;
}

export async function saveHivePatch(
  objective: string,
  plan: Record<string, unknown>,
  patch: Patch,
  owner: string,
  repo: string,
  storage: R2Storage,
  cacheEnv?: CacheEnv,
): Promise<void> {
  if (getHiveShareMode(cacheEnv) === "off") return;
  try {
    const query = `${objective}\n${JSON.stringify(plan)}`;
    const emb = await getEmbedder();
    const out = await embed(emb, query);
    const embedding = normalize(Array.from(out.data));

    const indexRaw = await storage.getText(HIVE_INDEX_KEY);
    const entries: HiveCacheEntry[] = indexRaw ? JSON.parse(indexRaw) : [];
    const fileHashes: Record<string, string> = {};
    for (const file of patch.files) fileHashes[file.path] = sha256Short(file.content);
    entries.push({ objective, planJson: JSON.stringify(plan), embedding, patch, fileHashes, owner, repo });
    await storage.putText(HIVE_INDEX_KEY, JSON.stringify(entries.slice(-200)));
  } catch (e: unknown) {
    log.warn('semantic-cache: hive save failed', { error: e instanceof Error ? e.message : String(e) });
  }
}
