'use strict';
/**
 * chainIntegrityWatchdog395.js — ECOS V395 D4
 *
 * Wraps commitmentChainSync394 and additionally calls
 * verifyIdentityCommitmentChain393 after each sync; if verification
 * fails, emits chain_integrity_violation_event_type_395 and invokes a
 * configurable alert callback.
 *
 * Mirrors the V381 key-rotation integrity checker for the identity surface.
 *
 * Function: createChainIntegrityWatchdog395({ commitmentChainSync, commitmentChain, audit, alertCallback, intervalMs, autoStart })
 * Methods:  start395() / stop395() / runOnce395() / getStatus395()
 */

'use strict';

const CHAIN_INTEGRITY_WATCHDOG_VERSION_395 = '395.0.0';

const EVT_WATCHDOG_START_395     = 'chain_integrity_watchdog_start_event_type_395';
const EVT_WATCHDOG_STOP_395      = 'chain_integrity_watchdog_stop_event_type_395';
const EVT_WATCHDOG_PASS_395      = 'chain_integrity_watchdog_pass_event_type_395';
const EVT_WATCHDOG_VIOLATION_395 = 'chain_integrity_violation_event_type_395';
const EVT_WATCHDOG_ERROR_395     = 'chain_integrity_watchdog_error_event_type_395';

function createChainIntegrityWatchdog395(opts = {}) {
  // commitmentChainSync — an instance created by createCommitmentChainSync394
  const commitmentChainSync = opts.commitmentChainSync || null;
  // commitmentChain — used to call verifyIdentityCommitmentChain393; may be the
  // same underlying module or a separate one
  const commitmentChain = opts.commitmentChain || null;
  const audit           = opts.audit || opts.auditLog || null;
  const alertCallback   = typeof opts.alertCallback === 'function' ? opts.alertCallback : null;

  const intervalMs = typeof opts.intervalMs === 'number' && opts.intervalMs > 0
    ? opts.intervalMs
    : (parseInt(process.env.ECOS_WATCHDOG_INTERVAL_MS, 10) || 60000);

  const autoStart = opts.autoStart === true;

  let _timer       = null;
  let _running     = false;
  let _totalPasses = 0;
  let _totalViolations = 0;
  let _totalErrors = 0;
  let _lastRunTs   = null;
  let _lastStatus  = null; // 'pass' | 'violation' | 'error'

  function _appendAudit(entry) {
    if (!audit) return;
    if (typeof audit.append === 'function') audit.append(entry);
  }

  /**
   * runOnce395()
   *
   * Executes one watchdog cycle:
   * 1. Calls commitmentChainSync.runOnce394() (if available)
   * 2. Calls commitmentChain.verifyIdentityCommitmentChain393() (if available)
   * 3. If verification fails → emit violation + call alertCallback
   *
   * Returns { passed, headHash?, chainLength?, error? }
   */
  function runOnce395() {
    const now = Date.now();
    _lastRunTs = now;

    let headHash    = null;
    let chainLength = null;

    try {
      // Step 1 — run the underlying sync
      if (commitmentChainSync && typeof commitmentChainSync.runOnce394 === 'function') {
        const syncResult = commitmentChainSync.runOnce394();
        if (syncResult && typeof syncResult === 'object') {
          headHash    = syncResult.headHash    || headHash;
          chainLength = syncResult.chainLength || chainLength;
        }
      }

      // Step 2 — verify chain integrity
      let verifyResult = null;
      if (commitmentChain) {
        if (typeof commitmentChain.verifyIdentityCommitmentChain393 === 'function') {
          verifyResult = commitmentChain.verifyIdentityCommitmentChain393();
        } else if (typeof commitmentChain.verify === 'function') {
          verifyResult = commitmentChain.verify();
        }
      }

      const passed = verifyResult == null || verifyResult === true ||
                     (verifyResult && verifyResult.valid === true) ||
                     (verifyResult && verifyResult.verified === true);

      if (passed) {
        _totalPasses++;
        _lastStatus = 'pass';
        _appendAudit({
          type: EVT_WATCHDOG_PASS_395,
          ts:   now,
          data: { headHash, chainLength },
        });
        return { passed: true, headHash, chainLength };
      } else {
        // Violation
        _totalViolations++;
        _lastStatus = 'violation';
        const violationData = {
          headHash,
          chainLength,
          verifyResult: typeof verifyResult === 'object' ? verifyResult : { raw: verifyResult },
          ts: now,
        };
        _appendAudit({
          type: EVT_WATCHDOG_VIOLATION_395,
          ts:   now,
          data: violationData,
        });
        if (alertCallback) {
          try { alertCallback(violationData); } catch (_) { /* swallow alert errors */ }
        }
        return { passed: false, headHash, chainLength, violation: violationData };
      }
    } catch (err) {
      _totalErrors++;
      _lastStatus = 'error';
      _appendAudit({
        type: EVT_WATCHDOG_ERROR_395,
        ts:   now,
        data: { error: err.message },
      });
      throw err;
    }
  }

  /**
   * start395() — starts the periodic watchdog timer.
   * No-op if already running.
   */
  function start395() {
    if (_running) return;
    _running = true;
    _timer = setInterval(() => {
      try { runOnce395(); } catch (_) { /* errors already logged */ }
    }, intervalMs);
    if (_timer.unref) _timer.unref();
    _appendAudit({
      type: EVT_WATCHDOG_START_395,
      ts:   Date.now(),
      data: { intervalMs },
    });
  }

  /**
   * stop395() — stops the periodic watchdog timer.
   */
  function stop395() {
    if (!_running) return;
    clearInterval(_timer);
    _timer   = null;
    _running = false;
    _appendAudit({
      type: EVT_WATCHDOG_STOP_395,
      ts:   Date.now(),
      data: {},
    });
  }

  /**
   * getStatus395() — current watchdog statistics.
   */
  function getStatus395() {
    return {
      version:         CHAIN_INTEGRITY_WATCHDOG_VERSION_395,
      running:         _running,
      intervalMs,
      totalPasses:     _totalPasses,
      totalViolations: _totalViolations,
      totalErrors:     _totalErrors,
      lastRunTs:       _lastRunTs,
      lastStatus:      _lastStatus,
    };
  }

  if (autoStart) start395();

  return {
    start395,
    stop395,
    runOnce395,
    getStatus395,
    CHAIN_INTEGRITY_WATCHDOG_VERSION_395,
  };
}

module.exports = {
  createChainIntegrityWatchdog395,
  CHAIN_INTEGRITY_WATCHDOG_VERSION_395,
  EVT_WATCHDOG_START_395,
  EVT_WATCHDOG_STOP_395,
  EVT_WATCHDOG_PASS_395,
  EVT_WATCHDOG_VIOLATION_395,
  EVT_WATCHDOG_ERROR_395,
};
