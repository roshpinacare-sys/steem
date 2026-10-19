/* w17-key-perms-census.mjs — classify the new key's permission set (verdict-only).
 * Measured 18:46Z: canon A passes /v2/reference/currencies but
 * /v2/account/deposit/address answers api-code-1003 — HTX's misleading
 * signature error on permission-restricted endpoints. Census:
 *   READ      /v1/account/accounts/{id}/balance        (needs read)
 *   TRADE-R   /v1/order/openOrders (account, symbol)    (needs trade, read-shaped)
 *   WITHDRAW  /v2/account/withdraw/quota?currency=steem (needs withdraw)
 *   DEPOSIT   /v2/account/deposit/address?currency=steem (measured 1003)
 */
import { htxConfig, htxPrivate } from "../mini-services/saos-engine/htx.mjs";
const cfg = htxConfig();

async function probe(label, path, params) {
  try {
    const r = await htxPrivate(cfg, path, params);
    if (r.ok) console.log(`${label}: PASS ${JSON.stringify(r.data).slice(0, 90)}`);
    else console.log(`${label}: DENIED (${r.why}${r.errMsg ? " · " + String(r.errMsg).slice(0, 40) : ""})`);
    return r.ok;
  } catch (e) {
    console.log(`${label}: ERROR ${String(e?.message ?? e).slice(0, 60)}`);
    return false;
  }
}

await probe("READ.balance", "/v1/account/accounts/73986225/balance", {});
await probe("TRADE-R.openOrders", "/v1/order/openOrders", { "account-id": "73986225", symbol: "steemusdt" });
await probe("TRADE-R.history", "/v1/order/orders", { "account-id": "73986225", symbol: "steemusdt", states: "filled", size: "1" });
await probe("WITHDRAW.quota", "/v2/account/withdraw/quota", { currency: "steem" });
await probe("DEPOSIT.address", "/v2/account/deposit/address", { currency: "steem" });
await probe("DEPOSIT.history", "/v2/account/deposit/history", { currency: "steem", limit: "1" });
