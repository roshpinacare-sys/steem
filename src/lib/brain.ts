import { execFile } from "child_process";

import { db } from "@/lib/db";
import {
  AGENT_DIR,
  readAgentEnv,
  readAgentStatus,
  upsertAgentEnv,
} from "@/lib/agent-env";
import { getLiveAccount } from "@/lib/steem/steem-live";

// ─────────────────────────────────────────────────────────────────────────────
// brain.ts — the autonomous production brain. Infers from live chain data what
// the account can produce, ranks the money paths, and — when the operator
// arms the local agent (opt-in key vault + real mode) — drives continuous
// execution: a server-side heartbeat every BRAIN_TICK_MIN that runs agent
// cycles when the daemon is absent/stale, journaling everything to SQLite.
//
// Economic constants are MEASURED, not invented:
//   CURATION_APR_EST 0.0248 — realized curation APR (2,100 ops, EFFICIENCY_AUDIT)
//   RENTAL_APR_EST  0.0415  — rental market median (13/13 daily payers, RENTAL_SCAN)
//
// Iron laws: no secrets here (env values pass through agent-env writers only;
// journal entries carry masked fingerprints at most); DRY_RUN remains the
// default until the operator explicitly flips real mode.
// ─────────────────────────────────────────────────────────────────────────────

export const BRAIN_TICK_MIN = 15;
export const CURATION_APR_EST = 0.0248;
export const RENTAL_APR_EST = 0.0415;
/** Public keys of the posting authority are public data — fingerprints only. */
const TICKER_STALE_MS = 30 * 60 * 1000;

type PlanItem = {
  id: string;
  title: string;
  kind: "claim" | "curation" | "rental" | "factory" | "hygiene";
  status: "active" | "ready" | "armed-dry" | "needs-key" | "needs-signing" | "blocked";
  requiredKey: "posting" | "active" | "none";
  expectedUsdMonth: number | null;
  why: string;
  how: string;
  actionLabel: string | null;
};

const usd2 = (n: number) => `$${n.toFixed(2)}`;

export async function journal(
  kind: string,
  title: string,
  detail = "",
): Promise<void> {
  try {
    await db.brainDecision.create({ data: { kind, title, detail } });
  } catch (e) {
    console.error("brain: journal write failed", e instanceof Error ? e.message : e);
  }
}

// ── Plan computation (pure given inputs) ─────────────────────────────────────

interface LiveLike {
  chain: { steemUsd: number; vest2sp: number; feedSbdPerSteem?: number; sbdUsd?: number };
  balances: { spOwn: number; spOut: number; pendingSp: number; pendingSteem: number; pendingSbd: number };
  power: { votingPower: number; rcPct: number };
  security: { staleAuths: number };
}

export function computePlan(
  live: LiveLike | null,
  env: Record<string, string>,
  status: { updatedAt?: string } | null,
): {
  plan: PlanItem[];
  totals: { activeUsdMonth: number; potentialUsdMonth: number };
  inference: {
    spOwn: number;
    spOwnUsd: number;
    vpPct: number;
    rcPct: number;
    pendingUsd: number;
    staleAuths: number;
    steemUsd: number;
    feedSbdPerSteem: number;
    conclusion: string;
  } | null;
} {
  if (!live) {
    return {
      plan: [],
      totals: { activeUsdMonth: 0, potentialUsdMonth: 0 },
      inference: null,
    };
  }

  const steemUsd = live.chain.steemUsd;
  const spOwnUsd = live.balances.spOwn * steemUsd;
  const pendingUsd =
    live.balances.pendingSp * steemUsd +
    live.balances.pendingSteem * steemUsd +
    live.balances.pendingSbd * (live.chain.sbdUsd ?? 0);
  const keyConfigured = Boolean(env.POSTING_WIF);
  const realMode = env.DRY_RUN === "false";
  const curationEnabled = env.CURATION_ENABLED === "true";
  const armed = keyConfigured && realMode;

  const plan: PlanItem[] = [];

  // 1) Claim engine — always-beneficial consolidation (posting key).
  plan.push({
    id: "claim",
    title: "מנוע תביעות אוטומטי",
    kind: "claim",
    status: armed ? "active" : keyConfigured ? "armed-dry" : "needs-key",
    requiredKey: "posting",
    expectedUsdMonth: null,
    why:
      live.balances.pendingSp + live.balances.pendingSteem > 0
        ? `יש פרסים מצטברים (≈${usd2(live.balances.pendingSp * steemUsd + live.balances.pendingSteem * steemUsd)}) — תביעה מפיקה אותם ל-SP שעובד. אפס סיכון.`
        : "כרגע אין פרסים ממתינים — המנוע מנטר ותובע אוטומטית ברגע שיצטברו, כדי שכל שקל יהפוך ל-SP עובד.",
    how: armed
      ? "פעיל — פעימת המוח מריצה מחזור agent אחת ל-15 דק' (או הדמון המקומי)."
      : keyConfigured
        ? "הפעל 'מצב אמיתי' בכרטיס — הסוכן יעבור מחזור תביעה אמיתי."
        : "חמש את הסוכן: שמור מפתח posting בכספת המקומית למטה.",
    actionLabel: armed ? null : keyConfigured ? "הפעל מצב אמיתי" : "חמש את הסוכן",
  });

  // 2) Curation engine — the main posting-key producer.
  const curationEv = (spOwnUsd * CURATION_APR_EST) / 12;
  plan.push({
    id: "curation",
    title: "מנוע אצירה (הצבעות חכמות)",
    kind: "curation",
    status: armed
      ? curationEnabled
        ? "active"
        : "ready"
      : keyConfigured
        ? "armed-dry"
        : "needs-key",
    requiredKey: "posting",
    expectedUsdMonth: curationEv,
    why: `SP עצמי ≈${usd2(spOwnUsd)} · תשואת אצירה ממומשת היסטורית ${(CURATION_APR_EST * 100).toFixed(2)}% APR → כ-${usd2(curationEv)}/חודש. כוח הצבעה ${live.power.votingPower.toFixed(0)}% — כל יום בלי הצבעות הוא הכנסה שלא נלקחה.`,
    how: armed
      ? curationEnabled
        ? "פעיל: עד 5 הצבעות/יום עם שער VP≥80% ודירוג BOT-3."
        : "הפעל את המנוע — דגל CURATION_ENABLED ייכתב מקומית."
      : keyConfigured
        ? "הפעל מצב אמיתי ואז את המנוע."
        : "דורש מפתח posting בכספת המקומית (הפעלה חד-פעמית למטה).",
    actionLabel: armed
      ? curationEnabled
        ? null
        : "הפעל מנוע אצירה"
      : keyConfigured
        ? "הפעל מצב אמיתי"
        : "חמש את הסוכן",
  });

  // 3) Rental — the measured passive champion (active key, one-time).
  const rentalEv = ((live.balances.spOwn - live.balances.spOut) * steemUsd * RENTAL_APR_EST) / 12;
  plan.push({
    id: "rental",
    title: "השכרת SP לשוק ההאצלות",
    kind: "rental",
    status: live.balances.spOut > 1 ? "active" : "needs-signing",
    requiredKey: "active",
    expectedUsdMonth: rentalEv,
    why: `תשואת השכרה חציונית שנמדדה ${(RENTAL_APR_EST * 100).toFixed(2)}% APR (משלמים יומיים אמיתיים) → כ-${usd2(rentalEv)}/חודש פסיבי — יותר מאצירה, אך דורש חתימת Active אחת ו-7 ימים להחזר SP.`,
    how: "פעם אחת: בעמוד 'חי' חבר Active ל-2 דקות, כרטיס 'האצלת SP' (מוכן מראש ל-upvu), חתום — וההכנסה זורמת מעצמה.",
    actionLabel: live.balances.spOut > 1 ? null : "זה מה שחסר לך הכי הרבה",
  });

  // 4) RC account factory — optionality (active key or vaulted ACTIVE_WIF).
  const activeKeyInVault = Boolean(env.ACTIVE_WIF);
  plan.push({
    id: "factory",
    title: "מפעל זכאויות חשבון (RC)",
    kind: "factory",
    status: activeKeyInVault && realMode
      ? env.FACTORY_ENABLED === "true"
        ? "active"
        : "ready"
      : activeKeyInVault
        ? "armed-dry"
        : "needs-key",
    requiredKey: "active",
    expectedUsdMonth: 0,
    why: "יצירת זכאויות חשבון בעלות RC בלבד (0.313$ תקרת ערך כרטיס) — אופציה חינמית שתשתלם כשייפתח שוק קונים; כרגע כמעט ללא היצע ביקוש בשוק הפנימי.",
    how: activeKeyInVault
      ? "הדגל FACTORY_ENABLED כבר נתמך בסוכן — דרוש מצב אמיתי."
      : "דורש Active: או חתימה חד-פעמית בדפדפן (A2) או ACTIVE_WIF בכספת — למתקדמים בלבד.",
    actionLabel: null,
  });

  // 5) Hygiene — only when stale posting auths exist.
  if (live.security.staleAuths > 0) {
    plan.push({
      id: "hygiene",
      title: "ניקוי הרשאות posting מיושנות",
      kind: "hygiene",
      status: "ready",
      requiredKey: "posting",
      expectedUsdMonth: null,
      why: `${live.security.staleAuths} אפליקציות ישנות (רובן נסגרו) מחזיקות הרשאת posting על החשבון — סיכון מיותר. ניקוי = פעולת posting אחת.`,
      how: "בעמוד 'חי' → פעולת 'ניקוי הרשאות' מוכנה מראש; חתימת posting בדפדפן.",
      actionLabel: "נקה דרך פעולות חי",
    });
  }

  const activeUsdMonth = plan
    .filter((p) => p.status === "active")
    .reduce((s, p) => s + (p.expectedUsdMonth ?? 0), 0);
  const potentialUsdMonth = plan.reduce((s, p) => s + (p.expectedUsdMonth ?? 0), 0);

  const daemonNote =
    status?.updatedAt && Date.now() - new Date(status.updatedAt).getTime() < TICKER_STALE_MS
      ? "הסוכן המקומי פעיל"
      : armed
        ? "פעימת המוח מפעילה מחזורי agent אוטומטית"
        : "הסוכן עוד לא חמוש";

  const conclusion =
    `בחשבון יש ≈${usd2(spOwnUsd)} ב-SP עצמי, כוח הצבעה ${live.power.votingPower.toFixed(0)}%, RC ${live.power.rcPct.toFixed(0)}%. ` +
    (pendingUsd > 0.01
      ? `ממתין לתביעה ≈${usd2(pendingUsd)}. `
      : "אין פרסים ממתינים. ") +
    `תשואה פעילה כרגע ≈${usd2(activeUsdMonth)}/חודש מתוך פוטנציאל מדוד ≈${usd2(potentialUsdMonth)}/חודש ` +
    `(אצירה ${(CURATION_APR_EST * 100).toFixed(1)}% + השכרה ${(RENTAL_APR_EST * 100).toFixed(1)}% APR). ${daemonNote}.`;

  return {
    plan,
    totals: { activeUsdMonth, potentialUsdMonth },
    inference: {
      spOwn: live.balances.spOwn,
      spOwnUsd,
      vpPct: live.power.votingPower,
      rcPct: live.power.rcPct,
      pendingUsd,
      staleAuths: live.security.staleAuths,
      steemUsd,
      feedSbdPerSteem: live.chain.feedSbdPerSteem ?? 0,
      conclusion,
    },
  };
}

// ── Heartbeat (server-side autonomy) ─────────────────────────────────────────

interface BrainGlobals {
  __saosBrainTimer?: ReturnType<typeof setInterval>;
  __saosBrainTicking?: boolean;
  __saosBrainLastTick?: { at: string; note: string } | null;
  __saosBrainLastNote?: string;
}
const g = globalThis as unknown as BrainGlobals;

export function lastTick(): { at: string; note: string } | null {
  return g.__saosBrainLastTick ?? null;
}

/** Spawn one agent cycle (node agent.cjs --once) — 90s cap. */
function spawnAgentOnce(): Promise<{ ok: boolean; summary: string }> {
  return new Promise((resolve) => {
    execFile(
      "node",
      ["agent.cjs", "--once"],
      { cwd: AGENT_DIR, timeout: 90_000, encoding: "utf8" },
      (err, stdout, stderr) => {
        if (err) {
          const tail = String(stderr || err.message).slice(-200);
          resolve({ ok: false, summary: tail });
          return;
        }
        const interesting = String(stdout)
          .split("\n")
          .filter((l) => l.includes("[") && !l.includes("[REDACTED"))
          .slice(-6)
          .join(" | ")
          .slice(-300);
        resolve({ ok: true, summary: interesting || "ok" });
      },
    );
  });
}

/**
 * One brain tick: if the agent is armed (key + real mode) and no fresh daemon
 * heartbeat exists, run an agent cycle ourselves and journal the result.
 */
export async function brainTick(manual = false): Promise<string> {
  if (g.__saosBrainTicking) return "tick skipped (already running)";
  g.__saosBrainTicking = true;
  try {
    const env = readAgentEnv();
    const status = readAgentStatus();
    const armed = Boolean(env.POSTING_WIF) && env.DRY_RUN === "false";

    let note: string;
    if (!armed) {
      note = "מוגן — חסר מפתח בכספת או שמצב יבש; אין ביצוע אוטונומי";
    } else {
      const lastAt = status?.updatedAt ? new Date(status.updatedAt).getTime() : 0;
      const stale = !lastAt || Date.now() - lastAt > TICKER_STALE_MS;
      if (stale) {
        const res = await spawnAgentOnce();
        note = res.ok
          ? `מחזור agent הורץ (דמון לא נצפה — פעימה לקחה שליטה): ${res.summary}`
          : `מחזור agent נכשל: ${res.summary}`;
        await journal("agent_exec", note.slice(0, 120), res.summary);
      } else {
        note = `הדמון המקומי פעיל (עודכן לפני ${Math.round((Date.now() - lastAt) / 60_000)} דק') — לא נדרשת התערבות`;
      }
    }

    g.__saosBrainLastTick = { at: new Date().toISOString(), note };
    if (manual || note !== g.__saosBrainLastNote) {
      g.__saosBrainLastNote = note;
      await journal("heartbeat", note.slice(0, 160), manual ? "manual" : "auto");
    }
    return note;
  } finally {
    g.__saosBrainTicking = false;
  }
}

/** Idempotently install the heartbeat interval (first brain GET). */
export function ensureHeartbeat(): void {
  if (g.__saosBrainTimer) return;
  g.__saosBrainTimer = setInterval(() => {
    void brainTick(false).catch(() => undefined);
  }, BRAIN_TICK_MIN * 60 * 1000);
  // Don't hold the process open just for the heartbeat.
  (g.__saosBrainTimer as unknown as { unref?: () => void }).unref?.();
}

// ── Vault validation (server-side, never logs the secret) ────────────────────

const WIF_RE = /^[5][1-9A-HJ-NP-Za-km-z]{50}$/;

async function rpcAuthorityPubkey(username: string, role: "posting" | "active"): Promise<string | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const res = await fetch("https://api.steemit.com", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "condenser_api.get_accounts",
        params: [[username]],
        id: 1,
      }),
      signal: ctrl.signal,
      cache: "no-store",
    });
    const json = (await res.json()) as {
      result?: {
        posting?: { key_auths: [string, number[]?][] | [string, number][] };
        active?: { key_auths: [string, number[]?][] | [string, number][] };
      }[];
    };
    const acc = json.result?.[0];
    const auths = role === "posting" ? acc?.posting?.key_auths : acc?.active?.key_auths;
    const first = auths?.[0];
    return Array.isArray(first) ? String(first[0]) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function rpcPostingPubkey(username: string): Promise<string | null> {
  return rpcAuthorityPubkey(username, "posting");
}

export type VaultResult =
  | { ok: true; masked: string; pubkey: string }
  | { ok: false; error: string };

/**
 * Validate a posting WIF against the on-chain posting authority and store it
 * in agent/.env (machine-local, git-ignored). Returns only the PUBLIC
 * fingerprint. The secret is never logged and never returned.
 */
export async function vaultPostingKey(
  username: string,
  postingWif: string,
): Promise<VaultResult> {
  const wif = postingWif.trim();
  if (!WIF_RE.test(wif)) {
    return { ok: false, error: "תבנית מפתח לא תקינה — WIF של Steem הוא 51 תווים המתחילים ב-5" };
  }

  let steem: {
    auth: { wifToPublic: (w: string) => string };
  };
  try {
    const mod = await import("steem");
    steem = (mod.default ?? mod) as typeof steem;
  } catch {
    return { ok: false, error: "מנוע האימות המקומי אינו זמין — נסה שוב" };
  }

  let pubkey: string;
  try {
    pubkey = steem.auth.wifToPublic(wif);
  } catch {
    return { ok: false, error: "לא ניתן לגזור מפתח ציבורי מהקלט" };
  }

  const chainPub = await rpcPostingPubkey(username);
  if (!chainPub) {
    return { ok: false, error: "לא ניתן לקרוא הרשאות מהשרשרת — נסה שוב" };
  }
  if (pubkey !== chainPub) {
    return {
      ok: false,
      error: "המפתח לא תואם להרשאת posting של החשבון בשרשרת — לא נשמר כלום",
    };
  }

  upsertAgentEnv({
    AGENT_ACCOUNT: username,
    POSTING_WIF: wif,
    POSTING_WIF_PUB: pubkey,
  });
  return {
    ok: true,
    masked: `${pubkey.slice(0, 6)}…${pubkey.slice(-4)}`,
    pubkey,
  };
}

export function clearPostingKey(): void {
  upsertAgentEnv({ POSTING_WIF: null, POSTING_WIF_PUB: null });
}

/**
 * Task 36 — validate an ACTIVE WIF against the on-chain active authority and
 * store ACTIVE_WIF in agent/.env. The Active key is the single unlock for:
 * the DEX bid-side escrow, Hive-Engine sidechain execution (sidechain ops
 * empirically require required_auths), and the RC account factory. Same iron
 * rules as the posting vault: validate against the chain, store machine-local,
 * never return/log the secret.
 */
export async function vaultActiveKey(
  username: string,
  activeWif: string,
): Promise<VaultResult> {
  const wif = activeWif.trim();
  if (!WIF_RE.test(wif)) {
    return { ok: false, error: "תבנית מפתח לא תקינה — WIF של Steem הוא 51 תווים המתחילים ב-5" };
  }

  let steem: {
    auth: { wifToPublic: (w: string) => string };
  };
  try {
    const mod = await import("steem");
    steem = (mod.default ?? mod) as typeof steem;
  } catch {
    return { ok: false, error: "מנוע האימות המקומי אינו זמין — נסה שוב" };
  }

  let pubkey: string;
  try {
    pubkey = steem.auth.wifToPublic(wif);
  } catch {
    return { ok: false, error: "לא ניתן לגזור מפתח ציבורי מהקלט" };
  }

  const chainPub = await rpcAuthorityPubkey(username, "active");
  if (!chainPub) {
    return { ok: false, error: "לא ניתן לקרוא הרשאות active מהשרשרת — נסה שוב" };
  }
  if (pubkey !== chainPub) {
    return {
      ok: false,
      error: "המפתח לא תואם להרשאת active של החשבון בשרשרת — לא נשמר כלום",
    };
  }

  upsertAgentEnv({
    AGENT_ACCOUNT: username,
    ACTIVE_WIF: wif,
    ACTIVE_WIF_PUB: pubkey,
  });
  return {
    ok: true,
    masked: `${pubkey.slice(0, 6)}…${pubkey.slice(-4)}`,
    pubkey,
  };
}

export function clearActiveKey(): void {
  upsertAgentEnv({ ACTIVE_WIF: null, ACTIVE_WIF_PUB: null });
}

export function setRealMode(real: boolean): void {
  upsertAgentEnv({
    DRY_RUN: real ? "false" : "true",
    CURATION_ENABLED: real ? "true" : "false",
  });
}

export function setCuration(enabled: boolean): void {
  upsertAgentEnv({ CURATION_ENABLED: enabled ? "true" : "false" });
}

/** Task 32 — sovereign DEX market-maker flag (agent/.env DEX_MM_ENABLED). */
export function setDexMm(enabled: boolean): void {
  upsertAgentEnv({ DEX_MM_ENABLED: enabled ? "true" : "false" });
}
