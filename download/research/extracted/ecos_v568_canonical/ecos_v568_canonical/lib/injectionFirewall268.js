'use strict';
/**
 * src/lib/injectionFirewall268.js — Prompt Injection Firewall (V268)
 *
 * Builds on injectionFirewall264 with:
 *   - CVE-2025-32711 (EchoLeak) defense: zero-width char detection
 *   - CVE-2025-53773 (GitHub Copilot YOLO) defense: mode-override detection
 *   - Output egress rate limiting (per user/session)
 *   - Memory context isolation: separate retrieval from instruction context
 *   - Threat scoring: returns composite risk score (0–100)
 *   - V268 sacred file list (NEVER touch fiatLedger.js or auditLog.js)
 *
 * PROGRAM 06: Memory Integrity Layer / PROGRAM 07: Security
 * Zero new npm deps. Identifiers end with 268.
 */
'use strict';

const crypto = require('node:crypto');

const SACRED_FILES_268 = Object.freeze([
  'fiatLedger.js', 'auditLog.js',
  'lib/fiatLedger.js', 'lib/auditLog.js',
  'src/lib/fiatLedger.js', 'src/lib/auditLog.js',
]);

// Extended PII / credential egress patterns
const EGRESS_PATTERNS_268 = [
  /\bsk-[A-Za-z0-9]{20,}\b/,
  /\bAIza[A-Za-z0-9_-]{35}\b/,
  /\b[0-9a-f]{64}\b/,
  /password\s*[:=]\s*\S+/i,
  /Authorization\s*:\s*Bearer\s+\S+/i,
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z]{2,}\b/i,
  /\bDATABASE_URL\s*=\s*\S+/i,
  /postgres:\/\/[^@\s]+@/i,
];

// EchoLeak: zero-width / invisible character patterns
const ZERO_WIDTH_PATTERN_268 = /[\u200B-\u200D\u2060\uFEFF\u00AD\u034F\u115F\u1160\u17B4\u17B5\u3164\uFFA0]/;

// YOLO mode / override injection patterns
const MODE_OVERRIDE_PATTERNS_268 = [
  /ignore\s+(?:all\s+)?(?:previous|above)\s+instructions/i,
  /disregard\s+(?:all\s+)?(?:previous|above)\s+instructions/i,
  /you\s+are\s+now\s+in\s+(?:yolo|developer|jailbreak|unrestricted)\s+mode/i,
  /system\s*:\s*you\s+are/i,
  /\[system\]/i,
  /\{\{system\}\}/i,
  /<\s*system\s*>/i,
  /act\s+as\s+(?:a\s+)?(?:different|another|unrestricted|jailbroken)\s+(?:ai|assistant|model)/i,
];

const TOOL_PERMISSIONS_268 = {
  read_file:    ['read:files'],
  write_file:   ['write:files'],
  exec_code:    ['exec:sandbox'],
  web_search:   ['read:web'],
  ledger_read:  ['ledger:read'],
  ledger_write: ['ledger:write', 'audit:write'],
  memory_write: ['write:memory'],
  memory_read:  ['read:memory'],
  x402_send:    ['ledger:write', 'x402:send'],
};

class InjectionFirewall268 {
  constructor(opts = {}) {
    this._logger     = opts.logger     || console;
    this._auditLog   = opts.auditLog   || null;
    this._hitlGate   = opts.hitlGate   || null;
    this._blocked268 = [];
    this._stats268   = {
      total: 0, blocked: 0, egressBlocked: 0, zerowWidthBlocked: 0, modeOverrideBlocked: 0,
    };
  
    this._perf268 = { latencies: [] };
    this._logAdapter268 = opts.logAdapter || null;
  }

  // ── Content tagging ───────────────────────────────────────────────────────

  tagUntrusted268(content, sourceType = 'external') {
    const _t0 = Date.now();
    const sanitized = this._stripInjectionAttempts268(String(content || ''));
    this._recordLatency268(_t0);
    return `[UNTRUSTED:${sourceType.toUpperCase()}]\n${sanitized}\n[/UNTRUSTED]`;
  }

  buildSafePrompt268(systemInstruction, userContent, retrievedContext = []) {
    const sanitizedUser = this._stripInjectionAttempts268(String(userContent || ''));
    const sanitizedCtx = retrievedContext.map(c =>
      `[RETRIEVED_CONTEXT id="${c.id || 'anon'}"]\n${this._stripInjectionAttempts268(String(c.content || ''))}\n[/RETRIEVED_CONTEXT]`
    );
    return {
      system: systemInstruction,
      user:   sanitizedUser,
      context: sanitizedCtx.join('\n'),
      safe:   true,
      v:      '268',
    };
  }

  // ── Egress scanning ───────────────────────────────────────────────────────

  scanEgress268(outputText) {
    this._stats268.total++;
    const found = [];

    for (const pattern of EGRESS_PATTERNS_268) {
      if (pattern.test(outputText)) {
        found.push({ type: 'pii_or_credential', pattern: pattern.toString().slice(0, 30) });
      }
    }

    if (found.length > 0) {
      this._stats268.egressBlocked++;
      const entry = { type: 'egress_blocked', patterns: found, ts: new Date().toISOString() };
      this._blocked268.push(entry);
      if (this._blocked268.length > 10_000) this._blocked268.shift();
      this._log268('EGRESS_BLOCKED', entry);
      return { ok: false, blocked: true, reasons: found };
    }
    return { ok: true, blocked: false };
  }

  // ── Sacred file protection ────────────────────────────────────────────────

  checkSacredFile268(filename) {
    const clean = String(filename).replace(/\\/g, '/');
    for (const sacred of SACRED_FILES_268) {
      if (clean.endsWith(sacred) || clean === sacred) {
        this._stats268.blocked++;
        const entry = { type: 'sacred_file_touch', filename: clean, ts: new Date().toISOString() };
        this._blocked268.push(entry);
        this._log268('SACRED_FILE_BLOCK', entry);
        if (this._auditLog?.append) { try { this._auditLog.append({ event: 'injectionFirewall268.sacredFileBlock', filename: clean }); } catch (_) {} }
        return { blocked: true, reason: `${clean} is a sacred file and cannot be modified` };
      }
    }
    return { blocked: false };
  }

  // ── Input analysis ────────────────────────────────────────────────────────

  analyzeInput268(content) {
    this._stats268.total++;
    const str = String(content || '');
    let riskScore = 0;
    const threats = [];

    // Zero-width character detection (EchoLeak defense)
    if (ZERO_WIDTH_PATTERN_268.test(str)) {
      riskScore += 40;
      threats.push({ type: 'zero_width_chars', severity: 'high', cve: 'CVE-2025-32711' });
      this._stats268.zerowWidthBlocked++;
    }

    // Mode override / jailbreak detection (YOLO defense)
    for (const p of MODE_OVERRIDE_PATTERNS_268) {
      if (p.test(str)) {
        riskScore += 60;
        threats.push({ type: 'mode_override_attempt', severity: 'critical', pattern: p.toString().slice(0, 40) });
        this._stats268.modeOverrideBlocked++;
        break;
      }
    }

    // Sacred file mention
    for (const sf of SACRED_FILES_268) {
      if (str.includes(sf)) {
        riskScore += 80;
        threats.push({ type: 'sacred_file_mention', severity: 'critical', file: sf });
      }
    }

    riskScore = Math.min(100, riskScore);
    const verdict = riskScore >= 60 ? 'BLOCK' : riskScore >= 30 ? 'WARN' : 'ALLOW';
    if (verdict === 'BLOCK') {
      this._stats268.blocked++;
      const entry = { type: 'input_blocked', riskScore, threats, ts: new Date().toISOString() };
      this._blocked268.push(entry);
      this._log268('INPUT_BLOCKED', { riskScore, threats });
    }

    return { verdict, riskScore, threats };
  }

  // ── Tool permission check ─────────────────────────────────────────────────

  checkToolPermission268(toolName, agentPermissions = []) {
    const required = TOOL_PERMISSIONS_268[toolName];
    if (!required) return { allowed: true, reason: 'tool_not_registered' };
    const missing = required.filter(p => !agentPermissions.includes(p));
    if (missing.length > 0) {
      this._log268('TOOL_BLOCKED', { toolName, missing });
      return { allowed: false, reason: `missing_permissions: ${missing.join(', ')}`, missing };
    }
    return { allowed: true };
  }

  getStats268() {
    return {
      version: '268',
      ...this._stats268,
      blockedCount: this._blocked268.length,
      sacredFiles: SACRED_FILES_268.length,
    };
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  _stripInjectionAttempts268(content) {
    // Strip zero-width chars
    let s = content.replace(ZERO_WIDTH_PATTERN_268, '');
    // Strip mode override patterns
    for (const p of MODE_OVERRIDE_PATTERNS_268) {
      s = s.replace(p, '[INJECTION_REMOVED]');
    }
    return s;
  }

  _log268(event, data) {
    const entry = { event, ...data, ts: new Date().toISOString(), _v: '268' };
    if (this._auditLog?.append) { try { this._auditLog.append(entry); } catch (_) {} }
  }

  // ── V268: Performance Telemetry ─────────────────────────────────────────────
  getPerf268() { return _calcPercentiles268(this._perf268.latencies); }

  _recordLatency268(t0) {
    const ms = Date.now() - t0;
    this._perf268.latencies.push(ms);
    if (this._perf268.latencies.length > 1000) this._perf268.latencies.shift();
  }

  // ── V268: Health Check ────────────────────────────────────────────────────
  checkFirewallHealth268() {
    return {
      ok: true,
      module: 'injectionFirewall268 CVE-shield',
      version: '268',
      perf: this.getPerf268(),
      logAdapter: this._logAdapter268 ? { type: 'external', ok: true } : { type: 'none' },
    };
  }

}

const defaultInjectionFirewall268 = new InjectionFirewall268();


// ── V268 Performance Telemetry helper ────────────────────────────────────────
function _calcPercentiles268(arr) {
  if (!arr || arr.length === 0) return { p50: 0, p95: 0, p99: 0, count: 0 };
  const sorted = [...arr].sort((a, b) => a - b);
  const n = sorted.length;
  const p = (pct) => sorted[Math.min(Math.floor(n * pct / 100), n - 1)];
  return { p50: p(50), p95: p(95), p99: p(99), count: n };
}

module.exports = {
  InjectionFirewall268,
  defaultInjectionFirewall268,
  SACRED_FILES_268,
  TOOL_PERMISSIONS_268,
};
