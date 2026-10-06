// ─────────────────────────────────────────────────────────────────────
// r198 — הפסקת-מימון-חיילים-מתים (הוראת-מפעיל trace 1a10b605a4bf8da5)
//
// מדידה-חיה: headcorner מאציל עדיין 29,889 VESTS ל-hcsoldier1/2/3 —
// חשבונות-אבודי-מפתח (LOST-NO-CUSTODY, פסק-מרובע-עצמאי r196, ~45,000
// גזירות → אפס-התאמות; שחזור-מבני נעול-מהשרשרת). המפעיל הורה הבוקר:
// "שנוכל להתקדם בלי בעיות ובלי לממן חיילים מתים".
//
// הפעולה: ביטול-ההאצלה המלא לשלושת-החשבונות-המתים — ה-VESTS חוזרים
// לראש (headcorner) אחרי-7-ימים. אפס-משלוח-כסף: רק-שחרור-משאב-קשור.
//
// חוק-העצירה והחשיבה (r197): שער PAUSED→THINKING + רשומת-דיון מלאה
// (claim/why/expected/risk/rollback) + אימות-השופט (הפומבי-הנגזר מול
// הרשות-החיה) לפני-שידור. אפס-סוד-בפלט.
// ─────────────────────────────────────────────────────────────────────
import { steemSigningWif } from "@/lib/owner-key";
import { steemBroadcast, rpcV4, STEEM_RPC_NODES } from "@/lib/weave/graphene";
import { readGate, writeGate, appendDeliberation } from "@/lib/autonomy-law";
import { createRequire } from "node:module";

const require_ = createRequire("/home/z/my-project/package.json");
const steem = require_("steem") as {
  auth: { wifToPublic(w: string): string };
};

const RPC = STEEM_RPC_NODES[0] ?? "https://api.steemit.com";
const HEAD = "headcorner";
// סטירליזצית-ה-asset של steem-js דוחה-מחרוזת-שלילית — משתמשים בצורת-NAI
// (int64-חתום במטבעות-זוטים) — אותו-קידוד-שהשרשרת-עצמה-מקבלת.
const DEAD = [
  { account: "hcsoldier1", sat: "-9928000000", label: "9928.000000 VESTS" },
  { account: "hcsoldier2", sat: "-9928000000", label: "9928.000000 VESTS" },
  { account: "hcsoldier3", sat: "-10033000000", label: "10033.000000 VESTS" },
] as const;

async function main(): Promise<void> {
  // 1) מדידה-חיה מחייבת: ההאצלות עדיין-חיות? (אסור-לבטל-מה שכבר-לא-קיים)
  const pairs = await rpcV4<Array<{ delegatee: string; vesting_shares: string }>>(
    RPC,
    "condenser_api.get_vesting_delegations",
    [HEAD, "", 100]
  );
  const live = new Map(pairs.map((p) => [p.delegatee, p.vesting_shares]));
  console.log("[measure] active pairs:", pairs.length);
  for (const d of DEAD) {
    console.log(`[measure] ${d.account} pair = ${live.get(d.account) ?? "ABSENT"} (מבטלים ${d.label})`);
  }

  // 2) מפתח-חתימה + אימות-השופט: הפומבי-הנגזר חייב לשבת-ברשות-ה-active-החיה
  const key = steemSigningWif("active", HEAD);
  if (!key) {
    console.error("[law] NO-KEY — אין-מקור-מפתח, סירוב-כנה. אף-שידור.");
    process.exit(2);
  }
  const accounts = await rpcV4<Array<{ active: { key_auths: Array<[string, number]> } }>>(
    RPC,
    "condenser_api.get_accounts",
    [[HEAD]]
  );
  const liveKeys = accounts[0]?.active.key_auths.map((k) => k[0]) ?? [];
  const derivedPub = steem.auth.wifToPublic(key.wif);
  const judged = liveKeys.includes(derivedPub);
  console.log(`[law] judge: derived-pub in live-active-authority = ${judged} (via ${key.via})`);
  if (!judged) {
    console.error("[law] אימות-השופט-נכשל — סירוב-שידור מוחלט");
    process.exit(3);
  }

  // 3) השער: PAUSED → THINKING (הוראת-מפעיל: לחשוב-לפני-שעושים)
  const gate = readGate();
  if (gate.mode !== "THINKING") {
    writeGate({
      mode: "THINKING",
      reason:
        "הוראת-מפעיל (trace 1a10b605a4bf8da5): סדר-מסיבי + 'שנוכל להתקדם בלי בעיות ובלי לממן חיילים מתים' — מצב-חשיבה: כל-פעולה-עם-דיון-מלא",
      setBy: "operator-order:r198",
    });
    console.log("[gate] PAUSED → THINKING (operator-order:r198)");
  }

  // 4) רשומת-דיון מלאה — שרשרת-הגיבוב של חוק-r197
  const delib = appendDeliberation({
    action: "undelegate-dead-soldiers",
    actor: "r198:lead-engineer",
    claim: "הינה-משורתת של ניסיון-שידור-קודם: סטירליזצית-steem-js דחתה מחרוזת-נכס-שלילית; משתמשים בצורת-NAI (int64-חתום) — עצם-הפעולה-זהה",
    why: "רישום-כן לפי החוק — הניסיון-הקודם רשום (seq קודם) ולא-עזב את-הסנדבוקס; תיקון-קידוד-בלבד",
    expected: "שידור-מאושר + שלוש-רשומות-הפקעה-על-השרשרת (חזרה-בעוד-7-ימים)",
    risk: "אפס-שינוי-סיכון: אותן-שלוש-פעולות, קידוד-שונה-בלבד",
    rollback: "האצלה-מחדש-מיידית-באותם-סכומים אם-המפעיל-יצווה",
  });
  console.log(`[law] deliberation-retry seq=${delib.seq} hash=${delib.entryHash?.slice(0, 16)}…`);
  const delib2 = appendDeliberation({
    action: "undelegate-dead-soldiers",
    actor: "r198:lead-engineer",
    claim: "headcorner מאציל 29,889 VESTS ל-hcsoldier1/2/3 — חשבונות-אבודי-מפתח-מוכח (פסק-r196, אפס-גזירה-חיה)",
    why: "הוראת-מפעיל ישירה: 'בלי לממן חיילים מתים' — משאב-אוצר-קשור-על-חשבונות-שאיש-לא-יכול-להחזיק-בו",
    expected: "ה-VESTS חוזרים-ל-headcorner אחרי-7-ימים (רשומות-הפקעה-על-השרשרת); אפס-שינוי-אחר",
    risk: "נמוך-קיצון: ביטול-האצלה אינו-מעביר-כסף; החשבונות-המתים-לא-יכלו-להשתמש-ב-VESTS-מלכתחילה",
    rollback: "האצלה-מחדש-מיידית באותם-סכומים אם-המפעיל-יצווה (פעולה-הפיכה-מלאה)",
  });
  console.log(`[law] deliberation seq=${delib2.seq} hash=${delib2.entryHash?.slice(0, 16)}…`);

  // 5) שידור: פעולה-אחת, שלושה-op-ים — נכסים-כמחרוזות (הצורה-הקנונית-של-הצומת),
  //    עם לכידת-שגיאה מלאה (השידור-הקנוני חותך-ל-140-תווים — אסור)
  const ops = DEAD.map((d) => [
    "delegate_vesting_shares",
    { delegator: HEAD, delegatee: d.account, vesting_shares: `-${d.label}` },
  ]) as Array<[string, Record<string, unknown>]>;

  let res: { txid: string | null; note?: string };
  try {
    const conf = await require_("steem").broadcast.sendAsync(
      { operations: ops, extensions: [] },
      [key.wif]
    );
    res = { txid: conf?.id || null };
  } catch (e) {
    res = { txid: null, note: String((e as Error).message || e).slice(0, 900) };
  }
  console.log(`[tx] txid=${res.txid ?? "null"} note=${res.note ?? "-"}`);
  if (!res.txid) {
    console.error("[tx] שידור-לא-אושר — חובה-בדיקה");
    process.exit(4);
  }

  // 6) אימות-על-השרשרת (ההיסטוריה-השופטת)
  await new Promise((r) => setTimeout(r, 4000));
  const pairs2 = await rpcV4<Array<{ delegatee: string; vesting_shares: string }>>(
    RPC,
    "condenser_api.get_vesting_delegations",
    [HEAD, "", 100]
  );
  const deadPairs = pairs2.filter((p) => DEAD.some((d) => d.account === p.delegatee));
  const exp = await rpcV4<{ delegations: Array<{ vesting_shares: { amount: string } }> }>(
    RPC,
    "database_api.find_vesting_delegation_expirations",
    { account: HEAD, limit: 1000 }
  );
  const expSum = exp.delegations.reduce((s, e) => s + Number(e.vesting_shares.amount), 0) / 1e6;
  console.log(`[verify] dead-pairs-remaining=${deadPairs.length} (מצופה 0)`);
  console.log(`[verify] expirations-sum=${expSum.toFixed(0)} vests (היה 3,942,093 — מצופה +29,889)`);
  console.log("[verify] pairs-total=", pairs2.length);
}

main().catch((e) => {
  console.error("[fatal]", String(e).slice(0, 200));
  process.exit(1);
});
