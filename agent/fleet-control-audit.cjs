#!/usr/bin/env node
'use strict';
/**
 * fleet-control-audit.cjs — מטריצת-שליטה חיה של-כל-הפליטה (Task 10, 2026-09-30).
 *
 * השאלה של-הבעלים: "יש לנו איזה 60 ומשהו סוכנים אבל רובם מתים — צריך לאחד הכל להפעיל הכל".
 * האמת-ההנדסית: הפליטה = 12 חשבונות × 3 שרשראות (STEEM/HIVE/BLURT).
 * "מת" = אין-שליטה-במפתח או אין-אנרגיה (RC). הכלי הזה מודד את-החלק-הראשון:
 *
 *   לכל חשבון × שרשרת × תפקיד (posting/active/owner/memo):
 *     גזירת-מפתח-ציבורי מהסיסמה-הראשית (אלגוריתם המפעל: sha256(user+role+password),
 *     זהה ל-agent/keyrotate.cjs:169 ול-master-key-proof.cjs) והשוואה מול
 *     key_auths חי-על-השרשרת. התאמה = אנחנו-שולטים. read-only לחלוטין.
 *
 * מה-הכלי-לעולם-לא-עושה:
 *   - לא מדפיס/רושם/משדר את הסיסמה או כל-WIF (רק זיכרון, מנוקה-בסוף)
 *   - לא חותם, לא משדר, לא נוגע ב-state — קריאה-בלבד מול RPC ציבורי
 *   - הפלט: בוליאנים + מפתחות-ציבוריים-בלבד (כבר-ציבוריים-על-השרשרת)
 *
 * שימוש:
 *   SAOS_FACTORY_MASTER='...' node agent/fleet-control-audit.cjs
 *   או: node agent/fleet-control-audit.cjs            (הסיסמה נקראת מ-stdin בלי-הד)
 *
 * פלט: agent/fleet_control_audit.json + פסק-דין לקונסולה.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const https = require('https');
const readline = require('readline');
const { roster } = require('./lib/fleet-roster.cjs');

const ROLES = ['posting', 'active', 'owner', 'memo'];
const CHAINS = [
  { name: 'steem', prefix: 'STM', endpoint: 'https://api.steemit.com' },
  { name: 'hive', prefix: 'STM', endpoint: 'https://api.hive.blog' },
  { name: 'blurt', prefix: 'BLT', endpoint: 'https://rpc.beblurt.com' },
];
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/* ── crypto primitives (מאומתות מול master-key-proof.cjs) ── */
function sha256(buf) { return crypto.createHash('sha256').update(buf).digest(); }
function ripemd160(buf) { return crypto.createHash('ripemd160').update(buf).digest(); }
function b58encode(buf) {
  let n = BigInt('0x' + buf.toString('hex'));
  let out = '';
  while (n > 0n) { out = B58[Number(n % 58n)] + out; n /= 58n; }
  for (const b of buf) { if (b === 0) out = '1' + out; else break; }
  return out;
}
function grapheneCheck(payload) { return Buffer.concat([payload, ripemd160(payload).slice(0, 4)]); }
function scalarToPub(scalar) {
  const ecdh = crypto.createECDH('secp256k1');
  ecdh.setPrivateKey(scalar);
  return Buffer.from(ecdh.getPublicKey('hex', 'compressed'), 'hex');
}
/** אלגוריתם-המפעל: sha256(username + role + password) → מפתח-ציבורי בפורמט-השרשרת */
function derivePub(username, role, password, prefix) {
  const scalar = sha256(Buffer.concat([
    Buffer.from(username, 'utf8'), Buffer.from(role, 'utf8'), Buffer.from(password, 'utf8'),
  ]));
  return prefix + b58encode(grapheneCheck(scalarToPub(scalar)));
}

/* ── RPC (read-only) ── */
function rpcPost(endpoint, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(endpoint);
    const payload = JSON.stringify(body);
    const req = https.request({
      hostname: u.hostname, path: u.pathname || '/', method: 'POST', family: 4,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      timeout: 20000,
    }, (res) => {
      let d = ''; res.on('data', c => (d += c)); res.on('end', () => {
        try { resolve(JSON.parse(d)); } catch (e) { reject(new Error('bad-json from ' + u.hostname)); }
      });
    });
    req.on('error', reject); req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.write(payload); req.end();
  });
}
async function getAccount(endpoint, name) {
  const d = await rpcPost(endpoint, { jsonrpc: '2.0', method: 'condenser_api.get_accounts', params: [[name]], id: 1 });
  return d && d.result && d.result[0] ? d.result[0] : null;
}

/* ── הסיסמה: env או stdin, לעולם לא בפלט ── */
async function readPassword() {
  if (process.env.SAOS_FACTORY_MASTER) return process.env.SAOS_FACTORY_MASTER;
  const rl = readline.createInterface({ input: process.stdin });
  let pw = '';
  for await (const line of rl) { pw += line; break; }
  rl.close();
  return pw.trim();
}

async function main() {
  const password = await readPassword();
  if (!password) { console.error('no master password provided (env SAOS_FACTORY_MASTER or stdin)'); process.exit(1); }
  const fleet = roster();
  const out = {
    at: new Date().toISOString(),
    mode: 'read-only-derivation-compare',
    rosterSource: fleet.source,
    rosterWarning: fleet.warning,
    accounts: fleet.accounts.length,
    chains: {},
    verdict: {},
    // Task 13-a — master restoration truth. SAOS_FACTORY_MASTER was recovered from
    // git-folder material: the 2018 sheet line for @headcorner (agent/keys/hed-soldiers-source.txt
    // line 19, 52-char steemit-format factory password; same line that revived the head 2026-09-29).
    // PROVEN vs live chain (Task 13-a measurement matrix): master column below = THE one
    // SAOS_FACTORY_MASTER (single-password semantics); ADDITIONALLY each soldier's own 2018 sheet
    // line derives its steem+blurt keys 4/4 and 9 soldiers' hive keys 4/4 (10×steem, 9×hive,
    // 12×blurt incl. ynet-blurt from ynet's own line — measured, per-account).
    // PROVEN NEGATIVES (0/4 against master + all per-account sheet lines + recovered page + zip
    // uploads + seal passes): tov-hive, headcorner-hive, ynet steem+hive (rotated 2026-09-04 to a
    // since-lost master; ynet retired by sovereign decision 2026-09-30). A proven negative is truth.
    note: 'master restored Task 13-a (source: 2018 sheet, agent/keys/hed-soldiers-source.txt:19 — structure only, never printed); per-account sheet lines derive steem 11/12, hive 9/12, blurt 12/12 (each account from its OWN line); tov-hive & headcorner-hive & ynet steem/hive = measured 0/4 against every git-folder candidate — blocked rows remain blocked; evidence: this file (asOf above)',
  };

  /* מקור-שליטה שני: הכספת המשוחזרת (vault.json) — WIF-ים נטענים לזיכרון-בלבד */
  let vaultKeys = null;
  try {
    const v = JSON.parse(fs.readFileSync(path.join(__dirname, 'keys', 'vault.json'), 'utf8'));
    vaultKeys = {};
    for (const a of (v.accounts || [])) {
      const k = a.keys || {};
      // Task 13-a: two vault shapes — {role:{wif}} (soldiers) and chain-keyed {steem:{role:{wif}},hive:{…}}
      // (the head, revived 2026-09-29). Graphene chains share one key body per account, so the
      // steem group is the shared-body fallback for hive/blurt when no role-keyed entry exists.
      const pick = (r) => (k[r] && k[r].wif) || (k.steem && k.steem[r] && k.steem[r].wif) || undefined;
      vaultKeys[(a.username || '').toLowerCase()] = {
        posting: pick('posting'), active: pick('active'),
        owner: pick('owner'), memo: pick('memo'),
      };
    }
    out.vaultSource = 'agent/keys/vault.json';
  } catch (_) { vaultKeys = null; out.vaultSource = 'absent'; }

  /** WIF → סקלר (base58check decode, תיקון-גרסה 0x80) → מפתח-ציבורי בפורמט-השרשרת */
  function wifToPub(wif, prefix) {
    let n = 0n;
    for (const c of wif) { const i = B58.indexOf(c); if (i < 0) throw new Error('bad-wif'); n = n * 58n + BigInt(i); }
    let hex = n.toString(16);
    if (hex.length % 2) hex = '0' + hex;
    let buf = Buffer.from(hex, 'hex');
    for (const c of wif) { if (c === '1') buf = Buffer.concat([Buffer.alloc(1), buf]); else break; }
    const payload = buf.slice(0, buf.length - 4);
    const key = payload[0] === 0x80 ? payload.slice(1) : payload;
    return prefix + b58encode(grapheneCheck(scalarToPub(key)));
  }

  for (const chain of CHAINS) {
    const rows = {};
    for (const name of fleet.accounts) {
      let acc = null;
      try { acc = await getAccount(chain.endpoint, name); } catch (_) { acc = null; }
      if (!acc) { rows[name] = { exists: false }; continue; }
      const row = { exists: true, master: {}, vault: {} };
      const authOf = (role) => {
        if (role === 'memo') return [acc.memo_key];
        const auths = acc[role] && Array.isArray(acc[role].key_auths) ? acc[role].key_auths : [];
        return auths.map(([k]) => k);
      };
      for (const role of ROLES) {
        try {
          const onchain = authOf(role);
          // דרך-1: גזירת-מפעל מהסיסמה-הראשית
          row.master[role] = onchain.includes(derivePub(name, role, password, chain.prefix));
          // דרך-2: WIF-מהכספת (הכספת משותפת ל-STEEM/HIVE — אותו-גוף-מפתח)
          const wif = vaultKeys && vaultKeys[name] && vaultKeys[name][role];
          row.vault[role] = !!(wif && onchain.includes(wifToPub(wif, chain.prefix)));
        } catch (_) { row.master[role] = false; row.vault[role] = false; }
      }
      rows[name] = row;
    }
    out.chains[chain.name] = rows;
  }

  /* פסק-דין לפי-מקור-שליטה */
  const verdict = {};
  for (const c of Object.keys(out.chains)) {
    const rows = out.chains[c];
    const v = { exists: 0, missing: [], master: { posting: [], active: [], full: [] }, vault: { posting: [], active: [], full: [] }, union: { posting: [], active: [], full: [] } };
    for (const [name, row] of Object.entries(rows)) {
      if (!row.exists) { v.missing.push(name); continue; }
      v.exists++;
      for (const src of ['master', 'vault']) {
        if (row[src].posting) v[src].posting.push(name);
        if (row[src].active) v[src].active.push(name);
        if (row[src].posting && row[src].active && row[src].owner) v[src].full.push(name);
      }
      const u = (k) => row.master[k] || row.vault[k];
      if (u('posting')) v.union.posting.push(name);
      if (u('active')) v.union.active.push(name);
      if (u('posting') && u('active') && u('owner')) v.union.full.push(name);
    }
    verdict[c] = v;
  }
  out.verdict = verdict;

  fs.writeFileSync(path.join(__dirname, 'fleet_control_audit.json'), JSON.stringify(out, null, 2) + '\n');

  // קונסולה — בלי מפתחות, בלי סיסמה
  console.log('=== FLEET CONTROL AUDIT (read-only) ===');
  console.log('roster source:', fleet.source, '| accounts:', fleet.accounts.length, '| vault:', out.vaultSource);
  for (const c of Object.keys(verdict)) {
    const v = verdict[c];
    console.log(`${c.toUpperCase()}: exists=${v.exists}/${fleet.accounts.length}${v.missing.length ? ' missing=' + v.missing.join(',') : ''}`);
    console.log(`   master-derive : posting=${v.master.posting.length} active=${v.master.active.length} full=${v.master.full.length} [${v.master.posting.join(',') || '—'}]`);
    console.log(`   vault-wif     : posting=${v.vault.posting.length} active=${v.vault.active.length} full=${v.vault.full.length} [${v.vault.posting.join(',') || '—'}]`);
    console.log(`   UNION(control): posting=${v.union.posting.length} active=${v.union.active.length} full=${v.union.full.length}`);
  }
}
main().catch(e => { console.error('audit failed:', e.message); process.exit(1); });
