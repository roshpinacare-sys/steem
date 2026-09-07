"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Play, ArrowRight } from "lucide-react";
import { EmptyState } from "@/components/ui/misc";
import { RunStatusBadge, TierDot } from "./badges";
import { formatRelativeTime, durationBetween, cn } from "@/lib/utils";
import type { Run, RunStatus } from "@/lib/db/schema";

type Filter = "all" | "active" | "completed" | "failed";

const FILTERS: { key: Filter; labelKey: string; statuses: RunStatus[] | null }[] = [
  { key: "all", labelKey: "runs.filterAll", statuses: null },
  {
    key: "active",
    labelKey: "runs.filterActive",
    statuses: ["queued", "running", "awaiting_approval"],
  },
  { key: "completed", labelKey: "runs.filterCompleted", statuses: ["completed"] },
  {
    key: "failed",
    labelKey: "runs.filterFailed",
    statuses: ["failed", "cancelled", "interrupted"],
  },
];

export function RunsList({ initial }: { initial: Run[] }) {
  const t = useTranslations();
  const locale = useLocale();
  const [filter, setFilter] = React.useState<Filter>("all");
  const { data } = useQuery({
    queryKey: ["runs-list"],
    queryFn: async () => (await fetch("/api/runs")).json(),
    initialData: { runs: initial },
    refetchInterval: 5000,
  });
  const runs: Run[] = data?.runs ?? [];

  const activeFilter = FILTERS.find((f) => f.key === filter)!;
  const visible = activeFilter.statuses
    ? runs.filter((r) => activeFilter.statuses!.includes(r.status))
    : runs;

  if (runs.length === 0) {
    return <EmptyState icon={<Play />} title={t("runs.empty")} />;
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-1.5" role="group">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            aria-pressed={filter === f.key}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              filter === f.key
                ? "border-primary bg-primary/12 text-primary"
                : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            {t(f.labelKey)}
            <span className="ms-1.5 tabular-nums opacity-60">
              {f.statuses
                ? runs.filter((r) => f.statuses!.includes(r.status)).length
                : runs.length}
            </span>
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <EmptyState icon={<Play />} title={t("runs.empty")} />
      ) : (
        <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">
          {visible.map((run) => (
            <Link
              key={run.id}
              href={`/runs/${run.id}`}
              className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-hover"
            >
              <TierDot tier={run.agentTier} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{run.objective}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {run.agentName} · {formatRelativeTime(run.createdAt, locale)}
                  {run.finishedAt && run.startedAt
                    ? ` · ${durationBetween(run.startedAt, run.finishedAt)}`
                    : ""}
                </p>
              </div>
              <RunStatusBadge status={run.status} />
              <ArrowRight className="size-4 text-subtle-foreground rtl:rotate-180" />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
