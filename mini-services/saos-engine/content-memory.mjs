/**
 * content-memory.mjs — R303 · GIT-AS-MEMORY LEARNING LOOP (T-83, trace 1a138763fa0a8fe9)
 *
 * Owner order 2026-10-14: "אין הצטיידות שלי תצטרך לבצע את זה בעצמך לאטום ולתעד
 * לריבונות האוטונומית שלא יאבד בסנדבוקס שלך בשום פנים ואופן בצע וודא את זה" —
 * nothing may live only in an agent's session. This module is the content
 * organ's long-term memory, and it lives in GIT:
 *
 *   seed (committed, hand-readable)   → memory-seed/{published.jsonl,rejected.jsonl,HEARTBEAT.md}
 *   runtime (state churn, committed)  → $SAOS_STATE_DIR/content-memory/{published.jsonl,rejected.jsonl}
 *
 * The R297 diagnosis measured the structural hole: every existing veto saw
 * SHALLOW memory that zeroed with a sandbox rotation — the chain doesn't.
 * fleet-ledger.mjs fixed uniqueness against chain truth; THIS module fixes
 * learning: what we published, what the gates refused and WHY, aggregated
 * weekly (market-ldr pattern: winning-patterns / rejected / MEMORY.md /
 * HEARTBEAT.md — bot-written, git-persisted, survives every sandbox death).
 *
 * LAWS:
 *  - pure where possible; every write resolves against `stateDir` (R275
 *    isolation: the selftest runs while the live engine flushes the same files)
 *  - deterministic ids (sha1 of law key) — no clock/random in identity
 *  - read failures → empty seed + honest verdicts; never an exception that
 *    wedges publishing (the judge treats memory-unavailable as ok:true with
 *    a `memory:degraded` reason — the hard gates spamgate/R297 still hold)
 *  - `runWeeklyMemory` is the heartbeat's step body: aggregate + render the
 *    HEARTBEAT self-audit + merge runtime memory back into the committed seed
 *    (the seal: state churn commits carry learning into git automatically).
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { shingles, jaccard } from "./spamgate.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);
/** committed seed — the sandbox-death-proof copy (bot-mergeable, hand-readable).
 *  SAOS_MEMORY_SEED_DIR (R275 family): read AT CALL TIME so the selftest can
 *  isolate it after army-social already pulled this module in transitively —
 *  module-eval-time env would bake the repo path in (measured bug class). */
export function seedDir() {
  return process.env.SAOS_MEMORY_SEED_DIR || path.join(DIR, "memory-seed");
}
/** default path, kept for docs/tooling; every read/write goes through seedDir() */
export const SEED_DIR = path.join(DIR, "memory-seed");
export const MEMORY_WINDOW_DAYS = 90;
export const MEMORY_JACCARD = 0.5;

export function memId(...parts) {
  return crypto.createHash("sha1").update(parts.join("|")).digest("hex").slice(0, 16);
}
export function normTitle(t) {
  return String(t ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 160);
}
export function memoryFiles(stateDir) {
  const dir = path.join(stateDir, "content-memory");
  return {
    dir,
    published: path.join(dir, "published.jsonl"),
    rejected: path.join(dir, "rejected.jsonl"),
    weekly: path.join(dir, "weekly.json"),
    heartbeat: path.join(dir, "HEARTBEAT.md"),
  };
}
function readJsonl(file, cap = 2000) {
  try {
    const txt = fs.readFileSync(file, "utf8");
    const out = [];
    for (const line of txt.split("\n")) {
      const s = line.trim();
      if (!s) continue;
      try { out.push(JSON.parse(s)); } catch { /* corrupt line → skip, honest */ }
      if (out.length >= cap) break;
    }
    return out;
  } catch { return []; }
}
export function readSeed(kind) {
  if (kind !== "published" && kind !== "rejected") return [];
  return readJsonl(path.join(seedDir(), `${kind}.jsonl`));
}
export function readRuntime(stateDir, kind) {
  return readJsonl(memoryFiles(stateDir)[kind]);
}
/** seed + runtime, deduped by id (seed first — commits beat transient state) */
export function mergeById(a, b) {
  const seen = new Set();
  const out = [];
  for (const rec of [...(a ?? []), ...(b ?? [])]) {
    const id = rec?.id ?? "";
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(rec);
  }
  return out;
}
export function loadMemory(stateDir) {
  return {
    published: mergeById(readSeed("published"), readRuntime(stateDir, "published")),
    rejected: mergeById(readSeed("rejected"), readRuntime(stateDir, "rejected")),
  };
}
function appendRecord(file, rec, dedupKey) {
  try {
    const existing = readJsonl(file, 5000);
    if (dedupKey && existing.some((r) => (r.id ?? "") === dedupKey)) return null;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify(rec) + "\n");
    return rec;
  } catch { return null; }
}
/** R303 · a judge veto teaches: pattern + reason land in the runtime ledger */
export function recordRejected(stateDir, { account, title, body, reason, vetoType = "judge", at }) {
  const titleNorm = normTitle(title);
  const rec = {
    id: memId("rejected", titleNorm, vetoType),
    at: at ?? new Date().toISOString(),
    account: account ?? null,
    vetoType,
    reason: String(reason ?? "").slice(0, 300),
    titleNorm,
    sh: [...shingles(body ?? title, 3)].slice(0, 40),
  };
  return appendRecord(memoryFiles(stateDir).rejected, rec, rec.id);
}
/** R303 · a broadcast becomes a memory pattern with its quality observation.
 *  R337 · `chain` records WHICH FRONT the broadcast landed on — the truth
 *  field the cross-chain twin scan (R336) was denied ("hive bodies invisible"
 *  was an accident of wiring, not doctrine). Absent chain = legacy row =
 *  chainUnknown, still counted, never faked into a chain. */
export function recordPublished(stateDir, { account, permlink, title, body, score = null, chain = null, at }) {
  const titleNorm = normTitle(title);
  const rec = {
    /* R337 · chain RIDES IN THE ID: appendRecord dedupes by id, so without it
     * the same title published on steem AND hive by the same account would
     * silently drop the second record — the exact invisibility R337 closes,
     * reborn one level down. Same title + same chain still dedupes (the
     * re-record is idempotent); legacy rows (chain null → "") keep their ids. */
    id: memId("published", titleNorm, account ?? "", chain ?? ""),
    at: at ?? new Date().toISOString(),
    account: account ?? null,
    permlink: permlink ?? null,
    chain: chain ?? null,
    titleNorm,
    score,
    sh: [...shingles(body ?? title, 3)].slice(0, 40),
  };
  return appendRecord(memoryFiles(stateDir).published, rec, rec.id);
}
/** fail-closed memory veto: a title the fleet already REJECTED (same verdict)
 *  or a body ≥ jaccard law vs a rejected pattern → refuse. window = 90d. */
export function memoryPenalty(memory, { title, body }, opts = {}) {
  const windowDays = opts.windowDays ?? MEMORY_WINDOW_DAYS;
  const j = opts.jaccard ?? MEMORY_JACCARD;
  const now = opts.now ? Date.parse(opts.now) : Date.now();
  const tn = normTitle(title);
  const sh = shingles(body ?? title, 3);
  const reasons = [];
  const against = [];
  for (const r of memory?.rejected ?? []) {
    const age = Number.isFinite(Date.parse(r.at)) ? (now - Date.parse(r.at)) / 86400000 : 0;
    if (age < 0 || age > windowDays) continue;
    if (tn && r.titleNorm === tn) { reasons.push(`memory:title-rejected:${(r.reason ?? "").slice(0, 60)}`); against.push(r.id); continue; }
    if (sh.size && Array.isArray(r.sh) && r.sh.length && jaccard(sh, new Set(r.sh)) >= j) {
      reasons.push(`memory:body-rejected(j≥${j}):${(r.reason ?? "").slice(0, 60)}`);
      against.push(r.id);
    }
  }
  return { ok: reasons.length === 0, reasons, against: against.slice(0, 5) };
}
/** observe-only: best similarity vs PUBLISHED patterns (the seed of the
 *  winning-patterns book — enforcement waits for engagement feedback) */
export function winBoost(memory, { title, body }, opts = {}) {
  const j = opts.jaccard ?? MEMORY_JACCARD;
  const sh = shingles(body ?? title, 3);
  let best = { score: 0, match: null };
  for (const r of memory?.published ?? []) {
    if (!Array.isArray(r.sh) || !r.sh.length) continue;
    const s = jaccard(sh, new Set(r.sh));
    if (s > best.score) best = { score: s, match: r.id, scoreObserved: r.score ?? null };
  }
  return { ...best, matched: best.score >= j };
}
/** taxonomy from the learning ledgers — the weekly aggregate (MEMORY.md analog) */
export function weeklyAggregate(memory, { now } = {}) {
  const agg = { published: 0, vetoed: {}, scoreSum: 0, scoreN: 0, topReasons: {} };
  for (const r of memory?.published ?? []) {
    agg.published++;
    if (typeof r.score === "number") { agg.scoreSum += r.score; agg.scoreN++; }
  }
  for (const r of memory?.rejected ?? []) {
    const k = r.vetoType ?? "unknown";
    agg.vetoed[k] = (agg.vetoed[k] ?? 0) + 1;
    const rk = String(r.reason ?? "").split(":")[0].slice(0, 40) || "unknown";
    agg.topReasons[rk] = (agg.topReasons[rk] ?? 0) + 1;
  }
  agg.scoreMean = agg.scoreN ? Math.round((agg.scoreSum / agg.scoreN) * 10) / 10 : null;
  agg.windowDays = MEMORY_WINDOW_DAYS;
  agg.generatedAt = now ?? new Date().toISOString();
  return agg;
}
/** market-ldr HEARTBEAT pattern: start-of-session self-audit, bot-written */
export function renderHeartbeat(memory, agg, { now } = {}) {
  const top = Object.entries(agg.topReasons ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([k, v]) => `- ${k}: ${v}`).join("\n") || "- (none yet)";
  const vetoes = Object.entries(agg.vetoed ?? {}).sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}=${v}`).join(" ") || "none";
  return [
    `# CONTENT MEMORY — HEARTBEAT SELF-AUDIT`,
    ``,
    `- generated: ${agg.generatedAt ?? now ?? new Date().toISOString()} (R303, git-as-memory)`,
    `- published patterns: ${(memory?.published ?? []).length} (scoreMean=${agg.scoreMean ?? "n/a"})`,
    `- rejected patterns: ${(memory?.rejected ?? []).length} (${vetoes})`,
    ``,
    `## top refusal reasons (window ${MEMORY_WINDOW_DAYS}d)`,
    top,
    ``,
    `## what this memory owes the next session`,
    `- every judge veto lands in rejected.jsonl BEFORE the next draft is graded (memoryPenalty ≥ ${MEMORY_JACCARD})`,
    `- every broadcast lands in published.jsonl with its quality score (observe; enforcement waits for engagement feedback)`,
    `- the weekly step merges runtime memory into memory-seed/ — sandbox deaths lose nothing`,
    ``,
  ].join("\n");
}
/** heartbeat step body (ci-cycle "content-memory"): aggregate → weekly.json +
 *  HEARTBEAT.md in state (rides state-churn commits) + merge runtime → seed
 *  (best-effort; CI worktrees are writable, sandbox tmp dirs are not the truth) */
export async function runWeeklyMemory({ stateDir, now } = {}) {
  const at = now ?? new Date().toISOString();
  const memory = loadMemory(stateDir);
  const agg = weeklyAggregate(memory, { now: at });
  const md = renderHeartbeat(memory, agg, { now: at });
  const files = memoryFiles(stateDir);
  fs.mkdirSync(files.dir, { recursive: true });
  fs.writeFileSync(files.weekly, JSON.stringify(agg, null, 2));
  fs.writeFileSync(files.heartbeat, md);
  let seedMerged = false;
  try {
    for (const kind of ["published", "rejected"]) {
      const runtime = readRuntime(stateDir, kind);
      if (!runtime.length) continue;
      const merged = mergeById(readSeed(kind), runtime);
      const seedFile = path.join(seedDir(), `${kind}.jsonl`);
      fs.mkdirSync(seedDir(), { recursive: true });
      fs.writeFileSync(seedFile, merged.map((r) => JSON.stringify(r)).join("\n") + "\n");
    }
    seedMerged = true;
  } catch { /* read-only worktree → state churn still carries it; honest flag */ }
  return {
    verdict: "MEMORY-OK",
    published: (memory.published ?? []).length,
    rejected: (memory.rejected ?? []).length,
    scoreMean: agg.scoreMean,
    topReason: Object.entries(agg.topReasons ?? {}).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
    seedMerged,
  };
}
