/* R274 · CHAIN TRUTH PROBE — what replies did the fleet ACTUALLY broadcast?
 * The user says all replies to posts are the same reply. The exec-log
 * "fingerprint" is fingerprint(wif) — the signing KEY, not the content
 * (signer.mjs:96). So the log cannot answer this. Only the chain can.
 * This probe fetches every recent comment by the roster accounts directly
 * from Steem nodes and measures real body duplication — byte-level. */
import { execSync } from "node:child_process";

const NODES = ["https://api.justyy.com", "https://api.steemit.com", "https://api.stem.fans"];
const ACCOUNTS = ["headcorner", "cashmachine", "haran", "israelnews", "lsa", "macrame", "siq", "tov", "wic", "wog", "woq", "hcsoldier4", "hcsoldier5", "hcsoldier6"];

async function rpc(method, params) {
  for (const node of NODES) {
    try {
      const res = await fetch(node, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
        signal: AbortSignal.timeout(12000),
      });
      const j = await res.json();
      if (j?.result !== undefined && j?.result !== null) return { ok: true, result: j.result, node };
    } catch { /* next node */ }
  }
  return { ok: false };
}

/* fetch recent replies. justyy caps get_account_history at 100 per call →
 * page backward in 100-op chunks until we have enough comments. */
async function recentComments(account, want = 40) {
  const comments = [];
  let lastIdx = -1;
  const head = await rpc("condenser_api.get_account_history", [account, -1, 1]);
  if (!head.ok) return { ok: false, reason: "history-head-unreachable" };
  lastIdx = head.result?.[head.result.length - 1]?.[0] ?? 0;
  for (let step = 0; step < 10 && comments.length < want; step++) {
    const end = lastIdx - step * 100;
    const start = Math.max(0, end - 99);
    const hist = await rpc("condenser_api.get_account_history", [account, start, Math.min(100, end - start + 1)]);
    if (!hist.ok) return { ok: false, reason: `history-page-${step}` };
    for (const [, op] of hist.result ?? []) {
      const kind = op?.op?.[0];
      if (kind !== "comment") continue;
      const d = op.op[1];
      if (!d.parent_author) continue; // top-level post, not a reply
      comments.push({
        at: op.timestamp,
        parent: `${d.parent_author}/${d.parent_permlink}`,
        author: d.author,
        permlink: d.permlink,
        body: String(d.body ?? ""),
      });
    }
    if (start === 0) break;
  }
  return { ok: true, comments: comments.slice(0, want) };
}

const out = {};
for (const acc of ACCOUNTS) {
  const r = await recentComments(acc);
  out[acc] = r.ok ? r.comments : { error: r.reason };
  console.error(`${acc}: ${r.ok ? r.comments.length + " replies" : "ERR " + r.reason}`);
}

/* cross-account + within-account duplication measure on normalized bodies */
const norm = (b) => String(b).replace(/!\[.*?\]\(.*?\)/g, "").replace(/https?:\/\/\S+/g, "").replace(/[#*_>~`|]/g, "").replace(/\s+/g, " ").trim().toLowerCase().slice(0, 300);
const all = [];
for (const [acc, cs] of Object.entries(out)) {
  if (!Array.isArray(cs)) continue;
  for (const c of cs) all.push({ acc, at: c.at, parent: c.parent, n: norm(c.body), raw: c.body.slice(0, 120) });
}
console.error(`\ntotal replies measured: ${all.length}`);
const byN = {};
for (const r of all) (byN[r.n] = byN[r.n] ?? []).push(`${r.acc}@${r.at}`);
const dupGroups = Object.entries(byN).filter(([, v]) => v.length > 1).sort((a, b) => b[1].length - a[1].length);
console.error(`distinct normalized bodies: ${Object.keys(byN).length}`);
console.error(`groups with duplicates: ${dupGroups.length}`);
console.error(`\nTOP DUPLICATE GROUPS (same normalized body, multiple times/accounts):`);
for (const [n, who] of dupGroups.slice(0, 8)) {
  console.error(`  x${who.length} :: "${n.slice(0, 90)}"`);
  console.error(`    -> ${who.slice(0, 12).join(" | ")}`);
}
/* per account: distinct share */
console.error(`\nPER-ACCOUNT distinct/total:`);
for (const [acc, cs] of Object.entries(out)) {
  if (!Array.isArray(cs)) continue;
  const ns = cs.map((c) => norm(c.body));
  const distinct = new Set(ns).size;
  console.error(`  ${acc}: ${distinct}/${cs.length} distinct`);
}
execSync(`mkdir -p /tmp/r274 && cat > /tmp/r274/reply-truth.json << 'JSONEOF'\n${JSON.stringify(out, null, 1)}\nJSONEOF`, { stdio: "ignore" });
console.error("\nsaved: /tmp/r274/reply-truth.json");
