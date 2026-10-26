/* §T-68 · THE DOMINION PROBE — measured-first, zero guessing.
 * Records the venue's real shape BEFORE any dominance plan: trade history
 * (the engine's own measurement), the plugin API's owner-stripping (a probe
 * dead-end caught by measurement — ranking rides our own fill_order ops),
 * the book depth, and our live fill ledger. Run: bun evidence/t68/probe.mjs */
const N = process.env.SAOS_NODE || "https://steemapi.boylikegirl.club";
const rpc = (m, p) => fetch(N, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", method: m, params: p, id: 1 }) }).then((r) => r.json());
const iso = (d) => new Date(d).toISOString().slice(0, 19);

const hist = await rpc("market_history_api.get_trade_history", { start: iso(Date.now() - 86400e3), end: iso(Date.now()), limit: 1000 });
const rows = hist.result?.trades ?? [];
const flat = (a) => (a?.nai !== undefined ? Number(a.amount) / 10 ** (a.precision ?? 3) : Number(String(a ?? "0").split(" ")[0]) || 0);
const symOf = (a) => (a?.nai === "@@000000021" ? "STEEM" : a?.nai === "@@000000013" ? "SBD" : String(a ?? "").split(" ")[1]);
let vol = 0;
for (const t of rows) vol += symOf(t.current_pays) === "STEEM" ? flat(t.current_pays) : flat(t.open_pays);
console.log("venue 24h: trades=" + rows.length + " volSteem=" + vol.toFixed(1));

const ownerKeys = rows.length ? Object.keys(rows[0]).join(",") : "none";
console.log("row-keys=" + ownerKeys + (ownerKeys.includes("owner") ? "" : "  <- OWNER-STRIPPED: ranking must ride our own fill_order ops (measured dead-end)"));

const ob = await rpc("condenser_api.get_order_book", [5]);
const a = ob.result?.asks?.[0], b = ob.result?.bids?.[0];
const ask = Number(a?.real_price), bid = Number(b?.real_price);
console.log("book: ask=" + ask + " bid=" + bid + " spreadBps=" + (((ask - bid) / ((ask + bid) / 2)) * 1e4).toFixed(1));
console.log("PROBE-DONE");
