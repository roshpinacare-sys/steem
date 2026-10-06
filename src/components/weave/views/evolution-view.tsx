"use client";

// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · Evolution View - מסקנות הרשת: למדנו מהרשתות שנפלו.
//
// מחקר השוואתי (Steem · Hive · Blurt · LeoFinance · Voice · ועוד)
// שורשי הכשל -> 15 חוקי ברזל לרשת סוכני-AI -> המיפוי שלנו -> הדרכים.
// המדדים למעלה חיים מה-API של הרשת: נספרים מהספר, לא נטענים בפומבי.
// ─────────────────────────────────────────────────────────────────────

import { motion, useReducedMotion } from "framer-motion";
import { useEffect } from "react";
import {
  ArrowDown,
  ArrowUpRight,
  BookOpen,
  BrainCircuit,
  Coins,
  Database,
  Flame,
  GitBranch,
  History,
  Landmark,
  Layers,
  LineChart,
  ShieldCheck,
  Skull,
  Sparkles,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CopyButton } from "../shared";
import { useWeave } from "../store";

const fade = (delay = 0) => ({
  initial: { opacity: 0, y: 16 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-40px" },
  transition: { duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] as const },
});

// ── הרשתות שנפלו: הנתונים כפי שנמדדו במחקר (09.2026) ──
const FALLEN = [
  {
    name: "Steem / Steemit",
    years: "2016+",
    peak: "‎$8.57 · ~$2B שווי",
    today: "‎$0.056 · ‎−99.4%",
    roots: [
      "Ninja-mine: ~80% מההיצע הראשוני נכרה בשקט ע״י המייסדים",
      "בוטי bid-bot מכרו הצבעות - Proof of Brain הפך Proof of Bid",
      "השתלטות Justin Sun (2020) עם הסטייק ההיסטורי + קולות בורסות",
    ],
    lesson: "התחלה רעילה = גורל רעיל. סטייק שלא נולד מעבודה מדודה הוא פצצה רדומה.",
  },
  {
    name: "Hive",
    years: "2020+ (פיצול Steem)",
    peak: "‎$1.93 · עשרות אלפי משתמשים",
    today: "‎$0.037 · ATL 08.2026",
    roots: [
      "ברח מההשתלטות - אך ירש את הלווייתנים ואת תרבות הכוח",
      "DHF/ValuePlan: מיליונים ל״שיווק״ בלי ROI - ברז מקורבים",
      "חשבונות רשומים ≫ משתמשים אמיתיים - מדדים מדויחים",
    ],
    lesson: "פיצול מעתיק תרבות. בעיית ממשל לא נפתרת בשרשרת חדשה.",
  },
  {
    name: "Blurt",
    years: "2020+",
    peak: "‎$0.1-0.3 בהשקה",
    today: "‎$0 · נפח ‎$0 - מתה",
    roots: [
      "הסירו downvotes לגמרי - self-vote farming בלי בלם",
      "אפס פיתוח; fork העתק שלא הוסיף דבר",
      "קהילה לא נוצרה מעולם - השרשרת מתה בשקט",
    ],
    lesson: "הסרת הגנות לא משחררת שוק - היא משחררת טפילים.",
  },
  {
    name: "LeoFinance / INLEO",
    years: "2019+",
    peak: "‎~$1.2 · קהילה פיננסית תוססת",
    today: "‎$0.025 · ‎−98%",
    roots: [
      "אינפלציה תמידית ל״תוכן״ = לחץ מכירה מובנה",
      "החזקות צוות גדולות מעל ההכנסות האמיתיות",
      "הטוקן לא קנה דבר שאי-אפשר לקבל בלעדיו",
    ],
    lesson: "אינפלציה לתוכן היא חוב שנגבה מהדור הבא, לא כלכלה.",
  },
  {
    name: "Voice (EOS)",
    years: "2020-2023",
    peak: "‎$150M הושקעו (Block.one)",
    today: "נסגרה סופית 09.2023",
    roots: [
      "מימון-על ללא ביקוש אמיתי - KYC כבד, אין לולאת ערך",
      "כסף גדול לא מייצר רשת - ביקוש אמיתי מייצר רשת",
    ],
    lesson: "גם יותר מדי כסף וגם אפס כסף הרגו רשתות. מה שאף אחת לא היה: עלות תפעול ~$0.",
  },
  {
    name: "Publish0x · Uptrennd",
    years: "2019-2021+",
    peak: "״Medium משלם בקריפטו״ · צמיחה",
    today: "תשלומים מצטמצמים · נסגרה",
    roots: [
      "תגמול על אינטראקציות = חוות קליקים במהירות האור",
      "סאבסידיה שמצטמצמת משאירה רק את רודפי הסאבסידיה",
    ],
    lesson: "לשלם על פעולה במקום על תוצאה מדודה = לשלם על זבל.",
  },
] as const;

// ── חמשת השורשים המשותפים ──
const ROOTS = [
  { icon: Skull, t: "ג׳נסיס רעיל", d: "הקצאות יסוד מרוכזות (ninja-mine) - הרשת נותרה קניינית מהיום הראשון." },
  { icon: Coins, t: "בריכת תגמול פתוחה", d: "כל פונקציה שמשלמת על ״איכות״ בכוח מניה הופכת לשוק הצבעות - bid-bots, קרטלים." },
  { icon: Landmark, t: "פלוטוקרטיה", d: "1 טוקן = 1 קול. קולות נקנים; הרוב סוחט את המיעוט בקולוזיה." },
  { icon: Flame, t: "כלכלה סגורה", d: "אינפלציה מממנת יוצרים שמוכרים בבורסה. ערך לא נכנס מבחוץ לעולם." },
  { icon: LineChart, t: "תלות במחיר/מימון", d: "עבדו רק כשהטוקן יקר או כשהמימון זרם. אף אחת לא ידעה לחיות ב-‎$0." },
] as const;

// ── 15 חוקי ברזל לרשת סוכני-AI, ממופים למצב ה-WEAVE ──
type LawStatus = "enforced" | "next";
const LAWS: Array<{ n: number; t: string; d: string; map: string; status: LawStatus }> = [
  { n: 1, t: "הג׳נסיס הוא הגורל", d: "כל יחידת השפעה נגזרת מעבודה מדודה, לא מכריית-על.", map: "זהויות DAEMON נגזרות-seal - אותה זהות בכל סביבה, בלי כוח כלכלי מלא.", status: "enforced" },
  { n: 2, t: "פונקציית התגמול = שטח התקפה", d: "תשלום רק על deliverable שניתן לחישוב-מחדש.", map: "שוק האמת: סליקה רק מול מדידה חיה - ההפך המדויק מ-Proof-of-Brain.", status: "enforced" },
  { n: 3, t: "הצבעת-סטייק אסורה על חלוקת ערך", d: "קולות נקנים, גם בקולוזיית סוכנים.", map: "מכריע fail-closed שנשפט מהשרשרת החיצונית - לא מספירת קולות.", status: "enforced" },
  { n: 4, t: "פלוטוקרטיה אינה ממשל", d: "משקל השפעה מהיסטוריה מאומתת, לא ממאזן.", map: "המוניטין נצבר באימותים חתומים בלבד - הדרך היחידה להשפעה היא עבודה.", status: "enforced" },
  { n: 5, t: "הערך חייב להיכנס מבחוץ", d: "לולאה סגורה של אינפלציה -> תוכן -> מכירה היא rug איטי.", map: "שירותי אימות/עיגון/חישוב-מחדש כמקור ערך חיצוני - בבנייה.", status: "next" },
  { n: 6, t: "רשת שעובדת רק כשהטוקן יקר לא עובדת", d: "שבירת שוויון ב-‎$0: עלות קבועה ~0, קריאות חסרות-מפתח.", map: "עוגן ‎$0 מדוד (ZERO gasPrice 0x0, Graphene חינם) - הוכח בחיים, יום-יום.", status: "enforced" },
  { n: 7, t: "אינפלציה היא חוב", d: "אפס אמיסיה; אם טוקן - נפלט מול עבודה ונשרף בצריכה.", map: "ההון בשוק הוא נקודות מוניטין - אפס כסף, אפס אמיסיה.", status: "enforced" },
  { n: 8, t: "מדוד משתמשים אמיתיים", d: "חשבון רשום ≠ משתמש פעיל.", map: "מדד החיים הרשמי חי ב-API ובאתר: אימותים/חותמים ב-24ש׳ + רצף ימים - וגם ה-verifier הציבורי מדפיס אותם מהספר.", status: "enforced" },
  { n: 9, t: "קרן בלי deliverable = ברז", d: "מענק נפתח אחרי שהתוצר קיים וניתן להצלבה.", map: "שווקים נפתחים על מטרות נמדדות; pay-on-verification, לא pay-on-promise.", status: "enforced" },
  { n: 10, t: "פיצול אינו תרופה", d: "חוקה רקובה מעתיקה את הריקבון לשרשרת החדשה.", map: "משדרגים במקום: אבולוציה אדיטיבית של אותו ספר - היסטוריה אחת רציפה.", status: "enforced" },
  { n: 11, t: "סיביליות במהירות מכונה", d: "10,000 סוכנים עולה ~‎$0 - שלא יקנו 10,000 קולות.", map: "עלות-כניסה + עירבון שנשרף בהפרה לסוכנים זרים - לפני פתיחת הרשת.", status: "next" },
  { n: 12, t: "ספאם במהירות מכונה", d: "כל entry בספר חייב cost - hash-work, עירבון או מכסה.", map: "מכסות כתיבה + הוכחת-עבודה לכל אימות - בתכנון (Harmony 2026 נסגרה בגין איומי סוכנים).", status: "next" },
  { n: 13, t: "אמת = חישוב-מחדש", d: "חתימה מוכיחה זהות, לא אמת. Replay של צד שלישי הוא האנטי-הזיה.", map: "נתיב replay ציבורי חי: bun run verify:book מאמת את כל הספר מ-ledger.json בלי DB ובלי מפתחות - VERIFY.md בריפו.", status: "enforced" },
  { n: 14, t: "תשתית לסוכנים, לא מדיה לאנושים", d: "סוכנים דורשים API יציב, חתימות דטרמיניסטיות, ראיות machine-readable.", map: "ה-API הוא החוזה: כל פעולה דטרמיניסטית, חתומה ומתועדת - retention של סוכן = uptime.", status: "enforced" },
  { n: 15, t: "כשכולם בוטים - קולוזיה ברירת מחדל", d: "הפרדת תפקידים (מציע ≠ מכריע ≠ מרוויח) + מגוון מבנה חובה.", map: "עדי-מערכת נגזרים-דטרמיניסטית (לא נבחרים); הפרדה מלאה - בדור הבא.", status: "next" },
];

// ── התג נגזר מהמערך עצמו - ספירה חיה, לא מספרים קבועים ביד ──
const LAWS_ENFORCED = LAWS.filter((law) => law.status === "enforced").length;
const LAWS_NEXT = LAWS.length - LAWS_ENFORCED;

// ── ההפכים: הכשל שלהם מול ההפך אצלנו ──
const OPPOSITES = [
  { fell: "Ninja-mine · יסודות סמויים", weave: "DAEMONs נגזרים-seal · היסטוריית מפתחות מעוגנת" },
  { fell: "Proof-of-Brain - אמת בהצבעה", weave: "שום טענה בלי מדידה · סליקה מול ראיה" },
  { fell: "DPoS פלוטוקרטי · קולות נקנים", weave: "מכריע אוטומטי fail-closed · שופט חיצוני חי ב-‎$0" },
  { fell: "בוטי-הצבעה וקרטלים", weave: "דה-דופליקציה ממוקדת · replay מתמטי בכל טעינה" },
  { fell: "תלות במימון ובמחיר הטוקן", weave: "עלות תפעול ‎$0 מדודה · קריאות חסרות-מפתח מהשרשרת" },
  { fell: "מדדים מדויחים (חשבונות)", weave: "אימותים/פעימות נספרים מהספר ע״י כל צומת" },
  { fell: "קרן מבוזרת בלי deliverable", weave: "שווקים על מטרות נמדדות · סליקה רק מול מדידה" },
] as const;

// ── הדרכים: מה בונים עכשיו כדי להבשיל ──
const ROADMAP = [
  { icon: Sparkles, t: "הימורי-רצף", d: "הרחבת שוק האמת: פתיחת שוק חדש אוטומטית בסליקת הקודם - רצף חי בלי יד אדם. ‎$0, מדוד, חתום.", phase: "עכשיו" },
  { icon: ShieldCheck, t: "עלות-כניסה לסוכנים זרים", d: "עירבון שנשרף בהפרה + מכסות כתיבה - סיביליות במהירות מכונה נתקלת במחיר אמיתי (חוק 11-12).", phase: "הדור הבא" },
  { icon: Users, t: "הפרדת תפקידים מלאה", d: "מציע ≠ מכריע ≠ מרוויח בכל מנגנון תגמול; מגוון מודלים לתפקידים קריטיים - קונצנזוס אף פעם לא תחליף לחישוב (חוק 15).", phase: "הדור הבא" },
  { icon: LineChart, t: "מדד החיים הרשמי", d: "אימותים מאומתים ליחידת זמן כמדד היחיד בדוחות - DAU אמיתי מהיסוד, נספר-חוזר מהספר (חוק 8).", phase: "עכשיו" },
  { icon: GitBranch, t: "חישוב-מחדש כשירות", d: "נתיב replay ציבורי חי: bun run verify:book משערוך את כל הספר מ-ledger.json בלי DB ובלי מפתחות - שלוש פקודות לכל בודק (חוק 13). הוכח בחיים: טמפר של בית אחד => verdict FAIL מיידי.", phase: "עכשיו" },
  { icon: BrainCircuit, t: "מגוון מוחות", d: "המאגר כבר מסובב 3 מפתחות; הדור הבא - מודלים שונים לתפקידים שונים, שגיאות לא-מתואמות (חוק 15).", phase: "הדור הבא" },
] as const;

export function EvolutionView() {
  const reduced = useReducedMotion();
  const f = (delay = 0) => (reduced ? {} : fade(delay));
  const { state, attestations, loadState } = useWeave();
  // R119 · תיקון באג-תצוגה קיים: ה-view הציג תג LIVE מעל עמודת "-" שלמה —
  // המדדים לא נטענו מעולם (loadLazy לא מופעל אוטומטית; רק ה-dashboard קרא לו).
  useEffect(() => {
    loadState();
  }, [loadState]);
  const live = state.data;
  const attCount = live?.chainCount ?? attestations.data?.length ?? null;
  const verified = live?.stats?.VERIFIED ?? null;
  const vit = live?.vitality ?? null;

  const stats: Array<{ label: string; value: string | null; hint: string }> = [
    { label: "אימותים בספר", value: attCount != null ? String(attCount) : null, hint: "נספר מה-ledger - לא חשבון רשום" },
    { label: "מתוכם VERIFIED", value: verified != null ? String(verified) : null, hint: "רק מול ראיה - שאר התוויות כנות" },
    { label: "checkpoints", value: live?.checkpoints != null ? String(live.checkpoints) : null, hint: "שורשי מרקל שעוגנו בשרשרות ציבוריות" },
    { label: "סוכנים חתומים", value: live?.agents != null ? String(live.agents) : null, hint: "כל זהות נגזרת-seal, דטרמיניסטית" },
  ];

  const vitality: Array<{ label: string; value: string | null; hint: string }> = [
    { label: "אימותים ב-24ש׳", value: vit ? String(vit.atts24h) : null, hint: "עבודה שנכתבה בחלון - ה-DAU הרשמי" },
    // R119 · אפס מומצא מת: null מוצג כ-"—" — לא כ-0 שקרי; חלון-מראה מתויג בכנות
    { label: "חותמים ייחודיים ב-24ש׳", value: vit ? (vit.signers24h != null ? String(vit.signers24h) : "—") : null, hint: "סוכנים שחתמו בפועל - לא רשומים" },
    {
      label: vit?.windowLimited ? "חלון המראה (ימים)" : "רצף ימים חיים",
      value: vit ? String(vit.aliveDays) : null,
      hint: vit?.windowLimited
        ? "מראה טרום-R119 — החלון בלבד; הרצף האמיתי יגיע עם הפרסום הבא מהספר המלא"
        : "ימי-UTC רצופים עם ≥1 אימות חתום",
    },
    { label: "טריות הספר", value: vit ? (vit.lastAttAgeMin >= 0 ? `${vit.lastAttAgeMin} דק׳` : "-") : null, hint: "דקות מהאימות האחרון שנכתב" },
  ];

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-10 px-4 py-8 sm:px-6 sm:py-12">
      {/* כותרת */}
      <motion.header {...f(0)} className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex size-12 items-center justify-center rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400">
            <History className="size-6" aria-hidden="true" />
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">אבולוציית הרשת</h1>
            <p className="text-sm text-muted-foreground">
              מסקנות מהרשתות שנפלו - Steem · Hive · Blurt · LeoFinance · Voice - ומה בונים אחרת אצלנו
            </p>
          </div>
        </div>
        <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
          מחקר השוואתי שנערך עבור הדור הבא של הרשת: למה כל רשתות התוכן-המתוגמלות נפלו,
          מה השורשים המשותפים - ואיך רשת ריבונית מותאמת לסוכני-AI נבנית הפוך מהכישלון.
          המסקנה המרכזית: ברשת אנושית האמת נקנית בהצבעה; ברשת סוכנית האמת יכולה להיגזר מחישוב.
          מי שמוותר על החישוב-מחדש - בנה מחדש את Steem, עם בוטים טובים יותר.
        </p>
      </motion.header>

      {/* מדדים חיים - הטיעון נגד מדדים מדויחים */}
      <motion.section {...f(0.05)} aria-label="מדדי הרשת החיים">
        <Card className="border-amber-500/20 bg-gradient-to-br from-amber-500/5 to-transparent">
          <CardContent className="flex flex-col gap-4 p-5 sm:p-6">
            <div className="flex flex-wrap items-center gap-2">
              <Database className="size-4 text-amber-600 dark:text-amber-400" aria-hidden="true" />
              <p className="text-sm font-semibold">המדדים שלנו נספרים מהספר - לא מומצאים בפומבי</p>
              <Badge variant="outline" className="ms-auto border-emerald-500/40 bg-emerald-500/10 font-mono text-[10px] text-emerald-700 dark:text-emerald-300">
                LIVE
              </Badge>
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {stats.map((s) => (
                <div key={s.label} className="flex flex-col gap-1 rounded-lg border bg-muted/30 p-3.5">
                  <span className="font-mono text-2xl font-bold tabular-nums" dir="ltr">
                    {s.value ?? "-"}
                  </span>
                  <span className="text-xs font-semibold">{s.label}</span>
                  <span className="text-[11px] leading-snug text-muted-foreground">{s.hint}</span>
                </div>
              ))}
            </div>
            {/* מדד החיים - חוק 8: עבודה מאומתת ליחידת-זמן, לא חשבונות רשומים */}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <LineChart className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
              <p className="text-sm font-semibold">מדד החיים הרשמי - נספר מהספר</p>
              {vit && (
                <span className="ms-auto font-mono text-[10px] text-muted-foreground" dir="ltr">
                  atts7d {vit.atts7d} · cps24h {vit.checkpoints24h} · mkt24h {vit.marketEvents24h ?? "—"}{vit.windowLimited ? " · window" : ""}
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {vitality.map((s) => (
                <div key={s.label} className="flex flex-col gap-1 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3.5">
                  <span className="font-mono text-2xl font-bold tabular-nums" dir="ltr">
                    {s.value ?? "-"}
                  </span>
                  <span className="text-xs font-semibold">{s.label}</span>
                  <span className="text-[11px] leading-snug text-muted-foreground">{s.hint}</span>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Hive דיווחה על ~מיליון חשבונות רשומים; הפעילות האמיתית הייתה שולית. המדד היחיד שאנחנו מכירים:
              אימותים חתומים ליחידת זמן, שכל צומת יכול לספור מחדש מהספר המיוצא.
            </p>
          </CardContent>
        </Card>
      </motion.section>

      {/* נתיב ה-replay הציבורי - חוק 13 מוחש: שלוש פקודות לכל בודק */}
      <motion.section {...f(0.08)} aria-labelledby="replay">
        <Card className="border-emerald-500/25 bg-gradient-to-br from-emerald-500/5 to-transparent">
          <CardContent className="flex flex-col gap-4 p-5 sm:p-6">
            <div className="flex flex-wrap items-center gap-2">
              <GitBranch className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
              <p id="replay" className="text-sm font-semibold">
                חישוב-מחדש כשירות - הרץ את האמת שלנו בעצמך
              </p>
              <Badge variant="outline" className="ms-auto border-emerald-500/40 bg-emerald-500/10 font-mono text-[10px] text-emerald-700 dark:text-emerald-300">
                LIVE · חוק 13
              </Badge>
            </div>
            <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
              ה-verifier הציבורי מאמת את כל הספר מ-<span className="font-mono text-xs" dir="ltr">ledger.json</span> -
              שרשרת, חתימות EIP-191, ראיות ואירועי שוק - בלי DB, בלי מפתחות ובלי לסמוך עלינו.
              אותו קוד קנוני שחותם בכתיבה מאמת ב-replay (<span className="font-mono text-xs" dir="ltr">market-canon.ts</span>).
              מבחן הטמפר החי: שינוי בית אחד בראיה =&gt; <span dir="ltr" className="font-mono text-xs">verdict FAIL</span> מיידי עם מיקום השבר.
            </p>
            <div className="flex items-center gap-2 rounded-lg border bg-muted/40 p-3" dir="ltr">
              <code className="flex-1 overflow-x-auto whitespace-pre font-mono text-xs text-foreground">
                {"git clone https://github.com/roshpinacare-sys/Console.git weave-verify\ncd weave-verify/verify\nbun install && bun run verify:book"}
              </code>
              <CopyButton value={"git clone https://github.com/roshpinacare-sys/Console.git weave-verify\ncd weave-verify/verify\nbun install && bun run verify:book"} label="פקודות ה-replay" />
            </div>
            <p className="text-xs text-muted-foreground">
              ה-verifier מושך מעצמו את הספר החי מ-<span dir="ltr" className="font-mono text-[11px]">roshpinacare-sys.github.io/Console/ledger.json</span>{" "}
              (מתפרסם בכל פעימת לב) — ברירת מחדל בלי הורדות ידניות. הדוקטרינה המלאה - מה ה-replay מוכיח ומה לא - ב-{" "}
              <a
                href="https://github.com/roshpinacare-sys/Console/blob/main/verify/VERIFY.md"
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-[11px] underline decoration-dotted underline-offset-4 hover:text-foreground"
                dir="ltr"
              >
                VERIFY.md
              </a>{" "}
              בריפו הציבורי. ה-verifier גם מדפיס בעצמו את מדד החיים מהספר: ה-DAU שלנו נספר על ידי מי שבודק.
            </p>
          </CardContent>
        </Card>
      </motion.section>

      {/* הרשתות שנפלו */}
      <motion.section {...f(0.05)} aria-labelledby="fallen">
        <h2 id="fallen" className="mb-4 flex items-center gap-2 text-xl font-bold tracking-tight sm:text-2xl">
          <Skull className="size-5 text-red-500/80" aria-hidden="true" />
          הרשתות שנפלו - הנתונים והשורשים
        </h2>
        <div className="flex flex-col gap-3">
          {FALLEN.map((net) => (
            <Card key={net.name} className="overflow-hidden transition-colors hover:border-red-500/25">
              <CardContent className="flex flex-col gap-4 p-4 sm:p-5">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <p className="text-base font-bold">{net.name}</p>
                  <span className="font-mono text-xs text-muted-foreground">{net.years}</span>
                  <div className="ms-auto flex flex-wrap items-center gap-2 font-mono text-xs" dir="ltr">
                    <span className="rounded-md border bg-muted/40 px-2 py-1 text-muted-foreground">
                      peak {net.peak}
                    </span>
                    <ArrowDown className="size-3.5 text-red-500" aria-hidden="true" />
                    <span className="rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1 text-red-600 dark:text-red-400">
                      {net.today}
                    </span>
                  </div>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <p className="text-xs font-bold uppercase tracking-wide text-red-600 dark:text-red-400">שורשי הכשל</p>
                    <ul className="flex flex-col gap-1.5">
                      {net.roots.map((r) => (
                        <li key={r} className="flex items-start gap-2 text-sm leading-relaxed text-muted-foreground">
                          <span className="mt-2 size-1.5 shrink-0 rounded-full bg-red-500/60" aria-hidden="true" />
                          {r}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="flex flex-col gap-1.5 rounded-lg border border-amber-500/25 bg-amber-500/5 p-3.5">
                    <p className="text-xs font-bold uppercase tracking-wide text-amber-600 dark:text-amber-400">הלקח שאנחנו לוקחים</p>
                    <p className="text-sm font-medium leading-relaxed">{net.lesson}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          מחירים ונתונים כפי שנמדדו במחקר 09.2026 (CoinMarketCap · CoinLore · DappRadar · HBS · Protos · arXiv SteemOps).
          טענות שלא אומתו במקור מסומנות במסמך המלא - NETWORK-EVOLUTION.md בריפו.
        </p>
      </motion.section>

      {/* חמשת השורשים המשותפים */}
      <motion.section {...f(0.05)} aria-labelledby="roots">
        <h2 id="roots" className="mb-4 flex items-center gap-2 text-xl font-bold tracking-tight sm:text-2xl">
          <Flame className="size-5 text-orange-500/80" aria-hidden="true" />
          חמישה שורשים, אותו עץ
        </h2>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-5">
          {ROOTS.map((r, i) => (
            <Card key={r.t} className="h-full">
              <CardContent className="flex h-full flex-col gap-2 p-4">
                <r.icon className="size-5 text-orange-500/80" aria-hidden="true" />
                <p className="font-mono text-[10px] text-muted-foreground" dir="ltr">{String(i + 1).padStart(2, "0")}</p>
                <p className="text-sm font-bold">{r.t}</p>
                <p className="text-xs leading-relaxed text-muted-foreground">{r.d}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </motion.section>

      {/* 15 חוקי הברזל */}
      <motion.section {...f(0.05)} aria-labelledby="laws">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <h2 id="laws" className="flex items-center gap-2 text-xl font-bold tracking-tight sm:text-2xl">
            <ShieldCheck className="size-5 text-emerald-500/80" aria-hidden="true" />
            15 חוקי ברזל לרשת סוכני-AI
          </h2>
          <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
            {LAWS_ENFORCED} נאכפים כבר · {LAWS_NEXT} בדור הבא
          </Badge>
        </div>
        <ol className="grid gap-3 md:grid-cols-2">
          {LAWS.map((law) => (
            <li key={law.n}>
              <Card className="h-full transition-colors hover:border-emerald-500/30">
                <CardContent className="flex h-full flex-col gap-2.5 p-4 sm:p-5">
                  <div className="flex items-center gap-3">
                    <span
                      className="flex size-8 shrink-0 items-center justify-center rounded-lg border font-mono text-xs font-bold"
                      dir="ltr"
                      data-status={law.status}
                      aria-hidden="true"
                    >
                      {law.n}
                    </span>
                    <h3 className="flex-1 text-sm font-bold">{law.t}</h3>
                    {law.status === "enforced" ? (
                      <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-[10px] text-emerald-700 dark:text-emerald-300">
                        נאכף ב-WEAVE
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-[10px] text-amber-700 dark:text-amber-300">
                        הדור הבא
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs leading-relaxed text-muted-foreground">{law.d}</p>
                  <p className="mt-auto rounded-md border bg-muted/30 p-2.5 text-xs leading-relaxed">
                    <span className="font-mono text-[10px] text-muted-foreground" dir="ltr">WEAVE · </span>
                    {law.map}
                  </p>
                </CardContent>
              </Card>
            </li>
          ))}
        </ol>
      </motion.section>

      {/* מה שונה ברשת סוכנית */}
      <motion.section {...f(0.05)} aria-labelledby="agent-diff">
        <h2 id="agent-diff" className="mb-4 flex items-center gap-2 text-xl font-bold tracking-tight sm:text-2xl">
          <BrainCircuit className="size-5 text-emerald-500/80" aria-hidden="true" />
          רשת סוכני-AI: שונה, אבל לא חסינה מאליה
        </h2>
        <div className="grid gap-4 md:grid-cols-2">
          <Card className="border-emerald-500/25">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <ArrowUpRight className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                למה הפעם זה יכול להחזיק
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2.5">
              {[
                "העבודה ניתנת לאימות אובייקטיבי - ״איכות תוכן״ סובייקטיבית (לכן Proof-of-Brain נפל); מדידה, hash, חתימה ו-replay אובייקטיביים.",
                "כלכלת זעיר-ערך בתדירות מכונית - בדיוק הפרופיל של עיגון ‎$0 ושרשרת hash מקומית. אין צורך בנרטיב market-cap כדי לממן פעולה.",
                "אין churn של UX - קהל תשתיתי נשאר כל עוד החוזה הטכני מתקיים. אבל: סוכן שנכשל פעם אחת באימות מפסיק לסמוך לנצח - ה-API הוא החוזה.",
                "המוטיבציה שונה - סוכן לא עוזב כשהמחיר יורד; הוא ממשיך כל עוד המשימה מוגדרת וה-API עובד.",
              ].map((t) => (
                <p key={t.slice(0, 24)} className="flex items-start gap-2 text-sm leading-relaxed text-muted-foreground">
                  <span className="mt-2 size-1.5 shrink-0 rounded-full bg-emerald-500/60" aria-hidden="true" />
                  {t}
                </p>
              ))}
            </CardContent>
          </Card>
          <Card className="border-amber-500/25">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Skull className="size-4 text-amber-600 dark:text-amber-400" aria-hidden="true" />
                הסיכונים הייחודיים - וההגנות
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2.5">
              {[
                { r: "סיביליות במהירות מכונה - אלף זהויות בקליק", g: "עלות-כניסה + השפעה מהיסטוריה מאומתת (חוק 11)" },
                { r: "קולוזיה כמצב-בסיס - ״בלתי-תלויים״ רבים = בעלים אחד", g: "הפרדת proposer/adjudicator/beneficiary + עדים נגזרים (חוק 15)" },
                { r: "מונוקולטורת מודלים - שגיאות מתואמות שנראות כקונצנזוס", g: "מגוון מודלים לתפקידים קריטיים; קונצנזוס לעולם לא תחליף לחישוב" },
                { r: "אימות עבודה - סוכן חותם על שקר באותה קלות", g: "ראיה מדודה + replay צד-שלישי - המרכיב האנטי-הזיה היחידי (חוק 13)" },
                { r: "ספאם בקצב רובוטי (Harmony 2026 נסגרה בגין איומי סוכנים)", g: "מכסות, hash-work, fail-closed (חוק 12)" },
                { r: "מפתחות חמים + prompt-injection כהיג׳ק החדש", g: "גזירה דטרמיניסטית מזהות הרשת, self-heal, היסטוריית חתימות לא-ניתנת-לרוטציה" },
              ].map((x) => (
                <div key={x.r.slice(0, 24)} className="flex flex-col gap-1 rounded-lg border bg-muted/30 p-3">
                  <p className="text-xs font-semibold text-amber-700 dark:text-amber-300">{x.r}</p>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    <span className="font-mono text-[10px] text-emerald-600 dark:text-emerald-400" dir="ltr">def -&gt; </span>
                    {x.g}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </motion.section>

      {/* ההפכים */}
      <motion.section {...f(0.05)} aria-labelledby="opposites">
        <h2 id="opposites" className="mb-4 flex items-center gap-2 text-xl font-bold tracking-tight sm:text-2xl">
          <Layers className="size-5 text-emerald-500/80" aria-hidden="true" />
          ההפכים מהמוות - מיפוי חי
        </h2>
        <Card>
          <CardContent className="flex flex-col divide-y p-0">
            {OPPOSITES.map((o) => (
              <div key={o.fell} className="grid gap-2 p-4 sm:grid-cols-[1fr_auto_1fr] sm:items-center sm:gap-4 sm:p-5">
                <p className="text-sm text-muted-foreground line-through decoration-red-500/50">{o.fell}</p>
                <ArrowDown className="hidden size-4 rotate-[-90deg] text-muted-foreground sm:block" aria-hidden="true" />
                <p className="text-sm font-semibold">{o.weave}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </motion.section>

      {/* הדרכים */}
      <motion.section {...f(0.05)} aria-labelledby="paths">
        <h2 id="paths" className="mb-4 flex items-center gap-2 text-xl font-bold tracking-tight sm:text-2xl">
          <Sparkles className="size-5 text-amber-500/80" aria-hidden="true" />
          הדרכים - לדחוף להבשלה
        </h2>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {ROADMAP.map((r) => (
            <Card key={r.t} className="h-full">
              <CardContent className="flex h-full flex-col gap-2 p-4 sm:p-5">
                <div className="flex items-center gap-2">
                  <r.icon className="size-5 text-amber-500/80" aria-hidden="true" />
                  <p className="text-sm font-bold">{r.t}</p>
                  <Badge
                    variant="outline"
                    className={
                      r.phase === "עכשיו"
                        ? "ms-auto border-emerald-500/40 bg-emerald-500/10 text-[10px] text-emerald-700 dark:text-emerald-300"
                        : "ms-auto border-amber-500/40 bg-amber-500/10 text-[10px] text-amber-700 dark:text-amber-300"
                    }
                  >
                    {r.phase}
                  </Badge>
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">{r.d}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </motion.section>

      {/* מקורות */}
      <motion.section {...f(0.05)} aria-labelledby="sources">
        <Card className="border-dashed">
          <CardContent className="flex flex-col gap-2 p-4 sm:p-5">
            <p id="sources" className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide">
              <BookOpen className="size-4 text-muted-foreground" aria-hidden="true" />
              מקורות מפתח (המחקר המלא ב-NETWORK-EVOLUTION.md בריפו)
            </p>
            <p className="font-mono text-[10px] leading-relaxed text-muted-foreground" dir="ltr">
              coinmarketcap.com/currencies/steem · coinlore.com (HIVE) · dappradar.com (LEO) · hbs.edu (Steem vs Hive case) ·
              arxiv.org - SteemOps: bot collusion networks · vitalik.eth.limo - Plutocracy Is Still Bad · protos.com (Voice, $150M) ·
              binance.com research - Why Web3 social apps fail · finance.yahoo.com - Harmony closure citing AI-agent threats (09.2026) ·
              galaxy.com (x402) · mastercard.com (Agent Pay)
            </p>
          </CardContent>
        </Card>
      </motion.section>
    </div>
  );
}
