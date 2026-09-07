/**
 * Sandbox mode resolution: the app runs on the built-in simulator whenever
 * no live proxy is configured, or when the user explicitly forces sandbox
 * in Settings (useful for demoing while a live connection exists).
 */
import { getProxyUrl, onProxyUrlChange } from "../../utils/proxy-config.js";

const FORCED_KEY = "qodo:sandbox-forced";
const listeners = new Set<() => void>();

export function isSandboxForced(): boolean {
  try {
    return window.localStorage.getItem(FORCED_KEY) === "1";
  } catch {
    return false;
  }
}

export function setSandboxForced(on: boolean): void {
  try {
    if (on) window.localStorage.setItem(FORCED_KEY, "1");
    else window.localStorage.removeItem(FORCED_KEY);
  } catch {
    /* ignore */
  }
  for (const l of listeners) l();
}

/** The single question every data path asks. */
export function isSandboxActive(): boolean {
  return isSandboxForced() || !getProxyUrl();
}

export function onSandboxModeChange(listener: () => void): () => void {
  listeners.add(listener);
  const offProxy = onProxyUrlChange(() => listener());
  return () => {
    listeners.delete(listener);
    offProxy();
  };
}
