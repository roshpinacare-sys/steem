'use strict';
/**
 * src/lib/deepHealthPolicyLog548.js — ECOS V548
 *
 * Policy Decision Log — ring buffer של 50 decisions האחרונות
 * מ-orchestratorPolicyGate547 / deepHealthPolicy546.
 *
 * ─── מה זה עושה ───────────────────────────────────────────────────────────────
 * שומר כל decision (AUTO/SUPERVISED/MANUAL) עם: timestamp, score, trend,
 * reasoning, מקור (gate/policy). מחשב trend של decisions עצמם כדי להראות
 * האם המערכת משתפרת (MANUAL→SUPERVISED→AUTO) או מדרדרת.
 *
 * ─── API ─────────────────────────────────────────────────────────────────────
 *   recordDecision548(entry)  — הוסף decision לlog (נקרא מ-gate/policy)
 *   getLog548()               — החזר כל ה-log (עד 50 entries)
 *   getTrendLog548()          — trend: improving/degrading/stable/unknown
 *   getLogSummary548()        — counts + trend + last decision
 *   clearLog548()             — נקה log (לטסטים)
 *
 * ─── Integration ─────────────────────────────────────────────────────────────
 *   gate547 ו-policy546 לא חייבים לדעת על ה-log — הlog יכול להתעדכן
 *   passively מ-endpoints, או ה-gate יכול לקרוא recordDecision548 אחרי כל gate.
 *
 * Zero new npm deps. All identifiers end in 548.
 * @version 548.0.0
 */

const LOG_VERSION_548        = '548.0.0';
const LOG_MAX_ENTRIES_548    = 50;
const DECISION_LEVELS_548    = { AUTO: 2, SUPERVISED: 1, MANUAL: 0 };

// ── Ring buffer ───────────────────────────────────────────────────────────────
let _log548 = [];

/**
 * recordDecision548(entry) — append a policy decision to the ring buffer.
 * @param {{
 *   decision: 'AUTO'|'SUPERVISED'|'MANUAL',
 *   score:    number,
 *   trend:    string,
 *   reasoning?: string,
 *   source?:  string,   // 'gate547' | 'policy546' | 'manual' | ...
 *   blockedBy?: string, // reason if blocked
 * }} entry
 */
const _VALID_DECISIONS_548 = new Set(['AUTO', 'SUPERVISED', 'MANUAL']);

function recordDecision548(entry) {
  if (!entry || typeof entry.decision !== 'string') return;
  if (!_VALID_DECISIONS_548.has(entry.decision)) return; // fail-closed: reject unknown decisions
  const normalized = {
    ts:        new Date().toISOString(),
    decision:  entry.decision,
    score:     typeof entry.score === 'number' ? entry.score : 0,
    trend:     typeof entry.trend === 'string'  ? entry.trend : 'unknown',
    reasoning: entry.reasoning || '',
    source:    entry.source    || 'unknown',
    blocked:   !!entry.blocked,
    blockedBy: entry.blockedBy || null,
  };
  _log548.push(normalized);
  if (_log548.length > LOG_MAX_ENTRIES_548) {
    _log548 = _log548.slice(_log548.length - LOG_MAX_ENTRIES_548);
  }
}

/**
 * getLog548() — return a copy of all log entries (oldest first).
 */
function getLog548() {
  return _log548.slice();
}

/**
 * getTrendLog548() — analyse decision trend: are we improving or degrading?
 *
 * Strategy: compare average level of first-half vs second-half of log.
 *   improving  — second half average > first half average (MANUAL→AUTO direction)
 *   degrading  — second half average < first half average
 *   stable     — equal
 *   unknown    — fewer than 4 entries
 *
 * @returns {{ trend: string, firstHalfAvg: number, secondHalfAvg: number, sampleSize: number }}
 */
function getTrendLog548() {
  const log = _log548;
  if (log.length < 4) {
    return { trend: 'unknown', firstHalfAvg: null, secondHalfAvg: null, sampleSize: log.length };
  }
  const mid  = Math.floor(log.length / 2);
  const first  = log.slice(0, mid);
  const second = log.slice(mid);

  const avg = (arr) => {
    const sum = arr.reduce((s, e) => s + (DECISION_LEVELS_548[e.decision] ?? 0), 0);
    return sum / arr.length;
  };
  const firstAvg  = avg(first);
  const secondAvg = avg(second);

  let trend548;
  if (secondAvg > firstAvg + 0.1)       trend548 = 'improving';
  else if (secondAvg < firstAvg - 0.1)  trend548 = 'degrading';
  else                                   trend548 = 'stable';

  return {
    trend:         trend548,
    firstHalfAvg:  Math.round(firstAvg  * 1000) / 1000,
    secondHalfAvg: Math.round(secondAvg * 1000) / 1000,
    sampleSize:    log.length,
  };
}

/**
 * getLogSummary548() — aggregate counts + trend + last decision.
 */
function getLogSummary548() {
  const log     = _log548;
  const counts548  = { AUTO: 0, SUPERVISED: 0, MANUAL: 0 };
  let blockedCount = 0;
  for (const e of log) {
    if (counts548[e.decision] !== undefined) counts548[e.decision]++;
    if (e.blocked) blockedCount++;
  }
  const last548     = log.length > 0 ? log[log.length - 1] : null;
  const trendInfo   = getTrendLog548();

  return {
    ok:           true,
    version:      LOG_VERSION_548,
    totalRecorded: log.length,
    counts:        counts548,
    blockedCount,
    decisionTrend: trendInfo.trend,
    trendDetail:   trendInfo,
    lastDecision:  last548 ? { decision: last548.decision, ts: last548.ts, score: last548.score } : null,
  };
}

/**
 * clearLog548() — reset the ring buffer (primarily for tests).
 */
function clearLog548() {
  _log548 = [];
}

// ── Exports ───────────────────────────────────────────────────────────────────
module.exports = {
  LOG_VERSION_548,
  LOG_MAX_ENTRIES_548,
  DECISION_LEVELS_548,
  recordDecision548,
  getLog548,
  getTrendLog548,
  getLogSummary548,
  clearLog548,
};
