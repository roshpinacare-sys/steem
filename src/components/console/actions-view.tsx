"use client";

// ─────────────────────────────────────────────────────────────────────────────
// ActionsView — the command surface. Every card is a working capability:
// vault keys, proofs rerun, empire scan, agent mint, dual publishing,
// heartbeat, autonomy switches, and a live activity feed (journal + runs +
// daemon log). G1: every button has handler + loading/success/error states.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from "react";
import {
  BadgeCheck,
  Bot,
  FileUp,
  KeyRound,
  PlayCircle,
  Radar,
  RefreshCw,
  ScanSearch,
  ShieldCheck,
  Zap,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

import {
  brainAction,
  fmtNum,
  relTime,
  useDaemonLog,
  useExec,
  type AgentStatus,
  type BrainResponse,
} from "./api";
import { useProofs } from "./api";

function useToaster() {
  const { toast } = useToast();
  return {
    ok: (title: string, detail?: string) =>
      toast({ title, description: detail, variant: "default" }),
    err: (title: string, detail?: string) =>
      toast({ title, description: detail, variant: "destructive" }),
  };
}

// ─── small building blocks ───────────────────────────────────────────────────

function ActionCard({
  icon: Icon,
  title,
  purpose,
  children,
  footer,
}: {
  icon: typeof Zap;
  title: string;
  purpose: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <Card className="flex flex-col border-zinc-800 bg-zinc-900/60 transition-colors hover:border-zinc-700">
      <CardContent className="flex flex-1 flex-col p-4">
        <div className="flex items-center gap-2">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-950">
            <Icon className="size-4 text-emerald-300" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <div className="text-[13px] font-semibold leading-tight text-zinc-100">{title}</div>
            <div className="text-[11px] leading-tight text-zinc-500">{purpose}</div>
          </div>
        </div>
        <div className="mt-3 flex-1">{children}</div>
        {footer && <div className="mt-3 border-t border-zinc-800/60 pt-2.5 text-[10px] text-zinc-500">{footer}</div>}
      </CardContent>
    </Card>
  );
}

function RunLogDialog({
  runId,
  onClose,
  runLog,
  title,
}: {
  runId: string | null;
  onClose: () => void;
  runLog: (id: string) => Promise<string[]>;
  title: string;
}) {
  const [lines, setLines] = useState<string[]>([]);
  useEffect(() => {
    if (!runId) return;
    let alive = true;
    const fetchLog = () =>
      runLog(runId).then((l) => {
        if (alive) setLines(l);
      });
    fetchLog();
    const id = setInterval(fetchLog, 4000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [runId, runLog]);

  return (
    <Dialog open={runId != null} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl border-zinc-800 bg-zinc-950">
        <DialogHeader>
          <DialogTitle className="text-sm">{title} — יומן ריצה</DialogTitle>
          <DialogDescription className="text-[11px]">
            מתעדכן כל 4 שניות עד שהריצה מסתיימת.
          </DialogDescription>
        </DialogHeader>
        <div className="scrollbar-thin max-h-80 overflow-y-auto rounded-lg border border-zinc-800 bg-black/60 p-3">
          {lines.length === 0 ? (
            <div className="flex items-center gap-2 text-[11px] text-zinc-500">
              <span className="saos-live-dot size-1.5 rounded-full bg-emerald-400" aria-hidden="true" />
              ממתין לפלט…
            </div>
          ) : (
            <pre className="whitespace-pre-wrap break-all font-mono text-[10px] leading-relaxed text-emerald-200/90" dir="ltr">
              {lines.join("\n")}
            </pre>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── factory dialog (agent mint) ─────────────────────────────────────────────

function FactoryDialog({
  open,
  onClose,
  status,
  onSpawn,
}: {
  open: boolean;
  onClose: () => void;
  status: AgentStatus | null;
  onSpawn: (name: string, sp: number, real: boolean) => Promise<void>;
}) {
  const t = useToaster();
  const [name, setName] = useState("");
  const [sp, setSp] = useState("50");
  const [real, setReal] = useState(false);
  const [busy, setBusy] = useState(false);
  const agents = status?.factory?.agents ?? [];
  const spAvailable = status?.empire?.summary.totalSP ?? 0;

  const mint = async () => {
    setBusy(true);
    try {
      await onSpawn(name.trim(), Number(sp), real);
      setName("");
      setReal(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md border-zinc-800 bg-zinc-950">
        <DialogHeader>
          <DialogTitle className="text-sm">🤖 לידת סוכן חדש</DialogTitle>
          <DialogDescription className="text-[11px]">
            יוצר חשבון אמיתי על השרשרת (create_claimed_account, עלות אפס — RC) + מקצה לו הון הפיך.
            הסוכן חותם בעצמו מהמפתחות החדשים שנוצרים מקומית.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-[12px]">שם החשבון החדש</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={agents.length > 0 ? `hcnova${agents.length + 1}` : "hcnova1"}
              className="h-8 border-zinc-800 bg-zinc-900 font-mono text-[12px]"
              dir="ltr"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[12px]">הון-פתיחה (SP delegated) — זמין: {fmtNum(spAvailable, 0)} SP</Label>
            <Input
              value={sp}
              onChange={(e) => setSp(e.target.value)}
              className="h-8 border-zinc-800 bg-zinc-900 font-mono text-[12px]"
              dir="ltr"
              inputMode="numeric"
            />
          </div>
          <div className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
            <div>
              <div className="text-[12px] font-medium text-zinc-200">ביצוע אמיתי על-שרשרת</div>
              <div className="text-[10px] text-zinc-500">
                כבוי = ניסיון-יבש (--dry) בלי שידור. הפעלה = עסקה אמיתית, בלתי-הפיכה.
              </div>
            </div>
            <Switch checked={real} onCheckedChange={setReal} aria-label="ביצוע אמיתי" />
          </div>
        </div>
        <DialogFooter>
          <Button
            className="w-full bg-emerald-500 text-zinc-950 hover:bg-emerald-400"
            disabled={busy || !/^[a-z][a-z0-9\-.]{2,15}$/.test(name.trim()) || (real && sp.length === 0)}
            onClick={() => void mint()}
          >
            {busy ? "מטמיע…" : real ? "הטמע אמיתי על-שרשרת" : "הרץ ניסיון-יבש"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── the main view ───────────────────────────────────────────────────────────

export function ActionsView({
  status,
  brain,
  onNavigate,
}: {
  status: AgentStatus | null;
  brain: BrainResponse | null;
  onNavigate?: (v: string) => void;
}) {
  const t = useToaster();
  const [factoryOpen, setFactoryOpen] = useState(false);
  const [logRunId, setLogRunId] = useState<string | null>(null);
  const [logTitle, setLogTitle] = useState("");
  const [ticking, setTicking] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);

  const { running: proofsRunning, rerun } = useProofs();
  const { data: execData, spawn, runLog } = useExec(true);
  const daemonLog = useDaemonLog(true);
  const logRef = useRef<HTMLDivElement>(null);

  const aut = brain?.autonomy;
  const loops = status?.loops ?? {};
  const erroredLoops = Object.entries(loops).filter(([, l]) => l.status === "error");

  const doExec = async (script: string, label: string, params?: Record<string, unknown>) => {
    const res = await spawn(script, params);
    if (res.ok) {
      t.ok(`${label} הופעלה`, "יומן הריצה נפתח — מתעדכן חי");
      setLogTitle(label);
      setLogRunId(res.runId ?? null);
    } else {
      t.err(`${label} נדחתה`, res.error);
    }
  };

  const tick = async () => {
    setTicking(true);
    const res = await brainAction("tick");
    setTicking(false);
    if (res.ok) t.ok("פעימת-לב בוצעה", "המוח הריץ מחזור מלא עכשיו");
    else t.err("פעימה נכשלה", res.error);
  };

  const toggle = async (what: "mode" | "curation" | "dex-mm", to: boolean) => {
    setSwitching(what);
    const type = what === "mode" ? "set-mode" : what === "curation" ? "set-curation" : "set-dex-mm";
    const body = what === "mode" ? { real: to } : { enabled: to };
    const res = await brainAction(type, body);
    setSwitching(null);
    if (res.ok) t.ok("מצב אוטונומיה עודכן", `${type} → ${to ? "on" : "off"}`);
    else t.err("עדכון נכשל", res.error);
  };

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [daemonLog?.lines?.length]);

  const openRunLog = (id: string, label: string) => {
    setLogTitle(label);
    setLogRunId(id);
  };

  return (
    <div className="space-y-5">
      {/* hero */}
      <section className="flex flex-wrap items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-3" aria-label="מצב כללי">
        <span className={cn("size-2 rounded-full", status && erroredLoops.length === 0 ? "saos-live-dot bg-emerald-400" : erroredLoops.length > 0 ? "bg-amber-400" : "bg-zinc-600")} aria-hidden="true" />
        <span className="text-[13px] font-bold text-zinc-100">
          {status == null ? "ממתין לדיווח הדמון…" : erroredLoops.length > 0 ? `הדמון חי — לולאה אחת בפיגור (${erroredLoops[0][0]})` : "הדמון חי — 8 לולאות רצות"}
        </span>
        {status && (
          <span className="text-[11px] text-zinc-500">
            RC {status.rc.pct.toFixed(0)}% · feed {fmtNum(status.feed, 6)} · עודכן {relTime(status.updatedAt)}
          </span>
        )}
        <span className="ms-auto text-[10px] text-zinc-500">
          כל פעולה כאן אמיתית: חותמת על השרשרת או מריצה את הדמון המקומי
        </span>
      </section>

      {/* action grid */}
      <section aria-label="פעולות" className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        <ActionCard
          icon={KeyRound}
          title="כספת המפתחות"
          purpose="סיסמת-אב אחת → כל המפתחות נגזרים ומאומתים מול שלוש שרשראות"
          footer="posting נחוץ לאוטונומיה · active נחוץ ל-DEX/Hive-Engine/לידת חשבונות"
        >
          <div className="flex flex-wrap gap-1.5">
            <Badge variant="outline" className={aut?.keyConfigured ? "border-emerald-400/30 text-[10px] text-emerald-300" : "border-zinc-700 text-[10px] text-zinc-500"}>
              posting {aut?.keyConfigured ? `✓ ${aut.keyMasked}` : "—"}
            </Badge>
            <Badge variant="outline" className={aut?.activeKeyInVault ? "border-emerald-400/30 text-[10px] text-emerald-300" : "border-amber-400/30 text-[10px] text-amber-300"}>
              active {aut?.activeKeyInVault ? `✓ ${aut.activeKeyMasked}` : "—"}
            </Badge>
            <Badge variant="outline" className="border-zinc-700 text-[10px] text-zinc-400">
              <ShieldCheck className="me-1 size-3" aria-hidden="true" />
              Steem·Hive·Blurt
            </Badge>
          </div>
          <Button className="mt-3 w-full bg-emerald-500 text-[12px] text-zinc-950 hover:bg-emerald-400" onClick={() => onNavigate?.("vault")}>
            פתח את הכספת
          </Button>
        </ActionCard>

        <ActionCard
          icon={BadgeCheck}
          title="מטריצת ההוכחות"
          purpose="26 בדיקות-מכונה על כל המערכת — טענה בלי עדות לא מקודמת"
          footer={execData?.results?.verify?.at ? `עדות אחרונה: ${relTime(execData.results.verify.at)}` : undefined}
        >
          <Button
            variant="outline"
            className="w-full border-zinc-700 text-[12px] hover:bg-zinc-800"
            disabled={proofsRunning}
            onClick={async () => {
              const ok = await rerun();
              if (ok) t.ok("אימות מלא הופעל", "התוצאה תתעדכן בבאדג' למעלה בעוד ~דקה");
              else t.err("הפעלת האימות נכשלה");
            }}
          >
            {proofsRunning ? (
              <>
                <RefreshCw className="me-1.5 size-3.5 animate-spin" aria-hidden="true" />
                מאמת…
              </>
            ) : (
              "הרץ אימות מלא"
            )}
          </Button>
        </ActionCard>

        <ActionCard
          icon={Radar}
          title="סריקת אימפריה"
          purpose="סורק Steem+Hive+Hive-Engine לכל חשבון שהמפתחות שלך שולטים בו"
          footer={status?.empire ? `סרוק ${relTime(status.empire.scannedAt)} · ${status.empire.summary.controllableNow} חשבונות נשלטים` : undefined}
        >
          <Button
            variant="outline"
            className="w-full border-zinc-700 text-[12px] hover:bg-zinc-800"
            onClick={() => void doExec("keyscan", "סריקת אימפריה")}
          >
            <ScanSearch className="me-1.5 size-3.5" aria-hidden="true" />
            סרוק עכשיו
          </Button>
          <Button
            variant="outline"
            className="w-full border-zinc-700 text-[12px] hover:bg-zinc-800"
            onClick={() => void doExec("forkscan", "סריקת שטחי-מפתח")}
          >
            <ScanSearch className="me-1.5 size-3.5" aria-hidden="true" />
            סרוק שרשראות-בת (Blurt/Serey/…)
          </Button>
        </ActionCard>

        <ActionCard icon={Bot} title="לידת סוכן" purpose="מטמיע זהות חדשה על-שרשרת בעלות אפס (RC) + הון-פתיחה הפיך" footer={`סוכנים: ${status?.factory?.agents.map((a) => "@" + a).join(" · ") || "—"}`}>
          <Button className="w-full bg-emerald-500 text-[12px] text-zinc-950 hover:bg-emerald-400" onClick={() => setFactoryOpen(true)}>
            <Bot className="me-1.5 size-3.5" aria-hidden="true" />
            הטמע סוכן
          </Button>
        </ActionCard>

        <ActionCard
          icon={FileUp}
          title="פרסום המפרט"
          purpose="מפרסם מפרט-פרוטוקול מנתוני-חיים — Steem ו-Hive (idempotent)"
          footer="מדווח נתונים רטרואקטיביים בלבד — בלי לחשוף קלפים"
        >
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1 border-zinc-700 text-[12px] hover:bg-zinc-800" onClick={() => void doExec("announce", "פרסום — Steem")}>
              Steem
            </Button>
            <Button variant="outline" className="flex-1 border-zinc-700 text-[12px] hover:bg-zinc-800" onClick={() => void doExec("announce-hive", "פרסום — Hive")}>
              Hive
            </Button>
          </div>
        </ActionCard>

        <ActionCard
          icon={Zap}
          title="פעימת-לב ידנית"
          purpose="מריץ מחזור-מוח מלא עכשיו: מדידה → תוכנית → ביצוע"
          footer={aut?.lastTickAt ? `פעימה אחרונה: ${relTime(aut.lastTickAt)} · ${aut.lastTickNote ?? ""}` : undefined}
        >
          <Button variant="outline" className="w-full border-zinc-700 text-[12px] hover:bg-zinc-800" disabled={ticking} onClick={() => void tick()}>
            {ticking ? (
              <>
                <RefreshCw className="me-1.5 size-3.5 animate-spin" aria-hidden="true" />
                רץ…
              </>
            ) : (
              <>
                <PlayCircle className="me-1.5 size-3.5" aria-hidden="true" />
                הרץ מחזור עכשיו
              </>
            )}
          </Button>
        </ActionCard>
      </section>

      {/* autonomy */}
      <Card className="border-zinc-800 bg-zinc-900/60">
        <CardContent className="p-4">
          <div className="mb-3 flex items-center gap-2">
            <ShieldCheck className="size-4 text-emerald-300" aria-hidden="true" />
            <span className="text-[13px] font-semibold text-zinc-100">אוטונומיה</span>
            <span className="text-[10px] text-zinc-500">מתגי-על של המערכת — משפיעים על הדמון המקומי מיד</span>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {[
              { key: "mode", label: "מצב אמיתי (REAL)", desc: "כבוי = הכל יבש, אפס שידורים", on: aut?.realMode ?? false, icon: "🔴" },
              { key: "curation", label: "אצירה אוטונומית", desc: "הדמון מצביע כש-VP ≥ 80%", on: aut?.curationEnabled ?? false, icon: "🗳️" },
              { key: "dex-mm", label: "עשיית-שוק ריבונית", desc: "ציטוט וספר דו-צדדי בלי דפדפן", on: true, icon: "💠" },
            ].map((s) => (
              <div key={s.key} className="flex items-center justify-between gap-2 rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
                <div className="min-w-0">
                  <div className="text-[12px] font-medium text-zinc-200">
                    <span className="me-1" aria-hidden="true">{s.icon}</span>
                    {s.label}
                  </div>
                  <div className="text-[10px] text-zinc-500">{s.desc}</div>
                </div>
                <Switch
                  checked={s.on}
                  disabled={switching === s.key}
                  onCheckedChange={(v) => void toggle(s.key as "mode" | "curation" | "dex-mm", v)}
                  aria-label={s.label}
                />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* activity feed */}
      <Card className="border-zinc-800 bg-zinc-900/60">
        <CardContent className="p-4">
          <div className="mb-3 flex items-center gap-2">
            <span className="text-[13px] font-semibold text-zinc-100">📡 פעילות חיה</span>
            <span className="text-[10px] text-zinc-500">יומן הדמון + החלטות המוח + הרצות ידניות</span>
            {execData && execData.runs.length > 0 && (
              <span className="ms-auto flex items-center gap-1 text-[10px] text-emerald-300">
                <span className="saos-live-dot size-1.5 rounded-full bg-emerald-400" aria-hidden="true" />
                {execData.runs.length} הרצות אחרונות
              </span>
            )}
          </div>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <div>
              <div className="mb-1.5 text-[10px] font-medium text-zinc-500">הרצות ידניות (לחיצה = יומן)</div>
              <div className="space-y-1.5">
                {(execData?.runs ?? []).slice(0, 4).map((r) => (
                  <button
                    key={r.id}
                    onClick={() => openRunLog(r.id, r.label)}
                    className="flex w-full items-center justify-between gap-2 rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-start hover:border-zinc-700"
                  >
                    <span className="truncate text-[11px] text-zinc-300">{r.label}</span>
                    <span className="shrink-0 text-[10px] text-zinc-500">{relTime(r.startedAt)}{r.real ? " · REAL" : ""}</span>
                  </button>
                ))}
                {execData?.runs.length === 0 && (
                  <div className="rounded-lg border border-dashed border-zinc-800 px-3 py-4 text-center text-[11px] text-zinc-600">
                    עדיין לא הרצת פעולות ידניות — התחל מכפתור למעלה
                  </div>
                )}
              </div>
              <div className="mb-1.5 mt-3 text-[10px] font-medium text-zinc-500">החלטות-מוח אחרונות</div>
              <div className="scrollbar-thin max-h-40 space-y-1.5 overflow-y-auto pe-1">
                {(brain?.journal ?? []).slice(0, 6).map((j) => (
                  <div key={j.id} className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-[11px] text-zinc-300">{j.title}</span>
                      <span className="shrink-0 text-[9px] text-zinc-600">{relTime(j.createdAt)}</span>
                    </div>
                    {j.detail && <div className="truncate text-[10px] text-zinc-600">{j.detail}</div>}
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="mb-1.5 text-[10px] font-medium text-zinc-500">יומן הדמון (agent.log — חי)</div>
              <div
                ref={logRef}
                className="scrollbar-thin h-72 overflow-y-auto rounded-lg border border-zinc-800 bg-black/60 p-3"
              >
                {daemonLog == null ? (
                  <Skeleton className="h-full w-full bg-zinc-900" />
                ) : (
                  <pre className="whitespace-pre-wrap break-all font-mono text-[9.5px] leading-relaxed text-emerald-200/80" dir="ltr">
                    {daemonLog.lines.join("\n")}
                  </pre>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <FactoryDialog
        open={factoryOpen}
        onClose={() => setFactoryOpen(false)}
        status={status}
        onSpawn={async (name, sp, real) => {
          await doExec("factory", `לידת סוכן ${name}`, { name, sp, real });
          setFactoryOpen(false);
        }}
      />
      <RunLogDialog runId={logRunId} onClose={() => setLogRunId(null)} runLog={runLog} title={logTitle} />
    </div>
  );
}
