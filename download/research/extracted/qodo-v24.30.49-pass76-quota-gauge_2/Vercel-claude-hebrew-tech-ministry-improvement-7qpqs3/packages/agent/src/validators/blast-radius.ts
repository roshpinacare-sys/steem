import { pipeline, env } from "@xenova/transformers";
import {
  computeGitBlameRisk,
  totalRiskBonus,
  resolveGitBlameConfig,
} from "../services/integrations/git-blame-risk.js";
import { log } from "../services/logger.js";
import type { Telemetry } from "../services/telemetry.js";

env.cacheDir = "node_modules/.cache/transformers";

const EMBEDDER_LOAD_TIMEOUT_MS = 30_000;
const EMBEDDER_MAX_RETRIES = 3;

let embedder: unknown = null;

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function getEmbedder() {
  if (embedder) return embedder as Awaited<ReturnType<typeof pipeline>>;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= EMBEDDER_MAX_RETRIES; attempt++) {
    try {
      const loader = pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
      const result = await Promise.race([
        loader,
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("embedder model load timeout")),
            EMBEDDER_LOAD_TIMEOUT_MS,
          ),
        ),
      ]);
      embedder = result;
      return embedder as Awaited<ReturnType<typeof pipeline>>;
    } catch (e: unknown) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : String(e);
      log.warn("blast-radius: embedder load failed; retrying", { attempt, error: msg });
      if (attempt < EMBEDDER_MAX_RETRIES) await sleep(500 * 2 ** (attempt - 1));
    }
  }
  throw lastErr;
}

/** Typed wrapper to isolate the @xenova/transformers overload mismatch. */
async function embed(emb: Awaited<ReturnType<typeof pipeline>>, text: string): Promise<{ data: Float32Array }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (emb as any)(text, { pooling: "mean", normalize: true }) as Promise<{ data: Float32Array }>;
}

/**
 * Deterministic, dependency-free embedding for sovereign local runs: a
 * feature-hashed bag-of-tokens vector. It measures genuine lexical overlap
 * between the objective and the diff — a real, reproducible blast-radius
 * signal — with no model download and no network. Used only when the caller
 * declares sovereign mode; the semantic transformer path is otherwise intact.
 */
const LOCAL_EMBED_DIMS = 512;
function localEmbed(text: string): number[] {
  const v = new Array(LOCAL_EMBED_DIMS).fill(0);
  for (const tok of text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)) {
    let h = 2166136261;
    for (let i = 0; i < tok.length; i++) { h ^= tok.charCodeAt(i); h = Math.imul(h, 16777619); }
    v[Math.abs(h) % LOCAL_EMBED_DIMS] += 1;
  }
  return v;
}

function cosine(a: number[], b: number[]) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i]*b[i]; na += a[i]*a[i]; nb += b[i]*b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

export async function blastRadius(
  objective: string,
  diff: string,
  opts?: {
    /** Target files to assess for git-blame risk bonus. */
    targetFiles?: string[];
    owner?: string;
    repo?: string;
    telemetry?: Telemetry;
    /** Sovereign local run: use the deterministic offline embedding (no model
     *  download), keeping the gate real and reproducible without the network. */
    sovereignLocal?: boolean;
  },
) {
  try {
    let similarity: number;
    if (opts?.sovereignLocal) {
      similarity = cosine(localEmbed(objective), localEmbed(diff.slice(0, 8000)));
    } else {
      const emb = await getEmbedder();
      const [o, d] = await Promise.all([
        embed(emb, objective),
        embed(emb, diff.slice(0, 8000)),
      ]);
      similarity = cosine(Array.from(o.data), Array.from(d.data));
    }

    // Git-blame risk amplification (data-driven, non-blocking). Skipped in
    // sovereign mode: it fetches commit history from GitHub, which a fully
    // local run must not do.
    let gitBlameBonus = 0;
    if (!opts?.sovereignLocal && opts?.targetFiles?.length && opts.owner && opts.repo) {
      const gitCfg = resolveGitBlameConfig(opts.owner, opts.repo);
      if (gitCfg) {
        const bonuses = await computeGitBlameRisk(opts.targetFiles, gitCfg, opts.telemetry);
        gitBlameBonus = totalRiskBonus(bonuses);
      }
    }

    // Normalize bonus to a similarity-scale penalty (max -0.15 impact)
    const blameAdjustment = Math.min(gitBlameBonus / 200, 0.15);
    const adjustedSimilarity = Math.max(0, similarity - blameAdjustment);

    return {
      allowed: adjustedSimilarity >= 0.25,
      similarity: adjustedSimilarity,
      rawSimilarity: similarity,
      gitBlameBonus,
      threshold: 0.25,
    };
  } catch (e: unknown) {
    // Fail-closed: any error blocks the gate.
    return { allowed: false, error: e instanceof Error ? e.message : String(e), similarity: 0, threshold: 0.25 };
  }
}
