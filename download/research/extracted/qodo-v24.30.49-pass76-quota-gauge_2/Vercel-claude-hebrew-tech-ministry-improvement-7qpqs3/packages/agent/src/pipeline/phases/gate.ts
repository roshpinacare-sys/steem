import { assertNotHalted } from "../../services/kill-switch.js";
import { lockfileGuardian } from "../../validators/lockfile-guardian.js";
import { blastRadius } from "../../validators/blast-radius.js";
import { domXray } from "../../validators/dom-xray.js";
import { shadowTraffic } from "../../validators/shadow-traffic.js";
import { chaosMonkey } from "../../validators/chaos-monkey.js";
import {
  loadFlakyTestIndex,
  buildFlakyTestIndex,
  matchFlakyTests,
  GitHubActionsFlakyConfigSchema,
} from "../../services/integrations/github-actions-flaky.js";
import { notifySlack, resolveSlackConfig } from "../../services/integrations/slack-webhook.js";
import { runRedTeam } from "../../services/red-team.js";
import { EdgeTestClient } from "../../services/edge-test-channel.js";
import { tryOffloadToClient, runLocalNpmTest } from "../../services/edge-test-offload.js";
import { guardApiContracts } from "../../services/api-contract-guard.js";
import { saveCachedPatch, saveHivePatch, quarantinePatch } from "../../services/semantic-cache.js";
import { embedAndStoreSkill } from "../../services/vector-skill-exchange.js";
import { loadTrustLedger } from "../../services/trust-ledger.js";
import { sampleUncertaintyAsync } from "../../services/uncertainty-sampling.js";
import { isSovereignLocal } from "../../services/local/sovereign-llm.js";
import type { GateResult } from "../../types/run-state.js";
import { audit, runGuarded, saveCheckpoint } from "../helpers.js";
import type { PhaseContext, PhaseOutcome } from "../context.js";

/** 5-gate validation (+ flaky-index, red-team, P2P test grid, contract guard). */
export async function runGatePhase(ctx: PhaseContext): Promise<PhaseOutcome> {
  const { s, env, objective, owner, repo, prNumber, prSha, runId, runLog, gh, state, storage, telemetry, reporter, supervisorDecision, ledgerCategory, targetFiles } = ctx;

  assertNotHalted(env); // kill-switch: stop before gate validators run

  // Sovereign local runs skip the Xenova-embedder-backed accelerators (semantic
  // cache, hive, skill vector store): they would try to download a model and
  // hang an offline run. They are optional speed/quality boosts, never part of
  // the core validation path — the gates themselves are unchanged.
  const sovereignLocal = isSovereignLocal(env);
  s.phase = "gate";
  const shas = await gh.getPRShas(prNumber);
  const lockCheck = shas
    ? await runGuarded("lockfile", () => lockfileGuardian(gh, shas.base, shas.head), telemetry)
    : { allowed: true, skipped: true };
  // Pass 19 fix: supply opts so the git-blame risk amplifier is actually invoked.
  const blast = await runGuarded(
    "blast",
    () => blastRadius(objective, s.patch!.diff, {
      targetFiles: Array.from(targetFiles),
      owner,
      repo,
      telemetry,
      sovereignLocal,
    }),
    telemetry,
  );
  const dom = await runGuarded("dom", () => domXray(env.VERCEL_PREVIEW_URL || "", env.VERCEL_AUTOMATION_BYPASS_SECRET), telemetry);
  const shadow = await runGuarded("shadow", () => shadowTraffic(env.VERCEL_PREVIEW_URL || "", env.VERCEL_AUTOMATION_BYPASS_SECRET), telemetry);
  const chaos = await runGuarded("chaosMonkey", () => chaosMonkey(s.patch!, s.plan!).then((r): GateResult => ({ allowed: r.allowed, reason: r.reason, adversarialCases: r.adversarialCases })), telemetry);

  const testFiles = s.patch!.files.map((f) => f.path);
  const testCommand = env.QODO_TEST_COMMAND;

  // ── Flaky-test index: load or build, then consult before running tests ──
  // Pass 19 fix: wire the flaky-test integration into the gate phase.
  const flakyConfig = env.GITHUB_TOKEN && !sovereignLocal
    ? GitHubActionsFlakyConfigSchema.safeParse({ token: env.GITHUB_TOKEN, owner, repo })
    : null;
  const flakyIndex = flakyConfig?.success
    ? await loadFlakyTestIndex(state)
        .then((idx) => idx.length ? idx : buildFlakyTestIndex(flakyConfig.data, state, telemetry))
        .catch(() => [] as import("../../services/integrations/github-actions-flaky.js").FlakyTestEntry[])
    : [];
  const flakyMatches = matchFlakyTests(testFiles, flakyIndex);
  // Bridge 3: Flaky test × Warden memory — downgrade confidence if overlapping
  if (flakyMatches.length) {
    runLog.warn("flaky tests detected in target files", {
      count: flakyMatches.length,
      tests: flakyMatches.map((m) => m.testName),
    });
    await telemetry?.decision("github-actions-flaky", "gate-warning", {
      flakyCount: flakyMatches.length,
      tests: flakyMatches.map((m) => m.testName),
    });
  }

  // J2: Red-Team adversarial pass (advisory — does not block gate alone)
  const redTeamResult = supervisorDecision.skipHeavyValidators
    ? null
    : await runRedTeam(objective, s.patch!.diff, env as import("../../services/ai-router.js").RouterEnv, telemetry).catch(() => null);
  if (redTeamResult?.hasHighSeverity) {
    runLog.warn("red-team: high-severity findings before gate", {
      findings: redTeamResult.findings.filter((f) => f.severity === "high").map((f) => f.scenario),
    });
    await telemetry?.decision("red-team", "high-severity-gate-advisory", {
      count: redTeamResult.findings.length,
    });
    audit(runId, "red-team-high-severity", {
      count: redTeamResult.findings.length,
      scenarios: redTeamResult.findings.map((f) => f.scenario),
    });
  }

  // ── P2P Test Grid: attempt to offload to a Mission Control peer first ──
  let test: GateResult;
  if (sovereignLocal) {
    // No target-repo checkout exists in a sovereign eval (the diff targets a
    // synthetic file), and running the agent's own suite here would be
    // nonsensical — record the test validator as a clean, explicit skip.
    test = { allowed: true, skipped: true };
    await telemetry?.decision("edge-test", "sovereign-local-skip", {});
  } else {
  const p2pClient = new EdgeTestClient(state, telemetry);
  const p2pResult = await p2pClient.send({ files: testFiles, command: testCommand }).catch(() => null);
  if (p2pResult !== null) {
    await telemetry?.decision("edge-test-channel", "p2p-result", {
      exitCode: p2pResult.exitCode,
      outputLength: p2pResult.output.length,
    });
    test = { allowed: p2pResult.exitCode === 0 };
  } else {
    // ── Edge Offload: try the existing WebSocket/HTTP offload path ──────
    const offloaded = await tryOffloadToClient(testFiles, testCommand, telemetry, state, env);
    test = offloaded !== null
      ? { allowed: offloaded }
      : await runGuarded("test", () => runLocalNpmTest(telemetry, env.NODE_ENV === "test").then((r): GateResult => ({ allowed: r.allowed, skipped: r.skipped, error: r.error })), telemetry);
  }
  }

  // R1: API contract diffing for OpenAPI/GraphQL schema files.
  const schemaFiles: Record<string, string> = {};
  for (const f of s.patch!.files) {
    if (/openapi|swagger|\.graphql|\.gql$/i.test(f.path)) {
      schemaFiles[f.path] = f.content;
    }
  }
  const contractGuard = Object.keys(schemaFiles).length > 0
    ? await (async () => {
        try {
          const baseFiles: Record<string, string> = {};
          for (const path of Object.keys(schemaFiles)) {
            const base = await gh.getFileAtRef(path, shas?.base || "HEAD").catch(() => null);
            if (base) baseFiles[path] = base;
          }
          return guardApiContracts(baseFiles, schemaFiles, telemetry);
        } catch {
          return { passed: true, breakingChanges: [], additiveChanges: [] };
        }
      })()
    : { passed: true, breakingChanges: [] as import("../../services/api-contract-guard.js").ContractChange[], additiveChanges: [] as import("../../services/api-contract-guard.js").ContractChange[] };

  s.gate = { lockCheck, blast, dom, shadow, chaos, test, contractGuard };
  await saveCheckpoint(owner, repo, prNumber, state, s);

  const gateOpen = lockCheck.allowed && blast.allowed && dom.allowed && shadow.allowed && chaos.allowed && test.allowed && contractGuard.passed;
  runLog.info("gate evaluated", { phase: "gate", gateOpen });
  await reporter.report(s, { gate: s.gate as import("../../services/pr-reporter.js").GateResultSummary });
  audit(runId, "gate-evaluated", { gateOpen, results: { lockCheck: lockCheck.allowed, blast: blast.allowed, dom: dom.allowed, shadow: shadow.allowed, chaos: chaos.allowed, test: test.allowed, contractGuard: contractGuard.passed } });

  // Pass 19: broadcast gate decision to Slack
  const slackCfg = resolveSlackConfig();
  if (slackCfg) {
    if (!gateOpen) {
      const failedGates = Object.entries(s.gate!)
        .filter(([, v]) => !(v as { allowed: boolean }).allowed)
        .map(([k]) => k);
      await notifySlack(
        {
          type: "gate_failure",
          phase: "gate",
          message: `Gate blocked PR #${prNumber}: ${objective.slice(0, 120)}. Failed checks: ${failedGates.join(", ")}`,
          ref: prNumber,
        },
        slackCfg,
        telemetry,
      );
    } else {
      await notifySlack(
        {
          type: "phase_transition",
          phase: "gate",
          message: `Gate passed for PR #${prNumber}: ${objective.slice(0, 120)}`,
          ref: prNumber,
        },
        slackCfg,
        telemetry,
      );
    }
  }

  if (!gateOpen) {
    if (!sovereignLocal) await quarantinePatch(objective, s.plan!, s.patch!, storage);
    audit(runId, "gate-blocked", { gate: s.gate });
    await gh.checkRun(prSha, "failure", "Qodo V24 Gate", JSON.stringify(s.gate, null, 2), []);
    return "halt";
  }

  // S1 + V1: Active-learning review routing.
  // Even if the gate passed, high uncertainty or a probationary trust bond
  // can force Mentor Mode so a human validates the edge case.
  const trustBond = await loadTrustLedger(owner, repo, state).then((l) =>
    l.bonds.find((b) => b.category === ledgerCategory),
  );
  const blastScore = (s.gate?.blast as unknown as { score?: number })?.score ?? 0;
  const confidenceScore = typeof blastScore === "number" ? blastScore * 100 : 70;
  const uncertainty = await sampleUncertaintyAsync(
    {
      objective,
      category: ledgerCategory,
      confidenceScore,
      redTeamHighSeverity: redTeamResult?.hasHighSeverity ?? false,
      trustBondScore: trustBond?.score ?? 50,
    },
    state,
    telemetry,
  );
  if (uncertainty.route === "mentor-mode" && env.QODO_MENTOR_MODE !== "true") {
    // Respect an explicit owner pre-approval (`.qodo/policy.yml approval:
    // auto`): the repo owner has opted out of the interactive gate from the
    // trunk. The escalation is still recorded so the override is auditable.
    if (ctx.policy.approval === "auto") {
      runLog.warn("uncertainty-sampling: high uncertainty, but approval:auto — not forcing Mentor Mode", {
        uncertainty: uncertainty.uncertainty,
        reason: uncertainty.reason,
      });
    } else {
      runLog.warn("uncertainty-sampling: forcing Mentor Mode due to high uncertainty", {
        uncertainty: uncertainty.uncertainty,
        reason: uncertainty.reason,
      });
      process.env.QODO_MENTOR_MODE = "true";
    }
  }

  if (ctx.generatedPatch && !sovereignLocal) {
    await saveCachedPatch(objective, s.plan!, s.patch!, storage);
    await saveHivePatch(objective, s.plan!, s.patch!, owner, repo, storage, env);
  }

  // Vectorize the successful patch as a reusable skill in Upstash Vector + R2.
  if (!sovereignLocal) {
    await embedAndStoreSkill(
      {
        id: `${owner}-${repo}-pr${prNumber}-${Date.now()}`,
        name: objective.slice(0, 120),
        pattern: s.plan!.steps.map((st) => st.description).join("; "),
        promptFragment: s.patch!.diff.slice(0, 4096),
      },
      storage,
      telemetry,
      env,
    );
  }

  return "continue";
}
