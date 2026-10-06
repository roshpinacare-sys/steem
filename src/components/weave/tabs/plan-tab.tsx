"use client";

// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · טאב 6 - תוכנית ופרוטוקול
// לוח שלבים L/R/EVM + סגירת שלב באימות VERIFIED + הפרוטוקול
// הדגמת מפתח: R2 (ROTATION) - אימות 5 הוא UNMEASURED ולא יסגור שער
// ─────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  BadgeCheck,
  CheckCircle2,
  CircleDashed,
  Link2,
  Map as MapIcon,
  ScrollText,
  ShieldQuestion,
  Workflow,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { AttestationDTO, StageDTO } from "@/lib/weave/types";
import { errorMessage } from "../api";
import { useWeave } from "../store";
import {
  ClaimTypeBadge,
  ErrorBox,
  FadeIn,
  MotionCard,
  StatusBadge,
  truncateEnd,
} from "../shared";

const PRINCIPLES: string[] = [
  "טענה ללא מדידה = רעש. השרת קובע סטטוס, לא הלקוח.",
  "כל טענה נחתמת במפתח EVM של הסוכן (EIP-191) ושוחזרה ב-ecrecover.",
  "אימות = חישוב מחדש של כל השרשרת, לא סמיכות על אף צומת.",
  "שלב בתוכנית נסגר רק ע\"י אימות VERIFIED מסוג השער.",
  "סודות לעולם לא עולים לשרשרת - רק שורשים (roots) והוכחות (proofs).",
  "תווית אמת מוצהרת תמיד: REAL / LOCAL / NOT-YET.",
];

const CHAIN_RULES: { term: string; description: string }[] = [
  {
    term: "GENESIS",
    description: "prevHash של רשומה 1 - 0x00..00 (32 בתים אפס)",
  },
  {
    term: "entryHash",
    description: "keccak256(רשומה קנונית) - סדר מפתחות קבוע",
  },
  {
    term: "prevHash",
    description: "כל רשומה מקשרת לקודמת - hash-chained",
  },
  {
    term: "Merkle root",
    description: "נבנה מ-entryHash של הטווח, לכל checkpoint",
  },
  {
    term: "EIP-712 domain",
    description: "chainId=31337 - devnet מתועד",
  },
];

export function PlanTab() {
  const { stages, attestations, loadStages, loadAttestations, closeStage } =
    useWeave();

  useEffect(() => {
    loadStages();
    loadAttestations();
  }, [loadStages, loadAttestations]);

  const [stageToClose, setStageToClose] = useState<StageDTO | null>(null);

  const groups = useMemo(() => {
    const all = stages.data ?? [];
    return [
      {
        key: "L",
        title: "הסמכה L0-L4",
        description: "הסמכה הדרגתית של הסוכן - מביקורת ועד אוטונומיה מגודרת",
        stages: all.filter((s) => s.code.startsWith("L")),
      },
      {
        key: "R",
        title: "ארגון הרשת R",
        description: "ארגון האקוסיסטם, הכספת והמלאי - מיזוג וניקוי מדודים",
        stages: all.filter((s) => s.code.startsWith("R")),
      },
      {
        key: "EVM",
        title: "EVM",
        description: "עיגון בשרשרת אמיתית והגנות replay",
        stages: all.filter((s) => s.code.startsWith("EVM")),
      },
      {
        key: "SOV",
        title: "ריבונות SOV",
        description:
          "סולם הריבונות - בית בגיט, לב-ענן, איחול-עצמי; נסגרים בפעימות חתומות",
        stages: all.filter((s) => s.code.startsWith("SOV")),
      },
    ];
  }, [stages.data]);

  return (
    <FadeIn className="flex flex-col gap-4 sm:gap-6">
      <section className="flex items-center gap-3">
        <span className="flex size-9 items-center justify-center rounded-lg border bg-muted/60 text-muted-foreground">
          <MapIcon className="size-4" />
        </span>
        <div className="flex-1">
          <h2 className="text-base font-semibold tracking-tight sm:text-lg">
            לוח התוכנית
          </h2>
          <p className="text-xs text-muted-foreground sm:text-sm">
            שלב נסגר רק ע&quot;י אימות VERIFIED מסוג השער - לא בהצהרה
          </p>
        </div>
      </section>

      {stages.error && !stages.data ? (
        <ErrorBox message={stages.error} onRetry={loadStages} retrying={stages.loading} />
      ) : null}

      {stages.loading && !stages.data ? (
        <div className="flex flex-col gap-6">
          {Array.from({ length: 3 }).map((_, g) => (
            <div key={g} className="flex flex-col gap-3">
              <Skeleton className="h-5 w-40" />
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Card key={i} className="p-4">
                    <Skeleton className="h-5 w-24" />
                    <Skeleton className="mt-3 h-4 w-full" />
                    <Skeleton className="mt-2 h-4 w-2/3" />
                    <Skeleton className="mt-4 h-9 w-36" />
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        groups.map((group) => (
          <section key={group.key} className="flex flex-col gap-3">
            <div className="flex items-center gap-3 border-b pb-2">
              <Workflow className="size-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold">{group.title}</h3>
              <span className="hidden text-xs text-muted-foreground sm:inline">
                · {group.description}
              </span>
              <Badge variant="secondary" className="ms-auto font-mono text-[10px]" dir="ltr">
                {group.stages.length}
              </Badge>
            </div>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {group.stages.map((stage) => (
                <StageCard key={stage.id} stage={stage} onClose={() => setStageToClose(stage)} />
              ))}
            </div>
          </section>
        ))
      )}

      {/* פרוטוקול + כללי שרשרת */}
      <div className="grid gap-4 lg:grid-cols-5">
        <MotionCard className="p-4 sm:p-6 lg:col-span-3">
          <div className="flex items-center gap-3">
            <span className="flex size-9 items-center justify-center rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <ScrollText className="size-4" />
            </span>
            <div>
              <h3 className="font-semibold">פרוטוקול THE WEAVE v1</h3>
              <p className="text-xs text-muted-foreground">ששת העקרונות שמנחים כל שורה בספר</p>
            </div>
          </div>
          <ol className="mt-4 flex flex-col gap-3">
            {PRINCIPLES.map((p, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-emerald-500/40 bg-emerald-500/10 font-mono text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                  {i + 1}
                </span>
                <p className="text-sm leading-relaxed">{p}</p>
              </li>
            ))}
          </ol>
        </MotionCard>

        <MotionCard className="p-4 sm:p-6 lg:col-span-2">
          <div className="flex items-center gap-3">
            <span className="flex size-9 items-center justify-center rounded-lg border bg-muted/60 text-muted-foreground">
              <Link2 className="size-4" />
            </span>
            <div>
              <h3 className="font-semibold">כללי השרשרת</h3>
              <p className="text-xs text-muted-foreground">קנון ה-hash - מ-GENESIS ועד ה-head</p>
            </div>
          </div>
          <dl className="mt-4 flex flex-col gap-3">
            {CHAIN_RULES.map((rule) => (
              <div key={rule.term} className="flex items-start gap-3 rounded-lg border p-2.5">
                <dt dir="ltr" className="shrink-0 font-mono text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                  {rule.term}
                </dt>
                <dd className="text-xs leading-relaxed text-muted-foreground">
                  {rule.description}
                </dd>
              </div>
            ))}
          </dl>
        </MotionCard>
      </div>

      {/* דיאלוג סגירת שלב */}
      {stageToClose ? (
        <CloseStageDialog
          stage={stageToClose}
          attestations={attestations.data ?? []}
          onOpenChange={(open) => {
            if (!open) setStageToClose(null);
          }}
          onClose={closeStage}
        />
      ) : null}
    </FadeIn>
  );
}

// ── כרטיס שלב ────────────────────────────────────────────────────────

function StageCard({ stage, onClose }: { stage: StageDTO; onClose: () => void }) {
  const done = stage.state === "DONE";
  return (
    <MotionCard className="flex flex-col gap-3 p-4 sm:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <Badge
          dir="ltr"
          className={cn(
            "font-mono text-xs",
            done
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
              : "border-zinc-500/40 bg-zinc-500/10 text-zinc-700 dark:text-zinc-400"
          )}
        >
          {stage.code}
        </Badge>
        <span dir="ltr" className="font-mono text-sm font-semibold">
          {stage.title}
        </span>
        <StageStateBadge state={stage.state} className="ms-auto" />
      </div>

      <p className="text-xs leading-relaxed text-muted-foreground">{stage.detail}</p>

      <div className="rounded-lg border bg-muted/40 p-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">שער:</span>
          <span className="text-xs font-medium">{stage.gate}</span>
          <ClaimTypeBadge type={stage.gateType} className="ms-auto" />
        </div>
      </div>

      {done && stage.attSeq !== null ? (
        <p className="flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="size-4 shrink-0" />
          נסגר באימות #{stage.attSeq}
        </p>
      ) : null}

      {!done ? (
        <Button variant="outline" size="sm" className="mt-auto h-11 w-full" onClick={onClose}>
          <BadgeCheck />
          סגור שלב באימות
        </Button>
      ) : (
        <div className="mt-auto" />
      )}
    </MotionCard>
  );
}

function StageStateBadge({ state, className }: { state: string; className?: string }) {
  if (state === "DONE") {
    return (
      <Badge dir="ltr" className={cn("gap-1 border-emerald-500/40 bg-emerald-500/10 font-mono text-[10px] text-emerald-700 dark:text-emerald-400", className)}>
        <CheckCircle2 className="size-3" />
        DONE
      </Badge>
    );
  }
  if (state === "IN_PROGRESS") {
    return (
      <Badge dir="ltr" className={cn("gap-1 border-amber-500/40 bg-amber-500/10 font-mono text-[10px] text-amber-700 dark:text-amber-400", className)}>
        <CircleDashed className="size-3" />
        IN_PROGRESS
      </Badge>
    );
  }
  return (
    <Badge dir="ltr" className={cn("border-zinc-500/40 bg-zinc-500/10 font-mono text-[10px] text-zinc-700 dark:text-zinc-400", className)}>
      PLANNED
    </Badge>
  );
}

// ── דיאלוג סגירת שלב ─────────────────────────────────────────────────

function CloseStageDialog({
  stage,
  attestations,
  onOpenChange,
  onClose,
}: {
  stage: StageDTO;
  attestations: AttestationDTO[];
  onOpenChange: (open: boolean) => void;
  onClose: (input: { code: string; attestationSeq: number }) => Promise<StageDTO>;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // הצעות תקינות: VERIFIED מסוג השער בלבד
  const eligible = attestations.filter(
    (a) => a.status === "VERIFIED" && a.claimType === stage.gateType
  );
  // אימותים מסוג השער שאינם VERIFIED - להדגמה שהשרת הוא הסמכות
  const nonVerified = attestations.filter(
    (a) => a.status !== "VERIFIED" && a.claimType === stage.gateType
  );

  const submit = async () => {
    if (selected === null) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await onClose({ code: stage.code, attestationSeq: selected });
      toast.success(`שלב ${updated.code} נסגר באימות #${updated.attSeq}`, {
        description: "השער נבדק מול הספר - רק אימות VERIFIED סוגר שלב",
      });
      onOpenChange(false);
    } catch (err) {
      const msg = errorMessage(err);
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="sm:max-w-lg">
        <DialogHeader className="text-right sm:text-right">
          <DialogTitle className="flex flex-wrap items-center gap-2">
            סגירת שלב
            <Badge dir="ltr" className="font-mono text-xs">
              {stage.code}
            </Badge>
            <ClaimTypeBadge type={stage.gateType} />
          </DialogTitle>
          <DialogDescription>
            השער: {stage.gate} - נדרש אימות VERIFIED מסוג{" "}
            <span dir="ltr" className="font-mono">
              {stage.gateType}
            </span>
            .
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {eligible.length > 0 ? (
            <RadioGroup
              value={selected !== null ? String(selected) : undefined}
              onValueChange={(v) => setSelected(Number(v))}
              className="flex flex-col gap-2"
            >
              {eligible.map((a) => (
                <label
                  key={a.seq}
                  className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-accent/50 has-[[data-state=checked]]:border-emerald-500/50"
                >
                  <RadioGroupItem value={String(a.seq)} className="mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span dir="ltr" className="font-mono text-xs font-semibold text-muted-foreground">
                        #{a.seq}
                      </span>
                      <StatusBadge status={String(a.status)} className="text-[10px]" />
                    </div>
                    <p className="mt-1 text-xs leading-relaxed">{a.claim}</p>
                  </div>
                </label>
              ))}
            </RadioGroup>
          ) : (
            <Alert className="border-amber-500/40 bg-amber-500/[0.06]">
              <AlertTriangle className="text-amber-600 dark:text-amber-400" />
              <AlertTitle>השער נשאר סגור</AlertTitle>
              <AlertDescription>
                אין אימות VERIFIED מתאים - השער נשאר סגור. צור אימות{" "}
                <span dir="ltr" className="font-mono">
                  {stage.gateType}
                </span>{" "}
                עם מדידה (ראיה לא ריקה) ואז חזור לכאן.
              </AlertDescription>
            </Alert>
          )}

          {nonVerified.length > 0 ? (
            <div className="rounded-lg border border-dashed p-3">
              <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <ShieldQuestion className="size-3.5" />
                אימותים מסוג השער שאינם VERIFIED - נסה בכל זאת (השרת יקבע):
              </p>
              <RadioGroup
                value={selected !== null ? String(selected) : undefined}
                onValueChange={(v) => setSelected(Number(v))}
                className="mt-2 flex flex-col gap-1.5"
              >
                {nonVerified.map((a) => (
                  <label
                    key={a.seq}
                    className="flex cursor-pointer items-start gap-3 rounded-lg border border-dashed p-2.5 transition-colors hover:bg-accent/40 has-[[data-state=checked]]:border-amber-500/60"
                  >
                    <RadioGroupItem value={String(a.seq)} className="mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span dir="ltr" className="font-mono text-xs font-semibold text-muted-foreground">
                          #{a.seq}
                        </span>
                        <StatusBadge status={String(a.status)} className="text-[10px]" />
                      </div>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <p className="mt-1 truncate text-xs text-muted-foreground">
                            {a.claim}
                          </p>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-[320px]">
                          <p className="text-xs leading-relaxed">
                            {truncateEnd(a.claim, 200)}
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  </label>
                ))}
              </RadioGroup>
            </div>
          ) : null}

          {error ? (
            <p className="rounded-md border border-rose-500/40 bg-rose-500/10 p-2.5 text-xs leading-relaxed text-rose-700 dark:text-rose-300">
              {error}
            </p>
          ) : null}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" className="h-11" onClick={() => onOpenChange(false)} disabled={busy}>
            ביטול
          </Button>
          <Button
            className="h-11"
            onClick={() => void submit()}
            disabled={selected === null || busy}
          >
            {busy ? "סוגר שלב…" : "סגור שלב"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
