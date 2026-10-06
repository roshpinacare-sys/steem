"use client";

// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · Admin - משימות וכסף.
//
// מרכז ההנחיה האוטונומית: מה קיים, מה צריך לקרות, איך מנתבים את
// הכסף הנכנס, איך משתמשים ברשויות הפרסום, ומה אסור לעשות כדי
// שלא יעיפו אותנו. זה המקום שבו סוכן חדש שואל "מה עושים עכשיו?"
// ומקבל תשובה מדורגת ובטוחה.
// ─────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Banknote,
  Coins,
  Flag,
  Gauge,
  Landmark,
  ListOrdered,
  Lock,
  PenLine,
  ScrollText,
  ShieldAlert,
  ShieldCheck,
  Signal,
  Wallet,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { AdminGate } from "@/components/weave/operator";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useWeave } from "../../store";

// ── מבנה נתונים: משימה ──────────────────────────────────────────────

interface Mission {
  id: string;
  priority: "P0" | "P1" | "P2" | "P3";
  title: string;
  why: string;
  how: string[];
  gate?: string;
  owner: string;
}

const MISSIONS: Mission[] = [
  {
    id: "money-routing",
    priority: "P0",
    title: "הכנת ניתוב הכסף הנכנס (מועד הגעה לא נמדד)",
    why: "מועדף כסף אמור להיכנס למערכת דרך כתובות ההפקדה. לפני שהוא מגיע חייבת לעמוד תוכנית ניתוב מדודה - אחרת הוא יישב בטיפשות בכתובת.",
    how: [
      "dex-watch כבר סורק את 4 הכתובות (TRON/ETH/SOL/BTC) כל 20 דק' - לוודא שהסריקה תופסת את ההפקדה בפועל",
      "לפי תוכנית הניתוב למטה: חותם EVM ממומן -> כוח פרסום -> עתודה",
      "כל העברה מתועדת בספר כאימות MARKET/MEASUREMENT עם txid כראיה",
    ],
    owner: "המפעיל + dex-watch + weave-heart",
  },
  {
    id: "foundry-ci",
    priority: "P1",
    title: "foundry CI - נרפא מקומית (היסטורי, נסגר ב-r118)",
    why: "נסגר: ה-CI של saos-sovereign-foundry נכשל ב-100 הריצות האחרונות (בדיקות חוזה API בגל הייבוא) ורדם מ-2026-09-14 - עד שהושמש ב-r118 (2026-09-24): המאמת המקומי foundry-selftest מאמת אותו מדי יום ודוחף פסק-דין [bot] לגיט. אומת אז PASS בדחיפה האחרונה.",
    how: [
      "בוצע (r118): foundry-selftest (install+prisma+tsc) מאמת את הריפו מדי יום מקומית",
      "בוצע (r118): כל פסק-דין נדחף לגיט בזהות [bot] ואומת מול GitHub API",
      "נשאר כאן כתיעוד היסטורי - אין פעולה פתוחה",
    ],
    owner: "foundry-selftest · דיבון fleet-verify",
  },
  {
    id: "evm-gates",
    priority: "P2",
    title: "שערי EVM - חותם ממומן פותח את השרשרת הציבורית",
    why: "EVM-1 (פריסת WeaveAnchorRegistry ב-testnet) חסום רק על מימון. קו ה-ZERO כבר מוכיח עיגון EVM בגז-אפס - החוזה המלא הוא הצעד הבא.",
    how: [
      "מימון קטן לחותם testnet (חלק מניתוב הכסף)",
      "פריסה דרך deploy-kit שכבר קיים בעוגן EVM -> תיעוד כתובת בספר",
      "סגירת השער רק באימות ANCHOR VERIFIED עם כתובת+txid",
    ],
    gate: "EVM-1",
    owner: "המפעיל + סוכן RELAYER",
  },
  {
    id: "posting-power",
    priority: "P2",
    title: "ארגון כוח הפרסום (RC/מנה) בשרשרות",
    why: "קווי העוגן ב-Steem/Hive נדלגים כשהמנה ברגנרציה (RC-SKIPPED). כוח פרסום גדול יותר = עיגון רציף יותר.",
    how: [
      "מדידת תקרת הפעימות הנוכחית מול המנה החיה (נוסחת הרגנרציה כבר תוקנה)",
      "power-up מחשבונות הרשות כשהכסף מגיע - חלק מניתוב הכסף",
      "פריסת פעולות על פני קווים (כבר קיים: lines מזניק anchor+zero ברצף)",
    ],
    gate: "R2",
    owner: "weave-anchor-lines",
  },
  {
    id: "hub-search",
    priority: "P3",
    title: "אינדקס חיפוש ב-hub הציבורי",
    why: "83 עמודי תוכן בקונסולה הציבורית בלי חיפוש - החומר קיים אבל קשה למצוא.",
    how: ["מנוע חיפוש סטטי (אינדקס JSON שנבנה ב-build)", "מיזוג עם ה-renderer הקיים"],
    owner: "סוכן BUILDER (עתידי)",
  },
  {
    id: "ui-engines",
    priority: "P3",
    title: "grid98 + Saosmartwallet כמנועי ממשק",
    why: "שני נכסים מהארכיון שהומלצו כמנועי תצוגה ציבוריים - עדיין לא מותקנים.",
    how: ["בחינת הנכסים בארכיון", "התקנה כרכיבי תצוגה בקונסולה הציבורית"],
    owner: "סוכן BUILDER (עתידי)",
  },
];

const PRIORITY_STYLE: Record<Mission["priority"], string> = {
  P0: "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300",
  P1: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  P2: "border-teal-500/40 bg-teal-500/10 text-teal-700 dark:text-teal-300",
  P3: "border-zinc-500/40 bg-zinc-500/10 text-zinc-700 dark:text-zinc-300",
};

// ── ניתוב כסף ──────────────────────────────────────────────────────

const MONEY_BUCKETS = [
  {
    icon: Landmark,
    title: "חותם EVM ממומן",
    share: "35%",
    why: "פותח את שער EVM-1: פריסת WeaveAnchorRegistry ב-testnet + עיגון עצמאי מחוץ לגיטהאב. הכי הרבה ערך לכיוון הכסף.",
    items: ["ETH ל-testnet לחותם הרשת", "גז לעיגון שורשים תקופתי"],
  },
  {
    icon: Signal,
    title: "כוח פרסום בשרשרות",
    share: "35%",
    why: "power-up לחשבונות הרשות (@cashmachine, @lsa) - מנה גדולה יותר = עיגון רציף בלי דילוגים.",
    items: ["STEEM/HIVE power-up", "תחזוקת מנה לקווי העדות"],
  },
  {
    icon: Wallet,
    title: "עתודה תפעולית",
    share: "20%",
    why: "ריפוים פרטיים צורכים מכסות Actions; שדרוגים וגיבויים. העתודה מבטיחה שהרשת לא נעצרת מסיבה כספית.",
    items: ["מכסות Actions לריפוים פרטיים", "גיבויים קרים"],
  },
  {
    icon: Coins,
    title: "נזילות בורסה",
    share: "10%",
    why: "עומק בריכות AMM בדקס - מטבע שנסחר בקלות הוא מטבע שמוכיח את עצמו.",
    items: ["הוספת נזילות לבריכות", "תמחור הוגן ומדיד"],
  },
];

// ── רשויות פרסום ───────────────────────────────────────────────────

const AUTHORITIES = [
  {
    name: "@cashmachine",
    scope: "Steem · posting",
    usedBy: "weave-heart · weave-anchor · weave-console",
    ops: "saos.weave.core.v1 - עדות שורש-ספר ב-custom_json",
    note: "העד הראשי. קודם כך הוא היה בלוק 109,612,647 - ההיסטוריה פומבית לגמרי.",
  },
  {
    name: "@lsa",
    scope: "Steem · posting",
    usedBy: "dex-beat · saos-dex",
    ops: "saos-dex.anchor.v1 - עדות שורש-בורסה",
    note: "תקדים חי לקווי עדות מרובים מחשבונות שונים.",
  },
];

// ── חוקי בטיחות ────────────────────────────────────────────────────

const SAFETY = [
  {
    ok: true,
    rule: "קריאה בלבד משרשרות ציבוריות",
    detail: "RPC ציבורי, בלי מפתחות, בלי rate-abuse - מה ש-dex-watch ו-cloud-heart עושים.",
  },
  {
    ok: true,
    rule: "כתיבה רק בריפואים שלנו",
    detail: "קומיטים חתומים של בוטים מזוהים, הודעות קומיט כנות (גם דילוג-RC נרשם ככזה).",
  },
  {
    ok: true,
    rule: "עיגון בפעולות משמעותיות בלבד",
    detail: "custom_json עם שורש אמיתי - לא ספאם, לא טרנזאקציות ריקות.",
  },
  {
    ok: false,
    rule: "אסור: ספאם, מעקב המוני, ניצול rate",
    detail: "כל פעולה שעלולה לסמן אותנו כשימוש לרעה בפלטפורמה - אסורה. שם המשחק: ערך לכל פעולה.",
  },
  {
    ok: false,
    rule: "אסור: סודות על השרשרת או בקוד",
    detail: "רק שורשים וחתימות עולים. מפתחות חיים ב-Secrets. PAT לא נכתב לעולם ל-DB/לוג/תגובה.",
  },
  {
    ok: false,
    rule: "אסור: טענה בלי מדידה",
    detail: "החוק הראשון. טענה בלי ראיה נרשמת כלא-נמדדה ולא סוגרת שער.",
  },
];

// ── העמוד ───────────────────────────────────────────────────────────

export function AdminMissionsView() {
  const { stages, loadStages, registry, loadRegistry } = useWeave();
  const [tick, setTick] = useState(0);

  useEffect(() => {
    loadStages();
    loadRegistry();
  }, [loadStages, loadRegistry]);

  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 60_000);
    return () => clearInterval(t);
  }, []);
  void tick;

  const openGates = useMemo(
    () => (stages.data ?? []).filter((s) => s.state !== "DONE").slice(0, 6),
    [stages.data]
  );

  return (
    <AdminGate>
      <div className="mb-6">
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight sm:text-3xl">
          <ListOrdered className="size-7 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
          משימות וכסף
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          מרכז ההנחיה האוטונומית: מה קיים, מה דחוף, איך מנתבים את הכסף הנכנס, איך
          משתמשים ברשויות הפרסום - ומה אסור לעשות כדי שנמשיך להיות רצויים בכל
          פלטפורמה. סוכן שמתעורר ושואל "מה עושים?" - התשובה מתחילה כאן.
        </p>
      </div>

      {/* תור המשימות */}
      <section className="mb-10" aria-label="תור המשימות">
        <h2 className="mb-3 flex items-center gap-2 text-lg font-bold">
          <Flag className="size-5 text-amber-500" aria-hidden="true" />
          תור המשימות (לפי עדיפות)
        </h2>
        <div className="grid gap-3">
          {MISSIONS.map((m) => (
            <Card key={m.id} className="overflow-hidden">
              <CardContent className="flex flex-col gap-3 p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className={cn("font-mono text-xs font-bold", PRIORITY_STYLE[m.priority])}>
                    {m.priority}
                  </Badge>
                  <h3 className="text-sm font-bold sm:text-base">{m.title}</h3>
                  {m.gate && (
                    <Badge variant="outline" className="text-[10px]">
                      שער {m.gate}
                    </Badge>
                  )}
                </div>
                <p className="text-sm leading-relaxed text-muted-foreground">{m.why}</p>
                <ul className="grid gap-1.5 text-xs text-muted-foreground">
                  {m.how.map((h, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-emerald-500" aria-hidden="true" />
                      {h}
                    </li>
                  ))}
                </ul>
                <div className="flex items-center gap-1.5 border-t pt-2.5 text-[11px] text-muted-foreground">
                  <PenLine className="size-3.5" aria-hidden="true" />
                  אחריות: {m.owner}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* ניתוב כסף */}
      <section className="mb-10" aria-label="ניתוב הכסף הנכנס">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="flex items-center gap-2 text-lg font-bold">
            <Banknote className="size-5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
            תוכנית ניתוב הכסף הנכנס
          </h2>
          <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300">
            <AlertTriangle className="size-3" aria-hidden="true" />
            מועד הגעה לא נמדד
          </Badge>
        </div>
        <p className="mb-4 max-w-3xl text-sm text-muted-foreground">
          כשכסף נכנס לכתובות ההפקדה, dex-watch מזהה אותו תוך 20 דקות. הניתוב
          מטרתו להמיר כל יחידת ערך לחוסן רשת: עצמאות עיגון, רציפות פרסום,
          ויכולת הפעלה. האחוזים הם הנחיית-על - המפעיל יכול לשנות בכל עת.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          {MONEY_BUCKETS.map((b, i) => (
            <Card key={b.title} className="overflow-hidden">
              <CardContent className="flex flex-col gap-3 p-5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-emerald-500/30 bg-emerald-500/10">
                      <b.icon className="size-4.5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                    </span>
                    <h3 className="text-sm font-bold">{b.title}</h3>
                  </div>
                  <span className="text-2xl font-black tabular-nums text-emerald-600 dark:text-emerald-400">
                    {b.share}
                  </span>
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">{b.why}</p>
                <ul className="grid gap-1 text-[11px] text-muted-foreground">
                  {b.items.map((it) => (
                    <li key={it} className="flex items-center gap-1.5">
                      <span className="size-1 shrink-0 rounded-full bg-emerald-500" aria-hidden="true" />
                      {it}
                    </li>
                  ))}
                </ul>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-emerald-500"
                    style={{ width: b.share }}
                  />
                </div>
                <span className="text-[10px] text-muted-foreground">חלוקה מוצעת {i + 1}/4</span>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* שערים פתוחים */}
      <section className="mb-10" aria-label="שערים פתוחים">
        <h2 className="mb-3 flex items-center gap-2 text-lg font-bold">
          <Gauge className="size-5 text-teal-600 dark:text-teal-400" aria-hidden="true" />
          שערים פתוחים (מהתוכנית החיה)
        </h2>
        {stages.loading && !stages.data ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-28" />
            ))}
          </div>
        ) : openGates.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {openGates.map((s) => (
              <div key={s.code} className="rounded-xl border bg-card/60 p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs font-bold">{s.code}</span>
                  <Badge variant="outline" className="text-[10px]">
                    {s.state}
                  </Badge>
                </div>
                <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                  {s.title}
                </p>
                <p className="mt-2 text-[10px] text-muted-foreground">שער: {s.gateType}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">אין נתוני שלבים - התוכנית המקומית לא נטענה.</p>
        )}
      </section>

      {/* רשויות פרסום */}
      <section className="mb-10" aria-label="רשויות פרסום">
        <h2 className="mb-3 flex items-center gap-2 text-lg font-bold">
          <ScrollText className="size-5 text-emerald-500" aria-hidden="true" />
          רשויות הפרסום - הכוח להישמע בחוץ
        </h2>
        <p className="mb-4 max-w-3xl text-sm text-muted-foreground">
          הסוכנים מחוברים לרשויות פרסום (posting authority) בשרשרות הציבוריות.
          דרכן הרשת מעידה על עצמה מחוץ לגיטהאב - וכל פוסט/פעולה הוא עדות
          פומבית בלתי-ניתנת למחיקה.
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          {AUTHORITIES.map((a) => (
            <Card key={a.name}>
              <CardContent className="flex flex-col gap-2.5 p-5">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-sm font-bold">{a.name}</span>
                  <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 text-xs">
                    {a.scope}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium">משתמשים:</span> {a.usedBy}
                </p>
                <p className="rounded-lg bg-muted/40 p-2.5 font-mono text-[11px] leading-relaxed" dir="ltr">
                  {a.ops}
                </p>
                <p className="text-[11px] leading-relaxed text-muted-foreground">{a.note}</p>
              </CardContent>
            </Card>
          ))}
        </div>
        <Card className="mt-4">
          <CardContent className="flex flex-col gap-2 p-5 text-sm">
            <div className="flex items-center gap-2 font-bold">
              <Lock className="size-4 text-muted-foreground" aria-hidden="true" />
              כללי שימוש ברשות
            </div>
            <ul className="grid gap-1.5 text-xs text-muted-foreground">
              <li>· פעולה אחת משמעותית גדולה מעשר ריקות - הרשות היא נכס מוניטין, לא צינור רעש.</li>
              <li>· כבד את המנה: כשה-RC ברגנרציה - דלג בכנות ונסה בפעימה הבאה (כמו weave-anchor).</li>
              <li>· כל פעולה חדשה דרך רשות - קודם מדידה, אחר כך אימות בספר.</li>
            </ul>
          </CardContent>
        </Card>
      </section>

      {/* חוקי בטיחות */}
      <section className="mb-10" aria-label="חוקי בטיחות">
        <h2 className="mb-3 flex items-center gap-2 text-lg font-bold">
          <ShieldAlert className="size-5 text-rose-500" aria-hidden="true" />
          חוקי הבטיחות - איך דוחפים אוטונומית בלי שיעיפו אותנו
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {SAFETY.map((s) => (
            <div
              key={s.rule}
              className={cn(
                "rounded-xl border p-4",
                s.ok
                  ? "border-emerald-500/30 bg-emerald-500/5"
                  : "border-rose-500/30 bg-rose-500/5"
              )}
            >
              <div className="flex items-start gap-2.5">
                {s.ok ? (
                  <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                ) : (
                  <ShieldAlert className="mt-0.5 size-4 shrink-0 text-rose-500" aria-hidden="true" />
                )}
                <div>
                  <div className="text-sm font-bold">{s.rule}</div>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{s.detail}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* מה קיים */}
      {registry.data && (
        <section aria-label="מה קיים">
          <h2 className="mb-3 flex items-center gap-2 text-lg font-bold">
            <Gauge className="size-5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
            מה קיים (מלאי חי)
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Card>
              <CardContent className="p-4 text-center">
                <div className="text-3xl font-black tabular-nums">{registry.data.reposTotal}</div>
                <div className="mt-1 text-xs text-muted-foreground">ריפואים</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <div className="text-3xl font-black tabular-nums">{registry.data.agents.length}</div>
                <div className="mt-1 text-xs text-muted-foreground">סוכנים אוטונומיים</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <div className="text-3xl font-black tabular-nums">{registry.data.reposWithAgents.length}</div>
                <div className="mt-1 text-xs text-muted-foreground">ריפואים פעילים</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <div className="text-3xl font-black tabular-nums">{registry.data.reposIdle.length}</div>
                <div className="mt-1 text-xs text-muted-foreground">ארכיונים שקטים</div>
              </CardContent>
            </Card>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            הרישום המלא חי בעמוד{" "}
            <a
              href="#/agents/fleet"
              className="font-medium text-emerald-600 underline-offset-4 hover:underline dark:text-emerald-400"
            >
              הצי החי
            </a>{" "}
            - לכל סוכן: תפקיד, קלט -&gt; פלט, קדנס ויעילות נמדדת.
          </p>
        </section>
      )}
    </AdminGate>
  );
}
