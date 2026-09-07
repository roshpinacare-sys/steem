'use strict';
/**
 * Tests for lib/agentBus.js — V107 / V108
 * P5-03: Agent Communication Protocol
 *
 * [V108] Handler delivery is now async (setImmediate).
 * Tests that assert on handler side-effects must await yieldMicrotask().
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { AgentBus, CHANNEL_TYPES } = await import('../lib/agentBus.js');

// [V108] Helper: yield to allow setImmediate handlers to fire
const yieldMicrotask = () => new Promise(resolve => setImmediate(resolve));

// ── CHANNEL_TYPES ─────────────────────────────────────────────────────────────

describe('CHANNEL_TYPES', () => {
  it('exports expected channel names', () => {
    expect(CHANNEL_TYPES.CONTEXT).toBe('context');
    expect(CHANNEL_TYPES.RESULT).toBe('result');
    expect(CHANNEL_TYPES.ERROR).toBe('error');
    expect(CHANNEL_TYPES.CONTROL).toBe('control');
    expect(CHANNEL_TYPES.MEMORY).toBe('memory');
    expect(CHANNEL_TYPES.AUDIT).toBe('audit');
  });

  it('is frozen', () => {
    expect(() => { CHANNEL_TYPES.CUSTOM = 'x'; }).toThrow();
  });
});

// ── AgentBus.publish ──────────────────────────────────────────────────────────

describe('AgentBus.publish', () => {
  let bus;
  beforeEach(() => { bus = new AgentBus(); });

  it('throws without channel', () => {
    expect(() => bus.publish({ from: 'agent::a', payload: {} })).toThrow(/channel/);
  });

  it('throws without from', () => {
    expect(() => bus.publish({ channel: 'context', payload: {} })).toThrow(/from/);
  });

  it('returns a frozen message with messageId and ts', () => {
    const msg = bus.publish({ channel: 'context', from: 'agent::planner', payload: { step: 1 } });
    expect(msg.messageId).toMatch(/^msg::/);
    expect(msg.ts).toBeTruthy();
    expect(msg.channel).toBe('context');
    expect(msg.from).toBe('agent::planner');
    expect(msg.payload).toEqual({ step: 1 });
  });

  it('delivers to a subscribed handler', async () => {
    const received = [];
    bus.subscribe('context', 'agent::worker', (m) => received.push(m));
    bus.publish({ channel: 'context', from: 'agent::planner', payload: { x: 1 } });
    await yieldMicrotask();
    expect(received).toHaveLength(1);
    expect(received[0].payload).toEqual({ x: 1 });
  });

  it('broadcasts to all subscribers when to=null', async () => {
    const w1 = []; const w2 = [];
    bus.subscribe('context', 'agent::w1', (m) => w1.push(m));
    bus.subscribe('context', 'agent::w2', (m) => w2.push(m));
    bus.publish({ channel: 'context', from: 'agent::planner', to: null, payload: 'broadcast' });
    await yieldMicrotask();
    expect(w1).toHaveLength(1);
    expect(w2).toHaveLength(1);
  });

  it('delivers only to targeted agent when to=agentId', async () => {
    const w1 = []; const w2 = [];
    bus.subscribe('context', 'agent::w1', (m) => w1.push(m));
    bus.subscribe('context', 'agent::w2', (m) => w2.push(m));
    bus.publish({ channel: 'context', from: 'agent::planner', to: 'agent::w1', payload: 'targeted' });
    await yieldMicrotask();
    expect(w1).toHaveLength(1);
    expect(w2).toHaveLength(0);
  });

  it('dead-letters message when no subscribers', () => {
    bus.publish({ channel: 'result', from: 'agent::worker', payload: 'orphan' });
    const dl = bus.drainDeadLetters();
    expect(dl).toHaveLength(1);
    expect(dl[0].reason).toBe('no_subscribers');
    expect(dl[0].message.payload).toBe('orphan');
  });

  it('dead-letters when targeted agent not subscribed', () => {
    bus.subscribe('context', 'agent::other', () => {});
    bus.publish({ channel: 'context', from: 'agent::planner', to: 'agent::missing', payload: 'x' });
    const dl = bus.drainDeadLetters();
    expect(dl.length).toBeGreaterThan(0);
    expect(dl[0].reason).toMatch(/no_subscriber_for_target/);
  });

  it('preserves parentId for causal chaining', () => {
    bus.subscribe('context', 'agent::w', () => {});
    const m1 = bus.publish({ channel: 'context', from: 'agent::p', payload: 'root' });
    const m2 = bus.publish({ channel: 'context', from: 'agent::p', payload: 'child', parentId: m1.messageId });
    expect(m2.parentId).toBe(m1.messageId);
  });

  it('increments stats.published on each publish', () => {
    bus.subscribe('context', 'agent::w', () => {});
    bus.publish({ channel: 'context', from: 'agent::p', payload: 'a' });
    bus.publish({ channel: 'context', from: 'agent::p', payload: 'b' });
    expect(bus.stats().published).toBe(2);
  });

  it('absorbs handler errors and dead-letters', async () => {
    bus.subscribe('context', 'agent::broken', () => { throw new Error('boom'); });
    expect(() => bus.publish({ channel: 'context', from: 'agent::p', payload: 'x' })).not.toThrow();
    await yieldMicrotask(); // wait for setImmediate handler to fire + dead-letter
    const dl = bus.drainDeadLetters();
    expect(dl.some(d => d.reason.startsWith('handler_error'))).toBe(true);
  });
});

// ── AgentBus.subscribe / unsubscribe ─────────────────────────────────────────

describe('AgentBus.subscribe / unsubscribeAll', () => {
  let bus;
  beforeEach(() => { bus = new AgentBus(); });

  it('throws on missing args', () => {
    expect(() => bus.subscribe('context', 'agent::a')).toThrow(/handler/);
  });

  it('returns an unsubscribe function', () => {
    const unsub = bus.subscribe('context', 'agent::w', () => {});
    expect(typeof unsub).toBe('function');
  });

  it('unsubscribe function stops delivery', async () => {
    const received = [];
    const unsub = bus.subscribe('context', 'agent::w', (m) => received.push(m));
    bus.publish({ channel: 'context', from: 'agent::p', payload: 1 });
    await yieldMicrotask(); // first handler fires → received = [1]
    unsub();
    bus.publish({ channel: 'context', from: 'agent::p', payload: 2 });
    await yieldMicrotask(); // unsubscribed — no second handler call
    expect(received).toHaveLength(1);
  });

  it('unsubscribeAll removes agent from specific channel', () => {
    const received = [];
    bus.subscribe('context', 'agent::w', (m) => received.push(m));
    bus.subscribe('result', 'agent::w', (m) => received.push(m));
    bus.unsubscribeAll('agent::w', 'context');
    bus.publish({ channel: 'context', from: 'agent::p', payload: 'ctx' });
    // result channel should still work
    bus.subscribe('result', 'agent::w', (m) => received.push(m));
    expect(received).toHaveLength(0); // context was removed
  });

  it('unsubscribeAll with no channel removes agent from all channels', () => {
    const received = [];
    bus.subscribe('context', 'agent::w', (m) => received.push(m));
    bus.subscribe('result', 'agent::w', (m) => received.push(m));
    bus.unsubscribeAll('agent::w');
    bus.publish({ channel: 'context', from: 'agent::p', payload: 1 });
    bus.publish({ channel: 'result', from: 'agent::p', payload: 2 });
    expect(received).toHaveLength(0);
  });

  it('supports multiple handlers per agent on same channel', async () => {
    const calls = [];
    bus.subscribe('context', 'agent::w', () => calls.push('h1'));
    bus.subscribe('context', 'agent::w', () => calls.push('h2'));
    bus.publish({ channel: 'context', from: 'agent::p', payload: 'x' });
    await yieldMicrotask();
    expect(calls).toContain('h1');
    expect(calls).toContain('h2');
  });
});

// ── AgentBus.replay ───────────────────────────────────────────────────────────

describe('AgentBus.replay', () => {
  let bus;
  beforeEach(() => { bus = new AgentBus(); });

  it('returns empty array for unknown channel', () => {
    expect(bus.replay('unknown')).toEqual([]);
  });

  it('returns ring buffer messages in order', () => {
    bus.subscribe('result', 'agent::o', () => {});
    bus.publish({ channel: 'result', from: 'agent::w', payload: 1 });
    bus.publish({ channel: 'result', from: 'agent::w', payload: 2 });
    bus.publish({ channel: 'result', from: 'agent::w', payload: 3 });
    const history = bus.replay('result');
    expect(history).toHaveLength(3);
    expect(history[0].payload).toBe(1);
    expect(history[2].payload).toBe(3);
  });

  it('respects limit parameter', () => {
    bus.subscribe('result', 'agent::o', () => {});
    for (let i = 0; i < 10; i++) {
      bus.publish({ channel: 'result', from: 'agent::w', payload: i });
    }
    const history = bus.replay('result', { limit: 3 });
    expect(history).toHaveLength(3);
    expect(history[history.length - 1].payload).toBe(9);
  });

  it('filters by from agentId', () => {
    bus.subscribe('context', 'agent::w', () => {});
    bus.publish({ channel: 'context', from: 'agent::planner', payload: 'p' });
    bus.publish({ channel: 'context', from: 'agent::orchestrator', payload: 'o' });
    const history = bus.replay('context', { from: 'agent::planner' });
    expect(history).toHaveLength(1);
    expect(history[0].payload).toBe('p');
  });

  it('stores messages even without subscribers (ring buffer always populated)', () => {
    // Dead-lettered messages still go into ring buffer
    bus.publish({ channel: 'error', from: 'agent::w', payload: 'err' });
    const history = bus.replay('error');
    expect(history).toHaveLength(1);
  });
});

// ── AgentBus.getCausalChain ───────────────────────────────────────────────────

describe('AgentBus.getCausalChain', () => {
  let bus;
  beforeEach(() => { bus = new AgentBus(); });

  it('returns empty array for unknown messageId', () => {
    expect(bus.getCausalChain('msg::unknown')).toEqual([]);
  });

  it('returns single-element chain for root message (no parentId)', () => {
    bus.subscribe('context', 'agent::w', () => {});
    const m = bus.publish({ channel: 'context', from: 'agent::p', payload: 'root' });
    const chain = bus.getCausalChain(m.messageId);
    expect(chain).toHaveLength(1);
    expect(chain[0].messageId).toBe(m.messageId);
  });

  it('follows parentId links to build causal chain', () => {
    bus.subscribe('context', 'agent::w', () => {});
    const m1 = bus.publish({ channel: 'context', from: 'agent::p', payload: 'root' });
    const m2 = bus.publish({ channel: 'context', from: 'agent::p', payload: 'child', parentId: m1.messageId });
    const m3 = bus.publish({ channel: 'context', from: 'agent::p', payload: 'grandchild', parentId: m2.messageId });

    const chain = bus.getCausalChain(m3.messageId, { depth: 10 });
    expect(chain).toHaveLength(3);
    expect(chain[0].messageId).toBe(m3.messageId);
    expect(chain[1].messageId).toBe(m2.messageId);
    expect(chain[2].messageId).toBe(m1.messageId);
  });

  it('respects depth parameter', () => {
    bus.subscribe('context', 'agent::w', () => {});
    const m1 = bus.publish({ channel: 'context', from: 'agent::p', payload: 1 });
    const m2 = bus.publish({ channel: 'context', from: 'agent::p', payload: 2, parentId: m1.messageId });
    const m3 = bus.publish({ channel: 'context', from: 'agent::p', payload: 3, parentId: m2.messageId });

    const chain = bus.getCausalChain(m3.messageId, { depth: 2 });
    expect(chain).toHaveLength(2);
  });
});

// ── AgentBus.stats ────────────────────────────────────────────────────────────

describe('AgentBus.stats', () => {
  let bus;
  beforeEach(() => { bus = new AgentBus(); });

  it('starts with zeros', () => {
    const s = bus.stats();
    expect(s.published).toBe(0);
    expect(s.delivered).toBe(0);
    expect(s.deadLettered).toBe(0);
    expect(s.channels).toEqual({});
  });

  it('reports correct channel stats after publish+subscribe', () => {
    bus.subscribe('result', 'agent::o', () => {});
    bus.publish({ channel: 'result', from: 'agent::w', payload: 1 });
    bus.publish({ channel: 'result', from: 'agent::w', payload: 2 });

    const s = bus.stats();
    expect(s.published).toBe(2);
    expect(s.delivered).toBe(2);
    expect(s.channels.result.buffered).toBe(2);
    expect(s.channels.result.subscribers).toContain('agent::o');
  });
});

// ── AgentBus ring eviction ────────────────────────────────────────────────────

describe('AgentBus ring buffer eviction', () => {
  it('evicts oldest messages when ring is full', () => {
    const bus = new AgentBus({ ringSize: 5 });
    bus.subscribe('context', 'agent::w', () => {});
    for (let i = 0; i < 10; i++) {
      bus.publish({ channel: 'context', from: 'agent::p', payload: i });
    }
    const history = bus.replay('context');
    expect(history).toHaveLength(5);
    // Last 5: payloads 5..9
    expect(history[0].payload).toBe(5);
    expect(history[4].payload).toBe(9);
  });
});

// ── Dead letter management ────────────────────────────────────────────────────

describe('AgentBus dead letter management', () => {
  it('clearDeadLetters empties the queue', () => {
    const bus = new AgentBus();
    bus.publish({ channel: 'orphan', from: 'agent::x', payload: 1 });
    bus.publish({ channel: 'orphan', from: 'agent::x', payload: 2 });
    expect(bus.drainDeadLetters().length).toBe(2);
    bus.clearDeadLetters();
    expect(bus.drainDeadLetters().length).toBe(0);
  });
});
