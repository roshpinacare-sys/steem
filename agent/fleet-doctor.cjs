#!/usr/bin/env node
/**
 * SAOS FLEET-DOCTOR ENGINE v1 — רופא-הצי (Z-20, 2026-09-29)
 *
 * מה-זה: אבחון-עצמי יומי-מלא של הרשת — נטול-מפתחות (קריאה-בלבד):
 *   · מצב-הון: SP/VP/RC/האצלות לכל-12 החשבונות
 *   · מצב-תוכן: פוסטים-חיים (7d), קולות-פר-פוסט, פנדינג
 *   · כיסוי-קהל: מטריצת-ההצבעה הצולבת — מי הצביע למי, כיסוי-%
 *   · פערים-כנים: VP=0, האצלות-חסרות, פוסטים-ללא-קולות
 * פלט: agent/state-report.json + fleet-outbox/STATE-REPORT-{day}.md — אפס-סודות.
 *
 * הרצה: node agent/fleet-doctor.cjs   (קריאה-בלבד · fail-soft · בלי-כספת)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const steem = require('steem');

steem.api.setOptions({ url: 'https://api.steemit.com' });
const ROOT = path.resolve(__dirname, '..');
const FLEET = ['cashmachine', 'haran', 'israelnews', 'lsa', 'macrame', 'siq', 'tov', 'wic', 'wog', 'woq', 'ynet', 'headcorner'];
const SOLDIERS = FLEET.filter(a => a !== 'headcorner');
const MIN_VP = 20, MIN_RC = 30;

const P = (fn) => new Promise((res, rej) => fn((e, r) => e ? rej(e) : res(r)));
const https = require('https');
function rpc(method, params) {
  return new Promise((res, rej) => {
    const body = JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 });
    const req = https.request({ hostname: 'api.steemit.com', path: '/', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }, timeout: 20000 }, (r) => {
      let d = ''; r.on('data', c => d += c); r.on('end', () => { try { const j = JSON.parse(d); j.error ? rej(new Error(j.error.message)) : res(j.result); } catch (e) { rej(e); } });
    });
    req.on('error', rej); req.write(body); req.end();
  });
}

async function main() {
  const t0 = new Date().toISOString();
  const day = t0.slice(0, 10);
  console.log(`[doctor] fleet-doctor start ${t0} — keyless read-only diagnosis`);

  // ── 1. מצב-הון ──
  const globals = await P(cb => steem.api.getDynamicGlobalProperties(cb));
  const ratio = parseFloat(globals.total_vesting_fund_steem) / parseFloat(globals.total_vesting_shares);
  const accts = await P(cb => steem.api.getAccounts(FLEET, cb));
  const fleet = [];
  for (const a of accts) {
    let rcPct = null;
    try {
      const rc = await rpc('rc_api.find_rc_accounts', { accounts: [a.name] });
      const x = rc.rc_accounts[0];
      rcPct = Math.round(100 * Number(x.rc_manabar.current_mana) / Number(x.max_rc) * 10) / 10;
    } catch (_) {}
    const spOwn = parseFloat(a.vesting_shares) * ratio;
    const delIn = parseFloat(a.received_vesting_shares) * ratio;
    const delOut = parseFloat(a.delegated_vesting_shares) * ratio;
    fleet.push({
      name: a.name,
      sp: Math.round(spOwn * 10) / 10,
      spNet: Math.round((spOwn + delIn - delOut) * 10) / 10,
      vp: Math.round(a.voting_power / 10) / 10,
      rc: rcPct,
      delInSp: Math.round(delIn * 10) / 10,
      delOutSp: Math.round(delOut * 10) / 10,
      pendingClaim: Math.round((parseFloat(a.reward_steem_balance) + parseFloat(a.reward_vesting_balance) * ratio) * 1000) / 1000,
      pendingSbd: parseFloat(a.reward_sbd_balance),
      steem: parseFloat(a.balance), sbd: parseFloat(a.sbd_balance),
    });
  }
  const totalSP = Math.round(fleet.reduce((s, x) => s + x.spNet, 0) * 10) / 10;
  const vpFull = fleet.filter(x => x.vp >= 90).length;
  const vpReady = fleet.filter(x => x.vp >= MIN_VP).length;
  const vpZero = fleet.filter(x => x.vp < MIN_VP && x.name !== 'headcorner');
  console.log(`[doctor] capital: total net SP=${totalSP} · VP≥90%: ${vpFull}/12 · VP≥${MIN_VP}%: ${vpReady}/12 · soldiers VP-low: ${vpZero.map(x => x.name).join(',') || 'none'}`);

  // ── 2. תוכן-חי (7d) + כיסוי-קהל ──
  const now = Date.now();
  const posts = [];
  for (const ac of FLEET) {
    try {
      const d = await P(cb => steem.api.getDiscussionsByBlog({ tag: ac, limit: 10 }, cb));
      for (const p of d) {
        const age = (now - Date.parse(p.created + 'Z')) / 864e5;
        if (age >= 0 && age <= 7) {
          const voters = p.active_votes.map(v => v.voter);
          const fleetVotes = voters.filter(v => FLEET.includes(v));
          const externalVotes = voters.filter(v => !FLEET.includes(v));
          posts.push({
            author: p.author, permlink: p.permlink, created: p.created,
            totalVotes: voters.length, fleetVotes: fleetVotes.length, externalVotes: externalVotes.length,
            externalVoters: externalVotes.slice(0, 5),
            missingFleetVotes: FLEET.filter(v => v !== p.author && !voters.includes(v)),
            pendingPayout: p.pending_payout_value,
          });
        }
      }
    } catch (e) { console.log(`[doctor] feed ${ac}: ${String(e.message || e).slice(0, 50)}`); }
  }
  // כיסוי: על כל-פוסט — כמה מהצי-האפשרי הצביע (כולל-מחבר-כפול-הצבעה-עצמית-חלקית)
  let possible = 0, done = 0;
  for (const p of posts) {
    possible += FLEET.length - 1;
    done += p.fleetVotes - (p.author === 'headcorner' && !FLEET.slice(0, -1).includes(p.author) ? 0 : 0);
  }
  const coverage = possible ? Math.round(done / possible * 100) : 0;
  console.log(`[doctor] content: ${posts.length} live posts (7d) · audience coverage ${done}/${possible} = ${coverage}%`);
  posts.forEach(p => console.log(`   · ${p.author}/${p.permlink.slice(0, 36)} votes=${p.totalVotes} fleet=${p.fleetVotes} ext=${p.externalVotes} missing=${p.missingFleetVotes.length}`));

  // ── 3. פנדינג-וכספים ──
  const pendingPayout = posts.reduce((s, p) => s + parseFloat(p.pendingPayout) || 0, 0);
  const liquidSteem = Math.round(fleet.reduce((s, x) => s + x.steem, 0) * 1000) / 1000;
  const claimsPending = fleet.filter(x => x.pendingClaim > 0.0001).map(x => x.name);
  console.log(`[doctor] economy: pending on live posts ≈ ${pendingPayout.toFixed(3)} SBD · liquid STEEM fleet-wide = ${liquidSteem} · pending claims: ${claimsPending.join(',') || 'none'}`);

  // ── 4. פערים-כנים ──
  const gaps = [];
  if (vpZero.length) gaps.push(`VP-regen: ${vpZero.length} soldiers below ${MIN_VP}% (${vpZero.map(x => `${x.name}@${x.vp}%`).join(', ')}) — natural ~20%/day recovery, engine gates re-admit them automatically`);
  const undel = SOLDIERS.filter(s => { const f = fleet.find(x => x.name === s); return f && f.delInSp < 29; });
  if (undel.length) gaps.push(`delegation gap: ${undel.join(',')} below 30 SP from head`);
  const unvoted = posts.filter(p => p.missingFleetVotes.length > 0);
  if (unvoted.length) gaps.push(`audience gap: ${unvoted.length} posts with missing fleet votes (next sweep fills idempotently)`);
  if (!posts.length) gaps.push('content gap: no live posts in 7d window');
  if (!gaps.length) gaps.push('none — all green');
  console.log(`[doctor] honest gaps: ${gaps.length}`);
  gaps.forEach(g => console.log(`   ! ${g}`));

  // ── 5. פלטים ──
  const report = {
    ok: true, tool: 'fleet-doctor.cjs', doctrine: 'the network measures itself — keyless, read-only, honest',
    at: t0, day,
    capital: { totalNetSp: totalSP, vpFull, vpReady, ratioSpPerVest: Math.round(ratio * 1e6) / 1e6, fleet },
    content: { livePosts: posts.length, audienceCoveragePct: coverage, posts },
    economy: { pendingOnLivePostsSbd: Math.round(pendingPayout * 1000) / 1000, liquidSteem, claimsPending },
    gaps,
    ciSchedule: {
      'steem/self-audience.yml': '14:30 UTC daily — publish → delegate → cross-vote → doctor',
      'Domain/anchor-execute': 'hourly :55 — dayRoot signatures OP+BASE (secret-gated)',
      'Domain/daily-claim.yml': '02:37 UTC daily — posting-only claim compounding',
      'Domain/cloud-heart': 'grid heartbeat + weave-anchor-lines dispatch',
    },
  };
  const jr = path.join(ROOT, 'agent', 'state-report.json');
  fs.mkdirSync(path.dirname(jr), { recursive: true });
  fs.writeFileSync(jr, JSON.stringify(report, null, 2));

  // דוח-מקצועי (markdown) → fleet-outbox
  const lines = [
    `# STATE-REPORT ${day} — רופא-הצי (אבחון-עצמי נטול-מפתחות)`,
    ``,
    `נמדד: ${t0} · קריאה-בלבד מהשרשרת · אפס-סודות`,
    ``,
    `## הון הרשת`,
    ``,
    `| חשבון | SP נטו | VP% | RC% | מואצל-אליו | מאציל |`,
    `|---|---|---|---|---|---|`,
    ...fleet.map(f => `| @${f.name} | ${f.spNet} | ${f.vp} | ${f.rc == null ? 'n/a' : f.rc} | ${f.delInSp} | ${f.delOutSp} |`),
    ``,
    `**סה"כ SP נטו: ${totalSP}** · VP≥90%: ${vpFull}/12 · VP≥${MIN_VP}%: ${vpReady}/12`,
    ``,
    `## תוכן-חי (7 ימים) — כיסוי-קהל ${coverage}%`,
    ``,
    ...posts.map(p => `- @${p.author}/${p.permlink} — קולות ${p.totalVotes} (צי ${p.fleetVotes} · חוץ ${p.externalVotes}) · פנדינג ${p.pendingPayout}`),
    ``,
    `## כלכלה`,
    ``,
    `- פנדינג על פוסטים-חיים: ≈ ${pendingPayout.toFixed(3)} SBD`,
    `- STEEM נזיל בצי: ${liquidSteem}`,
    `- תביעות-ממתינות: ${claimsPending.join(', ') || 'אין'}`,
    ``,
    `## פערים-כנים`,
    ``,
    ...gaps.map(g => `- ${g}`),
    ``,
    `## רכבת-ה-CI`,
    ``,
    ...Object.entries(report.ciSchedule).map(([k, v]) => `- \`${k}\` — ${v}`),
    ``,
    `---`,
    `ריבונות = למדוד את עצמך בכנות, כל-יום, בלי-לבקש רשות.`,
  ];
  const md = process.env.STATE_OUT || path.join(ROOT, `STATE-REPORT-${day.replace(/-/g, '')}.md`);
  fs.mkdirSync(path.dirname(md), { recursive: true });
  fs.writeFileSync(md, lines.join('\n') + '\n');
  console.log(`[doctor] DONE · state-report → ${jr} · STATE-REPORT → ${md}`);
}
main().catch(e => { console.error('[doctor] fatal:', String(e.message || e).slice(0, 180)); process.exit(0); }); // fail-soft
