"use client";

/**
 * witnesses — עדי-קיום.
 * עדות על claim תחת topic: הצהרה חתומה על הספר, קוורום נצבר מתמטית.
 */

import { useState } from "react";
import { motion } from "framer-motion";
import { Eye, PlusCircle, AlertTriangle } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { Panel, SectionHead, HashText, Spinner, EmptyState, LiveDot } from "./primitives";
import { useWitnesses } from "@/hooks/use-weave";
import { cn } from "@/lib/utils";

export function Witnesses() {
  const { data, refresh } = useWitnesses();
  const [topic, setTopic] = useState("fact");
  const [claimHash, setClaimHash] = useState("");
  const [validator, setValidator] = useState("headcorner");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const valid = /^[a-z0-9-]{2,32}$/.test(topic) && /^[0-9a-f]{64}$/.test(claimHash.trim().toLowerCase()) && /^[a-z0-9-_.]{2,24}$/.test(validator);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/weave/witness", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ topic, claimHash: claimHash.trim().toLowerCase(), validator }),
      });
      const j = await res.json();
      if (j.ok) {
        toast({ title: "עדות נרשמה על הספר", description: `עד #${j.witnessed?.quorum} על claim זה` });
        setClaimHash("");
        refresh();
      } else {
        setErr(j.note || j.why || j.err || "נדחה");
        toast({ title: "העדות לא נקלטה", description: j.note || j.why || j.err, variant: "destructive" });
      }
    } catch (e2) {
      setErr(String((e2 as Error)?.message ?? e2));
    } finally {
      setBusy(false);
    }
  };

  const topics = data?.topics || [];

  return (
    <div>
      <SectionHead
        eyebrow="WITNESSES"
        title="עדי-קיום"
        icon={<Eye className="size-3.5" />}
        desc="אמת ציבורית אינה רק גיבוב — היא עדות. כל אחד יכול להעיד על claim תחת נושא, והקוורום נצבר על הספר עצמו. 40 גז לעדות."
      />

      <div className="grid lg:grid-cols-5 gap-4">
        {/* מפת-העדויות */}
        <div className="lg:col-span-3 order-2 lg:order-1">
          {!data?.ok ? (
            <Panel><EmptyState title="מפת-העדויות טרם זמינה" /></Panel>
          ) : topics.length === 0 ? (
            <Panel><EmptyState title="אין עדויות — הספר ממתין לעד הראשון" sub="בחר נושא, הדבק claim-hash, והעד בעצמך" /></Panel>
          ) : (
            <div className="space-y-3 max-h-[480px] overflow-y-auto pl-1">
              {topics.map((t, i) => (
                <motion.div
                  key={t.topic + (t.claimHash || "") + i}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.04 }}
                  className="panel px-4 py-4"
                >
                  <div className="flex flex-wrap items-center gap-3 mb-3">
                    <span className="hash text-gold font-bold text-sm">{t.topic}</span>
                    {t.claimHash && <HashText h={t.claimHash} head={14} tail={10} className="text-ink/80 text-xs" />}
                    <span className="ms-auto text-xs text-ink-2">
                      קוורום <span className={cn("hash font-bold", t.quorum >= 3 ? "text-verified" : "text-gold")}>{t.quorum}</span>
                    </span>
                  </div>
                  {/* שרשרת-עדים */}
                  <div className="flex items-center gap-2 flex-wrap">
                    {t.validators.map((v, j) => (
                      <span
                        key={v + j}
                        className="hash inline-flex items-center gap-1.5 rounded-full border border-verified/25 bg-verified/5 px-2.5 py-1 text-[10px] text-verified"
                        dir="ltr"
                      >
                        <LiveDot tone="green" className="!size-1.5" />
                        {v}
                      </span>
                    ))}
                    {/* מקומות-פנויים עד קוורום 3 */}
                    {Array.from({ length: Math.max(0, 3 - t.quorum) }, (_, k) => (
                      <span key={"p" + k} className="hash inline-flex items-center gap-1.5 rounded-full border border-dashed border-border px-2.5 py-1 text-[10px] text-ink-2/60">
                        פנוי
                      </span>
                    ))}
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </div>

        {/* מחברת-העדות */}
        <Panel className="lg:col-span-2 order-1 lg:order-2 h-fit">
          <div className="flex items-center gap-2 mb-4 text-gold">
            <PlusCircle className="size-4" />
            <span className="font-display font-bold">העד בעצמך</span>
          </div>
          <form onSubmit={submit} className="space-y-3.5 text-sm">
            <label className="block">
              <span className="block text-[11px] text-ink-2 mb-1.5">נושא (topic) · a-z 0-9 -</span>
              <input
                value={topic}
                onChange={(e) => setTopic(e.target.value.toLowerCase())}
                dir="ltr"
                maxLength={32}
                className="w-full hash rounded-lg border border-input bg-muted/40 px-3 py-2.5 text-xs text-ink focus:outline-none focus:ring-2 focus:ring-gold/40"
              />
            </label>
            <label className="block">
              <span className="block text-[11px] text-ink-2 mb-1.5">claim-hash · sha-256 של הטענה</span>
              <input
                value={claimHash}
                onChange={(e) => setClaimHash(e.target.value.toLowerCase())}
                dir="ltr"
                maxLength={64}
                placeholder="64 hex"
                className="w-full hash rounded-lg border border-input bg-muted/40 px-3 py-2.5 text-xs text-ink placeholder:text-ink-2/40 focus:outline-none focus:ring-2 focus:ring-gold/40"
              />
            </label>
            <label className="block">
              <span className="block text-[11px] text-ink-2 mb-1.5">עד (validator)</span>
              <input
                value={validator}
                onChange={(e) => setValidator(e.target.value.toLowerCase())}
                dir="ltr"
                maxLength={24}
                className="w-full hash rounded-lg border border-input bg-muted/40 px-3 py-2.5 text-xs text-ink focus:outline-none focus:ring-2 focus:ring-gold/40"
              />
            </label>
            {err && (
              <div className="flex items-start gap-2 text-xs text-broken">
                <AlertTriangle className="size-3.5 mt-0.5 shrink-0" />
                <span>{err}</span>
              </div>
            )}
            <button
              type="submit"
              disabled={!valid || busy}
              className="w-full rounded-xl px-5 py-3 text-sm font-bold bg-gradient-to-b from-gold to-[#c98a2e] text-[#1a1206] shadow-[0_8px_24px_-10px_rgba(233,169,62,0.5)] hover:-translate-y-0.5 transition-all disabled:opacity-40 disabled:pointer-events-none inline-flex items-center justify-center gap-2"
            >
              {busy ? <Spinner className="size-4 text-[#1a1206]" /> : <Eye className="size-4" />}
              העד על הספר
              <span className="hash text-[10px] opacity-70">40 gas</span>
            </button>
            <p className="text-[11px] text-ink-2/60 leading-relaxed">
              העדות נרשמת על הספר הריבוני עצמו — בלי שום-דבר בין העד לאמת. כפילות נדחית מתמטית על-ידי הקרנל.
            </p>
          </form>
        </Panel>
      </div>
    </div>
  );
}
