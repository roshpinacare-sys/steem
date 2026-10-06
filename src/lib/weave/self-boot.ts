// ─────────────────────────────────────────────────────────────────────
// SELF-BOOT · אתחול-עצמי ריבוני של הבית (D-027 · r138)
//
// הוראת המפעיל (2026-09-29): "אני לא רוצה שזה יהיה תלוי בי — שזה יהיה
// מחובר קבוע, אוטונומית, ריבונית, ללא תלות בהפעלה שלי."
//
// הפער שנסגר כאן: עד היום אחרי מיחזור-סנדבוקס (DB אפמרלי, D-024) הבית
// קם חצי-חי — fleet-guard מקים דיבונים, אבל מי שמקים את הסכימה, את
// כספת-הארנק ואת הספר מהגיט — זה היה פרוטוקול full-revive שדורש יד
// (סוכן או מפעיל). r135 הוכיח את המחיר: שתיקה של ערוצי-החוצה בגלל
// סכימה שנעלמה. החוק החדש: **עליית-השרת עצמה היא פרוטוקול-ההחייאה.**
//
// ארבעת הצעדים (כולם אידמפוטנטיים, מתוקצבים, עם קבלות):
//   1. schema   — בדיקת-סכימה חיה; סכימה חסרה ⇒ `bun run db:push`
//                 (רק כשנמדד חסר — לעולם לא על בריא)
//   2. book     — ספר ריק + ספר-גיט על הדיסק ⇒ ייבוא מלא משמר-מפתחות
//                 (ledger-sync) + אימות-שרשרת מחדש; ואז משיכת-סנכרון
//                 נדחית מ-origin (הענן הוא הקנון הטרי)
//   3. vault    — כספת-הארנק חסרה/שונה ⇒ שחזור מהענן בחוק r116
//                 (בדיוק 4,046,848 בייטים · SQLite magic · אטום)
//   4. credentials — נוכחות-בוליאנית בלבד (אפס קריאת-תוכן)
//
// פסקי-דין: RESURRECTED (הבית ריפא את עצמו) · HEALTHY (בריא) ·
// DEGRADED (כישלון כנה — הענן נושא את העומס בינתיים).
// כל הכרעה: ChainRun (chain="self-boot") + state-JSON + לוג (D-024:
// העמידות היא גיט + שרשרות + state-JSON — ה-DB אינו שכבת-התמדה).
// אפס סודות בלוגים — טוקנים נעים בזיכרון-בקשה בלבד.
// לולאה-יחידה ב-globalThis (חוק R80).
// ─────────────────────────────────────────────────────────────────────

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { db } from "@/lib/db";
import { parseLedgerSnapshot, importLedger } from "./ledger-sync";
import { verifyLedger } from "./beat";
// r147-d · גוף-אחד: כתיבה-אטומית מהגרעין-המשותף (src/lib/weave/atomic.ts — R107b)
import { writeJsonAtomic, writeBytesAtomic } from "./atomic";

const HOME = "/home/z/my-project";
const STATE_FILE = `${HOME}/sovereign/keeper/self-boot-state.json`;
const LOG_DIR = `${HOME}/sovereign/keeper/logs`;
const VAULT_PATH = `${HOME}/db/wallet-vault.db`;
const VAULT_EXPECTED_BYTES = 4_046_848; // חוק r116 — הגודל המדויק של הכספת מהענן
const VAULT_SOURCE = "roshpinacare-sys/Saosmartwallet/contents/db/custom.db";
const LEDGER_PATH = `${HOME}/sovereign/ledger.json`;
const MIN_TABLES = 20; // לסכימה הקנונית 23 טבלאות; פחות מזה = סנדבוקס טרי
const DELAY_MS = 3_000;
const SYNC_DELAY_MS = 90_000; // משיכת-הסנכרון נדחית עד שהשרת בהחלט מקשיב

export type SelfBootVerdict = "RESURRECTED" | "HEALTHY" | "DEGRADED";
export type StepVerdict = "PASS" | "SKIP" | "FAIL";

export interface SelfBootStep {
  name: string;
  verdict: StepVerdict;
  detail: string;
  at: string;
}

export interface SelfBootState {
  service: "self-boot";
  format: "self-boot-state-v1";
  decision: string; // D-027
  bootedAt: string;
  runs: number;
  lastRunAt: string | null;
  lastVerdict: SelfBootVerdict | null;
  lastSteps: SelfBootStep[];
}

interface SelfBootGlobal {
  __weaveSelfBoot?: { started: boolean; running: boolean };
}

const g = globalThis as typeof globalThis & SelfBootGlobal;

function utcIso(): string {
  return new Date().toISOString();
}

function readState(): SelfBootState {
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) as SelfBootState;
    if (raw && raw.service === "self-boot" && raw.format === "self-boot-state-v1") return raw;
  } catch {}
  return {
    service: "self-boot",
    format: "self-boot-state-v1",
    decision: "D-027",
    bootedAt: utcIso(),
    runs: 0,
    lastRunAt: null,
    lastVerdict: null,
    lastSteps: [],
  };
}

function writeState(s: SelfBootState): void {
  try {
    // r147-d: כתיבה-אטומית מהגרעין-המשותף (src/lib/weave/atomic.ts — R107b)
    writeJsonAtomic(STATE_FILE, s);
  } catch {}
}

function appendLog(line: string): void {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(`${LOG_DIR}/self-boot.log`, `${utcIso()} ${line}\n`);
  } catch {}
}

async function receipt(step: string, ok: boolean, detail: string): Promise<void> {
  try {
    await db.chainRun.create({
      data: { chain: "self-boot", step, firedBy: "self-boot", ok, detail },
    });
  } catch {
    // ה-DB עצמו עשוי להיות הפצוע — הקבלה הקובצית והלוג נושאים את האמת
  }
}

function resolveBun(): string {
  const candidates = ["/usr/local/bin/bun", "/usr/bin/bun", "/home/z/.bun/bin/bun"];
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c;
    } catch {}
  }
  return "bun";
}

/** מספר-טבלאות חי — null אם ה-DB לא ניתן לשאילתה כלל */
async function tableCount(): Promise<number | null> {
  try {
    const rows = await db.$queryRaw`SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table'`;
    return Number((rows as Array<{ n: number | bigint }>)[0]?.n ?? 0);
  } catch {
    return null;
  }
}

/** טוקן-ענן לשחזור הכספת — לעולם לא מודפס, לעולם לא נשמר */
function cloudTokens(): Array<{ label: string; token: string }> {
  const sources: Array<{ label: string; token: string }> = [];
  try {
    const t = fs.readFileSync(`${HOME}/upload/pat.env`, "utf8").trim();
    if (t.length > 20) sources.push({ label: "upload/pat.env", token: t });
  } catch {}
  try {
    const url = spawnSync("git", ["remote", "get-url", "origin"], {
      cwd: HOME,
      encoding: "utf8",
    }).stdout?.trim();
    const m =
      /https:\/\/([^@/:]+)@github\.com/.exec(url ?? "") ??
      /:\/\/([^@/:]+):[^@]*@github\.com/.exec(url ?? "");
    if (m) sources.push({ label: "remote origin (embedded)", token: m[1] });
  } catch {}
  return sources;
}

async function restoreVaultFromCloud(): Promise<{ ok: boolean; detail: string }> {
  const sources = cloudTokens();
  if (sources.length === 0) {
    return { ok: false, detail: "אין מקור-טוקן זמין (upload/pat.env ו-origin) — הכספת לא שוחזרה; הענן נושא את העומס" };
  }
  let bytes: Uint8Array | null = null;
  let usedLabel: string | null = null;
  let lastErr = "";
  for (const src of sources) {
    try {
      const res = await fetch(`https://api.github.com/repos/${VAULT_SOURCE}`, {
        headers: {
          Authorization: `token ${src.token}`,
          Accept: "application/vnd.github.raw",
          "User-Agent": "weave-self-boot",
        },
        signal: AbortSignal.timeout(120_000),
      });
      if (res.ok) {
        bytes = new Uint8Array(await res.arrayBuffer());
        usedLabel = src.label;
        break;
      }
      lastErr = `http ${res.status}`;
    } catch (e) {
      lastErr = String(e instanceof Error ? e.message : e).slice(0, 80);
    }
  }
  if (!bytes) {
    return { ok: false, detail: `הורדה מהענן נכשלה (${sources.map((s) => s.label).join(", ")}; אחרון: ${lastErr})` };
  }
  if (bytes.byteLength !== VAULT_EXPECTED_BYTES) {
    return {
      ok: false,
      detail: `גודל שהתקבל ${bytes.byteLength.toLocaleString("en-US")} ≠ ${VAULT_EXPECTED_BYTES.toLocaleString("en-US")} המצופה (${usedLabel}) — לא נכתב, בכנות`,
    };
  }
  const magic = Buffer.from(bytes.slice(0, 15)).toString("utf8");
  if (magic !== "SQLite format 3") {
    return { ok: false, detail: `התוכן אינו SQLite (magic "${magic.slice(0, 8)}…") — לא נכתב` };
  }
  try {
    // r147-d: כתיבה-אטומית מהגרעין-המשותף (writeBytesAtomic — R107b) — אטום:
    // רגע-מוות לא משאיר כספת חצויה
    writeBytesAtomic(VAULT_PATH, bytes);
    return { ok: true, detail: `שוחזר מהענן (${usedLabel}) · ${VAULT_EXPECTED_BYTES.toLocaleString("en-US")} בייטים בדיוק · SQLite תקין` };
  } catch (e) {
    return { ok: false, detail: `כתיבה נכשלה: ${String(e instanceof Error ? e.message : e).slice(0, 120)}` };
  }
}

/** משיכת-סנכרון נדחית מ-origin — הענן הוא הקנון הטרי (רק אחרי תחייה) */
function scheduleRemoteSync(): void {
  const attempts = 4;
  for (let i = 0; i < attempts; i++) {
    setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch("http://127.0.0.1:3000/api/weave/sovereignty/sync", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{}",
            signal: AbortSignal.timeout(300_000),
            cache: "no-store",
          });
          const j = (await res.json().catch(() => ({}))) as { ok?: boolean; synced?: number };
          if (res.ok && j.ok === true) {
            appendLog(`remote-sync ok synced=${j.synced ?? "?"} (ניסיון ${i + 1}/${attempts})`);
            await receipt("remote-sync", true, `הספר נמשך מ-origin (synced=${j.synced ?? "?"})`);
          }
        } catch {
          // ניסיון-שקט — הניסיונות הבאים ימדדו
        }
      })();
    }, SYNC_DELAY_MS + i * 45_000);
  }
}

async function runSelfBoot(): Promise<void> {
  const st = g.__weaveSelfBoot;
  if (!st || st.running) return;
  st.running = true;

  const steps: SelfBootStep[] = [];
  const at0 = utcIso();
  let resurrected = false;
  let anyFail = false;

  try {
    // ── צעד 1: schema ────────────────────────────────────────────────
    try {
      let tables = await tableCount();
      if (tables != null && tables >= MIN_TABLES) {
        steps.push({ name: "schema", verdict: "SKIP", detail: `הסכימה חיה (${tables} טבלאות) — לא נוגעים`, at: utcIso() });
      } else {
        const before = tables ?? "לא ניתן לשאילתה";
        const push = spawnSync(resolveBun(), ["run", "db:push"], {
          cwd: HOME,
          encoding: "utf8",
          timeout: 300_000,
        });
        const okPush = push.status === 0;
        const after = await tableCount();
        const ok = okPush && after != null && after >= MIN_TABLES;
        if (ok) resurrected = true;
        else anyFail = true;
        steps.push({
          name: "schema",
          verdict: ok ? "PASS" : "FAIL",
          detail: ok
            ? `סכימה חסרה נמדדה (${before} טבלאות) — db:push הקים (${after} טבלאות)`
            : `db:push נכשל (קוד ${push.status}) — ${String(push.stderr ?? "").slice(0, 120) || "ללא פלט"}`,
          at: utcIso(),
        });
      }
    } catch (e) {
      anyFail = true;
      steps.push({ name: "schema", verdict: "FAIL", detail: String(e instanceof Error ? e.message : e).slice(0, 140), at: utcIso() });
    }

    // ── צעד 2: book ──────────────────────────────────────────────────
    try {
      let attCount = -1;
      try {
        attCount = await db.attestation.count();
      } catch {
        attCount = -1;
      }
      if (attCount > 0) {
        steps.push({ name: "book", verdict: "SKIP", detail: `הספר חי (${attCount} אימותים) — לא נוגעים`, at: utcIso() });
      } else {
        const diskOk = fs.existsSync(LEDGER_PATH);
        if (!diskOk) {
          steps.push({ name: "book", verdict: "FAIL", detail: "ספר ריק ואין sovereign/ledger.json על הדיסק — הענן נושא את הקנון", at: utcIso() });
          anyFail = true;
        } else {
          const snap = parseLedgerSnapshot(fs.readFileSync(LEDGER_PATH, "utf8"));
          if (snap.attestations.length === 0) {
            steps.push({ name: "book", verdict: "FAIL", detail: "ספר-הדיסק ריק מאימותים — לא מייבאים ריקות", at: utcIso() });
            anyFail = true;
          } else {
            const imported = await importLedger(snap);
            const verify = await verifyLedger();
            if (verify.valid) resurrected = true;
            else anyFail = true;
            steps.push({
              name: "book",
              verdict: verify.valid ? "PASS" : "FAIL",
              detail:
                `ספר ריק נמדד — יובא מהגיט: ${imported.imported.attestations} אימותים · ${imported.imported.checkpoints} checkpoints · ` +
                `אימות-מחדש: ${verify.valid ? "תקין" : "שבור"} (${verify.sigOk}/${verify.checked} חתימות)`,
              at: utcIso(),
            });
          }
        }
      }
    } catch (e) {
      anyFail = true;
      steps.push({ name: "book", verdict: "FAIL", detail: String(e instanceof Error ? e.message : e).slice(0, 140), at: utcIso() });
    }

    // ── צעד 3: vault ─────────────────────────────────────────────────
    try {
      const stat = fs.existsSync(VAULT_PATH) ? fs.statSync(VAULT_PATH) : null;
      if (stat && stat.size === VAULT_EXPECTED_BYTES) {
        steps.push({ name: "vault", verdict: "SKIP", detail: `הכספת במקום (${VAULT_EXPECTED_BYTES.toLocaleString("en-US")} בייטים) — לא נוגעים`, at: utcIso() });
      } else {
        const r = await restoreVaultFromCloud();
        if (r.ok) resurrected = true;
        else anyFail = true;
        steps.push({ name: "vault", verdict: r.ok ? "PASS" : "FAIL", detail: r.detail, at: utcIso() });
      }
    } catch (e) {
      anyFail = true;
      steps.push({ name: "vault", verdict: "FAIL", detail: String(e instanceof Error ? e.message : e).slice(0, 140), at: utcIso() });
    }

    // ── צעד 4: credentials (בוליאני בלבד — אפס תוכן) ─────────────────
    try {
      const pat = fs.existsSync(`${HOME}/upload/pat.env`);
      const key = fs.existsSync(`${HOME}/upload/headcorner.txt`);
      steps.push({
        name: "credentials",
        verdict: "PASS",
        detail: `PAT: ${pat ? "קיים" : "חסר"} · מקור-מפתח: ${key ? "קיים" : "חסר"} — ${key ? "נתיב-החתימה המקומי זמין" : "הרשת מרוויחה מהענן בלי מפתח מקומי (D-025/D-026)"}`,
        at: utcIso(),
      });
    } catch (e) {
      steps.push({ name: "credentials", verdict: "FAIL", detail: String(e instanceof Error ? e.message : e).slice(0, 120), at: utcIso() });
    }

    const verdict: SelfBootVerdict = anyFail ? "DEGRADED" : resurrected ? "RESURRECTED" : "HEALTHY";

    // ── קבלות ────────────────────────────────────────────────────────
    for (const s of steps) {
      await receipt(s.name, s.verdict !== "FAIL", `[${s.verdict}] ${s.detail}`);
    }
    await receipt("summary", verdict !== "DEGRADED", `פסק-דין ${verdict} · ${steps.map((s) => `${s.name}:${s.verdict}`).join(" · ")}`);
    if (resurrected && verdict !== "DEGRADED") {
      appendLog(`RESURRECTED — הבית ריפא את עצמו; משיכת-סנכרון מ-origin מתוזמנת`);
      scheduleRemoteSync();
    }

    const state = readState();
    state.runs += 1;
    state.lastRunAt = at0;
    state.lastVerdict = verdict;
    state.lastSteps = steps;
    writeState(state);
  } finally {
    st.running = false;
  }
}

/** הצתת-האתחול-העצמי — אידמפוטנטית, לולאה-יחידה, נדחית 3ש' להתייצבות */
export function startSelfBoot(): void {
  if (g.__weaveSelfBoot?.started) return;
  g.__weaveSelfBoot = { started: true, running: false };
  appendLog("self-boot armed (server boot · D-027)");
  setTimeout(() => {
    void runSelfBoot();
  }, DELAY_MS);
}

/** קריאת-מצב למרשם-האוטונומיה — בוליאני/מונה בלבד, אפס סודות */
export function readSelfBootState(): SelfBootState | null {
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) as SelfBootState;
    if (raw && raw.service === "self-boot") return raw;
  } catch {}
  return null;
}
