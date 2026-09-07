"use client";

/**
 * certificates — תעודות-אריגה: האימות הציבורי.
 * הזן hash → קבל תעודה: העלה, נתיב-המרקל, שורש-האיטום, נושא-הצ'קפוינט והעגונים.
 * מסמך עם משקל של פסק-דין — כי ככה נראית אמת.
 */

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ScrollText, Search, ShieldCheck, ShieldAlert, ShieldQuestion, ExternalLink, Landmark, Share2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { Panel, SectionHead, HashText, Spinner, LiveDot, Tip, fmtClock } from "./primitives";
import { fetchCertificate, fetchSearch, timeAgoHe, type Certificate } from "@/hooks/use-weave";
import { cn } from "@/lib/utils";

/* ── חותמת-שעווה ── */
function WaxSeal({ tone = "gold", label }: { tone?: "gold" | "amber" | "rose"; label: string }) {
  const color = tone === "rose" ? "#fb7185" : tone === "amber" ? "#f5c15c" : "#e9a93e";
  return (
    <svg viewBox="0 0 100 100" className="size-20 md:size-24 shrink-0" role="img" aria-label={`חותמת ${label}`}>
      <circle cx="50" cy="50" r="44" fill="none" stroke={color} strokeWidth="7" strokeDasharray="5.2 3.4" opacity="0.9" />
      <circle cx="50" cy="50" r="34" fill="#13100a" stroke={color} strokeWidth="1.6" />
      <circle cx="50" cy="50" r="27" fill="none" stroke={color} strokeWidth="0.8" strokeDasharray="2 3" opacity="0.6" />
      <text x="50" y="47" textAnchor="middle" fill={color} fontSize="11" fontWeight="700" className="hash" direction="ltr">
        WEAVE
      </text>
      <text x="50" y="62" textAnchor="middle" fill={color} fontSize="13" fontWeight="800" className="hash" direction="ltr">
        {label}
      </text>
    </svg>
  );
}

export function Certificates({
  initialHash,
  onCertLoaded,
  setCertHash,
}: {
  initialHash?: string | null;
  onCertLoaded?: (r: { certificate: Certificate; verifier?: string } | null) => void;
  setCertHash?: (h: string | null) => void;
}) {
  const [q, setQ] = useState(initialHash || "");
  const [cert, setCert] = useState<Certificate | null>(null);
  const [verifier, setVerifier] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);

  const norm = q.trim().toLowerCase().replace(/^0x/, "");

  const lookup = useCallback(
    async (hex: string) => {
      if (!/^[0-9a-f]{64}$/.test(hex)) return;
      setBusy(true);
      setTouched(true);
      try {
        const j = await fetchCertificate(hex);
        if (j) {
          setCert(j.certificate);
          setVerifier(j.verifier || null);
          onCertLoaded?.(j);
        } else {
          setCert(null);
          onCertLoaded?.(null);
        }
      } finally {
        setBusy(false);
      }
    },
    [onCertLoaded]
  );

  useEffect(() => {
    if (initialHash) {
      setQ(initialHash);
      lookup(initialHash.toLowerCase());
    }
  }, [initialHash, lookup]);

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (/^[0-9a-f]{64}$/.test(norm)) {
      setCertHash?.(norm);
      lookup(norm);
      return;
    }
    if (/^#?\d{1,9}$/.test(q.trim())) {
      // seq — מתווך-החיפוש ממפה ל-hash של החותמת
      setBusy(true);
      setTouched(true);
      try {
        const results = await fetchSearch(q.trim());
        const stamp = results.find((r) => r.kind === "stamp" && r.stamp?.h);
        if (stamp?.stamp?.h) {
          setCertHash?.(stamp.stamp.h);
          await lookup(stamp.stamp.h);
        } else {
          toast({ title: "לא נמצאה חותמת ב-seq הזה", description: `"${q.trim()}" לא ממפה לחותמת קיימת — נסה hash מלא או #seq של חותמת` });
          setCert(null);
          setCertHash?.(null);
        }
      } finally {
        setBusy(false);
      }
      return;
    }
    setTouched(true);
    setCert(null);
    setCertHash?.(null);
  };

  return (
    <div>
      <SectionHead
        eyebrow="PUBLIC VERIFICATION"
        title="תעודות-אריגה"
        icon={<ScrollText className="size-3.5" />}
        desc="הזן hash — וקבל את השביל המלא: החותמת, נתיב-המרקל, שורש-האיטום, הצ'קפוינט הנושא והעוגנים הציבוריים. אפשר גם #seq. אחר-כך קח את התעודה למעבדת-האימות ולאתגר-המזייף — המתמטיקה רצה בדפדפן שלך."
      />

      <form onSubmit={submit} className="flex gap-2 max-w-2xl">
        <div className="relative flex-1">
          <Search className="absolute start-3.5 top-1/2 -translate-y-1/2 size-4 text-gold-dim" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="64 תווי-hex — או #seq של חותמת (#123)"
            dir="ltr"
            maxLength={80}
            aria-label="חיפוש hash או seq לתעודה"
            className="w-full hash rounded-xl border border-input bg-muted/40 ps-10 pe-4 py-3 text-xs md:text-sm text-ink placeholder:text-ink-2/50 focus:outline-none focus:ring-2 focus:ring-gold/40 focus:border-gold/40 transition-all"
          />
        </div>
        <button
          type="submit"
          disabled={busy || !q.trim()}
          className="rounded-xl px-5 py-3 text-sm font-bold bg-gradient-to-b from-gold to-[#c98a2e] text-[#1a1206] shadow-[0_8px_24px_-10px_rgba(233,169,62,0.5)] hover:-translate-y-0.5 transition-all disabled:opacity-40 disabled:pointer-events-none inline-flex items-center gap-2"
        >
          {busy ? <Spinner className="size-4 text-[#1a1206]" /> : <ScrollText className="size-4" />}
          אמת
        </button>
      </form>
      {touched && norm && !/^[0-9a-f]{64}$/.test(norm) && (
        <p className="text-xs text-broken mt-2">נדרשות בדיוק 64 תווי-hex — זהו פורמט sha-256.</p>
      )}

      <div className="mt-6">
        {busy && !cert ? (
          <Panel className="grid place-items-center min-h-48">
            <div className="flex flex-col items-center gap-3 text-ink-2">
              <Spinner className="size-6" />
              <span className="text-sm">בונה את הנתיב מהספר…</span>
            </div>
          </Panel>
        ) : cert ? (
          <CertDoc cert={cert} verifier={verifier} />
        ) : touched ? (
          <Panel className="min-h-40 grid place-items-center">
            <div className="text-center text-ink-2">
              <ShieldQuestion className="size-8 mx-auto mb-2 opacity-50" />
              <div className="text-sm font-medium">ה-hash לא נמצא על הספר</div>
              <div className="text-xs mt-1.5 text-ink-2/70">זה מצב כנה, לא שגיאה — ייתכן שמעולם לא נחתם. אם חתמת זה עתה, תן לפעימה לקרוא את הספר.</div>
            </div>
          </Panel>
        ) : (
          <Panel className="min-h-40 grid place-items-center border-dashed">
            <div className="text-center text-ink-2/60 text-sm">
              הדבק hash — או חתום בסטודיו וחזור לכאן עם הקבלה
            </div>
          </Panel>
        )}
      </div>
    </div>
  );
}

/* ── מסמך-התעודה ── */
function CertDoc({ cert, verifier }: { cert: Certificate; verifier: string | null }) {
  const sealed = cert.status === "sealed";
  const pending = cert.status === "pending-seal";
  const unknown = cert.status === "unknown";
  const reg = cert.anchors?.registry || {};
  const txids = (reg.txids || {}) as { steem?: string | null; hive?: string | null; blurt?: string | null };

  const linkFor = (chain: string, txid: string) =>
    chain === "steem"
      ? `https://steemscan.com/tx/${txid}`
      : chain === "hive"
        ? `https://hiveblocks.com/tx/${txid}`
        : `https://blurtblockexplorer.com/tx/${txid}`;

  return (
    <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45 }}>
      <div className="certificate-frame rounded-2xl bg-card px-5 py-8 md:px-10 md:py-10 relative overflow-hidden">
        {/* זוהר-רקע */}
        <div className="absolute inset-x-0 -top-24 h-48 bg-[radial-gradient(ellipse_at_center,rgba(233,169,62,0.08),transparent_65%)] pointer-events-none" aria-hidden />

        <div className="flex flex-col md:flex-row md:items-center gap-6">
          <div className="flex items-start gap-4 flex-1 min-w-0">
            <WaxSeal tone={sealed ? "gold" : pending ? "amber" : "rose"} label={sealed ? `#${cert.seal?.seq}` : pending ? "LIVE" : "—"} />
            <div className="min-w-0">
              <div className="text-[11px] text-gold-dim hash uppercase tracking-[0.25em] mb-1.5">certificate · saos.weave.v1</div>
              <h3 className="font-display text-2xl md:text-3xl font-black text-ink leading-tight">תעודת-אריגה</h3>
              <p className={cn("mt-2 flex items-center gap-2 text-sm font-medium", sealed ? "text-verified" : pending ? "text-gold" : "text-broken")}>
                <LiveDot tone={sealed ? "green" : pending ? "gold" : "rose"} className="text-current" />
                {sealed
                  ? "אומתה מתמטית — העלה מתקפל לשורש-האיטום"
                  : pending
                    ? "חיה על הספר — תאוטם באצווה השעתית הבאה"
                    : "לא נטווה — אין רישום כזה על הספר"}
              </p>
            </div>
          </div>
          <div className="text-xs text-ink-2 md:text-end space-y-1 shrink-0">
            <div>הונפקה מהספר הריבוני</div>
            <div className="hash text-ink/80">SAOS-NET · {fmtClock(new Date().toISOString())}</div>
          </div>
        </div>

        <div className="h-px bg-gradient-to-l from-transparent via-gold/40 to-transparent my-7" aria-hidden />

        <dl className="grid md:grid-cols-2 gap-x-10 gap-y-4 text-sm">
          <Field k="hash" full>
            <span className="hash text-gold-soft text-xs md:text-sm break-all" dir="ltr">{cert.h}</span>
          </Field>
          {cert.seq !== null && (
            <Field k="seq"><span className="hash">#{cert.seq}</span></Field>
          )}
          {cert.kind && <Field k="סוג"><span className="hash">{cert.kind}</span></Field>}
          {cert.by && <Field k="חותם-על"><span className="hash">{cert.by}</span></Field>}
          {cert.stampBlock && <Field k="נרשם בבלוק"><span className="hash">{cert.stampBlock}</span></Field>}
          {cert.at && <Field k="זמן-חתימה"><span>{fmtClock(cert.at)} · {timeAgoHe(cert.at)}</span></Field>}
        </dl>

        {sealed && cert.seal && (
          <>
            <div className="h-px bg-gradient-to-l from-transparent via-gold/25 to-transparent my-7" aria-hidden />
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-gold">
                <Landmark className="size-4" />
                <span className="font-display font-bold text-base">איטום #{cert.seal.seq}</span>
              </div>
              <dl className="grid md:grid-cols-2 gap-x-10 gap-y-4 text-sm">
                <Field k="שורש-האיטום" full>
                  <span className="hash text-gold-soft text-xs md:text-sm break-all" dir="ltr">{cert.seal.root}</span>
                </Field>
                <Field k="עלים באריג"><span className="hash">{cert.seal.count}</span> <span className="text-ink-2 text-xs">(seq {cert.seal.from}–{cert.seal.to})</span></Field>
                <Field k="מצב-הוכחה">
                  {cert.proof?.ok ? (
                    <span className="text-verified flex items-center gap-1.5">
                      <ShieldCheck className="size-4" /> נתיב-מרקל מאומת ({cert.proof.pathLen ?? 0} צעדים)
                    </span>
                  ) : (
                    <span className="text-broken flex items-center gap-1.5">
                      <ShieldAlert className="size-4" /> {cert.proof?.why || "הנתיב לא אומת"}
                    </span>
                  )}
                </Field>
                {cert.checkpoint && (
                  <Field k="נושא-הצ'קפוינט" full>
                    <span className="text-ink">
                      בלוק <span className="hash text-gold-soft">{cert.checkpoint.height}</span>
                      {cert.checkpoint.stateRoot && (
                        <span className="text-ink-2 text-xs"> — השורש נישא בתוך stateRoot</span>
                      )}
                      <span className="block text-[11px] text-ink-2/70 mt-1">{cert.checkpoint.note}</span>
                    </span>
                  </Field>
                )}
              </dl>

              {/* העוגנים הציבוריים */}
              <div className="rounded-xl border border-border bg-muted/30 px-4 py-4">
                <div className="text-[11px] text-gold-dim hash uppercase tracking-widest mb-3">anchors · העוגנים הציבוריים — עיגון האיטום של התעודה הזאת</div>
                <div className="grid sm:grid-cols-3 gap-3 text-xs">
                  {(["steem", "hive", "blurt"] as const).map((c) => (
                    <div key={c} className="flex flex-col gap-1.5">
                      <span className="hash text-ink font-bold">{c.toUpperCase()}</span>
                      {txids[c] ? (
                        <a href={linkFor(c, txids[c]!)} target="_blank" rel="noopener noreferrer" className="text-verified flex items-center gap-1.5 hover:underline underline-offset-2">
                          <HashText h={txids[c]} head={12} tail={8} copy={false} />
                          <ExternalLink className="size-3 shrink-0" />
                        </a>
                      ) : (
                        <span className="text-ink-2">ממתין לפעימת-עיגון</span>
                      )}
                    </div>
                  ))}
                </div>
                {cert.anchors?.tronNote && (
                  <div className="text-[11px] text-ink-2/70 mt-3 leading-relaxed">TRON: {cert.anchors.tronNote}</div>
                )}
              </div>
            </div>
          </>
        )}

        {/* איך לאמת בעצמך */}
        <div className="mt-7 flex flex-wrap items-center gap-3">
          {verifier && (
            <details className="group flex-1 min-w-56">
              <summary className="cursor-pointer text-xs text-gold-dim hover:text-gold transition-colors select-none">
                איך לאמת את התעודה בעצמך — בלי לסמוך על שרת זה
              </summary>
              <p className="hash text-[11px] leading-relaxed text-ink-2/80 mt-3 border-s-2 border-gold/20 ps-4" dir="ltr">
                {verifier}
              </p>
            </details>
          )}
          <Tip label="העתקת קישור-שיתוף ישיר לתעודה — מי שיפתח אותו יראה את אותו מסמך בדיוק">
            <button
              type="button"
              onClick={() => {
                const url = `${window.location.origin}/#certs/lookup?h=${cert.h}`;
                navigator.clipboard?.writeText(url).catch(() => {});
                toast({ title: "קישור-התעודה הועתק", description: "שלח למי שרוצה לראות בעצמו — הוא ייפתח על אותו מסמך בדיוק" });
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gold/30 bg-gold/10 px-3.5 py-2 text-xs font-bold text-gold hover:bg-gold/15 transition-colors"
            >
              <Share2 className="size-3.5" /> שיתוף
            </button>
          </Tip>
        </div>
      </div>
    </motion.div>
  );
}

function Field({ k, children, full }: { k: string; children: React.ReactNode; full?: boolean }) {
  return (
    <div className={cn(full && "md:col-span-2")}>
      <dt className="text-[11px] text-ink-2 mb-1">{k}</dt>
      <dd className="text-ink">{children}</dd>
    </div>
  );
}
