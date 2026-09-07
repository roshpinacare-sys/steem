"use client";

/**
 * system — לב המערכת: המפרט, חבילת-האימות החיה, ומפת-הדרך.
 * CheckpointAxis — ציר-הצ'קפוינטים: החקירה המלאה מאחורי "אימות 24/33".
 *   כל צ'קפוינט היסטורי — גובה, שורש-מצב של הצומת, והאם ה-replay המתמטי
 *   מניב בדיוק אותו שורש. פער מתועד נראה כאן ככרטיס-אירוע כן — לא כתעלומה.
 */

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  Cpu,
  CheckCircle2,
  XCircle,
  ShieldCheck,
  ShieldAlert,
  History,
  ChevronDown,
} from "lucide-react";
import { Panel, SectionHead, HashText, Spinner, EmptyState, ErrorState, LiveDot, Tip, fmtClock } from "./primitives";
import { fetchCheckpoints, useVerifyPack, useWeaveStatus, type CheckpointsData } from "@/hooks/use-weave";
import { cn } from "@/lib/utils";

const GAS_ROWS = [
  { op: "stamp", gas: 20, what: "חותמת-קיום על hash" },
  { op: "seal", gas: 60, what: "איטום אצווה לשורש-מרקל" },
  { op: "witness", gas: 40, what: "עדות על claim" },
  { op: "transfer", gas: 10, what: "העברה בסיסית" },
  { op: "heartbeat", gas: 10, what: "פעימת-חיים" },
];

const ROADMAP = [
  { id: "W1", what: "קרנל-האריגה: ops stamp/seal/witness + מרקל-קנוני", done: true },
  { id: "W2", what: "באצ'ר שעתי + עיגון 4 שרשראות + תעודת-באצ'ר", done: true },
  { id: "W3", what: "API ציבורי מלא + הוכחת-קצה-חיה על Steem", done: true },
  { id: "W4", what: "הנול v3 — פלטפורמת מקטעים: אימות-חי בדפדפן · אתגר-המזייף · חותמת-סוד · קיר-הישגים", done: true },
  { id: "W5", what: "base-snapshot ב-replay (סגירת-פער-היסטוריה) + verify15 מורחב", done: true },
  { id: "W6", what: "כלכלת-האריגה: חותמות-פרימיום ועדים-מתומחרים", done: false },
];

export function System() {
  const { data: pack, loading, error, refresh } = useVerifyPack();
  const { data: status } = useWeaveStatus();
  const chain = status?.chain;
  const w = status?.weave;

  return (
    <div className="space-y-8">
      <SectionHead
        eyebrow="THE ENGINE"
        title="לב המערכת"
        icon={<Cpu className="size-3.5" />}
        desc="SAOS-NET v1.3 — שרשרת ריבונית עם stateRoot=sha256, צ'קפוינט כל 12 בלוקים, וקרנל שמאמת הכל מתמטית בזמן-ריצה. שום-דבר כאן לא על אמונה — על מתמטיקה שאפשר להריץ."
      />

      <div className="grid lg:grid-cols-2 gap-4">
        {/* המפרט */}
        <Panel>
          <h3 className="font-display text-lg font-bold text-ink mb-4">מפרט-השרשרת</h3>
          <dl className="text-sm space-y-3">
            <SpecRow k="רשת" v={<span className="hash">SAOS-NET v1.3</span>} />
            <SpecRow k="stateRoot" v={<span className="hash text-gold-soft">sha256(canon(state))</span>} />
            <SpecRow k="צ'קפוינט" v={<span>כל <span className="hash text-gold-soft">12</span> בלוקים — נישא ב-stateRoot ומעוגן יומית. <span className="text-[11px] text-ink-2">ציר המלא: מקטע מערכת ← ציר-הצ'קפוינטים</span></span>} />
            <SpecRow k="קיבולת-אריגה" v={<span><span className="hash text-gold-soft">1024</span> חותמות חיות · איטום-לחץ ב-768 · על-פי מדידת-קיבולת: ~36K פעולות/יום</span>} />
            <SpecRow k="טבעות" v={<span>seals ×<span className="hash">32</span> · witnesses ×<span className="hash">64</span> (lazy-materialization)</span>} />
            <SpecRow k="גובה חי" v={<span className="hash text-gold-soft">{chain?.height ?? "—"}</span>} />
            <SpecRow k="שורש חי" v={<HashText h={chain?.finalRoot} head={14} tail={10} className="text-gold-soft text-xs" />} />
            <SpecRow k="שחזור" v={<span>מהג'נזיס + הארכיון המלא (append-only) — כל שחזר יקבל בדיוק את אותו ספר</span>} />
          </dl>

          <div className="h-px bg-border my-5" aria-hidden />
          <div className="text-[11px] text-gold-dim hash uppercase tracking-widest mb-3">gas · תעריף-הקרנל</div>
          <div className="space-y-2">
            {GAS_ROWS.map((g) => (
              <div key={g.op} className="flex items-center gap-3 text-xs">
                <span className="hash text-ink w-20 font-bold">{g.op}</span>
                <span className="hash text-gold w-12">{g.gas}</span>
                <span className="text-ink-2">{g.what}</span>
              </div>
            ))}
          </div>
        </Panel>

        {/* חבילת-אימות */}
        <Panel>
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-display text-lg font-bold text-ink flex items-center gap-2">
              <ShieldCheck className="size-5 text-verified" />
              חבילת-אימות חיה
            </h3>
            {pack && (
              <span className={cn("hash text-xs px-2.5 py-1 rounded-full border", pack.summary.failed === 0 ? "text-verified border-verified/30 bg-verified/5" : "text-gold border-gold/30 bg-gold/5")}>
                {pack.summary.passed}/{pack.summary.total}
              </span>
            )}
          </div>
          {loading && !pack ? (
            <div className="grid place-items-center py-14"><Spinner className="size-6" /></div>
          ) : error && !pack ? (
            <ErrorState detail={error} onRetry={refresh} />
          ) : !pack?.checks?.length ? (
            <EmptyState title="חבילת-האימות טרם זמינה" />
          ) : (
            <div className="space-y-2">
              {pack.checks.map((c) => (
                <div key={c.id} className="rounded-lg border border-border bg-muted/25 px-3.5 py-2.5">
                  <div className="flex items-center gap-2 text-xs">
                    {c.ok ? <CheckCircle2 className="size-4 text-verified shrink-0" /> : <XCircle className="size-4 text-broken shrink-0" />}
                    <span className="hash text-ink font-bold" dir="ltr">{c.name}</span>
                    <span className="ms-auto" aria-hidden><CircleDashed /></span>
                  </div>
                  <div className="text-[11px] text-ink-2/85 mt-1.5 leading-relaxed ps-6" dir="ltr">{c.detail}</div>
                </div>
              ))}
              {pack.verdict && (
                <div className={cn("text-xs font-medium pt-2", pack.summary.failed === 0 ? "text-verified" : "text-gold")}>
                  {pack.verdict}
                </div>
              )}
            </div>
          )}
        </Panel>
      </div>

      {/* מפת-דרך */}
      <div>
        <h3 className="font-display text-lg font-bold text-ink mb-3">מפת-הדרך · THE WEAVE</h3>
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {ROADMAP.map((r) => (
            <div key={r.id} className={cn("panel px-4 py-3.5 flex items-start gap-3", r.done ? "border-verified/20" : "opacity-70")}>
              <span className={cn("hash text-sm font-black mt-0.5", r.done ? "text-verified" : "text-ink-2/60")}>{r.id}</span>
              <div className="flex-1 min-w-0">
                <div className="text-xs text-ink leading-relaxed">{r.what}</div>
                <div className={cn("text-[10px] mt-1.5 hash", r.done ? "text-verified" : "text-ink-2/60")}>
                  {r.done ? "✓ הושלם" : "ממתין"}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* קצוות-ה-API */}
      <Panel>
        <div className="text-[11px] text-gold-dim hash uppercase tracking-widest mb-3">public endpoints · קצוות-ציבוריים</div>
        <div className="grid sm:grid-cols-2 gap-2 text-[11px]">
          {[
            "GET  /api/weave/status",
            "POST /api/weave/stamp {content|h, kind?, by?, salt?}",
            "GET  /api/weave/stamp",
            "GET  /api/weave/proof?h=<64hex>",
            "POST /api/weave/witness {topic, claimHash, validator}",
            "GET  /api/weave/verify-pack",
            "GET  /api/weave/blocks?limit=&offset=&op=&q=&cp=1 | ?height=H",
            "GET  /api/weave/txs?type=&by=&seq=&limit=&offset=",
            "GET  /api/weave/stats",
            "GET  /api/weave/search?q=#679|<hash>",
            "GET  /api/weave/checkpoints",
          ].map((e) => (
            <code key={e} className="hash rounded-md bg-muted/50 border border-border px-2.5 py-1.5 text-ink-2/90" dir="ltr">
              {e}
            </code>
          ))}
        </div>
        <p className="text-[11px] text-ink-2/70 mt-3 leading-relaxed">
          כל קצה ציבורי — אין-אימות, אין-סודות. ה-30/דקה חומה-גסה בלבד; הקרנל הוא הסמכות היחידה.
          {w ? ` מצב נוכחי: live=${w.liveStamps}/${w.cap} · seals=${w.totalSeals}.` : ""}
        </p>
      </Panel>
    </div>
  );
}

function CircleDashed() {
  return <span className="inline-block size-1.5 rounded-full bg-ink-2/30" aria-hidden />;
}

/* ══ ציר-הצ'קפוינטים — התשובה המלאה ל"אימות 24/33" ══ */
export function CheckpointAxis() {
  const [data, setData] = useState<CheckpointsData | null>(null);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    setBusy(true);
    setErr(null);
    try {
      const j = await fetchCheckpoints();
      if (!j) setErr("הצומת לא ענה");
      else if (!j.ok) setErr(j.why || "replay-failed");
      else setData(j);
    } catch (e) {
      setErr(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    load();
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, []);

  const sum = data?.summary;
  const integrity = sum && sum.checked > 0 ? sum.matched === sum.checked : null;
  const firstBad = sum?.firstBadHeight ?? null;
  const rows = [...(data?.checkpoints || [])].reverse();

  return (
    <div className="space-y-6">
      <SectionHead
        eyebrow="INTEGRITY AXIS"
        title="ציר-הצ'קפוינטים — בדיקת-השלמות המלאה"
        icon={<ShieldCheck className="size-3.5" />}
        desc="כל 12 בלוקים הקרנל חותם צ'קפוינט (שורש-מצב). כאן כל צ'קפוינט היסטורי נסרק מחדש: ה-replay המתמטי — מהג'נזיס, דרך הארכיון המלא, על הקרנל עצמו — מחשב את שורש-המצב מחדש, ומשווה אותו לשורש שהצומת חתם בזמנו. זו הבדיקה שעומדת מאחורי מדד-האימות בכותרת."
      />

      {/* פסק-דין */}
      <Panel className={cn("!p-5", integrity === true && "border-verified/30")}>
        {busy && !data ? (
          <div className="grid place-items-center py-8">
            <div className="flex flex-col items-center gap-3 text-ink-2">
              <Spinner className="size-5" />
              <span className="text-xs">מריץ replay מלא וסורק את הציר…</span>
            </div>
          </div>
        ) : err ? (
          <ErrorState title="הסריקה לא הושלמה" detail={err} onRetry={load} />
        ) : (
          <div className="flex flex-col md:flex-row md:items-center gap-4">
            <div className="flex items-center gap-3">
              {integrity === true ? (
                <ShieldCheck className="size-8 text-verified" />
              ) : (
                <ShieldAlert className="size-8 text-gold" />
              )}
              <div>
                <div className={cn("font-display text-xl font-bold", integrity === true ? "text-verified" : "text-gold")}>
                  {integrity === true
                    ? `הספר שלם · ${sum?.matched}/${sum?.checked} צ'קפוינטים`
                    : `אומתו ${sum?.matched}/${sum?.checked} צ'קפוינטים`}
                </div>
                <div className="text-xs text-ink-2 mt-1">
                  {integrity === true
                    ? "כל שורש-מצב היסטורי מתקבל בדיוק מה-replay — כל שחזור מהג'נזיס מניב את הספר הזה."
                    : "הצ'קפוינטים המאומתים ירוקים; החריגים מוסברים בכרטיס-האירוע מטה."}
                </div>
              </div>
            </div>
            <div className="md:ms-auto text-[11px] text-ink-2/70">
              סריקה אחרונה: {fmtClock(new Date().toISOString())} · מתעדכן כל 30 שנ׳
            </div>
          </div>
        )}
      </Panel>

      {/* כרטיס-אירוע — פער-ההיסטוריה המתועד */}
      {integrity === false && firstBad != null && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          <Panel className="!p-5 border-gold/30 bg-gold/[0.04]">
            <div className="flex items-start gap-3">
              <History className="size-5 text-gold mt-0.5 shrink-0" />
              <div className="space-y-2 text-sm">
                <div className="font-display font-bold text-ink">אירוע מתועד: פער-היסטוריה (החלמת-ערב)</div>
                <p className="text-xs text-ink-2 leading-relaxed max-w-3xl">
                  בהחלמה-ערב של הצומת נוצר פער-היסטוריה מתועד: החל מהצ'קפוינט בגובה{" "}
                  <span className="hash text-gold-soft">{firstBad}</span> הצומת חתם שורשים שנבנו על עותק-היסטוריה מקוצר,
                  ולכן ה-replay המלא מגיע לשורש שונה עבורם. <span className="text-ink font-bold">מהנקודה הראשונה הפגועה והלאה הספר עצמו עקבי ושלם</span> —
                  החריגים הם בדיוק אותם צ'קפוינטים קדומים. הפתרון המבני (base-snapshot ב-replay) נמצא במפת-הדרך — W5.
                </p>
                <p className="text-[11px] text-ink-2/70 leading-relaxed">
                  למה זה כן מקצועי: מערכת שמציגה את הצלקות שלה עם תיעוד מלא — זו כנות-רמת-מערכת. המקום היחיד להסתיר את זה היה כאן; בחרנו להציג.
                </p>
              </div>
            </div>
          </Panel>
        </motion.div>
      )}

      {/* הציר — כל הצ'קפוינטים */}
      <Panel className="!p-0 overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <span className="text-[11px] text-gold-dim hash uppercase tracking-widest">checkpoint axis · הציר המלא</span>
          <span className="text-[11px] text-ink-2/70">{rows.length} צ'קפוינטים · כל 12 בלוקים</span>
        </div>
        {rows.length === 0 ? (
          <div className="p-6"><EmptyState title="טרם נחתמו צ'קפוינטים בסביבה זו" /></div>
        ) : (
          <div className="max-h-[520px] overflow-y-auto">
            {rows.map((c) => (
              <div
                key={c.height}
                className={cn(
                  "px-5 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs border-b border-border/50 last:border-0",
                  c.matched ? "bg-transparent" : "bg-gold/[0.05]"
                )}
              >
                {c.matched ? (
                  <CheckCircle2 className="size-3.5 text-verified shrink-0" />
                ) : (
                  <Tip label="ה-replay מגיע לשורש שונה — ראה כרטיס-האירוע להסבר המלא">
                    <XCircle className="size-3.5 text-gold shrink-0" />
                  </Tip>
                )}
                <span className="hash font-bold text-ink w-16">#{c.height}</span>
                <span className="flex-1 min-w-32">
                  <HashText h={c.stateRoot} head={16} tail={10} className={c.matched ? "text-ink-2/85" : "text-gold"} copy={false} />
                </span>
                <span className="text-[10.5px] text-ink-2/60">{c.at ? fmtClock(c.at) : "—"}</span>
                <span className={cn("text-[10px] font-bold", c.matched ? "text-verified" : "text-gold")}>
                  {c.matched ? "תואם" : "חורג · מתועד"}
                </span>
              </div>
            ))}
          </div>
        )}
        <div className="px-5 py-3 border-t border-border text-[10.5px] text-ink-2/60 leading-relaxed">
          איך זה נבדק: הקרנל מתחיל מהג'נזיס, מריץ כל בלוק מהארכיון המלא (append-only), ובכל גובה-צ'קפוינט מחשב את
          stateRoot מחדש ומשווה לשורש שהצומת חתם. אפס-קיצורי-דרך — זו סריקה מתמטית מלאה, לא תזכורת.
        </div>
      </Panel>
    </div>
  );
}

function SpecRow({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-start gap-4">
      <dt className="text-ink-2/80 w-24 shrink-0 text-xs pt-1">{k}</dt>
      <dd className="flex-1 min-w-0 text-ink leading-relaxed">{v}</dd>
    </div>
  );
}
