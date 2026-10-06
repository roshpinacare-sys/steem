// ═════════════════════════════════════════════════════════════════════
// THE BLURT WIRE LAW — מעבדה אמפירית (R103)
//
// אותה שיטת-המדע מ-R99 (חוק-החוט של HIVE): לא מנחשים את צורת
// הסדרה של נכסי BLURT על החוט — מודדים אותה מול חתימות אמיתיות
// שהשרשרת עצמה קיבלה.
//
// שיטה:
//   1. שליפת טרנזקציית transfer אמיתית מהשרשרת (get_transaction)
//   2. חישוב digest = sha256(chain_id + toBuffer(tx)) בשתי צורות:
//      (א) "N.NNN BLURT" המילולי   (ב) מיפוי מורשת BLURT→STEEM
//   3. שחזור המפתח הציבורי מהחתימה האמיתית לכל צורה
//   4. הצורה שמשחזרת את המפתח הציבורי של השולח = החוק
//
// אפס כסף בסיכון — קריאה בלבד מהשרשרת הציבורית.
// ═════════════════════════════════════════════════════════════════════
const steem = require("steem");
const crypto = require("node:crypto");

const RPC = "https://rpc.blurt.blog";
const CHAIN_ID = "cd8d90f29ae273abec3eaa7731e25934c63eb654d55080caff2ebb7f5df6381f";
const UA = { "Content-Type": "application/json", "User-Agent": "saos-weave-lab/1.0" };

async function rpc(method, params) {
  const r = await fetch(RPC, {
    method: "POST",
    headers: UA,
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(15000),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message);
  return j.result;
}

// מיפוי מורשת: "N.NNN BLURT" → "N.NNN STEEM" (הצורה של HIVE)
function toLegacyForm(v) {
  if (typeof v === "string") {
    return v.replace(/^(\d+(?:\.\d+)?) BLURT$/, "$1 STEEM");
  }
  if (Array.isArray(v)) return v.map(toLegacyForm);
  if (v && typeof v === "object") {
    const out = {};
    for (const [k, x] of Object.entries(v)) out[k] = toLegacyForm(x);
    return out;
  }
  return v;
}

(async () => {
  // 1. מציאת transfer אמיתי מההיסטוריה של חשבון פעיל
  const account = process.argv[2] || "headcorner";
  const hist = await rpc("condenser_api.get_account_history", [account, -1, 500]);
  const transferEvts = (hist || []).filter(([, e]) => e.op && e.op[0] === "transfer");
  console.log(`transfers found in ${account} history: ${transferEvts.length}`);
  if (transferEvts.length === 0) {
    console.log("NO SAMPLE — try another account");
    process.exit(1);
  }
  // הכי חדש קודם
  const [_, evt] = transferEvts[transferEvts.length - 1];
  const trxId = evt.trx_id;
  const from = evt.op[1].from;
  const amount = evt.op[1].amount;
  console.log(`sample: ${trxId} · ${from} → ${evt.op[1].to} · ${amount}`);

  // 2. הטרנזקציה המלאה החתומה
  const trx = await rpc("condenser_api.get_transaction", [trxId]);
  const { signatures, operations, ref_block_num, ref_block_prefix, expiration } = trx;
  console.log(`tx: ref=${ref_block_num}/${ref_block_prefix} exp=${expiration} sigs=${signatures.length}`);
  console.log("ops:", JSON.stringify(operations.map((o) => o[0])));

  // 3. הרשות הציבורית של השולח (active)
  const fromAcct = (await rpc("condenser_api.get_accounts", [[from]]))[0];
  const activePub = fromAcct.active.key_auths[0][0];
  console.log(`sender active: ${activePub}`);

  // 4. בדיקת שתי הצורות
  const transaction = require("steem/lib/auth/serializer/src/operations").transaction;
  const Signature = require("steem/lib/auth/ecc/src/signature");
  const strip = (p) => p.replace(/^(STM|BLT)/, "");

  const baseTx = {
    ref_block_num,
    ref_block_prefix,
    expiration,
    operations,
    extensions: [],
  };

  for (const [name, ops] of [
    ["literal BLURT", operations],
    ["legacy STEEM", toLegacyForm(operations)],
  ]) {
    try {
      const txForm = { ...baseTx, operations: JSON.parse(JSON.stringify(ops)) };
      const buf = transaction.toBuffer(txForm);
      const digest = crypto
        .createHash("sha256")
        .update(Buffer.concat([Buffer.from(CHAIN_ID, "hex"), buf]))
        .digest();
      let recovered = "?";
      try {
        const sig = Signature.fromBuffer(Buffer.from(signatures[0], "hex"));
        recovered = sig.recoverPublicKey(digest).toString();
      } catch (e) {
        recovered = "ERR:" + String(e.message).slice(0, 60);
      }
      const match = typeof recovered === "string" && strip(recovered) === strip(activePub);
      console.log(`[${name}] recovered=${String(recovered).slice(0, 60)} MATCH=${match}`);
    } catch (e) {
      console.log(`[${name}] serialize-error: ${String(e.message).slice(0, 120)}`);
    }
  }
})().catch((e) => {
  console.error("LAB-FAIL:", e.message);
  process.exit(1);
});
