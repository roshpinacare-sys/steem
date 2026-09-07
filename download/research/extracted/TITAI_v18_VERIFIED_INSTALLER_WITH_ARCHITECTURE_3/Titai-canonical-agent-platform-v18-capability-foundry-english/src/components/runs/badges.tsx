"use client";

import { useTranslations } from "next-intl";
import { DotBadge } from "@/components/ui/badge";
import { RUN_STATUS_META, TIER_META, RISK_META } from "@/lib/constants";
import type { RunStatus, AgentTier, RiskLevel } from "@/lib/db/schema";
import { cn } from "@/lib/utils";

export function RunStatusBadge({ status }: { status: RunStatus }) {
  const t = useTranslations();
  const meta = RUN_STATUS_META[status];
  return (
    <DotBadge
      color={meta.color}
      pulse={meta.pulse}
      label={t(`runs.stage.${meta.stageKey}`)}
    />
  );
}

export function TierBadge({ tier }: { tier: AgentTier }) {
  const t = useTranslations();
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium"
      style={{
        color: `var(--color-${TIER_META[tier].color})`,
        borderColor: `color-mix(in oklch, var(--color-${TIER_META[tier].color}) 40%, transparent)`,
        backgroundColor: `color-mix(in oklch, var(--color-${TIER_META[tier].color}) 12%, transparent)`,
      }}
    >
      {t(`agents.tiers.${tier}`)}
    </span>
  );
}

export function RiskBadge({ risk }: { risk: RiskLevel }) {
  const t = useTranslations();
  return (
    <span
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide"
      style={{
        color: `var(--color-${RISK_META[risk].color})`,
        backgroundColor: `color-mix(in oklch, var(--color-${RISK_META[risk].color}) 14%, transparent)`,
      }}
    >
      {t(`risk.${risk}`)}
    </span>
  );
}

export function TierDot({ tier, className }: { tier: AgentTier; className?: string }) {
  return (
    <span
      className={cn("size-2.5 rounded-full", className)}
      style={{ backgroundColor: `var(--color-${TIER_META[tier].color})` }}
    />
  );
}
