"use client";

/**
 * ledger — פנקס-הספר הריבוני · האקספלורר.
 *
 * עקרונות: כל-גובה, כל-פעולה וכל-חותמת — נגישים, ניתנים-לסינון, לחיפוש
 * ולשיתוף. טרנזקציות ככרטיסים-מובנים (לא JSON חתוך), ניווט-שרשרת
 * (הקודם/הבא/prevHash), עימוד מהחדש לאחור, והפרדה-כנה בין ריק לשגיאה.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  BookOpen,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Search,
  ShieldCheck,
  Fingerprint,
  Landmark,
  Eye,
  Activity,
  Pause,
  Play,
  Link2,
  FileJson,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { SectionHead, HashText, Spinner, EmptyState, ErrorState, OpChip, LiveDot, Tip, fmtClock } from "./primitives";
import {
  fetchBlock,
  fetchSearch,
  fetchCertificate,
  timeAgoHe,
  useBookPage,
  useTxPage,
  useStats,
  useWeaveStatus,
  type BlockFull,
  type TxRow,
} from "@/hooks/use-weave";
import { cn } from "@/lib/utils";

const PAGE = 50;
const OP_FILTERS: { id: string; label: string }[] = [
  { id: "all", label: "הכל" },
  { id: "stamp", label: "חותמות" },
  { id: "seal", label: "איטומים" },
  { id: "witness", label: "עדויות" },
  { id: "heartbeat", label: "פעימות" },
];

type TabId = "blocks" | "txs" | "stamps" | "seals";

export function Ledger({
  focusBlock,
  onVerify,
}: {
  focusBlock?: number | null;
  onVerify?: (h: string) => void;
}) {
  const { data: status } = useWeaveStatus();
  const { data: stats } = useStats();
  const nodeSealHeights = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of status?.nodeWeave?.seals || []) {
      if (s.root && s.height != null) m.set(String(s.root), Number(s.height));
    }
    return m;
  }, [status?.nodeWeave?.seals]);
  const [tab, setTab] = useState<TabId>("blocks");
  const [offset, setOffset] = useState(0);
  const [op, setOp] = useState("all");
  const [cpOnly, setCpOnly] = useState(false);
  const [live, setLive] = useState(true);
  const [q, setQ] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchHits, setSearchHits] = useState<{ kind: string; label: string; go: () => void }[]>([]);
  const [jump, setJump] = useState("");

  // מגירת-בלוק
  const [openH, setOpenH] = useState<number | null>(null);
  const [full, setFull] = useState<BlockFull | null>(null);
  const [busy, setBusy] = useState(false);

  const seals = status?.weave?.seals || [];

  // עימוד + סינון — כל-טאב בכתובת-משלו
  const blocksUrl = useMemo(
    () => `/api/weave/blocks?limit=${PAGE}&offset=${offset}${op !== "all" ? `&op=${op}` : ""}${cpOnly ? "&cp=1" : ""}`,
    [offset, op, cpOnly]
  );
  const txsUrl = useMemo(
    () => `/api/weave/txs?limit=${PAGE}&offset=${offset}${op !== "all" ? `&type=${op}` : ""}`,
    [offset, op]
  );

  const book = useBookPage(blocksUrl, 10000, live && tab === "blocks");
  const txPage = useTxPage(txsUrl, 12000, live && (tab === "txs" || tab === "stamps"));

  const open = useCallback(async (h: number) => {
    setOpenH(h);
    setBusy(true);
    setFull(null);
    const b = await fetchBlock(h);
    setFull(b);
    setBusy(false);
  }, []);

  // קישור-עומק: פתיחת-בלוק מה-URL / מהכותרת (אסינכרוני — חוק-ה-hooks)
  useEffect(() => {
    if (focusBlock != null) {
      const t = setTimeout(() => open(focusBlock), 0);
      return () => clearTimeout(t);
    }
  }, [focusBlock, open]);

  const goSearch = async (raw: string) => {
    const s = raw.trim();
    if (!s) return;
    setSearching(true);
    setSearchHits([]);
    const results = await fetchSearch(s);
    const hits: { kind: string; label: string; go: () => void }[] = [];
    for (const r of results) {
      if (r.kind === "stamp" && r.stamp) {
        const st = r.stamp;
        hits.push({
          kind: "חותמת",
          label: `#${st.seq} · ${st.kind} · ${st.by} · בלוק ${st.block}`,
          go: () => {
            open(st.block);
            setSearchHits([]);
            setQ("");
          },
        });
      } else if (r.kind === "block" && r.height != null) {
        hits.push({
          kind: "בלוק",
          label: `#${r.height}${r.time ? ` · ${fmtClock(r.time)}` : ""}`,
          go: () => {
            open(r.height!);
            setSearchHits([]);
            setQ("");
          },
        });
      } else if (r.kind === "seal" && r.seal) {
        hits.push({
          kind: "איטום",
          label: `#${r.seal.seq} · ${r.seal.count} עלים · ${fmtClock(r.seal.at)}`,
          go: () => {
            setTab("seals");
            setSearchHits([]);
            setQ("");
          },
        });
      }
    }
    if (hits.length === 0) {
      toast({ title: "לא נמצא", description: `אין חותמת, בלוק או איטום שמתאימים ל"${s}" — אפשר לחפש גובה (#679), hash, או seq` });
    }
    setSearchHits(hits);
    setSearching(false);
  };

  const doJump = () => {
    const n = Number(jump.replace("#", ""));
    if (Number.isFinite(n) && n >= 0) {
      open(n);
      setJump("");
    }
  };

  const step = (dir: 1 | -1) => setOffset((o) => Math.max(0, o + dir * PAGE));

  const tabDefs: { id: TabId; label: string; count?: number }[] = [
    { id: "blocks", label: "בלוקים", count: stats?.totalBlocks },
    { id: "txs", label: "פעולות", count: stats?.txTotal },
    { id: "stamps", label: "חותמות", count: stats?.totals?.stamps },
    { id: "seals", label: "איטומים", count: stats?.totals?.seals },
  ];

  return (
    <div>
      <SectionHead
        eyebrow="THE BOOK"
        title="פנקס-הספר הריבוני"
        icon={<BookOpen className="size-3.5" />}
        desc="כל בלוק וכל פעולה על הספר — ניתנים לצפייה, לסינון, לחיפוש ולשיתוף. מהג'נזיס ועד הבלוק האחרון. לחיצה על שורה פותחת את הבלוק המלא."
      />

      {/* רצועת-KPI — כל-מספר כניסה-למסונן */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-6">
        <StatCard label="בלוקים על הספר" value={stats?.totalBlocks ?? "—"} sub={`הגבוה: #${stats?.height ?? "—"}`} onClick={() => setTab("blocks")} active={tab === "blocks"} />
        <StatCard label="פעולות (טרנזקציות)" value={stats?.txTotal ?? "—"} sub={stats?.byType ? `${stats.byType.stamp ?? 0} חותמות · ${stats.byType.seal ?? 0} איטומים` : undefined} onClick={() => setTab("txs")} active={tab === "txs"} />
        <StatCard label="חותמות-קיום" value={stats?.totals?.stamps ?? "—"} sub={`${stats?.totals?.liveStamps ?? 0} חיות כרגע`} onClick={() => setTab("stamps")} active={tab === "stamps"} />
        <StatCard label="איטומים שעתיים" value={stats?.totals?.seals ?? "—"} sub={stats?.sealCadenceMin != null ? `קצב ממוצע: כל ${stats.sealCadenceMin} דק׳` : undefined} onClick={() => setTab("seals")} active={tab === "seals"} />
        <StatCard label="עדויות" value={stats?.totals?.witnesses ?? "—"} sub="קוורום נצבר על הספר" />
        <StatCard label="גז · סך-הכל" value={stats?.gasTotal != null ? stats.gasTotal.toLocaleString("he-IL") : "—"} sub={`${stats?.stamps24h ?? 0} חותמות ב-24 שע׳`} />
      </div>

      {/* סרגל-כלים: חיפוש + סינון + חי */}
      <div className="panel px-4 py-3.5 mb-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-56">
            <Search className="absolute start-3 top-1/2 -translate-y-1/2 size-4 text-gold-dim" aria-hidden />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && goSearch(q)}
              placeholder="חיפוש: גובה (#679), hash, seq, קידומת…"
              dir="ltr"
              aria-label="חיפוש בפנקס"
              className="w-full hash rounded-lg border border-input bg-muted/40 ps-9 pe-3 py-2 text-xs text-ink placeholder:text-ink-2/50 focus:outline-none focus:ring-2 focus:ring-gold/40"
            />
          </div>
          <button
            type="button"
            onClick={() => goSearch(q)}
            disabled={searching || !q.trim()}
            className="rounded-lg border border-gold/30 bg-gold/10 px-3.5 py-2 text-xs font-bold text-gold hover:bg-gold/15 transition-colors disabled:opacity-40 inline-flex items-center gap-1.5"
          >
            {searching ? <Spinner className="size-3.5" /> : <Search className="size-3.5" />}
            חפש
          </button>
          <div className="relative">
            <input
              value={jump}
              onChange={(e) => setJump(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && doJump()}
              placeholder="עבור לגובה…"
              dir="ltr"
              inputMode="numeric"
              aria-label="מעבר-ישר לגובה"
              className="w-32 hash rounded-lg border border-input bg-muted/40 px-3 py-2 text-xs text-ink placeholder:text-ink-2/50 focus:outline-none focus:ring-2 focus:ring-gold/40"
            />
          </div>
          <Tip label={live ? "הרשימה מתעדכנת אוטומטית כל כמה שניות" : "הרשימה קפואה — לחיצה תחזיר את העדכון-החי"}>
            <button
              type="button"
              onClick={() => setLive((v) => !v)}
              aria-pressed={live}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-bold transition-colors",
                live ? "border-verified/30 bg-verified/10 text-verified" : "border-border text-ink-2"
              )}
            >
              {live ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
              {live ? "חי" : "קפוא"}
            </button>
          </Tip>
        </div>

        {searchHits.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-1" role="list" aria-label="תוצאות-חיפוש">
            {searchHits.map((h, i) => (
              <button
                key={i}
                type="button"
                role="listitem"
                onClick={h.go}
                className="group inline-flex items-center gap-2 rounded-lg border border-gold/30 bg-gold/8 px-3 py-1.5 text-xs text-ink hover:border-gold/60 transition-colors"
              >
                <span className="hash text-[9.5px] font-black text-gold">{h.kind}</span>
                <span className="hash text-[10.5px]">{h.label}</span>
                <ChevronLeft className="size-3 text-gold-dim group-hover:text-gold" aria-hidden />
              </button>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-1.5">
          {OP_FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={op === f.id}
              onClick={() => {
                setOp(f.id);
                setOffset(0);
              }}
              className={cn(
                "rounded-full border px-3 py-1 text-[11px] font-bold transition-all",
                op === f.id ? "border-gold/50 bg-gold/12 text-gold" : "border-border text-ink-2 hover:text-ink hover:border-gold/25"
              )}
            >
              {f.label}
            </button>
          ))}
          <button
            type="button"
            aria-pressed={cpOnly}
            onClick={() => {
              setCpOnly((v) => !v);
              setOffset(0);
            }}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-bold transition-all",
              cpOnly ? "border-verified/40 bg-verified/10 text-verified" : "border-border text-ink-2 hover:text-ink"
            )}
          >
            <ShieldCheck className="size-3" />
            רק צ'קפוינטים
          </button>
        </div>
      </div>

      {/* טאבים */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {tabDefs.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-pressed={tab === t.id}
            onClick={() => {
              setTab(t.id);
              setOffset(0);
            }}
            className={cn(
              "inline-flex items-center gap-2 rounded-lg border px-3.5 py-2 text-xs font-bold transition-all",
              tab === t.id ? "border-gold/50 bg-gold/10 text-gold" : "border-border bg-muted/30 text-ink-2 hover:text-ink"
            )}
          >
            {t.label}
            {t.count != null && <span className="hash text-[10px] opacity-80">{t.count}</span>}
          </button>
        ))}
        <span className="ms-auto text-[10px] text-ink-2/60">{live ? "מתעדכן אוטומטית" : "עדכון-חי מושהה"}</span>
      </div>

      {/* ══ בלוקים ══ */}
      {tab === "blocks" && (
        <BookList
          data={book.data}
          loading={book.loading}
          error={book.error}
          refresh={book.refresh}
          offset={offset}
          step={step}
          hasMore={book.data?.hasMore ?? false}
          filtered={book.data?.filtered}
          totalBlocks={book.data?.totalBlocks}
          onOpen={open}
        />
      )}

      {/* ══ פעולות / חותמות ══ */}
      {(tab === "txs" || tab === "stamps") && (
        <TxList
          data={txPage.data}
          loading={txPage.loading}
          error={txPage.error}
          refresh={txPage.refresh}
          offset={offset}
          step={step}
          hasMore={txPage.data?.hasMore ?? false}
          filtered={txPage.data?.filtered}
          mode={tab === "stamps" ? "stamps" : "all"}
          onOpen={open}
          onVerify={onVerify}
        />
      )}

      {/* ══ איטומים ══ */}
      {tab === "seals" && (
        <div className="space-y-3 max-h-[620px] overflow-y-auto ps-1">
          {seals.length === 0 ? (
            <EmptyState title="טרם נחתם איטום — הנול ממתין לחוטים הראשונים" />
          ) : (
            [...seals].reverse().map((s) => {
              const h = nodeSealHeights.get(String(s.root));
              return (
                <motion.button
                  key={s.root}
                  type="button"
                  initial={{ opacity: 0, x: 12 }}
                  animate={{ opacity: 1, x: 0 }}
                  onClick={() => h != null && open(h)}
                  disabled={h == null}
                  aria-label={h != null ? `פתח את בלוק-האיטום #${h}` : `איטום #${s.seq}`}
                  className={cn(
                    "panel px-4 py-3.5 flex flex-wrap items-center gap-x-5 gap-y-2 w-full text-right",
                    h != null && "hover:border-gold/30 hover:bg-gold/[0.03] transition-all focus-visible:outline-2 focus-visible:outline-gold",
                    h == null && "opacity-80"
                  )}
                >
                  <span className="hash text-gold font-bold text-lg w-14">#{s.seq}</span>
                  <div className="flex-1 min-w-40">
                    <HashText h={s.root} head={16} tail={12} className="text-gold-soft text-xs" />
                  </div>
                  <span className="text-xs text-ink-2">
                    <span className="hash text-ink">{s.count}</span> עלים · seq <span className="hash">{s.from}–{s.to}</span>
                  </span>
                  <span className="text-[11px] text-ink-2/80">{h != null ? `בלוק ${h}` : "גובה ברישום-הצומת"} · {timeAgoHe(s.at)}</span>
                  {h != null && <ChevronDown className="size-4 text-gold-dim" aria-hidden />}
                </motion.button>
              );
            })
          )}
        </div>
      )}

      {/* ══ מגירת-הבלוק ══ */}
      <Dialog open={openH !== null} onOpenChange={(o) => !o && setOpenH(null)}>
        <DialogContent className="bg-card border-border max-w-3xl max-h-[88vh] overflow-y-auto" dir="rtl">
          <DialogHeader>
            <DialogTitle className="font-display text-xl text-ink flex flex-wrap items-center gap-2.5">
              בלוק <span className="hash text-gold">{openH !== null ? `#${openH}` : ""}</span>
              {full && full.height > 0 && full.height % 12 === 0 && (
                <Tip label="צ'קפוינט — כל 12 בלוקים הקרנל חותם שורש-מצב וסורק שלמות-היסטוריה">
                  <span className="inline-flex items-center gap-1 rounded-full border border-verified/30 bg-verified/10 px-2.5 py-0.5 text-[10px] font-bold text-verified">
                    <ShieldCheck className="size-3" /> צ'קפוינט
                  </span>
                </Tip>
              )}
              {busy && <Spinner className="size-4" />}
            </DialogTitle>
            <DialogDescription className="text-ink-2 text-xs">
              {full
                ? `${full.results?.length ?? 0} תוצאות · ${full.gasUsed} גז · ${fmtClock(full.time)}${full.time ? ` · ${timeAgoHe(full.time)}` : ""}`
                : "קורא מהארכיון…"}
            </DialogDescription>
          </DialogHeader>

          {full && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-1 gap-3 text-xs">
                <KV k="hash"><HashText h={full.hash} head={22} tail={16} className="text-gold-soft" /></KV>
                <KV k="prevHash — הבלוק הקודם">
                  <button
                    type="button"
                    onClick={() => open(Math.max(0, full.height - 1))}
                    className="inline-flex items-center gap-1.5 text-gold-soft hover:text-gold transition-colors"
                  >
                    <Link2 className="size-3.5" />
                    <HashText h={full.prevHash} head={18} tail={12} copy={false} />
                    <span className="text-[10px] underline underline-offset-2">פתח בלוק #{Math.max(0, full.height - 1)}</span>
                  </button>
                </KV>
                <KV k="זמן">{full.time ? `${fmtClock(full.time)} · ${timeAgoHe(full.time)}` : "—"}</KV>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[11px] text-gold-dim hash uppercase tracking-widest">txs · הפעולות בבלוק</div>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard?.writeText(JSON.stringify(full, null, 2)).catch(() => {});
                      toast({ title: "ה-JSON המלא הועתק" });
                    }}
                    className="inline-flex items-center gap-1.5 text-[10px] text-ink-2 hover:text-gold transition-colors"
                  >
                    <FileJson className="size-3.5" /> העתק JSON
                  </button>
                </div>
                <div className="space-y-2">
                  {(full.txs || []).map((tx, i) => (
                    <TxCard
                      key={i}
                      type={String((tx as Record<string, unknown>).type || "?")}
                      tx={tx as Record<string, unknown>}
                      r={full.results?.[i]}
                      onVerify={onVerify}
                      onOpenBlock={open}
                    />
                  ))}
                  {(full.txs || []).length === 0 && <EmptyState title="בלוק ללא פעולות — פעימת-חיים בלבד" />}
                </div>
              </div>

              {/* ניווט-שרשרת */}
              <div className="flex items-center justify-between gap-2 pt-2 border-t border-border">
                <button
                  type="button"
                  onClick={() => open(full.height - 1)}
                  disabled={full.height <= 0}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3.5 py-2 text-xs font-bold text-ink-2 hover:text-ink hover:border-gold/30 transition-colors disabled:opacity-30 disabled:pointer-events-none"
                >
                  <ChevronRight className="size-3.5" /> הבלוק הקודם
                </button>
                <button
                  type="button"
                  onClick={() => open(full.height + 1)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3.5 py-2 text-xs font-bold text-ink-2 hover:text-ink hover:border-gold/30 transition-colors"
                >
                  הבלוק הבא <ChevronLeft className="size-3.5" />
                </button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ══ רשימת-בלוקים ══ */
function BookList({
  data,
  loading,
  error,
  refresh,
  offset,
  step,
  hasMore,
  filtered,
  totalBlocks,
  onOpen,
}: {
  data: { blocks: import("@/hooks/use-weave").BlockRow[] } | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
  offset: number;
  step: (d: 1 | -1) => void;
  hasMore: boolean;
  filtered?: number;
  totalBlocks?: number;
  onOpen: (h: number) => void;
}) {
  if (error && !data) {
    return <ErrorState detail={error} onRetry={refresh} />;
  }
  if (loading && !data) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="panel h-16 animate-pulse opacity-40" />
        ))}
      </div>
    );
  }
  if (!data?.blocks?.length) {
    return (
      <EmptyState
        title="אין בלוקים שתואמים לסינון הזה"
        sub="נסה להרווח את הסינון — או חזור לעמוד הראשון"
      />
    );
  }
  return (
    <div>
      <div className="space-y-2 max-h-[620px] overflow-y-auto ps-1">
        {data.blocks.map((b) => (
          <button
            key={b.height}
            type="button"
            onClick={() => onOpen(b.height)}
            className="w-full text-right panel px-4 py-3.5 flex flex-wrap items-center gap-x-5 gap-y-2 hover:border-gold/30 hover:bg-gold/[0.03] transition-all group focus-visible:outline-2 focus-visible:outline-gold"
          >
            <span className="hash text-gold font-bold text-lg w-16 shrink-0 group-hover:root-glow">#{b.height}</span>
            {b.isCheckpoint && (
              <Tip label="צ'קפוינט — שורש-מצב חתום על הספר בגובה זה">
                <ShieldCheck className="size-4 text-verified" aria-label="בלוק צ'קפוינט" />
              </Tip>
            )}
            <span className="flex-1 min-w-40 flex items-center gap-2 text-xs">
              <HashText h={b.hash} head={12} tail={8} className="text-ink/85" copy={false} />
            </span>
            <span className="flex flex-wrap gap-1.5">
              {Object.entries(b.ops).map(([o, n]) => (
                <OpChip key={o} op={o} n={n} />
              ))}
            </span>
            <span className="hash text-[11px] text-ink-2/80 w-16 text-end">{b.gasUsed} gas</span>
            <span className="text-[11px] text-ink-2/70 w-20">{timeAgoHe(b.time)}</span>
            <ChevronDown className="size-4 text-gold-dim" aria-hidden />
          </button>
        ))}
      </div>
      <Pager
        offset={offset}
        step={step}
        hasMore={hasMore}
        count={data.blocks.length}
        filtered={filtered}
        totalBlocks={totalBlocks}
      />
    </div>
  );
}

/* ══ רשימת-פעולות (כל-הסוגים או חותמות) ══ */
function TxList({
  data,
  loading,
  error,
  refresh,
  offset,
  step,
  hasMore,
  filtered,
  mode,
  onOpen,
  onVerify,
}: {
  data: { txs: TxRow[] } | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
  offset: number;
  step: (d: 1 | -1) => void;
  hasMore: boolean;
  filtered?: number;
  mode: "all" | "stamps";
  onOpen: (h: number) => void;
  onVerify?: (h: string) => void;
}) {
  if (error && !data) return <ErrorState detail={error} onRetry={refresh} />;
  if (loading && !data) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="panel h-14 animate-pulse opacity-40" />
        ))}
      </div>
    );
  }
  if (!data?.txs?.length) {
    return <EmptyState title="אין פעולות שתואמות לסינון הזה" sub="נסה סינון אחר או חזור לעמוד הראשון" />;
  }
  return (
    <div>
      <div className="space-y-2 max-h-[620px] overflow-y-auto ps-1">
        {data.txs.map((r, i) => (
          <motion.div key={`${r.height}-${r.idx}-${i}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="panel px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
            <span className="flex items-center gap-2 w-24 shrink-0">
              <LiveDot tone={r.ok ? "green" : "rose"} />
              <OpChip op={r.type} />
            </span>
            <button
              type="button"
              onClick={() => onOpen(r.height)}
              className="hash text-gold-soft font-bold hover:text-gold transition-colors underline-offset-2 hover:underline"
              aria-label={`פתח בלוק #${r.height}`}
            >
              #{r.height}
            </button>
            {mode === "stamps" || r.type === "stamp" ? (
              <>
                <HashText h={String(r.tx?.h || "")} head={14} tail={10} className="text-ink/90" />
                {r.tx?.seq != null && <span className="hash text-gold">#{String(r.tx.seq)}</span>}
                <span className="hash text-ink-2/70">{String(r.tx?.kind || "text")}</span>
                <span className="text-ink-2/70">{String(r.tx?.by || "—")}</span>
              </>
            ) : r.type === "witness" ? (
              <>
                <span className="hash text-verified">{String(r.tx?.topic || "—")}</span>
                <HashText h={String(r.tx?.claimHash || "")} head={10} tail={6} copy={false} className="text-ink/70" />
                <span className="text-ink-2/70">{String(r.tx?.validator || "—")}</span>
              </>
            ) : r.type === "seal" ? (
              <HashText h={String(r.tx?.root || "")} head={16} tail={10} className="text-gold-soft" />
            ) : (
              Boolean(r.tx?.note) && <span className="text-ink-2/80 truncate max-w-xs" title={String(r.tx?.note)}>{String(r.tx?.note)}</span>
            )}
            <span className="ms-auto flex items-center gap-3">
              {mode === "stamps" && Boolean(r.tx?.h) && onVerify && (
                <button type="button" onClick={() => onVerify(String(r.tx?.h))} className="text-gold-dim hover:text-gold underline underline-offset-2 text-[11px]">
                  תעודה
                </button>
              )}
              <span className="hash text-[10px] text-ink-2/60">{r.gas} gas</span>
              <span className="text-[10px] text-ink-2/70 w-16 text-end">{timeAgoHe(r.time)}</span>
            </span>
          </motion.div>
        ))}
      </div>
      <Pager offset={offset} step={step} hasMore={hasMore} count={data.txs.length} filtered={filtered} />
    </div>
  );
}

/* ══ עימוד ══ */
function Pager({
  offset,
  step,
  hasMore,
  count,
  filtered,
  totalBlocks,
}: {
  offset: number;
  step: (d: 1 | -1) => void;
  hasMore: boolean;
  count: number;
  filtered?: number;
  totalBlocks?: number;
}) {
  const page = Math.floor(offset / 50) + 1;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 mt-4 text-xs text-ink-2">
      <span>
        {filtered != null && (
          <>
            <span className="hash text-ink">{filtered.toLocaleString("he-IL")}</span> תוצאות
            {totalBlocks != null && filtered !== totalBlocks && <> (מתוך <span className="hash">{totalBlocks.toLocaleString("he-IL")}</span>)</>}
            {" · "}
          </>
        )}
        מציג {count} · עמוד <span className="hash text-gold-soft">{page}</span>
      </span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => step(-1)}
          disabled={offset === 0}
          className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 font-bold hover:border-gold/30 hover:text-ink transition-colors disabled:opacity-30 disabled:pointer-events-none"
        >
          <ChevronRight className="size-3.5" /> חדשים יותר
        </button>
        <button
          type="button"
          onClick={() => step(1)}
          disabled={!hasMore}
          className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 font-bold hover:border-gold/30 hover:text-ink transition-colors disabled:opacity-30 disabled:pointer-events-none"
        >
          ישנים יותר <ChevronLeft className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

/* ══ כרטיס-פעולה מובנה (בתוך מגירת-הבלוק) ══ */
function TxCard({
  type,
  tx,
  r,
  onVerify,
  onOpenBlock,
}: {
  type: string;
  tx: Record<string, unknown>;
  r?: { ok: boolean; err: string | null; gas: number; type: string } | null;
  onVerify?: (h: string) => void;
  onOpenBlock: (h: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const Icon =
    type === "stamp" ? Fingerprint : type === "seal" ? Landmark : type === "witness" ? Eye : type === "checkpoint" ? ShieldCheck : Activity;

  const note = tx?.note ? String(tx.note) : null;

  return (
    <div className="rounded-lg border border-border bg-muted/30 px-3.5 py-3 space-y-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
        <span className="flex items-center gap-1.5">
          <LiveDot tone={r ? (r.ok ? "green" : "rose") : "gray"} className="text-current" />
          <Icon className="size-3.5 text-gold" aria-hidden />
          <OpChip op={type} />
        </span>
        {Boolean(tx?.seq != null) && <span className="hash text-gold">#{String(tx?.seq)}</span>}
        {Boolean(tx?.kind) && <span className="hash text-ink-2/80">{String(tx?.kind)}</span>}
        {Boolean(tx?.by) && <span className="text-ink-2/80">מאת <span className="hash text-ink">{String(tx?.by)}</span></span>}
        {Boolean(tx?.topic) && <span className="hash text-verified">{String(tx?.topic)}</span>}
        {Boolean(tx?.validator) && <span className="text-ink-2/70">עד: <span className="hash">{String(tx?.validator)}</span></span>}
        {Boolean(tx?.salt) && <span className="hash text-[9.5px] rounded-md border border-gold/25 bg-gold/5 px-1.5 py-0.5 text-gold-dim">salt</span>}
        {r && (
          <span className={cn("ms-auto hash text-[10px]", r.ok ? "text-verified" : "text-broken")} dir="ltr">
            {r.ok ? "ok" : "reject"} · {r.gas} gas{r.err ? ` · ${r.err}` : ""}
          </span>
        )}
      </div>

      {Boolean(tx?.h) && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-ink-2/70 text-[10px]">hash:</span>
          <HashText h={String(tx?.h)} head={20} tail={12} className="text-gold-soft" />
          {onVerify && String(tx?.h ?? "").length === 64 && (
            <button type="button" onClick={() => onVerify(String(tx.h))} className="text-gold-dim hover:text-gold underline underline-offset-2 text-[10.5px] inline-flex items-center gap-1">
              <ScrollTextMark /> תעודה ציבורית ←
            </button>
          )}
        </div>
      )}
      {Boolean(tx?.root) && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-ink-2/70 text-[10px]">שורש-האיטום:</span>
          <HashText h={String(tx?.root)} head={20} tail={12} className="text-gold-soft" />
        </div>
      )}
      {Boolean(tx?.claimHash) && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-ink-2/70 text-[10px]">claim:</span>
          <HashText h={String(tx?.claimHash)} head={16} tail={10} />
        </div>
      )}
      {Boolean(tx?.block != null) && (
        <button type="button" onClick={() => onOpenBlock(Number(tx.block))} className="hash text-[10.5px] text-gold-dim hover:text-gold underline underline-offset-2">
          בלוק {String(tx.block)} ←
        </button>
      )}
      {note && (
        <div className="text-xs text-ink leading-relaxed">
          <span className={cn("whitespace-pre-wrap break-words", !expanded && "line-clamp-3")}>{note}</span>
          {note.length > 160 && (
            <button type="button" onClick={() => setExpanded((v) => !v)} className="text-gold-dim hover:text-gold text-[10.5px] underline underline-offset-2 ms-2">
              {expanded ? "פחות" : "הצג הכל"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ScrollTextMark() {
  return <Link2 className="size-3" aria-hidden />;
}

/* ══ KV ══ */
function KV({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 px-3.5 py-2.5">
      <div className="text-[10px] text-ink-2 mb-1 hash uppercase">{k}</div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/* ══ כרטיס-KPI ══ */
function StatCard({ label, value, sub, onClick, active }: { label: string; value: React.ReactNode; sub?: string; onClick?: () => void; active?: boolean }) {
  const Cmp = onClick ? "button" : "div";
  return (
    <Cmp
      {...(onClick ? { type: "button" as const, onClick, "aria-pressed": active } : {})}
      className={cn(
        "panel px-4 py-3.5 min-w-0 text-right block w-full transition-all",
        onClick && "hover:border-gold/40 hover:bg-gold/[0.04] focus-visible:outline-2 focus-visible:outline-gold",
        active && "border-gold/40 bg-gold/[0.06]"
      )}
    >
      <div className="text-[11px] text-ink-2 mb-1 truncate">{label}</div>
      <div className="metric-value text-xl md:text-2xl font-bold leading-none text-ink">{value}</div>
      {sub && <div className="text-[10.5px] text-ink-2/70 mt-1.5 truncate">{sub}</div>}
    </Cmp>
  );
}
