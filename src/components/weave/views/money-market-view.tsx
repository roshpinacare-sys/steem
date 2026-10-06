"use client";

// ─────────────────────────────────────────────────────────────────────
// MONEY-MARKET VIEW · שוק-הכספים הריבוני (R44 · THE-MARKET).
//
// לא חישוב-תיאורטי — הנתונים האלה הם השרשרת-עצמה: state.lend ב-world.json
// מתעדכן בכל פעימה (שווקים/עמדות/מונים/אינווריאנטות), וכל מספר כאן נכתב
// קודם על-ידי המנוע הקנוני. השאילה-הראשונה בהיסטוריה: h28764.
//
//   · עקומת-kink חיה — הנקודה הפועמת היא הניצולת-האמיתית-עכשיו
//   · עמדות חיות עם HF מחושב-שרשרת (צבע: ירוק/ענבר/אדום)
//   · חלוקת-הריבית 90/10 — מה ששולם-בפועל, לא-הבטחה
//   · אינווריאנטת-הספרים לכל-נכס — pot = Σקרן+Σרווחים−Σחוב
//   · הסוכנים-האוטונומיים: האוצר מזרים-אדפטיבית, חיילים במחזורי-אשראי
// ─────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  Banknote,
  Coins,
  Gauge,
  Landmark,
  Loader2,
  Percent,
  RefreshCw,
  ShieldCheck,
  Siren,
  TrendingUp,
  Users,
  Vault,
  Wallet,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const WORLD_URL = "https://roshpinacare-sys.github.io/Console/dex/world.json";

// ── טיפוסי השרשרת (state.lend) ──────────────────────────────────────

interface LendMarket {
  asset: string;
  ltvBps: number;
  liqThresholdBps: number;
  sMu: number;
  bMu: number;
  cashMu: number;
  utilBps: number;
  borrowAprBps: number;
  supplyAprBps: number;
  sEarnedMu: number;
  resMu: number;
}
interface LendPosition {
  who: string;
  supplies: Array<{ asset: string; mu: number; earned: number }>;
  borrows: Array<{ asset: string; mu: number; int: number; atH: number; debtMu: number }>;
  hf: number;
}
interface LendDoc {
  ok: boolean;
  publishedAt: string;
  version: number;
  state: {
    height: number;
    halted: boolean;
    lend?: {
      markets: LendMarket[];
      positions: LendPosition[];
      totals: {
        suppliesMu: number; borrowsMu: number; interestPaidMu: number;
        resToTreasuryMu: number; liquidations: number; opens: number; closes: number;
      };
      treasury: { suppliedMu: number; earnedMu: number; supplyAprBps: number };
      invariant: Record<string, { pot: number; expect: number; ok: boolean }>;
    };
    treasuryProfit: number;
    vaults?: Record<string, unknown>;
    // אורקל חי מ-world.json — µ$ לאסימון בודד (r121: המקור הקנוני היחיד למחיר)
    oracle?: Record<string, { mu: number; atH: number; src: string }>;
  };
}

// ── עזרים ────────────────────────────────────────────────────────────

const fmtMu = (v: number | null | undefined): string => {
  if (v == null || !isFinite(v)) return "—";
  return v.toLocaleString("he-IL");
};
const fmtUsd = (mu: number | null | undefined): string => {
  if (mu == null || !isFinite(mu)) return "—";
  const usd = mu / 1000;
  if (usd === 0) return "$0";
  if (Math.abs(usd) < 0.01) return `<$0.01`;
  return `$${usd.toLocaleString("he-IL", { maximumFractionDigits: 2 })}`;
};
const fmtPctBps = (bps: number | null | undefined, digits = 2): string => {
  if (bps == null || !isFinite(bps)) return "—";
  return `${(bps / 100).toFixed(digits)}%`;
};
const fmtHf = (hf: number): string => (hf >= 1e8 ? "∞" : (hf / 100).toFixed(2));
function dataAge(iso: string | undefined): string {
  if (!iso) return "?";
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (min < 1) return "כרגע";
  if (min < 60) return `לפני ${min} דק׳`;
  return `לפני ${Math.round(min / 60)} שע׳`;
}
const AGENT_LABEL: Record<string, string> = {
  treasury: "האוצר — מנהל-הנזילות",
  operator: "המפעיל",
  "soldier-1": "חייל-1 · מחזור-אשראי",
  "soldier-2": "חייל-2",
  "soldier-3": "חייל-3 · מחזור-אשראי",
  "soldier-4": "חייל-4 · כספת-CDP",
};

// ── עקומת-kink חיה ───────────────────────────────────────────────────

function KinkCurve({ m }: { m: LendMarket | undefined }) {
  const util = (m?.utilBps ?? 0) / 10_000;
  const KINK = 0.8;
  const W = 560, H = 190, PAD = 38;
  const x = (u: number): number => PAD + u * (W - 2 * PAD);
  const rateAt = (u: number): number => {
    if (u <= 0) return 0.01;
    if (u <= KINK) return 0.01 + (0.04 * u) / KINK;
    return 0.05 + 0.6 * ((u - KINK) / (1 - KINK));
  };
  const y = (rate: number): number => H - PAD - (Math.min(rate, 0.2) / 0.2) * (H - 2 * PAD);
  const pts: string[] = [];
  for (let i = 0; i <= 100; i++) {
    const u = (i / 100) * 1;
    pts.push(`${x(u)},${y(rateAt(u))}`);
  }
  const liveRate = m ? m.borrowAprBps / 10_000 : 0;
  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-48 w-full min-w-[480px] sm:min-w-0" role="img" aria-label="עקומת ריבית חיה">
        <defs>
          <linearGradient id="mktg" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#d4af37" stopOpacity="0.5" />
            <stop offset="80%" stopColor="#d4af37" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#ef8354" stopOpacity="1" />
          </linearGradient>
        </defs>
        {/* צירים */}
        <line x1={PAD} y1={H - PAD} x2={W - PAD + 10} y2={H - PAD} stroke="#52525b" strokeWidth="1" />
        <line x1={PAD} y1={PAD - 8} x2={PAD} y2={H - PAD} stroke="#52525b" strokeWidth="1" />
        {/* הקינק */}
        <line x1={x(KINK)} y1={PAD - 8} x2={x(KINK)} y2={H - PAD} stroke="#a78bfa" strokeDasharray="3 4" strokeWidth="1" />
        <text x={x(KINK)} y={PAD - 14} textAnchor="middle" fontSize="9" fill="#a78bfa">kink 80%</text>
        {/* תוויות-ציר */}
        <text x={W - PAD + 6} y={H - PAD + 12} fontSize="9" fill="#71717a" textAnchor="end">ניצולת</text>
        <text x={PAD - 6} y={PAD - 14} fontSize="9" fill="#71717a" textAnchor="start" transform={`rotate(0)`}>ריבית</text>
        <text x={x(0)} y={H - PAD + 12} fontSize="8" fill="#71717a" textAnchor="middle">0%</text>
        <text x={x(1)} y={H - PAD + 12} fontSize="8" fill="#71717a" textAnchor="middle">100%</text>
        {/* העקומה */}
        <polyline points={pts.join(" ")} fill="none" stroke="url(#mktg)" strokeWidth="2.5" strokeLinecap="round" />
        {/* הנקודה-החיה */}
        {m && (
          <motion.g
            animate={{ opacity: [1, 0.45, 1] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
          >
            <line x1={x(util)} y1={y(liveRate)} x2={x(util)} y2={H - PAD} stroke="#e8cd6e" strokeDasharray="2 3" strokeWidth="1" />
            <circle cx={x(util)} cy={y(liveRate)} r="5.5" fill="#e8cd6e" stroke="#09090b" strokeWidth="2" />
          </motion.g>
        )}
        {m && (
          <text x={Math.min(x(util) + 8, W - PAD - 60)} y={Math.max(y(liveRate) - 8, 12)} fontSize="10" fill="#e8cd6e" fontWeight="700">
            {fmtPctBps(m.borrowAprBps)} APR · {fmtPctBps(m.utilBps, 1)} U
          </text>
        )}
      </svg>
    </div>
  );
}

// ── התצוגה הראשית ────────────────────────────────────────────────────

export function MoneyMarketView(): React.JSX.Element {
  const [doc, setDoc] = useState<LendDoc | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [age, setAge] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(WORLD_URL, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = (await res.json()) as LendDoc;
      setDoc(j);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "שגיאה");
    } finally {
      setLoading(false);
      setAge(Date.now());
    }
  }, []);

  useEffect(() => {
    void load();
    timerRef.current = setInterval(() => void load(), 90_000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [load]);

  const lend = doc?.state?.lend;
  const usds = useMemo(() => lend?.markets.find((m) => m.asset === "USDS"), [lend]);
  const liveMarkets = useMemo(() => (lend?.markets ?? []).filter((m) => m.sMu > 0 || m.bMu > 0), [lend]);
  const invariantOk = useMemo(
    () => (lend ? Object.values(lend.invariant).every((v) => v.ok) : false),
    [lend],
  );

  const totals = lend?.totals;
  const suppliesUsd = liveMarkets.reduce((s, m) => s + (m.asset === "USDS" ? m.sMu : 0), 0);
  // r121 — מחירים מהאורקל-הקנוני החי של world.json בלבד (µ$ לאסימון);
  // אספקת-על ב-µ-אסימונים (1000µ = אסימון) ⇒ ערך ב-$ = (sMu/1000)×(mu/1e6).
  // נכס ללא רישום-אורקל (כגון SAOS) אינו מוערך — אמת, לא המצאה (היה: מחירים קשיחים ×1000 שקר).
  const oracle = doc?.state?.oracle;
  const pricedCollateral = liveMarkets
    .filter((m) => m.asset !== "USDS" && m.sMu > 0 && oracle?.[m.asset]?.mu != null)
    .map((m) => ({ asset: m.asset, sMu: m.sMu, priceMu: oracle![m.asset]!.mu }));
  const collateralUsd = pricedCollateral.reduce(
    (s, m) => s + (m.sMu / 1000) * (m.priceMu / 1e6),
    0,
  );
  const unpricedCollateral = liveMarkets.filter(
    (m) => m.asset !== "USDS" && m.sMu > 0 && oracle?.[m.asset]?.mu == null,
  );
  const debtUsd = usds?.bMu ?? 0;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-16 pt-6 sm:px-6">
      {/* כותרת */}
      <div className="mb-6">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex size-11 items-center justify-center rounded-xl border border-[#d4af37]/30 bg-[#d4af37]/10">
            <Landmark className="size-5 text-[#e8cd6e]" aria-hidden />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-zinc-100 sm:text-3xl">שוק-הכספים הריבוני</h1>
            <p className="mt-1 text-sm text-zinc-500">peer-to-pool בסטנדרט Aave-v3 — על השרשרת-הקנונית שלנו, בלי-תלות-באף-רשת-חוץ</p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
          {doc && (
            <Badge variant="outline" className="gap-1.5 border-[#d4af37]/25 bg-[#d4af37]/5 text-[#e8cd6e]">
              <span className="inline-block size-1.5 rounded-full bg-emerald-400" aria-hidden />
              חי מ-world.json · גובה {doc.state.height.toLocaleString("he-IL")} · {dataAge(doc.publishedAt)}
            </Badge>
          )}
          {invariantOk && (
            <Badge variant="outline" className="gap-1.5 border-emerald-500/25 bg-emerald-500/5 text-emerald-300">
              <ShieldCheck className="size-3" aria-hidden /> אינווריאנטה: pot=Σקרן+Σרווחים−Σחוב · כל-הנכסים
            </Badge>
          )}
          <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-[11px] text-zinc-400" onClick={() => void load()} aria-label="רענון נתונים">
            <RefreshCw className={cn("size-3", loading && "animate-spin")} aria-hidden />
            רענון
          </Button>
        </div>
      </div>

      {err && (
        <Card className="mb-5 border-red-500/30 bg-red-500/5">
          <CardContent className="flex items-center gap-2 p-4 text-sm text-red-300">
            <Siren className="size-4" aria-hidden /> טעינת המראה הציבורית נכשלה: {err} — מנסה שוב אוטומטית
          </CardContent>
        </Card>
      )}

      {loading && !doc ? (
        <div className="grid gap-4 md:grid-cols-2">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-40 rounded-2xl" />)}
        </div>
      ) : !lend ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <Loader2 className="size-6 animate-spin text-zinc-500" aria-hidden />
            <p className="text-sm text-zinc-400">השוק טרם נולד בתמונת-המצב הזו — הוא נולד ב-h28762 (R44).</p>
            <p className="text-xs text-zinc-600">אם זה נמשך — המראה הציבורית תתעדכן בפעימה הבאה.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-5">
          {/* כרטיסי-מפתח */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              { icon: Banknote, label: "הון-אספקה (USDS)", value: fmtUsd(suppliesUsd), sub: `${fmtMu(suppliesUsd)}µ מוזרם` },
              { icon: Vault, label: "חוב-חי (USDS)", value: fmtUsd(debtUsd), sub: `${fmtMu(debtUsd)}µ ב-מחזורים` },
              { icon: Gauge, label: "ניצולת-חיה", value: fmtPctBps(usds?.utilBps ?? 0, 1), sub: `שאילה ${fmtPctBps(usds?.borrowAprBps ?? 0)} APR` },
              { icon: TrendingUp, label: "תשואת-מלווה", value: fmtPctBps(usds?.supplyAprBps ?? 0), sub: "מריבית-ששולמה-בפועל" },
            ].map((k) => (
              <Card key={k.label} className="border-zinc-800/80 bg-zinc-950/60">
                <CardContent className="p-4">
                  <div className="flex items-center gap-1.5 text-[11px] text-zinc-500">
                    <k.icon className="size-3.5 text-[#e8cd6e]" aria-hidden /> {k.label}
                  </div>
                  <div className="mt-1.5 text-xl font-black tabular-nums text-zinc-100">{k.value}</div>
                  <div className="text-[10px] text-zinc-600">{k.sub}</div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* העקומה + שוק-האם */}
          <Card className="border-zinc-800/80 bg-zinc-950/60">
            <CardContent className="p-5">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-bold text-zinc-200">עקומת-הריבית · שוק USDS</h2>
                <p className="w-full text-[10px] leading-snug text-zinc-600">
                  USDS = יחידת-פדיון פנימית (הטבעה=נעילה 1:1 ברזרבה, פדיון=שריפה 1:1) — לא מטבע ציבורי
                </p>
                <Badge variant="outline" className="border-[#a78bfa]/25 bg-[#a78bfa]/5 text-[#a78bfa] text-[10px]">
                  פרמטרי-עקומה (קבועים בקוד): בסיס 1% + שיפוע 4% עד 80% · +60% מעל
                </Badge>
              </div>
              <KinkCurve m={usds} />
              <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-zinc-500 sm:grid-cols-4">
                <span>מזומן-בבריכה: <b className="text-zinc-300">{fmtUsd(usds?.cashMu)}</b></span>
                <span>פקטור-רזרבה (קבוע בקוד): <b className="text-zinc-300">10% → אוצר</b></span>
                <span>רצפת-נזילות (קבוע בקוד): <b className="text-zinc-300">10% — רצפה בקוד, לא הבטחת נזילות חוץ</b></span>
                <span>חוצץ-HF בשאילה (קבוע בקוד): <b className="text-zinc-300">1.10</b></span>
              </div>
            </CardContent>
          </Card>

          {/* השווקים */}
          <Card className="border-zinc-800/80 bg-zinc-950/60">
            <CardContent className="p-5">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-zinc-200">
                <Coins className="size-4 text-[#e8cd6e]" aria-hidden /> השווקים הקנוניים
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm">
                  <thead>
                    <tr className="border-b border-zinc-800 text-[11px] text-zinc-500">
                      <th className="pb-2 pr-2 text-right font-medium">נכס</th>
                      <th className="pb-2 text-right font-medium">אספקה</th>
                      <th className="pb-2 text-right font-medium">חוב</th>
                      <th className="pb-2 text-right font-medium">מזומן</th>
                      <th className="pb-2 text-right font-medium">ניצולת</th>
                      <th className="pb-2 text-right font-medium">שאילה APR</th>
                      <th className="pb-2 text-right font-medium">אספקה APR</th>
                      <th className="pb-2 text-right font-medium">LTV / סף-ניזולת</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lend.markets.map((m) => (
                      <tr key={m.asset} className={cn("border-b border-zinc-900", (m.sMu === 0 && m.bMu === 0) && "opacity-40")}>
                        <td className="py-2.5 pr-2">
                          <span className="font-bold text-zinc-100">{m.asset}</span>
                        </td>
                        <td className="py-2.5 tabular-nums text-zinc-300">{m.asset === "USDS" ? fmtUsd(m.sMu) : `${fmtMu(m.sMu)}µ`}</td>
                        <td className="py-2.5 tabular-nums text-zinc-300">{m.asset === "USDS" ? fmtUsd(m.bMu) : `${fmtMu(m.bMu)}µ`}</td>
                        <td className="py-2.5 tabular-nums text-zinc-400">{m.asset === "USDS" ? fmtUsd(m.cashMu) : `${fmtMu(m.cashMu)}µ`}</td>
                        <td className="py-2.5">
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-16 overflow-hidden rounded-full bg-zinc-800">
                              <div
                                className={cn("h-full rounded-full", m.utilBps > 8000 ? "bg-orange-400" : "bg-[#d4af37]")}
                                style={{ width: `${Math.min(100, m.utilBps / 100)}%` }}
                              />
                            </div>
                            <span className="tabular-nums text-zinc-400">{fmtPctBps(m.utilBps, 1)}</span>
                          </div>
                        </td>
                        <td className="py-2.5 tabular-nums font-semibold text-[#e8cd6e]">{fmtPctBps(m.borrowAprBps)}</td>
                        <td className="py-2.5 tabular-nums text-zinc-400">{fmtPctBps(m.supplyAprBps)}</td>
                        <td className="py-2.5 tabular-nums text-zinc-500">{fmtPctBps(m.ltvBps, 0)} / {fmtPctBps(m.liqThresholdBps, 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {collateralUsd > 0 ? (
                <p className="mt-3 text-[11px] leading-relaxed text-zinc-600">
                  בטחונות-על מתומחרים ב-~${collateralUsd.toLocaleString("he-IL", { maximumFractionDigits: 2 })} לפי האורקל-הקנוני החי מ-world.json
                  ({pricedCollateral.map((m) => `${m.asset}: ${(m.priceMu / 1e6).toLocaleString("he-IL", { maximumFractionDigits: 4 })}$`).join(" · ")}) —
                  הנכסים-העטופים מגובים-1:1 בכסף-אמת במשמרות-הצבא.
                  {unpricedCollateral.length > 0 && (
                    <>
                      {" "}נכסים ללא מחיר-אורקל (לא מוערכים): {" "}
                      {unpricedCollateral.map((m) => `${m.asset} ${fmtMu(m.sMu)}µ`).join(" · ")}.
                    </>
                  )}
                </p>
              ) : (
                <p className="mt-3 text-[11px] leading-relaxed text-zinc-600">
                  אין בטחונות מתומחרים באורקל בתמונת-מצב זו
                  {unpricedCollateral.length > 0 && (
                    <> — נכסים ללא מחיר-אורקל: {unpricedCollateral.map((m) => `${m.asset} ${fmtMu(m.sMu)}µ`).join(" · ")}</>
                  )}
                  . הנכסים-העטופים מגובים-1:1 בכסף-אמת במשמרות-הצבא.
                </p>
              )}
            </CardContent>
          </Card>

          {/* העמדות החיות */}
          <Card className="border-zinc-800/80 bg-zinc-950/60">
            <CardContent className="p-5">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-zinc-200">
                <Users className="size-4 text-[#e8cd6e]" aria-hidden /> עמדות-חיות · HF מחושב-שרשרת
              </h2>
              <div className="space-y-2.5">
                {lend.positions.map((p) => {
                  const hfOk = p.hf >= 150;
                  const hfWarn = p.hf < 150 && p.hf >= 100;
                  return (
                    <div key={p.who} className="rounded-xl border border-zinc-800/70 bg-zinc-900/40 p-3.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Wallet className="size-3.5 text-zinc-500" aria-hidden />
                          <span className="text-sm font-bold text-zinc-100">{AGENT_LABEL[p.who] ?? p.who}</span>
                          <code className="rounded bg-zinc-800/60 px-1.5 py-0.5 text-[10px] text-zinc-500">{p.who}</code>
                        </div>
                        <div className="flex items-center gap-2">
                          {p.borrows.length > 0 && (
                            <Badge variant="outline" className={cn("gap-1 text-[10px] tabular-nums",
                              hfOk ? "border-emerald-500/25 bg-emerald-500/5 text-emerald-300"
                                : hfWarn ? "border-amber-500/25 bg-amber-500/5 text-amber-300"
                                : "border-red-500/30 bg-red-500/5 text-red-300")}>
                              HF {fmtHf(p.hf)}
                            </Badge>
                          )}
                        </div>
                      </div>
                      <div className="mt-2 grid gap-1.5 text-[11px] sm:grid-cols-2">
                        {p.supplies.map((s) => (
                          <div key={`s-${s.asset}`} className="flex items-center justify-between gap-2 rounded-lg bg-zinc-900/60 px-2.5 py-1.5">
                            <span className="text-zinc-500">אספקה · {s.asset}</span>
                            <span className="tabular-nums text-zinc-300">
                              {fmtMu(s.mu)}µ{s.earned > 0 && <span className="text-emerald-400"> +{fmtMu(s.earned)}µ רווח</span>}
                            </span>
                          </div>
                        ))}
                        {p.borrows.map((b) => (
                          <div key={`b-${b.asset}`} className="flex items-center justify-between gap-2 rounded-lg bg-zinc-900/60 px-2.5 py-1.5">
                            <span className="text-zinc-500">חוב · {b.asset}</span>
                            <span className="tabular-nums text-zinc-300">
                              {fmtMu(b.debtMu)}µ{b.int > 0 && <span className="text-amber-400"> (ריבית {fmtMu(b.int)}µ)</span>}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* חלוקת-הריבית + מונים */}
          <div className="grid gap-4 md:grid-cols-2">
            <Card className="border-zinc-800/80 bg-zinc-950/60">
              <CardContent className="p-5">
                <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-zinc-200">
                  <Percent className="size-4 text-[#e8cd6e]" aria-hidden /> חלוקת-הריבית (מדידה-חיה)
                </h2>
                <div className="mb-3 flex items-center gap-2 text-[11px] text-zinc-500">
                  <span className="rounded-lg bg-zinc-900 px-2 py-1 text-zinc-300">הלווה משלם</span>
                  <span aria-hidden>←</span>
                  <span className="rounded-lg bg-[#d4af37]/10 px-2 py-1 text-[#e8cd6e]">90% למלווים פרו-ראטה</span>
                  <span aria-hidden>+</span>
                  <span className="rounded-lg bg-[#a78bfa]/10 px-2 py-1 text-[#a78bfa]">10% לאוצר</span>
                </div>
                <dl className="grid grid-cols-2 gap-2.5 text-[11px]">
                  {[
                    { k: "ריבית-ששולמה (µ)", v: `${fmtMu(totals?.interestPaidMu ?? 0)}µ`, note: "רק-מה-שהגיע-בפועל" },
                    { k: "רזרבות-לאוצר (µ)", v: `${fmtMu(totals?.resToTreasuryMu ?? 0)}µ`, note: "הכנסת-רשת-מדודה" },
                    { k: "מחזורים", v: `${totals?.opens ?? 0} נפתחו · ${totals?.closes ?? 0} נסגרו`, note: "הסוכנים-מסונכרנים" },
                    { k: "ניזולות", v: String(totals?.liquidations ?? 0), note: "אפס = כולם בריאים" },
                  ].map((r) => (
                    <div key={r.k} className="rounded-lg border border-zinc-800/60 bg-zinc-900/40 p-2.5">
                      <dt className="text-zinc-500">{r.k}</dt>
                      <dd className="mt-0.5 tabular-nums font-bold text-zinc-200">{r.v}</dd>
                      <dd className="text-[10px] text-zinc-600">{r.note}</dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-3 text-[11px] leading-relaxed text-zinc-600">
                  כנות-סקאלה: בניצולת-עכשיו ({fmtPctBps(usds?.utilBps ?? 0, 1)}) ו-APR {fmtPctBps(usds?.borrowAprBps ?? 0)} —
                  ריבית-יום על החוב היא µ-בודדים. זו האמת של סדר-הגודל; החלוקה הוכחה מדויקת-עד-ה-µ בהוכחה-המקומית (45/45).
                </p>
              </CardContent>
            </Card>

            {/* עמדת-האוצר + הסוכנים */}
            <Card className="border-zinc-800/80 bg-zinc-950/60">
              <CardContent className="p-5">
                <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-zinc-200">
                  <Landmark className="size-4 text-[#e8cd6e]" aria-hidden /> הסוכנים האוטונומיים — שלושה-תפקידים
                </h2>
                <div className="space-y-2.5 text-[12px]">
                  <div className="rounded-lg border border-[#d4af37]/20 bg-[#d4af37]/5 p-3">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-[#e8cd6e]">האוצר — מנהל-הנזילות</span>
                      <span className="tabular-nums text-zinc-300">{fmtUsd(lend.treasury.suppliedMu)}</span>
                    </div>
                    <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
                      מזרים-אדפטיבית 3× ביקוש-האשראי-החי (בין 20kµ ל-500kµ) — ההון-הרדום מרוויח,
                      והשוק מעמיק-כשהביקוש-גדל. תשואה-חיה: {fmtPctBps(lend.treasury.supplyAprBps)} ·
                      רווח שנצבר: {fmtMu(lend.treasury.earnedMu)}µ
                    </p>
                  </div>
                  <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/5 p-3">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-emerald-300">ספקי-הצי (R45) — THE-PEERS</span>
                      <span className="tabular-nums text-zinc-300">{lend.positions.filter((p) => (p.supplies.find((s) => s.asset === "USDS")?.mu ?? 0) > 0 && p.who !== "treasury").length} עמיתים</span>
                    </div>
                    <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
                      soldier-2 ו-soldier-4 מזרימים אספקת-USDS עצמאית משלהם (יעד-אדפטיבי 3× חוב-חי, רצפה-10kµ,
                      תקרה-150kµ, נוזר מ-2.5Mµ לנזילות-עבודת-שוק) — חלוקת-ה-90% זורמת-פרו-ראטה-אמת
                      בין-כיסים-עצמאיים, לא-חזרה-לאוצר-לבד.
                    </p>
                  </div>
                  <div className="rounded-lg border border-zinc-800/60 bg-zinc-900/40 p-3">
                    <div className="font-bold text-zinc-200">חיילי-הצי — מחזורי-אשראי</div>
                    <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
                      soldier-1 ו-soldier-3 מפקידים בטחונות-WSTEEM מהיתרה-הפנויה-האמיתית, שואלים
                      USDS ב-30% LTV (HF פתיחה ≈ 3.3), מחזיקים ~יום, פורעים-בריבית ומשחררים —
                      וחוזר. הגנה-עצמית: פירעון-מוקדם מתחת-ל-HF 1.5.
                    </p>
                  </div>
                  <div className="rounded-lg border border-zinc-800/60 bg-zinc-900/40 p-3">
                    <div className="font-bold text-zinc-200">דבר-גורר-דבר</div>
                    <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
                      הפקדה-חיצונית ← USDS ← אשראי-לצי ← עמלות ← אוצר ← ריבית ← מלווים.
                      המחזור-הראשון בהיסטוריה: h28762←h28768 (commit 99c2221).
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* אינווריאנטות + קישורים */}
          <Card className="border-zinc-800/80 bg-zinc-950/60">
            <CardContent className="p-5">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-zinc-200">
                <ShieldCheck className="size-4 text-emerald-400" aria-hidden /> ביקורת-הספרים החיה
              </h2>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {Object.entries(lend.invariant).map(([asset, v]) => (
                  <div key={asset} className={cn("rounded-lg border p-2.5 text-[11px]",
                    v.ok ? "border-emerald-500/20 bg-emerald-500/5" : "border-red-500/30 bg-red-500/5")}>
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-zinc-200">{asset}</span>
                      <Badge variant="outline" className={cn("text-[10px]", v.ok ? "border-emerald-500/25 text-emerald-300" : "border-red-500/30 text-red-300")}>
                        {v.ok ? "תקין" : "שבור"}
                      </Badge>
                    </div>
                    <div className="mt-1 tabular-nums text-zinc-500">
                      pot {fmtMu(v.pot)}µ = קרן+רווחים−חוב {fmtMu(v.expect)}µ
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-4 flex flex-wrap gap-2 text-[11px]">
                <a href={WORLD_URL} target="_blank" rel="noreferrer" className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-2.5 py-1.5 text-zinc-400 underline-offset-4 hover:text-[#e8cd6e] hover:underline">
                  world.json — מקור-האמת החי
                </a>
                <a href="https://github.com/roshpinacare-sys/saos-dex/commit/99c2221" target="_blank" rel="noreferrer" className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-2.5 py-1.5 text-zinc-400 underline-offset-4 hover:text-[#e8cd6e] hover:underline">
                  commit 99c2221 — לידת-השוק (h28762←h28768)
                </a>
                <a href="https://github.com/roshpinacare-sys/saos-dex/blob/main/scripts/lend-proof.ts" target="_blank" rel="noreferrer" className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-2.5 py-1.5 text-zinc-400 underline-offset-4 hover:text-[#e8cd6e] hover:underline">
                  ההוכחה-המבודדת — 45/45
                </a>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
