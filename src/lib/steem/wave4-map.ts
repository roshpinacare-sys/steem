/**
 * Wave-4 unified solo-operator map — static, measured data.
 * Source of truth: docs/EXPLORATION_WAVE4.md (block 109,208,885).
 * Read-only presentation data — never holds keys, never triggers chain writes.
 */

export type PathStatus = "wide-open" | "open" | "live" | "niche" | "closed";

export type PathCategory = "market" | "network" | "service" | "config";

export interface SoloPath {
  id: string;
  title: string;
  category: PathCategory;
  status: PathStatus;
  /** short economics line, Hebrew */
  economics: string;
  /** minimal key authority required */
  key: "posting" | "active" | "mixed" | "none";
  capital: string;
  risk: "low" | "medium" | "high" | "—";
  summary: string;
  firstStep: string;
  source: string;
}

export const STATUS_META: Record<
  PathStatus,
  { label: string; badge: string; order: number }
> = {
  "wide-open": {
    label: "🟢 פתוח-רחב",
    badge: "border-emerald-400/40 bg-emerald-400/10 text-emerald-300",
    order: 0,
  },
  open: {
    label: "🟢 פתוח",
    badge: "border-emerald-400/30 bg-emerald-400/5 text-emerald-200",
    order: 1,
  },
  live: {
    label: "🟣 ממומש בפלטפורמה",
    badge: "border-violet-400/40 bg-violet-400/10 text-violet-300",
    order: 2,
  },
  niche: {
    label: "🟡 נישה",
    badge: "border-amber-400/40 bg-amber-400/10 text-amber-300",
    order: 3,
  },
  closed: {
    label: "🔴 סגור-נמדד",
    badge: "border-rose-400/30 bg-rose-400/5 text-rose-300",
    order: 4,
  },
};

export const CATEGORY_META: Record<PathCategory, { label: string }> = {
  market: { label: "שוק ופיננסים" },
  network: { label: "הכנסה מהרשת" },
  service: { label: "שירותי סולו" },
  config: { label: "תצורה וצמיחה" },
};

/** Headline measurements from wave-4 (docs/EXPLORATION_WAVE4.md §0-§5). */
export const WAVE4_SNAPSHOT = {
  block: "109,208,885",
  hardfork: "0.23.1",
  feed: "0.046",
  marketAsk: "0.09924",
  marketSpreadPct: 0.72,
  steemUsd: 0.0427,
  sbdUsd: 0.3975,
  edgeInternalPct: 115.7,
  edgeExternalPct: 133.7,
  dhfBarSp: "515K",
  witnessTop21Sp: "586K",
  witnessTop100Sp: "13.8K",
  savingsInterestRate: 0,
  headcornerSp: "5,567",
  headcornerPendingSp: "26.3",
};

export const MASTER_MAP: SoloPath[] = [
  {
    id: "W4-01",
    title: "המרת SBD→STEEM (BOT-3)",
    category: "market",
    status: "closed",
    economics: "נמדד מחדש (רוסט): החלון סגור — feed מפעיל 0.1043 מול bid 0.0985 = −5.6% למחזור. ה-+115.7% המקורי היה קריאה מהשדה השגוי",
    key: "active",
    capital: "הון חוץ ($50-100 כניסה) — רק אם הסייר ידווח על פתיחה",
    risk: "—",
    summary:
      "תיקון רוסט: ה-feed המפעיל (current_median_history) עומד על 0.1043 SBD/STEEM — שווה-הערך של 1 SBD במימוש ≈ $0.41, בדיוק סביב מחיר ה-SBD בשוק ($0.3975) — שיווי משקל. הערך 0.046 שהוצג בגל 4 נקרא מ-price_history (סדרת ציטוטי העדים הקפואה), לא מה-feed המפעיל. אפס המרות ממומשות ברשת כולה מאשש. הסייר (/api/ops/watch) מדגום כל 5 דק' וידווח אמת אם החלון ייפתח.",
    firstStep: "המתן התראת פתיחה מהסייר → אימות feed מפעיל חי → הון קטן (≤100 SBD) → convert → מכירה ל-bids",
    source: "ROAST.md §3",
  },
  {
    id: "W4-02",
    title: "קוראציה ממוקדת (BOT-2/BOT-10)",
    category: "network",
    status: "open",
    economics: "APR נמדד חי 3.3–7.6% + צבירת SP",
    key: "posting",
    capital: "SP קיים (5,567)",
    risk: "low",
    summary:
      "הצבעה מדודה על פוסטים איכותיים בחלון הזמן האופטימלי. הווקטור היציב ביותר ללא הון נוסף, עם אפס סיכון כספי (posting key בלבד).",
    firstStep: "הפעלת רשימת-מעקב איכות + תזמון הצבעות 5-15 דקות אחרי פרסום",
    source: "EXPLORATION_WAVE2.md §1",
  },
  {
    id: "W4-03",
    title: "מפעל חשבונות (S2)",
    category: "service",
    status: "live",
    economics: "עמלה 1.75 STEEM מול רשמי 3.00 — מרווח 42% ללקוח",
    key: "active",
    capital: "RC חינם (RC 100%)",
    risk: "low",
    summary:
      "claim_account חינם דרך RC → create_claimed_account ללקוח משלם. כבר חי בפלטפורמה כמודול solo-factory #26 עם כלכלה אמיתית בסימולציה.",
    firstStep: "פאנל 🏭 בטאב ⚡ סולו — סימולציית לקוח ואימות הכלכלה",
    source: "SOLO_MODEL_PLAYBOOK.md S2",
  },
  {
    id: "W4-04",
    title: "אורקל שאל-ושלם (S5)",
    category: "service",
    status: "live",
    economics: "תשלום נכנס → תשובת LLM אמיתית",
    key: "mixed",
    capital: "אפס",
    risk: "low",
    summary:
      "תיבת דואר חיה סורקת העברות נכנסות עם memo ל-headcorner ומנסחת טיוטת תשובה. חי כמודול solo-oracle #27 + תיבת דואר מהשרשרת האמיתית.",
    firstStep: "פאנל 🔮 בטאב ⚡ סולו — צפייה בתיבת הדואר החיה",
    source: "SOLO_MODEL_PLAYBOOK.md S5",
  },
  {
    id: "W4-05",
    title: "מוכר-הצבעות AI (S1)",
    category: "service",
    status: "open",
    economics: "ממסב את ~7 ההצבעות/יום המבוזבזות ל-890–1150 STEEM/שנה",
    key: "posting",
    capital: "VP פנוי (97.99%)",
    risk: "low",
    summary:
      "VP עומד על 97.99% — כל יום בספירה הזו נשרפות ~7 הצבעות מלאות. מנגנון רשימה-איכותית עם מסנן AI ממיר את הבזבוז להכנסת קוראציה.",
    firstStep: "הרשמת רשימת-טרייל איכותית או מנוע סינון AI על /created",
    source: "SOLO_MODEL_PLAYBOOK.md S1",
  },
  {
    id: "W4-06",
    title: "השכרת SP (BOT-1)",
    category: "market",
    status: "open",
    economics: "~15% APR מאומת — התשואה המכנית הגבוהה כיום",
    key: "active",
    capital: "SP נזיל-מוקצה",
    risk: "low",
    summary:
      "הקצאת SP לשוק ההשכרה מניבה תשואה גבוהה מקוראציה עצמאית. חוזר לנזילות ב-5 ימים מהחזר. דורש מאגר SP מוקצה — מתאים להפעלה מיום 30+.",
    firstStep: "בצבירת ~500 SP נזיל: delegate_vesting_shares לשוק ההשכרה",
    source: "EXECUTION_PLAYBOOK.md BOT-1",
  },
  {
    id: "W4-07",
    title: "ברוקר הקצאות (S6)",
    category: "service",
    status: "open",
    economics: "עמלת תיווך על הקצאות אחרים",
    key: "active",
    capital: "אפס",
    risk: "low",
    summary:
      "חיבור בעלי SP גדולים לשוכרים תמורת עמלה. עסק ללא הון עצמי, אך דורש מוניטין ורשת — עדיפות נמוכה בינתיים.",
    firstStep: "איתור בעלי SP פעילים בקהילות והצעת תיווך",
    source: "SOLO_MODEL_PLAYBOOK.md S6",
  },
  {
    id: "W4-08",
    title: "מנויים חוזרים (S4)",
    category: "service",
    status: "open",
    economics: "הכנסה חוזרת דרך recurring_transfer",
    key: "active",
    capital: "אפס",
    risk: "low",
    summary:
      "מועדון דיג'סט-AI במנוי חודשי — ה-op נתמך בקרנל (recurring_transfer). יתרון ראשונים: אף אחד לא מפעיל מנויים על השרשרת כרגע.",
    firstStep: "פרסום מועדון ראשון בקהילות + קישור recurring_transfer לתשלום",
    source: "SOLO_MODEL_PLAYBOOK.md S4",
  },
  {
    id: "W4-09",
    title: "סוכן אסקרו OTC (S3/BOT-7)",
    category: "service",
    status: "niche",
    economics: "עמלת בוררות 1–2% לעסקה",
    key: "mixed",
    capital: "נאמנות זמנית",
    risk: "medium",
    summary:
      "escrow_transfer/Release/Dispute נתמכים בקרנל. נישה עם יתרון-ראשונים אך דורשת מוניטין וזהירות מיריבות-סיכון.",
    firstStep: "הצעת שירות בקהילות OTC לאחר צבירת מוניטין",
    source: "EXECUTION_PLAYBOOK.md BOT-7",
  },
  {
    id: "W4-10",
    title: "פרסי יוצרים AI (BOT-8)",
    category: "network",
    status: "open",
    economics: "מדף הפרסים: 924,430 STEEM",
    key: "posting",
    capital: "אפס",
    risk: "low",
    summary:
      "פוסטים מוקפדים בנישה מוגדרת עם ערך מוסף אמיתי — פרסי יוצרים משולמים ממדף הפרסים החי. איכות > כמות (עונת הצבירה מתגמלת SP).",
    firstStep: "נישה אחת + תדירות קבועה + תגיות קהילה פעילות",
    source: "EXECUTION_PLAYBOOK.md BOT-8",
  },
  {
    id: "W4-11",
    title: "L2 + תחרויות קהילה (BOT-8)",
    category: "network",
    status: "niche",
    economics: "טוקני Steem-Engine + פרסי תחרויות",
    key: "posting",
    capital: "אפס",
    risk: "low",
    summary:
      "השתתפות בתחרויות קהילה פעילות וקהילות L2 — הזרמת תוכן מבוקרת עם פרסים נוספים מחוץ למדף הראשי. רוב הטוקנים דהויים — בחירה קפדנית.",
    firstStep: "זיהוי 2–3 תחרויות שבועיות פעילות והשתתפות קבועה",
    source: "EXECUTION_PLAYBOOK.md BOT-8",
  },
  {
    id: "W4-12",
    title: "ברית-עדים (S7)",
    category: "config",
    status: "open",
    economics: "הון-יחסים והשפעה — אפס עלות",
    key: "posting",
    capital: "אפס",
    risk: "low",
    summary:
      "הצבעה ל-30 עדים מתואמים-איכות. מהלך מידי בעלות אפס שמקסם השפעה גוברית עם צבירת ה-SP. חיבור ישיר לספי העדים שנמדדו בגל 4.",
    firstStep: "מילוי 30 מקומות ההצבעה לפי רשימת הברית",
    source: "SOLO_MODEL_PLAYBOOK.md S7",
  },
  {
    id: "W4-13",
    title: "עד (witness)",
    category: "network",
    status: "closed",
    economics: "סף top-21 נמדד: ~586K SP (אנחנו: 5.6K)",
    key: "active",
    capital: "גדול",
    risk: "high",
    summary:
      "רק top-21 מפיק בלוקים. דרגה 100 = 13.8K SP. headcorner מצביע לעצמו לערך דרגה ~110+. יעד אסטרטגי ארוך-טווח בלבד — המדד המדויק כעת קיים.",
    firstStep: "מעקב אחרי יחס ה-SP שלנו לסף 13.8K (דרגה 100)",
    source: "EXPLORATION_WAVE4.md §3",
  },
  {
    id: "W4-14",
    title: "SPS מימון (BOT-6)",
    category: "network",
    status: "closed",
    economics: "סף הצעת-החזרה נמדד: ~515K SP קולות",
    key: "active",
    capital: "—",
    risk: "—",
    summary:
      "התקציב קיים (steem.dao: 2.55M SBD) אך הסף האפקטיבי = return proposal (id 0, ~515K SP). מתחתיו אפס תשלום. נשאר הצבעה-אסטרטגית בלבד.",
    firstStep: "הצבעה להצעות קהילתיות — לא הגשה למימון",
    source: "EXPLORATION_WAVE4.md §2",
  },
  {
    id: "W4-15",
    title: "פער בין-מקומי (BOT-4)",
    category: "market",
    status: "closed",
    economics: "spread 0.72% (מ-9.35% בגל 2)",
    key: "active",
    capital: "נזיל",
    risk: "medium",
    summary:
      "השוק הפנימי התכנס לפייר בשלוש מדידות עוקבות. צוהר לפתיחה מחדש רק בנזילות-זעם — מעקב שבועי.",
    firstStep: "מדידת spread שבועית בסקריפט wave4_measure.py",
    source: "EXPLORATION_WAVE4.md §4",
  },
  {
    id: "W4-16",
    title: "חיסכון SBD",
    category: "market",
    status: "closed",
    economics: "sbd_interest_rate = 0 — ריבית מתה",
    key: "active",
    capital: "—",
    risk: "—",
    summary:
      "הריבית על חיסכון SBD אפס במדידה ישירה. החיסכון שימושי רק ככספת עם נזילות 3 ימים — לא כווקטור הכנסה.",
    firstStep: "אין — רק לא להעביר לחיסכון לתשואה",
    source: "EXPLORATION_WAVE4.md §4",
  },
  {
    id: "W4-17",
    title: "תביעת פרסים + היגיינה (BOT-9)",
    category: "config",
    status: "open",
    economics: "26.3 SP ממתינים (~$1.04) — posting בלבד",
    key: "posting",
    capital: "אפס",
    risk: "low",
    summary:
      "claim_reward_balance על 42,533 VESTS ממתינים, ניצול ה-VP המבוזבז, ניקוי 7 הרשאות ה-posting המיושנות (owner אופליין).",
    firstStep: "תביעת הפרסים מיד (posting key) → ניקוי הרשאות לפי המדריך",
    source: "KEY_CAPABILITIES.md §5",
  },
];
