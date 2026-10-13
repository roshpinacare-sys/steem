import * as fs from "node:fs";
import * as path from "node:path";
import { NextResponse } from "next/server";

/**
 * T-35 · THE EXPOSURE SHIELD (Next-side half of the security self-audit).
 *
 * Measured live 2026-10-03: the single-port gateway (?XTransformPort=) makes
 * any localhost service reachable from the public preview URL. The engine now
 * refuses mutating verbs on that path itself (lib.gatewayExposureBlocked);
 * THIS side guards the cockpit's own mutating routes:
 *   · same-origin law for browser-driven control verbs (kick/pause/adopt)
 *   · bridge-token law for the engine→Next AI bridges (server-to-server)
 * The laws mirror mini-services/saos-engine/lib.mjs (T-35) — two boundaries,
 * one doctrine. Pure logic, fail-closed, typed verdicts.
 */

export type ShieldVerdict = { ok: true } | { ok: false; status: number; error: string; doctrine: string };

/** same-origin law: Origin absent → internal caller (engine/sovereign/curl)
 * allowed; Origin present → its hostname MUST equal the request Host
 * (cross-site browser calls are refused before the verb runs). */
export function sameOriginAllowed(originHeader: string | null, hostHeader: string | null): boolean {
  const origin = String(originHeader ?? "").trim();
  if (!origin) return true; // non-browser caller
  const host = String(hostHeader ?? "").trim().toLowerCase();
  if (!host) return false;
  try {
    const oh = new URL(origin).hostname.toLowerCase();
    const hh = host.replace(/:\d+$/, "");
    return oh.length > 0 && oh === hh;
  } catch {
    return false;
  }
}

/** the bridge token shared with the engine (.secrets/bridge.token, 0600).
 * The engine signs its server-to-server calls; a lost file fails CLOSED
 * with a typed verdict — the AI bridges never become a public cost sink. */
export function bridgeToken(): string | null {
  try {
    const p = path.join(process.cwd(), ".secrets", "bridge.token");
    const t = fs.readFileSync(p, "utf8").trim();
    return t.length >= 16 ? t : null;
  } catch {
    return null;
  }
}

/** guard for browser-driven mutating verbs (sovereign control, adopt-credential) */
export function guardBrowserMutation(req: Request): ShieldVerdict {
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  if (sameOriginAllowed(origin, host)) return { ok: true };
  return { ok: false, status: 403, error: "cross-origin-mutation-refused", doctrine: "T-35: control verbs are same-origin only" };
}

/** guard for the AI bridges: browser callers need same-origin; server
 * callers (the engine) need the shared bridge token. Fail-closed. */
export function guardAiBridge(req: Request): ShieldVerdict {
  const origin = req.headers.get("origin");
  if (origin) {
    if (sameOriginAllowed(origin, req.headers.get("host"))) return { ok: true };
    return { ok: false, status: 403, error: "cross-origin-bridge-refused", doctrine: "T-35: AI bridges are same-origin or token-carried" };
  }
  const presented = req.headers.get("x-saos-bridge") ?? "";
  const expected = bridgeToken();
  if (!expected) return { ok: false, status: 403, error: "bridge-token-missing", doctrine: "T-35: .secrets/bridge.token unreadable — fail-closed" };
  if (presented && presented.length === expected.length && timingSafeEq(presented, expected)) return { ok: true };
  return { ok: false, status: 403, error: "bridge-token-refused", doctrine: "T-35: server callers must carry x-saos-bridge" };
}

/** constant-time-ish comparison (no early-exit on first differing byte) */
function timingSafeEq(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** shield helper: returns a NextResponse rejection or null when allowed */
export function shieldReject(verdict: ShieldVerdict): NextResponse | null {
  if (verdict.ok) return null;
  return NextResponse.json({ ok: false, error: verdict.error, doctrine: verdict.doctrine }, { status: verdict.status });
}

/** WIF-shape redaction (T-35): Steem WIFs are 51-char (5H/5J/5K) or 52-char
 * (K/L prefix) base58 tokens — a shape we KNOW, never a guessed family. */
export function redactSecretShapes(text: string): string {
  return String(text ?? "")
    .replace(/\b(?:5[HJK][1-9A-HJ-NP-Za-km-z]{49}|[KL][1-9A-HJ-NP-Za-km-z]{51})\b/g, "[REDACTED-WIF]");
}
