#!/usr/bin/env node
/**
 * xwallet.cjs — Task 62: מפעל-ארנקות חוצה-פרדיגמות + ממסר-ללא-גז.
 *
 * המערכת יוצרת זהויות קריפטוגרפיות אמיתיות בשתי פרדיגמות זרות:
 *   • EVM (secp256k1 + keccak256 — אותו-עולם כמו Ethereum/BSC/Base/Arbitrum/…)
 *   • Solana (ed25519 — עולם SVM שלם, בלי שום תלות במפתחות ה-Graphene)
 *
 * הדגמות ריבוניות:
 *   --create       : לידת ארנקות (EVM ×2 + Solana ×2) — 0600, מחוץ ל-git
 *   --evm-intent   : ממסר-כוונות ללא-גז — ארנק-לקוח (אפס גז) חותם כוונה,
 *                    ארנק-הממסר שלנו מאמת ecrecover==לקוח ומחייב דלי-גז
 *   --solana-feed  : הדגל — עסקה חיה על Solana-devnet שבה הלקוח (אפס SOL)
 *                    חותם ממו, וארנק-האוצר שלנו הוא fee-payer — הגז שלנו,
 *                    העסקה של הלקוח. ההישג שהמפעיל ביקש מילולית.
 *
 * סודות: לעולם לא בלוג, לעולם לא בקונסולה, לעולם לא ב-git (keys/ נדחה).
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const ecurve = require('ecurve');
const BigInteger = require('bigi');
const { keccak256 } = require('js-sha3');
const nacl = require('tweetnacl');
const { toChecksumAddress, eip191Hash, ecdsaSignLowS, ecdsaRecover, sigToEvmHex } = require('./identity.cjs');

const XWALLETS_PATH = path.join(__dirname, 'keys', 'xwallets.json');
const GAS_TANK_PATH = path.join(__dirname, 'gas_tank.json');
const XFEED_PATH = path.join(__dirname, 'xfeed_last.json');
const MEMO_PROGRAM = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'; // SPL Memo v2
const DEVNET_RPC = 'https://api.devnet.solana.com';
const LAMPORT_FEE = 5000; // devnet signature fee

/* ---------------- base58 (Solana addresses) ---------------- */
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function b58Encode(buf) {
  let n = BigInt('0x' + buf.toString('hex'));
  let out = '';
  while (n > 0n) { out = B58[Number(n % 58n)] + out; n /= 58n; }
  for (const b of buf) { if (b === 0) out = B58[0] + out; else break; }
  return out;
}
function b58Decode(str) {
  let n = 0n;
  for (const c of str) { const i = B58.indexOf(c); if (i < 0) throw new Error('bad b58 char'); n = n * 58n + BigInt(i); }
  let hex = n.toString(16);
  if (hex.length % 2) hex = '0' + hex;
  let buf = Buffer.from(hex, 'hex');
  let pad = 0;
  for (const c of str) { if (c === B58[0]) pad++; else break; }
  return Buffer.concat([Buffer.alloc(pad), buf]);
}

/* ---------------- EVM identity from raw scalar ---------------- */
function scalarToEvmAddress(scalarBig) {
  const curve = ecurve.getCurveByName('secp256k1');
  const Q = curve.G.multiply(scalarBig);
  const enc = Q.getEncoded(false);
  return toChecksumAddress(keccak256(enc.subarray(1)).slice(-40));
}

/* ---------------- vault of foreign wallets ---------------- */
function loadXWallets() {
  try { return JSON.parse(fs.readFileSync(XWALLETS_PATH, 'utf8')); } catch (_) { return null; }
}
function saveXWallets(w) {
  fs.mkdirSync(path.dirname(XWALLETS_PATH), { recursive: true });
  fs.writeFileSync(XWALLETS_PATH, JSON.stringify(w, null, 2), { mode: 0o600 });
  fs.chmodSync(XWALLETS_PATH, 0o600);
}

function createWallets() {
  const w = loadXWallets() || { createdAt: new Date().toISOString(), evm: [], solana: [] };
  const born = { evm: 0, solana: 0 };
  while (w.evm.length < 2) {
    const d = BigInteger.fromBuffer(crypto.randomBytes(32)); // scalar — never leaves
    const wifBuf = Buffer.concat([Buffer.from([0x80]), d.toBuffer(32), Buffer.from([0x01])]); // mainnet-compressed WIF for interop with identity.cjs
    const sha = crypto.createHash('sha256').update(wifBuf).digest();
    const chk = crypto.createHash('sha256').update(sha).digest().subarray(0, 4);
    w.evm.push({ label: 'evm-' + w.evm.length, wif: b58Encode(Buffer.concat([wifBuf, chk])), address: scalarToEvmAddress(d), bornAt: new Date().toISOString() });
    born.evm++;
  }
  while (w.solana.length < 2) {
    const kp = nacl.sign.keyPair();
    w.solana.push({ label: 'sol-' + w.solana.length, secret: Buffer.from(kp.secretKey).toString('hex'), address: b58Encode(Buffer.from(kp.publicKey)), bornAt: new Date().toISOString() });
    born.solana++;
  }
  saveXWallets(w);
  return { born, evm: w.evm.map((x) => x.address), solana: w.solana.map((x) => x.address) };
}

/* ---------------- generic JSON-RPC POST ---------------- */
function rpc(urlStr, method, params, timeoutMs = 30000) {
  const u = new URL(urlStr);
  const payload = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: params || [] });
  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname: u.hostname, path: u.pathname + (u.search || ''), method: 'POST', family: 4, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }, timeout: timeoutMs },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json.error) return reject(new Error(typeof json.error === 'string' ? json.error : JSON.stringify(json.error).slice(0, 160)));
            resolve(json.result);
          } catch (_) { reject(new Error('bad rpc: ' + data.slice(0, 90))); }
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('rpc timeout')));
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/* ---------------- gas-tank ledger (sponsorship accounting) ---------------- */
function gasTank() {
  try { return JSON.parse(fs.readFileSync(GAS_TANK_PATH, 'utf8')); } catch (_) {
    return { policy: 'intent-fee-routing', currency: 'SAOS', credits: 100, debits: [], updatedAt: new Date().toISOString() };
  }
}
function gasDebit(entry) {
  const t = gasTank();
  t.debits.push(entry);
  if (t.debits.length > 500) t.debits.shift();
  t.updatedAt = new Date().toISOString();
  fs.writeFileSync(GAS_TANK_PATH, JSON.stringify(t, null, 2) + '\n');
  return t;
}

/* ---------------- --evm-intent : gasless intent relay ---------------- */
async function evmIntent() {
  const w = loadXWallets();
  if (!w || w.evm.length < 2) throw new Error('run --create first');
  const relayer = w.evm[0], client = w.evm[1];
  const intent = { kind: 'saos-x-intent/v1', chain: 'ethereum', action: 'route-fee-to-pool', pool: 'SAOS:STEEM', nonce: crypto.randomBytes(8).toString('hex'), ts: new Date().toISOString() };
  const msg = JSON.stringify(intent);
  const { d } = require('./identity.cjs').wifToScalar(client.wif);
  const h = eip191Hash(msg); // 32-byte hash as hex string
  const sig = ecdsaSignLowS(BigInteger.fromBuffer(Buffer.from(h.slice(-64), 'hex')), d);
  const sigHex = sigToEvmHex(sig);
  // relayer-side verification — pure math, zero gas:
  const rec = ecdsaRecover(BigInteger.fromBuffer(Buffer.from(h.slice(-64), 'hex')), sig.r, sig.s, sig.recid);
  const enc = rec.getEncoded(false);
  const recovered = toChecksumAddress(keccak256(enc.subarray(1)).slice(-40));
  const ok = recovered.toLowerCase() === client.address.toLowerCase();
  const debit = gasDebit({ at: intent.ts, client: client.address, chain: intent.chain, action: intent.action, gasUnits: 21000, pricedIn: 'SAOS', verified: ok });
  const out = { at: intent.ts, intent, sigLen: sigHex.length, recovered, clientAddress: client.address, match: ok, gasTank: { credits: debit.credits, debits: debit.debits.length } };
  fs.writeFileSync(XFEED_PATH, JSON.stringify({ lastMode: 'evm-intent', ...out }, null, 2) + '\n');
  console.log(JSON.stringify(out, null, 2));
  return out;
}

/* ---------------- --solana-feed : fee-payer flagship on devnet ---------------- */
async function solanaFeed() {
  const w = loadXWallets();
  if (!w || w.solana.length < 2) throw new Error('run --create first');
  const relayer = w.solana[0], client = w.solana[1];
  const relayerKp = nacl.sign.keyPair.fromSecretKey(Buffer.from(relayer.secret, 'hex'));
  const clientKp = nacl.sign.keyPair.fromSecretKey(Buffer.from(client.secret, 'hex'));
  if (b58Encode(Buffer.from(relayerKp.publicKey)) !== relayer.address) throw new Error('relayer key mismatch');

  const balOf = async (addr) => {
    const r = await rpc(DEVNET_RPC, 'getBalance', [addr]);
    return typeof r === 'number' ? r : Number(r && r.value);
  };
  const balBeforeRelayer = await balOf(relayer.address);
  const balBeforeClient = await balOf(client.address);

  // 1) אלמנט הגז: איירדרופ דוונט אל ארנק-האוצר (רכישת-גז עצמאית, אפס-הון)
  let airdropNote = 'skipped (already funded)';
  if (balBeforeRelayer < LAMPORT_FEE * 2) {
    airdropNote = 'airdrop failed';
    for (let attempt = 1; attempt <= 3 && balBeforeRelayer < LAMPORT_FEE * 2; attempt++) {
      try {
        await rpc(DEVNET_RPC, 'requestAirdrop', [relayer.address, 100000000], 60000); // 0.1 SOL
        airdropNote = 'airdropped 0.1 SOL (attempt ' + attempt + ')';
        for (let i = 0; i < 12 && balBeforeRelayer < LAMPORT_FEE * 2; i++) {
          await sleep(3000);
          balBeforeRelayer = await balOf(relayer.address);
        }
      } catch (e) {
        airdropNote = 'airdrop attempt ' + attempt + ': ' + String((e && e.message) || e).slice(0, 60);
        await sleep(5000);
      }
    }
  }
  const balAfterAirdrop = balBeforeRelayer;
  if (balAfterAirdrop < LAMPORT_FEE * 2) throw new Error('no gas on relayer (' + airdropNote + ')');

  // 2) בניית-עסקה: הלקוח חותם ממו (אפס SOL), האוצר fee-payer
  const { value: bh } = await rpc(DEVNET_RPC, 'getLatestBlockhash', [{ commitment: 'confirmed' }]);
  const memoMsg = JSON.stringify({ saos: 'x-fee-relay/v1', from: client.address.slice(0, 12) + '…', note: 'gas paid by SAOS', ts: new Date().toISOString().slice(0, 19) });
  const memoBytes = Buffer.from(memoMsg, 'utf8');
  const cu16 = (n) => { // compact-u16 (Solana shortvec)
    if (n < 128) return Buffer.from([n]);
    const out = [];
    while (n >= 128) { out.push((n & 0x7f) | 0x80); n >>>= 7; }
    out.push(n);
    return Buffer.from(out);
  };

  const keyCount = 3; // [relayer(fee-payer, writable signer, FIRST=fee payer), client(signer, readonly), memoProgram(ro)]
  const msgBuf = Buffer.concat([
    Buffer.from([2, 1, 1]),                       // header: 2 required sigs, 1 readonly-signed(=client), 1 readonly-unsigned(program)
    cu16(keyCount),
    b58Decode(relayer.address), b58Decode(client.address), b58Decode(MEMO_PROGRAM),
    b58Decode(bh.blockhash),                      // recent blockhash (RPC returns base58!)
    cu16(1),                                      // 1 instruction
    Buffer.from([2]),                             // program id INDEX = 2 (memoProgram)
    cu16(1), Buffer.from([1]),                    // accounts: count=1, idx 1 (client, signer)
    cu16(memoBytes.length), memoBytes,
  ]);
  const sigClient = nacl.sign.detached(msgBuf, clientKp.secretKey); // 64B: seed+pub
  const sigRelayer = nacl.sign.detached(msgBuf, relayerKp.secretKey);
  const tx = Buffer.concat([cu16(2), sigRelayer, sigClient, msgBuf]); // sig order MUST match signer order [relayer, client]
  const txB64 = tx.toString('base64');

  const sig = await rpc(DEVNET_RPC, 'sendTransaction', [txB64, { encoding: 'base64', skipPreflight: false, preflightCommitment: 'confirmed' }], 60000);

  // 3) אישור + מדידת-דלק
  let status = null;
  for (let i = 0; i < 20 && !status; i++) {
    await sleep(2500);
    const st = await rpc(DEVNET_RPC, 'getSignatureStatuses', [[sig], { searchTransactionHistory: false }]);
    if (st && st.value && st.value[0] && st.value[0].confirmationStatus) status = st.value[0];
  }
  const balAfterRelayer = await balOf(relayer.address);
  const balAfterClient = await balOf(client.address);
  const feeLamports = balBeforeRelayer >= 0 && balAfterRelayer >= 0 ? (balBeforeRelayer - balAfterRelayer) : null;
  const out = {
    at: new Date().toISOString(), network: 'solana-devnet', signature: sig,
    confirmed: !!(status && status.err === null),
    slot: status ? status.slot : null,
    feePayer: relayer.address, clientAddress: client.address,
    clientPaidLamports: balBeforeClient - balAfterClient, // חייב להיות 0 — הלקוח באפס
    relayerGasLamports: feeLamports,
    gasSource: airdropNote,
    memo: memoMsg.slice(0, 90),
    blockhashValidUntil: bh.lastValidBlockHeight,
    explorer: 'https://explorer.solana.com/tx/' + sig + '?cluster=devnet',
  };
  fs.writeFileSync(XFEED_PATH, JSON.stringify({ lastMode: 'solana-feed', ...out }, null, 2) + '\n');
  console.log(JSON.stringify(out, null, 2));
  return out;
}

async function main() {
  const mode = process.argv[2] || '--create';
  if (mode === '--create') return createWallets();
  if (mode === '--evm-intent') return evmIntent();
  if (mode === '--solana-feed') return solanaFeed();
  throw new Error('unknown mode ' + mode);
}

module.exports = { createWallets, evmIntent, solanaFeed, loadXWallets, gasTank };
if (require.main === module) {
  main().then((r) => { if (!process.argv.includes('--quiet')) console.log(JSON.stringify(r, null, 2).slice(0, 1200)); process.exit(0); })
    .catch((e) => { console.error('xwallet fatal:', e.message); process.exit(1); });
}
