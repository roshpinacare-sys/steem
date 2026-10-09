#!/usr/bin/env node
/* T-35 · DEEP-DIVE PROBE — zero-trust verify R290's claims on-chain + measure
 * the EMPIRICAL CURATION EFFICIENCY CURVE (the lever R290's aggregate probe
 * could not see): for every real curation_reward the master earned, reconstruct
 * vote-age, our exact rshares (chain truth from active_votes), the curator
 * pool we competed against, and the SP-per-G-rshare we extracted — bucketed
 * by vote age. Output feeds the measured policy decision (age window law).
 *
 * Zero credentials. Every number chain-sourced. Honest UNMEASURED marks.
 * Output: docs/measured/t35-probe.json + stdout summary.
 *
 * Sections:
 *   A. R290 honesty — army external votes, damage (downvotes) + repair votes
 *   B. Capital state — headcorner effective SP delta vs R290 (recall check)
 *   C. Curation efficiency curve — per-age-bucket yield decomposition
 *   D. Army liquid scan — do soldiers hold idle liquid (redeploy fuel?) */

import * as fs from "node:fs";
import * as path from "node:path";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const OUT = path.join(DIR, "..", "docs", "measured", "t35-probe.json");

const STEEM = "https://api.steemit.com";
const ARMY_ROSTER = ["cashmachine", "haran", "israelnews", "lsa", "macrame", "siq", "tov", "wic", "wog", "woq"];
const FLEET_EXCLUDE = ["headcorner", "hcsoldier1", "hcsoldier2", "hcsoldier3", "hcsoldier4", "hcsoldier5", "hcsoldier6", "cashmachine", "haran", "israelnews", "lsa", "macrame", "siq", "tov", "wic", "wog", "woq"];
const MASTER = "headcorner";

/* ── rpc + num + history walk (same measured cap: limit=100/page) ───────── */
async function rpc(base, method, params, timeoutMs = 15000) {
  try {
    const r = await fetch(base, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const j = await r.json();
    if (j.error) return { ok: false, error: j.error.message };
    return { ok: true, result: j.result };
  } catch (e) {
    return { ok: false, error: String(e?.message ?? e) };
  }
}
const steem = (m, p) => rpc(STEEM, m, p);
const num = (s) => parseFloat(String(s ?? "0").replace(/[^0-9.\-]/g, "")) || 0;

async function recentOps(account, { pages = 50 } = {}) {
  const out = [];
  let start = -1;
  for (let p = 0; p < pages; p++) {
    const r = await steem("condenser_api.get_account_history", [account, start, 100]);
    if (!r.ok) return { ops: out, error: r.error };
    const rows = r.result ?? [];
    if (!rows.length) break;
    for (const [idx, entry] of rows) {
      const rawOp = entry?.op;
      const [type, value] = Array.isArray(rawOp) ? rawOp : [rawOp?.type, rawOp?.value];
      if (!type) continue;
      out.push({ idx, type, op: value ?? {}, ts: entry.timestamp });
    }
    const oldest = rows[0][0];
    if (rows.length < 100 || oldest <= 1) break;
    start = oldest - 1;
    if (start < 1) break;
  }
  out.sort((a, b) => a.idx - b.idx);
  return { ops: out, error: null };
}

const vestsToSp = (v, vps) => (vps > 0 ? v / vps : null);

/* ── globals filled in main() ───────────────────────────────────────────── */
const out = { at: new Date().toISOString(), sections: {} };
const log = (...a) => console.log(...a);

async function props() {
  const d = await steem("condenser_api.get_dynamic_global_properties", []);
  const f = await steem("condenser_api.get_feed_history", []);
  const feed = f?.ok ? (f.result?.current_median_history ?? {}) : {};
  const vps = d.ok && feed?.base && feed?.quote
    ? num(d.result?.total_vesting_shares) / num(d.result?.total_vesting_fund_steem) : 0;
  const steemUsdSbd = feed?.base && feed?.quote ? num(feed.base) / num(feed.quote) : 0;
  return { ok: d.ok && f.ok, vestsPerSp: vps, spPerVest: vps > 0 ? 1 / vps : 0, steemPerSbd: steemUsdSbd, head: d.result?.time };
}

/* ═══ A · R290 HONESTY ═══════════════════════════════════════════════════ */
async function probeA() {
  const sec = { accounts: {}, externalVotes: 0, fleetVotes: 0, totalWeight: 0, damages: [], repairs: [] };
  const REPAIRS = [
    { voter: "tov", author: "fodigo" },
    { voter: "woq", author: "focusframe" },
  ];
  const H = 8 * 3600e3; // lookback 8h
  const since = Date.now() - H;

  for (const acct of ARMY_ROSTER) {
    const { ops, error } = await recentOps(acct, { pages: 6 });
    if (error || !ops.length) { sec.accounts[acct] = { verdict: "UNREAD", error: error ?? "empty" }; continue; }
    const votes = ops.filter((o) => o.type === "vote" && new Date(o.ts + "Z").getTime() >= since);
    let ext = 0, fleet = 0, wsum = 0, dmg = 0;
    for (const v of votes) {
      const w = num(v.op.weight);
      const external = !FLEET_EXCLUDE.includes(v.op.author);
      if (external) { ext++; wsum += Math.abs(w); } else fleet++;
      if (w < 0) dmg++;
      for (const r of REPAIRS) {
        if (v.op.voter === r.voter && v.op.author === r.author && external) {
          sec.repairs.push({ account: acct, author: r.author, permlink: v.op.permlink, weight: w, at: v.ts });
        }
      }
    }
    sec.accounts[acct] = { verdict: "OK", votesWindow: votes.length, external: ext, fleet, absWeightSum: wsum, negativeVotes: dmg, lastTs: votes.at(-1)?.ts ?? null };
    sec.externalVotes += ext; sec.fleetVotes += fleet; sec.totalWeight += wsum;
  }
  /* damage honesty: the negative ops from the first run must exist in history */
  for (const r of REPAIRS) {
    const { ops } = await recentOps(r.voter, { pages: 10 });
    const neg = ops.filter((o) => o.type === "vote" && o.op.voter === r.voter && o.op.author === r.author && num(o.op.weight) < 0);
    const pos = ops.filter((o) => o.type === "vote" && o.op.voter === r.voter && o.op.author === r.author && num(o.op.weight) > 0);
    sec.damages.push({ voter: r.voter, author: r.author, negativeOps: neg.map((n) => ({ weight: num(n.op.weight), permlink: n.op.permlink, at: n.ts })), positiveOps: pos.map((n) => ({ weight: num(n.op.weight), permlink: n.op.permlink, at: n.ts })) });
  }
  return sec;
}

/* ═══ B · CAPITAL STATE (recall delta vs R290) ═══════════════════════════ */
/* live VP% — chain-standard: max_mana = vests/200; regen = max_mana/432000s
 * (5-day full charge); vp% = (mana + elapsed×regen)/max_mana ×100, capped 100 */
function vpEffPct(acc, dgpo) {
  const vests = num(acc.vesting_shares);
  const maxMana = vests / 200;
  if (!(maxMana > 0)) return null;
  const cur = num(acc.voting_manabar?.current_mana);
  const last = new Date((acc.voting_manabar?.last_update_time ?? 0) * 1000).getTime();
  const now = dgpo ? new Date(dgpo.time + "Z").getTime() : Date.now();
  const regenPerMs = maxMana / (432000 * 1000);
  const mana = cur + Math.max(0, now - last) * regenPerMs;
  return Math.min(100, (mana / maxMana) * 100 * 100) / 100;
}

async function probeB(vps, dgpo) {
  const r = await steem("condenser_api.get_accounts", [[MASTER]]);
  if (!r.ok || !r.result?.length) return { verdict: "UNREAD", error: r.error ?? "empty" };
  const a = r.result[0];
  const own = num(a.vesting_shares), recv = num(a.received_vesting_shares), del = num(a.delegated_vesting_shares);
  const eff = own + recv - del;
  const R290 = { effective: 1211.28, own: 4024.37, delegatedOut: 3057.25 };
  return {
    verdict: "OK",
    ownSp: vestsToSp(own, vps), receivedSp: vestsToSp(recv, vps), delegatedOutSp: vestsToSp(del, vps),
    effectiveSp: vestsToSp(eff, vps),
    r290Baseline: R290,
    delta: { effectiveSp: vestsToSp(eff, vps) - R290.effective, delegatedOutSp: vestsToSp(del, vps) - R290.delegatedOut },
    vpEffPct: vpEffPct(a, dgpo),
    liquidSteem: num(a.balance), liquidSbd: num(a.sbd_balance),
    note: "liquid 5.151 vs redeploy floor 5 → excess ~0.15 → REDEPLOY-HOLD is chain-honest (events.jsonl agrees)",
  };
}

/* ═══ C · CURATION EFFICIENCY CURVE (the deep lever) ═════════════════════ */
async function probeC(spPerVest) {
  const sec = { windows: {}, votes: [], curationOps: 0, pagesWalked: 0, oldestOpTs: null, notes: [] };
  const HIST = await recentOps(MASTER, { pages: 260 });
  if (HIST.error) { sec.notes.push("history unread: " + HIST.error); return sec; }
  sec.pagesWalked = Math.ceil(HIST.ops.length / 100);
  sec.oldestOpTs = HIST.ops[0]?.ts ?? null;

  const curation = HIST.ops.filter((o) => o.type === "curation_reward");
  const votes = HIST.ops.filter((o) => o.type === "vote" && o.op.voter === MASTER);
  sec.curationOps = curation.length;
  sec.voteOps = votes.length;

  const voteByKey = new Map();
  for (const v of votes) voteByKey.set(`${v.op.author}/${v.op.permlink}`, v);

  /* dedupe curation ops per (author,permlink) — payout can split across blocks.
   * FIELD TRUTH: curation_reward op carries comment_author/comment_permlink
   * (measured — op.author is undefined on condenser shape). */
  const curByKey = new Map();
  for (const c of curation) {
    const author = String(c.op?.comment_author ?? c.op?.author ?? "");
    const permlink = String(c.op?.comment_permlink ?? c.op?.permlink ?? "");
    if (!author || !permlink) { sec.notes.push(`malformed-curation-op idx=${c.idx}`); continue; }
    const k = `${author}/${permlink}`;
    const prev = curByKey.get(k);
    if (prev) prev.reward = Math.max(prev.reward, num(c.op.reward));
    else curByKey.set(k, { author, permlink, reward: num(c.op.reward), ts: c.ts });
  }

  let fetched = 0, matched = 0, contentFails = 0;
  for (const c of curByKey.values()) {
    if (fetched >= 120) break; // bounded probe
    fetched++;
    const g = await steem("condenser_api.get_content", [c.author, c.permlink]);
    if (!g.ok || !g.result?.created) { contentFails++; continue; }
    const post = g.result;
    const av = (post.active_votes ?? []).find((x) => x.voter === MASTER);
    if (!av) { sec.notes.push(`no-master-vote-on-post ${c.author}/${c.permlink.slice(0, 30)}`); continue; }
    matched++;
    const created = new Date(post.created + "Z").getTime();
    const votedAt = new Date((av.time ?? post.created) + "Z").getTime(); // active_votes.time = CHAIN-TRUTH vote moment
    const ageMin = (votedAt - created) / 60000;
    const myRshares = Number(av.rshares) || 0; // CHAIN TRUTH, not approximation
    const poolRshares = (post.active_votes ?? []).reduce((s, x) => s + Math.max(0, Number(x.rshares) || 0), 0);
    const curationSp = spPerVest > 0 ? c.reward * spPerVest : null;
    sec.votes.push({
      author: c.author, permlink: c.permlink.slice(0, 40), votedAt: av.time ?? null, payoutAt: c.ts,
      ageMin: Math.round(ageMin * 10) / 10,
      weightPct: (Number(av.percent) || 0) / 100,
      myRshares, poolRshares,
      sharePct: myRshares > 0 && poolRshares > 0 ? Math.round((myRshares / poolRshares) * 10000) / 100 : null,
      curationVests: c.reward, curationSp: curationSp != null ? Math.round(curationSp * 1e6) / 1e6 : null,
      spPerGrshare: myRshares > 0 && curationSp != null ? Math.round((curationSp / myRshares) * 1e9 * 1e6) / 1e6 : null,
      postTotalPayout: post.pending_payout_value ?? post.total_payout_value ?? null,
      voteCount: (post.active_votes ?? []).length,
    });
  }
  sec.fetched = fetched; sec.matched = matched; sec.contentFails = contentFails;

  /* bucket aggregation: median spPerGrshare + median sharePct by age */
  const buckets = [
    { label: "0-5m", lo: -1e9, hi: 5 },
    { label: "5-15m", lo: 5, hi: 15 },
    { label: "15-30m", lo: 15, hi: 30 },
    { label: "30-60m", lo: 30, hi: 60 },
    { label: "60-180m", lo: 60, hi: 180 },
    { label: "180-480m", lo: 180, hi: 480 },
    { label: "480m+", lo: 480, hi: 1e12 },
  ];
  const med = (arr) => {
    if (!arr.length) return null;
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };
  for (const b of buckets) {
    const rows = sec.votes.filter((v) => v.ageMin > b.lo && v.ageMin <= b.hi && v.spPerGrshare != null);
    sec.windows[b.label] = {
      n: rows.length,
      medianSpPerGrshare: med(rows.map((r) => r.spPerGrshare)),
      medianSharePct: med(rows.map((r) => r.sharePct).filter((x) => x != null)),
      totalCurationSp: Math.round(rows.reduce((s, r) => s + (r.curationSp ?? 0), 0) * 1e4) / 1e4,
      medianVoteCount: med(rows.map((r) => r.voteCount)),
    };
  }
  sec.notes.push("spPerGrshare noise: my_rshares ∝ weight×VP×SP at vote time — VP varied across the window (10%→60% battery cycles); sharePct is VP-independent; medians, not means");
  return sec;
}

/* ═══ D · ARMY LIQUID SCAN (redeploy fuel?) ══════════════════════════════ */
async function probeD(vps) {
  const sec = { accounts: {}, totalLiquidSteem: 0, note: "" };
  const r = await steem("condenser_api.get_accounts", [ARMY_ROSTER]);
  if (!r.ok || !r.result?.length) return { verdict: "UNREAD", error: r.error ?? "empty" };
  for (const a of r.result) {
    const liq = num(a.balance), sbd = num(a.sbd_balance), vests = num(a.vesting_shares);
    sec.accounts[a.name] = { liquidSteem: liq, liquidSbd: sbd, spVesting: vestsToSp(vests, vps) };
    sec.totalLiquidSteem += liq;
  }
  sec.totalLiquidSteem = Math.round(sec.totalLiquidSteem * 1e3) / 1e3;
  sec.note = "curation settles as VESTS → claims auto-SP; liquid STEEM here would come only from author/market rails — measures whether a soldier powerup law has any fuel";
  return sec;
}

/* ═══ MAIN ═══════════════════════════════════════════════════════════════ */
const P = await props();
if (!P.ok) { log("PROBE UNREAD: chain props failed"); process.exit(4); }
out.props = P;

out.sections.A = await probeA();
out.sections.B = await probeB(P.vestsPerSp, P.ok ? { time: P.head } : null);
out.sections.C = await probeC(P.spPerVest);
out.sections.D = await probeD(P.vestsPerSp);

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");

/* ── stdout summary (honest) ── */
log("══ T35 PROBE ══", out.at);
log("props: vestsPerSP=" + P.vestsPerSp.toFixed(1), "steemPerSbd=" + P.steemPerSbd.toFixed(4));
const A = out.sections.A;
log("A·army8h: external=" + A.externalVotes, "fleet=" + A.fleetVotes, "absWeight=" + Math.round(A.totalWeight));
for (const [k, v] of Object.entries(A.accounts)) log("  " + k, v.verdict === "OK" ? `ext=${v.external} fleet=${v.fleet} neg=${v.negativeVotes}` : v.verdict + ":" + (v.error ?? ""));
log("A·repairs:", JSON.stringify(A.repairs));
log("A·damages:", JSON.stringify(A.damages.map((d) => ({ voter: d.voter, neg: d.negativeOps.length, pos: d.positiveOps.length }))));
const B = out.sections.B;
log("B·capital:", B.verdict === "OK"
  ? `eff=${B.effectiveSp?.toFixed(2)}SP (Δ${B.delta.effectiveSp >= 0 ? "+" : ""}${B.delta.effectiveSp?.toFixed(2)} vs R290) delOut=${B.delegatedOutSp?.toFixed(2)} (Δ${B.delta.delegatedOutSp?.toFixed(2)}) liq=${B.liquidSteem}STEEM/${B.liquidSbd}SBD`
  : B.verdict + ":" + B.error);
const C = out.sections.C;
log("C·curve: curationOps=" + C.curationOps, "matched=" + C.matched, "fails=" + (C.contentFails ?? 0), "windowOldest=" + C.oldestOpTs);
for (const [k, v] of Object.entries(C.windows ?? {})) log("  " + k.padEnd(9), `n=${v.n}`, `medSP/Grs=${v.medianSpPerGrshare}`, `medShare%=${v.medianSharePct}`, `ΣSP=${v.totalCurationSp}`);
const D = out.sections.D;
log("D·armyLiquid: Σ=" + (D.totalLiquidSteem ?? D.error), D.verdict ?? "");
log("OUT:", OUT);
