/* SAOS DATA-SANITIZE (exec34, lane 34-d) — the sanitized-data-ingest ear.
 *
 * LAW PROVENANCE — owner's exec34 Hyper-Sovereignty directive (sanitized
 * data ingest): untrusted market text (RSS items, financial reports, feed
 * entries) may enter the engine ONLY after deterministic scrubbing and
 * ONLY through the 34-a2 kernel guardrail — `screenInput` runs on every
 * sanitized string, and a strong-hit denial is FAIL-CLOSED (the text is
 * withheld entirely, never passed through, never "repaired" into
 * existence). Registry number pending (R343+). Feeds `runIsolated`
 * payloads ONLY: nothing this module produces is ever executed, signed,
 * broadcast, or routed to a broker.
 *
 * THE TASE UNIVERSE — static, offline, frozen. Israeli (Tel Aviv Stock
 * Exchange) majors + fleet-native symbols. The `.TA` suffix is the
 * RESOLUTION CONVENTION, explicit: a TASE ticker resolves ONLY with the
 * suffix ("LEUMI.TA" resolves; bare "LEUMI" → null — unknown means null,
 * never invented). No API, no network, no quotes: this is a symbol map,
 * not a market feed.
 *
 * PAPER-ONLY LAW: STEEM/SBD/HBD/HIVE are the sovereignty's own paper
 * economy (saos-dex grids + ledger, R328 lineage, DECISIONS #12/#17);
 * BTC/ETH are listed for the paper/analysis layer only. Zero keys, zero
 * value movement, zero broker connectivity — by construction this module
 * cannot move value: it only returns plain JSON strings/numbers.
 *
 * Zero deps: node builtins only + the local kernel-isolation guardrail.
 */

import { screenInput } from "./kernel-isolation.mjs";

/* hard cap (not a knob): sanitized feed text never exceeds this length */
export const MAX_FEED_TEXT_CHARS = 4096;

/* the `.TA` suffix convention, explicit and exported for callers */
export const TASE_SUFFIX = ".TA";

const TA = (t) => Object.freeze({ ticker: t, market: "TASE", currency: "ILS" });
const PA = (t) => Object.freeze({ ticker: t, market: "PAPER", currency: t });
const CR = (t) => Object.freeze({ ticker: t, market: "CRYPTO", currency: t });

/* ── 1 · TASE_UNIVERSE — frozen static symbol map (offline, no API) ──────── */
export const TASE_UNIVERSE = Object.freeze({
  // TASE majors (Israeli equities, quoted in ILS)
  "LEUMI.TA": TA("LEUMI.TA"),
  "NICE.TA": TA("NICE.TA"),
  "TEVA.TA": TA("TEVA.TA"),
  "ICL.TA": TA("ICL.TA"),
  "BEZQ.TA": TA("BEZQ.TA"),
  "CHKPL.TA": TA("CHKPL.TA"),
  "ESLT.TA": TA("ESLT.TA"),
  "MZTF.TA": TA("MZTF.TA"),
  "FIBI.TA": TA("FIBI.TA"),
  "DISH.TA": TA("DISH.TA"),
  // fleet-native paper assets (exist in saos-dex grids/ledger)
  STEEM: PA("STEEM"),
  SBD: PA("SBD"),
  HBD: PA("HBD"),
  HIVE: PA("HIVE"),
  // paper-layer crypto references
  BTC: CR("BTC"),
  ETH: CR("ETH"),
});

/* ── 2 · resolveTicker — case-insensitive lookup, fail-closed to null ────── */
export function resolveTicker(symbol) {
  if (typeof symbol !== "string") return null;
  const key = symbol.trim().toUpperCase();
  if (!key) return null;
  const hit = TASE_UNIVERSE[key];
  return hit || null; // unknown symbol → null. Never invented.
}

/* ── 3 · sanitizeMarketText — untrusted feed text → sandbox-safe string ────
 * Deterministic scrub: strip HTML tags → escape any surviving raw '<'
 * (invariant: no '<' survives, so nothing can re-open a tag) → strip
 * backticks (template-literal injection class) → strip control chars
 * (except \n \t) → strip zero-width/invisible chars → hard length cap with
 * an honest truncation flag. THEN the kernel `screenInput` runs on the
 * result: a strong hit returns { ok:false } and the text is WITHHELD
 * (fail-closed — the caller never receives the hostile string).
 * Flags record exactly what was done — an honest receipt, nothing more. */
export function sanitizeMarketText(text) {
  if (typeof text !== "string") {
    return { ok: false, reason: "text-not-a-string", reasons: ["input-not-a-string"], truncated: false, flags: [] };
  }
  const flags = [];
  let t = text;
  const b1 = t;
  t = t.replace(/<[^>]*>/g, ""); // strip HTML tags
  if (t !== b1) flags.push("html-stripped");
  const b2 = t;
  t = t.replace(/</g, "&lt;"); // escape surviving raw '<' — none may pass
  if (t !== b2) flags.push("html-escaped");
  const b3 = t;
  t = t.replace(/`/g, ""); // strip backticks
  if (t !== b3) flags.push("backticks-stripped");
  const b4 = t;
  t = t.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ""); // control chars except \n \t
  if (t !== b4) flags.push("control-chars-stripped");
  const b5 = t;
  t = t.replace(/[\u200B\u200C\u200D\u200E\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g, ""); // zero-width/invisible
  if (t !== b5) flags.push("zero-width-stripped");
  let truncated = false;
  if (t.length > MAX_FEED_TEXT_CHARS) {
    t = t.slice(0, MAX_FEED_TEXT_CHARS);
    truncated = true;
    flags.push("truncated");
  }
  // kernel guardrail on the RESULT — a strong hit withholds the text entirely
  const screen = screenInput(t);
  if (!screen.allow) {
    return { ok: false, reason: "kernel-input-denied", reasons: screen.reasons, truncated, flags };
  }
  return { ok: true, text: t, truncated, flags };
}

/* ── 4 · buildSandboxPayload — raw feed entries → plain-JSON payload ───────
 * Takes [{source, symbol, title, body, at}], resolves each symbol against
 * the universe (unknown → dropped, counted), sanitizes title+body (a
 * kernel denial drops the whole entry, counted), and returns a plain-JSON
 * payload { at, valid:[...], dropped:N, droppedReasons } suitable to be
 * passed to `runIsolated` (embedded in the code as a JSON const — the
 * SANDBOX_STATE shape). NO executable symbols survive: every field is a
 * plain string/number; JSON.parse(JSON.stringify(payload)) round-trips. */
export function buildSandboxPayload(entries, opts = {}) {
  const at = typeof opts?.at === "string" && opts.at ? opts.at : null;
  const valid = [];
  const droppedReasons = {};
  let dropped = 0;
  const drop = (reason) => { dropped++; droppedReasons[reason] = (droppedReasons[reason] ?? 0) + 1; };
  const list = Array.isArray(entries) ? entries : [];
  for (const e of list) {
    const hit = resolveTicker(e?.symbol);
    if (!hit) { drop("unknown-symbol"); continue; }
    const title = sanitizeMarketText(e?.title);
    if (!title.ok) { drop("kernel-denied-title"); continue; }
    const body = sanitizeMarketText(e?.body);
    if (!body.ok) { drop("kernel-denied-body"); continue; }
    valid.push({
      source: String(e?.source ?? "").slice(0, 64),
      symbol: String(e?.symbol ?? "").slice(0, 32),
      ticker: hit.ticker,
      market: hit.market,
      currency: hit.currency,
      title: title.text,
      body: body.text,
      at: String(e?.at ?? ""),
    });
  }
  return { at, valid, dropped, droppedReasons };
}
