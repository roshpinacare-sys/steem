/**
 * SettingsPage — connection, autonomy, data cadence, and about. Real controls:
 * the proxy URL is a device-local override (localStorage), the poll interval
 * feeds TelemetryContext, and the mentor toggle mirrors the top bar.
 */
import React, { useState } from "react";
import { getProxyUrl, setProxyUrl, isBuildTimeUrl, probeProxy } from "../../utils/proxy-config.js";
import { useTelemetryCtx } from "../../context/TelemetryContext.js";
import { UI, Panel, ScrollArea, SectionTitle, Button, Pill, FONT, MONO } from "../ui.js";
import { GitHubConnectCard } from "../ConnectSurface.js";
import { LlmProvidersPanel } from "../llm/LlmProvidersPanel.js";
import { downloadBlob } from "../download.js";
import { encodeSetup, decodeSetup } from "../../utils/setup-code.js";
import { getGitHubConfig, setGitHubRepo } from "../github/config.js";
import type { PageProps } from "../PlatformShell.js";

const POLL_KEY = "qodo:poll-ms";
const POLL_OPTIONS = [
  { label: "Fast · 3s", ms: 3000 },
  { label: "Normal · 10s", ms: 10000 },
  { label: "Relaxed · 30s", ms: 30000 },
];

function currentPoll(): number {
  try {
    const v = Number(window.localStorage.getItem(POLL_KEY));
    return Number.isFinite(v) && v >= 1000 ? v : 3000;
  } catch {
    return 3000;
  }
}

export function SettingsPage({ mc }: PageProps): React.ReactElement {
  const { events } = useTelemetryCtx();
  const [url, setUrl] = useState(getProxyUrl());
  const [probe, setProbe] = useState<{ state: "idle" | "checking" | "ok" | "err"; msg?: string }>({ state: "idle" });
  const [poll, setPoll] = useState(currentPoll());
  const [copied, setCopied] = useState(false);

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(events, null, 2)], { type: "application/json" });
    downloadBlob(`qodo-events-${new Date().toISOString().slice(0, 10)}.json`, blob);
  };

  const copyJson = () => {
    navigator.clipboard?.writeText(JSON.stringify(events, null, 2)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  };

  async function connect() {
    setProbe({ state: "checking" });
    setProxyUrl(url);
    const r = await probeProxy(url);
    setProbe(r.ok ? { state: "ok" } : { state: "err", msg: r.error });
  }

  function choosePoll(ms: number) {
    setPoll(ms);
    try { window.localStorage.setItem(POLL_KEY, String(ms)); } catch { /* ignore */ }
  }

  const input: React.CSSProperties = {
    flex: 1, minWidth: 0, padding: "10px 12px", borderRadius: 10, fontFamily: FONT, fontSize: 13,
    background: UI.bgElevated, border: `1px solid ${UI.borderStrong}`, color: UI.textPrimary, outline: "none",
  };

  return (
    <ScrollArea style={{ maxWidth: 760 }}>
      <SectionTitle>Data source</SectionTitle>
      <Panel pad={18} style={{ marginBottom: 22 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div style={{ fontSize: 13, color: UI.textSecondary, maxWidth: 460, lineHeight: 1.5 }}>
            {mc.source === "simulator" && <><strong>Simulator</strong> — a labeled local sandbox for exploring the UI. Nothing here is your real data.</>}
            {mc.source === "github" && <><strong>Live · GitHub</strong> — real workflow runs, commits, and pull requests from <span style={{ fontFamily: "monospace" }}>{mc.githubRepo}</span>; New task dispatches a real agent run.</>}
            {mc.source === "proxy" && <><strong>Live · Proxy</strong> — deep agent telemetry and dispatch through your authenticated proxy.</>}
            {mc.source === "none" && <><strong>Not connected</strong> — connect GitHub below (one token) or a telemetry proxy to run on real data.</>}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <div style={{ display: "flex", gap: 4, padding: 4, borderRadius: 10, background: UI.bgElevated, border: `1px solid ${UI.border}` }}>
              {([["live", "Live", UI.green], ["sim", "Simulator", UI.purple]] as const).map(([k, label, c]) => {
                const on = k === "sim" ? mc.demoMode : !mc.demoMode;
                return (
                  <button key={k} onClick={() => mc.setDemoMode(k === "sim")} style={{
                    padding: "7px 14px", borderRadius: 7, border: `1px solid ${on ? `${c}44` : "transparent"}`, cursor: "pointer",
                    fontFamily: FONT, fontSize: 12.5, fontWeight: 600, color: on ? c : UI.textMuted, background: on ? `${c}1e` : "transparent" }}>
                    {label}
                  </button>
                );
              })}
            </div>
            {mc.demoMode && <Button onClick={mc.resetDemo}>Reset simulator</Button>}
          </div>
        </div>
      </Panel>

      <SectionTitle>GitHub · Live</SectionTitle>
      <div style={{ marginBottom: 22 }}>
        <GitHubConnectCard />
      </div>

      <SectionTitle>Team setup</SectionTitle>
      <TeamSetupPanel />

      <LlmProvidersPanel />

      <SectionTitle>Telemetry proxy</SectionTitle>
      <Panel pad={18} style={{ marginBottom: 22 }}>
        <div style={{ fontSize: 12.5, color: UI.textMuted, marginBottom: 10 }}>
          Telemetry proxy URL. Stored on this device only; overrides any build-time default.
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input style={input} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://your-proxy.workers.dev" spellCheck={false} />
          <Button variant="primary" onClick={connect} disabled={probe.state === "checking"}>
            {probe.state === "checking" ? "Checking…" : "Connect"}
          </Button>
        </div>
        <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {probe.state === "ok" && <Pill color={UI.green}>Reachable ✓</Pill>}
          {probe.state === "err" && <Pill color={UI.red}>Unreachable — {probe.msg}</Pill>}
          {isBuildTimeUrl() && <Pill color={UI.textMuted}>using build-time default</Pill>}
          {!getProxyUrl() && <Pill color={UI.amber}>not configured</Pill>}
        </div>
      </Panel>

      <SectionTitle>Autonomy</SectionTitle>
      <Panel pad={18} style={{ marginBottom: 22 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div style={{ fontSize: 13, color: UI.textSecondary, maxWidth: 460, lineHeight: 1.5 }}>
            <strong>{mc.mentorMode === "mentor" ? "Mentor" : "Full Auto"}</strong> —{" "}
            {mc.mentorMode === "mentor"
              ? "each change pauses for your approval before the Ghost Commit."
              : "the agent commits, canaries, and merges without pausing (gates and guards still apply)."}
          </div>
          <div style={{ display: "flex", gap: 4, padding: 4, borderRadius: 10, background: UI.bgElevated, border: `1px solid ${UI.border}` }}>
            {(["auto", "mentor"] as const).map((m) => {
              const on = mc.mentorMode === m;
              const c = m === "auto" ? UI.green : UI.amber;
              return (
                <button key={m} onClick={() => mc.setMentorMode(m)} style={{
                  padding: "7px 14px", borderRadius: 7, border: `1px solid ${on ? `${c}44` : "transparent"}`, cursor: "pointer",
                  fontFamily: FONT, fontSize: 12.5, fontWeight: 600, color: on ? c : UI.textMuted, background: on ? `${c}1e` : "transparent",
                }}>
                  {m === "auto" ? "Full Auto" : "Mentor"}
                </button>
              );
            })}
          </div>
        </div>
      </Panel>

      <SectionTitle>Data</SectionTitle>
      <Panel pad={18} style={{ marginBottom: 22 }}>
        <div style={{ fontSize: 12.5, color: UI.textMuted, marginBottom: 10 }}>Telemetry poll interval</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {POLL_OPTIONS.map((o) => {
            const on = poll === o.ms;
            return (
              <button key={o.ms} onClick={() => choosePoll(o.ms)} style={{
                padding: "8px 14px", borderRadius: 9, cursor: "pointer", fontFamily: FONT, fontSize: 12.5, fontWeight: 600,
                color: on ? UI.indigoLight : UI.textMuted, background: on ? UI.bgActive : "transparent",
                border: `1px solid ${on ? "rgba(99,102,241,0.4)" : UI.border}`,
              }}>
                {o.label}
              </button>
            );
          })}
        </div>
        <div style={{ height: 1, background: UI.border, margin: "16px 0" }} />
        <div style={{ fontSize: 12.5, color: UI.textMuted, marginBottom: 10 }}>
          Export telemetry — {events.length.toLocaleString()} event{events.length === 1 ? "" : "s"} in this session
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <Button onClick={exportJson}>Download JSON</Button>
          <Button onClick={copyJson}>{copied ? "Copied ✓" : "Copy JSON"}</Button>
        </div>
      </Panel>

      <SectionTitle>About</SectionTitle>
      <Panel pad={18}>
        <div style={{ fontSize: 13, color: UI.textSecondary, lineHeight: 1.6 }}>
          <strong>Qodo V24 · Mission Control</strong> — the command surface for a self-healing autonomous
          delivery agent: a nine-phase pipeline, a five-gate validator, a ministry of 27+ agents,
          a trust ledger, and repo-owned policy. This dashboard reads live telemetry through the authenticated
          proxy; no upstream credentials ever reach the browser.
        </div>
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${UI.border}`, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <Pill color={UI.textMuted}>version {APP_VERSION}</Pill>
          <span style={{ fontSize: 11.5, color: UI.textMuted }}>Include this build number when reporting an issue.</span>
        </div>
      </Panel>
    </ScrollArea>
  );
}

/** The build version, stamped at compile time from package.json by Vite. */
const APP_VERSION = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev";

/**
 * TeamSetupPanel — share this device's non-secret setup (repo, branch, proxy)
 * as a code a teammate imports, and import a teammate's code to pre-select the
 * same repo/branch and proxy. Tokens and LLM keys are never part of a code, so
 * everyone still signs in with their own credentials.
 */
function TeamSetupPanel(): React.ReactElement {
  const [importCode, setImportCode] = useState("");
  const [copied, setCopied] = useState(false);
  const [applied, setApplied] = useState<string | null>(null);
  const [importErr, setImportErr] = useState<string | null>(null);

  const cfg = getGitHubConfig();
  const pref = cfg ? { repo: `${cfg.owner}/${cfg.repo}`, branch: cfg.branch } : {};
  const myCode = encodeSetup({ ...pref, proxy: getProxyUrl() });

  const share = () => {
    if (!myCode) return;
    navigator.clipboard?.writeText(myCode).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  };

  const doImport = () => {
    setImportErr(null); setApplied(null);
    const setup = decodeSetup(importCode);
    if (!setup) { setImportErr("That doesn't look like a valid setup code."); return; }
    const parts: string[] = [];
    if (setup.proxy) { setProxyUrl(setup.proxy); parts.push("proxy"); }
    if (setup.repo) { setGitHubRepo(setup.repo, setup.branch || "main"); parts.push(`${setup.repo}${setup.branch ? ` · ${setup.branch}` : ""}`); }
    setApplied(parts.length ? `Applied: ${parts.join(" · ")}. Sign in with your GitHub token to connect.` : "Nothing to apply.");
    setImportCode("");
  };

  const box: React.CSSProperties = {
    width: "100%", boxSizing: "border-box", padding: "10px 12px", borderRadius: 10, fontFamily: MONO, fontSize: 12.5,
    background: UI.bgElevated, border: `1px solid ${UI.borderStrong}`, color: UI.textPrimary, outline: "none",
  };

  return (
    <Panel pad={18} style={{ marginBottom: 22, display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <div style={{ fontSize: 12.5, color: UI.textMuted, marginBottom: 8, lineHeight: 1.5 }}>
          Share your setup — repo, branch, and proxy only. <strong style={{ color: UI.textSecondary }}>No tokens or keys</strong> are ever included.
        </div>
        {myCode ? (
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <code style={{ ...box, flex: 1, minWidth: 200, overflowX: "auto", whiteSpace: "nowrap" }}>{myCode}</code>
            <Button variant="primary" onClick={share}>{copied ? "Copied ✓" : "Copy code"}</Button>
          </div>
        ) : (
          <div style={{ fontSize: 12, color: UI.textMuted }}>Connect a repository or a proxy first — then a shareable code appears here.</div>
        )}
      </div>

      <div style={{ height: 1, background: UI.border }} />

      <div>
        <div style={{ fontSize: 12.5, color: UI.textMuted, marginBottom: 8 }}>Import a teammate's setup code</div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input value={importCode} onChange={(e) => setImportCode(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") doImport(); }}
            placeholder="qodo1:…" spellCheck={false} autoComplete="off" style={{ ...box, flex: 1, minWidth: 200 }} />
          <Button onClick={doImport} disabled={!importCode.trim()}>Apply</Button>
        </div>
        {applied && <div style={{ fontSize: 12, color: UI.green, marginTop: 8, lineHeight: 1.5 }}>{applied}</div>}
        {importErr && <div role="alert" style={{ fontSize: 12, color: UI.red, marginTop: 8 }}>{importErr}</div>}
      </div>
    </Panel>
  );
}
