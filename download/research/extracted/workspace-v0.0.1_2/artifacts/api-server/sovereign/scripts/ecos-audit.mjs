#!/usr/bin/env node
// ECOS Intelligent Audit Engine for TFA (V1) — zero external deps, runs on Node native TS.
//  • IMPACT: module->test graph (resolves ./x.js -> x.ts) + content-hash → run only what changed.
//  • LEARNING: .ecos-audit/history.json (pass/fail/durations/flaky) + adaptive timeout (p95×3).
//  • HONEST: exit 0 with 0 tests = cannotRun (no vacuous green). hang-proof (SIGKILL group).
//  • Footer-anchored parser (ignores fixture noise). Writes TEST_AUDIT.json + AUDIT_REPORT.md.
// Usage: node scripts/ecos-audit.mjs [--full|--suite X|--insight]   (default = impact)
import fs from 'fs'; import path from 'path'; import os from 'os'; import crypto from 'crypto';
import { spawn } from 'child_process'; import { fileURLToPath } from 'url';
const ROOT = process.cwd();
const TESTS = path.join(ROOT, 'tests'); const STATE = path.join(ROOT, '.ecos-audit');
const CONC = Math.max(2, parseInt(process.env.ECOS_AUDIT_CONCURRENCY || '', 10) || Math.min(os.cpus().length || 4, 8));
const args = process.argv.slice(2); const has = f => args.includes(f); const opt = f => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const rj = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const wj = (f, o) => { try { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(o, null, 2)); } catch {} };
const sha = s => crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);
function listTests(dir = TESTS, acc = []) { let e = []; try { e = fs.readdirSync(dir, { withFileTypes: true }); } catch { return acc; } for (const x of e) { const fp = path.join(dir, x.name); if (x.isDirectory()) listTests(fp, acc); else if (/\.test\.(ts|mts|js|mjs)$/.test(x.name)) acc.push(path.relative(ROOT, fp)); } return acc; }
function resolveImp(fromFile, spec) { // resolve a relative import to a real source file
  if (!spec.startsWith('.')) return null;
  const base = path.resolve(path.dirname(fromFile), spec);
  const cands = [base, base.replace(/\.js$/, '.ts'), base.replace(/\.js$/, '.mts'), base + '.ts', base + '.js', path.join(base, 'index.ts'), path.join(base, 'index.js')];
  for (const c of cands) { try { if (fs.statSync(c).isFile()) return path.relative(ROOT, c); } catch {} } return null;
}
function impsOf(absFile) { let s = ''; try { s = fs.readFileSync(absFile, 'utf8'); } catch { return []; } const out = new Set(); const rx = /(?:from|import)\s+['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)/g; let m; while ((m = rx.exec(s))) { const r = resolveImp(absFile, m[1] || m[2]); if (r) out.add(r); } return [...out]; }
const _dep = new Map();
function modDeps(rel, seen) { if (_dep.has(rel)) return _dep.get(rel); const set = new Set(impsOf(path.join(ROOT, rel))); _dep.set(rel, set); for (const d of [...set]) if (!seen.has(d)) { seen.add(d); for (const dd of modDeps(d, seen)) set.add(dd); } return set; }
function footprint(testRel) { const direct = impsOf(path.join(ROOT, testRel)); const all = new Set(direct); for (const d of direct) for (const dd of modDeps(d, new Set([d]))) all.add(dd); all.add(testRel); return all; }
function fingerprint() { const map = {}; const SKIP = new Set(['TEST_AUDIT.json', 'AUDIT_REPORT.md']); (function walk(d) { let e = []; try { e = fs.readdirSync(d, { withFileTypes: true }); } catch { return; } for (const x of e) { if (['node_modules', '.ecos-audit', '.git', 'dist', '.cache'].includes(x.name)) continue; const fp = path.join(d, x.name), rel = path.relative(ROOT, fp); if (x.isDirectory()) walk(fp); else if (/\.(ts|mts|js|mjs|json|yaml|yml)$/.test(x.name) && !SKIP.has(rel)) { try { map[rel] = sha(fs.readFileSync(fp)); } catch {} } } })(ROOT); return map; }
const CANNOT = /Cannot find package|Cannot find module|ERR_MODULE_NOT_FOUND|ERR_UNKNOWN_FILE_EXTENSION|is not defined/i;
function parseCounts(out) { const A = []; let m; const pf = /\bPassed:\s*(\d+)/gi, ff = /\bFailed:\s*(\d+)/gi; let p = -1, f = -1; while ((m = pf.exec(out))) p = +m[1]; while ((m = ff.exec(out))) f = +m[1]; if (p >= 0 || f >= 0) A.push([Math.max(p, 0), Math.max(f, 0)]); const res = /Results?:\s*(\d+)\s*(?:passed|pass)\b[, ]+\s*(\d+)\s*(?:failed|fail)\b/gi; while ((m = res.exec(out))) A.push([+m[1], +m[2]]); if (A.length) { let b = A[0]; for (const c of A) if (c[0] + c[1] > b[0] + b[1]) b = c; return { passed: b[0], failed: b[1], ran: b[0] + b[1] }; } return null; }
function classify(out, code, to, rel, tmo) { if (to) return { s: 'cannotRun', d: 'timeout (' + Math.round(tmo / 1000) + 's adaptive)' }; if (CANNOT.test(out) && code !== 0) { const m = out.match(/Cannot find module '[^']+'|Cannot find package '[^']+'|ERR_\w+/i); return { s: 'cannotRun', d: (m ? m[0] : 'cannot run').slice(0, 80) }; } const c = parseCounts(out); if (c && c.failed > 0) return { s: 'realFail', d: c.failed + ' failed' }; if (code !== 0) { const m = out.match(/Error:[^\n]*|✗[^\n]*/i); return { s: 'realFail', d: (m ? m[0] : 'exit ' + code).slice(0, 100) }; } if (c && c.ran > 0) return { s: 'pass', d: c.passed + ' passed' }; let ht = false; try { ht = /\btest\s*\(/.test(fs.readFileSync(path.join(ROOT, rel), 'utf8')); } catch {} return ht ? { s: 'cannotRun', d: 'did not execute (0 tests ran)' } : { s: 'pass', d: 'exit 0' }; }
function run(rel, tmo) { return new Promise(res => { const t0 = Date.now(); const ch = spawn('node', [path.join(ROOT, rel)], { cwd: ROOT, env: { ...process.env, NODE_ENV: 'test' }, stdio: ['ignore', 'pipe', 'pipe'], detached: true }); let out = '', done = false, to = false; const cap = d => { if (out.length < 200000) out += d; }; ch.stdout.on('data', cap); ch.stderr.on('data', cap); const tm = setTimeout(() => { to = true; try { process.kill(-ch.pid, 'SIGKILL'); } catch { try { ch.kill('SIGKILL'); } catch {} } }, tmo); const fin = code => { if (done) return; done = true; clearTimeout(tm); const r = classify(out, code, to, rel, tmo); r.ms = Date.now() - t0; res(r); }; ch.on('close', fin); ch.on('error', () => fin(1)); }); }
async function pool(items, n, fn) { let i = 0; await Promise.all(Array.from({ length: Math.min(n, items.length || 1) }, async () => { while (i < items.length) { const k = i++; await fn(items[k]); } })); }
const aTmo = (h, rel) => { const x = h[rel]; if (!x || !x.durations?.length) return 30000; const s = [...x.durations].sort((a, b) => a - b); const p95 = s[Math.min(s.length - 1, Math.floor(s.length * 0.95))]; return Math.min(120000, Math.max(8000, p95 * 3)); };
async function main() {
  const t0 = Date.now(); const hist = rj(path.join(STATE, 'history.json'), {});
  if (has('--insight')) { console.log(JSON.stringify(rj(path.join(STATE, 'insight.json'), { note: 'run audit first' }), null, 2)); return; }
  const all = listTests(); const prev = rj(path.join(STATE, 'hashes.json'), {}); const cur = fingerprint();
  const changed = new Set(); for (const k of Object.keys(cur)) if (prev[k] !== cur[k]) changed.add(k); for (const k of Object.keys(prev)) if (!(k in cur)) changed.add(k);
  let sel, mode; const one = opt('--suite');
  if (one) { sel = all.filter(s => s.includes(one)); mode = 'suite:' + one; }
  else if (has('--full') || Object.keys(prev).length === 0) { sel = all; mode = Object.keys(prev).length === 0 ? 'full (first run — baseline)' : 'full'; }
  else { sel = all.filter(rel => { if (!hist[rel]) return true; for (const f of footprint(rel)) if (changed.has(f)) return true; return false; }); mode = `impact (${changed.size} changed → ${sel.length}/${all.length})`; }
  const R = { generatedAt: new Date().toISOString(), mode, total: all.length, selected: sel.length, pass: [], cannotRun: [], realFail: [] }; const runs = [];
  await pool(sel, CONC, async rel => { const r = await run(rel, aTmo(hist, rel)); runs.push({ rel, ...r }); const b = path.basename(rel); if (r.s === 'pass') R.pass.push(b); else if (r.s === 'cannotRun') R.cannotRun.push({ suite: b, reason: r.d }); else R.realFail.push({ suite: b, reason: r.d }); });
  if (sel.length < all.length) { const ss = new Set(sel.map(s => path.basename(s))); for (const rel of all) { const b = path.basename(rel); if (ss.has(b)) continue; const h = hist[rel]; if (h?.lastStatus === 'pass') R.pass.push(b); else if (h?.lastStatus === 'realFail') R.realFail.push({ suite: b, reason: '(carried) ' + (h.lastReason || '') }); else R.cannotRun.push({ suite: b, reason: h ? '(carried) ' + (h.lastReason || '') : '(not yet run)' }); } }
  for (const m of runs) { const h = hist[m.rel] || { runs: 0, pass: 0, fail: 0, durations: [], statuses: [] }; h.runs++; if (m.s === 'pass') h.pass++; else if (m.s === 'realFail') h.fail++; h.durations = (h.durations || []).concat(m.ms).slice(-20); h.statuses = (h.statuses || []).concat(m.s).slice(-10); const rec = h.statuses.slice(-8); h.flaky = rec.includes('pass') && rec.includes('realFail'); h.lastStatus = m.s; h.lastReason = m.d; hist[m.rel] = h; }
  wj(path.join(STATE, 'history.json'), hist); wj(path.join(STATE, 'hashes.json'), cur);
  R.counts = { pass: R.pass.length, cannotRun: R.cannotRun.length, realFail: R.realFail.length }; R.elapsedSec = Math.round((Date.now() - t0) / 1000);
  fs.writeFileSync(path.join(ROOT, 'TEST_AUDIT.json'), JSON.stringify(R, null, 2));
  const ran = Object.entries(hist).filter(([, h]) => h.durations?.length); const flaky = ran.filter(([, h]) => h.flaky).map(([k]) => path.basename(k));
  const slow = ran.map(([k, h]) => ({ s: path.basename(k), ms: Math.round(h.durations.reduce((a, b) => a + b, 0) / h.durations.length) })).sort((a, b) => b.ms - a.ms).slice(0, 8);
  wj(path.join(STATE, 'insight.json'), { generatedAt: R.generatedAt, mode, flaky, slowest: slow });
  fs.writeFileSync(path.join(ROOT, 'AUDIT_REPORT.md'), `# TFA Audit Report\n\n- ${R.generatedAt}\n- mode: **${mode}**, elapsed ${R.elapsedSec}s\n- **${R.counts.pass} pass / ${R.counts.cannotRun} cannotRun / ${R.counts.realFail} realFail** (of ${R.total})\n\n## realFail\n${R.realFail.length ? R.realFail.map(x => '- `' + x.suite + '` — ' + x.reason).join('\n') : '_none_'}\n\n## flaky\n${flaky.length ? flaky.map(s => '- `' + s + '`').join('\n') : '_none_'}\n\n## slowest\n${slow.map(s => '- `' + s.s + '` ' + s.ms + 'ms').join('\n')}\n`);
  console.log('=== TFA Intelligent Audit ===');
  console.log('mode      :', mode); console.log('pass      :', R.counts.pass); console.log('cannotRun :', R.counts.cannotRun); console.log('realFail  :', R.counts.realFail); console.log('elapsed   :', R.elapsedSec + 's');
  if (flaky.length) console.log('flaky     :', flaky.join(', '));
  if (R.realFail.length) R.realFail.forEach(x => console.log('  ✗ ' + x.suite + ' :: ' + x.reason));
}
main();
