// בדיקת מעבדה מבודדת (R98): האם מצב-callback של steem-js מפיץ unhandledRejection
// מול דפוס ה-‎*Async המוכח של קו-העוגן? שידור לכתובת לא-קיימת — אפס כסף בסיכון.
const steem = require("steem");
steem.api.setOptions({ url: "https://api.steemit.com" });

const results = { unhandled: [], callbacks: [], promises: [] };
process.on("unhandledRejection", (r) => {
  results.unhandled.push(String((r && r.message) || r).slice(0, 100));
});

const WIF = "5JNHfZYKGaomSFvd4NUdQ9qMcEAC43kujbfjueTHpVapX1Kzq2n"; // לא שלנו — דחיית-חתימה צפויה
const EXPIRE = "2026-10-20T00:00:00";

// דפוס A: callback (הדפוס הנוכחי ב-/api/money)
try {
  const ret = steem.broadcast.limitOrderCreate(
    WIF, "nonexistent-account-xyz", 999999001, "0.001 SBD", "0.001 STEEM", false, EXPIRE, [],
    (err, res) => results.callbacks.push(err ? "A-rejected: " + String(err.message).slice(0, 60) : "A-ok")
  );
  results.retTypeA = typeof ret; // undefined = אין מה לתפוס
} catch (e) {
  results.callbacks.push("A-sync-throw: " + String(e.message).slice(0, 60));
}

// דפוס B: sendAsync המוכח (graphene.ts / קו העוגן)
steem.broadcast
  .sendAsync(
    { operations: [["limit_order_create", {
      owner: "nonexistent-account-xyz", orderid: 999999002,
      amount_to_sell: "0.001 SBD", min_to_receive: "0.001 STEEM",
      fill_or_kill: false, expiration: EXPIRE,
    }]], extensions: [] },
    [WIF]
  )
  .then(() => results.promises.push("B-ok"))
  .catch((e) => results.promises.push("B-rejected: " + String(e.message).slice(0, 60)));

setTimeout(() => {
  console.log(JSON.stringify(results, null, 2));
  process.exit(0);
}, 20000);
