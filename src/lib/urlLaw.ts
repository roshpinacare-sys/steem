/**
 * T-44 · THE URL SCHEME LAW (cockpit-side, client-safe pure logic).
 *
 * Found in the T-44 self-audit: TeamsCard renders webintel finding URLs as
 * `href={f.url}` — and findings originate from EXTERNAL search results.
 * A hostile result whose "url" is `javascript:…` (or `data:`/`vbscript:`)
 * becomes a one-click XSS the moment a curator clicks it. The engine-side
 * digest law normalizes cite URLs for MATCHING (content.mjs normalizeCiteUrl)
 * but matching is not rendering — the browser boundary needs its own law.
 *
 * Law: an anchor href for EXTERNAL content accepts ONLY http/https with a
 * non-empty hostname. Everything else → null (the caller renders a plain
 * row, not a link). Fail-closed, zero dependencies, mirrors the two-boundary
 * doctrine of the exposure shield (engine law + browser law).
 */
export function safeExternalUrl(u: unknown): string | null {
  const raw = typeof u === "string" ? u.trim() : "";
  if (!raw || /\s/.test(raw)) return null; // no whitespace/newline smuggling
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (!parsed.hostname || parsed.hostname.length < 1) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

/**
 * T-45 · THE SSRF LAW (server-side complement to the scheme law).
 *
 * The webintel deep probe asks this server to FETCH a URL. A fetch-a-URL
 * surface that accepts private hosts is a port-scanner and a metadata-
 * endpoint oracle. Law: a hostname that resolves INTO this machine or a
 * private network (loopback, RFC1918, link-local, ULA, 0.0.0.0, decimal/
 * octal IP spellings) is refused BEFORE any bytes move. Public internet
 * only — the deep probe is a reader, not a tunnel.
 */
export function privateNetworkHost(hostname: string | null | undefined): boolean {
  const h = String(hostname ?? "").trim().toLowerCase().replace(/\.$/, "");
  if (!h) return true; // fail-closed: no host = private
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
  // IPv6 literal (URL.hostname keeps brackets)
  if (h.startsWith("[") && h.endsWith("]")) return true; // any v6 literal is refused — the probe speaks DNS names and v4
  // dotted-quad (or decimal/hex/octal spellings) → numeric checks
  const last = h.split(".").pop() ?? "";
  if (!/^\d+$/.test(last)) return false; // not an IP spelling → public DNS name
  const parts = h.split(".");
  if (parts.length !== 4) return true; // non-canonical numeric spelling (decimal/hex/octal) — refuse
  const octets = parts.map((p) => Number(p));
  if (octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) return true;
  const [a, b] = octets;
  if (a === 0 || a === 10 || a === 127) return true; // this-network / private / loopback
  if (a === 169 && b === 254) return true; // link-local (cloud metadata lives here)
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
  if (a === 192 && b === 168) return true; // RFC1918
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  return false;
}
