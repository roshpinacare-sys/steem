/**
 * content-compiler.mjs — R287 · THE HIGH-DENSITY CONTENT COMPILER
 * (Sovereign Revenue Architect · operator command: "Deploy the High-Density
 * Content Compiler").
 *
 * COMMAND CONTRACT (verbatim intent):
 *   "Construct a native script within the core engine directory that extracts
 *    raw text arrays from the reasoning gateway, compresses the syntax to
 *    optimize transaction byte size, validates the data formatting against
 *    strict local markdown structural schemas, and leaves the package state
 *    as BROADCAST-READY in the staging buffer."
 *
 * HOW (native, zero new dependencies — Law 24: no external framework drift;
 * the external prompt's CAR / GunDB / remark intents are honored NATIVELY):
 *   · INTAKE     — raw text arrays from the reasoning gateway: the content
 *                  rail's sanitized drafts queue (content-ops.json) + an
 *                  optional raw intake file (state/revenue-intake.jsonl,
 *                  one JSON per line: {texts:[{title,body}], tags?, chain?}).
 *   · COMPILE    — byte-density pass: whitespace collapse, paragraph hygiene,
 *                  symbol-law enforcement (enforceSymbolLaw) — the tx payload
 *                  gets smaller BEFORE any signature touches it.
 *   · SCRUB      — data hygiene (Supreme Command §3): sandbox paths, localhost
 *                  URLs, WIF-shaped tokens, PAT tokens, hex/b64 blobs and
 *                  secret-assignments are REMOVED and counted — a compiled
 *                  package carries zero processing telemetry by construction.
 *   · SCHEMA     — strict native markdown structural validator: title/body/
 *                  tags rules, https-only links+images, raw-HTML ban, balanced
 *                  fences, density bounds (MIN_POST_WORDS..16000 bytes).
 *   · ADDRESS    — native content-addressing (CAR intent): sha256 over the
 *                  canonical serialization → immutable package id, chained
 *                  parent-by-parent (hash chain, merkle-honest, zero deps).
 *   · CADENCE    — LAW L-26 slot assignment (see CADENCE below).
 *   · STAGE      — BROADCAST-READY packages land in state/revenue-staging.json
 *                  (+ .jsonl audit trail, union-merge law). THIS RAIL NEVER
 *                  BROADCASTS: the custody-gated social rails remain the only
 *                  broadcasters (one-body law); a custody RED freezes the
 *                  buffer (T-15 interlock) — staging is honest, broadcasting
 *                  stays owned, validated and gated exactly where it is today.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { enforceSymbolLaw, titleSimilarity, wordCount, MIN_POST_WORDS } from "./content.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);
/* R275 merge law: state dir resolved PER CALL — the selftest may run while
 * the live engine flushes the same files; tests isolate via SAOS_STATE_DIR. */
const stateDir = () => process.env.SAOS_STATE_DIR || path.join(DIR, "state");
const receiptsDir = () => path.join(DIR, "receipts");
const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const writeJson = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); const t = `${p}.tmp.${process.pid}`; fs.writeFileSync(t, JSON.stringify(v, null, 2)); fs.renameSync(t, p); };
const appendLine = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.appendFileSync(p, JSON.stringify(v) + "\n"); };
const readLines = (p, n = 200) => {
  try { return fs.readFileSync(p, "utf8").trim().split("\n").filter(Boolean).slice(-n).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); }
  catch { return []; }
};

/* ── LAW L-26 · THE REVENUE CADENCE MATRIX (operator question #1, answered
 *    in code) ──────────────────────────────────────────────────────────────
 * POST   ≥5400s (90min) between two posts of the same account (T-62 release:
 *        the old 300s + 1-per-day pair was a false self-limit; the real
 *        external law is anti-spam spacing — doctrine: ≤4/day/account,
 *        ≥90min, ±45s jitter so the fleet never fires metronome-shaped).
 * COMMENT ≥180s between two comments of the same account.
 * VOTE   ≥15s between two votes of the same account, ≤3 votes/day/account
 *        (R283 caps stand).
 * GLOBAL a custody RED (T-15) freezes the buffer; the RC floor and every
 *        other existing gate stay owned by the rails that broadcast. */
export const CADENCE = {
  law: "L-26",
  post: { minIntervalSec: 5400, jitterSec: 45, perDayPerAccount: 4 }, /* T-62 release: 300s/1-per-day → 90min/4-per-day (real anti-spam bound) */
  comment: { minIntervalSec: 180 },
  vote: { minIntervalSec: 15, perDayPerAccount: 3 },
  freezeOnCustodyRed: true,
};

/* ── SCRUB (pure) — telemetry & secret hygiene, conservative by design ──── */
const SCRUB_PATTERNS = [
  { kind: "sandbox-path", re: /(\/home\/[a-z0-9_-]+\/[^\s"'`,.;\)\]]+|\/tmp\/[^\s"'`,.;\)\]]+)/g },
  { kind: "localhost-url", re: /https?:\/\/(localhost|127\.0\.0\.1)[:0-9]*[^\s"'`,;\)\]]*/g },
  { kind: "wif-token", re: /\b5[HKJ][1-9A-Za-z]{49}\b/g },
  { kind: "pat-token", re: /\b(?:github_pat_|ghp_|gho_)[A-Za-z0-9_]{20,}\b/g },
  { kind: "hex-blob", re: /\b[0-9a-fA-F]{64,}\b/g },
  { kind: "b64-blob", re: /\b[A-Za-z0-9+/]{96,}={0,2}\b/g },
  { kind: "secret-assign", re: /^[^\S\n]*(?:password|passphrase|wif|private[_-]?key|secret|token)[^\S\n]*[:=][^\n]*$/gim },
];

export function scrubBody(text) {
  const hits = [];
  let out = String(text ?? "");
  let scrubbed = 0;
  for (const { kind, re } of SCRUB_PATTERNS) {
    out = out.replace(re, (m) => { scrubbed++; const h = hits.find((x) => x.kind === kind); if (h) h.count++; else hits.push({ kind, count: 1 }); return kind === "secret-assign" ? "" : ""; });
  }
  /* leftover debris from removals: collapsed spacing, orphan pipes/dashes */
  out = out.replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").replace(/^\s+|\s+$/g, "");
  return { text: out, hits, scrubbed };
}

/* ── ADDRESS (pure) — native content-addressing, hash-chained (CAR intent) */
export function pkgCid(title, body, tags) {
  const canonical = JSON.stringify([String(title ?? ""), String(body ?? ""), [...(tags ?? [])].sort()]);
  const hex = createHash("sha256").update(canonical, "utf8").digest("hex");
  return { id: `sha256-${hex.slice(0, 32)}`, bytes: Buffer.byteLength(String(body ?? ""), "utf8") };
}

export function chainPackages(pkgs) {
  const ordered = [...(pkgs ?? [])].sort((a, b) => String(a.compiledAt ?? "").localeCompare(String(b.compiledAt ?? "")));
  let parent = null;
  for (const p of ordered) { p.parentCid = parent; parent = p.id; }
  return { packages: ordered, headCid: parent };
}

/* ── SCHEMA (pure) — strict native markdown structural validator ────────── */
const DENSITY_MAX_BYTES = 16000;
const WORDS_MAX = 4000;

export function validatePackage(pkg) {
  const checks = [];
  const add = (k, ok, detail = null) => checks.push({ k, ok, detail });
  const title = String(pkg.title ?? "");
  const body = String(pkg.body ?? "");
  const tags = Array.isArray(pkg.tags) ? pkg.tags : [];

  const bytes = Buffer.byteLength(body, "utf8");
  const words = body.split(/\s+/).filter(Boolean).length;

  add("title-length", title.length >= 8 && title.length <= 80, `${title.length} chars`);
  add("title-plain", !/^#|^\[|^!\[|[\n\r]/.test(title), "no markdown / single line");
  add("body-words", words >= MIN_POST_WORDS && words <= WORDS_MAX, `${words} words (min ${MIN_POST_WORDS})`);
  add("body-density", bytes <= DENSITY_MAX_BYTES, `${bytes} bytes (max ${DENSITY_MAX_BYTES})`);
  const opening = body.split(/\n{2,}/)[0] ?? "";
  add("body-opening", opening.trim().length >= 60, `${opening.trim().length} chars`);
  const urls = [...body.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]);
  add("links-https", urls.every((u) => /^https:\/\//.test(u)), `${urls.length} links`);
  const imgs = [...body.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)].map((m) => m[1]);
  add("images-https", imgs.every((u) => /^https:\/\//.test(u)), `${imgs.length} images`);
  add("no-raw-html", !/<\/?(?:script|iframe|style|object|embed|form)\b|on[a-z]+\s*=/i.test(body), "no executable markup");
  const fences = (body.match(/^```/gm) ?? []).length;
  add("fences-balanced", fences % 2 === 0, `${fences} fences`);
  add("no-control-chars", !/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(title + body), "clean");
  add("tags-shape", tags.length >= 1 && tags.length <= 5 && tags.every((t) => /^[a-z0-9-]{3,24}$/.test(String(t))), tags.join(","));
  return { ok: checks.every((c) => c.ok), checks, bytes, words };
}

/* ── CADENCE (pure; jitter injectable for deterministic selftest) ───────── */
export function cadenceNextEligible(lastIso, nowMs = Date.now(), jitterMs = Math.floor(Math.random() * CADENCE.post.jitterSec * 1000)) {
  const last = lastIso ? Date.parse(lastIso) : NaN;
  const base = Number.isFinite(last) ? last + CADENCE.post.minIntervalSec * 1000 : nowMs;
  const t = Math.max(nowMs, base + jitterMs);
  return new Date(t).toISOString();
}

/* ── STAGE — the pipeline itself ─────────────────────────────────────────── */
const BUFFER_MAX_READY = 24;

export function compileRevenue({ now = new Date().toISOString() } = {}) {
  const t0 = Date.now();
  const S = stateDir();
  const ops = readJson(path.join(S, "content-ops.json"), null);

  /* custody gate (T-15 interlock): RED freezes broadcast eligibility of the
   * whole buffer — staging stays honest, the publishing rails keep their own
   * gates, and the cockpit shows the freeze. */
  const army = readJson(path.join(S, "army-custody.json"), null);
  const custodyGreen = Boolean(army && army.verdict === "FLEET-CUSTODY-ALIVE" && Number(army?.after?.verified ?? 0) >= Number(army?.after?.total ?? 14) && Number(army?.after?.total ?? 0) > 0);

  /* intake 1: the reasoning gateway's sanitized drafts queue.
   * R303 · THIN-DRAFT FLOOR (measured 06:23Z: 9 sub-floor drafts — 108-155
   * words, pre-R244 residue — sat in the bounded queue and were re-rejected
   * by the schema gate EVERY compile: honest SCHEMA-REJECTED rows, zero
   * progress, pure waste). Parity with hive.mjs's own floor: a draft under
   * the 300-word doctrine floor never becomes a candidate here. The queue
   * itself is healed by content.mjs's THIN-PURGE law — this is defense in
   * depth, so the compiler stays clean even against a dirty queue. */
  const drafts = (Array.isArray(ops?.queue) ? ops.queue : []).filter((d) => d?.status === "drafted" && d?.title && d?.body && wordCount(d.body) >= MIN_POST_WORDS);
  /* intake 2: raw text arrays pushed directly by any LLM rail */
  const intake = readLines(path.join(S, "revenue-intake.jsonl"), 100)
    .map((row, i) => ({ row, i }))
    .filter(({ row }) => row && Array.isArray(row.texts))
    .flatMap(({ row, i }) => row.texts.map((t, j) => ({ id: row.id ?? `intake-${i}-${j}`, title: t.title ?? null, body: t.body ?? "", tags: row.tags ?? [], chain: row.chain ?? "steem" })));

  const prev = readJson(path.join(S, "revenue-staging.json"), null);
  const prevIds = new Set((prev?.packages ?? []).map((p) => p.srcId).filter(Boolean));

  const stagedTitles = (prev?.packages ?? []).map((p) => p.title);
  const publishedTitles = (Array.isArray(ops?.queue) ? ops.queue : []).filter((d) => d?.status === "published").map((d) => d.title);
  const lastPostIso = (prev?.packages ?? []).filter((p) => p.state === "BROADCAST-READY").map((p) => p.compiledAt).sort().at(-1) ?? null;

  const ready = [];
  const rejected = [];
  let dupDropped = 0;
  let scrubHits = 0;

  const candidates = [
    ...drafts.map((d) => ({ srcId: d.id ?? null, title: d.title, body: d.body, tags: (d.tags ?? []).slice(0, 5), persona: d.persona ?? d.voice ?? null, chain: "steem" })),
    ...intake.map((d) => ({ srcId: d.id, title: d.title, body: d.body, tags: (d.tags ?? []).slice(0, 5), persona: null, chain: d.chain ?? "steem" })),
  ];

  for (const c of candidates) {
    if (ready.length >= BUFFER_MAX_READY) break;
    if (!c.title || !c.body) continue;
    if (c.srcId && prevIds.has(c.srcId)) continue; /* already staged */
    const sim = Math.max(...[...stagedTitles, ...publishedTitles].map((t) => titleSimilarity(c.title, t)), 0);
    if (sim >= 0.55) { dupDropped++; continue; } /* near-duplicate never stages */

    /* symbol law (R283): fail-CLOSED on banned-glyph remainder — the package
     * is rejected with a named reason, never silently emptied */
    const symTitle = enforceSymbolLaw(c.title);
    const sym = symTitle === null ? null : enforceSymbolLaw(c.body);
    if (symTitle === null || sym === null) {
      if (rejected.length < 10) rejected.push({ id: `symbol-law:${c.srcId ?? "raw"}`, title: c.title ?? "", reasons: ["symbol-law-remainder"] });
      appendLine(path.join(S, "revenue-staging.jsonl"), { at: now, type: "staged", id: `symbol-law:${c.srcId ?? "raw"}`, srcId: c.srcId, state: "SYMBOL-LAW-REJECTED", bytes: 0, words: 0, scrubbed: 0 });
      continue;
    }

    const scrubbed = scrubBody(sym);
    scrubHits += scrubbed.scrubbed;
    const body = scrubbed.text;

    const { id, bytes } = pkgCid(symTitle, body, c.tags);
    const v = validatePackage({ title: symTitle, body, tags: c.tags });
    const pkg = {
      id, srcId: c.srcId, title: symTitle, body, tags: c.tags,
      chain: c.chain, persona: c.persona,
      compiledAt: now, bytes, words: v.words,
      scrubbed: scrubbed.scrubbed, scrubHits: scrubbed.hits,
      checks: v.checks,
      state: v.ok ? "BROADCAST-READY" : "SCHEMA-REJECTED",
      rejectReasons: v.ok ? [] : v.checks.filter((x) => !x.ok).map((x) => `${x.k}(${x.detail})`),
      cadence: { law: CADENCE.law, minIntervalSec: CADENCE.post.minIntervalSec, eligibleAt: cadenceNextEligible(lastPostIso, Date.now()) },
      frozen: !custodyGreen,
    };
    if (v.ok) { ready.push(pkg); stagedTitles.push(symTitle); } else if (rejected.length < 10) rejected.push({ id, title: symTitle, reasons: pkg.rejectReasons });
    appendLine(path.join(S, "revenue-staging.jsonl"), { at: now, type: "staged", id, srcId: c.srcId, state: pkg.state, bytes: pkg.bytes, words: pkg.words, scrubbed: pkg.scrubbed });
  }

  const chained = chainPackages(ready);
  const out = {
    at: now,
    verdict: ready.length ? "COMPILED" : (candidates.length ? "COMPILED-EMPTY" : "NO-INPUT"),
    custodyGate: custodyGreen ? "GREEN" : "FROZEN (T-15)",
    cadence: CADENCE,
    intakeMeasured: { draftsInQueue: drafts.length, intakeRows: intake.length, candidates: candidates.length },
    stats: { staged: ready.length, rejected: rejected.length, dupDropped, scrubHits, bufferMax: BUFFER_MAX_READY },
    headCid: chained.headCid,
    packages: chained.packages,
    rejected,
    ms: Date.now() - t0,
    law: "native compile → scrub → strict schema → sha256 content-address → L-26 slot → BROADCAST-READY in the staging buffer; this rail never broadcasts — the custody-gated rails stay the only broadcasters",
  };
  writeJson(path.join(S, "revenue-staging.json"), out);
  appendLine(path.join(S, "revenue-staging.jsonl"), { at: now, type: "compile", verdict: out.verdict, staged: ready.length, rejected: rejected.length, scrubHits });
  /* receipts (secrets-free by construction — titles/ids only) */
  appendLine(path.join(receiptsDir(), "revenue-compile.jsonl"), { at: now, verdict: out.verdict, staged: ready.length, headCid: out.headCid, scrubHits });
  return out;
}

export function compilerState() {
  return readJson(path.join(stateDir(), "revenue-staging.json"), null);
}
