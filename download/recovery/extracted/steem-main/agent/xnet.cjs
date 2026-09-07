#!/usr/bin/env node
/**
 * xnet.cjs — Task 62: פריצת-הגבול הראשונה מעבר ל-Steem/Hive/Blurt.
 *
 * מפת-תקשורת חיה אל רשתות חכמות זרות: המערכת בודקת בזמן-אמת אילו
 * רשתות בנות-הישג מהמכונה הזאת (ריבונות-תקשורת), מודדת חביון,
 * וכותבת ראייה קריאה (xnet_map.json) — בלי תלות בשירות של צד-שלישי
 * ובלי לשלוח שום סוד (קריאות-קריאה בלבד).
 *
 * שימוש:  node xnet.cjs            (סריקה מלאה → xnet_map.json)
 *         node xnet.cjs --json     (פלט קונסולה בלבד)
 */
const https = require('https');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, 'xnet_map.json');

// כל רשת: {net, group, url, body} — body=קריאת-קריאה נייטרלית
const NETWORKS = [
  { net: 'ethereum', group: 'evm', url: 'https://ethereum-rpc.publicnode.com', body: { jsonrpc: '2.0', method: 'eth_chainId', params: [], id: 1 } },
  { net: 'bsc', group: 'evm', url: 'https://bsc-dataseed.binance.org', body: { jsonrpc: '2.0', method: 'eth_chainId', params: [], id: 1 } },
  { net: 'polygon', group: 'evm', url: 'https://polygon-rpc.com', body: { jsonrpc: '2.0', method: 'eth_chainId', params: [], id: 1 } },
  { net: 'base', group: 'evm-l2', url: 'https://mainnet.base.org', body: { jsonrpc: '2.0', method: 'eth_chainId', params: [], id: 1 } },
  { net: 'arbitrum', group: 'evm-l2', url: 'https://arb1.arbitrum.io/rpc', body: { jsonrpc: '2.0', method: 'eth_chainId', params: [], id: 1 } },
  { net: 'optimism', group: 'evm-l2', url: 'https://mainnet.optimism.io', body: { jsonrpc: '2.0', method: 'eth_chainId', params: [], id: 1 } },
  { net: 'avalanche', group: 'evm', url: 'https://api.avax.network/ext/bc/C/rpc', body: { jsonrpc: '2.0', method: 'eth_chainId', params: [], id: 1 } },
  { net: 'gnosis', group: 'evm', url: 'https://rpc.gnosischain.com', body: { jsonrpc: '2.0', method: 'eth_chainId', params: [], id: 1 } },
  { net: 'solana-mainnet', group: 'svm', url: 'https://api.mainnet-beta.solana.com', body: { jsonrpc: '2.0', id: 1, method: 'getVersion' } },
  { net: 'solana-devnet', group: 'svm', url: 'https://api.devnet.solana.com', body: { jsonrpc: '2.0', id: 1, method: 'getVersion' } },
  { net: 'tron', group: 'tvm', url: 'https://api.trongrid.io/wallet/getnowblock', body: {} },
  { net: 'ton', group: 'tvm', url: 'https://toncenter.com/api/v2/jsonRPC', body: { id: 1, jsonrpc: '2.0', method: 'getMasterchainInfo' } },
  { net: 'nano', group: 'block-lattice', url: 'https://rpc.nano.to', body: { action: 'block_count' } },
];

function postJson(urlStr, body, timeoutMs) {
  const u = new URL(urlStr);
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const req = https.request(
      {
        hostname: u.hostname, path: u.pathname + (u.search || ''), method: 'POST', family: 4,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
        timeout: timeoutMs,
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          const ms = Date.now() - t0;
          if (res.statusCode !== 200) return reject(new Error('http ' + res.statusCode + ' (' + ms + 'ms)'));
          try {
            const json = JSON.parse(data);
            resolve({ json, ms });
          } catch (_) {
            reject(new Error('bad json (' + ms + 'ms)'));
          }
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('timeout ' + timeoutMs + 'ms')));
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function summarize(net, json) {
  try {
    switch (net.group) {
      case 'evm': case 'evm-l2': {
        const id = json.result;
        return { chainId: parseInt(id, 16), tip: 'chainId=' + parseInt(id, 16) };
      }
      case 'svm':
        return { tip: 'solana-core ' + ((json.result && json.result['solana-core']) || '?') };
      case 'tvm':
        if (net.net === 'tron') {
          const b = json.result || {};
          return { tip: 'head ' + (b.block_header && b.block_header.raw_data ? b.block_header.raw_data.number : '?') };
        }
        return { tip: 'ton top-shard seqno ' + (((json.result || {}).result || {}).seqno || '?') };
      case 'block-lattice':
        return { tip: 'blocks ' + (((json.result || {}).count) || '?') };
      default:
        return { tip: 'ok' };
    }
  } catch (_) {
    return { tip: 'ok (unparsed)' };
  }
}

async function probeAll(timeoutMs = 12000) {
  const out = { probedAt: new Date().toISOString(), live: [], dead: [], totalMs: 0 };
  for (const net of NETWORKS) {
    try {
      const { json, ms } = await postJson(net.url, net.body, timeoutMs);
      const s = summarize(net, json);
      out.live.push({ net: net.net, group: net.group, url: net.url, ms, ...s });
      out.totalMs += ms;
    } catch (e) {
      out.dead.push({ net: net.net, url: net.url, why: String((e && e.message) || e).slice(0, 80) });
    }
  }
  out.live.sort((a, b) => a.ms - b.ms);
  return out;
}

async function main() {
  const map = await probeAll();
  const quiet = process.argv.includes('--json');
  if (!quiet) {
    console.log('XNET live ' + map.live.length + '/' + NETWORKS.length + ' (sum ' + map.totalMs + 'ms)');
    for (const l of map.live) console.log('  ✓ ' + l.net.padEnd(16) + String(l.ms).padStart(5) + 'ms  ' + l.tip);
    for (const d of map.dead) console.log('  ✗ ' + d.net.padEnd(16) + ' — ' + d.why);
  }
  fs.writeFileSync(OUT, JSON.stringify(map, null, 2) + '\n');
  return map;
}

module.exports = { probeAll, NETWORKS };
if (require.main === module) main().then((m) => process.exit(m.live.length ? 0 : 1)).catch((e) => { console.error('xnet fatal:', e.message); process.exit(1); });
