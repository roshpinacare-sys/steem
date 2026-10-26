/* ═══════════ T-73 PROBE 2 · THE REAL FLEET — WHO ARE THE SOLDIERS? ═══════════
 * Probe 1 falsified the roster assumption: hcsoldier1..3 are dead (0 activity,
 * 0 vests). The REAL fleet = headcorner's actual delegates (powerspan, siq,
 * tov, wic, wog, woq, ...). This probe:
 *   1. Full outgoing delegation list from headcorner (equal-spread check).
 *   2. For each delegatee: posts, comments, votes (10d), stake, VP.
 *   3. Same-moment clustering ACROSS the real fleet (post+vote bursts).
 *   4. Content repetition across accounts (titles + comment bodies).
 * Read-only. */
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
const DAY_MS = 86_400_000;
const now = Date.now();
const sameMinuteClusters = (tsArr) => {
  const m = new Map();
  for (const t of tsArr) { const k = Math.floor(t / 60_000); m.set(k, (m.get(k) ?? 0) + 1); }
  let clusters = 0, inCluster = 0, maxC = 0;
  for (const [, c] of m) if (c > 1) { clusters++; inCluster += c; maxC = Math.max(maxC, c); }
  return { clusters, inCluster, total: tsArr.length, maxCluster: maxC };
};
const gaps = (tsArr) => {
  const s = [...tsArr].sort((a, b) => a - b);
  const out = [];
  for (let i = 1; i < s.length; i++) out.push(s[i] - s[i - 1]);
  return out;
};
const stats = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return { n: s.length, min: s[0], p50: s[Math.floor(s.length / 2)] }; };
const minFmt = (ms) => (ms == null ? "n/a" : `${(ms / 60_000).toFixed(1)}m`);

const delegations = await rpc("condenser_api.get_vesting_delegations", ["headcorner", "outgoing", 100]);
const delegates = delegations.map((d) => ({ to: d.delegatee, vests: num(d.vesting_shares), at: d.min_delegation_time }));
const vestSum = delegates.reduce((s, d) => s + d.vests, 0);
console.log(`DELEGATIONS from headcorner: n=${delegates.length} sum=${(vestSum / 1e6).toFixed(2)}M VESTS`);
const amounts = new Set(delegates.map((d) => d.vests));
console.log(`  distinct amounts: ${amounts.size} → ${[...amounts].sort((a, b) => b - a).slice(0, 6).map((x) => x.toFixed(0)).join(", ")}`);
console.log(`  delegatees: ${delegates.map((d) => d.to).join(", ")}`);

const FLEET = delegates.map((d) => d.to);
const fleetReport = { at: new Date().toISOString(), fleet: FLEET, delegationSpread: { distinctAmounts: amounts.size, vestSum, equal: amounts.size <= 2 } };

async function activityOf(acc) {
  const [accRow, posts, comments, votes] = await Promise.all([
    rpc("condenser_api.get_accounts", [[acc]]).then((a) => a?.[0]).catch(() => null),
    rpc("condenser_api.get_discussions_by_author_before_date", [acc, "", new Date(now).toISOString().replace(/\.\d+Z$/, ""), 10]).catch(() => []),
    rpc("condenser_api.get_discussions_by_comments", [{ start_author: acc, limit: 20 }]).catch(() => []),
    rpc("account_history_api.get_account_history", { account: acc, start: -1, limit: 5000, select_ops: ["vote", "comment"] }).catch(() => ({ history: [] })),
  ]);
  const cutoff = now - 10 * DAY_MS;
  const voteRows = [];
  const commentOps = [];
  for (const [i, e] of votes?.history ?? []) {
    const op = Array.isArray(e.op) ? { type: e.op[0], value: e.op[1] } : { type: e.op.type, value: e.op.value };
    const ts = Date.parse(`${e.timestamp}Z`);
    if (ts < cutoff) continue;
    if (op.type === "vote" && op.value.voter === acc) voteRows.push({ ts, author: op.value.author, weight: op.value.weight });
    if (op.type === "comment" && op.value.author === acc && (op.value.parent_author ?? "") !== "") commentOps.push({ ts, parent: op.value.parent_author });
  }
  return {
    stake: accRow ? { vests: num(accRow.vesting_shares), received: num(accRow.received_vesting_shares), vp: (((accRow.voting_power ?? 0) / 100)).toFixed(1), rc: num(accRow.rc_current_mana) } : null,
    posts: posts.filter((p) => p.author === acc).map((p) => ({ title: p.title, created: Date.parse(`${p.created}Z`), bodyLen: p.body.length, votes: (p.active_votes ?? []).length, voters: (p.active_votes ?? []).map((v) => v.voter), body: p.body.slice(0, 160) })),
    comments: comments.filter((c) => c.author === acc).map((c) => ({ parent: c.parent_author, created: Date.parse(`${c.created}Z`), body: c.body.slice(0, 150), bodyLen: c.body.length })),
    votes: voteRows, commentOps,
  };
}

for (const acc of FLEET) {
  const a = await activityOf(acc);
  fleetReport[acc] = a;
  const vT = a.votes.map((v) => v.ts);
  const cT = a.comments.map((c) => c.created);
  const pT = a.posts.map((p) => p.created);
  const fleetSelfVotes = a.votes.filter((v) => FLEET.includes(v.author) || v.author === "headcorner").length;
  console.log(`\n■ ${acc}: vests=${(a.stake?.vests ?? 0).toFixed(0)} vp=${a.stake?.vp}% | posts10d=${pT.length} comments20=${cT.length} votes10d=${vT.length} (fleetSelfVotes=${fleetSelfVotes})`);
  console.log(`  gaps: posts p50=${minFmt(stats(gaps(pT))?.p50)} comments p50=${minFmt(stats(gaps(cT))?.p50)} votes p50=${minFmt(stats(gaps(vT))?.p50)} voteBurst=${JSON.stringify(sameMinuteClusters(vT))}`);
  for (const p of a.posts.slice(0, 3)) console.log(`  POST ${new Date(p.created).toISOString().slice(5, 16)} «${p.title}» len=${p.bodyLen} votes=${p.votes}`);
  for (const c of a.comments.slice(0, 2)) console.log(`  CMT → ${c.parent}: «${c.body.replace(/\n/g, " ").slice(0, 100)}»`);
  for (const v of a.votes.slice(0, 6)) console.log(`  VOTE ${new Date(v.ts).toISOString().slice(5, 16)} ${(v.weight / 100).toFixed(0)}% → ${v.author}`);
}

/* Cross-fleet same-moment vote clusters (THE robotic fingerprint) */
const allVotes = FLEET.flatMap((a) => (fleetReport[a]?.votes ?? []).map((v) => ({ acc: a, ...v })));
fleetReport.crossFleetVoteBursts = sameMinuteClusters(allVotes.map((v) => v.ts));
const allPosts = FLEET.flatMap((a) => (fleetReport[a]?.posts ?? []).map((p) => ({ acc: a, ...p })));
fleetReport.crossFleetPostBursts = sameMinuteClusters(allPosts.map((p) => p.created));

/* Same-target voting: how often do ≥3 fleet members vote the SAME post in the same hour */
const targetMap = new Map();
for (const v of allVotes) {
  const k = `${v.author}/${String(v.permlink).slice(0, 40)}|${Math.floor(v.ts / 3_600_000)}`;
  if (!targetMap.has(k)) targetMap.set(k, new Set());
  targetMap.get(k).add(v.acc);
}
let swarmTargets = 0;
const swarmRows = [];
for (const [k, voters] of targetMap) if (voters.size >= 3) { swarmTargets++; swarmRows.push({ target: k.split("|")[0], voters: [...voters] }); }
fleetReport.swarmVoting = { targetsWith3PlusFleetVotersSameHour: swarmTargets, examples: swarmRows.slice(0, 8) };

/* Title/body repetition across fleet */
const tCount = new Map();
for (const p of allPosts) if (p.title) tCount.set(p.title, (tCount.get(p.title) ?? 0) + 1);
fleetReport.repeatedTitles = [...tCount.entries()].filter(([, c]) => c > 1).map(([t, c]) => ({ t, c }));
const bPrefix = new Map();
for (const p of allPosts) { const k = (p.title ?? "") + "|" + String(p.body ?? "").slice(0, 60); bPrefix.set(k, (bPrefix.get(k) ?? 0) + 1); }
fleetReport.repeatedPostPrefixes = [...bPrefix.entries()].filter(([, c]) => c > 1).map(([t, c]) => ({ t: t.slice(0, 90), c }));

/* Who votes our own posts vs external */
const ourPosts = new Set(["headcorner", ...FLEET]);
let fleetVoteTotal = allVotes.length, fleetVoteOnFleet = allVotes.filter((v) => ourPosts.has(v.author)).length;
fleetReport.circularity = { fleetVoteTotal, fleetVoteOnFleet, pct: fleetVoteTotal ? ((fleetVoteOnFleet / fleetVoteTotal) * 100).toFixed(1) : "0.0" };

console.log("\n═══ HEADLINES ═══");
console.log("cross-fleet VOTE bursts:", JSON.stringify(fleetReport.crossFleetVoteBursts));
console.log("cross-fleet POST bursts:", JSON.stringify(fleetReport.crossFleetPostBursts));
console.log("swarm voting (≥3 fleet voters same post same hour):", JSON.stringify(fleetReport.swarmVoting, null, 1).slice(0, 1500));
console.log("repeated titles:", JSON.stringify(fleetReport.repeatedTitles).slice(0, 800));
console.log("repeated post prefixes:", JSON.stringify(fleetReport.repeatedPostPrefixes, null, 1).slice(0, 900));
console.log("circularity:", JSON.stringify(fleetReport.circularity));
await Bun.write(new URL("./result2.json", import.meta.url), JSON.stringify(fleetReport, null, 1));
console.log("\n→ evidence/t73/result2.json written");
