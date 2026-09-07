"use client";

import { useTranslations } from "next-intl";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RunStatus } from "@/lib/db/schema";

const STAGES: { key: string; reached: (s: RunStatus) => boolean; active: (s: RunStatus) => boolean }[] = [
  {
    key: "queued",
    reached: () => true,
    active: (s) => s === "queued",
  },
  {
    key: "planning",
    reached: (s) => !["queued"].includes(s),
    active: () => false,
  },
  {
    key: "running",
    reached: (s) => !["queued"].includes(s),
    active: (s) => s === "running",
  },
  {
    key: "awaiting",
    reached: (s) => ["awaiting_approval", "completed", "failed"].includes(s),
    active: (s) => s === "awaiting_approval",
  },
  {
    key: "completed",
    reached: (s) => ["completed", "failed", "cancelled", "interrupted"].includes(s),
    active: (s) => ["completed", "failed", "cancelled", "interrupted"].includes(s),
  },
];

export function StageRail({ status }: { status: RunStatus }) {
  const t = useTranslations();
  const isFailed = ["failed", "cancelled", "interrupted"].includes(status);

  return (
    <div className="flex items-center gap-1">
      {STAGES.map((stage, i) => {
        const reached = stage.reached(status);
        const active = stage.active(status);
        const color = isFailed && stage.key === "completed"
          ? "var(--color-status-failed)"
          : active
            ? "var(--color-status-running)"
            : reached
              ? "var(--color-status-completed)"
              : "var(--color-border-strong)";
        return (
          <div key={stage.key} className="flex flex-1 items-center gap-1">
            <div
              className={cn(
                "flex size-4 shrink-0 items-center justify-center rounded-full text-[9px]",
                active && "animate-pulse",
              )}
              style={{ backgroundColor: reached ? color : "transparent", border: `1px solid ${color}` }}
              title={t(`runs.stage.${stage.key}`)}
            >
              {reached && !active && <Check className="size-2.5 text-background" />}
            </div>
            {i < STAGES.length - 1 && (
              <div className="h-px flex-1" style={{ backgroundColor: reached ? color : "var(--color-border)" }} />
            )}
          </div>
        );
      })}
    </div>
  );
}
