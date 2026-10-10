/**
 * curator.mjs — the curation fuel rail (T-13): VP put to work, autonomously.
 *
 * WHY THIS RAIL: measured history shows curation paid the account's fuel
 * ($4.24/day measured window pre-2026-09-09); since then the rail sat DORMANT
 * while voting power refilled to ~99% every day — 4034 SP earning ZERO.
 * The operator ordered it implemented ("בוא ניישם אותו · קדימה ודחוף").
 *
 * HONESTY CONTRACT:
 *  - votes are judgment — so the judgment is a DETERMINISTIC, journaled
 *    policy (never hidden, never invented): fresh real content inside a
 *    tag whitelist, hard caps, VP floor, no self-votes, no bandwagon.
 *  - a vote op can NEVER move funds (posting authority only, no transfer
 *    capability) — this rail is the safest autonomous signing on the chain.
 *  - yield is not promised: curation_reward ops land in account history and
 *    the existing fuel measurement (measureAll) picks them up — measured,
 *    not claimed.
 *
 * DOCTRINE GATES (all enforced, fail-closed):
 *  - armed-conf `curate` block (signer.mjs shallow-merge: file wins over defaults)
 *  - operator kill-switch (exec-pause.json) + standing order
 *  - daily cap maxPerDay, per-author diversity cap, VP effective floor
 *  - age window (early votes earn the bigger curation share), bandwagon cap,
 *    minimum body length (anti-spam), blacklist (our own fleet)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { rpcCall, accountState } from "./measure.mjs";
import { executeAs, masterAccount, armedConf, execPaused, loadCredential } from "./signer.mjs";
import { learningTunings } from "./learning.mjs";
import { mergeVoteState, countDayVotesFromHistory } from "./lib.mjs";
import { tagRoiState, orderTagsByRoi } from "./tag-roi.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const STATE = path.join(DIR, "state");
const CUR_FILE = path.join(STATE, "curator.json");

const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const writeJson = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); const t = `${p}.tmp.${process.pid}`; fs.writeFileSync(t, JSON.stringify(v, null, 2)); fs.renameSync(t, p); }; /* R235: atomic — rename is the commit point */
const appendLine = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.appendFileSync(p, JSON.stringify(v) + "\n"); };

export function curatorPolicy() {
  return {
    enabled: true,
    maxPerDay: 30,           // R289 yield-tune (measured): 10 votes/day × ~50% = 4% VP/day vs 20% regen = 80% of the battery wasted. 30 × ~52% avg ≈ 15.6% VP/day < regen → sustainable forever; the VP floor governs the rest.
    baseWeightPct: 70,       // R289: early strong votes earn the bigger curation share (rshares share of the pool)
    minWeightPct: 35,        // R289: late-ish votes keep enough weight to matter
    minVpEffPct: 35,         // R289 measured bug: the 60% floor blocked ALL votes at vpEff 59.4% (curator.json VP-FLOOR) — the battery was never allowed to cycle below 60% = 40% of the battery permanently unusable. 35% floor + 15.6%/day burn keeps equilibrium above the floor.
    maxPerAuthorPerDay: 1,   // diversity: one vote per author per day
    ageMinMinutes: 10,       // too fresh = possibly unfinished spam
    ageMaxMinutes: 240,      // R289: 1200min (20h) votes earn ~dust — the curation share decays with every later voter; 4h window concentrates the same VP where returns live
    maxPostVotes: 100,       // T-35 MEASURED (docs/measured/t35-probe.json, 96 chain ops): SP-per-G-rshare peaks at 10–30 votes on the post (0.000416) and collapses to 0.000187 (−55%) at 150+ votes — whale-saturated posts are yield dead-zones. Cap kills the flop tail; maxPendingSbd alone can't see it early.
    minBodyChars: 600,       // real content, not micro-dust
    maxPendingSbd: 30,       // bandwagon guard — late votes on hot posts earn little
    maxVotesPerCycle: 3,     // T-85: spread the day's votes across random windows
    tags: ["steem", "crypto", "defi", "trading", "technology", "ai"],
    excludeAccounts: ["headcorner", "hcsoldier1", "hcsoldier2", "hcsoldier3", "hcsoldier4", "hcsoldier5", "hcsoldier6", "cashmachine", "haran", "israelnews", "lsa", "macrame", "siq", "tov", "wic", "wog", "woq"], // R289: full roster — the fuel rail votes OUTSIDE rising content only; fleet-support is army-social's law
  };
}

export const dayKeyOf = (iso) => String(iso ?? new Date().toISOString()).slice(0, 10);

/* weight decays linearly: baseWeight at ageMin → minWeight at ageMax */
export function weightForAge(ageMinutes, p) {
  const clamped = Math.min(Math.max(ageMinutes, p.ageMinMinutes), p.ageMaxMinutes);
  const t = (clamped - p.ageMinMinutes) / Math.max(1, p.ageMaxMinutes - p.ageMinMinutes);
  const pct = p.baseWeightPct - t * (p.baseWeightPct - p.minWeightPct);
  return Math.round(pct * 100); // steem weight units (10000 = 100%)
}

/* T-85 · EFFECTIVE-VESTS TRUTH (measured 2026-10-06): the VP gate read RAW
 * vesting_shares, so the 943,788 VESTS delegated to the (keyless) army
 * dragged the gate — vpEff showed 4.8% while the account's TRUE mana pool
 * (HF20: vests + received − delegated-out) held ~16.6% and was regenerating.
 * The battery was never empty; the METER was miscalibrated. Pure +
 * selftestable — the caller passes the chain account object. */
export function effectiveVests(acc) {
  if (!acc || typeof acc !== "object") return 0;
  const num = (s) => Number(String(s ?? "0").split(" ")[0].replace(/,/g, "")) || 0;
  return Math.max(0, num(acc.vesting_shares) + num(acc.received_vesting_shares) - num(acc.delegated_vesting_shares));
}

/* mulberry32 — tiny seeded PRNG. Determinism IS the auditability: the same
 * seed reproduces the exact schedule after the fact (state/social.json),
 * while across days/accounts the schedules scatter like natural activity. */
export function mulberry32(seed) {
  let a = Number(seed) >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* stable string hash → uint32 seed (FNV-1a) */
export function hashSeed(str) {
  let h = 0x811c9dc5;
  const s = String(str ?? "");
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

/* effective voting power from the manabar (mana units: vests × 1e6) */
export function vpEffPct(currentMana, vests) {
  if (!(vests > 0) || !(currentMana >= 0)) return null;
  const max = vests * 1e6;
  return Math.round((currentMana / max) * 1000) / 10;
}

/* THE PURE PLANNER — deterministic, selftestable, zero network.
 * posts: normalized candidates; returns selected votes + honest rejections. */
export function filterCandidates({ posts, voter, policy, nowMs, votedPermlinks = [], votesToday = 0, authorsToday = {}, jitterSeed = null }) {
  const p = policy;
  const rejected = [];
  const seenPermlinks = new Set();
  const votedSet = new Set(votedPermlinks);
  const authors = { ...authorsToday };
  /* T-85 · RANDOM-TIME SPREADING: a seeded shuffle re-orders candidates
   * before selection, and maxVotesPerCycle caps how many fire per 10-min
   * window — the day's votes land at irregular, natural-looking times
   * instead of one burst. Same seed ⇒ same plan ⇒ auditable. */
  let remaining = Math.min(
    Math.max(0, p.maxPerDay - votesToday),
    Number.isFinite(p.maxVotesPerCycle) ? Math.max(1, p.maxVotesPerCycle) : Infinity,
  );

  // deterministic order: newest first, permlink as tiebreak…
  const ordered = [...posts].sort((a, b) =>
    (b.createdMs - a.createdMs) || String(a.permlink).localeCompare(String(b.permlink)));
  // …then a SEEDED shuffle when a seed is given (natural spreading, auditable)
  if (jitterSeed != null && ordered.length > 1) {
    const rand = mulberry32(jitterSeed);
    for (let i = ordered.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
    }
  }

  const selected = [];
  for (const post of ordered) {
    const key = `${post.author}/${post.permlink}`;
    const dupList = seenPermlinks.has(key);
    if (!dupList) seenPermlinks.add(key);
    const reject = (reason) => { if (!dupList) rejected.push({ key, reason }); };

    if (dupList) { continue; } // dedup silently (same post via two tags)
    if (p.excludeAccounts.includes(post.author)) { reject("self-fleet"); continue; }
    if (post.votedByUs || votedSet.has(key)) { reject("already-voted"); continue; }
    const ageMin = (nowMs - post.createdMs) / 60000;
    if (!(ageMin >= p.ageMinMinutes)) { reject("too-young"); continue; }
    if (ageMin > p.ageMaxMinutes) { reject("too-old"); continue; }
    if ((post.bodyLen ?? 0) < p.minBodyChars) { reject("short-body"); continue; }
    /* T-35 · CROWDED-POOL LAW (measured −55% SP/rshare at 150+ votes): skip
     * whale-saturated posts; their pool slice is mathematically dust.
     * Undefined voteCount (legacy fixtures) ⇒ gate passes — additive law. */
    if (Number.isFinite(p.maxPostVotes) && (post.voteCount ?? 0) > p.maxPostVotes) { reject("crowded"); continue; }
    if (!post.title || post.title === post.title.toUpperCase() && post.title.length > 8) { reject("spam-title"); continue; }
    if ((post.pendingSbd ?? 0) > p.maxPendingSbd) { reject("bandwagon"); continue; }
    if (post.archived === true) { reject("payout-closed"); continue; }
    if ((authors[post.author] ?? 0) >= p.maxPerAuthorPerDay) { reject("author-cap"); continue; }
    if (remaining <= 0) { reject("day-cap"); continue; }

    selected.push({
      author: post.author, permlink: post.permlink,
      weight: weightForAge(ageMin, p), ageMinutes: Math.round(ageMin), tag: post.tag ?? null,
    });
    authors[post.author] = (authors[post.author] ?? 0) + 1;
    remaining -= 1;
  }
  return { selected, rejected, dayCapReached: remaining <= 0 };
}

/* normalize a raw condenser discussion → candidate (pure).
 * votedByUs comes from the ON-CHAIN active_votes (the chain is the dedup
 * source of truth — our state only covers today; the account voted posts
 * days ago that must never be re-voted: a second vote would just waste VP). */
export function normalizePost(raw, tag, voter, nowMs) {
  if (!raw?.author || !raw?.permlink) return null;
  const createdMs = raw.created ? Date.parse(raw.created.endsWith("Z") ? raw.created : raw.created + "Z") : 0;
  if (!(createdMs > 0)) return null;
  const num = (s) => Number(String(s ?? "0").split(" ")[0]) || 0;
  return {
    author: raw.author, permlink: raw.permlink, tag: tag ?? null,
    createdMs, title: String(raw.title ?? ""),
    bodyLen: String(raw.body ?? "").length,
    voteCount: (raw.active_votes ?? []).length, // T-35: competition dilution gate
    pendingSbd: num(raw.pending_payout_value),
    archived: raw.cashout_time === "1969-12-31T23:59:59" || raw.cashout_time === "1970-01-01T00:00:00",
    votedByUs: (raw.active_votes ?? []).some((v) => v?.voter === voter),
  };
}

/* fetch fresh candidate stream across the tag whitelist (fail-closed).
 * policy.fetchLimit (R290) lets rails widen the shared pool without touching
 * the curator default. */
export async function fetchCandidates(policy, voter, nowMs) {
  const posts = [];
  let nodeOk = false;
  const limit = Number.isFinite(policy.fetchLimit) ? Math.min(Math.max(policy.fetchLimit, 20), 100) : 20; /* T-62 release: ceiling 50→100 — the real bound is the RPC page size */
  for (const tag of policy.tags) {
    const r = await rpcCall("condenser_api.get_discussions_by_created", [{ tag, limit }]);
    if (!r.ok) continue;
    nodeOk = true;
    for (const raw of (r.result ?? [])) {
      const n = normalizePost(raw, tag, voter, nowMs);
      if (n) posts.push(n);
    }
  }
  return { posts, ok: nodeOk };
}

export function curatorState() { return readJson(CUR_FILE, null); }

/* ── THE EXECUTOR: plan → gates → broadcast (posting key, atomic tx) ───── */
export async function runCurator({ now = new Date().toISOString() } = {}) {
  const conf = armedConf();
  /* T-14: policy merge order = defaults → operator armed-conf → LEARNED tunings.
   * Learning acts last so it can act at all, but it can NEVER introduce keys
   * beyond its clamped set (baseWeightPct 30-60, ageMinMinutes 5-12, additive
   * tags ≤8) — operator intent and doctrine laws (VF1, VP floor, maxPerDay)
   * are untouchable by design. */
  const learned = learningTunings();
  const p = { ...curatorPolicy(), ...(conf.curate ?? {}), ...learned };
  /* R291 · measured tag-ROI ordering: the whitelist stays the universe, only
   * the ORDER follows what actually paid us (data-thin fallback = policy
   * order). Never adds tags, never touches operator intent keys. */
  const roi = tagRoiState();
  if (roi?.tags) {
    const ordered = orderTagsByRoi(p.tags, Object.values(roi.tags));
    p.tags = ordered.tags;
    p.tagsBasis = ordered.basis;
  }
  const tuningsApplied = Object.keys(learned);
  const master = masterAccount();
  const day = dayKeyOf(now);
  const nowMs = Date.parse(now);

  const prev = readJson(CUR_FILE, { day: null, votesToday: [], authorsToday: {}, totalVotes: 0, history: [] });
  let carried = prev.day === day ? prev : { votesToday: [], authorsToday: {}, totalVotes: prev.totalVotes ?? 0, history: prev.history ?? [] };

  const base = {
    enabled: p.enabled, at: now, day,
    votesTodayCount: carried.votesToday.length,
    maxPerDay: p.maxPerDay,
    tuningsApplied,
  };
  if (!p.enabled) return { ...base, verdict: "DISABLED" };
  if (execPaused()) return { ...base, verdict: "OPERATOR-PAUSED" };
  /* T-16 CRED GATE FIRST (measured rot 2026-09-30: 12.5s of candidate scanning
   * per cycle — ~144×/day of doomed network reads — BEFORE discovering the
   * typed credential absence deep inside the vote path). loadCredential()
   * throws the typed CREDENTIAL-MISSING with zero network. Same typed error
   * the daily cycle's health classifier expects — the verdict stays honest,
   * only the 12.5s of waste dies. */
  loadCredential();

  const accR = await rpcCall("condenser_api.get_accounts", [[master]]);
  const acc = accR.ok ? accR.result?.[0] : null;
  if (!acc) return { ...base, verdict: "NO-ACCOUNT-READ" };
  /* VP gate — effective mana (read-only, chain truth). T-85: the mana pool is
   * built from EFFECTIVE vests (received − delegated-out), not raw — the old
   * raw read kept the gate shut while the battery refilled (measured: 4.8%
   * shown vs ~16.6% true). */
  const vests = effectiveVests(acc);
  const mana = Number(acc.voting_manabar?.current_mana ?? "0");
  const vpEff = vpEffPct(mana, vests);
  if (vpEff == null || vpEff < p.minVpEffPct) {
    const out = { ...base, verdict: "VP-FLOOR", vpEff, minVpEffPct: p.minVpEffPct, votesTodayCount: carried.votesToday.length };
    writeJson(CUR_FILE, { ...out, votesToday: carried.votesToday, authorsToday: carried.authorsToday, totalVotes: carried.totalVotes, history: carried.history });
    return out;
  }

  /* ── T-18 CHAIN-TRUTH DAY BUDGET (the split-brain killer, measured live):
   * the state file said 18/18 while the CHAIN held 22 day votes — the second
   * signer's 3×20% votes at 14:51 were invisible to every seed window, so a
   * state-only cap gate UNDERCOUNTS the account's ONE shared VP budget.
   * The cap gate now enforces max(state, chain) — chain truth can only RAISE
   * the count, never lower it (state overcounts stay conservative).
   * One bounded history read (400 ops) per curate run — cheap gate, honest
   * law. NOTE: the gate moved AFTER the cred gate so a missing credential
   * still fast-fails with zero network (T-16 law intact). */
  let chainDayCount = null;
  try {
    const histR = await rpcCall("condenser_api.get_account_history", [master, -1, 400]);
    if (histR.ok) chainDayCount = countDayVotesFromHistory(histR.result, master, day);
  } catch { /* chain read failed → fall back to state count, verdict records it */ }
  const budgetCounted = Math.max(carried.votesToday.length, chainDayCount ?? 0);
  if (chainDayCount !== null && budgetCounted >= p.maxPerDay) {
    const out = {
      ...base, verdict: "DAY-CAP", dayCapReached: true,
      votesTodayCount: carried.votesToday.length,
      chainDayCount, budgetCounted, budgetBasis: "max(state, chain-truth)",
    };
    /* the file's stale count gets corrected by this write — the live lie
     * (votesTodayCount 9 beside an 18-entry array) dies here too */
    writeJson(CUR_FILE, { ...out, votesToday: carried.votesToday, authorsToday: carried.authorsToday, totalVotes: carried.totalVotes, history: carried.history });
    appendLine(path.join(STATE, "events.jsonl"), { type: "curate.day-cap", at: now, day, chainDayCount, stateCount: carried.votesToday.length, budgetCounted, maxPerDay: p.maxPerDay });
    return out;
  }

  /* candidates → planner */
  const { posts, ok: streamOk } = await fetchCandidates(p, master, nowMs);
  if (!streamOk) return { ...base, verdict: "NO-CANDIDATE-STREAM", vpEff };
  const votedPermlinks = carried.votesToday.map((v) => `${v.author}/${v.permlink}`);
  /* T-85 · seeded jitter: the day + 2h-window + account → one seed, so each
   * window shuffles candidates differently yet the whole day's plan is
   * reproducible from the seed recorded in the verdict. */
  const jitterSeed = hashSeed(`${day}|${Math.floor(nowMs / (2 * 3600_000))}|${master}`);
  const plan = filterCandidates({
    posts, voter: master, policy: p, nowMs,
    votedPermlinks, votesToday: carried.votesToday.length, authorsToday: carried.authorsToday,
    jitterSeed,
  });
  // (votedPermlinks covers today; votedByUs covers all history — both enforced)
  if (!plan.selected.length) {
    const out = {
      ...base, verdict: "NO-CANDIDATES", vpEff,
      votesTodayCount: carried.votesToday.length, chainDayCount,
      rejectedTop: plan.rejected.slice(0, 8).map((r) => `${r.key}:${r.reason}`),
      candidatesScanned: posts.length,
    };
    writeJson(CUR_FILE, { ...out, votesToday: carried.votesToday, authorsToday: carried.authorsToday, totalVotes: carried.totalVotes, history: carried.history });
    return out;
  }

  /* broadcast — ONE vote per tx, ≥3.2s apart.
   * CHAIN-TRUTH LAW (measured live 2026-09-29): STEEM_MIN_VOTE_INTERVAL_SEC=3
   * — two votes by the same voter inside one tx/land in one block ⇒ atomic
   * assert failure for the WHOLE tx. So: one vote per broadcast, spaced,
   * fail-closed (first failure stops the run — never burn RC on a dead node).
   * T-14 hardening (measured live 19:42:16): async broadcast returns BEFORE
   * block inclusion — two adjacent-block votes can still hit the 3s assert.
   * The rejection is ATOMIC (the vote never landed) ⇒ one clean retry after
   * 3.5s is provably safe (cannot double-vote; worst case both fail).
   * T-17 FAST PATH: guards hoisted OUT of the loop — ONE RC measure + ONE
   * DGPO per run instead of per-vote re-reads (~6s+/vote of pure network
   * waste; a full 18-vote run crawled ~18min inside the 90s sovereign wait
   * = the two real votes counted "fail"). Same laws, same evidence, dead
   * latency removed. PLUS: incremental state write after EACH landed vote —
   * a mid-loop kill can no longer lose votesToday (pre-T-17 the write
   * happened only after the WHOLE loop), and the concurrent-cycle
   * double-vote window closes because the next run reads fresh dedup state. */
  const accState = await accountState(master);
  const rcPct = accState.ok ? (accState.rcPct ?? null) : null;
  let dgpo = null, dgpoAt = 0;
  const dgpoR0 = await rpcCall("condenser_api.get_dynamic_global_properties", []);
  if (dgpoR0.ok) { dgpo = dgpoR0.result; dgpoAt = Date.now(); }

  const isVoteIntervalAssert = (err) =>
    /MIN_VOTE_INTERVAL|Can only vote once every 3 seconds/i.test(String(err ?? ""));
  /* T-17 · SECOND-SIGNER COLLISION LAW (measured live 16:37/16:52 + 15:56/16:27
   * orders): the account history carries vote + limit_order + custom_json
   * ("saos.weave.core.v1" checkpoints) ops that NEVER passed this engine's
   * exec-log — an external agent-signer holds the same credential and runs
   * the same doctrine on the same account. When the chain rejects OUR vote
   * because a vote already landed "in a similar way", that is a DEDUP EVENT,
   * not a failure: it must not break the run (fail-closed is for real
   * malfunctions), and the account's VP budget must count it honestly. */
  const isAlreadyVoted = (err) =>
    /already voted in a similar way|You have already voted/i.test(String(err ?? ""));
  const results = [];
  let lastAt = 0;
  /* T-18: votesTodayCount recomputed AT WRITE TIME — the field was computed
   * once at run start (base) and written unchanged after every append, so the
   * file showed 9 beside an 18-entry array (measured live). The array is the
   * truth; the field must mirror it at every write. */
  const noteState = () => writeJson(CUR_FILE, { ...base, votesTodayCount: carried.votesToday.length, chainDayCount, vpEff, votesToday: carried.votesToday, authorsToday: carried.authorsToday, totalVotes: carried.totalVotes, history: carried.history });
  for (const v of plan.selected) {
    const waitMs = lastAt ? 3200 - (Date.now() - lastAt) : 0;
    if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));
    if (dgpo && Date.now() - dgpoAt > 60_000) {
      const g = await rpcCall("condenser_api.get_dynamic_global_properties", []);
      if (g.ok) { dgpo = g.result; dgpoAt = Date.now(); }
    }
    const voteOp = [[
      "vote", { voter: master, author: v.author, permlink: v.permlink, weight: v.weight },
    ]];
    let res = await executeAs(master, voteOp, { tag: "curate", role: "posting", rcPct, dgpo, dgpoAt });
    let retried = false;
    if (!res.ok && isVoteIntervalAssert(res.error)) {
      await new Promise((r) => setTimeout(r, 3500));
      retried = true;
      res = await executeAs(master, voteOp, { tag: "curate", role: "posting", rcPct, dgpo, dgpoAt });
    }
    lastAt = Date.now();
    if (res.ok) {
      results.push({ ...v, ok: true, txid: res.txid ?? null, error: null, retried });
      carried = mergeVoteState(carried, day, { author: v.author, permlink: v.permlink, weight: v.weight, at: now, txid: res.txid });
      noteState();
      continue;
    }
    if (isAlreadyVoted(res.error)) {
      /* the vote already exists on-chain (this or the second signer's earlier
       * vote) — count it into the day's budget, keep the loop alive */
      results.push({ ...v, ok: false, skipped: "already-voted-elsewhere", txid: null, error: res.error, retried });
      carried = mergeVoteState(carried, day, { author: v.author, permlink: v.permlink, weight: v.weight, at: now, txid: null }, "ALREADY-VOTED");
      noteState();
      continue;
    }
    results.push({ ...v, ok: false, txid: res.txid ?? null, error: res.error ?? null, retried });
    break; /* real failure — fail-closed, never burn RC on a dead rail */
  }
  const okVotes = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok && !r.skipped);
  const skipped = results.filter((r) => r.skipped);
  /* T-17 truth: a collision-covered run is NOT a failure — the account DID
   * curate today (the second signer landed those votes); name it honestly. */
  const verdict = okVotes.length
    ? (failed.length ? "PARTIAL" : "VOTED")
    : (skipped.length && !failed.length ? "ALL-ALREADY-VOTED" : "BROADCAST-FAIL");

  const out = {
    ...base, verdict,
    votesTodayCount: carried.votesToday.length, chainDayCount,
    txid: okVotes[0]?.txid ?? results[0]?.txid ?? null,
    error: failed[0]?.error ?? null, vpEff,
    voted: okVotes, failedVotes: failed,
    rejectedTop: plan.rejected.slice(0, 8).map((r) => `${r.key}:${r.reason}`),
    candidatesScanned: posts.length,
    skippedVotes: results.filter((r) => r.skipped).map((r) => `${r.author}/${r.permlink}:${r.skipped}`),
  };
  /* carried ALREADY holds every landed vote (T-17 incremental merges) — the
   * final write records the run verdict in history, never re-appends votes. */
  writeJson(CUR_FILE, {
    ...out, votesToday: carried.votesToday, authorsToday: carried.authorsToday,
    totalVotes: carried.totalVotes,
    history: [...carried.history, { at: now, day, verdict, n: okVotes.length, txid: out.txid }].slice(-30),
  });
  appendLine(path.join(STATE, "events.jsonl"), {
    type: "curate.done", at: now, verdict, votes: okVotes.length,
    txid: out.txid, vpEff, tuningsApplied,
  });
  return out;
}

/* CLI standalone: bun curator.mjs — one gated curation pass, same doctrine */
if (import.meta.url === `file://${process.argv[1]}`) {
  runCurator().then((r) => { console.log(JSON.stringify(r, null, 2)); process.exit(0); })
    .catch((e) => { console.error("CURATE-FAIL", e); process.exit(1); });
}
