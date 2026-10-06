// r193-a DuckDuckGo-HTML search runner — keyless, real URLs
import { execSync } from 'child_process';
import { writeFileSync, appendFileSync, existsSync } from 'fs';

const DIR = '/home/z/my-project/sovereign/tmp/r193/ddg';
const QUERIES = [
  ['d01', 'Uniswap v4 hooks dynamic fees 2025'],
  ['d02', 'UniswapX Dutch auction intent based swap large orders'],
  ['d03', 'CoW Protocol batch auction MEV surplus fair combinatorial'],
  ['d04', '1inch Fusion+ cross-chain escrow resolver'],
  ['d05', 'ERC-7683 cross-chain intents standard solvers adoption'],
  ['d06', 'Across protocol relayer capital fee model bridge'],
  ['d07', 'DEX aggregator split routing best execution 2025'],
  ['d08', 'Hive-Engine internal market fees volume SWAP.HIVE'],
  ['d09', 'Blurt blockchain market price volume 2025'],
  ['d10', 'Steem internal market order book SBD liquidity'],
  ['d11', 'x402 protocol AI agent payments HTTP 402 adoption'],
  ['d12', 'Uniswap v3 concentrated liquidity fee returns research'],
  ['d13', 'grid trading bot AMM rebalancing bands low liquidity'],
  ['d14', 'WBTC proof of reserves merchant mint burn redemption'],
  ['d15', 'bridge hacks 2025 stolen billion cross-chain Chainalysis'],
  ['d16', 'ERC-8004 trustless agents registry x402 autonomous trading'],
  ['d17', 'THORChain native cross-chain swap liquidity pools RUNE'],
  ['d18', 'Lido stETH withdrawal redemption 1:1 curve'],
];
const strip = (h) => h.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
execSync(`mkdir -p ${DIR}`);
const decode = (u) => { try { const m = u.match(/uddg=([^&]+)/); return m ? decodeURIComponent(m[1]) : u; } catch { return u; } };

for (const [id, q] of QUERIES) {
  const out = `${DIR}/${id}.json`;
  if (existsSync(out)) { appendFileSync(`${DIR}/ddg.log`, `[skip] ${id}\n`); continue; }
  let done = false;
  for (let attempt = 0; attempt < 4 && !done; attempt++) {
    if (attempt) { appendFileSync(`${DIR}/ddg.log`, `[wait] ${id} attempt ${attempt}\n`); await sleep(25000 + attempt * 10000); }
    try {
      const html = execSync(`curl -sSL -m 25 -A "Mozilla/5.0 (X11; Linux x86_64) Firefox/128.0" "https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(q)}"`, { maxBuffer: 16e6 }).toString();
      if (html.includes('anomaly') || (html.match(/result-link/g) || []).length === 0) {
        appendFileSync(`${DIR}/ddg.log`, `[anomaly] ${id} attempt ${attempt} len ${html.length}\n`); continue;
      }
      const items = [];
      const re = /class='result-link'[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:class='result-snippet'>[\s\S]*?<\/td>)?/g;
      const linkRe = /<a rel="nofollow" href="([^"]+)"[^>]*class='result-link'[^>]*>([\s\S]*?)<\/a>/g;
      const snipRe = /class='result-snippet'>([\s\S]*?)<\/td>/g;
      const links = []; let lm;
      while ((lm = linkRe.exec(html)) && links.length < 8) links.push({ url: decode(lm[1]), title: strip(lm[2]).slice(0, 160) });
      const snips = []; let sm;
      while ((sm = snipRe.exec(html)) && snips.length < 8) snips.push(strip(sm[1]).slice(0, 420));
      for (let i = 0; i < links.length; i++) items.push({ ...links[i], snippet: snips[i] || '' });
      writeFileSync(out, JSON.stringify({ query: q, items }, null, 1));
      appendFileSync(`${DIR}/ddg.log`, `[ok] ${id} ${items.length} :: ${q}\n`);
      done = true;
    } catch (e) {
      appendFileSync(`${DIR}/ddg.log`, `[fail] ${id} :: ${String(e.message).slice(0, 80)}\n`);
    }
  }
  if (!done) appendFileSync(`${DIR}/ddg.log`, `[FAIL] ${id} :: ${q}\n`);
  await sleep(12000 + Math.floor(Math.random() * 9000));
}
appendFileSync(`${DIR}/ddg.log`, '[done-ddg]\n');
