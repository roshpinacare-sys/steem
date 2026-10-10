#!/usr/bin/env node
/* CHAIN ANCHOR PROBE (R241) — independent git-sovereignty verifier.
 * Law: docs/SANDBOX-DISTRUST-LAW.md §4.3
 * Reads the latest `saos-git-custody-v1` custom_json by ACCOUNT from a PUBLIC
 * Steem node and verifies its `tip` is an ancestor of (or equal to) git HEAD.
 * Exit: 0 = anchored-ok | 1 = no-anchor-found | 2 = DRIFT (tip not in HEAD lineage) */
import { execSync } from "node:child_process";

const ACCOUNT = process.env.SAOS_ACCOUNT ?? "headcorner";
/* R297 · NODE-DIVERSITY LAW: measured live 2026-10-09 18:02Z — a single
 * public endpoint (api.steemit.com load-balancer) answered the SAME
 * get_account_history with a stale page, then an error, minutes apart, while
 * the anchor tx was provably included (get_transaction block 110295906).
 * The probe now falls back across public nodes per page and times out per
 * request. Verdict law unchanged: only a tip that IS an ancestor of HEAD
 * passes; all-nodes-fail still exits 1 (no-anchor, fail-closed, honest).
 * R298 · FRESHNESS LAW (measured live 2026-10-09 21:09Z): a STALE-but-valid
 * history page is not an error, so the first-node answer silently hid a
 * freshly anchored tip (anchor-ok txid d03c70b0 block 110299692 was
 * chain-provable via get_transaction while get_account_history still served
 * the 19:49 page). The probe now scans EACH node, keeps the FRESHEST anchor
 * (by at/block), and only then ancestry-judges. A stale page can no longer
 * convict; only an all-nodes-agreed stale tip declares drift.
 * R300-c · STAMP-TXID LAW (measured live 2026-10-10 03:55Z: anchor-ok txid
 * cd7ea39d provably included at block 110307710 via get_transaction while
 * ALL THREE public nodes' history pages still served the 23:29 anchor —
 * the third recurrence of the stale-page lag). The local custody stamp
 * (state/custody-anchor.json) carries the txid of the last broadcast.
 * get_transaction is inclusion-provable immediately; the chain itself
 * supplies the op payload (branch+tip) — the stamp only supplies the
 * POINTER, never the verdict. Fail-closed unchanged: an unprovable/wrong
 * stamp is ignored, ancestry judgment stays exact. */
const NODES = (process.env.SAOS_NODE ?? "https://api.steemit.com,https://api.steem.house,https://steemapi.boylikegirl.club")
  .split(",").map((s) => s.trim()).filter(Boolean);
const ANCHOR_ID = "saos-git-custody-v1";
const WINDOW = 25000; // history ops scanned (latest-first, 100-per-page)

const rpcOn = async (NODE, method, params) => {
  try {
    const r = await fetch(NODE, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
      signal: AbortSignal.timeout(15000),
    }).then((x) => x.json());
    if (r?.error) return null;
    return r;
  } catch { return null; }
};
const rpc = async (method, params) => {
  for (const NODE of NODES) {
    const r = await rpcOn(NODE, method, params);
    if (r) return r;
  }
  return null;
};

const head = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();

/* R298 FRESHNESS LAW: scan each node independently, keep the FRESHEST anchor.
 * A stale-but-valid page from node[0] can no longer hide a fresh tip. */
const fresher = (a, b) =>
  !b || String(a?.at ?? "") > String(b?.at ?? "") ||
  (String(a?.at ?? "") === String(b?.at ?? "") && Number(a?.block ?? 0) > Number(b?.block ?? 0));
const scanNode = async (NODE) => {
  /* R298 · FRESH-PATH LAW: condenser_api.get_account_history served a stale
   * page (~15min lag) while account_history_api (hived plugin) served the
   * fresh anchor on the same node. Try the plugin first, condenser fallback. */
  const fresh = await scanPlugin(NODE);
  if (fresh) return fresh;
  return scanCondenser(NODE);
};
const scanPlugin = async (NODE) => {
  try {
    /* measured live: the plugin REFUSES limit>100 (error -32801, silent-empty
     * for the caller) — cap at 100 (the anchor fires ≤1/hour; 100 master ops
     * span hours). */
    const r = await rpcOn(NODE, "account_history_api.get_account_history", { account: ACCOUNT, start: -1, limit: 100 });
    const rows = r?.result?.history ?? [];
    for (let i = rows.length - 1; i >= 0; i--) {
      const op = rows[i][1];
      const t = op?.op;
      if (t?.type === "custom_json_operation" && t?.value?.id === ANCHOR_ID) {
        try {
          const j = JSON.parse(t.value.json);
          if (j.branch === "saos-cockpit" && j.tip) return { ...j, block: op.block, at: j.at ?? null };
        } catch { /* skip malformed */ }
      }
    }
  } catch { /* fall through */ }
  return null;
};
const scanCondenser = async (NODE) => {
  let latest = null;
  let scanned = 0;
  let start = -1;
  const PAGE = 100;
  for (let page = 0; page < 250 && !latest && scanned < WINDOW; page++) {
    const hist = await rpcOn(NODE, "condenser_api.get_account_history", [ACCOUNT, start, PAGE]);
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
  return latest;
};

let latest = null;
let scanned = 0;
for (const NODE of NODES) {
  const found = await scanNode(NODE);
  if (found && fresher(found, latest)) latest = found;
  /* early exit: a fresh-enough anchor that IS in HEAD lineage — verdict settled */
  if (latest?.tip) {
    try { execSync(`git merge-base --is-ancestor ${latest.tip} HEAD`, { stdio: "pipe" }); break; } catch { /* keep scanning */ }
  }
}

/* R300-c · STAMP-TXID PATH: if history scan found only an older anchor (or
 * none), prove the stamped txid directly — get_transaction reads the op
 * payload FROM THE CHAIN, so a match is chain-truth, not self-attestation. */
const stampTx = (() => {
  try {
    const p = new URL("../mini-services/saos-engine/state/custody-anchor.json", import.meta.url);
    const s = JSON.parse(execSync(`cat ${p.pathname} 2>/dev/null`, { encoding: "utf8" }));
    return s?.txid && s?.at ? { txid: s.txid, at: new Date(s.at).toISOString() } : null;
  } catch { return null; }
})();
if (stampTx && (!latest || fresher({ at: stampTx.at }, latest))) {
  for (const NODE of NODES) {
    const r = await rpcOn(NODE, "condenser_api.get_transaction", [stampTx.txid]);
    const ops = r?.result?.operations ?? [];
    let stampProven = false;
    for (const op of ops) {
      const t = op?.op;
      if (t?.[0] === "custom_json" && t?.[1]?.id === ANCHOR_ID) {
        try {
          const j = JSON.parse(t[1].json);
          if (j.branch === "saos-cockpit" && j.tip) {
            const cand = { ...j, block: r.result.block_num, at: j.at ?? stampTx.at };
            if (fresher(cand, latest)) latest = cand;
            stampProven = true;
          }
        } catch { /* skip malformed */ }
      }
    }
    if (stampProven) break; /* the stamped txid is chain-proven — verdict input settled */
  }
}

if (!latest) { console.error(`NO-ANCHOR: no ${ANCHOR_ID} for ${ACCOUNT} across ${NODES.length} nodes`); process.exit(1); }

const ancestor = (() => {
  try { execSync(`git merge-base --is-ancestor ${latest.tip} HEAD`, { stdio: "pipe" }); return true; }
  catch { return false; }
})();

console.log(JSON.stringify({ head, anchor: { tip: latest.tip, block: latest.block, at: latest.at }, anchored: ancestor, drift: !ancestor }, null, 2));
process.exit(ancestor ? 0 : 2);
