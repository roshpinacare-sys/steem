#!/usr/bin/env node
/**
 * HEAD-REVIVE.CJS — הראש חוזר לפעולה (Z-19b, 2026-09-29)
 * מקור: מאסטר-הגזירה (הריבון העלה) → sha256(account+role+master) → WIF (4/4 אומת)
 * פעולות: תביעת-פרסים · הצבעה-משמעותית לפוסטי-חיילים (20%) · דגלול-עצמי 1% ·
 *          האצלת SP ל-10 החיילים (פיתוח-עצמי) · קריאה-חוזרת לכל-פעולה · fail-soft
 */
'use strict';
const fs = require('fs');
const steem = require('steem');
steem.api.setOptions({ url: 'https://api.steemit.com' });

const DERIVED = JSON.parse(fs.readFileSync('/home/z/my-project/.fleet/headcorner-derived.json', 'utf8'));
const HEAD = 'headcorner';
const P = (fn) => new Promise((res, rej) => fn((e, r) => e ? rej(e) : res(r)));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const receipt = { tool: 'head-revive.cjs', at: new Date().toISOString(), ops: [] };
  // שער-אמת: נגזרת-מפתח מול השרשרת
  const acc = await P(cb => steem.api.getAccounts([HEAD], cb)).then(r => r[0]);
  const postWif = DERIVED.steem.posting, actWif = DERIVED.steem.active;
  const pubCheck = steem.auth.wifToPublic(postWif) === acc.posting.key_auths[0][0];
  const actCheck = steem.auth.wifToPublic(actWif) === acc.active.key_auths[0][0];
  console.log(`[head-revive] posting-key gate: ${pubCheck} · active-key gate: ${actCheck}`);
  if (!pubCheck || !actCheck) { console.log('[head-revive] GATE FAIL — abort'); process.exit(0); }

  // ── 1. תביעת-פרסים (אם יש) ──
  const rs = acc.reward_steem_balance, sb = acc.reward_sbd_balance, rv = acc.reward_vesting_balance;
  const hasPending = parseFloat(rs) > 0 || parseFloat(sb) > 0 || parseFloat(rv) > 0;
  if (hasPending) {
    try {
      await P(cb => steem.broadcast.claimRewardBalance(postWif, HEAD, rs, sb, rv, cb));
      await sleep(2000);
      const a2 = await P(cb => steem.api.getAccounts([HEAD], cb)).then(r => r[0]);
      const cleared = parseFloat(a2.reward_steem_balance) === 0 && parseFloat(a2.reward_vesting_balance) === 0;
      receipt.ops.push({ op: 'claim_reward_balance', claimed: { steem: rs, sbd: sb, vests: rv }, verified: cleared });
      console.log(`[head-revive] CLAIMED ${rs} ${sb} ${rv} · readback cleared=${cleared}`);
    } catch (e) { receipt.ops.push({ op: 'claim_reward_balance', err: String(e.message).slice(0, 90) }); console.log('[head-revive] claim fail:', String(e.message).slice(0, 90)); }
  } else console.log('[head-revive] no pending rewards');

  // ── 2. הצבעות: פוסטי-החיילים-החיים (20%) + דגלול-עצמי (1%) ──
  const now = Date.now();
  const targets = [];
  for (const who of ['siq', 'tov', 'woq', 'haran', 'wic', 'israelnews']) {
    try {
      const d = await P(cb => steem.api.getDiscussionsByBlog({ tag: who, limit: 5 }, cb));
      for (const p of d) if ((now - Date.parse(p.created + 'Z')) / 864e5 <= 7) targets.push({ author: p.author, permlink: p.permlink, votes: p.active_votes.map(v => v.voter) });
    } catch (_) {}
  }
  for (const t of targets) {
    if (t.votes.includes(HEAD)) continue;
    try {
      await P(cb => steem.broadcast.vote(postWif, HEAD, t.author, t.permlink, 2000, cb));
      await sleep(1500);
      const c = await P(cb => steem.api.getContent(t.author, t.permlink, cb));
      const hit = (c.active_votes || []).find(v => v.voter === HEAD);
      receipt.ops.push({ op: 'vote', voter: HEAD, author: t.author, permlink: t.permlink, weight: 2000, verified: !!hit });
      console.log(`[head-revive] VOTE ${hit ? 'VERIFIED' : 'no-readback'}: headcorner→${t.author}/${t.permlink.slice(0, 30)} w=20%`);
    } catch (e) { receipt.ops.push({ op: 'vote', author: t.author, err: String(e.message).slice(0, 80) }); console.log('[head-revive] vote fail:', String(e.message).slice(0, 80)); }
  }
  // דגלול עצמי 1%
  try {
    const d = await P(cb => steem.api.getDiscussionsByBlog({ tag: HEAD, limit: 5 }, cb));
    const flag = d.find(p => /^saos-grid-\d{8}$/.test(p.permlink) && (now - Date.parse(p.created + 'Z')) / 864e5 <= 7);
    if (flag && !flag.active_votes.some(v => v.voter === HEAD)) {
      await P(cb => steem.broadcast.vote(postWif, HEAD, HEAD, flag.permlink, 100, cb));
      receipt.ops.push({ op: 'self-vote-flagship', permlink: flag.permlink, weight: 100 });
      console.log('[head-revive] FLAGSHIP self-vote 1%:', flag.permlink);
    }
  } catch (e) { console.log('[head-revive] flagship skip:', String(e.message).slice(0, 70)); }

  // ── 3. האצלת SP ל-10 החיילים (30 SP כל-אחד · ניתן-לביטול) ──
  const g = await P(cb => steem.api.getDynamicGlobalProperties(cb));
  const ratio = parseFloat(g.total_vesting_fund_steem) / parseFloat(g.total_vesting_shares);
  const vests30 = (30 / ratio).toFixed(6) + ' VESTS';
  const soldiers = ['cashmachine', 'haran', 'israelnews', 'lsa', 'macrame', 'siq', 'tov', 'wic', 'wog', 'woq'];
  const a3 = await P(cb => steem.api.getAccounts([HEAD], cb)).then(r => r[0]);
  const curDel = {};
  for (const s of soldiers) curDel[s] = s === HEAD ? 0 : 0;
  for (const s of soldiers) {
    try {
      const sa = await P(cb => steem.api.getAccounts([s], cb)).then(r => r[0]);
      const already = parseFloat(sa.received_vesting_shares);
      const want = 30 / ratio;
      if (already >= want * 0.98) { receipt.ops.push({ op: 'delegate', to: s, status: 'SKIP-ALREADY' }); continue; }
      await P(cb => steem.broadcast.delegateVestingShares(actWif, HEAD, s, vests30, cb));
      await sleep(1500);
      const sa2 = await P(cb => steem.api.getAccounts([s], cb)).then(r => r[0]);
      const got = parseFloat(sa2.received_vesting_shares) >= want * 0.98;
      receipt.ops.push({ op: 'delegate', to: s, vests: vests30, verified: got });
      console.log(`[head-revive] DELEGATE ${got ? 'VERIFIED' : 'no-readback'}: 30 SP → @${s}`);
    } catch (e) { receipt.ops.push({ op: 'delegate', to: s, err: String(e.message).slice(0, 80) }); console.log('[head-revive] delegate fail @' + s + ':', String(e.message).slice(0, 80)); }
  }
  fs.writeFileSync('/home/z/my-project/fleet-outbox/head-revive-receipt.json', JSON.stringify(receipt, null, 2));
  console.log('[head-revive] DONE · ops:', receipt.ops.length, '· receipt → fleet-outbox/head-revive-receipt.json');
  process.exit(0);
})().catch(e => { console.error('[head-revive] fatal:', String(e.message || e).slice(0, 150)); process.exit(0); });
