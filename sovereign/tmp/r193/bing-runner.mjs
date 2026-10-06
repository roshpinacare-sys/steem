// r193-a Bing (keyless) search runner — extracts title/url/snippet from cn.bing.com (ensearch=1)
import { execSync } from 'child_process';
import { writeFileSync, appendFileSync, existsSync } from 'fs';

const DIR = '/home/z/my-project/sovereign/tmp/r193/bing';
const QUERIES = [
  ['b01', 'Uniswap v4 hooks dynamic fees 2025 adoption "hook"'],
  ['b02', 'UniswapX Dutch auction intent based swap large orders'],
  ['b03', 'CoW Protocol batch auction MEV surplus "fair combinatorial"'],
  ['b04', '1inch Fusion+ cross-chain escrow resolver large orders'],
  ['b05', 'ERC-7683 cross-chain intents adoption solvers'],
  ['b06', 'Across protocol fee model relayer capital fees bridge'],
  ['b07', 'DEX aggregator split routing best execution 2025'],
  ['b08', 'Hive-Engine token market volume fees 0.25% internal market'],
  ['b09', 'Blurt blockchain 2025 price volume DEX market'],
  ['b10', 'Steem internal market SBD STEEM order book liquidity 2025'],
  ['b11', 'x402 protocol HTTP 402 AI agent payments adoption 2025'],
  ['b12', 'Uniswap v3 concentrated liquidity LP fee returns research study'],
  ['b13', 'grid trading bot AMM low liquidity rebalancing bands design'],
  ['b14', 'WBTC proof of reserves mint burn custodian redemption'],
  ['b15', 'bridge hacks 2025 stolen funds billion cross-chain risk'],
  ['b16', 'AI agent autonomous trading crypto x402 ERC-8004 2026'],
];
const strip = (h) => h.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
execSync(`mkdir -p ${DIR}`);

for (const [id, q] of QUERIES) {
  const out = `${DIR}/${id}.json`;
  if (existsSync(out)) { appendFileSync(`${DIR}/bing.log`, `[skip] ${id}\n`); continue; }
  try {
    const url = `https://cn.bing.com/search?q=${encodeURIComponent(q)}&ensearch=1&count=8`;
    const html = execSync(`curl -sSL -m 20 -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" "${url}"`, { maxBuffer: 24e6 }).toString();
    const items = [];
    const blocks = html.split('<li class="b_algo"').slice(1);
    for (const b of blocks.slice(0, 8)) {
      const hm = b.match(/<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
      if (!hm) continue;
      const pm = b.match(/<p[^>]*>([\s\S]*?)<\/p>/);
      items.push({ url: hm[1], title: strip(hm[2]).slice(0, 160), snippet: pm ? strip(pm[1]).slice(0, 420) : '' });
    }
    writeFileSync(out, JSON.stringify({ query: q, items }, null, 1));
    appendFileSync(`${DIR}/bing.log`, `[ok] ${id} ${items.length} :: ${q}\n`);
  } catch (e) {
    appendFileSync(`${DIR}/bing.log`, `[fail] ${id} :: ${String(e.message).slice(0, 80)}\n`);
  }
  await sleep(2000 + Math.floor(Math.random() * 1500));
}
appendFileSync(`${DIR}/bing.log`, '[done-bing]\n');
