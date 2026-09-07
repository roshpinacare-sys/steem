"use client";

import * as React from "react";
import {
  Activity,
  BrainCircuit,
  Cpu,
  DatabaseZap,
  Fingerprint,
  Gauge,
  LockKeyhole,
  Network,
  Route,
  ShieldCheck,
  TriangleAlert,
  Wrench,
} from "lucide-react";
import type { Run } from "@/lib/db/schema";
import type { ClientRunEvent } from "@/lib/engine/event-types";
import { cn } from "@/lib/utils";

interface DossierSignal {
  label: string;
  value: string;
  detail: string;
  state: "good" | "warning" | "danger" | "neutral";
  icon: React.ReactNode;
}

export function RunDossier({ run, events }: { run: Run; events: ClientRunEvent[] }) {
  const routeEvent = findLast(events, "model.routed");
  const memoryEvent = findLast(events, "memory.selected");
  const modeEvent = findLast(events, "runner.mode");
  const toolEvents = events.filter((event) => event.type === "tool.call");
  const approvalRequests = events.filter((event) => event.type === "approval.requested");
  const approvalResolutions = events.filter((event) => event.type === "approval.resolved");
  const recoveryEvents = events.filter((event) => event.type === "recovery.checkpoint");

  const route = asRecord(routeEvent?.payload ?? run.routingDecision ?? {});
  const selected = asRecord(route.selected);
  const memory = asRecord(memoryEvent?.payload ?? {});
  const mode = asRecord(modeEvent?.payload ?? {});
  const selectedMemory = Number(memory.selectedCount ?? run.memorySnapshot?.length ?? 0);
  const quarantinedMemory = Number(memory.quarantinedCount ?? 0);
  const unresolvedApprovals = Math.max(0, approvalRequests.length - approvalResolutions.length);
  const networkTools = toolEvents.filter((event) => asRecord(asRecord(event.payload).capability).network === true).length;
  const filesystemTools = toolEvents.filter((event) => asRecord(asRecord(event.payload).capability).filesystem === true).length;
  const sideEffectTools = toolEvents.filter((event) => {
    const effect = String(asRecord(asRecord(event.payload).capability).effect ?? "unknown");
    return effect === "write" || effect === "external";
  }).length;

  const signals: DossierSignal[] = [
    {
      label: "Execution authority",
      value: String(mode.mode ?? run.runnerMode ?? "legacy"),
      detail: mode.scope ? String(mode.scope) : "Persisted runner-mode declaration",
      state: String(mode.execution ?? "legacy") === "durable" ? "good" : "warning",
      icon: <DatabaseZap />,
    },
    {
      label: "Model decision",
      value: selected.provider && selected.model
        ? `${String(selected.provider)}/${String(selected.model)}`
        : `${run.provider}/${run.model || "default"}`,
      detail: String(route.reason ?? "Direct selection; measured routing evidence is unavailable."),
      state: route.reason ? "good" : "warning",
      icon: <Route />,
    },
    {
      label: "Governed context",
      value: `${selectedMemory} selected`,
      detail: `${quarantinedMemory} quarantined · ${run.maxContextTokens.toLocaleString()} token ceiling`,
      state: quarantinedMemory > 0 ? "warning" : "good",
      icon: <BrainCircuit />,
    },
    {
      label: "Human authority",
      value: unresolvedApprovals ? `${unresolvedApprovals} unresolved` : "Resolved",
      detail: `${approvalRequests.length} approval request${approvalRequests.length === 1 ? "" : "s"}`,
      state: unresolvedApprovals ? "warning" : "good",
      icon: <LockKeyhole />,
    },
    {
      label: "Tool boundary",
      value: `${sideEffectTools} side effects`,
      detail: `${networkTools} network · ${filesystemTools} filesystem · ${toolEvents.length} total calls`,
      state: sideEffectTools > 0 && approvalRequests.length === 0 ? "warning" : "neutral",
      icon: <Wrench />,
    },
    {
      label: "Recovery evidence",
      value: recoveryEvents.length ? `${recoveryEvents.length} checkpoints` : "No checkpoint event",
      detail: run.runnerMode?.startsWith("durable")
        ? "Durable claims require persisted restart evidence."
        : "Legacy execution remains process-bound.",
      state: recoveryEvents.length ? "good" : run.runnerMode?.startsWith("durable") ? "danger" : "warning",
      icon: <Activity />,
    },
  ];

  return (
    <section className="run-dossier" aria-labelledby="run-dossier-title">
      <header className="run-dossier__masthead">
        <div>
          <div className="run-dossier__eyebrow"><Fingerprint className="size-3.5" /> Operator dossier</div>
          <h2 id="run-dossier-title">Execution control record</h2>
          <p>
            The smallest inspectable statement of who chose the model, what context entered the run,
            what authority was exercised, and which recovery claims are actually supported.
          </p>
        </div>
        <div className="run-dossier__budget" aria-label="Run budgets">
          <Gauge className="size-4" />
          <strong>{run.maxOutputTokens.toLocaleString()}</strong>
          <span>output tokens</span>
          <i aria-hidden="true" />
          <Cpu className="size-4" />
          <strong>{run.maxContextTokens.toLocaleString()}</strong>
          <span>context tokens</span>
        </div>
      </header>

      <div className="run-dossier__rail" role="list" aria-label="Run control signals">
        {signals.map((signal, index) => (
          <article key={signal.label} className={cn("run-dossier__signal", `run-dossier__signal--${signal.state}`)} role="listitem">
            <div className="run-dossier__index">{String(index + 1).padStart(2, "0")}</div>
            <div className="run-dossier__icon" aria-hidden="true">{signal.icon}</div>
            <div className="run-dossier__copy">
              <span>{signal.label}</span>
              <strong>{signal.value}</strong>
              <p>{signal.detail}</p>
            </div>
          </article>
        ))}
      </div>

      <div className="run-dossier__truth">
        <ShieldCheck className="size-4" aria-hidden="true" />
        <div>
          <strong>Authority is not inferred from model output.</strong>
          <p>Policy, ownership, approval, tool capability, and evidence remain separate control planes.</p>
        </div>
        {(run.runnerMode === "legacy" || !route.reason) && (
          <span className="run-dossier__warning"><TriangleAlert className="size-3.5" /> incomplete control evidence</span>
        )}
      </div>
    </section>
  );
}

function findLast(events: ClientRunEvent[], type: ClientRunEvent["type"]): ClientRunEvent | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index].type === type) return events[index];
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
