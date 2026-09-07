'use strict';
/**
 * ECOS Agent Communication Bus — V108
 * [V108-P6-03] DB Persistence: persistToDB(), loadFromDB(), persistDeadLettersToDB()
 * [V108-P6-01] Non-blocking delivery via setImmediate (handlers fire after call stack)
 *
 * BREAKING CHANGE from V107: handler delivery is now async (setImmediate).
 * In tests, await new Promise(resolve => setImmediate(resolve)) before asserting
 * on handler side-effects.
 *
 * Original V107 design:
 * ──────────────────────────────────────────────────────────────────────────────
 * Inter-agent pub/sub messaging bus for AgentRuntime-based pipelines.
 *
 * Design:
 *   - In-process EventEmitter-based pub/sub (no external broker dep)
 *   - Typed channels: 'context', 'result', 'error', 'control'
 *   - Message tracing: every publish gets a unique messageId + causal parentId
 *   - Ring buffer for replay: last N messages per channel (configurable)
 *   - Dead-letter queue for undelivered messages
 *   - Agent isolation: agents can only send on their own agentId channel
 *     (unless granted 'bus:broadcast' permission)
 *   - Provenance: each message records sender, recipients, and timestamps
 *
 * Usage (P5-03):
 *   const { AgentBus, defaultBus } = require('./agentBus');
 *
 *   // Subscribe an agent to a channel
 *   defaultBus.subscribe('result', 'agent::worker_1', (msg) => {
 *     console.log(msg.payload);
 *   });
 *
 *   // Publish from planner to workers
 *   defaultBus.publish({
 *     channel:  'context',
 *     from:     'agent::planner_1',
 *     to:       'agent::worker_1',   // null = broadcast
 *     payload:  { planStep: 1, input: '...' },
 *     parentId: null,
 *   });
 *
 *   // Replay recent messages on a channel
 *   const history = defaultBus.replay('context', { limit: 20 });
 */

const crypto = require('node:crypto');

const CHANNEL_TYPES = Object.freeze({
  CONTEXT: 'context',   // planner → workers: task context
  RESULT:  'result',    // workers → orchestrator: step results
  ERROR:   'error',     // any → orchestrator: step errors
  CONTROL: 'control',   // orchestrator → any: pause/resume/cancel signals
  MEMORY:  'memory',    // research → workers: retrieved memory context
  AUDIT:   'audit',     // validator → orchestrator: audit events
});

class AgentBus {
  /**
   * @param {object} [opts]
   * @param {number} [opts.ringSize=500]       — max messages per channel in ring buffer
   * @param {number} [opts.deadLetterMax=200]  — max dead-letter entries
   * @param {object} [opts.logger]
   */
  constructor(opts = {}) {
    this._ringSize       = opts.ringSize      || 500;
    this._deadLetterMax  = opts.deadLetterMax || 200;
    this._log            = opts.logger || { info: () => {}, warn: () => {}, error: () => {} };

    // channel → Map<agentId, Set<handler>>
    this._subscribers = new Map();
    // channel → Message[]   (ring buffer, oldest first)
    this._rings       = new Map();
    // dead-letter queue
    this._deadLetters = [];
    // messageId → Message  (for causality lookup)
    this._index       = new Map();
    // Stats
    this._stats = { published: 0, delivered: 0, deadLettered: 0 };
  }

  // ── Publish ──────────────────────────────────────────────────────────────────

  /**
   * Publish a message onto the bus.
   *
   * @param {object} opts
   * @param {string}  opts.channel   — one of CHANNEL_TYPES values (or custom)
   * @param {string}  opts.from      — sender agentId
   * @param {string|null} opts.to    — recipient agentId; null = broadcast to all subscribers
   * @param {*}       opts.payload   — message data
   * @param {string}  [opts.parentId] — messageId of the causing message (causal chain)
   * @param {object}  [opts.meta]    — arbitrary extra metadata
   * @returns {object} published message
   */
  publish({ channel, from, to = null, payload, parentId = null, meta = {} }) {
    if (!channel) throw new TypeError('AgentBus.publish: channel is required');
    if (!from)    throw new TypeError('AgentBus.publish: from (agentId) is required');

    const msg = Object.freeze({
      messageId:  'msg::' + crypto.randomBytes(8).toString('hex'),
      channel,
      from,
      to,
      payload,
      parentId,
      meta,
      ts:         new Date().toISOString(),
    });

    // Index for causality lookup
    this._index.set(msg.messageId, msg);

    // Store in ring buffer
    this._ringPush(channel, msg);

    this._stats.published++;

    // Deliver to subscribers
    const channelSubs = this._subscribers.get(channel);
    if (!channelSubs || channelSubs.size === 0) {
      // No subscribers — dead letter
      this._deadLetter(msg, 'no_subscribers');
      return msg;
    }

    let delivered = 0;
    for (const [subscriberAgentId, handlers] of channelSubs.entries()) {
      // If `to` is set, only deliver to that agent
      if (to !== null && subscriberAgentId !== to) continue;
      for (const handler of handlers) {
        // [V108-P6-01] Non-blocking delivery — handler fires after current call stack
        delivered++;
        setImmediate(() => {
          try {
            handler(msg);
          } catch (err) {
            this._log.error({ component: 'agentBus', channel, from, to, err: err.message },
              '[AgentBus] handler threw during delivery');
            this._deadLetter(msg, `handler_error: ${err.message}`);
          }
        });
      }
    }

    if (delivered === 0 && to !== null) {
      // Targeted message with no matching subscriber
      this._deadLetter(msg, `no_subscriber_for_target: ${to}`);
    } else {
      this._stats.delivered += delivered;
    }

    this._log.info({ component: 'agentBus', channel, from, to: to || 'broadcast', delivered },
      '[AgentBus] message delivered');

    return msg;
  }

  // ── Subscribe ────────────────────────────────────────────────────────────────

  /**
   * Subscribe an agent to a channel.
   *
   * @param {string}   channel
   * @param {string}   agentId    — subscriber's agentId
   * @param {function} handler    — (message) => void
   * @returns {function} unsubscribe function
   */
  subscribe(channel, agentId, handler) {
    if (!channel || !agentId || typeof handler !== 'function') {
      throw new TypeError('AgentBus.subscribe: channel, agentId, and handler are required');
    }

    if (!this._subscribers.has(channel)) {
      this._subscribers.set(channel, new Map());
    }
    const channelSubs = this._subscribers.get(channel);

    if (!channelSubs.has(agentId)) {
      channelSubs.set(agentId, new Set());
    }
    channelSubs.get(agentId).add(handler);

    this._log.info({ component: 'agentBus', channel, agentId }, '[AgentBus] subscribed');

    // Return unsubscribe function
    return () => {
      const subs = this._subscribers.get(channel);
      if (subs) {
        const handlers = subs.get(agentId);
        if (handlers) {
          handlers.delete(handler);
          if (handlers.size === 0) subs.delete(agentId);
        }
        if (subs.size === 0) this._subscribers.delete(channel);
      }
    };
  }

  /**
   * Remove all subscriptions for an agent (called on agent shutdown).
   * @param {string} agentId
   * @param {string} [channel] — if omitted, unsubscribes from all channels
   */
  unsubscribeAll(agentId, channel) {
    if (channel) {
      const subs = this._subscribers.get(channel);
      if (subs) subs.delete(agentId);
    } else {
      for (const subs of this._subscribers.values()) {
        subs.delete(agentId);
      }
    }
    this._log.info({ component: 'agentBus', agentId, channel: channel || 'all' },
      '[AgentBus] unsubscribed');
  }

  // ── Replay ───────────────────────────────────────────────────────────────────

  /**
   * Replay recent messages on a channel (from ring buffer).
   *
   * @param {string}  channel
   * @param {object}  [opts]
   * @param {number}  [opts.limit=50]
   * @param {string}  [opts.since]  — ISO timestamp: only messages after this time
   * @param {string}  [opts.from]   — filter by sender agentId
   * @param {string}  [opts.to]     — filter by target agentId
   * @returns {Message[]}
   */
  replay(channel, opts = {}) {
    const ring   = this._rings.get(channel) || [];
    const limit  = Math.min(opts.limit || 50, this._ringSize);
    const since  = opts.since ? new Date(opts.since).getTime() : 0;

    let msgs = ring.filter(m => {
      if (new Date(m.ts).getTime() < since) return false;
      if (opts.from && m.from !== opts.from) return false;
      if (opts.to   && m.to   !== opts.to)   return false;
      return true;
    });

    return msgs.slice(-limit);
  }

  // ── Causal chain lookup ───────────────────────────────────────────────────────

  /**
   * Build the causal ancestor chain for a message (follows parentId links).
   *
   * @param {string} messageId
   * @param {object} [opts]
   * @param {number} [opts.depth=10]
   * @returns {Message[]}  — [target, parent, grandparent, ...]
   */
  getCausalChain(messageId, opts = {}) {
    const depth  = Math.min(opts.depth || 10, 50);
    const chain  = [];
    let current  = this._index.get(messageId);
    if (!current) return chain;

    chain.push(current);
    for (let i = 0; i < depth - 1; i++) {
      if (!current.parentId) break;
      const parent = this._index.get(current.parentId);
      if (!parent) break;
      chain.push(parent);
      current = parent;
    }
    return chain;
  }

  // ── Stats ─────────────────────────────────────────────────────────────────────

  stats() {
    const channels = {};
    for (const [ch, ring] of this._rings.entries()) {
      channels[ch] = {
        buffered:    ring.length,
        subscribers: [...(this._subscribers.get(ch) || new Map()).keys()],
      };
    }
    return {
      published:    this._stats.published,
      delivered:    this._stats.delivered,
      deadLettered: this._stats.deadLettered,
      channels,
      deadLetterCount: this._deadLetters.length,
    };
  }

  /**
   * Drain dead-letter queue entries (for inspection / retry).
   * @param {number} [limit=50]
   * @returns {Array<{ message, reason, ts }>}
   */
  drainDeadLetters(limit = 50) {
    return this._deadLetters.slice(-limit);
  }

  clearDeadLetters() {
    this._deadLetters = [];
  }

  // ── DB Persistence (V108-P6-03) ───────────────────────────────────────────────

  /**
   * Flush in-memory ring buffers to `agent_bus_messages` table.
   * Idempotent: duplicate message_id rows are skipped (ON CONFLICT DO NOTHING).
   *
   * @param {object} pool  — pg.Pool instance
   * @param {object} [opts]
   * @param {string} [opts.channel]  — persist only this channel (default: all)
   * @param {number} [opts.limit]    — max messages per channel to persist
   * @param {string} [opts.since]    — ISO timestamp: only messages newer than this
   * @returns {Promise<{ persisted: number, errors: number }>}
   */
  async persistToDB(pool, opts = {}) {
    if (!pool) throw new TypeError('AgentBus.persistToDB: pool is required');

    const filterChannel = opts.channel  || null;
    const limit         = opts.limit    || null;
    const sinceMs       = opts.since ? new Date(opts.since).getTime() : 0;

    const messages = [];
    for (const [ch, ring] of this._rings.entries()) {
      if (filterChannel && ch !== filterChannel) continue;
      let msgs = ring.filter(m => new Date(m.ts).getTime() >= sinceMs);
      if (limit) msgs = msgs.slice(-limit);
      messages.push(...msgs);
    }

    let persisted = 0;
    let errors    = 0;
    for (const msg of messages) {
      try {
        await pool.query(
          `INSERT INTO agent_bus_messages
             (message_id, channel, sender_id, recipient_id, parent_id, payload, meta, ts)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (message_id) DO NOTHING`,
          [
            msg.messageId,
            msg.channel,
            msg.from,
            msg.to     || null,
            msg.parentId || null,
            JSON.stringify(msg.payload),
            JSON.stringify(msg.meta || {}),
            msg.ts,
          ]
        );
        persisted++;
      } catch (e) {
        errors++;
        this._log.warn({ component: 'agentBus', messageId: msg.messageId, err: e.message },
          '[AgentBus] persistToDB: insert failed');
      }
    }

    this._log.info({ component: 'agentBus', persisted, errors, total: messages.length },
      '[AgentBus] persistToDB complete');
    return { persisted, errors };
  }

  /**
   * Replay messages from `agent_bus_messages` into the ring buffer.
   * Safe to call on cold start — does not overwrite existing ring entries for
   * the same messageId (index deduplication).
   *
   * @param {object} pool
   * @param {object} [opts]
   * @param {string} [opts.channel]  — replay only this channel
   * @param {number} [opts.limit=200] — max rows to load per query
   * @param {string} [opts.since]    — ISO timestamp filter
   * @returns {Promise<{ loaded: number }>}
   */
  async loadFromDB(pool, opts = {}) {
    if (!pool) throw new TypeError('AgentBus.loadFromDB: pool is required');

    const filterChannel = opts.channel || null;
    const limit         = Math.min(opts.limit || 200, this._ringSize);
    const since         = opts.since   || null;

    let query  = 'SELECT message_id, channel, sender_id, recipient_id, parent_id, payload, meta, ts FROM agent_bus_messages WHERE 1=1';
    const params = [];

    if (filterChannel) {
      params.push(filterChannel);
      query += ` AND channel = $${params.length}`;
    }
    if (since) {
      params.push(since);
      query += ` AND ts >= $${params.length}`;
    }

    params.push(limit);
    query += ` ORDER BY ts DESC LIMIT $${params.length}`;

    let rows;
    try {
      const result = await pool.query(query, params);
      rows = result.rows.reverse(); // oldest-first for ring ordering
    } catch (e) {
      this._log.error({ component: 'agentBus', err: e.message }, '[AgentBus] loadFromDB query failed');
      throw e;
    }

    let loaded = 0;
    for (const row of rows) {
      const msgId = row.message_id;
      if (this._index.has(msgId)) continue; // already in memory

      const msg = Object.freeze({
        messageId: msgId,
        channel:   row.channel,
        from:      row.sender_id,
        to:        row.recipient_id || null,
        parentId:  row.parent_id    || null,
        payload:   row.payload,
        meta:      row.meta || {},
        ts:        row.ts instanceof Date ? row.ts.toISOString() : String(row.ts),
      });

      this._ringPush(msg.channel, msg);
      this._index.set(msgId, msg);
      loaded++;
    }

    this._log.info({ component: 'agentBus', loaded }, '[AgentBus] loadFromDB complete');
    return { loaded };
  }

  /**
   * Flush dead-letter queue to `agent_bus_dead_letters` table.
   *
   * @param {object} pool
   * @param {object} [opts]
   * @param {number} [opts.limit]  — max entries to persist (default: all)
   * @returns {Promise<{ persisted: number, errors: number }>}
   */
  async persistDeadLettersToDB(pool, opts = {}) {
    if (!pool) throw new TypeError('AgentBus.persistDeadLettersToDB: pool is required');

    const limit   = opts.limit || this._deadLetters.length;
    const entries = this._deadLetters.slice(-limit);

    let persisted = 0;
    let errors    = 0;
    for (const entry of entries) {
      try {
        await pool.query(
          `INSERT INTO agent_bus_dead_letters
             (message_id, channel, sender_id, payload, reason, ts)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT DO NOTHING`,
          [
            entry.message.messageId,
            entry.message.channel,
            entry.message.from,
            JSON.stringify(entry.message.payload),
            entry.reason,
            entry.message.ts,
          ]
        );
        persisted++;
      } catch (e) {
        errors++;
      }
    }

    this._log.info({ component: 'agentBus', persisted, errors }, '[AgentBus] persistDeadLettersToDB complete');
    return { persisted, errors };
  }

  // ── Private ───────────────────────────────────────────────────────────────────

  _ringPush(channel, msg) {
    if (!this._rings.has(channel)) this._rings.set(channel, []);
    const ring = this._rings.get(channel);
    ring.push(msg);
    if (ring.length > this._ringSize) ring.shift();
  }

  _deadLetter(msg, reason) {
    this._stats.deadLettered++;
    this._deadLetters.push({ message: msg, reason, ts: new Date().toISOString() });
    if (this._deadLetters.length > this._deadLetterMax) this._deadLetters.shift();
    this._log.warn({ component: 'agentBus', channel: msg.channel, from: msg.from, reason },
      '[AgentBus] dead letter');
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────
const defaultBus = new AgentBus();

module.exports = {
  AgentBus,
  defaultBus,
  CHANNEL_TYPES,
};
