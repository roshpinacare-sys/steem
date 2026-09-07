/**
 * useMissionControl — the desktop shell's control surface, extracted from the
 * old App.tsx cockpit so pages and the top bar can share one source of truth:
 * mission dispatch, the mentor-approval gate, autonomy mode, and the opt-in
 * WebContainer edge-test executor. All traffic goes through the authenticated
 * proxy; no upstream credentials reach the browser.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { WebContainer } from "@webcontainer/api";
import { useTelemetryCtx } from "../context/TelemetryContext.js";
import { fetchWithTimeout } from "../utils/fetch-timeout.js";
import { getSessionToken } from "../utils/session.js";
import { getProxyUrl } from "../utils/proxy-config.js";
import { findPendingApproval, postMentorDecision } from "../utils/mentor.js";
import {
  installDesktopDataSource, isSimulatorOn, activeSource, setSandboxForced,
  onSandboxModeChange, sandboxDispatch, sandboxDecide, sandboxReset,
  type DataSourceId,
} from "./dataSource.js";
import { getGitHubConfig, onGitHubConfigChange } from "./github/config.js";
import { ghDispatchPipeline } from "./github/client.js";

export type MentorMode = "auto" | "mentor";

interface ComputeRequest {
  requestId: string;
  files: string[];
  testCommand: string;
  requestedAt: string;
}

const ALLOWED_TEST_COMMANDS = new Set([
  "npm test",
  "npm run test",
  "npx vitest run",
  "npx tsc --noEmit",
]);

export interface MissionControl {
  proxyUrl: string;
  busy: boolean;
  dispatched: boolean;
  dispatchError: string | null;
  mission: string;
  lastRepo: string;
  mentorMode: MentorMode;
  setMentorMode: (m: MentorMode) => void;
  dispatchMission: (objective: string, repo: string, feedback?: string, opts?: { dryRun?: boolean }) => Promise<void>;
  pendingApproval: ReturnType<typeof findPendingApproval>;
  approve: (runId: string) => void;
  reject: (runId: string, reason: string) => void;
  autoFix: (reason: string) => void;
  dismissedAt: string | null;
  // Edge sandbox
  edgeEnabled: boolean;
  setEdgeEnabled: (v: boolean) => void;
  edgeStatus: string | null;
  // Task composer (create surface, shared by top bar + Tasks board + ⌘K)
  composerOpen: boolean;
  openComposer: () => void;
  closeComposer: () => void;
  /** The data source the shell is actually running on. */
  source: DataSourceId;
  /** "owner/repo" when GitHub Live is connected. */
  githubRepo: string | null;
  // Simulator — explicit, opt-in, always labeled. Never a silent default.
  demoMode: boolean;
  setDemoMode: (on: boolean) => void;
  resetDemo: () => void;
}

// Install the demo/live telemetry source at module load so the very first
// poll already has data (Demo when no proxy is configured).
installDesktopDataSource();

export function useMissionControl(): MissionControl {
  const proxyUrl = getProxyUrl();
  const { events, refresh } = useTelemetryCtx();
  const [demoMode, setDemoModeState] = useState<boolean>(isSimulatorOn());
  const [source, setSource] = useState<DataSourceId>(activeSource());

  // Track simulator toggles, proxy changes, and GitHub connect/disconnect.
  useEffect(() => {
    const recompute = () => { setDemoModeState(isSimulatorOn()); setSource(activeSource()); };
    const offSandbox = onSandboxModeChange(recompute);
    const offGitHub = onGitHubConfigChange(recompute);
    return () => { offSandbox(); offGitHub(); };
  }, []);

  const [busy, setBusy] = useState(false);
  const [dispatched, setDispatched] = useState(false);
  const [dispatchError, setDispatchError] = useState<string | null>(null);
  const [mission, setMission] = useState("");
  const [lastRepo, setLastRepo] = useState("");
  const [mentorMode, setMentorMode] = useState<MentorMode>("auto");
  const [dismissedAt, setDismissedAt] = useState<string | null>(null);
  const [edgeEnabled, setEdgeEnabled] = useState(false);
  const [edgeStatus, setEdgeStatus] = useState<string | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const webcontainerRef = useRef<WebContainer | null>(null);

  const dispatchMission = useCallback(
    async (objective: string, repo: string, feedback?: string, opts?: { dryRun?: boolean }) => {
      if (!objective.trim() || !repo.trim()) return;
      // Simulator (explicit): run the mission locally, clearly labeled.
      if (isSimulatorOn()) {
        sandboxDispatch(objective.trim(), repo.trim());
        setDispatched(true);
        setMission(objective.trim());
        setLastRepo(repo.trim());
        void refresh();
        return;
      }
      // Live (GitHub): a REAL agent run via workflow_dispatch.
      const gh = getGitHubConfig();
      if (gh) {
        setBusy(true);
        setDispatchError(null);
        try {
          await ghDispatchPipeline(gh, objective.trim(), { dryRun: opts?.dryRun });
          setDispatched(true);
          setMission(objective.trim());
          setLastRepo(`${gh.owner}/${gh.repo}`);
        } catch (e: unknown) {
          setDispatchError(e instanceof Error ? e.message : "dispatch failed");
        } finally {
          setBusy(false);
        }
        return;
      }
      if (!proxyUrl) {
        setDispatchError("Nothing connected — connect GitHub or a telemetry proxy first (Connections page).");
        return;
      }
      setBusy(true);
      setDispatchError(null);
      try {
        const body: Record<string, unknown> = { objective: objective.trim(), repo: repo.trim() };
        if (feedback) body.feedback = feedback;
        if (opts?.dryRun) body.dryRun = true;
        const token = await getSessionToken(proxyUrl);
        const r = await fetchWithTimeout(
          `${proxyUrl}/dispatch`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Qodo-Session": token },
            body: JSON.stringify(body),
          },
          30_000,
        );
        const data = (await r.json()) as Record<string, unknown>;
        if (!r.ok) throw new Error((data.error as string) || "dispatch failed");
        setDispatched(true);
        setMission(objective.trim());
        setLastRepo(repo.trim());
      } catch (e: unknown) {
        setDispatchError(e instanceof Error ? e.message : "dispatch failed");
      } finally {
        setBusy(false);
      }
    },
    [proxyUrl],
  );

  const pendingApproval = useMemo(() => findPendingApproval(events), [events]);

  const approve = useCallback(
    (_runId: string) => {
      setDismissedAt(new Date().toISOString());
      if (!pendingApproval) return;
      if (isSimulatorOn()) { sandboxDecide(pendingApproval.runId, "approved"); void refresh(); return; }
      if (proxyUrl) postMentorDecision(proxyUrl, pendingApproval, "approved").catch(() => {});
    },
    [pendingApproval, proxyUrl, refresh],
  );

  const reject = useCallback(
    (_runId: string, reason: string) => {
      setDismissedAt(new Date().toISOString());
      if (!pendingApproval) return;
      if (isSimulatorOn()) { sandboxDecide(pendingApproval.runId, "rejected", reason); void refresh(); return; }
      if (proxyUrl) postMentorDecision(proxyUrl, pendingApproval, "rejected", reason).catch(() => {});
      if (mission && lastRepo) void dispatchMission(mission, lastRepo, reason);
    },
    [pendingApproval, proxyUrl, mission, lastRepo, dispatchMission, refresh],
  );

  const autoFix = useCallback(
    (reason: string) => {
      if (mission && lastRepo) void dispatchMission(mission, lastRepo, reason);
    },
    [mission, lastRepo, dispatchMission],
  );

  // ── Edge compute executor (opt-in) ─────────────────────────────────────────
  useEffect(() => {
    if (!edgeEnabled || !proxyUrl) return;
    let active = true;

    async function bootWc(): Promise<WebContainer | null> {
      if (webcontainerRef.current) return webcontainerRef.current;
      try {
        const inst = await WebContainer.boot();
        webcontainerRef.current = inst;
        return inst;
      } catch (e: unknown) {
        setEdgeStatus(`boot error: ${e instanceof Error ? e.message : String(e)}`);
        return null;
      }
    }

    async function submitResult(requestId: string, passed: boolean, logs: string) {
      const token = await getSessionToken(proxyUrl);
      await fetchWithTimeout(
        `${proxyUrl}/compute/result`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Qodo-Session": token },
          body: JSON.stringify({ requestId, passed, logs }),
        },
        30_000,
      );
    }

    async function runOne(req: ComputeRequest) {
      if (!ALLOWED_TEST_COMMANDS.has(req.testCommand)) {
        setEdgeStatus(`rejected disallowed command: ${req.testCommand}`);
        await submitResult(req.requestId, false, "disallowed test command");
        return;
      }
      const wc = await bootWc();
      if (!wc) return submitResult(req.requestId, false, "WebContainer failed to boot");
      setEdgeStatus(`running ${req.requestId}`);
      try {
        const proc = await wc.spawn("sh", ["-c", req.testCommand]);
        let output = "";
        const streamDone = proc.output.pipeTo(new WritableStream({ write(d) { output += d; } }));
        const exitCode = await proc.exit;
        await streamDone;
        const passed = exitCode === 0;
        setEdgeStatus(`completed ${req.requestId}: ${passed ? "passed" : "failed"}`);
        await submitResult(req.requestId, passed, output);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        setEdgeStatus(`run error: ${msg}`);
        await submitResult(req.requestId, false, msg);
      }
    }

    const interval = setInterval(async () => {
      try {
        const token = await getSessionToken(proxyUrl);
        const r = await fetchWithTimeout(`${proxyUrl}/compute/requests`, { headers: { "X-Qodo-Session": token } }, 30_000);
        if (!r.ok) return;
        const requests = (await r.json()) as ComputeRequest[];
        if (!active) return;
        for (const req of requests) await runOne(req);
      } catch (e: unknown) {
        if (active) setEdgeStatus(`poll error: ${e instanceof Error ? e.message : String(e)}`);
      }
    }, 2000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [edgeEnabled, proxyUrl]);

  return {
    proxyUrl,
    busy,
    dispatched,
    dispatchError,
    mission,
    lastRepo,
    mentorMode,
    setMentorMode,
    dispatchMission,
    pendingApproval,
    approve,
    reject,
    autoFix,
    dismissedAt,
    edgeEnabled,
    setEdgeEnabled,
    edgeStatus,
    composerOpen,
    openComposer: () => setComposerOpen(true),
    closeComposer: () => setComposerOpen(false),
    source,
    githubRepo: (() => { const g = getGitHubConfig(); return g ? `${g.owner}/${g.repo}` : null; })(),
    demoMode,
    setDemoMode: (on: boolean) => { setSandboxForced(on); setDemoModeState(isSimulatorOn()); setSource(activeSource()); void refresh(); },
    resetDemo: () => { sandboxReset(); void refresh(); },
  };
}
