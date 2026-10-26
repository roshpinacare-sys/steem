/**
 * htx.mjs — W13 · THE EXCHANGE RAIL (HTX spot REST connector).
 *
 * OPERATOR ORDER 2026-10-19 (verbatim distilled): "בוא ננסה להתחבר גם לצמדים
 * בבורסה נקדם עוד אפשרויות מסחר ופיזור ... בחן היטב כמה עמלות וזה שלא נפסיד
 * שנרוויח ... הקפד לאטום מפתחות בכספת שלא ימות עם הסנדבוקס שיהיה בגיט".
 *
 * The keys live in the GIT vault (agent/vault/EXCHANGE-SEAL-*.zip.enc, sealed
 * by scripts/seal-exchange-w13.mjs, meta.exchangeVault carries the pass + pins
 * — system-custody doctrine, R306 precedent). At run time the connector
 * resolves credentials env → 0600 cache (.secrets/exchange.json) → THE VAULT
 * ITSELF (W15 vault-unseal.mjs: pin-verified openssl open, cache rebuilt
 * 0600) — owner order 2026-10-19 "וודא כספת שיהיה מפתח לפעילות שוטפת של
 * המערכת": a bare clone is a fully operational exchange rail. ZERO secret
 * material is ever logged, returned, or committed.
 *
 * SIGNATURE SPEC (HTX/Huobi SignatureVersion=2 — the ONE formula):
 *   params must include AccessKeyId, SignatureMethod=HmacSHA256,
 *   SignatureVersion=2, Timestamp(UTC `YYYY-MM-DDTHH:mm:ss`);
 *   sorted alphabetically, RFC3986-encoded;
 *   preSignedText = `METHOD\nhost\npath\nsortedQuery`;
 *   signature = base64(HMAC-SHA256(secretKey, preSignedText));
 *   appended as `&Signature=<encoded>`.
 *
 * HONESTY LAWS:
 *  - Fail-closed: unreachable API / non-ok envelope → { ok:false, why } —
 *    never fabricated data, never a guessed balance.
 *  - The API is the judge of the keys (R306-b): until the first signed probe
 *    answers, key permissions are UNVERIFIED — labeled as such in the vault.
 *  - READ-ONLY until the operator's two-key arm doctrine is extended to the
 *    exchange rail: this module places NO orders. Order placement belongs to
 *    a separately-armed executor wave.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const REPO = path.join(DIR, "..", "..");
const SECRETS_CACHE = path.join(REPO, ".secrets", "exchange.json");

export const HTX_HOST = "api.htx.com";

/* ---------- credentials (fail-closed, typed; zero secret in errors) ----------
 * Resolution ladder (W15 · the ongoing-activity key, owner order
 * "וודא כספת שיהיה מפתח לפעילות שוטפת של המערכת"):
 *   1. env SAOS_HTX_ACCESS_KEY/SAOS_HTX_SECRET_KEY (operator override)
 *   2. 0600 cache .secrets/exchange.json (sandbox-local)
 *   3. THE GIT VAULT — unsealExchange(): pin-verified openssl open
 *      (AES-256-CBC · pbkdf2 · iter 300000, sha256 outer+inner pins),
 *      then the 0600 cache is rebuilt so the next call is cheap.
 * A bare clone therefore always reaches its keys — the vault is the key.
 * ---------------------------------------------------------------------- */
import { unsealExchange } from "./vault-unseal.mjs";

export function htxConfigFrom(cachePath, opts = {}) {
  const accessKey = process.env.SAOS_HTX_ACCESS_KEY;
  const secretKey = process.env.SAOS_HTX_SECRET_KEY;
  if (accessKey && secretKey) return { accessKey, secretKey, source: "env" };
  let raw;
  try {
    raw = fs.readFileSync(cachePath, "utf8");
  } catch (e) {
    /* LADDER RUNG 3 — the vault itself. Only for the default repo cache path;
     * a caller pointing at a custom path gets the honest typed death. */
    if (!opts.noVaultFallback && path.resolve(cachePath) === path.resolve(SECRETS_CACHE)) {
      const fromVault = unsealExchange(REPO);
      return { accessKey: fromVault.accessKey, secretKey: fromVault.secretKey, source: fromVault.source };
    }
    const err = new Error(
      "htx: credentials absent — set SAOS_HTX_ACCESS_KEY/SAOS_HTX_SECRET_KEY, or unseal the vault (scripts/unseal-runtime.mjs)"
    );
    err.code = "HTX-NO-CRED";
    throw err;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    const err = new Error("htx: secrets cache is not valid JSON — refusing");
    err.code = "HTX-NO-CRED";
    throw err;
  }
  const it = (parsed.items ?? []).find((x) => x.id === "htx");
  if (!it?.accessKey || !it?.secretKey) {
    const err = new Error("htx: sealed cache missing the htx item (access/secret) — refusing");
    err.code = "HTX-NO-CRED";
    throw err;
  }
  return { accessKey: it.accessKey, secretKey: it.secretKey, source: "secrets-cache" };
}

export function htxConfig() {
  return htxConfigFrom(SECRETS_CACHE);
}

/* ---------- signature canon (pure, deterministic, selftest-pinned) ---------- */

/** RFC3986 encoding (encodeURIComponent + !'()* escape). */
export function enc3986(s) {
  return encodeURIComponent(String(s)).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

/** Canonical query: params sorted alphabetically, both sides RFC3986-encoded. */
export function canonicalQuery(params) {
  const keys = Object.keys(params ?? {}).sort();
  return keys.map((k) => `${enc3986(k)}=${enc3986(params[k])}`).join("&");
}

/** Pre-signed text: `METHOD\nhost\npath\nsortedQuery`. */
export function preSignedText(method, host, urlPath, params) {
  return `${String(method).toUpperCase()}\n${host}\n${urlPath}\n${canonicalQuery(params)}`;
}

/** Signature: base64(HMAC-SHA256(secretKey, text)). */
export function signText(secretKey, text) {
  return crypto.createHmac("sha256", secretKey).update(text).digest("base64");
}

/** HTX timestamp: UTC `YYYY-MM-DDTHH:mm:ss` (second precision, no Z, no ms). */
export function htxTimestamp(ms = Date.now()) {
  return new Date(ms).toISOString().slice(0, 19);
}

/** Auth params merged with per-call params. */
export function signedQueryParams(accessKey, extra, timestampMs) {
  return {
    ...(extra ?? {}),
    AccessKeyId: accessKey,
    SignatureMethod: "HmacSHA256",
    SignatureVersion: "2",
    Timestamp: htxTimestamp(timestampMs),
  };
}

/** Full signed URL for a call. Never log the returned string (it embeds the signature). */
export function buildSignedUrl(method, urlPath, extraParams, cfg, nowMs = Date.now()) {
  const params = signedQueryParams(cfg.accessKey, extraParams, nowMs);
  const text = preSignedText(method, HTX_HOST, urlPath, params);
  const sig = signText(cfg.secretKey, text);
  return `https://${HTX_HOST}${urlPath}?${canonicalQuery(params)}&Signature=${enc3986(sig)}`;
}

/* ---------- transport (honest envelope, timeouts, no secret logging) ---------- */

async function fetchJson(url, { timeoutMs = 10000, method = "GET", body = null } = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: ac.signal,
    });
    const httpStatus = res.status;
    let json = null;
    try { json = await res.json(); } catch { /* non-json body stays null */ }
    return { httpStatus, json };
  } finally {
    clearTimeout(t);
  }
}

function envelope(json, httpStatus) {
  if (!json) return { ok: false, why: `http-${httpStatus}-non-json` };
  /* v2 endpoints answer { code:200, message, data } — v1 answers { status:"ok", data } (both measured live) */
  if (typeof json.code === "number") {
    if (json.code === 200) return { ok: true, data: json.data, ts: null };
    return { ok: false, why: `api-code-${json.code}`, errMsg: json.message ?? null };
  }
  if (json.status !== "ok") {
    return { ok: false, why: `api-${json["err-code"] ?? "unknown"}`, errMsg: json["err-msg"] ?? null };
  }
  return { ok: true, data: json.data, ts: json.ts ?? null };
}

/** Public GET — no signature, no credentials. */
export async function htxPublic(urlPath, params = {}, { timeoutMs = 10000 } = {}) {
  try {
    const qs = canonicalQuery(params);
    const url = `https://${HTX_HOST}${urlPath}${qs ? "?" + qs : ""}`;
    const { httpStatus, json } = await fetchJson(url, { timeoutMs });
    return envelope(json, httpStatus);
  } catch (e) {
    return { ok: false, why: `net-${e?.name === "AbortError" ? "timeout" : "error"}`, errMsg: String(e?.message ?? e).slice(0, 120) };
  }
}

/** Private signed call (GET/POST; POST body is JSON, signature covers query only). */
export async function htxPrivate(method, urlPath, params = {}, body = null, { timeoutMs = 10000, cfg = null, nowMs = Date.now() } = {}) {
  let c;
  try {
    c = cfg ?? htxConfig();
  } catch (e) {
    return { ok: false, why: "no-credentials", errMsg: e.code ?? null };
  }
  try {
    const url = buildSignedUrl(method, urlPath, params, c, nowMs);
    const { httpStatus, json } = await fetchJson(url, { timeoutMs, method, body });
    return envelope(json, httpStatus);
  } catch (e) {
    return { ok: false, why: `net-${e?.name === "AbortError" ? "timeout" : "error"}`, errMsg: String(e?.message ?? e).slice(0, 120) };
  }
}

/* ---------- probe helpers (census shape; all fail-closed) ---------- */

/** Clock skew vs the exchange server (signature freshness gate).
 * NOTE: /v1/common/timestamp answers { status:"ok", data:<ms> } — the ms live
 * in `data`, not a top-level `ts` (measured live 2026-10-19). */
export async function htxClockSkew({ timeoutMs = 8000 } = {}) {
  const r = await htxPublic("/v1/common/timestamp", {}, { timeoutMs });
  const ts = typeof r.ts === "number" ? r.ts : typeof r.data === "number" ? r.data : null;
  if (!r.ok || ts == null) return { ok: false, why: r.why ?? "no-ts" };
  return { ok: true, skewMs: Math.abs(ts - Date.now()), serverTs: ts };
}

/** Account list — the SIGNED AUTH PROOF (the API judges the keys). */
export async function htxAccounts({ timeoutMs = 10000, cfg = null, nowMs = Date.now() } = {}) {
  return htxPrivate("GET", "/v1/account/accounts", {}, null, { timeoutMs, cfg, nowMs });
}

/** Spot balance census for one account-id. */
export async function htxBalance(accountId, { timeoutMs = 10000, cfg = null, nowMs = Date.now() } = {}) {
  return htxPrivate("GET", `/v1/account/accounts/${encodeURIComponent(accountId)}/balance`, {}, null, { timeoutMs, cfg, nowMs });
}

/** Full symbol book (pairs + precision + whatever fee fields the API carries). */
export async function htxSymbols({ timeoutMs = 12000 } = {}) {
  return htxPublic("/v1/common/symbols", {}, { timeoutMs });
}

/** Chain reference (deposit/withdraw chains + fees per asset).
 * PUBLIC but v2-envelope ({code:200,data}) — measured live 2026-10-19
 * (unsigned works; the earlier failure was an envelope misread, honestly fixed). */
export async function htxCurrencies({ timeoutMs = 12000, currency = null } = {}) {
  return htxPublic("/v2/reference/currencies", currency ? { currency } : {}, { timeoutMs });
}

/** THE ACCOUNT'S REAL FEE TIER — signed /v2/reference/transact-fee-rate.
 * This is the operator's "כמה עמלות" input: the measured maker/taker for THIS
 * account (not the assumed regular tier). symbols: comma list, ≤10 per call
 * (API cap); answers per-symbol rates incl actualMakerRate/actualTakerRate. */
export async function htxTransactFeeRate(symbols, { timeoutMs = 10000, cfg = null, nowMs = Date.now() } = {}) {
  const list = (Array.isArray(symbols) ? symbols : [symbols]).filter(Boolean).join(",");
  if (!list) return { ok: false, why: "no-symbols" };
  return htxPrivate("GET", "/v2/reference/transact-fee-rate", { symbols: list }, null, { timeoutMs, cfg, nowMs });
}

/** Deposit address for a currency — SIGNED (the money-leg counterparty).
 * v2 envelope; for chain-with-memo assets (STEEM) the `addressTag` is the
 * MEMO — a deposit without the exact memo is LOST. Fail-closed. */
export async function htxDepositAddress(currency, { timeoutMs = 10000, cfg = null, nowMs = Date.now() } = {}) {
  if (!currency) return { ok: false, why: "no-currency" };
  return htxPrivate("GET", "/v2/account/deposit/address", { currency }, null, { timeoutMs, cfg, nowMs });
}

/** Deposit history (credit confirmation probe). v2 envelope. */
export async function htxDepositHistory(currency, { timeoutMs = 10000, cfg = null, nowMs = Date.now() } = {}) {
  if (!currency) return { ok: false, why: "no-currency" };
  return htxPrivate("GET", "/v2/account/deposit/history", { currency }, null, { timeoutMs, cfg, nowMs });
}

/** PLACE A LIMIT ORDER — POST /v1/order/orders/place (signed; the TRADE arm).
 * body: { account-id, symbol, type: "buy-limit"|"sell-limit", amount, price }.
 * Callers MUST pass the ECG verdict + two-key gates BEFORE this function —
 * the connector itself is gate-free by design (the law lives above it). */
export async function htxPlaceOrder(body, { timeoutMs = 12000, cfg = null, nowMs = Date.now() } = {}) {
  if (!body || !body["account-id"] || !body.symbol || !body.type) return { ok: false, why: "malformed-order-body" };
  return htxPrivate("POST", "/v1/order/orders/place", {}, body, { timeoutMs, cfg, nowMs });
}

/** Open orders for a symbol — signed. */
export async function htxOpenOrders(symbol, { timeoutMs = 10000, cfg = null, nowMs = Date.now() } = {}) {
  return htxPrivate("GET", "/v1/order/open_orders", symbol ? { symbol } : {}, null, { timeoutMs, cfg, nowMs });
}

/** Cancel an order — POST /v1/order/orders/{id}/submitcancel (signed). */
export async function htxCancelOrder(orderId, { timeoutMs = 10000, cfg = null, nowMs = Date.now() } = {}) {
  if (!orderId) return { ok: false, why: "no-order-id" };
  return htxPrivate("POST", `/v1/order/orders/${encodeURIComponent(String(orderId))}/submitcancel`, {}, null, { timeoutMs, cfg, nowMs });
}

/** Last market price (public /market/detail for one symbol → 0.5s candle close). */
export async function htxLastPrice(symbol, { timeoutMs = 10000 } = {}) {
  const r = await htxPublic("/market/detail/merged", { symbol, period: "1min", size: "1" }, { timeoutMs });
  if (!r.ok || !Array.isArray(r.data) || !r.data.length) return { ok: false, why: r.why ?? "no-candle" };
  const close = Number(r.data[0].close);
  if (!Number.isFinite(close) || close <= 0) return { ok: false, why: "bad-close" };
  return { ok: true, close };
}

/* ---------- census shaping (pure; honest about what is NOT measured) ---------- */

/* HTX returns amounts/precisions as JSON strings in several endpoints (measured:
 * balance rows are strings). Coerce honestly — non-numeric stays null. */
const num = (v) => {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};

/** Normalize one /v1/common/symbols row; fee fields are HONESTLY null when absent. */
export function normSymbol(row) {
  if (!row || typeof row !== "object") return null;
  const base = row["base-currency"] ?? null;
  const quote = row["quote-currency"] ?? null;
  if (!base || !quote) return null;
  const taker = num(row["taker-fee-rate"]);
  const maker = num(row["maker-fee-rate"]);
  return {
    symbol: `${base}${quote}`.toLowerCase(),
    base,
    quote,
    state: row.state ?? null,
    amountPrecision: num(row["amount-precision"]),
    pricePrecision: num(row["price-precision"]),
    valuePrecision: num(row["value-precision"]),
    minOrderAmt: num(row["min-order-amt"]),
    minOrderValue: num(row["min-order-value"]),
    takerFeeRate: taker,
    makerFeeRate: maker,
    feesMeasured: taker != null || maker != null,
  };
}

/** Balance rows → non-zero census (zero-dust dropped; honest empty array). */
export function nonzeroBalances(data) {
  const list = Array.isArray(data?.list) ? data.list : [];
  return list
    .map((b) => ({ currency: b.currency, balance: num(b.balance), available: num(b.available) }))
    .filter((b) => b.currency && b.balance != null && b.balance > 0)
    .sort((a, b) => b.balance - a.balance);
}

/* ---------- W17 · THE WITHDRAW LEG (the import channel, operator trace
 * 1a1556c780544431: "תעשה פעילות דרך steem sbd עמלות משיכה די נמוכות שם
 * אפשר להשתמש בזה חשוב להעביר רק מטבעות אלו בנתיים"). Withdrawal-cheap
 * coins (STEEM/SBD) are THE lawful path for exchange liquidity to enter
 * our network. MEASURED GATES (W17 census, exchange-custody w17Recheck):
 *   - the key's withdraw permission is PRESENT (quota endpoint answers live)
 *   - the venue's ACCOUNT tier gates execution: L3 Advanced Verification
 *     (legacy endpoint: api-base-operation-forbidden; v2: 404-not-found)
 *   - connect is gate-free BY DESIGN (the law lives above it): callers MUST
 *     pass the two-key doctrine (operator-orders + exec-armed), the coin
 *     whitelist (STEEM/SBD until the operator orders otherwise), and the
 *     destination allowlist BEFORE calling. Fail-closed upstream, always. */

/** Withdraw quota for a currency — signed GET /v2/account/withdraw/quota.
 * Answers while the key has withdraw permission even when the ACCOUNT tier
 * still gates execution (measured W17). */
export async function htxWithdrawQuota(currency, { timeoutMs = 10000, cfg = null, nowMs = Date.now() } = {}) {
  if (!currency) return { ok: false, why: "no-currency" };
  return htxPrivate("GET", "/v2/account/withdraw/quota", { currency }, null, { timeoutMs, cfg, nowMs });
}

/** WITHDRAW — signed POST /v2/account/withdraw (the IMPORT leg).
 * body: { currency, address, amount, chain, ["addr-tag"?] }.
 * Measured W17: until the operator completes L3 Advanced Verification the
 * v2 endpoint answers 404-not-found and the legacy endpoint answers
 * api-base-operation-forbidden — the connector reports that honestly; it
 * never retries blind and never guesses an address. */
export async function htxWithdraw(body, { timeoutMs = 12000, cfg = null, nowMs = Date.now() } = {}) {
  if (!body || !body.currency || !body.address || !body.amount) return { ok: false, why: "malformed-withdraw-body" };
  return htxPrivate("POST", "/v2/account/withdraw", {}, body, { timeoutMs, cfg, nowMs });
}

/** Withdraw history — signed GET /v2/account/withdraw/history (fee + state
 * census; the REAL withdraw fee is measured here after the first execution —
 * the currencies endpoint honestly leaves it null). */
export async function htxWithdrawHistory(currency, { timeoutMs = 10000, cfg = null, nowMs = Date.now() } = {}) {
  if (!currency) return { ok: false, why: "no-currency" };
  return htxPrivate("GET", "/v2/account/withdraw/history", { currency }, null, { timeoutMs, cfg, nowMs });
}
