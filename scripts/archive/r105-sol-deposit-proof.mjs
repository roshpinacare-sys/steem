// R105 — הוכחת דלת-ההפקדה של SOL בשלוש פעימות:
//   1) שידור SOL אמיתי מ-headcorner לאוצר (cashmachine) עם הוראת
//      spl-memo "wx:operator" — דרך ה-API החי (נתיב ייצורי, node runtime).
//   2) המתנה להיכללות (finalized).
//   3) הפעלת סריקת ההפקדות החיה (/api/exchange deposit-scan) —
//      הסורק קורא את החתימה מהשרשרת, מוצא את המזכר, מזקף WSOL.
// המשיכה תבוצע מהדפדפן (הנתיב הייצורי) — ראה דוח R105.
const API = "http://127.0.0.1:3000";
const TREASURY = "HBBdhpbpFP3BwqcvrxJ44hAyKSid3D6AB4SFvtrN736s";
const MEMO = "wx:operator";
const AMOUNT = 0.00009; // חוק-שכירות: השולח חייב להישאר מעל מינימום rent-exempt (890,880 lamports)

console.log(`[r105] שלב 1 — שידור ${AMOUNT} SOL (מעל חוק-השכירות) headcorner → אוצר עם מזכר "${MEMO}" (דרך /api/money/sol):`);
const sendRes = await fetch(`${API}/api/money/sol`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ action: "send", account: "headcorner", to: TREASURY, sol: AMOUNT, memo: MEMO }),
  signal: AbortSignal.timeout(60_000),
});
const send = await sendRes.json();
console.log(`  ok=${send.ok} txid=${send.txid ?? "—"} · ${send.detail ?? send.error ?? ""}`);
if (!send.ok || !send.txid) {
  console.log("FAIL: השידור לא התקבל — עוצרים בכנות");
  process.exit(1);
}

console.log("[r105] שלב 2 — המתנה להיכללות (finalized)…");
await new Promise((r) => setTimeout(r, 20_000));

console.log("[r105] שלב 3 — הפעלת סריקת ההפקדות החיה (5 רשתות):");
const res = await fetch(`${API}/api/exchange`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ action: "deposit-scan" }),
  signal: AbortSignal.timeout(60_000),
});
const scan = await res.json();
console.log(`  ok=${scan.ok} credited=${scan.credited} · ${scan.detail}`);
for (const d of scan.details ?? []) console.log(`  · ${d}`);

if (!scan.credited || scan.credited < 1) {
  console.log("NOTE: ההפקדה עדיין לא נזקפה — אולי טרם-finalized; הרץ שוב את הסריקה בעוד רגע");
  process.exit(2);
}
console.log("[r105] ההפקדה נזקפה — WSOL במאזן הזירה של operator. הוכחה חיה מקצה לקצה.");
