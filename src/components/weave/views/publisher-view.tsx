"use client";

// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · Publisher View — סוכן הפרסום האוטונומי (R79 · VOICE).
//
// הוראת המפעיל שיצרה את התצוגה: "יש לנו גם רשתות חברתיות שאפשר
// לפרסם בהם ולהרוויח עוד. יש לעשות עוד סדר במערכת כדי לנצל
// ולהפעיל את כולה על כל המערכים ולהשלים את המערכים החסרים —
// כגוף ריבוני אוטונומי לא תלוי." R78 זיהה את סוכן-הפרסום
// כהחלק החסר הגדול בריבונות הכלכלית — התצוגה הזו היא ההשלמה:
// הסוכנים הם המשתמשים, והם גם הקול.
//
// חמש שכבות מוצגות כאן, כולן מה-API החי (/api/publish):
//   · הערוצים — איפה מפרסמים ומרוויחים, מה חי/חמוש/חסר בכנות.
//   · מפעל התוכן — טיוטות שנולדות מנתונים חיים (דוח-אמת HE/EN,
//     סיפור-נזילות) + מדף הארסנל הנמדח מ-Adsmarket.
//   · תור הפרסום — מחזור-חיים מלא: טיוטה → תור → שידור → קבלה
//     חיה (פרמאלינק · txid · קישור לשרשרת).
//   · הרווחים — יתרות ותגמולים מהשרשרת החיה, לא תחזיות.
//   · האוטונומיה — מה הסוכן עושה לבד ומה מחכה להחלטת מפעיל.
// ─────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  Activity,
  AlertTriangle,
  BadgeCheck,
  Bot,
  Coins,
  DoorOpen,
  ExternalLink,
  Factory,
  Inbox,
  Languages,
  Loader2,
  LucideIcon,
  Megaphone,
  Radio,
  RefreshCw,
  Send,
  ShieldCheck,
  Timer,
  TrendingUp,
  Wallet,
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
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import {
  FadeIn,
  MotionCard,
  Section,
} from "@/components/weave/shared";

// ── חוזה הנתונים (משוקף מ-/api/publish) ─────────────────────────────

const API = "/api/publish";
const AUTONOMY_API = "/api/autonomy";
const POLL_MS = 90_000;
const AUTONOMY_POLL_MS = 30_000;

type ChannelState = "LIVE" | "ARMED" | "MISSING";

interface PublishChannel {
  id: string;
  name: string;
  state: ChannelState;
  audience: string;
  earning: string;
  detail: string;
  actionNeeded: string | null;
}

interface FoundryDraft {
  id: string;
  kind: "TRUTH-REPORT" | "LIQUIDITY";
  lang: "HE" | "EN";
  title: string;
  tags: string[];
  body: string;
  preview: string;
  numbers: { label: string; value: string; source: string }[];
}

interface ArsenalShelf {
  state: "READY" | "BASELINE";
  filesCount: number | null;
  markdownCount: number | null;
  titles: string[];
  source: string;
  note: string;
}

interface QueueTask {
  id: string;
  kind: string;
  lang: string;
  title: string;
  status: string;
  tags: string;
  queuedAt: string;
  publishedAt: string | null;
  permlink: string | null;
  txid: string | null;
  url: string | null;
  error: string | null;
}

interface EarningsSnapshot {
  account: string | null;
  balanceSteem: string | null;
  balanceSbd: string | null;
  pendingSteem: string | null;
  pendingSbd: string | null;
  pendingVests: string | null;
  vestingShares: string | null;
  postCount: number | null;
  lastRootPost: string | null;
  flows: { id: string; name: string; now: string; source: string }[];
  publishedByAgent: number;
  honestNote: string;
}

interface AutonomyRow {
  id: string;
  name: string;
  does: string;
  autonomy: "AUTONOMOUS" | "POLICY-GATED" | "OPERATOR-GATE";
}

interface PulseHistoryEntry {
  at: string;
  utcDay: string;
  draftId: string;
  kind: string;
  title: string;
  permlink: string | null;
  txid: string | null;
  url: string | null;
  attempt: number;
  canon: { pushed: boolean; path: string; error?: string } | null;
}

interface PulseStatus {
  ok: boolean;
  service: string;
  version: string;
  alive: boolean;
  bootedAt: string;
  uptimeSec: number;
  beats: number;
  checkIntervalSec: number;
  policy: { maxPerUtcDay: number; rotation: string[]; attemptsBudget: number; truthSource: string };
  lastPublishUtcDay: string | null;
  nextDueAt: string | null;
  msToNext: number | null;
  attemptsToday: number;
  broadcasting: boolean;
  lastDecision: { at: string; kind: string; detail: string };
  canonLast: { at: string; ok: boolean; path: string; error?: string } | null;
  history: PulseHistoryEntry[];
}

interface AutonomyData {
  ok: boolean;
  at: string;
  daemon: PulseStatus | null;
  daemonDown: boolean;
  daemonDownHe: string | null;
  receipts: Array<{
    id: string;
    title: string;
    kind: string;
    lang: string;
    permlink: string | null;
    txid: string | null;
    url: string | null;
    publishedAt: string | null;
    by: string;
  }>;
  // R122 · חוזה-כנות: policy היא null כשהדיבון לא נמדד (אין מדיניות-מהזיכרון)
  policy: PulseStatus["policy"] | null;
  doctrine: string[];
  cached: boolean;
  stale: boolean;
  cacheAgeSec: number;
  refreshing: boolean;
}

interface PublisherData {
  ok: boolean;
  at: string;
  broadcastCapable: boolean;
  keyMaterial: { present: boolean; account: string };
  channels: PublishChannel[];
  foundry: { drafts: FoundryDraft[]; arsenal: ArsenalShelf };
  queue: QueueTask[];
  earnings: EarningsSnapshot;
  autonomy: AutonomyRow[];
  doctrine: string[];
  down: string[];
  cached: boolean;
  stale: boolean;
  cacheAgeSec: number;
  refreshing: boolean;
}

// ── מיפוי סעיפי-משנה → עוגני גלילה ────────────────────────────────────

const SECTION_ANCHORS: Record<string, string> = {
  foundry: "publish-foundry",
  queue: "publish-queue",
  earnings: "publish-earnings",
  channels: "publish-channels",
  pulse: "publish-pulse",
  autonomy: "publish-autonomy",
};

const CHANNEL_STYLE: Record<ChannelState, { label: string; cls: string }> = {
  LIVE: { label: "חי", cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" },
  ARMED: { label: "חמוש — מפתח ביד", cls: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400" },
  MISSING: { label: "חסר בכנות", cls: "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-400" },
};

const TASK_STYLE: Record<string, string> = {
  QUEUED: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  PUBLISHING: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  PUBLISHED: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  FAILED: "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-400",
};

const KIND_LABEL: Record<string, string> = {
  "TRUTH-REPORT": "דוח-אמת",
  LIQUIDITY: "נזילות",
  ARSENAL: "ארסנל",
  CUSTOM: "מותאם",
};

const DRAFT_LABEL: Record<string, string> = {
  "draft-truth-he": "דוח-אמת HE",
  "draft-liquidity-he": "סיפור-נזילות",
  "draft-truth-en": "דוח-אמת EN",
};

function fmtCountdown(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function fmtUptime(sec: number): string {
  if (sec < 60) return `${sec} שנ׳`;
  if (sec < 3600) return `${Math.floor(sec / 60)} דק׳`;
  return `${Math.floor(sec / 3600)} שע׳ ${Math.floor((sec % 3600) / 60)} דק׳`;
}

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return iso;
  }
}

// ── התצוגה ─────────────────────────────────────────────────────────────

export function PublisherView({ section = "foundry" }: { section?: string }) {
  const [data, setData] = useState<PublisherData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyDraft, setBusyDraft] = useState<string | null>(null);
  const [confirmTask, setConfirmTask] = useState<QueueTask | null>(null);
  const [broadcasting, setBroadcasting] = useState(false);
  const [pulseData, setPulseData] = useState<AutonomyData | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const alive = useRef(true);
  const anchors = useRef<Record<string, HTMLElement | null>>({});
  const { toast } = useToast();

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const res = await fetch(API, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = (await res.json()) as PublisherData;
      if (!alive.current) return;
      setData(j);
      setErr(null);
    } catch (e) {
      if (!alive.current) return;
      setErr(String((e as Error).message));
    } finally {
      if (alive.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void load();
    const t = setInterval(() => void load(), POLL_MS);
    return () => {
      alive.current = false;
      clearInterval(t);
    };
  }, [load]);

  // הדופק — מצב חי מ-/api/autonomy (30 שנ׳) + שעון-ספירה לאחור של שנייה
  const loadAutonomy = useCallback(async () => {
    try {
      const res = await fetch(AUTONOMY_API, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = (await res.json()) as AutonomyData;
      if (alive.current) setPulseData(j);
    } catch {
      /* הדופק לא נמדד — יוצג בכנות כשירות שלא ענה */
    }
  }, []);

  useEffect(() => {
    void loadAutonomy();
    const t = setInterval(() => void loadAutonomy(), AUTONOMY_POLL_MS);
    return () => clearInterval(t);
  }, [loadAutonomy]);

  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 1_000);
    return () => clearInterval(t);
  }, []);

  const pulse = pulseData?.daemon ?? null;
  const msToNext = useMemo(() => {
    if (!pulse?.nextDueAt) return null;
    const due = Date.parse(pulse.nextDueAt);
    return Number.isNaN(due) ? null : due - nowMs;
  }, [pulse?.nextDueAt, nowMs]);

  useEffect(() => {
    if (loading) return;
    const el = anchors.current[SECTION_ANCHORS[section] ?? section];
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [section, loading]);

  // טיוטה → תור (draftId: הגוף נולד מחדש בשרת מנתונים חיים)
  const enqueueDraft = useCallback(
    async (draft: FoundryDraft) => {
      setBusyDraft(draft.id);
      try {
        const res = await fetch(API, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "enqueue", draftId: draft.id }),
        });
        const j = await res.json().catch(() => null);
        if (!res.ok || !j?.ok) {
          toast({
            title: "התיירה נדחתה בכנות",
            description: String(j?.he ?? `HTTP ${res.status}`),
            variant: "destructive",
          });
          return;
        }
        toast({
          title: "הטיוטה הוצבה בתור",
          description: `${j.task.title} — ממתינה לשידור בחתימת הצי`,
        });
        await load();
      } catch (e) {
        toast({ title: "שגיאת רשת", description: String((e as Error).message), variant: "destructive" });
      } finally {
        if (alive.current) setBusyDraft(null);
      }
    },
    [load, toast],
  );

  // תור → שרשרת (השידור האמיתי: גזירה בזיכרון + אימות רשות חיה + comment חתום)
  const broadcastTask = useCallback(
    async (task: QueueTask) => {
      setBroadcasting(true);
      try {
        const res = await fetch(API, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "broadcast", id: task.id }),
        });
        const j = await res.json().catch(() => null);
        if (!res.ok || !j?.ok) {
          toast({
            title: "השידור לא יצא — סירוב כן",
            description: String(j?.he ?? `HTTP ${res.status}`),
            variant: "destructive",
          });
        } else {
          toast({
            title: "שודר לשרשרת Steem",
            description: j?.he ?? "קבלה חיה נשמרה בתור",
          });
        }
        await load();
      } catch (e) {
        toast({ title: "שגיאת רשת", description: String((e as Error).message), variant: "destructive" });
      } finally {
        if (alive.current) {
          setBroadcasting(false);
          setConfirmTask(null);
        }
      }
    },
    [load, toast],
  );

  const channels = data?.channels ?? [];
  const drafts = data?.foundry?.drafts ?? [];
  const arsenal = data?.foundry?.arsenal;
  const queue = data?.queue ?? [];
  const earnings = data?.earnings;
  const autonomy = data?.autonomy ?? [];
  const queued = queue.filter((t) => t.status === "QUEUED" || t.status === "PUBLISHING").length;
  const published = queue.filter((t) => t.status === "PUBLISHED").length;
  const steemChannel = channels.find((c) => c.id === "steem");

  return (
    <div className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6">
      {/* ── פתיח: הקול של הרשת ─────────────────────────────────────── */}
      <FadeIn className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className="flex size-11 items-center justify-center rounded-xl border border-teal-500/30 bg-teal-500/10 text-teal-600 dark:text-teal-400"
                aria-hidden="true"
              >
                <Megaphone className="size-5" />
              </span>
              <div>
                <h1 className="text-xl font-bold tracking-tight sm:text-2xl">קול הרשת — סוכן הפרסום האוטונומי</h1>
                <p className="text-sm text-muted-foreground">
                  VOICE · הסוכנים הם המשתמשים — והם גם הקול: תוכן מנתונים חיים, תור, שידור חתום, רווחים נמדדים
                </p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {data ? (
              <Badge
                variant="outline"
                dir="rtl"
                className={cn(
                  "gap-1.5 font-mono text-[11px]",
                  data.stale
                    ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                    : "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
                )}
              >
                {data.stale ? `מוגש בשל (${data.cacheAgeSec} שנ׳)` : `טרי (${data.cacheAgeSec} שנ׳)`}
              </Badge>
            ) : null}
            <Button variant="outline" size="sm" onClick={() => void load(true)} disabled={refreshing} className="gap-1.5">
              <RefreshCw className={cn("size-3.5", refreshing && "animate-spin")} aria-hidden="true" />
              רענן
            </Button>
          </div>
        </div>

        {/* צ'יפים חיים */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {[
            {
              icon: Radio,
              label: "ערוץ Steem",
              value: data
                ? data.broadcastCapable
                  ? `חמוש · ${data.keyMaterial.account}`
                  : "חסר מפתח"
                : "…",
              live: data?.broadcastCapable === true,
            },
            { icon: Factory, label: "טיוטות מוכנות", value: String(drafts.length), live: drafts.length > 0 },
            { icon: Inbox, label: "בתור", value: String(queued), live: queued > 0 },
            { icon: Send, label: "פורסם על-ידי הסוכן", value: String(published), live: published > 0 },
            {
              icon: Wallet,
              label: "יתרת הצי (חי)",
              value: earnings?.balanceSteem ?? "…",
              live: true,
            },
          ].map((chip) => (
            <MotionCard key={chip.label} className="p-3">
              <div className="flex items-center gap-2">
                <chip.icon className={cn("size-4", chip.live ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")} aria-hidden="true" />
                <div className="min-w-0">
                  <div className="text-[11px] leading-tight text-muted-foreground">{chip.label}</div>
                  <div className="truncate text-sm font-bold" title={chip.value}>{chip.value}</div>
                </div>
              </div>
            </MotionCard>
          ))}
        </div>

        {/* הכרזת השידור */}
        {data ? (
          <div
            className={cn(
              "flex items-start gap-3 rounded-xl border p-4",
              data.broadcastCapable
                ? "border-emerald-500/30 bg-emerald-500/5"
                : "border-amber-500/30 bg-amber-500/5",
            )}
          >
            {data.broadcastCapable ? (
              <ShieldCheck className="mt-0.5 size-5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
            ) : (
              <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
            )}
            <p className="text-sm leading-relaxed">
              {data.broadcastCapable ? (
                <>
                  <strong>מנגנון השידור חמוש:</strong> מפתח-האב של המפעיל נמצא בסנדבוקס — הוא נגזר ל-posting
                  בזיכרון-ההרצה בלבד, מאומת ביט-מול-ביט מול הרשות החיה לפני כל שידור (דוקטרינת R75: המפתח
                  מכריז את החותם, השרשרת השופטת), ואז נשמט. הוא לעולם לא נשמר — לא ב-DB, לא בלוג, לא בתשובה.
                </>
              ) : (
                <>
                  <strong>השידור חסום בכנות:</strong> מפתח-האב אינו בסנדבוקס. העלה את הסיסמה (upload) או הפעל
                  מהענן — עד אז התור קולט, אבל לא משדר.
                </>
              )}
            </p>
          </div>
        ) : null}
      </FadeIn>

      {/* ── שגיאה ───────────────────────────────────────────────────── */}
      {err ? (
        <div className="mt-6">
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-4 text-sm text-rose-700 dark:text-rose-400">
            ה-API לא ענה: {err} — התצוגה מציגה את מה שיש; נסה רענון.
          </div>
        </div>
      ) : null}

      {loading && !data ? (
        <div className="mt-6 space-y-4">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : null}

      {data ? (
        <>
          {/* ── הערוצים ──────────────────────────────────────────── */}
          <div
            id="publish-channels"
            ref={(el) => {
              anchors.current["publish-channels"] = el;
            }}
          >
            <Section
              title="הערוצים — איפה מפרסמים ומרוויחים"
              icon={<Radio className="size-4" />}
              className="mt-10 scroll-mt-24"
              description="מצב אמיתי בלבד: מה חי, מה חמוש, מה חסר — ומה כל השלמה פותחת"
            >
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {channels.map((c) => (
                  <MotionCard key={c.id} className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-sm font-bold leading-tight">{c.name}</h3>
                      <Badge variant="outline" dir="rtl" className={cn("shrink-0 text-[11px]", CHANNEL_STYLE[c.state].cls)}>
                        {CHANNEL_STYLE[c.state].label}
                      </Badge>
                    </div>
                    <dl className="mt-3 space-y-2 text-[13px] leading-relaxed">
                      <div>
                        <dt className="text-muted-foreground">קהל</dt>
                        <dd className="font-medium">{c.audience}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">איך מרוויחים</dt>
                        <dd className="font-medium">{c.earning}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">מדידה</dt>
                        <dd className="font-medium">{c.detail}</dd>
                      </div>
                      {c.actionNeeded ? (
                        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2 text-[12px] text-amber-700 dark:text-amber-400">
                          נדרש: {c.actionNeeded}
                        </div>
                      ) : null}
                    </dl>
                  </MotionCard>
                ))}
              </div>
            </Section>
          </div>

          {/* ── מפעל התוכן ────────────────────────────────────────── */}
          <div
            id="publish-foundry"
            ref={(el) => {
              anchors.current["publish-foundry"] = el;
            }}
          >
            <Section
              title="מפעל התוכן — טיוטות שנולדות מנתונים חיים"
              icon={<Factory className="size-4" />}
              className="mt-10 scroll-mt-24"
              description="כל טיוטה נבנית מחדש בכל קריאה מהשרשרות — הפוסט תמיד נושא את המספרים של עכשיו, עם מקור לכל מספר"
            >
              <div className="grid gap-4 lg:grid-cols-3">
                {drafts.map((d) => (
                  <MotionCard key={d.id} className="flex flex-col p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge variant="outline" dir="rtl" className="text-[11px]">
                          {KIND_LABEL[d.kind] ?? d.kind}
                        </Badge>
                        <Badge variant="outline" dir="rtl" className="gap-1 text-[11px]">
                          <Languages className="size-3" aria-hidden="true" />
                          {d.lang}
                        </Badge>
                      </div>
                      <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                        {d.body.length.toLocaleString("he-IL")} תו׳
                      </span>
                    </div>
                    <h3 className="mt-2 text-sm font-bold leading-snug">{d.title}</h3>
                    <p className="mt-2 line-clamp-3 whitespace-pre-line text-[13px] leading-relaxed text-muted-foreground">
                      {d.preview}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {d.tags.map((t) => (
                        <Badge key={t} variant="secondary" className="font-mono text-[10px]">
                          #{t}
                        </Badge>
                      ))}
                    </div>
                    <details className="mt-3 rounded-lg border bg-muted/30 p-2">
                      <summary className="cursor-pointer text-[12px] font-medium text-muted-foreground">
                        המספרים החיים שבתוך הטיוטה ({d.numbers.length})
                      </summary>
                      <ul className="mt-2 space-y-1.5">
                        {d.numbers.map((n) => (
                          <li key={n.label} className="flex items-baseline justify-between gap-2 text-[12px]">
                            <span className="text-muted-foreground">{n.label}</span>
                            <span className="text-right">
                              <span className="font-mono font-semibold">{n.value}</span>
                              <span className="block text-[10px] text-muted-foreground">{n.source}</span>
                            </span>
                          </li>
                        ))}
                      </ul>
                    </details>
                    <div className="mt-auto pt-4">
                      <Button
                        size="sm"
                        className="w-full gap-1.5"
                        disabled={busyDraft === d.id}
                        onClick={() => void enqueueDraft(d)}
                      >
                        {busyDraft === d.id ? (
                          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                        ) : (
                          <Inbox className="size-3.5" aria-hidden="true" />
                        )}
                        הצב בתור הפרסום
                      </Button>
                    </div>
                  </MotionCard>
                ))}
              </div>

              {/* מדף הארסנל */}
              {arsenal ? (
                <MotionCard className="mt-4 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="flex items-center gap-2 text-sm font-bold">
                      <BadgeCheck className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                      מדף הארסנל — Adsmarket
                    </h3>
                    <Badge variant="outline" dir="rtl" className={cn("text-[11px]", arsenal.state === "READY" ? CHANNEL_STYLE.LIVE.cls : "border-muted-foreground/30")}>
                      {arsenal.state === "READY" ? `נמדד חי: ${arsenal.markdownCount} קבצי markdown · ${arsenal.filesCount} קבצים` : "בסיס-מפגש"}
                    </Badge>
                  </div>
                  <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
                    {arsenal.note} מקור: <span className="font-mono text-[11px]">{arsenal.source}</span>
                  </p>
                  {arsenal.titles.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {arsenal.titles.map((t) => (
                        <Badge key={t} variant="secondary" className="max-w-full truncate font-mono text-[10px]">
                          {t}
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                </MotionCard>
              ) : null}
            </Section>
          </div>

          {/* ── תור הפרסום ───────────────────────────────────────── */}
          <div
            id="publish-queue"
            ref={(el) => {
              anchors.current["publish-queue"] = el;
            }}
          >
            <Section
              title="תור הפרסום — מחזור-חיים מלא עם קבלה לכל שידור"
              icon={<Inbox className="size-4" />}
              className="mt-10 scroll-mt-24"
              description="טיוטה → תור → שידור חתום → קבלה חיה (פרמאלינק · txid · קישור לשרשרת). השידור מאומת מול הרשות החיה לפני כל פעם"
            >
              {queue.length === 0 ? (
                <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
                  התור ריק — הכנס טיוטה מהמפעל למעלה, והיא תמתין כאן לשידור.
                </div>
              ) : (
                <div className="max-h-96 overflow-y-auto rounded-xl border">
                  <table className="w-full text-right text-[13px]">
                    <thead className="sticky top-0 bg-muted/95 backdrop-blur">
                      <tr className="text-[11px] text-muted-foreground">
                        <th className="px-3 py-2 text-right font-medium">כותרת</th>
                        <th className="px-3 py-2 text-right font-medium">סוג</th>
                        <th className="px-3 py-2 text-right font-medium">מצב</th>
                        <th className="px-3 py-2 text-right font-medium">קבלה</th>
                        <th className="px-3 py-2 text-right font-medium">פעולה</th>
                      </tr>
                    </thead>
                    <tbody>
                      {queue.map((t) => (
                        <tr key={t.id} className="border-t hover:bg-muted/30">
                          <td className="max-w-[280px] px-3 py-2">
                            <div className="truncate font-medium" title={t.title}>
                              {t.title}
                            </div>
                            <div className="text-[10px] text-muted-foreground">
                              הוצב {fmtTime(t.queuedAt)}
                              {t.publishedAt ? ` · שודר ${fmtTime(t.publishedAt)}` : ""}
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            <Badge variant="outline" dir="rtl" className="text-[10px]">
                              {KIND_LABEL[t.kind] ?? t.kind} · {t.lang}
                            </Badge>
                          </td>
                          <td className="px-3 py-2">
                            <Badge variant="outline" dir="rtl" className={cn("text-[10px]", TASK_STYLE[t.status] ?? "")}>
                              {t.status}
                            </Badge>
                            {t.error ? (
                              <div className="mt-1 max-w-[220px] truncate text-[10px] text-rose-600 dark:text-rose-400" title={t.error}>
                                {t.error}
                              </div>
                            ) : null}
                          </td>
                          <td className="px-3 py-2">
                            {t.url ? (
                              <a
                                href={t.url}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 font-mono text-[11px] text-emerald-700 underline decoration-dotted underline-offset-2 hover:text-emerald-600 dark:text-emerald-400"
                              >
                                {t.permlink ? `${t.permlink.slice(0, 18)}…` : "פוסט"}
                                <ExternalLink className="size-3" aria-hidden="true" />
                              </a>
                            ) : (
                              <span className="font-mono text-[11px] text-muted-foreground">—</span>
                            )}
                            {t.txid ? (
                              <div className="font-mono text-[10px] text-muted-foreground" title={t.txid}>
                                tx {t.txid.slice(0, 12)}…
                              </div>
                            ) : null}
                          </td>
                          <td className="px-3 py-2">
                            {t.status === "QUEUED" || t.status === "FAILED" ? (
                              <Button
                                size="sm"
                                variant={t.status === "FAILED" ? "outline" : "default"}
                                className="gap-1.5"
                                disabled={!data?.broadcastCapable || broadcasting}
                                onClick={() => setConfirmTask(t)}
                              >
                                <Send className="size-3.5" aria-hidden="true" />
                                שדר
                              </Button>
                            ) : t.status === "PUBLISHING" ? (
                              <Loader2 className="size-4 animate-spin text-amber-600" aria-label="משדר כעת" />
                            ) : (
                              <BadgeCheck className="size-4 text-emerald-600 dark:text-emerald-400" aria-label="פורסם" />
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>
          </div>

          {/* ── הרווחים ──────────────────────────────────────────── */}
          <div
            id="publish-earnings"
            ref={(el) => {
              anchors.current["publish-earnings"] = el;
            }}
          >
            <Section
              title="הרווחים — מדידה חיה, לא תחזית"
              icon={<TrendingUp className="size-4" />}
              className="mt-10 scroll-mt-24"
              description="יתרות ותגמולים מהשרשרת החיה + התזרימים הקיימים של הרשת. הכנסת תגמולים חדשה תימדד כאן מרגע שהיא מתרחשת"
            >
              {earnings ? (
                <>
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    <MotionCard className="p-4">
                      <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
                        <Wallet className="size-4" aria-hidden="true" /> יתרת @{earnings.account ?? "—"}
                      </div>
                      <div className="mt-2 space-y-1 font-mono text-sm font-bold">
                        <div>{earnings.balanceSteem ?? "—"}</div>
                        <div className="text-muted-foreground">{earnings.balanceSbd ?? "—"}</div>
                      </div>
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        {earnings.postCount ?? "—"} פוסטים · אחרון {fmtTime(earnings.lastRootPost)}
                      </div>
                    </MotionCard>
                    <MotionCard className="p-4">
                      <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
                        <Coins className="size-4" aria-hidden="true" /> תגמולים ממתינים (חי)
                      </div>
                      <div className="mt-2 space-y-1 font-mono text-sm font-bold">
                        <div>{earnings.pendingSteem ?? "—"}</div>
                        <div className="text-muted-foreground">{earnings.pendingSbd ?? "—"}</div>
                        <div className="text-muted-foreground">{earnings.pendingVests ?? "—"}</div>
                      </div>
                    </MotionCard>
                    <MotionCard className="p-4">
                      <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
                        <Bot className="size-4" aria-hidden="true" /> פורסם על-ידי הסוכן
                      </div>
                      <div className="mt-2 font-mono text-2xl font-bold">{earnings.publishedByAgent}</div>
                      <div className="mt-1 text-[11px] text-muted-foreground">פוסטים ששודרו מהתור של הרשת</div>
                    </MotionCard>
                    <MotionCard className="p-4">
                      <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
                        <TrendingUp className="size-4" aria-hidden="true" /> כוח ההצבעה
                      </div>
                      <div className="mt-2 font-mono text-sm font-bold">{earnings.vestingShares ?? "—"}</div>
                      <div className="mt-1 text-[11px] text-muted-foreground">SP של הצי — משקל הקול בשרשרת</div>
                    </MotionCard>
                  </div>
                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    {earnings.flows.map((f) => (
                      <MotionCard key={f.id} className="flex items-center justify-between gap-3 p-3">
                        <div className="min-w-0">
                          <div className="text-[13px] font-semibold">{f.name}</div>
                          <div className="text-[10px] text-muted-foreground">{f.source}</div>
                        </div>
                        <div className="shrink-0 font-mono text-[13px] font-bold">{f.now}</div>
                      </MotionCard>
                    ))}
                  </div>
                  <p className="mt-3 text-[12px] leading-relaxed text-muted-foreground">{earnings.honestNote}</p>
                </>
              ) : null}
            </Section>
          </div>

          {/* ── הדופק — שירות השידור האוטונומי ───────────────────── */}
          <div
            id="publish-pulse"
            ref={(el) => {
              anchors.current["publish-pulse"] = el;
            }}
          >
            <Section
              title="הדופק — שירות השידור האוטונומי"
              icon={<Activity className="size-4" />}
              className="mt-10 scroll-mt-24"
              description="מי מחליט מתי משדרים: המדיניות, לא האדם. מקסימום פוסט אחד ליום-UTC — בלי אף לחיצת כפתור"
            >
              {pulseData == null ? (
                <Skeleton className="h-48 w-full rounded-xl" />
              ) : pulse != null ? (
                <>
                  <MotionCard className="p-5">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                      <span className="relative flex size-3" aria-hidden="true">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500/60" />
                        <span className="relative inline-flex size-3 rounded-full bg-emerald-500" />
                      </span>
                      <div className="text-sm font-bold">הדופק חי</div>
                      <Badge variant="outline" dir="ltr" className="font-mono text-[10px]">
                        v{pulse.version}
                      </Badge>
                      <div className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-[11px] text-muted-foreground">
                        <span>פעימות: {pulse.beats}</span>
                        <span aria-hidden="true">·</span>
                        <span>פיקוח כל {pulse.checkIntervalSec} שנ׳</span>
                        <span aria-hidden="true">·</span>
                        <span>חי {fmtUptime(pulse.uptimeSec)}</span>
                        <span aria-hidden="true">·</span>
                        <span>ניסיונות היום {pulse.attemptsToday}/{pulse.policy.attemptsBudget}</span>
                      </div>
                    </div>

                    <div className="mt-4 flex flex-col gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 sm:flex-row sm:items-center sm:justify-between">
                      {pulse.broadcasting ? (
                        <div className="flex items-center gap-3">
                          <Loader2 className="size-6 animate-spin text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                          <div>
                            <div className="text-sm font-bold">משדר כעת לשרשרת…</div>
                            <div className="text-[12px] text-muted-foreground">הקול גוזר את המפתח בזיכרון ומאמת מול הרשות החיה לפני השידור</div>
                          </div>
                        </div>
                      ) : msToNext != null && msToNext > 0 ? (
                        <>
                          <div>
                            <div className="text-[12px] text-muted-foreground">השידור האוטונומי הבא בעוד (UTC)</div>
                            <div className="font-mono text-3xl font-bold tabular-nums text-emerald-700 dark:text-emerald-400" dir="ltr">
                              {fmtCountdown(msToNext)}
                            </div>
                          </div>
                          <div className="text-[11px] text-muted-foreground">
                            חלון: {pulse.nextDueAt ? fmtTime(pulse.nextDueAt) : "—"} · פורסם לאחרונה: {pulse.lastPublishUtcDay ?? "מעולם"}
                          </div>
                        </>
                      ) : msToNext != null && msToNext <= 0 ? (
                        <div>
                          <div className="text-sm font-bold text-emerald-700 dark:text-emerald-400">בחלון השידור כעת — הדופק יתפוס אותו בפעימה הקרובה</div>
                          <div className="text-[12px] text-muted-foreground">ניסיונות היום: {pulse.attemptsToday}/{pulse.policy.attemptsBudget}</div>
                        </div>
                      ) : (
                        <div className="text-sm text-muted-foreground">קורא אמת מהשרשרת (last_root_post) — עוד רגע נמדד החלון הבא…</div>
                      )}
                      <div className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
                        <Timer className="size-3.5" aria-hidden="true" />
                        מדיניות 1/יום-UTC
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      {pulse.policy.rotation.map((r) => (
                        <Badge key={r} variant="outline" className="gap-1 text-[10px]">
                          <RefreshCw className="size-3" aria-hidden="true" />
                          {DRAFT_LABEL[r] ?? r}
                        </Badge>
                      ))}
                      <Badge variant="outline" className="text-[10px] text-muted-foreground">
                        אמת: {pulse.policy.truthSource}
                      </Badge>
                    </div>

                    <div className="mt-3 rounded-lg border bg-muted/30 p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-[10px]",
                            pulse.lastDecision.kind === "BROADCAST-OK"
                              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                              : pulse.lastDecision.kind === "BROADCAST-FAIL"
                                ? "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-400"
                                : pulse.lastDecision.kind.startsWith("WAIT")
                                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                                  : "",
                          )}
                        >
                          החלטה אחרונה · {pulse.lastDecision.kind}
                        </Badge>
                        <span className="font-mono text-[10px] text-muted-foreground">{fmtTime(pulse.lastDecision.at)}</span>
                      </div>
                      <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">{pulse.lastDecision.detail}</p>
                    </div>
                  </MotionCard>

                  {(pulse.history?.length ?? 0) > 0 ? (
                    <div className="mt-4 overflow-hidden rounded-xl border">
                      <div className="border-b bg-muted/40 px-4 py-2.5 text-sm font-bold">שידורי הדופק — קבלות חיות</div>
                      <div className="max-h-72 overflow-y-auto">
                        <table className="w-full text-[12px]">
                          <thead>
                            <tr className="border-b bg-muted/20 text-muted-foreground">
                              <th className="px-3 py-2 text-start font-medium">מועד (UTC)</th>
                              <th className="px-3 py-2 text-start font-medium">טיוטה</th>
                              <th className="px-3 py-2 text-start font-medium">קבלה</th>
                              <th className="px-3 py-2 text-start font-medium">קנון</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(pulse.history ?? []).map((h) => (
                              <tr key={`${h.at}-${h.draftId}-${h.attempt}`} className="border-b last:border-b-0">
                                <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">{fmtTime(h.at)}</td>
                                <td className="px-3 py-2">{DRAFT_LABEL[h.draftId] ?? h.draftId}</td>
                                <td className="max-w-56 px-3 py-2">
                                  {h.url ? (
                                    <a
                                      href={h.url}
                                      target="_blank"
                                      rel="noreferrer noopener"
                                      className="inline-flex items-center gap-1 font-mono text-[11px] text-emerald-700 underline-offset-2 hover:underline dark:text-emerald-400"
                                    >
                                      {h.permlink && h.permlink.length > 34 ? `${h.permlink.slice(0, 34)}…` : (h.permlink ?? h.url)}
                                      <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
                                    </a>
                                  ) : (
                                    <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
                                      <span className="inline-block size-1.5 rounded-full bg-amber-500/70" aria-hidden="true" />
                                      טרם שודר — ניסיון {h.attempt} בחלון הנוכחי
                                    </span>
                                  )}
                                  {h.txid ? <div className="font-mono text-[10px] text-muted-foreground">txid {h.txid.slice(0, 18)}…</div> : null}
                                </td>
                                <td className="px-3 py-2">
                                  {h.canon?.pushed ? (
                                    <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-[10px] text-emerald-700 dark:text-emerald-400">
                                      נדחף
                                    </Badge>
                                  ) : (
                                    <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-[10px] text-amber-700 dark:text-amber-400">
                                      לא נדחף
                                    </Badge>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : (
                    <p className="mt-3 text-[12px] text-muted-foreground">
                      לדופק עצמו עוד אין שידורים — הפוסט הראשון של הסוכן (R79) שודר בלחיצת כפתור. החל מעכשיו, החלונות הבאים של הדופק.
                    </p>
                  )}

                  {pulse.canonLast ? (
                    <p className="mt-2 font-mono text-[11px] text-muted-foreground">
                      קנון אחרון: {pulse.canonLast.path} · {pulse.canonLast.ok ? "נדחף" : `נכשל (${pulse.canonLast.error ?? "—"})`} · {fmtTime(pulse.canonLast.at)}
                    </p>
                  ) : null}
                </>
              ) : (
                <MotionCard className="flex items-start gap-3 border-amber-500/30 bg-amber-500/5 p-4">
                  <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
                  <div>
                    <div className="text-sm font-bold">הדופק לא נמדד בסנדבוקס הזה</div>
                    <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{pulseData.daemonDownHe}</p>
                  </div>
                </MotionCard>
              )}
            </Section>
          </div>

          {/* ── האוטונומיה ────────────────────────────────────────── */}
          <div
            id="publish-autonomy"
            ref={(el) => {
              anchors.current["publish-autonomy"] = el;
            }}
          >
            <Section
              title="האוטונומיה — מה הסוכן עושה לבד"
              icon={<Bot className="size-4" />}
              className="mt-10 scroll-mt-24"
              description="המטרה: חוסר תלות במשתמשים אנושיים. מה כבר אוטונומי, ומה עומד מאחורי שער-המפעיל — בכנות"
            >
              <div className="grid gap-3 md:grid-cols-2">
                {autonomy.map((a) => (
                  <MotionCard key={a.id} className="flex items-start gap-3 p-4">
                    <span
                      className={cn(
                        "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border",
                        a.autonomy === "AUTONOMOUS"
                          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                          : a.autonomy === "POLICY-GATED"
                            ? "border-teal-500/30 bg-teal-500/10 text-teal-600 dark:text-teal-400"
                            : "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
                      )}
                      aria-hidden="true"
                    >
                      {a.autonomy === "AUTONOMOUS" ? (
                        <Bot className="size-4" />
                      ) : a.autonomy === "POLICY-GATED" ? (
                        <Timer className="size-4" />
                      ) : (
                        <DoorOpen className="size-4" />
                      )}
                    </span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-bold">{a.name}</h3>
                        <Badge variant="outline" dir="rtl" className="text-[10px]">
                          {a.autonomy === "AUTONOMOUS"
                            ? "אוטונומי לחלוטין"
                            : a.autonomy === "POLICY-GATED"
                              ? "אוטונומי לפי מדיניות"
                              : "שער-מפעיל"}
                        </Badge>
                      </div>
                      <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{a.does}</p>
                    </div>
                  </MotionCard>
                ))}
              </div>
            </Section>
          </div>

          {/* ── דוקטרינה ──────────────────────────────────────────── */}
          <Section title="דוקטרינת הפרסום" icon={<ShieldCheck className="size-4" />} className="mt-10" description="החוקים שלא נשברים">
            <ul className="grid gap-2">
              {data.doctrine.map((d, i) => (
                <motion.li
                  key={i}
                  initial={{ opacity: 0, x: 12 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.06 }}
                  className="flex items-start gap-2 rounded-lg border p-3 text-[13px] leading-relaxed"
                >
                  <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                  {d}
                </motion.li>
              ))}
            </ul>
            {data.down.length > 0 ? (
              <p className="mt-3 font-mono text-[11px] text-muted-foreground">
                מקורות שנפלו בכנות: {data.down.join(" · ")}
              </p>
            ) : null}
          </Section>
        </>
      ) : null}

      {/* ── דיאלוג אישור שידור ─────────────────────────────────────── */}
      <Dialog open={confirmTask != null} onOpenChange={(open) => !open && setConfirmTask(null)}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Send className="size-4" aria-hidden="true" />
              אישור שידור לשרשרת Steem
            </DialogTitle>
            <DialogDescription>
              הפוסט ישודר בחתימת ה-posting של <strong>{data?.keyMaterial.account ?? "הצי"}</strong> — לאחר
              אימות ביט-מול-ביט מול הרשות החיה. הפעולה פומבית וניתנת לצפייה בשרשרת.
            </DialogDescription>
          </DialogHeader>
          {confirmTask ? (
            <div className="max-h-56 overflow-y-auto rounded-lg border bg-muted/30 p-3">
              <div className="text-sm font-bold">{confirmTask.title}</div>
              <div className="mt-1 font-mono text-[10px] text-muted-foreground">
                תגיות: {confirmTask.tags} · ערוץ: steem
              </div>
              <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-muted-foreground">
                {confirmTask.id}
              </pre>
            </div>
          ) : null}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setConfirmTask(null)} disabled={broadcasting}>
              ביטול
            </Button>
            <Button
              className="gap-1.5"
              disabled={broadcasting}
              onClick={() => confirmTask && void broadcastTask(confirmTask)}
            >
              {broadcasting ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Send className="size-3.5" aria-hidden="true" />}
              {broadcasting ? "משדר…" : "אשר ושדר"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
