/**
 * content-swarm.mjs — R336 · THE SWARM DISTRIBUTION PLANNER (the last open
 * integration module of the T-83 reference batch: Marketing-Swarm-Template's
 * agents.yaml — platform-specialized agents with rigid frames — made
 * sovereignty-native).
 *
 * THE MEASURED GAP (2026-10-14, engine state, not vibes):
 *   ONE drafts queue (content-ops.json) feeds TWO live rails that pick
 *   INDEPENDENTLY — steem (army-social.doPublish: persona-match, then FIFO
 *   adoption) and hive (runHiveRail → pickPersonaFitDraft: affinity, then
 *   brevity). A draft's destination today = WHOEVER GRABS IT FIRST. Hive
 *   marks the row published + chain:"hive" at consumption (the cheetah/
 *   re-post law), so the same ROW never double-posts — but that is
 *   consumption-order luck, not distribution doctrine. R300's multi-
 *   interface independence deserves a planned spatial distribution.
 *
 *   AND: every uniqueness veto in the house is CHAIN-LOCAL and WINDOWED —
 *   steem monoculture (queue window 20), R277 body-clash (2-day said-ledger,
 *   steem), hive monoculture (12 recent), hive spamgate ownRecentBodies
 *   (per account). The R297 lesson ("the chain forgets nothing; shallow
 *   windows skip duplicates beyond the window") is UNMEASURED ACROSS
 *   CHAINS: two sibling drafts (e.g. shortlist variants grounded on the
 *   same topic) can legally land on steem AND hive. The fleet-ledger is
 *   steem-nodes-only — hive bodies are invisible to it.
 *
 * THE LAWS (observe-only first wave, the R304 precedent):
 *   1. ASSIGNMENT precedence, deterministic: an explicit d.front pin wins
 *      (a pin is the owner's voice — never overridden, conflicts reported);
 *      else persona ∈ hive roster → hive (the persona's own native voice);
 *      else steem (the default front — every persona lives on steem).
 *   2. ANTI-TWIN AT PLAN LEVEL: two drafted rows with title similarity
 *      ≥0.5 must not map to the same front — the later row (draftedAt,
 *      tie: id) flips to the other front. Pinned rows are respected; a
 *      pin collision is REPORTED, never silently resolved.
 *   3. CROSS-CHAIN TWIN SCAN (the honest first measurement): every
 *      published row carries chain (hive sets it; the steem rail never
 *      does — null/steem ⇒ "steem" by documented convention). Pairs on
 *      DIFFERENT chains with title sim ≥0.5 (kind "title") or body-core
 *      sim ≥0.5 on the R277-normalized 300-char core (kind "body") are
 *      recorded. Honest zeros count. Same-chain pairs are counted
 *      separately — the per-chain vetoes own those.
 *      MEASURED LIMITATION (named, not hidden): the R303 memory book
 *      carries titleNorm+shingles only — no body, no chain — so book rows
 *      are counted chainUnknown and excluded from cross-chain pairs. The
 *      queue's published rows (full title/body/chain) are the measurable
 *      set. Extending recordPublished with chain is a rail-side change,
 *      queued for the enforce wave — not smuggled in here.
 *   4. SIGNATURE: sha256 over canonical JSON of the plan WITHOUT the `at`
 *      stamp (the T-88 signing-contract law), 8 hex, "sig:" prefix.
 *   5. OBSERVE-ONLY: this module writes state/swarm-plan-latest.json and
 *      NOTHING else. It never touches the queue, never gates a rail, and
 *      holds no authority over any publish path — spamgate / R297 /
 *      R301 / R302 keep every gate. Future consumption arms ONLY through
 *      the signed DNA knob memory.swarmEnforce (the R307 pattern),
 *      default false — the rails consult the plan at pick time only when
 *      the owner's DNA says so.
 *   6. PURE CORE: planSwarm takes no clock, no randomness, no network, no
 *      fs. All inputs are parameters. runSwarm is the only IO wrapper
 *      (the runDrift shape). Fail-honest everywhere: a read failure is a
 *      SWARM-DEGRADED receipt, never a broken heartbeat (anti-R312 — the
 *      step lives in the heartbeat, fail-isolated like every step).
 */

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { titleSimilarity } from "./content.mjs";
import { stableStringify } from "./content-drift.mjs";
import { normTitle } from "./content-memory.mjs"; /* R337: the book's own title normalizer — the dedupe key speaks the book's language (pure string fn, no IO at import) */

export const TWIN_THRESHOLD = 0.5; /* the house number: replyFresh maxSimilarity, monoculture veto, R277 body-clash */

/* ── helpers (pure) ─────────────────────────────────────────────────────── */
const normChain = (c) => (String(c ?? "").toLowerCase() === "hive" ? "hive" : "steem");

/* ── THE PURE CORE ──────────────────────────────────────────────────────────
 * queue:   content-ops rows (drafted + published)
 * memory:  { published: [...] } — R303 book (chainUnknown rows, counted)
 * hiveRoster / steemRoster: account-id arrays
 * publishedRows: [{id, chain, title, bodyCore}] — built by runSwarm
 * (bodyCore pre-normalized by army-social's normalizeBodyForClash, so the
 *  core never imports the rail module). */
export function planSwarm({ queue = [], memory = null, hiveRoster = [], steemRoster = [], publishedRows = [] } = {}) {
  const hive = new Set((hiveRoster ?? []).map(String));
  const steem = new Set((steemRoster ?? []).map(String));
  const drafted = (queue ?? []).filter((d) => d?.status === "drafted" && d?.title);

  /* 1+2 · assignment with anti-twin splits.
   * Rows are processed in queue order; each conflicts at most once with an
   * already-placed sibling:
   *   · current row pinned  → the PIN holds (the owner's voice); the
   *     conflicting placed row flips instead if it is not pinned, else the
   *     collision is REPORTED (never silently resolved);
   *   · current row movable → it flips to the other front; ONE flip per row
   *     (two fronts): if it still conflicts there, that is the pigeonhole
   *     residue (three mutually-similar siblings on two fronts MUST leave a
   *     pair somewhere) — recorded honestly as an unresolved split row,
   *     never looped, never lied about. */
  const assignments = [];
  const splits = [];
  const pinnedConflicts = [];
  const unresolved = [];
  const twinOn = (front, title, exceptId) =>
    assignments.find((a) => a.front === front && a.id !== exceptId && titleSimilarity(a.title, title) >= TWIN_THRESHOLD);

  for (const d of drafted) {
    const pin = d.front === "hive" || d.front === "steem" ? String(d.front) : null;
    const persona = d.persona ?? d.voice ?? null;
    let front, basis;
    if (pin) { front = pin; basis = "pinned"; }
    else if (persona && hive.has(String(persona))) { front = "hive"; basis = "persona"; }
    else { front = "steem"; basis = persona && steem.has(String(persona)) ? "persona" : "default"; }

    const id = String(d.id ?? "");
    const twin = twinOn(front, String(d.title), id);
    if (twin) {
      if (basis === "pinned") {
        /* the pin holds; move the placed row if it is movable */
        if (twin.basis !== "pinned") {
          twin.front = front === "steem" ? "hive" : "steem";
          twin.basis = "anti-twin-split";
          splits.push({ ids: [twin.id, id], basis: "anti-twin", flipped: twin.id });
        } else {
          pinnedConflicts.push({ ids: [twin.id, id], detail: `pinned ${front} rows share title ≥${TWIN_THRESHOLD}` });
        }
      } else {
        front = front === "steem" ? "hive" : "steem";
        splits.push({ ids: [twin.id, id], basis: "anti-twin", flipped: id });
        /* one flip per row — the pigeonhole residue is named, not looped */
        if (twinOn(front, String(d.title), id)) {
          unresolved.push({ ids: [twinOn(front, String(d.title), id).id, id], detail: "pigeonhole: mutually-similar siblings exceed two fronts; one pair shares a front (measured residue)" });
        }
      }
    }
    assignments.push({ id, title: String(d.title), persona: persona ?? null, front, basis, draftedAt: d.draftedAt ?? null });
  }

  const stats = {
    drafts: drafted.length,
    steem: assignments.filter((a) => a.front === "steem").length,
    hive: assignments.filter((a) => a.front === "hive").length,
    pinned: assignments.filter((a) => a.basis === "pinned").length,
    splits: splits.length,
    pinnedConflicts: pinnedConflicts.length,
    unresolved: unresolved.length,
    publishedScanned: publishedRows.length,
    chainsMeasured: [...new Set(publishedRows.map((p) => normChain(p.chain)))].sort(),
  };

  /* 3 · the cross-chain twin scan (honest zeros count) */
  const twins = [];
  let sameChainTwins = 0;
  const seen = new Set(); /* permlink||id dedupe — the same post once */
  const rows = [];
  for (const p of publishedRows ?? []) {
    const key = String(p.id ?? "") || String(p.title ?? "");
    if (seen.has(key)) continue;
    seen.add(key);
    if (p?.title || p?.bodyCore) rows.push({ id: key, chain: normChain(p.chain), title: String(p.title ?? ""), bodyCore: String(p.bodyCore ?? "") });
  }
  /* R337 · THE BOOK JOINS THE SCAN WHERE IT CAN SPEAK THE TRUTH: R303 rows
   * recorded WITH chain (the R337 rails record it now — steem at publish,
   * hive at pickup+broadcast, chain rides in the record id) contribute
   * TITLE-kind pairs — titleNorm is present; body is not, and is never
   * faked. Legacy chainless rows stay chainUnknown, excluded: the
   * limitation SHRINKS as the book regrows, named every beat. A book row is
   * skipped when a queue row already speaks for the same chain+title (the
   * queue row is higher fidelity — no double-count, no phantom self-twin). */
  let bookChained = 0;
  if (Array.isArray(memory?.published)) {
    const qKeys = new Set(rows.map((r) => `${r.chain}::${normTitle(r.title)}`));
    for (const b of memory.published) {
      if (!b?.chain || !b?.titleNorm) continue; /* legacy chainUnknown — never faked into a chain */
      const chain = normChain(b.chain);
      const t = normTitle(b.titleNorm);
      if (qKeys.has(`${chain}::${t}`)) continue;
      rows.push({ id: String(b.id ?? `${chain}::${t}`), chain, title: t, bodyCore: "" });
      bookChained++;
    }
  }
  stats.bookChainedRows = bookChained;
  stats.scannedRows = rows.length; /* R337: queue rows + book rows that spoke */
  stats.chainsMeasured = [...new Set(rows.map((r) => r.chain))].sort();
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i], b = rows[j];
      if (a.chain === b.chain) {
        if (titleSimilarity(a.title, b.title) >= TWIN_THRESHOLD || (a.bodyCore && b.bodyCore && titleSimilarity(a.bodyCore, b.bodyCore) >= TWIN_THRESHOLD)) sameChainTwins++;
        continue;
      }
      let kind = null, sim = 0;
      const t = titleSimilarity(a.title, b.title);
      if (t >= TWIN_THRESHOLD) { kind = "title"; sim = t; }
      else if (a.bodyCore && b.bodyCore) {
        const s = titleSimilarity(a.bodyCore, b.bodyCore);
        if (s >= TWIN_THRESHOLD) { kind = "body"; sim = s; }
      }
      if (kind) twins.push({ aId: a.id, bId: b.id, aChain: a.chain, bChain: b.chain, kind, sim: Number(sim.toFixed(3)) });
    }
  }
  twins.sort((x, y) => y.sim - x.sim || String(x.aId).localeCompare(String(y.aId)));
  stats.crossChainTwins = twins.length;
  stats.sameChainTwins = sameChainTwins;

  const memoryRows = (memory?.published ?? []).length;

  const plan = {
    verdict: drafted.length ? "SWARM-PLANNED" : "SWARM-EMPTY",
    assignments,
    splits,
    pinnedConflicts,
    unresolved,
    twins: twins.slice(0, 20),
    stats: { ...stats, memoryRows, chainUnknownNote: "R337 rails record chain (steem at publish, hive at pickup+broadcast; chain rides in the record id) — book rows WITH chain join the title-kind scan; legacy chainless rows stay chainUnknown, excluded (the limitation shrinks as the book regrows)" },
    law: "assignment: pinned > persona-in-hive-roster > steem-default; anti-twin splits ≥0.5 title; cross-chain twin scan over published rows (null chain ⇒ steem) + R303 book rows that carry chain (R337); OBSERVE-ONLY — consumption arms only via signed DNA memory.swarmEnforce (default false); spamgate/R297/R301/R302 keep every gate",
    ownerGated: true,
  };
  plan.signature = "sig:" + createHash("sha256").update(stableStringify(plan)).digest("hex").slice(0, 8);
  return plan;
}

/* ── THE IO WRAPPER (runDrift shape) ───────────────────────────────────────
 * stateDir resolution: explicit param first (the R275 call-time law — the
 * selftest isolates by passing its tmp dir), then SAOS_STATE_DIR, then the
 * engine's own state dir. */
export async function runSwarm({ stateDir, now } = {}) {
  const S = stateDir || process.env.SAOS_STATE_DIR || path.join(path.dirname(new URL(import.meta.url).pathname), "state");
  const file = path.join(S, "swarm-plan-latest.json");
  const seal = (plan) => {
    try { fs.mkdirSync(S, { recursive: true }); const t = `${file}.tmp.${process.pid}`; fs.writeFileSync(t, JSON.stringify({ at: now ?? null, ...plan }, null, 2)); fs.renameSync(t, file); } catch { /* best-effort, never blocks */ }
    return file;
  };
  try {
    const ops = JSON.parse(fs.readFileSync(path.join(S, "content-ops.json"), "utf8"));
    const queue = Array.isArray(ops?.queue) ? ops.queue : [];
    /* published rows: full fidelity from the queue (title/body/chain) */
    const publishedRows = queue
      .filter((d) => d?.status === "published")
      .map((d) => ({ id: d.permlink ?? d.id ?? null, chain: d.chain ?? null, title: String(d.title ?? ""), body: d.body ?? null }));
    /* body cores: the R277 normalizer, lazily imported (single source of
     * truth — never copied) */
    try {
      const { normalizeBodyForClash } = await import("./army-social.mjs");
      for (const r of publishedRows) r.bodyCore = normalizeBodyForClash(r.body ?? "");
    } catch { for (const r of publishedRows) r.bodyCore = ""; /* honest: title scan still holds */ }
    /* the R303 book (titleNorm+shingles only — chainUnknown, counted) */
    let memory = null;
    try { const { loadMemory } = await import("./content-memory.mjs"); memory = loadMemory(S); } catch { /* honest */ }
    /* rosters: each front's own list (lazy, the format-lint precedent) */
    const [{ HIVE_ROSTER }, { PERSONA_IDS }] = await Promise.all([import("./hive.mjs"), import("./personas.mjs")]);
    const plan = planSwarm({ queue, memory, hiveRoster: HIVE_ROSTER, steemRoster: PERSONA_IDS, publishedRows });
    seal(plan);
    return { ...plan, file };
  } catch (e) {
    const degraded = {
      verdict: "SWARM-DEGRADED", error: String(e?.message ?? e).slice(0, 160),
      assignments: [], splits: [], pinnedConflicts: [], twins: [],
      stats: { drafts: 0, steem: 0, hive: 0, pinned: 0, splits: 0, pinnedConflicts: 0, unresolved: 0, publishedScanned: 0, scannedRows: null, bookChainedRows: null, crossChainTwins: null, sameChainTwins: null },
      ownerGated: true, degraded: true,
    };
    seal(degraded);
    return { ...degraded, file };
  }
}
