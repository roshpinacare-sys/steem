#!/usr/bin/env node
/**
 * G76-i → G77-h — steem-mesh-bridge · soldier-mesh-run.mjs
 * THE SOLDIER VOTING MESH RUNNER — composition root for the parallel scheduler.
 *
 * Wire law (owner directive §3 + §3.3): the Steem/Hive soldier voting mesh runs
 * continuously with ALL VALID soldiers — and, per G77-h, every custody-valid
 * soldier runs the CURATION cycle continuously. This runner owns nothing
 * cryptographic by itself — it wires:
 *
 *   roster          — the soldier army (master headcorner is NOT a soldier;
 *                     saos-0004 joins the roster only when the vault gains a
 *                     chain-matching generation — G77-h custody verdict)
 *   wounds          — CUSTODY-WOUNDS.jsonl DUAL-TIER (G77-h): the VAULT
 *                     registry (owner truth, authoritative per-soldier) merged
 *                     with the REPO-SIDE fallback registry
 *                     (mini-services/steem-mesh-bridge/CUSTODY-WOUNDS.jsonl —
 *                     carries the inherited G75 wounds and the saos-0004
 *                     owner-derivable wound to/from vault-less hosts).
 *                     Open wounds are NEVER attempted by anyone: the heal is
 *                     owner key re-entry ONLY.
 *   scheduler       — ./soldiers.ts runSoldierMesh (per-soldier parallel
 *                     execution, failure isolation, per-soldier breaker,
 *                     seeded jitter, injected clock, hash-linked receipts)
 *   curation        — ./curation.ts (readiness prover, topic selection from
 *                     the measured curate params, weight law, RC/VP battery
 *                     math, chain-truth day budget)
 *   custody         — chain-judged key adoption: a soldier's posting WIF is
 *                     used ONLY if its public key matches the LIVE chain
 *                     authority. Zero key material is ever printed, logged or
 *                     stored here.
 *
 * MODES (SAOS_MESH_MODE):
 *   measure (default) — READ-ONLY chain truth per soldier THROUGH the mesh
 *                       (condenser_api.get_accounts): live posting authority
 *                       measured vs the custody-state reference. Zero keys,
 *                       zero broadcast.
 *   readiness         — G77-h CI-runnable CURATION READINESS PROVER: per
 *                       soldier through the mesh — reachable, authority-match,
 *                       rc-above-floor (RC regen law), wound-clean — honest
 *                       per-soldier verdicts (CURATION-READY / SKIP-*), zero
 *                       keys, zero broadcast. Runs in CI (vault absent ⇒
 *                       honest SKIP-VAULT-ABSENT) and on the seal host (vault
 *                       present ⇒ full authority-match proof).
 *   curation          — G77-h THE ALL-SOLDIER CURATION BEAT: pre-flight
 *                       custody gate (bridge broadcastEnabled + vault present
 *                       + curation-beat.json enabled, else MESH-BLOCKED-
 *                       CUSTODY with ZERO attempts — lawful fail-closed), then
 *                       per round: one shared candidate fetch through the mesh
 *                       across the policy tag whitelist, and per soldier the
 *                       curation cycle — gate → chain-truth day budget →
 *                       seeded topic selection → weight law (0 < w ≤ 10000) →
 *                       custody-judged broadcast (posting WIF signs only when
 *                       the vault pub equals the live chain authority) →
 *                       incremental day-state write. Vote spacing ≥3300ms.
 *   broadcast         — G76-i raw vote-task voting (custody-gated; unchanged).
 *
 * Exit code 0 in every honest verdict (including MESH-FAILED /
 * MESH-BLOCKED-CUSTODY) — a broken MESH (crash, refused fail-closed boot) is
 * the only exit 1.
 */
import fs from "node:fs";
import path from "node:path";
import {
  mergeWoundRegistries,
  parseWoundsJsonl,
  runSoldierMesh,
} from "./soldiers.ts";
import {
  curationGate,
  countDayVotesFromHistory,
  dayKeyOf,
  effectiveVests,
  hashSeed,
  mergeCuratePolicy,
  normalizePost,
  rcPct,
  selectTopics,
  soldierCuratorPolicy,
  vpEffPct,
} from "./curation.ts";

const nowIso = (ms) => new Date(ms).toISOString();
const tail6 = (pub) => (typeof pub === "string" && pub.length > 6 ? pub.slice(-6) : String(pub ?? "?"));

const here = import.meta.dir;
const stateDir = path.join(here, "state");

const DEFAULT_ROSTER = [
  "cashmachine", "haran", "israelnews", "lsa", "macrame", "siq",
  "tov", "wic", "wog", "woq", "hcsoldier4", "hcsoldier5", "hcsoldier6",
];

const meshUrl = process.env.SAOS_MESH_URL ?? "http://127.0.0.1:3053/rpc";
const mode = process.env.SAOS_MESH_MODE ?? "measure";
const roster = (process.env.SAOS_ROSTER ?? DEFAULT_ROSTER.join(",")).split(",").map((s) => s.trim()).filter(Boolean);
const vaultDir = process.env.SAOS_VAULT_DIR ?? "/home/z/coord-work/vaults/steem-secrets";
const woundsPath = process.env.SAOS_WOUNDS_PATH ?? path.join(vaultDir, "CUSTODY-WOUNDS.jsonl");
const repoWoundsPath = process.env.SAOS_WOUNDS_REPO ?? path.join(here, "CUSTODY-WOUNDS.jsonl");
const custodyStatePath = process.env.SAOS_CUSTODY_STATE ?? path.join(here, "..", "saos-engine", "state", "army-custody.json");
const voteTasksPath = process.env.SAOS_VOTE_TASKS ?? "";
const curBeatPath = process.env.SAOS_CUR_BEAT ?? path.join(here, "curation-beat.json");
const curDayStatePath = process.env.SAOS_CUR_DAY_STATE ?? path.join(stateDir, "soldier-curation-day.json");
const readinessOutPath = process.env.SAOS_READINESS_OUT ?? path.join(stateDir, "soldier-curation-readiness.json");

/* ── mesh RPC (the failover plane — never a direct public node) ─────────── */

async function meshRpc(method, params, timeoutMs = 12_000) {
  // x-mesh-chain: steem — the soldier mesh is STEEM-law (STM posting keys).
  // Wrong-chain nodes answer STEEM-only accounts with silent EMPTY results;
  // the pin routes those reads to same-chain nodes (G76-i bridge law).
  const res = await fetch(meshUrl, {
    method: "POST",
    headers: { "content-type": "application/json", "x-mesh-chain": "steem" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 7 }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const json = await res.json();
  if (json?.error) throw new Error(`mesh-rpc ${method}: ${json.error.code ?? ""} ${String(json.error.message ?? "").slice(0, 120)}`);
  return json?.result;
}

async function bridgeHealth() {
  const healthUrl = new URL(meshUrl);
  healthUrl.pathname = "/health";
  const res = await fetch(healthUrl, { signal: AbortSignal.timeout(5_000) });
  if (!res.ok) throw new Error(`bridge /health http ${res.status}`);
  return res.json();
}

/* ── custody reference (public keys only, from the sealed state on main) ── */

function loadReferencePubs() {
  try {
    const st = JSON.parse(fs.readFileSync(custodyStatePath, "utf8"));
    const map = new Map();
    for (const a of st?.adopted ?? []) {
      if (a?.verdict === "VERIFIED-VS-CHAIN" && a?.account && a?.pubkey && !map.has(a.account)) {
        map.set(a.account, a.pubkey);
      }
    }
    return { map, source: custodyStatePath, at: st?.at ?? null };
  } catch {
    return { map: new Map(), source: null, at: null };
  }
}

/* ── wounds registries (read-only; heal is owner-only, forever) ────────────
 * G77-h DUAL-TIER: the VAULT registry (owner truth, authoritative per-soldier)
 * merged with the REPO-side fallback registry. SAOS_WOUNDS_INLINE (tests/CI)
 * replaces BOTH tiers wholesale. Per-soldier precedence lives in
 * mergeWoundRegistries (soldiers.ts) and is proven by contract tests. */

function loadWounds() {
  const inline = process.env.SAOS_WOUNDS_INLINE ?? "";
  if (inline.trim()) {
    const p = parseWoundsJsonl(inline);
    return { merged: p, sources: ["SAOS_WOUNDS_INLINE"], malformed: p.malformed, inline: true };
  }
  let vault = null;
  try {
    vault = parseWoundsJsonl(fs.readFileSync(woundsPath, "utf8"));
  } catch { /* vault registry absent on this host — honest fallback below */ }
  let repo = null;
  try {
    repo = parseWoundsJsonl(fs.readFileSync(repoWoundsPath, "utf8"));
  } catch { /* repo registry absent — nothing to fall back to */ }
  if (vault === null && repo === null) return { merged: { wounds: [], healed: 0, malformed: 0, healedSoldiers: [] }, sources: [], malformed: 0, inline: false };
  const m = mergeWoundRegistries(vault, repo);
  const sources = [];
  if (vault) sources.push(`vault:${woundsPath}`);
  if (repo) sources.push(`repo:${repoWoundsPath}`);
  return { merged: m, sources, malformed: m.malformed, inline: false };
}

/* ── MODE: measure — read-only chain truth per soldier ──────────────────── */

function measureUnit(refPubs) {
  return async (soldier) => {
    try {
      const accounts = await meshRpc("condenser_api.get_accounts", [[soldier]]);
      const acc = accounts?.[0];
      if (!acc) return { ok: false, error: "no-such-account" };
      const chainPub = acc?.posting?.key_auths?.[0]?.[0] ?? null;
      const ref = refPubs.map.get(soldier) ?? null;
      return {
        ok: true,
        measured: {
          head: String(acc?.posting?.key_auths?.[0]?.[1] ?? ""),
          chainPubTail: chainPub ? tail6(chainPub) : null,
          refPubTail: ref ? tail6(ref) : null,
          refMatch: ref && chainPub ? ref === chainPub : null,
        },
      };
    } catch (err) {
      return { ok: false, error: String(err?.message ?? err).slice(0, 200) };
    }
  };
}

/* ── vault (public keys used for chain-judged adoption; WIFs never logged) ─ */

function loadVault() {
  const p = path.join(vaultDir, "army-keys.json");
  try {
    const vault = JSON.parse(fs.readFileSync(p, "utf8"));
    return { vault, path: p };
  } catch {
    return { vault: null, path: p };
  }
}

function vaultPostingGens(vault, soldier) {
  const acc = (vault?.accounts ?? []).find((a) => (a.name ?? a.account) === soldier);
  if (!acc) return [];
  // gen order is preserved exactly as the vault holds it (GEN-2 first upstream);
  // adoption is chain-judged downstream: only a gen whose PUB equals the live
  // chain posting authority may ever sign.
  return (acc.gens ?? [])
    .map((g) => ({ gen: g.gen ?? "?", pub: g.pub ?? null, wif: g.wif ?? g.key ?? null }))
    .filter((g) => typeof g.pub === "string" && typeof g.wif === "string");
}

/* ── MODE: readiness — the curation readiness prover (CI-runnable) ───────── */

function readinessUnit({ vault, policy, woundSet, factsBySoldier }) {
  return async (soldier) => {
    try {
      const accounts = await meshRpc("condenser_api.get_accounts", [[soldier]]);
      const acc = accounts?.[0];
      if (!acc) {
        factsBySoldier.set(soldier, { reachable: false, chainPub: null, vaultPubs: vault ? [] : null, woundOpen: woundSet.has(soldier), rcPct: null, vpEff: null });
        return { ok: false, error: "no-such-account" };
      }
      const chainPub = acc?.posting?.key_auths?.[0]?.[0] ?? null;
      const vests = effectiveVests(acc);
      const vpEff = vpEffPct(Number(acc?.voting_manabar?.current_mana ?? NaN), vests);
      let rcPctVal = null;
      try {
        const rc = await meshRpc("rc_api.find_rc_accounts", { accounts: [soldier] });
        const r = rc?.rc_accounts?.[0];
        if (r) {
          rcPctVal = rcPct(
            parseInt(r.max_rc ?? "0", 10),
            parseInt(r.rc_manabar?.current_mana ?? "0", 10),
            parseInt(r.rc_manabar?.last_update_time ?? "0", 10),
            Math.floor(Date.now() / 1000), // composition root — the only wall clock here
            policy.regenWindowSec,
          );
        }
      } catch { /* honest: rc stays null → SKIP-RC-FLOOR rc-unmeasurable */ }
      const gens = vaultPostingGens(vault, soldier);
      // side channel: the measured facts flow to the per-soldier verdict below
      factsBySoldier.set(soldier, {
        reachable: true,
        chainPub,
        vaultPubs: vault ? gens.map((g) => g.pub) : null, // null = vault ABSENT on this host
        woundOpen: woundSet.has(soldier),
        rcPct: rcPctVal,
        vpEff,
      });
      return { ok: true };
    } catch (err) {
      factsBySoldier.set(soldier, { reachable: false, chainPub: null, vaultPubs: vault ? [] : null, woundOpen: woundSet.has(soldier), rcPct: null, vpEff: null });
      return { ok: false, error: String(err?.message ?? err).slice(0, 200) };
    }
  };
}

/* ── MODE: broadcast — custody-gated raw vote-task voting (G76-i, unchanged) */

function loadVoteTasks() {
  if (!voteTasksPath) return { tasks: [], source: null };
  try {
    const tasks = fs
      .readFileSync(voteTasksPath, "utf8")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        try { return JSON.parse(l); } catch { return null; }
      })
      .filter((t) => t && typeof t.author === "string" && typeof t.permlink === "string")
      .map((t) => ({ author: t.author, permlink: t.permlink, weight: Number.isFinite(t.weight) ? Math.trunc(t.weight) : 10000 }));
    return { tasks, source: voteTasksPath };
  } catch {
    return { tasks: [], source: voteTasksPath };
  }
}

function broadcastUnit({ vault, tasks }) {
  let taskCursor = 0;
  return async (soldier) => {
    // chain-judged adoption: the WIF signs ONLY if its pub matches the live authority
    const accounts = await meshRpc("condenser_api.get_accounts", [[soldier]]);
    const chainPub = accounts?.[0]?.posting?.key_auths?.[0]?.[0] ?? null;
    if (!chainPub) return { ok: false, error: "chain-authority-unreadable" };
    const gens = vaultPostingGens(vault, soldier);
    const match = gens.find((g) => g.pub === chainPub); // GEN order preserved (GEN-2 first upstream)
    if (!match) {
      return { ok: false, error: "custody-refused: no vault generation matches the live chain posting authority (owner-only heal)" };
    }
    const task = tasks[taskCursor];
    if (!task) return { ok: false, skipped: "no-task" };
    taskCursor++;
    let steemtx;
    try {
      steemtx = await import("../saos-engine/steemtx.mjs");
    } catch (err) {
      return { ok: false, error: `steemtx-unavailable: ${String(err?.message ?? err).slice(0, 120)}` };
    }
    const dgpo = await meshRpc("condenser_api.get_dynamic_global_properties", []);
    const tx = steemtx.buildTx({
      ops: [["vote", { voter: soldier, author: task.author, permlink: task.permlink, weight: task.weight }]],
      dgpo,
      wifs: [match.wif],
      ttlSec: 45,
      nowSec: Math.floor(Date.now() / 1000),
    });
    // synchronous variant: the ONLY broadcast whose reply carries the chain txid
    const result = await meshRpc("condenser_api.broadcast_transaction_synchronous", [tx.json], 20_000);
    const txid = typeof result?.id === "string" && result.id.length > 0 ? result.id : null;
    if (!txid) return { ok: false, error: "broadcast-accepted-without-txid (fail-honest: no invented receipt)" };
    return { ok: true, txids: [txid] };
  };
}

/* ── MODE: curation — the ALL-SOLDIER CURATION BEAT (G77-h, owner §3.3) ──── */

function loadCurBeat() {
  try {
    const beat = JSON.parse(fs.readFileSync(curBeatPath, "utf8"));
    return { beat, path: curBeatPath };
  } catch {
    return { beat: null, path: curBeatPath };
  }
}

function loadCurDayState(day) {
  try {
    const prev = JSON.parse(fs.readFileSync(curDayStatePath, "utf8"));
    if (prev?.day === day && prev?.perAccount && typeof prev.perAccount === "object") {
      return { day, perAccount: prev.perAccount };
    }
  } catch { /* fresh day / fresh host — honest empty state */ }
  return { day, perAccount: {} };
}

function writeCurDayState(st) {
  try {
    const t = `${curDayStatePath}.tmp.${process.pid}`;
    fs.writeFileSync(t, JSON.stringify(st, null, 2));
    fs.renameSync(t, curDayStatePath); // atomic — a mid-loop kill loses nothing
  } catch { /* honest: state-write failures surface as chain-truth next read */ }
}

/** ONE shared raw candidate fetch per runner invocation across the tag
 * whitelist (network-economical — the runArmyCuration shared-pool law). Per-
 * soldier normalization happens inside the unit so votedByUs is CHAIN-TRUTH
 * per soldier. Returns ok=false on total failure (the round degrades to
 * honest NO-CANDIDATE-STREAM skips). Multi-round runs reuse the same stream:
 * day-state + on-chain votedByUs make re-votes impossible, and the beat's
 * next cron invocation fetches fresh. */
async function fetchRawCandidates(policy) {
  const limit = Math.min(Math.max(policy.fetchLimit, 5), 100);
  const seen = new Set();
  const raw = [];
  let nodeOk = false;
  for (const tag of policy.tags) {
    let result;
    try {
      result = await meshRpc("condenser_api.get_discussions_by_created", [{ tag, limit }]);
    } catch { continue; }
    if (!Array.isArray(result)) continue;
    nodeOk = true;
    for (const post of result) {
      const key = `${post?.author}/${post?.permlink}`;
      if (!post?.author || !post?.permlink || seen.has(key)) continue;
      seen.add(key);
      raw.push(post);
    }
  }
  return { raw, ok: nodeOk };
}

function curationUnit({ vault, policy, woundSet, dayState, day, receiptSink, candidatesRef }) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  return async (soldier) => {
    // 1 — chain truth through the mesh (reachability + posting authority + battery)
    let acc, chainPub, rcPctVal = null, vpEff = null;
    try {
      const accounts = await meshRpc("condenser_api.get_accounts", [[soldier]]);
      acc = accounts?.[0];
      if (!acc) return { ok: false, skipped: "SKIP-UNREACHABLE" };
      chainPub = acc?.posting?.key_auths?.[0]?.[0] ?? null;
      vpEff = vpEffPct(Number(acc?.voting_manabar?.current_mana ?? NaN), effectiveVests(acc));
      const rc = await meshRpc("rc_api.find_rc_accounts", { accounts: [soldier] });
      const r = rc?.rc_accounts?.[0];
      if (r) {
        rcPctVal = rcPct(
          parseInt(r.max_rc ?? "0", 10),
          parseInt(r.rc_manabar?.current_mana ?? "0", 10),
          parseInt(r.rc_manabar?.last_update_time ?? "0", 10),
          Math.floor(Date.now() / 1000),
          policy.regenWindowSec,
        );
      }
    } catch (err) {
      return { ok: false, error: String(err?.message ?? err).slice(0, 200) };
    }

    // 2 — the gate (wounds are enforced upstream by the scheduler; woundSet
    //     here is belt-and-braces so a mis-wired call still fails closed)
    const gens = vaultPostingGens(vault, soldier);
    const gate = curationGate({
      reachable: true,
      chainPub,
      vaultPubs: vault ? gens.map((g) => g.pub) : null,
      woundOpen: woundSet.has(soldier),
      rcPct: rcPctVal,
      vpEff,
    }, policy);
    if (gate.verdict !== "CURATION-READY") return { ok: false, skipped: gate.verdict };

    // 3 — chain-truth day budget (T-18: max(state, chain); chain only raises)
    const st = dayState.perAccount[soldier] ?? { votesToday: [], authorsToday: {} };
    const stateCount = (st.votesToday ?? []).length;
    let chainDayCount = null;
    try {
      const hist = await meshRpc("condenser_api.get_account_history", [soldier, -1, 400]);
      chainDayCount = countDayVotesFromHistory(hist, soldier, day);
    } catch { /* fall back to state — honest */ }
    const budgetCounted = Math.max(stateCount, chainDayCount ?? 0);
    if (budgetCounted >= policy.maxPerDay) return { ok: false, skipped: "day-cap" };

    // 4 — topic selection from the measured curate params (seeded, auditable;
    //     candidates normalized PER SOLDIER so votedByUs is chain-truth)
    const nowMs = Date.now();
    const votedPermlinks = (st.votesToday ?? []).map((v) => `${v.author}/${v.permlink}`);
    const selection = selectTopics({
      posts: (candidatesRef?.current ?? []).map((r) => normalizePost(r, null, soldier)).filter(Boolean),
      voter: soldier,
      policy,
      nowMs,
      votedPermlinks,
      votesToday: budgetCounted,
      authorsToday: st.authorsToday ?? {},
      jitterSeed: hashSeed(`${day}|${Math.floor(nowMs / (2 * 3600_000))}|${soldier}`),
    });
    if (!selection.selected.length) return { ok: false, skipped: "no-candidates" };

    // 5 — custody-judged broadcast (posting WIF signs ONLY on a pub match)
    const match = gens.find((g) => g.pub === chainPub);
    if (!match) return { ok: false, skipped: "SKIP-AUTHORITY" }; // re-judged at broadcast time
    let steemtx;
    try {
      steemtx = await import("../saos-engine/steemtx.mjs");
    } catch (err) {
      return { ok: false, error: `steemtx-unavailable: ${String(err?.message ?? err).slice(0, 120)}` };
    }
    const dgpo = await meshRpc("condenser_api.get_dynamic_global_properties", []);
    let landed = 0;
    const txids = [];
    for (const sel of selection.selected) {
      // WEIGHT LAW: steem units 0 < w ≤ 10000 — fail-closed before broadcast
      if (!(sel.weight > 0 && sel.weight <= 10000)) {
        return { ok: false, error: `weight-invalid (${sel.weight}) for ${sel.author}/${sel.permlink}` };
      }
      const tx = steemtx.buildTx({
        ops: [["vote", { voter: soldier, author: sel.author, permlink: sel.permlink, weight: sel.weight }]],
        dgpo,
        wifs: [match.wif],
        ttlSec: 45,
        nowSec: Math.floor(Date.now() / 1000),
      });
      let result;
      try {
        result = await meshRpc("condenser_api.broadcast_transaction_synchronous", [tx.json], 20_000);
      } catch (err) {
        return { ok: landed > 0, txids, error: landed > 0 ? undefined : String(err?.message ?? err).slice(0, 200) };
      }
      const txid = typeof result?.id === "string" && result.id.length > 0 ? result.id : null;
      if (!txid) {
        return { ok: landed > 0, txids, error: landed > 0 ? undefined : "broadcast-accepted-without-txid (fail-honest: no invented receipt)" };
      }
      landed++; txids.push(txid);
      // incremental day-state write — a mid-loop kill loses nothing
      st.votesToday = [...(st.votesToday ?? []), { author: sel.author, permlink: sel.permlink, weight: sel.weight, at: nowIso(nowMs) }];
      st.authorsToday = { ...(st.authorsToday ?? {}), [sel.author]: (st.authorsToday?.[sel.author] ?? 0) + 1 };
      dayState.perAccount[soldier] = st;
      writeCurDayState(dayState);
      if (receiptSink) receiptSink({ at: nowIso(nowMs), soldier, author: sel.author, permlink: sel.permlink, weight: sel.weight, txid, tag: "soldier-curation" });
      if (landed >= policy.maxVotesPerCycle) break;
      await sleep(policy.voteIntervalMs); // STEEM_MIN_VOTE_INTERVAL_SEC measured law
    }
    return { ok: landed > 0, txids, votes: landed };
  };
}

/* ── main ────────────────────────────────────────────────────────────────── */

async function main() {
  fs.mkdirSync(stateDir, { recursive: true });
  const clockMs = () => Date.now(); // composition root — the only wall clock here
  const realSleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

  const woundLoad = loadWounds();
  const wounds = woundLoad.merged.wounds;
  const woundsSource = woundLoad.sources.join("+") || null;
  const woundSet = new Set(wounds.map((w) => w.soldier));
  const refPubs = loadReferencePubs();
  const seed = Number(process.env.SAOS_SEED ?? 0x5a17);
  const rounds = Math.max(1, Number(process.env.SAOS_ROUNDS ?? 1));
  const concurrency = process.env.SAOS_CONCURRENCY ? Number(process.env.SAOS_CONCURRENCY) : undefined;
  const timeoutMs = Number(process.env.SAOS_TIMEOUT_MS ?? 15_000);
  const jitterMs = Number(process.env.SAOS_JITTER_MS ?? 250);

  const receiptsSink = (line) => {
    try { fs.appendFileSync(path.join(stateDir, "soldier-mesh-receipts.jsonl"), line + "\n"); } catch { /* honest: sink never blocks */ }
  };

  let unit;
  let preflight = null;
  let readinessCtx = null;
  let curRounds = rounds;
  let curGapMs = 0;
  let curPolicy = null;

  if (mode === "curation") {
    /* pre-flight custody gate — ALL must hold, else MESH-BLOCKED-CUSTODY with
     * ZERO attempts (lawful fail-closed: no vault on this host ⇒ no broadcast) */
    const { beat, path: beatPath } = loadCurBeat();
    const gate = { bridge: null, vault: null, beat: null };
    try {
      const health = await bridgeHealth();
      gate.bridge = health?.broadcastEnabled === true ? "OK" : "REFUSED-BROADCAST-DISABLED";
    } catch (err) {
      gate.bridge = `UNREACHABLE: ${String(err?.message ?? err).slice(0, 80)}`;
    }
    const { vault, path: vaultPath } = loadVault();
    gate.vault = vault ? `OK (${path.basename(vaultPath)}, extractedAt ${vault.extractedAt ?? "?"})` : `MISSING: ${vaultPath}`;
    gate.beat = beat
      ? (beat.enabled === true ? `OK (${path.basename(beatPath)}, rounds ${beat.rounds ?? "?"}, intervalMs ${beat.intervalMs ?? "?"})` : "REFUSED-BEAT-DISABLED")
      : `MISSING: ${beatPath}`;
    preflight = { gate, beatPath };
    const blocked = Object.values(gate).some((v) => !String(v).startsWith("OK"));
    if (blocked) {
      const report = {
        runner: "soldier-mesh-run",
        mode,
        at: nowIso(clockMs()),
        verdict: "MESH-BLOCKED-CUSTODY",
        reason: "pre-flight custody gate refused (fail-closed): " + JSON.stringify(gate),
        roster,
        wounds: wounds.map((w) => w.soldier),
        woundsSource,
        zeroAttempts: true,
        law: "the heal is owner key re-entry ONLY; no code path may reconstruct custody",
      };
      fs.writeFileSync(path.join(stateDir, "soldier-mesh-last-run.json"), JSON.stringify(report, null, 2));
      console.log("SOLDIER-MESH " + JSON.stringify({ verdict: report.verdict, gate, wounds: report.wounds }));
      process.exit(0);
    }
    const policy = mergeCuratePolicy(beat.policyOverrides ?? {});
    const beatRounds = Number(process.env.SAOS_ROUNDS ?? beat.rounds ?? 1);
    const beatGapMs = Number(process.env.SAOS_CUR_INTERVAL_MS ?? beat.intervalMs ?? 0);
    const day = dayKeyOf(nowIso(clockMs()));
    const dayState = loadCurDayState(day);
    const curReceipts = (rec) => {
      try { fs.appendFileSync(path.join(stateDir, "soldier-curation-receipts.jsonl"), JSON.stringify(rec) + "\n"); } catch { /* sink never blocks */ }
    };
    // ONE shared raw candidate fetch for the whole run (law above)
    const { raw, ok: streamOk } = await fetchRawCandidates(policy);
    const candidatesRef = { current: raw };
    const inner = curationUnit({ vault, policy, woundSet, dayState, day, receiptSink: curReceipts, candidatesRef });
    unit = async (soldier) => {
      if (!streamOk) return { ok: false, skipped: "NO-CANDIDATE-STREAM" };
      return inner(soldier);
    };
    curRounds = Math.max(1, beatRounds);
    curGapMs = Math.max(0, beatGapMs);
    curPolicy = policy;
  } else if (mode === "readiness") {
    const { vault } = loadVault();
    const policy = soldierCuratorPolicy();
    const factsBySoldier = new Map();
    unit = readinessUnit({ vault, policy, woundSet, factsBySoldier });
    readinessCtx = { vaultPresent: vault !== null, policy, factsBySoldier };
  } else if (mode === "broadcast") {
    const gate = { bridge: null, vault: null, tasks: null };
    try {
      const health = await bridgeHealth();
      gate.bridge = health?.broadcastEnabled === true ? "OK" : "REFUSED-BROADCAST-DISABLED";
    } catch (err) {
      gate.bridge = `UNREACHABLE: ${String(err?.message ?? err).slice(0, 80)}`;
    }
    const { vault, path: vaultPath } = loadVault();
    gate.vault = vault ? `OK (${path.basename(vaultPath)}, extractedAt ${vault.extractedAt ?? "?"})` : `MISSING: ${vaultPath}`;
    const { tasks, source: tasksSource } = loadVoteTasks();
    gate.tasks = tasksSource ? (tasks.length > 0 ? `OK (${tasks.length} tasks)` : "EMPTY") : "MISSING: set SAOS_VOTE_TASKS";
    preflight = { gate, tasksSource };
    const blocked = Object.values(gate).some((v) => !String(v).startsWith("OK"));
    if (blocked) {
      const report = {
        runner: "soldier-mesh-run",
        mode,
        at: nowIso(clockMs()),
        verdict: "MESH-BLOCKED-CUSTODY",
        reason: "pre-flight custody gate refused (fail-closed): " + JSON.stringify(gate),
        roster,
        wounds: wounds.map((w) => w.soldier),
        woundsSource,
        zeroAttempts: true,
        law: "the heal is owner key re-entry ONLY; no code path may reconstruct custody",
      };
      fs.writeFileSync(path.join(stateDir, "soldier-mesh-last-run.json"), JSON.stringify(report, null, 2));
      console.log("SOLDIER-MESH " + JSON.stringify({ verdict: report.verdict, gate, wounds: report.wounds }));
      process.exit(0);
    }
    unit = broadcastUnit({ vault, tasks });
  } else {
    unit = measureUnit(refPubs);
  }

  let report;
  try {
    report = await runSoldierMesh({
      soldiers: roster,
      clock: clockMs,
      sleep: realSleep,
      unit,
      rounds: mode === "curation" ? curRounds : rounds,
      concurrency,
      jitterMs,
      seed,
      wounds,
      woundsSource,
      timeoutMs,
      roundGapMs: mode === "curation" ? curGapMs : 0,
      breaker: {
        failureThreshold: Number(process.env.SAOS_BREAKER_THRESHOLD ?? 3),
        cooldownMs: Number(process.env.SAOS_BREAKER_COOLDOWN_MS ?? 30_000),
      },
      receiptsSink,
    });
  } catch (err) {
    console.error("SOLDIER-MESH-FAIL", String(err?.message ?? err));
    process.exit(1);
  }

  const runRecord = {
    runner: "soldier-mesh-run",
    mode,
    at: nowIso(report.at),
    verdict: report.verdict,
    counted: report.counted,
    rounds: report.rounds,
    seed: report.seed,
    woundsSource: report.woundsSource,
    woundMalformedLines: woundLoad.malformed,
    refPubSource: refPubs.source,
    refPubStateAt: refPubs.at,
    preflight,
    soldiers: report.soldiers.map((s) => ({
      soldier: s.soldier,
      verdict: s.verdict,
      attempts: s.attempts,
      ok: s.okCount,
      fail: s.failCount,
      timeout: s.timeoutCount,
      breaker: s.breaker,
      error: s.error,
      ms: s.ms,
      ...(s.verdict === "OK" || s.txids.length ? { txids: s.txids } : {}),
    })),
    receipts: report.receipts,
  };

  /* ── readiness mode: per-soldier curation verdicts from measured facts ──── */
  if (mode === "readiness" && readinessCtx !== null) {
    const { vaultPresent, policy, factsBySoldier } = readinessCtx;
    const perSoldier = [];
    for (const s of report.soldiers) {
      const facts = factsBySoldier?.get(s.soldier) ?? null;
      const gate = facts
        ? curationGate(facts, policy)
        : { verdict: s.verdict === "SKIP-CUSTODY-WOUND" ? "SKIP-WOUND" : "SKIP-UNREACHABLE", reason: s.verdict === "SKIP-CUSTODY-WOUND" ? "open custody wound (custody-wound/1)" : "no measurement available" };
      perSoldier.push({
        soldier: s.soldier,
        meshVerdict: s.verdict,
        gateVerdict: gate.verdict,
        reason: gate.reason,
        facts: facts ? {
          reachable: facts.reachable,
          chainPubTail6: tail6(facts.chainPub),
          vaultPubsTail6: facts.vaultPubs === null ? null : (facts.vaultPubs ?? []).map(tail6),
          woundOpen: facts.woundOpen,
          rcPct: facts.rcPct,
          vpEff: facts.vpEff,
        } : null,
      });
    }
    const readyCount = perSoldier.filter((p) => p.gateVerdict === "CURATION-READY").length;
    const readinessRecord = {
      runner: "soldier-mesh-run",
      mode: "readiness",
      at: nowIso(report.at),
      vaultPresent,
      policy: {
        rcFloorPct: policy.rcFloorPct,
        minVpEffPct: policy.minVpEffPct,
        maxPerDay: policy.maxPerDay,
        ageWindowMinutes: [policy.ageMinMinutes, policy.ageMaxMinutes],
      },
      woundsSource,
      woundMalformedLines: woundLoad.malformed,
      meshVerdict: report.verdict,
      summary: {
        roster: perSoldier.length,
        curationReady: readyCount,
        byVerdict: perSoldier.reduce((m, p) => ((m[p.gateVerdict] = (m[p.gateVerdict] ?? 0) + 1), m), {}),
      },
      soldiers: perSoldier,
      receipts: report.receipts,
    };
    fs.writeFileSync(readinessOutPath, JSON.stringify(readinessRecord, null, 2));
    fs.writeFileSync(path.join(stateDir, "soldier-mesh-last-run.json"), JSON.stringify(runRecord, null, 2));
    console.log("SOLDIER-CURATION-READINESS " + JSON.stringify({
      vaultPresent,
      curationReady: readyCount,
      byVerdict: readinessRecord.summary.byVerdict,
      out: readinessOutPath,
    }));
    process.exit(0);
  }

  fs.writeFileSync(path.join(stateDir, "soldier-mesh-last-run.json"), JSON.stringify(runRecord, null, 2));

  const brief = {
    verdict: report.verdict,
    mode,
    roster: roster.length,
    counted: report.counted,
    wounds: wounds.map((w) => w.soldier),
    soldiers: report.soldiers.map((s) => `${s.soldier}:${s.verdict}`).join(" "),
    receipts: `${report.receipts.seq} verify=${report.receipts.verify.ok}`,
    ...(mode === "curation" ? { policy: { rcFloorPct: curPolicy.rcFloorPct, minVpEffPct: curPolicy.minVpEffPct, maxPerDay: curPolicy.maxPerDay } } : {}),
  };
  console.log("SOLDIER-MESH " + JSON.stringify(brief));
  process.exit(0);
}

main().catch((err) => {
  console.error("SOLDIER-MESH-FAIL", String(err?.message ?? err));
  process.exit(1);
});
