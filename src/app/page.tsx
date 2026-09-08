"use client";

/**
 * 117m — SAOS-NET COMMAND · מרכז-הבקרה הריבוני
 *
 * עיצוב-חדש-לגמרי (לא-שיפור-הקיים): חדר-בקרה-כהה ברמת-מכשיר,
 * mobile-first (ניווט-תחתון + safe-area) ומחשב-מלא (מסילת-צד),
 * הכל-חי מה-NEXUS-API (אפס-סימולציה · סקר-5-שניות).
 *
 * המצב חי ב-URL: #control · #deposits · #doors · #shield · #econ
 */

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useNexus } from "@/hooks/use-nexus";
import { BottomNav, DesktopRail, NexusFooter, NexusHeader, type SectionId } from "@/components/nexus/shell";
import { ControlSec, DepositsSec, DoorsSec, EconSec, ShieldSec } from "@/components/nexus/sections";

const VALID: SectionId[] = ["control", "deposits", "doors", "shield", "econ"];

function parseHash(): SectionId | null {
  if (typeof window === "undefined") return null;
  const raw = window.location.hash.replace(/^#\/?/, "").split("/")[0];
  return (VALID as string[]).includes(raw) ? (raw as SectionId) : null;
}

const TITLES: Record<SectionId, string> = {
  control: "בקרה",
  deposits: "הפקדות",
  doors: "דלתות",
  shield: "מגן",
  econ: "כלכלה",
};

export default function Home() {
  const { data, error, loading } = useNexus(5000);
  const [section, setSection] = useState<SectionId>("control");
  const [hydrated, setHydrated] = useState(false);

  const navigate = useCallback((s: SectionId) => {
    setSection(s);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  // שחזור-מצב-מה-URL (מחוץ-ל-sync-render — חוק-ה-hooks) + סנכרון (כל-מסך=קישור)
  useEffect(() => {
    const t = setTimeout(() => {
      const h = parseHash();
      if (h) setSection(h);
      setHydrated(true);
    }, 0);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    if (!hydrated) return;
    const next = "#" + section;
    if (window.location.hash !== next) window.history.replaceState(null, "", next);
    document.title = `SAOS-NET COMMAND · ${TITLES[section]}`;
  }, [section, hydrated]);

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
        at={data?.at ?? ""}
      />

      <main className="w-full flex-1 pb-24 md:pb-8">
        <div className="mx-auto grid max-w-7xl gap-6 px-4 py-4 md:px-6 md:py-8 lg:grid-cols-[210px_minmax(0,1fr)]">
          <aside aria-label="מסילת-ניווט" className="hidden md:block">
            <DesktopRail active={section} onNavigate={navigate} />
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
                <motion.div key={section} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.22, ease: "easeOut" }}>
                  {section === "control" && <ControlSec data={data} />}
                  {section === "deposits" && <DepositsSec data={data} />}
                  {section === "doors" && <DoorsSec data={data} />}
                  {section === "shield" && <ShieldSec data={data} />}
                  {section === "econ" && <EconSec data={data} />}
                </motion.div>
              </AnimatePresence>
            ) : null}
          </section>
        </div>
      </main>

      <NexusFooter at={data?.at ?? ""} />
      <BottomNav active={section} onNavigate={navigate} />
    </div>
  );
}
