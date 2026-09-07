// ============================================================
// src/lib/sandboxExec225.js — Sandbox Exec (P114)
// V225 / Stage 3. Per-project command execution.
//
// Two backends:
//   • 'local'  → child_process.spawn inside workspaceRoot, with a
//                command allowlist + per-call timeout + output cap.
//                Default backend; zero external deps.
//   • 'docker' → spawn('docker', ['run', ...]) using a pinned image
//                with a bind-mount to workspaceRoot. Activated by
//                passing { backend: 'docker', image: 'node:20' }.
//
// Streaming: every chunk of stdout/stderr is delivered via onEvent
// ({ type:'stdout'|'stderr', chunk }) and a final 'exit' event with
// { code, signal, durationMs, truncated }.
//
// Audit: every exec writes a record to _eventLog181 (op:'exec').
//
// No npm deps. Identifiers end in 225.
// ============================================================
'use strict';

const { spawn } = require('child_process');
const path = require('path');
const fs   = require('fs');

const DEFAULT_TIMEOUT_MS_225 = 60_000;
const MAX_TIMEOUT_MS_225     = 10 * 60_000;
const DEFAULT_OUTPUT_CAP_225 = 1_000_000; // 1 MB stdout+stderr each
const DEFAULT_ALLOWLIST_225  = Object.freeze([
  'node', 'bun', 'pnpm', 'npm', 'npx', 'yarn',
  'python', 'python3', 'pip', 'pip3',
  'git', 'rg', 'grep', 'sed', 'awk',
  'ls', 'cat', 'echo', 'pwd', 'mkdir', 'rm', 'cp', 'mv', 'touch',
  'curl', 'wget',
  'true', 'false', 'sh',
]);

function _logEvent225(_eventLog181, evt) {
  if (!Array.isArray(_eventLog181)) return;
  _eventLog181.push({ ts: Date.now(), source: 'sandboxExec225', ...evt });
  while (_eventLog181.length > 10_000) _eventLog181.shift();
}

function _splitCmd225(cmd) {
  if (typeof cmd !== 'string') throw new Error('SANDBOX_225: cmd must be a string');
  const trimmed = cmd.trim();
  if (!trimmed) throw new Error('SANDBOX_225: empty command');
  // Simple shell-safe split: split on whitespace, but keep quoted segments.
  const parts = [];
  let buf = '';
  let quote = null;
  for (let i = 0; i < trimmed.length; i++) {
    const c = trimmed[i];
    if (quote) {
      if (c === quote) { quote = null; continue; }
      buf += c;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (/\s/.test(c)) {
      if (buf) { parts.push(buf); buf = ''; }
    } else if (c === '|' || c === '&' || c === ';' || c === '>' || c === '<' || c === '`' || c === '$') {
      throw new Error(`SANDBOX_225: shell metacharacter "${c}" not allowed`);
    } else {
      buf += c;
    }
  }
  if (quote) throw new Error('SANDBOX_225: unbalanced quote');
  if (buf) parts.push(buf);
  return parts;
}

function createSandboxExec225(opts) {
  const o = opts || {};
  const workspaceRoot = o.workspaceRoot;
  if (!workspaceRoot || !path.isAbsolute(workspaceRoot)) {
    throw new Error('SANDBOX_225: workspaceRoot (absolute path) required');
  }
  if (!fs.existsSync(workspaceRoot)) fs.mkdirSync(workspaceRoot, { recursive: true });
  const backend       = o.backend === 'docker' ? 'docker' : 'local';
  const image         = o.image || 'node:20';
  const allowlist     = Array.isArray(o.allowlist) ? o.allowlist.slice() : DEFAULT_ALLOWLIST_225.slice();
  const defaultTimeout = typeof o.timeoutMs === 'number' ? o.timeoutMs : DEFAULT_TIMEOUT_MS_225;
  const outputCap     = typeof o.outputCap === 'number' ? o.outputCap : DEFAULT_OUTPUT_CAP_225;
  const _eventLog181  = Array.isArray(o._eventLog181) ? o._eventLog181 : [];
  const spawnImpl     = typeof o.spawnImpl === 'function' ? o.spawnImpl : spawn;
  const envWhitelist  = Array.isArray(o.envWhitelist) ? o.envWhitelist : ['PATH', 'HOME', 'LANG', 'LC_ALL'];

  function _filteredEnv225() {
    const out = {};
    for (const k of envWhitelist) if (process.env[k] != null) out[k] = process.env[k];
    return out;
  }

  function exec(cmd, opts2) {
    const o2 = opts2 || {};
    const onEvent = typeof o2.onEvent === 'function' ? o2.onEvent : () => {};
    let timeout = typeof o2.timeoutMs === 'number' ? o2.timeoutMs : defaultTimeout;
    if (timeout > MAX_TIMEOUT_MS_225) timeout = MAX_TIMEOUT_MS_225;

    let parts;
    try { parts = _splitCmd225(cmd); }
    catch (e) {
      _logEvent225(_eventLog181, { op: 'exec', cmd, ok: false, error: e.message });
      return Promise.resolve({ ok: false, code: 'BAD_CMD_225', error: e.message, stdout: '', stderr: '' });
    }
    const head = parts[0];
    if (!allowlist.includes(head)) {
      _logEvent225(_eventLog181, { op: 'exec', cmd, ok: false, error: 'NOT_ALLOWED' });
      return Promise.resolve({ ok: false, code: 'NOT_ALLOWED_225', error: `command "${head}" not in allowlist`, stdout: '', stderr: '' });
    }

    let argv0, argv;
    let cwd;
    if (backend === 'docker') {
      argv0 = 'docker';
      argv = ['run', '--rm', '-i', '--network=none',
              '-v', `${workspaceRoot}:/workspace`,
              '-w', '/workspace',
              image, ...parts];
      cwd = process.cwd();
    } else {
      argv0 = head;
      argv = parts.slice(1);
      cwd = o2.cwd ? path.resolve(workspaceRoot, o2.cwd) : workspaceRoot;
      const prefix = path.resolve(workspaceRoot) + path.sep;
      if (cwd !== path.resolve(workspaceRoot) && !cwd.startsWith(prefix)) {
        return Promise.resolve({ ok: false, code: 'BAD_CWD_225', error: 'cwd outside workspace', stdout: '', stderr: '' });
      }
    }

    return new Promise((resolve) => {
      const started = Date.now();
      let child;
      try {
        child = spawnImpl(argv0, argv, { cwd, env: _filteredEnv225() });
      } catch (e) {
        _logEvent225(_eventLog181, { op: 'exec', cmd, ok: false, error: e.message });
        return resolve({ ok: false, code: 'SPAWN_FAILED_225', error: e.message, stdout: '', stderr: '' });
      }
      let stdout = '';
      let stderr = '';
      let truncated = false;
      const timer = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch { /* noop */ }
      }, timeout);

      if (child.stdout && child.stdout.on) child.stdout.on('data', (b) => {
        const s = b.toString('utf8');
        if (stdout.length + s.length > outputCap) {
          stdout += s.slice(0, Math.max(0, outputCap - stdout.length));
          truncated = true;
        } else {
          stdout += s;
        }
        onEvent({ type: 'stdout', chunk: s });
      });
      if (child.stderr && child.stderr.on) child.stderr.on('data', (b) => {
        const s = b.toString('utf8');
        if (stderr.length + s.length > outputCap) {
          stderr += s.slice(0, Math.max(0, outputCap - stderr.length));
          truncated = true;
        } else {
          stderr += s;
        }
        onEvent({ type: 'stderr', chunk: s });
      });
      child.on('error', (e) => {
        clearTimeout(timer);
        _logEvent225(_eventLog181, { op: 'exec', cmd, ok: false, error: e.message });
        resolve({ ok: false, code: 'CHILD_ERROR_225', error: e.message, stdout, stderr });
      });
      child.on('close', (code, signal) => {
        clearTimeout(timer);
        const durationMs = Date.now() - started;
        const result = { ok: code === 0, code, signal: signal || null, durationMs, truncated, stdout, stderr };
        _logEvent225(_eventLog181, { op: 'exec', cmd, ok: result.ok, code, signal: result.signal, durationMs, truncated });
        onEvent({ type: 'exit', code, signal: result.signal, durationMs, truncated });
        resolve(result);
      });
    });
  }

  return { backend, image, allowlist, workspaceRoot: path.resolve(workspaceRoot), exec, _eventLog181 };
}

module.exports = {
  DEFAULT_TIMEOUT_MS_225,
  MAX_TIMEOUT_MS_225,
  DEFAULT_OUTPUT_CAP_225,
  DEFAULT_ALLOWLIST_225,
  createSandboxExec225,
  _splitCmd225,
};
