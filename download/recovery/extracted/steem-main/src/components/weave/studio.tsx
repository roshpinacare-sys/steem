"use client";

/**
 * studio — סטודיו חותמות-קיום.
 * מהתוכן אל הספר: sha256 חי בדפדפן → הזרקה דרך הצומת → קבלה מה-replay.
 * "הוכחה או לא קרה."
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Fingerprint, ShieldCheck, AlertTriangle, Stamp as StampIcon, ScrollText } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { Panel, SectionHead, HashText, Spinner, EmptyState, LiveDot } from "./primitives";
import { timeAgoHe, useStamps } from "@/hooks/use-weave";
import { cn } from "@/lib/utils";

const MAX_LEN = 4096;
const KINDS = ["text", "document", "commit", "artifact"] as const;

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

interface StampResponse {
  ok: boolean;
  err?: string;
  why?: string;
  note?: string;
  seq?: number | null;
  expect?: string;
  stamped?: {
    h: string;
    seq: number;
    kind: string;
    by: string;
    at: string | null;
    block: number;
    live: boolean;
    seal: { seq: number; root: string } | null;
    note: string;
  };
}

export function StampStudio({ onVerify, onOpenBlock }: { onVerify: (h: string) => void; onOpenBlock?: (h: number) => void }) {
  const [content, setContent] = useState("");
  const [kind, setKind] = useState<(typeof KINDS)[number]>("text");
  const [by, setBy] = useState("headcorner");
  const [saltOn, setSaltOn] = useState(false);
  const [hash, setHash] = useState<string | null>(null);
  const [hashing, setHashing] = useState(false);
  const [stamping, setStamping] = useState(false);
  const [receipt, setReceipt] = useState<StampResponse | null>(null);
  const deb = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { data: stamps, refresh } = useStamps();

  useEffect(() => {
    if (deb.current) clearTimeout(deb.current);
    if (!content) {
      setHash(null);
      return;
    }
    setHashing(true);
    deb.current = setTimeout(() => {
      sha256Hex(content)
        .then(setHash)
        .finally(() => setHashing(false));
    }, 220);
    return () => {
      if (deb.current) clearTimeout(deb.current);
    };
  }, [content]);

  const over = content.length > MAX_LEN;

  const stamp = useCallback(async () => {
    if (!content || over || stamping) return;
    setStamping(true);
    setReceipt(null);
    try {
      const body: Record<string, unknown> = { content, kind, by: by || "headcorner" };
      if (saltOn) {
        const s = await sha256Hex(content + "::salt::" + Date.now() + "::" + Math.random());
        body.salt = s;
      }
      const res = await fetch("/api/weave/stamp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = (await res.json()) as StampResponse;
      setReceipt(j);
      if (j.ok && j.stamped) {
        toast({ title: "החותמת נטוות על הספר", description: `seq #${j.stamped.seq} · בלוק ${j.stamped.block}` });
        refresh();
      } else if (j.err === "exists") {
        toast({ title: "ה-hash כבר נטווה", description: "הקרנל מבטיח ייחוד — אין חותמת כפולה" });
      } else {
        toast({ title: "החותמת לא נקלטה", description: j.note || j.why || j.err || "נסה שוב בעוד רגע", variant: "destructive" });
      }
    } catch (e) {
      toast({ title: "הרשת לא ענתה", description: String((e as Error)?.message ?? e), variant: "destructive" });
    } finally {
      setStamping(false);
    }
  }, [content, over, stamping, kind, by, saltOn, refresh]);

  return (
    <div>
      <SectionHead
        eyebrow="STAMP STUDIO"
        title="סטודיו חותמות-קיום"
        icon={<Fingerprint className="size-3.5" />}
        desc="כתוב, ראה את ה-hash נולד מולך, וחתום על הספר. החותמת חיה מיד, נאטמת באצווה השעתית, ומעוגנת בציבור. 20 גז לחותמת."
      />

      <div className="grid lg:grid-cols-5 gap-4">
        {/* המחברת */}
        <Panel className="lg:col-span-3 flex flex-col gap-4">
          <div className="relative">
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={8}
              dir="auto"
              placeholder="כתוב כאן את מה שצריך להתקיים לנצח — הצהרה, עדות, קוד, רעיון…"
              className="w-full resize-none rounded-xl border border-input bg-muted/40 px-4 py-3.5 text-sm text-ink placeholder:text-ink-2/50 focus:outline-none focus:ring-2 focus:ring-gold/40 focus:border-gold/40 transition-all"
              aria-label="תוכן החותמת"
            />
            <span className={cn("absolute bottom-2.5 left-3 text-[10px] hash", over ? "text-broken" : "text-ink-2/60")} dir="ltr">
              {content.length}/{MAX_LEN}
            </span>
          </div>

          <div className="grid sm:grid-cols-3 gap-3">
            <label className="block">
              <span className="block text-[11px] text-ink-2 mb-1.5">סוג</span>
              <div className="flex gap-1.5 flex-wrap">
                {KINDS.map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setKind(k)}
                    className={cn(
                      "hash text-[11px] rounded-lg border px-2.5 py-1.5 transition-all",
                      kind === k ? "border-gold/50 bg-gold/10 text-gold" : "border-border text-ink-2 hover:text-ink hover:border-ink-2/40"
                    )}
                  >
                    {k}
                  </button>
                ))}
              </div>
            </label>
            <label className="block">
              <span className="block text-[11px] text-ink-2 mb-1.5">חותם-על (by)</span>
              <input
                value={by}
                onChange={(e) => setBy(e.target.value)}
                className="w-full hash rounded-lg border border-input bg-muted/40 px-3 py-2 text-xs text-ink focus:outline-none focus:ring-2 focus:ring-gold/40"
                dir="ltr"
                maxLength={24}
              />
            </label>
            <label className="flex items-end gap-2 cursor-pointer select-none">
              <input type="checkbox" checked={saltOn} onChange={(e) => setSaltOn(e.target.checked)} className="accent-[#e9a93e] size-4" />
              <span className="text-xs text-ink-2 leading-tight">
                מלח-סתרים
                <span className="block text-[10px] text-ink-2/60">הוכחה-לך-בלבד (salt)</span>
              </span>
            </label>
          </div>

          {/* ה-hash החי */}
          <div className="rounded-xl border border-gold/20 bg-gold/5 px-4 py-3.5">
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <span className="text-[11px] text-gold-dim hash uppercase tracking-widest">sha-256 · נולד בדפדפן שלך</span>
              {hashing && <Spinner className="size-3" />}
            </div>
            <div className="hash text-xs md:text-sm text-gold-soft break-all min-h-[1.2rem]" dir="ltr">
              {hash || <span className="text-ink-2/50">— התוכן ייגזר לגיבוב בזמן-אמת —</span>}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={!content || over || stamping || hashing}
              onClick={stamp}
              className={cn(
                "group relative inline-flex items-center gap-2.5 rounded-xl px-6 py-3 font-bold text-sm transition-all",
                "bg-gradient-to-b from-gold to-[#c98a2e] text-[#1a1206] shadow-[0_10px_30px_-10px_rgba(233,169,62,0.55)]",
                "hover:shadow-[0_14px_40px_-10px_rgba(233,169,62,0.7)] hover:-translate-y-0.5 active:translate-y-0",
                "disabled:opacity-40 disabled:pointer-events-none"
              )}
            >
              {stamping ? <Spinner className="size-4 text-[#1a1206]" /> : <StampIcon className="size-4" />}
              חתום על הספר
              <span className="hash text-[10px] opacity-70">20 gas</span>
            </button>
            {over && (
              <span className="text-xs text-broken flex items-center gap-1.5">
                <AlertTriangle className="size-3.5" /> התוכן חורג מ-{MAX_LEN} תווים
              </span>
            )}
            {content && !over && (
              <span className="text-[10px] text-ink-2/60">{content.length} תווים · 20 גז</span>
            )}
          </div>
        </Panel>

        {/* הקבלה */}
        <Panel className="lg:col-span-2 relative overflow-hidden">
          <AnimatePresence mode="wait">
            {receipt?.ok && receipt.stamped ? (
              <motion.div
                key={receipt.stamped.h}
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                className="relative flex flex-col gap-4"
              >
                {/* חותמת-שעווה */}
                <motion.div
                  initial={{ scale: 2.2, opacity: 0, rotate: -18 }}
                  animate={{ scale: 1, opacity: 1, rotate: -8 }}
                  transition={{ type: "spring", stiffness: 220, damping: 16 }}
                  className="absolute -top-2 -left-2 size-24 rounded-full border-[3px] border-gold/70 grid place-items-center bg-gold/10 backdrop-blur-[2px] pointer-events-none"
                >
                  <span className="text-center leading-none">
                    <span className="block hash text-[9px] text-gold">SEALED</span>
                    <span className="block font-display text-xl font-black text-gold">#{receipt.stamped.seq}</span>
                  </span>
                </motion.div>

                <div className="ps-20">
                  <div className="font-display text-xl font-bold text-verified flex items-center gap-2">
                    <ShieldCheck className="size-5" /> נטווה על הספר
                  </div>
                  <div className="text-xs text-ink-2 mt-1">הקרנל אישר — הקבלה מה-replay, לא מהבטחה</div>
                </div>

                <dl className="text-xs space-y-2.5 mt-1">
                  <Row k="hash"><HashText h={receipt.stamped.h} head={18} tail={12} className="text-gold-soft" /></Row>
                  <Row k="seq"><span className="hash text-ink">#{receipt.stamped.seq}</span></Row>
                  <Row k="בלוק">
                    {onOpenBlock ? (
                      <button
                        type="button"
                        onClick={() => onOpenBlock(receipt.stamped!.block)}
                        className="hash text-gold-soft hover:text-gold underline underline-offset-2 transition-colors inline-flex items-center gap-1"
                      >
                        {receipt.stamped.block} — פתח בפנקס ←
                      </button>
                    ) : (
                      <span className="hash text-ink">{receipt.stamped.block}</span>
                    )}
                  </Row>
                  <Row k="סוג"><span className="hash text-ink">{receipt.stamped.kind}</span></Row>
                  <Row k="by"><span className="hash text-ink">{receipt.stamped.by}</span></Row>
                  <Row k="מצב">
                    <span className={cn("inline-flex items-center gap-1.5", receipt.stamped.live ? "text-gold" : "text-verified")}>
                      <LiveDot tone={receipt.stamped.live ? "gold" : "green"} />
                      {receipt.stamped.live ? "חיה — תאוטם באצווה הבאה" : `מאוטמת ב-batch #${receipt.stamped.seal?.seq}`}
                    </span>
                  </Row>
                </dl>

                {/* מסע-החותמת: מהרגע הזה והלאה — בלי-מפלט, בלי-הבטחות */}
                <Journey live={receipt.stamped.live} sealSeq={receipt.stamped.seal?.seq ?? null} />

                <button
                  type="button"
                  onClick={() => onVerify(receipt.stamped!.h)}
                  className="mt-1 inline-flex items-center gap-2 rounded-lg border border-gold/30 bg-gold/10 px-4 py-2.5 text-xs font-bold text-gold hover:bg-gold/15 transition-colors"
                >
                  <ScrollText className="size-4" /> הצג את התעודה הציבורית
                </button>
              </motion.div>
            ) : receipt && !receipt.ok ? (
              <motion.div key="err" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col gap-3">
                <div className="font-display text-lg font-bold text-broken flex items-center gap-2">
                  <AlertTriangle className="size-5" /> לא נרשם
                </div>
                <div className="text-xs text-ink-2 leading-relaxed">
                  {receipt.err === "exists"
                    ? "ה-hash כבר נטווה — ייחוד הוא ערובה-קרנלית. חפש את התעודה שלו במקטע תעודות."
                    : (receipt.note || receipt.why || receipt.err || "הצומת סירב — שום-דבר לא נכתב.")}
                </div>
                {receipt.seq && <div className="text-xs text-ink-2">seq קיים: <span className="hash">#{receipt.seq}</span></div>}
              </motion.div>
            ) : (
              <motion.div key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="h-full grid place-items-center min-h-64">
                <div className="text-center text-ink-2/70">
                  <StampIcon className="size-10 mx-auto mb-3 opacity-40" />
                  <div className="text-sm font-medium">הקבלה תופיע כאן</div>
                  <div className="text-xs mt-1.5 max-w-56 mx-auto leading-relaxed">קבלה אמיתית מהקרנל: seq, גובה, ומצב-איטום</div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </Panel>
      </div>

      {/* החותמות האחרונות */}
      <div className="mt-8">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-display text-lg font-bold text-ink">החותמות על הספר</h3>
          {stamps?.ok && (
            <span className="text-xs text-ink-2">
              סך-הכל <span className="hash text-gold-soft">{stamps.total}</span> · {stamps.live} חיות
            </span>
          )}
        </div>
        {!stamps?.stamps?.length ? (
          <EmptyState title="עדיין אין חותמות — תהיה הראשון לנווט" sub="כל חותמת נכנסת לאצווה השעתית ומקבלת תעודה ציבורית" />
        ) : (
          <div className="space-y-2 max-h-96 overflow-y-auto pl-1">
            {stamps.stamps.map((s) => (
              <div key={s.h} className="panel px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
                <span className={cn("hash font-bold w-12", s.status === "sealed" ? "text-verified" : "text-gold")}>#{s.seq}</span>
                <span className="flex-1 min-w-36"><HashText h={s.h} head={14} tail={10} className="text-ink/90" /></span>
                <span className="hash text-ink-2/70">{s.kind}</span>
                <span className="text-ink-2/70">{s.at ? timeAgoHe(s.at) : "—"}</span>
                <span className={cn("inline-flex items-center gap-1.5", s.status === "sealed" ? "text-verified" : "text-gold")}>
                  <LiveDot tone={s.status === "sealed" ? "green" : "gold"} className="text-current" />
                  {s.status === "sealed" ? "מאוטמת" : "חיה"}
                </span>
                <button type="button" onClick={() => onVerify(s.h)} className="text-gold-dim hover:text-gold transition-colors underline underline-offset-2">
                  תעודה
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <dt className="text-ink-2/80 w-14 shrink-0 pt-0.5">{k}</dt>
      <dd className="min-w-0 flex-1">{children}</dd>
    </div>
  );
}

/* ── מסע-החותמת: הצעדים הבטוחים של החותמת שלך — עד עיגון-ציבורי ── */
function Journey({ live, sealSeq }: { live: boolean; sealSeq: number | null }) {
  const steps = [
    { t: "נרשמה", done: true, d: "על הספר — מה-replay, לא מהבטחה" },
    { t: "אצווה שעתית", done: true, d: "נכנסת לאריג השעה הקרובה" },
    { t: "איטום", done: !live, d: sealSeq ? `batch #${sealSeq} — שורש-מרקל חתום` : "באצווה השעתית הבאה" },
    { t: "עיגון ציבורי", done: !live && !!sealSeq, d: "Steem · Hive · TRON · Blurt — מיד אחרי האיטום" },
  ];
  return (
    <div className="rounded-xl border border-border bg-muted/25 px-3.5 py-3">
      <div className="text-[10px] text-gold-dim hash uppercase tracking-widest mb-2.5">מסע-החותמת</div>
      <ol className="flex items-start gap-1">
        {steps.map((s, i) => (
          <li key={s.t} className="flex-1 min-w-0 relative">
            <div className="flex items-center gap-1">
              <span
                className={cn(
                  "grid place-items-center size-5 rounded-full border text-[9px] font-black shrink-0",
                  s.done ? "border-verified/50 bg-verified/15 text-verified" : "border-border text-ink-2/60"
                )}
                aria-hidden
              >
                {s.done ? "✓" : i + 1}
              </span>
              {i < steps.length - 1 && (
                <span className={cn("h-px flex-1", s.done ? "bg-verified/40" : "bg-border")} aria-hidden />
              )}
            </div>
            <div className={cn("text-[10px] font-bold mt-1.5", s.done ? "text-ink" : "text-ink-2/60")}>{s.t}</div>
            <div className="text-[9.5px] text-ink-2/70 leading-snug pe-2">{s.d}</div>
          </li>
        ))}
      </ol>
    </div>
  );
}
