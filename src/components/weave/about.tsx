"use client";

/**
 * about — מה זה הנול? המסך שעונה ב-10 שניות.
 * פסקה-אחת בעברית-פשוטה → שלושה-צעדים → מילון-מונחים → "למה להאמין".
 * זר שמגיע לכאן יוצא שמבין מה המערכת עושה, איך היא עושה את זה, ומה זה שווה.
 */

import { Hash, Hourglass, Landmark, Lock, ScrollText, ShieldCheck, Waves } from "lucide-react";
import { Panel, SectionHead, LiveDot } from "./primitives";
import { useWeaveStatus } from "@/hooks/use-weave";

const TERMS: { term: string; def: string }[] = [
  { term: "חותמת-קיום", def: "הוכחה שתוכן מסוים התקיים ברגע מסוים. הדפדפן מזקק sha-256 מהתוכן — טביעת-אצבע מתמטית ייחודית-עולמית — והיא נרשמת על הספר." },
  { term: "גובה", def: "מספר-הבלוקים מאז ראשית-הספר (הג'נזיס). כמו מספר-עמוד — רק שאי-אפשר לקרוע עמודים כאן." },
  { term: "איטום (seal)", def: "כל שעה כל-החותמות החיות מתקפלות לשורש-מרקל אחד — חותם-מתמטי של כולן יחד — והשורש נחרת על הספר הריבוני." },
  { term: "שורש-מרקל", def: "טביעת-אצבע של אוסף-שלם של חותמות. מספיק שורש אחד כדי להוכיח כל חותמת בודדת בתוכו — בלי לחשוף את כולן." },
  { term: "צ'קפוינט", def: "כל 12 בלוקים הקרנל מצטלם: שורש-מצב מלא של הספר נחתם, וסריקת-שלמות מאמתת שכל-ההיסטוריה עוד נכונה מתמטית." },
  { term: "עוגן ציבורי", def: "שורש-האיטום יוצא גם אל רשתות-בלוקים ציבוריות (Steem · Hive · TRON · Blurt) — שם הוא נשמר אצל מאות-צמתים עצמאיים, ואי-אפשר להכחישו." },
  { term: "גז", def: "עלות-מדודה לפעולה — כמו דלק. חותמת 20 גז, עדות 40, איטום 60. מונע זיהום-ספר." },
  { term: "קוורום", def: "מספר-העדים שהעידו על אותה טענה. העדויות נצברות על הספר עצמו — לא באפליקציה שאפשר לערוך." },
];

export function About({
  onStamp,
  onVerify,
  onBook,
}: {
  onStamp?: () => void;
  onVerify?: () => void;
  onBook?: () => void;
}) {
  const { data: status } = useWeaveStatus();
  const chain = status?.chain;

  return (
    <div className="space-y-8">
      <SectionHead
        eyebrow="WHAT IS THE LOOM"
        title="מה זה הנול?"
        icon={<ScrollText className="size-3.5" />}
        desc="הסבר אחד כן, בלי ג'רגון — ואז המילון. אם אחרי-זה עוד לא ברור, המערכת לא עשתה את העבודה שלה."
      />

      {/* הפסקה-האחת */}
      <Panel glow className="!p-6 md:!p-8">
        <p className="font-display text-lg md:text-2xl font-bold text-ink leading-relaxed">
          הנול הוא ספר-קיום ציבורי:{" "}
          <span className="text-gold">חותמים</span> על טקסט, קוד או רעיון — והוא מקבל טביעת-אצבע מתמטית על ספר שאי-אפשר לשקר בו.{" "}
          <span className="text-gold">כל שעה</span> הספר מתאטם לשורש אחד, והשורש{" "}
          <span className="text-gold">מעוגן ברשתות-ציבוריות</span> — כך שאי-אפשר לשנות, להכחיש או להתכחש.
        </p>
        <p className="mt-3 text-sm text-ink-2 leading-relaxed max-w-3xl">
          אין כאן אמונה — יש כאן מתמטיקה. כל הוכחה רצה בדפדפן שלך, וכל עוגן אפשר לפתוח ברשת הציבורית בעצמך.
          מי שלא סומך עלינו — בדיוק בשבילו זה נבנה.
        </p>
      </Panel>

      {/* שלושה-צעדים */}
      <div className="grid sm:grid-cols-3 gap-3">
        {[
          {
            n: "1",
            t: "חותמים",
            d: "sha-256 מתקבל בדפדפן שלך — התוכן לא חייב לעלות לשרת בכלל. 20 גז לחותמת.",
            icon: <Hash className="size-4" />,
          },
          {
            n: "2",
            t: "כל שעה — איטום",
            d: "כל-החותמות מתקפלות לשורש-מרקל אחד, חתום על הספר הריבוני עם stateRoot של צ'קפוינט.",
            icon: <Hourglass className="size-4" />,
          },
          {
            n: "3",
            t: "עיגון ציבורי",
            d: "השורש נחרת על Steem · Hive · TRON · Blurt — ואפשר לאמת אותו מ-RPC ציבורי, בלי לסמוך עלינו.",
            icon: <Landmark className="size-4" />,
          },
        ].map((s) => (
          <Panel key={s.n} className="!p-5">
            <div className="flex items-center gap-2.5 mb-2">
              <span className="grid place-items-center size-8 rounded-lg border border-gold/30 bg-gold/10 text-gold font-black hash text-sm">{s.n}</span>
              <span className="font-display font-bold text-ink flex items-center gap-1.5">{s.t} <span className="text-gold">{s.icon}</span></span>
            </div>
            <p className="text-xs text-ink-2 leading-relaxed">{s.d}</p>
          </Panel>
        ))}
      </div>

      {/* למה להאמין */}
      <Panel>
        <div className="flex items-center gap-2 mb-3 text-gold">
          <ShieldCheck className="size-4" />
          <span className="font-display font-bold">למה להאמין לזה?</span>
        </div>
        <ul className="grid md:grid-cols-2 gap-x-8 gap-y-2.5 text-sm text-ink-2 leading-relaxed">
          <li className="flex items-start gap-2"><Lock className="size-3.5 text-gold-dim mt-1 shrink-0" /> האימות רץ בדפדפן שלך — צעד-אחר-צעד, בלי שרת, בלי סודות.</li>
          <li className="flex items-start gap-2"><Landmark className="size-3.5 text-gold-dim mt-1 shrink-0" /> העוגנים ציבוריים — כל txid נפתח ברשת שרצה מ-2016 עם מאות-צמתים.</li>
          <li className="flex items-start gap-2"><Waves className="size-3.5 text-gold-dim mt-1 shrink-0" /> הספר שלם מתמטית: שחזור מהג'נזיס מניב בדיוק את אותו ספר — וזה נבדק כל-הזמן.</li>
          <li className="flex items-start gap-2"><LiveDot tone={status?.ok ? "green" : "rose"} className="mt-1.5" /> עכשיו על הספר: גובה <span className="hash text-gold-soft">{chain?.height ?? "—"}</span> · אימות {chain?.integrity === true ? "מלא" : chain?.integrity === false ? "חלקי (מתועד)" : "מתבצע"}.</li>
        </ul>
      </Panel>

      {/* מילון-מונחים */}
      <div>
        <h3 className="font-display text-lg font-bold text-ink mb-3">מילון-מונחים — הכל בעברית, בלי קסמים</h3>
        <div className="grid md:grid-cols-2 gap-3">
          {TERMS.map((t) => (
            <div key={t.term} className="panel px-4 py-3.5">
              <div className="text-sm font-bold text-gold-soft mb-1">{t.term}</div>
              <div className="text-xs text-ink-2 leading-relaxed">{t.def}</div>
            </div>
          ))}
        </div>
      </div>

      {/* קריאה-לפעולה */}
      <Panel className="panel-glow !p-6">
        <div className="flex flex-col md:flex-row md:items-center gap-4">
          <div className="flex-1">
            <div className="font-display text-lg font-bold text-ink">הדרך הקלה להבין — פשוט לנסות</div>
            <div className="text-xs text-ink-2 mt-1.5">חתום על משהו, קבל תעודה, ואמת אותה בעצמך. חמש-דקות, ואתה כבר מבין למה זה שווה.</div>
          </div>
          <div className="flex flex-wrap gap-2 shrink-0">
            {onStamp && (
              <button type="button" onClick={onStamp} className="rounded-xl bg-gradient-to-b from-gold to-[#c98a2e] px-5 py-2.5 text-sm font-bold text-[#1a1206] shadow-[0_8px_24px_-10px_rgba(233,169,62,0.5)] hover:-translate-y-0.5 transition-all">
                חתום על משהו
              </button>
            )}
            {onBook && (
              <button type="button" onClick={onBook} className="rounded-xl border border-gold/30 bg-gold/10 px-5 py-2.5 text-sm font-bold text-gold hover:bg-gold/15 transition-all">
                דפדף בספר
              </button>
            )}
            {onVerify && (
              <button type="button" onClick={onVerify} className="rounded-xl border border-border px-5 py-2.5 text-sm font-bold text-ink-2 hover:text-ink transition-colors">
                אמת תעודה
              </button>
            )}
          </div>
        </div>
      </Panel>
    </div>
  );
}
