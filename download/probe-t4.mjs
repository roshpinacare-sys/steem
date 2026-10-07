/* T-91 CHAIN TRUTH probe: transfer_to_vesting op-id + byte order.
 * Method (same as R209/R216): build an UNSIGNED probe tx with serializeTx,
 * ask the node to serialize the same tx via condenser_api.get_transaction_hex,
 * compare byte-for-byte. A match proves op-id AND field order. Zero signing,
 * zero broadcast. */
import { serializeTx } from "/home/z/my-project/mini-services/saos-engine/steemtx.mjs";

const expSec = Math.floor(Date.now() / 1000) + 30;
const expIso = new Date(expSec * 1000).toISOString().replace(/\.\d{3}Z$/, "");

const tx = {
  ref_block_num: 1,
  ref_block_prefix: 1111,
  expiration: expIso, // JSON form (binary form is the epoch i32, same second)
  operations: [["transfer_to_vesting", { from: "headcorner", to: "headcorner", amount: "1.000 STEEM" }]],
  extensions: [],
};

const mine = serializeTx({ ...tx, expiration: expSec }).toString("hex");
console.log("serializeTx hex:", mine);

const res = await fetch("https://api.steemit.com", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    jsonrpc: "2.0", method: "condenser_api.get_transaction_hex",
    params: [{ ...tx, signatures: [] }], id: 1,
  }),
});
const j = await res.json();
if (j.error) { console.error("NODE-ERROR:", JSON.stringify(j.error).slice(0, 300)); process.exit(2); }
const theirs = j.result;
console.log("node hex:", theirs);
/* serializeTx ends at the extensions varint; the node also serializes the
 * (empty) signatures vector — one extra 00 byte. Compare mine+00. */
if (theirs === mine + "00") {
  console.log("MATCH — transfer_to_vesting=3 + field order chain-verified");
} else {
  let i = 0;
  while (i < Math.min(theirs.length, mine.length) && theirs[i] === mine[i]) i++;
  console.error(`MISMATCH at byte ${i}: node=${theirs.slice(i, i + 8)} mine=${mine.slice(i, i + 8)}`);
  process.exit(3);
}
