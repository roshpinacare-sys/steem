/**
 * session.ts — in-memory, short-lived session tokens for talking to the
 * Cloudflare Worker proxy.
 *
 * Security fix (V24 Pass 43, T1): previously the browser bundle embedded a
 * static Worker dispatch passphrase (and a raw GitHub OAuth token) at *build
 * time* via Vite's `VITE_`-prefixed env vars. Any such variable is inlined
 * into the shipped JS, so both secrets were readable by anyone who opened
 * devtools/view-source on the deployed dashboard — a long-lived credential
 * baked permanently into a public artifact.
 *
 * This module replaces that with a short-lived session token:
 *  - Nothing secret is embedded in the build. The operator is prompted once
 *    per session for the dispatch passphrase (never persisted to disk,
 *    never written to a `VITE_` variable).
 *  - The Worker verifies the passphrase server-side and mints a signed,
 *    expiring token (see `worker/telemetry-proxy.js` `/session/issue`).
 *  - The token lives only in this module's in-memory closure (not
 *    localStorage/sessionStorage) and is discarded on page reload.
 *  - The token is refreshed automatically shortly before it expires, and
 *    on any 401 from the proxy (see `clearSessionToken`).
 */

const TOKEN_TTL_SAFETY_MARGIN_MS = 60_000; // refresh 60s before actual expiry
const SECRET_STORAGE_KEY = "qodo:dispatch-secret";

let cachedToken: string | null = null;
let cachedExpiresAt = 0;
let inFlight: Promise<string> | null = null;
let suppliedSecret: string | null = null;

/**
 * Provide the dispatch passphrase from a real UI (the mobile Connect screen)
 * instead of window.prompt. `remember` persists it in localStorage — which
 * inside the Capacitor WebView is app-private storage on the device. On the
 * shared web build the default stays memory-only, matching the original
 * security posture.
 */
export function setDispatchSecret(secret: string, remember: boolean): void {
  suppliedSecret = secret || null;
  clearSessionToken(); // force the next request to authenticate with the new secret
  try {
    if (remember && secret) window.localStorage.setItem(SECRET_STORAGE_KEY, secret);
    else window.localStorage.removeItem(SECRET_STORAGE_KEY);
  } catch {
    /* storage unavailable — memory-only */
  }
}

/** True if a passphrase is available without prompting. */
export function hasDispatchSecret(): boolean {
  if (suppliedSecret) return true;
  try {
    return Boolean(window.localStorage.getItem(SECRET_STORAGE_KEY));
  } catch {
    return false;
  }
}

/** Forget the passphrase everywhere (Settings → Disconnect). */
export function clearDispatchSecret(): void {
  suppliedSecret = null;
  clearSessionToken();
  try {
    window.localStorage.removeItem(SECRET_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Resolve the dispatch passphrase: supplied via UI → remembered on device →
 * window.prompt as the desktop fallback of last resort.
 */
function promptForSecret(): string | null {
  if (suppliedSecret) return suppliedSecret;
  try {
    const stored = window.localStorage.getItem(SECRET_STORAGE_KEY);
    if (stored) {
      suppliedSecret = stored;
      return stored;
    }
  } catch {
    /* fall through to prompt */
  }
  if (typeof window === "undefined") return null;
  return window.prompt(
    "Mission Control session expired.\nEnter the dispatch passphrase to continue:",
  );
}

async function issueToken(proxyUrl: string): Promise<string> {
  const secret = promptForSecret();
  if (!secret) throw new Error("session authentication cancelled");

  const r = await fetch(`${proxyUrl}/session/issue`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret }),
  });
  if (r.status === 401) {
    // The passphrase is wrong — forget it so the UI asks again instead of
    // retrying the same bad credential forever.
    clearDispatchSecret();
    throw new Error("passphrase rejected by the proxy");
  }
  if (!r.ok) throw new Error(`session issue failed (${r.status})`);
  const data = (await r.json()) as { token: string; expiresAt: number };
  cachedToken = data.token;
  cachedExpiresAt = data.expiresAt;
  return cachedToken;
}

/**
 * Return a valid session token, transparently re-authenticating if the
 * cached one is missing or about to expire. Concurrent callers share a
 * single in-flight request instead of prompting multiple times.
 */
export async function getSessionToken(proxyUrl: string): Promise<string> {
  if (!proxyUrl) throw new Error("proxy URL not configured");
  const now = Date.now();
  if (cachedToken && now < cachedExpiresAt - TOKEN_TTL_SAFETY_MARGIN_MS) {
    return cachedToken;
  }
  if (!inFlight) {
    inFlight = issueToken(proxyUrl).finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

/** Force re-authentication on the next call (e.g. after a 401 response). */
export function clearSessionToken(): void {
  cachedToken = null;
  cachedExpiresAt = 0;
}

/** Milliseconds until the cached token expires (0 if none cached). */
export function sessionExpiresInMs(): number {
  if (!cachedToken) return 0;
  return Math.max(0, cachedExpiresAt - Date.now());
}
