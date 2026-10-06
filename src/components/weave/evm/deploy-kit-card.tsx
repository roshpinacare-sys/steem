"use client";

// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · חבילת פריסה · שער EVM-1 (הכנה):
// artifact שנוצר בקומפילציית solc אמיתית: bytecode, keccak מתועד,
// בדיקות אינטגריציות ו-checklist אמת. מה שחסר לפריסה בפועל מסומן
// בכנות כ-NOT-YET. תווית אמת: REAL - קומפילציה מקומית.
// ─────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from "react";
import { Package, ShieldAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { DeployKitDTO } from "@/lib/weave/evmext-types";
import { apiFetch, errorMessage } from "../api";
import { ErrorBox, HashChip, MotionCard, TruthLabel, fmtDateTime } from "../shared";
import { CheckRow, LabeledCopyButton } from "./bits";

interface KitState {
  data: DeployKitDTO | null;
  loading: boolean;
  error: string | null;
}

export function DeployKitCard() {
  const [kit, setKit] = useState<KitState>({ data: null, loading: false, error: null });
  const inFlightRef = useRef(false);

  const load = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setKit((s) => ({ ...s, loading: true, error: null }));
    try {
      const res = await apiFetch<{ kit: DeployKitDTO }>("/api/weave/deploy-kit");
      setKit({ data: res.kit, loading: false, error: null });
    } catch (err) {
      setKit({ data: null, loading: false, error: errorMessage(err) });
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (kit.loading && !kit.data) {
    return (
      <Card className="p-4 sm:p-6">
        <Skeleton className="h-6 w-52" />
        <Skeleton className="mt-2 h-4 w-72" />
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-5 w-full" />
          ))}
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          <Skeleton className="h-8 w-44" />
          <Skeleton className="h-8 w-52" />
          <Skeleton className="h-8 w-56" />
        </div>
        <Skeleton className="mt-5 h-20 w-full" />
      </Card>
    );
  }

  if (kit.error && !kit.data) {
    return <ErrorBox message={kit.error} onRetry={() => void load()} retrying={kit.loading} />;
  }

  const k = kit.data;
  if (!k) return null;

  const optimizer = k.optimizer.enabled
    ? `enabled · runs=${k.optimizer.runs}`
    : "disabled";

  return (
    <MotionCard className="p-4 sm:p-6">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
          <Package className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold">חבילת פריסה · שער EVM-1</h3>
            <Badge
              dir="ltr"
              className="gap-1 border-emerald-500/40 bg-emerald-500/10 font-mono text-[10px] text-emerald-700 dark:text-emerald-400"
            >
              REAL - קומפילציה מקומית
            </Badge>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            <span dir="ltr" className="font-mono">
              {k.contractName}
            </span>{" "}
            - מוכן לפריסה: bytecode, ABI, keccak מתועד ונתוני tx. מה שחסר
            (חותם ממומן, RPC) מסומן בכנות כ-NOT-YET.
          </p>
        </div>
      </div>

      {/* נתוני קומפילציה */}
      <dl className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2">
        <div className="flex flex-wrap items-center justify-between gap-2 sm:justify-start sm:gap-3">
          <dt className="text-xs text-muted-foreground">קומפילטור</dt>
          <dd dir="ltr" className="font-mono text-xs font-medium">
            {k.compiler}
          </dd>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 sm:justify-start sm:gap-3">
          <dt className="text-xs text-muted-foreground">EVM target</dt>
          <dd dir="ltr" className="font-mono text-xs font-medium">
            {k.evmVersion}
          </dd>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 sm:justify-start sm:gap-3">
          <dt className="text-xs text-muted-foreground">Optimizer</dt>
          <dd dir="ltr" className="font-mono text-xs font-medium">
            {optimizer}
          </dd>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 sm:justify-start sm:gap-3">
          <dt className="text-xs text-muted-foreground">הודר ב</dt>
          <dd className="text-xs font-medium">{fmtDateTime(k.compiledAt)}</dd>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 sm:justify-start sm:gap-3 sm:col-span-2">
          <dt className="text-xs text-muted-foreground">codeDeposit gas</dt>
          <dd className="flex flex-wrap items-center gap-2">
            <span dir="ltr" className="font-mono text-xs font-medium tabular-nums">
              {k.codeDepositGas !== null ? `${k.codeDepositGas.toLocaleString("en-US")} gas` : "-"}
            </span>
            <span className="text-[11px] text-muted-foreground">
              אומדן קומפילטור - לא מדידת רשת
            </span>
          </dd>
        </div>
      </dl>

      {/* keccak chips */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <HashChip value={k.bytecodeKeccak} label="bytecode keccak" head={8} tail={6} />
        <HashChip value={k.deployedBytecodeKeccak} label="runtime keccak" head={8} tail={6} />
        <HashChip value={k.sourceKeccak} label="source keccak" head={8} tail={6} />
      </div>

      {/* בדיקות אינטגריציות */}
      <ul className="mt-4 flex flex-col gap-2">
        <CheckRow
          ok={k.deterministicRecompileMatch}
          label="קומפילציה דטרמיניסטית"
          hint="קומפילציה כפולה - אותו bytecode יצא פעמיים"
        />
        <CheckRow
          ok={k.runtimeEmbeddedInCreation}
          label="ה-runtime מוטמע ב-bytecode הפריסה"
          hint="מה שיישמר בשרשרת אחרי הפריסה הוא בדיוק ה-runtime שכאן"
        />
        <CheckRow
          ok={k.sourceMatch}
          label="ה-artifact תואם למקור המוצג"
          hint="artifact.source === WeaveAnchorRegistry.sol שבטאב זה"
        />
      </ul>

      {!k.sourceMatch ? (
        <Alert variant="destructive" className="mt-3">
          <ShieldAlert />
          <AlertTitle>חוסר התאמה בין ה-artifact למקור</AlertTitle>
          <AlertDescription>
            הרץ{" "}
            <span dir="ltr" className="font-mono text-xs">
              bun scripts/compile-anchor.ts
            </span>{" "}
            מחדש ואז רענן - ה-bytecode חייב להיות מכפיל של המקור המוצג.
          </AlertDescription>
        </Alert>
      ) : null}

      {/* כפתורי העתקה */}
      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <LabeledCopyButton value={k.bytecode} label="העתק Bytecode" />
        <LabeledCopyButton value={k.abiJson} label="העתק ABI" />
      </div>

      {/* checklist אמת */}
      <div className="mt-5 border-t pt-4">
        <p className="text-xs font-semibold tracking-wide text-muted-foreground">
          Checklist לסגירת שער EVM-1
        </p>
        <ul className="mt-2 flex flex-col gap-2">
          {k.checklist.map((item, i) => (
            <li
              key={i}
              className={cn(
                "flex flex-wrap items-start justify-between gap-2 rounded-lg border p-3",
                item.truth === "REAL" && "border-emerald-500/25",
                item.truth === "NOT-YET" && "border-zinc-500/25 bg-muted/30",
                item.truth === "LOCAL" && "border-amber-500/30"
              )}
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium leading-snug">{item.label}</p>
                {item.note ? (
                  <p className="mt-0.5 break-words text-xs leading-relaxed text-muted-foreground">
                    {item.note}
                  </p>
                ) : null}
              </div>
              <TruthLabel kind={item.truth} className="shrink-0" />
            </li>
          ))}
        </ul>
      </div>

      {/* הערות */}
      {k.notes.length > 0 ? (
        <div className="mt-4 border-t pt-3">
          <ul className="flex flex-col gap-1.5">
            {k.notes.map((note, i) => (
              <li key={i} className="text-[11px] leading-relaxed text-muted-foreground">
                · {note}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* רענון שקט */}
      <div className="mt-3 flex justify-end">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-9 text-muted-foreground"
          onClick={() => void load()}
          disabled={kit.loading}
          aria-label="רענן חבילת פריסה"
        >
          רענן
        </Button>
      </div>
    </MotionCard>
  );
}
