'use strict';
/**
 * ECOS Agent Identity — V102 (P2)
 * --------------------------------
 * Provides a stable UUID for this agent instance that persists across restarts.
 * On first boot the UUID is generated (crypto.randomUUID) and written to a
 * local file (.agent-identity.json).  Subsequent boots load from that file.
 *
 * DB-backed persistence: if a Postgres pool is available the identity is also
 * stored / retrieved from the `agent_identity` table (created by migration in
 * db/schema.sql). The file is the primary fallback for offline / test mode.
 *
 * Public API:
 *   getAgentId()   → string  (UUID, always available synchronously after init)
 *   init(pool?)    → Promise<string>  (call once at server startup)
 *   IDENTITY_FILE  → path to the local file
 */

const fs      = require('node:fs');
const path    = require('node:path');
const crypto  = require('node:crypto');

const IDENTITY_FILE = path.resolve(__dirname, '..', '.agent-identity.json');

let _agentId = null;

/**
 * Read from .agent-identity.json if it exists and contains a valid UUID.
 * @returns {string|null}
 */
function _loadFromFile() {
  try {
    if (!fs.existsSync(IDENTITY_FILE)) return null;
    const raw = fs.readFileSync(IDENTITY_FILE, 'utf8');
    const { agentId } = JSON.parse(raw);
    if (agentId && /^[0-9a-f-]{36}$/.test(agentId)) return agentId;
  } catch (_) { /* ignore parse errors */ }
  return null;
}

/**
 * Write the identity to .agent-identity.json (atomic write via tmp file).
 */
function _saveToFile(agentId) {
  const tmp = IDENTITY_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ agentId, createdAt: new Date().toISOString() }, null, 2), 'utf8');
  fs.renameSync(tmp, IDENTITY_FILE);
}

/**
 * Attempt to load from DB; if not present, insert.
 * Table: agent_identity(agent_id TEXT PRIMARY KEY, created_at TIMESTAMPTZ)
 * If table doesn't exist yet, silently fall back.
 * @param {object} pool — pg Pool
 * @param {string} agentId
 * @returns {Promise<string>}  the canonical agentId from DB
 */
async function _syncWithDb(pool, agentId) {
  try {
    // Upsert: insert if not exists, return existing if already set
    const res = await pool.query(
      `INSERT INTO agent_identity (agent_id, created_at)
       VALUES ($1, NOW())
       ON CONFLICT DO NOTHING
       RETURNING agent_id`,
      [agentId]
    );
    if (res.rows.length > 0) return res.rows[0].agent_id; // freshly inserted

    // Already existed — load it (might differ if another node registered first)
    const existing = await pool.query('SELECT agent_id FROM agent_identity LIMIT 1');
    if (existing.rows.length > 0) return existing.rows[0].agent_id;
  } catch (err) {
    // Table might not exist yet — non-fatal, file fallback is authoritative
    if (process.env.NODE_ENV !== 'test') {
      // eslint-disable-next-line no-console
      console.warn(`[agentIdentity] DB sync skipped: ${err.message}`);
    }
  }
  return agentId;
}

/**
 * Initialize agent identity.
 * Priority: file → DB → generate new UUID.
 * @param {object|null} [pool]  pg Pool (optional)
 * @returns {Promise<string>}   stable agent UUID
 */
async function init(pool) {
  if (_agentId) return _agentId; // already initialized

  // 1. Try to load from file
  let agentId = _loadFromFile();

  // 2. Generate if not found
  if (!agentId) {
    agentId = crypto.randomUUID();
    _saveToFile(agentId);
  }

  // 3. Sync with DB if available (may return a different ID in multi-node setups)
  if (pool) {
    agentId = await _syncWithDb(pool, agentId);
    // Keep local file in sync with DB canonical ID
    const fileId = _loadFromFile();
    if (fileId !== agentId) _saveToFile(agentId);
  }

  _agentId = agentId;
  return _agentId;
}

/**
 * Return the agent ID synchronously.
 * Throws if init() has not been called yet.
 * @returns {string}
 */
function getAgentId() {
  if (!_agentId) throw new Error('[agentIdentity] getAgentId() called before init()');
  return _agentId;
}

/** For testing only — reset internal state */
function _reset() { _agentId = null; }

module.exports = { init, getAgentId, IDENTITY_FILE, _reset };
