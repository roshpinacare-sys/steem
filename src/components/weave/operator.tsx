"use client";

// ─────────────────────────────────────────────────────────────────────
// OPERATOR AUTH · מקום-ההתחברות של המפעיל — גם באדמין, גם בכל האתר.
//
// r185 · D-OP-01: "אין לי סיסמת משמרת... יש לך את כל הסיסמאות שלי תפעיל
// הכל מיד" — אף מסך לא שואל את המפעיל אף מפתח. החיבור נגזר אוטומטית:
// בטעינה נשלחת בקשה אחת ל-/api/auth/login בלי גוף; השרת שואב את ה-active
// מכספת הסוכנים, משפט אותו ביט-מול-ביט מול השרשרת החיה של @headcorner,
// ומנפיק טוקן-סשן חתום (12 שעות). מה שנשמר אצל הלקוח הוא הטוקן בלבד.
//
// כל קריאות האדמין (/api/admin/*) דורשות את הטוקן מרגע זה.
// ─────────────────────────────────────────────────────────────────────

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  Fingerprint,
  KeyRound,
  Loader2,
  LogOut,
  Lock,
  RefreshCw,
  ShieldCheck,
  ShieldX,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const TOKEN_KEY = "saos_operator_token";

// ── איתות-mount ללא setState-באפקט (תבנית קנונית) ─────────────────────
// useSyncExternalStore: ברינדור השרת וברינדור-ההידרציה הראשון נקרא
// getServerSnapshot (false — שלד ניטרלי, זהה ביט-לביט לשרת), ואחרי
// ה-mount נקרא getSnapshot (true). אין מצב-ביניים במקור ה-HTML הראשוני,
// אין tearing, ואין setState סינכרוני בגוף אפקט.
const emptySubscribe = () => () => {};

function useMounted(): boolean {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
}

export interface OperatorState {
  status: "checking" | "out" | "in";
  account: string | null;
  publicKey: string | null;
  expiresAt: string | null;
  note: string | null;
}

interface OperatorCtx extends OperatorState {
  connect: (opts?: { silent?: boolean }) => Promise<boolean>;
  logout: () => void;
  authedFetch: (input: string, init?: RequestInit) => Promise<Response>;
}

const Ctx = createContext<OperatorCtx | null>(null);

export function useOperator(): OperatorCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useOperator חייב OperatorProvider");
  return ctx;
}

// ── fetch עם טוקן-המפעיל ─────────────────────────────────────────────

function authedFetchImpl(token: string, input: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers ?? {});
  headers.set("Authorization", `Bearer ${token}`);
  return fetch(input, { ...init, headers, cache: "no-store" });
}

const OUT = (note: string | null): OperatorState => ({
  status: "out",
  account: null,
  publicKey: null,
  expiresAt: null,
  note,
});

// ── Provider ─────────────────────────────────────────────────────────

export function OperatorProvider({ children }: { children: ReactNode }) {
  // אתחול בטוח-SSR: הרינדור הראשון זהה תמיד — "בודק" — גם בשרת וגם
  // בקליינט. כל מעברי-המצב מתרחשים בתוך ה-flow האסינכרוני שאחרי ה-mount.
  const [state, setState] = useState<OperatorState>({
    status: "checking",
    account: null,
    publicKey: null,
    expiresAt: null,
    note: null,
  });

  const connect = useCallback(
    async (opts?: { silent?: boolean }): Promise<boolean> => {
      const silent = opts?.silent ?? false;
      try {
        // אפס קלט-מפעיל: בלי גוף — השרת שואב את המפתח מכספת הסוכנים.
        const res = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
          cache: "no-store",
        });
        const j = (await res.json()) as {
          ok: boolean;
          stage?: string;
          reason?: string;
          account?: string;
          publicKey?: string;
          token?: string;
          expiresAt?: string;
        };
        if (!res.ok || !j.ok || !j.token) {
          setState(OUT(j.reason ?? `שלב: ${j.stage ?? res.status}`));
          if (!silent)
            toast.error("החיבור הריבוני נכשל", {
              description: j.reason ?? `שלב: ${j.stage ?? res.status}`,
            });
          return false;
        }
        sessionStorage.setItem(TOKEN_KEY, j.token);
        setState({
          status: "in",
          account: j.account ?? "headcorner",
          publicKey: j.publicKey ?? null,
          expiresAt: j.expiresAt ?? null,
          note: null,
        });
        if (!silent)
          toast.success(`מחובר כ-@${j.account ?? "headcorner"}`, {
            description: "המפתח נשאב מכספת הסוכנים ואומת מול השרשרת · אף קלט לא נדרש",
          });
        return true;
      } catch (e) {
        setState(OUT(e instanceof Error ? e.message : "שגיאת רשת"));
        if (!silent)
          toast.error("החיבור הריבוני נכשל", {
            description: e instanceof Error ? e.message : "שגיאת רשת",
          });
        return false;
      }
    },
    [],
  );

  // בטעינה: טוקן בלשונית → מאומת מול השרת; אין טוקן (או שפג) → חיבור
  // ריבוני אוטומטי מהכספת — שקט, בלי טוסט, בלי שאלות.
  useEffect(() => {
    let alive = true;
    void (async () => {
      const token = sessionStorage.getItem(TOKEN_KEY);
      if (token) {
        try {
          const res = await authedFetchImpl(token, "/api/auth/session");
          if (!alive) return;
          if (res.ok) {
            const j = (await res.json()) as {
              account?: string;
              publicKey?: string;
              expiresAt?: string;
            };
            setState({
              status: "in",
              account: j.account ?? "headcorner",
              publicKey: j.publicKey ?? null,
              expiresAt: j.expiresAt ?? null,
              note: null,
            });
            return;
          }
          sessionStorage.removeItem(TOKEN_KEY);
        } catch {
          /* נופלים לחיבור-הריבוני מטה */
        }
      }
      if (!alive) return;
      await connect({ silent: true });
    })();
    return () => {
      alive = false;
    };
  }, [connect]);

  const logout = useCallback(() => {
    sessionStorage.removeItem(TOKEN_KEY);
    setState(OUT(null));
    toast.info("התנתקת מהאדמין");
  }, []);

  const authedFetch = useCallback(
    (input: string, init: RequestInit = {}) => {
      const token = sessionStorage.getItem(TOKEN_KEY);
      return token
        ? authedFetchImpl(token, input, init)
        : Promise.resolve(new Response(JSON.stringify({ ok: false, locked: true }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          }));
    },
    []
  );

  const value = useMemo(
    () => ({ ...state, connect, logout, authedFetch }),
    [state, connect, logout, authedFetch]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// ── כרטיס-ההתחברות — "המקום להתחבר" ─────────────────────────────────
// r185: אין שדה-קלט ואין סיסמה. לחיצה אחת (וגם בלי לחיצה — בטעינה).

export function OperatorLoginCard({
  compact = false,
  title = "כניסת מפעיל",
}: {
  compact?: boolean;
  title?: string;
}) {
  const { connect, status, note } = useOperator();
  const [busy, setBusy] = useState(false);

  const submit = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      await connect();
    } finally {
      setBusy(false);
    }
  }, [busy, connect]);

  const working = busy || status === "checking";

  return (
    <Card className="border-[#d4af37]/35 bg-gradient-to-b from-[#d4af37]/[0.07] to-transparent">
      <CardContent className={cn("space-y-4", compact ? "p-4" : "p-6")}>
        <div className="flex items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-[#d4af37]/40 bg-[#d4af37]/10">
            <KeyRound className="size-5 text-[#d4af37]" aria-hidden />
          </div>
          <div>
            <h2 className={cn("font-bold text-zinc-100", compact ? "text-base" : "text-lg")}>
              {title}
            </h2>
            <p className="text-xs text-zinc-500">
              חיבור-ריבוני אוטומטי — אפס סיסמאות, אפס מפתחות, אפס שאלות
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-xs leading-relaxed text-zinc-400">
            אין סיסמת-משמרת ואין סיסמת-מפעיל — מעולם לא הייתה כזו שנדרשה ממך. המפתח חי בכספת
            הסוכנים במכונה; השרת שואב אותו משם, גוזר את הזהות, ומשפט אותה ביט-מול-ביט מול
            הרשות החיה של <span className="font-mono">@headcorner</span> בשרשרת. הסשן חתום
            ל-12 שעות והמפתח עצמו לא נוגע, לא נשמר ולא חוזר בשום תשובה.
          </p>
          <Button
            className="w-full bg-[#d4af37] font-bold text-zinc-950 hover:bg-[#e8cd6e]"
            disabled={working}
            onClick={() => void submit()}
          >
            {working ? <Loader2 className="size-4 animate-spin" /> : <Lock className="size-4" />}
            {status === "in" ? "מחובר" : working ? "נגזר ומאומת מול השרשרת…" : "חיבור ריבוני — אפס קלט"}
          </Button>
          {status === "out" && note && (
            <div className="flex items-start gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-[11px] leading-relaxed text-zinc-400">
              <ShieldX className="mt-0.5 size-3.5 shrink-0 text-amber-500" aria-hidden />
              <span dir="rtl">{note}</span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ── תג-מצב קטן (לכלי העליון) ───────────────────────────────────────

export function OperatorPill() {
  const { status, account, logout, connect } = useOperator();
  // אנטי-hydration לפי-פרוטוקול: הרינדור הראשון (שרת + הידרציה) מפיק
  // שלד-דטרמיניסטי ניטרלי בלבד — מצב ביניים ("בודק סשן…") לעולם לא
  // נכנס למקור ה-HTML הראשוני; הוא מוצג רק אחרי mount, בלקוח בלבד.
  const mounted = useMounted();

  if (!mounted)
    return (
      <span
        aria-hidden="true"
        className="inline-block h-[26px] min-w-[86px] animate-pulse rounded-full border border-zinc-800 bg-zinc-900/60"
      />
    );

  if (status === "checking")
    return (
      <div className="flex items-center gap-1.5 rounded-full border border-zinc-700 bg-zinc-900/60 px-2.5 py-1 text-[11px] text-zinc-500">
        <Loader2 className="size-3 animate-spin" aria-hidden />
        <span className="hidden sm:inline">נגזר מהכספת…</span>
      </div>
    );
  if (status === "out")
    return (
      <button
        type="button"
        onClick={() => void connect()}
        className="flex items-center gap-1.5 rounded-full border border-[#d4af37]/40 bg-[#d4af37]/10 px-2.5 py-1 text-[11px] font-semibold text-[#e8cd6e] transition-colors hover:bg-[#d4af37]/20"
        aria-label="חיבור-ריבוני אוטומטי — אפס קלט"
        title="חיבור-ריבוני אוטומטי — אפס קלט, המפתח מהכספת"
      >
        <KeyRound className="size-3" aria-hidden />
        <span className="hidden sm:inline">חיבור ריבוני</span>
      </button>
    );
  return (
    <button
      type="button"
      onClick={logout}
      className="flex items-center gap-1.5 rounded-full border border-emerald-600/40 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-300 transition-colors hover:bg-emerald-500/20"
      aria-label={`מחובר כ-@${account ?? "headcorner"} — לחיצה מתנתקת`}
      title={`מחובר כ-@${account ?? "headcorner"} · לחיצה מתנתקת`}
    >
      <ShieldCheck className="size-3" aria-hidden />
      <span className="hidden sm:inline">מחובר @{account ?? "headcorner"}</span>
      <LogOut className="size-3 sm:hidden" aria-hidden />
    </button>
  );
}

// ── שער-האדמין: עוטף תוכן של תצוגות-אדמין ───────────────────────────

export function AdminGate({ children }: { children: ReactNode }) {
  const { status, account, publicKey, expiresAt, logout, connect } = useOperator();
  // אותו דפוס-mount כמו ב-OperatorPill: טרם-mount — שלד דטרמיניסטי
  // ללא טקסט-ביניים; "בודק סשן-מפעיל…" רק אחרי mount, בלקוח בלבד.
  const mounted = useMounted();

  if (!mounted) {
    return (
      <div className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6">
        <div className="mx-auto h-5 w-40 animate-pulse rounded-full bg-zinc-800/60" />
      </div>
    );
  }

  if (status === "checking") {
    return (
      <div className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6">
        <div className="flex items-center justify-center gap-2 text-sm text-zinc-500">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          נגזר מכספת הסוכנים ומאומת מול השרשרת…
        </div>
      </div>
    );
  }

  if (status === "out") {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6">
        <OperatorLoginCard />
        <div className="mt-4 flex items-start gap-3 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 text-xs leading-relaxed text-zinc-500">
          <RefreshCw className="mt-0.5 size-4 shrink-0 text-zinc-600" aria-hidden />
          <span>
            אין כאן דלת שמחכה למפתח. אם החיבור נכשל — הבעיה היא בכספת או בשרשרת, ולא בך:
            הסוכנים יתקנו אותה בעצמם. לחיצה על הכפתור מנסה שוב מיד.
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-600/25 bg-emerald-500/[0.06] px-4 py-3">
        <div className="flex items-center gap-2.5 text-sm">
          <Fingerprint className="size-4 text-emerald-400" aria-hidden />
          <span className="font-semibold text-emerald-300">
            מחובר כ-@{account ?? "headcorner"}
          </span>
          {publicKey && (
            <span className="hidden font-mono text-[11px] text-zinc-500 md:inline" dir="ltr">
              {publicKey.slice(0, 16)}…
            </span>
          )}
          {expiresAt && (
            <span className="text-[11px] text-zinc-500">
              · תקף עד {new Date(expiresAt).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-8 border-zinc-700 text-zinc-400 hover:text-zinc-200"
          onClick={logout}
        >
          <LogOut className="size-3.5" aria-hidden />
          התנתקות
        </Button>
      </div>
      {children}
    </div>
  );
}
