"use client";

/**
 * הנול — רשת-האמת הציבורית · הפלטפורמה.
 *
 * ארבעה מקטעים (סטודיו · תעודות · עדים · מערכת) — וכל-העומק יורד לתוכם.
 * המצב חי ב-URL: כל-מסך, בלוק ותעודה — קישור-שיתוף אמיתי.
 *   #studio/loom · #certs/lookup?h=<hash> · #witnesses/book?block=679 · #system/checkpoints
 */

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useWeaveStatus } from "@/hooks/use-weave";
import { WeaveFooter, WeaveHeader, MobileNav, NavRail, SubTabs, type SectionId } from "@/components/weave/chrome";
import { LoomHero, BatcherReceipt, SealsTimeline, AnchorsStrip } from "@/components/weave/loom";
import { StampStudio } from "@/components/weave/studio";
import { SecretStamp } from "@/components/weave/secret";
import { Achievements } from "@/components/weave/achievements";
import { Certificates } from "@/components/weave/certificates";
import { VerifyLab, ForgerChallenge } from "@/components/weave/verify-lab";
import { Ledger } from "@/components/weave/ledger";
import { Witnesses } from "@/components/weave/witnesses";
import { System, CheckpointAxis } from "@/components/weave/system";
import { Sovereign } from "@/components/weave/sovereign";
import { About } from "@/components/weave/about";
import type { Certificate } from "@/hooks/use-weave";

const DEFAULT_SUB: Record<SectionId, string> = {
  studio: "loom",
  certs: "lookup",
  witnesses: "anchors",
  system: "engine",
  sovereign: "chain",
};

/** פענוח hash מה-URL: #section/sub?key=val&… */
function parseHash(): { section: SectionId; sub?: string; params: Record<string, string> } | null {
  if (typeof window === "undefined") return null;
  const raw = window.location.hash.replace(/^#\/?/, "");
  if (!raw) return null;
  const [path, query] = raw.split("?");
  const [section, sub] = path.split("/");
  const valid = ["studio", "certs", "witnesses", "system", "sovereign"];
  if (!valid.includes(section)) return null;
  const params: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(query || "")) params[k] = v;
  return { section: section as SectionId, sub, params };
}

export default function Home() {
  const { data: status, loading } = useWeaveStatus();
  const [section, setSection] = useState<SectionId>("studio");
  const [sub, setSub] = useState<Record<SectionId, string>>(DEFAULT_SUB);
  const [certHash, setCertHash] = useState<string | null>(null);
  const [focusBlock, setFocusBlock] = useState<number | null>(null);
  // התעודה האחרונה שנטענה — משותפת למעבדת-האימות ולאתגר-המזייף
  const [cert, setCert] = useState<{ certificate: Certificate; verifier?: string } | null>(null);
  const [hydrated, setHydrated] = useState(false);

  const navigate = useCallback((s: SectionId, subId?: string) => {
    setSection(s);
    if (subId) setSub((p) => ({ ...p, [s]: subId }));
    else setSub((p) => (p[s] === DEFAULT_SUB[s] ? p : { ...p, [s]: DEFAULT_SUB[s] }));
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  // שחזור-מצב מה-URL — קישור-שיתוף אמיתי (פעם-אחת בטעינה · מחוץ-ל-sync-render — חוק-ה-hooks)
  useEffect(() => {
    const t = setTimeout(() => {
      const h = parseHash();
      if (h) {
        setSection(h.section);
        if (h.sub) setSub((p) => ({ ...p, [h.section]: h.sub }));
        if (h.params.h) setCertHash(h.params.h);
        if (h.params.block) setFocusBlock(Number(h.params.block));
      }
      setHydrated(true);
    }, 0);
    return () => clearTimeout(t);
  }, []);

  // ניווט-חוזר באותו-טאב: קישור-שיתוף שנדבק · חץ אחורה/קדימה — מתנווטים בלי טעינה מחדש
  useEffect(() => {
    const onHash = () => {
      const h = parseHash();
      if (!h) return;
      setSection(h.section);
      if (h.sub) setSub((p) => ({ ...p, [h.section]: h.sub }));
      if (h.params.h !== undefined) setCertHash(h.params.h || null);
      if (h.params.block !== undefined) setFocusBlock(h.params.block ? Number(h.params.block) : null);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // סנכרון ה-URL עם המסך — כל-מסך הוא קישור
  useEffect(() => {
    if (!hydrated) return;
    const params: string[] = [];
    if (section === "certs" && sub.certs === "lookup" && certHash) params.push(`h=${certHash}`);
    if (section === "witnesses" && sub.witnesses === "book" && focusBlock != null) params.push(`block=${focusBlock}`);
    const qs = params.length ? `?${params.join("&")}` : "";
    const next = `#${section}/${sub[section]}${qs}`;
    if (window.location.hash !== next) {
      window.history.replaceState(null, "", next);
    }
  }, [section, sub, certHash, focusBlock, hydrated]);

  const setSubOf = useCallback(
    (s: string) => {
      setSub((p) => ({ ...p, [section]: s }));
    },
    [section]
  );

  const openCertificate = useCallback(
    (h: string) => {
      setCertHash(h);
      navigate("certs", "lookup");
    },
    [navigate]
  );

  const openBlock = useCallback(
    (h: number) => {
      setFocusBlock(h);
      navigate("witnesses", "book");
    },
    [navigate]
  );

  // עדכון-כותרת-מסמך לפי מקטע (a11y)
  useEffect(() => {
    const titles: Record<SectionId, string> = {
      studio: "הנול — סטודיו האריגה",
      certs: "הנול — תעודות ואימות-חי",
      witnesses: "הנול — העדים הציבוריים",
      system: "הנול — לב-המערכת וציר-האימות",
      sovereign: "הנול — ריבונות SAOS-NET",
    };
    document.title = titles[section] + " · רשת-האמת הציבורית";
  }, [section]);

  return (
    <>
      <WeaveHeader status={status} onNavigate={navigate} />

      <main className="flex-1 w-full">
        <div className="mx-auto max-w-7xl px-4 md:px-6 py-6 md:py-10 grid lg:grid-cols-[230px_minmax(0,1fr)] gap-8">
          <aside aria-label="ניווט-צד">
            <NavRail active={section} sub={sub[section]} onNavigate={navigate} onSub={setSubOf} status={status} />
          </aside>

          <section aria-label="תוכן" className="min-w-0">
            <SubTabs section={section} active={sub[section]} onSub={setSubOf} />

            <AnimatePresence mode="wait">
              <motion.div
                key={section + ":" + sub[section]}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.26, ease: "easeOut" }}
              >
                {/* ══ סטודיו ══ */}
                {section === "studio" && (
                  <>
                    {sub.studio === "loom" && (
                      <div className="space-y-8">
                        <LoomHero
                          status={status}
                          loading={loading}
                          onStamp={() => navigate("studio", "stamp")}
                          onForge={() => navigate("certs", "forge")}
                          onIntegrity={() => navigate("system", "checkpoints")}
                          onOpenBlock={openBlock}
                        />
                        <BatcherReceipt status={status} />
                      </div>
                    )}
                    {sub.studio === "wins" && <Achievements />}
                    {sub.studio === "stamp" && <StampStudio onVerify={openCertificate} onOpenBlock={openBlock} />}
                    {sub.studio === "secret" && <SecretStamp onVerify={openCertificate} />}
                    {sub.studio === "about" && <About onStamp={() => navigate("studio", "stamp")} onVerify={() => navigate("certs", "lookup")} onBook={() => navigate("witnesses", "book")} />}
                  </>
                )}

                {/* ══ תעודות ══ */}
                {section === "certs" && (
                  <>
                    {sub.certs === "lookup" && (
                      <Certificates initialHash={certHash} onCertLoaded={setCert} setCertHash={setCertHash} />
                    )}
                    {sub.certs === "lab" && <VerifyLab cert={cert?.certificate ?? null} onNeedCert={() => setSubOf("lookup")} />}
                    {sub.certs === "forge" && <ForgerChallenge cert={cert?.certificate ?? null} onNeedCert={() => setSubOf("lookup")} />}
                    {sub.certs === "seals" && <SealsTimeline status={status} onOpenBlock={openBlock} />}
                  </>
                )}

                {/* ══ עדים ══ */}
                {section === "witnesses" && (
                  <>
                    {sub.witnesses === "anchors" && <AnchorsStrip status={status} />}
                    {sub.witnesses === "quorum" && <Witnesses />}
                    {sub.witnesses === "book" && <Ledger focusBlock={focusBlock} onVerify={openCertificate} />}
                  </>
                )}

                {/* ══ מערכת ══ */}
                {section === "system" && (
                  <>
                    {sub.system === "engine" && <System />}
                    {sub.system === "checkpoints" && <CheckpointAxis />}
                  </>
                )}

                {/* ══ ריבונות (99b) — SAOS-NET: מטבעות-עטופים · זירת-גריד · עוגנים ══ */}
                {section === "sovereign" && (
                  <>
                    {sub.sovereign === "chain" && <Sovereign />}
                  </>
                )}
              </motion.div>
            </AnimatePresence>
          </section>
        </div>
      </main>

      <WeaveFooter status={status} onNavigate={navigate} />
      <MobileNav active={section} onNavigate={(s) => navigate(s)} />
    </>
  );
}
