'use strict';
/**
 * lib/systemCapabilities208.js — ECOS V208 (Phase P97)
 *
 * Research sources:
 *   - Part 2 (Successes): Stripe's "7-line API" wedge, Linear's keyboard-first UX,
 *     Discord's viral invite, Notion's template loop.
 *   - Part 4 (Chat-first UX): 60-second onboarding flow, Zeigarnik Effect,
 *     Dynamic Reputation Galaxy (/profile).
 *   - Part 5 (Competitive): Active Context Routing = ECOS unique differentiator.
 *   - Part 6 (Blind spots): Cold-start problem — single-player mode first.
 *
 * MODULES IN THIS FILE:
 *
 *  1) SYSTEM CAPABILITY REGISTRY V208
 *     — Extended CAPABILITY_DOMAINS with 5 new V208 domains (streak, decay,
 *       economic health, sybil gate, guided-actions).
 *     — Per-domain detail endpoint: /api/v1/system/capabilities/:domainId
 *       Surfaces richer information than the flat V207 list.
 *
 *  2) GUIDED ACTIONS CATALOG
 *     — Chat-first action templates. Powers the "3 quick-reply buttons" in the
 *       60-second onboarding flow. Also the daily micro-task trigger.
 *     — Each action has: domain, rank requirement, estimated XP, description,
 *       chatCommand, completionCriteria, and a humanInLoop flag (>$20 AI ops).
 *
 *  3) ONBOARDING SCORE
 *     — Measures user/workspace progression against 8 milestones.
 *     — Outputs a 0-100 score, next recommended action, and health tier.
 *     — Directly addresses the "cold-start blind spot" from Part 6.
 *
 *  4) SYBIL RESISTANCE SCORE
 *     — Scores a workspace/identity against 5 Sybil risk factors.
 *     — Output: risk level (low/medium/high/critical) + actionable remediation.
 *     — Based on Gitcoin Passport model + Coordinape failure analysis.
 *
 * Pure module — no DB, no side effects. All state passed in, results returned.
 * @version 208.0.0
 */

// ── 1) Extended Capability Domains ──────────────────────────────────────────

const CAPABILITY_DOMAINS_208 = [
  // ── Core (inherited from V207, preserved exactly) ─────────────────────────
  {
    id: 'economy', title: 'Economy & Ledger', since: 'V38', maturity: 'core',
    summary: 'BigInt fiat ledger, 40/40/20 split, immutable accounting (sacred).',
    surfaces: ['fiatLedger', 'royalty distribution', 'insurance pool'],
    v208Note: 'Payments enforced as USDC/ETH only. Protocol token never used as wage.',
    researchGuard: 'FTX/Terra collapse lesson: native token wages = reflexive death spiral.',
  },
  {
    id: 'audit', title: 'Audit & Integrity', since: 'V38', maturity: 'core',
    summary: 'Append-only audit log with hash chaining + Merkle mountain range.',
    surfaces: ['auditLog', 'MMR', 'integrity proofs'],
    v208Note: 'All decay events, streak records, health checks are audit-logged.',
    researchGuard: 'Celsius "no on-chain proof of reserves" failure — every financial event tracked.',
  },
  {
    id: 'rank', title: 'Rank & Reputation', since: 'V133', maturity: 'stable',
    summary: 'Tiered user rank, reward multipliers, rank-gated access.',
    surfaces: ['/api/v1/rank/*', 'requireRank middleware'],
    v208Note: 'Rank now uses EFFECTIVE (post-decay) reputation. Governance power = sqrt(effectiveRep).',
    researchGuard: 'Quadratic governance — Gitcoin QF lesson to reduce plutocracy.',
  },
  {
    id: 'notifications', title: 'Notifications', since: 'V136', maturity: 'stable',
    summary: 'In-app notification queue: tier promotions, streak reminders, broadcasts.',
    surfaces: ['/api/v1/rank/notifications/*'],
    v208Note: 'Streak-at-risk notifications added. Daily micro-task trigger pattern.',
  },
  {
    id: 'workspace', title: 'Workspaces & Tasks', since: 'V104', maturity: 'stable',
    summary: 'Workspace task lifecycle: create/update/assign/delete, bulk ops, recurrence, time-tracking.',
    surfaces: ['/api/v1/workspaces/:id/tasks/*', 'recurrence', 'bulk-status', 'time-tracking'],
    v208Note: 'Tasks <30s no longer count for streak (Hollow Task Rate anti-gaming gate).',
    researchGuard: 'Coordinape: peer collusion drains protocol. Task quality gates added.',
  },
  {
    id: 'events', title: 'Event Log', since: 'V181', maturity: 'stable',
    summary: 'Per-workspace event ring buffer with cursor pagination.',
    surfaces: ['/api/v1/workspaces/:id/events/log'],
  },
  {
    id: 'digest', title: 'Event Digest & Analytics', since: 'V191', maturity: 'stable',
    summary: 'Read-only aggregation: counts, heatmaps, burst detection.',
    surfaces: ['/api/v1/workspaces/:id/events/digest', '…/burst'],
  },
  {
    id: 'broadcast', title: 'Realtime Broadcast & SSE', since: 'V179', maturity: 'stable',
    summary: 'Fan-out message delivery to workspace clients.',
    surfaces: ['/api/v1/workspaces/:id/broadcast', '…/events/stream'],
  },
  {
    id: 'bookmarks', title: 'Bookmarks', since: 'V184', maturity: 'stable',
    summary: 'Named workspace bookmarks: set/get/list/bulk-delete.',
    surfaces: ['/api/v1/workspaces/:id/events/bookmarks/*'],
  },
  {
    id: 'snapshots', title: 'Stats Snapshots', since: 'V185', maturity: 'stable',
    summary: 'Point-in-time stats snapshots with diff and trim.',
    surfaces: ['/api/v1/workspaces/:id/events/stats/snapshots/*'],
  },
  {
    id: 'tokens', title: 'Tokens & Auth', since: 'V181', maturity: 'stable',
    summary: 'Workspace token service with expiry and bulk rotation.',
    surfaces: ['/api/v1/workspaces/:id/token', '/api/v1/admin/tokens/bulk-rotate'],
  },
  {
    id: 'admin', title: 'Admin & Observability', since: 'V148', maturity: 'stable',
    summary: 'Per-version admin summaries, system readiness, capability self-map.',
    surfaces: ['/api/v1/admin/summary/v*', '/api/v1/system/readiness', '/api/v1/system/capabilities'],
  },
  // ── V208 New Domains ──────────────────────────────────────────────────────
  {
    id: 'streak', title: 'Work Streak Engine', since: 'V208', maturity: 'stable',
    summary: 'Duolingo-style daily work streak: record activity, multiplier, freeze mechanic, at-risk alerts.',
    surfaces: [
      '/api/v1/workspaces/:id/streak (GET)',
      '/api/v1/workspaces/:id/streak/record (POST)',
      '/api/v1/workspaces/:id/streak/freeze (POST)',
    ],
    v208Note: 'Primary retention loop. Loss aversion: streak = psychological asset users protect.',
    researchGuard: 'STEPN/Axie: retention collapsed when financial incentive removed. Streak survives financial downturns.',
  },
  {
    id: 'reputation_decay', title: 'Reputation Decay Engine', since: 'V208', maturity: 'stable',
    summary: 'Exponential daily reputation decay for inactive accounts. Prevents rent-seeking and governance capture.',
    surfaces: [
      '/api/v1/workspaces/:id/reputation/decay-preview (GET)',
    ],
    v208Note: 'Effective rep = R₀ × e^(−λ×inactiveDays). Governance power = sqrt(effectiveRep). Grace period: 3 days.',
    researchGuard: 'Colony/Build Finance: past contributors held eternal power, blocking active contributors.',
  },
  {
    id: 'economic_health', title: 'Economic Health Monitor', since: 'V208', maturity: 'stable',
    summary: 'Real-time red-flag monitoring: Gini coefficient, Reputation Inflation Index, Hollow Task Rate, Treasury Liquidity Ratio.',
    surfaces: ['/api/v1/system/economic-health (GET)'],
    v208Note: '4 specific thresholds from failure autopsy. Status: healthy/warning/critical. Actionable remediation per flag.',
    researchGuard: 'FTX/Terra/Celsius/3AC: all had visible early signals. This makes them visible before collapse.',
  },
  {
    id: 'sybil_gate', title: 'Sybil Resistance Gate', since: 'V208', maturity: 'stable',
    summary: 'Score workspace/identity against 5 Sybil risk factors. Required for financial tasks.',
    surfaces: ['/api/v1/workspaces/:id/sybil-check (POST)'],
    v208Note: 'Factors: account age, social proof, task history, velocity, reputation source mix.',
    researchGuard: 'Coordinape collusion + Gitcoin passport failures — identity verification gates financial access.',
  },
  {
    id: 'guided_actions', title: 'Guided Actions & Onboarding', since: 'V208', maturity: 'stable',
    summary: 'Chat-first action templates, 60-second onboarding flow, progression health score.',
    surfaces: [
      '/api/v1/system/guided-actions (GET)',
      '/api/v1/workspaces/:id/onboarding/score (GET)',
      '/api/v1/system/capabilities/:domainId (GET)',
    ],
    v208Note: 'Wedge: "60-second bounty settle". Retention: streak loop. Galaxy: /profile visualization.',
    researchGuard: 'Braintrust/Colony cold-start failure: complex onboarding = abandonment. 60s max to "aha moment".',
  },
];

const MATURITY_RANK_208 = { core: 3, stable: 2, beta: 1, experimental: 0 };

// ── 2) Guided Actions Catalog ─────────────────────────────────────────────────

const GUIDED_ACTIONS_208 = [
  // ── Onboarding (rank 0 — available to everyone) ───────────────────────────
  {
    id: 'ga_profile_setup',
    category: 'onboarding',
    title: 'Complete your professional profile',
    description: 'Tell the AI your specialty domain. Unlocks rank-matched task routing.',
    chatCommand: '/profile setup [code|design|content|research|qa]',
    estimatedXp: 25,
    estimatedMinutes: 1,
    minRank: 0,
    humanInLoop: false,
    completionCriteria: 'Domain specialty set + at least 1 skill tag added',
    onboardingStep: 1,
    researchNote: 'Stripe pattern: remove friction in first 60 seconds. Single-player mode first (Notion).',
  },
  {
    id: 'ga_first_task',
    category: 'onboarding',
    title: 'Complete your first micro-task',
    description: 'A 2-minute challenge tuned to your specialty. Starts your streak and earns first XP.',
    chatCommand: '/task claim first',
    estimatedXp: 15,
    estimatedMinutes: 2,
    minRank: 0,
    humanInLoop: false,
    completionCriteria: 'Task completed in ≥30 seconds (quality gate) + AI evaluation passed',
    onboardingStep: 2,
    researchNote: 'Zeigarnik Effect: first incomplete task creates drive to return. First streak day = highest churn risk.',
  },
  {
    id: 'ga_streak_freeze',
    category: 'retention',
    title: 'Buy your first streak freeze',
    description: 'Protect your streak from one missed day. Costs 50 XP — worth it at streak > 7.',
    chatCommand: '/streak freeze buy',
    estimatedXp: -50,
    estimatedMinutes: 0.5,
    minRank: 0,
    humanInLoop: false,
    completionCriteria: 'XP ≥ 50 AND freeze purchased',
    onboardingStep: 3,
    researchNote: 'Duolingo loss aversion: freeze makes streak a "protected asset" worth spending for.',
  },
  // ── Active work (rank 1+) ─────────────────────────────────────────────────
  {
    id: 'ga_peer_review',
    category: 'quality',
    title: 'Review a peer\'s task submission',
    description: 'Rate a completed task with structured feedback. Earns XP and reduces Hollow Task Rate.',
    chatCommand: '/review task [taskId]',
    estimatedXp: 20,
    estimatedMinutes: 5,
    minRank: 1,
    humanInLoop: false,
    completionCriteria: 'Structured review submitted (≥50 chars + rating 1-5)',
    researchNote: 'Hollow Task Rate red flag prevention — peer review is the primary quality gate.',
  },
  {
    id: 'ga_bounty_create',
    category: 'economy',
    title: 'Post a work bounty',
    description: 'Create a task with USDC reward. AI validates the task spec and publishes to the network.',
    chatCommand: '/bounty [amount USDC] for [task description]',
    estimatedXp: 10,
    estimatedMinutes: 2,
    minRank: 1,
    humanInLoop: false,
    completionCriteria: 'Bounty spec complete + USDC in escrow',
    researchNote: 'ECOS wedge: "60-second bounty settle". USDC only — no native token (FTX lesson).',
  },
  {
    id: 'ga_bounty_claim',
    category: 'economy',
    title: 'Claim and complete a bounty',
    description: 'Pick up an open task, complete it, submit proof. AI verifies → USDC releases.',
    chatCommand: '/bounty claim [bountyId]',
    estimatedXp: 30,
    estimatedMinutes: 30,
    minRank: 0,
    humanInLoop: true,
    humanInLoopNote: 'Payments >$20 USDC require manual human approval (Ledger Security 2026 AI guardrail)',
    completionCriteria: 'Proof of work submitted + AI or peer verification passed',
    researchNote: 'Human-in-the-loop for >$20 — AI prompt injection protection (Blind Spot 1 from research).',
  },
  // ── Governance (rank 3+) ─────────────────────────────────────────────────
  {
    id: 'ga_governance_vote',
    category: 'governance',
    title: 'Vote on a protocol proposal',
    description: 'Vote with your effective (post-decay) reputation. Governance power = sqrt(effectiveRep).',
    chatCommand: '/vote proposal [proposalId] [yes|no]',
    estimatedXp: 5,
    estimatedMinutes: 3,
    minRank: 3,
    humanInLoop: false,
    completionCriteria: 'Vote cast with ≥1 effective reputation',
    researchNote: 'Quadratic voting — Gitcoin QF lesson. Governance power grows sublinearly to prevent plutocracy.',
  },
  {
    id: 'ga_treasury_proposal',
    category: 'governance',
    title: 'Submit a treasury spending proposal',
    description: 'Propose use of platform funds. Requires ≥65% quorum of active reputation to pass.',
    chatCommand: '/proposal treasury [amount USDC] for [purpose]',
    estimatedXp: 15,
    estimatedMinutes: 10,
    minRank: 5,
    humanInLoop: true,
    humanInLoopNote: 'All treasury proposals require ≥65% dynamic quorum + time-lock (Build Finance attack prevention)',
    completionCriteria: 'Proposal published with full spec + budget breakdown',
    researchNote: 'Build Finance: single attacker used low quorum to seize treasury. Hard quorum threshold required.',
  },
  // ── Economic health ──────────────────────────────────────────────────────
  {
    id: 'ga_health_check',
    category: 'admin',
    title: 'View economic health dashboard',
    description: 'Check 4 red-flag metrics: Gini, RII, Hollow Task Rate, Treasury Liquidity.',
    chatCommand: '/health check',
    estimatedXp: 0,
    estimatedMinutes: 1,
    minRank: 0,
    humanInLoop: false,
    completionCriteria: 'Report viewed',
    researchNote: 'FTX/Celsius: signals were visible but unmeasured. Radical transparency.',
  },
];

// ── 3) Onboarding Score ───────────────────────────────────────────────────────

const ONBOARDING_MILESTONES_208 = [
  { id: 'profile_set',       label: 'Specialty domain set',          points: 10, required: true },
  { id: 'first_task',        label: 'First task completed',          points: 15, required: true },
  { id: 'streak_7',          label: '7-day streak reached',          points: 15, required: false },
  { id: 'first_review',      label: 'First peer review submitted',   points: 10, required: false },
  { id: 'bounty_created',    label: 'First bounty posted',           points: 10, required: false },
  { id: 'bounty_claimed',    label: 'First bounty completed',        points: 20, required: false },
  { id: 'freeze_purchased',  label: 'First streak freeze purchased', points: 5,  required: false },
  { id: 'sybil_verified',    label: 'Identity verified (social proof linked)', points: 15, required: false },
];

const ONBOARDING_TOTAL_POINTS_208 = ONBOARDING_MILESTONES_208.reduce((s, m) => s + m.points, 0);

/**
 * Compute onboarding health score (0-100) for a workspace.
 *
 * @param {Object} completedMilestones — Map of milestone id → boolean
 * @param {Object} [meta]             — Optional extra context (streakDays, xpTotal, etc.)
 * @returns {OnboardingScore208}
 */
function computeOnboardingScore208(completedMilestones = {}, meta = {}) {
  let earnedPoints = 0;
  const completed = [];
  const pending = [];

  for (const m of ONBOARDING_MILESTONES_208) {
    if (completedMilestones[m.id]) {
      earnedPoints += m.points;
      completed.push(m);
    } else {
      pending.push(m);
    }
  }

  const score = Math.round((earnedPoints / ONBOARDING_TOTAL_POINTS_208) * 100);
  const tier = score >= 80 ? 'graduated' : score >= 50 ? 'active' : score >= 20 ? 'onboarding' : 'new';

  // Next recommended action (first pending required, then first pending optional)
  const nextRequired = pending.find(m => m.required);
  const nextOptional = pending.find(m => !m.required);
  const nextAction = nextRequired || nextOptional;

  // Map to guided action
  const nextGuidedAction = nextAction
    ? GUIDED_ACTIONS_208.find(g => g.id === `ga_${nextAction.id}`) || null
    : null;

  return {
    score,
    tier,
    earnedPoints,
    totalPoints: ONBOARDING_TOTAL_POINTS_208,
    completed: completed.map(m => m.id),
    pending: pending.map(m => ({ id: m.id, label: m.label, points: m.points, required: m.required })),
    nextAction: nextAction ? {
      id: nextAction.id,
      label: nextAction.label,
      points: nextAction.points,
      required: nextAction.required,
      chatCommand: nextGuidedAction ? nextGuidedAction.chatCommand : null,
    } : null,
    tierMessage: {
      graduated: '🌟 Fully onboarded — you\'re a core contributor.',
      active:    '🔥 Active participant. Keep building your streak!',
      onboarding:'⚡ Getting started. Complete required milestones to unlock more.',
      new:       '👋 Welcome! Complete your profile and first task to begin.',
    }[tier],
    meta: meta || {},
    researchNote: 'Addresses cold-start blind spot: solo founder needs validation before scaling. Score tracks ecosystem health.',
  };
}

// ── 4) Sybil Resistance Score ─────────────────────────────────────────────────

/**
 * Score a workspace/identity against Sybil risk factors.
 * Research: Coordinape/Gitcoin failures show 5 key indicators.
 *
 * @param {Object} identity
 * @param {number}   identity.accountAgeDays         — How old is the account
 * @param {boolean}  identity.githubLinked            — GitHub account linked
 * @param {number}   [identity.githubAccountAgeDays]  — Age of GitHub account
 * @param {boolean}  identity.discordLinked           — Discord linked
 * @param {number}   identity.completedTaskCount      — Total completed tasks
 * @param {number}   identity.taskVelocityPerDay      — Tasks per day (7-day avg)
 * @param {number}   identity.reputationSourceScore   — % rep from human-verified tasks vs AI-only
 * @returns {SybilScore208}
 */
function computeSybilScore208(identity = {}) {
  const {
    accountAgeDays        = 0,
    githubLinked          = false,
    githubAccountAgeDays  = 0,
    discordLinked         = false,
    completedTaskCount    = 0,
    taskVelocityPerDay    = 0,
    reputationSourceScore = 0,
  } = identity;

  const factors = [];
  let riskScore = 0; // 0 = low risk, 100 = highest risk

  // Factor 1: Account age (new accounts = higher risk)
  const ageScore = accountAgeDays >= 180 ? 0 : accountAgeDays >= 30 ? 20 : accountAgeDays >= 7 ? 40 : 60;
  factors.push({
    factor: 'account_age',
    value: accountAgeDays,
    riskContribution: ageScore,
    status: ageScore === 0 ? 'pass' : ageScore <= 20 ? 'warn' : 'flag',
    detail: `Account is ${accountAgeDays} day(s) old. Requirement: ≥180 days for full trust.`,
  });
  riskScore += ageScore;

  // Factor 2: Social proof (GitHub ≥6 months — research: "חשבון GitHub פעיל של לפחות 6 חודשים")
  let socialScore = 30;
  if (githubLinked && githubAccountAgeDays >= 180) socialScore = 0;
  else if (githubLinked && githubAccountAgeDays >= 30) socialScore = 10;
  else if (discordLinked) socialScore = 15;
  factors.push({
    factor: 'social_proof',
    value: { githubLinked, githubAccountAgeDays, discordLinked },
    riskContribution: socialScore,
    status: socialScore === 0 ? 'pass' : socialScore <= 10 ? 'warn' : 'flag',
    detail: githubLinked
      ? `GitHub linked (${githubAccountAgeDays} days old). ${githubAccountAgeDays >= 180 ? 'Full trust.' : 'Need ≥180 days.'}`
      : discordLinked
      ? 'Discord linked but GitHub required for full trust.'
      : 'No social proof linked. High risk for financial tasks.',
    researchNote: 'Gitcoin Passport model — verified social history = identity anchor',
  });
  riskScore += socialScore;

  // Factor 3: Task history (new accounts with no history)
  const taskScore = completedTaskCount >= 10 ? 0 : completedTaskCount >= 3 ? 10 : completedTaskCount >= 1 ? 20 : 30;
  factors.push({
    factor: 'task_history',
    value: completedTaskCount,
    riskContribution: taskScore,
    status: taskScore === 0 ? 'pass' : taskScore <= 10 ? 'warn' : 'flag',
    detail: `${completedTaskCount} completed task(s). ≥10 tasks = full history trust.`,
  });
  riskScore += taskScore;

  // Factor 4: Task velocity (bots complete tasks very fast/many)
  const velocityScore = taskVelocityPerDay > 20 ? 50 : taskVelocityPerDay > 10 ? 30 : taskVelocityPerDay > 5 ? 10 : 0;
  factors.push({
    factor: 'task_velocity',
    value: taskVelocityPerDay,
    riskContribution: velocityScore,
    status: velocityScore === 0 ? 'pass' : velocityScore <= 10 ? 'warn' : 'flag',
    detail: `${taskVelocityPerDay.toFixed(1)} tasks/day average. >20/day triggers bot suspicion.`,
    researchNote: 'Hollow Task Rate: Sybil bots complete many tasks at high velocity',
  });
  riskScore += velocityScore;

  // Factor 5: Reputation source quality (AI-only approval vs human-verified)
  const sourceScore = reputationSourceScore >= 0.7 ? 0 : reputationSourceScore >= 0.4 ? 10 : 20;
  factors.push({
    factor: 'reputation_source_quality',
    value: reputationSourceScore,
    riskContribution: sourceScore,
    status: sourceScore === 0 ? 'pass' : sourceScore <= 10 ? 'warn' : 'flag',
    detail: `${Math.round(reputationSourceScore * 100)}% of reputation from human-verified tasks. Target: ≥70%.`,
  });
  riskScore += sourceScore;

  // Normalize to 0-100
  const maxPossibleRisk = 60 + 30 + 30 + 50 + 20; // 190 max
  const normalizedRisk = Math.min(100, Math.round((riskScore / maxPossibleRisk) * 100));

  const riskLevel = normalizedRisk >= 70 ? 'critical'
    : normalizedRisk >= 45 ? 'high'
    : normalizedRisk >= 20 ? 'medium' : 'low';

  const financialTasksAllowed = riskLevel === 'low' || riskLevel === 'medium';
  const highValueTasksAllowed = riskLevel === 'low';

  const remediation = [];
  if (!githubLinked || githubAccountAgeDays < 180) remediation.push('Link a GitHub account ≥6 months old via /profile link github');
  if (!discordLinked) remediation.push('Link Discord account via /profile link discord');
  if (completedTaskCount < 10) remediation.push(`Complete ${10 - completedTaskCount} more task(s) to build history`);
  if (taskVelocityPerDay > 10) remediation.push('Reduce task completion velocity — high rate suggests automated activity');

  return {
    riskScore: normalizedRisk,
    riskLevel,
    financialTasksAllowed,
    highValueTasksAllowed,
    factors,
    remediation,
    summary: `Sybil risk: ${riskLevel.toUpperCase()} (${normalizedRisk}/100). ${financialTasksAllowed ? 'Financial tasks: ✅ allowed.' : 'Financial tasks: ❌ blocked until risk reduced.'}`,
    researchSource: 'Coordinape circle-voting + Gitcoin Sybil attack analysis — 5-factor identity scoring',
    ecosVersion: 'V208',
  };
}

// ── buildCapabilityMap208 ─────────────────────────────────────────────────────

/**
 * Build the full capability map (all domains), optionally filtered to one domain.
 * @param {Array}  [domains=CAPABILITY_DOMAINS_208]
 * @param {string} [version='208.0.0']
 * @param {string} [filterDomainId] — If set, return only that domain's detail
 * @returns {Object}
 */
function buildCapabilityMap208(domains = CAPABILITY_DOMAINS_208, version = '208.0.0', filterDomainId = null) {
  if (filterDomainId) {
    const domain = domains.find(d => d.id === filterDomainId);
    if (!domain) return null;
    return {
      generatedAt: new Date().toISOString(),
      version,
      domain: { ...domain },
      guidedActions: GUIDED_ACTIONS_208.filter(a => a.category === filterDomainId || domain.id === 'guided_actions'),
    };
  }

  const byMaturity = {};
  let totalSurfaces = 0;
  for (const d of domains) {
    byMaturity[d.maturity] = (byMaturity[d.maturity] || 0) + 1;
    totalSurfaces += (d.surfaces ? d.surfaces.length : 0);
  }
  const sorted = domains.slice().sort((a, b) =>
    (MATURITY_RANK_208[b.maturity] || 0) - (MATURITY_RANK_208[a.maturity] || 0) || a.title.localeCompare(b.title));

  return {
    generatedAt: new Date().toISOString(),
    version,
    totalDomains: domains.length,
    totalSurfaces,
    byMaturity,
    v208NewDomains: ['streak', 'reputation_decay', 'economic_health', 'sybil_gate', 'guided_actions'],
    domains: sorted,
  };
}

// ── Module exports ────────────────────────────────────────────────────────────

module.exports = {
  CAPABILITY_DOMAINS_208,
  MATURITY_RANK_208,
  GUIDED_ACTIONS_208,
  ONBOARDING_MILESTONES_208,
  ONBOARDING_TOTAL_POINTS_208,
  buildCapabilityMap208,
  computeOnboardingScore208,
  computeSybilScore208,
};
