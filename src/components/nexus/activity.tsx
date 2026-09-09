"use client";

/**
 * 117q — THE-PULSE · פס-הדופק-החי
 * זנב-חי של יומן-השומר (guardian.log) — נושם-עם-הרשת: FAIL-אדום · SKIP-ענבר · PASS-ירקן.
 * נועד-למלא-את-שטח-המת-מתחת-לתוכן-במסכים-קצרים-ולתת-תחושת-מרכז-פיקוד-חי.
 * כנות-מלאה: מה-שהיומן-אומר-זה-מה-שמוצג — אין-סינון-חוץ-מאורך-חתוך.
 */

import { useEffect, useRef, useState } from "react";
import { Activity } from "lucide-react";
import { cn } from "@/lib/utils";
import { LiveDot } from "./primitives";

type Line = { t: string; msg: string; tone: "ok" | "warn" | "bad" | "dim" };

function classify(raw: string): Line {
  // פורמט-שורה: [2026-09-09T16:13:12.189Z] rest…
  const m = raw.match(/^\[([^\]]+)\]\s?(.*)$/);
  const t = m ? m[1].slice(11, 19) : "";
  const msg = m ? m[2] : raw;
  let tone: Line["tone"] = "dim";
  if (/FAIL|ERR|dead|DOWN|OOM|panic/i.test(msg)) tone = "bad";
  else if (/SKIP|WARN|stale|warming|no-seal|pending/i.test(msg)) tone = "warn";
  else if (/GUARD DONE|pass:|VERIFIED|SPAWNED|REVIVED|alive|ok\(/i.test(msg)) tone = "ok";
  return { t, msg, tone };
}

const TONE_MAP = {
  ok: "text-emerald-200/70",
  warn: "text-amber-200/80",
  bad: "text-rose-300",
  dim: "text-zinc-500",
} as const;

export function PulseStrip() {
  const [lines, setLines] = useState<Line[]>([]);
  const [err, setErr] = useState(false);
  const alive = useRef(true);

  useEffect(() => {
    const pull = async () => {
      try {
        const r = await fetch("/api/logs?f=guardian", { cache: "no-store" });
        const j = await r.json();
        if (!alive.current) return;
        const rows: Line[] = (j?.lines || []).slice(-6).reverse().map((l: string) => classify(l));
        setLines(rows);
        setErr(false);
      } catch {
        if (alive.current) setErr(true);
      }
    };
    pull();
    const iv = setInterval(pull, 12_000);
    return () => {
      alive.current = false;
      clearInterval(iv);
    };
  }, []);

  return (
    <section aria-label="דופק-הרשת-החי" className="mt-auto pt-6">
      <div className="rounded-lg border border-zinc-800/70 bg-zinc-950/60 backdrop-blur-sm">
        <div className="flex items-center justify-between border-b border-zinc-800/60 px-4 py-2">
          <div className="flex items-center gap-2">
            <Activity className="h-3.5 w-3.5 text-emerald-400/80" aria-hidden />
            <span className="text-[11px] font-bold tracking-wide text-zinc-300">דופק-הרשת</span>
            <span dir="ltr" className="hidden font-mono text-[9px] uppercase tracking-[0.22em] text-zinc-600 sm:inline">THE-PULSE · guardian-tail</span>
          </div>
          <span className="flex items-center gap-1.5">
            {err ? (
              <span className="font-mono text-[10px] text-rose-300">tail-נפל — ממשיך-לנסות</span>
            ) : (
              <LiveDot ok />
            )}
          </span>
        </div>
        <div className="max-h-[132px] space-y-px overflow-y-auto px-4 py-2 nexus-scroll" dir="ltr">
          {lines.length === 0 && !err && (
            <p className="py-2 font-mono text-[10px] text-zinc-600">connecting to guardian tail…</p>
          )}
          {lines.map((l, i) => (
            <div key={l.t + i} className="flex items-baseline gap-2.5 font-mono text-[10.5px] leading-relaxed">
              <span className="shrink-0 text-zinc-700 tabular-nums">{l.t}</span>
              <span className={cn("truncate", TONE_MAP[l.tone])}>{l.msg}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
