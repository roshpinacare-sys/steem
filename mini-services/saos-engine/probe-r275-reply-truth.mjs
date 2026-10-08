/* R275 · CHAIN TRUTH PROBE v2 — both chains, similarity clusters, not just
 * byte equality. The user demands the truth about identical replies. R274
 * measured exact-normalized-equality only; the Oct 8 "prefix swap" disease
 * (same body, swapped opener) passes that net. This probe measures pairwise
 * Jaccard 3-gram similarity with the SAME law the engine enforces (>= 0.34)
 * and separates pre-fix traffic (before 14:25Z) from post-fix traffic. */
import { execSync } from "node:child_process";

const STEEM_NODES = ["https://api.justyy.com", "https://api.steemit.com", "https://api.stem.fans", "https://steemapi.boylikegirl.club"];
const HIVE_NODES = ["https://api.hive.blog", "https://api.deathwing.me"];
const STEEM_ACCOUNTS = ["headcorner", "cashmachine", "haran", "israelnews", "lsa", "macrame", "siq", "tov", "wic", "wog", "woq", "hcsoldier4", "hcsoldier5", "hcsoldier6"];
const HIVE_ACCOUNTS = ["cashmachine", "haran", "israelnews", "lsa", "macrame", "siq", "wic", "wog", "woq"];
const FIX_AT = Date.parse("2026-10-08T14:25:51Z"); // clone guard commit e2e4061c
const SINCE = Date.parse("2026-10-07T12:00:00Z");  // last 24h+ window

async function rpc(nodes, method, params) {
  for (const node of nodes) {
    try {
      const res = await fetch(node, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
        signal: AbortSignal.timeout(8000),
      });
      const j = await res.json();
      if (j?.result !== undefined && j?.result !== null) return { ok: true, result: j.result };
    } catch { /* next node */ }
  }
  return { ok: false };
}

async function recentComments(account, nodes, want = 30) {
  const comments = [];
  /* page 0 IS (-1, 100) — the newest 100 ops directly. NOTE the node quirk:
   * (-1, 1) returns the SECOND-newest op, not the head (measured live:
   * it printed idx 4400 while the true head was 4401). Relying on (-1,1)
   * for the head silently skips the newest broadcast. */
  const head = await rpc(nodes, "condenser_api.get_account_history", [account, -1, 100]);
  if (!head.ok) return { ok: false, reason: "head-unreachable" };
  const rows = head.result ?? [];
  const lastIdx = rows.length ? rows[rows.length - 1][0] : 0;
  const pages = [rows];
  /* one older page for depth, then stop (want caps anyway) */
  if (lastIdx > 100) {
    const older = await rpc(nodes, "condenser_api.get_account_history", [account, lastIdx - 100, 100]);
    if (older.ok) pages.push(older.result ?? []);
  }
  for (const page of pages) {
    for (const [idx, op] of page) {
      const kind = op?.op?.[0];
      if (kind !== "comment") continue;
      const d = op.op[1];
      if (!d.parent_author) continue;
      const ts = Date.parse(op.timestamp + "Z");
      if (ts < SINCE) continue;
      comments.push({ at: op.timestamp + "Z", ts, parent: `${d.parent_author}/${d.parent_permlink}`, author: d.author, permlink: d.permlink, body: String(d.body ?? "") });
    }
  }
  /* get_account_history returns ops INVOLVING the account — a comment by
   * anyone under our post shows up in our history too. Dedupe by permlink. */
  const seen = new Set();
  const uniq = comments.filter((c) => (seen.has(c.permlink) ? false : (seen.add(c.permlink), true)));
  return { ok: true, comments: uniq.slice(0, want) };
}

const norm = (b) => String(b ?? "").replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/https?:\/\/\S+/g, "").replace(/[#*_>~`|]/g, "").replace(/\s+/g, " ").trim().toLowerCase().slice(0, 300);
const words = (s) => String(s).split(/[^a-z0-9]+/).filter(Boolean);
const ngrams = (s, n = 3) => { const w = words(s); const out = new Set(); for (let i = 0; i + n <= w.length; i++) out.add(w.slice(i, i + n).join(" ")); if (!out.size && w.length) out.add(w.join(" ")); return out; };
const sim = (a, b) => { const A = ngrams(a), B = ngrams(b); if (!A.size || !B.size) return 0; let inter = 0; for (const g of A) if (B.has(g)) inter++; return inter / Math.min(A.size, B.size); };

async function chainScope(name, accounts, nodes) {
  const all = [];
  const rs = await Promise.all(accounts.map((acc) => recentComments(acc, nodes)));
  accounts.forEach((acc, i) => {
    const r = rs[i];
    if (!r.ok) { console.error(`  ${name}/${acc}: ERR ${r.reason}`); return; }
    console.error(`  ${name}/${acc}: ${r.comments.length} replies`);
    for (const c of r.comments) all.push({ chain: name, ...c, n: norm(c.body) });
  });
  return all;
}

console.error("STEEM sweep... running in parallel with HIVE sweep");
const steemP = chainScope("steem", STEEM_ACCOUNTS, STEEM_NODES.concat(HIVE_NODES));
const hiveP = chainScope("hive", HIVE_ACCOUNTS, HIVE_NODES.concat(STEEM_NODES));
const [steem, hive] = await Promise.all([steemP, hiveP]);

const all = [...steem, ...hive];
/* global permlink dedupe — involvement history returns the same comment in
 * several accounts' pages; without this the probe counts its own echo */
const seenPl = new Set();
const uniqAll = all.filter((r) => (seenPl.has(r.permlink) ? false : (seenPl.add(r.permlink), true)));
console.error(`\ntotal replies measured since ${new Date(SINCE).toISOString()}: ${all.length} raw, ${uniqAll.length} unique`);

/* pairwise similarity clusters (same chain + same parent only — that is
 * where "all replies to the post are the same reply" lives) */
const byParent = {};
for (const r of uniqAll) (byParent[`${r.chain}|${r.parent}`] = byParent[`${r.chain}|${r.parent}`] ?? []).push(r);
const clusters = [];
for (const [parent, group] of Object.entries(byParent)) {
  for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) {
    if (group[i].permlink === group[j].permlink) continue; /* same op twice */
    const s = sim(group[i].n, group[j].n);
    if (s >= 0.34) clusters.push({ parent, s: Math.round(s * 100) / 100, a: group[i], b: group[j] });
  }
}
clusters.sort((x, y) => y.s - x.s);
const postFix = clusters.filter((c) => c.a.ts >= FIX_AT && c.b.ts >= FIX_AT);
const mixedOrPre = clusters.filter((c) => !(c.a.ts >= FIX_AT && c.b.ts >= FIX_AT));
console.error(`similarity clusters >= 0.34 under same parent: ${clusters.length}`);
console.error(`  post-fix (both sides after 14:25Z): ${postFix.length}`);
console.error(`  pre-fix or mixed: ${mixedOrPre.length}`);
for (const c of clusters.slice(0, 12)) {
  console.error(`  sim=${c.s} [${c.a.chain}] ${c.parent}`);
  console.error(`    ${c.a.author}@${c.a.at} :: "${c.a.n.slice(0, 80)}"`);
  console.error(`    ${c.b.author}@${c.b.at} :: "${c.b.n.slice(0, 80)}"`);
}

/* exact-dup groups (the disease the user sees with their eyes) */
const byN = {};
for (const r of uniqAll) (byN[`${r.chain}|${r.n}`] = byN[`${r.chain}|${r.n}`] ?? []).push(`${r.author}@${r.at}`);
const exact = Object.entries(byN).filter(([, v]) => v.length > 1);
console.error(`\nexact duplicate groups: ${exact.length}`);
for (const [n, who] of exact.slice(0, 8)) { console.error(`  x${who.length} "${n.split("|")[1].slice(0, 70)}" -> ${who.slice(0, 10).join(" | ")}`); }

/* per-account distinct share */
console.error(`\nper-account distinct/total:`);
for (const [chain, list] of [["steem", steem], ["hive", hive]]) {
  const seen2 = new Set();
  const ulist = list.filter((x) => (seen2.has(x.permlink) ? false : (seen2.add(x.permlink), true)));
  for (const acc of accountsOf(ulist)) {
    const ns = ulist.filter((x) => x.author === acc).map((x) => x.n);
    if (!ns.length) continue;
    console.error(`  ${chain}/${acc}: ${new Set(ns).size}/${ns.length}`);
  }
}
function accountsOf(list) { return [...new Set(list.map((x) => x.author))]; }

/* post-fix broadcast count — is the fleet actually talking after the guard? */
const postFixBroadcasts = uniqAll.filter((r) => r.ts >= FIX_AT);
console.error(`\npost-fix broadcasts (both chains): ${postFixBroadcasts.length}`);
for (const r of postFixBroadcasts.slice(0, 15)) console.error(`  ${r.chain}/${r.author}@${r.at} -> ${r.parent}`);

import { writeFileSync, mkdirSync } from "node:fs";
mkdirSync("/tmp/r275", { recursive: true });
writeFileSync("/tmp/r275/reply-truth.json", JSON.stringify({ items: uniqAll.map((r) => ({ ...r, body: r.body.slice(0, 500) })), clusters, exact }, null, 1));
console.error("\nsaved: /tmp/r275/reply-truth.json");
