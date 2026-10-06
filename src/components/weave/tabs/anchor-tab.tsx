"use client";

// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · טאב 4 - עוגן EVM
// Checkpoints עם Merkle root + עיגון ברישום המקומי (EVM-2 · LOCAL) +
// חבילת הפריסה האמיתית (EVM-1) + מפת אמת + החוזה WeaveAnchorRegistry.sol
//
// שני מצבי אמת (Task 38):
//  · cloud - checkpoints מהמראה הציבורית: root, טווח seq ו-anchorStatus
//    אמיתיים (כולל "ANCHORED (steem/zero)" שמוצג כתג emerald מפוצל);
//    calldata/חתימות/prevRoot לא נחשפים במראה ומוצגים כ-placeholder
//    מושתק וכנה. פעולות הכתיבה מסומנות כמקומיות.
//  · local - כמו תמיד: checkpoint חי, calldata אמיתי, עיגון ברישום המקומי.
// ─────────────────────────────────────────────────────────────────────

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Anchor,
  Cloud,
  FileCode2,
  HardDrive,
  Landmark,
  Lock,
  Plus,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { CheckpointDTO } from "@/lib/weave/types";
import type { LocalAnchorDTO } from "@/lib/weave/evmext-types";
import { ANCHOR_REGISTRY_ABI, ANCHOR_REGISTRY_SOURCE } from "@/lib/weave/anchor";
import { apiFetch, errorMessage } from "../api";
import { useWeave } from "../store";
import {
  CopyButton,
  ErrorBox,
  FadeIn,
  HashChip,
  MotionCard,
  scrollBoxClass,
  TruthLabel,
  fmtDateTime,
  truncateMiddle,
} from "../shared";
import { DeployKitCard } from "../evm/deploy-kit-card";
import { LocalRegistrySection } from "../evm/local-registry-section";
import { useLocalAnchors } from "../evm/use-local-anchors";

// ── תג מקור הנתונים: ענן חי / סנדבוקס מקומי ─────────────────────────

function SourceBadge() {
  const { mode } = useWeave();
  const cloud = mode === "cloud";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="outline"
          className={cn(
            "cursor-help gap-1.5 text-[11px]",
            cloud
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
              : "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
          )}
        >
          {cloud ? (
            <Cloud className="size-3" aria-hidden="true" />
          ) : (
            <HardDrive className="size-3" aria-hidden="true" />
          )}
          {cloud ? "ענן חי · מראה ציבורית" : "סנדבוקס מקומי · מרחב טסט"}
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[280px]">
        <p className="text-xs leading-relaxed">
          {cloud
            ? "מראה ציבורית קריאה-בלבד של הספר החי - נכתבת על-ידי הסוכנים בענן ומתעדכנת אוטומטית"
            : "עותק SQLite מקומי בסנדבוקס - כאן פועלות כל פעולות הכתיבה והתרגילים"}
        </p>
      </TooltipContent>
    </Tooltip>
  );
}

export function AnchorTab() {
  const {
    mode,
    checkpoints,
    state,
    loadCheckpoints,
    reloadCheckpoints,
    loadState,
    createCheckpoint,
  } = useWeave();
  const cloud = mode === "cloud";
  const {
    slice: anchors,
    loadLazy: loadAnchors,
    reload: reloadAnchors,
  } = useLocalAnchors();

  useEffect(() => {
    loadCheckpoints();
    loadState();
    loadAnchors();
  }, [loadCheckpoints, loadState, loadAnchors]);

  const [busy, setBusy] = useState(false);
  const [anchorBusy, setAnchorBusy] = useState(false);

  const onCreate = async () => {
    setBusy(true);
    try {
      const cp = await createCheckpoint();
      toast.success(`Checkpoint #${cp.index} נוצר`, {
        description: cloud
          ? `root: ${cp.root} · נוצר בעותק הסנדבוקס המקומי`
          : `root: ${cp.root}`,
      });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  // עיגון checkpoint ברישום המקומי - "ביצוע" ה-calldata בסימולציית השרת
  const onSimulateAnchor = async (index: number) => {
    setAnchorBusy(true);
    try {
      const res = await apiFetch<{
        anchor: LocalAnchorDTO;
        checkpoint: CheckpointDTO;
      }>("/api/weave/anchor/simulate", {
        method: "POST",
        body: JSON.stringify({ index }),
      });
      toast.success(
        `Checkpoint #${index} עוגן ברישום המקומי (רישום #${res.anchor.registryIndex})`,
        {
          description: `root: ${truncateMiddle(res.anchor.root, 14, 8)}`,
        }
      );
      reloadCheckpoints();
      reloadAnchors();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setAnchorBusy(false);
    }
  };

  const list = checkpoints.data ?? [];
  const anchorsList = anchors.data ?? [];
  const networkAddress = state.data?.networkAddress ?? null;

  return (
    <FadeIn className="flex flex-col gap-4 sm:gap-6">
      {/* שורת כותרת + פעולה */}
      <section className="flex flex-wrap items-center gap-3">
        <span className="flex size-9 items-center justify-center rounded-lg border bg-muted/60 text-muted-foreground">
          <Anchor className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold tracking-tight sm:text-lg">עוגן EVM</h2>
            <SourceBadge />
          </div>
          <p className="text-xs text-muted-foreground sm:text-sm">
            {cloud
              ? "שורשי Merkle מהספר החי - חלקם עוגנו בשרשרות ציבוריות (steem, zero)"
              : "שורש Merkle לכל טווח אימותים - מוכן לרדת לשרשרת כשייפתח השער"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {networkAddress ? (
            <HashChip value={networkAddress} label="NETWORK" head={8} tail={6} />
          ) : (
            <Badge
              dir="ltr"
              className="border-zinc-500/40 bg-zinc-500/10 font-mono text-[10px] text-zinc-700 dark:text-zinc-400"
            >
              טרם נוצר
            </Badge>
          )}
          {cloud ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge
                  variant="outline"
                  className="cursor-help gap-1.5 border-amber-500/40 bg-amber-500/10 text-[11px] text-amber-700 dark:text-amber-400"
                >
                  פעולה מקומית
                </Badge>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-[280px]">
                <p className="text-xs leading-relaxed">
                  ה-checkpoint ייווצר בעותק הסנדבוקס המקומי - הענן כותב דרך סוכניו
                </p>
              </TooltipContent>
            </Tooltip>
          ) : null}
          <Button
            className="h-11 border border-emerald-500/40 bg-emerald-600 text-white hover:bg-emerald-500 dark:bg-emerald-600 dark:hover:bg-emerald-500"
            onClick={() => void onCreate()}
            disabled={busy}
          >
            <Plus />
            צור Checkpoint
          </Button>
        </div>
      </section>

      {/* רשימת checkpoints */}
      {checkpoints.loading && !checkpoints.data ? (
        <Card className="p-4 sm:p-6">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="mt-4 h-16 w-full" />
        </Card>
      ) : checkpoints.error && !checkpoints.data ? (
        <ErrorBox
          message={checkpoints.error}
          onRetry={loadCheckpoints}
          retrying={checkpoints.loading}
        />
      ) : (
        <div className={cn(scrollBoxClass, "flex flex-col gap-4 pe-1")}>
          {list.map((cp) => (
            <CheckpointCard
              key={cp.index}
              cp={cp}
              anchor={anchorsList.find((a) => a.checkpointIndex === cp.index) ?? null}
              onAnchor={onSimulateAnchor}
              anchorBusy={anchorBusy}
              mirror={cloud}
            />
          ))}
          {list.length === 0 ? (
            <Card className="flex flex-col items-center gap-2 p-8 text-center">
              <Landmark className="size-8 text-muted-foreground" />
              <p className="text-sm font-medium">אין עדיין checkpoints</p>
              <p className="text-xs text-muted-foreground">
                צור checkpoint כדי לאגד את האימותים לשורש Merkle יחיד
              </p>
            </Card>
          ) : null}
        </div>
      )}

      {/* רישום מקומי - סימולציית החוזה (EVM-2 · LOCAL) */}
      <LocalRegistrySection anchors={anchors} onReload={reloadAnchors} />

      {/* חבילת פריסה - שער EVM-1 */}
      <DeployKitCard />

      <div className="grid gap-4 lg:grid-cols-2">
        {/* מפת אמת */}
        <MotionCard className="min-w-0 p-4 sm:p-6">
          <div className="flex items-center gap-3">
            <span className="flex size-9 items-center justify-center rounded-lg border bg-muted/60 text-muted-foreground">
              <Lock className="size-4" />
            </span>
            <div>
              <h3 className="font-semibold">מפת אמת</h3>
              <p className="text-xs text-muted-foreground">
                מה רץ כאן בפועל - ומה מחכה מאחורי שער
              </p>
            </div>
          </div>
          <ul className="mt-4 flex flex-col gap-3">
            <li className="flex items-start justify-between gap-3 rounded-lg border p-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">קריפטוגרפיה</p>
                <p dir="ltr" className="mt-0.5 font-mono text-[11px] leading-relaxed text-muted-foreground">
                  keccak256 · secp256k1 · EIP-191 · EIP-712 · ecrecover · Merkle
                </p>
              </div>
              <TruthLabel kind="REAL" className="shrink-0" />
            </li>
            <li className="flex items-start justify-between gap-3 rounded-lg border p-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">קומפילציית solc</p>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                  bytecode אמיתי, keccak מתועד - קומפילציה דטרמיניסטית שנבדקה
                </p>
              </div>
              <TruthLabel kind="REAL" className="shrink-0" />
            </li>
            <li className="flex items-start justify-between gap-3 rounded-lg border p-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">אחסון הספר</p>
                <p dir="ltr" className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                  SQLite (sandbox)
                </p>
              </div>
              <TruthLabel kind="LOCAL" className="shrink-0" />
            </li>
            <li className="flex items-start justify-between gap-3 rounded-lg border p-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">רישום עוגן מקומי</p>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                  סימולציית חוזה בשרת -{" "}
                  <span dir="ltr" className="font-mono">
                    roots[++latestIndex]
                  </span>{" "}
                  ב-SQLite
                </p>
              </div>
              <TruthLabel kind="LOCAL" className="shrink-0" />
            </li>
            <li className="flex items-start justify-between gap-3 rounded-lg border p-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">עיגון on-chain</p>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                  נפתח ע&quot;י: חותם EVM ממומן + פריסת WeaveAnchorRegistry
                  (שער EVM-1). סודות לעולם לא עולים לשרשרת - רק שורשים.
                </p>
              </div>
              <TruthLabel kind="NOT-YET" className="shrink-0" />
            </li>
          </ul>
        </MotionCard>

        {/* החוזה */}
        <MotionCard className="min-w-0 p-4 sm:p-6">
          <div className="flex items-center gap-3">
            <span className="flex size-9 items-center justify-center rounded-lg border bg-muted/60 text-muted-foreground">
              <FileCode2 className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <h3 dir="ltr" className="truncate font-mono font-semibold">
                WeaveAnchorRegistry.sol
              </h3>
              <p className="text-xs text-muted-foreground">
                מינימלי, בר-ביקורת, ללא בעלות מיוחדת
              </p>
            </div>
            <CopyButton value={ANCHOR_REGISTRY_SOURCE} label="קוד החוזה" />
          </div>
          <pre
            dir="ltr"
            className={cn(
              scrollBoxClass,
              "mt-4 border bg-muted/50 p-4 font-mono text-xs leading-relaxed"
            )}
          >
            <code>{ANCHOR_REGISTRY_SOURCE}</code>
          </pre>
          <div className="mt-4">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground">ABI</p>
              <CopyButton
                value={JSON.stringify(ANCHOR_REGISTRY_ABI, null, 2)}
                label="ABI"
              />
            </div>
            <ul dir="ltr" className="mt-2 flex flex-col gap-1.5">
              {ANCHOR_REGISTRY_ABI.map((item, i) => (
                <li
                  key={i}
                  dir="ltr"
                  className="overflow-x-auto rounded border bg-muted/40 px-2 py-1.5 font-mono text-[11px] whitespace-nowrap"
                >
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </MotionCard>
      </div>
    </FadeIn>
  );
}

function CheckpointCard({
  cp,
  anchor,
  onAnchor,
  anchorBusy,
  mirror,
}: {
  cp: CheckpointDTO;
  anchor: LocalAnchorDTO | null;
  onAnchor: (index: number) => void;
  anchorBusy: boolean;
  /** מצב ענן - הרשומה מהמראה הציבורית, שדות פנימיים לא נחשפים */
  mirror: boolean;
}) {
  const anchored = cp.anchorStatus === "LOCAL-ANCHORED";
  const realAnchored = cp.anchorStatus === "ANCHORED" && !!cp.anchorTx;
  // צורת הענן: "ANCHORED (steem)" / "ANCHORED (zero+steem)" - עיגון אמיתי
  // בשרשרת ציבורית, ללא txid נחשף במראה
  const cloudAnchored = /^ANCHORED \((.+)\)$/.exec(cp.anchorStatus);
  const nets = cloudAnchored ? cloudAnchored[1].split("+") : [];
  const registryIndex = anchor?.registryIndex;

  return (
    <MotionCard className="p-4 sm:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <Badge
          dir="ltr"
          className="border-zinc-500/40 bg-zinc-500/10 font-mono text-xs text-zinc-700 dark:text-zinc-400"
        >
          #{cp.index}
        </Badge>
        <span className="text-sm font-semibold">
          טווח seq{" "}
          <span dir="ltr" className="font-mono">
            {cp.attFrom} -&gt; {cp.attTo}
          </span>
        </span>
        <Badge variant="secondary" dir="ltr" className="font-mono text-[10px]">
          {cp.leafCount} leaves
        </Badge>
        {cloudAnchored ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge
                dir="ltr"
                className="cursor-help gap-1 border-emerald-500/40 bg-emerald-500/10 font-mono text-[10px] text-emerald-700 dark:text-emerald-400"
              >
                <Anchor className="size-3" />
                ANCHORED · {nets.join(" + ")}
              </Badge>
            </TooltipTrigger>
            <TooltipContent side="top">
              <p className="max-w-xs text-xs leading-relaxed">
                ה-root עוגן בשרשרת ציבורית ({nets.join(", ")}) - פרטי הטרנזקציה
                נשמרים בספר הריבוני ואינם נחשפים במראה הציבורית
              </p>
            </TooltipContent>
          </Tooltip>
        ) : realAnchored ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <a
                href={
                  cp.anchorNet === "zero-9369" && cp.anchorTx
                    ? `https://zscan.live/tx/${cp.anchorTx}`
                    : "#"
                }
                target="_blank"
                rel="noreferrer"
                dir="ltr"
                className="cursor-help rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 font-mono text-[10px] text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-400"
              >
                ANCHORED · {cp.anchorNet ?? "chain"} · REAL
              </a>
            </TooltipTrigger>
            <TooltipContent side="top">
              <p className="max-w-xs text-xs leading-relaxed">
                {cp.anchorNet === "zero-9369"
                  ? "ה-root עוגן כטרנזקציית EVM אמיתית על Z Chain (Zero Network, chainId 9369) - רשת EVM ראשית ציבורית בגז-אפס מדוד; הטרנזקציה ממוענת-עצמית ל-EOA אינרטי עם המטען הקנוני. קישור לסייר הציבורי."
                  : "ה-root עוגן בשרשרת ציבורית - קישור לסייר."}
              </p>
            </TooltipContent>
          </Tooltip>
        ) : anchored ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge
                dir="ltr"
                className="cursor-help border-amber-500/40 bg-amber-500/10 font-mono text-[10px] text-amber-700 dark:text-amber-400"
              >
                LOCAL-ANCHORED · רישום #{registryIndex ?? "?"}
              </Badge>
            </TooltipTrigger>
            <TooltipContent side="top">
              <p className="text-xs leading-relaxed">
                {registryIndex !== undefined
                  ? "ה-root רשום בסימולציית החוזה בשרת (roots[++latestIndex]) - אותה הוכחה תאומת מול השרשרת כש-EVM-1 ייסגר"
                  : "ה-root רשום בסימולציית החוזה בשרת"}
              </p>
            </TooltipContent>
          </Tooltip>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge
                dir="ltr"
                className="cursor-help border-amber-500/40 bg-amber-500/10 font-mono text-[10px] text-amber-700 dark:text-amber-400"
              >
                LOCAL · טרם עוגן בשרשרת
              </Badge>
            </TooltipTrigger>
            <TooltipContent side="top">
              <p className="text-xs">אחסון מקומי בסנדבוקס (SQLite)</p>
            </TooltipContent>
          </Tooltip>
        )}
        <span className="text-xs text-muted-foreground sm:ms-auto">
          {fmtDateTime(cp.createdAt)}
        </span>
      </div>

      <dl className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2">
        <div className="flex flex-wrap items-center justify-between gap-2 sm:justify-start sm:gap-3">
          <dt className="text-xs text-muted-foreground">Merkle root</dt>
          <dd>
            <HashChip value={cp.root} head={8} tail={6} />
          </dd>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 sm:justify-start sm:gap-3">
          <dt className="text-xs text-muted-foreground">prevRoot</dt>
          <dd>
            {mirror && !cp.prevRoot ? (
              <span className="font-mono text-xs text-muted-foreground">(במראה)</span>
            ) : (
              <HashChip value={cp.prevRoot} head={8} tail={6} />
            )}
          </dd>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 sm:justify-start sm:gap-3">
          <dt className="text-xs text-muted-foreground">חותם הרשת</dt>
          <dd>
            {mirror && !cp.signerAddr ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="cursor-help font-mono text-xs text-muted-foreground">-</span>
                </TooltipTrigger>
                <TooltipContent side="top">
                  <p className="text-xs">
                    חותם הרשת נשמר בספר הריבוני - לא נחשף במראה
                  </p>
                </TooltipContent>
              </Tooltip>
            ) : (
              <HashChip value={cp.signerAddr} head={8} tail={6} />
            )}
          </dd>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 sm:justify-start sm:gap-3">
          <dt className="text-xs text-muted-foreground">entryHash (EIP-712)</dt>
          <dd>
            {mirror && !cp.entryHash ? (
              <span className="font-mono text-xs text-muted-foreground">(במראה)</span>
            ) : (
              <HashChip value={cp.entryHash} head={8} tail={6} />
            )}
          </dd>
        </div>
      </dl>

      {cp.calldata ? (
        <div className="mt-4 rounded-lg border bg-muted/50 p-2" dir="ltr">
          <div className="flex items-center justify-between gap-2 px-1">
            <span className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
              calldata · anchor(bytes32)
            </span>
            <CopyButton value={cp.calldata} label="calldata" className="size-6" />
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <p className="cursor-help truncate px-1 pt-1 font-mono text-[11px]">
                {cp.calldata}
              </p>
            </TooltipTrigger>
            <TooltipContent side="top" dir="ltr" className="max-w-[360px] break-all font-mono text-[10px]">
              {cp.calldata}
            </TooltipContent>
          </Tooltip>
        </div>
      ) : mirror ? (
        <div className="mt-4 rounded-lg border border-dashed bg-muted/30 px-3 py-2 text-center">
          <span className="text-[11px] text-muted-foreground">
            calldata · נשמר בספר הריבוני - לא נחשף במראה
          </span>
        </div>
      ) : null}

      {/* עיגון ברישום המקומי - ל-checkpoints שטרם עוגנו (מנגנון סנדבוקס בלבד) */}
      {!anchored && !mirror ? (
        <div className="mt-4 flex justify-end">
          <Button
            type="button"
            variant="outline"
            className="h-11 border-amber-500/40 text-amber-700 hover:bg-amber-500/10 dark:text-amber-400"
            onClick={() => onAnchor(cp.index)}
            disabled={anchorBusy}
            aria-label={`עגן checkpoint ${cp.index} ברישום המקומי`}
          >
            <Anchor />
            {anchorBusy ? "עוגן…" : "עגן ברישום המקומי"}
          </Button>
        </div>
      ) : null}
    </MotionCard>
  );
}
