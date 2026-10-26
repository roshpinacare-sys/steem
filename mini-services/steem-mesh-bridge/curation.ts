// G77-h — steem-mesh-bridge · curation.ts
// THE ALL-SOLDIER CURATION BEAT (owner directive §3.3) — pure decision core.
//
// Every custody-valid soldier runs the curation cycle continuously. This module
// owns the DETERMINISTIC judgment (never the keys, never the network):
//
//   · the readiness prover (curationGate): per-soldier honest verdict from
//     measured chain facts — reachable, wound-clean, authority-match (the
//     vault pub must equal the LIVE chain posting authority), rc-above-floor,
//     vp-above-floor. Deterministic, injected facts, zero network, zero keys.
//   · topic selection: a faithful port of the measured curator law
//     (saos-engine curator.mjs / army-curation.mjs R290/R291/T-18/T-35):
//     age window 10..240min, external-content-only (full roster excluded as
//     author), per-author diversity 1/day, day budget = max(state, chain),
//     body/payout/bandwagon/crowded anti-spam gates, seeded shuffle (same
//     seed ⇒ same plan ⇒ auditable).
//   · the weight law in STEEM UNITS: 0 < weight ≤ 10000 — the u16 overflow
//     that once wrapped 521700 → −2588 (a real downvote on an innocent
//     author) must stay dead forever.
//   · the RC law from the measured sovereign gate (agent/hive_rc.cjs):
//     pct = min(max, stored + elapsed-regen) / max with a 5-day regen window,
//     floor 8% (measured; heavy ops 12% is not a curation concern — votes are
//     light).
//
// Zero Date.now, zero network, zero key material. The runner (composition
// root) does the IO through the mesh and hands in measured facts.
import { mulberry32 } from "./soldiers";

/* ── the policy — the existing curate params, single source of truth ─────── */

export interface CurationPolicy {
  enabled: boolean;
  /** day budget per soldier (R290 step-up: 20 × ~60% ≈ 12%/day < 20% regen) */
  maxPerDay: number;
  /** heavy early votes — curation share ∝ rshares × timing (R290) */
  baseWeightPct: number;
  /** late-ish votes keep enough weight to matter (R290) */
  minWeightPct: number;
  /** VP effective floor (R289 measured law: 35%) */
  minVpEffPct: number;
  /** diversity: one vote per author per day */
  maxPerAuthorPerDay: number;
  /** vote age window (early votes earn the bigger curation share) */
  ageMinMinutes: number;
  ageMaxMinutes: number;
  /** T-35 crowded-pool law: SP/rshare collapses at 150+ votes; measured cap */
  maxPostVotes: number;
  /** anti-spam: real content, not micro-dust */
  minBodyChars: number;
  /** bandwagon guard — late votes on hot posts earn little */
  maxPendingSbd: number;
  /** spread RC across the day's cycle runs (R290) */
  maxVotesPerCycle: number;
  /** shared candidate pool per tag fetch (R290) */
  fetchLimit: number;
  /** whitelist universe — the candidate STREAM is fetched per tag by the runner */
  tags: string[];
  /** EXTERNAL CONTENT ONLY: the full roster is excluded as author */
  excludeAccounts: string[];
  /** measured sovereign broadcast floor (agent/hive_rc.cjs FLOOR_PCT) */
  rcFloorPct: number;
  /** RC regen window seconds (5-day measured law) */
  regenWindowSec: number;
  /** STEEM_MIN_VOTE_INTERVAL_SEC measured (3s) + margin */
  voteIntervalMs: number;
}

const ROSTER_EXCLUDE = [
  "headcorner",
  "cashmachine", "haran", "israelnews", "lsa", "macrame", "siq",
  "tov", "wic", "wog", "woq", "hcsoldier4", "hcsoldier5", "hcsoldier6",
  "saos-0004",
];

export function soldierCuratorPolicy(): CurationPolicy {
  return {
    enabled: true,
    maxPerDay: 20, // R290 step-up (measured)
    baseWeightPct: 80, // R290 heavy early votes
    minWeightPct: 40, // R290
    minVpEffPct: 35, // R289 measured floor
    maxPerAuthorPerDay: 1, // diversity
    ageMinMinutes: 10, // too fresh = possibly unfinished spam
    ageMaxMinutes: 240, // R289: 4h window concentrates VP where returns live
    maxPostVotes: 100, // T-35 measured crowded-pool cap
    minBodyChars: 600, // real content, not micro-dust
    maxPendingSbd: 30, // bandwagon guard
    maxVotesPerCycle: 4, // R290 spread
    fetchLimit: 30, // R290 shared pool
    tags: ["steem", "crypto", "defi", "trading", "technology", "ai", "life", "photography"],
    excludeAccounts: [...ROSTER_EXCLUDE],
    rcFloorPct: 0.08, // hive_rc.cjs measured sovereign floor
    regenWindowSec: 5 * 86400, // 5-day RC regen
    voteIntervalMs: 3300, // STEEM_MIN_VOTE_INTERVAL_SEC measured + margin
  };
}

/* ── operator overrides (curation-beat.json), fail-closed validation ─────── */

const NUMERIC_KEYS: Array<{ key: keyof CurationPolicy; min: number; max?: number; int?: boolean }> = [
  { key: "maxPerDay", min: 1, max: 200, int: true },
  { key: "baseWeightPct", min: 1, max: 100, int: true },
  { key: "minWeightPct", min: 1, max: 100, int: true },
  { key: "minVpEffPct", min: 0, max: 100 },
  { key: "maxPerAuthorPerDay", min: 1, max: 100, int: true },
  { key: "ageMinMinutes", min: 0, max: 1440, int: true },
  { key: "ageMaxMinutes", min: 5, max: 10080, int: true },
  { key: "maxPostVotes", min: 1, max: 100000, int: true },
  { key: "minBodyChars", min: 0, max: 100000, int: true },
  { key: "maxPendingSbd", min: 0, max: 100000 },
  { key: "maxVotesPerCycle", min: 1, max: 100, int: true },
  { key: "fetchLimit", min: 5, max: 100, int: true },
  { key: "rcFloorPct", min: 0, max: 1 },
  { key: "regenWindowSec", min: 3600, max: 30 * 86400, int: true },
  { key: "voteIntervalMs", min: 3000, max: 600000, int: true }, // never below the measured 3s chain law
];

export function mergeCuratePolicy(overrides: Record<string, unknown> | null | undefined): CurationPolicy {
  const p = soldierCuratorPolicy();
  if (overrides == null) return p;
  if (typeof overrides !== "object" || Array.isArray(overrides)) {
    throw new Error("mergeCuratePolicy: overrides must be an object");
  }
  const known = new Set<string>([...NUMERIC_KEYS.map((k) => k.key as string), "enabled", "tags", "excludeAccounts"]);
  for (const k of Object.keys(overrides)) {
    if (!known.has(k)) throw new Error(`mergeCuratePolicy: unknown policy key "${k}" (no silent config drift)`);
  }
  if (overrides.enabled !== undefined) {
    if (typeof overrides.enabled !== "boolean") throw new Error("mergeCuratePolicy: enabled must be boolean");
    p.enabled = overrides.enabled;
  }
  for (const { key, min, max, int } of NUMERIC_KEYS) {
    const v = overrides[key as string];
    if (v === undefined) continue;
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n) || n < min || (max !== undefined && n > max) || (int && !Number.isInteger(n))) {
      throw new Error(`mergeCuratePolicy: ${key as string} out of range (got ${String(v)})`);
    }
    (p[key] as number) = n;
  }
  if (overrides.tags !== undefined) {
    if (!Array.isArray(overrides.tags) || overrides.tags.some((t) => typeof t !== "string" || t.length === 0)) {
      throw new Error("mergeCuratePolicy: tags must be an array of non-empty strings");
    }
    p.tags = [...overrides.tags];
  }
  if (overrides.excludeAccounts !== undefined) {
    if (!Array.isArray(overrides.excludeAccounts) || overrides.excludeAccounts.some((t) => typeof t !== "string")) {
      throw new Error("mergeCuratePolicy: excludeAccounts must be an array of strings");
    }
    p.excludeAccounts = [...p.excludeAccounts, ...overrides.excludeAccounts]; // union: exclusions only grow
  }
  if (p.minWeightPct > p.baseWeightPct) {
    throw new Error("mergeCuratePolicy: weight decay inverted (minWeightPct > baseWeightPct)");
  }
  return p;
}

/* ── weight law (steem units) ────────────────────────────────────────────── */

/** Linear decay baseWeight@ageMin → minWeight@ageMax, in STEEM UNITS (10000 = 100%).
 *  Chain law: 0 < weight ≤ 10000 — asserted by the band test; the runner
 *  fail-closes (WEIGHT-INVALID) before any broadcast if the assertion fails. */
export function weightForAge(ageMinutes: number, p: CurationPolicy): number {
  const clamped = Math.min(Math.max(ageMinutes, p.ageMinMinutes), p.ageMaxMinutes);
  const t = (clamped - p.ageMinMinutes) / Math.max(1, p.ageMaxMinutes - p.ageMinMinutes);
  const pct = p.baseWeightPct - t * (p.baseWeightPct - p.minWeightPct);
  return Math.round(pct * 100);
}

/* ── battery math ────────────────────────────────────────────────────────── */

const sharesNum = (s: unknown): number =>
  Number((String(s ?? "0").split(" ")[0] ?? "0").replace(/,/g, "")) || 0;

/** T-85 effective-vests truth: own + received − delegated-out. 0 on junk. */
export function effectiveVests(acc: {
  vesting_shares?: unknown;
  received_vesting_shares?: unknown;
  delegated_vesting_shares?: unknown;
} | null): number {
  if (!acc || typeof acc !== "object") return 0;
  return Math.max(
    0,
    sharesNum(acc.vesting_shares) + sharesNum(acc.received_vesting_shares) - sharesNum(acc.delegated_vesting_shares),
  );
}

/** Effective voting power pct from the manabar (mana units: vests × 1e6). */
export function vpEffPct(currentMana: number | null, vests: number): number | null {
  if (!(vests > 0) || !(typeof currentMana === "number" && currentMana >= 0)) return null;
  return Math.round((currentMana / (vests * 1e6)) * 1000) / 10;
}

/** RC regen law (measured, agent/hive_rc.cjs): pct = min(max, stored + elapsed-regen)/max.
 *  Clock skew never yields negative regen; zero max is fail-closed 0. */
export function rcPct(
  maxRc: number,
  currentMana: number,
  lastUpdateTimeSec: number,
  nowSec: number,
  regenWindowSec: number,
): number {
  if (!(maxRc > 0)) return 0;
  const elapsed = Math.max(0, nowSec - lastUpdateTimeSec);
  const regen = Math.floor((elapsed * maxRc) / regenWindowSec);
  return Math.min(1, (currentMana + regen) / maxRc);
}

/* ── THE READINESS PROVER ────────────────────────────────────────────────── */

export type CurationGateVerdict =
  | "CURATION-READY"
  | "SKIP-UNREACHABLE"
  | "SKIP-WOUND"
  | "SKIP-AUTHORITY"
  | "SKIP-VAULT-ABSENT"
  | "SKIP-RC-FLOOR"
  | "SKIP-VP-FLOOR";

/** Measured per-soldier facts (all handed in by the runner — this module never
 *  touches the network). vaultPubs: the vault's candidate posting pubs for the
 *  soldier; null = the vault is ABSENT on this host (readiness not provable
 *  here — honest verdict, not a silent pass); [] = vault present but holds no
 *  generation for this soldier. */
export interface SoldierCurationFacts {
  reachable: boolean;
  chainPub: string | null;
  vaultPubs: string[] | null;
  woundOpen: boolean;
  rcPct: number | null;
  vpEff: number | null;
}

export interface CurationGateResult {
  verdict: CurationGateVerdict;
  reason: string;
}

/** Precedence law (fail-honest, cheapest-decisive-first):
 *  unreachable → wound (ABSOLUTE — never attempted) → authority (custody) →
 *  vault-absent → rc-floor → vp-floor → READY. */
export function curationGate(f: SoldierCurationFacts, p: CurationPolicy): CurationGateResult {
  if (!f.reachable) return { verdict: "SKIP-UNREACHABLE", reason: "no chain read through the mesh" };
  if (f.woundOpen) return { verdict: "SKIP-WOUND", reason: "open custody wound (custody-wound/1) — owner-only heal; never attempted" };
  if (f.vaultPubs === null) return { verdict: "SKIP-VAULT-ABSENT", reason: "vault absent on this host — authority match not provable (readiness verdict, custody holds)" };
  if (!f.chainPub || f.vaultPubs.length === 0 || !f.vaultPubs.includes(f.chainPub)) {
    return { verdict: "SKIP-AUTHORITY", reason: "custody-refused: no vault generation matches the live chain posting authority (owner-only heal)" };
  }
  if (f.rcPct === null) return { verdict: "SKIP-RC-FLOOR", reason: "rc-unmeasurable (fail-honest: unknown is not above-floor)" };
  if (f.rcPct < p.rcFloorPct) {
    return { verdict: "SKIP-RC-FLOOR", reason: `rc-floor(${(f.rcPct * 100).toFixed(1)}%<${Math.round(p.rcFloorPct * 100)}%)` };
  }
  if (f.vpEff === null) return { verdict: "SKIP-VP-FLOOR", reason: "vp-eff-unmeasurable (fail-honest: unknown is not above-floor)" };
  if (f.vpEff < p.minVpEffPct) {
    return { verdict: "SKIP-VP-FLOOR", reason: `vp-floor(${f.vpEff}%<${p.minVpEffPct}%)` };
  }
  return { verdict: "CURATION-READY", reason: "ok" };
}

/* ── candidate normalization + topic selection (ported curator law) ──────── */

export interface CandidatePost {
  author: string;
  permlink: string;
  tag: string | null;
  createdMs: number;
  title: string;
  bodyLen: number;
  /** T-35 competition-dilution gate */
  voteCount: number;
  pendingSbd: number;
  archived: boolean;
  /** chain-truth dedup: the chain is the source of truth, not our state */
  votedByUs: boolean;
}

/** Raw condenser discussion → candidate. null on junk (never a half candidate).
 *  votedByUs comes from the ON-CHAIN active_votes — a post we voted days ago
 *  must never be re-voted (a second vote would just waste VP). */
export function normalizePost(raw: unknown, tag: string | null, voter: string): CandidatePost | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.author !== "string" || typeof r.permlink !== "string" || !r.author || !r.permlink) return null;
  const createdRaw = typeof r.created === "string" ? r.created : "";
  const createdMs = createdRaw ? Date.parse(createdRaw.endsWith("Z") ? createdRaw : createdRaw + "Z") : NaN;
  if (!Number.isFinite(createdMs)) return null;
  const votes = Array.isArray(r.active_votes) ? r.active_votes : [];
  return {
    author: r.author,
    permlink: r.permlink,
    tag: tag ?? null,
    createdMs,
    title: String(r.title ?? ""),
    bodyLen: String(r.body ?? "").length,
    voteCount: votes.length,
    pendingSbd: sharesNum(r.pending_payout_value),
    archived: r.cashout_time === "1969-12-31T23:59:59" || r.cashout_time === "1970-01-01T00:00:00",
    votedByUs: votes.some((v) => v && typeof v === "object" && (v as { voter?: unknown }).voter === voter),
  };
}

export interface SelectedTopic {
  author: string;
  permlink: string;
  /** steem units (0 < w ≤ 10000) */
  weight: number;
  ageMinutes: number;
  tag: string | null;
}

export interface TopicSelection {
  selected: SelectedTopic[];
  rejected: Array<{ key: string; reason: string }>;
  dayCapReached: boolean;
}

/** THE PURE PLANNER — deterministic, zero network. Ported verbatim-in-law from
 *  the measured curator filterCandidates (T-85 seeded shuffle, T-35 crowded
 *  pool, T-18 day budget counted upstream as max(state, chain)). */
export function selectTopics(args: {
  posts: CandidatePost[];
  voter: string;
  policy: CurationPolicy;
  nowMs: number;
  votedPermlinks?: string[];
  votesToday?: number;
  authorsToday?: Record<string, number>;
  jitterSeed?: number | null;
}): TopicSelection {
  const p = args.policy;
  const rejected: Array<{ key: string; reason: string }> = [];
  const seenPermlinks = new Set<string>();
  const votedSet = new Set(args.votedPermlinks ?? []);
  const authors = { ...(args.authorsToday ?? {}) };

  const remaining = Math.min(
    Math.max(0, p.maxPerDay - (args.votesToday ?? 0)),
    Number.isFinite(p.maxVotesPerCycle) ? Math.max(1, p.maxVotesPerCycle) : Infinity,
  );

  // deterministic order: newest first, permlink as tiebreak…
  const ordered = [...args.posts].sort(
    (a, b) => b.createdMs - a.createdMs || String(a.permlink).localeCompare(String(b.permlink)),
  );
  // …then a SEEDED shuffle when a seed is given (natural spreading, auditable)
  if (args.jitterSeed != null && ordered.length > 1) {
    const rand = mulberry32(args.jitterSeed);
    for (let i = ordered.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const tmp = ordered[i]!;
      ordered[i] = ordered[j]!;
      ordered[j] = tmp;
    }
  }

  const selected: SelectedTopic[] = [];
  let budget = remaining;
  for (const postItem of ordered) {
    const key = `${postItem.author}/${postItem.permlink}`;
    const dup = seenPermlinks.has(key);
    if (!dup) seenPermlinks.add(key);
    const reject = (reason: string) => {
      if (!dup) rejected.push({ key, reason });
    };

    if (dup) continue; // same post via two tags — dedup silently
    if (p.excludeAccounts.includes(postItem.author)) { reject("self-fleet"); continue; }
    if (postItem.votedByUs || votedSet.has(key)) { reject("already-voted"); continue; }
    const ageMin = (args.nowMs - postItem.createdMs) / 60000;
    if (!(ageMin >= p.ageMinMinutes)) { reject("too-young"); continue; }
    if (ageMin > p.ageMaxMinutes) { reject("too-old"); continue; }
    if ((postItem.bodyLen ?? 0) < p.minBodyChars) { reject("short-body"); continue; }
    // T-35 crowded-pool law; undefined voteCount (legacy fixtures) ⇒ gate passes
    if (Number.isFinite(p.maxPostVotes) && (postItem.voteCount ?? 0) > p.maxPostVotes) { reject("crowded"); continue; }
    if (!postItem.title || (postItem.title === postItem.title.toUpperCase() && postItem.title.length > 8)) { reject("spam-title"); continue; }
    if ((postItem.pendingSbd ?? 0) > p.maxPendingSbd) { reject("bandwagon"); continue; }
    if (postItem.archived === true) { reject("payout-closed"); continue; }
    if ((authors[postItem.author] ?? 0) >= p.maxPerAuthorPerDay) { reject("author-cap"); continue; }
    if (budget <= 0) { reject("day-cap"); continue; }

    selected.push({
      author: postItem.author,
      permlink: postItem.permlink,
      weight: weightForAge(ageMin, p),
      ageMinutes: Math.round(ageMin),
      tag: postItem.tag ?? null,
    });
    authors[postItem.author] = (authors[postItem.author] ?? 0) + 1;
    budget -= 1;
  }
  return { selected, rejected, dayCapReached: budget <= 0 };
}

/* ── chain-truth day budget (T-18: the chain can only RAISE the count) ───── */

/** Counts the soldier's own vote ops on the exact UTC day from account
 *  history rows (op-array and nested shapes, junk-tolerant). Non-array → null
 *  (honest unknown — the caller then falls back to state). */
export function countDayVotesFromHistory(rows: unknown, voter: string, day: string): number | null {
  if (!Array.isArray(rows)) return null;
  const d = String(day ?? "").slice(0, 10);
  if (!voter || d.length !== 10) return null;
  let n = 0;
  for (const row of rows) {
    const e = Array.isArray(row) ? row[1] : row;
    if (!e || typeof e !== "object") continue;
    const ev = e as Record<string, unknown>;
    const ts = typeof ev.timestamp === "string" ? ev.timestamp : null;
    if (!ts || !ts.startsWith(d)) continue;
    const op = Array.isArray(ev.op) ? ev.op : null;
    const type = op ? op[0] : ev.type;
    const val = op ? op[1] : ev.value;
    if (type !== "vote" || !val || typeof val !== "object") continue;
    if ((val as { voter?: unknown }).voter === voter) n++;
  }
  return n;
}

/* ── misc pure helpers ───────────────────────────────────────────────────── */

export const dayKeyOf = (iso: string | undefined): string =>
  String(iso ?? new Date().toISOString()).slice(0, 10);

/** FNV-1a → uint32 seed (the curator's auditable-jitter law). */
export function hashSeed(str: string): number {
  let h = 0x811c9dc5;
  const s = String(str ?? "");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
