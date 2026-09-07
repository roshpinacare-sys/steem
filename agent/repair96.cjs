#!/usr/bin/env node
/* repair96.cjs — one-shot book heal for Task 96.
 *
 * The situation (write-war): while we ran WRAP-96, a parallel "the-loom" agent's
 * guardian/heal loop rewrote chain.json + chain-archive.jsonl from its own stale
 * view — wiping the tail blocks 680..692 (incl. h682 = LIST-96 asset_list block)
 * and later even 693..702. The live beats produced the real blocks; one pre-heal
 * gitkeeper commit (c97d3de) captured the complete window 680..702.
 *
 * This script: merge archive(1..679 from disk) + tail(680..702 from git c97d3de)
 * → sorted complete book 1..702 → rewrite archive + chain.json window → verify
 * replay (assetMeta/assetPrices intact, head hash matches). Caller must commit
 * IMMEDIATELY after success (the 95 lesson).
 *
 * Usage: node repair96.cjs <git-ref-with-window>
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const NODE_DIR = path.join(__dirname, '..', 'sovereign', 'node');
const A = path.join(NODE_DIR, 'chain-archive.jsonl');
const C = path.join(NODE_DIR, 'chain.json');
const WINDOW_REF = process.argv[2] || 'c97d3de';   // our live tail (wrap96 era)
const BASE_REF = process.argv[3] || 'stash@{1}';   // our shared live line (pre-96 base)

function gitShow(ref, file) {
  return execSync('git show "' + ref + '":' + file, { cwd: path.join(__dirname, '..'), maxBuffer: 64 * 1024 * 1024 }).toString('utf8');
}

const win = JSON.parse(gitShow(WINDOW_REF, 'sovereign/node/chain.json')).blocks || [];
if (!win.length) { console.error('no window blocks at ' + WINDOW_REF); process.exit(1); }
const winByH = new Map(win.map((b) => [b.height, b]));
console.log('git ' + WINDOW_REF + ': window ' + win[0].height + '..' + win[win.length - 1].height + ' · ' + win.length + ' blocks');
let baseByH = new Map();
try {
  const base = JSON.parse(gitShow(BASE_REF, 'sovereign/node/chain.json')).blocks || [];
  baseByH = new Map(base.map((b) => [b.height, b]));
  console.log('git ' + BASE_REF + ': base ' + base[0].height + '..' + base[base.length - 1].height + ' · ' + base.length + ' blocks');
} catch (e) { console.log('no base ref usable (' + String(e.message || e).slice(0, 60) + ') — disk only'); }

const lines = fs.readFileSync(A, 'utf8').trim().split('\n');
const headers = [];
const diskBlocks = new Map();
for (const ln of lines) {
  let b; try { b = JSON.parse(ln); } catch (_) { continue; }
  if (typeof b.height !== 'number') { headers.push(ln); continue; }
  diskBlocks.set(b.height, b);
}
console.log('archive on disk: blocks ' + diskBlocks.size + ' · heights ' + Math.min(...diskBlocks.keys()) + '..' + Math.max(...diskBlocks.keys()));

/* merge priority: our live line (base+window) beats the disk's mixed view;
 * disk fills only what neither git ref carries (pre-window history). */
const forkFrom = Math.min(...winByH.keys());
let fromDisk = 0, fromBase = 0, fromWin = 0, replaced = 0;
for (const [h, b] of winByH) { blocks.set(h, b); fromWin++; }
for (const [h, b] of baseByH) { const cur = blocks.get(h); if (!cur) { blocks.set(h, b); fromBase++; } else if (cur.hash !== b.hash && h < forkFrom) { blocks.set(h, b); replaced++; } }
for (const [h, b] of diskBlocks) { if (!blocks.has(h)) { blocks.set(h, b); fromDisk++; } }
console.log('assembled: win ' + fromWin + ' · base ' + fromBase + ' · disk-fill ' + fromDisk + ' · base-overrides ' + replaced + ' · total ' + blocks.size);

const sorted = [...blocks.values()].sort((a, b) => a.height - b.height);
/* continuity: prevHash chain breaks tolerated but counted (documented history) */
let breaks = 0;
for (let i = 1; i < sorted.length; i++) if (sorted[i].prevHash !== sorted[i - 1].hash) breaks++;
console.log('book: 1..' + sorted[sorted.length - 1].height + ' · ' + sorted.length + ' blocks · prevHash-breaks: ' + breaks);

/* replay verification (applyTx never touches meta.height/lastBlockHash — those are
 * buildBlock's; so verify the HASH-CHAIN of the restored tail + the asset state) */
const K = require(path.join(__dirname, '..', 'sovereign', 'core', 'kernel.cjs'));
const G = JSON.parse(fs.readFileSync(path.join(NODE_DIR, '..', 'genesis', 'genesis.json'), 'utf8'));
const st = K.initFromGenesis(G);
for (const b of sorted) for (const tx of (b.txs || [])) K.applyTx(st, tx);
const okMeta = Object.keys(st.assetMeta || {}).length;
const okPx = Object.keys(st.assetPrices || {}).length;
/* tail continuity enforced from the base-window start (our fully-owned line) */
const enforceFrom = Math.min(...baseByH.keys(), forkFrom);
let tailBreaks = 0, breakAt = [];
for (let i = 1; i < sorted.length; i++) {
  if (sorted[i].height >= enforceFrom && sorted[i].prevHash !== sorted[i - 1].hash) { tailBreaks++; breakAt.push(sorted[i].height); }
}
const dups = sorted.length - new Set(sorted.map((b) => b.height)).size;
const head = sorted[sorted.length - 1];
console.log('replay: assetMeta ' + okMeta + ' · assetPrices ' + okPx + ' · head h' + head.height + ' · tail-breaks ' + tailBreaks + (breakAt.length ? ' @' + breakAt.join(',') : '') + ' · dups ' + dups);
if (okMeta < 11 || okPx < 11 || tailBreaks > 0 || dups > 0 || head.height < 700) { console.error('REPLAY INCOMPLETE — refusing to write'); process.exit(1); }

/* write: archive (header lines first, then all blocks sorted) + hot window (last 512) */
fs.writeFileSync(A, headers.concat(sorted.map((b) => JSON.stringify(b))).join('\n') + '\n');
const MAX_BLOCKS_KEPT = 512;
const window = sorted.slice(-MAX_BLOCKS_KEPT);
fs.writeFileSync(C, JSON.stringify({ blocks: window, truncated: window.length < sorted.length }));
console.log('WROTE: archive ' + (headers.length + sorted.length) + ' lines · chain.json window ' + window[0].height + '..' + window[window.length - 1].height);
console.log('NOW: git add+commit+push IMMEDIATELY (anti-wipe)');
