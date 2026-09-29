#!/usr/bin/env node
/**
 * SAOS SELF-AUDIENCE ENGINE v1 — "אנחנו הקהל הריבוני של עצמנו" (ריבון, 2026-09-29)
 *
 * מה-זה: סריקת-פוסטים-חיים של הצי (חלון-7-ימים) → כל-חייל מצביע לפוסטים של
 * חבריו (לא-עצמיים) → אימות-לפני-חתימה (מפתח-נגזר מול key_auths בשרשרת)
 * → שידור → קריאה-חוזרת (המצביע ב-active_votes) → קבלה נטולת-סודות.
 *
 * דוקטרינה: מפתחות בזיכרון-ריצה בלבד · אפס-סודות-בפלט/בקבלה · fail-soft.
 * הרצה: node agent/self-audience.cjs  (VAULT_RECOVERY=1 מפענח-מהריפו-הפרטי)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const steem = require('steem');

steem.api.setOptions({ url: 'https://api.steemit.com', useAppbaseApi: false });

const ROOT = path.resolve(__dirname, '..');
const OUT = process.env.RECEIPT_OUT || path.join(ROOT, 'agent', 'self-audience-receipt.json');
const FLEET = ['cashmachine','haran','israelnews','lsa','macrame','siq','tov','wic','wog','woq','ynet','headcorner'];
const MIN_VP = 20;   // סף-כוח-הצבעה (%)
const MIN_RC = 30;   // סף-RC (%)
const SOLDIER_WEIGHT = 10000; // חיילים: 100% (SP-אבק — מקסום-אות)
const HEAD_SELF_WEIGHT = 100; // ראש: 1% עצמי על-דגלול-בלבד (אות-חיות)
const HEAD_FLAGSHIP = (author, permlink) => author === 'headcorner' && /^saos-grid-\d{8}$/.test(permlink);

// ── שחזור-עצמי: פענוח-הכספת-מהריפו-הפרטי (דוקטרינת-משמורת-מערכת) ──
// זוג-פותח: recovery-meta.json ↔ agent/vault/*.zip.enc · אם-פער-דורות — ההיסטוריה
// של המטא נסרקת (git log) עד-ש-outer-sha תואם לקובץ-הקיים.
function recoverVault() {
  const out = '/tmp/sa-keys'; // מחוץ-לעץ-הגיט · 0700 · מפתחות-לעולם-לא-נכתבים-לריפו
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true, mode: 0o700 });
  const metaPath = path.join(ROOT, 'agent', 'recovery-meta.json');
  const metas = [];
  try { metas.push(JSON.parse(fs.readFileSync(metaPath, 'utf8'))); } catch (_) {}
  // סריקת-היסטוריית-המטא (ריפו-פרטי — ההיסטוריה-נגישה)
  try {
    const log = execFileSync('git', ['-C', ROOT, 'log', '--format=%H', '-n', '40', '--', 'agent/recovery-meta.json'], { encoding: 'utf8' });
    for (const c of log.split('\n').filter(Boolean)) {
      try { metas.push(JSON.parse(execFileSync('git', ['-C', ROOT, 'show', `${c}:agent/recovery-meta.json`], { encoding: 'utf8' }))); } catch (_) {}
    }
  } catch (_) {}
  const encs = fs.readdirSync(path.join(ROOT, 'agent', 'vault')).filter(f => f.endsWith('.enc')).map(f => path.join(ROOT, 'agent', 'vault', f));
  const crypto = require('crypto');
  const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
  for (const enc of encs) {
    const outer = sha(enc);
    for (const m of metas) {
      if (!m || !m.keysZipPass || m.keysZipSha256 !== outer) continue;
      const dec = path.join(out, 'vault.zip');
      try {
        execFileSync('openssl', ['enc', '-d', '-aes-256-cbc', '-pbkdf2', '-iter', '300000', '-in', enc, '-out', dec, '-pass', 'env:SAZP'], { env: { ...process.env, SAZP: m.keysZipPass }, stdio: 'pipe' });
        if (fs.readFileSync(dec).subarray(0, 2).toString('latin1') !== 'PK') continue;
        execFileSync('unzip', ['-o', '-q', dec, '-d', out], { stdio: 'pipe' });
        const vj = path.join(out, 'agent', 'keys', 'vault.json');
        if (fs.existsSync(vj)) return vj;
      } catch (_) {}
    }
  }
  return null;
}

const P = (fn) => new Promise((res, rej) => fn((e, r) => e ? rej(e) : res(r)));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
// RPC ידני — עוקף steem.api.send (חתימת-מודול לא-עקבית)
const https = require('https');
function rpc(method, params) {
  return new Promise((res, rej) => {
    const body = JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 });
    const req = https.request({ hostname: 'api.steemit.com', path: '/', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }, timeout: 20000 }, (r) => {
      let d = ''; r.on('data', c => d += c); r.on('end', () => { try { const j = JSON.parse(d); j.error ? rej(new Error(j.error.message || 'rpc error')) : res(j.result); } catch (e) { rej(e); } });
    });
    req.on('error', rej); req.write(body); req.end();
  });
}

async function main() {
  const t0 = new Date().toISOString();
  const vaultPath = process.env.VAULT || recoverVault();
  if (!vaultPath || !fs.existsSync(vaultPath)) { console.log('[self-aud] NO-VAULT — fail-soft exit'); return; }
  const vault = JSON.parse(fs.readFileSync(vaultPath, 'utf8'));
  const keymap = {};
  for (const a of vault.accounts) {
    if (!FLEET.includes(a.username)) continue;
    const k = a.keys || {};
    // שתי-צורות: חיילים keys.posting · ראש keys.steem.posting
    const wif = (k.posting && k.posting.wif) || (k.steem && k.steem.posting && k.steem.posting.wif) || null;
    if (wif) keymap[a.username] = wif;
  }
  console.log(`[self-aud] vault ok · fleet keys: ${Object.keys(keymap).length}/${FLEET.length} · zero secrets printed`);

  // ── 1. מצב-חי: VP/RC + key_auths ──
  const accts = await P(cb => steem.api.getAccounts(FLEET, cb));
  const live = {};
  for (const a of accts) {
    let rcPct = null;
    try {
      const rc = await rpc('rc_api.find_rc_accounts', { accounts: [a.name] });
      if (rc && rc.rc_accounts && rc.rc_accounts[0]) {
        const m = rc.rc_accounts[0].rc_manabar, mx = Number(rc.rc_accounts[0].max_rc) || 1;
        rcPct = (Number(m.current_mana) / mx) * 100;
      }
    } catch (_) {}
    live[a.name] = { vp: a.voting_power / 100, rcPct, pubOnChain: (a.posting.key_auths[0] || [])[0], canVote: a.can_vote };
  }

  // ── 2. גילוי-תוכן-חי (7 ימים) ──
  const now = Date.now();
  const posts = [];
  for (const ac of FLEET) {
    try {
      const d = await P(cb => steem.api.getDiscussionsByBlog({ tag: ac, limit: 10 }, cb));
      for (const p of d) {
        const ageDays = (now - Date.parse(p.created + 'Z')) / 864e5;
        if (ageDays >= 0 && ageDays <= 7) posts.push({ author: p.author, permlink: p.permlink, created: p.created, votes: p.active_votes.map(v => v.voter) });
      }
    } catch (e) { console.log(`[self-aud] ${ac} feed error: ${String(e.message || e).slice(0, 60)}`); }
  }
  console.log(`[self-aud] live posts (7d): ${posts.length}`);
  posts.forEach(p => console.log(`   · ${p.author}/${p.permlink.slice(0, 40)} (${p.votes.length} votes)`));

  // ── 3. מטריצת-הצבעה ──
  const jobs = [];
  for (const p of posts) for (const voter of FLEET) {
    if (voter === p.author) {
      if (HEAD_FLAGSHIP(p.author, p.permlink) && !p.votes.includes(voter)) jobs.push({ voter, ...p, weight: HEAD_SELF_WEIGHT, self: true });
      continue;
    }
    if (p.votes.includes(voter)) continue; // idempotency
    jobs.push({ voter, ...p, weight: SOLDIER_WEIGHT, self: false });
  }
  console.log(`[self-aud] vote jobs: ${jobs.length}`);

  // ── 4. ביצוע + קריאה-חוזרת ──
  const results = [];
  let ok = 0, skip = 0, fail = 0;
  for (const j of jobs) {
    const st = live[j.voter] || {};
    const R = { voter: j.voter, author: j.author, permlink: j.permlink, weight: j.weight, self: j.self };
    if (!keymap[j.voter]) { R.status = 'SKIP-NO-KEY'; skip++; }
    else {
      const pub = steem.auth.wifToPublic(keymap[j.voter]);
      if (st.pubOnChain && pub !== st.pubOnChain) { R.status = 'SKIP-KEY-MISMATCH'; skip++; }
      else if ((st.vp ?? 0) < MIN_VP) { R.status = `SKIP-VP-LOW(${st.vp})`; skip++; }
      else if (st.rcPct != null && st.rcPct < MIN_RC) { R.status = `SKIP-RC-LOW(${Math.round(st.rcPct)})`; skip++; }
      else {
        try {
          await P(cb => steem.broadcast.vote(keymap[j.voter], j.voter, j.author, j.permlink, j.weight, cb));
          await sleep(1500);
          const c = await P(cb => steem.api.getContent(j.author, j.permlink, cb));
          const hit = (c.active_votes || []).find(v => v.voter === j.voter);
          R.status = hit ? 'VOTED-VERIFIED' : 'BROADCAST-NO-READBACK';
          R.readBack = { votes: (c.active_votes || []).length, time: hit ? hit.time : null, weight: hit ? hit.weight : null, pending: c.pending_payout_value };
          hit ? ok++ : fail++;
        } catch (e) { R.status = 'FAIL'; R.err = String(e.message || e).slice(0, 90); fail++; }
      }
    }
    results.push(R);
    console.log(`[${R.status}] ${j.voter} → ${j.author}/${j.permlink.slice(0, 32)} w=${j.weight}`);
    await sleep(300);
  }

  // ── 5. קבלה נטולת-סודות ──
  const receipt = {
    ok: true, tool: 'self-audience.cjs', doctrine: 'we are our own sovereign audience — verify-then-sign, keys in memory only',
    at: t0, finishedAt: new Date().toISOString(), livePosts: posts.length, jobs: jobs.length,
    tally: { votedVerified: ok, skipped: skip, failed: fail },
    results,
  };
  fs.writeFileSync(OUT, JSON.stringify(receipt, null, 2));
  fs.chmodSync(OUT, 0o644);
  console.log(`[self-aud] DONE · voted=${ok} skip=${skip} fail=${fail} · receipt → ${OUT}`);
}

main().catch(e => { console.error('[self-aud] fatal:', String(e.message || e).slice(0, 200)); process.exit(0); }); // fail-soft: לעולם exit 0
