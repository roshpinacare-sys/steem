/**
 * council.mjs — R237 INTER-ORGAN MESH (the communication upgrade).
 *
 * The operator's verdict (R237): "there is no communication between the
 * agents" was TRUE — the engine never read its fellow organs, the builder
 * starved for tasks, and every organ learned of the others only through
 * files a human happened to read. This module makes the mesh REAL:
 *
 *   engine → organs   : every cycle, LIVE /health (+ /drift, /status) reads
 *                       with hard 2.5s timeouts — verdicts measured, never
 *                       assumed (organVerdict/meshVerdict from lib.mjs).
 *   engine → builder  : cadence-gated (1/day, only when the builder's queue
 *                       is empty) — the machine feeds its engineer organ ONE
 *                       real, evidence-backed documentation task carrying the
 *                       top measured lesson. The builder stays PROPOSAL-ONLY
 *                       (its own law); the apply gate stays deliberate.
 *   organs → engine   : responses land in state/council.json + a
 *                       council.gossip event per cycle → /status → cockpit.
 *
 * LAW: this organ holds NO keys, signs NOTHING, broadcasts NOTHING — it
 * reads and speaks; the custodian remains the sole signer/pusher.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { organVerdict, meshVerdict } from "./lib.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const STATE = path.join(DIR, "state");
const COUNCIL_FILE = path.join(STATE, "council.json");

const ORGANS = [
  { id: "custodian", port: 3041, law: "persistence + git custody · FF-only · sole pusher", routes: ["/health", "/drift"] },
  { id: "metrics", port: 3042, law: "single-writer sqlite series · read-only over engine state", routes: ["/health"] },
  { id: "builder", port: 3043, law: "proposal-only · keyless · never edits the live tree", routes: ["/health", "/status"] },
];

const FETCH_MS = 2500;

async function readOrgan(organ, now) {
  const base = `http://127.0.0.1:${organ.port}`;
  const out = { ...organ, ok: false, verdict: "DOWN", ageMs: null, evidence: {}, at: now };
  try {
    const r = await fetch(`${base}/health`, { signal: AbortSignal.timeout(FETCH_MS) });
    if (!r.ok) { out.verdict = "DOWN"; out.error = `health HTTP ${r.status}`; return out; }
    const j = await r.json();
    out.ok = j?.ok === true;
    /* R237 liveness law: age = time since the organ's last ACTIVITY
     * (custodian last tick, metrics last snapshot) — never since boot
     * (a long-lived healthy organ is not stale). An organ with no
     * activity field is judged by the fetch itself → age=null → ALIVE. */
    const lastAct = j?.last?.at ?? j?.lastAt ?? null;
    out.evidence.health = { ticks: j?.ticks ?? null, last: lastAct ?? j?.bootedAt ?? j?.at ?? null, tickMs: j?.tickMs ?? null };
    if (lastAct) {
      const a = Date.parse(lastAct);
      if (Number.isFinite(a)) out.ageMs = Math.max(0, Date.now() - a);
    }
    out.verdict = organVerdict({ ok: out.ok, ageMs: out.ageMs });
    for (const route of organ.routes.slice(1)) {
      try {
        const r2 = await fetch(`${base}${route}`, { signal: AbortSignal.timeout(FETCH_MS) });
        if (!r2.ok) continue;
        const j2 = await r2.json();
        if (route === "/drift") {
          out.evidence.drift = { drift: j2?.drift ?? null, dirtyNow: j2?.dirtyNow ?? null, lastPushedSha: j2?.lastPushedSha ? String(j2.lastPushedSha).slice(0, 8) : null, pushedAt: j2?.pushedAt ?? null };
        } else if (route === "/status") {
          out.evidence.builder = {
            queue: j2?.tasks?.filter?.((t) => t?.status === "queued").length ?? null,
            proposals: Array.isArray(j2?.proposals) ? j2.proposals.length : null,
            newest: j2?.proposals?.[0] ? { id: j2.proposals[0].id, status: j2.proposals[0].status, file: j2.proposals[0].file } : null,
          };
        }
      } catch { /* route read failed — organ still judged by health */ }
    }
    return out;
  } catch (e) {
    out.verdict = "DOWN";
    out.error = String(e?.message ?? e).slice(0, 120);
    return out;
  }
}

export function councilState() {
  try { return JSON.parse(fs.readFileSync(COUNCIL_FILE, "utf8")); } catch { return null; }
}

/**
 * One council session. `builderTask` (optional {file, task, basis}) is the
 * engine→builder work order — posted ONLY when the builder's queue is empty
 * and the daily cadence allows (caller supplies the gate result).
 */
export async function runCouncil({ now = new Date().toISOString(), persist = true, builderTask = null } = {}) {
  const organs = [];
  for (const organ of ORGANS) organs.push(await readOrgan(organ, now));
  const mesh = meshVerdict(organs);
  /* R237 cadence law: the LAST work-order stays on record (the 1/day gate in
   * daily.mjs reads it) — a quiet session never erases the previous one. */
  const prev = persist ? councilState() : null;
  const out = { at: now, mesh, organs, builderTask: builderTask ? null : (prev?.builderTask ?? null) };

  if (builderTask && builderTask.file && builderTask.task) {
    const bt = {
      at: now,
      file: String(builderTask.file).slice(0, 200),
      task: String(builderTask.task).slice(0, 400),
      basis: String(builderTask.basis ?? "measured lesson").slice(0, 200),
      verdict: null,
      error: null,
    };
    try {
      const r = await fetch("http://127.0.0.1:3043/task", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ file: bt.file, task: bt.task }),
        signal: AbortSignal.timeout(FETCH_MS),
      });
      const j = await r.json().catch(() => null);
      bt.verdict = r.ok && j?.ok ? "QUEUED" : `REJECTED(${r.status})`;
      bt.error = j?.error ?? null;
    } catch (e) {
      bt.verdict = "UNREACHABLE";
      bt.error = String(e?.message ?? e).slice(0, 120);
    }
    out.builderTask = bt;
  }

  if (persist) {
    try {
      const tmp = COUNCIL_FILE + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(out) + "\n");
      fs.renameSync(tmp, COUNCIL_FILE); /* R235 atomic-write law */
    } catch { /* best-effort — council never blocks the cycle */ }
  }
  return out;
}
