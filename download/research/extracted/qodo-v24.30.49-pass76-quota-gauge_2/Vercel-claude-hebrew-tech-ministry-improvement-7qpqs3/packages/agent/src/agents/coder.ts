import { aiRoute, classifyFile, type RouterEnv } from "../services/ai-router.js";
import type { Telemetry } from "../services/telemetry.js";
import { RedisState } from "../services/redis-state.js";
import { validateAndRetry } from "../utils/schema-validator.js";
import { guardPaths } from "../utils/path-guard.js";
import { appendAuditEntry } from "../services/audit-log.js";
import { CoderSchema } from "../schemas/coder-schema.js";
import type { CoderOutput } from "../schemas/coder-schema.js";
import type { Plan } from "./architect.js";
import { obfuscatePrefetch, reconstituteCode, hasUnmappedTokens, type ObfuscationMapping } from "../services/obfuscator.js";
import { wardenGuard } from "./warden.js";
import { loadWardenLessons } from "../services/warden-memory.js";
import { getActiveMutation } from "./meta-agent.js";
import { formatStylePrompt, type StyleRules } from "./style-aligner.js";

export type Patch = CoderOutput;

const DEFAULT_PROMPT = `You are the CODER. Emit JSON {diff:"unified diff",files:[{path,content}]} implementing the plan. File contents are provided upfront — do NOT use read_file tools.`;

function applyPrivacyMode(
  prefetch: Record<string, string>,
  privacyMode?: string,
): { prefetch: Record<string, string>; mapping: ObfuscationMapping | null } {
  if (privacyMode !== "strict") return { prefetch, mapping: null };
  return obfuscatePrefetch(prefetch);
}

function reconstitutePatch(patch: Patch, mapping: ObfuscationMapping | null): Patch {
  if (!mapping) return patch;
  return {
    diff: reconstituteCode(patch.diff, mapping),
    files: patch.files.map((f) => ({ path: f.path, content: reconstituteCode(f.content, mapping) })),
  };
}

function mergeFileMap(prefetch: Record<string, string>, fileMap: Record<string, string>): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const [path, content] of Object.entries(prefetch)) {
    merged[path] = fileMap[path] ? `[CARTOGRAPHER SUMMARY]\n${fileMap[path]}` : content;
  }
  return merged;
}

export async function runCoder(
  objective: string,
  plan: Plan,
  prefetch: Record<string, string>,
  state?: RedisState,
  telemetry?: Telemetry,
  referencePatch?: Patch,
  fileMap: Record<string, string> = {},
  owner?: string,
  repo?: string,
  styleRules?: StyleRules,
  privacyMode?: string,
  env?: RouterEnv,
  runId?: string,
): Promise<Patch> {
  const primary = plan.steps[0]?.files[0] || "src/index.ts";
  const tier = classifyFile(primary);
  const mutated = state && owner && repo ? await getActiveMutation("coder", state, owner, repo) : null;

  const wardenLessons = state && owner && repo ? await loadWardenLessons(owner, repo, state, 5) : [];
  const wardenBlock = wardenLessons.length
    ? `\nKnown Warden violations in this repo — avoid these proactively:\n${wardenLessons
        .map((l) => `- ${l.path}: ${l.rule} (${l.count}×)`)
        .join("\n")}`
    : "";

  const styleBlock = styleRules ? `\n${formatStylePrompt(styleRules)}` : "";

  const system = [mutated || DEFAULT_PROMPT, wardenBlock, styleBlock].filter(Boolean).join("\n");

  const contextualPrefetch = mergeFileMap(prefetch, fileMap);
  const { prefetch: safePrefetch, mapping } = applyPrivacyMode(contextualPrefetch, privacyMode);

  let referenceBlock = "";
  // In strict privacy mode the reference patch (cross-repo Hive hit) must not
  // enter the prompt, because we have no mapping for its original symbol names.
  // Hive sharing is already disabled when QODO_PRIVACY_MODE=strict via
  // env-validator / getHiveShareMode; this guard is defense-in-depth against any
  // future path that passes an active mapping together with a reference patch.
  if (referencePatch && !mapping) {
    referenceBlock = `\nReference patch from a similar repo (use as style/example only, do NOT copy directly):\n${JSON.stringify(referencePatch)}`;
  }

  const basePrompt = `${system}\nObjective: ${objective}\nPlan: ${JSON.stringify(plan)}${referenceBlock}\nFile contents:\n${JSON.stringify(safePrefetch)}`;
  const patch = await validateAndRetry(async (feedback) => {
    const prompt = feedback ? `${basePrompt}\n${feedback}` : basePrompt;
    return { prompt, raw: await aiRoute(primary, tier, prompt, { telemetry, env }) };
  }, CoderSchema, 2, (p) => wardenGuard(p, state, owner, repo, telemetry));

  const finalPatch = reconstitutePatch(patch, mapping);

  if (mapping && hasUnmappedTokens(JSON.stringify(finalPatch), mapping)) {
    await telemetry?.decision("coder", "privacy-reject", { reason: "unmapped VAR_N tokens remain" });
    throw new Error("Privacy mode rejection: AI output contains unmapped VAR_N tokens");
  }

  const guard = guardPaths(finalPatch.files as { path: string; content: string }[]);
  if (!guard.allowed) {
    await telemetry?.decision("coder", "path-guard-blocked", { blocked: guard.blocked });
    try {
      appendAuditEntry(process.cwd(), "path-guard-blocked", runId || "qodo-agent", {
        blocked: guard.blocked,
        files: finalPatch.files.map((f) => f.path),
        owner,
        repo,
      });
    } catch {
      // Best-effort audit.
    }
    throw new Error(`Coder produced blocked paths: ${guard.blocked.join(", ")}`);
  }

  await telemetry?.decision("coder", "patch-generated", { tier, files: finalPatch.files.length });
  return finalPatch;
}
