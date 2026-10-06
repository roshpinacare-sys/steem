// ═════════════════════════════════════════════════════════════════════
// HIVE-DEPOSIT-DOOR PROOF — הוכחת דלת-ההפקדה של HIVE (R103)
//
// העברה אמיתית בשרשרת (0.001 HIVE עצמי, memo: wx:money-mover)
// ← הסריקה תזהה אותה ← זיכוי WHIVE במאזן הזירה של money-mover.
// ═════════════════════════════════════════════════════════════════════
import { openVaultKey } from "../src/lib/dex/wallet-vault";
import { signGrapheneTx, rpcV4, HIVE_RPC, HIVE_CHAIN_ID } from "../src/lib/weave/graphene";

(async () => {
  const v = openVaultKey("hive", "headcorner", "active");
  if (!v.ok || !v.wif) {
    console.log("VAULT-FAIL:", v.detail);
    process.exit(1);
  }
  console.log("vault: hive active opened ·", v.pub);

  // חוק-החוט (R99): HIVE חותם נכסים בשמות-האב (HIVE→STEEM בייטים)
  const op = ["transfer", {
    from: "headcorner",
    to: "headcorner",
    amount: "0.001 HIVE",
    memo: "wx:money-mover",
  }] as never;
  const mapped = JSON.parse(JSON.stringify(op).replace(/(\d+\.\d+) HIVE/g, "$1 STEEM")) as never;

  const signed = await signGrapheneTx(HIVE_RPC, HIVE_CHAIN_ID, [mapped], v.wif);
  await rpcV4(HIVE_RPC, "condenser_api.broadcast_transaction", [signed]);
  console.log("broadcast-accepted — ההיסטוריה השופטת תאשר");
  process.exit(0);
})().catch((e) => {
  console.error("PROOF-FAIL:", e.message);
  process.exit(1);
});
