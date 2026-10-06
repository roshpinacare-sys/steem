"use client";

// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · טאב 7 - רשת ריבונית
// הריפו הוא האמת: לב-ענן חמוש · הספר בגיט · seal · גזירת העוגנים ·
// מפת הפערים ל"הכל על גבי הרשת שלנו" · כפתור סנכרון מהריפו.
// ─────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from "react";
import {
  Archive,
  ArrowLeftRight,
  Cloud,
  Coins,
  Database,
  DoorOpen,
  FileCheck2,
  GitBranch,
  ExternalLink,
  Globe2,
  HeartPulse,
  Landmark,
  Link2,
  Lock,
  RefreshCw,
  Server,
  ShieldCheck,
  Siren,
  Sprout,
  Wallet,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { GovernancePanel } from "@/components/weave/views/governance-panel";
import {
  CopyButton,
  ErrorBox,
  FadeIn,
  HashChip,
  KpiSkeletonRow,
  MotionCard,
  scrollBoxClass,
  Section,
  StatusBadge,
  TruthLabel,
  truncateMiddle,
} from "../shared";

// ── DTO (משוקף מה-route) ────────────────────────────────────────────

interface SovereigntyDTO {
  truthLabel: string;
  cloud: {
    armed: boolean;
    workflow: string | null;
    schedule: string | null;
    authModel: string;
  };
  ledger: {
    file: string | null;
    repoCount: number | null;
    repoHead: string | null;
    exportedAt: string | null;
    localCount: number;
    localHead: string | null;
    relation: "IN-SYNC" | "REPO-AHEAD" | "LOCAL-AHEAD" | "NO-LEDGER" | "HEAD-MISMATCH";
  };
  seal: {
    exists: boolean;
    at?: string | null;
    rotatedAt?: string | null;
    kdf?: string | null;
    enc?: string | null;
    cloudAddress?: string | null;
    networkAddress?: string | null;
    custody?: string;
  };
  cloudAgent: { name: string; address: string; status: string } | null;
  lastBeat: {
    at: string | null;
    runner: string | null;
    mode: string;
    verdict: string | null;
    checked: number | null;
    sigOk: number | null;
    beatSeq: number | null;
    checkpoint: { index: number | null; root: string | null } | null;
    gatesClosed: Array<{ code: string; attSeq: number }>;
  } | null;
  steemLine: {
    exists: boolean;
    account?: string | null;
    opId?: string | null;
    authority?: string;
    anchorsTotal?: number;
    workflowArmed?: boolean;
    schedule?: string | null;
    custody?: string;
    anchorAttestationsTotal?: number;
    lastReportMode?: string | null;
    last?: {
      checkpoint: number | null;
      root: string | null;
      at: string | null;
      txids: Record<string, string | null> | null;
      attSeq: number | null;
      explorer: { steem: string | null; hive: string | null };
    } | null;
    lastAnchorAttestations?: Array<{
      seq: number;
      claim: string;
      evidence: string;
      createdAt: string;
    }>;
  };
  zeroLine: {
    exists: boolean;
    rail?: string;
    chainId?: number;
    account?: string | null;
    zeroGasProtocol?: string;
    anchorsTotal?: number;
    workflowArmed?: boolean;
    schedule?: string | null;
    custody?: string;
    anchorAttestationsTotal?: number;
    last?: {
      checkpoint: number | null;
      root: string | null;
      at: string | null;
      txid: string | null;
      block: number | null;
      gasUsed: number | null;
      effectiveGasPrice: string | null;
      costEth: string | null;
      confirmed: boolean;
      attSeq: number | null;
      runner: string | null;
      explorer: string | null;
    } | null;
    live?: {
      readiness: {
        chainId: number | null;
        blockNumber: number | null;
        gasPriceGwei: number | null;
        zeroGasConfirmed: boolean;
        balanceEth: string | null;
        nonce: number | null;
        verdict: string;
      } | null;
      readback: {
        found: boolean;
        status: number | null;
        block: number | null;
        from: string | null;
        to: string | null;
        gasUsed: number | null;
        effectiveGasPrice: string | null;
        verdict: string;
      } | null;
    } | null;
  };
  anchors: {
    derived: boolean;
    fileCount?: number | null;
    totalBytes?: number | null;
    root?: string | null;
    source?: Record<string, string> | null;
    derivedAt?: string | null;
  };
  archiveLine?: {
    exists: boolean;
    repo: string;
    hashPlan: string;
    witness: {
      attSeq: number;
      root: string | null;
      commit: string | null;
      fileCount: number | null;
      totalBytes: number | null;
      at: string;
      witnessAgent: string;
    } | null;
    baselineAudit: { seq: number; root: string | null; at: string } | null;
    live: {
      root: string;
      commit: string;
      pushedAt: string | null;
      fileCount: number;
      totalBytes: number;
      derivedAt: string;
    } | null;
    comparison: "MATCHES-LAST-TESTIMONY" | "ADVANCED-BEYOND-LAST-TESTIMONY" | null;
    custody?: string;
    schedule?: string;
  };
  toolkit: {
    derived: boolean;
    fileCount?: number | null;
    totalBytes?: number | null;
    root?: string | null;
    derivedAt?: string | null;
    custody?: string | null;
    attestation?: { seq: number; claim: string; createdAt: string } | null;
  };
  console: {
    repoUrl: string;
    pagesUrl: string;
    pagesHttp: number;
    pagesLive: boolean;
    rawHttp: number;
    siteSourceInRepo: boolean;
    publicStatus: {
      generatedAt: string | null;
      source?: Record<string, string> | null;
      freshness?: { verdict: string | null; ageHours: number | null; thresholdHours: number | null } | null;
      witness?: {
        checkpoint: number | null;
        root: string | null;
        txid: string | null;
        at: string | null;
        attestations: number | null;
        explorer: string | null;
      } | null;
    } | null;
    architecture?: string;
    attestation?: { seq: number; claim: string; createdAt: string } | null;
  };
  sovGates: Array<{
    code: string;
    title: string;
    state: string;
    attSeq: number | null;
    gate: string;
  }>;
  git: { remote: string | null; lastCommit: string | null; dirty: number };
  gaps: Array<{ id: string; title: string; missing: string; path: string }>;
  sovereigntyDoc: string | null;
}

interface SyncReport {
  ok: boolean;
  synced?: boolean;
  reason?: string;
  imported?: Record<string, number>;
  keysPreserved?: { agents: number; network: boolean };
  remote?: { chainCount: number; headHash: string; exportedAt: string };
  verify?: { valid: boolean; checked: number; sigOk: number; sigFail: number };
  error?: string;
}

// ── SAOS-NET - השרשרת הכלכלית של הצי (משוקף מה-runner) ──

interface SaosnetAccount {
  name: string;
  saos: number;
  steem: number;
  lp: number;
  lockedSaos: number;
  wrapped: string[];
}

interface SaosnetWalletRec {
  agent: string;
  digest: string;
  evm: string | null;
  tron: string | null;
  sol: string | null;
  btc: string | null;
  hostTxid: string | null;
  by: string;
  at: string | null;
}

interface SaosnetDTO {
  ok: boolean;
  net: {
    netVersion: string;
    genesisHash: string | null;
    height: number;
    stateRoot: string;
    lastTime: string | null;
    issuer: string | null;
    supply: number | null;
    lastHeartbeat: string | null;
    snapshotHeight: number;
    blocksInPack: number;
  };
  verify: {
    snapshotSelf: boolean;
    replayed: number;
    hashMatch: string;
    linkage: string;
    finalRoot: string;
    nodeClaimRoot: string;
    rootMatch: boolean;
    heightMatch: boolean;
    verdict: string;
  };
  economy: {
    soldiers: number;
    lpHolders: number;
    lpSupply: number;
    wrappedSymbols: string[];
    accounts: SaosnetAccount[];
  };
  weave: { total: number; seals: number; witnesses: number };
  doors: { issued: number; sent: number; open: number; note: string };
  harvest: { pot: number; streams: Record<string, number>; count: number; released: number };
  wallets: { total: number; agents: number; last: SaosnetWalletRec[] };
  truthLabel: string;
  /** r121 — גיל ה-pack בכנות: replay אמיתי על תמונה קפואה אינו "מצב נוכחי" */
  pack?: {
    path: string;
    kernelOps: number | null;
    checkedAt: string;
    lastAdvancedAt: string | null;
    ageHours: number | null;
    state: string;
  };
}

// ── עוגן-עוגנים - ההצלבה של SAOS-NET בספר (מה-API) ──

interface CrosschainInfo {
  attSeq: number;
  stateRoot: string | null;
  height: number | null;
  netVersion: string | null;
  at: string;
}

interface CrossAnchorResponse {
  ok: boolean;
  crossAnchor?: {
    status: "ATTESTED" | "SKIPPED" | "REFUSED";
    reason: string;
    attSeq: number | null;
    net: { netVersion: string; height: number; stateRoot: string };
    checkpoint: { index: number; root: string } | null;
    ledgerExported: boolean;
    note: string;
  };
  error?: string;
}

const RELATION_META: Record<
  SovereigntyDTO["ledger"]["relation"],
  { label: string; tone: string; hint: string }
> = {
  "IN-SYNC": {
    label: "מסונכרן",
    tone: "text-emerald-600 dark:text-emerald-400",
    hint: "ה-DB המקומי והספר בריפו זהים בדיוק",
  },
  "REPO-AHEAD": {
    label: "הריפו קדימה",
    tone: "text-amber-600 dark:text-amber-400",
    hint: "יש פעימות חדשות בריפו (למשל מהענן) - משוך סנכרון",
  },
  "LOCAL-AHEAD": {
    label: "המקומי קדימה",
    tone: "text-amber-600 dark:text-amber-400",
    hint: "ה-DB המקומי חדש - דחוף פעימה (bun scripts/weave-beat.ts --local)",
  },
  "NO-LEDGER": {
    label: "אין ספר בריפו",
    tone: "text-zinc-500",
    hint: "sovereign/ledger.json טרם נוצר - הפעימה הראשונה תייצא אותו",
  },
  "HEAD-MISMATCH": {
    label: "סתירת head",
    tone: "text-rose-600 dark:text-rose-400",
    hint: "אורך זהה אך head שונה - נדרשת בדיקה ידנית",
  },
};

export function SovereigntyTab() {
  const [data, setData] = useState<SovereigntyDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncReport, setSyncReport] = useState<SyncReport | null>(null);
  const [saosnet, setSaosnet] = useState<SaosnetDTO | null>(null);
  const [saosnetState, setSaosnetState] = useState<"loading" | "ready" | "error">("loading");
  const [crosschain, setCrosschain] = useState<CrosschainInfo | null>(null);
  const [crossAnchoring, setCrossAnchoring] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/weave/sovereignty", { cache: "no-store" });
      const json = (await res.json()) as { ok: boolean; sovereignty?: SovereigntyDTO; error?: string };
      if (!json.ok || !json.sovereignty) throw new Error(json.error ?? "טעינת ריבונות נכשלה");
      setData(json.sovereignty);
    } catch (e) {
      setError(e instanceof Error ? e.message : "שגיאה לא צפויה");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // SAOS-NET - replay דטרמיניסטי בצד השרת (כבד יחסית; מטומנן 60 שניות)
  // + אינדקס ההצלבה - אימות ה-CROSSCHAIN האחרון בספר (עוגן-עוגנים)
  useEffect(() => {
    let alive = true;
    fetch("/api/weave/saosnet", { cache: "no-store" })
      .then((r) => r.json())
      .then((json: { ok: boolean; saosnet?: SaosnetDTO; crosschain?: CrosschainInfo | null }) => {
        if (!alive) return;
        if (json.ok && json.saosnet) {
          setSaosnet(json.saosnet);
          setSaosnetState("ready");
          setCrosschain(json.crosschain ?? null);
        } else {
          setSaosnetState("error");
        }
      })
      .catch(() => {
        if (alive) setSaosnetState("error");
      });
    return () => {
      alive = false;
    };
  }, []);

  const runSync = useCallback(async () => {
    setSyncing(true);
    setSyncReport(null);
    try {
      const res = await fetch("/api/weave/sovereignty/sync", { method: "POST" });
      const json = (await res.json()) as SyncReport;
      setSyncReport(json);
      if (json.ok && json.synced) {
        toast.success(
          `נמשכו ${json.remote?.chainCount ?? "?"} אימותים מהריפו · אימות מחדש: ${
            json.verify?.valid ? "תקין" : "שבור"
          }`
        );
      } else if (json.ok) {
        toast.info(json.reason ?? "כבר מסונכרן");
      } else {
        toast.error(json.error ?? "הסנכרון נכשל");
      }
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "הסנכרון נכשל");
    } finally {
      setSyncing(false);
    }
  }, [load]);

  // עוגן-עוגנים - המסלול הידני (אותה מכניקה של הפעימה §5.6): המדידה
  // קובעת, לעולם לא הלקוח - replay מלא בשרת => אימות CROSSCHAIN חתום
  const runCrossAnchor = useCallback(async () => {
    setCrossAnchoring(true);
    try {
      const res = await fetch("/api/weave/saosnet/anchor", { method: "POST" });
      const json = (await res.json()) as CrossAnchorResponse;
      if (!json.ok || !json.crossAnchor) {
        throw new Error(json.error ?? "ההצלבה נכשלה");
      }
      const ca = json.crossAnchor;
      if (ca.status === "ATTESTED") {
        toast.success(
          `SAOS-NET הוצלב בספר - att ${ca.attSeq} · cp#${ca.checkpoint?.index ?? "?"} · העוגנים יעידו ב-$0`
        );
        setCrosschain({
          attSeq: ca.attSeq ?? 0,
          stateRoot: ca.net.stateRoot,
          height: ca.net.height,
          netVersion: ca.net.netVersion,
          at: new Date().toISOString(),
        });
      } else if (ca.status === "SKIPPED") {
        toast.info(ca.reason);
      } else {
        toast.error(ca.reason);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "ההצלבה נכשלה");
    } finally {
      setCrossAnchoring(false);
    }
  }, []);

  // עד הארכיון - המסלול הידני (אותה מכניקה של הפעימה §5.7): המדידה
  // קובעת, לעולם לא הלקוח - גזירה חיה מהמקור בשרת => אימות CROSSCHAIN
  // חתום => checkpoint => ledger.json
  const [archiving, setArchiving] = useState(false);
  const runArchiveWitness = useCallback(async () => {
    setArchiving(true);
    try {
      const res = await fetch("/api/weave/archive/witness", { method: "POST" });
      const json = (await res.json()) as {
        ok: boolean;
        archiveWitness?: {
          status: "ATTESTED" | "SKIPPED" | "REFUSED";
          reason: string;
          attSeq: number | null;
          snapshot?: { root?: string; fileCount?: number; commit?: string } | null;
          checkpoint?: { index: number; root: string } | null;
        };
        error?: string;
      };
      if (!json.ok || !json.archiveWitness) {
        throw new Error(json.error ?? "עדות הארכיון נכשלה");
      }
      const aw = json.archiveWitness;
      if (aw.status === "ATTESTED") {
        toast.success(
          `הארכיון הועיד בספר - att ${aw.attSeq} · cp#${aw.checkpoint?.index ?? "?"} · העוגנים יעידו ב-$0`
        );
        await load();
      } else if (aw.status === "SKIPPED") {
        toast.info(aw.reason);
      } else {
        toast.error(aw.reason);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "עדות הארכיון נכשלה");
    } finally {
      setArchiving(false);
    }
  }, [load]);

  if (loading && !data) {
    return (
      <FadeIn className="flex flex-col gap-4 sm:gap-6">
        <KpiSkeletonRow count={4} />
      </FadeIn>
    );
  }
  if (error) {
    return <ErrorBox message={error} onRetry={() => void load()} />;
  }
  if (!data) return null;

  const rel = RELATION_META[data.ledger.relation];
  const beatIsCloud = data.lastBeat?.runner === "github-actions";

  return (
    <FadeIn className="flex flex-col gap-4 sm:gap-6">
      {/* ── כרטיסי KPI ── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MotionCard className="p-4">
          <div className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
            <Cloud className="h-4 w-4" />
            לב-ענן
          </div>
          <div className="mt-2 flex items-center justify-between gap-2">
            <span
              className={cn(
                "text-lg font-semibold",
                data.cloud.armed
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-rose-600 dark:text-rose-400"
              )}
            >
              {data.cloud.armed ? "חמוש" : "לא חמוש"}
            </span>
            <TruthLabel kind="REAL" />
          </div>
          <p className="mt-2 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
            {data.cloud.schedule ?? "-"} ·{" "}
            <span dir="ltr" className="font-mono">
              {data.cloud.workflow ?? "-"}
            </span>
          </p>
        </MotionCard>

        <MotionCard className="p-4">
          <div className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
            <GitBranch className="h-4 w-4" />
            ספר בריפו
          </div>
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className={cn("text-lg font-semibold", rel.tone)}>{rel.label}</span>
            <TruthLabel kind="LOCAL" />
          </div>
          <p className="mt-2 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
            מקומי {data.ledger.localCount} · ריפו {data.ledger.repoCount ?? "-"} ·{" "}
            {data.ledger.exportedAt
              ? new Date(data.ledger.exportedAt).toLocaleString("he-IL")
              : "לא ייוצא"}
          </p>
        </MotionCard>

        <MotionCard className="p-4">
          <div className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
            <HeartPulse className="h-4 w-4" />
            פעימה אחרונה
          </div>
          <div className="mt-2 flex items-center justify-between gap-2">
            <span
              className={cn(
                "text-lg font-semibold",
                data.lastBeat?.verdict?.startsWith("LEDGER-VALID")
                  ? "text-emerald-600 dark:text-emerald-400"
                  : data.lastBeat
                    ? "text-rose-600 dark:text-rose-400"
                    : "text-zinc-500"
              )}
            >
              {data.lastBeat ? (beatIsCloud ? "ענן" : "מקומית") : "אין"}
            </span>
            <StatusBadge status={data.lastBeat?.verdict?.startsWith("LEDGER-VALID") ? "VERIFIED" : data.lastBeat ? "REFUTED" : "UNMEASURED"} />
          </div>
          <p className="mt-2 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
            {data.lastBeat?.at ? new Date(data.lastBeat.at).toLocaleString("he-IL") : "-"}
            {data.lastBeat?.beatSeq ? ` · seq ${data.lastBeat.beatSeq}` : ""}
            {data.lastBeat?.checkpoint ? ` · cp #${data.lastBeat.checkpoint.index}` : ""}
          </p>
        </MotionCard>

        <MotionCard className="p-4">
          <div className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
            <Landmark className="h-4 w-4" />
            גזירת העוגנים
          </div>
          <div className="mt-2 flex items-center justify-between gap-2">
            <span
              className={cn(
                "text-lg font-semibold",
                data.anchors.derived
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-zinc-500"
              )}
            >
              {data.anchors.derived ? "נארג" : "טרם"}
            </span>
            <TruthLabel kind="REAL" />
          </div>
          <p className="mt-2 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
            {data.anchors.derived
              ? `${data.anchors.fileCount ?? "?"} קבצים => שורש מרקל בספר`
              : "הארכיון עדיין לא נגרר לשורש"}
          </p>
        </MotionCard>
      </div>

      {/* ── r142: הממשל הריבוני — הרשת מחליטה מעצמה (D-OP-01) ── */}
      <GovernancePanel />

      {/* ── שרשרת הריבונות - דיאגרמה ── */}
      <Section
        title="שרשרת הריבונות - מי מפעיל את מי"
        icon={<Globe2 />}
        description="הסנדבוקס הוא workspace; הריפו הוא האמת; הענן הוא המנוע שלא מת"
      >
        <Card>
          <CardContent className="p-4 sm:p-6">
            <div className="grid grid-cols-1 items-stretch gap-3 md:grid-cols-5">
              {[
                {
                  icon: Server,
                  title: "Runner ראשי",
                  sub: "סנדבוקס / מקומי",
                  body: "פעימה מלאה: pull -> verify -> attest -> checkpoint -> push",
                  tone: "border-amber-500/40",
                },
                {
                  icon: GitBranch,
                  title: "הבית בריפו",
                  sub: "roshpinacare-sys · weave-core",
                  body: "ledger.json + seal + workflow + הקוד - שורד איפוסים",
                  tone: "border-emerald-500/40",
                },
                {
                  icon: Cloud,
                  title: "לב-ענן",
                  sub: `GitHub Actions · ${data.cloud.schedule ?? "קצב לא נקרא"}`,
                  body: "ספר טרי => אימות-בלבד · ישן => TAKEOVER",
                  tone: "border-emerald-500/40",
                },
                {
                  icon: HeartPulse,
                  title: "פעימה חתומה",
                  sub: "EIP-191 · מפתח מה-seal",
                  body: "אימות MEASUREMENT נמדד + checkpoint EIP-712",
                  tone: "border-emerald-500/40",
                },
                {
                  icon: ShieldCheck,
                  title: "שער-סודות",
                  sub: "לפני כל דחיפה",
                  body: "WIF/PEM/PAT/מפתח ב-diff => חסימה מוחלטת",
                  tone: "border-rose-500/40",
                },
              ].map((step, i) => (
                <div
                  key={step.title}
                  className={cn(
                    "relative flex flex-col gap-2 rounded-lg border bg-zinc-50 p-3 dark:bg-zinc-900/60",
                    step.tone
                  )}
                >
                  <div className="flex items-center gap-2">
                    <step.icon className="h-4 w-4 text-zinc-500 dark:text-zinc-400" />
                    <span className="text-sm font-semibold">{step.title}</span>
                    <span className="mr-auto font-mono text-[10px] text-zinc-400">{i + 1}/5</span>
                  </div>
                  <div className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                    {step.sub}
                  </div>
                  <div className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-300">
                    {step.body}
                  </div>
                  {i < 4 && (
                    <ArrowLeftRight className="absolute -left-2 top-1/2 hidden h-4 w-4 -translate-y-1/2 rotate-90 text-zinc-300 md:block ltr:-rotate-90" />
                  )}
                </div>
              ))}
            </div>
            <p className="mt-4 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
              שיפוט הבריאות - השרשרת עצמה: טריות האימות האחרון בספר + הדחיפה האחרונה בגיט.
              אין תיאום, אין שרת-בחירות, אין אמון בין runners. מפתח המפעיל לא נחוץ בענן -{" "}
              <span dir="ltr" className="font-mono">
                {data.cloud.authModel}
              </span>
            </p>
          </CardContent>
        </Card>
      </Section>

      {/* ── הספר בריפו + סנכרון ── */}
      <Section
        title="הספר בריפו מול העותק המקומי"
        icon={<Database />}
        description="ledger.json = אמת קנונית חסרת-סודות; SQLite = מטמון שנבנה ממנה"
      >
        <Card>
          <CardContent className="flex flex-col gap-4 p-4 sm:p-6">
            <div className="flex flex-wrap items-center gap-3">
              <HashChip value={data.ledger.repoHead ?? "-"} label="head בריפו" />
              <HashChip value={data.ledger.localHead ?? "-"} label="head מקומי" />
              <Button
                onClick={() => void runSync()}
                disabled={syncing}
                size="sm"
                className="h-11 gap-2 px-4"
              >
                <RefreshCw className={cn("h-4 w-4", syncing && "animate-spin")} />
                {syncing ? "מסנכרן…" : "משוך מהריפו"}
              </Button>
            </div>
            <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
              {rel.hint} · git:{" "}
              <span dir="ltr" className="font-mono">
                {data.git.remote ?? "אין remote מקומי"}
              </span>{" "}
              {data.git.lastCommit ? `· commit ${truncateMiddle(data.git.lastCommit.split(" ")[0], 8, 0)}` : ""}
              {data.git.dirty > 0 ? ` · ${data.git.dirty} שינויים מקומיים לא מחויבים` : ""}
            </p>
            {syncReport && (
              <div
                className={cn(
                  "rounded-md border p-3 text-xs leading-relaxed",
                  syncReport.ok && syncReport.synced
                    ? "border-emerald-500/40 bg-emerald-500/5"
                    : syncReport.ok
                      ? "border-amber-500/40 bg-amber-500/5"
                      : "border-rose-500/40 bg-rose-500/5"
                )}
              >
                {syncReport.ok && syncReport.synced ? (
                  <div className="flex flex-col gap-1">
                    <span className="font-semibold text-emerald-700 dark:text-emerald-300">
                      ייובאו {syncReport.imported?.attestations ?? "?"} אימותים · מפתחות מקומיים
                      שנשמרו: {syncReport.keysPreserved?.agents ?? 0}
                    </span>
                    <span>
                      אימות לאחר ייבוא:{" "}
                      {syncReport.verify?.valid
                        ? `תקין (${syncReport.verify.sigOk}/${syncReport.verify.checked} חתימות)`
                        : "שבור - עצור ובדוק"}
                    </span>
                  </div>
                ) : syncReport.ok ? (
                  <span>{syncReport.reason}</span>
                ) : (
                  <span className="text-rose-700 dark:text-rose-300">{syncReport.error}</span>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </Section>

      {/* ── ה-seal + סוכן הענן ── */}
      <Section
        title="משמורת הזהויות - ה-seal"
        icon={<Lock />}
        description="מפתחות במעטפת מוצפנת; הסיסמה במשמרת מפוצלת - Secrets (ענן) + .env.local (מקומי) + כספת המפעיל"
      >
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Lock className="h-4 w-4" />
                sovereign/weave-seal.enc
                <TruthLabel kind="REAL" />
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              {data.seal.exists ? (
                <>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-zinc-500 dark:text-zinc-400">הצפנה</span>
                    <span dir="ltr" className="font-mono text-xs">
                      {data.seal.enc} · {data.seal.kdf}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-zinc-500 dark:text-zinc-400">כתובת ענן</span>
                    <HashChip value={data.seal.cloudAddress ?? "-"} label="" />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-zinc-500 dark:text-zinc-400">כתובת רשת</span>
                    <HashChip value={data.seal.networkAddress ?? "-"} label="" />
                  </div>
                  <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
                    {data.seal.custody}
                    {data.seal.at ? ` · נחתם ${new Date(data.seal.at).toLocaleString("he-IL")}` : ""}
                    {data.seal.rotatedAt
                      ? ` · סובב ${new Date(data.seal.rotatedAt).toLocaleString("he-IL")}`
                      : ""}
                  </p>
                </>
              ) : (
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  seal טרם נוצר - הרץ{" "}
                  <span dir="ltr" className="font-mono text-xs">
                    bun scripts/weave-seal.ts --create
                  </span>
                </p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Cloud className="h-4 w-4" />
                סוכן הענן - weave-cloud-heart
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              {data.cloudAgent ? (
                <>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-zinc-500 dark:text-zinc-400">זהות EVM</span>
                    <HashChip value={data.cloudAgent.address} label="" />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-zinc-500 dark:text-zinc-400">סטטוס</span>
                    <StatusBadge status={data.cloudAgent.status === "ACTIVE" ? "VERIFIED" : "UNMEASURED"} />
                  </div>
                  <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
                    חותם את אימותי הפעימה; מפתחו חי רק ב-seal - לעולם לא בספר ולא ב-DB המיוצא.
                  </p>
                </>
              ) : (
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  הסוכן נולד בפעימה הראשונה (ensureCloudAgent מה-seal).
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </Section>

      {/* ── עד הארכיון - ההיסטוריה הכתובה מעידה חיה (Task 19) ── */}
      {(data.archiveLine?.exists || data.anchors.derived) && (
        <Section
          title="עד הארכיון - ההיסטוריה הכתובה של הרשת מעידה חיה"
          icon={<Archive />}
          description="גזירה חיה מהמקור בכל פעימה · שורש חדש => CROSSCHAIN חתום => העוגנים מעידים ב-$0 · אותו שורש => דילוג כנה"
        >
          <Card>
            <CardContent className="flex flex-col gap-3 p-4 sm:p-6">
              <div className="flex flex-wrap items-center gap-3">
                {data.archiveLine?.witness ? (
                  <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                    VERIFIED · att {data.archiveLine.witness.attSeq}
                  </span>
                ) : (
                  <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                    גזירה ראשונה בספר · ממתין לעדות החיה
                  </span>
                )}
                {data.archiveLine?.baselineAudit && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                        תקדים חד-פעמי · att {data.archiveLine.baselineAudit.seq} (AUDIT)
                      </span>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      הגזירה המקורית שאטמה את הארכיון פעם אחת; העד המחזר יורש את אותה
                      תוכנית-האש - נאמנות ההעברה הוכחה בשחזור מושלם של אותו שורש.
                    </TooltipContent>
                  </Tooltip>
                )}
                <span className="font-mono text-xs text-zinc-500 dark:text-zinc-400" dir="ltr">
                  {data.archiveLine?.repo ?? data.anchors.source?.repo ?? "-"}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <HashChip
                  value={data.archiveLine?.witness?.root ?? data.anchors.root ?? "-"}
                  label={data.archiveLine?.witness ? "archiveRoot" : "merkleRoot"}
                />
                <CopyButton
                  value={data.archiveLine?.witness?.root ?? data.anchors.root ?? ""}
                  label="העתק שורש"
                />
              </div>

              <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">קבצים</div>
                  <div className="font-mono">
                    {data.archiveLine?.witness?.fileCount ?? data.anchors.fileCount ?? "-"}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">נפח</div>
                  <div className="font-mono">
                    {(
                      ((data.archiveLine?.witness?.totalBytes ?? data.anchors.totalBytes ?? 0) || 0) /
                      1024
                    ).toFixed(0)}
                    KB
                  </div>
                </div>
                <div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">מקור העדות</div>
                  <div dir="ltr" className="font-mono text-xs">
                    {data.archiveLine?.witness?.commit
                      ? `@${truncateMiddle(data.archiveLine.witness.commit, 10, 8)}`
                      : data.anchors.source?.commit
                        ? `@${truncateMiddle(data.anchors.source.commit, 10, 8)}`
                        : "-"}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">
                    {data.archiveLine?.witness ? "הועיד" : "נגזר"}
                  </div>
                  <div className="font-mono text-xs">
                    {(data.archiveLine?.witness?.at ?? data.anchors.derivedAt)
                      ? new Date(
                          data.archiveLine?.witness?.at ?? data.anchors.derivedAt ?? ""
                        ).toLocaleString("he-IL")
                      : "-"}
                  </div>
                </div>
              </div>

              {/* המדידה החיה מול העדות - תיבת ההשוואה */}
              <div
                className={cn(
                  "rounded-lg border p-3 text-sm",
                  data.archiveLine?.comparison === "MATCHES-LAST-TESTIMONY"
                    ? "border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/40"
                    : data.archiveLine?.comparison === "ADVANCED-BEYOND-LAST-TESTIMONY"
                      ? "border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40"
                      : "border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/40"
                )}
              >
                {data.archiveLine?.live ? (
                  <div className="flex flex-col gap-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-medium">
                        {data.archiveLine.comparison === "MATCHES-LAST-TESTIMONY"
                          ? "המדידה החיה תואמת את העדות האחרונה - הארכיון לא השתנה"
                          : data.archiveLine.comparison === "ADVANCED-BEYOND-LAST-TESTIMONY"
                            ? "הארכיון התקדם מעבר לעדות - הפעימה הבאה תעיד"
                            : "מדידה חיה - אין עדות קודמת להשוות"}
                      </span>
                      <span
                        dir="ltr"
                        className="font-mono text-xs text-zinc-500 dark:text-zinc-400"
                      >
                        live @{truncateMiddle(data.archiveLine.live.commit, 10, 8)}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
                      <span className="font-mono">
                        {data.archiveLine.live.fileCount} files ·{" "}
                        {(data.archiveLine.live.totalBytes / 1024).toFixed(0)}KB
                      </span>
                      {data.archiveLine.live.pushedAt && (
                        <span className="font-mono">
                          pushed {new Date(data.archiveLine.live.pushedAt).toLocaleString("he-IL")}
                        </span>
                      )}
                    </div>
                  </div>
                ) : (
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">
                    מדידה חיה לא זמינה כרגע (הריפו פרטי - הגישה ב-runner הראשי; בענן נדרש
                    WEAVE_ARCHIVE_TOKEN)
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void runArchiveWitness()}
                  disabled={archiving}
                >
                  {archiving ? (
                    <>
                      <RefreshCw className="ml-2 size-3.5 animate-spin" />
                      מודד ומעיד…
                    </>
                  ) : (
                    <>
                      <Archive className="ml-2 size-3.5" />
                      הצלב את הארכיון בספר (חתום)
                    </>
                  )}
                </Button>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  {data.archiveLine?.schedule ?? "§5.7 בכל פעימה"}
                </span>
              </div>

              <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
                תוכנית-ההאש הקנונית: {data.archiveLine?.hashPlan ?? 'sha256(file) -> keccak256("path:sha256") -> merkle-keccak256'}.
                הכלל שנגזר מהעוגנים: עוגן שרק "יושב" = ארכיון; שורש שנכנס לשרשרת-חתומה = כוח.
                מרגע זה כל דחיפה של הצי לארכיון נקלטת אוטומטית בפעימה הבאה - שינוי של בית
                אחד ניתן לאיתור ע"י חישוב-מחדש מכל clone. משמרת:{" "}
                {data.archiveLine?.custody ?? "upload/pat.env (runner ראשי)"}
              </p>
            </CardContent>
          </Card>
        </Section>
      )}

      {/* ── הקונסולה הציבורית - החלון חסר-המפתחות (G5) ── */}
      {data.console && (
        <Section
          title="הקונסולה הציבורית - הרשת מפרסמת את עצמה בחוץ"
          icon={<Globe2 />}
          description="ריפו ציבורי שמפרסם את קו העוגנים חזרה מהשרשרת · אפס סודות · אפס תלות בסנדבוקס"
        >
          <Card>
            <CardContent className="flex flex-col gap-3 p-4 sm:p-6">
              <div className="flex flex-wrap items-center gap-3">
                {data.console.attestation ? (
                  <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                    G5 SEALED · att {data.console.attestation.seq}
                  </span>
                ) : data.console.pagesLive ? (
                  <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                    PAGES LIVE · ממתין לאימות החתום של המחזור הבא
                  </span>
                ) : (
                  <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                    SELF-PUBLISHING · ממתין להפעלת Pages (המפעיל)
                  </span>
                )}
                <span className="font-mono text-xs text-zinc-500 dark:text-zinc-400">
                  raw {data.console.rawHttp} · pages {data.console.pagesHttp}
                </span>
                <a
                  href={data.console.repoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-zinc-500 underline-offset-2 hover:text-zinc-900 hover:underline dark:text-zinc-400 dark:hover:text-zinc-100"
                >
                  הריפו הציבורי <ExternalLink className="size-3" />
                </a>
                {data.console.pagesLive && (
                  <a
                    href={data.console.pagesUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-zinc-500 underline-offset-2 hover:text-zinc-900 hover:underline dark:text-zinc-400 dark:hover:text-zinc-100"
                  >
                    האתר בחוץ <ExternalLink className="size-3" />
                  </a>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">עד חיצוני</div>
                  <div className="font-mono">
                    {data.console.publicStatus?.witness?.checkpoint != null
                      ? `cp#${data.console.publicStatus.witness.checkpoint}`
                      : "-"}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">טריות בחוץ</div>
                  <div className="font-mono">
                    {data.console.publicStatus?.freshness?.verdict
                      ? `${data.console.publicStatus.freshness.verdict} · ${
                          data.console.publicStatus.freshness.ageHours ?? "?"
                        }h`
                      : "-"}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">פורסם</div>
                  <div className="font-mono text-xs">
                    {data.console.publicStatus?.generatedAt
                      ? new Date(data.console.publicStatus.generatedAt).toLocaleString("he-IL")
                      : "-"}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">מקור האתר</div>
                  <div className="font-mono text-xs">
                    {data.console.siteSourceInRepo ? "בריפו הריבוני (console/)" : "חסר"}
                  </div>
                </div>
              </div>
              {data.console.publicStatus?.witness?.txid && (
                <div className="flex flex-wrap items-center gap-3">
                  <HashChip
                    value={data.console.publicStatus.witness.txid}
                    label="witness txid (on-chain)"
                  />
                  {data.console.publicStatus.witness.explorer && (
                    <a
                      href={data.console.publicStatus.witness.explorer}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-zinc-500 underline-offset-2 hover:text-zinc-900 hover:underline dark:text-zinc-400 dark:hover:text-zinc-100"
                    >
                      steemscan <ExternalLink className="size-3" />
                    </a>
                  )}
                </div>
              )}
              <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
                ארכיטקטורה חסרת-מפתחות: workflow בריפו הציבורי קורא את קו העוגנים מ-Steem
                RPC ציבורי (custom_json מהעד בסמכות posting), מרנדר status.json ומבצע
                commit ב-GITHUB_TOKEN שלו בלבד - בקצב שעתי בעקבות הלב (הקצב
                הנגזר מוצג בכרטיסי הקווים). מוות של הסנדבוקס או של הריפו הפרטי לא מפיל את החלון.
                מה שלא עולה לחוץ לעולם: מפתחות, טוקנים, יתרות, מסמכים פנימיים (CONSOLE-POLICY.md).
              </p>
            </CardContent>
          </Card>
        </Section>
      )}

      {/* ── ערכת הכלים - משמרת בת-קיימא ── */}
      {data.toolkit?.derived && (
        <Section
          title="ערכת הכלים - ה-toolkit הפך לנכס מאומת"
          icon={<FileCheck2 />}
          description="5 zips + פריצה מלאה => שורש מרקל בספר · הבתים במשמרת Project-files"
        >
          <Card>
            <CardContent className="flex flex-col gap-3 p-4 sm:p-6">
              <div className="flex flex-wrap items-center gap-3">
                <HashChip value={data.toolkit.root ?? "-"} label="merkleRoot" />
                <CopyButton value={data.toolkit.root ?? ""} label="העתק שורש" />
                {data.toolkit.attestation ? (
                  <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                    VERIFIED · att {data.toolkit.attestation.seq}
                  </span>
                ) : (
                  <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                    שורש נגזר · ממתין לאימות
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">קבצים</div>
                  <div className="font-mono">{data.toolkit.fileCount ?? "-"}</div>
                </div>
                <div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">נפח</div>
                  <div className="font-mono">
                    {(((data.toolkit.totalBytes ?? 0) / 1024 / 1024) || 0).toFixed(1)}MB
                  </div>
                </div>
                <div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">משמרת הבתים</div>
                  <div className="font-mono text-xs">Project-files</div>
                </div>
                <div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">נגזר</div>
                  <div className="font-mono text-xs">
                    {data.toolkit.derivedAt
                      ? new Date(data.toolkit.derivedAt).toLocaleString("he-IL")
                      : "-"}
                  </div>
                </div>
              </div>
              <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
                ה-zips המקוריים הוצלבו מול ה-blob-sha של Project-files (5/5 זהים לבית) · הורדה עתידית
                מאומתת מול השורש בספר - מות הסנדבוקס לא מאבד מה-toolkit דבר.
              </p>
            </CardContent>
          </Card>
        </Section>
      )}

      {/* ── קו ה-Steem/Hive ── */}
      {data.steemLine?.exists && (
        <Section
          title="קו ה-Steem/Hive - הספר מעיד על עצמו מחוץ לגיטהאב"
          icon={<Globe2 />}
          description="root של ה-checkpoint עולה כ-custom_json על שתי שרשראות ציבוריות · ה-txids חוזרים לספר כאימות ANCHOR חתום"
        >
          <Card>
            <CardContent className="flex flex-col gap-3 p-4 sm:p-6">
              <div className="flex flex-wrap items-center gap-3">
                <StatusBadge
                  status={
                    data.steemLine?.last && (data.steemLine.last.txids?.steem || data.steemLine.last.txids?.hive)
                      ? "VERIFIED"
                      : "UNMEASURED"
                  }
                />
                <span dir="ltr" className="font-mono text-xs text-zinc-500 dark:text-zinc-400">
                  @{data.steemLine?.account ?? "-"} · {data.steemLine?.opId ?? "-"}
                </span>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  {data.steemLine?.authority ?? ""}
                </span>
              </div>
              {data.steemLine?.last ? (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <HashChip value={data.steemLine.last.root ?? "-"} label={`cp#${data.steemLine.last.checkpoint ?? "?"}`} />
                    {data.steemLine.last.attSeq != null && (
                      <span className="text-xs text-zinc-500 dark:text-zinc-400">
                        אימות ANCHOR seq {data.steemLine.last.attSeq}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {data.steemLine.last.txids?.steem && (
                      <a
                        href={data.steemLine.last.explorer.steem ?? "#"}
                        target="_blank"
                        rel="noreferrer"
                        dir="ltr"
                        className="inline-flex items-center gap-1 rounded-md border border-zinc-200 px-2 py-1 font-mono text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                      >
                        Steem · {truncateMiddle(data.steemLine.last.txids.steem, 10, 6)}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                    {data.steemLine.last.txids?.hive && (
                      <a
                        href={data.steemLine.last.explorer.hive ?? "#"}
                        target="_blank"
                        rel="noreferrer"
                        dir="ltr"
                        className="inline-flex items-center gap-1 rounded-md border border-zinc-200 px-2 py-1 font-mono text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                      >
                        Hive · {truncateMiddle(data.steemLine.last.txids.hive, 10, 6)}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">
                      עוגן {data.steemLine.last.at ? new Date(data.steemLine.last.at).toLocaleString("he-IL") : "-"}
                    </span>
                  </div>
                </>
              ) : (
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  הקו חמוש אך טרם עוגן - הריצה הבאה לפי הקצב הנגזר (שדה ה״קצב״ למטה) או dispatch ידני יעגנו את ה-checkpoint האחרון.
                </p>
              )}
              <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">עוגנים בקו</div>
                  <div className="font-mono">{data.steemLine?.anchorsTotal ?? 0}</div>
                </div>
                <div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">אימותי ANCHOR בספר</div>
                  <div className="font-mono">{data.steemLine?.anchorAttestationsTotal ?? 0}</div>
                </div>
                <div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">workload ענן</div>
                  <div className="font-mono text-xs" dir="ltr">
                    {data.steemLine?.workflowArmed ? "weave-anchor.yml" : "-"}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">קצב</div>
                  <div className="font-mono text-xs" dir="ltr">{data.steemLine?.schedule ?? "-"}</div>
                </div>
              </div>
              <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
                {data.steemLine?.custody}
                {" · העדות חיה לנצח מול ה-RPC הציבורי - בלי לסמוך עלינו ועל גיטהאב כלל."}
              </p>
            </CardContent>
          </Card>
        </Section>
      )}

      {/* ── קו ה-ZERO - מסילת ה-EVM בגז-אפס (G1) ── */}
      {data.zeroLine?.exists && (
        <Section
          title="קו ה-ZERO - מסילת EVM בגז-אפס (G1 · Z Chain 9369)"
          icon={<Zap />}
          description="root של ה-checkpoint עולה כטרנזקציית EVM אמיתית על רשת EVM ראשית ציבורית שבה הגז מדוד 0x0 · העלות הכוללת: 0.000000"
        >
          <Card>
            <CardContent className="flex flex-col gap-3 p-4 sm:p-6">
              <div className="flex flex-wrap items-center gap-3">
                <StatusBadge
                  status={
                    data.zeroLine?.last?.confirmed && data.zeroLine?.live?.readback?.found
                      ? "VERIFIED"
                      : data.zeroLine?.last
                        ? "UNMEASURED"
                        : "PENDING"
                  }
                />
                <span dir="ltr" className="font-mono text-xs text-zinc-500 dark:text-zinc-400">
                  {data.zeroLine?.rail ?? "zero-9369"} · chainId {data.zeroLine?.chainId ?? 9369}
                </span>
                {data.zeroLine?.live?.readiness?.zeroGasConfirmed && (
                  <span
                    dir="ltr"
                    className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 font-mono text-[10px] text-emerald-700 dark:text-emerald-400"
                  >
                    eth_gasPrice = 0x0 (live)
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span dir="ltr" className="font-mono text-xs text-zinc-500 dark:text-zinc-400">
                  {data.zeroLine?.account ?? "-"}
                </span>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  מפתח הרשת מה-seal · מאזן 0 בכוונה
                </span>
              </div>
              {data.zeroLine?.last ? (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <HashChip value={data.zeroLine.last.root ?? "-"} label={`cp#${data.zeroLine.last.checkpoint ?? "?"}`} />
                    {data.zeroLine.last.attSeq != null && (
                      <span className="text-xs text-zinc-500 dark:text-zinc-400">
                        אימות ANCHOR seq {data.zeroLine.last.attSeq}
                      </span>
                    )}
                    {data.zeroLine.last.runner && (
                      <span
                        dir="ltr"
                        className="rounded-md border border-zinc-200 px-2 py-0.5 font-mono text-[10px] text-zinc-500 dark:border-zinc-700 dark:text-zinc-400"
                      >
                        {data.zeroLine.last.runner}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {data.zeroLine.last.txid && (
                      <a
                        href={data.zeroLine.last.explorer ?? "#"}
                        target="_blank"
                        rel="noreferrer"
                        dir="ltr"
                        className="inline-flex items-center gap-1 rounded-md border border-zinc-200 px-2 py-1 font-mono text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                      >
                        ZERO · {truncateMiddle(data.zeroLine.last.txid, 10, 6)}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">
                      עוגן {data.zeroLine.last.at ? new Date(data.zeroLine.last.at).toLocaleString("he-IL") : "-"}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                    <div>
                      <div className="text-xs text-zinc-500 dark:text-zinc-400">בלוק</div>
                      <div className="font-mono" dir="ltr">{data.zeroLine.last.block ?? "-"}</div>
                    </div>
                    <div>
                      <div className="text-xs text-zinc-500 dark:text-zinc-400">גז שנוצל</div>
                      <div className="font-mono" dir="ltr">{data.zeroLine.last.gasUsed ?? "-"}</div>
                    </div>
                    <div>
                      <div className="text-xs text-zinc-500 dark:text-zinc-400">מחיר בפועל</div>
                      <div className="font-mono" dir="ltr">
                        {data.zeroLine.last.effectiveGasPrice === "0" ? "0x0 - אפס" : (data.zeroLine.last.effectiveGasPrice ?? "-")}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-zinc-500 dark:text-zinc-400">עלות כוללת</div>
                      <div className="font-mono text-emerald-600 dark:text-emerald-400" dir="ltr">
                        {data.zeroLine.last.costEth ?? "0.000000"} ETH
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  הקו חמוש אך טרם עוגן - הריצה הבאה לפי הקצב הנגזר (שדה ה״קצב״ למטה) או dispatch ידני יעגנו את ה-checkpoint האחרון.
                </p>
              )}
              {data.zeroLine?.live?.readback && (
                <div className="rounded-md border border-emerald-500/20 bg-emerald-500/5 p-3">
                  <div className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
                    קריאה-חזרה חיה מה-RPC הציבורי (חסרת-מפתחות)
                  </div>
                  <p dir="auto" className="mt-1 font-mono text-[11px] leading-relaxed text-emerald-700/90 dark:text-emerald-400/90">
                    {data.zeroLine.live.readback.verdict}
                  </p>
                  {data.zeroLine.live.readiness && (
                    <p dir="ltr" className="mt-1 font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
                      chain {data.zeroLine.live.readiness.chainId} · block {data.zeroLine.live.readiness.blockNumber} ·
                      gasPrice {data.zeroLine.live.readiness.gasPriceGwei} · nonce {data.zeroLine.live.readiness.nonce}
                    </p>
                  )}
                </div>
              )}
              <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">עוגנים בקו</div>
                  <div className="font-mono">{data.zeroLine?.anchorsTotal ?? 0}</div>
                </div>
                <div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">אימותי ANCHOR בספר</div>
                  <div className="font-mono">{data.zeroLine?.anchorAttestationsTotal ?? 0}</div>
                </div>
                <div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">workload ענן</div>
                  <div className="font-mono text-xs" dir="ltr">
                    {data.zeroLine?.workflowArmed ? "weave-anchor-zero.yml" : "-"}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">קצב</div>
                  <div className="font-mono text-xs" dir="ltr">{data.zeroLine?.schedule ?? "-"}</div>
                </div>
              </div>
              <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
                {data.zeroLine?.zeroGasProtocol}
                {" · "}
                {data.zeroLine?.custody}
                {" · כל צד שלישי מאמת מ-zscan.live או rpc.zero.tech - בלי לסמוך עלינו ועל גיטהאב כלל."}
              </p>
            </CardContent>
          </Card>
        </Section>
      )}

      {/* ── SAOS-NET - שרשרת הכלכלה של הצי ("המערכת שתחליף") ── */}
      <Section
        title="SAOS-NET - שרשרת הכלכלה של הצי (המערכת שתחליף)"
        icon={<Coins />}
        description="קרנל דטרמיניסטי (saos-net/0): אותו ג׳נזיס + אותן טרנזקציות = אותו state-root בכל מכונה · DEX + נכסים עטופים + דלתות רשת + קציר + ארנקי-הצבא · האימות כאן: replay מלא מה-snapshot"
      >
        <Card>
          <CardContent className="flex flex-col gap-3 p-4 sm:p-6">
        {saosnetState === "loading" && (
          <div className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
            <RefreshCw className="h-4 w-4 animate-spin" />
            מריץ replay דטרמיניסטי על ה-pack (snapshot =&gt; בלוקים =&gt; שורש)…
          </div>
        )}
        {saosnetState === "error" && (
          <p className="text-sm text-rose-600 dark:text-rose-400">
            אימות SAOS-NET לא עלה כרגע - ה-runner ינסה שוב בטעינה הבאה. כנות: לא מוצג סטטוס בלי מדידה.
          </p>
        )}
        {saosnetState === "ready" && saosnet && (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <StatusBadge
                status={
                  saosnet.verify.rootMatch && saosnet.verify.heightMatch && saosnet.verify.snapshotSelf
                    ? "VERIFIED"
                    : "REFUTED"
                }
              />
              <span dir="ltr" className="font-mono text-xs text-zinc-500 dark:text-zinc-400">
                {saosnet.net.netVersion} · h={saosnet.net.height.toLocaleString("en-US")}
              </span>
              <TruthLabel kind="REAL" />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <HashChip value={saosnet.net.stateRoot} label="stateRoot" />
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                {saosnet.net.blocksInPack} בלוקים ב-pack · snapshot h={saosnet.net.snapshotHeight.toLocaleString("en-US")}
              </span>
              {saosnet.pack && (
                <span
                  className={
                    "rounded border px-1.5 py-0.5 text-[10px] font-medium " +
                    (saosnet.pack.state.startsWith("FROZEN")
                      ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                      : "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400")
                  }
                  dir="auto"
                >
                  {saosnet.pack.state.startsWith("FROZEN")
                    ? `pack קפוא — לא התקדם ${saosnet.pack.ageHours ?? "?"}ש׳ (מ-${saosnet.pack.lastAdvancedAt?.slice(0, 10) ?? "?"})`
                    : `pack חי · גיל ${saosnet.pack.ageHours ?? "?"}ש׳`}
                </span>
              )}
            </div>

            <div className="rounded-md border border-emerald-500/20 bg-emerald-500/5 p-3">
              <div className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
                אימות replay עצמאי (מתמטי - רץ כרגע בשרת)
              </div>
              <p dir="auto" className="mt-1 font-mono text-[11px] leading-relaxed text-emerald-700/90 dark:text-emerald-400/90">
                {saosnet.verify.verdict}
              </p>
              <p dir="ltr" className="mt-1 font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
                snapshot self: {saosnet.verify.snapshotSelf ? "PASS" : "FAIL"} · replayed {saosnet.verify.replayed} blocks ·
                hash {saosnet.verify.hashMatch} · linkage {saosnet.verify.linkage} · root {saosnet.verify.rootMatch ? "MATCH" : "MISMATCH"}
              </p>
            </div>

            {/* עוגן-עוגנים - ההצלבה של שרשרת הצי בספר של THE WEAVE */}
            <div className="rounded-md border border-emerald-500/20 bg-emerald-500/5 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                  <Link2 className="h-3.5 w-3.5" />
                  עוגן-עוגנים - ההצלבה בספר של THE WEAVE
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void runCrossAnchor()}
                  disabled={crossAnchoring}
                  className="h-7 gap-1.5 px-2.5 text-[11px]"
                >
                  {crossAnchoring ? (
                    <RefreshCw className="h-3 w-3 animate-spin" />
                  ) : (
                    <Link2 className="h-3 w-3" />
                  )}
                  הצלב בספר (חתום)
                </Button>
              </div>
              {crosschain ? (
                <>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <StatusBadge status="VERIFIED" />
                    <span dir="ltr" className="font-mono text-xs text-zinc-500 dark:text-zinc-400">
                      att {crosschain.attSeq} · {crosschain.netVersion ?? "-"} ·
                      h={crosschain.height?.toLocaleString("en-US") ?? "?"}
                    </span>
                    <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                      מועד העדות:{" "}
                      <span dir="ltr" className="font-mono">
                        {new Date(crosschain.at).toLocaleTimeString("he-IL")}
                      </span>
                    </span>
                  </div>
                  {crosschain.stateRoot && (
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      <HashChip value={crosschain.stateRoot} label="stateRoot מוצלב" />
                      {crosschain.height === saosnet.net.height ? (
                        <span className="text-[11px] text-emerald-600 dark:text-emerald-400">
                          תואם ל-replay — הספר מעיד על אותה תמונת-מצב
                          {saosnet.pack?.state.startsWith("FROZEN") ? " (pack קפוא — ראה תג הגיל למעלה)" : ""}
                        </span>
                      ) : (
                        <span className="text-[11px] text-amber-600 dark:text-amber-400">
                          ה-pack התקדם מאז העדות (עדות h={crosschain.height?.toLocaleString("en-US")} · נוכחי h={saosnet.net.height.toLocaleString("en-US")}) - הפעימה הבאה תצלב את החדש
                        </span>
                      )}
                    </div>
                  )}
                  <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
                    העדות נכתבה כאימות CROSSCHAIN חתום (עד נגזר-seal) =&gt; checkpoint מכסה =&gt; העוגנים
                    (Steem/Hive · ZERO-EVM, בעקבות כל פעימה — הקצב הנגזר בכרטיסי הקווים) מעידים עליה החוצה ב-$0. אותו stateRoot =&gt; דילוג
                    כנה; replay שבור =&gt; REFUSED - לא נכתבת עדות על מצב בלתי-מאומת.
                  </p>
                </>
              ) : (
                <p className="mt-2 text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
                  שרשרת הכלכלה של הצי טרם הוצלבה בספר - הפעימה (§5.6) או הכפתור יכתבו את העדות
                  החתומה הראשונה: replay מלא =&gt; אימות CROSSCHAIN =&gt; checkpoint =&gt; עיגון ב-$0.
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:grid-cols-6">
              <div>
                <div className="text-xs text-zinc-500 dark:text-zinc-400">חיילי הצי</div>
                <div className="font-mono">{saosnet.economy.soldiers}</div>
              </div>
              <div>
                <div className="text-xs text-zinc-500 dark:text-zinc-400">אחזקות LP</div>
                <div className="font-mono" dir="ltr">{saosnet.economy.lpHolders} · {saosnet.economy.lpSupply}</div>
              </div>
              <div>
                <div className="text-xs text-zinc-500 dark:text-zinc-400">נכסים עטופים</div>
                <div className="font-mono text-xs" dir="ltr">{saosnet.economy.wrappedSymbols.join(" · ") || "-"}</div>
              </div>
              <div>
                <div className="text-xs text-zinc-500 dark:text-zinc-400">ארנקי-הצבא</div>
                <div className="font-mono" dir="ltr">{saosnet.wallets.agents}/4-rails</div>
              </div>
              <div>
                <div className="text-xs text-zinc-500 dark:text-zinc-400">קציר</div>
                <div className="font-mono text-emerald-600 dark:text-emerald-400" dir="ltr">
                  {saosnet.harvest.pot} SAOS
                </div>
              </div>
              <div>
                <div className="text-xs text-zinc-500 dark:text-zinc-400">דלתות</div>
                <div className="font-mono" dir="ltr">{saosnet.doors.issued} הונפקו / {saosnet.doors.sent} נשלחו</div>
              </div>
            </div>

            {/* חיילי הצי - החשבונות והכלכלה החיה */}
            <div>
              <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                <Server className="h-4 w-4 text-zinc-400" />
                כלכלת החיילים (מהמצב המשוחזר)
              </div>
              <div className={cn("max-h-64 overflow-y-auto", scrollBoxClass)}>
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-background">
                    <TableRow>
                      <TableHead>חייל</TableHead>
                      <TableHead dir="ltr">SAOS</TableHead>
                      <TableHead dir="ltr">STEEM</TableHead>
                      <TableHead dir="ltr">LP</TableHead>
                      <TableHead className="hidden sm:table-cell" dir="ltr">locked</TableHead>
                      <TableHead className="hidden md:table-cell">נכסים עטופים</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {saosnet.economy.accounts.map((a) => (
                      <TableRow key={a.name}>
                        <TableCell className="font-mono text-xs">{a.name}</TableCell>
                        <TableCell className="font-mono text-xs" dir="ltr">{a.saos}</TableCell>
                        <TableCell className="font-mono text-xs" dir="ltr">{a.steem}</TableCell>
                        <TableCell className="font-mono text-xs" dir="ltr">{a.lp}</TableCell>
                        <TableCell className="hidden font-mono text-xs sm:table-cell" dir="ltr">
                          {a.lockedSaos > 0 ? a.lockedSaos : "-"}
                        </TableCell>
                        <TableCell className="hidden font-mono text-[11px] md:table-cell" dir="ltr">
                          {a.wrapped.join(" · ") || "-"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>

            {/* ארנקי-הצבא - כתובות החיילים בארבע רשתות */}
            <div>
              <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                <Wallet className="h-4 w-4 text-zinc-400" />
                כתובות החיילים - ארנקים רב-רשתיים מעוגנים (evm · tron · sol · btc)
              </div>
              <div className={cn("max-h-64 overflow-y-auto", scrollBoxClass)}>
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-background">
                    <TableRow>
                      <TableHead>סוכן</TableHead>
                      <TableHead dir="ltr">EVM</TableHead>
                      <TableHead dir="ltr">TRON</TableHead>
                      <TableHead className="hidden lg:table-cell" dir="ltr">SOL</TableHead>
                      <TableHead className="hidden xl:table-cell">עוגן המארח</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {saosnet.wallets.last.map((w) => (
                      <TableRow key={w.agent + w.digest}>
                        <TableCell className="font-mono text-xs">{w.agent}</TableCell>
                        <TableCell className="font-mono text-[11px]" dir="ltr">
                          {w.evm ? truncateMiddle(w.evm, 10, 6) : "-"}
                        </TableCell>
                        <TableCell className="font-mono text-[11px]" dir="ltr">
                          {w.tron ? truncateMiddle(w.tron, 10, 6) : "-"}
                        </TableCell>
                        <TableCell className="hidden font-mono text-[11px] lg:table-cell" dir="ltr">
                          {w.sol ? truncateMiddle(w.sol, 8, 4) : "-"}
                        </TableCell>
                        <TableCell className="hidden text-xs xl:table-cell">
                          {w.hostTxid ? (
                            <a
                              href={`https://steemscan.com/transaction/${w.hostTxid}`}
                              target="_blank"
                              rel="noreferrer"
                              dir="ltr"
                              className="inline-flex items-center gap-1 font-mono text-[11px] text-emerald-600 hover:underline dark:text-emerald-400"
                            >
                              {truncateMiddle(w.hostTxid, 10, 6)}
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          ) : (
                            "-"
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 text-[11px] text-zinc-500 dark:text-zinc-400">
              <span className="inline-flex items-center gap-1 rounded-md border border-zinc-200 px-2 py-0.5 dark:border-zinc-700">
                <DoorOpen className="h-3 w-3" /> THE-DOOR (108): {saosnet.doors.note}
              </span>
              <span className="inline-flex items-center gap-1 rounded-md border border-zinc-200 px-2 py-0.5 dark:border-zinc-700">
                <Sprout className="h-3 w-3" /> הקציר: {saosnet.harvest.count} ערכים מוכרים ·
                שוחרר {saosnet.harvest.released}
              </span>
            </div>

            <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
              {saosnet.truthLabel} · הראש: <span dir="ltr" className="font-mono">{saosnet.net.issuer ?? "-"}</span> ·
              פעימה אחרונה: <span dir="auto" className="font-mono text-[11px]">{saosnet.net.lastHeartbeat ?? "-"}</span>
            </p>
          </>
        )}
          </CardContent>
        </Card>
      </Section>

      {/* ── שערי SOV ── */}
      <Section
        title="שערי הריבונות - SOV"
        icon={<ShieldCheck />}
        description="כל שער נסגר רק ע״י אימות VERIFIED - הרשת סוגרת לעצמה"
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {data.sovGates.map((g) => (
            <MotionCard key={g.code} className="p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-sm font-semibold">{g.code}</span>
                <StatusBadge status={g.state === "DONE" ? "VERIFIED" : "UNMEASURED"} />
              </div>
              <div className="mt-1 text-sm font-medium">{g.title}</div>
              <p className="mt-2 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
                {g.gate}
              </p>
              {g.attSeq != null && (
                <div className="mt-2 text-xs text-emerald-600 dark:text-emerald-400">
                  נסגר עם אימות #{g.attSeq}
                </div>
              )}
            </MotionCard>
          ))}
        </div>
      </Section>

      {/* ── מפת הפערים ── */}
      <Section
        title="מה חסר עוד ל׳הכל על גבי הרשת׳"
        icon={<Siren />}
        description="שישה פערים בלבד - כולם נסגרים באותה שיטה: עוד workflow + עוד שורה חתומה בספר"
      >
        <Card>
          <CardContent className="p-0">
            <div className={cn("max-h-96 overflow-y-auto", scrollBoxClass)}>
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-background">
                  <TableRow>
                    <TableHead className="w-14">#</TableHead>
                    <TableHead>הפער</TableHead>
                    <TableHead className="hidden md:table-cell">למה חסר</TableHead>
                    <TableHead className="hidden lg:table-cell">הדרך לסגירה</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.gaps.map((g) => (
                    <TableRow key={g.id}>
                      <TableCell className="font-mono text-xs">{g.id}</TableCell>
                      <TableCell className="font-medium">{g.title}</TableCell>
                      <TableCell className="hidden text-xs text-zinc-500 dark:text-zinc-400 md:table-cell">
                        {g.missing}
                      </TableCell>
                      <TableCell className="hidden text-xs text-zinc-500 dark:text-zinc-400 lg:table-cell">
                        {g.path}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
          המסמך המלא:{" "}
          <span dir="ltr" className="font-mono">
            {data.sovereigntyDoc ?? "SOVEREIGNTY.md"}
          </span>{" "}
          בשורש הריפו - כולל ההסקה (I1-I5), הרכיבים שנבנו ותורת העוגנים.
        </p>
      </Section>

      {/* ── פעימה אחרונה - פירוט ── */}
      {data.lastBeat && (
        <Section
          title="הפעימה האחרונה - פירוט מלא"
          icon={<HeartPulse />}
          description="הדוח כפי שנכתב ע״י ה-runner שהריץ (מקומי או ענן)"
        >
          <Card>
            <CardContent className="flex flex-col gap-2 p-4 text-sm sm:p-6">
              <div className="flex flex-wrap gap-x-6 gap-y-1">
                <span>
                  <span className="text-zinc-500 dark:text-zinc-400">מתי: </span>
                  {data.lastBeat.at ? new Date(data.lastBeat.at).toLocaleString("he-IL") : "-"}
                </span>
                <span>
                  <span className="text-zinc-500 dark:text-zinc-400">runner: </span>
                  <span dir="ltr" className="font-mono text-xs">
                    {data.lastBeat.runner}
                  </span>{" "}
                  ({data.lastBeat.runner === "github-actions" ? "הענן" : "מקומי"})
                </span>
                <span>
                  <span className="text-zinc-500 dark:text-zinc-400">מצב: </span>
                  <span dir="ltr" className="font-mono text-xs">
                    {data.lastBeat.mode}
                  </span>
                </span>
              </div>
              <div className="flex flex-wrap gap-x-6 gap-y-1">
                <span>
                  <span className="text-zinc-500 dark:text-zinc-400">פסק-דין: </span>
                  <span
                    className={cn(
                      "font-medium",
                      data.lastBeat.verdict?.startsWith("LEDGER-VALID")
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-rose-600 dark:text-rose-400"
                    )}
                    dir="ltr"
                  >
                    {data.lastBeat.verdict ?? "-"}
                  </span>
                </span>
                {data.lastBeat.checked != null && (
                  <span>
                    <span className="text-zinc-500 dark:text-zinc-400">אימותים: </span>
                    {data.lastBeat.checked} · חתימות {data.lastBeat.sigOk ?? 0}/
                    {data.lastBeat.checked}
                  </span>
                )}
              </div>
              {data.lastBeat.checkpoint?.root && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-zinc-500 dark:text-zinc-400">checkpoint:</span>
                  <HashChip value={data.lastBeat.checkpoint.root} label={`#${data.lastBeat.checkpoint.index}`} />
                </div>
              )}
              {data.lastBeat.gatesClosed.length > 0 && (
                <div className="text-xs text-emerald-600 dark:text-emerald-400">
                  שערים שנסגרו בפעימה:{" "}
                  {data.lastBeat.gatesClosed
                    .map((g) => `אימות #${g.attSeq} סגר ${g.code}`)
                    .join(" · ")}
                </div>
              )}
            </CardContent>
          </Card>
        </Section>
      )}
    </FadeIn>
  );
}
