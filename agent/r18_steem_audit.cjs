#!/usr/bin/env node
/* r18_steem_audit.cjs — R18d: ביקורת-שרשרת-חיה של הצי · קריאה-בלבד.
 *
 * בודק על-השרשרת (steem+hive) עבור כל-חשבונות-הכספת:
 *   1. האם-החשבון-קיים · מתי-התרחשה-רוטציית-owner-אחרונה
 *   2. הרשאות-חיות: owner/active/posting/memo + account_auths זרים
 *   3. התאמת-הפומביות-שבכספת מול-ההרשאות-החיות (שליטה-בפועל)
 *   4. פעילות-אחרונה: סוגי-פעולות ב-7-ימים · פוסטים-תגובות-אחרונים (הוכחת-בלוג)
 *   5. השוואה-בין-שרשראות: האם-אותה-פומבית (אותו-WIF=שריפה-צולבת)
 *
 * בטיחות: הפלט מכיל פומביות/שמות/תאריכים-בלבד — אפס-WIF, אפס-סוד.
 * הרצה: node agent/r18_steem_audit.cjs  →  /tmp/r18audit.json + סיכום-פומבי
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const vault = JSON.parse(fs.readFileSync(path.join(__dirname, 'keys', 'vault.json'), 'utf8'));

function rpc(url, body) {
  const u = new URL(url);
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = require('https').request({ hostname: u.hostname, path: u.pathname || '/', method: 'POST', family: 4, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }, timeout: 25000 }, (res) => {
      let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => {
        try { const j = JSON.parse(d); if (j.error) return reject(new Error(j.error.message || 'rpc error')); resolve(j.result); }
        catch (_) { reject(new Error('bad rpc: ' + d.slice(0, 100))); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout'))); req.on('error', reject);
    req.write(payload); req.end();
  });
}
const STEEM = 'https://api.steemit.com';
const HIVE = 'https://api.hive.blog';
const sApi = (m, p) => rpc(STEEM, { jsonrpc: '2.0', method: m, params: p, id: 1 });
const hApi = (m, p) => rpc(HIVE, { jsonrpc: '2.0', method: m, params: p, id: 1 });

const ROLES = ['owner', 'active', 'posting', 'memo'];

function rolesOf(entry, chain) {
  // schema-v1: chains:{steem:[roles]} · schema-v0: chains:['steem','hive']
  const ch = entry.chains;
  if (!ch) return [];
  if (Array.isArray(ch)) return [];
  return Array.isArray(ch[chain]) ? ch[chain] : [];
}

function pubsOf(entry, chain) {
  const k = entry.keys || {};
  const out = {};
  for (const r of ROLES) if (k[r] && k[r].pub) out[r] = k[r].pub;
  // schema-v0 (הראש): keys:{steem:{owner:{wif,pub},…}, hive:{…}} — עדיפות-לערוץ-הנבדק
  const c = chain && k[chain];
  if (c && typeof c === 'object') for (const r of ROLES) if (c[r] && c[r].pub) out[r] = c[r].pub;
  return out;
}

function authKeys(auth) {
  if (!auth) return [];
  return (auth.key_auths || []).map((x) => x[0]);
}

async function main() {
  const entries = vault.accounts || [];
  const names = entries.map((e) => e.username);
  const [sAcc, hAcc] = await Promise.all([
    sApi('condenser_api.get_accounts', [names]),
    hApi('condenser_api.get_accounts', [names]).catch(() => null),
  ]);
  const sMap = new Map((sAcc || []).map((a) => [a.name, a]));
  const hMap = new Map(((hAcc || []).map ? hAcc : []).map((a) => [a.name, a]));

  const out = { at: new Date().toISOString(), accounts: {} };

  for (const e of entries) {
    const nm = e.username;
    const s = sMap.get(nm) || null;
    const h = hMap.get(nm) || null;
    const row = {
      vaultSteemRoles: rolesOf(e, 'steem'),
      vaultHiveRoles: rolesOf(e, 'hive'),
      steem: null, hive: null,
    };

    for (const [chain, acc, api] of [['steem', s, sApi], ['hive', h, hApi]]) {
      if (!acc) { row[chain] = { exists: false }; continue; }
      const pubs = pubsOf(e, chain);
      const a = {
        exists: true,
        created: acc.created,
        lastOwnerUpdate: acc.last_owner_update,
        owner: { keys: authKeys(acc.owner), threshold: acc.owner.weight_threshold, accountAuths: (acc.owner.account_auths || []).map((x) => x[0]) },
        active: { keys: authKeys(acc.active), threshold: acc.active.weight_threshold, accountAuths: (acc.active.account_auths || []).map((x) => x[0]) },
        posting: { keys: authKeys(acc.posting), threshold: acc.posting.weight_threshold, accountAuths: (acc.posting.account_auths || []).map((x) => x[0]) },
        memo: acc.memo_key,
        ourMatch: {},
        foreignAuthAccounts: {},
      };
      for (const r of ROLES) {
        if (r === 'memo') { a.ourMatch.memo = !!(pubs.memo && pubs.memo === acc.memo_key); continue; }
        const live = authKeys(acc[r]);
        a.ourMatch[r] = !!(pubs[r] && live.includes(pubs[r]));
      }
      row[chain] = a;
    }

    // שריפה-צולבת: אותה-פומבית-בעלים על שתי-השרשראות = אותו-WIF
    row.sameOwnerPubBothChains = !!(row.steem && row.hive && row.steem.exists && row.hive.exists &&
      row.steem.owner.keys[0] && row.steem.owner.keys[0] === row.hive.owner.keys[0]);

    out.accounts[nm] = row;
  }

  // ── פעילות-אחרונה + בלוג על steem (ראיית-השגיאות) ──
  for (const e of entries) {
    const nm = e.username;
    const row = out.accounts[nm];
    if (!row.steem || !row.steem.exists) continue;
    try {
      const raw = await sApi('condenser_api.get_account_history', [nm, -1, 200]);
      const cutoff = Date.now() - 7 * 24 * 3600 * 1000;
      const types = {}; const comments = [];
      if (Array.isArray(raw)) {
        for (const [, ev] of raw) {
          if (!ev || !ev.timestamp) continue;
          const t = new Date(ev.timestamp + 'Z').getTime();
          const op = ev.op && ev.op[0];
          types[op] = (types[op] || 0) + 1;
          if (t >= cutoff && (op === 'comment' || op === 'comment_options') && ev.op[1]) {
            const c = ev.op[1];
            comments.push({ ts: ev.timestamp, parent: c.parent_author || '-', permlink: c.permlink, title: (c.title || '').slice(0, 80), bodyHead: (c.body || '').slice(0, 90) });
          }
        }
      }
      row.steem.ops7dTypes = types;
      row.steem.recentComments = comments.slice(-12);
    } catch (err) { row.steem.historyError = String(err.message || err).slice(0, 80); }
    try {
      const blog = await sApi('condenser_api.get_discussions_by_blog', [{ tag: nm, limit: 8 }]);
      row.steem.blog = (blog || []).map((p) => ({ created: p.created, permlink: p.permlink, title: (p.title || '').slice(0, 70), author: p.author, bodyHead: (p.body || '').slice(0, 90) }));
    } catch (err) { row.steem.blogError = String(err.message || err).slice(0, 80); }
  }

  fs.writeFileSync('/tmp/r18audit.json', JSON.stringify(out, null, 1), 'utf8');

  // ── סיכום-פומבי ──
  console.log('=== R18d STEEM-FIX · ביקורת-חיה · ' + out.at);
  for (const [nm, r] of Object.entries(out.accounts)) {
    const s = r.steem || {};
    const h = r.hive || {};
    const sm = s.exists ? ROLES.map((x) => x + ':' + (r.steem.ourMatch[x] ? 'Y' : 'n')).join(' ') : 'NO-ACC';
    const hm = h.exists ? ROLES.map((x) => x + ':' + (r.hive.ourMatch[x] ? 'Y' : 'n')).join(' ') : 'NO-ACC';
    const ownerChg = s.exists && s.lastOwnerUpdate && s.lastOwnerUpdate !== '1970-01-01T00:00:00' ? s.lastOwnerUpdate : 'never';
    const forAcc = s.exists ? [].concat(s.owner.accountAuths, s.active.accountAuths, s.posting.accountAuths) : [];
    const opKinds = s.ops7dTypes ? Object.entries(s.ops7dTypes).map(([k, v]) => k + '×' + v).join(' ') : '';
    console.log(`\n· ${nm}  (steem-owner-chg: ${ownerChg})${r.sameOwnerPubBothChains ? '  ⚠ SAME-WIF-BOTH-CHAINS' : ''}`);
    console.log(`  steem שליטה: ${sm}`);
    console.log(`  hive  שליטה: ${hm}`);
    if (forAcc.length) console.log(`  ⚠ הרשאות-חשבון-זרות: ${forAcc.join(', ')}`);
    if (opKinds) console.log(`  פעילות-7d: ${opKinds}`);
    const bl = (s.blog || []).slice(0, 3);
    if (bl.length) for (const p of bl) console.log(`  בלוג: ${p.created} ${p.permlink} «${p.title}»`);
    const rc = (s.recentComments || []).slice(-3);
    if (rc.length) for (const c of rc) console.log(`  תגובה: ${c.ts} → ${c.parent} ${c.permlink} «${(c.bodyHead || '').replace(/\n/g, ' ')}»`);
  }
  console.log('\nfull: /tmp/r18audit.json');
}

main().catch((e) => { console.error('AUDIT FAIL:', e.message); process.exit(1); });
