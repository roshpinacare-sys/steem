#!/usr/bin/env bun
// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · weave-anchor — קו ה-Steem/Hive מהספר (G2)
//
// הרשת הריבונית מעידה על עצמה מחוץ לגיטהאב: root של ה-checkpoint
// האחרון עולה כ-custom_json (id=saos.weave.core.v1, סמכות posting —
// "אפס סיכון הון" לפי מסמך המפתחות של הצי) על שתי שרשראות ציבוריות:
//   · Steem — steem-js native, העבר מדויק של הצי (Task 79/82)
//   · Hive  — חתימה מקומית עם chain_id + שער RC (דילוג-כנה, לא כשל)
//
// ההוכחה חוזרת לספר: אימות ANCHOR חתום (EIP-191, מפתח הענן מה-seal)
// שנושא את שני ה-txids — כל אדם יכול לאמת מחדש מול ה-RPC הציבורי.
//
// רץ בשני עולמות, אותה מכניקה:
//   · הענן (weave-anchor.yml, יומי) — מ-Actions Secrets: WEAVE_STEEM_WIF
//   · ה-runner הראשי (הסנדבוקס) — מ-.env.local: WEAVE_STEEM_WIF
//
// משמרת המפתח: ה-WIF לעולם לא בגיט, לא בלוגים; המקור — כספת הצי.
//
// דגלים: --dry (בלי שידור וכתיבה) · --no-push · --verify-only (קריאה בלבד)
// ─────────────────────────────────────────────────────────────────────

import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import steem from "steem";
import { db } from "@/lib/db";
import { exportLedger, importLedger, parseLedgerSnapshot } from "@/lib/weave/ledger-sync";
import { verifyLedger, ensureCloudAgent, ensureNetworkKeyFromSeal, createCheckpointNow } from "@/lib/weave/beat";
import { resolveOpenMarkets, type SettlementResult } from "@/lib/weave/market";
import { appendAttestation } from "@/lib/weave/ledger";
import { sealOpen } from "./weave-seal";
import {
  STEEM_RPC_NODES,
  HIVE_RPC,
  rpcV4,
  buildPostingCustomJson,
  steemBroadcast,
  hiveBroadcast,
  hiveRcGate,
  steemRcGate,
  findInHistory,
  sleep,
} from "@/lib/weave/graphene";
import { BLURT_RPC, blurtSignTx } from "@/lib/dex/blurt-wire";
// GrapheneOperation מיובא מהחבילה עצמה — graphene.ts מגדיר אותו מקומית ולא מייצא
import type { GrapheneOperation } from "steem";

const ROOT = path.resolve(__dirname, "..");
const LEDGER_PATH = path.join(ROOT, "sovereign", "ledger.json");
const LINE_PATH = path.join(ROOT, "sovereign", "steem-line.json");
const REPORT_PATH = path.join(ROOT, "sovereign", "anchor-report.json");
const BRANCH = process.env.WEAVE_BRANCH || "main";

const IS_ACTIONS = !!process.env.GITHUB_ACTIONS;
const DRY = process.argv.includes("--dry");
const NO_PUSH = process.argv.includes("--no-push");
const VERIFY_ONLY = process.argv.includes("--verify-only");

// העד החי: חשבון-צי עם מפתח posting חי בשתי השרשראות (נמדד 2026-09-14:
// LIVE-MATCH ב-Steem וב-Hive כאחד, RC בריא). ניתן להחלפה דרך הסביבה.
const ACCOUNT = (process.env.WEAVE_STEEM_ACCOUNT || "cashmachine").toLowerCase();
const OP_ID = "saos.weave.core.v1";
const ANCHORS_RING = 32; // טבעת-64 קטנה — הספר הוא האמת, הקובץ רק מראה

const WIF = (process.env.WEAVE_STEEM_WIF || "").trim();
// r180 — הכוננת-הכפולה: לכל-שרשרת-המפתח-שלה. ההוכחה-מ-r179: ה-posting-של-headcorner-
// שונה-בין-Steem-ל-Hive (STM6u99…-מקומי) — שימוש-ב-WIF-של-Steem-על-Hive-קורס-ב-
// "Missing Posting Authority". WEAVE_HIVE_WIF-כשקיים — חובה; בהיעדרו-נסוגים-ל-WIF-
// (התנהגות-היסטורית-לחשבונות-שמפתחותיהם-משותפים) והכשל-נשאר-דילוג-כנה.
// r181 — שרשרת-השמות-המלאה: WEAVE_HIVE_WIF || HIVE_POSTING_WIF (השם-בכספת
// מאז 2026-09-23 — נמדד ב-API) || WIF-ה-Steem. הבעלות-על-המפתח הוכחה
// מקומית: sovereign/vault/hive-key-proof.json (verdict PROVED, שופט=רשות-חיה).
const HIVE_WIF = ((process.env.WEAVE_HIVE_WIF || "") || (process.env.HIVE_POSTING_WIF || "") || WIF).trim();
// r183 — המסילה השלישית: BLURT. הבעלות הוכחה חי (r183): ה-WIF מכספת-הסוכנים
// גוזר את ה-body הזהה לרשות-ה-active החיה של headcorner (BLT5HhJD5WUXu8… —
// prefix קוסמטי בגרפינה). שידור-בסמכות-active — custom_json עם required_active_auths.
const BLURT_WIF = ((process.env.BLURT_WIF || "") || (process.env.BLURT_ACTIVE_WIF || "") || "").trim();

// R75 — המפתח מכריז את חותם הקו: ה-WIF מזוהה מול רשויות ה-posting החיות
// של חשבונות הצי (קריאה חסרת-מפתחות). השם ב-env (WEAVE_STEEM_ACCOUNT) נשאר
// ברירת-מחדל בלבד — אם המפתח מזוהה כחשבון אחר, הקו חותם כפי שהמפתח
// מכריז. השרשרת היא השופטת (אותה מטריצה כמו key-verify והעוגן הריבוני).
const FLEET_ACCOUNTS = ["cashmachine", "headcorner", "lsa"];

function wifToStmPub(wif: string): string | null {
  try {
    return steem.auth.wifToPublic(wif).toString();
  } catch {
    return null;
  }
}

/** זיהוי חותם הקו מתוך ה-WIF עצמו — null = השרשרת נקראה והמפתח זר. */
async function identifyWitnessAccount(wif: string): Promise<string | null> {
  const pub = wifToStmPub(wif);
  if (!pub) {
    throw new Error("WEAVE_STEEM_WIF אינו WIF תקין — סירוב כנה, שום דבר לא שודר");
  }
  for (const node of STEEM_RPC_NODES) {
    const accs = await rpcV4<{ name: string; posting?: { key_auths?: [string, number][] } }[]>(
      node,
      "condenser_api.get_accounts",
      [FLEET_ACCOUNTS]
    ).catch(() => null);
    if (!accs) continue; // הצומת הבא
    const signer = accs.find((a) =>
      ((a.posting && a.posting.key_auths) || []).some((k) => k[0] === pub)
    );
    return signer ? String(signer.name).toLowerCase() : null;
  }
  throw new Error("קריאת חשבונות הצי נכשלה בכל הצמתים — אין זיהוי בלי השרשרת");
}

interface AnchorRecord {
  checkpoint: number;
  root: string;
  attFrom: number;
  attTo: number;
  attestations: number;
  at: string;
  commit: string;
  account: string;
  txids: { steem: string | null; hive: string | null; blurt?: string | null };
  hiveNote?: string | null;
  attSeq?: number;
  runner?: string;
}

interface SteemLine {
  line: string;
  account: string;
  opId: string;
  createdAt: string;
  anchors: AnchorRecord[];
  last?: AnchorRecord;
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

function readLine(): SteemLine {
  try {
    return JSON.parse(fs.readFileSync(LINE_PATH, "utf8")) as SteemLine;
  } catch {
    return { line: "steem+hive", account: ACCOUNT, opId: OP_ID, createdAt: new Date().toISOString(), anchors: [] };
  }
}

function writeLine(line: SteemLine): void {
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
  const runner: "github-actions" | "local-primary" =
    IS_ACTIONS ? "github-actions" : "local-primary";
  const gitHead = gitOrNull("git rev-parse --short HEAD") ?? "unknown";
  const repoSlug = process.env.GITHUB_REPOSITORY ?? "roshpinacare-sys/Zip";
  const runUrl = process.env.GITHUB_SERVER_URL
    ? `${process.env.GITHUB_SERVER_URL}/${repoSlug}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : undefined;

  // 0. זיהוי חותם הקו מהמפתח (R75): כל posting-WIF של הצי כשיר. בלי WIF —
  //    dry-כנה כמקודם. הזיהוי נמדד מול השרשרת החיה, לא מול שם-ה-env.
  let account = ACCOUNT;
  if (WIF) {
    const identified = await identifyWitnessAccount(WIF);
    if (!identified) {
      throw new Error(
        `ה-WIF לא זוהה כרשות posting חיה של אף חשבון צי (${FLEET_ACCOUNTS.join(", ")}) — סירוב כנה, שום דבר לא שודר`
      );
    }
    account = identified;
  }

  console.log(`[weave-anchor] runner=${runner} head=${gitHead} account=@${account} opId=${OP_ID}`);

  // 1. בענן — checkout טרי; מקומית — pull קודם (ה-remote הוא האמת)
  if (runner === "local-primary" && gitOrNull("git remote get-url origin")) {
    const pull = gitOrNull(`git pull --rebase origin ${BRANCH} --no-edit`) ?? "";
    if (pull.includes("CONFLICT")) {
      throw new Error("קונפליקט pull — הרץ ידנית: git pull --rebase ואז weave-anchor");
    }
    if (pull) console.log("[weave-anchor] pull:", pull.split("\n").slice(-2).join(" "));
  }

  // 2. ייבוא ledger.json אם הקובץ חדש מה-DB המקומי
  if (fs.existsSync(LEDGER_PATH)) {
    const snap = parseLedgerSnapshot(fs.readFileSync(LEDGER_PATH, "utf8"));
    const local = await localLedgerState();
    if (snap.chainCount > local.count) {
      const res = await importLedger(snap);
      console.log(`[weave-anchor] יובאו ${res.imported.attestations} אימותים מ-ledger.json`);
    }
  }

  // 3. פתיחת seal — זהות הענן חותמת את אימות ה-ANCHOR
  const seal = sealOpen();
  const cloudAgent = await ensureCloudAgent(seal.cloudKeyHex);
  console.log(`[weave-anchor] seal פתוח · cloud=${seal.cloudAddress} (חותם העדות)`);
  // השלמת מפתח הרשת מה-seal — אותו לקח של run #3 של הלב: ייבוא הספר משאיר
  // את השורה ללא devKey, וה-checkpoint שהעוגן יוצר ייכשל בלי זה
  await ensureNetworkKeyFromSeal(seal.networkKeyHex);
  console.log(`[weave-anchor] מפתח רשת הושלם מה-seal · ${seal.networkAddress}`);

  // 4. הספר חייב להיות תקין לפני כל עדות
  const verify = await verifyLedger();
  if (!verify.valid) {
    throw new Error(`הספר שבור (firstBreak=${verify.firstBreak ?? "?"}) — אין עדות על ספר שקרי`);
  }
  console.log(`[weave-anchor] ledger תקין: ${verify.checked} אימותים · ${verify.sigOk}/${verify.checked} חתימות`);

  // 5. ה-checkpoint האחרון — מה שעולה לשרשרת
  const cp = await db.checkpoint.findFirst({ orderBy: { index: "desc" } });
  if (!cp) {
    throw new Error("אין checkpoint בספר — הרץ פעימה קודם (weave-beat)");
  }

  const line = readLine();
  const alreadyAnchored = line.last && line.last.root === cp.root;

  // 6. dedupe: root זה כבר עוגן ⇒ אימות-קריאה בלבד (ההיסטוריה השופטת)
  if (alreadyAnchored || VERIFY_ONLY) {
    const last = line.last;
    let stillOnChain: string | null = null;
    if (last && last.txids.steem) {
      stillOnChain = await findInHistory(STEEM_RPC_NODES[0], account, OP_ID, last.at, 2, 100).catch(() => null);
    }
    const report = {
      at: new Date().toISOString(),
      runner,
      mode: "ALREADY-ANCHORED (verify-only)",
      checkpoint: { index: cp.index, root: cp.root },
      lastAnchor: last ?? null,
      historyReadback: stillOnChain
        ? { verdict: "ON-CHAIN", txid: stillOnChain }
        : { verdict: last ? "READBACK-EMPTY (history window or node blind)" : "no-anchor-yet" },
      context: { runner, gitHead, repoSlug, runUrl },
    };
    fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + "\n");
    console.log(
      `[weave-anchor] root ${cp.root.slice(0, 14)}… כבר עוגן (cp#${last?.checkpoint ?? "?"}) · ` +
        `readback=${report.historyReadback.verdict} — אין שידור חדש`
    );
    return;
  }

  // 7. בניית המטען — קנוני, מתועד, ניתן לאימות עצמאי
  const at = new Date().toISOString();
  const attestations = await db.attestation.count();
  const headRow = await db.attestation.findFirst({ orderBy: { seq: "desc" } });
  const payload = {
    protocol: "saos-weave-core/v1",
    action: "checkpoint",
    at,
    net: "weave-core",
    repo: repoSlug,
    checkpoint: cp.index,
    root: cp.root,
    attFrom: cp.attFrom,
    attTo: cp.attTo,
    attestations,
    headHash: headRow?.entryHash ?? "0x" + "0".repeat(64),
    commit: gitHead,
  };
  const op: GrapheneOperation = buildPostingCustomJson(account, OP_ID, payload);

  console.log(
    `[weave-anchor] מעגן cp#${cp.index} · root=${cp.root.slice(0, 18)}… · att ${cp.attFrom}..${cp.attTo} · ${DRY ? "DRY" : WIF ? "שידור" : "אין WIF — DRY כנה"}`
  );

  if (DRY || !WIF) {
    const report = {
      at,
      runner,
      mode: DRY ? "DRY" : "NO-WIF (honest dry — key not in env)",
      payload,
      note: "לא שודר דבר; לא נכתבה עדות. הוכחה או לא קרה.",
      context: { runner, gitHead, repoSlug, runUrl },
    };
    fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + "\n");
    console.log("[weave-anchor] DRY — הודגם בלבד, לא שודר ולא נדחף");
    return;
  }

  // 8. שידור — Steem ראשי (חינם), Hive מאחורי שער RC (דילוג-כנה)
  //    (הלקח מהמדידה הראשונה: operations הוא מערך-פעולות — [op] ולא op)
  const txids: { steem: string | null; hive: string | null; blurt: string | null } = { steem: null, hive: null, blurt: null };
  const notes: string[] = [];

  // שעת RC ל-Steem (Task 25, נולד ממדידת 14:08Z): דילוג-כנה כשהמנה מתחת לרצפה — המחירות האמיתית של חשבון-חינם במחזור שעתי
  let steemSkipped: string | null = null;
  const sGate = await steemRcGate(account).catch(() => null);
  if (sGate && !sGate.ok) {
    steemSkipped = sGate.reason ?? "rc-gated";
    notes.push(`steem: ${steemSkipped}`);
    console.log(`[weave-anchor] steem: דילוג-כנה — ${steemSkipped}`);
  } else {
    const st = await steemBroadcast([op], WIF);
    txids.steem = st.txid;
    if (st.note) notes.push(`steem: ${st.note}`);
    console.log(`[weave-anchor] steem: ${st.txid ? `שודר ✓ ${st.txid.slice(0, 12)}…` : `לא אושר — ${st.note ?? ""}`}`);
  }

  let hiveSkipped: string | null = null;
  const gate = await hiveRcGate(account).catch(() => null);
  if (gate && !gate.ok) {
    hiveSkipped = gate.reason ?? "rc-gated";
    notes.push(`hive: ${hiveSkipped}`);
    console.log(`[weave-anchor] hive: דילוג-כנה — ${hiveSkipped}`);
  } else if (HIVE_WIF && HIVE_WIF !== WIF && !wifToStmPub(HIVE_WIF)) {
    hiveSkipped = "hive-wif-שגוי-מבנית";
    notes.push(`hive: ${hiveSkipped}`);
    console.log(`[weave-anchor] hive: סירוב-כנה — WEAVE_HIVE_WIF אינו WIF תקין`);
  } else {
    const hv = await hiveBroadcast([op], HIVE_WIF);
    if (hv.note) notes.push(`hive: ${hv.note}`);
    console.log(
      `[weave-anchor] hive: ${
        hv.accepted
          ? `השידור התקבל — ממתין לאישור היסטוריה`
          : `נכשל — ${hv.note ?? "?"}`
      }`
    );
  }

  // r183 — המסילה השלישית: BLURT (אותו חוק כנות, בסמכות-active —
  // custom_json עם required_active_auths; ה-WIF נמדד חי מול הרשות החיה).
  let blurtSkipped: string | null = null;
  if (!BLURT_WIF) {
    blurtSkipped = "no-blurt-wif (honest skip — key not in env)";
    notes.push(`blurt: ${blurtSkipped}`);
    console.log(`[weave-anchor] blurt: דילוג-כנה — אין WIF בסביבה`);
  } else if (!wifToStmPub(BLURT_WIF)) {
    blurtSkipped = "blurt-wif-שגוי-מבנית";
    notes.push(`blurt: ${blurtSkipped}`);
    console.log(`[weave-anchor] blurt: סירוב-כנה — BLURT_ACTIVE_WIF אינו WIF תקין`);
  } else {
    try {
      // r183 — Blurt בסמכות-active: אותו פורמט-op של buildPostingCustomJson,
      // עם required_auths=[account] וrequired_posting_auths=[] — ה-active חותם.
      const blurtOp = buildPostingCustomJson(account, OP_ID, payload) as unknown as [
        string,
        { required_auths: string[]; required_posting_auths: string[]; id: string; json: string },
      ];
      blurtOp[1].required_auths = [account];
      blurtOp[1].required_posting_auths = [];
      // r184 — חתימה בסכמה הרשמית (blurtjs): המעבדה הוכיחה ש-steem-js סודר
      // custom_json כ-op-id 18 בעוד Blurt מצפה ל-12 — הסיבה ל-"Missing Active
      // Authority". blurtSignTx סודר וחותם בבייטים שהשרשרת מפרשת.
      const signed = await blurtSignTx([blurtOp], BLURT_WIF);
      // r184 — שידור-סינכרוני: הצומת מחזיר trx_id+block (ההיסטוריה ב-rpc.blurt.blog
      // מתעדכנת באיחור — הבלוק עצמו הוא השופטת; הוכחה: blurt-rail-proof.json)
      const sync = await rpcV4<{ id: string; block_num: number; expired: boolean }>(
        BLURT_RPC,
        "condenser_api.broadcast_transaction_synchronous",
        [signed]
      );
      txids.blurt = sync?.id ?? null;
      if (txids.blurt) {
        notes.push(`blurt: txid ${txids.blurt} (block ${sync.block_num})`);
        console.log(`[weave-anchor] blurt: שודר ✓ ${txids.blurt.slice(0, 12)}… (block ${sync.block_num})`);
      } else {
        notes.push("blurt: broadcast-accepted (no id returned)");
        console.log(`[weave-anchor] blurt: השידור התקבל — ממתין לאישור היסטוריה`);
      }
    } catch (e) {
      notes.push(`blurt: ${String((e as Error).message ?? e).slice(0, 140)}`);
      console.log(`[weave-anchor] blurt: נכשל — ${String((e as Error).message ?? e).slice(0, 120)}`);
    }
  }

  // 9. אישור מההיסטוריה — השופטת היחידה (שני הכיוונים)
  for (let i = 0; i < 5 && !txids.steem && !steemSkipped; i++) {
    await sleep(3000);
    for (const node of STEEM_RPC_NODES) {
      txids.steem = await findInHistory(node, account, OP_ID, at, 1, 100).catch(() => null);
      if (txids.steem) break;
    }
  }
  if (!hiveSkipped) {
    for (let i = 0; i < 5 && !txids.hive; i++) {
      await sleep(3000);
      txids.hive = await findInHistory(HIVE_RPC, account, OP_ID, at, 2, 100).catch(() => null);
    }
  }
  // r183 — אישור-היסטוריה גם ל-Blurt (אותה שופטת: condenser API)
  if (txids.blurt === null && BLURT_WIF && wifToStmPub(BLURT_WIF)) {
    for (let i = 0; i < 5 && !txids.blurt; i++) {
      await sleep(3000);
      txids.blurt = await findInHistory(BLURT_RPC, account, OP_ID, at, 2, 100).catch(() => null);
    }
  }

  const landed = [txids.steem, txids.hive, txids.blurt].filter(Boolean).length;
  console.log(
    `[weave-anchor] עיגון הושלם: ${landed}/3 שרשראות` +
      (txids.steem ? ` · steem ${txids.steem.slice(0, 12)}…` : "") +
      (txids.hive ? ` · hive ${txids.hive.slice(0, 12)}…` : "") +
      (txids.blurt ? ` · blurt ${txids.blurt.slice(0, 12)}…` : "")
  );

  if (landed === 0) {
    // שני הקווים הוגדו ב-RC (דילוג או שידור שחזר ב-RC) — זו מדידת
    // תקציב, לא כשל מערכת: הריצה ירוקה עם דילוג-כנה, הדוח נדחף,
    // וקו ה-ZERO ממשיך לעגן שעתית ב-$0. כשה-RC יתאושש
    // (מדוד: Steem ~9ש' · Hive ~14ש') — השער יעבור והעיגון יחדש.
    const rcOnly = [steemSkipped, hiveSkipped].filter(Boolean).length === 2
      || (notes.length > 0 && notes.every((n) => /rc|mana|resource/i.test(n)));
    const mode = rcOnly
      ? "RC-SKIPPED (both chains regenerating \u2014 honest skip; ZERO line anchors in $0)"
      : "BROADCAST-FAILED (no chain landed \u2014 honest red, nothing attested)";
    const report = {
      at,
      runner,
      mode,
      payload,
      notes,
      rcGates: { steem: steemSkipped, hive: hiveSkipped },
      context: { runner, gitHead, repoSlug, runUrl },
    };
    fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + "\n");
    if (rcOnly) {
      console.log(`[weave-anchor] שני הקווים ברגנרציית RC — דילוג-כנה, הריצה ירוקה; קו ה-ZERO מעגן`);
      // דחיקת הדוח בלבד — הספר לא שושנה (אין עדות לרשום)
      if (!NO_PUSH && gitOrNull("git remote get-url origin")) {
        if (IS_ACTIONS) {
          sh('git config user.name "weave-anchor[bot]" && git config user.email "weave-anchor[bot]@users.noreply.github.com"');
        }
        execSync(`git add -A`, { cwd: ROOT, stdio: "ignore" });
        const stagedRc = gitOrNull("git diff --cached") ?? "";
        const leakRc = secretGate(filterKnownHashes(stagedRc));
        if (leakRc) {
          execSync("git reset", { cwd: ROOT, stdio: "ignore" });
          throw new Error(`שער הסודות חסם את הדחיקה: ${leakRc} ב-diff — כלום לא נדחף`);
        }
        execSync(`git commit -m ${JSON.stringify(`weave-anchor: ${at} · RC-SKIPPED · שני הקווים ברגנרציית — דילוג-כנה`)}`, { cwd: ROOT, stdio: "ignore" });
        const pushRc = gitPushRetry(ROOT, BRANCH);
        console.log(`[weave-anchor] דוח הדילוג נדחף: ${pushRc.split("\n").slice(-1)[0] || "pushed"}`);
      }
      return; // ירוק כנה — כלום לא נוסף, המחזור הבא ינסה שוב
    }
    throw new Error(`העיגון נכשל בשתי השרשראות — ${notes.join(" | ")}`);
  }

  // 10. העדות חוזרת לספר — txids בראיה, חתום במפתח הענן
  const explorerSteem = txids.steem ? `https://steemscan.com/transaction/${txids.steem}` : null;
  const explorerHive = txids.hive ? `https://hiveblockexplorer.com/tx/${txids.hive}` : null;
  const claim =
    `קו Steem/Hive: checkpoint #${cp.index} root ${cp.root.slice(0, 18)}… עוגן on-chain ` +
    `כ-custom_json ${OP_ID} מאת @${account} (סמכות posting${account !== ACCOUNT ? `, מזוהה מהמפתח — ברירת המחדל @${ACCOUNT}` : ""}) — עד חיצוני ציבורי ובלתי-תלוי בגיטהאב לאמת הספר.`;
  const evidence = [
    `steemTxid=${txids.steem ?? "null"}`,
    `hiveTxid=${txids.hive ?? "null"}`,
    `account=${account}`,
    `opId=${OP_ID}`,
    `authority=posting`,
    `checkpoint=${cp.index} root=${cp.root} attFrom=${cp.attFrom} attTo=${cp.attTo}`,
    `attestations=${attestations}`,
    `headHash=${headRow?.entryHash}`,
    `commit=${gitHead}`,
    explorerSteem ? `explorerSteem=${explorerSteem}` : null,
    explorerHive ? `explorerHive=${explorerHive}` : null,
    `payloadAt=${at}`,
    `runner=${runner}`,
    runUrl ? `run=${runUrl}` : null,
    hiveSkipped ? `hiveSkip=${hiveSkipped}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const att = await appendAttestation({
    agentId: cloudAgent.id,
    claim,
    claimType: "ANCHOR",
    evidence,
  });
  console.log(`[weave-anchor] אימות ANCHOR נכתב: seq=${att.seq} · entry=${att.entryHash.slice(0, 18)}…`);

  // סולם-ההוכחות: checkpoint חדש שמכסה את אימות ה-ANCHOR — כך העוגן הבא
  // (בענן, מחר) מעיד על checkpoint שכולל את ראיית העיגון של היום.
  const newCp = await createCheckpointNow();
  if (newCp) {
    console.log(`[weave-anchor] checkpoint #${newCp.index} נוצר (מכסה att ${newCp.attFrom}..${newCp.attTo}) · root=${newCp.root.slice(0, 16)}…`);
  }

  // 10.5 שוק האמת — המכריע רוכב על קו העיגון (Task 19, תיקון באג חבוי):
  //      העוגנים חיים תמיד — כל ריצה יוצרת checkpoint חדש שהריצה הבאה
  //      מעגנת — ולכן הספר "טרי" לנצח מעצם קיומם. אבל הלב הענן מפיק
  //      פעימה מלאה רק ב-TAKEOVER — שלעולם לא מגיע כשהעוגנים מזינים
  //      את איתות הטריות. התוצאה שנתפסה בקריאה: resolveOpenMarkets
  //      לעולם לא רץ בענן — שווקים פתוחים נתלים לנצח. התיקון: קו
  //      העיגון עצמו נושא את המכריע — 4 פעמים ביום, על ספר שזה עתה
  //      אומת (fail-closed: ספר שבור לא מסלק, כמו בפעימה §5.5).
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
        `[weave-anchor] שוק האמת נסלק: ${marketSettlement.settled.length} הוכרעו · ${marketSettlement.refunded.length} הוחזרו · אימותים att${marketSettlement.attSeqs.join(",att")}${marketCheckpoint ? ` · cp#${marketCheckpoint.index}` : ""}`
      );
    }
  }

  // 11. רישום הקו + ייצוא הספר
  const record: AnchorRecord = {
    checkpoint: cp.index,
    root: cp.root,
    attFrom: cp.attFrom,
    attTo: cp.attTo,
    attestations,
    at,
    commit: gitHead,
    account,
    txids,
    hiveNote: hiveSkipped,
    attSeq: att.seq,
    runner,
  };
  line.anchors.push(record);
  writeLine(line);

  const snap = await exportLedger();
  fs.mkdirSync(path.dirname(LEDGER_PATH), { recursive: true });
  fs.writeFileSync(LEDGER_PATH, JSON.stringify(snap, null, 2) + "\n");
  console.log(`[weave-anchor] ledger.json ייוצא: ${snap.chainCount} אימותים · head=${snap.headHash.slice(0, 18)}…`);

  const report = {
    at,
    runner,
    mode: "ANCHORED",
    checkpoint: { index: cp.index, root: cp.root, attFrom: cp.attFrom, attTo: cp.attTo },
    txids,
    hiveSkipped,
    notes,
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
    context: { runner, gitHead, repoSlug, runUrl },
  };
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + "\n");

  if (NO_PUSH) {
    console.log("[weave-anchor] --no-push — הודגם, לא נדחף");
    return;
  }

  // 12. שער-סודות ודחיפה — כמו הלב; זהות העוגן בענן בלבד
  if (!gitOrNull("git remote get-url origin")) {
    throw new Error("אין remote origin — בלי ריפו אין עדות");
  }
  if (IS_ACTIONS) {
    sh('git config user.name "weave-anchor[bot]" && git config user.email "weave-anchor[bot]@users.noreply.github.com"');
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
  const msg = `weave-anchor: ${at} · cp#${cp.index} · ${landed}/3 chains · att ${att.seq}${marketNote}`;
  execSync(`git commit -m ${JSON.stringify(msg)}`, { cwd: ROOT, stdio: "ignore" });
  const pushOut = gitPushRetry(ROOT, BRANCH);
  console.log(`[weave-anchor] gitkeeper: ${nFiles} files · ${pushOut.split("\n").slice(-1)[0] || "pushed"}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("ANCHOR-ERROR:", e instanceof Error ? e.message : e);
    process.exit(1);
  });
