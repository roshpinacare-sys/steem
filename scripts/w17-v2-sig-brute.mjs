/* w17-v2-sig-brute.mjs — find the v2 signing canon variant that passes (read-only probe).
 * v1 signed calls PASS; every v2 signed call returns 1003/Verification-failure.
 * Same buildSignedUrl for both — so the server's v2 validator wants something
 * slightly different. Variants:
 *   A. current canon (canonicalQuery + enc3986 sig)          [known: 1003]
 *   B. raw-colon timestamp inside the SIGNED TEXT (url keeps encoding)
 *   C. Signature appended UNENCODED (raw base64)
 *   D. text with unsorted params (insertion order)
 *   E. host www.huobi.com? no — try api.huobi.pro as signed host variant
 *   F. SignatureVersion=2.1? no — HmacSHA256 + version 2 fixed; try without
 *      SignatureMethod/Version params (some v2 legacy form)
 * Target: /v2/reference/currencies?currency=usdt (read-only, no perms needed).
 */
import { htxConfig, enc3986, canonicalQuery, signText } from "../mini-services/saos-engine/htx.mjs";

const cfg = htxConfig();
const HOST = "api.htx.com";
const PATH = "/v2/reference/currencies";
const ts = new Date().toISOString().slice(0, 19);

function attempt(label, { textParams, urlParams, sigRaw = false }) {
  const text = `GET\n${HOST}\n${PATH}\n${textParams}`;
  const sig = signText(cfg.secretKey, text);
  const sigQ = sigRaw ? sig : enc3986(sig);
  const url = `https://${HOST}${PATH}?${urlParams}&Signature=${sigQ}`;
  return fetch(url).then(async (r) => {
    let j = null; try { j = await r.json(); } catch {}
    const code = j?.code ?? j?.status ?? `http-${r.status}`;
    const ok = (typeof j?.code === "number" && j.code === 200) || j?.status === "ok";
    const msg = (j?.message ?? j?.["err-msg"] ?? "").slice(0, 40);
    console.log(`${label}: ${ok ? "PASS" : `fail code=${code} ${msg}`}`);
    return ok;
  });
}

const base = { AccessKeyId: cfg.accessKey, SignatureMethod: "HmacSHA256", SignatureVersion: "2", Timestamp: ts, currency: "usdt" };
const sortedQ = canonicalQuery(base);

await attempt("A current-canon", { textParams: sortedQ, urlParams: sortedQ });
await attempt("B raw-ts-in-text", {
  textParams: canonicalQuery({ ...base, Timestamp: ts }).replace(/%3A/g, ":"),
  urlParams: sortedQ,
});
await attempt("C raw-sig-in-url", { textParams: sortedQ, urlParams: sortedQ, sigRaw: true });
const unsortedQ = Object.entries(base).map(([k, v]) => `${enc3986(k)}=${enc3986(v)}`).join("&");
await attempt("D unsorted", { textParams: unsortedQ, urlParams: unsortedQ });
await attempt("E host=api.huobi.pro", {
  textParams: `GET\napi.huobi.pro\n${PATH}\n${sortedQ}`,
  urlParams: sortedQ,
});
const noVersion = { AccessKeyId: cfg.accessKey, SignatureMethod: "HmacSHA256", Timestamp: ts, currency: "usdt" };
const nvQ = canonicalQuery(noVersion);
await attempt("F no-SignatureVersion", { textParams: nvQ, urlParams: nvQ });
