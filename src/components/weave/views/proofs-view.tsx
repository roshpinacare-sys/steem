"use client";

// ─────────────────────────────────────────────────────────────────────
// PROOFS VIEW (R208P) — לוח ספר-ההוכחות-הריבוני
// התשובה ל"הוכחתם ופתאום זה לא קיים": כל הוכחה רשומה hash-chained,
// עם פקודת-שחזור ועדות-קפואה — והראש חתום-עדות בספר-הרשת.
// ─────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Clock,
  Gavel,
  Hash,
  HelpCircle,
  History,
  RefreshCw,
  Scale,
  ShieldCheck,
  TerminalSquare,
} from "lucide-react";

interface ProofEntry {
  seq: number;
  at: string;
  claimId: string;
  claim: string;
  verdict: string;
  scope: string;
  round: string;
  law?: string;
  evidence: { path: string; sha256: string }[];
  reproduction?: { cmd: string; expect: string };
  lastRepro?: { at: string; exit: number; note: string };
  prevHash: string;
  entryHash: string;
  isLatest?: boolean;
}

interface GateReport {
  at?: string;
  head?: string;
  totalEntries?: number;
  claims?: { proven?: number; open?: number; refuted?: number };
  evidenceChecks?: { total?: number; drift?: number; historicalDrift?: number };
  repro?: { ran?: number; failed?: number };
}

interface LawReproRecord {
  claimId: string;
  seq: number;
  at: string;
  exit: number;
  ok: boolean;
  tail?: string;
}

interface LawState {
  version?: string;
  at?: string;
  beatCount?: number;
  book?: { exists?: boolean; totalEntries?: number; chainOk?: boolean; claims?: { proven?: number; open?: number; refuted?: number } };
  evidence?: { total?: number; driftLive?: number; driftHistorical?: number };
  repro?: { candidates?: number; lastAt?: string | null; failsTotal?: number; history?: LawReproRecord[] };
  alarms?: { id: string; severity: string; detail: string; at: string }[];
  lastOkAt?: string | null;
}

const VERDICT_STYLE: Record<string, { label: string; cls: string; icon: typeof CheckCircle2 }> = {
  PROVEN: { label: "מוכח", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30", icon: CheckCircle2 },
  RESOLVED: { label: "מוכרע-הכרעה", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30", icon: Gavel },
  "RESOLVED-BY-DECISION": { label: "מוכרע-הכרעה", cls: "bg-teal-500/15 text-teal-700 dark:text-teal-300 border-teal-500/30", icon: Gavel },
  STRENGTHENED: { label: "מתוגבר", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30", icon: CheckCircle2 },
  OPEN: { label: "פתוח-כנות", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30", icon: AlertTriangle },
  UNOBSERVED: { label: "לא-נצפה", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30", icon: HelpCircle },
  REFUTED: { label: "מופרך", cls: "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30", icon: AlertTriangle },
};

const SCOPE_LABEL: Record<string, string> = {
  LAB: "מעבדה",
  LIVE: "חי",
  STRUCTURAL: "מבני",
  NETWORK: "רשת",
};

export function ProofsView() {
  const [data, setData] = useState<{ head: string | null; totalEntries: number; entries: ProofEntry[]; gate: GateReport | null; law?: LawState | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const reduced = useReducedMotion();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/proofs", { cache: "no-store" });
      const j = await res.json();
      setData(j);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = (id: string) =>
    setOpen((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const entries = data?.entries ?? [];
  const gate = data?.gate ?? null;
  const law = data?.law ?? null;
  const lawCrit = (law?.alarms ?? []).filter((a) => a.severity === "CRITICAL").length;
  const lastRepro = law?.repro?.history?.[0] ?? null;
  const provenCount = entries.filter((e) => ["PROVEN", "STRENGTHENED", "RESOLVED-BY-DECISION"].includes(e.verdict)).length;
  const openCount = entries.filter((e) => ["OPEN", "UNOBSERVED"].includes(e.verdict)).length;

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 py-8 sm:px-6 sm:py-12">
      {/* כותרת */}
      <motion.header
        initial={reduced ? false : { opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="flex flex-col gap-4"
      >
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex size-12 items-center justify-center rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
            <Scale className="size-6" aria-hidden="true" />
          </span>
          <div className="flex-1">
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">ספר ההוכחות הריבוני</h1>
            <p className="text-sm text-muted-foreground">
              כל הוכחה רשומה פעם-אחת · hash-chained · פקודת-שחזור חיה · עדות-קפואה · הראש חתום-עדות בספר-הרשת — אין שכחה
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-2">
            <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} aria-hidden="true" />
            רענן
          </Button>
        </div>
      </motion.header>

      {/* ראש-הספר + שער */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
              <Hash className="size-4" aria-hidden="true" /> ראש הספר
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="break-all font-mono text-sm">{data?.head ? `${data.head.slice(0, 32)}…` : "—"}</p>
            <p className="mt-1 text-xs text-muted-foreground">{data?.totalEntries ?? 0} רשומות · append-only</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
              <CheckCircle2 className="size-4" aria-hidden="true" /> מיון הטענות
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Badge className="border border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
              {provenCount} מוכחות
            </Badge>
            <Badge className="border border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300">
              {openCount} פתוחות-כנות
            </Badge>
            <Badge variant="outline">0 מופרכות</Badge>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
              <History className="size-4" aria-hidden="true" /> שער פתיחת-מושב אחרון
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            {gate ? (
              <div className="flex flex-col gap-1">
                <span className="text-muted-foreground">
                  <Clock className="me-1 inline size-3.5" aria-hidden="true" />
                  {gate.at ? new Date(gate.at).toLocaleString("he-IL") : "—"}
                </span>
                <span>
                  שרשרת ✓ · עדויות {gate.evidenceChecks?.total ?? 0} (סטיות {gate.evidenceChecks?.drift ?? 0})
                  {gate.repro?.ran ? ` · שחזור-חי ${gate.repro.ran} (נכשלו ${gate.repro.failed ?? 0})` : ""}
                </span>
              </div>
            ) : (
              <span className="text-muted-foreground">השער טרם רץ במושב זה</span>
            )}
          </CardContent>
        </Card>
      </div>

      {/* חוק הספר */}
      <Card className="border-emerald-500/20 bg-emerald-500/5">
        <CardContent className="flex flex-col gap-1 p-4 text-sm sm:flex-row sm:items-center sm:gap-3">
          <Gavel className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
          <span>
            חוק: <strong>PROVEN אינו נפתח-מחדש לעולם</strong> — רק מופרך; ההפרכה עצמה נרשמת בספר. OPEN הוא מצב-כנה: חסרת-עדות נרשמת בדיוק, לא מומצאת. כל סבב מריץ את שער-פתיחת-המושב לפני עבודה.
          </span>
        </CardContent>
      </Card>

      {/* המאכף-העומד (R209) — החוק רץ בעצמו, בלי זיכרון-סוכן */}
      {law && (
        <Card className={lawCrit > 0 ? "border-rose-500/30 bg-rose-500/5" : "border-teal-500/20 bg-teal-500/5"}>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
              <ShieldCheck className={`size-4 ${lawCrit > 0 ? "text-rose-600 dark:text-rose-400" : "text-teal-600 dark:text-teal-400"}`} aria-hidden="true" />
              המאכף-העומד של החוק (R209 · :3052) — השער רץ כל 5 דק' גם כשאף-סוכן לא זוכר
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className={law.book?.chainOk && lawCrit === 0 ? "border border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "border border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300"}>
                {law.book?.chainOk && lawCrit === 0 ? "שרשרת תקינה" : `אזעקות חמורות: ${lawCrit}`}
              </Badge>
              <Badge variant="outline">פעימה #{law.beatCount ?? 0}</Badge>
              <Badge variant="outline">עדויות {law.evidence?.total ?? 0} · סטיות-חיות {law.evidence?.driftLive ?? 0}</Badge>
              <Badge variant="outline">כשלי-שחזור מצטברים {law.repro?.failsTotal ?? 0}</Badge>
              {law.at && <span className="text-xs text-muted-foreground">פעימה אחרונה: {new Date(law.at).toLocaleString("he-IL")}</span>}
            </div>
            {lastRepro && (
              <p className="text-xs text-muted-foreground">
                שחזור-חי אחרון: <span className="font-mono">{lastRepro.claimId}</span> —{" "}
                {lastRepro.ok ? <span className="text-emerald-600 dark:text-emerald-400">הצליח (exit {lastRepro.exit})</span> : <span className="text-rose-600 dark:text-rose-400">נכשל (exit {lastRepro.exit})</span>}
                {" "}· {lastRepro.at ? new Date(lastRepro.at).toLocaleString("he-IL") : ""}
              </p>
            )}
            {lawCrit > 0 && (
              <ul className="flex flex-col gap-1">
                {(law.alarms ?? []).filter((a) => a.severity === "CRITICAL").map((a) => (
                  <li key={a.id} className="text-xs text-rose-700 dark:text-rose-300">
                    · {a.id}: {a.detail}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      {/* הרשימה */}
      {loading && !entries.length ? (
        <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
          <RefreshCw className="size-4 animate-spin" aria-hidden="true" /> טוען את הספר…
        </div>
      ) : (
        <ScrollArea className="max-h-[70vh] pr-2">
          <div className="flex flex-col gap-3">
            {entries.map((e, i) => {
              const style = VERDICT_STYLE[e.verdict] ?? VERDICT_STYLE.PROVEN;
              const Icon = style.icon;
              const isOpen = open.has(e.claimId);
              return (
                <motion.div
                  key={`${e.claimId}-${e.seq}`}
                  initial={reduced ? false : { opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: Math.min(i * 0.03, 0.3) }}
                >
                  <Card className={isOpen ? "border-emerald-500/30" : undefined}>
                    <button
                      type="button"
                      onClick={() => toggle(e.claimId)}
                      aria-expanded={isOpen}
                      className="flex w-full flex-col gap-2 p-4 text-start sm:flex-row sm:items-center sm:gap-4"
                    >
                      <Icon className={`size-5 shrink-0 ${e.verdict === "OPEN" || e.verdict === "UNOBSERVED" ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}`} aria-hidden="true" />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-sm font-semibold">{e.claimId}</span>
                          <Badge variant="outline" className={`text-[11px] ${style.cls}`}>{style.label}</Badge>
                          <Badge variant="outline" className="text-[11px]">{SCOPE_LABEL[e.scope] ?? e.scope}</Badge>
                        </div>
                        <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{e.claim}</p>
                      </div>
                      <ChevronDown className={`size-4 shrink-0 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`} aria-hidden="true" />
                    </button>
                    {isOpen && (
                      <CardContent className="border-t pt-4">
                        <div className="flex flex-col gap-3 text-sm">
                          <div>
                            <p className="mb-1 font-semibold">הטענה המלאה</p>
                            <p className="leading-relaxed text-muted-foreground">{e.claim}</p>
                          </div>
                          {e.law && (
                            <div>
                              <p className="mb-1 font-semibold">החוק שהוכח</p>
                              <p className="text-muted-foreground">{e.law}</p>
                            </div>
                          )}
                          {e.reproduction && (
                            <div>
                              <p className="mb-1 flex items-center gap-1 font-semibold">
                                <TerminalSquare className="size-4" aria-hidden="true" /> פקודת-שחזור (רצה-חי בסבב R208P)
                              </p>
                              <pre className="overflow-x-auto rounded-lg bg-muted p-3 font-mono text-xs" dir="ltr">{e.reproduction.cmd}</pre>
                              {e.lastRepro && (
                                <p className="mt-1 text-xs text-muted-foreground">
                                  רץ {new Date(e.lastRepro.at).toLocaleString("he-IL")} · exit={e.lastRepro.exit} · {e.lastRepro.note}
                                </p>
                              )}
                            </div>
                          )}
                          <div>
                            <p className="mb-1 font-semibold">עדויות קפואות (sha256)</p>
                            <ul className="flex flex-col gap-1">
                              {e.evidence.map((ev) => (
                                <li key={ev.path} className="break-all font-mono text-xs text-muted-foreground" dir="ltr">
                                  {ev.path.replace("/home/z/my-project/", "")} · {ev.sha256.slice(0, 24)}…
                                </li>
                              ))}
                            </ul>
                          </div>
                          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            <Badge variant="outline" className="font-mono">entry {e.entryHash.slice(0, 16)}…</Badge>
                            <Badge variant="outline" className="font-mono">seq {e.seq}</Badge>
                            <Badge variant="outline">{e.round}</Badge>
                            {!e.isLatest && <Badge variant="outline" className="text-amber-600">הוחלף-ברוויזיה</Badge>}
                          </div>
                        </div>
                      </CardContent>
                    )}
                  </Card>
                </motion.div>
              );
            })}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
