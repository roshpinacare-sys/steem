#!/usr/bin/env node
/**
 * anchor.cjs — עוגן-זהות חוצה-פרדיגמות (Task 44).
 *
 * מהלך אחד, שלוש שרשראות, הוכחה קריפטוגרפית שכל צד-שלישי יכול לבדוק בעצמו:
 *   1. הודעה נייטרלית + nonce אקראי נוצרים מקומית
 *   2. חתימה EIP-191 (personal_sign) עם אותו סקלר secp256k1 של ACTIVE_WIF — low-s
 *   3. custom_json (סמכות active) על Steem + Hive + Blurt עם החתימה בתוך ה-payload
 *      (id="saos.id.v1" — נפרד מאוטובוס "saos" כדי שהגשר לא ישכפל)
 *   4. כל מאמת יכול: ecrecover(hash(EIP-191), sig) → נקודת EC == הסמכות-active
 *      החיה של @headcorner על שלוש השרשראות → אותו מפתח פרטי שולט בחשבונות
 *      ה-Graphene ובכתובת ה-EVM. בלי לחשוף את המפתח, בלי לחשוף קלפים.
 *
 * שימוש: node anchor.cjs [--dry]
 * פלט:   agent/anchor_last.json {at, msg, evm, sig, txids, anchorsTotal, verifier}
 *        (רץ גם כלולאת-דמון — החזרה: runAnchor())
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const steem = require('steem');
const {
  deriveIdentities,
  wifToScalar,
  eip191Hash,
  ecdsaSignLowS,
  ecdsaRecover,
  sigToEvmHex,
  toChecksumAddress,
} = require('./identity.cjs');
const { keccak256 } = require('js-sha3');
const HIVE_RC = require('./hive_rc.cjs'); // 103 — RC-DISCIPLINE

const ANCHOR_ID = 'saos.id.v1';
const HIVE_RPC = process.env.HIVE_RPC || 'https://api.hive.blog';
const HIVE_CHAIN_ID = 'beeab0de00000000000000000000000000000000000000000000000000000000';
const BLURT_CHAIN_ID = 'cd8d90f29ae273abec3eaa7731e25934c63eb654d55080caff2ebb7f5df6381f'; // @blurtfoundation/blurtjs config.json
/* TASK-99 (W5.1-מהסוכן-השני, מאומת-חי): שלושת-הצמתים-החיים של בלורט — נתגלו
 * דרך-סריקת-config של blurtwallet.com (saboin=backend-refused · nerdtopia/blurt.world=DNS-dead). */
const BLURT_ENDPOINTS = ['https://rpc.beblurt.com', 'https://rpc.blurt.blog', 'https://rpc.drakernoise.com'];
const STEEM_HIST_NODES = ['https://api.steemit.com', 'https://api.justyy.com', 'https://steem.61bts.com'];

function loadDotEnv(dir) {
  const envPath = path.join(dir, '.env');
  if (!fs.existsSync(envPath)) return {};
  const out = {};
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq <= 0) continue;
    out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

function rpcV4(urlStr, body, timeoutMs = 25000) {
  const u = new URL(urlStr);
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname: u.hostname, path: u.pathname || '/', method: 'POST', family: 4, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }, timeout: timeoutMs },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json.error) return reject(new Error(json.error.message || 'rpc error'));
            resolve(json.result);
          } catch (_) {
            reject(new Error('bad rpc response: ' + data.slice(0, 100)));
          }
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('rpc timeout')));
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Graphene tx build + local sign + raw broadcast (Hive). */
async function grapheneBroadcast(endpoint, chainId, ops, wif) {
  const dgp = await rpcV4(endpoint, { jsonrpc: '2.0', method: 'condenser_api.get_dynamic_global_properties', params: [], id: 1 });
  const tx = {
    ref_block_num: dgp.head_block_number & 0xffff,
    ref_block_prefix: Buffer.from(dgp.head_block_id, 'hex').readUInt32LE(4),
    expiration: new Date(new Date(dgp.time + 'Z').getTime() + 60000).toISOString().slice(0, 19),
    operations: ops,
    extensions: [],
  };
  const prev = steem.config.get('chain_id');
  steem.config.set('chain_id', chainId);
  let signed;
  try {
    signed = steem.auth.signTransaction(tx, [wif]);
  } finally {
    steem.config.set('chain_id', prev);
  }
  await rpcV4(endpoint, { jsonrpc: '2.0', method: 'condenser_api.broadcast_transaction', params: [signed], id: 1 });
  return signed;
}

/* ── TASK-89: בריאות-blurt — קירור-מנוע-דימום ──
 * 3-נקודות-הקצה הציבוריות-היחידות נמדדו-מתות (saboin HTTP-500-back-end-dead,
 * nerdtopia + blurt.world DNS-dead). כישלון-מלא → קירור-30-דק׳ (state קטן בקובץ,
 * כדי-שהדמון-והענן-יסכימו); הצלחה → מחיקת-הקירור. זהירות-להיפך: קירור לעולם
 * לא מבטל-עיגון — steem/hive ממשיכים-ראשונים, blurt רק-מדלג-בשקט-ובכנות. */
const BLURT_HEALTH_PATH = path.join(__dirname, 'blurt_health.json');
const BLURT_COOLDOWN_MS = 30 * 60 * 1000;
function blurtHealth() {
  try { return JSON.parse(fs.readFileSync(BLURT_HEALTH_PATH, 'utf8')); } catch (_) { return {}; }
}
function blurtDeadUntil() {
  const h = blurtHealth();
  return Number(h.deadUntil) || 0;
}
function blurtMarkFail(reason) {
  const until = Date.now() + BLURT_COOLDOWN_MS;
  fs.writeFileSync(BLURT_HEALTH_PATH, JSON.stringify({ deadUntil: until, lastFailAt: new Date().toISOString(), reason: String(reason).slice(0, 120) }, null, 2));
}
function blurtMarkAlive() {
  try { fs.unlinkSync(BLURT_HEALTH_PATH); } catch (_) { /* already absent */ }
}

/**
 * Blurt broadcast — node-serialized, manually signed.
 * Why not steem-js signTransaction: Blurt renumbers operations (custom_json is
 * tag 0x0c there vs 0x12 in steem-js) — the digest diverges byte-level and the
 * node rejects with tx_missing_active_auth. So: ask the node itself for the
 * serialization (get_transaction_hex), strip the trailing sig-count byte,
 * sha256(chain_id ‖ bytes), sign, self-verify by recovery, broadcast.
 */
async function blurtBroadcast(ops, wif, signerPoint, account, expectAt) {
  let lastErr = null;
  for (const endpoint of BLURT_ENDPOINTS) {
    // הצומת משונן — k טרי בכל ניסיון; הצלחה מאומתת בקריאה-בחזרה
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        const dgp = await rpcV4(endpoint, { jsonrpc: '2.0', method: 'condenser_api.get_dynamic_global_properties', params: [], id: 1 });
        const tx = {
          ref_block_num: dgp.head_block_number & 0xffff,
          ref_block_prefix: Buffer.from(dgp.head_block_id, 'hex').readUInt32LE(4),
          expiration: new Date(new Date(dgp.time + 'Z').getTime() + 60000).toISOString().slice(0, 19),
          operations: ops,
          extensions: [],
        };
        const nodeHex = await rpcV4(endpoint, { jsonrpc: '2.0', method: 'condenser_api.get_transaction_hex', params: [tx], id: 1 });
        const nb = Buffer.from(nodeHex, 'hex');
        if (nb[nb.length - 1] !== 0x00 || nb[nb.length - 2] !== 0x00) throw new Error('unexpected node serialization tail');
        const txBytes = nb.subarray(0, nb.length - 1); // strip trailing signatures-vector count (unsigned)
        const digest = crypto.createHash('sha256').update(Buffer.concat([Buffer.from(BLURT_CHAIN_ID, 'hex'), txBytes])).digest();
        const { d } = wifToScalar(wif);
        /* TASK-99 — חוק-canonical של-graphene (blurtjs Signature.signBufferSha256):
         * חוזרים עד שהבייט-העליון של r ושל s שניהם ב-[0x01..0x7F] (32-בייטים-DER מלאים —
         * בלי-padding ובלי-שלילי). חתימות-לא-canonical נדחות על-ידי-is_canonical() בצומת
         * לפני-שחזור-המפתח. */
        let sig = null;
        for (let i = 0; i < 64; i++) {
          const cand = ecdsaSignLowS(digest, d);
          const rb = cand.r.toBuffer(32), sb = cand.s.toBuffer(32);
          if (rb[0] !== 0x00 && rb[0] < 0x80 && sb[0] !== 0x00 && sb[0] < 0x80) { sig = cand; break; }
        }
        if (!sig) throw new Error('blurt canonical signature not found in 64 tries');
        const rec = ecdsaRecover(digest, sig.r, sig.s, sig.recid);
        if (!rec || rec.getEncoded(true).toString('hex') !== signerPoint.getEncoded(true).toString('hex')) {
          throw new Error('blurt self-verify failed — not broadcasting');
        }
        /* TASK-99 — פורמט-החוט (הוכח-חי 2026-09-06 מול-rpc.beblurt.com — tx
         * a48e5a38… נחת + עוגן-זהות 07:27:39 נחת): sig = [header ‖ r ‖ s],
         * header = 31 + recid (blurtjs: i = recid + 4-compressed + 27-compact).
         * הקוד-הישן כתב [r ‖ s ‖ header] — הצומת קרא את בייט-העל של r כ-header
         * וזרק "unable to reconstruct public key from signature" ב-100% מהניסיונות. */
        const hdr = 31 + sig.recid;
        const sigHex = Buffer.concat([Buffer.from([hdr]), sig.r.toBuffer(32), sig.s.toBuffer(32)]).toString('hex');
        console.log('anchor: blurt attempt ' + (attempt + 1) + ' @ ' + endpoint + ' (hdr ' + hdr + ', recid ' + sig.recid + ')');
        const startH = dgp.head_block_number;
        /* 99b — שידור-סינכרוני: הצומת עצמו מדווח trx_id בזמן-הכללה — אימות-ראשוני
         * מהמקור (ה-poller-על-account-history נכשל בעיכובי-אינדקס של דקות והחזיר
         * null-כוזב על tx שנחת). אימות-שני: קריאת-בלוק-אחת (get_ops_in_block). */
        const res = await rpcV4(endpoint, { jsonrpc: '2.0', method: 'condenser_api.broadcast_transaction_synchronous', params: [{ ...tx, signatures: [sigHex] }], id: 1 });
        const syncId = (res && (res.id || res.trx_id)) || null;
        const syncBlk = (res && (res.block_num || res.trx_block_num)) || null;
        if (!syncId) throw new Error('sync-broadcast answered without id (honest)');
        let confirmed = null;
        for (let i = 0; i < 6 && !confirmed; i++) {
          await sleep(2500);
          for (const h of [syncBlk, startH + 1, startH + 2, startH + 3].filter(Boolean)) {
            try {
              const ops = await rpcV4(endpoint, { jsonrpc: '2.0', method: 'condenser_api.get_ops_in_block', params: [h, false], id: 1 });
              for (const rec of (ops || [])) {
                const [t2, v2] = rec.op || [];
                if (t2 !== 'custom_json' || v2.id !== ANCHOR_ID) continue;
                try {
                  const pl = JSON.parse(String(v2.json || '{}'));
                  if (pl.protocol === 'saos/v1' && (pl.at === expectAt || pl.time === expectAt)) { confirmed = rec.trx_id || syncId; break; }
                } catch (_) {}
              }
              if (confirmed) break;
            } catch (_) {}
          }
        }
        return { endpoint, txid: confirmed || syncId, sync: true, syncId, block: syncBlk, confirmedByBlock: !!confirmed };
      } catch (e) {
        lastErr = e;
        console.log('anchor: blurt attempt ' + (attempt + 1) + ' @ ' + endpoint + ' FAILED: ' + ((e && e.message) || e).slice(0, 140));
        await sleep(1200);
      }
    }
  }
  throw lastErr || new Error('no blurt endpoint answered');
}

/** Poll account history for our custom_json id, matched by payload timestamp → trx_id.
 * 99b: רוטציית-צמתים בכל-סבב — חנק-קצב של צומת-יחיד (429/חריגות) היה מחזיר
 * null-כוזב על tx שנחת בפועל (נמדד: anchor 13:45:28 נחת ב-3061 אך דווח invisible). */
async function findInHistory(endpoint, account, expectAt, limit = 40, polls = 14) {
  if (!account) return null;
  const eps = [endpoint, ...BLURT_ENDPOINTS.filter((e) => e !== endpoint)];
  for (let i = 0; i < polls; i++) {
    await sleep(3000);
    const ep = eps[i % eps.length];
    try {
      const hist = await rpcV4(ep, { jsonrpc: '2.0', method: 'condenser_api.get_account_history', params: [account, -1, limit], id: 1 });
      for (const [, e] of hist) {
        const [type, v] = e.op;
        if (type !== 'custom_json' || v.id !== ANCHOR_ID) continue;
        try {
          const pl = JSON.parse(String(v.json || '{}'));
          /* 99b-fix: התאמה על-פרוטוקול-סאוס + טביעת-זמן — לא-רק-anchor-id.
           * ה-weave משדר action='seal' עם שדה `time` (לא `at`) — ההתאמה-הישנה
           * החזירה null לכל-seal ("broadcast-ok-but-invisible" — שקר-שלילי
           * שדמם-קול-דאונים-כוזבים על שרשרת-חיה-ומוכחת). */
          if (pl.protocol === 'saos/v1' && (pl.at === expectAt || pl.time === expectAt)) return e.trx_id || null;
        } catch (_) { /* skip */ }
      }
    } catch (_) { /* retry — צומת-אחר בסבב-הבא */ }
  }
  return null;
}

/**
 * עוגן אחד מלא: הודעה → חתימה EVM → אימות-עצמי → שידור על 3 שרשראות → txids.
 * dry=true — בונה ומאמת הכל מקומית, בלי שידור.
 */
async function runAnchor(opts = {}) {
  const dry = !!opts.dry;
  const quiet = !!opts.quiet;
  const ENV = loadDotEnv(__dirname);
  const ACCOUNT = (ENV.AGENT_ACCOUNT || 'headcorner').toLowerCase();
  const WIF = ENV.ACTIVE_WIF || '';
  if (!WIF) throw new Error('ACTIVE_WIF missing — active-signed anchor requires it');

  const log = (m) => { if (!quiet) console.log(m); };

  // 1) הודעה נייטרלית + nonce
  const nonce = crypto.randomBytes(8).toString('hex');
  const at = new Date().toISOString();
  const msg = `saos-id-anchor v1 | ${at} | ${nonce}`;

  // 2) חתימה EIP-191 עם הסקלר של המפתח הפעיל (low-s, Ethereum-compatible)
  const { d } = wifToScalar(WIF);
  const id = deriveIdentities(WIF);
  const h = eip191Hash(msg);
  const sig = ecdsaSignLowS(h, d);
  const sigHex = sigToEvmHex(sig);

  // 3) אימות-עצמי לפני שידור: שחזור == נקודת החותם · כתובת == הנגזרת
  const signerPoint = require('ecurve').getCurveByName('secp256k1').G.multiply(d);
  const recPoint = ecdsaRecover(h, sig.r, sig.s, sig.recid);
  if (!recPoint || recPoint.getEncoded(true).toString('hex') !== signerPoint.getEncoded(true).toString('hex')) {
    throw new Error('self-verify FAILED: recovered point != signer point — not broadcasting');
  }
  const evmFromSig = toChecksumAddress(keccak256(recPoint.getEncoded(false).subarray(1)).slice(-40));
  if (evmFromSig !== id.evmAddress) {
    throw new Error('self-verify FAILED: evm address mismatch — not broadcasting');
  }
  log(`anchor: self-verify OK · evm=${id.evmAddress} · sig=${sigHex.slice(0, 18)}… · msg="${msg}"`);

  const payload = {
    protocol: 'saos/v1',
    action: 'anchor-id',
    at,
    msg,
    evm: id.evmAddress,
    sig: sigHex,
    chains: ['steem', 'hive', 'blurt'],
  };
  // fresh op per chain — steem-js signTransaction mutates the tx/op objects in place
  const buildOp = () => ['custom_json', {
    required_auths: [ACCOUNT],
    required_posting_auths: [],
    id: ANCHOR_ID,
    json: JSON.stringify(payload),
  }];
  const op = buildOp();

  if (dry) {
    log('anchor: DRY — would broadcast 1 custom_json (active authority) on steem+hive+blurt');
    return { at, msg, evm: id.evmAddress, sig: sigHex, txids: {}, dry: true };
  }

  // 4) שידור על שלוש שרשראות
  const txids = {};

  // 4a. Steem — steem-js native (active WIF)
  try {
    const conf = await steem.broadcast.sendAsync({ operations: [op], extensions: [] }, [WIF]);
    txids.steem = (conf && conf.id) || (await findInHistory(STEEM_HIST_NODES[0], ACCOUNT, at));
  } catch (e) {
    log('anchor: steem broadcast FAILED: ' + ((e && e.message) || e));
  }

  // 4b. Hive — raw Graphene sign with chain_id · 103: מאחורי-שער-התקציב
  try {
    let rcSnap = null;
    try { rcSnap = await HIVE_RC.snapshot([ACCOUNT]); } catch (_) { rcSnap = null; }
    if (rcSnap) {
      const g = HIVE_RC.gate(rcSnap, ACCOUNT, 250e6, 'anchor-id-hive');
      if (!g.ok) throw new Error('rc-gated: ' + g.reason + ' (regen budget — honest skip)');
    }
    await grapheneBroadcast(HIVE_RPC, HIVE_CHAIN_ID, [buildOp()], WIF);
    txids.hive = await findInHistory(HIVE_RPC, ACCOUNT, at);
  } catch (e) {
    log('anchor: hive broadcast FAILED: ' + ((e && e.message) || e));
  }

  // 4c. Blurt — node-serialized broadcast (Blurt renumbers ops; see blurtBroadcast)
  // TASK-89 דימום-נקה: 3-נקודות-הקצה-מתות-מדוד (saboin-500 · nerdtopia/blurt.world-DNS) —
  // cool-down-30-דק׳ אחרי-כישלון-מלא: אפס-ניסיונות-מתים-עד-הריצה-הבאה, הערה-כנה.
  try {
    if (blurtDeadUntil() > Date.now()) {
      throw new Error('blurt cooled-down until ' + new Date(blurtDeadUntil()).toISOString() + ' (endpoints measured dead — fix-89 anti-bleed)');
    }
    const r = await blurtBroadcast([buildOp()], WIF, signerPoint, ACCOUNT, at);
    txids.blurt = r.txid;
    if (r.txid) { log('anchor: blurt accepted via ' + r.endpoint); blurtMarkAlive(); }
    else blurtMarkFail('broadcast-ok-but-invisible');
  } catch (e) {
    blurtMarkFail((e && e.message) || e);
    log('anchor: blurt broadcast FAILED: ' + ((e && e.message) || e));
  }

  const okChains = Object.values(txids).filter(Boolean).length;
  log(`anchor: broadcast done — ${okChains}/3 chains confirmed${txids.steem ? ' · steem txid ' + txids.steem : ''}${txids.hive ? ' · hive txid ' + txids.hive : ''}${txids.blurt ? ' · blurt txid ' + txids.blurt : ''}`);

  // 5) רישום-תוצאה ציבורי (בלי סודות — החתימה פומבית מטבעה)
  let prevTotal = 0;
  try {
    const prev = JSON.parse(fs.readFileSync(path.join(__dirname, 'anchor_last.json'), 'utf8'));
    prevTotal = Number(prev.anchorsTotal) || 0;
  } catch (_) { /* first run */ }
  const result = {
    at,
    account: ACCOUNT,
    msg,
    evm: id.evmAddress,
    sig: sigHex,
    txids,
    anchorsTotal: prevTotal + 1,
    verifier:
      'ecrecover(keccak256("\\x19Ethereum Signed Message:\\n" + len + msg), sig) == active key_auths point of @' +
      ACCOUNT + ' on Steem/Hive/Blurt (get_accounts → active.key_auths[0][0], strip prefix+checksum)',
  };
  try {
    fs.writeFileSync(path.join(__dirname, 'anchor_last.json'), JSON.stringify(result, null, 2) + '\n');
  } catch (_) { /* non-fatal */ }
  return result;
}

module.exports = {
  runAnchor, ANCHOR_ID, rpcV4, grapheneBroadcast, findInHistory, STEEM_HIST_NODES,
  // W2 — WEAVE: שימוש-חוזר בכלי-הבלורט (cool-down מדוד) + קבועי-Hive עבור weave_batch.cjs
  blurtBroadcast, blurtDeadUntil, blurtMarkAlive, blurtMarkFail, HIVE_RPC, HIVE_CHAIN_ID,
  // TASK-99 — חשיפת-הצמתים-החיים ל-blurt99.cjs
  BLURT_ENDPOINTS,
};

if (require.main === module) {
  const { resolveLiveGate, announceGate } = require('./lib/live_gate.cjs');
  const GATE = resolveLiveGate(process.argv);
  announceGate(GATE);
  runAnchor({ dry: GATE.dry })
    .then((r) => {
      console.log(JSON.stringify({ at: r.at, evm: r.evm, txids: r.txids, dry: !!r.dry }, null, 2));
      process.exit(0);
    })
    .catch((e) => {
      console.error('anchor fatal:', e.message);
      process.exit(1);
    });
}
