"use client";

// ─────────────────────────────────────────────────────────────────────
// GridArmCard — דלת חימום הגריד החוץ (R37 · r185-ריבוני).
//
// הגריד החיצוני בנוי, נמדד (פרימיית-SBD חיה של +18%–29%) ומתוזמן.
// r185 · D-OP-01: אף אחד לא שואל את המפעיל אף מפתח — החימוש שואב את
// STEEM_ACTIVE_WIF מכספת-הסוכנים בשרת, משפט אותו ביט-מול-ביט מול
// ה-active החי של @headcorner בשרשרת, ואוטם אל כספת הריפו. לחיצה אחת —
// אפס קלט. המפתח לא נשמר בשום מקום — לא בסנדבוקס-קליינט, לא בלוג, לא
// בתשובה.
// ─────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from "react";
import {
  CalendarClock,
  Flame,
  Fuel,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Swords,
  Unlock,
  Vault,
} from "lucide-react";
import { toast } from "sonner";
import { useOperator } from "@/components/weave/operator";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface ArmGridState {
  ok: boolean;
  repo: string;
  secretPresent: boolean | null;
  secretUpdatedAt: string | null;
  nextScheduledRun: string | null;
  grid: {
    armed: boolean;
    verdict: string;
    blocker: string[];
    fuel: {
      powerdownActive: boolean;
      weeklySp?: number;
      weeklyUsd?: number;
      nextPayout?: string;
      remainingSp?: number;
    } | null;
    inventory: { steem?: number; sbd?: number } | null;
    publishedAt: string;
  } | null;
}

function payoutLabel(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const now = Date.now();
  const diffMs = d.getTime() - now;
  if (diffMs <= 0) return "התשלום כבר יצא / הבא בדרך";
  const h = Math.round(diffMs / 3_600_000);
  if (h < 48) return `בעוד ~${h} שע׳ (${d.toLocaleDateString("he-IL")} ${d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })})`;
  return d.toLocaleString("he-IL");
}

export function GridArmCard() {
  const { authedFetch, status } = useOperator();
  const [state, setState] = useState<ArmGridState | null>(null);
  const [loading, setLoading] = useState(false);
  const [arming, setArming] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authedFetch("/api/admin/arm-grid");
      const j = (await res.json()) as ArmGridState & { error?: string };
      if (!res.ok || !j.ok) throw new Error(j.error ?? `שגיאה (${res.status})`);
      setState(j);
    } catch (e) {
      setState(null);
      toast.error("טעינת מצב הגריד נכשלה", {
        description: e instanceof Error ? e.message : "נסה שוב",
      });
    } finally {
      setLoading(false);
    }
  }, [authedFetch]);

  useEffect(() => {
    if (status === "in") void load();
  }, [load, status]);

  // r185 · חימוש-ריבוני: אפס קלט — המפתח נשאב בשרת מכספת הסוכנים
  const arm = useCallback(async () => {
    setArming(true);
    try {
      const res = await authedFetch("/api/admin/arm-grid", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const j = (await res.json()) as {
        ok: boolean;
        stage?: string;
        reason?: string;
        error?: string;
        secret?: string;
        repo?: string;
        secretUpdatedAt?: string | null;
      };
      if (!res.ok || !j.ok) {
        throw new Error(j.reason ?? j.error ?? `שלב: ${j.stage ?? res.status}`);
      }
      toast.success("הגריד חומש 🔥", {
        description: `${j.secret} נשאב מכספת הסוכנים, אומת מול השרשרת ונאטם בכספת ${j.repo}. אפס קלט מפעיל.`,
        duration: 7000,
      });
      await load();
    } catch (e) {
      toast.error("החימוש נכשל — שום דבר לא השתנה", {
        description: e instanceof Error ? e.message : "נסה שוב",
        duration: 7000,
      });
    } finally {
      setArming(false);
    }
  }, [authedFetch, load]);

  const gridVerdict = state?.grid?.verdict ?? null;
  // r124 · כנות: null = רישום הסודות לא נקרא (כשל-API) — לא “לא קיים”.
  // במקרה כזה נציג הסבר, לא נטען שהסוד נעלם.
  const armedSecret = state?.secretPresent ?? false;
  const secretListUnread = state != null && state.secretPresent == null;
  const fuel = state?.grid?.fuel ?? null;

  return (
    <Card className="mb-6 border-amber-500/30 bg-gradient-to-b from-amber-500/[0.04] to-transparent">
      <CardContent className="flex flex-col gap-4 p-5">
        {/* כותרת */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-bold">
            <Swords className="size-4 text-amber-500" aria-hidden="true" />
            חימום הגריד החוץ — עורק הכסף האמיתי
            {gridVerdict ? (
              armedSecret ? (
                <Badge className="gap-1 border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
                  <Unlock className="size-3" aria-hidden="true" />
                  מפתח נאטם בכספת
                </Badge>
              ) : (
                <Badge className="gap-1 border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400">
                  <Flame className="size-3" aria-hidden="true" />
                  לא נאטם — חימוש-ריבוני זמין
                </Badge>
              )
            ) : null}
          </div>
          <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-muted-foreground" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={cn("size-3.5", loading && "animate-spin")} aria-hidden="true" />
            רענן
          </Button>
        </div>

        {/* מצב חי */}
        <div className="grid gap-2 text-xs sm:grid-cols-3">
          <div className="rounded-lg border bg-card/60 px-3 py-2.5">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Swords className="size-3.5" aria-hidden="true" />
              פסק-דין אחרון (חי)
            </div>
            <div className="mt-1 font-mono text-[11px] leading-relaxed" dir="ltr">
              {gridVerdict ?? (loading ? "…" : "—")}
            </div>
          </div>
          <div className="rounded-lg border bg-card/60 px-3 py-2.5">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Fuel className="size-3.5" aria-hidden="true" />
              דלק שבועי
            </div>
            <div className="mt-1 font-mono text-[11px]">
              {fuel?.weeklySp ? `${fuel.weeklySp.toFixed(0)} SP ≈ $${(fuel.weeklyUsd ?? 0).toFixed(0)}/שבוע` : "—"}
            </div>
          </div>
          <div className="rounded-lg border bg-card/60 px-3 py-2.5">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <CalendarClock className="size-3.5" aria-hidden="true" />
              תשלום powerdown הבא
            </div>
            <div className="mt-1 font-mono text-[11px]">{payoutLabel(fuel?.nextPayout)}</div>
          </div>
        </div>

        {secretListUnread && (
          <div className="flex flex-col gap-1 rounded-lg border border-amber-500/40 bg-amber-500/[0.06] px-4 py-2 text-xs">
            <span className="font-bold text-amber-700 dark:text-amber-400">רישום הסודות של הריפו לא נקרא (כשל GitHub API)</span>
            <span className="text-muted-foreground">
              לא נטען שהמפתח נעלם ולא שהוא קיים — האמת תימדד בקריאה הבאה. אין פעולה אוטומטית על סמך לא-נמדד.
            </span>
          </div>
        )}
        {armedSecret ? (
          /* מצב חמוש */
          <div className="flex flex-col gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/[0.05] px-4 py-3 text-sm">
            <div className="flex items-center gap-2 font-bold text-emerald-700 dark:text-emerald-400">
              <ShieldCheck className="size-4" aria-hidden="true" />
              הגריד חמוש
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              הכספת המוצפנת של <span className="font-mono">roshpinacare-sys/saos-dex</span> מחזיקה מעתה את מלוא חוט-המפתחות:{" "}
              <span className="font-mono">STEEM_ACTIVE_WIF + HIVE_ACTIVE_WIF + HIVE_POSTING_WIF + BLURT_ACTIVE_WIF + STEEM_POSTING_WIF</span>{" "}
              (נמסרו מכספת-הארנק הריבונית, אומתו ביט-מול-ביט מול הרשויות החיות בשלוש השרשראות לפני האטימה)
              {state?.secretUpdatedAt ? ` (אומת לאחרונה ${new Date(state.secretUpdatedAt).toLocaleString("he-IL")})` : ""}.
              המכונה החיה: התאום הציבורי ב-Domain ({state?.nextScheduledRun ?? "לוח-הזמנים לא נקרא מהענן ברגע זה"}) — רגל-STEEM ורגל-HIVE חיות יחד,
              כל מילוי-חוץ נספר בכנות בקונסולה הציבורית. אפשר להזניק ריצה עכשיו דרך כפתורי ההזנקה למטה.
            </p>
          </div>
        ) : (
          /* חימוש-ריבוני — אפס קלט (r185) */
          <div className="flex flex-col gap-3 rounded-lg border border-amber-500/25 bg-amber-500/[0.03] px-4 py-3">
            <p className="text-xs leading-relaxed text-muted-foreground">
              הגריד בנוי, נמדד (פרימיית-SBD חיה של{" "}
              <span className="font-mono text-amber-600 dark:text-amber-400">+18%–29%</span> מול קו-הזהות) ומתוזמן יומית —
              וחימוסו אינו דורש ממך דבר. לחיצה אחת: השרת שואב את ה-active מכספת הסוכנים, משפט אותו מול
              השרשרת החיה, ואוטם אותו ישר אל כספת הריפו (GitHub Actions Secrets).{" "}
              <span className="font-semibold">
                אין סיסמה להזין ולא נשמר כאן כלום — לא דיסק, לא לוג, לא תשובה.
              </span>
            </p>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Button
                onClick={() => void arm()}
                disabled={arming}
                className="gap-2 bg-amber-600 text-white hover:bg-amber-500"
              >
                {arming ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Flame className="size-4" aria-hidden="true" />
                )}
                {arming ? "שואב מהכספת, מאמת ואוטם…" : "חמש מהכספת — אפס קלט"}
              </Button>
              <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Vault className="size-3.5" aria-hidden="true" />
                מקור המפתח: ~/.sovereign/vault (0600, מחוץ-לגיט) · שיפוט: השרשרת החיה
              </span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
