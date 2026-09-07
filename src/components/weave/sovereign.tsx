"use client";

/**
 * sovereign — ריבונות (102): המקטע-החמישי של הנול — אמת-שוק מעוגנת-מול-המציאות.
 *
 * SAOS-NET במלוא-עוצמתה על הקנבס-השחור-החם:
 *  · מדדי-השרשרת הריבונית (גובה · אספקה · פעימות · מנוע-הגריד)
 *  · המטבעות-העטופים — כיסוי-חי + ציטוט-אורקל-חתום (nano→USD · גיל-ציטוט · שווי-מונפק)
 *  · צמדי-הדקס — יחס-בריכה מול-יחס-האורקל: סטייה-חיה-מדודה (אפס-מחירים-מנותקים)
 *  · שווי-ורווחיות — מה-בעל-ערך ומה-מפיק-ערך: הכל-מדוד-מהספר, אפס-המצאות
 *  · זירת-GRID-98 · עוגנים-תלת-שרשרתיים · גשר-Tron
 *  · הסינתטיקה-הרדומים (WBTC/WETH/WXRP/WDOGE) — עדות-פיוס-יחידות-בכנות
 *
 * הכל-מ-/api/ops/saosnet (הצומת-הוא-הסמכות · ה-API מציג-בלבד · לעולם-לא 500).
 */

import { motion } from "framer-motion";
import { ArrowLeftRight, Boxes, Coins, DoorOpen, ExternalLink, Flame, KeyRound, ArrowDownToLine, Landmark, Network, Radio, Scale, ShieldCheck, Sprout, Swords, TriangleAlert, Users, Wallet, Activity, Cable, Copy, Check } from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Panel, SectionHead, Stat, HashText, LiveDot, EmptyState, fmtClock } from "./primitives";
import { useSaosEconomy, useRelayDoors, useTruthPath, useTronDex, useHarvest, useDexQuality, useWallets, useVault } from "@/hooks/use-weave";
import { useRoshpina } from "@/hooks/use-roshpina";
import { useSwap } from "@/hooks/use-swap";
import { useTheswap, type OnnetQuote } from "@/hooks/use-theswap";
import { cn } from "@/lib/utils";

type WrappedRow = { supply: number; locked: number; holders?: number };
type TronState = {
  address?: string | null;
  relay?: string | null;
  height?: number | null;
  at?: string | null;
  pulse?: { at?: string | null; tronHeight?: number; tronBlockId?: string } | null;
  lastAnchor?: { txid?: string | null; cpHeight?: number; tronBlock?: number; notedHeight?: number | null } | null;
  squad?: {
    members?: { address: string; balanceTrx?: number | null; activated?: boolean }[];
    activated?: number | null;
    ringsClosed?: number | null;
    lastRing?: { id?: number | null; legs?: number | null; zeroFee?: boolean | null; burnSun?: number | null; notedHeight?: number | null } | null;
    at?: string | null;
  } | null;
} | null;

/* 102 — הסינתטיקה-שיחידות-הבסיס-שלהם-היו יחידות-ביטחונות (STEEM) — פיוס-102 השבית-אותם.
 * הם לא-מוצגים-כמטבעות-צמודים: עדות-הפיוס מוצגת-במקום. */
const RETIRED = ["WBTC", "WETH", "WXRP", "WDOGE"];

const fmt = (n: number | null | undefined, d = 3) => (n === null || n === undefined ? "—" : Number(n).toFixed(d));

/* דולר-חכם: סקאלה-מלאה בלי-להסתיר-גדלים-קטנים ובלי-לנפח-גדולים */
const fmtUsd = (n: number | null | undefined) => {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const a = Math.abs(n);
  if (a >= 1000) return "$" + n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (a >= 1) return "$" + n.toFixed(2);
  if (a >= 0.0001) return "$" + Number(n.toPrecision(3));
  if (a === 0) return "$0";
  return "$" + Number(n.toPrecision(2)).toExponential(1).replace("e-", "e−");
};

/* גיל-ציטוט: כמה-זמן-מאז-שהמחיר-נמדד (ציטוט-ישן = זהוב, לא-מתחפש-לחי) */
const fmtAgoShort = (iso?: string | null) => {
  if (!iso) return null;
  const m = (Date.now() - new Date(iso).getTime()) / 6e4;
  if (!Number.isFinite(m)) return null;
  if (m < 90) return Math.max(1, Math.round(m)) + " ד׳";
  return (m / 60).toFixed(1) + " ש׳";
};

/* ציטוט-אורקל: px-על-הספר הוא nano-USD שלם (1e-9) — ההמרה-היחידה-הנכונה */
const pxToUsd = (px?: number | null) => (px && px > 0 ? px / 1e9 : null);

/* 117e — שורת-כתובת-קבלה-עם-העתקה-בקליק: המפעיל-שולח-אמת-אל-הנמל וצריך-להיות-וודאי.
 * ההעתקה-תמיד-מה-API-עצמו (לעולם-מהטקסט-המוצג) · תווית-תקינות-מהשרת (EIP-55 / ed25519) ·
 * ירוק-עמוק לראשיות-של-המשימה (ETH+SOL). */
function CopyAddrRow({ label, nets, addr, validLabel, primary }: { label: string; nets: string; addr: string; validLabel?: string | null; primary?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(addr);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (_) {
      /* clipboard-חסום — הכתובת-המלאה-ב-title לסימון-ידני */
    }
  }, [addr]);
  const ok = !!validLabel && validLabel.endsWith("✓");
  return (
    <div className={cn("flex items-center gap-2 rounded px-2 py-1.5 min-w-0", primary ? "bg-emerald/10 border border-emerald/20" : "bg-ink-2/20")}>
      <span className={cn("text-[10px] font-bold shrink-0", primary ? "text-emerald" : "text-ink")}>{label}</span>
      <span className={cn("hash text-[11px] truncate min-w-0 flex-1 text-ink", primary && "font-bold")} title={addr + " · " + nets}>
        {addr}
      </span>
      {validLabel ? (
        <span className={cn("hash text-[9px] px-1 rounded shrink-0 hidden sm:inline", ok ? "text-emerald bg-emerald/10" : "text-gold bg-gold/10")} title={nets}>
          {validLabel}
        </span>
      ) : null}
      <button
        onClick={copy}
        aria-label={"העתק כתובת " + label}
        className={cn(
          "shrink-0 rounded flex items-center justify-center transition-colors",
          "min-w-11 min-h-11 p-2 sm:min-w-0 sm:min-h-0 sm:p-1",
          copied ? "text-emerald bg-emerald/15" : "text-ink-2 hover:text-ink hover:bg-ink-2/30"
        )}
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </button>
      <span className={cn("text-[9px] shrink-0 w-9 transition-opacity", copied ? "text-emerald opacity-100" : "opacity-0")}>{copied ? "הועתק" : ""}</span>
    </div>
  );
}

/* 105 — כיסוי-חי במתמטיקת-הקרנל: coverBp = locked/supply (הביטחונות-ליחידה-המונפקת).
 * היחס-הקודם (supply/locked) היה הפוך — הציג מגובה-200%-כ-50% ומגובה-143%-כ-69% (דימום-חי).
 * ירוק ≥100% · זהוב "כמעט" ≥99% · רוז חסר · אפס-הנפקה מוצהר-בכנות. */
function CoverBar({ supply, locked }: { supply: number; locked: number }) {
  if (!(supply > 0)) {
    return (
      <div className="min-w-28">
        <div className="flex items-center justify-between text-[11px] mb-1">
          <span className="text-ink-2">כיסוי-חי</span>
          <span className="hash text-ink-2">אפס-הנפקה</span>
        </div>
      </div>
    );
  }
  const coverBp = Math.round((locked / supply) * 10000);
  const pct = Math.min(100, coverBp / 100);
  const tone = coverBp >= 10000 ? "emerald" : coverBp >= 9900 ? "gold" : "rose";
  return (
    <div className="min-w-28">
      <div className="flex items-center justify-between text-[11px] mb-1">
        <span className="text-ink-2">כיסוי-חי</span>
        <span
          className={cn(
            "hash font-bold",
            tone === "emerald" && "text-emerald",
            tone === "gold" && "text-gold",
            tone === "rose" && "text-rose"
          )}
        >
          {(coverBp / 100).toFixed(1)}%
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-white/5 overflow-hidden" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label={"כיסוי " + (coverBp / 100).toFixed(1) + "%"}>
        <div
          className={cn(
            "h-full rounded-full transition-all duration-700",
            tone === "emerald" && "bg-emerald",
            tone === "gold" && "bg-gold",
            tone === "rose" && "bg-rose"
          )}
          style={{ width: Math.min(100, pct) + "%" }}
        />
      </div>
    </div>
  );
}

/* שורת-מטבע-עטוף: ציטוט-אורקל-חתום (לא-מחיר-בריכה!) · גיל-ציטוט · שווי-מונפק-אמת */
function WrappedRowCard({ sym, w, meta, usd, priceAt, priceSrc }: { sym: string; w: WrappedRow; meta?: { chain?: string; decimals?: number } | null; usd: number | null; priceAt?: string | null; priceSrc?: string | null }) {
  const chain = meta?.chain ?? "—";
  const supplyUsd = usd !== null ? w.supply * usd : null;
  const age = fmtAgoShort(priceAt);
  const fresh = age !== null && (Date.now() - new Date(priceAt ?? "").getTime()) / 6e4 < 240;
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="panel px-4 py-3 flex flex-wrap items-center gap-x-5 gap-y-2"
    >
      <div className="w-24 shrink-0">
        <div className="hash font-bold text-ink">{sym}</div>
        <div className="text-[11px] text-ink-2">על {chain}</div>
      </div>
      <div className="text-sm">
        <span className="text-ink-2 text-[11px] block">היצע</span>
        <span className="metric-value text-ink font-bold">{fmt(w.supply)}</span>
      </div>
      <div className="text-sm">
        <span className="text-ink-2 text-[11px] block">נעולים</span>
        <span className="metric-value text-ink font-bold">{fmt(w.locked)}</span>
      </div>
      {usd !== null ? (
        <div className="text-sm">
          <span className="text-ink-2 text-[11px] block flex items-center gap-1">
            אורקל-חי
            {age ? <span className={cn("hash text-[10px]", fresh ? "text-emerald" : "text-gold")}>· לפני {age}</span> : null}
          </span>
          <span className="hash text-gold font-bold">{fmtUsd(usd)}</span>
          {priceSrc ? <span className="hash text-[9px] text-ink-2/60 block" dir="ltr">{priceSrc.split(":").slice(0, 2).join(":")}</span> : null}
        </div>
      ) : (
        <div className="text-sm">
          <span className="text-ink-2 text-[11px] block">אורקל</span>
          <span className="text-[11px] text-ink-2">אין-ציטוט-חתום — לא-מוצג-מחיר</span>
        </div>
      )}
      {supplyUsd !== null ? (
        <div className="text-sm">
          <span className="text-ink-2 text-[11px] block">שווי-מונפק</span>
          <span className="hash text-ink">{fmtUsd(supplyUsd)}</span>
        </div>
      ) : null}
      <div className="ms-auto">
        <CoverBar supply={w.supply} locked={w.locked} />
      </div>
    </motion.div>
  );
}

/* שורת-עוגן-שרשרת: txid אמיתי לחיץ */
function AnchorRow({ chain, txid, at, tone }: { chain: string; txid?: string | null; at?: string | null; tone: "gold" | "green" | "rose" | "gray" }) {
  const href = txid
    ? chain === "Blurt"
      ? `https://blurtwallet.com/tx/${txid}`
      : chain === "Steem"
        ? `https://steemit.com/tx/${txid}`
        : `https://hiveblocks.com/tx/${txid}`
    : null;
  return (
    <div className="flex items-center gap-2 sm:gap-3 py-2 border-b border-white/5 last:border-0 min-w-0">
      <span className="hash text-[11px] text-ink-2 w-11 sm:w-14 shrink-0">{chain}</span>
      <LiveDot tone={txid ? tone : "gray"} />
      {href ? (
        <a href={href} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate hover:text-gold transition-colors" dir="ltr">
          <HashText h={txid} head={10} tail={8} />
        </a>
      ) : (
        <span className="min-w-0 flex-1 truncate" dir="ltr">
          <HashText h={txid} head={10} tail={8} />
        </span>
      )}
      <span className="text-[11px] text-ink-2 shrink-0">{fmtClock(at)}</span>
    </div>
  );
}

/* ── 100 — לוח-האמת: מה-סגור-ומה-פתוח — מחושב-חי-מהצומת, לא-מההבטחה ── */
type TruthState = "closed" | "open" | "warn";
const AGE_H = (iso?: string | null) => (iso ? (Date.now() - new Date(iso).getTime()) / 3.6e6 : Infinity);
const TRUTH_META: Record<TruthState, { dot: "green" | "gold" | "rose"; label: string; cls: string }> = {
  closed: { dot: "green", label: "סגור", cls: "text-emerald" },
  open: { dot: "gold", label: "פתוח", cls: "text-gold" },
  warn: { dot: "rose", label: "דורש-טיפול", cls: "text-rose" },
};
function TruthRow({ state, what, detail }: { state: TruthState; what: string; detail: ReactNode }) {
  const m = TRUTH_META[state];
  return (
    <div className="flex items-start gap-3 py-2 border-b border-white/5 last:border-0">
      <span className={cn("hash text-[10px] font-bold px-1.5 py-0.5 rounded border shrink-0 mt-0.5", m.cls, "border-current/30 bg-current/5")}>{m.label}</span>
      <div className="min-w-0 text-[13px]">
        <span className="font-semibold text-ink">{what}</span>
        <span className="text-ink-2"> — {detail}</span>
      </div>
    </div>
  );
}

/* ── 102 — שורת-צמד: יחס-בריכה מול-יחס-אורקל — הסטייה-היא-האמת ── */
function PairRow({ pair, row, saosUsd }: { pair: string; row: { symA: string; a: number; b: number; ratio: number; impliedUsd: number | null; oracleUsd: number | null; devPct: number | null; tvlUsd: number; skeleton: boolean; priceAt?: string | null }; saosUsd: number | null }) {
  const dev = row.devPct;
  const ad = dev === null ? null : Math.abs(dev);
  const tone = row.skeleton ? "rose" : ad === null ? "gold" : ad <= 5 ? "green" : ad <= 25 ? "gold" : "rose";
  const label = row.skeleton ? "שלד" : ad === null ? "אין-אורקל" : ad <= 5 ? "מעוגן" : ad <= 25 ? "סוטה" : "מנותק";
  const age = fmtAgoShort(row.priceAt);
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="panel px-3.5 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5"
    >
      <div className="w-28 shrink-0">
        <div className="hash font-bold text-ink text-[13px]" dir="ltr">{pair}</div>
        <div className="text-[10px] text-ink-2">עומק {fmt(row.a)} / {fmt(row.b)}</div>
      </div>
      <div className="text-[13px]">
        <span className="text-ink-2 text-[10px] block">יחס-בריכה</span>
        <span className="hash text-ink font-bold">{fmt(row.ratio, 2)}</span>
        <span className="text-[10px] text-ink-2"> SAOS/{row.symA.replace("W", "")}</span>
      </div>
      {row.impliedUsd !== null ? (
        <div className="text-[13px]">
          <span className="text-ink-2 text-[10px] block">שווה-בדקס</span>
          <span className="hash text-ink">{fmtUsd(row.impliedUsd)}</span>
        </div>
      ) : null}
      {row.oracleUsd !== null ? (
        <div className="text-[13px]">
          <span className="text-ink-2 text-[10px] block flex items-center gap-1">
            אורקל-חי
            {age ? <span className={cn("hash text-[9px]", (Date.now() - new Date(row.priceAt ?? "").getTime()) / 6e4 < 240 ? "text-emerald" : "text-gold")}>· {age}</span> : null}
          </span>
          <span className="hash text-gold">{fmtUsd(row.oracleUsd)}</span>
        </div>
      ) : null}
      {dev !== null && !row.skeleton ? (
        <div className="text-[13px]">
          <span className="text-ink-2 text-[10px] block">סטייה</span>
          <span className={cn("hash font-bold", tone === "green" && "text-emerald", tone === "gold" && "text-gold", tone === "rose" && "text-rose")}>
            {dev > 0 ? "+" : ""}{dev.toFixed(1)}%
          </span>
        </div>
      ) : null}
      <div className="text-[13px] ms-auto flex items-center gap-3">
        <div>
          <span className="text-ink-2 text-[10px] block">TVL</span>
          <span className="hash text-ink">{fmtUsd(row.tvlUsd)}</span>
        </div>
        <span
          className={cn(
            "hash text-[10px] font-bold px-1.5 py-0.5 rounded border shrink-0",
            tone === "green" && "text-emerald border-emerald/30 bg-emerald/5",
            tone === "gold" && "text-gold border-gold/30 bg-gold/5",
            tone === "rose" && "text-rose border-rose/30 bg-rose/5"
          )}
        >
          {label}
        </span>
      </div>
    </motion.div>
  );
}

export function Sovereign() {
  const { data, loading } = useSaosEconomy();
  /* 107 — נתיב-האמת: התשובה-החיה ל"אותה רשת? למה-ספירות-שונות? מה-מגביל-אותנו" */
  const { data: tp } = useTruthPath();
  /* 108 — THE-DOOR: דבר-גורר-דבר — החוזה-החינם-שלנו מכריח טרנזקציות על רשתות-מרוחקות */
  const { data: rd } = useRelayDoors();
  /* 110 — THE-DEX: דקס-המפלצת — כיסוי-חי 1:1 · בריכת-WTRX/SAOS · התיישבות-טרון-אפס-עמלה · אימות-אח */
  const { data: dex } = useTronDex();
  /* 112 — בקרת-איכות הדקס: מעקב-איכותי אחרי הדברים שנבין */
  const { data: dexq } = useDexQuality();
  /* 111 — THE-HARVEST: קציר-האנרגיה — כל-זרימה-משאירה-עמלה → הכרה-על-הספר → גלגל-החוזר */
  const { data: hv } = useHarvest();
  /* 113 — THE-WALLETS: ארנקי-הצבא — זהות-כספית-רב-רשתית-מעוגנת לכל-סוכן */
  const { data: wl } = useWallets();
  /* 114 — THE-VAULT + THE-DEPOSITS: הכספת-המוצפנת · תיבת-ההפקדות (הנמל-פתוח לכל-הרשתות) */
  const { data: vt } = useVault();
  /* 116 — THE-BRIDGE: גשר-רושפינה — הקונסולה-הפרטית מדברת אל-השרשרת-הריבונית */
  const { data: rb } = useRoshpina();
  /* 117 — THE-SWAP: ניסוי-ההמרה TRX ⇄ ETH/SOL-אמת — הסקר-החי הכן */
  const { data: sw } = useSwap();
  /* 117c — THE-SWAP-ONNET: הבורסה-שלנו על הרשת-שלנו — בריכות-אפס-עמלה · עדות-גיבוי-חיה · סוואפים-אמת */
  const { data: ts, act: tsAct } = useTheswap();

  /* ── THE-SWAP-ONNET · מנוע-הסוואפ-האינטראקטיבי (מקומי-לגמרי — הקרנל הוא-המבצע) ── */
  const tsRoutes = useMemo(() => {
    const out: { pair: string; side: "A2B" | "B2A"; from: string; to: string; feeBps: number; scale: number; depthUsd: number | null }[] = [];
    for (const p of ts?.pools ?? []) {
      const sA = ts?.scales?.[p.symA] ?? 1000;
      const sB = ts?.scales?.[p.symB] ?? 1000;
      out.push({ pair: p.pair, side: "A2B", from: p.symA, to: p.symB, feeBps: p.feeBps, scale: sA, depthUsd: p.depthUsd });
      out.push({ pair: p.pair, side: "B2A", from: p.symB, to: p.symA, feeBps: p.feeBps, scale: sB, depthUsd: p.depthUsd });
    }
    out.sort((x, y) => (x.feeBps - y.feeBps) || ((y.depthUsd ?? 0) - (x.depthUsd ?? 0)));
    return out.slice(0, 10);
  }, [ts]);

  const [tsSel, setTsSel] = useState(0); // אינדקס-מסלול
  const [tsAmt, setTsAmt] = useState(""); // יחידות-אנוש
  const [tsQuote, setTsQuote] = useState<OnnetQuote | null>(null);
  const [tsBusy, setTsBusy] = useState(false);
  const [tsMsg, setTsMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [tsAttesting, setTsAttesting] = useState(false);
  const tsDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ברירת-מחדל: המסלול הראשון (בריכת-אפס-העמלה-העמוקה) — פעם-אחת כשהנתונים מגיעים */
  const tsInited = useRef(false);
  useEffect(() => {
    if (!tsInited.current && tsRoutes.length > 0) {
      tsInited.current = true;
      setTsSel(tsRoutes.findIndex((r) => r.feeBps === 0) >= 0 ? tsRoutes.findIndex((r) => r.feeBps === 0) : 0);
    }
  }, [tsRoutes]);

  const tsRoute = tsRoutes[tsSel] ?? null;
  const tsHouseBal = useMemo(() => {
    if (!ts?.house || !tsRoute) return null;
    if (tsRoute.from === "WTRX") return ts.house.WTRX;
    if (tsRoute.from === "WSTEEM") return ts.house.WSTEEM;
    if (tsRoute.from === "SAOS") return ts.house.saos;
    if (tsRoute.from === "STEEM") return ts.house.steem;
    return null;
  }, [ts, tsRoute]);

  /* ציטוט-חי בהקלדה (debounce 400ms) — אותו-חוזה כמו-הקרנל, יחידות-ספר */
  useEffect(() => {
    if (tsDebounce.current) clearTimeout(tsDebounce.current);
    const amt = parseFloat(tsAmt);
    if (!tsRoute || !(amt > 0)) { setTsQuote(null); return; }
    const units = Math.round(amt * tsRoute.scale);
    tsDebounce.current = setTimeout(async () => {
      const r = await tsAct({ action: "quote", pair: tsRoute.pair, side: tsRoute.side, in: units });
      setTsQuote(r.quote ?? null);
    }, 400);
    return () => { if (tsDebounce.current) clearTimeout(tsDebounce.current); };
  }, [tsAmt, tsRoute, tsAct]);

  const tsDoSwap = useCallback(async () => {
    if (!tsRoute || !tsQuote?.ok || !tsQuote.capOk || tsBusy) return;
    const amt = parseFloat(tsAmt);
    const units = Math.round(amt * tsRoute.scale);
    setTsBusy(true);
    setTsMsg(null);
    const r = await tsAct({ action: "swap", pair: tsRoute.pair, side: tsRoute.side, in: units, taker: "headcorner" });
    setTsBusy(false);
    setTsMsg(r.ok ? { ok: true, text: r.out?.includes("APPLIED") ? "בוצע-על-הספר ✓ (בלוק-חדש בשרשרת)" : "נשלח-לספר ✓" } : { ok: false, text: (r.out || r.err || "נכשל").slice(0, 160) });
  }, [tsRoute, tsQuote, tsAmt, tsBusy, tsAct]);

  const tsDoAttest = useCallback(async () => {
    if (tsAttesting) return;
    setTsAttesting(true);
    await tsAct({ action: "attest" });
    setTsAttesting(false);
  }, [tsAttesting, tsAct]);

  if (loading && !data) {
    return (
      <div>
        <SectionHead eyebrow="SOVEREIGN" title="ריבונות" desc="הרשת-הריבונית — מטבעות-עטופים, זירת-הגריד והעוגנים-התלת-שרשרתיים." icon={<Landmark className="size-3.5" />} />
        <Panel className="flex items-center gap-3 text-ink-2">
          טוען-את-מצב-הרשת…
        </Panel>
      </div>
    );
  }

  const node = data?.node ?? null;
  const t102 = data?.truth102 ?? null;
  const wrapped = (node?.wrapped ?? null) as Record<string, WrappedRow> | null;
  const meta = (node?.assetMeta ?? null) as Record<string, { chain?: string; decimals?: number; note?: string }> | null;
  const prices = (node?.assetPrices ?? null) as Record<string, { px?: number; unit?: string; at?: string | null; src?: string; ref?: string }> | null;
  const g98 = node?.grid98 ?? null;
  /* 103 — אמת-מנוע: פנקס-המנוע-החי (מקור-האמת) · הייצוא-של-saosnet רק-גיבוי */
  const eng = data?.engine ?? null;
  const fleet = data?.fleet ?? null;
  const engLive = eng != null && (eng.ageSec ?? 9e9) < 300; // טיק-אמור-כל-8ש' — 5 דק' = חי
  const tr = eng ?? g98;
  const trSource = eng != null ? "פנקס-מנוע-חי" : "ייצוא-צומת";
  const tron = (data?.tron ?? null) as TronState;
  const live = data?.liveAnchors ?? null;
  const saosUsd = t102?.market?.saosUsd ?? null;
  const steemUsd = t102?.market?.steemUsd ?? pxToUsd(prices?.WSTEEM?.px);
  const poolsX = t102?.poolsX ?? null;

  /* מיון-המטבעות: רק-האמיתיים (1:1-מדוד) — הסינתטיקה-הרדומים בעדות-נפרדת-מטה */
  const wRows = Object.entries(wrapped ?? {})
    .map(([sym, w]) => ({ sym, w }))
    .filter(({ sym, w }) => w && Number(w.supply) > 0 && !RETIRED.includes(sym))
    .sort((a, b) => b.w.supply - a.w.supply)
    .slice(0, 12);

  /* 105 — תחת-מגובה בסף-הקרנל: coverBp = locked/supply < 9900 (≈99%) · אפס-הנפקה אינו תחת-מגובה */
  const underBacked = wRows.filter(({ w }) => w.supply > 0 && w.locked / w.supply < 0.99).length;
  /* 103 — לוח-הובלה: מהמנוע-החי (pnlSAOS) עם-נורמליזציה-מהייצוא (pnlµ) */
  const board = ((eng?.leaderboard ?? (g98?.leaderboard ?? []) as any) as { name: string; pnlSAOS?: number; pnlµ?: number }[])
    .map((s) => ({ name: s.name, saos: s.pnlSAOS ?? (typeof s.pnlµ === "number" ? s.pnlµ / 1000 : 0) }));

  /* ── 102 — שווי-ורווחיות: הכל-מדוד-מהספר, אפס-המצאות ── */
  const realLocks = wRows
    .map(({ sym, w }) => {
      const usd = pxToUsd(prices?.[sym]?.px);
      return { sym, units: w.locked, usd: usd !== null ? w.locked * usd : null, ref: prices?.[sym]?.ref ?? null };
    })
    .filter((r) => r.units > 0);
  const locksTotal = realLocks.reduce((s, r) => s + (r.usd ?? 0), 0);
  const measured = t102?.measured ?? null;
  const liquidRows = measured
    ? [
        { sym: "STEEM", units: (measured.steem as number) ?? 0, usd: steemUsd ? ((measured.steem as number) ?? 0) * steemUsd : null },
        { sym: "SWAP.HIVE", units: (measured.swapHive as number) ?? 0, usd: pxToUsd(prices?.PHIVE?.px) !== null ? ((measured.swapHive as number) ?? 0) * (pxToUsd(prices?.PHIVE?.px) as number) : null },
        { sym: "HIVE", units: (measured.hive as number) ?? 0, usd: pxToUsd(prices?.PHIVE?.px) !== null ? ((measured.hive as number) ?? 0) * (pxToUsd(prices?.PHIVE?.px) as number) : null },
      ].filter((r) => r.units > 0)
    : [];
  const liquidTotal = liquidRows.reduce((s, r) => s + (r.usd ?? 0), 0);
  const beeUnpriced = measured ? (measured.bee as number) ?? 0 : 0;
  const pnlSAOS = tr?.treasuryPnlSAOS ?? null;
  const pnlUsd = pnlSAOS !== null && saosUsd !== null ? pnlSAOS * saosUsd : null;
  const pnlToday = tr?.treasuryPnlTodaySAOS ?? null;
  const floorPx = tr?.floor ?? null;
  const stepsCount = (tr?.steps ?? []).length;
  const extTotal = locksTotal + liquidTotal;

  /* 102 — צמדים: ממוינים — חיים-מעוגנים קודם, שלדים בסוף */
  const pairRows = Object.entries(poolsX ?? {})
    .map(([pair, row]) => ({ pair, row: row as NonNullable<NonNullable<typeof poolsX>[string]> }))
    .filter(({ row }) => row.a > 0 && row.b > 0)
    .sort((x, y) => {
      const sx = x.row.skeleton ? 1 : 0, sy = y.row.skeleton ? 1 : 0;
      if (sx !== sy) return sx - sy;
      return Math.abs(x.row.devPct ?? 999) - Math.abs(y.row.devPct ?? 999);
    });
  /* 105 — סף-אחיד: "מעוגן" = ירוק בשורה (≤5%) — הכותרת-והשורות מדברות-אותו-שפה */
  const anchoredCount = pairRows.filter(({ row }) => !row.skeleton && row.devPct !== null && Math.abs(row.devPct) <= 5).length;
  const tradeableCount = pairRows.filter(({ row }) => !row.skeleton).length;

  /* 100 — לוח-האמת: כל-שורה נגזרת-מהנתונים-החיים (הצומת-הוא-הסמכות) */
  const fmtAgo = (iso?: string | null) => {
    if (!iso) return "—";
    const m = (Date.now() - new Date(iso).getTime()) / 6e4;
    if (m < 90) return "לפני " + Math.max(1, Math.round(m)) + " ד׳";
    return "לפני " + (m / 60).toFixed(1) + " ש׳";
  };
  /* 105 — מקור-אחד-למושג: הבריכה בלוח-האמת נקראת מאותו-מקור-קרנלי כמו פאנל-הצמדים
   * (truth102.poolsX מ-snapshot-המצב) — לא מפנקס-המנוע (שני-מאמתים-דיברו-שתי-שפות). */
  const wblurtRow = (poolsX ?? {})["WBLURT/SAOS"] ?? null;
  const blurtTid = live?.anchorId?.txids?.blurt ?? live?.revive?.broadcast?.txid ?? live?.blurt99?.anchor?.txid ?? null;
  const blurtAt = live?.anchorId?.txids?.blurt ? live.anchorId.at : live?.revive?.broadcast?.txid ? live.revive.at : live?.blurt99?.at;
  const anchorAge = AGE_H(tron?.at ?? null);
  const pulseAge = AGE_H(tron?.pulse?.at ?? null);
  const blurtAge = AGE_H(blurtAt ?? null);
  const unitReconOk = !!(t102?.unitRecon?.allMatch && t102?.unitRecon?.retiredDormant);
  const retiredStillFat = RETIRED.some((sym) => (wrapped?.[sym]?.supply ?? 0) > 0.005);
  const poolAnchorOk = tradeableCount > 0 && anchoredCount === tradeableCount;

  return (
    <div>
      <SectionHead
        eyebrow="SOVEREIGN"
        title="ריבונות"
        desc="SAOS-NET — שרשרת-ריבונית משלנו עם מטבעות-עטופים מכל-השרשראות, זירת-מסחר-אוטונומית, ועוגנים-ציבוריים על Steem · Hive · Blurt · TRON. אפס-עמלות, מפתח-אחד."
        icon={<Landmark className="size-3.5" />}
      />

      {/* 107 — נתיב-האמת: יישור-הקו-לרשת — אותה-רשת? ספירות-מוצהרות? מה-מגביל-אותנו */}
      {tp?.verdict ? (
        <Panel className="mb-6">
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <Network className="size-4 text-gold" />
            <h3 className="font-display font-bold text-ink">נתיב-האמת — יישור-קו-לרשת</h3>
            <span
              className={cn(
                "ms-auto inline-flex items-center gap-1.5 text-[11px] hash px-2 py-0.5 rounded",
                tp.verdict.sameGenesis && tp.verdict.sameNetVersion ? "text-emerald bg-emerald/10" : "text-rose bg-rose/10"
              )}
            >
              <LiveDot tone={tp.verdict.sameGenesis && tp.verdict.sameNetVersion ? "green" : "rose"} />
              {tp.verdict.sameGenesis && tp.verdict.sameNetVersion ? "אותו-ג'נזיס · אותה-רשת" : "ג'נזיס-לא-זהה — נבדק"}
            </span>
          </div>

          {/* שני-הספרים זה-מול-זה */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mb-2.5">
            <div className={cn("rounded-lg border p-3", tp.verdict.canonical === "ours" ? "border-emerald/40 bg-emerald/[0.05]" : "border-ink/10 bg-ink-2/20")}>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-bold text-ink">הספר-שלנו (הקו-הקנוני)</span>
                {tp.verdict.canonical === "ours" ? <span className="hash text-[10px] text-emerald">קנוני</span> : null}
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink-2">
                <span>גובה <b className="text-ink font-mono">#{(tp.our?.height ?? 0).toLocaleString()}</b></span>
                <span>טרנזאקציות-ספר-מלא <b className="text-ink font-mono">{(tp.our?.bookTxTotal ?? 0).toLocaleString()}</b> (מדויק)</span>
                <span>צפיפות <b className="text-ink font-mono">{tp.our?.density ? tp.our.density.toFixed(2) : "—"}</b>/בלוק</span>
              </div>
            </div>
            <div className="rounded-lg border border-ink/10 bg-ink-2/20 p-3">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-bold text-ink">הספר-של-הסוכן-השני (מראה-חי)</span>
                <span className={cn("hash text-[10px]", tp.second?.ok ? "text-emerald" : "text-rose")}>
                  {tp.second?.ok ? `מראה-טרי ${tp.second.snapshotAgeSec != null ? tp.second.snapshotAgeSec + " שנ׳" : ""}` : "מראה-נפל"}
                </span>
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink-2">
                <span>גובה <b className="text-ink font-mono">#{(tp.second?.height ?? 0).toLocaleString()}</b></span>
                <span>מופע-נפרד מאותו-ג'נזיס</span>
                <span>יחס-גובה <b className="text-ink font-mono">×{tp.verdict.heightRatio ? tp.verdict.heightRatio.toFixed(1) : "—"}</b></span>
              </div>
            </div>
          </div>
          <p className="text-[11px] text-ink-2 leading-relaxed mb-1">{tp.verdict.answer}</p>
          <p className="text-[11px] text-ink-2 leading-relaxed">{tp.verdict.countsExplainer}</p>

          {/* המגבילים-החיים — כל-מגביל עם ראיה ופתרון */}
          {tp.limits && tp.limits.length > 0 ? (
            <div className="mt-3 space-y-1.5 max-h-72 overflow-y-auto pe-1">
              <div className="text-[11px] text-ink-2 flex items-center gap-1.5">
                <TriangleAlert className="size-3 text-gold" /> המגבילים — נגזרים-חי מהמצב-המדוד · כל-אחד-עם-הפתרון-שלו
              </div>
              {tp.limits.map((l) => (
                <div key={l.key} className="rounded-lg bg-ink-2/30 px-3 py-2 text-[11px] leading-relaxed">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={cn("hash text-[10px] px-1.5 rounded", l.severity === "rose" ? "text-rose bg-rose/10" : "text-gold bg-gold/10")}>
                      {l.severity === "rose" ? "דחוף" : "במסלול"}
                    </span>
                    <span className="font-semibold text-ink">{l.what}</span>
                  </div>
                  <div className="text-ink-2 mt-0.5">
                    ראיה: <span className="font-mono">{l.evidence}</span> · פתרון: <span className="text-emerald">{l.solution}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-emerald mt-2">אף-מגביל-חי-לא-נמדד-כרגע — אפס-דימומים</p>
          )}
        </Panel>
      ) : null}

      {/* 108 — THE-DOOR (דבר-גורר-דבר): שרשרת-הדלתות-החיה — חוזה-חינם-עלינו → רשת-מרוחקת → הוכחה-חזרה */}
      {rd?.ok ? (
        <Panel className="mb-6">
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <DoorOpen className="size-4 text-gold" />
            <h3 className="font-display font-bold text-ink">THE-DOOR — דבר-גורר-דבר · שרשרת-הדלתות-החינמית</h3>
            <span
              className={cn(
                "ms-auto inline-flex items-center gap-1.5 text-[11px] hash px-2 py-0.5 rounded",
                rd.relayerAlive ? "text-emerald bg-emerald/10" : "text-rose bg-rose/10"
              )}
            >
              <LiveDot tone={rd.relayerAlive ? "green" : "rose"} />
              {rd.relayerAlive ? "מבצע-הדלתות-חי" : "מבצע-מת — הגרדיאן-ישכים"}
            </span>
          </div>

          <p className="text-[11px] text-ink-2 leading-relaxed mb-2.5">{rd.explainer}</p>

          {/* מונים-חיים */}
          <div className="grid grid-cols-3 gap-2 mb-3">
            <div className="rounded-lg bg-ink-2/30 px-3 py-2 text-center">
              <div className="font-display font-bold text-ink text-sm font-mono">{rd.issued}</div>
              <div className="text-[10px] text-ink-2">הוצתו (אפס-גז)</div>
            </div>
            <div className="rounded-lg bg-emerald/10 px-3 py-2 text-center">
              <div className="font-display font-bold text-emerald text-sm font-mono">{rd.sent}</div>
              <div className="text-[10px] text-ink-2">נסגרו עם-txid אמת</div>
            </div>
            <div className="rounded-lg bg-gold/10 px-3 py-2 text-center">
              <div className="font-display font-bold text-gold text-sm font-mono">{rd.queued}</div>
              <div className="text-[10px] text-ink-2">בתור-כנה</div>
            </div>
          </div>

          {/* שרשרת-הדלתות — כל-דלת: רשת · סטטוס · txid אמת · קישור-אימות-חוץ */}
          {rd.doors.length > 0 ? (
            <div className="space-y-1.5 max-h-80 overflow-y-auto pe-1">
              {rd.doors.map((d) => (
                <div key={d.ref} className="rounded-lg bg-ink-2/30 px-3 py-2">
                  <div className="flex items-center gap-2 flex-wrap text-[11px]">
                    <span className="hash text-[10px] text-ink font-bold">{d.ref}</span>
                    <span
                      className={cn(
                        "hash text-[10px] px-1.5 rounded",
                        d.via === "steem" ? "text-gold bg-gold/10" : d.via === "tron" ? "text-rose bg-rose/10" : "text-ink-2 bg-ink/10"
                      )}
                    >
                      {d.via.toUpperCase()}
                    </span>
                    <span className="text-ink-2">{d.act}</span>
                    {d.chain === "door-chain" ? (
                      <span className="text-[10px] text-gold flex items-center gap-0.5">
                        <Radio className="size-3" /> נצת-אוטומטית מ-{d.from}
                      </span>
                    ) : null}
                    {/* 109 — GAS-SETTLE: הפיקדון-של-החוזה — תקציב-נעול · שולם-למבצע · עודף-חוזר */}
                    {d.budgetSun ? (
                      <span className="text-[10px] hash text-gold bg-gold/10 px-1.5 rounded">
                        פיקדון {(d.escrowµ ?? 0) / 1e6} SAOS{d.status === "sent" ? ` · שולם ${((d.gasPaidµ ?? 0) / 1e6).toFixed(3)} · עודף ${((d.refundµ ?? 0) / 1e6).toFixed(3)}` : " · נעול-בחוזה"}
                      </span>
                    ) : null}
                    <span
                      className={cn(
                        "ms-auto hash text-[10px] px-1.5 rounded",
                        d.status === "sent" ? "text-emerald bg-emerald/10" : "text-gold bg-gold/10"
                      )}
                    >
                      {d.status === "sent" ? "✓ נסגרה" : "בתור"}
                    </span>
                  </div>
                  {d.txid ? (
                    <div className="text-[10px] text-ink-2 mt-1 flex items-center gap-1.5 flex-wrap">
                      <span className="font-mono break-all">txid {d.txid}</span>
                      <a
                        href={d.via === "steem" ? "https://steemscan.com/transaction/" + d.txid : d.via === "tron" ? "https://tronscan.org/#/transaction/" + d.txid : "#"}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-0.5 text-emerald hover:underline"
                      >
                        אמת-על-הרשת <ExternalLink className="size-3" />
                      </a>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-ink-2">אף-דלת-לא-הוצתה-עדיין — הפקודה relay-issue מציתה את-הראשונה</p>
          )}

          {/* הוכחות-רשת-מרוחקות — קישורי-אימות-עצמאיים */}
          {rd.remoteProof?.steem || rd.remoteProof?.tron ? (
            <div className="mt-3 flex flex-wrap gap-2 text-[10px]">
              {rd.remoteProof?.steem ? (
                <a href={rd.remoteProof.steem.verify} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg bg-gold/10 px-2.5 py-1.5 text-gold hover:bg-gold/20 transition-colors">
                  הוכחת-STEEM · {rd.remoteProof.steem.ref} <ExternalLink className="size-3" />
                </a>
              ) : null}
              {rd.remoteProof?.tron ? (
                <a href={rd.remoteProof.tron.verify} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg bg-rose/10 px-2.5 py-1.5 text-rose hover:bg-rose/20 transition-colors">
                  הוכחת-TRON · {rd.remoteProof.tron.ref} <ExternalLink className="size-3" />
                </a>
              ) : null}
            </div>
          ) : null}
        </Panel>
      ) : null}

      {/* 110 — THE-DEX (דקס-המפלצת): הדקס-האמת על-הרשת-החינמית · כספת-מתוקננת-חי · התיישבות-טרון-אפס-עמלה */}
      {dex?.ok ? (
        <Panel className="mb-6">
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <Coins className="size-4 text-gold" />
            <h3 className="font-display font-bold text-ink">THE-DEX — דקס-המפלצת · {dex.pair} על-הרשת-החינמית</h3>
            <span
              className={cn(
                "ms-auto inline-flex items-center gap-1.5 text-[11px] hash px-2 py-0.5 rounded",
                dex.relayerAlive ? "text-emerald bg-emerald/10" : "text-rose bg-rose/10"
              )}
            >
              <LiveDot tone={dex.relayerAlive ? "green" : "rose"} />
              {dex.relayerAlive ? "מבצע-התיישבויות-חי" : "מבצע-מת — הגרדיאן-ישכים"}
            </span>
          </div>

          {/* כיסוי-הכספת — הלב-הכנה של-הדקס: כל-קרדיט = TRX אמת בכספת-החיה */}
          {dex.coverage && dex.vault ? (
            <div className="rounded-lg bg-ink-2/30 px-3 py-2.5 mb-3">
              <div className="flex items-center gap-2 flex-wrap text-[11px] mb-1.5">
                <ShieldCheck className={cn("size-3.5", dex.coverage.perfect ? "text-emerald" : "text-gold")} />
                <span className="font-bold text-ink">כיסוי-כספת-חי:</span>
                <span className={cn("hash text-[10px] px-1.5 rounded", dex.coverage.perfect ? "text-emerald bg-emerald/10" : "text-gold bg-gold/10")}>
                  {dex.coverage.status}
                </span>
                <span className="text-ink-2 hash">
                  supply {dex.coverage.supplyTrx.toFixed(3)} = locked {dex.coverage.lockedTrx.toFixed(3)} = כספת-חי {dex.coverage.liveTrx.toFixed(3)} TRX
                </span>
                <span className="ms-auto text-[10px] text-ink-2 hash">
                  טרונגריד blk {dex.vault.tronBlock ?? "—"} · לפני {dex.vault.ageSec ?? "?"} ש׳
                </span>
              </div>
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
                {dex.vault.per.map((a) => (
                  <div key={a.idx} className="rounded bg-ink-2/40 px-2 py-1 text-center">
                    <div className="text-[10px] text-ink-2">idx{a.idx}</div>
                    <div className="hash text-[10px] text-ink font-bold">{a.trx.toFixed(3)}</div>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-ink-2 mt-1.5 leading-relaxed">
                הפיוס-החי (trondex reconcile): כל-פעימה מודדת-את-הכספת-מטרונגריד ומכוונת supply/locked לכיסוי-אמת — burn-עודף-הנפקה + release/cover עם-ref-מדידה. בלי-זה, עטיפות-מציגות-עושר-שלא-קיים.
              </p>
            </div>
          ) : null}

          {/* הבריכה — מחיר-אמת מזרימה */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
            <div className="rounded-lg bg-gold/10 px-3 py-2 text-center">
              <div className="font-display font-bold text-gold text-sm font-mono">{dex.pool?.mid ? dex.pool.mid.toFixed(2) : "—"}</div>
              <div className="text-[10px] text-ink-2">מחיר-אמצע SAOS/WTRX</div>
            </div>
            <div className="rounded-lg bg-ink-2/30 px-3 py-2 text-center">
              <div className="font-display font-bold text-ink text-sm font-mono">{dex.pool ? dex.pool.aTrx.toFixed(3) : "—"}</div>
              <div className="text-[10px] text-ink-2">WTRX-בבריכה</div>
            </div>
            <div className="rounded-lg bg-ink-2/30 px-3 py-2 text-center">
              <div className="font-display font-bold text-ink text-sm font-mono">{dex.pool ? dex.pool.bSaos.toFixed(2) : "—"}</div>
              <div className="text-[10px] text-ink-2">SAOS-בבריכה</div>
            </div>
            <div className="rounded-lg bg-emerald/10 px-3 py-2 text-center">
              <div className="font-display font-bold text-emerald text-sm font-mono">{dex.swapsX}</div>
              <div className="text-[10px] text-ink-2">סוואפים · עמלה {dex.pool?.feeBps ?? 30}bps→LP+אוצר</div>
            </div>
          </div>

          {/* אימות-האח — הלולאה-ההדדית: הוא-אימת-את-הדלתות-שלנו-מהשרשרת (W22), אנחנו-את-החוזים-שלו (110) */}
          {dex.siblings.total > 0 ? (
            <div className="rounded-lg bg-ink-2/30 px-3 py-2.5 mb-3">
              <div className="flex items-center gap-2 flex-wrap text-[11px] mb-1.5">
                <Users className="size-3.5 text-gold" />
                <span className="font-bold text-ink">אימות-אח-הדדי:</span>
                <span className="hash text-[10px] text-emerald bg-emerald/10 px-1.5 rounded">
                  {dex.siblings.verified}/{dex.siblings.total} נבדקו-בידינו-מהשרשרת-הגולמית
                </span>
                <span className="text-[10px] text-ink-2">peer {dex.siblings.peer} · מהצד-השני: הוא-אימת-את-8-הדלתות-שלנו + הטרון-שלנו</span>
              </div>
              <div className="space-y-1 max-h-32 overflow-y-auto pe-1">
                {dex.siblings.recs.map((r) => (
                  <div key={r.txid} className="flex items-center gap-2 text-[10px] flex-wrap">
                    <span className={cn("hash px-1.5 rounded", r.verdict === "rejected" ? "text-rose bg-rose/10" : "text-emerald bg-emerald/10")}>
                      {r.verdict === "rejected" ? "✗ נדחה" : "✓ נבדק"}
                    </span>
                    <span className="hash text-ink-2">{r.kind}{r.step ? " #" + r.step : ""} · {r.txid.slice(0, 14)}…</span>
                    {r.note ? <span className="text-ink-2">{r.note}</span> : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* דלתות-ההתיישבות — פדיון-WTRX → TRX אמת על-טרון */}
          <div className="flex items-center gap-2 flex-wrap text-[11px] mb-1.5">
            <ArrowLeftRight className="size-3.5 text-gold" />
            <span className="font-bold text-ink">התיישבויות-טרון-אמת (אפס-עמלה):</span>
            <span className="text-[10px] text-ink-2">פדיון-קרדיט → שריפה → דלת-relay → TRX-אמת בין-כתובות-הכספת</span>
          </div>
          {dex.settlement.doors.length > 0 ? (
            <div className="space-y-1.5 mb-3">
              {dex.settlement.doors.map((d) => (
                <div key={d.ref} className="rounded-lg bg-ink-2/30 px-3 py-2">
                  <div className="flex items-center gap-2 flex-wrap text-[11px]">
                    <span className="hash text-[10px] text-ink font-bold">{d.ref}</span>
                    <span className="hash text-[10px] text-rose bg-rose/10 px-1.5 rounded">TRON</span>
                    {d.amountSun ? <span className="text-[10px] text-ink-2">{(d.amountSun / 1e6).toFixed(6)} TRX → idx{d.toIdx}</span> : null}
                    <span className={cn("ms-auto hash text-[10px] px-1.5 rounded", d.status === "sent" ? "text-emerald bg-emerald/10" : "text-gold bg-gold/10")}>
                      {d.status === "sent" ? "✓ התיישב" : "בתור-כנה"}
                    </span>
                  </div>
                  {d.txid ? (
                    <div className="text-[10px] text-ink-2 mt-1 flex items-center gap-1.5 flex-wrap">
                      <span className="font-mono break-all">txid {d.txid}</span>
                      <a href={d.verifyUrl ?? "#"} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-emerald hover:underline">
                        אמת-על-הרשת <ExternalLink className="size-3" />
                      </a>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-ink-2 mb-3">אף-התיישבות-עוד — הפדיון-הראשון-מצית-דלת-אוטומטית</p>
          )}

          {/* חומת-האנרגיה — הכנות-המדודה: מה-חינם-היום-ומה-המסילות-למחר */}
          <div className="rounded-lg bg-rose/5 border border-rose/20 px-3 py-2.5">
            <div className="flex items-center gap-2 text-[11px] mb-1">
              <Flame className="size-3.5 text-rose" />
              <span className="font-bold text-ink">חומת-אנרגיה (נמדד, לא-מנוחש):</span>
              <span className="text-[10px] text-ink-2">{dex.energyWall.measured}</span>
            </div>
            <p className="text-[10px] text-ink-2 leading-relaxed mb-1">{dex.energyWall.freeRails}</p>
            <div className="flex flex-wrap gap-1.5">
              {dex.energyWall.paths.map((p, i) => (
                <span key={i} className="text-[10px] hash text-gold bg-gold/10 px-1.5 py-0.5 rounded">{p}</span>
              ))}
            </div>
          </div>
        </Panel>
      ) : null}

      {/* 112 — בקרת-איכות הדקס: מעקב-איכותי אחרי הדברים שנבין — כל-צמד: סחירות-אריתמטית + פעילות-נמדדת + גיבוי + מפת-מחירים-פנימית */}
      {dexq?.ok ? (
        <Panel className="mb-6">
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <Activity className="size-4 text-gold" />
            <h3 className="font-display font-bold text-ink">בקרת-איכות הדקס · מעקב-איכותי</h3>
            <span className="hash text-[10px] text-gold bg-gold/10 px-1.5 rounded">{dexq.pairsCount} צמדים</span>
            <span className="text-[10px] text-ink-2 hash">h{dexq.height} · מדידה-חי, לא-הצהרה</span>
            <span className="ms-auto text-[10px] text-ink-2">
              {dexq.pairs.filter((p) => p.badge.startsWith("חי")).length} חיים · {dexq.pairs.filter((p) => p.badge.startsWith("זמין")).length} זמינים · {dexq.pairs.filter((p) => p.badge.startsWith("יבש")).length} יבשים-מוצהרים
            </span>
          </div>

          {/* מפת-המחירים-הפנימית — SAOS/STEEM בשתי-דרכים + האח */}
          {dexq.cross ? (
            <div className="rounded-lg bg-ink-2/30 px-3 py-2.5 mb-3">
              <div className="flex items-center gap-2 flex-wrap text-[11px] mb-1">
                <Scale className="size-3.5 text-gold" />
                <span className="font-bold text-ink">מפת-מחירים-פנימית SAOS/STEEM:</span>
                <span className="hash text-[10px] px-1.5 rounded text-gold bg-gold/10">
                  דרך-WSTEEM {dexq.cross.saosPerSteemViaWSTEEM.toFixed(2)}
                </span>
                {dexq.cross.saosPerSteemViaWTRX ? (
                  <span className="hash text-[10px] px-1.5 rounded text-ink bg-ink-2/40">
                    דרך-WTRX×שוק-חוץ {dexq.cross.saosPerSteemViaWTRX.toFixed(2)}
                  </span>
                ) : null}
                {dexq.cross.gapPct != null ? (
                  <span className={cn("hash text-[10px] px-1.5 rounded", Math.abs(dexq.cross.gapPct) > 5 ? "text-emerald bg-emerald/10" : "text-ink-2 bg-ink-2/40")}>
                    פער {dexq.cross.gapPct > 0 ? "+" : ""}{dexq.cross.gapPct.toFixed(1)}% — מסלול-ארביטרז'
                  </span>
                ) : null}
              </div>
              <p className="text-[10px] text-ink-2 leading-relaxed">{dexq.cross.siblingW25.note} (הבריכה-שלו: 1 SAOS = {dexq.cross.siblingW25.steemPerSaos} STEEM מול-שלנו {(1 / dexq.cross.saosPerSteemViaWSTEEM).toFixed(4)} STEEM — פער-ריבונויות מתועד-בכנות)</p>
            </div>
          ) : null}

          {/* טבלת-הצמדים — סחירות + פעילות + גיבוי */}
          <div className="space-y-1.5 mb-3 max-h-96 overflow-y-auto pe-1 dex-quality-rows">
            {dexq.pairs.map((p) => (
              <div key={p.pair} className="rounded-lg bg-ink-2/30 px-3 py-2">
                <div className="flex items-center gap-2 flex-wrap text-[11px]">
                  <span className="hash text-[11px] text-ink font-bold">{p.pair}</span>
                  <span
                    className={cn(
                      "text-[10px] px-1.5 rounded",
                      p.badge.startsWith("חי") ? "text-emerald bg-emerald/10" : p.badge.startsWith("זמין") ? "text-gold bg-gold/10" : "text-ink-2 bg-ink-2/40"
                    )}
                  >
                    {p.badge}
                  </span>
                  <span className="text-[10px] text-ink-2 hash">
                    mid {p.midText} {p.symB}/{p.symA} · TVL {p.tvlSaos.toFixed(1)} SAOS
                  </span>
                  {p.activity.swaps > 0 ? (
                    <span className="text-[10px] hash text-emerald">
                      {p.activity.swaps} סוופים
                      {p.activity.ageBlocks != null ? ` · לפני ${p.activity.ageBlocks} בלוקים` : ""}
                    </span>
                  ) : (
                    <span className="text-[10px] text-ink-2">אין-זרימה-בחלון</span>
                  )}
                  <span className="ms-auto text-[10px] hash text-ink-2">
                    {p.backing.ratio != null ? `גיבוי ${(p.backing.ratio * 100).toFixed(1)}%` : "ללא-עטיפה"}
                    {p.backing.lockRef ? (
                      <a href={p.backing.verifyUrl ?? "#"} target="_blank" rel="noreferrer" className="ms-1.5 inline-flex items-center gap-0.5 text-emerald hover:underline">
                        הוכחת-נעילה <ExternalLink className="size-3" />
                      </a>
                    ) : null}
                  </span>
                </div>
                {p.minBuyInMu == null ? (
                  <div className="text-[10px] text-ink-2 mt-1">עתודת-מניעה {p.aMu}µ {p.symA} — קנייה-אריתמטית-בלתי-אפשרית; הפקדה-אמת תפתח את-הצמד</div>
                ) : null}
              </div>
            ))}
          </div>

          {/* הדברים-שאנחנו-מבינים — זרם-התובנות */}
          <div className="flex items-center gap-2 text-[11px] mb-1.5">
            <Sprout className="size-3.5 text-emerald" />
            <span className="font-bold text-ink">הדברים-שאנחנו-מבינים (זרם-תובנות-חי):</span>
          </div>
          <div className="space-y-1 max-h-44 overflow-y-auto pe-1">
            {dexq.insights.map((ins, i) => (
              <div key={i} className="flex items-start gap-2 text-[10px] flex-wrap">
                <span
                  className={cn(
                    "hash px-1.5 rounded shrink-0",
                    ins.kind === "live" ? "text-emerald bg-emerald/10" : ins.kind === "cross" ? "text-gold bg-gold/10" : ins.kind === "open" ? "text-ink-2 bg-ink-2/40" : "text-ink bg-ink-2/40"
                  )}
                >
                  {ins.kind}
                </span>
                <span className="text-ink-2 leading-relaxed">{ins.text}</span>
                {ins.ref && ins.url ? (
                  <a href={ins.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-emerald hover:underline shrink-0">
                    אמת <ExternalLink className="size-3" />
                  </a>
                ) : ins.ref ? (
                  <span className="hash text-[10px] text-ink-2 shrink-0">{ins.ref}</span>
                ) : null}
              </div>
            ))}
          </div>
        </Panel>
      ) : null}

      {/* 111 — THE-HARVEST (קציר-האנרגיה): התשובה-העל-הספר לשאלת-הערך —
          ״יש טרנזקציה, יש אנרגיה שמתבזבזת, מישהו משלם — אנחנו מרוויחים משחרור-האנרגיה״ */}
      {hv?.ok && hv.inconsistent ? (
        <Panel className="mb-6">
          <div className="flex items-center gap-2 text-[11px] text-gold">
            <TriangleAlert className="size-4" />
            <span>קריאת-מצב-בשחיקה (כתיבה-במקביל) — הפאנל-מוסתר-בכנות-עד-הפעימה-הבאה · האינווריאנט pot ≤ total נשמר-על-הספר-תמיד</span>
          </div>
        </Panel>
      ) : null}
      {hv?.ok && !hv.inconsistent ? (
        <Panel className="mb-6" glow>
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <Sprout className="size-4 text-emerald" />
            <h3 className="font-display font-bold text-ink">THE-HARVEST — קציר-האנרגיה · כל-זרימה-משאירה-ערך</h3>
            <span
              className={cn(
                "ms-auto inline-flex items-center gap-1.5 text-[11px] hash px-2 py-0.5 rounded",
                hv.relayerAlive ? "text-emerald bg-emerald/10" : "text-rose bg-rose/10"
              )}
            >
              <LiveDot tone={hv.relayerAlive ? "green" : "rose"} />
              {hv.relayerAlive ? "הקוצר-חי" : "הקוצר-מת — הגרדיאן-ישכים"}
            </span>
          </div>

          {/* שורת-המאגר — הערך-שנקצר-על-הספר (הקרנל אוכף: שחרור-מעל-מאגר = דחייה) */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
            <div className="rounded-lg bg-emerald/10 px-3 py-2 text-center">
              <div className="font-display font-bold text-emerald text-sm font-mono">{(hv.potµ / 1000).toFixed(3)}</div>
              <div className="text-[10px] text-ink-2">מאגר-הקציר (SAOS)</div>
            </div>
            <div className="rounded-lg bg-ink-2/30 px-3 py-2 text-center">
              <div className="font-display font-bold text-ink text-sm font-mono">{(hv.harvestedTotalµ / 1000).toFixed(3)}</div>
              <div className="text-[10px] text-ink-2">סה״כ-שנקצר-מעולם</div>
            </div>
            <div className="rounded-lg bg-gold/10 px-3 py-2 text-center">
              <div className="font-display font-bold text-gold text-sm font-mono">{(hv.releasedµ / 1000).toFixed(3)}</div>
              <div className="text-[10px] text-ink-2">ששוחרר-לעבודת-הרשת</div>
            </div>
            <div className="rounded-lg bg-ink-2/30 px-3 py-2 text-center">
              <div className="font-display font-bold text-ink text-sm font-mono">{hv.count}</div>
              <div className="text-[10px] text-ink-2">הכרות-על-הספר · h{hv.height?.toLocaleString?.() ?? "—"}</div>
            </div>
          </div>

          {/* ארבעת-הזרמים */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 mb-3">
            {hv.byStream.length === 0 ? (
              <p className="text-[11px] text-ink-2">עדיין-לא-נקצר — הזרמים-מזוהים-אוטומטית-בכל-פעימת-הקוצר</p>
            ) : (
              hv.byStream.map((s) => (
                <div key={s.stream} className="rounded-lg bg-ink-2/30 px-3 py-2 flex items-center gap-2">
                  <span className="hash text-[10px] text-emerald bg-emerald/10 px-1.5 rounded">{s.stream}</span>
                  <span className="text-[10px] text-ink-2 truncate">{s.he}</span>
                  <span className="ms-auto hash text-[11px] text-ink font-bold">{(s.amountµ / 1000).toFixed(3)} SAOS</span>
                </div>
              ))
            )}
          </div>

          {/* דלתות-v:3 — המרווח-שהחוזה-מחזיק (עדות-על-השרשרת-המרוחקת) */}
          {hv.feeDoors.length > 0 ? (
            <div className="mb-3">
              <div className="flex items-center gap-2 flex-wrap text-[11px] mb-1.5">
                <DoorOpen className="size-3.5 text-gold" />
                <span className="font-bold text-ink">דלתות-קציר (v:3) — עמלת-השירות-שנשארת-בחוזה:</span>
              </div>
              <div className="space-y-1.5">
                {hv.feeDoors.map((d) => (
                  <div key={d.ref} className="rounded-lg bg-ink-2/30 px-3 py-2">
                    <div className="flex items-center gap-2 flex-wrap text-[11px]">
                      <span className="hash text-[10px] text-ink font-bold">{d.ref}</span>
                      <span className="hash text-[10px] text-gold bg-gold/10 px-1.5 rounded">v:3 · fee {d.feeBps}bps</span>
                      <span className="text-[10px] text-ink-2 hash">
                        פיקדון {(d.escrowµ / 1000).toFixed(1)} → חוזה-מחזיק {(d.harvestFeeµ / 1000).toFixed(1)} SAOS · החזר {((d.refundµ ?? 0) / 1000).toFixed(1)}
                      </span>
                      <span className={cn("ms-auto hash text-[10px] px-1.5 rounded", d.status === "sent" ? "text-emerald bg-emerald/10" : "text-gold bg-gold/10")}>
                        {d.status === "sent" ? "✓ בוצע" : "בתור"}
                      </span>
                    </div>
                    {d.txid ? (
                      <a
                        href={d.via === "tron" ? "https://tronscan.org/#/transaction/" + d.txid : "https://steemscan.com/transaction/" + d.txid}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[10px] text-ink-2 mt-1 flex items-center gap-1 hover:text-emerald"
                      >
                        <span className="font-mono break-all">{d.txid.slice(0, 28)}…</span>
                        אמת-על-הרשת <ExternalLink className="size-3" />
                      </a>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* גלגל-החוזר — הפירות-נהנים: שחרורים-מוגבלים-קשיח-במאגר (הקרנל אוכף) */}
          {hv.releases.length > 0 ? (
            <div className="rounded-lg bg-ink-2/30 px-3 py-2.5 mb-3">
              <div className="flex items-center gap-2 flex-wrap text-[11px] mb-1.5">
                <Sprout className="size-3.5 text-emerald" />
                <span className="font-bold text-ink">גלגל-החוזר — הפירות-נהנים:</span>
                <span className="text-[10px] text-ink-2">
                  מעל-רצפת {hv.policy.releaseFloorµ / 1000} SAOS — {hv.policy.releaseSharePct}%-לעבודת-הרשת (סבב-חיילים)
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
                {hv.releases.map((r, i) => (
                  <span key={i} className="text-[10px] hash text-emerald bg-emerald/10 px-1.5 py-0.5 rounded">
                    {(r.amountµ / 1000).toFixed(1)} SAOS → @{r.to} · {r.purposeHe}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          {/* עקומת-האנרגיה-האמתית — הכנות: מה-עולה-מהצד-השני-ולמה-החינם-שלנו-הוא-המרווח */}
          <div className="rounded-lg bg-rose/5 border border-rose/20 px-3 py-2.5">
            <div className="flex items-center gap-2 text-[11px] mb-1 flex-wrap">
              <Flame className="size-3.5 text-rose" />
              <span className="font-bold text-ink">עקומת-האנרגיה-על-טרון (נמדד-חי):</span>
              {hv.energy.energyFeeSun != null ? (
                <span className="hash text-[10px] text-ink-2">
                  {hv.energy.energyFeeSun}–{hv.energy.energyFeeMaxSun} sun/אנרגיה · העברת-TRC20 (65K) ≈ {hv.energy.trc20CostTrx?.toFixed(4)}–{hv.energy.trc20CostMaxTrx?.toFixed(4)} TRX · הכספת-שלנו {hv.energy.vaultTrx?.toFixed(3)} TRX (מגובה-1:1 — קדוש)
                </span>
              ) : (
                <span className="hash text-[10px] text-ink-2">{hv.energy.why ?? "מדידה-לא-זמינה"}</span>
              )}
            </div>
            <p className="text-[10px] text-ink-2 leading-relaxed">
              התשובה-הכלכלית-לשאלת-האנרגיה: אנחנו-לא-שורפים-כלום (החינם-הוא-היתרון) — אבל-כל-טרנזקציה-שעוברת-במסילות-שלנו משאירה-עמלה-אמת-ביד-האוצר
              (בריכות · גריד · דלתות-שירות · מסילת-הזרמות) — הקרנל-מכיר-בערך-על-הספר והגלגל-משחרר-אותו-לעבודת-הרשת.
              המסילה-פתוחה: memo <span className="hash">{hv.policy.railTag}</span> · ‏{hv.policy.railSteemPerSaos} STEEM = 1 SAOS.
            </p>
          </div>
        </Panel>
      ) : null}


      {/* 113 — THE-WALLETS (ארנקי-הצבא): זהות-כספית-רב-רשתית-מעוגנת לכל-סוכן —
          ״לכל-חייל ארנקים-מצומדים על-כל-הרשתות-המובילות · כתובת-לכל-סוכן · הכל-מעוגן · תקצוב״ */}
      {wl?.ok ? (
        <Panel className="mb-6" glow>
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <Wallet className="size-4 text-emerald" />
            <h3 className="font-display font-bold text-ink">THE-WALLETS — ארנקי-הצבא · זהות-כספית-מעוגנת לכל-סוכן</h3>
            <span
              className={cn(
                "ms-auto inline-flex items-center gap-1.5 text-[11px] hash px-2 py-0.5 rounded",
                wl.anchor?.verified ? "text-emerald bg-emerald/10" : "text-gold bg-gold/10"
              )}
            >
              <LiveDot tone={wl.anchor?.verified ? "green" : "gold"} />
              {wl.anchor?.verified ? "מעוגן-ומאומת-על-המארח" : "עיגון-בדרך"}
            </span>
          </div>

          {/* שורת-הסיכום — 12 סוכנים × 10 רשתות */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
            <div className="rounded-lg bg-emerald/10 px-3 py-2 text-center">
              <div className="font-display font-bold text-emerald text-sm font-mono">{wl.totals.agents}</div>
              <div className="text-[10px] text-ink-2">סוכנים-עם-ארנק-פרטי</div>
            </div>
            <div className="rounded-lg bg-ink-2/30 px-3 py-2 text-center">
              <div className="font-display font-bold text-ink text-sm font-mono">{wl.totals.anchored}/{wl.totals.agents}</div>
              <div className="text-[10px] text-ink-2">רשומים-על-הספר · h{wl.height?.toLocaleString?.() ?? "—"}</div>
            </div>
            <div className="rounded-lg bg-gold/10 px-3 py-2 text-center">
              <div className="font-display font-bold text-gold text-sm font-mono">{wl.totals.funded}</div>
              <div className="text-[10px] text-ink-2">מתוקצבים-על-הספר (מענק-אמת)</div>
            </div>
            <div className="rounded-lg bg-ink-2/30 px-3 py-2 text-center">
              <div className="font-display font-bold text-ink text-sm font-mono">{wl.networks.length + 3}</div>
              <div className="text-[10px] text-ink-2">רשתות-לכל-סוכן · ארנק-מצומד</div>
            </div>
          </div>

          {/* 114 — THE-VAULT: הכספת — כל-חומר-המפתחות במעטפת-מוצפנת אחת (AES-256-GCM) */}
          {vt?.ok && vt.vault.envelopeDigest ? (
            <div className={cn("rounded-lg border px-3 py-2.5 mb-3", vt.vault.verified ? "bg-emerald/5 border-emerald/20" : "bg-gold/5 border-gold/20")}>
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <KeyRound className={cn("size-3.5", vt.vault.verified ? "text-emerald" : "text-gold")} />
                <span className="font-display text-xs font-bold text-ink">THE-VAULT — הכספת</span>
                <span className="text-[10px] text-emerald bg-emerald/10 px-1.5 rounded">מוצפנת AES-256-GCM</span>
                {vt.vault.verified ? (
                  <span className="text-[10px] text-emerald bg-emerald/10 px-1.5 rounded" title={"טקס-" + (vt.vault.verifiedAt ?? "")}>
                    טקס-גזירה 12×4 מאומת ✓ · {vt.vault.verifiedAt ? fmtClock(vt.vault.verifiedAt) : ""}
                  </span>
                ) : (
                  <span className="text-[10px] text-gold bg-gold/10 px-1.5 rounded">טקס-בדיקה-בדרך</span>
                )}
                <span className="hash text-[10px] text-ink-2 ms-auto">envelope {vt.vault.envelopeDigest?.slice(0, 12)}…</span>
              </div>
              <p className="text-[10px] text-ink-2 leading-relaxed">
                כל-חומר-המפתחות של-הצבא (הזרע-הריבוני · רישום-12-הסוכנים · כספת-STEEM · מנמוניק-טרון) אטום-במעטפת-אחת — מקור-האמת-המוצפן.
                הטקס-פותח-את-המעטפת, מגזר-מחדש את-כל-הכתובות-מהזרע-המוצפן ומשווה-מול-העיגון-הציבורי-על-STEEM — הכספת-נפתחת-בדיוק-לזהות-המעוגנת.
                חבר-פגום/חסר → שחזור-אוטומטי-מהמעטפת (guardian healVault) · טקס-כשל → צעקה-ביומן.
              </p>
            </div>
          ) : null}

          {/* עיגון-המארח — המניפסט-הציבורי (אפס-עמלה, ניתן-לאימות-בכל-אקספלורר) */}
          {wl.anchor ? (
            <div className="rounded-lg bg-ink-2/30 px-3 py-2 mb-3 flex items-center gap-2 flex-wrap text-[11px]">
              <ShieldCheck className="size-3.5 text-emerald" />
              <span className="text-ink-2">מניפסט-הארנקות עוגן-על-STEEM (custom_json saos:wallets/v1):</span>
              <a href={wl.anchor.url} target="_blank" rel="noreferrer" className="hash text-emerald hover:underline inline-flex items-center gap-1">
                {wl.anchor.txid.slice(0, 18)}… <ExternalLink className="size-3" />
              </a>
              {wl.anchor.verified ? <span className="hash text-[10px] text-emerald bg-emerald/10 px-1.5 rounded">digest-מאומת-מהשרשרת ✓</span> : null}
              <span className="hash text-[10px] text-ink-2 ms-auto">digest {wl.digest?.slice(0, 12)}…</span>
            </div>
          ) : null}

          {/* כתובות-הסוכנים — כל-הכתובות-הפומביות (המפתחות-הפרטיים-מחוץ-לגיט, גזירה-דטרמיניסטית) */}
          <div className="text-[11px] text-ink-2 mb-2 flex items-center gap-1.5">
            <Users className="size-3 text-gold" /> כתובת-אחת-EVM משרתת 7 רשתות (Ethereum · BNB-Chain · Polygon · Arbitrum · Optimism · Base · Avalanche) + טרון + סולנה + ביטקוין-P2WPKH = 10 רשתות לכל-סוכן
          </div>
          <div className="space-y-1.5 mb-3 max-h-96 overflow-y-auto pe-1">
            {wl.agents.map((a) => (
              <div key={a.agent} className="rounded-lg bg-ink-2/30 px-3 py-2">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span className="hash text-[11px] text-gold font-bold">{a.agent}</span>
                  {a.anchored ? (
                    <span className="text-[10px] text-emerald bg-emerald/10 px-1.5 rounded">מעוגן-על-הספר</span>
                  ) : (
                    <span className="text-[10px] text-gold bg-gold/10 px-1.5 rounded">ברישום</span>
                  )}
                  <span className="ms-auto flex items-center gap-1 flex-wrap">
                    {a.budget.WSTEEM > 0 ? <span className="hash text-[10px] text-emerald bg-emerald/10 px-1.5 rounded">WSTEEM {(a.budget.WSTEEM / 1000).toFixed(1)}</span> : null}
                    {a.budget.WBLURT > 0 ? <span className="hash text-[10px] text-violet bg-violet/10 px-1.5 rounded">WBLURT {(a.budget.WBLURT / 1000).toFixed(1)}</span> : null}
                    {a.budget.ENERGY > 0 ? <span className="hash text-[10px] text-gold bg-gold/10 px-1.5 rounded">ENERGY {(a.budget.ENERGY / 1000).toFixed(1)}</span> : null}
                    {a.devnetSol.funded ? (
                      <span className="hash text-[10px] text-sky bg-sky/10 px-1.5 rounded">devnet-SOL {(a.devnetSol.lamports / 1e9).toFixed(2)}</span>
                    ) : a.devnetSol.err ? (
                      <span className="text-[10px] text-ink-2 px-1.5 rounded bg-ink-2/40" title={a.devnetSol.err ?? ""}>devnet-מוגבל</span>
                    ) : null}
                  </span>
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px]">
                  <span className="hash text-ink-2" title={"EVM ×7 · " + a.evm}>evm <span className="text-ink">{a.evm.slice(0, 12)}…{a.evm.slice(-6)}</span></span>
                  <span className="hash text-ink-2" title={"TRON · " + a.tron}>tron <span className="text-ink">{a.tron.slice(0, 10)}…{a.tron.slice(-4)}</span></span>
                  <span className="hash text-ink-2" title={"Solana · " + a.sol}>sol <span className="text-ink">{a.sol.slice(0, 8)}…{a.sol.slice(-4)}</span></span>
                  <span className="hash text-ink-2" title={"Bitcoin P2WPKH · " + a.btc}>btc <span className="text-ink">{a.btc.slice(0, 14)}…</span></span>
                </div>
              </div>
            ))}
          </div>

          {/* כנות-התקצוב — מה-אמת-ומה-מוגבל */}
          <div className="rounded-lg bg-gold/5 border border-gold/20 px-3 py-2 text-[10px] text-ink-2 leading-relaxed">
            <span className="text-gold font-bold">תקצוב-בכנות: </span>
            מענקי-הכספת-העטופה (WSTEEM/WBLURT/ENERGY) הועברו-על-הספר-בהעברות-אמת{wl.budgetLast?.txs ? " (" + wl.budgetLast.txs + " עסקאות · " + wl.budgetLast.plan?.join(" · ") + ")" : ""}
            {wl.airdropAt ? " · תדלוק-devnet-סולנה נוסה-באמת (" + wl.totals.devnetFunded + "/" + wl.totals.agents + " הצליחו — תקרות-הברז-ציבורי; ניסיון-חוזר-כל-6ש׳)" : " · תדלוק-devnet-סולנה בהמתנה"}
            . המפתחות-הפרטיים נגזרו-מזרע-ריבוני-אחד (מחוץ-לגיט, אותו-חוק-כמו-הכספת) — הכתובות-פומביות, הדיגסט-על-הספר, והעיגון-על-המארח-ציבורי.
          </div>

          {/* 114 — THE-DEPOSITS: תיבת-ההפקדות — הנמל-פתוח: הזהות-מ-113 הפכה-לרשת-קבלה-חיה */}
          {vt?.ok && vt.deposits ? (
            <div className="mt-3 rounded-lg bg-sky/5 border border-sky/20 px-3 py-2.5">
              <div className="flex items-center gap-2 flex-wrap mb-2">
                <ArrowDownToLine className="size-3.5 text-sky" />
                <span className="font-display text-xs font-bold text-ink">THE-DEPOSITS — תיבת-ההפקדות · נמל-פתוח לכל-הרשתות</span>
                <LiveDot tone={vt.deposits.watcherAlive ? "green" : "gold"} />
                <span className="text-[11px] text-ink-2">
                  {vt.deposits.watcherAlive
                    ? "סוקר-חי · " + vt.deposits.addressesTracked + " כתובות × 10 רשתות · טיק #" + vt.deposits.tick + " (כל-5 דק׳)"
                    : "watcher-סטלה — הגרדיאן-ישכים-אותו"}
                </span>
                {vt.deposits.mintedTotal > 0 ? (
                  <span className="hash text-[10px] text-emerald bg-emerald/10 px-1.5 rounded ms-auto">מינטים-מגובים: {vt.deposits.mintedTotal}</span>
                ) : null}
              </div>

              {/* 117 — מוכנות-הקבלה למשימת-$1-אמת: עיגון-חי על-ETH+SOL אמת, ספי-אבק-מתחת-$1,
                  בזלינות-במקום, מסילת-מינט-מקושרת — הפקדת-המפעיל-תתגלה-ותנופק 1:1 */}
              {vt.deposits.preflight ? (
                <div className={cn("rounded-lg px-3 py-2 mb-2", vt.deposits.preflight.ready ? "bg-emerald/10 border border-emerald/25" : "bg-gold/10 border border-gold/25")}>
                  <div className="flex items-center gap-2 flex-wrap text-[10px]">
                    <ShieldCheck className={cn("size-3.5", vt.deposits.preflight.ready ? "text-emerald" : "text-gold")} />
                    <span className={cn("font-bold", vt.deposits.preflight.ready ? "text-emerald" : "text-gold")}>
                      {vt.deposits.preflight.ready ? "מוכן-לקבלת-$1-אמת (ETH+SOL)" : "מוכנות-חלקית — בדוק-את-הסעיפים"}
                    </span>
                    <span className="hash text-ink-2">בדיקות-חיות: {vt.deposits.preflight.checksOk}/{vt.deposits.preflight.checksTotal}</span>
                    {vt.deposits.preflight.at ? <span className="text-ink-2 ms-auto">טיסת-מוכנות {fmtClock(vt.deposits.preflight.at)}</span> : null}
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] mt-1">
                    {vt.deposits.preflight.checks.filter((c) => ["ethereum-live", "solana-live", "eth-threshold-$1", "sol-threshold-$1", "detection-cadence"].includes(c.name)).map((c) => (
                      <span key={c.name} className={cn("hash", c.ok ? "text-emerald" : "text-rose")} title={c.detail}>
                        {c.ok ? "✓" : "✗"} {c.name}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}

              {/* רשתות-הקבלה — 10 שברים-חיים (אותן-רשתות-כמו-הזהות) */}
              <div className="flex flex-wrap gap-1.5 mb-2">
                {vt.deposits.chains.map((c) => (
                  <span
                    key={c.key}
                    className={cn("text-[10px] px-1.5 py-0.5 rounded", c.ok ? "text-emerald bg-emerald/10" : "text-gold bg-gold/10")}
                    title={c.ok ? "via " + c.via : "err: " + (c.err || c.note || "?")}
                  >
                    {c.he} {c.ok ? "✓" : "⚠"}
                  </span>
                ))}
              </div>

              {/* לאן-שולחים — כתובות-הראש (headcorner) להפקדות אמת · 117e: העתקה-בקליק
                  + תוויות-תקינות-מהשרת (EIP-55 · ed25519·32B · base58check · bech32) ·
                  ETH+SOL מודגשות-ירוק — הדלתות-של-משימת-$1-אמת */}
              {vt.sendTo ? (
                <div className="rounded-lg bg-ink-2/30 px-3 py-2.5 mb-2 space-y-1">
                  <div className="text-[10px] text-ink-2 mb-1">
                    כתובות-הקבלה של-הראש (headcorner) — שליחת-אמת ישירות-אל-הנמל · כפתור-ההעתקה מעתיק-את-הכתובת-המלאה ללוח · אותה-כתובת-EVM משרתת 7 רשתות:
                  </div>
                  <CopyAddrRow label="EVM×7" nets="Ethereum · BSC · Polygon · Arbitrum · Optimism · Base · Avalanche" addr={vt.sendTo.evm} validLabel={vt.sendTo.validity ? (vt.sendTo.validity.evmComputed ? (vt.sendTo.validity.evmChecksumOk ? "EIP-55 ✓" : "checksum-לא-תואם") : "לא-חושב") : null} primary={!!vt.deposits.preflight?.ready} />
                  <CopyAddrRow label="SOL" nets="Solana mainnet-beta" addr={vt.sendTo.sol} validLabel={vt.sendTo.validity ? (vt.sendTo.validity.solBytesOk ? "ed25519·32B ✓" : "פורמט-לא-תקין") : null} primary={!!vt.deposits.preflight?.ready} />
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                    <CopyAddrRow label="TRX" nets="Tron" addr={vt.sendTo.tron} validLabel={vt.sendTo.validity ? (vt.sendTo.validity.tronComputed ? (vt.sendTo.validity.tronOk ? "base58check ✓" : "פורמט-לא-תקין") : "לא-חושב") : null} />
                    <CopyAddrRow label="BTC" nets="Bitcoin P2WPKH" addr={vt.sendTo.btc} validLabel={vt.sendTo.validity ? (vt.sendTo.validity.btcFormatOk ? "bech32 ✓" : "פורמט-לא-תקין") : null} />
                  </div>
                  {vt.deposits.preflight?.ready ? (
                    <div className="text-[9px] text-emerald flex items-center gap-1">
                      <ShieldCheck className="size-3" /> שתי-הדלתות-הראשיות (ETH+SOL) נבדקו-חי מול-המיינט ומוכנות-לקבל — כל-הפקדה-תתגלה ותנופק 1:1 על-הספר
                    </div>
                  ) : null}
                </div>
              ) : null}

              {/* אירועי-הפקדה חיים — כנים: אירוע = התגלות-יתרה · מינט = מאושר-2-טיקים */}
              {vt.deposits.events.length > 0 ? (
                <div className="space-y-1 max-h-40 overflow-y-auto pe-1 mb-2">
                  {vt.deposits.events.map((e, i) => (
                    <div key={i} className="rounded bg-ink-2/30 px-2 py-1 text-[10px] flex items-center gap-2 flex-wrap">
                      <span className="hash text-sky font-bold">{e.sym}</span>
                      <span className="hash text-ink">{e.human} {e.unit === "wei" ? "טבעי" : e.unit}</span>
                      <span className="text-ink-2">→ {e.agent}</span>
                      <span className="hash text-ink-2 ms-auto">{e.chain} · {fmtClock(e.at)}</span>
                      {e.note ? <span className="text-gold text-[9px]">{e.note}</span> : null}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-[10px] text-ink-2 rounded bg-ink-2/30 px-2 py-1.5">
                  אפס-הפקדות-עדיין — הנמל-מסוקר, הבזלינות-נרשמו (120 כתובות), וכל-הפקדה-אמת-תתגלה-בטיק-הבא ותנופק 1:1 על-הספר (הנכס-בכתובתנו = הנעילה), ובמינט-הראשון-לכל-סמל → בריכה-אוטומטית מול-WSTEEM.
                </div>
              )}
              {vt.deposits.poolsOpened.length > 0 ? (
                <div className="hash text-[10px] text-emerald bg-emerald/10 px-1.5 rounded inline-block">בריכות-נפתחו-אוטומטית: {vt.deposits.poolsOpened.join(" · ")}</div>
              ) : null}
            </div>
          ) : null}

          {/* 116 — THE-BRIDGE: גשר-רושפינה — הליקוט-החי: עוגני-הביקורת של-הקונסולה-הפרטית
              (רושפינה) מגיעים-לכאן, נאמתים-קשוח, נעגנים-פומבית-על-STEEM (אפס-עמלה)
              ונזרקים-על-הספר-הריבוני כ-attest · fail-closed: שורה-רעה = הסגר-מנומק */}
          {rb?.ok && rb.bridge ? (
            <div className="mt-3 rounded-lg bg-emerald/5 border border-emerald/20 px-3 py-2.5">
              <div className="flex items-center gap-2 flex-wrap mb-2">
                <Cable className="size-3.5 text-emerald" />
                <span className="font-display text-xs font-bold text-ink">THE-BRIDGE — גשר-רושפינה · הקונסולה-מדברת-אל-השרשרת</span>
                <LiveDot tone={rb.bridge.daemonAlive ? "green" : "gold"} />
                <span className="text-[11px] text-ink-2">
                  {rb.bridge.daemonAlive
                    ? "ליקוט-חי (טיק 5 דק׳) · " + rb.bridge.consumedTotal + " עוגנים-נאספו"
                    : "הגשר-סטלה — הגרדיאן-ישכים-אותו"}
                </span>
                {rb.bridge.quarantined > 0 ? (
                  <span className="text-[10px] text-rose bg-rose/10 px-1.5 rounded">הסגר: {rb.bridge.quarantined}</span>
                ) : null}
                {rb.bridge.consumedTotal > 0 ? (
                  <span className="hash text-[10px] text-emerald bg-emerald/10 px-1.5 rounded ms-auto">עוגנים-כפולים: {rb.bridge.consumedTotal} (STEEM+ספר)</span>
                ) : null}
              </div>

              {rb.anchors.length > 0 ? (
                <div className="space-y-1 max-h-40 overflow-y-auto pe-1">
                  {rb.anchors.map((a) => (
                    <div key={a.headHash} className="rounded bg-ink-2/30 px-2 py-1 text-[10px] flex items-center gap-2 flex-wrap">
                      <span className="hash text-emerald font-bold">{a.tenantId}</span>
                      <span className="text-ink-2">h{a.height}</span>
                      <span className="hash text-ink" title={a.headHash}>{a.headHash.slice(0, 14)}…</span>
                      <span className={cn("hash", a.onBook === "injected" ? "text-emerald" : "text-gold")}>{a.onBook === "injected" ? "ספר ✓" : "ספר-ממתין"}</span>
                      <span className="hash text-ink-2 ms-auto" title={a.hostTxid}>STEEM {a.hostTxid.slice(0, 14)}… · {fmtClock(a.consumedAt)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-[10px] text-ink-2 rounded bg-ink-2/30 px-2 py-1.5">
                  התור-ריק-עדיין — כל-פעולה-כלכלית-בקונסולת-רושפינה (העברה · הצבה · שחרור) מאריכה-את-שרשרת-הביקורת-החתומה-שלה, והראש-החדש-מגיע-לכאן-לעיגון-פומבי-כפול.
                </div>
              )}
            </div>
          ) : null}

          {/* 117 — THE-SWAP: ניסוי-ההמרה — TRX ⇄ ETH/SOL-אמת. המפעיל: ״נסה להחליף את ה-TRX —
              הוא עדיין בארנק מחכה לניסוי שלך״. הסקר-החי כן: המלאי-הנשלט, הדלתות-הנעולות,
              ציטוטי-הספק, ומה-בדיוק-ידליק-את-ההמרה. אפס-פאסה — כל-מספר-נמדד-חי. */}
          {sw?.ok && sw.verdict ? (
            <div className="mt-3 rounded-lg bg-gold/5 border border-gold/25 px-3 py-2.5">
              <div className="flex items-center gap-2 flex-wrap mb-2">
                <ArrowLeftRight className="size-3.5 text-gold" />
                <span className="font-display text-xs font-bold text-ink">THE-SWAP — ניסוי-ההמרה · TRX ⇄ ETH/SOL-אמת</span>
                <LiveDot tone={sw.fresh ? "green" : "gold"} />
                <span className={cn(
                  "text-[10px] px-1.5 rounded font-bold",
                  sw.verdict === "EXECUTABLE" ? "text-emerald bg-emerald/10"
                  : sw.verdict.startsWith("SWAP-BLOCKED") ? "text-rose bg-rose/10"
                  : "text-gold bg-gold/10"
                )}>{sw.verdict.split(" (")[0]}</span>
                <span className="text-[10px] text-ink-2 ms-auto">סקר {fmtClock(sw.surveyedAt ?? sw.at)}</span>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-2">
                <div className="rounded bg-ink-2/30 px-2 py-1.5">
                  <div className="text-[9px] text-ink-2">מחיר-אמת (בינאנס)</div>
                  <div className="hash text-[11px] text-ink">TRX ${sw.prices.trx ?? "—"}</div>
                  <div className="hash text-[9px] text-ink-2">ETH ${sw.prices.eth?.toLocaleString() ?? "—"} · SOL ${sw.prices.sol ?? "—"}</div>
                </div>
                <div className="rounded bg-ink-2/30 px-2 py-1.5">
                  <div className="text-[9px] text-ink-2">מלאי-נשלט (24 דלתות-חי)</div>
                  <div className={cn("hash text-[11px]", sw.inventory.allZero ? "text-rose" : "text-emerald")}>{sw.inventory.controlledTrx ?? "—"} TRX {sw.inventory.allZero ? "(אפס-מדוד)" : ""}</div>
                  <div className="hash text-[9px] text-ink-2">≈ ${sw.inventory.controlledUsd ?? "0"}</div>
                </div>
                <div className="rounded bg-rose/5 border border-rose/20 px-2 py-1.5">
                  <div className="text-[9px] text-rose">דלתות-גשר-ישנות — נעולות</div>
                  <div className="hash text-[11px] text-ink">{sw.locked.trx ?? "—"} TRX ≈ ${sw.locked.usd ?? "—"}</div>
                  <div className="text-[9px] text-ink-2">מנומניק אבד-ברולבק-115</div>
                </div>
                <div className="rounded bg-ink-2/30 px-2 py-1.5">
                  <div className="text-[9px] text-ink-2">ChangeNOW-מינימום (keyless ✓)</div>
                  <div className="hash text-[10px] text-ink">→ETH: {sw.provider?.changenow.minAmounts?.trx_eth?.minAmount ?? "—"} TRX</div>
                  <div className="hash text-[10px] text-ink">→SOL: {sw.provider?.changenow.minAmounts?.trx_sol?.minAmount ?? "—"} TRX</div>
                </div>
              </div>

              {/* מסלולי-$1 — האומדנים-האמתיים כולל-עלות-הפיזור-על-סכומים-קטנים */}
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] mb-2">
                <span className="hash text-ink-2">אומדן-רגל-$1 (3.1 TRX):</span>
                <span className="hash text-ink">→ETH {sw.provider?.changenow.estimates?.["3.1_trx_eth"]?.est ?? "—"} (10-60 דק׳)</span>
                <span className="hash text-ink">→SOL {sw.provider?.changenow.estimates?.["3.1_trx_sol"]?.est ?? "—"} (10-60 דק׳)</span>
                <span className="text-gold">עלות-פיזור-מדודה על-רגל-$1 ≈ 18% — רגל-גדולה (15.4 TRX): ≈3-5%</span>
              </div>

              {/* מה-ידליק-את-ההמרה — הכנות-המלאה */}
              <div className="rounded bg-ink-2/30 px-2 py-1.5 text-[10px] leading-relaxed">
                <span className="font-bold text-ink">מה-ידליק-את-ההמרה:</span>{" "}
                <span className={sw.mandate?.active ? "text-emerald" : "text-rose"}>מנדט-{sw.mandate?.active ? "✓" : "✗"}</span> ·{" "}
                <span className={sw.providerKey?.present ? "text-emerald" : "text-gold"}>מפתח-ספק-{sw.providerKey?.present ? "✓" : "✗ (ChangeNOW-מפתח-חינם → agent/.env SWAP_CHANGENOW_KEY)"}</span> ·{" "}
                <span className={sw.inventory.allZero ? "text-rose" : "text-emerald"}>
                  {sw.inventory.allZero
                    ? "כסף-נשלט-✗ (ה-TRX-על-הדלתות-הישנות-ממתין-לגיבוי-טרום-רולבק של agent/keys/tron-mnemonic.txt — או-הפקדה-חדשה-לכל-דלת-v2)"
                    : "כסף-נשלט-✓"}
                </span>
                {" "}→ התשלום-נוחת-על-כתובות-headcorner-v2 (ETH/SOL) וה-DEPOSITS-מטביע-1:1-אוטומטית.
              </div>
            </div>
          ) : null}
        </Panel>
      ) : null}

      {/* 117c — THE-SWAP-ONNET: הבורסה-שלנו על-הרשת-שלנו. המנדט: ״שנוכל להחזיק מטבע אמיתי
          אחר על הרשת שלנו וגם להחליף אותו על הרשת שלנו, גם אם זה לא STEEM״. התשובה חיה:
          WTRX (מגובה-חי מול TRX-אמת-נמדד) ⇄ WSTEEM בבריכת-AMM אפס-עמלה — אפס-מינימום,
          אפס-אנרגיה, אפס-ספק-חוץ. כל-מספר-מהספר; הקרנל הוא-המבצע. */}
      {ts?.ok ? (
        <Panel className="mb-6" glow>
          <div className="flex items-center gap-2 flex-wrap mb-3">
            <ArrowLeftRight className="size-4 text-emerald" />
            <h3 className="font-display font-bold text-ink">THE-SWAP-ONNET — הבורסה שלנו על הרשת שלנו</h3>
            <LiveDot tone={ts.attest && Date.now() - new Date(ts.attest.at).getTime() < 15 * 60 * 1000 ? "green" : "gold"} />
            <span className="text-[10px] px-1.5 rounded font-bold text-emerald bg-emerald/10">אפס-עמלה · אפס-מינימום · אפס-אנרגיה</span>
            <span className="hash text-[10px] text-ink-2 ms-auto">h{ts.height?.toLocaleString() ?? "—"} · {ts.swapsTotal ?? "—"} סוואפים-ספר</span>
          </div>

          <div className="grid md:grid-cols-2 gap-3">
            {/* ── מנוע-הסוואפ ── */}
            <div className="rounded-lg bg-emerald/5 border border-emerald/25 p-3">
              <div className="text-[11px] font-bold text-ink mb-2">מנוע-הסוואפ — מטבע-אמת מול-מטבע-אמת</div>
              <div className="grid grid-cols-2 gap-2 mb-2">
                <label className="block">
                  <span className="text-[9px] text-ink-2">מסלול (בריכה)</span>
                  <select
                    value={tsSel}
                    onChange={(e) => { setTsSel(Number(e.target.value)); setTsQuote(null); setTsMsg(null); }}
                    className="w-full mt-0.5 rounded bg-ink-2/30 border border-ink-2/20 px-2 py-1.5 text-xs text-ink focus:outline-none focus:border-emerald/50"
                    aria-label="מסלול-החלפה"
                  >
                    {tsRoutes.map((r, i) => (
                      <option key={r.pair + r.side} value={i} className="bg-background">
                        {r.from} → {r.to} · {r.pair} {r.feeBps === 0 ? "· אפס-עמלה" : `· ${r.feeBps}bps`}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-[9px] text-ink-2">כמות ({tsRoute?.from ?? "—"} {tsHouseBal !== null ? <>· יתרה <span className="hash">{tsHouseBal.toLocaleString()}</span> book</> : null})</span>
                  <input
                    value={tsAmt}
                    onChange={(e) => { setTsAmt(e.target.value.replace(/[^0-9.]/g, "")); setTsMsg(null); }}
                    inputMode="decimal"
                    placeholder="0.0"
                    className="w-full mt-0.5 rounded bg-ink-2/30 border border-ink-2/20 px-2 py-1.5 text-xs text-ink focus:outline-none focus:border-emerald/50"
                    aria-label="כמות-להחלפה"
                  />
                </label>
              </div>

              {tsQuote?.ok ? (
                <div className="rounded bg-ink-2/30 px-2 py-1.5 text-[11px] mb-2" dir="ltr">
                  <div className="flex items-center justify-between flex-wrap gap-1">
                    <span className="hash text-ink">{tsQuote.inUnits?.toLocaleString()} {tsRoute?.from} → <span className="font-bold text-emerald">{((tsQuote.outUnits ?? 0) / (ts?.scales?.[tsRoute?.to ?? ""] ?? 1000)).toLocaleString()} {tsRoute?.to}</span></span>
                    <span className={cn("hash text-[10px] px-1 rounded", tsQuote.feeBps === 0 ? "text-emerald bg-emerald/10" : "text-gold bg-gold/10")}>fee {tsQuote.feeBps}bps</span>
                    <span className="hash text-[10px] text-ink-2">impact {tsQuote.impactPct ?? "—"}%</span>
                  </div>
                  <div className="text-[9px] text-ink-2 mt-0.5">price {tsQuote.priceBefore} → {tsQuote.priceAfter} (out/in) · cap {tsQuote.cap?.toLocaleString()} book-units</div>
                </div>
              ) : tsAmt && parseFloat(tsAmt) > 0 ? (
                <div className="text-[10px] text-ink-2 mb-2">מחשב-ציטוט…</div>
              ) : null}

              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={tsDoSwap}
                  disabled={!tsQuote?.ok || !tsQuote?.capOk || tsBusy}
                  className={cn(
                    "rounded px-3 py-1.5 text-xs font-bold transition-colors",
                    tsQuote?.ok && tsQuote?.capOk && !tsBusy
                      ? "bg-emerald text-background hover:bg-emerald/85 cursor-pointer"
                      : "bg-ink-2/30 text-ink-2 cursor-not-allowed"
                  )}
                >
                  {tsBusy ? "מבצע-על-הספר…" : "החלף-על-הרשת-שלנו"}
                </button>
                {tsQuote?.ok && !tsQuote?.capOk ? <span className="text-[10px] text-rose">חורג-מתקרת-30% מהעתודה (מגן-מחיר)</span> : null}
                {tsMsg ? <span className={cn("text-[10px]", tsMsg.ok ? "text-emerald" : "text-rose")}>{tsMsg.text}</span> : null}
              </div>

              {/* סוואפים-אמת-אחרונים על-הרשת */}
              {ts.swaps.length > 0 ? (
                <div className="mt-2 pt-2 border-t border-emerald/15">
                  <div className="text-[9px] text-ink-2 mb-1">סוואפים-אמת-אחרונים (על-הספר-הריבוני):</div>
                  <div className="space-y-0.5 max-h-20 overflow-y-auto pe-1">
                    {ts.swaps.slice(0, 4).map((s, i) => (
                      <div key={s.at + i} className="text-[10px] flex items-center gap-1.5 flex-wrap" dir="ltr">
                        <span className="hash text-ink-2">{fmtClock(s.at)}</span>
                        <span className="hash text-ink">{s.taker}</span>
                        <span className="hash text-emerald">{s.inHuman} {s.inSym} → {s.outHuman} {s.outSym}</span>
                        <span className="hash text-[9px] text-ink-2">fee {s.feeBps}bps</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>

            {/* ── עדות-הגיבוי-החיה (כנות מעל הכל) ── */}
            <div className="rounded-lg bg-gold/5 border border-gold/25 p-3">
              <div className="flex items-center gap-2 flex-wrap mb-2">
                <div className="text-[11px] font-bold text-ink">עדות-הגיבוי — TRX-אמת על-השרשרת</div>
                <button
                  onClick={tsDoAttest}
                  disabled={tsAttesting}
                  className={cn(
                    "ms-auto rounded px-2 py-1 text-[10px] font-bold transition-colors",
                    tsAttesting ? "bg-ink-2/30 text-ink-2 cursor-wait" : "bg-gold/15 text-gold hover:bg-gold/25 cursor-pointer"
                  )}
                >
                  {tsAttesting ? "מודד-דלתות-חי (~דקה)…" : "מדוד-שוב-חי"}
                </button>
              </div>
              {ts.attest ? (
                <>
                  <div className="grid grid-cols-2 gap-2 mb-2">
                    <div className="rounded bg-ink-2/30 px-2 py-1.5">
                      <div className="text-[9px] text-ink-2">TRX-אמת-נמדד (פרוטוקול-קריאה-כפולה)</div>
                      <div className="hash text-[11px] text-ink">{ts.attest.totalTrx} TRX ≈ ${ts.attest.totalUsd ?? "—"}</div>
                      <div className="hash text-[9px] text-ink-2">{fmtClock(ts.attest.at)}</div>
                    </div>
                    <div className="rounded bg-ink-2/30 px-2 py-1.5">
                      <div className="text-[9px] text-ink-2">אספקת-WTRX-על-הספר · יחס-גיבוי</div>
                      <div className="hash text-[11px] text-ink">{ts.attest.bookSupplyTrx.toLocaleString()} TRX</div>
                      <div className={cn("hash text-[10px]", (ts.attest.backing.ratio ?? 0) >= 0.99 ? "text-emerald" : "text-gold")}>ratio {ts.attest.backing.ratio ?? "—"}</div>
                    </div>
                  </div>
                  <div className="h-1.5 rounded-full bg-ink-2/30 overflow-hidden mb-1" role="progressbar" aria-valuenow={Math.round((ts.attest.backing.ratio ?? 0) * 100)} aria-valuemin={0} aria-valuemax={100}>
                    <div className={cn("h-full rounded-full", (ts.attest.backing.ratio ?? 0) >= 0.99 ? "bg-emerald" : "bg-gold")} style={{ width: `${Math.min(100, Math.round((ts.attest.backing.ratio ?? 0) * 100))}%` }} />
                  </div>
                  <div className="space-y-0.5 mb-2 max-h-16 overflow-y-auto pe-1">
                    {ts.attest.doors.map((d) => (
                      <div key={d.address} className="text-[10px] flex items-center gap-1.5" dir="ltr">
                        <span className={cn("hash text-[9px] px-1 rounded", d.honest === "ok" ? "text-emerald bg-emerald/10" : "text-rose bg-rose/10")}>{d.honest}</span>
                        <span className="hash text-ink">{d.address.slice(0, 12)}…</span>
                        <span className="hash text-ink-2 ms-auto">{d.trx} TRX {d.role ? `· ${d.role}` : ""}</span>
                      </div>
                    ))}
                  </div>
                  <p className="text-[9px] text-ink-2 leading-relaxed">
                    כנות: האספקה כוללת מימושים-מורשתים (ct94/95) שחלקם יושב על דלתות-נעולות (מנומניק אבד ברולבק-115 — גיבוי-טרום-רולבק של agent/keys/tron-mnemonic.txt מרפא). הפער מפורסם — לא מתחת-לשטיח. הפקדות-חדשות לדלתות-v2 מטופלות אוטומטית ב-THE-DEPOSITS.
                  </p>
                </>
              ) : (
                <div className="text-[10px] text-ink-2">אין-עדות-טרייה — לחץ ״מדוד-שוב-חי״</div>
              )}
            </div>
          </div>

          {/* ── הבריכות ── */}
          <div className="mt-3">
            <div className="text-[11px] text-ink-2 mb-1.5 flex items-center gap-1.5">
              <Boxes className="size-3 text-emerald" /> בריכות-ה-AMM על-הספר (חיות-בלבד · ממוינות-לפי-עומק)
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5 max-h-40 overflow-y-auto pe-1">
              {ts.pools.slice(0, 9).map((p) => (
                <div key={p.pair} className="rounded bg-ink-2/30 px-2 py-1.5 flex items-center gap-2 flex-wrap" dir="ltr">
                  <span className="hash text-[11px] font-bold text-ink">{p.pair}</span>
                  <span className={cn("hash text-[9px] px-1 rounded", p.feeBps === 0 ? "text-emerald bg-emerald/10" : "text-gold bg-gold/10")}>{p.feeBps}bps</span>
                  <span className="hash text-[10px] text-ink-2">{p.reserveA} {p.symA} · {p.reserveB} {p.symB}</span>
                  {p.depthUsd !== null ? <span className="hash text-[10px] text-ink ms-auto">${p.depthUsd}</span> : null}
                </div>
              ))}
            </div>
          </div>

          {/* ── המהפכה-בשורה-אחת: מה-השתחררנו-ממנו ── */}
          <div className="mt-3 rounded bg-emerald/5 border border-emerald/20 px-2.5 py-2 text-[10px] leading-relaxed">
            <span className="font-bold text-ink">המהפכה-הריבונית (מדוד מול-החלופות):</span>{" "}
            <span className="text-emerald">עמלה 0% (ספק-חוץ: 30bps+פיזור ~18% על רגל-$1)</span> ·{" "}
            <span className="text-emerald">מינימום 0 (ספק-חוץ: ~$15-מדומה)</span> ·{" "}
            <span className="text-emerald">התיישבות מיידית על הספר שלנו (ספק-חוץ: 10-60 דק׳)</span> ·{" "}
            <span className="text-emerald">אפס-אנרגיה-טרון (שם: ~65k-אנרגיה להעברת-TRC20)</span> —{" "}
            המערך מארח מטבע-אמת ומחליף אותו בבית. המפה-המלאה: docs/117-LIMITS.md
          </div>
        </Panel>
      ) : null}

      {/* מדדי-לב */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <Stat label="גובה-השרשרת" value={node?.height ? `#${node.height.toLocaleString()}` : "—"} sub={node?.updatedAt ? "עודכן " + fmtClock(node.updatedAt) : undefined} accent />
        <Stat label="SAOS-דולר (נגזר)" value={saosUsd !== null ? fmtUsd(saosUsd) : "—"} sub="מיד-הספר × ציטוט-STEEM-על-הספר" />
        <Stat label="פעימות" value={node?.beats ? node.beats.toLocaleString() : "—"} sub="דופק-הצומת" />
        {/* 105 — רק-המספר-האמיתי: הקרנה-יומית (extrapolatedDay) איננה ספירה — לא מתחפשת לספירה */}
        <Stat label="מנוע-הגריד" value={tr?.tradesTotal ? tr.tradesTotal.toLocaleString() : "—"} sub={tr?.tradesToday ? tr.tradesToday + " עסקאות-היום · " + (tr.ratePerMin ?? "—") + "/דק' · " + trSource : "מנוע-הזרימה-האוטונומי"} />
      </div>

      {/* זירת-GRID-98 — מקור-האמת: פנקס-המנוע-החי (103) */}
      {tr ? (
        <Panel className="mb-6" glow>
          <div className="flex items-center gap-2 mb-4">
            <Swords className="size-4 text-gold" />
            <h3 className="font-display font-bold text-ink">זירת-GRID-98</h3>
            <LiveDot tone={(tr.paused ?? null) ? "rose" : engLive ? "green" : "gold"} className="ms-1" />
            <span className="text-[11px] text-ink-2">
              {(tr.paused ?? null) ? "מושהה — " + tr.paused : engLive ? "מסחר-חי (פנקס בן " + (eng?.ageSec ?? "?") + " ש׳)" : "פנקס-סטלה (" + Math.round((eng?.ageSec ?? 0) / 60) + " ד׳) — ה-guardian משכים"}
            </span>
            {tr.height ? <span className="hash text-[11px] text-ink-2 ms-auto">פנקס h{tr.height}</span> : null}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <Stat label="רווח-אוצר (SAOS)" value={pnlSAOS !== undefined && pnlSAOS !== null ? fmt(pnlSAOS) : "—"} sub={pnlUsd !== null ? "≈ " + fmtUsd(pnlUsd) + " · היום " + fmt(pnlToday) + " SAOS" : undefined} accent />
            <Stat label="עסקאות-היום" value={tr.tradesToday ?? "—"} sub={"קצב " + (tr.ratePerMin ?? "—") + "/דק' · " + trSource} />
            <Stat label="צעדי-מדרגה" value={(tr.steps ?? []).length} sub={tr.floor ? "רצפה " + fmt(tr.floor, 5) : undefined} />
            <Stat label="בריכות-דקס" value={tradeableCount || "—"} sub={anchoredCount + "/" + tradeableCount + " מעוגנות-לאורקל"} />
          </div>
          {board.length > 0 ? (
            <div>
              <div className="text-[11px] text-ink-2 mb-2 flex items-center gap-1.5">
                <Flame className="size-3 text-gold" /> לוח-הובלה — חיילים לפי-רווח (SAOS מדוד)
              </div>
              <div className="flex flex-wrap gap-2">
                {board.slice(0, 8).map((s, i) => (
                  <span key={s.name} className={cn("panel px-3 py-1.5 text-xs flex items-center gap-2", i === 0 && "panel-glow")}>
                    <span className="hash text-ink-2">#{i + 1}</span>
                    <span className="font-bold text-ink">{s.name}</span>
                    <span className="hash text-emerald">+{fmt(s.saos, 3)}</span>
                  </span>
                ))}
              </div>
            </div>
          ) : null}
          {/* 107 — מה-שהקוד-מכיל-והדף-לא-הציג: תקרת-היכולת-המדודה + מגני-המנוע-הכנים */}
          {eng?.bench?.txsPerSec ? (
            <div className="mt-3 rounded-lg border border-emerald/30 bg-emerald/[0.05] px-3 py-2 text-[11px] leading-relaxed">
              <span className="font-semibold text-ink">תקרת-היכולת-המכנית (מדוד-חי):</span>{" "}
              <span className="font-mono text-emerald">{eng.bench.txsPerSec.toLocaleString()}</span> טרנז/שנייה ≈{" "}
              <span className="font-mono text-emerald">{(eng.bench.capabilityPerDay ?? 0) >= 1e9 ? ((eng.bench.capabilityPerDay ?? 0) / 1e9).toFixed(1) + " מיליארד" : Math.round((eng.bench.capabilityPerDay ?? 0) / 1e6) + "M"}</span>/יום{" "}
              <span className="text-ink-2">(replay על-טרנזאקציות-אמת מהארכיון · מדוד {eng.bench.at ? fmtAgoShort(eng.bench.at) : "—"} זמן · הקצב-החי-חסום-כלכלה-ותקציבים, לא-מכניקה)</span>
            </div>
          ) : null}
          {eng?.skippedForEdge != null || eng?.rejected != null ? (
            <p className="text-[11px] text-ink-2 mt-2 leading-relaxed">
              <span className="font-semibold text-ink">מגני-המנוע (ספירות-כנות מהפנקס):</span> נדחו-על-ידי-מגנים{" "}
              <span className="font-mono">{(eng?.rejected ?? 0).toLocaleString()}</span> · דולגו-קצה{" "}
              <span className="font-mono">{(eng?.skippedForEdge ?? 0).toLocaleString()}</span> · דליפת-קצה-מתועדת{" "}
              <span className="font-mono">{(eng?.edgeLeak ?? 0).toLocaleString()}</span> — כל-פעולה-שנחסמה היא משמעת-רווחיות, לא-אובדן
            </p>
          ) : null}
        </Panel>
      ) : null}

      {/* 103 — חדר-החיילים: הגדרות-מסודרות · קישוריות · RC-חי · רווח-דקס */}
      {fleet && fleet.soldiers && fleet.soldiers.length > 0 ? (
        <Panel className="mb-6">
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <Users className="size-4 text-gold" />
            <h3 className="font-display font-bold text-ink">חדר-החיילים — הגדרות-מסודרות · אוטונומיים</h3>
            <span className={cn("ms-auto inline-flex items-center gap-1.5 text-[11px]", fleet.linkedHive === fleet.soldiersTotal ? "text-emerald" : "text-gold")}>
              <ShieldCheck className="size-3.5" />
              קישוריות-Hive {fleet.linkedHive}/{fleet.soldiersTotal} · ראש RC {fleet.headRcPct ?? "?"}%
            </span>
          </div>
          <div className="max-h-96 overflow-y-auto space-y-1.5 pe-1">
            {(fleet.soldiers as any[]).map((s) => (
              <div key={s.username} className="flex items-center gap-2 text-xs px-2.5 py-1.5 rounded-lg bg-ink-2/30">
                <span className="font-bold text-ink w-24 truncate" dir="ltr">@{s.username}</span>
                <span className={cn("hash text-[10px] px-1.5 rounded", s.steemLinked ? "text-emerald bg-emerald/10" : "text-rose bg-rose/10")}>STEEM {s.steemLinked ? "קשור" : "—"}</span>
                <span className={cn("hash text-[10px] px-1.5 rounded", s.hiveLinked ? "text-emerald bg-emerald/10" : "text-gold bg-gold/10")}>HIVE {s.hiveLinked ? "קשור" : "ממתין"}</span>
                <span className={cn("hash text-[10px] w-16 text-end", (s.hiveRcPct ?? 0) >= 8 ? "text-emerald" : (s.hiveRcPct ?? 0) > 0 ? "text-rose" : "text-ink-2")}>RC {s.hiveRcPct != null ? s.hiveRcPct + "%" : "?"}</span>
                <span className="hash text-[10px] text-ink-2 w-14 text-end">HP {s.hiveHp ?? "?"}</span>
                <span className="hash text-[10px] text-ink-2 w-12 text-end">פעימות {s.seqToday ?? 0}</span>
                {s.dexPnlSAOS != null && s.dexPnlSAOS > 0 ? <span className="hash text-[10px] text-emerald ms-auto">דקס +{fmt(s.dexPnlSAOS, 3)}</span> : <span className="ms-auto" />}
              </div>
            ))}
          </div>
          {fleet.settings ? (
            <p className="text-[11px] text-ink-2 mt-3 leading-relaxed">
              <span className="font-semibold text-ink">הגדרות-ריבוניות:</span> רצפת-שידור-RC {fleet.settings.rcFloorPct}% (op-כבד {fleet.settings.rcHeavyPct}%) · כושר-נשיאה {fleet.settings.carryingCapacity} · <span className="font-semibold text-ink">הבראה-אוטונומית:</span> {fleet.settings.healGate}
              {fleet.settings.healLastGate ? <> · שער-אחרון: {fleet.settings.healLastGate.reason} (ETA ~{fleet.settings.healLastGate.etaH}ש׳)</> : null}
              {fleet.settings.healLeverWeak ? " · המנוף-נמדד-חלש — ההבראה-נעצרה-בכנות" : null}
            </p>
          ) : null}
        </Panel>
      ) : null}

      {/* 102 — צמדי-הדקס: יחס-בריכה מול-אורקל — אפס-מחירים-מנותקים */}
      {pairRows.length > 0 ? (
        <Panel className="mb-6">
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <Scale className="size-4 text-gold" />
            <h3 className="font-display font-bold text-ink">צמדי-הדקס — מעוגנים-מול-האורקל-על-הספר</h3>
            <span className={cn("ms-auto inline-flex items-center gap-1.5 text-[11px]", poolAnchorOk ? "text-emerald" : "text-gold")}>
              {poolAnchorOk ? <ShieldCheck className="size-3.5" /> : <TriangleAlert className="size-3.5" />}
              {anchoredCount}/{tradeableCount} מעוגנים (סטייה ≤5%)
            </span>
          </div>
          <div className="space-y-2">
            {pairRows.map(({ pair, row }) => (
              <PairRow key={pair} pair={pair} row={row} saosUsd={saosUsd} />
            ))}
          </div>
          <p className="text-[11px] text-ink-2 mt-4 leading-relaxed">
            יחס-הבריכה הוא-מחיר-הדקס בפועל; האורקל-הוא-ציטוט-השוק-החתום-על-הספר (asset_price · ref-חתום · coingecko). הסטייה-מוצגת-בחושבן-חי — בריכה-שלדית (אבק-µ) מסומנת-ולא-מייצגת-מחיר.
          </p>
        </Panel>
      ) : null}

      {/* מטבעות-עטופים אמיתיים — ציטוט-אורקל + כיסוי */}
      <Panel className="mb-6">
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <Boxes className="size-4 text-gold" />
          <h3 className="font-display font-bold text-ink">מטבעות-עטופים — כיסוי-חי מול-השרשרת-האם</h3>
          {underBacked > 0 ? (
            <span className="ms-auto inline-flex items-center gap-1.5 text-[11px] text-rose">
              <TriangleAlert className="size-3.5" /> {underBacked} מטבעות-תחת-מגובה
            </span>
          ) : (
            <span className="ms-auto inline-flex items-center gap-1.5 text-[11px] text-emerald">
              <ShieldCheck className="size-3.5" /> הכל-מגובה
            </span>
          )}
        </div>
        {wRows.length === 0 ? (
          <EmptyState title="אין-מטבעות-עטופים עדיין" sub="הגשר-יזריע-משימות-מינט-ראשונות עם-המדידות-החיות-הבאות" />
        ) : (
          <div className="space-y-2">
            {wRows.map(({ sym, w }) => (
              <WrappedRowCard
                key={sym}
                sym={sym}
                w={w}
                meta={meta?.[sym] ?? null}
                usd={pxToUsd(prices?.[sym]?.px)}
                priceAt={prices?.[sym]?.at ?? null}
                priceSrc={prices?.[sym]?.src ?? null}
              />
            ))}
          </div>
        )}
        <p className="text-[11px] text-ink-2 mt-4 leading-relaxed">
          כל-מינט נושא ref של עוגן-חי בשרשרת-האם (blurt:lock:&lt;txid&gt; · tron:lock:&lt;txid&gt;) — הכיסוי נמדד-מחדש ומפוסק-אטומית בכל-פעימת-פיוס. המחיר-המוצג הוא-ציטוט-האורקל-על-הספר (לא-מחיר-בריכה-פנימית).
        </p>
      </Panel>

      {/* 102 — שווי-ורווחיות: מה-בעל-ערך · מה-מפיק-ערך — הכל-מדוד-מאומת */}
      <Panel className="mb-6">
        <div className="flex items-center gap-2 mb-4">
          <Wallet className="size-4 text-gold" />
          <h3 className="font-display font-bold text-ink">שווי-ורווחיות — מה יש לנו ומה מפיק ערך</h3>
          <span className="text-[11px] text-ink-2 ms-auto">הכל-מדוד-מהספר · אפס-המצאות</span>
        </div>
        <div className="grid md:grid-cols-3 gap-4">
          {/* נכסים-חוץ-נעולים (גיבוי-מלא של המטבעות-העטופים) */}
          <div>
            <div className="text-[11px] text-gold font-bold uppercase tracking-widest mb-2 hash">נעול-חוץ (גיבוי-מלא)</div>
            <div className="space-y-1.5">
              {realLocks.map((r) => (
                <div key={r.sym} className="flex items-center justify-between text-[13px] gap-2">
                  <span className="hash text-ink-2">{r.sym}</span>
                  <span className="min-w-0 truncate">
                    <span className="text-ink">{fmt(r.units)}</span>
                    <span className="text-ink-2 text-[11px]"> · </span>
                    <span className={cn("hash", r.usd === null ? "text-ink-2" : "text-emerald")}>{r.usd === null ? "אין-ציטוט" : fmtUsd(r.usd)}</span>
                  </span>
                </div>
              ))}
              <div className="flex items-center justify-between text-[13px] border-t border-white/10 pt-1.5 mt-1">
                <span className="font-bold text-ink">סה״כ-נעול</span>
                <span className="hash font-bold text-emerald">{fmtUsd(locksTotal)}</span>
              </div>
            </div>
          </div>
          {/* יתרות-נזילות-מדודות-חי */}
          <div>
            <div className="text-[11px] text-gold font-bold uppercase tracking-widest mb-2 hash">יתרות-נזילות (מדוד-חי)</div>
            <div className="space-y-1.5">
              {liquidRows.length === 0 ? <div className="text-[12px] text-ink-2">אין-מדידה-חיה-קיימת</div> : null}
              {liquidRows.map((r) => (
                <div key={r.sym} className="flex items-center justify-between text-[13px] gap-2">
                  <span className="hash text-ink-2">{r.sym}</span>
                  <span className="min-w-0 truncate">
                    <span className="text-ink">{fmt(r.units)}</span>
                    <span className="text-ink-2 text-[11px]"> · </span>
                    <span className={cn("hash", r.usd === null ? "text-ink-2" : "text-emerald")}>{r.usd === null ? "אין-ציטוט" : fmtUsd(r.usd)}</span>
                  </span>
                </div>
              ))}
              {beeUnpriced > 0 ? (
                <div className="flex items-center justify-between text-[13px] gap-2">
                  <span className="hash text-ink-2">BEE</span>
                  <span className="text-ink-2 text-[11px]">{fmt(beeUnpriced)} · אין-ציטוט — לא-נכלל</span>
                </div>
              ) : null}
              <div className="flex items-center justify-between text-[13px] border-t border-white/10 pt-1.5 mt-1">
                <span className="font-bold text-ink">סה״כ-נזיל-מדוד</span>
                <span className="hash font-bold text-emerald">{fmtUsd(liquidTotal)}</span>
              </div>
            </div>
          </div>
          {/* מפיקי-ערך */}
          <div>
            <div className="text-[11px] text-gold font-bold uppercase tracking-widest mb-2 hash">מפיקי-ערך (מדוד)</div>
            <div className="space-y-1.5 text-[13px]">
              <div className="flex items-center justify-between gap-2">
                <span className="text-ink-2">רווח-אוצר-גריד</span>
                <span className="min-w-0 truncate text-end">
                  <span className="hash text-emerald font-bold">{pnlSAOS !== null ? "+" + fmt(pnlSAOS) : "—"} SAOS</span>
                  {pnlUsd !== null ? <span className="text-ink-2 text-[11px]"> ≈ {fmtUsd(pnlUsd)}</span> : null}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-ink-2">רווח-היום</span>
                <span className="hash text-emerald">{pnlToday !== null ? "+" + fmt(pnlToday) : "—"} SAOS</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-ink-2">עמלות-פרוטוקול (מצטבר)</span>
                <span className="hash text-ink">{tr?.feeIncomeSAOS != null ? fmt(tr.feeIncomeSAOS, 3) + " SAOS" : "—"}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-ink-2">סולם-מדרגות (רצפה)</span>
                <span className="hash text-ink">{floorPx ? fmt(floorPx, 5) + " STEEM" : "—"}{stepsCount ? " · " + stepsCount + " צעדים" : ""}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-ink-2">עוגני-ציבור (Steem/Hive/Blurt)</span>
                <span className="hash text-emerald">אפס-עמלה · RC בלבד</span>
              </div>
            </div>
          </div>
        </div>
        <div className="mt-4 pt-3 border-t border-white/10 flex flex-wrap items-center gap-x-6 gap-y-1.5 text-[13px]">
          <span className="text-ink-2">שווי-חוץ-מדוד-כולל (נעול+נזיל):</span>
          <span className="hash font-bold text-gold text-base">{fmtUsd(extTotal)}</span>
          <span className="text-[11px] text-ink-2">· הרווח-הפנימי (SAOS) נספר-בנפרד — הוא-ביט-המטבע-שלנו, לא-חוב-דולרי</span>
        </div>
      </Panel>

      {/* 102 — עדות-הפיוס: הסינתטיקה-הרדומים — כנות-מלאה על-מה-שהיה-שגוי */}
      {t102?.synthetic && Object.keys(t102.synthetic).length > 0 ? (
        <Panel className="mb-6">
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            {unitReconOk && !retiredStillFat ? <ShieldCheck className="size-4 text-emerald" /> : <TriangleAlert className="size-4 text-gold" />}
            <h3 className="font-display font-bold text-ink">עדות-פיוס-יחידות — הסינתטיקה-שהושבתו</h3>
            <span className="hash text-[10px] text-ink-2 ms-auto" dir="ltr">refs recon104:*</span>
          </div>
          <p className="text-[12px] text-ink-2 mb-3 leading-relaxed">
            ארבעה-סינתטיקה (WBTC · WETH · WXRP · WDOGE) נרשמו-במקור עם ״נעולים״ ביחידות-<span className="text-ink">ביטחונות</span> (STEEM) — ולא ביחידות-מטבע. המוטבע-האמת-מהעדות-החיה (למשל 7e-8 BTC מול 0.06 STEEM) קטן-מרזולוציית-ה-µ של הספר → העודף נשרף-על-הספר-עצמו והמטבעות הושבתו. עסקאות-הנעילה-האמיתיות-על-Steem נשארות-מתועדות.
          </p>
          <div className="grid sm:grid-cols-2 gap-2">
            {Object.entries(t102.synthetic).map(([sym, s]) => (
              <div key={sym} className="panel px-3.5 py-2.5 text-[12px]">
                <div className="flex items-center gap-2">
                  <span className="hash font-bold text-ink">{sym}</span>
                  <span className={cn("hash text-[10px] px-1.5 py-0.5 rounded border", s.dormant ? "text-emerald border-emerald/30 bg-emerald/5" : "text-gold border-gold/30 bg-gold/5")}>
                    {s.dormant ? "רדום" : "בפיוס"}
                  </span>
                  <span className="text-ink-2 ms-auto">{s.coin}</span>
                </div>
                <div className="text-ink-2 mt-1 flex flex-wrap gap-x-3">
                  <span>ביטחונות: <span className="text-ink">{s.collateral ?? "—"}</span></span>
                  <span>מוטבע-אמת: <span className="hash text-ink" dir="ltr">{s.mintedTruth ?? "—"}</span></span>
                  {s.chainSupply != null ? <span>שארית-על-הספר: <span className="hash text-ink-2" dir="ltr">{s.chainSupply}</span></span> : null}
                </div>
                {s.lockRef ? (
                  <div className="hash text-[10px] text-ink-2/60 mt-1 truncate" dir="ltr" title={s.lockRef}>lock {String(s.lockRef).slice(0, 18)}…</div>
                ) : null}
              </div>
            ))}
          </div>
        </Panel>
      ) : null}

      {/* 100 — לוח-האמת: מה-סגור-ומה-פתוח — כל-טענה מול-הרשת בזמן-אמת */}
      <Panel className="mb-6">
        <div className="flex items-center gap-2 mb-3">
          <ShieldCheck className="size-4 text-gold" />
          <h3 className="font-display font-bold text-ink">לוח-האמת — מה-סגור-ומה-פתוח</h3>
          <span className="text-[11px] text-ink-2 ms-auto">נגזר-חי-מהצומת · לא-מטקסט</span>
        </div>
        <div>
          <TruthRow
            state={wblurtRow && wblurtRow.b > 0 ? "closed" : "open"}
            what="בריכת-WBLURT/SAOS"
            detail={
              wblurtRow && wblurtRow.b > 0 ? (
                <>
                  דו-צדדית ומסחרת — {fmt(wblurtRow.a)} WBLURT + {fmt(wblurtRow.b)} SAOS @ יחס {fmt(wblurtRow.ratio, 2)} · <span className="hash">ref g100:fill:WBLURT/SAOS</span>
                </>
              ) : (
                <>חד-צדדית (b=0) — ההשלמה-האוטונומית ממתינה-לתדלוק-אוצר</>
              )
            }
          />
          <TruthRow
            state={poolAnchorOk ? "closed" : "open"}
            what="עיגון-בריכות-הדקס-מול-האורקל"
            detail={
              poolAnchorOk ? (
                <>
                  כל-הצמדים-החיים ({anchoredCount}/{tradeableCount}) בסטייה ≤5% מציטוט-השוק-החתום — <span className="hash">refs rebal102:* · rean103:*</span>
                </>
              ) : (
                <>
                  {anchoredCount}/{tradeableCount} מעוגנים — בריכה-מנותקת-מהאורקל תסומן-כאן-בכנות
                </>
              )
            }
          />
          <TruthRow
            state={unitReconOk && !retiredStillFat ? "closed" : "open"}
            what="פיוס-יחידות-הבסיס (WBTC·WETH·WXRP·WDOGE)"
            detail={
              unitReconOk && !retiredStillFat ? (
                <>
                  העודף-שנופח (עד ×843,000) נשרף-על-הספר-עצמו · המטבעות-רדומים-בכנות · <span className="hash">refs recon104:*</span>
                </>
              ) : (
                <>הפיוס-על-הספר-בתהליך — המצב-החי-למעלה (עדות-הסינתטיקה)</>
              )
            }
          />
          {/* 105 — סף-מכויל-לקצב: מיכסה 3/24ש' (107) → פער-תקין עד ~חלון-מלא (26ש');
           * סף-ה-6ש' הישן היה אזעקת-שווא-מתוכננת (סף < קצב = שקר-מכונה). */}
          <TruthRow
            state={pulseAge < 0.5 ? (anchorAge < 26 ? "closed" : "open") : anchorAge < 38 ? "open" : "warn"}
            what={"עוגן-TRON" + (tron?.squad?.lastRing?.id ? ` (טבעת#${tron.squad.lastRing.id})` : "")}
            detail={
              <>
                דופק-גשר חי{tron?.pulse?.tronHeight ? (
                  <>
                    {' '}· blk <span className="hash">{tron.pulse.tronHeight.toLocaleString()}</span> · {fmtAgo(tron?.pulse?.at)}
                  </>
                ) : null} · עוגן-אחרון cp#{tron?.lastAnchor?.cpHeight ?? "?"} {fmtAgo(tron?.at)} · מיכסה 3/24ש׳ · בחירת-מקור-לפי-רוחב-פס (107)
              </>
            }
          />
          {/* 105 — קצב-עוגן-זהות 6 ש׳ → סגור-עד 12 ש׳ (2×קצב) — לא 3 ש׳ */}
          <TruthRow
            state={blurtTid ? (blurtAge < 12 ? "closed" : blurtAge < 24 ? "open" : "warn") : "warn"}
            what="חוט-Blurt (השרשרת-הרביעית)"
            detail={
              blurtTid ? (
                <>
                  עוגן-אחרון {fmtAgo(blurtAt)} ·{" "}
                  <a href={`https://blurtwallet.com/tx/${blurtTid}`} target="_blank" rel="noreferrer" className="hash hover:text-gold transition-colors" dir="ltr">
                    {String(blurtTid).slice(0, 14)}…
                  </a>
                </>
              ) : (
                <>אין-עוגן-בלורט-שנקלט — הפעימה-הבאה מנסה-שוב (3-צמתים-חיים)</>
              )
            }
          />
          <TruthRow
            state={underBacked === 0 ? "closed" : "warn"}
            what="כיסוי-המטבעות-העטופים"
            detail={underBacked === 0 ? <>כל-המטבעות-עם-היצע-חי מגובים ≥99% מול-השרשרת-האם</> : <>{underBacked} מטבעות-תחת-מגובה — נמדד-חי למעלה</>}
          />
          <TruthRow
            state={engLive ? "closed" : "open"}
            what="מנוע-הגריד-חי (103)"
            detail={
              engLive ? (
                <>
                  פנקס-המנוע בן <span className="hash">{eng?.ageSec ?? "—"}</span> ש׳ (טיק-כל-8ש׳) · guardian-מפקח-עליו-כל-10-דק׳ · <span className="hash">{tr?.tradesTotal ?? "—"}</span> עסקאות-קאנון
                </>
              ) : (
                <>פנקס-סטלה ({eng?.ageSec != null ? Math.round(eng.ageSec / 60) : "?"} ד׳) — ה-guardian-משכים-אוטומטית (ENGINE-REVIVED ב-guardian.log)</>
              )
            }
          />
          <TruthRow
            state={fleet && fleet.soldiersTotal != null && fleet.linkedHive === fleet.soldiersTotal ? "closed" : "open"}
            what="משמעת-RC-וקישוריות-החיילים (103)"
            detail={
              fleet ? (
                <>
                  קישוריות-Hive {fleet.linkedHive}/{fleet.soldiersTotal} · ראש RC {fleet.headRcPct ?? "?"}% · כל-שידורי-Hive מאחורי-שער-תקציב ({fleet.settings?.rcFloorPct ?? 8}%-רצפה) · הבראת-HP אוטונומית{fleet.settings?.healLastGate?.etaH != null ? <> · ETA ~{fleet.settings.healLastGate.etaH}ש׳</> : null}
                </>
              ) : (
                <>אין-דוח-צי-חי — הלולאה-תזין-בפעימה-הבאה</>
              )
            }
          />
        </div>
      </Panel>

      {/* עוגנים-תלת-שרשרתיים + גשר-Tron */}
      <div className="grid md:grid-cols-2 gap-3">
        <Panel>
          <div className="flex items-center gap-2 mb-3">
            <ArrowLeftRight className="size-4 text-gold" />
            <h3 className="font-display font-bold text-ink">עוגנים-ציבוריים חיים</h3>
          </div>
          {live ? (
            <div>
              <AnchorRow chain="Steem" txid={live.anchorId?.txids?.steem ?? live.weaveSeal?.txids?.steem ?? null} at={live.anchorId?.at ?? live.weaveSeal?.at} tone="green" />
              <AnchorRow chain="Hive" txid={live.anchorId?.txids?.hive ?? live.weaveSeal?.txids?.hive ?? null} at={live.anchorId?.at ?? live.weaveSeal?.at} tone="gold" />
              <AnchorRow chain="Blurt" txid={live.anchorId?.txids?.blurt ?? live.revive?.broadcast?.txid ?? live.blurt99?.anchor?.txid ?? null} at={live.anchorId?.txids?.blurt ? live.anchorId?.at : live.revive?.at ?? live.blurt99?.at} tone="green" />
              {live.blurt99?.post?.txid ? <AnchorRow chain="Blurt·פוסט" txid={live.blurt99.post.txid} at={live.blurt99.at} tone="gold" /> : null}
              {live.blurt99?.vote?.txid ? <AnchorRow chain="Blurt·הצבעה" txid={live.blurt99.vote.txid} at={live.blurt99.at} tone="gold" /> : null}
            </div>
          ) : (
            <EmptyState title="אין-עוגנים-שנרשמו-עדיין" sub="הפעימות-הבאות מעגנות-לשלוש-השרשראות" />
          )}
          <p className="text-[11px] text-ink-2 mt-3">
            כל-txid לחיץ → הראיה-הציבורית בסרק-הכתובות של-השרשרת-האם. מפתח-אחד חותם-על-הכל.
          </p>
        </Panel>
        <Panel>
          <div className="flex items-center gap-2 mb-3">
            <Coins className="size-4 text-gold" />
            <h3 className="font-display font-bold text-ink">גשר-Tron</h3>
            {tron ? <LiveDot tone={pulseAge < 0.5 ? "green" : pulseAge < 3 ? "gold" : "rose"} className="ms-1" /> : <LiveDot tone="gray" className="ms-1" />}
          </div>
          {tron ? (
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-[11px] text-ink-2 w-14">דופק</span>
                <LiveDot tone={pulseAge < 0.5 ? "green" : pulseAge < 3 ? "gold" : "rose"} />
                <span className="text-[11px] text-ink-2">
                  {tron.pulse?.tronHeight ? <>blk <span className="hash">{tron.pulse.tronHeight.toLocaleString()}</span> · {fmtAgo(tron.pulse.at)}</> : "—"}
                </span>
              </div>
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-[11px] text-ink-2 w-14">שולח</span>
                <HashText h={tron.address} head={12} tail={8} />
              </div>
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-[11px] text-ink-2 w-14">ממסר</span>
                <HashText h={tron.relay} head={12} tail={8} />
              </div>
              {tron.lastAnchor?.txid ? (
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-[11px] text-ink-2 w-14">עוגן</span>
                  <a href={`https://tronscan.org/#/transaction/${tron.lastAnchor.txid}`} target="_blank" rel="noreferrer" className="min-w-0 hover:text-gold transition-colors" dir="ltr">
                    <HashText h={tron.lastAnchor.txid} head={14} tail={10} />
                  </a>
                </div>
              ) : null}
              {Array.isArray((tron.squad as { members?: { address: string; balanceTrx?: number | null; activated?: boolean }[] })?.members) && (tron.squad as { members?: { address: string; balanceTrx?: number | null; activated?: boolean }[] }).members!.length > 0 ? (
                <div className="text-[11px] text-ink-2 pt-1">
                  חיילי-הגשר ({(tron.squad as { activated?: number }).activated ?? "?"}/{(tron.squad as { members?: unknown[] }).members!.length} פעילים): {(tron.squad as { members?: { address: string; balanceTrx?: number | null }[] }).members!.filter((s) => s.address).slice(0, 4).map((s) => s.address.slice(0, 8) + "… (" + fmt(s.balanceTrx, 3) + " TRX)").join(" · ")}
                </div>
              ) : null}
              {tron.squad?.lastRing ? (
                <div className="text-[11px] pt-1 flex items-center gap-1.5 flex-wrap">
                  <span className={cn("hash text-[10px] px-1.5 rounded", tron.squad.lastRing.zeroFee ? "text-emerald bg-emerald/10" : "text-gold bg-gold/10")}>
                    טבעת#{tron.squad.lastRing.id} · {tron.squad.lastRing.legs} רגליים · {tron.squad.lastRing.zeroFee ? "אפס-עמלה" : "עמלה-חיובית"} · שריפה {((tron.squad.lastRing.burnSun ?? 0) / 1e6).toFixed(6)} TRX
                  </span>
                  <span className="text-ink-2">· {tron.squad.ringsClosed ?? "?"} טבעות-סגורות-ומאומתות · הטבעת-מקושרת-לספר h{tron.squad.lastRing.notedHeight}</span>
                </div>
              ) : null}
            </div>
          ) : (
            <EmptyState title="מצב-הגשר-לא-נטען" sub="ה-watch-לופ מדווח-בפעימה-הבאה" />
          )}
        </Panel>
      </div>
    </div>
  );
}
