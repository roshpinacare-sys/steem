"use client";

// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · Site Nav - הניווט הראשי של האתר.
//
// ארכיטקטורת מידע חדשה (אחרי ביקורת המפעיל): 6 סקציות ברורות
// במקום 7 עמודים שטוחים + 8 טאבים מוסתרים. כל סקציה עשירה מקבלת
// תתי-תפריט משלה - החומר מאורגן לפי כמותו, לא נדחס לשורה אחת.
//
//   בית · הרשת · סוכנים · בורסה · ידע · אדמין
//
// ניתוב hash עמוק (#/network/ledger) - קישורים ניתנים לשיתוף.
// מתג מקור-אמת ליד הלוגו: הספר החי מהענן (ברירת מחדל) או עותק
// הסנדבוקס. ה-HEAD החי תמיד גלוי - השרשרת נוכחת בשורת הכתובת.
// מובייל: תפריט-גשר מקונן (Sheet) במקום שורה דחוסה.
// ─────────────────────────────────────────────────────────────────────

import { useEffect, useState } from "react";
import {
  BarChart3,
  BookOpen,
  ChevronDown,
  Cloud,
  Compass,
  Crosshair,
  DoorOpen,
  Gamepad2,
  HardDrive,
  Home,
  Landmark,
  LayoutDashboard,
  LayoutGrid,
  Megaphone,
  Menu,
  Network,
  Repeat,
  Scale,
  ShieldCheck,
  Store,
  Users,
  Waypoints,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { useWeave, type DataMode } from "./store";
import { HashChip } from "./shared";
import { ThemeToggle } from "./theme-toggle";
import { OperatorPill } from "./operator";

// ── הסקציות ─────────────────────────────────────────────────────────

export type SiteView =
  | "gate"
  | "array"
  | "hunter"
  | "flywheel"
  | "money-market"
  | "business"
  | "holdings"
  | "publish"
  | "defi"
  | "browser"
  | "domains"
  | "games"
  | "home"
  | "network"
  | "agents"
  | "exchange"
  | "knowledge"
  | "admin";

export interface SubSection {
  key: string;
  label: string;
}

export const SECTIONS: Array<{
  view: SiteView;
  label: string;
  icon: typeof Home;
  subs: SubSection[];
}> = [
  { view: "gate", label: "שער המפעיל", icon: DoorOpen, subs: [] },
  { view: "array", label: "מצב המערך", icon: LayoutGrid, subs: [] },
  { view: "hunter", label: "ציד הזדמנויות", icon: Crosshair, subs: [] },
  { view: "flywheel", label: "דבר גורר דבר", icon: Repeat, subs: [] },
  {
    view: "money-market",
    label: "שוק-הכספים",
    icon: Landmark,
    subs: [
      { key: "mover", label: "מוביל הכסף" },
      { key: "cross", label: "בין-רשתות · גריד" },
      { key: "flows", label: "זרימות וחסימות" },
      { key: "arena", label: "זירת-המסחר הריבונית" },
      { key: "markets", label: "שווקי ההלוואות" },
    ],
  },
  // R148 · החזית החיה של חממת-העסקים (D-r147-BIZ) — רישום, מספרים מדודים ושורות-הרג
  {
    view: "business",
    label: "עסקים",
    icon: Store,
    subs: [{ key: "desk", label: "דלפק" }],
  },
  {
    view: "holdings",
    label: "מאזן ריבוני",
    icon: Scale,
    subs: [
      { key: "assets", label: "נכסים ביד" },
      { key: "value", label: "תזרימי-ערך" },
      { key: "gaps", label: "פערים למקסום" },
      { key: "networks", label: "רשתות חברתיות" },
      { key: "systems", label: "מערכים חסרים" },
    ],
  },
  {
    view: "publish",
    label: "קול הרשת",
    icon: Megaphone,
    subs: [
      { key: "pulse", label: "הדופק" },
      { key: "channels", label: "הערוצים" },
      { key: "foundry", label: "מפעל התוכן" },
      { key: "queue", label: "תור הפרסום" },
      { key: "earnings", label: "הרווחים" },
      { key: "autonomy", label: "אוטונומיה" },
    ],
  },
  {
    view: "defi",
    label: "נתיבי DeFi",
    icon: Waypoints,
    subs: [
      { key: "router", label: "מנוע הניתוב" },
      { key: "tools", label: "מפת הכלים" },
      { key: "agents", label: "סוכני-המשתמשים" },
      { key: "bridges", label: "גשרים לרשתות" },
    ],
  },
  { view: "browser", label: "דפדפן סוכנים", icon: Compass, subs: [] },
  { view: "domains", label: "דומיינים", icon: Network, subs: [] },
  // R120 · מרכז המשחקים הוחזר לניווט — היה מנותק מאז שחזור הסיידבאר (R55 בנה, ריפלקטים מאוחרים שכחו)
  { view: "games", label: "מרכז המשחקים", icon: Gamepad2, subs: [] },
  { view: "home", label: "בית", icon: Home, subs: [] },
  {
    view: "network",
    label: "הרשת",
    icon: LayoutDashboard,
    subs: [
      { key: "dashboard", label: "לוח בקרה" },
      { key: "webnet", label: "רשת-האחסון" },
      { key: "ledger", label: "ספר אימותים" },
      { key: "proofs", label: "ספר הוכחות" },
      { key: "anchor", label: "עוגן EVM" },
      { key: "ecosystem", label: "אקוסיסטם" },
      { key: "plan", label: "תוכנית ושערים" },
    ],
  },
  {
    view: "agents",
    label: "סוכנים",
    icon: Users,
    subs: [
      { key: "fleet", label: "הצי החי" },
      { key: "student", label: "התלמיד · התפתחות" },
      { key: "keeper", label: "השומר · הדיבונים" },
      { key: "charter", label: "מספנת הצ׳רטרים" },
      { key: "ledger", label: "זהויות בספר" },
    ],
  },
  {
    view: "exchange",
    label: "בורסה",
    icon: BarChart3,
    subs: [
      { key: "dex", label: "טרמינל הדקס" },
      { key: "market", label: "שוק האמת" },
      { key: "holdings", label: "החזקות" },
    ],
  },
  {
    view: "knowledge",
    label: "ידע",
    icon: BookOpen,
    subs: [
      { key: "brain", label: "המוח הריבוני" },
      { key: "sovereignty", label: "רשת ריבונית" },
      { key: "evolution", label: "אבולוציה" },
      { key: "doctrine", label: "דוקטרינה" },
    ],
  },
  {
    view: "admin",
    label: "אדמין",
    icon: ShieldCheck,
    subs: [
      { key: "command", label: "מרכז פיקוד" },
      { key: "missions", label: "משימות וכסף" },
      { key: "server", label: "שרת וסנכרון" },
    ],
  },
];

export function sectionOf(view: SiteView) {
  return SECTIONS.find((s) => s.view === view);
}

// ── מתג מקור האמת: ענן חי <-> סנדבוקס ──────────────────────────────

function ModeToggle() {
  const { mode, setMode } = useWeave();
  const items: Array<{ m: DataMode; label: string; icon: typeof Cloud }> = [
    { m: "cloud", label: "ענן חי", icon: Cloud },
    { m: "local", label: "סנדבוקס", icon: HardDrive },
  ];
  return (
    <div
      className="flex items-center gap-0.5 rounded-full border bg-muted/40 p-0.5"
      role="group"
      aria-label="מקור הנתונים"
    >
      {items.map((it) => {
        const active = mode === it.m;
        return (
          <button
            key={it.m}
            type="button"
            onClick={() => setMode(it.m)}
            aria-pressed={active}
            title={
              it.m === "cloud"
                ? "הספר החי מהענן - האמת שפועמת 24/7 בלי תלות בסנדבוקס"
                : "עותק הסנדבוקס המקומי - מרחב טסט עם פעולות כתיבה"
            }
            className={cn(
              "flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors",
              active
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <it.icon
              className={cn(
                "size-3.5",
                it.m === "cloud" && active && "text-emerald-600 dark:text-emerald-400"
              )}
              aria-hidden="true"
            />
            <span className="hidden sm:inline">{it.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// ── הניווט ──────────────────────────────────────────────────────────

export function SiteNav({
  view,
  section,
  onNavigate,
}: {
  view: SiteView;
  section: string;
  onNavigate: (v: SiteView, section?: string) => void;
}) {
  const { state, live } = useWeave();
  const headHash = state.data?.headHash ?? null;
  const pulse = live.data;
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const go = (v: SiteView, sec?: string) => {
    onNavigate(v, sec);
    setMenuOpen(false);
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  };

  const currentSection = sectionOf(view);

  return (
    <header
      className={cn(
        "sticky top-0 z-50 border-b bg-background/85 backdrop-blur-md transition-shadow duration-300",
        scrolled && "shadow-[0_1px_0_0_rgba(0,0,0,0.04)] dark:shadow-none"
      )}
    >
      <div className="mx-auto flex w-full max-w-7xl items-center gap-3 px-4 py-3 sm:px-6">
        {/* לוגו - כפתור הבית */}
        <button
          type="button"
          onClick={() => go("home")}
          className="group flex min-w-0 items-center gap-3 text-start"
          aria-label="THE WEAVE - עמוד הבית"
        >
          <span
            className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-600 transition-transform duration-300 group-hover:scale-105 dark:text-emerald-400"
            aria-hidden="true"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-5">
              <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8" strokeLinecap="round" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </span>
          {/* מובייל: לוגו-צלמית בלבד (המיתוג המלא בראש המגירה); מסך-מלא: שם+תת-כותרת */}
          <span className="hidden min-w-0 sm:block">
            <span className="block truncate text-sm font-bold tracking-tight sm:text-base">
              SAOS · THE WEAVE
            </span>
            <span className="hidden truncate text-[11px] text-muted-foreground sm:block sm:text-xs">
              רשת האימות הריבונית לסוכני AI
            </span>
          </span>
        </button>

        {/* ניווט דסקטופ */}
        <nav aria-label="ניווט ראשי" className="hidden min-w-0 flex-1 justify-center lg:flex">
          <div className="flex w-full max-w-full items-center gap-1 overflow-x-auto rounded-full border bg-muted/40 p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {SECTIONS.map((item) => {
              const active = view === item.view;
              return (
                <button
                  key={item.view}
                  type="button"
                  onClick={() => go(item.view, item.subs[0]?.key)}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "relative flex h-9 items-center gap-2 rounded-full px-4 text-sm font-medium transition-colors",
                    active
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <item.icon className="size-4" aria-hidden="true" />
                  {item.label}
                </button>
              );
            })}
          </div>
        </nav>

        <div className="flex flex-1 items-center justify-end gap-2 lg:flex-none">
          <OperatorPill />
          <ModeToggle />
          <HashChip
            value={headHash}
            label="HEAD"
            head={6}
            tail={4}
            className="hidden shrink-0 xl:inline-flex"
          />
          <ThemeToggle />

          {/* תפריט מובייל — מגירה מלאה מצד ההפעלה, מטרות-מגע 44px+, כותרת ותחתית דביקות */}
          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <SheetTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                className="size-11 lg:hidden"
                aria-label="פתח תפריט"
              >
                <Menu className="size-5" />
              </Button>
            </SheetTrigger>
            <SheetContent
              side="left"
              className="flex w-[min(21rem,88vw)] flex-col gap-0 p-0"
              aria-describedby={undefined}
            >
              {/* כותרת דביקה — המותג בראש, כפתור-הסגירה (44px) בקצה השני */}
              <div className="flex items-center gap-3 border-b bg-background/95 px-4 py-3 backdrop-blur">
                <span
                  className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  aria-hidden="true"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-5">
                    <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8" strokeLinecap="round" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                </span>
                <div className="min-w-0">
                  <SheetTitle className="text-sm font-bold tracking-tight">SAOS · THE WEAVE</SheetTitle>
                  <p className="text-[11px] text-muted-foreground">ניווט ראשי · {SECTIONS.length} סקציות</p>
                </div>
              </div>

              {/* הרשימה — גלילה עם סרגל מעוצב, מטרות-מגע 44px+ */}
              <nav
                aria-label="ניווט ראשי במובייל"
                className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3 [scrollbar-width:thin] [scrollbar-color:rgba(113,113,122,0.45)_transparent] [&::-webkit-scrollbar]:w-2.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-500/40 hover:[&::-webkit-scrollbar-thumb]:bg-zinc-500/60"
              >
                <div className="flex flex-col gap-1">
                  {SECTIONS.map((item) => {
                    const active = view === item.view;
                    return (
                      <div key={item.view} className="flex flex-col">
                        <button
                          type="button"
                          onClick={() => go(item.view, item.subs[0]?.key)}
                          aria-current={active ? "page" : undefined}
                          className={cn(
                            "flex min-h-12 w-full items-center gap-3 rounded-xl border px-2.5 text-start text-sm font-semibold transition-all duration-150 active:scale-[0.99]",
                            active
                              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                              : "border-transparent text-foreground/90 hover:bg-muted/60 hover:text-foreground"
                          )}
                        >
                          <span
                            className={cn(
                              "flex size-9 shrink-0 items-center justify-center rounded-lg border transition-colors",
                              active
                                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                                : "border-border bg-muted/40 text-muted-foreground"
                            )}
                            aria-hidden="true"
                          >
                            <item.icon className="size-4" />
                          </span>
                          <span className="min-w-0 flex-1 truncate">{item.label}</span>
                          {item.subs.length > 0 && (
                            <ChevronDown
                              className={cn(
                                "size-4 shrink-0 text-muted-foreground/70 transition-transform",
                                active && "rotate-180"
                              )}
                              aria-hidden="true"
                            />
                          )}
                        </button>
                        {item.subs.length > 0 && (
                          <div className="mb-1.5 ms-4 mt-0.5 flex flex-col gap-0.5 border-s ps-3 pe-1">
                            {item.subs.map((sub) => {
                              const subActive = active && section === sub.key;
                              return (
                                <button
                                  key={sub.key}
                                  type="button"
                                  onClick={() => go(item.view, sub.key)}
                                  aria-current={subActive ? "true" : undefined}
                                  className={cn(
                                    "flex min-h-11 w-full items-center rounded-lg px-3 text-start text-[13px] transition-colors duration-150 active:scale-[0.99]",
                                    subActive
                                      ? "bg-emerald-500/10 font-medium text-emerald-700 dark:text-emerald-300"
                                      : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                                  )}
                                >
                                  {sub.label}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </nav>

              {/* תחתית דביקה — ראש השרשרת החי + טריות המראה (רק כשנמדד) */}
              <div className="border-t bg-muted/30 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground">שרשרת חיה</span>
                  <HashChip value={headHash} label="HEAD" head={6} tail={4} />
                </div>
                {pulse && (
                  <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                    מראת הענן עודכנה{" "}
                    {new Date(pulse.mirrorGeneratedAt).toLocaleTimeString("he-IL", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}{" "}
                    · {pulse.stats.attestations} אימותים · {pulse.vitality.windowLimited ? "חלון-מראה" : "רצף"} {pulse.vitality.aliveDays} ימים
                  </p>
                )}
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>

      {/* תתי-תפריט - רק לסקציות עשירות, גלוי גם במובייל (גלילה) */}
      {currentSection && currentSection.subs.length > 0 && (
        <nav
          aria-label={`תתי-תפריט: ${currentSection.label}`}
          className="border-t bg-muted/20"
        >
          <div className="mx-auto w-full max-w-7xl overflow-x-auto px-4 py-1.5 sm:px-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <div className="flex w-max items-center gap-1">
              {currentSection.subs.map((sub) => {
                const active = section === sub.key;
                return (
                  <button
                    key={sub.key}
                    type="button"
                    onClick={() => go(currentSection.view, sub.key)}
                    aria-current={active ? "true" : undefined}
                    className={cn(
                      "flex h-11 shrink-0 items-center rounded-full px-3.5 text-[13px] font-medium transition-colors active:scale-[0.98] md:h-9",
                      active
                        ? "bg-foreground text-background"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                  >
                    {sub.label}
                  </button>
                );
              })}
            </div>
          </div>
        </nav>
      )}
    </header>
  );
}
