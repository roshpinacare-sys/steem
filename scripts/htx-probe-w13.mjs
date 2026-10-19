/**
 * htx-probe-w13.mjs — W13 · THE EXCHANGE PROBE (סקר-הבורסה החי).
 *
 * READ-ONLY census of the HTX rail, honoring the operator order 2026-10-19:
 * "בחן היטב ... כמה עמלות ... שלא נפסיד שנרוויח". This probe PLACES NO
 * ORDERS and touches NO trade endpoint — census laws only:
 *
 *  1. clock skew vs the exchange (signature freshness gate)
 *  2. symbol book census (pairs, states, precisions, fee fields presence —
 *     honest about fees NOT being in the book when they are not)
 *  3. 24h tickers (public volume census — where the liquidity lives)
 *  4. SIGNED AUTH PROOF (/v1/account/accounts) — the API judges the keys
 *     (R306-b law); this is the first live validation of the sealed vault keys
 *  5. spot balance census per account (non-zero rows only)
 *  6. chain reference census (STEEM/HIVE/TRX/USDT/BTC deposit/withdraw
 *     status + withdrawal fees — the bridge economics input)
 *
 * Output: state/htx-probe.json (committed truth, fingerprints-only w.r.t.
 * secrets) + a console verdict. Fail-closed everywhere: a failed section is
 * recorded honestly and can never fabricate data.
 *
 * Usage: node scripts/htx-probe-w13.mjs
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
  htxConfig, htxClockSkew, htxSymbols, htxAccounts, htxBalance, htxCurrencies,
  htxTransactFeeRate, normSymbol, nonzeroBalances,
} from "../mini-services/saos-engine/htx.mjs";
import { canonicalQuery } from "../mini-services/saos-engine/htx.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const STATE = path.join(DIR, "..", "mini-services", "saos-engine", "state");
const now = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

const out = { at: now(), wave: "W13", rail: "htx", verdict: "PROBE-FAIL", why: null, sections: {} };

async function main() {
  /* config — fail-closed before any network */
  let cfg;
  try {
    cfg = htxConfig();
    out.sections.config = { ok: true, source: cfg.source };
  } catch (e) {
    out.sections.config = { ok: false, why: e.code ?? String(e?.message ?? e).slice(0, 100) };
    out.why = "config-absent";
    fs.writeFileSync(path.join(STATE, "htx-probe.json"), JSON.stringify(out, null, 2) + "\n");
    console.log(`HTX-PROBE FAIL: ${out.why}`);
    process.exit(1);
  }

  /* 1. clock skew */
  const skew = await htxClockSkew({});
  out.sections.skew = skew.ok ? { ok: true, skewMs: skew.skewMs } : { ok: false, why: skew.why ?? "unknown" };

  /* 2. symbol book census */
  const sym = await htxSymbols({});
  if (sym.ok && Array.isArray(sym.data)) {
    const rows = sym.data.map(normSymbol).filter(Boolean);
    const online = rows.filter((r) => r.state === "online");
    const byQuote = {};
    for (const r of online) byQuote[r.quote] = (byQuote[r.quote] ?? 0) + 1;
    const feeFieldsPresent = rows.some((r) => r.feesMeasured);
    const notable = {};
    for (const want of ["steem", "hive", "trx", "ht", "sbd"]) {
      const hits = rows.filter((r) => r.base.toLowerCase() === want);
      if (hits.length) notable[want] = hits.map((r) => ({ symbol: r.symbol, state: r.state, takerFeeRate: r.takerFeeRate, makerFeeRate: r.makerFeeRate }));
      else notable[want] = [];
    }
    out.sections.symbols = {
      ok: true, count: rows.length, online: online.length, byQuote,
      feeFieldsPresent,
      notable,
    };
  } else {
    out.sections.symbols = { ok: false, why: sym.why ?? "no-data" };
  }

  /* 3. 24h tickers — public liquidity census (/market/tickers: market-data
   * endpoints carry NO /v1 prefix — 404 measured live on the v1 form).
   * `vol` is QUOTE-denominated 24h volume (measured: zigusdt amount 36055,
   * vol 1765 ≈ amount×close); `amount` is base-denominated. */
  try {
    const mod = await import("../mini-services/saos-engine/htx.mjs");
    const r = await mod.htxPublic("/market/tickers", {}, { timeoutMs: 12000 });
    if (r.ok && Array.isArray(r.data)) {
      const rows = r.data
        .map((t) => ({ symbol: t.symbol, close: Number(t.close), volQuote: Number(t.vol) }))
        .filter((t) => Number.isFinite(t.volQuote) && t.volQuote > 0)
        .sort((a, b) => b.volQuote - a.volQuote);
      out.sections.tickers = {
        ok: true, count: rows.length,
        top10ByVol: rows.slice(0, 10).map((t) => ({ symbol: t.symbol, close: t.close, volQuote24h: +t.volQuote.toFixed(0) })),
      };
    } else {
      out.sections.tickers = { ok: false, why: r.why ?? "no-data" };
    }
  } catch (e) {
    out.sections.tickers = { ok: false, why: String(e?.message ?? e).slice(0, 100) };
  }

  /* 4. SIGNED AUTH PROOF — the API judges the keys */
  const acc = await htxAccounts({});
  if (acc.ok && Array.isArray(acc.data)) {
    const accounts = acc.data.map((a) => ({ id: a.id, type: a.type, state: a.state ?? null, listStatus: a["list-status"] ?? null }));
    out.sections.auth = { ok: true, accounts };
    out.sections.auth.note = "signed probe answered ok — keys LIVE (permissions still UNVERIFIED for trade until a trade-tier probe is armed)";
  } else {
    out.sections.auth = { ok: false, why: acc.why ?? "unknown", errMsg: acc.errMsg ?? null };
  }

  /* 5. balance census per spot account (non-zero only) */
  if (out.sections.auth.ok) {
    const balances = [];
    for (const a of out.sections.auth.accounts) {
      if (a.type && a.type !== "spot") continue; /* spot census this wave */
      const b = await htxBalance(a.id, {});
      if (b.ok) {
        const nz = nonzeroBalances(b.data);
        balances.push({ accountId: a.id, type: a.type, nonZero: nz });
      } else {
        balances.push({ accountId: a.id, type: a.type, error: b.why ?? "unknown" });
      }
    }
    out.sections.balances = { ok: true, accounts: balances };
  }

  /* 6. chain reference census (bridge economics input) */
  const cur = await htxCurrencies({});
  if (cur.ok && Array.isArray(cur.data)) {
    const wants = new Set(["steem", "hive", "trx", "usdt", "btc"]);
    const rows = cur.data
      .filter((c) => wants.has(String(c.currency ?? "").toLowerCase()))
      .map((c) => ({
        currency: c.currency,
        chains: (c.chains ?? []).map((ch) => ({
          chain: ch.chain ?? null,
          displayName: ch.displayName ?? null,
          withdrawFeeType: ch.withdrawFeeType ?? null,
          withdrawFeeRate: ch.withdrawFeeRate ?? null,
          withdrawFee: ch.withdrawFee ?? null,
          minWithdrawAmt: ch.minWithdrawAmt ?? null,
          withdrawQuotaPerDay: ch.withdrawQuotaPerDay ?? null,
          depositStatus: ch.depositStatus ?? null,
          withdrawStatus: ch.withdrawStatus ?? null,
          numOfConfirmations: ch.numOfConfirmations ?? null,
        })),
      }));
    out.sections.currencies = { ok: true, rows };
  } else {
    out.sections.currencies = { ok: false, why: cur.why ?? "no-data", errMsg: cur.errMsg ?? null };
  }

  /* 7. THE ACCOUNT'S REAL FEE TIER (the operator's ״כמה עמלות״ input) —
   * signed /v2/reference/transact-fee-rate on the pairs that matter. */
  try {
    const fee = await htxTransactFeeRate(["steemusdt", "hiveusdt", "trxusdt", "btcusdt"], {});
    if (fee.ok && Array.isArray(fee.data)) {
      out.sections.feeTier = {
        ok: true,
        rows: fee.data.map((f) => ({
          symbol: f.symbol,
          makerFeeRate: f.makerFeeRate ?? null,
          takerFeeRate: f.takerFeeRate ?? null,
          actualMakerRate: f.actualMakerRate ?? null,
          actualTakerRate: f.actualTakerRate ?? null,
        })),
      };
    } else {
      out.sections.feeTier = { ok: false, why: fee.why ?? "no-data", errMsg: fee.errMsg ?? null };
    }
  } catch (e) {
    out.sections.feeTier = { ok: false, why: String(e?.message ?? e).slice(0, 100) };
  }

  /* verdict */
  const musts = ["skew", "symbols", "auth"];
  const goods = musts.filter((k) => out.sections[k]?.ok);
  if (goods.length === musts.length) out.verdict = "PROBE-OK";
  else if (out.sections.auth?.ok) out.verdict = "PROBE-PARTIAL";
  else out.verdict = "PROBE-FAIL";
  if (out.verdict !== "PROBE-OK") {
    out.why = musts.filter((k) => !out.sections[k]?.ok).join("+") + "-not-ok";
  }

  fs.writeFileSync(path.join(STATE, "htx-probe.json"), JSON.stringify(out, null, 2) + "\n");

  /* console verdict — fingerprints only, zero secret material */
  console.log(`HTX-PROBE ${out.verdict}${out.why ? " (" + out.why + ")" : ""}`);
  console.log(`  skew: ${out.sections.skew.ok ? out.sections.skew.skewMs + "ms" : "FAIL " + out.sections.skew.why}`);
  const s = out.sections.symbols;
  if (s?.ok) console.log(`  symbols: ${s.count} total / ${s.online} online; quotes: ${JSON.stringify(s.byQuote)}; feeFields: ${s.feeFieldsPresent}`);
  const a = out.sections.auth;
  if (a?.ok) console.log(`  auth: SIGNED-PROOF-OK (${a.accounts.length} accounts: ${a.accounts.map((x) => x.type).join(",")})`);
  else console.log(`  auth: FAIL ${a?.why} ${a?.errMsg ?? ""}`);
  const b = out.sections.balances;
  if (b?.ok) {
    for (const accRow of b.accounts) {
      console.log(`  balance[${accRow.accountId} ${accRow.type}]: ${accRow.nonZero ? accRow.nonZero.map((n) => `${n.currency}=${n.balance}`).join(" ") || "(empty)" : "ERR " + accRow.error}`);
    }
  }
  const c = out.sections.currencies;
  if (c?.ok) console.log(`  chains: ${c.rows.map((r) => `${r.currency}(${r.chains.length}ch)`).join(" ")}`);
  const f = out.sections.feeTier;
  if (f?.ok) {
    for (const r of f.rows) {
      console.log(`  fee[${r.symbol}]: maker=${r.actualMakerRate ?? r.makerFeeRate} taker=${r.actualTakerRate ?? r.takerFeeRate}`);
    }
  } else if (f) console.log(`  feeTier: FAIL ${f.why} ${f.errMsg ?? ""}`);
  const t = out.sections.tickers;
  if (t?.ok) console.log(`  tickers: ${t.count} pairs; top: ${t.top10ByVol.slice(0, 3).map((x) => x.symbol).join(",")}`);
}

main().catch((e) => {
  out.why = `exception:${String(e?.message ?? e).slice(0, 140)}`;
  try { fs.writeFileSync(path.join(STATE, "htx-probe.json"), JSON.stringify(out, null, 2) + "\n"); } catch {}
  console.error(`HTX-PROBE EXCEPTION: ${out.why}`);
  process.exit(1);
});
