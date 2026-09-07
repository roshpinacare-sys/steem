"use client";

// ─────────────────────────────────────────────────────────────────────────────
// KnowledgeView — tabbed: discoveries / achieved / potential. One lens at a
// time (fixes the duplication complaint), plain-Hebrew line on every card.
// ─────────────────────────────────────────────────────────────────────────────

import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

import { ACHIEVED, CATEGORY_META, DISCOVERIES, POTENTIAL, TIER_META, type EvidenceTier, type KnowledgeCategory } from "./knowledge-data";

function DiscoveryCard({ d }: { d: (typeof DISCOVERIES)[number] }) {
  const tier = TIER_META[d.tier];
  return (
    <Card className="border-zinc-800 bg-zinc-900/60 transition-colors hover:border-zinc-700">
      <CardContent className="p-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-sm font-semibold text-zinc-100">{d.title}</span>
          <Badge variant="outline" className={cn("ms-auto border px-1.5 py-0 text-[9px]", tier.cls)}>
            {tier.label}
          </Badge>
          <Badge variant="outline" className="border-zinc-700 px-1.5 py-0 text-[9px] text-zinc-400">
            {CATEGORY_META[d.category].label}
          </Badge>
        </div>
        <p className="mt-1.5 text-[12.5px] font-medium leading-relaxed text-emerald-200/90">{d.plain}</p>
        <p className="mt-1.5 text-[12px] leading-relaxed text-zinc-400">{d.claim}</p>
        <div className="mt-2 flex gap-1.5 text-[10px]">
          <span className="shrink-0 text-zinc-500">איך מאמתים:</span>
          <span className="break-all font-mono text-teal-300/80" dir="ltr">{d.evidence}</span>
        </div>
      </CardContent>
    </Card>
  );
}

export function KnowledgeView() {
  const [tab, setTab] = useState<"discoveries" | "achieved" | "potential">("discoveries");
  const [filter, setFilter] = useState<KnowledgeCategory | "all">("all");

  const shown = useMemo(
    () => (filter === "all" ? DISCOVERIES : DISCOVERIES.filter((d) => d.category === filter)),
    [filter],
  );

  const tierCounts = useMemo(() => {
    const c: Record<EvidenceTier, number> = { "on-chain": 0, "proven-local": 0, empirical: 0, idea: 0 };
    for (const d of DISCOVERIES) c[d.tier] += 1;
    return c;
  }, []);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-base font-bold text-zinc-100">🧠 ידע</h1>
        <p className="text-[11px] text-zinc-500">
          {tierCounts["on-chain"]} גילויים מוכחים-על-שרשרת · {tierCounts["proven-local"]} מוכחים-מקומית · {tierCounts.empirical} אמפיריים · {tierCounts.idea} דוקטרינה
        </p>
      </div>

      <div className="flex gap-1.5">
        {(
          [
            { id: "discoveries", label: `גילויים (${DISCOVERIES.length})` },
            { id: "achieved", label: `מה הושג (${ACHIEVED.length})` },
            { id: "potential", label: `מה נוכל להשיג (${POTENTIAL.length})` },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            aria-pressed={tab === t.id}
            className={cn(
              "rounded-lg border px-3 py-1.5 text-[12px] transition-colors",
              tab === t.id
                ? "border-emerald-400/40 bg-emerald-400/10 font-semibold text-emerald-300"
                : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "discoveries" && (
        <>
          <div className="flex flex-wrap gap-1.5">
            {(["all", "identity", "networks", "infrastructure", "economy", "autonomy"] as const).map((k) => (
              <button
                key={k}
                onClick={() => setFilter(k)}
                aria-pressed={filter === k}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-[11px] transition-colors",
                  filter === k
                    ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300"
                    : "border-zinc-700 bg-zinc-900 text-zinc-400 hover:text-zinc-200",
                )}
              >
                {k === "all" ? "הכל" : CATEGORY_META[k].label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-2">
            {shown.map((d) => (
              <DiscoveryCard key={d.id} d={d} />
            ))}
          </div>
        </>
      )}

      {tab === "achieved" && (
        <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-2">
          {ACHIEVED.map((a) => (
            <Card key={a.title} className="border-emerald-900/50 bg-zinc-900/60">
              <CardContent className="p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="text-[13px] font-medium text-zinc-200">{a.title}</span>
                  <span className="font-mono text-sm font-bold text-emerald-400" dir="ltr">{a.value}</span>
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">{a.detail}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {tab === "potential" && (
        <div className="space-y-2.5">
          {POTENTIAL.sort((x, y) => x.rank - y.rank).map((p) => (
            <Card key={p.title} className="border-amber-900/50 bg-zinc-900/60">
              <CardContent className="p-4">
                <div className="flex flex-wrap items-baseline gap-x-3">
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-amber-400/10 font-mono text-[10px] font-bold text-amber-300">
                    {p.rank}
                  </span>
                  <span className="text-[13px] font-medium text-zinc-200">{p.title}</span>
                  <span className="ms-auto font-mono text-[11px] text-amber-300" dir="ltr">{p.cost}</span>
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">{p.detail}</p>
                <div className="mt-1.5 text-[11px]">
                  <span className="text-zinc-500">רווח: </span>
                  <span className="text-emerald-300/90">{p.gain}</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
