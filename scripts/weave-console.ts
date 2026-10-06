#!/usr/bin/env bun
// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · weave-console - G5: הקונסולה הציבורית (המשואה של הרשת)
//
// ארכיטקטורת החוץ (הקונסולה):
//   · הריפו הציבורי Console מחזיק אתר סטטי + render.mjs + workflow משלו
//     (schedule כל 6 שעות ב-:40, GITHUB_TOKEN שלו בלבד - אפס סודות).
//   · render.mjs קורא את קו העוגנים מ-Steem ציבורי (חסר-מפתח) ומרנדר
//     status.json; ה-workflow מבצע commit ומפרסם Pages. השרשרת הציבורית
//     היא המקור: אין תלות בסנדבוקס, בריפו הפרטי או בפתחי-מפתח כלשהם.
//   · מקור האתר חי בריפו הריבוני (console/) - זר משחזר את החלון מהבית.
//
// התפקיד של הסקריפט הזה: לסגור את G5 במדידה חתומה. הוא בודק את הצינור
// מקצה לקצה - ledger מקומי · עוגן on-chain -> status.json שמוגש בחוץ -
// ורק אז כותב אימות CONSOLE לספר (חתום EIP-191 במפתח הענן מה-seal).
//
// שימוש: bun scripts/weave-console.ts --attest-g5
// (ברירת מחדל בלי דגל: בדיקה בלבד, לא נכתב כלום - "אין טענה בלי מדידה")
// ─────────────────────────────────────────────────────────────────────

import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { db } from "@/lib/db";
import { exportLedger, importLedger, parseLedgerSnapshot } from "@/lib/weave/ledger-sync";
import { verifyLedger, ensureCloudAgent, ensureNetworkKeyFromSeal, createCheckpointNow } from "@/lib/weave/beat";
import { appendAttestation } from "@/lib/weave/ledger";
import { sealOpen } from "./weave-seal";

const ROOT = path.resolve(__dirname, "..");
const LEDGER_PATH = path.join(ROOT, "sovereign", "ledger.json");
const LINE_PATH = path.join(ROOT, "sovereign", "steem-line.json");
const BRANCH = process.env.WEAVE_BRANCH || "main";

const CONSOLE_REPO = process.env.WEAVE_CONSOLE_REPO || "roshpinacare-sys/Console";
const PAGES_URL = process.env.WEAVE_CONSOLE_PAGES || "https://roshpinacare-sys.github.io/Console/";

const ATTEST_G5 = process.argv.includes("--attest-g5");

function gitOrNull(cmd: string): string | null {
  try {
    const out = execSync(cmd, { cwd: ROOT, encoding: "utf8", timeout: 30_000, stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
    return out || null;
  } catch {
    return null;
  }
}

interface ConsoleStatusPublic {
  format?: string;
  generatedAt?: string;
  freshness?: { verdict?: string; ageHours?: number };
  witness?: {
    txid?: string;
    checkpoint?: number;
    root?: string;
    at?: string;
    attestations?: number;
    headHash?: string;
    commit?: string;
  };
  recent?: Array<{ checkpoint: number; at: string; txid: string }>;
}

async function main(): Promise<void> {
  const runner = process.env.GITHUB_ACTIONS && !process.argv.includes("--local") ? "github-actions" : "local-primary";
  console.log(`[weave-console] runner=${runner} · repo=${CONSOLE_REPO} · pages=${PAGES_URL}`);

  // 1. מקומית - pull קודם (ה-remote הוא האמת)
  if (runner === "local-primary" && gitOrNull("git remote get-url origin")) {
    const pull = gitOrNull(`git pull --rebase origin ${BRANCH} --no-edit`) ?? "";
    if (pull.includes("CONFLICT")) {
      throw new Error("קונפליקט pull - הרץ ידנית: git pull --rebase ואז weave-console --attest-g5");
    }
    if (pull) console.log("[weave-console] pull:", pull.split("\n").slice(-2).join(" "));
  }

  // 2. ייבוא ledger.json אם הקובץ חדש מה-DB המקומי
  if (fs.existsSync(LEDGER_PATH)) {
    const snap = parseLedgerSnapshot(fs.readFileSync(LEDGER_PATH, "utf8"));
    const count = await db.attestation.count();
    if (snap.chainCount > count) {
      const res = await importLedger(snap);
      console.log(`[weave-console] יובאו ${res.imported.attestations} אימותים מ-ledger.json`);
    }
  }

  // 3. המדידה של הריצה הזאת - הספר חייב להיות תקין לפני כל טענה
  const verify = await verifyLedger();
  if (!verify.valid) {
    throw new Error(`הספר שבור (firstBreak=${verify.firstBreak ?? "?"}) - אין עדות על ספר שקרי`);
  }
  console.log(`[weave-console] ledger תקין: ${verify.checked} · ${verify.sigOk}/${verify.checked} חתימות`);

  // 4. מדידת החוץ מקצה לקצה: האם הקונסולה הציבורית מגישה את העוגן האחרון?
  const line = (() => {
    try {
      return JSON.parse(fs.readFileSync(LINE_PATH, "utf8")) as {
        anchors?: Array<{ checkpoint: number; txids: { steem: string | null }; at: string }>;
        last?: { checkpoint: number; root: string; txids: { steem: string | null }; at: string; attestations?: number };
      };
    } catch {
      return {} as { anchors?: undefined; last?: undefined };
    }
  })();
  const lastAnchor = line.last;
  // הקונסולה מתעדכנת ב-:40, העוגן ב-:20 - ההתאמה הכנה היא "מגישה עוגן
  // מהמחזור האחרון או הקודם", לא "את העוגן ששודר כרגע"
  const recentSteemTxids = (line.anchors ?? [])
    .slice(-2)
    .map((a) => a.txids.steem)
    .filter(Boolean) as string[];

  let pagesStatus = 0;
  const pub = await fetch(PAGES_URL, { method: "HEAD", signal: AbortSignal.timeout(15_000) }).catch(() => null);
  const pagesLive = !!(pub && pub.ok);
  pagesStatus = pub ? pub.status : 0;
  console.log(`[weave-console] Pages ${PAGES_URL} · ${pagesStatus} ${pagesLive ? "LIVE" : "DOWN"}`);

  let consoleServesLatest = false;
  let consoleWitness: ConsoleStatusPublic["witness"] | undefined;
  let consoleFreshness: string | undefined;
  if (pagesLive) {
    const st = await fetch(new URL("status.json", PAGES_URL).toString(), { cache: "no-store", signal: AbortSignal.timeout(15_000) }).catch(() => null);
    if (st && st.ok) {
      const s = (await st.json()) as ConsoleStatusPublic;
      consoleWitness = s.witness;
      consoleFreshness = s.freshness?.verdict;
      consoleServesLatest = !!(
        s.witness &&
        s.witness.txid &&
        (recentSteemTxids.includes(s.witness.txid) ||
          (lastAnchor && lastAnchor.txids.steem && s.witness.txid === lastAnchor.txids.steem))
      );
      console.log(
        `[weave-console] status.json הציבורי: cp#${s.witness?.checkpoint ?? "?"} · txid ${(s.witness?.txid ?? "").slice(0, 12)}… · ` +
          `freshness=${s.freshness?.verdict ?? "?"} (${s.freshness?.ageHours ?? "?"}h) · תואם לעוגן המקומי: ${consoleServesLatest ? "YES" : "NO"}`
      );
    } else {
      console.log(`[weave-console] status.json בחוץ: ${st ? st.status : "unreachable"}`);
    }
  }

  if (!ATTEST_G5) {
    console.log("[weave-console] מצב אימות בלבד (בלי --attest-g5 לא נכתב כלום) - הפעל עם --attest-g5 אחרי שהצינור נמדד חי");
    return;
  }

  // 5. סגירת G5 - עדות אחת לכל הדורות, ורק על צינור שנמדד חי מקצה לקצה.
  //    Pages שעדיין לא הופעל ע״י המפעיל (הרשאת Administration) - דילוג
  //    רך-כנה, ריצה ירוקה, השער ייסגר במחזור הראשון שאחרי ההפעלה.
  const existing = await db.attestation.findFirst({ where: { claimType: "CONSOLE" } });
  if (existing) {
    console.log(`[weave-console] G5 כבר נחתם (אימות seq=${existing.seq}) - כלום לא נכתב`);
    return;
  }
  if (!pagesLive) {
    console.log(
      `[weave-console] Pages עדיין לא חי (HTTP ${pagesStatus}) - נדרשת הפעלה חד-פעמית ` +
        `ע״י המפעיל בהגדרות הריפו הציבורי (חסרה הרשאת Administration לטוקן). ` +
        `דילוג כנה: אין טענה בלי מדידה; השער ייסגר אוטומטית במחזור הבא שאחרי ההפעלה.`
    );
    return;
  }
  if (!consoleServesLatest) {
    console.log(
      "[weave-console] status.json בחוץ עדיין לא מגיש עוגן משני המחזורים האחרונים - דילוג כנה, ניסיון חוזר במחזור הבא"
    );
    return;
  }

  const seal = sealOpen();
  const cloudAgent = await ensureCloudAgent(seal.cloudKeyHex);
  await ensureNetworkKeyFromSeal(seal.networkKeyHex);

  const attCount = await db.attestation.count();
  const claim =
    `קונסולה ציבורית (G5): ה-UI של הרשת עזב את הסנדבוקס. אתר סטטי חי בריפו הציבורי ${CONSOLE_REPO} ` +
    `ומוגש ב-GitHub Pages (${PAGES_URL}); workflow חסר-מפתחות בריפו הציבורי קורא את קו העוגנים מ-Steem ` +
    `(RPC ציבורי, custom_json בסמכות posting) ומפרסם status.json כל 6 שעות ב-GITHUB_TOKEN שלו בלבד; ` +
    `מקור האתר חי בריפו הריבוני (console/) - זר משחזר הכל מהבית; ה-PAT לא מגיע לענן ולא לקונסולה.`;
  const evidence = [
    `repo=${CONSOLE_REPO}`,
    `pages=${PAGES_URL}`,
    `pagesHttp=${pagesStatus}`,
    `consoleWitnessTxid=${consoleWitness?.txid}`,
    `consoleWitnessCp=${consoleWitness?.checkpoint}`,
    `consoleWitnessRoot=${consoleWitness?.root}`,
    `consoleFreshness=${consoleFreshness ?? "unknown"}`,
    `anchorLineTxid=${lastAnchor?.txids.steem}`,
    `anchorLineCp=${lastAnchor?.checkpoint}`,
    `ledger=${attCount} att · ${verify.sigOk}/${verify.checked} sig`,
    `renderPipeline=keyless steem-rpc -> render.mjs -> commit -> pages (GITHUB_TOKEN of Console only)`,
    `cadence=heart :00 -> anchor :20 -> console :40, every 6h`,
    `runner=${runner}`,
    `commit=${gitOrNull("git rev-parse --short HEAD") ?? "unknown"}`,
    process.env.GITHUB_SERVER_URL
      ? `run=${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
      : `note=attested from primary runner after end-to-end public verification (ledger->chain->console)`,
  ]
    .filter((s) => s && !s.endsWith("="))
    .join(" · ");

  const att = await appendAttestation({ agentId: cloudAgent.id, claim, claimType: "CONSOLE", evidence });
  console.log(`[weave-console] אימות CONSOLE נכתב: seq=${att.seq} · entry=${att.entryHash.slice(0, 18)}…`);

  const newCp = await createCheckpointNow();
  if (newCp) {
    console.log(`[weave-console] checkpoint #${newCp.index} נוצר · root=${newCp.root.slice(0, 16)}…`);
  }
  const snap = await exportLedger();
  fs.writeFileSync(LEDGER_PATH, JSON.stringify(snap, null, 2) + "\n");
  console.log(`[weave-console] ledger.json ייוצא: ${snap.chainCount} אימותים`);

  // 6. דחיפה לבית הריבוני - שער-סודות ואז commit+push (כמו הלב)
  if (!gitOrNull("git remote get-url origin")) {
    throw new Error("אין remote origin - בלי ריפו אין עדות");
  }
  if (process.env.GITHUB_ACTIONS) {
    execSync('git config user.name "weave-console[bot]" && git config user.email "weave-console[bot]@users.noreply.github.com"', {
      cwd: ROOT,
      stdio: "ignore",
    });
  }
  execSync("git add -A", { cwd: ROOT, stdio: "ignore" });
  const staged = gitOrNull("git diff --cached") ?? "";
  const leak = (() => {
    const PATTERNS: Array<[string, RegExp]> = [
      ["steem/hive WIF", /\b5[1-9A-HJ-NP-Za-km-z]{50}\b/],
      ["github token", /\bgh[pousr]_[A-Za-z0-9]{20,}\b/],
      ["github_pat token", /\bgithub_pat_[A-Za-z0-9_]{20,}\b/],
      ["PEM private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
      ["x-access-token url", new RegExp("x-access-token:[A-Za-z0-9_\\-]+@")],
    ];
    const KNOWN = /"(entryHash|root|prevRoot|prevHash|headHash|digest|recomputedHead|evidenceHash|leaf|sha256|id)"\s*:/i;
    const filtered = staged
      .split("\n")
      .filter((l) => !/0x[0-9a-fA-F]{64}/.test(l) || KNOWN.test(l))
      .join("\n");
    for (const [name, re] of PATTERNS) if (re.test(filtered)) return name;
    return null;
  })();
  if (leak) {
    execSync("git reset", { cwd: ROOT, stdio: "ignore" });
    throw new Error(`שער הסודות חסם את הדחיפה: ${leak} - כלום לא נדחף`);
  }
  const msg = `weave-console: G5 sealed · att ${att.seq} · pages LIVE · witness cp#${consoleWitness?.checkpoint} matches anchor line`;
  execSync(`git commit -m ${JSON.stringify(msg)}`, { cwd: ROOT, stdio: "ignore" });
  const pushOut = gitOrNull(`git push origin ${BRANCH}`) ?? "push ok";
  console.log(`[weave-console] gitkeeper: ${pushOut.split("\n").slice(-1)[0] || "pushed"}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("CONSOLE-ERROR:", e instanceof Error ? e.message : e);
    process.exit(1);
  });
