"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import {
  Flag,
  ListTree,
  Play,
  Wrench,
  ShieldAlert,
  CheckCircle2,
  XCircle,
  FileText,
  Ban,
  Sparkles,
  BrainCircuit,
  Route,
  DatabaseZap,
  Save,
} from "lucide-react";
import type { ClientRunEvent } from "@/lib/engine/event-types";
import { RiskBadge } from "./badges";
import { cn } from "@/lib/utils";

interface TimelineEntry {
  id: number;
  kind: string;
  stepId?: string;
  icon: React.ReactNode;
  title: string;
  detail?: React.ReactNode;
  tone?: "default" | "success" | "danger" | "warning";
  streaming?: boolean;
}

export function RunTimeline({ events }: { events: ClientRunEvent[] }) {
  const t = useTranslations();
  const entries = React.useMemo(
    () => foldEvents(events, t as unknown as T),
    [events, t],
  );

  if (entries.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        {t("runs.noEvents")}
      </p>
    );
  }

  return (
    <ol className="relative space-y-1 ps-2">
      {entries.map((entry) => (
        <li key={entry.id} className="relative flex gap-3 py-1.5 animate-fade-up">
          <div
            className={cn(
              "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border [&_svg]:size-3.5",
              toneClass(entry.tone),
            )}
          >
            {entry.icon}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-foreground">
                {entry.title}
              </span>
              {entry.streaming && (
                <span className="text-[10px] uppercase tracking-wide text-status-running">
                  {t("runs.streaming")}
                </span>
              )}
            </div>
            {entry.detail && (
              <div className="mt-1 text-sm text-muted-foreground">
                {entry.detail}
              </div>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

function toneClass(tone?: string) {
  switch (tone) {
    case "success":
      return "border-status-completed/50 bg-status-completed/10 text-status-completed";
    case "danger":
      return "border-status-failed/50 bg-status-failed/10 text-status-failed";
    case "warning":
      return "border-status-awaiting/50 bg-status-awaiting/10 text-status-awaiting";
    default:
      return "border-border bg-surface-raised text-muted-foreground";
  }
}

type T = (k: string, v?: Record<string, unknown>) => string;

function foldEvents(events: ClientRunEvent[], t: T): TimelineEntry[] {
  const out: TimelineEntry[] = [];
  // Accumulate deltas per step into a running text block.
  const deltaBlocks = new Map<string, TimelineEntry>();

  for (const e of events) {
    const p = (e.payload ?? {}) as Record<string, unknown>;
    switch (e.type) {
      case "model.routed": {
        const selected = (p.selected ?? {}) as Record<string, unknown>;
        out.push({
          id: e.id,
          kind: e.type,
          icon: <Route />,
          title: t("runs.timeline.modelRouted"),
          detail: `${String(selected.provider ?? "unknown")}/${String(selected.model ?? "unknown")} — ${String(p.reason ?? "no routing rationale")}`,
        });
        break;
      }
      case "memory.selected":
        out.push({
          id: e.id,
          kind: e.type,
          icon: <BrainCircuit />,
          title: t("runs.timeline.memorySelected"),
          detail: `${Number(p.selectedCount ?? 0)} selected · ${Number(p.quarantinedCount ?? 0)} quarantined`,
          tone: Number(p.quarantinedCount ?? 0) > 0 ? "warning" : "default",
        });
        break;
      case "runner.mode":
        out.push({
          id: e.id,
          kind: e.type,
          icon: <DatabaseZap />,
          title: t("runs.timeline.runnerMode"),
          detail: `${String(p.mode ?? "legacy")} · ${String(p.execution ?? p.scope ?? "declared")}`,
          tone: String(p.execution ?? "legacy") === "durable" ? "success" : "warning",
        });
        break;
      case "recovery.checkpoint":
        out.push({
          id: e.id,
          kind: e.type,
          icon: <Save />,
          title: t("runs.timeline.recoveryCheckpoint"),
          detail: p.revision === undefined ? undefined : `revision ${String(p.revision)}`,
          tone: "success",
        });
        break;
      case "run.started":
        out.push({
          id: e.id,
          kind: e.type,
          icon: <Flag />,
          title: t("runs.timeline.started", { agent: String(p.agentName ?? "Agent") }),
          detail: <span className="text-muted-foreground">{String(p.objective ?? "")}</span>,
        });
        break;
      case "plan.created": {
        const steps = (p.steps as Array<{ name: string; description: string }>) ?? [];
        out.push({
          id: e.id,
          kind: e.type,
          icon: <ListTree />,
          title: t("runs.steps") + ` (${steps.length})`,
          detail: (
            <ul className="mt-0.5 space-y-0.5">
              {steps.map((s, i) => (
                <li key={i} className="text-xs">
                  <span className="font-mono text-primary">{s.name}</span>
                  {s.description ? ` — ${s.description}` : ""}
                </li>
              ))}
            </ul>
          ),
        });
        break;
      }
      case "step.started":
        out.push({
          id: e.id,
          kind: e.type,
          stepId: String(p.stepId),
          icon: <Play />,
          title: String(p.name ?? "step"),
          detail: p.description ? String(p.description) : undefined,
        });
        break;
      case "assistant.delta": {
        const stepId = String(p.stepId);
        const key = `${stepId}`;
        const existing = deltaBlocks.get(key);
        if (existing && !isFinalized(existing)) {
          existing.detail = (existing.detail as string) + String(p.text ?? "");
        } else {
          const entry: TimelineEntry = {
            id: e.id,
            kind: "assistant.stream",
            stepId,
            icon: <Sparkles />,
            title: t("runs.streaming"),
            detail: String(p.text ?? ""),
            streaming: true,
          };
          deltaBlocks.set(key, entry);
          out.push(entry);
        }
        break;
      }
      case "assistant.message": {
        // Finalize the streaming block for this step.
        const stepId = String(p.stepId);
        const block = deltaBlocks.get(stepId);
        if (block) {
          block.streaming = false;
          block.detail = String(p.text ?? block.detail ?? "");
          block.title = "";
          markFinalized(block);
          deltaBlocks.delete(stepId);
        }
        break;
      }
      case "tool.call":
        out.push({
          id: e.id,
          kind: e.type,
          stepId: String(p.stepId),
          icon: <Wrench />,
          title: `${p.name}`,
          detail: (
            <div className="flex items-center gap-2">
              <RiskBadge risk={(p.risk as "low" | "medium" | "high") ?? "low"} />
              <code className="truncate rounded bg-surface px-1.5 py-0.5 font-mono text-[11px]">
                {JSON.stringify(p.arguments ?? {})}
              </code>
            </div>
          ),
        });
        break;
      case "tool.result": {
        const denied = p.denied === true;
        out.push({
          id: e.id,
          kind: e.type,
          stepId: String(p.stepId),
          icon: denied ? <Ban /> : <CheckCircle2 />,
          title: denied
            ? t("runs.timeline.denied")
            : t("runs.timeline.toolResult", { name: String(p.name) }),
          tone: denied ? "danger" : p.ok === false ? "warning" : "success",
          detail: (
            <code className="block max-h-24 overflow-auto rounded bg-surface px-1.5 py-1 font-mono text-[11px] text-muted-foreground">
              {truncateJson(p.result)}
            </code>
          ),
        });
        break;
      }
      case "approval.requested":
        out.push({
          id: e.id,
          kind: e.type,
          stepId: String(p.stepId),
          icon: <ShieldAlert />,
          title: t("approvals.title"),
          tone: "warning",
          detail: (
            <span>
              {String(p.toolName)} — {String(p.policyReason ?? "")}
            </span>
          ),
        });
        break;
      case "approval.resolved":
        out.push({
          id: e.id,
          kind: e.type,
          icon: p.decision === "approved" ? <CheckCircle2 /> : <XCircle />,
          title: p.decision === "approved" ? t("approvals.approved") : t("approvals.rejected"),
          tone: p.decision === "approved" ? "success" : "danger",
          detail: p.reason ? String(p.reason) : undefined,
        });
        break;
      case "step.completed":
        break; // step blocks already visible; keep timeline lean
      case "step.failed":
        out.push({
          id: e.id,
          kind: e.type,
          icon: <XCircle />,
          title: t("runs.timeline.stepFailed"),
          tone: "danger",
          detail: p.error ? String(p.error) : undefined,
        });
        break;
      case "artifact.created":
        out.push({
          id: e.id,
          kind: e.type,
          icon: <FileText />,
          title: String(p.name ?? "artifact"),
          detail: t("runs.timeline.artifactMeta", { kind: String(p.kind), bytes: Number(p.sizeBytes ?? 0) }),
        });
        break;
      case "run.completed":
        out.push({
          id: e.id,
          kind: e.type,
          icon: <CheckCircle2 />,
          title: t("runs.stage.completed"),
          tone: "success",
        });
        break;
      case "run.failed":
        out.push({
          id: e.id,
          kind: e.type,
          icon: <XCircle />,
          title: t("runs.stage.failed"),
          tone: "danger",
          detail: p.error ? String(p.error) : undefined,
        });
        break;
      case "run.cancelled":
        out.push({
          id: e.id,
          kind: e.type,
          icon: <Ban />,
          title: t("runs.stage.cancelled"),
          tone: "warning",
        });
        break;
    }
  }
  return out;
}

const FINALIZED = new WeakSet<TimelineEntry>();
function isFinalized(e: TimelineEntry) {
  return FINALIZED.has(e);
}
function markFinalized(e: TimelineEntry) {
  FINALIZED.add(e);
}

function truncateJson(value: unknown): string {
  const str = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return str.length > 600 ? str.slice(0, 600) + "…" : str;
}
