// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · Agent-Exchange Core — שער-הסוכנים של הזירה (r192-c)
//
// המשימה: "API-סוופ משוער ERC-8004 + תשלום-x402 על Zero ($0 תשתית,
// סוכנים-בני-זהות על-השרשרת)" — היתרון-הייחודי מול התחרות: נזילות
// מגודרת-זהות לסוכני-AI עם תמחור-מוצהר (x402) וקפסות-קוד.
//
// הקובץ הזה מכוון להיות עצמאי-לגמרי (רק node ו-ethers) — כדי שבדיקות
// לוגיות יוכלו לייבא אותו ישירות מחוץ ל-Next (bun /tmp/r192-c-tests.mjs).
// כל מה שנוגע ב-DB ובספר נשאר בראוט וב-sovereign-exchange.ts.
//
// חוקי-רשת שממומשים כאן (r192-dex-plan, BLOCKER):
//   · [L3] עמלה מוצהרת + מינימום-עסקה $2 — X402_FEE_BPS / MIN_NOTIONAL_USD
//   · [L4] קפסות מוגדרות-קוד + kill-switch ~/.sovereign/dex-kill
//   · [L5] dry-run מוצהר — הראוט מציע dryRun לפני שערי-חיים
//
// סכמת-זהות (מתועדת בכנות — "lightweight nonce-signature check"):
//   · הסוכן מזדהה ב-X-Agent-Id — חייב להימצא ברישום ERC-8004
//     (sovereign/agents/erc8004-registry.json — 13 זהויות על-השרשרת).
//   · לכל זהות רשומה כתובת eip155:9369 — הבקשה חייבת חתימה
//     personal_sign על הודעת-כוונה קנונית (buildIntentMessage) שמתארת
//     את הסוופ המלא (זוג, צד, סכום, מינימום, עמלה, nonce, issuedAt).
//     ethers.verifyMessage משחזר את הכתובת — חייבת להתאים לרישום.
//   · טריות: issuedAt בתוך 10 דקות. nonce: מונפק דרך נקודת-האתגר
//     (GET ?action=challenge) ונצרך פעם-אחת (best-effort בזיכרון — אחרי
//     הפעלה-מחדש של השרת הטריות נשענת על issuedAt בלבד). זו לא
//     סכמת-EIP-712/EIP-3009 מלאה — כך זה מתועד, וכך זה נבדק.
// ─────────────────────────────────────────────────────────────────────

import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ethers } from "ethers";

// ── קבועי-חוק (הכול מוגדר-קוד — L4) ──────────────────────────────────

export const X402_VERSION = 1;

/** עמלת-ה-API של הסוכן (x402) — נוספת על עמלת-הבריכה (30bps שנשארת
 * בבריכה). מוצהרת בכל ציטוט ונגבית בספר לאוצר בפועל. */
export const X402_FEE_BPS = 50; // 0.5% מהנוטינאל
export const X402_FEE_MIN_USDS = 0.02; // רצפת-עמלה

/** [L3] מינימום-עסקה $2 */
export const MIN_NOTIONAL_USD = 2;

/** [L4] קפסות-סוכן: לעסקה וליום (מתחילים $50/יום לסוכן לפי המשימה) */
export const AGENT_PER_TX_CAP_USD = 25;
export const AGENT_DAILY_CAP_USD = 50;

/** טריות-הודעה החתומה */
export const INTENT_FRESH_MS = 10 * 60_000;

export const IDENTITY_REQUIRED_HEADERS = ["X-Agent-Id", "X-Agent-Signature", "X-PAYMENT"] as const;

// ── נתיבים (מחוץ-לגיט, קריאה-בלבד בכל בקשה) ──────────────────────────

export function registryPaths(): string[] {
  const rel = path.join("sovereign", "agents", "erc8004-registry.json");
  const out = [path.join(process.cwd(), rel)];
  try {
    out.push(path.join(os.homedir(), "my-project", rel));
  } catch { /* homedir תמיד קיים בפועל */ }
  return out;
}

export function killFilePath(): string {
  return path.join(os.homedir(), ".sovereign", "dex-kill");
}

// ── kill-switch — נקרא בכל בקשה (L4) ─────────────────────────────────

export interface KillState {
  killed: boolean;
  reason: string | null;
  at: string;
}

export function readKillSwitch(): KillState {
  const p = killFilePath();
  try {
    if (!fs.existsSync(p)) return { killed: false, reason: null, at: new Date().toISOString() };
    // תוכן-הקובץ הוא סיבת-העצירה של המפעיל — מוצג ביושר (ללא-סודות מעצם-טבעו)
    const raw = fs.readFileSync(p, "utf8").trim().slice(0, 200);
    return { killed: true, reason: raw || "kill-switch present (no reason recorded)", at: new Date().toISOString() };
  } catch (e) {
    // כשל-קריאה = לא מסוכן-לכיוון-הפתיחה: עוצרים בכנות (fail-closed)
    return { killed: true, reason: `kill-switch unreadable: ${String((e as Error).message ?? e).slice(0, 80)}`, at: new Date().toISOString() };
  }
}

// ── רישום ERC-8004 ────────────────────────────────────────────────────

export interface RegistryAgent {
  name: string;
  role: string | null;
  status: string | null;
  /** כתובת eip155:9369 בצ'קסאם — או null אם אין רישום-EVM תקין */
  address: string | null;
}

interface RegistryCache {
  at: number;
  agents: Map<string, RegistryAgent>;
  count: number;
}

let registryCache: RegistryCache | null = null;
const REGISTRY_TTL_MS = 60_000;

/** טוען את רישום הזהויות מהקובץ (מקור-אמת: sovereign/ledger.json —
 * זו תצפית-תואמת-סטנדרט; כך הרישום עצמו מגדיר את עצמו ב-notes). */
export function loadRegistry(): { agents: Map<string, RegistryAgent>; count: number; source: string | null } {
  if (registryCache && Date.now() - registryCache.at < REGISTRY_TTL_MS) {
    return { agents: registryCache.agents, count: registryCache.count, source: "cache" };
  }
  const agents = new Map<string, RegistryAgent>();
  let count = 0;
  let source: string | null = null;
  for (const p of registryPaths()) {
    try {
      if (!fs.existsSync(p)) continue;
      const raw = JSON.parse(fs.readFileSync(p, "utf8")) as {
        agents?: Array<{
          name?: string;
          registrations?: Array<{ domain?: string; identifier?: string }>;
          x_weave?: { role?: string; status?: string };
        }>;
      };
      for (const a of raw.agents ?? []) {
        if (!a.name) continue;
        const evm = (a.registrations ?? []).find((r) => r.domain === "eip155:9369" && typeof r.identifier === "string");
        let address: string | null = null;
        if (evm?.identifier) {
          try { address = ethers.getAddress(evm.identifier); } catch { address = null; }
        }
        agents.set(a.name, {
          name: a.name,
          role: a.x_weave?.role ?? null,
          status: a.x_weave?.status ?? null,
          address,
        });
        count += 1;
      }
      source = p;
      break;
    } catch { /* הנתיב הבא */ }
  }
  registryCache = { at: Date.now(), agents, count };
  return { agents, count, source };
}

export function lookupAgent(agentId: string): RegistryAgent | null {
  const { agents } = loadRegistry();
  return agents.get(agentId) ?? null;
}

/** חבר-הספר של הסוכן — מרווח משמות-החברים האנושיים */
export function agentBookMember(agentId: string): string {
  return `agent:${agentId}`;
}

// ── מתמטיקת-עמלות וקפסות (טהור — נבדק ישירות) ────────────────────────

function round6(x: number): number {
  return Math.round(x * 1e6) / 1e6;
}

/** עמלת-x402 מוצהרת: notional × 50bps עם רצפת $0.02 (USDS) */
export function agentFeeUsd(notionalUsd: number): number {
  const raw = Math.max(X402_FEE_MIN_USDS, (notionalUsd * X402_FEE_BPS) / 10_000);
  return round6(raw);
}

export type CapVerdict = { ok: true } | { ok: false; code: "TX-CAP" | "DAY-CAP"; detail: string };

/** הכרעת-קפסות [L4] — טהור: קלט הנוטינאל והצבירה-היומית שנמדדו מהספר */
export function capDecision(notionalUsd: number, usedTodayUsd: number): CapVerdict {
  if (notionalUsd > AGENT_PER_TX_CAP_USD) {
    return { ok: false, code: "TX-CAP", detail: `נוטינאל $${round6(notionalUsd)} מעל תקרת-העסקה $${AGENT_PER_TX_CAP_USD} (L4)` };
  }
  if (usedTodayUsd + notionalUsd > AGENT_DAILY_CAP_USD) {
    return {
      ok: false,
      code: "DAY-CAP",
      detail: `צבירה-יומית $${round6(usedTodayUsd)} + $${round6(notionalUsd)} חוצה תקרת-היום $${AGENT_DAILY_CAP_USD} (L4)`,
    };
  }
  return { ok: true };
}

// ── הודעת-כוונה קנונית + חתימה ───────────────────────────────────────

export interface SwapIntent {
  agentId: string;
  pair: string;
  side: "A2B" | "B2A";
  amountIn: number;
  minOut: number;
  feeAsset: "USDS" | "SAOS";
  feeAmount: number;
  nonce: string;
  issuedAt: string; // ISO
}

/** הודעת-הכוונה שהסוכן חותם עליה (personal_sign) — קנונית ונבדקת-שדה-שדה */
export function buildIntentMessage(i: SwapIntent): string {
  return [
    "THE-WEAVE x402 agent-swap v1",
    `agent: ${i.agentId}`,
    `pair: ${i.pair}`,
    `side: ${i.side}`,
    `amountIn: ${i.amountIn}`,
    `minOut: ${i.minOut}`,
    `fee: ${i.feeAmount} ${i.feeAsset}`,
    `nonce: ${i.nonce}`,
    `issuedAt: ${i.issuedAt}`,
    "",
  ].join("\n");
}

export function intentHash(i: SwapIntent): string {
  return createHash("sha256").update(buildIntentMessage(i)).digest("hex");
}

// ── מנון-אתגר (nonce single-use, best-effort בזיכרון) ─────────────────

interface NonceEntry { issuedAt: number; exp: number }
const nonceStore = new Map<string, Map<string, NonceEntry>>(); // agentId → nonce → entry
const NONCE_TTL_MS = INTENT_FRESH_MS;

function pruneNonces() {
  const now = Date.now();
  for (const [agent, m] of nonceStore) {
    for (const [n, e] of m) if (e.exp < now) m.delete(n);
    if (m.size === 0) nonceStore.delete(agent);
  }
}

export function issueNonce(agentId: string): { nonce: string; issuedAt: string; ttlSec: number } {
  pruneNonces();
  const nonce = randomBytes(16).toString("hex");
  const now = Date.now();
  let m = nonceStore.get(agentId);
  if (!m) { m = new Map(); nonceStore.set(agentId, m); }
  m.set(nonce, { issuedAt: now, exp: now + NONCE_TTL_MS });
  return { nonce, issuedAt: new Date(now).toISOString(), ttlSec: Math.floor(NONCE_TTL_MS / 1000) };
}

function consumeNonce(agentId: string, nonce: string): boolean {
  pruneNonces();
  const m = nonceStore.get(agentId);
  if (!m || !m.has(nonce)) return false; // לא נמצא (או אוכל) — הטריות עדיין נאכפת דרך issuedAt
  m.delete(nonce);
  return true;
}

// ── אימות-חתימה מול הרישום ───────────────────────────────────────────

export type SignatureCheck =
  | { ok: true; address: string; nonceWasIssued: boolean }
  | { ok: false; code: "UNKNOWN-AGENT" | "NO-ADDRESS" | "BAD-SIGNATURE" | "STALE-INTENT" | "BAD-INTENT"; detail: string };

/** אימות קל-משקל: הודעה קנונית + personal_sign → כתובת מהרישום.
 *  טריות ≤10 דק' מ-issuedAt; nonce נצרך אם הונפק כאן. */
export function verifyAgentSignature(i: SwapIntent, signature: string): SignatureCheck {
  const agent = lookupAgent(i.agentId);
  if (!agent) {
    return { ok: false, code: "UNKNOWN-AGENT", detail: `אין זהות ERC-8004 בשם "${i.agentId}" — השער נעול (רישום ${loadRegistry().count} זהויות)` };
  }
  if (!agent.address) {
    return { ok: false, code: "NO-ADDRESS", detail: `לזהות "${i.agentId}" אין כתובת eip155:9369 תקינה ברישום — אין למה לאמת` };
  }
  if (agent.status && agent.status !== "ACTIVE") {
    return { ok: false, code: "UNKNOWN-AGENT", detail: `זהות "${i.agentId}" בסטטוס ${agent.status} — לא פעילה` };
  }
  const t = Date.parse(i.issuedAt);
  if (!Number.isFinite(t)) {
    return { ok: false, code: "BAD-INTENT", detail: "issuedAt אינו ISO-8601 תקין" };
  }
  if (Math.abs(Date.now() - t) > INTENT_FRESH_MS) {
    return { ok: false, code: "STALE-INTENT", detail: `הכוונה ישנה מ-${Math.round(INTENT_FRESH_MS / 60_000)} דק' — גש לאתגר מחדש (GET ?action=challenge)` };
  }
  let recovered: string;
  try {
    recovered = ethers.verifyMessage(buildIntentMessage(i), signature);
  } catch (e) {
    return { ok: false, code: "BAD-SIGNATURE", detail: `חתימה לא ניתנת לשחזור: ${String((e as Error).message ?? e).slice(0, 80)}` };
  }
  if (recovered.toLowerCase() !== agent.address.toLowerCase()) {
    return { ok: false, code: "BAD-SIGNATURE", detail: `החתימה משוחזרת ל-${recovered} — לא לכתובת הרישום של "${i.agentId}"` };
  }
  const nonceWasIssued = consumeNonce(i.agentId, i.nonce);
  return { ok: true, address: agent.address, nonceWasIssued };
}

// ── כותרת-תשלום x402 ────────────────────────────────────────────────

export interface ParsedPayment {
  ok: boolean;
  scheme: string | null;
  asset: string | null;
  amount: number | null;
  error?: string;
}

/** מקבל base64url (סטנדרט x402) או JSON גולמי — סלחן-קלט, נוקשה-בדיקה */
export function parsePaymentHeader(raw: string | null): ParsedPayment {
  if (!raw || !raw.trim()) return { ok: false, scheme: null, asset: null, amount: null, error: "PAYMENT-ABSENT" };
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    try {
      const dec = Buffer.from(raw.replace(/^base64url:/, ""), "base64url").toString("utf8");
      obj = JSON.parse(dec);
    } catch (e) {
      return { ok: false, scheme: null, asset: null, amount: null, error: `PAYMENT-UNPARSEABLE: ${String((e as Error).message ?? e).slice(0, 60)}` };
    }
  }
  const p = obj as { scheme?: string; asset?: string; amount?: number | string };
  const amount = typeof p.amount === "string" ? Number(p.amount) : typeof p.amount === "number" ? p.amount : NaN;
  if (typeof p.scheme !== "string" || typeof p.asset !== "string" || !Number.isFinite(amount) || amount <= 0) {
    return { ok: false, scheme: p.scheme ?? null, asset: p.asset ?? null, amount: null, error: "PAYMENT-MALFORMED: נדרש {scheme, asset, amount>0}" };
  }
  return { ok: true, scheme: p.scheme, asset: p.asset, amount };
}
