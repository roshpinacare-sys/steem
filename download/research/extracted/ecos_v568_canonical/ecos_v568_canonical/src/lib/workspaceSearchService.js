/**
 * lib/workspaceSearchService.js — V174
 * ====================================
 * Workspace Search — full-text-ish search across tasks / tags / comments.
 *
 * Decoupled by design: the caller injects async "providers" that return the raw
 * records, so this service is pure, dependency-free, and unit-testable without a
 * DB or the rest of the server. Matching is case-insensitive substring with a
 * simple relevance score (exact > prefix > substring; title weighted over body).
 *
 * Sacred Files: lib/fiatLedger.js, lib/auditLog.js — UNTOUCHED
 * [V172-T01 … V172-T02]
 */
'use strict';

const ALL_TYPES = ['tasks', 'tags', 'comments'];
const MAX_LIMIT = 100;

class SearchValidationError extends Error {
  constructor(msg) { super(msg); this.name = 'SearchValidationError'; this.code = 'SEARCH_VALIDATION'; this.statusCode = 400; }
}

/** Parse the `types` param (csv string or array) into a validated list. */
function parseTypes(types) {
  if (!types) return [...ALL_TYPES];
  const arr = Array.isArray(types) ? types : String(types).split(',');
  const cleaned = arr.map(t => String(t).trim().toLowerCase()).filter(Boolean);
  const invalid = cleaned.filter(t => !ALL_TYPES.includes(t));
  if (invalid.length) throw new SearchValidationError(`invalid type(s): ${invalid.join(', ')}`);
  return cleaned.length ? [...new Set(cleaned)] : [...ALL_TYPES];
}

/** Relevance score of a query against a primary (title) and secondary (body) field. */
function scoreMatch(q, title, body) {
  const ql = q.toLowerCase();
  const t = (title || '').toLowerCase();
  const b = (body || '').toLowerCase();
  let score = 0;
  if (t === ql) score = 100;
  else if (t.startsWith(ql)) score = 50;
  else if (t.includes(ql)) score = 20;
  if (score === 0 && b.includes(ql)) score = 10;
  return score;
}

/** Build a short snippet around the first match in `text`. */
function snippet(text, q, radius = 40) {
  if (!text) return '';
  const s = String(text);
  const idx = s.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return s.slice(0, radius * 2);
  const start = Math.max(0, idx - radius);
  const end = Math.min(s.length, idx + q.length + radius);
  return (start > 0 ? '…' : '') + s.slice(start, end) + (end < s.length ? '…' : '');
}

/**
 * Return an array of character-level match spans for `q` in `text`.
 * Each span: { start, end, text } where text is the matched slice.
 * Case-insensitive. Returns [] if no match.
 * [V174]
 */
function highlight(text, q) {
  if (!text || !q) return [];
  const s = String(text);
  const ql = q.toLowerCase();
  const sl = s.toLowerCase();
  const spans = [];
  let idx = 0;
  while (idx < sl.length) {
    const pos = sl.indexOf(ql, idx);
    if (pos === -1) break;
    spans.push({ start: pos, end: pos + ql.length, text: s.slice(pos, pos + ql.length) });
    idx = pos + ql.length;
  }
  return spans;
}

class WorkspaceSearchService {
  constructor(opts = {}) {
    this._log = opts.logger || { info() {}, warn() {}, error() {} };
    this._totalSearches = 0;
  }
  setLogger(log) { this._log = log; }

  /**
   * @param {string} workspaceId
   * @param {{ q:string, types?:string|string[], limit?:number, offset?:number }} opts
   * @param {{ tasks?:Function, tags?:Function, comments?:Function }} providers
   *        each provider: async (workspaceId) => record[]
   * @returns {Promise<{query,types,total,count,limit,offset,hasMore,results}>}
   */
  async search(workspaceId, opts = {}, providers = {}) {
    if (!workspaceId) throw new SearchValidationError('workspaceId is required');
    const q = (opts.q || '').trim();
    if (q.length < 1) throw new SearchValidationError('query (q) is required');
    if (q.length > 200) throw new SearchValidationError('query too long (max 200)');

    const types  = parseTypes(opts.types);
    const limit  = Math.min(MAX_LIMIT, Math.max(1, parseInt(opts.limit, 10) || 20));
    const offset = Math.max(0, parseInt(opts.offset, 10) || 0);
    this._totalSearches++;

    const results = [];

    if (types.includes('tasks') && typeof providers.tasks === 'function') {
      for (const t of (await providers.tasks(workspaceId)) || []) {
        const title = t.title || t.name || '';
        const body  = t.description || t.body || '';
        const score = scoreMatch(q, title, body);
        if (score > 0) results.push({ type: 'task', id: t.id, title, snippet: snippet(body || title, q), highlights: highlight(title, q), score, status: t.status });
      }
    }
    if (types.includes('tags') && typeof providers.tags === 'function') {
      for (const g of (await providers.tags(workspaceId)) || []) {
        const name = g.name || g.label || '';
        const score = scoreMatch(q, name, g.description);
        if (score > 0) results.push({ type: 'tag', id: g.id, title: name, snippet: snippet(g.description || name, q), highlights: highlight(name, q), score });
      }
    }
    if (types.includes('comments') && typeof providers.comments === 'function') {
      for (const c of (await providers.comments(workspaceId)) || []) {
        const body = c.body || c.text || '';
        const score = scoreMatch(q, '', body); // comments have no title; body only
        if (score > 0) results.push({ type: 'comment', id: c.id, title: c.taskId ? `Comment on ${c.taskId}` : 'Comment', snippet: snippet(body, q), highlights: highlight(body, q), score, taskId: c.taskId });
      }
    }

    results.sort((a, b) => b.score - a.score || String(a.title).localeCompare(String(b.title)));

    const total = results.length;
    const page = results.slice(offset, offset + limit);
    return {
      query: q, types, total, count: page.length, limit, offset,
      hasMore: offset + page.length < total,
      results: page,
    };
  }

  stats() { return { totalSearches: this._totalSearches, searchableTypes: [...ALL_TYPES] }; }
}

const defaultSearchService = new WorkspaceSearchService();

module.exports = {
  WorkspaceSearchService,
  defaultSearchService,
  SearchValidationError,
  parseTypes,
  scoreMatch,
  snippet,
  highlight,
  ALL_TYPES,
  MAX_LIMIT,
};

if (process.env.NODE_ENV === 'test') {
  module.exports._search = defaultSearchService;
}
