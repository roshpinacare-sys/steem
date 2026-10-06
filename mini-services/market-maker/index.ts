// ─────────────────────────────────────────────────────────────────────
// WEAVE-MARKET-MAKER · מנוע-הגריד (Task 2-b · פורט 3049)
//
// סוחר-גריד דו-צדדי על השוק-הפנימי של Steem (SBD:STEEM): 5 פקודות-מכירה
// מעל המרכז + 5 פקודות-קנייה מתחתיו, במרווחי-רמה קבועים (bps). כל פעימה:
// מדידת ספר חי ← מרכז ← גדלי-תקציב ← סולם; סטיית-מרכז מעל 2×מרווח =
// ביטול+פריסה מחדש; פקודות פגות אחרי 24ש' (expiration מוטבע).
//
// הפרדת-סמכויות (כמו R80/R81):
//   · המנוע הזה מחליט מתי וכמה — הכספת מספקת חתימה — השרשרת שופטת.
//   · DRY (ברירת-מחדל): הכול מחושב ונרשם ל-dry-run-log.jsonl — אפס שידור.
//   · LIVE: אותו צינור-חתימה של עורק /api/money (steem.broadcast.sendAsync
//     עם WIF-מהכספת) + אימות-ביט-מול-ביט של הפומבי הנגזר מול רשות-ה-active
//     החיה לפני כל שידור (חוק R75 — השרשרת השופטת).
//
// תיאום money-mover (חוק-אחוות-הסוחרים):
//   · התקציב = יתרה-חופשית × budgetPct — והיתרה-החופשית של
//     get_accounts כבר מנוכה את כל הפקודות-הנעולות (שלנו ושל
//     money-mover כאחד, שהשוק-הפנימי מפקיד אצלו). שני-הסוחרים לעולם
//     לא נלחמים על אותם כספים.
//   · ביטול-פקודות: רק לפי רישום-orderid משלנו ב-state.registry —
//     פקודות money-mover (orderid אחר) לעולם לא נוגעות.
//   · אם money-mover באמצע פעולה (sovereign/money/state.json acting=true)
//     הפעימה מדלגת על פריסה — אין-שני-שידורים-חיים-במקביל על אותו חשבון.
//
// דוקטרינה:
//   · fail-closed: מפתח-חתימה נקרא רק מ~/.sovereign/vault/secrets (0600),
//     כל קריאה נרשמת ב-access.log (שם+זמן בלבד), חסר ⇒ יציאה 2 / סירוב-כנה.
//   · כנות: מדידה שנכשלה נרשמת ככישלון — אין "נניח שבסדר".
//   · כתיבת-מצב אטומית (tmp+rename) · טיימר-יחיד במשמר-גלובלי ·
//     שרת-יחיד חוצה-דורות (חוקי weblift/R124 של הצי).
//
// חוזה-r190 (זהה-במקביל ל-src/app/api/money — סוכן 1-a):
//   · טווח-orderid שמור-בלעדי למנוע-הגריד: [1_000_000_000, 1_500_000_000) —
//     orderid = 1G + ((⌊ts/1000⌋×16 + level×2 + side) mod 500M) ⇒ תמיד-בטווח, לנצח.
//     הסכמה-הישנה (mod 2^31 → ~739.9M) נשכחה-לפי-חוק: לא מאומצת, לא נספרת באף-חישוב;
//     פקודות-ישנות-כאלו נמחות ע"י המוביל/פקיעת-24ש'.
//   · רקונסיליאציה-chain-truth (תיקון-שורש לרציפות-registry שנפגמה ב-r189-c):
//     בעלייה (לפני-הטיימר) ובכל פעימה — get_open_orders השופט: פקודה-חיה-בטווח ⇒
//     מאומצת-לרישום כפקודה-אמיתית (side/price/amount מהשרשרת עצמה — אין-סולם-וירטואלי
//     על-גבי-שרשרת-אמיתית); רישום-מחוץ-לטווח או-שאינו-חי-על-השרשרת ⇒ נמחק.
//   · RECOVERY-LIVE: אימוץ-חי-בטווח בעלייה ⇒ המנוע חוזר ל-live אוטומטית (המשכיות —
//     פקודות-על-השרשרת שודרו-חי מלכתחילה; המנדט הקבוע D-OP-01) — אבל: kill-switch
//     קיים ⇒ נשאר כבוי · SELF-HALT פעיל ⇒ נשאר עצור · מפתח-חסר-מהכספת ⇒ fail-closed.
//     אין-פקודות-בטווח ואין-רישום ⇒ עלייה-קרה-רגילה ב-dry (COLD-BOOT-SAFE).
//
// חוזה-r191 (חוק-המפעיל, מחייב: "רווחיות-גם-אם-קטנה"):
//   · פנקס-לוטות FIFO במצב: קנייה-ממולאת פותחת-לוט במחיר-המילוי; מכירה-ממולאת צורכת-לוטות
//     FIFO ומממשת PnL אמיתי = (מחיר-מכירה − עלות-לוט) × כמות − עמלה-מוערכת. נוסחת
//     "מרחק-ממרכז-הפריסה" (מדידת-נייר שגרמה ל-PnL-שלילי-כנה ב-r190) — בוטלה.
//   · מכירות-ללא-לוטות (מלאי-שקדם-לעידן-המנוע) אינן-נספרות ב-PnL-ממומש — היקף-כנה;
//     נספרות-בכנות ב-unmatchedSellSteem/unmatchedSellSbd בלבד.
//   · חוק-רווחיות (profit-guard): אף-מכירה-מתוכננת מתחת לרצפה basisBlended×(1+minProfitBps/10000);
//     minProfitBps=120 חייב-לעלות על העמלה-המוערכת feeRate=75bps. אין-לוטות ⇒ סימטריה-כמו-בעבר
//     (guardBasis:"no-lots"). קניות-לעולם-לא-מעל-הבסיס-הממוצע. מכירות-חיות-שנפלו-מתחת-לרצפה
//     ⇒ ביטול+פריסה-מעל-הרצפה — אף-הצעת-הפסד-מובטח לא יושבת-בספר.
//
// חוזה-r192 (סולם-פאריטה + L3 + רגל-Hive):
//   · סולם-פאריטה (parityLadder, ברירת-מחדל-דלוקה ל-Steem): מרכז-הסולם = מחיר-הפיד החי
//     (condenser_api.get_current_median_history_price — אותו-צינור-RPC-של-המנוע), לא מרכז-הספר.
//     פיד-נפל ⇒ נפילה-כנה-למרכז-הספר (מתועד-ב-state.centerSource). רצפת-הרווח-120bps
//     ופנקס-הלוטות-FIFO נותרו-בלי-שינוי — הפאריטה מזיזה-את-המרכז, לא-את-הרצפה.
//   · חוק-L3 עמלה-דינמית: רצפת-עמלה = 3×פרוקסי-ספרד-CEX (מוצהר-בתצורה — אין-הזנה-חיה);
//     הספרד-האפקטיבית לא-תהיה-מתחת-לרצפה; |skew|>40% ⇒ הרחבת-ספרד-סימטרית ×1.5;
//     |skew|>60% ⇒ השהיית-פריסה (L3-SKEW-HALT); רצפת-נוטיונל $2 לפקודה (SBD≈USD עיקרון-ערך-הרשת).
//     דלק-מתחת-לרצפה ⇒ NO-BUDGET-כנה — הסולם ייפרס-אוטומטית-בהגיע-גל-ה-convert (~1,266 STEEM).
//   · רגל-Hive: פרופיל-תצורה-מלא + טווח-orderid-שמור-משלה על ספר-orderid-הנפרד של Hive —
//     HIVE_GRID_ORDERID_BAND = [1_000_000_000, 1_500_000_000) (חוק-L2 במרחב-Hive — ספר-חשבונות
//     נפרד, אותה-סכמת-נגזרת). הרגל DRY מלאה (enabled:false, mode:dry) — אפס-שידור-Hive עד דלק.
// ─────────────────────────────────────────────────────────────────────

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { writeJsonAtomic, installDeadManWatch } from "../shared";
import { readGate, autonomyVerdict, appendDeliberation } from "../autonomy";

// זמן-ריצה של Bun ללא חבילת טיפוסים בפרויקט — הצהרה מקומית נקייה (כמו ב-money-mover)
declare const Bun: {
  serve: (opts: { port: number; hostname?: string; fetch: (req: Request) => Promise<Response> | Response }) => unknown;
};

const HOME = "/home/z/my-project";
const DIR = `${HOME}/sovereign/market-maker`;
const CONFIG_FILE = `${DIR}/config.json`;
const STATE_FILE = `${DIR}/state.json`;
const DRY_LOG = `${DIR}/dry-run-log.jsonl`;
const LEDGER_FILE = `${DIR}/ledger.jsonl`;
const KILL_FILE = path.join(os.homedir(), ".sovereign", "mm-kill");
const VAULT = path.join(os.homedir(), ".sovereign", "vault");
const MOVER_STATE = `${HOME}/sovereign/money/state.json`;
const PORT = 3049;
const VERSION = "1.3.1-r192";
// חוק-רווחיות r191: רצפת-מכירה = בסיס×(1+minProfitBps/10000) — חייבת-לעלות על העמלה-המוערכת
// (feeRate=0.0075=75bps); השוק-הפנימי-של-Steem למעשה-לא-גובה-עמלת-לימיט — feeRate נשאר-הערכה-שמרנית.
const DEFAULT_MIN_PROFIT_BPS = 120;
const TICK_SEC = 60;
const TICK_MAX_MS = 90_000;
const ACCOUNT = "headcorner"; // זהות-החותם — נאמתת-ביט-מול-ביט מול הרשת בכל שידור (R75)
const RPC_NODES = ["https://api.steemit.com", "https://api.justyy.com"];
const HIVE_RAIL_NOTE = "רגל HIVE: פרופיל-תצורה-מלא (r192) + טווח-orderid-שמור משלה במרחב-Hive — DRY מלאה (enabled:false) עד דלק-ומפתח-active-מאומתים; 0.034 HIVE = אבק";
const L3_WIDEN_FACTOR = 1.5; // חוק-L3: הרחבת-ספרד-סימטרית על-skew>40%

// ── חוזה-r190 המשותף (זהה-במקביל ל-src/app/api/money — סוכן 1-a) ────
// טווח-orderid שמור-בלעדי למנוע-הגריד; money-mover מעודכן-במקביל לא-לגעת בו.
const GRID_ORDERID_BAND_LO = 1_000_000_000;
const GRID_ORDERID_BAND_HI = 1_500_000_000; // חצי-פתוח [LO, HI)
function inGridBand(id: number): boolean {
  return Number.isFinite(id) && id >= GRID_ORDERID_BAND_LO && id < GRID_ORDERID_BAND_HI;
}

// ── חוזה-r192: רגל-HIVE — טווח-orderid שמור משלה (חוק-L2 במרחב-Hive) ──
// Hive הוא ספר-חשבונות נפרד ובו מרחב-orderid עצמאי מ-Steem — אותה-סכמת-נגזרת
// (⌊ts/1000⌋×16 + level×2 + side mod 500M) חוזרת על המרחב-הפרטי-של-Hive, כך
// שאף-התנגשות-בין-השרשרות אי-אפשרית מבנית. הרגל DRY מלאה — הנגזרת כאן
// לבדיקות-לוגיות-ולנראות-/status-בלבד; שידור-Hive ייפתח-רק-אחרי-דלק-ומפתח-מאומתים.
const HIVE_GRID_ORDERID_BAND_LO = 1_000_000_000;
const HIVE_GRID_ORDERID_BAND_HI = 1_500_000_000; // חצי-פתוח [LO, HI) — במרחב-Hive
function inHiveBand(id: number): boolean {
  return Number.isFinite(id) && id >= HIVE_GRID_ORDERID_BAND_LO && id < HIVE_GRID_ORDERID_BAND_HI;
}
function deriveHiveOrderid(side: "buy" | "sell", level: number): number {
  const ts = Math.floor(Date.now() / 1000);
  const raw = ts * 16 + level * 2 + (side === "sell" ? 1 : 0);
  return HIVE_GRID_ORDERID_BAND_LO + (raw % 500_000_000);
}

// ── תצורה ───────────────────────────────────────────────────────────

interface RailSteemConfig {
  enabled: boolean;
  mode: "dry" | "live";
  pair: string;
  gridLevels: number;
  spreadBps: number;
  levelSpacingBps: number;
  orderCap: number; // תקרת-גודל לפקודה-יחידה, ב-STEEM (נכס-הבסיס של הזוג)
  minOrder: number; // גודל-מזערי לפקודה, ב-STEEM
  budgetPct: number; // חלק מהיתרה-החופשית שמוקצה לסולם (ראה חוק-אחוות-הסוחרים בראש הקובץ)
  refreshHours: number; // גיל-מקסימלי לפקודה — ישנה ⇒ ביטול+פריסה מחדש
  feeRate: number; // הערכת-עמלה לספר (לא חוסם-שידור)
  minProfitBps: number; // חוק-רווחיות r191: רצפת-מכירה = בסיס×(1+minProfitBps/10000) — מעל-העמלה-המוערכת
  parityLadder: boolean; // חוק-r192: מרכוז-הסולם סביב מחיר-הפיד החי (ברירת-מחדל-דלוקה לפס-Steem-החי)
  cexSpreadProxyBps: number; // פרוקסי-ספרד-CEX מוצהר (אין-הזנה-חיה) — רצפת-העמלה = 3×זה (חוק-L3)
  minNotionalUsd: number; // חוק-L3: רצפת-נוטיונל לפקודה (SBD≈USD עיקרון-ערך-הרשת)
  skewWidenAt: number; // חוק-L3: |skew|>זה ⇒ ספרד-מתרחבת ×1.5
  skewHaltAt: number; // חוק-L3: |skew|>זה ⇒ השהיית-פריסה
  fleetChurn: boolean; // חיילי-הצי — רק עם יכולת-active מאומתת (ראה fleetVerify)
  churnSize: number; // גודל-פקודת-חיול ב-STEEM
}

// חוזה-r192: פרופיל-רגל-Hive — מבנה-זהה ל-Steem + טווח-orderid-משלה; הרגל DRY מלאה.
interface RailHiveConfig extends Omit<RailSteemConfig, "fleetChurn" | "churnSize"> {
  reason: string;
  account: string;
  rpc: string;
  orderIdBand: { lo: number; hi: number };
}

interface Config {
  rails: { steem: RailSteemConfig; hive: RailHiveConfig };
  dailyLossCapSbd: number;
  tickSec: number;
  _docs?: Record<string, string>;
}

const DEFAULT_CONFIG: Config = {
  rails: {
    steem: {
      enabled: true,
      mode: "dry",
      pair: "SBD:STEEM",
      gridLevels: 5,
      spreadBps: 120,
      levelSpacingBps: 60,
      // r192: התקרה הישנה (1.0 STEEM ≈ $0.10) הייתה-מונעת-לנצח פריסה-שמקיימת-את
 // רצפת-הנוטיונל של L3 ($2 ≈ 19.2 STEEM בשער-הפיד) — הועלתה-כדי-שהחוק יתממש
      orderCap: 25,
      minOrder: 0.05,
      budgetPct: 0.35,
      refreshHours: 24,
      feeRate: 0.0075,
      minProfitBps: DEFAULT_MIN_PROFIT_BPS,
      parityLadder: true,
      cexSpreadProxyBps: 25, // רצפת-עמלה-נגזרת = 75bps ≥ feeRate=75bps — החוק מתקיים
      minNotionalUsd: 2,
      skewWidenAt: 0.4,
      skewHaltAt: 0.6,
      fleetChurn: true,
      churnSize: 0.05,
    },
    // חוזה-r192: רגל-Hive — פרופיל-מלא, DRY מלאה עד דלק-ומפתח-active-מאומתים
    hive: {
      enabled: false,
      reason: "no-verified-active-key-or-liquidity-yet (0.034 HIVE = אבק — DRY עד דלק-מגל-ה-convert)",
      mode: "dry",
      pair: "HBD:HIVE",
      account: "headcorner",
      rpc: "https://api.hive.blog",
      gridLevels: 5,
      spreadBps: 120,
      levelSpacingBps: 60,
      orderCap: 25,
      minOrder: 0.05,
      budgetPct: 0.35,
      refreshHours: 24,
      feeRate: 0.0075,
      minProfitBps: DEFAULT_MIN_PROFIT_BPS,
      parityLadder: true,
      cexSpreadProxyBps: 25,
      minNotionalUsd: 2,
      skewWidenAt: 0.4,
      skewHaltAt: 0.6,
      orderIdBand: { lo: 1_000_000_000, hi: 1_500_000_000 }, // חוק-L2 במרחב-Hive — ספר-נפרד
    },
  },
  dailyLossCapSbd: 0.5,
  tickSec: 60,
  _docs: {
    budgetLaw:
      "budget = free_balance × budgetPct · היתרה-החופשית (get_accounts) כבר מנוכה את כל הפקודות-הנעולות — שלנו ושל money-mover — לכן שני-הסוחרים לא מתחרים על אותם כספים",
    cancelLaw: "ביטול רק לפי orderid מרישום-המנוע עצמו (state.registry) — פקודות money-mover נוגעות-אסור",
    ladderLaw: "5 מכירות מעל המרכז + 5 קניות מתחתיו; רמה-ראשונה ב-±spreadBps/2, אחריהן צעדים של levelSpacingBps",
    driftLaw: "אם המרכז זז מעל 2×levelSpacingBps מאז הפריסה — ביטול+פריסה מחדש",
    fleetChurnLaw: "מופעל רק אחרי אימות-חי של רשות-active לחיילים מהכספת; אין-אימות ⇒ כבוי-בכנות, אין-ממציאים-מפתחות",
    killSwitchLaw: "קובץ ~/.sovereign/mm-kill קיים ⇒ אפס פריסות חדשות; מעבר-ל-live נסרב",
    orderIdBandLaw: "טווח-orderid שמור-בלעדי למנוע-הגריד [1_000_000_000, 1_500_000_000) — חוזה-r190 זהה-לעורק /api/money; סכמה-ישנה (mod 2^31, ~739.9M) נשכחה: לא מאומצת, לא נספרת",
    reconcileLaw: "בעלייה-ובכל-פעימה get_open_orders = השופט: פקודה-חיה-בטווח ⇒ מאומצת-לרישום (chain-truth); רישום-מחוץ-לטווח/שאינו-חי ⇒ נמחק. אימוץ-חי-בטווח בעלייה ⇒ RECOVERY-LIVE — כבוי-אם kill-switch/halted/מפתח-חסר",
    profitLaw: "חוק-רווחיות r191 (רווחיות-גם-אם-קטנה): פנקס-לוטות-FIFO — קנייה-ממולאת פותחת-לוט-במחיר-המילוי, מכירה-ממולאת צורכת-לוטות-FIFO ומממשת (מחיר-מכירה − עלות-לוט)×כמות − עמלה-מוערכת. רצפת-מכירה = basisBlended×(1+minProfitBps/10000) — minProfitBps=120 חייב-לעלות על feeRate=75bps; השוק-הפנימי-של-Steem למעשה-לא-גובה-עמלת-לימיט ולכן feeRate נשאר-הערכה-שמרנית-בחישוב-PnL-בלבד. מכירות-ללא-לוטות (מלאי-שקדם-לעידן-המנוע) אינן-נספרות-ב-PnL-ממומש — היקף-כנה — ונספרות-ב-unmatchedSellSteem/unmatchedSellSbd. אין-לוטות ⇒ סולם-סימטרי (guardBasis:no-lots). קניות-לעולם-לא-מעל-הבסיס-הממוצע (ממוצע-מטה-מותר, תחום-בתקרת-הפסד-היומית); מכירות-חיות-שנפלו-מתחת-לרצפה מוחלפות-בפעימה-הבאה — אין-הצעות-הפסד-מובטח",
    parityLaw: "חוזה-r192 (סולם-פאריטה, חוק-L3): parityLadder=true ⇒ מרכז-הסולם = מחיר-הפיד החי מ-get_current_median_history_price (1 SBD ≈ 9.6062 STEEM ⇒ 0.1041 SBD/STEEM) — לא מרכז-הספר; פיד-נפל ⇒ נפילה-כנה-למרכז-הספר (centerSource=book). רצפת-עמלה = 3×cexSpreadProxyBps (פרוקסי-מוצהר — אין-הזנת-CEX-חיה); הספרד-האפקטיבית = max(spreadBps, רצפת-העמלה) ומתרחבת ×1.5 על |skew|>skewWidenAt (40%); |skew|>skewHaltAt (60%) ⇒ L3-SKEW-HALT — אפס-פריסה-וביטול בפעימה. רצפת-נוטיונל minNotionalUsd=$2 לפקודה (SBD≈USD עיקרון-ערך-הרשת) — דלק-מתחת-לרצפה ⇒ NO-BUDGET-כנה-עד-נחיתת-גל-ה-convert. orderCap הועלה ל-25 STEEM כי-הישן (1.0 ≈ $0.10) היה-מונע-לנצח פריסה-שמקיימת-את-הרצפה. רצפת-הרווח-120bps-ופנקס-הלוטות-FIFO נותרו-ללא-שינוי — הפאריטה מזיזה-את-המרכז, לא-את-הרצפה",
    hiveBandLaw: "חוזה-r192 — רגל-HIVE (חוק-L2 במרחב-Hive): Hive הוא ספר-חשבונות-נפרד ובו מרחב-orderid עצמאי — HIVE_GRID_ORDERID_BAND = [1_000_000_000, 1_500_000_000) (חצי-פתוח) עם-אותה-סכמת-נגזרת: deriveHiveOrderid = 1G + ((⌊ts/1000⌋×16 + level×2 + side) mod 500M) — אי-התנגשות-בין-השרשרות מובטחת-מבנית. הרגל DRY מלאה (enabled:false, mode:dry): 0.034 HIVE = אבק — אפס-שידור-Hive עד דלק-מגל-ה-convert ומפתח-active-מאומת-בכספת; הנגזרות-כאן לבדיקות-לוגיות-ולנראות-/status",
  },
};

function loadConfig(): Config {
  let cfg: Config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")) as Partial<Config>;
    // מיזוג-חסרים בלבד: התצורה של המפעיל שולטת, ברירות-המחדל משלימות בכנות
    cfg = {
      ...cfg,
      ...raw,
      rails: {
        steem: { ...cfg.rails.steem, ...(raw.rails?.steem ?? {}) },
        hive: { ...cfg.rails.hive, ...(raw.rails?.hive ?? {}) },
      },
      _docs: { ...(cfg._docs ?? {}), ...(raw._docs ?? {}) },
    } as Config;
  } catch {
    // קובץ-חסר או פגום = כתיבת-ברירות-המחדל (אטומית) — עלייה ראשונה כנה
  }
  writeJsonAtomic(CONFIG_FILE, cfg);
  return cfg;
}

// ── כספת — fail-closed (דפוס tron-balance/money) ────────────────────

function vaultRead(name: string): string | null {
  const f = path.join(VAULT, "secrets", name);
  if (!fs.existsSync(f)) return null; // הקורא מחליט מה כנות-הכישלון שלו
  try {
    const st = fs.statSync(f);
    if ((st.mode & 0o077) !== 0) {
      console.error(`[market-maker] ${name} בכספת עם הרשאות רחבות-מדי (${(st.mode & 0o777).toString(8)}) — fail-closed`);
      return null;
    }
    try {
      fs.appendFileSync(path.join(VAULT, "access.log"), `${new Date().toISOString()} read ${name} (market-maker)\n`, { mode: 0o600 });
    } catch {
      /* הלוג לעולם לא חוסם את הקריאה */
    }
    return fs.readFileSync(f, "utf8").trim();
  } catch {
    return null;
  }
}

/** מפתח-חתימה — נקרא רק במסילת-live. חסר ⇒ יציאה 2 (fail-closed, דפוס tron-balance). */
function loadSigningWif(): string {
  const wif = vaultRead("STEEM_ACTIVE_WIF");
  if (!wif || wif.length < 40) {
    console.error("market-maker: STEEM_ACTIVE_WIF לא בכספת — fail-closed, אפס חתימה");
    process.exit(2);
  }
  return wif;
}

// ── מצב ─────────────────────────────────────────────────────────────

interface RegistryOrder {
  orderid: number;
  side: "buy" | "sell";
  level: number;
  price: number; // SBD per STEEM
  amount: number; // STEEM
  total: number; // SBD
  placedAt: string;
  expiration: string;
  centerAtPlace: number;
  txid: string | null;
  dry: boolean;
  adopted?: boolean; // r190: אומץ-מהשרשרת (chain-truth) — side/price/amount מהשרשרת-עצמה; level=0 = רמה-לא-ניתנת-לשחזור
}

// פנקס-לוטות (r191): לוט-יחיד = קנייה-ממולאת-אחת-של-המנוע (רישום-מקושר-בלבד)
interface LotEntry {
  steem: number; // כמות-שנותרה בלוט (STEEM)
  costSbdPerSteem: number; // עלות-אחזקה (SBD ל-STEEM) — מחיר-מילוי-הקנייה
  openedAt: string;
}

interface MMState {
  service: string;
  version: string;
  bootedAt: string;
  mode: "dry" | "live";
  lastTick: string | null;
  ticks: number;
  centerPrice: number | null;
  spreadBps: number | null;
  openOrders: RegistryOrder[];
  fills24h: number;
  volume24hSteem: number;
  volume24hSbd: number;
  lots: LotEntry[]; // פנקס-לוטות FIFO (r191) — רק-קניות-ממולאות-של-המנוע
  lotsCount: number;
  basisBlendedSbd: number | null; // עלות-ממוצעת-משוקללת של הלוטות — null כשאין-לוטות
  unrealizedPnlSbd: number; // Σ(mid − עלות-לוט) × כמות — סימון-לשוק-פעימתי
  unmatchedSellSteem: number; // מכירות-ללא-לוטות (מלאי-שקדם-לעידן-המנוע) — מחוץ-להיקף-ה-PnL
  unmatchedSellSbd: number;
  profitGuard: { minProfitBps: number; basis: number | null; floor: number | null; guardBasis: "basis" | "no-lots"; sellsUnderFloor: number; updatedAt: string | null };
  realizedPnlSbd: number;
  dailyPnlSbd: number;
  pnlDay: string;
  fillsSeen: number;
  internalFills: number;
  lastFillBlock: number;
  halted: boolean;
  haltedAt: string | null;
  haltedConfigMtimeMs: number | null;
  killSwitch: boolean;
  autonomy: string; // r199: מצב-השער החי בקובץ-המצב — ה-API והמפעיל רואים את-השער, לא את-ההחלטה-האחרונה (פער-שקיפות-מביקורת-r199-2b)
  lastDecision: { at: string; kind: string; detail: string } | null;
  lastError: string | null;
  registry: Record<string, RegistryOrder>;
  fleetChurn: { configured: boolean; effective: boolean; verified: boolean; reason: string; soldiersChecked: number };
  coordination: { moverActing: boolean; moverCheckedAt: string | null; ourOrders: number; moverOrders: number };
  balances: { steemFree: number; sbdFree: number; measuredAt: string | null };
  parityCenterSbd: number | null; // r192: מחיר-הפיד החי (SBD ל-STEEM) — נמדד בכל פעימה כשהדגל דלוק
  centerSource: "feed" | "book" | null; // r192: מקור-המרכז בפעימה האחרונה (פיד-נפל ⇒ book — כנות)
  l3: { feeFloorBps: number; spreadBpsEffective: number; widened: boolean; skew: number; halted: boolean; bidDepthSbd: number; askDepthSbd: number } | null; // r192: פרמטרי-L3 של הפעימה האחרונה
  lastModeChange: { at: string; from: string; to: string; by: string } | null;
}

function utcDay(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

/** אגרגציות-פנקס-הלוטות (r191): נגזרות-טהורות — בסיס-ממוצע-משוקלל + סימון-לשוק. */
function lotAggregates(lots: LotEntry[], mid: number | null): { lotsCount: number; basisBlendedSbd: number | null; unrealizedPnlSbd: number } {
  let totalSteem = 0;
  let totalCost = 0;
  for (const l of lots) {
    totalSteem += l.steem;
    totalCost += l.steem * l.costSbdPerSteem;
  }
  const basis = totalSteem > 1e-9 ? Math.round((totalCost / totalSteem) * 1e6) / 1e6 : null;
  const unreal = basis != null && mid != null ? Math.round((mid - basis) * totalSteem * 1e6) / 1e6 : 0;
  return { lotsCount: lots.length, basisBlendedSbd: basis, unrealizedPnlSbd: unreal };
}

function refreshLotAggregates() {
  const a = lotAggregates(state.lots, state.centerPrice);
  state.lotsCount = a.lotsCount;
  state.basisBlendedSbd = a.basisBlendedSbd;
  if (state.centerPrice != null) state.unrealizedPnlSbd = a.unrealizedPnlSbd; // סימון-לשוק רק-כשהמרכז-נמדד
}

/** סנן-לוטות-תקין: רשומות-פגומות/אבק-נזרקים-בכנות (הגירה-מ-r191-קודם ואחרי-כל-צריכה). */
function validLots(raw: unknown): LotEntry[] {
  if (!Array.isArray(raw)) return [];
  return (raw as unknown[])
    .filter((l): l is LotEntry => !!l && typeof (l as LotEntry).steem === "number" && (l as LotEntry).steem > 0 && typeof (l as LotEntry).costSbdPerSteem === "number" && (l as LotEntry).costSbdPerSteem > 0)
    .map((l) => ({ steem: l.steem, costSbdPerSteem: l.costSbdPerSteem, openedAt: String(l.openedAt ?? "") }));
}

function freshState(): MMState {
  return {
    service: "market-maker",
    version: VERSION,
    bootedAt: new Date().toISOString(),
    mode: "dry", // חוק: אף-עלייה-קרה לא מתחילה live — רק POST /mode מעביר
    lastTick: null,
    ticks: 0,
    centerPrice: null,
    spreadBps: null,
    openOrders: [],
    fills24h: 0,
    volume24hSteem: 0,
    volume24hSbd: 0,
    lots: [],
    lotsCount: 0,
    basisBlendedSbd: null,
    unrealizedPnlSbd: 0,
    unmatchedSellSteem: 0,
    unmatchedSellSbd: 0,
    profitGuard: { minProfitBps: DEFAULT_MIN_PROFIT_BPS, basis: null, floor: null, guardBasis: "no-lots", sellsUnderFloor: 0, updatedAt: null },
    realizedPnlSbd: 0,
    dailyPnlSbd: 0,
    pnlDay: utcDay(),
    fillsSeen: 0,
    internalFills: 0,
    lastFillBlock: 0,
    halted: false,
    haltedAt: null,
    haltedConfigMtimeMs: null,
    killSwitch: fs.existsSync(KILL_FILE),
    autonomy: "THINKING", // r199: ברירת-מחדל-כנה — הפעימה הראשונה כותבת את-הערך-החי
    lastDecision: null,
    lastError: null,
    registry: {},
    fleetChurn: { configured: false, effective: false, verified: false, reason: "טרם-נבדק", soldiersChecked: 0 },
    coordination: { moverActing: false, moverCheckedAt: null, ourOrders: 0, moverOrders: 0 },
    balances: { steemFree: 0, sbdFree: 0, measuredAt: null },
    parityCenterSbd: null,
    centerSource: null,
    l3: null,
    lastModeChange: null,
  };
}

const G_MM = globalThis as unknown as { __MM_STATE__?: MMState; __MM_CONFIG__?: Config };

function readState(): MMState {
  const base = freshState();
  try {
    const prev = JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) as Partial<MMState>;
    // המשכיות-אמת: רישום-פקודות, ספר-מילויים ומונים שורדים restart/hot-reload (לקח R84)
    const merged: MMState = {
      ...base,
      mode: "dry", // חוק-הברזל: עלייה-קרה תמיד עולה dry; המפעיל מעביר ב-POST /mode
      bootedAt: base.bootedAt,
      ticks: typeof prev.ticks === "number" ? prev.ticks : 0,
      centerPrice: typeof prev.centerPrice === "number" ? prev.centerPrice : null,
      spreadBps: typeof prev.spreadBps === "number" ? prev.spreadBps : null,
      openOrders: Array.isArray(prev.openOrders) ? prev.openOrders : [],
      fills24h: typeof prev.fills24h === "number" ? prev.fills24h : 0,
      volume24hSteem: typeof prev.volume24hSteem === "number" ? prev.volume24hSteem : 0,
      volume24hSbd: typeof prev.volume24hSbd === "number" ? prev.volume24hSbd : 0,
      // הגירה-r191: שדות-פנקס-הלוטות — ברירות-מחדל-בטוחות; רישום/פקודות/מונים-שורדים-תמיד
      lots: validLots(prev.lots),
      unrealizedPnlSbd: typeof prev.unrealizedPnlSbd === "number" ? prev.unrealizedPnlSbd : 0,
      unmatchedSellSteem: typeof prev.unmatchedSellSteem === "number" ? prev.unmatchedSellSteem : 0,
      unmatchedSellSbd: typeof prev.unmatchedSellSbd === "number" ? prev.unmatchedSellSbd : 0,
      profitGuard: prev.profitGuard ?? { minProfitBps: DEFAULT_MIN_PROFIT_BPS, basis: null, floor: null, guardBasis: "no-lots", sellsUnderFloor: 0, updatedAt: null },
      realizedPnlSbd: typeof prev.realizedPnlSbd === "number" ? prev.realizedPnlSbd : 0,
      dailyPnlSbd: prev.pnlDay === utcDay() && typeof prev.dailyPnlSbd === "number" ? prev.dailyPnlSbd : 0,
      pnlDay: utcDay(),
      fillsSeen: typeof prev.fillsSeen === "number" ? prev.fillsSeen : 0,
      internalFills: typeof prev.internalFills === "number" ? prev.internalFills : 0,
      lastFillBlock: typeof prev.lastFillBlock === "number" ? prev.lastFillBlock : 0,
      halted: prev.halted === true,
      haltedAt: prev.haltedAt ?? null,
      haltedConfigMtimeMs: prev.haltedConfigMtimeMs ?? null,
      killSwitch: fs.existsSync(KILL_FILE),
      autonomy: typeof prev.autonomy === "string" ? prev.autonomy : base.autonomy, // r199: שורד-הפעלה-מחדש
      lastDecision: prev.lastDecision ?? null,
      registry: prev.registry && typeof prev.registry === "object" ? prev.registry : {},
      fleetChurn: prev.fleetChurn ?? base.fleetChurn,
      coordination: prev.coordination ?? base.coordination,
      balances: prev.balances ?? base.balances,
      parityCenterSbd: typeof prev.parityCenterSbd === "number" ? prev.parityCenterSbd : null,
      centerSource: prev.centerSource === "feed" || prev.centerSource === "book" ? prev.centerSource : null,
      l3: (prev.l3 as MMState["l3"]) ?? null,
      lastModeChange: prev.lastModeChange ?? null,
    };
    // נגזרות-פנקס-הלוטות מחושבות-תמיד-מהלוטות-עצמן — לא-מהקובץ (אמת-אחת)
    const agg = lotAggregates(merged.lots, merged.centerPrice);
    merged.lotsCount = agg.lotsCount;
    merged.basisBlendedSbd = agg.basisBlendedSbd;
    merged.unrealizedPnlSbd = agg.unrealizedPnlSbd;
    return merged;
  } catch {
    return base;
  }
}

// ציר-עולם (דפוס weblift/R124): אובייקט-מצב אחד לכל חיי-התהליך; דור-חם יורש
// את האובייקט החי — רק עלייה-קרה קוראת מהדיסק (ותמיד עולה dry — חוק-הברזל).
const coldBoot = G_MM.__MM_STATE__ == null;
let state: MMState = coldBoot ? readState() : G_MM.__MM_STATE__;
G_MM.__MM_STATE__ = state;
let cfg: Config = G_MM.__MM_CONFIG__ ?? loadConfig();
G_MM.__MM_CONFIG__ = cfg;

// הגירה-במקום (דור-חם, r191): אובייקט-מצב-חי-ששרד-hot-reload עשוי-להיות-חסר-שדות-חדשים —
// מילוי-ברירות-מחדל-בכנות בלי-לגעת ברישום/פקודות/מונים (המשכיות-אמת, לקח-R84)
if (state.version !== VERSION) {
  state.version = VERSION;
  console.log(`[market-maker] הגירה-במקום: version → ${VERSION}`);
}
state.lots = validLots(state.lots);
if (typeof state.unrealizedPnlSbd !== "number") state.unrealizedPnlSbd = 0;
if (typeof state.unmatchedSellSteem !== "number") state.unmatchedSellSteem = 0;
if (typeof state.unmatchedSellSbd !== "number") state.unmatchedSellSbd = 0;
if (!state.profitGuard || typeof state.profitGuard !== "object") state.profitGuard = { minProfitBps: DEFAULT_MIN_PROFIT_BPS, basis: null, floor: null, guardBasis: "no-lots", sellsUnderFloor: 0, updatedAt: null };
// תצורה-שורדת-דור-חם עשויה-להיות-חסרת-minProfitBps — מיזוג-חסרים-חד-פעמי-וכנה
if (typeof cfg.rails.steem.minProfitBps !== "number") {
  cfg.rails.steem = { ...DEFAULT_CONFIG.rails.steem, ...cfg.rails.steem };
  cfg._docs = { ...(DEFAULT_CONFIG._docs ?? {}), ...(cfg._docs ?? {}) };
  writeJsonAtomic(CONFIG_FILE, cfg);
  console.log("[market-maker] מיזוג-תצורה-חם: minProfitBps נוסף-מברירת-המחדל (חוק-רווחיות r191)");
}
// מיזוג-r192: שדות-L3/פאריטה-ופרופיל-Hive-חסרים — מילוי-מברירות-המחדל (מתועד-בלוג)
if (typeof cfg.rails.steem.parityLadder !== "boolean" || typeof cfg.rails.steem.cexSpreadProxyBps !== "number" || typeof cfg.rails.steem.minNotionalUsd !== "number" || typeof cfg.rails.steem.skewWidenAt !== "number" || typeof cfg.rails.steem.skewHaltAt !== "number") {
  cfg.rails.steem = { ...DEFAULT_CONFIG.rails.steem, ...cfg.rails.steem };
  writeJsonAtomic(CONFIG_FILE, cfg);
  console.log("[market-maker] מיזוג-תצורה-חם: שדות-L3/פאריטה (r192) נוספו-מברירות-המחדל");
}
if (cfg.rails.hive?.orderIdBand == null) {
  cfg.rails.hive = { ...DEFAULT_CONFIG.rails.hive, ...cfg.rails.hive } as RailHiveConfig;
  writeJsonAtomic(CONFIG_FILE, cfg);
  console.log("[market-maker] מיזוג-תצורה-חם: פרופיל-Hive (r192, DRY) נוסף-מברירת-המחדל");
}
if (typeof state.parityCenterSbd !== "number") state.parityCenterSbd = null;
if (state.centerSource !== "feed" && state.centerSource !== "book") state.centerSource = null;
if (!state.l3 || typeof state.l3 !== "object") state.l3 = null;
refreshLotAggregates();

function saveState() {
  writeJsonAtomic(STATE_FILE, state);
}

function decision(kind: string, detail: string) {
  state.lastDecision = { at: new Date().toISOString(), kind, detail };
  console.log(`[market-maker] ${kind}: ${detail}`);
}

// ── יומני-jsonl (הוספה-בלבד · ראיה-אטומית-שורה) ─────────────────────

function appendJsonl(file: string, entry: Record<string, unknown>) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${JSON.stringify(entry)}\n`);
  } catch (e) {
    console.error(`[market-maker] כתיבת-${path.basename(file)} נכשלה: ${String((e as Error)?.message ?? e)}`);
  }
}

const dryLog = (entry: Record<string, unknown>) => appendJsonl(DRY_LOG, { ts: new Date().toISOString(), mode: "dry", rail: "steem", ...entry });

// ── RPC-רב-צמתי (אותו דפוס העורק — bounded-wait R112) ──────────────

async function steemRpcOnce(node: string, method: string, params: unknown[], timeoutMs: number): Promise<any> {
  const res = await fetch(node, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(timeoutMs),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`http ${res.status} @ ${node}`);
  const j = await res.json();
  if (j?.error) throw new Error(String(j.error.message ?? "rpc-error") + ` @ ${node}`);
  return j.result;
}

async function steemRpc(method: string, params: unknown[]): Promise<any> {
  let lastErr: unknown = null;
  for (const node of RPC_NODES) {
    try {
      return await steemRpcOnce(node, method, params, 12_000);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("all-steem-nodes-down");
}

// ── מדידות חיות ─────────────────────────────────────────────────────

/** עומקי-הספר + skew (r192/חוק-L3): הסטייה-בין-עומק-הבידים-לעומק-האסקים ב-SBD,
 *  מנורמלת ל-[−1,1] — חיוב = עודף-ביקוש (בידים-כבדים), שלילי = עודף-היצע. */
async function bookState(): Promise<{ mid: number; bestBid: number; bestAsk: number; bidDepthSbd: number; askDepthSbd: number; skew: number }> {
  const j = await steemRpc("condenser_api.get_order_book", [10]);
  const bids: Array<{ real_price: string; sbd?: string }> = j?.bids ?? [];
  const asks: Array<{ real_price: string; sbd?: string }> = j?.asks ?? [];
  const bestBid = Math.max(...bids.map((b) => parseFloat(b.real_price)).filter((n) => n > 0));
  const bestAsk = Math.min(...asks.map((a) => parseFloat(a.real_price)).filter((n) => n > 0));
  if (!(bestBid > 0) || !(bestAsk > 0) || bestAsk < bestBid) throw new Error("book-empty-or-crossed");
  const mid = Math.round(((bestBid + bestAsk) / 2) * 1e6) / 1e6;
  if (!(mid > 0.001) || mid >= 1000) throw new Error("mid-out-of-range");
  const bidDepthSbd = Math.round(bids.reduce((s, b) => s + (parseFloat(b?.sbd ?? "") || 0), 0) * 1000) / 1000;
  const askDepthSbd = Math.round(asks.reduce((s, a) => s + (parseFloat(a?.sbd ?? "") || 0), 0) * 1000) / 1000;
  const depthTotal = bidDepthSbd + askDepthSbd;
  const skew = depthTotal > 0 ? Math.round(((bidDepthSbd - askDepthSbd) / depthTotal) * 10000) / 10000 : 0;
  return { mid, bestBid, bestAsk, bidDepthSbd, askDepthSbd, skew };
}

async function bookMid(): Promise<{ mid: number; bestBid: number; bestAsk: number }> {
  const b = await bookState();
  return { mid: b.mid, bestBid: b.bestBid, bestAsk: b.bestAsk };
}

/** מחיר-הפיד החי (r192 — סולם-הפאריטה): אותו-צינור-RPC-של-המנוע, keyless.
 *  get_current_median_history_price מחזיר {base: "x SBD", quote: "y STEEM"} —
 *  היחס base/quote = SBD ל-STEEM (נמדד-חי 04/10: 0.1041 ⇒ 1 SBD ≈ 9.6062 STEEM).
 *  כנות: פיד-נפל/פורמט-שונה ⇒ null — הקורא נופל-למרכז-הספר-ומתעד. */
async function feedPrice(): Promise<{ sbdPerSteem: number; steemPerSbd: number } | null> {
  try {
    const j = await steemRpc("condenser_api.get_current_median_history_price", []);
    const base = parseAsset(j?.base ?? "");
    const quote = parseAsset(j?.quote ?? "");
    if (base.asset === "SBD" && quote.asset === "STEEM" && base.amount > 0 && quote.amount > 0) {
      const sbdPerSteem = Math.round((base.amount / quote.amount) * 1e6) / 1e6;
      const steemPerSbd = Math.round((quote.amount / base.amount) * 1e4) / 1e4;
      if (sbdPerSteem > 0.001 && sbdPerSteem < 1000 && steemPerSbd > 0.001 && steemPerSbd < 100000) {
        return { sbdPerSteem, steemPerSbd };
      }
    }
    return null;
  } catch {
    return null; // כנות: אין-המצאת-שער
  }
}

/** חוק-L3 (r192): פרמטרי-הספרד-הדינמיים לפעימה.
 *  רצפת-עמלה = 3×cexSpreadProxyBps (פרוקסי-מוצהר-בתצורה — אין-הזנת-CEX-חיה);
 *  הספרד-האפקטיבית = max(spreadBps, רצפת-העמלה); |skew|>skewWidenAt ⇒ ×1.5;
 *  |skew|>skewHaltAt ⇒ השהיית-פריסה (הקורא מחזיר-לפני-כל-פעולת-ספר). */
function l3Params(c: RailSteemConfig, skew: number): { feeFloorBps: number; spreadBps: number; widened: boolean; halted: boolean } {
  const proxy = typeof c.cexSpreadProxyBps === "number" && c.cexSpreadProxyBps > 0 ? c.cexSpreadProxyBps : 25;
  const feeFloorBps = 3 * proxy;
  const widenAt = typeof c.skewWidenAt === "number" && c.skewWidenAt > 0 ? c.skewWidenAt : 0.4;
  const haltAt = typeof c.skewHaltAt === "number" && c.skewHaltAt > widenAt ? c.skewHaltAt : 0.6;
  const a = Math.abs(typeof skew === "number" && Number.isFinite(skew) ? skew : 0);
  const widened = a > widenAt;
  const halted = a > haltAt;
  const baseSpread = Math.max(c.spreadBps, feeFloorBps);
  const spreadBps = widened ? Math.round(baseSpread * L3_WIDEN_FACTOR) : baseSpread;
  return { feeFloorBps, spreadBps, widened, halted };
}

function parseAsset(s: string): { amount: number; asset: string } {
  const [a, t] = String(s ?? "").trim().split(/\s+/);
  return { amount: parseFloat(a) || 0, asset: t ?? "" };
}

interface ChainOrder {
  orderid: number;
  seller: string;
  side: "buy" | "sell";
  amount: number; // מה-כסף-נעול: STEEM למכירה, SBD לקנייה
  receive: number;
  price: number; // SBD per STEEM
  created: string;
  expiration: string;
}

async function ourOpenOrders(): Promise<{ ours: ChainOrder[]; all: ChainOrder[] }> {
  // צורת-השרשרת האמיתית: for_sale (מדורג ×1000) + sell_price {base, quote} —
  // מכירה: base=STEEM; קנייה: base=SBD. המחיר ב-SBD ל-STEEM בשני-הצדדים.
  const raw = await steemRpc("condenser_api.get_open_orders", [ACCOUNT]);
  const all: ChainOrder[] = (raw ?? []).map((o: any) => {
    const base = parseAsset(o?.sell_price?.base ?? "");
    const quote = parseAsset(o?.sell_price?.quote ?? "");
    const isSell = base.asset === "STEEM";
    const amount = isSell ? base.amount : quote.amount; // נכס-הבסיס STEEM בשני-הצדדים
    const total = isSell ? quote.amount : base.amount; // SBD
    const price = amount > 0 && total > 0 ? Math.round((total / amount) * 1e6) / 1e6 : 0;
    const forSale = Number(o?.for_sale ?? 0) / 1000;
    return {
      orderid: Number(o?.orderid ?? 0),
      seller: String(o?.seller ?? ""),
      side: (isSell ? "sell" : "buy") as "buy" | "sell",
      amount: amount > 0 ? amount : forSale,
      receive: total,
      price,
      created: String(o?.created ?? ""),
      expiration: String(o?.expiration ?? ""),
    };
  });
  return { ours: all, all };
}

async function balances(): Promise<{ steemFree: number; sbdFree: number }> {
  const accts = await steemRpc("condenser_api.get_accounts", [[ACCOUNT]]);
  const a = accts?.[0];
  if (!a) throw new Error("account-empty");
  // היתרה-החופשית — השוק-הפנימי מפקיד כל-פקודה-פתוחה אצלו: היתרה-כאן
  // כבר מנוכה את כל הנעול (שלנו ושל money-mover) — חוק-אחוות-הסוחרים.
  return { steemFree: parseAsset(a.balance).amount, sbdFree: parseAsset(a.sbd_balance).amount };
}

function moverActing(): boolean {
  try {
    const m = JSON.parse(fs.readFileSync(MOVER_STATE, "utf8"));
    state.coordination.moverCheckedAt = new Date().toISOString();
    return m?.acting === true;
  } catch {
    return false; // קובץ-חסר = השכן לא רץ — אין מי שיתנגש
  }
}

// ── רקונסיליאציה chain-truth (r190 — תיקון-שורש לרציפות-registry של r189-c) ──

/** אימוץ-פקודה-חיה-מהשרשרת: side/price/amount מהשרשרת עצמה — השרשרת שופטת, אין-המצאת-סולם.
 *  level אינו-ניתן-לשחזור מהשרשרת ⇒ 0 (מסומן-מאומץ); centerAtPlace = מדידה-חיה-בזמן-האימוץ. */
function adoptChainOrder(o: ChainOrder, center: number | null): RegistryOrder {
  return {
    orderid: o.orderid,
    side: o.side,
    level: 0,
    price: o.price,
    amount: o.amount,
    total: Math.round(o.amount * o.price * 1e6) / 1e6,
    placedAt: o.created || new Date().toISOString(),
    expiration: o.expiration || "",
    centerAtPlace: center != null && center > 0 ? center : o.price,
    txid: null, // לא-ידוע-מהשרשרת — הפומבי-על-השרשרת הוא-העדות, לא-ממציאים-txid
    dry: false,
    adopted: true,
  };
}

/** נקראת-פעם-בעלייה, לפני-אתחול-הטיימר. השרשרת גוברת-תמיד על קובץ-המצב:
 *  (1) שכחת-הסכמה-הישנה — רישומים-מחוץ-לטווח-השמור נמחקים (לא מאומצים, לא נספרים).
 *  (2) כל פקודה-חיה-על-החשבון ש-orderid-שלה בטווח [1G,1.5G) = שלנו-חיה ⇒ מאומצת-לרישום.
 *  (3) רישום-בטווח-שאינו-חי-על-השרשרת ⇒ נמחק.
 *  (4) אימוץ-חי-בטווח ⇒ RECOVERY-LIVE — אלא-אם kill-switch / SELF-HALT / מפתח-חסר. */
async function reconcileOnBoot(): Promise<void> {
  state.killSwitch = fs.existsSync(KILL_FILE);
  let ours: ChainOrder[] | null = null;
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= 3 && ours === null; attempt++) {
    try {
      ours = (await ourOpenOrders()).ours;
    } catch (e) {
      lastErr = e;
      if (attempt < 3) await new Promise((r) => setTimeout(r, 2_500));
    }
  }
  if (ours === null) {
    decision("BOOT-RECONCILE-FAILED", `get_open_orders נכשל 3× (${String((lastErr as Error)?.message ?? lastErr).slice(0, 110)}) — עולה על רישום-הקובץ-בלבד, אין-אימוץ-עיוור; הטיימר-ימשיך-למדוד`);
    return;
  }
  const centerAtBoot = await bookMid().then((b) => b.mid).catch(() => null); // מדידה-חיה; נכשל ⇒ null (כנות)
  let purged = 0;
  for (const [k, reg] of Object.entries(state.registry)) {
    if (!inGridBand(reg.orderid)) {
      delete state.registry[k];
      purged += 1;
    }
  }
  let adopted = 0;
  for (const o of ours) {
    if (!inGridBand(o.orderid)) continue; // פקודות-המוביל/הסכמה-הישנה — לא-שלנו, לא-נוגעים
    if (!state.registry[String(o.orderid)]) {
      state.registry[String(o.orderid)] = adoptChainOrder(o, centerAtBoot);
      adopted += 1;
    }
  }
  let dead = 0;
  for (const reg of Object.values(state.registry)) {
    if (!ours.some((o) => o.orderid === reg.orderid)) {
      delete state.registry[String(reg.orderid)];
      dead += 1;
    }
  }
  state.openOrders = Object.values(state.registry).sort((a, b) => b.price - a.price);
  state.coordination.ourOrders = ours.filter((o) => state.registry[String(o.orderid)]).length;
  state.coordination.moverOrders = ours.length - state.coordination.ourOrders;
  decision(
    "BOOT-RECONCILE",
    `chain-truth: ${ours.length} פקודות-חיות-על-החשבון · בטווח-השמור: ${adopted} אומצו · רישום: ${purged} מחוץ-לטווח נשכחו (סכמה-ישנה) + ${dead} לא-חיים-על-השרשרת נמחקו · מרכז-נמדד ${centerAtBoot ?? "לא-נמדד"}`,
  );
  if (adopted > 0) {
    if (state.killSwitch) {
      decision("RECOVERY-BLOCKED-KILL", `${adopted} פקודות-בטווח-חיות-על-השרשרת אך קובץ-ההרג קיים (~/.sovereign/mm-kill) — נשאר כבוי; רישום-אומץ-בלבד`);
    } else if (state.halted) {
      decision("RECOVERY-BLOCKED-HALT", `${adopted} פקודות-בטווח-חיות-על-השרשרת אך SELF-HALT פעיל (תקרת-הפסד) — נשאר עצור; רישום-אומץ-בלבד`);
    } else if (!fs.existsSync(path.join(VAULT, "secrets", "STEEM_ACTIVE_WIF"))) {
      decision("RECOVERY-FAIL-CLOSED", `${adopted} פקודות-בטווח-חיות-על-השרשרת אך מפתח-החתימה חסר-מהכספת — fail-closed, נשאר dry; רישום-אומץ-בלבד`);
    } else {
      const from = state.mode;
      state.mode = "live"; // המשכיות-ולא-הפעלה-חדשה: פקודות-על-השרשרת שודרו-חי מלכתחילה (D-OP-01)
      cfg.rails.steem.mode = "live";
      writeJsonAtomic(CONFIG_FILE, cfg);
      state.lastModeChange = { at: new Date().toISOString(), from, to: "live", by: "recovery:chain-band" };
      decision("RECOVERY-LIVE", `${adopted} פקודות-בטווח-חיות-על-השרשרת — המנוע חוזר ל-live אוטומטית (המשכיות-רציפות, המנדט D-OP-01)`);
    }
  }
  saveState();
}

// ── fleetChurn — אימות-חי של יכולת-active לחיילים (אין-ממציאים-מפתחות) ─

let fleetChecked = false;
async function fleetVerify(): Promise<void> {
  if (fleetChecked) return;
  fleetChecked = true;
  const fc = cfg.rails.steem.fleetChurn;
  const bundle = vaultRead("SA_FLEET_KEYS");
  if (!bundle) {
    state.fleetChurn = { configured: fc, effective: false, verified: false, reason: "SA_FLEET_KEYS לא בכספת — אין-יכולת-חיול מאומתת", soldiersChecked: 0 };
    return;
  }
  try {
    const bundleObj = JSON.parse(Buffer.from(bundle, "base64").toString("utf8")) as Record<string, string>;
    const names = Object.keys(bundleObj);
    const accts = await steemRpc("condenser_api.get_accounts", [names]);
    const byName = new Map<string, any>((accts ?? []).map((a: any) => [a.name, a]));
    const withActive: string[] = [];
    const nodeRequire = createRequire(path.join(HOME, "package.json"));
    const steem = nodeRequire("steem");
    for (const n of names) {
      const pub = steem.auth.wifToPublic(bundleObj[n]);
      const a = byName.get(n);
      const inActive = (a?.active?.key_auths ?? []).some((k: [string, number]) => k[0] === pub);
      if (inActive) withActive.push(n);
    }
    if (withActive.length > 0) {
      state.fleetChurn = { configured: fc, effective: fc, verified: true, reason: `אומת-חי: ${withActive.length}/${names.length} חיילים עם רשות-active`, soldiersChecked: names.length };
    } else {
      // המדידה-החיה: מפתחות-הצי בכספת הם posting-בלבד (נאומת מול רשויות-השרשרת)
      state.fleetChurn = { configured: fc, effective: false, verified: true, reason: "מפתחות-הצי בכספת הם posting-בלבד (אומת-חי מול רשויות-ה-active של השרשרת) — אין-יכולת-חיול, אין-ממציאים-מפתחות", soldiersChecked: names.length };
    }
  } catch (e) {
    state.fleetChurn = { configured: fc, effective: false, verified: false, reason: `אימות-חי נכשל: ${String((e as Error)?.message ?? e).slice(0, 90)} — כבוי-בכנות`, soldiersChecked: 0 };
  }
}

// ── חתימה ושידור — אותו צינור של עורק /api/money ───────────────────

let signingCtx: { steem: any; wif: string; verified: boolean } | null = null;

function signing(): { steem: any; wif: string; verified: boolean } {
  if (signingCtx) return signingCtx;
  const wif = loadSigningWif(); // fail-closed: exit(2) אם חסר
  const nodeRequire = createRequire(path.join(HOME, "package.json"));
  const steem = nodeRequire("steem");
  steem.api.setOptions({ url: "https://api.steemit.com" });
  signingCtx = { steem, wif, verified: false };
  return signingCtx;
}

/** חוק R75 — השרשרת השופטת: הפומבי-הנגזר חייב להיאמת מול רשות-ה-active החיה. */
async function verifySigner(): Promise<void> {
  const ctx = signing();
  if (ctx.verified) return;
  const derivedPub = ctx.steem.auth.wifToPublic(ctx.wif);
  const accts = await steemRpc("condenser_api.get_accounts", [[ACCOUNT]]);
  const a = accts?.[0];
  const ok = (a?.active?.key_auths ?? []).some((k: [string, number]) => k[0] === derivedPub);
  if (!ok) throw new Error("SIGNER-MISMATCH: המפתח-מהכספת לא תואם את רשות-ה-active החיה — אפס שידור");
  ctx.verified = true;
}

/** R112 — bounded-wait: כל שידור עם דדליין; timeout ≠ כישלון — השרשרת השופטת בסקר-orderid. */
async function broadcastOp<T>(p: Promise<T>): Promise<T> {
  return await Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error("broadcast-timeout-45s")), 45_000)),
  ]);
}

async function chainCancelOrder(orderid: number): Promise<string | null> {
  const ctx = signing();
  await verifySigner();
  const res = await broadcastOp<any>(
    ctx.steem.broadcast.sendAsync(
      { extensions: [], operations: [["limit_order_cancel", { owner: ACCOUNT, orderid }]] },
      [ctx.wif],
    ),
  );
  return res?.id ?? null;
}

async function chainPlaceOrder(o: { orderid: number; side: "buy" | "sell"; amount: number; price: number; expiration: string }): Promise<string | null> {
  const ctx = signing();
  await verifySigner();
  // חוק-השרשרת (דפוס-מוכח מ-/api/money:1499): פורמט-פקיעה בדיוק-שניות, בלי מילישניות ובלי Z — אחרת "bad lexical cast"
  const expiration = o.expiration.replace(/\.\d{3}Z$/, "");
  const amountToSell = o.side === "sell" ? `${o.amount.toFixed(3)} STEEM` : `${(o.amount * o.price).toFixed(3)} SBD`;
  const minToReceive = o.side === "sell" ? `${(o.amount * o.price).toFixed(3)} SBD` : `${o.amount.toFixed(3)} STEEM`;
  const res = await broadcastOp<any>(
    ctx.steem.broadcast.sendAsync(
      {
        extensions: [],
        operations: [
          [
            "limit_order_create",
            {
              owner: ACCOUNT,
              orderid: o.orderid,
              amount_to_sell: amountToSell,
              min_to_receive: minToReceive,
              fill_or_kill: false,
              expiration,
            },
          ],
        ],
      },
      [ctx.wif],
    ),
  );
  return res?.id ?? null;
}

/** חוזה-r190 (זהה-לעורק /api/money): orderid = 1_000_000_000 + ((⌊ts/1000⌋×16 + level×2 + side) mod 500_000_000)
 *  ⇒ תמיד בתוך הטווח-השמור [1.0G, 1.5G), לנצח. הסכמה-הישנה (mod 2^31 → ~739.9M) הייתה מחזורית
 *  והפקידה פקודות מחוץ-לכל-טווח-מוכר — אלו נשכחות-לפי-חוק (לא מאומצות, לא נספרות; נמחות ע"י המוביל/פקיעה).
 *  הרישום ב-state.registry נשאר מקור-האמת לביטולים; השרשרת-עצמה שופטת (רקונסיליאציה). */
function deriveOrderid(side: "buy" | "sell", level: number): number {
  const ts = Math.floor(Date.now() / 1000);
  const raw = ts * 16 + level * 2 + (side === "sell" ? 1 : 0);
  return GRID_ORDERID_BAND_LO + (raw % 500_000_000);
}

// ── מילויים — סקר fill_order בין הבלוק-שנראה לראש ──────────────────

interface LedgerFill {
  ts: string;
  rail: "steem";
  side: "buy" | "sell";
  price: number;
  amount: number; // STEEM
  total: number; // SBD
  feeEst: number; // SBD
  internal: boolean;
  txid: string;
  pnlSbd: number; // r191: מימוש-אמיתי (0-בקנייה; FIFO-לוטות-במכירה)
  matchedSteem?: number; // r191: מכירה — כמות-שנצרכה-מלוטות
  unmatchedSteem?: number; // r191: מכירה — כמות-ללא-לוטות (מלאי-קודם-עידן-המנוע)
}

async function pollFills(): Promise<LedgerFill[]> {
  // דפדוף אחורה עד סימן-המים (limit מקסימלי = 100 לעמוד — חוק-השרשרת)
  const FILL_PAGES_MAX = 4;
  const lastSeen = state.lastFillBlock;
  const head = await steemRpc("condenser_api.get_account_history", [ACCOUNT, -1, 100]);
  if (!Array.isArray(head) || head.length === 0) return [];
  const headBlock = Number(head[head.length - 1]?.[1]?.block ?? 0);
  if (headBlock && lastSeen && headBlock <= lastSeen) return [];
  const fills: LedgerFill[] = [];
  let page: Array<[number, any]> = head;
  for (let p = 0; p < FILL_PAGES_MAX && page.length > 0; p++) {
    let minIdx = Infinity;
    let oldestBlock = Infinity;
    for (const [idx, rec] of page) {
      minIdx = Math.min(minIdx, Number(idx));
      oldestBlock = Math.min(oldestBlock, Number(rec?.block ?? 0));
      const block = Number(rec?.block ?? 0);
      if (lastSeen && block <= lastSeen) break; // הגענו למה שכבר נראה
      const [type, data] = rec.op ?? [];
      if (type !== "fill_order") continue;
      const weCurrent = data?.current_owner === ACCOUNT;
      const weOpen = data?.open_owner === ACCOUNT;
      if (!weCurrent && !weOpen) continue;
      // רק מילויים של פקודות-מרישום-שלנו — המילויים של money-mover לא שייכים לספר הזה
      // (ולכן פנקס-הלוטות-וה-PnL מתייחסים-למנוע-בלבד — היקף-כנה)
      const myOrderId = weCurrent ? Number(data.current_orderid) : Number(data.open_orderid);
      if (!state.registry[String(myOrderId)]) continue;
      const paid = weCurrent ? parseAsset(data.current_pays) : parseAsset(data.open_pays);
      const recv = weCurrent ? parseAsset(data.open_pays) : parseAsset(data.current_pays);
      let side: "buy" | "sell";
      let amount: number;
      let price: number;
      if (paid.asset === "STEEM" && recv.asset === "SBD") {
        side = "sell"; // מכרנו STEEM, קיבלנו SBD
        amount = paid.amount;
        price = paid.amount > 0 ? Math.round((recv.amount / paid.amount) * 1e6) / 1e6 : 0;
      } else if (paid.asset === "SBD" && recv.asset === "STEEM") {
        side = "buy";
        amount = recv.amount;
        price = recv.amount > 0 ? Math.round((paid.amount / recv.amount) * 1e6) / 1e6 : 0;
      } else continue;
      if (!(amount > 0) || !(price > 0)) continue;
      const total = Math.round(amount * price * 1e6) / 1e6;
      const feeEst = Math.round(total * cfg.rails.steem.feeRate * 1e6) / 1e6;
      // r191: החשבונאות-האמיתית נעשית ב-recordFill מול פנקס-הלוטות (FIFO) —
      // נוסחת-"מרחק-ממרכז-הפריסה" (מדידת-נייר-שגרמה-ל-PnL-שלילי) בוטלה. כאן-רק-מדידת-השרשרת.
      const internal = weCurrent && weOpen && data.open_owner === data.current_owner;
      fills.push({
        ts: `${String(rec.timestamp ?? "")}Z`,
        rail: "steem",
        side,
        price,
        amount,
        total,
        feeEst,
        internal,
        // מילויים-וירטואליים אין-להם trx_id — עדות-שרשרת כנה: בלוק+מיקום
        txid: String(rec?.trx_id ?? "") || `block:${block}#${rec?.op_in_trx ?? 0}`,
        pnlSbd: 0, // יושלם-ב-recordFill מול-פנקס-הלוטות
      });
    }
    // כיסוי-מלא של הפער: אם העמוד הקודם עוד לא חזר אחורה מעבר לסימן-המים — דפדוף נוסף
    if (lastSeen && oldestBlock > lastSeen && minIdx > 1) {
      page = await steemRpc("condenser_api.get_account_history", [ACCOUNT, minIdx - 1, 100]);
      if (!Array.isArray(page) || page.length === 0) break;
    } else break;
  }
  if (headBlock) state.lastFillBlock = headBlock;
  return fills;
}

function recordFill(f: LedgerFill) {
  // חשבונאות-r191 (FIFO-לוטות): קנייה פותחת-לוט-במחיר-המילוי; מכירה צורכת-לוטות-FIFO
  // ומממשת PnL אמיתי = Σ(מחיר-מכירה − עלות-לוט)×כמות − עמלה-מוערכת-יחסית.
  if (f.side === "buy") {
    state.lots.push({ steem: f.amount, costSbdPerSteem: f.price, openedAt: f.ts });
    f.pnlSbd = 0; // קנייה אינה-מממשת — רק-פותחת-לוט (העמלה-נצרפת-בחשבון-המכירה-הנגדית)
  } else {
    let need = f.amount;
    let matched = 0;
    let gain = 0;
    for (const lot of state.lots) {
      if (need <= 1e-9) break;
      const take = Math.min(lot.steem, need);
      if (!(take > 0)) continue;
      gain += (f.price - lot.costSbdPerSteem) * take;
      lot.steem = Math.round((lot.steem - take) * 1e6) / 1e6;
      need = Math.round((need - take) * 1e6) / 1e6;
      matched = Math.round((matched + take) * 1e6) / 1e6;
    }
    state.lots = state.lots.filter((l) => l.steem > 1e-6); // לוטות-מרוקנות נזרקות
    const feeMatched = Math.round(f.feeEst * (f.amount > 0 ? matched / f.amount : 0) * 1e6) / 1e6;
    f.pnlSbd = Math.round((gain - feeMatched) * 1e6) / 1e6;
    f.matchedSteem = matched;
    f.unmatchedSteem = Math.round((f.amount - matched) * 1e6) / 1e6;
    if (f.unmatchedSteem > 0) {
      // מלאי-שקדם-לעידן-המנוע (אין-לוטות) — מחוץ-להיקף-ה-PnL-הממומש (היקף-כנה), נספר-לנראות
      state.unmatchedSellSteem = Math.round((state.unmatchedSellSteem + f.unmatchedSteem) * 1e6) / 1e6;
      state.unmatchedSellSbd = Math.round((state.unmatchedSellSbd + f.unmatchedSteem * f.price) * 1e6) / 1e6;
    }
  }
  appendJsonl(LEDGER_FILE, f); // ראיה-כנה אחרי-החשבונאות: pnlSbd = מימוש-אמיתי
  state.fillsSeen += 1;
  state.fills24h += 1;
  state.volume24hSteem = Math.round((state.volume24hSteem + f.amount) * 1e6) / 1e6;
  state.volume24hSbd = Math.round((state.volume24hSbd + f.total) * 1e6) / 1e6;
  state.realizedPnlSbd = Math.round((state.realizedPnlSbd + f.pnlSbd) * 1e6) / 1e6;
  state.dailyPnlSbd = Math.round((state.dailyPnlSbd + f.pnlSbd) * 1e6) / 1e6;
  if (f.internal) state.internalFills += 1;
  refreshLotAggregates();
}

// ── בניית-הסולם ─────────────────────────────────────────────────────

interface PlannedOrder {
  side: "buy" | "sell";
  level: number;
  price: number;
  amount: number; // STEEM
  total: number; // SBD
}

function planLadder(center: number, steemFree: number, sbdFree: number, l3: { spreadBps: number; minNotionalUsd: number; centerSource: string }): { planned: PlannedOrder[]; note: string; guardBasis: "basis" | "no-lots"; floor: number | null; notionalCut: number } {
  const c = cfg.rails.steem;
  const half = l3.spreadBps / 2;
  const minNotional = typeof l3.minNotionalUsd === "number" && l3.minNotionalUsd > 0 ? l3.minNotionalUsd : 0;
  const steemBudget = steemFree * c.budgetPct; // חוק-אחוות-הסוחרים: יתרה-חופשית בלבד
  const sbdBudget = sbdFree * c.budgetPct;
  // חוק-רווחיות r191: רצפת-מכירה = בסיס-ממוצע × (1+minProfitBps/10000); minProfitBps חייב-לעלות
  // על העמלה-המוערכת (75bps). אין-לוטות (בסיס-null) ⇒ סימטריה-כמו-בעבר (guardBasis:"no-lots").
  const minProfitBps = typeof c.minProfitBps === "number" && Number.isFinite(c.minProfitBps) && c.minProfitBps > 0 ? c.minProfitBps : DEFAULT_MIN_PROFIT_BPS;
  const basis = state.basisBlendedSbd;
  const floor = basis != null && basis > 0 ? Math.round(basis * (1 + minProfitBps / 10_000) * 1e6) / 1e6 : null;
  const guardBasis: "basis" | "no-lots" = floor != null ? "basis" : "no-lots";
  const planned: PlannedOrder[] = [];
  let trimmed = 0;
  let notionalCut = 0; // חוק-L3: רמות-שנחתכו-מתחת-רצפת-הנוטיונל — נמדדות-ומדווחות-בכנות
  // מחירי-הסולם-הסימטריים-סביב-המרכז (r192: המרכז = מחיר-הפיד כשסולם-הפאריטה-דלוק) — ואז-הזחות-כנות:
  //   מכירות-מוזחות-למעלה עד-שהרמה-הנמוכה-מגיעה-לרצפה (לעולם-לא-מטה); קניות-מוזחות-למטה
  //   עד-שהרמה-הגבוהה-מגיעה-לבסיס (ממוצע-מטה-מותר — קנייה-מעל-הבסיס-אסור).
  const symSell: number[] = [];
  const symBuy: number[] = [];
  for (let i = 0; i < c.gridLevels; i++) {
    const offsetBps = half + i * c.levelSpacingBps;
    symSell.push(center * (1 + offsetBps / 10_000));
    symBuy.push(center * (1 - offsetBps / 10_000));
  }
  // תיקון-r192-a (חוק-רווחיות r191, כפי-שנכתב-בהערה): הזחת-המכירות-למעלה נמדדת-מול הרמה-הנמוכה
  //  (symSell[0] = המכירה-הקרובה-למרכז — המחיר-הנמוך-ביותר של-הסולם). הקודם (symSell[last] —
  //  הרמה-הגבוהה) היה-משאיר-רמות-תחתונות-מתחת-לרצפה כשהרצפה-נופלת-בין-הרמות ⇒ profit-guard
  //  היה-מחליף-אותן-בכל-פעימה (churn-שידורים). אחרי-התיקון: הרמה-הנמוכה = הרצפה בדיוק —
  //  כל-הסולם מעל-הרצפה, לעולם-לא-מטה.
  const sellShift = floor != null && symSell.length > 0 ? Math.max(0, floor - symSell[0]) : 0;
  const buyShift = basis != null && symBuy.length > 0 ? Math.max(0, symBuy[0] - basis) : 0;
  for (let i = 0; i < c.gridLevels; i++) {
    // מכירה מעל המרכז — התקציב ב-STEEM
    let sellAmt = Math.min(steemBudget / c.gridLevels, c.orderCap);
    if (sellAmt >= c.minOrder && sellAmt <= steemBudget) {
      const price = Math.round((symSell[i] + sellShift) * 1e6) / 1e6;
      const total = Math.round(sellAmt * price * 1000) / 1000;
      if (minNotional > 0 && total < minNotional) {
        notionalCut++; // חוק-L3: רצפת-נוטיונל — הדלק-לא-מספיק לרמה-הזאת
      } else {
        planned.push({ side: "sell", level: i + 1, price, amount: Math.round(sellAmt * 1000) / 1000, total });
      }
    } else trimmed++;
    // קנייה מתחת למרכז — התקציב ב-SBD
    const price = Math.round((symBuy[i] - buyShift) * 1e6) / 1e6;
    if (!(price > 0)) {
      trimmed++; // רצפה-גבוהה-מהסולם — אין-מחיר-קנייה-חוקי (כנות: הרמה-נחתכת)
      continue;
    }
    let buyAmt = Math.round(Math.min(sbdBudget / c.gridLevels / price, c.orderCap) * 1000) / 1000;
    if (buyAmt >= c.minOrder && buyAmt * price <= sbdBudget) {
      const total = Math.round(buyAmt * price * 1000) / 1000;
      if (minNotional > 0 && total < minNotional) {
        notionalCut++; // חוק-L3: רצפת-נוטיונל — הדלק-לא-מספיק לרמה-הזאת
      } else {
        planned.push({ side: "buy", level: i + 1, price, amount: buyAmt, total });
      }
    } else trimmed++;
  }
  const guardNote =
    floor != null
      ? `guardBasis: basis ${basis!.toFixed(6)} · רצפה ${floor.toFixed(6)} (+${minProfitBps}bps מעל-הבסיס) · הזחת-מכירות ${Math.round((sellShift / center) * 10_000)}bps · הזחת-קניות ${Math.round((buyShift / center) * 10_000)}bps`
      : "guardBasis: no-lots — אין-לוטות, סימטריה-מלאה-סביב-המרכז";
  const l3Note = `מרכז ${center.toFixed(6)} (${l3.centerSource}) · ספרד-אפקטיבית ${l3.spreadBps}bps${minNotional > 0 ? ` · רצפת-נוטיונל L3 $${minNotional}` : ""}`;
  const note =
    trimmed > 0 || notionalCut > 0
      ? `${trimmed} רמות נחתכו בכנות (תקציב-צד/תקרת-פקודה/מינימום) · ${notionalCut} רמות-מתחת-רצפת-הנוטיונל L3 (תקציב ${steemBudget.toFixed(3)} STEEM / ${sbdBudget.toFixed(3)} SBD) · ${l3Note} · ${guardNote}`
      : `תקציב ${steemBudget.toFixed(3)} STEEM / ${sbdBudget.toFixed(3)} SBD × ${c.budgetPct} · ${l3Note} · ${guardNote}`;
  return { planned, note, guardBasis, floor, notionalCut };
}

// ── פעימה ───────────────────────────────────────────────────────────

let ticking = false;
let tickStartedAt = 0;

async function tick(): Promise<{ ok: boolean; detail: string }> {
  if (ticking) return { ok: false, detail: "פעימה-בטיסה" };
  ticking = true;
  tickStartedAt = Date.now();
  try {
    state.ticks += 1;
    state.killSwitch = fs.existsSync(KILL_FILE);
    // r197 — חוק-העצירה והחשיבה (הוראת-המפעיל): PAUSED → אין פריסה/גרירה/שימוש-בחיילים בגריד.
    // המדידה חיה וההחלטה כנה — הכסף קפוא עד שהשער נפתח. THINKING → פריסה רק עם דיון (בהמשך הפעימה).
    const gateNow = readGate();
    state.autonomy = gateNow.mode; // r199: מצב-השער חי בקובץ-המצב בכל פעימה — לפני כל הסתעפות
    if (gateNow.mode === "PAUSED") {
      decision("AUTONOMY-PAUSED", `שער-העצירה סגור — אין פריסה/ביטול/שימוש-בחיילים בגריד · ${gateNow.reason.slice(0, 100)}`);
      state.fleetChurn = { configured: cfg.rails.steem.fleetChurn, effective: false, verified: false, reason: "שימוש-בחיילים כבוי — חוק-העצירה r197 (PAUSED)", soldiersChecked: 0 };
      saveState();
      return { ok: false, detail: "autonomy-paused" };
    }
    // גלגול-יום: מוני-היום מתאפסים בחצות-UTC
    if (state.pnlDay !== utcDay()) {
      state.pnlDay = utcDay();
      state.dailyPnlSbd = 0;
    }
    // היפוך-עצמי מהפסק: רק איפוס-תצורה (mtime חדש של config.json) מקים מחדש
    if (state.halted && state.haltedConfigMtimeMs != null) {
      const mt = fs.existsSync(CONFIG_FILE) ? fs.statSync(CONFIG_FILE).mtimeMs : null;
      if (mt != null && mt > state.haltedConfigMtimeMs) {
        state.halted = false;
        state.haltedAt = null;
        state.haltedConfigMtimeMs = null;
        decision("UNHALTED", "התצורה אופסה מאז-העצירה — המנוע חוזר לעבוד (החלטת-מפעיל נמדדה מ-mtime)");
      }
    }
    if (gateNow.mode === "THINKING") {
      state.fleetChurn = { configured: cfg.rails.steem.fleetChurn, effective: false, verified: false, reason: "THINKING — שימוש-בחיילים בגריד דורש דיון מלא ואישור; לא בשימוש (חוק-r197)", soldiersChecked: 0 };
    } else {
      await fleetVerify();
    }

    const c = cfg.rails.steem;
    if (!c.enabled) {
      decision("RAIL-DISABLED", "מסילת-STEEM כבויה בתצורה");
      saveState();
      return { ok: false, detail: "מסילה-כבויה" };
    }
    // חוק-בטיחות: התצורה לעולם לא מעירה live לבדה — אחרי עלייה-קרה נדרש POST /mode ידני

    // מילויים — קודם-כול: עבודה שנעשתה נספרת לפני החלטות חדשות
    try {
      const fills = await pollFills();
      for (const f of fills) recordFill(f);
      if (fills.length > 0) {
        const batchPnl = Math.round(fills.reduce((s, x) => s + x.pnlSbd, 0) * 1e6) / 1e6;
        decision("FILLS", `${fills.length} מילויים חדשים נספרו מהשרשרת (Σ24ש' volume ${state.volume24hSbd.toFixed(3)} SBD · PnL-ממומש-באצווה ${batchPnl >= 0 ? "+" : ""}${batchPnl.toFixed(3)} SBD · לוטות ${state.lotsCount} · בסיס ${state.basisBlendedSbd != null ? state.basisBlendedSbd.toFixed(6) : "אין"})`);
      }
      // חוק-chain-truth (r190): פקודה-חיה-בטווח-השמור שאינה-ברישום = שלנו-ששודרה-חי-מלכתחילה ⇒ מאומצת
      const { ours } = await ourOpenOrders();
      const liveIds = new Set(ours.map((o) => o.orderid));
      let adoptedTick = 0;
      for (const o of ours) {
        if (!inGridBand(o.orderid) || state.registry[String(o.orderid)]) continue;
        state.registry[String(o.orderid)] = adoptChainOrder(o, state.centerPrice);
        adoptedTick += 1;
      }
      // כילוי-רישום: פקודה שנמחקה מהשרשרת כבר לא פתוחה; מחוץ-לטווח = סכמה-ישנה — נשכחת
      for (const reg of Object.values(state.registry)) {
        if (!inGridBand(reg.orderid)) {
          delete state.registry[String(reg.orderid)];
          continue;
        }
        if (reg.dry) continue; // פקודות-יבשה לא חיות על השרשרת — נכחדות רק בגרירה/תפוגה/החלפה
        if (!liveIds.has(reg.orderid)) {
          delete state.registry[String(reg.orderid)];
        }
      }
      if (adoptedTick > 0) decision("ADOPTED", `${adoptedTick} פקודות-חיות-בטווח אומצו מהשרשרת לרישום (chain-truth — השרשרת שופטת)`);
      state.openOrders = Object.values(state.registry).sort((a, b) => b.price - a.price);
      state.coordination.ourOrders = ours.filter((o) => state.registry[String(o.orderid)]).length;
      state.coordination.moverOrders = ours.length - state.coordination.ourOrders;
      state.lastError = null; // המדידה חזרה לעבוד — השגיאה-הישנה לא תישאר תלויה כנגד האמת
    } catch (e) {
      state.lastError = `fills/orders: ${String((e as Error)?.message ?? e).slice(0, 120)}`;
    }

    // מיד ויתרות
    const { mid, bestBid, bestAsk, skew, bidDepthSbd, askDepthSbd } = await bookState();
    const bal = await balances();
    state.balances = { steemFree: bal.steemFree, sbdFree: bal.sbdFree, measuredAt: new Date().toISOString() };
    state.centerPrice = mid;
    refreshLotAggregates(); // סימון-לשוק r191: בסיס+unrealizedPnlSbd מתעדכנים-בכל-פעימה-שהמרכז-נמדד
    state.spreadBps = Math.round(((bestAsk - bestBid) / mid) * 10_000);
    // חוק-L3 (r192): פרמטרי-ספרד-דינמיים + מרכז-פאריטה — רק-כשהדגל-דלוק; פיד-נפל ⇒ נפילה-כנה-למרכז-הספר
    const l3p = c.parityLadder ? l3Params(c, skew) : null;
    const feed = c.parityLadder ? await feedPrice() : null;
    state.parityCenterSbd = feed?.sbdPerSteem ?? null;
    state.centerSource = c.parityLadder ? (feed ? "feed" : "book") : null;
    state.l3 = l3p ? { feeFloorBps: l3p.feeFloorBps, spreadBpsEffective: l3p.spreadBps, widened: l3p.widened, skew, halted: l3p.halted, bidDepthSbd, askDepthSbd } : null;
    const centerNow = c.parityLadder ? (feed?.sbdPerSteem ?? mid) : mid; // מרכז-הסולם-בפעימה-הזאת
    state.lastTick = new Date().toISOString();

    // שערים-קשים לפני פריסה
    if (state.halted) {
      decision("HALTED", `המנוע עצור-עצמית (אובדן-יומי ${state.dailyPnlSbd.toFixed(3)} SBD מול תקרה ${cfg.dailyLossCapSbd}) — רק איפוס-תצורה מקים`);
      saveState();
      return { ok: false, detail: "halted" };
    }
    if (state.killSwitch) {
      decision("KILL-SWITCH", "קובץ-ההרג קיים (~/.sovereign/mm-kill) — אפס פריסות; מדידה-בלבד");
      saveState();
      return { ok: true, detail: "kill-switch" };
    }
    if (cfg.dailyLossCapSbd > 0 && state.pnlDay === utcDay() && state.dailyPnlSbd <= -cfg.dailyLossCapSbd) {
      state.halted = true;
      state.haltedAt = new Date().toISOString();
      state.haltedConfigMtimeMs = fs.existsSync(CONFIG_FILE) ? fs.statSync(CONFIG_FILE).mtimeMs : null;
      appendJsonl(DRY_LOG, { ts: new Date().toISOString(), mode: state.mode, rail: "steem", action: "HALT", note: `תקרת-אובדן-יומי נחצה: ${state.dailyPnlSbd.toFixed(3)} ≤ −${cfg.dailyLossCapSbd} SBD — המנוע עצר את עצמו עד איפוס-תצורה` });
      decision("SELF-HALT", `אובדן-יומי ${state.dailyPnlSbd.toFixed(3)} SBD חצה את התקרה (${cfg.dailyLossCapSbd}) — עצירה-עצמית עד איפוס-תצורה`);
      saveState();
      return { ok: false, detail: "self-halt" };
    }
    if (state.mode === "live" && moverActing()) {
      state.coordination.moverActing = true;
      decision("YIELD-MOVER", "money-mover באמצע-פעולה (acting=true) — הפעימה מדלגת על פריסה (אין-שני-שידורים-במקביל על אותו חשבון)");
      saveState();
      return { ok: true, detail: "yield-to-mover" };
    }
    state.coordination.moverActing = false;

    // חוק-L3 (r192): השהייה על-skew>60% — הספר משופע-קיצונית; אפס-פריסה/ביטול עד-התייצבות
    if (l3p?.halted) {
      decision("L3-SKEW-HALT", `skew ${skew} חורג-מסף-ההשהיה ${c.skewHaltAt} (עומק בידים ${bidDepthSbd} SBD מול אסקים ${askDepthSbd} SBD) — אפס-פעולת-ספר בפעימה (חוק-L3)`);
      saveState();
      return { ok: true, detail: "l3-skew-halt" };
    }

    // חוק-רווחיות r191: ניטור-רצפה על-הסולם-החי — מכירה-חיה-מתחת-לרצפה = הצעת-הפסד-מובטח
    // שיושבת-בספר ⇒ חייבת-החלפה. הרצפה = בסיס×(1+minProfitBps/10000); אין-לוטות ⇒ no-lots.
    const minProfitBps = typeof c.minProfitBps === "number" && Number.isFinite(c.minProfitBps) && c.minProfitBps > 0 ? c.minProfitBps : DEFAULT_MIN_PROFIT_BPS;
    const guardFloor = state.basisBlendedSbd != null && state.basisBlendedSbd > 0 ? Math.round(state.basisBlendedSbd * (1 + minProfitBps / 10_000) * 1e6) / 1e6 : null;
    const sellsUnderFloor = guardFloor != null ? state.openOrders.filter((o) => o.side === "sell" && o.price < guardFloor) : [];
    state.profitGuard = { minProfitBps, basis: state.basisBlendedSbd, floor: guardFloor, guardBasis: guardFloor != null ? "basis" : "no-lots", sellsUnderFloor: sellsUnderFloor.length, updatedAt: new Date().toISOString() };

    // סטיית-מרכז: הקו זז מעל 2×מרווח מאז-הפריסה ⇒ גרירת-הסולם (r192: המדידה-מול-מרכז-הפאריטה-החי)
    const placedCenter = state.openOrders.length > 0 ? state.openOrders.reduce((s, o) => s + o.centerAtPlace, 0) / state.openOrders.length : null;
    const driftBps = placedCenter != null && placedCenter > 0 ? Math.round(((centerNow - placedCenter) / placedCenter) * 10_000) : 0;
    const needRecenter = placedCenter != null && Math.abs(driftBps) > 2 * cfg.rails.steem.levelSpacingBps;

    // פקודות-ישנות מעבר ל-refreshHours ⇒ גרירה
    const now = Date.now();
    const stale = state.openOrders.filter((o) => (now - new Date(o.placedAt).getTime()) > cfg.rails.steem.refreshHours * 3_600_000);
    // חוק-אמת-r189: מצב-חי עם פקודות-וירטואליות = הסולם מעולם לא שודר — חובה-פריסה-חיה
    const virtualInLive = state.mode === "live" ? state.openOrders.filter((o) => o.dry).length : 0;
    const reason =
      virtualInLive > 0
        ? `מעבר-dry→live: ${virtualInLive} פקודות-וירטואליות-יבשה מוחלפות בפריסה-חיה על-השרשרת`
        : state.openOrders.length === 0
          ? "סולם-ריק — פריסה-ראשונה"
          : sellsUnderFloor.length > 0
            ? `profit-guard: ${sellsUnderFloor.length} מכירות-חיות מתחת-לרצפה ${guardFloor!.toFixed(6)} (בסיס ${state.basisBlendedSbd!.toFixed(6)}) — ביטול+פריסה-מעל-הרצפה, אין-הצעות-הפסד-מובטח`
            : needRecenter
              ? `המרכז זז ${driftBps > 0 ? "+" : ""}${driftBps}bps מאז-הפריסה (${placedCenter!.toFixed(6)} → ${centerNow.toFixed(6)}) — ביטול+פריסה-מחדש`
              : stale.length > 0
                ? `${stale.length} פקודות ישנות מעבר ל-${cfg.rails.steem.refreshHours}ש' — גרירה`
                : null;

    if (!reason) {
      decision("ON-GRID", `הסולם על הקו: ${state.openOrders.length} פקודות · drift ${driftBps}bps · מרכז ${centerNow.toFixed(6)} (${state.centerSource ?? "book"}${c.parityLadder ? `/פיד-רצפת-עמלה ${l3p!.feeFloorBps}bps` : ""}) · רצפת-רווחיות ${guardFloor != null ? guardFloor.toFixed(6) : "no-lots"} · תקציב ${bal.sbdFree.toFixed(3)} SBD חופשיים`);
      saveState();
      return { ok: true, detail: "on-grid" };
    }

    // תכנון-הסולם החדש (r192: מרכז-פאריטה + ספרד-L3 + רצפת-נוטיונל)
    const { planned, note } = planLadder(centerNow, bal.steemFree, bal.sbdFree, { spreadBps: l3p ? l3p.spreadBps : c.spreadBps, minNotionalUsd: c.minNotionalUsd, centerSource: state.centerSource ?? "book" });
    if (planned.length === 0) {
      decision("NO-BUDGET", `אין-מה-לפרוס: ${note}`);
      saveState();
      return { ok: true, detail: "no-budget" };
    }

    if (state.mode === "dry") {
      // DRY — מחשב-הכול, רושם-הכול, משדר-כלום. פקודות-יבשה חיות ברישום-וירטואלי
      // (dry:true) — כך נמדדים-חי גם סטיית-המרכז והגרירה והתפוגה, בדיוק
      // כמו ב-live, בלי אף-שידור. פקודות-חיות-אמיתיות (מסש-live קודם) לא נוגעות-כאן.
      const virtualOld = state.openOrders.filter((o) => o.dry);
      for (const o of virtualOld) {
        dryLog({ action: "cancel", side: o.side, level: o.level, price: o.price, amount: o.amount, total: o.total, orderid: o.orderid, note: reason });
        delete state.registry[String(o.orderid)];
      }
      const expiration = new Date(now + cfg.rails.steem.refreshHours * 3_600_000).toISOString();
      for (const o of planned) {
        const orderid = deriveOrderid(o.side, o.level);
        state.registry[String(orderid)] = { orderid, side: o.side, level: o.level, price: o.price, amount: o.amount, total: o.total, placedAt: new Date(now).toISOString(), expiration, centerAtPlace: centerNow, txid: null, dry: true };
        dryLog({ action: "place", side: o.side, level: o.level, price: o.price, amount: o.amount, total: o.total, orderid, expiration, note });
      }
      state.openOrders = Object.values(state.registry).sort((a, b) => b.price - a.price);
      decision("DRY-LADDER", `DRY: ${planned.length} פקודות (${reason}) — ${note} · אפס-שידור`);
      saveState();
      return { ok: true, detail: `dry:${planned.length}` };
    }

    // r197 — THINKING: פריסה-חיה רצה רק עם דיון מלא שנכתב לפני (מה/למה/צפי/סיכון/רולבק)
    if (gateNow.mode === "THINKING") {
      try {
        appendDeliberation({
          action: "grid-place", actor: "market-maker",
          claim: `לפרוס סולם-חי ${planned.length} פקודות על SBD/STEEM (${reason.slice(0, 80)})`,
          why: `מרכז ${centerNow.toFixed(6)} נמדד מ-${state.centerSource ?? "book"}; תקציב ${bal.sbdFree.toFixed(3)} SBD`,
          expected: `ספר חי דו-צדדי סביב הפאריטה; מילויים עם PnL-חיובי מעל רצפת-הרווחיות`,
          risk: `שחיקת-ספר בסטייה; תקרת-אובדן-יומי ${cfg.dailyLossCapSbd} SBD + רצפת-ערך + ספרד-L3 חוסמים`,
          rollback: `cancel-all זמין; רישום-הפקודות ב-registry עם txids לראיה`,
        });
      } catch { /* רישום-דיון לא מפיל את הפעימה */ }
      const avPlace = autonomyVerdict("grid-place", "market-maker");
      if (!avPlace.allowed) {
        decision("AUTONOMY-HELD", avPlace.why);
        saveState();
        return { ok: false, detail: "autonomy-held" };
      }
    }

    // LIVE — ביטול-ישן (רק-רישום-שלנו) ואז פריסה
    let cancelled = 0;
    for (const o of state.openOrders) {
      if (o.dry) {
        delete state.registry[String(o.orderid)]; // פקודה-וירטואלית — מעולם לא הייתה על השרשרת, אין-מה-לבטל
        continue;
      }
      try {
        const txid = await chainCancelOrder(o.orderid);
        delete state.registry[String(o.orderid)];
        cancelled += 1;
        console.log(`[market-maker] cancel ${o.orderid} txid=${txid ?? "chain-judge"}`);
      } catch (e) {
        state.lastError = `cancel ${o.orderid}: ${String((e as Error)?.message ?? e).slice(0, 100)}`;
      }
    }
    let placed = 0;
    const expiration = new Date(now + cfg.rails.steem.refreshHours * 3_600_000).toISOString();
    for (const o of planned) {
      const orderid = deriveOrderid(o.side, o.level);
      try {
        const txid = await chainPlaceOrder({ orderid, side: o.side, amount: o.amount, price: o.price, expiration });
        state.registry[String(orderid)] = { orderid, side: o.side, level: o.level, price: o.price, amount: o.amount, total: o.total, placedAt: new Date().toISOString(), expiration, centerAtPlace: centerNow, txid, dry: false };
        placed += 1;
        console.log(`[market-maker] place ${o.side} L${o.level} ${o.amount}STEEM @${o.price} orderid=${orderid} txid=${txid ?? "chain-judge"}`);
      } catch (e) {
        state.lastError = `place ${o.side} L${o.level}: ${String((e as Error)?.message ?? e).slice(0, 100)}`;
      }
    }
    state.openOrders = Object.values(state.registry).sort((a, b) => b.price - a.price);
    decision("LIVE-LADDER", `LIVE: בוטלו ${cancelled}, הוצבו ${placed}/${planned.length} · ${reason} · ${note}`);
    saveState();
    return { ok: placed > 0, detail: `live:${placed}` };
  } catch (e: any) {
    state.lastError = String(e?.message ?? e).slice(0, 160);
    decision("ERROR", state.lastError);
    saveState();
    return { ok: false, detail: state.lastError };
  } finally {
    ticking = false;
  }
}

// ── שרת-HTTP יחיד חוצה-דורות (חוק weblift/R124) ────────────────────

const G_MM_SRV = globalThis as unknown as { __MM_SERVER__?: unknown };
if (!G_MM_SRV.__MM_SERVER__) {
  G_MM_SRV.__MM_SERVER__ = Bun.serve({
    port: PORT,
    hostname: "127.0.0.1", // פקודות-מסחר מ-localhost בלבד (חוק R123)
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/health") {
        return Response.json({ ok: true, service: "market-maker", port: PORT, now: new Date().toISOString() });
      }
      if (url.pathname === "/status") {
        state.killSwitch = fs.existsSync(KILL_FILE);
        return Response.json({
          ok: true,
          service: "market-maker",
          port: PORT,
          state,
          l3: { parityLadder: cfg.rails.steem.parityLadder, ...state.l3 },
          parity: { centerSbd: state.parityCenterSbd, source: state.centerSource },
          hiveBand: { lo: HIVE_GRID_ORDERID_BAND_LO, hi: HIVE_GRID_ORDERID_BAND_HI, enabled: cfg.rails.hive.enabled, note: HIVE_RAIL_NOTE },
          config: { rails: cfg.rails, dailyLossCapSbd: cfg.dailyLossCapSbd, tickSec: cfg.tickSec, _docs: cfg._docs },
          orderIdBand: { schema: "r190", lo: GRID_ORDERID_BAND_LO, hi: GRID_ORDERID_BAND_HI, registryInBand: Object.values(state.registry).filter((o) => inGridBand(o.orderid)).length },
          persistence: { stateFile: STATE_FILE, mtimeMs: fs.existsSync(STATE_FILE) ? fs.statSync(STATE_FILE).mtimeMs : null },
          now: new Date().toISOString(),
        });
      }
      if (url.pathname === "/tick" && req.method === "POST") {
        const r = await tick();
        return Response.json({ ok: r.ok, detail: r.detail, state }, { status: r.ok ? 200 : 503 });
      }
      if (url.pathname === "/mode" && req.method === "POST") {
        const body = await req.json().catch(() => ({}));
        const target = body?.mode;
        if (target !== "dry" && target !== "live") {
          return Response.json({ ok: false, error: "mode חייב להיות dry או live" }, { status: 400 });
        }
        state.killSwitch = fs.existsSync(KILL_FILE);
        if (target === "live") {
          if (state.killSwitch) {
            return Response.json({ ok: false, error: "קובץ-ההרג קיים (~/.sovereign/mm-kill) — מעבר-ל-live נסרב עד הסרתו" }, { status: 423 });
          }
          if (state.halted) {
            return Response.json({ ok: false, error: "המנוע עצור-עצמית (תקרת-אובדן) — רק איפוס-תצורה מחזיר" }, { status: 423 });
          }
          if (!fs.existsSync(path.join(VAULT, "secrets", "STEEM_ACTIVE_WIF"))) {
            return Response.json({ ok: false, error: "STEEM_ACTIVE_WIF לא בכספת — fail-closed, אין-חתימה, אין-מעבר-ל-live" }, { status: 409 });
          }
        }
        const from = state.mode;
        state.mode = target;
        cfg.rails.steem.mode = target; // התצורה משקפת את המצב החי
        writeJsonAtomic(CONFIG_FILE, cfg);
        state.lastModeChange = { at: new Date().toISOString(), from, to: target, by: "operator:/mode" };
        decision("MODE-CHANGE", `המצב עבר מ-${from} ל-${target}${target === "live" ? " — הסולם הבא ישודר לשרשרת" : " — אפס-שידור מעתה"}`);
        saveState();
        return Response.json({ ok: true, mode: state.mode, from, to: target });
      }
      return new Response("not found", { status: 404 });
    },
  });
}

// ── רקונסיליאציה-בעלייה — chain-truth לפני-הטיימר (r190; תיקון-שורש ל-r189-c) ──
try {
  await reconcileOnBoot();
} catch (e) {
  // כשל-רקונסיליאציה לא משאיר עלייה-שקטה: נרשם בכנות, המנוע ממשיך dry על רישום-הקובץ
  console.error(`[market-maker] רקונסיליאציה-בעלייה נכשלה — כנות: ${String((e as Error)?.message ?? e)}`);
  try {
    decision("BOOT-RECONCILE-ERROR", String((e as Error)?.message ?? e).slice(0, 120));
  } catch {
    /* הלוג-לעולם לא חוסם */
  }
}

// ── טיימר-יחיד (חוק R111) + שומר-פעימה (R112) — אתחול-אידמפוטנטי-מוגן (לקח r189-c) ──

const G = globalThis as unknown as { __MM_TIMER__?: ReturnType<typeof setInterval>; __MM_TIMER_GEN__?: number };
if (G.__MM_TIMER__) {
  clearInterval(G.__MM_TIMER__);
  G.__MM_TIMER_GEN__ = (G.__MM_TIMER_GEN__ ?? 0) + 1;
  console.log(`[market-maker] טיימר-קודם-נמצא (דור-חם #${G.__MM_TIMER_GEN__}) — הוחלף-אידמפוטנטית; רק-טיימר-אחד-חי`);
}
const TICK_INTERVAL_MS = Math.max(30, cfg.tickSec || TICK_SEC) * 1000;
try {
  G.__MM_TIMER__ = setInterval(() => {
    try {
      const nowMs = Date.now();
      if (ticking && tickStartedAt && nowMs - tickStartedAt > TICK_MAX_MS) {
        ticking = false;
        console.log(`[market-maker] שומר-פעימה: tick נעול >${Math.round(TICK_MAX_MS / 60_000)} דק' — שוחרר בכנות (כל-ה-fetches deadline-bound)`);
      }
      void tick();
    } catch (e) {
      // פעימה-שנפלה לא משאירה טיימר-מת-בשקט: הכישלון נרשם והטיימר-ממשיך
      console.error(`[market-maker] שגיאת-פעימה (${String((e as Error)?.message ?? e)}) — הטיימר-חי; הפעימה-הבאה-ממשיכה`);
    }
  }, TICK_INTERVAL_MS);
  console.log(`[market-maker] טיימר-חי: פעימה כל ${Math.round(TICK_INTERVAL_MS / 1000)}ש'`);
} catch (e) {
  console.error(`[market-maker] אתחול-טיימר נכשל — כנות: ${String((e as Error)?.message ?? e)} (אין-טיימר-מת-שקט)`);
}

// r143-c — מתג-איש-מת: שתיקת-פעימות מעל 15 דק' ⇒ יציאה לתחייה (fleet-guard יקים)
try {
  installDeadManWatch({
    id: "market-maker",
    lastMs: () => (state.lastTick ? new Date(state.lastTick).getTime() : state.bootedAt ? new Date(state.bootedAt).getTime() : 0),
    stallMs: 15 * 60_000,
    logFile: `${HOME}/sovereign/keeper/logs/market-maker-daemon.log`,
  });
} catch (e) {
  console.error(`[market-maker] אתחול-מתג-איש-מת נכשל — כנות: ${String((e as Error)?.message ?? e)}`);
}

saveState();
console.log(`[market-maker] חי על פורט ${PORT} · mode=${state.mode} (dry=ברירת-מחדל, live רק ב-POST /mode) · רגל-HIVE: ${HIVE_RAIL_NOTE}`);
// חוק-בטיחות כנה: תצורה שמבקשת live אחרי עלייה-קרה לא מעירה שידורים לבדה —
// המנוע עולה dry ומדווח שנדרשת החלטת-מפעיל חיה (POST /mode)
if (cfg.rails.steem.mode === "live" && state.mode === "dry") {
  decision("COLD-BOOT-SAFE", "התצורה מבקשת live אך עלייה-קרה תמיד עולה dry — נדרש POST /mode {\"mode\":\"live\"} מהמפעיל");
}
void tick();
