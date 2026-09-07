#!/usr/bin/env node
/* hive_announce_watch.cjs — poll head Hive RC; when ≥450M fire the Hive-side protocol spec post. */
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const https = require('https');
function rpc(method, params) {
  return new Promise((res, rej) => {
    const p = JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 });
    const r = https.request({ hostname: 'api.hive.blog', path: '/', method: 'POST', family: 4, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(p) }, timeout: 15000 }, (x) => {
      let d = ''; x.on('data', (c) => (d += c)); x.on('end', () => { try { const j = JSON.parse(d); if (j.error) return rej(new Error(JSON.stringify(j.error).slice(0, 60))); res(j.result); } catch (e) { rej(new Error('bad')); } });
    }); r.on('error', rej); r.write(p); r.end();
  });
}
async function headRc() {
  const j = await rpc('rc_api.find_rc_accounts', { accounts: ['headcorner'] });
  const a = j.result.rc_accounts[0];
  return { cur: Number(a.rc_manabar.current_mana), max: Number(a.max_rc) };
}
(async () => {
  const NEED = 450e6;
  for (let i = 0; i < 14; i++) {
    try {
      const { cur } = await headRc();
      console.log(new Date().toISOString(), 'head Hive RC', Math.round(cur / 1e6) + 'M / need 450M');
      if (cur >= NEED) {
        console.log('RC ready — firing Hive-side announce');
        const out = await new Promise((res) => execFile(process.execPath, [path.join(__dirname, 'post_announce.cjs'), '--hive'], { timeout: 120000 }, (e, so, se) => res((so || '') + (se || '') + (e ? ' ERR:' + e.message : ''))));
        console.log(out.slice(-600));
        fs.writeFileSync(path.join(__dirname, 'hive_announce_watch.log'), out);
        return;
      }
    } catch (e) { console.log('probe err', e.message); }
    await new Promise((r) => setTimeout(r, 5 * 60 * 1000));
  }
  console.log('window closed — RC not ready in 70min');
})();
