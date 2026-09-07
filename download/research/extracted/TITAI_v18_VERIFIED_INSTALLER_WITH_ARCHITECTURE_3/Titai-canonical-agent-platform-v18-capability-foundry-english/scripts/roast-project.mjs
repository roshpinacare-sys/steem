import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const outDir = path.join(root, "docs/roast/evidence");
fs.mkdirSync(outDir, { recursive: true });

const text = (file) => {
  try { return fs.readFileSync(path.join(root, file), "utf8"); }
  catch { return ""; }
};
const exists = (file) => fs.existsSync(path.join(root, file));
const pkg = JSON.parse(text("package.json"));

const checks = [];
function check(id, title, severity, pass, evidence, remediation) {
  checks.push({ id, title, severity, status: pass ? "pass" : "fail", evidence, remediation });
}

const runner = text("src/lib/engine/runner.ts");
const plan = text("src/lib/engine/plan.ts");
const egress = text("src/lib/security/egress.ts");
const httpFetch = text("src/lib/engine/tools/httpFetch.ts");
const agentApi = text("src/app/api/agents/route.ts");
const agentDetailApi = text("src/app/api/agents/[agentId]/route.ts");
const skillApi = text("src/app/api/skills/[skillId]/route.ts");
const policyApi = text("src/app/api/policies/route.ts");
const auditApi = text("src/app/api/audit/verify/route.ts");
const dbSchema = text("src/lib/db/schema.ts");
const dbIndex = text("src/lib/db/index.ts");
const gateway = text("src/lib/engine/gateway.ts");
const nextConfig = text("next.config.ts");
const auth = text("src/auth.ts") + text("src/lib/auth.ts") + text("src/app/api/register/route.ts");
const tools = [
  "src/lib/engine/tools/index.ts",
  "src/lib/engine/tools/validate.ts",
  "src/lib/engine/tools/calculator.ts",
  "src/lib/engine/tools/currentTime.ts",
  "src/lib/engine/tools/httpFetch.ts",
  "src/lib/engine/tools/simulateDeploy.ts",
  "src/lib/engine/tools/writeArtifact.ts",
].map(text).join("\n");
const writeArtifact = text("src/lib/engine/tools/writeArtifact.ts");

check("R-001", "Formal execution-plan validation", "critical",
  exists("src/lib/engine/plan.ts") && /cycle/i.test(plan) && /maxSteps/.test(plan),
  ["src/lib/engine/plan.ts", "tests/plan.test.ts"],
  "Validate bounds, identifiers, dependency references, duplicates, and cycles before a run starts.");
check("R-002", "Public-network egress guard", "critical",
  exists("src/lib/security/egress.ts") && /localhost|metadata/i.test(egress) && /redirect/i.test(httpFetch),
  ["src/lib/security/egress.ts", "src/lib/engine/tools/httpFetch.ts", "tests/egress.test.ts"],
  "Resolve and validate every destination and redirect; block private, loopback, link-local, and metadata networks.");
check("R-003", "Least-privilege default tool set", "high",
  /DEFAULT_AGENT_TOOLS/.test(tools) && /DEFAULT_AGENT_TOOLS/.test(agentApi),
  ["src/lib/engine/tools/index.ts", "src/app/api/agents/route.ts"],
  "New agents must receive an explicit minimal tool allowlist, never every registered tool.");
check("R-004", "Plan deadlock cannot become success", "critical",
  /remaining pending steps|blocked/i.test(runner) && /run\.failed/.test(runner),
  ["src/lib/engine/runner.ts", "tests/plan.test.ts"],
  "Fail or block the run when no step is ready while unfinished steps remain.");
check("R-005", "Tool-loop exhaustion cannot become success", "high",
  /tool iteration|iteration limit|maxTool/i.test(runner) && /failed/.test(runner),
  ["src/lib/engine/runner.ts"],
  "Mark the step failed when the model still requests tools after the iteration budget is exhausted.");
check("R-006", "Run admission control", "high",
  /MAX_ACTIVE_RUNS|active.*user|per user/i.test(runner),
  ["src/lib/engine/runner.ts"],
  "Bound global and per-user active runs and expose backpressure rather than allowing unbounded fan-out.");
check("R-007", "Skill ownership enforcement", "high",
  /userId|owner/i.test(skillApi) && /skill/i.test(agentDetailApi) && /userId|owner/i.test(agentDetailApi),
  ["src/app/api/skills/[skillId]/route.ts", "src/app/api/agents/[agentId]/route.ts"],
  "Only built-in or user-owned skills may be read or attached to an agent.");
check("R-008", "Administrative policy mutation", "high",
  /admin/i.test(policyApi),
  ["src/app/api/policies/route.ts"],
  "Require an explicit administrative role for shared policy mutation.");
check("R-009", "Audit log access restriction", "high",
  /admin/i.test(auditApi),
  ["src/app/api/audit/verify/route.ts"],
  "Restrict audit event access to authorized administrative or tenant-scoped principals.");
check("R-010", "Database migration fail-closed", "high",
  /throw/.test(dbIndex) && /migrat/i.test(dbIndex),
  ["src/lib/db/index.ts"],
  "Abort startup when required migrations fail.");
check("R-011", "Provider enabled flag enforced", "high",
  /enabled/.test(runner) && /provider_disabled/i.test(runner),
  ["src/lib/engine/gateway.ts", "src/lib/engine/runner.ts"],
  "A disabled provider must be ineligible for dispatch and test calls.");
check("R-012", "Artifact size bound", "medium",
  /1_?0?48_?576|1024 \* 1024|MAX.*ARTIFACT/i.test(writeArtifact),
  ["src/lib/engine/tools/writeArtifact.ts"],
  "Reject or stream artifacts above the documented limit.");
check("R-013", "Baseline browser security headers", "medium",
  /X-Content-Type-Options/.test(nextConfig) && /frame|DENY/i.test(nextConfig),
  ["next.config.ts"],
  "Set baseline browser security headers on all application routes.");
check("R-014", "Content Security Policy", "high",
  /Content-Security-Policy/i.test(nextConfig),
  ["next.config.ts"],
  "Add a tested CSP compatible with Next.js and the selected UI runtime.");
check("R-015", "Durable workflow worker", "critical",
  exists("src/lib/engine/durable-worker.ts") || /checkpoint.*resume|lease.*heartbeat/i.test(runner + dbSchema),
  ["src/lib/engine/runner.ts", "src/lib/db/schema.ts"],
  "Persist run leases, checkpoints, retries, cancellation, and resume state outside process memory.");
check("R-016", "Idempotency keys for side effects", "critical",
  /idempotency/i.test(dbSchema + runner),
  ["src/lib/db/schema.ts", "src/lib/engine/runner.ts"],
  "Persist idempotency keys and atomically bind side effects to event/audit records.");
check("R-017", "Tenant-scoped policies", "critical",
  /policies[\s\S]{0,800}(ownerId|tenantId)/i.test(dbSchema),
  ["src/lib/db/schema.ts"],
  "Add tenant ownership or explicitly enforce a single-user deployment mode.");
check("R-018", "Tenant-scoped templates", "high",
  /templates[\s\S]{0,800}(ownerId|tenantId)/i.test(dbSchema),
  ["src/lib/db/schema.ts"],
  "Scope custom templates to an owner or tenant and preserve built-in templates separately.");
check("R-019", "Backup and restore implementation", "critical",
  exists("src/lib/backup/application-backup.ts") && exists("scripts/backup-application.mjs") && exists("scripts/restore-application.mjs"),
  ["docs/canonical/24_HONEST_LIMITATIONS.md"],
  "Implement, version, encrypt, restore, and test a clean-machine backup workflow.");
check("R-020", "Governed memory subsystem", "high",
  /memories/i.test(dbSchema) && /provenance/i.test(dbSchema) && /expiresAt/i.test(dbSchema) && /contradictionRisk/i.test(dbSchema) && exists("src/lib/memory/governed-memory.ts"),
  ["src/lib/db/schema.ts", "docs/canonical/06_DATA_MEMORY_KNOWLEDGE.md"],
  "Implement provenance, correction, contradiction, expiry, deletion, and tenant isolation for memory.");
check("R-021", "OpenTelemetry or equivalent structured telemetry", "high",
  Object.keys(pkg.dependencies || {}).some((name) => name.includes("opentelemetry")) || exists("src/lib/telemetry") || exists("src/lib/observability/metrics.ts"),
  ["package.json", "docs/canonical/09_EVALUATION_OBSERVABILITY.md"],
  "Add traceable run, agent, model, tool, policy, cost, and verification events with privacy controls.");
check("R-022", "SBOM and release provenance", "high",
  exists("sbom.spdx.json") || exists("sbom.cdx.json") || exists("docs/release/SBOM.json") || exists("docs/canonical/evidence/release/SBOM.cyclonedx.json"),
  ["package.json", "docs/canonical/14_ACCEPTANCE_GATES.md"],
  "Generate and validate an SBOM, license report, model inventory, hashes, and build provenance.");
check("R-023", "Drizzle ORM security baseline", "high",
  (() => { const v = String(pkg.dependencies?.["drizzle-orm"] || ""); const m = v.match(/(\d+)\.(\d+)\.(\d+)/); return !!m && (+m[1] > 0 || +m[2] > 45 || (+m[2] === 45 && +m[3] >= 2)); })(),
  ["package.json", "docs/roast/evidence/npm-audit.json"],
  "Upgrade to a non-vulnerable supported Drizzle ORM release and rerun tests/migrations.");
check("R-024", "Registration hardening", "high",
  /registration.*(disabled|mode|invite|first user)/i.test(auth) && /min\((8|9|1\d)\)/.test(auth),
  ["src/app/api/register/route.ts"],
  "Add closed/invite/first-user registration modes, stronger password policy, and non-enumerating errors.");
check("R-025", "External content trust boundary", "high",
  /untrusted/i.test(httpFetch),
  ["src/lib/engine/tools/httpFetch.ts"],
  "Label fetched data as untrusted and prevent it from granting authority or overriding policy.");
check("R-026", "Explicit tool argument schemas", "high",
  /validateToolArguments/.test(runner + tools) && /parameters/.test(tools) && /additionalProperties/.test(tools),
  ["src/lib/engine/tools/index.ts"],
  "Validate every tool input against a versioned schema before execution.");
check("R-027", "English-only canonical package", "medium",
  exists("scripts/validate-english-only.mjs"),
  ["scripts/validate-english-only.mjs"],
  "Keep the language gate in the release pipeline and re-run it after ZIP extraction.");

const modelRouter = text("src/lib/models/router.ts") + text("src/lib/models/db-routing.ts");
const memoryPrompt = text("src/lib/memory/prompt-context.ts") + text("src/lib/engine/start.ts");
const capabilityBroker = text("src/lib/engine/tool-capability.ts") + text("src/lib/engine/tool-runtime.ts") + runner;
const dossier = text("src/components/runs/run-dossier.tsx") + text("src/components/operations/control-room.tsx");
const approvalContinuation = text("src/lib/durable/approval-continuation.ts");

check("R-028", "Measured model capability routing", "high",
  /No eligible model/.test(modelRouter) && /evaluationConfidence/.test(modelRouter) && /sovereignty/.test(modelRouter),
  ["src/lib/models/router.ts", "tests/model-router.test.ts"],
  "Route through measured hard constraints, deterministic utility scoring, fail-closed eligibility, and explicit fallback.");
check("R-029", "Governed memory prompt boundary", "critical",
  /untrusted contextual evidence/i.test(memoryPrompt) && /quarantined/i.test(memoryPrompt) && /restricted_memory/.test(memoryPrompt),
  ["src/lib/memory/prompt-context.ts", "tests/memory-prompt-context.test.ts"],
  "Quarantine instruction-like or sensitive memory and label selected records as evidence rather than authority.");
check("R-030", "Tool capability and runtime budgets", "critical",
  /tool_capability_denied/.test(capabilityBroker) && /tool_output_limit_exceeded/.test(capabilityBroker) && /tool_timeout/.test(capabilityBroker),
  ["src/lib/engine/tool-capability.ts", "src/lib/engine/tool-runtime.ts", "tests/tool-runtime.test.ts"],
  "Enforce allowlists, risk scopes, timeouts, output ceilings, and explicit network/filesystem capabilities.");
check("R-031", "Artifact idempotency receipt", "high",
  /artifacts_run_idempotency_uq/.test(dbSchema) && /idempotencyKey/.test(runner),
  ["src/lib/db/schema.ts", "drizzle/0005_v11_tool_idempotency.sql"],
  "Bind artifact creation to a stable run/step/tool receipt and reuse the persisted result on duplicate delivery.");
check("R-032", "Operator control dossier", "high",
  /Execution control record/.test(dossier) && /Operations signal plane/.test(dossier) && /incomplete control evidence/.test(dossier),
  ["src/components/runs/run-dossier.tsx", "src/components/operations/control-room.tsx"],
  "Expose model choice, governed context, authority, tool effects, recovery evidence, pressure, and SLO violations without generic success decoration.");
check("R-033", "Serializable approval continuation contract", "high",
  /approval_revision_conflict/.test(approvalContinuation) && /approval_already_terminal/.test(approvalContinuation) && /approval_expired/.test(approvalContinuation),
  ["src/lib/durable/approval-continuation.ts", "tests/approval-continuation.test.ts"],
  "Persist the contract behind approval waits and connect it to the active runner before claiming restart continuation.");
check("R-034", "Adversarial generated state-space tests", "high",
  exists("tests/adversarial-state-space.test.ts") && /generated directed cycle/.test(text("tests/adversarial-state-space.test.ts")),
  ["tests/adversarial-state-space.test.ts"],
  "Keep generated cycle, routing permutation, and illegal lifecycle tests in the safe release suite.");


const durableTypes = text("src/lib/durable/types.ts") + text("src/lib/durable/memory-store.ts") + text("src/lib/durable/sqlite-store.ts");
const stepRunner = text("src/lib/durable/step-runner.ts") + text("src/lib/engine/runner.ts");
const verification = text("src/lib/verification/attestation.ts") + text("src/lib/auth/authorization.ts") + text("src/app/api/runs/[runId]/verify/route.ts") + text("src/components/runs/verification-panel.tsx");
const approvalRoute = text("src/app/api/approvals/[approvalId]/route.ts");
const autonomy = text("src/lib/intelligence/risk-adjusted-autonomy.ts") + text("src/lib/engine/tool-capability.ts");
const readiness = text("src/lib/release/pilot-readiness.ts") + text("src/components/operations/control-room.tsx");
const memoryAblation = text("src/lib/evaluation/memory-ablation.ts") + text("tests/memory-ablation.test.ts");

check("R-035", "Lease fencing rejects stale workers", "critical",
  /leaseToken/.test(durableTypes) && /lease_not_owned/.test(durableTypes) && exists("tests/durable-fencing.test.ts"),
  ["src/lib/durable/types.ts", "src/lib/durable/sqlite-store.ts", "tests/durable-fencing.test.ts"],
  "Bind every durable mutation to a monotonically increasing fencing token and reject stale commits.");
check("R-036", "Step-level durable workflow", "critical",
  /agent_run_steps_v2/.test(stepRunner) && /executeStep/.test(stepRunner) && /recoverRunningStep/.test(stepRunner) && exists("tests/durable-step-runner.test.ts"),
  ["src/lib/durable/step-runner.ts", "src/lib/engine/runner.ts", "tests/durable-step-runner.test.ts"],
  "Persist and recover step progress rather than treating a whole agent run as one opaque durable action.");
check("R-037", "Hash-bound independent verification", "critical",
  /sourceTreeHash/.test(verification) && /releaseCandidateHash/.test(verification) && /verification_identity_collision/.test(verification) && /Not independently verified/.test(verification),
  ["src/lib/verification/attestation.ts", "src/app/api/runs/[runId]/verify/route.ts", "src/components/runs/verification-panel.tsx"],
  "Bind verifier decisions to immutable source, test, artifact, and release hashes and expose missing verification honestly.");
check("R-038", "Approval compare-and-set revision", "critical",
  /expectedRevision/.test(approvalRoute) && /approval_revision_conflict/.test(runner) && /revision/.test(dbSchema),
  ["src/app/api/approvals/[approvalId]/route.ts", "src/lib/engine/runner.ts", "drizzle/0006_v12_fencing_and_verification.sql"],
  "Reject stale or duplicate cross-process approval decisions with a database compare-and-set revision.");
check("R-039", "Risk-adjusted autonomy boundary", "high",
  /dry_run_side_effect_forbidden/.test(autonomy) && /model_or_memory_cannot_grant_authority/.test(autonomy) && /human_required/.test(autonomy),
  ["src/lib/intelligence/risk-adjusted-autonomy.ts", "tests/risk-adjusted-autonomy.test.ts"],
  "Derive autonomy from risk, reversibility, idempotency, and evidence; never from prompt-granted authority.");
check("R-040", "Pilot-readiness evidence gate", "high",
  /Unknown release evidence is treated as a blocker/.test(readiness) && /CONTROLLED INTERNAL PILOT/.test(readiness) && exists("tests/pilot-readiness.test.ts"),
  ["src/lib/release/pilot-readiness.ts", "src/components/operations/control-room.tsx", "tests/pilot-readiness.test.ts"],
  "Keep runtime calm separate from release readiness and classify unknown evidence conservatively.");
check("R-041", "Six-mode dynamic Roast", "high",
  exists("scripts/roast-dynamic.mjs") && /runtime/.test(text("scripts/roast-dynamic.mjs")) && /recovery/.test(text("scripts/roast-dynamic.mjs")) && /security/.test(text("scripts/roast-dynamic.mjs")),
  ["scripts/roast-dynamic.mjs"],
  "Run repeatable runtime, recovery, security, product, release, and performance audit modes.");
check("R-042", "Targeted semantic mutation probes", "high",
  exists("scripts/mutation-v12.ts") && /mutants killed/i.test(text("scripts/mutation-v12.ts")),
  ["scripts/mutation-v12.ts", "docs/canonical/evidence/v12/targeted-mutation-probes.json"],
  "Prove the adversarial suite detects removal of selected critical guards and state the scope limit honestly.");
check("R-043", "Verification-aware model routing", "high",
  /verificationQuality/.test(modelRouter) && /taskClass/.test(modelRouter) && /health_unavailable/.test(modelRouter),
  ["src/lib/models/router.ts", "tests/model-router.test.ts"],
  "Use measured verifier quality and model health as explicit routing signals and hard constraints.");
check("R-044", "Governed-memory ablation evidence", "high",
  /raw_semantic/.test(memoryAblation) && /unsafeActionRate/.test(memoryAblation) && /governed/.test(memoryAblation),
  ["src/lib/evaluation/memory-ablation.ts", "tests/memory-ablation.test.ts"],
  "Compare no-memory, raw retrieval, and governed retrieval under poisoning and token pressure before claiming benefit.");

const summary = checks.reduce((acc, item) => {
  acc.total += 1;
  acc[item.status] += 1;
  acc.bySeverity[item.severity] ??= { total: 0, fail: 0 };
  acc.bySeverity[item.severity].total += 1;
  if (item.status === "fail") acc.bySeverity[item.severity].fail += 1;
  return acc;
}, { total: 0, pass: 0, fail: 0, bySeverity: {} });

const result = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  projectVersion: pkg.version,
  scope: "Repeatable static roast gates; a passing check proves only the narrow property described.",
  summary,
  checks,
};
fs.writeFileSync(path.join(outDir, "roast-static-results.json"), JSON.stringify(result, null, 2) + "\n");

const lines = [
  "# Repeatable Static Roast Results",
  "",
  `Generated: ${result.generatedAt}`,
  "",
  `Result: **${summary.pass}/${summary.total} checks passed; ${summary.fail} remain open.**`,
  "",
  "This scanner is intentionally conservative. It does not replace runtime, security, accessibility, or recovery testing.",
  "",
  "| ID | Severity | Status | Check |",
  "|---|---|---|---|",
  ...checks.map((c) => `| ${c.id} | ${c.severity.toUpperCase()} | ${c.status.toUpperCase()} | ${c.title} |`),
  "",
  "## Open Static Gaps",
  "",
  ...checks.filter((c) => c.status === "fail").flatMap((c) => [
    `### ${c.id} — ${c.title}`,
    "",
    `Severity: **${c.severity.toUpperCase()}**`,
    "",
    c.remediation,
    "",
    `Evidence targets: ${c.evidence.map((e) => `\`${e}\``).join(", ")}`,
    "",
  ]),
];
fs.writeFileSync(path.join(outDir, "roast-static-results.md"), lines.join("\n"));

console.log(`Roast static scan complete: ${summary.pass}/${summary.total} passed; ${summary.fail} open.`);
if (process.argv.includes("--strict") && summary.fail > 0) process.exit(1);
