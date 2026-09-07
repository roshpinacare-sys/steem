'use strict';
/**
 * src/lib/filterPresets285.js — ECOS Filter Presets (V285)
 *
 * V285 adds named filter presets and filter groups on top of V284 channel filters:
 *   - registerFilterPreset285(presetName, filterOpts)   — save a named filter preset
 *   - getFilterPreset285(presetName)                    — retrieve a preset
 *   - listFilterPresets285()                            — list all presets
 *   - removeFilterPreset285(presetName)                 — delete a preset
 *   - applyFilterPreset285(channelName, presetName)     — apply a preset to a channel (delegates to v284)
 *   - getStatus285()                                    — runtime status
 *   - checkFilterPresetHealth285()                      — health check
 *   - getPerf285()                                      — latency percentiles (1000-sample ring)
 *
 * Iron rules: zero new npm deps. All identifiers end in 285. Sacred files untouched.
 */

const PRESET_VERSION_285     = '285';
const PRESET_MAX_PRESETS_285 = 200;

const SEVERITY_ORDER_285 = ['low', 'medium', 'high', 'critical'];

class FilterPresets285 {
  /**
   * @param {object} opts
   * @param {object} [opts.logger]
   * @param {object} [opts.logAdapter]
   * @param {object} [opts.channelFilter284]  — optional V284 channel filter engine for delegation
   */
  constructor(opts = {}) {
    this._logger285        = opts.logger           || console;
    this._logAdapter285    = opts.logAdapter        || null;
    this._channelFilter285 = opts.channelFilter284  || null;

    // Preset registry: Map<presetName, filterOpts>
    this._presets285 = new Map();

    // Perf ring buffer (last 1000 latencies in ms)
    this._perfLatencies285 = [];
  }

  // ── Preset Registry ──────────────────────────────────────────────────────────

  /**
   * Register (create or replace) a named filter preset.
   *
   * @param {string} presetName
   * @param {object} filterOpts  — same shape as V284 setChannelFilter284 filterOpts
   * @returns {{ ok, presetName, preset, version }}
   */
  registerFilterPreset285(presetName, filterOpts = {}) {
    const _t0 = Date.now();
    if (!presetName || typeof presetName !== 'string')
      return { ok: false, error: 'presetName must be a non-empty string', version: PRESET_VERSION_285 };
    if (this._presets285.size >= PRESET_MAX_PRESETS_285 && !this._presets285.has(presetName))
      return { ok: false, error: `preset limit (${PRESET_MAX_PRESETS_285}) reached`, version: PRESET_VERSION_285 };

    const validationError = this._validateFilterOpts285(filterOpts);
    if (validationError)
      return { ok: false, error: validationError, version: PRESET_VERSION_285 };

    const preset = {
      presetName,
      categories:        Array.isArray(filterOpts.categories)        ? [...filterOpts.categories]        : null,
      excludeCategories: Array.isArray(filterOpts.excludeCategories) ? [...filterOpts.excludeCategories] : null,
      minSeverity:       typeof filterOpts.minSeverity === 'string'  ? filterOpts.minSeverity            : null,
      maxAlerts:         typeof filterOpts.maxAlerts   === 'number'  ? filterOpts.maxAlerts              : null,
      minAlerts:         typeof filterOpts.minAlerts   === 'number'  ? filterOpts.minAlerts              : null,
      periods:           Array.isArray(filterOpts.periods)           ? [...filterOpts.periods]           : null,
      custom:            filterOpts.custom && typeof filterOpts.custom === 'object'
                           ? { ...filterOpts.custom }
                           : null,
      registeredAt: new Date().toISOString(),
    };

    this._presets285.set(presetName, preset);
    this._recordPerf285(Date.now() - _t0);
    return { ok: true, presetName, preset: { ...preset }, version: PRESET_VERSION_285 };
  }

  /**
   * Get a named filter preset.
   *
   * @param {string} presetName
   * @returns {{ ok, presetName, preset, version }}
   */
  getFilterPreset285(presetName) {
    const _t0 = Date.now();
    if (!presetName || typeof presetName !== 'string')
      return { ok: false, error: 'presetName must be a non-empty string', version: PRESET_VERSION_285 };
    const preset = this._presets285.get(presetName);
    this._recordPerf285(Date.now() - _t0);
    if (!preset)
      return { ok: false, error: `no preset found: '${presetName}'`, version: PRESET_VERSION_285 };
    return { ok: true, presetName, preset: { ...preset }, version: PRESET_VERSION_285 };
  }

  /**
   * List all registered presets.
   *
   * @returns {{ ok, presets, count, version }}
   */
  listFilterPresets285() {
    const _t0 = Date.now();
    const presets = [...this._presets285.values()].map(p => ({ ...p }));
    this._recordPerf285(Date.now() - _t0);
    return { ok: true, presets, count: presets.length, version: PRESET_VERSION_285 };
  }

  /**
   * Remove a named filter preset.
   *
   * @param {string} presetName
   * @returns {{ ok, presetName, version }}
   */
  removeFilterPreset285(presetName) {
    const _t0 = Date.now();
    if (!presetName || typeof presetName !== 'string')
      return { ok: false, error: 'presetName must be a non-empty string', version: PRESET_VERSION_285 };
    if (!this._presets285.has(presetName)) {
      this._recordPerf285(Date.now() - _t0);
      return { ok: false, error: `no preset found: '${presetName}'`, version: PRESET_VERSION_285 };
    }
    this._presets285.delete(presetName);
    this._recordPerf285(Date.now() - _t0);
    return { ok: true, presetName, version: PRESET_VERSION_285 };
  }

  /**
   * Apply a named preset to a channel (delegates setChannelFilter284 on the V284 engine).
   *
   * @param {string} channelName
   * @param {string} presetName
   * @returns {{ ok, channelName, presetName, filter?, version }}
   */
  applyFilterPreset285(channelName, presetName) {
    const _t0 = Date.now();
    if (!channelName || typeof channelName !== 'string')
      return { ok: false, error: 'channelName must be a non-empty string', version: PRESET_VERSION_285 };
    if (!presetName || typeof presetName !== 'string')
      return { ok: false, error: 'presetName must be a non-empty string', version: PRESET_VERSION_285 };

    const preset = this._presets285.get(presetName);
    if (!preset) {
      this._recordPerf285(Date.now() - _t0);
      return { ok: false, error: `no preset found: '${presetName}'`, version: PRESET_VERSION_285 };
    }

    if (!this._channelFilter285) {
      this._recordPerf285(Date.now() - _t0);
      return { ok: false, error: 'no channelFilter284 engine wired', version: PRESET_VERSION_285 };
    }

    // Build filter opts from preset (strip meta fields)
    const filterOpts = {};
    if (preset.categories)        filterOpts.categories        = preset.categories;
    if (preset.excludeCategories) filterOpts.excludeCategories = preset.excludeCategories;
    if (preset.minSeverity)       filterOpts.minSeverity       = preset.minSeverity;
    if (preset.maxAlerts !== null && preset.maxAlerts !== undefined)
                                  filterOpts.maxAlerts         = preset.maxAlerts;
    if (preset.minAlerts !== null && preset.minAlerts !== undefined)
                                  filterOpts.minAlerts         = preset.minAlerts;
    if (preset.periods)           filterOpts.periods           = preset.periods;
    if (preset.custom)            filterOpts.custom            = preset.custom;

    const result = this._channelFilter285.setChannelFilter284(channelName, filterOpts);
    this._recordPerf285(Date.now() - _t0);
    return {
      ok:         result.ok,
      channelName,
      presetName,
      filter:     result.filter,
      error:      result.error,
      version:    PRESET_VERSION_285,
    };
  }

  // ── Health / Status ──────────────────────────────────────────────────────────

  /**
   * Runtime status.
   * @returns {{ ok, version, presetCount }}
   */
  getStatus285() {
    return { ok: true, version: PRESET_VERSION_285, presetCount: this._presets285.size };
  }

  /**
   * Health check.
   * @returns {{ ok, version, presetCount }}
   */
  checkFilterPresetHealth285() {
    return { ok: true, version: PRESET_VERSION_285, presetCount: this._presets285.size };
  }

  /**
   * Latency percentiles from the last 1,000 operations.
   * @returns {{ p50, p95, p99, count }}
   */
  getPerf285() {
    const lats = [...this._perfLatencies285].sort((a, b) => a - b);
    const n = lats.length;
    if (n === 0) return { p50: 0, p95: 0, p99: 0, count: 0 };
    const pct = (p) => lats[Math.floor(p * n / 100)] ?? lats[n - 1];
    return { p50: pct(50), p95: pct(95), p99: pct(99), count: n };
  }

  // ── Private Helpers ──────────────────────────────────────────────────────────

  _recordPerf285(ms) {
    this._perfLatencies285.push(ms);
    if (this._perfLatencies285.length > 1000) this._perfLatencies285.shift();
  }

  _validateFilterOpts285(filterOpts) {
    if (!filterOpts || typeof filterOpts !== 'object') return 'filterOpts must be an object';
    if ('categories' in filterOpts && !Array.isArray(filterOpts.categories))
      return '"categories" must be an array';
    if ('excludeCategories' in filterOpts && !Array.isArray(filterOpts.excludeCategories))
      return '"excludeCategories" must be an array';
    if ('minSeverity' in filterOpts && !SEVERITY_ORDER_285.includes(filterOpts.minSeverity))
      return `"minSeverity" must be one of: ${SEVERITY_ORDER_285.join(', ')}`;
    if ('maxAlerts' in filterOpts && (typeof filterOpts.maxAlerts !== 'number' || filterOpts.maxAlerts < 0))
      return '"maxAlerts" must be a non-negative number';
    if ('minAlerts' in filterOpts && (typeof filterOpts.minAlerts !== 'number' || filterOpts.minAlerts < 0))
      return '"minAlerts" must be a non-negative number';
    if ('periods' in filterOpts && !Array.isArray(filterOpts.periods))
      return '"periods" must be an array';
    if ('custom' in filterOpts && (typeof filterOpts.custom !== 'object' || Array.isArray(filterOpts.custom)))
      return '"custom" must be a plain object';
    return null;
  }
}

module.exports = { FilterPresets285, PRESET_VERSION_285, PRESET_MAX_PRESETS_285 };
