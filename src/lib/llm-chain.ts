/**
 * llm-chain.ts — R285 · THE RESILIENCE PLANE (fcc-llm-chain discipline, house clean-room).
 *
 * Why this exists (measured): R263 proved a provider 429 starves the writers'
 * room; the old withLlmRetry retries the SAME request. The chain law is
 * sharper: a candidate IS the retry topology — a genuinely different request
 * (compacted prompt, reduced output ask) rides in the SAME turn.
 *
 * The five laws (fcc-llm-chain, adapted):
 *  1. CANDIDATE CHAIN — runLlmChain runs {name, call} entries in order. A
 *     throw, timeout, empty output, duplicate output, or validate-rejection
 *     moves to the next candidate in the same call. First valid wins.
 *  2. UNIQUE VALIDATION — an output identical (trimmed) to an earlier
 *     candidate's output in the same chain is rejected as duplicate.
 *  3. HONEST EXHAUSTION — every candidate failed: ok:false, output:null,
 *     last errorClass. Output is NEVER invented.
 *  4. FAST PATH — sha256-keyed LRU (128 entries, 10min TTL); a hit returns
 *     the cached output with tokensSaved from its last real usage.
 *  5. METADATA-ONLY LEDGER — candidate NAMES, selected name, attempts, token
 *     counts, ms, error CLASS. Prompt content and model output are never
 *     persisted, never logged, never returned by the board.
 *
 * Error classes: rate-limit | timeout | empty-output | duplicate | invalid |
 * auth | network | provider | unknown.
 *
 * Trace events (console, metadata only): saos.llm_chain.started,
 * saos.llm_chain.candidate_failed, saos.llm_chain.selected,
 * saos.llm_chain.exhausted.
 */
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

export type LlmErrorClass =
  | "rate-limit"
  | "timeout"
  | "empty-output"
  | "duplicate"
  | "invalid"
  | "auth"
  | "network"
  | "provider"
  | "unknown";

/* ── classification: the honest taxonomy (pure) ─────────────────────────── */
export function classifyError(e: unknown): LlmErrorClass {
  const msg = String((e as Error)?.message ?? e ?? "");
  if (/\b429\b|too many requests|rate.?limit/i.test(msg)) return "rate-limit";
  if (/\b40[13]\b|unauthorized|forbidden|api key/i.test(msg)) return "auth";
  if (/\btimeout\b|timed? ?out|abort/i.test(msg)) return "timeout";
  if (/ECONN|ENOTFOUND|EAI_AGAIN|fetch failed|network|socket|ECONNRESET/i.test(msg)) return "network";
  if (/status 5\d\d|bad gateway|service unavailable|internal server/i.test(msg)) return "provider";
  return "unknown";
}

/* ── lossy compaction (pure, deterministic): keep head + tail, dedupe lines ── */
const SEAM = "[… קומפקציה · חלק אמצעי הושמט …]";
export function compactContext(text: string, maxChars: number): string {
  const src = String(text ?? "");
  if (maxChars <= 0) return "";
  /* collapse noise: cr, triple blank lines, trailing space, duplicate lines */
  const seen = new Set<string>();
  const lines = src
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => l.replace(/[ \t]+$/g, ""))
    .filter((l) => {
      const key = l.trim();
      if (!key) return true; /* blank lines kept for structure */
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
  if (lines.length <= maxChars) return lines;
  if (maxChars <= SEAM.length + 40) return lines.slice(0, maxChars);
  /* budget also pays for the two newline bridges around the seam */
  const budget = maxChars - SEAM.length - 2;
  const head = Math.floor(budget * 0.6);
  const tail = budget - head;
  return `${lines.slice(0, head)}\n${SEAM}\n${lines.slice(lines.length - tail)}`;
}

/* ── metadata-only ledger (never prompt content, never model output) ─────── */
const DEFAULT_LEDGER = "/home/z/my-project/mini-services/saos-engine/state/llm-chain.jsonl";
const LEDGER_MAX_BYTES = 5 * 1024 * 1024;
const LEDGER_KEEP_LINES = 2000;

function appendLedger(row: Record<string, unknown>, ledgerPath?: string): void {
  try {
    const p = ledgerPath ?? DEFAULT_LEDGER;
    fs.mkdirSync(path.dirname(p), { recursive: true });
    try {
      const st = fs.statSync(p);
      if (st.size > LEDGER_MAX_BYTES) {
        /* bounded growth law: keep the newest lines, drop the old */
        const lines = fs.readFileSync(p, "utf8").split("\n").filter(Boolean);
        fs.writeFileSync(p, lines.slice(-LEDGER_KEEP_LINES).join("\n") + "\n");
      }
    } catch {
      /* missing file is fine */
    }
    fs.appendFileSync(p, JSON.stringify(row) + "\n");
  } catch {
    /* the ledger is trace-only: a write failure must never break a chain run */
  }
}

/* ── the chain ───────────────────────────────────────────────────────────── */
export interface ChainCandidate<T> {
  name: string;
  call: () => Promise<{ value: T; tokens?: number }>;
}
export interface ChainAttempt {
  name: string;
  errorClass?: LlmErrorClass;
  ms: number;
}
export interface ChainResult<T> {
  ok: boolean;
  output: T | null;
  selected: string | null;
  attempts: ChainAttempt[];
  errorClass?: LlmErrorClass;
  tokens: number;
  ms: number;
  cacheHit: boolean;
  tokensSaved: number;
}

export interface ChainOpts<T> {
  purpose: string;
  candidates: Array<ChainCandidate<T>>;
  /* null or throw = invalid candidate output (moves on, never aborts the run) */
  validate?: (value: T) => T | null;
  timeoutMs?: number;
  /* satisfy mode: keep running candidates while the MERGED accumulator is
   * unsatisfied (dedupe-aware: the merge runs before the bar is checked)
   * (the content top-up law: 4 drafts needed, a 2-draft candidate tops up) */
  satisfied?: (merged: T | null) => boolean;
  merge?: (acc: T | null, next: T) => T;
  /* sha256-keyed fast path: pass the RAW key material (route fields); the
   * raw key is hashed in-memory and never persisted anywhere */
  cacheKey?: string;
  ledgerPath?: string;
}

function withTimeout<T>(p: Promise<{ value: T; tokens?: number }>, ms: number): Promise<{ value: T; tokens?: number }> {
  if (!ms || ms <= 0) return p;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`candidate timeout after ${ms}ms`)), ms);
    p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

export async function runLlmChain<T>(opts: ChainOpts<T>): Promise<ChainResult<T>> {
  const t0 = Date.now();
  const attempts: ChainAttempt[] = [];
  const trace = (ev: string, extra: Record<string, unknown>) =>
    console.log(JSON.stringify({ ev, purpose: opts.purpose, ...extra }));

  /* fast path: exact keyed input only */
  if (opts.cacheKey) {
    const fp = fastPathGet<T>(opts.cacheKey);
    if (fp) {
      const ms = Date.now() - t0;
      trace("saos.llm_chain.fastpath_hit", { ms, tokensSaved: fp.tokensSaved });
      appendLedger(
        { at: new Date().toISOString(), kind: "chain", purpose: opts.purpose, candidates: opts.candidates.map((c) => c.name), selected: "fastpath", attempts: [], ok: true, tokens: 0, tokensSaved: fp.tokensSaved, ms, cacheHit: true },
        opts.ledgerPath,
      );
      return { ok: true, output: fp.output, selected: "fastpath", attempts: [], tokens: 0, ms, cacheHit: true, tokensSaved: fp.tokensSaved };
    }
  }

  trace("saos.llm_chain.started", { candidates: opts.candidates.map((c) => c.name) });
  let acc: T | null = null;
  const seenOutputs = new Set<string>();
  let lastClass: LlmErrorClass = "unknown";
  let tokens = 0;
  let satisfiedBy: ChainCandidate<T> | null = null;

  for (const cand of opts.candidates) {
    const c0 = Date.now();
    try {
      const { value, tokens: ct } = await withTimeout(Promise.resolve(cand.call()), opts.timeoutMs ?? 0);
      tokens += ct ?? 0;
      let checked: T | null = value;
      if (opts.validate) checked = opts.validate(value);
      if (checked === null || checked === undefined) throw new Error("candidate output rejected by validate");
      /* unique law: a repeated answer is not new information. Strings are
       * compared trimmed (the skill's wording); structures keep their JSON
       * canonical form. */
      const canonValue = typeof checked === "string" ? checked.trim() : checked;
      const canon = JSON.stringify(canonValue);
      if (seenOutputs.has(canon)) throw new Error("duplicate candidate output");
      seenOutputs.add(canon);
      /* value may be transformed by validate (normalization) — store checked */
      const stored = checked as T;
      acc = opts.merge && acc !== null ? opts.merge(acc, stored) : stored;
      attempts.push({ name: cand.name, ms: Date.now() - c0 });
      const done = opts.satisfied ? opts.satisfied(acc) : true;
      if (done) { satisfiedBy = cand; break; }
      trace("saos.llm_chain.unsatisfied_merge", { candidate: cand.name });
    } catch (e) {
      const raw = String((e as Error)?.message ?? e ?? "");
      const cls: LlmErrorClass =
        /rejected by validate/.test(raw) ? "invalid" :
        /duplicate candidate output/.test(raw) ? "duplicate" :
        /empty/.test(raw) ? "empty-output" :
        classifyError(e);
      lastClass = cls;
      attempts.push({ name: cand.name, errorClass: cls, ms: Date.now() - c0 });
      trace("saos.llm_chain.candidate_failed", { candidate: cand.name, errorClass: cls });
      /* dangling-promise hygiene: nothing else to do — withTimeout already guarded */
    }
  }

  const ms = Date.now() - t0;
  /* satisfaction bar vs validity: an unmet bar is a route preference, not a
   * failure. Exhaustion (ok:false, null) is ONLY when zero valid candidates.
   * A merged-but-unsatisfied result ships as merged-partial — the engine's
   * own gates still own the final decision downstream. */
  if (acc === null) {
    trace("saos.llm_chain.exhausted", { errorClass: lastClass, ms });
    appendLedger(
      { at: new Date().toISOString(), kind: "chain", purpose: opts.purpose, candidates: opts.candidates.map((c) => c.name), selected: null, attempts, ok: false, tokens, tokensSaved: 0, ms, cacheHit: false },
      opts.ledgerPath,
    );
    return { ok: false, output: null, selected: null, attempts, errorClass: lastClass, tokens, ms, cacheHit: false, tokensSaved: 0 };
  }
  const selectedName = satisfiedBy?.name ?? "merged-partial";
  trace("saos.llm_chain.selected", { selected: selectedName, ms });
  appendLedger(
    { at: new Date().toISOString(), kind: "chain", purpose: opts.purpose, candidates: opts.candidates.map((c) => c.name), selected: selectedName, attempts, ok: true, tokens, tokensSaved: 0, ms, cacheHit: false },
    opts.ledgerPath,
  );
  if (opts.cacheKey) fastPathPut(opts.cacheKey, acc, tokens);
  return { ok: true, output: acc, selected: selectedName, attempts, tokens, ms, cacheHit: false, tokensSaved: 0 };
}

/* ── the fast path: sha256-keyed LRU, 128 entries, 10min TTL ─────────────── */
const CACHE_MAX = 128;
const CACHE_TTL_MS = 10 * 60_000;
interface CacheEntry { output: unknown; at: number; tokens: number }
const cache = new Map<string, CacheEntry>(); /* Map insertion order = LRU */

function sha256Key(raw: string): string {
  return createHash("sha256").update(String(raw)).digest("hex");
}
function fastPathGet<T>(rawKey: string): { output: T; tokensSaved: number } | null {
  const key = sha256Key(rawKey);
  const hit = cache.get(key);
  if (!hit) return null;
  cache.delete(key);
  if (Date.now() - hit.at > CACHE_TTL_MS) return null; /* expired */
  cache.set(key, hit); /* re-insert = LRU refresh */
  return { output: hit.output as T, tokensSaved: hit.tokens };
}
function fastPathPut(rawKey: string, output: unknown, tokens: number): void {
  const key = sha256Key(rawKey);
  cache.delete(key);
  cache.set(key, { output, at: Date.now(), tokens });
  while (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}
export function flushFastPath(): number {
  const n = cache.size;
  cache.clear();
  return n;
}
export function fastPathStats(): { size: number; max: number; ttlMs: number } {
  return { size: cache.size, max: CACHE_MAX, ttlMs: CACHE_TTL_MS };
}
/* test-only witness: the raw key must NEVER be observable (sha256 only) */
export function fastPathKeysWitness(): string[] {
  return Array.from(cache.keys());
}

/* ── the drill: proves the wiring with no real workload ──────────────────── */
export interface DrillResult {
  ok: boolean;
  drillOk: boolean;
  selected: string | null;
  attempts: ChainAttempt[];
  note: string;
}
export async function drillChain(opts?: { ledgerPath?: string; provider?: () => Promise<{ value: string; tokens?: number }> }): Promise<DrillResult> {
  const forcedFail = async (): Promise<{ value: string; tokens?: number }> => {
    throw new Error("ForcedDrillError — drill candidate 1 must always fail (wiring proof)");
  };
  const liveProvider = opts?.provider ?? (async () => {
    const ZAI = (await import("z-ai-web-dev-sdk")).default;
    const zai = await ZAI.create();
    const completion = await zai.chat.completions.create({
      messages: [{ role: "user", content: "ping" }],
      max_tokens: 1,
      thinking: { type: "disabled" },
    });
    return { value: String(completion.choices?.[0]?.message?.content ?? ""), tokens: (completion as { usage?: { total_tokens?: number } })?.usage?.total_tokens ?? 0 };
  });
  const localEcho = async (): Promise<{ value: string; tokens?: number }> => ({ value: "drill-local-echo-ok", tokens: 0 });

  const res = await runLlmChain<string>({
    purpose: "drill",
    candidates: [
      { name: "drill-forced-fail", call: forcedFail },
      { name: "drill-provider-1t", call: liveProvider },
      { name: "drill-local-echo", call: localEcho },
    ],
    validate: (s) => (s && s.trim() ? s.trim() : null),
    ledgerPath: opts?.ledgerPath,
  });
  const drillOk = res.ok && res.selected !== null;
  /* drill rows carry kind:drill so the board can tell proof-runs from traffic */
  appendLedger(
    { at: new Date().toISOString(), kind: "drill", purpose: "drill", selected: res.selected, attempts: res.attempts, ok: res.ok, tokens: res.tokens, ms: res.ms },
    opts?.ledgerPath,
  );
  return { ok: true, drillOk, selected: res.selected, attempts: res.attempts, note: res.selected === "drill-local-echo" ? "provider throttled; echo backstop carried the wiring proof" : res.selected === "drill-provider-1t" ? "live rail proven" : "unexpected selected candidate" };
}

/* ── the board: KPIs derived from the ledger (the server recycles, the ledger stays) ── */
export interface ChainKpis {
  calls: number;
  failoverRate: number;
  exhaustionRate: number;
  cacheHitRate: number;
  tokensSaved: number;
  avgMs: number;
}
export function chainKpis(ledgerPath?: string): { kpis: ChainKpis; recent: Record<string, unknown>[] } {
  const p = ledgerPath ?? DEFAULT_LEDGER;
  let rows: Record<string, unknown>[] = [];
  try {
    rows = fs
      .readFileSync(p, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => { try { return JSON.parse(l) as Record<string, unknown>; } catch { return null; } })
      .filter((r): r is Record<string, unknown> => !!r);
  } catch {
    rows = [];
  }
  const chains = rows.filter((r) => r.kind === "chain");
  const calls = chains.length;
  const okRows = chains.filter((r) => r.ok === true);
  const failover = okRows.filter((r) => Array.isArray(r.attempts) && (r.attempts as unknown[]).length > 1);
  const hits = chains.filter((r) => r.cacheHit === true);
  const tokensSaved = chains.reduce((a, r) => a + (Number(r.tokensSaved) || 0), 0);
  const totalMs = chains.reduce((a, r) => a + (Number(r.ms) || 0), 0);
  return {
    kpis: {
      calls,
      failoverRate: calls ? failover.length / calls : 0,
      exhaustionRate: calls ? (calls - okRows.length) / calls : 0,
      cacheHitRate: calls ? hits.length / calls : 0,
      tokensSaved,
      avgMs: calls ? Math.round(totalMs / calls) : 0,
    },
    recent: rows.slice(-20).reverse(),
  };
}

/* ── chain spec (what the board advertises to the operator) ──────────────── */
export function chainSpec(): Record<string, unknown> {
  return {
    law: "fcc-llm-chain · five laws (candidate chain, unique validation, honest exhaustion, fast path, metadata-only ledger)",
    errorClasses: ["rate-limit", "timeout", "empty-output", "duplicate", "invalid", "auth", "network", "provider", "unknown"],
    fastPath: fastPathStats(),
    drill: "candidates drill-forced-fail, drill-provider-1t, drill-local-echo; drillOk = selected non-null",
  };
}
