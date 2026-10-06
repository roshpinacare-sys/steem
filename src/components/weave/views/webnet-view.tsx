"use client";

// ─────────────────────────────────────────────────────────────────────
// SAOS WEB · תצוגת רשת-האחסון v2 — השרשרת הציבורית כשרת וכדיסק.
//
// פקודת המפעיל (R50): "אני רוצה להפוך את הרשת שלי לשרת ואחסון שאני
// יוכל להעלות אתרים אפליקציות ותוכן… האמת היא האימות של השרת על
// הרשת." פקודת ההמשך (R51): "תפתח את זה למקסימום האפשרי ויותר".
//
// v2 מוסיפה: פס-סטטיסטיקות חי (חבילות · באגים · תושבות · RC), בורר
// חבילות למגרש, דפדוף-קבצים בתוך כל חבילה (?list=1), קישורי-קבע
// להעתקה, אומדן-הגירה כן (RC + ימים), ואימות-הכל בלחיצה אחת.
// ─────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Boxes,
  CheckCircle2,
  CloudUpload,
  Copy,
  Database,
  ExternalLink,
  FileArchive,
  FileText,
  FolderTree,
  Gauge,
  Globe,
  HardDrive,
  Link2,
  ListChecks,
  Lock,
  PlayCircle,
  RefreshCw,
  ShieldCheck,
  Signal,
  Sparkles,
  UploadCloud,
  XCircle,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CopyButton,
  ErrorBox,
  FadeIn,
  HashChip,
  Section,
  fmtDateTime,
  scrollBoxClass,
  truncateMiddle,
} from "@/components/weave/shared";
import { useOperator } from "@/components/weave/operator";
import { cn } from "@/lib/utils";
import type {
  AnchorCapability,
  MigrationEstimate,
  RcProbe,
  VerifyReport,
  WebInboxJob,
  WebManifestRecord,
} from "@/lib/web/netstore";

// ── טיפוסי-המצב מה-API ──────────────────────────────────────────────

interface WebTotals {
  packages: number;
  sealed: number;
  complete: number;
  bytesTotal: number;
  charsTotal: number;
  charsOnChain: number;
  inboxWaiting: number;
  residencyPct: number;
}

interface WebState {
  ok: boolean;
  account: string;
  at: string;
  serveMs?: number;
  rc: RcProbe | null;
  packages: WebManifestRecord[];
  inbox: WebInboxJob[];
  migrations: Record<string, MigrationEstimate>;
  totals: WebTotals;
  caps: AnchorCapability[];
}

interface HealthCheck {
  name: string;
  ok: boolean;
  ms: number;
  detail: unknown;
}

interface HealthReport {
  ok: boolean;
  service: string;
  account: string;
  at: string;
  totalMs: number;
  verdict: string;
  checks: Record<string, HealthCheck>;
}

interface ZipFileStat {
  name: string;
  bytes: number;
}

interface PackageListing {
  ok: boolean;
  hash: string;
  files: ZipFileStat[];
  entry?: string;
  totalBytes: number;
}

// ── עזרים ────────────────────────────────────────────────────────────

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function fmtRc(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  return `${(n / 1e6).toFixed(0)}M`;
}

function fmtDays(d: number | null): string {
  if (d === null) return "—";
  if (d < 1) return `${Math.round(d * 24)} שעות`;
  if (d < 30) return `${d.toFixed(1)} ימים`;
  return `${(d / 30).toFixed(1)} חודשים`;
}

// ── פס-הסטטיסטיקות החי ───────────────────────────────────────────────

function StatsStrip({ state }: { state: WebState | null }) {
  const t = state?.totals;
  const rc = state?.rc ?? null;
  const cards = [
    {
      key: "packages",
      icon: FileArchive,
      tone: "border-amber-500/25 bg-amber-500/10 text-amber-600 dark:text-amber-400",
      label: "חבילות על הרשת",
      value: t ? String(t.packages) : "—",
      sub: t ? `${t.sealed} חתומות · ${t.complete} שלמות על השרשרת` : "",
    },
    {
      key: "bytes",
      icon: Database,
      tone: "border-emerald-500/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
      label: "באגים מאוחסנים",
      value: t ? fmtBytes(t.bytesTotal) : "—",
      sub: t && t.inboxWaiting > 0 ? `${t.inboxWaiting} בתור השידור` : "אמת-נצחית ב-sha256",
    },
    {
      key: "residency",
      icon: HardDrive,
      tone: "border-emerald-500/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
      label: "תושבות-שרשרת כוללת",
      value: t ? `${t.residencyPct}%` : "—",
      sub: t
        ? `${t.charsOnChain.toLocaleString("he-IL")}/${t.charsTotal.toLocaleString("he-IL")} תווים על Steem`
        : "",
    },
    {
      key: "rc",
      icon: Zap,
      tone: "border-rose-500/25 bg-rose-500/10 text-rose-600 dark:text-rose-400",
      label: "תקציב כתיבה חי (RC)",
      value: rc ? `${rc.pct}%` : "—",
      sub: rc ? `${fmtRc(rc.mana)} מתוך ${fmtRc(rc.max)}` : "RPC שקט",
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {cards.map((c, i) => {
        const Icon = c.icon;
        return (
          <FadeIn key={c.key} delay={i * 0.05}>
            <Card className="h-full p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">{c.label}</p>
                  <p className="mt-1 text-xl font-bold tabular-nums">{c.value}</p>
                  <p className="mt-1 truncate text-[11px] text-muted-foreground">{c.sub}</p>
                </div>
                <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg border", c.tone)}>
                  <Icon className="size-4" aria-hidden="true" />
                </span>
              </div>
            </Card>
          </FadeIn>
        );
      })}
    </div>
  );
}

// ── מד התקציב החי ────────────────────────────────────────────────────

function RcMeter({ rc, active }: { rc: RcProbe | null; active: MigrationEstimate | null }) {
  if (!rc) {
    return (
      <Card className="p-4">
        <p className="text-sm text-muted-foreground">מד ה-RC של חשבון האחסון לא נקרא כרגע (RPC שקט) — ננסה שוב ברענון הבא.</p>
      </Card>
    );
  }
  const tone =
    rc.pct > 40
      ? "text-emerald-600 dark:text-emerald-400"
      : rc.pct > 12
        ? "text-amber-600 dark:text-amber-400"
        : "text-rose-600 dark:text-rose-400";
  return (
    <Card className="p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400">
            <Gauge className="size-5" aria-hidden="true" />
          </span>
          <div>
            <p className="text-sm font-semibold">תקציב הכתיבה של הרשת (RC)</p>
            <p className="text-xs text-muted-foreground">
              חשבון @{rc.account} · ראש השרשרת בלוק {rc.headBlock?.toLocaleString("he-IL") ?? "—"}
            </p>
          </div>
        </div>
        <p className={cn("text-2xl font-bold tabular-nums", tone)}>{rc.pct}%</p>
      </div>
      <Progress
        value={Math.min(100, rc.pct)}
        className="mt-4 h-2.5"
        aria-label={`מאגר RC: ${rc.pct}%`}
      />
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-muted-foreground sm:grid-cols-3">
        <span>
          מאגר חי: <b className="text-foreground">{fmtRc(rc.mana)}</b> / {fmtRc(rc.max)} RC
        </span>
        <span>
          התחדשות: <b className="text-foreground">+{fmtRc(rc.regenPerDay)}</b> ביום
        </span>
        <span>
          זמן שרשרת: <b className="text-foreground">{rc.chainTime ? rc.chainTime.slice(11, 19) : "—"}</b> UTC
        </span>
      </div>
      {active ? (
        <div className="mt-4 rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="font-semibold text-emerald-700 dark:text-emerald-300">הגירה פעילה — החבילה שבדרך</span>
            <span className="tabular-nums text-muted-foreground">
              נותרו {active.remainingChars.toLocaleString("he-IL")} תווים · ~{active.chunksLeft} צ׳אנקים
            </span>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
            <span>
              נדרש: <b className="text-foreground">{fmtRc(active.rcNeeded)}</b> RC
            </span>
            <span>
              בקצב הרגנרציה הנמדד: <b className="text-foreground">{fmtDays(active.days)}</b> מהמאגר היבש
            </span>
            <span>החותם כבר על השרשרת — ההגשה חיה לאורך כל הדרך</span>
          </div>
        </div>
      ) : null}
      <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
        זה הדלק האמיתי של האחסון: כל כתיבה לשרשרת שורפת RC, והוא מתחדש מכוח ה-SP של החשבון. הרשת מפרסמת חבילות
        רק כשהמאגר מעל רצפת בטיחות — ולכן עליות גדולות מתגלגלות על פני מספר פעימות. זו האמת הכלכלית של
        שרשרת ציבורית, לא מגבלה שלנו.
      </p>
    </Card>
  );
}

// ── מה העוגנים נותנים ──────────────────────────────────────────────

function CapsGrid({ caps }: { caps: AnchorCapability[] }) {
  const icons: Record<string, typeof Globe> = {
    storage: HardDrive,
    identity: ShieldCheck,
    budget: Zap,
    index: Database,
  };
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {caps.map((c, i) => {
        const Icon = icons[c.key] ?? Globe;
        return (
          <FadeIn key={c.key} delay={i * 0.06}>
            <Card className="h-full p-4 sm:p-5">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg border border-emerald-500/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                  <Icon className="size-4.5" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{c.title}</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{c.detail}</p>
                  <p className="mt-2 text-[11px] font-medium text-amber-700 dark:text-amber-400">
                    נמדד: {c.measured}
                  </p>
                </div>
              </div>
            </Card>
          </FadeIn>
        );
      })}
    </div>
  );
}

// ── אזור ההעלאה (מפעיל) ─────────────────────────────────────────────

function UploadZone({ onDone }: { onDone: () => void }) {
  const op = useOperator();
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const doUpload = useCallback(
    async (file: File) => {
      setBusy(true);
      try {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("name", file.name);
        const res = await op.authedFetch("/api/web/publish", { method: "POST", body: fd });
        const j = (await res.json()) as {
          ok: boolean;
          error?: string;
          job?: WebInboxJob;
          note?: string;
          repackNote?: string | null;
          migration?: MigrationEstimate;
          alreadyOnChain?: boolean;
        };
        if (!res.ok || !j.ok) {
          toast.error(j.error || "ההעלאה נדחתה", { description: res.status === 401 ? "נדרשת כניסת מפעיל" : undefined });
        } else {
          const eta = j.migration?.days != null ? ` · הגירה מלאה בקצב ה-RC: כ-${fmtDays(j.migration.days)}` : "";
          toast.success(`החבילה ${file.name} נכנסה לתור השידור`, {
            description: `${j.repackNote ? j.repackNote + " · " : ""}${j.note || "סוכן הענן יעלה אותה ל-Steem כשתקציב ה-RC יאפשר"}${eta}`,
            duration: 9000,
          });
          onDone();
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "כשל רשת בהעלאה");
      } finally {
        setBusy(false);
        if (fileRef.current) fileRef.current.value = "";
      }
    },
    [op, onDone]
  );

  if (op.status === "checking") {
    return (
      <Card className="p-6">
        <div className="h-16 animate-pulse rounded-xl bg-muted" />
      </Card>
    );
  }

  if (op.status === "out") {
    return (
      <Card className="border-dashed p-6">
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl border bg-muted">
            <Lock className="size-5 text-muted-foreground" aria-hidden="true" />
          </span>
          <p className="text-sm font-semibold">העלאה נעולה — פעולת-מפעיל בלבד</p>
          <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
            כדי לכתוב על השרשרת צריך את סמכות החתימה שלה. התחבר ב״שער המפעיל״ (הסעיף הראשון בתפריט) עם מפתח
            ה-active של headcorner — ואז אזור ההעלאה ייפתח כאן.
          </p>
        </div>
      </Card>
    );
  }

  return (
    <Card
      className={cn(
        "border-dashed p-6 transition-colors",
        dragOver && "border-emerald-500/60 bg-emerald-500/5"
      )}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const f = e.dataTransfer.files?.[0];
        if (f) void doUpload(f);
      }}
    >
      <div className="flex flex-col items-center gap-4 text-center">
        <span className="flex size-14 items-center justify-center rounded-2xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
          <UploadCloud className="size-6" aria-hidden="true" />
        </span>
        <div>
          <p className="text-sm font-semibold">גרור לכאן קובץ ‎.zip‎ של אתר / אפליקציה / משחקים — או בחר</p>
          <p className="mt-1 text-xs text-muted-foreground">
            החבילה תיבדק, תיחתם ב-sha256, תידחף לריפו הריבוני — וסוכן הענן יעלה אותה ל-Steem בפוסטים חתומים
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept=".zip,.html,.htm,.svg,.png,.jpg,.jpeg,.gif,.webp,.avif,.ico,.json,.txt,.md,.csv,.css,.js,.mjs,.pdf"
            className="hidden"
            id="web-upload-input"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void doUpload(f);
            }}
          />
          <Button
            type="button"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
            className="h-11"
          >
            {busy ? <RefreshCw className="animate-spin" /> : <CloudUpload />}
            {busy ? "מעלה לתור…" : "בחר קובץ (זיפ או קובץ-רשת)"}
          </Button>
          <Badge variant="outline" className="gap-1 border-amber-500/40 text-amber-700 dark:text-amber-400">
            <Zap className="size-3" aria-hidden="true" />
            תקרה: 400KB (תקציב RC אמיתי)
          </Badge>
        </div>
        <p className="text-[11px] text-muted-foreground">
          מחובר כעת: <b>@{op.account}</b> — ההרשאה החיה היא השרשרת עצמה, לא האפליקציה · זיפים מאורזים-מחדש
          בדחיסה מקסימלית לחיסכון RC
        </p>
      </div>
    </Card>
  );
}

// ── פאנל אימות חי (הראיות) ──────────────────────────────────────────

function VerifyPanel({ hash, account }: { hash: string; account: string }) {
  const [report, setReport] = useState<VerifyReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const run = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/web/verify/${hash}`, { cache: "no-store" });
      const j = (await res.json()) as { ok: boolean; report?: VerifyReport; error?: string };
      if (j.ok && j.report) {
        setReport(j.report);
      } else {
        setErr(j.error || "האימות נכשל");
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "כשל רשת");
    } finally {
      setBusy(false);
    }
  }, [hash]);

  const curl = `curl -s -X POST https://api.steemit.com -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","method":"condenser_api.get_account_history","params":["${account}",-1,100],"id":1}'`;

  return (
    <div className="mt-3 grid gap-3 rounded-xl border bg-muted/20 p-3 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold">אימות חי מול השרשרת הציבורית</p>
        <div className="flex items-center gap-2">
          <CopyButton value={curl} label="העתק curl" />
          <Button type="button" size="sm" variant="outline" onClick={run} disabled={busy} className="h-9">
            <RefreshCw className={cn(busy && "animate-spin")} />
            {report ? "אמת שוב" : "הרץ אימות"}
          </Button>
        </div>
      </div>

      {err ? <p className="text-xs text-rose-600 dark:text-rose-400">{err}</p> : null}

      {report ? (
        <div className="grid gap-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {report.sealOnChain ? (
              <Badge className="gap-1 bg-emerald-600 text-white">
                <ShieldCheck className="size-3" aria-hidden="true" />
                חותם על {report.sealChain === "hive" ? "Hive" : "Steem"} · בלוק {report.sealBlock ?? "?"}
              </Badge>
            ) : (
              <Badge variant="destructive" className="gap-1">
                אין חותם על השרשרת
              </Badge>
            )}
            <Badge variant="outline">
              תושבות-שרשרת: {report.residencyPct}% ({report.chainChars.toLocaleString("he-IL")}/{report.b64len.toLocaleString("he-IL")} תווים)
            </Badge>
            {report.blockVerifiedChunks > 0 ? (
              <Badge variant="outline" className="border-emerald-500/40 text-emerald-700 dark:text-emerald-300">
                {report.blockVerifiedChunks} צ׳אנקים אומתו מקריאות-בלוק ממוקדות
              </Badge>
            ) : null}
            {report.repoCopy?.exists ? (
              <Badge
                variant="outline"
                className={
                  report.repoCopy.shaMatches
                    ? "border-emerald-500/40 text-emerald-700 dark:text-emerald-400"
                    : "border-rose-500/40 text-rose-600"
                }
              >
                עותק-ריפו: {report.repoCopy.shaMatches ? "תואם לחותם ✓" : "חורג מהחותם!"}
              </Badge>
            ) : null}
            <Badge variant="outline">נבדק {fmtDateTime(report.at)}</Badge>
          </div>

          {report.chainChars > 0 ? (
            <div>
              <Progress value={report.residencyPct} className="h-2" aria-label={`תושבות שרשרת ${report.residencyPct}%`} />
              <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                הבייטים נודדים מהמחסן הריבוני אל השרשרת בקצב ה-RC — והחותם שעל השרשרת מחייב שני מקורות לאותו sha256 בדיוק.
                הצ׳אנק הבא ברצף: מס׳ {report.nextMissingChunk ?? "—"}.
              </p>
            </div>
          ) : null}

          <p className="text-[11px] text-muted-foreground">
            sha256 מהרכב-השרשרת:{" "}
            <span className="font-mono">{report.assembledSha ?? "—"}</span>
            {report.ok ? " — התאמה מלאה ✓" : report.chainChars > 0 ? " — ההרכבה עדיין חלקית" : ""}
          </p>

          <div className="grid gap-1 text-[11px] text-muted-foreground sm:grid-cols-2">
            <span>
              עומק-סריקה Steem:{" "}
              <b className="text-foreground">
                {report.scan.steem
                  ? `${report.scan.steem.entriesScanned.toLocaleString("he-IL")}/${(report.scan.steem.entriesTotal ?? 0).toLocaleString("he-IL")} רשומות (${report.scan.steem.pagesScanned} עימודים)`
                  : "—"}
              </b>
            </span>
            <span>
              עומק-סריקה Hive:{" "}
              <b className="text-foreground">
                {report.scan.hive
                  ? `${report.scan.hive.entriesScanned.toLocaleString("he-IL")}/${(report.scan.hive.entriesTotal ?? 0).toLocaleString("he-IL")} רשומות`
                  : "לא נדרש"}
              </b>
            </span>
          </div>

          <details className="group">
            <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground">
              הראיה הגולמית — פלט האימות המלא (JSON)
            </summary>
            <pre
              dir="ltr"
              className={cn("mt-2 rounded-lg bg-zinc-950 p-3 text-[10px] leading-relaxed text-zinc-200", scrollBoxClass, "max-h-72")}
            >
              {JSON.stringify(report, null, 2)}
            </pre>
          </details>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          לחץ ״הרץ אימות״ — השרת יקרא עכשיו, ללא מטמון, כל צ׳אנק מה-RPC הציבורי וישווה חשיש-מול-חשיש.
        </p>
      )}
    </div>
  );
}

// ── דפדוף קבצי החבילה ────────────────────────────────────────────────

function FileBrowser({ hash, entry }: { hash: string; entry?: string }) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<PackageListing | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open || list) return;
    let alive = true;
    const t = setTimeout(() => {
      if (!alive) return;
      setBusy(true);
      setErr(null);
      fetch(`/api/web/c/${hash}?list=1`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j: PackageListing & { error?: string }) => {
        if (!alive) return;
        if (j.ok) setList(j);
        else setErr(j.error || "הרישום נכשל");
      })
      .catch((e) => {
        if (alive) setErr(e instanceof Error ? e.message : "כשל רשת");
      })
      .finally(() => {
        if (alive) setBusy(false);
      });
    }, 0);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [open, hash, list]);

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <FolderTree className={cn("size-3.5 transition-transform", open && "rotate-90")} aria-hidden="true" />
        {open ? "סגור קבצי חבילה" : "עיין בקבצי החבילה"}
      </button>
      {open ? (
        <div className="mt-2 rounded-xl border bg-muted/20 p-3">
          {busy ? (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <RefreshCw className="size-3.5 animate-spin" aria-hidden="true" />
              קורא את רשימת הקבצים מהשער המאומת…
            </p>
          ) : err ? (
            <p className="text-xs text-rose-600 dark:text-rose-400">{err}</p>
          ) : list ? (
            <ul className={cn("grid gap-1", scrollBoxClass, "max-h-64")}>
              {list.files.map((f) => (
                <li key={f.name}>
                  <a
                    href={`/api/web/c/${hash}/${f.name}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-muted"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <FileText className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <span dir="ltr" className="truncate font-mono text-[11px]">{f.name}</span>
                      {f.name === entry ? (
                        <Badge variant="outline" className="h-4 shrink-0 px-1.5 text-[10px] text-emerald-700 dark:text-emerald-400">
                          כניסה
                        </Badge>
                      ) : null}
                    </span>
                    <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{fmtBytes(f.bytes)}</span>
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ── כרטיס חבילה ──────────────────────────────────────────────────────

function PackageCard({
  rec,
  account,
  isFeatured,
  migration,
}: {
  rec: WebManifestRecord;
  account: string;
  isFeatured: boolean;
  migration: MigrationEstimate | null;
}) {
  const m = rec.manifest;
  const playable = rec.status === "partial" || rec.status === "complete";
  const chunks = rec.chain.chunks ?? [];
  const chainChars = chunks.reduce((s, c) => s + c.chars, 0);
  const residencyPct = m.b64len ? Math.min(100, Math.round((chainChars / m.b64len) * 100)) : 0;
  const sealed = rec.status !== "pending-seal";
  const blocks = [
    rec.chain.manifestOp?.block,
    ...chunks.map((c) => c.block),
  ].filter((b): b is number => typeof b === "number" && b > 0);
  const lastBlock = blocks.length ? Math.max(...blocks) : null;
  const link = `/api/web/c/${m.sha256}`;

  return (
    <Card className={cn("h-full p-4 sm:p-5", isFeatured && "border-amber-500/30")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className={cn(
              "flex size-11 shrink-0 items-center justify-center rounded-xl border",
              sealed
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                : "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400"
            )}
          >
            <FileArchive className="size-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate text-sm font-bold">{m.name}</p>
              {rec.status === "complete" ? (
                <Badge className="gap-1 bg-emerald-600 text-white">
                  <ShieldCheck className="size-3" aria-hidden="true" />
                  כולה על השרשרת
                </Badge>
              ) : sealed ? (
                <Badge variant="outline" className="gap-1 border-emerald-500/40 text-emerald-700 dark:text-emerald-400">
                  חתום · מהגר בקצב RC
                </Badge>
              ) : (
                <Badge variant="outline" className="gap-1 border-amber-500/40 text-amber-700 dark:text-amber-400">
                  ממתין לחותם
                </Badge>
              )}
              <Badge variant="outline">{chunks.length} צ׳אנקים על השרשרת</Badge>
              {isFeatured ? (
                <Badge variant="outline" className="gap-1 border-amber-500/40 text-amber-700 dark:text-amber-400">
                  <Sparkles className="size-3" aria-hidden="true" />
                  במגרש
                </Badge>
              ) : null}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {fmtBytes(m.bytes)} · {m.mime === "application/zip" ? "ארכיון zip" : "קובץ יחיד"} ·{" "}
              {fmtDateTime(m.at)}
              {lastBlock ? ` · בלוק ${lastBlock.toLocaleString("he-IL")}` : ""}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <HashChip value={m.sha256} label="sha256" head={10} tail={8} />
              <span className="font-mono text-[11px] text-muted-foreground">
                @{account} · saos.web.v1
              </span>
            </div>
            {m.b64len > 0 ? (
              <div className="mt-3 max-w-md">
                <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>תושבות-שרשרת</span>
                  <span className="tabular-nums">
                    {residencyPct}% ({chainChars.toLocaleString("he-IL")}/{m.b64len.toLocaleString("he-IL")} תווים)
                  </span>
                </div>
                <Progress value={residencyPct} className="mt-1 h-1.5" aria-label={`תושבות שרשרת ${residencyPct}%`} />
                {migration && residencyPct < 100 ? (
                  <p className="mt-1.5 text-[11px] text-muted-foreground">
                    נותרו להגירה: {fmtRc(migration.rcNeeded)} RC ≈ {fmtDays(migration.days)} רגנרציה — החותם כבר
                    על השרשרת, וההגשה חיה לכל אורך הדרך
                  </p>
                ) : null}
              </div>
            ) : null}
            <FileBrowser hash={m.sha256} entry={m.entry} />
          </div>
        </div>
        <div className="flex flex-col gap-2">
          {playable ? (
            <Button asChild size="sm" className="h-9">
              <a href={`${link}/`} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="size-3.5" aria-hidden="true" />
                פתח
              </a>
            </Button>
          ) : null}
          <Button asChild variant="outline" size="sm" className="h-9">
            <a href={`${link}?raw=1`} target="_blank" rel="noopener noreferrer">
              <FileArchive className="size-3.5" aria-hidden="true" />
              הורד (raw)
            </a>
          </Button>
          <CopyButton value={link} label="העתק קישור-קבע" className="h-9" />
        </div>
      </div>

      <VerifyPanel hash={m.sha256} account={account} />
    </Card>
  );
}

// ── מגרש המשחקים (iframe מהשרשרת) ───────────────────────────────────

function Playground({
  rec,
  others,
  onPick,
}: {
  rec: WebManifestRecord;
  others: WebManifestRecord[];
  onPick: (hash: string) => void;
}) {
  const [key, setKey] = useState(0);
  const [state, setState] = useState<"loading" | "ok" | "err">("loading");
  const src = `/api/web/c/${rec.manifest.sha256}/index.html`;

  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      if (!alive) return;
      setState("loading");
      fetch(`/api/web/c/${rec.manifest.sha256}/index.html`, { cache: "no-store" })
        .then((r) => {
          if (!alive) return;
          setState(r.ok ? "ok" : "err");
        })
        .catch(() => {
          if (alive) setState("err");
        });
    }, 0);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [rec.manifest.sha256, key]);

  return (
    <Card className="overflow-hidden p-0">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/30 px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <PlayCircle className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
          מגרש הרשת — מוגש תחת חותם-השרשרת
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {others.length > 1 ? (
            <Select value={rec.manifest.sha256} onValueChange={onPick}>
              <SelectTrigger className="h-8 w-48 text-xs" aria-label="בחר חבילה">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {others.map((p) => (
                  <SelectItem key={p.manifest.sha256} value={p.manifest.sha256} className="text-xs">
                    {p.manifest.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          <Button variant="outline" size="sm" className="h-8" onClick={() => setKey((k) => k + 1)}>
            <RefreshCw className="size-3.5" />
            טען מחדש
          </Button>
          <Button asChild size="sm" className="h-8">
            <a href={src} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="size-3.5" />
              חלון חדש
            </a>
          </Button>
        </div>
      </div>
      <div className="relative aspect-[16/10] w-full bg-zinc-950">
        {state === "loading" ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-zinc-400">
            <RefreshCw className="size-6 animate-spin" aria-hidden="true" />
            <p className="text-xs">מאתר את החותם על השרשרת ומאמת את הבייטים מול sha256…</p>
          </div>
        ) : null}
        {state === "err" ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center text-zinc-400">
            <p className="text-sm font-semibold text-rose-400">המגרש לא נטען מהשרשרת</p>
            <p className="max-w-md text-xs leading-relaxed">
              ייתכן שהחבילה עדיין בשידור (מחכה לתקציב RC) — נסה ״טען מחדש״ בעוד כמה דקות, או בדוק את כרטיס
              החבילה למטה.
            </p>
          </div>
        ) : null}
        <iframe
          key={key}
          src={state === "ok" ? src : "about:blank"}
          title={`מגרש הרשת ${rec.manifest.name}`}
          className={cn("h-full w-full border-0", state !== "ok" && "invisible")}
          onLoad={() => {
            /* החבילה חיה */
          }}
        />
      </div>
      <div className="border-t bg-muted/20 px-4 py-2.5 text-[11px] leading-relaxed text-muted-foreground">
        כל טעינה של המגרש הזה עוברת את שער <b dir="ltr">/api/web/c/</b> — שמאתר את החותם (sha256) על השרשרת הציבורית
        (סריקה-עמוקה + קריאות-בלוק ממוקדות), מאמת את הבייטים מולו, ורק אז מגיש. שחקו וידעו שהשרשרת היא השופטת.
      </div>
    </Card>
  );
}

// ── פאנל האימות-העצמי של השרת (/api/health) ──────────────────────────

const HEALTH_CHECKS: Array<{ key: string; label: string; desc: string }> = [
  { key: "db", label: "מסד-הנתונים", desc: "SQLite עונה בפועל — לא ״מחובר״" },
  { key: "vault", label: "המחסן הריבוני", desc: "מניפסטים + בייטים על הדיסק" },
  { key: "integrity", label: "שלמות sha256", desc: "הבייטים במחסן מול החותם שנחתם בשרשרת" },
  { key: "rpc", label: "צומת Steem", desc: "ה-RPC הציבורי עונה עכשיו" },
  { key: "seals", label: "החותמים", desc: "כתובת-בלוק וצ׳אנקים לכל חבילה" },
];

function healthDetailLine(key: string, d: unknown): string {
  if (!d || typeof d !== "object") return "";
  const o = d as Record<string, unknown>;
  switch (key) {
    case "db":
      return `${o.tables} טבלאות`;
    case "vault":
      return typeof o.bytesOnDisk === "number" ? `${o.packages} חבילות · ${fmtBytes(o.bytesOnDisk)}` : "מחסן ריק — תקין";
    case "integrity":
      return typeof o.verified === "number" ? `${o.verified} חבילות — חשיש תואם` : String(o.note ?? "");
    case "rpc": {
      const pct = typeof o.pct === "number" ? `${o.pct}%` : "?";
      const blk = typeof o.headBlock === "number" ? `בלוק ${o.headBlock.toLocaleString("en-US")}` : "";
      const stale = o.stale ? " · דגימה עמומה (הרשת נפלה — מוגשת בכנות)" : "";
      return `RC ${pct} · ${blk}${stale}`;
    }
    case "seals": {
      const arr = Array.isArray(o.packages) ? (o.packages as Array<Record<string, unknown>>) : [];
      return arr
        .map((p) => `${p.sealBlock ? `בלוק ${p.sealBlock}` : "טרם נחתם"} · ${p.residencyPct}% על-השרשרת`)
        .join(" · ");
    }
    default:
      return "";
  }
}

function HealthPanel({ stateServeMs }: { stateServeMs?: number }) {
  const [rep, setRep] = useState<HealthReport | null>(null);
  const [busy, setBusy] = useState(false);

  const run = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/health", { cache: "no-store" });
      const j = (await res.json()) as HealthReport;
      setRep(j);
      if (j.ok) {
        toast.success("השרת אומת — כל המרכיבים עובדים", {
          description: `נמדח עכשיו ב-${j.totalMs} אלפיות-שנייה — לא מונח, לא מובטח.`,
        });
      } else {
        toast.error("יש כשל במרכיבי השרת", {
          description: "מדווח בכנות בפאנל — כל בדיקה מופרדת.",
        });
      }
    } catch (e) {
      toast.error("בדיקת-הבריאות עצמה נכשלה", {
        description: e instanceof Error ? e.message : "כשל רשת",
      });
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/20 px-4 py-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold">בדיקה חיה של כל מרכיבי הקונסולה</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {rep
              ? `${rep.verdict} · סה״כ ${rep.totalMs}ms`
              : "עדיין לא נמדד הפעם — לחץ ״אמת את השרת״ וקבל אמת מדודה"}
            {typeof stateServeMs === "number" ? ` · מצב-הרשת נוצר ב-${stateServeMs}ms` : ""}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={run} disabled={busy} className="h-9">
          <RefreshCw className={cn(busy && "animate-spin")} />
          אמת את השרת
        </Button>
      </div>
      <div className="grid gap-2 p-4 sm:grid-cols-2 xl:grid-cols-3">
        {HEALTH_CHECKS.map((c) => {
          const r = rep?.checks[c.key];
          const line = r ? healthDetailLine(c.key, r.detail) : "";
          return (
            <div
              key={c.key}
              className={cn(
                "flex items-start gap-2.5 rounded-lg border p-3",
                !r && "border-border bg-card",
                r?.ok && "border-emerald-600/30 bg-emerald-500/5",
                r && !r.ok && "border-red-600/40 bg-red-500/5",
              )}
            >
              {r?.ok ? (
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" aria-hidden="true" />
              ) : r ? (
                <XCircle className="mt-0.5 size-4 shrink-0 text-red-500" aria-hidden="true" />
              ) : (
                <Activity className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              )}
              <div className="min-w-0">
                <p className="text-xs font-semibold">{c.label}</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                  {r ? line || c.desc : c.desc}
                  {r ? <span className="font-mono"> · {r.ms}ms</span> : null}
                </p>
              </div>
            </div>
          );
        })}
      </div>
      <div className="border-t bg-muted/20 px-4 py-2.5 text-[11px] leading-relaxed text-muted-foreground">
        הבדיקה הזו היא המוצר: <b dir="ltr">/api/health</b> זמין לכל מי שרוצה לאמת את השרת מבחוץ — כל בדיקה נמדדת
        בנפרד בזמן-אמת, כישלון מדווח ככישלון (HTTP 503), והצלחה נותנת 200 בלבד כשכולם עוברות.
      </div>
    </Card>
  );
}

// ── התצוגה הראשית ───────────────────────────────────────────────────

export function WebNetView() {
  const [state, setState] = useState<WebState | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pickedHash, setPickedHash] = useState<string | null>(null);
  const [verifyAll, setVerifyAll] = useState<{ running: boolean; done: number; total: number; pass: number }>({
    running: false,
    done: 0,
    total: 0,
    pass: 0,
  });

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/web/state", { cache: "no-store" });
      const j = (await res.json()) as WebState;
      if (j.ok) {
        setState(j);
        setErr(null);
      } else {
        setErr("תשובת שרת לא תקינה");
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "כשל רשת");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 60_000);
    return () => clearInterval(t);
  }, [load]);

  const playable = useMemo(
    () => (state?.packages ?? []).filter((p) => p.status === "partial" || p.status === "complete"),
    [state]
  );
  const active = useMemo(() => playable.find((p) => p.manifest.sha256 === pickedHash) ?? playable[0] ?? null, [playable, pickedHash]);
  const activeMigration = useMemo(
    () =>
      active && state?.migrations
        ? state.migrations[active.manifest.sha256] ?? null
        : null,
    [active, state]
  );

  const runVerifyAll = useCallback(async () => {
    if (!state?.packages.length) return;
    const hashes = state.packages.map((p) => p.manifest.sha256);
    setVerifyAll({ running: true, done: 0, total: hashes.length, pass: 0 });
    let pass = 0;
    for (let i = 0; i < hashes.length; i++) {
      try {
        const res = await fetch(`/api/web/verify/${hashes[i]}`, { cache: "no-store" });
        const j = (await res.json()) as { ok: boolean; report?: VerifyReport };
        if (j.ok && j.report?.sealOnChain) pass++;
      } catch {
        /* ספירת-כשל כנה */
      }
      setVerifyAll({ running: true, done: i + 1, total: hashes.length, pass });
    }
    setVerifyAll({ running: false, done: hashes.length, total: hashes.length, pass });
    toast.success(`אימות-הכל הושלם: ${pass}/${hashes.length} חותמים על השרשרת`, {
      description: "כל אימות קרא את השרשרת הציבורית בסריקה-עמוקה — בלי מטמון, בלי אמון.",
    });
  }, [state]);

  return (
    <div className="mx-auto grid w-full max-w-7xl gap-8 px-4 py-8 sm:px-6">
      {/* כותרת */}
      <FadeIn>
        <div className="grid gap-4">
          <div className="flex items-center gap-2 text-xs font-semibold tracking-widest text-amber-600 dark:text-amber-400">
            <Globe className="size-3.5" aria-hidden="true" />
            R51 · רשת-האחסון הריבונית — דור שני
          </div>
          <h1 className="max-w-3xl text-2xl font-bold leading-tight tracking-tight sm:text-3xl">
            הרשת היא השרת. השרשרת היא הדיסק.
          </h1>
          <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
            כל אתר, אפליקציה ומשחק שמועלה לכאן נחתם ב-sha256 על שרשרת ציבורית (custom_json בסמכות posting), והבייטים
            עצמם נודדים מהמחסן הריבוני אל השרשרת בקצב ה-RC האמיתי. השער שמגיש אותם לא סומך על שום עותק: כל הגשה
            מאומתת מול החותם שעל השרשרת — בסריקה-עמוקה שמכירה את כל ההיסטוריה, ובקריאות-בלוק ממוקדות לכל צ׳אנק.
            <b> האמת היא האימות של השרת על הרשת.</b>
          </p>
        </div>
      </FadeIn>

      {err ? <ErrorBox message={err} onRetry={load} retrying={busy} /> : null}

      {/* פס-סטטיסטיקות */}
      <FadeIn delay={0.04}>
        <StatsStrip state={state} />
      </FadeIn>

      {/* אימות-עצמי של השרת */}
      <FadeIn delay={0.06}>
        <Section
          title="האימות-העצמי של השרת"
          description="חמש בדיקות חיות — DB · מחסן · שלמות מול החותם · RPC · חותמים — כל אחת נמדדת בנפרד"
          icon={<Activity />}
        >
          <HealthPanel stateServeMs={state?.serveMs} />
        </Section>
      </FadeIn>

      {/* מד RC */}
      <FadeIn delay={0.08}>
        <Section
          title="כוח הכתיבה של הרשת — מד חי"
          description="Resource Credits של חשבון העוגן: הדלק האמיתי שמזיז תוכן לשרשרת"
          icon={<Gauge />}
        >
          <RcMeter rc={state?.rc ?? null} active={activeMigration} />
        </Section>
      </FadeIn>

      {/* מה העוגנים נותנים */}
      <FadeIn delay={0.12}>
        <Section
          title="מה העוגנים נותנים לנו"
          description="ארבע אבני-היסוד שהרשת כבר מחזיקה — עליהן נבנה תשתית האחסון"
          icon={<Boxes />}
        >
          <CapsGrid caps={state?.caps ?? []} />
        </Section>
      </FadeIn>

      {/* העלאה */}
      <FadeIn delay={0.16}>
        <Section
          title="העלאת חבילה לרשת"
          description="אתר · אפליקציה · משחקים — קובץ zip עם index.html, או קובץ-רשת בודד"
          icon={<CloudUpload />}
        >
          <UploadZone
            onDone={() => {
              void load();
            }}
          />
        </Section>
      </FadeIn>

      {/* מגרש הרשת */}
      {active ? (
        <FadeIn delay={0.2}>
          <Section
            title="מגרש הרשת — מוגש תחת חותם-השרשרת"
            description={
              active.status !== "pending-seal"
                ? `חבילת ${active.manifest.name}: ה-sha256 שלה חתום על שרשרת ציבורית — כל טעינה עוברת אימות מול החותם`
                : `חבילת ${active.manifest.name}: החותם בדרך — מוגש מהמחסן הריבוני עד שהצ'אנקים נסלקים על השרשרת`
            }
            icon={<PlayCircle />}
          >
            <Playground rec={active} others={playable} onPick={setPickedHash} />
          </Section>
        </FadeIn>
      ) : null}

      {/* חבילות */}
      <FadeIn delay={0.24}>
        <Section
          title="חבילות על הרשת"
          description={
            state?.packages.length
              ? `${state.packages.length} חבילות · אימות חי בלחיצה — כל צ׳אנק, כל חשיש, בכל עומק ההיסטוריה`
              : "אין חבילות עדיין — הראשונה בדרך"
          }
          icon={<HardDrive />}
          action={
            <div className="flex flex-wrap items-center gap-2">
              {state?.packages.length ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={runVerifyAll}
                  disabled={verifyAll.running || busy}
                  className="h-9"
                >
                  {verifyAll.running ? (
                    <RefreshCw className="animate-spin" />
                  ) : (
                    <ListChecks />
                  )}
                  {verifyAll.running
                    ? `מאמת ${verifyAll.done}/${verifyAll.total}…`
                    : verifyAll.total > 0 && !verifyAll.running
                      ? `אמת הכל (${verifyAll.pass}/${verifyAll.total} ✓)`
                      : "אמת את כל החבילות"}
                </Button>
              ) : null}
              <Button variant="outline" size="sm" onClick={load} disabled={busy} className="h-9">
                <RefreshCw className={cn(busy && "animate-spin")} />
                רענן
              </Button>
            </div>
          }
        >
          {state?.packages.length ? (
            <div className="grid gap-4">
              {state.packages.map((p) => (
                <PackageCard
                  key={p.manifest.sha256}
                  rec={p}
                  account={state.account}
                  isFeatured={active?.manifest.sha256 === p.manifest.sha256}
                  migration={state.migrations[p.manifest.sha256] ?? null}
                />
              ))}
            </div>
          ) : (
            <Card className="border-dashed p-6 text-center text-sm text-muted-foreground">
              <Signal className="mx-auto mb-2 size-5" aria-hidden="true" />
              {state?.inbox.length
                ? "חבילה ראשונה בתור השידור — הצ׳אנקים יעלו כשתקציב ה-RC יאפשר (המד למעלה מתעדכן)"
                : "העלה חבילה ראשונה — והיא תיכנס להיסטוריה של השרשרת"}
            </Card>
          )}
        </Section>
      </FadeIn>

      {/* דואר נכנס */}
      {state?.inbox.length ? (
        <FadeIn delay={0.28}>
          <Section
            title="דואר נכנס — ממתין לשידור"
            description="סוכן הענן מנסה כל 20 דקות; קווי העוגן מדלגים בכנות כל עוד התור לא ריק (עדיפות להעלאה)"
            icon={<CloudUpload />}
          >
            <div className="grid gap-3">
              {state.inbox.map((j) => (
                <Card key={j.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{j.name}</p>
                    <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span>{fmtBytes(j.bytes)}</span>
                      <span>·</span>
                      <span>נכנס {fmtDateTime(j.createdAt)}</span>
                      <span>·</span>
                      <span className="font-mono">{truncateMiddle(j.sha256, 10, 8)}</span>
                    </p>
                    {j.lastNote ? (
                      <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
                        ניסיון {j.attempts ?? 1}: {j.lastNote}
                      </p>
                    ) : null}
                  </div>
                  <Badge variant="outline" className="gap-1 border-amber-500/40 text-amber-700 dark:text-amber-400">
                    <RefreshCw className="size-3" aria-hidden="true" />
                    {j.status === "pending" ? "ממתין ל-RC" : j.status}
                  </Badge>
                </Card>
              ))}
            </div>
          </Section>
        </FadeIn>
      ) : null}
    </div>
  );
}
