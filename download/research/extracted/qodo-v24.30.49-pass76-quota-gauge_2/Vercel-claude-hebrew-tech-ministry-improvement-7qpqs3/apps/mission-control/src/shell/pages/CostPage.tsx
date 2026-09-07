/**
 * CostPage — LLM spend and token usage, aggregated across runs and broken down
 * by model, from the pipeline's cost-summary telemetry.
 */
import React, { useMemo } from "react";
import { useTelemetryCtx } from "../../context/TelemetryContext.js";
import { aggregateCosts, listRuns, runCost } from "../../mobile/derive.js";
import { UI, Panel, ScrollArea, EmptyState, CardGrid, StatTile, SectionTitle } from "../ui.js";
import { plural } from "../../utils/plural.js";
import { MiniBar } from "./_shared.js";
import { ConnectHero } from "../ConnectSurface.js";
import { TelemetryDepthNotice } from "../github/RealOps.js";
import type { PageProps } from "../PlatformShell.js";

export function CostPage({ mc, navigate }: PageProps): React.ReactElement {
  const { events } = useTelemetryCtx();
  const agg = useMemo(() => aggregateCosts(events), [events]);
  const perRun = useMemo(() => {
    return listRuns(events)
      .map((r) => ({ run: r, cost: r.runId ? runCost(events, r.runId) : null }))
      .filter((x) => x.cost) as { run: ReturnType<typeof listRuns>[number]; cost: NonNullable<ReturnType<typeof runCost>> }[];
  }, [events]);

  if (mc.source === "none") {
    return <ScrollArea><ConnectHero mc={mc} navigate={navigate} /></ScrollArea>;
  }

  if (!agg) {
    return (
      <ScrollArea>
        {mc.source === "github" && <TelemetryDepthNotice onSettings={() => navigate("settings")} />}
        <Panel><EmptyState icon="◈" title="No cost data yet" hint="Each completed run reports a cost summary — estimated spend, token counts, and a per-model breakdown. They aggregate here." /></Panel>
      </ScrollArea>
    );
  }

  const maxModelTokens = Math.max(1, ...agg.byModel.map((m) => m.tokens));

  return (
    <ScrollArea>
      <CardGrid min={200} style={{ marginBottom: 20 }}>
        <StatTile label="Total spend" value={`$${(agg.totalCents / 100).toFixed(4)}`} accent={UI.green} sub={plural(agg.runsWithCost, "run")} />
        <StatTile label="Total tokens" value={agg.totalTokens.toLocaleString()} accent={UI.indigoLight} />
        <StatTile label="Avg / run" value={`$${(agg.totalCents / 100 / Math.max(1, agg.runsWithCost)).toFixed(4)}`} accent={UI.cyan} />
      </CardGrid>

      <div style={{ marginBottom: 20 }}>
        <SectionTitle>Usage by model</SectionTitle>
        <Panel pad={18} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {agg.byModel.map((m) => (
            <MiniBar
              key={m.model}
              label={m.model}
              value={m.tokens}
              max={maxModelTokens}
              sub={`${m.tokens.toLocaleString()} tok · $${(m.cents / 100).toFixed(4)}`}
              color={UI.purple}
            />
          ))}
        </Panel>
      </div>

      {perRun.length > 0 && (
        <div>
          <SectionTitle>By run</SectionTitle>
          <Panel pad={6}>
            {perRun.map(({ run, cost }) => (
              <div key={run.runId} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", borderBottom: `1px solid ${UI.border}` }}>
                <span style={{ fontSize: 12.5, fontFamily: "monospace", color: UI.textSecondary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "55%" }}>
                  {run.runId}
                </span>
                <span style={{ fontSize: 12.5, color: UI.textMuted }}>{cost.totalTokens.toLocaleString()} tok</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: UI.green }}>${(cost.cents / 100).toFixed(4)}</span>
              </div>
            ))}
          </Panel>
        </div>
      )}
    </ScrollArea>
  );
}
