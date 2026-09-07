"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { useRouter, Link } from "@/i18n/navigation";
import {
  Rocket,
  Activity,
  CheckCircle2,
  TrendingUp,
  Clock,
  Cpu,
  ShieldAlert,
  ArrowRight,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/misc";
import { PageHeader } from "@/components/shell/page-header";
import { LaunchWizard } from "./launch-wizard";
import { ApprovalCard, type ApprovalView } from "@/components/runs/approval-card";
import { RunStatusBadge, TierDot } from "@/components/runs/badges";
import { StageRail } from "@/components/runs/stage-rail";
import { formatNumber, formatRelativeTime } from "@/lib/utils";
import type { Run } from "@/lib/db/schema";
import type { RunStats } from "@/lib/db/queries/runs";

interface Props {
  stats: RunStats;
  initialActive: Run[];
  initialRecent: Run[];
  hasAgents: boolean;
}

export function MissionControl({
  stats,
  initialActive,
  initialRecent,
  hasAgents,
}: Props) {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const [wizardOpen, setWizardOpen] = React.useState(false);
  const [preset, setPreset] = React.useState<{
    objective?: string;
    agentId?: string;
  }>({});

  // Auto-open via ?launch=1 (palette / rerun), optionally prefilled.
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("launch") === "1") {
      setPreset({
        objective: params.get("objective") ?? undefined,
        agentId: params.get("agent") ?? undefined,
      });
      setWizardOpen(true);
    }
  }, []);

  const { data: activeData } = useQuery({
    queryKey: ["active-runs"],
    queryFn: async () => (await fetch("/api/runs")).json(),
    refetchInterval: 4000,
    initialData: { runs: [...initialActive, ...initialRecent] },
  });
  const allRuns: Run[] = activeData?.runs ?? [];
  const active = allRuns.filter((r) =>
    ["queued", "running", "awaiting_approval"].includes(r.status),
  );
  const recent = allRuns
    .filter((r) => ["completed", "failed", "cancelled"].includes(r.status))
    .slice(0, 4);

  const { data: approvalsData } = useQuery({
    queryKey: ["pending-approvals"],
    queryFn: async () => (await fetch("/api/approvals")).json(),
    refetchInterval: 4000,
  });
  const approvals: ApprovalView[] = approvalsData?.approvals ?? [];

  return (
    <>
      <PageHeader
        title={t("missionControl.title")}
        subtitle={t("missionControl.subtitle")}
        action={
          <Button onClick={() => setWizardOpen(true)}>
            <Rocket className="size-4" />
            {t("missionControl.launchRun")}
          </Button>
        }
      />

      {!hasAgents ? (
        <EmptyState
          icon={<Rocket />}
          title={t("missionControl.startFirst")}
          description={t("missionControl.startFirstHint")}
          action={
            <div className="flex flex-col items-center gap-2 sm:flex-row">
              <StarterTeamButton />
              <Button variant="outline" onClick={() => router.push("/agents?new=1")}>
                {t("agents.create")}
              </Button>
            </div>
          }
        />
      ) : (
        <div className="space-y-6">
          {/* Stat strip */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat icon={<Activity />} label={t("missionControl.totalRuns")} value={stats.total} />
            <Stat icon={<TrendingUp />} label={t("missionControl.successRate")} value={`${stats.successRate}%`} />
            <Stat icon={<ShieldAlert />} label={t("missionControl.pendingApprovals")} value={approvals.length || stats.pendingApprovals} accent={approvals.length > 0} />
            <Stat icon={<Cpu />} label={t("missionControl.tokensUsed")} value={formatNumber(stats.totalTokens)} />
          </div>

          {/* Attention queue */}
          <section>
            <SectionTitle icon={<ShieldAlert className="size-4" />} title={t("missionControl.attentionQueue")} count={approvals.length} />
            {approvals.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
                {t("missionControl.attentionEmpty")}
              </p>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {approvals.map((a) => (
                  <ApprovalCard key={a.id} approval={a} compact />
                ))}
              </div>
            )}
          </section>

          {/* Active runs */}
          <section>
            <SectionTitle icon={<Activity className="size-4" />} title={t("missionControl.activeRuns")} count={active.length} />
            {active.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
                {t("missionControl.activeEmpty")}
              </p>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {active.map((run) => (
                  <ActiveRunCard key={run.id} run={run} />
                ))}
              </div>
            )}
          </section>

          {/* Recent */}
          <section>
            <div className="mb-3 flex items-center justify-between">
              <SectionTitle icon={<CheckCircle2 className="size-4" />} title={t("missionControl.recentRuns")} />
              <Link href="/runs" className="text-xs font-medium text-primary hover:underline">
                {t("common.viewAll")}
              </Link>
            </div>
            {recent.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
                {t("missionControl.recentEmpty")}
              </p>
            ) : (
              <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">
                {recent.map((run) => (
                  <Link
                    key={run.id}
                    href={`/runs/${run.id}`}
                    className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-hover"
                  >
                    <TierDot tier={run.agentTier} />
                    <span className="min-w-0 flex-1 truncate text-sm">{run.objective}</span>
                    <span className="hidden text-xs text-muted-foreground sm:inline">
                      {formatRelativeTime(run.finishedAt ?? run.createdAt, locale)}
                    </span>
                    <RunStatusBadge status={run.status} />
                    <ArrowRight className="size-4 text-subtle-foreground rtl:rotate-180" />
                  </Link>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      <LaunchWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        presetObjective={preset.objective}
        presetAgentId={preset.agentId}
      />
    </>
  );
}

function Stat({
  icon,
  label,
  value,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <Card className="p-4">
      <div className="mb-1.5 flex items-center gap-2 text-muted-foreground [&_svg]:size-4">
        {icon}
        <span className="text-xs">{label}</span>
      </div>
      <p
        className="font-display text-2xl font-bold tabular-nums"
        style={accent ? { color: "var(--color-status-awaiting)" } : undefined}
      >
        {value}
      </p>
    </Card>
  );
}

function SectionTitle({
  icon,
  title,
  count,
}: {
  icon: React.ReactNode;
  title: string;
  count?: number;
}) {
  return (
    <h2 className="mb-3 flex items-center gap-2 font-display text-sm font-semibold text-muted-foreground">
      {icon}
      {title}
      {count != null && count > 0 && (
        <span className="rounded-full bg-surface-raised px-1.5 py-0.5 text-xs tabular-nums">
          {count}
        </span>
      )}
    </h2>
  );
}

function ActiveRunCard({ run }: { run: Run }) {
  const t = useTranslations();
  const locale = useLocale();
  return (
    <Link href={`/runs/${run.id}`}>
      <Card className="p-4 transition-colors hover:bg-surface-hover">
        <div className="mb-3 flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <TierDot tier={run.agentTier} />
            <span className="text-sm font-medium">{run.agentName}</span>
          </div>
          <RunStatusBadge status={run.status} />
        </div>
        <p className="mb-3 line-clamp-2 text-sm text-muted-foreground">
          {run.objective}
        </p>
        <StageRail status={run.status} />
        <div className="mt-3 flex items-center gap-3 text-xs text-subtle-foreground">
          <span className="flex items-center gap-1">
            <Clock className="size-3" />
            {formatRelativeTime(run.startedAt ?? run.createdAt, locale)}
          </span>
          {run.dryRun && (
            <span className="text-status-awaiting">{t("runs.dryRun")}</span>
          )}
        </div>
      </Card>
    </Link>
  );
}

function StarterTeamButton() {
  const t = useTranslations();
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);

  async function create() {
    setBusy(true);
    try {
      const res = await fetch("/api/templates");
      const body = await res.json();
      const agentTemplates = (body.templates ?? []).filter(
        (x: { kind: string }) => x.kind === "agent",
      );
      for (const tpl of agentTemplates.slice(0, 2)) {
        const payload = tpl.payload as Record<string, unknown>;
        await fetch("/api/agents", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: payload.name ?? tpl.name,
            description: payload.description ?? tpl.description,
            tier: payload.tier ?? "engineering",
            systemPrompt: payload.systemPrompt,
            provider: payload.provider,
            model: payload.model,
            tools: payload.tools,
          }),
        });
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button onClick={create} disabled={busy} title={t("missionControl.starterTeamHint")}>
      <Users className="size-4" />
      {t("missionControl.starterTeam")}
    </Button>
  );
}
