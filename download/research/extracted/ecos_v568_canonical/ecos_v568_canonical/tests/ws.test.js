/**
 * ws.test.js — ValidatorHub WebSocket unit test
 * [V84] Tests the ValidatorHub broadcasts approval lifecycle events.
 * [V97] JWT authentication tests added.
 *
 * Run: npx vitest run tests/ws.test.js
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const http = require('http');
const WebSocket = require('ws');
const { ValidatorHub } = require('../lib/validatorHub');
const { issueValidatorToken, verifyJwt } = require('../middleware/validatorAuth');

/** Start an HTTP server on a random port and return { server, port }. */
function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer();
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port });
    });
  });
}

/** Connect a WebSocket client to ws://127.0.0.1:<port> and wait for open. */
function connectWs(port, query = '') {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${query}`);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

/** Collect the next message from a WebSocket that matches a predicate. */
function waitForMessage(ws, predicate, timeoutMs = 700) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    const handler = (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (predicate(msg)) {
        clearTimeout(timer);
        ws.off('message', handler);
        resolve(msg);
      }
    };
    ws.on('message', handler);
  });
}

describe('ValidatorHub — WebSocket broadcasts', () => {
  it('broadcasts approval.created to authenticated client', async () => {
    const { server, port } = await startServer();
    const hub = new ValidatorHub(server);

    const ws = await connectWs(port);

    // Authenticate the client
    ws.send(JSON.stringify({ type: 'auth', validatorId: 'validator::test' }));
    // Allow auth to be processed
    await new Promise(r => setTimeout(r, 50));

    // Broadcast an approval.created event and wait for it
    const received = await Promise.all([
      waitForMessage(ws, (m) => m.type === 'approval.created'),
      (async () => {
        hub.onApprovalCreated({ id: 'apv_test', status: 'pending', priceUsd: '1.00' });
      })(),
    ]);

    const msg = received[0];
    expect(msg).not.toBeNull();
    expect(msg.type).toBe('approval.created');
    expect(msg.data.id).toBe('apv_test');
    expect(msg.ts).toBeTruthy();

    ws.close();
    await hub.close();
    server.close();
  });

  it('broadcasts approval.resolved to authenticated client', async () => {
    const { server, port } = await startServer();
    const hub = new ValidatorHub(server);
    const ws = await connectWs(port);

    ws.send(JSON.stringify({ type: 'auth', validatorId: 'validator::test2' }));
    await new Promise(r => setTimeout(r, 50));

    const received = await Promise.all([
      waitForMessage(ws, (m) => m.type === 'approval.resolved'),
      (async () => {
        hub.onApprovalResolved({ id: 'apv_res', status: 'approved', decision: 'approve' });
      })(),
    ]);

    const msg = received[0];
    expect(msg).not.toBeNull();
    expect(msg.type).toBe('approval.resolved');
    expect(msg.data.id).toBe('apv_res');

    ws.close();
    await hub.close();
    server.close();
  });

  it('connectedValidators() returns authenticated IDs only', async () => {
    const { server, port } = await startServer();
    const hub = new ValidatorHub(server);

    // Connect without authenticating
    const ws1 = await connectWs(port);
    await new Promise(r => setTimeout(r, 30));
    expect(hub.connectedValidators()).toHaveLength(0);

    // Now authenticate
    ws1.send(JSON.stringify({ type: 'auth', validatorId: 'validator::alice' }));
    await new Promise(r => setTimeout(r, 50));
    expect(hub.connectedValidators()).toContain('validator::alice');

    ws1.close();
    await hub.close();
    server.close();
  });

  it('does not broadcast to unauthenticated clients', async () => {
    const { server, port } = await startServer();
    const hub = new ValidatorHub(server);
    const ws = await connectWs(port);

    // Do NOT send auth message
    await new Promise(r => setTimeout(r, 30));

    const received = await Promise.all([
      waitForMessage(ws, (m) => m.type === 'approval.created', 300),
      (async () => { hub.onApprovalCreated({ id: 'apv_noauth' }); })(),
    ]);

    // Unauthenticated client should NOT receive the broadcast
    expect(received[0]).toBeNull();

    ws.close();
    await hub.close();
    server.close();
  });

  // ── test 5 ──────────────────────────────────────────────────────────────────
  it('ValidatorHub.onRoyaltyPaid broadcasts ROYALTY_PAID to authenticated client', async () => {
    const { server, port } = await startServer();
    const hub = new ValidatorHub(server);
    const ws = await connectWs(port);

    // Authenticate
    ws.send(JSON.stringify({ type: 'auth', validatorId: 'validator::alice' }));
    await new Promise(r => setTimeout(r, 50));

    const received = await Promise.all([
      waitForMessage(ws, (m) => m.type === 'ROYALTY_PAID'),
      (async () => { hub.onRoyaltyPaid('validator::alice', 50000n, 'patch_xyz'); })(),
    ]);

    const msg = received[0];
    expect(msg).not.toBeNull();
    expect(msg.type).toBe('ROYALTY_PAID');
    expect(msg.data.validatorId).toBe('validator::alice');
    expect(msg.data.rewardUsd).toBe('0.050000');
    expect(msg.data.patchId).toBe('patch_xyz');

    ws.close();
    await hub.close();
    server.close();
  });

  // ── test 6 ──────────────────────────────────────────────────────────────────
  it('ValidatorHub.onRoyaltyPaid does NOT broadcast to unauthenticated client', async () => {
    const { server, port } = await startServer();
    const hub = new ValidatorHub(server);
    const ws = await connectWs(port);

    // Do NOT send auth message
    await new Promise(r => setTimeout(r, 30));

    const received = await Promise.all([
      waitForMessage(ws, (m) => m.type === 'ROYALTY_PAID', 300),
      (async () => { hub.onRoyaltyPaid('validator::alice', 50000n, 'patch_xyz'); })(),
    ]);

    // Unauthenticated client should NOT receive ROYALTY_PAID
    expect(received[0]).toBeNull();

    ws.close();
    await hub.close();
    server.close();
  });
});

// ── [V97] JWT Authentication tests ───────────────────────────────────────────
describe('ValidatorHub — JWT Authentication (V97)', () => {
  const JWT_TEST_SECRET = 'test-secret-for-ws-tests-32chars!!';

  // Save and restore VALIDATOR_JWT_SECRET around each test
  let savedSecret;
  afterEach(() => {
    if (savedSecret !== undefined) {
      process.env.VALIDATOR_JWT_SECRET = savedSecret;
    } else {
      delete process.env.VALIDATOR_JWT_SECRET;
    }
  });

  it('ValidatorHub accepts connection without JWT in DEV mode', async () => {
    // DEV mode: no VALIDATOR_JWT_SECRET set, no verifyJwt provided
    savedSecret = process.env.VALIDATOR_JWT_SECRET;
    delete process.env.VALIDATOR_JWT_SECRET;

    const { server, port } = await startServer();
    const hub = new ValidatorHub(server); // no verifyJwt

    // Should connect without any token
    const ws = await connectWs(port);

    // Authenticate via legacy DEV method
    ws.send(JSON.stringify({ type: 'auth', validatorId: 'validator::dev_test' }));
    await new Promise(r => setTimeout(r, 50));

    expect(hub.connectedValidators()).toContain('validator::dev_test');

    ws.close();
    await hub.close();
    server.close();
  });

  it('ValidatorHub rejects connection with invalid JWT in production mode', async () => {
    savedSecret = process.env.VALIDATOR_JWT_SECRET;
    process.env.VALIDATOR_JWT_SECRET = JWT_TEST_SECRET;

    const { server, port } = await startServer();
    const hub = new ValidatorHub(server, null, verifyJwt);

    // Connect with an obviously invalid token
    const closed = await new Promise((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}?token=invalid_token`);
      ws.on('close', () => resolve(true));
      ws.on('error', () => resolve(true));
      // Safety timeout
      setTimeout(() => { ws.terminate(); resolve(false); }, 1000);
    });

    expect(closed).toBe(true);

    await hub.close();
    server.close();
  });

  it('ValidatorHub accepts connection with valid JWT', async () => {
    savedSecret = process.env.VALIDATOR_JWT_SECRET;
    process.env.VALIDATOR_JWT_SECRET = JWT_TEST_SECRET;

    const { server, port } = await startServer();
    const hub = new ValidatorHub(server, null, verifyJwt);

    // Generate a valid JWT token
    const token = issueValidatorToken('validator::test', 3600, JWT_TEST_SECRET);

    // Connect with valid token in query string
    const ws = await connectWs(port, `?token=${encodeURIComponent(token)}`);

    // Allow auth to be processed
    await new Promise(r => setTimeout(r, 80));

    expect(hub.connectedValidators()).toContain('validator::test');

    ws.close();
    await hub.close();
    server.close();
  });
});
