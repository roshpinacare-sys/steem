"use client";

/**
 * 117n — DEPOSITS · רכבת-ההפקדות
 * chains (בריאות-10-השרשראות) · events (הזנת-האירועים-המלאה)
 */

import { motion } from "framer-motion";
import { ArrowDownToLine, CheckCircle2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Bar, Chip, Micro, Panel, SecHead, Stat, ago, fmtInt } from "../primitives";
import type { NexusData } from "@/hooks/use-nexus";

function Chains({ data }: { data: NexusData }) {
  const d = data.deposits;
  const pct = d.chainsTotal ? (d.chainsOk / d.chainsTotal) * 100 : 0;
  return (
    <Panel className="p-4 md:p-5">
      <SecHead icon={<ArrowDownToLine className="h-4 w-4" />} title="רכבת-ההפקדות-הרב-שרשרתית" sub={`tick #${fmtInt(d.tick)} · ${ago(d.lastTickAt)} ago · מצבר-אירועים ${fmtInt(d.eventsCount)}`} extra={<Chip ok={d.chainsOk === d.chainsTotal}>{d.chainsOk}/{d.chainsTotal}</Chip>} />
      <div className="mb-1 flex items-center justify-between text-[11px] text-zinc-500">
        <span>בריאות-צמתים-חי</span>
        <span dir="ltr" className="font-mono">{d.chainsOk === d.chainsTotal ? "10/10-ALL-OK" : d.chainsOk + "/" + d.chainsTotal}</span>
      </div>
      <Bar pct={pct} tone={pct === 100 ? "emerald" : "amber"} />
      <div className="mt-4 grid grid-cols-5 gap-1.5 sm:grid-cols-10">
        {d.rpcHealth.map((c) => (
          <div key={c.chain} className={cn("flex flex-col items-center gap-1 rounded-md border px-1 py-2", c.ok ? "border-emerald-500/25 bg-emerald-500/5" : "border-rose-500/30 bg-rose-500/10")} title={c.chain + (c.ok ? " · ok" : " · fail") + " · " + ago(c.at)}>
            {c.ok ? <CheckCircle2 className="h-4 w-4 text-emerald-400" aria-hidden /> : <XCircle className="h-4 w-4 text-rose-400" aria-hidden />}
            <span dir="ltr" className="w-full truncate text-center font-mono text-[9px] text-zinc-400">{c.chain}</span>
          </div>
        ))}
      </div>
      <div className="mt-4 grid grid-cols-3 gap-3 border-t border-zinc-800/70 pt-3">
        <Stat label="הוטבעו-לספר" value={fmtInt(d.minted)} tone="emerald" />
        <Stat label="אירועי-הפקדה" value={fmtInt(d.eventsCount)} />
        <Stat label="צינור-עובד" value={d.minted > 0 ? "PROVEN" : "armed"} tone={d.minted > 0 ? "emerald" : "default"} />
      </div>
    </Panel>
  );
}

function Events({ data }: { data: NexusData }) {
  const d = data.deposits;
  return (
    <Panel className="p-4 md:p-5">
      <Micro className="mb-3">הזנת-אירועים-חיה ({d.events.length}-אחרונים-במצבר)</Micro>
      <div className="max-h-[520px] space-y-2 overflow-y-auto pr-1 nexus-scroll">
        {d.events.length === 0 && <p className="py-6 text-center text-xs text-zinc-600">ריק-בכנות — אף-הפקדה-טרם-זוהתה</p>}
        {d.events.map((e, i) => (
          <motion.div key={String(e.at || i) + i} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }} className="flex items-center justify-between gap-2 rounded-md border border-zinc-800/70 bg-zinc-900/40 px-3 py-2" dir="ltr">
            <div className="flex min-w-0 items-center gap-2 font-mono text-xs">
              <Chip>{String(e.chain)}</Chip>
              <span className="truncate text-zinc-300">{String(e.agent)}</span>
              <span className="hidden text-zinc-600 sm:inline">{String(e.addr || "")}</span>
            </div>
            <div className="flex shrink-0 items-center gap-2 font-mono text-xs">
              <span className="text-emerald-300 tabular-nums">{Number(e.human || 0).toPrecision(4)}</span>
              <span className="text-zinc-500">{String(e.sym)}</span>
              <span className="hidden w-10 text-right text-[10px] text-zinc-600 sm:inline">{ago(String(e.at))}</span>
            </div>
          </motion.div>
        ))}
      </div>
    </Panel>
  );
}

export function DepositsSec({ data, sub }: { data: NexusData; sub: string }) {
  if (sub === "events") return <Events data={data} />;
  return <Chains data={data} />;
}
