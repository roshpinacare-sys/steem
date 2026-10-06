"use client";

// ─────────────────────────────────────────────────────────────────────
// TX-GATE CARD — כרטיס שער-העסקאות (R97) · נשען בשער המפעיל.
//
// הוראת המפעיל: "מערכת אוטונומית לא צריכה שער מפעיל רק במקרים של
// עסקאות באמת גדולות 100$ ומעלה."
//
// הכרטיס מציג את המדיניות, תור האישורים ויומן ההכרעות — מ-/api/gate.
// אישור/דחייה פתוחים רק לסשן-מפעיל (השרשרת היא ההרשאה); בלי סשן —
// התור נראה בגלוי, הכפתורים נעולים בכנות.
// ─────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from "react";
import {
  Bot,
  CheckCircle2,
  Clock3,
  Lock,
  RefreshCw,
  Scale,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { useOperator } from "@/components/weave/operator";
import { cn } from "@/lib/utils";

interface GateRecord {
  id: string;
  source: string;
  action: string;
  title: string;
  usdValue: number;
  usdBasis: string;
  verdict: string;
  decidedBy: string;
  reason: string;
  receipt?: string | null;
  createdAt: string;
  decidedAt?: string | null;
}

interface GateData {
  ok: boolean;
  threshold: number;
  queue: GateRecord[];
  recent: GateRecord[];
  stats: { allowed: number; queued: number; refused: number; executed: number; rejected: number };
  doctrine: string[];
}

const VERDICT_META: Record<string, { label: string; cls: string }> = {
  ALLOWED: { label: "אוטונומיה", cls: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" },
  EXECUTED: { label: "בוצע", cls: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" },
  APPROVED: { label: "אושר בידי מפעיל", cls: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" },
  QUEUED: { label: "ממתין לאישור", cls: "border-amber-500/30 bg-amber-500/10 text-amber-300" },
  REJECTED: { label: "נדחה", cls: "border-rose-500/30 bg-rose-500/10 text-rose-300" },
  REFUSED: { label: "סורב — אין מדידה", cls: "border-zinc-600/40 bg-zinc-700/20 text-zinc-400" },
};

function fmtUsd(v: number | null | undefined): string {
  return typeof v === "number" ? `$${v.toFixed(2)}` : "—";
}

function timeHe(iso?: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "—";
  }
}

export function TxGateCard() {
  const { status, authedFetch } = useOperator();
  const [data, setData] = useState<GateData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const r = await fetch("/api/gate", { cache: "no-store" });
      const j = (await r.json()) as GateData;
      if (!j.ok) throw new Error(`http ${r.status}`);
      setData(j);
      setErr(null);
    } catch (e) {
      setErr(String((e as Error).message ?? e).slice(0, 80));
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 30_000);
    return () => clearInterval(t);
  }, [load]);

  const decide = useCallback(
    async (id: string, decision: "approve" | "reject") => {
      if (busyId) return;
      setBusyId(`${id}:${decision}`);
      try {
        const r = await authedFetch("/api/gate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, decision }),
        });
        const j = (await r.json()) as { ok?: boolean; he?: string; error?: string };
        if (!r.ok || !j.ok) throw new Error(j.error ?? `http ${r.status}`);
        toast.success(decision === "approve" ? "הפעולה אושרה" : "הפעולה נדחתה", {
          description: j.he,
        });
        await load();
      } catch (e) {
        toast.error("ההכרעה נכשלה", {
          description: String((e as Error).message ?? e).slice(0, 120),
        });
      } finally {
        setBusyId(null);
      }
    },
    [authedFetch, busyId, load],
  );

  const locked = status !== "in";
  const queue = data?.queue ?? [];
  const recent = data?.recent ?? [];
  const stats = data?.stats;

  return (
    <div className="space-y-4">
      {/* המדיניות — כתובה פעם אחת, נאכפת בכל מקום */}
      <Card className="border-[#d4af37]/25 bg-gradient-to-b from-[#d4af37]/[0.05] to-transparent">
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-bold text-zinc-100">
              <Scale className="size-4 text-[#d4af37]" aria-hidden />
              המדיניות — הוראת המפעיל, נאכפת בקוד
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 px-2 text-zinc-400"
              onClick={() => void load()}
              disabled={refreshing}
            >
              <RefreshCw className={cn("size-3.5", refreshing && "animate-spin")} aria-hidden />
              רענון
            </Button>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="rounded-lg border border-emerald-600/25 bg-emerald-500/[0.06] px-3 py-2.5">
              <div className="text-[11px] text-zinc-500">מתחת לסף</div>
              <div className="text-sm font-bold text-emerald-300">אוטונומיה מלאה — בלי שער</div>
            </div>
            <div className="rounded-lg border border-amber-500/25 bg-amber-500/[0.06] px-3 py-2.5">
              <div className="text-[11px] text-zinc-500">מהסף ומעלה</div>
              <div className="text-sm font-bold text-amber-300">תור אישור מפעיל</div>
            </div>
            <div className="rounded-lg border border-zinc-700 bg-zinc-800/40 px-3 py-2.5">
              <div className="text-[11px] text-zinc-500">הסף</div>
              <div className="text-sm font-bold text-zinc-100">{data ? `$${data.threshold}` : "…"}</div>
            </div>
          </div>
          {stats && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-zinc-500">
              <span>
                הכרעות אוטונומיות: <b className="text-emerald-300">{stats.allowed}</b>
              </span>
              <span>
                בוצעו: <b className="text-emerald-300">{stats.executed}</b>
              </span>
              <span>
                בתור: <b className="text-amber-300">{stats.queued}</b>
              </span>
              <span>
                נדחו: <b className="text-rose-300">{stats.rejected}</b>
              </span>
              <span>
                סורבו (אין מדידה): <b className="text-zinc-400">{stats.refused}</b>
              </span>
            </div>
          )}
          {err && (
            <p className="text-xs text-rose-300">שער-העסקאות לא נקרא — {err} (ננסה שוב בעוד 30 שנ׳)</p>
          )}
        </CardContent>
      </Card>

      {/* תור האישורים */}
      <Card className="border-zinc-800">
        <CardContent className="p-0">
          <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-bold text-zinc-100">
              <Clock3 className="size-4 text-amber-400" aria-hidden />
              תור אישורים — עסקאות גדולות בלבד
            </div>
            <Badge variant="outline" className="border-zinc-700 bg-zinc-800/60 text-zinc-400">
              {queue.length} ממתינות
            </Badge>
          </div>
          {data == null ? (
            <div className="space-y-2 p-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : queue.length === 0 ? (
            <div className="flex items-center gap-2 px-4 py-6 text-sm text-zinc-500">
              <Bot className="size-4 text-emerald-400" aria-hidden />
              אין פעולות ממתינות — ההכרעות שמתחת לסף נרשמות בסטטיסטיקה למעלה.
            </div>
          ) : (
            <ul className="divide-y divide-zinc-800/70">
              {queue.map((q) => (
                <li key={q.id} className="space-y-2 px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-zinc-100" title={q.title}>
                        {q.title}
                      </p>
                      <p className="text-[11px] text-zinc-500">
                        {q.source} · {q.action} · {timeHe(q.createdAt)} · בסיס: {q.usdBasis}
                      </p>
                    </div>
                    <Badge variant="outline" className="shrink-0 border-amber-500/30 bg-amber-500/10 text-amber-300">
                      {fmtUsd(q.usdValue)}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    {locked ? (
                      <span className="flex items-center gap-1.5 text-[11px] text-zinc-500">
                        <Lock className="size-3" aria-hidden />
                        הכרעה פתוחה למפעיל בלבד — התחבר עם מפתח ה-active
                      </span>
                    ) : (
                      <>
                        <Button
                          size="sm"
                          className="h-8 bg-emerald-600 font-bold text-white hover:bg-emerald-500"
                          disabled={busyId != null}
                          onClick={() => void decide(q.id, "approve")}
                        >
                          {busyId === `${q.id}:approve` ? (
                            <RefreshCw className="size-3.5 animate-spin" />
                          ) : (
                            <CheckCircle2 className="size-3.5" />
                          )}
                          אישור
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 border-rose-700/50 text-rose-300 hover:bg-rose-500/10"
                          disabled={busyId != null}
                          onClick={() => void decide(q.id, "reject")}
                        >
                          <XCircle className="size-3.5" />
                          דחייה
                        </Button>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* יומן ההכרעות — האמת במדידה */}
      <Card className="border-zinc-800">
        <CardContent className="p-0">
          <div className="flex items-center gap-2 border-b border-zinc-800 px-4 py-3 text-sm font-bold text-zinc-100">
            <ShieldCheck className="size-4 text-emerald-400" aria-hidden />
            יומן ההכרעות
          </div>
          {data != null && recent.length === 0 ? (
            <p className="px-4 py-5 text-sm text-zinc-500">
              אין הכרעות עדיין — הספר נפתח עם הפעולה הבאה של המוביל.
            </p>
          ) : (
            <ul className="max-h-72 divide-y divide-zinc-800/70 overflow-y-auto">
              {recent.slice(0, 10).map((r) => {
                const meta = VERDICT_META[r.verdict] ?? {
                  label: r.verdict,
                  cls: "border-zinc-700 bg-zinc-800/40 text-zinc-400",
                };
                return (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-[13px] text-zinc-200" title={r.title}>
                        {r.title}
                      </p>
                      <p className="text-[11px] text-zinc-500">
                        {fmtUsd(r.usdValue)} · {r.decidedBy} · {timeHe(r.decidedAt ?? r.createdAt)}
                      </p>
                    </div>
                    <Badge variant="outline" className={cn("shrink-0", meta.cls)}>
                      {meta.label}
                    </Badge>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <p className="text-[11px] leading-relaxed text-zinc-600">
        כל הכרעה נשמרת עם ערך-USD חי שנמדד בזמן ההחלטה, בסיס-ההערכה וקבלה. הפעולה עצמה מבוצעת
        רק דרך העורקים המוסמכים — השער מכריע, העורק מבצע, השרשרת שופטת.
      </p>
    </div>
  );
}
