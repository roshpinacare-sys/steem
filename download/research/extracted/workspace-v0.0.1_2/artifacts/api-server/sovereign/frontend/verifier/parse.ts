/**
 * frontend/verifier/parse.ts — Parse raw verifier input into a typed payload.
 *
 * Accepts:
 *   • A raw JSON string (most common — paste from clipboard).
 *   • A base64 / base64url-encoded JSON string (e.g. from a URL parameter).
 *
 * Returns ParseOk on success, ParseErr on any failure — never throws.
 * Unknown versions return an error with forensic data so the UI can display
 * what it could read rather than a blank screen.
 *
 * Zero external dependencies; zero node built-in imports.
 */

import type { ParseResult, ParseOk, ParseErr, PayloadType } from "./types.ts";

export type { ParseResult, ParseOk, ParseErr };

/**
 * parseVerifierInput — top-level entry point.
 *
 * Always returns a ParseResult; never throws.
 */
export function parseVerifierInput(input: unknown): ParseResult {
  if (typeof input !== "string") {
    return err("input must be a string");
  }
  const trimmed = input.trim();
  if (!trimmed) {
    return err("input is empty");
  }

  // Strategy 1: direct JSON parse.
  let obj: unknown = tryJsonParse(trimmed);

  // Strategy 2: base64 / base64url decode, then JSON parse.
  if (obj === SENTINEL) {
    const decoded = tryBase64Decode(trimmed);
    if (decoded !== null) {
      obj = tryJsonParse(decoded);
    }
  }

  if (obj === SENTINEL) {
    return err("input is not valid JSON or base64-encoded JSON");
  }

  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    return err("input must be a JSON object (not an array or primitive)");
  }

  const raw = obj as Record<string, unknown>;

  if (!("version" in raw)) {
    return { ok: false, error: "missing required field: version", forensic: raw };
  }

  const version = raw.version;
  const type = detectType(raw, version);

  if (type === null) {
    return {
      ok: false,
      error: `unknown payload version: ${String(version)}`,
      forensic: raw,
    };
  }

  return { ok: true, type, raw };
}

// ─── Internals ────────────────────────────────────────────────────────────────

/** Sentinel value distinguishing "parse returned undefined/null" from "parse failed". */
const SENTINEL = Symbol("sentinel");

function tryJsonParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return SENTINEL;
  }
}

function tryBase64Decode(s: string): string | null {
  // Accept base64 and base64url (replace - → +, _ → /).
  const normalized = s.replace(/-/g, "+").replace(/_/g, "/");
  try {
    return Buffer.from(normalized, "base64").toString("utf8");
  } catch {
    return null;
  }
}

/**
 * detectType — map a parsed object to a PayloadType.
 * Returns null when the version is unrecognised.
 */
function detectType(
  raw: Record<string, unknown>,
  version: unknown
): PayloadType | null {
  // ExecutionReceipt (standard and status variant).
  if (version === "tfa-receipt-v1" || version === "tfa-status-receipt-v1") {
    return "receipt";
  }

  // ActionPassport — version is the numeric schema version "1".
  if (version === "1" && "passportId" in raw) {
    return "passport";
  }

  // Proof bundle — an array of passports with a tenantId wrapper.
  if (
    "passports" in raw &&
    Array.isArray(raw.passports) &&
    "tenantId" in raw
  ) {
    return "proof-bundle";
  }

  return null;
}

function err(message: string): ParseErr {
  return { ok: false, error: message };
}
