/**
 * Audit Log — append-only, hash-chained log for all pipeline actions.
 * Each entry includes the SHA-256 of the previous entry, making tampering
 * detectable. Persists to a NDJSON file and optionally ships to Axiom.
 */
import { createHash } from 'crypto';
import { appendFileSync, closeSync, existsSync, fstatSync, openSync, readSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { log as logger } from './logger.js';

const AUDIT_FILE = '.audit-log.ndjson';

export interface AuditEntry {
  seq: number;
  timestamp: string;
  event: string;
  actor: string;
  payload: Record<string, unknown>;
  prevHash: string;
  hash: string;
}

function hashEntry(entry: Omit<AuditEntry, 'hash'>): string {
  return createHash('sha256')
    .update(JSON.stringify(entry))
    .digest('hex');
}

/**
 * Longest tail slice read to find the last entry. A single NDJSON audit
 * entry is well under 4 KB; 64 KB gives generous headroom while keeping
 * appends O(1) — the previous implementation re-read the ENTIRE log on
 * every append, making an N-entry run cost O(N²) total file I/O.
 */
const TAIL_READ_BYTES = 64 * 1024;

function readTail(filePath: string): string {
  const fd = openSync(filePath, 'r');
  try {
    const size = fstatSync(fd).size;
    const start = Math.max(0, size - TAIL_READ_BYTES);
    const buf = Buffer.alloc(size - start);
    readSync(fd, buf, 0, buf.length, start);
    return buf.toString('utf8');
  } finally {
    closeSync(fd);
  }
}

function getLastEntry(filePath: string): AuditEntry | null {
  if (!existsSync(filePath)) return null;
  const lines = readTail(filePath).trim().split('\n').filter(Boolean);
  if (lines.length === 0) return null;
  try {
    return JSON.parse(lines[lines.length - 1]) as AuditEntry;
  } catch {
    // Last line is corrupt (e.g. partial write on abrupt termination).
    // Treat as missing so the chain can continue from the last valid entry.
    logger.warn('Audit log: last line is malformed JSON; starting fresh chain entry', { filePath });
    return null;
  }
}

/**
 * Genesis hash for a chain's first entry. Defaults to all-zeros (a run with
 * no relay ancestry). A relay hop that continues an earlier hop's lineage
 * passes the PARENT hop's receipt sha256 here instead, so this hop's chain
 * cryptographically binds to the artifact it was handed — see
 * `lineage` in services/receipt.ts and docs/RECEIPTS.md § "Lineage across
 * relay hops". This is additive: omitting the argument reproduces the exact
 * prior behavior byte-for-byte.
 */
export function defaultGenesis(): string {
  return '0'.repeat(64);
}

export function appendAuditEntry(
  workspaceRoot: string,
  event: string,
  actor: string,
  payload: Record<string, unknown>,
  genesis: string = defaultGenesis(),
): AuditEntry {
  const filePath = resolve(workspaceRoot, AUDIT_FILE);
  const last = getLastEntry(filePath);
  const seq = last ? last.seq + 1 : 0;
  const prevHash = last ? last.hash : genesis;

  const partial: Omit<AuditEntry, 'hash'> = {
    seq,
    timestamp: new Date().toISOString(),
    event,
    actor,
    payload,
    prevHash,
  };
  const hash = hashEntry(partial);
  const entry: AuditEntry = { ...partial, hash };

  appendFileSync(filePath, JSON.stringify(entry) + '\n');
  logger.info('Audit entry appended', { seq, event, actor });
  return entry;
}

export function verifyAuditChain(
  workspaceRoot: string,
  genesis: string = defaultGenesis(),
): {
  valid: boolean;
  brokenAt?: number;
} {
  const filePath = resolve(workspaceRoot, AUDIT_FILE);
  if (!existsSync(filePath)) return { valid: true };

  const lines = readFileSync(filePath, 'utf8').trim().split('\n').filter(Boolean);
  let prevHash = genesis;

  for (let i = 0; i < lines.length; i++) {
    const entry: AuditEntry = JSON.parse(lines[i]);
    if (entry.prevHash !== prevHash) {
      logger.error('Audit chain broken: prevHash mismatch', { seq: entry.seq });
      return { valid: false, brokenAt: entry.seq };
    }
    const { hash: _h, ...partial } = entry;
    const expected = hashEntry(partial);
    if (expected !== entry.hash) {
      logger.error('Audit chain broken: hash mismatch', { seq: entry.seq });
      return { valid: false, brokenAt: entry.seq };
    }
    prevHash = entry.hash;
  }

  logger.info('Audit chain verified OK', { entries: lines.length });
  return { valid: true };
}
