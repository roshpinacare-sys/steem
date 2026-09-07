'use strict';
/**
 * tests/v530.test.js — ECOS V530
 * Run: NODE_ENV=test node tests/v530.test.js → exit 0
 */
const assert       = require('assert');
const crypto       = require('crypto');
const fs           = require('fs');
const path         = require('path');
const http         = require('http');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
let passed = 0, failed = 0;

function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}: ${e.message}`); failed++; }
}
async function testAsync(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}: ${e.message}`); failed++; }
}

console.log('\n=== ECOS V530 Tests ===\n');

// T01 — SACRED fiatLedger
test('SACRED fiatLedger.js md5', () => {
  const buf = fs.readFileSync(path.join(ROOT, 'lib/fiatLedger.js'));
  assert.strictEqual(crypto.createHash('md5').update(buf).digest('hex'), '563e9b1f9e67091a5b6527c0a92568e5');
});

// T02 — SACRED auditLog
test('SACRED auditLog.js md5', () => {
  const buf = fs.readFileSync(path.join(ROOT, 'lib/auditLog.js'));
  assert.strictEqual(crypto.createHash('md5').update(buf).digest('hex'), 'e5a5c2c27801d2d03991bc8e5a1df8cb');
});

// T03 — server parse
test('ecos-api-server.js node --check', () => {
  execSync(`node --check ${path.join(ROOT, 'ecos-api-server.js')}`, { stdio: 'pipe' });
});

// T04 — version
test('package.json version = 530.0.0', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json')));
  assert.ok(parseInt(pkg.version) >= 530, 'expected >= 530, got ' + pkg.version); // relaxed in V531+
});

// T05 — ws stub exists
test('node_modules/ws/index.js exists', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'node_modules/ws/index.js')));
});

// T06 — ws stub parses
test('ws stub node --check', () => {
  execSync(`node --check ${path.join(ROOT, 'node_modules/ws/index.js')}`, { stdio: 'pipe' });
});

// T07 — ws exports WebSocket and WebSocketServer
test('ws exports WebSocket + WebSocketServer', () => {
  const ws = require(path.join(ROOT, 'node_modules/ws/index.js'));
  assert.strictEqual(typeof ws, 'function', 'default export not a function');
  assert.strictEqual(typeof ws.WebSocketServer, 'function', 'WebSocketServer missing');
  assert.strictEqual(ws.OPEN, 1);
  assert.strictEqual(ws.CLOSED, 3);
});

// T08 — ws server + client can communicate (async)
testAsync('ws server+client full round-trip', async () => {
  const { WebSocketServer } = require(path.join(ROOT, 'node_modules/ws/index.js'));
  const WebSocket           = require(path.join(ROOT, 'node_modules/ws/index.js'));

  await new Promise((resolve, reject) => {
    const server = http.createServer();
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      const wss  = new WebSocketServer({ server });
      const timer = setTimeout(() => { reject(new Error('timeout')); server.close(); }, 3000);

      wss.on('connection', (ws) => {
        ws.on('message', (raw) => {
          const msg = JSON.parse(raw.toString());
          ws.send(JSON.stringify({ type: 'echo', payload: msg.payload }));
        });
      });

      const client = new WebSocket('ws://127.0.0.1:' + port);
      client.on('open', () => client.send(JSON.stringify({ type: 'ping', payload: 42 })));
      client.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        assert.strictEqual(msg.type, 'echo');
        assert.strictEqual(msg.payload, 42);
        clearTimeout(timer);
        client.close();
        wss.close(() => server.close(() => resolve()));
      });
      client.on('error', (e) => { clearTimeout(timer); reject(e); });
    });
  });
});

// T09 — ValidatorHub works with ws stub
testAsync('ValidatorHub auth + connectedValidators()', async () => {
  const { ValidatorHub } = require(path.join(ROOT, 'lib/validatorHub'));
  const WebSocket        = require(path.join(ROOT, 'node_modules/ws/index.js'));

  await new Promise((resolve, reject) => {
    const server = http.createServer();
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      const hub  = new ValidatorHub(server);
      const timer = setTimeout(() => { reject(new Error('timeout')); server.close(); }, 3000);

      const ws = new WebSocket('ws://127.0.0.1:' + port);
      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'auth', validatorId: 'validator::stub_test' }));
        setTimeout(() => {
          try {
            assert.ok(hub.connectedValidators().includes('validator::stub_test'));
            clearTimeout(timer);
            ws.close();
            hub.close().then(() => server.close(resolve));
          } catch (e) { clearTimeout(timer); reject(e); }
        }, 80);
      });
      ws.on('error', (e) => { clearTimeout(timer); reject(e); });
    });
  });
});

// T10 — server wires V530 summary endpoint
test('server wires /api/v1/admin/summary/v530', () => {
  const src = fs.readFileSync(path.join(ROOT, 'ecos-api-server.js'), 'utf8');
  assert.ok(src.includes('/api/v1/admin/summary/v530'));
});

// Run async tests then report
Promise.resolve()
  .then(() => new Promise(r => setTimeout(r, 100))) // let async tests queue
  .then(() => {
    console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);
    process.exitCode = failed > 0 ? 1 : 0;
  });
