/**
 * w17-capability-probe.mjs — W17 · THE ROTATION CAPABILITY CENSUS (סקר-היכולות-אחרי-הרוטציה).
 *
 * Operator order 2026-10-19 (IM trace 1a1556c780544431, verbatim core):
 * "תעשה פעילות דרך steem sbd עמלות משיכה די נמוכות שם אפשר להשתמש בזה חשוב
 * להעביר רק מטבעות אלו בנתיים ... קודם נראה שאנחנו עובדים טוב עם זה".
 *
 * READ-ONLY + one zero-risk order probe (W14 precedent: an order that cannot
 * fill and cannot place — the refusal ITSELF is the measurement). Sections:
 *   1. clock skew (signature freshness)
 *   2. signed auth proof (the API judges the NEW pair — R306-b)
 *   3. spot balances (did the operator fund? honest non-zero census)
 *   4. account fee tier for steemusdt/sbdusdt
 *   5. THE FEE TABLE — /v2/reference/currencies for the transfer-candidate
 *      basket (STEEM/SBD first, then the expansion candidates) with USD-est
 *      per-coin withdrawal cost — the operator's "מפחד מעמלות גבוהות" answer
 *   6. deposit-address measurement (STEEM + SBD) — the money-leg counterparty
 *      (address+memo recorded in STATE, never in stdout — stdout fingerprints)
 *   7. withdraw-quota measurement (STEEM + SBD) — withdraw permission verdict
 *   8. trade-leg verdict — zero-risk far-below-market probe order
 *   9. NO-STRANDING LAW output: deposit is lawful ONLY if a return path
 *      exists (withdraw permission) or a trade path exists — anything else
 *      keeps the fleet's money home (exchange-custody W14 law).
 *
 * Writes: state/exchange-custody.json (w17Recheck appended, append-in-spirit)
 *       + state/htx-fee-census.json (committed truth). Fail-closed everywhere;
 *       zero secret material in stdout/logs/state (fingerprints only).
 *
 * Usage: node scripts/w17-capability-probe.mjs
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
  htxConfig, htxClockSkew, htxAccounts, htxBalance, htxCurrencies,
  htxTransactFeeRate, htxDepositAddress, htxPlaceOrder, htxLastPrice,
  nonzeroBalances,
} from "../mini-services/saos-engine/htx.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const REPO = path.resolve(DIR, "..");
const STATE = path.join(REPO, "mini-services", "saos-engine", "state");
const now = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const writeJson = (p, v) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(v, null, 2));
  fs.renameSync(tmp, p);
};

/* the transfer basket: STEEM/SBD are the operator's ORDERED coins; the rest
 * are the expansion candidates the operator fears high fees for — measured,
 * not guessed. */
const BASKET = ["steem", "sbd", "hive", "usdt", "trx", "btc", "eth", "sol", "doge", "ltc", "xrp", "ton", "bch", "ada"];
const num = (v) => { const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v; return typeof n === "number" && Number.isFinite(n) ? n : null; };

const verdict = { at: now(), wave: "W17", rail: "htx", sections: {} };
const S = (name, obj) => { verdict.sections[name] = obj; console.log(`  ${name}: ${obj.verdict ?? obj.ok ?? "?"}`); };

console.log("W17 capability census — fingerprints only, zero secret material:");

/* 1 · skew */
const skew = await htxClockSkew({});
S("skew", { verdict: skew.ok ? `OK skewMs=${skew.skewMs ?? "?"}` : `FAIL ${skew.why}`, ok: skew.ok, skewMs: skew.skewMs ?? null });

/* 2 · auth */
const acc = await htxAccounts({});
const spot = acc.ok ? (Array.isArray(acc.data) ? acc.data : []).find((a) => a.type === "spot") : null;
S("auth", acc.ok && spot
  ? { verdict: `SIGNED-PROOF-OK spot=${spot.id}`, ok: true, accountId: spot.id, state: spot.state ?? null }
  : { verdict: `FAIL ${acc.why ?? "no-spot"} ${acc.errMsg ?? ""}`.trim(), ok: false, errCode: acc.why ?? null });

const accountId = spot ? String(spot.id) : null;

/* 3 · balances */
let balances = [];
if (accountId) {
  const bal = await htxBalance(accountId, {});
  balances = bal.ok ? nonzeroBalances(bal.data) : [];
  S("balances", bal.ok
    ? { verdict: balances.length ? `NONZERO=${balances.length}` : "EMPTY-ACCOUNT", ok: true, nonZero: balances }
    : { verdict: `FAIL ${bal.why}`, ok: false });
} else S("balances", { verdict: "SKIP-no-account", ok: false });

/* 4 · fee tier */
const fee = await htxTransactFeeRate(["steemusdt", "sbdusdt"], {});
S("feeTier", fee.ok
  ? { verdict: "MEASURED", ok: true, rows: (fee.data ?? []).map((r) => ({ symbol: r.symbol, maker: num(r.actualMakerRate) ?? num(r.makerFeeRate), taker: num(r.actualTakerRate) ?? num(r.takerFeeRate) })) }
  : { verdict: `FAIL ${fee.why} ${fee.errMsg ?? ""}`.trim(), ok: false });

/* 5 · the fee table */
const feeTable = [];
for (const c of BASKET) {
  const r = await htxCurrencies({ currency: c });
  const row = { currency: c, ok: r.ok };
  if (r.ok) {
    const chains = (r.data ?? []).flatMap((x) => x.chains ?? []);
    row.chains = chains.map((ch) => ({
      chain: ch.chain ?? null,
      withdrawFeeType: ch.withdrawFeeType ?? null,
      withdrawFee: num(ch.withdrawFee),
      minWithdrawAmt: num(ch.minWithdrawAmt),
      depositStatus: ch.depositStatus ?? null,
      withdrawStatus: ch.withdrawStatus ?? null,
      confirmations: num(ch.numOfConfirmations),
    }));
  } else { row.why = r.why ?? null; row.errMsg = r.errMsg ?? null; }
  feeTable.push(row);
}
/* USD-est per withdrawFee where a coinusdt price exists */
for (const row of feeTable) {
  for (const ch of row.chains ?? []) {
    if (ch.withdrawFee == null) continue;
    const px = await htxLastPrice(`${row.currency}usdt`);
    ch.withdrawFeeUsdEst = px.ok ? Number((ch.withdrawFee * px.close).toFixed(6)) : null;
  }
}
const steemRow = feeTable.find((r) => r.currency === "steem");
const sbdRow = feeTable.find((r) => r.currency === "sbd");
S("feeTable", {
  verdict: "CENSUSED",
  ok: true,
  steem: steemRow?.chains ?? null,
  sbd: sbdRow?.chains ?? null,
  candidates: feeTable.filter((r) => r.currency !== "steem" && r.currency !== "sbd"),
});

/* 6 · deposit addresses (STEEM + SBD) — state-only, stdout stays fingerprinted */
const dep = {};
for (const c of ["steem", "sbd"]) {
  const r = await htxDepositAddress(c, {});
  if (r.ok && Array.isArray(r.data) && r.data.length) {
    const d = r.data[0];
    dep[c] = {
      ok: true, chain: d.chain ?? null,
      hasAddress: !!d.address, hasTag: !!d.addressTag,
      addressLen: (d.address ?? "").length, tagLen: (d.addressTag ?? "").length,
      address: d.address ?? null, addressTag: d.addressTag ?? null, /* state-only, not a credential */
    };
    S(`depositAddress.${c}`, { verdict: `MEASURED chain=${d.chain ?? "?"} hasTag=${!!d.addressTag}`, ok: true });
  } else {
    dep[c] = { ok: false, why: r.why ?? null, errMsg: r.errMsg ?? null };
    S(`depositAddress.${c}`, { verdict: `BLOCKED ${r.why ?? "?"} ${(r.errMsg ?? "").slice(0, 60)}`, ok: false });
  }
}

/* 7 · withdraw quota (permission verdict) */
const quota = {};
for (const c of ["steem", "sbd"]) {
  const r = await (async () => {
    try {
      const { htxPrivate } = await import("../mini-services/saos-engine/htx.mjs");
      return await htxPrivate("GET", "/v2/account/withdraw/quota", { currency: c }, null, {});
    } catch (e) { return { ok: false, why: String(e?.message ?? e).slice(0, 60) }; }
  })();
  if (r.ok) {
    const d = r.data ?? {};
    quota[c] = { ok: true, raw: { currency: d.currency ?? c, chain: d.chain ?? null, quota: d.quota ?? null, maxWithdrawPerDay: d.maxWithdrawPerDay ?? null, withdrawQuotaPerDay: d.withdrawQuotaPerDay ?? null, remainQuota: d.remainQuota ?? null } };
    S(`withdrawQuota.${c}`, { verdict: "PERMISSION-PRESENT", ok: true });
  } else {
    quota[c] = { ok: false, why: r.why ?? null, errMsg: (r.errMsg ?? "").slice(0, 80) };
    S(`withdrawQuota.${c}`, { verdict: `ABSENT/BLOCKED ${r.why ?? "?"} ${(r.errMsg ?? "").slice(0, 60)}`, ok: false });
  }
}

/* 8 · trade leg — zero-risk probe (far-below-market buy, cannot fill; refusal is the measurement) */
let trade = { ok: false, verdict: "SKIP-no-account" };
if (accountId) {
  const px = await htxLastPrice("steemusdt");
  if (px.ok) {
    const body = { "account-id": accountId, symbol: "steemusdt", type: "buy-limit", amount: "1", price: (px.close * 0.01).toFixed(6) };
    const r = await htxPlaceOrder(body, {});
    if (r.ok && r.data) {
      /* cannot happen without balance — but if the venue accepts, cancel at once */
      const { htxCancelOrder } = await import("../mini-services/saos-engine/htx.mjs");
      const c = await htxCancelOrder(r.data, {});
      trade = { ok: true, verdict: "ORDER-ACCEPTED-THEN-CANCELED (trade permission present)", orderId: null, canceled: c.ok === true };
    } else {
      trade = { ok: false, verdict: `REFUSED ${r.why ?? "?"}`, errMsg: (r.errMsg ?? "").slice(0, 120) };
    }
  } else trade = { ok: false, verdict: `SKIP-no-price ${px.why ?? ""}` };
}
S("tradeLeg", trade);

/* 9 · no-stranding law */
const depositLawful = !!(dep.steem?.ok && (quota.steem?.ok || trade.ok));
verdict.noStrandingLaw = {
  depositLawful,
  reason: depositLawful
    ? "deposit has a measured return path (withdraw permission) or a trade path"
    : "deposit REFUSED: no measured return path (withdraw permission absent AND trade refused) — the fleet's money stays home (W14 custody law)",
};
console.log(`  noStranding: depositLawful=${depositLawful}`);

/* ---------- write the two state truths ---------- */
const custodyPath = path.join(STATE, "exchange-custody.json");
const custody = readJson(custodyPath, {});
custody.w17Recheck = {
  at: verdict.at,
  verdict: acc.ok ? "NEW-PAIR-LIVE" : `NEW-PAIR-REJECTED ${acc.why ?? ""}`.trim(),
  measured: {
    skewMs: verdict.sections.skew?.skewMs ?? null,
    accountId: accountId ?? null,
    balances: balances,
    feeTier: verdict.sections.feeTier ?? null,
    depositAddress: { steem: dep.steem?.ok ? { chain: dep.steem.chain, hasTag: dep.steem.hasTag } : { ok: false, why: dep.steem.why ?? null, errMsg: dep.steem.errMsg ?? null }, sbd: dep.sbd?.ok ? { chain: dep.sbd.chain, hasTag: dep.sbd.hasTag } : { ok: false, why: dep.sbd.why ?? null, errMsg: dep.sbd.errMsg ?? null } },
    withdrawQuota: { steem: quota.steem?.ok ? "PERMISSION-PRESENT" : `ABSENT ${quota.steem?.why ?? ""} ${quota.steem?.errMsg ?? ""}`.trim(), sbd: quota.sbd?.ok ? "PERMISSION-PRESENT" : `ABSENT ${quota.sbd?.why ?? ""} ${quota.sbd?.errMsg ?? ""}`.trim() },
    tradeLeg: trade,
  },
  noStrandingLaw: verdict.noStrandingLaw,
  losses: 0,
  note: "operator rotation drop sealed (RESEAL-OK W17, EXCHANGE-SEAL-20261019T185046Z); this census measured the NEW pair against the live venue — every refusal recorded honestly; the STEEM/SBD-only transfer scope (trace 1a1556c780544431) governs all legs",
};
writeJson(custodyPath, custody);
writeJson(path.join(STATE, "htx-fee-census.json"), { schema: "htx-fee-census-v1", at: verdict.at, basket: BASKET, rows: feeTable });

console.log("W17 CENSUS DONE → state/exchange-custody.json (w17Recheck) + state/htx-fee-census.json");
