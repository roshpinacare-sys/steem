"use client";

/**
 * 117n — DOORS · הדלתות-החיות
 * vault (20-דלתות-עם-יתרות-TRON-חיות-מהרשת!) · relay (זרם-הריליי) · ops (תפעול-השולחים-והכשלים)
 */

import { useState } from "react";
import { Copy, DoorOpen, KeyRound, Radio, Route, Zap } from "lucide-react";
import { useLive } from "@/hooks/use-live";
import { cn } from "@/lib/utils";
import { Chip, Micro, Panel, SecHead, Stat, ago, fmtInt, mask } from "../primitives";
import type { NexusData } from "@/hooks/use-nexus";

type DoorRec = { id: string; family: string; address: string; path?: string; balSun: number | null; balTrx: number | null };
type DoorsResp = { ok: boolean; brokerAlive: boolean; brokerDoors: number; registryDoors: number; doors: DoorRec[]; measured: number; totalTrx: number; at: string };

/* ── vault — הכספת עם יתרות חיות ── */
function Vault() {
  const live = useLive<DoorsResp>("/api/doors", 12_000);
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (a: string) => {
    try {
      await navigator.clipboard.writeText(a);
      setCopied(a);
      setTimeout(() => setCopied(null), 1200);
    } catch { /* clipboard-חסום — שקט-כן */ }
  };
  const d = live.data;
  const doors = d?.doors || [];

  return (
    <div className="space-y-4">
      <Panel className="p-4 md:p-5">
        <SecHead
          icon={<DoorOpen className="h-4 w-4" />}
          title="כספת-הזהויות · יתרות-חיות-מהרשת"
          sub="8-דלתות-ברוקר + 12-דלתות-רישום · יתרות-נמדדו-עכשיו-מול-TRON-ריבוי-מארחים"
          extra={<Chip ok={!!d?.brokerAlive}>{d?.brokerAlive ? "BROKER-ALIVE" : "BROKER-DOWN"}</Chip>}
        />
        <div className="mb-4 grid grid-cols-3 gap-4 border-b border-zinc-800/70 pb-4">
          <Stat label="סך-TRX-בדלתות" value={d ? d.totalTrx.toFixed(4) : "—"} tone="violet" sub={d ? `${d.measured}/${doors.length} נמדדו` : ""} />
          <Stat label="דלתות-ברוקר" value={fmtInt(d?.brokerDoors || 0)} sub="hierarchy-מוגנת" />
          <Stat label="דלתות-רישום" value={fmtInt(d?.registryDoors || 0)} sub="TG6Srs=הפקדות-רשמי" tone="emerald" />
        </div>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {doors.map((dr) => (
            <button key={dr.address} onClick={() => copy(dr.address)} className="group flex items-center justify-between gap-2 rounded-md border border-zinc-800/70 bg-zinc-900/40 px-3 py-2 text-right transition-colors hover:border-violet-500/40" dir="ltr" title={dr.address}>
              <span className="min-w-0">
                <span className="flex items-center gap-1.5">
                  <Chip tone={dr.family === "sov" ? "violet" : "emerald"}>{dr.id}</Chip>
                  {dr.path && dr.family === "registry" && <span className="font-mono text-[9px] text-zinc-600">{dr.path}</span>}
                </span>
                <span className="mt-0.5 block truncate font-mono text-xs text-zinc-300">{mask(dr.address, 12, 8)}</span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <span className={cn("font-mono text-xs tabular-nums", (dr.balTrx || 0) > 0 ? "text-emerald-300" : "text-zinc-600")}>
                  {dr.balTrx === null ? "—" : dr.balTrx.toFixed(4) + " TRX"}
                </span>
                <Copy className={cn("h-3.5 w-3.5", copied === dr.address ? "text-violet-400" : "text-zinc-600 group-hover:text-zinc-400")} aria-hidden />
              </span>
            </button>
          ))}
          {doors.length === 0 && !live.loading && (
            <p className="col-span-2 py-6 text-center text-xs text-zinc-600">אין-דלתות — כנות: ברוקר-ורישום-לא-מגיבים</p>
          )}
        </div>
        <p className="mt-2 text-[10px] text-zinc-600">אפס-מפתחות-בתצוגה: הכספת-מחזיקה-כתובות-ציבוריות-בלבד · לחיצה=העתקה</p>
      </Panel>
    </div>
  );
}

/* ── relay — זרם-הריליי ── */
function Relay({ data }: { data: NexusData }) {
  return (
    <Panel className="p-4 md:p-5">
      <SecHead icon={<Zap className="h-4 w-4" />} title="זרם-הריליי (דבר-גורר-דבר)" sub={`sent ${data.relay.sent} · issued ${data.relay.issued} · פתוחים ${data.relay.open}`} />
      <div className="max-h-96 space-y-2 overflow-y-auto pr-1 nexus-scroll">
        {data.relay.openList.length === 0 && <p className="py-6 text-center text-xs text-zinc-600">אין-דלתות-פתוחות — הזרם-נקי</p>}
        {data.relay.openList.map((r) => (
          <div key={r.ref} className="flex items-center justify-between gap-2 rounded-md border border-zinc-800/70 bg-zinc-900/40 px-3 py-2" dir="ltr">
            <div className="flex min-w-0 items-center gap-2 font-mono text-xs">
              <Chip tone={r.via === "tron" ? "violet" : r.via === "steem" ? "emerald" : "zinc"}>{r.via}</Chip>
              <span className="truncate text-zinc-300">{r.ref}</span>
            </div>
            <div className="flex shrink-0 items-center gap-2 font-mono text-[10px]">
              <span className="text-zinc-500">{r.act}</span>
              <Chip ok={r.status === "queued" ? undefined : true}>{r.status}</Chip>
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

/* ── ops — תפעול-השולחים ── */
function Ops({ data }: { data: NexusData }) {
  const pick = data.relayOps.lastPick || {};
  const bal = typeof pick.bal === "number" ? pick.bal / 1_000_000 : null;
  return (
    <div className="space-y-4">
      <Panel className="p-4 md:p-5">
        <SecHead icon={<Route className="h-4 w-4" />} title="תפעול-השולחים · בחירת-שולח-חכמה" sub="relay-senders.json · המנוע-בוחר-שולח-לפי-יתרה-ובריאות" extra={<Chip ok={!data.relayOps.degraded}>{data.relayOps.degraded ? "DEGRADED" : "HEALTHY"}</Chip>} />
        <div className="grid gap-3 md:grid-cols-3">
          <Stat label="כשלי-ריליי-רשומים" value={fmtInt(data.relayOps.failsCount)} tone={data.relayOps.failsCount ? "amber" : "emerald"} sub="relay-fails.json" />
          <Stat label="שולח-אחרון-נבחר" value={pick.family ? String(pick.family) : "—"} sub={pick.address ? mask(String(pick.address), 10, 6) : "טרם-נבחר"} tone="violet" />
          <Stat label="יתרת-השולח" value={bal === null ? "—" : bal.toFixed(4) + " TRX"} sub="מדידה-אחרונה" tone="emerald" />
        </div>
      </Panel>
      <Panel className="p-4 md:p-5">
        <SecHead icon={<Radio className="h-4 w-4" />} title="אנטומיה-של-בחירה" sub="המדינה-האחרונה-המלאה של החלטת-השולח" />
        <pre dir="ltr" className="max-h-64 overflow-auto rounded-md border border-zinc-800/70 bg-zinc-950/80 p-3 font-mono text-[10px] leading-relaxed text-zinc-400 nexus-scroll">
{JSON.stringify(data.relayOps.lastPick || {}, null, 2)}
        </pre>
      </Panel>
    </div>
  );
}

export function DoorsSec({ data, sub }: { data: NexusData; sub: string }) {
  if (sub === "relay") return <Relay data={data} />;
  if (sub === "ops") return <Ops data={data} />;
  return <Vault />;
}
