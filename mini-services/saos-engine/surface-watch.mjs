/**
 * surface-watch.mjs — exec33 · lane 33-a · THE SELF-HEAL SURFACE WATCHTOWER.
 *
 * LAW PROVENANCE — the owner's exec33 directive (verbatim intent): "no owner
 * arming — sovereignty achieves everything itself; the site fell, got no data,
 * and the sovereignty did NOT self-repair until manual intervention — that is
 * not autonomous. The sovereign must verify activity as required."
 *
 * WHAT THIS MODULE IS: the owner-independent surface-verification +
 * autonomous-repair layer. Every beat MEASURES the fleet's live surfaces
 * (the Pulse front-door + its data files, the engine's own state freshness,
 * the public artery's last run, the chain RPC) instead of assuming they are
 * alive, and when a surface is measured non-OK the watch PLANS a lawful
 * repair — and EXECUTES it when the previous sealed verdict was non-OK
 * (the autonomous self-heal: no owner arming, no manual intervention).
 *
 * THE SURFACES (measured facts, exec33):
 *   - Pulse Pages site  https://roshpinacare-sys.github.io/Pulse/  (front-door,
 *     deploys on content commit). Its data: own-repo state/network.json +
 *     mirror/lanes.json + cross-repo raw Domain/main/content/published.json.
 *   - Engine state freshness: ci-last-heartbeat (age), presence-matrix-digest
 *     (age), selftest-last-run (age).
 *   - Public artery: saos-runtime sovereign-runtime.yml last run conclusion
 *     (GitHub Actions API).
 *   - Steem RPC liveness: one cheap condenser_api.get_dynamic_global_property.
 *
 * REPAIR LAW (infrastructure/state-ONLY — the hard rules):
 *   STALE/DOWN datafile|statefile → "regen-state"   (dispatch the OWNING
 *       generator workflow — re-run the generator, never hand-craft state)
 *   site DOWN                     → "retrigger-pages" (re-push a content commit
 *       to Pulse main — Pages deploys on content commit)
 *   workflow DOWN                 → "redispatch"   (workflow-dispatch via API)
 *   rpc DOWN                      → "failover-node" (rotate to the next public
 *       node — zero keys, public RPC only)
 *   anything else (DEGRADED)      → "escalate"      (honest DECISIONS-bound
 *       receipt — never a fake success)
 *   Every action carries readbackRequired: true; every EXECUTED repair is
 *   followed by an immediate readback re-probe recorded as MATCH|MISMATCH —
 *   a pending Pages build or a just-dispatched generator is honestly
 *   MISMATCH-now, and the NEXT beat's fresh probe is the real verification.
 *
 * WHAT NEVER HAPPENS HERE: zero keys, zero chain broadcasts, zero value
 * moves, zero account actions (R330/R333 untouched, standby laws untouched).
 * Repairs are state files / CI re-triggers / site content re-push ONLY.
 *
 * OBSERVE-FIRST LAW: the default repairMode is "observe" (probes + plans
 * recorded, nothing executed). Act mode is armed ONLY when the PREVIOUS
 * sealed verdict was non-OK (SURFACES-DEGRADED / SURFACES-DOWN) — the
 * fail-closed R302/R304 pattern, and exactly the owner's complaint closed:
 * the first degraded beat documents, the next beat repairs by itself.
 *
 * SOURCE VOCABULARY: pages|raw|api|rpc per the exec33 brief, plus ONE
 * measured extension — source "local" for state files that live in the
 * PRIVATE steem repo (measured 2026-10-14: steem is private, anonymous raw
 * = 404, so a raw probe would read DOWN and LIE; the git-as-memory clone
 * IS the state truth). engine-heartbeat probes the PUBLIC canonical home
 * (saos-runtime state/beat/ci-last-heartbeat.json — R321 measured the steem
 * copy as custodian-rewound; the runtime copy is the CI-owned canonical).
 *
 * LAWS (measured, not aspirational):
 *  - SWR / never-wedge: probes fire CONCURRENTLY (allSettled discipline),
 *    each capped by its own timeout (default 8s, injectable for the
 *    offline selftest) — one hanging target can never stall the beat.
 *  - Exit-0 by design: every failure degrades to an honest verdict, never
 *    a throw; a probe that cannot measure says "probe-error" (DEGRADED),
 *    never a fabricated DOWN or OK.
 *  - Readback MATCH discipline: a fetched 200 is not success — datafiles
 *    are PARSED and shape-checked (required keys + timestamp) so the
 *    raw-200-empty trap reads DEGRADED, never OK.
 *  - Zero npm deps (node builtins + global fetch). Pure where testable:
 *    probeTargets/judgeSurface/planRepair/signWatchDoc take no clock beyond
 *    the passed now, no randomness, no network. fetchImpl is the selftest
 *    seam (content-engagement convention); production uses global fetch.
 *  - Credentials: read from SAOS_GH_TOKEN || GH_PAT || GITHUB_TOKEN, used
 *    for API auth ONLY, NEVER echoed, NEVER written to any receipt. Absent
 *    token → repairs record "blocked-no-credential" honestly (fail-closed,
 *    the R314 pattern) — they never fake success.
 */

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
/* exec37 · lane 37-a · R355-wiring: the triage brain (watch-upgrades.mjs,
 * byte-untouched) imported as a READ-ONLY ADVISORY dependency — pure module,
 * no side effects, no cycle (it imports node:fs/path only). */
import { triageFailure } from "./watch-upgrades.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);

/* ── hard constants (not knobs) ──────────────────────────────────────────── */
export const WATCH_SCHEMA_V = 1;
export const PROBE_TIMEOUT_MS = 8000;          // per-target cap (~8s per brief)
export const MAX_REPAIRS_PER_BEAT = 8;         // anti-storm cap on executions
/* 3-node public failover list — same law/order as content-engagement.mjs */
export const STEEM_NODES = [
  "https://api.steemit.com",
  "https://api.justyy.com",
  "https://steem-rpc.publicnode.com",
];

const PULSE_SITE = "https://roshpinacare-sys.github.io/Pulse/";
const PULSE_RAW = "https://raw.githubusercontent.com/roshpinacare-sys/Pulse/main";
const DOMAIN_RAW = "https://raw.githubusercontent.com/roshpinacare-sys/Domain/main";
const RUNTIME_RAW = "https://raw.githubusercontent.com/roshpinacare-sys/saos-runtime/main";
const RUNTIME_API = "https://api.github.com/repos/roshpinacare-sys/saos-runtime";
const ORG = "roshpinacare-sys";
const SITE_MARKER = "Pulse ·"; // stable <title> marker — the page IS the front-door

/* ── pure: the target registry (typed; ages are the OWNING generator's own
 * documented SLA: Pulse heartbeat.yml declares state-freshness 90min; the
 * presence-matrix D5 law is <12h; Domain published-ledger cron is twice
 * hourly; the runtime pulse chain is ~20-25 min) ─────────────────────────── */
export function probeTargets(_now = null) {
  return [
    { id: "pulse-site", kind: "site", url: PULSE_SITE, maxAgeMinutes: null, source: "pages", marker: SITE_MARKER },
    { id: "pulse-network", kind: "datafile", url: `${PULSE_RAW}/state/network.json`, maxAgeMinutes: 90, source: "raw", requiredKeys: ["schema", "generatedAt"], tsKeys: ["generatedAt"] },
    { id: "pulse-mirror-lanes", kind: "datafile", url: `${PULSE_RAW}/mirror/lanes.json`, maxAgeMinutes: 90, source: "raw", requiredKeys: ["schema", "generatedAt"], tsKeys: ["generatedAt"] },
    { id: "pulse-domain-published", kind: "datafile", url: `${DOMAIN_RAW}/content/published.json`, maxAgeMinutes: 90, source: "raw", requiredKeys: ["schema", "posts"], tsKeys: ["generatedAt"] },
    /* the canonical CI-owned heartbeat (R321: the steem copy is custodian-rewound) */
    { id: "engine-heartbeat", kind: "statefile", url: `${RUNTIME_RAW}/state/beat/ci-last-heartbeat.json`, maxAgeMinutes: 90, source: "raw", requiredKeys: ["at"], tsKeys: ["at"] },
    /* private steem state → measured "local" source (see header) */
    { id: "engine-presence-digest", kind: "statefile", url: "private:steem/saos-cockpit presence-matrix-digest", localPath: "presence-matrix-digest.json", maxAgeMinutes: 720, source: "local", requiredKeys: ["at", "verdict"], tsKeys: ["at"] },
    { id: "engine-selftest", kind: "statefile", url: "private:steem/saos-cockpit selftest-last-run", localPath: "selftest-last-run.json", maxAgeMinutes: 90, source: "local", requiredKeys: ["pass", "fail", "at"], tsKeys: ["at"] },
    { id: "artery-workflow", kind: "workflow", url: `${RUNTIME_API}/actions/workflows/sovereign-runtime.yml/runs?per_page=1`, maxAgeMinutes: 90, source: "api", workflowRepo: "saos-runtime", workflowFile: "sovereign-runtime.yml" },
    { id: "steem-rpc", kind: "rpc", url: STEEM_NODES[0], maxAgeMinutes: null, source: "rpc" },
  ];
}

/* ── pure: canonical form + the seal (sig:8hex over sha256, fleet style) ─── */
export function stableStringify(v) {
  if (v === undefined) return "null";
  if (Array.isArray(v)) return `[${v.map((x) => stableStringify(x)).join(",")}]`;
  if (v && typeof v === "object") {
    const keys = Object.keys(v).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}
export function signWatchDoc(doc) {
  const { signature, ...rest } = doc ?? {};
  return "sig:" + createHash("sha256").update(stableStringify(rest ?? {})).digest("hex").slice(0, 8);
}

const r1 = (x) => (Number.isFinite(x) ? Math.round(x * 10) / 10 : null);

/* ── pure: the deterministic judge. observed is what the probe measured:
 *   {status, body?, json?, runStatus?, conclusion?, createdAt?, headBlock?,
 *    probeError?, observedAt?} — verdicts OK|STALE|DOWN|DEGRADED only. ────── */
export function judgeSurface(target, observed, now = null) {
  const atMs = Date.parse(now ?? observed?.observedAt ?? "");
  const out = (verdict, reason, ageMinutes = null) => ({ verdict, reason, ageMinutes });
  if (!observed || typeof observed !== "object") return out("DEGRADED", "probe-no-observation");
  if (target.kind === "rpc") {
    /* the rpc surface IS the node: a node that will not answer is MEASURED
     * DOWN (the lawful repair is the cheap public-node failover) — never a
     * fabricated OK; a node that answers without a head block gets one
     * fallback liveness call before DOWN (see probeOne — DGPO is blocked on
     * public jussi nodes as measured 2026-10-14, the chain is not down) */
    if (observed.probeError) return out("DOWN", `rpc-node-unreachable:${String(observed.probeError).slice(0, 50)}`);
    if (Number.isFinite(observed.headBlock)) return out("OK", "head-block-alive");
    if (observed.fallbackAlive) return out("OK", "alive-via-get-accounts (dgpo-blocked-on-node)");
    return out("DOWN", "no-head-block");
  }
  if (observed.probeError) {
    /* honest unknown: we could not measure (timeout/net/rate-limit) — that is
     * DEGRADED, never a fabricated DOWN, never a fabricated OK */
    return out("DEGRADED", `probe-error:${String(observed.probeError).slice(0, 60)}`);
  }
  if (target.kind === "site") {
    if (observed.status === 200) {
      const marked = typeof observed.body === "string" && observed.body.includes(target.marker ?? SITE_MARKER);
      return marked ? out("OK", "front-door-200-marked") : out("DEGRADED", "site-200-unmarked (readback shape mismatch)");
    }
    return out("DOWN", `http-${observed.status ?? "?"}`);
  }
  if (target.kind === "datafile" || target.kind === "statefile") {
    if (observed.status !== 200) return out("DOWN", `http-${observed.status ?? "?"}`);
    if (observed.json === undefined) return out("DOWN", "unparseable-json");
    const j = observed.json;
    const missing = (target.requiredKeys ?? []).filter((k) => !(k in (j ?? {})));
    if (missing.length) return out("DEGRADED", `shape-missing:${missing.join(",")}`); // the raw-200-empty trap
    const tsRaw = (target.tsKeys ?? []).map((k) => j?.[k]).find((v) => typeof v === "string" && v.trim());
    const tsMs = tsRaw ? Date.parse(tsRaw) : NaN;
    if (!Number.isFinite(tsMs)) return out("DEGRADED", "shape-missing-timestamp (no fake age)");
    const ageMin = Number.isFinite(atMs) ? Math.max(0, r1((atMs - tsMs) / 60000)) : null;
    const cap = Number(target.maxAgeMinutes);
    if (!Number.isFinite(cap)) return out("OK", "shape-ok");
    if (!Number.isFinite(ageMin)) return out("DEGRADED", "no-clock-anchor (no fake age)");
    return ageMin <= cap ? out("OK", "fresh", ageMin) : out("STALE", `age>${cap}m`, ageMin);
  }
  if (target.kind === "workflow") {
    const conclusion = observed.conclusion ?? null;
    const runStatus = observed.runStatus ?? null;
    const active = runStatus === "in_progress" || runStatus === "queued" || runStatus === "waiting" || runStatus === "pending";
    if (active) return out("OK", "run-active (artery alive right now)");
    if (runStatus === null && conclusion === null) return out("DEGRADED", "artery-unmeasured (no runs visible)");
    if (["failure", "timed_out", "startup_failure", "action_required"].includes(conclusion)) return out("DOWN", `conclusion:${conclusion}`);
    if (conclusion === "cancelled") return out("DEGRADED", "conclusion:cancelled");
    if (conclusion === null && runStatus === "completed") return out("DEGRADED", "conclusion-missing");
    if (conclusion !== "success") return out("DEGRADED", `conclusion:${conclusion ?? "none"}`);
    const tsMs = Date.parse(observed.createdAt ?? "");
    const ageMin = Number.isFinite(tsMs) && Number.isFinite(atMs) ? Math.max(0, r1((atMs - tsMs) / 60000)) : null;
    const cap = Number(target.maxAgeMinutes);
    if (!Number.isFinite(cap)) return out("OK", "conclusion:success");
    if (!Number.isFinite(ageMin)) return out("DEGRADED", "no-clock-anchor (no fake age)");
    return ageMin <= cap ? out("OK", "conclusion:success", ageMin) : out("STALE", `last-success age>${cap}m`, ageMin);
  }
  return out("DEGRADED", "unknown-kind");
}

/* ── pure: the lawful repair planner. Judged = {target, verdict, reason}.
 *   Returns {action, ...lawful params, readbackRequired: true} or null. ───── */
export function planRepair(judged) {
  if (!judged || judged.verdict === "OK") return null;
  const t = judged.target ?? {};
  const regenOwner = (id) => {
    if (id === "pulse-network" || id === "pulse-mirror-lanes") return { repo: "Pulse", workflow: "heartbeat.yml" };
    if (id === "pulse-domain-published") return { repo: "Domain", workflow: "published-ledger.yml" };
    if (id && id.startsWith("engine-")) return { repo: "saos-runtime", workflow: "sovereign-runtime.yml" };
    return null;
  };
  let action = null;
  if (judged.verdict === "STALE") {
    const owner = regenOwner(t.id);
    action = owner ? { action: "regen-state", ...owner } : { action: "escalate" };
  } else if (judged.verdict === "DOWN") {
    if (t.kind === "site") action = { action: "retrigger-pages", repo: "Pulse", path: "state/watchtower-heal.json" };
    else if (t.kind === "workflow") action = { action: "redispatch", repo: t.workflowRepo ?? "saos-runtime", workflow: t.workflowFile ?? "sovereign-runtime.yml" };
    else if (t.kind === "rpc") action = { action: "failover-node" };
    else if (t.kind === "datafile" || t.kind === "statefile") {
      const owner = regenOwner(t.id);
      action = owner ? { action: "regen-state", ...owner } : { action: "escalate" };
    } else action = { action: "escalate" };
  } else {
    /* DEGRADED / unknown — escalate honestly, never fake a repair */
    action = { action: "escalate" };
  }
  return { ...action, readbackRequired: true };
}

/* ── exec37 · lane 37-a · the R355 advisory triage seam (fail-closed) ──────
 * One classification per non-OK surface, BEFORE any repair decision.
 * READ-ONLY by construction: the judged input is never mutated, no clock,
 * no network, no execution. A triage that THROWS (or any unexpected shape)
 * degrades fail-closed to AMBIGUOUS/observe-only — a broken brain must
 * never unlock hands, and must never fabricate a class. */
export function triageAdvisory(judged) {
  try {
    const t = triageFailure({
      surface: typeof judged?.target?.id === "string" ? judged.target.id : undefined,
      verdict: typeof judged?.verdict === "string" ? judged.verdict : undefined,
      reason: typeof judged?.reason === "string" ? judged.reason : undefined,
      httpCode: null,
    });
    if (!t || typeof t.class !== "string" || !["ENVIRONMENT", "CODE", "AMBIGUOUS"].includes(t.class)) {
      return { class: "AMBIGUOUS", confidence: "high", basis: "triage-shape-invalid:fail-closed-observe-only", advisedAction: "observe-then-escalate" };
    }
    return { class: t.class, confidence: t.confidence, basis: t.basis, advisedAction: t.advisedAction };
  } catch (e) {
    return { class: "AMBIGUOUS", confidence: "high", basis: `triage-throw:fail-closed-observe-only (${String(e?.message ?? e).slice(0, 60)})`, advisedAction: "observe-then-escalate" };
  }
}

/* ── credentials: env-sourced, NEVER echoed, NEVER written to receipts ───── */
function ghToken() {
  return process.env.SAOS_GH_TOKEN || process.env.GH_PAT || process.env.GITHUB_TOKEN || null;
}

/* ── HEAD sha (read-only; never fatal) ───────────────────────────────────── */
function headSha() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: DIR, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

function writeAtomic(file, doc) {
  const tmp = `${file}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(doc, null, 2));
  fs.renameSync(tmp, file);
}

function readJsonSafe(file, d = null) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return d; }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, Number(ms) || 0));

/* withTimeout: the SWR race — a hanging fetchImpl (or a hanging socket) can
 * never wedge the watch: the loser is an honest probe-error observation. */
async function withTimeout(p, ms, label) {
  let timer = null;
  const gate = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ probeError: `timeout-${ms}ms (${label ?? "probe"})` }), ms);
  });
  try {
    const v = await Promise.race([Promise.resolve(p), gate]);
    clearTimeout(timer);
    return v;
  } catch (e) {
    clearTimeout(timer);
    return { probeError: String(e?.message ?? e).slice(0, 80) };
  }
}

async function doFetch(fetchImpl, url, opts = {}) {
  const f = fetchImpl ?? ((u, o) => fetch(u, o));
  return f(url, { headers: { "User-Agent": "saos-surface-watch", ...(opts.headers ?? {}) }, ...opts });
}

/* ── one probe (never rejects; unmeasurable = probeError observation) ──────
 * timeoutMs is the probe's own cap — injectable so the offline selftest
 * proves the SWR law in milliseconds, never seconds. */
async function probeOne(target, { fetchImpl, now, stateDir, token, timeoutMs = PROBE_TIMEOUT_MS }) {
  const kind = target?.kind;
  try {
    if (kind === "site" || ((kind === "datafile" || kind === "statefile") && target.source !== "local")) {
      const res = await doFetch(fetchImpl, target.url, { signal: AbortSignal.timeout(timeoutMs) });
      const body = typeof res?.text === "function" ? await res.text() : null;
      const obs = { status: res?.status ?? null, observedAt: now };
      if (kind === "site") { obs.body = body; return obs; }
      try { obs.json = JSON.parse(body ?? ""); } catch { obs.json = undefined; }
      return obs;
    }
    if (kind === "statefile" && target.source === "local") {
      const file = path.join(stateDir, target.localPath ?? "");
      let raw = null;
      try { raw = fs.readFileSync(file, "utf8"); } catch (e) {
        if (e?.code === "ENOENT") return { status: 404, observedAt: now };
        return { probeError: `local-read:${String(e?.message ?? e).slice(0, 60)}`, observedAt: now };
      }
      const obs = { status: 200, observedAt: now, json: undefined };
      try { obs.json = JSON.parse(raw); } catch { obs.json = undefined; }
      return obs;
    }
    if (kind === "workflow") {
      const headers = { Accept: "application/vnd.github+json" };
      if (token) headers.Authorization = `Bearer ${token}`; // never echoed anywhere
      const res = await doFetch(fetchImpl, target.url, { headers, signal: AbortSignal.timeout(timeoutMs) });
      if (!res?.ok) return { probeError: `api-http-${res?.status ?? "?"}`, observedAt: now }; // rate-limit ≠ artery-down
      const j = typeof res.json === "function" ? await res.json() : null;
      const run = Array.isArray(j?.workflow_runs) && j.workflow_runs.length ? j.workflow_runs[0] : null;
      if (!run) return { runs: 0, observedAt: now };
      return { runs: j.workflow_runs.length, runStatus: run.status ?? null, conclusion: run.conclusion ?? null, createdAt: run.created_at ?? null, observedAt: now };
    }
    if (kind === "rpc") {
      const res = await doFetch(fetchImpl, target.url, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "condenser_api.get_dynamic_global_property", params: [], id: 1 }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res?.ok) return { probeError: `http-${res?.status ?? "?"}`, observedAt: now };
      const j = typeof res.json === "function" ? await res.json() : null;
      const hb = j?.result?.head_block_number;
      if (Number.isFinite(Number(hb))) return { headBlock: Number(hb), observedAt: now };
      /* MEASURED 2026-10-14: the public jussi front-ends reject DGPO itself
       * (assert_exception / method-not-found) while the chain is perfectly
       * alive — api.steemit.com answered get_accounts with full chain truth
       * in the same minute. Liveness is the SURFACE; DGPO is only the
       * mission's first cheap signal. One fallback read-only call measures
       * the truth instead of crying DOWN. (content-engagement precedent:
       * dgpo-first, account-fallback.) */
      try {
        const res2 = await doFetch(fetchImpl, target.url, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", method: "condenser_api.get_accounts", params: [["steem"]], id: 1 }),
          signal: AbortSignal.timeout(timeoutMs),
        });
        const j2 = typeof res2?.json === "function" ? await res2.json() : null;
        const alive = Array.isArray(j2?.result) && j2.result.length > 0 && typeof j2.result[0]?.name === "string";
        return { headBlock: null, fallbackAlive: alive, observedAt: now };
      } catch {
        return { headBlock: null, fallbackAlive: false, observedAt: now };
      }
    }
    return { probeError: "unknown-kind", observedAt: now };
  } catch (e) {
    return { probeError: String(e?.message ?? e).slice(0, 80), observedAt: now };
  }
}

/* ── repair executors (fail-closed; every result is honest) ──────────────── */
async function apiDispatch(fetchImpl, token, { repo, workflow, ref = "main" }) {
  if (!token) return { http: null, blocked: "no-credential" };
  try {
    const res = await doFetch(fetchImpl, `https://api.github.com/repos/${ORG}/${repo}/actions/workflows/${workflow}/dispatches`, {
      method: "POST",
      headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ ref }),
    });
    return { http: res?.status ?? null, ok: res?.status === 204 };
  } catch (e) {
    return { http: null, blocked: String(e?.message ?? e).slice(0, 60) };
  }
}

async function commitPulseHeal(fetchImpl, token, { ppath, now, reason }) {
  if (!token) return { blocked: "no-credential" };
  const api = `https://api.github.com/repos/${ORG}/Pulse/contents/${ppath}`;
  const headers = { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}` };
  try {
    const cur = await doFetch(fetchImpl, api, { headers });
    const sha = cur?.ok ? (await cur.json())?.sha ?? undefined : undefined;
    const content = Buffer.from(JSON.stringify({ at: now, by: "surface-watch", reason: String(reason ?? "").slice(0, 120), note: "content commit — Pages retrigger (self-heal)" }, null, 2)).toString("base64");
    const put = await doFetch(fetchImpl, api, {
      method: "PUT", headers,
      body: JSON.stringify({ message: `surface-watch: retrigger Pages (content commit — self-heal, ${String(reason ?? "").slice(0, 40)})`, content, ...(sha ? { sha } : {}) }),
    });
    return { http: put?.status ?? null, ok: put?.status === 200 || put?.status === 201 };
  } catch (e) {
    return { blocked: String(e?.message ?? e).slice(0, 60) };
  }
}

/* execute one planned repair → receipt {id, action, result, readback, detail}.
 * The readback is an IMMEDIATE re-probe of the same surface (fresh fetch,
 * never cached): MATCH = the surface measures OK now; MISMATCH = not healed
 * yet — recorded honestly (a Pages build / generator run lands minutes
 * later; the NEXT beat's fresh probe is the standing verification). */
async function executeRepair(plan, judged, ctx) {
  const { fetchImpl, now, stateDir, token } = ctx;
  const receipt = { id: judged.target.id, action: plan.action, result: null, readback: null, detail: {} };
  let readbackTarget = judged.target; // default: re-probe the same surface
  try {
    if (plan.action === "regen-state" || plan.action === "redispatch") {
      const d = await apiDispatch(fetchImpl, token, plan);
      receipt.result = d.ok ? "dispatched" : d.blocked ? `blocked-${d.blocked}` : `blocked-http-${d.http}`;
      receipt.detail.owner = `${plan.repo}/${plan.workflow}`;
    } else if (plan.action === "retrigger-pages") {
      const c = await commitPulseHeal(fetchImpl, token, { ppath: plan.path, now, reason: judged.reason });
      receipt.result = c.ok ? "committed" : c.blocked ? `blocked-${c.blocked}` : `blocked-http-${c.http}`;
      receipt.detail.path = `${plan.repo}/${plan.path}`;
    } else if (plan.action === "failover-node") {
      const idx = Math.max(0, STEEM_NODES.indexOf(judged.target.url)); // unknown node ≡ primary
      const next = STEEM_NODES[(idx + 1) % STEEM_NODES.length];
      const probe = await probeOne({ kind: "rpc", url: next }, { fetchImpl, now, stateDir, token, timeoutMs: ctx.timeoutMs });
      const alive = Number.isFinite(probe?.headBlock);
      receipt.result = alive ? "failed-over" : "blocked-next-node-down";
      receipt.detail = { from: judged.target.url, to: next };
      readbackTarget = { kind: "rpc", url: next }; // the healing IS the next node answering
      try {
        fs.mkdirSync(stateDir, { recursive: true });
        writeAtomic(path.join(stateDir, "rpc-failover.json"), { at: now, from: judged.target.url, to: next, alive });
      } catch { /* read-only worktree — the receipt still carries the rotation */ }
    } else if (plan.action === "escalate") {
      receipt.result = "escalated";
      receipt.detail.note = "DECISIONS-bound receipt (honest, never fake success) — recorded in surface-escalations.jsonl for the registry lane";
      try {
        fs.mkdirSync(stateDir, { recursive: true });
        fs.appendFileSync(path.join(stateDir, "surface-escalations.jsonl"), JSON.stringify({ at: now, id: judged.target.id, verdict: judged.verdict, reason: judged.reason, action: "escalate" }) + "\n");
      } catch { /* ledger never blocks */ }
    } else {
      receipt.result = "unknown-action (escalated honestly)";
      receipt.action = "escalate";
    }
  } catch (e) {
    receipt.result = `error:${String(e?.message ?? e).slice(0, 60)}`; // never throw, never fake
  }
  /* readback — the immediate re-probe, ALWAYS after an executed repair
   * (readbackRequired: true is the law for EVERY action, escalate included) */
  {
    const again = await probeOne(readbackTarget, { fetchImpl, now: new Date(Date.parse(now) + 1).toISOString(), stateDir, token, timeoutMs: ctx.timeoutMs });
    const after = judgeSurface(readbackTarget, again, now);
    receipt.readback = after.verdict === "OK" ? "MATCH" : "MISMATCH";
    receipt.detail.readbackVerdict = after.verdict;
    receipt.detail.readbackReason = after.reason;
    if (plan.action === "retrigger-pages" && receipt.readback === "MISMATCH") receipt.detail.note = "pages-build-pending (content commit landed; deploy completes in minutes — next beat verifies)";
    if (plan.action === "regen-state" && receipt.readback === "MISMATCH") receipt.detail.note = "generator-dispatched (freshness lands on the next generator run — next beat verifies)";
    if (plan.action === "redispatch" && receipt.readback === "MISMATCH") receipt.detail.note = "run-queued (the old failed run is the newest until the dispatch lands — next beat verifies)";
  }
  return receipt;
}

/* ── heartbeat step body (ci-cycle "surface-watch"): fire probes
 * concurrently (SWR — never block on a slow target) → judge → aggregate →
 * plan repairs → execute ONLY when act-armed (previous sealed verdict
 * non-OK) → seal the doc. NEVER THROWS — exit-0 by design. ──────────────── */
export async function runSurfaceWatch(opts = {}) {
  const stateDir = opts.stateDir ?? process.env.SAOS_STATE_DIR ?? path.join(DIR, "state");
  const now = opts.now ?? new Date().toISOString();
  const fetchImpl = opts.fetchImpl ?? null; // selftest seam; production = global fetch
  const timeoutMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : PROBE_TIMEOUT_MS;
  /* exec37 37-a R355-wiring: triageGate is the OPT-IN advisory wiring flag —
   * the CI heartbeat passes triageGate:true; with the flag ABSENT the whole
   * gate is neutral and legacy behavior is byte-preserved (section 43). */
  const triageOn = opts.triageGate === true;
  try {
    const targets = Array.isArray(opts.targets) && opts.targets.length ? opts.targets : probeTargets(now);
    const token = opts.token ?? ghToken();

    /* (a) the act gate — fail-closed: repairs execute ONLY when the previous
     * sealed verdict was non-OK. Default (observe) plans but never executes. */
    const prevSealed = readJsonSafe(path.join(stateDir, "surface-watch-latest.json"), null);
    const prevVerdict = opts.prevVerdict ?? prevSealed?.verdict ?? null;
    const actArmed = opts.repairMode === "act" &&
      typeof prevVerdict === "string" && prevVerdict.startsWith("SURFACES-") && prevVerdict !== "SURFACES-OK";

    /* (b) SWR: all probes in flight at once, each individually capped */
    const observed = await Promise.all(
      targets.map((t) => withTimeout(probeOne(t, { fetchImpl, now, stateDir, token, timeoutMs }), timeoutMs, t.id)),
    );

    /* (c) judge + aggregate */
    const judged = targets.map((t, i) => ({ ...judgeSurface(t, observed[i], now), target: t }));
    const down = judged.filter((j) => j.verdict === "DOWN").length;
    const degraded = judged.filter((j) => j.verdict === "DEGRADED").length;
    const okN = judged.length - down - degraded;
    const verdict = down > 0 ? "SURFACES-DOWN" : degraded > 0 ? "SURFACES-DEGRADED" : "SURFACES-OK";

    /* (d) plan repairs (ALWAYS planned — observe records the lawful plan) */
    const plans = judged
      .filter((j) => j.verdict !== "OK")
      .map((j) => ({ targetId: j.target.id, verdict: j.verdict, ...planRepair(j) }))
      .filter((p) => p.action);

    /* (e) execute repairs ONLY when act-armed (the autonomous self-heal).
     * exec37 37-a R355-wiring: when triageOn, every planned repair first
     * passes the R355 triage as an ADVISORY gate (brain before hands):
     *   ENVIRONMENT → NO auto-repair; escalation recorded (jsonl + doc); the
     *     surface STAYS in the report — the denominator never changes;
     *   CODE        → the existing lawful-repair path, unchanged;
     *   AMBIGUOUS (incl. triage-throw → fail-closed) → observe-only this
     *     beat: no execution, no auto-retry, basis recorded.
     * plans[] (repairsPlanned) keeps EVERY non-OK surface's lawful plan —
     * a gated-out surface is never dropped from the report. */
    const repairs = [];
    const readbackById = {};
    const triageGate = [];
    if (actArmed) {
      for (const p of plans.slice(0, MAX_REPAIRS_PER_BEAT)) {
        const j = judged.find((x) => x.target.id === p.targetId);
        if (triageOn) {
          const adv = triageAdvisory(j);
          const entry = { id: p.targetId, verdict: j?.verdict ?? null, class: adv.class, confidence: adv.confidence, basis: adv.basis, advisedAction: adv.advisedAction };
          if (adv.class === "ENVIRONMENT") {
            entry.gate = "escalation-blocked (no auto-repair this beat)";
            triageGate.push(entry);
            /* record the escalation — same ledger as the escalate executor,
             * minus any probe: the gate WITHHELD the hands, nothing executed */
            try {
              fs.mkdirSync(stateDir, { recursive: true });
              fs.appendFileSync(path.join(stateDir, "surface-escalations.jsonl"), JSON.stringify({ at: now, id: p.targetId, verdict: j?.verdict ?? null, reason: j?.reason ?? null, action: "escalate", triage: "ENVIRONMENT", basis: adv.basis }) + "\n");
            } catch { /* ledger never blocks */ }
            continue;
          }
          if (adv.class === "AMBIGUOUS") {
            entry.gate = "observe-only (no auto-retry this beat)";
            triageGate.push(entry);
            continue;
          }
          entry.gate = "proceed (lawful-repair-candidate)";
          triageGate.push(entry);
        }
        const receipt = await executeRepair({ action: p.action, repo: p.repo, workflow: p.workflow, path: p.path }, j, { fetchImpl, now, stateDir, token, timeoutMs });
        repairs.push(receipt);
        readbackById[p.targetId] = receipt.readback;
      }
    }

    /* (f) seal the doc (git-as-memory; rides the state-churn commits) */
    const doc = {
      at: now,
      head: headSha(),
      verdict,
      repairMode: actArmed ? "act" : (opts.repairMode === "act" ? "act-gated-off (prev verdict OK/absent)" : "observe"),
      actArmed,
      prevVerdict,
      lawSource: "exec33 owner directive: sovereignty self-verifies and self-repairs WITHOUT owner arming; repairs are infrastructure/state-only — zero chain broadcasts, zero keys, zero value moves (R330/R333 untouched, standby untouched)",
      targets: judged.map((j) => ({
        id: j.target.id, kind: j.target.kind, source: j.target.source,
        verdict: j.verdict, reason: j.reason, ...(Number.isFinite(j.ageMinutes) ? { ageMinutes: j.ageMinutes } : {}),
        ...(readbackById[j.target.id] ? { readback: readbackById[j.target.id] } : {}),
      })),
      repairsPlanned: plans,
      repairs,
      /* exec37 37-a R355-wiring: the advisory triage ledger of THIS beat —
       * present ONLY when the gate ran (triageGate:true + act-armed); in
       * observe/OK beats the sealed doc stays byte-compatible. */
      ...(triageOn && actArmed && triageGate.length ? { triageGate } : {}),
    };
    const docSigned = { ...doc, signature: signWatchDoc(doc) };
    let fileWritten = false;
    try {
      fs.mkdirSync(stateDir, { recursive: true });
      writeAtomic(path.join(stateDir, "surface-watch-latest.json"), docSigned);
      fileWritten = true;
    } catch { /* read-only worktree → honest fileWritten:false */ }

    /* (g) heartbeat receipt — the registered keys, nothing invented */
    return {
      surfaceWatch: verdict,
      surfaceTargets: judged.length,
      surfaceOK: okN,
      surfaceDegraded: degraded,
      surfaceDown: down,
      surfaceRepairs: repairs.length,
      surfaceSig: docSigned.signature,
      at: now,
      repairMode: doc.repairMode,
      actArmed,
      fileWritten,
      /* exec37 37-a: present only when the R355 gate was wired on */
      ...(triageOn ? { triageGate } : {}),
    };
  } catch (e) {
    /* never throws — an error is a verdict, not a wedge */
    return {
      surfaceWatch: "SURFACES-ERROR",
      surfaceTargets: null,
      surfaceOK: null,
      surfaceDegraded: null,
      surfaceDown: null,
      surfaceRepairs: 0,
      surfaceSig: null,
      at: now,
      repairMode: "observe",
      actArmed: false,
      fileWritten: false,
      error: String(e?.message ?? e).slice(0, 160),
    };
  }
}
