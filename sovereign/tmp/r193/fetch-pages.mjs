// r193-a primary-source fetcher: curl page -> text extract, honest status log
import { execSync } from 'child_process';
import { writeFileSync, appendFileSync } from 'fs';

const DIR = '/home/z/my-project/sovereign/tmp/r193/pages';
const URLS = [
  ['univ4-overview', 'https://docs.uniswap.org/contracts/v4/concepts/overview'],
  ['univ4-hooks', 'https://docs.uniswap.org/contracts/v4/concepts/hooks'],
  ['univ4-dynfee', 'https://docs.uniswap.org/contracts/v4/concepts/dynamic-fees'],
  ['univ4-fee', 'https://docs.uniswap.org/contracts/v4/quickstart/guides/hooks/create-hook#adjusting-fees'],
  ['uniswapx', 'https://docs.uniswap.org/concepts/protocols/uniswapx'],
  ['uniswapx2', 'https://docs.uniswap.org/concepts/uniswapx'],
  ['cow-root', 'https://docs.cow.fi/cow-protocol/concepts'],
  ['cow-batch2', 'https://docs.cow.fi/cow-protocol/concepts/about-cow-protocol/batch-auctions'],
  ['cow-mev', 'https://docs.cow.fi/cow-protocol/concepts/architecture/protocols/mev-blocker'],
  ['oneinch-root', 'https://docs.1inch.io/docs/fusion/overview'],
  ['oneinch-fusion', 'https://docs.1inch.io/docs/fusion-protocol/overview'],
  ['eip7683', 'https://eips.ethereum.org/EIPS/eip-7683'],
  ['eip8004', 'https://eips.ethereum.org/EIPS/eip-8004'],
  ['across-fees', 'https://docs.across.to/concepts/fees'],
  ['across-root', 'https://docs.across.to/'],
  ['debridge-root', 'https://docs.debridge.finance/'],
  ['thorchain-root', 'https://docs.thorchain.org/'],
  ['lifi-root', 'https://docs.li.fi/'],
  ['x402', 'https://www.x402.org/'],
  ['wbtc', 'https://www.wbtc.network/dashboard/order-book'],
  ['lido-steth', 'https://docs.lido.fi/guides/steth-withdrawal-guide/'],
  ['chainalysis', 'https://www.chainalysis.com/blog/crypto-hacking-stolen-funds-2025/'],
  ['gamma-rebal', 'https://docs.gamma.xyz/gamma-protocol/rebalancing'],
  ['he-docs', 'https://hive-engine.com/'],
  ['beblurt', 'https://beblurt.com/'],
  ['tribaldex', 'https://tribaldex.com/'],
  ['steemengine', 'https://steem-engine.com/'],
  ['sky-psm', 'https://docs.sky.money/'],
];

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
execSync(`mkdir -p ${DIR}`);
const strip = (h) => h
  .replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/\s+/g, ' ').trim();

for (const [id, url] of URLS) {
  const out = `${DIR}/${id}.txt`;
  try {
    const html = execSync(`curl -sSL -m 20 -A "Mozilla/5.0 (X11; Linux x86_64) research/193-a" "${url}"`, { maxBuffer: 24e6 }).toString();
    const txt = strip(html);
    writeFileSync(out, `URL: ${url}\nLEN: ${txt.length}\n\n${txt.slice(0, 6000)}`);
    appendFileSync('/home/z/my-project/sovereign/tmp/r193/fetch.log', `[ok] ${id} ${txt.length} :: ${url}\n`);
  } catch (e) {
    appendFileSync('/home/z/my-project/sovereign/tmp/r193/fetch.log', `[fail] ${id} :: ${url} :: ${String(e.message).slice(0, 80)}\n`);
  }
  await sleep(1500);
}
appendFileSync('/home/z/my-project/sovereign/tmp/r193/fetch.log', '[done-fetch]\n');
