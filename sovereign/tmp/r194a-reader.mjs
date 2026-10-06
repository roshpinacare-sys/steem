// r194-a fallback: web_reader (page_reader) on canonical URLs after web_search hard-429
// research-only, keyless, no code changes to project sources
import ZAI from 'z-ai-web-dev-sdk';
import fs from 'fs';

const URLS = [
  'https://docs.uniswap.org/contracts/v4/concepts/hooks',
  'https://docs.1inch.io/docs/fusion/introduction',
  'https://x402.org',
  'https://eips.ethereum.org/EIPS/eip-7683',
  'https://docs.steer.finance/',
  'https://docs.cow.fi/cow-protocol/concepts/intents',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function readWithRetry(zai, url, maxAttempts = 3) {
  const attempts = [];
  for (let i = 0; i < maxAttempts; i++) {
    const t0 = Date.now();
    try {
      const r = await zai.functions.invoke('page_reader', { url });
      attempts.push({ attempt: i + 1, ok: true, ms: Date.now() - t0 });
      return { url, ok: true, attempts, result: r };
    } catch (e) {
      const msg = String(e?.message || e);
      attempts.push({ attempt: i + 1, ok: false, ms: Date.now() - t0, error: msg.slice(0, 200) });
      console.log(`  [${url}] attempt ${i + 1} FAILED (${Date.now() - t0}ms): ${msg.slice(0, 140)}`);
      if (i < maxAttempts - 1) await sleep(2000 * (i + 1));
    }
  }
  return { url, ok: false, attempts, result: null };
}

function htmlToText(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

const main = async () => {
  const zai = await ZAI.create();
  const out = { startedAt: new Date().toISOString(), tool: 'z-ai page_reader (fallback after web_search 429)', pages: [] };
  for (const u of URLS) {
    console.log(`\n>>> READ: ${u}`);
    const res = await readWithRetry(zai, u);
    out.pages.push(res);
    await sleep(1000);
  }
  out.finishedAt = new Date().toISOString();
  fs.writeFileSync('/tmp/r194a-reader-results.json', JSON.stringify(out, null, 2));
  const okCount = out.pages.filter((p) => p.ok).length;
  console.log(`\n=== DONE: ${okCount}/${URLS.length} pages fetched (${out.startedAt} -> ${out.finishedAt}) ===`);
  for (const p of out.pages) {
    console.log(`\n##### ${p.url} :: ${p.ok ? 'OK' : 'FAILED ' + p.attempts.filter(a => !a.ok).map(a => (a.error || '').slice(0, 70)).join('|')}`);
    if (p.ok) {
      const d = p.result?.data || p.result || {};
      const text = htmlToText(d.html);
      console.log(`TITLE: ${d.title || '(none)'} | publishedTime: ${d.publishedTime || '(none)'} | tokens: ${d.usage?.tokens ?? '?'}`);
      console.log(`TEXT[:2600]: ${text.slice(0, 2600)}`);
    }
  }
  // one final honest web_search probe after the reader run (time has passed)
  console.log('\n>>> FINAL web_search probe (after fallback run)');
  try {
    const r = await zai.functions.invoke('web_search', { query: 'x402 protocol agent commerce', num: 5 });
    console.log('FINAL PROBE OK: ' + JSON.stringify(r).slice(0, 800));
    out.finalWebSearchProbe = { ok: true, sample: r };
  } catch (e) {
    console.log('FINAL PROBE 429/FAILED: ' + String(e?.message || e).slice(0, 140));
    out.finalWebSearchProbe = { ok: false, error: String(e?.message || e).slice(0, 200) };
  }
  fs.writeFileSync('/tmp/r194a-reader-results.json', JSON.stringify(out, null, 2));
};

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
