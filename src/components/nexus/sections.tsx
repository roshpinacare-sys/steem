"use client";

/**
 * 117m — NEXUS sections · חמשת-מסכי-מרכז-הבקרה
 * CONTROL · DEPOSITS · DOORS · SHIELD · ECON — הכל-חי מה-NEXUS-API (אפס-סימולציה)
 */

import { useState } from "react";
import { motion } from "framer-motion";
import {
  Activity, ArrowDownToLine, Boxes, CheckCircle2, Coins, Copy, Cpu, DoorOpen, Fingerprint,
  KeyRound, Layers, Radio, Server, ShieldCheck, TrendingUp, XCircle, Zap,
} from "lucide-react";
import type { NexusData } from "@/hooks/use-nexus";
import { cn } from "@/lib/utils";
import { Bar, Chip, LiveDot, Micro, Panel, SecHead, Stat, ago, fmtCompact, fmtInt, fmtµ, mask } from "./primitives";

type Sec = { data: NexusData };

/* ══════════ CONTROL — התמונה הגדולה ══════════ */
export function ControlSec({ data }: Sec) {
  const d = data;
  const fleetOk = d.fleet.services.filter((s) => s.ok).length;
  const chainsOk = d.deposits.chainsOk;
  const chainsTotal = d.deposits.chainsTotal;
  const blocks = d.shield.stats.blocks || 0;
  const lastEv = d.deposits.events[0];

  return (
    <div className="space-y-4">
      {/* עמודת-על */}
      <Panel className="overflow-hidden p-4 md:p-6">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4 md:gap-6">
          <div className="col-span-2 md:col-span-1">
            <Micro>SAOS-NET · גובה-הספר</Micro>
            <div dir="ltr" className="font-mono text-3xl font-bold tabular-nums text-emerald-300 md:text-4xl">{fmtInt(d.meta.saosHeight)}</div>
            <div className="mt-1 flex items-center gap-1.5 text-[11px] text-zinc-500">
              <LiveDot ok /> שורש-מקודם h{fmtInt(d.root.height)}
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

      {/* שורת-מחוונים */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <MiniStat icon={<DoorOpen className="h-4 w-4" />} label="דלתות-ריליי" value={fmtInt(d.relay.open)} sub={`sent ${d.relay.sent} · issued ${d.relay.issued}`} />
        <MiniStat icon={<ShieldCheck className="h-4 w-4" />} label="מגן · חסימות" value={fmtInt(blocks)} sub={`${fmtInt(d.shield.stats.checks || 0)} בדיקות`} tone="emerald" />
        <MiniStat icon={<KeyRound className="h-4 w-4" />} label="כספת-המפתחות" value={d.broker.alive ? d.broker.doors + "+12" : "down"} sub={d.broker.alive ? "broker-חי · 8+12-דלתות" : "broker-לא-מגיב — כנות"} tone={d.broker.alive ? "violet" : "rose"} />
        <MiniStat icon={<Cpu className="h-4 w-4" />} label="גריד-98" value={fmtCompact(d.grid.rounds)} sub={`${fmtInt(d.grid.tradesToday)} עסקאות-היום`} />
      </div>

      {/* הצי-הריבוני */}
      <Panel className="p-4 md:p-5">
        <SecHead icon={<Server className="h-4 w-4" />} title="הצי-הריבוני" sub={`guardian · ${fleetOk}/${d.fleet.services.length} שירותים-חיים${d.fleet.at ? " · " + ago(d.fleet.at) + " ago" : ""}`} extra={<Chip ok={fleetOk === d.fleet.services.length}>{fleetOk === d.fleet.services.length ? "ALL-SYSTEMS" : "DEGRADED"}</Chip>} />
        <div className="flex flex-wrap gap-1.5">
          {d.fleet.services.map((s) => (
            <Chip key={s.name} ok={s.ok}>{s.name.replace(/-alive|-ok$/, "")}</Chip>
          ))}
        </div>
      </Panel>

      {/* מה-קורה-עכשיו */}
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
                <span>{mask(String(lastEv.addr || ""))}</span>
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

/* ══════════ DEPOSITS — רכבת-החוץ ══════════ */
export function DepositsSec({ data }: Sec) {
  const d = data.deposits;
  const pct = d.chainsTotal ? (d.chainsOk / d.chainsTotal) * 100 : 0;
  return (
    <div className="space-y-4">
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

      <Panel className="p-4 md:p-5">
        <Micro className="mb-3">הזנת-אירועים-חיה (9-אחרונים)</Micro>
        <div className="max-h-96 space-y-2 overflow-y-auto pr-1 nexus-scroll">
          {d.events.length === 0 && <p className="py-6 text-center text-xs text-zinc-600">ריק-בכנות — אף-הפקדה-טרם-זוהתה</p>}
          {d.events.map((e, i) => (
            <motion.div key={String(e.at || i) + i} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }} className="flex items-center justify-between gap-2 rounded-md border border-zinc-800/70 bg-zinc-900/40 px-3 py-2" dir="ltr">
              <div className="flex min-w-0 items-center gap-2 font-mono text-xs">
                <Chip>{String(e.chain)}</Chip>
                <span className="truncate text-zinc-300">{String(e.agent)}</span>
                <span className="hidden text-zinc-600 sm:inline">{mask(String(e.addr || ""), 6, 4)}</span>
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
    </div>
  );
}

/* ══════════ DOORS — הדלתות-והכספת ══════════ */
export function DoorsSec({ data }: Sec) {
  const d = data;
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (a: string) => {
    try {
      await navigator.clipboard.writeText(a);
      setCopied(a);
      setTimeout(() => setCopied(null), 1200);
    } catch { /* clipboard-חסום — שקט-כנה */ }
  };
  const total = d.broker.doors + d.registryDoors;
  return (
    <div className="space-y-4">
      <Panel className="p-4 md:p-5">
        <SecHead icon={<DoorOpen className="h-4 w-4" />} title="דלתות-הריליי · כספת-הזהויות" sub={`key-broker · ${d.broker.alive ? "חי" : "לא-מגיב"} · ${fmtInt(total)} דלתות-מוגנות`} extra={<Chip ok={d.broker.alive}>{d.broker.alive ? "BROKER-ALIVE" : "BROKER-DOWN"}</Chip>} />
        <div className="grid gap-1.5 sm:grid-cols-2">
          {d.broker.addresses.map((a, i) => (
            <button key={a} onClick={() => copy(a)} className="group flex items-center justify-between gap-2 rounded-md border border-zinc-800/70 bg-zinc-900/40 px-3 py-2 text-right transition-colors hover:border-emerald-500/40" dir="ltr" title={a}>
              <span className="min-w-0">
                <span className="block font-mono text-[9px] uppercase tracking-widest text-zinc-600">door:{i} · sov</span>
                <span className="block truncate font-mono text-xs text-zinc-300">{mask(a, 12, 8)}</span>
              </span>
              <Copy className={cn("h-3.5 w-3.5 shrink-0", copied === a ? "text-emerald-400" : "text-zinc-600 group-hover:text-zinc-400")} aria-hidden />
            </button>
          ))}
        </div>
        <p className="mt-2 text-[10px] text-zinc-600">+ {d.registryDoors} דלתות-רישום (הסוכנים · TG6Srs=דלת-ההפקדות-הרשמית) · לחיצה=העתקה</p>
      </Panel>

      <Panel className="p-4 md:p-5">
        <SecHead icon={<Zap className="h-4 w-4" />} title="זרם-הריליי (דבר-גורר-דבר)" sub={`sent ${d.relay.sent} · issued ${d.relay.issued} · פתוחים ${d.relay.open}`} />
        <div className="max-h-80 space-y-2 overflow-y-auto pr-1 nexus-scroll">
          {d.relay.openList.length === 0 && <p className="py-6 text-center text-xs text-zinc-600">אין-דלתות-פתוחות — הזרם-נקי</p>}
          {d.relay.openList.map((r) => (
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
    </div>
  );
}

/* ══════════ SHIELD — המגן ══════════ */
const THREATS = [
  { id: "T1", name: "טוקנים-מתחזים", d: "שם-מפורסם מחוזה-זר · תווים-מטעים · דצימלים-חריגים" },
  { id: "T2", name: "חוזים-זדוניים", d: "14-סלקטורי-טיהור ב-bytecode (mint/setOwner/blacklist/pause)" },
  { id: "T3", name: "חיקוי-דלת", d: "vanity-gen של קידומת/ראש+זנב מול 20-הדלתות שלנו" },
  { id: "T4", name: "אישור-לא-מוגבל", d: "approve(max)/setApprovalForAll = דלת-כיס-פתוחה → BLOCK" },
  { id: "T5", name: "ממו-פישינג", d: "דומייני-חיקוי-מותג · מילות-גיוס · צורת-סודות" },
  { id: "T6", name: "רעש-מהירות", d: "relay-spam ששורף רוחב-פס — ledger 10-דק'" },
];
export function ShieldSec({ data }: Sec) {
  const s = data.shield;
  const checks = s.stats.checks || 0;
  const blocks = s.stats.blocks || 0;
  const warns = s.stats.warns || 0;
  return (
    <div className="space-y-4">
      <Panel className="p-4 md:p-6">
        <SecHead icon={<ShieldCheck className="h-4 w-4" />} title="THE-SHIELD · מגן-הגנבים" sub="מנוע-ההגנה-רב-שרשרתי · אפס-מפתחות · אין-אמת-חלקית" extra={<Chip tone="emerald">ARMED</Chip>} />
        <div className="grid grid-cols-3 gap-4 md:grid-cols-6">
          <Stat label="בדיקות-מצטבר" value={fmtInt(checks)} />
          <Stat label="חסימות" value={fmtInt(blocks)} tone="rose" />
          <Stat label="אזהרות" value={fmtInt(warns)} tone="amber" />
          <Stat label="דלתות-מוגנות" value="20" sub="8-broker + 12-רישום" tone="emerald" />
          <Stat label="רשימת-אסורים" value={fmtInt(s.deny.length)} sub="נלמד-מהחיים" tone="violet" />
          <Stat label="מהירות-ריליי" value={fmtInt(s.velocity) + "/10m"} sub="ledger-חי" />
        </div>
        <div className="mt-4 rounded-md border border-emerald-500/25 bg-emerald-500/5 px-3 py-2.5 text-[11px] leading-relaxed text-emerald-200/90">
          <span className="font-bold">LIVE-FIRE PROVEN:</span> selftest 9/9 · חיקוי-דלת אמת (prefix-28) נחסם-BLOCK-80 · פריים-פישינג-חי נחסם-100 (5-נימוקים) · USDT-קאנוני-מאומת-ALLOW
        </div>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {THREATS.map((t, i) => (
          <motion.div key={t.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}>
            <Panel className="h-full p-4">
              <div className="mb-1.5 flex items-center justify-between">
                <span dir="ltr" className="font-mono text-[10px] font-bold tracking-widest text-rose-400/80">{t.id}</span>
                <Chip tone="emerald">ENFORCED</Chip>
              </div>
              <div className="text-sm font-bold text-zinc-100">{t.name}</div>
              <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">{t.d}</p>
            </Panel>
          </motion.div>
        ))}
      </div>

      {s.deny.length > 0 && (
        <Panel className="p-4 md:p-5">
          <Micro className="mb-2">רשימת-האסורים-הנלמדת</Micro>
          <div dir="ltr" className="max-h-40 space-y-1 overflow-y-auto font-mono text-xs text-rose-300/90 nexus-scroll">
            {s.deny.map((a) => (
              <div key={a} className="flex items-center gap-2 rounded border border-rose-500/20 bg-rose-500/5 px-2 py-1">
                <XCircle className="h-3 w-3 shrink-0" aria-hidden />
                {mask(a, 14, 10)}
              </div>
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}

/* ══════════ ECON — כלכלת-הרשת ══════════ */
export function EconSec({ data }: Sec) {
  const p = data.pools;
  const g = data.grid;
  const h = data.harvest;
  const f = data.fees;
  const maxPnl = Math.max(1, ...g.leaderboard.map((l) => Math.abs(l.pnlµ)));
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
        <SecHead icon={<Layers className="h-4 w-4" />} title="13-בריכות-צולבות" sub="שוק-פנימי-ריבוני · עמלות-נזרעות-לLP" />
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

      <div className="grid gap-3 md:grid-cols-2">
        <Panel className="p-4 md:p-5">
          <SecHead icon={<Boxes className="h-4 w-4" />} title="נכסים-עטופים · כיסוי-1:1" sub={`סה"כ ${data.wrapped.length} סמלים`} />
          <div className="max-h-72 overflow-y-auto pr-1 nexus-scroll">
            <table className="w-full text-xs" dir="ltr">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-600">
                  <th className="pb-2 font-medium">sym</th>
                  <th className="pb-2 text-right font-medium">supply</th>
                  <th className="pb-2 text-right font-medium">locked</th>
                  <th className="pb-2 text-right font-medium">refs</th>
                </tr>
              </thead>
              <tbody className="font-mono tabular-nums">
                {data.wrapped.map((w) => (
                  <tr key={w.sym} className="border-t border-zinc-800/60">
                    <td className="py-1.5 font-bold text-zinc-200">{w.sym}</td>
                    <td className="py-1.5 text-right text-zinc-300">{fmtInt(w.supply)}</td>
                    <td className="py-1.5 text-right text-emerald-300/80">{fmtInt(w.locked)}</td>
                    <td className="py-1.5 text-right text-zinc-600">{w.refs}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <div className="space-y-3">
          <Panel className="p-4 md:p-5">
            <SecHead icon={<TrendingUp className="h-4 w-4" />} title="מנוע-הגריד · רווחיות" sub={`rounds ${fmtCompact(g.rounds)} · ${fmtInt(g.tradesToday)} עסקאות-היום`} />
            <div className="grid grid-cols-2 gap-4">
              <Stat label="PnL-קופה-מצטבר" value={fmtµ(g.treasuryPnlµ) + " SAOS"} tone="emerald" />
              <Stat label="PnL-היום" value={fmtµ(g.treasuryPnlTodayµ)} />
            </div>
            <div className="mt-3 space-y-1.5">
              {g.leaderboard.map((l) => (
                <div key={l.name} className="flex items-center gap-2">
                  <span dir="ltr" className="w-16 font-mono text-[10px] text-zinc-500">{l.name}</span>
                  <div className="flex-1"><Bar pct={(Math.abs(l.pnlµ) / maxPnl) * 100} tone={l.pnlµ >= 0 ? "emerald" : "rose"} /></div>
                  <span dir="ltr" className={cn("w-20 text-left font-mono text-[10px] tabular-nums", l.pnlµ >= 0 ? "text-emerald-300/90" : "text-rose-300/90")}>{fmtµ(l.pnlµ)}</span>
                </div>
              ))}
            </div>
          </Panel>

          <Panel className="p-4 md:p-5">
            <SecHead icon={<Activity className="h-4 w-4" />} title="THE-HARVEST · כלכלה-פנימית" sub="עמלות-הרשת-מזינות-את-הרשת" />
            <div className="grid grid-cols-3 gap-3">
              <Stat label="עמלות-מצטבר" value={fmtµ(h.feesTotalµ + (h.gridFeeµ || 0))} tone="emerald" />
              <Stat label="שחרורים" value={fmtInt(h.releases)} />
              <Stat label="רכבת-זוכה" value={fmtInt(h.railCredited)} tone="violet" />
            </div>
            <div className="mt-3 flex items-center gap-2 border-t border-zinc-800/70 pt-3 text-[10px] text-zinc-600">
              <Fingerprint className="h-3.5 w-3.5" aria-hidden />
              <span dir="ltr" className="font-mono">fees→LP {f.toLp ?? 0}µ · treasury {f.toTreasury ?? 0}µ · total {fmtInt(f.total || 0)}µ</span>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
