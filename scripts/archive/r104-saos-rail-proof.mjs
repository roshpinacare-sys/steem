// R104 — הוכחת רייל SAOS-LIVE בשלוש פעימות:
//   1) הרשמת ארנק המפעיל (headcorner) על שרשרת SAOS-LIVE — wallet.create
//      חתום במפתח ה-posting מהכספת, משודר כ-custom_json מ-headcorner.
//   2) המתנה להיכללות בבלוק (ההיסטוריה היא השופט).
//   3) אימות קיפול: הארנק רשום, הכתובת נגזרה נכון.
// המשיכה עצמה תבוצע דרך ה-API החי (/api/exchange) — הנתיב הייצורי.
import { saosLiveRegisterWallet, saosAddressOf, foldLiveState } from "../src/lib/weave/saos-rail.ts";

const who = process.argv[2] || "headcorner";

console.log(`[r104] שלב 1 — הרשמת ארנק ${who} על SAOS-LIVE (הכתובת self-certifying מהכספת)`);
const addr = await saosAddressOf(who);
if (!addr.ok) {
  console.log(`FAIL: ${addr.detail}`);
  process.exit(1);
}
console.log(`[r104] כתובת ${who}: ${addr.addr}`);

const before = await foldLiveState(addr.addr);
console.log(`[r104] לפני: רשום=${Boolean(before.wallets[addr.addr])} · אופס=${before.envelopes} · stateRoot=${before.stateRoot.slice(0, 16)}…`);

if (before.wallets[addr.addr]) {
  console.log("[r104] כבר רשום — אין מה לעשות (אידמפוטנטי)");
} else {
  const reg = await saosLiveRegisterWallet({ account: who, nick: who });
  console.log(`[r104] הרשמה: ok=${reg.ok} txid=${reg.txid ?? "—"} · ${reg.note}`);
  if (!reg.ok) process.exit(1);
  // המתנה להיכללות — ההיסטוריה הציבורית היא השופט
  console.log("[r104] ממתין להיכללות בבלוק…");
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 15_000));
    const f = await foldLiveState(addr.addr);
    if (f.wallets[addr.addr]) {
      console.log(`[r104] נקלט! stateRoot=${f.stateRoot.slice(0, 16)}… (אחרי ${(i + 1) * 15}s)`);
      break;
    }
    if (i === 11) {
      console.log("TIMEOUT: לא נקלט תוך 3 דק' — בדוק את השרשרת");
      process.exit(1);
    }
  }
}

const after = await foldLiveState(addr.addr);
console.log(`[r104] אחרי: אופס=${after.envelopes} · רשום=${Boolean(after.wallets[addr.addr])} · stateRoot=${after.stateRoot.slice(0, 16)}…`);
console.log(`[r104] הכתובת למשיכה: ${addr.addr}`);
