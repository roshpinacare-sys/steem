"use client";

// ─────────────────────────────────────────────────────────────────────
// FLYWHEEL VIEW · דבר גורר דבר — הגלגל הריבוני (v20).
//
// התשובה לשאלת המפעיל: הגריד לבדו אינו מספיק. נדרשת ריבונות
// מלאה שבה כל כלי מזרים לכלי הבא — זרימת-מזומנים רציפה
// שמתחילה בהפקדה וחוזרת אליה בערך גדול יותר:
//
//   הפקדה → זיכוי → שוק-כספים/כספת → נזילות-בורסה → עמלות
//   → אוצר → תגמולים → הפקדה גדולה יותר. דבר גורר דבר.
//
// ארבעה חלקים:
//   1. ארבע השאלות — תשובה מראיות חיות בלבד.
//   2. ה-Roast — השוואה חדה מול Aave/Compound/Uniswap/Curve/
//      Yearn/Maker, כולל TVL חי מ-DefiLlama. בלי חנופה, בלי המצאה.
//   3. שוק-הכספים — עקומת ריבית kinked בסטנדרט Aave-v3, מחושבת
//      מהנזילות והנעילות האמיתיות של השרשרת.
//   4. הכספות והגלגל — אסטרטגיות תשואה ממדוד (lpYieldBps אמיתי)
//      + דיאגרמת הגלגל עם מספר חי בכל חוליה.
// ─────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowDown,
  ArrowLeft,
  Banknote,
  Coins,
  Flame,
  Gauge,
  Layers,
  Loader2,
  Percent,
  RefreshCw,
  Repeat,
  ShieldCheck,
  Sparkles,
  Swords,
  TrendingUp,
  Vault,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useWeave } from "@/components/weave/store";

// ── טיפוסי ה-API (/api/defi) ────────────────────────────────────────

interface DefiDoc {
  ok: boolean;
  at: string;
  cached?: boolean;
  down?: string[];
  world?: {
    height: number | null;
    treasuryProfitUsds: number | null;
    treasuryProfitEverUsds?: number | null; // FIX(R46): המונה-המונוטוני — מצטבר-לנצח, לעולם לא נשחק לדלק
    // FIX(R47): THE-SAVE — החיסכון-החי על-השרשרת: קרן, הכנסה-מדודה, שיעור-יום-אמת
    // FIX(R48 · calibration-truth): apyBps=null בזמן-חלון-הכיול (החלון-הראשון שלאחר-מיגרציה
    // קולט-הצטבר-היסטורי ואינו-מפורסם-כשנתי). demoUsds — גילוי-מלא של עמדת-ההדגמה-של-המפעיל.
    savings?: {
      potUsds: number; savers: number; paidUsds: number; dayPaidUsds: number; dayPaidPrevUsds: number;
      apyBps: number | null; windows?: number; demoUsds?: number; dayMarkH?: number | null;
      incomeSourceUsds: number;
      incomeStreams: { vaultInterestUsds: number; lendReserveUsds: number; feeShareUsds: number };
      dayWindowBlocks: number | null; feeSharePct: number | null;
    };
    fills: number | null; swaps: number | null; liveOrders: number | null; opsTotal: number | null;
    pools: Array<{
      key: string; ra: number; rb: number; swaps: number;
      feeAccruedUsds: number; feeBps: number | null;
      lpYieldBps: number | null; derived: boolean;
    }>;
    market: MarketState;
  } | null;
  money?: {
    powerdown: { active: boolean; weeklySp: number | null; nextPayout: string | null };
    weeklyUsd: number | null;
    grid: { armed: boolean; verdict: string | null; filledTotal: number; externalFlowUsd: number; blockers: string[] };
    deposits: { total: number; chains: Record<string, string> | null };
    invariantHolds: boolean | null;
  } | null;
  giants?: {
    live: boolean;
    list: Array<{ he: string; what: string; tvlUsd: number | null }>;
  } | null;
  vaults?: Array<{
    key: string; apr: number; apy: number; tvlUsds: number;
    feesAccruedUsds: number | null; swaps: number | null; feeBps: number | null;
  }>;
  flywheel?: Record<string, { label: string; value: number | string; unit: string; detail: string }>;
  compounding?: { marketApy: number; marketBorrowApy: number; note: string };
}

// ── טיפוס מצב שוק-הכספים (חלץ לקריאות) ─────────────────────────────

interface MarketState {
  supplyUsds: number | null; treasuryUsds: number | null; operatorUsds: number | null; arenaUsds: number | null;
  borrowedUsds: number | null; utilization: number | null; borrowApr: number | null; supplyApr: number | null;
  onChain?: boolean;
  onChainNote?: string;
  onChainTotals?: { interestPaidUsds: number; reservesToTreasuryUsds: number; opens: number; closes: number; treasuryEarnedUsds: number } | null;
  policy: {
    optimalUtilBps: number; baseApr: number; slope1: number; slope2: number;
    reserveFactor: number; ltv: number; liquidationThreshold: number; liquidationPenalty: number;
  };
}

// ── עזרים ────────────────────────────────────────────────────────────

function fmtUsd(v: number | null | undefined, digits = 2): string {
  if (v == null || !isFinite(v)) return "—";
  if (Math.abs(v) >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (Math.abs(v) >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  return v.toLocaleString("he-IL", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}
function fmtPct(v: number | null | undefined, digits = 2): string {
  if (v == null || !isFinite(v)) return "—";
  return `${(100 * v).toFixed(digits)}%`;
}
function dataAge(iso: string | undefined): string {
  if (!iso) return "?";
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (min < 1) return "כרגע";
  if (min < 60) return `לפני ${min} דק׳`;
  return `לפני ${Math.round(min / 60)} שע׳`;
}

// ── סקשן מארגן ────────────────────────────────────────────────────────

function FlySection({
  id, icon: Icon, title, sub, children,
}: {
  id: string; icon: typeof Gauge; title: string; sub?: string; children: React.ReactNode;
}) {
  return (
    <motion.section
      id={id}
      initial={{ opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className="scroll-mt-24"
    >
      <div className="mb-3 flex items-center gap-2.5">
        <div className="flex size-9 items-center justify-center rounded-xl border border-[#d4af37]/30 bg-[#d4af37]/10">
          <Icon className="size-4.5 text-[#e8cd6e]" aria-hidden />
        </div>
        <div>
          <h2 className="text-base font-bold text-zinc-100 sm:text-lg">{title}</h2>
          {sub && <p className="text-[11px] text-zinc-500">{sub}</p>}
        </div>
      </div>
      {children}
    </motion.section>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// הרכיב הראשי
// ═══════════════════════════════════════════════════════════════════════

export function FlywheelView() {
  const [data, setData] = useState<DefiDoc | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const reduced = useReducedMotion();
  // r121: טענות הרשת נמשכות מהמראה החיה — לא מספרים קשיחים שהתיישנו
  const { live, loadLive } = useWeave();
  const liveStats = live.data ?? null;

  useEffect(() => {
    if (!live.data && !live.loading) void loadLive();
  }, [live.data, live.loading, loadLive]);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/defi", { cache: "no-store" });
      if (!res.ok) throw new Error(`http ${res.status}`);
      setData((await res.json()) as DefiDoc);
      setErr(null);
    } catch (e) {
      setErr(String((e as Error).message));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 90_000);
    return () => clearInterval(t);
  }, [load]);

  const w = data?.world ?? null;
  const m = data?.money ?? null;
  const market = w?.market ?? null;
  // r139-c · אמת-עקומה: הפרמטרים נשאבים ממדיניות-ה-API החיה; בהיעדרם — ברירת-מחדל קבועה בקוד, ומתויגת כך.
  const livePolicy = market?.policy ?? null;
  const curvePolicy = {
    baseApr: livePolicy?.baseApr ?? 0.01,
    slope1: livePolicy?.slope1 ?? 0.04,
    slope2: livePolicy?.slope2 ?? 0.6,
    kinkPct: livePolicy ? livePolicy.optimalUtilBps / 100 : 80,
  };

  return (
    <div className="mx-auto w-full max-w-7xl space-y-8 px-4 py-6 sm:px-6">
      {/* ── כותרת הגלגל ── */}
      <header className="relative overflow-hidden rounded-2xl border border-[#d4af37]/25 bg-gradient-to-b from-[#d4af37]/[0.08] to-transparent p-5 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-2xl">
            <div className="mb-1 flex items-center gap-2 text-[11px] font-semibold tracking-wide text-[#e8cd6e]">
              <Repeat className="size-3.5" aria-hidden />
              DAVAR GORER DAVAR · דבר גורר דבר
            </div>
            <h1 className="text-xl font-black leading-tight text-zinc-50 sm:text-2xl">
              הגלגל הריבוני — זרימת-מזומנים רציפה בין הכלים
            </h1>
            <p className="mt-2 text-xs leading-relaxed text-zinc-400 sm:text-[13px]" dir="auto">
              הגריד לבדו אינו מספיק. התשובה: מערך שלם שבו כל כלי מזרים לכלי הבא — הפקדה
              נהיית נזילות, נזילות מייצרת עמלות, עמלות מזינות אוצר, אוצר מתגמל הפקדות
              גדולות יותר. שום חוליה לא ישנה. כל מספר כאן נמדד חי.
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void load()}
              disabled={busy}
              className="gap-1.5 border-[#d4af37]/30 text-[#e8cd6e] hover:bg-[#d4af37]/10"
            >
              {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <RefreshCw className="size-3.5" aria-hidden />}
              רענון
            </Button>
            <div className="text-[10px] text-zinc-600">
              {data ? `נמדד ${dataAge(data.at)}` : "טוען…"}
              {data?.cached ? " · מטמון" : ""}
            </div>
          </div>
        </div>
        {/* טבעת הגלגל המסתובבת — אנימציית רקע עדינה */}
        {!reduced && (
          <motion.div
            aria-hidden
            className="pointer-events-none absolute -left-24 -top-24 size-72 rounded-full border border-dashed border-[#d4af37]/15"
            animate={{ rotate: 360 }}
            transition={{ duration: 60, repeat: Infinity, ease: "linear" }}
          >
            <div className="absolute left-1/2 top-0 size-1.5 -translate-x-1/2 rounded-full bg-[#d4af37]/40" />
          </motion.div>
        )}
      </header>

      {err && (
        <Card className="border-rose-500/30 bg-rose-500/[0.06]">
          <CardContent className="p-3 text-xs text-rose-300">
            מקור נפל: {err} — הנתונים להלן מהמדידה האחרונה שהצליחה.
          </CardContent>
        </Card>
      )}

      {/* ═══ 1. ארבע השאלות ═══ */}
      <FlySection
        id="four-questions"
        icon={Sparkles}
        title="ארבע השאלות — התשובה מראיות בלבד"
        sub="מה יש · מה מוצע · מה הכסף יעשה · למה להפקיד — בלי המצאה, בלי חנופה"
      >
        <div className="grid gap-3 lg:grid-cols-2">
          {/* שאלה 1 */}
          <Card className="border-zinc-700/60 bg-zinc-900/40">
            <CardContent className="p-4">
              <div className="mb-2 flex items-center gap-2 text-sm font-bold text-zinc-100">
                <span className="flex size-6 items-center justify-center rounded-lg bg-[#d4af37]/15 font-mono text-xs text-[#e8cd6e]">1</span>
                מה יש במערכת?
              </div>
              {data ? (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {[
                    { k: "גובה שרשרת", v: w?.height != null ? `#${w.height.toLocaleString("he-IL")}` : "—" },
                    { k: "מילויים נספרים", v: w?.fills != null ? `${w.fills.toLocaleString("he-IL")}` : "—" },
                    { k: "החלפות", v: w?.swaps != null ? `${w.swaps.toLocaleString("he-IL")}` : "—" },
                    { k: "בריכות AMM", v: w?.pools != null ? `${w.pools.length}` : "—" },
                    { k: "אוצר מצטבר לנצח", v: w ? fmtUsd(w.treasuryProfitEverUsds ?? w.treasuryProfitUsds) : "—", t: "מונה-מונוטוני (R46): כל-קציר עולה, לעולם לא נשחק לדלק-סולם/גז" },
                    { k: "יתרת אוצר עובדת", v: w ? fmtUsd(w.treasuryProfitUsds) : "—", t: "היתרה שמזרימה-דלק-סולם וגז — יורדת-כלפי-מטה-לפי-תכנון" },
                    { k: "חיסכון משלם", v: w?.savings ? `${fmtUsd(w.savings.paidUsds)} ל-${w.savings.savers} חוסכים${w.savings.demoUsds && w.savings.demoUsds > 0 ? " (עמדת-ההדגמה של המפעיל: " + fmtUsd(w.savings.demoUsds) + ")" : ""}` : "—", t: "THE-SAVE (R47): הכנסה-מדודה ששולמה-בפועל — אפס-הטבעה, העברה-טהורה מיתרת-האוצר. גילוי-מלא (R48): החוסך-היחיד הוא-המפעיל-עצמו — עמדת-הדגמה-עומדת מכספו-שלו, לא-הפקדה-חוץ" },
                    { k: "הכנסת החיסכון (מדודה)", v: w?.savings ? fmtUsd(w.savings.incomeSourceUsds) : "—", t: "FIX(R47): 30% מחית-עמלות-הבריכות + ריבית-כספת + עתודת-אוצר-שוק-הכספים — מונים-מונוטוניים של הכנסה-אמת" },
                    {
                      k: "שיעור-יום שנמדד",
                      v: w?.savings
                        ? w.savings.apyBps != null && w.savings.apyBps > 0
                          ? `${(w.savings.apyBps / 100).toFixed(2)}% APY`
                          : `חלון-כיול · $${w.savings.dayPaidUsds.toFixed(2)} בחלון הנוכחי`
                        : "—",
                      t: w?.savings && w.savings.apyBps == null
                        ? "FIX(R48 · calibration-truth): חלון-הפתיחה שלאחר-מיגרציית-בסיס-ההכנסה קלט-את-ההצטבר-ההיסטורי ביום-אחד (77,184µ) — ארטיפקט-מיגרציה, לא-קצב-אמת. ה-APY השנתי יפורסם-רק-מחלון-יום-שני-והלאה; עד-אז מוצג-התשלום-החי-של-החלון-הנוכחי — מדידה, לא-הבטחה"
                        : `חלון-היום-האמיתי (5,760 גבהים = יום-אחד): מה-ששולם-בפועל-אתמול × 365 — לא-הבטחה, מדידה`,
                    },
                    { k: "פעולות שרשרת", v: w?.opsTotal != null ? `${w.opsTotal.toLocaleString("he-IL")}` : "—" },
                  ].map((x) => (
                    <div key={x.k} title={x.t} className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-2.5 py-1.5">
                      <div className="text-[10px] text-zinc-500">{x.k}</div>
                      <div className="font-mono text-sm font-semibold text-zinc-100">{x.v}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <Skeleton className="h-24 w-full" />
              )}
              <p className="mt-2 text-[11px] leading-relaxed text-zinc-500" dir="auto">
                ומעל הכל: קווי-העדות החיים מהמראה הציבורית —{" "}
                {liveStats ? (
                  <>
                    Steem ({liveStats.anchorLines?.steem ?? 0} עוגנים) + ZERO EVM בגז-0 ({liveStats.anchorLines?.zero ?? 0} עוגנים),
                    {" "}{liveStats.stats?.checkpoints?.toLocaleString("he-IL") ?? "—"} צ׳קפוינטים,{" "}
                    {liveStats.stats?.attestations?.toLocaleString("he-IL") ?? "—"} עדויות חתומות,{" "}
                    {liveStats.loop?.coverage?.agents?.toLocaleString("he-IL") ?? "—"} סוכנים ב-{" "}
                    {liveStats.loop?.coverage?.total ?? "—"} ריפואים
                  </>
                ) : (
                  <>ממתין למראה הציבורית…</>
                )}{" "}
                — כל טענה ניתנת לאימות בדפדפן מהקונסולה הציבורית.
              </p>
            </CardContent>
          </Card>

          {/* שאלה 2 */}
          <Card className="border-zinc-700/60 bg-zinc-900/40">
            <CardContent className="p-4">
              <div className="mb-2 flex items-center gap-2 text-sm font-bold text-zinc-100">
                <span className="flex size-6 items-center justify-center rounded-lg bg-[#d4af37]/15 font-mono text-xs text-[#e8cd6e]">2</span>
                מה מוצע למפקיד?
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-lg border border-[#d4af37]/25 bg-[#d4af37]/[0.06] px-2.5 py-1.5">
                  <div className="text-[10px] text-[#e8cd6e]/70">דלת הפקדה</div>
                  <div className="font-mono text-sm font-semibold text-[#e8cd6e]">4 רשתות</div>
                </div>
                <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-2.5 py-1.5">
                  <div className="text-[10px] text-zinc-500">מזער הפקדה</div>
                  {/* r124 · כנות: אין אכיפת מינימום בקוד — ההפקדה הראשונה שתועדה הייתה 2 TRX (~$0.5).
                      לא נציג סף שאינו קיים. */}
                  <div className="font-mono text-sm font-semibold text-zinc-100">ללא מינימום בקוד</div>
                </div>
                <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-2.5 py-1.5">
                  <div className="text-[10px] text-zinc-500">הפקדות שנכנסו</div>
                  <div className="font-mono text-sm font-semibold text-zinc-100">{m?.deposits.total ?? "—"}</div>
                </div>
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-zinc-500" dir="auto">
                הצעה כנה בת שלוש שכבות: (א) זיכוי USDS מול הפקדה חיה בשער הרשת, מאומת מספר
                פתוח; (ב) שלושה שימושים מיד — מסחר בבורסה, תשואה בשוק-הכספים, כספת אוטומטית;
                (ג) דלת יציאה מגובה עם פסק-דין חי (SEND-NOW/WAIT) מול עלות שידור אמיתית.
                האמת המלאה:{" "}
                {m?.deposits.total ? (
                  <span className="text-zinc-300">הפקדות-חוץ שנספרו: {m.deposits.total}</span>
                ) : (
                  <span className="text-zinc-300">אפס הפקדות חוץ עד עכשיו</span>
                )}{" "}
                — {m?.deposits.total ? "המערך מקבל ומנפח מיד." : "המערך מוכן, העולם עדיין לא בא."}
              </p>
            </CardContent>
          </Card>

          {/* שאלה 3 */}
          <Card className="border-zinc-700/60 bg-zinc-900/40">
            <CardContent className="p-4">
              <div className="mb-2 flex items-center gap-2 text-sm font-bold text-zinc-100">
                <span className="flex size-6 items-center justify-center rounded-lg bg-[#d4af37]/15 font-mono text-xs text-[#e8cd6e]">3</span>
                אילו טכנולוגיות, ומה הכסף יעשה?
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  { icon: Layers, k: "ספר-זמנות + AMM", v: "בורסה מלאה" },
                  { icon: Percent, k: "שוק-כספים kinked", v: "בסטנדרט Aave-v3" },
                  { icon: Vault, k: "כספות ריבית-דריבית", v: "בסטנדרט Yearn" },
                  { icon: Flame, k: "גריד חוץ", v: m?.grid.armed ? "חמוש" : "ממתין" },
                ].map((x) => (
                  <div key={x.k} className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-2.5 py-1.5">
                    <div className="flex items-center gap-1 text-[10px] text-zinc-500">
                      <x.icon className="size-3" aria-hidden /> {x.k}
                    </div>
                    <div className="font-mono text-xs font-semibold text-zinc-100">{x.v}</div>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-zinc-500" dir="auto">
                מסלול הכסף מהפקדה ועד פדיון: הפקדה חיה (TRON/EVM/SOL/BTC) → תביעה חתומה → זיכוי
                USDS → הכסף מועסק: LP בבריכות {w?.pools.length ?? "—"} · הלוואות לארנה · עמלות
                נמדדות מכל החלפה → 10% מריבית לאוצר, השאר למפקידים → פדיון בפסק SEND-NOW.
                עלות התפעול אפס (עדויות בגז-0) — כל עמלה שנמדדת זורמת למערך, לא לגז.
              </p>
            </CardContent>
          </Card>

          {/* שאלה 4 */}
          <Card className="border-[#d4af37]/25 bg-[#d4af37]/[0.05]">
            <CardContent className="p-4">
              <div className="mb-2 flex items-center gap-2 text-sm font-bold text-[#e8cd6e]">
                <span className="flex size-6 items-center justify-center rounded-lg bg-[#d4af37]/15 font-mono text-xs">4</span>
                למה להפקיד דווקא כאן?
              </div>
              <p className="text-[11px] leading-relaxed text-zinc-300" dir="auto">
                <span className="font-semibold">כי אף טענה כאן לא דורשת אמון.</span> אצל Aave אתה
                סומך על 20 אודיטים ועל אורקל-מחירים; אצלנו אתה מאמת כל ביט בעצמך בדפדפן —
                הספר פתוח, העוגנים חתומים על שלוש שרשרות ציבוריות, האינווריאנטה של הגיבוי{" "}
                {m?.invariantHolds === true ? (
                  <span className="font-mono text-emerald-300">תקינה ומוכחת</span>
                ) : (
                  <span className="font-mono text-zinc-400">בבדיקה</span>
                )}
                . ועכשיו גם הסיבה הכלכלית: הכסף שלך לא ישן — כל הפקדה נכנסת מיד לגלגל
                (שוק-כספים/כספת) ומרוויחה מעמלות שנמדדות, לא מהבטחות. הסיכון נשאר אמיתי — רשת
                צעירה, נזילות קטנה — והוא כתוב כאן בגלוי, כי זו רשת של הוכחות.
              </p>
            </CardContent>
          </Card>
        </div>
      </FlySection>

      {/* ═══ 2. ה-ROAST ═══ */}
      <FlySection
        id="roast"
        icon={Swords}
        title="ה-Roast — מול הרשתות המתקדמות בעולם, TVL חי"
        sub="DefiLlama בזמן אמת · אנחנו קטנים בסדרי-גודל — וכנים בסדרי-גודל"
      >
        <div className="overflow-x-auto rounded-xl border border-zinc-700/60">
          <table className="w-full min-w-[560px] text-right text-[11px]">
            <thead>
              <tr className="border-b border-zinc-700/60 bg-zinc-900/70 text-zinc-400">
                <th className="px-3 py-2 font-semibold">רשת</th>
                <th className="px-3 py-2 font-semibold">תחום</th>
                <th className="px-3 py-2 font-semibold">TVL חי</th>
                <th className="px-3 py-2 font-semibold">ההבדל האמיתי (בלי עליבות, בלי חנופה)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60">
              {(data?.giants?.list ?? []).map((g, i) => (
                <tr key={g.he} className={cn("bg-zinc-950/40", i % 2 === 1 && "bg-zinc-900/30")}>
                  <td className="px-3 py-2 font-semibold text-zinc-100">{g.he}</td>
                  <td className="px-3 py-2 text-zinc-400">{g.what}</td>
                  <td className="px-3 py-2 font-mono font-bold text-[#e8cd6e]">
                    {g.tvlUsd != null ? fmtUsd(g.tvlUsd, 0) : "—"}
                  </td>
                  <td className="px-3 py-2 text-zinc-400" dir="auto">{ROAST_LINES[g.he]}</td>
                </tr>
              ))}
              <tr className="bg-[#d4af37]/[0.06]">
                <td className="px-3 py-2 font-bold text-[#e8cd6e]">SAOS — הגלגל הריבוני</td>
                <td className="px-3 py-2 text-zinc-300">אספקת-USDS בהלוואות (חי)</td>
                <td className="px-3 py-2 font-mono font-bold text-[#e8cd6e]">
                  {w ? fmtUsd(market?.supplyUsds) : "—"}
                </td>
                <td className="px-3 py-2 text-zinc-300" dir="auto">
                  פחות משנייה אחת של ווליום Uniswap. אבל: אצלם אתה סומך על אודיטים — אצלנו
                  אתה מאמת. הם משלמים מיליוני דולר גז בשנה; אנחנו עוגנים בגז-0 מדוד. ההיסטוריה
                  שלהם מפוארת; שלנו — פתוחה ביט-ל-ביט.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-zinc-500" dir="auto">
          השורה התחתונה: להתחרות ב-TVL זה לא המשחק שלנו — המשחק שלנו הוא אמון-מוכח.
          כשרשת אחת מהם נפרצת (וזה קורה שוב ושוב), הלקוח שלהם מגלה את החור מהעיתונות;
          הלקוח שלנו יגלה אותו מהספר הפתוח — כי אין כאן שום דבר שאינו נמדד.
        </p>
      </FlySection>

      {/* ═══ 3. שוק-הכספים ═══ */}
      <FlySection
        id="money-market"
        icon={Percent}
        title="שוק-הכספים הריבוני — עקומת kink בסטנדרט Aave-v3"
        sub="ריבית נגזרת מניצולת אמיתית של השרשרת · פרמטרים גלויים · 10% לאוצר"
      >
        {market?.onChain && (
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/5 px-3 py-2 text-[11px] text-emerald-300">
            <span className="inline-block size-1.5 animate-pulse rounded-full bg-emerald-400" aria-hidden />
            <b>חי על-השרשרת</b> — state.lend ב-world.json: הנתונים שלהלן נכתבו-על-ידי-המנוע-הקנוני, לא מחושבים-מיתרות. {market.onChainNote}
            <a href="#/money-market" className="mr-auto rounded-lg border border-emerald-500/30 px-2 py-1 font-semibold text-emerald-200 underline-offset-4 hover:underline">← התצוגה-המלאה</a>
          </div>
        )}
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-5">
          {/* מצב השוק */}
          <Card className="border-zinc-700/60 bg-zinc-900/40 lg:col-span-3">
            <CardContent className="p-4">
              <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-2.5 py-1.5">
                  <div className="text-[10px] text-zinc-500">אספקה USDS</div>
                  <div className="font-mono text-sm font-semibold text-zinc-100">
                    {market?.supplyUsds != null ? market.supplyUsds.toLocaleString("he-IL", { maximumFractionDigits: 0 }) : "—"}
                  </div>
                </div>
                <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-2.5 py-1.5">
                  <div className="text-[10px] text-zinc-500">מושאל (חיילי-ארנה)</div>
                  <div className="font-mono text-sm font-semibold text-zinc-100">
                    {market?.borrowedUsds != null ? market.borrowedUsds.toLocaleString("he-IL", { maximumFractionDigits: 0 }) : "—"}
                  </div>
                </div>
                <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-2.5 py-1.5">
                  <div className="text-[10px] text-zinc-500">ניצולת</div>
                  <div className={cn(
                    "font-mono text-sm font-semibold",
                    (market?.utilization ?? 0) > 0.8 ? "text-rose-300" : "text-emerald-300"
                  )}>
                    {market ? fmtPct(market.utilization, 1) : "—"}
                  </div>
                </div>
                <div className="rounded-lg border border-[#d4af37]/25 bg-[#d4af37]/[0.06] px-2.5 py-1.5">
                  <div className="text-[10px] text-[#e8cd6e]/70">ריבית למפקיד (APY)</div>
                  <div className="font-mono text-sm font-bold text-[#e8cd6e]">
                    {fmtPct(data?.compounding?.marketApy)}
                  </div>
                </div>
              </div>
              {/* עקומת הריבית */}
              <RateCurve util={market?.utilization ?? null} borrowApr={market?.borrowApr ?? null} policy={curvePolicy} />
              <p className="mt-2 text-[10px] leading-relaxed text-zinc-600" dir="auto">
                העקומה ({livePolicy ? "פרמטרי מדיניות מה-API" : "ברירת-מחדל קבועה בקוד"}): בסיס {fmtPct(curvePolicy.baseApr, 0)} + שיפוע{" "}
                {fmtPct(curvePolicy.slope1, 0)} עד ניצולת{" "}
                {curvePolicy.kinkPct}% (הברך), ואז עונש{" "}
                {fmtPct(curvePolicy.slope2, 0)} — בדיוק הצורה של
                Aave v3. הנקודה החיה על העקומה היא המצב האמיתי של השרשרת עכשיו: נעילות-החיילים
                בארנה מול האספקה הפתוחה. ריבית למלווה = ריבית-הלוואה ×{" "}
                {livePolicy ? `${Math.round((1 - livePolicy.reserveFactor) * 100)}%` : "—"}{" "}
                ({livePolicy ? `${Math.round(livePolicy.reserveFactor * 100)}%` : "—"} גורם-יתרה לאוצר).
              </p>
            </CardContent>
          </Card>

          {/* מחשבון */}
          <MarketCalc market={market} apy={data?.compounding?.marketApy ?? null} />
        </div>
      </FlySection>

      {/* ═══ 4. הכספות ═══ */}
      <FlySection
        id="vaults"
        icon={Vault}
        title="הכספות — ריבית-דריבית מתמדת, תשואה ממדוד"
        sub="APR מנתוני הבריכות האמיתיים (lpYieldBps) · APY = ריבית-דריבית יומית, כמו Yearn"
      >
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {(data?.vaults ?? []).map((v) => (
            <Card key={v.key} className="border-zinc-700/60 bg-zinc-900/40">
              <CardContent className="p-4">
                <div className="mb-2 flex items-center justify-between">
                  <div className="font-mono text-sm font-bold text-zinc-100">{v.key}</div>
                  <Badge
                    variant="outline"
                    className="border-[#d4af37]/30 font-mono text-[10px] text-[#e8cd6e]"
                  >
                    {fmtPct(v.apy)} APY
                  </Badge>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg bg-zinc-950/60 px-1.5 py-1.5">
                    <div className="text-[10px] text-zinc-500">APR מדוד</div>
                    <div className="font-mono text-xs font-semibold text-zinc-200">{fmtPct(v.apr)}</div>
                  </div>
                  <div className="rounded-lg bg-zinc-950/60 px-1.5 py-1.5">
                    <div className="text-[10px] text-zinc-500">עמלות נצברו</div>
                    <div className="font-mono text-xs font-semibold text-zinc-200">{fmtUsd(v.feesAccruedUsds)}</div>
                  </div>
                  <div className="rounded-lg bg-zinc-950/60 px-1.5 py-1.5">
                    <div className="text-[10px] text-zinc-500">החלפות</div>
                    <div className="font-mono text-xs font-semibold text-zinc-200">{v.swaps != null ? v.swaps.toLocaleString("he-IL") : "—"}</div>
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-between text-[10px] text-zinc-500">
                  <span>נזילות: <span className="font-mono">{fmtUsd(v.tvlUsds)}</span></span>
                  <span>עמלה: <span className="font-mono">{v.feeBps ?? "—"} bps</span></span>
                </div>
              </CardContent>
            </Card>
          ))}
          {(data == null || (data.vaults ?? []).length === 0) && (
            <Card className="border-zinc-800 bg-zinc-900/40">
              <CardContent className="p-4">
                <Skeleton className="h-16 w-full" />
              </CardContent>
            </Card>
          )}
        </div>
        <Card className="mt-3 border-zinc-700/60 bg-zinc-900/40">
          <CardContent className="p-3 text-[11px] leading-relaxed text-zinc-500" dir="auto">
            <span className="font-semibold text-zinc-300">מה הכספת עושה בפועל:</span> מפקידה את
            ההון בבריכה, כל עמלה שנמדדת נכנסת אוטומטית בחזרה להון (harvest יומי) — ולכן
            ה-APY תמיד גבוה מה-APR. הפרש ה-APY←APR הוא הריבית-דריבית, לא הבטחה שיווקית.
            התשואה מגיעה מעמלות מסחר אמיתיות שנספרו בשרשרת — אם אין מסחר, אין תשואה,
            וזה יהיה כתוב כאן במספרים.
          </CardContent>
        </Card>
      </FlySection>

      {/* ═══ 5. הגלגל ═══ */}
      <FlySection
        id="wheel"
        icon={Repeat}
        title="הגלגל — שמונה חוליות שכל אחת מזרימה לבאה"
        sub="המספר בכל חוליה נמדד חי מהקונסולה הציבורית — שום דבר לא ישן"
      >
        <FlywheelDiagram fw={data?.flywheel ?? null} />
      </FlySection>

      {/* ── הוכחות ── */}
      <FlySection id="proofs" icon={ShieldCheck} title="קישורי אמת לאימות עצמאי" sub="כל מספר בעמוד ניתן לבדיקה במקור">
        <div className="flex flex-wrap gap-2">
          {[
            { label: "world.json — השרשרת הקנונית", url: "https://roshpinacare-sys.github.io/Console/dex/world.json" },
            { label: "money.json — צופה נתיב-הכסף", url: "https://roshpinacare-sys.github.io/Console/dex/money.json" },
            { label: "watch.json — ספר ההפקדות", url: "https://roshpinacare-sys.github.io/Console/dex/watch.json" },
            { label: "DefiLlama — TVL הענקיות", url: "https://defillama.com/protocols/dex" },
          ].map((l) => (
            <a
              key={l.url}
              href={l.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900/60 px-3 py-1.5 text-[11px] text-zinc-400 transition-colors hover:border-[#d4af37]/40 hover:text-[#e8cd6e]"
            >
              <ArrowLeft className="h-3 w-3" aria-hidden />
              {l.label}
            </a>
          ))}
        </div>
      </FlySection>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// שורות ה-ROAST — חדות, הוגנות, ללא חנופה
// ═══════════════════════════════════════════════════════════════════════

const ROAST_LINES: Record<string, string> = {
  "Aave v3":
    "עשרים אודיטים ובאג באורקל עדיין יכול למחוק לך את הפוזיציה. אצלנו: אין אורקל-שלישי — הספר עצמו האמת, והפרמטרים פתוחים בעמוד הזה. אבל בכנות: הם גם מחזיקים מיליארדים בשלום כבר שנים — אנחנו עוד לא הוכחנו בכלום.",
  "Compound v3":
    "המציאו את שוק-הכספים ואז נתנו לו להיחנט. העקומה שלהם (5 kinks) כל כך מתוחכמת שאף משתמש לא מבין אותה. שלנו: ברך אחת, פתוחה, ניתנת לחישוב בראש.",
  "Uniswap v3":
    "ריכוז-נזילות גאוני — וממשק שדורש תואר בפיננסים קוונטיים. דיוני מתג העמלות שלהם נמשכים שנים; אצלנו העמלות זרמו לאוצר מהיום הראשון — " ,
  "Curve":
    "בנו את ה-stableswap הטוב בעולם ואז את מלחמות ה-bribes הכי פחות נקיות. ה-peg-door שלנו שקוף: מדדי הסטייה מפורסמים, לא נקנים.",
  "Yearn":
    "אסטרטגיות-על בליווי שכבת עמלות שאוכלת חצי מהתשואה. הכספות שלנו: 0 עמלות ניהול, ה-APR נמדד מהבריכה עצמה — מה שכתוב זה מה שיש.",
  "Maker/Sky":
    "ה-CDP ההיסטורי שהפך למפלצת מוסדית עם נכסי-עולם-אמיתיים שאיש לא ראה. USDS מגובה 1:1 במשמרות; האינווריאנטה נבדקת בכל פעימה (ההפקדות החיות נספרות למעלה) — קטן, אבל פתוח.",
};

// ═══════════════════════════════════════════════════════════════════════
// עקומת הריבית — SVG חי
// ═══════════════════════════════════════════════════════════════════════

function RateCurve({
  util,
  borrowApr,
  policy,
}: {
  util: number | null;
  borrowApr: number | null;
  policy: { baseApr: number; slope1: number; slope2: number; kinkPct: number };
}) {
  const P = useMemo(() => {
    const baseApr = policy.baseApr, slope1 = policy.slope1, slope2 = policy.slope2, kink = policy.kinkPct / 100;
    const f = (u: number) =>
      baseApr + slope1 * u + (u > kink ? slope2 * (u - kink) : 0);
    const pts: string[] = [];
    for (let i = 0; i <= 40; i++) {
      const u = i / 40;
      const x = 40 + u * 520; // RTL-חביב: משמאל 0% → ימין 100%
      const y = 180 - Math.min(1, f(u) / 0.5) * 160;
      pts.push(`${x},${y}`);
    }
    return { line: pts.join(" "), kinkX: 40 + kink * 520, maxR: 50 };
  }, [policy]);

  const liveX = util != null ? 40 + util * 520 : null;
  const liveY =
    util != null && borrowApr != null ? 180 - Math.min(1, borrowApr / 0.5) * 160 : null;

  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-950/70 p-2" dir="ltr">
      <svg viewBox="0 0 600 210" className="w-full sm:min-w-[420px]" role="img" aria-label="עקומת ריבית בניצולת">
        {/* צירים */}
        <line x1="40" y1="180" x2="580" y2="180" stroke="#3f3f46" strokeWidth="1" />
        <line x1="40" y1="20" x2="40" y2="180" stroke="#3f3f46" strokeWidth="1" />
        {/* סימון הברך */}
        <line x1={P.kinkX} y1="20" x2={P.kinkX} y2="180" stroke="#a78bfa55" strokeDasharray="4 4" />
        <text x={P.kinkX + 4} y="30" fill="#a78bfa" fontSize="9">kink {Math.round(policy.kinkPct)}%</text>
        {/* העקומה */}
        <polyline points={P.line} fill="none" stroke="#d4af37" strokeWidth="2.5" strokeLinejoin="round" />
        {/* הנקודה החיה */}
        {liveX != null && liveY != null && (
          <>
            <line x1={liveX} y1={liveY} x2={liveX} y2="180" stroke="#34d39966" strokeDasharray="3 3" />
            <circle cx={liveX} cy={liveY} r="5" fill="#34d399" stroke="#064e3b" strokeWidth="2">
              <animate attributeName="r" values="5;7;5" dur="2s" repeatCount="indefinite" />
            </circle>
            <text x={liveX + 8} y={liveY - 8} fill="#34d399" fontSize="10" fontWeight="bold">
              {(util! * 100).toFixed(1)}%
            </text>
          </>
        )}
        {/* תוויות */}
        <text x="560" y="198" fill="#71717a" fontSize="9">100% ניצולת</text>
        <text x="44" y="198" fill="#71717a" fontSize="9">0%</text>
        <text x="6" y="24" fill="#71717a" fontSize="9">50%+</text>
        <text x="6" y="182" fill="#71717a" fontSize="9">1%</text>
      </svg>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// מחשבון שוק-הכספים — אינטראקטיבי
// ═══════════════════════════════════════════════════════════════════════

function MarketCalc({
  market, apy,
}: {
  market: MarketState | null;
  apy: number | null;
}) {
  const [amt, setAmt] = useState("100");
  const n = Math.max(0, Number(amt) || 0);
  const rate = apy ?? 0;

  const rows = useMemo(() => {
    const out: Array<{ d: string; earn: number }> = [];
    for (const days of [30, 90, 365]) {
      // ריבית דריבית רציפה: e^(APR·t)
      const earn = n * (Math.pow(1 + rate / 365, days) - 1);
      out.push({ d: `${days} יום`, earn });
    }
    return out;
  }, [n, rate]);

  return (
    <Card className="border-[#d4af37]/25 bg-[#d4af37]/[0.04] lg:col-span-2">
      <CardContent className="p-4">
        <div className="mb-2 flex items-center gap-2 text-sm font-bold text-[#e8cd6e]">
          <Banknote className="size-4" aria-hidden />
          מחשבון — אם אפקיד
        </div>
        {apy == null ? (
          <p className="text-[11px] leading-relaxed text-zinc-400" dir="auto">
            אין מדידת APY חיה כרגע (המקור לא ענה) — החישוב מושהה במקום להמציא אפס.
          </p>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <Input
                dir="ltr"
                inputMode="decimal"
                value={amt}
                onChange={(e) => setAmt(e.target.value.replace(/[^0-9.]/g, ""))}
                className="border-[#d4af37]/30 bg-zinc-950/70 font-mono text-sm"
                aria-label="סכום הפקדה ב-USDS"
              />
              <span className="text-xs font-semibold text-[#e8cd6e]">USDS</span>
            </div>
            <div className="mt-3 grid gap-1.5">
              {rows.map((r) => (
                <div key={r.d} className="flex items-center justify-between rounded-lg bg-zinc-950/60 px-3 py-1.5">
                  <span className="text-[11px] text-zinc-400">אחרי {r.d}</span>
                  <span className="font-mono text-sm font-bold text-emerald-300" dir="ltr">
                    +{r.earn.toFixed(4)} USDS
                  </span>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[10px] leading-relaxed text-zinc-600" dir="auto">
              ב-APY החי של עכשיו ({fmtPct(rate)}). הריבית נגזרת מהניצולת האמיתית —{" "}
              {market ? `${fmtPct(market.utilization, 1)} ניצולת` : "—"} — וצפויה להשתנות עם השוק.
              זו המחשה כנה, לא הבטחת תשואה.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// דיאגרמת הגלגל — 8 חוליות במעגל, כל אחת עם המספר החי שלה
// FIX(R47): חוליית-החיסכון (save) נכנסה-למעגל בין-האוצר-לגריד — ההכנסה
// זורמת מהאוצר אל-החוסכים ומשם נמשכת-חזרה-לעבודה. דבר-גורר-דבר.
// ═══════════════════════════════════════════════════════════════════════

function FlywheelDiagram({
  fw,
}: {
  fw: Record<string, { label: string; value: number | string; unit: string; detail: string }> | null;
}) {
  const ORDER = ["deposits", "credit", "market", "liquidity", "fees", "treasury", "save", "grid"] as const;
  const reduced = useReducedMotion();

  const nodes = ORDER.map((k, i) => {
    const d = fw?.[k];
    const angle = (i / ORDER.length) * Math.PI * 2 - Math.PI / 2;
    const cx = 50 + 36 * Math.cos(angle);
    const cy = 50 + 36 * Math.sin(angle);
    return { key: k, d, cx, cy, angle, i };
  });

  const fmtV = (d: { value: number | string | null; unit: string } | undefined) => {
    if (!d) return "—";
    const v = d.value;
    if (v == null) return "—";
    if (typeof v === "number")
      return v >= 1000 ? v.toLocaleString("he-IL", { maximumFractionDigits: 0 }) : v.toFixed(2);
    return v;
  };

  return (
    <div className="grid gap-4 lg:grid-cols-5">
      {/* המעגל */}
      <div className="relative lg:col-span-3" dir="ltr">
        <div className="overflow-hidden rounded-xl border border-zinc-700/60 bg-zinc-950/60">
          <svg viewBox="0 0 100 100" className="w-full" role="img" aria-label="גלגל הזרימה בין הכלים">
            <defs>
              <marker id="fw-arrow" markerWidth="4" markerHeight="4" refX="2.4" refY="2" orient="auto">
                <path d="M0,0 L4,2 L0,4 z" fill="#d4af3788" />
              </marker>
            </defs>
            {/* חיצים בין החוליות */}
            {nodes.map((n, i) => {
              const next = nodes[(i + 1) % nodes.length];
              const x1 = 50 + 36 * Math.cos(n.angle + 0.42);
              const y1 = 50 + 36 * Math.sin(n.angle + 0.42);
              const x2 = 50 + 36 * Math.cos(next.angle - 0.42);
              const y2 = 50 + 36 * Math.sin(next.angle - 0.42);
              return (
                <motion.line
                  key={`arr-${n.key}`}
                  x1={x1} y1={y1} x2={x2} y2={y2}
                  stroke="#d4af3755" strokeWidth="0.5" markerEnd="url(#fw-arrow)"
                  initial={{ pathLength: 0 }}
                  animate={{ pathLength: reduced ? 1 : [0.2, 1, 0.2] }}
                  transition={{ duration: 3.2, repeat: Infinity, delay: i * 0.35, ease: "easeInOut" }}
                />
              );
            })}
            {/* החוליות */}
            {nodes.map((n) => (
              <g key={n.key}>
                <circle
                  cx={n.cx} cy={n.cy} r="8.6"
                  fill="#18181b" stroke={n.d ? "#d4af3766" : "#3f3f46"} strokeWidth="0.4"
                />
                <text x={n.cx} y={n.cy - 0.6} textAnchor="middle" fontSize="2.6" fontWeight="bold" fill="#e8cd6e">
                  {fmtV(n.d)}
                </text>
                <text x={n.cx} y={n.cy + 2.2} textAnchor="middle" fontSize="1.7" fill="#a1a1aa">
                  {n.d?.unit ?? ""}
                </text>
              </g>
            ))}
            {/* המרכז */}
            <circle cx="50" cy="50" r="13" fill="#d4af370d" stroke="#d4af3744" strokeWidth="0.4" />
            <text x="50" y="48.6" textAnchor="middle" fontSize="3.4" fontWeight="900" fill="#e8cd6e">דבר</text>
            <text x="50" y="52.4" textAnchor="middle" fontSize="3" fontWeight="900" fill="#e8cd6e">גורר דבר</text>
            <text x="50" y="56.6" textAnchor="middle" fontSize="1.9" fill="#a1a1aa">שום חוליה לא ישנה</text>
          </svg>
        </div>
      </div>

      {/* לוח החוליות */}
      <div className="grid gap-2 lg:col-span-2">
        {nodes.map((n) => (
          <div
            key={n.key}
            className="flex items-start gap-2.5 rounded-xl border border-zinc-700/60 bg-zinc-900/40 p-2.5"
          >
            <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-[#d4af37]/15">
              <TrendingUp className="size-3.5 text-[#e8cd6e]" aria-hidden />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline gap-1.5">
                <span className="text-xs font-bold text-zinc-100">{n.d?.label ?? n.key}</span>
                <span className="font-mono text-xs font-bold text-[#e8cd6e]" dir="auto">
                  {fmtV(n.d)} {n.d?.unit ?? ""}
                </span>
              </div>
              <p className="text-[10px] leading-snug text-zinc-500" dir="auto">{n.d?.detail ?? "—"}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
