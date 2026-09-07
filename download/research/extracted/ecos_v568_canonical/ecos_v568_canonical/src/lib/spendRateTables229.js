// ============================================================
// src/lib/spendRateTables229.js — Token-Accurate Spend Rate Tables (P123-A)
// V229. Provides per-provider token cost tables and an accurate
// spend estimator for use by agentLoop227 (and future loops).
//
// Rate tables are loaded from config/pricing_providers229.json
// at first use; a built-in fallback covers the common providers
// if the config file is absent.
//
// Iron rules:
//   R1: Sacred files untouched.
//   R2: All new identifiers end in _229.
//   R3: Zero new npm deps — Node built-ins only.
// ============================================================
'use strict';

const path = require('path');
const fs   = require('fs');

// ── Built-in fallback rate tables ──────────────────────────────────────────
// Units: micro-cents per token (μ¢/tok)  [ 1 USD = 1,000,000 μ¢ ]
// Anthropic claude-sonnet-4 (claude-sonnet-4-20250514) pricing:
//   Input  $3.00 / 1M tok → 0.03 μ¢/tok
//   Output $15.00 / 1M tok → 0.15 μ¢/tok
// Anthropic claude-haiku-4-5 pricing:
//   Input  $0.80 / 1M tok → 0.008 μ¢/tok
//   Output $4.00 / 1M tok → 0.04 μ¢/tok
// OpenAI gpt-4o (May 2024) pricing:
//   Input  $5.00 / 1M tok → 0.05 μ¢/tok
//   Output $15.00 / 1M tok → 0.15 μ¢/tok
// OpenAI gpt-4o-mini pricing:
//   Input  $0.15 / 1M tok → 0.0015 μ¢/tok
//   Output $0.60 / 1M tok → 0.006 μ¢/tok

const _BUILTIN_RATES_229 = {
  // Anthropic
  'claude-sonnet-4-20250514':  { inputMicroPerTok: 0.03,   outputMicroPerTok: 0.15   },
  'claude-opus-4-20250514':    { inputMicroPerTok: 0.15,   outputMicroPerTok: 0.75   },
  'claude-haiku-4-5-20251001': { inputMicroPerTok: 0.008,  outputMicroPerTok: 0.04   },
  // OpenAI
  'gpt-4o':                    { inputMicroPerTok: 0.05,   outputMicroPerTok: 0.15   },
  'gpt-4o-mini':               { inputMicroPerTok: 0.0015, outputMicroPerTok: 0.006  },
  'gpt-4-turbo':               { inputMicroPerTok: 0.10,   outputMicroPerTok: 0.30   },
  // Generic fallback (matches agentLoop227 base estimate of 1¢/call ≈ rough average)
  '_default_229':              { inputMicroPerTok: 0.03,   outputMicroPerTok: 0.15   },
};

// ── Config file loader (lazy, cached) ──────────────────────────────────────
let _rateCache_229 = null;

function _loadRates_229() {
  if (_rateCache_229) return _rateCache_229;
  const cfgPath = path.resolve(__dirname, '../../config/pricing_providers229.json');
  try {
    const raw = fs.readFileSync(cfgPath, 'utf8');
    const parsed = JSON.parse(raw);
    // Merge: config overrides built-ins, built-ins fill gaps
    _rateCache_229 = Object.assign({}, _BUILTIN_RATES_229, parsed);
  } catch (_) {
    _rateCache_229 = Object.assign({}, _BUILTIN_RATES_229);
  }
  return _rateCache_229;
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * getRateTable_229(model) → { inputMicroPerTok, outputMicroPerTok }
 * Returns the rate table for a given model string.
 * Falls back to '_default_229' if model is unrecognised.
 */
function getRateTable_229(model) {
  const rates = _loadRates_229();
  return rates[String(model || '')] || rates['_default_229'];
}

/**
 * estimateSpend_229(usage, provider) → BigInt (μ¢)
 *
 * usage    — object with inputTokens and optionally outputTokens
 * provider — string model/provider identifier (e.g. 'claude-sonnet-4-20250514')
 *
 * Returns a BigInt of micro-cents for the call so it can be added
 * directly to agentLoop227's BigInt spend ledger.
 */
function estimateSpend_229(usage, provider) {
  if (!usage || typeof usage.inputTokens !== 'number') {
    // No token data — return 0n so caller can fall back to its own estimate
    return 0n;
  }
  const rate = getRateTable_229(provider);
  const inMicro  = BigInt(Math.ceil(usage.inputTokens  * rate.inputMicroPerTok));
  const outMicro = BigInt(Math.ceil((usage.outputTokens || 0) * rate.outputMicroPerTok));
  return inMicro + outMicro;
}

/**
 * listProviders_229() → string[]
 * Returns all known provider/model keys in the rate table.
 */
function listProviders_229() {
  return Object.keys(_loadRates_229()).filter(k => k !== '_default_229');
}

/**
 * reloadRates_229() — clears cache so config is re-read on next call.
 * Useful in tests.
 */
function reloadRates_229() {
  _rateCache_229 = null;
}

module.exports = {
  estimateSpend_229,
  getRateTable_229,
  listProviders_229,
  reloadRates_229,
  _BUILTIN_RATES_229,
};
