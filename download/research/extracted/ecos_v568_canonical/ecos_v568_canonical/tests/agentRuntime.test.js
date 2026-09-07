/**
   * ECOS Agent Runtime Tests — V104
   * 11 tests: AgentDescriptor, ExecutionDAG, AgentRuntime invoke/executePlan
   */
  import { describe, it, expect } from 'vitest';
  import { createRequire } from 'module';
  const require = createRequire(import.meta.url);

  describe('AgentRuntime — V104', () => {
    const { AgentRuntime, AgentDescriptor, ExecutionDAG, AGENT_TYPES, STEP_STATUS } = require('../lib/agentRuntime');
    const { RUN_STATUS } = require('../lib/executionJournal');

    it('AgentDescriptor() throws on unknown agentType', () => {
      expect(() => new AgentDescriptor({ agentType: 'unknown' })).toThrow('Unknown agentType');
    });

    it('AgentDescriptor() creates valid agent', () => {
      const a = new AgentDescriptor({ agentType: AGENT_TYPES.WORKER, name: 'test-worker' });
      expect(a.agentId).toMatch(/^agent::/);
      expect(a.agentType).toBe(AGENT_TYPES.WORKER);
      expect(a.name).toBe('test-worker');
      expect(a.can('invoke:infer')).toBe(true);
    });

    it('AgentDescriptor.assertCan() throws on missing permission', () => {
      const a = new AgentDescriptor({ agentType: AGENT_TYPES.WORKER, permissions: ['read:memory'] });
      expect(() => a.assertCan('invoke:infer')).toThrow('lacks permission');
    });

    it('ExecutionDAG.addStep() + getReady() returns first step', () => {
      const dag = new ExecutionDAG('plan1');
      const sid = dag.addStep({ name: 'step1', agentType: AGENT_TYPES.WORKER, input: { x: 1 } });
      expect(dag.getReady().length).toBe(1);
      expect(dag.getReady()[0].stepId).toBe(sid);
    });

    it('ExecutionDAG.addDependency() blocks dependent step', () => {
      const dag = new ExecutionDAG();
      const s1 = dag.addStep({ name: 'A', agentType: AGENT_TYPES.WORKER });
      const s2 = dag.addStep({ name: 'B', agentType: AGENT_TYPES.WORKER });
      dag.addDependency(s2, s1);
      const ready = dag.getReady().map(s => s.stepId);
      expect(ready).toContain(s1);
      expect(ready).not.toContain(s2);
    });

    it('ExecutionDAG.topoSort() returns correct order', () => {
      const dag = new ExecutionDAG();
      const s1 = dag.addStep({ name: 'A', agentType: AGENT_TYPES.PLANNER });
      const s2 = dag.addStep({ name: 'B', agentType: AGENT_TYPES.WORKER });
      const s3 = dag.addStep({ name: 'C', agentType: AGENT_TYPES.VALIDATOR });
      dag.addDependency(s2, s1);
      dag.addDependency(s3, s2);
      const sorted = dag.topoSort();
      expect(sorted.indexOf(s1)).toBeLessThan(sorted.indexOf(s2));
      expect(sorted.indexOf(s2)).toBeLessThan(sorted.indexOf(s3));
    });

    it('registerAgent() + getAgent() round-trip', () => {
      const rt = new AgentRuntime();
      const id = rt.registerAgent({ agentType: AGENT_TYPES.ORCHESTRATOR, name: 'orch' });
      expect(id).toMatch(/^agent::/);
      expect(rt.getAgent(id)).not.toBeNull();
      expect(rt.getAgent(id).agentType).toBe(AGENT_TYPES.ORCHESTRATOR);
    });

    it('invoke() returns COMPLETED status with no intelligence wired', async () => {
      const rt  = new AgentRuntime();
      const id  = rt.registerAgent({ agentType: AGENT_TYPES.WORKER });
      const res = await rt.invoke(id, { task: 'compute', input: { x: 42 } });
      expect(res.status).toBe(RUN_STATUS.COMPLETED);
      expect(res.output).toBeDefined();
    });

    it('invoke() throws when agentId unknown', async () => {
      const rt = new AgentRuntime();
      await expect(rt.invoke('agent::none', { task: 'x' })).rejects.toThrow('Agent not found');
    });

    it('executePlan() runs single-step DAG successfully', async () => {
      const rt  = new AgentRuntime();
      rt.registerTool('echo', async (input) => ({ echoed: input }));
      const agId = rt.registerAgent({ agentType: AGENT_TYPES.ORCHESTRATOR });
      const dag  = new ExecutionDAG('test-plan');
      dag.addStep({ name: 'echo-step', agentType: AGENT_TYPES.WORKER, input: { msg: 'hi' }, meta: { tool: 'echo' } });
      const res = await rt.executePlan(agId, dag);
      expect(res.status).toBe(RUN_STATUS.COMPLETED);
      expect(Object.keys(res.results).length).toBe(1);
    });

    it('journalStats() reflects completed runs', async () => {
      const rt  = new AgentRuntime();
      const id  = rt.registerAgent({ agentType: AGENT_TYPES.WORKER });
      await rt.invoke(id, { task: 't1' });
      await rt.invoke(id, { task: 't2' });
      const stats = rt.journalStats();
      expect(stats.runs).toBeGreaterThanOrEqual(2);
      expect(stats.entries).toBeGreaterThan(0);
    });
  });
  