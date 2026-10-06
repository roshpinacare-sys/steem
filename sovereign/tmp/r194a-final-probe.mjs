// r194-a last delayed probe: after ~3 min cool-down, one web_search + one page_reader attempt
import ZAI from 'z-ai-web-dev-sdk';
import fs from 'fs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = { startedAt: new Date().toISOString() };

const main = async () => {
  console.log('cooling down 180s before final probes...');
  await sleep(180000);
  const zai = await ZAI.create();
  out.probeAt = new Date().toISOString();
  try {
    const r = await zai.functions.invoke('web_search', { query: 'Uniswap v4 hooks production lessons', num: 8 });
    out.web_search = { ok: true, sample: r };
    console.log('web_search OK: ' + JSON.stringify(r).slice(0, 600));
  } catch (e) {
    out.web_search = { ok: false, error: String(e?.message || e).slice(0, 200) };
    console.log('web_search FAILED: ' + String(e?.message || e).slice(0, 140));
  }
  try {
    const r = await zai.functions.invoke('page_reader', { url: 'https://x402.org' });
    out.page_reader = { ok: true, title: r?.data?.title };
    console.log('page_reader OK: ' + JSON.stringify({ title: r?.data?.title }).slice(0, 300));
  } catch (e) {
    out.page_reader = { ok: false, error: String(e?.message || e).slice(0, 200) };
    console.log('page_reader FAILED: ' + String(e?.message || e).slice(0, 140));
  }
  out.finishedAt = new Date().toISOString();
  fs.writeFileSync('/tmp/r194a-final-probe.json', JSON.stringify(out, null, 2));
  console.log('RESULT: ' + JSON.stringify({ web_search: out.web_search.ok, page_reader: out.page_reader.ok }));
};

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
