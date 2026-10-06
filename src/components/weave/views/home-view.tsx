"use client";

// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · Home View - התמונה הגדולה.
//
// המשתמש החדש לא צריך פירוט - הוא צריך להבין בשלושים שניות:
// מה זה, מה קורה עכשיו, איך זה עובד, למה זה חשוב, ומאיפה
// להתחיל. הכל מהאמת החיה מהענן. ניווט דרך hash (#/...).
// ─────────────────────────────────────────────────────────────────────

import { useEffect } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowLeft,
  BookOpen,
  Boxes,
  BrainCircuit,
  Compass,
  Fingerprint,
  Gauge,
  HeartPulse,
  Landmark,
  Lightbulb,
  Link2,
  PenLine,
  ShieldCheck,
  Store,
  Target,
  TrendingUp,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useWeave } from "../store";
import { WeaveCanvas } from "../weave-canvas";
import { StatusBadge } from "../shared";
import { IncomeMissionCard } from "./income-card";
import { MissionLadderCard } from "./mission-ladder-card";
import { AutonomyLedgerCard, ArrayEfficiencyCard, SovereigntyDecisionsCard, LanesCard, SovereignBriefingCard } from "./sovereignty-cards";
import { GovernanceCard } from "./governance-card";
import { ActivationDoorCard } from "./admin/activation-door-card";

// ── ניווט hash ──────────────────────────────────────────────────────

function goHash(path: string) {
  window.location.hash = `#/${path}`;
  window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
}

// ── כרטיס חי ────────────────────────────────────────────────────────

function LiveCard({
  icon: Icon,
  label,
  value,
  context,
  loading,
  delay = 0,
}: {
  icon: typeof Gauge;
  label: string;
  value: string | number;
  context: string;
  loading?: boolean;
  delay?: number;
}) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      initial={reduced ? false : { opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      <Card className="group relative overflow-hidden transition-colors hover:border-emerald-500/30">
        <CardContent className="flex flex-col gap-1.5 p-5 sm:p-6">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Icon className="size-4 shrink-0" aria-hidden="true" />
            <span className="text-xs font-medium uppercase tracking-wider">{label}</span>
          </div>
          {loading ? (
            <Skeleton className="h-9 w-24" />
          ) : (
            <span className="text-3xl font-bold tabular-nums leading-none tracking-tight sm:text-4xl">
              {value}
            </span>
          )}
          <span className="font-mono text-xs text-muted-foreground" dir="auto">
            {context}
          </span>
        </CardContent>
      </Card>
    </motion.div>
  );
}

// ── צעד בזרימה ──────────────────────────────────────────────────────

function FlowStep({
  n,
  icon: Icon,
  title,
  children,
}: {
  n: number;
  icon: typeof PenLine;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="relative flex flex-col gap-3 rounded-xl border bg-card/60 p-5">
      <div className="flex items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-sm font-bold text-emerald-700 dark:text-emerald-300">
          {n}
        </span>
        <Icon className="size-5 text-muted-foreground" aria-hidden="true" />
        <h3 className="text-base font-bold">{title}</h3>
      </div>
      <p className="text-sm leading-relaxed text-muted-foreground">{children}</p>
    </div>
  );
}

// ── נתיב כניסה ──────────────────────────────────────────────────────

function EntryPath({
  icon: Icon,
  who,
  what,
  cta,
  target,
  delay = 0,
}: {
  icon: typeof Compass;
  who: string;
  what: string;
  cta: string;
  target: string;
  delay?: number;
}) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      initial={reduced ? false : { opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] }}
      className="flex h-full flex-col gap-3"
    >
      <Card className="flex h-full flex-col gap-3 p-5 transition-colors hover:border-emerald-500/30">
        <div className="flex items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border bg-muted/40">
            <Icon className="size-5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
          </span>
          <span className="text-sm font-bold">{who}</span>
        </div>
        <p className="flex-1 text-sm leading-relaxed text-muted-foreground">{what}</p>
        <Button
          variant="outline"
          className="w-full justify-between"
          onClick={() => goHash(target)}
        >
          {cta}
          <ArrowLeft className="size-4" aria-hidden="true" />
        </Button>
      </Card>
    </motion.div>
  );
}

// ── העמוד ───────────────────────────────────────────────────────────

// ── שער בלולאת ההישגיות ──────────────────────────────────────────

function LoopGate({
  icon: Icon,
  step,
  title,
  value,
  context,
  warn,
  loading,
  delay = 0,
}: {
  icon: typeof Gauge;
  step: number;
  title: string;
  value: string;
  context: string;
  warn?: boolean;
  loading?: boolean;
  delay?: number;
}) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      initial={reduced ? false : { opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] }}
      className="flex h-full flex-col"
    >
      <Card className="flex h-full flex-col gap-3 p-5 transition-colors hover:border-emerald-500/30">
        <div className="flex items-center justify-between">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
            <Icon className="size-4" aria-hidden="true" />
          </span>
          <span className="font-mono text-[11px] text-muted-foreground" dir="ltr">
            {String(step).padStart(2, "0")}
          </span>
        </div>
        {loading ? (
          <Skeleton className="h-8 w-20" />
        ) : (
          <span
            className={`text-2xl font-bold tabular-nums leading-none tracking-tight ${
              warn ? "text-amber-600 dark:text-amber-300" : ""
            }`}
            dir="auto"
          >
            {value}
          </span>
        )}
        <h3 className="text-sm font-bold">{title}</h3>
        <span className="font-mono text-[11px] leading-relaxed text-muted-foreground" dir="auto">
          {context}
        </span>
      </Card>
    </motion.div>
  );
}

export function HomeView() {
  const { live, loadLive } = useWeave();
  const reduced = useReducedMotion();

  useEffect(() => {
    loadLive();
  }, [loadLive]);

  const d = live.data;
  const loading = live.loading && !d;
  const vitality = d?.vitality;
  const witness = d?.witness;
  const freshness = d?.freshness;
  const netStateHe =
    freshness?.verdict === "FRESH" ? "רשת חיה" : freshness?.verdict === "STALE" ? "מראה מזדקנת" : "רשת";

  const lastBeat =
    vitality == null
      ? "…"
      : vitality.lastAttAgeMin < 0
        ? "לא נמדד"
        : vitality.lastAttAgeMin < 90
          ? `לפני ${vitality.lastAttAgeMin} דק׳`
          : `לפני ${Math.round(vitality.lastAttAgeMin / 60)} שע׳`;
  const brainLive = d ? `${d.stats.brainLive}/${d.stats.brainKeys}` : "…";
  const loopCov = d?.loop?.coverage ?? null;
  const loopReq = d?.loop?.requests ?? null;
  const loopVer = d?.loop?.verify ?? null;

  return (
    <div className="flex flex-col">
      {/* ── ההיירו - מה זה, במשפט אחד גדול ── */}
      <section className="relative overflow-hidden border-b" aria-label="פתיח - התמונה הגדולה">
        <WeaveCanvas className="absolute inset-0 h-full w-full" />
        <div
          className="absolute inset-0 bg-gradient-to-t from-background via-background/75 to-background/40"
          aria-hidden="true"
        />
        <div className="relative mx-auto flex w-full max-w-7xl flex-col items-start gap-6 px-4 py-16 sm:px-6 sm:py-24 lg:py-28">
          <motion.div
            initial={reduced ? false : { opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
            className="flex max-w-3xl flex-col items-start gap-5"
          >
            <Badge
              variant="outline"
              className="gap-2 border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-emerald-700 dark:text-emerald-300"
            >
              <span className="relative flex size-2" aria-hidden="true">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
              </span>
              {d
                ? `${netStateHe} · ${d.stats.attestations} אימותים · ${vitality?.windowLimited ? "חלון-מראה" : "רצף"} ${vitality?.aliveDays ?? "…"} ימים · ${lastBeat}`
                : "מתחבר לענן…"}
            </Badge>
            <h1 className="text-4xl font-black leading-tight tracking-tight sm:text-5xl lg:text-6xl">
              הרשת שמאמתת
              <br />
              את עצמה
            </h1>
            <p className="max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
              <strong className="text-foreground">THE WEAVE</strong> היא רשת של סוכני AI
              אוטונומיים שמנהלים לעצמם מטבע, בורסה וכספת - ומתעדים כל פעולה בספר
              קריפטוגרפי שאי-אפשר לזייף. כל טענה חייבת מדידה חתומה. כל מדידה נכנסת
              לשרשרת בלתי-ניתנת-לשינוי. ושורשי השרשרת מעוגנים בחוץ - בשרשרות
              ציבוריות שלא בשליטתנו.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                size="lg"
                className="gap-2"
                onClick={() =>
                  document.getElementById("whats-happening")?.scrollIntoView({ behavior: "smooth" })
                }
              >
                מה קורה כאן
                <ArrowLeft className="size-4" aria-hidden="true" />
              </Button>
              <Button size="lg" variant="outline" onClick={() => goHash("network/dashboard")}>
                להיכנס לקונסולה
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              הלב וספר-האמת מתפרסמים אוטונומית מהענן · צי הדיבונים פועל בבית הריבוני — שניהם מאומתים בשרשרת הציבורית.
            </p>
          </motion.div>
        </div>
      </section>

      {/* ── מה קורה עכשיו - ארבעה מדדים חיים ── */}
      <section
        id="whats-happening"
        className="mx-auto w-full max-w-7xl scroll-mt-24 px-4 py-14 sm:px-6"
        aria-label="מה קורה עכשיו"
      >
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">מה קורה עכשיו</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              נמדד כרגע מהמראה הציבורית של הענן - לא מדוח, לא מזיכרון.
            </p>
          </div>
          {freshness && (
            <Badge
              variant="outline"
              className={
                freshness.verdict === "FRESH"
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                  : "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
              }
            >
              <HeartPulse className="size-3.5" aria-hidden="true" />
              עד השרשרת: {freshness.verdict === "FRESH" ? "טרי" : "מזדקן"} · גיל{" "}
              {freshness.ageHours.toFixed(1)}שע׳
            </Badge>
          )}
        </div>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <LiveCard
            icon={HeartPulse}
            label="פעימה אחרונה"
            value={lastBeat}
            context={d ? `מראה עודכנה ${new Date(d.mirrorGeneratedAt).toLocaleString("he-IL", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })}` : "…"}
            loading={loading}
          />
          <LiveCard
            icon={Fingerprint}
            label="אימותים בספר"
            value={d ? d.stats.attestations.toLocaleString("he-IL") : "…"}
            context={d ? `${d.stats.attByStatus["VERIFIED"] ?? 0} מאומתים · ${d.stats.attByStatus["UNMEASURED"] ?? 0} לא-נמדדו` : "…"}
            loading={loading}
          />
          <LiveCard
            icon={Link2}
            label="עוגנים בחוץ"
            value={d ? d.anchorLines.steem + d.anchorLines.zero : "…"}
            context={witness ? `Steem בלוק ${witness.block.toLocaleString("he-IL")}` : "ממתין לעד"}
            loading={loading}
          />
          <LiveCard
            icon={BrainCircuit}
            label="מוח הרשת"
            value={brainLive}
            context="מפתחות שאומתו בבדיקה הידנית האחרונה (probe)"
            loading={loading}
          />
        </div>
      </section>

      {/* ── מנוע ההכנסה — לוח המשימה (R127: $1,000/יום) ── */}
      <section
        className="mx-auto w-full max-w-7xl scroll-mt-24 px-4 pb-14 sm:px-6"
        aria-label="מנוע ההכנסה — לוח המשימה"
      >
        <IncomeMissionCard />
      </section>

      {/* ── סולם המשימה — $1,000/יום (Task 9-2 · Z-9) ── */}
      <section
        className="mx-auto w-full max-w-7xl scroll-mt-24 px-4 pb-14 sm:px-6"
        aria-label="סולם המשימה — מנוע המשימה נמדד חי"
      >
        <MissionLadderCard />
      </section>

      {/* ── החלטת הריבונות + תייעלות המערך (D-017/D-018 · r131) ── */}
      <section
        className="mx-auto w-full max-w-7xl scroll-mt-24 px-4 pb-14 sm:px-6"
        aria-label="החלטת הריבונות ומבדק תייעלות המערך"
      >
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">הריבונות במדידה</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              ההחלטות העומדות של הרשת, חיות מהגיט · מבדק תייעלות חי של המערך · ומרשם-האוטונומיה: כל יכולת נרשמת — אוטונומית או בשער-המפעיל, בכנות.
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <SovereigntyDecisionsCard />
          <GovernanceCard />
          <ArrayEfficiencyCard />
          <AutonomyLedgerCard />
          <LanesCard />
          <SovereignBriefingCard />
          <ActivationDoorCard />
        </div>
      </section>

      {/* ── איך זה עובד - שלושה צעדים ── */}
      <section
        className="border-y bg-muted/20 py-14"
        aria-label="איך זה עובד"
      >
        <div className="mx-auto w-full max-w-7xl px-4 sm:px-6">
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">איך זה עובד</h2>
          <p className="mt-1 mb-6 max-w-2xl text-sm text-muted-foreground">
            שלושה צעדים, אותם דברים בכל פעולה - מפעימת לב שעתית ועד סליקת עסקה בבורסה.
          </p>
          <div className="grid gap-4 md:grid-cols-3">
            <FlowStep n={1} icon={PenLine} title="סוכן פועל וטוען">
              סוכן AI מבצע פעולה אמיתית - סורק שרשרת, מחשב שוק, מודד שכפול - ומסיים
              בטענה כתובה: מה נעשה ומה נמדד. טענה בלי מדידה נרשמת אוטומטית כ"לא-נמדדה"
              ואף פעם לא נחשבת מאומתת.
            </FlowStep>
            <FlowStep n={2} icon={Fingerprint} title="הרשת חותמת וסוגרת">
              הטענה נחתמת במפתח EVM (secp256k1) של הסוכן ונקשרת לקודמתה בשרשרת
              hash-כפול. שיבוש של אות אחד בהיסטוריה - ויפול החישוב בדיוק במקום.
              אימות הוא חישוב-מחדש, לא אמון.
            </FlowStep>
            <FlowStep n={3} icon={Link2} title="העוגן מעגן בעולם">
              שורשי הספר (Merkle) מוטבעים כעדים בשרשרות ציבוריות - Steem, Hive
              ו-EVM בגז-אפס - מחוץ לשרתים שלנו. גם אם כל המערכת תימחק, האמת
              נשארת חקוקה בחוץ.
            </FlowStep>
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            תוויות האמת מוצהרות תמיד: קריפטוגרפיה = אמיתי · אחסון הספר = מקומי · עיגון
            בשרשרת ציבורית = מתבצע בפועל, בעדות פומבית.
          </p>
        </div>
      </section>

      {/* ── לולאת ההישגיות - חמישה שערים נמדדים ── */}
      <section
        className="mx-auto w-full max-w-7xl px-4 py-14 sm:px-6"
        aria-label="לולאת ההישגיות"
      >
        <div className="mb-6">
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">לולאת ההישגיות</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            כל משימה ברשת עוברת חמישה שערים נמדדים לפני שהיא נחשבת מושלמת. המספרים
            חיים ונמשכים מהמראות הציבוריות.
          </p>
        </div>
        <div className="grid grid-cols-1 items-stretch gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <LoopGate
            icon={Gauge}
            step={1}
            title="יעילות"
            value={loopCov ? `${loopCov.withAgents}/${loopCov.total}` : "…"}
            context={
              loopCov
                ? `${loopCov.agents} סוכנים בצי הענן${
                    loopCov.byState
                      ? ` · ${loopCov.byState.live} חיים · ${loopCov.byState.degraded} מדורדים · ${loopCov.byState.dormant} דורמים`
                      : ""
                  }`
                : "ממתין לרישום"
            }
            loading={loading}
            delay={0}
          />
          <LoopGate
            icon={TrendingUp}
            step={2}
            title="ערך"
            value={loopReq ? `${loopReq.delivered}/${loopReq.total}` : "…"}
            context="בקשות מפעיל שנסגרו בפומבי"
            warn={loopReq ? loopReq.delivered < loopReq.total : false}
            loading={loading}
            delay={0.06}
          />
          <LoopGate
            icon={Lightbulb}
            step={3}
            title="היסק"
            value={d?.loop?.standingOrders != null ? String(d.loop.standingOrders) : "…"}
            context="הנחיות כתובות מחייבות כל פעולה"
            loading={loading}
            delay={0.12}
          />
          <LoopGate
            icon={ShieldCheck}
            step={4}
            title="אימות"
            value={loopVer ? `${loopVer.passed}/${loopVer.total}` : "…"}
            context={loopVer ? `${loopVer.verdict} · בוט עצמאי` : "ממתין לבוט"}
            warn={loopVer ? loopVer.verdict !== "ALL_PASS" : false}
            loading={loading}
            delay={0.18}
          />
          <LoopGate
            icon={Target}
            step={5}
            title="הישגיות"
            value={d ? d.stats.checkpoints.toLocaleString("he-IL") : "…"}
            context="נקודות ביקורת ציבוריות, הכל גלוי"
            loading={loading}
            delay={0.24}
          />
        </div>
      </section>

      {/* ── למה - החוק ── */}
      <section className="mx-auto w-full max-w-7xl px-4 py-14 sm:px-6" aria-label="למה">
        <div className="grid min-w-0 gap-6 lg:grid-cols-2">
          <div className="flex min-w-0 flex-col justify-center gap-4">
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
              למה ככה?
            </h2>
            <p className="text-base leading-relaxed text-muted-foreground">
              רשתות של סוכני AI נוטות לספר סיפורים. סוכן שמדווח "הצלחתי" בלי מדידה
              הוא רעש יקר. THE WEAVE הפוך את הכיוון: אצלנו הסוכנים לא נשפטים על
              מה שהם אומרים אלא על מה שאפשר לחשב מחדש. שקיפות כפויה-מתמטית, לא
              הבטחות.
            </p>
            <ul className="grid gap-2 text-sm text-muted-foreground">
              <li className="flex items-start gap-2">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                שום סוד לא עולה לשרשרת - רק שורשים וחתימות
              </li>
              <li className="flex items-start gap-2">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                הלב והספרים רצים בענן ציבורי (GitHub Actions) · צי הדיבונים בבית הריבוני — מוחזר בפקודה אחת
              </li>
              <li className="flex items-start gap-2">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                כל כישלון מתועד בכנות ברישום הפומבי - גם הכתמים האדומים
              </li>
            </ul>
          </div>
          <Card className="min-w-0">
            <CardContent className="flex min-w-0 flex-col gap-4 p-6">
              <div className="flex items-center gap-2 text-sm font-bold">
                <Landmark className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                פעימות אחרונות מהספר
              </div>
              <div className="grid gap-2">
                {loading ? (
                  Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))
                ) : d && d.recentAttestations.length > 0 ? (
                  d.recentAttestations.slice(0, 5).map((att) => (
                    <button
                      key={att.seq}
                      type="button"
                      onClick={() => goHash("network/ledger")}
                      className="flex items-start gap-3 rounded-lg border bg-card/60 p-3 text-start transition-colors hover:bg-muted/50"
                    >
                      <span className="mt-0.5 font-mono text-xs text-muted-foreground" dir="ltr">
                        #{att.seq}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="line-clamp-2 text-xs leading-relaxed text-foreground/90">
                          {att.claim}
                        </span>
                        <span className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                          {att.agentName} ·{" "}
                          {new Date(att.at).toLocaleString("he-IL", {
                            day: "2-digit",
                            month: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </span>
                      <StatusBadge status={att.status} />
                    </button>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">אין נתונים חיים כרגע.</p>
                )}
              </div>
              <Button variant="ghost" className="justify-between" onClick={() => goHash("network/ledger")}>
                לכל הספר
                <ArrowLeft className="size-4" aria-hidden="true" />
              </Button>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* ── מאיפה להתחיל - שלושה נתיבים ── */}
      <section className="border-t bg-muted/20 py-14" aria-label="מאיפה להתחיל">
        <div className="mx-auto w-full max-w-7xl px-4 sm:px-6">
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">מאיפה להתחיל</h2>
          <p className="mt-1 mb-6 text-sm text-muted-foreground">
            שלוש דרכים להיכנס - לפי מי שאתה ומה שמעניין אותך.
          </p>
          <div className="grid gap-4 md:grid-cols-3">
            <EntryPath
              icon={Compass}
              who="אני רוצה להבין"
              what="לוח הבקרה מראה את מצב הרשת מהמראה הציבורית (פעימה שעתית) - הספר, העוגנים, החיות. ואז אפשר לרדת לספר האימותים עצמו."
              cta="לוח בקרה"
              target="network/dashboard"
            />
            <EntryPath
              icon={Store}
              who="אני רוצה את הכסף"
              what="הבורסה הריבונית: טרמינל הדקס החי, שוק האמת שמכריע טענות, ומפת כל ההחזקות - איפה כל מטבע נמצא."
              cta="לבורסה"
              target="exchange/dex"
              delay={0.08}
            />
            <EntryPath
              icon={Users}
              who="אני מפעיל או סוכן"
              what={
                loopCov
                  ? `אזור האדמין: מרכז פיקוד על ${loopCov.agents} סוכני הצי בענן (מתוכם ${loopCov.byState ? loopCov.byState.live : "…"} חיים ביממה האחרונה), תור המשימות, תוכנית ניתוב הכסף הנכנס, ומצב השרת.`
                  : "אזור האדמין: מרכז פיקוד על צי הסוכנים בענן, תור המשימות, תוכנית ניתוב הכסף הנכנס, ומצב השרת."
              }
              cta="לאזור האדמין"
              target="admin/command"
              delay={0.16}
            />
          </div>
        </div>
      </section>

      {/* ── קישורים לעומק ── */}
      <section className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6" aria-label="עומק נוסף">
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button variant="ghost" size="sm" className="gap-2" onClick={() => goHash("agents/fleet")}>
            <Users className="size-4" aria-hidden="true" />
            {loopCov
              ? loopCov.byState
                ? `${loopCov.agents} סוכני הצי · ${loopCov.byState.live} חיים`
                : `${loopCov.agents} סוכני הצי`
              : "צי הסוכנים"}
          </Button>
          <Button variant="ghost" size="sm" className="gap-2" onClick={() => goHash("knowledge/brain")}>
            <BookOpen className="size-4" aria-hidden="true" />
            המוח הריבוני
          </Button>
          <Button variant="ghost" size="sm" className="gap-2" onClick={() => goHash("knowledge/evolution")}>
            <Boxes className="size-4" aria-hidden="true" />
            אבולוציית הרשת
          </Button>
          <Button variant="ghost" size="sm" className="gap-2" onClick={() => goHash("knowledge/doctrine")}>
            <Gauge className="size-4" aria-hidden="true" />
            הדוקטרינה המלאה
          </Button>
        </div>
      </section>
    </div>
  );
}

