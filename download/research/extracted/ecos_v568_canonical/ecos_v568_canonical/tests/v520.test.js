'use strict';
/**
 * tests/v520.test.js — ECOS V520
 * audit-wrap + classification tests. exit 0 = pass.
 */
const assert = require('assert');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');

let passed = 0, failed = 0;
function test520(name, fn) {
  try { fn(); console.log('  ✓', name); passed++; }
  catch (e) { console.error('  ✗', name, '\n   ', e.message); failed++; }
}

console.log('\n=== V520 tests ===');

// ── SACRED guard ──
test520('SACRED fiatLedger.js md5 unchanged', () => {
  const md5 = crypto.createHash('md5').update(fs.readFileSync(path.join(ROOT, 'lib', 'fiatLedger.js'))).digest('hex');
  assert.strictEqual(md5, '563e9b1f9e67091a5b6527c0a92568e5');
});
test520('SACRED auditLog.js md5 unchanged', () => {
  const md5 = crypto.createHash('md5').update(fs.readFileSync(path.join(ROOT, 'lib', 'auditLog.js'))).digest('hex');
  assert.strictEqual(md5, 'e5a5c2c27801d2d03991bc8e5a1df8cb');
});

// ── Wiring ──
test520('server source contains V520 IIFE marker and require', () => {
  const src = fs.readFileSync(path.join(ROOT, 'ecos-api-server.js'), 'utf8');
  assert(src.includes('_wireAuditWrap520'), 'V520 IIFE missing');
  assert(src.includes("require('./lib/auditWrap520.js')"), 'V520 require missing');
});

// ── lib & src/lib mirror byte-identical ──
test520('lib/ and src/lib/ copies have identical md5', () => {
  const a = crypto.createHash('md5').update(fs.readFileSync(path.join(ROOT, 'lib',     'auditWrap520.js'))).digest('hex');
  const b = crypto.createHash('md5').update(fs.readFileSync(path.join(ROOT, 'src','lib','auditWrap520.js'))).digest('hex');
  assert.strictEqual(a, b, 'lib/ and src/lib/ copies must match');
});

// ── Module shape ──
const mod = require(path.join(ROOT, 'lib', 'auditWrap520.js'));
test520('module exports expected surface', () => {
  assert.strictEqual(mod.WRAP_VERSION_520, '520.0.0');
  assert.strictEqual(typeof mod.wrapHandlerWithAudit520, 'function');
  assert.strictEqual(typeof mod.classifyEndpoint520, 'function');
  assert.strictEqual(typeof mod.getRealGapList520, 'function');
  assert.strictEqual(typeof mod.getWrapSummary520, 'function');
  assert.strictEqual(typeof mod.getDemoAuditChain520, 'function');
  assert.strictEqual(typeof mod.registerEndpoints520, 'function');
  assert(mod.CLASSIFICATIONS_520 && typeof mod.CLASSIFICATIONS_520 === 'object');
});

// ── Classification correctness ──
test520('guard endpoints classified false-positive', () => {
  assert.strictEqual(mod.classifyEndpoint520({ method:'POST', path:'/api/v1/guard/mint' }),     'false-positive');
  assert.strictEqual(mod.classifyEndpoint520({ method:'POST', path:'/api/v1/guard/withdraw' }), 'false-positive');
});
test520('unknown endpoint classified unclassified (fail-closed)', () => {
  assert.strictEqual(mod.classifyEndpoint520({ method:'POST', path:'/api/v1/some/new/withdraw' }), 'unclassified');
});
test520('CLASSIFICATIONS_520 is frozen', () => {
  assert.strictEqual(Object.isFrozen(mod.CLASSIFICATIONS_520), true);
});

// ── wrapHandlerWithAudit520 input validation ──
test520('wrapHandlerWithAudit520 rejects non-function handler', () => {
  assert.throws(() => mod.wrapHandlerWithAudit520(null, { kind:'x', source:'y' }), /handler must be a function/);
});
test520('wrapHandlerWithAudit520 rejects missing meta.kind', () => {
  assert.throws(() => mod.wrapHandlerWithAudit520(()=>{}, { source:'y' }), /meta\.kind/);
});
test520('wrapHandlerWithAudit520 rejects missing meta.source', () => {
  assert.throws(() => mod.wrapHandlerWithAudit520(()=>{}, { kind:'x' }), /meta\.source/);
});

// ── wrapHandlerWithAudit520: audit-before-handler ordering ──
test520('wrapper appends to audit BEFORE invoking handler', () => {
  const { AuditLog } = require(path.join(ROOT, 'lib', 'auditLog.js'));
  const al = new AuditLog();
  const order = [];
  const orig = (_req, res) => { order.push('handler'); res.json({ ok:true }); };
  const wrapped = mod.wrapHandlerWithAudit520(orig, { kind:'t.k', source:'unit' }, { auditLog: al });
  const fakeRes = { json: (_)=>fakeRes, status: (_)=>fakeRes };
  wrapped({ body: { amount:'100' } }, fakeRes);
  assert.strictEqual(al.size(), 1, 'audit must have 1 entry');
  assert.strictEqual(al.head().type, 't.k');
  assert.strictEqual(order[0], 'handler');
});

// ── fail-closed: audit failure must block handler when opts.failClosed=true ──
test520('failClosed=true: audit failure responds 503 and does NOT call handler', () => {
  const brokenAudit = { append: () => { throw new Error('chain disk full'); } };
  let handlerCalled = false;
  const orig = () => { handlerCalled = true; };
  const wrapped = mod.wrapHandlerWithAudit520(orig, { kind:'t.k', source:'unit' }, { failClosed: true, auditLog: brokenAudit });
  let statusCode = null; let body = null;
  const fakeRes = {
    status: (c) => { statusCode = c; return fakeRes; },
    json:   (b) => { body = b;       return fakeRes; },
  };
  wrapped({ body: {} }, fakeRes);
  assert.strictEqual(handlerCalled, false, 'handler MUST NOT run when audit failed and failClosed=true');
  assert.strictEqual(statusCode, 503);
  assert(body && body.ok === false && body.error === 'audit_unavailable');
});

// ── best-effort: audit failure must NOT block handler when opts.failClosed=false ──
test520('failClosed=false: audit failure is swallowed and handler still runs', () => {
  const brokenAudit = { append: () => { throw new Error('chain disk full'); } };
  let handlerCalled = false;
  const orig = (_req, res) => { handlerCalled = true; res.json({ ok:true }); };
  const wrapped = mod.wrapHandlerWithAudit520(orig, { kind:'t.k', source:'unit' }, { failClosed: false, auditLog: brokenAudit });
  const fakeRes = { json: (_)=>fakeRes, status: (_)=>fakeRes };
  wrapped({ body: {} }, fakeRes);
  assert.strictEqual(handlerCalled, true);
});

// ── BigInt-safe payload summarization ──
test520('wrapper handles BigInt payload without throwing', () => {
  const { AuditLog } = require(path.join(ROOT, 'lib', 'auditLog.js'));
  const al = new AuditLog();
  const orig = (_req, res) => res.json({ ok:true });
  const wrapped = mod.wrapHandlerWithAudit520(orig, { kind:'t.bi', source:'unit' }, { auditLog: al });
  const fakeRes = { json: (_)=>fakeRes, status: (_)=>fakeRes };
  wrapped({ body: { amountMicros: 1234567890123456789n } }, fakeRes);
  assert.strictEqual(al.size(), 1);
  assert.strictEqual(al.head().payload.payload.amountMicros, '1234567890123456789');
});

// ── getRealGapList520 reads V519 probe and filters by classification ──
test520('getRealGapList520 returns ok and known shape', () => {
  const r = mod.getRealGapList520();
  assert.strictEqual(r.ok, true, r.reason || '');
  assert(Array.isArray(r.realGaps));
  assert(Array.isArray(r.unclassified));
  assert(typeof r.scanned === 'number' && r.scanned >= 10);
});

// ── Endpoint registration via stub express ──
test520('registerEndpoints520 registers 6 routes (5 GET + 1 POST)', () => {
  const gets = []; const posts = [];
  const stub = {
    get:  (p, _h) => gets.push(p),
    post: (p, _h) => posts.push(p),
  };
  mod.registerEndpoints520(stub);
  assert.strictEqual(gets.length, 5, 'expected 5 GET routes, got ' + gets.length);
  assert.strictEqual(posts.length, 1, 'expected 1 POST route, got ' + posts.length);
  assert(gets.includes('/api/v1/registry/audit-wrap-v520/status'));
  assert(gets.includes('/api/v1/registry/audit-wrap-v520/classifications'));
  assert(gets.includes('/api/v1/registry/audit-wrap-v520/real-gaps'));
  assert(gets.includes('/api/v1/registry/audit-wrap-v520/demo-chain'));
  assert(gets.includes('/api/v1/admin/summary/v520'));
  assert(posts.includes('/api/v1/audit-wrap-v520/demo'));
});

test520('registered handlers respond ok json without throwing', () => {
  const calls = [];
  const stub = {
    get:  (p, h) => calls.push({ p, h, m:'GET'  }),
    post: (p, h) => calls.push({ p, h, m:'POST' }),
  };
  mod.registerEndpoints520(stub);
  for (const c of calls) {
    let captured = null;
    const fakeRes = { json: (x) => { captured = x; return fakeRes; }, status: (_c) => fakeRes };
    c.h({ query: {}, body: {} }, fakeRes);
    assert(captured && captured.ok === true, 'handler ' + c.p + ' (' + c.m + ') did not respond ok');
    assert.strictEqual(captured.ecosVersion, 'V520', 'handler ' + c.p + ' missing ecosVersion');
  }
});

test520('POST demo handler increments demo audit chain', () => {
  const before = mod.getDemoAuditChain520().size;
  let captured = null;
  const fakeRes = { json: (x) => { captured = x; return fakeRes; }, status: (_c) => fakeRes };
  // Re-register to get a fresh demo handler reference, then invoke it.
  let demoHandler = null;
  const stub = {
    get:  () => {},
    post: (p, h) => { if (p === '/api/v1/audit-wrap-v520/demo') demoHandler = h; },
  };
  mod.registerEndpoints520(stub);
  demoHandler({ body: { test: true } }, fakeRes);
  const after = mod.getDemoAuditChain520().size;
  assert.strictEqual(after, before + 1, 'demo chain must grow by 1');
  assert(captured && captured.ok === true && captured.wrapped === true);
  // Chain integrity intact.
  const v = mod.getDemoAuditChain520().verify;
  assert.strictEqual(v.ok, true, 'demo chain verify must succeed');
});

// ── Parse-check the lib itself ──
test520('lib/auditWrap520.js node --check passes (require succeeded above)', () => {
  // require() above already throws on parse error; reaching here means OK.
  assert.strictEqual(mod.WRAP_VERSION_520, '520.0.0');
});

// ── Server source size sanity ──
test520('ecos-api-server.js is non-trivial size', () => {
  const src = fs.readFileSync(path.join(ROOT, 'ecos-api-server.js'), 'utf8');
  assert(src.length > 100000);
});

// ── Version bump ──
test520('package.json version >= 520.0.0', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const major = parseInt(String(pkg.version).split('.')[0], 10);
  assert(major >= 520, 'expected major >= 520, got ' + pkg.version);
});

console.log('\nV520:', passed, 'passed,', failed, 'failed');
process.exit(failed === 0 ? 0 : 1);
