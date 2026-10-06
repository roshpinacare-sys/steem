"use client";

// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · טאב 3 - סוכנים
// גריד כרטיסי זהויות EVM + רישום סוכן חדש + פס סטטיסטיקות EVM-3
// (replay protection) + אתגרי nonce ורוטציית מפתח לסוכנים פעילים
//
// שני מצבי אמת (Task 38):
//  · cloud - זהויות הסוכנים מהמראה הציבורית (כתובות וספירות אמיתיות;
//    מפתח ציבורי לא נחשף במראה ומוצג כ-placeholder מושתק). מנגנוני
//    EVM-3 פועלים על זהויות הסנדבוקס ולכן מוסתרים בענן; קישור לצי החי.
//  · local - כמו תמיד: כרטיסים מלאים + אתגר nonce + רוטציית מפתח.
// ─────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  ArrowLeft,
  CheckCircle2,
  Cloud,
  Fingerprint,
  HardDrive,
  KeyRound,
  UserPlus,
  Users,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { AgentDTO } from "@/lib/weave/types";
import { errorMessage } from "../api";
import { useWeave } from "../store";
import {
  AGENT_ROLES,
  ErrorBox,
  FadeIn,
  HashChip,
  ListSkeleton,
  MotionCard,
  RoleBadge,
  RoleIcon,
  fmtDateTime,
  truncateMiddle,
} from "../shared";
import { ChallengeDialog } from "../evm/challenge-dialog";
import { Evm3Section } from "../evm/evm3-section";
import { RotateDialog, type MechanismState } from "../evm/rotate-dialog";

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

export function AgentsTab() {
  const { mode, agents, loadAgents, registerAgent } = useWeave();
  const cloud = mode === "cloud";

  useEffect(() => {
    loadAgents();
  }, [loadAgents]);

  const [open, setOpen] = useState(false);
  // רענון פס EVM-3 אחרי כל פעילות אתגר/רוטציה/דחייה
  const [evm3Key, setEvm3Key] = useState(0);
  const bumpEvm3 = useCallback(() => setEvm3Key((k) => k + 1), []);

  const list = agents.data ?? [];

  return (
    <FadeIn className="flex flex-col gap-4 sm:gap-6">
      <section className="flex flex-wrap items-center gap-3">
        <span className="flex size-9 items-center justify-center rounded-lg border bg-muted/60 text-muted-foreground">
          <Users className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold tracking-tight sm:text-lg">
              סוכני הרשת
            </h2>
            <SourceBadge />
          </div>
          <p className="text-xs text-muted-foreground sm:text-sm">
            {cloud
              ? "זהויות הסוכנים מהמראה הציבורית - כתובות EVM וספירות אימות אמיתיות"
              : "זהויות EVM אמיתיות - secp256k1, כתובת, מפתח ציבורי"}
          </p>
        </div>
        {cloud ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-9 gap-1.5 text-emerald-700 hover:bg-emerald-500/10 hover:text-emerald-700 dark:text-emerald-400 dark:hover:bg-emerald-500/10 dark:hover:text-emerald-400"
            onClick={() => {
              window.location.hash = "#/agents/fleet";
            }}
          >
            הצי החי בענן
            <ArrowLeft className="size-4" aria-hidden="true" />
          </Button>
        ) : null}
        {cloud ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge
                variant="outline"
                className="cursor-help gap-1.5 border-amber-500/40 bg-amber-500/10 text-[11px] text-amber-700 dark:text-amber-400"
              >
                נרשם בעותק הסנדבוקס
              </Badge>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-[280px]">
              <p className="text-xs leading-relaxed">
                הסוכן החדש ייווצר בעותק הסנדבוקס המקומי - צי הענן נרשם על-ידי
                המרכז
              </p>
            </TooltipContent>
          </Tooltip>
        ) : null}
        <Button className="h-11" onClick={() => setOpen(true)}>
          <UserPlus />
          רישום סוכן חדש
        </Button>
      </section>

      {/* פס סטטיסטיקות EVM-3 - replay protection */}
      <Evm3Section refreshKey={evm3Key} />

      <Alert className="border-amber-500/40 bg-amber-500/[0.06]">
        <KeyRound className="text-amber-600 dark:text-amber-400" />
        <AlertTitle>היכן נשמר המפתח הפרטי?</AlertTitle>
        <AlertDescription className="leading-relaxed">
          בדמו ה-DEVNET המפתח הפרטי נשמר בשרת בלבד. בייצור המפתח אצל הסוכן -
          הרשת מחזיקה כתובת ומפתח ציבורי ומאמתת ב-ecrecover.
        </AlertDescription>
      </Alert>

      {agents.loading && !agents.data ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <ListSkeleton key={i} rows={1} />
          ))}
        </div>
      ) : agents.error && !agents.data ? (
        <ErrorBox message={agents.error} onRetry={loadAgents} retrying={agents.loading} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((agent) => (
            <AgentCard key={agent.id} agent={agent} onActivity={bumpEvm3} mirror={cloud} />
          ))}
          {list.length === 0 ? (
            <p className="col-span-full p-6 text-center text-sm text-muted-foreground">
              אין סוכנים רשומים
            </p>
          ) : null}
        </div>
      )}

      <RegisterAgentDialog open={open} onOpenChange={setOpen} onSubmit={registerAgent} />

      {/* הערת יושר לסיכום */}
      <p className="mt-auto text-center text-xs leading-relaxed text-muted-foreground">
        הערת יושר: המפתחות הפרטיים נשמרים בשרת לצורך ה-DEVNET בלבד - בייצור הם
        נשמרים אצל הסוכן, והרשת רואה רק חתימות שמאומתות ב-ecrecover.
      </p>
    </FadeIn>
  );
}

function AgentCard({
  agent,
  onActivity,
  mirror,
}: {
  agent: AgentDTO;
  onActivity: () => void;
  /** מצב ענן - הכרטיס מהמראה הציבורית, מנגנוני הסנדבוקס לא רלוונטיים */
  mirror: boolean;
}) {
  const [challengeOpen, setChallengeOpen] = useState(false);
  const [rotateOpen, setRotateOpen] = useState(false);
  // תוצאות זרימות EVM-3 - נשמרות לבניית ה-evidence של אימות ה-BUILD
  const [mechanism, setMechanism] = useState<MechanismState>({});
  const patchMechanism = useCallback((patch: Partial<MechanismState>) => {
    setMechanism((m) => ({ ...m, ...patch }));
  }, []);

  const active = agent.status === "ACTIVE";
  // דוקטרינה: רוטציה ב-v1 לסוכנים ללא אימותים בלבד - הכתובת בזמן החתימה
  // קפואה ב-entryHash של ההיסטוריה של הספר
  const rotateLocked = agent.attCount > 0;

  return (
    <MotionCard className="flex flex-col p-4 sm:p-6">
      <div className="flex items-start gap-3">
        <RoleIcon role={agent.role} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 dir="ltr" className="truncate font-mono text-sm font-bold sm:text-base">
              {agent.name}
            </h3>
            <RoleBadge role={agent.role} />
            {active ? (
              <Badge
                dir="ltr"
                className="gap-1 border-emerald-500/40 bg-emerald-500/10 font-mono text-[10px] text-emerald-700 dark:text-emerald-400"
              >
                <CheckCircle2 className="size-3" />
                ACTIVE
              </Badge>
            ) : (
              <Badge
                dir="ltr"
                className="border-zinc-500/40 bg-zinc-500/10 font-mono text-[10px] text-zinc-700 dark:text-zinc-400"
              >
                {agent.status}
              </Badge>
            )}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {mirror
              ? agent.createdAt
                ? `נרשם · ${fmtDateTime(agent.createdAt)}`
                : "טרם אימת בספר החי"
              : `נרשם ב-${fmtDateTime(agent.createdAt)}`}
          </p>
        </div>
      </div>

      <dl className="mt-4 flex flex-col gap-3 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <dt className="text-muted-foreground">כתובת EVM</dt>
          <dd>
            <HashChip value={agent.ethAddress} head={8} tail={6} />
          </dd>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <dt className="text-muted-foreground">מפתח ציבורי</dt>
          <dd>
            {mirror && !agent.pubKeyHex ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    dir="ltr"
                    className="cursor-help font-mono text-[11px] text-muted-foreground"
                  >
                    -
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top">
                  <p className="text-xs">
                    המפתח הציבורי נשמר בספר הריבוני - לא נחשף במראה
                  </p>
                </TooltipContent>
              </Tooltip>
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    dir="ltr"
                    className="cursor-help font-mono text-[11px] text-foreground select-all"
                  >
                    {truncateMiddle(agent.pubKeyHex, 10, 8)}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" dir="ltr" className="max-w-[360px] break-all font-mono text-[10px]">
                  {agent.pubKeyHex}
                </TooltipContent>
              </Tooltip>
            )}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-2 border-t pt-3">
          <dt className="text-muted-foreground">אימותים בספר</dt>
          <dd className="font-mono text-base font-bold tabular-nums" dir="ltr">
            {agent.attCount}
          </dd>
        </div>
      </dl>

      {/* פעולות EVM-3 - לסוכנים פעילים בלבד, על זהויות הסנדבוקס */}
      {active && !mirror ? (
        <div className="mt-4 grid grid-cols-2 gap-2 border-t pt-4">
          <Button
            variant="outline"
            className="h-11"
            onClick={() => setChallengeOpen(true)}
          >
            <Fingerprint />
            אתגר nonce
          </Button>
          {rotateLocked ? (
            <Tooltip>
              <TooltipTrigger asChild>
                {/* עטיפה - כדי ש-tooltip יעבוד גם על כפתור מושבת */}
                <span className="inline-flex w-full">
                  <Button variant="outline" className="h-11 w-full" disabled>
                    <KeyRound />
                    רוטציית מפתח
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-[280px]">
                <p className="text-xs leading-relaxed">
                  רוטציה ב-v1 לסוכנים ללא אימותים - הכתובת בזמן החתימה קפואה
                  ב-entryHash של ההיסטוריה
                </p>
              </TooltipContent>
            </Tooltip>
          ) : (
            <Button variant="outline" className="h-11" onClick={() => setRotateOpen(true)}>
              <KeyRound />
              רוטציית מפתח
            </Button>
          )}
        </div>
      ) : null}

      <ChallengeDialog
        agent={agent}
        open={challengeOpen}
        onOpenChange={setChallengeOpen}
        onVerified={(nonce) => patchMechanism({ challengeNonce: nonce, challengeVerified: true })}
        onReplayRejected={() => patchMechanism({ replayRejected: true })}
        onActivity={onActivity}
      />
      <RotateDialog
        agent={agent}
        open={rotateOpen}
        onOpenChange={setRotateOpen}
        mechanism={mechanism}
        onMechanism={patchMechanism}
        onActivity={onActivity}
      />
    </MotionCard>
  );
}

function RegisterAgentDialog({
  open,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: { name: string; role: string }) => Promise<AgentDTO>;
}) {
  const { mode } = useWeave();
  const [name, setName] = useState("");
  const [role, setRole] = useState<string>("SCOUT");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName("");
      setRole("SCOUT");
      setError(null);
    }
  }, [open]);

  const submit = async () => {
    if (!name.trim()) {
      setError("שם הסוכן ריק");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const agent = await onSubmit({ name: name.trim(), role });
      toast.success(`הסוכן ${agent.name} נרשם ברשת`, {
        description:
          mode === "cloud"
            ? `כתובת EVM: ${agent.ethAddress} · נרשם בעותק הסנדבוקס המקומי`
            : `כתובת EVM: ${agent.ethAddress}`,
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="sm:max-w-md">
        <DialogHeader className="text-right sm:text-right">
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="size-5 text-emerald-500" />
            רישום סוכן חדש
          </DialogTitle>
          <DialogDescription>
            תיווצר זהות EVM (secp256k1). המפתח הפרטי נשמר בשרת לצורך הדמו ואינו
            חוזר לעולם בתשובה.
            {mode === "cloud"
              ? " במצב ענן הרישום מבוצע לעותק הסנדבוקס המקומי."
              : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="agent-name">שם הסוכן</Label>
            <Input
              id="agent-name"
              className="h-11"
              dir="ltr"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="למשל: weave-auditor-2"
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="agent-role">תפקיד</Label>
            <Select dir="rtl" value={role} onValueChange={setRole}>
              <SelectTrigger id="agent-role" className="h-11 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AGENT_ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    <span className="flex items-center gap-2">
                      <span dir="ltr" className="font-mono">
                        {r}
                      </span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {error ? (
            <p className="rounded-md border border-rose-500/40 bg-rose-500/10 p-2.5 text-xs text-rose-700 dark:text-rose-300">
              {error}
            </p>
          ) : null}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" className="h-11" onClick={() => onOpenChange(false)} disabled={busy}>
            ביטול
          </Button>
          <Button className="h-11" onClick={() => void submit()} disabled={busy}>
            {busy ? "מייצר זהות…" : "רשום סוכן"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
