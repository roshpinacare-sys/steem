/**
 * ECOS System Interlock — v3.3
 * ----------------------------
 * Replaces the v3.2 process-local boolean (IS_FROZEN) with a Postgres-backed
 * system_state table + LISTEN/NOTIFY so the freeze signal survives multi-worker
 * deployments and process restarts.
 *
 * Architecture:
 *   - freeze state is authoritative in `system_state` (Postgres row)
 *   - each worker subscribes via pg LISTEN 'system_interlock' on startup
 *   - local IS_FROZEN cache is updated immediately on NOTIFY receipt
 *   - checkInterlock() is synchronous (reads cache); DB is ground truth
 *
 * Known limitation (Stage 2):
 *   LISTEN/NOTIFY is not replicated across async Postgres replicas.
 *   Multi-region failover requires etcd leader election or consensus protocol.
 *   See PRAGMATIC_ROADMAP.md §Stage 2 for the upgrade path.
 *
 * Input Arithmetic Gate (IAG):
 *   Enforces strict payload size ceiling and taskType whitelist.
 *   This is a defence-in-depth layer; auth/rate-limiting is owned by
 *   the host monorepo's middleware chain.
 *
 * [FIX-V26-VOID] logger injection:
 *   setLogger(log) — injectable pino logger from ecos-api-server.js.
 *   All 9 console.warn/error calls replaced with this._log equivalents.
 *   console.error('[interlock] !!! SYSTEM INTERLOCK TRIGGERED !!!')
 *   is intentionally kept as SECONDARY output for TTY visibility during a
 *   live collapse — pino is the primary record, console is the alarm bell.
 *   Fallback: console.warn/error (backward-compat when no logger injected).
 *   Call from server:
 *     const { setLogger } = require('./middleware/voidInterlock');
 *     setLogger(logger.child({ component: 'interlock' }));
 */

'use strict';

const crypto = require('node:crypto');
const { getPool } = require('../db/pool');

// ---------------------------------------------------------------------------
// Local cache — updated by NOTIFY listener; ground truth is Postgres
// ---------------------------------------------------------------------------
let IS_FROZEN = false;
let _listenerClient = null;   // dedicated connection for LISTEN

// ---------------------------------------------------------------------------
// [FIX-V26-VOID] Injectable logger — fallback to console for callers that
// don't inject (tests, CLI scripts, ecos-cli.js).
// ---------------------------------------------------------------------------
let _log = {
  warn:  (obj, msg) => console.warn('[interlock]', msg || obj, typeof obj === 'object' ? JSON.stringify(obj) : ''),   // eslint-disable-line no-console
  error: (obj, msg) => console.error('[interlock]', msg || obj, typeof obj === 'object' ? JSON.stringify(obj) : ''),  // eslint-disable-line no-console
  info:  (obj, msg) => console.info('[interlock]', msg || obj, typeof obj === 'object' ? JSON.stringify(obj) : ''),   // eslint-disable-line no-console
};

/**
 * Inject a pino logger (or any { warn, error, info } compatible object).
 * Call once at server startup, before bootstrapInterlock().
 *
 * @param {{ warn: Function, error: Function, info: Function }} log
 */
function setLogger(log) {
  if (log && typeof log.warn === 'function' && typeof log.error === 'function') {
    _log = log;
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const CHANNEL        = 'system_interlock';
const ADMISSIBLE_TAGS = ['summarise', 'extraction', 'ledger_split', 'default'];
const MAX_PAYLOAD_BYTES = 256 * 1024; // 256 KB

// ---------------------------------------------------------------------------
// Bootstrap: read initial state from DB and attach LISTEN channel.
// Call once at server startup (non-fatal if DB is unavailable yet).
// ---------------------------------------------------------------------------
async function bootstrapInterlock() {
  const pool = getPool();

  // 1. Read current freeze state from persistent table
  try {
    const { rows } = await pool.query(
      `SELECT value FROM system_state WHERE key = 'interlock_frozen' LIMIT 1`
    );
    if (rows.length > 0 && rows[0].value === 'true') {
      IS_FROZEN = true;
      // [FIX-V26-VOID] was: console.warn('[interlock] System is FROZEN (loaded from DB)')
      _log.warn({ component: 'interlock', frozen: true }, 'System is FROZEN (loaded from DB)');
    }
  } catch (err) {
    // [FIX-V26-VOID] was: console.warn('[interlock] Could not read system_state ...', err.message)
    _log.warn({ component: 'interlock', err: err.message }, 'Could not read system_state (DB may not be ready)');
  }

  // 2. Subscribe to NOTIFY events so any worker's triggerCollapse propagates here
  try {
    _listenerClient = await pool.connect();
    await _listenerClient.query(`LISTEN ${CHANNEL}`);
    _listenerClient.on('notification', (msg) => {
      if (msg.channel === CHANNEL) {
        try {
          const payload = JSON.parse(msg.payload || '{}');
          if (payload.frozen === true) {
            IS_FROZEN = true;
            // [FIX-V26-VOID] was: console.error('[interlock] NOTIFY received — system is now FROZEN')
            _log.error({ component: 'interlock', frozen: true, reason: payload.reason }, 'NOTIFY received — system is now FROZEN');
          }
        } catch (_) {
          IS_FROZEN = true; // fail closed
        }
      }
    });
    _listenerClient.on('error', (err) => {
      // [FIX-V26-VOID] was: console.error('[interlock] Listener connection error:', err.message)
      _log.error({ component: 'interlock', err: err.message }, 'Listener connection error');
      // Reconnection is handled by pool; cache stays as-is (fail-safe)
    });
  } catch (err) {
    // [FIX-V26-VOID] was: console.warn('[interlock] Could not establish LISTEN channel:', err.message)
    _log.warn({ component: 'interlock', err: err.message }, 'Could not establish LISTEN channel');
  }
}

// ---------------------------------------------------------------------------
// checkInterlock — synchronous, reads local cache
// ---------------------------------------------------------------------------
function checkInterlock() {
  return IS_FROZEN;
}

// ---------------------------------------------------------------------------
// triggerCollapse — writes freeze to Postgres, broadcasts NOTIFY,
//                   then writes TERMINAL_COLLAPSE audit entry
// ---------------------------------------------------------------------------
async function triggerCollapse(errorType, details = {}) {
  if (IS_FROZEN) return;   // already frozen — idempotent

  IS_FROZEN = true;

  const witnessVector = {
    epoch:          Date.now(),
    fractureType:   errorType,
    lineageAnchor:  details.lineageAnchor || null,
    checksum:       crypto.createHash('sha256').update(JSON.stringify(details)).digest('hex'),
  };

  // [FIX-V26-VOID] was: console.error('\n[interlock] !!! SYSTEM INTERLOCK TRIGGERED !!!')
  //                      console.error(`[interlock] Reason: ${errorType}`)
  // Primary record via structured logger; secondary alarm via console for TTY visibility.
  _log.error({ component: 'interlock', errorType, witnessVector }, 'SYSTEM INTERLOCK TRIGGERED');
  // eslint-disable-next-line no-console
  console.error('\n[interlock] !!! SYSTEM INTERLOCK TRIGGERED !!!');
  // eslint-disable-next-line no-console
  console.error(`[interlock] Reason: ${errorType}`);

  const pool = getPool();

  // 1. Persist freeze state so restarted workers start frozen
  try {
    await pool.query(
      `INSERT INTO system_state (key, value, updated_at)
         VALUES ('interlock_frozen', 'true', now())
       ON CONFLICT (key) DO UPDATE
         SET value = 'true', updated_at = now()`
    );
  } catch (err) {
    // [FIX-V26-VOID] was: console.error('[interlock] Failed to persist freeze state:', err.message)
    _log.error({ component: 'interlock', err: err.message }, 'Failed to persist freeze state');
  }

  // 2. Broadcast to all workers via NOTIFY
  try {
    await pool.query(
      `SELECT pg_notify($1, $2)`,
      [CHANNEL, JSON.stringify({ frozen: true, reason: errorType, epoch: witnessVector.epoch })]
    );
  } catch (err) {
    // [FIX-V26-VOID] was: console.error('[interlock] Failed to broadcast NOTIFY:', err.message)
    _log.error({ component: 'interlock', err: err.message }, 'Failed to broadcast NOTIFY');
  }

  // 3. Write TERMINAL_COLLAPSE into the cryptographic audit chain
  try {
    const { appendAudit } = require('../db/auditRepo');
    await appendAudit('TERMINAL_COLLAPSE', witnessVector);
  } catch (err) {
    // Ultimate fallback: direct INSERT to preserve the witness even if auditRepo is broken
    try {
      await pool.query(
        `INSERT INTO audit_log (type, payload, prev_hash, hash, domain)
         VALUES ($1, $2::jsonb, $3, $4, 'system')
         ON CONFLICT DO NOTHING`,
        [
          'TERMINAL_COLLAPSE',
          JSON.stringify(witnessVector),
          '0'.repeat(64),
          witnessVector.checksum,
        ]
      );
    } catch (_) { /* nothing left to do */ }
    // [FIX-V26-VOID] was: console.error('[interlock] Audit chain write failed (raw fallback used):', err.message)
    _log.error({ component: 'interlock', err: err.message }, 'Audit chain write failed (raw fallback used)');
  }
}

// ---------------------------------------------------------------------------
// Input Arithmetic Gate (IAG)
// ---------------------------------------------------------------------------
function enforceInputGate(body) {
  const rawBody = JSON.stringify(body);
  const byteLen = Buffer.byteLength(rawBody);
  if (byteLen > MAX_PAYLOAD_BYTES) {
    return `Payload (${byteLen} bytes) exceeds 256 KB limit`;
  }
  const taskType = body.taskType || 'default';
  if (!ADMISSIBLE_TAGS.includes(taskType)) {
    return `taskType '${taskType}' is not in the allowed list: ${ADMISSIBLE_TAGS.join(', ')}`;
  }
  return null; // admitted
}

module.exports = {
  setLogger,
  bootstrapInterlock,
  checkInterlock,
  triggerCollapse,
  enforceInputGate,
  MAX_PAYLOAD_BYTES,
};
