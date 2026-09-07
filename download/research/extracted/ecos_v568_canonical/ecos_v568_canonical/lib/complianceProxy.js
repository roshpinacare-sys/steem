'use strict';

const crypto = require('node:crypto');

function toNumber(value, fallback = null) {
  if (value === null || value === undefined) return fallback;
  const n = typeof value === 'string' ? Number(value) : value;
  return Number.isFinite(n) ? n : fallback;
}

function normalizeAiOutput(aiOutput, userPrompt) {
  if (aiOutput && typeof aiOutput === 'object' && Object.prototype.hasOwnProperty.call(aiOutput, 'result')) {
    return aiOutput;
  }
  if (aiOutput && typeof aiOutput === 'object') {
    return { result: aiOutput.text || aiOutput.output || aiOutput.message || JSON.stringify(aiOutput) };
  }
  if (typeof aiOutput === 'string') return { result: aiOutput };
  return { result: `No provider output returned for: ${String(userPrompt || '').slice(0, 120)}` };
}

function defaultPolicy() {
  return {
    proxyVersion: 'V114',
    confidence: { autoFlow: 0.70, hitl: 0.50, block: 0.30 },
    requiresHumanReview: ['healthcare', 'legal', 'finance', 'employment', 'education', 'biometric', 'public-service'],
  };
}

class ComplianceProxy {
  constructor({ offlineInference, confidenceGate, hitlGate, auditLog, logger, policy = defaultPolicy() } = {}) {
    if (!offlineInference || typeof offlineInference.executeTask !== 'function') {
      throw new TypeError('offlineInference.executeTask dependency is required');
    }
    if (typeof confidenceGate !== 'function') {
      throw new TypeError('confidenceGate function dependency is required');
    }
    if (!auditLog || typeof auditLog.append !== 'function') {
      throw new TypeError('auditLog.append dependency is required');
    }
    this.offlineInference = offlineInference;
    this.confidenceGate = confidenceGate;
    this.hitlGate = hitlGate;
    this.auditLog = auditLog;
    this.logger = logger || console;
    this.policy = policy;
    this.calls = [];
  }

  async handle(input = {}) {
    const start = Date.now();
    const {
      userPrompt,
      systemPrompt = 'You are an ECOS-compliant AI assistant. Return accurate, bounded, auditable output.',
      clientAccountId = 'client::compliance_proxy',
      priceUsd = '0.01',
      taskType = 'proxy',
      context = {},
      metadata = {},
    } = input || {};

    if (!userPrompt || typeof userPrompt !== 'string') {
      return { ok: false, statusCode: 400, error: 'userPrompt is required and must be a string' };
    }

    let providerResult;
    try {
      providerResult = await this.offlineInference.executeTask(systemPrompt, userPrompt);
    } catch (err) {
      this.logger.warn?.({ err: err.message }, '[V114] compliance proxy provider failed; routing to HITL');
      providerResult = { aiOutput: { result: `Provider error: ${err.message}` }, confidence: 0.50, providerError: err.message };
    }

    const aiOutput = normalizeAiOutput(providerResult.aiOutput, userPrompt);
    const confidence = toNumber(providerResult.confidence, 0.50);
    const proxyContext = {
      ...context,
      proxyVersion: 'V114',
      taskType,
      metadata,
      provider: providerResult.provider || providerResult.model || null,
      providerError: providerResult.providerError || null,
    };

    const gate = this.confidenceGate({
      confidence,
      clientAccountId,
      priceUsd,
      aiOutput,
      context: proxyContext,
      taskType,
    });

    let approval = null;
    const status = gate.verdict === 'AUTO_FLOW' ? 'AUTO_FLOW' : 'HITL_QUEUE';
    if (status === 'HITL_QUEUE' && this.hitlGate && typeof this.hitlGate.createApproval === 'function') {
      approval = this.hitlGate.createApproval({
        missionId: 'mission_proxy_' + crypto.randomBytes(6).toString('hex'),
        clientAccountId,
        priceUsd: String(priceUsd),
        aiOutput: gate.sanitized?.aiOutput || aiOutput,
        context: { ...proxyContext, gateVerdict: gate.verdict, proxyStatus: status },
        confidence,
      });
    }

    const auditEntry = this.auditLog.append('PROXY_CALL', {
      status,
      gateVerdict: gate.verdict,
      approvalId: approval ? approval.id : null,
      clientAccountId,
      taskType,
      confidence,
      latencyMs: Date.now() - start,
      promptHash: crypto.createHash('sha256').update(userPrompt).digest('hex'),
    });

    const record = {
      ts: new Date().toISOString(),
      status,
      gateVerdict: gate.verdict,
      confidence,
      approvalId: approval ? approval.id : null,
      auditHash: auditEntry.hash,
      latencyMs: Date.now() - start,
    };
    this.calls.push(record);
    if (this.calls.length > 1000) this.calls.shift();

    return {
      ok: true,
      statusCode: 200,
      status,
      gateVerdict: gate.verdict,
      confidence,
      reasons: gate.reasons || [],
      approvalId: approval ? approval.id : null,
      aiOutput: status === 'AUTO_FLOW' ? (gate.sanitized?.aiOutput || aiOutput) : null,
      audit: { type: 'PROXY_CALL', index: auditEntry.index, hash: auditEntry.hash },
      latencyMs: Date.now() - start,
    };
  }

  stats() {
    const total = this.calls.length;
    const byStatus = this.calls.reduce((acc, c) => {
      acc[c.status] = (acc[c.status] || 0) + 1;
      return acc;
    }, {});
    const avgConfidence = total ? this.calls.reduce((sum, c) => sum + (Number(c.confidence) || 0), 0) / total : 0;
    const lastCall = total ? this.calls[total - 1] : null;
    return { ok: true, proxyVersion: 'V114', totalCalls: total, byStatus, avgConfidence, lastCall };
  }

  config() {
    return { ok: true, proxyVersion: 'V114', policy: this.policy, auth: { apiKeyEnv: 'ECOS_PROXY_API_KEY', apiKeyRequired: !!process.env.ECOS_PROXY_API_KEY } };
  }
}

function verifyProxyApiKey(req) {
  const expected = process.env.ECOS_PROXY_API_KEY;
  if (!expected) return { ok: true, mode: 'dev-open' };
  const supplied = req.headers['x-api-key'] || (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (supplied === expected) return { ok: true, mode: 'api-key' };
  return { ok: false, status: 401, error: 'Invalid or missing proxy API key' };
}

module.exports = { ComplianceProxy, verifyProxyApiKey, defaultPolicy, normalizeAiOutput };
