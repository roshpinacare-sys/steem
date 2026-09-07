/**
   * calibrationRouter212.js — Calibration-Driven Task Routing (V212)
   * Sacred files untouched. Zero new npm deps.
   */
  'use strict';
  const _routeLog212 = [];
  const ROUTE_LOG_MAX_212 = 2000;
  const DEFAULT_AUTO_THRESH_212  = 0.70;
  const DEFAULT_HITL_LOW_212     = 0.30;
  const DEFAULT_REJECT_THRESH_212 = 0.30;
  function _routeErr212(msg, code, status) { const e = new Error(msg); e.code = code; e.statusCode = status || 400; return e; }
  function routeTask212(body) {
    const { taskId, confidence, calibrationState } = body || {};
    if (!taskId) throw _routeErr212('taskId required', 'ROUTE_MISSING_TASK');
    const conf = Number(confidence);
    if (isNaN(conf) || conf < 0 || conf > 1) throw _routeErr212('confidence must be 0..1', 'ROUTE_BAD_CONFIDENCE');
    const autoT   = calibrationState?.autoThreshold   ?? DEFAULT_AUTO_THRESH_212;
    const hitlLow = calibrationState?.hitlThreshold   ?? DEFAULT_HITL_LOW_212;
    const rejectT = calibrationState?.rejectThreshold ?? DEFAULT_REJECT_THRESH_212;
    let route, reason;
    if (conf >= autoT) { route = 'auto'; reason = `confidence ${conf.toFixed(3)} >= auto threshold ${autoT}`; }
    else if (conf >= hitlLow) { route = 'hitl'; reason = `confidence ${conf.toFixed(3)} in HITL band [${hitlLow}, ${autoT})`; }
    else if (conf >= rejectT) { route = 'hitl'; reason = `confidence ${conf.toFixed(3)} in low-confidence HITL band [${rejectT}, ${hitlLow})`; }
    else { route = 'reject'; reason = `confidence ${conf.toFixed(3)} below reject threshold ${rejectT}`; }
    const decision = { taskId, confidence: conf, route, reason, thresholds: { autoT, hitlLow, rejectT }, decidedAt: new Date().toISOString() };
    if (_routeLog212.length >= ROUTE_LOG_MAX_212) _routeLog212.shift();
    _routeLog212.push(decision);
    return { ok: true, taskId, route, confidence: conf, reason, decidedAt: decision.decidedAt };
  }
  function batchRouteTask212(body) {
    const { tasks, calibrationState } = body || {};
    if (!Array.isArray(tasks) || tasks.length === 0) throw _routeErr212('tasks array required', 'ROUTE_MISSING_TASKS');
    if (tasks.length > 100) throw _routeErr212('Max 100 tasks per batch', 'ROUTE_BATCH_TOO_LARGE');
    const results = tasks.map(t => { try { return routeTask212({ ...t, calibrationState }); } catch (e) { return { ok: false, taskId: t.taskId, error: e.message }; } });
    const summary = { auto: 0, hitl: 0, reject: 0, error: 0 };
    results.forEach(r => { summary[r.route || 'error'] = (summary[r.route || 'error'] || 0) + 1; });
    return { ok: true, results, summary };
  }
  function getRoutingDecision212(calibrationState) {
    const autoT   = calibrationState?.autoThreshold   ?? DEFAULT_AUTO_THRESH_212;
    const hitlLow = calibrationState?.hitlThreshold   ?? DEFAULT_HITL_LOW_212;
    const rejectT = calibrationState?.rejectThreshold ?? DEFAULT_REJECT_THRESH_212;
    return { ok: true, thresholds: { auto: autoT, hitlLow, reject: rejectT }, recentDecisions: _routeLog212.slice(-20), totalDecisions: _routeLog212.length };
  }
  module.exports = { routeTask212, batchRouteTask212, getRoutingDecision212, _routeLog212, ROUTE_LOG_MAX_212, DEFAULT_AUTO_THRESH_212, DEFAULT_HITL_LOW_212 };
  