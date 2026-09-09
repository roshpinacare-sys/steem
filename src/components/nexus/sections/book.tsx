"use client";

/**
 * 117n — BOOK · סייר-הספר-הריבוני
 * הספר-שלנו (66k+ בלוקים אמת) — עד-היום-היה-נסתר-לגמרי. עכשיו: זנב-חי · קליק=פירוט-בלוק ·
 * חיפוש-אמת (גובה/האש/זוג/סוחר/סוג) · כנות-מלאה-על-טווח-החיפוש.
 */

import { useState } from "react";
import { motion } from "framer-motion";
import { BookOpen, Hash, Pause, Play, Search } from "lucide-react";
import { useLive } from "@/hooks/use-live";
import { cn } from "@/lib/utils";
import { Bar, Chip, Micro, Panel, SecHead, ago, fmtInt, mask } from "../primitives";

type Tx = Record<string, unknown>;
type BlockRec = { height: number; time: string; prevHash: string; txs: Tx[] };
type BookResp = { ok: boolean; mode: string; blocks: BlockRec[]; head?: number; scanned?: number; at: string };

const TX_COLOR: Record<string, string> = {
  pool_x: "violet",
  mint: "emerald",
  transfer: "zinc",
  anchor: "emerald",
  fee: "amber",
  wrap: "violet",
  redeem: "amber",
} as const;

function txChip(t: Tx, i: number) {
  const type = String(t.type || "tx");
  const tone = (TX_COLOR[type] || "zinc") as "violet" | "emerald" | "zinc" | "amber";
  const pair = t.pair ? String(t.pair) : "";
  const amt = typeof t.inAmt === "number" ? t.inAmt : undefined;
  return (
    <span key={i} className="inline-flex items-center gap-1 font-mono text-[10px] text-zinc-500">
      <Chip tone={tone}>{type}</Chip>
      {pair && <span className="text-zinc-400">{pair}</span>}
      {amt !== undefined && <span className="tabular-nums text-zinc-600">{amt}</span>}
      {t.mirror ? <span className="text-zinc-700">{String(t.mirror)}</span> : null}
    </span>
  );
}

function BlockRow({ b, onOpen }: { b: BlockRec; onOpen: () => void }) {
  return (
    <button onClick={onOpen} className="w-full rounded-md border border-zinc-800/70 bg-zinc-900/40 px-3 py-2.5 text-right transition-colors hover:border-violet-500/40" dir="ltr">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Hash className="h-3.5 w-3.5 shrink-0 text-violet-400/70" aria-hidden />
          <span className="font-mono text-sm font-bold tabular-nums text-violet-200">{fmtInt(b.height)}</span>
          <span className="hidden font-mono text-[10px] text-zinc-600 sm:inline">{mask(b.prevHash, 8, 0)}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Chip>{b.txs.length} tx</Chip>
          <span className="font-mono text-[10px] text-zinc-600">{ago(b.time)} ago</span>
        </div>
      </div>
      {b.txs.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 overflow-hidden">
          {b.txs.slice(0, 6).map((t, i) => txChip(t, i))}
          {b.txs.length > 6 && <span className="font-mono text-[10px] text-zinc-600">+{b.txs.length - 6} more</span>}
        </div>
      )}
    </button>
  );
}

function BlockDetail({ b, onClose }: { b: BlockRec; onClose: () => void }) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <Panel className="p-4" corners={false}>
        <div className="mb-3 flex items-center justify-between">
          <span dir="ltr" className="font-mono text-sm font-bold text-violet-200">BLOCK #{fmtInt(b.height)}</span>
          <button onClick={onClose} className="rounded border border-zinc-800 px-2 py-1 font-mono text-[10px] text-zinc-500 hover:text-zinc-300">CLOSE</button>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div><Micro>זמן</Micro><div dir="ltr" className="font-mono text-xs text-zinc-300">{b.time.replace("T", " ").slice(0, 19)}Z</div></div>
          <div><Micro>עסקאות</Micro><div dir="ltr" className="font-mono text-xs text-zinc-300">{b.txs.length}</div></div>
          <div className="col-span-2"><Micro>prevHash</Micro><div dir="ltr" className="truncate font-mono text-xs text-zinc-500">{b.prevHash}</div></div>
        </div>
        <div className="mt-3 max-h-72 space-y-1.5 overflow-y-auto pr-1 nexus-scroll" dir="ltr">
          {b.txs.length === 0 && <p className="py-3 text-center font-mono text-xs text-zinc-600">empty-block — אמת-גם-בריק</p>}
          {b.txs.map((t, i) => (
            <div key={i} className="rounded border border-zinc-800/60 bg-zinc-950/60 px-2.5 py-1.5 font-mono text-[11px]">
              <span className="text-violet-300">[{String(t.type || "tx")}]</span>{" "}
              {t.taker ? <span className="text-zinc-400">{String(t.taker)} </span> : null}
              {t.pair ? <span className="text-zinc-200">{String(t.pair)} </span> : null}
              {t.side ? <span className="text-amber-300/80">{String(t.side)} </span> : null}
              {t.inAmt !== undefined ? <span className="tabular-nums text-zinc-300">in={String(t.inAmt)} </span> : null}
              {t.outAmt !== undefined ? <span className="tabular-nums text-zinc-300">out={String(t.outAmt)} </span> : null}
              {t.mirror ? <span className="text-zinc-600">mirror={String(t.mirror)}</span> : null}
            </div>
          ))}
        </div>
      </Panel>
    </motion.div>
  );
}

export function BookSec({ sub }: { sub: string }) {
  const live = useLive<BookResp>("/api/book?n=25", 5000);
  const [open, setOpen] = useState<number | null>(null);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<BookResp | null>(null);
  const [searching, setSearching] = useState(false);
  const [sErr, setSErr] = useState<string | null>(null);

  const blocks = live.data?.blocks || [];
  const head = live.data?.head || blocks[0]?.height || 0;
  const openBlock = blocks.find((b) => b.height === open) || (hits?.blocks || []).find((b) => b.height === open);

  const runSearch = async () => {
    const v = q.trim();
    if (!v) return;
    setSearching(true);
    setSErr(null);
    setOpen(null);
    try {
      const isH = /^\d+$/.test(v) && Number(v) > 0;
      const url = isH && Number(v) < head - 40 ? `/api/book?h=${v}` : `/api/book?q=${encodeURIComponent(v)}`;
      const r = await fetch(url, { cache: "no-store" });
      const j = (await r.json()) as BookResp;
      setHits(j);
    } catch {
      setSErr("search-failed");
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="space-y-4">
      <Panel className="p-4 md:p-5">
        <SecHead
          icon={<BookOpen className="h-4 w-4" />}
          title="הספר-הריבוני · סייר-בלוקים"
          sub="השרשרת-שלנו · בלוקים-אמת-כל-~25s · ארכיון-מלא-66k+"
          extra={<Chip tone="violet">LIVE-HEAD {fmtInt(head)}</Chip>}
        />
        {sub === "search" && (
          <div className="mb-4 flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-600" aria-hidden />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && runSearch()}
                placeholder="גובה · האש · זוג (WXRP/SAOS) · סוחר · סוג-עסקה"
                className="w-full rounded-md border border-zinc-800 bg-zinc-950/80 py-2.5 pl-3 pr-9 font-mono text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-violet-500/50 focus:outline-none"
                dir="ltr"
                aria-label="חיפוש-בספר"
              />
            </div>
            <button onClick={runSearch} disabled={searching || !q.trim()} className="rounded-md border border-violet-500/40 bg-violet-500/10 px-4 py-2.5 font-mono text-xs font-bold text-violet-200 transition-colors hover:bg-violet-500/20 disabled:opacity-40">
              {searching ? "scanning…" : "SCAN"}
            </button>
          </div>
        )}
        {sub === "search" && (hits?.scanned || 0) > 0 && (
          <p className="mb-3 font-mono text-[10px] text-zinc-600" dir="ltr">scanned last {fmtInt(hits.scanned || 0)} blocks · hits: {(hits?.blocks || []).length}</p>
        )}
        {sub === "blocks" && (
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2 font-mono text-[10px] text-zinc-500">
              {live.error ? <Chip tone="rose">CONNECTION-LOST · RETRYING</Chip> : <><span className="relative flex h-2 w-2"><span className="absolute h-full w-full animate-ping rounded-full bg-violet-400/60" /><span className="h-2 w-2 rounded-full bg-violet-400" /></span> live-tail · 5s</>}
            </div>
            <button onClick={() => live.setPaused(!live.paused)} className="flex items-center gap-1 rounded border border-zinc-800 px-2 py-1 font-mono text-[10px] text-zinc-500 hover:text-zinc-300">
              {live.paused ? <Play className="h-3 w-3" aria-hidden /> : <Pause className="h-3 w-3" aria-hidden />}
              {live.paused ? "RESUME" : "PAUSE"}
            </button>
          </div>
        )}
      </Panel>

      {openBlock && <BlockDetail b={openBlock} onClose={() => setOpen(null)} />}

      {sErr && <Panel className="p-3 text-xs text-rose-300" corners={false}>חיפוש-נכשל: {sErr}</Panel>}
      {hits && hits.blocks.length === 0 && !searching && (
        <Panel className="p-6 text-center text-xs text-zinc-500" corners={false}>
          אפס-פגיעות — כנות: החיפוש-סורק-את-{fmtInt(hits.scanned || 0)}-הבלוקים-האחרונים. גובה-ישן-מאוד? השתמש-בגובה-מדויק.
        </Panel>
      )}

      <div className="max-h-[560px] space-y-2 overflow-y-auto pr-1 nexus-scroll">
        {(sub === "search" ? hits?.blocks || [] : blocks).map((b, i) => (
          <motion.div key={b.height} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i * 0.02, 0.2) }}>
            <BlockRow b={b} onOpen={() => setOpen(open === b.height ? null : b.height)} />
          </motion.div>
        ))}
        {sub === "blocks" && blocks.length === 0 && !live.loading && (
          <Panel className="p-6 text-center text-xs text-zinc-600" corners={false}>אין-בלוקים-בזנב — כנות</Panel>
        )}
      </div>
    </div>
  );
}
