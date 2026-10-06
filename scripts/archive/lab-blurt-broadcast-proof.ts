// ═════════════════════════════════════════════════════════════════════
// BLURT-BROADCAST PROOF — ההוכחה החיה של רייל-השידור (R103)
//
// מריץ את הקוד האמיתי (blurt-wire.ts + wallet-vault.ts) דרך tsx
// עם פתרון ה-aliases של הפרויקט. הפעולה: העברה עצמית זעירה
// (headcorner → headcorner, 0.001 BLURT) — הכסף נשאר שלנו, החוק נבדק.
// ═════════════════════════════════════════════════════════════════════
import { openVaultKey } from "../src/lib/dex/wallet-vault";
import { blurtSendTransfer } from "../src/lib/dex/blurt-wire";

(async () => {
  // 1. הכספת הריבונית — הנתיב המוכח (סיסמת-אב → active-STEEM → חותמה → מפתח-אב)
  const v = openVaultKey("blurt", "headcorner", "active");
  if (!v.ok || !v.wif) {
    console.log("VAULT-FAIL:", v.detail);
    process.exit(1);
  }
  console.log("vault: opened · pub =", v.pub, "· match-expected: BLT5HhJD… ≡ STM5HhJD…");

  // 2. השידור החי — חוק-החוט המילולי (BLURT, בלי מיפוי-מורשת)
  const r = await blurtSendTransfer({
    from: "headcorner",
    to: "headcorner",
    amount: 0.001,
    memo: "R103 blurt-rail proof (sovereign)",
    wif: v.wif,
  });
  console.log("send:", JSON.stringify(r, null, 2));
  process.exit(r.accepted ? 0 : 1);
})();
