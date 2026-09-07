'use strict';
  /**
   * lib/autoHealPolicy378.js — ECOS V378 (Phase P266)
   *
   * DIRECTION 4: Auto-heal policy gate.
   *
   * `enforceAutoHealPolicy378(ctx, opts)` limits how often the V376 self-
   * healing quarantine-clear can fire within a rolling window — mirroring
   * the V368 break-glass quota pattern to prevent runaway self-clearing if
   * the cross-chain verifier is persistently inconsistent.
   *
   * Exports:
   *   AUTO_HEAL_POLICY_VERSION_378        — '378.0.0'
   *   AUTO_HEAL_POLICY_SCHEMA_378         — schema tag
   *   AUTO_HEAL_POLICY_BLOCKED_TYPE_378   — audit event type (blocked)
   *   AUTO_HEAL_POLICY_CLEARED_TYPE_378   — audit event type (allowed)
   *   DEFAULT_AUTO_HEAL_WINDOW_MS_378     — 5 minutes
   *   DEFAULT_AUTO_HEAL_QUOTA_378         — max 3 clears per window
   *   createAutoHealPolicyRepo378(opts)   — ephemeral or file-backed window store
   *   enforceAutoHealPolicy378(ctx, opts) — quota-gated auto-heal gate
   *
   * Endpoint: POST /api/v1/integrity/auto-heal/policy [V378-T04]
   *
   * Pure (R3 — no new npm deps; node fs/path). All new identifiers end with
   * 378 (R2). Sacred untouched (R1). V361..V377 preserved (R6).
   *
   * @version 378.0.0
   */

  const fs   = require('fs');
  const path = require('path');

  const AUTO_HEAL_POLICY_VERSION_378      = '378.0.0';
  const AUTO_HEAL_POLICY_SCHEMA_378       = 'ecos.integrity.cross_chain.auto_heal.policy/v378';
  const AUTO_HEAL_POLICY_BLOCKED_TYPE_378 = 'integrity.cross_chain_auto_heal_policy_blocked378';
  const AUTO_HEAL_POLICY_CLEARED_TYPE_378 = 'integrity.cross_chain_auto_heal_policy_allowed378';
  const DEFAULT_AUTO_HEAL_WINDOW_MS_378   = 5 * 60 * 1000;  // 5 minutes
  const DEFAULT_AUTO_HEAL_QUOTA_378       = 3;               // max 3 auto-heals per window

  const DEFAULT_POLICY_REPO_FILE_378 = 'data/autoHealPolicy378.json';

  // ── file helpers ──────────────────────────────────────────────────────────────

  function _atomicWrite378(filePath, payload) {
    const dir = path.dirname(filePath);
    try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
    const tmp = filePath + '.tmp.' + process.pid + '.' + Date.now();
    fs.writeFileSync(tmp, JSON.stringify(payload), 'utf8');
    fs.renameSync(tmp, filePath);
  }

  function _safeRead378(filePath) {
    try {
      const txt = fs.readFileSync(filePath, 'utf8');
      const obj = JSON.parse(txt);
      if (obj && typeof obj === 'object') return obj;
    } catch (_) {}
    return { schema: AUTO_HEAL_POLICY_SCHEMA_378, events: [] };
  }

  // ── createAutoHealPolicyRepo378 ───────────────────────────────────────────────

  /**
   * Create a lightweight rolling-window policy repo for the auto-heal gate.
   *
   * @param {{ filePath?: string, ephemeral?: boolean }} [opts]
   * @returns {{ schema, lastRunAt, recordHeal, eventsInWindow, ephemeral, filePath, _reset }}
   */
  function createAutoHealPolicyRepo378(opts) {
    const o        = opts || {};
    const ephemeral = !!o.ephemeral;
    const filePath  = ephemeral
      ? null
      : path.resolve(
          o.filePath ||
          process.env.ECOS_AUTO_HEAL_POLICY_FILE_378 ||
          DEFAULT_POLICY_REPO_FILE_378
        );

    let events = [];
    if (filePath) {
      const persisted = _safeRead378(filePath);
      if (Array.isArray(persisted.events)) events = persisted.events;
    }

    function _flush() {
      if (!filePath) return;
      _atomicWrite378(filePath, {
        schema:    AUTO_HEAL_POLICY_SCHEMA_378,
        events,
        updatedAt: new Date().toISOString(),
      });
    }

    return {
      schema:    AUTO_HEAL_POLICY_SCHEMA_378,
      ephemeral,
      filePath,

      /** Returns ISO timestamp of most recent heal event, or null. */
      lastRunAt() {
        return events.length > 0 ? events[events.length - 1] : null;
      },

      /** Returns count of heal events within the rolling window. */
      eventsInWindow(windowMs, now) {
        const cutoff = (typeof now === 'number' ? now : Date.now()) - windowMs;
        return events.filter(ts => new Date(ts).getTime() > cutoff).length;
      },

      /** Record a new heal event timestamp. */
      recordHeal(ts) {
        events.push(typeof ts === 'string' ? ts : new Date().toISOString());
        _flush();
      },

      _reset() {
        events = [];
        if (filePath) {
          try { fs.unlinkSync(filePath); } catch (_) {}
        }
      },
    };
  }

  // ── enforceAutoHealPolicy378 ──────────────────────────────────────────────────

  /**
   * Quota-gated auto-heal gate. Allows at most `opts.quota` auto-heal events
   * per rolling `opts.windowMs`. Blocked calls emit
   * AUTO_HEAL_POLICY_BLOCKED_TYPE_378 to the audit log and return
   * `{ blocked: true }`. Allowed calls return `{ blocked: false, allowed: true }`
   * and record the event in the policy repo.
   *
   * @param {{ auditLog?: object }} ctx
   * @param {{
   *   policyRepo?: object,    — result of createAutoHealPolicyRepo378()
   *   windowMs?: number,      — rolling window (default 5 min)
   *   quota?: number,         — max heals per window (default 3)
   *   now?: number,           — override for testing
   * }} [opts]
   * @returns {{
   *   ok: boolean,
   *   blocked: boolean,
   *   allowed: boolean,
   *   eventsInWindow: number,
   *   quota: number,
   *   windowMs: number,
   *   nextEligibleAt: string|null,
   *   version: string,
   * }}
   */
  function enforceAutoHealPolicy378(ctx, opts) {
    const c = ctx || {};
    const o = opts || {};

    const now      = (typeof o.now === 'number') ? o.now : Date.now();
    const windowMs = (typeof o.windowMs === 'number' && o.windowMs >= 0)
      ? o.windowMs
      : (Number(process.env.ECOS_AUTO_HEAL_WINDOW_MS_378) || DEFAULT_AUTO_HEAL_WINDOW_MS_378);
    const quota    = (typeof o.quota === 'number' && o.quota >= 0)
      ? o.quota
      : DEFAULT_AUTO_HEAL_QUOTA_378;

    const policyRepo = o.policyRepo || null;
    const auditLog   = c.auditLog   || null;

    const baseSummary = {
      schema:    AUTO_HEAL_POLICY_SCHEMA_378,
      version:   AUTO_HEAL_POLICY_VERSION_378,
      windowMs,
      quota,
    };

    // Count events in window
    const eventsInWindow = policyRepo
      ? policyRepo.eventsInWindow(windowMs, now)
      : 0;

    if (eventsInWindow >= quota) {
      // Blocked — compute next eligible
      let nextEligibleAt = null;
      if (policyRepo) {
        const lastRun = policyRepo.lastRunAt();
        if (lastRun) {
          nextEligibleAt = new Date(new Date(lastRun).getTime() + windowMs).toISOString();
        }
      }

      const blocked = {
        ...baseSummary,
        ok:             true,
        blocked:        true,
        allowed:        false,
        eventsInWindow,
        nextEligibleAt,
      };

      if (auditLog && typeof auditLog.append === 'function') {
        auditLog.append(AUTO_HEAL_POLICY_BLOCKED_TYPE_378, {
          ...blocked,
          ts: new Date(now).toISOString(),
        });
      }

      return blocked;
    }

    // Allowed — record the event
    const ts = new Date(now).toISOString();
    if (policyRepo) {
      policyRepo.recordHeal(ts);
    }

    const allowed = {
      ...baseSummary,
      ok:             true,
      blocked:        false,
      allowed:        true,
      eventsInWindow: eventsInWindow + 1,
      nextEligibleAt: null,
      ts,
    };

    if (auditLog && typeof auditLog.append === 'function') {
      auditLog.append(AUTO_HEAL_POLICY_CLEARED_TYPE_378, allowed);
    }

    return allowed;
  }

  module.exports = {
    AUTO_HEAL_POLICY_VERSION_378,
    AUTO_HEAL_POLICY_SCHEMA_378,
    AUTO_HEAL_POLICY_BLOCKED_TYPE_378,
    AUTO_HEAL_POLICY_CLEARED_TYPE_378,
    DEFAULT_AUTO_HEAL_WINDOW_MS_378,
    DEFAULT_AUTO_HEAL_QUOTA_378,
    createAutoHealPolicyRepo378,
    enforceAutoHealPolicy378,
  };
  