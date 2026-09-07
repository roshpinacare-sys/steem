/**
 * sign.ts — Client-side Steem signing layer (Console v3, Live).
 *
 * IRON LAW (docs/ROAST.md + KEY_CAPABILITIES.md): the platform assembles,
 * the operator signs. This module NEVER sends the secret anywhere:
 *   - The secret (WIF or master password) exists ONLY in browser memory.
 *   - Derivation + signing + broadcasting all happen in the browser via the
 *     official steem-js UMD bundle served from OUR OWN /steem.min.js
 *     (no CDN dependency, no bundler polyfills, no node builtins).
 *   - The server only ever sees prepared op JSON (read-only data) and, from
 *     the broadcast itself, goes browser → public Steem RPC directly.
 *
 * Hardening (Task 21-a):
 *   - Secrets are trimmed; empty-after-trim is a clean Hebrew error.
 *   - Pre-broadcast verify_authority: the tx is prepared + signed locally and
 *     checked with condenser_api.verify_authority BEFORE any broadcast. A
 *     "missing … authority" result blocks the broadcast with a clean Hebrew
 *     error (measured live on api.steemit.com + api.justyy.com; see
 *     .zscripts/verify_authority_test.cjs). Any OTHER API failure (node
 *     without the method, timeout, odd shape) is logged and the broadcast
 *     proceeds — reliability over cleverness.
 *   - cleanChainError maps the measured chain errors to short Hebrew guidance.
 *
 * API surface verified against steem-js 0.7.11 UMD:
 *   steem.auth.isWif(wif), steem.auth.wifToPublic(wif),
 *   steem.auth.getPrivateKeys(username, master, [roles]) → {role, rolePubkey}
 *   steem.auth.signTransaction(tx, [wif]) → signed tx (local, sync)
 *   steem.broadcast._prepareTransaction({operations, extensions}) → Promise<tx>
 *   steem.broadcast.sendAsync({operations, extensions}, [wif]) → Promise<conf>
 *   steem.api.call('condenser_api.verify_authority', [signedTx], cb)
 */

"use client";

// ── Types ───────────────────────────────────────────────────────────────────

export type SteemRole = "posting" | "active";

/** A signing session held in browser memory only. NEVER persisted. */
export interface KeySession {
  username: string;
  role: SteemRole;
  /** Public key fingerprint — safe to display (STM...). */
  pubkey: string;
  /** How the secret was provided (not the secret itself). */
  source: "wif" | "master";
  connectedAt: number;
}

export interface BroadcastResult {
  txid: string;
  blockNum: number | null;
}

interface SteemConfirmation {
  id?: string;
  block_num?: number;
  trx_num?: number;
}

type SteemJs = any;

// ── Activity hook (idle auto-disconnect wiring) ─────────────────────────────
// The key-session store registers a listener here; every signAndBroadcast
// (and connect) counts as activity and resets the 30-minute idle timer.
// Declared in this module (not in the store) to avoid a circular import.

type ActivityListener = () => void;
let activityListener: ActivityListener | null = null;

export function setKeyActivityListener(fn: ActivityListener | null): void {
  activityListener = fn;
}

function noteActivity(): void {
  try {
    activityListener?.();
  } catch {
    /* listener must never break a broadcast */
  }
}

// ── UMD loader (self-hosted /steem.min.js, loaded once per page) ───────────

declare global {
  interface Window {
    steem?: SteemJs;
  }
}

const SCRIPT_SRC = "/steem.min.js";
const DEFAULT_NODES = [
  "https://api.steemit.com",
  "https://api.justyy.com",
  "https://api.steem.fans",
];

let loaderPromise: Promise<SteemJs> | null = null;

/** Injects the official steem-js UMD bundle once; resolves the global. */
export function loadSteem(): Promise<SteemJs> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("signing requires a browser"));
  }
  if (window.steem) return Promise.resolve(window.steem);
  if (loaderPromise) return loaderPromise;

  loaderPromise = new Promise<SteemJs>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[data-saos-steem="1"]`
    );
    const done = () => {
      if (window.steem) resolve(window.steem);
      else reject(new Error("steem-js נטען אך ה-global לא זמין"));
    };
    if (existing) {
      existing.addEventListener("load", done);
      existing.addEventListener("error", () =>
        reject(new Error("טעינת steem-js נכשלה"))
      );
      return;
    }
    const el = document.createElement("script");
    el.src = SCRIPT_SRC;
    el.async = true;
    el.dataset.saosSteem = "1";
    el.addEventListener("load", done);
    el.addEventListener("error", () =>
      reject(new Error("טעינת steem-js נכשלה"))
    );
    document.head.appendChild(el);
  });
  return loaderPromise;
}

/** Points the client at the first responsive node (tries in order). */
async function configureRpc(steem: SteemJs): Promise<void> {
  for (const url of DEFAULT_NODES) {
    try {
      steem.api.setOptions({ url, useAppbaseApi: false });
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("timeout")), 8000);
        steem.api.getDynamicGlobalProperties((err: Error | null) => {
          clearTimeout(t);
          if (err) reject(err);
          else resolve();
        });
      });
      return;
    } catch {
      // try next node
    }
  }
  throw new Error("אף צומת Steem לא נגיש מהדפדפן");
}

// ── Key derivation (memory only) ────────────────────────────────────────────

export interface DerivedKey {
  wif: string;
  pubkey: string;
  source: "wif" | "master";
}

/**
 * Derives a role key from EITHER a WIF (starts with a base58 blob) or the
 * account master password. Both paths run 100% in the browser.
 * Secrets are trimmed — WIFs tolerate surrounding whitespace; an empty
 * (after-trim) secret is a clean Hebrew error.
 */
export async function deriveKey(
  username: string,
  secret: string,
  role: SteemRole
): Promise<DerivedKey> {
  const steem = await loadSteem();
  const trimmed = (secret ?? "").trim();
  if (!trimmed) throw new Error("נא להזין מפתח");
  if (!/^[a-z0-9\-\._]{3,16}$/.test(username)) throw new Error("שם משתמש לא תקין");

  if (steem.auth.isWif(trimmed)) {
    const pub = steem.auth.wifToPublic(trimmed);
    if (typeof pub !== "string" || !pub.startsWith("STM")) {
      throw new Error("WIF לא תקין עבור רשת Steem");
    }
    return { wif: trimmed, pubkey: pub, source: "wif" };
  }

  // Master password path — derive the role key locally.
  const keys = steem.auth.getPrivateKeys(username, trimmed, [role]);
  const wif = keys[role];
  const pub = keys[`${role}Pubkey`];
  if (typeof wif !== "string" || !steem.auth.isWif(wif) || typeof pub !== "string") {
    throw new Error("גזירת המפתח נכשלה — בדוק שם משתמש וסיסמת-על");
  }
  return { wif, pubkey: pub, source: "master" };
}

// ── Pre-broadcast authority check (verify_authority, measured live) ─────────

/**
 * Node error shapes measured live (Task 21-a, .zscripts/verify_authority_test.cjs):
 *   api.steemit.com + api.justyy.com → jsonrpc error, message =
 *     "missing required posting authority:Missing Posting Authority headcorner"
 *     (code 3030000, name tx_missing_posting_auth) — the SAME error broadcast
 *     would produce, caught BEFORE any broadcast attempt.
 *   steem.fans → HTTP 404 for the API call (unreliable) → graceful fallback.
 */
const AUTHORITY_ERR_RE =
  /missing\s+(required\s+)?(posting|active|owner|memo)\s+authority|(posting|active|owner)\s+authority|insufficient\s+authority|does\s+not\s+have\s+sufficient\s+authority|check\s+authority/i;

export function authorityRoleFromError(
  msg: string
): "posting" | "active" | "owner" | null {
  if (/posting\s+authority/i.test(msg)) return "posting";
  if (/active\s+authority/i.test(msg)) return "active";
  if (/owner\s+authority/i.test(msg)) return "owner";
  return null;
}

/** The clean Hebrew lock message for a wrong-role key. */
export function authorityLockMessage(msg: string): string {
  const role = authorityRoleFromError(msg ?? "");
  if (role) {
    return `המפתח שחובר לא מתאים לפעולה הזו — נתק וחבר את מפתח ה-${role}`;
  }
  return "המפתח שחובר לא מתאים לפעולה הזו — נתק וחבר את המפתח המתאים (posting/active)";
}

function errText(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object") {
    const m = (e as { message?: unknown }).message;
    if (typeof m === "string") return m;
    try {
      return JSON.stringify(e);
    } catch {
      return String(e);
    }
  }
  return String(e ?? "");
}

/**
 * Prepares + signs the transaction LOCALLY (never sent anywhere except the
 * node's verify_authority check) and asks the node to validate the authority.
 *  - Authority failure (explicit `false` or "missing … authority") → throws
 *    the clean Hebrew lock message; signAndBroadcast then does NOT broadcast.
 *  - Anything else (method missing on the node, timeout, odd response shape)
 *    → console.warn + proceed — reliability over cleverness. The chain itself
 *    re-checks authority at broadcast (measured: same rejection there).
 */
async function preBroadcastAuthorityCheck(
  steem: SteemJs,
  wif: string,
  operations: [string, Record<string, unknown>][]
): Promise<void> {
  // 1. Build the tx locally: DGP → ref_block_num/prefix + expiration ~60s.
  let signed: unknown;
  try {
    const prepared = await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("timeout")), 12_000);
      try {
        Promise.resolve(
          steem.broadcast._prepareTransaction({ operations, extensions: [] })
        )
          .then((r: unknown) => {
            clearTimeout(t);
            resolve(r);
          })
          .catch((e: unknown) => {
            clearTimeout(t);
            reject(e);
          });
      } catch (e) {
        clearTimeout(t);
        reject(e);
      }
    });
    if (prepared && typeof prepared === "object") {
      // Shorter replay window than the library default (600s).
      (prepared as { expiration?: unknown }).expiration = new Date(
        Date.now() + 60_000
      );
    }
    signed = steem.auth.signTransaction(prepared, [wif]);
  } catch (e) {
    console.warn(
      "[saos-sign] pre-broadcast prepare/sign failed — skipping verify_authority pre-check:",
      errText(e)
    );
    return;
  }

  // 2. verify_authority (condenser route, appbase — works on steemit + justyy).
  const outcome = await new Promise<{ err?: unknown; res?: unknown; timedOut?: boolean }>(
    (resolve) => {
      const t = setTimeout(() => resolve({ timedOut: true }), 12_000);
      try {
        steem.api.call(
          "condenser_api.verify_authority",
          [signed],
          (err: unknown, res: unknown) => {
            clearTimeout(t);
            resolve({ err, res });
          }
        );
      } catch (e) {
        clearTimeout(t);
        resolve({ err: e });
      }
    }
  );

  if (outcome.timedOut) {
    console.warn("[saos-sign] verify_authority timed out — proceeding to broadcast (fallback)");
    return;
  }

  if (outcome.err != null) {
    const msg = errText(outcome.err);
    if (AUTHORITY_ERR_RE.test(msg)) {
      throw new Error(authorityLockMessage(msg));
    }
    console.warn(
      "[saos-sign] verify_authority unavailable on node — proceeding to broadcast (fallback):",
      msg.slice(0, 300)
    );
    return;
  }

  const res = outcome.res;
  const resObj = res && typeof res === "object" ? (res as { valid?: unknown }) : null;
  const ok = res === true || (resObj !== null && resObj.valid === true);
  if (!ok) {
    const explicitFalse = res === false || (resObj !== null && resObj.valid === false);
    if (explicitFalse) {
      throw new Error(authorityLockMessage(""));
    }
    console.warn(
      "[saos-sign] verify_authority returned an unrecognized shape — proceeding to broadcast (fallback):",
      JSON.stringify(res ?? null)?.slice(0, 300)
    );
  }
}

// ── Broadcasting (browser → public RPC, key never transmitted) ──────────────

export interface SendOpsOptions {
  /** Shown only in error text; the ops themselves carry the account. */
  username?: string;
  /** Timeout per attempt, ms. */
  timeoutMs?: number;
}

/**
 * Signs and broadcasts operations with the given WIF.
 * Equivalent to steem.broadcast.sendAsync: the library fetches chain props,
 * builds the transaction, signs with the local key and pushes to the node.
 * Runs the pre-broadcast verify_authority check first (graceful fallback).
 */
export async function signAndBroadcast(
  wif: string,
  operations: [string, Record<string, unknown>][],
  options: SendOpsOptions = {}
): Promise<BroadcastResult> {
  noteActivity();
  const steem = await loadSteem();
  await configureRpc(steem);

  // Pre-broadcast authority gate — may throw the clean Hebrew lock message
  // BEFORE anything is broadcast (or quietly fall back, see above).
  await preBroadcastAuthorityCheck(steem, wif, operations);

  const tx = { operations, extensions: [] };
  const timeoutMs = options.timeoutMs ?? 30_000;

  const attempt = () =>
    new Promise<SteemConfirmation>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("פסק-זמן בשידור")), timeoutMs);
      try {
        steem.broadcast
          .sendAsync(tx, [wif])
          .then((r: SteemConfirmation) => {
            clearTimeout(t);
            resolve(r);
          })
          .catch((e: unknown) => {
            clearTimeout(t);
            reject(e);
          });
      } catch (e) {
        clearTimeout(t);
        reject(e);
      }
    });

  let lastErr: unknown;
  // Two attempts across the node list (configureRpc already probed node 1).
  for (let i = 0; i < 2; i++) {
    try {
      const conf = await attempt();
      if (!conf?.id) throw new Error("השידור החזיר אישור ללא txid");
      return {
        txid: conf.id,
        blockNum: conf.block_num ?? null,
      };
    } catch (e) {
      lastErr = e;
      // rotate to the next node and retry once
      try {
        steem.api.setOptions({ url: DEFAULT_NODES[(i + 1) % DEFAULT_NODES.length] });
      } catch {
        /* keep original */
      }
    }
  }
  const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
  throw new Error(cleanChainError(msg));
}

/** Translates verbose chain errors into short Hebrew guidance. */
export function cleanChainError(raw: string): string {
  const r = raw || "";
  // Authority (measured live: "missing required posting authority:Missing Posting Authority headcorner")
  if (/posting\s+authority/i.test(r))
    return "המפתח שחובר לא מתאים לפעולה הזו — נתק וחבר את מפתח ה-posting";
  if (/active\s+authority/i.test(r))
    return "המפתח שחובר לא מתאים לפעולה הזו — נתק וחבר את מפתח ה-active";
  if (/owner\s+authority/i.test(r))
    return "המפתח שחובר לא מתאים לפעולה הזו — נתק וחבר מפתח owner (אחזור-חירום בלבד)";
  // Witness-specific before the generic account lookup
  if (/non-existent witness|witness.*does not exist/i.test(r))
    return "העד לא נמצא בשרשרת";
  if (/does not exist|unknown account/i.test(r)) return "החשבון לא נמצא ברשת";
  // Balances
  if (/exceeds balance|insufficient funds|balance is too small|th_balance/i.test(r))
    return "אין מספיק יתרה";
  // Claims
  if (/must claim/i.test(r)) return "אין פרסים ממתינים";
  // Duplicate broadcast
  if (/duplicate/i.test(r)) return "עסקה זהה כבר התקבלה — המתן כמה שניות";
  // Resource credits
  if (/not enough rc|insufficient rc|resource credit|out of rc/i.test(r))
    return "אין מספיק RC";
  // Vesting / delegation (before the power-down wording — same family)
  if (
    /vesting shares cannot be larger|enough vesting shares|insufficient vesting|vesting shares.*delegate|delegat.*vesting shares/i.test(
      r
    )
  )
    return "אין מספיק SP פנוי";
  // Witness votes
  if (/already (voting|voted)|duplicate vote/i.test(r))
    return "כבר מצביעים על העד הזה";
  // Invalid amounts / parameters
  if (
    /must be positive|should be positive|invalid amount|invalid parameter|invalid argument|malformed|out of range/i.test(
      r
    )
  )
    return "פרמטרים לא תקינים";
  if (/now > expiration|expired/i.test(r)) return "פסק-זמן העסקה — נסה שוב";
  if (/power.*down.*vesting|withdraw.*vesting/i.test(r))
    return "בקשת ה-Power Down נדחתה על ידי השרשרת";
  if (/dgp|get_dynamic/i.test(r)) return "לא ניתן לקרוא מצב שרשרת — נסה שוב";
  return r.slice(0, 220) || "שגיאת שרשרת לא מוכרת";
}
