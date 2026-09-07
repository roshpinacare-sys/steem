'use strict';
/**
 * src/lib/presetGroups286.js — ECOS Preset Groups (V286)
 *
 * V286 adds preset groups on top of V285 named filter presets.
 * A group bundles multiple preset names; applying a group applies every preset
 * in the group to every supplied channel in one operation.
 *
 *   - createPresetGroup286(groupName, presetNames[])  — create/replace a group
 *   - getPresetGroup286(groupName)                    — retrieve a group
 *   - listPresetGroups286()                           — list all groups
 *   - removePresetGroup286(groupName)                 — delete a group
 *   - applyPresetGroup286(channelNames[], groupName)  — apply all group presets to all channels
 *   - getStatus286()                                  — runtime status
 *   - checkPresetGroupHealth286()                     — health check
 *   - getPerf286()                                    — latency percentiles (1000-sample ring)
 *
 * Iron rules: zero new npm deps. All identifiers end in 286. Sacred files untouched.
 */

const GROUP_VERSION_286   = '286';
const GROUP_MAX_GROUPS_286 = 200;
const GROUP_MAX_PRESETS_PER_GROUP_286 = 50;
const GROUP_MAX_CHANNELS_PER_APPLY_286 = 100;

class PresetGroups286 {
  /**
   * @param {object} opts
   * @param {object} [opts.logger]
   * @param {object} [opts.logAdapter]
   * @param {object} [opts.filterPresets285]  — V285 preset engine for delegation
   */
  constructor(opts = {}) {
    this._logger286        = opts.logger           || console;
    this._logAdapter286    = opts.logAdapter        || null;
    this._filterPresets285 = opts.filterPresets285  || null;

    // Group registry: Map<groupName, { groupName, presetNames[], createdAt }>
    this._groups286 = new Map();

    // Perf ring buffer (last 1000 latencies in ms)
    this._perfLatencies286 = [];
  }

  // ── Group Registry ────────────────────────────────────────────────────────────

  /**
   * Create or replace a named preset group.
   *
   * @param {string}   groupName
   * @param {string[]} presetNames  — non-empty array of preset names to include
   * @returns {{ ok, groupName, group, version }}
   */
  createPresetGroup286(groupName, presetNames) {
    const _t0 = Date.now();

    if (!groupName || typeof groupName !== 'string')
      return { ok: false, error: 'groupName must be a non-empty string', version: GROUP_VERSION_286 };

    const validationError = this._validatePresetNames286(presetNames);
    if (validationError)
      return { ok: false, error: validationError, version: GROUP_VERSION_286 };

    if (this._groups286.size >= GROUP_MAX_GROUPS_286 && !this._groups286.has(groupName))
      return { ok: false, error: `group limit (${GROUP_MAX_GROUPS_286}) reached`, version: GROUP_VERSION_286 };

    const group = {
      groupName,
      presetNames: [...new Set(presetNames)],   // deduplicate
      createdAt: new Date().toISOString(),
    };

    this._groups286.set(groupName, group);
    this._recordPerf286(Date.now() - _t0);
    return { ok: true, groupName, group: { ...group, presetNames: [...group.presetNames] }, version: GROUP_VERSION_286 };
  }

  /**
   * Retrieve a named preset group.
   *
   * @param {string} groupName
   * @returns {{ ok, groupName, group, version }}
   */
  getPresetGroup286(groupName) {
    const _t0 = Date.now();
    if (!groupName || typeof groupName !== 'string')
      return { ok: false, error: 'groupName must be a non-empty string', version: GROUP_VERSION_286 };
    const group = this._groups286.get(groupName);
    this._recordPerf286(Date.now() - _t0);
    if (!group)
      return { ok: false, error: `no group found: '${groupName}'`, version: GROUP_VERSION_286 };
    return { ok: true, groupName, group: { ...group, presetNames: [...group.presetNames] }, version: GROUP_VERSION_286 };
  }

  /**
   * List all registered groups.
   *
   * @returns {{ ok, groups, count, version }}
   */
  listPresetGroups286() {
    const _t0 = Date.now();
    const groups = [...this._groups286.values()].map(g => ({ ...g, presetNames: [...g.presetNames] }));
    this._recordPerf286(Date.now() - _t0);
    return { ok: true, groups, count: groups.length, version: GROUP_VERSION_286 };
  }

  /**
   * Delete a named preset group.
   *
   * @param {string} groupName
   * @returns {{ ok, groupName, version }}
   */
  removePresetGroup286(groupName) {
    const _t0 = Date.now();
    if (!groupName || typeof groupName !== 'string')
      return { ok: false, error: 'groupName must be a non-empty string', version: GROUP_VERSION_286 };
    if (!this._groups286.has(groupName)) {
      this._recordPerf286(Date.now() - _t0);
      return { ok: false, error: `no group found: '${groupName}'`, version: GROUP_VERSION_286 };
    }
    this._groups286.delete(groupName);
    this._recordPerf286(Date.now() - _t0);
    return { ok: true, groupName, version: GROUP_VERSION_286 };
  }

  /**
   * Apply all presets in a group to all supplied channels.
   * For each (channel × preset) pair, delegates to filterPresets285.applyFilterPreset285.
   * Last-applied preset wins if a channel appears more than once (deduplication happens at channelNames level).
   *
   * @param {string[]} channelNames  — channels to apply the group to
   * @param {string}   groupName
   * @returns {{
   *   ok, groupName, channelNames, presetNames,
   *   results: Array<{ channelName, presetName, ok, error? }>,
   *   applied, failed, version
   * }}
   */
  applyPresetGroup286(channelNames, groupName) {
    const _t0 = Date.now();

    if (!Array.isArray(channelNames) || channelNames.length === 0)
      return { ok: false, error: 'channelNames must be a non-empty array', version: GROUP_VERSION_286 };
    if (channelNames.length > GROUP_MAX_CHANNELS_PER_APPLY_286)
      return { ok: false, error: `channelNames exceeds limit (${GROUP_MAX_CHANNELS_PER_APPLY_286})`, version: GROUP_VERSION_286 };
    if (!groupName || typeof groupName !== 'string')
      return { ok: false, error: 'groupName must be a non-empty string', version: GROUP_VERSION_286 };

    const group = this._groups286.get(groupName);
    if (!group) {
      this._recordPerf286(Date.now() - _t0);
      return { ok: false, error: `no group found: '${groupName}'`, version: GROUP_VERSION_286 };
    }

    if (!this._filterPresets285) {
      this._recordPerf286(Date.now() - _t0);
      return { ok: false, error: 'no filterPresets285 engine wired', version: GROUP_VERSION_286 };
    }

    const uniqueChannels = [...new Set(channelNames)];
    const results = [];
    let applied = 0;
    let failed  = 0;

    for (const channelName of uniqueChannels) {
      for (const presetName of group.presetNames) {
        const r = this._filterPresets285.applyFilterPreset285(channelName, presetName);
        results.push({
          channelName,
          presetName,
          ok:    r.ok,
          error: r.ok ? undefined : r.error,
        });
        if (r.ok) applied++;
        else      failed++;
      }
    }

    this._recordPerf286(Date.now() - _t0);
    return {
      ok:           failed === 0,
      groupName,
      channelNames: uniqueChannels,
      presetNames:  [...group.presetNames],
      results,
      applied,
      failed,
      version: GROUP_VERSION_286,
    };
  }

  // ── Health / Status ───────────────────────────────────────────────────────────

  /**
   * Runtime status.
   * @returns {{ ok, version, groupCount }}
   */
  getStatus286() {
    return { ok: true, version: GROUP_VERSION_286, groupCount: this._groups286.size };
  }

  /**
   * Health check.
   * @returns {{ ok, version, groupCount }}
   */
  checkPresetGroupHealth286() {
    return { ok: true, version: GROUP_VERSION_286, groupCount: this._groups286.size };
  }

  /**
   * Latency percentiles from the last 1,000 operations.
   * @returns {{ p50, p95, p99, count }}
   */
  getPerf286() {
    const lats = [...this._perfLatencies286].sort((a, b) => a - b);
    const n = lats.length;
    if (n === 0) return { p50: 0, p95: 0, p99: 0, count: 0 };
    const pct = (p) => lats[Math.floor(p * n / 100)] ?? lats[n - 1];
    return { p50: pct(50), p95: pct(95), p99: pct(99), count: n };
  }

  // ── Private Helpers ───────────────────────────────────────────────────────────

  _recordPerf286(ms) {
    this._perfLatencies286.push(ms);
    if (this._perfLatencies286.length > 1000) this._perfLatencies286.shift();
  }

  _validatePresetNames286(presetNames) {
    if (!Array.isArray(presetNames) || presetNames.length === 0)
      return 'presetNames must be a non-empty array';
    if (presetNames.length > GROUP_MAX_PRESETS_PER_GROUP_286)
      return `presetNames exceeds per-group limit (${GROUP_MAX_PRESETS_PER_GROUP_286})`;
    for (const name of presetNames) {
      if (!name || typeof name !== 'string')
        return 'each entry in presetNames must be a non-empty string';
    }
    return null;
  }
}

module.exports = { PresetGroups286, GROUP_VERSION_286, GROUP_MAX_GROUPS_286, GROUP_MAX_PRESETS_PER_GROUP_286, GROUP_MAX_CHANNELS_PER_APPLY_286 };
