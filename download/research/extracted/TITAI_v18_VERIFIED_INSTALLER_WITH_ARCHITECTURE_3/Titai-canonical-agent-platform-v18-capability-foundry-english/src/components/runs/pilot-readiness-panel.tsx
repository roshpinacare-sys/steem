"use client";

import { Check, CircleSlash2, KeyRound, RotateCcw, ShieldCheck, TriangleAlert } from "lucide-react";
import type { PilotRunReadiness } from "@/lib/release/pilot-run-gates";

export function PilotReadinessPanel({ readiness }: { readiness: PilotRunReadiness }) {
  return (
    <section className="pilot-proof" aria-labelledby="pilot-proof-title">
      <header className="pilot-proof__header">
        <div>
          <span className="pilot-proof__eyebrow"><KeyRound className="size-4" /> Pilot authority boundary</span>
          <h2 id="pilot-proof-title">Golden workflow readiness</h2>
          <p>Every missing or ambiguous fact blocks pilot classification. This view is derived from persisted run, approval, receipt, artifact, event, and verification evidence.</p>
        </div>
        <div className={`pilot-proof__classification ${readiness.ready ? "is-ready" : "is-blocked"}`}>
          {readiness.ready ? <ShieldCheck /> : <TriangleAlert />}
          <span>{readiness.classification}</span>
          <strong>{readiness.blockers} blocker{readiness.blockers === 1 ? "" : "s"}</strong>
        </div>
      </header>

      <ol className="pilot-proof__spine">
        {readiness.gates.map((gate, index) => (
          <li key={gate.id} className={gate.state === "pass" ? "is-pass" : "is-block"}>
            <div className="pilot-proof__marker" aria-hidden="true">
              <span>{String(index + 1).padStart(2, "0")}</span>
              {gate.state === "pass" ? <Check /> : <CircleSlash2 />}
            </div>
            <div className="pilot-proof__body">
              <div><strong>{gate.label}</strong><em>{gate.state}</em></div>
              <p>{gate.evidence}</p>
            </div>
          </li>
        ))}
      </ol>

      <footer className="pilot-proof__footer">
        <RotateCcw className="size-4" />
        <span>Re-evaluate after each approval, restart, side effect, verification decision, backup, or restore.</span>
      </footer>
    </section>
  );
}
