"use client";

/**
 * secret — חותמת-סוד (commit-reveal).
 *
 * ההבטחה החדה: הסוד לא עוזב את המכשיר. הדפדפן מזקק sha-256, על הספר יורד
 * רק ה-hash (POST {h} — השרת לא מקבל תוכן בכלל), והכספת חיה ב-localStorage
 * של המשתמש בלבד. מאוחר יותר — גילוי: ה-hash על הספר הוא העדות שהסוד היה
 * קיים באותו-רגע, בלי שמישהו (כולל אנחנו) ידע מה הוא.
 *
 * שימושים אמיתיים: קדימות-רעיון · התחייבות-גלויה · חיזוי · חשיפת-עוולה.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { KeyRound, Lock, Eye, EyeOff, ShieldCheck, Trash2, ScrollText, Stamp as StampIcon } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { Panel, SectionHead, HashText, Spinner, EmptyState, LiveDot } from "./primitives";
import { sha256Hex } from "@/lib/merkle-client";
import { fetchCertificate, timeAgoHe } from "@/hooks/use-weave";
import { cn } from "@/lib/utils";

const MAX_SECRET = 8192;
const VAULT_KEY = "loom-vault-v1";

interface VaultItem {
  h: string;
  secret: string;
  at: string; // זמן-החתימה המקומי
  seq: number | null;
  block: number | null;
  status: "live" | "sealed" | "unknown";
  sealSeq: number | null;
}

function loadVault(): VaultItem[] {
  try {
    const raw = localStorage.getItem(VAULT_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as VaultItem[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function saveVault(items: VaultItem[]) {
  try {
    localStorage.setItem(VAULT_KEY, JSON.stringify(items));
  } catch {
    /* פרטיות-מלאה גם בכשל-אחסון — אין-שליחה-לשרת */
  }
}

export function SecretStamp({ onVerify }: { onVerify: (h: string) => void }) {
  const [secret, setSecret] = useState("");
  const [by, setBy] = useState("headcorner");
  const [hash, setHash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [vault, setVault] = useState<VaultItem[]>([]);
  const deb = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setVault(loadVault());
  }, []);

  useEffect(() => {
    if (deb.current) clearTimeout(deb.current);
    if (!secret) {
      setHash(null);
      return;
    }
    deb.current = setTimeout(() => {
      sha256Hex(secret).then(setHash);
    }, 180);
    return () => {
      if (deb.current) clearTimeout(deb.current);
    };
  }, [secret]);

  const stamp = useCallback(async () => {
    if (!hash || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/weave/stamp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // ⚡ הנקודה-כולה: השרת מקבל h בלבד — התוכן נשאר במכשיר
        body: JSON.stringify({ h: hash, kind: "secret", by: by || "headcorner" }),
      });
      const j = await res.json();
      if (j.ok && j.stamped) {
        const item: VaultItem = {
          h: hash,
          secret,
          at: new Date().toISOString(),
          seq: j.stamped.seq,
          block: j.stamped.block,
          status: j.stamped.live ? "live" : "sealed",
          sealSeq: j.stamped.seal?.seq ?? null,
        };
        const next = [item, ...loadVault().filter((v) => v.h !== hash)];
        setVault(next);
        saveVault(next);
        setSecret("");
        setHash(null);
        toast({
          title: "הטביעה חתומה — הסוד שלך בלבד",
          description: `seq #${item.seq} · בלוק ${item.block} · על הספר ירד רק ה-hash`,
        });
      } else if (j.err === "exists") {
        toast({ title: "הטביעה כבר על הספר", description: "ייחוד הוא ערובה-קרנלית — הסוד הזה כבר חתום" });
      } else {
        toast({ title: "לא נרשם", description: j.note || j.why || j.err || "נסה שוב רגע", variant: "destructive" });
      }
    } catch (e) {
      toast({ title: "הרשת לא ענתה", description: String((e as Error)?.message ?? e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }, [hash, busy, by, secret]);

  const verifyOne = useCallback(async (h: string) => {
    const cert = await fetchCertificate(h);
    let status: VaultItem["status"] = "unknown";
    let sealSeq: number | null = null;
    if (cert?.certificate) {
      status = cert.certificate.status === "sealed" ? "sealed" : cert.certificate.status === "pending-seal" ? "live" : "unknown";
      sealSeq = cert.certificate.seal?.seq ?? null;
    }
    const next = loadVault().map((v) => (v.h === h ? { ...v, status, sealSeq } : v));
    setVault(next);
    saveVault(next);
    return status;
  }, []);

  const removeOne = (h: string) => {
    const next = loadVault().filter((v) => v.h !== h);
    setVault(next);
    saveVault(next);
  };

  const toggleReveal = (h: string) => {
    setRevealed((s) => {
      const n = new Set(s);
      if (n.has(h)) n.delete(h);
      else n.add(h);
      return n;
    });
  };

  const shown = secret;

  return (
    <div>
      <SectionHead
        eyebrow="SECRET STAMP · COMMIT-REVEAL"
        title="חותמת-סוד — חתום בלי לגלות"
        icon={<KeyRound className="size-3.5" />}
        desc="הסוד לא עוזב את המכשיר שלך. הדפדפן מזקק sha-256, ועל הספר הציבורי יורד רק ה-hash. מאוחר יותר — גלה את הסוד, והספר יעיד שהוא היה קיים בדיוק שם, באותו-רגע. שום-גורם — כולל אותנו — לא ראה כלום."
      />

      {/* שלושת-השימושים — הערך האמיתי */}
      <div className="grid sm:grid-cols-3 gap-3 mb-5">
        {[
          { t: "קדימות-רעיון", d: "רעיון, פטנט, מילה-בלד — חתום היום, גלה כשאתה מוכן, והשורש על Steem מעיד לנצח." },
          { t: "התחייבות-גלויה", d: "חיזוי, הצעה, מכרז — חתום על ההחלטה לפני שהיא ידועה, ותהיה מחויב ללא-מפלט." },
          { t: "חשיפת-עוולה", d: "התיעוד קיים עוד-היום על רשת-ציבורית — והזהות שלך נשארת שלך עד-שתחליט אחרת." },
        ].map((u) => (
          <div key={u.t} className="panel px-4 py-3.5">
            <div className="text-sm font-bold text-gold-soft mb-1">{u.t}</div>
            <div className="text-[11px] text-ink-2 leading-relaxed">{u.d}</div>
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-5 gap-4">
        {/* הכתיבה */}
        <Panel className="lg:col-span-3 flex flex-col gap-4">
          <div className="flex items-start gap-2.5 rounded-xl border border-verified/25 bg-verified/5 px-3.5 py-2.5">
            <Lock className="size-4 text-verified mt-0.5 shrink-0" />
            <span className="text-[11px] text-verified leading-relaxed">
              ערוץ-אפס-ידיעה: הבקשה לשרת מכילה hash בלבד (<span className="hash">POST {"{h}"}</span>) — התוכן נשאר בזיכרון הדפדפן ונשמר אצלך בכספת המקומית.
            </span>
          </div>

          <div className="relative">
            <textarea
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              rows={6}
              dir="auto"
              placeholder="כתוב כאן את הסוד — הצהרה, תחזית, רעיון, מסמך…"
              className="w-full resize-none rounded-xl border border-input bg-muted/40 px-4 py-3.5 text-sm text-ink placeholder:text-ink-2/50 focus:outline-none focus:ring-2 focus:ring-verified/40 focus:border-verified/40 transition-all"
              aria-label="הסוד"
            />
            <span className={cn("absolute bottom-2.5 left-3 text-[10px] hash", secret.length > MAX_SECRET ? "text-broken" : "text-ink-2/60")} dir="ltr">
              {secret.length}/{MAX_SECRET}
            </span>
          </div>

          <div className="rounded-xl border border-gold/20 bg-gold/5 px-4 py-3">
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <span className="text-[11px] text-gold-dim hash uppercase tracking-widest">sha-256 · הטביעה שתעלה לספר</span>
            </div>
            <div className="hash text-xs md:text-sm text-gold-soft break-all min-h-[1.2rem]" dir="ltr">
              {hash || <span className="text-ink-2/50">— הסוד ייגזר בזמן-אמת, מקומית —</span>}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={!hash || busy}
              onClick={stamp}
              className={cn(
                "inline-flex items-center gap-2.5 rounded-xl px-6 py-3 font-bold text-sm transition-all",
                "bg-gradient-to-b from-verified to-[#0e9668] text-[#04120c] shadow-[0_10px_30px_-10px_rgba(52,211,153,0.5)]",
                "hover:-translate-y-0.5 disabled:opacity-40 disabled:pointer-events-none"
              )}
            >
              {busy ? <Spinner className="size-4" /> : <StampIcon className="size-4" />}
              חתום את הטביעה
              <span className="hash text-[10px] opacity-70">20 gas</span>
            </button>
            <label className="flex items-center gap-2 text-[11px] text-ink-2">
              חותם-על
              <input
                value={by}
                onChange={(e) => setBy(e.target.value)}
                className="hash w-32 rounded-lg border border-input bg-muted/40 px-2.5 py-1.5 text-xs text-ink focus:outline-none focus:ring-2 focus:ring-gold/40"
                dir="ltr"
                maxLength={24}
              />
            </label>
          </div>
          {shown && <div className="text-[10px] text-ink-2/60">הסוד יישמר בכספת המקומית אחרי-החתימה — תוכל לחשוף אותו ולאמת כאן בעתיד.</div>}
        </Panel>

        {/* הכספת */}
        <Panel className="lg:col-span-2">
          <div className="flex items-center justify-between gap-2 mb-4">
            <div className="flex items-center gap-2 text-gold">
              <Lock className="size-4" />
              <span className="font-display font-bold">הכספת המקומית</span>
            </div>
            <span className="hash text-[10px] text-ink-2/60">{vault.length} סודות · מכשיר-זה</span>
          </div>

          {vault.length === 0 ? (
            <EmptyState title="הכספת ריקה" sub="חתום על הסוד הראשון — הרשימה תישמר רק כאן, במכשיר שלך" />
          ) : (
            <div className="space-y-2.5 max-h-[420px] overflow-y-auto pl-1">
              {vault.map((v) => {
                const open = revealed.has(v.h);
                return (
                  <motion.div key={v.h} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl border border-border bg-muted/25 px-3.5 py-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => toggleReveal(v.h)}
                        className="inline-flex items-center gap-1.5 text-[11px] text-gold hover:text-gold-soft transition-colors"
                        aria-label={open ? "הסתרת-הסוד" : "חשיפת-הסוד מקומית"}
                      >
                        {open ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                        {open ? "הסתר" : "חשוף"}
                      </button>
                      <span className={cn("inline-flex items-center gap-1.5 text-[10px]", v.status === "sealed" ? "text-verified" : v.status === "live" ? "text-gold" : "text-ink-2")}>
                        <LiveDot tone={v.status === "sealed" ? "green" : v.status === "live" ? "gold" : "gray"} className="text-current" />
                        {v.status === "sealed" ? `מאוטם · batch #${v.sealSeq}` : v.status === "live" ? "חי על הספר" : "לא נמצא"}
                      </span>
                      <span className="ms-auto text-[10px] text-ink-2/60">{timeAgoHe(v.at)}</span>
                    </div>

                    <div className="text-xs text-ink leading-snug">
                      {open ? (
                        <span className="whitespace-pre-wrap break-words">{v.secret.length > 200 ? v.secret.slice(0, 200) + "…" : v.secret}</span>
                      ) : (
                        <span className="hash text-ink-2/50" dir="ltr">••••••••••••••</span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <span className="min-w-0 flex-1"><HashText h={v.h} head={10} tail={6} className="text-[10px] text-gold-dim" /></span>
                      {v.seq != null && <span className="hash text-[10px] text-ink-2">#{v.seq}</span>}
                      <button type="button" onClick={() => verifyOne(v.h)} className="text-[10px] text-gold-dim hover:text-gold underline underline-offset-2">
                        אמת
                      </button>
                      <button type="button" onClick={() => onVerify(v.h)} className="text-[10px] text-gold-dim hover:text-gold underline underline-offset-2 inline-flex items-center gap-1">
                        <ScrollText className="size-3" /> תעודה
                      </button>
                      <button type="button" onClick={() => removeOne(v.h)} className="text-ink-2/50 hover:text-broken transition-colors" aria-label="מחיקה-מהכספת">
                        <Trash2 className="size-3" />
                      </button>
                    </div>

                    {v.status === "sealed" && (
                      <div className="flex items-center gap-1.5 text-[10px] text-verified">
                        <ShieldCheck className="size-3" /> הסוד הזה יכול להיחשף בכל-רגע — והספר יאשר בדיוק את-הטביעה הזאת
                      </div>
                    )}
                  </motion.div>
                );
              })}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
