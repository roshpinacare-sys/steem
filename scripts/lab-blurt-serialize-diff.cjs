// r184 lab — מעבדת-סריאליזציה של Blurt: איפה הבייטים נפרדים?
// שאלה אחת: steem-js (הקו הנוכחי) מול blurtjs (הסכמה הרשמית של השרשרת)
// על אותו op custom_json — איזה בייט ראשון שונה ומה משמעותו.
// אפס מפתחות, אפס שידור — בייטים בלבד.
const { createRequire } = require("module");
const req = createRequire("/home/z/my-project/package.json");

const steemSer = req("steem/lib/auth/serializer");
const blurtSer = req("@blurtfoundation/blurtjs/lib/auth/serializer");

const op = [
  "custom_json",
  {
    required_auths: ["headcorner"],
    required_posting_auths: [],
    id: "saos.weave.core.v1",
    json: JSON.stringify({
      t: "weave-anchor",
      v: 1,
      cp: 1245,
      at: "2026-10-03T19:40:00.000Z",
      root: "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
    }),
  },
];

const fixedTx = (ops) => ({
  ref_block_num: 12345,
  ref_block_prefix: 305419896,
  expiration: "2026-10-03T20:00:00",
  operations: ops,
  extensions: [],
});

function toBuf(ser, tx, label) {
  try {
    const Transaction = ser.ops.transaction;
    const b = Transaction.toBuffer(Object.assign({}, tx));
    console.log(`${label}: len=${b.length}`);
    console.log(`${label}: hex=${b.toString("hex")}`);
    return b;
  } catch (e) {
    console.log(`${label}: FAILED — ${String(e && e.message ? e.message : e).slice(0, 200)}`);
    return null;
  }
}

const tx = fixedTx([op]);
const a = toBuf(steemSer, tx, "steem-js");
const b = toBuf(blurtSer, tx, "blurtjs  ");

if (a && b) {
  if (a.equals(b)) {
    console.log("RESULT: IDENTICAL — הסריאליזציה זהה; הפער אינו ב-op");
  } else {
    const n = Math.min(a.length, b.length);
    let first = -1;
    for (let i = 0; i < n; i++) if (a[i] !== b[i]) { first = i; break; }
    if (first === -1) first = n;
    console.log(`RESULT: DIFFER at byte ${first} (of ${a.length}/${b.length})`);
    console.log(`  steem-js[${Math.max(0, first - 8)}..${first + 8}]: ${a.slice(Math.max(0, first - 8), first + 8).toString("hex")}`);
    console.log(`  blurtjs  [${Math.max(0, first - 8)}..${first + 8}]: ${b.slice(Math.max(0, first - 8), first + 8).toString("hex")}`);
    // מיפוי מספרי-op בשתי הספריות — כאן חי החשוד
    for (const lib of [["steem-js", steemSer], ["blurtjs", blurtSer]]) {
      try {
        const ops = lib[1].operations || lib[1].default && lib[1].default.operations;
        if (ops) {
          const names = Object.keys(ops).filter((k) => typeof ops[k] === "function" || typeof ops[k] === "object");
          const cj = names.indexOf("custom_json");
          const tr = names.indexOf("transfer");
          console.log(`  ${lib[0]}: ops=${names.length} transfer@${tr} custom_json@${cj}`);
        } else {
          console.log(`  ${lib[0]}: (no operations map exported)`);
        }
      } catch (e) {
        console.log(`  ${lib[0]}: ops-map error ${String(e).slice(0, 80)}`);
      }
    }
  }
}
