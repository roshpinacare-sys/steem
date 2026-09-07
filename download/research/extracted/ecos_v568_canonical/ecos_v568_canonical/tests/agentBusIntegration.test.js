'use strict';
/**
 * Tests for V108-P6-01: AgentBus × AgentRuntime Integration
 * Tests for V108-P6-03: AgentBus DB persistence methods (mock pool)
 *
 * NOTE: AgentBus handler delivery is async (setImmediate) in V108.
 * Tests must await yieldMicrotask() before asserting on handler side-effects.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { AgentRuntime, AgentDescriptor, ExecutionDAG, AGENT_TYPES, STEP_STATUS } =
  await import('../lib/agentRuntime.js');
const { AgentBus, CHANNEL_TYPES } = await import('../lib/agentBus.js');

// Helper: yield to allow setImmediate handlers to fire
const yieldMicrotask = () => new Promise(resolve => setImmediate(resolve));

// ── Shared fixtures ───────────────────────────────────────────────────────────

function makeRuntime(bus) {
  return new AgentRuntime({ bus });
}

function makeOrchestrator(runtime) {
  return runtime.registerAgent({
    agentType:   AGENT_TYPES.ORCHESTRATOR,
    name:        'test-orchestrator',
    permissions: ['invoke:infer', 'read:memory', 'write:memory', 'audit:write', 'ledger:read'],
  });
}

function makeWorker(runtime) {
  return runtime.registerAgent({
    agentType:   AGENT_TYPES.WORKER,
    name:        'test-worker',
    permissions: ['invoke:infer', 'invoke:embed', 'read:memory', 'write:memory'],
  });
}

// ── setBus ────────────────────────────────────────────────────────────────────

describe('AgentRuntime.setBus', () => {
  it('accepts a bus via constructor opts.bus', () => {
    const bus     = new AgentBus();
    const runtime = new AgentRuntime({ bus });
    expect(runtime._bus).toBe(bus);
  });

  it('accepts a bus via setBus()', () => {
    const runtime = new AgentRuntime();
    const bus     = new AgentBus();
    expect(runtime._bus).toBeNull();
    runtime.setBus(bus);
    expect(runtime._bus).toBe(bus);
  });

  it('detaches bus when setBus(null) is called', () => {
    const bus     = new AgentBus();
    const runtime = new AgentRuntime({ bus });
    runtime.setBus(null);
    expect(runtime._bus).toBeNull();
  });

  it('does not throw if no bus is wired and executePlan runs', async () => {
    const runtime = new AgentRuntime(); // no bus
    const oid     = makeOrchestrator(runtime);
    const dag     = new ExecutionDAG('plan-test');
    dag.addStep({ stepId: 's1', name: 'echo', input: { x: 1 } });
    const result = await runtime.executePlan(oid, dag);
    expect(result.status).toBe('COMPLETED');
  });
});

// ── executePlan bus event publishing ─────────────────────────────────────────

describe('AgentRuntime.executePlan — bus event publishing', () => {
  let bus, runtime, oid;
  const contextMsgs = [];
  const resultMsgs  = [];
  const errorMsgs   = [];

  beforeEach(() => {
    contextMsgs.length = 0;
    resultMsgs.length  = 0;
    errorMsgs.length   = 0;

    bus     = new AgentBus({ ringSize: 100 });
    runtime = makeRuntime(bus);
    oid     = makeOrchestrator(runtime);

    bus.subscribe(CHANNEL_TYPES.CONTEXT, 'test-listener', (msg) => contextMsgs.push(msg));
    bus.subscribe(CHANNEL_TYPES.RESULT,  'test-listener', (msg) => resultMsgs.push(msg));
    bus.subscribe(CHANNEL_TYPES.ERROR,   'test-listener', (msg) => errorMsgs.push(msg));
  });

  it('publishes context + result messages for a successful step', async () => {
    const dag = new ExecutionDAG('plan-success');
    dag.addStep({ stepId: 's1', name: 'echo-step', input: { data: 'hello' } });

    await runtime.executePlan(oid, dag);
    await yieldMicrotask();

    expect(contextMsgs).toHaveLength(1);
    expect(contextMsgs[0].channel).toBe('context');
    expect(contextMsgs[0].payload.stepId).toBe('s1');
    expect(contextMsgs[0].payload.input).toEqual({ data: 'hello' });

    expect(resultMsgs).toHaveLength(1);
    expect(resultMsgs[0].channel).toBe('result');
    expect(resultMsgs[0].payload.stepId).toBe('s1');
    // STEP_STATUS.COMPLETED = 'completed' (lowercase — from agentRuntime.js)
    expect(resultMsgs[0].payload.status).toBe('completed');
  });

  it('result message has parentId matching context messageId', async () => {
    const dag = new ExecutionDAG('plan-causality');
    dag.addStep({ stepId: 's1', name: 'step-one', input: {} });

    await runtime.executePlan(oid, dag);
    await yieldMicrotask();

    expect(contextMsgs[0].messageId).toBeTruthy();
    expect(resultMsgs[0].parentId).toBe(contextMsgs[0].messageId);
  });

  it('publishes context + error messages for a failing step', async () => {
    runtime.registerTool('fail-tool', async () => { throw new Error('deliberate failure'); });

    const dag = new ExecutionDAG('plan-fail');
    dag.addStep({ stepId: 's1', name: 'fail-step', input: {}, meta: { tool: 'fail-tool' } });

    await runtime.executePlan(oid, dag);
    await yieldMicrotask();

    expect(contextMsgs).toHaveLength(1);
    expect(errorMsgs).toHaveLength(1);
    expect(errorMsgs[0].channel).toBe('error');
    expect(errorMsgs[0].payload.error).toContain('deliberate failure');
    expect(errorMsgs[0].payload.status).toBe(STEP_STATUS.FAILED);
    expect(errorMsgs[0].parentId).toBe(contextMsgs[0].messageId);
    expect(resultMsgs).toHaveLength(0);
  });

  it('publishes context per step in a multi-step DAG', async () => {
    const dag = new ExecutionDAG('plan-multi');
    const s1  = dag.addStep({ stepId: 's1', name: 'step-a', input: { a: 1 } });
    const s2  = dag.addStep({ stepId: 's2', name: 'step-b', input: { b: 2 } });
    dag.addDependency(s2, s1);

    await runtime.executePlan(oid, dag);
    await yieldMicrotask();

    expect(contextMsgs).toHaveLength(2);
    expect(resultMsgs).toHaveLength(2);

    const stepIds = contextMsgs.map(m => m.payload.stepId);
    expect(stepIds).toContain('s1');
    expect(stepIds).toContain('s2');
  });

  it('context payload includes deps for dependent steps', async () => {
    const dag = new ExecutionDAG('plan-deps');
    const s1  = dag.addStep({ stepId: 's1', name: 'first', input: {} });
    const s2  = dag.addStep({ stepId: 's2', name: 'second', input: {} });
    dag.addDependency(s2, s1);

    await runtime.executePlan(oid, dag);
    await yieldMicrotask();

    const s2Ctx = contextMsgs.find(m => m.payload.stepId === 's2');
    expect(s2Ctx).toBeTruthy();
    expect(s2Ctx.payload.deps).toContain('s1');
  });

  it('bus failure does NOT abort the DAG run', async () => {
    const brokenBus = {
      publish: () => { throw new Error('bus is broken'); },
    };
    runtime.setBus(brokenBus);

    const dag = new ExecutionDAG('plan-bus-broken');
    dag.addStep({ stepId: 's1', name: 'resilient-step', input: {} });

    const result = await runtime.executePlan(oid, dag);
    expect(result.status).toBe('COMPLETED');
  });

  it('bus stats reflect published context + result messages', async () => {
    const dag = new ExecutionDAG('plan-stats');
    dag.addStep({ stepId: 's1', name: 'stat-step', input: {} });

    await runtime.executePlan(oid, dag);

    const stats = bus.stats();
    // context + result = 2 messages published (error = 0 since success)
    expect(stats.published).toBe(2);
  });
});

// ── invoke bus event publishing ───────────────────────────────────────────────

describe('AgentRuntime.invoke — bus event publishing', () => {
  let bus, runtime, wid;
  const contextMsgs = [];
  const resultMsgs  = [];

  beforeEach(() => {
    contextMsgs.length = 0;
    resultMsgs.length  = 0;

    bus     = new AgentBus({ ringSize: 50 });
    runtime = makeRuntime(bus);
    wid     = makeWorker(runtime);

    bus.subscribe(CHANNEL_TYPES.CONTEXT, 'obs', (m) => contextMsgs.push(m));
    bus.subscribe(CHANNEL_TYPES.RESULT,  'obs', (m) => resultMsgs.push(m));
  });

  it('publishes context + result on successful invoke', async () => {
    const { status } = await runtime.invoke(wid, { task: 'test-task', input: { q: 'hello' } });
    await yieldMicrotask();

    expect(status).toBe('COMPLETED');
    expect(contextMsgs).toHaveLength(1);
    expect(resultMsgs).toHaveLength(1);
    expect(contextMsgs[0].payload.stepName).toBe('test-task');
  });

  it('result parentId links back to context messageId', async () => {
    await runtime.invoke(wid, { task: 'link-task', input: {} });
    await yieldMicrotask();

    expect(resultMsgs[0].parentId).toBe(contextMsgs[0].messageId);
  });
});

// ── AgentBus.persistToDB — mock pool ─────────────────────────────────────────

describe('AgentBus.persistToDB (mock pool)', () => {
  it('inserts each ring message once', async () => {
    const bus = new AgentBus({ ringSize: 20 });
    bus.publish({ channel: 'context', from: 'agent::a', to: null, payload: { x: 1 } });
    bus.publish({ channel: 'result',  from: 'agent::b', to: null, payload: { y: 2 } });

    const queries = [];
    const mockPool = {
      query: (sql, params) => { queries.push({ sql, params }); return Promise.resolve({ rows: [] }); },
    };

    const result = await bus.persistToDB(mockPool);

    expect(result.persisted).toBe(2);
    expect(result.errors).toBe(0);
    expect(queries).toHaveLength(2);
    expect(queries[0].params[0]).toMatch(/^msg::/);
    expect(queries[0].params[1]).toBe('context');
  });

  it('filters by channel when opts.channel is set', async () => {
    const bus = new AgentBus({ ringSize: 20 });
    bus.publish({ channel: 'context', from: 'a', to: null, payload: {} });
    bus.publish({ channel: 'result',  from: 'b', to: null, payload: {} });
    bus.publish({ channel: 'audit',   from: 'c', to: null, payload: {} });

    const queries = [];
    const mockPool = { query: (s, p) => { queries.push(p); return Promise.resolve({ rows: [] }); } };

    const result = await bus.persistToDB(mockPool, { channel: 'audit' });
    expect(result.persisted).toBe(1);
    expect(queries[0][1]).toBe('audit');
  });

  it('throws TypeError if pool is missing', async () => {
    const bus = new AgentBus();
    await expect(bus.persistToDB(null)).rejects.toThrow('pool is required');
  });

  it('counts errors for failed inserts', async () => {
    const bus = new AgentBus();
    bus.publish({ channel: 'context', from: 'x', to: null, payload: {} });

    const failPool = {
      query: () => Promise.reject(new Error('db down')),
    };

    const result = await bus.persistToDB(failPool);
    expect(result.errors).toBe(1);
    expect(result.persisted).toBe(0);
  });
});

// ── AgentBus.loadFromDB — mock pool ──────────────────────────────────────────

describe('AgentBus.loadFromDB (mock pool)', () => {
  const fakeRow = {
    message_id:   'msg::abc123',
    channel:      'audit',
    sender_id:    'validator::alice',
    recipient_id: null,
    parent_id:    null,
    payload:      { approvalId: 'appr::x', decision: 'approve' },
    meta:         {},
    ts:           '2026-05-28T12:00:00.000Z',
  };

  it('loads rows into ring buffer and index', async () => {
    const bus      = new AgentBus();
    const mockPool = { query: () => Promise.resolve({ rows: [fakeRow] }) };

    const result = await bus.loadFromDB(mockPool);

    expect(result.loaded).toBe(1);
    expect(bus._index.has('msg::abc123')).toBe(true);
    expect(bus.replay('audit')).toHaveLength(1);
  });

  it('skips rows already present in index (dedup)', async () => {
    const bus = new AgentBus();
    // Pre-populate the index with the same messageId
    bus._index.set('msg::abc123', { messageId: 'msg::abc123', channel: 'audit' });

    const mockPool = { query: () => Promise.resolve({ rows: [fakeRow] }) };
    const result   = await bus.loadFromDB(mockPool);

    expect(result.loaded).toBe(0); // skipped, already in index
  });

  it('throws TypeError if pool is missing', async () => {
    const bus = new AgentBus();
    await expect(bus.loadFromDB(null)).rejects.toThrow('pool is required');
  });

  it('propagates DB query errors', async () => {
    const bus      = new AgentBus();
    const failPool = { query: () => Promise.reject(new Error('query failed')) };
    await expect(bus.loadFromDB(failPool)).rejects.toThrow('query failed');
  });
});

// ── AgentBus.persistDeadLettersToDB ──────────────────────────────────────────

describe('AgentBus.persistDeadLettersToDB (mock pool)', () => {
  it('inserts dead-letter entries', async () => {
    const bus = new AgentBus({ ringSize: 5 });
    // Publish with no subscribers to generate a dead letter
    bus.publish({ channel: 'context', from: 'agent::x', to: null, payload: { z: 1 } });

    expect(bus.drainDeadLetters()).toHaveLength(1);

    const queries = [];
    const mockPool = { query: (s, p) => { queries.push(p); return Promise.resolve({ rows: [] }); } };

    const result = await bus.persistDeadLettersToDB(mockPool);
    expect(result.persisted).toBe(1);
    expect(queries[0][3]).toBe('{"z":1}'); // payload serialized
  });

  it('throws TypeError if pool is missing', async () => {
    const bus = new AgentBus();
    await expect(bus.persistDeadLettersToDB(null)).rejects.toThrow('pool is required');
  });
});

// ── Non-blocking delivery guarantee ──────────────────────────────────────────

describe('AgentBus non-blocking delivery (V108)', () => {
  it('handler does not fire synchronously', () => {
    const bus     = new AgentBus();
    let   fired   = false;

    bus.subscribe('context', 'agent::sync-test', () => { fired = true; });
    bus.publish({ channel: 'context', from: 'agent::sender', to: null, payload: {} });

    // Handler not yet fired (setImmediate is pending)
    expect(fired).toBe(false);
  });

  it('handler fires after yieldMicrotask', async () => {
    const bus   = new AgentBus();
    let   fired = false;

    bus.subscribe('result', 'agent::async-test', () => { fired = true; });
    bus.publish({ channel: 'result', from: 'agent::sender', to: null, payload: {} });

    expect(fired).toBe(false);
    await yieldMicrotask();
    expect(fired).toBe(true);
  });
});
