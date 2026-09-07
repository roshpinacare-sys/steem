// tests/v216.test.js — ECOS V216 Test Suite (Phase P103)
// Run: NODE_ENV=test node tests/v216.test.js

'use strict';

// ─── Minimal express-like mock ────────────────────────────────────────────────
function createMockApp() {
  const routes = { GET: {}, POST: {} };
  const app = {
    get:  (path, fn) => { routes.GET[path]  = fn; },
    post: (path, fn) => { routes.POST[path] = fn; },
  };

  function buildReq(method, path, params = {}, body = {}) {
    return { method, path, params, body };
  }
  function buildRes() {
    const res = { _status: 200, _body: null };
    res.status = (code) => { res._status = code; return res; };
    res.json   = (data) => { res._body = data; return res; };
    return res;
  }

  function call(method, path, params = {}, body = {}) {
    // Find matching route (handles :param segments)
    const methodRoutes = routes[method.toUpperCase()] || {};
    for (const routePath of Object.keys(methodRoutes)) {
      const routeParts = routePath.split('/');
      const reqParts   = path.split('/');
      if (routeParts.length !== reqParts.length) continue;
      const matched = {};
      let ok = true;
      for (let i = 0; i < routeParts.length; i++) {
        if (routeParts[i].startsWith(':')) {
          matched[routeParts[i].slice(1)] = reqParts[i];
        } else if (routeParts[i] !== reqParts[i]) {
          ok = false; break;
        }
      }
      if (ok) {
        const req = buildReq(method, path, { ...matched, ...params }, body);
        const res = buildRes();
        methodRoutes[routePath](req, res);
        return res;
      }
    }
    const res = buildRes();
    res.status(404).json({ error: 'route_not_found' });
    return res;
  }

  return { app, call };
}

// ─── Load module ──────────────────────────────────────────────────────────────
const {
  _repSnapshots216,
  registerV216Endpoints,
} = require('./ecos-api-server-v216-patch');

// ─── Test helpers ─────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    failed++;
  }
}

function section(name) {
  console.log(`\n── ${name} ─────────────────────────────────────`);
}

// ─── Setup ────────────────────────────────────────────────────────────────────
const { app, call } = createMockApp();

// Mock stores
const _escrows215 = new Map();
const _onboardLog215 = [];
const _eventLog181 = [];

registerV216Endpoints(app, {
  _escrows215,
  _onboardLog215,
  _eventLog181,
});

const WS  = 'ws-test-001';
const TASK = 'task-alpha';

const VALIDATORS_A = [
  { uid: 'v1', reputation: 100, score: 0.9 },
  { uid: 'v2', reputation: 80,  score: 0.7 },
  { uid: 'v3', reputation: 120, score: 0.85 },
];
const VALIDATORS_B = [
  { uid: 'v1', reputation: 110, score: 0.91 },
  { uid: 'v2', reputation: 75,  score: 0.68 },
  { uid: 'v3', reputation: 130, score: 0.87 },
];

// ─── T01: POST snapshot → 201 + snapshotId ───────────────────────────────────
section('T01 — Task Reputation Snapshot');

let r = call('POST', `/workspaces/${WS}/tasks/${TASK}/reputation-snapshot`, {}, { validators: VALIDATORS_A });
assert(r._status === 201, 'status 201');
assert(typeof r._body.snapshotId === 'string' && r._body.snapshotId.length > 0, 'snapshotId is a non-empty string');
assert(r._body.taskId === TASK, 'taskId matches');
assert(typeof r._body.timestamp === 'number', 'timestamp is a number');

const snap1Id = r._body.snapshotId;

// T01b: POST second snapshot
section('T01b — Second Snapshot');
r = call('POST', `/workspaces/${WS}/tasks/${TASK}/reputation-snapshot`, {}, { validators: VALIDATORS_B });
assert(r._status === 201, 'status 201');
const snap2Id = r._body.snapshotId;
assert(snap1Id !== snap2Id, 'snapshotIds are unique');

const key = `${WS}:${TASK}`;
assert(_repSnapshots216.has(key), 'store contains the key');
assert(_repSnapshots216.get(key).length === 2, 'two snapshots stored');

// T01c: Missing validators → 400
section('T01c — Validation');
r = call('POST', `/workspaces/${WS}/tasks/${TASK}/reputation-snapshot`, {}, {});
assert(r._status === 400, '400 when validators missing');

// ─── T02: GET diff → delta ───────────────────────────────────────────────────
section('T02 — Reputation Diff');
r = call('GET', `/workspaces/${WS}/tasks/${TASK}/reputation-diff`);
assert(r._status === 200, 'status 200');
assert(Array.isArray(r._body.diff), 'diff is array');
assert(r._body.diff.length === 3, 'diff has 3 validators');

const v1diff = r._body.diff.find(d => d.uid === 'v1');
assert(v1diff !== undefined, 'v1 in diff');
assert(v1diff.repBefore === 100, 'v1 repBefore = 100');
assert(v1diff.repAfter  === 110, 'v1 repAfter  = 110');
assert(v1diff.delta     === 10,  'v1 delta = 10');

const v2diff = r._body.diff.find(d => d.uid === 'v2');
assert(v2diff.delta === -5, 'v2 delta = -5 (reputation dropped)');

// T02b: no snapshots → 400
section('T02b — Diff with no snapshots');
r = call('GET', `/workspaces/${WS}/tasks/task-no-snapshots/reputation-diff`);
assert(r._status === 400, 'status 400');
assert(r._body.error === 'insufficient_snapshots', 'error = insufficient_snapshots');

// ─── T03: GET heatmap ────────────────────────────────────────────────────────
section('T03 — Task Activity Heatmap');

// Inject some events
const now = Date.now();
_eventLog181.push({ taskId: TASK, workspaceId: WS, timestamp: new Date('2026-01-15T09:00:00Z').getTime() });
_eventLog181.push({ taskId: TASK, workspaceId: WS, timestamp: new Date('2026-01-15T09:30:00Z').getTime() });
_eventLog181.push({ taskId: TASK, workspaceId: WS, timestamp: new Date('2026-01-15T14:00:00Z').getTime() });
_eventLog181.push({ taskId: 'other-task', workspaceId: WS, timestamp: new Date('2026-01-15T09:00:00Z').getTime() });

r = call('GET', `/workspaces/${WS}/tasks/${TASK}/activity-heatmap`);
assert(r._status === 200, 'status 200');
assert(r._body.heatmap.length === 24, 'heatmap has 24 hours');
const hour9 = r._body.heatmap.find(h => h.hour === 9);
assert(hour9 && hour9.count === 2, 'hour 9 has count 2');
const hour14 = r._body.heatmap.find(h => h.hour === 14);
assert(hour14 && hour14.count === 1, 'hour 14 has count 1');
const hour0 = r._body.heatmap.find(h => h.hour === 0);
assert(hour0 && hour0.count === 0, 'hour 0 has count 0');

// ─── T04: POST sweep ─────────────────────────────────────────────────────────
section('T04 — Escrow Expiry Sweep');

// No expired escrows initially
r = call('POST', `/workspaces/${WS}/agent-escrow/sweep`);
assert(r._status === 200, 'status 200 when nothing to sweep');
assert(r._body.swept === 0, 'swept = 0');
assert(Array.isArray(r._body.escrowIds) && r._body.escrowIds.length === 0, 'escrowIds empty');

// Add an expired escrow manually
_escrows215.set('esc-expired-001', {
  escrowId: 'esc-expired-001',
  status: 'pending',
  expiry: Date.now() - 1000, // 1 second ago
  agentId: 'agent-x',
  taskId: 'task-beta',
  amount: 5.00,
});
_escrows215.set('esc-active-001', {
  escrowId: 'esc-active-001',
  status: 'pending',
  expiry: Date.now() + 3600000, // 1 hour from now
  agentId: 'agent-y',
  taskId: 'task-gamma',
  amount: 3.00,
});
_escrows215.set('esc-released-001', {
  escrowId: 'esc-released-001',
  status: 'released',
  expiry: Date.now() - 1000,
  agentId: 'agent-z',
  taskId: 'task-delta',
  amount: 2.00,
});

r = call('POST', `/workspaces/${WS}/agent-escrow/sweep`);
assert(r._status === 200, 'status 200 after sweep');
assert(r._body.swept === 1, 'swept = 1 (only the expired pending one)');
assert(r._body.escrowIds.includes('esc-expired-001'), 'correct escrowId swept');
assert(_escrows215.get('esc-expired-001').status === 'refunded', 'escrow status updated to refunded');
assert(_escrows215.get('esc-active-001').status === 'pending', 'active escrow untouched');
assert(_escrows215.get('esc-released-001').status === 'released', 'released escrow untouched');

// Idempotency: sweep again → 0
r = call('POST', `/workspaces/${WS}/agent-escrow/sweep`);
assert(r._body.swept === 0, 'second sweep is idempotent (0 swept)');

// ─── T05: GET onboard analytics ──────────────────────────────────────────────
section('T05 — Onboarding Funnel Analytics');

// No sessions yet
r = call('GET', `/workspaces/${WS}/onboard/analytics`);
assert(r._status === 200, 'status 200 with empty log');
assert(r._body.total_sessions === 0, 'total_sessions = 0');
assert(r._body.completion_rate === 0, 'completion_rate = 0 when empty');

// Add sessions
_onboardLog215.push({
  sessionId: 's1', status: 'complete', startedAt: 1000, completedAt: 50000,
  durationMs: 49000, steps: ['wallet_connect','first_task','first_earn','complete'],
});
_onboardLog215.push({
  sessionId: 's2', status: 'complete', startedAt: 1000, completedAt: 70000,
  durationMs: 69000, steps: ['wallet_connect','first_task','first_earn','complete'],
});
_onboardLog215.push({
  sessionId: 's3', status: 'dropped', startedAt: 1000, completedAt: null,
  steps: ['wallet_connect', 'first_task'],
});
_onboardLog215.push({
  sessionId: 's4', status: 'dropped', startedAt: 1000, completedAt: null,
  steps: ['wallet_connect'],
});

r = call('GET', `/workspaces/${WS}/onboard/analytics`);
assert(r._status === 200, 'status 200');
assert(r._body.total_sessions === 4, 'total_sessions = 4');
assert(r._body.completed === 2, 'completed = 2');
assert(r._body.completion_rate >= 0 && r._body.completion_rate <= 1, 'completion_rate in [0,1]');
assert(r._body.completion_rate === 0.5, 'completion_rate = 0.5');
assert(r._body.fast_completions === 1, 'fast_completions = 1 (s1 under 60s, s2 over 60s)');
assert(typeof r._body.avg_duration_ms === 'number', 'avg_duration_ms is a number');
assert(r._body.avg_duration_ms === 59000, 'avg_duration_ms = (49000+69000)/2 = 59000');

// ─── Tz: GET /admin/summary-v216 ─────────────────────────────────────────────
section('Tz — Admin Summary V216');
r = call('GET', '/admin/summary-v216');
assert(r._status === 200, 'status 200');
assert(r._body.version === '216.0.0', 'version === "216.0.0"');
assert(typeof r._body.v216 === 'object', 'v216 object present');
assert(typeof r._body.v216.rep_snapshots === 'number', 'rep_snapshots is a number');
assert(r._body.v216.rep_snapshots >= 2, 'rep_snapshots >= 2 (from T01/T01b)');
assert(typeof r._body.v216.escrow_sweep_available === 'number', 'escrow_sweep_available is a number');
assert(typeof r._body.v216.onboard_sessions === 'number', 'onboard_sessions is a number');
assert(r._body.v216.onboard_sessions === 4, 'onboard_sessions = 4');
assert(typeof r._body.v216.onboard_completion_rate === 'number', 'onboard_completion_rate is a number');

// ─── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n══════════════════════════════════════════════════`);
console.log(`V216 Test Suite: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
