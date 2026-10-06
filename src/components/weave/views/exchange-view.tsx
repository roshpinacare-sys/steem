"use client";

// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · Exchange View - הבורסה הריבונית החיה.
//
// הדקס האמיתי מתוך saos-dex (ריפו פרטי, מופעל מ-127.0.0.1:3010 דרך
// ה-rewrite של שרת-האם). כל הנתונים נמשכים מ-/saos-dex/api/dex/state
// ב-long-poll (v=N) - השרשרת מתקדמת, העמוד מתעדכן לבד.
// הגרף: canvas טהור מהיסטוריית הטייפ שנצברת בצד הלקוח - אפס CDN.
// ─────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  BarChart3,
  Boxes,
  ExternalLink,
  Gauge,
  HeartPulse,
  Layers,
  Pause,
  Play,
  ShieldCheck,
  Waves,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { truncateMiddle, PageWash } from "../shared";

// ── טיפוסים ממופים ל-API החי של הדקס ─────────────────────────────────

interface BookLevel {
  price: number;
  total: number;
  orders: number;
}

interface DexMarket {
  base: string;
  quote: string;
  key: string;
  fair: number;
  bestBid: number;
  bestAsk: number;
  spreadBps: number;
  poolMid: number;
  refPrice: number;
  twap: number;
  bids: BookLevel[];
  asks: BookLevel[];
}

interface DexPool {
  key: string;
  a: string;
  b: string;
  ra: number;
  rb: number;
  lp: number;
  mid: number;
  swaps: number;
  feeAccruedTreasury: number;
  k: number;
}

interface TapeEvent {
  kind: string;
  base?: string;
  quote?: string;
  price?: number;
  amountMu?: number;
  quoteMu?: number;
  taker?: string;
  maker?: string;
  at: number;
  h: number;
}

interface DexWallet {
  name: string;
  credits: number;
  balances: Record<string, number>;
}

interface DexStateResponse {
  ok: boolean;
  version: number;
  tick: number;
  publishedAt: string;
  state: {
    height: number;
    tps: number;
    stateRoot: string;
    opsTotal: number;
    fills: number;
    swaps: number;
    treasuryProfit: number;
    liveOrders: number;
    buildMs: number;
    uptimeSec: number;
    lastBlockAgoMs: number;
    dbOk: boolean;
    halted: boolean;
    haltReason?: string;
    rejectedLast?: number;
  };
  markets: DexMarket[];
  pools: DexPool[];
  wallets: DexWallet[];
  arena: { dbOk?: boolean; mempool?: number };
  proofs: {
    seals: Array<{
      fromHeight: number;
      toHeight: number;
      root: string;
      stateRoot: string;
      leaves: number;
      at: number;
    }>;
  };
  tape: TapeEvent[];
}

// µ -> יחידות (1 SAOS = 1000µ; מחיר = µ-ציטוט ליחידת בסיס)
function fmtPriceMu(p: number): string {
  return (p / 1000).toFixed(3);
}
function fmtAmtMu(mu: number): string {
  return (mu / 1000).toLocaleString("he-IL", { maximumFractionDigits: 1 });
}
function fmtUptime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}ש ${m}ד`;
  if (m > 0) return `${m}ד ${s}ש`;
  return `${s}ש`;
}
function fmtTime(at: number): string {
  return new Date(at).toLocaleTimeString("he-IL", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

// ── גרף מחירים: canvas טהור, זיכרון מתגלגל ────────────────────────────

function PriceChart({
  history,
  market,
}: {
  history: Array<{ p: number; t: number }>;
  market: string;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const pts = history.slice(-180);
    if (pts.length < 2) {
      ctx.fillStyle = "rgba(113,113,122,0.7)";
      ctx.font = "13px system-ui";
      ctx.textAlign = "center";
      ctx.fillText("ממתין לעסקאות…", w / 2, h / 2);
      return;
    }

    const prices = pts.map((x) => x.p);
    let lo = Math.min(...prices);
    let hi = Math.max(...prices);
    if (hi - lo < 1) {
      hi += 1;
      lo -= 1;
    }
    const padY = (hi - lo) * 0.12;
    lo -= padY;
    hi += padY;
    const x = (i: number) => (i / (pts.length - 1)) * (w - 8) + 4;
    const y = (p: number) => h - 8 - ((p - lo) / (hi - lo)) * (h - 20);

    // רשת עדינה
    ctx.strokeStyle = "rgba(113,113,122,0.12)";
    ctx.lineWidth = 1;
    for (let g = 0; g <= 4; g++) {
      const gy = 8 + (g / 4) * (h - 16);
      ctx.beginPath();
      ctx.moveTo(0, gy);
      ctx.lineTo(w, gy);
      ctx.stroke();
    }

    const up = pts[pts.length - 1].p >= pts[0].p;
    const stroke = up ? "#10b981" : "#f43f5e";
    const fill = up ? "rgba(16,185,129,0.10)" : "rgba(244,63,94,0.10)";

    // אזור מתחת לקו
    ctx.beginPath();
    ctx.moveTo(x(0), y(pts[0].p));
    pts.forEach((pt, i) => ctx.lineTo(x(i), y(pt.p)));
    ctx.lineTo(x(pts.length - 1), h - 4);
    ctx.lineTo(x(0), h - 4);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();

    // הקו עצמו
    ctx.beginPath();
    ctx.moveTo(x(0), y(pts[0].p));
    pts.forEach((pt, i) => ctx.lineTo(x(i), y(pt.p)));
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.stroke();

    // נקודה חיה בקצה
    const lastX = x(pts.length - 1);
    const lastY = y(pts[pts.length - 1].p);
    ctx.beginPath();
    ctx.arc(lastX, lastY, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = stroke;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(lastX, lastY, 7, 0, Math.PI * 2);
    ctx.fillStyle = up ? "rgba(16,185,129,0.25)" : "rgba(244,63,94,0.25)";
    ctx.fill();

    // מינ/מקס
    ctx.font = "11px ui-monospace, monospace";
    ctx.fillStyle = "rgba(113,113,122,0.9)";
    ctx.textAlign = "left";
    ctx.fillText(fmtPriceMu(hi - padY), 6, 16);
    ctx.fillText(fmtPriceMu(lo + padY), 6, h - 6);
  }, [history]);

  return (
    <div className="relative h-56 w-full sm:h-64" aria-label={`גרף מחירים ${market}`}>
      <canvas ref={ref} className="h-full w-full" dir="ltr" />
    </div>
  );
}

// ── סולם ספר-הזמנות ──────────────────────────────────────────────────

function OrderBook({ market }: { market: DexMarket }) {
  const bids = market.bids.slice(0, 8);
  const asks = market.asks.slice(0, 8);
  const maxTotal = Math.max(
    ...bids.map((b) => b.total),
    ...asks.map((a) => a.total),
    1
  );

  const Row = ({
    level,
    side,
  }: {
    level: BookLevel;
    side: "bid" | "ask";
  }) => (
    <div className="relative grid grid-cols-[1fr_auto_auto] items-center gap-2 px-2 py-[3px] text-xs tabular-nums">
      <div
        className={cn(
          "absolute inset-y-[1px] rounded-sm",
          side === "bid" ? "bg-emerald-500/12 right-0" : "bg-rose-500/12 right-0"
        )}
        style={{ width: `${Math.max(4, (level.total / maxTotal) * 100)}%` }}
        aria-hidden="true"
      />
      <span
        className={cn(
          "relative font-mono",
          side === "bid" ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"
        )}
      >
        {fmtPriceMu(level.price)}
      </span>
      <span className="relative text-muted-foreground">{fmtAmtMu(level.total)}</span>
      <span className="relative text-muted-foreground/70">{level.orders}</span>
    </div>
  );

  return (
    <div className="flex flex-col gap-1" dir="ltr">
      <div className="grid grid-cols-[1fr_auto_auto] gap-2 px-2 pb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
        <span>מחיר $</span>
        <span>כמות</span>
        <span>הזמנות</span>
      </div>
      <div className="flex flex-col-reverse gap-[1px]">
        {asks.map((a) => (
          <Row key={`a-${a.price}`} level={a} side="ask" />
        ))}
      </div>
      <div className="my-1 flex items-center justify-between border-y px-2 py-1.5 text-xs">
        <span className="font-mono font-bold">
          {fmtPriceMu(market.fair)} $
        </span>
        <span className="text-muted-foreground">
          ספרד {market.spreadBps}bps
        </span>
      </div>
      <div className="flex flex-col gap-[1px]">
        {bids.map((b) => (
          <Row key={`b-${b.price}`} level={b} side="bid" />
        ))}
      </div>
      {bids.length === 0 && asks.length === 0 && (
        <p className="px-2 py-4 text-center text-xs text-muted-foreground">
          הספר ריק - הארנה עדיין מצטטת
        </p>
      )}
    </div>
  );
}

// ── התצוגה הראשית ────────────────────────────────────────────────────

export function ExchangeView() {
  const [data, setData] = useState<DexStateResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [marketKey, setMarketKey] = useState<string>("SAOS/USDS");
  const historyRef = useRef<Array<{ p: number; t: number }>>([]);
  const seenRef = useRef<Set<string>>(new Set());
  const versionRef = useRef(0);
  const pausedRef = useRef(false);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      try {
        const res = await fetch(
          `/api/live/dex?v=${versionRef.current}`,
          { cache: "no-store" }
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const j = (await res.json()) as DexStateResponse;
        if (!j.ok) throw new Error("המראה לא תקינה");
        if (!alive) return;
        setData(j);
        setError(null);
        versionRef.current = j.version;
        // צבירת היסטוריית מחירים מהטייפ (דה-דופליקציה לפי חותמת)
        if (!pausedRef.current) {
          for (const ev of j.tape ?? []) {
            if (ev.price && ev.at) {
              const key = `${ev.at}-${ev.h}-${ev.kind}-${ev.taker ?? ""}`;
              if (!seenRef.current.has(key)) {
                seenRef.current.add(key);
                historyRef.current.push({ p: ev.price, t: ev.at });
              }
            }
          }
          if (historyRef.current.length > 600) {
            historyRef.current = historyRef.current.slice(-600);
          }
          if (seenRef.current.size > 4000) {
            seenRef.current = new Set();
          }
        }
      } catch (e) {
        if (alive) {
          setError(
            e instanceof Error ? e.message : "הבורסה לא נענית"
          );
        }
      }
      if (alive) {
        // מראת ענן: הגרסה מתקדמת בפעימות הבורסה - סקירה רגועה של 12ש'
        timer = setTimeout(poll, 12_000);
      }
    };

    poll();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, []);

  const refreshNow = useCallback(() => {
    versionRef.current = 0;
  }, []);

  // R117 — רענון-גיל חי: המראה מתחדשת כל ~2 שעות, אבל גיל האמת שלה חייב
  // להתקדם בשעון המשתמש. טיק-דקה גורם ל-render מחדש בלי לגעת בנתונים.
  const [, setAgeTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setAgeTick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  const market =
    data?.markets.find((m) => m.key === marketKey) ?? data?.markets[0] ?? null;
  const pool = data?.pools.find((p) => p.key === (market?.key ?? "")) ?? null;
  const seals = data?.proofs.seals ?? [];
  const lastSeal = seals[seals.length - 1] ?? null;
  const treasury = data?.wallets.find((w) => w.name === "treasury") ?? null;

  // R117 — אמת-הגיל של המראה (ראה הערה ב"גיל המראה" למטה)
  const mirrorAgeMs = data?.publishedAt
    ? Math.max(0, Date.now() - new Date(data.publishedAt).getTime())
    : null;
  const mirrorAgeMin = mirrorAgeMs != null ? mirrorAgeMs / 60_000 : null;
  const fmtMirrorAge =
    mirrorAgeMin == null
      ? "—"
      : mirrorAgeMin < 60
        ? `${Math.round(mirrorAgeMin)} דק׳`
        : `${(mirrorAgeMin / 60).toFixed(1)} ש׳`;

  const health = data
    ? [
        {
          icon: Layers,
          label: "גובה",
          value: String(data.state.height),
          ok: !data.state.halted,
        },
        {
          icon: Gauge,
          label: "TPS",
          value: data.state.tps.toFixed(1),
          ok: true,
        },
        {
          icon: HeartPulse,
          label: "גיל המראה",
          // R117 — אמת-הגיל: המראה מתפרסמת בקצב dex-beat (~כל שעתיים). lastBlockAgoMs
          // קפוא מזמן הבנייה ולכן שיקר בעבר ("9.6 שניות" על נתונים בני שעה). הגיל
          // האמיתי נמדד מ-publishedAt מול השעון החי — תמיד.
          value: fmtMirrorAge,
          ok: mirrorAgeMs != null && mirrorAgeMs < 2.5 * 3_600_000,
        },
        {
          icon: Activity,
          label: "עסקאות (מצטבר · אוטונומיות)",
          value: data.state.fills + data.state.swaps > 0 ? `${data.state.fills}מילויים · ${data.state.swaps}סוופים` : "0",
          ok: true,
        },
        {
          icon: ShieldCheck,
          label: "חותמות מפתח (היסטוריות)",
          value: String(seals.length),
          ok: data.state.dbOk,
        },
        {
          icon: Waves,
          label: "ריצה",
          value: fmtUptime(data.state.uptimeSec),
          ok: true,
        },
      ]
    : [];

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      {/* כותרת */}
      <div className="relative isolate mb-6 flex flex-wrap items-center justify-between gap-4">
        <PageWash className="-inset-x-4 -inset-y-3 rounded-2xl" />
        <div className="flex items-center gap-3">
          <span
            className="flex size-11 items-center justify-center rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
            aria-hidden="true"
          >
            <BarChart3 className="size-5" />
          </span>
          <div>
            <h1 className="flex flex-wrap items-center gap-2 text-xl font-bold tracking-tight sm:text-2xl">
              הבורסה הריבונית
              <Badge
                variant="outline"
                className="border-emerald-500/40 bg-emerald-500/10 text-[10px] text-emerald-700 dark:text-emerald-300"
              >
                מראת ענן · פועמת כל ~2 שעות
              </Badge>
            </h1>
            <p className="text-xs text-muted-foreground sm:text-sm">
              שרשרת פנימית דטרמיניסטית · מנוע-ריפליי בענן (dex-beat, 480 טיקים
              לפעימה) · אפס משתמשים אנושיים — סוחרים אוטונומיים בלבד ·
              יחידות פנימיות (USDS = זכות-פדיון מתועדת)
            </p>
            {data?.publishedAt ? (
              <p className="mt-0.5 font-mono text-[10px] text-muted-foreground/70">
                world.json · פורסם {data.publishedAt.slice(11, 16)}Z · גיל אמיתי {fmtMirrorAge}
              </p>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPaused((p) => !p)}
            aria-label={paused ? "המשך עדכון חי" : "השהה עדכון חי"}
          >
            {paused ? <Play className="size-4" /> : <Pause className="size-4" />}
            {paused ? "המשך" : "השהה"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              window.open(
                "https://roshpinacare-sys.github.io/Console/#/exchange/terminal",
                "_blank",
                "noopener"
              )
            }
          >
            <ExternalLink className="size-4" />
            טרמינל מלא
          </Button>
        </div>
      </div>

      {error && (
        <Card className="mb-6 border-amber-500/40 bg-amber-500/5">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <p className="text-sm">
              מראת הדקס בענן לא נענית כרגע ({error}). הבורסה עצמה פועמת
              בענן - הבעיה בקריאה בלבד; נסה שוב בעוד רגע.
            </p>
            <Button size="sm" variant="outline" onClick={refreshNow}>
              נסה שוב
            </Button>
          </CardContent>
        </Card>
      )}

      {data?.state.halted && (
        <Card className="mb-6 border-rose-500/40 bg-rose-500/5">
          <CardContent className="p-4 text-sm">
            השרשרת הופסקה ביושר: {data.state.haltReason ?? "סיבה לא ידועה"}.
            הראיות ב-DB לא נפגעו (fail-closed).
          </CardContent>
        </Card>
      )}

      {/* פס בריאות */}
      {!data ? (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-[76px] rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {health.map((h) => (
            <Card key={h.label} className="overflow-hidden">
              <CardContent className="flex flex-col gap-1 p-3 sm:p-4">
                <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <h.icon className="size-3.5 shrink-0" aria-hidden="true" />
                  {h.label}
                </span>
                <span
                  className={cn(
                    "truncate font-mono text-sm font-bold sm:text-base",
                    h.ok ? "text-foreground" : "text-amber-600 dark:text-amber-400"
                  )}
                >
                  {h.value}
                </span>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* בחירת שוק */}
      {data && data.markets.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {data.markets.map((m) => {
            const active = (market?.key ?? "") === m.key;
            return (
              <button
                key={m.key}
                type="button"
                onClick={() => setMarketKey(m.key)}
                className={cn(
                  "flex h-11 items-center gap-3 rounded-xl border px-4 text-sm font-medium transition-colors",
                  active
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                    : "bg-background text-muted-foreground hover:bg-muted/50"
                )}
                aria-pressed={active}
              >
                <span className="font-mono">{m.key}</span>
                <span className="font-mono text-xs text-muted-foreground">
                  {fmtPriceMu(m.fair)} $
                </span>
                <span
                  className={cn(
                    "font-mono text-xs",
                    m.bestAsk > 0 && m.bestBid > 0
                      ? m.fair >= m.refPrice
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-rose-600 dark:text-rose-400"
                      : "text-muted-foreground"
                  )}
                >
                  {m.bestAsk > 0 && m.bestBid > 0
                    ? `${(((m.fair - m.refPrice) / m.refPrice) * 100).toFixed(2)}%`
                    : "-"}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* גוף הבורסה */}
      <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        {/* גרף + טייפ */}
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardContent className="p-4 sm:p-6">
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                <div className="flex items-baseline gap-3">
                  <span className="font-mono text-lg font-bold">
                    {market ? fmtPriceMu(market.fair) : "-"} $
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {market?.key ?? ""}
                  </span>
                </div>
                <div className="flex gap-4 font-mono text-xs text-muted-foreground">
                  <span>
                    bid {market ? fmtPriceMu(market.bestBid) : "-"}
                  </span>
                  <span>
                    ask {market ? fmtPriceMu(market.bestAsk) : "-"}
                  </span>
                  <span>
                    TWAP {market ? fmtPriceMu(market.twap) : "-"}
                  </span>
                </div>
              </div>
              <PriceChart history={historyRef.current} market={market?.key ?? ""} />
            </CardContent>
          </Card>

          {/* טייפ עסקאות */}
          <Card>
            <CardContent className="p-4 sm:p-6">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-bold">
                <Activity className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                עסקאות אחרונות
              </h2>
              <div
                className="max-h-72 w-full overflow-x-auto overflow-y-auto overscroll-contain rounded-lg [scrollbar-width:thin]"
                dir="ltr"
              >
                <table className="w-full min-w-[480px] text-xs tabular-nums">
                  <thead className="sticky top-0 bg-background/95 backdrop-blur">
                    <tr className="border-b text-start text-[10px] uppercase tracking-wide text-muted-foreground/70">
                      <th className="px-2 py-2 text-start font-medium">שעה</th>
                      <th className="px-2 py-2 text-start font-medium">סוג</th>
                      <th className="px-2 py-2 text-start font-medium">זוג</th>
                      <th className="px-2 py-2 text-start font-medium">מחיר $</th>
                      <th className="px-2 py-2 text-start font-medium">כמות</th>
                      <th className="px-2 py-2 text-start font-medium">צד</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.tape ?? []).map((ev, i) => (
                      <tr
                        key={`${ev.at}-${i}`}
                        className="border-b border-border/40 last:border-0"
                      >
                        <td className="px-2 py-1.5 font-mono text-muted-foreground">
                          {fmtTime(ev.at)}
                        </td>
                        <td className="px-2 py-1.5">
                          <Badge
                            variant="outline"
                            className={cn(
                              "h-5 px-1.5 text-[10px]",
                              ev.kind === "fill"
                                ? "border-emerald-500/30 text-emerald-600 dark:text-emerald-400"
                                : "border-emerald-500/30 text-emerald-600 dark:text-emerald-400"
                            )}
                          >
                            {ev.kind === "fill" ? "מילוי" : "סוופ"}
                          </Badge>
                        </td>
                        <td className="px-2 py-1.5 font-mono">
                          {ev.base}/{ev.quote}
                        </td>
                        <td className="px-2 py-1.5 font-mono font-semibold">
                          {ev.price ? fmtPriceMu(ev.price) : "-"}
                        </td>
                        <td className="px-2 py-1.5 font-mono text-muted-foreground">
                          {ev.amountMu ? fmtAmtMu(ev.amountMu) : "-"}
                        </td>
                        <td className="px-2 py-1.5 font-mono text-muted-foreground">
                          {ev.taker ?? ev.maker ?? "-"}
                        </td>
                      </tr>
                    ))}
                    {(!data || data.tape.length === 0) && (
                      <tr>
                        <td
                          colSpan={6}
                          className="px-2 py-6 text-center text-muted-foreground"
                        >
                          {data ? "ממתין לעסקאות ראשונות…" : "טוען…"}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* ספר + בריכה */}
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardContent className="p-4 sm:p-6">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-bold">
                <Layers className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                ספר-הזמנות {market?.key ?? ""}
              </h2>
              {market ? (
                <OrderBook market={market} />
              ) : (
                <Skeleton className="h-64 w-full" />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4 sm:p-6">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-bold">
                <Boxes className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                בריכת AMM {pool?.key ?? market?.key ?? ""}
              </h2>
              {pool ? (
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                  <div>
                    <dt className="text-muted-foreground">מאגר {pool.a}</dt>
                    <dd className="font-mono text-sm font-semibold">
                      {fmtAmtMu(pool.ra)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">מאגר {pool.b}</dt>
                    <dd className="font-mono text-sm font-semibold">
                      {fmtAmtMu(pool.rb)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">מחיר אמצע</dt>
                    <dd className="font-mono text-sm font-semibold">
                      {fmtPriceMu(pool.mid)} $
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">סוופים</dt>
                    <dd className="font-mono text-sm font-semibold">{pool.swaps}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">LP נכסים</dt>
                    <dd className="font-mono text-sm font-semibold">{fmtAmtMu(pool.lp)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">עמלות לאוצר</dt>
                    <dd className="font-mono text-sm font-semibold">
                      {fmtAmtMu(pool.feeAccruedTreasury)}
                    </dd>
                  </div>
                </dl>
              ) : (
                <Skeleton className="h-32 w-full" />
              )}
            </CardContent>
          </Card>

          {/* חותם אחרון */}
          <Card>
            <CardContent className="p-4 sm:p-6">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-bold">
                <ShieldCheck className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                חותם אחרון
              </h2>
              {lastSeal ? (
                <div className="space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">חלון בלוקים</span>
                    <span className="font-mono">
                      {lastSeal.fromHeight}-{lastSeal.toHeight}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">stateRoot</span>
                    <span className="font-mono" dir="ltr">
                      {truncateMiddle(lastSeal.stateRoot, 10, 8)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">עלים</span>
                    <span className="font-mono">{lastSeal.leaves}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">שעה</span>
                    <span className="font-mono">{fmtTime(lastSeal.at)}</span>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  החותם הראשון ייחתם בעוד רגע (כל 12 בלוקים)
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* שורת אמת תחתונה */}
      {data && (
        <p className="mt-6 text-center text-[11px] leading-relaxed text-muted-foreground">
          stateRoot חי:{" "}
          <span className="font-mono" dir="ltr">
            {truncateMiddle(data.state.stateRoot, 14, 10)}
          </span>{" "}
          · שרשרת דטרמיניסטית מקומית (saos-dex, ריפו פרטי) · העיגון לשרשרות
          הציבוריות מופעל עם מפתחות המפעיל ·{" "}
          {treasury
            ? `אוצר הדקס: ${fmtAmtMu(treasury.balances.SAOS ?? 0)} SAOS · ${fmtAmtMu(treasury.balances.USDS ?? 0)} USDS`
            : ""}
        </p>
      )}
    </div>
  );
}
