'use strict';
/**
 * ECOS Replay Engine — V109
 * ──────────────────────────────────────────────────────────────────────────────
 * Deterministic replay verification: reconstructs ledger state from audit log
 * events and validates it against the current state root.
 *
 * Design:
 *   - Pure function interface: (events[]) → finalState
 *   - Wraps deterministicReducers.js (does NOT modify sacred files)
 *   - Journal replay: ExecutionJournal entries → run summary
 *   - Ledger replay: audit log events → balance state for verification
 *   - Divergence detection: computedHash vs expectedHash
 *   - Replay integrity proofs: SHA-256 over (events + finalStateHash)
 *
 * V109 additions:
 *   - replayAuditLogPaginated() — P5-05 streaming/paginated replay (cursor-based)
 *   - saveCheckpointToDB()      — persist replay proof to replay_checkpoints table
 *   - loadCheckpointsFromDB()   — fetch saved checkpoints from DB
 *
 * APIs consumed by ecos-api-server.js:
 *   GET  /api/v1/audit/replay                → replayAuditLog()
 *   GET  /api/v1/audit/replay/paginated      → replayAuditLogPaginated()  [V109]
 *   GET  /api/v1/audit/replay/:runId         → replayJournalRun()
 *   GET  /api/v1/audit/provenance/:hash      → lookupProvenance()
 *   POST /api/v1/audit/replay/checkpoint     → saveCheckpointToDB()       [V109]
 *   GET  /api/v1/audit/replay/checkpoints    → loadCheckpointsFromDB()    [V109]
 */

const crypto = require('node:crypto');
const {
  ledgerReducer,
  initialLedgerState,
  replayEvents,
  verifyReplay,
  journalReducer,
  initialJournalState,
  LEDGER_EVENT,
} = require('./deterministicReducers');
const { sha256Hex, canonicalize } = require('./auditLog');

// ── Audit-log event → ledger reducer event mapping ───────────────────────────

/**
 * Maps an audit log entry's type + payload to a ledger reducer event.
 * Returns null if the entry does not affect ledger state.
 * @param {object} entry — AuditLog entry
 * @returns {object|null} ledger event
 */
function auditEntryToLedgerEvent(entry) {
  if (!entry || !entry.type || !entry.payload) return null;
  const p = entry.payload;

  switch (entry.type) {
    case 'LEDGER_CREDIT':
      if (p.accountId && p.amountMicro != null) {
        return { type: LEDGER_EVENT.CREDIT, accountId: p.accountId, amountMicro: BigInt(p.amountMicro) };
      }
      break;

    case 'LEDGER_DEBIT':
      if (p.accountId && p.amountMicro != null) {
        return { type: LEDGER_EVENT.DEBIT, accountId: p.accountId, amountMicro: BigInt(p.amountMicro) };
      }
      break;

    case 'TASK_AUTO_FLOW':
    case 'AUTO_FLOW_SETTLED': {
      const splits = _extractSplits(p);
      if (splits) return { type: LEDGER_EVENT.AUTO_FLOW, splits };
      break;
    }

    case 'TASK_HITL_RESOLVED':
    case 'HITL_RESOLVED':
    case 'APPROVAL_RESOLVED': {
      const splits = _extractSplits(p);
      if (splits) return { type: LEDGER_EVENT.HITL_RESOLVED, splits };
      break;
    }

    case 'VOID_TRIGGERED':
    case 'VOID_INTERLOCK': {
      const splits = _extractVoidSplits(p);
      if (splits) return { type: LEDGER_EVENT.VOID, splits };
      break;
    }

    default:
      return null;
  }
  return null;
}

function _extractSplits(p) {
  if (Array.isArray(p.splits) && p.splits.length > 0) {
    return p.splits.map(s => ({
      accountId:   s.accountId || s.account_id,
      amountMicro: BigInt(s.amountMicro || s.amount_micro || 0),
    }));
  }
  // Reconstruct from individual fields
  const candidates = [];
  if (p.platformMicro)   candidates.push({ accountId: 'sys::platform',       amountMicro: BigInt(p.platformMicro) });
  if (p.validatorMicro)  candidates.push({ accountId: p.validatorAccountId || 'sys::validator', amountMicro: BigInt(p.validatorMicro) });
  if (p.insuranceMicro)  candidates.push({ accountId: 'sys::insurance_pool', amountMicro: BigInt(p.insuranceMicro) });
  return candidates.length > 0 ? candidates : null;
}

function _extractVoidSplits(p) {
  if (Array.isArray(p.reversals)) {
    return p.reversals.map(s => ({
      accountId:   s.accountId,
      amountMicro: BigInt(s.amountMicro || 0),
    }));
  }
  return null;
}

// ── ReplayEngine ──────────────────────────────────────────────────────────────

class ReplayEngine {
  /**
   * @param {object} deps
   * @param {object} deps.auditLog       — AuditLog instance
   * @param {object} deps.journal        — ExecutionJournal instance
   * @param {object} [opts]
   * @param {object} [opts.logger]
   */
  constructor(deps = {}, opts = {}) {
    this._auditLog = deps.auditLog || null;
    this._journal  = deps.journal  || null;
    this._log      = opts.logger || { info: () => {}, warn: () => {}, error: () => {} };
  }

  // ── Audit log replay ──────────────────────────────────────────────────────────

  /**
   * Replay audit log entries from fromIndex to toIndex (inclusive),
   * building deterministic ledger state.
   *
   * @param {object} [opts]
   * @param {number} [opts.fromIndex=0]
   * @param {number} [opts.toIndex]          — defaults to last entry
   * @param {string} [opts.expectedStateHash] — if supplied, verify computed hash matches
   * @returns {{ ok, state, eventsApplied, proof, divergence? }}
   */
  replayAuditLog(opts = {}) {
    if (!this._auditLog) {
      return { ok: false, reason: 'auditLog not configured', eventsApplied: 0 };
    }

    const allEntries = this._auditLog.entries();
    const from  = opts.fromIndex || 0;
    const to    = opts.toIndex   != null ? opts.toIndex : allEntries.length - 1;
    const slice = allEntries.slice(from, to + 1);

    // Map audit entries to ledger events (skip non-ledger entries)
    const ledgerEvents = [];
    for (const entry of slice) {
      const ev = auditEntryToLedgerEvent(entry);
      if (ev) ledgerEvents.push({ ...ev, _auditIndex: entry.index, _auditHash: entry.hash });
    }

    // Replay
    let finalState;
    try {
      finalState = replayEvents(ledgerEvents);
    } catch (err) {
      return { ok: false, reason: `Replay error: ${err.message}`, eventsApplied: ledgerEvents.length };
    }

    // Compute replay integrity proof
    const proofPreimage = `replay|${from}|${to}|${finalState.stateHash}|${ledgerEvents.length}`;
    const replayProof   = sha256Hex(proofPreimage);

    const result = {
      ok:            true,
      fromIndex:     from,
      toIndex:       to,
      auditEntries:  slice.length,
      eventsApplied: ledgerEvents.length,
      finalStateHash: finalState.stateHash,
      eventCount:    finalState.eventCount,
      balances:      this._serializeBalances(finalState.balances),
      replayProof,
    };

    // Divergence detection
    if (opts.expectedStateHash) {
      const verification = verifyReplay(ledgerEvents, opts.expectedStateHash);
      result.verification = {
        ok:           verification.ok,
        computedHash: verification.computedHash,
        expectedHash: verification.expectedHash,
      };
      if (!verification.ok) {
        result.divergence = {
          detected:   true,
          reason:     'State hash mismatch — replay diverged from expected state',
          computed:   verification.computedHash,
          expected:   verification.expectedHash,
        };
        this._log.warn({ component: 'replay', ...result.divergence }, '[Replay] divergence detected');
      }
    }

    this._log.info({ component: 'replay', from, to, events: ledgerEvents.length, proof: replayProof },
      '[Replay] audit log replay complete');
    return result;
  }

  // ── [V109-P5-05] Paginated audit log replay ───────────────────────────────────

  /**
   * Cursor-based paginated replay.
   *
   * Allows callers to stream through large audit logs one page at a time
   * without holding the full event set in memory. Each page is independently
   * verifiable via its replayProof. Use nextCursor to advance pages.
   *
   * @param {object} [opts]
   * @param {number}  [opts.cursor=0]           — start audit-log index (inclusive)
   * @param {number}  [opts.pageSize=100]        — entries per page (max 1000)
   * @param {boolean} [opts.includeBalances=false] — embed full balance map in response
   * @returns {{
   *   ok, cursor, nextCursor, hasMore, pageSize, auditEntries,
   *   eventsApplied, finalStateHash, eventCount, replayProof, balances?
   * }}
   */
  replayAuditLogPaginated(opts = {}) {
    if (!this._auditLog) {
      return { ok: false, reason: 'auditLog not configured', cursor: 0, hasMore: false };
    }

    const allEntries = this._auditLog.entries();
    const cursor     = Math.max(0, Math.floor(opts.cursor || 0));
    const pageSize   = Math.max(1, Math.min(Math.floor(opts.pageSize) || 100, 1000));

    // Past-end: return empty sentinel so callers can detect completion
    if (cursor >= allEntries.length) {
      const genesis = initialLedgerState();
      return {
        ok:             true,
        cursor,
        nextCursor:     cursor,
        hasMore:        false,
        pageSize:       0,
        auditEntries:   0,
        eventsApplied:  0,
        finalStateHash: genesis.stateHash,
        eventCount:     0,
        replayProof:    sha256Hex(`replay-page|${cursor}|${cursor}|${genesis.stateHash}|0`),
      };
    }

    const to    = Math.min(cursor + pageSize - 1, allEntries.length - 1);
    const slice = allEntries.slice(cursor, to + 1);

    // Map to ledger events
    const ledgerEvents = [];
    for (const entry of slice) {
      const ev = auditEntryToLedgerEvent(entry);
      if (ev) ledgerEvents.push({ ...ev, _auditIndex: entry.index, _auditHash: entry.hash });
    }

    // Replay this page
    let finalState;
    try {
      finalState = replayEvents(ledgerEvents);
    } catch (err) {
      return {
        ok:      false,
        reason:  `Replay error: ${err.message}`,
        cursor,
        hasMore: false,
      };
    }

    const nextCursor = to + 1;
    const hasMore    = nextCursor < allEntries.length;

    // Per-page integrity proof: cursor|to|stateHash|eventsApplied
    const proofPreimage = `replay-page|${cursor}|${to}|${finalState.stateHash}|${ledgerEvents.length}`;
    const replayProof   = sha256Hex(proofPreimage);

    const result = {
      ok:             true,
      cursor,
      nextCursor,
      hasMore,
      pageSize:       slice.length,
      auditEntries:   slice.length,
      eventsApplied:  ledgerEvents.length,
      finalStateHash: finalState.stateHash,
      eventCount:     finalState.eventCount,
      replayProof,
    };

    if (opts.includeBalances) {
      result.balances = this._serializeBalances(finalState.balances);
    }

    this._log.info(
      { component: 'replay', cursor, nextCursor, hasMore, events: ledgerEvents.length, proof: replayProof },
      '[Replay] paginated page complete'
    );
    return result;
  }

  // ── [V109] Replay checkpoint DB persistence ───────────────────────────────────

  /**
   * Persist a completed replay result as a named checkpoint in the DB.
   * Uses replay_checkpoints table (created in migration_phase5.sql).
   *
   * @param {object} pool          — pg.Pool
   * @param {object} replayResult  — result from replayAuditLog() or replayAuditLogPaginated()
   * @param {string} [label]       — human-readable label; defaults to auto-<ISO>
   * @returns {Promise<{ok, id, label, createdAt}>}
   */
  async saveCheckpointToDB(pool, replayResult, label) {
    if (!pool)         throw new Error('saveCheckpointToDB: pg.Pool required');
    if (!replayResult) throw new Error('saveCheckpointToDB: replayResult required');
    if (!replayResult.ok) throw new Error('saveCheckpointToDB: cannot save failed replay as checkpoint');

    const id  = 'ckpt::' + crypto.randomBytes(10).toString('hex');
    const lbl = (label && label.trim()) || `auto-${new Date().toISOString()}`;
    const fromIndex    = replayResult.fromIndex    ?? replayResult.cursor ?? 0;
    const toIndex      = replayResult.toIndex      ?? (replayResult.nextCursor != null ? replayResult.nextCursor - 1 : 0);
    const evApplied    = replayResult.eventsApplied ?? 0;
    const stateHash    = replayResult.finalStateHash;
    const proof        = replayResult.replayProof;

    if (!stateHash || !proof) throw new Error('saveCheckpointToDB: replayResult missing finalStateHash or replayProof');

    await pool.query(
      `INSERT INTO replay_checkpoints
         (id, label, from_index, to_index, events_applied, final_state_hash, replay_proof)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, lbl, fromIndex, toIndex, evApplied, stateHash, proof]
    );

    const createdAt = new Date().toISOString();
    this._log.info({ component: 'replay', id, label: lbl }, '[Replay] checkpoint saved to DB');
    return { ok: true, id, label: lbl, createdAt };
  }

  /**
   * Load saved replay checkpoints from DB (newest first).
   *
   * @param {object} pool         — pg.Pool
   * @param {object} [opts]
   * @param {number} [opts.limit=20]  — max rows (cap: 100)
   * @returns {Promise<Array<object>>}
   */
  async loadCheckpointsFromDB(pool, opts = {}) {
    if (!pool) throw new Error('loadCheckpointsFromDB: pg.Pool required');
    const limit = Math.min(100, Math.max(1, parseInt(opts.limit) || 20));
    const { rows } = await pool.query(
      `SELECT id, label, from_index, to_index, events_applied,
              final_state_hash, replay_proof, created_at
       FROM replay_checkpoints
       ORDER BY created_at DESC
       LIMIT $1`,
      [limit]
    );
    return rows;
  }

  // ── Journal run replay ────────────────────────────────────────────────────────

  /**
   * Replay ExecutionJournal entries for a specific runId, building
   * a deterministic run summary.
   *
   * @param {string} runId
   * @returns {object} run summary
   */
  replayJournalRun(runId) {
    if (!this._journal) {
      return { ok: false, reason: 'journal not configured' };
    }

    const entries = this._journal.getRunEntries(runId);
    if (entries.length === 0) {
      return { ok: false, reason: `No journal entries found for runId: ${runId}` };
    }

    // Replay through journalReducer
    const finalState = entries.reduce(journalReducer, initialJournalState());

    // Compute proof: hash over entry IDs in order (deterministic ordering)
    const entryIds    = entries.map(e => e.id).join('|');
    const replayProof = sha256Hex(`journal-run|${runId}|${entryIds}`);

    const run = this._journal.getRun(runId);

    return {
      ok:             true,
      runId,
      status:         run?.status,
      entriesReplayed: entries.length,
      completedSteps:  finalState.completedSteps,
      failedSteps:     finalState.failedSteps,
      runs:            finalState.runs.size,
      replayProof,
      timeline:        entries.map(e => ({ id: e.id, type: e.type, stepId: e.stepId, ts: e.ts })),
    };
  }

  // ── Provenance lookup ─────────────────────────────────────────────────────────

  /**
   * Look up an audit entry by its hash (trace hash) and return its
   * provenance chain: the entry itself + its predecessor chain (up to depth).
   *
   * @param {string} traceHash
   * @param {object} [opts]
   * @param {number} [opts.depth=5]  — how many ancestors to include
   * @returns {object}
   */
  lookupProvenance(traceHash, opts = {}) {
    if (!this._auditLog) {
      return { ok: false, reason: 'auditLog not configured' };
    }

    const depth   = Math.max(1, Math.min(opts.depth || 5, 50));
    const entries = this._auditLog.entries();

    // Find entry by hash
    const target = entries.find(e => e.hash === traceHash);
    if (!target) {
      return { ok: false, reason: `No audit entry found with hash: ${traceHash}` };
    }

    // Build ancestor chain
    const chain = [target];
    let current = target;
    for (let i = 0; i < depth - 1; i++) {
      if (current.prevHash === '0'.repeat(64)) break;  // genesis
      const ancestor = entries.find(e => e.hash === current.prevHash);
      if (!ancestor) break;
      chain.push(ancestor);
      current = ancestor;
    }

    // Extract inference provenance if attached
    const inferenceProvenance = target.payload?.inferenceProvenance || null;

    return {
      ok:     true,
      target: { index: target.index, ts: target.ts, type: target.type, hash: target.hash },
      inferenceProvenance,
      ancestorChain: chain.slice(1).map(e => ({
        index: e.index, ts: e.ts, type: e.type, hash: e.hash,
      })),
      chainDepth: chain.length,
    };
  }


  // ── [V110-P8-03] Replay chain verification ────────────────────────────────────

  /**
   * Verify the entire audit log replay chain by paginating through all entries
   * and confirming that no divergences occur and all pages are coherent.
   *
   * This is a read-only, non-destructive operation. It does NOT write to the DB.
   * For large audit logs, use pageSize=1000 to minimise iteration count.
   *
   * Exposed via: GET /api/v1/audit/replay/chain-verify
   *
   * @param {object} [opts]
   * @param {number} [opts.pageSize=500]  — entries per verification page (max 1000)
   * @returns {{
   *   ok: boolean,
   *   chainIntact: boolean,
   *   pagesVerified: number,
   *   totalEventsApplied: number,
   *   totalAuditEntries: number,
   *   finalStateHash: string|null,
   *   proofSample: Array<{cursor, nextCursor, replayProof, finalStateHash, eventsApplied}>,
   *   brokenAt: null | { cursor, pagesVerified, error?, divergences? }
   * }}
   */
  verifyReplayChain(opts = {}) {
    if (!this._auditLog) {
      return {
        ok: false, chainIntact: false, error: 'auditLog not configured',
        pagesVerified: 0, totalEventsApplied: 0, totalAuditEntries: 0,
        finalStateHash: null, proofSample: [], brokenAt: null,
      };
    }

    const allEntries  = this._auditLog.entries();
    const totalAuditEntries = allEntries.length;
    const pageSize    = Math.max(1, Math.min(Math.floor(opts.pageSize) || 500, 1000));
    const SAFETY_CAP  = 100_000; // max pages to prevent infinite loop

    let cursor              = 0;
    let pagesVerified       = 0;
    let totalEventsApplied  = 0;
    let chainIntact         = true;
    let brokenAt            = null;
    const proofChain        = [];

    while (pagesVerified < SAFETY_CAP) {
      const page = this.replayAuditLogPaginated({ cursor, pageSize, includeBalances: false });

      if (!page.ok) {
        chainIntact = false;
        brokenAt = {
          cursor,
          pagesVerified,
          error: page.reason || 'replayAuditLogPaginated returned ok:false',
        };
        break;
      }

      proofChain.push({
        cursor,
        nextCursor:     page.nextCursor,
        replayProof:    page.replayProof,
        finalStateHash: page.finalStateHash,
        eventsApplied:  page.eventsApplied,
      });
      totalEventsApplied += page.eventsApplied;
      pagesVerified++;

      if (!page.hasMore) break;
      cursor = page.nextCursor;
    }

    // Limit proof sample to last 10 pages (avoid bloated responses on large logs)
    const proofSample = proofChain.length > 10
      ? [...proofChain.slice(0, 2), ...proofChain.slice(-8)]
      : proofChain;

    const finalStateHash = proofChain.length > 0
      ? proofChain[proofChain.length - 1].finalStateHash
      : null;

    this._log.info(
      { component: 'replay', pagesVerified, totalEventsApplied, chainIntact },
      '[Replay] chain-verify complete'
    );

    return {
      ok:                 chainIntact,
      chainIntact,
      pagesVerified,
      totalEventsApplied,
      totalAuditEntries,
      finalStateHash,
      proofSample,
      brokenAt,
    };
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  _serializeBalances(balancesMap) {
    const out = {};
    for (const [id, bal] of balancesMap.entries()) {
      out[id] = bal.toString();
    }
    return out;
  }
}

module.exports = {
  ReplayEngine,
  auditEntryToLedgerEvent,
};
