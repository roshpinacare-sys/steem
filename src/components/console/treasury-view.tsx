"use client";

// ─────────────────────────────────────────────────────────────────────────────
// TreasuryView — money surfaces: live balances (Steem + Hive + HE assets),
// the SAOS book with solvency, and the capital P&L ledger (with add-event).
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";

import { fmtNum, fmtUsd, relTime, useCapital, useOpportunities, type AgentStatus, type BrainResponse, type OpportunityItem } from "./api";
import { useLive } from "./api";

function BalanceTile({ label, value, sub, accent = "text-zinc-100" }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
      <div className="text-[10px] text-zinc-500">{label}</div>
      <div className={`mt-0.5 font-mono text-lg font-bold tabular-nums ${accent}`} dir="ltr">
        {value}
      </div>
      {sub && <div className="text-[10px] text-zinc-600">{sub}</div>}
    </div>
  );
}

function AddEventDialog({
  open,
  onClose,
  onAdded,
}: {
  open: boolean;
  onClose: () => void;
  onAdded: () => void;
}) {
  const { toast } = useToast();
  const [kind, setKind] = useState("reward");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  const submit = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/ops/capital", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, amountUsd: Number(amount), note: note || undefined }),
      });
      const j = (await res.json()) as { ok?: boolean; error?: string };
      if (res.ok && (j.ok ?? true)) {
        toast({ title: "אירוע הון נרשם" });
        onAdded();
        onClose();
      } else {
        toast({ title: "רישום נכשל", description: j.error, variant: "destructive" });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-xl border border-zinc-800 bg-zinc-950 p-4" onClick={(e) => e.stopPropagation()}>
        <div className="text-[13px] font-semibold text-zinc-100">רישום אירוע-הון</div>
        <p className="mt-0.5 text-[11px] text-zinc-500">תיעוד P&L אמיתי — הפקדה, פרס, הוצאה או תוצאת-מחזור.</p>
        <div className="mt-3 space-y-2.5">
          <div className="flex gap-2">
            {(["reward", "deposit", "convert_result", "expense"] as const).map((k) => (
              <button
                key={k}
                onClick={() => setKind(k)}
                className={`rounded-full border px-2.5 py-1 text-[11px] ${kind === k ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300" : "border-zinc-700 text-zinc-400"}`}
              >
                {k === "reward" ? "פרס" : k === "deposit" ? "הפקדה" : k === "convert_result" ? "מחזור" : "הוצאה"}
              </button>
            ))}
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]">סכום ($)</Label>
            <Input value={amount} onChange={(e) => setAmount(e.target.value)} className="h-8 border-zinc-800 bg-zinc-900 font-mono text-[12px]" dir="ltr" inputMode="decimal" />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]">הערה</Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} className="h-8 border-zinc-800 bg-zinc-900 text-[12px]" />
          </div>
          <Button className="w-full bg-emerald-500 text-zinc-950 hover:bg-emerald-400" disabled={busy || !Number.isFinite(Number(amount)) || Number(amount) <= 0} onClick={() => void submit()}>
            {busy ? "רושם…" : "רשום"}
          </Button>
        </div>
      </div>
    </div>
  );
}

const KIND_LABEL: Record<string, string> = {
  reward: "פרס",
  deposit: "הפקדה",
  convert_result: "מחזור",
  expense: "הוצאה",
};

const STATUS_META: Record<string, { label: string; cls: string }> = {
  ready: { label: "מוכן עכשיו", cls: "border-emerald-400/30 bg-emerald-400/5 text-emerald-300" },
  "needs-key": { label: "דורש מפתח", cls: "border-amber-400/30 bg-amber-400/5 text-amber-300" },
  dormant: { label: "רדום", cls: "border-zinc-700 text-zinc-500" },
  watch: { label: "במעקב", cls: "border-teal-400/30 bg-teal-400/5 text-teal-300" },
  info: { label: "מידע", cls: "border-zinc-700 text-zinc-400" },
};

function OpportunityRow({ o }: { o: OpportunityItem }) {
  const st = STATUS_META[o.status] ?? STATUS_META.info;
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12px] font-semibold text-zinc-100">{o.title}</span>
        <Badge variant="outline" className="border-zinc-700 text-[9px] text-zinc-400">{o.chain}</Badge>
        <span className={`rounded-full border px-1.5 py-px text-[9px] ${st.cls}`}>{st.label}</span>
        {o.potentialUsdYear != null && o.potentialUsdYear > 0.5 && (
          <span className="ms-auto font-mono text-[11px] text-emerald-300" dir="ltr">+{fmtUsd(o.potentialUsdYear, 0)}/yr</span>
        )}
      </div>
      <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-400">{o.why}</p>
      <p className="mt-1 text-[10px] leading-relaxed text-zinc-500">
        <span className="text-zinc-400">איך: </span>{o.how}
      </p>
      <p className="mt-1 font-mono text-[9px] text-zinc-600" dir="ltr">{o.facts}</p>
    </div>
  );
}

function OpportunitiesPanel() {
  const opps = useOpportunities();
  const total = (opps?.opportunities ?? [])
    .reduce((s, o) => s + (o.potentialUsdYear ?? 0), 0);
  return (
    <Card className="border-zinc-800 bg-zinc-900/60">
      <CardContent className="p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-semibold text-zinc-100">מנוע הזדמנויות — הזרמת ערך ונזילות</span>
          <span className="text-[10px] text-zinc-500">כל שורה נמדדת חי מהשרשראות, עם דרגת-אמת מפורשת</span>
          {opps && (
            <Badge variant="outline" className="ms-auto border-emerald-400/30 text-[10px] text-emerald-300" dir="ltr">
              Σ {fmtUsd(total, 0)}/yr measured
            </Badge>
          )}
        </div>
        {!opps ? (
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-24 w-full bg-zinc-800/50" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {opps.opportunities.map((o) => (
              <OpportunityRow key={o.id} o={o} />
            ))}
          </div>
        )}
        {opps && (
          <p className="mt-2 text-[10px] text-zinc-600">
            מחירים: STEEM ${fmtNum(opps.prices.steemUsd, 4)} · HIVE ${fmtNum(opps.prices.hiveUsd, 4)} · עודכן {relTime(opps.generatedAt)} · הריביות נקראות חי מ-dgpo של כל שרשרת
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export function TreasuryView({
  status,
  brain,
}: {
  status: AgentStatus | null;
  brain: BrainResponse | null;
}) {
  const live = useLive();
  const capital = useCapital();
  const [addOpen, setAddOpen] = useState(false);

  const bal = live?.balances;
  const empire = status?.empire?.summary;
  const dex = status?.dex;
  const identity = status?.identity;
  const heTop = identity?.heTop ?? [];

  const coverage =
    dex && dex.creditsTotal > 0 ? (dex.issuerLiquidSteem / dex.creditsTotal) * 100 : null;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-base font-bold text-zinc-100">💰 כספים</h1>
        <p className="text-[11px] text-zinc-500">
          כל היתרות נמדדות חי מהשרשראות · האוצר האמיתי = SP/HP (הון-ייצור), לא רק הנזיל
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        {/* Steem + Hive balances */}
        <Card className="border-zinc-800 bg-zinc-900/60">
          <CardContent className="p-4">
            <div className="mb-3 text-[13px] font-semibold text-zinc-100">מאזן דו-שרשרתי</div>
            {bal == null ? (
              <Skeleton className="h-40 w-full bg-zinc-900" />
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <BalanceTile label="STEEM נזיל" value={fmtNum(bal.steem, 3)} />
                <BalanceTile label="SBD" value={fmtNum(bal.sbd, 2)} />
                <BalanceTile label="SP (עצמי)" value={fmtNum(bal.spOwn, 0)} accent="text-violet-300" sub="הון-ייצור: קוראציה + RC" />
                <BalanceTile label="SP אפקטיבי" value={fmtNum(bal.spEffective, 0)} accent="text-violet-300" sub="כולל delegations" />
                <BalanceTile label="HIVE נזיל" value={fmtNum(empire?.totalHive, 3)} />
                <BalanceTile label="HBD" value={fmtNum(empire?.totalHbd, 3)} />
                <BalanceTile label="HP (Hive)" value={fmtNum(empire?.totalHP, 2)} accent="text-violet-300" />
                <BalanceTile label="שווי כולל" value={fmtUsd(bal.totalUsd)} accent="text-amber-300" sub="מדוד חי" />
              </div>
            )}
            {live?.yield && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                <Badge variant="outline" className="border-zinc-700 text-[10px] text-zinc-300">
                  APY אצירה {fmtNum(live.yield.curationApyLow, 1)}–{fmtNum(live.yield.curationApyHigh, 1)}%
                </Badge>
                <Badge variant="outline" className="border-zinc-700 text-[10px] text-zinc-300" dir="ltr">
                  vote ${fmtNum(live.power?.fullVoteValueUsd, 3)} × {fmtNum(live.power?.fullVotesPerDay, 0)}/day
                </Badge>
                {live.yield.claimsReady && (
                  <Badge variant="outline" className="border-emerald-400/30 text-[10px] text-emerald-300">
                    פרסים מוכנים לדרישה
                  </Badge>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* SAOS book */}
        <Card className="border-zinc-800 bg-zinc-900/60">
          <CardContent className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-[13px] font-semibold text-zinc-100">ספר SAOS-1/STEEM</span>
              {dex?.lastAction && (
                <span className="truncate text-[9px] text-zinc-600" dir="ltr">{dex.lastAction}</span>
              )}
            </div>
            {dex == null ? (
              <Skeleton className="h-40 w-full bg-zinc-900" />
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <BalanceTile label="Best Ask (מכירה)" value={fmtNum(dex.bestAsk, 6)} accent="text-teal-300" sub="מהמדף הנעול שלנו" />
                <BalanceTile label="Best Bid (קנייה)" value={fmtNum(dex.bestBid, 6)} accent="text-amber-300" sub="escrow-נעול בשרשרת" />
                <BalanceTile label="אספקה" value={fmtNum(dex.supply, 1)} sub="מנטות genesis+heartbeat" />
                <BalanceTile label="גיבוי (backing)" value={fmtNum(dex.backingSteem, 6)} sub="feed×0.35×0.25 נמדד" />
                <BalanceTile label="קרדיטים" value={fmtNum(dex.creditsTotal, 3)} sub="התחייבות SAOS" />
                <BalanceTile
                  label="כיסוי סולבנטי"
                  value={coverage != null ? `${fmtNum(coverage, 1)}%` : "—"}
                  accent={coverage != null && coverage >= 99.9 ? "text-emerald-400" : "text-amber-400"}
                  sub={`wallet ${fmtNum(dex.issuerLiquidSteem, 3)} STEEM`}
                />
              </div>
            )}
          </CardContent>
        </Card>

        {/* HE assets */}
        <Card className="border-zinc-800 bg-zinc-900/60">
          <CardContent className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-[13px] font-semibold text-zinc-100">נכסי Hive-Engine</span>
              <Badge variant="outline" className="border-teal-400/30 text-[9px] text-teal-300" dir="ltr">
                {fmtNum(identity?.heValueSwapHive, 3)} SWAP.HIVE
              </Badge>
            </div>
            <div className="scrollbar-thin max-h-56 space-y-1 overflow-y-auto pe-1">
              {heTop.map((tk) => (
                <div key={tk.symbol} className="flex items-center justify-between gap-2 rounded-lg border border-zinc-800 bg-zinc-950/60 px-2.5 py-1.5">
                  <span className="font-mono text-[11px] font-medium text-zinc-300" dir="ltr">{tk.symbol}</span>
                  <span className="font-mono text-[11px] text-zinc-500" dir="ltr">{fmtNum(tk.total, 3)}</span>
                </div>
              ))}
              {heTop.length === 0 && <Skeleton className="h-24 w-full bg-zinc-900" />}
            </div>
            <p className="mt-2 text-[10px] leading-relaxed text-zinc-600">
              כולם נסחרים ב-DEX חי שהמפתח שלנו חותם עליו (Active). מכירה מדורגת — דרך הדמון/סקריפטים.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* opportunities — value injection engine */}
      <OpportunitiesPanel />

      {/* capital ledger */}
      <Card className="border-zinc-800 bg-zinc-900/60">
        <CardContent className="p-4">
          <div className="mb-3 flex items-center gap-2">
            <span className="text-[13px] font-semibold text-zinc-100">יומן הון (P&L)</span>
            <span className="text-[10px] text-zinc-500">הפקדות, פרסים, הוצאות ותוצאות-מחזור — הכסף האמיתי</span>
            <Button size="sm" variant="outline" className="ms-auto h-7 border-zinc-700 text-[11px] hover:bg-zinc-800" onClick={() => setAddOpen(true)}>
              + רישום אירוע
            </Button>
          </div>
          {capital && (
            <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
              <BalanceTile label="הפקדות" value={fmtUsd(capital.summary.depositsUsd)} />
              <BalanceTile label="תוצאות-מחזור" value={fmtUsd(capital.summary.resultsUsd)} accent="text-emerald-300" />
              <BalanceTile label="פרסים" value={fmtUsd(capital.summary.rewardsUsd)} accent="text-emerald-300" />
              <BalanceTile label="הוצאות" value={fmtUsd(capital.summary.expensesUsd)} accent="text-rose-300" />
              <BalanceTile label="נטו" value={fmtUsd(capital.summary.netUsd)} accent={capital.summary.netUsd >= 0 ? "text-emerald-400" : "text-rose-400"} sub={`${capital.summary.cycleCount} מחזורים`} />
            </div>
          )}
          <div className="scrollbar-thin max-h-64 space-y-1 overflow-y-auto pe-1">
            {(capital?.events ?? []).map((e) => (
              <div key={e.id} className="flex items-center justify-between gap-2 rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2">
                <div className="min-w-0">
                  <span className="text-[11px] text-zinc-300">{KIND_LABEL[e.kind] ?? e.kind}</span>
                  {e.note && <span className="ms-2 text-[10px] text-zinc-600">{e.note}</span>}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className={`font-mono text-[11px] ${e.kind === "expense" ? "text-rose-300" : "text-emerald-300"}`} dir="ltr">
                    +{fmtUsd(e.amountUsd)}
                  </span>
                  <span className="text-[9px] text-zinc-600">{relTime(e.occurredAt)}</span>
                </div>
              </div>
            ))}
            {capital?.events.length === 0 && (
              <div className="rounded-lg border border-dashed border-zinc-800 px-3 py-6 text-center text-[11px] text-zinc-600">
                אין אירועי-הון עדיין — רשום את הראשון כדי שה-P&L יתחיל להיספר
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {brain?.inference && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-violet-900/50 bg-violet-400/5 px-4 py-2.5 text-[11px]">
          <span className="font-semibold text-violet-300">🧠 סיכום המוח:</span>
          <span className="text-zinc-300">{brain.inference.conclusion}</span>
          <span className="text-zinc-500">
            ({fmtUsd(brain.inference.spOwnUsd, 0)} SP · פעיל {fmtUsd(brain.totals?.activeUsdMonth, 2)}/חודש · פוטנציאל {fmtUsd(brain.totals?.potentialUsdMonth, 2)}/חודש)
          </span>
        </div>
      )}

      <AddEventDialog open={addOpen} onClose={() => setAddOpen(false)} onAdded={() => undefined} />
    </div>
  );
}
