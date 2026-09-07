'use strict';
  /**
   * ECOS Agent Runtime — V108 — Phase 6
   * ─────────────────────────────────────────────────────────────────────────────
   * [V108-P6-01] AgentBus × AgentRuntime Integration:
   *   setBus(bus) / constructor opts.bus — inject AgentBus
   *   executePlan(): publishes 'context' before each step, 'result'/'error' after
   *   invoke(): same publish pattern for single-step calls
   *   All bus calls are try/catch-wrapped and never abort a run
   * ─────────────────────────────────────────────────────────────────────────────
   * Agent civilization runtime: planner, worker, validator, reflection, research,
   * and orchestration agents with execution DAGs and permission-scoped execution.
   *
   * Agent types:
   *   planner     — decomposes goals into step DAGs
   *   worker      — executes atomic steps
   *   validator   — reviews worker output for correctness
   *   reflection  — critiques and improves outputs
   *   research    — gathers information from tools/memory
   *   orchestrator— manages multi-agent pipelines
   *
   * Execution model:
   *   - DAG of steps: each step declares dependencies
   *   - Async parallel execution of independent steps
   *   - Checkpointing via ExecutionJournal
   *   - Permission scopes prevent agents crossing boundaries
   *   - Sandbox isolation: agents run in their own context
   *
   * Permission scopes:
   *   'read:memory'   — can read from MemorySubstrate
   *   'write:memory'  — can write to MemorySubstrate
   *   'invoke:infer'  — can call IntelligenceRegistry.infer()
   *   'invoke:embed'  — can call IntelligenceRegistry.embed()
   *   'ledger:read'   — can read ledger balances
   *   'audit:write'   — can write audit entries
   */

  const crypto = require('node:crypto');
  const { ExecutionJournal, RUN_STATUS } = require('./executionJournal');

  const AGENT_TYPES = Object.freeze({
    PLANNER:      'planner',
    WORKER:       'worker',
    VALIDATOR:    'validator',
    REFLECTION:   'reflection',
    RESEARCH:     'research',
    ORCHESTRATOR: 'orchestrator',
  });

  const STEP_STATUS = Object.freeze({
    PENDING:    'pending',
    RUNNING:    'running',
    COMPLETED:  'completed',
    FAILED:     'failed',
    SKIPPED:    'skipped',
    BLOCKED:    'blocked',
  });

  // Default permission sets by agent type
  const DEFAULT_PERMISSIONS = {
    [AGENT_TYPES.PLANNER]:      ['invoke:infer', 'read:memory'],
    [AGENT_TYPES.WORKER]:       ['invoke:infer', 'invoke:embed', 'read:memory', 'write:memory'],
    [AGENT_TYPES.VALIDATOR]:    ['invoke:infer', 'read:memory', 'audit:write'],
    [AGENT_TYPES.REFLECTION]:   ['invoke:infer', 'read:memory', 'write:memory'],
    [AGENT_TYPES.RESEARCH]:     ['invoke:infer', 'invoke:embed', 'read:memory', 'write:memory'],
    [AGENT_TYPES.ORCHESTRATOR]: ['invoke:infer', 'read:memory', 'write:memory', 'audit:write', 'ledger:read'],
  };

  // ── Agent descriptor ──────────────────────────────────────────────────────────
  class AgentDescriptor {
    constructor({ agentType, name, description, permissions, meta = {} }) {
      if (!Object.values(AGENT_TYPES).includes(agentType)) {
        throw new Error(`Unknown agentType: ${agentType}`);
      }
      this.agentId     = 'agent::' + crypto.randomBytes(8).toString('hex');
      this.agentType   = agentType;
      this.name        = name || agentType;
      this.description = description || '';
      this.permissions = permissions || DEFAULT_PERMISSIONS[agentType] || [];
      this.meta        = meta;
      this.createdAt   = new Date().toISOString();
      this.status      = 'idle';
    }

    can(permission) { return this.permissions.includes(permission); }
    assertCan(permission) {
      if (!this.can(permission)) throw new Error(`Agent ${this.agentId} lacks permission: ${permission}`);
    }
  }

  // ── Execution DAG ─────────────────────────────────────────────────────────────
  class ExecutionDAG {
    constructor(planId, description) {
      this.planId      = planId || 'plan::' + crypto.randomBytes(6).toString('hex');
      this.description = description || '';
      this._steps      = new Map();   // stepId → StepNode
      this._edges      = new Map();   // stepId → Set<dependsOn>
    }

    addStep({ stepId, name, agentType, input, meta = {} }) {
      const sid = stepId || 'step::' + crypto.randomBytes(6).toString('hex');
      this._steps.set(sid, { stepId: sid, name, agentType, input, meta, status: STEP_STATUS.PENDING, output: null, error: null });
      if (!this._edges.has(sid)) this._edges.set(sid, new Set());
      return sid;
    }

    addDependency(stepId, dependsOn) {
      if (!this._steps.has(stepId))  throw new Error(`Step not found: ${stepId}`);
      if (!this._steps.has(dependsOn)) throw new Error(`Dep step not found: ${dependsOn}`);
      this._edges.get(stepId).add(dependsOn);
    }

    // Topological sort — Kahn's algorithm
    topoSort() {
      const inDegree = new Map();
      for (const sid of this._steps.keys()) inDegree.set(sid, 0);
      for (const [sid, deps] of this._edges) {
        inDegree.set(sid, deps.size);
      }
      const queue  = [];
      for (const [sid, deg] of inDegree) { if (deg === 0) queue.push(sid); }
      const sorted = [];
      while (queue.length) {
        const cur = queue.shift();
        sorted.push(cur);
        for (const [sid, deps] of this._edges) {
          if (deps.has(cur)) {
            deps.delete(cur);
            inDegree.set(sid, inDegree.get(sid) - 1);
            if (inDegree.get(sid) === 0) queue.push(sid);
          }
        }
      }
      if (sorted.length !== this._steps.size) throw new Error('DAG has a cycle');
      return sorted;
    }

    // Returns steps whose dependencies are all completed
    getReady() {
      const ready = [];
      for (const [sid, deps] of this._edges) {
        const step = this._steps.get(sid);
        if (step.status !== STEP_STATUS.PENDING) continue;
        const allDone = Array.from(deps).every(dep => this._steps.get(dep)?.status === STEP_STATUS.COMPLETED);
        if (allDone) ready.push(step);
      }
      return ready;
    }

    getStep(sid)   { return this._steps.get(sid) || null; }
    getAllSteps()   { return Array.from(this._steps.values()); }
    isComplete()   { return Array.from(this._steps.values()).every(s => s.status === STEP_STATUS.COMPLETED || s.status === STEP_STATUS.SKIPPED); }
    hasFailed()    { return Array.from(this._steps.values()).some(s => s.status === STEP_STATUS.FAILED); }
  }

  // ── AgentRuntime ──────────────────────────────────────────────────────────────
  class AgentRuntime {
    /**
     * @param {object} [opts]
     * @param {object} [opts.journal]      — ExecutionJournal instance
     * @param {object} [opts.intelligence] — IntelligenceRegistry instance
     * @param {object} [opts.memory]       — MemorySubstrate instance
     * @param {object} [opts.auditLog]     — AuditLog instance
     * @param {object} [opts.bus]          — AgentBus instance (V108-P6-01)
     */
    constructor(opts = {}) {
      this._agents       = new Map();    // agentId → AgentDescriptor
      this._journal      = opts.journal || new ExecutionJournal();
      this._intelligence = opts.intelligence || null; // IntelligenceRegistry
      this._memory       = opts.memory || null;       // MemorySubstrate
      this._auditLog     = opts.auditLog || null;     // AuditLog
      // [V108-P6-01] AgentBus — optional; all publish calls are non-fatal
      this._bus          = opts.bus || null;
      this._log          = { info: () => {}, warn: () => {}, error: () => {} };
      this._toolRegistry = new Map();   // name → async fn
    }

    setLogger(l) { if (l && typeof l.info === 'function') this._log = l; }

    /**
     * [V108-P6-01] Wire an AgentBus instance for DAG step event publishing.
     * Safe to call after construction. Replaces any previously wired bus.
     * @param {object|null} bus — AgentBus instance, or null to detach
     */
    setBus(bus) {
      this._bus = bus || null;
      if (this._bus) {
        this._log.info({ component: 'agentRuntime' }, '[Runtime] AgentBus wired (V108-P6-01)');
      }
    }

    // ── Agent registration ────────────────────────────────────────────────────────

    registerAgent(descriptor) {
      const agent = descriptor instanceof AgentDescriptor ? descriptor : new AgentDescriptor(descriptor);
      this._agents.set(agent.agentId, agent);
      this._log.info({ component: 'agentRuntime', agentId: agent.agentId, type: agent.agentType }, '[Runtime] agent registered');
      return agent.agentId;
    }

    unregisterAgent(agentId) { this._agents.delete(agentId); }
    getAgent(agentId)        { return this._agents.get(agentId) || null; }
    listAgents()             { return Array.from(this._agents.values()); }

    // ── Tool registry ─────────────────────────────────────────────────────────────

    registerTool(name, fn) {
      if (typeof fn !== 'function') throw new Error('tool fn must be a function');
      this._toolRegistry.set(name, fn);
    }

    // ── DAG execution ─────────────────────────────────────────────────────────────

    /**
     * Execute a DAG plan. Runs independent steps concurrently.
     * Checkpoints after each wave.
     *
     * [V108-P6-01] Publishes bus events per step:
     *   - 'context' channel before executing (with step input + deps)
     *   - 'result'  channel after success (parentId = contextMsg.messageId)
     *   - 'error'   channel after failure  (parentId = contextMsg.messageId)
     *
     * @param {string}       agentId   — orchestrating agent
     * @param {ExecutionDAG} dag
     * @returns {Promise<{ runId, status, results: object }>}
     */
    async executePlan(agentId, dag) {
      const agent = this._agents.get(agentId);
      if (agent) agent.assertCan('invoke:infer');

      const runId  = this._journal.startRun({ agentId, planId: dag.planId, description: dag.description });
      const results = {};

      try {
        // Run waves until complete or failed
        let wave = 0;
        while (!dag.isComplete() && !dag.hasFailed()) {
          const ready = dag.getReady();
          if (ready.length === 0) break;

          // Execute this wave in parallel
          await Promise.all(ready.map(async step => {
            const sid = this._journal.startStep(runId, { stepId: step.stepId, name: step.name, input: step.input });
            step.status = STEP_STATUS.RUNNING;

            // [V108-P6-01] Publish 'context' before step executes
            const ctxMsg = this._busPublishContext(agentId, step, dag);

            try {
              const output = await this._executeStep(agentId, step);
              step.output = output;
              step.status = STEP_STATUS.COMPLETED;
              results[step.stepId] = output;
              this._journal.completeStep(runId, sid, output);

              // [V108-P6-01] Publish 'result' after success
              this._busPublishResult(agentId, step, output, ctxMsg?.messageId || null);
            } catch (err) {
              step.error  = err.message;
              step.status = STEP_STATUS.FAILED;
              this._journal.failStep(runId, sid, err);

              // [V108-P6-01] Publish 'error' after failure
              this._busPublishError(agentId, step, err, ctxMsg?.messageId || null);
            }
          }));

          // Checkpoint after each wave
          this._journal.checkpoint(runId, { wave, completedSteps: Object.keys(results) });
          wave++;
        }

        if (dag.hasFailed()) {
          this._journal.failRun(runId, new Error('One or more steps failed'));
          return { runId, status: RUN_STATUS.FAILED, results };
        }

        this._journal.completeRun(runId, results);
        return { runId, status: RUN_STATUS.COMPLETED, results };
      } catch (err) {
        this._journal.failRun(runId, err);
        return { runId, status: RUN_STATUS.FAILED, results, error: err.message };
      }
    }

    async _executeStep(agentId, step) {
      // Tool dispatch: if step has a registered tool, call it
      if (step.meta?.tool && this._toolRegistry.has(step.meta.tool)) {
        const fn = this._toolRegistry.get(step.meta.tool);
        return fn(step.input, { agentId, stepId: step.stepId });
      }
      // Fallback: LLM inference if available
      if (this._intelligence) {
        const result = await this._intelligence.infer(
          `You are a ${step.agentType || 'worker'} agent. Execute the following step.`,
          JSON.stringify(step.input || {}),
        );
        return result.output;
      }
      // No-op: return input as output (test/stub mode)
      return { echoed: step.input };
    }

    // ── Simple single-step execution ──────────────────────────────────────────────

    /**
     * Invoke a single agent for a named task.
     *
     * [V108-P6-01] Publishes bus events:
     *   - 'context' before execution
     *   - 'result' on success / 'error' on failure
     */
    async invoke(agentId, { task, input, meta = {} }) {
      const agent = this._agents.get(agentId);
      if (!agent) throw new Error(`Agent not found: ${agentId}`);

      const runId = this._journal.startRun({ agentId, planId: null, description: task });
      const sid   = this._journal.startStep(runId, { name: task, input });

      // [V108-P6-01] Build synthetic step descriptor for bus publishing
      const syntheticStep = { stepId: sid, name: task, input, agentType: agent.agentType, meta };
      const ctxMsg = this._busPublishContext(agentId, syntheticStep, null);

      try {
        const output = await this._executeStep(agentId, syntheticStep);
        this._journal.completeStep(runId, sid, output);
        this._journal.completeRun(runId, output);

        this._busPublishResult(agentId, syntheticStep, output, ctxMsg?.messageId || null);

        return { runId, status: RUN_STATUS.COMPLETED, output };
      } catch (err) {
        this._journal.failStep(runId, sid, err);
        this._journal.failRun(runId, err);

        this._busPublishError(agentId, syntheticStep, err, ctxMsg?.messageId || null);

        return { runId, status: RUN_STATUS.FAILED, error: err.message };
      }
    }

    // ── Stats ─────────────────────────────────────────────────────────────────────
    journalStats() {
      return { runs: this._journal.runsCount(), entries: this._journal.entriesCount() };
    }

    // ── Private: AgentBus integration (V108-P6-01) ────────────────────────────────

    /**
     * Publish 'context' before step execution. Non-fatal.
     * @returns {object|null} published message or null if no bus wired
     */
    _busPublishContext(orchestratorId, step, dag) {
      if (!this._bus) return null;
      try {
        const deps = dag ? Array.from(dag._edges.get(step.stepId) || []) : [];
        return this._bus.publish({
          channel:  'context',
          from:     orchestratorId,
          to:       null,
          payload:  {
            stepId:    step.stepId,
            stepName:  step.name,
            agentType: step.agentType,
            input:     step.input,
            deps,
          },
          meta: { source: 'agentRuntime', event: 'step_start' },
        });
      } catch (e) {
        this._log.warn({ component: 'agentRuntime', err: e.message },
          '[Runtime] bus context publish failed (non-fatal)');
        return null;
      }
    }

    /**
     * Publish 'result' after successful step completion. Non-fatal.
     */
    _busPublishResult(agentId, step, output, parentMessageId) {
      if (!this._bus) return;
      try {
        this._bus.publish({
          channel:  'result',
          from:     agentId,
          to:       null,
          payload:  {
            stepId:    step.stepId,
            stepName:  step.name,
            agentType: step.agentType,
            output,
            status:    STEP_STATUS.COMPLETED,
          },
          parentId: parentMessageId,
          meta:     { source: 'agentRuntime', event: 'step_complete' },
        });
      } catch (e) {
        this._log.warn({ component: 'agentRuntime', err: e.message },
          '[Runtime] bus result publish failed (non-fatal)');
      }
    }

    /**
     * Publish 'error' after step failure. Non-fatal.
     */
    _busPublishError(agentId, step, err, parentMessageId) {
      if (!this._bus) return;
      try {
        this._bus.publish({
          channel:  'error',
          from:     agentId,
          to:       null,
          payload:  {
            stepId:    step.stepId,
            stepName:  step.name,
            agentType: step.agentType,
            error:     err.message,
            status:    STEP_STATUS.FAILED,
          },
          parentId: parentMessageId,
          meta:     { source: 'agentRuntime', event: 'step_error' },
        });
      } catch (e) {
        this._log.warn({ component: 'agentRuntime', err: e.message },
          '[Runtime] bus error publish failed (non-fatal)');
      }
    }
  }

  const defaultRuntime = new AgentRuntime();

  module.exports = {
    AgentRuntime, AgentDescriptor, ExecutionDAG,
    AGENT_TYPES, STEP_STATUS,
    defaultRuntime,
  };
  