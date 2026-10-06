"use client";

// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · Sovereign-Dex Section — חזית-ה-DEX הריבוני (r193).
//
// הוראת המפעיל (trace 1a1060bf3883050d): "צריך לטפל בו היטב לדאוג
// שנוכל לעשות שם החלפות swap... לכמה שיותר רשתות... גרידים מתנגדים...
// שוק ארביטראז רישתי עבור הסוכנים... ראוטרים שנוכל לקבל ולהחליף גם
// כבר סכומים גדולים על כל רשת."
//
// שלושה לוחות, הכול מ-API חי ובכנות-מלאה:
//   · ראוטר-העומק — מתכנן-מסלולים רב-רגלי (/api/exchange/plan): בריכות,
//     פגים, ספרים, פדיון — עם עומק בר-ביצוע ופיצול-מים לסכומים-גדולים.
//   · הגריד-המתנגד — דיבון :3051 דרך /api/dex-grid: מצב, הטיית-ההתנגדות
//     מול סקיו-ספר-השרשרת, מילויים ו-PnL ממילויים-בלבד.
//   · שוק-הארביטראז-הרישתי — פלייבוק-סוכנים (/api/exchange/agent/arb):
//     הזדמנויות הגלאי + רגל-ברת-ביצוע-לסוכן + קפסות-השער.
// ─────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRightLeft, Bot, Flame, Radar, Route as RouteIcon, Split, Waypoints } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Section, FadeIn, scrollBoxClass } from "@/components/weave/shared";

const ASSETS = [
  "USDS", "SAOS", "WSTEEM", "WSBD", "WHIVE", "WHBD", "WBLURT", "WSOL", "WETH",
  "STEEM", "SBD", "HIVE", "HBD", "BLURT",
] as const;

const KIND_META: Record<string, { he: string; cls: string }> = {
  pool: { he: "בריכה", cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" },
  peg: { he: "פג 1:1", cls: "border-teal-500/40 bg-teal-500/10 text-teal-700 dark:text-teal-400" },
  usds: { he: "USDS", cls: "border-cyan-500/40 bg-cyan-500/10 text-cyan-700 dark:text-cyan-400" },
  book: { he: "ספר-שרשרת", cls: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400" },
  convert: { he: "פדיון-3.5d", cls: "border-orange-500/40 bg-orange-500/10 text-orange-700 dark:text-orange-400" },
};

interface PlanLeg {
  kind: string; venue: string; pair: string; assetIn: string; assetOut: string;
  rate: number; feeBps: number; maxIn: number | null; settleTimeSec: number;
  executable: boolean; note: string;
}
interface PlanRoute {
  id: string; legs: PlanLeg[]; amountIn: number; outAmount: number;
  feasibleMaxIn: number | null; refBps: number | null; settleTimeSec: number;
  executableNow: boolean; honesty: string[];
}
interface PlanResponse {
  ok: boolean; at: string; from: string; to: string; amountIn: number;
  referenceRate: number | null; routes: PlanRoute[];
  split: { parts: Array<{ routeId: string; amountIn: number; outAmount: number }>; outAmount: number; refBps: number | null; note: string } | null;
  markets: { steemBook: string; hiveBook: string; blurtBook: string };
  note: string; error?: string;
}

interface GridStatus {
  status?: string; reason?: string;
  ok?: boolean; mode?: string; configMode?: string; haltReason?: string | null;
  killSwitch?: boolean; ticks?: number; day?: string;
  dailyVolumeUsd?: number; dailyLossUsd?: number; realizedPnlUsd?: number | null;
  fillsCount?: number;
  oppose?: { active: boolean; skew: number | null; mmMode: string | null; note: string };
  centers?: Record<string, { value: number | null; source: string }>;
  caps?: Record<string, number> | null;
}
interface GridDecision { at: string; pair: string; text: string }
interface GridFull extends GridStatus { decisions?: GridDecision[] }

interface ArbPlaybookItem {
  id: string; klass: string; sizeUsd: number; detectorNetBps: number;
  netBpsAfterAgentFees: number; executableLeg: { pair: string; assetIn: string; assetOut: string; howTo: string } | null;
  honesty: string[];
}
interface ArbResponse {
  ok: boolean; playbook: ArbPlaybookItem[];
  internalCycles: Array<{ cycle: string; roundTripBps: number; verdict: string }>;
  caps: { perTxUsd: number; dailyUsd: number; minNotionalUsd: number; feeBps: number };
  markets: string; note: string;
}

interface IgniteResponse {
  ok: boolean; at: string; ready: boolean; reasons: string[];
  ignitionChain: {
    configMode: string; depthUsd: number; thresholdUsd: number;
    autoFlip: string; fuelSources: string[];
    lastDrill: { at: string; verdict: string; fails: string } | null;
  };
  receiveAddresses: { steem: string; hive: string; blurt: string; tron: string; note: string };
}
interface DrillCheck { name: string; pass: boolean; detail: string }
interface DrillResponse { ok: boolean; verdict: string; checks: DrillCheck[] }

function bps(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v > 0 ? "+" : ""}${Math.round(v * 10) / 10}bps`;
}

function fmtNum(v: number | null | undefined, d = 6): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return Number(v).toLocaleString("en-US", { maximumFractionDigits: d });
}

// ── ראוטר-העומק ──────────────────────────────────────────────────────

function PlanPanel() {
  const [from, setFrom] = useState("USDS");
  const [to, setTo] = useState("WSTEEM");
  const [amount, setAmount] = useState("2");
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const run = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`/api/exchange/plan?from=${from}&to=${to}&amountIn=${encodeURIComponent(amount || "0")}`, { cache: "no-store" });
      const j = (await res.json()) as PlanResponse;
      setPlan(j);
    } catch (e) {
      setErr(String((e as Error)?.message ?? e).slice(0, 120));
    } finally {
      setLoading(false);
    }
  }, [from, to, amount]);

  useEffect(() => { void run(); }, []); // ריצה-ראשונה-כנה

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2" dir="ltr">
        <div className="space-y-1">
          <p className="text-[11px] text-muted-foreground">מנכס</p>
          <Select value={from} onValueChange={setFrom}>
            <SelectTrigger className="w-32" aria-label="נכס מקור"><SelectValue /></SelectTrigger>
            <SelectContent className="max-h-72">
              {ASSETS.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <ArrowRightLeft className="mb-2 h-4 w-4 text-muted-foreground" aria-hidden />
        <div className="space-y-1">
          <p className="text-[11px] text-muted-foreground">לנכס</p>
          <Select value={to} onValueChange={setTo}>
            <SelectTrigger className="w-32" aria-label="נכס יעד"><SelectValue /></SelectTrigger>
            <SelectContent className="max-h-72">
              {ASSETS.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <p className="text-[11px] text-muted-foreground">כמות-כניסה</p>
          <Input dir="ltr" className="w-28" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="כמות כניסה" />
        </div>
        <Button size="sm" onClick={() => void run()} disabled={loading} className="mb-0.5">
          {loading ? "מודד…" : "תכנן מסלול"}
        </Button>
      </div>

      {err && <p className="text-xs text-destructive">{err}</p>}
      {plan && !plan.ok && <p className="text-xs text-muted-foreground">{plan.error ?? plan.note ?? "אין מסלול"}</p>}
      {plan?.ok && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
            <Badge variant="outline" className="font-mono">{plan.from}→{plan.to}</Badge>
            <Badge variant="outline" className="font-mono">ייחוס: {fmtNum(plan.referenceRate)}</Badge>
            <Badge variant="outline">ספר-Steem: {plan.markets.steemBook}</Badge>
            <Badge variant="outline">ספר-Hive: {plan.markets.hiveBook}</Badge>
            <Badge variant="outline" className="max-w-72 truncate">Blurt: {plan.markets.blurtBook}</Badge>
          </div>
          {plan.routes.map((r, i) => (
            <Card key={r.id + i} className="bg-muted/30">
              <CardContent className="p-3 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-mono text-xs font-semibold" dir="ltr">{r.id}</p>
                  <Badge variant={r.executableNow ? "default" : "outline"} className="text-[10px]">
                    {r.executableNow ? "בר-ביצוע-עכשיו" : "לא-בר-ביצוע-מלא (עומק)"}
                  </Badge>
                  <Badge variant="outline" className="font-mono text-[10px]">יציאה: {fmtNum(r.outAmount)} {plan.to}</Badge>
                  <Badge variant="outline" className="font-mono text-[10px]">מול-ייחוס: {bps(r.refBps)}</Badge>
                  {r.settleTimeSec > 0 && (
                    <Badge variant="outline" className="text-[10px]">התייצבות ~{Math.round(r.settleTimeSec / 86400)} ימים</Badge>
                  )}
                  {r.feasibleMaxIn != null && (
                    <Badge variant="outline" className="font-mono text-[10px]">עומק-עד: {fmtNum(r.feasibleMaxIn)} {plan.from}</Badge>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-1.5" dir="ltr">
                  {r.legs.map((l, k) => {
                    const m = KIND_META[l.kind] ?? { he: l.kind, cls: "" };
                    return (
                      <span key={k} className="inline-flex items-center gap-1">
                        {k > 0 && <span className="text-muted-foreground">→</span>}
                        <Badge variant="outline" className={`text-[10px] ${m.cls}`} title={l.note}>
                          {m.he} · {l.assetIn}→{l.assetOut} · {fmtNum(l.rate)} · fee {l.feeBps}bps
                        </Badge>
                      </span>
                    );
                  })}
                </div>
                {r.honesty.length > 0 && (
                  <ul className="space-y-0.5 text-[11px] text-muted-foreground">
                    {r.honesty.map((h, k) => <li key={k}>· {h}</li>)}
                  </ul>
                )}
              </CardContent>
            </Card>
          ))}
          {plan.split && (
            <Card className="border-primary/30 bg-primary/5">
              <CardContent className="p-3 space-y-1">
                <div className="flex items-center gap-2">
                  <Split className="h-3.5 w-3.5" aria-hidden />
                  <p className="text-xs font-semibold">פיצול-מים לסכום-גדול — יציאה טובה-יותר: {fmtNum(plan.split.outAmount)} {plan.to} ({bps(plan.split.refBps)})</p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {plan.split.parts.map((p, k) => (
                    <Badge key={k} variant="outline" className="font-mono text-[10px]">{p.routeId}: {fmtNum(p.amountIn, 2)} → {fmtNum(p.outAmount)}</Badge>
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground">{plan.split.note}</p>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

// ── הגריד-המתנגד ─────────────────────────────────────────────────────

function CounterGridPanel() {
  const [grid, setGrid] = useState<GridFull | null>(null);
  const [offline, setOffline] = useState<string | null>(null);
  const ref = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/dex-grid", { cache: "no-store" });
      const j = (await res.json()) as GridFull;
      if ((j as { status?: string }).status === "offline") { setOffline((j as { reason?: string }).reason ?? "לא-חי"); setGrid(null); }
      else { setGrid(j); setOffline(null); }
    } catch (e) { setOffline(String((e as Error)?.message ?? e).slice(0, 100)); }
  }, []);

  useEffect(() => {
    const kick = setTimeout(() => { void load(); }, 0);
    ref.current = setInterval(() => void load(), 60_000);
    return () => { clearTimeout(kick); if (ref.current) clearInterval(ref.current); };
  }, [load]);

  if (offline) {
    return (
      <Card className="bg-muted/30"><CardContent className="p-4">
        <p className="text-xs font-semibold">הגריד-המתנגד (dex-grid :3051)</p>
        <p className="mt-1 text-[11px] text-muted-foreground">לא-חי כנה: {offline}</p>
      </CardContent></Card>
    );
  }
  if (!grid) return <div className="h-24 animate-pulse rounded-lg bg-muted/40" />;
  const modeCls = grid.mode === "live" ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
    : grid.mode === "halted" ? "border-destructive/40 bg-destructive/10 text-destructive"
    : "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400";

  return (
    <div className="grid gap-3 md:grid-cols-3">
      <Card className="bg-muted/30"><CardContent className="p-4 space-y-1.5">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold">מצב-המנוע</p>
          <Badge variant="outline" className={`text-[10px] ${modeCls}`}>{grid.mode === "live" ? "חי" : grid.mode === "halted" ? "עצור-עצמית" : "יבש (DRY)"}</Badge>
        </div>
        {grid.haltReason && <p className="text-[11px] text-muted-foreground">{grid.haltReason}</p>}
        <p className="text-[11px] text-muted-foreground">פעימות: {grid.ticks ?? "—"} · kill-switch: {grid.killSwitch ? "פעיל" : "כבוי"}</p>
        <p className="text-[11px] text-muted-foreground" dir="ltr">
          PnL: {fmtNum(grid.realizedPnlUsd, 4)}$ · יומי: {fmtNum(grid.dailyVolumeUsd, 2)}$ · מילויים: {grid.fillsCount ?? 0}
        </p>
        <p className="text-[11px] text-muted-foreground">קפסות-L4: {grid.caps ? `$${grid.caps.maxTxUsd}/tx · $${grid.caps.maxDailyVolumeUsd}/יום · אובדן $${grid.caps.maxDailyLossUsd}` : "—"}</p>
      </CardContent></Card>
      <Card className="bg-muted/30"><CardContent className="p-4 space-y-1.5">
        <div className="flex items-center gap-1.5">
          <Radar className="h-3.5 w-3.5" aria-hidden />
          <p className="text-xs font-semibold">הטיית-ההתנגדות מול השרשרת</p>
        </div>
        <Badge variant="outline" className={`text-[10px] ${grid.oppose?.active ? "border-teal-500/40 bg-teal-500/10 text-teal-700 dark:text-teal-400" : ""}`}>
          {grid.oppose?.active ? "פעיל" : "רגוע"}
        </Badge>
        <p className="text-[11px] text-muted-foreground">סקיו-ספר-Steem: {grid.oppose?.skew ?? "—"}</p>
        <p className="text-[11px] text-muted-foreground">{grid.oppose?.note}</p>
      </CardContent></Card>
      <Card className="bg-muted/30"><CardContent className="p-4 space-y-1.5">
        <div className="flex items-center gap-1.5">
          <Waypoints className="h-3.5 w-3.5" aria-hidden />
          <p className="text-xs font-semibold">מרכזי-פאריטה חיים</p>
        </div>
        {Object.entries(grid.centers ?? {}).map(([pair, c]) => (
          <p key={pair} className="text-[11px] text-muted-foreground" dir="ltr">
            {pair}: {c.value != null ? fmtNum(c.value) : "—"} <span className="text-[10px]">({c.source})</span>
          </p>
        ))}
      </CardContent></Card>
      {(grid.decisions?.length ?? 0) > 0 && (
        <Card className="bg-muted/30 md:col-span-3"><CardContent className="p-0">
          <p className="p-3 pb-1 text-xs font-semibold">יומן-החלטות אחרונות</p>
          <div className={`px-3 pb-3 space-y-0.5 ${scrollBoxClass} max-h-40`} dir="ltr">
            {(grid.decisions ?? []).slice(0, 12).map((d, k) => (
              <p key={k} className="font-mono text-[10px] text-muted-foreground">{d.at.slice(11, 19)} [{d.pair}] {d.text}</p>
            ))}
          </div>
        </CardContent></Card>
      )}
    </div>
  );
}

// ── שוק-הארביטראז-הרישתי לסוכנים ────────────────────────────────────

function AgentArbPanel() {
  const [arb, setArb] = useState<ArbResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const kick = setTimeout(() => {
      (async () => {
        try {
          const res = await fetch("/api/exchange/agent/arb", { cache: "no-store" });
          setArb((await res.json()) as ArbResponse);
        } catch (e) { setErr(String((e as Error)?.message ?? e).slice(0, 100)); }
      })();
    }, 0);
    return () => clearTimeout(kick);
  }, []);

  return (
    <div className="space-y-2">
      {err && <p className="text-xs text-destructive">{err}</p>}
      {arb && (
        <>
          <div className="flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
            <Badge variant="outline" className="text-[10px]">{arb.markets}</Badge>
            <Badge variant="outline" className="font-mono text-[10px]">עמלת-סוכן {arb.caps.feeBps}bps</Badge>
            <Badge variant="outline" className="font-mono text-[10px]">קפסות: ${arb.caps.perTxUsd}/tx · ${arb.caps.dailyUsd}/יום · מינימום ${arb.caps.minNotionalUsd}</Badge>
          </div>
          {arb.playbook.length === 0 && (
            <p className="text-xs text-muted-foreground">הגלאי לא מצא הזדמנויות עכשיו — כנה (אין-ארביטראז-מדומה). המחזורים-הפנימיים למטה נמדדים חי מהרזרבות.</p>
          )}
          {arb.playbook.map((p) => (
            <Card key={p.id} className="bg-muted/30">
              <CardContent className="p-3 space-y-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Bot className="h-3.5 w-3.5" aria-hidden />
                  <p className="font-mono text-xs font-semibold" dir="ltr">{p.klass}</p>
                  <Badge variant={p.netBpsAfterAgentFees > 0 ? "default" : "outline"} className="text-[10px]">
                    נטו-לסוכן: {bps(p.netBpsAfterAgentFees)}
                  </Badge>
                  <Badge variant="outline" className="font-mono text-[10px]">גלאי: {bps(p.detectorNetBps)} · ${fmtNum(p.sizeUsd, 2)}</Badge>
                  {p.executableLeg && (
                    <Badge variant="outline" className="text-[10px] border-teal-500/40 bg-teal-500/10 text-teal-700 dark:text-teal-400" dir="ltr">
                      רגל-בת-ביצוע: {p.executableLeg.pair}
                    </Badge>
                  )}
                </div>
                <ul className="space-y-0.5 text-[11px] text-muted-foreground">
                  {p.honesty.map((h, k) => <li key={k}>· {h}</li>)}
                </ul>
              </CardContent>
            </Card>
          ))}
          {arb.internalCycles?.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {arb.internalCycles.map((c, k) => (
                <Badge key={k} variant="outline" className="font-mono text-[10px]" title={c.verdict}>
                  {c.cycle}: {bps(c.roundTripBps)}
                </Badge>
              ))}
            </div>
          )}
          <p className="text-[11px] text-muted-foreground">{arb.note}</p>
        </>
      )}
      {!arb && !err && <div className="h-20 animate-pulse rounded-lg bg-muted/40" />}
    </div>
  );
}

// ── כוננות-ההדלקה (r194) ────────────────────────────────────────────

function IgnitePanel() {
  const [ignite, setIgnite] = useState<IgniteResponse | null>(null);
  const [drill, setDrill] = useState<DrillResponse | null>(null);
  const [drilling, setDrilling] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/dex-grid?with=ignite", { cache: "no-store" });
      setIgnite((await res.json()) as IgniteResponse);
    } catch (e) { setErr(String((e as Error)?.message ?? e).slice(0, 100)); }
  }, []);

  useEffect(() => {
    const kick = setTimeout(() => void load(), 0);
    return () => clearTimeout(kick);
  }, [load]);

  const runDrill = useCallback(async () => {
    setDrilling(true);
    setDrill(null);
    try {
      const res = await fetch("/api/dex-grid?with=drill", { cache: "no-store" });
      setDrill((await res.json()) as DrillResponse);
      void load();
    } catch (e) { setErr(String((e as Error)?.message ?? e).slice(0, 100)); }
    finally { setDrilling(false); }
  }, [load]);

  if (err) return <p className="text-xs text-destructive">{err}</p>;
  if (!ignite) return <div className="h-20 animate-pulse rounded-lg bg-muted/40" />;
  const ic = ignite.ignitionChain;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Flame className="h-4 w-4 text-orange-500" aria-hidden />
        <p className="text-xs font-semibold">כוננות-ההדלקה — מחר-הכסף-נוחת, המנוע-מזוין</p>
        <Badge variant="outline" className={`text-[10px] ${ignite.ready ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"}`}>
          {ignite.ready ? "מוכן-להדלקה" : "ממתין-לזריעה"}
        </Badge>
        <Button size="sm" variant="outline" onClick={() => void runDrill()} disabled={drilling} className="h-7 text-[11px]">
          {drilling ? "מריץ-סדרה…" : "סדרת-הדלקה יבשה"}
        </Button>
      </div>
      {ignite.reasons.length > 0 && (
        <ul className="space-y-0.5 text-[11px] text-muted-foreground">
          {ignite.reasons.map((r, k) => <li key={k}>· חוסם: {r}</li>)}
        </ul>
      )}
      <div className="flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
        <Badge variant="outline" className="font-mono text-[10px]">מצב: {ic.configMode}</Badge>
        <Badge variant="outline" className="font-mono text-[10px]">עומק: ${ic.depthUsd} / סף: ${ic.thresholdUsd}</Badge>
        {ic.lastDrill && (
          <Badge variant="outline" className={`text-[10px] ${ic.lastDrill.verdict === "ready" ? "border-emerald-500/40 text-emerald-700 dark:text-emerald-400" : "border-amber-500/40"}`}>
            סדרה-אחרונה: {ic.lastDrill.verdict} ({ic.lastDrill.at.slice(11, 19)})
          </Badge>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground">{ic.autoFlip}</p>
      <div className="flex flex-wrap gap-1.5">
        {ic.fuelSources.map((f, k) => (
          <Badge key={k} variant="outline" className="text-[10px] border-orange-500/30 bg-orange-500/5">דלק: {f}</Badge>
        ))}
      </div>
      <div className="rounded-md border bg-muted/30 p-2.5">
        <p className="text-[11px] font-semibold">כתובות-קבלה — הראוטר מקבל בכל רשת ומחליף דרך הזירה</p>
        <div className="mt-1 flex flex-wrap gap-1.5" dir="ltr">
          {(["steem", "hive", "blurt"] as const).map((c) => (
            <Badge key={c} variant="outline" className="font-mono text-[10px]">{c}: {ignite.receiveAddresses[c]}</Badge>
          ))}
          <Badge variant="outline" className="font-mono text-[10px] max-w-72 truncate" title={ignite.receiveAddresses.tron}>tron: {ignite.receiveAddresses.tron}</Badge>
        </div>
      </div>
      {drill && (
        <Card className="bg-muted/30"><CardContent className="p-3 space-y-1">
          <div className="flex items-center gap-2">
            <Badge variant={drill.verdict === "ready" ? "default" : "destructive"} className="text-[10px]">סדרה: {drill.verdict}</Badge>
            <p className="text-[11px] text-muted-foreground">{drill.checks.filter((c) => c.pass).length}/{drill.checks.length} בדיקות עברו</p>
          </div>
          <div className={`space-y-0.5 ${scrollBoxClass} max-h-44`}>
            {drill.checks.map((c, k) => (
              <p key={k} className={`text-[11px] ${c.pass ? "text-muted-foreground" : "text-destructive"}`}>
                {c.pass ? "✓" : "✗"} {c.name}: {c.detail}
              </p>
            ))}
          </div>
        </CardContent></Card>
      )}
    </div>
  );
}

// ── ה-section המלא ───────────────────────────────────────────────────

export function SovereignDexSection() {
  return (
    <FadeIn className="mt-10">
      <Section
        title="ה-DEX הריבוני — ראוטר-עומק · גריד-מתנגד · ארביטראז-רישתי (r194)"
        description="מתכנן-מסלולים רב-רגלי על כל הנכסים (בריכות + פגי-פדיון-אמת + ספרי-Steem/Hive + תור-ההמרות), הגריד-המתנגד מזוין-וממתין-לדלק (הדלקה-אוטומטית כשהעומק-נוחת), שוק-ארביטראז לסוכנים דרך שער ERC-8004+x402, מניפסט-MCP לסוכני-AI (/api/exchange/mcp), וכוננות-הדלקה חיה. הכול מדידות-חיות בכנות — אין-עומק-מדומה, אין-פדיון-שקר."
        icon={<RouteIcon />}
      >
        <PlanPanel />
        <div className="mt-4">
          <CounterGridPanel />
        </div>
        <div className="mt-4">
          <IgnitePanel />
        </div>
        <div className="mt-4">
          <AgentArbPanel />
        </div>
      </Section>
    </FadeIn>
  );
}
