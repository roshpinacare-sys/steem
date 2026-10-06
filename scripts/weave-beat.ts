#!/usr/bin/env bun
// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · weave-beat - ה-runner של מחזור הפעימה הריבוני
//
// רץ בשני עולמות, אותה מכניקה:
//   · הענן (GitHub Actions, .github/workflows/weave-heart.yml):
//       אם הספר "חי" (אימות/דחיפה טרייה מה-runner הראשי) · אימות-בלבד.
//       אם ישן/חסר · TAKEOVER: אימות · הרחבה · checkpoint -> push.
//       השרשרת עצמה השופטת - כמו cloud-heart של הצי.
//   · ה-runner הראשי (הסנדבוקס/מקומי): פעימה מלאה תמיד (--local).
//
// זרימה:
//   pull · ייבוא ledger.json אם ה-remote חדש מהמקומי · פתיחת seal ->
//   runBeat (verify->attest->checkpoint·שערים) · ייצוא ledger.json ->
//   דוח · שער-סודות · commit+push.
//
// דגלים: --no-push (בדיקה מקומית בלי דחיפה) · --local (runner ראשי)
// ─────────────────────────────────────────────────────────────────────

import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { db } from "@/lib/db";
import { exportLedger, importLedger, parseLedgerSnapshot } from "@/lib/weave/ledger-sync";
import { runBeat, verifyLedger, ensureNetworkKeyFromSeal, createCheckpointNow, ensureCloudAgent, type BeatContext } from "@/lib/weave/beat";
import { appendAttestation } from "@/lib/weave/ledger";
import { resolveOpenMarkets, type SettlementResult } from "@/lib/weave/market";
import { crossAnchorSaosnet, type CrossAnchorResult } from "@/lib/weave/crosschain";
import { witnessArchive, type ArchiveWitnessResult } from "@/lib/weave/archive";
import { brainProbeAll } from "@/lib/weave/brain";
import { processOperatorCommands, type OperatorOpsResult } from "@/lib/weave/ops";
import { processSaosLive, type SaosLiveResult } from "@/lib/weave/saoslite";
import { publishConsoleMirror, publishConsoleAssets, publishConsoleLedger } from "@/lib/weave/mirror";
import { sealOpen } from "./weave-seal";

const ROOT = path.resolve(__dirname, "..");
const LEDGER_PATH = path.join(ROOT, "sovereign", "ledger.json");
const REPORT_PATH = path.join(ROOT, "sovereign", "beat-report.json");
const BRANCH = process.env.WEAVE_BRANCH || "main";

const IS_ACTIONS = !!process.env.GITHUB_ACTIONS;
const FORCE_LOCAL = process.argv.includes("--local");
const NO_PUSH = process.argv.includes("--no-push");

// טריקות רעננות שהספר עצמו קובע: אימות אחרון של ה-runner הראשי
// (Task 19 - תיקון מדידה חמור: אימותי ANCHOR נכתבים בידי קווי העיגון
// הענניים עצמם, וכל ריצת עיגון יוצרת checkpoint חדש שהריצה הבאה מעגנת -
// תנועת-נצח שמזינה את איתות "האימות האחרון" לנצח. מדידה על כל סוג
// האימותים גרמה ל-TAKEOVER שלעולם לא מופעל ולמכריע השוק שלעולם לא
// רץ בענן. התיקון: איתות החיים = האימות האחרון שאינו ANCHOR - פעימה,
// שוק, הצלבה, ביקורת - כולם נכתבים בידי ה-runner הראשי או בהפעלתו.)
const STALE_ATTMin = Number(process.env.WEAVE_STALE_MIN || 26 * 60); // 26 שעות
// דגל השתלטות ידנית: דולג על דוקטרינת החיים - הענן לוקח פיקוד גם אם
// הספר טרי (dispatch של force-beat). למד היטב: סף "999999" הפך הכול
// ל"טרי" והענן נסוג - נתפס במדידה (run #2, 2026-09-14) ותוקן בדגל מפורש.
// (אות הגיט הוסר - נלמד במדידה: דחיפות העוגנים מזינות אותו לנצח,
// והוא לעולם לא הבחין runner ראשי מקו עיגון ענן.)
const FORCE_BEAT = process.env.WEAVE_FORCE_BEAT === "1";

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

// ── שער הסודות (חוק הברזל של gitkeeper) - מקור קנוני אחד: weave-gate ──
import { secretGate, filterKnownHashes, gitPushRetry } from "./weave-gate";

async function localLedgerState(): Promise<{ count: number; head: string }> {
  const [last, count] = await Promise.all([
    db.attestation.findFirst({ orderBy: { seq: "desc" } }),
    db.attestation.count(),
  ]);
  return { count, head: last?.entryHash ?? "0x" + "0".repeat(64) };
}

async function main(): Promise<void> {
  const runner: BeatContext["runner"] = IS_ACTIONS && !FORCE_LOCAL ? "github-actions" : "local-primary";
  const gitHead = gitOrNull("git rev-parse --short HEAD") ?? "unknown";
  const repoSlug = process.env.GITHUB_REPOSITORY ?? "roshpinacare-sys/weave-core";
  const runUrl = process.env.GITHUB_SERVER_URL
    ? `${process.env.GITHUB_SERVER_URL}/${repoSlug}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : undefined;

  console.log(`[weave-beat] runner=${runner} head=${gitHead}`);

  // 1. בענן - checkout טרי; מקומית - pull קודם (ה-remote הוא האמת)
  if (runner === "local-primary" && gitOrNull("git remote get-url origin")) {
    const pull = gitOrNull(`git pull --rebase origin ${BRANCH} --no-edit`) ?? "";
    if (pull.includes("CONFLICT")) {
      throw new Error("קונפליקט pull - הרץ ידנית: git pull --rebase, ייבוא ledger.json, ואז beat");
    }
    if (pull) console.log("[weave-beat] pull:", pull.split("\n").slice(-2).join(" "));
  }

  // 2. ייבוא ledger.json אם הקובץ חדש מה-DB המקומי
  if (fs.existsSync(LEDGER_PATH)) {
    const snap = parseLedgerSnapshot(fs.readFileSync(LEDGER_PATH, "utf8"));
    const local = await localLedgerState();
    if (snap.chainCount > local.count) {
      console.log(`[weave-beat] מייבא ledger.json: ${snap.chainCount} > ${local.count} מקומי`);
      const res = await importLedger(snap);
      console.log(
        `[weave-beat] יובאו ${res.imported.attestations} אימותים · מפתחות מקומיים נשמרו: ${res.keysPreserved.agents}`
      );
    } else if (snap.chainCount === local.count && snap.headHash !== local.head) {
      throw new Error(
        "סתירה: ledger.json וה-DB באותו אורך אבל head שונה - נדרשת בדיקה ידנית"
      );
    }
  }

  // 3. פתיחת seal - מפתחות הענן והרשת
  const seal = sealOpen();
  console.log(`[weave-beat] seal פתוח · cloud=${seal.cloudAddress} · network=${seal.networkAddress}`);
  // השלמת מפתח הרשת מה-seal - בכל סביבה, גם ב-clone נקי שבו הייבוא
  // השאיר devKeyHex ריק (נלמד מ-run #3: בלי זה ה-checkpoint נכשל בענן)
  const netKey = await ensureNetworkKeyFromSeal(seal.networkKeyHex);
  console.log(`[weave-beat] מפתח רשת הושלם מה-seal · ${netKey.address}`);

  // 3.5 פקודות המפעיל (שער הכניסה - Task 26): השער הציבורי משדר
  //     custom_json חתום מ-@headcorner (רשות posting - השרשרת אימתה
  //     את החתימה בהכללה לבלוק). הלב קורא מהשרשרת הציבורית ומבצע.
  //     פקודה שבוצעה מעירה את הרשת - גם ב-SANDBOX-ALIVE: המפעיל
  //     דיבר, הרשת מגיבה בפעימה מלאה ודחיפה (ריבונות הבעלים).
  let opsResult: OperatorOpsResult | null = null;
  try {
    const opsCloudAgent = await ensureCloudAgent(seal.cloudKeyHex);
    opsResult = await processOperatorCommands({ runner, cloudAgentId: opsCloudAgent.id, gitHead, repoSlug, runUrl });
    if (opsResult.executed.length > 0) {
      console.log(
        `[weave-beat] פקודות מפעיל בוצעו: ${opsResult.executed.length} · ${opsResult.executed.map((e) => `${e.cmd}${e.ok ? "ok" : "FAIL"}`).join(", ")}${opsResult.checkpoint ? ` · cp#${opsResult.checkpoint.index}` : ""}`
      );
    }
  } catch (opsErr) {
    console.log(
      `[weave-beat] פקודות מפעיל: לא נקראו - ${opsErr instanceof Error ? opsErr.message : String(opsErr)} (ההעשרה לעולם לא מפילה את הלב)`
    );
  }

  // 3.6 אכיפת G6 - עדות על מדידת האקוסיסטם (Task 26): הסריקה היומית
  //     (weave-ecosystem) מודדת שכפול על כל הריפואים ומחייבת את הדוח
  //     ל-sovereign/reports/ecosystem-dup-latest.json. הלב מעיד על כל
  //     מדידה חדשה פעם אחת - אימות AUDIT חתום שמכוסה checkpoint
  //     והעוגנים מעידים עליו ב-$0. dup ≥ 0.2 במדידה · העדות עצמה
  //     נושאת את ההפרה בקול (ההתראה האדומה חיה בריצת הסריקה).
  let ecoWitness: { attSeq: number; checkpoint: { index: number; root: string } } | null = null;
  try {
    const ecoPath = path.join(ROOT, "sovereign", "reports", "ecosystem-dup-latest.json");
    if (fs.existsSync(ecoPath)) {
      const eco = JSON.parse(fs.readFileSync(ecoPath, "utf8")) as {
        measuredAt?: string; totals?: { measured?: number; dupGroups?: number; redundantCopies?: number; dupRatio?: number };
      };
      const measuredAt = String(eco.measuredAt || "");
      const t = eco.totals || {};
      if (measuredAt && typeof t.dupRatio === "number") {
        const heldRatio = t.dupRatio! < 0.2;
        const already = await db.attestation.findFirst({
          where: { claimType: "AUDIT", evidence: { contains: `ecoMeasuredAt=${measuredAt}` } },
        });
        // סגירת R1 (Task 27 - יישור אמת): השלב נסגר מול כל עדות G6 כשרה -
        // גם עדות שנכתבה בעבר (att68) סוגרת את הרישום בפעימה הבאה שרואה אותה.
        if (heldRatio) {
          const r1 = await db.planStage.findUnique({ where: { code: "R1" } });
          const r1EvidenceSeq = already?.seq ?? null;
          if (r1 && r1.state !== "DONE" && r1EvidenceSeq !== null) {
            await db.planStage.update({ where: { code: "R1" }, data: { state: "DONE", attSeq: r1EvidenceSeq } });
            console.log(`[weave-beat] R1 (איחוד) נסגר בספר - עדות att${r1EvidenceSeq} (dup=${t.dupRatio} < 0.2)`);
          }
        }
        if (!already) {
          const ecoAgent = await ensureCloudAgent(seal.cloudKeyHex);
          const held = t.dupRatio! < 0.2;
          const att = await appendAttestation({
            agentId: ecoAgent.id,
            claim:
              `מדידת אקוסיסטם (G6) הונחה בספר: dup=${t.dupRatio} - ${t.redundantCopies} עותקים יתרים מתוך ${t.measured} ` +
              `קבצי-סטטוס שנמדדו (${t.dupGroups} קבוצות שכפול) · יעד <0.2 ` +
              (held ? "מוחזק" : "מופר - התראה אדומה חיה בריצת הסריקה"),
            claimType: "AUDIT",
            evidence: [
              `ecoMeasuredAt=${measuredAt}`,
              `measured=${t.measured}`,
              `dupGroups=${t.dupGroups}`,
              `redundantCopies=${t.redundantCopies}`,
              `dupRatio=${t.dupRatio}`,
              `target=<0.2`,
              `verdict=${held ? "HELD" : "VIOLATED"}`,
              `scanner=weave-ecosystem (daily, cloud)`,
              `runner=${runner}`,
              `commit=${gitHead}`,
              runUrl ? `run=${runUrl}` : null,
            ]
              .filter(Boolean)
              .join(" · "),
          });
          const cp = await createCheckpointNow();
          if (cp) ecoWitness = { attSeq: att.seq, checkpoint: { index: cp.index, root: cp.root } };
          console.log(
            `[weave-beat] G6: מדידת ${measuredAt} הועידה - att${att.seq} · dup=${t.dupRatio}${ecoWitness ? ` · cp#${ecoWitness.checkpoint.index}` : ""}`
          );
        }
      }
    }
  } catch (ecoErr) {
    console.log(
      `[weave-beat] G6: עדות המדידה נדחתה תפעולית - ${ecoErr instanceof Error ? ecoErr.message : String(ecoErr)} (ההעשרה לעולם לא מפילה את הלב)`
    );
  }

  // 3.55 ביקורת יכולת-חתימה יומית (Task 27 - תיקון אמת): הרשת מציגה
  //     "9 סוכנים ACTIVE" אבל האמת המדודה: רק הלב-ענן חותם (מפתח
  //     sealed); מפתחות שאר התפקידים חיו ב-DB הסנדבוקסי ומתים עם הסביבה.
  //     רשת אימות לא מסתירה את זה - פעם ביום נכתב דוח יכולת כנה וחתום.
  //     (עתיד: החוק 15 - הפרדת תפקידים תחיה מפתחות נפרדים ב-seal.)
  try {
    const today = new Date().toISOString().slice(0, 10);
    const alreadyCap = await db.attestation.findFirst({
      where: { claimType: "AUDIT", evidence: { contains: `capAuditDate=${today}` } },
    });
    if (!alreadyCap) {
      const allAgents = await db.agent.findMany({ orderBy: { name: "asc" } });
      const rows: string[] = [];
      let sealedSigners = 0;
      for (const a of allAgents) {
        const canSign = !!a.devKeyHex;
        if (canSign) sealedSigners++;
        rows.push(`${a.name}(${a.role}:${canSign ? "sealed-key ok" : "memory-only - key lost with its environment"})`);
      }
      const capAgent = await ensureCloudAgent(seal.cloudKeyHex);
      const att = await appendAttestation({
        agentId: capAgent.id,
        claim:
          `ביקורת יכולת-חתימה יומית: ${allAgents.length} זהויות תפקיד בספר, ${sealedSigners} חותמים בפועל ` +
          `(sealed) · השאר memory-only - מפתחותיהם חיו ב-DB סביבתי ומתים עם הסביבה · ` +
          `הפונקציות שלהם נבלעו בלב (gitkeeper·דחיפות, scout·סריקת האקוסיסטם) או ממתינות (relayer·עדות הפוכה)`,
        claimType: "AUDIT",
        evidence: [
          `capAuditDate=${today}`,
          `identities=${allAgents.length}`,
          `sealedSigners=${sealedSigners}`,
          `roster=${rows.join(" · ")}`,
          `law15-next=separate sealed keys per role`,
          `runner=${runner}`,
          `commit=${gitHead}`,
        ].join(" · "),
      });
      const capCp = await createCheckpointNow();
      console.log(
        `[weave-beat] יכולת: att${att.seq} - ${sealedSigners}/${allAgents.length} חותמים sealed · שאר memory-only (אמת נמדדת)${capCp ? ` · cp#${capCp.index}` : ""}`
      );
    }
  } catch (capErr) {
    console.log(
      `[weave-beat] ביקורת יכולת: נדחתה תפעולית - ${capErr instanceof Error ? capErr.message : String(capErr)} (לא מפילה את הלב)`
    );
  }

  // 3.7 המראה הציבורית (Task 27): מצב הרשת הנגזר מתפרסם לקונסולה הציבורית
  //     (mirror.json) - החזות החיה של הרשת חיה מעתה ברשת עצמה, לא בסנדבוקס.
  //     רץ בכל פעימה - גם ב-SANDBOX-ALIVE: הצגת האמת לעולם לא תלויה בסביבה.
  try {
    const mirror = await publishConsoleMirror();
    if (mirror.published) {
      console.log(`[weave-beat] מראה ציבורית פורסמה לקונסולה (${Math.round((mirror.bytes || 0) / 1024)}KB)`);
    } else {
      console.log(`[weave-beat] מראה: ${mirror.reason}`);
    }
  } catch (mirrorErr) {
    console.log(
      `[weave-beat] מראה: נדחתה תפעולית - ${mirrorErr instanceof Error ? mirrorErr.message : String(mirrorErr)} (לא מפילה את הלב)`
    );
  }

  // 3.68 הספר הציבורי ל-replay (r121 · חוק 13): ה-ledger המיוצא מתפרסם
  //      בקיצור-ל-replay אל Console (ledger.json) — הנתיב הציבורי
  //      "הרץ את האמת בעצמך" חי מעתה ב-URL אמיתי, לא בהבטחה 404.
  try {
    const ledger = await publishConsoleLedger();
    if (ledger.published) {
      console.log(`[weave-beat] ספר-replay ציבורי פורסם לקונסולה (${Math.round((ledger.bytes || 0) / 1024)}KB)`);
    } else {
      console.log(`[weave-beat] ספר-replay: ${ledger.reason}`);
    }
  } catch (ledgerErr) {
    console.log(
      `[weave-beat] ספר-replay: נדחה תפעולית - ${ledgerErr instanceof Error ? ledgerErr.message : String(ledgerErr)} (לא מפילה את הלב)`
    );
  }

  // 3.72 SAOS-LIVE v1 (Task 29) - המטבע החי של הרשת: הלב קורא את ספר
  //      הטוקנים מהשרשרת הציבורית (חסר-מפתח), מניח את הג'נזיס אם SAOS
  //      טרם נפרש (ענן, WEAVE_STEEM_WIF - אטומי וחד-פעמי), מקפל באותו
  //      מנוע שרץ בכל דפדפן (console/saos-live.js), מפרסם את saos-live.json
  //      לקונסולה, ומעיד SAOSLIVE על כל שינוי stateRoot - שינוי במטבע
  //      מעיר את הרשת (עוקף SANDBOX-ALIVE), בדיוק כמו פקודת מפעיל.
  let saosLiveResult: SaosLiveResult | null = null;
  try {
    const liveCloudAgent = await ensureCloudAgent(seal.cloudKeyHex);
    saosLiveResult = await processSaosLive({ runner, cloudAgentId: liveCloudAgent.id, gitHead, repoSlug, runUrl });
    if (saosLiveResult.attested) {
      console.log(
        `[weave-beat] SAOS-LIVE: הספר התקדם - att${saosLiveResult.attSeq} · ${saosLiveResult.valid} פעולות · ${saosLiveResult.wallets} ארנקים · ${saosLiveResult.tokens} חוזים · stateRoot ${saosLiveResult.stateRoot.slice(0, 16)}…`
      );
    } else {
      console.log(
        `[weave-beat] SAOS-LIVE: ${saosLiveResult.valid}/${saosLiveResult.ops} פעולות · ${saosLiveResult.wallets} ארנקים · ${saosLiveResult.tokens} חוזים · ג'נזיס: ${saosLiveResult.genesisNote} · פרסום: ${saosLiveResult.publishNote}`
      );
    }
  } catch (liveErr) {
    console.log(
      `[weave-beat] SAOS-LIVE: נדחה תפעולית - ${liveErr instanceof Error ? liveErr.message : String(liveErr)} (לא מפילה את הלב)`
    );
  }

  // 3.75 נכסי הקונסולה (Task 28): הקבצים הכתובים-יד (gate.html, acid.html,
  //      acid-engine.js…) מסונכרנים מהריפו הריבוני אל הריפו הציבורי -
  //      הגיט הוא המקור, הענן הוא המפרסם, הסנדבוקט אינו נדרש לרגע.
  //      מסונכרן בכל פעימה - פרסום רק בשינוי אמיתי (תקציב ה-API נשמר).
  try {
    const assets = await publishConsoleAssets();
    if (assets.published.length > 0) {
      console.log(`[weave-beat] נכסי קונסולה סונכרנו (${assets.published.join(", ")})${assets.failed.length ? ` · כשלים כנים: ${assets.failed.join(" | ")}` : ""}`);
    } else if (assets.reason) {
      console.log(`[weave-beat] נכסי קונסולה: ${assets.reason}`);
    } else if (assets.failed.length > 0) {
      console.log(`[weave-beat] נכסי קונסולה: כשל-פרסום כנה - ${assets.failed.join(" | ")} (המחזור הבא ינסה)`);
    } else {
      console.log(`[weave-beat] נכסי קונסולה עדכניים (${assets.unchanged.length} קבצים ללא שינוי)`);
    }
  } catch (assetsErr) {
    console.log(
      `[weave-beat] נכסי קונסולה: נדחו תפעולית - ${assetsErr instanceof Error ? assetsErr.message : String(assetsErr)} (לא מפילה את הלב)`
    );
  }

  // 4. דוקטרינת חיים (ענן בלבד): ספר טרי · אימות-בלבד, אין הרחבה
  //    force-beat דולג עליה - השתלטות ידנית מדגימה (SOV-2, אימון)
  //    פקודת מפעיל שבוצעה דולגת עליה - המפעיל העיר את הרשת
  if (runner === "github-actions" && FORCE_BEAT) {
    console.log("[weave-beat] FORCE-BEAT: dispatch ידני - הענן לוקח פיקוד ללא קשר לטריות");
  } else if (runner === "github-actions") {
    // איתות החיים (Task 19): האימות האחרון שאינו ANCHOR - רק עבודה
    // אמיתית של ה-runner הראשי (פעימה/שוק/הצלבה/ביקורת) מוכיחה שהוא
    // חי. אימותי ANCHOR מוכיחים שהעוגנים חיים - והם חיים תמיד.
    const lastPrimaryAtt = await db.attestation.findFirst({
      where: { claimType: { not: "ANCHOR" } },
      orderBy: { createdAt: "desc" },
    });
    const attAgeMin = lastPrimaryAtt
      ? (Date.now() - lastPrimaryAtt.createdAt.getTime()) / 60000
      : Infinity;
    const fresh = attAgeMin < STALE_ATTMin;

    if (fresh && (opsResult === null || opsResult.executed.length === 0) && ecoWitness === null && (saosLiveResult === null || !saosLiveResult.attested)) {
      const verify = await verifyLedger();
      const report = {
        at: new Date().toISOString(),
        runner,
        mode: "ALIVE-VERIFY-ONLY",
        verdict: verify.valid ? "LEDGER-VALID (primary runner live - cloud stands down)" : "LEDGER-BROKEN",
        verify,
        beat: null,
        gatesClosed: [],
        freshness: {
          primaryAttestAgeMin: Number.isFinite(attAgeMin) ? Math.round(attAgeMin) : null,
          signal: "last non-ANCHOR attestation (primary-runner work)",
        },
        context: { runner, gitHead, repoSlug, runUrl },
      };
      fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
      fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + "\n");
      console.log(
        `[weave-beat] SANDBOX-ALIVE (primary att ${Math.round(attAgeMin)}min) - הענן נסוג, אימות בלבד`
      );
      console.log(`[weave-beat] verdict=${report.verdict} · checked=${verify.checked} · sigOk=${verify.sigOk}`);
      // אימות בלבד - לא דוחפים כלום (אפס כתיבה לשרשרת)
      return;
    }
    if ((opsResult && opsResult.executed.length > 0) || ecoWitness !== null) {
      console.log(
        `[weave-beat] SANDBOX-ALIVE אך עבודה ריבונית ממתינה (${[
          ...(opsResult?.executed ?? []).map((e) => "cmd:" + e.cmd),
          ...(ecoWitness ? ["G6:" + ecoWitness.attSeq] : []),
        ].join(", ")}) - הרשת מתעוררת לפעימה מלאה`
      );
    } else {
      console.log(
        `[weave-beat] TAKEOVER: primary att ${Math.round(attAgeMin)}min - הענן לוקח פיקוד`
      );
    }
  }

  // 5. הפעימה עצמה
  const context: BeatContext = { runner, gitHead, repoSlug, runUrl };
  const result = await runBeat(context, seal.cloudKeyHex);

  console.log(
    `[weave-beat] verdict=${result.verdict} · checked=${result.verify.checked} · sigOk=${result.verify.sigOk}`
  );
  if (result.beat) {
    console.log(
      `[weave-beat] beat seq=${result.beat.seq} · entry=${result.beat.entryHash.slice(0, 18)}… · cp=${
        result.beat.checkpoint ? `#${result.beat.checkpoint.index} root=${result.beat.checkpoint.root.slice(0, 14)}…` : "אין חדש"
      }`
    );
  }
  if (result.gatesClosed.length > 0) {
    console.log(`[weave-beat] שערים שנסגרו: ${result.gatesClosed.map((g) => `${g.code}·att${g.attSeq}`).join(", ")}`);
  }

  // 5.5 שוק האמת - סליקה אוטומטית בסוף כל פעימה (Task 15-a):
  //     השופט הוא המדידה של הרשת עצמה, ולכן המכריע רץ בכל פעימה -
  //     הוכרע · SETTLE פרו-רטה · פג תוקף · REFUND כנה. כל סליקה
  //     נכתבת כאימות MARKET חתום ומכוסה מיידי ב-checkpoint -
  //     אותו checkpoint שהעוגנים (:20/:30) מעידים עליו ב-$0.
  //     ספר שבור לא מורחב - לעולם לא מסלקים על ספר שקרי.
  let marketSettlement: SettlementResult | null = null;
  let marketCheckpoint: { index: number; root: string } | null = null;
  if (result.verdict === "LEDGER-VALID") {
    marketSettlement = await resolveOpenMarkets();
    if (marketSettlement.attSeqs.length > 0) {
      const cp = await createCheckpointNow();
      if (cp) marketCheckpoint = { index: cp.index, root: cp.root };
    }
    if (marketSettlement.settled.length > 0 || marketSettlement.refunded.length > 0) {
      console.log(
        `[weave-beat] שוק האמת נסלק: ${marketSettlement.settled.length} הוכרעו · ${marketSettlement.refunded.length} הוחזרו · אימותים att${marketSettlement.attSeqs.join(",att")}${marketCheckpoint ? ` · cp#${marketCheckpoint.index}` : ""}`
      );
    }
    // הימורי-רצף - הדור הבא שהרשת פתחה בעצמה (או הסיבה הכנה שלא):
    if (marketSettlement.successors.length > 0) {
      for (const s of marketSettlement.successors) {
        console.log(
          `[weave-beat] הימור-רצף: שוק #${s.marketSeq} ${s.successorSeq != null ? `הוליד את #${s.successorSeq} (דור ${s.depth}) - הרשת ממשיכה לשאול` : `לא הוליד דור הבא: ${s.reason ?? "?"}`}`
        );
      }
    }
  }

  // 5.6 עוגן-עוגנים - הצלבת SAOS-NET בספר בכל פעימה (Task 17):
  //     שרשרת הכלכלה של הצי נמדדת ב-replay דטרמיניסטי; stateRoot שטרם
  //     העיד בספר · אימות CROSSCHAIN חתום · checkpoint מכסה · העוגנים
  //     מעידים עליו החוצה ב-$0 (Steem/Hive ב-:20 · ZERO ב-:30). אותו
  //     שורש · דילוג כנה; replay שבור · REFUSED - לא נכתבת עדות על
  //     מצב בלתי-מאומת (fail-closed). ההצלבה היא העשרה - כשל תפעולי
  //     בה (runner/סביבה) נרשם בכנות ולא מפיל את הלב.
  let crossAnchor: CrossAnchorResult | null = null;
  let crossCheckpoint: { index: number; root: string } | null = null;
  if (result.verdict === "LEDGER-VALID") {
    try {
      crossAnchor = await crossAnchorSaosnet();
      if (crossAnchor.status === "ATTESTED" && crossAnchor.attSeq !== null) {
        const cp = await createCheckpointNow();
        if (cp) crossCheckpoint = { index: cp.index, root: cp.root };
        console.log(
          `[weave-beat] עוגן-עוגנים: SAOS-NET הוצלב - att${crossAnchor.attSeq} · h=${crossAnchor.net.height} · stateRoot=…${crossAnchor.net.stateRoot.slice(-8)}${crossCheckpoint ? ` · cp#${crossCheckpoint.index}` : ""}`
        );
      } else if (crossAnchor.status === "REFUSED") {
        console.log(`[weave-beat] עוגן-עוגנים: REFUSED - ${crossAnchor.reason}`);
      }
    } catch (crossErr) {
      console.log(
        `[weave-beat] עוגן-עוגנים: נדחה תפעולית - ${crossErr instanceof Error ? crossErr.message : String(crossErr)}`
      );
    }
  }

  // 5.7 עד הארכיון - ההיסטוריה הכתובה נמדדת חיה בכל פעימה (Task 19):
  //      ריפו anchor-baseline (הדוחות/broadcasts של הצי) נגזר מהמקור -
  //      tarball -> sha256 · עלה · שורש מרקל (אותה תוכנית-האש של הגזירה
  //      החד-פעמית, att 9 - נאמנות ההעברה הוכחה בשחזור מושלם). שורש
  //      שטרם העיד בספר · אימות CROSSCHAIN חתום · checkpoint מכסה ·
  //      העוגנים מעידים עליו ב-$0. אותו שורש · דילוג כנה; אין גישה
  //      לריפו הפרטי (ענן בלי WEAVE_ARCHIVE_TOKEN) -> REFUSED בכנות -
  //      ההעשרה לעולם לא מפילה את הלב.
  let archiveWitness: ArchiveWitnessResult | null = null;
  let archiveCheckpoint: { index: number; root: string } | null = null;
  if (result.verdict === "LEDGER-VALID") {
    try {
      archiveWitness = await witnessArchive();
      if (archiveWitness.status === "ATTESTED" && archiveWitness.attSeq !== null) {
        const cp = await createCheckpointNow();
        if (cp) archiveCheckpoint = { index: cp.index, root: cp.root };
        console.log(
          `[weave-beat] עד הארכיון: att${archiveWitness.attSeq} · root=…${(archiveWitness.snapshot?.root ?? "").slice(-8)}${archiveCheckpoint ? ` · cp#${archiveCheckpoint.index}` : ""}`
        );
      } else {
        console.log(
          `[weave-beat] עד הארכיון: ${archiveWitness.status} - ${archiveWitness.reason.slice(0, 140)}`
        );
      }
    } catch (archiveErr) {
      console.log(
        `[weave-beat] עד הארכיון: נדחה תפעולית - ${archiveErr instanceof Error ? archiveErr.message : String(archiveErr)}`
      );
    }
  }

  // 5.8 המוח - אימות-אמת שעתי של המאגר (Task 25): המוח חי בספר (כספת
  //     אדיטיבית), והלב בודק שהוא עדיין חי מול NVIDIA בכל פעימה -
  //     1-token chat לכל מפתח, סטטוס נשמר ב-DB וזורם לספר בייצוא של
  //     שש. בסביבה בלי מפתח רשת (סנדבוקס fail-closed) - נרשם בכנות
  //     ולא מפיל את הפעימה; העשרה לעולם לא חוסמת את הלב.
  let brainProbe: Array<{ fingerprint: string; live: boolean; code: number | string }> | null = null;
  try {
    const poolCount = await db.brainKey.count();
    if (poolCount > 0) {
      brainProbe = await brainProbeAll();
      const live = brainProbe.filter((p) => p.live).length;
      console.log(`[weave-beat] המוח: ${live}/${poolCount} מפתחות LIVE (אימות-אמת 1-token)`);
    }
  } catch (brainErr) {
    console.log(
      `[weave-beat] המוח: נעול או לא-זמין - ${brainErr instanceof Error ? brainErr.message : String(brainErr)}`
    );
  }

  // 6. ייצוא הספר + דוח (הסליקות של 5.5, ההצלבה של 5.6, עד הארכיון של 5.7 והמוח של 5.8 כלולים)
  const snap = await exportLedger();
  fs.mkdirSync(path.dirname(LEDGER_PATH), { recursive: true });
  fs.writeFileSync(LEDGER_PATH, JSON.stringify(snap, null, 2) + "\n");
  const report = {
    ...result,
    ...(marketSettlement
      ? {
          market: {
            settled: marketSettlement.settled,
            refunded: marketSettlement.refunded,
            successors: marketSettlement.successors,
            attSeqs: marketSettlement.attSeqs,
            checkpoint: marketCheckpoint,
          },
        }
      : {}),
    ...(crossAnchor
      ? {
          crosschain: {
            status: crossAnchor.status,
            reason: crossAnchor.reason,
            attSeq: crossAnchor.attSeq,
            net: crossAnchor.net,
            checkpoint: crossCheckpoint,
          },
        }
      : {}),
    ...(archiveWitness
      ? {
          archive: {
            status: archiveWitness.status,
            reason: archiveWitness.reason,
            attSeq: archiveWitness.attSeq,
            snapshot: archiveWitness.snapshot,
            checkpoint: archiveCheckpoint,
          },
        }
      : {}),
    ...(brainProbe ? { brain: { probed: brainProbe } } : {}),
    ...(opsResult && opsResult.executed.length > 0
      ? {
          operatorCommands: {
            executed: opsResult.executed,
            attSeqs: opsResult.attSeqs,
            checkpoint: opsResult.checkpoint,
            readFrom: opsResult.readFrom,
          },
        }
      : {}),
    ...(ecoWitness ? { ecosystemG6: { attSeq: ecoWitness.attSeq, checkpoint: ecoWitness.checkpoint } } : {}),
  };
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + "\n");
  console.log(
    `[weave-beat] ledger.json ייוצא: ${snap.chainCount} אימותים · head=${snap.headHash.slice(0, 18)}…`
  );

  if (result.verdict !== "LEDGER-VALID") {
    // שרשרת שבורה - לא דוחפים, דוח אדום נשמר מקומית
    throw new Error(
      `השרשרת שבורה (firstBreak=${result.verify.firstBreak ?? "?"}) - הפעימה נעצרה, לא נדחף ספר שקרי`
    );
  }

  if (NO_PUSH) {
    console.log("[weave-beat] --no-push - הודגם בלבד, לא נדחף");
    return;
  }

  // 7. שער-סודות ואז דחיפה - בלי origin אין ריבונות; נכשלים בקול רם
  if (!gitOrNull("git remote get-url origin")) {
    throw new Error("אין remote origin - מוגדר: git remote add origin <url>. בלי ריפו אין פעימה");
  }
  // זהות הרץ בענן בלבד - כך שהיסטוריית הגיט מבדילה פעימות ענן מפעימות מקומיות
  if (IS_ACTIONS && !FORCE_LOCAL) {
    sh('git config user.name "weave-heart[bot]" && git config user.email "weave-heart[bot]@users.noreply.github.com"');
  }
  execSync(`git add -A`, { cwd: ROOT, stdio: "ignore" });
  const staged = gitOrNull("git diff --cached") ?? "";
  const leak = secretGate(filterKnownHashes(staged));
  if (leak) {
    execSync("git reset", { cwd: ROOT, stdio: "ignore" });
    throw new Error(`שער הסודות חסם את הדחיפה: ${leak} ב-diff - כלום לא נדחף`);
  }

  const nFiles = (gitOrNull("git diff --cached --name-only") ?? "").split("\n").filter(Boolean).length;
  const marketNote = marketSettlement
    ? ` · market ${marketSettlement.settled.length}s/${marketSettlement.refunded.length}r${
        marketSettlement.successors.filter((s) => s.successorSeq != null).length > 0
          ? ` · seq-chain +${marketSettlement.successors.filter((s) => s.successorSeq != null).length}`
          : ""
      }`
    : "";
  const crossNote =
    crossAnchor && crossAnchor.status === "ATTESTED" && crossAnchor.attSeq !== null
      ? ` · crosschain att${crossAnchor.attSeq}`
      : "";
  const archiveNote =
    archiveWitness && archiveWitness.status === "ATTESTED" && archiveWitness.attSeq !== null
      ? ` · archive att${archiveWitness.attSeq}`
      : "";
  const msg = `weave-heart: beat ${result.at} · seq ${result.beat?.seq ?? "?"} · ${result.verify.checked} att · ${result.verify.sigOk}/${result.verify.checked} sig${marketNote}${crossNote}${archiveNote}`;
  execSync(`git commit -m ${JSON.stringify(msg)}`, { cwd: ROOT, stdio: "ignore" });
  const pushOut = gitPushRetry(ROOT, BRANCH);
  console.log(`[weave-beat] gitkeeper: ${nFiles} files · ${pushOut.split("\n").slice(-1)[0] || "pushed"}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("BEAT-ERROR:", e instanceof Error ? e.message : e);
    process.exit(1);
  });
