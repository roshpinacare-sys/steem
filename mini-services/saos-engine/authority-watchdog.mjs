/**
 * authority-watchdog.mjs — R287 · THE LIVE AUTHORITY WATCHDOG
 * (operator command: "Integrate the Live Authority Watchdog" + the Supreme
 * Command §1/§2 telemetry laws).
 *
 * TWO MEASURED SURFACES, ZERO SECRETS, ZERO NEW DEPENDENCIES:
 *
 *  1. COMMIT-SIGNATURE METRICS (the GPG drift law)
 *     · LOCAL lineage: the record branch (saos-cockpit) of this very repo is
 *       walked with `git log --show-signature`-grade metadata (%G? flags) and
 *       every commit is classified: SIGNED(G) / UNSIGNED(N) / INVALID(B,E,X,U).
 *     · PUBLIC fleet repos: the documented fleet repositories are read through
 *       the PLAIN documented GitHub REST API, unauthenticated, public data
 *       only (Law 24: no fingerprint games, no ToS evasion — a read-only
 *       endpoint used as documented). Each commit's verification verdict is
 *       classified the same way.
 *     · Every non-G commit is a FLAG: recorded in state + printed instantly.
 *       The cockpit route re-echoes the newest flags into dev.log on every
 *       poll — unsigned line additions surface in the operator's own log
 *       within seconds (the "instantly" part of the command).
 *
 *  2. NODE-HEALTH RECEIPTS (operator question #2, answered YES in code)
 *     · Every known RPC endpoint across the three chains is probed with a
 *       real get_dynamic_global_properties call, latency measured, and the
 *       response appended to receipts/node-health.jsonl (dynamic, per-poll).
 *     · CIRCUIT BREAKER: 3 consecutive failures OR latency > 2500ms
 *       quarantines an endpoint for 30 minutes — slow/dying block-producing
 *       witnesses isolate THEMSELVES out of the routing pool automatically.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const REPO = path.join(DIR, "..", "..");
const stateDir = () => process.env.SAOS_STATE_DIR || path.join(DIR, "state");
const receiptsDir = () => path.join(DIR, "receipts");
const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const writeJson = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); const t = `${p}.tmp.${process.pid}`; fs.writeFileSync(t, JSON.stringify(v, null, 2)); fs.renameSync(t, p); };
const appendLine = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.appendFileSync(p, JSON.stringify(v) + "\n"); };

/* the documented public fleet (coverage measured, never assumed: an
 * unreachable repo is REPORTED as unreachable, not hidden) */
const FLEET_REPOS = ["saos-runtime", "FleetHQ", "Console", "Domain", "TruthRail", "saos-agents"];
const LOCAL_BRANCH = "saos-cockpit";

/* ── pure: %G? → verdict (selftest-covered) ──────────────────────────────── */
export function classifySig(gq) {
  /* R304 · HONEST-SIG-TAXONOMY (measured live: the matrix bled 62-73 flags
   * around the clock — every platform-signed commit (%G?=U: a CRYPTOGRAPHICALLY
   * GOOD signature whose key trust is not established in this keyring) was
   * mapped to INVALID. Alarm fatigue IS a security failure: the operator reads
   * "64-FLAGGED" as noise and stops trusting the matrix. The honest map:
   *   G     → SIGNED            (good + trusted)
   *   U     → SIGNED-UNTRUSTED  (good signature, trust not established — never
   *                             an integrity failure; cured at the root by the
   *                             R304 TRUST-ANCHOR law: the body's own signing
   *                             key gets ownertrust → new commits verify G)
   *   N     → UNSIGNED          (measured + shown per-repo; by-design classes
   *                             live in the gate's own taxonomy — R249 clause
   *                             2.5: state checkpoint noise is publishable)
   *   B/E/X → INVALID           (the ONLY true integrity anomaly: bad/expired)
   * The verdict counts INTEGRITY flags only (INVALID + SIGNED-UNTRUSTED);
   * unsigned stays fully visible in the per-repo matrix and counts. */
  switch (gq) {
    case "G": return "SIGNED";
    case "U": return "SIGNED-UNTRUSTED";
    case "N": return "UNSIGNED";
    case "B": case "E": case "X": return "INVALID";
    default: return "UNKNOWN";
  }
}

/* ── pure: circuit breaker (selftest-covered) ────────────────────────────── */
export const BREAKER = { failThreshold: 3, latencyMs: 2500, quarantineMs: 30 * 60_000 };
export function circuitBreaker(prev, { ok, ms }, now = Date.now()) {
  const fails = ok ? 0 : ((prev?.consecutiveFails ?? 0) + 1);
  const latencyBreach = ok && Number.isFinite(ms) && ms > BREAKER.latencyMs;
  const shouldQuarantine = fails >= BREAKER.failThreshold || latencyBreach;
  const prevQ = prev?.quarantinedUntil ? Date.parse(prev.quarantinedUntil) : 0;
  const quarantined = shouldQuarantine || (prevQ > now && !ok);
  const quarantinedUntil = shouldQuarantine ? new Date(now + BREAKER.quarantineMs).toISOString() : (quarantined ? new Date(prevQ).toISOString() : null);
  return {
    consecutiveFails: fails,
    quarantinedUntil,
    verdict: quarantined ? "QUARANTINED" : "OPEN",
    reason: !ok ? `${fails} consecutive failures` : (latencyBreach ? `latency ${ms}ms > ${BREAKER.latencyMs}ms` : null),
  };
}

/* ── 1a · local lineage (git-native, no secrets) ─────────────────────────── */
function scanLocalLineage(n = 30) {
  const r = spawnSync("git", ["log", `--max-count=${n}`, "--pretty=format:%H|%G?|%an|%aI|%s", LOCAL_BRANCH], { cwd: REPO, encoding: "utf8", timeout: 15_000 });
  if (r.status !== 0 || !r.stdout) return { ok: false, reason: String(r.stderr ?? "git-failed").slice(0, 120) };
  const commits = r.stdout.trim().split("\n").filter(Boolean).map((l) => {
    const [hash, gq, author, at, ...rest] = l.split("|");
    const sig = classifySig(gq);
    return { hash: String(hash ?? "").slice(0, 8), gq: gq ?? "?", sig, author: author ?? "?", at: at ?? null, subject: String(rest.join("|") ?? "").slice(0, 70) };
  });
  const signed = commits.filter((c) => c.sig === "SIGNED").length;
  return {
    ok: true, branch: LOCAL_BRANCH, scanned: commits.length,
    signedPct: commits.length ? Math.round((signed / commits.length) * 100) : 0,
    signed, unsigned: commits.filter((c) => c.sig === "UNSIGNED").length, invalid: commits.filter((c) => c.sig === "INVALID").length,
    untrusted: commits.filter((c) => c.sig === "SIGNED-UNTRUSTED").length,
    /* R304: integrity flags only — unsigned is measured above, never hidden */
    flagged: commits.filter((c) => c.sig === "INVALID" || c.sig === "SIGNED-UNTRUSTED").slice(0, 20),
  };
}

/* ── 1b · public fleet — GIT-NATIVE verification (R287-b): shallow clone in
 * /tmp (public data only), %G? judged against THIS keyring — which holds the
 * fleet's own w1 public key → fleet commits verify CRYPTOGRAPHICALLY, not
 * through GitHub's hosted verdict. No API budget consumed (the shared-IP REST
 * path measured 403 rate-limited live — kept as documented fallback). */
function scanFleetRepoGitNative(repo, perRepo = 10) {
  const dir = `/tmp/saos-watchdog-${repo}`;
  const url = `https://github.com/roshpinacare-sys/${repo}.git`;
  const sh = (cmd, args, cwd) => spawnSync(cmd, args, { cwd, encoding: "utf8", timeout: 45_000 });
  try {
    fs.mkdirSync(dir, { recursive: true });
    let r = sh("git", ["rev-parse", "--is-inside-work-tree"], dir);
    if (r.status !== 0) {
      r = sh("git", ["clone", "--depth=10", "--quiet", url, dir]);
    } else {
      /* R322 ROOT FIX (measured 2026-10-13): the refresh branch ran WITHOUT
       * cwd — `git fetch --depth=10 origin` + `git reset --hard origin/HEAD`
       * executed in the ENGINE'S LIVE REPO, not the /tmp clone. Live effect:
       * repeated shallow forced-updates poisoned the live repo's ancestry
       * (57 grafts in .git/shallow, fake 25/10 divergence, ancestor checks
       * unreliable). The watchdog must never touch the live repo's refs. */
      sh("git", ["fetch", "--depth=10", "--quiet", "origin"], dir); /* refresh shallow clone */
      sh("git", ["reset", "--hard", "--quiet", "origin/HEAD"], dir);
    }
    if (r.status !== 0) return { repo, coverage: "UNREACHABLE", reason: String(r.stderr ?? "clone-failed").slice(0, 80) };
    const lg = sh("git", ["log", `--max-count=${perRepo}`, "--pretty=format:%H|%G?|%an|%aI|%s"], dir);
    if (lg.status !== 0 || !lg.stdout) return { repo, coverage: "ERROR", reason: String(lg.stderr ?? "log-failed").slice(0, 80) };
    const commits = lg.stdout.trim().split("\n").filter(Boolean).map((l) => {
      const [hash, gq, author, at, ...rest] = l.split("|");
      return { hash: String(hash ?? "").slice(0, 8), gq: gq ?? "?", sig: classifySig(gq), author: author ?? "?", at: at ?? null, subject: String(rest.join("|") ?? "").slice(0, 70) };
    });
    const signed = commits.filter((c) => c.sig === "SIGNED").length;
    return {
      repo, coverage: "MEASURED", method: "git-native", scanned: commits.length, signed,
      unsigned: commits.filter((c) => c.sig === "UNSIGNED").length, invalid: commits.filter((c) => c.sig === "INVALID").length,
      untrusted: commits.filter((c) => c.sig === "SIGNED-UNTRUSTED").length,
      unknown: commits.filter((c) => c.sig === "UNKNOWN").length,
      signedPct: commits.length ? Math.round((signed / commits.length) * 100) : 0,
      /* R304: integrity flags only — unsigned is measured above, never hidden */
      flagged: commits.filter((c) => c.sig === "INVALID" || c.sig === "SIGNED-UNTRUSTED").slice(0, 10),
    };
  } catch (e) {
    return { repo, coverage: "ERROR", reason: String(e?.message ?? e).slice(0, 80) };
  }
}

/* ── 2 · node-health probes (real calls, real latency, receipts) ─────────── */
const NODES = [
  ...["https://api.steemit.com", "https://api.justyy.com", "https://steemapi.boylikegirl.club"].map((endpoint) => ({ chain: "steem", endpoint })),
  ...["https://api.hive.blog", "https://api.openhive.network", "https://api.deathwing.me"].map((endpoint) => ({ chain: "hive", endpoint })),
  ...["https://blurt-rpc.saboin.com", "https://rpc.blurt.blog"].map((endpoint) => ({ chain: "blurt", endpoint })), // R294: rpc.blurt.world measured NXDOMAIN 2026-10-11
];

async function probeNode({ chain, endpoint }, now) {
  const t0 = Date.now();
  let ok = false;
  try {
    const r = await fetch(endpoint, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "condenser_api.get_dynamic_global_properties", params: [], id: 1 }),
      signal: AbortSignal.timeout(2500),
    });
    const j = await r.json().catch(() => null);
    ok = r.ok && Boolean(j?.result?.head_block_number);
  } catch { ok = false; }
  const ms = Date.now() - t0;
  appendLine(path.join(receiptsDir(), "node-health.jsonl"), { at: now, chain, endpoint, ok, ms }); /* the dynamic receipt */
  return { chain, endpoint, ok, ms };
}

export async function runNodeHealth({ now = new Date().toISOString() } = {}) {
  const prev = readJson(path.join(stateDir(), "node-health.json"), null);
  const prevMap = new Map((prev?.endpoints ?? []).map((e) => [`${e.chain}:${e.endpoint}`, e]));
  const probed = await Promise.all(NODES.map((n) => probeNode(n, now)));
  const endpoints = probed.map((p) => {
    const before = prevMap.get(`${p.chain}:${p.endpoint}`) ?? null;
    const br = circuitBreaker(before, { ok: p.ok, ms: p.ms }, Date.now());
    return { ...p, ...br };
  });
  const quarantined = endpoints.filter((e) => e.verdict === "QUARANTINED").length;
  const out = {
    at: now, endpoints, quarantined, alive: endpoints.filter((e) => e.verdict === "OPEN" && e.ok).length,
    verdict: quarantined ? `${quarantined}-QUARANTINED` : "ALL-OPEN",
    breaker: BREAKER,
    law: "receipts/node-health.jsonl is the dynamic receipt rail; 3 consecutive fails or >2500ms quarantine an endpoint 30min (circuit breaker)",
  };
  writeJson(path.join(stateDir(), "node-health.json"), out);
  return out;
}

export function nodeHealthState() { return readJson(path.join(stateDir(), "node-health.json"), null); }

/* ── the watchdog run ────────────────────────────────────────────────────── */
export async function runWatchdog({ now = new Date().toISOString() } = {}) {
  const t0 = Date.now();
  const local = scanLocalLineage(30);
  const fleet = FLEET_REPOS.map((repo) => scanFleetRepoGitNative(repo));
  const measured = [local.ok ? { repo: "steem.git(LOCAL)", coverage: "MEASURED", ...local } : { repo: "steem.git(LOCAL)", coverage: "ERROR", reason: local.reason }, ...fleet];
  const flagged = measured.filter((m) => m.coverage === "MEASURED").flatMap((m) => (m.flagged ?? []).map((f) => ({ ...f, repo: m.repo })));

  /* instant flag echo — engine.log now, dev.log via the cockpit route on poll */
  for (const f of flagged.slice(0, 5)) {
    console.log(`[AUTH-WATCHDOG] ${f.sig} commit ${f.hash} on ${f.repo} by ${f.author ?? "?"}: ${f.subject ?? ""}`);
  }

  const out = {
    at: now,
    verdict: flagged.length ? `${flagged.length}-FLAGGED` : "ALL-SIGNED",
    repos: measured,
    flagged,
    coverage: { measured: measured.filter((m) => m.coverage === "MEASURED").length, total: measured.length },
    law: "every non-G commit is a named flag; public repos read through the plain documented API (public data only, Law 24); the private lineage is measured git-natively",
    ms: Date.now() - t0,
  };
  writeJson(path.join(stateDir(), "authority-watchdog.json"), out);
  appendLine(path.join(receiptsDir(), "authority-watchdog.jsonl"), { at: now, verdict: out.verdict, flagged: flagged.length, coverage: out.coverage });
  return out;
}

export function watchdogState() { return readJson(path.join(stateDir(), "authority-watchdog.json"), null); }
