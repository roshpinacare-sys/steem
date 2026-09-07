const fs = require('node:fs');
const net = require('node:net');
const tls = require('node:tls');
const http = require('node:http');
const https = require('node:https');
const dns = require('node:dns');

const output = process.env.TITAI_NETWORK_ATTEMPT_LOG;
function emit(kind, details) {
  if (!output) return;
  const record = {
    at: new Date().toISOString(),
    pid: process.pid,
    ppid: process.ppid,
    executable: process.execPath,
    argv: process.argv.slice(0, 8),
    kind,
    ...details,
  };
  try { fs.appendFileSync(output, `${JSON.stringify(record)}\n`, { mode: 0o600 }); } catch {}
}
function normalizeConnect(args) {
  const first = args[0];
  if (typeof first === 'object' && first) return { host: first.host || first.hostname || 'localhost', port: first.port, path: first.path };
  if (typeof first === 'number') return { port: first, host: typeof args[1] === 'string' ? args[1] : 'localhost' };
  if (typeof first === 'string') return { path: first };
  return {};
}
const originalNetConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function(...args) { emit('tcp_connect', normalizeConnect(args)); return originalNetConnect.apply(this, args); };
const originalTlsConnect = tls.connect;
tls.connect = function(...args) { emit('tls_connect', normalizeConnect(args)); return originalTlsConnect.apply(this, args); };
for (const [module, name] of [[http, 'http'], [https, 'https']]) {
  const original = module.request;
  module.request = function(...args) {
    let target = args[0];
    if (target instanceof URL) target = target.toString();
    emit(`${name}_request`, { target: typeof target === 'string' ? target : target && { protocol: target.protocol, hostname: target.hostname || target.host, port: target.port, path: target.path } });
    return original.apply(this, args);
  };
}
for (const name of ['lookup', 'resolve', 'resolve4', 'resolve6']) {
  const original = dns[name];
  if (typeof original === 'function') dns[name] = function(...args) { emit(`dns_${name}`, { hostname: args[0] }); return original.apply(this, args); };
}
if (typeof globalThis.fetch === 'function') {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = function(input, init) {
    const target = typeof input === 'string' || input instanceof URL ? String(input) : input && input.url;
    emit('fetch', { target, method: init && init.method });
    return originalFetch(input, init);
  };
}
