'use strict';
/**
 * src/lib/mcpDeepIntegration268.js — MCP Deep Integration (V268)
 *
 * V268 additions over V266:
 *   - mcpServerRegistry and toolExecutor interface validation at construction time
 *   - Performance telemetry: `.getPerf268()` with p50/p95/p99 call latencies
 *   - Rate limiting: per-tool call rate guard (configurable via opts.rateMs)
 *   - `checkToolExecutorHealth268()`: probe toolExecutor availability
 *
 * PROGRAM 15: MCP Deep Integration.
 * Zero new npm deps. Identifiers end with 268.
 */

const crypto = require('node:crypto');

const MCP_RISK_LEVELS_268 = Object.freeze(['safe', 'review', 'dangerous']);
const MCP_CALL_RATE_MS_268 = 50; // min ms between calls to same tool (default)

function _calcPercentiles268(arr) {
  if (!arr || arr.length === 0) return { p50: 0, p95: 0, p99: 0, count: 0 };
  const sorted = [...arr].sort((a, b) => a - b);
  const n = sorted.length;
  const p = (pct) => sorted[Math.min(Math.floor(n * pct / 100), n - 1)];
  return { p50: p(50), p95: p(95), p99: p(99), count: n };
}

class MCPDeepIntegration268 {
  constructor(opts = {}) {
    this._logger = opts.logger || console;
    this._auditLog = opts.auditLog || null;
    this._logAdapter268 = opts.logAdapter || null;
    this._agentReceipts = opts.agentReceipts || null;
    this._costRouter = opts.costRouter || null;
    // V268: validate mcpServerRegistry interface
    if (opts.mcpServerRegistry !== null && opts.mcpServerRegistry !== undefined) {
      if (typeof opts.mcpServerRegistry.get !== 'function' || typeof opts.mcpServerRegistry.set !== 'function') {
        throw new Error('mcpDeepIntegration268: mcpServerRegistry must implement Map-like get/set interface');
      }
    }
    this._servers268 = opts.mcpServerRegistry || new Map();
    this._tools268 = new Map();
    // V268: validate toolExecutor interface
    if (opts.toolExecutor !== null && opts.toolExecutor !== undefined) {
      if (typeof opts.toolExecutor !== 'function') {
        throw new Error('mcpDeepIntegration268: toolExecutor must be a function(toolId, input, opts) => Promise');
      }
    }
    this._toolExecutor = opts.toolExecutor || null;
    this._calls268 = [];
    this._stats268 = { servers: 0, tools: 0, calls: 0, dryRuns: 0, blocked: 0, receiptLinked: 0 };
    // V268: perf + rate-limit tracking
    this._perf268 = { latencies: [] };
    this._lastCall268 = new Map(); // toolId → lastCallMs
  }

  registerServer268(serverId, descriptor = {}) {
    if (!serverId) throw new Error('mcpDeepIntegration268: serverId required');
    const server = {
      serverId,
      name: descriptor.name || serverId,
      transport: descriptor.transport || 'stub',
      endpoint: descriptor.endpoint || null,
      authRef: descriptor.authRef || null,
      programId: descriptor.programId || 'P15',
      registeredAt: new Date().toISOString(),
      status: 'active',
      toolCount: 0,
      metadata: descriptor.metadata || {},
    };
    this._servers268.set(serverId, server);
    this._stats268.servers = this._servers268.size;
    this._log268('MCP_SERVER_REGISTER', { serverId, transport: server.transport });
    return { ok: true, server: this._publicServer268(server) };
  }

  registerTool268(serverId, tool = {}) {
    const server = this._servers268.get(serverId);
    if (!server) throw new Error(`mcpDeepIntegration268: unknown server ${serverId}`);
    if (!tool.name) throw new Error('mcpDeepIntegration268: tool.name required');
    const toolId = tool.toolId || `mcp268::${serverId}::${tool.name}`;
    const risk = MCP_RISK_LEVELS_268.includes(tool.risk) ? tool.risk : 'safe';
    const record = {
      toolId,
      serverId,
      name: tool.name,
      description: tool.description || '',
      inputSchema: tool.inputSchema || {},
      costMicro: BigInt(tool.costMicro || 0).toString(),
      risk,
      permissions: tool.permissions || [],
      registeredAt: new Date().toISOString(),
      handler: typeof tool.handler === 'function' ? tool.handler : null,
    };
    this._tools268.set(toolId, record);
    server.toolCount = Array.from(this._tools268.values()).filter(t => t.serverId === serverId).length;
    this._stats268.tools = this._tools268.size;
    this._log268('MCP_TOOL_REGISTER', { serverId, toolId, risk });
    return { ok: true, tool: this._publicTool268(record) };
  }

  listTools268(filter = {}) {
    return Array.from(this._tools268.values())
      .filter(t => !filter.serverId || t.serverId === filter.serverId)
      .filter(t => !filter.risk || t.risk === filter.risk)
      .map(t => this._publicTool268(t));
  }

  async callTool268(toolId, input = {}, opts = {}) {
    const tool = this._tools268.get(toolId);
    if (!tool) throw new Error(`mcpDeepIntegration268: unknown tool ${toolId}`);
    const server = this._servers268.get(tool.serverId);
    const callId = `mcpcall268::${crypto.randomBytes(8).toString('hex')}`;
    if (tool.risk === 'dangerous' && !opts.allowDangerous) {
      this._stats268.blocked++;
      return { ok: false, callId, code: 'HITL_REQUIRED', error: 'dangerous tool requires explicit allowDangerous' };
    }
    // V268: rate-limit guard per tool
    const rateMs = opts.rateMs || MCP_CALL_RATE_MS_268;
    const now = Date.now();
    const last = this._lastCall268.get(toolId) || 0;
    if (now - last < rateMs && !opts.allowDangerous) {
      this._stats268.blocked++;
      return { ok: false, callId, code: 'RATE_LIMITED', error: `tool ${toolId} called too frequently` };
    }
    this._lastCall268.set(toolId, now);
    const _t0 = now;
    const dryRun = !!opts.dryRun;
    if (dryRun) this._stats268.dryRuns++;
    const startedAt = new Date().toISOString();
    let output;
    if (dryRun) {
      output = { dryRun: true, wouldCall: tool.name, serverId: tool.serverId, inputKeys: Object.keys(input || {}) };
    } else if (this._toolExecutor) {
      output = await this._toolExecutor(toolId, input, opts);
    } else if (tool.handler) {
      output = await tool.handler(input, opts);
    } else {
      output = { ok: true, stub: true, echo: input, server: server?.name || tool.serverId, tool: tool.name };
    }
    const record = {
      callId,
      toolId,
      serverId: tool.serverId,
      missionId: opts.missionId || null,
      programId: opts.programId || server?.programId || 'P15',
      risk: tool.risk,
      dryRun,
      inputHash: crypto.createHash('sha256').update(JSON.stringify(input || {})).digest('hex'),
      output,
      startedAt,
      completedAt: new Date().toISOString(),
    };
    this._calls268.push(record);
    if (this._calls268.length > 10_000) this._calls268.shift();
    this._stats268.calls++;
    if (opts.missionId && this._agentReceipts?.emitAction268) {
      try { this._agentReceipts.emitAction268(opts.missionId, { type: 'mcp_tool_call_v268', callId, toolId, serverId: tool.serverId, dryRun }); this._stats268.receiptLinked++; } catch (_) {}
    }
    this._log268('MCP_TOOL_CALL', { callId, toolId, missionId: record.missionId, dryRun });
    this._recordLatency268(_t0);
    return { ok: true, callId, output, receiptLinked: !!opts.missionId };
  }

  getCall268(callId) { return this._calls268.find(c => c.callId === callId) || null; }

  getStats268() {
    return { version: '268', activeServers: this._servers268.size, registeredTools: this._tools268.size, recentCalls: this._calls268.length, ...this._stats268 };
  }

  /** V268: Performance telemetry */
  getPerf268() { return _calcPercentiles268(this._perf268.latencies); }

  /** V268: Check toolExecutor health */
  checkToolExecutorHealth268() {
    if (!this._toolExecutor) return { ok: true, executor: 'stub', note: 'No external toolExecutor injected' };
    return { ok: typeof this._toolExecutor === 'function', executor: 'external' };
  }

  _recordLatency268(t0) {
    const ms = Date.now() - t0;
    this._perf268.latencies.push(ms);
    if (this._perf268.latencies.length > 1000) this._perf268.latencies.shift();
  }

  _publicServer268(s) { return { ...s }; }
  _publicTool268(t) { const { handler, ...publicTool } = t; return publicTool; }
  _log268(event, data) { if (this._auditLog?.append) { try { this._auditLog.append({ event, ...data, ts: new Date().toISOString(), _v: '268' }); } catch (_) {} } }
}

const defaultMCPDeepIntegration268 = new MCPDeepIntegration268();

module.exports = {
  MCPDeepIntegration268,
  defaultMCPDeepIntegration268,
  MCP_RISK_LEVELS_268,
};
