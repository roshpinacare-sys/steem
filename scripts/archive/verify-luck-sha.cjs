// אימות ביט-מול-ביט של ה-sha256 המוטמע במשחקי המזל מול node:crypto (חוק R55)
const fs = require("node:fs");
const crypto = require("node:crypto");

const html = fs.readFileSync("/home/z/my-project/sovereign/web/src-luck/dice.html", "utf8");
const fnMatch = html.match(/var K=\[[\s\S]*?\];\s*function rr\(x,n\)\{[\s\S]*?\}\s*function sha256\(msg\)\{[\s\S]*?return out;\s*\}/);
if (!fnMatch) {
  console.error("EXTRACT-FAIL: לא נמצא בלוק ה-sha256 בקובץ");
  process.exit(1);
}
const sha256Embedded = new Function(fnMatch[0] + "\nreturn sha256;")();

const cases = [
  "",
  "a",
  "hello world",
  "0123456789abcdef0123456789abcdef:1:dice",
  "seed0123:7:coinflip",
  "דג בלול צולל שש גדול — עברית UTF-8",
  "x".repeat(55),
  "y".repeat(63),
  "z".repeat(64),
  "w".repeat(65),
  "q".repeat(120),
];
let pass = 0;
for (const c of cases) {
  const mine = crypto.createHash("sha256").update(c, "utf8").digest("hex");
  const theirs = sha256Embedded(c);
  const ok = mine === theirs;
  console.log(`${ok ? "OK" : "FAIL"} ${JSON.stringify(c.slice(0, 40))} → ${theirs.slice(0, 16)}…`);
  if (!ok) {
    console.error(`   MISMATCH: node=${mine} embedded=${theirs}`);
    process.exit(1);
  }
  pass++;
}
console.log(`\nBIT-VERIFIED: ${pass}/${pass} — ה-sha256 המוטמע זהה ל-node:crypto (כולל גבולות בלוק 55/63/64/65)`);
