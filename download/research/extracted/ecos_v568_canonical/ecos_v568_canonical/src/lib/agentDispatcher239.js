/**
 * src/lib/agentDispatcher239.js — ECOS Unified Agent Dispatcher (P131)
 * ------------------------------------------------------------
 * The "Brain" that coordinates between agentLoop225, toolCatalog237,
 * and connectorRuntime238. Handles tool resolution, billing, and multi-step.
 */

'use strict';

const { defaultCatalog237 } = require('./toolCatalog237');
const { defaultAuditLog } = require('./auditLog');
const { runAgentLoop225 } = require('./agentLoop225');
const { usdToMicrocents } = require('./fiatLedger');

class AgentDispatcher239 {
  constructor(opts = {}) {
    this._connectorRuntime = opts.connectorRuntime || null;
    this._ledger = opts.ledger || null;
    this._gateway = opts.gateway || null;
    this._logger = opts.logger || { info: () => {}, warn: () => {}, error: () => {} };
    this._quotas = new Map(); // userId -> { used: bigint, limit: bigint }
  }

  /**
   * Set a spending quota for a user.
   * @param {string} userId
   * @param {number|string} limitUsd
   */
  setQuota239(userId, limitUsd) {
    this._quotas.set(userId, {
      used: 0n,
      limit: usdToMicrocents(limitUsd)
    });
  }

  /**
   * Dispatch a high-level command to the agent.
   * @param {object} params
   * @param {string} params.userId
   * @param {string} params.prompt
   * @param {string} [params.missionId]
   * @param {string} [params.clientAccountId]
   * @param {object} [params.opts] - Additional loop options (provider, model, etc)
   */
  async dispatch239(params) {
    const { userId, prompt, missionId, clientAccountId, opts = {} } = params;
    
    this._logger.info({ userId, missionId }, '[V239] dispatching agent command');
    defaultAuditLog.append('AGENT_DISPATCH_START', { userId, missionId, promptLength: prompt.length });

    // 1. Prepare Tools from Catalog
    const catalogTools = defaultCatalog237.listTools237();
    const loopTools = catalogTools.map(t => ({
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
      run: async ({ args }) => {
        // Check Quota
        const cost = usdToMicrocents(t.cost || 0);
        const q = userId ? this._quotas.get(userId) : null;
        if (q && (q.used + cost > q.limit)) {
          throw new Error(`Quota exceeded for user ${userId}`);
        }

        // Execute via Connector Runtime if it belongs to a connector
        if (t.server && this._connectorRuntime) {
          const res = await this._connectorRuntime.callTool238({
            connectorId: t.server,
            toolName: t.name,
            args,
            userId,
            missionId,
            clientAccountId,
            priceUsd: t.cost
          });

          // Bill the user if successful and not queued
          if (res.status === 'COMPLETED' && this._ledger && userId) {
            this._ledger.ensureAccount(userId);
            this._ledger.ensureAccount('sys::platform');
            this._ledger.transfer(userId, 'sys::platform', cost, `Tool usage: ${t.name}`);
            
            const q = this._quotas.get(userId);
            if (q) q.used += cost;
          }

          return res;
        }

        // Fallback to local runner if exists in catalog (P129 pattern)
        const localRunner = defaultCatalog237.getRunner237(t.name);
        if (localRunner) {
          const res = await localRunner({ args, ctx: { userId, missionId } });
          return res;
        }

        throw new Error(`No runner found for tool ${t.name}`);
      }
    }));

    // 2. Run Agent Loop
    try {
      const result = await runAgentLoop225({
        gateway: this._gateway,
        provider: opts.provider || 'mock',
        model: opts.model,
        userMessage: prompt,
        tools: loopTools,
        ctx: { userId, missionId, clientAccountId },
        maxSteps: opts.maxSteps || 10
      });

      // P131: Check if any tool failed with "Quota exceeded"
      if (result.trace) {
        for (const t of result.trace) {
          if (t.type === 'tool' && t.result && t.result.error && t.result.error.includes('Quota exceeded')) {
            throw new Error(t.result.error);
          }
        }
      }

      defaultAuditLog.append('AGENT_DISPATCH_COMPLETED', { 
        userId, 
        missionId, 
        steps: result.steps, 
        success: result.ok 
      });

      return result;
    } catch (err) {
      defaultAuditLog.append('AGENT_DISPATCH_FAILED', { userId, missionId, error: err.message });
      throw err;
    }
  }
}

module.exports = { AgentDispatcher239 };
