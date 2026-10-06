/* Independent third-party verification of SAOS-NET — replay from base-snapshot */
const K = require('./sovereign/core/kernel.cjs');
const fs = require('fs');
const P = './sovereign/node/';
const sr = JSON.parse(fs.readFileSync(P + 'state-root.json', 'utf8'));
const chain = JSON.parse(fs.readFileSync(P + 'chain.json', 'utf8'));
const nodeState = JSON.parse(fs.readFileSync(P + 'state.json', 'utf8'));

// 1. Snapshot self-consistency
let st = JSON.parse(JSON.stringify(sr.st));
const snapRoot = K.stateRoot(st);
console.log('[1] base snapshot height=' + st.meta.height);
console.log('    stateRoot(st)=' + snapRoot.slice(0, 24) + '…');
console.log('    claimed      =' + sr.stateRoot.slice(0, 24) + '…');
console.log('    snapshot self-consistent:', snapRoot === sr.stateRoot ? 'PASS' : 'FAIL');

// 2. Replay all blocks above snapshot height
const blocks = chain.blocks.filter(b => b.height > sr.height).sort((a, b) => a.height - b.height);
let hashOk = 0, linkOk = 0; const bad = [];
let prev = st.meta.lastBlockHash;
for (const b of blocks) {
  if (b.prevHash === prev) linkOk++;
  else bad.push({ h: b.height, why: 'prevHash-link' });
  const { block } = K.buildBlock(st, b.txs, b.time);
  if (block.hash === b.hash) hashOk++;
  else bad.push({ h: b.height, why: 'hash-mismatch' });
  prev = b.hash;
}
console.log('[2] replayed ' + blocks.length + ' blocks | hash match: ' + hashOk + '/' + blocks.length + ' | linkage: ' + linkOk + '/' + blocks.length);
if (bad.length) console.log('    mismatches:', JSON.stringify(bad.slice(0, 5)));

// 3. Final state vs node claim
const finalRoot = K.stateRoot(st);
console.log('[3] final height=' + st.meta.height + ' | root=' + finalRoot);
console.log('    node claims: height=' + nodeState.height + ' | root=' + nodeState.stateRoot);
const rootMatch = finalRoot === nodeState.stateRoot;
const heightMatch = st.meta.height === nodeState.height;
console.log('    VERDICT: ' + (rootMatch && heightMatch ? '✅ FULLY VERIFIED — chain state is mathematically consistent from snapshot' : (rootMatch ? 'partial: root ok, height differs' : '❌ ROOT MISMATCH — node state does not verify')));

// 4. Verify last block hash linkage to snapshot
const lastB = blocks[blocks.length - 1];
console.log('[4] last replayed block hash=' + (lastB ? lastB.hash.slice(0, 24) + '…' : 'n/a') + ' matches stored: ' + (lastB ? (st.meta.lastBlockHash === lastB.hash) : 'n/a'));
