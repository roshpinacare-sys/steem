"use client";

// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · פס סטטיסטיקות EVM-3 (replay protection):
// רוטציות (מה-DB), אתגרים שאומתו ודחיות replay (מוני זיכרון מאז
// הפעלת השרת - מתויגים בכנות ב-counterScope). נטען עם הטאב ומתרענן
// אחרי כל פעילות אתגר/רוטציה (refreshKey).
// ─────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Ban, RotateCw, ShieldCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { Evm3StatsDTO } from "@/lib/weave/evmext-types";
import { apiFetch, errorMessage } from "../api";
import { MotionCard } from "../shared";

interface StatsState {
  data: Evm3StatsDTO | null;
  loading: boolean;
  error: string | null;
}

export function Evm3Section({ refreshKey = 0 }: { refreshKey?: number }) {
  const [stats, setStats] = useState<StatsState>({ data: null, loading: false, error: null });
  const inFlightRef = useRef(false);

  const load = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setStats((s) => ({ ...s, loading: true, error: null }));
    try {
      const res = await apiFetch<{ stats: Evm3StatsDTO }>("/api/weave/evm3");
      setStats({ data: res.stats, loading: false, error: null });
    } catch (err) {
      setStats((s) => ({ ...s, loading: false, error: errorMessage(err) }));
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  if (stats.loading && !stats.data) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i} className="p-4">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="mt-3 h-8 w-14" />
            <Skeleton className="mt-3 h-3 w-32" />
          </Card>
        ))}
      </div>
    );
  }

  // שגיאה/היעדר נתונים - פס שקט ללא חסימת הטאב
  if (!stats.data) {
    return stats.error ? (
      <p className="rounded-lg border border-rose-500/30 bg-rose-500/[0.05] p-3 text-xs text-rose-700 dark:text-rose-300">
        סטטיסטיקות EVM-3 לא נטענו: {stats.error}
      </p>
    ) : null;
  }

  const s = stats.data;

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <MiniStat
          icon={<RotateCw className="size-4" />}
          tone="zinc"
          label="רוטציות מפתח"
          hint="מה-DB - פעולות מתועדות (KeyOp)"
          value={s.rotations}
        />
        <MiniStat
          icon={<ShieldCheck className="size-4" />}
          tone="emerald"
          label="אתגרים שאומתו"
          hint="nonce נצרך + ecrecover תקין"
          value={s.challengesVerified}
        />
        <MiniStat
          icon={<Ban className="size-4" />}
          tone="rose"
          label="דחיות replay"
          hint="חתימות חד-פעמיות שנשלחו שוב"
          value={s.replaysBlocked}
        />
      </div>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        {s.counterScope}
      </p>
    </div>
  );
}

const TONES = {
  emerald: {
    iconBox: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  },
  rose: {
    iconBox: "border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400",
  },
  zinc: {
    iconBox: "border-zinc-500/30 bg-zinc-500/10 text-zinc-600 dark:text-zinc-400",
  },
} as const;

function MiniStat({
  icon,
  label,
  hint,
  value,
  tone,
}: {
  icon: ReactNode;
  label: string;
  hint: string;
  value: number;
  tone: keyof typeof TONES;
}) {
  return (
    <MotionCard className="p-4">
      <div className="flex items-center gap-2.5">
        <span
          className={`flex size-8 shrink-0 items-center justify-center rounded-lg border ${TONES[tone].iconBox}`}
        >
          {icon}
        </span>
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
      </div>
      <p dir="ltr" className="mt-2 font-mono text-2xl font-bold tabular-nums">
        {value.toLocaleString("en-US")}
      </p>
      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{hint}</p>
    </MotionCard>
  );
}
