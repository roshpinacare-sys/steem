"use client";

/**
 * loom — לב הנול: ויזואליזציית האריגה החיה.
 * חוטים (חותמות) → אריגה שעתית (מרקל) → איטום (seal) → עגינה (4 שרשראות).
 * הכל מהנתונים האמיתיים — בלי-נתונים יש כנות, לא פיקציה.
 */

import { motion } from "framer-motion";
import { Anchor, CheckCircle2, ChevronDown, Clock3, Hourglass, Fingerprint, Landmark, Waves } from "lucide-react";
import { Panel, HashText, Stat, LiveDot, SectionHead, EmptyState, Spinner, Tip, fmtClock } from "./primitives";
import {
  shortHash,
  timeAgoHe,
  useNextHourCountdown,
  type AnchorRecord,
  type WeaveStatus,
} from "@/hooks/use-weave";
import { cn } from "@/lib/utils";

/* ── ויזואליזציית מובייל — זרימה אנכית במקום SVG רחב ── */
function LoomVizMobile({
  liveStamps,
  cap,
  nextSeq,
  sealSeq,
  anchorTones,
}: {
  liveStamps: number;
  cap: number;
  nextSeq: number;
  sealSeq: number | null;
  anchorTones: ("green" | "gold" | "rose" | "gray")[];
}) {
  const chains: { k: string; tone: number }[] = [
    { k: "STEEM", tone: 0 },
    { k: "HIVE", tone: 1 },
    { k: "TRON", tone: 2 },
    { k: "BLURT", tone: 3 },
  ];
  return (
    <div className="flex flex-col gap-2.5 md:hidden" aria-label="זרימת האריגה">
      {[
        { icon: <Fingerprint className="size-4" />, t: "חותמות", v: `${liveStamps}/${cap} חיות` },
        { icon: <Waves className="size-4" />, t: "אריגה שעתית", v: `הבא בתור #${nextSeq}` },
        { icon: <Hourglass className="size-4" />, t: "איטום", v: sealSeq !== null ? `#${sealSeq} חתום` : "ממתין" },
      ].map((r) => (
        <div key={r.t} className="panel !px-4 !py-3 flex items-center gap-3">
          <span className="grid place-items-center size-8 rounded-lg border border-gold/30 bg-gold/10 text-gold shrink-0">{r.icon}</span>
          <span className="text-sm font-bold text-ink">{r.t}</span>
          <span className="ms-auto hash text-xs text-gold-soft">{r.v}</span>
        </div>
      ))}
      <div className="panel !px-4 !py-3 flex items-center gap-3 flex-wrap">
        <span className="grid place-items-center size-8 rounded-lg border border-gold/30 bg-gold/10 text-gold shrink-0"><Anchor className="size-4" /></span>
        <span className="text-sm font-bold text-ink">עגינה ציבורית</span>
        <span className="ms-auto flex items-center gap-1.5">
          {chains.map((c) => {
            const tone = anchorTones[c.tone] || "gray";
            return (
              <span key={c.k} className={cn("hash text-[9.5px] font-black px-1.5 py-0.5 rounded border", tone === "green" ? "text-verified border-verified/30 bg-verified/10" : tone === "gold" ? "text-gold border-gold/30 bg-gold/10" : "text-ink-2/60 border-border")}>
                {c.k}
              </span>
            );
          })}
        </span>
      </div>
    </div>
  );
}

/* ── הוויזואליזציה ── */
function LoomViz({
  liveStamps,
  nextSeq,
  sealSeq,
  cpProgress,
  anchorTones,
}: {
  liveStamps: number;
  nextSeq: number;
  sealSeq: number | null;
  cpProgress: number;
  anchorTones: ("green" | "gold" | "rose" | "gray")[];
}) {
  const threads = Array.from({ length: 10 }, (_, i) => i);
  const threadY = (i: number) => 52 + i * ((236 - 52) / (threads.length - 1));

  return (
    <svg viewBox="0 0 1200 330" className="w-full h-auto select-none" role="img" aria-label="זרימת האריגה: חותמות, אריגה שעתית, איטום, עגינה">
      <defs>
        <linearGradient id="goldGrad" x1="1" y1="0" x2="0" y2="0">
          <stop offset="0" stopColor="#f5c15c" />
          <stop offset="1" stopColor="#e9a93e" stopOpacity="0.55" />
        </linearGradient>
        <radialGradient id="braidGlow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#e9a93e" stopOpacity="0.22" />
          <stop offset="1" stopColor="#e9a93e" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="sealGlow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#f5c15c" stopOpacity="0.2" />
          <stop offset="1" stopColor="#f5c15c" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* רשת-רקע עדינה */}
      {Array.from({ length: 12 }, (_, i) => (
        <line key={"gv" + i} x1={90 + i * 90} y1={20} x2={90 + i * 90} y2={310} stroke="#2a2314" strokeWidth="0.5" opacity="0.35" />
      ))}
      {Array.from({ length: 4 }, (_, i) => (
        <line key={"gh" + i} x1={40} y1={60 + i * 72} x2={1160} y2={60 + i * 72} stroke="#2a2314" strokeWidth="0.5" opacity="0.35" />
      ))}

      {/* חוטי-חותמות — נכנסים מימין אל האריגה */}
      {threads.map((i) => (
        <path
          key={"t" + i}
          d={`M 1185 ${threadY(i)} C 1020 ${threadY(i)}, 950 170, 822 170`}
          fill="none"
          stroke="url(#goldGrad)"
          strokeWidth={i % 3 === 0 ? 2 : 1.2}
          className="thread"
          opacity={0.35 + 0.4 * (1 - i / threads.length)}
        />
      ))}

      {/* כותרות-מקטעים */}
      <text x={1105} y={40} textAnchor="middle" fill="#a39678" fontSize="17" className="font-display">חותמות</text>
      <text x={740} y={40} textAnchor="middle" fill="#a39678" fontSize="17" className="font-display">אריגה שעתית</text>
      <text x={450} y={40} textAnchor="middle" fill="#a39678" fontSize="17" className="font-display">איטום</text>
      <text x={150} y={40} textAnchor="middle" fill="#a39678" fontSize="17" className="font-display">עגינה</text>

      {/* מספרי-חיים תחתית */}
      <text x={1105} y={300} textAnchor="middle" fill="#f5c15c" fontSize="20" fontWeight="700" className="hash" direction="ltr">
        {liveStamps}/1024
      </text>
      <text x={740} y={300} textAnchor="middle" fill="#f5c15c" fontSize="20" fontWeight="700" className="hash" direction="ltr">
        #{nextSeq}
      </text>
      <text x={450} y={300} textAnchor="middle" fill="#f5c15c" fontSize="20" fontWeight="700" className="hash" direction="ltr">
        {sealSeq !== null ? `#${sealSeq}` : "—"}
      </text>

      {/* האריגה — טבעת מרקל מסתובבת */}
      <circle cx={740} cy={170} r={105} fill="url(#braidGlow)" />
      <g className="loom-rotate" style={{ transformOrigin: "740px 170px" }}>
        <circle cx={740} cy={170} r={78} fill="none" stroke="#e9a93e" strokeWidth="1.6" strokeDasharray="4 9" opacity="0.85" />
        <circle cx={740} cy={170} r={60} fill="none" stroke="#e9a93e" strokeWidth="1.1" strokeDasharray="2 11" opacity="0.6" />
        <circle cx={740} cy={170} r={44} fill="none" stroke="#f5c15c" strokeWidth="1" strokeDasharray="12 6" opacity="0.45" />
      </g>
      <circle cx={740} cy={170} r={26} fill="#13100a" stroke="#e9a93e" strokeWidth="1.6" />
      <circle cx={740} cy={170} r={9} fill="none" stroke="#f5c15c" strokeWidth="1.4" className="loom-rotate" style={{ transformOrigin: "740px 170px" }} />
      <circle cx={740} cy={170} r={2.6} fill="#f5c15c" />

      {/* מהאריגה אל האיטום */}
      <path d="M 662 170 C 610 170, 560 170, 512 170" fill="none" stroke="#e9a93e" strokeWidth="2.2" className="thread" />

      {/* האיטום — משושה-חותמת */}
      <circle cx={450} cy={170} r={78} fill="url(#sealGlow)" />
      <g>
        <polygon
          points="450,116 492,140 492,196 450,220 408,196 408,140"
          fill="#13100a"
          stroke="#e9a93e"
          strokeWidth="2"
        />
        <polygon
          points="450,130 481,148 481,188 450,206 419,188 419,148"
          fill="none"
          stroke="#e9a93e"
          strokeWidth="0.9"
          opacity="0.5"
        />
        <text x={450} y={164} textAnchor="middle" fill="#f5c15c" fontSize="13" fontWeight="700" className="hash" direction="ltr">
          SEAL
        </text>
        <text x={450} y={184} textAnchor="middle" fill="#e9a93e" fontSize="15" fontWeight="700" className="hash" direction="ltr">
          {sealSeq !== null ? "#" + sealSeq : "—"}
        </text>
      </g>

      {/* מהאיטום אל העגינה — ארבעה עוגנים */}
      {[86, 142, 198, 254].map((y, i) => (
        <path
          key={"a" + i}
          d={`M 400 170 C 330 170, 260 ${y}, 196 ${y}`}
          fill="none"
          stroke="#e9a93e"
          strokeWidth="1.3"
          className="thread"
          opacity="0.55"
        />
      ))}
      {[
        { y: 86, label: "STEEM" },
        { y: 142, label: "HIVE" },
        { y: 198, label: "TRON" },
        { y: 254, label: "BLURT" },
      ].map((a, i) => {
        const tone = anchorTones[i] || "gray";
        const color = tone === "green" ? "#34d399" : tone === "gold" ? "#e9a93e" : tone === "rose" ? "#fb7185" : "#6b6152";
        return (
          <g key={a.label}>
            <circle cx={170} cy={a.y} r={7} fill="#0a0907" stroke={color} strokeWidth="2" />
            {tone === "green" && <circle cx={170} cy={a.y} r={3} fill={color} />}
            {tone === "gold" && <circle cx={170} cy={a.y} r={3.4} fill="none" stroke={color} strokeWidth="1.4" className="loom-rotate" style={{ transformOrigin: `170px ${a.y}px` }} />}
            <text x={148} y={a.y + 4} textAnchor="end" fill={color} fontSize="13" fontWeight="700" className="hash" direction="ltr">
              {a.label}
            </text>
          </g>
        );
      })}

      {/* טבעת-צ'קפוינט סביב האיטום */}
      <circle cx={450} cy={170} r={95} fill="none" stroke="#2a2314" strokeWidth="3" />
      <circle
        cx={450}
        cy={170}
        r={95}
        fill="none"
        stroke="#34d399"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray={2 * Math.PI * 95}
        strokeDashoffset={2 * Math.PI * 95 * (1 - cpProgress)}
        transform="rotate(-90 450 170)"
        opacity="0.8"
        style={{ transition: "stroke-dashoffset 0.8s ease" }}
      />
      <text x={450} y={92} textAnchor="middle" fill="#34d399" fontSize="12" className="hash" direction="ltr">
        CP {Math.round(cpProgress * 12)}/12
      </text>
    </svg>
  );
}

/* ── כרטיס-עגין ── */
function AnchorCard({ name, rec, chainKey }: { name: string; rec: AnchorRecord | null; chainKey: string }) {
  const txid = rec?.txids?.[chainKey as "steem" | "hive" | "blurt"] || null;
  const tron = chainKey === "tron" ? rec?.tron : null;
  const state: { tone: "green" | "gold" | "rose" | "gray"; text: string } = txid
    ? { tone: "green", text: "מעוגן" }
    : tron
      ? { tone: "gold", text: "בדרך (טרנזיטיבי)" }
      : { tone: "gray", text: "ממתין" };

  const link =
    txid && chainKey === "steem"
      ? `https://steemscan.com/tx/${txid}`
      : txid && chainKey === "hive"
        ? `https://hiveblocks.com/tx/${txid}`
        : txid && chainKey === "blurt"
          ? `https://blurtblockexplorer.com/tx/${txid}`
          : null;

  return (
    <div className="panel p-4 flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="hash text-xs font-bold text-ink tracking-wider">{name}</span>
        <span className={cn("flex items-center gap-1.5 text-[11px]", state.tone === "green" ? "text-verified" : state.tone === "gold" ? "text-gold" : "text-ink-2")}>
          <LiveDot tone={state.tone === "gray" ? "gray" : state.tone} className={state.tone === "gray" ? "" : "text-current"} />
          {state.text}
        </span>
      </div>
      {txid ? (
        <a href={link || "#"} target="_blank" rel="noopener noreferrer" className="block group">
          <HashText h={txid} head={14} tail={10} className="text-gold-soft group-hover:text-gold transition-colors" />
          <span className="block text-[10px] text-gold-dim mt-1 underline underline-offset-2 decoration-gold-dim/40">צפייה בשרשרת הציבורית ↗</span>
        </a>
      ) : tron?.note ? (
        <span className="text-[11px] text-ink-2 leading-relaxed">{tron.note}</span>
      ) : (
        <span className="text-[11px] text-ink-2">העוגן יירשם בפעימת-העיגון הבאה — כנות, לא תיאטרון.</span>
      )}
      {rec?.at && <span className="text-[10px] text-ink-2/70">{timeAgoHe(rec.at)}</span>}
    </div>
  );
}

/* ── הגיבור ── */
export function LoomHero({
  status,
  loading,
  onStamp,
  onForge,
  onIntegrity,
  onOpenBlock,
}: {
  status: WeaveStatus | null;
  loading: boolean;
  onStamp?: () => void;
  onForge?: () => void;
  onIntegrity?: () => void;
  onOpenBlock?: (h: number) => void;
}) {
  const cd = useNextHourCountdown();
  const chain = status?.chain;
  const w = status?.weave;
  const sealSeq = w?.lastSeal?.seq ?? null;

  // טוני-עגינה לוויזואליזציה — מהרישום-האחרון
  const detail = status?.anchorsRegistry?.detail || {};
  const latest = Object.values(detail as Record<string, AnchorRecord>).sort((a, b) => (b.seq ?? 0) - (a.seq ?? 0))[0] || null;
  const anchorTones: ("green" | "gold" | "rose" | "gray")[] = [
    latest?.txids?.steem ? "green" : "gold",
    latest?.txids?.hive ? "green" : "gold",
    latest?.tron ? "gold" : "gray",
    latest?.txids?.blurt ? "green" : "gray",
  ];

  if (loading && !status) {
    return (
      <div className="panel panel-glow p-10 grid place-items-center min-h-[340px]">
        <div className="flex flex-col items-center gap-3 text-ink-2">
          <Spinner className="size-6" />
          <span className="text-sm">פותח את הספר הריבוני…</span>
        </div>
      </div>
    );
  }

  if (!status?.ok || !chain) {
    return (
      <Panel className="min-h-[240px]">
        <EmptyState
          title="הספר אינו זמין כרגע — כנות, לא הבטחה"
          sub={status?.why ? "סיבה: " + status.why : "הצומת או הקרנל אינם נגישים מהקונסולה"}
        />
      </Panel>
    );
  }

  const live = w?.liveStamps ?? 0;
  const cap = w?.cap ?? 1024;
  const pressure = Math.min(100, Math.round((live / (w?.pressureSealAt ?? 768)) * 100));

  return (
    <div className="space-y-6">
      {/* כותרת-הרשת */}
      <div className="text-center pt-2">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
          <div className="inline-flex items-center gap-2 text-[11px] text-gold-dim hash uppercase tracking-[0.3em] mb-3">
            <LiveDot tone="green" /> האריגה חיה
          </div>
          <h1 className="font-display text-4xl md:text-6xl font-black text-ink leading-tight">
            רשת-האמת <span className="text-gold root-glow">הציבורית</span>
          </h1>
          {/* המשפט האחד — מה זה, בעברית פשוטה, לפני הג'רגון */}
          <p className="mt-3 text-base md:text-lg text-ink font-medium max-w-2xl mx-auto leading-relaxed">
            חותמים על קיום: כל טקסט, קובץ או רעיון מקבל טביעת-אצבע מתמטית על ספר ציבורי —
            וכל שעה הספר מעוגן ברשתות-בלוקים ציבוריות, כך שאי-אפשר לשנות או להכחיש אותו.
          </p>
          <p className="mt-2.5 text-xs md:text-sm text-ink-2 max-w-2xl mx-auto leading-relaxed">
            כל חותמת חוט. כל שעה — אריג לשורש-מרקל אחד. כל שורש נחתם מתמטית על הספר הריבוני, ומעוגן בציבור: <span className="hash text-gold-soft">Steem · Hive · TRON · Blurt</span>. מי שלא סומך עלינו — מוזמן לאמת בעצמו.
          </p>
          {/* שלושת-הצעדים — המפה לזר */}
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-[11px] text-ink-2">
            {[
              { n: "1", t: "חותמים — sha-256 בדפדפן שלך" },
              { n: "2", t: "כל שעה — אריג ואיטום לשורש אחד על הספר" },
              { n: "3", t: "עיגון ציבורי — ואימות עצמאי בלי לסמוך עלינו" },
            ].map((s) => (
              <span key={s.n} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/30 px-3 py-1">
                <span className="grid place-items-center size-4 rounded-full bg-gold/15 text-gold hash text-[9px] font-black">{s.n}</span>
                {s.t}
              </span>
            ))}
          </div>
          {(onStamp || onForge) && (
            <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
              {onStamp && (
                <button
                  type="button"
                  onClick={onStamp}
                  className="rounded-xl bg-gradient-to-b from-gold to-[#c98a2e] px-5 py-2.5 text-sm font-bold text-[#1a1206] shadow-[0_8px_24px_-10px_rgba(233,169,62,0.5)] hover:-translate-y-0.5 transition-all"
                >
                  חתום חותמת-קיום עכשיו
                </button>
              )}
              {onForge && (
                <button
                  type="button"
                  onClick={onForge}
                  className="rounded-xl border border-broken/40 bg-broken/5 px-5 py-2.5 text-sm font-bold text-broken hover:bg-broken/10 transition-all"
                >
                  או — נסה לזייף תעודה ⚔
                </button>
              )}
            </div>
          )}
        </motion.div>
      </div>

      {/* הוויזואליזציה — שולחן: SVG · נייד: זרימה אנכית */}
      <Panel glow className="overflow-hidden !p-2 md:!p-4">
        <div className="hidden md:block">
          <LoomViz
            liveStamps={live}
            nextSeq={w?.nextSeq ?? 1}
            sealSeq={sealSeq}
            cpProgress={chain.height ? ((chain.height % 12 || 12) / 12) : 0}
            anchorTones={anchorTones}
          />
        </div>
        <LoomVizMobile
          liveStamps={live}
          cap={cap}
          nextSeq={w?.nextSeq ?? 1}
          sealSeq={sealSeq}
          anchorTones={anchorTones}
        />
        <div className="flex items-center justify-center gap-2 pb-2 pt-1 text-[11px] text-ink-2">
          <Clock3 className="size-3.5 text-gold-dim" />
          <span>
            אצווה שעתית הבאה בעוד <span className="hash text-gold-soft">{String(cd.m).padStart(2, "0")}:{String(cd.s).padStart(2, "0")}</span> · שעון-האריגה
          </span>
        </div>
      </Panel>

      {/* שורש-המצב */}
      <Panel className="!p-5 md:!p-6">
        <div className="flex flex-col lg:flex-row lg:items-center gap-4">
          <div className="min-w-0 flex-1">
            <div className="text-[11px] text-gold-dim hash uppercase tracking-widest mb-2">state-root · השורש הריבוני החי</div>
            <div className="hash text-sm md:text-lg text-gold-soft root-glow break-all leading-relaxed" dir="ltr">
              <HashText h={chain.finalRoot} head={64} tail={0} copy />
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <Tip
              label={
                chain.integrity === true
                  ? "בדיקת-שלמות ירוקה — כל הצ'קפוינטים ההיסטוריים נסרקו ותואמו. כל שחזור מהג'נזיס מניב בדיוק את הספר הזה."
                  : "בדיקת-שלמות: סריקה חלקית בשל פער-היסטוריה מתועד (החלמת-ערב) — הספר עצמו תקין מהנקודה הראשונה הפגועה והלאה. הציר המלא: מערכת ← ציר-הצ'קפוינטים."
              }
            >
              <button
                type="button"
                onClick={onIntegrity}
                className={cn(
                  "flex items-center gap-2 rounded-full border px-3.5 py-2 text-xs font-bold transition-colors hover:bg-gold/10",
                  chain.integrity === true
                    ? "border-verified/30 bg-verified/5 text-verified"
                    : "border-gold/30 bg-gold/5 text-gold"
                )}
                aria-label="בדיקת-שלמות הספר — מעבר לציר-הצ'קפוינטים"
              >
                <CheckCircle2 className="size-4" />
                <span>
                  {chain.integrity === true
                    ? `הספר שלם · ${chain.checkpoints?.matched}/${chain.checkpoints?.checked} צ'קפוינטים`
                    : `אומתו ${chain.checkpoints?.matched}/${chain.checkpoints?.checked} צ'קפוינטים`}
                </span>
              </button>
            </Tip>
            {onOpenBlock && chain.height != null && (
              <button
                type="button"
                onClick={() => onOpenBlock(chain.height)}
                className="text-xs text-gold-dim hover:text-gold underline underline-offset-2"
              >
                פתח בלוק #{chain.height} בפנקס ←
              </button>
            )}
          </div>
        </div>
      </Panel>

      {/* מדדים */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Stat label="גובה הספר" value={<span className="hash">{chain.height}</span>} sub={chain.truncated ? `ארכיון-מלא · ${chain.blocksKept} בלוקים` : `${chain.blocksKept} בלוקים בחלון`} accent />
        <Stat label="חותמות חיות" value={<span className="hash">{live}<span className="text-ink-2 text-sm"> /{cap}</span></span>} sub={status?.pendingSealRequest ? "בקשת-איטום עומדת" : live > 0 ? "חיות על הספר — נכללות באיטום הבא" : `החלון התרוקן אחרי האיטום — הבא בתור #${w?.nextSeq ?? 1}`} />
        <Stat label="לחץ-איטום" value={`${pressure}%`} sub="איטום-על אוטומטי בהגיע 768 חיות" />
        <Stat label="סך חותמות" value={<span className="hash">{w?.totalStamps ?? 0}</span>} sub={`הבא בתור: #${w?.nextSeq ?? 1}`} />
        <Stat label="איטומים" value={<span className="hash">{w?.totalSeals ?? 0}</span>} sub={w?.lastSeal ? `אחרון #${w.lastSeal.seq} · ${timeAgoHe(w.lastSeal.at)}` : "טרם"} />
        <Stat label="עדויות" value={<span className="hash">{w?.totalWitness ?? 0}</span>} sub={`${w?.witnessTopics?.length ?? 0} נושאים`} />
      </div>

      {/* עגינה */}
      <div>
        <SectionHead eyebrow="ANCHORS" title="העגינה הציבורית" icon={<Anchor className="size-3.5" />} desc="שורש-האיטום יוצא מהספר הריבוני אל השרשראות הציבוריות — שם כל אדם יכול למצוא אותו, לנצח, בלי לסמוך עלינו. שורש-איטום אחד מרכיב את העוגנים של אותו אצווה." />
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          <AnchorCard name="STEEM" chainKey="steem" rec={latest} />
          <AnchorCard name="HIVE" chainKey="hive" rec={latest} />
          <AnchorCard name="TRON" chainKey="tron" rec={latest} />
          <AnchorCard name="BLURT" chainKey="blurt" rec={latest} />
        </div>
      </div>
    </div>
  );
}

/* ── קיר-העוגנים הציבורי — העדים שאי-אפשר לשקר להם ──
 * כל-שורש שנאטם יוצא אל השרשראות הציבוריות עם txid אמיתי.
 * כאן אפשר לפתוח את Steem/Hive/Blurt ולאמת בעצמך — בלי לסמוך על אף-שרת. */
export function AnchorsStrip({ status }: { status: WeaveStatus | null }) {
  const reg = (status?.anchorsRegistry?.detail || {}) as Record<string, AnchorRecord>;
  const nodeSeals = status?.nodeWeave?.seals || [];
  const records = Object.entries(reg)
    .map(([root, r]) => ({ root, ...r }))
    .sort((a, b) => (b.seq ?? 0) - (a.seq ?? 0) || new Date(b.at || 0).getTime() - new Date(a.at || 0).getTime());

  const chains = (r: AnchorRecord) => [
    { key: "STEEM", txid: r.txids?.steem || null, href: (t: string) => `https://steemscan.com/tx/${t}` },
    { key: "HIVE", txid: r.txids?.hive || null, href: (t: string) => `https://hiveblocks.com/tx/${t}` },
    { key: "BLURT", txid: r.txids?.blurt || null, href: (t: string) => `https://blurtblockexplorer.com/tx/${t}` },
  ];

  return (
    <div>
      <SectionHead
        eyebrow="PUBLIC ANCHORS"
        title="עוגנים-ציבוריים — העדים שאי-אפשר לשקר להם"
        icon={<Anchor className="size-3.5" />}
        desc="כל שורש-איטום חוצה את המערכת שלנו ונחרת על שרשראות ציבוריות שרצות שנים, עם מאות-צמתים עצמאיים. כדי להכחיש חותמת — צריך לשכנע את כולן לשקר בו-זמנית. פתחו את הקישורים ובדקו בעצמכם — זה הרעיון כולו."
      />

      {/* קו-החשבונות — עקבו-אחרי-העיגונים ישירות מהרשתות */}
      <div className="grid sm:grid-cols-2 gap-3 mb-5">
        <a href="https://steemworld.org/@headcorner" target="_blank" rel="noopener noreferrer" className="panel px-4 py-3.5 flex items-center gap-3 hover:border-gold/35 transition-colors group">
          <span className="hash text-xs font-black text-gold">STEEM</span>
          <span className="text-xs text-ink-2 flex-1">יומן-הפעולות הציבורי של @headcorner — custom_json saos.weave.v1</span>
          <span className="text-gold-dim text-xs group-hover:text-gold">↗</span>
        </a>
        <a href="https://hiveblocks.com/@headcorner" target="_blank" rel="noopener noreferrer" className="panel px-4 py-3.5 flex items-center gap-3 hover:border-gold/35 transition-colors group">
          <span className="hash text-xs font-black text-gold">HIVE</span>
          <span className="text-xs text-ink-2 flex-1">היסטוריית-החשבון הציבורית — כל-עיגון מתועד לנצח</span>
          <span className="text-gold-dim text-xs group-hover:text-gold">↗</span>
        </a>
      </div>

      {records.length === 0 ? (
        <EmptyState
          title="טרם נרשמו עוגנים בסביבה זו"
          sub="העיגון מתרחש בפעימת-המארח החיה — הרישומים יופיעו כאן עם txid אמיתי, בלי תיאטרון"
        />
      ) : (
        <div className="space-y-3 max-h-[560px] overflow-y-auto pl-1">
          {records.map((r) => {
            const seq = nodeSeals.find((n) => String(n.root) === String(r.root))?.seq ?? r.seq ?? null;
            const txCount = chains(r).filter((c) => c.txid).length;
            return (
              <motion.div key={r.root} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="panel px-4 py-4 space-y-3">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                  <span className="hash text-gold font-bold text-lg w-12">#{seq ?? "—"}</span>
                  <span className="flex-1 min-w-40"><HashText h={r.root} head={16} tail={12} className="text-gold-soft text-xs" /></span>
                  <span className="text-[11px] text-ink-2">{txCount > 0 ? `${txCount} txid ציבוריים` : "ממתין לפעימת-עיגון"} · {timeAgoHe(r.at)}</span>
                </div>
                <div className="grid sm:grid-cols-3 gap-2">
                  {chains(r).map((c) => (
                    <div key={c.key} className="rounded-lg border border-border bg-muted/25 px-3 py-2.5">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="hash text-[10px] font-black text-ink tracking-wider">{c.key}</span>
                        {c.txid ? (
                          <LiveDot tone="green" className="text-verified" />
                        ) : (
                          <span className="text-[9.5px] text-ink-2/60">ממתין</span>
                        )}
                      </div>
                      {c.txid ? (
                        <a href={c.href(c.txid)} target="_blank" rel="noopener noreferrer" className="block group/tx">
                          <HashText h={c.txid} head={12} tail={8} copy={false} className="text-verified group-hover/tx:text-verified/90 transition-colors" />
                          <span className="block text-[9.5px] text-gold-dim mt-0.5 underline underline-offset-2">פתח על השרשרת ↗</span>
                        </a>
                      ) : (
                        <span className="text-[10px] text-ink-2/70">{r.dry ? "מארח-ללא-WIF — כנות" : "בפעימה-הבאה"}</span>
                      )}
                    </div>
                  ))}
                </div>
                {r.tron?.note && (
                  <div className="text-[10.5px] text-ink-2/70 leading-relaxed">TRON: {r.tron.note}</div>
                )}
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── ציר-האיטומים ── */
export function SealsTimeline({ status, onOpenBlock }: { status: WeaveStatus | null; onOpenBlock?: (h: number) => void }) {
  const seals = status?.weave?.seals || [];
  const nodeSeals = status?.nodeWeave?.seals || [];
  const heightOf = (root: string) => nodeSeals.find((n) => n.root === root)?.height ?? null;

  return (
    <div>
      <SectionHead eyebrow="SEALS" title="ציר-האיטומים" icon={<Hourglass className="size-3.5" />} desc="כל איטום — שורש-מרקל קנוני של כל העלים מאז-האיטום הקודם, חתום על הספר ונישא בתוך stateRoot של הצ'קפוינט." />
      {seals.length === 0 ? (
        <EmptyState title="טרם נחתם איטום — הנול ממתין לחוטים הראשונים" />
      ) : (
        <div className="space-y-3 max-h-96 overflow-y-auto pl-1">
          {[...seals].reverse().map((s) => {
            const h = heightOf(s.root);
            const body = (
              <>
                <span className="hash text-gold font-bold text-lg w-14">#{s.seq}</span>
                <div className="flex-1 min-w-40">
                  <HashText h={s.root} head={16} tail={12} className="text-gold-soft text-xs" />
                </div>
                <span className="text-xs text-ink-2">
                  <span className="hash text-ink">{s.count}</span> עלים · seq <span className="hash">{s.from}–{s.to}</span>
                </span>
                <span className="text-[11px] text-ink-2/80">{h ? `בלוק ${h}` : "גובה ברישום-הצומת"} · {timeAgoHe(s.at)}</span>
                {onOpenBlock && h != null && <ChevronDown className="size-4 text-gold-dim" aria-hidden />}
              </>
            );
            const cls = "panel px-4 py-3.5 flex flex-wrap items-center gap-x-5 gap-y-2 w-full text-right" + (onOpenBlock && h != null ? " hover:border-gold/30 hover:bg-gold/[0.03] transition-all group focus-visible:outline-2 focus-visible:outline-gold" : "");
            return onOpenBlock && h != null ? (
              <motion.button
                key={s.root}
                type="button"
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                onClick={() => onOpenBlock(h)}
                aria-label={`פתח את בלוק-האיטום #${h} בפנקס`}
                className={cls}
              >
                {body}
              </motion.button>
            ) : (
              <motion.div
                key={s.root}
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                className={cls}
              >
                {body}
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── שורה-תחתונה של תעודת-הבאצ'ר האחרונה ── */
const MODE_LABEL: Record<string, string> = {
  auto: "אוטומטי",
  hourly: "שעון-האריגה",
  pressure: "איטום-לחץ",
  manual: "ידני",
  dry: "ללא-WIF (כנות)",
};

export function BatcherReceipt({ status }: { status: WeaveStatus | null }) {
  const b = status?.batcher;
  if (!b) return null;
  const modeLabel = MODE_LABEL[String(b.mode || "").toLowerCase()] || String(b.mode);
  return (
    <Panel className="!p-5">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs">
        <span className="flex items-center gap-2 text-gold-dim">
          <span className="hash uppercase tracking-widest">BATCHER</span>
        </span>
        <span className="text-ink-2">דיווח אחרון: {fmtClock(b.at)} · {timeAgoHe(b.at)}</span>
        <Tip label={`מצב-הבאצ'ר בפעימה האחרונה (${b.mode})`}
        >
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2.5 py-0.5">
            <span className="text-ink-2/70">מצב:</span>
            <span className="hash text-ink">{modeLabel}</span>
          </span>
        </Tip>
        {(b.notes || []).slice(0, 2).map((n, i) => (
          <span key={i} className="text-ink-2/80 truncate max-w-md" title={n}>{shortHash(n, 24, 0)}</span>
        ))}
      </div>
    </Panel>
  );
}
