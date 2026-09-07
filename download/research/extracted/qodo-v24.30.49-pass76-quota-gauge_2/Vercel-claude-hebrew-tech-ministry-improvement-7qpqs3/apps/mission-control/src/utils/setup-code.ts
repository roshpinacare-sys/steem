/**
 * setup-code.ts — a shareable, secret-free "team setup" code.
 *
 * Onboarding a teammate used to mean telling them, out of band, which repo and
 * branch to target and which telemetry proxy to point at. A setup code packs
 * exactly those non-secret pointers into one short string a teammate pastes;
 * the app applies the proxy and pre-selects the repo/branch so they only have
 * to add their OWN GitHub token. Secrets are never encoded — not the token, not
 * any LLM key — so a code is safe to drop in a chat or a wiki.
 *
 * Format: "qodo1:" + base64url(JSON) so it's copy-paste safe (no +/=), self-
 * identifying (version prefix), and trivially decodable by any future tool.
 */

export interface TeamSetup {
  /** owner/repo the team works in, e.g. "acme/api". */
  repo?: string;
  /** Branch the agent targets, e.g. "main". */
  branch?: string;
  /** Telemetry proxy URL (never a passphrase). */
  proxy?: string;
}

const PREFIX = "qodo1:";
const REPO_RE = /^[^/\s]+\/[^/\s]+$/;

function toBase64Url(text: string): string {
  // btoa needs Latin-1; encodeURIComponent→unescape maps UTF-8 bytes safely.
  const b64 = btoa(unescape(encodeURIComponent(text)));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(code: string): string {
  const b64 = code.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  return decodeURIComponent(escape(atob(b64 + pad)));
}

/**
 * Encode a team setup. Only known, non-secret fields are included, and empty
 * fields are dropped so the code stays minimal. Returns "" if there's nothing
 * worth sharing (so callers can disable the Share button).
 */
export function encodeSetup(setup: TeamSetup): string {
  const clean: TeamSetup = {};
  if (setup.repo && REPO_RE.test(setup.repo.trim())) clean.repo = setup.repo.trim();
  if (setup.branch && setup.branch.trim()) clean.branch = setup.branch.trim();
  if (setup.proxy && /^https?:\/\//.test(setup.proxy.trim())) clean.proxy = setup.proxy.trim().replace(/\/+$/, "");
  if (!clean.repo && !clean.proxy) return "";
  return PREFIX + toBase64Url(JSON.stringify(clean));
}

/**
 * Decode a setup code. Tolerant of surrounding whitespace and a missing prefix
 * (so pasting the raw body still works). Returns null when the string is not a
 * valid, non-empty setup — never throws. Unknown fields are ignored; a token,
 * were one ever injected, is explicitly stripped so a malicious code can't seed
 * credentials.
 */
export function decodeSetup(code: string): TeamSetup | null {
  const raw = code.trim();
  if (!raw) return null;
  const body = raw.startsWith(PREFIX) ? raw.slice(PREFIX.length) : raw;
  try {
    const parsed = JSON.parse(fromBase64Url(body)) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const rec = parsed as Record<string, unknown>;
    const out: TeamSetup = {};
    if (typeof rec.repo === "string" && REPO_RE.test(rec.repo.trim())) out.repo = rec.repo.trim();
    if (typeof rec.branch === "string" && rec.branch.trim()) out.branch = rec.branch.trim();
    if (typeof rec.proxy === "string" && /^https?:\/\//.test(rec.proxy.trim())) out.proxy = rec.proxy.trim().replace(/\/+$/, "");
    if (!out.repo && !out.proxy) return null;
    return out;
  } catch {
    return null;
  }
}
