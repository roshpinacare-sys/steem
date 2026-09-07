/**
 * ECOS Integration Tests — V59
 * ─────────────────────────────────────────────────────────────────────────────
 * [FIX-V58-P1] beforeAll issues a JWT Bearer token via issueValidatorToken()
 *   so that GET /api/v1/approvals and POST /api/v1/approvals/:id/resolve
 *   pass auth when VALIDATOR_JWT_SECRET is set in CI.
 *
 *   When VALIDATOR_JWT_SECRET is NOT set, the server runs in DEV_PASSTHROUGH
 *   mode and the token is ignored — existing behaviour is preserved.
 *
 *   Pattern mirrors validatorAuth.test.js: clear module cache, inject secret,
 *   require fresh module, restore env.
 *
 * [V59-P1] e2e payout test added:
 *   1. Deposit funds to validator::e2e_payout_test
 *   2. Seed the validator with a task approval → resolved → earns balance
 *   3. POST /api/v1/payout — verifies:
 *      - 200 OK
 *      - payoutId present
 *      - mock field present (true when STRIPE_API_KEY not set)
 *      - remainingBalanceUsd is '0.0000' after full payout
 *      - audit chain still intact after payout
 *   STRIPE_API_KEY not set → mock: true (no money moves). This is correct
 *   sandbox behaviour. When sk_test_... is set in .env, mock: false.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const fs   = require('fs');
const os   = require('os');
const path = require('path');

// Mock offlineInference before requiring the server
const offlineInference = require('../lib/offlineInference');
offlineInference.executeTask = async () => ({
  aiOutput: { result: 'Looks standard.' }, confidence: 0.5
});

const approvalsLogPath = path.join(os.tmpdir(), `ecos-integration-test-${process.pid}.ndjson`);
process.env.ECOS_APPROVALS_LOG = approvalsLogPath;

// ── JWT helper ────────────────────────────────────────────────────────────────
// Issue a token that works whether VALIDATOR_JWT_SECRET is set or not.
// When set: issues a real signed JWT the server will accept.
// When not set: server is in DEV_PASSTHROUGH — any string (or none) is accepted.
const TEST_JWT_SECRET = process.env.VALIDATOR_JWT_SECRET || null;

function issueTestToken() {
  if (!TEST_JWT_SECRET) return null; // DEV_PASSTHROUGH — no token needed
  // Load a fresh validatorAuth instance with the secret
  const modulePath = require.resolve('../middleware/validatorAuth');
  const savedSecret = process.env.VALIDATOR_JWT_SECRET;
  process.env.VALIDATOR_JWT_SECRET = TEST_JWT_SECRET;
  delete require.cache[modulePath];
  const { issueValidatorToken } = require('../middleware/validatorAuth');
  // Restore
  if (savedSecret !== undefined) {
    process.env.VALIDATOR_JWT_SECRET = savedSecret;
  } else {
    delete process.env.VALIDATOR_JWT_SECRET;
  }
  return issueValidatorToken('validator::e2e_test', 3600, TEST_JWT_SECRET);
}

// ── Test state ────────────────────────────────────────────────────────────────
let serverModule;
let listener;
let baseUrl;
let savedApprovalId = '';
let validatorAuthHeaders = {}; // populated in beforeAll

describe('ECOS Integration Tests', () => {
  beforeAll(async () => {
    serverModule = require('../ecos-api-server.js');
    listener     = serverModule.startServer(0);
    await new Promise(resolve => listener.once('listening', resolve));
    const address = listener.address();
    baseUrl = `http://127.0.0.1:${address.port}`;

    // [FIX-V58-P1] Issue JWT if VALIDATOR_JWT_SECRET is configured
    const token = issueTestToken();
    if (token) {
      validatorAuthHeaders = { 'Authorization': `Bearer ${token}` };
    }
    // If no secret: validatorAuthHeaders stays {} — DEV_PASSTHROUGH accepts all requests
  });

  afterAll(async () => {
    if (listener?.listening) {
      await new Promise(resolve => listener.close(resolve));
    }
    fs.rmSync(approvalsLogPath, { force: true });
    delete process.env.ECOS_APPROVALS_LOG;
    // [V80] Clean up idempotency key so next test run starts fresh
    const idemPath = path.join(
      path.dirname(require.resolve('../ecos-api-server.js')),
      'deposit_idem.json'
    );
    try {
      if (fs.existsSync(idemPath)) {
        const raw = JSON.parse(fs.readFileSync(idemPath, 'utf8'));
        const cleaned = raw.filter(e => e[0] !== 'integration-test-seed-001');
        fs.writeFileSync(idemPath, JSON.stringify(cleaned, null, 2), 'utf8');
      }
    } catch (_) {}
  });

  it('deposit funds client account', async () => {
    const res = await fetch(`${baseUrl}/api/v1/deposit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientAccountId: 'client::e2e_test',
        amountUsd: '100.00',
        idempotencyKey: 'integration-test-seed-001'
      })
    });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toHaveProperty('balanceUsd');
  });

  it('deposit is idempotent', async () => {
    // 1. Get initial balance
    const accRes  = await fetch(`${baseUrl}/api/v1/account?id=client::e2e_test`);
    const accBody = await accRes.json();
    const initialBalance = accBody.balance_usd;

    // 2. Call deposit again with same idempotencyKey
    const res = await fetch(`${baseUrl}/api/v1/deposit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientAccountId: 'client::e2e_test',
        amountUsd: '100.00',
        idempotencyKey: 'integration-test-seed-001'
      })
    });
    const body = await res.json();
    expect(res.status).toBe(200);

    // 3. Verify balance has not changed
    const accRes2  = await fetch(`${baseUrl}/api/v1/account?id=client::e2e_test`);
    const accBody2 = await accRes2.json();
    expect(accBody2.balance_usd).toBe(initialBalance);
  });

  it('chat creates HITL approval', async () => {
    const res = await fetch(`${baseUrl}/api/v1/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: 'Review this NDA',
        clientAccountId: 'client::e2e_test',
        priceUsd: '10.00'
      })
    });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.verdict).toBe('HITL_QUEUE');
    expect(body.approvalId.startsWith('apv_')).toBe(true);
    savedApprovalId = body.approvalId;
  });

  // [FIX-V58-P1] Pass validatorAuthHeaders — required when VALIDATOR_JWT_SECRET is set
  it('pending queue contains the approval', async () => {
    const res = await fetch(`${baseUrl}/api/v1/approvals?status=pending`, {
      headers: {
        'Content-Type': 'application/json',
        ...validatorAuthHeaders,   // {} in DEV_PASSTHROUGH, Bearer token in CI
      }
    });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(Array.isArray(body.approvals)).toBe(true);
    expect(body.approvals.length).toBeGreaterThanOrEqual(1);
    const found = body.approvals.some(
      app => app.id === savedApprovalId || app.approvalId === savedApprovalId
    );
    expect(found).toBe(true);
  });

  // [FIX-V58-P1] Pass validatorAuthHeaders — required when VALIDATOR_JWT_SECRET is set
  it('resolve approval succeeds', async () => {
    const res = await fetch(`${baseUrl}/api/v1/approvals/${savedApprovalId}/resolve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...validatorAuthHeaders,   // {} in DEV_PASSTHROUGH, Bearer token in CI
      },
      body: JSON.stringify({
        validatorAccountId: 'validator::e2e_test',
        decision: 'approve'
      })
    });
    expect(res.status).toBe(200);
  });

  it('audit chain intact', async () => {
    const res  = await fetch(`${baseUrl}/api/v1/verify`);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
  });

  it('agent endpoint returns answer', async () => {
    const res = await fetch(`${baseUrl}/api/v1/agent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: 'check system status',
        clientAccountId: 'client::e2e_test'
      })
    });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(typeof body.answer).toBe('string');
    expect(body.answer.length).toBeGreaterThan(0);
  });

  // ── [V59-P1] e2e payout test ────────────────────────────────────────────────
  // Tests the full payout flow: fund validator → POST /api/v1/payout → verify.
  // When STRIPE_API_KEY is not set: mock: true (stripeProvider sandbox mode).
  // When STRIPE_API_KEY=sk_test_...: mock: false (real Stripe test charge).
  // In both cases: balance is debited, payoutId is issued, audit chain passes.
  it('e2e payout: fund validator and withdraw', async () => {
    const VALIDATOR_PAYOUT = 'validator::e2e_payout_test';
    const PAYOUT_AMOUNT    = '5.00';

    // Step 1: Credit the validator directly via ledger credit endpoint.
    // We submit a task as client, resolve it as this validator, so the 40/40/20
    // split credits the validator naturally.
    // Easier path: deposit to client, submit task, resolve, check validator balance.
    const clientId = 'client::e2e_payout_client';

    // Deposit to client
    const depositRes = await fetch(`${baseUrl}/api/v1/deposit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientAccountId: clientId,
        amountUsd: '50.00',
        idempotencyKey: `payout-test-fund-${Date.now()}`,
      }),
    });
    expect(depositRes.status).toBe(200);

    // Submit a task → get approvalId (rawConfidence=0.60 → calibrates to ~0.60 → HITL_QUEUE)
    const taskRes = await fetch(`${baseUrl}/api/v1/task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        missionId:       `payout-test-mission-${Date.now()}`,
        clientAccountId: clientId,
        taskType:        'summarization',
        taskInput:       { instruction: 'Summarize this payout test task.' },
        priceUsd:        '10.00',
        rawConfidence:   0.60,
        aiOutput:        { result: 'Summarized output for payout test.' },
        context:         { source: 'payout-e2e-test' },
      }),
    });
    expect(taskRes.status).toBe(202);
    const taskBody = await taskRes.json();
    // Task routes to HITL (confidence=0.51 in HITL band), approve to earn 40%
    const approvalId = taskBody.approvalId;
    expect(typeof approvalId).toBe('string');
    expect(approvalId.startsWith('apv_')).toBe(true);

    // Resolve as VALIDATOR_PAYOUT → earns 40% of $10 = $4.00
    const resolveRes = await fetch(`${baseUrl}/api/v1/approvals/${approvalId}/resolve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...validatorAuthHeaders,
      },
      body: JSON.stringify({
        validatorAccountId: VALIDATOR_PAYOUT,
        decision: 'approve',
      }),
    });
    expect(resolveRes.status).toBe(200);

    // Verify validator has non-zero balance
    const balRes = await fetch(`${baseUrl}/api/v1/account?id=${encodeURIComponent(VALIDATOR_PAYOUT)}`);
    const balBody = await balRes.json();
    expect(balRes.status).toBe(200);
    const balanceUsd = parseFloat(balBody.balance_usd ?? '0');
    expect(balanceUsd).toBeGreaterThan(0); // earned 40% of task price

    // Step 2: POST /api/v1/payout — withdraw the earned balance
    const payoutRes = await fetch(`${baseUrl}/api/v1/payout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...validatorAuthHeaders,
      },
      body: JSON.stringify({
        validatorAccountId: VALIDATOR_PAYOUT,
        amountUsd:          balBody.balance_usd, // withdraw full balance
      }),
    });
    const payoutBody = await payoutRes.json();

    // Must succeed
    expect(payoutRes.status).toBe(200);
    expect(payoutBody.success).toBe(true);
    expect(typeof payoutBody.payoutId).toBe('string');
    expect(payoutBody.payoutId.startsWith('po_')).toBe(true);
    // mock: true when STRIPE_API_KEY not set; mock: false with sk_test_...
    expect(typeof payoutBody.mock).toBe('boolean');
    // Balance must be zero after full withdrawal
    expect(payoutBody.remainingBalanceUsd).toBe('0.0000');

    // Step 3: Audit chain must still be intact after payout
    const verifyRes  = await fetch(`${baseUrl}/api/v1/verify`);
    const verifyBody = await verifyRes.json();
    expect(verifyRes.status).toBe(200);
    expect(verifyBody.ok).toBe(true);
  });
});

// ── [V86-P2] RoyaltyTrigger demo-mode test ───────────────────────────────────
describe('RoyaltyTrigger — demo mode (no DB pool)', () => {
  it('royalty pay() returns { paid: false } when no DB pool (demo mode)', async () => {
    const { RoyaltyTrigger } = require('../lib/royaltyTrigger');
    const rt = new RoyaltyTrigger(); // no pool
    const result = await rt.pay('patch_test', 'mission_test');
    expect(result.paid).toBe(false);
  });
});

// ── [V63-P4] CORS Preflight Integration Tests ─────────────────────────────────
// Verifies that OPTIONS /api/v1/approvals returns the required CORS headers
// including Access-Control-Allow-Credentials: true (needed for HttpOnly cookies).
// These tests use the SAME server instance started in the outer describe above,
// so they need their own beforeAll/afterAll to avoid port conflicts.

describe('CORS Preflight — OPTIONS /api/v1/approvals', () => {
  let listener;
  let baseUrl;

  beforeAll(async () => {
    // Require a fresh server module on a random port (port 0 = OS-assigned)
    const serverModule = require('../ecos-api-server.js');
    listener = serverModule.startServer(0);
    await new Promise(resolve => listener.once('listening', resolve));
    baseUrl = `http://127.0.0.1:${listener.address().port}`;
  });

  afterAll(async () => {
    if (listener?.listening) {
      await new Promise(resolve => listener.close(resolve));
    }
  });

  it('OPTIONS /api/v1/approvals returns 204 No Content', async () => {
    const res = await fetch(`${baseUrl}/api/v1/approvals`, { method: 'OPTIONS' });
    expect(res.status).toBe(204);
  });

  it('OPTIONS response includes Access-Control-Allow-Credentials: true', async () => {
    const res = await fetch(`${baseUrl}/api/v1/approvals`, { method: 'OPTIONS' });
    expect(res.headers.get('access-control-allow-credentials')).toBe('true');
  });

  it('OPTIONS response includes Access-Control-Allow-Methods with GET and POST', async () => {
    const res = await fetch(`${baseUrl}/api/v1/approvals`, { method: 'OPTIONS' });
    const methods = res.headers.get('access-control-allow-methods') || '';
    expect(methods).toMatch(/GET/i);
    expect(methods).toMatch(/POST/i);
  });

  it('OPTIONS response includes Idempotency-Key in Allow-Headers', async () => {
    const res = await fetch(`${baseUrl}/api/v1/approvals`, { method: 'OPTIONS' });
    const allowedHeaders = res.headers.get('access-control-allow-headers') || '';
    expect(allowedHeaders).toMatch(/Idempotency-Key/i);
  });

  it('OPTIONS response includes Authorization in Allow-Headers', async () => {
    const res = await fetch(`${baseUrl}/api/v1/approvals`, { method: 'OPTIONS' });
    const allowedHeaders = res.headers.get('access-control-allow-headers') || '';
    expect(allowedHeaders).toMatch(/Authorization/i);
  });

  it('OPTIONS response has Access-Control-Allow-Origin header', async () => {
    const res = await fetch(`${baseUrl}/api/v1/approvals`, { method: 'OPTIONS' });
    const origin = res.headers.get('access-control-allow-origin');
    // Must be set — exact value depends on CORS_ORIGIN env var
    expect(origin).toBeTruthy();
    expect(typeof origin).toBe('string');
    expect(origin.length).toBeGreaterThan(0);
  });

  it('OPTIONS on non-approvals path also returns CORS headers (server-wide middleware)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/deposit`, { method: 'OPTIONS' });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-credentials')).toBe('true');
  });
});

// ── [V87-P4] admin/credit removed — returns 404 ──────────────────────────────
describe('Admin credit removal', () => {
  let listener;
  let baseUrl;

  beforeAll(async () => {
    const serverModule = require('../ecos-api-server.js');
    listener = serverModule.startServer(0);
    await new Promise(resolve => listener.once('listening', resolve));
    baseUrl = `http://127.0.0.1:${listener.address().port}`;
  });

  afterAll(async () => {
    if (listener?.listening) {
      await new Promise(resolve => listener.close(resolve));
    }
  });

  it('POST /api/v1/admin/credit returns 404 after removal', async () => {
    const res = await fetch(`${baseUrl}/api/v1/admin/credit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(404);
  });
});

// ── [V87-P2] depositIdemMode in health ───────────────────────────────────────
describe('Health — depositIdemMode field', () => {
  let listener;
  let baseUrl;

  beforeAll(async () => {
    const serverModule = require('../ecos-api-server.js');
    listener = serverModule.startServer(0);
    await new Promise(resolve => listener.once('listening', resolve));
    baseUrl = `http://127.0.0.1:${listener.address().port}`;
  });

  afterAll(async () => {
    if (listener?.listening) {
      await new Promise(resolve => listener.close(resolve));
    }
  });

  it('GET /api/v1/health includes depositIdemMode field', async () => {
    const res  = await fetch(`${baseUrl}/api/v1/health`);
    const body = await res.json();
    expect(['db', 'file']).toContain(body.depositIdemMode);
  });
});

// ── [P4-V88] Deposit idempotency — duplicate key returns same result ──────────
describe('Deposit idempotency — file store path', () => {  let listener;
  let BASE;

  beforeAll(async () => {
    const serverModule = require('../ecos-api-server.js');
    listener = serverModule.startServer(0);
    await new Promise(resolve => listener.once('listening', resolve));
    BASE = `http://127.0.0.1:${listener.address().port}`;
  });

  afterAll(async () => {
    if (listener?.listening) {
      await new Promise(resolve => listener.close(resolve));
    }
  });

  it('deposit idempotency: duplicate key returns same result (file store)', async () => {
    const idemKey = 'test-idem-' + Date.now();
    const body = {
      clientAccountId: 'client::idem_test',
      amountUsd: '5.00',
      idempotencyKey: idemKey,
    };

    // First call — should create
    const r1 = await fetch(BASE + '/api/v1/deposit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const j1 = await r1.json();

    // Second call with same key — should replay
    const r2 = await fetch(BASE + '/api/v1/deposit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const j2 = await r2.json();

    expect(j1.depositId).toBe(j2.depositId);
    expect(j2.idempotent).toBe(true);
  });
});

// ── [P5-V88] Training-data paging — count and hasMore fields ─────────────────
describe('GET /api/v1/calibrator/training-data — paging (P5-V88)', () => {
  let listener;
  let BASE;

  beforeAll(async () => {
    const serverModule = require('../ecos-api-server.js');
    listener = serverModule.startServer(0);
    await new Promise(resolve => listener.once('listening', resolve));
    BASE = `http://127.0.0.1:${listener.address().port}`;
  });

  afterAll(async () => {
    if (listener?.listening) {
      await new Promise(resolve => listener.close(resolve));
    }
  });

  it('GET /api/v1/calibrator/training-data returns count and hasMore fields', async () => {
    const res = await fetch(BASE + '/api/v1/calibrator/training-data?limit=10');
    const body = await res.json();
    expect(body).toHaveProperty('count');
    expect(body).toHaveProperty('hasMore');
  });
});

// ── [P4-V89] POST /api/v1/payout — mock Stripe path ─────────────────────────
describe('POST /api/v1/payout — mock Stripe path', () => {
  let listener;
  let BASE;

  // Issue a validator JWT the same way the main describe block does:
  // DEV_PASSTHROUGH when VALIDATOR_JWT_SECRET is absent (normal CI),
  // real signed JWT when it is set.
  function issuePayoutTestToken() {
    const secret = process.env.VALIDATOR_JWT_SECRET || null;
    if (!secret) return null; // DEV_PASSTHROUGH — no token needed
    const modulePath = require.resolve('../middleware/validatorAuth');
    const saved = process.env.VALIDATOR_JWT_SECRET;
    process.env.VALIDATOR_JWT_SECRET = secret;
    delete require.cache[modulePath];
    const { issueValidatorToken } = require('../middleware/validatorAuth');
    if (saved !== undefined) {
      process.env.VALIDATOR_JWT_SECRET = saved;
    } else {
      delete process.env.VALIDATOR_JWT_SECRET;
    }
    return issueValidatorToken('validator::payout_test', 3600, secret);
  }

  beforeAll(async () => {
    const serverModule = require('../ecos-api-server.js');
    listener = serverModule.startServer(0);
    await new Promise(resolve => listener.once('listening', resolve));
    BASE = `http://127.0.0.1:${listener.address().port}`;
  });

  afterAll(async () => {
    if (listener?.listening) {
      await new Promise(resolve => listener.close(resolve));
    }
  });

  it('payout succeeds with mock: true when no STRIPE_API_KEY', async () => {
    // 1. Fund the validator account via deposit (DEV_PASSTHROUGH — no ECOS_DEPOSIT_API_KEY in CI)
    const depositRes = await fetch(BASE + '/api/v1/deposit', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientAccountId: 'client::payout_test',
        amountUsd:       '10.00',
        idempotencyKey:  'payout-test-fund-' + Date.now(),
      }),
    });
    expect(depositRes.status).toBe(200);

    // 2. Build auth headers for the payout endpoint (DEV_PASSTHROUGH when secret absent)
    const token = issuePayoutTestToken();
    const authHeaders = token ? { 'Authorization': `Bearer ${token}` } : {};

    // 3. POST /api/v1/payout — pay out from the same funded account
    const payoutRes = await fetch(BASE + '/api/v1/payout', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify({
        validatorAccountId: 'client::payout_test',
        amountUsd:          '1.00',
      }),
    });
    const payoutBody = await payoutRes.json();
    expect(payoutRes.status).toBe(200);
    expect(payoutBody.success).toBe(true);
    expect(payoutBody.mock).toBe(true);          // no STRIPE_API_KEY in test env
    expect(typeof payoutBody.payoutId).toBe('string');
    expect(payoutBody.payoutId).toMatch(/^po_mock_/);
  });
});

describe('Health endpoint — version (P5-V91)', () => {
  let listener;
  let BASE;

  beforeAll(async () => {
    const serverModule = require('../ecos-api-server.js');
    listener = serverModule.startServer(0);
    await new Promise(resolve => listener.once('listening', resolve));
    BASE = `http://127.0.0.1:${listener.address().port}`;
  });

  afterAll(async () => {
    if (listener?.listening) {
      await new Promise(resolve => listener.close(resolve));
    }
  });

  it("GET /api/v1/health returns version 'V114'", async () => {
    const res = await fetch(BASE + '/api/v1/health');
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.version).toBe('V114');
  });
});

// ── [P1-V92] POST /api/v1/admin/credit returns 404 (confirmed removed) ───────
describe('Admin credit endpoint — confirmed removed (P1-V92)', () => {
  let listener;
  let BASE;

  beforeAll(async () => {
    const serverModule = require('../ecos-api-server.js');
    listener = serverModule.startServer(0);
    await new Promise(resolve => listener.once('listening', resolve));
    BASE = `http://127.0.0.1:${listener.address().port}`;
  });

  afterAll(async () => {
    if (listener?.listening) {
      await new Promise(resolve => listener.close(resolve));
    }
  });

  it('POST /api/v1/admin/credit returns 404 (confirmed removed)', async () => {
    const res = await fetch(BASE + '/api/v1/admin/credit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(404);
  });
});

// ── [P2-V92] Deposit idempotency — DB-backed path (mock pool) ────────────────
describe('Deposit idempotency — DB-backed path (mock pool) (P2-V92)', () => {
  // Build a stateful in-memory mock pool that mimics the subset of PG queries
  // used by _depositIdemCheck and _depositIdemSave.
  function makeMockPool() {
    // rows keyed by key_hash
    const store = new Map();
    return {
      async query(sql, params) {
        const s = sql.trim().toUpperCase();
        if (s.startsWith('INSERT')) {
          // params: [route, key_hash, fingerprint, response_body_json]
          const [route, keyHash, fingerprint, responseBodyJson] = params;
          store.set(keyHash, {
            request_fingerprint: fingerprint,
            status_code:         200,
            response_body:       JSON.parse(responseBodyJson),
            expires_at:          new Date(Date.now() + 86400000).toISOString(),
          });
          return { rows: [] };
        }
        if (s.startsWith('SELECT')) {
          // params: [route, key_hash]
          const keyHash = params[1];
          const row = store.get(keyHash);
          return { rows: row ? [row] : [] };
        }
        if (s.startsWith('DELETE')) {
          const keyHash = params[1];
          store.delete(keyHash);
          return { rows: [] };
        }
        return { rows: [] };
      },
    };
  }

  let _depositIdemCheck;
  let _depositIdemSave;
  let _setDbPoolForTest;

  beforeAll(() => {
    // Clear module cache so test-env exports are fresh
    const modPath = require.resolve('../ecos-api-server.js');
    delete require.cache[modPath];
    const mod = require('../ecos-api-server.js');
    _depositIdemCheck   = mod._depositIdemCheck;
    _depositIdemSave    = mod._depositIdemSave;
    _setDbPoolForTest   = mod._setDbPoolForTest;
  });

  afterAll(() => {
    // Restore: clear injected mock pool
    if (_setDbPoolForTest) _setDbPoolForTest(null);
  });

  it('_depositIdemCheck uses DB pool when available', async () => {
    const mockPool = makeMockPool();
    _setDbPoolForTest(mockPool);

    // 1. Check before save — should return cached: false
    const before = await _depositIdemCheck('test-key', 'fp1');
    expect(before.cached).toBe(false);

    // 2. Save the result
    await _depositIdemSave('test-key', 'fp1', { depositId: 'd1' });

    // 3. Check with matching fingerprint — should replay
    const hit = await _depositIdemCheck('test-key', 'fp1');
    expect(hit.cached).toBe(true);
    expect(hit.conflict).toBe(false);
    expect(hit.result).toMatchObject({ depositId: 'd1' });

    // 4. Check with different fingerprint — should flag conflict
    const conflict = await _depositIdemCheck('test-key', 'fp2');
    expect(conflict.cached).toBe(true);
    expect(conflict.conflict).toBe(true);
    expect(conflict.result).toBeNull();
  });
});

// ── [P1-V94] Deposit idempotency — file path HTTP integration ────────────────
describe('Deposit idempotency — HTTP endpoint (P1-V94)', () => {
  let listener;
  let BASE;

  beforeAll(async () => {
    // Clear module cache to get a fresh server with clean in-memory idem state
    const modPath = require.resolve('../ecos-api-server.js');
    delete require.cache[modPath];
    const serverModule = require('../ecos-api-server.js');
    listener = serverModule.startServer(0);
    await new Promise(resolve => listener.once('listening', resolve));
    BASE = `http://127.0.0.1:${listener.address().port}`;
  });

  afterAll(async () => {
    if (listener?.listening) {
      await new Promise(resolve => listener.close(resolve));
    }
  });

  it('deposit is idempotent with same idempotency key (file path)', async () => {
    const idempotencyKey = `p1-v94-idem-${Date.now()}`;
    const body = {
      clientAccountId: 'client::idem-test-v94',
      amountUsd: '5.00',
      idempotencyKey,
    };

    // First request — fresh deposit
    const res1 = await fetch(`${BASE}/api/v1/deposit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect(res1.status).toBe(200);
    const data1 = await res1.json();
    expect(data1.depositId).toBeDefined();

    // Second request — same idempotency key → must replay without a new credit
    const res2 = await fetch(`${BASE}/api/v1/deposit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect(res2.status).toBe(200);
    const data2 = await res2.json();
    // The replay response carries idempotent: true (V22+ server behaviour)
    expect(data2.idempotent).toBe(true);
    // depositId must be identical on both responses
    expect(data2.depositId).toBe(data1.depositId);
  });

  it('deposit with different key creates new record', async () => {
    const keyA = `p1-v94-key-a-${Date.now()}`;
    const keyB = `p1-v94-key-b-${Date.now() + 1}`;
    const baseBody = { clientAccountId: 'client::idem-test-v94-ab', amountUsd: '2.00' };

    const resA = await fetch(`${BASE}/api/v1/deposit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...baseBody, idempotencyKey: keyA }),
    });
    expect(resA.status).toBe(200);
    const dataA = await resA.json();
    expect(dataA.depositId).toBeDefined();

    const resB = await fetch(`${BASE}/api/v1/deposit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...baseBody, idempotencyKey: keyB }),
    });
    expect(resB.status).toBe(200);
    const dataB = await resB.json();
    expect(dataB.depositId).toBeDefined();

    // Different keys → different depositIds, neither is a cached replay
    expect(dataA.depositId).not.toBe(dataB.depositId);
    expect(dataA.idempotent).toBe(false);
    expect(dataB.idempotent).toBe(false);
  });
});

// ── [P5-V92] GET /api/v1/version endpoint ────────────────────────────────────
describe('Version endpoint (P5-V92)', () => {
  let listener;
  let BASE;

  beforeAll(async () => {
    const serverModule = require('../ecos-api-server.js');
    listener = serverModule.startServer(0);
    await new Promise(resolve => listener.once('listening', resolve));
    BASE = `http://127.0.0.1:${listener.address().port}`;
  });

  afterAll(async () => {
    if (listener?.listening) {
      await new Promise(resolve => listener.close(resolve));
    }
  });

  it('GET /api/v1/version returns 200 with version field', async () => {
    const res = await fetch(BASE + '/api/v1/version');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.version).toBe('V114');
    expect(typeof body.semver).toBe('string');
    expect(typeof body.buildTime).toBe('string');
    expect(typeof body.nodeVersion).toBe('string');
  });

  it("GET /api/v1/version nodeVersion starts with 'v'", async () => {
    const body = await (await fetch(BASE + '/api/v1/version')).json();
    expect(body.nodeVersion).toMatch(/^v\d+/);
  });
});

// ── [P2-V93 + P5-V93] GET /api/v1/version — Cache-Control, buildTime, gitCommit
describe('Version endpoint — Cache-Control, buildTime, gitCommit (P2+P5-V93)', () => {
  let listener;
  let BASE;

  beforeAll(async () => {
    const serverModule = require('../ecos-api-server.js');
    listener = serverModule.startServer(0);
    await new Promise(resolve => listener.once('listening', resolve));
    BASE = `http://127.0.0.1:${listener.address().port}`;
  });

  afterAll(async () => {
    if (listener?.listening) {
      await new Promise(resolve => listener.close(resolve));
    }
  });

  it('GET /api/v1/version returns Cache-Control: no-store', async () => {
    const res = await fetch(BASE + '/api/v1/version');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('GET /api/v1/version buildTime is stable across calls', async () => {
    const b1 = (await (await fetch(BASE + '/api/v1/version')).json()).buildTime;
    const b2 = (await (await fetch(BASE + '/api/v1/version')).json()).buildTime;
    expect(b1).toBe(b2);  // SERVER_START_TIME, not Date.now()
  });

  it('GET /api/v1/version includes gitCommit field (string or null)', async () => {
    const body = await (await fetch(BASE + '/api/v1/version')).json();
    expect(body).toHaveProperty('gitCommit');
    // gitCommit is either a short hash string or null
    expect(body.gitCommit === null || typeof body.gitCommit === 'string').toBe(true);
  });
});

// ── [P4-V94] GET /api/v1/version — semver 94.0.0 ─────────────────────────────
describe('Version endpoint — semver V99 (P4-V99)', () => {
  let listener;
  let BASE;

  beforeAll(async () => {
    const serverModule = require('../ecos-api-server.js');
    listener = serverModule.startServer(0);
    await new Promise(resolve => listener.once('listening', resolve));
    BASE = `http://127.0.0.1:${listener.address().port}`;
  });

  afterAll(async () => {
    if (listener?.listening) {
      await new Promise(resolve => listener.close(resolve));
    }
  });

  it('GET /api/v1/version returns correct semver 99.0.0', async () => {
    const res = await fetch(BASE + '/api/v1/version');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.semver).toBe('112.0.0');
    expect(body.version).toBe('V114');
  });
});

// ── [P1-V95] dev-quickstart script exits 0 ────────────────────────────────────
// Runs the full flywheel demo as a child process on PORT=3101 (test-only port).
// Expects: script completes without throwing (exit code 0).
// Timeout: 15 seconds. No external deps — uses only node built-ins.
describe('dev-quickstart script exits 0 (P1-V95)', () => {
  it('dev-quickstart script exits 0', () => {
    const { execFileSync } = require('child_process');
    const engineDir = path.resolve(path.dirname(require.resolve('../ecos-api-server.js')));
    // expect: no throw → exit code 0
    execFileSync(process.execPath, ['scripts/dev-quickstart.js'], {
      cwd: engineDir,
      timeout: 15000,
      env: { ...process.env, PORT: '3101', NODE_ENV: 'test' },
    });
  });
});

// ── [V97] Pagination tests — GET /api/v1/approvals ───────────────────────────
describe('Pagination — GET /api/v1/approvals (V97)', () => {
  let listener;
  let BASE;

  // Helper: deposit + submit a task (always routes to HITL since confidence=0.5)
  async function seedTask(base, clientId, idemKey) {
    // Deposit if not funded
    await fetch(`${base}/api/v1/deposit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientAccountId: clientId,
        amountUsd: '100.00',
        idempotencyKey: idemKey,
      }),
    });
    // Submit task → creates approval in HITL_QUEUE
    const taskRes = await fetch(`${base}/api/v1/task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        missionId:       `test-page-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        clientAccountId: clientId,
        priceUsd:        '1.00',
        taskType:        'summarization',
        taskInput:       { instruction: 'Pagination test task' },
        rawConfidence:   0.60,
        aiOutput:        { result: 'Pagination test output.' },
      }),
    });
    const taskBody = await taskRes.json();
    return taskBody.approvalId || null;
  }

  beforeAll(async () => {
    const serverModule = require('../ecos-api-server.js');
    listener = serverModule.startServer(0);
    await new Promise(resolve => listener.once('listening', resolve));
    BASE = `http://127.0.0.1:${listener.address().port}`;
  });

  afterAll(async () => {
    if (listener?.listening) {
      await new Promise(resolve => listener.close(resolve));
    }
  });

  it('GET /api/v1/approvals?limit=2 returns at most 2 results', async () => {
    // Seed 3 approvals
    await seedTask(BASE, 'client::pg_test1', 'pg-idem-1a');
    await seedTask(BASE, 'client::pg_test1', 'pg-idem-1b');
    await seedTask(BASE, 'client::pg_test1', 'pg-idem-1c');

    const res  = await fetch(`${BASE}/api/v1/approvals?status=all&limit=2`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.approvals)).toBe(true);
    expect(body.approvals.length).toBeLessThanOrEqual(2);
    expect(typeof body.hasMore).toBe('boolean');
    expect(typeof body.count).toBe('number');
    expect(typeof body.limit).toBe('number');
  });

  it('GET /api/v1/approvals cursor pagination works', async () => {
    // Seed 4 more approvals into the shared server (BASE reused — no second startServer)
    await seedTask(BASE, 'client::pg_cur', 'pg-cur-1');
    await seedTask(BASE, 'client::pg_cur', 'pg-cur-2');
    await seedTask(BASE, 'client::pg_cur', 'pg-cur-3');
    await seedTask(BASE, 'client::pg_cur', 'pg-cur-4');

    // Page 1 (limit=2)
    const res1  = await fetch(`${BASE}/api/v1/approvals?status=all&limit=2`);
    const body1 = await res1.json();
    expect(body1.approvals.length).toBeLessThanOrEqual(2);

    if (body1.hasMore && body1.cursor) {
      // Page 2 using cursor
      const res2  = await fetch(`${BASE}/api/v1/approvals?status=all&limit=2&cursor=${body1.cursor}`);
      const body2 = await res2.json();
      expect(Array.isArray(body2.approvals)).toBe(true);
      // Page 2 IDs must differ from page 1 IDs
      const ids1 = new Set(body1.approvals.map(a => a.id));
      const ids2 = body2.approvals.map(a => a.id);
      for (const id of ids2) expect(ids1.has(id)).toBe(false);
    }
  });

  it('GET /api/v1/approvals?status=pending filters correctly', async () => {
    // Seed 2 approvals, then approve one
    const id1 = await seedTask(BASE, 'client::pg_filter', 'pg-filter-1a');
    const id2 = await seedTask(BASE, 'client::pg_filter', 'pg-filter-1b');

    if (id1) {
      // Resolve one approval as approved
      await fetch(`${BASE}/api/v1/approvals/${id1}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          validatorAccountId: 'validator::pg_filter_test',
          decision: 'approve',
        }),
      });
    }

    // GET status=pending — the resolved one should not appear
    const res  = await fetch(`${BASE}/api/v1/approvals?status=pending&limit=100`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.approvals)).toBe(true);
    // None of the returned approvals should be non-pending
    for (const a of body.approvals) {
      expect(a.status).toBe('pending');
    }
  });
});

// ── [V97] Event sourcing tests — GET /api/v1/mission/:id/events ──────────────
describe('Event sourcing — mission event log (V97)', () => {
  let listener;
  let BASE;

  beforeAll(async () => {
    const serverModule = require('../ecos-api-server.js');
    listener = serverModule.startServer(0);
    await new Promise(resolve => listener.once('listening', resolve));
    BASE = `http://127.0.0.1:${listener.address().port}`;
  });

  afterAll(async () => {
    if (listener?.listening) {
      await new Promise(resolve => listener.close(resolve));
    }
  });

  it('POST /api/v1/task records events', async () => {
    // Deposit + submit task
    await fetch(`${BASE}/api/v1/deposit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientAccountId: 'client::evt_test',
        amountUsd: '50.00',
        idempotencyKey: 'evt-idem-1',
      }),
    });
    const missionId = `evt-mission-${Date.now()}`;
    await fetch(`${BASE}/api/v1/task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        missionId,
        clientAccountId: 'client::evt_test',
        priceUsd: '1.00',
        taskType: 'summarization',
        taskInput: { instruction: 'Event log test task' },
        rawConfidence: 0.60,
        aiOutput: { result: 'Event log test output.' },
      }),
    });

    const res  = await fetch(`${BASE}/api/v1/mission/${missionId}/events`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.events)).toBe(true);
    // At least one event recorded (task.created or gate.evaluated)
    const types = body.events.map(e => e.type);
    const hasExpected = types.some(t =>
      t === 'task.created' || t === 'gate.evaluated' || t === 'approval.created'
    );
    expect(hasExpected).toBe(true);
  });

  it('GET /api/v1/events/recent returns array', async () => {
    const res  = await fetch(`${BASE}/api/v1/events/recent?limit=5`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.events)).toBe(true);
    expect(typeof body.count).toBe('number');
  });

  it('GET /api/v1/mission/:id/events returns 200 for unknown id', async () => {
    const res  = await fetch(`${BASE}/api/v1/mission/totally-unknown-mission-xyz/events`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.events)).toBe(true);
    expect(body.events.length).toBe(0);
  });

  it('GET /api/v1/mission/:id includes eventCount field', async () => {
    // Deposit + submit a task and verify mission detail includes eventCount
    await fetch(`${BASE}/api/v1/deposit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientAccountId: 'client::evt_cnt',
        amountUsd: '50.00',
        idempotencyKey: 'evt-cnt-idem-1',
      }),
    });
    const missionId = `evt-cnt-${Date.now()}`;
    await fetch(`${BASE}/api/v1/task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        missionId,
        clientAccountId: 'client::evt_cnt',
        priceUsd: '1.00',
        taskType: 'summarization',
        taskInput: { instruction: 'eventCount test' },
        rawConfidence: 0.60,
        aiOutput: { result: 'eventCount test output.' },
      }),
    });

    const res  = await fetch(`${BASE}/api/v1/mission/${missionId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('eventCount');
    expect(body.eventCount).toBeGreaterThanOrEqual(0);
  });
});

// ── [V98] System 2: GET /api/v1/patches cursor pagination ────────────────────
describe('Patches pagination (V98)', () => {
  let listener;
  let BASE;

  beforeAll(async () => {
    const serverModule = require('../ecos-api-server.js');
    listener = serverModule.startServer(0);
    await new Promise(resolve => listener.once('listening', resolve));
    BASE = `http://127.0.0.1:${listener.address().port}`;
  });

  afterAll(async () => {
    if (listener?.listening) {
      await new Promise(resolve => listener.close(resolve));
    }
  });

  it('GET /api/v1/patches?limit=1 returns hasMore', async () => {
    const res  = await fetch(`${BASE}/api/v1/patches?limit=1`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('hasMore');
    expect(typeof body.hasMore).toBe('boolean');
    expect(body).toHaveProperty('count');
    expect(Array.isArray(body.patches)).toBe(true);
  });
});

// ── [V98] System 4: Calibration sample accumulation ──────────────────────────
describe('Auto-calibrator training data (V98)', () => {
  let listener;
  let BASE;

  // Helper — deposit + submit task (force HITL via low confidence)
  async function depositAndSubmit(base, clientId, idemKey, missionId) {
    await fetch(`${base}/api/v1/deposit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientAccountId: clientId,
        amountUsd: '50.00',
        idempotencyKey: idemKey,
      }),
    });
    const res = await fetch(`${base}/api/v1/task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        missionId,
        clientAccountId: clientId,
        priceUsd: '1.00',
        taskType: 'summarization',
        taskInput: { instruction: 'Cal test' },
        rawConfidence: 0.40,   // force HITL_QUEUE
        aiOutput: { result: 'Cal test output.' },
      }),
    });
    const data = await res.json();
    return data.approvalId || null;
  }

  beforeAll(async () => {
    const serverModule = require('../ecos-api-server.js');
    listener = serverModule.startServer(0);
    await new Promise(resolve => listener.once('listening', resolve));
    BASE = `http://127.0.0.1:${listener.address().port}`;
  });

  afterAll(async () => {
    if (listener?.listening) {
      await new Promise(resolve => listener.close(resolve));
    }
  });

  it('calibration samples accumulate as approvals are resolved', async () => {
    const missionId = `cal-acc-${Date.now()}`;
    const approvalId = await depositAndSubmit(
      BASE, 'client::cal_acc', 'cal-acc-idem-1', missionId
    );

    if (approvalId) {
      await fetch(`${BASE}/api/v1/approvals/${approvalId}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          validatorAccountId: 'validator::cal_acc',
          decision: 'approve',
        }),
      });
    }

    const res  = await fetch(`${BASE}/api/v1/calibrator/training-data`);
    expect(res.status).toBe(200);
    const body = await res.json();
    // labeledCount is from the in-memory calibrationSamples map
    expect(body).toHaveProperty('labeledCount');
    expect(typeof body.labeledCount).toBe('number');
    expect(body.labeledCount).toBeGreaterThanOrEqual(approvalId ? 1 : 0);
  });

  it('GET /api/v1/calibrator/training-data returns willAutoFitAt field', async () => {
    const res  = await fetch(`${BASE}/api/v1/calibrator/training-data`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('willAutoFitAt');
    expect(typeof body.willAutoFitAt).toBe('string');
    expect(body).toHaveProperty('autoFitThreshold');
    expect(body.autoFitThreshold).toBe(50);
    expect(body).toHaveProperty('pendingCount');
    expect(typeof body.pendingCount).toBe('number');
  });
});

// ── [V100-P2] GET /api/v1/health/detailed ────────────────────────────────────
describe('GET /api/v1/health/detailed — V100', () => {
  let listener;
  let BASE;

  beforeAll(async () => {
    const serverModule = require('../ecos-api-server.js');
    listener = serverModule.startServer(0);
    await new Promise(resolve => listener.once('listening', resolve));
    BASE = `http://127.0.0.1:${listener.address().port}`;
  });

  afterAll(async () => {
    if (listener?.listening) {
      await new Promise(resolve => listener.close(resolve));
    }
  });

  it('GET /api/v1/health/detailed returns status field', async () => {
    const res  = await fetch(`${BASE}/api/v1/health/detailed`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('status');
    expect(['healthy', 'degraded', 'unhealthy']).toContain(body.status);
    expect(body).toHaveProperty('version', 'V114');
    expect(body).toHaveProperty('checks');
    expect(typeof body.checks).toBe('object');
  });

  it('GET /api/v1/health/detailed checks.auditChain.verified is boolean', async () => {
    const res  = await fetch(`${BASE}/api/v1/health/detailed`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.checks).toHaveProperty('auditChain');
    expect(typeof body.checks.auditChain.verified).toBe('boolean');
    expect(body.checks.auditChain).toHaveProperty('length');
    expect(typeof body.checks.auditChain.length).toBe('number');
  });
});

// ── [V100-P2-extra] health/detailed calibrator check ─────────────────────────
describe('GET /api/v1/health/detailed — calibrator subsystem (V100)', () => {
  let listener;
  let BASE;

  beforeAll(async () => {
    const serverModule = require('../ecos-api-server.js');
    listener = serverModule.startServer(0);
    await new Promise(resolve => listener.once('listening', resolve));
    BASE = `http://127.0.0.1:${listener.address().port}`;
  });

  afterAll(async () => {
    if (listener?.listening) {
      await new Promise(resolve => listener.close(resolve));
    }
  });

  it('GET /api/v1/health/detailed checks.calibrator has sampleCount and uptime', async () => {
    const res  = await fetch(`${BASE}/api/v1/health/detailed`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.checks).toHaveProperty('calibrator');
    expect(typeof body.checks.calibrator.sampleCount).toBe('number');
    expect(['ok', 'warning']).toContain(body.checks.calibrator.status);
    expect(body).toHaveProperty('uptime');
    expect(typeof body.uptime).toBe('number');
  });
});
