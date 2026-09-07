/**
 * Seeds disposable demo data only when explicitly authorized.
 * Environment values are loaded before the database module is imported.
 */
import nextEnv from "@next/env";
import type { AgentTier } from "../src/lib/db/schema";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

if (process.env.TITAI_ALLOW_DESTRUCTIVE_SEED !== "1") {
  throw new Error(
    "Refusing destructive demo seed. Set TITAI_ALLOW_DESTRUCTIVE_SEED=1 in a disposable environment.",
  );
}
const demoPassword = process.env.TITAI_DEMO_PASSWORD;
if (!demoPassword || demoPassword.length < 12) {
  throw new Error("TITAI_DEMO_PASSWORD must be set to at least 12 characters.");
}
const verifiedDemoPassword = demoPassword;
process.env.DATABASE_PATH ??= "./data/titai.db";

const DEMO_EMAIL = "demo@titai.dev";

async function main() {
  const [
    { eq },
    { db, schema },
    { hashPassword },
    { buildSkillMd },
    { DEFAULT_POLICY },
    { ALL_TOOL_NAMES },
    { runManager },
    { createId },
    { ensurePersonalPilotScope },
  ] = await Promise.all([
    import("drizzle-orm"),
    import("../src/lib/db"),
    import("../src/lib/auth/password"),
    import("../src/lib/engine/skills"),
    import("../src/lib/engine/policy"),
    import("../src/lib/engine/tools"),
    import("../src/lib/engine/runner"),
    import("../src/lib/ids"),
    import("../src/lib/auth/pilot-scope"),
  ]);

  // Clean previous demo user (cascade clears their agents/runs/etc).
  const existing = db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, DEMO_EMAIL))
    .get();
  if (existing) {
    db.delete(schema.users).where(eq(schema.users.id, existing.id)).run();
  }
  // Reset built-in skills, templates, policies so re-seeding is clean.
  db.delete(schema.templates).run();
  db.delete(schema.policies).run();

  const userId = createId();
  db.insert(schema.users)
    .values({
      id: userId,
      email: DEMO_EMAIL,
      name: "Demo",
      passwordHash: await hashPassword(verifiedDemoPassword),
      role: "admin",
    })
    .run();
  console.log("• demo user created:", DEMO_EMAIL);
  const pilotScope = ensurePersonalPilotScope(userId);
  console.log("• personal pilot scope created:", pilotScope.tenantId, pilotScope.workspaceId);

  // Default policy.
  db.insert(schema.policies)
    .values({
      name: DEFAULT_POLICY.name,
      description: DEFAULT_POLICY.description,
      priority: DEFAULT_POLICY.priority,
      rules: DEFAULT_POLICY.rules,
      ownerId: null,
      isBuiltin: true,
    })
    .run();

  // Built-in skills.
  const builtinSkills = [
    {
      name: "Concise Writer",
      description: "Write tersely; prefer short sentences and bullet points.",
      body: "- Prefer short sentences.\n- Lead with the answer.\n- Use bullet points over long paragraphs.\n- Cut filler words.",
    },
    {
      name: "Structured Researcher",
      description: "Investigate a topic methodically and cite tradeoffs.",
      body: "When researching:\n1. Enumerate the candidate approaches.\n2. Compare on cost, complexity, and reliability.\n3. State an explicit recommendation with the reasoning.",
    },
    {
      name: "Deploy Checklist",
      description: "Apply a safety checklist before any deployment.",
      body: "Before deploying:\n- Confirm the change is verified.\n- Start with a small canary.\n- Watch key signals before ramping to 100%.\n- Have a rollback ready.",
    },
  ];
  const skillIds: string[] = [];
  for (const s of builtinSkills) {
    const skillId = createId();
    const versionId = createId();
    const raw = buildSkillMd({ name: s.name, description: s.description }, s.body);
    db.insert(schema.skills)
      .values({
        id: skillId,
        ownerId: null,
        name: s.name,
        slug: s.name.toLowerCase().replace(/\s+/g, "-"),
        description: s.description,
        currentVersionId: versionId,
        isBuiltin: true,
      })
      .run();
    db.insert(schema.skillVersions)
      .values({
        id: versionId,
        skillId,
        version: 1,
        frontmatter: { name: s.name, description: s.description },
        body: s.body,
        raw,
      })
      .run();
    skillIds.push(skillId);
  }
  console.log(`• ${skillIds.length} built-in skills`);

  // Agents across tiers.
  const agentDefs: {
    name: string;
    tier: AgentTier;
    description: string;
    prompt: string;
    skills: number[];
  }[] = [
    {
      name: "Orchestrator",
      tier: "executive",
      description: "Plans and coordinates multi-step objectives end to end.",
      prompt:
        "You are Orchestrator, a senior planning agent. Break objectives into clear steps and drive them to completion.",
      skills: [1],
    },
    {
      name: "Builder",
      tier: "engineering",
      description: "Implements changes and produces concrete artifacts.",
      prompt:
        "You are Builder, a meticulous engineering agent. Implement the objective and document what you did.",
      skills: [0, 2],
    },
    {
      name: "Auditor",
      tier: "quality",
      description: "Reviews work, verifies results, and flags risks.",
      prompt:
        "You are Auditor, a rigorous quality agent. Verify results and surface risks before anything ships.",
      skills: [0],
    },
  ];
  const agentIds: string[] = [];
  for (const a of agentDefs) {
    const agentId = createId();
    const versionId = createId();
    db.insert(schema.agents)
      .values({
        id: agentId,
        ownerId: userId,
        tenantId: pilotScope.tenantId,
        workspaceId: pilotScope.workspaceId,
        visibility: "workspace",
        name: a.name,
        slug: a.name.toLowerCase(),
        description: a.description,
        tier: a.tier,
        status: "active",
        currentVersionId: versionId,
      })
      .run();
    db.insert(schema.agentVersions)
      .values({
        id: versionId,
        agentId,
        version: 1,
        systemPrompt: a.prompt,
        provider: "simulation",
        model: "sim-1",
        tools: ALL_TOOL_NAMES,
        createdBy: userId,
      })
      .run();
    for (const si of a.skills) {
      db.insert(schema.agentSkills)
        .values({ agentId, skillId: skillIds[si], pinnedVersionId: null })
        .run();
    }
    agentIds.push(agentId);
  }
  console.log(`• ${agentIds.length} agents`);

  // Templates.
  const templates = [
    { kind: "objective" as const, name: "Research & recommend", description: "Research the top approaches to a problem and recommend one.", payload: { objective: "Research the top 3 approaches to rate-limiting a public API and recommend one with reasoning." } },
    { kind: "objective" as const, name: "Build a feature", description: "Implement a feature end to end and deploy it safely.", payload: { objective: "Build and deploy a dark-mode toggle for the settings page behind a feature flag." } },
    { kind: "objective" as const, name: "Security review", description: "Audit a component for security issues.", payload: { objective: "Review the authentication flow for security weaknesses and list prioritized fixes." } },
    { kind: "objective" as const, name: "Refactor for clarity", description: "Refactor a messy module without changing behavior.", payload: { objective: "Refactor the reporting module for readability while preserving behavior; verify with a checklist." } },
    { kind: "agent" as const, name: "Research Analyst", description: "A methodical research agent that compares options and recommends.", tier: "quality" as AgentTier, payload: { name: "Research Analyst", description: "Compares options methodically and recommends.", tier: "quality", systemPrompt: "You are Research Analyst. Investigate thoroughly, compare tradeoffs, and give a clear recommendation.", provider: "simulation", model: "sim-1", tools: ALL_TOOL_NAMES } },
    { kind: "agent" as const, name: "Release Manager", description: "Owns safe rollouts with canaries and checklists.", tier: "release" as AgentTier, payload: { name: "Release Manager", description: "Owns safe rollouts with canaries.", tier: "release", systemPrompt: "You are Release Manager. Ship changes safely using canaries and rollbacks.", provider: "simulation", model: "sim-1", tools: ALL_TOOL_NAMES } },
  ];
  for (const t of templates) {
    db.insert(schema.templates)
      .values({
        ownerId: null,
        kind: t.kind,
        name: t.name,
        description: t.description,
        tier: "tier" in t ? (t.tier as AgentTier) : null,
        payload: t.payload,
        isBuiltin: true,
      })
      .run();
  }
  console.log(`• ${templates.length} templates`);

  // Sample runs — one completed research run, one build run that will park on approval.
  const research = await runManager.startRun({
    userId,
    tenantId: pilotScope.tenantId,
    workspaceId: pilotScope.workspaceId,
    objective: "Research and compare caching strategies for a read-heavy API",
    agentId: agentIds[0],
    agentVersionId: null,
    agentName: "Orchestrator",
    agentTier: "executive",
    systemPrompt: "You are Orchestrator.",
    provider: "simulation",
    model: "sim-1",
    temperature: 0.5,
    maxSteps: 8,
    maxToolIterations: 4,
    tools: ALL_TOOL_NAMES,
    skillVersionIds: [],
    dryRun: false,
    maxOutputTokens: 4096,
    maxContextTokens: 32_000,
  });
  console.log("• sample research run:", research.runId);

  const build = await runManager.startRun({
    userId,
    tenantId: pilotScope.tenantId,
    workspaceId: pilotScope.workspaceId,
    objective: "Build and deploy the new onboarding banner",
    agentId: agentIds[1],
    agentVersionId: null,
    agentName: "Builder",
    agentTier: "engineering",
    systemPrompt: "You are Builder.",
    provider: "simulation",
    model: "sim-1",
    temperature: 0.5,
    maxSteps: 8,
    maxToolIterations: 4,
    tools: ALL_TOOL_NAMES,
    skillVersionIds: [],
    dryRun: false,
    maxOutputTokens: 4096,
    maxContextTokens: 32_000,
  });
  console.log("• sample build run (will await approval):", build.runId);

  // Give the detached runs a moment to progress before the process exits.
  await new Promise((r) => setTimeout(r, 2500));

  console.log("\nSeed complete. Sign in with demo@titai.dev and the operator-supplied TITAI_DEMO_PASSWORD.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
