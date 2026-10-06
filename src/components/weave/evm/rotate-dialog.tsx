"use client";

// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · רוטציית מפתח (EVM-3) - הסמכה חתומה EIP-712 עם nonce:
// המפתח הישן מסמיך את ההעברה לכתובת החדשה, ה-nonce נצרך, והפעולה
// מתועדת ב-KeyOp. לאחר מכן: הדגמת דחיית המפתח המשוך (replay-demo)
// ותיעוד המנגנון בספר באימות BUILD - לקראת סגירת שער EVM-3.
// ─────────────────────────────────────────────────────────────────────

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, Ban, BookCheck, KeyRound, ShieldAlert } from "lucide-react";
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
import type { AgentDTO } from "@/lib/weave/types";
import type {
  Evm3StatsDTO,
  KeyOpDTO,
  ReplayDemoDTO,
} from "@/lib/weave/evmext-types";
import { apiFetch, errorMessage } from "../api";
import { useWeave } from "../store";
import { HashChip, truncateMiddle } from "../shared";
import { CheckRow } from "./bits";

// ── מצב מנגנון משותף לזרימות ההדגמה (אתגר + רוטציה) ────────────────
// נשמר ברמת כרטיס הסוכן כדי לבנות את ה-evidence של אימות ה-BUILD
// מתוצאות הצעדים שבוצעו בפועל בסשן זה. הדיאלוג מציג את המצב הזה
// ישירות - סגירה ופתיחה שומרות על רציפות ההדגמה.

export interface MechanismState {
  challengeNonce?: number;
  challengeVerified?: boolean;
  replayRejected?: boolean;
  op?: KeyOpDTO;
  replayDemo?: ReplayDemoDTO;
}

const BUILD_CLAIM =
  "EVM-3 replay-protection לזהויות סוכנים אומת ב-DEVNET: אתגרי nonce חד-פעמיים, רוטציה חתומה EIP-712 עם nonce, ודחיית מפתח משוך";

const short = (v: string) => truncateMiddle(v, 10, 6);

export function RotateDialog({
  agent,
  open,
  onOpenChange,
  mechanism,
  onMechanism,
  onActivity,
}: {
  agent: AgentDTO;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mechanism: MechanismState;
  onMechanism: (patch: Partial<MechanismState>) => void;
  onActivity: () => void;
}) {
  const { attest, reloadAgents } = useWeave();

  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [demoBusy, setDemoBusy] = useState(false);
  const [attestBusy, setAttestBusy] = useState(false);

  const op = mechanism.op ?? null;
  const replayDemo = mechanism.replayDemo ?? null;

  useEffect(() => {
    if (open) {
      setNote("");
      setError(null);
    }
  }, [open]);

  const onRotate = async () => {
    setBusy(true);
    setError(null);
    try {
      const body: { agentId: string; note?: string } = { agentId: agent.id };
      const trimmed = note.trim();
      if (trimmed) body.note = trimmed;
      const res = await apiFetch<{ op: KeyOpDTO; agent: AgentDTO }>(
        "/api/agents/rotate",
        { method: "POST", body: JSON.stringify(body) }
      );
      onMechanism({ op: res.op });
      onActivity();
      reloadAgents();
      toast.success(`המפתח של ${agent.name} הוחלף - op nonce ${res.op.nonce}`, {
        description: `old ${short(res.op.oldAddress)} -> new ${short(res.op.newAddress)}`,
      });
    } catch (err) {
      const msg = errorMessage(err);
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  const onReplayDemo = async () => {
    setDemoBusy(true);
    try {
      const res = await apiFetch<{ result: ReplayDemoDTO }>(
        "/api/agents/rotate/replay-demo",
        { method: "POST", body: JSON.stringify({ agentId: agent.id }) }
      );
      onMechanism({ replayDemo: res.result });
      onActivity();
      toast.success("הדגמת הדחייה עברה - המפתח המשוך נדחה", {
        description:
          "attempted ≠ active: החתימה תקינה קריפטוגרפית, אך הזהות שלולה",
      });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setDemoBusy(false);
    }
  };

  // ── בניית evidence מתוצאות הצעדים שנשמרו בסשן ────────────────────
  const buildEvidence = async (): Promise<string> => {
    const { stats } = await apiFetch<{ stats: Evm3StatsDTO }>("/api/weave/evm3");
    const parts: string[] = [];

    parts.push(
      mechanism.challengeVerified && mechanism.challengeNonce !== undefined
        ? `challenge nonce=${mechanism.challengeNonce} נצרך ואומת (ecrecover)`
        : "challenge: טרם בוצע בסשן זה"
    );
    parts.push(
      mechanism.replayRejected
        ? "replay של אותה חתימה נדחה (409)"
        : "replay: טרם הודגם בסשן זה"
    );
    if (op) {
      parts.push(
        `rotation op digest=${short(op.digest)} nonce=${op.nonce} old=${short(op.oldAddress)}->new=${short(op.newAddress)}`
      );
    }
    if (replayDemo) {
      parts.push(
        `מפתח ישן נדחה: attempted=${short(replayDemo.attemptedAddress)} ≠ active=${short(replayDemo.activeAddress)}`
      );
    }
    parts.push(
      `מדידות: challenges=${stats.challengesVerified}, replaysBlocked=${stats.replaysBlocked}, rotations=${stats.rotations} (${stats.counterScope})`
    );
    return parts.join("; ");
  };

  const onAttest = async () => {
    if (!op) return;
    setAttestBusy(true);
    try {
      const evidence = await buildEvidence();
      await attest({
        agentId: agent.id,
        claimType: "BUILD",
        claim: BUILD_CLAIM,
        evidence,
      });
      // אימות ראשון של הסוכן - attCount עולה ורוטציה ננעלת מעתה (דוקטרינה)
      reloadAgents();
      toast.success(
        "נרשם בספר - כעת סגור את שער EVM-3 בלשונית 'תוכנית ופרוטוקול'",
        {
          description: "אימות BUILD חתום EIP-191 נוסף לשרשרת",
        }
      );
      onOpenChange(false);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setAttestBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="sm:max-w-lg">
        <DialogHeader className="text-right sm:text-right">
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <KeyRound className="size-5 text-rose-500" />
            רוטציית מפתח
            <Badge dir="ltr" className="font-mono text-xs">
              {agent.name}
            </Badge>
          </DialogTitle>
          <DialogDescription>
            הסמכה חתומה EIP-712 עם nonce - המפתח הישן מסמיך את ההעברה, ואז נשלל.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {!op ? (
            <>
              <Alert variant="destructive">
                <ShieldAlert />
                <AlertTitle>פעולה בלתי הפיכה</AlertTitle>
                <AlertDescription className="leading-relaxed">
                  הזהות תוחלף סופית: כתובת חדשה, מפתח חדש; המפתח הישן יישלל
                  וחתימותיו יידחו מעתה.
                </AlertDescription>
              </Alert>

              <div className="flex flex-col gap-2">
                <Label htmlFor="rotate-note" className="text-xs text-muted-foreground">
                  הערה (אופציונלי - תתועד ב-op)
                </Label>
                <Input
                  id="rotate-note"
                  className="h-11"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="למשל: רוטציה תזמונית בהדגמת EVM-3"
                  disabled={busy}
                />
              </div>

              {error ? (
                <p className="rounded-md border border-rose-500/40 bg-rose-500/10 p-2.5 text-xs leading-relaxed text-rose-700 dark:text-rose-300">
                  {error}
                </p>
              ) : null}

              <Button
                type="button"
                className="h-11 border border-rose-500/40 bg-rose-600 text-white hover:bg-rose-500 dark:bg-rose-600 dark:hover:bg-rose-500"
                onClick={() => void onRotate()}
                disabled={busy}
              >
                <KeyRound />
                {busy ? "מסובב מפתח…" : "בצע רוטציה"}
              </Button>
            </>
          ) : (
            <>
              {/* פאנל תוצאה */}
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/[0.04] p-3 sm:p-4">
                <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                  הרוטציה בוצעה - הסמכה חתומה במפתח הישן
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <HashChip value={op.oldAddress} label="old" head={8} tail={6} />
                  <ArrowLeft
                    className="size-4 shrink-0 text-muted-foreground"
                    aria-label="הוחלף ל"
                  />
                  <HashChip value={op.newAddress} label="new" head={8} tail={6} />
                </div>
                <dl className="mt-3 flex flex-col gap-2 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <dt className="text-muted-foreground">op nonce</dt>
                    <dd dir="ltr" className="font-mono font-medium tabular-nums">
                      {op.nonce}
                    </dd>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <dt className="text-muted-foreground">digest (EIP-712)</dt>
                    <dd>
                      <HashChip value={op.digest} head={8} tail={6} />
                    </dd>
                  </div>
                  {op.note ? (
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <dt className="text-muted-foreground">הערה</dt>
                      <dd className="max-w-full truncate">{op.note}</dd>
                    </div>
                  ) : null}
                </dl>
                <ul className="mt-3">
                  <CheckRow
                    ok={op.recovered === op.oldAddress}
                    label="recovered === oldAddress"
                    hint={
                      <span className="inline-flex flex-wrap items-center gap-1.5">
                        ecrecover שחזר את הכתובת הישנה מהחתימה - ההסמכה אמיתית:{" "}
                        <HashChip value={op.recovered} head={8} tail={6} copy={false} />
                      </span>
                    }
                  />
                </ul>
              </div>

              {/* שני כפתורי המשך */}
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 border-rose-500/40 text-rose-600 hover:bg-rose-500/10 dark:text-rose-400"
                  onClick={() => void onReplayDemo()}
                  disabled={demoBusy}
                >
                  <Ban />
                  {demoBusy ? "מנסה לחתום…" : "הדגם: חתימה במפתח הישן"}
                </Button>
                <Button
                  type="button"
                  className="h-11"
                  onClick={() => void onAttest()}
                  disabled={attestBusy}
                >
                  <BookCheck />
                  {attestBusy ? "תועד…" : "תעד מנגנון בספר (BUILD)"}
                </Button>
              </div>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                ה-evidence ייבנה אוטומטית מתוצאות הצעדים שבוצעו בסשן זה (אתגר,
                replay, רוטציה, דחיית מפתח) ומהמדידות החיות מהשרת.
              </p>

              {/* פאנל דחיית מפתח ישן */}
              {replayDemo ? (
                <div className="rounded-lg border border-rose-500/40 bg-rose-500/[0.06] p-3 sm:p-4">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-rose-700 dark:text-rose-300">
                    <Ban className="size-4 shrink-0" />
                    נדחה - החתימה במפתח הישן
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <HashChip
                      value={replayDemo.attemptedAddress}
                      label="attempted"
                      head={8}
                      tail={6}
                    />
                    <span className="font-mono text-sm text-rose-600 dark:text-rose-400">
                      ≠
                    </span>
                    <HashChip
                      value={replayDemo.activeAddress}
                      label="active"
                      head={8}
                      tail={6}
                    />
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-rose-700/90 dark:text-rose-300/90">
                    {replayDemo.reason}
                  </p>
                </div>
              ) : null}
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" className="h-11 w-full" onClick={() => onOpenChange(false)}>
            {op ? "סגור" : "ביטול"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
