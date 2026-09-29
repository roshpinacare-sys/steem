#!/usr/bin/env node
/**
 * net_site.cjs — SAOS-WEB: a website STORED IN THE BLOCKCHAIN.
 *
 * "מה שהשרשרת מאפשרת והיא לא יודעת" — the chain allows custom_json ops
 * carrying arbitrary data; it does not know it is being used as a web host.
 * This script publishes an HTML page as a content-addressed SAOS-KV document
 * (id='saos_kv', protocol 'saos-kv/v1'), then performs the mandatory
 * read-back: pull from public chain history, reassemble, sha256-compare.
 * Only a hash-match counts. The gateway (/api/net/site) serves the verified
 * page with X-SAOS-* headers so anyone can see where it came from.
 *
 * Result → agent/net_site_result.json · cache → agent/net_site_cache.json
 */
// 8-b: חשבון-פעולה חובה לפני-כל-טעינה — אין ברירת-מחדל, לעולם (המשך 7-c · docs/117o-KEY-INCIDENT.md)
if (!process.env.AGENT_ACCOUNT) { console.error('usage: AGENT_ACCOUNT=<account> node agent/net_site.cjs — no default acting account (2026-09-08 incident)'); process.exit(1); }
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const steem = require('steem');

function loadDotEnv(dir) {
  const envPath = path.join(dir, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (!(key in process.env)) process.env[key] = val;
  }
}
loadDotEnv(__dirname);

const ACCOUNT = (process.env.AGENT_ACCOUNT || '').toLowerCase();
steem.api.setOptions({ url: process.env.RPC_URL || 'https://api.steemit.com' });
const POSTING_WIF = process.env.POSTING_WIF || '';
const { resolveLiveGate, announceGate } = require('./lib/live_gate.cjs');
const GATE = resolveLiveGate(process.argv, { account: ACCOUNT });
const DRY = GATE.dry || String(process.env.DRY_RUN || '').toLowerCase() === 'true';
announceGate(Object.assign({}, GATE, { live: !DRY, dry: DRY }), log);

const VERIFY_ONLY = process.argv.includes('--verify');
const KEY = 'saos://www/index.html';
const MAX_OP_JSON = 8000; // measured wall 8192 — 192B headroom

function log(msg) { console.log('[' + new Date().toISOString() + '] saos-web: ' + msg); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// multi-node history merge (api.steemit.com backends flap — measured)
const HIST_NODES = ['https://api.steemit.com', 'https://steemapi.boylikegirl.club', 'https://api.justyy.com'];
function rpcV4(urlStr, body) {
  const u = new URL(urlStr);
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname: u.hostname, path: u.pathname || '/', method: 'POST', family: 4, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }, timeout: 20000 },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json.error) return reject(new Error(json.error.message || 'rpc error'));
            resolve(json.result);
          } catch (_) {
            reject(new Error('bad rpc response: ' + data.slice(0, 120)));
          }
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('rpc timeout 20s')));
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}
async function histRpcAll() {
  const merged = [];
  const seen = new Set();
  for (const node of HIST_NODES) {
    try {
      const r = await rpcV4(node, { jsonrpc: '2.0', method: 'condenser_api.get_account_history', params: [ACCOUNT, -1, 200], id: 1 });
      for (const e of r || []) {
        if (seen.has(e[0])) continue;
        seen.add(e[0]);
        merged.push(e);
      }
    } catch (_) { /* next node */ }
  }
  merged.sort((a, b) => a[0] - b[0]);
  return merged;
}

/** build the site — compact, dark, RTL, zero external assets */
async function buildHtml() {
  let headBlock = null;
  try {
    const dgp = await steem.api.getDynamicGlobalPropertiesAsync();
    headBlock = dgp.head_block_number;
  } catch (_) { /* keep null */ }
  let armySize = null;
  try {
    const st = JSON.parse(fs.readFileSync(path.join(__dirname, 'agent-status.json'), 'utf8'));
    armySize = st.army && st.army.size;
  } catch (_) { /* keep null */ }
  const ts = new Date().toISOString();
  const html = `<!doctype html><html dir="rtl" lang="he"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SAOS — אתר על הבלוקצ'יין</title><style>*{box-sizing:border-box;margin:0;padding:0}body{background:#09090b;color:#e4e4e7;font-family:system-ui,'Segoe UI',Arial,sans-serif;min-height:100vh;display:flex;flex-direction:column;align-items:center;padding:48px 20px}main{max-width:640px;width:100%}h1{font-size:28px;font-weight:900;color:#fafafa;line-height:1.3}h1 span{color:#34d399}.sub{margin-top:10px;color:#a1a1aa;font-size:14px;line-height:1.8}.card{margin-top:22px;background:#18181b;border:1px solid #27272a;border-radius:14px;padding:16px}.card h2{font-size:13px;color:#d4d4d8;margin-bottom:10px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}.cell{background:#09090b;border:1px solid #27272a;border-radius:10px;padding:10px}.cell .k{font-size:10px;color:#71717a}.cell .v{font-size:13px;color:#fbbf24;font-family:ui-monospace,monospace;direction:ltr;text-align:right}p{color:#a1a1aa;font-size:13px;line-height:1.9;margin-top:10px}code{background:#27272a;border-radius:6px;padding:1px 6px;color:#fbbf24;font-size:12px;direction:ltr;display:inline-block}footer{margin-top:26px;color:#52525b;font-size:11px;line-height:1.8;text-align:center}</style></head><body><main><h1>העמוד הזה לא שוכן בשרת.<br><span>הוא שוכן בשרשרת.</span></h1><p class="sub">אין דומיין, אין DNS, אין הוסטינג, אין שרת-אינטרנט פעיל. כל בייט בעמוד הזה שודר במקור כפעולת <code>custom_json</code> על בלוקצ'יין Steem (id=<code>saos_kv</code>), ממוען-תוכן לפי <code>sha256</code>, ונשלף מההיסטוריה הציבורית בזמן שהדפדפן שלך ביקש אותו.</p><div class="card"><h2>הוכחת-מקור — נמדד על-השרשרת</h2><div class="grid"><div class="cell"><div class="k">בלוק</div><div class="v">${headBlock ?? '—'}</div></div><div class="cell"><div class="k">זמן פרסום (UTC)</div><div class="v">${ts.slice(0, 19)}</div></div><div class="cell"><div class="k">חיילים ברשת</div><div class="v">${armySize ?? '—'}</div></div><div class="cell"><div class="k">פרוטוקול</div><div class="v">saos-web/v1</div></div></div></div><div class="card"><h2>איך זה עובד</h2><p>המסמך נחתם במפתח-הפרסום של <code>@${ACCOUNT}</code> ופורסם למרשם <code>saos://www/index.html</code>. ההגשה שקיבלת עברה אימות כפוי: קריאה מההיסטוריה → הרכבה מחדש → השוואת <code>sha256</code>. מסמך שלא חוזר זהה לא מוגש. ה-hash המלא מופיע בכותרת התגובה <code>X-SAOS-Sha256</code> — כל אחד יכול לאמת מול כל צומת Steem בעולם.</p></div><footer>SAOS-KV v1 · מנוע-אחסון ממוען-תוכן על Steem · אם מחר ייעלם כל שרת בעולם — ההיסטוריה של השרשרת עדיין תגיש את הדף הזה</footer></main></body></html>`;
  return { html, headBlock, ts, armySize };
}

async function putDoc(key, doc) {
  const json = JSON.stringify(doc);
  const sha = crypto.createHash('sha256').update(json).digest('hex');
  const size = Buffer.byteLength(json);
  const chunkData = Math.max(2000, MAX_OP_JSON - 420);
  const parts = Math.max(1, Math.ceil(size / chunkData));
  log(`put "${key}" · ${size}B · sha256=${sha.slice(0, 16)}… · ${parts} part(s)`);
  if (DRY) return { dry: true, parts, size, sha256: sha };
  const txids = [];
  for (let p = 0; p < parts; p++) {
    const data = json.slice(p * chunkData, (p + 1) * chunkData);
    const payload = { protocol: 'saos-kv/v1', action: 'put', key, part: p, parts, size, sha256: sha, data };
    const op = ['custom_json', { required_auths: [], required_posting_auths: [ACCOUNT], id: 'saos_kv', json: JSON.stringify(payload) }];
    const conf = await steem.broadcast.sendAsync({ operations: [op], extensions: [] }, [POSTING_WIF]);
    txids.push((conf && conf.id) || null);
    log('  part ' + (p + 1) + '/' + parts + ' → txid ' + ((conf && conf.id) || 'n/a'));
    if (p + 1 < parts) await sleep(3400);
  }
  return { key, size, sha256: sha, parts, txids };
}

async function readDoc(key) {
  for (let attempt = 1; attempt <= 6; attempt++) {
    let hist = [];
    try { hist = await histRpcAll(); } catch (_) { /* retry */ }
    const byPart = {};
    let meta = null;
    for (const [, e] of hist) {
      if (e.op[0] !== 'custom_json' || e.op[1].id !== 'saos_kv') continue;
      try {
        const pl = JSON.parse(e.op[1].json);
        if (pl.action !== 'put' || pl.key !== key) continue;
        byPart[pl.part] = { data: pl.data, txid: e.trx_id };
        meta = { parts: pl.parts, sha256: pl.sha256, size: pl.size };
      } catch (_) { /* next */ }
    }
    if (meta && Object.keys(byPart).length >= meta.parts) {
      const json = Array.from({ length: meta.parts }, (_, i) => byPart[i].data).join('');
      const sha = crypto.createHash('sha256').update(json).digest('hex');
      return {
        key, parts: meta.parts, size: meta.size,
        hashMatch: sha === meta.sha256,
        sha256: sha, expectedSha256: meta.sha256,
        doc: JSON.parse(json),
        txids: Array.from({ length: meta.parts }, (_, i) => byPart[i].txid),
        attempts: attempt,
      };
    }
    if (attempt < 6) await sleep(6000);
  }
  return null;
}

async function main() {
  if (!POSTING_WIF) { log('no POSTING_WIF'); process.exit(1); }
  if (VERIFY_ONLY) {
    log('verify-only: reading back the last published site from chain history');
    const back = await readDoc(KEY);
    if (back && back.doc && back.doc.html && back.hashMatch) {
      fs.writeFileSync(path.join(__dirname, 'net_site_cache.json'), JSON.stringify({
        at: new Date().toISOString(), html: back.doc.html, sha256: back.sha256, size: back.size,
        parts: back.parts, headBlock: back.doc.headBlock || null, ts: back.doc.ts || null,
        txids: back.txids, verified: true,
      }, null, 2) + '\n');
      log('VERIFY ✓ sha256=' + back.sha256.slice(0, 16) + '… — cache written');
    } else {
      log('VERIFY: ' + (back ? 'hash mismatch' : 'not found yet — history index still lagging'));
      process.exit(1);
    }
    return;
  }
  const built = await buildHtml();
  const doc = {
    protocol: 'saos-web/v1',
    type: 'html',
    path: '/',
    account: ACCOUNT,
    ts: built.ts,
    headBlock: built.headBlock,
    html: built.html,
  };
  const put = await putDoc(KEY, doc);
  await sleep(4000);
  const back = await readDoc(KEY);
  const verified = !!(back && back.hashMatch);
  log('ROUNDTRIP: ' + (verified ? 'VERIFIED ✓ — the site lives on the chain' : (back ? 'HASH MISMATCH' : 'not found in history yet')));
  const result = {
    at: new Date().toISOString(),
    key: KEY,
    put,
    readBack: back ? { parts: back.parts, size: back.size, hashMatch: back.hashMatch, sha256: back.sha256, attempts: back.attempts, txids: back.txids } : null,
    verified,
    htmlSize: Buffer.byteLength(doc.html),
  };
  fs.writeFileSync(path.join(__dirname, 'net_site_result.json'), JSON.stringify(result, null, 2) + '\n');
  if (verified && back && back.doc && back.doc.html) {
    fs.writeFileSync(path.join(__dirname, 'net_site_cache.json'), JSON.stringify({
      at: result.at,
      html: back.doc.html,
      sha256: back.sha256,
      size: back.size,
      parts: back.parts,
      headBlock: back.doc.headBlock || null,
      ts: back.doc.ts || null,
      txids: back.txids,
      verified: true,
    }, null, 2) + '\n');
    log('→ net_site_cache.json (gateway will serve this verified page)');
  }
}

main().catch((e) => {
  log('fatal: ' + String((e && e.message) || e).slice(0, 300));
  process.exit(1);
});
