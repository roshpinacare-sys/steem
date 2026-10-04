#!/usr/bin/env node
/* cadence-run.cjs — Z-82: מפעיל-הקדנס. רץ כל-30 דקות מתוך CI ומבצע **רק** את
 * המשבצות-הדיות מהלוח-הריבוני (cadence.cjs) — כך הפעילות מתפרשת על-פני-כל-היום,
 * חייל-אחר בכל-פעם, בלי-אף-פיצוץ-דקה (המדד: 11 חיילים באותה-דקה → 1 בדקה).
 *
 * כל-פעולה: מדידה-חיה → בניית-תוכן (content-v3) → שער-איכות (lint) →
 * אימות-מפתח-מול-השרשרת → שידור → קריאה-חוזרת. fail-soft: המפעיל לעולם לא
 * מפיל-את-הרכבת; כל-סטטוס כנה בקבלה נטולת-סודות.
 *
 * מפתחות: SA_FLEET_KEYS (בסיס64 של JSON {username: postingWif}) — אותו-חוזה
 * כמו שאר-הצינור. בלי-מפתחות → DRY כנה (תכנון-בלבד), אפס-חתימות.
 * שימוש: node agents/social/cadence-run.cjs [--dry] [--lookback 35]
 * פלט: agents/receipts/social-cadence-<day>.json
 */
'use strict';
const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const ROOT = path.join(HERE, '..', '..');
/* פריסה-כפולה באחוזה: steem=agent/ · Domain=agents/ — המפעיל מזהה לבד */
const AG = fs.existsSync(path.join(ROOT, 'agents')) ? 'agents' : 'agent';
const OUT_DIR = path.join(ROOT, AG, 'receipts');
const SOCIAL_DIR = path.join(ROOT, AG, 'social');

let steem = null;
try { steem = require('steem'); } catch (_) { steem = null; }
if (steem) steem.api.setOptions({ url: process.env.STEEM_RPC || 'https://api.steemit.com' });
const { cadence: cadenceMod, content: contentMod, cq: cqMod } = loadMods();

function loadMods() {
  const cadence = require(path.join(HERE, 'cadence.cjs'));
  const content = require(path.join(HERE, 'content-v3.cjs'));
  const cq = require(path.join(HERE, 'comment-quality.cjs'));
  return { cadence, content, cq };
}

function argVal(name, dflt) { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : dflt; }
const HAS = process.argv.includes('--dry');
const LOOKBACK = Math.max(10, parseInt(argVal('--lookback', '35'), 10) || 35);

function loadKeys() {
  if (HAS) return {};
  try {
    const b64 = process.env.SA_FLEET_KEYS || '';
    if (b64) {
      const j = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
      const map = {};
      for (const [u, w] of Object.entries(j || {})) if (u && w) map[String(u).toLowerCase()] = String(w);
      return map;
    }
  } catch (_) {}
  return {};
}

const P = (fn) => new Promise((res, rej) => fn((e, r) => (e ? rej(e) : res(r))));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function retry(fn, n = 3, wait = 2000) { let e; for (let i = 0; i < n; i++) { try { return await fn(); } catch (err) { e = err; await sleep(wait); } } throw e; }

const readJson = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return d; } };
const writeJson = (p, o) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(o, null, 1)); };

/* ── מדידה-חיה: כל-מספר נולד מ-RPC/קבצי-מצב רגע לפני הבנייה ── */
async function measure() {
  const st = { fleet: null, book: null, rc: null, audit: null, chain: null, head: null };
  const FLEET = ['headcorner', 'cashmachine', 'haran', 'israelnews', 'lsa', 'macrame', 'siq', 'tov', 'wic', 'wog', 'woq', 'ynet'];
  try {
    const accts = await retry(() => P((cb) => steem.api.getAccounts(FLEET, cb)));
    const dgp = await retry(() => P((cb) => steem.api.getDynamicGlobalProperties(cb)));
    const spPerMvest = (parseFloat(dgp.total_vesting_fund_steem) / parseFloat(dgp.total_vesting_shares)) * 1e6;
    const eff = (a) => parseFloat(a.vesting_shares) + parseFloat(a.received_vesting_shares) - parseFloat(a.delegated_vesting_shares);
    const soldiers = accts.filter((a) => a.name !== 'headcorner' && a.name !== 'ynet');
    st.fleet = {
      totalSP: Math.round(accts.reduce((s, a) => s + eff(a), 0) / 1e6 * spPerMvest),
      soldiersDelegated: soldiers.filter((a) => parseFloat(a.received_vesting_shares) > 0).length,
      soldiersActive: soldiers.length,
      vpReady: accts.filter((a) => a.voting_power / 100 >= 20).length,
      headSP: Math.round(eff(accts.find((a) => a.name === 'headcorner')) / 1e6 * spPerMvest),
      spPerMvest: +spPerMvest.toFixed(4),
    };
    st.head = accts.find((a) => a.name === 'headcorner');
  } catch (e) { console.log('[cadence] fleet measure failed: ' + String(e.message || e).slice(0, 80)); }
  try {
    const ob = await retry(() => P((cb) => steem.api.getOrderBook(10, cb)));
    const ask = parseFloat(ob.asks && ob.asks.length ? ob.asks[0].price : 0);
    const bid = parseFloat(ob.bids && ob.bids.length ? ob.bids[0].price : 0);
    if (ask > 0 && bid > 0) st.book = { bestAsk: ask, bestBid: bid, spreadBps: Math.round(((ask - bid) / bid) * 1e4), askDepth: +(ob.asks.reduce((s, x) => s + parseFloat(x.steem), 0)).toFixed(1), bidDepth: +(ob.bids.reduce((s, x) => s + parseFloat(x.steem), 0)).toFixed(1) };
  } catch (e) { console.log('[cadence] book measure failed: ' + String(e.message || e).slice(0, 80)); }
  try {
    const rc = await retry(() => P((cb) => steem.api.call('rc_api', 'find_rc_accounts', { accounts: ['headcorner', 'haran', 'wic', 'woq'] }, cb)));
    const pcts = (rc.rc_accounts || []).map((r) => +((Number(r.rc_manabar.current_mana) / Number(r.max_rc)) * 100).toFixed(1));
    if (pcts.length) st.rc = { minPct: Math.min(...pcts), maxPct: Math.max(...pcts), sampled: pcts.length };
  } catch (e) { console.log('[cadence] rc measure failed: ' + String(e.message || e).slice(0, 80)); }
  st.audit = readJson(path.join(SOCIAL_DIR, 'social-audit-receipt.json'), null);
  st.chain = readJson(path.join(ROOT, 'sovereign', 'node', 'state.json'), null);
  return st;
}

/* המרת מדידות → עובדות-מאמר (≥3 מספרים מתויגים, אחרת null — fail-closed) */
function factsFor(loader, m) {
  const S = (x) => ({ sourceLine: 'מדידה חיה מהשרשרת הציבורית, רגע לפני החתימה.' });
  if (loader === 'fleet' && m.fleet) {
    return { nums: [
      { label: 'כוח-רשת כולל', value: m.fleet.totalSP, unit: 'SP' },
      { label: 'חיילים עם האצלת-הון', value: m.fleet.soldiersDelegated, unit: `מתוך ${m.fleet.soldiersActive}` },
      { label: 'חשבונות מעל סף-הצבעה', value: m.fleet.vpReady, unit: 'מתוך 12' },
      { label: 'SP של הראש', value: m.fleet.headSP, unit: 'SP' },
    ], context: 'כל-האצלה היא הון-עצמי של הרשת — לא בקשה מאף-אחד. כוח-הרשת הזה הוא מה שמייצר RC לפרסום והצבעות-ערך.', openQuestion: 'מה קורה לכלכלת-הצבעה כשכוח-הרשת מוכפל?', ...S() };
  }
  if (loader === 'book' && m.book) {
    return { nums: [
      { label: 'המכירה הטובה ביותר', value: m.book.bestAsk, unit: 'SBD/STEEM' },
      { label: 'הקניה הטובה ביותר', value: m.book.bestBid, unit: 'SBD/STEEM' },
      { label: 'רוחב-הפרש הטאץ׳', value: m.book.spreadBps, unit: 'בייסים' },
      { label: 'עומק מכירות ב-10 רמות', value: m.book.askDepth, unit: 'STEEM' },
    ], context: 'מי שמחזיק בטאץ׳ עם ספר לא-חוצה הוא המייקר שכל-טייקר חוצה חייב לשלם — זו ההכנסה הפסיבית האמיתית של מייקר ממושמע.', openQuestion: 'כמה מהרוחב הזה הוא באמת פרמיה וכמה סיכון?', ...S() };
  }
  if (loader === 'rc' && m.rc) {
    return { nums: [
      { label: 'RC מינימלי בדגימה', value: m.rc.minPct, unit: '%' },
      { label: 'RC מרבי בדגימה', value: m.rc.maxPct, unit: '%' },
      { label: 'חשבונות-דגימה', value: m.rc.sampled, unit: '' },
    ], context: 'פרסום צורך RC ולא VP — לכן גם-חייל-עייף-הצבעה יכול לפרסם, וגם להפך: אפשר לתעדף משאבים בין-שתי-הבריכות במדויק.', openQuestion: 'איך בונים תקציב-RC שמתאזן בעצמו שבוע-קדימה?', ...S() };
  }
  if (loader === 'audit' && m.audit && m.audit.totals) {
    const t = m.audit.totals;
    return { nums: [
      { label: 'פעולות בדקה-משותפת לפני-התיקון', value: Math.round(t.actionsInBurstPct * 100), unit: '%' },
      { label: 'שיא חיילים באותה-דקה', value: t.maxAccountsOneMinute, unit: 'מתוך 12' },
      { label: 'הצבעות פנימיות', value: Math.round(t.internalVoteShare * 100), unit: '%' },
      { label: 'פוסטים שבורים שנמדדו', value: t.brokenPosts, unit: '' },
    ], context: 'המדידה הזאת היא קו-הבסיס. מ-היום כל-פעולה נולדת עם מועד-משלה: אותו-נפח, אפס-להקות — והירידה במדדים נמדדת באותו-כלי.', openQuestion: 'באיזה שבוע כל-המדדים יורדים מתחת ל-5%?', ...S() };
  }
  if (loader === 'chain' && m.chain && (m.chain.checkpoints || m.chain.genesisHash)) {
    return { nums: [
      { label: 'checkpoints חיים', value: (m.chain.checkpoints || []).length, unit: '' },
      { label: 'אורך-תקציר-הגנזיס', value: String(m.chain.genesisHash || '').length, unit: 'תווים' },
      { label: 'חומר-מפתח בזיכרון-הריצה', value: 0, unit: 'בדיסק' },
    ], context: 'השרשרת הריבונית היא הספר-הראשי של הצי: כל-פעולה מקבלת-עוגן, וכל-עוגן ניתן לאימות עצמאי בלי לסמוך על אף-אחד.', openQuestion: 'מה השלב-הבא שהשרשרת צריכה לאמת מעצמה?', sourceLine: 'מדידה מקומית מקבצי-מצב נטולי-סודות.' };
  }
  return null;
}

/* ── RPC helpers ── */
async function getContent(a, p) { try { return await retry(() => P((cb) => steem.api.getContent(a, p, cb))); } catch (_) { return null; } }
async function authorPosts(author, limit = 8) {
  try {
    const d = await retry(() => P((cb) => steem.api.getDiscussionsByAuthorBeforeDate(author, '', new Date().toISOString().slice(0, 19), limit, cb)));
    return (d || []).map((x) => ({ author: x.author, permlink: x.permlink, title: x.title, body: x.body, created: x.created }));
  } catch (_) { return []; }
}
async function myComments(voter, limit = 8) {
  try {
    const d = await retry(() => P((cb) => steem.api.getDiscussionsByCommentsBeforeDate(voter, '', new Date().toISOString().slice(0, 19), limit, cb)));
    return (d || []).map((x) => ({ author: x.author, permlink: x.permlink, body: x.body, created: x.created }));
  } catch (_) { return []; }
}
async function repliesOf(a, p) { try { return await retry(() => P((cb) => steem.api.getContentReplies(a, p, cb))); } catch (_) { return []; } }
async function broadcast(ops, wif) {
  return retry(() => P((cb) => steem.broadcast.send({ operations: ops, extensions: [] }, [wif], cb)));
}
function verifyKey(wif, account) {
  try {
    const pub = steem.auth.wifToPublic(wif);
    return { ok: pub === account.posting.key_auths[0][0], onchain: account.posting.key_auths[0][0] };
  } catch (_) { return { ok: false }; }
}

/* ── פעולות-משבצת ── */
async function doPost(slot, keys, m, dayISO, rot) {
  const who = slot.account;
  const R = { t: slot.t, account: who, kind: 'post', status: 'SKIP' };
  const wif = keys[who]; if (!wif) { R.status = 'DRY-NO-KEY'; return R; }
  const topic = contentMod.pickTopic({ soldier: who, dayISO, soldierHistory: rot.soldierHistory, fleetHistory: rot.fleetHistory, rng: contentMod.mulberry32(cadenceMod.hashStr(dayISO + who)) });
  if (!topic) { R.status = 'SKIP-NO-TOPIC(fleet rotation honest)'; return R; }
  const facts = factsFor(topic.loader, m);
  if (!facts) { R.status = 'SKIP-FACTS-UNMEASURED(honest)'; return R; }
  const structures = contentMod.STRUCTURES;
  const structure = structures[Math.abs(cadenceMod.hashStr(dayISO + who + topic.id)) % structures.length];
  const art = contentMod.buildArticle({ soldier: who, topic, structure, facts, rng: contentMod.mulberry32(cadenceMod.hashStr(dayISO + topic.id)) });
  if (!art) { R.status = 'SKIP-BUILD-FAIL'; return R; }
  /* שער-איכות מול-ההיסטוריה האמיתית שלי ושל-הצי */
  const mine = await authorPosts(who, 7);
  const fleetTitles = [];
  for (const n of ['cashmachine', 'haran', 'wic', 'woq', 'macrame', 'siq']) if (n !== who) { const ps = await authorPosts(n, 3); fleetTitles.push(...ps.map((p) => p.title)); await sleep(120); }
  const issues = contentMod.lintArticle({ title: art.title, body: art.body, ownRecentTitles: mine.map((p) => p.title), ownRecentBodies: mine.map((p) => p.body), fleetRecentTitles: fleetTitles });
  if (issues.length) { R.status = 'SKIP-LINT:' + issues.join(','); return R; }
  const permlink = `v3-${topic.id}-${who}-${dayISO.replace(/-/g, '')}`;
  const exists = await getContent(who, permlink);
  if (exists && exists.author === who) { R.status = 'SKIP-ALREADY-POSTED'; return R; }
  /* סורג-בייטים: מפתח-הפרסום שלי מול-הרשות-על-השרשרת — לפני-כל-חתימה */
  const accPost = (await retry(() => P((cb) => steem.api.getAccounts([who], cb))))[0];
  if (!accPost || !verifyKey(wif, accPost).ok) { R.status = 'SKIP-KEY-MISMATCH'; return R; }
  R.status = 'READY'; R.topic = topic.id; R.structure = structure; R.permlink = permlink; R.title = art.title;
  return { R, op: ['comment', { parent_author: '', parent_permlink: topic.id, author: who, permlink, title: art.title, body: art.body, json_metadata: JSON.stringify({ tags: ['hebrew', 'blog', topic.id, 'network', 'tech'], app: 'saos-cadence/1', format: 'markdown' }) }], wif, who, permlink, rotUpdate: { soldier: who, topicId: topic.id } };
}

async function doVote(slot, keys, m, dayISO) {
  const who = slot.account;
  const R = { t: slot.t, account: who, kind: 'vote', status: 'SKIP' };
  const wif = keys[who]; if (!wif) { R.status = 'DRY-NO-KEY'; return R; }
  /* מועמדים: פוסטי-צי טריים (≤6.5 יום), לא-שלי, שלא-הצבעתי בהם */
  const cand = [];
  for (const n of ['headcorner', 'cashmachine', 'haran', 'israelnews', 'lsa', 'macrame', 'siq', 'tov', 'wic', 'wog', 'woq']) {
    if (n === who) continue;
    const ps = await authorPosts(n, 5); await sleep(100);
    for (const p of ps) { const age = (Date.now() - Date.parse(p.created.replace(' ', 'T') + 'Z')) / 864e5; if (age >= 0 && age <= 6.5) cand.push(p); }
  }
  cand.sort((a, b) => Date.parse(b.created.replace(' ', 'T') + 'Z') - Date.parse(a.created.replace(' ', 'T') + 'Z'));
  for (const p of cand.slice(0, 6)) {
    const c = await getContent(p.author, p.permlink);
    if (!c || !c.author) continue;
    if ((c.active_votes || []).some((v) => v.voter === who)) continue;
    const acc = (await retry(() => P((cb) => steem.api.getAccounts([who], cb))))[0];
    if (acc.voting_power / 100 < 20) { R.status = 'SKIP-VP-LOW(honest)'; return R; }
    const vk = verifyKey(wif, acc);
    if (!vk.ok) { R.status = 'SKIP-KEY-MISMATCH'; return R; }
    R.status = 'VOTED'; R.target = p.author + '/' + p.permlink; R.weight = slot.weight;
    if (HAS) return R;
    try {
      await broadcast([['vote', { voter: who, author: p.author, permlink: p.permlink, weight: slot.weight }]], wif);
      await sleep(2500);
      const back = await getContent(p.author, p.permlink);
      const hit = (back && back.active_votes || []).find((v) => v.voter === who);
      R.status = hit ? 'VOTED-VERIFIED' : 'VOTED-READBACK-PENDING';
      R.author = p.author; R.permlink = p.permlink;
    } catch (e) { R.status = 'FAIL:' + String(e.message || e).slice(0, 60); }
    return R;
  }
  R.status = 'SKIP-NO-CANDIDATE(already covered)';
  return R;
}

async function doComment(slot, keys, m, dayISO) {
  const who = slot.account;
  const R = { t: slot.t, account: who, kind: 'comment', status: 'SKIP' };
  const wif = keys[who]; if (!wif) { R.status = 'DRY-NO-KEY'; return R; }
  const memPath = path.join(SOCIAL_DIR, 'comment-memory.json');
  const mem = readJson(memPath, { openers: {} });
  const myOpenersForAuthor = (mem.openers[who] || []).filter((x) => Date.now() - Date.parse(x.at) < 14 * 864e5).map((x) => x.body);
  const recent = await myComments(who, 8);
  const myRecentBodies = recent.map((c) => c.body);
  /* מועמדים: פוסטי-צי מ-48 שעות, לא-שלי, שלא-הגבתי בהם */
  const cand = [];
  for (const n of ['haran', 'wic', 'woq', 'siq', 'tov', 'israelnews', 'lsa', 'macrame', 'cashmachine', 'wog', 'headcorner']) {
    if (n === who) continue;
    const ps = await authorPosts(n, 4); await sleep(100);
    for (const p of ps) { const ageH = (Date.now() - Date.parse(p.created.replace(' ', 'T') + 'Z')) / 36e5; if (ageH >= 0 && ageH <= 48) cand.push(p); }
  }
  cand.sort((a, b) => Date.parse(b.created.replace(' ', 'T') + 'Z') - Date.parse(a.created.replace(' ', 'T') + 'Z'));
  const acc = (await retry(() => P((cb) => steem.api.getAccounts([who], cb))))[0];
  const myStat = { sp: m.fleet && (who === 'headcorner' ? m.fleet.headSP : 31), vp: acc ? Math.round(acc.voting_power / 100) : 50 };
  for (const p of cand.slice(0, 5)) {
    const reps = await repliesOf(p.author, p.permlink);
    if (reps.some((r) => r.author === who)) continue;
    let built = null;
    for (let seed = 1; seed <= 5 && !built; seed++) {
      const c = cqMod.buildComment({ postBody: p.body, myStat, rng: mulberrySeeded(dayISO, who, p.permlink, seed) });
      if (c && cqMod.guardComment(c.body, myRecentBodies, myOpenersForAuthor).length === 0) built = { ...c, permlink: p.permlink, author: p.author };
    }
    if (!built) continue;
    R.status = 'COMMENTED'; R.target = built.author + '/' + built.permlink; R.anchor = built.anchor.kind;
    if (HAS) return R;
    try {
      const cPermlink = 'c-' + dayISO.replace(/-/g, '') + '-' + who + '-' + cadenceMod.hashStr(built.permlink).toString(36);
      await broadcast([['comment', { parent_author: built.author, parent_permlink: built.permlink, author: who, permlink: cPermlink, title: '', body: built.body, json_metadata: JSON.stringify({ tags: ['hebrew'], app: 'saos-cadence/1', format: 'markdown' }) }]], wif);
      await sleep(2500);
      const back = await getContent(built.author, built.permlink);
      const hit = (back ? await repliesOf(built.author, built.permlink) : []).find((r) => r.author === who && r.permlink === cPermlink);
      R.status = hit ? 'COMMENTED-VERIFIED' : 'COMMENTED-READBACK-PENDING';
      R.author = built.author; R.permlink = cPermlink;
      mem.openers[who] = [...(mem.openers[who] || []).slice(-40), { at: new Date().toISOString(), body: built.body }];
      writeJson(memPath, mem);
    } catch (e) { R.status = 'FAIL:' + String(e.message || e).slice(0, 60); }
    return R;
  }
  R.status = 'SKIP-NO-TARGET(all covered — honest)';
  return R;
}

function mulberrySeeded(...parts) { return cadenceMod.mulberry32(cadenceMod.hashStr(parts.join('|'))); }

/* ── main ── */
async function main() {
  const keys = loadKeys();
  const DRY = HAS || Object.keys(keys).length === 0;
  if (!steem) { console.log('[cadence] steem.js unavailable — DRY exit'); return; }
  const now = new Date();
  const dayISO = now.toISOString().slice(0, 10);
  const FLEET = ['headcorner', 'cashmachine', 'haran', 'israelnews', 'lsa', 'macrame', 'siq', 'tov', 'wic', 'wog', 'woq', 'ynet'];
  const cal = cadenceMod.buildCalendar({ dayISO, fleet: FLEET, retired: ['ynet'] });
  const nowMin = now.getUTCHours() * 60 + now.getUTCMinutes();
  const due = cal.slots.filter((s) => { const [h, mi] = s.t.split(':').map(Number); return h * 60 + mi <= nowMin + 2 && h * 60 + mi >= nowMin - LOOKBACK; });

  const outPath = path.join(OUT_DIR, `social-cadence-${dayISO.replace(/-/g, '')}.json`);
  const receipt = readJson(outPath, { ok: true, tool: 'agents/social/cadence-run.cjs', day: dayISO, doctrine: 'all-day cadence — one action per moment, never a flock', runs: {} });
  receipt.runs[now.toISOString()] = { mode: DRY ? 'dry' : 'live', dueCount: due.length, rows: [] };
  const runRows = receipt.runs[now.toISOString()].rows;
  console.log(`[cadence] day=${dayISO} mode=${DRY ? 'DRY' : 'LIVE'} due=${due.length}/${cal.slots.length} · minFleetGap=${cal.stats.minFleetGap}m`);

  if (due.length) {
    const m = await measure();
    for (const slot of due) {
      let row;
      try {
        if (slot.kind === 'post') {
          const rotPath = path.join(SOCIAL_DIR, 'rotation-state.json');
          const rot = readJson(rotPath, { soldierHistory: {}, fleetHistory: {} });
          const res = await doPost(slot, keys, m, dayISO, rot, runRows);
          if (res && res.op) {
            if (!DRY) {
              await broadcast([res.op, ['comment_options', { author: res.who, permlink: res.permlink, max_accepted_payout: '1000000.000 SBD', percent_steem_dollars: 10000, allow_votes: true, allow_curation_rewards: true, extensions: [] }]], res.wif);
              await sleep(3000);
              const back = await getContent(res.who, res.permlink);
              res.R.status = back && back.author === res.who ? 'POSTED-VERIFIED' : 'POSTED-READBACK-PENDING';
            } else {
              res.R.status = 'DRY-WOULD-POST';
            }
            const dayNum = Math.floor(Date.parse(dayISO + 'T00:00:00Z') / 864e5);
            rot.soldierHistory[res.rotUpdate.soldier] = { ...(rot.soldierHistory[res.rotUpdate.soldier] || {}), [res.rotUpdate.topicId]: dayNum };
            rot.fleetHistory[res.rotUpdate.topicId] = dayNum;
            writeJson(rotPath, rot);
            row = res.R;
            row.url = `https://steemit.com/@${res.who}/${res.permlink}`;
          } else row = res;
        } else if (slot.kind === 'vote') {
          row = await doVote(slot, keys, m, dayISO);
        } else if (slot.kind === 'comment') {
          row = await doComment(slot, keys, m, dayISO);
        } else row = { t: slot.t, account: slot.account, kind: slot.kind, status: 'SKIP-UNKNOWN-KIND' };
      } catch (e) { row = { t: slot.t, account: slot.account, kind: slot.kind, status: 'FAIL:' + String(e.message || e).slice(0, 60) }; }
      runRows.push(row || { t: slot.t, account: slot.account, kind: slot.kind, status: 'SKIP' });
      console.log(`  ${slot.t} ${slot.kind.padEnd(7)} @${slot.account} → ${row.status || 'SKIP'}`);
      await sleep(400);
    }
  }
  receipt.lastCalendarStats = cal.stats;
  writeJson(outPath, receipt);
  console.log('[cadence] receipt → ' + outPath);
}

main().catch((e) => { console.error('[cadence] fatal (fail-soft, no exit-1):', String(e.message || e).slice(0, 160)); process.exit(0); });
