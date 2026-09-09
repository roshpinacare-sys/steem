"use client";

/**
 * 117n — CONTROL · הבקרה
 * overview (התמונה-הגדולה) · fleet (הצי-הריבוני-במלואו)
 */

import { Radio, Server, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { Chip, LiveDot, Micro, Panel, SecHead, Stat, ago, fmtCompact, fmtInt, fmtµ } from "../primitives";
import type { NexusData } from "@/hooks/use-nexus";

function MiniStat({ icon, label, value, sub, tone = "default" }: { icon: React.ReactNode; label: string; value: string; sub: string; tone?: "default" | "emerald" | "violet" | "rose" }) {
  const map = { default: "text-zinc-100", emerald: "text-emerald-300", violet: "text-violet-300", rose: "text-rose-300" } as const;
  return (
    <Panel className="p-3.5 md:p-4">
      <div className="flex items-center gap-2">
        <span className="text-zinc-500">{icon}</span>
        <Micro className="truncate">{label}</Micro>
      </div>
      <div dir="ltr" className={cn("mt-1.5 font-mono text-xl font-bold tabular-nums", map[tone])}>{value}</div>
      <div className="truncate text-[10px] text-zinc-600">{sub}</div>
    </Panel>
  );
}

function Overview({ data }: { data: NexusData }) {
  const d = data;
  const chainsOk = d.deposits.chainsOk;
  const chainsTotal = d.deposits.chainsTotal;
  const lastEv = d.deposits.events[0];
  return (
    <div className="space-y-4">
      <Panel className="overflow-hidden p-4 md:p-6">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4 md:gap-6">
          <div className="col-span-2 md:col-span-1">
            <Micro>SAOS-NET · גובה-הספר</Micro>
            <div dir="ltr" className="font-mono text-3xl font-bold tabular-nums text-emerald-300 md:text-4xl">{fmtInt(d.meta.saosHeight)}</div>
            <div className="mt-1 flex items-center gap-1.5 text-[11px] text-zinc-500">
              <LiveDot ok /> שורש-מקודם h{fmtInt(d.root.height)} · ראש-סייר h{fmtInt(d.book.head)}
            </div>
          </div>
          <Stat label="TRON · בלוק-חי" value={d.tron.alive ? fmtInt(d.tron.height) : "unreachable"} sub={d.tron.alive ? "ריבוי-מארחים · נמדד-עכשיו" : "3-מארחים-לא-מדדו — כנות"} tone={d.tron.alive ? "default" : "amber"} />
          <Stat label="אספקת SAOS" value={fmtInt(d.meta.supply)} sub={"מנפיק · " + d.meta.issuer} tone="violet" />
          <div>
            <Micro>רכבת-הפקדות-חוץ</Micro>
            <div dir="ltr" className="flex items-baseline gap-1 font-mono">
              <span className={cn("text-3xl font-bold tabular-nums md:text-4xl", chainsOk === chainsTotal ? "text-emerald-300" : "text-amber-300")}>{chainsOk}</span>
              <span className="text-lg text-zinc-600">/{chainsTotal}</span>
            </div>
            <div className="mt-1 text-[11px] text-zinc-500">שרשראות-חיות · tick #{fmtInt(d.deposits.tick)}</div>
          </div>
        </div>

        <div className="mt-4 border-t border-zinc-800/70 pt-3">
          <div className="flex items-start gap-2 text-[11px] leading-relaxed text-zinc-500">
            <Radio className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500/70" aria-hidden />
            <p dir="ltr" className="font-mono">{d.meta.lastHeartbeat ? (d.meta.lastHeartbeat.length > 160 ? d.meta.lastHeartbeat.slice(0, 160) + "…" : d.meta.lastHeartbeat) : "heartbeat-pending…"}</p>
          </div>
        </div>
      </Panel>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <MiniStat icon={<Server className="h-4 w-4" />} label="דלתות-ריליי" value={fmtInt(d.relay.open)} sub={`sent ${d.relay.sent} · issued ${d.relay.issued}`} />
        <MiniStat icon={<ShieldCheck className="h-4 w-4" />} label="מגן · חסימות" value={fmtInt(d.shield.stats.blocks || 0)} sub={`${fmtInt(d.shield.stats.checks || 0)} בדיקות`} tone="emerald" />
        <MiniStat icon={<Server className="h-4 w-4" />} label="כספת-המפתחות" value={d.broker.alive ? d.broker.doors + "+12" : "down"} sub={d.broker.alive ? "broker-חי · 8+12-דלתות" : "broker-לא-מגיב — כנות"} tone={d.broker.alive ? "violet" : "rose"} />
        <MiniStat icon={<Server className="h-4 w-4" />} label="גריד-98" value={fmtCompact(d.grid.rounds)} sub={`${fmtInt(d.grid.tradesToday)} עסקאות-היום`} />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <Panel className="p-4 md:p-5">
          <Micro className="mb-2">הפקדה-אחרונה-מחוץ</Micro>
          {lastEv ? (
            <div dir="ltr" className="space-y-1 font-mono text-xs text-zinc-300">
              <div className="flex items-center justify-between gap-2">
                <span className="text-zinc-100">{String(lastEv.chain)} · {String(lastEv.agent)}</span>
                <span className="text-emerald-300">{Number(lastEv.human || 0).toPrecision(4)} {String(lastEv.sym)}</span>
              </div>
              <div className="flex items-center justify-between gap-2 text-[10px] text-zinc-600">
                <span>{String(lastEv.addr || "")}</span>
                <span>{ago(String(lastEv.at))} ago</span>
              </div>
            </div>
          ) : (
            <p className="text-xs text-zinc-600">אין-אירועים — הרכבת-מקשיבה-כנה</p>
          )}
        </Panel>
        <Panel className="p-4 md:p-5">
          <Micro className="mb-2">מנוע-הגריד · עוצמה</Micro>
          <div className="grid grid-cols-3 gap-2">
            <div><div dir="ltr" className="font-mono text-lg font-bold tabular-nums text-zinc-100">{fmtCompact(d.grid.ticks)}</div><div className="text-[10px] text-zinc-600">ticks</div></div>
            <div><div dir="ltr" className="font-mono text-lg font-bold tabular-nums text-zinc-100">{fmtInt(d.grid.txsToday)}</div><div className="text-[10px] text-zinc-600">txs-היום</div></div>
            <div><div dir="ltr" className="font-mono text-lg font-bold tabular-nums text-emerald-300">{fmtµ(d.grid.treasuryPnlTodayµ)}</div><div className="text-[10px] text-zinc-600">PnL-היום SAOS</div></div>
          </div>
        </Panel>
      </div>
    </div>
  );
}

function Fleet({ data }: { data: NexusData }) {
  const ok = data.fleet.services.filter((s) => s.ok).length;
  return (
    <div className="space-y-4">
      <Panel className="p-4 md:p-5">
        <SecHead
          icon={<Server className="h-4 w-4" />}
          title="הצי-הריבוני · מלוא-הפירוט"
          sub={`guardian-loop · השורה-האחרונה של GUARD DONE${data.fleet.at ? " · " + ago(data.fleet.at) + " ago" : ""}`}
          extra={<Chip ok={ok === data.fleet.services.length}>{ok}/{data.fleet.services.length} ALL</Chip>}
        />
        <div className="grid gap-1.5 sm:grid-cols-2">
          {data.fleet.services.map((s) => (
            <div key={s.name} className={cn("flex items-center justify-between gap-2 rounded-md border px-3 py-2", s.ok ? "border-emerald-500/20 bg-emerald-500/5" : "border-rose-500/30 bg-rose-500/10")} dir="ltr">
              <span className="flex items-center gap-2 font-mono text-xs text-zinc-300">
                <LiveDot ok={s.ok} />
                {s.name}
              </span>
              <Chip ok={s.ok}>{s.ok ? "ALIVE" : "FAIL"}</Chip>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[10px] leading-relaxed text-zinc-600">
          המקור: agent/guardian.log — הפרסור-הכן-של-השורה-האחרונה. אין-קישוט: מה-שהשומר-אומר-זה-מה-שמוצג.
        </p>
      </Panel>
    </div>
  );
}

export function ControlSec({ data, sub }: { data: NexusData; sub: string }) {
  if (sub === "fleet") return <Fleet data={data} />;
  return <Overview data={data} />;
}
