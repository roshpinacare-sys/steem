'use strict';
/**
 * selfmodel.cjs — סכימת-הדגם-העצמי SAOS-SELFMODEL/1 + מאמת + בונה · V-a, trace 1a10c90522120149
 * ═════════════════════════════════════════════════════════════════════════════════════════════════════
 * R27 מדד: לאורגניזם אין דגם-עצמי — התמונה חיה בסשני-LLM שמתים-עם-הסשן.
 * organism.json הוא הזיכרון-האפיסטמי: מה REAL / STAGED / HALTED / ORPHANED, מי כותב,
 * מי סמכות, מה סתירה-פתוחה, ומה לא-יודעים.
 *
 * החוק-האפיסטמי-המכני: **טענת epistemic=OBSERVED בלי evidence[] = שגיאת-סכימה** —
 * המאמת דוחה. status=REAL מחייב epistemic=OBSERVED (עם ראיה). המאמת הוא בור-מכני,
 * לא קישוט: הוא מסרב לשמור דגם שמשקר על-מקורותיו.
 * אפס-סודות: המודול קורא/כותב מדיניות-בלבד.
 */
const fs = require('fs');

const SCHEMA = 'SAOS-SELFMODEL/1';
const SOVEREIGNTY_SCHEMA = 'SAOS-SOVEREIGNTY/1';
const CAP_STATUS = Object.freeze(['REAL', 'STAGED', 'HALTED', 'ORPHANED']);
const EPISTEMIC = Object.freeze(['OBSERVED', 'INFERRED', 'UNKNOWN', 'CONTRADICTED']);
const WRITER_KINDS = Object.freeze(['ci-workflow', 'parallel-session', 'unknown', 'live-process']);
const AUTHORITY_KEYS = Object.freeze(['decideAlone', 'stopShrink', 'policyGated', 'ownerOnly']);
const HALT_COVERAGE = Object.freeze(['ORGANISM_ONLY', 'DOMAIN', 'WORLD']);

/** תבנית-ריקה כנה — כל-שדה קיים, הכל ריק, אפס-טענות. */
function EMPTY() {
  return {
    protocol: SCHEMA,
    generatedAt: null,
    homes: {},
    capabilities: [],
    writers: [],
    authorities: { decideAlone: [], stopShrink: [], policyGated: [], ownerOnly: [] },
    canonicalTruths: [],
    contradictions: [],
    frontier: {
      lanes: {},
      computedAt: null,
      rule: 'REAL requires: gate-authenticity green + >=N observed cycles + zero open contradictions on lane + writer attributed',
    },
    custody: {},
    unknowns: [],
    measurementNotes: ['own documented errors go here'],
  };
}

function hasEvidence(x) { return Array.isArray(x) && x.length > 0 && x.every((e) => e && typeof e === 'object'); }

/**
 * validate(model) → { ok, errors[], warnings[] }
 * המאמת המכני — דוחה טענות-OBSERVED בלי-ראיה, REAL בלי-OBSERVED, סטטוסים-זרים.
 */
function validate(model) {
  const errors = [];
  const warnings = [];
  if (!model || typeof model !== 'object' || Array.isArray(model)) return { ok: false, errors: ['model is not an object'], warnings };
  if (model.protocol !== SCHEMA) errors.push(`protocol must be ${SCHEMA}, got ${String(model.protocol)}`);
  if (model.generatedAt != null && Number.isNaN(Date.parse(model.generatedAt))) errors.push('generatedAt is not ISO-parseable');

  const caps = Array.isArray(model.capabilities) ? model.capabilities : [];
  caps.forEach((c, idx) => {
    const id = (c && c.id) || `capabilities[${idx}]`;
    if (!c || typeof c !== 'object') { errors.push(`${id}: not an object`); return; }
    if (!CAP_STATUS.includes(c.status)) errors.push(`${id}: status '${String(c.status)}' not in ${CAP_STATUS.join('|')}`);
    if (!EPISTEMIC.includes(c.epistemic)) errors.push(`${id}: epistemic '${String(c.epistemic)}' not in ${EPISTEMIC.join('|')}`);
    if (c.epistemic === 'OBSERVED' && !hasEvidence(c.evidence)) errors.push(`${id}: epistemic=OBSERVED requires non-empty evidence[] (epistemic honesty is mechanical)`);
    if (c.status === 'REAL' && c.epistemic !== 'OBSERVED') errors.push(`${id}: status=REAL requires epistemic=OBSERVED with evidence`);
    if (!c.home) errors.push(`${id}: missing home`);
    if (!c.lane) warnings.push(`${id}: missing lane`);
    if (c.ageHours != null && typeof c.ageHours !== 'number') errors.push(`${id}: ageHours must be a number`);
  });

  const writers = Array.isArray(model.writers) ? model.writers : [];
  writers.forEach((w, idx) => {
    const id = (w && w.id) || `writers[${idx}]`;
    if (!w || typeof w !== 'object') { errors.push(`${id}: not an object`); return; }
    if (!WRITER_KINDS.includes(w.kind)) errors.push(`${id}: kind '${String(w.kind)}' not in ${WRITER_KINDS.join('|')}`);
    if (typeof w.confidence !== 'number' || w.confidence < 0 || w.confidence > 1) errors.push(`${id}: confidence must be 0..1`);
    if (!EPISTEMIC.includes(w.epistemic)) errors.push(`${id}: epistemic '${String(w.epistemic)}' not in ${EPISTEMIC.join('|')}`);
    if (w.epistemic === 'OBSERVED' && !hasEvidence(w.evidence)) errors.push(`${id}: epistemic=OBSERVED requires non-empty evidence[]`);
  });

  if (model.authorities && typeof model.authorities === 'object' && !Array.isArray(model.authorities)) {
    for (const k of Object.keys(model.authorities)) if (!AUTHORITY_KEYS.includes(k)) warnings.push(`authorities.${k}: unknown authority class`);
  } else if (model.authorities != null) errors.push('authorities must be an object with keys ' + AUTHORITY_KEYS.join(','));

  const contra = Array.isArray(model.contradictions) ? model.contradictions : [];
  contra.forEach((c, idx) => {
    const id = (c && c.id) || `contradictions[${idx}]`;
    if (!c || typeof c !== 'object') { errors.push(`${id}: not an object`); return; }
    if (c.status !== 'open' && c.status !== 'resolved') errors.push(`${id}: status must be open|resolved`);
    if (!EPISTEMIC.includes(c.epistemic)) errors.push(`${id}: epistemic '${String(c.epistemic)}' not in ${EPISTEMIC.join('|')}`);
    if (typeof c.confidence !== 'number' || c.confidence < 0 || c.confidence > 1) errors.push(`${id}: confidence must be 0..1`);
  });

  if (model.frontier && typeof model.frontier === 'object') {
    const lanes = model.frontier.lanes || {};
    for (const lane of Object.keys(lanes)) {
      const l = lanes[lane] || {};
      if (!CAP_STATUS.includes(l.level)) errors.push(`frontier.lanes.${lane}: level '${String(l.level)}' not in ${CAP_STATUS.join('|')}`);
      if (l.level === 'REAL' && (!l.justification || !hasEvidence(l.evidence))) errors.push(`frontier.lanes.${lane}: level=REAL requires justification + evidence[]`);
    }
  } else errors.push('frontier section missing');

  if (!Array.isArray(model.measurementNotes)) warnings.push('measurementNotes missing — a self-model without documented measurement errors is not honest');
  if (!Array.isArray(model.unknowns)) warnings.push('unknowns missing — a self-model without declared unknowns is overclaiming');

  /* R29 — SOVEREIGNTY/1 (trace 1a10d243868ffdc1): the sovereignty boundary section is
   * mechanically validated. The honesty law it enforces: **a REAL capital claim is
   * incompatible with haltCoverage=ORGANISM_ONLY** — if capital can move through signing
   * surfaces the organism cannot stop (proven 2026-10-05 17:07:36Z), no lane may claim REAL.
   * The validator refuses to store a model that overclaims sovereignty. */
  if (model.sovereignty != null) {
    const sov = model.sovereignty;
    if (typeof sov !== 'object' || Array.isArray(sov)) {
      errors.push('sovereignty: must be an object');
    } else {
      if (sov.protocol !== SOVEREIGNTY_SCHEMA) errors.push(`sovereignty.protocol must be ${SOVEREIGNTY_SCHEMA}, got ${String(sov.protocol)}`);
      if (!HALT_COVERAGE.includes(sov.haltCoverage)) errors.push(`sovereignty.haltCoverage must be in ${HALT_COVERAGE.join('|')}, got ${String(sov.haltCoverage)}`);
      if (sov.haltCoverage === 'ORGANISM_ONLY') {
        /* capital lanes only: grid/general move capital off the account; claims is posting-only
         * reward harvesting (idempotent, no capital exit) and may be REAL while the capital
         * boundary is uncovered — otherwise the honesty law would kill the whole loop
         * (beat exit 3) over a lane that cannot move capital. Scope follows sovereignty.capitalLanes. */
        const capitalLanes = (Array.isArray(sov.capitalLanes) && sov.capitalLanes.length ? sov.capitalLanes : ['grid', 'general']).map((x) => String(x).toLowerCase());
        const realLanes = Object.entries((model.frontier && model.frontier.lanes) || {}).filter(([lane, l]) => l && l.level === 'REAL' && capitalLanes.includes(String(lane).toLowerCase())).map(([lane]) => lane);
        const realCaps = caps.filter((c) => c.status === 'REAL' && (c.lane ? capitalLanes.includes(String(c.lane).toLowerCase()) : true)).map((c) => c.id);
        if (realLanes.length) errors.push(`sovereignty: capital lanes [${realLanes.join(',')}] claim REAL while haltCoverage=ORGANISM_ONLY — a REAL capital claim requires coverage beyond the organism (R29)`);
        if (realCaps.length) errors.push(`sovereignty: capital capabilities [${realCaps.join(',')}] claim REAL while haltCoverage=ORGANISM_ONLY (R29)`);
      }
      if (!Array.isArray(sov.cannotStop)) warnings.push('sovereignty.cannotStop missing — an actor list without “I cannot stop this” is overclaiming stop-power');
      if (!Array.isArray(sov.capitalPaths)) warnings.push('sovereignty.capitalPaths missing — CAPITAL_CONTROL is UNKNOWN until every intent→chain-mutation path is named');
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

/** load(file) → { ok, model?, errors, warnings, reason? } — קובץ-לא-קריא = כישלון-גלוי, לא דגם-שקרי. */
function load(file) {
  let doc;
  try { doc = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { return { ok: false, errors: ['unreadable: ' + String((e && e.message) || e).slice(0, 120)], warnings: [], reason: 'selfmodel-unreadable' }; }
  const v = validate(doc);
  return { ok: v.ok, model: doc, errors: v.errors, warnings: v.warnings };
}

/** save(model, file) — לא שומר דגם-לא-תקף (המאמת הוא שוער, לא ייעץ). */
function save(model, file) {
  const v = validate(model);
  if (!v.ok) return { ok: false, errors: v.errors, warnings: v.warnings };
  try { fs.writeFileSync(file, JSON.stringify(model, null, 2) + '\n'); return { ok: true, errors: [], warnings: v.warnings }; }
  catch (e) { return { ok: false, errors: ['write-failed: ' + String((e && e.message) || e).slice(0, 120)], warnings: v.warnings }; }
}

/**
 * updateSection(model, section, patch) → דגם-חדש (עותק-עמוק): אובייקטים ממוזגים,
 * מערכים מוחלפים בשלמותם, generatedAt נחתם. בונה-קטן ל-beat (V-b) ולכלי-מדידה.
 */
function updateSection(model, section, patch) {
  const next = JSON.parse(JSON.stringify(model));
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) next[section] = patch;
  else if (next[section] && typeof next[section] === 'object' && !Array.isArray(next[section])) Object.assign(next[section], patch);
  else next[section] = patch;
  next.generatedAt = new Date().toISOString();
  return next;
}

module.exports = { SCHEMA, SOVEREIGNTY_SCHEMA, EMPTY, validate, load, save, updateSection, CAP_STATUS, EPISTEMIC, WRITER_KINDS, AUTHORITY_KEYS, HALT_COVERAGE };
