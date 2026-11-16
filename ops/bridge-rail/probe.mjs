#!/usr/bin/env node
/* probe.mjs — §52 · EXTERNAL-DOLLAR-RAIL · מדידת-גשרי-החליפין מהרץ
 * ═══════════════════════════════════════════════════════════════════
 * חוק-ברזל: אפס-סודות-בפלט. מדידת-HTTP-טהורה: נגישות · תמיכת-steem/sbd ·
 * שער-חי · מינימום · מחירי-SBD/STEEM-חוץ-אמיתיים. הכל-נרשם-לקבלה.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = { at: new Date().toISOString(), vantage: "github-runner", services: [], prices: {}, steemRpc: null, verdict: "" };

async function jget(url, ms = 15000) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(ms), headers: { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) rail-probe/1" } });
    const text = await r.text();
    return { status: r.status, text: text.slice(0, 400000) };
  } catch (e) { return { status: 0, text: "", err: String(e && e.message || e).slice(0, 90) }; }
}

/* ── 1) שירותי-חליפין-מיידי ── */
const SERVICES = [
  { name: "exolix",
    currencies: ["https://api.exolix.com/api/v2/currencies"],
    rates: [
      "https://api.exolix.com/api/v2/rate?from=STEEM&to=USDT&amount=30",
      "https://api.exolix.com/api/v2/rate?from=SBD&to=USDT&amount=5",
      "https://api.exolix.com/api/v2/rate?from=STEEM&to=TRX&amount=30",
    ],
    ranges: ["https://api.exolix.com/api/v2/range?from=STEEM&to=USDT", "https://api.exolix.com/api/v2/range?from=SBD&to=USDT"] },
  { name: "letsexchange",
    currencies: ["https://api.letsexchange.io/api/v1/info"],
    rates: [
      "https://api.letsexchange.io/api/v1/estimate?from=steem&to=usdt&amount=30&fromNetwork=steem&toNetwork=trx",
      "https://api.letsexchange.io/api/v1/estimate?from=sbd&to=usdt&amount=5&fromNetwork=steem&toNetwork=trx",
    ], ranges: [] },
  { name: "changenow", currencies: ["https://api.changenow.io/v2/exchange/currencies"],
    rates: ["https://api.changenow.io/v2/exchange/estimated?fromCurrency=steem&toCurrency=usdttrc20&fromAmount=30"], ranges: [] },
  { name: "simpleswap", currencies: ["https://api-public.simpleswap.io/v1/currencies", "https://simpleswap.io/api/v1/currencies"], rates: [], ranges: [] },
  { name: "stealthex", currencies: ["https://api.stealthex.io/api/v2/currencies"], rates: [], ranges: [] },
  { name: "trocador", currencies: ["https://trocador.app/api/v1/info"], rates: [], ranges: [] },
  { name: "swapzone", currencies: ["https://api.swapzone.io/v1/exchange/currencies"], rates: [], ranges: [] },
  { name: "godex", currencies: ["https://api.godex.io/api/v1/currencies", "https://api.godex.io/v1/currencies"], rates: [], ranges: [] },
  { name: "nexchange", currencies: ["https://api.n.exchange.io/v1/pairs/"], rates: [], ranges: [] },
  { name: "blocktrades", currencies: ["https://api.blocktrades.us/v2/list-coins", "https://api.blocktrades.site/v2/list-coins"], rates: [], ranges: [] },
  { name: "fixedfloat", currencies: ["https://ff.io/api/v1/info", "https://fixedfloat.com/api/v1/info"], rates: [], ranges: [] },
  { name: "changehero", currencies: ["https://api.changehero.io/v2/currencies"], rates: [], ranges: [] },
  { name: "flypme", currencies: ["https://flyp.me/api/v1/currencies"], rates: [], ranges: [] },
];

for (const s of SERVICES) {
  const rec = { name: s.name, currencies: [], hasSteem: false, hasSbd: false, hasHive: false, rates: [], ranges: [], evidence: "" };
  for (const u of s.currencies) {
    const r = await jget(u);
    const entry = { url: u, status: r.status };
    if (r.status === 200 && r.text) {
      const lower = r.text.toLowerCase();
      entry.hasSteem = lower.includes("steem");
      entry.hasSbd = /\bsbd\b/i.test(lower);
      entry.hasHive = /\bhive\b/i.test(lower);
      if (entry.hasSteem) rec.hasSteem = true;
      if (entry.hasSbd) rec.hasSbd = true;
      if (entry.hasHive) rec.hasHive = true;
    }
    rec.currencies.push(entry);
  }
  if (rec.hasSteem || rec.hasSbd) {
    for (const u of s.rates) {
      const r = await jget(u);
      rec.rates.push({ url: u.slice(0, 120), status: r.status, body: r.text.slice(0, 400) });
    }
    for (const u of s.ranges) {
      const r = await jget(u);
      rec.ranges.push({ url: u.slice(0, 120), status: r.status, body: r.text.slice(0, 400) });
    }
  }
  rec.evidence = rec.currencies.map(c => `${c.status}${c.hasSteem ? "+steem" : ""}${c.hasSbd ? "+sbd" : ""}`).join(" · ");
  OUT.services.push(rec);
  console.log(`${rec.name.padEnd(14)} ${rec.evidence}`);
}

/* ── 2) מחירי-חוץ-אמיתיים: SBD הוא-הנכס-היקר שלנו — מה-שווים-באמת ── */
const px = async (name, url, pick) => {
  const r = await jget(url, 12000);
  let val = null;
  try { val = pick(r.text); } catch {}
  OUT.prices[name] = { status: r.status, value: val };
  console.log(`price ${name.padEnd(14)} ${r.status} ${val ?? "—"}`);
};
await px("steem-binance-usdt", "https://api.binance.com/api/v3/ticker/price?symbol=STEEMUSDT", t => JSON.parse(t).price);
await px("hive-binance-usdt", "https://api.binance.com/api/v3/ticker/price?symbol=HIVEUSDT", t => JSON.parse(t).price);
await px("sbd-upbit-krw", "https://api.upbit.com/v1/ticker?markets=KRW-SBD", t => JSON.parse(t)[0]?.trade_price);
await px("usdt-upbit-krw", "https://api.upbit.com/v1/ticker?markets=KRW-USDT", t => JSON.parse(t)[0]?.trade_price);
await px("sbd-mexc-usdt", "https://api.mexc.com/api/v3/ticker/price?symbol=SBDUSDT", t => JSON.parse(t).price);
await px("sbd-bithumb-krw", "https://api.bithumb.com/public/ticker/SBD", t => JSON.parse(t)?.data?.closing_price);
await px("steem-upbit-krw", "https://api.upbit.com/v1/ticker?markets=KRW-STEEM", t => JSON.parse(t)[0]?.trade_price);

/* ── 3) נגישות-RPC-של-STEEM מהרץ (המסילה-שממנה-ממירים) ── */
{
  const r = await jget("https://api.steemit.com", 10000);
  OUT.steemRpc = { status: r.status, note: "GET-root; the POST ops are the ones proven in the army runs" };
}

/* ── 4) verdict ── */
const open = OUT.services.filter(s => s.hasSteem || s.hasSbd);
OUT.verdict = open.length
  ? `OPEN-RAILS: ${open.map(s => s.name + (s.hasSteem ? "(steem)" : "") + (s.hasSbd ? "(sbd)" : "")).join(" · ")}`
  : "NO-OPEN-RAIL: no service accessible from the runner supports steem/sbd";

const ts = OUT.at.replace(/[:.]/g, "-").slice(0, 19);
const safeDir = join(HERE, "..", "..", "receipts", "bridge-rail");
mkdirSync(safeDir, { recursive: true });
const file = join(safeDir, `probe-${ts}.json`);
writeFileSync(file, JSON.stringify(OUT, null, 1));
console.log("\nVERDICT:", OUT.verdict);
console.log("RECEIPT:", file);
