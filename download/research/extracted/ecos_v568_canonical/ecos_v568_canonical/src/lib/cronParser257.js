'use strict';
/**
 * src/lib/cronParser257.js — ECOS V257 (Phase P153)
 *
 * P153-C: Full 5-field cron expression evaluator (pure Node.js, zero npm deps).
 *
 * Supported syntax (standard cron):
 *   minute   0-59
 *   hour     0-23
 *   day      1-31
 *   month    1-12  (or names: jan-dec)
 *   weekday  0-7   (0 and 7 = Sunday; or names: sun-sat)
 *
 * Each field supports: * | N | N/step | N-M | N-M/step | list (comma-separated)
 *
 * API:
 *   parseCronExpression257(expr)
 *     → { ok:true, fields:{minute,hour,day,month,weekday} } | { ok:false, error }
 *
 *   nextCronFireMs257(expr, fromDate?)
 *     → milliseconds until next fire (from now or fromDate), or null if invalid
 *
 *   isCronDue257(expr, date?)
 *     → boolean — true if the given date matches the cron expression (minute precision)
 *
 * @version 257.0.0
 */

// ── Constants ────────────────────────────────────────────────────────────────

const MONTH_NAMES_257 = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };
const DOW_NAMES_257   = { sun:0,mon:1,tue:2,wed:3,thu:4,fri:5,sat:6 };

const FIELD_RANGES_257 = {
  minute:  { min: 0,  max: 59 },
  hour:    { min: 0,  max: 23 },
  day:     { min: 1,  max: 31 },
  month:   { min: 1,  max: 12 },
  weekday: { min: 0,  max: 7  },
};

class CronParseError257 extends Error {
  constructor(msg) {
    super(msg);
    this.name = 'CronParseError257';
    this.code = 'CRON_PARSE_ERROR';
  }
}

// ── Field parser ─────────────────────────────────────────────────────────────

/**
 * Expand a single cron field string into a sorted Set of valid values.
 * @param {string} field  raw token e.g. "star/5", "1-5", "1,3,5", "star"
 * @param {string} name   field name (minute|hour|day|month|weekday)
 * @param {object} [nameMap]  optional name→number lookup (months, weekdays)
 * @returns {Set<number>}
 */
function _expandField257(field, name, nameMap) {
  const { min, max } = FIELD_RANGES_257[name];
  const result = new Set();

  const _norm = (raw) => {
    const s = String(raw).toLowerCase();
    if (nameMap && nameMap[s] !== undefined) return nameMap[s];
    const n = parseInt(s, 10);
    if (isNaN(n)) throw new CronParseError257(`Invalid value "${raw}" in ${name} field`);
    return n;
  };

  const _add = (n) => {
    // weekday 7 maps to 0 (both are Sunday)
    const v = (name === 'weekday' && n === 7) ? 0 : n;
    if (v < min || v > max) throw new CronParseError257(`Value ${n} out of range [${min}-${max}] in ${name} field`);
    result.add(v);
  };

  for (const part of field.split(',')) {
    const p = part.trim();
    if (!p) throw new CronParseError257(`Empty part in ${name} field`);

    // */step or N/step or N-M/step
    const slashIdx = p.indexOf('/');
    if (slashIdx !== -1) {
      const stepStr = p.slice(slashIdx + 1);
      const step = parseInt(stepStr, 10);
      if (isNaN(step) || step < 1) throw new CronParseError257(`Invalid step "${stepStr}" in ${name} field`);

      const rangePart = p.slice(0, slashIdx);
      let rMin, rMax;
      if (rangePart === '*') {
        rMin = min; rMax = max;
      } else if (rangePart.includes('-')) {
        const [a, b] = rangePart.split('-');
        rMin = _norm(a); rMax = _norm(b);
      } else {
        rMin = _norm(rangePart); rMax = max;
      }
      for (let v = rMin; v <= rMax; v += step) _add(v);
      continue;
    }

    // N-M range
    if (p.includes('-')) {
      const [a, b] = p.split('-');
      const rMin = _norm(a), rMax = _norm(b);
      if (rMin > rMax) throw new CronParseError257(`Invalid range ${p} in ${name} field`);
      for (let v = rMin; v <= rMax; v++) _add(v);
      continue;
    }

    // *
    if (p === '*') {
      for (let v = min; v <= max; v++) _add(v);
      continue;
    }

    // single value
    _add(_norm(p));
  }

  return result;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Parse a 5-field cron expression.
 * @param {string} expr
 * @returns {{ ok:boolean, fields?:{minute,hour,day,month,weekday}, error?:string }}
 */
function parseCronExpression257(expr) {
  if (!expr || typeof expr !== 'string') return { ok: false, error: 'expression must be a non-empty string' };

  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return { ok: false, error: `expected 5 fields, got ${parts.length}` };

  const [minuteStr, hourStr, dayStr, monthStr, weekdayStr] = parts;

  try {
    const minute  = _expandField257(minuteStr,  'minute',  null);
    const hour    = _expandField257(hourStr,    'hour',    null);
    const day     = _expandField257(dayStr,     'day',     null);
    const month   = _expandField257(monthStr,   'month',   MONTH_NAMES_257);
    const weekday = _expandField257(weekdayStr, 'weekday', DOW_NAMES_257);
    return { ok: true, fields: { minute, hour, day, month, weekday } };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Return true if the given Date matches the cron expression (minute-level precision).
 * @param {string} expr
 * @param {Date}   [date]  defaults to now
 * @returns {boolean}
 */
function isCronDue257(expr, date) {
  const parsed = parseCronExpression257(expr);
  if (!parsed.ok) return false;
  const d = date instanceof Date ? date : new Date();
  const { minute, hour, day, month, weekday } = parsed.fields;
  return (
    minute.has(d.getMinutes()) &&
    hour.has(d.getHours()) &&
    day.has(d.getDate()) &&
    month.has(d.getMonth() + 1) &&
    weekday.has(d.getDay())
  );
}

/**
 * Calculate milliseconds until the next fire time.
 * Searches forward minute-by-minute (max 366 days × 24h × 60m = ~527,040 iterations).
 * @param {string} expr
 * @param {Date}   [fromDate]  defaults to now
 * @returns {number|null}  ms until next fire, or null if expression is invalid
 */
function nextCronFireMs257(expr, fromDate) {
  const parsed = parseCronExpression257(expr);
  if (!parsed.ok) return null;

  const { minute, hour, day, month, weekday } = parsed.fields;

  // Start from the NEXT minute (we don't fire in the current minute)
  const start = fromDate instanceof Date ? new Date(fromDate) : new Date();
  start.setSeconds(0, 0);
  start.setMinutes(start.getMinutes() + 1);

  const MAX_ITERATIONS = 527041; // ~366 days
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    if (
      minute.has(start.getMinutes()) &&
      hour.has(start.getHours()) &&
      day.has(start.getDate()) &&
      month.has(start.getMonth() + 1) &&
      weekday.has(start.getDay())
    ) {
      const base = fromDate instanceof Date ? fromDate : new Date();
      return start.getTime() - base.getTime();
    }
    start.setMinutes(start.getMinutes() + 1);
  }

  return null; // unreachable for valid expressions
}

module.exports = {
  parseCronExpression257,
  isCronDue257,
  nextCronFireMs257,
  CronParseError257,
};
