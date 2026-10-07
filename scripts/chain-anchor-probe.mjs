#!/usr/bin/env node
/* CHAIN ANCHOR PROBE (R241) — independent git-sovereignty verifier.
 * Law: docs/SANDBOX-DISTRUST-LAW.md §4.3
 * Reads the latest `saos-git-custody-v1` custom_json by ACCOUNT from a PUBLIC
 * Steem node and verifies its `tip` is an ancestor of (or equal to) git HEAD.
 * Exit: 0 = anchored-ok | 1 = no-anchor-found | 2 = DRIFT (tip not in HEAD lineage) */
import { execSync } from "node:child_process";

const ACCOUNT = process.env.SAOS_ACCOUNT ?? "headcorner";
const NODE = process.env.SAOS_NODE ?? "https://api.steemit.com";
const ANCHOR_ID = "saos-git-custody-v1";
const WINDOW = 25000; // history ops scanned (latest-first, 100-per-page)

const rpc = (method, params) =>
  fetch(NODE, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
  }).then((r) => r.json());

const head = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();

let latest = null;
let scanned = 0;
/* paginate newest→older (public nodes cap ~100 rows/page) */
let start = -1;
const PAGE = 100; /* public nodes cap this RPC at 100 rows */
for (let page = 0; page < 250 && !latest && scanned < WINDOW; page++) {
  const hist = await rpc("condenser_api.get_account_history", [ACCOUNT, start, PAGE]);
  if (!hist?.result) break;
  const rows = hist.result; // ascending by index
  for (let i = rows.length - 1; i >= 0; i--) {
    const op = rows[i][1];
    const t = op?.op;
    if (t?.[0] === "custom_json" && t[1]?.id === ANCHOR_ID) {
      try {
        const j = JSON.parse(t[1].json);
        if (j.branch === "saos-cockpit" && j.tip) { latest = { ...j, block: op.block, at: j.at ?? null }; break; }
      } catch { /* skip malformed */ }
    }
  }
  scanned += rows.length;
  const minIdx = rows[0]?.[0];
  if (minIdx === undefined || minIdx <= 0) break;
  start = minIdx - 1;
}

if (!latest) { console.error(`NO-ANCHOR: no ${ANCHOR_ID} for ${ACCOUNT} in ${scanned} scanned ops`); process.exit(1); }

const ancestor = (() => {
  try { execSync(`git merge-base --is-ancestor ${latest.tip} HEAD`, { stdio: "pipe" }); return true; }
  catch { return false; }
})();

console.log(JSON.stringify({ head, anchor: { tip: latest.tip, block: latest.block, at: latest.at }, anchored: ancestor, drift: !ancestor }, null, 2));
process.exit(ancestor ? 0 : 2);
