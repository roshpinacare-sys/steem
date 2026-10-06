// r194-a web research — z-ai web_search with honest retries (3x, backoff)
// research-only, keyless, no code changes to project sources
import ZAI from 'z-ai-web-dev-sdk';
import fs from 'fs';

const QUERIES = [
  'Uniswap v4 hooks production 2026 lessons',
  '1inch Fusion API MCP AI agents swap',
  'x402 protocol agent commerce stats 2026',
  'ERC-7683 cross-chain intents adopted',
  'Hive DEX HBD liquidity 2026',
  'Blurt blockchain price market',
  'grid trading AMM pool profitability market making',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function searchWithRetry(zai, query, maxAttempts = 3) {
  const attempts = [];
  for (let i = 0; i < maxAttempts; i++) {
    const t0 = Date.now();
    try {
      const r = await zai.functions.invoke('web_search', { query, num: 8 });
      attempts.push({ attempt: i + 1, ok: true, ms: Date.now() - t0 });
      return { query, ok: true, attempts, results: r };
    } catch (e) {
      const msg = String(e?.message || e);
      attempts.push({ attempt: i + 1, ok: false, ms: Date.now() - t0, error: msg.slice(0, 200) });
      console.log(`  [${query}] attempt ${i + 1} FAILED (${Date.now() - t0}ms): ${msg.slice(0, 140)}`);
      if (i < maxAttempts - 1) await sleep(2000 * (i + 1)); // 2s, 4s backoff
    }
  }
  return { query, ok: false, attempts, results: null };
}

function extractItems(r) {
  if (Array.isArray(r)) return r;
  if (r?.results && Array.isArray(r.results)) return r.results;
  if (r?.data && Array.isArray(r.data)) return r.data;
  return null;
}

const main = async () => {
  const zai = await ZAI.create();
  const out = { startedAt: new Date().toISOString(), tool: 'z-ai web_search', queries: [] };
  for (const q of QUERIES) {
    console.log(`\n>>> QUERY: ${q}`);
    const res = await searchWithRetry(zai, q);
    out.queries.push(res);
    await sleep(1000);
  }
  out.finishedAt = new Date().toISOString();
  fs.writeFileSync('/tmp/r194a-search-results.json', JSON.stringify(out, null, 2));
  const okCount = out.queries.filter((q) => q.ok).length;
  console.log(`\n=== DONE: ${okCount}/${QUERIES.length} queries succeeded (${out.startedAt} -> ${out.finishedAt}) ===`);
  for (const q of out.queries) {
    console.log(`\n### ${q.query} :: ${q.ok ? 'OK' : 'FAILED ' + q.attempts.filter(a => !a.ok).map(a => (a.error || '').slice(0, 60)).join('|')}`);
    const items = q.ok ? extractItems(q.results) : null;
    if (Array.isArray(items)) {
      for (const it of items.slice(0, 8)) {
        const url = it.url || it.link || '';
        console.log(`- ${it.title || it.name || '(no title)'} | ${url}`);
        const snip = it.snippet || it.description || it.content || '';
        if (snip) console.log(`  ${String(snip).replace(/\s+/g, ' ').slice(0, 240)}`);
      }
    } else if (q.ok) {
      console.log('UNEXPECTED SHAPE: ' + JSON.stringify(q.results).slice(0, 600));
    }
  }
};

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
