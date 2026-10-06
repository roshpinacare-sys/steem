"use client";

// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · אתגר חתימה חד-פעני (EVM-3) - זרימת 3 צעדים:
// 1) השרת מנפיק אתגר (nonce + digest) 2) הסוכן חותם (סימולציית DEVNET;
// בייצור - המפתח אצל הסוכן) 3) אימות ecrecover + צריכת ה-nonce.
// שליחת אותה חתימה שוב נדחית תמיד (409) - replay protection חי.
// ─────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Fingerprint,
  Lock,
  PenLine,
  RotateCw,
  ShieldCheck,
  ShieldX,
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
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { AgentDTO } from "@/lib/weave/types";
import type { ChallengeDTO, ChallengeVerifyDTO } from "@/lib/weave/evmext-types";
import { apiFetch, errorMessage } from "../api";
import { HashChip } from "../shared";
import { Stepper } from "./bits";

const STEPS = [
  { label: "אתגר" },
  { label: "חתימה" },
  { label: "אימות + צריכה" },
];

export function ChallengeDialog({
  agent,
  open,
  onOpenChange,
  onVerified,
  onReplayRejected,
  onActivity,
}: {
  agent: AgentDTO;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onVerified: (nonce: number) => void;
  onReplayRejected: (message: string) => void;
  onActivity: () => void;
}) {
  const [challenge, setChallenge] = useState<ChallengeDTO | null>(null);
  const [challengeLoading, setChallengeLoading] = useState(false);
  const [challengeError, setChallengeError] = useState<string | null>(null);
  const [signature, setSignature] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);
  const [verified, setVerified] = useState<ChallengeVerifyDTO | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [replay, setReplay] = useState<{ rejected: boolean; message: string } | null>(null);
  const [replaying, setReplaying] = useState(false);
  const inFlightRef = useRef(false);

  const fetchChallenge = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setChallengeLoading(true);
    setChallengeError(null);
    try {
      const res = await apiFetch<{ challenge: ChallengeDTO }>("/api/agents/challenge", {
        method: "POST",
        body: JSON.stringify({ agentId: agent.id }),
      });
      setChallenge(res.challenge);
      toast.success(`אתגר נוצר - nonce ${res.challenge.nonce}`, {
        description: "הסוכן נדרש לחתום על ה-digest החד-פעני",
      });
    } catch (err) {
      setChallengeError(errorMessage(err));
      toast.error(errorMessage(err));
    } finally {
      setChallengeLoading(false);
      inFlightRef.current = false;
    }
  }, [agent.id]);

  // בפתיחה: איפוס והנפקת אתגר טרי
  useEffect(() => {
    if (open) {
      setChallenge(null);
      setChallengeError(null);
      setSignature(null);
      setVerified(null);
      setReplay(null);
      void fetchChallenge();
    }
  }, [open, fetchChallenge]);

  const onSign = async () => {
    if (!challenge) return;
    setSigning(true);
    try {
      const res = await apiFetch<{ digest: string; signature: string; simulatedBy: string }>(
        "/api/agents/challenge/sign",
        { method: "POST", body: JSON.stringify({ agentId: agent.id, nonce: challenge.nonce }) }
      );
      setSignature(res.signature);
      toast.success("החתימה נוצרה - סימולציית סוכן (DEVNET)", {
        description: "ecrecover ישחזר את הכתובת בשרת",
      });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSigning(false);
    }
  };

  const onVerify = async () => {
    if (!challenge || !signature) return;
    setVerifying(true);
    try {
      const res = await apiFetch<{ verified: ChallengeVerifyDTO }>(
        "/api/agents/challenge/verify",
        {
          method: "POST",
          body: JSON.stringify({ agentId: agent.id, nonce: challenge.nonce, signature }),
        }
      );
      setVerified(res.verified);
      onVerified(res.verified.consumedNonce);
      onActivity();
      toast.success(`nonce ${res.verified.consumedNonce} נצרך - הזהות אומתה`, {
        description: "ecrecover תקין - מעכשיו אותה חתימה תידחה",
      });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setVerifying(false);
    }
  };

  const onReplay = async () => {
    if (!challenge || !signature) return;
    setReplaying(true);
    try {
      // replay חייב להיכשל (409) - זו ההדגמה
      await apiFetch("/api/agents/challenge/verify", {
        method: "POST",
        body: JSON.stringify({ agentId: agent.id, nonce: challenge.nonce, signature }),
      });
      // לא אמור להגיע לכאן לעולם - אם כן, זו בעיה אמיתית
      toast.error("ה-replay עבר?! זו תקלה - ה-nonce נצרך כבר");
    } catch (err) {
      const msg = errorMessage(err);
      setReplay({ rejected: true, message: msg });
      onReplayRejected(msg);
      onActivity();
      toast.error(msg);
    } finally {
      setReplaying(false);
    }
  };

  const step = verified ? 4 : signature ? 3 : challenge ? 2 : 1;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="sm:max-w-lg">
        <DialogHeader className="text-right sm:text-right">
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <Fingerprint className="size-5 text-emerald-500" />
            אתגר חתימה חד-פעני
            <Badge dir="ltr" className="font-mono text-xs">
              {agent.name}
            </Badge>
          </DialogTitle>
          <DialogDescription>
            אתגר nonce של שער EVM-3: השרת מנפיק, הסוכן חותם, השרת מאמת ב-ecrecover
            וצורך את ה-nonce. אותה חתימה לא תעבור פעמיים.
          </DialogDescription>
        </DialogHeader>

        <Stepper steps={STEPS} current={step} />

        <div className="flex flex-col gap-3">
          {/* צעד 1 - האתגר */}
          {challengeLoading ? (
            <div className="rounded-lg border p-4">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="mt-3 h-10 w-32" />
              <Skeleton className="mt-3 h-6 w-full" />
            </div>
          ) : challengeError && !challenge ? (
            <Alert variant="destructive">
              <ShieldX />
              <AlertTitle>האתגר לא נוצר</AlertTitle>
              <AlertDescription className="flex items-center justify-between gap-2">
                <span>{challengeError}</span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-11 border-rose-500/40 text-rose-600 dark:text-rose-400"
                  onClick={() => void fetchChallenge()}
                >
                  <RotateCw />
                  נסה שוב
                </Button>
              </AlertDescription>
            </Alert>
          ) : challenge ? (
            <div className="rounded-lg border p-3 sm:p-4">
              <p className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                <span className="font-mono">1</span> · האתגר שהונפק
              </p>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">nonce (מונה monotonic)</p>
                <p dir="ltr" className="font-mono text-3xl font-bold tabular-nums">
                  {challenge.nonce}
                </p>
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">digest לחתימה</p>
                <HashChip value={challenge.digest} label="keccak256" head={8} tail={6} />
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">זהות פעילה</p>
                <HashChip value={challenge.agentAddress} head={8} tail={6} />
              </div>
            </div>
          ) : null}

          {/* צעד 2 - חתימה */}
          {challenge && !challengeError ? (
            <div className="rounded-lg border p-3 sm:p-4">
              <p className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                <span className="font-mono">2</span> · חתימת הסוכן
              </p>
              {!signature ? (
                <Button
                  type="button"
                  className="mt-3 h-11 w-full"
                  onClick={() => void onSign()}
                  disabled={signing}
                >
                  <PenLine />
                  {signing ? "חותם…" : "חתום (סימולציית סוכן · DEVNET)"}
                </Button>
              ) : (
                <>
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs text-muted-foreground">signature (EIP-191)</p>
                    <HashChip value={signature} head={10} tail={8} />
                  </div>
                  <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                    הערת יושר: בייצור הסוכן חותם במפתחו שלו - לשרת מגיעה רק החתימה.
                  </p>
                </>
              )}
            </div>
          ) : null}

          {/* צעד 3 - אימות + צריכה */}
          {signature ? (
            <div className="rounded-lg border p-3 sm:p-4">
              <p className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                <span className="font-mono">3</span> · אימות וצריכת ה-nonce
              </p>
              {!verified ? (
                <Button
                  type="button"
                  className="mt-3 h-11 w-full border border-emerald-500/40 bg-emerald-600 text-white hover:bg-emerald-500 dark:bg-emerald-600 dark:hover:bg-emerald-500"
                  onClick={() => void onVerify()}
                  disabled={verifying}
                >
                  <ShieldCheck />
                  {verifying ? "מאמת…" : "אמת וצרוך את ה-nonce"}
                </Button>
              ) : (
                <>
                  <div
                    className={cn(
                      "mt-2 rounded-lg border border-emerald-500/40 bg-emerald-500/[0.07] p-3"
                    )}
                  >
                    <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                      <ShieldCheck className="size-4 shrink-0" />
                      nonce {verified.consumedNonce} נצרך - הזהות אומתה
                    </p>
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs text-muted-foreground">{"ecrecover ->"}</p>
                      <HashChip value={verified.recovered} head={8} tail={6} />
                    </div>
                  </div>

                  {!replay ? (
                    <Button
                      type="button"
                      variant="outline"
                      className="mt-3 h-11 w-full border-rose-500/40 text-rose-600 hover:bg-rose-500/10 dark:text-rose-400"
                      onClick={() => void onReplay()}
                      disabled={replaying}
                    >
                      <RotateCw className={cn(replaying && "animate-spin")} />
                      {replaying ? "שולח…" : "שלח את אותה חתימה שוב (replay)"}
                    </Button>
                  ) : (
                    <div className="mt-3 rounded-lg border border-rose-500/40 bg-rose-500/[0.07] p-3">
                      <p className="flex items-center gap-2 text-sm font-semibold text-rose-700 dark:text-rose-300">
                        <Lock className="size-4 shrink-0" />
                        replay נדחה - החתימה חד-פעמית
                      </p>
                      <p className="mt-1 text-xs leading-relaxed text-rose-700/90 dark:text-rose-300/90">
                        השרת: {replay.message}
                      </p>
                    </div>
                  )}
                </>
              )}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" className="h-11 w-full" onClick={() => onOpenChange(false)}>
            סגור
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
