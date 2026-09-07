/**
 * lib/withdrawalHistoryService.js — ECOS V154
 * ─────────────────────────────────────────────────────────────────────────────
 * [V154-WH] Persistent withdrawal history.
 *
 * Replaces the sessionStorage-only approach from V152.
 * Now writes to DB (when available) with a file-backed fallback.
 */
'use strict';

const fs   = require('node:fs');
const path = require('node:path');

const HISTORY_FILE = path.resolve(process.cwd(), 'withdrawal_history.ndjson');

// ── File-backed fallback ───────────────────────────────────────────────────────

function _appendFileLine(entry) {
  try {
    fs.appendFileSync(HISTORY_FILE, JSON.stringify(entry) + '\n');
  } catch (e) { /* non-fatal */ }
}

function _readFileHistory(accountId, limit = 30) {
  try {
    if (!fs.existsSync(HISTORY_FILE)) return [];
    const lines = fs.readFileSync(HISTORY_FILE, 'utf8').trim().split('\n').filter(Boolean);
    const all   = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    return all
      .filter(e => !accountId || e.accountId === accountId)
      .sort((a, b) => new Date(b.requestedAt) - new Date(a.requestedAt))
      .slice(0, limit);
  } catch (e) { return []; }
}

// ── DB-backed (Postgres) ───────────────────────────────────────────────────────

async function saveWithdrawal(entry, pool) {
  const row = {
    account_id:   entry.accountId   || 'unknown',
    rail_id:      entry.railId      || 'manual',
    reference:    entry.reference   || `ECOS-W-${Date.now()}`,
    amount_usd:   parseFloat(entry.amountUsd || 0),
    status:       entry.status      || 'pending',
    requested_at: entry.requestedAt || new Date().toISOString(),
    operator_note: entry.note       || null,
  };

  if (pool) {
    try {
      await pool.query(
        `INSERT INTO withdrawal_history (account_id, rail_id, reference, amount_usd, status, requested_at, operator_note)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (reference) DO UPDATE SET status = EXCLUDED.status, updated_at = NOW()`,
        [row.account_id, row.rail_id, row.reference, row.amount_usd, row.status, row.requested_at, row.operator_note]
      );
      return;
    } catch (e) { /* fall through to file */ }
  }
  _appendFileLine(row);
}

async function updateWithdrawalStatus(reference, status, pool) {
  if (pool) {
    try {
      await pool.query(
        "UPDATE withdrawal_history SET status=$1, resolved_at=NOW(), updated_at=NOW() WHERE reference=$2",
        [status, reference]
      );
      return;
    } catch (e) { /* fall through */ }
  }
  // file fallback: rewrite all lines
  try {
    const history = _readFileHistory(null, 1000);
    const updated = history.map(e => e.reference === reference ? { ...e, status, resolvedAt: new Date().toISOString() } : e);
    fs.writeFileSync(HISTORY_FILE, updated.map(e => JSON.stringify(e)).join('\n') + '\n');
  } catch (e) { /* non-fatal */ }
}

async function getWithdrawalHistory(accountId, { limit = 30, pool } = {}) {
  if (pool) {
    try {
      const r = await pool.query(
        "SELECT * FROM withdrawal_history WHERE account_id=$1 ORDER BY requested_at DESC LIMIT $2",
        [accountId, limit]
      );
      return r.rows.map(row => ({
        reference:   row.reference,
        accountId:   row.account_id,
        railId:      row.rail_id,
        amountUsd:   parseFloat(row.amount_usd),
        status:      row.status,
        requestedAt: row.requested_at,
        resolvedAt:  row.resolved_at,
        note:        row.operator_note,
      }));
    } catch (e) { /* fall through */ }
  }
  return _readFileHistory(accountId, limit);
}

module.exports = { saveWithdrawal, updateWithdrawalStatus, getWithdrawalHistory };
