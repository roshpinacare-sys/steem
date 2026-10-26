/**
 * external-quotes.mjs — W27-c · THE REAL-MONEY PRICE ANCHOR (owner trace
 * 1a15c67385c253b5: "חשוב לוודא שיש לנו דרך לקבל תזרים אמיתי מבחוץ").
 * ═══════════════════════════════════════════════════════════════════════
 * WHAT: read-only, keyless public quotes from REAL external markets for
 * STEEM and SBD, every 5 minutes. The internal DEX (STEEM/SBD limit orders)
 * is OURS; these are the prices the outside world pays:
 *   - Poloniex   STEEM_USDT   (real venue, STEEM listed, wallets live)
 *   - Bithumb    STEEM_KRW    (the historic Korean STEEM market)
 *   - CoinGecko  steem + steem-dollars in USD (aggregator fallback + SBD/USD)
 *   - Frankfurter KRW→USD    (ECB daily rate, converts Bithumb KRW)
 *
 * WHY: the SBD/STEEM book cannot price itself against nothing. The implied
 * cross unit (SBD per STEEM) = steemUsd / sbdUsd is the real-money anchor:
 *   1. hyper/dexflow parity triggers sharpen on it (REAL outside, not just
 *      the internal feed),
 *   2. the arb-watch verdict measures the internal↔external gap honestly —
 *      when the FF lane activates (ff-gate.mjs), we already KNOW what the
 *      outside pays before any money moves.
 *
 * LAWS: read-only public endpoints, zero credentials, zero signing, gentle
 * 300s cadence with per-venue timeouts; every value carries its `at`;
 * stale stays labeled; a venue failing NEVER corrupts the last good anchor
 * (venues report their own ok/at). ATOMIC-WRITE law (tmp+rename).
 */
import * as fs from "node:fs";
import * as path from "node:path";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const STATE = path.join(DIR, "state");
const EQ_FILE = path.join(STATE, "external-quotes.json");
const EVENTS_FILE = path.join(STATE, "events.jsonl");

const writeJson = (p, v) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(v, null, 2));
  fs.renameSync(tmp, p);
};
const appendLine = (p, v) => { try { fs.appendFileSync(p, JSON.stringify(v) + "\n"); } catch { /* best-effort */ } };

export const EXTQ_DEFAULTS = {
  cadenceSec: 300,      // gentle: one sweep per 5 minutes, keyless public reads
  timeoutMs: 8000,
  staleMs: 15 * 60_000, // anchor older than this = STALE for consumers
};

let timer = null;
let startedAt = null;
const G = globalThis;

const jfetch = async (url, timeoutMs) => {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctl.signal, headers: { "User-Agent": "saos-sovereign/1.0 (read-only public quotes)" } });
    if (!res.ok) return { ok: false, err: `http-${res.status}` };
    return { ok: true, json: await res.json() };
  } catch (e) {
    return { ok: false, err: String(e?.message ?? e).slice(0, 80) };
  } finally { clearTimeout(t); }
};

const num = (x) => { const n = Number(x); return Number.isFinite(n) && n > 0 ? n : 0; };

/* W27-c PURE ANCHOR MATH (selftest-covered): median of the live USD prints
 * resists one lying venue; the implied cross unit (SBD per STEEM, same axis
 * as the internal book) = steemUsd / sbdUsd. Deterministic, no I/O. */
export function computeAnchor({ prints, sbdUsd }) {
  const ps = (Array.isArray(prints) ? prints : []).map(num).filter((v) => v > 0).sort((a, b) => a - b);
  const steemUsd = ps.length ? ps[Math.floor(ps.length / 2)] : 0;
  const s = num(sbdUsd);
  return {
    steemUsd: Math.round(steemUsd * 1e6) / 1e6,
    sbdUsd: Math.round(s * 1e6) / 1e6,
    impliedUnitSbdPerSteem: steemUsd > 0 && s > 0 ? Math.round((steemUsd / s) * 1e6) / 1e6 : 0,
    ok: steemUsd > 0 && s > 0,
  };
}

/* one venue sweep — each venue stands alone (one failing never lies for all) */
async function sweep(timeoutMs) {
  const now = new Date().toISOString();
  const [polo, bithumb, gecko, fx] = await Promise.all([
    jfetch("https://api.poloniex.com/markets/price?symbol=STEEM_USDT", timeoutMs),
    jfetch("https://api.bithumb.com/public/ticker/STEEM_KRW", timeoutMs),
    jfetch("https://api.coingecko.com/api/v3/simple/price?ids=steem,steem-dollars&vs_currencies=usd", timeoutMs),
    /* KRW→USD: ECB frankfurter lacks KRW (measured) → open.er-api.com is the primary */
    jfetch("https://open.er-api.com/v6/latest/KRW", timeoutMs),
  ]);

  const venues = { at: now };
  if (polo.ok) venues.poloniexSteemUsdt = { usd: num(polo.json?.price), at: now };
  else venues.poloniexSteemUsdt = { usd: 0, err: polo.err, at: now };

  if (gecko.ok) {
    venues.geckoSteemUsd = { usd: num(gecko.json?.steem?.usd), at: now };
    venues.geckoSbdUsd = { usd: num(gecko.json?.["steem-dollars"]?.usd), at: now };
  } else { venues.geckoSteemUsd = { usd: 0, err: gecko.err, at: now }; venues.geckoSbdUsd = { usd: 0, err: gecko.err, at: now }; }

  if (bithumb.ok) {
    const krw = num(bithumb.json?.data?.closing_price);
    const usdKrw = fx.ok ? num(fx.json?.rates?.USD) : 0; /* KRW→USD rate (1 KRW = r USD) */
    venues.bithumbSteemKrw = krw > 0 ? { krw, usd: usdKrw > 0 ? krw * usdKrw : 0, at: now } : { krw: 0, err: "no-price", at: now };
  } else venues.bithumbSteemKrw = { krw: 0, err: bithumb.err, at: now };

  /* the anchor: median of the live USD prints (median resists one lying venue) */
  const anchor = computeAnchor({ prints: [venues.poloniexSteemUsdt.usd, venues.bithumbSteemKrw.usd, venues.geckoSteemUsd.usd], sbdUsd: venues.geckoSbdUsd.usd });

  const prev = readPrev();
  const out = {
    at: now,
    ok: anchor.ok,
    steemUsd: anchor.steemUsd,
    sbdUsd: anchor.sbdUsd,
    impliedUnitSbdPerSteem: anchor.impliedUnitSbdPerSteem || (prev?.impliedUnitSbdPerSteem ?? 0),
    venues,
    staleMs: EXTQ_DEFAULTS.staleMs,
    note: "keyless public reads · median of live USD prints · implied cross unit = steemUsd/sbdUsd (SBD per STEEM, same axis as the internal book)",
  };
  if (out.ok !== prev?.ok) appendLine(EVENTS_FILE, { type: "external-quotes.anchor", at: now, ok: out.ok, steemUsd: out.steemUsd, sbdUsd: out.sbdUsd, implied: out.impliedUnitSbdPerSteem });
  writeJson(EQ_FILE, out);
  return out;
}

function readPrev() { try { return JSON.parse(fs.readFileSync(EQ_FILE, "utf8")); } catch { return null; } }

export function externalQuotesState() {
  const st = readPrev();
  if (!st) return { ok: false, status: "NO-READ-YET" };
  const age = Date.now() - (Date.parse(st.at) || 0);
  return { ...st, status: age <= (st.staleMs ?? EXTQ_DEFAULTS.staleMs) ? (st.ok ? "LIVE" : "PARTIAL") : "STALE", ageSec: Math.round(age / 1000) };
}

export async function tickQuotes() {
  try { await sweep(EXTQ_DEFAULTS.timeoutMs); } catch (e) {
    writeJson(EQ_FILE, { ...(readPrev() ?? {}), lastError: String(e?.message ?? e).slice(0, 120), lastErrorAt: new Date().toISOString() });
  }
}

export function startExternalQuotes() {
  if (G.__saosExtQTimer) clearInterval(G.__saosExtQTimer);
  startedAt = new Date().toISOString();
  G.__saosExtQTimer = setInterval(() => { void tickQuotes(); }, EXTQ_DEFAULTS.cadenceSec * 1000);
  void tickQuotes();
  return { started: true, startedAt, cadenceSec: EXTQ_DEFAULTS.cadenceSec };
}
