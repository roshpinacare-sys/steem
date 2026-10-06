"use client";

// ─────────────────────────────────────────────────────────────────────
// AutonomyGateCard — שער-העצירה והחשיבה (r197, הוראת-המפעיל).
//
// "חייב לעצור ולבחון מה הסוכנים עושים ושיחשבו תמיד לפני שהם עושים
// דברים כי הכל רץ אוטומטית בלי שכל ואינטילגנציה".
//
// שלושה מצבים, קובץ-אמת אחד (sovereign/autonomy/GATE.json):
//   PAUSED   — אף פעולה אוטונומית לא זזה (כסף/תגמולים/גריד/חיילים).
//   THINKING — פעולה רק עם דיון מלא שנכתב לפני (מה/למה/צפי/סיכון/רולבק).
//   ACTIVE   — רגיל; כל פעולה עדיין רושמת דיון.
// fail-closed: קובץ קרוע = PAUSED. השער נאכף גם בכל דיבון וגם בשרת.
// ─────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from "react";
import { Brain, CirclePause, CirclePlay, Loader2, OctagonX, RefreshCw, ScrollText } from "lucide-react";
import { toast } from "sonner";
import { useOperator } from "@/components/weave/operator";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type GateMode = "PAUSED" | "THINKING" | "ACTIVE";

interface Deliberation {
  seq?: number;
  at: string;
  action: string;
  actor: string;
  claim: string;
  why: string;
  expected?: string;
  risk?: string;
  rollback?: string;
}

interface AutonomyState {
  ok: boolean;
  gate: { mode: GateMode; since: string; reason: string; setBy: string; updatedAt: string };
  deliberationsTotal: number;
  deliberationsValid: number;
  deliberations: Deliberation[];
  refusedByAutonomy: number;
  daemonStates: Record<string, string | null>;
  error?: string;
}

const MODE_STYLES: Record<GateMode, { badge: string; ring: string; label: string; hint: string }> = {
  PAUSED: {
    badge: "bg-rose-600/10 text-rose-700 border-rose-600/30 dark:text-rose-400",
    ring: "border-rose-600/40",
    label: "עצור",
    hint: "אף פעולה אוטונומית לא זזה — כסף, תגמולים, גריד, חיילים",
  },
  THINKING: {
    badge: "bg-amber-600/10 text-amber-700 border-amber-600/30 dark:text-amber-400",
    ring: "border-amber-600/40",
    label: "חשיבה",
    hint: "כל פעולה רצה רק עם דיון מלא שנכתב לפני",
  },
  ACTIVE: {
    badge: "bg-emerald-600/10 text-emerald-700 border-emerald-600/30 dark:text-emerald-400",
    ring: "border-emerald-600/40",
    label: "פעיל",
    hint: "הרשת עובדת רגיל — כל פעולה עדיין רושמת דיון",
  },
};

export function AutonomyGateCard() {
  const { authedFetch } = useOperator();
  const [state, setState] = useState<AutonomyState | null>(null);
  const [loading, setLoading] = useState(false);
  const [setting, setSetting] = useState<GateMode | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authedFetch("/api/autonomy");
      const j = (await res.json()) as AutonomyState & { error?: string };
      if (!res.ok || !j.ok) throw new Error(j.error ?? `שגיאה (${res.status})`);
      setState(j);
    } catch (e) {
      setState(null);
      toast.error(`שער-האוטונומיה לא נקרא: ${String((e as Error)?.message ?? e).slice(0, 90)}`);
    } finally {
      setLoading(false);
    }
  }, [authedFetch]);

  useEffect(() => {
    void load();
  }, [load]);

  const setMode = useCallback(
    async (mode: GateMode) => {
      const reason =
        mode === "PAUSED"
          ? "הוראת המפעיל: לעצור ולבחון מה הסוכנים עושים — האוטונומיה לא זזה עד בחינה"
          : mode === "THINKING"
            ? "הוראת המפעיל: כל פעולה רצה רק עם דיון מלא שנכתב לפני — לחשוב לפני שעושים"
            : "הוראת המפעיל: הרשת חוזרת לעבוד — כל פעולה ממשיכה להירשם בדיונים";
      setSetting(mode);
      try {
        const res = await authedFetch("/api/autonomy", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode, reason, by: "operator:command-view" }),
        });
        const j = (await res.json()) as { ok?: boolean; error?: string; gate?: { mode: GateMode } };
        if (!res.ok || !j.ok) throw new Error(j.error ?? `שגיאה (${res.status})`);
        toast.success(`שער-האוטונומיה: ${MODE_STYLES[mode].label}`);
        await load();
      } catch (e) {
        toast.error(`שינוי-השער נכשל: ${String((e as Error)?.message ?? e).slice(0, 90)}`);
      } finally {
        setSetting(null);
      }
    },
    [authedFetch, load],
  );

  const mode = state?.gate?.mode ?? null;
  const style = mode ? MODE_STYLES[mode] : null;

  return (
    <Card className={cn("mb-6 border-2", style?.ring)} data-testid="autonomy-gate">
      <CardContent className="flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <OctagonX className="size-5 text-rose-600 dark:text-rose-400" aria-hidden="true" />
            <div>
              <div className="text-sm font-bold">שער-העצירה והחשיבה (r197)</div>
              <div className="text-[11px] text-muted-foreground">
                הוראת המפעיל: לעצור, לבחון, ולחשוב תמיד לפני שעושים · fail-closed
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {mode ? (
              <Badge className={cn("border", style!.badge)}>{style!.label}</Badge>
            ) : (
              <Badge variant="outline" className="border-muted">
                לא נקרא
              </Badge>
            )}
            <Button variant="outline" size="icon" className="size-8" onClick={() => void load()} disabled={loading} aria-label="רענן שער">
              <RefreshCw className={cn("size-4", loading && "animate-spin")} aria-hidden="true" />
            </Button>
          </div>
        </div>

        {state?.gate?.reason ? (
          <p className="rounded-lg bg-muted/50 p-3 text-xs leading-relaxed text-muted-foreground">
            {state.gate.reason}
            <span className="mt-1 block font-mono text-[10px] opacity-70">
              מאז {new Date(state.gate.since).toLocaleString("he-IL")} · נקבע על-ידי {state.gate.setBy}
            </span>
          </p>
        ) : null}

        <div className="grid gap-2 sm:grid-cols-3">
          <Button
            variant={mode === "PAUSED" ? "destructive" : "outline"}
            className="gap-2"
            disabled={setting !== null || mode === "PAUSED"}
            onClick={() => void setMode("PAUSED")}
          >
            {setting === "PAUSED" ? <Loader2 className="size-4 animate-spin" /> : <CirclePause className="size-4" aria-hidden="true" />}
            עצור הכל (PAUSED)
          </Button>
          <Button
            variant={mode === "THINKING" ? "default" : "outline"}
            className="gap-2"
            disabled={setting !== null || mode === "THINKING"}
            onClick={() => void setMode("THINKING")}
          >
            {setting === "THINKING" ? <Loader2 className="size-4 animate-spin" /> : <Brain className="size-4" aria-hidden="true" />}
            חשיבה לפני פעולה
          </Button>
          <Button
            variant={mode === "ACTIVE" ? "default" : "outline"}
            className="gap-2"
            disabled={setting !== null || mode === "ACTIVE"}
            onClick={() => void setMode("ACTIVE")}
          >
            {setting === "ACTIVE" ? <Loader2 className="size-4 animate-spin" /> : <CirclePlay className="size-4" aria-hidden="true" />}
            הפעל (ACTIVE)
          </Button>
        </div>

        <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
          <span className="rounded-md bg-muted/60 px-2 py-1">פעולות שנעצרו על-ידי השער: {state?.refusedByAutonomy != null && state.refusedByAutonomy >= 0 ? state.refusedByAutonomy : "—"}{state?.refusedByAutonomy != null && state.refusedByAutonomy >= 0 ? "" : " (ספירה לא זמינה)"}</span>
          <span className="rounded-md bg-muted/60 px-2 py-1">רשומות-דיון: {state?.deliberationsTotal ?? 0} (תקינות {state?.deliberationsValid ?? 0})</span>
          {state?.daemonStates
            ? Object.entries(state.daemonStates).map(([k, v]) => (
                <span key={k} className="rounded-md bg-muted/60 px-2 py-1 font-mono">
                  {k}: {v ?? "—"}
                </span>
              ))
            : null}
        </div>

        {state?.deliberations && state.deliberations.length > 0 ? (
          <div className="max-h-56 overflow-y-auto rounded-lg border" role="log" aria-label="רשומות-דיון אחרונות">
            <div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-2 text-xs font-bold">
              <ScrollText className="size-3.5" aria-hidden="true" />
              רשומות-דיון אחרונות (לחשוב לפני שעושים — מתועד)
            </div>
            <ul className="divide-y">
              {state.deliberations.slice(0, 8).map((d, i) => (
                <li key={`${d.seq ?? i}-${d.at}`} className="px-3 py-2 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="font-mono text-[10px]">
                      #{d.seq ?? "?"} {d.action} · {d.actor}
                    </Badge>
                    <span className="font-mono text-[10px] text-muted-foreground">{new Date(d.at).toLocaleString("he-IL")}</span>
                  </div>
                  <p className="mt-1 leading-relaxed">{d.claim}</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">למה: {d.why}</p>
                  {d.risk ? <p className="text-[11px] text-muted-foreground">סיכון: {d.risk}</p> : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
