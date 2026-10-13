#!/usr/bin/env bun
/**
 * probe-r268-hive-posts.mjs — R268, READ-ONLY, ZERO KEYS. Follow-up forensics.
 *
 * Question: who/what touched Hive on ~2026-10-02 15:24-25 UTC from five roster
 * bodies (cashmachine/haran/israelnews/siq/woq show last_post at that minute,
 * BEFORE the R254 organ was born on 10-07)? And did lsa's R254 probe-vote land?
 *
 * Measures:
 *  1. each account's last blog posts (get_discussions_by_author_before_date)
 *  2. oflyhigh/6p3ust active_votes → is lsa recorded on-chain?
 *  3. account_history via forensic-only fallback nodes (read-only; NOT engine nodes)
 * Verdict: state/r268-hive-posts.json. Fingerprints/bodies only, zero secrets.
 */
import { rpcHive, HIVE_ROSTER } from "./hive.mjs";
import fs from "node:fs";

const ACCOUNTS = [...HIVE_ROSTER, "headcorner", "tov"];
const FORENSIC_NODES = ["https://anyx.io", "https://rpc.ecency.com", "https://api.hive.blog"];

async function rpcAny(node, method, params, timeoutMs = 15000) {
  try {
    const r = await fetch(node, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!r.ok) return { ok: false, error: `http-${r.status}` };
    const d = await r.json();
    if (d.error) return { ok: false, error: String(d.error?.message ?? d.error).slice(0, 120) };
    return { ok: true, result: d.result };
  } catch (e) { return { ok: false, error: String(e?.message ?? e).slice(0, 120) }; }
}

const out = {
  at: new Date().toISOString(),
  probe: "r268-hive-posts",
  law: "read-only · zero keys · forensic fallback nodes documented as probe-only",
  blog: {}, lsaVote: null, history: {},
};

for (const name of ACCOUNTS) {
  const g = await rpcHive("condenser_api.get_discussions_by_author_before_date",
    [name, "", "2100-01-01T00:00:00", 10]);
  out.blog[name] = g.ok ? (g.result ?? []).map(p => ({
    created: p.created, permlink: p.permlink, title: (p.title ?? "").slice(0, 60),
    bodyHead: (p.body ?? "").slice(0, 110).replace(/\s+/g, " "),
    tags: (() => { try { const m = JSON.parse(p.json_metadata ?? "{}"); return m.tags ?? []; } catch { return []; } })(),
  })) : { error: g.error ?? "failed" };
}

const v = await rpcHive("condenser_api.get_content", ["oflyhigh", "6p3ust"]);
if (v.ok) {
  const votes = v.result?.active_votes ?? [];
  const ours = votes.filter(x => [...ACCOUNTS].includes(x.voter));
  out.lsaVote = { totalVotes: votes.length, ours };
}

for (const name of ["cashmachine", "lsa", "headcorner"]) {
  out.history[name] = { tries: [] };
  for (const node of FORENSIC_NODES) {
    const h = await rpcAny(node, "condenser_api.get_account_history", [name, -1, 300, []]);
    const tries = { node, ok: h.ok, error: h.error ?? null, rows: 0, ops: [] };
    if (h.ok) {
      const rows = h.result ?? [];
      tries.rows = rows.length;
      for (const [, tr] of rows.slice(-40)) {
        const [type, val = {}] = tr?.op ?? [];
        tries.ops.push({ ts: tr?.timestamp, type, who: val.author ?? val.voter ?? val.from ?? val.delegator ?? val.account ?? undefined, permlink: typeof val.permlink === "string" ? val.permlink.slice(0, 60) : undefined });
      }
      out.history[name].tries.push(tries);
      break; // first node that answers is enough
    }
    out.history[name].tries.push(tries);
  }
}

fs.mkdirSync("./state", { recursive: true });
fs.writeFileSync("./state/r268-hive-posts.json", JSON.stringify(out, null, 2));

for (const name of ACCOUNTS) {
  const b = out.blog[name];
  const list = Array.isArray(b) ? b.slice(0, 3) : [];
  console.log(`\n== ${name} (${Array.isArray(b) ? b.length : "ERR"} posts) ==`);
  for (const p of list) console.log(`  ${p.created} | ${p.permlink.slice(0, 50)} | ${p.title}`);
}
console.log("\nlsaVote:", JSON.stringify(out.lsaVote));
for (const [n, h] of Object.entries(out.history)) {
  const t = h.tries?.find(x => x.ok);
  console.log(`history ${n}: ${t ? `${t.rows} rows via ${t.node}, last ops:` : "all-nodes-failed"}`);
  if (t) for (const o of t.ops.slice(-8)) console.log(`   ${o.ts} ${o.type} ${o.who ?? ""} ${o.permlink ?? ""}`);
}
console.log("\nWROTE state/r268-hive-posts.json");
