#!/usr/bin/env node
/* blurt_revive.cjs — Task 99b: דופק-תחייה אחרי-איפוס-סנדבוקס.
 *
 * התרחיש: איפוס-סביבה השאיר blurt_health.json שגוי-עובדתית (קירור "מדוד-מת"
 * שנקבע בזמן-כאוס-האתחול, בעוד השרשרת חיה ומוכחת). הדוקטרינה של fix-89:
 * "הצלחה → מחיקת-הקירור". הסקריפט הזה הוא ההצלחה הממוסדת:
 *   1. מדידה חיה של שלושת הצמתים (דורש ≥1 חי עם ראש עדכני)
 *   2. שידור custom_json saos.id.v1 אמיתי (active-signed · אפס-עמלה)
 *   3. אימות היסטוריה (findInHistory) — השידור נראה בשרשרת
 *   4. רק אז blurtMarkAlive() — הקירור השגוי נמחק על-ידי הצלחה מדודה
 *
 * שימוש:  node blurt_revive.cjs [--dry]
 * פלט:    agent/blurt_revive_result.json
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const anchorMod = require('./anchor.cjs');
const { wifToScalar, deriveIdentities } = require('./identity.cjs');
const ecurve = require('ecurve');

const {
  blurtBroadcast, rpcV4, findInHistory, blurtMarkAlive, blurtMarkFail,
  blurtDeadUntil, BLURT_ENDPOINTS, ANCHOR_ID,
} = anchorMod;

const { resolveLiveGate, announceGate } = require('./lib/live_gate.cjs');
const GATE = resolveLiveGate(process.argv);
const DRY = GATE.dry;
announceGate(GATE);

const RESULT = path.join(__dirname, 'blurt_revive_result.json');
const SECP = ecurve.getCurveByName('secp256k1');

function loadDotEnv(dir) {
  try {
    const raw = fs.readFileSync(path.join(dir, '.env'), 'utf8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch (_) {}
}
loadDotEnv(__dirname);

const ACCOUNT = (process.env.AGENT_ACCOUNT || 'headcorner').toLowerCase();
const R = { at: new Date().toISOString(), mode: DRY ? 'DRY' : 'LIVE', steps: [] };
const step = (name, data) => { R.steps.push(Object.assign({ name }, data)); console.log(name + ': ' + JSON.stringify(data).slice(0, 320)); };

async function measureHeads() {
  const heads = [];
  for (const ep of BLURT_ENDPOINTS) {
    try {
      /* rpcV4 פותר כבר את json.result — הראש ישירות על הערך */
      const r = await rpcV4(ep, { jsonrpc: '2.0', method: 'condenser_api.get_dynamic_global_properties', params: [], id: 1 });
      if (r && r.head_block_number) {
        heads.push({ endpoint: ep, headBlock: r.head_block_number, time: r.time });
      }
    } catch (_) { /* מת — כנות */ }
  }
  return heads;
}

(async function main() {
  try {
    // 1) מדידה חיה — בלי זה אין הצדקה לנגוע בקירור
    const heads = await measureHeads();
    step('measure', { live: heads.length, of: BLURT_ENDPOINTS.length, heads });
    if (!heads.length) {
      blurtMarkFail('revive: all endpoints dead at measure');
      throw new Error('all Blurt endpoints dead — cooldown stays (honest)');
    }
    const maxHead = Math.max.apply(null, heads.map((h) => h.headBlock));

    if (DRY) { step('revive', { dry: true, wouldBroadcast: 'saos.id.v1 revive-pulse' }); fs.writeFileSync(RESULT, JSON.stringify(R, null, 2)); return; }

    // 2) שידור אמיתי — דופק תחייה על השרשרת
    const at = new Date().toISOString();
    const nonce = crypto.randomBytes(8).toString('hex');
    const payload = {
      protocol: 'saos/v1',
      action: 'anchor-id',
      at,
      msg: 'saos-grid-99 blurt-wire REVIVED after sandbox reset | head=' + maxHead + ' | live=' + heads.length + '/3 | stale-cooldown-honestly-cleared',
      evm: deriveIdentities(process.env.ACTIVE_WIF || '').evmAddress,
      g99: { revive: true, head: maxHead, liveEndpoints: heads.length, prevCooldownUntil: blurtDeadUntil() ? new Date(blurtDeadUntil()).toISOString() : null, src: 'blurt_revive.cjs' },
      chains: ['blurt'],
    };
    const op = ['custom_json', { required_auths: [ACCOUNT], required_posting_auths: [], id: ANCHOR_ID, json: JSON.stringify(payload) }];
    const { d } = wifToScalar(process.env.ACTIVE_WIF || '');
    const signerPoint = SECP.G.multiply(d);
    const r = await blurtBroadcast([op], process.env.ACTIVE_WIF, signerPoint, ACCOUNT, at);
    step('broadcast', { endpoint: r.endpoint, txid: r.txid });

    // 3) אימות-היסטוריה — השידור נראה
    const seen = await findInHistory(r.endpoint, ACCOUNT, at, 40, 14);
    step('verify', { visible: !!seen });
    if (!seen) throw new Error('broadcast ok but invisible in history — NOT clearing cooldown (honest)');

    // 4) ההצלחה הממוסדת — הקירור השגוי נמחק
    blurtMarkAlive();
    step('cooldown', { cleared: true, wasStale: true });

    R.ok = true;
  } catch (e) {
    R.ok = false;
    R.error = String((e && e.message) || e).slice(0, 200);
    console.log('revive FAILED: ' + R.error);
  }
  fs.writeFileSync(RESULT, JSON.stringify(R, null, 2));
  console.log('result → ' + RESULT + ' · ok=' + !!R.ok);
  process.exit(R.ok ? 0 : 1);
})();
