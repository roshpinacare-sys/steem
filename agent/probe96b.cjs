#!/usr/bin/env node
/* probe96b.cjs — contract-existence 2nd source test */
'use strict';
const https = require('https');
const get = (url) => new Promise((res, rej) => {
  https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' }, timeout: 20000 }, (r) => {
    let d = '';
    r.on('data', (c) => (d += c));
    r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(new Error('parse: ' + d.slice(0, 100))); } });
  }).on('error', rej);
});
const post = (url, body) => new Promise((res, rej) => {
  const data = JSON.stringify(body || {});
  const u = new URL(url);
  const req = https.request({ hostname: u.hostname, path: u.pathname, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }, timeout: 15000 }, (r) => {
    let d = '';
    r.on('data', (c) => (d += c));
    r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(new Error('parse: ' + d.slice(0, 100))); } });
  });
  req.on('error', rej);
  req.write(data);
  req.end();
});
(async () => {
  const a = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
  const acc = await get('https://apilist.tronscanapi.com/api/accountv2?address=' + a);
  console.log('tronscan accountv2:', JSON.stringify({ address: acc.address, accountType: acc.accountType, tokenTitleCount: acc.tokenTitleCount, contractMapKeys: acc.smartContract ? Object.keys(acc.smartContract) : null }).slice(0, 250));
  const g = await post('https://api.trongrid.io/walletsolidity/getaccount', { address: a, visible: true });
  console.log('trongrid getaccount(contract):', JSON.stringify(g).slice(0, 250));
})().catch((e) => { console.log('FATAL:', e.message); process.exit(1); });
