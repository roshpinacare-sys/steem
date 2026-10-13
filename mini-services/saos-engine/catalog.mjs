/**
 * catalog.mjs — T-25 · THE OFFER (מסילת-ההצעה): the machine SELLS its measured
 * capabilities on-chain. The router's honest answer to "מה חוסם אותנו" is that
 * every pool-share rail scales ∝ SP (capital-bound); the non-proportional
 * unlock is selling to the network itself. Payment rail: incoming transfers
 * with memo "SAOS-CATALOG:<sku>" — detected from chain-truth history (nodes
 * ignore select_ops → defensive filter, the T-23 law). Money is never silently
 * swallowed: unknown SKUs and underpayments are journaled as typed statuses.
 *
 * Fulfillment honesty line (v2, T-59b — the self-serve path is the product):
 *  - market-data-feed → the verified payment issues an HMAC entitlement key
 *    (7d TTL); the customer calls POST /mcp with the x-saos-feed header
 *    (initialize → tools/list → tools/call — six read-only tools). The
 *    on-chain comment remains the acknowledgment rail, not the product.
 *  - curation-boost   → registration journaled + acknowledged in the daily
 *    report (performance share, zero upfront).
 *  - rc-boost         → FULFILLMENT-QUEUED: delegate_rc moves delegated stake —
 *    queued until the fulfillment rail is proven end-to-end (typed, honest).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { rpcCall } from "./measure.mjs";
import { opTypeName, catalogCore } from "./lib.mjs";
import { masterAccount, armedConf, executeAs } from "./signer.mjs";
import { issueFeedEntitlement } from "./feed.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const STATE = path.join(DIR, "state");
const CAT_FILE = path.join(STATE, "catalog.json");
const ORDERS_FILE = path.join(STATE, "catalog-orders.json");

const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const writeJson = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); const t = `${p}.tmp.${process.pid}`; fs.writeFileSync(t, JSON.stringify(v, null, 2)); fs.renameSync(t, p); };
const appendLine = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.appendFileSync(p, JSON.stringify(v) + "\n"); };

export const CATALOG_LAW = "SAOS-CATALOG:<sku> בזיכרון-ההעברה = הזמנה. תשלום לא-מוכר נרשם, לא נבלע; מימוש בטוח ראשון, כסף-מזוזות אחר-כך.";

export const SKUS = [
  {
    id: "market-data-feed",
    priceSbd: 1,
    per: "week",
    what: "פיד-נתונים מדוד self-serve דרך דלת-MCP קריאה-בלבד: ספר-השוק, spread, עסקאות/יום, parity, פסקי-הראוטר, מילויים מהשרשרת, שעון-התגמולים ורג'ים-Hive הנמדד — 6 כלים, מפתח שבועי",
    fulfillment: "מסירה-עצמית v2: שלם את ה-SKU בהעברה עם הזיכרון SAOS-CATALOG:market-data-feed → מפתח-זכאות HMAC מונפק עבור התשלום המאומת (תוקף 7 ימים) → פנה אל POST /mcp עם כותרת x-saos-feed → initialize → tools/list → tools/call · ששת הכלים (קריאה-בלבד): market.snapshot, router.verdict, catalog.list, fills.recent, payouts.clock, hive.regime · כל-מספר נושא את-מחלקתו: measured/estimated/blocked.",
  },
  {
    id: "curation-boost",
    priceSbd: 0,
    per: "performance 10% share",
    what: "קיורציה-בשיתוף: רישום-החשבון שלך במסגרת-הקיורציה שלנו לפי-הדוקטרינה (ללא-תשלום-מוקדם; חלק-ביצועים 10%)",
    fulfillment: "רישום ב-state + אישור בדוח-היומי",
  },
  {
    id: "rc-boost",
    priceSbd: 2,
    per: "10k-RC delegation, 7d",
    what: "דלק-עסקאות: השכרת-RC עודף (6.14T טנק, שימוש-שיווי-משקל ~1%) לחשבון שלך — יותר עסקאות/יום",
    fulfillment: "delegate_rc — נתור-עד-שמסילת-המימוש מוכחת-קצה-לקצה (typed, honest)",
  },
];

export function catalogState() { return readJson(CAT_FILE, null); }

export async function runCatalog({ now = new Date().toISOString() } = {}) {
  const account = masterAccount();
  const base = { at: now, account, skus: SKUS, law: CATALOG_LAW };
  try {
    /* node-shape law (T-25 measured): the empty filter array form is rejected by
     * the ladder nodes — the plain [account, start, limit] form is the one that
     * answers; the op filter still happens HERE (defensive, never trusted). */
    const r = await rpcCall("condenser_api.get_account_history", [account, -1, 400]);
    if (!r.ok) return { ...base, verdict: "SCAN-FAILED", error: r.error ?? "history-unavailable" };
    const rows = Array.isArray(r.result) ? r.result : [];
    const transfers = [];
    for (const [, e] of rows) {
      const type = opTypeName(e?.op);
      if (type !== "transfer") continue;
      const v = (Array.isArray(e?.op) ? e.op[1] : e?.op?.value) ?? {};
      if (String(v.to ?? "") !== account) continue;
      const [amt, sym] = String(v.amount ?? "0.000 SBD").split(" ");
      if (sym !== "SBD") continue;
      transfers.push({ txid: e?.trx_id ?? "", from: v.from ?? "", amountSbd: Number(amt) || 0, memo: String(v.memo ?? ""), at: e?.timestamp ?? null });
    }
    const prev = readJson(ORDERS_FILE, { txids: [], orders: [] });
    const knownTxids = (prev.txids ?? []).map(String);
    const res = catalogCore({ skus: SKUS, transfers, knownTxids });

    /* fulfillment — the acknowledgment rail: the market-data-feed on-chain
     * comment. The v2 PRODUCT is the entitlement key + POST /mcp (issued
     * right below); the comment names the door path so the payer knows the
     * self-serve lane exists — it states the LAW, never an issuance event
     * that has not landed yet (a failed key issue is typed FEED-KEY-SKIPPED). */
    const fulfillments = [];
    const conf = armedConf();
    for (const o of res.orders.filter((x) => x.status === "PAID-NEW" && x.sku === "market-data-feed")) {
      try {
        if (conf?.catalog?.armed === false) throw new Error("CATALOG-DISARMED");
        /* parent stub is a real top-level post path placeholder — replies need
         * a parent; v1 acknowledges via a fresh memo-post on our report feed */
        const fres = await executeAs(account, [["comment", {
          parent_author: "", parent_permlink: "saos-catalog",
          /* §T-67: FULL txid in the permlink — a 10-char slice + ms clock was
           * a (thin) collision class; the txid IS the chain-truth anchor */
          author: account, permlink: `catalog-${o.txid}-${Date.now()}`,
          title: `SAOS-CATALOG · market-data-feed · ${o.from}`,
          body: `מסירה-עצמית עבור @${o.from} — תשלום ${o.amountSbd} SBD אומת בשרשרת (txid ${o.txid}). דלת-ה-MCP: POST /mcp עם כותרת x-saos-feed — initialize → tools/list → tools/call (מפתח-זכאות HMAC, תוקף 7 ימים, מונפק עבור תשלומי SAOS-CATALOG:market-data-feed מאומתים). saos.weave.core.v1`,
          json_metadata: JSON.stringify({ tags: ["saos", "market-data"], app: "saos-catalog/v1" }),
        }]], { tag: "catalog-fulfill" });
        fulfillments.push({ txid: o.txid, verdict: fres?.ok ?? fres?.verdict ?? "BROADCAST?" });
      } catch (e) {
        fulfillments.push({ txid: o.txid, verdict: "FULFILLMENT-FAILED", error: String(e?.message ?? e).slice(0, 120) });
      }
      /* T-48 · the product's SECOND lane: the paid feed key (7d TTL, HMAC'd
       * from .secrets material — the salt is never stored beside the keys).
       * Issued on the VERIFIED payment: the comment is the acknowledgment,
       * the key is delivery v2 — a customer whose comment failed still holds
       * a working product. Missing salt ⇒ typed skip, never a silent no-op. */
      try {
        const salt = fs.readFileSync(path.join(DIR, "..", "..", ".secrets", "engine.token"), "utf8").trim();
        if (salt.length >= 16) {
          const iss = issueFeedEntitlement({ txid: o.txid, sku: o.sku, from: o.from, salt });
          if (iss.ok) {
            fulfillments.push({ txid: o.txid, verdict: iss.dup ? "FEED-KEY-DUP" : "FEED-KEY-ISSUED", expiresAt: iss.entitlement.expiresAt });
            if (!iss.dup) appendLine(path.join(STATE, "events.jsonl"), { type: "feed.entitlement-issued", at: now, txid: o.txid, from: o.from, sku: o.sku, ttl: "7d" });
          } else {
            fulfillments.push({ txid: o.txid, verdict: "FEED-KEY-SKIPPED", why: iss.why ?? "issue-refused" });
          }
        } else {
          fulfillments.push({ txid: o.txid, verdict: "FEED-KEY-SKIPPED", why: "no-salt" });
        }
      } catch { fulfillments.push({ txid: o.txid, verdict: "FEED-KEY-SKIPPED", why: "salt-unreadable" }); }
    }
    const mergedOrders = [...(prev.orders ?? []), ...res.orders.filter((x) => x.status !== "KNOWN")].slice(-200);
    const mergedTxids = [...new Set([...knownTxids, ...res.orders.map((x) => x.txid).filter(Boolean)])].slice(-400);
    writeJson(ORDERS_FILE, { txids: mergedTxids, orders: mergedOrders });
    if (res.paidNew > 0) appendLine(path.join(STATE, "events.jsonl"), { type: "catalog.paid", at: now, paidNew: res.paidNew, unknown: res.unknownSkus });

    const doc = {
      ...base,
      verdict: res.paidNew > 0 ? "PAID-NEW" : res.orders.some((o) => o.status === "UNDERPAID" || o.status === "UNKNOWN-SKU") ? "HONEST-EDGE" : transfers.length ? "SCANNED" : "NO-PAYMENTS",
      scan: { rows: rows.length, transfers: transfers.length, window: 400 },
      orders: mergedOrders.slice(-20),
      counts: { paidNew: res.paidNew, known: res.orders.filter((o) => o.status === "KNOWN").length, underpaid: res.orders.filter((o) => o.status === "UNDERPAID").length, unknownSku: res.unknownSkus },
      fulfillments,
    };
    writeJson(CAT_FILE, doc);
    return doc;
  } catch (e) {
    return { ...base, verdict: "CATALOG-ERROR", error: String(e?.message ?? e).slice(0, 160) };
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCatalog().then((d) => console.log(JSON.stringify(d, null, 2)));
}
