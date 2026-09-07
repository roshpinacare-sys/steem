import { aiRoute, type RouterEnv } from "../services/ai-router.js";
import type { Telemetry } from "../services/telemetry.js";
import { RedisState } from "../services/redis-state.js";
import { classifyOpTier } from "../services/op-tier.js";
import { validateAndRetry } from "../utils/schema-validator.js";
import { ReviewerSchema } from "../schemas/reviewer-schema.js";
import type { ReviewerOutput } from "../schemas/reviewer-schema.js";
import { getActiveMutation } from "./meta-agent.js";

export type Review = ReviewerOutput;

const DEFAULT_PROMPT = `You are the REVIEWER. Return JSON {summary,annotations:[{path,start_line,end_line,annotation_level,message}]} for the diff vs the objective.`;

export async function runReviewer(
  objective: string,
  diff: string,
  state?: RedisState,
  telemetry?: Telemetry,
  owner?: string,
  repo?: string,
  env?: RouterEnv,
): Promise<Review> {
  const tier = classifyOpTier(diff);
  await telemetry?.decision("reviewer", "tier-selected", { tier, reason: "ts-morph-classification" });
  const mutated = state && owner && repo ? await getActiveMutation("reviewer", state, owner, repo) : null;
  const system = mutated || DEFAULT_PROMPT;
  const basePrompt = `${system}\nObjective: "${objective}"\nDiff:\n${diff}`;
  const review = await validateAndRetry(async (feedback) => {
    const prompt = feedback ? `${basePrompt}\n${feedback}` : basePrompt;
    return { prompt, raw: await aiRoute("review.json", tier, prompt, { telemetry, env }) };
  }, ReviewerSchema, 2);
  await telemetry?.decision("reviewer", "review-complete", { tier, annotations: review.annotations.length });
  return review;
}
