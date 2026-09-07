/**
 * dataSource.ts — the shell's data plane and source model.
 *
 * The app has three explicit sources, in priority order:
 *   - "simulator"  — the built-in engine, ONLY when the operator turns it on.
 *                    Always labeled; never the silent default.
 *   - "github"     — Live: real workflow runs / PRs / commits / dispatch via a
 *                    device-local token (see shell/github/).
 *   - "proxy"      — Live: deep agent telemetry through the authenticated
 *                    Cloudflare worker proxy.
 *   - "none"       — nothing connected yet: pages show the connect surface.
 *
 * GitHub and proxy can coexist (CI truth + telemetry depth). The telemetry
 * fetcher below only ever serves simulator or proxy events — with neither, it
 * returns an empty stream instead of quietly inventing data.
 */
import { httpTelemetryFetcher, setTelemetryFetcher } from "../context/TelemetryContext.js";
import { isSandboxForced, setSandboxForced, onSandboxModeChange } from "../mobile/sandbox/mode.js";
import { sandboxGetEvents, sandboxDispatch, sandboxDecide, sandboxReset } from "../mobile/sandbox/engine.js";
import { getProxyUrl } from "../utils/proxy-config.js";
import { getGitHubConfig } from "./github/config.js";

export type DataSourceId = "simulator" | "github" | "proxy" | "none";

/** Simulator is active ONLY when explicitly enabled. */
export function isSimulatorOn(): boolean {
  return isSandboxForced();
}

/** The source the shell is actually running on right now. */
export function activeSource(): DataSourceId {
  if (isSimulatorOn()) return "simulator";
  if (getGitHubConfig()) return "github";
  if (getProxyUrl()) return "proxy";
  return "none";
}

let registered = false;

/** Install the telemetry source once. Safe to call repeatedly. */
export function installDesktopDataSource(): void {
  if (registered) return;
  registered = true;
  setTelemetryFetcher(async (limit) => {
    if (isSimulatorOn()) return sandboxGetEvents().slice(0, limit);
    if (getProxyUrl()) return httpTelemetryFetcher(limit);
    return [];
  });
}

export { isSandboxForced, setSandboxForced, onSandboxModeChange };
export { sandboxDispatch, sandboxDecide, sandboxReset };
