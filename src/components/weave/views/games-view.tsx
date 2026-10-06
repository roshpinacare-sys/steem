"use client";

// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · מרכז המשחקים — הריבוני (R55).
//
// כל משחק בעמוד הזה מוגש מרשת-האחסון הריבונית דרך שעת
// /api/web/c/<sha256>/ — לא מה-repo, לא מ-CDN, לא מספק כלשהו.
// משחקי-המזל: בידור בלבד, נקודות וירטואליות בדפדפן בלבד,
// אין כסף אמיתי, אין הימורים, אין הפקדות ואין משיכות.
// ─────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useState } from "react";
import { ExternalLink, Gamepad2, RefreshCw, ShieldCheck, Sparkles } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

// ── טיפוסים (מוקטנים מה-API) ───────────────────────────────────────

interface WebManifest {
  name: string;
  sha256: string;
  bytes: number;
  entry?: string;
  b64len: number;
  at?: string;
}

interface WebManifestRecord {
  manifest: WebManifest;
  status: "pending-seal" | "partial" | "complete";
  chain?: { manifestOp?: { block?: number | null } | null; chunks?: Array<{ chars?: number }> };
}

interface WebState {
  ok: boolean;
  packages: WebManifestRecord[];
}

interface ListedFile {
  name: string;
  bytes: number;
}

// ── מטא-דאטה של משחקים ידועים (לפי שם קובץ בחבילה) ──────────────────

const GAME_META: Record<string, { icon: string; name: string; desc: string; luck: boolean }> = {
  "dice.html": { icon: "🎲", name: "קוביית המזל", desc: "בחר יעד · מעל או מתחת", luck: true },
  "coinflip.html": { icon: "🪙", name: "הטלת מטבע", desc: "עץ או פאלי · רצף מנצח", luck: true },
  "wheel.html": { icon: "🎡", name: "גלגל המזל", desc: "8 מקטעים · עד פי 3", luck: true },
  "slots.html": { icon: "🎰", name: "מכונת המזל", desc: "שלוש טבעות · שביעיות משלמות", luck: true },
  "hilo.html": { icon: "🃏", name: "גבוה או נמוך", desc: "נחש את הקלף הבא · מיקוח", luck: true },
  "snake.html": { icon: "🐍", name: "הנחש", desc: "חצים או החלקה · אכול וגדול", luck: false },
  "g2048.html": { icon: "🔢", name: "2048", desc: "חבר אריחים עד המטרה", luck: false },
  "breakout.html": { icon: "🧱", name: "מחסל לבנים", desc: "עכבר או אצבע · אל תפסיד את הכדור", luck: false },
  "memory.html": { icon: "🃏", name: "זיכרון", desc: "מצא זוגות בפחות מהלוכות", luck: false },
};

function gameMeta(file: string) {
  return (
    GAME_META[file] ?? {
      icon: "🎮",
      name: file.replace(/\.html?$/i, ""),
      desc: "משחק מהחבילה",
      luck: false,
    }
  );
}

/** המשחק הראשון שנמצא בחבילות — ברירת מחדל נגזרת, בלי מצב */
function firstGameOf(
  pkgs: WebManifestRecord[],
  listings: Record<string, ListedFile[]>
): { hash: string; file: string } | null {
  for (const p of pkgs) {
    const files = listings[p.manifest.sha256] ?? [];
    const entry = files.find((f) => f.name !== "index.html" && f.name.endsWith(".html"));
    if (entry) return { hash: p.manifest.sha256, file: entry.name };
  }
  return null;
}

// ── התצוגה ──────────────────────────────────────────────────────────

export function GamesView() {
  const [state, setState] = useState<WebState | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [listings, setListings] = useState<Record<string, ListedFile[]>>({});
  // המשחק הפעיל במגרש: hash + קובץ
  const [active, setActive] = useState<{ hash: string; file: string } | null>(null);
  const [frameKey, setFrameKey] = useState(0);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/web/state", { cache: "no-store" });
      const j = (await res.json()) as WebState;
      setState(j);
      setErr(null);
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

  // חבילות-משחקים בלבד: זיפים עם דלת-כניסה (index.html) — משחחקים מכל סוג
  const gamePackages = useMemo(
    () =>
      (state?.packages ?? [])
        .filter((p) => p.manifest?.entry === "index.html")
        .sort((a, b) => (b.manifest.at || "").localeCompare(a.manifest.at || "")),
    [state]
  );

  // רשימת-קבצים לכל חבילה — דפדוף התוכן מהשעת
  useEffect(() => {
    for (const p of gamePackages) {
      const h = p.manifest.sha256;
      if (listings[h]) continue;
      fetch(`/api/web/c/${h}?list=1`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((j: { files?: ListedFile[] } | null) => {
          if (j?.files) setListings((prev) => (prev[h] ? prev : { ...prev, [h]: j.files as ListedFile[] }));
        })
        .catch(() => {
          /* דפדוף לא קריטי */
        });
    }
  }, [gamePackages, listings]);

  const pick = (hash: string, file: string) => {
    setActive({ hash, file });
    setFrameKey((k) => k + 1);
  };

  // המשחק הפעיל: בחירה מפורשת, או נגזר בטוח מהחבילות — גזירה טהורה בלי effect
  const activeGame = active ?? firstGameOf(gamePackages, listings);

  const activeSrc = activeGame ? `/api/web/c/${activeGame.hash}/${activeGame.file}` : null;
  const totalGames = useMemo(
    () =>
      gamePackages.reduce(
        (s, p) => s + (listings[p.manifest.sha256] ?? []).filter((f) => f.name.endsWith(".html") && f.name !== "index.html").length,
        0
      ),
    [gamePackages, listings]
  );

  return (
    <div className="mx-auto w-full max-w-6xl space-y-8 px-4 py-8 sm:px-6 sm:py-10">
      {/* ── פתיח ── */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge className="border-[#d4af37]/40 bg-[#d4af37]/10 text-[#e8cd6e]">
            <Gamepad2 className="me-1 size-3.5" aria-hidden="true" />
            מרכז המשחקים
          </Badge>
          <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400">
            <ShieldCheck className="me-1 size-3.5" aria-hidden="true" />
            ריבוני · לא בריפו · לא אצל ספק
          </Badge>
        </div>
        <h1 className="text-2xl font-black tracking-tight sm:text-3xl">המשחקים של הרשת</h1>
        <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
          כל משחק כאן מוגש מרשת-האחסון הריבונית — חבילות מכתובות-תוכן (sha256) שעוברות את שעת{" "}
          <b dir="ltr">/api/web/c/</b>. הקוד של המשחקים לא נמצא בריפו, לא ב-CDN ולא אצל שום ספק: הוא חי
          על הרשת שלנו בלבד.
        </p>
      </div>

      {/* ── כתב-ויתור גלוי — בידור בלבד ── */}
      <Alert className="border-amber-500/30 bg-amber-500/5">
        <Sparkles className="size-4 text-amber-500" aria-hidden="true" />
        <AlertTitle className="text-sm font-bold text-amber-600 dark:text-amber-400">
          משחקי בידור בלבד · נקודות וירטואליות
        </AlertTitle>
        <AlertDescription className="text-xs leading-relaxed">
          משחקי-המזל משוחקים בנקודות וירטואליות שנשמרות בדפדפן שלך בלבד. אין כסף אמיתי, אין הימורים,
          אין הפקדות ואין משיכות של דבר — וניתן לאפס את הארנק חינם בכל רגע. כל סבב נגזר ב-sha256
          מזרע גלוי, והחישוב שקוף לעין.
        </AlertDescription>
      </Alert>

      {err ? (
        <Card className="p-4 text-sm text-rose-500">
          טעינת מצב-הרשת נכשלה: {err} — נסה רענון, או בדוק את תצוגת רשת-האחסון.
        </Card>
      ) : null}

      {/* ── פס סטטיסטיקות ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card className="p-4">
          <p className="text-2xl font-black tabular-nums">{gamePackages.length}</p>
          <p className="text-xs text-muted-foreground">חבילות משחקים</p>
        </Card>
        <Card className="p-4">
          <p className="text-2xl font-black tabular-nums">{totalGames || "…"}</p>
          <p className="text-xs text-muted-foreground">משחקים לשחק</p>
        </Card>
        <Card className="p-4">
          <p className="text-2xl font-black tabular-nums">
            {gamePackages.filter((p) => p.status === "complete").length}/{Math.max(gamePackages.length, 1)}
          </p>
          {/* r124 · כנות: partial = מניפסט חתום, צ׳אנקים בדרך — לא “חתום על שרשרת” מלא */}
          <p className="text-xs text-muted-foreground">
            חתומות על שרשרת{gamePackages.some((p) => p.status === "partial") ? " (כולל חלקיות: מניפסט ✓ · צ׳אנקים בדרך)" : ""}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-2xl font-black tabular-nums">
            {gamePackages.reduce((s, p) => s + p.manifest.bytes, 0).toLocaleString("he-IL")}
          </p>
          <p className="text-xs text-muted-foreground">בייטים במחסן הריבוני</p>
        </Card>
      </div>

      {/* ── המגרש ── */}
      {activeSrc ? (
        <Card className="overflow-hidden p-0">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/30 px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Gamepad2 className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
              המגרש — מוגש משעת הרשת
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" className="h-8" disabled={busy} onClick={() => setFrameKey((k) => k + 1)}>
                <RefreshCw className={cn("size-3.5", busy && "animate-spin")} />
                טען מחדש
              </Button>
              <Button asChild size="sm" className="h-8">
                <a href={activeSrc} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="size-3.5" />
                  חלון חדש
                </a>
              </Button>
            </div>
          </div>
          <div className="h-[68vh] min-h-[460px] w-full bg-zinc-950">
            <iframe
              key={frameKey}
              id="games-frame"
              src={activeSrc}
              title="מגרש המשחקים"
              className="h-full w-full border-0"
            />
          </div>
          <div className="border-t bg-muted/20 px-4 py-2.5 text-[11px] leading-relaxed text-muted-foreground">
            המשחק הזה זורם משעת <b dir="ltr">/api/web/c/</b> — כתובת-תוכן שמאומתת ב-sha256 מול החותם שעל
            השרשרת, או מוגשת מהמחסן הריבוני בסימון כן. הקוד לא בריפו — הוא של הרשת.
          </div>
        </Card>
      ) : gamePackages.length === 0 && !busy && !err ? (
        // R120 · כנות-מצב-ריק: אין טעינה-נצחית — אמת גלויה כשאין חבילות
        <Card className="flex h-40 flex-col items-center justify-center gap-2 p-4 text-center text-sm text-muted-foreground">
          <span>אין חבילות-משחקים ברשת-האחסון כרגע.</span>
          <span className="text-xs">
            חבילות שיפורסמו למחסן הריבוני יופיעו כאן מיד — המרכז אינו מעמיד פני טעינה.
          </span>
        </Card>
      ) : (
        <Card className="flex h-40 items-center justify-center text-sm text-muted-foreground">
          בוחר משחק מהחבילות…
        </Card>
      )}

      {/* ── חבילות המשחקים ── */}
      {gamePackages.map((p) => {
        const files = (listings[p.manifest.sha256] ?? [])
          .filter((f) => f.name.endsWith(".html") && f.name !== "index.html")
          .sort((a, b) => a.name.localeCompare(b.name));
        const isLuck = /luck/i.test(p.manifest.name);
        const sealed = p.status !== "pending-seal";
        const partial = p.status === "partial";
        const block = p.chain?.manifestOp?.block ?? null;
        return (
          <section key={p.manifest.sha256} className="space-y-3" aria-label={`חבילה ${p.manifest.name}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-bold">
                  {isLuck ? "🎲 משחקי המזל" : "🎯 משחקי המיומנות"}
                </h2>
                <Badge variant="outline" className="text-[11px] text-muted-foreground">
                  {p.manifest.name}
                </Badge>
              </div>
              {sealed ? (
                <Badge className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
                  <ShieldCheck className="me-1 size-3" aria-hidden="true" />
                  {partial ? "מניפסט חתום · צ׳אנקים בדרך" : "חתום על שרשרת"}{block ? ` · בלוק ${block.toLocaleString("he-IL")}` : ""}
                </Badge>
              ) : (
                <Badge className="border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400">
                  ממתין לחותם · מוגש מהמחסן הריבוני (לא בריפו)
                </Badge>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {files.length ? (
                files.map((f) => {
                  const meta = gameMeta(f.name);
                  const isActive = activeGame?.hash === p.manifest.sha256 && activeGame.file === f.name;
                  return (
                    <button
                      key={f.name}
                      type="button"
                      onClick={() => pick(p.manifest.sha256, f.name)}
                      aria-pressed={isActive}
                      className={cn(
                        "flex flex-col items-center gap-2 rounded-xl border bg-card p-4 text-center transition-all hover:-translate-y-0.5 hover:border-[#d4af37]/50 hover:shadow-md",
                        isActive && "border-[#d4af37] bg-[#d4af37]/5 shadow-md"
                      )}
                    >
                      <span className="text-4xl" aria-hidden="true">
                        {meta.icon}
                      </span>
                      <span className="text-sm font-bold">{meta.name}</span>
                      <span className="text-[11px] leading-snug text-muted-foreground">{meta.desc}</span>
                      {meta.luck ? (
                        <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-600 dark:text-amber-400">
                          מזל · בידור בלבד
                        </span>
                      ) : null}
                    </button>
                  );
                })
              ) : (
                <p className="col-span-full text-sm text-muted-foreground">טוען את רשימת המשחקים מהשעת…</p>
              )}
            </div>
          </section>
        );
      })}

      {/* ── שקיפות ── */}
      <Card className="p-4">
        <p className="text-xs leading-relaxed text-muted-foreground">
          <b className="text-foreground">איפה הקוד של המשחקים?</b> בשום ריפו ציבורי. החבילות נשקלות לחשיש
          sha256 על ידי כותב-הזיפ של הרשת, נכתבות למחסן הריבוני ומוגשות דרך השעת; החותם שלהן נחתם (או
          ייחתם) על שרשרת ציבורית. מקור-האמת לכל הגשה: החותם על השרשרת — לא דברי אמון של אף אחד.
        </p>
      </Card>
    </div>
  );
}
