// ============================================================
// src/lib/sandboxHarden227.js — Sandbox Hardening (P121-B)
// V227. Extends sandboxExec225 with:
//   1. Stricter allow-list (removes curl/wget/sh from default).
//   2. Per-call timeout enforcement tested explicitly.
//   3. Output-cap enforcement with truncated flag.
//   4. Allow-list validation helpers for use in tests + runtime.
//
// Used by v227.test.js and optionally passed to createSandboxExec225
// as the `allowlist` option to override the default.
//
// R1: sacred untouched. R2: identifiers end in _227. R3: zero new npm deps.
// ============================================================
'use strict';

const { createSandboxExec225, DEFAULT_ALLOWLIST_225 } = require('./sandboxExec225');

// ── Hardened allow-list (removes network tools + raw shell) ────────────────────
const HARDENED_ALLOWLIST_227 = Object.freeze(
  DEFAULT_ALLOWLIST_225.filter(cmd => !['curl', 'wget', 'sh'].includes(cmd))
);

// ── Validation helpers ─────────────────────────────────────────────────────────

/**
 * Validates that every entry in the provided allowlist is a simple
 * alphanumeric/hyphen binary name with no path separators.
 * Returns { ok, errors } — errors is empty array on success.
 */
function validateAllowlist_227(allowlist) {
  if (!Array.isArray(allowlist)) {
    return { ok: false, errors: ['allowlist must be an array'] };
  }
  const SAFE_RE_227 = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;
  const errs_227 = [];
  for (const entry of allowlist) {
    if (typeof entry !== 'string') { errs_227.push(`non-string entry: ${JSON.stringify(entry)}`); continue; }
    if (entry.includes('/') || entry.includes('\\')) { errs_227.push(`path separator in entry: "${entry}"`); continue; }
    if (!SAFE_RE_227.test(entry)) { errs_227.push(`suspicious entry: "${entry}"`); }
  }
  return { ok: errs_227.length === 0, errors: errs_227 };
}

/**
 * Creates a hardened sandbox with:
 *   - HARDENED_ALLOWLIST_227 by default (curl/wget/sh removed)
 *   - Configurable perCallTimeout (max MAX_TIMEOUT_MS_225)
 *   - Configurable outputCap (defaults to 512KB — tighter than V225's 1MB)
 */
function createHardenedSandbox_227(opts) {
  const o = opts || {};
  return createSandboxExec225({
    ...o,
    allowlist: Array.isArray(o.allowlist) ? o.allowlist : HARDENED_ALLOWLIST_227.slice(),
    outputCap: typeof o.outputCap === 'number' ? o.outputCap : 512_000, // 512 KB
    timeoutMs: typeof o.timeoutMs === 'number' ? o.timeoutMs : 30_000,  // 30 s default
  });
}

/**
 * Returns a per-call exec wrapper that enforces an additional per-call
 * timeout independent of the sandbox default (useful for tests).
 */
function withPerCallTimeout_227(sandbox, perCallMs) {
  return {
    ...sandbox,
    exec: (cmd, opts2) => sandbox.exec(cmd, Object.assign({}, opts2, { timeoutMs: perCallMs })),
  };
}

module.exports = {
  HARDENED_ALLOWLIST_227,
  validateAllowlist_227,
  createHardenedSandbox_227,
  withPerCallTimeout_227,
};
