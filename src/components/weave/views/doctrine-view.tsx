"use client";

// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · Doctrine View - האמנה של הרשת, בעמוד אחד קריא.
//
// חוקי-הברזל, סולם האמת (REAL/LOCAL/NOT-YET), שכבות הארכיטקטורה,
// ומפת הריבונות - מה בבית, מה בחוץ, ומה נמדד.
// ─────────────────────────────────────────────────────────────────────

import { motion, useReducedMotion } from "framer-motion";
import {
  BookOpen,
  Coins,
  Database,
  Eye,
  GitBranch,
  Globe2,
  KeyRound,
  Layers,
  Link2,
  Server,
  ShieldCheck,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TruthLabel } from "../shared";

const fade = (delay = 0) => ({
  initial: { opacity: 0, y: 16 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-40px" },
  transition: { duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] as const },
});

export function DoctrineView() {
  const reduced = useReducedMotion();
  const f = (delay = 0) => (reduced ? {} : fade(delay));

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-10 px-4 py-8 sm:px-6 sm:py-12">
      {/* כותרת */}
      <motion.header {...f(0)} className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex size-12 items-center justify-center rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
            <BookOpen className="size-6" aria-hidden="true" />
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">הדוקטרינה</h1>
            <p className="text-sm text-muted-foreground">
              האמנה של THE WEAVE - נאכפת בקוד, נמדדת בפומבי
            </p>
          </div>
        </div>
      </motion.header>

      {/* חוקי הברזל */}
      <motion.section {...f(0.05)} aria-labelledby="iron-laws">
        <h2 id="iron-laws" className="mb-4 text-xl font-bold tracking-tight sm:text-2xl">
          חוקי הברזל
        </h2>
        <ol className="grid gap-3 md:grid-cols-2">
          {[
            { n: 1, t: "שום טענה בלי מדידה", d: "ראיה ריקה => UNMEASURED, לעולם לא VERIFIED. טענות AI אינן ראיה - רק חתימה + hash + חישוב-מחדש." },
            { n: 2, t: "הספר הוא הספר", d: "ledger.json בגיט הוא האמת; SQLite הוא מטמון. כל צומת יכול לשחזר את השרשרת מהספר בלבד." },
            { n: 3, t: "מפתחות לא בגיט", d: "סודות חיים רק בתוך seal מוצפן או על מכונת הסוכן. שער-סודות חוסם כל דחיפה של דפוס-מפתח." },
            { n: 4, t: "תווית אמת מוצהרת תמיד", d: "REAL · LOCAL · NOT-YET - כל רכיב ברשת נושא תווית, והמראה בין שכבות מתועד." },
            { n: 5, t: "כשל-סגור (fail-closed)", d: "מדידה לא זמינה => לא מוכרע, לא VERIFIED, לא נכתבת עדות. הרשת לא ממציאה תוצאות." },
            { n: 6, t: "אפס עלות", d: "כל קווי העדות פועלים בגז-אפס מדוד (Steem/Hive חינם, ZERO EVM gasPrice 0x0). עלות מדודה: 0.000000." },
          ].map((law) => (
            <li key={law.n}>
              <Card className="h-full transition-colors hover:border-emerald-500/30">
                <CardContent className="flex h-full items-start gap-4 p-5">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-emerald-500/30 bg-emerald-500/10 font-mono text-sm font-bold text-emerald-600 dark:text-emerald-400" dir="ltr">
                    {law.n}
                  </span>
                  <div className="flex flex-col gap-1">
                    <h3 className="font-bold">{law.t}</h3>
                    <p className="text-sm leading-relaxed text-muted-foreground">{law.d}</p>
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ol>
      </motion.section>

      {/* סולם האמת */}
      <motion.section {...f(0.1)} aria-labelledby="truth-scale">
        <h2 id="truth-scale" className="mb-4 text-xl font-bold tracking-tight sm:text-2xl">
          סולם האמת
        </h2>
        <Card>
          <CardContent className="flex flex-col gap-4 p-6">
            <div className="flex flex-wrap items-center gap-3">
              <TruthLabel kind="REAL" />
              <TruthLabel kind="LOCAL" />
              <TruthLabel kind="NOT-YET" />
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              {[
                { icon: ShieldCheck, k: "REAL", t: "קריפטו תקני, חי, ניתן לחישוב-חוזר", d: "חתימות EVM אמיתיות (secp256k1/EIP-191/EIP-712), עוגנים על שרשראות ציבוריות, ecrecover בכל כתיבה." },
                { icon: Database, k: "LOCAL", t: "אמיתי בסנדבוקס - טרם על השרשרת", d: "ה-DB, הרשת המקומית, השוק בנקודות. המנגנון דטרמיניסטי וחתום - ההצפנה מדודה, השרשרת עוד לא." },
                { icon: Eye, k: "NOT-YET", t: "מוכרז, נעול מאחורי שער", d: "פריסת חוזה-Registry אמיתי, עיגון מיינט. נפתח רק כשהמדידה מוכיחה - לא כשהכותרת מבטיחה." },
              ].map((s) => (
                <div key={s.k} className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-4">
                  <div className="flex items-center gap-2">
                    <s.icon className="size-4 text-muted-foreground" aria-hidden="true" />
                    <span className="font-mono text-xs font-bold">{s.k}</span>
                  </div>
                  <p className="text-sm font-semibold">{s.t}</p>
                  <p className="text-xs leading-relaxed text-muted-foreground">{s.d}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </motion.section>

      {/* מפת הריבונות - מה בבית, מה בחוץ */}
      <motion.section {...f(0.15)} aria-labelledby="sov-map">
        <h2 id="sov-map" className="mb-4 text-xl font-bold tracking-tight sm:text-2xl">
          מפת הריבונות - מה בבית, מה בחוץ
        </h2>
        <div className="grid gap-4 md:grid-cols-2">
          {/* בבית */}
          <Card className="border-emerald-500/25">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Server className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                בבית - ריבוני
                <Badge variant="outline" className="ms-auto border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                  מופעל על ידינו
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {[
                { icon: BookOpen, t: "הספר (ledger.json)", d: "האמת הקנונית - בגיט שלנו, ניתן לשחזור מכל עותק" },
                { icon: KeyRound, t: "מפתח הרשת + זהויות הסוכנים", d: "נגזרים מה-seal; DAEMONs נגזרים דטרמיניסטית - self-heal מוכח" },
                { icon: BrainCircuitIcon, t: "המוח הריבוני", d: "3 מפתחות NVIDIA אטומים תחת גזירת מפתח-הרשת; רוטציה בפקודת מפעיל (לא אוטומטית — נמדחה בכנות)" },
                { icon: Coins, t: "שוק האמת", d: "ספר אירועים חתום במפתח הרשת; ההון נקודות מוניטין - אפס כסף" },
                { icon: Database, t: "פעימת הרשת (weave-beat)", d: "ה-runner הראשי: verify -> attest -> checkpoint -> push, בסנדבוקס ובענן כאחד" },
              ].map((r) => (
                <div key={r.t} className="flex items-start gap-3 rounded-lg border bg-muted/30 p-3.5">
                  <r.icon className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                  <div>
                    <p className="text-sm font-semibold">{r.t}</p>
                    <p className="text-xs leading-relaxed text-muted-foreground">{r.d}</p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* בחוץ */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Globe2 className="size-4 text-muted-foreground" aria-hidden="true" />
                בחוץ - עדים ציבוריים
                <Badge variant="outline" className="ms-auto">
                  נקרא/נכתב ב-$0
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {[
                { icon: Link2, t: "Steem", d: "קו עדות ציבורי חי — הדופק משדר בו פוסט-עוגן בחלון יומי-UTC (מקסימום אחד ליום)" },
                { icon: Link2, t: "Hive", d: "קו עדות מושהה — מפתחות ה-posting הוסרו מהריפו אחרי תקרית R11 וטרם נאטמו מחדש" },
                { icon: Layers, t: "ZERO EVM (Z Chain 9369)", d: "עוגן-EVM בגז 0x0 מדוד + השופט-החיצוני של שוק האמת (גובה בלוק חי)" },
                { icon: GitBranch, t: "GitHub (הלב הענן)", d: "Actions מריץ את הרשת בענן כל חצי שעה (:17/:47 — נקרא מה-workflow החי של התאום) - TAKEOVER כשהסנדבוקס ישן" },
                { icon: BrainCircuitIcon, t: "NVIDIA NIM - המודל", d: "המשקולות בחוץ; המפתחות, הרוטציה והזיהוי בבית. תווית אמת מוצהרת" },
              ].map((r) => (
                <div key={r.t} className="flex items-start gap-3 rounded-lg border bg-muted/30 p-3.5">
                  <r.icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <div>
                    <p className="text-sm font-semibold">{r.t}</p>
                    <p className="text-xs leading-relaxed text-muted-foreground">{r.d}</p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </motion.section>

      <motion.p {...f(0.2)} className="rounded-xl border border-dashed p-4 text-center text-xs leading-relaxed text-muted-foreground">
        הדוקטרינה המלאה חיה בקוד: SOVEREIGNTY.md בריפו הריבוני ·
        עמוד זה הוא האמנה בנוסחה הקבועה שלה. המדידות החיות שמאמתות את הטענות
        כאן נמצאות בדפים החיים (הבית, המרשם, הצי) - האימות מתבצע שם, במספרים,
        לא בעמוד זה.
      </motion.p>
    </div>
  );
}

// אייקון מקומי (BrainCircuit כבר בשימוש בעמודים אחרים - כאן כרכיב עצמאי)
import { BrainCircuit as BrainCircuitIcon } from "lucide-react";
