"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * קונסולת המפעיל · הדף הראשי
 * שער סיסמה (scrypt, fail-closed) + לוח בקרה חי.
 * מקור האמת: מנוע 3040 דרך /api/operator/overview. אפס סודות בתשובות.
 */

type SessionState = {
  phase: "boot" | "setup" | "login" | "open";
  hasCredentials: boolean;
  authed: boolean;
};

type Overview = Record<string, any>;
type NetState = Record<string, any>;
type NetState = Record<string, any>;

const REFRESH_MS = 30_000;

function useClock() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function relTime(iso: string | null | undefined, now: number): string {
  if (!iso) return "לא נמדד";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "לא נמדד";
  const s = Math.max(0, Math.floor((now - t) / 1000));
  if (s < 60) return `לפני ${s} שניות`;
  const m = Math.floor(s / 60);
  if (m < 60) return `לפני ${m} דקות`;
  const h = Math.floor(m / 60);
  if (h < 24) return `לפני ${h} שעות`;
  return `לפני ${Math.floor(h / 24)} ימים`;
}

function usd(v: unknown): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return "לא נמדד";
  return `$${n.toFixed(2)}`;
}

function Pill({ label, tone, detail }: { label: string; tone: "ok" | "bad" | "warn" | "idle"; detail?: string }) {
  const toneCls =
    tone === "ok"
      ? "border-emerald-800/60 bg-emerald-950/40 text-emerald-300"
      : tone === "bad"
        ? "border-red-900/60 bg-red-950/40 text-red-300"
        : tone === "warn"
          ? "border-amber-800/60 bg-amber-950/40 text-amber-300"
          : "border-zinc-800 bg-zinc-900 text-zinc-400";
  const dotCls =
    tone === "ok" ? "bg-emerald-400" : tone === "bad" ? "bg-red-400" : tone === "warn" ? "bg-amber-400" : "bg-zinc-600";
  return (
    <span className={`inline-flex items-center gap-2 rounded-md border px-2.5 py-1 text-xs font-medium ${toneCls}`} title={detail ?? label}>
      <span className={`h-1.5 w-1.5 rounded-full ${dotCls}`} aria-hidden />
      {label}
    </span>
  );
}

function Card({ title, hint, children, className = "" }: { title: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`min-w-0 rounded-xl border border-zinc-800 bg-zinc-900/50 ${className}`}>
      <header className="flex items-baseline justify-between gap-2 border-b border-zinc-800/80 px-4 py-3">
        <h2 className="text-sm font-semibold tracking-tight text-zinc-200">{title}</h2>
        {hint ? <span className="text-[11px] text-zinc-500">{hint}</span> : null}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="text-sm text-zinc-500">{text}</p>;
}

// ── שער: אתחול ראשון ──

function SetupGate({ onDone }: { onDone: () => void }) {
  const [p1, setP1] = useState("");
  const [p2, setP2] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (p1.length < 12) {
      setErr("הסיסמה חייבת להכיל 12 תווים לפחות");
      return;
    }
    if (p1 !== p2) {
      setErr("הסיסמאות אינן זהות");
      return;
    }
    setBusy(true);
    try {
      const r = await fetch("/api/operator/setup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: p1 }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) setErr(j.error ?? "האתחול נדחה");
      else onDone();
    } catch {
      setErr("השרת אינו נגיש");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mx-auto w-full max-w-md" dir="rtl">
      <h1 className="text-xl font-bold tracking-tight text-zinc-100">אתחול קונסולת המפעיל</h1>
      <p className="mt-2 text-sm leading-6 text-zinc-400">
        בחירת סיסמת על לשער. הסיסמה נשמרת כ-hash scrypt בלבד, אינה נשלחת לריפו ואינה ניתנת לשחזור. אין ערוץ גאולה: מי שאינו יודע את הסיסמה אינו נכנס.
      </p>
      <label className="mt-6 block text-sm font-medium text-zinc-300">
        סיסמה
        <input
          type="password"
          value={p1}
          onChange={(e) => setP1(e.target.value)}
          autoComplete="new-password"
          minLength={12}
          required
          className="mt-1.5 block w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-zinc-100 outline-none transition focus:border-amber-600"
        />
      </label>
      <label className="mt-4 block text-sm font-medium text-zinc-300">
        אימות סיסמה
        <input
          type="password"
          value={p2}
          onChange={(e) => setP2(e.target.value)}
          autoComplete="new-password"
          minLength={12}
          required
          className="mt-1.5 block w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-zinc-100 outline-none transition focus:border-amber-600"
        />
      </label>
      {err ? <p className="mt-4 rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-300">{err}</p> : null}
      <button
        type="submit"
        disabled={busy}
        className="mt-6 w-full rounded-lg bg-amber-500 px-4 py-2.5 text-sm font-semibold text-zinc-950 transition hover:bg-amber-400 disabled:opacity-50"
      >
        {busy ? "קובע..." : "קביעת סיסמה וכניסה"}
      </button>
      <p className="mt-4 text-xs leading-5 text-zinc-500">
        אותו שער משותף לכל אתרי המפעיל · hash אחד · מקור אמת אחד · sanbox/state/credentials.json.
      </p>
    </form>
  );
}

// ── שער: כניסה ──

function LoginGate({ onDone }: { onDone: () => void }) {
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [lockUntil, setLockUntil] = useState<number>(0);
  const now = useClock();

  const lockLeft = Math.max(0, Math.ceil((lockUntil - now) / 1000));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (lockLeft > 0) return;
    setBusy(true);
    try {
      const r = await fetch("/api/operator/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: pw }),
      });
      const j = await r.json();
      if (r.status === 429) {
        setLockUntil(Date.now() + (Number(r.headers.get("retry-after")) || 60) * 1000);
        setErr(j.error ?? "חסימה זמנית");
      } else if (!r.ok || !j.ok) {
        setErr(j.error ?? "הכניסה נדחתה");
      } else {
        setPw("");
        onDone();
      }
    } catch {
      setErr("השרת אינו נגיש");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mx-auto w-full max-w-sm" dir="rtl">
      <h1 className="text-xl font-bold tracking-tight text-zinc-100">קונסולת המפעיל</h1>
      <p className="mt-2 text-sm text-zinc-400">הזנת סיסמה. ההגבלה · 5 ניסיונות בחלון של 5 דקות.</p>
      <label className="mt-6 block text-sm font-medium text-zinc-300">
        סיסמה
        <input
          type="password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          autoFocus
          autoComplete="current-password"
          required
          className="mt-1.5 block w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-zinc-100 outline-none transition focus:border-amber-600"
        />
      </label>
      {err ? <p className="mt-4 rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-300">{err}</p> : null}
      <button
        type="submit"
        disabled={busy || lockLeft > 0}
        className="mt-6 w-full rounded-lg bg-amber-500 px-4 py-2.5 text-sm font-semibold text-zinc-950 transition hover:bg-amber-400 disabled:opacity-50"
      >
        {lockLeft > 0 ? `נעול ${lockLeft} שניות` : busy ? "מאמת..." : "כניסה"}
      </button>
    </form>
  );
}

// ── לוח הבקרה ──

function NetCard({ net, now }: { net: NetState | null; now: number }) {
  if (!net) return <Empty text="מדידת הרשת החיצונית אינה זמינה כרגע" />;
  const p = net.pulse ?? {};
  const s = p.summary ?? {};
  const repos = Array.isArray(net.repos) ? net.repos : [];
  const office = net.office ?? {};
  const toneCls = (v: string) =>
    v === "ALIVE"
      ? "border-emerald-800/60 bg-emerald-950/40 text-emerald-300"
      : v === "STALE"
        ? "border-amber-800/60 bg-amber-950/40 text-amber-300"
        : "border-zinc-800 bg-zinc-900 text-zinc-400";
  return (
    <div className="space-y-3">
      <p className="text-sm leading-6 text-zinc-300" dir="auto">{String(net.verdict ?? "")}</p>
      <div className="grid grid-cols-4 gap-2 text-center">
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-2 py-2.5">
          <div className="text-lg font-bold tabular-nums text-emerald-300">{s.ALIVE ?? "?"}</div>
          <div className="text-[11px] text-zinc-500">חיים</div>
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-2 py-2.5">
          <div className="text-lg font-bold tabular-nums text-amber-300">{s.STALE ?? "?"}</div>
          <div className="text-[11px] text-zinc-500">רפות</div>
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-2 py-2.5">
          <div className="text-lg font-bold tabular-nums text-zinc-300">{s.IDLE ?? "?"}</div>
          <div className="text-[11px] text-zinc-500">מושהים</div>
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-2 py-2.5">
          <div className="text-lg font-bold tabular-nums text-zinc-100">{p.totalRepos ?? "?"}</div>
          <div className="text-[11px] text-zinc-500">ריפו במפה</div>
        </div>
      </div>
      <ul className="max-h-52 space-y-1.5 overflow-y-auto pr-1">
        {repos.length === 0 ? <li className="text-sm text-zinc-500">אין שורות ריפו בחלון התצוגה</li> : null}
        {repos.map((r: any) => (
          <li key={String(r.repo)} className="flex items-center justify-between gap-2 rounded-md border border-zinc-800/70 bg-zinc-950/40 px-2.5 py-1.5 text-xs">
            <span dir="ltr" className="truncate font-mono text-zinc-300">{String(r.repo)}</span>
            <span className="flex shrink-0 items-center gap-2">
              <span className="tabular-nums text-zinc-500">{r.arteries} עורקים</span>
              <span className={`rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${toneCls(String(r.verdict ?? ""))}`} dir="ltr">{String(r.verdict ?? "?")}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="text-[11px] text-zinc-600">
        דופק חיצוני {relTime(p.generatedAt, now)} · משרד חי {relTime(office.capturedAt, now)}
      </p>
    </div>
  );
}

function StreamCard({ o, now }: { o: Overview; now: number }) {
  const s = o.stream;
  if (!s) return <Empty text="אמת הזרם אינה זמינה כרגע (המנוע כבוי או ללא נתונים)" />;
  const posts = Array.isArray(s.posts) ? s.posts : [];
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-2 py-2.5">
          <div className="text-lg font-bold tabular-nums text-zinc-100">{s.today ?? 0}</div>
          <div className="text-[11px] text-zinc-500">שודרו היום</div>
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-2 py-2.5">
          <div className="text-lg font-bold tabular-nums text-zinc-100">{s.cap ?? "לא נמדד"}</div>
          <div className="text-[11px] text-zinc-500">תקרה יומית</div>
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-2 py-2.5">
          <div className="text-lg font-bold tabular-nums text-zinc-100">{s.runway ?? 0}</div>
          <div className="text-[11px] text-zinc-500">מרווח פנוי</div>
        </div>
      </div>
      <ul className="max-h-56 space-y-1.5 overflow-y-auto pr-1">
        {posts.length === 0 ? <li className="text-sm text-zinc-500">אין פוסטים בחלון התצוגה</li> : null}
        {posts.slice(0, 12).map((p: any, i: number) => {
          const url = p.url ?? (p.author && p.permlink ? `https://steemit.com/@${p.author}/${p.permlink}` : null);
          const title = p.title ?? p.permlink ?? "פוסט";
          return (
            <li key={`${p.permlink ?? i}`} className="flex items-center justify-between gap-2 rounded-md border border-zinc-800/70 bg-zinc-950/40 px-2.5 py-1.5 text-xs">
              <span className="truncate text-zinc-300" dir="auto">{title}</span>
              {url ? (
                <a href={url} target="_blank" rel="noreferrer" className="shrink-0 font-medium text-amber-400 hover:text-amber-300">
                  שרשרת
                </a>
              ) : (
                <span className="shrink-0 text-zinc-600">טיוטה</span>
              )}
            </li>
          );
        })}
      </ul>
      {s.at ? <p className="text-[11px] text-zinc-600">נמדד {relTime(s.at, now)}</p> : null}
    </div>
  );
}

function RailsCard({ o }: { o: Overview }) {
  const e = o.economics;
  if (!e) return <Empty text="אמת הכלכלה אינה זמינה כרגע" />;
  const rails = Array.isArray(e.rails) ? e.rails : [];
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2.5">
          <div className="text-lg font-bold tabular-nums text-emerald-300">{usd(e.totalMeasuredUsdPerDay)}</div>
          <div className="text-[11px] text-zinc-500">מדוד ליום</div>
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2.5">
          <div className="text-lg font-bold tabular-nums text-zinc-100">{usd(e.totalEstUsdPerDay)}</div>
          <div className="text-[11px] text-zinc-500">הערכה ליום</div>
        </div>
      </div>
      <ul className="max-h-48 space-y-1 overflow-y-auto pr-1">
        {rails.map((r: any, i: number) => (
          <li key={r.id ?? i} className="flex items-center justify-between gap-2 rounded-md border border-zinc-800/70 bg-zinc-950/40 px-2.5 py-1.5 text-xs">
            <span className="truncate text-zinc-300" dir="auto">{r.label ?? r.id}</span>
            <span dir="auto" className={`shrink-0 tabular-nums font-medium ${r.measuredUsdPerDay ? "text-emerald-300" : "text-zinc-500"}`}>
              {r.measuredUsdPerDay ? usd(r.measuredUsdPerDay) : r.estUsdPerDay ? `הערכה ${usd(r.estUsdPerDay)}` : "חסום"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CuratorCard({ o }: { o: Overview }) {
  const c = o.curator;
  if (!c) return <Empty text="אמת הקיורציה אינה זמינה כרגע" />;
  return (
    <div className="grid grid-cols-3 gap-2 text-center">
      <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-2 py-2.5">
        <div className="text-lg font-bold tabular-nums text-zinc-100">
          {c.votesToday ?? 0}/{c.liveCap ?? c.maxPerDay ?? "?"}
        </div>
        <div className="text-[11px] text-zinc-500">הצבעות היום</div>
      </div>
      <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-2 py-2.5">
        <div className="text-lg font-bold tabular-nums text-zinc-100">{c.vpEff != null ? `${Number(c.vpEff).toFixed(1)}%` : "לא נמדד"}</div>
        <div className="text-[11px] text-zinc-500">VP אפקטיבי</div>
      </div>
      <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-2 py-2.5">
        <div className={`text-sm font-semibold ${c.verdict === "ok" ? "text-emerald-300" : "text-amber-300"}`} dir="auto">{c.verdict ?? "לא נמדד"}</div>
        <div className="text-[11px] text-zinc-500">פסק</div>
      </div>
    </div>
  );
}

function TasksCard({ o }: { o: Overview }) {
  const t = o.tasks;
  const open = Array.isArray(t?.open) ? t.open : [];
  return (
    <div className="space-y-2">
      {open.length === 0 ? <Empty text="התור נקי · אין משימות פתוחות" /> : null}
      <ul className="max-h-52 space-y-1.5 overflow-y-auto pr-1">
        {open.map((t: any, i: number) => (
          <li key={t.id ?? i} className="rounded-md border border-zinc-800/70 bg-zinc-950/40 px-2.5 py-2 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-zinc-200" dir="auto">{t.id}</span>
              <span className={t.priority === "high" ? "text-red-300" : "text-amber-300"}>{t.priority}</span>
            </div>
            <div className="mt-0.5 text-zinc-400" dir="auto">{t.title}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function QuietCard({ o, now }: { o: Overview; now: number }) {
  const q = o.quietAlarm;
  if (!q || Array.isArray(q)) return <Empty text="ללא התראות שקט. ערוץ ההתראה חי ומדווח בכל מחזור." />;
  /* R314 · הקובץ נושא דגל quiet — false משמעו מדידה-ירוקה ולא התראה */
  if (q.quiet === false) {
    return (
      <div className="space-y-2 text-sm">
        <p className="rounded-lg border border-emerald-900/60 bg-emerald-950/30 px-3 py-2 text-emerald-200" dir="auto">
          מדידה ירוקה · הגשר פתוח · החתימה נוכחת · הסביבה נקייה. הערוץ מדווח בכל מחזור.
        </p>
        {q.at ? <p className="text-[11px] text-zinc-600">נמדד {relTime(String(q.at), now)}</p> : null}
      </div>
    );
  }
  const root = q.rootCause ?? q.root ?? null;
  const remedy = q.remediation ?? q.remedy ?? q.path ?? null;
  return (
    <div className="space-y-2 text-sm">
      <p className="rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-red-200" dir="auto">
        התראה פתוחה. {typeof root === "string" ? root : ""}
      </p>
      {remedy ? <p className="rounded-lg border border-amber-900/60 bg-amber-950/30 px-3 py-2 text-amber-200" dir="auto">ערוץ חייאה · {typeof remedy === "string" ? remedy : JSON.stringify(remedy)}</p> : null}
      {q.at ? <p className="text-[11px] text-zinc-600">עודכן {relTime(String(q.at), now)}</p> : null}
    </div>
  );
}

function RewardsCard({ o }: { o: Overview }) {
  const r = o.rewards;
  if (!r) return <Empty text="פנקס השיוך אינו זמין" />;
  const s = r.summary ?? {};
  return (
    <div className="space-y-2.5 text-sm">
      <div className="flex items-center justify-between">
        <span className="text-zinc-400">מצב</span>
        <span className="font-medium text-amber-300" dir="auto">{String(r.status ?? "לא נמדד")}</span>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-zinc-400">תביעות</span>
        <span className="tabular-nums font-medium text-zinc-200">{s.claimsCount ?? "?"}</span>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-zinc-400">סכום</span>
        <span className="tabular-nums font-medium text-zinc-200">{s.totalSp ?? "?"} SP</span>
      </div>
      {s.spIsApproximate ? <p className="text-[11px] leading-5 text-zinc-500">הסכום משוער. הפירוט נבנה מחדש מהיסטוריית השרשרת בלבד, ללא המצאות.</p> : null}
    </div>
  );
}

function GitCard({ o, now }: { o: Overview; now: number }) {
  const g = o.git;
  if (!g) return <Empty text="אמת הגיט אינה זמינה" />;
  return (
    <div className="space-y-2.5 text-sm">
      <div className="flex items-center justify-between">
        <span className="text-zinc-400">ענף</span>
        <span className="font-medium text-zinc-200">{g.branch ?? "לא נמדד"}</span>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-zinc-400">ראש מקומי</span>
        <span className="font-mono text-xs text-zinc-200">{g.head ? String(g.head).slice(0, 8) : "לא נמדד"}</span>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-zinc-400">דחיפה אחרונה</span>
        <span className="text-zinc-300">{relTime(g.pushedAt, now)}</span>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-zinc-400">סטייה מהדחוף</span>
        {g.drift ? <Pill label="יש סטייה" tone="warn" /> : <Pill label="מיושר" tone="ok" />}
      </div>
    </div>
  );
}

function EventsCard({ o, now }: { o: Overview; now: number }) {
  const evs = Array.isArray(o.events) ? o.events : [];
  return (
    <ul className="max-h-56 space-y-1.5 overflow-y-auto pr-1">
      {evs.length === 0 ? <li className="text-sm text-zinc-500">אין אירועים בחלון</li> : null}
      {evs.map((e: any, i: number) => {
        const text = typeof e === "string" ? e : (e.text ?? e.msg ?? e.kind ?? JSON.stringify(e).slice(0, 120));
        const at = typeof e === "object" && e ? (e.at ?? null) : null;
        return (
          <li key={i} className="rounded-md border border-zinc-800/70 bg-zinc-950/40 px-2.5 py-1.5 text-xs text-zinc-300" dir="auto">
            <span className="text-zinc-500">{at ? `${relTime(String(at), now)} · ` : ""}</span>
            {String(text)}
          </li>
        );
      })}
    </ul>
  );
}

function Dashboard({ onLogout }: { onLogout: () => void }) {
  const [o, setO] = useState<Overview | null>(null);
  const [net, setNet] = useState<NetState | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const now = useClock();

  /* מדידת הרשת החיצונית בקצב עצמאי (60 שניות) — היא אינה תלויה במנוע המקומי */
  const loadNet = useCallback(async () => {
    try {
      const r = await fetch("/api/operator/network", { cache: "no-store" });
      if (r.ok) setNet(await r.json());
    } catch {
      /* fail-soft — הרשת מוצגת כלא-נמדדת ולא כשקט */
    }
  }, []);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const r = await fetch("/api/operator/overview", { cache: "no-store" });
      if (r.status === 401) {
        onLogout();
        return;
      }
      const j = await r.json();
      setO(j);
      setErr(null);
    } catch {
      setErr("קריאת הסקירה נכשלה. ניסיון חוזר במחזור הבא.");
    } finally {
      setRefreshing(false);
    }
  }, [onLogout]);

  useEffect(() => {
    load();
    loadNet();
    timer.current = setInterval(load, REFRESH_MS);
    const netTimer = setInterval(loadNet, 60_000);
    return () => {
      if (timer.current) clearInterval(timer.current);
      clearInterval(netTimer);
    };
  }, [load, loadNet]);

  const engineUp = !!o?.engine?.up;
  const signing = o?.engine?.signing;
  const selftest = o?.selftest;
  const fleetCounts = o?.fleet?.counts ?? null;
  const fleetVerdict = o?.fleet?.verdict ?? null;
  const fleetTone =
    fleetCounts && fleetCounts.alive === fleetCounts.total && fleetCounts.dead === 0
      ? "ok"
      : fleetCounts
        ? fleetCounts.dead > 0
          ? "bad"
          : "warn"
        : "idle";

  async function logout() {
    await fetch("/api/operator/session", { method: "DELETE" });
    onLogout();
  }

  return (
    <div dir="rtl" className="min-h-screen bg-[#0b0b0c] text-zinc-100 flex flex-col">
      <header className="sticky top-0 z-20 border-b border-zinc-800 bg-[#0b0b0c]/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-baseline gap-2">
            <span className="text-base font-bold tracking-tight">קונסולת המפעיל</span>
            <span className="text-xs text-zinc-500">{o?.account ?? "SAOS"}</span>
          </div>
          <div className="flex flex-1 flex-wrap items-center gap-1.5">
            <Pill label={engineUp ? "מנוע חי" : "מנוע כבוי"} tone={engineUp ? "ok" : "bad"} />
            <Pill
              label={signing === true ? "חתימה פעילה" : signing === false ? "חתימה מתה" : "חתימה לא נמדד"}
              tone={signing === true ? "ok" : signing === false ? "bad" : "idle"}
            />
            <Pill
              label={fleetCounts ? `צי ${fleetCounts.alive}/${fleetCounts.total} חיים` : fleetVerdict ? String(fleetVerdict) : "צי לא נמדד"}
              tone={fleetTone as "ok" | "bad" | "warn" | "idle"}
              detail={fleetVerdict ? String(fleetVerdict) : undefined}
            />
            <Pill
              label={selftest?.pass != null ? `בדיקות ${selftest.pass}${selftest.fail ? ` · כשלים ${selftest.fail}` : ""}` : "בדיקות לא נמדד"}
              tone={selftest?.pass != null && !selftest?.fail ? "ok" : selftest?.fail ? "bad" : "idle"}
              detail={selftest?.at ? relTime(selftest.at, now) : undefined}
            />
            <Pill label={o?.git?.drift ? "גיט סטייה" : "גיט מיושר"} tone={o?.git?.drift ? "warn" : "ok"} />
          </div>
          <button
            onClick={logout}
            className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-300 transition hover:border-zinc-500 hover:text-zinc-100"
          >
            יציאה
          </button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">
        {err ? (
          <p className="mb-4 rounded-lg border border-amber-900/60 bg-amber-950/30 px-3 py-2 text-sm text-amber-200">{err}</p>
        ) : null}
        {!o && !err ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-40 min-w-0 animate-pulse rounded-xl border border-zinc-800 bg-zinc-900/40" />
            ))}
          </div>
        ) : null}
        {o ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Card title="זרם שידור" hint={`רענון ${REFRESH_MS / 1000} שניות`}>
              <StreamCard o={o} now={now} />
            </Card>
            <Card title="הרשת החיה" hint="מפת העורקים החיצונית">
              <NetCard net={net} now={now} />
            </Card>
            <Card title="מסילות הכנסה">
              <RailsCard o={o} />
            </Card>
            <Card title="קיורציה">
              <CuratorCard o={o} />
            </Card>
            <Card title="תור משימות" hint={o?.tasks?.updatedAt ? relTime(o.tasks.updatedAt, now) : undefined}>
              <TasksCard o={o} />
            </Card>
            <Card title="ערוץ שקט">
              <QuietCard o={o} now={now} />
            </Card>
            <Card title="שיוך פרסים">
              <RewardsCard o={o} />
            </Card>
            <Card title="גיט">
              <GitCard o={o} now={now} />
            </Card>
            <Card title="אירועים אחרונים">
              <EventsCard o={o} now={now} />
            </Card>
            <Card title="לוח רווחיות" hint={o?.yieldBoard?.updatedAt ? relTime(o.yieldBoard.updatedAt, now) : undefined}>
              {o?.yieldBoard?.purpose ? (
                <p className="text-xs leading-6 text-zinc-400">{String(o.yieldBoard.purpose)}</p>
              ) : (
                <Empty text="הלוח אינו זמין" />
              )}
            </Card>
          </div>
        ) : null}
      </main>

      <footer className="mt-auto border-t border-zinc-800 bg-[#0b0b0c]">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 px-4 py-3 text-[11px] text-zinc-500 sm:px-6">
          <span>אפס סודות בתשובות · fail closed · חוק הגוף האחד · המנוע 3040 הוא מקור האמת</span>
          <span className="tabular-nums">
            {o?.asof ? `סקירה ${relTime(o.asof, now)}` : "טוען"} {refreshing ? "· מרענן" : ""}
          </span>
        </div>
      </footer>
    </div>
  );
}

// ── השער הראשי ──

export default function Page() {
  const [state, setState] = useState<SessionState>({ phase: "boot", hasCredentials: false, authed: false });

  const probe = useCallback(async () => {
    try {
      const r = await fetch("/api/operator/session", { cache: "no-store" });
      const j = await r.json();
      if (j.authed) setState({ phase: "open", hasCredentials: !!j.hasCredentials, authed: true });
      else setState({ phase: j.hasCredentials ? "login" : "setup", hasCredentials: !!j.hasCredentials, authed: false });
    } catch {
      setState({ phase: "login", hasCredentials: true, authed: false });
    }
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch("/api/operator/session", { cache: "no-store" });
        const j = await r.json();
        if (!alive) return;
        if (j.authed) setState({ phase: "open", hasCredentials: !!j.hasCredentials, authed: true });
        else setState({ phase: j.hasCredentials ? "login" : "setup", hasCredentials: !!j.hasCredentials, authed: false });
      } catch {
        if (alive) setState({ phase: "login", hasCredentials: true, authed: false });
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (state.phase === "boot") {
    return (
      <div dir="rtl" className="flex min-h-screen items-center justify-center bg-[#0b0b0c]">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-amber-500" aria-label="טוען" />
      </div>
    );
  }

  if (state.phase === "open") return <Dashboard onLogout={probe} />;

  return (
    <div dir="rtl" className="flex min-h-screen items-center justify-center bg-[#0b0b0c] px-4">
      <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6 sm:p-8">
        {state.phase === "setup" ? <SetupGate onDone={probe} /> : <LoginGate onDone={probe} />}
      </div>
    </div>
  );
}
