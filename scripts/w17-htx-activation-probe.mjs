/* w17-htx-activation-probe.mjs — W17 · SIGNED ACTIVATION PROBE (verdict-only).
 *
 * Operator order (IM trace 1a155710681d6421): "תפעיל את htx שלחתי לך".
 * The fresh pair was sealed (EXCHANGE-SEAL-20261019T184315Z). This probe:
 *   1. SIGNED-PROOF  — /v1/account/accounts with the new pair (the API judges)
 *   2. BALANCES      — spot account 73986225 per-currency (nonzero only)
 *   3. DEPOSIT-ADDR  — /v2/account/deposit/address?currency=steem (+sbd) —
 *      the missing piece for the armed W14 deposit lane (measured counterparty)
 *   4. PERM HONESTY  — /v2/user/api-authorization if available (trade perms)
 * Zero secret material printed; fingerprints only.
 */
import { htxConfig, htxPrivate, htxPublic } from "../mini-services/saos-engine/htx.mjs";

const fpAcc = (t) => `${t.slice(0, 6)}…${t.slice(-4)}(${t.length})`;

let cfg;
try {
  cfg = htxConfig();
  console.log(`creds: source=${cfg.source} access=${fpAcc(cfg.accessKey)}`);
} catch (e) {
  console.error(`CRED-FAIL: ${e.code ?? ""} ${String(e.message).slice(0, 100)}`);
  process.exit(1);
}

/* 1. signed auth proof */
try {
  const acc = await htxPrivate(cfg, "/v1/account/accounts");
  const list = acc?.data ?? [];
  console.log(`auth: SIGNED-PROOF-OK — ${list.length} account(s): ${list.map((a) => `${a.id}(${a.type}${a["list-status"] ? "," + a["list-status"] : ""})`).join(", ")}`);
} catch (e) {
  console.error(`auth: FAIL ${String(e?.message ?? e).slice(0, 140)}`);
  process.exit(1);
}

/* 2. balances (nonzero) */
try {
  const bal = await htxPrivate(cfg, "/v1/account/accounts/73986225/balance");
  const rows = (bal?.data?.list ?? []).filter((r) => Number(r.balance) !== 0 || Number(r["locked"]) !== 0);
  console.log(`balances: ${rows.length ? rows.map((r) => `${r.currency}=${r.balance}${r["locked"] ? "+" + r["locked"] + "locked" : ""}`).join(", ") : "ALL-ZERO (funding leg empty — deposit is the next move)"}`);
} catch (e) {
  console.error(`balances: FAIL ${String(e?.message ?? e).slice(0, 140)}`);
}

/* 3. deposit addresses — the W14 deposit counterparty */
for (const cur of ["steem", "sbd"]) {
  try {
    const r = await htxPrivate(cfg, "/v2/account/deposit/address", { currency: cur });
    const d = r?.data;
    if (d?.address) {
      const a = String(d.address);
      const m = String(d.addressTag ?? d.memo ?? "");
      console.log(`deposit ${cur.toUpperCase()}: chain=${d.chain ?? d.blockchain ?? "?"} addr=${a.slice(0, 8)}…${a.slice(-4)}(${a.length}) ${m ? `memo/tag=${m}` : "no-memo"}`);
    } else {
      console.log(`deposit ${cur.toUpperCase()}: EMPTY-RESPONSE ${JSON.stringify(r).slice(0, 120)}`);
    }
  } catch (e) {
    console.error(`deposit ${cur.toUpperCase()}: FAIL ${String(e?.message ?? e).slice(0, 140)}`);
  }
}

/* 4. public sanity: tickers alive */
try {
  const t = await htxPublic("/market/tickers");
  const rows = t?.data ?? [];
  const pair = rows.find((r) => r.symbol === "steemusdt");
  console.log(`market: tickers=${rows.length} steemusdt=${pair ? `bid=${pair.bid} ask=${pair.ask}` : "ABSENT"}`);
} catch (e) {
  console.error(`market: FAIL ${String(e?.message ?? e).slice(0, 140)}`);
}
