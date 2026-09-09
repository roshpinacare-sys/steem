"use client";

/**
 * 117n — SYSTEM · מערכת-מלאה
 * logs (מציג-לוגים-חי-6-מקורות+סינון+השהיה) · inventory (מלוא-האחזקות-הריבוניות) · broker (ביקורת-הכספת)
 */

import { useState } from "react";
import { Boxes, FileTerminal, KeyRound, Pause, Play } from "lucide-react";
import { useLive } from "@/hooks/use-live";
import { cn } from "@/lib/utils";
import { Chip, Micro, Panel, SecHead, Stat, ago, fmtCompact, fmtInt } from "../primitives";

/* ── logs — מציג-הלוגים ── */
type LogsResp = { ok: boolean; f: string; bytes: number; count: number; lines: string[]; at: string };

const LOG_SRCS = [
  { id: "guardian", label: "guardian" },
  { id: "relay", label: "relay-doors" },
  { id: "deposits", label: "deposits" },
  { id: "harvest", label: "harvest" },
  { id: "agent", label: "agent" },
  { id: "anchor", label: "anchor" },
] as const;

function Logs() {
  const [f, setF] = useState<string>("guardian");
  const [q, setQ] = useState("");
  const live = useLive<LogsResp>(`/api/logs?f=${f}&n=140${q ? "&q=" + encodeURIComponent(q) : ""}`, 4000);
  return (
    <div className="space-y-4">
      <Panel className="p-4 md:p-5">
        <SecHead icon={<FileTerminal className="h-4 w-4" />} title="מציג-הלוגים-החי" sub="6-מקורות-ריבוניים · סינון-מיידי · סקר-4s" extra={live.error ? <Chip tone="rose">CONNECTION-LOST</Chip> : <Chip tone="emerald">TAILING</Chip>} />
        <div className="flex flex-wrap items-center gap-1.5">
          {LOG_SRCS.map((s) => (
            <button
              key={s.id}
              onClick={() => setF(s.id)}
              aria-pressed={f === s.id}
              className={cn(
                "rounded-full border px-3 py-1.5 font-mono text-[11px] transition-all",
                f === s.id ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-200" : "border-zinc-800 bg-zinc-900/50 text-zinc-500 hover:text-zinc-300"
              )}
              dir="ltr"
            >
              {s.label}
            </button>
          ))}
          <span className="mx-1 h-4 w-px bg-zinc-800" aria-hidden />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="grep…"
            dir="ltr"
            aria-label="סינון-לוג"
            className="w-40 rounded-md border border-zinc-800 bg-zinc-950/80 px-2.5 py-1.5 font-mono text-[11px] text-zinc-300 placeholder:text-zinc-600 focus:border-emerald-500/50 focus:outline-none"
          />
          <button onClick={() => live.setPaused(!live.paused)} className="flex items-center gap-1 rounded border border-zinc-800 px-2 py-1 font-mono text-[10px] text-zinc-500 hover:text-zinc-300">
            {live.paused ? <Play className="h-3 w-3" aria-hidden /> : <Pause className="h-3 w-3" aria-hidden />}
            {live.paused ? "RESUME" : "PAUSE"}
          </button>
          <span dir="ltr" className="font-mono text-[10px] text-zinc-600">{live.data ? fmtCompact(live.data.bytes) + "B · " + live.data.count + " lines" : ""}</span>
        </div>
      </Panel>

      <Panel corners={false} className="overflow-hidden">
        <div dir="ltr" className="max-h-[520px] overflow-y-auto bg-zinc-950/90 p-3 font-mono text-[10.5px] leading-relaxed nexus-scroll">
          {(live.data?.lines || []).map((l, i) => (
            <div key={i} className={cn("whitespace-pre-wrap break-all border-b border-zinc-900/80 py-0.5", /FAIL|DEAD|DOWN|ERROR|⛔|BLOCK/.test(l) ? "text-rose-300/90" : /WARN|⚠/.test(l) ? "text-amber-300/85" : /GUARD DONE|OK|alive|pass/.test(l) ? "text-zinc-400" : "text-zinc-500")}>
              {l}
            </div>
          ))}
          {(live.data?.lines || []).length === 0 && !live.loading && <p className="py-6 text-center text-xs text-zinc-600">אין-שורות-תואמות — כנות</p>}
        </div>
      </Panel>
    </div>
  );
}

/* ── inventory — מלוא-האחזקות ── */
type InvFile = { file: string; path: string; kind: string; bytes: number; mtime: string; ageSec: number };
type InvResp = { ok: boolean; files: InvFile[]; freshCount: number; totalBytes: number; at: string };

const KIND_TONE: Record<string, "emerald" | "violet" | "amber" | "rose" | "zinc"> = {
  state: "emerald",
  security: "rose",
  log: "amber",
  archive: "violet",
  agent: "zinc",
  relay: "violet",
  dex: "zinc",
  heal: "amber",
  bridge: "zinc",
};

function Inventory() {
  const live = useLive<InvResp>("/api/inventory", 15_000);
  const files = (live.data?.files || []).slice().sort((a, b) => (a.ageSec < 0 ? 1 : a.ageSec - b.ageSec));
  return (
    <div className="space-y-4">
      <Panel className="p-4 md:p-5">
        <SecHead icon={<Boxes className="h-4 w-4" />} title="מלוא-האחזקות-הריבוניות" sub="כל-מצבר-מדינה-ולוג-שיש-לנו — מטא-בלבד, אפס-תוכן-רגיש" extra={<Chip tone="emerald">{live.data?.freshCount || 0} FRESH {"<"}600s</Chip>} />
        <div className="grid grid-cols-3 gap-4 border-b border-zinc-800/70 pb-4">
          <Stat label="קבצים-במעקב" value={fmtInt(files.length)} />
          <Stat label="סך-נפח" value={fmtCompact(live.data?.totalBytes || 0) + "B"} tone="violet" />
          <Stat label="רעננים" value={fmtInt(live.data?.freshCount || 0)} sub="עודכנו-<10-דק'" tone="emerald" />
        </div>
        <div className="mt-3 max-h-[460px] overflow-y-auto pr-1 nexus-scroll">
          <table className="w-full text-xs" dir="ltr">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-600">
                <th className="pb-2 font-medium">file</th>
                <th className="pb-2 font-medium">kind</th>
                <th className="pb-2 text-right font-medium">size</th>
                <th className="pb-2 text-right font-medium">updated</th>
              </tr>
            </thead>
            <tbody className="font-mono tabular-nums">
              {files.map((f) => (
                <tr key={f.path} className="border-t border-zinc-800/60">
                  <td className="max-w-[180px] truncate py-1.5 text-zinc-300" title={f.path}>{f.file}</td>
                  <td className="py-1.5"><Chip tone={KIND_TONE[f.kind] || "zinc"}>{f.kind}</Chip></td>
                  <td className="py-1.5 text-right text-zinc-500">{f.bytes ? fmtCompact(f.bytes) + "B" : "—"}</td>
                  <td className="py-1.5 text-right">{f.ageSec < 0 ? <span className="text-rose-400/80">missing</span> : <span className={f.ageSec < 600 ? "text-emerald-300/80" : "text-zinc-500"}>{ago(f.mtime)} ago</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

/* ── broker — ביקורת-הכספת ── */
type AuditResp = { ok: boolean; count: number; events: Array<Record<string, unknown>>; bytes: number };

function Broker() {
  const live = useLive<AuditResp>("/api/audit?src=broker&n=80", 8000);
  const evs = live.data?.events || [];
  const denies = evs.filter((e) => String(e.verdict || "").startsWith("DENY")).length;
  return (
    <div className="space-y-4">
      <Panel className="p-4 md:p-5">
        <SecHead icon={<KeyRound className="h-4 w-4" />} title="THE-KEY-BROKER · ביקורת-הכספת" sub="כל-בקשת-חתימה-מוקלטת · DENY=הכספת-דחתה-בקשה-לא-חוקית" extra={<Chip tone="violet">VAULT-AUDIT</Chip>} />
        <div className="grid grid-cols-3 gap-4">
          <Stat label="אירועים-בטווח" value={fmtInt(live.data?.count || 0)} />
          <Stat label="דחיות-DENY" value={fmtInt(denies)} tone={denies ? "amber" : "emerald"} sub="הכספת-מגינה" />
          <Stat label="נפח-ביקורת" value={fmtCompact(live.data?.bytes || 0) + "B"} />
        </div>
      </Panel>
      <div className="max-h-[480px] space-y-1.5 overflow-y-auto pr-1 nexus-scroll" dir="ltr">
        {evs.length === 0 && !live.loading && <Panel className="p-6 text-center text-xs text-zinc-600" corners={false}>ריק-בכנות</Panel>}
        {evs.map((e, i) => {
          const v = String(e.verdict || "");
          return (
            <div key={String(e.at) + i} className="flex items-center justify-between gap-2 rounded-md border border-zinc-800/70 bg-zinc-900/40 px-3 py-2 font-mono text-[11px]">
              <div className="flex min-w-0 items-center gap-2">
                <span className="text-zinc-600">{ago(String(e.at || ""))} ago</span>
                <span className="truncate text-zinc-300">{String(e.op || "")}</span>
                <span className="truncate text-zinc-500">{String(e.door || "")}</span>
              </div>
              <Chip tone={v.startsWith("DENY") ? "rose" : v ? "emerald" : "zinc"}>{v || "—"}</Chip>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function SystemSec({ sub }: { sub: string }) {
  if (sub === "inventory") return <Inventory />;
  if (sub === "broker") return <Broker />;
  return <Logs />;
}
