/**
 * src/lib/connectorRuntime238.js — ECOS Connector Runtime (P130)
 * ------------------------------------------------------------
 * Unified connector interface for managing third-party tool providers.
 * Handles tool listing, execution, and integration with HITL/Audit/Vault.
 * Registers connector tools into ToolCatalog237.
 */

'use strict';

const { defaultCatalog237 } = require('./toolCatalog237');
const { defaultAuditLog } = require('./auditLog');

class ConnectorRuntime238 {
  constructor(opts = {}) {
    this._connectors = new Map(); // connectorId -> { id, adapter, config }
    this._vault = opts.vault || null;
    this._hitl = opts.hitl || null;
    this._confidenceGate = opts.confidenceGate || null;
    this._logger = opts.logger || { info: () => {}, warn: () => {}, error: () => {} };
  }

  /**
   * Register a new connector.
   * @param {string} id - Unique connector ID
   * @param {object} adapter - The adapter (e.g. McpAdapter238)
   * @param {object} [config] - Optional static configuration
   */
  registerConnector238(id, adapter, config = {}) {
    if (!id || typeof id !== 'string') throw new Error('ConnectorRuntime238: id required');
    if (!adapter || typeof adapter.listTools !== 'function' || typeof adapter.callTool !== 'function') {
      throw new Error('ConnectorRuntime238: adapter must implement listTools and callTool');
    }
    this._connectors.set(id, { id, adapter, config });
    this._logger.info({ connectorId: id }, '[V238] connector registered');
  }

  /**
   * Sync connector tools into the ToolCatalog237.
   * @param {string} connectorId
   * @param {string} userId - For credential retrieval during listing if needed
   */
  async syncTools238(connectorId, userId) {
    const conn = this._connectors.get(connectorId);
    if (!conn) throw new Error(`ConnectorRuntime238: connector ${connectorId} not found`);

    const creds = this._vault ? this._vault.getSecret(userId, connectorId) : null;
    const tools = await conn.adapter.listTools(conn.config, creds);

    for (const t of tools) {
      // Register into catalog so they are discoverable
      // Note: We don't pass a 'fn' here because execution goes through callTool238
      defaultCatalog237.registerTool237({
        name: t.name,
        description: t.description,
        server: connectorId,
        input_schema: t.input_schema,
        cost: t.cost || 0
      });
    }

    this._logger.info({ connectorId, count: tools.length }, '[V238] tools synced to catalog');
    return tools;
  }

  /**
   * Execute a tool call with HITL/Audit/Vault integration.
   * @param {object} params
   * @param {string} params.connectorId
   * @param {string} params.toolName
   * @param {object} params.args
   * @param {string} params.userId
   * @param {string} [params.missionId]
   * @param {string} [params.clientAccountId]
   * @param {number} [params.priceUsd]
   */
  async callTool238(params) {
    const { connectorId, toolName, args, userId, missionId, clientAccountId, priceUsd = 0 } = params;
    const conn = this._connectors.get(connectorId);
    if (!conn) throw new Error(`ConnectorRuntime238: connector ${connectorId} not found`);

    const toolDef = defaultCatalog237.getTool237(toolName);
    if (!toolDef) throw new Error(`ConnectorRuntime238: tool ${toolName} not found in catalog`);

    // Redaction check: Ensure no secrets in audit
    const auditParams = {
      connectorId,
      toolName,
      userId,
      missionId,
      argsKeys: Object.keys(args || {})
    };

    // 1. Dangerous Tool Check (delete/send/spend)
    const isDangerous = /delete|remove|send|spend|pay|transfer/i.test(toolName) || 
                       /delete|remove|send|spend|pay|transfer/i.test(toolDef.description);

    if (isDangerous && this._hitl && this._confidenceGate) {
      // Route through HITL
      const gateResult = this._confidenceGate({
        clientAccountId: clientAccountId || 'system_internal',
        priceUsd: priceUsd,
        aiOutput: { connectorId, toolName, args },
        context: { userId, missionId, toolName, isDangerous: true },
        confidence: 0.5, // Force HITL review for dangerous tools
        taskType: 'connector_call'
      });

      if (gateResult.verdict === 'HITL_QUEUE') {
        const approval = this._hitl.createApproval(gateResult.sanitized);
        defaultAuditLog.append('CONNECTOR_CALL_QUEUED', { ...auditParams, approvalId: approval.id });
        return { status: 'QUEUED', approvalId: approval.id };
      }
    }

    // 2. Execution (Auto-flow)
    const creds = this._vault ? this._vault.getSecret(userId, connectorId) : null;
    
    try {
      const result = await conn.adapter.callTool(conn.config, toolName, args, creds);
      
      defaultAuditLog.append('CONNECTOR_CALL_COMPLETED', { 
        ...auditParams, 
        success: true,
        resultKeys: Object.keys(result || {}) 
      });

      return { status: 'COMPLETED', result };
    } catch (err) {
      defaultAuditLog.append('CONNECTOR_CALL_FAILED', { 
        ...auditParams, 
        success: false, 
        error: err.message 
      });
      throw err;
    }
  }
}

module.exports = { ConnectorRuntime238 };
