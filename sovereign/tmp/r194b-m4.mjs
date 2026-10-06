// r194-b M4: TRON keyless account probe + localhost sovereign gateway heartbeat (read-only)
// Output: r194b-tron.json + r194b-gateway.json
const WALLET = "TYVwwuvdDmfy3shxT3cb3RKLrRCshaZxTy"; // public on-chain address, already in worklog

async function get(url, timeoutMs = 7000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctl.signal, headers: { "accept": "application/json", "user-agent": "weave-r194b/1.0" } });
    clearTimeout(timer);
    const text = await res.text();
    let j = null; try { j = JSON.parse(text); } catch { j = text.slice(0, 300); }
    return { status: res.status, ok: res.ok, j };
  } catch (e) {
    clearTimeout(timer);
    return { status: 0, ok: false, error: String(e && e.name === "AbortError" ? "TIMEOUT>7s" : e) };
  }
}

// --- TRON ---
const tron = await get(`https://api.trongrid.io/v1/accounts/${WALLET}`);
let tronOut = { wallet: WALLET, endpoint: "https://api.trongrid.io/v1/accounts/" + WALLET, status: tron.status, error: tron.ok ? null : (tron.error || `status ${tron.status}`) };
if (tron.ok && tron.j && tron.j.data && tron.j.data.length) {
  const acc = tron.j.data[0];
  const trx = acc.balance ? acc.balance / 1e6 : 0;
  const trc20 = (acc.trc20 || []).map((o) => Object.entries(o).map(([contract, raw]) => ({ contract, raw, amount: Number(raw) / 1e6 }))).flat();
  const USDT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"; // well-known TRC-20 USDT contract
  tronOut = {
    ...tronOut,
    address: acc.address,
    trx: Number(trx.toFixed(6)),
    trc20,
    usdtTrc20: trc20.find((t) => t.contract === USDT) || null,
    human: acc.human ?? null,
  };
}

// --- Localhost gateway ---
const paths = ["/api/sovereign", "/api/health"];
const gw = [];
for (const p of paths) {
  const r = await get(`http://127.0.0.1:3000${p}`, 6000);
  gw.push({
    path: p,
    status: r.status,
    ok: r.ok,
    error: r.ok ? null : (r.error || `status ${r.status}`),
    preview: r.ok ? (typeof r.j === "string" ? r.j : JSON.stringify(r.j)).slice(0, 700) : null,
  });
}

const tronFile = new URL("./r194b-tron.json", import.meta.url).pathname;
const gwFile = new URL("./r194b-gateway.json", import.meta.url).pathname;
await Bun.write(tronFile, JSON.stringify(tronOut, null, 2));
await Bun.write(gwFile, JSON.stringify({ at: new Date().toISOString(), probes: gw }, null, 2));
console.log(JSON.stringify({ tron: tronOut, gateway: gw }, null, 2));
