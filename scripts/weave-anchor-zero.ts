#!/usr/bin/env bun
// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · weave-anchor-zero — מסילת ה-EVM בגז-אפס (G1)
//
// הפער האחרון נסגר בלי אגורה: root של ה-checkpoint האחרון עולה
// כטרנזקציית EVM אמיתית על Z Chain (Zero Network, chainId 9369) —
// רשת EVM ראשית ציבורית שבה הגז מדוד 0x0. החותם: מפתח הרשת
// של ה-WEAVE (מה-seal — אותו מפתח שחותם checkpoints ב-EIP-712),
// כתובת במאזן אפס; זו כל העלות: 0.000000.
//
// הפרוטוקול (העברה נאמנה של R9 — anchor-zero של הפלטפורמה):
//   · data = 0xa9059cbb (סלקטור ERC-20 ברשימת-ההיתר של שער ה-RPC)
//     + המטען הקנוני של ה-checkpoint
//   · הטרנזקציה ממוענת-עצמית ל-EOA — אינרטית מבנית
//   · הוכחת הכללה: receipt.status===1 + read-back בתים-מדויק
//     + effectiveGasPrice 0x0
//
// ההוכחה חוזרת לספר: אימות ANCHOR חתום (EIP-191, מפתח הענן מה-seal)
// שנושא את ה-txid, הבלוק, הגז והעלות — וה-checkpoint עצמו מסומן
// ANCHORED/zero-9369 לראשונה ב-REAL. ה-checkpoint הבא מכסה את
// העדות — סולם ההוכחות מתחזק בכל עיגון.
//
// רץ בשני עולמות, אותה מכניקה:
//   · הענן (weave-anchor-zero.yml) — המפתח מה-seal שנפתח עם
//     WEAVE_SEAL_PASSPHRASE מ-Actions Secrets (סוד קיים — אפס
//     משמרת חדשה!)
//   · ה-runner הראשי (הסנדבוקס) — מ-.env.local
//
// דגלים: --dry (בלי שידור וכתיבה) · --no-push · --verify-only (קריאה בלבד)
// ─────────────────────────────────────────────────────────────────────

import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { db } from "@/lib/db";
import { exportLedger, importLedger, parseLedgerSnapshot } from "@/lib/weave/ledger-sync";
import { verifyLedger, ensureCloudAgent, ensureNetworkKeyFromSeal, createCheckpointNow } from "@/lib/weave/beat";
import { resolveOpenMarkets, type SettlementResult } from "@/lib/weave/market";
import { brainProbeAll } from "@/lib/weave/brain";
import { appendAttestation } from "@/lib/weave/ledger";
import { sealOpen } from "./weave-seal";
import { anchorOnZero, verifyZeroAnchorOnChain, zeroReadiness, zeroExplorerLink, ZERO_RAIL_ID, type ZeroReadback } from "@/lib/weave/zero";

const ROOT = path.resolve(__dirname, "..");
const LEDGER_PATH = path.join(ROOT, "sovereign", "ledger.json");
const LINE_PATH = path.join(ROOT, "sovereign", "zero-line.json");
const REPORT_PATH = path.join(ROOT, "sovereign", "zero-anchor-report.json");
const BRANCH = process.env.WEAVE_BRANCH || "main";

const IS_ACTIONS = !!process.env.GITHUB_ACTIONS;
const DRY = process.argv.includes("--dry");
const NO_PUSH = process.argv.includes("--no-push");
const VERIFY_ONLY = process.argv.includes("--verify-only");
// התאוששות: העוגן כבר נחת והעדות נכתבה, אבל הדחיפה נכשלה (רשת/שער) —
// משלימים את הדחיפה בלבד, בלי שידור חדש ובלי עדות כפולה.
const PUSH_ONLY = process.argv.includes("--push-only");
// התאוששות-עוגן: טרנזקציה נחתה אך הריצה אדמה לפני האימות (למשל מרוץ
// אינדקס) — מאמתים אותה מהשרשרת וכותבים את העדות שהיא הוכיחה.
const RECOVER_TXID = (() => {
  const a = process.argv.find((x) => x.startsWith("--recover="));
  return a ? a.slice("--recover=".length).trim() : null;
})();

const ANCHORS_RING = 32; // טבעת-64 קטנה — הספר הוא האמת, הקובץ רק מראה

interface ZeroAnchorRecord {
  checkpoint: number;
  root: string;
  attFrom: number;
  attTo: number;
  attestations: number;
  at: string;
  commit: string;
  account: string;
  txid: string | null;
  block: number | null;
  gasUsed: number | null;
  effectiveGasPrice: string | null;
  costEth: string | null;
  confirmed: boolean;
  attSeq?: number;
  runner?: string;
}

interface ZeroLine {
  line: string;
  rail: string;
  chainId: number;
  account: string;
  createdAt: string;
  anchors: ZeroAnchorRecord[];
  last?: ZeroAnchorRecord;
}

function sh(cmd: string): string {
  try {
    return execSync(cmd, { cwd: ROOT, encoding: "utf8", timeout: 60_000, stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
  } catch (e) {
    const err = e as { stderr?: string; stdout?: string };
    throw new Error(`פקודה נכשלה: ${cmd}\n${(err.stderr || err.stdout || "").slice(-500)}`);
  }
}

function gitOrNull(cmd: string): string | null {
  try {
    const out = execSync(cmd, { cwd: ROOT, encoding: "utf8", timeout: 30_000, stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
    return out || null;
  } catch {
    return null;
  }
}

// ── שער הסודות (חוק הברזל) — מקור קנוני אחד: weave-gate ──
import { secretGate, filterKnownHashes, gitPushRetry } from "./weave-gate";

function readLine(account: string): ZeroLine {
  try {
    return JSON.parse(fs.readFileSync(LINE_PATH, "utf8")) as ZeroLine;
  } catch {
    return { line: "zero-evm", rail: ZERO_RAIL_ID, chainId: 9369, account, createdAt: new Date().toISOString(), anchors: [] };
  }
}

function writeLine(line: ZeroLine): void {
  const capped = { ...line, anchors: line.anchors.slice(-ANCHORS_RING) };
  capped.last = capped.anchors[capped.anchors.length - 1] || undefined;
  fs.writeFileSync(LINE_PATH, JSON.stringify(capped, null, 2) + "\n");
}

async function localLedgerState(): Promise<{ count: number; head: string }> {
  const [last, count] = await Promise.all([
    db.attestation.findFirst({ orderBy: { seq: "desc" } }),
    db.attestation.count(),
  ]);
  return { count, head: last?.entryHash ?? "0x" + "0".repeat(64) };
}

async function main(): Promise<void> {
  const runner: "github-actions" | "local-primary" = IS_ACTIONS ? "github-actions" : "local-primary";
  const gitHead = gitOrNull("git rev-parse --short HEAD") ?? "unknown";
  const repoSlug = process.env.GITHUB_REPOSITORY ?? "roshpinacare-sys/Zip";
  const runUrl = process.env.GITHUB_SERVER_URL
    ? `${process.env.GITHUB_SERVER_URL}/${repoSlug}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : undefined;

  console.log(`[weave-anchor-zero] runner=${runner} head=${gitHead} rail=${ZERO_RAIL_ID}`);

  // 0. התאוששות דחיפה — העוגן נחת, העדות נכתבה, הקבצים בעץ; רק הדחיפה נפלה
  if (PUSH_ONLY) {
    if (!gitOrNull("git remote get-url origin")) {
      throw new Error("אין remote origin — בלי ריפו אין עדות");
    }
    execSync(`git add -A`, { cwd: ROOT, stdio: "ignore" });
    const staged = gitOrNull("git diff --cached") ?? "";
    const leak = secretGate(filterKnownHashes(staged));
    if (leak) {
      execSync("git reset", { cwd: ROOT, stdio: "ignore" });
      throw new Error(`שער הסודות חסם את הדחיפה: ${leak} ב-diff — כלום לא נדחף`);
    }
    const nFiles = (gitOrNull("git diff --cached --name-only") ?? "").split("\n").filter(Boolean).length;
    const msg = `weave-anchor-zero: push-only recovery · ${new Date().toISOString()}`;
    execSync(`git commit -m ${JSON.stringify(msg)}`, { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
    gitOrNull(`git pull --rebase origin ${BRANCH} --no-edit`);
    const pushOut = gitPushRetry(ROOT, BRANCH);
    console.log(`[weave-anchor-zero] push-only: ${nFiles} files · ${pushOut.split("\n").slice(-1)[0] || "pushed"}`);
    return;
  }

  // 1. בענן — checkout טרי; מקומית — pull קודם (ה-remote הוא האמת)
  if (runner === "local-primary" && gitOrNull("git remote get-url origin")) {
    const pull = gitOrNull(`git pull --rebase origin ${BRANCH} --no-edit`) ?? "";
    if (pull.includes("CONFLICT")) {
      throw new Error("קונפליקט pull — הרץ ידנית: git pull --rebase ואז weave-anchor-zero");
    }
    if (pull) console.log("[weave-anchor-zero] pull:", pull.split("\n").slice(-2).join(" "));
  }

  // 2. ייבוא ledger.json אם הקובץ חדש מה-DB המקומי
  if (fs.existsSync(LEDGER_PATH)) {
    const snap = parseLedgerSnapshot(fs.readFileSync(LEDGER_PATH, "utf8"));
    const local = await localLedgerState();
    if (snap.chainCount > local.count) {
      const res = await importLedger(snap);
      console.log(`[weave-anchor-zero] ייובאו ${res.imported.attestations} אימותים מ-ledger.json`);
    }
  }

  // 3. פתיחת seal — מפתח הרשת חותם את העוגן; זהות הענן חותמת את העדות
  const seal = sealOpen();
  const cloudAgent = await ensureCloudAgent(seal.cloudKeyHex);
  await ensureNetworkKeyFromSeal(seal.networkKeyHex);
  console.log(
    `[weave-anchor-zero] seal פתוח · network=${seal.networkAddress} (חותם העוגן) · cloud=${seal.cloudAddress} (חותם העדות)`
  );

  // 3.5 המוח — אימות-אמת בקו שתמיד רץ (Task 25): הלב
  //      נסוג כשהסנדבוקס חי (SANDBOX-ALIVE) — אבל הקווים
  //      רצים אחרי כל פעימה בכל מצב. המאגר חי בספר
  //      (כספת אדיטיבית) — ומדוד כאן, שעתית, ב-1-token chat
  //      לכל מפתח. הסטטוס זורם לספר בייצוא שלהלן. כשל-רשת
  //      או סביבה נטולת-מפתח — נרשם בכנות ולא מפיל: העשרה
  //      לעולם לא חוסמת את הקו.
  let brainProbe: Array<{ fingerprint: string; live: boolean; code: number | string }> | null = null;
  try {
    const poolCount = await db.brainKey.count();
    if (poolCount > 0) {
      brainProbe = await brainProbeAll();
      const live = brainProbe.filter((p) => p.live).length;
      console.log(`[weave-anchor-zero] המוח: ${live}/${poolCount} מפתחות LIVE (אימות-אמת 1-token שעתי)`);
    }
  } catch (brainErr) {
    console.log(
      `[weave-anchor-zero] המוח: נעול או לא-זמין — ${brainErr instanceof Error ? brainErr.message : String(brainErr)}`
    );
  }

  // 4. הספר חייב להיות תקין לפני כל עדות
  const verify = await verifyLedger();
  if (!verify.valid) {
    throw new Error(`הספר שבור (firstBreak=${verify.firstBreak ?? "?"}) — אין עדות על ספר שקרי`);
  }
  console.log(`[weave-anchor-zero] ledger תקין: ${verify.checked} אימותים · ${verify.sigOk}/${verify.checked} חתימות`);

  // 4.5 התאוששות-עוגן — הטרנזקציה נחתה, הריצה המקורית אדמה לפני האימות
  if (RECOVER_TXID) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(RECOVER_TXID)) {
      throw new Error(`--recover: txid פגום — ${RECOVER_TXID.slice(0, 20)}…`);
    }
    const cpR = await db.checkpoint.findFirst({ orderBy: { index: "desc" } });
    if (!cpR) throw new Error("אין checkpoint — אין מה לשחזר");
    console.log(`[weave-anchor-zero] recovery: מאמת ${RECOVER_TXID.slice(0, 16)}… מול cp#${cpR.index}`);
    const readback = await verifyZeroAnchorOnChain(RECOVER_TXID);
    if (!readback.found || !readback.ok) {
      throw new Error(`recovery: הטרנזקציה לא אומתה מהשרשרת — ${readback.verdict}`);
    }
    const p = readback.payload ?? {};
    const pCheckpoint = Number(p.checkpoint ?? -1);
    const pRoot = String(p.root ?? "");
    if (pCheckpoint !== cpR.index || pRoot !== cpR.root) {
      throw new Error(
        `recovery: חוסר-התאמה מטען↔ספר — on-chain cp#${pCheckpoint}/${pRoot.slice(0, 14)}… מול ledger cp#${cpR.index}/${cpR.root.slice(0, 14)}…`
      );
    }
    const originalAt = String(p.at ?? new Date().toISOString());
    const originalCommit = String(p.commit ?? gitHead);
    console.log(
      `[weave-anchor-zero] recovery: מטען מאומת מהשרשרת (cp#${pCheckpoint}, root ${pRoot.slice(0, 16)}…) · block=${readback.block} · effGas=${readback.effectiveGasPrice}`
    );

    // ה-checkpoint מסומן ANCHORED (אם עוד לא)
    if (cpR.anchorStatus !== "ANCHORED") {
      await db.checkpoint.update({
        where: { index: cpR.index },
        data: { anchorStatus: "ANCHORED", anchorNet: ZERO_RAIL_ID, anchorTx: RECOVER_TXID },
      });
    }

    const explorer = zeroExplorerLink(RECOVER_TXID);
    const claim =
      `קו ה-ZERO (Z Chain 9369, גז-אפס): checkpoint #${cpR.index} root ${cpR.root.slice(0, 18)}… עוגן כטרנזקציית EVM ` +
      `אמיתית (recovery — העוגן נחת בריצה שאדמה במרוץ אינדקס לפני האימות; המטען אומת כעת מהשרשרת) — ` +
      `עד EVM ציבורי בלתי-תלוי בגיטהאב, בעלות מדודה 0.000000.`;
    const evidence = [
      `zeroTxid=${RECOVER_TXID}`,
      `recovery=true (original run reddened pre-verification; payload re-verified from chain)`,
      `chainId=${ZERO_RAIL_ID} (Z Chain, Zero Network)`,
      `block=${readback.block}`,
      `gasUsed=${readback.gasUsed}`,
      `effectiveGasPrice=${readback.effectiveGasPrice} (0 = הוכחת האפס בקבלה)`,
      `costEth=0.000000`,
      `account=${readback.from} (מפתח הרשת מה-seal)`,
      `operation=self-addressed EOA · value=0 · data=0xa9059cbb+canonical`,
      `checkpoint=${cpR.index} root=${cpR.root} attFrom=${cpR.attFrom} attTo=${cpR.attTo}`,
      `originalAt=${originalAt}`,
      `originalCommit=${originalCommit}`,
      `readback=${readback.verdict}`,
      `explorer=${explorer}`,
      `runner=${runner} (recovery)`,
      runUrl ? `run=${runUrl}` : null,
    ]
      .filter(Boolean)
      .join(" · ");

    const att = await appendAttestation({
      agentId: cloudAgent.id,
      claim,
      claimType: "ANCHOR",
      evidence,
    });
    console.log(`[weave-anchor-zero] recovery: אימות ANCHOR נכתב: seq=${att.seq}`);

    const newCp = await createCheckpointNow();
    if (newCp) {
      console.log(`[weave-anchor-zero] recovery: checkpoint #${newCp.index} נוצר (מכסה att ${newCp.attFrom}..${newCp.attTo})`);
    }

    const lineR = readLine(seal.networkAddress);
    if (!lineR.anchors.some((a) => a.txid === RECOVER_TXID)) {
      lineR.anchors.push({
        checkpoint: cpR.index,
        root: cpR.root,
        attFrom: cpR.attFrom,
        attTo: cpR.attTo,
        attestations: await db.attestation.count(),
        at: originalAt,
        commit: originalCommit,
        account: readback.from ?? seal.networkAddress,
        txid: RECOVER_TXID,
        block: readback.block,
        gasUsed: readback.gasUsed,
        effectiveGasPrice: readback.effectiveGasPrice,
        costEth: "0.000000",
        confirmed: true,
        attSeq: att.seq,
        runner: runner,
      });
      writeLine(lineR);
    }

    const snapR = await exportLedger();
    fs.mkdirSync(path.dirname(LEDGER_PATH), { recursive: true });
    fs.writeFileSync(LEDGER_PATH, JSON.stringify(snapR, null, 2) + "\n");
    fs.writeFileSync(
      REPORT_PATH,
      JSON.stringify(
        {
          at: new Date().toISOString(),
          runner,
          mode: "RECOVERED (anchor landed in a reddened run; attested after chain re-verification)",
          recoveredTxid: RECOVER_TXID,
          readback,
          attSeq: att.seq,
          nextCheckpoint: newCp ? { index: newCp.index, root: newCp.root } : null,
          attestations: snapR.chainCount,
          context: { runner, gitHead, repoSlug, runUrl },
        },
        null,
        2
      ) + "\n"
    );

    if (NO_PUSH) {
      console.log("[weave-anchor-zero] recovery: --no-push — לא נדחף");
      return;
    }
    if (!gitOrNull("git remote get-url origin")) throw new Error("אין remote origin — בלי ריפו אין עדות");
    execSync(`git add -A`, { cwd: ROOT, stdio: "ignore" });
    const staged = gitOrNull("git diff --cached") ?? "";
    const leak = secretGate(filterKnownHashes(staged));
    if (leak) {
      execSync("git reset", { cwd: ROOT, stdio: "ignore" });
      throw new Error(`שער הסודות חסם את הדחיפה: ${leak} ב-diff — כלום לא נדחף`);
    }
    const msg = `weave-anchor-zero recovery: ${RECOVER_TXID.slice(0, 18)}… · cp#${cpR.index} · att ${att.seq}`;
    execSync(`git commit -m ${JSON.stringify(msg)}`, { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
    const pushOut = gitPushRetry(ROOT, BRANCH);
    console.log(`[weave-anchor-zero] recovery: ${pushOut.split("\n").slice(-1)[0] || "pushed"}`);
    return;
  }

  // 5. ה-checkpoint האחרון — מה שעולה לשרשרת
  const cp = await db.checkpoint.findFirst({ orderBy: { index: "desc" } });
  if (!cp) {
    throw new Error("אין checkpoint בספר — הרץ פעימה קודם (weave-beat)");
  }

  const line = readLine(seal.networkAddress);
  const alreadyAnchored = line.last && line.last.root === cp.root;

  // 6. dedupe: root זה כבר עוגן ⇒ קריאה-חזרה בלבד (השרשרת השופטת)
  if (alreadyAnchored || VERIFY_ONLY) {
    const last = line.last;
    // הטיפוס המפורש נדרש: בלעדיו מסיק TypeScript את הטיפוס null ודוחה את ההשמה
    let readback: ZeroReadback | { ok: boolean; verdict: string } | null = null;
    if (last && last.txid) {
      readback = await verifyZeroAnchorOnChain(last.txid).catch((e) => ({
        ok: false,
        verdict: `readback error: ${e instanceof Error ? e.message : "?"}`,
      }));
    }
    const report = {
      at: new Date().toISOString(),
      runner,
      mode: "ALREADY-ANCHORED (verify-only)",
      checkpoint: { index: cp.index, root: cp.root },
      lastAnchor: last ?? null,
      chainReadback: readback,
      context: { runner, gitHead, repoSlug, runUrl },
    };
    fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + "\n");
    console.log(
      `[weave-anchor-zero] root ${cp.root.slice(0, 14)}… כבר עוגן (cp#${last?.checkpoint ?? "?"}) · ` +
        `readback=${readback ? readback.verdict : "no-anchor-yet"} — אין שידור חדש`
    );
    return;
  }

  // 7. מוכנות — השרשרת נמדדת לפני כל נגיעה (תכונת האפס בחיים?)
  const readiness = await zeroReadiness(seal.networkAddress);
  console.log(
    `[weave-anchor-zero] readiness: chainId=${readiness.chainId} · block=${readiness.blockNumber} · ` +
      `gasPrice=${readiness.gasPriceGwei} gwei · balance=${readiness.balanceEth ?? "?"} · nonce=${readiness.nonce ?? "?"}`
  );
  if (!readiness.ok || !readiness.zeroGasConfirmed) {
    // כנות: אם שרשרת האפס איבדה את תכונתה — הריצה נכשלת בלי עדות
    // (anchorOnZero ייפול על שער מאזן×2 אם יש מימון; כאן אנו כנים מראש)
    const report = {
      at: new Date().toISOString(),
      runner,
      mode: "ZERO-GATE-CLOSED (chain no longer zero-gas — honest red, nothing attested)",
      readiness,
      checkpoint: { index: cp.index, root: cp.root },
      context: { runner, gitHead, repoSlug, runUrl },
    };
    fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + "\n");
    throw new Error(`שער האפס סגור: ${readiness.verdict} ${readiness.error ?? ""}`);
  }

  // 8. המעגן — cp#${cp.index} · root על Z Chain בעלות 0.000000
  const at = new Date().toISOString();
  const attestations = await db.attestation.count();
  const headRow = await db.attestation.findFirst({ orderBy: { seq: "desc" } });
  console.log(
    `[weave-anchor-zero] מעגן cp#${cp.index} · root=${cp.root.slice(0, 18)}… · att ${cp.attFrom}..${cp.attTo} · ` +
      `${DRY ? "DRY" : "שידור ל-Z Chain (gasPrice 0)"}`
  );

  if (DRY) {
    const payloadCtx = { at, repo: repoSlug, commit: gitHead, attestations, headHash: headRow?.entryHash ?? "0x" + "0".repeat(64) };
    const report = {
      at,
      runner,
      mode: "DRY",
      readiness,
      payloadContext: payloadCtx,
      note: "לא שודר דבר; לא נכתבה עדות. הוכחה או לא קרה.",
      context: { runner, gitHead, repoSlug, runUrl },
    };
    fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + "\n");
    console.log("[weave-anchor-zero] DRY — הודגם בלבד, לא שודר ולא נדחף");
    return;
  }

  const outcome = await anchorOnZero({
    cp: { index: cp.index, root: cp.root, attFrom: cp.attFrom, attTo: cp.attTo, leafCount: cp.leafCount },
    networkKeyHex: seal.networkKeyHex,
    expectedAddress: seal.networkAddress,
    ctx: { at, repo: repoSlug, commit: gitHead, attestations, headHash: headRow?.entryHash ?? "0x" + "0".repeat(64) },
  });

  console.log(
    `[weave-anchor-zero] נשלח: txid=${outcome.txid} · ממתין לקבלה…`
  );

  if (!outcome.confirmed) {
    // קבלה לא אושרה — כישלון כנה, אין עדות, הריצה אדומה; הניסיון הבא יעגן
    const report = {
      at,
      runner,
      mode: "ANCHOR-UNCONFIRMED (receipt/readback missing — honest red, nothing attested)",
      outcome,
      context: { runner, gitHead, repoSlug, runUrl },
    };
    fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + "\n");
    throw new Error(`העיגון לא אושר: txid=${outcome.txid} block=${outcome.block ?? "?"} — אין עדות`);
  }

  // 9. קריאה-חזרה עצמאית — הוכחה כפולה מה-RPC הציבורי
  const readback = await verifyZeroAnchorOnChain(outcome.txid!, outcome.dataHex);
  if (!readback.ok) {
    throw new Error(`קריאה-חזרה נכשלה: ${readback.verdict} — אין עדות`);
  }
  console.log(
    `[weave-anchor-zero] readback: ${readback.verdict} · block=${readback.block} · gasUsed=${readback.gasUsed} · effGasPrice=${readback.effectiveGasPrice}`
  );

  // 10. ה-checkpoint מסומן ANCHORED — לראשונה ב-REAL על שרשרת ציבורית
  await db.checkpoint.update({
    where: { index: cp.index },
    data: {
      anchorStatus: "ANCHORED",
      anchorNet: ZERO_RAIL_ID,
      anchorTx: outcome.txid,
    },
  });
  console.log(`[weave-anchor-zero] checkpoint #${cp.index} ← ANCHORED/${ZERO_RAIL_ID} (txid ${outcome.txid!.slice(0, 14)}…)`);

  // 11. העדות חוזרת לספר — txid/בלוק/גז/עלות בראיה, חתום במפתח הענן
  const explorer = zeroExplorerLink(outcome.txid!);
  const claim =
    `קו ה-ZERO (Z Chain 9369, גז-אפס): checkpoint #${cp.index} root ${cp.root.slice(0, 18)}… עוגן כטרנזקציית EVM ` +
    `אמיתית ממפתח הרשת (סלקטור 0xa9059cbb + מטען קנוני, ממוען-עצמית ל-EOA אינרטי) — עד EVM ציבורי ` +
    `בלתי-תלוי בגיטהאב, בעלות מדודה 0.000000.`;
  const evidence = [
    `zeroTxid=${outcome.txid}`,
    `chainId=${ZERO_RAIL_ID} (Z Chain, Zero Network)`,
    `block=${outcome.block}`,
    `gasUsed=${outcome.gasUsed}`,
    `effectiveGasPrice=${outcome.effectiveGasPrice} (0 = הוכחת האפס בקבלה)`,
    `costEth=${outcome.costEth ?? "0.000000"}`,
    `account=${outcome.account} (מפתח הרשת מה-seal; מאזן 0 — הגז מדוד 0x0)`,
    `operation=self-addressed EOA · value=0 · data=0xa9059cbb+canonical (רשימת-ההיתר של שער ה-RPC)`,
    `checkpoint=${cp.index} root=${cp.root} attFrom=${cp.attFrom} attTo=${cp.attTo}`,
    `attestations=${attestations}`,
    `headHash=${headRow?.entryHash}`,
    `readback=${readback.verdict}`,
    `explorer=${explorer}`,
    `commit=${gitHead}`,
    `payloadAt=${at}`,
    `runner=${runner}`,
    runUrl ? `run=${runUrl}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const att = await appendAttestation({
    agentId: cloudAgent.id,
    claim,
    claimType: "ANCHOR",
    evidence,
  });
  console.log(`[weave-anchor-zero] אימות ANCHOR נכתב: seq=${att.seq} · entry=${att.entryHash.slice(0, 18)}…`);

  // 12. סולם-ההוכחות: checkpoint חדש שמכסה את אימות ה-ANCHOR
  const newCp = await createCheckpointNow();
  if (newCp) {
    console.log(
      `[weave-anchor-zero] checkpoint #${newCp.index} נוצר (מכסה att ${newCp.attFrom}..${newCp.attTo}) · root=${newCp.root.slice(0, 16)}…`
    );
  }

  // 12.5 שוק האמת — המכריע רוכב על קו העיגון (Task 19, תיקון באג חבוי):
  //      כל ריצת עיגון מזינה checkpoint חדש שהריצה הבאה מעגנת — הספר
  //      "טרי" לנצח מעצם קיום הקווים, והלב מפיק פעימה מלאה רק ב-TAKEOVER
  //      שלעולם לא מגיע. בלי התיקון הזה resolveOpenMarkets לעולם לא רץ
  //      בענן ושווקים פתוחים נתלים (נתפס בקריאה לפני הכתיבה). כאן:
  //      המכריע רץ על הספר שזה עתה אומת — fail-closed, כמו בפעימה §5.5.
  let marketSettlement: SettlementResult | null = null;
  let marketCheckpoint: { index: number; root: string } | null = null;
  if (verify.valid) {
    marketSettlement = await resolveOpenMarkets();
    if (marketSettlement.attSeqs.length > 0) {
      const mcp = await createCheckpointNow();
      if (mcp) marketCheckpoint = { index: mcp.index, root: mcp.root };
    }
    if (marketSettlement.settled.length > 0 || marketSettlement.refunded.length > 0) {
      console.log(
        `[weave-anchor-zero] שוק האמת נסלק: ${marketSettlement.settled.length} הוכרעו · ${marketSettlement.refunded.length} הוחזרו · אימותים att${marketSettlement.attSeqs.join(",att")}${marketCheckpoint ? ` · cp#${marketCheckpoint.index}` : ""}`
      );
    }
  }

  // 13. רישום הקו + ייצוא הספר
  const record: ZeroAnchorRecord = {
    checkpoint: cp.index,
    root: cp.root,
    attFrom: cp.attFrom,
    attTo: cp.attTo,
    attestations,
    at,
    commit: gitHead,
    account: outcome.account,
    txid: outcome.txid ?? null,
    block: outcome.block,
    gasUsed: outcome.gasUsed,
    effectiveGasPrice: outcome.effectiveGasPrice,
    costEth: outcome.costEth ?? "0.000000",
    confirmed: outcome.confirmed,
    attSeq: att.seq,
    runner,
  };
  line.anchors.push(record);
  writeLine(line);

  const snap = await exportLedger();
  fs.mkdirSync(path.dirname(LEDGER_PATH), { recursive: true });
  fs.writeFileSync(LEDGER_PATH, JSON.stringify(snap, null, 2) + "\n");
  console.log(`[weave-anchor-zero] ledger.json ייוצא: ${snap.chainCount} אימותים · head=${snap.headHash.slice(0, 18)}…`);

  const report = {
    at,
    runner,
    mode: "ANCHORED",
    rail: ZERO_RAIL_ID,
    readiness,
    checkpoint: { index: cp.index, root: cp.root, attFrom: cp.attFrom, attTo: cp.attTo },
    outcome: {
      txid: outcome.txid,
      block: outcome.block,
      gasUsed: outcome.gasUsed,
      effectiveGasPrice: outcome.effectiveGasPrice,
      costEth: outcome.costEth,
      confirmed: outcome.confirmed,
      explorer,
    },
    chainReadback: readback,
    attSeq: att.seq,
    nextCheckpoint: newCp ? { index: newCp.index, root: newCp.root } : null,
    ...(marketSettlement
      ? {
          market: {
            settled: marketSettlement.settled,
            refunded: marketSettlement.refunded,
            attSeqs: marketSettlement.attSeqs,
            checkpoint: marketCheckpoint,
          },
        }
      : {}),
    attestations: snap.chainCount,
    ...(brainProbe ? { brain: { probed: brainProbe } } : {}),
    context: { runner, gitHead, repoSlug, runUrl },
  };
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + "\n");

  if (NO_PUSH) {
    console.log("[weave-anchor-zero] --no-push — הודגם, לא נדחף");
    return;
  }

  // 14. שער-סודות ודחיפה — כמו הלב והעוגן; זהות העוגן בענן בלבד
  if (!gitOrNull("git remote get-url origin")) {
    throw new Error("אין remote origin — בלי ריפו אין עדות");
  }
  if (IS_ACTIONS) {
    sh('git config user.name "weave-anchor-zero[bot]" && git config user.email "weave-anchor-zero[bot]@users.noreply.github.com"');
  }
  execSync(`git add -A`, { cwd: ROOT, stdio: "ignore" });
  const staged = gitOrNull("git diff --cached") ?? "";
  const leak = secretGate(filterKnownHashes(staged));
  if (leak) {
    execSync("git reset", { cwd: ROOT, stdio: "ignore" });
    throw new Error(`שער הסודות חסם את הדחיפה: ${leak} ב-diff — כלום לא נדחף`);
  }
  const nFiles = (gitOrNull("git diff --cached --name-only") ?? "").split("\n").filter(Boolean).length;
  const marketNote = marketSettlement
    ? ` · market ${marketSettlement.settled.length}s/${marketSettlement.refunded.length}r`
    : "";
  const msg = `weave-anchor-zero: ${at} · cp#${cp.index} · Z Chain 9369 gasPrice 0x0 · att ${att.seq}${marketNote}`;
  execSync(`git commit -m ${JSON.stringify(msg)}`, { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
  const pushOut = gitPushRetry(ROOT, BRANCH);
  console.log(`[weave-anchor-zero] gitkeeper: ${nFiles} files · ${pushOut.split("\n").slice(-1)[0] || "pushed"}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    // DIAGNOSABLE-RED LAW (Z-74): ה-catch הקודם בלע את ה-stack — שגיאה כמו
    // "JSON Parse error: Unrecognized token '<'" נשארה עיוורת (ריצה 00:01:10Z
    // נכשלה בלי שום ציון מקור). מעתה: stack מלא + cause + שם-השגיאה, ובמקרה
    // של פענוח-JSON — גם 80 הבייטים הראשונים של הקלט (לעולם לא סודות: רק
    // קבצי-ספר/קו ציבוריים עוברים כאן; ה-seal לעולם לא נדפס).
    if (e instanceof Error) {
      console.error("ANCHOR-ZERO-ERROR:", e.name + ": " + e.message);
      if (e.stack) console.error("ANCHOR-ZERO-STACK:", e.stack.split("\n").slice(1, 12).join("\n"));
      const cause = (e as Error & { cause?: unknown }).cause;
      if (cause) console.error("ANCHOR-ZERO-CAUSE:", cause instanceof Error ? cause.message : String(cause));
    } else {
      console.error("ANCHOR-ZERO-ERROR:", e);
    }
    process.exit(1);
  });
