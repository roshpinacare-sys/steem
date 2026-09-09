"use client";

/**
 * 117n — SAOS-NET COMMAND II · מרכז-ההפעלה-הריבוני
 *
 * דור-שני-מלא (לא-שיפור): 7-מסכים × תתי-תפריטים אמת · כלים-מפעילים (בודק-מגן חי · סייר-ספר ·
 * מציג-לוגים · מלוא-האחזקות) · הכל-חי מה-NEXUS-API-והרשת (אפס-סימולציה).
 *
 * המצב-חי-ב-URL דו-שלבי: #control/overview · #book/blocks · #shield/scanner · #system/logs …
 */

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useNexus } from "@/hooks/use-nexus";
import { BottomNav, DesktopRail, NexusFooter, NexusHeader, SECTIONS, SubNav, type SectionId, type SubId, SUBS } from "@/components/nexus/shell";
import { BookSec, ControlSec, DepositsSec, DoorsSec, EconSec, GateSec, ShieldSec, SystemSec } from "@/components/nexus/sections";

const VALID = SECTIONS.map((s) => s.id) as SectionId[];

type Loc = { section: SectionId; sub: SubId };

function parseHash(): Loc | null {
  if (typeof window === "undefined") return null;
  const parts = window.location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  const section = (VALID as string[]).includes(parts[0]) ? (parts[0] as SectionId) : null;
  if (!section) return null;
  const subs = SUBS[section].map((s) => s.id);
  const sub = parts[1] && subs.includes(parts[1]) ? parts[1] : subs[0];
  return { section, sub };
}

const TITLES: Record<SectionId, string> = {
  control: "בקרה",
  book: "ספר",
  shield: "מגן",
  doors: "דלתות",
  deposits: "הפקדות",
  econ: "כלכלה",
  system: "מערכת",
  gate: "שער",
};

export default function Home() {
  const { data, error, loading } = useNexus(5000);
  const [loc, setLoc] = useState<Loc>({ section: "control", sub: "overview" });
  const [hydrated, setHydrated] = useState(false);

  const navigate = useCallback((s: SectionId, sub?: SubId) => {
    setLoc((prev) => {
      const subs = SUBS[s].map((u) => u.id);
      const nextSub = sub && subs.includes(sub) ? sub : s === prev.section ? prev.sub : subs[0];
      return { section: s, sub: nextSub };
    });
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const navigateSub = useCallback((sub: SubId) => {
    setLoc((prev) => ({ ...prev, sub }));
  }, []);

  // שחזור-מצב-מה-URL (מחוץ-ל-sync-render — חוק-ה-hooks) + סנכרון דו-שלבי
  useEffect(() => {
    const t = setTimeout(() => {
      const h = parseHash();
      if (h) setLoc(h);
      setHydrated(true);
    }, 0);
    const onHash = () => {
      const h = parseHash();
      if (h) setLoc(h);
    };
    window.addEventListener("hashchange", onHash);
    return () => {
      clearTimeout(t);
      window.removeEventListener("hashchange", onHash);
    };
  }, []);
  useEffect(() => {
    if (!hydrated) return;
    const next = `#${loc.section}/${loc.sub}`;
    if (window.location.hash !== next) window.history.replaceState(null, "", next);
    document.title = `SAOS-NET COMMAND II · ${TITLES[loc.section]}`;
  }, [loc, hydrated]);

  const fleetServices = data?.fleet.services ?? [];
  const fleetOk = fleetServices.filter((s) => s.ok).length;

  return (
    <div className="nexus-bg flex min-h-screen flex-col">
      <NexusHeader
        saosHeight={data?.meta.saosHeight ?? 0}
        tronHeight={data?.tron.height ?? 0}
        fleetOk={fleetOk}
        fleetTotal={fleetServices.length}
        chainsOk={data?.deposits.chainsOk ?? 0}
        chainsTotal={data?.deposits.chainsTotal ?? 10}
        bookHead={data?.book.head ?? 0}
        at={data?.at ?? ""}
      />
      <SubNav section={loc.section} sub={loc.sub} onNavigate={navigateSub} />

      <main className="w-full flex-1 pb-24 md:pb-8">
        <div className="mx-auto grid max-w-7xl gap-6 px-4 py-4 md:px-6 md:py-8 lg:grid-cols-[210px_minmax(0,1fr)]">
          <aside aria-label="מסילת-ניווט" className="hidden md:block">
            <DesktopRail active={loc.section} sub={loc.sub} onNavigate={navigate} />
          </aside>

          <section aria-label="תוכן-ראשי" className="min-w-0">
            {error && !data && (
              <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200" role="alert">
                קשר-ל-NEXUS-נפל: {error} — הסקר-ממשיך-בכנות
              </div>
            )}
            {loading && !data ? (
              <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3">
                <div className="relative flex h-12 w-12 items-center justify-center">
                  <span className="absolute h-full w-full animate-ping rounded-full bg-emerald-500/20" aria-hidden />
                  <span className="h-3 w-3 rounded-full bg-emerald-400" aria-hidden />
                </div>
                <p className="font-mono text-xs uppercase tracking-[0.3em] text-zinc-500">linking the nexus…</p>
              </div>
            ) : data ? (
              <AnimatePresence mode="wait">
                <motion.div key={loc.section + "/" + loc.sub} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.22, ease: "easeOut" }}>
                  {loc.section === "control" && <ControlSec data={data} sub={loc.sub} />}
                  {loc.section === "book" && <BookSec sub={loc.sub} />}
                  {loc.section === "shield" && <ShieldSec data={data} sub={loc.sub} />}
                  {loc.section === "doors" && <DoorsSec data={data} sub={loc.sub} />}
                  {loc.section === "deposits" && <DepositsSec data={data} sub={loc.sub} />}
                  {loc.section === "econ" && <EconSec data={data} sub={loc.sub} />}
                  {loc.section === "system" && <SystemSec sub={loc.sub} />}
                  {loc.section === "gate" && <GateSec sub={loc.sub} />}
                </motion.div>
              </AnimatePresence>
            ) : null}
          </section>
        </div>
      </main>

      <NexusFooter at={data?.at ?? ""} />
      <BottomNav active={loc.section} onNavigate={navigate} />
    </div>
  );
}
