"use client";

/**
 * chrome — שלד הנול: ראש חי, ניווט (שולחן+נייד), רגל-דבקה.
 *
 * ארבעה מקטעים: סטודיו · תעודות · עדים · מערכת — וכל-העומק יורד לתוכם
 * כתתי-לשוניות. הכותרת היא פס-חיים מקצועי: כל-מספר לחיץ, מוסבר, ומקושר
 * למקום שמרחיב אותו. שגיאה לא מתחפשת לריק, ו-tooltip נגיש במקום title.
 */

import { cn } from "@/lib/utils";
import { HashText, LiveDot, Tip } from "./primitives";
import { timeAgoHe, type WeaveStatus } from "@/hooks/use-weave";
import { Anchor, BookOpen, Cpu, Eye, FlaskConical, Fingerprint, HelpCircle, Landmark, ScrollText, Waves, type LucideIcon } from "lucide-react";

export type SectionId = "studio" | "certs" | "witnesses" | "system" | "sovereign";

export const SECTIONS: { id: SectionId; label: string; icon: LucideIcon; hint: string }[] = [
  { id: "studio", label: "סטודיו", icon: Waves, hint: "חתום על משהו — וזה יישאר לנצח" },
  { id: "certs", label: "תעודות", icon: ScrollText, hint: "בדוק ואמת בעצמך — בלי לסמוך עלינו" },
  { id: "witnesses", label: "עדים", icon: Eye, hint: "הראיות הציבוריות: עוגנים · עדים · הספר" },
  { id: "system", label: "מערכת", icon: Cpu, hint: "הקרנל, ציר-האימות והמפרט — הכל פתוח" },
  { id: "sovereign", label: "ריבונות", icon: Landmark, hint: "SAOS-NET: מטבעות-עטופים · זירת-הגריד · עוגנים-תלת-שרשרתיים" },
];

export type SubDef = { id: string; label: string; icon?: LucideIcon };

export const SUBS: Record<SectionId, SubDef[]> = {
  studio: [
    { id: "loom", label: "האריגה החיה", icon: Waves },
    { id: "wins", label: "קיר-ההישגים", icon: BookOpen },
    { id: "stamp", label: "חותמות-קיום", icon: Fingerprint },
    { id: "secret", label: "חותמת-סוד", icon: Cpu },
    { id: "about", label: "מה זה הנול?", icon: HelpCircle },
  ],
  certs: [
    { id: "lookup", label: "תעודות-אריגה", icon: ScrollText },
    { id: "lab", label: "אימות-חי בדפדפן", icon: Cpu },
    { id: "forge", label: "אתגר-המזייף", icon: Cpu },
    { id: "seals", label: "ציר-האיטומים", icon: Waves },
  ],
  witnesses: [
    { id: "anchors", label: "עוגנים-ציבוריים", icon: Anchor },
    { id: "quorum", label: "עדי-קיום", icon: Eye },
    { id: "book", label: "פנקס-הספר", icon: BookOpen },
  ],
  system: [
    { id: "engine", label: "לב-המערכת", icon: Cpu },
    { id: "checkpoints", label: "ציר-הצ'קפוינטים", icon: BookOpen },
  ],
  sovereign: [
    { id: "chain", label: "השרשרת-הריבונית", icon: Landmark },
  ],
};

/* ── תתי-לשוניות — פס-משנה בראש כל מקטע ── */
export function SubTabs({
  section,
  active,
  onSub,
}: {
  section: SectionId;
  active: string;
  onSub: (id: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 mb-6">
      {SUBS[section].map((s) => {
        const on = active === s.id;
        const Icon = s.icon;
        return (
          <button
            key={s.id}
            type="button"
            aria-current={on ? "true" : undefined}
            onClick={() => onSub(s.id)}
            className={cn(
              "inline-flex items-center gap-2 rounded-full border px-4 py-2 text-xs font-bold transition-all focus-visible:outline-2 focus-visible:outline-gold",
              on
                ? "border-gold/50 bg-gold/12 text-gold shadow-[0_0_18px_-6px_rgba(233,169,62,0.45)]"
                : "border-border bg-muted/30 text-ink-2 hover:text-ink hover:border-gold/25"
            )}
          >
            {Icon && <Icon className="size-3.5" />}
            {s.label}
          </button>
        );
      })}
    </div>
  );
}

/* ── סמל-הנול: שלושה חוטים נטווים סביב עין ── */
export function WeaveMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <g fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
        <path d="M14 44 C 22 44, 26 20, 32 20 S 42 44, 50 44" />
        <path d="M14 32 C 24 32, 40 32, 50 32" opacity="0.55" />
        <path d="M14 20 C 22 20, 26 44, 32 44 S 42 20, 50 20" opacity="0.8" />
      </g>
      <circle cx="32" cy="32" r="5.5" fill="none" stroke="currentColor" strokeWidth="2" />
      <circle cx="32" cy="32" r="1.8" fill="currentColor" />
    </svg>
  );
}

/* ── טבעת-צ'קפוינט (x/12) ── */
export function CheckpointRing({ progress, size = 30 }: { progress: number; size?: number }) {
  const r = (size - 5) / 2;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(1, progress));
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0" aria-hidden>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#2a2314" strokeWidth="3" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="#e9a93e"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - p)}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: "stroke-dashoffset 0.6s ease" }}
      />
    </svg>
  );
}

/* ── פסק-דין-אימות: מילה שמסבירה את עצמה + קישור לראיה ── */
export function IntegrityChip({
  status,
  onOpen,
  compact,
}: {
  status: WeaveStatus | null;
  onOpen?: () => void;
  compact?: boolean;
}) {
  const chain = status?.chain;
  const integrity = chain?.integrity;
  const cps = chain?.checkpoints;
  const anchor = chain?.anchor ?? null;
  const cpsAbove = anchor?.cpsAbove;
  const tone = integrity === true ? "green" : integrity === false ? "gold" : "gray";
  /* 109 — הבאג' הגדול בראש-העמוד: אנגלית-טכנית-גולמית ("quorum-pending(0/3 attests)")
   * במקום עברית-קצרה. עכשיו: תווית-אנושית-קצרה; ההסבר-המלא (מה-זה · האם-סגור · מה-הטיפול)
   * חי ברמז-הכלים — לא-על-המסך. */
  const whyShort = (anchor?.why as string | undefined) ?? "";
  const gapWord = whyShort.startsWith("quorum-pending")
    ? `חתימות ${cpsAbove?.matched ?? 0}/${cpsAbove?.checked ?? 3} בדרך`
    : whyShort === "no-checkpoint-record"
      ? "אין-רישום-צ׳קפוינט"
      : whyShort === "anchor-hash-mismatch"
        ? "אי-התאמת-גיבוב"
        : whyShort === "snapshot-unreadable"
          ? "תמונת-מצב-לא-קריאה"
          : whyShort || "לא-ידוע";
  const word =
    integrity === true
      ? anchor?.hashMatched
        ? `הספר שלם · עוגן h${anchor.height}`
        : "הספר שלם"
      : integrity === false
        ? anchor?.hashMatched
          ? `עוגן h${anchor.height} · ${gapWord}`
          : `אומתו ${cps?.matched ?? "—"}/${cps?.checked ?? "—"}`
        : "בבדיקה…";
  const tip =
    integrity === true
      ? `בדיקת-שלמות (106): תמונת-המצב-החי חסומה-מול-בלוק-הארכיון בגובה h${anchor?.height ?? "—"} (hash match)${anchor?.rootLocked ? " · קו-ההתחלה-השורשי (106) חסום-לארכיון" : ""} · ${cpsAbove && cpsAbove.checked > 0 ? `${cpsAbove.matched}/${cpsAbove.checked} חתימות-חיילים על הצ'קפוינט-האחרון אומתו-מול-המארח (anchored-quorum — דוקטרינת-המפרט)` : "אין-עדי-חתימה-עדיין"}. השורש-המלא-מעל-העוגן אינו-ניתן-לשחזור-ביטי-מקומית (רשומות-cp בתוך-המצב-עם-עגנים-חוץ-בלוקיים) — ולכן-העדות-היא-ה-quorum. עדות-הארכיון-ההיסטורית-חסרה-בלוקים-עתיקים (703-709 — archive_gaps.json).`
      : integrity === false
        ? `מה-זה: סריקת-השלמות של הספר — ${anchor?.hashMatched ? `העוגן-עצמו תקין (hash-match בגובה h${anchor.height})` : `שרשרת-העוגן לא שלמה (${anchor?.why ?? "סיבה-לא-ידועה"})`}. מה-לא-סגור: חתימות-החיילים על הצ'קפוינט-האחרון (${cpsAbove?.matched ?? 0}/${cpsAbove?.checked ?? 3}) — יובש-ה-RC חוסם-חתימות, ההבראה-במסלול (regen טבעי). הסריקה-ההיסטורית מהג'נזיס (${cps?.matched ?? "—"}/${cps?.checked ?? "—"}) נפגעת-מפערים-עתיקים-מתועדים-ולא-צומחים (703-709 · archive_gaps.json). לחיצה: הציר-המלא.`
        : "הסריקה רצה עכשיו — עוד רגע יש פסק-דין.";

  return (
    <Tip label={tip} side="bottom">
      <button
        type="button"
        onClick={onOpen}
        aria-label={`בדיקת-שלמות הספר: ${word} צ'קפוינטים — לחיצה לציר-הצ'קפוינטים`}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-bold transition-colors focus-visible:outline-2 focus-visible:outline-gold",
          tone === "green"
            ? "border-verified/30 bg-verified/5 text-verified hover:bg-verified/10"
            : tone === "gold"
              ? "border-gold/40 bg-gold/5 text-gold hover:bg-gold/10"
              : "border-border bg-muted/40 text-ink-2"
        )}
      >
        <LiveDot tone={tone === "gray" ? "gray" : tone} className="text-current" />
        {compact && tone === "green" ? <span aria-hidden>✓</span> : word}
      </button>
    </Tip>
  );
}

/* ── ראש ── */
export function WeaveHeader({
  status,
  onNavigate,
}: {
  status: WeaveStatus | null;
  onNavigate?: (s: SectionId, sub?: string) => void;
}) {
  const chain = status?.chain;
  const cpStep = chain ? chain.height % 12 || 12 : 0;
  const cpLeft = 12 - cpStep;
  const cpProgress = chain ? cpStep / 12 : 0;
  const openBook = () => onNavigate?.("witnesses", "book");

  return (
    <header className="sticky top-0 z-40 border-b border-border/80 bg-background/80 backdrop-blur-xl">
      <div className="mx-auto max-w-7xl px-4 md:px-6 h-16 flex items-center gap-3 md:gap-4">
        <button
          type="button"
          onClick={() => onNavigate?.("studio")}
          className="flex items-center gap-3 group min-w-0 focus-visible:outline-2 focus-visible:outline-gold rounded-lg"
          aria-label="הנול — מעבר לסטודיו"
        >
          <span className="grid place-items-center size-10 rounded-xl bg-gold/10 border border-gold/25 text-gold group-hover:bg-gold/15 transition-colors">
            <WeaveMark className="size-6" />
          </span>
          <span className="leading-tight text-right min-w-0">
            <span className="block font-display text-lg font-bold text-ink">הנול</span>
            <span className="block text-[10px] text-gold-dim hash uppercase tracking-widest">THE WEAVE · SAOS-NET</span>
          </span>
        </button>

        <div className="flex-1" />

        {/* פס-חיים — הכל לחיץ ומוסבר */}
        <div className="hidden md:flex items-center gap-3 text-sm">
          <Tip
            label={
              <>
                גובה-השרשרת — {chain?.height ?? "—"} בלוקים מהג'נזיס.
                {chain?.lastBlockTime ? <> הבלוק האחרון: {timeAgoHe(chain.lastBlockTime)}.</> : null}
                <> לחיצה: מעבר לבלוק הזה בפנקס-הספר.</>
              </>
            }
          >
            <button
              type="button"
              onClick={openBook}
              className="flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-muted/60 transition-colors focus-visible:outline-2 focus-visible:outline-gold"
              aria-label={`גובה-השרשרת ${chain?.height ?? "—"} — מעבר לפנקס-הספר`}
            >
              <LiveDot tone={status?.ok ? "green" : "rose"} />
              <span className="text-ink-2 text-xs">גובה</span>
              <span className="metric-value hash text-gold-soft font-bold">{chain?.height ?? "—"}</span>
              {chain?.lastBlockTime && (
                <span className="text-[10px] text-ink-2/70">{timeAgoHe(chain.lastBlockTime)}</span>
              )}
            </button>
          </Tip>

          <div className="h-5 w-px bg-border" aria-hidden />

          <Tip
            label={`צ'קפוינט הקרנל — כל 12 בלוקים הקרנל חותם שורש-מצב חדש וסורק את שלמות-ההיסטוריה. עוד ${cpLeft} בלוקים. לחיצה: ציר-הצ'קפוינטים.`}
          >
            <button
              type="button"
              onClick={() => onNavigate?.("system", "checkpoints")}
              className="flex items-center gap-1.5 rounded-lg px-1.5 py-1 hover:bg-muted/60 transition-colors focus-visible:outline-2 focus-visible:outline-gold"
              aria-label={`צ'קפוינט: עוד ${cpLeft} בלוקים מתוך 12 — מעבר לציר-הצ'קפוינטים`}
            >
              <CheckpointRing progress={cpProgress} />
              <span className="text-[11px] text-ink-2">
                עוד <span className="hash text-gold-soft font-bold">{cpLeft}</span>
              </span>
            </button>
          </Tip>

          <div className="h-5 w-px bg-border" aria-hidden />

          <IntegrityChip status={status} onOpen={() => onNavigate?.("system", "checkpoints")} />
        </div>

        {/* פעולות-ראש */}
        <div className="hidden sm:flex items-center gap-2">
          <button
            type="button"
            onClick={openBook}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gold/25 bg-gold/8 px-3 py-1.5 text-xs font-bold text-gold hover:bg-gold/15 transition-colors focus-visible:outline-2 focus-visible:outline-gold"
          >
            <BookOpen className="size-3.5" />
            פנקס
          </button>
          <button
            type="button"
            onClick={() => onNavigate?.("studio", "about")}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-bold text-ink-2 hover:text-ink hover:border-gold/25 transition-colors focus-visible:outline-2 focus-visible:outline-gold"
            aria-label="מה זה הנול? — הסבר קצר"
          >
            <HelpCircle className="size-3.5" />
            מה זה?
          </button>
        </div>

        {/* נייד: גובה מתויג + פסק-דין */}
        <div className="md:hidden flex items-center gap-2">
          <button
            type="button"
            onClick={openBook}
            className="flex flex-col items-center leading-none gap-1"
            aria-label={`גובה ${chain?.height ?? "—"} — מעבר לפנקס`}
          >
            <span className="flex items-center gap-1.5">
              <LiveDot tone={status?.ok ? "green" : "rose"} />
              <span className="metric-value hash text-gold-soft font-bold">{chain?.height ?? "—"}</span>
            </span>
            <span className="text-[9px] text-ink-2">גובה</span>
          </button>
          <IntegrityChip status={status} onOpen={() => onNavigate?.("system", "checkpoints")} compact />
        </div>
      </div>
    </header>
  );
}

/* ── סרגל-צד (שולחן — RTL: צד-ימין) ── */
export function NavRail({
  active,
  sub,
  onNavigate,
  onSub,
  status,
}: {
  active: SectionId;
  sub: string;
  onNavigate: (s: SectionId, sub?: string) => void;
  onSub: (s: string) => void;
  status: WeaveStatus | null;
}) {
  const w = status?.weave;
  const badges: Partial<Record<SectionId, string>> = {
    studio: w ? String(w.liveStamps) : undefined,
    certs: w?.lastSeal ? "#" + w.lastSeal.seq : undefined,
    witnesses: status?.chain ? String(status.chain.height) : undefined,
    system: undefined,
  };
  const subs = SUBS[active];

  return (
    <nav aria-label="מקטעי-הנול" className="hidden lg:block">
      <div className="sticky top-24 flex flex-col gap-1.5">
        {SECTIONS.map((s) => {
          const Icon = s.icon;
          const on = active === s.id;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => onNavigate(s.id)}
              aria-current={on ? "page" : undefined}
              className={cn(
                "group flex items-center gap-3 rounded-xl px-3.5 py-3 text-right border transition-all focus-visible:outline-2 focus-visible:outline-gold",
                on
                  ? "bg-gold/10 border-gold/30 text-gold-soft shadow-[0_0_24px_-8px_rgba(233,169,62,0.35)]"
                  : "bg-transparent border-transparent text-ink-2 hover:text-ink hover:bg-muted/60"
              )}
            >
              <span
                className={cn(
                  "grid place-items-center size-9 rounded-lg border transition-colors",
                  on ? "border-gold/40 bg-gold/10 text-gold" : "border-border bg-muted/40"
                )}
              >
                <Icon className="size-4.5" />
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-bold">{s.label}</span>
                <span className="block text-[10.5px] text-ink-2/80 truncate">{s.hint}</span>
              </span>
              {badges[s.id] && (
                <span className="hash text-[10px] px-1.5 py-0.5 rounded-md bg-muted border border-border text-gold-dim">
                  {badges[s.id]}
                </span>
              )}
            </button>
          );
        })}

        {/* תתי-המקטע — העומק שבתוך המקטע הפעיל (ניווט רגיל, לא tablist) */}
        <div className="mt-2 ms-3 border-s border-border/70 ps-3 flex flex-col gap-0.5" aria-label="תתי-מקטעים">
          {subs.map((s) => {
            const on = sub === s.id;
            return (
              <button
                key={s.id}
                type="button"
                aria-current={on ? "true" : undefined}
                onClick={() => onSub(s.id)}
                className={cn(
                  "text-right rounded-lg px-2.5 py-1.5 text-xs transition-all focus-visible:outline-2 focus-visible:outline-gold",
                  on ? "text-gold font-bold bg-gold/8" : "text-ink-2 hover:text-ink hover:bg-muted/50"
                )}
              >
                {s.label}
              </button>
            );
          })}
        </div>

        {/* כניסת-מעבדה — סביבת-עבודה חיה בנתיב נפרד (מבודדת מהאתר) */}
        <a
          href="/lab"
          className="group mt-2 flex items-center gap-3 rounded-xl border border-dashed border-gold/30 px-3.5 py-2.5 transition-colors hover:border-gold/60 hover:bg-gold/[0.06] focus-visible:outline-2 focus-visible:outline-gold"
        >
          <span className="grid place-items-center size-9 rounded-lg border border-gold/30 bg-gold/10 text-gold">
            <FlaskConical className="size-4.5" aria-hidden />
          </span>
          <span className="flex-1 min-w-0">
            <span className="block text-sm font-bold text-gold-soft">מעבדת-הנול</span>
            <span className="block text-[10.5px] text-ink-2/80 truncate">פרוטוקול-האפס על טרון · רישומים חיים</span>
          </span>
          <span aria-hidden className="text-gold-dim text-xs">↗</span>
        </a>

        <div className="mt-4 panel px-3.5 py-3 text-xs space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-ink-2">איטום אחרון</span>
            <span className="hash text-gold-soft">{w?.lastSeal ? "#" + w.lastSeal.seq : "—"}</span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-ink-2">באצ'ר</span>
            <span className="text-ink-2/80">{timeAgoHe(status?.batcher?.at)}</span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-ink-2">שורש</span>
            <HashText h={status?.chain?.finalRoot} head={6} tail={4} copy={false} className="text-[10px] text-gold-dim" />
          </div>
        </div>
      </div>
    </nav>
  );
}

/* ── ניווט-תחתון (נייד) ── */
export function MobileNav({ active, onNavigate }: { active: SectionId; onNavigate: (s: SectionId) => void }) {
  return (
    <nav
      aria-label="ניווט-נייד"
      className="lg:hidden fixed bottom-0 inset-x-0 z-40 border-t border-border bg-background/92 backdrop-blur-xl"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="grid grid-cols-4">
        {SECTIONS.map((s) => {
          const Icon = s.icon;
          const on = active === s.id;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => onNavigate(s.id)}
              aria-current={on ? "page" : undefined}
              className={cn(
                "flex flex-col items-center gap-1 py-2.5 text-[10px] font-medium transition-colors min-h-[56px] justify-center focus-visible:outline-2 focus-visible:outline-gold",
                on ? "text-gold" : "text-ink-2"
              )}
            >
              <Icon className={cn("size-5", on && "drop-shadow-[0_0_8px_rgba(233,169,62,0.6)]")} />
              {s.label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

/* ── רגל-דבקה ── */
export function WeaveFooter({
  status,
  onNavigate,
}: {
  status: WeaveStatus | null;
  onNavigate?: (s: SectionId, sub?: string) => void;
}) {
  const w = status?.weave;
  return (
    <footer className="mt-auto border-t border-border/70 bg-sidebar/60">
      <div className="mx-auto max-w-7xl px-4 md:px-6 py-5 pb-24 lg:pb-5">
        <div className="flex flex-col md:flex-row md:items-center gap-3 md:gap-6 text-xs text-ink-2">
          <div className="flex items-center gap-2 text-gold-dim">
            <WeaveMark className="size-5" />
            <span className="font-display font-bold text-ink">הנול</span>
            <span className="hash">v3.0</span>
          </div>
          <span className="hidden md:block h-4 w-px bg-border" aria-hidden />
          <span className="font-medium text-ink/80">אמת ציבורית בלי-אמון — חותמת · איטום · עיגון · הוכחה בדפדפן שלך</span>
          <span className="hidden md:block h-4 w-px bg-border" aria-hidden />
          <nav aria-label="קישורי-רגל" className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <button type="button" onClick={() => onNavigate?.("witnesses", "book")} className="underline-offset-2 hover:underline hover:text-gold transition-colors">
              פנקס-הספר
            </button>
            <button type="button" onClick={() => onNavigate?.("system", "checkpoints")} className="underline-offset-2 hover:underline hover:text-gold transition-colors">
              ציר-הצ'קפוינטים
            </button>
            <button type="button" onClick={() => onNavigate?.("studio", "about")} className="underline-offset-2 hover:underline hover:text-gold transition-colors">
              מה זה הנול?
            </button>
            <a href="/lab" className="underline-offset-2 hover:underline hover:text-gold transition-colors">
              מעבדה <span aria-hidden>↗</span>
            </a>
          </nav>
          <span className="md:ms-auto flex items-center gap-1.5">
            <LiveDot tone={status?.ok ? "green" : "rose"} />
            <span>קרנל SAOS-NET v1.3 · צ'קפוינט כל 12 בלוקים</span>
          </span>
        </div>
        {w?.lastSeal && (
          <div className="mt-2 text-[11px] text-ink-2/60">
            איטום אחרון: <HashText h={w.lastSeal.root} head={8} tail={6} className="text-gold-dim" />
          </div>
        )}
      </div>
    </footer>
  );
}
