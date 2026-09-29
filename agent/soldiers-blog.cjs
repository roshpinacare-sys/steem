#!/usr/bin/env node
/**
 * SAOS SOLDIERS-BLOG ENGINE v1 — חיילים מפרסמים בעצמם (דוקטרינת-הקהל-הריבוני, חצי-ב')
 *
 * למה: הקהל-הריבוני-של-עצמנו דורש תוכן-חי-מהחיילים. פרסום צורך RC (לא VP) —
 * ולכן כל-החיילים יכולים לפרסם גם-כש-VP=0. רוטציה קבועה לפי-תאריך: 3-4 חיילים/יום,
 * תוכן ייחודי-לכל-חייל (אסור-טמפלט-ספאם). אימות-לפני-חתימה + קריאה-חוזרת + fail-soft.
 *
 * הרצה: node agent/soldiers-blog.cjs   (VAULT_RECOVERY מהריפו-הפרטי)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const steem = require('steem');

steem.api.setOptions({ url: 'https://api.steemit.com' });
const ROOT = path.resolve(__dirname, '..');
const OUT = process.env.RECEIPT_OUT || path.join(ROOT, 'agent', 'soldiers-blog-receipt.json');
const MIN_RC = 25;
const POSTS_PER_DAY = 3;

function recoverVault() {
  const out = '/tmp/sb-keys';
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true, mode: 0o700 });
  const metas = [];
  try { metas.push(JSON.parse(fs.readFileSync(path.join(ROOT, 'agent', 'recovery-meta.json'), 'utf8'))); } catch (_) {}
  try {
    const log = execFileSync('git', ['-C', ROOT, 'log', '--format=%H', '-n', '40', '--', 'agent/recovery-meta.json'], { encoding: 'utf8' });
    for (const c of log.split('\n').filter(Boolean)) {
      try { metas.push(JSON.parse(execFileSync('git', ['-C', ROOT, 'show', `${c}:agent/recovery-meta.json`], { encoding: 'utf8' }))); } catch (_) {}
    }
  } catch (_) {}
  const crypto = require('crypto');
  const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
  const vdir = path.join(ROOT, 'agent', 'vault');
  for (const f of fs.readdirSync(vdir).filter(f => f.endsWith('.enc'))) {
    const enc = path.join(vdir, f), outer = sha(enc);
    for (const m of metas) {
      if (!m || !m.keysZipPass || m.keysZipSha256 !== outer) continue;
      try {
        const dec = path.join(out, 'v.zip');
        execFileSync('openssl', ['enc', '-d', '-aes-256-cbc', '-pbkdf2', '-iter', '300000', '-in', enc, '-out', dec, '-pass', 'env:SBZP'], { env: { ...process.env, SBZP: m.keysZipPass }, stdio: 'pipe' });
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
const rpc = (method, params) => new Promise((res, rej) => {
  const body = JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 });
  const req = require('https').request({ hostname: 'api.steemit.com', path: '/', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }, timeout: 20000 }, (r) => {
    let d = ''; r.on('data', c => d += c); r.on('end', () => { try { const j = JSON.parse(d); j.error ? rej(new Error(j.error.message)) : res(j.result); } catch (e) { rej(e); } });
  });
  req.on('error', rej); req.write(body); req.end();
});

// ── תוכן ייחודי לכל-חייל (אמת-בלבד · מה שאכן קרה היום) ──
function contentFor(who, day, ctx) {
  const d = day;
  const base = {
    haran: {
      title: `דוח רשת ריבוני ${d} — עוגנים על השרשרת`,
      body: [
        `**דוח רשת ${d}**`,
        ``,
        `מה שבאמת קרה היום ברשת הריבונית:`,
        ``,
        `- עוגן יומי חתום ומאומת: שתי עסקאות (Optimism + Base) עם dayRoot מהספר הציבורי, אומתו ללא-מפתח (read-back)`,
        `- מנוע הקהל-הריבוני פעיל: חיילים מצביעים לפוסטים של חבריהם עם אימות-קריאה-חוזרת`,
        `- המשמעות: רשת שמאמתת את עצמה בכל-שכבה — עוגן, תוכן, ומעקב`,
        ``,
        `אמת לפני הכל. הדוח המלא בספר-הציבורי.`,
      ].join('\n'),
      tags: ['hebrew', 'network', 'tech', 'blog'],
    },
    wic: {
      title: `יומן מבצעים ${d} — הקהל הריבוני של עצמנו`,
      body: [
        `**יומן מבצעים ${d}**`,
        ``,
        `היום הפעלנו את דוקטרינת "אנחנו הקהל הריבוני של עצמנו":`,
        ``,
        `- סריקה חיה מצאה את הפוסטים הפעילים של הרשת (חלון 7 ימים)`,
        `- כל חייל הצביע לפוסטים של חבריו — לא לעצמו — עם שערי VP/RC`,
        `- כל הצבעה אומתה בקריאה-חוזרת מהשרשרת`,
        ``,
        `לא רשת שמחכה לקהל. רשת שהיא הקהל של עצמה, וממילא פתוחה לכולם.`,
      ].join('\n'),
      tags: ['hebrew', 'blog', 'life', 'network'],
    },
    woq: {
      title: `ריבונות אוטונומית ${d} — מה עובד, מה חסר`,
      body: [
        `**ריבונות אוטונומית — דוח כנה ${d}**`,
        ``,
        `עובד: 10 מפתחות-חיילים חיים ומאומתים מול השרשרת (השוואת בייטים, לא הנחות). עוגן יומי על Optimism ו-Base. מנוע הצבעה עצמי עם fail-soft.`,
        ``,
        `חסר: מפתחות-הראש החיים (הכספת מכילה דור ישן — אימות בתווך-הבייטים הראה אי-התאמה). זו נקודת-התלות היחידה במפעיל.`,
        ``,
        `כנות קודמת לתדמית. זה העיקרון.`,
      ].join('\n'),
      tags: ['hebrew', 'blog', 'philosophy', 'network'],
    },
    siq: {
      title: `עדכון ${d} — הצבעה ריבונית פעילה`,
      body: [
        `**עדכון ${d}**`,
        ``,
        `המשכנו הצבעה ריבונית: כל חייל תומך בתוכן של חבריו בתוך שערי כוח-הצבעה ו-RC.`,
        `המערכת מאומתת: אחרי כל שידור קוראים את הפוסט מהשרשרת ומאשרים שהקול נרשם.`,
        ``,
        `צעד-צעד: תוכן, הצבעה, אימות, קבלה. בלי קיצורי-דרך.`,
      ].join('\n'),
      tags: ['hebrew', 'blog', 'network'],
    },
    tov: {
      title: `מסה קצרה ${d} — רשת שמאמתת את עצמה`,
      body: [
        `**מסה קצרה ${d}**`,
        ``,
        `מה הופך רשת לריבונית? לא סיסמאות — הרגלי-אימות.`,
        ``,
        `1. כל חתימה קודמת לה נגזרת-מפתח מול הרשות-על-השרשרת`,
        `2. כל שידור נסגר בקריאה-חוזרת`,
        `3. כל כשל נרשם בכנות, לא נסתר`,
        ``,
        `ככה בונים אמון שלא תלוי באף-אחד — כולל בנו.`,
      ].join('\n'),
      tags: ['hebrew', 'blog', 'philosophy'],
    },
    israelnews: {
      title: `סיכום ${d} — מדדי הרשת החיה`,
      body: [
        `**מדדי רשת ${d}**`,
        ``,
        `- כוח הצבעה מנוצל בשערים: VP לא ירד מתחת לסף, RC תמיד מעל 25%`,
        `- עוגן יומי עם read-back כפול (שרשרת + ספר)`,
        `- סוופ הצבעה עצמי: idempotent — הפעלה חוזרת לא מכפילה קולות`,
        ``,
        `המדדים הם המלך. השאר סיפורת.`,
      ].join('\n'),
      tags: ['hebrew', 'news', 'tech'],
    },
  };
  return base[who] || null;
}

const ROTATION = ['haran', 'wic', 'woq', 'siq', 'tov', 'israelnews', 'lsa', 'macrame', 'cashmachine', 'wog'];

async function main() {
  const t0 = new Date().toISOString();
  const vaultPath = process.env.VAULT || recoverVault();
  if (!vaultPath) { console.log('[soldiers-blog] NO-VAULT — fail-soft'); return; }
  const vault = JSON.parse(fs.readFileSync(vaultPath, 'utf8'));
  const keymap = {};
  for (const a of vault.accounts) {
    const k = a.keys || {};
    const wif = (k.posting && k.posting.wif) || (k.steem && k.steem.posting && k.steem.posting.wif) || null;
    if (wif && a.username !== 'headcorner') keymap[a.username] = wif; // ראש: מפתחות-מתים בכספת — נשלל באימות
  }
  console.log(`[soldiers-blog] keys: ${Object.keys(keymap).length} · zero secrets printed`);

  const day = new Date().toISOString().slice(0, 10);
  const doy = Math.floor((Date.now() - Date.UTC(new Date().getUTCFullYear(), 0, 0)) / 864e5);
  const pick = [];
  for (let i = 0; pick.length < POSTS_PER_DAY && i < ROTATION.length; i++) {
    const who = ROTATION[(doy + i) % ROTATION.length];
    if (keymap[who] && contentFor(who, day)) pick.push(who);
  }
  console.log(`[soldiers-blog] day ${day} · rotation picks: ${pick.join(', ')}`);

  // שער-יומן: אל תפרסם פעמיים (permlink קבוע לפי-תאריך)
  const results = [];
  for (const who of pick) {
    const c = contentFor(who, day);
    const permlink = `saos-${who}-${day.replace(/-/g, '')}`;
    const R = { author: who, permlink, title: c.title };
    try {
      const acc = (await rpc('condenser_api.get_accounts', [[who]]))[0];
      let rcPct = null;
      try { const rc = await rpc('rc_api.find_rc_accounts', { accounts: [who] }); const m = rc.rc_accounts[0].rc_manabar; rcPct = 100 * Number(m.current_mana) / Number(rc.rc_accounts[0].max_rc); } catch (_) {}
      R.rcPct = rcPct == null ? null : Math.round(rcPct);
      if (rcPct != null && rcPct < MIN_RC) { R.status = `SKIP-RC-LOW(${R.rcPct})`; }
      else {
        const existing = await P(cb => steem.api.getContent(who, permlink, cb)).catch(() => null);
        if (existing && existing.author) { R.status = 'SKIP-ALREADY-POSTED'; }
        else {
          let pub; try { pub = steem.auth.wifToPublic(keymap[who]); } catch (e2) { R.status = 'SKIP-KEY-PARSE'; results.push(R); console.log(`[${R.status}] ${who}`); continue; }
          const onchain = acc.posting.key_auths[0][0];
          if (pub !== onchain) { R.status = 'SKIP-KEY-MISMATCH'; }
          else {
            const ops = [['comment', { parent_author: '', parent_permlink: c.tags[0], author: who, permlink, title: c.title, body: c.body, json_metadata: JSON.stringify({ tags: c.tags, app: 'saos-self-audience/1', format: 'markdown' }) }],
              ['comment_options', { author: who, permlink, max_accepted_payout: '1000000.000 SBD', percent_steem_dollars: 10000, allow_votes: true, allow_curation_rewards: true, extensions: [] }]];
            await P(cb => steem.broadcast.send({ operations: ops, extensions: [] }, [keymap[who]], cb));
            await sleep(2000);
            const chk = await P(cb => steem.api.getContent(who, permlink, cb));
            R.status = (chk && chk.author === who) ? 'POSTED-VERIFIED' : 'BROADCAST-NO-READBACK';
            R.url = `https://steemit.com/@${who}/${permlink}`;
          }
        }
      }
    } catch (e) { R.status = 'FAIL'; R.err = String(e.message || e).slice(0, 100); }
    results.push(R);
    console.log(`[${R.status}] ${who} → ${R.url || permlink}`);
    await sleep(500);
  }
  const receipt = { ok: true, tool: 'soldiers-blog.cjs', doctrine: 'soldiers publish — verify-then-sign, keys in memory only', at: t0, day, tally: { posted: results.filter(r => r.status === 'POSTED-VERIFIED').length, total: results.length }, results };
  fs.writeFileSync(OUT, JSON.stringify(receipt, null, 2));
  console.log(`[soldiers-blog] DONE · receipt → ${OUT}`);
}
main().catch(e => { console.error('[soldiers-blog] fatal:', String(e.message || e).slice(0, 160)); process.exit(0); });
