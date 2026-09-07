'use strict';
/**
 * src/lib/automationCatalog254.js — ECOS V254 (Phase P150)
 *
 * A registry for reusable AUTOMATION RECIPES — the home for the automations that
 * external builders (e.g. Gumloop) generate. Each recipe is a named, validated
 * sequence of tool steps with a trigger. Pure + dependency-free (R6);
 * version-suffixed (…254, BUG-L safe).
 *
 * Cohesion with existing layers:
 *   - Steps reference tools by name → resolve against toolCatalog237 at run time.
 *   - An optional injected `classify(tool,args)` (e.g. V240 dangerousToolInterlock)
 *     lets the catalog annotate which steps are destructive / require HITL, so an
 *     automation surfaces its risk profile before anyone runs it.
 *
 * A recipe:
 *   { id, name, description?, trigger, steps:[{tool, args?, verify?}], tags?, source? }
 *   trigger ∈ { 'manual' | 'schedule' | 'webhook' | 'event' }
 *
 * @version 254.0.0
 */

const TRIGGERS_254 = new Set(['manual', 'schedule', 'webhook', 'event']);
const ID_RE_254 = /^[a-z0-9][a-z0-9_-]{1,63}$/;

class AutomationError254 extends Error {
  constructor(msg, code) { super(msg); this.name = 'AutomationError254'; this.code = code || 'AUTOMATION_ERROR'; this.statusCode = 400; }
}

/**
 * Validate a recipe shape. Pure — returns { valid, errors:[] } (never throws).
 */
function validateAutomation254(recipe) {
  const errors = [];
  if (!recipe || typeof recipe !== 'object') return { valid: false, errors: ['recipe must be an object'] };
  if (!ID_RE_254.test(String(recipe.id || ''))) errors.push('id must be a slug [a-z0-9_-], 2-64 chars');
  if (!recipe.name || typeof recipe.name !== 'string') errors.push('name is required');
  if (!TRIGGERS_254.has(recipe.trigger)) errors.push('trigger must be one of: ' + [...TRIGGERS_254].join(', '));
  if (!Array.isArray(recipe.steps) || recipe.steps.length === 0) {
    errors.push('steps must be a non-empty array');
  } else {
    recipe.steps.forEach((s, i) => {
      if (!s || typeof s !== 'object' || !s.tool || typeof s.tool !== 'string') errors.push(`step[${i}].tool is required`);
      if (s && s.args != null && typeof s.args !== 'object') errors.push(`step[${i}].args must be an object`);
    });
  }
  if (recipe.tags != null && !Array.isArray(recipe.tags)) errors.push('tags must be an array');
  return { valid: errors.length === 0, errors };
}

function createAutomationCatalog254(opts = {}) {
  const classify = typeof opts.classify === 'function' ? opts.classify : null;
  const audit = typeof opts.audit === 'function' ? opts.audit : () => {};
  const now = typeof opts.now === 'function' ? opts.now : Date.now;
  const store = new Map(); // id -> recipe (frozen copy)

  // Annotate each step with a risk level using the injected classifier (if any).
  function _riskProfile254(recipe) {
    if (!classify) return { analyzed: false, destructiveSteps: [], requiresHitl: false };
    const destructiveSteps = [];
    recipe.steps.forEach((s, i) => {
      try {
        const c = classify({ name: s.tool, destructive: s.destructive }, s.args || {});
        if (c && (c.decision === 'require_hitl' || c.decision === 'block')) destructiveSteps.push({ index: i, tool: s.tool, decision: c.decision });
      } catch (_) {}
    });
    return { analyzed: true, destructiveSteps, requiresHitl: destructiveSteps.length > 0 };
  }

  function register(recipe) {
    const v = validateAutomation254(recipe);
    if (!v.valid) throw new AutomationError254('invalid recipe: ' + v.errors.join('; '), 'INVALID_RECIPE');
    const stored = {
      id: recipe.id, name: recipe.name, description: recipe.description || '',
      trigger: recipe.trigger,
      steps: recipe.steps.map(s => ({ tool: s.tool, args: s.args || {}, verify: s.verify || null })),
      tags: Array.isArray(recipe.tags) ? recipe.tags.slice() : [],
      source: recipe.source || 'unknown',
      createdAt: store.has(recipe.id) ? store.get(recipe.id).createdAt : new Date(now()).toISOString(),
      updatedAt: new Date(now()).toISOString(),
    };
    stored.risk = _riskProfile254(stored);
    store.set(recipe.id, stored);
    audit({ action: 'automation_register', id: stored.id, source: stored.source, steps: stored.steps.length, requiresHitl: stored.risk.requiresHitl });
    return JSON.parse(JSON.stringify(stored));
  }

  function get(id) { const r = store.get(id); return r ? JSON.parse(JSON.stringify(r)) : null; }

  function list(filter = {}) {
    let out = [...store.values()];
    if (filter.trigger) out = out.filter(r => r.trigger === filter.trigger);
    if (filter.tag) out = out.filter(r => r.tags.includes(filter.tag));
    if (filter.source) out = out.filter(r => r.source === filter.source);
    out.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    return out.map(r => ({ id: r.id, name: r.name, trigger: r.trigger, steps: r.steps.length, tags: r.tags, source: r.source, requiresHitl: r.risk && r.risk.requiresHitl, updatedAt: r.updatedAt }));
  }

  function remove(id) { const existed = store.delete(id); audit({ action: 'automation_remove', id, existed }); return { removed: existed }; }

  function stats() {
    const all = [...store.values()];
    const byTrigger = {}; const bySource = {};
    for (const r of all) { byTrigger[r.trigger] = (byTrigger[r.trigger] || 0) + 1; bySource[r.source] = (bySource[r.source] || 0) + 1; }
    return { total: all.length, byTrigger, bySource, requiringHitl: all.filter(r => r.risk && r.risk.requiresHitl).length };
  }

  return { register, get, list, remove, stats, validate: validateAutomation254 };
}

module.exports = { createAutomationCatalog254, validateAutomation254, TRIGGERS_254, AutomationError254 };
