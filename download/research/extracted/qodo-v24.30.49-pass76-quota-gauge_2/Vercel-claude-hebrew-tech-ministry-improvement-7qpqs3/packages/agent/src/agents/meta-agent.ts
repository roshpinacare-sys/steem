import { log } from "../services/logger.js";
import { aiRoute, type RouterEnv } from "../services/ai-router.js";
import type { Telemetry } from "../services/telemetry.js";
import { RedisState } from "../services/redis-state.js";
import type { AIContractFailure } from "../utils/schema-validator.js";
import type { GitHubClient } from "../services/github-client.js";

const FOURTEEN_DAYS_SEC = 14 * 24 * 60 * 60;
// SAFETY FIX (V24 audit): an auto-applied mutation is unsupervised — no PR,
// no merge, no human ever looked at it before it started governing live
// runs. Bounding its TTL to 1 hour caps the blast radius of a bad mutation
// (e.g. one that games schema validation with degenerate-but-valid output)
// to a single incident window instead of up to 14 days. A human who reviews
// the notification PR and wants it to stick calls promoteMutation() below,
// which is the only path that grants the full 14-day TTL.
const AUTO_MUTATION_TTL_SEC = 60 * 60;

function activeKey(owner: string, repo: string, agent: string) {
  return `prompt_mutations:${owner}:${repo}:${agent}:active`;
}

function historyKey(owner: string, repo: string, agent: string) {
  return `prompt_mutations:${owner}:${repo}:${agent}:history`;
}

export async function getActiveMutation(
  agent: "architect" | "coder" | "reviewer",
  state: RedisState,
  owner: string,
  repo: string,
): Promise<string | null> {
  return state.getJSON<string>(activeKey(owner, repo, agent));
}

interface MutationSnapshot {
  previous: string | null;
  mutatedAt: string;
}

export async function mutatePrompt(
  agent: "architect" | "coder" | "reviewer",
  failure: AIContractFailure,
  state: RedisState,
  telemetry: Telemetry | undefined,
  owner: string,
  repo: string,
  gh?: GitHubClient,
  env?: RouterEnv,
): Promise<string> {
  const activeK = activeKey(owner, repo, agent);
  const historyK = historyKey(owner, repo, agent);
  const previous = await state.getJSON<string>(activeK);

  const history = (await state.getJSON<MutationSnapshot[]>(historyK)) || [];
  history.unshift({ previous, mutatedAt: new Date().toISOString() });
  await state.setJSONWithTTL(historyK, history.slice(0, 20), FOURTEEN_DAYS_SEC);

  const prompt = `You are the META-AGENT. A sub-agent failed to follow its JSON schema.
Failed system prompt:
${failure.prompt}

AI's invalid raw output:
${failure.raw}

Validation error:
${failure.error}

Rewrite the system prompt so the next run will produce valid JSON matching the schema. Output ONLY the rewritten system prompt, no commentary.`;

  const raw = await aiRoute("mutation.json", "heavy", prompt, { telemetry, env });
  const mutated = raw.trim().replace(/^```[\s\S]*?```$/, "").trim();

  // SAFETY FIX (V24 audit): short TTL, not FOURTEEN_DAYS_SEC — see comment above.
  await state.setJSONWithTTL(activeK, mutated, AUTO_MUTATION_TTL_SEC);
  await telemetry?.decision("meta-agent", "prompt-auto-mutated", {
    agent, owner, repo, length: mutated.length, ttlSec: AUTO_MUTATION_TTL_SEC,
  });

  // Open a review PR so a human sees exactly what got auto-applied and why.
  // This does not block the current run — it's a notification + approval
  // surface, not a gate. Best-effort: a PR failure must not crash the pipeline.
  if (gh) {
    try {
      const title = `Meta-Agent: auto-mutated ${agent} prompt (expires in 1h unless promoted)`;
      const body =
        `## Meta-Agent — Auto-Applied Prompt Mutation\n\n` +
        `**Agent:** ${agent}\n` +
        `**Trigger:** schema-validation failure, then a successful in-run retry with this candidate.\n` +
        `**Status:** LIVE NOW, but expires in 1 hour unless a human promotes it.\n\n` +
        `### Validation error that triggered this\n\`\`\`\n${failure.error}\n\`\`\`\n\n` +
        `### Candidate prompt\n\`\`\`\n${mutated}\n\`\`\`\n\n` +
        `To make this permanent (14-day TTL), run \`promoteMutation()\` / the ` +
        `\`--promote-mutation ${agent}\` CLI flag after reviewing. Otherwise it lapses automatically.`;
      const prNumber = await gh.createBranchAndPR(title);
      await gh.commitViaGitDB(prNumber, [{ path: `.qodo/mutations/${agent}-${Date.now()}.md`, content: body }], title);
      await telemetry?.decision("meta-agent", "mutation-review-pr-opened", { agent, prNumber });
    } catch (e: unknown) {
      log.warn('meta-agent: failed to open mutation review PR (mutation applied with short TTL)', { error: e instanceof Error ? e.message : String(e) });
    }
  } else {
    log.warn('meta-agent: no GitHubClient — mutation applied without review PR', { agent, ttlSec: AUTO_MUTATION_TTL_SEC });
  }

  return mutated;
}

/**
 * Human-approval promotion path (V24 audit fix). Call this ONLY after a
 * person has reviewed the notification PR opened by mutatePrompt() above —
 * e.g. wire it to a `--promote-mutation <agent>` CLI flag or a
 * `pull_request: closed (merged)` workflow trigger on the `.qodo/mutations/`
 * path. Extends the mutation from the 1-hour auto TTL to the full 14 days.
 */
export async function promoteMutation(
  agent: "architect" | "coder" | "reviewer",
  state: RedisState,
  telemetry: Telemetry | undefined,
  owner: string,
  repo: string,
): Promise<boolean> {
  const activeK = activeKey(owner, repo, agent);
  const current = await state.getJSON<string>(activeK);
  if (current === null) {
    log.warn('meta-agent: no active mutation to promote', { agent });
    return false;
  }
  await state.setJSONWithTTL(activeK, current, FOURTEEN_DAYS_SEC);
  await telemetry?.decision("meta-agent", "prompt-promoted", { agent, owner, repo, ttlSec: FOURTEEN_DAYS_SEC });
  return true;
}

export async function rollbackLastMutation(
  agent: "architect" | "coder" | "reviewer",
  state: RedisState,
  telemetry: Telemetry | undefined,
  owner: string,
  repo: string,
): Promise<void> {
  const activeK = activeKey(owner, repo, agent);
  const historyK = historyKey(owner, repo, agent);
  const history = (await state.getJSON<MutationSnapshot[]>(historyK)) || [];
  if (!history.length) return;

  const { previous } = history.shift()!;
  if (previous) {
    await state.setJSONWithTTL(activeK, previous, FOURTEEN_DAYS_SEC);
  } else {
    await state.delete(activeK);
  }
  await state.setJSONWithTTL(historyK, history, FOURTEEN_DAYS_SEC);
  await telemetry?.decision("meta-agent", "prompt-rollback", { agent, owner, repo });
}
