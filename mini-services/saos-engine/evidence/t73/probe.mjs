/* ═══════════ T-73 PROBE · THE HUMANITY AUDIT — MEASURE THE ROBOT ═══════════
 * Operator verdict (trace 1a105453cdc437b1): the fleet's social activity
 * (posts/comments/votes) is robotic — AI-detectable titles, broken posts,
 * repetitive posts/comments, EVERYTHING at the same moment, delegation power
 * not spread equally, zero community. This probe measures the truth on-chain
 * for the whole roster (headcorner + hcsoldier1..3):
 *   A. POSTS — last 20 per account: title/body/tags, burst gaps, repetition,
 *      "broken" markers (empty body, one-line body, metadata sanity).
 *   B. COMMENTS — last 30 per account: body repetition (exact + prefix-hash),
 *      self-only conversation share, burst gaps.
 *   C. VOTES — last 10 days of vote ops per account: same-minute cluster
 *      detection, self-vote share, fleet-only vote share (circular activity).
 *   D. DELEGATION — outgoing from headcorner + incoming per soldier:
 *      is SP spread equally across the fleet? (vesting_shares too)
 *   E. NETWORK — per-post active_votes: how many voters are OUR accounts
 *      (the "we only work with ourselves" measurement).
 * Read-only. Zero state writes. Zero keys. */
import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");

const EP = ["https://steemapi.boylikegirl.club", "https://api.justyy.com", "https://api.steemit.com"];
async function rpc(method, params, timeoutMs = 15_000) {
  let lastErr = null;
  for (const base of EP) {
    try {
      const r = await fetch(base, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(timeoutMs) });
      if (!r.ok) throw new Error(`http-${r.status}`);
      const j = await r.json();
      if (j?.error) throw new Error(String(j.error.message).slice(0, 140));
      return j.result;
    } catch (e) { lastErr = e; }
  }
  throw lastErr ?? new Error("steem-endpoints-exhausted");
}
const num = (s) => Number(String(s ?? "").split(" ")[0]) || 0;
const ROSTER = ["headcorner", "hcsoldier1", "hcsoldier2", "hcsoldier3"];
const DAY_MS = 86_400_000;
const now = Date.now();

const gaps = (tsArr) => {
  const s = [...tsArr].sort((a, b) => a - b);
  const out = [];
  for (let i = 1; i < s.length; i++) out.push(s[i] - s[i - 1]);
  return out;
};
const stats = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return { n: s.length, min: s[0], p50: s[Math.floor(s.length / 2)], max: s[s.length - 1] }; };
const minFmt = (ms) => (ms == null ? "n/a" : `${(ms / 60_000).toFixed(1)}m`);
const sameMinuteClusters = (tsArr) => {
  const m = new Map();
  for (const t of tsArr) { const k = Math.floor(t / 60_000); m.set(k, (m.get(k) ?? 0) + 1); }
  let clusters = 0, inCluster = 0;
  for (const [k, c] of m) if (c > 1) { clusters++; inCluster += c; }
  return { clusters, inCluster, total: tsArr.length };
};

/* A. POSTS per account */
async function postsOf(acc) {
  try {
    const rows = await rpc("condenser_api.get_discussions_by_author_before_date", [acc, "", new Date(now).toISOString().replace(/\.\d+Z$/, ""), 20]);
    return rows.map((p) => ({
      permlink: p.permlink, title: p.title ?? "", created: Date.parse(`${p.created}Z`),
      bodyLen: (p.body ?? "").length, body: (p.body ?? "").slice(0, 220),
      tags: (() => { try { const j = JSON.parse(p.json_metadata ?? "{}"); return Array.isArray(j.tags) ? j.tags : []; } catch { return "META-BROKEN"; } })(),
      votes: (p.active_votes ?? []).length,
      voters: (p.active_votes ?? []).map((v) => v.voter),
      pending: num(p.pending_payout_value),
    }));
  } catch (e) { return [{ error: String(e).slice(0, 120) }]; }
}

/* B. COMMENTS per account */
async function commentsOf(acc) {
  try {
    const rows = await rpc("condenser_api.get_discussions_by_comments", [{ start_author: acc, limit: 30 }]);
    return rows.filter((c) => c.author === acc).map((c) => ({
      permlink: c.permlink, parent: c.parent_author ?? "", created: Date.parse(`${c.created}Z`),
      bodyLen: (c.body ?? "").length, body: (c.body ?? "").slice(0, 200),
    }));
  } catch (e) { return [{ error: String(e).slice(0, 120) }]; }
}

/* C. VOTES per account (10 days) */
async function votesOf(acc) {
  try {
    const r = await rpc("account_history_api.get_account_history", { account: acc, start: -1, limit: 10000, select_ops: ["vote"] });
    const cutoff = now - 10 * DAY_MS;
    const out = [];
    for (const [i, e] of r?.history ?? []) {
      const v = (Array.isArray(e.op) ? e.op[1] : e.op.value) ?? {};
      if (v.voter !== acc) continue;
      const ts = Date.parse(`${e.timestamp}Z`);
      if (ts < cutoff) continue;
      out.push({ ts, author: v.author, permlink: v.permlink, weight: v.weight, pct: (v.weight / 100).toFixed(1) + "%" });
    }
    return out;
  } catch (e) { return [{ error: String(e).slice(0, 120) }]; }
}

/* D. DELEGATION + stake */
async function stakeOf(acc) {
  const [accRow, outgoing] = await Promise.all([
    rpc("condenser_api.get_accounts", [[acc]]).then((a) => a?.[0]),
    rpc("condenser_api.get_vesting_delegations", [acc, "outgoing", 100]).catch(() => []),
  ]);
  const incoming = await Promise.all(ROSTER.map((from) =>
    rpc("condenser_api.get_vesting_delegations", [acc, from, 1]).then((rows) => rows.filter((d) => d.delegatee === acc && d.delegator === from)).catch(() => [])
  ));
  return { accRow, outgoing: outgoing.map((d) => ({ from: d.delegator, to: d.delegatee, vests: num(d.vesting_shares) })), incoming: incoming.flat().map((d) => ({ from: d.delegator, to: d.delegatee, vests: num(d.vesting_shares) })) };
}

const report = { at: new Date().toISOString(), roster: ROSTER, posts: {}, comments: {}, votes: {}, stake: {} };
for (const acc of ROSTER) {
  const [posts, comments, votes, stake] = await Promise.all([postsOf(acc), commentsOf(acc), votesOf(acc), stakeOf(acc)]);
  report.posts[acc] = posts; report.comments[acc] = comments; report.votes[acc] = votes; report.stake[acc] = {
    vests: stake.accRow ? num(stake.accRow.vesting_shares) : null, delegatedOut: stake.outgoing, delegatedIn: stake.incoming,
    receivedVesting: stake.accRow ? num(stake.accRow.received_vesting_shares) : null, rcManabar: stake.accRow ? num(stake.accRow.rc_current_mana) : null,
  };
  const pt = posts.filter((p) => !p.error).map((p) => p.created);
  const ct = comments.filter((c) => !c.error).map((c) => c.created);
  const vt = votes.filter((v) => !v.error).map((v) => v.ts);
  report.posts[acc + "_gaps"] = { postGaps: stats(gaps(pt)), burst: sameMinuteClusters(pt) };
  report.comments[acc + "_gaps"] = { commentGaps: stats(gaps(ct)), burst: sameMinuteClusters(ct) };
  report.votes[acc + "_gaps"] = { voteGaps: stats(gaps(vt)), burst: sameMinuteClusters(vt), n: vt.length };
  console.log(`\n■ ${acc}: posts=${posts.filter((p) => !p.error).length} comments=${comments.filter((c) => !c.error).length} votes10d=${votes.filter((v) => !v.error).length}`);
}

/* Cross-account simultaneous posting (the "everyone posts at the same moment" law) */
const allPostTs = ROSTER.flatMap((a) => (report.posts[a] ?? []).filter((p) => !p.error).map((p) => ({ acc: a, ts: p.created })));
report.crossAccountPostBursts = sameMinuteClusters(allPostTs.map((x) => x.ts));
const allVoteTs = ROSTER.flatMap((a) => (report.votes[a] ?? []).filter((v) => !v.error).map((v) => ({ acc: a, ...v })));
report.crossAccountVoteBursts = sameMinuteClusters(allVoteTs.map((x) => x.ts));

/* Title repetition analysis */
const titleCount = new Map();
for (const acc of ROSTER) for (const p of report.posts[acc] ?? []) if (!p.error && p.title) titleCount.set(p.title, (titleCount.get(p.title) ?? 0) + 1);
report.repeatedTitles = [...titleCount.entries()].filter(([, c]) => c > 1).map(([t, c]) => ({ title: t, count: c }));

/* Comment body repetition */
const cBodyCount = new Map();
for (const acc of ROSTER) for (const c of report.comments[acc] ?? []) if (!c.error && c.bodyLen > 0) cBodyCount.set(c.body.slice(0, 80), (cBodyCount.get(c.body.slice(0, 80)) ?? 0) + 1);
report.repeatedComments = [...cBodyCount.entries()].filter(([, c]) => c > 1).map(([b, c]) => ({ body: b, count: c }));

/* The em-dash AI tell the operator named (titles with "—") */
report.dashTitles = [];
for (const acc of ROSTER) for (const p of report.posts[acc] ?? []) if (!p.error && (p.title ?? "").includes("—")) report.dashTitles.push({ acc, title: p.title });

/* Network: how many voters are ours */
report.networkSelfShare = [];
for (const acc of ROSTER) {
  const ourSet = new Set(ROSTER);
  let rows = (report.posts[acc] ?? []).filter((p) => !p.error);
  let ourVotes = 0, totalVotes = 0;
  for (const p of rows) for (const v of p.voters ?? []) { totalVotes++; if (ourSet.has(v)) ourVotes++; }
  report.networkSelfShare.push({ acc, totalVotes, ourVotes, selfSharePct: totalVotes ? ((ourVotes / totalVotes) * 100).toFixed(1) : "0.0" });
}

console.log("\n═══ HEADLINE MEASUREMENTS ═══");
console.log("cross-account POST bursts (same-minute):", JSON.stringify(report.crossAccountPostBursts));
console.log("cross-account VOTE bursts (same-minute):", JSON.stringify(report.crossAccountVoteBursts));
console.log("repeated titles:", JSON.stringify(report.repeatedTitles, null, 1).slice(0, 2000));
console.log("repeated comments:", JSON.stringify(report.repeatedComments, null, 1).slice(0, 2000));
console.log("dash titles:", JSON.stringify(report.dashTitles, null, 1).slice(0, 1200));
console.log("self-share:", JSON.stringify(report.networkSelfShare));
for (const acc of ROSTER) {
  console.log(`\n${acc} gaps: posts=${minFmt(report.posts[acc + "_gaps"]?.postGaps?.p50)} (min ${minFmt(report.posts[acc + "_gaps"]?.postGaps?.min)}) burst=${JSON.stringify(report.posts[acc + "_gaps"]?.burst)} | comments p50=${minFmt(report.comments[acc + "_gaps"]?.commentGaps?.p50)} burst=${JSON.stringify(report.comments[acc + "_gaps"]?.burst)} | votes n=${report.votes[acc + "_gaps"]?.n} p50=${minFmt(report.votes[acc + "_gaps"]?.voteGaps?.p50)} burst=${JSON.stringify(report.votes[acc + "_gaps"]?.burst)}`);
  console.log(`${acc} stake: vests=${report.stake[acc].vests} delegatedIn=${JSON.stringify(report.stake[acc].delegatedIn)} delegatedOut=${JSON.stringify(report.stake[acc].delegatedOut).slice(0, 300)}`);
}
console.log("\nSAMPLE TITLES/BODIES (robotic evidence):");
for (const acc of ROSTER) {
  for (const p of (report.posts[acc] ?? []).filter((x) => !x.error).slice(0, 5)) {
    console.log(`  [${acc}] ${new Date(p.created).toISOString()} «${p.title}» bodyLen=${p.bodyLen} votes=${p.votes} tags=${JSON.stringify(p.tags)}`);
  }
}
console.log("\nSAMPLE COMMENTS:");
for (const acc of ROSTER) {
  for (const c of (report.comments[acc] ?? []).filter((x) => !x.error).slice(0, 5)) {
    console.log(`  [${acc}] → ${c.parent}: «${c.body.replace(/\n/g, " ").slice(0, 110)}» (${c.bodyLen}b)`);
  }
}
console.log("\nSAMPLE VOTES (headcorner last 10):");
for (const v of (report.votes.headcorner ?? []).filter((x) => !x.error).slice(0, 10)) console.log(`  ${new Date(v.ts).toISOString()} ${v.pct} → ${v.author}/${String(v.permlink).slice(0, 50)}`);
console.log("\nSAMPLE VOTES (soldiers last 10 each):");
for (const acc of ROSTER.slice(1)) { console.log(`  ${acc}:`); for (const v of (report.votes[acc] ?? []).filter((x) => !x.error).slice(0, 10)) console.log(`    ${new Date(v.ts).toISOString()} ${v.pct} → ${v.author}/${String(v.permlink).slice(0, 50)}`); }
console.log("\nBROKEN-POST MARKERS: bodyLen<300:", JSON.stringify(ROSTER.map((a) => ({ acc: a, broken: (report.posts[a] ?? []).filter((p) => !p.error && p.bodyLen < 300).length }))));
console.log("META-BROKEN posts:", JSON.stringify(ROSTER.map((a) => ({ acc: a, broken: (report.posts[a] ?? []).filter((p) => !p.error && p.tags === "META-BROKEN").length }))));
await Bun.write(new URL("./result.json", import.meta.url), JSON.stringify(report, null, 1));
console.log("\n→ evidence/t73/result.json written");
