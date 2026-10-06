// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · Sovereignty — סטטוס הריבונות של הרשת (הריפו הוא האמת)
//
// GET /api/weave/sovereignty — מה חי ואיפה:
//   · הלב הענן חמוש? (ה-workflow בריפו)
//   · הפעימה האחרונה (מקומית/ענן) + פסק-דין
//   · הספר בריפו מול ה-DB המקומי (קדימה/פיגור)
//   · ה-seal (קיום + כתובות בלבד — אף סוד)
//   · גזירת העוגנים (anchor-baseline) — אם נרשמה
//   · מפת הפערים (G1..G6) ושערי SOV
// תווית אמת: מצב הריפו נקרא מהקובץ המקומי = LOCAL; הפעימות שבספר = REAL.
//
// ארכיטקטורת R53/R54 (נמדד לפני השינוי: 5.6s ראשון · 1.3-1.4s בכל קריאה —
// שלושה probes חיצוניים רצו טורית והכל חושב מחדש בכל קריאה): מסלול-תצוגה
// SWR (TTL 60s) + מקבול מלא — כל 10 שאילתות-ה-DB, probe-הקונסולה, probe-ה-ZERO
// וגזירת-הארכיון רצים ב-Promise.all אחד. האמת נשארת כנה: cached/stale/
// cacheAgeSec בגוף + X-SAOS-Cache למדידת curl גולמית. מסלולי-האמת
// (health, web/verify) נותרים fresh וחוסמים — התצוגה לעולם לא מתחזה.
// ─────────────────────────────────────────────────────────────────────

import * as fs from "fs";
import * as path from "path";
import { NextResponse } from "next/server";
import { execSync } from "child_process";
import { db } from "@/lib/db";
import { jsonError } from "@/lib/weave/api";
import { swrGet, cacheHeader } from "@/lib/live/swr";
import { zeroReadiness, verifyZeroAnchorOnChain, zeroExplorerLink, ZERO_RAIL_ID } from "@/lib/weave/zero";
import { deriveArchiveSnapshot, lastArchiveWitness, ARCHIVE_HASH_PLAN, ARCHIVE_REPO } from "@/lib/weave/archive";
import { workflowScheduleDesc } from "@/lib/live/workflow-schedule";

export const dynamic = "force-dynamic";

const ROOT = path.resolve(process.cwd());
const WORKFLOW_PATH = path.join(ROOT, ".github", "workflows", "weave-heart.yml");
const ANCHOR_WORKFLOW_PATH = path.join(ROOT, ".github", "workflows", "weave-anchor.yml");

// r121 — תיאור-קדנס כנה מה-workflow עצמו, לא מהזיכרון:
//  קורא את בלוק ה-on (cron + workflow_dispatch) מהקובץ ומתאר אותו
//  כפי שהוא. שלוש שורות-הסטטוס שיקרו עד כאן ("כל 6 שעות", "יומי 07:17Z",
//  "כל 6 שעות :30") בזמן ש-R71/Task-24 הסירו את ה-cron — המציאות
//  חיה בבית-התאום Domain והקבצים המקומיים dispatch-only.
//  (r122: המנתח עבר ל-lib משותף — workflow-schedule.ts — לשירות גם
//  את דלת-חימום הגריד; החוזה לא השתנה.)
const LEDGER_PATH = path.join(ROOT, "sovereign", "ledger.json");
const REPORT_PATH = path.join(ROOT, "sovereign", "beat-report.json");
const SEAL_META_PATH = path.join(ROOT, "sovereign", "weave-seal.meta.json");
const LEAVES_PATH = path.join(ROOT, "sovereign", "anchor-baseline.leaves.json");
const TOOLKIT_LEAVES_PATH = path.join(ROOT, "sovereign", "toolkit-baseline.leaves.json");
const STEEM_LINE_PATH = path.join(ROOT, "sovereign", "steem-line.json");
const ZERO_LINE_PATH = path.join(ROOT, "sovereign", "zero-line.json");
const ANCHOR_REPORT_PATH = path.join(ROOT, "sovereign", "anchor-report.json");
const SOVEREIGNTY_PATH = path.join(ROOT, "SOVEREIGNTY.md");
const CONSOLE_SITE_PATH = path.join(ROOT, "console", "index.html");
const CONSOLE_REPO_URL = "https://github.com/roshpinacare-sys/Console";
const CONSOLE_PAGES_URL = "https://roshpinacare-sys.github.io/Console/";
const CONSOLE_RAW_STATUS_URL = "https://raw.githubusercontent.com/roshpinacare-sys/Console/main/status.json";

const SWR_KEY = "api:sovereignty";
const SWR_TTL_MS = 60_000;

interface BeatReportShape {
  at?: string;
  runner?: string;
  mode?: string;
  verdict?: string;
  verify?: { checked?: number; sigOk?: number; sigFail?: number; valid?: boolean };
  beat?: { seq?: number; checkpoint?: { index?: number; root?: string } | null } | null;
  gatesClosed?: Array<{ code: string; attSeq: number }>;
}

interface LedgerShape {
  chainCount?: number;
  headHash?: string;
  exportedAt?: string;
}

function readJson(file: string): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function gitOrNull(cmd: string): string | null {
  try {
    const out = execSync(cmd, {
      cwd: ROOT,
      encoding: "utf8",
      timeout: 10_000,
      stdio: ["ignore", "pipe", "pipe"],
    }).toString().trim();
    return out || null;
  } catch {
    return null;
  }
}

export async function GET() {
  try {
    const { value, meta } = await swrGet(SWR_KEY, SWR_TTL_MS, composeSovereignty);
    return NextResponse.json(
      {
        ...value,
        cached: meta.cached,
        stale: meta.stale,
        cacheAgeSec: meta.cacheAgeSec,
        refreshing: meta.refreshing,
      },
      { headers: { "X-SAOS-Cache": cacheHeader(meta) } },
    );
  } catch (error) {
    return jsonError(error);
  }
}

async function composeSovereignty() {
  // ── 1. רכיבי הריבונות בקובץ (העתק מקומי של הריפו — LOCAL, מיידי) ──
  const cloudArmed = fs.existsSync(WORKFLOW_PATH);
  const anchorArmed = fs.existsSync(ANCHOR_WORKFLOW_PATH);
  const sealMeta = readJson(SEAL_META_PATH);
  const beatReport = readJson(REPORT_PATH) as BeatReportShape | null;
  const ledgerFile = readJson(LEDGER_PATH) as LedgerShape | null;
  const leaves = readJson(LEAVES_PATH);
  const toolkitLeaves = readJson(TOOLKIT_LEAVES_PATH);
  const steemLine = readJson(STEEM_LINE_PATH);
  const zeroLine = readJson(ZERO_LINE_PATH);
  const anchorReport = readJson(ANCHOR_REPORT_PATH);

  // ── 2. git מקומי (בסנדבוקס עשוי להיות בלי remote — אמת מוצהרת) ──
  const remoteUrl = gitOrNull("git remote get-url origin");
  const lastCommit = gitOrNull("git log -1 --format=%H %cI %s");
  const dirtyFiles = gitOrNull("git status --porcelain");

  // ── 3. מפת הפערים — משוקפת מ-SOVEREIGNTY.md (2026-09-14: G2/G3/G4 נסגרו במדידה) ──
  const gaps = [
    {
      id: "G1",
      title: "עיגון on-chain בפועל — נסגר 2026-09-14 (קו ה-ZERO, גז-אפס)",
      missing: "—",
      path: "נסגר: weave-anchor-zero — root של ה-checkpoint עולה כטרנזקציית EVM אמיתית על Z Chain (Zero Network, chainId 9369, רשת EVM ראשית ציבורית שבה eth_gasPrice מדוד 0x0) ממפתח הרשת מה-seal, בעלות מדודה 0.000000; ה-txid חוזר לספר כאימות ANCHOR חתום וה-checkpoint מסומן ANCHORED לראשונה ב-REAL; ענן וסנדבוקס — אותה מכניקה, אפס משמרת חדשה",
    },
    {
      id: "G2",
      title: "קו Steem/Hive מהספר — נסגר 2026-09-14 16:57Z",
      missing: "—",
      path: "נסגר: weave-anchor — root ה-checkpoint כ-custom_json (saos.weave.core.v1, posting) על Steem+Hive; ה-txids חוזרים לספר כאימות ANCHOR חתום",
    },
    {
      id: "G3",
      title: "משמרת מפתחות בייצור — נסגר 2026-09-14 16:10Z",
      missing: "—",
      path: "נסגר: WEAVE_SEAL_PASSPHRASE ב-Actions Secrets (.env.local ל-runner; הסיסמה לא בגיט) — הוכח בענן (att 13)",
    },
    {
      id: "G4",
      title: "איחול-עצמי (SOV-3) — נסגר 2026-09-14 16:10Z",
      missing: "—",
      path: "נסגר: אימות BUILD מ-runner ענן נקי (att 13) — השער נסגר עליו",
    },
    {
      id: "G5",
      title: "קונסולה בלי סנדבוקס — נסגר 2026-09-15 00:40Z",
      missing: "—",
      path: "נסגר: Pages הופעל (המפעיל) ⇒ ריצת העוגן אטמה אוטומטית — att 37 CONSOLE חתום: pages LIVE · עד הקונסולה (cp#12 root) תואם לקו העוגן מ-Steem הציבורי · ריפו Console מפרסם את עצמו חסר-מפתחות ב-:40",
    },
    {
      id: "G6",
      title: "איחוד האקוסיסטם (R1) — נסגר 2026-09-14",
      missing: "—",
      path: "נסגר: מדידה מלאה לפני/אחרי (dup 0.5959→0.0537, יעד <0.2) · 828 מצבתות-מצביע ב-11 ריפואים · הקנון: anchor-baseline/steem · התוכן לא נמחק — ההיסטוריה בגיט · steem (73) במעבר נפרד",
    },
  ];

  // ── 4. פסק-דין פעימה אחרון ──
  const lastBeat = beatReport
    ? {
        at: beatReport.at ?? null,
        runner: beatReport.runner ?? null,
        mode: beatReport.mode ?? "full-beat",
        verdict: beatReport.verdict ?? null,
        checked: beatReport.verify?.checked ?? null,
        sigOk: beatReport.verify?.sigOk ?? null,
        beatSeq: beatReport.beat?.seq ?? null,
        checkpoint: beatReport.beat?.checkpoint
          ? {
              index: beatReport.beat.checkpoint.index ?? null,
              root: beatReport.beat.checkpoint.root ?? null,
            }
          : null,
        gatesClosed: beatReport.gatesClosed ?? [],
      }
    : null;

  // ── 5. קו ה-ZERO — נגזרות לפני המקבול (ה-probe זקוק ל-txid מהקובץ) ──
  const zeroLast = zeroLine ? ((zeroLine as Record<string, unknown>).last as Record<string, unknown> | undefined) : undefined;
  const zeroAccount = (zeroLine ? ((zeroLine as Record<string, unknown>).account as string | undefined) : undefined) ?? null;
  const zeroLastTxid = zeroLast ? ((zeroLast.txid as string | null) ?? null) : null;

  // ── 6. הכל האטי במקביל — 10 שאילתות-DB + שלושה probes חיצוניים ──
  // (נמדד לפני השינוי: טורי = 1.3-1.4s בכל קריאה; אחרי: מקסימום הרכיבים)
  const [
    dbBundle,
    consoleProbe,
    zeroLiveProbe,
    archiveLive,
  ] = await Promise.all([
    // 6א. כל שאילתות ה-DB בבת אחת (כולן קריאות עצמאיות)
    (async () => {
      const [lastAtt, count, cloudAgent, sovStages, anchorAtts, anchorAttsRows, toolkitAtt, consoleAtt, archiveWitnessIdx, baselineAudit] =
        await Promise.all([
          db.attestation.findFirst({ orderBy: { seq: "desc" } }),
          db.attestation.count(),
          db.agent.findUnique({ where: { name: "weave-cloud-heart" } }),
          db.planStage.findMany({
            where: { code: { startsWith: "SOV-" } },
            orderBy: { sortOrder: "asc" },
          }),
          db.attestation.count({ where: { claimType: "ANCHOR" } }),
          db.attestation.findMany({
            where: { claimType: "ANCHOR" },
            orderBy: { seq: "desc" },
            take: 5,
            select: { seq: true, claim: true, evidence: true, createdAt: true },
          }),
          db.attestation.findFirst({
            where: { claimType: "AUDIT", evidence: { contains: "toolkit-baseline" } },
            orderBy: { seq: "desc" },
            select: { seq: true, claim: true, evidence: true, createdAt: true },
          }),
          db.attestation.findFirst({
            where: { claimType: "CONSOLE" },
            orderBy: { seq: "desc" },
            select: { seq: true, claim: true, evidence: true, createdAt: true },
          }),
          lastArchiveWitness().catch(() => null),
          db.attestation.findFirst({
            where: {
              claimType: "AUDIT",
              AND: [{ evidence: { contains: "anchor-baseline" } }, { evidence: { contains: "merkleRoot=" } }],
            },
            orderBy: { seq: "desc" },
            select: { seq: true, evidence: true, createdAt: true },
          }),
        ]);
      return {
        lastAtt,
        count,
        cloudAgent,
        sovStages,
        anchorAtts,
        anchorAttsRows,
        toolkitAtt,
        consoleAtt,
        archiveWitnessIdx,
        baselineAudit,
      };
    })(),

    // 6ב. הקונסולה הציבורית — מדידה חיה מהחוץ (raw תמיד זמין; Pages אחרי ההפעלה)
    Promise.all([
      fetch(CONSOLE_RAW_STATUS_URL, { cache: "no-store", signal: AbortSignal.timeout(6000) })
        .then(async (r) => ({ http: r.status, status: r.ok ? ((await r.json()) as Record<string, unknown>) : null }))
        .catch(() => ({ http: 0, status: null })),
      fetch(CONSOLE_PAGES_URL, { method: "HEAD", signal: AbortSignal.timeout(6000) })
        .then((r) => ({ http: r.status, live: r.ok }))
        .catch(() => ({ http: 0, live: false })),
    ]),

    // 6ג. קו ה-ZERO — מדידה חיה חסרת-מפתחות מה-RPC הציבורי (כל צד שלישי)
    Promise.race([
      (async () => {
        const [readiness, readback] = await Promise.all([
          zeroReadiness(zeroAccount ?? undefined).catch(() => null),
          zeroLastTxid ? verifyZeroAnchorOnChain(zeroLastTxid).catch(() => null) : Promise.resolve(null),
        ]);
        return { readiness, readback };
      })(),
      new Promise<{ readiness: null; readback: null }>((resolve) =>
        setTimeout(() => resolve({ readiness: null, readback: null }), 9000)
      ),
    ]),

    // 6ד. עד הארכיון — גזירה חיה מהמקור (מטומנן 60s ברמת הספרייה)
    Promise.race([
      deriveArchiveSnapshot()
        .then((d) => ({
          root: d.snapshot.root,
          commit: d.snapshot.commit,
          pushedAt: d.snapshot.pushedAt,
          fileCount: d.snapshot.fileCount,
          totalBytes: d.snapshot.totalBytes,
          derivedAt: d.snapshot.derivedAt,
        }))
        .catch(() => null),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 14_000)),
    ]),
  ]);

  const { lastAtt, count, cloudAgent, sovStages, anchorAtts, anchorAttsRows, toolkitAtt, consoleAtt, archiveWitnessIdx, baselineAudit } = dbBundle;
  const consoleRaw = consoleProbe[0] as { http: number; status: Record<string, unknown> | null };
  const consolePages = consoleProbe[1] as { http: number; live: boolean };
  const consoleWitness = (consoleRaw.status?.witness ?? null) as Record<string, unknown> | null;
  const consoleFreshness = (consoleRaw.status?.freshness ?? null) as Record<string, unknown> | null;

  // ── 7. הספר בריפו מול ה-DB המקומי ──
  const localHead = lastAtt?.entryHash ?? null;
  const localCount = count;
  const ledgerCount = ledgerFile?.chainCount ?? null;
  const ledgerHead = ledgerFile?.headHash ?? null;

  let repoRelation: "IN-SYNC" | "REPO-AHEAD" | "LOCAL-AHEAD" | "NO-LEDGER" | "HEAD-MISMATCH";
  if (!ledgerFile) {
    repoRelation = "NO-LEDGER";
  } else if (ledgerCount === localCount && ledgerHead === localHead) {
    repoRelation = "IN-SYNC";
  } else if ((ledgerCount ?? 0) > localCount) {
    repoRelation = "REPO-AHEAD";
  } else if ((ledgerCount ?? 0) < localCount) {
    repoRelation = "LOCAL-AHEAD";
  } else {
    repoRelation = "HEAD-MISMATCH";
  }

  // ── 8. עד הארכיון — השוואת שורשים ──
  const baselineAuditRoot = baselineAudit?.evidence.match(/merkleRoot=(0x[0-9a-fA-F]{64})/)?.[1] ?? null;
  const archiveLastRoot = archiveWitnessIdx?.root ?? baselineAuditRoot;
  const archiveComparison = archiveLive
    ? archiveLive.root === archiveLastRoot
      ? "MATCHES-LAST-TESTIMONY"
      : "ADVANCED-BEYOND-LAST-TESTIMONY"
    : null;

  return {
    ok: true,
    sovereignty: {
      truthLabel: "LOCAL", // קריאת הריפו כאן היא מהעתק מקומי; הפעימות עצמן REAL בספר
      cloud: {
        armed: cloudArmed,
        workflow: cloudArmed ? ".github/workflows/weave-heart.yml" : null,
        schedule: cloudArmed ? workflowScheduleDesc("weave-heart.yml", "הקדנס החי בתאום Domain (שעתי :13)") : null,
        authModel: "GITHUB_TOKEN של הריפו (contents:write) — ה-PAT לעולם לא בענן",
      },
      ledger: {
        file: ledgerFile ? "sovereign/ledger.json" : null,
        repoCount: ledgerCount,
        repoHead: ledgerHead,
        exportedAt: ledgerFile?.exportedAt ?? null,
        localCount,
        localHead,
        relation: repoRelation,
      },
      seal: sealMeta
        ? {
            exists: true,
            at: (sealMeta.at as string) ?? null,
            rotatedAt: (sealMeta.rotatedAt as string) ?? null,
            kdf: (sealMeta.kdf as string) ?? null,
            enc: (sealMeta.enc as string) ?? null,
            cloudAddress: (sealMeta.cloudAddress as string) ?? null,
            networkAddress: (sealMeta.networkAddress as string) ?? null,
            custody: sealMeta.passphrase
              ? "LOCAL-LEGACY — הסיסמה עדיין ב-meta בגיט; סבב משמרת: bun scripts/weave-seal.ts --rotate-secret"
              : "REAL — GitHub Actions Secret (הענן) + .env.local (ה-runner הראשי) + כספת המפעיל; הסיסמה לא בגיט",
          }
        : { exists: false },
      cloudAgent: cloudAgent
        ? { name: cloudAgent.name, address: cloudAgent.ethAddress, status: cloudAgent.status }
        : null,
      lastBeat,
      steemLine: steemLine
        ? {
            exists: true,
            account: (steemLine.account as string) ?? null,
            opId: (steemLine.opId as string) ?? null,
            authority: "posting (אפס סיכון הון — הרמה המאושרת ל-L2)",
            anchorsTotal: Array.isArray(steemLine.anchors) ? (steemLine.anchors as unknown[]).length : 0,
            last: steemLine.last
              ? {
                  checkpoint: ((steemLine.last as Record<string, unknown>).checkpoint as number) ?? null,
                  root: ((steemLine.last as Record<string, unknown>).root as string) ?? null,
                  at: ((steemLine.last as Record<string, unknown>).at as string) ?? null,
                  txids: ((steemLine.last as Record<string, unknown>).txids as Record<string, string | null>) ?? null,
                  attSeq: ((steemLine.last as Record<string, unknown>).attSeq as number) ?? null,
                  explorer: {
                    steem: ((steemLine.last as Record<string, unknown>).txids as Record<string, string | null>)?.steem
                      ? `https://steemscan.com/transaction/${((steemLine.last as Record<string, unknown>).txids as Record<string, string | null>).steem}`
                      : null,
                    hive: ((steemLine.last as Record<string, unknown>).txids as Record<string, string | null>)?.hive
                      ? `https://hiveblockexplorer.com/tx/${((steemLine.last as Record<string, unknown>).txids as Record<string, string | null>).hive}`
                      : null,
                  },
                }
              : null,
            workflowArmed: anchorArmed,
            schedule: anchorArmed ? workflowScheduleDesc("weave-anchor.yml", "ההנעה החיה: weave-anchor-lines בעקבות כל פעימה") : null,
            custody: "WEAVE_STEEM_WIF — Actions Secret (הענן) + .env.local (ה-runner); המקור בכספת הצי; לעולם לא בגיט",
            anchorAttestationsTotal: anchorAtts,
            lastAnchorAttestations: anchorAttsRows.map((a) => ({
              seq: a.seq,
              claim: a.claim,
              evidence: a.evidence,
              createdAt: a.createdAt,
            })),
            lastReportMode: (anchorReport as Record<string, unknown>)?.mode ?? null,
          }
        : { exists: false, workflowArmed: anchorArmed },
      zeroLine: zeroLine
        ? {
            exists: true,
            rail: ZERO_RAIL_ID,
            chainId: 9369,
            account: zeroAccount,
            zeroGasProtocol:
              "data = 0xa9059cbb (סלקטור ברשימת-ההיתר של שער ה-RPC) + מטען קנוני · ממוען-עצמית ל-EOA אינרטי · gasPrice 0",
            anchorsTotal: Array.isArray(zeroLine.anchors) ? (zeroLine.anchors as unknown[]).length : 0,
            last: zeroLast
              ? {
                  checkpoint: (zeroLast.checkpoint as number) ?? null,
                  root: (zeroLast.root as string) ?? null,
                  at: (zeroLast.at as string) ?? null,
                  txid: zeroLastTxid,
                  block: (zeroLast.block as number) ?? null,
                  gasUsed: (zeroLast.gasUsed as number) ?? null,
                  effectiveGasPrice: (zeroLast.effectiveGasPrice as string) ?? null,
                  costEth: (zeroLast.costEth as string) ?? null,
                  confirmed: (zeroLast.confirmed as boolean) ?? false,
                  attSeq: (zeroLast.attSeq as number) ?? null,
                  runner: (zeroLast.runner as string) ?? null,
                  explorer: zeroLastTxid ? zeroExplorerLink(zeroLastTxid) : null,
                }
              : null,
            live: {
              readiness: zeroLiveProbe.readiness
                ? {
                    chainId: zeroLiveProbe.readiness.chainId,
                    blockNumber: zeroLiveProbe.readiness.blockNumber,
                    gasPriceGwei: zeroLiveProbe.readiness.gasPriceGwei,
                    zeroGasConfirmed: zeroLiveProbe.readiness.zeroGasConfirmed,
                    balanceEth: zeroLiveProbe.readiness.balanceEth,
                    nonce: zeroLiveProbe.readiness.nonce,
                    verdict: zeroLiveProbe.readiness.verdict,
                  }
                : null,
              readback: zeroLiveProbe.readback
                ? {
                    found: zeroLiveProbe.readback.found,
                    status: zeroLiveProbe.readback.status,
                    block: zeroLiveProbe.readback.block,
                    from: zeroLiveProbe.readback.from,
                    to: zeroLiveProbe.readback.to,
                    gasUsed: zeroLiveProbe.readback.gasUsed,
                    effectiveGasPrice: zeroLiveProbe.readback.effectiveGasPrice,
                    verdict: zeroLiveProbe.readback.verdict,
                  }
                : null,
            },
            workflowArmed: fs.existsSync(path.join(ROOT, ".github", "workflows", "weave-anchor-zero.yml")),
            schedule: workflowScheduleDesc("weave-anchor-zero.yml", "ההנעה החיה: weave-anchor-lines בעקבות כל פעימה"),
            custody:
              "מפתח הרשת מה-seal (WEAVE_SEAL_PASSPHRASE — סוד קיים, אפס משמרת חדשה) · המאזן 0 בכוונה — הגז מדוד 0x0",
            anchorAttestationsTotal: anchorAtts,
          }
        : { exists: false },
      anchors: leaves
        ? {
            derived: true,
            fileCount: (leaves.fileCount as number) ?? null,
            totalBytes: (leaves.totalBytes as number) ?? null,
            root: (leaves.root as string) ?? null,
            source: (leaves.source as Record<string, string>) ?? null,
            derivedAt: (leaves.derivedAt as string) ?? null,
          }
        : { derived: false },
      archiveLine: {
        exists: true,
        repo: ARCHIVE_REPO,
        hashPlan: ARCHIVE_HASH_PLAN,
        witness: archiveWitnessIdx
          ? {
              attSeq: archiveWitnessIdx.attSeq,
              root: archiveWitnessIdx.root,
              commit: archiveWitnessIdx.commit,
              fileCount: archiveWitnessIdx.fileCount,
              totalBytes: archiveWitnessIdx.totalBytes,
              at: archiveWitnessIdx.at,
              witnessAgent: "weave-archive-witness (DAEMON נגזר-seal)",
            }
          : null,
        baselineAudit: baselineAudit
          ? { seq: baselineAudit.seq, root: baselineAuditRoot, at: baselineAudit.createdAt }
          : null,
        live: archiveLive,
        comparison: archiveComparison,
        custody:
          "המדידה: upload/pat.env (runner ראשי) · בענן — WEAVE_ARCHIVE_TOKEN (Actions Secret, החלטת מפעיל, קריאה-בלבד); בלי גישה ⇒ REFUSED כנה — לא נכתבת עדות",
        schedule: "§5.7 בכל פעימה + נתיב ידני (POST /api/weave/archive/witness)",
      },
      toolkit: toolkitLeaves
        ? {
            derived: true,
            fileCount: (toolkitLeaves.fileCount as number) ?? null,
            totalBytes: (toolkitLeaves.totalBytes as number) ?? null,
            root: (toolkitLeaves.root as string) ?? null,
            derivedAt: (toolkitLeaves.derivedAt as string) ?? null,
            custody: "Project-files (ה-zips המקוריים) + השלמות ניתנת לאימות מול השורש בספר",
            attestation: toolkitAtt
              ? { seq: toolkitAtt.seq, claim: toolkitAtt.claim, createdAt: toolkitAtt.createdAt }
              : null,
          }
        : { derived: false },
      console: {
        repoUrl: CONSOLE_REPO_URL,
        pagesUrl: CONSOLE_PAGES_URL,
        pagesHttp: consolePages.http,
        pagesLive: consolePages.live,
        rawHttp: consoleRaw.http,
        siteSourceInRepo: fs.existsSync(CONSOLE_SITE_PATH),
        publicStatus: consoleRaw.status
          ? {
              generatedAt: (consoleRaw.status.generatedAt as string) ?? null,
              source: (consoleRaw.status.source as Record<string, string>) ?? null,
              freshness: consoleFreshness
                ? {
                    verdict: (consoleFreshness.verdict as string) ?? null,
                    ageHours: (consoleFreshness.ageHours as number) ?? null,
                    thresholdHours: (consoleFreshness.thresholdHours as number) ?? null,
                  }
                : null,
              witness: consoleWitness
                ? {
                    checkpoint: (consoleWitness.checkpoint as number) ?? null,
                    root: (consoleWitness.root as string) ?? null,
                    txid: (consoleWitness.txid as string) ?? null,
                    at: (consoleWitness.at as string) ?? null,
                    attestations: (consoleWitness.attestations as number) ?? null,
                    explorer: (consoleWitness.explorer as string) ?? null,
                  }
                : null,
            }
          : null,
        architecture:
          "חסרת-מפתחות: render.mjs בריפו הציבורי קורא את קו העוגנים מ-Steem RPC ציבורי → status.json → commit+Pages ב-GITHUB_TOKEN של Console בלבד; מקור האתר בריפו הריבוני (console/)",
        attestation: consoleAtt
          ? { seq: consoleAtt.seq, claim: consoleAtt.claim, createdAt: consoleAtt.createdAt }
          : null,
      },
      sovGates: sovStages.map((s) => ({
        code: s.code,
        title: s.title,
        state: s.state,
        attSeq: s.attSeq,
        gate: s.gate,
      })),
      git: {
        remote: remoteUrl ? remoteUrl.replace(/:\/\/[^@]*@/, "://***@") : null,
        lastCommit: lastCommit ? lastCommit.split(" ").slice(0, 3).join(" ") : null,
        dirty: dirtyFiles ? dirtyFiles.split("\n").filter(Boolean).length : 0,
      },
      gaps,
      sovereigntyDoc: fs.existsSync(SOVEREIGNTY_PATH) ? "SOVEREIGNTY.md" : null,
    },
  };
}
