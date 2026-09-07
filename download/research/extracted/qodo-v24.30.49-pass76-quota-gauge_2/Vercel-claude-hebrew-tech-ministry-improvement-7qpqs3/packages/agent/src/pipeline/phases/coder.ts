import { runCoder } from "../../agents/coder.js";
import { runPhase } from "../../services/phase-runner.js";
import { assertNotHalted } from "../../services/kill-switch.js";
import { findCachedPatch, findHiveReference } from "../../services/semantic-cache.js";
import { fetchStyleRules } from "../../agents/style-aligner.js";
import { runUiSynthesizer } from "../../agents/ui-synthesizer.js";
import { runInfraOracle } from "../../agents/infra-oracle.js";
import { SemanticDagLock } from "../../services/semantic-dag.js";
import { secretGuard, SecretGuardError } from "../../validators/secret-guard.js";
import { audit, runWithMutationRetry, saveCheckpoint } from "../helpers.js";
import type { PhaseContext } from "../context.js";

/** Coder — generate (or reuse) the patch under swarm file locks. */
export async function runCoderPhase(ctx: PhaseContext): Promise<void> {
  const { s, env, objective, owner, repo, prNumber, prSha, runId, runLog, gh, state, storage, telemetry, targetFiles } = ctx;

  assertNotHalted(env); // kill-switch: stop before any file writes
  s.phase = "coder";

  const dag = new SemanticDagLock(state, telemetry);
  const conceptLocks = await dag.acquireConceptLock(Array.from(targetFiles));

  try {
    // Swarm file locking: acquire a Redis lock for each target file to
    // prevent concurrent agents from writing the same path.
    const locked: { path: string; token: string }[] = [];
    try {
      for (const path of targetFiles) {
        const token = await state.waitForFileLock(path);
        if (!token) {
          throw new Error(`Unable to acquire file lock for ${path}; another swarm agent may be editing it`);
        }
        locked.push({ path, token });
      }

      const referencePatch = await findHiveReference(objective, s.plan!, owner, s.prefetch || {}, storage, telemetry, env);
      const cached = await findCachedPatch(objective, s.plan!, s.prefetch || {}, storage, telemetry, env);
      const styleRules = await fetchStyleRules(gh, telemetry);
      if (cached) {
        s.patch = cached;
        await telemetry?.decision("coder", "cache-hit", { provider: "local" });
      } else {
        ctx.generatedPatch = true;
        s.patch = await runPhase(
          "coder",
          () => runWithMutationRetry(
            "coder",
            () => runCoder(objective, s.plan!, s.prefetch || {}, state, telemetry, referencePatch || undefined, s.fileMap || {}, owner, repo, styleRules, env.QODO_PRIVACY_MODE, env, runId),
            owner,
            repo,
            state,
            telemetry,
            gh,
            env,
          ),
          { telemetry, logger: runLog.child({ phase: "coder" }), timeoutMs: 240_000 },
        );
      }
      await telemetry?.decision("coder", "patch-generated", {
        fileCount: s.patch!.files.length,
        diffLength: s.patch!.diff.length,
        files: s.patch!.files.map((f) => f.path),
      });
      audit(runId, "coder-patch-generated", {
        fileCount: s.patch!.files.length,
        files: s.patch!.files.map((f) => f.path),
      });

      try {
        secretGuard(s.patch!);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        await telemetry?.decision("secret-guard", "blocked", { reason: msg });
        audit(runId, "secret-guard-blocked", { reason: msg, files: s.patch!.files.map((f) => f.path) });
        await gh.comment(prNumber, `🛡️ Secret Guard blocked the patch:\n${msg}`);
        await gh.checkRun(prSha, "failure", "Qodo V24 Secret Guard", msg, []);
        throw new SecretGuardError(msg);
      }

      await runUiSynthesizer(s.patch!, gh, prNumber, telemetry);

      const infraPatches = await runInfraOracle(s.patch!, gh, storage, telemetry);
      if (infraPatches.length) {
        s.infraPatch = infraPatches;
      }

      await storage.putText(`patches/${prNumber}-${Date.now()}.diff`, s.patch.diff);
      await saveCheckpoint(owner, repo, prNumber, state, s);
    } finally {
      for (const l of locked) await state.releaseFileLock(l.path, l.token);
    }
  } finally {
    await dag.releaseAll(conceptLocks);
  }
}
