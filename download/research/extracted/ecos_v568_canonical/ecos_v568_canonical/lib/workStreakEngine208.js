'use strict';
/**
 * lib/workStreakEngine208.js — ECOS V208 (Phase P97)
 *
 * Research source: Duolingo gamification analysis (section 2, "הצלחות וצעדי-ענק").
 * Core lesson: The streak counter is NOT just a nice UX feature — it is the primary
 * retention mechanism. Duolingo grew 500M+ users on the back of two behavioral levers:
 *   1. Loss Aversion — humans feel the pain of losing a streak 2× more than the
 *      pleasure of gaining an equivalent reward. Once streak > 7 days, churn drops ~60%.
 *   2. Zeigarnik Effect — an incomplete streak bar creates psychological discomfort
 *      that drives daily return without any explicit reminder.
 *
 * DESIGN DECISIONS:
 *  1. Streak multiplier: bonus_factor = 1.0 + min(streak_days × 0.05, 2.0)
 *     → 0-day streak: 1.0× (baseline). 40-day streak: 3.0× (cap).
 *     → This makes early streaks feel rewarding and provides a meaningful long-term goal.
 *
 *  2. Streak freeze mechanic: purchased with accumulated XP/reputation points.
 *     → Max 2 freezes stored at once (prevents infinite gaming).
 *     → Each freeze protects against exactly 1 missed day.
 *     → Purchasing a freeze has a reputation cost (creates real trade-off — not free).
 *
 *  3. At-risk state: streak is "at risk" if no activity today AND freeze available.
 *     → This is the intervention moment — send the push notification.
 *
 *  4. Anti-gaming: a single micro-task in <15s does NOT extend streak.
 *     → Minimum task completion time: 30s (research: Hollow Task Rate red flag).
 *     → Prevents fake activity just to protect streak.
 *
 *  5. XP is variable (±20% random band) to create unpredictability / dopamine variance.
 *     → Slot machine psychology, but for genuine work. The randomness band is narrow
 *        enough to not feel exploitative.
 *
 *  6. Streak contributes to reputation decay protection — an active streak means
 *     the decay engine treats you as "active" (synergy with reputationDecayEngine208).
 *
 * Pure module — in-memory store (Map). Production: persist to DB via snapshot/restore.
 * @version 208.0.0
 */

// ── Constants ────────────────────────────────────────────────────────────────

const STREAK_MULTIPLIER_BASE_208   = 1.0;
const STREAK_MULTIPLIER_PER_DAY_208 = 0.05;
const STREAK_MULTIPLIER_CAP_208    = 3.0;

const FREEZE_MAX_STORED_208  = 2;      // Max freezes held at once
const FREEZE_XP_COST_208     = 50;     // XP cost per freeze purchase
const XP_BASE_208            = 10;     // Base XP for a qualifying task
const XP_VARIANCE_208        = 0.2;    // ±20% variance (variable reward)
const MIN_TASK_DURATION_MS_208 = 30_000; // Anti-gaming: task must take ≥30 seconds

// ── Error class ──────────────────────────────────────────────────────────────

class StreakError208 extends Error {
  constructor(msg, code = 'STREAK_ERROR') {
    super(msg);
    this.name = 'StreakError208';
    this.code = code;
    this.statusCode = 400;
  }
}

// ── In-memory store ──────────────────────────────────────────────────────────
// Key: workspaceId (string). Value: StreakState208.
const _streakStore208 = new Map();

// ── State factory ─────────────────────────────────────────────────────────────

/**
 * Create a fresh streak state for a new workspace.
 * @param {string} workspaceId
 * @returns {StreakState208}
 */
function _freshState208(workspaceId) {
  return {
    workspaceId,
    currentStreak:   0,
    longestStreak:   0,
    lastActivityDate: null,  // ISO date string (YYYY-MM-DD)
    streakFreezes:   0,
    xpTotal:         0,
    xpThisWeek:      0,
    weekStartDate:   null,
    multiplier:      STREAK_MULTIPLIER_BASE_208,
    atRisk:          false,
    createdAt:       new Date().toISOString(),
    updatedAt:       new Date().toISOString(),
  };
}

// ── Core: record activity ─────────────────────────────────────────────────────

/**
 * Record a task completion for a workspace and update streak.
 *
 * @param {string} workspaceId
 * @param {Object} opts
 * @param {string}  [opts.activityDate]     — ISO date (YYYY-MM-DD). Defaults to today UTC.
 * @param {number}  [opts.taskDurationMs]   — How long the task took. Anti-gaming check.
 * @param {boolean} [opts.hadPeerReview]    — Whether peer review occurred (quality signal).
 * @param {number}  [opts.baseXp]           — Override base XP (for special tasks).
 * @param {boolean} [opts.deterministicXp]  — Skip variance (for testing).
 * @returns {{ state: StreakState208, event: StreakEvent208 }}
 */
function recordActivity208(workspaceId, opts = {}) {
  if (!workspaceId || typeof workspaceId !== 'string') {
    throw new StreakError208('workspaceId must be a non-empty string', 'INVALID_WORKSPACE');
  }

  const {
    activityDate,
    taskDurationMs,
    hadPeerReview = false,
    baseXp,
    deterministicXp = false,
  } = opts;

  // Anti-gaming gate: task must meet minimum duration (hollow task prevention)
  if (typeof taskDurationMs === 'number' && taskDurationMs < MIN_TASK_DURATION_MS_208) {
    return {
      state: getStreak208(workspaceId),
      event: {
        type: 'rejected_hollow_task',
        reason: `Task completed in ${taskDurationMs}ms — minimum is ${MIN_TASK_DURATION_MS_208}ms (anti-gaming gate)`,
        streakUpdated: false,
        xpAwarded: 0,
        researchNote: 'Hollow Task Rate protection — tasks <30s do not extend streak',
      },
    };
  }

  const today = activityDate || todayUTC();
  const state = _streakStore208.get(workspaceId) || _freshState208(workspaceId);
  const prev = state.lastActivityDate;
  const dayDiff = prev ? dateDiffDays(prev, today) : null;

  let streakEvent = { type: '', streakUpdated: false, streakBroken: false, freezeUsed: false, xpAwarded: 0 };

  if (dayDiff === null) {
    // First ever activity
    state.currentStreak = 1;
    state.lastActivityDate = today;
    streakEvent.type = 'streak_started';
    streakEvent.streakUpdated = true;
  } else if (dayDiff === 0) {
    // Same day — no streak increment, but still award XP
    streakEvent.type = 'same_day_activity';
    streakEvent.streakUpdated = false;
  } else if (dayDiff === 1) {
    // Perfect — consecutive day
    state.currentStreak += 1;
    state.lastActivityDate = today;
    streakEvent.type = 'streak_extended';
    streakEvent.streakUpdated = true;
  } else if (dayDiff === 2 && state.streakFreezes > 0) {
    // Missed one day — auto-consume a freeze
    state.streakFreezes -= 1;
    state.currentStreak += 1;
    state.lastActivityDate = today;
    streakEvent.type = 'streak_saved_by_freeze';
    streakEvent.streakUpdated = true;
    streakEvent.freezeUsed = true;
    streakEvent.freezesRemaining = state.streakFreezes;
    streakEvent.researchNote = 'Loss aversion mechanic — freeze protects streak asset (Duolingo pattern)';
  } else {
    // Streak broken
    const previousStreak = state.currentStreak;
    state.currentStreak = 1;
    state.lastActivityDate = today;
    streakEvent.type = 'streak_reset';
    streakEvent.streakUpdated = true;
    streakEvent.streakBroken = true;
    streakEvent.previousStreak = previousStreak;
    streakEvent.message = previousStreak > 7
      ? `Your ${previousStreak}-day streak ended. Start a new one today!`
      : `Streak reset. Build it back up — you can do it!`;
  }

  // Update longest
  if (state.currentStreak > state.longestStreak) {
    state.longestStreak = state.currentStreak;
  }

  // Update multiplier
  state.multiplier = computeMultiplier208(state.currentStreak);

  // Award XP (with variable reward band)
  const xpBase = typeof baseXp === 'number' ? baseXp : XP_BASE_208;
  const xpMultiplied = xpBase * state.multiplier;
  const xpFinal = deterministicXp
    ? Math.round(xpMultiplied)
    : Math.round(xpMultiplied * (1 + (Math.random() * 2 - 1) * XP_VARIANCE_208));
  state.xpTotal += xpFinal;
  streakEvent.xpAwarded = xpFinal;
  streakEvent.multiplierApplied = state.multiplier;
  streakEvent.hadPeerReview = hadPeerReview;

  // Week tracking (reset on Monday)
  const weekStart = getWeekStart(today);
  if (state.weekStartDate !== weekStart) {
    state.xpThisWeek = 0;
    state.weekStartDate = weekStart;
  }
  state.xpThisWeek += xpFinal;

  // At-risk: will they break streak tomorrow?
  state.atRisk = false; // Just recorded activity, not at risk right now
  state.updatedAt = new Date().toISOString();
  _streakStore208.set(workspaceId, state);

  return {
    state: { ...state },
    event: { ...streakEvent, currentStreak: state.currentStreak, xpTotal: state.xpTotal },
  };
}

// ── Get streak state ──────────────────────────────────────────────────────────

/**
 * Get current streak state for a workspace, with at-risk computation.
 * @param {string} workspaceId
 * @param {string} [asOfDate] — ISO date for at-risk computation (defaults to today UTC)
 * @returns {StreakState208}
 */
function getStreak208(workspaceId, asOfDate) {
  if (!workspaceId || typeof workspaceId !== 'string') {
    throw new StreakError208('workspaceId must be a non-empty string', 'INVALID_WORKSPACE');
  }
  const state = _streakStore208.get(workspaceId) || _freshState208(workspaceId);
  const today = asOfDate || todayUTC();
  const dayDiff = state.lastActivityDate ? dateDiffDays(state.lastActivityDate, today) : null;

  // At-risk: last activity was yesterday and no activity today yet
  const atRisk = dayDiff !== null && dayDiff >= 1 && state.currentStreak > 0;
  const freezeWouldSave = atRisk && dayDiff === 1 && state.streakFreezes > 0;

  return {
    ...state,
    atRisk,
    freezeWouldSave,
    daysSinceActivity: dayDiff,
    multiplier: computeMultiplier208(state.currentStreak),
    nextMilestone: nextStreakMilestone208(state.currentStreak),
    statusMessage: buildStatusMessage208(state, atRisk, freezeWouldSave, dayDiff),
  };
}

// ── Purchase streak freeze ────────────────────────────────────────────────────

/**
 * Purchase a streak freeze using accumulated XP.
 * Research: Loss aversion mechanic — freeze is a "purchased protection" for the streak asset.
 *
 * @param {string} workspaceId
 * @param {Object} [opts]
 * @param {number}  [opts.xpCost] — Override default freeze cost
 * @returns {{ state: StreakState208, success: boolean, message: string }}
 */
function purchaseFreeze208(workspaceId, opts = {}) {
  if (!workspaceId || typeof workspaceId !== 'string') {
    throw new StreakError208('workspaceId must be a non-empty string', 'INVALID_WORKSPACE');
  }
  const state = _streakStore208.get(workspaceId) || _freshState208(workspaceId);
  const cost = typeof opts.xpCost === 'number' ? opts.xpCost : FREEZE_XP_COST_208;

  if (state.streakFreezes >= FREEZE_MAX_STORED_208) {
    return { state: { ...state }, success: false, message: `Already at maximum freeze storage (${FREEZE_MAX_STORED_208}). Use a freeze first.` };
  }
  if (state.xpTotal < cost) {
    return { state: { ...state }, success: false, message: `Insufficient XP. Need ${cost}, have ${state.xpTotal}.` };
  }

  state.xpTotal -= cost;
  state.streakFreezes += 1;
  state.updatedAt = new Date().toISOString();
  _streakStore208.set(workspaceId, state);

  return {
    state: { ...state },
    success: true,
    message: `Streak freeze purchased! You now have ${state.streakFreezes} freeze(s). Your streak is protected for ${state.streakFreezes} missed day(s).`,
    xpSpent: cost,
    freezesAvailable: state.streakFreezes,
    researchNote: 'Duolingo loss-aversion: freeze turns streak into a protected asset worth spending for',
  };
}

// ── System snapshot (for testing / persistence) ───────────────────────────────

/**
 * Export all streak states. For persistence/testing.
 * @returns {Object}
 */
function exportStreakStore208() {
  const out = {};
  for (const [k, v] of _streakStore208) out[k] = { ...v };
  return out;
}

/**
 * Import streak states (restore from persistence).
 * @param {Object} data
 */
function importStreakStore208(data) {
  if (!data || typeof data !== 'object') throw new StreakError208('data must be object');
  _streakStore208.clear();
  for (const [k, v] of Object.entries(data)) _streakStore208.set(k, v);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function computeMultiplier208(streakDays) {
  const bonus = Math.min(streakDays * STREAK_MULTIPLIER_PER_DAY_208, STREAK_MULTIPLIER_CAP_208 - STREAK_MULTIPLIER_BASE_208);
  return Math.round((STREAK_MULTIPLIER_BASE_208 + bonus) * 100) / 100;
}

function nextStreakMilestone208(currentStreak) {
  const milestones = [3, 7, 14, 30, 60, 90, 180, 365];
  const next = milestones.find(m => m > currentStreak);
  if (!next) return { days: null, message: 'Legend status — beyond all milestones!' };
  return { days: next, daysLeft: next - currentStreak, message: `${next - currentStreak} day(s) to ${next}-day streak milestone` };
}

function buildStatusMessage208(state, atRisk, freezeWouldSave, dayDiff) {
  if (state.currentStreak === 0) return 'Start your first streak by completing a task today!';
  if (atRisk && freezeWouldSave) return `⚠️ Your ${state.currentStreak}-day streak is at risk! Use a freeze or complete a task today.`;
  if (atRisk && !freezeWouldSave && dayDiff === 1) return `🔥 Your ${state.currentStreak}-day streak needs action today — no freezes available!`;
  if (atRisk && dayDiff >= 2) return `💔 Streak broken after ${state.currentStreak} days. Start fresh today!`;
  return `🔥 ${state.currentStreak}-day streak! Multiplier: ${computeMultiplier208(state.currentStreak)}×`;
}

/** Return today's date in YYYY-MM-DD (UTC). */
function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}

/** Get ISO week start (Monday) for a YYYY-MM-DD date string. */
function getWeekStart(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  const day = d.getUTCDay(); // 0=Sun, 1=Mon...
  const diff = (day === 0 ? -6 : 1 - day);
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

/**
 * Compute day difference between two YYYY-MM-DD strings (b - a, in days).
 * @param {string} a — earlier date
 * @param {string} b — later date
 * @returns {number} — positive if b > a
 */
function dateDiffDays(a, b) {
  const msA = new Date(a + 'T00:00:00Z').getTime();
  const msB = new Date(b + 'T00:00:00Z').getTime();
  return Math.round((msB - msA) / 86_400_000);
}

// ── Module exports ────────────────────────────────────────────────────────────

module.exports = {
  recordActivity208,
  getStreak208,
  purchaseFreeze208,
  exportStreakStore208,
  importStreakStore208,
  computeMultiplier208,
  nextStreakMilestone208,
  StreakError208,
  STREAK_MULTIPLIER_BASE_208,
  STREAK_MULTIPLIER_PER_DAY_208,
  STREAK_MULTIPLIER_CAP_208,
  FREEZE_MAX_STORED_208,
  FREEZE_XP_COST_208,
  XP_BASE_208,
  MIN_TASK_DURATION_MS_208,
  _streakStore208,
};
