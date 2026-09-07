/**
 * persist.ts — tiny, safe localStorage helpers for saving in-progress state so
 * nothing is lost when the user backgrounds or closes the app. All access is
 * guarded (private mode / quota) and never throws.
 */
export function loadStr(key: string, fallback = ""): string {
  try { return window.localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}

export function saveStr(key: string, value: string): void {
  try {
    if (value) window.localStorage.setItem(key, value);
    else window.localStorage.removeItem(key);
  } catch { /* storage unavailable */ }
}

/**
 * Run `flush` whenever the app is about to be hidden or closed — on Android
 * the WebView fires visibilitychange/pagehide when it's paused or killed, so
 * this is the reliable moment to persist volatile state.
 */
export function onAppHide(flush: () => void): () => void {
  const onVis = () => { if (document.visibilityState === "hidden") flush(); };
  window.addEventListener("pagehide", flush);
  window.addEventListener("beforeunload", flush);
  document.addEventListener("visibilitychange", onVis);
  return () => {
    window.removeEventListener("pagehide", flush);
    window.removeEventListener("beforeunload", flush);
    document.removeEventListener("visibilitychange", onVis);
  };
}
