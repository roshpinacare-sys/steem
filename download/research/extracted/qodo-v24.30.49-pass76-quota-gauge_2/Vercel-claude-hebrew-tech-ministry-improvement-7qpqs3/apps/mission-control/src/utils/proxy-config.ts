/**
 * proxy-config.ts — runtime-configurable telemetry-proxy URL.
 *
 * The web build can bake a URL in via VITE_TELEMETRY_PROXY_URL, but the
 * Android APK is built once in CI and installed on many phones — a
 * compile-time URL means an installed app could never be connected. The
 * device-local override (persisted in localStorage, which is app-private
 * inside the Capacitor WebView) takes precedence over the baked-in value,
 * and subscribers are notified so the UI can react without a reload.
 */

const STORAGE_KEY = "qodo:proxy-url";

type Listener = (url: string) => void;
const listeners = new Set<Listener>();

function storedUrl(): string {
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

/** Effective proxy URL: device override first, then the build-time value. */
export function getProxyUrl(): string {
  return storedUrl() || (import.meta.env.VITE_TELEMETRY_PROXY_URL as string | undefined) || "";
}

/** True when the URL came from the build, not a device-local override. */
export function isBuildTimeUrl(): boolean {
  return !storedUrl() && Boolean(import.meta.env.VITE_TELEMETRY_PROXY_URL);
}

/** Persist (or clear, with "") the device-local proxy URL and notify. */
export function setProxyUrl(url: string): void {
  const normalized = url.trim().replace(/\/+$/, "");
  try {
    if (normalized) window.localStorage.setItem(STORAGE_KEY, normalized);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable (private mode) — in-memory subscribers still update */
  }
  const effective = getProxyUrl();
  for (const l of listeners) l(effective);
}

/** Subscribe to proxy-URL changes; returns an unsubscribe function. */
export function onProxyUrlChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Unauthenticated reachability probe against the worker's /health route. */
export async function probeProxy(url: string, timeoutMs = 8_000): Promise<{ ok: boolean; error?: string }> {
  const base = url.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//.test(base)) return { ok: false, error: "URL must start with https://" };
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const r = await fetch(`${base}/health`, { signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) return { ok: false, error: `proxy answered ${r.status}` };
    const data = (await r.json()) as { ok?: boolean };
    return data.ok ? { ok: true } : { ok: false, error: "unexpected /health response" };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg.includes("abort") ? "timed out — is the URL right?" : msg };
  }
}
