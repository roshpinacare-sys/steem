// r193-a web search runner with 429 backoff — sequential, honest logging
import { writeFileSync, appendFileSync, existsSync } from 'fs';

const DIR = '/home/z/my-project/sovereign/tmp/r193';
const QUERIES = [
  ['s01', 'Uniswap v4 hooks dynamic fees launch adoption 2025'],
  ['s02', 'UniswapX intent based trading Dutch auction large swaps 2025'],
  ['s03', 'CoW Protocol batch auctions MEV profit sharing surplus 2025'],
  ['s04', '1inch Fusion+ RFQ large orders 2025'],
  ['s05', 'ERC-7683 cross-chain intents standard adoption'],
  ['s06', 'Across deBridge THORChain cross-chain bridge large amounts fee model 2025'],
  ['s07', 'DEX aggregator split routing multi path best execution 2025'],
  ['s08', 'Hive-Engine BeDEX TribalDex Hive DEX volume fees 2025'],
  ['s09', 'Blurt blockchain DEX internal market rpc.blurt.world'],
  ['s10', 'Steem internal market liquidity order book 2025'],
  ['s11', 'x402 protocol adoption ERC-8004 agent registry autonomous trading 2025'],
  ['s12', 'concentrated liquidity v3 small pools fee returns impermanent loss'],
  ['s13', 'grid trading bot AMM rebalancing bands low liquidity design'],
  ['s14', 'stETH WBTC redemption design 1:1 pegged asset proof of reserves'],
  ['s15', 'cross-chain bridge hacks 2025 3.1 billion stolen bridge risk'],
  ['s16', 'AI agents autonomous crypto trading rails 2026 payments'],
];

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const log = (m) => { appendFileSync(`${DIR}/runner.log`, m + '\n'); };

async function invoke(query) {
  const mod = await import('/home/z/.bun/install/global/node_modules/z-ai-web-dev-sdk/dist/index.js');
  const zai = await mod.default.create();
  return zai.functions.invoke('web_search', { query, num: 6 });
}

for (const [id, q] of QUERIES) {
  const out = `${DIR}/${id}.json`;
  if (existsSync(out)) { log(`[skip] ${id} exists`); continue; }
  let done = false;
  const delays = [0, 30000, 60000, 120000, 180000, 300000];
  for (let attempt = 0; attempt < delays.length && !done; attempt++) {
    if (delays[attempt]) { log(`[wait] ${id} attempt ${attempt} sleep ${delays[attempt]}ms`); await sleep(delays[attempt]); }
    try {
      const res = await invoke(q);
      if (!Array.isArray(res) || res.length === 0) { log(`[empty] ${id}`); writeFileSync(out, JSON.stringify(res ?? [])); done = true; continue; }
      writeFileSync(out, JSON.stringify(res, null, 1));
      log(`[ok] ${id} ${res.length} results :: ${q}`);
      done = true;
    } catch (e) {
      const msg = String(e && e.message || e).slice(0, 120);
      log(`[err] ${id} attempt ${attempt}: ${msg}`);
    }
  }
  if (!done) log(`[FAIL] ${id} :: ${q}`);
}
log('[done] all queries processed');
