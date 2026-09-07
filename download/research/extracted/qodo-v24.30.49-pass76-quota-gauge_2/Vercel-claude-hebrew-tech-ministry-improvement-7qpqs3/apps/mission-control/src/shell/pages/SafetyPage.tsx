/**
 * SafetyPage — the guardrails protecting every run: the five validation gates,
 * Warden code guard, secret/path guards, drift guard, concept lock, and mentor
 * approvals. Surfaces the safety-category telemetry the pipeline emits.
 */
import React, { useMemo } from "react";
import { useTelemetryCtx } from "../../context/TelemetryContext.js";
import { safetyEvents } from "../../mobile/derive.js";
import { UI, Panel, ScrollArea, EmptyState, CardGrid, StatTile, SectionTitle } from "../ui.js";
import { EventRow, GateChecklistPanel } from "./_shared.js";
import { ConnectHero } from "../ConnectSurface.js";
import { TelemetryDepthNotice } from "../github/RealOps.js";
import type { PageProps } from "../PlatformShell.js";

const GATES = ["lockCheck", "blast", "dom", "shadow", "chaos", "test", "contractGuard"];

export function SafetyPage({ mc, navigate }: PageProps): React.ReactElement {
  const { events, currentRunId } = useTelemetryCtx();
  const safety = useMemo(() => safetyEvents(events, null), [events]);

  // Latest gate-evaluated result across the stream (if any).
  const gate = useMemo(() => {
    const g = [...events]
      .filter((e) => e.phase === "gate" && (e as Record<string, unknown>).results)
      .sort((a, b) => +new Date(b.timestamp) - +new Date(a.timestamp))[0] as
      | (import("../../types/telemetry.js").TelemetryEvent & { results?: Record<string, boolean>; gateOpen?: boolean })
      | undefined;
    return g ?? null;
  }, [events]);

  const blocks = safety.filter((e) => /block|reject|fail|violation|halt/i.test(e.decision ?? "")).length;
  const approvals = safety.filter((e) => e.phase === "mentor").length;

  if (mc.source === "none") {
    return <ScrollArea><ConnectHero mc={mc} navigate={navigate} /></ScrollArea>;
  }

  return (
    <ScrollArea>
      {mc.source === "github" && <TelemetryDepthNotice onSettings={() => navigate("settings")} />}
      <CardGrid min={200} style={{ marginBottom: 18 }}>
        <StatTile label="Safety events" value={safety.length} accent={UI.amber} />
        <StatTile label="Blocks / rejections" value={blocks} accent={blocks > 0 ? UI.red : UI.green} sub={blocks > 0 ? "guardrails fired" : "none — clean"} />
        <StatTile label="Mentor checkpoints" value={approvals} accent={UI.indigo} />
      </CardGrid>

      {gate && (
        <div style={{ marginBottom: 20 }}>
          <SectionTitle>Latest gate — 5-gate validator</SectionTitle>
          <Panel pad={16}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px,1fr))", gap: 10 }}>
              {GATES.map((g) => {
                const res = gate.results?.[g];
                const known = res !== undefined;
                const color = !known ? UI.textMuted : res ? UI.green : UI.red;
                return (
                  <div key={g} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }}>
                    <span style={{ color, fontWeight: 700 }}>{!known ? "○" : res ? "✓" : "✕"}</span>
                    <span style={{ color: UI.textSecondary }}>{g}</span>
                  </div>
                );
              })}
            </div>
            <div style={{ marginTop: 12, fontSize: 12.5, color: gate.gateOpen ? UI.green : UI.red, fontWeight: 600 }}>
              {gate.gateOpen ? "Gate OPEN — change cleared all validators" : "Gate CLOSED — a validator blocked the change"}
            </div>
          </Panel>
        </div>
      )}

      {currentRunId && mc.source !== "github" && (
        <div style={{ marginBottom: 20 }}>
          <SectionTitle>Gate checklist · current run</SectionTitle>
          <GateChecklistPanel events={events} runId={currentRunId} />
        </div>
      )}

      <SectionTitle>Guardrail activity</SectionTitle>
      <Panel pad={6}>
        {safety.length === 0 ? (
          <EmptyState icon="⛨" title="No safety events yet" hint="Warden, secret/path guards, drift guard, concept lock, and mentor approvals report here as runs execute." />
        ) : (
          safety.slice(0, 120).map((e, i) => <EventRow key={i} e={e} />)
        )}
      </Panel>
    </ScrollArea>
  );
}
