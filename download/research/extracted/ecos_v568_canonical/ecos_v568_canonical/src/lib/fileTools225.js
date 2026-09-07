// ============================================================
// src/lib/fileTools225.js — Sandboxed File Tools (P113)
// V225 / Stage 2. Primitives mirroring Lovable's editor tools:
//   read_file, write_file, line_replace, list_dir, search, delete_file
//
// Safety rules:
//   • workspaceRoot is an absolute path; every path is resolved
//     and MUST start with the workspace prefix (path traversal block).
//   • Optional sacredPaths: relative paths that are read-only.
//   • Optional maxBytes (default 5 MB) limits both reads and writes.
//   • Every action is appended to the supplied _eventLog181 ring
//     so the existing ECOS audit chain captures agent edits.
//
// Zero npm deps. Pure fs + path. Identifiers end in 225.
// ============================================================
'use strict';

const fs = require('fs');
const path = require('path');

const FILE_MAX_BYTES_225 = 5 * 1024 * 1024;
const EVENT_LOG_MAX_225  = 10_000;

function _logEvent225(_eventLog181, evt) {
  if (!Array.isArray(_eventLog181)) return;
  _eventLog181.push({ ts: Date.now(), source: 'fileTools225', ...evt });
  while (_eventLog181.length > EVENT_LOG_MAX_225) _eventLog181.shift();
}

function _resolveSafe225(workspaceRoot, rel) {
  if (typeof rel !== 'string' || rel.length === 0) {
    throw new Error('FILE_TOOLS_225: path is required');
  }
  if (path.isAbsolute(rel)) {
    throw new Error('FILE_TOOLS_225: absolute paths are not allowed');
  }
  const abs = path.resolve(workspaceRoot, rel);
  const prefix = path.resolve(workspaceRoot) + path.sep;
  if (abs !== path.resolve(workspaceRoot) && !abs.startsWith(prefix)) {
    throw new Error('FILE_TOOLS_225: path traversal blocked');
  }
  return abs;
}

function _isSacred225(rel, sacredPaths) {
  if (!Array.isArray(sacredPaths) || sacredPaths.length === 0) return false;
  const norm = rel.split(path.sep).join('/');
  for (const s of sacredPaths) {
    const sn = String(s).split(path.sep).join('/');
    if (norm === sn) return true;
    if (norm.startsWith(sn.replace(/\/$/, '') + '/')) return true;
  }
  return false;
}

function createFileTools225(opts) {
  const o = opts || {};
  const workspaceRoot = o.workspaceRoot;
  if (!workspaceRoot || !path.isAbsolute(workspaceRoot)) {
    throw new Error('FILE_TOOLS_225: workspaceRoot (absolute path) required');
  }
  if (!fs.existsSync(workspaceRoot)) fs.mkdirSync(workspaceRoot, { recursive: true });
  const maxBytes     = typeof o.maxBytes === 'number' ? o.maxBytes : FILE_MAX_BYTES_225;
  const sacredPaths  = Array.isArray(o.sacredPaths) ? o.sacredPaths.slice() : [];
  const _eventLog181 = Array.isArray(o._eventLog181) ? o._eventLog181 : [];

  function readFile(rel) {
    const abs = _resolveSafe225(workspaceRoot, rel);
    if (!fs.existsSync(abs)) {
      _logEvent225(_eventLog181, { op: 'read_file', path: rel, ok: false, error: 'NOT_FOUND' });
      return { ok: false, error: 'NOT_FOUND', code: 'FILE_NOT_FOUND_225' };
    }
    const st = fs.statSync(abs);
    if (st.isDirectory()) return { ok: false, error: 'IS_DIRECTORY', code: 'IS_DIRECTORY_225' };
    if (st.size > maxBytes) return { ok: false, error: 'TOO_LARGE', code: 'TOO_LARGE_225', size: st.size };
    const content = fs.readFileSync(abs, 'utf8');
    _logEvent225(_eventLog181, { op: 'read_file', path: rel, ok: true, bytes: st.size });
    return { ok: true, path: rel, content, bytes: st.size };
  }

  function writeFile(rel, content) {
    if (typeof content !== 'string') return { ok: false, error: 'CONTENT_STRING_REQUIRED', code: 'BAD_CONTENT_225' };
    if (_isSacred225(rel, sacredPaths)) {
      _logEvent225(_eventLog181, { op: 'write_file', path: rel, ok: false, error: 'SACRED' });
      return { ok: false, error: 'SACRED_READONLY', code: 'SACRED_225' };
    }
    if (Buffer.byteLength(content, 'utf8') > maxBytes) {
      return { ok: false, error: 'TOO_LARGE', code: 'TOO_LARGE_225' };
    }
    const abs = _resolveSafe225(workspaceRoot, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    const existed = fs.existsSync(abs);
    fs.writeFileSync(abs, content, 'utf8');
    _logEvent225(_eventLog181, { op: 'write_file', path: rel, ok: true, created: !existed, bytes: Buffer.byteLength(content, 'utf8') });
    return { ok: true, path: rel, created: !existed, bytes: Buffer.byteLength(content, 'utf8') };
  }

  function lineReplace(rel, opts2) {
    const o2 = opts2 || {};
    const firstLine = parseInt(o2.firstLine, 10);
    const lastLine  = parseInt(o2.lastLine, 10);
    const oldContent = String(o2.oldContent == null ? '' : o2.oldContent);
    const newContent = String(o2.newContent == null ? '' : o2.newContent);
    if (!Number.isFinite(firstLine) || !Number.isFinite(lastLine) || firstLine < 1 || lastLine < firstLine) {
      return { ok: false, error: 'BAD_RANGE', code: 'BAD_RANGE_225' };
    }
    if (_isSacred225(rel, sacredPaths)) return { ok: false, error: 'SACRED_READONLY', code: 'SACRED_225' };
    const read = readFile(rel);
    if (!read.ok) return read;
    const lines = read.content.split('\n');
    if (lastLine > lines.length) return { ok: false, error: 'RANGE_OUT_OF_BOUNDS', code: 'BAD_RANGE_225', lines: lines.length };
    const actualOld = lines.slice(firstLine - 1, lastLine).join('\n');
    if (oldContent && actualOld !== oldContent) {
      return { ok: false, error: 'OLD_CONTENT_MISMATCH', code: 'MISMATCH_225', expected: oldContent, actual: actualOld };
    }
    const newLines = newContent === '' ? [] : newContent.split('\n');
    const updated = [...lines.slice(0, firstLine - 1), ...newLines, ...lines.slice(lastLine)].join('\n');
    const w = writeFile(rel, updated);
    if (!w.ok) return w;
    _logEvent225(_eventLog181, { op: 'line_replace', path: rel, ok: true, firstLine, lastLine, replaced: lastLine - firstLine + 1, inserted: newLines.length });
    return { ok: true, path: rel, replaced: lastLine - firstLine + 1, inserted: newLines.length, totalLines: updated.split('\n').length };
  }

  function listDir(rel) {
    const useRoot = !rel || rel === '.' || rel === '/';
    const abs = useRoot ? path.resolve(workspaceRoot) : _resolveSafe225(workspaceRoot, rel);
    if (!fs.existsSync(abs)) return { ok: false, error: 'NOT_FOUND', code: 'NOT_FOUND_225' };
    const st = fs.statSync(abs);
    if (!st.isDirectory()) return { ok: false, error: 'NOT_DIRECTORY', code: 'NOT_DIRECTORY_225' };
    const entries = fs.readdirSync(abs).map(name => {
      const a = path.join(abs, name);
      const s = fs.statSync(a);
      return { name, type: s.isDirectory() ? 'dir' : 'file', size: s.isDirectory() ? null : s.size };
    });
    _logEvent225(_eventLog181, { op: 'list_dir', path: rel || '.', ok: true, count: entries.length });
    return { ok: true, path: rel || '.', entries };
  }

  function deleteFile(rel) {
    if (_isSacred225(rel, sacredPaths)) return { ok: false, error: 'SACRED_READONLY', code: 'SACRED_225' };
    const abs = _resolveSafe225(workspaceRoot, rel);
    if (!fs.existsSync(abs)) return { ok: false, error: 'NOT_FOUND', code: 'NOT_FOUND_225' };
    const st = fs.statSync(abs);
    if (st.isDirectory()) fs.rmSync(abs, { recursive: true, force: true });
    else fs.unlinkSync(abs);
    _logEvent225(_eventLog181, { op: 'delete_file', path: rel, ok: true, wasDir: st.isDirectory() });
    return { ok: true, path: rel };
  }

  function search(query, opts2) {
    const o2 = opts2 || {};
    if (typeof query !== 'string' || query.length === 0) {
      return { ok: false, error: 'QUERY_REQUIRED', code: 'BAD_QUERY_225' };
    }
    const maxMatches = typeof o2.maxMatches === 'number' ? o2.maxMatches : 200;
    const regex = o2.regex ? new RegExp(query, o2.flags || 'g') : null;
    const subdir = o2.path ? _resolveSafe225(workspaceRoot, o2.path) : path.resolve(workspaceRoot);
    const matches = [];
    function walk(dir) {
      if (matches.length >= maxMatches) return;
      let names;
      try { names = fs.readdirSync(dir); } catch { return; }
      for (const name of names) {
        if (name === 'node_modules' || name === '.git') continue;
        const abs = path.join(dir, name);
        let s; try { s = fs.statSync(abs); } catch { continue; }
        if (s.isDirectory()) { walk(abs); continue; }
        if (s.size > maxBytes) continue;
        let content; try { content = fs.readFileSync(abs, 'utf8'); } catch { continue; }
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const hit = regex ? regex.test(line) : line.indexOf(query) !== -1;
          if (regex) regex.lastIndex = 0;
          if (hit) {
            const relAbs = path.relative(workspaceRoot, abs);
            matches.push({ path: relAbs.split(path.sep).join('/'), line: i + 1, text: line });
            if (matches.length >= maxMatches) return;
          }
        }
      }
    }
    walk(subdir);
    _logEvent225(_eventLog181, { op: 'search', query, ok: true, count: matches.length });
    return { ok: true, query, count: matches.length, matches, truncated: matches.length >= maxMatches };
  }

  return {
    workspaceRoot: path.resolve(workspaceRoot),
    sacredPaths,
    readFile, writeFile, lineReplace, listDir, deleteFile, search,
    _eventLog181,
  };
}

module.exports = {
  FILE_MAX_BYTES_225,
  EVENT_LOG_MAX_225,
  createFileTools225,
  _resolveSafe225,
  _isSacred225,
};
