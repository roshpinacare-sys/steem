"use client";

import { useCallback, useEffect, useState } from "react";
import { StatusBadge } from "./StatusBadge";

/**
 * [agent-9/I1] כרטיס-כספת-הביטוח — ראיית-קבע למפעיל על שלמות-עותקי-הביטוח.
 * מקור-אמת: /api/saos/insurance (קריאה-ציבורית, אפס-סודות, חוק-G4).
 * כנות: אין-מדידה מוצג כאין-מדידה; פסק-דין רק-מנתונים-ציבוריים-מדידים.
 */

type SourceState = { sha: string | null; at: string | null; worklogBytes: number | null; reason?: string };
type SyncState = { runNumber: number | null; conclusion: string | null; at: string | null; reason?: string };

type InsurancePayload = {
  ok: boolean;
  verdict?: "FRESH" | "SOURCE-FRESH-SYNC-UNKNOWN" | "STALE";
  source?: SourceState;
  sync?: SyncState;
  reason?: string;
  measuredAt?: string;
};

const REFRESH_MS = 5 * 60_000;

function relTime(iso: string | null | undefined, now: number): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return "עכשיו";
  if (s < 3600) return `לפני ${Math.round(s / 60)} דק'`;
  if (s < 86_400) return `לפני ${Math.round(s / 3600)} שע'`;
  return `לפני ${Math.round(s / 86_400)} ימ'`;
}

function bytes(n: number | null | undefined): string | null {
  if (n == null || Number.isNaN(n)) return null;
  return n >= 1024 ? `${(n / 1024).toFixed(1)}K בייטים` : `${n} בייטים`;
}

const VERDICT_TONE: Record<string, "emerald" | "amber" | "rose" | "slate"> = {
  FRESH: "emerald",
  "SOURCE-FRESH-SYNC-UNKNOWN": "amber",
  STALE: "rose",
};

const VERDICT_LABEL: Record<string, string> = {
  FRESH: "כספת טרייה",
  "SOURCE-FRESH-SYNC-UNKNOWN": "מקור טרי · סנכרון לא נמדד",
  STALE: "כספת מיושנת",
};

const SYNC_LABEL: Record<string, string> = {
  success: "סנכרון הצליח",
  failure: "סנכרון נכשל",
  null: "סנכרון לא נמדד",
};

export function InsuranceCustodyCard() {
  const [data, setData] = useState<InsurancePayload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/saos/insurance", { signal: AbortSignal.timeout(15_000), cache: "no-store" });
      const j = (await r.json()) as InsurancePayload;
      setData(j);
      setErr(null);
    } catch (e) {
      setErr(String((e as Error)?.message || e).slice(0, 120));
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  if (err) {
    return (
      <div className="space-y-2">
        <StatusBadge tone="slate">אין מדידה</StatusBadge>
        <p className="text-xs leading-6 text-zinc-500">הקריאה-הציבורית נכשלה: {err}</p>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="h-16 min-w-0 animate-pulse rounded-lg border border-zinc-800 bg-zinc-900/40" />
    );
  }
  if (!data.ok) {
    return (
      <div className="space-y-2">
        <StatusBadge tone="slate">אין מדידה</StatusBadge>
        <p className="text-xs leading-6 text-zinc-500">{data.reason || "אין אות מאף מקור-ציבורי"}</p>
      </div>
    );
  }

  const v = data.verdict || "STALE";
  const tone = VERDICT_TONE[v] || "slate";
  const srcAt = relTime(data.source?.at, now);
  const syncAt = relTime(data.sync?.at, now);
  const size = bytes(data.source?.worklogBytes);
  const syncConclusion = data.sync?.conclusion == null ? null : String(data.sync.conclusion);

  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2">
        <StatusBadge tone={tone} solid pulse={tone === "emerald"}>
          {VERDICT_LABEL[v] || v}
        </StatusBadge>
      </div>
      <dl className="grid grid-cols-1 gap-x-3 gap-y-1.5 text-xs leading-5 text-zinc-400">
        <div className="flex items-baseline justify-between gap-2">
          <dt>עותק-מקור (Autonomy)</dt>
          <dd className="text-zinc-300">
            {srcAt ? `עודכן ${srcAt}` : "לא נמדד"}
            {size ? ` · ${size}` : ""}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <dt>קומיט-מקור</dt>
          <dd className="font-mono text-[11px] text-zinc-300">{data.source?.sha || "—"}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <dt>מנוע-סנכרון (v3 יומי)</dt>
          <dd className="text-zinc-300">
            {syncConclusion != null ? (SYNC_LABEL[syncConclusion] ?? syncConclusion) : "לא נמדד"}
            {syncAt ? ` · ${syncAt}` : ""}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <dt>ריצת-סנכרון</dt>
          <dd className="text-zinc-300">{data.sync?.runNumber != null ? `#${data.sync.runNumber}` : "—"}</dd>
        </div>
      </dl>
      <p className="border-t border-zinc-800/80 pt-2 text-[11px] leading-5 text-zinc-500">
        ארבעה עותקים: Autonomy (ציבורי) · כספת ב-saos-runtime (פרטי, מסונכרן יומית) · תג ארכיון ב-steem · מטמון-סנדבוקס
      </p>
    </div>
  );
}
