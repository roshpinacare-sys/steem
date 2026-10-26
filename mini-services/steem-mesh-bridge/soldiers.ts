// G76-i — steem-mesh-bridge · soldiers.ts
// THE SOLDIER VOTING MESH — multi-soldier parallel execution scheduler.
//
// Owner directive §3: the Steem/Hive soldier voting mesh must run continuously
// with ALL VALID soldiers. This module is the parallel scheduler that makes the
// per-soldier loops run CONCURRENTLY with hard failure isolation:
//
//   · one soldier's RPC failure / hang must NEVER stall or reject the mesh run;
//   · per-soldier deterministic circuit breaker (CLOSED → OPEN → HALF_OPEN
//     single-probe — the same state machine law as nodes.ts, but keyed by
//     soldier instead of by node url);
//   · the custody-wound registry (CUSTODY-WOUNDS.jsonl, schema custody-wound/1)
//     is respected ABSOLUTELY: an open wound is NEVER attempted, never probed,
//     never healed by code — the heal is owner key re-entry ONLY;
//   · honest hash-linked receipts for every per-soldier decision (the bridge
//     receipt chain reused verbatim) — payloads carry soldier names, txids,
//     verdicts and sanitized errors. Zero key material ever enters a payload;
//   · zero Date.now and zero real timers in the logic: the clock and the sleep
//     are injected (deterministic tests advance the fake clock through sleep);
//   · seeded jitter (mulberry32): the per-soldier stagger is a pure function of
//     the seed — byte-stable runs, no wall-clock entropy.
//
// A "unit" is injected by the composition root (the runner): it performs ONE
// soldier's voting/curation round and returns an honest outcome. The scheduler
// never touches keys, chain calls, or broadcast decisions itself — it owns
// PARALLELISM, ISOLATION, BREAKERS, WOUNDS and RECEIPTS.
import { ReceiptChain, type Clock, type Receipt } from "./receipts";

export type { Receipt, ReceiptKind } from "./receipts";

/* ── public types ────────────────────────────────────────────────────────── */

export type SoldierVerdict =
  | "OK"
  | "FAIL"
  | "TIMEOUT"
  | "SKIP-TASK"
  | "SKIP-CUSTODY-WOUND"
  | "SKIP-BREAKER";

export type MeshVerdict =
  | "MESH-OK"
  | "MESH-PARTIAL"
  | "MESH-FAILED"
  | "MESH-BLOCKED-CUSTODY"
  | "MESH-IDLE"
  | "MESH-DEGRADED";

export type SoldierBreakerState = "CLOSED" | "OPEN" | "HALF_OPEN";

/** One line of the custody-wound registry (CUSTODY-WOUNDS.jsonl, custody-wound/1). */
export interface WoundRecord {
  soldier: string;
  /** "open" (default) | "healed". Healed wounds do not block the soldier. */
  status?: string;
  /** Registry schema marker, e.g. "custody-wound/1" — recorded, never required. */
  schema?: string;
  reason?: string;
}

/** One soldier's voting/curation attempt result, handed in by the runner. */
export interface UnitOutcome {
  ok: boolean;
  /** Honest lane-skip ("no-task", "spend-gate-paused", …) — a verdict, never an error. */
  skipped?: string;
  txids?: string[];
  error?: string;
}

export type UnitFn = (soldier: string, round: number) => Promise<UnitOutcome>;

export interface SoldierBreakerOptions {
  /** consecutive failed/timed-out attempts that trip the soldier OPEN (default 3) */
  failureThreshold?: number;
  /** ms an OPEN soldier waits before one HALF_OPEN probe (default 30_000) */
  cooldownMs?: number;
}

export interface SoldierMeshConfig {
  /** soldier roster (account names). Duplicates are deduped; empty is fail-closed. */
  soldiers: string[];
  /** injected epoch-ms clock (composition root; tests use a fake) */
  clock: Clock;
  /** injected delay — advancing the same clock in tests makes timeouts deterministic */
  sleep: (ms: number) => Promise<void>;
  /** one soldier's voting/curation unit for one round (injected, custody-gated upstream) */
  unit: UnitFn;
  /** voting/curation rounds per run (default 1) */
  rounds?: number;
  /** max units in flight (default: the whole eligible roster, fully parallel) */
  concurrency?: number;
  /** per-soldier stagger ceiling in ms (default 250; seeded — deterministic) */
  jitterMs?: number;
  /** mulberry32 seed for the stagger schedule (default 0x5A17) */
  seed?: number;
  /** open custody wounds — open wounded soldiers are NEVER attempted */
  wounds?: WoundRecord[];
  /** honesty echo: where the wound registry came from (path or null) */
  woundsSource?: string | null;
  breaker?: SoldierBreakerOptions;
  /** per-attempt timeout in ms, driven by the injected sleep (default 10_000) */
  timeoutMs?: number;
  /** injected sleep between rounds in ms (default 0) */
  roundGapMs?: number;
  receiptsSink?: (line: string) => void;
  maxReceipts?: number;
}

export interface SoldierResult {
  soldier: string;
  verdict: SoldierVerdict;
  attempts: number;
  okCount: number;
  failCount: number;
  timeoutCount: number;
  skipTaskCount: number;
  skipBreakerCount: number;
  breaker: SoldierBreakerState;
  wound: boolean;
  txids: string[];
  error: string | null;
  /** accumulated attempt duration measured on the injected clock */
  ms: number;
}

export interface MeshRunReport {
  verdict: MeshVerdict;
  at: number;
  rounds: number;
  seed: number;
  woundsSource: string | null;
  soldiers: SoldierResult[];
  counted: {
    attempted: number;
    ok: number;
    fail: number;
    timeout: number;
    skipTask: number;
    breakerSkipped: number;
    woundSkipped: number;
  };
  receipts: {
    seq: number;
    verify: { ok: boolean; brokenAt?: number; why?: string };
    recent: Receipt[];
  };
}

/* ── seeded PRNG (mulberry32 — pure, deterministic, no wall clock) ───────── */

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ── wound registry parsing (pure; tolerant + honest counts) ────────────── */

export interface ParsedWounds {
  wounds: WoundRecord[];
  healed: number;
  malformed: number;
  /** G77-h: healed soldier NAMES — needed for per-soldier registry precedence */
  healedSoldiers: string[];
}

/** Parses CUSTODY-WOUNDS.jsonl text. Malformed lines are counted, never thrown. */
export function parseWoundsJsonl(text: string): ParsedWounds {
  const out: ParsedWounds = { wounds: [], healed: 0, malformed: 0, healedSoldiers: [] };
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    let obj: unknown;
    try {
      obj = JSON.parse(line);
    } catch {
      out.malformed++;
      continue;
    }
    if (obj === null || typeof obj !== "object") {
      out.malformed++;
      continue;
    }
    const soldier = (obj as { soldier?: unknown }).soldier;
    if (typeof soldier !== "string" || soldier.length === 0) {
      out.malformed++;
      continue;
    }
    const rec = obj as WoundRecord;
    if ((rec.status ?? "open").toLowerCase() === "healed") {
      out.healed++;
      out.healedSoldiers.push(soldier);
      continue;
    }
    out.wounds.push({ soldier, status: rec.status ?? "open", schema: rec.schema, reason: rec.reason });
  }
  return out;
}

/* ── G77-h — dual-tier wound registries (vault primary, repo fallback) ────
 * Two registries may feed the mesh: the VAULT registry (owner truth, written
 * by the seal host) and a REPO-SIDE fallback (carries wounds to/from vault-less
 * hosts — e.g. the saos-0004 owner-derivable wound). Precedence is PER-SOLDIER:
 *   · a soldier mentioned in the VAULT registry takes the VAULT verdict
 *     (open stays open; healed stays healed — owner re-entry is THE heal law,
 *     and the repo fallback must never re-wound an owner-healed soldier);
 *   · a soldier absent from the vault registry takes the fallback verdict;
 *   · malformed lines from both tiers are summed, never thrown;
 *   · the resolved open set can only ADD wounds, never delete them. */

export interface MergedWounds {
  wounds: WoundRecord[];
  healed: number;
  malformed: number;
  sources: string[];
}

export function mergeWoundRegistries(
  primary: ParsedWounds | null,
  fallback: ParsedWounds | null,
): MergedWounds {
  const p = primary ?? { wounds: [], healed: 0, malformed: 0, healedSoldiers: [] };
  const f = fallback ?? { wounds: [], healed: 0, malformed: 0, healedSoldiers: [] };
  const primaryOpen = new Map<string, WoundRecord>();
  for (const w of p.wounds) primaryOpen.set(w.soldier, w);
  const primaryHealed = new Set(p.healedSoldiers);
  const fallbackOpen = new Map<string, WoundRecord>();
  for (const w of f.wounds) fallbackOpen.set(w.soldier, w);
  const fallbackHealed = new Set(f.healedSoldiers);

  const names = new Set<string>([
    ...primaryOpen.keys(), ...primaryHealed, ...fallbackOpen.keys(), ...fallbackHealed,
  ]);
  const wounds: WoundRecord[] = [];
  let healed = 0;
  for (const name of names) {
    if (primaryOpen.has(name) || primaryHealed.has(name)) {
      // VAULT verdict wins (owner truth)
      const w = primaryOpen.get(name);
      if (w) wounds.push(w);
      else healed++;
    } else {
      const w = fallbackOpen.get(name);
      if (w) wounds.push(w);
      else healed++;
    }
  }
  const sources: string[] = [];
  if (primary && (primary.wounds.length > 0 || primary.healed > 0 || primary.malformed > 0)) sources.push("vault");
  if (fallback && (fallback.wounds.length > 0 || fallback.healed > 0 || fallback.malformed > 0)) sources.push("repo-fallback");
  return { wounds, healed, malformed: p.malformed + f.malformed, sources };
}

/** Open (non-healed) wounds — the set the scheduler must never attempt. */
export function openWounds(wounds: WoundRecord[] | undefined): WoundRecord[] {
  return (wounds ?? []).filter(
    (w) =>
      w !== null &&
      typeof w === "object" &&
      typeof w.soldier === "string" &&
      w.soldier.length > 0 &&
      (w.status ?? "open").toLowerCase() !== "healed",
  );
}

/* ── FIFO semaphore (bounded parallelism, deterministic acquisition order) ─ */

class Semaphore {
  private readonly waiters: Array<() => void> = [];
  private active = 0;
  constructor(private readonly limit: number) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error("Semaphore: limit must be a positive integer");
  }
  async acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active++;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
    this.active++;
  }
  release(): void {
    this.active = Math.max(0, this.active - 1);
    const next = this.waiters.shift();
    if (next) next();
  }
}

/* ── per-soldier breaker state ───────────────────────────────────────────── */

interface SoldierState {
  name: string;
  attempts: number;
  okCount: number;
  failCount: number;
  timeoutCount: number;
  skipTaskCount: number;
  skipBreakerCount: number;
  breaker: SoldierBreakerState;
  consecutiveFailures: number;
  openedAt: number | null;
  txids: string[];
  lastError: string | null;
  ms: number;
}

const sanitizeError = (e: unknown): string =>
  String(e instanceof Error ? e.message : e).slice(0, 200);

/* ── the scheduler ───────────────────────────────────────────────────────── */

export async function runSoldierMesh(cfg: SoldierMeshConfig): Promise<MeshRunReport> {
  const clock = cfg.clock;
  const sleep = cfg.sleep;
  const rounds = Math.max(1, Math.floor(cfg.rounds ?? 1));
  const jitterMs = Math.max(0, Math.floor(cfg.jitterMs ?? 250));
  const seed = Math.floor(cfg.seed ?? 0x5a17);
  const timeoutMs = Math.max(1, Math.floor(cfg.timeoutMs ?? 10_000));
  const roundGapMs = Math.max(0, Math.floor(cfg.roundGapMs ?? 0));
  const breaker = {
    failureThreshold: Math.max(1, cfg.breaker?.failureThreshold ?? 3),
    cooldownMs: Math.max(0, cfg.breaker?.cooldownMs ?? 30_000),
  };

  // roster: dedupe, preserve order, fail-closed on empty
  const roster: string[] = [];
  for (const s of cfg.soldiers ?? []) {
    if (typeof s !== "string" || s.length === 0) {
      throw new Error("runSoldierMesh: roster entries must be non-empty soldier names");
    }
    if (!roster.includes(s)) roster.push(s);
  }
  if (roster.length === 0) {
    throw new Error("runSoldierMesh: soldier roster is empty (fail-closed — refuse to run an empty mesh)");
  }

  // custody-wound registry: open wounds are NEVER attempted (owner-only heal)
  const wounds = openWounds(cfg.wounds);
  const woundSet = new Set(wounds.map((w) => w.soldier));
  const woundsSource = cfg.woundsSource ?? null;

  const receipts = new ReceiptChain({ clock, sink: cfg.receiptsSink, maxInMemory: cfg.maxReceipts });

  // per-soldier state + seeded stagger schedule (consumed in roster order — stable)
  const rng = mulberry32(seed);
  const stagger = new Map<string, number>();
  for (const name of roster) stagger.set(name, Math.floor(rng() * jitterMs));

  const state = new Map<string, SoldierState>();
  for (const name of roster) {
    state.set(name, {
      name,
      attempts: 0,
      okCount: 0,
      failCount: 0,
      timeoutCount: 0,
      skipTaskCount: 0,
      skipBreakerCount: 0,
      breaker: "CLOSED",
      consecutiveFailures: 0,
      openedAt: null,
      txids: [],
      lastError: null,
      ms: 0,
    });
  }

  const transition = (s: SoldierState, to: SoldierBreakerState, kind: "OPEN" | "HALF_OPEN" | "CLOSED" | "REOPEN"): void => {
    const from = s.breaker;
    s.breaker = to;
    if (to === "OPEN") s.openedAt = clock();
    if (to === "CLOSED") s.openedAt = null;
    receipts.append("soldier_breaker", { soldier: s.name, from, to, kind });
  };

  receipts.append("soldier_mesh_start", {
    roster: roster.length,
    rounds,
    seed,
    jitterMs,
    concurrency: cfg.concurrency ?? null,
    timeoutMs,
    openWounds: wounds.map((w) => w.soldier),
    woundsSource,
  });

  for (const name of roster) {
    if (!woundSet.has(name)) continue;
    receipts.append("soldier_wound_skip", {
      soldier: name,
      reason: "open custody wound (custody-wound/1) — owner-only heal; never attempted",
    });
  }

  const eligibleRoster = roster.filter((name) => !woundSet.has(name));
  const concurrency = Math.max(1, Math.floor(cfg.concurrency ?? eligibleRoster.length));
  const sem = new Semaphore(concurrency);

  const runAttempt = async (s: SoldierState, round: number): Promise<void> => {
    await sem.acquire();
    try {
      await sleep(stagger.get(s.name) ?? 0);
      const started = clock();
      s.attempts++;
      let outcome: UnitOutcome | undefined;
      try {
        const unitPromise: Promise<UnitOutcome> = cfg.unit(s.name, round);
        unitPromise.catch(() => {}); // a late rejection must never become unhandled
        // the timeout TIMER winning the race IS the timeout (deterministic —
        // in production it is a real timer, in tests the injected sleep)
        const timeoutPromise = sleep(timeoutMs).then(() => "timeout" as const);
        const settled = await Promise.race([unitPromise, timeoutPromise]);
        outcome = settled === "timeout" ? undefined : settled;
      } catch (err) {
        outcome = { ok: false, error: sanitizeError(err) };
      }
      const elapsedMs = Math.max(0, clock() - started);
      s.ms += elapsedMs;
      if (outcome === undefined) {
        s.timeoutCount++;
        s.consecutiveFailures++;
        s.lastError = s.lastError ?? `timeout after ${timeoutMs}ms`;
        receipts.append("soldier_timeout", { soldier: s.name, round, timeoutMs });
      } else if (outcome.skipped !== undefined) {
        s.skipTaskCount++;
        s.consecutiveFailures = 0;
        receipts.append("soldier_skipped", { soldier: s.name, round, reason: String(outcome.skipped).slice(0, 120) });
      } else if (outcome.ok) {
        s.okCount++;
        s.consecutiveFailures = 0;
        s.lastError = null;
        for (const txid of outcome.txids ?? []) if (s.txids.length < 100) s.txids.push(txid);
        receipts.append("soldier_ok", { soldier: s.name, round, txids: outcome.txids ?? [] });
      } else {
        s.failCount++;
        s.consecutiveFailures++;
        s.lastError = sanitizeError(outcome.error ?? "unit failed");
        receipts.append("soldier_fail", { soldier: s.name, round, error: s.lastError });
      }
      // per-soldier breaker evolution (deterministic, same law as nodes.ts)
      const attemptFailed = outcome === undefined || (outcome.skipped === undefined && !outcome.ok);
      if (s.breaker === "HALF_OPEN" && attemptFailed) {
        transition(s, "OPEN", "REOPEN");
      } else if (
        s.breaker === "CLOSED" &&
        s.consecutiveFailures >= breaker.failureThreshold
      ) {
        transition(s, "OPEN", "OPEN");
      } else if (s.breaker !== "CLOSED" && s.consecutiveFailures === 0) {
        transition(s, "CLOSED", "CLOSED");
      }
    } finally {
      sem.release();
    }
  };

  for (let round = 1; round <= rounds; round++) {
    const tasks: Promise<void>[] = [];
    for (const name of eligibleRoster) {
      const s = state.get(name);
      if (!s) continue;
      // breaker gate: OPEN waits out its cooldown, then allows ONE HALF_OPEN probe
      if (s.breaker === "OPEN" && s.openedAt !== null && clock() - s.openedAt >= breaker.cooldownMs) {
        transition(s, "HALF_OPEN", "HALF_OPEN");
      }
      if (s.breaker === "OPEN") {
        s.skipBreakerCount++;
        receipts.append("soldier_skipped", { soldier: name, round, reason: "breaker-open" });
        continue;
      }
      tasks.push(runAttempt(s, round));
    }
    await Promise.all(tasks);
    if (round < rounds) await sleep(roundGapMs);
  }

  /* ── honest aggregation ─────────────────────────────────────────────── */
  const results: SoldierResult[] = roster.map((name) => {
    const s = state.get(name);
    if (!s) throw new Error(`runSoldierMesh: missing state for ${name}`);
    let verdict: SoldierVerdict;
    if (woundSet.has(name)) verdict = "SKIP-CUSTODY-WOUND";
    else if (s.attempts > 0) {
      if (s.okCount > 0 && s.failCount === 0 && s.timeoutCount === 0) verdict = "OK";
      else if (s.okCount > 0) verdict = "FAIL"; // mixed rounds: the failures are real
      else if (s.timeoutCount > 0 && s.failCount === 0) verdict = "TIMEOUT";
      else if (s.failCount > 0) verdict = "FAIL";
      else verdict = "SKIP-TASK";
    } else if (s.skipBreakerCount > 0) verdict = "SKIP-BREAKER";
    else verdict = "SKIP-TASK";
    return {
      soldier: name,
      verdict,
      attempts: s.attempts,
      okCount: s.okCount,
      failCount: s.failCount,
      timeoutCount: s.timeoutCount,
      skipTaskCount: s.skipTaskCount,
      skipBreakerCount: s.skipBreakerCount,
      breaker: s.breaker,
      wound: woundSet.has(name),
      txids: [...s.txids],
      error: s.lastError,
      ms: s.ms,
    };
  });

  const totalOk = results.reduce((n, r) => n + r.okCount, 0);
  const totalFail = results.reduce((n, r) => n + r.failCount, 0);
  const totalTimeout = results.reduce((n, r) => n + r.timeoutCount, 0);
  const totalAttempts = results.reduce((n, r) => n + r.attempts, 0);
  const counted = {
    attempted: results.filter((r) => r.attempts > 0).length,
    ok: totalOk,
    fail: totalFail,
    timeout: totalTimeout,
    skipTask: results.reduce((n, r) => n + r.skipTaskCount, 0),
    breakerSkipped: results.reduce((n, r) => n + r.skipBreakerCount, 0),
    woundSkipped: results.filter((r) => r.wound).length,
  };

  let verdict: MeshVerdict;
  if (eligibleRoster.length === 0) verdict = "MESH-BLOCKED-CUSTODY";
  else if (totalOk > 0 && totalFail + totalTimeout === 0) verdict = "MESH-OK";
  else if (totalOk > 0) verdict = "MESH-PARTIAL";
  else if (totalFail + totalTimeout > 0) verdict = "MESH-FAILED";
  else if (totalAttempts > 0) verdict = "MESH-IDLE";
  else verdict = "MESH-DEGRADED";

  receipts.append("soldier_mesh_done", { verdict, counted });

  const verify = receipts.verify();
  return {
    verdict,
    at: clock(),
    rounds,
    seed,
    woundsSource,
    soldiers: results,
    counted,
    receipts: { seq: receipts.stats().seq, verify, recent: receipts.recent(50) },
  };
}
