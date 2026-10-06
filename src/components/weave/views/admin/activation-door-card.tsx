"use client";

// ─────────────────────────────────────────────────────────────────────
// ActivationDoorCard — דלת-ההפעלה של הרשת (r136 · r185-ריבוני).
//
// r185 · D-OP-01: "אין לי סיסמת משמרת... יש לך את כל הסיסמאות שלי
// תפעיל הכל מיד" — אף מסך לא מבקש עוד אף מפתח. דלת 1 היא כפתור אחד:
// השרת שואב את ה-active מכספת-הסוכנים, משפט ביט-מול-ביט מול השרשרת,
// פותח את כספת-הארנק, מאטים את חוט-המפתחות לכספת-הריפו ומשגר את
// dex-grid — אפס קלט, אפס שאלות. רופא-המפתחות (שביקש הדבקה ידנית)
// הוסר — האבחון כולו ריבוני: המפתחות כבר בכספת ונשפטים ממנה.
//
// r189 · מפקח-המפתחות חוזר ככלי-אבחון בלבד (KeyDoctorPanel ← /api/arm/inspect):
// לא שער-הפעלה ולא תנאי לשום דבר — אבחנה מיידית של ערך-סוד מול הרשויות החיות
// בשלוש-השרשראות, בעוד דלת-ההפעלה עצמה נשארת ריבונית לחלוטין (אפס קלט).
// ─────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  BadgeCheck,
  Info,
  KeyRound,
  Loader2,
  ShieldCheck,
  Stethoscope,
  Vault,
  XCircle,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface ArmResultRow {
  secret: string;
  chain: string;
  role: string;
  ok: boolean;
  detailHe: string;
}

interface ArmAllResult {
  ok: boolean;
  stage: string;
  mode?: "vault-auto" | "pasted";
  sealedCount: number;
  total: number;
  vaultOpen: boolean;
  wroteOwnerFile: boolean;
  ownerFileMode?: "master" | "wif" | "already-live" | null;
  dispatched: boolean;
  dispatchedBackup?: boolean;
  results: ArmResultRow[];
  detailHe: string;
}

// r137 · מצב-החי של הבית — ההוכחה שהדלת לא רק אטמה לענן אלא גם החייתה
// את החתימה המקומית: מקור-מפתח · סולם · פאריטה · רצפת-ערך. נמדד מ-/api/money.
interface HouseStatus {
  keyPresent: boolean;
  ordersCount: number;
  deployedSteem: number | null;
  idleSteem: number | null;
  parity: number | null;
  paritySource: string | null;
  floorState: string | null;
  daemonDecision: string | null;
}

function HouseLiveStatus() {
  const [st, setSt] = useState<HouseStatus | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => {
      fetch("/api/money", { cache: "no-store" })
        .then((r) => r.json())
        .then((j: any) => {
          if (!alive) return;
          const orders = Array.isArray(j?.orders) ? j.orders : [];
          setSt({
            keyPresent: j?.keyPresent === true,
            ordersCount: orders.length,
            deployedSteem: typeof j?.deployedSteem === "number" ? j.deployedSteem : null,
            idleSteem: typeof j?.idleSteem === "number" ? j.idleSteem : null,
            parity: typeof j?.marks?.parity === "number" ? j.marks.parity : null,
            paritySource: typeof j?.marks?.paritySource === "string" ? j.marks.paritySource : null,
            floorState: typeof j?.valueFloor?.state === "string" ? j.valueFloor.state : null,
            daemonDecision: typeof j?.daemon?.lastDecision?.kind === "string" ? j.daemon.lastDecision.kind : null,
          });
        })
        .catch(() => {});
    };
    load();
    const t = setInterval(load, 45_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  if (!st) return null;
  const ladderLive = st.ordersCount > 0;
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2" dir="rtl">
      <div className="flex items-center gap-1.5 text-[11px] font-bold text-zinc-300">
        <Activity className="size-3.5 text-emerald-500" aria-hidden="true" />
        מצב-החי של הבית אחרי-החימוש · נמדד כל 45ש׳
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
        {st.keyPresent ? (
          <Badge className="gap-1 border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
            <BadgeCheck className="size-3" aria-hidden="true" />
            בית חתום — מקור-מפתח חי
          </Badge>
        ) : (
          <Badge className="gap-1 border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400">
            <KeyRound className="size-3" aria-hidden="true" />
            בית עיוור — לחיצת הפעלה-ריבונית מחייה אותו
          </Badge>
        )}
        {ladderLive ? (
          <Badge variant="outline" className="gap-1 text-[10px]">
            סולם חי · {st.ordersCount} פקודות · {st.deployedSteem?.toFixed(1) ?? "?"} STEEM מוצב
          </Badge>
        ) : (
          <Badge variant="outline" className="gap-1 text-[10px]">
            סולם ריק · {st.idleSteem?.toFixed(1) ?? "?"} STEEM נזילים — המוביל מציב במחזור הבא
          </Badge>
        )}
        {st.parity != null ? (
          <Badge variant="outline" className="gap-1 text-[10px]">
            פאריטה {st.parity.toFixed(4)} · {st.paritySource ?? "oracle"}
          </Badge>
        ) : (
          <Badge variant="outline" className="gap-1 text-[10px]">
            פאריטה לא נמדדה
          </Badge>
        )}
        {st.floorState && (
          <Badge variant="outline" className="gap-1 text-[10px]">
            רצפת-ערך {st.floorState}
          </Badge>
        )}
        {st.daemonDecision && (
          <Badge variant="outline" className="gap-1 text-[10px] font-mono">
            מוביל {st.daemonDecision}
          </Badge>
        )}
      </div>
    </div>
  );
}

// r189 · מפקח-המפתחות (חיווט-היתום /api/arm/inspect): כלי-אבחון בלבד —
// לא שער-הפעלה. המפעיל מדביק ערך סוד ומקבל אבחנה מיידית מול הרשויות החיות
// בשלוש-השרשראות. הערך חי בזיכרון-הבקשה בלבד — לא נשמר, לא נכתב, לא בלוג,
// ולא חוזר בשום תשובה (ה-route מחזיר פסק-דין בלבד).

interface InspectVerdict {
  chain: string;
  role: string;
  matched: boolean;
  source: string;
}

interface InspectResult {
  ok: boolean;
  valueKind: "wif" | "password";
  matchedCount: number;
  opensVault: boolean | null;
  verdicts: InspectVerdict[];
  guidanceHe: string;
  noteHe: string;
}

export function KeyDoctorPanel() {
  const [value, setValue] = useState("");
  const [inspecting, setInspecting] = useState(false);
  const [result, setResult] = useState<InspectResult | null>(null);
  const [errorHe, setErrorHe] = useState<string | null>(null);

  const inspect = useCallback(async () => {
    const v = value.trim();
    if (v.length < 8) {
      setErrorHe("הערך קצר מדי לאבחנה — שום דבר לא נשלח ולא נשמר.");
      return;
    }
    setInspecting(true);
    setErrorHe(null);
    try {
      const res = await fetch("/api/arm/inspect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: v }),
      });
      const j = (await res.json()) as InspectResult & { error?: string; detail?: string };
      if (!res.ok || !j.ok) {
        const heError =
          j.error === "rate-limited"
            ? "הגעת למגבלת-הקצה — 10 אבחנות לשעה. נסה שוב מאוחר יותר."
            : j.detail ?? "האבחון לא בוצע — שום דבר לא נשמר ושום דבר לא השתנה.";
        setErrorHe(heError);
        setResult(null);
        return;
      }
      setResult(j);
    } catch {
      setErrorHe("מקור-האבחון לא ענה — שום דבר לא נשמר. נסה שוב.");
      setResult(null);
    } finally {
      setInspecting(false);
    }
  }, [value]);

  const matched = result?.matchedCount ?? 0;

  return (
    <div className="flex flex-col gap-2 rounded-lg border px-4 py-3" dir="rtl">
      <div className="flex flex-wrap items-center gap-2 text-xs font-bold">
        <Stethoscope className="size-3.5 text-emerald-500" aria-hidden="true" />
        מפקח-המפתחות — אבחון חי של ערך סוד
      </div>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        כלי-אבחון בלבד — אין צורך להדביק כלום כדי להפעיל: דלת-ההפעלה למעלה ריבונית.
        הדבקת ערך → אבחנה מיידית: מה הערך שבידך, לאילו תפקידים באילו שרשראות הוא שולט
        (נשפט ביט-מול-ביט מול השרשרת החיה), והאם הוא פותח את כספת-הארנק.
      </p>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          type="password"
          dir="ltr"
          autoComplete="off"
          className="font-mono"
          placeholder="הדבק ערך סוד לאבחון — לא נשמר ולא יוצג"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !inspecting) void inspect();
          }}
        />
        <Button
          onClick={() => void inspect()}
          disabled={inspecting || value.trim().length < 8}
          variant="outline"
          className="gap-2 shrink-0"
        >
          {inspecting ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Stethoscope className="size-4" aria-hidden="true" />
          )}
          {inspecting ? "מאבחן מול השרשרת…" : "אבחן"}
        </Button>
      </div>

      {errorHe && (
        <p className="rounded-md border border-amber-500/25 bg-amber-500/5 px-2 py-1 text-[11px] leading-relaxed text-amber-700 dark:text-amber-300" dir="auto">
          {errorHe}
        </p>
      )}

      {result && (
        <div className="flex flex-col gap-2 rounded-md border bg-card/70 px-3 py-2 text-[11px]">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="outline" className="gap-1 text-[10px]">
              {result.valueKind === "wif" ? "סוג: WIF ישיר" : "סוג: סיסמת-אב"}
            </Badge>
            <Badge
              variant="outline"
              className={cn(
                "gap-1 text-[10px]",
                matched > 0
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                  : "text-muted-foreground",
              )}
            >
              {matched > 0 ? `${matched} התאמות חיות` : "אף התאמה חיה"}
            </Badge>
            {result.opensVault === true ? (
              <Badge variant="outline" className="gap-1 border-emerald-500/40 bg-emerald-500/10 text-[10px] text-emerald-700 dark:text-emerald-400">
                <Vault className="size-3" aria-hidden="true" />
                פותח את כספת-הארנק
              </Badge>
            ) : result.opensVault === false ? (
              <Badge variant="outline" className="gap-1 text-[10px] text-muted-foreground">
                <Vault className="size-3" aria-hidden="true" />
                לא פותח את הכספת
              </Badge>
            ) : (
              <Badge variant="outline" className="gap-1 border-amber-500/40 bg-amber-500/10 text-[10px] text-amber-700 dark:text-amber-400">
                <Vault className="size-3" aria-hidden="true" />
                יכולת-הכספת לא נמדדה
              </Badge>
            )}
          </div>

          <p
            className={cn(
              "rounded-md border px-2 py-1 leading-relaxed",
              matched > 0
                ? "border-emerald-500/25 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300"
                : "border-amber-500/25 bg-amber-500/5 text-amber-700 dark:text-amber-300",
            )}
            dir="auto"
          >
            {result.guidanceHe}
          </p>

          <div className="max-h-96 overflow-y-auto rounded-md border bg-card/60 p-2">
            <ul className="flex flex-col gap-1">
              {result.verdicts.map((v) => (
                <li key={`${v.chain}-${v.role}`} className="flex items-center gap-1.5">
                  {v.matched ? (
                    <BadgeCheck className="size-3.5 shrink-0 text-emerald-500" aria-hidden="true" />
                  ) : (
                    <XCircle className="size-3.5 shrink-0 text-muted-foreground/50" aria-hidden="true" />
                  )}
                  <span className="font-mono text-muted-foreground" dir="ltr">
                    {v.chain}/{v.role}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground" dir="auto">
                    — {v.source}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <p className="text-[10px] leading-relaxed text-muted-foreground" dir="auto">
            {result.noteHe}
          </p>
        </div>
      )}
    </div>
  );
}

export function ActivationDoorCard() {
  const [arming, setArming] = useState(false);
  const [armResult, setArmResult] = useState<ArmAllResult | null>(null);
  const [custody, setCustody] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/arm/seal", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: { custody?: string }) => {
        if (alive) setCustody(j.custody ?? null);
      })
      .catch(() => {
        if (alive) setCustody(null);
      });
    return () => {
      alive = false;
    };
  }, []);

  // r185 · הפעלה-ריבונית: אפס קלט — המפתח נשאב בשרת מכספת הסוכנים
  const armAll = useCallback(async () => {
    setArming(true);
    try {
      const res = await fetch("/api/arm/all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const j = (await res.json()) as ArmAllResult & { reason?: string; stage?: string };
      if (!res.ok || !j.ok) {
        throw new Error(j.reason ?? j.detailHe ?? `שלב: ${j.stage ?? res.status}`);
      }
      setArmResult(j);
      toast.success(j.stage === "armed" ? "הכל חומש 🔥" : `חומש חלקית (${j.sealedCount}/${j.total})`, {
        description: j.detailHe,
        duration: 8000,
      });
    } catch (e) {
      toast.error("ההפעלה לא בוצעה — שום דבר לא השתנה", {
        description: e instanceof Error ? e.message : "נסה שוב",
        duration: 8000,
      });
    } finally {
      setArming(false);
    }
  }, []);

  return (
    <Card className="mb-6 border-emerald-500/30 bg-gradient-to-b from-emerald-500/[0.04] to-transparent">
      <CardContent className="flex flex-col gap-4 p-5">
        {/* כותרת */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-bold">
            <Zap className="size-4 text-emerald-500" aria-hidden="true" />
            דלת-ההפעלה — לחיצה אחת מחמשת הכל, אפס קלט
            {custody ? (
              custody === "OPEN" ? (
                <Badge className="gap-1 border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
                  <ShieldCheck className="size-3" aria-hidden="true" />
                  סמכות חיה
                </Badge>
              ) : (
                <Badge className="gap-1 border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400">
                  <KeyRound className="size-3" aria-hidden="true" />
                  סמכות סגורה
                </Badge>
              )
            ) : null}
          </div>
        </div>

        {/* הסבר בשפה פשוטה */}
        <p className="text-xs leading-relaxed text-muted-foreground">
          אין כאן שאלות ואין כאן סיסמאות — לא סיסמת-משמרת ולא סיסמת-מפעיל, כאלה מעולם לא
          היו ולא יהיו. כל המפתחות של הרשת כבר אטומים בכספת הסוכנים במכונה
          (<span className="font-mono">~/.sovereign/vault</span>, 0600, מחוץ-לגיט) ובכספות
          הענן. לחיצת ההפעלה שואבת משם, משפטת מול השרשרת החיה, ומזרימה הכל: גריד, קול,
          כספת ומנוע.
        </p>

        {/* דלת 1 — הפעלה ריבונית (אפס קלט) */}
        <div className="flex flex-col gap-2 rounded-lg border border-emerald-500/25 bg-emerald-500/[0.04] px-4 py-3">
          <div className="flex items-center gap-2 text-xs font-bold">
            <Zap className="size-3.5 text-emerald-500" aria-hidden="true" />
            הפעלה מלאה — שואב מהכספת, משפט מול השרשרת, מאטים ומשגר
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Button
              onClick={() => void armAll()}
              disabled={arming}
              className="gap-2 bg-emerald-600 text-white hover:bg-emerald-500"
            >
              {arming ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Zap className="size-4" aria-hidden="true" />}
              {arming ? "שואב מהכספת, מאמת ומאטים…" : "הפעל הכל — אפס קלט"}
            </Button>
            <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Vault className="size-3.5" aria-hidden="true" />
              מקור השליטה: כספת הסוכנים · שיפוט: ה-active החי של @headcorner בשרשרת
            </span>
          </div>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            מה קורה בלחיצה: ה-WIF נשאב מהכספת → נשפט ביט-מול-ביט מול השרשרת → כספת-הארנק
            נפתחת → חוט-המפתחות המלא (STEEM active+posting · HIVE active+posting · BLURT
            active) נשפט מול שרשרת-מקור ונאטם לכספת-הריפו → dex-grid משוגר מיד. מגבלת-קצה:
            5 לשעה.
          </p>

          {armResult && (
            <div className="flex flex-col gap-1.5 rounded-md border bg-card/70 px-3 py-2 text-[11px]" dir="rtl">
              <div className="flex flex-wrap items-center gap-1.5">
                {armResult.mode && (
                  <Badge variant="outline" className="gap-1 text-[10px]">
                    {armResult.mode === "vault-auto" ? "מקור: כספת-סוכנים" : "מקור: הדבקה"}
                  </Badge>
                )}
                <Badge variant="outline" className="gap-1 text-[10px]">
                  {armResult.sealedCount}/{armResult.total} נאטמו
                </Badge>
                <Badge variant="outline" className="gap-1 text-[10px]">
                  כספת {armResult.vaultOpen ? "נפתחה" : "לא נפתחה"}
                </Badge>
                <Badge variant="outline" className="gap-1 text-[10px]">
                  מקור-מפתח מקומי{" "}
                  {armResult.ownerFileMode === "already-live"
                    ? "כבר חי (לא נדרס)"
                    : armResult.wroteOwnerFile
                      ? `נכתב${armResult.ownerFileMode ? ` (${armResult.ownerFileMode})` : ""}`
                      : "לא נכתב"}
                </Badge>
                <Badge variant="outline" className="gap-1 text-[10px]">
                  dex-grid {armResult.dispatched ? "שוגר" : "לא שוגר"}
                </Badge>
                {armResult.dispatchedBackup !== undefined && (
                  <Badge variant="outline" className="gap-1 text-[10px]">
                    גיבוי {armResult.dispatchedBackup ? "שוגר" : "לא שוגר"}
                  </Badge>
                )}
              </div>
              {armResult.results.map((r) => (
                <div key={r.secret} className="flex items-start gap-1.5">
                  {r.ok ? (
                    <BadgeCheck className="mt-0.5 size-3.5 shrink-0 text-emerald-500" aria-hidden="true" />
                  ) : (
                    <XCircle className="mt-0.5 size-3.5 shrink-0 text-amber-500" aria-hidden="true" />
                  )}
                  <span className={cn("font-mono", r.ok ? "text-foreground" : "text-muted-foreground")}>
                    {r.secret}
                  </span>
                  <span className="text-muted-foreground">— {r.detailHe}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* r137 · מצב-החי — ההוכחה שהחימוש עבר עד-הבית */}
        <HouseLiveStatus />

        {/* r189 · מפקח-המפתחות — אבחון ערך-סוד מול השרשרת החיה (arm/inspect) */}
        <KeyDoctorPanel />

        {/* מה זה ה-seal */}
        <div className="flex items-start gap-2 rounded-lg border px-4 py-3 text-xs leading-relaxed text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span>
            <span className="font-semibold text-foreground">מה זה ה-seal?</span> זו מעטפת מוצפנת (AES-256-GCM) שמחזיקה את מפתחות-הזהות של הרשת
            עצמה — זהויות-ה-EVM שבאמצעותן הרשת חותמת אימותים ועוגנים. הסיסמה שלה נשמרת אצל הסוכנים (MAIN_KEY בכספת) ולא אצל אף אדם.{" "}
            {custody === "OPEN"
              ? "הסמכות הושבה בדרך ריבונית: המפתחות שוחזרו מהשושלת-עצמה והשרשרת אישרה את החתימה — הכל חי ללא קלט-אדם."
              : "אם הסמכות סגורה — הסוכנים ישחזרו אותה בעצמם מהכספת; אף אחד לא נדרש לעשות דבר."}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
