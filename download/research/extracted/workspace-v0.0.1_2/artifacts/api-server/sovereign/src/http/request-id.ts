/**
 * src/http/request-id.ts — zero-dependency request ID generation and attachment.
 *
 * Reuses an incoming x-request-id header if present; otherwise generates
 * a cryptographically-random 16-char hex ID. Attaches it to the response
 * via setHeader/set when available.
 */

import { randomBytes } from "node:crypto";

export function generateRequestId(): string {
  return randomBytes(8).toString("hex");
}

export interface RequestIdResult {
  id: string;
  /** Whether the response actually received the header (depends on res capabilities). */
  attached: boolean;
}

/**
 * Attach a request ID to the response object.
 * If req already carries `x-request-id` (case-insensitive header check),
 * that value is propagated. Otherwise a fresh ID is generated.
 */
export function attachRequestId(req: any, res: any): RequestIdResult {
  const headers = req?.headers ?? {};
  const existing =
    headers["x-request-id"] || headers["X-Request-Id"] || "";
  const id = typeof existing === "string" && existing ? existing : generateRequestId();

  let attached = false;
  if (res && typeof res.setHeader === "function") {
    res.setHeader("x-request-id", id);
    attached = true;
  } else if (res && typeof res.set === "function") {
    res.set("x-request-id", id);
    attached = true;
  }
  return { id, attached };
}
