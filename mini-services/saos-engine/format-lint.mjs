/**
 * format-lint.mjs — R328 · PER-FRONT FORMAT LINT (T-87, trace 1a1395305bec3371)
 *
 * Queue item #3 of the Open-Pomelli deep-dive (intel §5.3, T-84): Pomelli's
 * platforms.ts keeps per-platform COPY LIMITS — the shape of adaptation.
 * Made sovereignty-native over OUR measured reality: the same drafts queue
 * feeds TWO live fronts (steem: army-social permlinkStem; hive: the R263
 * rail with slugPermlink) — and a format violation is discovered today only
 * AFTER the chain rejects the broadcast (wasted RC, a REJECTED receipt, an
 * event nobody reads until forensics). The R297 lesson at the format layer:
 * front shape is a CONTRACT, and contracts can be linted BEFORE speaking.
 *
 * Every limit below is MEASURED, not invented:
 *   - title ≤ 255 bytes: graphene chains reject longer titles (MAX title
 *     contract); the rails never checked it before broadcast.
 *   - hive permlink MUST start with a letter: measured in hive.mjs's own
 *     law ("the node contract") — steem accepts digit-start, hive does not.
 *   - hive permlink ≤ 64 + [a-z0-9-]: slugPermlink's own signed law.
 *   - steem stem ≤ 60 slug + day + index: permlinkStem's own shape.
 *   - tags: [a-z0-9-], ≤ 24 chars each, ≤ 5 total after the community
 *     prepend (frontends surface 5; the 6th is silently dropped — optics).
 *   - body ≥ MIN_POST_WORDS (300, R244 spam-safety floor, content.mjs).
 *   - hive persona-fit wants draft.persona — a missing one silently trades
 *     affinity (R263 fallback); a WARNING, never a veto.
 *
 * LAWS:
 *  - ONE source of truth for permlink shapes: this module does NOT
 *    re-implement the builders — it imports each front's own (permlinkStem,
 *    slugPermlink) and lints their OUTPUT. Two slug builders would be the
 *    exact drift class this fleet hunts.
 *  - OBSERVE-ONLY by default: the report seals into
 *    state/format-lint-latest.json and the heartbeat. ENFORCEMENT arms ONLY
 *    when the signed DNA sets memory.formatEnforce=true — the R307/R307-R307
 *    observe→enforce pattern, never an open gate (spamgate/R297/R301/R302
 *    keep every door they closed).
 *  - Deterministic: no clock, no randomness. The permlink probe uses a
 *    fixed PROBE_DAY — linting checks SHAPE, not the calendar.
 *  - Fail-honest: an unlintable draft yields a violation, never a crash.
 */

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { MIN_POST_WORDS } from "./content.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);

export const PROBE_DAY = "1970-01-01"; // fixed probe day — SHAPE, not calendar
export const LINT_MAX_DRAFTS = 40;     // per beat, matches the queue scale

/* ── the measured front contracts ─────────────────────────────────────────── */
export const FRONT_LIMITS = {
  steem: {
    active: true,           // army-social rail is live
    titleMaxBytes: 255,
    permlinkMax: 255,       // chain hard limit; permlinkStem ships ≤ ~72
    permlinkRe: /^[a-z0-9-]+$/,
    permlinkLetterStart: false, // steem accepts digit-start
    stemMax: 60,            // permlinkStem's own slug budget
    tagRe: /^[a-z0-9-]+$/,
    tagMaxLen: 24,
    tagsMax: 5,
    minWords: MIN_POST_WORDS,
  },
  hive: {
    active: true,           // R263 rail is live
    titleMaxBytes: 255,
    permlinkMax: 64,        // slugPermlink's signed law
    permlinkRe: /^[a-z0-9-]+$/,
    permlinkLetterStart: true, // hive node contract (measured, hive.mjs)
    stemMax: 64,
    tagRe: /^[a-z0-9-]+$/,
    tagMaxLen: 24,
    tagsMax: 5,
    minWords: MIN_POST_WORDS,
  },
  blurt: {
    active: false,          // custody/RC lanes exist; NO post op in the heartbeat yet (measured)
    titleMaxBytes: 255,
    permlinkMax: 64,
    permlinkRe: /^[a-z0-9-]+$/,
    permlinkLetterStart: false,
    stemMax: 64,
    tagRe: /^[a-z0-9-]+$/,
    tagMaxLen: 24,
    tagsMax: 5,
    minWords: MIN_POST_WORDS,
  },
};

/* ── canonical signature (R306/R327 pattern) ─────────────────────────────── */
export function stableStringify(v) {
  if (Array.isArray(v)) return `[${v.map((x) => stableStringify(x)).join(",")}]`;
  if (v && typeof v === "object") {
    const keys = Object.keys(v).filter((k) => v[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}
export function signLint(doc) {
  const { signature, ...rest } = doc ?? {};
  return "sig:" + createHash("sha256").update(stableStringify(rest)).digest("hex").slice(0, 8);
}

const words = (s) => String(s ?? "").trim().split(/\s+/).filter(Boolean).length;

/* ── the permlink builders, IMPORTED (single source of truth) ──────────────
 * steem: army-social.permlinkStem(title, day, i) — live rail's exact bytes.
 * hive:  hive.slugPermlink(title, fallback)     — live rail's exact bytes.
 * blurt: no live builder yet → steem's stem as the probe shape (marked
 *        inactive in FRONT_LIMITS; the lint still reports shape honestly). */
export async function derivePermlink(draft, front, { i = 0, day = PROBE_DAY } = {}) {
  const title = String(draft?.title ?? "");
  if (front === "hive") {
    const { slugPermlink } = await import("./hive.mjs");
    return slugPermlink(title, draft?.id ?? "");
  }
  const { permlinkStem } = await import("./army-social.mjs");
  return permlinkStem(title, day, i);
}

/* ── the pure core: lint ONE draft against ONE front ─────────────────────── */
export function lintOne({ draft, front, permlink, limits = FRONT_LIMITS[front] } = {}) {
  if (!limits) return { front, ok: false, violations: [{ rule: "front-unknown", got: front }], warnings: [] };
  const title = String(draft?.title ?? "");
  const body = String(draft?.body ?? "");
  const violations = [];
  const warnings = [];
  /* title: bytes, not chars — the chain counts bytes (Hebrew/emoji drafts!) */
  const titleBytes = Buffer.byteLength(title, "utf8");
  if (!title.trim()) violations.push({ rule: "title-empty", got: JSON.stringify(title).slice(0, 40) });
  else if (titleBytes > limits.titleMaxBytes) violations.push({ rule: "title-bytes", got: titleBytes, limit: limits.titleMaxBytes });
  else if (title.length < 12) warnings.push({ rule: "title-thin", got: title.length, limit: 12 }); // content.mjs's own thin law
  /* permlink: the EXACT bytes each front's own builder would ship */
  const pm = String(permlink ?? "");
  if (!pm) violations.push({ rule: "permlink-empty" });
  else {
    if (pm.length > limits.permlinkMax) violations.push({ rule: "permlink-length", got: pm.length, limit: limits.permlinkMax });
    if (!limits.permlinkRe.test(pm)) violations.push({ rule: "permlink-charset", got: pm.slice(0, 40) });
    if (limits.permlinkLetterStart && /^[^a-z]/.test(pm)) violations.push({ rule: "permlink-letter-start", got: pm.slice(0, 12) }); // hive node contract
  }
  /* tags: charset, length, count AFTER the community prepend (steem swaps the
   * first tag for the community name; hive's parent_permlink IS the first tag) */
  const tags = (Array.isArray(draft?.tags) ? draft.tags.filter(Boolean) : []).map((t) => String(t).toLowerCase());
  if (tags.length < 2) violations.push({ rule: "tags-min", got: tags.length, limit: 2 }); // content.mjs's own law
  for (const t of tags) {
    if (!limits.tagRe.test(t)) violations.push({ rule: "tag-charset", got: t.slice(0, 24) });
    else if (t.length > limits.tagMaxLen) violations.push({ rule: "tag-length", got: t.length, limit: limits.tagMaxLen, tag: t.slice(0, 12) });
  }
  if (draft?.community && !tags.includes(String(draft.community).toLowerCase())) {
    if (tags.length + 1 > limits.tagsMax) violations.push({ rule: "tags-count-community", got: tags.length + 1, limit: limits.tagsMax });
  } else if (tags.length > limits.tagsMax) violations.push({ rule: "tags-count", got: tags.length, limit: limits.tagsMax });
  /* body: the R244 spam-safety floor (300 words) */
  const wc = words(body);
  if (wc < limits.minWords) violations.push({ rule: "body-words", got: wc, limit: limits.minWords });
  /* hive persona-fit: a missing persona trades affinity silently (R263) */
  if (front === "hive" && !draft?.persona) warnings.push({ rule: "persona-missing", detail: "hive persona-fit falls back to RC-fit" });
  return { front, ok: violations.length === 0, violations, warnings };
}

/* ── lint a queue across the active fronts ───────────────────────────────── */
export async function lintQueue(drafts, { fronts = ["steem", "hive"], cap = LINT_MAX_DRAFTS } = {}) {
  const out = [];
  for (const draft of (Array.isArray(drafts) ? drafts : []).slice(0, cap)) {
    const perFront = [];
    for (const front of fronts) {
      if (!FRONT_LIMITS[front]?.active) continue;
      let pm = "";
      try { pm = await derivePermlink(draft, front); } catch (e) { pm = ""; }
      perFront.push(lintOne({ draft, front, permlink: pm }));
    }
    out.push({ id: draft?.id ?? null, title: String(draft?.title ?? "").slice(0, 60), fronts: perFront });
  }
  const flat = out.flatMap((d) => d.fronts.map((f) => ({ id: d.id, ...f })));
  return {
    drafts: out.length,
    checked: flat.length,
    violations: flat.reduce((a, f) => a + f.violations.length, 0),
    warnings: flat.reduce((a, f) => a + f.warnings.length, 0),
    okCount: flat.filter((f) => f.ok).length,
    details: out,
  };
}

/* ── seal: one state file, rides the state-churn commits (R303 law) ──────── */
export function sealLint(doc, stateDir, { now, signature = null } = {}) {
  const file = path.join(stateDir, "format-lint-latest.json");
  fs.mkdirSync(stateDir, { recursive: true });
  const sealed = { ...doc, at: now ?? new Date().toISOString(), signature: signature ?? signLint(doc) };
  fs.writeFileSync(file, JSON.stringify(sealed, null, 2));
  return file;
}

/** the heartbeat step body: lint the live queue, honest-degrade always */
export async function runLint({ stateDir, now, queue = null, fronts = ["steem", "hive"], dna = null } = {}) {
  let drafts = queue;
  let source = "arg";
  if (!drafts) {
    try {
      const ops = JSON.parse(fs.readFileSync(path.join(stateDir, "content-ops.json"), "utf8"));
      drafts = Array.isArray(ops?.queue) ? ops.queue : [];
      source = "content-ops";
    } catch { drafts = []; source = "missing"; }
  }
  const report = await lintQueue(drafts, { fronts });
  const enforce = dna?.memory?.formatEnforce === true; /* R307 pattern: armed only by the signed DNA */
  const doc = {
    verdict: report.checked === 0 ? "FORMAT-LINT-EMPTY" : report.violations > 0 ? "FORMAT-LINT-DETECTED" : "FORMAT-LINT-OK",
    observe: !enforce,
    enforce,
    source,
    ...report,
  };
  const signature = signLint(doc);
  const file = sealLint(doc, stateDir, { now, signature });
  return { ...doc, signature, file };
}
