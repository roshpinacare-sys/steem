/**
 * PlatformShell — the Mission Control application shell, one product on every
 * surface. Desktop gets a left capability rail + dense top bar; phones get a
 * compact header, a bottom tab bar, and a slide-up nav drawer — the SAME pages
 * and data. It opens in Demo mode with no sign-in, so it's alive on first
 * launch (including inside the Android APK).
 */
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import React, { useEffect, useMemo, useState } from "react";
import { useTelemetryCtx } from "../context/TelemetryContext.js";
import { TaskComposer } from "./TaskComposer.js";
import { CommandPalette, type Command } from "./CommandPalette.js";
import { ApprovalGate } from "../components/ApprovalGate.js";
import { NAV, NAV_ITEMS, type PageId } from "./nav.js";
import { Icon } from "./icons.js";
import { UI, FONT, Dot, Button, PageLoading } from "./ui.js";
import { useMissionControl } from "./useMissionControl.js";
import { GitHubLiveProvider } from "./github/GitHubLiveContext.js";
import { AppMenu } from "./AppMenu.js";
import { ChatPage } from "./pages/ChatPage.js";
import { StudioPage } from "./pages/StudioPage.js";
import { TasksPage } from "./pages/TasksPage.js";
import { OverviewPage } from "./pages/OverviewPage.js";
import { ActivityPage } from "./pages/ActivityPage.js";
import { RunsPage } from "./pages/RunsPage.js";
import { PipelinePage } from "./pages/PipelinePage.js";
import { MinistryPage } from "./pages/MinistryPage.js";
import { SafetyPage } from "./pages/SafetyPage.js";
import { CostPage } from "./pages/CostPage.js";
import { AutomationsPage } from "./pages/AutomationsPage.js";
import { ConnectionsPage } from "./pages/ConnectionsPage.js";
import { SettingsPage } from "./pages/SettingsPage.js";

// New creator pages load on demand (NeuralCoreLazy pattern) so the initial
// bundle stays lean; the syntax highlighter inside them is itself lazy.
const FilesPageLazy = React.lazy(() => import("./pages/FilesPage.js").then((m) => ({ default: m.FilesPage })));
const ReleasesPageLazy = React.lazy(() => import("./pages/ReleasesPage.js").then((m) => ({ default: m.ReleasesPage })));
const InsightsPageLazy = React.lazy(() => import("./pages/InsightsPage.js").then((m) => ({ default: m.InsightsPage })));
const GovernancePageLazy = React.lazy(() => import("./pages/GovernancePage.js").then((m) => ({ default: m.GovernancePage })));
const DocsPageLazy = React.lazy(() => import("./pages/DocsPage.js").then((m) => ({ default: m.DocsPage })));

export interface PageProps {
  mc: ReturnType<typeof useMissionControl>;
  navigate: (p: PageId) => void;
  isMobile: boolean;
}

function useIsMobile(bp = 760): boolean {
  const [m, setM] = useState(() => typeof window !== "undefined" && window.innerWidth <= bp);
  useEffect(() => {
    const on = () => setM(window.innerWidth <= bp);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, [bp]);
  return m;
}

function connectionState(proxyUrl: string, error: string | null, lastSyncAt: number | null, loading: boolean) {
  if (!proxyUrl) return { label: "Not connected", color: UI.textMuted, glow: false };
  if (error) return { label: "Reconnecting", color: UI.amber, glow: false };
  if (lastSyncAt) return { label: "Live", color: UI.green, glow: true };
  if (loading) return { label: "Syncing", color: UI.indigo, glow: false };
  return { label: "Connecting", color: UI.indigo, glow: false };
}

/** Primary phone destinations; the rest live in the app menu + drawer. */
const MOBILE_TABS: PageId[] = ["chat", "tasks", "overview", "files"];

export function PlatformShell(): React.ReactElement {
  return (
    <GitHubLiveProvider>
      <ShellInner />
    </GitHubLiveProvider>
  );
}

function ShellInner(): React.ReactElement {
  const [page, setPageRaw] = useState<PageId>(() => {
    // Reopen on the page the operator last used (survives app close).
    try {
      const saved = window.localStorage.getItem("qodo:last-page") as PageId | null;
      if (saved && NAV_ITEMS[saved]) return saved;
    } catch { /* storage unavailable */ }
    return "chat";
  });
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const isMobile = useIsMobile();
  const mc = useMissionControl();
  const { error, lastSyncAt, loading, currentRunId } = useTelemetryCtx();

  const setPage = (p: PageId) => {
    setPageRaw(p);
    setDrawerOpen(false);
    setMenuOpen(false);
    try { window.localStorage.setItem("qodo:last-page", p); } catch { /* ignore */ }
  };

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const conn = useMemo(() => {
    switch (mc.source) {
      case "simulator": return { label: "Simulator", color: UI.purple, glow: true };
      case "github": return { label: "Live · GitHub", color: UI.green, glow: true };
      case "proxy": return connectionState(mc.proxyUrl, error, lastSyncAt, loading);
      default: return { label: "Not connected", color: UI.amber, glow: false };
    }
  }, [mc.source, mc.proxyUrl, error, lastSyncAt, loading]);

  const item = NAV_ITEMS[page];
  const props: PageProps = { mc, navigate: setPage, isMobile };

  const commands: Command[] = useMemo(() => {
    const nav: Command[] = NAV.flatMap((g) => g.items).map((n) => ({
      id: `go:${n.id}`, title: n.label, group: "Go to", icon: n.icon, keywords: n.blurb,
      run: () => setPage(n.id),
    }));
    const actions: Command[] = [
      { id: "act:chat", title: "Open Chat console", group: "Actions", icon: "chat", keywords: "chat assistant command ai talk", run: () => setPage("chat") },
      { id: "act:new-task", title: "New task", group: "Actions", icon: "dispatch", hint: "⌘K", keywords: "create dispatch run mission", run: () => mc.openComposer() },
      { id: "act:studio", title: "Open Studio", group: "Actions", icon: "studio", keywords: "code editor build preview", run: () => setPage("studio") },
      { id: "act:autonomy", title: mc.mentorMode === "mentor" ? "Switch to Full Auto" : "Switch to Mentor mode", group: "Actions", icon: "safety", keywords: "approval autonomy", run: () => mc.setMentorMode(mc.mentorMode === "mentor" ? "auto" : "mentor") },
      { id: "act:connect", title: "Connect GitHub (Live)", group: "Actions", icon: "connections", keywords: "token real live data github", run: () => setPage("connections") },
      { id: "act:mode", title: mc.demoMode ? "Turn simulator off" : "Turn simulator on", group: "Actions", icon: "automations", keywords: "sandbox simulator explore", run: () => mc.setDemoMode(!mc.demoMode) },
      { id: "act:reset", title: "Reset simulator data", group: "Actions", icon: "automations", keywords: "clear sandbox", run: () => mc.resetDemo() },
    ];
    return [...actions, ...nav];
  }, [mc]); // eslint-disable-line react-hooks/exhaustive-deps

  const pageContent = (
    <React.Suspense fallback={<PageLoading />}>
      {page === "chat" && <ChatPage {...props} />}
      {page === "studio" && <StudioPage {...props} />}
      {page === "files" && <FilesPageLazy {...props} />}
      {page === "tasks" && <TasksPage {...props} />}
      {page === "overview" && <OverviewPage {...props} />}
      {page === "activity" && <ActivityPage {...props} />}
      {page === "runs" && <RunsPage {...props} />}
      {page === "pipeline" && <PipelinePage {...props} />}
      {page === "insights" && <InsightsPageLazy {...props} />}
      {page === "ministry" && <MinistryPage {...props} />}
      {page === "safety" && <SafetyPage {...props} />}
      {page === "cost" && <CostPage {...props} />}
      {page === "automations" && <AutomationsPage {...props} />}
      {page === "governance" && <GovernancePageLazy {...props} />}
      {page === "connections" && <ConnectionsPage {...props} />}
      {page === "releases" && <ReleasesPageLazy {...props} />}
      {page === "docs" && <DocsPageLazy {...props} />}
      {page === "settings" && <SettingsPage {...props} />}
    </React.Suspense>
  );

  const feedbackStrip = (mc.dispatched || mc.dispatchError) ? (
    <div role={mc.dispatchError ? "alert" : undefined}
      style={{ padding: "8px 20px", fontSize: 12.5, display: "flex", alignItems: "center", gap: 8, borderBottom: `1px solid ${UI.border}`,
        color: mc.dispatchError ? UI.red : UI.green, background: mc.dispatchError ? "rgba(248,113,113,0.08)" : "rgba(52,211,153,0.07)" }}>
      {mc.dispatchError ? <Icon name="alert" size={14} /> : <Icon name="check" size={14} />}
      {mc.dispatchError ? mc.dispatchError : `Task launched${mc.lastRepo ? ` → ${mc.lastRepo}` : ""}. Watch it on the board.`}
    </div>
  ) : null;

  const overlays = (
    <>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} commands={commands} />
      <TaskComposer open={mc.composerOpen} busy={mc.busy} error={mc.dispatchError} onClose={mc.closeComposer}
        lockedRepo={mc.source === "github" ? mc.githubRepo : null}
        onLaunch={async (objective, repo, dryRun) => { await mc.dispatchMission(objective, repo, undefined, { dryRun }); mc.closeComposer(); setPage("tasks"); }} />
      <ApprovalGate mentorMode={mc.mentorMode === "mentor"} runId={currentRunId} dismissedAt={mc.dismissedAt} onApprove={mc.approve} onReject={mc.reject} />
      <AppMenu open={menuOpen} onClose={() => setMenuOpen(false)} page={page} navigate={setPage} mc={mc} conn={conn}
        onNewTask={mc.openComposer} onSearch={() => setPaletteOpen(true)} desktop={!isMobile} />
    </>
  );

  // ── Mobile chrome ─────────────────────────────────────────────────────────
  if (isMobile) {
    return (
      <div style={{ position: "fixed", inset: 0, display: "flex", flexDirection: "column", background: UI.bg, color: UI.textPrimary, fontFamily: FONT, overflow: "hidden", paddingLeft: "var(--sa-left)", paddingRight: "var(--sa-right)" }}>
        {/* Edge-to-edge: the header owns the status-bar zone — same surface
            color extends under the system icons, content starts below them. */}
        <header style={{ flexShrink: 0, height: "calc(56px + var(--sa-top))", paddingTop: "var(--sa-top)", boxSizing: "border-box", background: "#0B0F17", borderBottom: `1px solid ${UI.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", paddingLeft: 14, paddingRight: 14, gap: 10, zIndex: 2 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            <button onClick={() => setMenuOpen((v) => !v)} aria-label="Menu" aria-haspopup="menu" aria-expanded={menuOpen}
              style={{ display: "flex", alignItems: "center", gap: 3, background: "none", border: "none", cursor: "pointer", padding: "7px 2px 7px 0", margin: "-7px 0" }}>
              <span style={{ width: 30, height: 30, borderRadius: 8, flexShrink: 0, background: `linear-gradient(135deg, ${UI.indigo}, ${UI.purple})`, display: "grid", placeItems: "center", color: UI.textWhite }}>
                <Icon name="bolt" size={17} />
              </span>
              <span style={{ color: UI.textMuted, display: "grid", placeItems: "center", transform: menuOpen ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}>
                <Icon name="chevron" size={12} />
              </span>
            </button>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.label}</div>
              <button onClick={() => setPage("connections")} style={{ display: "flex", alignItems: "center", gap: 5, background: "none", border: "none", padding: 0, cursor: "pointer" }}>
                <Dot color={conn.color} glow={conn.glow} size={6} />
                <span style={{ fontSize: 10.5, color: UI.textMuted }}>{conn.label}</span>
              </button>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
            <button onClick={() => setPaletteOpen(true)} aria-label="Search" style={iconBtn}><Icon name="command" size={17} /></button>
            <button onClick={mc.openComposer} aria-label="New task" style={{ ...iconBtn, background: UI.indigo, color: "#0a0e1a", border: "none" }}><Icon name="dispatch" size={17} /></button>
          </div>
        </header>

        {feedbackStrip}

        <main style={{ flex: 1, minHeight: 0, minWidth: 0, overflowX: "hidden" }}>{pageContent}</main>

        {/* Bottom tab bar */}
        <nav style={{ flexShrink: 0, display: "flex", background: "#0B0F17", borderTop: `1px solid ${UI.border}`, paddingBottom: "var(--sa-bottom)", zIndex: 2 }}>
          {MOBILE_TABS.map((id) => {
            const n = NAV_ITEMS[id];
            const active = page === id;
            return (
              <button key={id} onClick={() => setPage(id)} style={mobileTab(active)}>
                <Icon name={n.icon} size={20} />
                <span style={{ fontSize: 10.5, fontWeight: active ? 700 : 500 }}>{n.label}</span>
              </button>
            );
          })}
          <button onClick={() => setDrawerOpen(true)} style={mobileTab(false)}>
            <Icon name="settings" size={20} />
            <span style={{ fontSize: 10.5, fontWeight: 500 }}>More</span>
          </button>
        </nav>

        {/* Nav drawer */}
        {drawerOpen && (
          <div onClick={() => setDrawerOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 90, background: "rgba(2,6,23,0.6)", backdropFilter: "blur(4px)", display: "flex", alignItems: "flex-end" }}>
            <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxHeight: "82vh", overflowY: "auto", background: UI.bgElevated, backdropFilter: "blur(16px)", borderTop: `1px solid ${UI.borderStrong}`, borderRadius: "18px 18px 0 0", padding: "10px 14px calc(20px + var(--sa-bottom))" }}>
              <div style={{ width: 38, height: 4, borderRadius: 2, background: UI.borderStrong, margin: "6px auto 14px" }} />
              <MobileControls mc={mc} onConnect={() => setPage("connections")} />
              {NAV.map((group) => (
                <div key={group.label} style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 10, letterSpacing: 1.2, textTransform: "uppercase", fontWeight: 700, color: UI.textMuted, padding: "8px 8px 4px" }}>{group.label}</div>
                  {group.items.map((n) => {
                    const active = n.id === page;
                    return (
                      <button key={n.id} onClick={() => setPage(n.id)} style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", padding: "12px 10px", borderRadius: 10, border: "1px solid transparent", cursor: "pointer", textAlign: "left", fontFamily: FONT, fontSize: 15, fontWeight: active ? 650 : 500, color: active ? UI.textWhite : UI.textSecondary, background: active ? UI.bgActive : "transparent" }}>
                        <span style={{ color: active ? UI.indigoLight : UI.textMuted, display: "grid", placeItems: "center" }}><Icon name={n.icon} size={19} /></span>
                        {n.label}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        )}

        {overlays}
      </div>
    );
  }

  // ── Desktop chrome ────────────────────────────────────────────────────────
  return (
    <div style={{ position: "fixed", inset: 0, display: "grid", gridTemplateColumns: "244px 1fr", background: UI.bg, color: UI.textPrimary, fontFamily: FONT, overflow: "hidden" }}>
      <nav style={{ background: UI.rail, borderRight: `1px solid ${UI.border}`, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <button onClick={() => setMenuOpen((v) => !v)} aria-label="Menu" aria-haspopup="menu" aria-expanded={menuOpen}
          style={{ padding: "20px 20px 14px", display: "flex", alignItems: "center", gap: 11, background: "none", border: "none", cursor: "pointer", textAlign: "left", width: "100%", fontFamily: FONT }}>
          <span style={{ width: 32, height: 32, borderRadius: 9, flexShrink: 0, background: `linear-gradient(135deg, ${UI.indigo}, ${UI.purple})`, display: "grid", placeItems: "center", boxShadow: `0 4px 14px ${UI.indigo}55`, color: UI.textWhite }}>
            <Icon name="bolt" size={18} />
          </span>
          <span style={{ lineHeight: 1.2, flex: 1, minWidth: 0 }}>
            <span style={{ display: "block", fontSize: 14, fontWeight: 700, letterSpacing: 0.2, color: UI.textPrimary }}>Qodo V24</span>
            <span style={{ display: "block", fontSize: 11, color: UI.textMuted }}>Mission Control</span>
          </span>
          <span style={{ color: UI.textMuted, display: "grid", placeItems: "center", transform: menuOpen ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}>
            <Icon name="chevron" size={13} />
          </span>
        </button>

        <div style={{ overflowY: "auto", flex: 1, padding: "6px 12px 12px" }}>
          {NAV.map((group) => (
            <div key={group.label} style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 10, letterSpacing: 1.3, textTransform: "uppercase", fontWeight: 700, color: UI.textMuted, padding: "6px 10px" }}>{group.label}</div>
              {group.items.map((nav) => {
                const active = nav.id === page;
                return (
                  <button key={nav.id} onClick={() => setPage(nav.id)}
                    style={{ display: "flex", alignItems: "center", gap: 11, width: "100%", padding: "9px 10px", marginBottom: 2, borderRadius: 9, border: "1px solid transparent", cursor: "pointer", textAlign: "left", fontFamily: FONT, fontSize: 13.5, fontWeight: active ? 600 : 500, color: active ? UI.textWhite : UI.textSecondary, background: active ? UI.bgActive : "transparent", borderColor: active ? "rgba(99,102,241,0.3)" : "transparent", transition: "background 0.12s ease, color 0.12s ease" }}
                    onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = UI.bgHover; }}
                    onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = "transparent"; }}>
                    <span style={{ color: active ? UI.indigoLight : UI.textMuted, display: "grid", placeItems: "center" }}><Icon name={nav.icon} size={17} /></span>
                    {nav.label}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <button onClick={() => setPage("connections")} title="Open Connections"
          style={{ padding: "12px 16px", borderTop: `1px solid ${UI.border}`, display: "flex", alignItems: "center", gap: 9, background: "transparent", border: "none", borderTopColor: UI.border, cursor: "pointer", textAlign: "left", width: "100%", fontFamily: FONT }}>
          <Dot color={conn.color} glow={conn.glow} />
          <div style={{ lineHeight: 1.25, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: UI.textSecondary }}>{conn.label}</div>
            <div style={{ fontSize: 10.5, color: UI.textMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 170 }}>
              {mc.source === "simulator" ? "built-in simulator · exploring"
                : mc.source === "github" ? mc.githubRepo
                : mc.source === "proxy" ? mc.proxyUrl.replace(/^https?:\/\//, "")
                : "connect GitHub or a proxy"}
            </div>
          </div>
        </button>
      </nav>

      <div style={{ display: "flex", flexDirection: "column", minWidth: 0, overflow: "hidden" }}>
        <header style={{ height: 64, flexShrink: 0, background: UI.topbar, borderBottom: `1px solid ${UI.border}`, backdropFilter: "blur(12px)", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 24px", gap: 16 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 700, display: "flex", alignItems: "center", gap: 9 }}>
              <span style={{ color: UI.indigoLight, display: "grid", placeItems: "center" }}><Icon name={item.icon} size={18} /></span>
              {item.label}
            </div>
            <div style={{ fontSize: 12, color: UI.textMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.blurb}</div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
            <div style={{ display: "flex", gap: 4, padding: 4, borderRadius: 10, background: UI.bgPanel, border: `1px solid ${UI.border}` }} title="Live runs on your real GitHub/proxy connection; the simulator is a labeled sandbox">
              {([["live", "Live", UI.green], ["sim", "Simulator", UI.purple]] as const).map(([k, label, c]) => {
                const on = k === "sim" ? mc.demoMode : !mc.demoMode;
                return (
                  <button key={k}
                    onClick={() => {
                      if (k === "sim") { mc.setDemoMode(true); return; }
                      mc.setDemoMode(false);
                      if (mc.source === "none" || (!mc.githubRepo && !mc.proxyUrl)) setPage("connections");
                    }}
                    style={{ padding: "6px 12px", borderRadius: 7, border: `1px solid ${on ? `${c}44` : "transparent"}`, cursor: "pointer", fontFamily: FONT, fontSize: 12, fontWeight: 600, color: on ? c : UI.textMuted, background: on ? `${c}1e` : "transparent" }}>
                    {label}
                  </button>
                );
              })}
            </div>

            <div style={{ display: "flex", gap: 4, padding: 4, borderRadius: 10, background: UI.bgPanel, border: `1px solid ${UI.border}` }}>
              {(["auto", "mentor"] as const).map((m) => {
                const on = mc.mentorMode === m;
                const c = m === "auto" ? UI.green : UI.amber;
                return (
                  <button key={m} onClick={() => mc.setMentorMode(m)}
                    style={{ padding: "6px 12px", borderRadius: 7, border: "1px solid transparent", cursor: "pointer", fontFamily: FONT, fontSize: 12, fontWeight: 600, color: on ? c : UI.textMuted, background: on ? `${c}1e` : "transparent", borderColor: on ? `${c}44` : "transparent" }}>
                    {m === "auto" ? "Full Auto" : "Mentor"}
                  </button>
                );
              })}
            </div>

            <button onClick={() => setPaletteOpen(true)} title="Command palette"
              style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 10, cursor: "pointer", background: UI.bgPanel, border: `1px solid ${UI.border}`, color: UI.textMuted, fontFamily: FONT, fontSize: 12.5 }}>
              <Icon name="command" size={14} /> <kbd style={{ fontFamily: FONT, fontSize: 11 }}>⌘K</kbd>
            </button>

            <Button variant="primary" onClick={mc.openComposer} disabled={mc.busy} title="Create a task">
              <Icon name="dispatch" size={15} />
              {mc.busy ? "Launching…" : "New task"}
            </Button>
          </div>
        </header>

        {feedbackStrip}
        <main style={{ flex: 1, minHeight: 0, minWidth: 0, overflowX: "hidden" }}>{pageContent}</main>
      </div>

      {overlays}
    </div>
  );
}

const iconBtn: React.CSSProperties = {
  width: 38, height: 38, borderRadius: 10, display: "grid", placeItems: "center", cursor: "pointer",
  background: UI.bgPanel, border: `1px solid ${UI.border}`, color: UI.textSecondary,
};

function mobileTab(active: boolean): React.CSSProperties {
  return {
    flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3, padding: "9px 0 10px",
    background: "transparent", border: "none", cursor: "pointer", fontFamily: FONT,
    color: active ? UI.indigoLight : UI.textMuted,
  };
}

/** Live/Simulator + autonomy controls, shown in the mobile drawer. */
function MobileControls({ mc, onConnect }: { mc: ReturnType<typeof useMissionControl>; onConnect: () => void }): React.ReactElement {
  const seg = (on: boolean, c: string): React.CSSProperties => ({
    flex: 1, padding: "9px 0", borderRadius: 8, border: `1px solid ${on ? `${c}44` : "transparent"}`, cursor: "pointer",
    fontFamily: FONT, fontSize: 13, fontWeight: 600, color: on ? c : UI.textMuted, background: on ? `${c}1e` : "transparent",
  });
  return (
    <div style={{ display: "flex", gap: 10, padding: "4px 8px 12px" }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 10, letterSpacing: 1, textTransform: "uppercase", fontWeight: 700, color: UI.textMuted, marginBottom: 6, paddingLeft: 2 }}>Data</div>
        <div style={{ display: "flex", gap: 4, padding: 4, borderRadius: 10, background: UI.bgElevated, border: `1px solid ${UI.border}` }}>
          <button onClick={() => { mc.setDemoMode(false); if (!mc.githubRepo && !mc.proxyUrl) onConnect(); }} style={seg(!mc.demoMode, UI.green)}>Live</button>
          <button onClick={() => mc.setDemoMode(true)} style={seg(mc.demoMode, UI.purple)}>Sim</button>
        </div>
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 10, letterSpacing: 1, textTransform: "uppercase", fontWeight: 700, color: UI.textMuted, marginBottom: 6, paddingLeft: 2 }}>Autonomy</div>
        <div style={{ display: "flex", gap: 4, padding: 4, borderRadius: 10, background: UI.bgElevated, border: `1px solid ${UI.border}` }}>
          <button onClick={() => mc.setMentorMode("auto")} style={seg(mc.mentorMode === "auto", UI.green)}>Auto</button>
          <button onClick={() => mc.setMentorMode("mentor")} style={seg(mc.mentorMode === "mentor", UI.amber)}>Mentor</button>
        </div>
      </div>
    </div>
  );
}
