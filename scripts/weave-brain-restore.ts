#!/usr/bin/env bun
// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · weave-brain-restore — השבת המוח הביתה מהענן (Task 25)
//
// הוראת המפעיל: "ודא לעגן את הכל — לא לסמוך כלום על הסנדבוקס שלך".
// ריצה זו חיה בענן (GitHub Actions) בלבד: היא מורידה את מקורות
// הכספת מהריפואים הפרטיים (WEAVE_OPS_PAT — Actions Secret), פותחת
// את הארכיון ואת הכספת הישנה, מאמתת-אמת חי מול NVIDIA, ואוטמת
// את המפתחות בבית — תחת גזירת מפתח-הרשת מה-seal
// (weave-daemon/v1:weave-brain:<netkey> — אותה תוצאה בכל סביבה).
//
// ואז החידוש המבני: הגושים האטומים עולים לספר (sovereign/ledger.json)
// בתור שדה brain — הכספת אדיטיבית, הייצוא-איחוד לעולם לא מוחק —
// ומעתה כל איפוס סנדבוקס/ענן משחזר את המוח מהגיט בלבד. האימות
// על ההשבה נחתם בספר (RESTORE) ומכוסה ב-checkpoint — העוגנים
// יעידו עליו ב-$0 במחזור הבא.
//
// דגלים: --no-push (בדיקה בלי דחיפה) · --vault-only (עצירה אחרי
// פתיחת הכספת והאימות — לבדיקה מקומית בלי מפתח רשת, fail-closed).
// ─────────────────────────────────────────────────────────────────────
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import crypto from "node:crypto";
import { keccak256, toUtf8Bytes } from "ethers";
import { db } from "@/lib/db";
import { exportLedger, importLedger, parseLedgerSnapshot } from "@/lib/weave/ledger-sync";
import { ensureNetworkKeyFromSeal, ensureCloudAgent, createCheckpointNow } from "@/lib/weave/beat";
import { appendAttestation } from "@/lib/weave/ledger";
import { sealOpen } from "./weave-seal";
import { secretGate, filterKnownHashes, gitPushRetry } from "./weave-gate";
import {
  fetchVaultSources,
  decryptKeysBackup,
  openOldVault,
  probeBrainKey,
  findAgentEnv,
} from "@/lib/weave/brain-restore";

const ROOT = path.resolve(__dirname, "..");
const LEDGER_PATH = path.join(ROOT, "sovereign", "ledger.json");
const REPORT_PATH = path.join(ROOT, "sovereign", "brain-restore-report.json");
const BRANCH = process.env.WEAVE_BRANCH || "main";
const WORK_DIR = "/tmp/weave-brain-restore";
const EXTRACT_DIR = path.join(WORK_DIR, "extracted");

const NO_PUSH = process.argv.includes("--no-push");
const VAULT_ONLY = process.argv.includes("--vault-only");

function gitOrNull(cmd: string): string | null {
  try {
    const out = execSync(cmd, { cwd: ROOT, encoding: "utf8", timeout: 30_000, stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
    return out || null;
  } catch {
    return null;
  }
}

interface RestoreReport {
  at: string;
  runner: string;
  mode: string;
  archiveSha256: string;
  archiveShaMatch: boolean;
  vaultKeys: Array<{ fingerprint: string; oldStatus: string; live: boolean; code: number | string }>;
  sealed: number;
  alreadyHome: number;
  poolAfter: { total: number; verified: number };
  attestation: { seq: number; entryHash: string } | null;
  checkpoint: { index: number; root: string } | null;
  ledgerBrain: number;
  pushed: boolean;
}

async function main(): Promise<void> {
  const at = new Date().toISOString();
  const runner = process.env.GITHUB_ACTIONS ? "github-actions" : "local";
  console.log(`[brain-restore] runner=${runner} at=${at}`);

  // 1. הספר קודם — ייבוא אם הקובץ חדש מה-DB (בענן: clone טרי ⇒ תמיד)
  if (fs.existsSync(LEDGER_PATH)) {
    const snap = parseLedgerSnapshot(fs.readFileSync(LEDGER_PATH, "utf8"));
    const localCount = await db.attestation.count();
    if (snap.chainCount > localCount) {
      const res = await importLedger(snap);
      console.log(
        `[brain-restore] הספר יובא: ${res.imported.attestations} אימותים · מוח בספר: ${res.imported.brain}`
      );
    }
  }

  // 2. מקורות הכספת — הורדה מהריפואים הפרטיים + אימות שלמות מתועד
  const pat = process.env.WEAVE_OPS_PAT;
  if (!pat) throw new Error("חסר WEAVE_OPS_PAT — סוד הקריאה מהריפואים הפרטיים (Actions Secret)");
  fs.rmSync(WORK_DIR, { recursive: true, force: true });
  const sources = await fetchVaultSources(pat, WORK_DIR);
  console.log(`[brain-restore] מקורות הורדו · ארכיון sha256=…${sources.keysBackupSha256.slice(0, 16)} ${sources.archiveShaMatch ? "✓ תואם ל-recovery-meta" : "✗"}`);

  // 3. פענוח הארכיון — הסיסמה מה-recovery-meta, בזיכרון בלבד
  const meta = JSON.parse(fs.readFileSync(sources.recoveryMeta, "utf8")) as { keysBackupPass: string };
  decryptKeysBackup(sources.tarEnc, meta.keysBackupPass, EXTRACT_DIR);
  meta.keysBackupPass = ""; // מיד לאחר השימוש
  const agentEnv = findAgentEnv(EXTRACT_DIR);
  console.log(`[brain-restore] הארכיון נפתח · agent/.env נמצא (${path.relative(EXTRACT_DIR, agentEnv)})`);

  // 4. הכספת הישנה — WIF → key-seal → master → מפתחות NVIDIA + אימות-אמת חי
  //    (המפתחות הגלויים חיים בזיכרון בלבד עד סוף האטיבה — ואז נמחקים)
  const vaultKeys = openOldVault(agentEnv, sources.oldDb);
  const probed: Array<{ fingerprint: string; oldStatus: string; live: boolean; code: number | string }> = [];
  for (const k of vaultKeys) {
    const p = await probeBrainKey(k.key);
    probed.push({ fingerprint: k.fingerprint, oldStatus: k.oldStatus, live: p.live, code: p.code });
    console.log(`[brain-restore] ${k.fingerprint} → ${p.live ? "LIVE" : "not-live"} (${p.code}) · בכספת הישנה: ${k.oldStatus}`);
  }

  if (VAULT_ONLY) {
    console.log("[brain-restore] --vault-only — נעצרים לפני האטימה (מפתח רשת לא נדרש)");
    fs.writeFileSync(
      REPORT_PATH,
      JSON.stringify({ at, runner, mode: "VAULT-ONLY", archiveShaMatch: sources.archiveShaMatch, vaultKeys: probed }, null, 2) + "\n"
    );
    return;
  }

  if (probed.length === 0) throw new Error("הכספת הישנה ריקה ממפתחות NVIDIA — אין מה להשיב");
  const anyLive = probed.some((p) => p.live);
  if (!anyLive) throw new Error("אף מפתח לא עבר אימות-אמת חי — לא משיבים מאגר מת (fail-closed)");

  // 5. פתיחת ה-seal — מפתח הרשת לאטימה, מפתח הענן לחתימת האימות
  const seal = sealOpen();
  const netKey = await ensureNetworkKeyFromSeal(seal.networkKeyHex);
  console.log(`[brain-restore] seal פתוח · network=${netKey.address}`);

  // אותה גזירה של ה-DAEMONs ושל brain.ts — אותה תוצאה בכל סביבה
  const brainKekHex = keccak256(toUtf8Bytes(`weave-daemon/v1:weave-brain:${seal.networkKeyHex}`));
  const brainKek = Buffer.from(brainKekHex.slice(2), "hex");

  // 6. אטימה בבית — dedup לפי טביעת-אצבע (חוק הכספת: אותו מפתח לא נכנס פעמיים)
  const existing = new Set((await db.brainKey.findMany()).map((r: { fingerprint: string }) => r.fingerprint));
  let sealed = 0;
  for (let i = 0; i < vaultKeys.length; i++) {
    const k = vaultKeys[i];
    if (existing.has(k.fingerprint)) {
      console.log(`[brain-restore] ${k.fingerprint} — כבר בבית, דילוג`);
      k.key = "";
      continue;
    }
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv("aes-256-gcm", brainKek, iv);
    const ct = Buffer.concat([c.update(k.key, "utf8"), c.final()]);
    const tag = c.getAuthTag();
    const p = probed[i];
    await db.brainKey.create({
      data: {
        id: `brain-${k.fingerprint.slice(7)}`,
        fingerprint: k.fingerprint,
        encKey: ct.toString("hex"),
        keyIv: iv.toString("hex"),
        keyTag: tag.toString("hex"),
        status: p.live ? "verified" : "unverified",
        lastCode: String(p.code),
        verifiedAt: p.live ? new Date() : null,
        cooldownUntil: null,
      },
    });
    sealed++;
    k.key = ""; // נאטם — הגלוי נמחק מיד
  }

  const total = await db.brainKey.count();
  const verified = await db.brainKey.count({ where: { status: "verified" } });
  console.log(`[brain-restore] נאטמו ${sealed} חדשים · המאגר בבית: ${total} מפתחות · ${verified} verified`);

  // 7. אימות RESTORE חתום — ההשבה מתועדת בספר ומכוסה ב-checkpoint
  let attestation: { seq: number; entryHash: string } | null = null;
  let checkpoint: { index: number; root: string } | null = null;
  if (sealed > 0) {
    const cloudAgent = await ensureCloudAgent(seal.cloudKeyHex);
    const liveFps = probed.filter((p) => p.live).map((p) => p.fingerprint);
    const claim =
      `המוח הושב הביתה מכספת הצי: ${sealed} מפתחות NVIDIA NIM אומתו-אמת (1-token chat) ` +
      `ונאטמו תחת גזירת מפתח-הרשת; הגושים האטומים עולים לספר — המוח עוגן בגיט ואינו תלוי עוד בסנדבוקס.`;
    const evidence = [
      `runner=${runner}`,
      `gitHead=${gitOrNull("git rev-parse --short HEAD") ?? "unknown"}`,
      `sources=steem:agent/vault/KEYS-BACKUP-2026-09-09.tar.enc + Saosmartwallet:db/custom.db (פרטיים, קריאה בלבד)`,
      `archiveSha256=${sources.keysBackupSha256} (מתועד ב-recovery-meta — תואם)`,
      `vaultOpen=headcorner key-seal → master → VaultEntry(nvidia) · טביעות נאמתו מול שדה pub`,
      `live=${liveFps.length}/${probed.length}: ${liveFps.join(", ")}`,
      `sealed=${sealed} · poolAfter=${total} keys / ${verified} verified`,
      `kek=keccak256(weave-daemon/v1:weave-brain:<netkey>) — אותה גזירה בכל סביבה`,
      `ledgerBrain=additive vault — union-merge בייבוא ובייצוא, הסרה רק בפרישה מפורשת`,
      `at=${at}`,
    ].join(" · ");
    const att = await appendAttestation({
      agentId: cloudAgent.id,
      claim,
      claimType: "RESTORE",
      evidence,
    });
    attestation = { seq: att.seq, entryHash: att.entryHash };
    const cp = await createCheckpointNow();
    if (cp) checkpoint = { index: cp.index, root: cp.root };
    console.log(`[brain-restore] אימות RESTORE att${att.seq} נחתם${checkpoint ? ` · cp#${checkpoint.index}` : ""}`);
  } else {
    console.log("[brain-restore] המאגר כבר היה בבית — אין אימות כפול (חוק הכנות)");
  }

  // 8. הספר עם המוח — ייצוא (האיחוד מבטיח ששום גוש לא אובד)
  const snap = await exportLedger();
  fs.mkdirSync(path.dirname(LEDGER_PATH), { recursive: true });
  fs.writeFileSync(LEDGER_PATH, JSON.stringify(snap, null, 2) + "\n");
  console.log(`[brain-restore] הספר ייוצא: ${snap.chainCount} אימותים · מוח: ${snap.brain.length} גושים אטומים`);

  const report: RestoreReport = {
    at,
    runner,
    mode: sealed > 0 ? "RESTORED" : "ALREADY-HOME",
    archiveSha256: sources.keysBackupSha256,
    archiveShaMatch: sources.archiveShaMatch,
    vaultKeys: probed,
    sealed,
    alreadyHome: probed.length - sealed,
    poolAfter: { total, verified },
    attestation,
    checkpoint,
    ledgerBrain: snap.brain.length,
    pushed: false,
  };
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + "\n");

  if (NO_PUSH) {
    console.log("[brain-restore] --no-push — הודגם בלבד, לא נדחף");
    return;
  }

  // 9. שער-סודות ואז דחיפה — הגושים האטומים ברשימה הלבנה הקנונית
  if (process.env.GITHUB_ACTIONS) {
    execSync('git config user.name "weave-restore[bot]" && git config user.email "weave-restore[bot]@users.noreply.github.com"', { cwd: ROOT, stdio: "ignore" });
  }
  execSync("git add -A", { cwd: ROOT, stdio: "ignore" });
  const staged = gitOrNull("git diff --cached") ?? "";
  const leak = secretGate(filterKnownHashes(staged));
  if (leak) {
    execSync("git reset", { cwd: ROOT, stdio: "ignore" });
    throw new Error(`שער הסודות חסם את הדחיפה: ${leak} ב-diff — כלום לא נדחף`);
  }
  const msg = `weave-brain-restore: ${at} · ${sealed} מפתחות הושבו · מאגר ${total}/${verified}v · מוח בספר: ${snap.brain.length}${attestation ? ` · att${attestation.seq}` : ""}`;
  execSync(`git commit -m ${JSON.stringify(msg)}`, { cwd: ROOT, stdio: "ignore" });
  const pushOut = gitPushRetry(ROOT, BRANCH);
  report.pushed = true;
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + "\n");
  console.log(`[brain-restore] נדחף: ${pushOut.split("\n").slice(-1)[0] || "pushed"}`);

  // 10. ניקוי — שום עקבה של הכספת לא נשארת על הדיסק
  fs.rmSync(WORK_DIR, { recursive: true, force: true });
  console.log("[brain-restore] עקבות הכספת נמחקו מהדיסק");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("BRAIN-RESTORE-ERROR:", e instanceof Error ? e.message : e);
    process.exit(1);
  });
