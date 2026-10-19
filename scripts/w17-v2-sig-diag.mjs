/* w17-v2-sig-diag.mjs — isolate the v2 signed-signature gap (verdict-only). */
import { htxConfig, htxPrivate, buildSignedUrl, canonicalQuery, signedQueryParams, preSignedText, signText, enc3986, HTX_HOST } from "../mini-services/saos-engine/htx.mjs";

const cfg = htxConfig();

/* raw envelope dump for accounts (shape, no secrets) */
const raw1 = await fetch(buildSignedUrl("GET", "/v1/account/accounts", {}, cfg)).then((r) => r.json());
console.log("accounts raw:", JSON.stringify(raw1).slice(0, 200));

/* v2 signed, no params */
const r2 = await htxPrivate(cfg, "/v2/account/deposit/address", {});
console.log("v2 deposit-address no-params:", JSON.stringify(r2).slice(0, 160));

/* v2 signed with currency */
const r3 = await htxPrivate(cfg, "/v2/account/deposit/address", { currency: "steem" });
console.log("v2 deposit-address currency=steem:", JSON.stringify(r3).slice(0, 160));

/* v2 point probe: /v2/account/valuation (signed v2, no params) */
const r4 = await htxPrivate(cfg, "/v2/account/valuation", {});
console.log("v2 valuation:", JSON.stringify(r4).slice(0, 160));

/* v2 point probe: /v2/sub-user/user-list (signed v2) */
const r5 = await htxPrivate(cfg, "/v2/sub-user/user-list", {});
console.log("v2 sub-user-list:", JSON.stringify(r5).slice(0, 160));

/* same path shape as v1: /v1/account/history — signed v1 with params */
const r6 = await htxPrivate(cfg, "/v1/history/search", { currency: "steem", type: "deposit" });
console.log("v1 history search:", JSON.stringify(r6).slice(0, 160));

/* manual: is the signature deterministic w/ params ordering — spot-check text construction */
const p = signedQueryParams(cfg.accessKey, { currency: "steem" }, Date.now());
console.log("canon check: keys=", Object.keys(p).sort().join(","));
