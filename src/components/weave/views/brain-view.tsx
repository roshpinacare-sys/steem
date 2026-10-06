"use client";

// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · Brain View - המוח הריבוני של הרשת (Task 21).
//
// מאגר המפתחות במסכה מלאה (טביעות-אצבע בלבד - אפס סוד), מצב-חי,
// בדיקת-אמת (probe), ומגרש-שיחה חי מול openai/gpt-oss-20b דרך
// הרוטציה שלנו - לא דרך מפתח של צד-שלישי.
// ─────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  Activity,
  BrainCircuit,
  CheckCircle2,
  CircleDashed,
  KeyRound,
  Loader2,
  RefreshCw,
  Send,
  ShieldCheck,
  Snowflake,
  Timer,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { apiFetch, errorMessage } from "../api";
import { fmtDateTime } from "../shared";

interface BrainKeyView {
  fingerprint: string;
  status: string;
  lastCode: string | null;
  cooldownRemainingSec: number;
  verified: boolean;
}

interface BrainStatus {
  total: number;
  live: number;
  cooling: number;
  keys: BrainKeyView[];
  model: string;
  endpoint: string;
  ready: boolean;
  at: string;
  doctrine?: string;
  probed?: Array<{ fingerprint: string; live: boolean; code: number | string }>;
}

interface ChatTurn {
  role: "user" | "assistant";
  content: string;
  fingerprint?: string;
  attempts?: number;
  at: string;
  error?: boolean;
}

export function BrainView() {
  const reduced = useReducedMotion();
  const [status, setStatus] = useState<BrainStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [probing, setProbing] = useState(false);
  const [question, setQuestion] = useState("");
  const [chat, setChat] = useState<ChatTurn[]>([]);
  const [asking, setAsking] = useState(false);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<{ brain: BrainStatus }>("/api/weave/brain");
      setStatus(res.brain);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
    const t = setInterval(() => void loadStatus(), 20_000); // רענון מצב כל 20ש'
    return () => clearInterval(t);
  }, [loadStatus]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: reduced ? "instant" : "smooth" });
  }, [chat, reduced]);

  const probe = useCallback(async () => {
    setProbing(true);
    try {
      const res = await apiFetch<{ brain: BrainStatus }>("/api/weave/brain?probe=1");
      setStatus(res.brain);
      const p = res.brain.probed ?? [];
      const live = p.filter((x) => x.live).length;
      toast.success(`בדיקת-אמת הושלמה: ${live}/${p.length} מפתחות חיים (1-token chat)`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setProbing(false);
    }
  }, []);

  const ask = useCallback(async () => {
    const q = question.trim();
    if (!q || asking) return;
    setAsking(true);
    const turn: ChatTurn = { role: "user", content: q, at: new Date().toISOString() };
    setChat((c) => [...c, turn]);
    setQuestion("");
    try {
      const res = await apiFetch<{ brain: { ok: boolean; content: string; keyFingerprint: string; attempts: number; error?: string } }>(
        "/api/weave/brain",
        {
          method: "POST",
          body: JSON.stringify({ messages: [...chat.filter((t) => !t.error).map((t) => ({ role: t.role, content: t.content })), { role: "user", content: q }], maxTokens: 512 }),
        }
      );
      const b = res.brain;
      setChat((c) => [
        ...c,
        b.ok
          ? { role: "assistant", content: b.content || "(תשובה ריקה)", fingerprint: b.keyFingerprint, attempts: b.attempts, at: new Date().toISOString() }
          : { role: "assistant", content: b.error ?? "כשל", error: true, at: new Date().toISOString() },
      ]);
    } catch (e) {
      setChat((c) => [
        ...c,
        { role: "assistant", content: errorMessage(e), error: true, at: new Date().toISOString() },
      ]);
    } finally {
      setAsking(false);
    }
  }, [question, asking, chat]);

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 py-8 sm:px-6 sm:py-12">
      {/* כותרת העמוד */}
      <motion.header
        initial={reduced ? false : { opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="flex flex-col gap-4"
      >
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex size-12 items-center justify-center rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
            <BrainCircuit className="size-6" aria-hidden="true" />
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">המוח הריבוני</h1>
            <p className="text-sm text-muted-foreground">
              מאגר מפתחות AI אטום בבית · רוטציה בפקודת מפעיל (לא אוטומטית) · הרשת חושבת בעצמה
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {loading ? (
            <Skeleton className="h-7 w-44" />
          ) : (
            <>
              <Badge variant="outline" className="gap-1.5 border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 className="size-3.5" aria-hidden="true" />
                {status ? `${status.live}/${status.total} מפתחות חיים` : "-"}
              </Badge>
              {status?.cooling ? (
                <Badge variant="outline" className="gap-1.5 border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                  <Snowflake className="size-3.5" aria-hidden="true" />
                  {status.cooling} בקירור
                </Badge>
              ) : null}
              <Badge variant="outline" className="gap-1.5 font-mono" dir="ltr">
                <Activity className="size-3.5" aria-hidden="true" />
                {status?.model ?? "-"}
              </Badge>
            </>
          )}
        </div>
      </motion.header>

      <div className="grid gap-6 lg:grid-cols-5">
        {/* ── מאגר המפתחות ── */}
        <motion.section
          initial={reduced ? false : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
          className="lg:col-span-2"
          aria-labelledby="brain-pool"
        >
          <Card className="h-full">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
              <CardTitle id="brain-pool" className="flex items-center gap-2 text-base">
                <KeyRound className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                מאגר המפתחות
              </CardTitle>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void probe()}
                disabled={probing || loading}
                className="gap-1.5"
              >
                {probing ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <RefreshCw className="size-3.5" aria-hidden="true" />}
                בדיקת-אמת
              </Button>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {loading ? (
                <>
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                </>
              ) : (
                status?.keys.map((k) => (
                  <div
                    key={k.fingerprint}
                    className="flex items-center justify-between gap-3 rounded-lg border bg-muted/30 p-4"
                  >
                    <div className="flex min-w-0 flex-col gap-1">
                      <span className="truncate font-mono text-xs font-semibold" dir="ltr">
                        {k.fingerprint}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        {k.status === "cooling"
                          ? `קירור - עוד ${k.cooldownRemainingSec} שנ' (קוד ${k.lastCode ?? "-"})`
                          : k.verified
                            ? `חי · קוד אחרון ${k.lastCode ?? "-"}`
                            : "טרם אומת"}
                      </span>
                    </div>
                    <span className="shrink-0">
                      {k.status === "cooling" ? (
                        <Timer className="size-5 text-emerald-500" aria-hidden="true" />
                      ) : k.verified ? (
                        <ShieldCheck className="size-5 text-emerald-500" aria-hidden="true" />
                      ) : (
                        <CircleDashed className="size-5 text-muted-foreground" aria-hidden="true" />
                      )}
                    </span>
                  </div>
                ))
              )}
              <p className="rounded-lg border border-dashed p-3 text-[11px] leading-relaxed text-muted-foreground">
                הסודות עצמם אטומים AES-256-GCM תחת גזירת מפתח-הרשת - והגושים
                האטומים מעוגנים בספר (ledger.json, כספת אדיטיבית): כל איפוס
                סביבה משחזר את המוח מהגיט. ב-API וב-UI רק טביעות-אצבע
                בלתי-הפיכות; פתיחה - רק בידי מחזיק ה-seal. רוטציה:
                429 -&gt; קירור 90ש' למפתח-בודד · 401/403 -&gt; 30 דק' · הבא משרת מיד.
              </p>
            </CardContent>
          </Card>
        </motion.section>

        {/* ── מגרש השיחה ── */}
        <motion.section
          initial={reduced ? false : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
          className="lg:col-span-3"
          aria-labelledby="brain-chat"
        >
          <Card className="flex h-full flex-col">
            <CardHeader className="pb-4">
              <CardTitle id="brain-chat" className="flex items-center gap-2 text-base">
                <Activity className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                מגרש-שיחה חי
              </CardTitle>
            </CardHeader>
            <CardContent className="flex min-h-[320px] flex-1 flex-col gap-4">
              {/* היסטוריית השיחה */}
              <div className="flex-1 overflow-y-auto rounded-lg border bg-muted/20 p-4" role="log" aria-label="שיחה עם המוח">
                {chat.length === 0 ? (
                  <div className="flex h-full min-h-40 flex-col items-center justify-center gap-2 text-center text-muted-foreground">
                    <BrainCircuit className="size-8 opacity-30" aria-hidden="true" />
                    <p className="text-sm">שאלו את המוח משהו - התשובה תגיע דרך המאגר שלנו, ברוטציה, ב-$0.</p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    {chat.map((t, i) => (
                      <div
                        key={i}
                        className={
                          t.role === "user"
                            ? "ms-auto max-w-[85%] rounded-xl bg-emerald-600 px-4 py-2.5 text-sm text-emerald-50 shadow-sm"
                            : t.error
                              ? "me-auto max-w-[85%] rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-2.5 text-sm text-rose-700 dark:text-rose-300"
                              : "me-auto max-w-[85%] rounded-xl border bg-background px-4 py-2.5 text-sm shadow-sm"
                        }
                      >
                        <p className="whitespace-pre-wrap break-words leading-relaxed">{t.content}</p>
                        {t.fingerprint ? (
                          <p className="mt-1.5 font-mono text-[10px] opacity-60" dir="ltr">
                            via {t.fingerprint} · attempt #{t.attempts} · {fmtDateTime(t.at)}
                          </p>
                        ) : null}
                      </div>
                    ))}
                    {asking ? (
                      <div className="me-auto flex items-center gap-2 rounded-xl border bg-background px-4 py-2.5 text-sm text-muted-foreground shadow-sm">
                        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                        המוח חושב…
                      </div>
                    ) : null}
                    <div ref={chatEndRef} />
                  </div>
                )}
              </div>

              {/* קלט */}
              <div className="flex items-end gap-2">
                <Textarea
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void ask();
                    }
                  }}
                  placeholder="שאלו את המוח… (Enter לשליחה, Shift+Enter לשורה חדשה)"
                  rows={2}
                  className="min-h-[64px] resize-none"
                  aria-label="שאלה למוח"
                  dir="auto"
                />
                <Button
                  onClick={() => void ask()}
                  disabled={asking || !question.trim()}
                  size="icon"
                  className="size-11 shrink-0"
                  aria-label="שלח"
                >
                  <Send className="size-4" aria-hidden="true" />
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                תווית אמת: המודל נקרא חי מ-NVIDIA NIM (openai/gpt-oss-20b) -
                הריבונות היא על המפתחות, הזיהוי והרוטציה. השיחה לא נכנסת
                לספר האימותים.
              </p>
            </CardContent>
          </Card>
        </motion.section>
      </div>
    </div>
  );
}
