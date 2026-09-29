#!/usr/bin/env node
/* wblurt_recon.cjs — Task 99b: פיוס-כיסוי-אטומי של WBLURT (תיקון-תקלת-החלון).
 *
 * התקלה-הנמדדת: BURN ו-RELEASE כשתי-משימות (שני-beats) פתחו חלון — מנוע-הגריד
 * ראה "עודף-כיסוי" (locked 134.48 מול supply 64.62 אחרי-ה-burn) ומינט-מחדש
 * 68.514 מול המנעול-המת (h10446) → הספר-תחת-מגובה.
 * התיקון: משימה-אחת-אטומית → בלוק-אחד → אפס-חלון.
 *
 * מדידה-חיה → excess = supply − bal → wrap_burn-יחיד (locked כבר-מפוסק-נכון).
 */
// 8-b: חשבון-פעולה חובה לפני-כל-טעינה — אין ברירת-מחדל, לעולם (המשך 7-c · docs/117o-KEY-INCIDENT.md)
if (!process.env.AGENT_ACCOUNT) { console.error('usage: AGENT_ACCOUNT=<account> node agent/wblurt_recon.cjs — no default acting account (2026-09-08 incident)'); process.exit(1); }
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const AGENT_DIR = __dirname;
const NODE_DIR = path.join(AGENT_DIR, '..', 'sovereign', 'node');
const PENDING = path.join(AGENT_DIR, 'chaintalk_pending.json');

function loadDotEnv(dir) {
  try {
    for (const line of fs.readFileSync(path.join(dir, '.env'), 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch (_) {}
}
loadDotEnv(AGENT_DIR);
const ACCOUNT = (process.env.AGENT_ACCOUNT || '').toLowerCase();
const { rpcV4 } = require('./anchor.cjs');

(async () => {
  // 1) מדידה חיה
  const a = (await rpcV4('https://rpc.beblurt.com', { jsonrpc: '2.0', method: 'condenser_api.get_accounts', params: [['headcorner']], id: 1 }))[0] || {};
  const bal = Number(String(a.balance || '0').split(' ')[0]);
  console.log('live BLURT:', bal);

  // 2) supply נוכחי מה-snapshot החי
  const snap = JSON.parse(fs.readFileSync(path.join(NODE_DIR, 'state-snapshot.json'), 'utf8'));
  const w = (snap.st.wrapped || {}).WBLURT || {};
  const supply = Number(w.supply || 0) / 1000;
  const locked = Number(w.locked || 0) / 1000;
  console.log('book: h' + snap.height, 'supply=' + supply, 'locked=' + locked, 'cover=' + (locked > 0 ? (supply / locked * 100).toFixed(1) + '%' : '-'));

  const excess = +(supply - bal).toFixed(3);
  if (excess <= 0.0005) {
    console.log('cover already exact-or-under (excess=' + excess + ') — nothing to burn');
    process.exit(0);
  }

  // 3) משימה אטומית — burn-יחיד (locked כבר-נמוך-נכון; אין-מה-לשחרר)
  const ref = 'blurt:burn:recon:' + Date.now();
  const pf = JSON.parse(fs.readFileSync(PENDING, 'utf8'));
  pf.missions.push({ id: 'RECON-99B-' + Date.now(), status: 'pending', issuedAt: new Date().toISOString(), issuer: ACCOUNT, ops: [{ type: 'wrap_burn', symbol: 'WBLURT', from: ACCOUNT, amount: excess, ref, mirror: 'g99-blurt-recon', note: 'atomic over-cover correction: supply ' + supply + ' → live ' + bal + ' (burn ' + excess + ' · window-race artifact h10446 invalidated)' }] });
  fs.writeFileSync(PENDING, JSON.stringify(pf, null, 2) + '\n');
  console.log('mission issued: wrap_burn', excess, 'ref', ref);

  // 4) פעימה אחת — המשימה נכנסת לבלוק-חתום
  const r = spawnSync('node', ['saosnet.cjs', '--live'], { cwd: NODE_DIR, timeout: 300000, encoding: 'utf8' });
  console.log('beat exit=' + r.status);

  // 5) אימות
  const snap2 = JSON.parse(fs.readFileSync(path.join(NODE_DIR, 'state-snapshot.json'), 'utf8'));
  const w2 = (snap2.st.wrapped || {}).WBLURT || {};
  console.log('after: h' + snap2.height, 'supply=' + w2.supply / 1000, 'locked=' + w2.locked / 1000, 'cover=' + (w2.locked > 0 ? (w2.supply / w2.locked * 100).toFixed(1) + '%' : '-'), '· ref-found=' + !!((w2.refs || {})[ref]));
  process.exit(0);
})().catch((e) => { console.error('recon FATAL:', e.message); process.exit(1); });
