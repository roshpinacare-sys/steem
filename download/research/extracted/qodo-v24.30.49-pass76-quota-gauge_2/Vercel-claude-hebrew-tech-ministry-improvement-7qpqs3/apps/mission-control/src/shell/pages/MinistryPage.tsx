/**
 * MinistryPage — the full agent roster. Every telemetry-emitting agent in
 * PHASE_META, grouped by role, with its live activity count, last-seen time,
 * and a pulse when it is active in the current run. This is where the system's
 * real breadth becomes visible instead of hidden behind a 3D backdrop.
 */
import React, { useMemo } from "react";
import { useTelemetryCtx } from "../../context/TelemetryContext.js";
import {
  PHASE_META, CATEGORY_ORDER, CATEGORY_LABELS, phaseCategory, type PhaseCategory,
} from "../../utils/phase-meta.js";
import { UI, Panel, ScrollArea, Dot, CardGrid, SectionTitle, CATEGORY_COLOR, timeAgo } from "../ui.js";
import { pluralWord } from "../../utils/plural.js";
import { ConnectHero } from "../ConnectSurface.js";
import { TelemetryDepthNotice } from "../github/RealOps.js";
import type { PageProps } from "../PlatformShell.js";

interface AgentStat {
  phase: string;
  label: string;
  category: PhaseCategory;
  count: number;
  lastSeen: string | null;
  activeNow: boolean;
}

export function MinistryPage({ mc, navigate }: PageProps): React.ReactElement {
  const { events, currentRunId } = useTelemetryCtx();

  const stats = useMemo(() => {
    const byPhase = new Map<string, { count: number; last: number; activeNow: boolean }>();
    for (const e of events) {
      const cur = byPhase.get(e.phase) ?? { count: 0, last: 0, activeNow: false };
      cur.count++;
      const t = +new Date(e.timestamp);
      if (t > cur.last) cur.last = t;
      if (currentRunId && e.runId === currentRunId && Date.now() - t < 90_000) cur.activeNow = true;
      byPhase.set(e.phase, cur);
    }
    // Union of every registered agent + any live phase not yet registered.
    const phases = new Set<string>([...Object.keys(PHASE_META), ...byPhase.keys()]);
    const list: AgentStat[] = [...phases].map((phase) => {
      const s = byPhase.get(phase);
      return {
        phase,
        label: PHASE_META[phase]?.label ?? phase,
        category: phaseCategory(phase),
        count: s?.count ?? 0,
        lastSeen: s?.last ? new Date(s.last).toISOString() : null,
        activeNow: s?.activeNow ?? false,
      };
    });
    return list;
  }, [events, currentRunId]);

  const activeCount = stats.filter((s) => s.activeNow).length;
  const seenCount = stats.filter((s) => s.count > 0).length;

  if (mc.source === "none") {
    return <ScrollArea><ConnectHero mc={mc} navigate={navigate} /></ScrollArea>;
  }

  return (
    <ScrollArea>
      {mc.source === "github" && <TelemetryDepthNotice onSettings={() => navigate("settings")} />}
      <div style={{ display: "flex", gap: 18, marginBottom: 18, flexWrap: "wrap", color: UI.textMuted, fontSize: 13 }}>
        <span><strong style={{ color: UI.textPrimary }}>{stats.length}</strong> agents registered</span>
        <span><strong style={{ color: UI.green }}>{activeCount}</strong> active now</span>
        <span><strong style={{ color: UI.textPrimary }}>{seenCount}</strong> seen this session</span>
      </div>

      {CATEGORY_ORDER.map((cat) => {
        const group = stats.filter((s) => s.category === cat);
        if (group.length === 0) return null;
        const color = CATEGORY_COLOR[cat];
        return (
          <div key={cat} style={{ marginBottom: 22 }}>
            <SectionTitle right={<span style={{ fontSize: 11, color: UI.textMuted }}>{group.length}</span>}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <Dot color={color} size={7} /> {CATEGORY_LABELS[cat]}
              </span>
            </SectionTitle>
            <CardGrid min={200}>
              {group
                .sort((a, b) => b.count - a.count)
                .map((a) => (
                  <Panel key={a.phase} pad={14} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                      <span style={{ fontSize: 13.5, fontWeight: 600, color: UI.textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {a.label}
                      </span>
                      {a.activeNow ? <Dot color={color} glow size={8} /> : a.count > 0 ? <Dot color={color} size={7} /> : <Dot color={UI.textMuted} size={7} />}
                    </div>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                      <span style={{ fontSize: 20, fontWeight: 700, color: a.count > 0 ? color : UI.textMuted, fontVariantNumeric: "tabular-nums" }}>{a.count}</span>
                      <span style={{ fontSize: 11.5, color: UI.textMuted }}>{pluralWord(a.count, "event")}</span>
                    </div>
                    <div style={{ fontSize: 11, color: UI.textMuted }}>
                      {a.activeNow ? <span style={{ color }}>active now</span> : a.lastSeen ? `last ${timeAgo(a.lastSeen)}` : "not yet seen"}
                    </div>
                  </Panel>
                ))}
            </CardGrid>
          </div>
        );
      })}
    </ScrollArea>
  );
}
