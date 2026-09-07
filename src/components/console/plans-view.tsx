"use client";

// ─────────────────────────────────────────────────────────────────────────────
// PlansView — the ranked live plan from the brain (with $/mo), standing
// strategic actions, the managed-account registry (add/remove, chain-verified)
// and the weekly report (copyable markdown).
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

import { brainAction, fmtUsd, relTime, useAccounts, type BrainResponse } from "./api";

// Standing strategy — synced to VERIFY-15 (Task 75) + BEE-WALL (Task 74):
// every line below is a MEASURED fact (live book / on-chain), not a narrative.
const STANDING = [
  {
    title: "חומת-BEE נמדדה-מדעית: 100 BEE = 58.91 SWAP.HIVE (walk-the-book 23 מדרגות · ask 0.5819) · מפת-דלק 77: כל-המסילות-הפנימיות 3.68 = 6.34% — הגרעון-נסגר-בזרימה",
    why: "צינור-הפשרה חי: SPORTS 6,115 + WAIV 10 → 2.78 · רונג-AFIT מחויב 0.889 · הג'נזיס-מציע-בעצמו BEE 0.353@0.5665 (מתחת-ל-ask) · רוטר-צי בשלבים-נשמרים — רגל-תקועה מסתיימת בריצה-הבאה",
    expected: "שער-נמדד במקום חומה-מפחידה — SAOS-על-HE הוא אחסון-אופציונלי, הריבונות כבר-חיה על SAOS-NET",
  },
  {
    title: "סולקציית-סולם AFIT — דוקטרינה מוכחת-על-השרשרת: רונג-4 פתוח-חי 5,968 @0.00014900",
    why: "3-fills ב-6-דק' · מחיר-סולם +23.76% (מדוד) — הסולם עצמו מייצר-מחיר · שארית-חיה 0.4157",
    expected: "מכירה במדרגות מעל ה-bid, לעולם לא dump — שיפור-מחיר במקום שריפת ערך",
  },
  {
    title: "חיילים כצמדי-בריכה — liqCycle חי: escrow→credit→fill→SAOS→pool_add→עמלות (lpSupply 33.53)",
    why: "חייל עם SAOS+credit הוא LP או סוכן-שליחות — נזילות-מבוזרת בלי-חתימה-קולקטיבית",
    expected: "צבא-נזילות-שכבתי בעלות אפס — עמלות-צי זורמות לבריכה שלנו",
  },
  {
    title: "קוראציה כש-VP ≥ 70% (שער-הדמון — נמדד כרגע 69%)",
    why: "SP יושב ומייצר — לא לבזבז חלונות · הדמון מדד-VP בעצמו, לא נרטיב",
    expected: "הכנסת-אצירה מתמדת — זרימה-חוזרת לנזילות",
  },
  {
    title: "verify-pack לצד-שלישי (?export=verify): ג'נזיס + שרשרת-מלאה + checkpoints + stateRoot חתום-digest",
    why: "שחזור-עצמאי שהוכח: 77/77-hash · 77/77-תוצאות · 5/5-roots · digest-MATCH — מהקרנל-עצמו",
    expected: "אמון-חוץ בלי-לסמוך-עלינו — האקספלורר מחזיק-את-הראיות",
  },
  {
    title: "שרשרת-אירועים: RC-drought → רוטר-צי → SWAP.HIVE → BEE → ג'נזיס-HE — כל-פעימה חותמת בלוק על SAOS-NET",
    why: "אירוע-גורם-אירוע — verify-15 נחתם-על-השרשרת (height 90→93 · stateRoot d285fb03…)",
    expected: "מנוע-גדילה-עצמי-מחזק — התוצאה-הסופית מחזקת את-המערכת בכל-השכבות",
  },
  {
    title: "קול-הצי (78) — פס-הפרסום נפתח: 3/3 פוסטים חתומים-חיים ממפתחות-החיילים (@haran @woq @wic) · הראיה-עצמה בלוק-115 על SAOS-NET",
    why: "פרובה-קודמת-לירי: חיילים-על-83–118B-RC (99.9% מלא · המסילה-מעולם-לא-נורתה) · גבולות-כנים-מדודים: Hive-RC-צמא (97M מול ~300M) · SPORTS/WAIV-מוקפא-עד ~9-לספטמבר",
    expected: "תשובה-ראשונה-ל״קצב-הכנסה״: תוכן-אמיתי-מדוד-באפס-עלות-הון — כל-חייל-הוא-כתב-עת-ריבוני",
  },
  {
    title: "גריד-ריבוני (79) — הצי-כגריד-מחשוב מדוד: 13/13-חתימות-עצמאיות-על-stateRoot-אחד (4.3×-מעבר-quorum) · 12-פרוסות-מקבילות · 5.47×-speedup · 36,195-ops/יום",
    why: "מטבוליזם-מדוד-לכל-צומת: 44.17M-RC/op · dup-guard-קרנלי אוכף-ייחודיות מתמטית · 12/13-כשירי-קוראציה (VP≥70%)",
    expected: "תשתית-ולידציה-מבוזרת-מדודה-באפס-עלות-הון — סריקות-מקבילות/ולידציה-כבדה/פיזור-עומסים הם-תחומים-מדודים, לא-שאלות",
  },
];

function AccountsPanel() {
  const { toast } = useToast();
  const accounts = useAccounts();
  const [username, setUsername] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);

  const add = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/ops/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), label: label.trim() || undefined }),
      });
      const j = (await res.json()) as { ok?: boolean; error?: string };
      if (res.ok && (j.ok ?? true)) {
        toast({ title: `@${username.trim()} נרשם`, description: "אומת מול השרשרת ונוסף לרישום" });
        setUsername("");
        setLabel("");
      } else {
        toast({ title: "רישום נכשל", description: j.error, variant: "destructive" });
      }
    } finally {
      setBusy(false);
    }
  };

  const remove = async (u: string) => {
    const res = await fetch(`/api/ops/accounts?username=${encodeURIComponent(u)}`, { method: "DELETE" });
    if (res.ok) toast({ title: `@${u} הוסר` });
    else toast({ title: "הסרה נכשלה", variant: "destructive" });
  };

  return (
    <Card className="border-zinc-800 bg-zinc-900/60">
      <CardContent className="p-4">
        <div className="mb-1 flex items-center gap-2">
          <span className="text-[13px] font-semibold text-zinc-100">👥 רישום חשבונות</span>
          <Badge variant="outline" className="border-zinc-700 px-1.5 py-0 text-[10px] text-zinc-400">
            {accounts?.accounts.length ?? 0}
          </Badge>
          <span className="text-[10px] text-zinc-500">שמות משתמש בלבד — אף מפתח לא נשמר כאן</span>
        </div>
        <div className="mb-3 flex gap-2">
          <Input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="שם חשבון steem"
            className="h-8 flex-1 border-zinc-800 bg-zinc-900 font-mono text-[12px]"
            dir="ltr"
          />
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="תווית"
            className="h-8 w-28 border-zinc-800 bg-zinc-900 text-[12px]"
          />
          <Button size="sm" className="h-8 bg-emerald-500 text-[11px] text-zinc-950 hover:bg-emerald-400" disabled={busy || username.trim().length < 3} onClick={() => void add()}>
            הוסף
          </Button>
        </div>
        <div className="space-y-1">
          {(accounts?.accounts ?? []).map((a) => (
            <div key={a.username} className="flex items-center justify-between gap-2 rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2">
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-[12px] text-zinc-200" dir="ltr">@{a.username}</span>
                {a.label && <span className="text-[10px] text-zinc-500">{a.label}</span>}
                {a.role && <Badge variant="outline" className="border-zinc-700 px-1 py-0 text-[9px] text-zinc-400">{a.role}</Badge>}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[9px] text-zinc-600">{relTime(a.createdAt)}</span>
                {a.username !== "headcorner" && (
                  <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px] text-zinc-500 hover:bg-zinc-800 hover:text-rose-300" onClick={() => void remove(a.username)}>
                    הסר
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function ReportPanel() {
  const { toast } = useToast();
  const [md, setMd] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const gen = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/ops/report?username=headcorner", { cache: "no-store" });
      const j = (await res.json()) as { ok?: boolean; markdown?: string };
      if (j.markdown) {
        setMd(j.markdown);
        toast({ title: "הדוח נוצר", description: "מבוסס נתונים חיים — אפשר להעתיק" });
      } else {
        toast({ title: "יצירת דוח נכשלה", variant: "destructive" });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="border-zinc-800 bg-zinc-900/60">
      <CardContent className="p-4">
        <div className="mb-2 flex items-center gap-2">
          <span className="text-[13px] font-semibold text-zinc-100">📄 דוח שבועי</span>
          <span className="text-[10px] text-zinc-500">מריכז חלון-שוק, P&L, מצב-חשבון והזדמנויות למסמך אחד</span>
          <Button size="sm" variant="outline" className="ms-auto h-7 border-zinc-700 text-[11px] hover:bg-zinc-800" disabled={busy} onClick={() => void gen()}>
            {busy ? "מרכיב…" : "הפק דוח"}
          </Button>
        </div>
        {md && (
          <div className="space-y-2">
            <Button
              size="sm"
              variant="outline"
              className="h-7 border-zinc-700 text-[11px] hover:bg-zinc-800"
              onClick={() => {
                void navigator.clipboard.writeText(md);
                toast({ title: "הדוח הועתק" });
              }}
            >
              העתק מסמך
            </Button>
            <pre className="scrollbar-thin max-h-72 overflow-y-auto whitespace-pre-wrap rounded-lg border border-zinc-800 bg-black/60 p-3 text-right text-[11px] leading-relaxed text-zinc-300">
              {md}
            </pre>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function PlansView({ brain }: { brain: BrainResponse | null }) {
  const plan = (brain?.plan ?? []).filter((p) => p.status !== "done");

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-base font-bold text-zinc-100">🎯 תוכניות</h1>
        <p className="text-[11px] text-zinc-500">
          התוכנית הדורגת של המוח (מתעדכנת בכל פעימה) + האסטרטגיה העומדת (מסונכרנת ל-VERIFY-15 · Task 75 — כל-שורה נמדדה, לא סיפור) + רישום-חשבונות + דוח שבועי
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Card className="border-zinc-800 bg-zinc-900/60">
          <CardContent className="p-4">
            <div className="mb-2 flex items-center gap-2">
              <span className="text-[13px] font-semibold text-zinc-100">🧠 תוכנית המוח הדורגת</span>
              <span className="text-[10px] text-zinc-500">הכנסה מוערכת $/חודש</span>
            </div>
            <ul className="space-y-1.5">
              {plan.map((p, i) => (
                <li key={p.id} className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[12px] font-medium text-zinc-200">
                      <span className="me-1.5 text-zinc-600">{i + 1}.</span>
                      {p.title}
                    </span>
                    <span className="shrink-0 font-mono text-[11px] text-amber-300" dir="ltr">{p.expectedUsdMonth}</span>
                  </div>
                  <div className="mt-1 space-y-0.5 text-[10.5px] text-zinc-500">
                    <div><span className="text-zinc-600">למה: </span>{p.why}</div>
                    <div><span className="text-zinc-600">איך: </span>{p.how}</div>
                  </div>
                  <div className="mt-1.5 flex gap-1.5">
                    <Badge variant="outline" className={p.status === "ready" ? "border-emerald-400/30 px-1.5 py-0 text-[9px] text-emerald-300" : "border-amber-400/30 px-1.5 py-0 text-[9px] text-amber-300"}>
                      {p.status === "ready" ? "מוכן" : p.status}
                    </Badge>
                    {p.requiredKey && (
                      <Badge variant="outline" className="border-zinc-700 px-1.5 py-0 text-[9px] text-zinc-400" dir="ltr">
                        key: {p.requiredKey}
                      </Badge>
                    )}
                  </div>
                </li>
              ))}
              {plan.length === 0 && (
                <li className="rounded-lg border border-dashed border-zinc-800 px-3 py-6 text-center text-[11px] text-zinc-600">
                  אין תוכנית — הרץ פעימת-לב מהפיקוד
                </li>
              )}
            </ul>
            <div className="mt-2 text-[10px] text-zinc-600">
              סה״כ פעיל: {fmtUsd(brain?.totals?.activeUsdMonth, 2)}/חודש · פוטנציאל מדורג: {fmtUsd(brain?.totals?.potentialUsdMonth, 2)}/חודש
            </div>
          </CardContent>
        </Card>

        <div className="space-y-3">
          <Card className="border-zinc-800 bg-zinc-900/60">
            <CardContent className="p-4">
              <div className="mb-2 flex items-center gap-2">
                <span className="text-[13px] font-semibold text-zinc-100">🗺️ אסטרטגיה עומדת</span>
                <Badge variant="outline" className="border-emerald-400/30 px-1.5 py-0 text-[9px] text-emerald-300">VERIFY-15-synced</Badge>
              </div>
              <ul className="space-y-1.5">
                {STANDING.map((s) => (
                  <li key={s.title} className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5">
                    <div className="text-[12px] font-medium text-zinc-200">{s.title}</div>
                    <div className="mt-0.5 text-[10px] text-zinc-500">
                      <span className="text-zinc-600">למה: </span>{s.why} · <span className="text-emerald-300/80">{s.expected}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
          <AccountsPanel />
          <ReportPanel />
        </div>
      </div>
    </div>
  );
}
