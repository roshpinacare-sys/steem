#!/usr/bin/env node
/**
 * era3-fuel-gate.mjs — era-3 E3: "אין-גיבוי-דו-אתרי-מאושר = אין-דלק".
 * (ערכת era3-kit · אותו-חוק-שהוחל-על-הכספת-המקומית (G-M6) — כעת-גם-על-ה-runner)
 *
 * החוק-ההדדי (אישור-בעלים ×2, 2026-11-06):
 *   כל-העברת-מימון (transfer / transfer_to_vesting / delegate_vesting_shares /
 *   create_claimed_account / account_create) נחסמת בשער-זה אלמלא:
 *     (1) state/era3-export.json — ייצוא-מוצפן-טרי (≤ 26 שעות) על-הדיסק,
 *     (2) הייצוא הגיע-ל-GitHub (raw.githubusercontent — הוכחת-דו-אתריות, fail-closed),
 *     (3) state/era3-ack.json — אישור-ייבוא-מהכספת-המקומית: sha256-זהה-לייצוא-הנוכחי.
 *   הייצוא עצמו מופעל-מהשער (ריפוי-עצמי) כשהוא-חסר/ישן — הבלוק-מתמלא-מעצמו
 *   ברגע-שהצד-המקומי מייבא ודוחף את ה-ack.
 *
 * חיבור-ל-signer.mjs (שער-הביצוע-האחד):
 *   import { era3FuelGate } from "./era3-fuel-gate.mjs";
 *   // בתוך executeAs, מיד-אחרי בדיקת execPaused():
 *   const era3 = await era3FuelGate({ account, ops });
 *   if (!era3.ok) return { ok: false, verdict: era3.verdict, reason: era3.code, remediation: era3.remediation };
 *
 * עיצוב: פעולות-שוק/הצבעה/פרסום אינן-מושבתות (זמינות) — רק-זרימות-דלק.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const STATE = path.join(DIR, "state");
const EXPORT = path.join(STATE, "era3-export.json");
const ACK = path.join(STATE, "era3-ack.json");
const REPO = path.resolve(DIR, "..", ".."); // .../steem (כמו crown-vault-adopt.mjs)
const BRANCH = "saos-cockpit";
const RAW_URL = `https://raw.githubusercontent.com/roshpinacare-sys/steem/${BRANCH}/mini-services/saos-engine/state/era3-export.json`;

const MAX_EXPORT_AGE_MS = 26 * 3600 * 1000; // ייצוא-טרי
const MAX_ACK_AGE_MS = 8 * 24 * 3600 * 1000; // אישור-ייבוא-שבועי-מתחדש
const FUEL_OPS = new Set([
  "transfer", "transfer_to_vesting", "delegate_vesting_shares",
  "create_claimed_account", "account_create", "transfer_to_savings",
]);

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
import * as crypto from "node:crypto";

function readJson(p) { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } }

export function touchesFuel(ops) {
  return (ops ?? []).some(([name]) => FUEL_OPS.has(String(name)));
}

async function remoteProof() {
  // הוכחת-דו-אתריות: הייצוא-הזה באמת-עזב-את-המכונה (fail-closed על-רשת-לא-זמינה)
  try {
    const res = await fetch(RAW_URL, { signal: AbortSignal.timeout(15000), cache: "no-store" });
    if (!res.ok) return { ok: false, reason: `remote ${res.status}` };
    const remoteSha = sha256(await res.text());
    return { ok: true, remoteSha };
  } catch (e) {
    return { ok: false, reason: `remote unreachable: ${String(e?.message ?? e).slice(0, 80)}` };
  }
}

export async function era3FuelGate({ account, ops, tag = "era3" } = {}) {
  const deny = (code, reason, remediation) => ({
    ok: false, verdict: "ERA3-NO-FUEL", code, reason, remediation,
    law: "E3 · אין-גיבוי-דו-אתרי-מאושר = אין-דלק (אישור-בעלים ×2 2026-11-06)",
  });

  if (!touchesFuel(ops)) return { ok: true, verdict: "NOT-FUEL", note: "אין-זרימת-דלק בפעולות אלו — השער לא רלוונטי" };

  // (0) ייצוא-חסר/ישן → ריפוי-עצמי: נסה-לייצא-עכשיו (פעם-ל-6 שעות בלבד)
  let doc = readJson(EXPORT);
  const age = doc ? Date.now() - Date.parse(doc.exportedAt) : Infinity;
  if (!doc || age > 6 * 3600 * 1000) {
    try {
      const { runEra3Export } = await import("./era3-export.mjs");
      const r = await runEra3Export({ push: true });
      if (!r.ok) return deny("ERA3-EXPORT-REFUSED", `ייצוא-ריפוי-נדחה: ${r.code ?? "-"}`, r.remediation ?? "הצב era3-op-pub.json");
      doc = readJson(EXPORT);
    } catch (e) {
      return deny("ERA3-EXPORT-FAILED", `ייצוא-ריפוי-נכשל: ${String(e?.message ?? e).slice(0, 100)}`, "בדוק era3-op-pub.json + git push");
    }
  }
  if (!doc) return deny("ERA3-NO-EXPORT", "אין-ייצוא-מוצפן על-ה-runner", "הרץ node era3-export.mjs");

  const exportSha = sha256(fs.readFileSync(EXPORT, "utf8"));
  if (Date.now() - Date.parse(doc.exportedAt) > MAX_EXPORT_AGE_MS) {
    return deny("ERA3-EXPORT-STALE", `ייצוא-ישן (${Math.round((Date.now() - Date.parse(doc.exportedAt)) / 3600000)}h)`, "השער ייצא מחדש בפעם-הבאה");
  }

  // (2) הוכחת-דו-אתריות מול-GitHub
  const proof = await remoteProof();
  if (!proof.ok) return deny("ERA3-TWO-SITE-UNPROVEN", `הייצוא-לא-הוכח-על-GitHub: ${proof.reason}`, "וודא דחיפה לסניף " + BRANCH);
  if (proof.remoteSha !== exportSha) return deny("ERA3-REMOTE-DIVERGED", "העותק-על-GitHub שונה-מהדיסק — טמפרינג/דחיפה-חלקית", "הרץ ייצוא מחדש (--force)");

  // (3) אישור-ה-yיבוא המקומי
  const ack = readJson(ACK);
  if (!ack?.importSha256) return deny("ERA3-NO-ACK", "אין-אישור-ייבוא-מהכספת-המקומית (era3-ack.json)", "הצד-המקומי מייבא ודוחף ack · חלופה: פקודת-בעלים מפורשת");
  if (Date.now() - Date.parse(ack.importedAt ?? 0) > MAX_ACK_AGE_MS) return deny("ERA3-ACK-STALE", "אישור-ה-yיבוא ישן (>8d)", "ייבוא מקומי מחדש");
  if (ack.importSha256 !== exportSha) return deny("ERA3-ACK-MISMATCH", "ה-ack מתייחס לייצוא-ישן (sha שונה)", "ייבוא מקומי של הייצוא-הנוכחי");

  return {
    ok: true, verdict: "ERA3-GREEN",
    evidence: { exportSha: exportSha.slice(0, 16), exportedAt: doc.exportedAt, ackImportedAt: ack.importedAt, remote: "github-proven" },
    note: `דלק-מאושר עבור ${account ?? "-"} (${tag})`,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const ops = process.argv.slice(2).map((a) => [a]);
  era3FuelGate({ ops, account: "selftest", tag: "cli" }).then((r) => console.log(JSON.stringify(r, null, 2)));
}
