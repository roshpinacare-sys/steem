"use client";

import { useSaosNet } from "./api";
import { Badge } from "@/components/ui/badge";

/**
 * WeaveView — the weave console (W1–W3).
 *
 * 96-honesty-note: the original weave-view was removed in THE LOOM merge and
 * shell.tsx kept importing it (broken build). This restores a minimal, honest
 * view: kernel weave-ops (stamp/seal/witness) status from the node state, with
 * no fabricated data — anything not surfaced by the API is stated as such.
 */
export function WeaveView() {
  const sn = useSaosNet(true);
  const height = sn?.node?.height ?? 0;
  const blocks = sn?.blocks ?? [];
  const lastBlock = blocks[blocks.length - 1] ?? null;

  return (
    <div className="space-y-2 p-1" dir="rtl">
      <div className="rounded-lg border border-amber-400/25 bg-amber-400/[0.04] p-3">
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <span className="text-sm">🧵</span>
          <span className="font-bold text-zinc-100">THE WEAVE — רשת-האמת (W1–W3)</span>
          <Badge variant="outline" className="border-amber-400/40 bg-amber-400/10 px-2 py-0 font-mono text-[9px] text-amber-300">
            kernel ops: stamp · seal · witness
          </Badge>
        </div>
        <div className="mt-1.5 space-y-1 text-[10px] leading-relaxed text-zinc-300">
          <p>
            <span className="font-semibold text-zinc-200">חותמת-קיום (stamp):</span> hash יחיד-עולמית נרשם חי על הספר-הריבוני — leaf = sha256(canon({"{"}h, seq, kind, by, at, salt{"}"})) · הצורה קבועה-חוזה.
          </p>
          <p>
            <span className="font-semibold text-zinc-200">איטום (seal):</span> הקרנל עצמו מחשב את שורש-המרקל הקנוני מהרישומים-החיים ומשווה לשורש-הנטען — שורש-מזויף נדחה מתמטית (root-mismatch) · אחרי-האיטום הרישומים מתרוקנים וההיסטוריה = ה-block log.
          </p>
          <p>
            <span className="font-semibold text-zinc-200">עדות (witness):</span> הצהרה חתומה על claim תחת topic — dedupe לפי (topic, claimHash, validator), קוורום-ספירה בשכבת-השאילתה.
          </p>
        </div>
      </div>

      <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 text-[10px] text-zinc-300">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-zinc-200">מצב-הספר החי:</span>
          <span dir="ltr" className="font-mono text-emerald-300/80">h{height}</span>
          {lastBlock?.time && (
            <span className="text-zinc-500">
              · בלוק אחרון {relTimeSafe(lastBlock.time)}
            </span>
          )}
        </div>
        <p className="mt-1.5 text-[9px] text-zinc-500">
          כנות: מוני-איטומים והמפה-החיה של החותמות לא נחשפו עדיין ב-API הציבורי — הם נמדדים בעץ-המרקל של הקרנל (sovereign/core) ונאטמים בצ׳קפוינטים. המסך-המלא של האריגה חי בקונסולת THE LOOM (merge W4).
        </p>
      </div>
    </div>
  );
}

function relTimeSafe(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 90) return `לפני ${s} שנ׳`;
  const m = Math.round(s / 60);
  if (m < 90) return `לפני ${m} ד׳`;
  return `לפני ${Math.round(m / 60)} ש׳`;
}
