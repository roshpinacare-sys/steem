/**
 * AutomationsPage — the agent's autonomous side. The proactive modes it can run
 * without a human in the loop, the live resume queue that feeds them, and the
 * in-browser edge-test executor that lets this device do work for a run.
 */
import React, { useCallback, useEffect, useState } from "react";
import { fetchWithTimeout } from "../../utils/fetch-timeout.js";
import { getSessionToken } from "../../utils/session.js";
import { UI, Panel, ScrollArea, CardGrid, StatTile, SectionTitle, Pill, Button, Dot, MONO } from "../ui.js";
import { ConnectHero } from "../ConnectSurface.js";
import { Icon } from "../icons.js";
import { getGitHubConfig } from "../github/config.js";
import { ghDispatchMode, ghWorkflowExists, type AgentMode } from "../github/client.js";
import type { PageProps } from "../PlatformShell.js";

interface Mode {
  name: string;
  flag: string;
  /** Workflow `mode` value + a preset objective for the dispatched run. */
  mode: AgentMode;
  objective: string;
  blurb: string;
  color: string;
}

const MODES: Mode[] = [
  { name: "Janitor", flag: "--janitor-mode", mode: "janitor", objective: "Repo hygiene sweep: find dead code, risky patterns, and missing guards; open fix PRs.", color: UI.cyan, blurb: "Scans the repo for hygiene issues and opens fix PRs — dead code, risky patterns, missing guards." },
  { name: "Darwin Engine", flag: "--evolve", mode: "evolve", objective: "Darwin engine: evolve agent prompts against past outcomes and open a PR.", color: UI.purple, blurb: "Evolves the agents' own prompts against past outcomes and opens a PR with the improvement." },
  { name: "Compliance Oracle", flag: "--compliance-mode", mode: "compliance", objective: "Compliance scan: audit the repo against compliance rules and open remediation PRs.", color: UI.amber, blurb: "Audits the repo against compliance rules and opens remediation PRs for the gaps it finds." },
  { name: "Support Discovery", flag: "--support-ticket-discovery", mode: "support", objective: "Support discovery: turn incoming tickets into prioritized objectives.", color: UI.green, blurb: "Turns incoming support tickets into prioritized objectives on the mission queue." },
  { name: "Resume Drain", flag: "--drain-trigger-queue", mode: "drain", objective: "Drain the resume queue.", color: UI.indigo, blurb: "Drains the resume queue — dispatches the runs that /qodo-proceed and webhooks enqueued (ADR-005)." },
];

interface QueueHealth { queued: number; processing: number; dead: number }

export function AutomationsPage({ mc, navigate }: PageProps): React.ReactElement {
  const [q, setQ] = useState<QueueHealth | null>(null);
  const [qErr, setQErr] = useState<string | null>(null);
  const [fired, setFired] = useState<Record<string, string>>({});
  const [wfOk, setWfOk] = useState<boolean | null>(null);

  const github = mc.source === "github";
  useEffect(() => {
    const cfg = getGitHubConfig();
    if (!cfg) { setWfOk(null); return; }
    let live = true;
    ghWorkflowExists(cfg).then((ok) => { if (live) setWfOk(ok); }).catch(() => { if (live) setWfOk(null); });
    return () => { live = false; };
  }, [mc.githubRepo]);

  const runMode = useCallback(async (m: Mode) => {
    const cfg = getGitHubConfig();
    if (!cfg) return;
    setFired((f) => ({ ...f, [m.mode]: "…dispatching" }));
    try {
      await ghDispatchMode(cfg, m.mode, m.objective);
      setFired((f) => ({ ...f, [m.mode]: "dispatched ✓" }));
    } catch (e: unknown) {
      setFired((f) => ({ ...f, [m.mode]: e instanceof Error ? e.message : "failed" }));
    }
  }, []);

  const loadQueue = useCallback(async () => {
    if (!mc.proxyUrl) { setQErr("no proxy configured"); return; }
    try {
      const token = await getSessionToken(mc.proxyUrl);
      const r = await fetchWithTimeout(`${mc.proxyUrl}/trigger-queue/health`, { headers: { "X-Qodo-Session": token } }, 15_000);
      if (!r.ok) { setQErr(`HTTP ${r.status}`); return; }
      const data = (await r.json()) as Partial<QueueHealth>;
      setQ({ queued: data.queued ?? 0, processing: data.processing ?? 0, dead: data.dead ?? 0 });
      setQErr(null);
    } catch (e: unknown) {
      setQErr(e instanceof Error ? e.message : "unreachable");
    }
  }, [mc.proxyUrl]);

  useEffect(() => {
    void loadQueue();
    const id = setInterval(loadQueue, 10_000);
    return () => clearInterval(id);
  }, [loadQueue]);

  const on = mc.edgeEnabled;

  if (mc.source === "none") {
    return <ScrollArea><ConnectHero mc={mc} navigate={navigate} /></ScrollArea>;
  }

  return (
    <ScrollArea>
      {/* Resume queue */}
      <SectionTitle right={<button onClick={loadQueue} style={{ background: "none", border: "none", color: UI.indigoLight, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>refresh</button>}>
        Resume queue
      </SectionTitle>
      {q ? (
        <CardGrid min={180} style={{ marginBottom: 22 }}>
          <StatTile label="Queued" value={q.queued} accent={q.queued ? UI.amber : UI.textMuted} sub="waiting to dispatch" />
          <StatTile label="Processing" value={q.processing} accent={q.processing ? UI.green : UI.textMuted} sub="in flight" />
          <StatTile label="Dead-letter" value={q.dead} accent={q.dead ? UI.red : UI.green} sub={q.dead ? "needs attention" : "clear"} />
        </CardGrid>
      ) : (
        <Panel style={{ marginBottom: 22 }}>
          <div style={{ fontSize: 13, color: UI.textMuted, padding: "6px 2px" }}>Resume queue health {qErr ? `unavailable — ${qErr}` : "loading…"}</div>
        </Panel>
      )}

      {/* Edge-test executor */}
      <SectionTitle>Edge-test executor</SectionTitle>
      <Panel pad={18} style={{ marginBottom: 22 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <div style={{ maxWidth: 560 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
              <span style={{ fontSize: 14, fontWeight: 700 }}>This device as a test runner</span>
              <Pill color={on ? UI.green : UI.textMuted}><Dot color={on ? UI.green : UI.textMuted} glow={on} size={7} />{on ? "Active" : "Off"}</Pill>
            </div>
            <div style={{ fontSize: 12.5, color: UI.textMuted, lineHeight: 1.5 }}>
              When active, this browser boots a WebContainer and runs the tests a live run offloads to it, reporting pass/fail back through the proxy. Only an allow-list of test commands ever runs.
            </div>
            {mc.edgeStatus && <div style={{ marginTop: 10, fontFamily: MONO, fontSize: 11.5, color: UI.textSecondary }}>{mc.edgeStatus}</div>}
          </div>
          <Button variant={on ? "ghost" : "primary"} color={on ? UI.red : UI.green} onClick={() => mc.setEdgeEnabled(!on)}>
            {on ? "Stop" : "Enable"}
          </Button>
        </div>
      </Panel>

      {/* Autonomous modes */}
      <SectionTitle>Autonomous modes</SectionTitle>
      <CardGrid min={260}>
        {MODES.map((m) => {
          const status = fired[m.mode];
          const canRun = github && wfOk === true;
          return (
            <Panel key={m.flag} pad={16} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Dot color={m.color} size={8} />
                <span style={{ fontSize: 14, fontWeight: 700 }}>{m.name}</span>
              </div>
              <div style={{ fontSize: 12.5, color: UI.textMuted, lineHeight: 1.5, flex: 1 }}>{m.blurb}</div>
              <code style={{ fontFamily: MONO, fontSize: 11.5, color: m.color, background: `${m.color}14`, border: `1px solid ${m.color}33`, borderRadius: 7, padding: "4px 8px", alignSelf: "flex-start" }}>
                cli.js {m.flag}
              </code>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2 }}>
                <Button color={m.color} disabled={!canRun || status === "…dispatching"} onClick={() => void runMode(m)}>
                  <Icon name="dispatch" size={13} /> Run in CI
                </Button>
                {status && <span style={{ fontSize: 11.5, color: status.includes("✓") ? UI.green : status === "…dispatching" ? UI.textMuted : UI.red }}>{status}</span>}
              </div>
            </Panel>
          );
        })}
      </CardGrid>
      <div style={{ fontSize: 11.5, color: UI.textMuted, marginTop: 12, lineHeight: 1.5 }}>
        {github && wfOk === true
          ? "Run in CI dispatches the real workflow with the mode flag — watch it appear on the Runs page. Needs the agent secrets configured in the repo."
          : github && wfOk === false
          ? "This repo has no agent-pipeline.yml, so these modes can't be dispatched here. The commands above are how they run in a repo that has the workflow."
          : "Connect GitHub Live to dispatch these modes. They run via workflow dispatch in CI, not from the browser; the resume queue and edge executor above are live."}
      </div>
    </ScrollArea>
  );
}
