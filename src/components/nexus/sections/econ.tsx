"use client";

/**
 * 117n — ECON · כלכלת-הרשת
 * pools (בריכת-בסיס+13-צולבות) · wrapped (כיסוי-1:1) · grid (מנוע-הגריד) · harvest (הקציר)
 */

import { Activity, Boxes, Coins, Layers, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { Bar, Chip, Panel, SecHead, Stat, fmtCompact, fmtInt, fmtµ } from "../primitives";
import type { NexusData } from "@/hooks/use-nexus";

function Pools({ data }: { data: NexusData }) {
  const p = data.pools;
  return (
    <div className="space-y-4">
      <Panel className="p-4 md:p-5">
        <SecHead icon={<Coins className="h-4 w-4" />} title="בריכת-הבסיס WTRX/SAOS" sub={`feeBps ${p.poolW.feeBps} · LP ${fmtCompact(p.poolW.lp)}`} extra={<Chip tone="emerald">AMM-LIVE</Chip>} />
        <div className="grid grid-cols-3 gap-4">
          <Stat label="צד SAOS" value={fmtµ(p.poolW.saos * 1_000_000)} />
          <Stat label="צד WTRX" value={fmtµ(p.poolW.wtrx * 1_000_000)} tone="violet" />
          <Stat label="מחיר-בריכה" value={p.poolW.saos && p.poolW.wtrx ? (p.poolW.wtrx / p.poolW.saos).toFixed(3) : "—"} sub="TRX לכל SAOS" tone="emerald" />
        </div>
      </Panel>
      <Panel className="p-4 md:p-5">
        <SecHead icon={<Layers className="h-4 w-4" />} title={`${p.poolsX.length}-בריכות-צולבות`} sub="שוק-פנימי-ריבוני · עמלות-נזרעות-לLP" />
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-2 nexus-scroll-x">
          {p.poolsX.map((x) => (
            <div key={x.pair} className="w-40 shrink-0 rounded-md border border-zinc-800/70 bg-zinc-900/40 p-3" dir="ltr">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs font-bold text-zinc-100">{x.pair}</span>
                <span className="font-mono text-[9px] text-zinc-600">{x.feeBps}bps</span>
              </div>
              <div className="mt-1.5 space-y-0.5 font-mono text-[10px] text-zinc-500">
                <div className="flex justify-between"><span>{x.symA}</span><span className="tabular-nums text-zinc-300">{fmtCompact(x.a)}</span></div>
                <div className="flex justify-between"><span>{x.symB}</span><span className="tabular-nums text-zinc-300">{fmtCompact(x.b)}</span></div>
                <div className="flex justify-between"><span>LP</span><span className="tabular-nums">{fmtCompact(x.lp)}</span></div>
              </div>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

function Wrapped({ data }: { data: NexusData }) {
  return (
    <Panel className="p-4 md:p-5">
      <SecHead icon={<Boxes className="h-4 w-4" />} title="נכסים-עטופים · כיסוי-1:1" sub={`סה"כ ${data.wrapped.length} סמלים · נעול-מול-מסופק`} />
      <div className="max-h-[520px] overflow-y-auto pr-1 nexus-scroll">
        <table className="w-full text-xs" dir="ltr">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-600">
              <th className="pb-2 font-medium">sym</th>
              <th className="pb-2 text-right font-medium">supply</th>
              <th className="pb-2 text-right font-medium">locked</th>
              <th className="pb-2 text-right font-medium">unlocked</th>
              <th className="pb-2 text-right font-medium">refs</th>
            </tr>
          </thead>
          <tbody className="font-mono tabular-nums">
            {data.wrapped.map((w) => {
              const healthy = w.locked >= w.supply;
              return (
                <tr key={w.sym} className="border-t border-zinc-800/60">
                  <td className="py-1.5 font-bold text-zinc-200">{w.sym}</td>
                  <td className="py-1.5 text-right text-zinc-300">{fmtInt(w.supply)}</td>
                  <td className={cn("py-1.5 text-right", healthy ? "text-emerald-300/80" : "text-amber-300")}>{fmtInt(w.locked)}</td>
                  <td className="py-1.5 text-right text-zinc-600">{fmtInt(w.unlocked)}</td>
                  <td className="py-1.5 text-right text-zinc-600">{w.refs}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function Grid({ data }: { data: NexusData }) {
  const g = data.grid;
  const maxPnl = Math.max(1, ...g.leaderboard.map((l) => Math.abs(l.pnlµ)));
  return (
    <div className="space-y-4">
      <Panel className="p-4 md:p-5">
        <SecHead icon={<TrendingUp className="h-4 w-4" />} title="מנוע-הגריד · רווחיות" sub={`rounds ${fmtCompact(g.rounds)} · ${fmtInt(g.tradesToday)} עסקאות-היום · ${fmtInt(g.txsToday)} txs`} extra={<Chip tone="emerald">GRID-98</Chip>} />
        <div className="grid grid-cols-2 gap-4">
          <Stat label="PnL-קופה-מצטבר" value={fmtµ(g.treasuryPnlµ) + " SAOS"} tone="emerald" />
          <Stat label="PnL-היום" value={fmtµ(g.treasuryPnlTodayµ)} />
        </div>
        <div className="mt-4 space-y-1.5">
          <div className="text-[10px] uppercase tracking-wider text-zinc-600">leaderboard · pnlµ</div>
          {g.leaderboard.map((l) => (
            <div key={l.name} className="flex items-center gap-2">
              <span dir="ltr" className="w-16 font-mono text-[10px] text-zinc-500">{l.name}</span>
              <div className="flex-1"><Bar pct={(Math.abs(l.pnlµ) / maxPnl) * 100} tone={l.pnlµ >= 0 ? "emerald" : "rose"} /></div>
              <span dir="ltr" className={cn("w-20 text-left font-mono text-[10px] tabular-nums", l.pnlµ >= 0 ? "text-emerald-300/90" : "text-rose-300/90")}>{fmtµ(l.pnlµ)}</span>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

function Harvest({ data }: { data: NexusData }) {
  const h = data.harvest;
  const f = data.fees;
  return (
    <Panel className="p-4 md:p-5">
      <SecHead icon={<Activity className="h-4 w-4" />} title="THE-HARVEST · כלכלה-פנימית" sub="עמלות-הרשת-מזינות-את-הרשת · flywheel" extra={<Chip tone="emerald">HARVEST-ALIVE</Chip>} />
      <div className="grid grid-cols-3 gap-3">
        <Stat label="עמלות-מצטבר" value={fmtµ(h.feesTotalµ + (h.gridFeeµ || 0))} tone="emerald" />
        <Stat label="שחרורים" value={fmtInt(h.releases)} />
        <Stat label="רכבת-זוכה" value={fmtInt(h.railCredited)} tone="violet" />
      </div>
      <div className="mt-3 flex items-center gap-2 border-t border-zinc-800/70 pt-3 text-[10px] text-zinc-600">
        <span dir="ltr" className="font-mono">fees→LP {f.toLp ?? 0}µ · treasury {f.toTreasury ?? 0}µ · total {fmtInt(f.total || 0)}µ</span>
      </div>
    </Panel>
  );
}

export function EconSec({ data, sub }: { data: NexusData; sub: string }) {
  if (sub === "wrapped") return <Wrapped data={data} />;
  if (sub === "grid") return <Grid data={data} />;
  if (sub === "harvest") return <Harvest data={data} />;
  return <Pools data={data} />;
}
