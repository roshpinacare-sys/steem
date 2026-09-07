#!/usr/bin/env node
/**
 * hive_rc.cjs — Task 103: RC-DISCIPLINE (חיילים-מסודרים-אוטונומיים)
 *
 * הממצא-המדוד (2026-09-06): כל-הצי RC-טבוע על Hive — ראש 0.6% · חיילים 2–5.2%.
 * השורש: תביעה-יומית ~120+ ops מול כושר-התחדשות ~12.6B RC/יום (רהגנרציה = 20%
 * מ-max_rc ליום, לכל-חשבון) ≈ 60–80 ops/יום בקיבולת-הצי-כולו. תוצאה:
 * תנודת-רעב — ההולכים שורפים עד-חנק, נכשלים, מתאוששים חלקית, חוזרים לשרוף.
 *
 * הריפוי-הריבוני (הכל-בקובץ-אחד, חסר-סודות):
 *   1. snapshot()   — מדידה-חיה (rc_api + regen מתמטי מדויק) לכל-החשבונות
 *   2. gate()       — שער-לפני-כל-שידור-Hive: RC% ≥ רצפה · יתרה ≥ 2×עלות-משוערת
 *                     · יומן-תקציב נפתח-רק-על-אישור (שקיפות-מלאה)
 *   3. --snapshot   — CLI לבני-אדם/דף/דוח (אפס-סודות)
 *
 * הקבועים-מדודים (he_fleet_sell.cjs 74): HE-market-op ≈143M · transfer ≈150M
 * · custom_json-עד-1KB ≈ 30–80M · account_update ≈ 14% מ-max. רצפת-ברירת-מחדל
 * 8% מעל-היסטוריית-הכשלונות (היה: 5% — נמדד-שגם-מתחתיו-הניסיונות-מייצרים-רעש).
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const AGENT_DIR = __dirname;
const LEDGER_PATH = path.join(AGENT_DIR, 'hive_rc_budget.jsonl');
const SNAPSHOT_PATH = path.join(AGENT_DIR, 'fleet_rc.json');

const HIVE_RPC = ['https://api.hive.blog', 'https://api.deathwing.me', 'https://hive-api.arcange.eu'];
const FLOOR_PCT = 0.08;         // רצפת-שידור-ריבונית (מעל-ה-5% הישן — נמדד)
const HEAVY_PCT = 0.12;         // רצפה ל-op-כבד (account_update/delegation ≈ 14% מ-max)
const REGEN_WINDOW_S = 5 * 86400; // Hive: RC מתחדש 100% על-פני 5 ימים

function rpc(urlStr, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const payload = JSON.stringify(body);
    const req = https.request(
      { hostname: u.hostname, path: u.pathname || '/', method: 'POST', family: 4, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }, timeout: 12000 },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            const j = JSON.parse(data);
            if (j.error) return reject(new Error(j.error.message || 'rpc error'));
            resolve(j.result);
          } catch (_) { reject(new Error('bad rpc response')); }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(12000, () => req.destroy(new Error('timeout')));
    req.write(payload);
    req.end();
  });
}

async function rpcAny(body) {
  let last;
  for (const u of HIVE_RPC) {
    try { return await rpc(u, body); } catch (e) { last = e; }
  }
  throw last || new Error('all hive rpc down');
}

/** מדידה-חיה: rc_api + regen מתמטי (current_mana קפוא-בין-txים — תמיד מחשבים) */
async function snapshot(accounts) {
  const names = accounts.map((a) => String(a).toLowerCase());
  const [rcRes, accRes] = await Promise.all([
    rpcAny({ jsonrpc: '2.0', method: 'rc_api.find_rc_accounts', params: { accounts: names }, id: 1 }),
    rpcAny({ jsonrpc: '2.0', method: 'condenser_api.get_accounts', params: [names], id: 1 }).catch(() => null),
  ]);
  const out = {};
  const rcAccounts = (rcRes && rcRes.rc_accounts) || [];
  // HP conversion needs global props — one extra cheap call (best-effort)
  let hpPerVest = 0;
  try {
    const dgp = await rpcAny({ jsonrpc: '2.0', method: 'condenser_api.get_dynamic_global_properties', params: [], id: 1 });
    const fund = parseFloat(dgp.total_vesting_fund_hive);
    const shares = parseFloat(dgp.total_vesting_shares);
    if (fund > 0 && shares > 0) hpPerVest = fund / shares;
  } catch (_) { /* HP לא קריטי לשער */ }
  const accBy = {};
  for (const a of (accRes && Array.isArray(accRes) ? accRes : [])) accBy[String(a.name).toLowerCase()] = a;
  const nowS = Math.floor(Date.now() / 1000);
  for (const r of rcAccounts) {
    const maxRc = parseInt(r.max_rc || '0', 10);
    const manabar = r.rc_manabar || {};
    const stored = parseInt(manabar.current_mana || '0', 10);
    const lu = parseInt(manabar.last_update_time || '0', 10);
    const regen = Math.floor((Math.max(0, nowS - lu) * maxRc) / REGEN_WINDOW_S);
    const avail = Math.min(maxRc, stored + regen);
    const a = accBy[String(r.account).toLowerCase()];
    out[String(r.account).toLowerCase()] = {
      maxRc,
      avail,
      pct: maxRc > 0 ? avail / maxRc : 0,
      hp: a && hpPerVest ? parseFloat(a.vesting_shares) * hpPerVest : null,
      at: new Date().toISOString(),
    };
  }
  return out;
}

/** יומן-תקציב — שקיפות: כל-אישור-שידור נרשם (אפנד-בלבד) */
function ledgerAppend(entry) {
  try { fs.appendFileSync(LEDGER_PATH, JSON.stringify(entry) + '\n'); } catch (_) { /* לא-חוסם */ }
}

/** ספירת-שידורים-מאושרים היום פר-חשבון (מהיומן) */
function spendToday(account) {
  try {
    const day = new Date().toISOString().slice(0, 10);
    let n = 0;
    for (const line of fs.readFileSync(LEDGER_PATH, 'utf8').split('\n')) {
      if (!line) continue;
      try {
        const e = JSON.parse(line);
        if (e.account === account && String(e.at || '').slice(0, 10) === day) n++;
      } catch (_) { /* שורה-קטועה */ }
    }
    return n;
  } catch (_) { return 0; }
}

/**
 * השער-הריבוני: מותר-לשדר? מחזיר { ok, reason, pct } ורק-על-ok מניחים-שהשידור-יבוצע.
 * estRc = עלות-משוערת (שמרני) · purpose = תווית-שקיפות.
 */
function gate(snap, account, estRc, purpose, floorPct) {
  const s = snap[account];
  if (!s) return { ok: false, reason: 'no-rc-data', pct: null };
  const floor = floorPct != null ? floorPct : (estRc >= 200e6 ? HEAVY_PCT : FLOOR_PCT);
  if (s.pct < floor) return { ok: false, reason: 'rc-floor(' + (s.pct * 100).toFixed(1) + '%<' + Math.round(floor * 100) + '%)', pct: s.pct };
  if (s.avail < estRc * 2) return { ok: false, reason: 'rc-headroom(' + Math.round(s.avail / 1e6) + 'M<' + Math.round((estRc * 2) / 1e6) + 'M)', pct: s.pct };
  ledgerAppend({ at: new Date().toISOString(), account, purpose, estRc: Math.round(estRc), pctBefore: +s.pct.toFixed(4), avail: s.avail });
  return { ok: true, reason: 'ok', pct: s.pct };
}

/** בוחר-החותם-הבריא: ממוין-לפי-RC% עם-שער. מחזיר {account, info} או null. */
function pickHealthiest(snap, candidates, estRc, purpose) {
  const tried = [];
  const ordered = candidates
    .map((c) => ({ account: String(c).toLowerCase(), info: snap[String(c).toLowerCase()] }))
    .filter((x) => x.info)
    .sort((a, b) => b.info.pct - a.info.pct);
  for (const { account, info } of ordered) {
    const g = gate(snap, account, estRc, purpose);
    if (g.ok) return { account, info, pct: g.pct };
    tried.push(account + ':' + g.reason);
  }
  return { account: null, tried };
}

function saveSnapshotFile(snap) {
  try { fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify({ at: new Date().toISOString(), accounts: snap }, null, 2) + '\n'); } catch (_) {}
}

async function main() {
  const args = new Set(process.argv.slice(2));
  let accounts = [...args].filter((a) => a.startsWith('@')).map((a) => a.slice(1));
  if (!accounts.length) {
    // ברירת-מחדל: הצי-מהכספת (בלי-סודות — רק-שמות)
    try {
      const vault = JSON.parse(fs.readFileSync(path.join(AGENT_DIR, 'keys', 'vault.json'), 'utf8'));
      accounts = (vault.accounts || []).map((a) => String(a.username).toLowerCase());
      const env = fs.readFileSync(path.join(AGENT_DIR, '.env'), 'utf8');
      const m = env.match(/^AGENT_ACCOUNT=(.+)$/m);
      if (m) accounts.unshift(m[1].trim().toLowerCase());
    } catch (_) { accounts = ['headcorner']; }
  }
  accounts = [...new Set(accounts)];
  const snap = await snapshot(accounts);
  saveSnapshotFile(snap);
  if (args.has('--snapshot') || args.has('--json')) {
    console.log(JSON.stringify({ at: new Date().toISOString(), accounts: snap }, null, 2));
  } else {
    console.log('=== HIVE RC SNAPSHOT · ' + new Date().toISOString() + ' · floor ' + Math.round(FLOOR_PCT * 100) + '% ===');
    const rows = Object.entries(snap).sort((a, b) => b[1].pct - a[1].pct);
    for (const [name, s] of rows) {
      const bar = '█'.repeat(Math.round(s.pct * 20)).padEnd(20, '░');
      console.log('  @' + name.padEnd(13), 'HP', String(s.hp == null ? '?' : s.hp.toFixed(2)).padStart(7), '· RCmax', String(Math.round(s.maxRc / 1e9)).padStart(3) + 'B', '·', bar, (s.pct * 100).toFixed(1) + '%', s.pct >= FLOOR_PCT ? '✓' : '✗');
    }
    console.log('  regen budget: ' + Math.round(rows.reduce((s, [, x]) => s + x.maxRc, 0) / 1e9 * 0.2) + 'B RC/day fleet-wide ≈ ' + Math.round(rows.reduce((s, [, x]) => s + x.maxRc, 0) * 0.2 / 150e6) + ' HE-ops/day carrying capacity');
  }
}

module.exports = { snapshot, gate, pickHealthiest, saveSnapshotFile, spendToday, FLOOR_PCT, HEAVY_PCT, SNAPSHOT_PATH, LEDGER_PATH };

if (require.main === module) main().catch((e) => { console.error('hive_rc: FATAL ' + ((e && e.message) || e)); process.exit(1); });
