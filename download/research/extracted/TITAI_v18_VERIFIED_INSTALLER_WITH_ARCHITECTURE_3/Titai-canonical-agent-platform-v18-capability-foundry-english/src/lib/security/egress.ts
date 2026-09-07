import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export interface EgressOptions {
  allowPrivate?: boolean;
  allowHttp?: boolean;
  lookupHost?: (hostname: string) => Promise<Array<{ address: string; family: number }>>;
}

export class UnsafeEgressTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeEgressTargetError";
  }
}

function ipv4ToInt(value: string): number {
  return value
    .split(".")
    .map(Number)
    .reduce((acc, octet) => ((acc << 8) | octet) >>> 0, 0);
}

function inV4Range(value: string, base: string, prefix: number): boolean {
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ipv4ToInt(value) & mask) === (ipv4ToInt(base) & mask);
}

export function isPrivateOrSpecialAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    return [
      ["0.0.0.0", 8],
      ["10.0.0.0", 8],
      ["100.64.0.0", 10],
      ["127.0.0.0", 8],
      ["169.254.0.0", 16],
      ["172.16.0.0", 12],
      ["192.0.0.0", 24],
      ["192.0.2.0", 24],
      ["192.168.0.0", 16],
      ["198.18.0.0", 15],
      ["198.51.100.0", 24],
      ["203.0.113.0", 24],
      ["224.0.0.0", 4],
      ["240.0.0.0", 4],
    ].some(([base, prefix]) => inV4Range(address, String(base), Number(prefix)));
  }
  if (family === 6) {
    const normalized = address.toLowerCase();
    return (
      normalized === "::" ||
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      /^fe[89ab]/.test(normalized) ||
      normalized.startsWith("ff") ||
      normalized.startsWith("2001:db8:")
    );
  }
  return true;
}

export function parseEgressUrl(raw: string, options: EgressOptions = {}): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeEgressTargetError("Endpoint is not a valid URL.");
  }
  const allowed = options.allowHttp ? ["https:", "http:"] : ["https:"];
  if (!allowed.includes(url.protocol)) {
    throw new UnsafeEgressTargetError(
      `Protocol ${url.protocol || "unknown"} is not allowed.`,
    );
  }
  if (url.username || url.password) {
    throw new UnsafeEgressTargetError("Credentials in endpoint URLs are not allowed.");
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host) throw new UnsafeEgressTargetError("Endpoint hostname is required.");
  if (
    !options.allowPrivate &&
    (host === "localhost" ||
      host.endsWith(".localhost") ||
      host.endsWith(".local") ||
      host === "metadata.google.internal")
  ) {
    throw new UnsafeEgressTargetError("Local and metadata endpoints are blocked.");
  }
  if (!options.allowPrivate && isIP(host) && isPrivateOrSpecialAddress(host)) {
    throw new UnsafeEgressTargetError("Private or special-purpose IP targets are blocked.");
  }
  return url;
}

export async function assertSafeEgressUrl(
  raw: string,
  options: EgressOptions = {},
): Promise<URL> {
  const url = parseEgressUrl(raw, options);
  if (options.allowPrivate || isIP(url.hostname)) return url;

  const resolver =
    options.lookupHost ??
    (async (hostname: string) => lookup(hostname, { all: true, verbatim: true }));
  const resolved = await resolver(url.hostname);
  if (resolved.length === 0) {
    throw new UnsafeEgressTargetError("Endpoint hostname did not resolve.");
  }
  if (resolved.some((entry) => isPrivateOrSpecialAddress(entry.address))) {
    throw new UnsafeEgressTargetError(
      "Endpoint resolves to a private or special-purpose address.",
    );
  }
  return url;
}
