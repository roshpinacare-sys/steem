/**
 * lib/taskExpiryEngine210.js — ECOS V210
 * Task Expiry & Auto-Return: escrows auto-return after TTL if no proof submitted.
 * Also handles ZK-style blind proof commitments (sha256 commit-then-reveal).
 * Research: Kleros arbitration timeouts; commit-reveal prevents front-running.
 */
'use strict';

const crypto = require('crypto');

const DEFAULT_TTL_MS_210       = 7 * 24 * 60 * 60 * 1000;  // 7 days
const MIN_TTL_MS_210           = 60 * 60 * 1000;            // 1 hour minimum
const MAX_TTL_MS_210           = 90 * 24 * 60 * 60 * 1000; // 90 days maximum
const MAX_EXPIRY_ENTRIES_210   = 50_000;
const REVEAL_WINDOW_MS_210     = 48 * 60 * 60 * 1000;       // 48h to reveal after commit
const MAX_PROOF_COMMITS_210    = 100_000;

class ExpiryError210 extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'ExpiryError210';
    this.code = code || 'EXPIRY_ERROR_210';
    this.statusCode = 400;
  }
}

// _taskExpiry210: taskId → { taskId, ttlMs, expiresAt, status, createdAt, returnedAt }
const _taskExpiry210   = new Map();
// _proofCommits210: commitId → { commitId, taskId, commitHash, committerid, status, committedAt, revealedAt, plaintext }
const _proofCommits210 = new Map();
let _commitCounter210  = 0;

/**
 * setTaskExpiry210 — register TTL for a task's escrow auto-return.
 */
function setTaskExpiry210(params) {
  if (!params || typeof params !== 'object') throw new ExpiryError210('params required');
  const { taskId, ttlMs, requesterId } = params;

  if (!taskId) throw new ExpiryError210('taskId required');
  if (_taskExpiry210.has(taskId)) throw new ExpiryError210(`Expiry for task ${taskId} already set`, 'EXPIRY_EXISTS_210');
  if (_taskExpiry210.size >= MAX_EXPIRY_ENTRIES_210) throw new ExpiryError210('Expiry store full');

  const ttl = typeof ttlMs === 'number' ? ttlMs : DEFAULT_TTL_MS_210;
  if (ttl < MIN_TTL_MS_210) throw new ExpiryError210(`TTL too short (min ${MIN_TTL_MS_210}ms)`, 'TTL_TOO_SHORT_210');
  if (ttl > MAX_TTL_MS_210) throw new ExpiryError210(`TTL too long (max ${MAX_TTL_MS_210}ms)`, 'TTL_TOO_LONG_210');

  const entry = {
    taskId,
    ttlMs:       ttl,
    requesterId: requesterId || null,
    expiresAt:   new Date(Date.now() + ttl).toISOString(),
    status:      'active',      // active | expired | proof_submitted | returned
    createdAt:   new Date().toISOString(),
    returnedAt:  null,
  };
  _taskExpiry210.set(taskId, entry);
  return { ok: true, entry: { ...entry } };
}

/**
 * getTaskExpiry210 — get expiry status for a task.
 */
function getTaskExpiry210(taskId) {
  if (!taskId) throw new ExpiryError210('taskId required');
  const entry = _taskExpiry210.get(taskId);
  if (!entry) {
    const e = new ExpiryError210(`Expiry for task ${taskId} not found`, 'EXPIRY_NOT_FOUND_210');
    e.statusCode = 404; throw e;
  }
  // Lazy expiry check
  if (entry.status === 'active' && new Date(entry.expiresAt).getTime() < Date.now()) {
    entry.status     = 'expired';
    entry.returnedAt = new Date().toISOString();
  }
  const remainingMs = Math.max(0, new Date(entry.expiresAt).getTime() - Date.now());
  return { ok: true, entry: { ...entry }, remainingMs, expired: entry.status === 'expired' };
}

/**
 * markProofSubmitted210 — prevent expiry when proof is submitted.
 */
function markProofSubmitted210(taskId) {
  if (!taskId) throw new ExpiryError210('taskId required');
  const entry = _taskExpiry210.get(taskId);
  if (!entry) {
    const e = new ExpiryError210(`Expiry for ${taskId} not found`, 'EXPIRY_NOT_FOUND_210');
    e.statusCode = 404; throw e;
  }
  if (entry.status === 'expired') throw new ExpiryError210('Task already expired — escrow returned', 'ALREADY_EXPIRED_210');
  entry.status = 'proof_submitted';
  return { ok: true, entry: { ...entry } };
}

// ─── ZK-style Commit-Reveal ───────────────────────────────────────────────────

/**
 * commitProof210 — submit a hash commitment (sha256 of proof + salt).
 * @param {object} params
 * @param {string} params.taskId
 * @param {string} params.commitHash — sha256(plaintext + salt) hex string
 * @param {string} params.committerId
 */
function commitProof210(params) {
  if (!params || typeof params !== 'object') throw new ExpiryError210('params required');
  const { taskId, commitHash, committerId } = params;

  if (!taskId)      throw new ExpiryError210('taskId required');
  if (!commitHash)  throw new ExpiryError210('commitHash required');
  if (!committerId) throw new ExpiryError210('committerId required');
  if (!/^[0-9a-f]{64}$/i.test(commitHash)) throw new ExpiryError210('commitHash must be a 64-char hex sha256', 'INVALID_COMMIT_HASH_210');
  if (_proofCommits210.size >= MAX_PROOF_COMMITS_210) throw new ExpiryError210('Commit store full');

  const commitId = `commit-${++_commitCounter210}-${Date.now()}`;
  const commit = {
    commitId,
    taskId,
    commitHash:  commitHash.toLowerCase(),
    committerId,
    status:      'committed',   // committed | revealed | invalid | expired
    committedAt: new Date().toISOString(),
    revealDeadline: new Date(Date.now() + REVEAL_WINDOW_MS_210).toISOString(),
    revealedAt:  null,
    plaintext:   null,
    salt:        null,
    valid:       null,
  };
  _proofCommits210.set(commitId, commit);
  return { ok: true, commit: { ...commit } };
}

/**
 * revealProof210 — reveal the plaintext + salt; verify against commit hash.
 * @param {string} commitId
 * @param {string} plaintext
 * @param {string} salt
 */
function revealProof210(commitId, plaintext, salt) {
  if (!commitId)  throw new ExpiryError210('commitId required');
  if (!plaintext) throw new ExpiryError210('plaintext required');
  if (!salt)      throw new ExpiryError210('salt required');

  const commit = _proofCommits210.get(commitId);
  if (!commit) {
    const e = new ExpiryError210(`Commit ${commitId} not found`, 'COMMIT_NOT_FOUND_210');
    e.statusCode = 404; throw e;
  }
  if (commit.status !== 'committed') throw new ExpiryError210(`Commit is ${commit.status}`);
  if (new Date(commit.revealDeadline).getTime() < Date.now()) {
    commit.status = 'expired';
    throw new ExpiryError210('Reveal window expired', 'REVEAL_EXPIRED_210');
  }

  const expectedHash = crypto.createHash('sha256').update(plaintext + salt).digest('hex');
  const valid = expectedHash === commit.commitHash;

  commit.status     = 'revealed';
  commit.revealedAt = new Date().toISOString();
  commit.plaintext  = plaintext;
  commit.salt       = salt;
  commit.valid      = valid;

  return { ok: true, commit: { ...commit }, valid, expectedHash, providedHash: commit.commitHash };
}

/**
 * getProofCommit210 — get a proof commitment by ID.
 */
function getProofCommit210(commitId) {
  if (!commitId) throw new ExpiryError210('commitId required');
  const commit = _proofCommits210.get(commitId);
  if (!commit) {
    const e = new ExpiryError210(`Commit ${commitId} not found`, 'COMMIT_NOT_FOUND_210');
    e.statusCode = 404; throw e;
  }
  // Lazy expiry check
  if (commit.status === 'committed' && new Date(commit.revealDeadline).getTime() < Date.now()) {
    commit.status = 'expired';
  }
  return { ...commit };
}

module.exports = {
  setTaskExpiry210,
  getTaskExpiry210,
  markProofSubmitted210,
  commitProof210,
  revealProof210,
  getProofCommit210,
  ExpiryError210,
  DEFAULT_TTL_MS_210,
  MIN_TTL_MS_210,
  MAX_TTL_MS_210,
  REVEAL_WINDOW_MS_210,
  _taskExpiry210,
  _proofCommits210,
};
