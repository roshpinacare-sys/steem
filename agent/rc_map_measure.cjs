#!/usr/bin/env node
/** rc_map_measure.cjs — read-only full RC map (Steem treasury+army, Hive headcorner) */
const fs = require('fs'), path = require('path'), https = require('https');
function rpcV4(urlStr, body) {
  const u = new URL(urlStr); const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname: u.hostname, path: u.pathname || '/', method: 'POST', family: 4, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }, timeout: 20000 }, (res) => {
      let data = ''; res.on('data', (c) => (data += c)); res.on('end', () => { try { const j = JSON.parse(data); if (j.error) return reject(new Error(j.error.message || 'rpc')); resolve(j.result); } catch (_) { reject(new Error('bad rpc')); } });
    }); req.on('timeout', () => req.destroy(new Error('timeout'))); req.on('error', reject); req.write(payload); req.end();
  });
}
function rcNow(rc) { if (!rc) return null; const max = Number(rc.max_rc), stored = Number(rc.rc_manabar.current_mana), lu = Number(rc.rc_manabar.last_update_time); const now = Math.floor(Date.now() / 1000); return { max, stored, cur: Math.min(max, stored + Math.floor(((now - lu) * max) / (5 * 86400))), pct: max ? (Math.min(max, stored + Math.floor(((now - lu) * max) / (5 * 86400))) / max) * 100 : 0 }; }
async function main() {
  const v = JSON.parse(fs.readFileSync(path.join(__dirname, 'keys', 'vault.json'), 'utf8'));
  const names = ['headcorner'].concat((v.accounts || []).map((a) => a.username).filter((u) => u && u.toLowerCase() !== 'headcorner'));
  const steemRc = await rpcV4('https://api.steemit.com', { jsonrpc: '2.0', method: 'rc_api.find_rc_accounts', params: { accounts: names }, id: 1 });
  const steemAcc = await rpcV4('https://api.steemit.com', { jsonrpc: '2.0', method: 'condenser_api.get_accounts', params: [names], id: 1 });
  const hiveRc = await rpcV4('https://api.hive.blog', { jsonrpc: '2.0', method: 'rc_api.find_rc_accounts', params: { accounts: ['headcorner'] }, id: 1 });
  const hiveAcc = await rpcV4('https://api.hive.blog', { jsonrpc: '2.0', method: 'condenser_api.get_accounts', params: [['headcorner']], id: 1 });
  const out = { at: new Date().toISOString(), steem: [], hive: null };
  (steemRc.rc_accounts || []).forEach((r) => {
    const m = rcNow(r); const a = (steemAcc || []).find((x) => x.name === r.account) || {};
    out.steem.push({ account: r.account, maxRc: m.max, rcNow: m.cur, pct: +m.pct.toFixed(1), sp: String(a.vesting_shares || ''), delegIn: String(a.delegated_vesting_shares || ''), steem: String(a.balance || '') });
  });
  const hrc = rcNow((hiveRc.rc_accounts || [])[0]); const ha = (hiveAcc || [])[0] || {};
  out.hive = { maxRc: hrc.max, rcNow: hrc.cur, pct: +hrc.pct.toFixed(1), hp: String(ha.vesting_shares || ''), hive: String(ha.balance || ''), hbd: String(ha.hbd_balance || '') };
  fs.writeFileSync(path.join(__dirname, 'rc_map.json'), JSON.stringify(out, null, 2));
  for (const s of out.steem) console.log('STEEM @' + s.account.padEnd(14) + ' rc=' + (s.rcNow / 1e9).toFixed(2) + 'G / ' + (s.maxRc / 1e9).toFixed(2) + 'G (' + s.pct + '%) sp=' + s.sp + ' deleIn=' + s.delegIn + ' liq=' + s.steem);
  console.log('HIVE  @headcorner  rc=' + (out.hive.rcNow / 1e9).toFixed(2) + 'G / ' + (out.hive.maxRc / 1e9).toFixed(2) + 'G (' + out.hive.pct + '%) hp=' + out.hive.hp + ' hive=' + out.hive.hive + ' hbd=' + out.hive.hbd);
}
main().catch((e) => { console.error('ERR', e.message); process.exit(1); });
