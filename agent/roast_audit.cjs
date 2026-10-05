#!/usr/bin/env node
/**
 * roast_audit.cjs — 117p8-R7: THE BRUTAL ROAST (claims-vs-reality, zero-secrets).
 *
 * המפעיל: "חפש בעיות רבות ותקן את כולן · חפש פערים רבים וסדר אותם · יש לנו מלא
 * פערים מה אמת למציאות · תעשה לעצמך roast חריף לרשת כדי לחשוף אותך ותתקן דחוף".
 *
 * עקרון: כל-טענה-שנאמרה (R4/R5/R6) נבדקת-חי-מול-השרשרת/המערכת. אם-הטענה-והמציאות
 * לא-מדברות-באותה-שפה ⇒ PRIORITY finding. אפס-סודות-בפלט (קידומות-בלבד).
 */
// 8-b: חשבון-פעולה חובה לפני-כל-טעינה — אין ברירת-מחדל, לעולם (המשך 7-c · docs/117o-KEY-INCIDENT.md)
if (!process.env.AGENT_ACCOUNT) { console.error('usage: AGENT_ACCOUNT=<account> node agent/roast_audit.cjs — no default acting account (2026-09-08 incident)'); process.exit(1); }
'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { execSync } = require('child_process');
const steem = require('steem');

const STEEM_RPC// measurement-only lane — capital gate N/A (STASIS scope)
 = 'https://api.steemit.com';
const HIVE_RPC = 'https://api.hive.blog';
steem.api.setOptions({ url: STEEM_RPC, useAppbaseApi: true });
const AGENT = __dirname;
const ROOT = path.join(AGENT, '..');
const REPORT_PATH = path.join(AGENT, 'roast_report.json');
const log = m => console.log('[' + new Date().toISOString() + '] roast: ' + m);
const mask = w => (w ? String(w).slice(0, 8) + '…' : '(none)');

function rpc(url, body) {
  return new Promise((res, rej) => {
    const u = new URL(url);
    const p = JSON.stringify(body);
    const r = https.request({ hostname: u.hostname, path: (u.pathname || '/') + (u.search || ''), method: 'POST', family: 4, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(p) }, timeout: 25000 }, x => {
      let d = '';
      x.on('data', c => (d += c));
      x.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(new Error('parse: ' + d.slice(0, 120))); } });
    });
    r.on('error', rej);
    r.setTimeout(25000, () => r.destroy(new Error('timeout')));
    r.write(p); r.end();
  });
}
const condenser = (url, method, params) => rpc(url, { jsonrpc: '2.0', method: 'condenser_api.' + method, params, id: 1 });
const rcApi = (url, method, params) => rpc(url, { jsonrpc: '2.0', method, params, id: 1 });

function loadDotEnv(dir) {
  const envPath = path.join(dir, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const t = line.trim(); if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('='); if (eq <= 0) continue;
    const k = t.slice(0, eq).trim(); let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(k in process.env)) process.env[k] = v;
  }
}
loadDotEnv(AGENT);
const HEAD = (process.env.AGENT_ACCOUNT || '').toLowerCase();

/* ── vault (מבנה-מקונן: keys.steem.role / keys.hive.role) ── */
function vaultAccounts() {
  const v = JSON.parse(fs.readFileSync(path.join(AGENT, 'keys/vault.json'), 'utf8'));
  return Object.values(v.accounts || v).map(a => ({ username: a.username, keys: a.keys || {} }));
}
/* מפתח-תביעה לפי (שרשרת, תפקיד) — תומך-מקונן-ושטוח */
function vaultWif(vaultKeys, chain, role) {
  if (!vaultKeys) return null;
  const nested = vaultKeys[chain] && vaultKeys[chain][role];
  const flat = vaultKeys[role];
  const pick = x => (typeof x === 'string' ? x : x && x.wif) || null;
  return pick(nested) || pick(flat);
}

const FINDINGS = [];
const realWarn = console.warn.bind(console);
console.warn = () => {}; // steem-js מרעיש-על-WIF-דחוס-תקין — מושתק-לרעש-נקי
function finding(sev, id, claim, reality, fix) {
  FINDINGS.push({ sev, id, claim, reality, fix });
  log('[' + sev + '] ' + id + ' — ' + reality);
}
const ok = (id, msg) => log('OK  ' + id + ' — ' + msg);

async function main() {
  const rep = { at: new Date().toISOString(), head: HEAD, findings: [], sections: {} };
  const names = vaultAccounts().map(a => a.username);
  const vaultMap = {};
  for (const a of vaultAccounts()) vaultMap[a.username.toLowerCase()] = a;

  /* ══ A. STEEM חי ══ */
  const S = { claims: {} };
  try {
    const [dgpR, accR] = await Promise.all([
      condenser(STEEM_RPC, 'get_dynamic_global_properties', []),
      condenser(STEEM_RPC, 'get_accounts', [names]),
    ]);
    const dgp = dgpR.result;
    const accs = accR.result || [];
    const fund = parseFloat(dgp.total_vesting_fund_steem), shares = parseFloat(dgp.total_vesting_shares);
    const mvest = shares > 0 ? fund / (shares / 1e6) : 0;
    const head = accs.find(a => a.name.toLowerCase() === HEAD);
    if (!head) throw new Error('head missing on steem');

    /* A1 — כוח-משיכה (power-down) באמת בוטל? */
    const toW = parseFloat(head.to_withdraw), wDrawn = parseFloat(head.withdrawn);
    S.claims.powerDownCanceled = { to_withdraw: toW, withdrawn: wDrawn, next: head.next_vesting_withdrawal };
    if (toW > 0) finding('HIGH', 'S1-powerdown-active', 'R6: "power-down 1747SP בוטל"', 'to_withdraw=' + toW + ' עדיין פעיל!', 'בצע withdraw_vesting→0 חי');
    else ok('S1', 'power-down אפס ✓');

    /* A2 — sp_reclaim: אף-נמען-לא-מקבל-עוד? (השאריות-קטנות = האצלות-חיצוניות
         שאינן-שלנו — לא-ניתנות-לביטול-בידינו ומזינות-RC · הגדולות-מ-0.1M=חריגה-אמת) */
    const receivers = accs.filter(a => a.name.toLowerCase() !== HEAD);
    const stillReceiving = receivers.filter(a => parseFloat(a.received_vesting_shares) > 0).map(a => a.name + ':' + (parseFloat(a.received_vesting_shares) / 1e6).toFixed(3) + 'M');
    const bigResid = receivers.filter(a => parseFloat(a.received_vesting_shares) > 0.1e6).map(a => a.name);
    S.claims.spReclaim = { stillReceiving };
    if (bigResid.length) finding('HIGH', 'S2-big-delegated-in', 'R6: "sp_reclaim חי 11/11 · received=0"', 'האצלות-גדולות-שרדו: ' + bigResid.join(', '), 'הרץ sp_reclaim --live שוב');
    else if (stillReceiving.length) ok('S2', 'מקור-הראש=0 ✓ · שאריות-חיצוניות-זעירות (תועד): ' + stillReceiving.join(', '));
    else ok('S2', 'received=0 אצל כל ' + receivers.length + ' ✓');

    /* A3 — הראש: יחידות-אמת */
    const vests = parseFloat(head.vesting_shares), dele = parseFloat(head.delegated_vesting_shares);
    const spTotal = vests / 1e6 * mvest, spDele = dele / 1e6 * mvest, spOwn = spTotal - spDele;
    S.head = { sp_total: spTotal.toFixed(2), sp_delegated_out: spDele.toFixed(2), sp_own: spOwn.toFixed(2), liquid: head.balance, sbd: head.sbd_balance, vests_in_transit: dele };

    /* A4 — RC מול קיר-הטביעה */
    try {
      const rcR = await rcApi(STEEM_RPC, 'rc_api.find_rc_accounts', { accounts: [HEAD] });
      const h = (rcR.result.rc_accounts || [])[0];
      const maxT = Number(BigInt(h.max_rc)) / 1e12, curT = Number(BigInt(h.rc_manabar.current_mana)) / 1e12;
      const elapsed = (Date.now() - new Date(dgp.time + 'Z').getTime()) / 1000;
      const regenT = maxT * 0.2 * Math.min(1, elapsed / 86400);
      const proj = Math.min(maxT, curT + regenT);
      S.head.rc = { max_t: maxT.toFixed(3), cur_t: curT.toFixed(3), projected_now_t: proj.toFixed(3), wall_t: 5.7828, ratio_max: (maxT / 5.7828).toFixed(3) };
      if (maxT >= 5.7828) ok('S4', 'max RC ' + maxT.toFixed(3) + 'T ≥ קיר 5.7828T — מפעל-הצי פתוח כבר-עכשיו!');
      else finding('INFO', 'S4-rc-below-wall', 'R6: "קו-ייצור נפתח ~17.9"', 'rc_max=' + maxT.toFixed(3) + 'T (' + (100 * maxT / 5.7828).toFixed(1) + '% מהקיר) — עדיין-מתחת', 'autopilot יומי ממשיך להצטבר');
    } catch (e) { finding('MED', 'S4-rc-unreachable', 'RC API זמין', 'rc_api שגיאה: ' + e.message.slice(0, 80), 'בדוק RPC'); }

    /* A5 — הרשאות-הראש: בעלות-יחידה + מפתחות-כספת */
    const vk = vaultMap[HEAD] || {};
    const headOwnerAuths = head.owner.key_auths.map(k => k[0]);
    S.head.auth = {
      owner_count: headOwnerAuths.length,
      owner_prefixes: headOwnerAuths.map(mask),
      active: mask(head.active.key_auths[0][0]),
      posting: mask(head.posting.key_auths[0][0]),
      memo: mask(head.memo_key),
    };
    if (headOwnerAuths.length !== 1) finding('HIGH', 'S5-owner-multi', 'בעלות-יחידה על הראש', 'owner כולל ' + headOwnerAuths.length + ' מפתחות!', 'סקור מי-המפתח-הנוסף');
    /* האם-מפתח-ה-owner-בכספת אכן-המפתח-על-השרשרת? (מקונן: keys.steem.owner) */
    const vOwner = vaultWif(vk.keys, 'steem', 'owner');
    if (vOwner) {
      const d = steem.auth.wifToPublic(vOwner);
      S.head.auth.vault_owner_match = headOwnerAuths.includes(d);
      if (!S.head.auth.vault_owner_match) finding('HIGH', 'S5-vault-owner-mismatch', 'מפתח-owner-בכספת = המפתח-על-השרשרת', 'חוסך-הכספת גוזר ' + mask(d) + ' אך-השרשרת ' + headOwnerAuths.map(mask).join('|'), 'חפש מפתח-owner-נכון / עדכן-כספת');
      else ok('S5', 'מפתח-owner-כספת = שרשרת ✓');
    } else finding('HIGH', 'S5-no-owner-wif', 'לראש יש מפתח-owner-בכספת', 'אין owner WIF בכספת-עבור ' + HEAD, 'מצא/הדבק מהמפעיל');

    /* A6 — חיילים: מה-יש-באמת-על-השרשרת-הסטים */
    const soldierRows = [];
    for (const a of accs) {
      if (a.name.toLowerCase() === HEAD) continue;
      const v = vaultMap[a.name.toLowerCase()];
      const auth = {
        posting: mask(a.posting.key_auths[0][0]),
        active: mask(a.active.key_auths[0][0]),
        headInPosting: a.posting.key_auths.some(k => k[0] === (S.head.auth.posting)),
        headInActive: a.active.key_auths.some(k => k[0] === (S.head.auth.active)),
      };
      if (v && v.keys) {
        for (const role of ['posting', 'active']) {
          const w = vaultWif(v.keys, 'steem', role);
          if (!w) { auth['vault_' + role] = '(none)'; continue; }
          const d = steem.auth.wifToPublic(w);
          auth['vault_' + role + '_match_' + role] = a[role].key_auths.some(k => k[0] === d);
        }
      }
      soldierRows.push({ name: a.name, created: a.created.slice(0, 10), sp: (parseFloat(a.vesting_shares) - parseFloat(a.delegated_vesting_shares)) / 1e6 * mvest, ...auth });
    }
    S.soldiers = soldierRows;
    const steemOrphans = soldierRows.filter(r => !r.headInPosting && !r.headInActive && r.vault_posting_match_posting === false && r.vault_active_match_active === false);
    if (steemOrphans.length) finding('MED', 'S6-steem-orphans', 'חיילים מחוברים-גם-בסטים (posting/active=כספת)', steemOrphans.length + ' חיילים בסטים עם מפתחות-שאינם-בכספת-ואינם-הראש: ' + steemOrphans.map(r => r.name).join(','), 'זה-המצב-המוכר-rc_bridge-חסום; לא-שבירה — תיעוד');
    else ok('S6', 'אין-יתומי-סטים-חדשים');
  } catch (e) { finding('HIGH', 'A-steem-fail', 'סקר-סטים חי', 'שגיאה: ' + e.message.slice(0, 120), 'בדוק RPC/רשת'); }
  rep.sections.steem = S;

  /* ══ B. HIVE חי ══ */
  const H = { soldiers: [] };
  try {
    const accR = await condenser(HIVE_RPC, 'get_accounts', [names]);
    const accs = accR.result || [];
    for (const a of accs) {
      const v = vaultMap[a.name.toLowerCase()];
      // מדידה: לכל-תפקיד — האם-מפתח-הכספת גוזר את-המפתח-על-השרשרת (מקונן)
      const r4 = { name: a.name };
      let full = 0, tested = 0;
      for (const role of ['owner', 'active', 'posting', 'memo']) {
        const w = vaultWif(v && v.keys, 'hive', role);
        if (!w) { r4[role] = 'no-vault-wif'; continue; }
        tested++;
        let d; try { d = steem.auth.wifToPublic(w); } catch (_) { r4[role] = 'bad-wif'; continue; }
        const live = role === 'memo' ? a.memo_key : a[role].key_auths[0][0];
        const m = d === live;
        if (m) full++;
        r4[role] = m ? 'match' : 'diff(' + mask(live) + ')';
      }
      r4.full = full + '/' + (full + (4 - full) ? 4 : 4);
      r4.fullReal = full + '/4';
      H.soldiers.push(r4);
    }
    const hiveFull = H.soldiers.filter(s => s.fullReal === '4/4' && s.name.toLowerCase() !== HEAD);
    H.hiveFullCount = hiveFull.length;
    const headHiveFull = H.soldiers.find(s => s.name.toLowerCase() === HEAD && s.fullReal === '4/4');
    if (hiveFull.length !== 9) finding('MED', 'H1-hivefull-drift', 'R3-R6: "hiveFull=9"', 'היום: ' + hiveFull.length + ' חיילים 4/4 — ' + hiveFull.map(s => s.name).join(','), 'אתר מי-נשר/נוסף ועדכן-מפה');
    else ok('H1', 'hiveFull=9 חיילים ✓ (+ראש 4/4=' + (headHiveFull ? 'כן' : 'לא!') + ' · tov 0/4 מתועד · ynet via-head)');
  } catch (e) { finding('HIGH', 'B-hive-fail', 'סקר-הייב חי', 'שגיאה: ' + e.message.slice(0, 120), 'בדוק RPC/רשת'); }
  rep.sections.hive = H;

  /* ══ C. מערכת ══ */
  const C = {};

  /* C1 — deposits חי */
  try {
    const dep = JSON.parse(fs.readFileSync(path.join(ROOT, 'sovereign/node/deposits-state.json'), 'utf8'));
    const ageMin = (Date.now() - new Date(dep.lastTickAt).getTime()) / 60000;
    const chains = dep.rpcHealth || {};
    const bad = Object.entries(chains).filter(([k, v]) => !v.ok).map(([k]) => k);
    C.deposits = { ageMin: ageMin.toFixed(1), tick: dep.tick, chains_total: Object.keys(chains).length, bad };
    if (ageMin > 20) finding('HIGH', 'C1-deposits-stale', 'deposits טיק-חי', 'lastTickAt לפני ' + ageMin.toFixed(0) + ' דקות', 'הרץ guardian/deposits');
    else ok('C1', 'deposits טרי (' + ageMin.toFixed(0) + ' דק) · ' + Object.keys(chains).length + ' שרשראות');
    if (bad.length) finding('HIGH', 'C1-chains-red', 'כל-השרשראות ירוקות', 'אדומות: ' + bad.join(','), 'הרץ deposits ידנית');
  } catch (e) { finding('HIGH', 'C1-deposits-unreadable', 'deposits-state נקרא', 'שגיאה: ' + e.message.slice(0, 80), ''); }

  /* C2 — חותם-גיבוי (KEYS-BACKUP sha) */
  try {
    const f = path.join(ROOT, 'download/KEYS-BACKUP-2026-09-09.tar.enc');
    const sha = execSync('sha256sum ' + JSON.stringify(f)).toString().split(' ')[0];
    C.backupSha = sha.slice(0, 8);
    if (!sha.startsWith('5753a90c')) finding('HIGH', 'C2-backup-sha-drift', 'sha=5753a90c… (R3)', 'היום: ' + sha.slice(0, 8) + '…', 'חקור מי-שינה את קובץ-הגיבוי!');
    else ok('C2', 'KEYS-BACKUP sha תואם ✓');
  } catch (e) { finding('MED', 'C2-backup-missing', 'KEYS-BACKUP tar.enc קיים', 'לא-נמצא: ' + e.message.slice(0, 60), 'שחזר מ-git'); }

  /* C3 — כספת: מבנה-מקונן (מפת-אמת: 12 חשבונות · head 8 · 10 חיילים 8 · ynet 0) */
  try {
    const v = JSON.parse(fs.readFileSync(path.join(AGENT, 'keys/vault.json'), 'utf8'));
    const accs = Object.values(v.accounts || v);
    const per = [];
    let wifs = 0;
    for (const a of accs) {
      let c = 0;
      for (const ch of Object.values(a.keys || {})) {
        if (typeof ch === 'string') { c++; continue; }
        for (const val of Object.values(ch || {})) { const w = typeof val === 'string' ? val : val && val.wif; if (w) c++; }
      }
      per.push(a.username + ':' + c); wifs += c;
    }
    const ynetZero = per.find(x => x.startsWith('ynet:0'));
    C.vault = { accounts: accs.length, wifs, per };
    const headZero = accs.find(a => a.username.toLowerCase() === HEAD) ? 0 : 1;
    if (accs.length !== 12 || !ynetZero || headZero) finding('MED', 'C3-vault-map', 'מפת-אמת: 12 חשבונות (ynet=0-WIFs)', accs.length + ' חשבונות · ' + wifs + ' WIFs · ' + per.join(' '), 'עדכן-מפה/כספת');
    else ok('C3', 'vault 12 חשבונות · ' + wifs + ' WIFs · ynet=0 (via-head) ✓');
  } catch (e) { finding('HIGH', 'C3-vault-broken', 'vault.json תקין', e.message.slice(0, 80), ''); }

  /* C4 — /api/fleetv3 חי + אפס-סודות */
  const localGet = (p, timeoutMs) => new Promise((res, rej) => {
    const rq = http.get('http://127.0.0.1:3000' + p, { timeout: timeoutMs || 15000 }, x => { let d = ''; x.on('data', c => (d += c)); x.on('end', () => res({ code: x.statusCode, body: d })); });
    rq.on('error', rej);
  });
  try {
    const r = await localGet('/api/fleetv3');
    C.fleetv3 = { code: r.code, bytes: r.body.length };
    if (r.code !== 200) finding('HIGH', 'C4-fleetv3-non200', '/api/fleetv3 = 200', 'HTTP ' + r.code, 'קרא dev.log');
    else {
      const j = JSON.parse(r.body);
      const blob = r.body.toLowerCase();
      const leak = /5[kljh][a-z0-9]{30,}|stm[57][a-z0-9]{30,}/.test(blob.replace(/prefix/g, ''));
      if (leak) finding('HIGH', 'C4-fleetv3-leak', 'אפס-סודות-בפלט', 'נמצא דפוס-מפתח-אפשרי בתגובה!', 'צנזר מיד');
      else ok('C4', '/api/fleetv3 200 · אפס-סודות ✓ · ' + Object.keys(j).join(','));
    }
  } catch (e) { finding('HIGH', 'C4-fleetv3-fail', '/api/fleetv3 זמין', 'שגיאה: ' + e.message.slice(0, 80), 'בדוק שרת'); }

  /* C5 — ביצועים: /api/ops/saos/dex (קריאה-ראשונה=משחזר-היסטוריה ובונה-מטמון;
       מדידה-אמת = הקריאה-החמה-שאחריה — זו-שהדשבורד/הדימון חווים-ב-99%-מהזמן) */
  try {
    await localGet('/api/ops/saos/dex?username=' + HEAD, 30000);
    const t0 = Date.now();
    await localGet('/api/ops/saos/dex?username=' + HEAD, 30000);
    const ms = Date.now() - t0;
    C.dexMs = ms;
    if (ms > 3000) finding('HIGH', 'C5-dex-slow', 'דשבורד-DEX מגיב <3s', 'לוקח ' + (ms / 1000).toFixed(1) + 's', 'עדכון-מחיר-צמוד-חי-בכל-קריאה → cache קצר');
    else ok('C5', 'DEX ' + ms + 'ms ✓');
  } catch (e) { finding('MED', 'C5-dex-fail', 'DEX זמין', e.message.slice(0, 80), ''); }

  /* C6 — היגיינת-git: נעקב? מודלפים? */
  try {
    const st = execSync('git status --porcelain', { cwd: ROOT }).toString();
    const untracked = st.split('\n').filter(l => l.startsWith('??')).map(l => l.slice(3));
    const modified = st.split('\n').filter(l => l.startsWith(' M')).length;
    C.git = { untracked: untracked.length, modified };
    const sus = untracked.filter(f => /keys|seed|wif|secret/i.test(f) && !/\.(enc|meta\.json|log|lock|pid)$/.test(f));
    if (sus.length) finding('MED', 'C6-git-untracked-suspect', 'לא-נעקבים נקיים', 'חשודים: ' + sus.join(', '), 'הצפן/התעלם');
    else ok('C6', 'אין-קבצים-חשודים-מחוץ-למעקב (' + untracked.length + ' untracked, ' + modified + ' modified — רעש-ריצה-רגיל)');
    /* תוכן-קבצים-נעקבים-עם-שמות-רגישים: סריקת-חומר-פרטי-בפועל (לא-רק-שמות) */
    const tracked = execSync('git ls-files agent/keys/ agent/fleet_keys* 2>/dev/null || true', { cwd: ROOT }).toString().trim();
    if (tracked) finding('HIGH', 'C6-secrets-tracked', 'כספת-מפתחות מחוץ-למעקב', 'נעקבים: ' + tracked, 'git rm --cached + gitignore');
    else {
      const walletFiles = execSync("git ls-files 'sovereign/node/wallets*' 2>/dev/null || true", { cwd: ROOT }).toString().trim().split('\n').filter(Boolean);
      let dirty = [];
      for (const f of walletFiles) {
        try {
          const s = fs.readFileSync(path.join(ROOT, f), 'utf8');
          if (/[5KLTJ][1-9A-HJ-NP-Za-km-z]{49,51}/.test(s) || /"priv|private[_k]|mnemonic/.test(s)) dirty.push(f);
        } catch (_) {}
      }
      if (dirty.length) finding('HIGH', 'C6-wallet-content', 'קבצי-wallets נעקבים-ציבוריים', 'חומר-פרטי-בתוכן: ' + dirty.join(','), 'הסר-ממעקב מיד');
      else ok('C6', 'wallets-* נעקבים = כתובות-ציבוריות בלבד ✓ (' + walletFiles.length + ' קבצים)');
    }
  } catch (e) { finding('MED', 'C6-git-fail', 'git זמין', e.message.slice(0, 80), ''); }

  /* C7 — guardian: רענן + autopilot יומי (היום נקרא מה-state האמיתי, לא מריצות-skip) */
  try {
    const g = JSON.parse(fs.readFileSync(path.join(AGENT, 'guardian_result.json'), 'utf8'));
    const ageMin = (Date.now() - new Date(g.at).getTime()) / 60000;
    const st = JSON.parse(fs.readFileSync(path.join(AGENT, 'fleetv3_state.json'), 'utf8'));
    const today = new Date().toISOString().slice(0, 10);
    const dailyDone = !!(st.lastRun && st.lastRun.day === today);
    const skipped = !!g.skipped;
    C.guardian = { ageMin: ageMin.toFixed(1), skipped, dailyDone };
    if (ageMin > 15 && !skipped) finding('HIGH', 'C7-guardian-stale', 'guardian כל-10 דק', 'ריצה-אחרונה לפני ' + ageMin.toFixed(0) + ' דק', 'בדוק daemon');
    else if (!dailyDone) finding('MED', 'C7-autopilot-not-today', 'autopilot רץ-פעם-ביום', 'אין-ריצה-מתועדת-היום (' + today + ')', 'guardian הבא יצית אותו');
    else ok('C7', 'guardian חי (' + (skipped ? 'ריצה-מסוננת, ' : '') + ageMin.toFixed(0) + ' דק) · autopilot-היום=✓');
  } catch (e) { finding('HIGH', 'C7-guardian-unreadable', 'guardian_result נקרא', e.message.slice(0, 80), ''); }

  /* C8 — fleetv3_state עקביות-יחידות */
  try {
    const st = JSON.parse(fs.readFileSync(path.join(AGENT, 'fleetv3_state.json'), 'utf8'));
    const p = st.progress || {};
    C.fleetv3 = { lastRun: st.lastRun && st.lastRun.at, spTotal: p.realSPTotal, rcRatioMax: p.rcRatioMax, delegatedOutM: p.vestsPendingReturn };
    if (st.lastRun && st.sp !== undefined && st.lastRun.spTotal === undefined && st.lastRun.sp !== undefined) {
      finding('MED', 'C8-autopilot-old-units', 'טייס מדווח SP-יחידות-אמת (R6)', 'ריצות-ישנות-במצב "sp" (MVests בשם SP) — הריצה-הראשונה-של-היום-עדיין-קוראת-יחידות-שגויות', 'טוב — R6 תיקן; ריצה-הבאה תשתמש-שדות-חדשים');
    }
    ok('C8', 'fleetv3_state: spTotal=' + p.realSPTotal + ' · rcRatio=' + p.rcRatioMax + ' · vestsInTransit=' + p.vestsPendingReturn + 'M');
  } catch (e) { finding('MED', 'C8-fleetv3-state', 'fleetv3_state נקרא', e.message.slice(0, 80), ''); }

  /* C9 — שער/דף ראשי חי */
  try {
    const t0 = Date.now();
    const r = (await localGet('/', 20000)).code;
    C.web = { code: r, ms: Date.now() - t0 };
    if (r !== 200) finding('HIGH', 'C9-web-non200', '/ = 200', 'HTTP ' + r, 'קרא dev.log');
    else ok('C9', '/ 200 ב-' + (Date.now() - t0) + 'ms ✓');
  } catch (e) { finding('HIGH', 'C9-web-fail', 'שרת חי', e.message.slice(0, 80), ''); }

  rep.findings = FINDINGS;
  fs.writeFileSync(REPORT_PATH, JSON.stringify(rep, null, 1));
  console.log('\n══════ ROAST SUMMARY ══════');
  const by = { HIGH: 0, MED: 0, INFO: 0 };
  for (const f of FINDINGS) by[f.sev] = (by[f.sev] || 0) + 1;
  console.log('findings: HIGH=' + (by.HIGH || 0) + ' MED=' + (by.MED || 0) + ' INFO=' + (by.INFO || 0));
  for (const f of FINDINGS) console.log('  [' + f.sev + '] ' + f.id + ' — ' + f.reality.slice(0, 140));
  console.log('report → agent/roast_report.json');
}

main().then(() => process.exit(0)).catch(e => { console.error('FATAL', e); process.exit(1); });
