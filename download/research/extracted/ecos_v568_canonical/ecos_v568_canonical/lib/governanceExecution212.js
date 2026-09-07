/**
   * governanceExecution212.js — Governance Auto-Execution Engine (V212)
   * Sacred files untouched. Zero new npm deps.
   */
  'use strict';
  const _execLog212      = [];
  const _execParams212   = new Map();
  const _featureFlags212 = new Map();
  const _textRecords212  = [];
  const EXEC_TYPES_212 = ['PARAM_CHANGE', 'TREASURY_TRANSFER', 'FEATURE_FLAG', 'TEXT_RECORD'];
  const EXEC_LOG_MAX_212   = 10000;
  const EXEC_QUORUM_PCT_212 = 0.51;
  function _execErr212(msg, code, status) { const e = new Error(msg); e.code = code; e.statusCode = status || 400; return e; }
  function executeProposal212(body) {
    const { proposalId, title, executionType, payload, forWeight, againstWeight, abstainWeight, totalNetworkRep } = body || {};
    if (!proposalId) throw _execErr212('proposalId required', 'EXEC_MISSING_PROPOSAL');
    if (!executionType || !EXEC_TYPES_212.includes(executionType)) throw _execErr212(`executionType must be one of: ${EXEC_TYPES_212.join(', ')}`, 'EXEC_BAD_TYPE');
    if (_execLog212.find(e => e.proposalId === proposalId)) throw _execErr212('Proposal already executed', 'EXEC_DUPLICATE');
    const totalVoted = (Number(forWeight) || 0) + (Number(againstWeight) || 0) + (Number(abstainWeight) || 0);
    const netRep = Number(totalNetworkRep) || 10000;
    const forW   = Number(forWeight) || 0;
    const participation = totalVoted / netRep;
    const approval      = totalVoted > 0 ? forW / totalVoted : 0;
    if (approval <= EXEC_QUORUM_PCT_212) throw _execErr212(`Proposal did not reach quorum (approval: ${(approval * 100).toFixed(1)}%, need > 51%)`, 'EXEC_NO_QUORUM');
    let executionResult = {};
    const now = new Date().toISOString();
    switch (executionType) {
      case 'PARAM_CHANGE': {
        const { paramKey, newValue } = payload || {};
        if (!paramKey) throw _execErr212('payload.paramKey required for PARAM_CHANGE', 'EXEC_MISSING_PARAM');
        const oldValue = _execParams212.get(paramKey);
        _execParams212.set(paramKey, newValue);
        executionResult = { paramKey, oldValue, newValue };
        break;
      }
      case 'TREASURY_TRANSFER': {
        const { toWorkspaceId, amountCredits, memo } = payload || {};
        if (!toWorkspaceId || amountCredits == null) throw _execErr212('payload.toWorkspaceId and amountCredits required', 'EXEC_MISSING_TRANSFER');
        executionResult = { toWorkspaceId, amountCredits: Number(amountCredits), memo: memo || '' };
        break;
      }
      case 'FEATURE_FLAG': {
        const { flagName, enabled } = payload || {};
        if (!flagName) throw _execErr212('payload.flagName required for FEATURE_FLAG', 'EXEC_MISSING_FLAG');
        const wasEnabled = _featureFlags212.get(flagName) ?? false;
        _featureFlags212.set(flagName, !!enabled);
        executionResult = { flagName, wasEnabled, nowEnabled: !!enabled };
        break;
      }
      case 'TEXT_RECORD': {
        const { text } = payload || {};
        if (!text) throw _execErr212('payload.text required for TEXT_RECORD', 'EXEC_MISSING_TEXT');
        _textRecords212.push({ proposalId, text, recordedAt: now });
        executionResult = { text: text.slice(0, 200), recordedAt: now };
        break;
      }
    }
    if (_execLog212.length >= EXEC_LOG_MAX_212) throw _execErr212('Execution log full', 'EXEC_LOG_FULL', 503);
    const entry = { executionId: 'exec212_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8), proposalId, title: title || '', executionType, payload, executionResult, approval, participation, executedAt: now };
    _execLog212.push(entry);
    return { ok: true, ...entry };
  }
  function getExecutionLog212({ limit = 50, offset = 0 } = {}) {
    return { ok: true, executions: _execLog212.slice(offset, offset + limit), total: _execLog212.length, limit, offset };
  }
  function getCurrentParams212() {
    return { ok: true, params: Object.fromEntries(_execParams212), featureFlags: Object.fromEntries(_featureFlags212) };
  }
  module.exports = { executeProposal212, getExecutionLog212, getCurrentParams212, _execLog212, _execParams212, _featureFlags212, _textRecords212, EXEC_TYPES_212, EXEC_QUORUM_PCT_212 };
  