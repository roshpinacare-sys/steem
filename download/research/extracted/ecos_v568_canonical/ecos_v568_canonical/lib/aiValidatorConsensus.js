'use strict';

/**
 * aiValidatorConsensus.js — ECOS V132
 * =====================================
 * Multi-provider AI Validator Consensus Engine.
 *
 * Orchestrates inference across N providers, computes majority-vote consensus,
 * and records the result to the audit chain + MMR via inferenceChainLogger.
 *
 * Algorithm:
 *   1. Fan-out: run the same task against each registered provider.
 *   2. Normalise: hash each output → deterministic "vote fingerprint".
 *   3. Tally:    majority vote (≥ ⌈N/2⌉ + 1) wins; ties → highest confidence.
 *   4. Chain:    record consensus entry via inferenceChainLogger.
 *   5. Return:   { consensusId, winner, votes, confidence, chainHash,
 *                  mmrLeafIndex, dissent, quorum }
 *
 * Design constraints:
 *   - Sacred files (fiatLedger.js, auditLog.js) — NOT modified.
 *   - No new npm dependencies — node:crypto + vendor/nanoid.
 *   - Providers can be real (EcosOfflineAdapter) or stub (injected for tests).
 *   - Non-fatal: if a provider throws, it is recorded as ABSTAIN.
 *
 * [V132-AVC-01]
 */

const crypto = require('node:crypto');
const { nanoid } = require('../vendor/nanoid');

// ── helpers ───────────────────────────────────────────────────────────────────

function sha256Hex(input) {
  return crypto.createHash('sha256').update(String(input)).digest('hex');
}

/**
 * Normalise an AI output to a canonical "vote fingerprint":
 *   - Trim whitespace, lowercase, collapse internal spaces.
 *   - sha256 of the canonical string → 64-char hex.
 * This lets two providers that return "Yes." vs "yes" count as the same vote.
 */
function voteFingerprint(output) {
  if (output === null || output === undefined) return sha256Hex('__null__');
  const canonical = String(output).trim().toLowerCase().replace(/\s+/g, ' ');
  return sha256Hex(canonical);
}

/**
 * Simple majority-vote tallying.
 *   votes: Array<{ fingerprint, confidence, output, provider }>
 *   Returns the winning fingerprint (highest count; tie-break by avg confidence).
 */
function tallyVotes(votes) {
  /** @type {Map<string, { count:number, totalConf:number, outputs:string[], providers:string[] }>} */
  const tally = new Map();

  for (const v of votes) {
    if (!tally.has(v.fingerprint)) {
      tally.set(v.fingerprint, { count: 0, totalConf: 0, outputs: [], providers: [] });
    }
    const entry = tally.get(v.fingerprint);
    entry.count++;
    entry.totalConf += (v.confidence ?? 0);
    entry.outputs.push(v.output);
    entry.providers.push(v.provider);
  }

  // Sort by count desc, then by avgConf desc as tie-break
  const sorted = [...tally.entries()].sort(([, a], [, b]) => {
    if (b.count !== a.count) return b.count - a.count;
    const avgA = a.totalConf / a.count;
    const avgB = b.totalConf / b.count;
    return avgB - avgA;
  });

  const [winnerFp, winnerData] = sorted[0];
  const avgConfidence = winnerData.count > 0
    ? Math.round((winnerData.totalConf / winnerData.count) * 10000) / 10000
    : null;

  const quorum = votes.length > 0 ? winnerData.count / votes.length : 0;

  return {
    fingerprint: winnerFp,
    count:       winnerData.count,
    outputs:     winnerData.outputs,
    providers:   winnerData.providers,
    avgConfidence,
    quorum: Math.round(quorum * 10000) / 10000,
  };
}

// ── AiValidatorConsensus ──────────────────────────────────────────────────────

class AiValidatorConsensus {
  constructor() {
    /**
     * Registered providers: Array<{ id:string, infer: fn }>
     * Each infer(prompt, opts) must return Promise<{ output, confidence, latencyMs }>.
     */
    this._providers = [];

    /** consensusId → consensus record */
    this._byId = new Map();

    /** taskId → consensusId[] */
    this._byTask = new Map();

    /** Injected deps */
    this._inferenceChainLogger = null;
    this._auditLog             = null;
    this._mmr                  = null;
  }

  // ── Dependency Injection ──────────────────────────────────────────────────

  /**
   * Inject server-level singletons.
   * @param {{ inferenceChainLogger, auditLog, mmr }} deps
   */
  setDeps({ inferenceChainLogger, auditLog = null, mmr = null }) {
    this._inferenceChainLogger = inferenceChainLogger;
    this._auditLog             = auditLog;
    this._mmr                  = mmr;
  }

  // ── Provider Registry ─────────────────────────────────────────────────────

  /**
   * Register an inference provider.
   * @param {{ id:string, infer: function(prompt:string, opts?:object): Promise<{output, confidence, latencyMs}> }} provider
   */
  registerProvider(provider) {
    if (!provider || typeof provider.id !== 'string' || typeof provider.infer !== 'function') {
      throw new TypeError('Provider must have { id: string, infer: function }');
    }
    // Prevent duplicates
    if (this._providers.some(p => p.id === provider.id)) {
      throw new Error(`Provider "${provider.id}" is already registered`);
    }
    this._providers.push(provider);
  }

  /**
   * Remove a registered provider by id (useful for tests / dynamic reconfiguration).
   */
  deregisterProvider(id) {
    const before = this._providers.length;
    this._providers = this._providers.filter(p => p.id !== id);
    return this._providers.length < before; // true if removed
  }

  /** List registered provider ids. */
  listProviders() {
    return this._providers.map(p => p.id);
  }

  // ── Core Consensus ────────────────────────────────────────────────────────

  /**
   * Run multi-provider consensus on a prompt.
   *
   * @param {object} opts
   * @param {string}   opts.prompt        — The task/question to run
   * @param {string}   [opts.taskId]      — Source task ID (for indexing)
   * @param {string}   [opts.clientId]    — For audit indexing
   * @param {string[]} [opts.providerIds] — Subset of providers to use (default: all)
   * @param {object}   [opts.metadata]    — Extra context passed to providers
   *
   * @returns {{
   *   consensusId:  string,
   *   winner:       { output: string, fingerprint: string, count: number, providers: string[], avgConfidence: number },
   *   votes:        Array<{ provider:string, output:string, confidence:number, latencyMs:number, fingerprint:string, status:'ok'|'abstain' }>,
   *   quorum:       number,
   *   dissent:      boolean,
   *   chainHash:    string,
   *   mmrLeafIndex: number,
   *   inferenceId:  string,
   *   timestamp:    string,
   * }}
   */
  async run({ prompt, taskId = null, clientId = null, providerIds = null, metadata = {} }) {
    if (!prompt || typeof prompt !== 'string') {
      throw new TypeError('prompt must be a non-empty string');
    }

    const activeProviders = providerIds
      ? this._providers.filter(p => providerIds.includes(p.id))
      : [...this._providers];

    if (activeProviders.length === 0) {
      throw new Error('No providers available for consensus. Register at least one provider.');
    }

    const consensusId = `cns::${nanoid()}`;
    const promptHash  = sha256Hex(prompt);
    const timestamp   = new Date().toISOString();

    // ── 1. Fan-out inference across all providers ──────────────────────────
    const rawVotes = await Promise.all(
      activeProviders.map(async (provider) => {
        const start = Date.now();
        try {
          const result = await provider.infer(prompt, { taskId, clientId, ...metadata });
          const output = result.output ?? result.aiOutput ?? String(result);
          const conf   = typeof result.confidence === 'number' ? result.confidence : null;
          return {
            provider:    provider.id,
            output,
            confidence:  conf,
            latencyMs:   Date.now() - start,
            fingerprint: voteFingerprint(output),
            status:      'ok',
          };
        } catch (err) {
          return {
            provider:    provider.id,
            output:      null,
            confidence:  null,
            latencyMs:   Date.now() - start,
            fingerprint: voteFingerprint(null),
            status:      'abstain',
            error:       err.message,
          };
        }
      })
    );

    // ── 2. Separate valid votes from abstentions ───────────────────────────
    const validVotes = rawVotes.filter(v => v.status === 'ok');

    if (validVotes.length === 0) {
      throw new Error('All providers abstained — cannot reach consensus');
    }

    // ── 3. Tally majority vote ────────────────────────────────────────────
    const tally  = tallyVotes(validVotes);
    const dissent = new Set(validVotes.map(v => v.fingerprint)).size > 1;

    // The canonical "winner" output: use the first output from winning providers
    const winnerOutput = tally.outputs[0];

    // ── 4. Record to chain via inferenceChainLogger ────────────────────────
    let chainHash    = null;
    let mmrLeafIndex = null;
    let inferenceId  = null;

    if (this._inferenceChainLogger) {
      const chainEntry = this._inferenceChainLogger.log({
        provider:   `consensus::${tally.providers.join('+')}`,
        taskId:     taskId || consensusId,
        inputHash:  promptHash,
        output:     winnerOutput,
        confidence: tally.avgConfidence,
        latencyMs:  Math.max(...rawVotes.map(v => v.latencyMs)),
        metadata:   {
          consensusId,
          quorum:        tally.quorum,
          providerCount: activeProviders.length,
          validVotes:    validVotes.length,
          dissent,
          ...metadata,
        },
        clientId,
      });
      chainHash    = chainEntry.chainHash;
      mmrLeafIndex = chainEntry.mmrLeafIndex;
      inferenceId  = chainEntry.inferenceId;
    }

    // ── 5. Build and store result ──────────────────────────────────────────
    const result = {
      consensusId,
      winner: {
        output:        winnerOutput,
        fingerprint:   tally.fingerprint,
        count:         tally.count,
        providers:     tally.providers,
        avgConfidence: tally.avgConfidence,
      },
      votes:       rawVotes,
      quorum:      tally.quorum,
      dissent,
      chainHash,
      mmrLeafIndex,
      inferenceId,
      timestamp,
    };

    this._byId.set(consensusId, result);

    if (taskId) {
      if (!this._byTask.has(taskId)) this._byTask.set(taskId, []);
      this._byTask.get(taskId).push(consensusId);
    }

    return result;
  }

  // ── Retrieval ─────────────────────────────────────────────────────────────

  /** Retrieve a consensus record by its ID. */
  getById(consensusId) {
    return this._byId.get(consensusId) ?? null;
  }

  /** All consensus records for a given taskId. */
  getByTask(taskId) {
    const ids = this._byTask.get(taskId) ?? [];
    return ids.map(id => this._byId.get(id)).filter(Boolean);
  }

  /** System-wide statistics. */
  stats() {
    const all = [...this._byId.values()];
    const totalRuns  = all.length;
    const totalVotes = all.reduce((s, r) => s + r.votes.length, 0);
    const dissentRuns = all.filter(r => r.dissent).length;

    const confs = all
      .map(r => r.winner.avgConfidence)
      .filter(c => c !== null);
    const avgConfidence = confs.length > 0
      ? Math.round((confs.reduce((a, b) => a + b, 0) / confs.length) * 10000) / 10000
      : null;

    const avgQuorum = all.length > 0
      ? Math.round((all.reduce((s, r) => s + r.quorum, 0) / all.length) * 10000) / 10000
      : null;

    const providerUsage = {};
    for (const run of all) {
      for (const v of run.votes) {
        providerUsage[v.provider] = (providerUsage[v.provider] ?? 0) + 1;
      }
    }

    return {
      totalRuns,
      totalVotes,
      dissentRuns,
      avgConfidence,
      avgQuorum,
      providerUsage,
      registeredProviders: this.listProviders(),
    };
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

const defaultAiValidatorConsensus = new AiValidatorConsensus();

module.exports = { AiValidatorConsensus, defaultAiValidatorConsensus, voteFingerprint, tallyVotes };
