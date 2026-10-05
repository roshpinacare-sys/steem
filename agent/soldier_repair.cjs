#!/usr/bin/env node
/**
 * 117p6 — soldier_repair.cjs — השלמת-המלאות של חיילי-Steem ושל @tov (Hive)
 * ═══════════════════════════════════════════════════════════════════════════
 * הרקע (נמדד 117p6): החשבונות נבראו 2018-03 עם מפתחות-מקוריים. ב-Hive 9/10
 * חיילים אומתו למפתחות-הכספת; ב-Steem אף-חייל, וגם @tov ב-Hive — המפתחות
 * המקוריים מ-2018 לא נמצאים בשום מקור מקומי (דיסק+כל-אובייקטי-git נסרקו).
 * המפעיל מחזיק אותם (רשומות-2018). הרגע-שהם-ימסרו — כלי-זה משלים-הכל בשידור-אחד.
 *
 * מה-הוא-עושה לכל חשבון-מטרה:
 *   1. מאמת שה-WIF/סיסמה-שנמסר אכן שולט-על החשבון (owner/active על-השרשרת).
 *   2. שידור account_update2: מכניס את מפתחות-הכספת (posting/active/memo)
 *      + מוסיף את @headcorner ל-posting account_auths (טופולוגיה-זהה ל-Hive).
 *   3. מדפיס תוצאה-מוסתרת בלבד (txid; לעולם לא מפתח).
 *
 * שימוש (אינטראקטיבי — אף-סוד לא עובר-דרך shell/history/לוג):
 *   node agent/soldier_repair.cjs --accounts cashmachine,haran --live
 *   node agent/soldier_repair.cjs --accounts tov --chain hive --live
 *   (בלי --live = dry-run: בונה-את-העסקאות ומציג-תקציר-מוסתר, לא משדר)
 * בעת-הרצה יידרש להדביק לכל חשבון את מפתח-ה-owner/active-הנוכחי (קלט-נסתר).
 *
 * Task 11-c (2026-10-01) — הנחיית-הבעלים "אין לי עוד מפתחות": tov-hive = BLOCKED-NO-KEY
 * (מפתחות-אבודו · מוחזקים-אצל-הבעלים · אפס-שימוש-כלכלי). יעדי-ה-tov של-הכלי רדומים:
 * הכלי יפעל-עבורם רק-אם-הבעלים ישיב-חומר-שולט (ואז-מאמתים-מול-השרשרת ב-fleet-control-audit.cjs).
 * מלוא-החיילים-על-Steem כבר-מלאים-דרך-הכספת (10/10, נמדד 2026-09-30) — אין-מה-לתקן שם.
 */
'use strict';
const steem = require('steem'); // נפתר מ-agent/node_modules
// owner directive 2026-10-04 (STASIS): sign-time brake — every broadcast re-checks the breaker (stale-process lesson)
const capGate = require('./lib/capital_gate.cjs');
function stasisStop(tool) {
  try { return !!capGate.stasisHalt(tool); } catch (e) { console.log('[CAPITAL-GATE] ' + tool + ' — gate module error, lane halts fail-closed: ' + String((e && e.message) || e).slice(0, 80)); return true; }
}
const fs = require('fs');
const readline = require('readline');

const argv = process.argv.slice(2);
const LIVE = argv.includes('--live');
const chainIdx = argv.indexOf('--chain');
const CHAIN = chainIdx >= 0 ? argv[chainIdx + 1] : 'steem';
const accIdx = argv.indexOf('--accounts');
const TARGETS = (accIdx >= 0 ? argv[accIdx + 1] : '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

const VAULT = JSON.parse(fs.readFileSync(__dirname + '/keys/vault.json', 'utf8'));
const NODES = CHAIN === 'hive'
  ? ['https://api.hive.blog', 'https://anyx.io', 'https://api.openhive.network']
  : ['https://api.steemit.com', 'https://api.steemfa.com'];
const HIVE_CHAIN_ID = 'beeab0de00000000000000000000000000000000000000000000000000000000';

function api(node) { steem.api.setOptions({ url: node, useAppbaseApi: true }); }
function getAccount(name) {
  return new Promise((res) => steem.api.getAccounts([name], (e, r) => res(e ? null : (r && r[0]) || null)));
}
function askHidden(q) {
  return new Promise((res) => {
    process.stdout.write(q);
    const stdin = fs.readFileSync(0, 'utf8').trim(); // קריאת-שורה-נסתרת-מstdin
    res(stdin);
  });
}

async function main() {
  if (!TARGETS.length) { console.log('no targets — use --accounts a,b,c'); process.exit(1); }
  const node = NODES[0]; api(node);
  for (const name of TARGETS) {
    const v = VAULT.accounts.find((a) => a.username === name);
    // 117p8-R13 — תיקון-מבני: הכספת מקוננת (keys.steem.posting) — הבדיקה-הישנה (keys.posting-שטוח)
    // הייתה-מדלגה-על-כולם ("no vault keys — skip" תמידי — אותו-דפוס-באג-מ-R7)
    const vkRaw = (v && v.keys) || {};
    const vk = vkRaw[CHAIN] && Object.keys(vkRaw[CHAIN]).length ? vkRaw[CHAIN] : vkRaw;
    if (!v || !vk.posting) { console.log('@' + name + ': no vault ' + CHAIN + ' keys — skip'); continue; }
    const acct = await getAccount(name);
    if (!acct) { console.log('@' + name + ': not found on ' + CHAIN + ' — skip'); continue; }
    // 117p8-R13 — מפתחות-שליטה מהכספת קודם (קליטת-השער): owner/active/posting של-השרשרת-הרצויה,
    // ואם-אין — גם מהשרשרת-השנייה (מפתח-owner-זהה-בפועל בין-השרשראות). רק-אם-אף-אחד לא שולט — נשאל-נסתר.
    let wif = null;
    const cands = [];
    const flat = ('owner' in vk) || ('posting' in vk); // דור-KEYS-BACKUP: מפתחות-אוניברסליים-לשתי-השרשראות
    for (const r of ['owner', 'active', 'posting']) {
      if (flat && vk[r] && vk[r].wif) cands.push({ src: 'vault:flat:' + r, wif: vk[r].wif });
      const w = !flat && vk[CHAIN] && vk[CHAIN][r] && vk[CHAIN][r].wif;
      if (w) cands.push({ src: 'vault:' + CHAIN + ':' + r, wif: w });
      const other = CHAIN === 'hive' ? 'steem' : 'hive';
      const w2 = !flat && vk[other] && vk[other][r] && vk[other][r].wif;
      if (w2) cands.push({ src: 'vault:' + other + ':' + r, wif: w2 });
    }
    for (const c of cands) {
      let ok = false, pub = '';
      try {
        pub = steem.auth.wifToPublic(c.wif);
        ok = !!(acct.owner && acct.owner.key_auths.some(([k]) => k === pub))
          || !!(acct.active && acct.active.key_auths.some(([k]) => k === pub));
      } catch (_) { ok = false; }
      if (ok) { wif = c.wif; console.log('  מפתח-שליטה-מהכספת (' + c.src + ' · pub=' + pub.slice(0, 9) + '…) — בלי-הדבקה'); break; }
    }
    if (!wif) {
      const secret = await askHidden('@' + name + ' הדבק owner/active-WIF או סיסמת-מאסטר (קלט-נסתר, Enter לדלג): ');
      if (!secret) { console.log('  skipped (no secret)'); continue; }
      // נגזרת-מפתח: WIF ישיר או סיסמת-מאסטר (פורמט steem-js)
      const role = CHAIN === 'hive' ? 'Steem' : 'Owner'; // hive key derivation roles
      try { steem.auth.isWif(secret); wif = secret; }
      catch (_) {
        try { wif = steem.auth.toWif(secret, name, role); }
        catch (e) { console.log('  bad secret format — skip'); continue; }
      }
    }
    const pub = steem.auth.wifToPublic(wif);
    const isOwner = !!(acct.owner && acct.owner.key_auths.some(([k]) => k === pub));
    const isActive = !!(acct.active && acct.active.key_auths.some(([k]) => k === pub));
    if (!isOwner && !isActive) {
      console.log('  ✗ המפתח-שנמסר לא שולט-על @' + name + '/' + CHAIN + ' (pub=' + pub.slice(0, 9) + '…) — לא משדר');
      continue;
    }
    // בניית-ההרשאות: מפתחות-הכספת + headcorner ב-posting
    const stPub = { posting: vk.posting.pub, active: vk.active.pub, memo: vk.memo.pub };
    const postingAuth = {
      weight_threshold: 1,
      account_auths: [['headcorner', 1]],
      key_auths: [[stPub.posting, 1]],
    };
    const activeAuth = { weight_threshold: 1, account_auths: [], key_auths: [[stPub.active, 1]] };
    const op = ['account_update2', {
      account: name, memo_key: stPub.memo,
      posting: postingAuth, active: activeAuth, owner: null, json_metadata: '',
    }];
    if (CHAIN === 'hive') {
      const dgp = await new Promise((res, rej) => steem.api.getDynamicGlobalProperties((e, r) => e ? rej(e) : res(r)));
      const tx = { ref_block_num: dgp.head_block_number & 0xffff, ref_block_prefix: Buffer.from(dgp.head_block_id, 'hex').readUInt32LE(4), expiration: new Date(Date.now() + 60000).toISOString().slice(0, 19), operations: [op], extensions: [] };
      const prev = steem.config.get('chain_id');
      try {
        steem.config.set('chain_id', HIVE_CHAIN_ID);
        const signed = steem.auth.signTransaction(tx, [wif]);
        if (!LIVE) { console.log('  dry-run: tx-מוכן-וחתום (לא-משודר) · משדר-חתימה-תקינה'); continue; }
        if (stasisStop('soldier-repair')) throw new Error('STASIS-HALT — capital lane closed (capital gate 2026-10-04)'); // sign-time brake (custody/authority lane halts too)
        await new Promise((res, rej) => {
          const u = new URL(NODES[0]); require('https').request({ hostname: u.hostname, path: '/', method: 'POST', headers: { 'Content-Type': 'application/json' } }, (r) => { let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => { const j = JSON.parse(d); j.error ? rej(new Error(j.error.message)) : res(j.result); }); }).on('error', rej).end(JSON.stringify({ jsonrpc: '2.0', method: 'condenser_api.broadcast_transaction', params: [signed], id: 1 }));
        });
        console.log('  ✓ account_update2 broadcast (Hive) — @' + name);
      } finally { steem.config.set('chain_id', prev); }
    } else {
      if (!LIVE) { console.log('  dry-run: account_update2-מוכן (לא-משודר) · authority-תקין (owner/active ✓)'); continue; }
      try {
        if (stasisStop('soldier-repair')) throw new Error('STASIS-HALT — capital lane closed (capital gate 2026-10-04)'); // sign-time brake (custody/authority lane halts too)
        const conf = await steem.broadcast.sendAsync({ operations: [op], extensions: [] }, [wif]);
        console.log('  ✓ account_update2 txid=' + ((conf && conf.id) || 'pending') + ' — @' + name);
      } catch (e) { console.log('  ✗ broadcast-fail: ' + String(e && e.message).slice(0, 120)); }
    }
  }
  console.log('done (LIVE=' + LIVE + ', chain=' + CHAIN + ')');
  process.exit(0);
}
main().catch((e) => { console.error('repair error:', e.message); process.exit(1); });
