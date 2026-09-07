#!/usr/bin/env node
/* probe64.cjs — Task 64 one-shot probe (no keys, read-only):
 * 1. powerspan birth check
 * 2. headcorner SP / vesting / delegation state (Steem)
 * 3. delegate_rc retest on Hive (RC API — was Task 58's negative an RC-starvation artifact?)
 * 4. oracle connectivity for leading-market coins (BTC/ETH/SOL/XRP/DOGE)
 * 5. current wrapped state summary
 */
const https = require('https');
function rpcV4(urlStr, body) {
  const u = new URL(urlStr);
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname: u.hostname, path: u.pathname || '/', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }, timeout: 15000 }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => { try { const j = JSON.parse(data); j.error ? reject(new Error(j.error.message || 'rpc')) : resolve(j.result); } catch (_) { reject(new Error('bad:' + data.slice(0, 80))); } });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.write(payload); req.end();
  });
}
function get(urlStr) {
  return new Promise((resolve, reject) => {
    https.get(urlStr, { timeout: 12000, headers: { 'User-Agent': 'saos/64' } }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (_) { reject(new Error('bad json ' + res.statusCode)); } });
    }).on('timeout', function () { this.destroy(new Error('timeout')); }).on('error', reject);
  });
}
async function main() {
  const out = {};
  // 1+2: accounts
  for (const [net, node] of [['steem', 'https://api.steemit.com'], ['hive', 'https://api.hive.blog']]) {
    try {
      const r = await rpcV4(node, { jsonrpc: '2.0', method: 'condenser_api.get_accounts', params: [['headcorner', 'powerspan']], id: 1 });
      const accs = r || [];
      out[net + '_accounts'] = accs.map((a) => ({
        name: a.name, exists: true,
        vesting: String(a.vesting_shares), delegated_out: String(a.delegated_vesting_shares), received: String(a.received_vesting_shares),
        balance: String(a.balance), sbd: String(a.sbd_balance || a.hbd_balance),
      }));
      if (net === 'steem') {
        const dgp = await rpcV4(node, { jsonrpc: '2.0', method: 'condenser_api.get_dynamic_global_properties', params: [], id: 1 });
        const tvf = parseFloat(String(dgp.total_vesting_fund_steem).split(' ')[0]);
        const tvs = parseFloat(String(dgp.total_vesting_shares).split(' ')[0]);
        out.spPerMvests = (tvf / tvs) * 1e6; // SP per million VESTS
      }
    } catch (e) { out[net + '_err'] = String(e.message).slice(0, 90); }
  }
  // 3: Hive RC + delegate_rc op presence (rc_api + condenser op list)
  try {
    const rc = await rpcV4('https://api.hive.blog', { jsonrpc: '2.0', method: 'rc_api.find_rc_accounts', params: { accounts: ['headcorner'] }, id: 1 });
    const row = (rc.rc_accounts || [])[0];
    out.hiveRc = row ? { mana: Number(row.rc_manabar.current_mana), max: Number(row.max_rc) } : null;
  } catch (e) { out.hiveRcErr = String(e.message).slice(0, 80); }
  try {
    // does the node know the delegate_rc op? (get_required signatures path or condenser ops enum via api lookup)
    const ops = await rpcV4('https://api.hive.blog', { jsonrpc: '2.0', method: 'condenser_api.get_account_history', params: ['headcorner', -1, 5], id: 1 });
    out.hiveHistOk = Array.isArray(ops);
  } catch (e) { out.hiveHistErr = String(e.message).slice(0, 80); }
  // 4: oracles
  const oracles = {
    binance: 'https://api.binance.com/api/v3/ticker/price?symbols=%5B%22BTCUSDT%22,%22ETHUSDT%22,%22SOLUSDT%22,%22XRPUSDT%22,%22DOGEUSDT%22%5D',
    coingecko: 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana,ripple,dogecoin&vs_currencies=usd',
    coinbase: 'https://api.coinbase.com/v2/exchange-rates?currency=USD',
    kraken: 'https://api.kraken.com/0/public/Ticker?pair=XBTUSD,ETHUSD',
  };
  out.oracles = {};
  for (const [k, u] of Object.entries(oracles)) {
    try { const j = await get(u); out.oracles[k] = { ok: true, sample: JSON.stringify(j).slice(0, 200) }; }
    catch (e) { out.oracles[k] = { ok: false, err: String(e.message).slice(0, 90) }; }
  }
  // 5: wrapped state
  try {
    const st = require('./wrapped_state.json');
    out.wrapped = { booted: st.booted, assets: Object.fromEntries(Object.entries(st.assets || {}).map(([k, v]) => [k, { minted: v.minted, lockedSbd: v.lockedSbd, lockedHive: v.lockedHive }])), fees: st.fees, opsToday: st.opsToday };
  } catch (e) { out.wrappedErr = String(e.message).slice(0, 60); }
  console.log(JSON.stringify(out, null, 1));
}
main().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
