#!/usr/bin/env node
/**
 * G76-i — steem-mesh-bridge · soldier-mesh-run.mjs
 * THE SOLDIER VOTING MESH RUNNER — composition root for the parallel scheduler.
 *
 * Wire law (owner directive §3): the Steem/Hive soldier voting mesh runs
 * continuously with ALL VALID soldiers. This runner owns nothing cryptographic
 * by itself — it wires:
 *
 *   roster          — the 13-soldier army (master headcorner is NOT a soldier)
 *   wounds          — CUSTODY-WOUNDS.jsonl (schema custody-wound/1); open wounds
 *                     are NEVER attempted by anyone: the heal is owner key
 *                     re-entry ONLY (haran/lsa/siq as of wave G75)
 *   scheduler       — ./soldiers.ts runSoldierMesh (per-soldier parallel
 *                     execution, failure isolation, per-soldier breaker,
 *                     seeded jitter, injected clock, hash-linked receipts)
 *   custody         — chain-judged key adoption: a soldier's posting WIF is
 *                     used ONLY if its public key matches the LIVE chain
 *                     authority (GEN-2 first, GEN-1 fallback). Zero key
 *                     material is ever printed, logged or stored here.
 *
 * MODES (SAOS_MESH_MODE):
 *   measure (default) — READ-ONLY chain truth per soldier THROUGH the mesh
 *                       (condenser_api.get_accounts): live posting authority
 *                       measured vs the custody-state reference. Zero keys,
 *                       zero broadcast. This is the honest health beat of the
 *                       mesh when the vault is not present on this machine.
 *   broadcast         — real voting/curation. PRE-FLIGHT CUSTODY GATE (all
 *                       must hold, else MESH-BLOCKED-CUSTODY, zero attempts):
 *                         · the mesh bridge reports BROADCAST_ENABLED=1
 *                         · the vault (army-keys.json) is present on this host
 *                         · a vote-task file is provided
 *                       Vote tasks: JSONL {author, permlink, weight}; one per
 *                       soldier per round; exhausted ⇒ honest skip, not error.
 *
 * Exit code 0 in every honest verdict (including MESH-FAILED /
 * MESH-BLOCKED-CUSTODY) — a broken MESH (crash, refused fail-closed boot) is
 * the only exit 1.
 */
import fs from "node:fs";
import path from "node:path";
import { runSoldierMesh, parseWoundsJsonl } from "./soldiers.ts";

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
const custodyStatePath = process.env.SAOS_CUSTODY_STATE ?? path.join(here, "..", "saos-engine", "state", "army-custody.json");
const voteTasksPath = process.env.SAOS_VOTE_TASKS ?? "";

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

/* ── wounds registry (read-only; heal is owner-only, forever) ───────────── */

function loadWounds() {
  const inline = process.env.SAOS_WOUNDS_INLINE ?? "";
  if (inline.trim()) {
    const p = parseWoundsJsonl(inline);
    return { wounds: p.wounds, source: "SAOS_WOUNDS_INLINE", malformed: p.malformed };
  }
  try {
    const p = parseWoundsJsonl(fs.readFileSync(woundsPath, "utf8"));
    return { wounds: p.wounds, source: woundsPath, malformed: p.malformed };
  } catch {
    return { wounds: [], source: null, malformed: 0 };
  }
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

/* ── MODE: broadcast — custody-gated real voting ────────────────────────── */

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

/* ── main ────────────────────────────────────────────────────────────────── */

async function main() {
  fs.mkdirSync(stateDir, { recursive: true });
  const clockMs = () => Date.now(); // composition root — the only wall clock here
  const realSleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

  const { wounds, source: woundsSource, malformed } = loadWounds();
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

  if (mode === "broadcast") {
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
      rounds,
      concurrency,
      jitterMs,
      seed,
      wounds,
      woundsSource,
      timeoutMs,
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
    woundMalformedLines: malformed,
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
  fs.writeFileSync(path.join(stateDir, "soldier-mesh-last-run.json"), JSON.stringify(runRecord, null, 2));

  const brief = {
    verdict: report.verdict,
    mode,
    roster: roster.length,
    counted: report.counted,
    wounds: wounds.map((w) => w.soldier),
    soldiers: report.soldiers.map((s) => `${s.soldier}:${s.verdict}`).join(" "),
    receipts: `${report.receipts.seq} verify=${report.receipts.verify.ok}`,
  };
  console.log("SOLDIER-MESH " + JSON.stringify(brief));
  process.exit(0);
}

main().catch((err) => {
  console.error("SOLDIER-MESH-FAIL", String(err?.message ?? err));
  process.exit(1);
});
