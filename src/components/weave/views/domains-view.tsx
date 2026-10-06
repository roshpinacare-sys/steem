"use client";

// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · מרכז הדומיינים הריבוניים — "להקים דומיינים פרטיים על הרשת".
//
// פריצת הדרך, בכנות ובמדויק:
//   1. מפת-חשיפה אמיתית — מה חי עכשיו: האתר מוגש דרך שעת-הסנדבוקס
//      (פורט חיצוני אחד), וכל מצב באתר הוא URL מבוסס-hash שעובד על
//      כל דומיין שהאתר ייפרס עליו — כלומר התוכן אינו כלוא בשום כתובת.
//   2. רישום הדומיינים הפרטיים — מה מתכננים להקים, לאיזו מטרה, ובאיזה
//      שלב (תכנון → DNS → פריסה → חי).
//   3. ערכת-הפריסה הריבונית — לכל דומיין ניתן להוריד חבילה מלאה
//      (docker-compose + Caddy עם HTTPS אוטומטי + Dockerfile + deploy.sh
//      + רשומות DNS) שמקימה את האתר על שרת פרטי — בלי GitHub, בלי
//      ספק יישומים. זו הדרך: השרת שלך, הדומיין שלך, החוק שלך.
// ─────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeftRight,
  CheckCircle2,
  Download,
  Globe2,
  Loader2,
  MapPin,
  Network,
  Plus,
  RefreshCw,
  Rocket,
  Server,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useSyncExternalStore } from "react";

// ── איתות-mount (תבנית קנונית — בלי קריעת הידרציה) ────────────────────
const emptySubscribe = () => () => {};
function useMounted(): boolean {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
}

interface DomainRow {
  id: string;
  domain: string;
  purpose: string;
  status: string;
  notes: string | null;
  createdAt: string;
}

const STATUS_META: Record<string, { label: string; cls: string }> = {
  PLANNED: { label: "בתכנון", cls: "border-zinc-700 text-zinc-400" },
  DNS: { label: "DNS מוגדר", cls: "border-emerald-700/60 text-emerald-300" },
  DEPLOYING: { label: "בפריסה", cls: "border-amber-600/60 text-amber-300" },
  LIVE: { label: "חי", cls: "border-emerald-600/60 text-emerald-300" },
};

const KIT_CONTENTS: Array<{ name: string; desc: string }> = [
  { name: "docker-compose.yml", desc: "שני שירותים: האתר + שעת Caddy — הכל על השרת שלך" },
  { name: "Caddyfile", desc: "HTTPS אוטומטי, כותרות אבטחה, חותם X-SAOS-Sovereign" },
  { name: "site/Dockerfile", desc: "בניית האתר (Next.js standalone על Bun)" },
  { name: "deploy.sh", desc: "פריסה בפקודה אחת + אימות חי שהדומיין עונה" },
  { name: "dns-records.txt", desc: "רשומות ה-DNS המדויקות ליצירה אצל רשם הדומיינים" },
  { name: ".env.example", desc: "הגדרות סביבה — דומיין, מסד-נתונים מקומי" },
];

export function DomainsView() {
  const mounted = useMounted();
  const [domains, setDomains] = useState<DomainRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [newDomain, setNewDomain] = useState("");
  const [newPurpose, setNewPurpose] = useState("");
  const [adding, setAdding] = useState(false);
  const [kitDomain, setKitDomain] = useState("");
  const [kitBusy, setKitBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/domains", { cache: "no-store" });
      const j = await res.json();
      if (j?.ok) {
        setDomains(j.domains);
        setLoadError(null);
      } else {
        // כישלון-שרת (fail-closed לפי r119) — לא מתחזים ל"רשימה ריקה"
        setLoadError(String(j?.error ?? `HTTP ${res.status}`));
      }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "כשל רשת");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const addDomain = useCallback(async () => {
    const d = newDomain.trim().toLowerCase();
    if (!d || adding) return;
    setAdding(true);
    try {
      const res = await fetch("/api/domains", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: d, purpose: newPurpose.trim() }),
      });
      const j = await res.json();
      if (j?.ok) {
        toast.success(`הדומיין ${d} נרשם במרכז`);
        setNewDomain("");
        setNewPurpose("");
        void load();
      } else {
        toast.error("הרישום נכשל", { description: String(j?.error ?? "") });
      }
    } catch (e) {
      toast.error("הרישום נכשל", {
        description: e instanceof Error ? e.message : "שגיאת רשת",
      });
    } finally {
      setAdding(false);
    }
  }, [newDomain, newPurpose, adding, load]);

  const setStatus = useCallback(
    async (id: string, status: string) => {
      try {
        const res = await fetch(`/api/domains/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        });
        const j = await res.json();
        if (j?.ok) {
          setDomains((prev) =>
            prev.map((x) => (x.id === id ? (j.domain as DomainRow) : x)),
          );
        }
      } catch {
        toast.error("עדכון הסטטוס נכשל");
      }
    },
    [],
  );

  const removeDomain = useCallback(
    async (id: string, domain: string) => {
      try {
        const res = await fetch(`/api/domains/${id}`, { method: "DELETE" });
        if (res.ok) {
          toast.info(`הדומיין ${domain} הוסר מהרישום`);
          setDomains((prev) => prev.filter((x) => x.id !== id));
        }
      } catch {
        toast.error("המחיקה נכשלה");
      }
    },
    [],
  );

  const downloadKit = useCallback(async (domain: string) => {
    if (!domain || kitBusy) return;
    setKitBusy(domain);
    try {
      const res = await fetch("/api/domains/kit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        toast.error("יצירת הערכה נכשלה", {
          description: String(j?.error ?? `HTTP ${res.status}`),
        });
        return;
      }
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `sovereign-${domain}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(a.href);
      toast.success(`הערכה הריבונית ל-${domain} הורדה`, {
        description: "חבילת ZIP שלמה: docker-compose · Caddyfile · deploy.sh · רשומות DNS — מוכנה לשרת שלך",
        duration: 8_000,
      });
    } catch (e) {
      toast.error("הורדת הערכה נכשלה", {
        description: e instanceof Error ? e.message : "שגיאת רשת",
      });
    } finally {
      setKitBusy(null);
    }
  }, [kitBusy]);

  const currentOrigin = mounted ? window.location.origin : null;

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      {/* כותרת */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex size-11 items-center justify-center rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-500">
            <Network className="size-6" aria-hidden />
          </div>
          <div>
            <h1 className="text-xl font-bold text-zinc-100">
              מרכז הדומיינים הריבוניים
            </h1>
            <p className="text-xs text-zinc-500">
              הדרך לדומיינים פרטיים על הרשת — השרת שלך, הדומיין שלך, בלי GitHub
              ובלי ספק יישומים
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900/40 px-3.5 py-2 text-xs text-zinc-400">
          <MapPin className="size-4 text-emerald-500" aria-hidden />
          <span>הפריסה הנוכחית:</span>
          <code className="font-mono text-zinc-200" dir="ltr">
            {currentOrigin ?? "…"}
          </code>
        </div>
      </div>

      {/* מפת חשיפה + הדרך */}
      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <Card className="border-zinc-800 bg-zinc-950/50 lg:col-span-2">
          <CardContent className="p-5">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-zinc-100">
              <Globe2 className="size-4 text-emerald-500" aria-hidden />
              מפת החשיפה — מה חי עכשיו (בכנות)
            </h2>
            <ul className="space-y-2.5 text-[13px] leading-6 text-zinc-400">
              <li className="flex gap-2">
                <CheckCircle2 className="mt-1 size-4 shrink-0 text-emerald-500" aria-hidden />
                <span>
                  האתר מוגש דרך <b className="text-zinc-200">שעת-סנדבוקס</b> —
                  כתובת חיצונית אחת שמעבירה לשרת הפנימי. זו הכתובת שפתוחה
                  מולך בחלונית התצוגה.
                </span>
              </li>
              <li className="flex gap-2">
                <CheckCircle2 className="mt-1 size-4 shrink-0 text-emerald-500" aria-hidden />
                <span>
                  <b className="text-zinc-200">התוכן לא כלוא בכתובת:</b> כל מצב
                  באתר — כולל סשנים של דפדפן הסוכנים — הוא URL מבוסס-hash
                  (‎/#/…‎) שעובד <b className="text-zinc-200">על כל דומיין</b>{" "}
                  שהאתר ייפרס עליו. העברת דומיין = העתקת השרת, לא מיתוג מחדש.
                </span>
              </li>
              <li className="flex gap-2">
                <CheckCircle2 className="mt-1 size-4 shrink-0 text-emerald-500" aria-hidden />
                <span>
                  <b className="text-zinc-200">אין תלות ב-GitHub:</b> מקורות
                  המשחקים והחבילות מתפרסמים מקומית (מחוץ לריפו מאז R55) —
                  הפריסה הריבונית משלימה את התמונה: גם ה-serving יהיה שלך.
                </span>
              </li>
            </ul>
          </CardContent>
        </Card>
        <Card className="border-[#d4af37]/35 bg-gradient-to-b from-[#d4af37]/[0.07] to-transparent">
          <CardContent className="p-5">
            <h2 className="mb-2 flex items-center gap-2 text-sm font-bold text-zinc-100">
              <Rocket className="size-4 text-[#e8cd6e]" aria-hidden />
              פריצת הדרך — בפועל
            </h2>
            <p className="text-[13px] leading-6 text-zinc-400">
              דומיין פרטי על הרשת לא נדרש מאף ספק &quot;רשתי&quot;: רוכשים
              דומיין אצל רשם, שוכרים שרת (מכונה בלבד — בלי שכבת תוכן),
              מצביעים DNS, ומריצים את{" "}
              <b className="text-[#e8cd6e]">הערכה הריבונית</b> שהמרכז הזה
              מייצר לך. אף אחד לא יושב בינך לבין האתר.
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* רישום דומיינים */}
        <div className="min-w-0">
          <Card className="border-zinc-800 bg-zinc-950/50">
            <CardContent className="p-5">
              <h2 className="mb-4 flex items-center gap-2 text-sm font-bold text-zinc-100">
                <Server className="size-4 text-emerald-500" aria-hidden />
                רישום הדומיינים הפרטיים
              </h2>

              <div className="mb-4 grid gap-2">
                <div className="flex gap-2">
                  <Input
                    value={newDomain}
                    onChange={(e) => setNewDomain(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void addDomain();
                    }}
                    placeholder="example.com"
                    dir="ltr"
                    className="border-zinc-700 bg-zinc-900/70 font-mono text-sm text-zinc-100"
                    aria-label="דומיין חדש"
                  />
                  <Button
                    onClick={() => void addDomain()}
                    disabled={adding || !newDomain.trim()}
                    className="shrink-0 bg-emerald-600 font-semibold text-white hover:bg-emerald-500"
                  >
                    {adding ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden />
                    ) : (
                      <Plus className="size-4" aria-hidden />
                    )}
                    רישום
                  </Button>
                </div>
                <Input
                  value={newPurpose}
                  onChange={(e) => setNewPurpose(e.target.value)}
                  placeholder="למי ולמה? (למשל: האתר הראשי · משחקים · faucet)"
                  className="border-zinc-700 bg-zinc-900/70 text-sm text-zinc-100"
                  aria-label="מטרת הדומיין"
                />
              </div>

              {loading ? (
                <div className="flex items-center justify-center gap-2 py-8 text-sm text-zinc-500">
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  טוען את הרישום…
                </div>
              ) : loadError ? (
                <div className="rounded-xl border border-rose-500/30 bg-rose-500/[0.04] p-6 text-center text-xs leading-relaxed text-rose-600 dark:text-rose-300">
                  טעינת רישום הדומיינים נכשלה: {loadError}
                  <br />
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-3 h-9 border-rose-500/40 text-rose-600 dark:text-rose-300"
                    onClick={() => void load()}
                  >
                    <RefreshCw className="size-3.5" aria-hidden />
                    נסה שוב
                  </Button>
                </div>
              ) : domains.length === 0 ? (
                <div className="rounded-xl border border-dashed border-zinc-800 p-6 text-center text-xs leading-relaxed text-zinc-500">
                  אין דומיינים רשומים עדיין. הוסף את הדומיין הפרטי הראשון —
                  ואפשר יהיה להוריד לו ערכת-פריסה ריבונית מלאה בלחיצה.
                </div>
              ) : (
                <ul className="grid max-h-96 gap-2 overflow-y-auto [scrollbar-width:thin]">
                  {domains.map((d) => {
                    const meta = STATUS_META[d.status] ?? STATUS_META.PLANNED;
                    return (
                      <li
                        key={d.id}
                        className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <code
                            className="min-w-0 flex-1 truncate font-mono text-sm font-semibold text-zinc-100"
                            dir="ltr"
                          >
                            {d.domain}
                          </code>
                          <Select
                            value={d.status}
                            onValueChange={(v) => void setStatus(d.id, v)}
                          >
                            <SelectTrigger
                              className={cn(
                                "h-7 w-28 border bg-zinc-900/70 text-[11px]",
                                meta.cls,
                              )}
                              aria-label={`סטטוס ${d.domain}`}
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {Object.entries(STATUS_META).map(([k, m]) => (
                                <SelectItem key={k} value={k} className="text-xs">
                                  {m.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button
                            size="sm"
                            onClick={() => void downloadKit(d.domain)}
                            disabled={kitBusy === d.domain}
                            className="h-7 bg-[#d4af37] text-[11px] font-bold text-zinc-950 hover:bg-[#e8cd6e]"
                          >
                            {kitBusy === d.domain ? (
                              <Loader2 className="size-3.5 animate-spin" aria-hidden />
                            ) : (
                              <Download className="size-3.5" aria-hidden />
                            )}
                            הערכה
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="size-7 text-zinc-500 hover:text-red-400"
                            onClick={() => void removeDomain(d.id, d.domain)}
                            aria-label={`מחק את ${d.domain}`}
                          >
                            <Trash2 className="size-3.5" aria-hidden />
                          </Button>
                        </div>
                        {d.purpose && (
                          <p
                            className="mt-1.5 text-xs leading-5 text-zinc-500"
                            dir="auto"
                          >
                            {d.purpose}
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        {/* הערכה הריבונית */}
        <div className="min-w-0">
          <Card className="border-zinc-800 bg-zinc-950/50">
            <CardContent className="p-5">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-zinc-100">
                <ShieldCheck className="size-4 text-[#e8cd6e]" aria-hidden />
                הערכה הריבונית — חבילה אחת, שרת אחד, אפס תלות
              </h2>
              <div className="mb-4 flex gap-2">
                <Input
                  value={kitDomain}
                  onChange={(e) => setKitDomain(e.target.value)}
                  placeholder="דומיין לערכה (או לחץ ״הערכה״ ברישום)"
                  dir="ltr"
                  className="border-zinc-700 bg-zinc-900/70 font-mono text-sm text-zinc-100"
                  aria-label="דומיין ליצירת ערכה"
                />
                <Button
                  onClick={() => void downloadKit(kitDomain.trim().toLowerCase())}
                  disabled={!kitDomain.trim() || kitBusy !== null}
                  className="shrink-0 bg-[#d4af37] font-bold text-zinc-950 hover:bg-[#e8cd6e]"
                >
                  {kitBusy ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  ) : (
                    <Download className="size-4" aria-hidden />
                  )}
                  הורדת ZIP
                </Button>
              </div>
              <ul className="grid gap-1.5">
                {KIT_CONTENTS.map((f) => (
                  <li
                    key={f.name}
                    className="flex items-start gap-2 rounded-lg border border-zinc-800/70 bg-zinc-900/30 px-3 py-2"
                  >
                    <ArrowLeftRight className="mt-0.5 size-3.5 shrink-0 text-emerald-500" aria-hidden />
                    <div className="min-w-0">
                      <code className="font-mono text-xs text-zinc-200" dir="ltr">
                        {f.name}
                      </code>
                      <p className="text-[11px] leading-5 text-zinc-500">
                        {f.desc}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
              <p className="mt-4 rounded-lg bg-zinc-900/50 p-3 text-[11px] leading-5 text-zinc-500">
                הפריסה: רוכשים דומיין אצל כל רשם → יוצרים את רשומות ה-DNS
                (בקובץ שבחבילה) שמצביעות על ה-IP של השרת הפרטי שלך → מעתיקים
                את קוד האתר ל-<code dir="ltr" className="font-mono text-zinc-300">site/</code>{" "}
                → מריצים{" "}
                <code dir="ltr" className="font-mono text-zinc-300">./deploy.sh</code>{" "}
                — והדומיין חי עם HTTPS אוטומטי, בלי שאף ספק יכול לכבות אותו
                מלבד ספק המכונה שבחרת.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
