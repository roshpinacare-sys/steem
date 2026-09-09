#!/usr/bin/env node
/* =====================================================================
 * linkage.cjs — 87 · L9 אחדות-הצי: כל חייל מקושר-היטב לראש (headcorner)
 * =====================================================================
 * הטענה: כל חייל בכספת נושא את @headcorner בסמכות-הפוסטינג שלו (account_auths,
 * משקל ≥ סף) על שתי השרשראות — בדיוק העוגן שהוכח עבור @ynet (Task 55/57/86).
 * כך הצבא הוא גוף אחד: הראש יכול לדבר דרך כל חייל, וכל חייל מעוגן-מוכח-מהשרשרת.
 *
 * לא למחוק מפתחות — חוק-מוחלט:
 *   ה-audit חסר-מפתחות לגמרי (נתונים-ציבוריים בלבד + טביעות-אצבע מהכספת).
 *   ה-fix בונה account_update שנוגע *רק* בסמכות-הפוסטינג ורק *מוסיף* רשות-
 *   חשבון אחת; key_auths מועתק מילה-במילה מהשרשרת (אפס-מחיקה, אפס-סיבוב),
 *   owner/active לא נשלחים כלל ב-op (שדות חסרים = לא נוגעים), memo_key נשמר.
 *
 * שימוש:
 *   node linkage.cjs --audit        # audit בלבד (חסר-מפתחות) → linkage_report.json
 *   node linkage.cjs --fix          # audit → תיקון-מקושרים (חתימה ב-active של החייל עצמו) → audit חוזר
 *   node linkage.cjs --audit --json # פלט-מכונה לstdout (בלי סודות — בטוח ל-API)
 * ===================================================================== */
const fs = require('fs');
const path = require('path');
const https = require('https');

const STEEM = 'https://api.steemit.com';
const HIVE = 'https://api.hive.blog';
const HIVE_CHAIN_ID = 'beeab0de00000000000000000000000000000000000000000000000000000000';
const STEEM_FALLBACKS = ['https://steemapi.boylikegirl.club', 'https://api.justyy.com'];
const HIVE_FALLBACKS = ['https://api.deathwing.me', 'https://hive-api.arcange.eu'];

const ARGS = new Set(process.argv.slice(2));
const WANT_FIX = ARGS.has('--fix');
const WANT_JSON = ARGS.has('--json');
const REPORT_PATH = path.join(__dirname, 'linkage_report.json');
const LOCK_PATH = path.join(__dirname, 'linkage.lock');
const { resolveLiveGate, announceGate } = require('./lib/live_gate.cjs');
const GATE = resolveLiveGate(process.argv);
const DRY = GATE.dry;
if (WANT_FIX) announceGate(GATE);

// שער-תיקון: מתחת-לאחוז-זה ה-op יידחה בוודאות (נמדד: account_update ≈ 14% ממקס-RC) — חוסך-ניסיונות חינם
const RC_FIX_MIN_PCT = 0.10;
const urlsOf = (chain) => (chain === 'steem' ? [STEEM, ...STEEM_FALLBACKS] : [HIVE, ...HIVE_FALLBACKS]);

/* singleton-lock: דמון + guardian + API יכולים להריץ במקביל — שידור-כפול
 * של account_update הוא בזבוז-RC. מנעול ניגף-אוטומטית אחרי 10 דק' */
function acquireLock() {
  try {
    const st = fs.statSync(LOCK_PATH);
    if (Date.now() - st.mtimeMs < 600000) return false; // נעול וטרי — צא בשקט
  } catch (_) {}
  try { fs.writeFileSync(LOCK_PATH, String(process.pid) + '@' + new Date().toISOString()); } catch (_) {}
  return true;
}
function releaseLock() {
  try { fs.unlinkSync(LOCK_PATH); } catch (_) {}
}

/* ── RPC (family:4, כמו הדמון) ─────────────────────────────────────────── */
function rpc(urlStr, body) {
  const u = new URL(urlStr);
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname || '/',
        method: 'POST',
        family: 4,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
        timeout: 12000,
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json.error) return reject(new Error(json.error.message || 'rpc error'));
            resolve(json.result);
          } catch (_) {
            reject(new Error('bad rpc response'));
          }
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('rpc timeout 12s')));
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}
async function rpcAny(urls, method, params) {
  let lastErr = null;
  for (let pass = 0; pass < 2; pass++) {
    for (const url of urls) {
      try {
        return await rpc(url, { jsonrpc: '2.0', method, params, id: 1 });
      } catch (e) {
        lastErr = e;
      }
    }
  }
  throw lastErr || new Error('all rpc endpoints failed');
}
/* מקור-אמת אחד ל-RC חי: המנה הנוכחית מהרשת (כולל-regen מ-last_update) */
async function rcLive(urls, name) {
  try {
    const r = await rpcAny(urls, 'rc_api.find_rc_accounts', { accounts: [name] });
    const a = (r && r.rc_accounts && r.rc_accounts[0]) || null;
    if (!a) return null;
    const maxRc = parseInt(a.max_rc || '0');
    const stored = parseInt((a.rc_manabar && a.rc_manabar.current_mana) || '0');
    const lu = parseInt((a.rc_manabar && a.rc_manabar.last_update_time) || '0');
    const regen = Math.floor((Math.max(0, Math.floor(Date.now() / 1000) - lu) * maxRc) / (5 * 86400));
    return { have: stored + regen, max: maxRc };
  } catch (_) {
    return null;
  }
}
const getAccounts = (urls, names) =>
  rpcAny(urls, 'condenser_api.get_accounts', [names]).then((r) => (Array.isArray(r) ? r : []));
const rcPct = async (urls, names) => {
  try {
    const r = await rpcAny(urls, 'rc_api.find_rc_accounts', { accounts: names });
    const out = {};
    for (const a of (r && r.rc_accounts) || []) {
      const maxRc = parseInt(a.max_rc || '0');
      const stored = parseInt((a.rc_manabar && a.rc_manabar.current_mana) || '0');
      const lu = parseInt((a.rc_manabar && a.rc_manabar.last_update_time) || '0');
      const regen = Math.floor((Math.max(0, Math.floor(Date.now() / 1000) - lu) * maxRc) / (5 * 86400));
      out[a.account] = maxRc > 0 ? Math.min(1, (stored + regen) / maxRc) : 0;
    }
    return out;
  } catch (_) {
    return {}; // ירידה-כנה: אין-נתון, לא-חסימה
  }
};

/* ── טעינת כספת + ראש ─────────────────────────────────────────────────── */
function loadVault() {
  const v = JSON.parse(fs.readFileSync(path.join(__dirname, 'keys', 'vault.json'), 'utf8'));
  if (!v || !Array.isArray(v.accounts)) throw new Error('vault.json malformed');
  return v.accounts;
}
function loadHead() {
  try {
    const env = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
    const m = env.match(/^AGENT_ACCOUNT=(.+)$/m);
    if (m) return m[1].trim().replace(/^@/, '').toLowerCase();
  } catch (_) {}
  return 'headcorner';
}

/* ── audit: חסר-מפתחות לחלוטין ─────────────────────────────────────────── */
function authorityKeys(account, role, vaultPub) {
  if (!vaultPub) return null; // אין-טביעת-אצבע להשוואה
  if (role === 'memo') return String(account.memo_key || '') === vaultPub;
  const auth = account[role] && account[role].key_auths;
  if (!Array.isArray(auth)) return false;
  return auth.some(([pub]) => String(pub) === vaultPub);
}
function auditOne(chainAcc, head, entry) {
  const posting = (chainAcc && chainAcc.posting) || {};
  const threshold = posting.weight_threshold != null ? posting.weight_threshold : null;
  const hit = (posting.account_auths || []).find(
    ([n]) => String(n).toLowerCase() === head
  );
  const keys = {};
  let keysChecked = 0;
  const roleMap = { posting: 'posting', active: 'active', owner: 'owner' };
  for (const [role, key] of Object.entries(roleMap)) {
    const pub = entry.keys && entry.keys[key] && entry.keys[key].pub;
    if (!pub) continue;
    keys[key] = authorityKeys(chainAcc, key, pub);
    keysChecked++;
  }
  const memoPub = entry.keys && entry.keys.memo && entry.keys.memo.pub;
  if (memoPub) {
    keys.memo = authorityKeys(chainAcc, 'memo', memoPub);
    keysChecked++;
  }
  return {
    exists: Boolean(chainAcc),
    linked: Boolean(hit && threshold != null && hit[1] >= threshold),
    weight: hit ? hit[1] : null,
    threshold,
    keysIntact: keysChecked > 0 ? keys : null,
    keysChecked,
    canFix: Boolean(entry.keys && entry.keys.active && entry.keys.active.wif),
  };
}

/* ── fix: הוספת הראש לסמכות-הפוסטינג — בחתימת ה-active של החייל עצמו ── */
async function fixChain(chain, soldier, chainAcc, head, activeWif) {
  const urls = chain === 'steem' ? [STEEM, ...STEEM_FALLBACKS] : [HIVE, ...HIVE_FALLBACKS];
  const posting = chainAcc.posting;
  const account_auths = (posting.account_auths || []).map(([n, w]) => [n, w]);
  const key_auths = (posting.key_auths || []).map(([p, w]) => [p, w]); // מילה-במילה — אפס-מחיקה
  const weight_threshold = posting.weight_threshold != null ? posting.weight_threshold : 1;
  const addWeight = Math.max(1, weight_threshold);
  account_auths.push([head, addWeight]);
  account_auths.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  const op = [
    'account_update',
    {
      account: soldier,
      posting: { weight_threshold, account_auths, key_auths },
      memo_key: chainAcc.memo_key,
      json_metadata: '',
    },
  ];
  const steem = require('steem');
  const dgp = await rpcAny(urls, 'condenser_api.get_dynamic_global_properties', []);
  const tx = {
    ref_block_num: dgp.head_block_number & 0xffff,
    ref_block_prefix: Buffer.from(dgp.head_block_id, 'hex').readUInt32LE(4),
    expiration: new Date(new Date(dgp.time + 'Z').getTime() + 60000).toISOString().slice(0, 19),
    operations: [op],
    extensions: [],
  };
  const prevChainId = steem.config.get('chain_id');
  steem.config.set('chain_id', chain === 'hive' ? HIVE_CHAIN_ID : prevChainId);
  let signed;
  try {
    signed = steem.auth.signTransaction(tx, [activeWif]);
  } finally {
    steem.config.set('chain_id', prevChainId);
  }
  if (chain === 'steem') {
    const conf = await rpcAny(urls, 'condenser_api.broadcast_transaction_synchronous', [signed]);
    return { txid: (conf && (conf.id || conf.tx_id)) || null, verified: true };
  }
  // Hive: broadcast + אימות-קריאה מהיסטוריית החותם
  await rpcAny(urls, 'condenser_api.broadcast_transaction', [signed]);
  for (let attempt = 0; attempt < 3; attempt++) {
    await new Promise((r) => setTimeout(r, 3000));
    try {
      const hist = await rpcAny(urls, 'condenser_api.get_account_history', [soldier, -1, 10]);
      for (const [, e] of hist) {
        if (e.op[0] !== 'account_update' || e.op[1].account !== soldier) continue;
        const aa = (e.op[1].posting && e.op[1].posting.account_auths) || [];
        if (aa.some(([n]) => String(n).toLowerCase() === head)) return { txid: e.trx_id || null, verified: true };
      }
    } catch (_) { /* retry */ }
  }
  return { txid: null, verified: false, note: 'broadcast accepted, indexer lag — recheck on next audit' };
}

/* ── ראשי ──────────────────────────────────────────────────────────────── */
async function main() {
  if (WANT_FIX && !acquireLock()) {
    if (WANT_JSON) console.log(JSON.stringify({ skipped: 'lock-held' }));
    else console.log('linkage: another fix run holds the lock — skipping (singleton)');
    process.exit(0);
  }
  try {
    await mainInner();
  } finally {
    if (WANT_FIX) releaseLock();
  }
}

async function mainInner() {
  const head = loadHead();
  const accounts = loadVault().filter((a) => a && a.username && String(a.username).toLowerCase() !== head);
  const names = accounts.map((a) => String(a.username).toLowerCase());

  let steemAccs = [];
  let hiveAccs = [];
  try { steemAccs = await getAccounts([STEEM, ...STEEM_FALLBACKS], names); } catch (e) { steemAccs = []; }
  try { hiveAccs = await getAccounts([HIVE, ...HIVE_FALLBACKS], names); } catch (e) { hiveAccs = []; }
  const steemBy = Object.fromEntries(steemAccs.map((a) => [String(a.name).toLowerCase(), a]));
  const hiveBy = Object.fromEntries(hiveAccs.map((a) => [String(a.name).toLowerCase(), a]));
  const rc = {
    steem: await rcPct([STEEM, ...STEEM_FALLBACKS], names),
    hive: await rcPct([HIVE, ...HIVE_FALLBACKS], names),
  };

  const soldiers = [];
  const fixes = [];
  for (const entry of accounts) {
    const u = String(entry.username).toLowerCase();
    const s = auditOne(steemBy[u], head, entry);
    const h = auditOne(hiveBy[u], head, entry);
    const rec = {
      username: u,
      mode: entry.mode || 'master-derive',
      chains: { steem: s, hive: h },
      rc: { steem: rc.steem[u] != null ? +(rc.steem[u] * 100).toFixed(1) : null, hive: rc.hive[u] != null ? +(rc.hive[u] * 100).toFixed(1) : null },
      fixes: [],
    };

    if (WANT_FIX && !DRY) {
      const activeWif = entry.keys && entry.keys.active && entry.keys.active.wif;
      for (const [chain, st, acc] of [
        ['steem', s, steemBy[u]],
        ['hive', h, hiveBy[u]],
      ]) {
        if (!st.exists || st.linked) continue;
        if (!activeWif) {
          rec.fixes.push({ chain, skipped: 'no-active-wif-in-vault' });
          continue;
        }
        // שער-RC חי: ה-op נדחה-מראש אם המנה נמוכה — מתעדים have/need בכנות
        const live = await rcLive(urlsOf(chain), u);
        if (live && live.max > 0) {
          const pct = live.have / live.max;
          rec.rc[chain] = +(pct * 100).toFixed(1);
          if (pct < RC_FIX_MIN_PCT) {
            rec.fixes.push({ chain, skipped: 'rc-gated', rcPct: +(pct * 100).toFixed(1), note: 'RC regenerates over 5d — linkage loop retries automatically' });
            continue;
          }
        }
        try {
          const res = await fixChain(chain, u, acc, head, activeWif);
          rec.fixes.push({ chain, ...res });
          fixes.push({ username: u, chain, ...res });
        } catch (e) {
          const msg = String((e && e.message) || e);
          const m = msg.match(/has (\d+) RC, needs (\d+) RC/);
          if (m) {
            rec.fixes.push({ chain, skipped: 'rc-gated', rcHave: +m[1], rcNeed: +m[2] });
          } else {
            rec.fixes.push({ chain, error: msg.slice(0, 140) });
          }
        }
      }
    }
    soldiers.push(rec);
  }

  // audit חוזר אחרי-תיקון (הוכחה-מהשרשרת, לא-הצהרה)
  if (WANT_FIX && fixes.length) {
    try {
      steemAccs = await getAccounts([STEEM, ...STEEM_FALLBACKS], names);
      hiveAccs = await getAccounts([HIVE, ...HIVE_FALLBACKS], names);
      const steemBy2 = Object.fromEntries(steemAccs.map((a) => [String(a.name).toLowerCase(), a]));
      const hiveBy2 = Object.fromEntries(hiveAccs.map((a) => [String(a.name).toLowerCase(), a]));
      for (const rec of soldiers) {
        rec.chains.steem = auditOne(steemBy2[rec.username], head, accounts.find((a) => String(a.username).toLowerCase() === rec.username));
        rec.chains.hive = auditOne(hiveBy2[rec.username], head, accounts.find((a) => String(a.username).toLowerCase() === rec.username));
      }
    } catch (_) { /* השאר את ה-audit הראשון — כנות */ }
  }

  // 87 — פלט-קובץ שטוח (steem/hive ברמת-החייל) — צורת-אמת-אחת לקובץ ול-stdout
  for (const r of soldiers) {
    r.steem = r.chains.steem;
    r.hive = r.chains.hive;
  }
  const report = {
    at: new Date().toISOString(),
    head,
    layer: 'L9-fleet-linkage',
    soldiersTotal: soldiers.length,
    linkedChains: soldiers.reduce((n, r) => n + (r.chains.steem.linked ? 1 : 0) + (r.chains.hive.linked ? 1 : 0), 0),
    chainsTotal: soldiers.length * 2,
    allLinked: soldiers.every((r) => r.chains.steem.linked && r.chains.hive.linked),
    fixedNow: fixes.length,
    soldiers,
  };
  try { fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + '\n'); } catch (_) {}

  if (WANT_JSON) {
    // פלט-מכונה ללא-סודות (ל-API): בלי WIF, בלי נתיבי-מפתח
    const clean = {
      at: report.at, head, layer: report.layer, soldiersTotal: report.soldiersTotal,
      linkedChains: report.linkedChains, chainsTotal: report.chainsTotal,
      allLinked: report.allLinked, fixedNow: report.fixedNow,
      soldiers: report.soldiers.map((r) => ({
        username: r.username, mode: r.mode,
        steem: { linked: r.steem.linked, weight: r.chains.steem.weight, exists: r.chains.steem.exists, keysIntact: r.chains.steem.keysIntact },
        hive: { linked: r.chains.hive.linked, weight: r.chains.hive.weight, exists: r.chains.hive.exists, keysIntact: r.chains.hive.keysIntact },
        rc: r.rc, fixes: r.fixes,
      })),
    };
    console.log(JSON.stringify(clean, null, 2));
  } else {
    console.log('L9 fleet-linkage @' + head + ' — ' + report.at);
    for (const r of soldiers) {
      const f = (c) => (r.chains[c].linked ? 'LINKED' : (r.chains[c].exists ? 'NOT-LINKED' : 'MISSING'));
      const k = (c) => (r.chains[c].keysIntact ? Object.entries(r.chains[c].keysIntact).map(([kk, vv]) => kk + ':' + (vv ? 'ok' : 'DRIFT')).join(' ') : 'no-fingerprints');
      console.log('  @' + r.username.padEnd(14) + ' steem=' + f('steem') + ' hive=' + f('hive') + ' | ' + k('steem') + ' | ' + k('hive') + (r.fixes.length ? ' | fixes: ' + JSON.stringify(r.fixes) : ''));
    }
    console.log('allLinked=' + report.allLinked + ' (' + report.linkedChains + '/' + report.chainsTotal + ' chains)' + (WANT_FIX ? ' · fixedNow=' + fixes.length : '') + ' → ' + REPORT_PATH);
  }
  process.exit(report.allLinked ? 0 : 2);
}
main().catch((e) => {
  console.error('linkage: fatal: ' + ((e && e.message) || e));
  process.exit(1);
});
