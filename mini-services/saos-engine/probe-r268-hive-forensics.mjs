#!/usr/bin/env bun
/**
 * probe-r268-hive-forensics.mjs — R268, READ-ONLY, ZERO KEYS.
 *
 * The operator asked (R268): "Hive was connected 4 days ago — how? I never
 * connected myself." This probe measures the on-chain truth for every fleet
 * body on Hive (+ headcorner & tov for the rotation picture):
 *   - authority fingerprints (first 12 chars of the live pubs — public data)
 *   - last_post / last_vote / created
 *   - last op ever + every on-chain op since 2026-09-25 (type/ts/fragment)
 * Verdict: state/r268-hive-forensics.json. Nothing secret is printed —
 * public-key prefixes only, per the fingerprints-only doctrine.
 */
import { rpcHive, HIVE_ROSTER } from "./hive.mjs";
import fs from "node:fs";

const ACCOUNTS = [...HIVE_ROSTER, "headcorner", "tov"];
const SINCE = "2026-09-25T00:00:00";
const fp = (k) => (typeof k === "string" && k.length > 12 ? k.slice(0, 12) : null);

const out = {
  at: new Date().toISOString(),
  probe: "r268-hive-forensics",
  law: "read-only condenser_api · zero keys · fingerprints-only",
  accounts: {},
};

const acc = await rpcHive("condenser_api.get_accounts", [ACCOUNTS]);
if (!acc.ok) { console.error("all-hive-nodes-failed"); process.exit(1); }
for (const a of acc.result) {
  out.accounts[a.name] = {
    created: a.created,
    last_post: a.last_post ?? null,
    last_vote: a.last_vote ?? null,
    posting_fp: fp(a.posting?.key_auths?.[0]?.[0]),
    active_fp: fp(a.active?.key_auths?.[0]?.[0]),
    owner_fp: fp(a.owner?.key_auths?.[0]?.[0]),
    ops_since: [],
    op_count_since: 0,
    last_op_ever: null,
    history_error: null,
  };
}

for (const name of ACCOUNTS) {
  const rec = out.accounts[name];
  if (!rec) continue;
  const h = await rpcHive("condenser_api.get_account_history", [name, -1, 1000, []]);
  if (!h.ok) { rec.history_error = h.error ?? "failed"; continue; }
  const rows = h.result ?? [];
  let last = null;
  const since = [];
  for (const [, tr] of rows) {
    const t = tr?.timestamp;
    const [type, val = {}] = tr?.op ?? [];
    if (!t || !type) continue;
    if (!last || t > last.ts) last = { ts: t, type };
    if (t >= SINCE) {
      const who = val.author ?? val.voter ?? val.from ?? val.delegator ?? val.account ?? val.consumer ?? null;
      since.push({
        ts: t, type,
        who: who ?? undefined,
        permlink: typeof val.permlink === "string" ? val.permlink.slice(0, 70) : undefined,
        weight: val.weight ?? undefined,
      });
    }
  }
  rec.last_op_ever = last;
  rec.ops_since = since;
  rec.op_count_since = since.length;
}

fs.mkdirSync("./state", { recursive: true });
fs.writeFileSync("./state/r268-hive-forensics.json", JSON.stringify(out, null, 2));

for (const name of ACCOUNTS) {
  const a = out.accounts[name];
  if (!a) continue;
  const days = {};
  for (const o of a.ops_since) { const d = o.ts.slice(0, 10); days[d] = (days[d] ?? 0) + 1; }
  console.log(
    `${name}: last_op_ever=${a.last_op_ever?.ts ?? "?"}(${a.last_op_ever?.type ?? "?"})` +
    ` last_post=${a.last_post ?? "?"} last_vote=${a.last_vote ?? "?"}` +
    ` ops_since_0925=${a.op_count_since} byDay=${JSON.stringify(days)}` +
    ` auth(post/act/own)=${a.posting_fp ?? "?"}/${a.active_fp ?? "?"}/${a.owner_fp ?? "?"}`
  );
}
console.log("WROTE state/r268-hive-forensics.json");
