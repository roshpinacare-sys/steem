"use client";

import * as React from "react";
import {
  Activity,
  AlertTriangle,
  Check,
  CircleDot,
  FileCheck2,
  Fingerprint,
  GitCommitHorizontal,
  Hand,
  ShieldCheck,
  Wrench,
  Route,
} from "lucide-react";
import type { ClientRunEvent } from "@/lib/engine/event-types";
import { summarizeRunEvidence } from "@/lib/engine/evidence-summary";
import { cn } from "@/lib/utils";

export function EvidenceLedger({ events }: { events: ClientRunEvent[] }) {
  const summary = React.useMemo(() => summarizeRunEvidence(events), [events]);
  const tone = evidenceTone(summary.state);

  return (
    <section aria-labelledby="evidence-ledger-title" className="evidence-ledger">
      <header className="evidence-ledger__header">
        <div>
          <div className="evidence-ledger__eyebrow">
            <Fingerprint aria-hidden="true" className="size-3.5" />
            Execution proof surface
          </div>
          <h2 id="evidence-ledger-title" className="evidence-ledger__title">
            Evidence Ledger
          </h2>
          <p className="evidence-ledger__description">
            Structural reconstructability, human authority, and unresolved proof gaps derived
            directly from the append-only run event stream. This is not a semantic quality score.
          </p>
        </div>
        <div className={cn("evidence-seal", tone.className)}>
          <span className="evidence-seal__value">{summary.coverage}</span>
          <span className="evidence-seal__unit">%</span>
          <span className="evidence-seal__label">structural coverage</span>
        </div>
      </header>

      <div className="evidence-spine" role="list" aria-label="Execution evidence signals">
        <Signal
          icon={<GitCommitHorizontal />}
          label="Event continuity"
          value={summary.sequenceIntegrity ? "Continuous" : "Broken"}
          detail={`${summary.eventCount} persisted events`}
          state={summary.sequenceIntegrity ? "good" : "danger"}
        />
        <Signal
          icon={<Activity />}
          label="Plan execution"
          value={`${summary.completedSteps}/${summary.plannedSteps}`}
          detail={
            summary.failedSteps > 0
              ? `${summary.failedSteps} failed step${summary.failedSteps === 1 ? "" : "s"}`
              : "No failed steps recorded"
          }
          state={
            summary.failedSteps > 0
              ? "danger"
              : summary.completedSteps === summary.plannedSteps && summary.plannedSteps > 0
                ? "good"
                : "neutral"
          }
        />
        <Signal
          icon={<Wrench />}
          label="Tool accountability"
          value={`${summary.resolvedToolCalls}/${summary.toolCalls}`}
          detail="Every side-effect request requires a matching result event"
          state={summary.resolvedToolCalls === summary.toolCalls ? "good" : "danger"}
        />
        <Signal
          icon={<Hand />}
          label="Human authority"
          value={`${summary.approvalsResolved}/${summary.approvalsRequested}`}
          detail="Requested decisions with an explicit resolution"
          state={
            summary.approvalsResolved === summary.approvalsRequested
              ? "good"
              : "warning"
          }
        />
        <Signal
          icon={<Route />}
          label="Control provenance"
          value={`${Number(summary.modelRoutingRecorded) + Number(summary.governedMemoryRecorded) + Number(summary.runnerModeRecorded)}/3`}
          detail="Model route, memory policy, and runner mode declarations"
          state={summary.modelRoutingRecorded && summary.governedMemoryRecorded && summary.runnerModeRecorded ? "good" : "warning"}
        />
        <Signal
          icon={<FileCheck2 />}
          label="Produced evidence"
          value={String(summary.artifactsCreated)}
          detail="Artifacts linked to this run"
          state={summary.artifactsCreated > 0 ? "good" : "neutral"}
        />
        <Signal
          icon={<ShieldCheck />}
          label="Reconstructability"
          value={summary.reconstructable ? "Ready" : "At risk"}
          detail="Can an operator explain the run from persisted evidence alone?"
          state={summary.reconstructable ? "good" : "danger"}
        />
      </div>

      <div className="evidence-verification-note">
        <CircleDot aria-hidden="true" className="size-4" />
        <div>
          <strong>Implementation evidence is not independent verification.</strong>
          <p>
            This view proves event coverage only. A separate verifier role must
            challenge the requirements, output, and raw evidence before a canonical
            task can be marked verified.
          </p>
        </div>
      </div>

      <div className="evidence-gaps" aria-live="polite">
        <div className="evidence-gaps__heading">
          <AlertTriangle aria-hidden="true" className="size-4" />
          Open proof gaps
          <span>{summary.gaps.length}</span>
        </div>
        {summary.gaps.length === 0 ? (
          <div className="evidence-gaps__clear">
            <Check aria-hidden="true" className="size-4" />
            No structural evidence gaps detected in the current event stream.
          </div>
        ) : (
          <ol className="evidence-gaps__list">
            {summary.gaps.map((gap, index) => (
              <li key={`${gap.code}-${gap.eventId ?? index}`}>
                <span className={`evidence-gap evidence-gap--${gap.severity}`}>
                  {gap.severity}
                </span>
                <div>
                  <code>{gap.code}</code>
                  <p>{gap.message}</p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

function Signal({
  icon,
  label,
  value,
  detail,
  state,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string;
  state: "good" | "warning" | "danger" | "neutral";
}) {
  return (
    <div className={`evidence-signal evidence-signal--${state}`} role="listitem">
      <div className="evidence-signal__glyph" aria-hidden="true">
        {icon}
      </div>
      <div className="evidence-signal__copy">
        <span>{label}</span>
        <p>{detail}</p>
      </div>
      <strong>{value}</strong>
    </div>
  );
}

function evidenceTone(state: ReturnType<typeof summarizeRunEvidence>["state"]) {
  switch (state) {
    case "evidence_complete":
      return { className: "evidence-seal--good" };
    case "failed":
    case "evidence_incomplete":
      return { className: "evidence-seal--danger" };
    case "cancelled":
    case "interrupted":
      return { className: "evidence-seal--warning" };
    default:
      return { className: "evidence-seal--live" };
  }
}
