#!/usr/bin/env node
/**
 * ECOS Audit Chain Verifier
 * -------------------------
 * External CLI that independently re-derives every SHA-256 hash in the
 * audit_log and verifies the append-only chain, requiring only a direct
 * Postgres connection (no application server).
 *
 * This is the "working external verification client" referenced in the
 * technical review. Run it from any machine with DB access:
 *
 *   DATABASE_URL=postgres://user:pass@host/db node scripts/verify-chain.mjs
 *   DATABASE_URL=... node scripts/verify-chain.mjs --deltas      # delta-only
 *   DATABASE_URL=... node scripts/verify-chain.mjs --from 100    # start at seq 100
 *
 * Exit codes:
 *   0  — chain intact
 *   1  — chain broken (details printed to stderr)
 *   2  — usage / connection error
 *
 * KNOWN LIMITATIONS (honest):
 *   - Linear SHA-256 chain only — no Merkle inclusion/consistency proofs.
 *     Upgrade path: RFC 6962 / Google Trillian (see PRAGMATIC_ROADMAP.md).
 *   - Advisory lock (AUDIT_LOCK_KEY) is single-node; multi-region requires
 *     Viewstamped Replication or etcd consensus.
 *   - This verifier cannot detect a split view by an operator who controls
 *     the DB and can rewrite history + rehash. External witness cosignatures
 *     (Sigstore-style) are the remedy.
 */

import { createHash } from 'node:crypto';
import { argv, env, exit, stderr, stdout } from 'node:process';

// ── Minimal Postgres client (uses pg from devDependencies or pg in PATH) ──
let pg;
try {
  const mod = await import('pg');
  pg = mod.default ?? mod;
} catch {
  stderr.write(
    'ERROR: pg package not found. Run: npm install --save-dev pg\n'
  );
  exit(2);
}

const DATABASE_URL = env.DATABASE_URL;
if (!DATABASE_URL) {
  stderr.write('ERROR: DATABASE_URL environment variable is required.\n');
  stderr.write('Usage: DATABASE_URL=postgres://... node scripts/verify-chain.mjs [--deltas] [--from N]\n');
  exit(2);
}

// ── Parse CLI args ─────────────────────────────────────────────────────────
const args = argv.slice(2);
const deltasOnly = args.includes('--deltas');
const fromIdx    = args.indexOf('--from');
const fromSeq    = fromIdx >= 0 ? parseInt(args[fromIdx + 1], 10) : 1;

// ── Canonical JSON (must match src/lib/auditLog.js) ───────────────────────
function canonicalize(obj) {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    return JSON.stringify(obj);
  }
  const sorted = Object.keys(obj).sort().reduce((acc, k) => {
    acc[k] = obj[k];
    return acc;
  }, {});
  return JSON.stringify(sorted);
}

function sha256Hex(str) {
  return createHash('sha256').update(str, 'utf8').digest('hex');
}

const NULL_HASH = '0'.repeat(64);

// ── Main ──────────────────────────────────────────────────────────────────
const client = new pg.Client({ connectionString: DATABASE_URL });

try {
  await client.connect();
} catch (err) {
  stderr.write(`ERROR: Cannot connect to Postgres: ${err.message}\n`);
  exit(2);
}

stdout.write(`ECOS Audit Chain Verifier\n`);
stdout.write(`Connected to: ${DATABASE_URL.replace(/:[^:@]*@/, ':***@')}\n`);
stdout.write(`Mode: ${deltasOnly ? 'DELTA_COMMIT entries only' : 'full chain'}, from seq ${fromSeq}\n\n`);

try {
  let query = `
    SELECT seq, ts, type, payload, prev_hash AS "prevHash", hash
    FROM audit_log
    WHERE seq >= $1
  `;
  const params = [fromSeq];

  if (deltasOnly) {
    query += ` AND type = 'DELTA_COMMIT'`;
  }
  query += ' ORDER BY seq ASC';

  const { rows } = await client.query(query, params);

  if (rows.length === 0) {
    stdout.write('No entries found in range. Chain is trivially intact (empty).\n');
    await client.end();
    exit(0);
  }

  stdout.write(`Verifying ${rows.length} entries...\n\n`);

  // For a full scan starting at seq 1, the first prev_hash should be NULL_HASH.
  // For a partial scan (--from N), we trust the chain up to N-1 and verify from there.
  let expectedPrev = NULL_HASH;

  if (fromSeq > 1 && !deltasOnly) {
    // Fetch the hash of seq (fromSeq - 1) so our expectedPrev is correct.
    const prevRes = await client.query(
      'SELECT hash FROM audit_log WHERE seq = $1',
      [fromSeq - 1]
    );
    if (prevRes.rowCount) {
      expectedPrev = prevRes.rows[0].hash;
    }
  }

  let broken = false;
  let checked = 0;
  let deltaCount = 0;
  let deltaWarnings = [];

  for (const row of rows) {
    const seqN = Number(row.seq);
    const indexN = seqN - 1; // 0-based index used in preimage

    // ── 1. Chain continuity check ──────────────────────────────────────
    if (!deltasOnly && row.prevHash !== expectedPrev) {
      stderr.write(
        `BROKEN at seq ${seqN}: prevHash mismatch.\n` +
        `  expected: ${expectedPrev}\n` +
        `  got:      ${row.prevHash}\n`
      );
      broken = true;
      break;
    }

    // ── 2. Hash re-derivation ──────────────────────────────────────────
    const tsIso =
      row.ts instanceof Date
        ? row.ts.toISOString()
        : new Date(row.ts).toISOString();
    const canon    = canonicalize(row.payload);
    const preimage = `${indexN}|${tsIso}|${canon}|${row.prevHash}`;
    const computed = sha256Hex(preimage);

    if (computed !== row.hash) {
      stderr.write(
        `BROKEN at seq ${seqN} (type: ${row.type}): hash mismatch.\n` +
        `  stored:   ${row.hash}\n` +
        `  computed: ${computed}\n`
      );
      broken = true;
      break;
    }

    // ── 3. DELTA_COMMIT specific checks ───────────────────────────────
    if (row.type === 'DELTA_COMMIT') {
      deltaCount++;
      const p = row.payload;

      // Conservation: preStateRoot must differ from postStateRoot for a
      // non-trivial settlement. If they're equal, the mutations had no
      // effect — which means the balance UPDATEs didn't actually run.
      if (p.preStateRoot && p.postStateRoot && p.preStateRoot === p.postStateRoot) {
        deltaWarnings.push(
          `seq ${seqN}: preStateRoot === postStateRoot — mutations may not have been applied.`
        );
      }

      // traceHash must be present
      if (!p.traceHash) {
        deltaWarnings.push(`seq ${seqN}: missing traceHash field in DELTA_COMMIT payload.`);
      }
    }

    expectedPrev = row.hash;
    checked++;

    if (checked % 1000 === 0) {
      stdout.write(`  ... verified ${checked} entries (seq ${seqN})\n`);
    }
  }

  stdout.write(`\n── Results ──────────────────────────────────────────────────────────\n`);

  if (broken) {
    stdout.write(`STATUS: ✗ CHAIN BROKEN\n`);
    stdout.write(`Entries verified before break: ${checked}\n`);
    await client.end();
    exit(1);
  }

  stdout.write(`STATUS: ✓ CHAIN INTACT\n`);
  stdout.write(`Entries verified: ${checked}\n`);
  stdout.write(`DELTA_COMMIT entries found: ${deltaCount}\n`);
  stdout.write(`Chain head hash: ${expectedPrev}\n`);

  if (deltaWarnings.length > 0) {
    stdout.write(`\n── Delta warnings (${deltaWarnings.length}) ──────────────────────────\n`);
    for (const w of deltaWarnings) {
      stdout.write(`  WARN: ${w}\n`);
    }
    stdout.write('\nWARNING: Some DELTA_COMMIT entries show conservation anomalies.\n');
    stdout.write('This may indicate that balance mutations did not execute within\n');
    stdout.write('the same DB transaction as the state-root capture.\n');
  }

  stdout.write(`\n── Known Limitations ────────────────────────────────────────────────\n`);
  stdout.write(`  • Linear SHA-256 chain: retroactive-modification detection only.\n`);
  stdout.write(`    No Merkle inclusion/consistency proofs (RFC 6962 upgrade needed).\n`);
  stdout.write(`  • Single-node advisory lock: not replicated across Postgres replicas.\n`);
  stdout.write(`  • No external witness cosignatures: operator-controlled split views\n`);
  stdout.write(`    cannot be detected by this verifier alone.\n`);
  stdout.write(`  See PRAGMATIC_ROADMAP.md Stage 2 for the Merkle upgrade path.\n`);

} finally {
  await client.end();
}

exit(0);
