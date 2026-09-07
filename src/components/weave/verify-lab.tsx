"use client";

/**
 * verify-lab — מעבדת-האימות החיה · שני חידושים שקיימים רק פה:
 *
 * 1. אימות-חי בדפדפן — המתמטיקה של הקרנל רצה אצל המשתמש: העלה מוליד את-עצמו
 *    מהרישום הציבורי (Web Crypto), הנתיב מתקפל צעד-אחר-צעד, והשורש נבדק מול
 *    האיטום — בלי לסמוך על שרת זה. "אל תסמכו עלינו — תראו את החשבון."
 *
 * 2. אתגר-המזייף — משחק-הוכחה: שלושה ניסיוני-זיוף (עלה/נתיב/שורש), וכל-אחד
 *    נתפס בדיוק כמו שהקרנל תופס — root-mismatch. זה לא רטוריקה, זו מתמטיקה.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  FlaskConical,
  Play,
  RotateCcw,
  ShieldCheck,
  ShieldX,
  Swords,
  Sigma,
} from "lucide-react";
import { Panel, SectionHead, HashText, Spinner, EmptyState, LiveDot } from "./primitives";
import { foldAll, weaveLeafOf, canonLeaf, type FoldStepResult, type LeafEntry } from "@/lib/merkle-client";
import type { Certificate } from "@/hooks/use-weave";
import { cn } from "@/lib/utils";

/* ── עזר: גרימת-תו-אחד ב-hex ── */
function flipHexChar(h: string): { out: string; at: number } {
  const arr = h.split("");
  const at = Math.floor(Math.random() * arr.length);
  const cur = arr[at];
  let c = cur;
  while (c === cur) c = "0123456789abcdef"[Math.floor(Math.random() * 16)];
  arr[at] = c;
  return { out: arr.join(""), at };
}

/* ── תצוגת-hex עם סימון-תו-מזויף ── */
function TaintedHex({ h, at }: { h: string; at?: number | null }) {
  return (
    <span className="hash text-[11px] break-all" dir="ltr">
      {h.split("").map((c, i) => (
        <span key={i} className={i === at ? "text-broken font-black bg-broken/15 rounded-sm px-[1px]" : undefined}>
          {c}
        </span>
      ))}
    </span>
  );
}

/* ── שורת-צעד באימות-החי ── */
function StepRow({
  label,
  before,
  sibling,
  pos,
  after,
  break: broken,
  delay = 0,
}: {
  label: string;
  before?: string;
  sibling?: string;
  pos?: "L" | "R";
  after: string;
  break?: boolean;
  delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, x: 14 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.32, delay }}
      className={cn(
        "rounded-xl border px-3.5 py-3 space-y-1.5",
        broken ? "border-broken/40 bg-broken/5" : "border-gold/20 bg-gold/[0.04]"
      )}
    >
      <div className="flex items-center gap-2 text-[11px]">
        <span className={cn("hash font-bold uppercase tracking-wider", broken ? "text-broken" : "text-gold-dim")}>{label}</span>
        {pos && <span className="hash rounded border border-border px-1.5 text-[9.5px] text-ink-2">sib={pos}</span>}
      </div>
      {before !== undefined && sibling !== undefined && (
        <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-ink-2/85" dir="ltr">
          <HashText h={before} head={12} tail={8} copy={false} className="text-ink/70" />
          <span className="text-gold-dim">{pos === "L" ? "←" : "→"}</span>
          <HashText h={sibling} head={12} tail={8} copy={false} className="text-ink/70" />
        </div>
      )}
      <div className="flex items-center gap-2">
        <span className="text-gold-dim text-[10px]">sha-256 →</span>
        <TaintedHex h={after} />
      </div>
    </motion.div>
  );
}

/* ══ 1 · אימות-חי בדפדפן ══ */
export function VerifyLab({ cert, onNeedCert }: { cert: Certificate | null; onNeedCert?: () => void }) {
  const proof = cert?.proof;
  const ready = !!(cert && proof?.leafEntry && proof.path && proof.root && proof.leaf);

  const [phase, setPhase] = useState<"idle" | "running" | "ok" | "fail">("idle");
  const [leafComputed, setLeafComputed] = useState<string | null>(null);
  const [leafOk, setLeafOk] = useState<boolean | null>(null);
  const [steps, setSteps] = useState<FoldStepResult[]>([]);
  const [visible, setVisible] = useState(0);
  const [finalOk, setFinalOk] = useState<boolean | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = () => {
    if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
  };

  const run = useCallback(async () => {
    if (!ready || !proof) return;
    stop();
    setPhase("running");
    setSteps([]);
    setVisible(0);
    setFinalOk(null);
    setLeafComputed(null);
    setLeafOk(null);

    // צעד-0: העלה מוליד את-עצמו מהרישום הציבורי — בדפדפן
    const leaf = await weaveLeafOf(proof.leafEntry!);
    setLeafComputed(leaf);
    const ok = leaf === proof.leaf;
    setLeafOk(ok);

    await new Promise((r) => setTimeout(r, 450));
    if (leaf !== proof.leaf) {
      setPhase("fail");
      return;
    }

    const { steps: all } = await foldAll(leaf, proof.path!);
    setSteps(all);
    // עלה-בודד: אין קיפולים — העלה עצמו הוא השורש
    if (all.length === 0) {
      const ok = leaf === proof.root;
      setFinalOk(ok);
      setPhase(ok ? "ok" : "fail");
      return;
    }
    // חשיפה הדרגתית — המתמטיקה מופיעה צעד-אחר-צעד
    let i = 0;
    timer.current = setInterval(() => {
      i++;
      setVisible(i);
      if (i >= all.length) {
        stop();
        setFinalOk(all[all.length - 1].after === proof.root);
        setPhase(all[all.length - 1].after === proof.root ? "ok" : "fail");
      }
    }, 520);
  }, [ready, proof]);

  // ריצה-אוטומטית כשהתעודה משתנה
  useEffect(() => {
    setPhase("idle");
    setSteps([]);
    setVisible(0);
    setFinalOk(null);
    setLeafComputed(null);
    setLeafOk(null);
    if (ready) run();
    return stop;
  }, [ready, cert?.h]);

  const canonStr = proof?.leafEntry ? canonLeaf(proof.leafEntry as LeafEntry) : null;

  return (
    <div>
      <SectionHead
        eyebrow="LIVE VERIFICATION"
        title="אימות-חי בדפדפן שלך"
        icon={<FlaskConical className="size-3.5" />}
        desc="העלה מוליד את-עצמו מהרישום הציבורי, הנתיב מתקפל צעד-אחר-צעד, והשורש נבדק מול האיטום. כל חישוב רץ עם Web Crypto במכשיר שלך — אנחנו בכלל לא מעורבים."
      />

      {!cert ? (
        <Panel>
          <EmptyState title="אין עדיין תעודה טעונה" sub="חפש hash במקטע תעודות — והמעבדה תריץ עליו את המתמטיקה המלאה" />
          {onNeedCert && (
            <div className="text-center mt-3">
              <button type="button" onClick={onNeedCert} className="text-xs text-gold underline underline-offset-4 hover:text-gold-soft">
                קח אותי לחיפוש
              </button>
            </div>
          )}
        </Panel>
      ) : !ready ? (
        <Panel>
          <EmptyState
            title={cert.status === "pending-seal" ? "החותמת חיה — הנתיב נפתח אחרי האיטום השעתי" : "אין נתיב-הוכחה לתעודה זו"}
            sub={cert.status === "pending-seal" ? "ספירה-לאחור לאצווה: עד השעה העגולה הבאה" : undefined}
          />
        </Panel>
      ) : (
        <div className="space-y-4">
          {/* מקור-העלה */}
          <Panel className="!p-4 md:!p-5">
            <div className="flex items-center justify-between gap-3 mb-3">
              <span className="text-[11px] text-gold-dim hash uppercase tracking-widest">צעד 0 · גזירת-העלה</span>
              {leafOk === null ? (
                phase === "running" ? <Spinner className="size-3.5" /> : null
              ) : leafOk ? (
                <span className="flex items-center gap-1.5 text-[11px] text-verified"><LiveDot tone="green" className="text-current" /> תואם לספר הציבורי</span>
              ) : (
                <span className="flex items-center gap-1.5 text-[11px] text-broken"><ShieldX className="size-3.5" /> חוסר-תאימות — נתפס</span>
              )}
            </div>
            <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5">
              <div className="text-[10px] text-ink-2/70 mb-1">canon(leafEntry) — מפתחות-ממוינים, זהה-לקרנל</div>
              <div className="hash text-[10.5px] text-ink/85 break-all" dir="ltr">{canonStr}</div>
            </div>
            {leafComputed && (
              <div className="mt-2.5 space-y-1.5">
                <div className="flex items-center gap-2 text-[10px] text-ink-2"><span className="text-gold-dim">sha-256 →</span> עלה-משוחזר בדפדפן:</div>
                <div className="hash text-[11px] text-gold-soft break-all" dir="ltr">{leafComputed}</div>
              </div>
            )}
          </Panel>

          {/* צעדי-הקיפול */}
          {steps.length > 0 && (
            <div className="space-y-2.5">
              {steps.slice(0, visible).map((s) => (
                <StepRow
                  key={s.step}
                  label={`קיפול ${s.step}/${steps.length}`}
                  before={s.before}
                  sibling={s.sibling}
                  pos={s.pos}
                  after={s.after}
                />
              ))}
            </div>
          )}

          {/* הגמר */}
          <AnimatePresence>
            {finalOk !== null && (
              <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }}>
                <Panel className={cn(finalOk ? "!border-verified/40" : "!border-broken/40")}>
                  <div className={cn("flex items-center gap-3", finalOk ? "text-verified" : "text-broken")}>
                    {finalOk ? <ShieldCheck className="size-7" /> : <ShieldX className="size-7" />}
                    <div>
                      <div className="font-display text-lg font-bold">
                        {finalOk ? "המתמטיקה התקפלה אל השורש — התעודה שלמה" : "הקיפול לא הגיע לשורש — תעודה פגומה"}
                      </div>
                      <div className="text-[11px] mt-1 text-ink-2 flex flex-wrap items-center gap-2">
                        שורש-איטום: <HashText h={proof!.root} head={14} tail={10} copy={false} className="text-gold-soft" />
                        <span>· הושווה בדפדפן שלך, שעה {new Date().toLocaleTimeString("he-IL")}</span>
                      </div>
                    </div>
                  </div>
                </Panel>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={run}
              disabled={phase === "running" || !ready}
              className="inline-flex items-center gap-2 rounded-xl border border-gold/30 bg-gold/10 px-4 py-2.5 text-xs font-bold text-gold hover:bg-gold/15 transition-colors disabled:opacity-40"
            >
              {phase === "running" ? <Spinner className="size-3.5" /> : <Play className="size-3.5" />}
              {steps.length ? "הרץ שוב" : "הרץ את המתמטיקה"}
            </button>
            <span className="text-[11px] text-ink-2/70">
              {proof!.path!.length} צעדי-קיפול · {steps.length + 1} פעולות sha-256 · אפס אמון בשרת
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

/* ══ 2 · אתגר-המזייף ══ */
type ForgeKind = "leaf" | "path" | "root";

export function ForgerChallenge({ cert, onNeedCert }: { cert: Certificate | null; onNeedCert?: () => void }) {
  const proof = cert?.proof;
  const ready = !!(cert && proof?.leafEntry && proof.path && proof.root && proof.leaf);

  const [attempt, setAttempt] = useState<ForgeKind | null>(null);
  const [tampered, setTampered] = useState<{ leaf?: string; leafAt?: number; sib?: string; sibAt?: number; stepIdx?: number; root?: string; rootAt?: number } | null>(null);
  const [caught, setCaught] = useState<null | { at: string; detail: string }>(null);
  const [running, setRunning] = useState(false);

  const forge = async (kind: ForgeKind) => {
    if (!ready || running || !proof) return;
    setRunning(true);
    setAttempt(kind);
    setCaught(null);
    setTampered(null);

    await new Promise((r) => setTimeout(r, 350));

    if (kind === "leaf") {
      const { out, at } = flipHexChar(proof.leaf!);
      const { final } = await foldAll(out, proof.path!);
      setTampered({ leaf: out, leafAt: at });
      setCaught(
        final === proof.root
          ? null
          : { at: "root-mismatch", detail: `הקיפול מהעלה-המזויף הגיע ל-${final.slice(0, 16)}… — לא לשורש האיטום. הקרנל מחזיר root-mismatch ודוחה.` }
      );
    } else if (kind === "path") {
      // עלה-בודד: אין נתיב — זיוף-הנתיב אינו-רלוונטי (העלה הוא השורש)
      if (!proof.path!.length) {
        setCaught({ at: "no-path", detail: "לתעודה זו עלה-בודד — אין בכלל נתיב לזייף. זייף את העלה או את השורש." });
        setRunning(false);
        return;
      }
      // זיוף אח-אחד בנתיב
      const si = Math.floor(Math.random() * proof.path!.length);
      const { out, at } = flipHexChar(proof.path![si].h);
      const path = proof.path!.map((p, i) => (i === si ? { ...p, h: out } : p));
      const { final } = await foldAll(proof.leaf!, path);
      setTampered({ sib: out, sibAt: at, stepIdx: si + 1 });
      setCaught(
        final === proof.root
          ? null
          : { at: "root-mismatch", detail: `זיוף האח בצעד ${si + 1} מסיט את כל-השרשרת: התוצאה ${final.slice(0, 16)}… ≠ השורש. הקרנל מחזיר root-mismatch.` }
      );
    } else {
      // זיוף השורש עצמו — ההוכחה נשארת נכונה, אבל היא לא מתקפלת אליו
      const { out, at } = flipHexChar(proof.root!);
      const { final } = await foldAll(proof.leaf!, proof.path!);
      setTampered({ root: out, rootAt: at });
      setCaught(
        final === out
          ? null
          : { at: "root-mismatch", detail: `ההוכחה מקפלת אל השורש האמיתי — לא אל השורש-המזויף. המזייף צריך למצוא נתיב חדש שמתקפל ל-sha256 אחר, וזה אינו-אפשרי בכוח-גס.` }
      );
    }
    setRunning(false);
  };

  const reset = () => {
    setAttempt(null);
    setTampered(null);
    setCaught(null);
  };

  const buttons: { k: ForgeKind; label: string; desc: string }[] = [
    { k: "leaf", label: "זייף את העלה", desc: "שנה תו אחד ב-hash של החותמת" },
    { k: "path", label: "זייף את הנתיב", desc: proof?.path?.length ? "שנה תו אחד באח אחד מהנתיב" : "אין נתיב — עלה-בודד" },
    { k: "root", label: "זייף את השורש", desc: "החלף את שורש-האיטום החתום" },
  ];

  return (
    <div>
      <SectionHead
        eyebrow="THE FORGER CHALLENGE"
        title="אתגר-המזייף — נסה לרמות את הנול"
        icon={<Swords className="size-3.5" />}
        desc="זייף תעודה אמיתית ותראה בדיוק איפה הזיוף נתפס. זה לא בטחון-עצמי — זו הפונקציה שהקרנל עצמו רץ איתה. שלושה זיופים, שלושה כישלונות."
      />

      {!cert ? (
        <Panel>
          <EmptyState title="אין עדיין תעודה לזייף" sub="חפש hash במקטע תעודות — ואז נסה לשבור אותה כאן" />
          {onNeedCert && (
            <div className="text-center mt-3">
              <button type="button" onClick={onNeedCert} className="text-xs text-gold underline underline-offset-4 hover:text-gold-soft">
                קח אותי לחיפוש
              </button>
            </div>
          )}
        </Panel>
      ) : !ready ? (
        <Panel>
          <EmptyState
            title={cert.status === "pending-seal" ? "החותמת חיה — הזיופים נפתחים אחרי האיטום" : "אין נתיב-הוכחה לתעודה זו"}
          />
        </Panel>
      ) : (
        <div className="grid lg:grid-cols-5 gap-4">
          {/* בחירת-הזיוף */}
          <div className="lg:col-span-2 space-y-3">
            {buttons.map((b) => (
              <button
                key={b.k}
                type="button"
                onClick={() => forge(b.k)}
                disabled={running}
                className={cn(
                  "w-full text-right rounded-xl border px-4 py-3.5 transition-all group",
                  attempt === b.k
                    ? "border-gold/50 bg-gold/10"
                    : "border-border bg-muted/20 hover:border-gold/30 hover:bg-gold/5",
                  running && "opacity-50 pointer-events-none"
                )}
              >
                <div className="flex items-center gap-2.5">
                  <span className="grid place-items-center size-8 rounded-lg border border-gold/25 bg-gold/10 text-gold">
                    <Swords className="size-4" />
                  </span>
                  <span>
                    <span className="block text-sm font-bold text-ink">{b.label}</span>
                    <span className="block text-[11px] text-ink-2">{b.desc}</span>
                  </span>
                </div>
              </button>
            ))}
            {attempt && (
              <button type="button" onClick={reset} className="w-full rounded-xl border border-border px-4 py-2.5 text-xs text-ink-2 hover:text-ink transition-colors inline-flex items-center justify-center gap-2">
                <RotateCcw className="size-3.5" /> אפס את המעבדה
              </button>
            )}

            <Panel className="!p-4 text-[11px] text-ink-2 leading-relaxed">
              <div className="flex items-center gap-2 text-gold-dim hash uppercase tracking-widest mb-2"><Sigma className="size-3.5" /> על מה מנסים לרמות</div>
              שורש-האיטום <span className="hash text-gold-soft">{proof!.root!.slice(0, 10)}…</span> חתום על הספר הריבוני ומעוגן בציבור. כדי לזייף, צריך למצוא קלט-חדש שמתקפל אל אותו שורש — זו בעיית-preimage של sha-256, בלתי-אפשרית בכוח-גס.
            </Panel>
          </div>

          {/* תוצאות-הזיוף */}
          <Panel className="lg:col-span-3 min-h-64">
            <AnimatePresence mode="wait">
              {running ? (
                <motion.div key="run" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="h-full grid place-items-center">
                  <div className="flex flex-col items-center gap-3 text-ink-2">
                    <Spinner className="size-6" />
                    <span className="text-sm">מריץ את הזיוף מול המתמטיקה…</span>
                  </div>
                </motion.div>
              ) : caught ? (
                <motion.div key="caught" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
                  <div className="flex items-center gap-3 text-broken">
                    <ShieldX className="size-8" />
                    <div>
                      <div className="font-display text-xl font-black">{caught.at === "no-path" ? "אין מה לזייף כאן" : "הזיוף נתפס"}</div>
                      <div className="text-xs mt-0.5">{caught.at === "no-path" ? "עלה-בודד — בחר זיוף אחר" : <>הקרנל מחזיר <span className="hash font-bold">root-mismatch</span> — בדיוק כך זה קורה על הספר האמיתי</>}</div>
                    </div>
                  </div>

                  {tampered?.leaf && (
                    <div className="rounded-xl border border-broken/30 bg-broken/5 px-4 py-3 space-y-1.5">
                      <div className="text-[11px] text-broken font-bold">העלה-המזויף (תו {tampered.leafAt} הוחלף):</div>
                      <TaintedHex h={tampered.leaf} at={tampered.leafAt} />
                    </div>
                  )}
                  {tampered?.sib && (
                    <div className="rounded-xl border border-broken/30 bg-broken/5 px-4 py-3 space-y-1.5">
                      <div className="text-[11px] text-broken font-bold">האח-המזויף בצעד {tampered.stepIdx} (תו {tampered.sibAt} הוחלף):</div>
                      <TaintedHex h={tampered.sib} at={tampered.sibAt} />
                    </div>
                  )}
                  {tampered?.root && (
                    <div className="rounded-xl border border-broken/30 bg-broken/5 px-4 py-3 space-y-1.5">
                      <div className="text-[11px] text-broken font-bold">השורש-המזויף (תו {tampered.rootAt} הוחלף):</div>
                      <TaintedHex h={tampered.root} at={tampered.rootAt} />
                    </div>
                  )}

                  <div className="rounded-xl border border-verified/30 bg-verified/5 px-4 py-3.5 text-sm leading-relaxed">
                    <span className="text-verified font-bold">מה קרה:</span>{" "}
                    <span className="text-ink">{caught.detail}</span>
                  </div>
                  <div className="text-[11px] text-ink-2/70">
                    הזיוף רץ בדפדפן שלך — על נתיב אמיתי מהספר, מול שורש אמיתי מהאיטום. אותו-חשבון שהקרנל עצמו עושה בכל איטום.
                  </div>
                </motion.div>
              ) : attempt === null ? (
                <motion.div key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="h-full grid place-items-center min-h-56">
                  <div className="text-center text-ink-2/70">
                    <Swords className="size-10 mx-auto mb-3 opacity-40" />
                    <div className="text-sm font-medium">בחר זיוף — ותראה איפה הוא נשבר</div>
                    <div className="text-xs mt-1.5 max-w-64 mx-auto leading-relaxed">הנתיב האמיתי של תעודת <span className="hash">#{cert.seq}</span> טעון ומוכן</div>
                  </div>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </Panel>
        </div>
      )}
    </div>
  );
}
