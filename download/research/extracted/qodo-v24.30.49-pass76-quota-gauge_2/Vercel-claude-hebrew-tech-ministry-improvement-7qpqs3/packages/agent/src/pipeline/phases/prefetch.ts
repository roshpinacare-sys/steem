import { buildFileMap } from "../../services/cartographer.js";
import { throttledBatch } from "../../utils/rate-limiter.js";
import { chunkSource, parseViaEdgeSwarm } from "../../services/edge-fragment.js";
import { EDGE_FRAGMENT_THRESHOLD, fragmentSummary, saveCheckpoint } from "../helpers.js";
import type { PhaseContext } from "../context.js";

/** Predictive prefetch with edge sharding for massive files. */
export async function runPrefetchPhase(ctx: PhaseContext): Promise<void> {
  const { s, env, owner, repo, prNumber, gh, state, telemetry, targetFiles } = ctx;

  const files = Array.from(new Set((s.plan!.prefetch || []).concat(Array.from(targetFiles))));
  const refs = await gh.getPRShas(prNumber);
  const contents = await throttledBatch(files, 5, 200, async (path) => {
    const content = await gh.getFileAtRef(path, refs?.head || "HEAD");
    return { path, content };
  });
  s.prefetch = {};
  for (const { path, content } of contents) {
    if (content === null) continue;
    if (content.length > EDGE_FRAGMENT_THRESHOLD) {
      const chunks = chunkSource(content);
      const fragment = await parseViaEdgeSwarm(chunks, env.EDGE_FRAGMENT_WORKER_URL, telemetry);
      s.prefetch[path] = fragmentSummary(path, fragment);
      await telemetry?.decision("edge-fragment", "massive-file-sharded", {
        path,
        originalBytes: content.length,
        chunks: chunks.length,
      });
    } else {
      s.prefetch[path] = content;
    }
  }
  s.fileMap = await buildFileMap(s.prefetch, targetFiles, state, telemetry, env);
  await saveCheckpoint(owner, repo, prNumber, state, s);
}
