"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { toast } from "sonner";
import {
  Network,
  ListTree,
  ShieldCheck,
  FileText,
  Ban,
  RotateCw,
  ChevronDown,
  Cpu,
  BookmarkPlus,
  Fingerprint,
  ScanLine,
  KeyRound,
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { RunStatusBadge, TierDot } from "./badges";
import { StageRail } from "./stage-rail";
import { RunTimeline } from "./run-timeline";
import { ApprovalCard } from "./approval-card";
import { AuditChainViewer } from "./audit-viewer";
import { ArtifactViewer } from "./artifact-viewer";
import { EvidenceLedger } from "./evidence-ledger";
import { RunDossier } from "./run-dossier";
import { VerificationPanel } from "./verification-panel";
import { PilotReadinessPanel } from "./pilot-readiness-panel";
import { useRunEvents } from "@/hooks/use-run-events";
import { durationBetween, formatNumber, formatRelativeTime } from "@/lib/utils";
import type { ClientRunEvent } from "@/lib/engine/event-types";
import type { Run, RunStatus, Artifact, RiskLevel, VerificationAttestation } from "@/lib/db/schema";
import type { PilotRunReadiness } from "@/lib/release/pilot-run-gates";

const LivingCanvas = dynamic(
  () => import("@/components/canvas/living-canvas").then((m) => m.LivingCanvas),
  { ssr: false, loading: () => <div className="h-[480px] animate-pulse rounded-lg bg-surface" /> },
);

interface Props {
  run: Run;
  initialArtifacts: Artifact[];
  initialEvents: ClientRunEvent[];
  initialVerificationAttestations: VerificationAttestation[];
  initialPilotReadiness: PilotRunReadiness;
}

function deriveLiveStatus(events: ClientRunEvent[], fallback: RunStatus): RunStatus {
  let status = fallback;
  let pendingApproval = false;
  for (const e of events) {
    if (e.type === "run.started") status = "running";
    if (e.type === "approval.requested") pendingApproval = true;
    if (e.type === "approval.resolved") pendingApproval = false;
    if (e.type === "run.completed") return "completed";
    if (e.type === "run.failed") return "failed";
    if (e.type === "run.cancelled") return "cancelled";
    if (e.type === "run.interrupted") return "interrupted";
  }
  if (pendingApproval) return "awaiting_approval";
  return status;
}

export function RunDetail({ run, initialArtifacts, initialEvents, initialVerificationAttestations, initialPilotReadiness }: Props) {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const isTerminal = ["completed", "failed", "cancelled", "interrupted"].includes(
    run.status,
  );
  const { events } = useRunEvents(run.id, initialEvents, !isTerminal);
  const [tab, setTab] = React.useState("canvas");
  const [promptOpen, setPromptOpen] = React.useState(false);
  const [artifacts, setArtifacts] = React.useState(initialArtifacts);
  const [pilotReadiness, setPilotReadiness] = React.useState(initialPilotReadiness);

  const liveStatus = deriveLiveStatus(events, run.status);
  const active = ["queued", "running", "awaiting_approval"].includes(liveStatus);

  // Refresh artifacts when new ones stream in.
  const artifactEventCount = events.filter((e) => e.type === "artifact.created").length;
  React.useEffect(() => {
    if (artifactEventCount > initialArtifacts.length) {
      fetch(`/api/runs/${run.id}`)
        .then((r) => r.json())
        .then((d) => { if (d.artifacts) setArtifacts(d.artifacts); if (d.pilotReadiness) setPilotReadiness(d.pilotReadiness); })
        .catch(() => {});
    }
  }, [artifactEventCount, initialArtifacts.length, run.id]);

  // Pending approval extracted from the stream.
  const pendingApproval = React.useMemo(() => {
    const requested = new Map<string, Record<string, unknown>>();
    for (const e of events) {
      const p = (e.payload ?? {}) as Record<string, unknown>;
      if (e.type === "approval.requested") requested.set(String(p.approvalId), p);
      if (e.type === "approval.resolved") requested.delete(String(p.approvalId));
    }
    const first = [...requested.values()][0];
    if (!first) return null;
    return {
      id: String(first.approvalId),
      runId: run.id,
      toolName: String(first.toolName),
      riskLevel: (first.risk as RiskLevel) ?? "high",
      revision: Number(first.revision ?? 0),
      requestPayload: {
        arguments: (first.arguments as Record<string, unknown>) ?? {},
        policyReason: first.policyReason as string | undefined,
      },
    };
  }, [events, run.id]);

  const promptSnapshot = React.useMemo(() => {
    const started = events.find((e) => e.type === "run.started");
    return (started?.payload as { systemPrompt?: string } | undefined)?.systemPrompt;
  }, [events]);

  // Live token usage: prefer the run.completed event payload, fall back to the row.
  const tokenUsage = React.useMemo(() => {
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i].type === "run.completed" || events[i].type === "run.failed") {
        const usage = (events[i].payload as { tokenUsage?: { input: number; output: number } })
          ?.tokenUsage;
        if (usage) return usage;
      }
    }
    return run.tokenUsage;
  }, [events, run.tokenUsage]);
  const totalTokens = (tokenUsage?.input ?? 0) + (tokenUsage?.output ?? 0);

  const [savingTemplate, setSavingTemplate] = React.useState(false);
  async function saveAsTemplate() {
    setSavingTemplate(true);
    const res = await fetch("/api/templates", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "objective",
        name: run.objective.length > 48 ? run.objective.slice(0, 47) + "…" : run.objective,
        description: run.objective,
        payload: { objective: run.objective, suggestedAgentId: run.agentId },
      }),
    });
    setSavingTemplate(false);
    if (res.ok) toast.success(t("library.savedAsTemplate"));
    else toast.error(t("errors.generic"));
  }

  function rerun() {
    const params = new URLSearchParams({
      launch: "1",
      objective: run.objective,
    });
    if (run.agentId) params.set("agent", run.agentId);
    router.push(`/?${params.toString()}`);
  }

  async function cancel() {
    const res = await fetch(`/api/runs/${run.id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success(t("runs.cancelled"));
      router.refresh();
    }
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-5">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <TierDot tier={run.agentTier} />
          <span className="text-sm font-medium">{run.agentName}</span>
          <RunStatusBadge status={liveStatus} />
          <span className="text-xs text-muted-foreground">
            {formatRelativeTime(run.createdAt, locale)}
          </span>
          {run.finishedAt && run.startedAt && (
            <span className="text-xs text-subtle-foreground">
              · {durationBetween(run.startedAt, run.finishedAt)}
            </span>
          )}
          {totalTokens > 0 && (
            <span
              className="flex items-center gap-1 text-xs text-subtle-foreground"
              title={`${tokenUsage.input} in / ${tokenUsage.output} out`}
            >
              <Cpu className="size-3" />
              {formatNumber(totalTokens)} {t("common.tokens").toLowerCase()}
            </span>
          )}
          <div className="ms-auto flex gap-2">
            {active && (
              <Button size="sm" variant="outline" onClick={cancel}>
                <Ban className="size-4" />
                {t("runs.cancel")}
              </Button>
            )}
            {isTerminal && (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={saveAsTemplate}
                  disabled={savingTemplate}
                  title={t("library.saveAsTemplate")}
                >
                  <BookmarkPlus className="size-4" />
                  <span className="hidden sm:inline">{t("library.saveAsTemplate")}</span>
                </Button>
                <Button size="sm" variant="secondary" onClick={rerun}>
                  <RotateCw className="size-4" />
                  {t("runs.rerun")}
                </Button>
              </>
            )}
          </div>
        </div>
        <h1 className="font-display text-xl font-semibold leading-snug text-foreground">
          {run.objective}
        </h1>
        <div className="mt-3 max-w-lg">
          <StageRail status={liveStatus} />
        </div>

        {promptSnapshot && (
          <div className="mt-3">
            <button
              onClick={() => setPromptOpen((v) => !v)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <ChevronDown className={`size-3.5 transition-transform ${promptOpen ? "rotate-180" : ""}`} />
              {t("runs.promptSnapshot")}
            </button>
            {promptOpen && (
              <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-surface p-3 font-mono text-xs text-muted-foreground">
                {promptSnapshot}
              </pre>
            )}
          </div>
        )}
      </div>

      {pendingApproval && (
        <div className="mb-5">
          <ApprovalCard approval={pendingApproval} />
        </div>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="canvas">
            <Network className="size-4" />
            {t("runs.tabCanvas")}
          </TabsTrigger>
          <TabsTrigger value="timeline">
            <ListTree className="size-4" />
            {t("runs.tabTimeline")}
          </TabsTrigger>
          <TabsTrigger value="audit">
            <ShieldCheck className="size-4" />
            {t("runs.tabAudit")}
          </TabsTrigger>
          <TabsTrigger value="dossier">
            <ScanLine className="size-4" />
            {t("runs.tabDossier")}
          </TabsTrigger>
          <TabsTrigger value="evidence">
            <Fingerprint className="size-4" />
            {t("runs.tabEvidence")}
          </TabsTrigger>
          <TabsTrigger value="verification">
            <ShieldCheck className="size-4" />
            Verification
          </TabsTrigger>
          <TabsTrigger value="pilot">
            <KeyRound className="size-4" />
            Pilot
            {pilotReadiness.blockers > 0 && <span className="ms-1 rounded-full bg-destructive/10 px-1.5 text-[10px] text-destructive">{pilotReadiness.blockers}</span>}
          </TabsTrigger>
          <TabsTrigger value="artifacts">
            <FileText className="size-4" />
            {t("runs.tabArtifacts")}
            {artifacts.length > 0 && (
              <span className="ms-1 rounded-full bg-surface-raised px-1.5 text-[10px]">
                {artifacts.length}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="canvas">
          <LivingCanvas events={events} />
        </TabsContent>
        <TabsContent value="timeline">
          <RunTimeline events={events} />
        </TabsContent>
        <TabsContent value="audit">
          <AuditChainViewer />
        </TabsContent>
        <TabsContent value="dossier">
          <RunDossier run={run} events={events} />
        </TabsContent>
        <TabsContent value="evidence">
          <EvidenceLedger events={events} />
        </TabsContent>
        <TabsContent value="verification">
          <VerificationPanel runId={run.id} initialAttestations={initialVerificationAttestations} />
        </TabsContent>
        <TabsContent value="pilot">
          <PilotReadinessPanel readiness={pilotReadiness} />
        </TabsContent>
        <TabsContent value="artifacts">
          <ArtifactViewer artifacts={artifacts} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
