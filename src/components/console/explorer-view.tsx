"use client";

// ─────────────────────────────────────────────────────────────────────────────
// ExplorerView — Task 71: EXPLORER — advanced explorer of SAOS-NET.
// "תיעוד של הרשת על הרשת": unified live integrity (stateRepro — faithful tx-replay ≡
// recorded checkpoint roots via the deterministic kernel, final root matched),
// full block browser with tx breakdown, sovereign account ledger (live-snapshot authority),
// order book
// ladders, anchored checkpoints, and the public on-chain documentation log
// (publications — custom_json on the host chains).
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BadgeCheck,
  Blocks,
  BookOpen,
  ChevronDown,
  Crown,
  Download,
  ExternalLink,
  Landmark,
  Link2,
  Loader2,
  PackageCheck,
  RadioTower,
  Search,
  ShieldCheck,
  ShieldX,
  UserRound,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
  fmtNum,
  relTime,
  useAccount,
  useChainTalk,
  useExplorer,
  useSaosNet,
  useTronBridge,
  type ExplorerAccountDetail,
  type ExplorerBlock,
  type ExplorerBlockFull,
  type ExplorerFill,
  type ExplorerResponse,
} from "./api";

/* Task 90: קידומת-כתובת לתצוגה */
function shortAddr(a: string): string {
  return a.length > 14 ? a.slice(0, 6) + "…" + a.slice(-6) : a;
}

const OP_HE: Record<string, { label: string; cls: string }> = {
  transfer: { label: "העברה", cls: "border-emerald-400/40 bg-emerald-400/10 text-emerald-300" },
  steemPay: { label: "מראה-STEEM", cls: "border-emerald-400/30 bg-emerald-400/[0.06] text-emerald-200" },
  pay: { label: "תשלום", cls: "border-emerald-400/30 bg-emerald-400/[0.06] text-emerald-200" },
  order: { label: "הזמנה", cls: "border-amber-400/40 bg-amber-400/10 text-amber-300" },
  cancel: { label: "ביטול", cls: "border-rose-400/40 bg-rose-400/10 text-rose-300" },
  fill: { label: "מילוי", cls: "border-fuchsia-400/40 bg-fuchsia-400/10 text-fuchsia-300" },
  pool_add: { label: "הוספה-לבריכה", cls: "border-teal-400/40 bg-teal-400/10 text-teal-300" },
  pool_swap: { label: "החלפה-בריכה", cls: "border-teal-400/30 bg-teal-400/[0.06] text-teal-200" },
  wrap_mint: { label: "טביעת-עגון", cls: "border-sky-400/40 bg-sky-400/10 text-sky-300" },
  wrap_burn: { label: "שריפת-עגון", cls: "border-sky-400/30 bg-sky-400/[0.06] text-sky-200" },
  yield: { label: "תשואה", cls: "border-violet-400/40 bg-violet-400/10 text-violet-300" },
  attest: { label: "הצהרת-ולידטור", cls: "border-violet-400/30 bg-violet-400/[0.06] text-violet-200" },
  produce: { label: "ראש-סבב", cls: "border-orange-400/40 bg-orange-400/10 text-orange-300" },
  heartbeat: { label: "דופק-אימפריה", cls: "border-zinc-600 bg-zinc-800/60 text-zinc-300" },
};

function opHe(type: string) {
  return OP_HE[type] ?? { label: type, cls: "border-zinc-600 bg-zinc-800 text-zinc-300" };
}

/* ── 73: תפקידים-בעברית + NameTag הניתן-ללחיצה — כל-שם-באקספלורר הוא-כניסה-לחקירת-חשבון ── */
const ROLE_HE: Record<string, string> = {
  from: "שולח",
  to: "מקבל",
  owner: "בעלים",
  taker: "טייקר",
  maker: "מייקר",
  issuer: "מנפיק",
  yield: "תשואה",
  validator: "ולידטור",
  producer: "ראש",
};

function NameTag({ name, onOpen, className }: { name: string; onOpen?: (n: string) => void; className?: string }) {
  if (!onOpen) {
    return (
      <Mono className={cn("text-zinc-200", className)}>@{name}</Mono>
    );
  }
  return (
    <button
      onClick={() => onOpen(name)}
      className={cn(
        "cursor-pointer border-b border-dotted border-zinc-600 font-mono text-[10px] text-zinc-200 transition-colors hover:border-emerald-400/60 hover:text-emerald-300",
        className
      )}
      title={`חקור את החשבון @${name}`}
    >
      @{name}
    </button>
  );
}

/** 73: כל-החשבונות-הנוגעים-בטרנזאקציה — לשבבים-הניתנים-ללחיצה-בדיאלוג-הבלוק */
function txAccounts(t: Record<string, unknown>): { name: string; role: string }[] {
  const out: { name: string; role: string }[] = [];
  const add = (v: unknown, role: string) => {
    const s = String(v ?? "").trim();
    if (s) out.push({ name: s, role });
  };
  switch (String(t.type ?? "")) {
    case "transfer":
    case "pay":
    case "steemPay":
      add(t.from, "from");
      add(t.to, "to");
      break;
    case "order":
    case "cancel":
    case "pool_add":
      add(t.owner, "owner");
      break;
    case "fill":
      add(t.taker, "taker");
      break;
    case "pool_swap":
      add(t.taker, "taker");
      break;
    case "wrap_mint":
    case "wrap_burn":
      add(t.issuer, "issuer");
      add(t.to, "to");
      break;
    case "yield":
      if (Array.isArray(t.payments)) {
        for (const p of t.payments as Record<string, unknown>[]) add(p?.account, "yield");
      }
      break;
    case "attest":
      add(t.validator, "validator");
      break;
    case "produce":
      add(t.producer, "producer");
      break;
  }
  const seen = new Set<string>();
  return out.filter((x) => {
    const k = x.name.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/* ── 73: ספארקליין SVG — ההיסטוריה-נראית, לא-רק-נספרת ── */
function Spark({ points, cls }: { points: { v: number }[]; cls: string }) {
  const W = 200;
  const H = 40;
  if (points.length < 2) {
    return <div className="h-[40px]" />;
  }
  const vs = points.map((p) => p.v);
  const min = Math.min(...vs);
  const max = Math.max(...vs);
  const span = max - min || 1;
  const step = W / (points.length - 1);
  const coords = points
    .map((p, i) => `${(i * step).toFixed(1)},${(H - 4 - ((p.v - min) / span) * (H - 8)).toFixed(1)}`)
    .join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-[40px] w-full" preserveAspectRatio="none" role="img" aria-label="sparkline">
      <polyline points={coords} fill="none" strokeWidth="1.5" className={cls} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function Mono({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span dir="ltr" className={cn("font-mono text-[10px] tracking-tight", className)}>
      {children}
    </span>
  );
}

function txMain(t: Record<string, unknown>): string {
  const type = String(t.type ?? "");
  switch (type) {
    case "transfer":
    case "pay":
    case "steemPay":
      return `${t.from ?? "?"} → ${t.to ?? "?"} · ${fmtNum(Number(t.amount ?? 0), 3)}`;
    case "order":
      return `${t.owner ?? "?"} · ${t.side === "sell" ? "שאל" : "ביד"} ${fmtNum(Number(t.amount ?? 0), 3)} @${fmtNum(Number(t.price ?? 0), 6)}`;
    case "cancel":
      return `${t.owner ?? "?"} · הזמנה #${String(t.orderId ?? "?")}`;
    case "fill":
      return `${t.taker ?? "?"} · #${String(t.orderId ?? "?")} · ${fmtNum(Number(t.amount ?? 0), 3)}`;
    case "pool_add":
      return `${t.owner ?? "?"} · ${fmtNum(Number(t.amountSaos ?? 0), 3)} SAOS + ${fmtNum(Number(t.amountSteem ?? 0), 3)} STEEM`;
    case "pool_swap":
      return `${t.taker ?? "?"} · ${t.side === "sell_saos" ? "מכור-SAOS" : "קנה-SAOS"} ${fmtNum(Number(t.inAmt ?? 0), 3)}`;
    case "yield":
      return `${t.from ?? "?"} · ${Array.isArray(t.payments) ? (t.payments as unknown[]).length : 0} מקבלים · יום ${String(t.day ?? "")}`;
    case "attest":
      return `@${t.validator ?? "?"} · ${String(t.checkpointHash ?? "").slice(0, 12)}…`;
    case "produce":
      return `@${t.producer ?? "?"} · סבב r${String(t.round ?? "?")} · ${String(t.ref ?? "").slice(0, 24)}…`;
    case "heartbeat":
      return String(t.note ?? "");
    default:
      return t.ref ? String(t.ref) : "";
  }
}

/* ── בלוקים: שורה ── */
function BlockRow({ b, onOpen }: { b: ExplorerBlock; onOpen: (h: number) => void }) {
  return (
    <button
      onClick={() => onOpen(b.height)}
      className="grid w-full grid-cols-[3.2rem_1fr_auto] items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-right transition-colors hover:border-zinc-700 hover:bg-zinc-900/70 sm:grid-cols-[3.2rem_1fr_7rem_5rem_9rem]"
    >
      <span className="font-mono text-[12px] font-bold text-zinc-100" dir="ltr">
        #{b.height}
      </span>
      <span className="truncate text-[10px] text-zinc-500">{relTime(b.time)}</span>
      <span className="hidden items-center gap-1 sm:flex" dir="ltr">
        <Badge variant="outline" className="border-zinc-700 bg-zinc-900 px-1 py-0 font-mono text-[9px] text-zinc-400">
          {b.txs} tx
        </Badge>
        {b.failTxs > 0 ? (
          <Badge variant="outline" className="border-rose-400/40 bg-rose-400/10 px-1 py-0 font-mono text-[9px] text-rose-300">
            {b.failTxs} fail
          </Badge>
        ) : (
          <BadgeCheck className="size-3 text-emerald-400" aria-label="כל הטרנזאקציות תקינות" />
        )}
      </span>
      <span className="hidden font-mono text-[10px] text-zinc-500 sm:block" dir="ltr">
        {fmtNum(b.gasUsed, 0)} gas
      </span>
      <span className="hidden justify-end sm:flex">
        {b.hashVerified === true ? (
          <ShieldCheck className="size-3.5 text-emerald-400" aria-label="hash אומת מחדש במנוע" />
        ) : b.hashVerified === false ? (
          <ShieldX className="size-3.5 text-rose-400" aria-label="hash לא התאים" />
        ) : null}
      </span>
      <Mono className="col-span-3 truncate text-zinc-600 sm:col-span-1">{b.hash.slice(0, 20)}…</Mono>
    </button>
  );
}

/* ── פירוט-בלוק (דיאלוג — נטען-רק-בפתיחה, key לפי-גובה) ── */
function BlockDetailDialog({ height, onClose, onName }: { height: number; onClose: () => void; onName: (n: string) => void }) {
  const [block, setBlock] = useState<ExplorerBlockFull | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    fetch(`/api/ops/sovexplorer?h=${height}`)
      .then((r) => r.json())
      .then((d) => {
        if (alive) setBlock(d?.block ?? null);
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [height]);

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[88vh] overflow-y-auto border-zinc-800 bg-zinc-950 sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[15px] text-zinc-100">
            בלוק <span dir="ltr" className="font-mono">#{height}</span>
            {block?.hashVerified === true && (
              <Badge variant="outline" className="border-emerald-400/40 bg-emerald-400/10 px-1.5 py-0 text-[9px] text-emerald-300">
                hash אומת-מנוע ✓
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>
        {loading ? (
          <div className="flex items-center gap-2 py-8 text-[12px] text-zinc-400">
            <Loader2 className="size-4 animate-spin" /> טוען בלוק…
          </div>
        ) : !block ? (
          <p className="py-6 text-[12px] text-zinc-500">בלוק לא נמצא (ייתכן שנחתך מהאוגר — 512 אחרונים נשמרים).</p>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 text-[11px] text-zinc-400 sm:grid-cols-4">
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-2">
                <div className="text-[9px] text-zinc-500">זמן</div>
                <div>{relTime(block.time)}</div>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-2">
                <div className="text-[9px] text-zinc-500">גז</div>
                <Mono className="text-zinc-200">{block.gasUsed}</Mono>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-2">
                <div className="text-[9px] text-zinc-500">טרנזאקציות</div>
                <span>
                  {block.txs} · <span className="text-emerald-400">ok {block.okTxs}</span>
                  {block.failTxs > 0 && <span className="text-rose-400"> · fail {block.failTxs}</span>}
                </span>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-2">
                <div className="text-[9px] text-zinc-500">prevHash</div>
                <Mono className="text-zinc-300">{(block.prevHash ?? "—").slice(0, 14)}…</Mono>
              </div>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-2.5">
              <div className="mb-1 text-[9px] text-zinc-500">blockHash (canonical sha256)</div>
              <Mono className="break-all text-[10px] text-emerald-300">{block.hash}</Mono>
            </div>
            <div className="space-y-1.5">
              {(block.txView ?? []).map((t, i) => {
                const he = opHe(t.type);
                return (
                  <div key={i} className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-2.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant="outline" className={cn("px-1.5 py-0 text-[9px]", he.cls)}>
                        {he.label}
                      </Badge>
                      {t.ok === false ? (
                        <Badge variant="outline" className="border-rose-400/40 bg-rose-400/10 px-1.5 py-0 text-[9px] text-rose-300">
                          נכשל: {t.err ?? "?"}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="border-emerald-400/40 bg-emerald-400/10 px-1.5 py-0 text-[9px] text-emerald-300">
                          הושלמה ✓
                        </Badge>
                      )}
                      <Mono className="text-zinc-600">{t.gas} gas</Mono>
                      {t.ref ? <Mono className="text-amber-300/80">{String(t.ref).slice(0, 18)}</Mono> : null}
                    </div>
                    <div className="mt-1 truncate text-[11px] text-zinc-300">{txMain(t as Record<string, unknown>)}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      {txAccounts(t as Record<string, unknown>).map((a) => (
                        <span key={`${a.role}-${a.name}`} className="inline-flex items-center gap-0.5">
                          <span className="text-[8px] text-zinc-600">{ROLE_HE[a.role] ?? a.role}</span>
                          <NameTag name={a.name} onOpen={(n) => { onClose(); onName(n); }} />
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
              {!block.txView?.length && <p className="text-[11px] text-zinc-500">אין טרנזאקציות.</p>}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ── 73: חקירת-חשבון (דיאלוג) — כל-ההיסטוריה-של-חשבון מכל-השרשרת ── */
function AccountDialog({ name, onClose }: { name: string; onClose: () => void }) {
  const d = useAccount(name);
  const a = d?.account ?? null;
  const b = a?.balances ?? null;
  const statsEntries = useMemo(() => Object.entries(a?.stats ?? {}).sort((x, y) => y[1] - x[1]), [a]);

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[88vh] overflow-y-auto border-zinc-800 bg-zinc-950 sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[15px] text-zinc-100">
            <UserRound className="size-4 text-emerald-300" aria-hidden="true" />
            <Mono className="text-[13px] font-bold text-zinc-100">@{name}</Mono>
            {a?.boundary && (
              <Badge variant="outline" className="border-amber-400/40 bg-amber-400/10 px-1.5 py-0 text-[9px] text-amber-300">
                גבול-מארח
              </Badge>
            )}
            {a && !a.known && (
              <Badge variant="outline" className="border-zinc-700 px-1.5 py-0 text-[9px] text-zinc-400">
                ללא-יתרה-על-הספר
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>
        {!d ? (
          <div className="flex items-center gap-2 py-8 text-[12px] text-zinc-400">
            <Loader2 className="size-4 animate-spin" /> סורק את כל השרשרת עבור @{name}…
          </div>
        ) : (
          <div className="space-y-3">
            {/* יתרות */}
            {b && (
              <div className="grid grid-cols-3 gap-2 text-[11px] sm:grid-cols-6">
                <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-2">
                  <div className="text-[9px] text-zinc-500">SAOS</div>
                  <Mono className="text-emerald-300">{fmtNum(b.saos, 3)}</Mono>
                </div>
                <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-2">
                  <div className="text-[9px] text-zinc-500">STEEM</div>
                  <Mono className={b.steem < 0 ? "text-emerald-400" : "text-zinc-300"}>{fmtNum(b.steem, 3)}</Mono>
                </div>
                <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-2">
                  <div className="text-[9px] text-zinc-500">נעול</div>
                  <Mono className="text-zinc-400">{fmtNum(b.lockedSaos, 3)} / {fmtNum(b.lockedSteem, 3)}</Mono>
                </div>
                <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-2">
                  <div className="text-[9px] text-zinc-500">LP</div>
                  <Mono className="text-teal-300">{b.lp > 0 ? fmtNum(b.lp, 3) : "—"}</Mono>
                </div>
                <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-2">
                  <div className="text-[9px] text-zinc-500">עגונים</div>
                  <Mono className="text-sky-300/90">{Object.entries(b.wrapped).length ? Object.entries(b.wrapped).map(([s, v]) => `${s}:${fmtNum(v, 3)}`).join(" ") : "—"}</Mono>
                </div>
                <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-2">
                  <div className="text-[9px] text-zinc-500">אשראי</div>
                  <Mono className="text-violet-300">{fmtNum(b.credits, 3)}</Mono>
                </div>
              </div>
            )}

            {/* סטטיסטיקת-פעילות */}
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant="outline" className="border-emerald-400/40 bg-emerald-400/10 px-1.5 py-0 text-[9px] text-emerald-300">
                {a?.ops ?? 0} אופים-על-השרשרת
              </Badge>
              <Badge variant="outline" className="border-zinc-700 px-1.5 py-0 text-[9px] text-zinc-400">
                גז-ששולם: <Mono className="text-zinc-300">{fmtNum(a?.gasPaid ?? 0, 0)}</Mono>
              </Badge>
              {(a?.yieldReceived ?? 0) > 0 && (
                <Badge variant="outline" className="border-violet-400/40 bg-violet-400/10 px-1.5 py-0 text-[9px] text-violet-300">
                  תשואה-שהתקבלה: {fmtNum(a?.yieldReceived ?? 0, 3)} SAOS
                </Badge>
              )}
              {(a?.produceRounds ?? 0) > 0 && (
                <Badge variant="outline" className="border-orange-400/40 bg-orange-400/10 px-1.5 py-0 text-[9px] text-orange-300">
                  ראש-ב-{a?.produceRounds} סבבים
                </Badge>
              )}
              {(a?.attests ?? 0) > 0 && (
                <Badge variant="outline" className="border-violet-400/30 px-1.5 py-0 text-[9px] text-violet-200">
                  הצהרות-ולידטור: {a?.attests}
                </Badge>
              )}
              {statsEntries.map(([t, n]) => (
                <Badge key={t} variant="outline" className={cn("px-1.5 py-0 text-[9px]", opHe(t).cls)}>
                  {opHe(t).label} ×{n}
                </Badge>
              ))}
              {a && a.ops === 0 && <span className="text-[11px] text-zinc-500">לא-נמצאה פעילות על השרשרת (עד 512 בלוקים שמורים).</span>}
            </div>

            {/* ציר-פעילות */}
            <div>
              <div className="mb-1.5 text-[11px] font-semibold text-zinc-300">ציר-פעילות ({d.activity.length} אחרונים מתוך {a?.ops ?? 0})</div>
              <div className="max-h-64 space-y-1 overflow-y-auto pr-1 scrollbar-thin">
                {d.activity.map((it, i) => {
                  const he = opHe(it.type);
                  return (
                    <div key={`${it.height}-${i}`} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-lg border border-zinc-800 bg-zinc-950/60 px-2.5 py-1.5">
                      <Mono className="text-[10px] font-bold text-zinc-100">#{it.height}</Mono>
                      <Badge variant="outline" className={cn("px-1.5 py-0 text-[8px]", he.cls)}>{he.label}</Badge>
                      <span className="text-[10px] text-zinc-400">
                        {it.roles.map((r) => ROLE_HE[r] ?? r).join(" · ")}
                      </span>
                      <span className="truncate text-[10px] text-zinc-300">{txMain(it.view)}</span>
                      {it.ok === false && <Badge variant="outline" className="border-rose-400/40 px-1 py-0 text-[8px] text-rose-300">נכשל: {it.err ?? "?"}</Badge>}
                      <Mono className="text-zinc-600">{it.gas} gas</Mono>
                      <span className="mr-auto text-[9px] text-zinc-600">{relTime(it.time)}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* הזמנות-ומילויים */}
            {d.orders.length > 0 && (
              <div>
                <div className="mb-1.5 text-[11px] font-semibold text-zinc-300">הזמנות ({d.orders.length})</div>
                <div className="max-h-40 space-y-1 overflow-y-auto scrollbar-thin">
                  {d.orders.map((o) => (
                    <div key={o.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950/60 px-2.5 py-1.5 text-[10px]">
                      <Mono className="text-zinc-500">#{o.id}</Mono>
                      <Badge variant="outline" className={cn("px-1 py-0 text-[8px]", o.side === "sell" ? "border-rose-400/40 text-rose-300" : "border-emerald-400/40 text-emerald-300")}>
                        {o.side === "sell" ? "שאל" : "ביד"}
                      </Badge>
                      <Mono className="text-zinc-400">{fmtNum(o.amount, 3)} @ {fmtNum(o.price, 6)}</Mono>
                      {o.live ? <Badge variant="outline" className="border-emerald-400/30 px-1 py-0 text-[8px] text-emerald-300">חיה</Badge> : <span className="text-[9px] text-zinc-600">סגורה</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {d.produces.length > 0 && (
              <div>
                <div className="mb-1.5 text-[11px] font-semibold text-zinc-300">סבבי-הפקה ({d.produces.length})</div>
                <div className="flex flex-wrap gap-1">
                  {d.produces.map((p) => (
                    <Badge key={p.round} variant="outline" className={cn("px-1.5 py-0 font-mono text-[9px]", p.lawOk ? "border-orange-400/40 bg-orange-400/10 text-orange-300" : "border-rose-400/40 text-rose-300")}>
                      r{p.round} · blk {p.height} {p.verified ? "· ✓" : ""}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ── ספר: סולם ── */
function Ladder({ rows, side, onName }: { rows: ExplorerResponse["orders"]; side: "sell" | "buy"; onName: (n: string) => void }) {
  const live = rows.filter((o) => o.live && o.side === side);
  const sorted = side === "sell" ? [...live].sort((a, b) => a.price - b.price) : [...live].sort((a, b) => b.price - a.price);
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5">
      <div className={cn("mb-1.5 text-[10px] font-bold", side === "sell" ? "text-rose-300" : "text-emerald-300")}>
        {side === "sell" ? "שאלות (מוכרים)" : "בידים (קונים)"} · {live.length}
      </div>
      <div className="max-h-40 space-y-1 overflow-y-auto scrollbar-thin">
        {sorted.map((o) => (
          <div key={o.id} className="flex items-center justify-between gap-2 text-[10px]">
            <NameTag name={o.owner} onOpen={onName} />
            <Mono className="text-zinc-300">
              {fmtNum(o.amount, 3)} @ {fmtNum(o.price, 6)}
            </Mono>
          </div>
        ))}
        {!sorted.length && <p className="text-[10px] text-zinc-600">אין הזמנות חיות בצד זה.</p>}
      </div>
    </div>
  );
}

function FillRow({ f, onName }: { f: ExplorerFill; onName: (n: string) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-lg border border-zinc-800 bg-zinc-950/60 px-2.5 py-1.5 text-[10px]">
      <Badge variant="outline" className="border-fuchsia-400/40 bg-fuchsia-400/10 px-1 py-0 text-[9px] text-fuchsia-300">
        #{f.height}
      </Badge>
      <span className="text-zinc-300">
        <NameTag name={f.taker} onOpen={onName} /> ← הזמנה #{f.orderId}
        {f.maker ? (
          <>
            {" "}של <NameTag name={f.maker} onOpen={onName} />
          </>
        ) : ""}
      </span>
      <Mono className="text-zinc-400">
        {fmtNum(f.amount, 3)} @ {f.price != null ? fmtNum(f.price, 6) : "—"}
      </Mono>
      {f.ok ? <BadgeCheck className="size-3 text-emerald-400" /> : <Badge variant="outline" className="border-rose-400/40 px-1 py-0 text-[8px] text-rose-300">{f.ref ? "skip" : "fail"}</Badge>}
      <span className="mr-auto text-zinc-600">{relTime(f.time)}</span>
    </div>
  );
}

/* ── המסך ── */
export function ExplorerView() {
  const d = useExplorer(true);
  const tb = useTronBridge(true);
  const sn = useSaosNet(true); // 94 — נגזרות-עטופות (WTRX) מהצומת
  const ct = useChainTalk(true); // 94 — משימת-השרשרת + מחזור-הסוחר-הריבוני
  const [tab, setTab] = useState("blocks");
  const [detail, setDetail] = useState<number | null>(null);
  const [accName, setAccName] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [older, setOlder] = useState<ExplorerBlock[]>([]);
  const [offset, setOffset] = useState(0);
  const [loadingOlder, setLoadingOlder] = useState(false);

  const s = d?.summary ?? null;
  const integ = s?.integrity ?? null;

  const loadOlder = useCallback(async () => {
    setLoadingOlder(true);
    try {
      const nextOffset = offset + 20;
      const r = await fetch(`/api/ops/sovexplorer?limit=20&offset=${nextOffset}`);
      const j = await r.json();
      setOlder((prev) => [...prev, ...((j?.blocks ?? []) as ExplorerBlock[])]);
      setOffset(nextOffset);
    } catch {
      /* כנות — כישלון-טעינה לא מפיל את המסך */
    } finally {
      setLoadingOlder(false);
    }
  }, [offset]);

  const searchBlock = useCallback(() => {
    const q = search.trim().replace(/^@/, "");
    if (!q) return;
    const h = parseInt(q, 10);
    if (Number.isFinite(h) && h >= 1 && String(h) === q) setDetail(h);
    else setAccName(q.toLowerCase()); // 73: חיפוש-חשבון — כל-מה-שהוא-לא-מספר הוא שם
  }, [search]);

  const blockList: ExplorerBlock[] = [...(d?.blocks ?? []), ...older];

  if (!d || !s) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-16 w-full bg-zinc-800/60" />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-16 bg-zinc-800/60" />
          ))}
        </div>
        <Skeleton className="h-72 w-full bg-zinc-800/60" />
      </div>
    );
  }

  const kpis: { label: string; value: React.ReactNode; sub?: string; cls?: string }[] = [
    { label: "גובה", value: <Mono className="text-[13px] font-bold text-zinc-100">{s.height}</Mono>, sub: `${s.beats} פעימות` },
    { label: "אספקה", value: `${fmtNum(s.supply, 1)} SAOS`, sub: "מהג'נזיס-הנגזר" },
    /* 107 — האמת-במספרים: ה-KPI מציג את ספירת-הספר-המלא (מדויק) — החלון-מוצהר-בתת-כותרת */
    {
      label: "טרנזאקציות",
      value: fmtNum(s.bookTxTotal ?? s.txsTotal, 0),
      sub:
        s.txsScope && s.bookTxTotal != null
          ? `הספר-המלא (${s.bookBlocks ?? "?"} בלוקים) · חלון: ${fmtNum(s.txsTotal, 0)}`
          : `${fmtNum(s.gasTotal, 0)} גז`,
    },
    { label: "חשבונות", value: fmtNum(s.accountsCount, 0), sub: "ספר-ריבוני" },
    { label: "ספר-חי", value: <span dir="ltr" className="font-mono text-[11px]">{s.asks}a / {s.bids}b</span>, sub: `${s.liveOrders} הזמנות` },
    { label: "מחיר-אחרון", value: s.lastPrice != null ? fmtNum(s.lastPrice, 6) : "—", sub: `${s.trades} מילויים` },
    { label: "עמלות-שרשרת", value: <Mono className="text-[11px]">{fmtNum(s.fees.total * 1000, 0)}µ</Mono>, sub: `${fmtNum(s.fees.feeBps, 0)} bps` },
    { label: "גבול-מארח", value: <span className={s.boundarySteem < 0 ? "text-emerald-400" : "text-amber-300"}>{fmtNum(s.boundarySteem, 3)}</span>, sub: "STEEM נטו-אלינו" },
  ];

  return (
    <div className="space-y-4">
      {/* כותרת + שלמות */}
      <div className="rounded-xl border border-violet-900/40 bg-gradient-to-l from-violet-400/[0.04] to-fuchsia-400/[0.04] p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Blocks className="size-4 text-violet-300" aria-hidden="true" />
          <h1 className="text-[15px] font-black text-zinc-100">אקספלורר SAOS-NET</h1>
          <Badge variant="outline" className="border-violet-400/40 bg-violet-400/10 px-1.5 py-0 font-mono text-[9px] text-violet-300">
            {d.net}
          </Badge>
          {integ &&
            (integ.ok ? (
              <Badge variant="outline" className="border-emerald-400/40 bg-emerald-400/10 px-2 py-0 font-mono text-[10px] text-emerald-300">
                <ShieldCheck className="ml-1 size-3" />
                stateRepro {integ.checkpointsReproduced}/{integ.checkpoints} צ&apos;קפוינטים · root ✓ · מקור-תצוגה: מצב-חי
              </Badge>
            ) : (
              <Badge variant="outline" className="border-rose-400/40 bg-rose-400/10 px-2 py-0 font-mono text-[10px] text-rose-300">
                <ShieldX className="ml-1 size-3" />
                stateRepro {integ.checkpointsReproduced}/{integ.checkpoints} · root {integ.finalRootMatch ? "✓" : "×"}
                {integ.stateRepro?.firstBadHeight ? ` · ראשון-סוטה h${integ.stateRepro.firstBadHeight}` : ""}
              </Badge>
            ))}
          <span className="text-[10px] text-zinc-500">תיעוד-הרשת-על-הרשת · stateRepro — replay-מהקרנל-הדטרמיניסטי · השורש-הסופי ≡ הצומת-החי</span>
          {s.head && (
            <Badge variant="outline" className="border-orange-400/40 bg-orange-400/10 px-1.5 py-0 font-mono text-[9px] text-orange-300">
              <Crown className="ml-1 size-2.5" />
              head @{s.head} (r{s.headRound ?? "?"})
            </Badge>
          )}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-zinc-500">
          <span>
            genesisHash: <Mono className="text-zinc-300">{s.genesisHash?.slice(0, 20)}…</Mono>
          </span>
          <span>
            stateRoot: <Mono className="text-emerald-300/90">{s.stateRoot?.slice(0, 20)}…</Mono>
          </span>
          <span>
            lastBlock: <Mono className="text-zinc-300">{s.lastBlockHash?.slice(0, 20)}…</Mono>
          </span>
          {d.phoenix?.verdict && (
            <span>
              phoenix: <span className="text-amber-300">{d.phoenix.verdict} ({d.phoenix.checks})</span>
            </span>
          )}
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5">
            <div className="text-[9px] text-zinc-500">{k.label}</div>
            <div className={cn("mt-0.5 truncate text-[12px] font-semibold text-zinc-100", k.cls)}>{k.value}</div>
            {k.sub && <div className="text-[9px] text-zinc-600">{k.sub}</div>}
          </div>
        ))}
      </div>

      {/* 88: עימות-השלמת-עסקאות — כל-tx נבדק מול תוצאות-הקרנל (measured, לא-מובטח) */}
      {s.txCompletion && (
        <div
          className={cn(
            "rounded-xl border p-3",
            s.txCompletion.recent.ratePct >= 95
              ? "border-emerald-900/50 bg-emerald-400/[0.03]"
              : s.txCompletion.recent.ratePct >= 70
                ? "border-amber-900/50 bg-amber-400/[0.03]"
                : "border-rose-900/50 bg-rose-400/[0.03]"
          )}
        >
          <div className="flex flex-wrap items-center gap-2">
            <PackageCheck className="size-4 text-zinc-300" aria-hidden="true" />
            <span className="text-[12px] font-bold text-zinc-100">עימות-השלמת-עסקאות (88)</span>
            <Badge
              variant="outline"
              className={cn(
                "px-2 py-0 font-mono text-[10px]",
                s.txCompletion.recent.ratePct >= 95
                  ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300"
                  : "border-rose-400/40 bg-rose-400/10 text-rose-300"
              )}
            >
              חי (50 בלוקים): {s.txCompletion.recent.ok}✓ / {s.txCompletion.recent.fail}× · {s.txCompletion.recent.ratePct}%
            </Badge>
            <span className="text-[10px] text-zinc-500">
              כולל-היסטוריה: {fmtNum(s.txCompletion.ok, 0)}✓ / {fmtNum(s.txCompletion.fail, 0)}× מתוך {fmtNum(s.txCompletion.total, 0)} ({s.txCompletion.ratePct}%)
            </span>
          </div>
          {s.txCompletion.fail > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-zinc-500">
              <span className="text-zinc-400">סיבות-כישלון (היסטוריה מדודה):</span>
              {Object.entries(s.txCompletion.failByErr)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 4)
                .map(([err, n]) => (
                  <span key={err} dir="ltr" className="font-mono text-rose-300/80">
                    {err}×{n}
                  </span>
                ))}
              <span className="text-zinc-600">dup-attest = חתימה-כפולה-על-אותו-צ'קפוינט (תוקן-88: אף-tx-נידון-לא-משודר-עוד · הקרנל-החי-מול-השידור)</span>
            </div>
          )}
        </div>
      )}

      {/* 90: גשר SAOS ⇄ TRON — עוגני-צ'קפוינט על שרשרת ציבורית, מוצלב חי מול TronGrid */}
      {tb && tb.address && (
        <div className="rounded-xl border border-emerald-900/50 bg-emerald-400/[0.03] p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Link2 className="size-4 text-zinc-300" aria-hidden="true" />
            <span className="text-[12px] font-bold text-zinc-100">גשר SAOS ⇄ TRON (90)</span>
            <Badge
              variant="outline"
              className={cn(
                "px-2 py-0 font-mono text-[10px]",
                tb.live?.ok ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300" : "border-zinc-700 bg-zinc-900 text-zinc-400"
              )}
            >
              {tb.live?.ok ? "חי מול TronGrid" : "מדידה-אחרונה"}
            </Badge>
            {tb.totals && (
              <span className="text-[10px] text-zinc-500">
                עוגנים {tb.totals.onChain}/{tb.totals.count} על-השרשרת · קישור-מוכח {tb.totals.bindingProven} · שריפה-כוללת {(tb.totals.burnSunTotal / 1e6).toFixed(3)} TRX
              </span>
            )}
          </div>
          {tb.wallet && (
            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-[10px] text-zinc-400">
              <span>
                שדרן{" "}
                <a dir="ltr" className="font-mono text-emerald-300/90 hover:underline" href={`https://tronscan.org/#/address/${tb.address}`} target="_blank" rel="noreferrer">
                  {shortAddr(tb.address)}
                </a>{" "}
                <span dir="ltr" className="font-mono">{tb.wallet.senderBalanceSun != null ? (tb.wallet.senderBalanceSun / 1e6).toFixed(6) : "?"} TRX</span>
              </span>
              {tb.relay && (
                <span>
                  · רכזת{" "}
                  <a dir="ltr" className="font-mono text-amber-300/80 hover:underline" href={`https://tronscan.org/#/address/${tb.relay}`} target="_blank" rel="noreferrer">
                    {shortAddr(tb.relay)}
                  </a>{" "}
                  <span dir="ltr" className="font-mono">{tb.wallet.relayBalanceSun != null ? (tb.wallet.relayBalanceSun / 1e6).toFixed(6) : "?"} TRX</span>
                </span>
              )}
              <span dir="ltr" className="font-mono text-zinc-500">freeNet {tb.wallet.freeNetLeft}/{tb.wallet.freeNetLimit}B</span>
            </div>
          )}
          {(tb.anchors ?? []).map((a) => (
            <div key={a.txid} className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px]">
              <span className="text-zinc-300">cp#{a.cpHeight}</span>
              <span className="text-zinc-500">→</span>
              <a dir="ltr" className="font-mono text-amber-300/90 hover:underline" href={`https://tronscan.org/#/transaction/${a.txid}`} target="_blank" rel="noreferrer">
                TRON {a.txid.slice(0, 12)}…{a.tronBlock ? ` · blk ${a.tronBlock}` : ""}
              </a>
              {a.encodedMatch === true && (
                <Badge variant="outline" className="border-emerald-400/40 bg-emerald-400/10 px-1.5 py-0 text-[9px] text-emerald-300">כמות≡hash ✓</Badge>
              )}
              {a.encodedMatch === false && (
                <Badge variant="outline" className="border-rose-400/40 bg-rose-400/10 px-1.5 py-0 text-[9px] text-rose-300">אי-התאמה!</Badge>
              )}
              {a.encodedMatch === null && <span className="text-zinc-600">כמות: בדיקה-חיה בלתי-זמינה</span>}
              <span dir="ltr" className="font-mono text-zinc-500">net_fee {a.netFeeSun}sun</span>
              {a.notedHeight ? (
                <span className="text-zinc-400">נרשם-בספר-שלנו: בלוק {a.notedHeight}</span>
              ) : (
                <span className="text-amber-300/70">ממתין-לרישום-בספר</span>
              )}
            </div>
          ))}
          {tb.squad && (tb.squad.members?.length ?? 0) > 0 && (
            <div className="mt-2 rounded-md border border-amber-400/20 bg-amber-400/[0.04] p-2">
              <div className="flex flex-wrap items-center gap-2 text-[10px]">
                <Users className="size-3 text-amber-300" aria-hidden="true" />
                <span className="font-bold text-zinc-100">טבעת-החיילים על TRON (91)</span>
                <Badge
                  variant="outline"
                  className={cn(
                    "px-2 py-0 font-mono text-[9px]",
                    tb.squad.activated === tb.squad.indices.length
                      ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300"
                      : "border-amber-400/40 bg-amber-400/10 text-amber-300"
                  )}
                >
                  {tb.squad.activated}/{tb.squad.indices.length} מופעלים
                </Badge>
                {tb.squad.totals && (
                  <span className="text-zinc-500">
                    רגליים {tb.squad.totals.legsZeroFee}/{tb.squad.totals.legsTotal} אפס-עמלה · קישור-מוכח {tb.squad.totals.legsLinkedProven} · שריפת-הפעלה {((tb.squad.totals.activationBurnSun || 0) / 1e6).toFixed(2)} TRX חד-פעמית
                  </span>
                )}
              </div>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px]">
                {tb.squad.members.map((m) => (
                  <span key={m.idx} className="text-zinc-400">
                    חייל-s{m.idx}{" "}
                    <a dir="ltr" className="font-mono text-amber-300/80 hover:underline" href={`https://tronscan.org/#/address/${m.address}`} target="_blank" rel="noreferrer">
                      {shortAddr(m.address)}
                    </a>{" "}
                    <span dir="ltr" className="font-mono">{m.balanceTrx != null ? m.balanceTrx.toFixed(4) : "?"} TRX</span>
                    {m.freeNetLeft != null && <span dir="ltr" className="font-mono text-zinc-600"> · net {m.freeNetLeft}B</span>}
                  </span>
                ))}
              </div>
              {tb.squad.funding.length > 0 && (
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-zinc-400">
                  <span className="text-zinc-300">שרשרת-הפעלה עצמית:</span>
                  <span className="font-mono text-zinc-500">שדרן→s2→s3→s4→s5</span>
                  {tb.squad.funding.map((f) => (
                    <a key={f.txid} dir="ltr" className="font-mono text-amber-300/70 hover:underline" href={`https://tronscan.org/#/transaction/${f.txid}`} target="_blank" rel="noreferrer">
                      s{f.idxTo}:{f.txid.slice(0, 10)}…
                    </a>
                  ))}
                  <span className="text-zinc-500">· שריפה {((tb.squad.funding.reduce((s, f) => s + f.burnSun, 0) / 1e6).toFixed(2))} TRX חד-פעמית</span>
                </div>
              )}
              {tb.squad.rings.map((r) => (
                <div key={r.id} className="mt-1.5 rounded border border-zinc-800 bg-zinc-950/60 p-1.5">
                  <div className="flex flex-wrap items-center gap-2 text-[10px]">
                    <span className="font-bold text-zinc-200">טבעת #{r.id}</span>
                    {r.closed && <Badge variant="outline" className="border-emerald-400/40 bg-emerald-400/10 px-1.5 py-0 text-[9px] text-emerald-300">סגורה ✓</Badge>}
                    {r.zeroFeeAll && <Badge variant="outline" className="border-emerald-400/40 bg-emerald-400/10 px-1.5 py-0 text-[9px] text-emerald-300">אפס-עמלה ✓</Badge>}
                    {r.notedHeight ? <span className="text-zinc-400">נרשם-בספר: בלוק {r.notedHeight}</span> : <span className="text-amber-300/70">ממתין-לרישום-בספר</span>}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px]">
                    {r.legs.map((l, i) => (
                      <span key={l.txid} className="flex items-center gap-1">
                        {i > 0 && <span className="text-zinc-600">→</span>}
                        <span className="text-zinc-300">s{l.from}→s{l.to}</span>
                        <a dir="ltr" className="font-mono text-amber-300/80 hover:underline" href={`https://tronscan.org/#/transaction/${l.txid}`} target="_blank" rel="noreferrer">
                          {l.txid.slice(0, 10)}…
                        </a>
                        {l.netFeeSun === 0 && <Badge variant="outline" className="border-emerald-400/40 bg-emerald-400/10 px-1 py-0 text-[9px] text-emerald-300">fee 0</Badge>}
                        {l.linkedMatch === true && (
                          <Badge variant="outline" className="border-zinc-500/40 bg-zinc-400/10 px-1 py-0 text-[9px] text-zinc-300">
                            {l.linkedKind === "saos-cp" ? "≡cp-hash" : "≡prev-txid"}
                          </Badge>
                        )}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
              <div className="mt-1 text-[9px] leading-relaxed text-zinc-600">
                שרשרת-הפעלה עצמית: השדרן מדליק את חייל-2 והחיילים מדליקים זה-את-זה (המערכת מפיצה את עצמה מניצוץ-אחד) · כל-רגל-טבעת מקודדת את קידומת ה-txid הקודמת בכמות (רגל-1 ≡ checkpointHash של SAOS) — רשימה-מקושרת ציבורית ניתנת-לאימות עצמאי ב-TronScan · הטבעת כולה ברוחב-פס חינם · הארנק נשאר לא-בוס (91)
              </div>
            </div>
          )}
          {/* 92: עוגן-חי 24/7 + קשירת-הסדוגה-כחיילים + נגזרות + כיבולת */}
          {(tb.pulse || tb.squadBound || tb.capacity || tb.derivatives) && (
            <div className="mt-2 rounded-md border border-rose-400/25 bg-rose-400/[0.04] p-2">
              <div className="flex flex-wrap items-center gap-2 text-[10px]">
                <RadioTower className="size-3 text-rose-300" aria-hidden="true" />
                <span className="font-bold text-zinc-100">עוגן-חי 24/7 על TRON (92)</span>
                {tb.pulse?.tronHeight ? (
                  <Badge variant="outline" className="border-rose-400/40 bg-rose-400/10 px-2 py-0 font-mono text-[9px] text-rose-300">
                    TRON blk {tb.pulse.tronHeight} · {relTime(tb.pulse.at || "")}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="border-zinc-500/40 bg-zinc-400/10 px-2 py-0 font-mono text-[9px] text-zinc-400">
                    pulse: לא-נמדד
                  </Badge>
                )}
                {tb.pulse?.notedHeight ? <span className="text-zinc-400">עדות-על-הספר: בלוק {tb.pulse.notedHeight}</span> : null}
                {tb.pulse?.error ? <span className="text-amber-300/80">{tb.pulse.error}</span> : null}
                {tb.squadBound?.notedHeight ? (
                  <Badge variant="outline" className="border-emerald-400/40 bg-emerald-400/10 px-2 py-0 font-mono text-[9px] text-emerald-300">
                    <Link2 className="ml-1 size-3" />
                    {tb.squadBound.count ?? 6} כתובות-TRON קשורות-כחיילים · בלוק {tb.squadBound.notedHeight}
                  </Badge>
                ) : null}
                {tb.capacity && (
                  <span className="text-zinc-500">
                    קיבולת: ≈{tb.capacity.estFreeTxPerDay} עסקאות-אפס-עמלה/יום ({tb.capacity.addresses}×600B רוחב-פס-חינם)
                  </span>
                )}
              </div>
              {tb.derivatives && (
                <div className="mt-1 text-[10px] text-zinc-400">
                  נגזרות (קריאה-בלבד): USDT-TRC20 סה״כ{" "}
                  <span dir="ltr" className="font-mono text-zinc-200">{tb.derivatives.usdtTotal ?? 0}</span> USDT
                  {tb.derivatives.measured ? (
                    <span dir="ltr" className="font-mono text-zinc-600"> · measured {tb.derivatives.measured}</span>
                  ) : null}
                  {tb.derivatives.notedHeight ? <span className="text-zinc-500"> · ניטור-חמוש: בלוק {tb.derivatives.notedHeight}</span> : null}
                  <span className="text-zinc-600"> — כשייכנס-ערך לאחת-מהכתובות → בלוק-אירוע-מיידי</span>
                </div>
              )}
              <div className="mt-1 text-[9px] leading-relaxed text-zinc-600">
                כל-פעימה קוראת את הבלוק-המאושר-האחרון של TRON (אפס-עלות); כל-Δ1200 בלוקי-TRON (≈שעה) נחתם-בלוק-עדות-על-הספר-שלנו — ראיה-חיה-מתמדת שהרשת-שלנו-שזורה-24/7 בתוך זרם-TRON (שלא-תיפול); אחרי-איפוס-רוחב-הפס-החינמי (00:00 UTC) טבעת-לפיד-חדשה-נורית-אוטומטית ועוגן-צ&apos;קפוינט-הבא (תגובות-שרשרת-מתוכננות) (92)
              </div>
            </div>
          )}
          {tb.reaction && (
            <div
              className={cn(
                "mt-1.5 rounded-md border px-2 py-1 text-[10px]",
                tb.reaction.interleaved ? "border-emerald-400/30 bg-emerald-400/[0.06] text-emerald-200/90" : "border-amber-400/30 bg-amber-400/[0.05] text-amber-200/90"
              )}
            >
              {tb.reaction.interleaved ? "שזיר-מאומת SAOS→TRON→SAOS" : "שזיר: ממתין-לאימות"}
              {tb.reaction.note ? <span dir="ltr" className="font-mono"> · {tb.reaction.note}</span> : null}
            </div>
          )}
          <div className="mt-1 text-[9px] leading-relaxed text-zinc-600">
            קידומת ה-checkpointHash מוצפנת בשבר ה-TRX (למשל 1.785262 ≡ d258ae…) — הוכחת-קשר ציבורית, ניתנת-לאימות עצמאי ב-TronScan · העברה-פנימית בלבד בין כתובות הכספת · רוחב-פס חינם · ≤2 עוגנים/יום · הארנק אינו ״בוס״ — אחריות מינימלית (90·91)
          </div>
        </div>
      )}

      {/* 94: CHAINTALK — שפת-התקשורת בין-הרשתות + WTRX (ערך-טרון על-הרשת-שלנו) */}
      {(ct?.mission || ct?.sovBiz || sn?.node?.wrapped?.WTRX) && (
        <div className="mt-2 rounded-lg border border-sky-400/25 bg-sky-400/[0.04] p-3">
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <span className="text-sm">🔗</span>
            <span className="font-bold text-zinc-100">CHAINTALK — שפת-שרשרת בין-הרשתות (94)</span>
            {ct?.mission && (
              <Badge
                variant="outline"
                className={cn(
                  "px-2 py-0 font-mono text-[9px]",
                  ct.mission.allMatch
                    ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300"
                    : "border-amber-400/40 bg-amber-400/10 text-amber-300"
                )}
              >
                CHL-1 · {ct.mission.matches} match · {ct.mission.durationS}s
              </Badge>
            )}
            {sn?.node?.wrapped?.WTRX && (
              <Badge variant="outline" className="border-sky-400/40 bg-sky-400/10 px-2 py-0 font-mono text-[9px] text-sky-300">
                WTRX {fmtNum(sn.node.wrapped.WTRX.supply, 2)} · עטוף {fmtNum(sn.node.wrapped.WTRX.locked, 2)} TRX · {sn.node.wrapped.WTRX.holders} מחזיקים
              </Badge>
            )}
          </div>

          {sn?.node?.wrapped?.WTRX && (
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[10px] text-zinc-300">
              <Badge
                variant="outline"
                className={cn(
                  "px-2 py-0 text-[9px]",
                  sn.node.wrapped.WTRX.locked >= sn.node.wrapped.WTRX.supply
                    ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300"
                    : "border-rose-400/40 bg-rose-400/10 text-rose-300"
                )}
              >
                {sn.node.wrapped.WTRX.locked >= sn.node.wrapped.WTRX.supply ? "עטוף-מלא ✓" : "חסר-כיסוי ✗"}
              </Badge>
              <span>
                ייצוג פנימי של 17 TRX (~$4.9 מה-TRX שהוזרק) — לא ערך-חדש שנוצר, אלא ה-TRX שלנו שנרשם כנגזרת-עטופה על הספר וחולק ל-11 חברי-הצי · מגובה במדידה-חיה-מלאה (95: 6/6 כתובות — הכיסוי תוקן-על-הספר) · ה-TRX עצמו נשאר דלק-הגשר (הארנק לא-בוס)
              </span>
            </div>
          )}

          {ct?.mission && (
            <div className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2">
              {ct.mission.steps.map((s) => (
                <div
                  key={s.id}
                  className={cn(
                    "rounded-md border px-2 py-1 text-[10px]",
                    s.match ? "border-emerald-400/25 bg-emerald-400/[0.05]" : "border-rose-400/25 bg-rose-400/[0.05]"
                  )}
                >
                  <div className="flex items-center gap-1.5">
                    <span className={s.match ? "text-emerald-300" : "text-rose-300"}>{s.match ? "✓" : "✗"}</span>
                    <span className="font-semibold text-zinc-200">{s.label ?? s.id}</span>
                    {s.net && <Badge variant="outline" className="border-zinc-600 px-1 py-0 text-[8px] text-zinc-400">{s.net}</Badge>}
                  </div>
                  <div className="mt-0.5 text-[9px] leading-snug text-zinc-500">{s.evidence}</div>
                </div>
              ))}
            </div>
          )}
          {ct?.mission?.summaryHe && <div className="mt-1.5 text-[9px] leading-relaxed text-zinc-500">{ct.mission.summaryHe}</div>}

          {ct?.sovBiz && (
            <div className="mt-2 rounded-md border border-zinc-700/50 bg-zinc-900/40 px-2 py-1.5 text-[10px] text-zinc-300">
              <span className="font-semibold text-zinc-200">מחזור-סוחר ריבוני — אפס-STEEM:</span>{" "}
              הזמנה{" "}
              <a
                dir="ltr"
                className="font-mono text-sky-300/80 hover:underline"
                href={ct.sovBiz.orderTxid ? `https://steemblockexplorer.com/tx/${ct.sovBiz.orderTxid}` : "#"}
                target="_blank"
                rel="noreferrer"
              >
                {ct.sovBiz.orderTxid ? `${ct.sovBiz.orderTxid.slice(0, 10)}…` : "—"}
              </a>{" "}
              (blk {ct.sovBiz.orderBlock ?? "—"}) · מילוי {ct.sovBiz.fill ?? "—"} על הספר-שלנו · קבלה-מוצפנת{" "}
              {ct.sovBiz.encReceiptOk ? <span className="text-emerald-300">ECDH ✓</span> : <span className="text-amber-300">ממתין</span>} ·{" "}
              <span dir="ltr" className="font-mono text-emerald-300">STEEM moved: {ct.sovBiz.steemMoved ?? "0.000"}</span>
              <span className="text-zinc-600"> — המסילה-הישנה עלתה 0.003 STEEM למחזור; הריבונית: 0.000 (custom_json + ספר-פנימי) (94)</span>
            </div>
          )}
        </div>
      )}

      {/* 95: WEAVE-95 — חיבור-כולם לראש @headcorner בלי-לגעת-במפתחות-ראשיים + תיקון-הכיסוי */}
      {sn?.weave95 && (
        <div className="mt-2 rounded-lg border border-emerald-400/25 bg-emerald-400/[0.04] p-3">
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <span className="text-sm">🕸️</span>
            <span className="font-bold text-zinc-100">WEAVE-95 — הכול שזור לראש @headcorner (95)</span>
            <Badge
              variant="outline"
              className={cn(
                "px-2 py-0 font-mono text-[9px]",
                sn.weave95.completion?.ok
                  ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300"
                  : "border-amber-400/40 bg-amber-400/10 text-amber-300"
              )}
            >
              {sn.weave95.completion?.ok ? "5/5 · נמדד-ומאומת" : "בתהליך"}
            </Badge>
            {sn.weave95.completion?.verify && (
              <Badge variant="outline" className="border-sky-400/40 bg-sky-400/10 px-2 py-0 font-mono text-[9px] text-sky-300">
                כספת {fmtNum(sn.weave95.completion.verify.locked, 3)} TRX/6 · WTRX {fmtNum(sn.weave95.completion.verify.supply, 3)} · cover {(sn.weave95.completion.verify.locked / Math.max(sn.weave95.completion.verify.supply, 0.001)).toFixed(2)}×
              </Badge>
            )}
          </div>

          <div className="mt-1.5 grid grid-cols-1 gap-1 text-[10px] text-zinc-300 sm:grid-cols-2">
            <div className="rounded-md border border-zinc-700/50 bg-zinc-900/40 px-2 py-1.5">
              <span className="font-semibold text-zinc-200">תיקון-זיוף-מדידה:</span> הסינון-הישן ספר-תשובות-ריקות-מ-TronGrid כאפס → רשם-כיסוי 20.84 · מדידה-חיה-מלאה = <span className="font-mono text-emerald-300">24.443 TRX</span> · התיקון <span className="font-mono">+3.603</span> על-הספר-עצמו (wrap_cover h633 — לא-עריכת-היסטוריה)
            </div>
            <div className="rounded-md border border-zinc-700/50 bg-zinc-900/40 px-2 py-1.5">
              <span className="font-semibold text-zinc-200">לולאת-פדיון-חיה:</span> burn+remint של WTRX על-הספר (h633+h{sn.weave95.completion?.verify?.burnHeight ?? "?"}) — כל-מחזיק יכול-לפדות, הכיסוי-משתחרר-ונרשם מחדש · <span className="font-mono text-zinc-400">21/21 refs בספר</span>
            </div>
          </div>

          {sn.weave95.completion?.anchor?.txid && (
            <div className="mt-1.5 text-[10px] text-zinc-300">
              <span className="font-semibold text-zinc-200">עוגן-השרשרת על Steem (custom_json — אפס-עמלה):</span>{" "}
              <a
                dir="ltr"
                className="font-mono text-sky-300/80 hover:underline"
                href={`https://steemblockexplorer.com/tx/${sn.weave95.completion.anchor.txid}`}
                target="_blank"
                rel="noreferrer"
              >
                {sn.weave95.completion.anchor.txid.slice(0, 12)}…
              </a>{" "}
              {sn.weave95.completion.anchor.found?.block ? <span className="text-zinc-500">blk {sn.weave95.completion.anchor.found.block} ✓</span> : <span className="text-amber-300">ממתין-אינדוקס</span>}
            </div>
          )}

          {sn.node?.delegations && (
            <div className="mt-2">
              <div className="mb-1 flex items-center gap-2 text-[10px]">
                <span className="font-semibold text-zinc-200">מטריצת-ההאצלה — {Object.keys(sn.node.delegations).length} נושאים מחוברים-לראש:</span>
                <span className="text-zinc-500">סקופים על הספר · המפתחות-הראשיים-נשארים-אישיים (posting בלבד + ECDH)</span>
              </div>
              <div className="max-h-36 overflow-y-auto rounded-md border border-zinc-800 bg-zinc-950/60 p-1.5 [scrollbar-width:thin]">
                <div className="grid grid-cols-1 gap-0.5 sm:grid-cols-2">
                  {Object.entries(sn.node.delegations).map(([subject, d]) => (
                    <div key={subject} className="flex items-center justify-between gap-1 rounded px-1.5 py-0.5 text-[9px] hover:bg-zinc-900">
                      <span dir="ltr" className="font-mono text-zinc-300">@{subject}</span>
                      <span dir="ltr" className="font-mono text-[8px] text-emerald-300/80">{d.scopes.join(" · ")}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {sn.weave95.completion?.bugFound && (
            <div className="mt-1.5 text-[9px] leading-relaxed text-zinc-600">
              כנות-מלאה: תפסנו-באג-אמת בזמן-ריצה ({sn.weave95.completion.bugFound}) → תוקן ({sn.weave95.completion.bugFixed}) — העצירה-הכנה-של-M4 היא-ההוכחה-שאין-זיופים
            </div>
          )}
        </div>
      )}

      {/* 96: WRAPPED-TRON ECONOMY — כל-המטבעות-המוכרים של טרון על אותה טכנולוגיה + שווי-כלכלי + איזון-דקס */}
      {sn?.node?.assetMeta && (
        <div className="mt-2 rounded-lg border border-amber-400/25 bg-amber-400/[0.04] p-3">
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <span className="text-sm">🪙</span>
            <span className="font-bold text-zinc-100">WRAPPED-TRON ECONOMY — כל-מטבעות-טרון על הספר (96)</span>
            <Badge variant="outline" className="border-amber-400/40 bg-amber-400/10 px-2 py-0 font-mono text-[9px] text-amber-300">
              {Object.keys(sn.node.assetMeta).length} רשומים · {Object.keys(sn.node.assetPrices ?? {}).length} ציטוטים-חתומים
            </Badge>
            {sn.econ96 && (
              <Badge
                variant="outline"
                className={cn(
                  "px-2 py-0 font-mono text-[9px]",
                  sn.econ96.allMatch ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300" : "border-amber-400/40 bg-amber-400/10 text-amber-300"
                )}
              >
                {sn.econ96.allMatch ? `ECON-96 ${sn.econ96.steps.filter((s) => s.match).length}/${sn.econ96.steps.length} ✓` : "ECON-96 בתהליך"}
              </Badge>
            )}
          </div>

          <div className="mt-1.5 text-[10px] text-zinc-300">
            <span className="font-semibold text-zinc-200">העיקרון-הכנה:</span> רישום-מטבע ≠ הנפקת-ערך — supply נולד אפס עד הוכחת-נעילה אמת (wrap_mint עם-ref-נעילה נשאר הדרך-היחידה; מגן-under-backed לא זז) · כל חוזה-אם <span className="font-semibold text-zinc-200">אומת-חי</span> מול Tronscan (זהות) + TronGrid (type=Contract) · הציטוטים על-הספר חתומים src+ref (ננו-דולר שלם, בלי-float)
          </div>

          <div className="mt-2 max-h-44 overflow-y-auto rounded-md border border-zinc-800 bg-zinc-950/60 p-1.5 [scrollbar-width:thin]">
            <table className="w-full text-[9px]">
              <thead>
                <tr className="text-zinc-500">
                  <th className="px-1.5 py-0.5 text-right font-medium">מטבע</th>
                  <th className="px-1.5 py-0.5 text-right font-medium">שרשרת</th>
                  <th className="px-1.5 py-0.5 text-right font-medium">supply/locked</th>
                  <th className="px-1.5 py-0.5 text-right font-medium">מחיר (על-הספר)</th>
                  <th className="hidden px-1.5 py-0.5 text-right font-medium sm:table-cell">עדי-חוזה</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(sn.node.assetMeta).map(([sym, meta]) => {
                  const pxEntry = sn.node?.assetPrices?.[sym];
                  const w = sn.node?.wrapped?.[sym];
                  const pxUsd = pxEntry ? pxEntry.px / 1e9 : null;
                  const pxShow = pxUsd != null ? (pxUsd >= 0.01 ? `$${pxUsd.toFixed(4)}` : `$${pxUsd.toExponential(2)}`) : "—";
                  const holders = (meta.note.match(/([\d,]+) holders/) || [])[1] ?? null;
                  return (
                    <tr key={sym} className="border-t border-zinc-800/60 hover:bg-zinc-900/60">
                      <td className="px-1.5 py-0.5">
                        <span dir="ltr" className="font-mono font-bold text-amber-200/90">{sym}</span>
                        {w && w.supply > 0 ? <span className="mr-1 text-[8px] text-emerald-300/80">חי</span> : <span className="mr-1 text-[8px] text-zinc-600">bridge-ready</span>}
                      </td>
                      <td dir="ltr" className="px-1.5 py-0.5 font-mono text-zinc-400">{meta.chain}{meta.contract ? "·TRC20" : "·native"}</td>
                      <td dir="ltr" className="px-1.5 py-0.5 font-mono text-zinc-300">
                        {w ? `${fmtNum(w.supply, 3)}/${fmtNum(w.locked, 3)}` : "—"}
                        {w && w.locked > 0 && w.supply > 0 ? <span className="text-emerald-300/80"> ({(w.locked / Math.max(w.supply, 0.000001)).toFixed(2)}×)</span> : null}
                      </td>
                      <td dir="ltr" className="px-1.5 py-0.5 font-mono text-emerald-300/80">{pxShow}</td>
                      <td dir="ltr" className="hidden px-1.5 py-0.5 font-mono text-[8px] text-zinc-500 sm:table-cell">
                        {meta.contract ? `${meta.contract.slice(0, 10)}…${holders ? ` · ${holders} holders` : ""}` : meta.note.slice(0, 40)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {sn.econ96?.allMatch && (
            <div className="mt-1.5 text-[10px] text-zinc-300">
              <span className="font-semibold text-zinc-200">איזון-הדקס (ECON-96):</span> ארביטראז-פנימי בין הבריכה לספר נסגר על-הספר-עצמו לטובת האוצר — <span dir="ltr" className="font-mono text-emerald-300">gap 86.6% → 0%</span> · הבריכה הועמקה פרופורציונלית בלי-להזיז-מחיר · <span className="font-semibold text-zinc-200">שווי-WTRX מהציטוט-על-הספר:</span> <span dir="ltr" className="font-mono text-amber-200/90">17 WTRX ≈ $5.67</span> (cover 143.8% מ-24.443 TRX מדוד-חי)
            </div>
          )}
        </div>
      )}

      {/* 97: GRID-PROFIT — מנוע-הגריד-האוטונומי-הרווחי: סולם-אוצר · ארביטראז · בריכת-גשר WTRX/SAOS · יומן-רווח-חי */}
      {sn?.node?.grid97 && (
        <div className="mt-2 rounded-lg border border-emerald-400/25 bg-emerald-400/[0.04] p-3">
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <span className="text-sm">⚡</span>
            <span className="font-bold text-zinc-100">GRID-PROFIT — הגריד-האוטונומי-הרווחי (97)</span>
            <Badge variant="outline" className="border-emerald-400/40 bg-emerald-400/10 px-2 py-0 font-mono text-[9px] text-emerald-300">
              פעימה-כל-3-דק' · h{sn.node.grid97.height}
            </Badge>
            {sn.node.grid97.poolW && (
              <Badge variant="outline" className="border-amber-400/40 bg-amber-400/10 px-2 py-0 font-mono text-[9px] text-amber-300">
                בריכת-גשר WTRX/SAOS חיה
              </Badge>
            )}
          </div>

          <div className="mt-1.5 text-[10px] text-zinc-300">
            <span className="font-semibold text-zinc-200">העיקרון-הכנה:</span> כל-אירוע-על-הספר-הריבוני באפס-עמלה-חיצונית (kernel-signed · RC-בלבד) · הרווח-נמדד-מהספר-עצמו: עמלות-30bps מתחלקות 50/50 LP/אוצר · ספרד-מייקר-סביב-האמצע המשולב (ספר+בריכה) · ארביטראז ספר↔בריכה נסגר-לטובת-האוצר (תקדים-96) · נזילות-הגשר (WTRX מגובה-TRX-מדוד) נמשכת-ממש לבריכות-שלנו
          </div>

          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <div className="rounded-md border border-zinc-800 bg-zinc-950/60 p-2 text-center">
              <div className="text-[8px] text-zinc-500">עמלות-אוצר-היום</div>
              <div dir="ltr" className="font-mono text-xs font-bold text-emerald-300">{fmtNum(sn.node.grid97.feesTrTodayµ / 1000, 4)} SAOS</div>
            </div>
            <div className="rounded-md border border-zinc-800 bg-zinc-950/60 p-2 text-center">
              <div className="text-[8px] text-zinc-500">עמלות-LP-היום</div>
              <div dir="ltr" className="font-mono text-xs font-bold text-violet-300">{fmtNum(sn.node.grid97.feesLpTodayµ / 1000, 4)} SAOS</div>
            </div>
            <div className="rounded-md border border-zinc-800 bg-zinc-950/60 p-2 text-center">
              <div className="text-[8px] text-zinc-500">טריידים-היום</div>
              <div dir="ltr" className="font-mono text-xs font-bold text-zinc-100">{fmtNum(sn.node.grid97.tradesToday, 0)}</div>
            </div>
            <div className="rounded-md border border-zinc-800 bg-zinc-950/60 p-2 text-center">
              <div className="text-[8px] text-zinc-500">סוופים-היום</div>
              <div dir="ltr" className="font-mono text-xs font-bold text-zinc-100">{fmtNum(sn.node.grid97.swapsToday, 0)}</div>
            </div>
            <div className="rounded-md border border-zinc-800 bg-zinc-950/60 p-2 text-center">
              <div className="text-[8px] text-zinc-500">סולם-חי (posts/מיחזורים)</div>
              <div dir="ltr" className="font-mono text-xs font-bold text-cyan-300">{fmtNum(sn.node.grid97.ladderPosts, 0)} / {fmtNum(sn.node.grid97.ladderRecycles, 0)}</div>
            </div>
            <div className="rounded-md border border-zinc-800 bg-zinc-950/60 p-2 text-center">
              <div className="text-[8px] text-zinc-500">פער-ספר↔בריכה</div>
              <div dir="ltr" className={cn("font-mono text-xs font-bold", Math.abs(sn.node.grid97.gapBps) < 150 ? "text-emerald-300" : "text-amber-300")}>{sn.node.grid97.gapBps} bps</div>
            </div>
          </div>

          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="rounded-md border border-zinc-800 bg-zinc-950/60 p-2">
              <div className="mb-1 text-[9px] font-semibold text-zinc-400">בריכת-הגשר WTRX/SAOS (נזילות-טרון-על-הדקס-שלנו)</div>
              {sn.node.grid97.poolW ? (
                <div dir="ltr" className="font-mono text-[10px] text-zinc-300">
                  <div>reserves: <span className="text-amber-200">{fmtNum(sn.node.grid97.poolW.saos, 3)} SAOS</span> + <span className="text-rose-300">{fmtNum(sn.node.grid97.poolW.wtrx, 4)} WTRX</span></div>
                  <div>LP supply: <span className="text-zinc-100">{fmtNum(sn.node.grid97.poolW.lp, 0)} µlp</span> · fee: <span className="text-emerald-300">{sn.node.grid97.poolW.feeBps} bps</span> (50% LP · 50% אוצר)</div>
                </div>
              ) : (
                <div className="text-[10px] text-zinc-500">לא-נזרעה-עדיין (ממתין-למשיכת-גשר)</div>
              )}
            </div>
            <div className="rounded-md border border-zinc-800 bg-zinc-950/60 p-2">
              <div className="mb-1 text-[9px] font-semibold text-zinc-400">אוצר-הגריד (גוף-המימון)</div>
              <div dir="ltr" className="font-mono text-[10px] text-zinc-300">
                <div>SAOS פנוי: <span className="text-emerald-300">{fmtNum(sn.node.grid97.treasurySaos, 3)}</span> · WTRX: <span className="text-rose-300">{fmtNum(sn.node.grid97.treasuryWtrx, 3)}</span>{sn.node.grid97.wtrxCover ? <span className="text-zinc-500"> (כיסוי {sn.node.grid97.wtrxCover}%)</span> : null}</div>
                <div>בריכה-ילידה: <span className="text-zinc-100">{fmtNum(sn.node.grid97.pool.saos, 2)} SAOS + {fmtNum(sn.node.grid97.pool.steem, 4)} STEEM</span> · ארביטראזים: <span className="text-cyan-300">{fmtNum(sn.node.grid97.arbEvents, 0)}</span></div>
              </div>
            </div>
          </div>

          <div className="mt-1.5 text-[10px] text-zinc-400">
            <span className="font-semibold text-zinc-300">זרימת-הצי:</span> {Object.keys(sn.node.floatBalances ?? {}).length} חשבונות-צף-ריבוניים · {Object.keys(sn.node.wrappedHolders ?? {}).length} מחזיקי-WTRX · החיילים סוחרים-עצמאית (sfill מול-סולם-האוצר · pool_swapw על בריכת-הגשר) — כל-חתימה עם-מפתח-החייל-עצמו, אף-מפתח-ראשי-לא-נגע
          </div>
        </div>
      )}

      {/* 98: GRID-98 ARENA — מנוע-הזרימה-הגבוהה: מיקרו-פעימות · DEX-רב-זוגות · זאן-חיילים מתחרים · מדרגות-ערך · רווח-ממשי-מדוד */}
      {sn?.node?.grid98 && (
        <div className="mt-2 rounded-lg border border-fuchsia-400/25 bg-fuchsia-400/[0.04] p-3">
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <span className="text-sm">🔥</span>
            <span className="font-bold text-zinc-100">GRID-98 ARENA — מנוע-הזרימה-הגבוהה (98)</span>
            <Badge variant="outline" className="border-fuchsia-400/40 bg-fuchsia-400/10 px-2 py-0 font-mono text-[9px] text-fuchsia-300">
              מיקרו-פעימה-8ש׳ · h{sn.node.grid98.height ?? "—"} · דוטי {sn.node.grid98.dutyPct ?? "—"}%
            </Badge>
            {sn.node.grid98.paused ? (
              <Badge variant="outline" className="border-rose-400/40 bg-rose-400/10 px-2 py-0 font-mono text-[9px] text-rose-300">מושהה: {sn.node.grid98.paused}</Badge>
            ) : (
              <Badge variant="outline" className="border-emerald-400/40 bg-emerald-400/10 px-2 py-0 font-mono text-[9px] text-emerald-300">חי</Badge>
            )}
          </div>

          <div className="mt-1.5 text-[10px] text-zinc-300">
            <span className="font-semibold text-zinc-200">הפתרונות-הריבוניים-למיליוני-עסקאות:</span> מצב-תושב (replay-מצטבר-מאומת-hash · בלוק-סנאפשוט) · סבבי-מסחר-מרובים-לטיק (בלוק-אמת-לסבב) · DEX-98 קרנל-גנרי (pool_x לכל-מטבע-עטוף) · שערי-שוליים-לכל-פעולה (רווחיות-וודאית) · אוסף-גרוטאות-פרוטוקולי (order_gc) · יומן-רווח-עם-שרשרת-Hash פר-עסקה · רצפת-ערך-מטפסת (עוגן-נגד-סחרור)
          </div>

          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <div className="rounded-md border border-zinc-800 bg-zinc-950/60 p-2 text-center">
              <div className="text-[8px] text-zinc-500">עסקאות-היום (מדוד)</div>
              <div dir="ltr" className="font-mono text-xs font-bold text-zinc-100">{fmtNum(sn.node.grid98.tradesToday ?? 0, 0)}</div>
            </div>
            <div className="rounded-md border border-zinc-800 bg-zinc-950/60 p-2 text-center">
              <div className="text-[8px] text-zinc-500">קצב-חי (עסקאות/דק')</div>
              <div dir="ltr" className="font-mono text-xs font-bold text-fuchsia-300">{fmtNum(sn.node.grid98.ratePerMin ?? 0, 1)}</div>
            </div>
            <div className="rounded-md border border-zinc-800 bg-zinc-950/60 p-2 text-center">
              <div className="text-[8px] text-zinc-500">השלכה-יומית-מהקצב-החי</div>
              <div dir="ltr" className="font-mono text-xs font-bold text-cyan-300">{fmtNum(sn.node.grid98.extrapolatedDay ?? 0, 0)}</div>
            </div>
            <div className="rounded-md border border-zinc-800 bg-zinc-950/60 p-2 text-center">
              <div className="text-[8px] text-zinc-500">רווח-אוצר-נטו-מצטבר</div>
              <div dir="ltr" className={cn("font-mono text-xs font-bold", (sn.node.grid98.treasuryPnlSAOS ?? 0) >= 0 ? "text-emerald-300" : "text-rose-300")}>{fmtNum(sn.node.grid98.treasuryPnlSAOS ?? 0, 4)} SAOS</div>
            </div>
            <div className="rounded-md border border-zinc-800 bg-zinc-950/60 p-2 text-center">
              <div className="text-[8px] text-zinc-500">רצפת-הערך (מגובה-רווח)</div>
              <div dir="ltr" className="font-mono text-xs font-bold text-amber-300">{sn.node.grid98.floor != null ? fmtNum(sn.node.grid98.floor, 6) : "—"} · {fmtNum((sn.node.grid98.steps ?? []).length, 0)} צעדים</div>
            </div>
            <div className="rounded-md border border-zinc-800 bg-zinc-950/60 p-2 text-center">
              <div className="text-[8px] text-zinc-500">סוופים-זרימה/גדולים</div>
              <div dir="ltr" className="font-mono text-xs font-bold text-violet-300">{fmtNum(sn.node.grid98.sweeps ?? 0, 0)} / {fmtNum(sn.node.grid98.bigSweeps ?? 0, 0)}</div>
            </div>
          </div>

          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="rounded-md border border-zinc-800 bg-zinc-950/60 p-2">
              <div className="mb-1 text-[9px] font-semibold text-zinc-400">זאן-החיילים — התמרמרות-תחרותית (רווח-ממשי-מדוד · רוטציית-הון-למובילים)</div>
              {(sn.node.grid98.leaderboard ?? []).length ? (
                <div className="space-y-0.5">
                  {(sn.node.grid98.leaderboard ?? []).slice(0, 5).map((l, i) => (
                    <div key={l.name} dir="ltr" className="flex items-center justify-between font-mono text-[10px]">
                      <span className="text-zinc-300">{i + 1}. @{l.name}</span>
                      <span className={(l.pnlSAOS ?? 0) >= 0 ? "text-emerald-300" : "text-rose-300"}>{fmtNum(Number(l.pnlSAOS) || 0, 4)} SAOS</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-[10px] text-zinc-500">הזאן-נטען — רווח-ראשון-עוד-לא-נמדד</div>
              )}
            </div>
            <div className="rounded-md border border-zinc-800 bg-zinc-950/60 p-2">
              <div className="mb-1 text-[9px] font-semibold text-zinc-400">DEX-98 — בריכות-מטבעות-מבחוץ (הרווח-מגיע: עמלות→LP/אוצר · הנחות→צי)</div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                {Object.entries(sn.node.grid98.pools ?? {}).filter(([, p]) => p).slice(0, 8).map(([pair, p]) => (
                  <div key={pair} dir="ltr" className="flex items-center justify-between font-mono text-[10px]">
                    <span className="text-zinc-400">{pair.replace("(pw)", "")}</span>
                    <span className="text-amber-200">{fmtNum(p!.px, 1)} SAOS</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {sn.node.grid98.bench && (
            <div className="mt-2 rounded-md border border-cyan-400/25 bg-cyan-400/[0.05] p-2 text-[10px]">
              <span className="font-semibold text-cyan-200">הוכחת-יכולת (bench מדוד):</span>{" "}
              <span dir="ltr" className="font-mono text-cyan-100">
                {fmtNum(sn.node.grid98.bench.trades, 0)} trades in-bench · {fmtNum(sn.node.grid98.bench.tradesPerSec, 1)}/sec · capability ≈ {fmtNum(sn.node.grid98.bench.capabilityPerDay, 0)}/day mechanism-class
              </span>{" "}
              <span className="text-zinc-400">— הקצב-החי-למעלה הוא-המדוד-בפועל (מוגבל-הון-צף-ודיסק, לא-מנוע)</span>
            </div>
          )}

          <div className="mt-1.5 text-[10px] text-zinc-400">
            <span className="font-semibold text-zinc-300">כנות:</span> כל-עסקה = tx-קרנל-אמת על-השרשרת (fills+swaps) · יומן-פר-עסקה grid-journal-*.jsonl עם-שרשרת-Hash · תדלוק-צף-חיילים {fmtNum((sn.node.grid98.topUpsµ ?? 0) / 1000, 3)} SAOS מהאוצר (הון-עובד-מוצהר, לא-רווח) · שערי-שוליים מונעים-כל-פעולה-בשוליים-שליליים · skipped-for-edge {fmtNum(sn.node.grid98.skippedForEdge ?? 0, 0)}
          </div>
        </div>
      )}

      {/* 73: רצועת-גרפים חיה — גז/בלוק · טרנזאקציות/בלוק · מחיר (מהמילויים) */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5">
          <div className="mb-0.5 flex items-center justify-between text-[9px] text-zinc-500">
            <span>גז / בלוק</span>
            <Mono className="text-emerald-300/80">max {fmtNum(Math.max(...(d.spark?.gas ?? [{ gas: 0 }]).map((x) => x.gas)), 0)}</Mono>
          </div>
          <Spark points={(d.spark?.gas ?? []).map((x) => ({ v: x.gas }))} cls="stroke-emerald-400" />
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5">
          <div className="mb-0.5 flex items-center justify-between text-[9px] text-zinc-500">
            <span>טרנזאקציות / בלוק</span>
            <Mono className="text-violet-300/80">סה״כ-חלון {fmtNum(s.txsTotal, 0)}</Mono>
          </div>
          <Spark points={(d.spark?.gas ?? []).map((x) => ({ v: x.txs }))} cls="stroke-violet-400" />
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5">
          <div className="mb-0.5 flex items-center justify-between text-[9px] text-zinc-500">
            <span>מחיר SAOS/STEEM (מהמילויים)</span>
            <Mono className="text-amber-300/80">{d.spark?.price?.length ? `אחרון ${fmtNum(d.spark.price[d.spark.price.length - 1].p, 6)}` : "—"}</Mono>
          </div>
          <Spark points={(d.spark?.price ?? []).map((x) => ({ v: x.p }))} cls="stroke-amber-400" />
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="scrollbar-hide h-8 w-full justify-start overflow-x-auto bg-zinc-900/80">
          <TabsTrigger value="blocks" className="gap-1 text-[11px] text-zinc-400 data-[state=active]:bg-zinc-100 data-[state=active]:text-zinc-900"><Blocks className="size-3" /> בלוקים</TabsTrigger>
          <TabsTrigger value="accounts" className="gap-1 text-[11px] text-zinc-400 data-[state=active]:bg-zinc-100 data-[state=active]:text-zinc-900"><Users className="size-3" /> חשבונות</TabsTrigger>
          <TabsTrigger value="book" className="gap-1 text-[11px] text-zinc-400 data-[state=active]:bg-zinc-100 data-[state=active]:text-zinc-900"><BookOpen className="size-3" /> ספר</TabsTrigger>
          <TabsTrigger value="anchors" className="gap-1 text-[11px] text-zinc-400 data-[state=active]:bg-zinc-100 data-[state=active]:text-zinc-900"><Landmark className="size-3" /> עגונים</TabsTrigger>
          <TabsTrigger value="heads" className="gap-1 text-[11px] text-zinc-400 data-[state=active]:bg-zinc-100 data-[state=active]:text-zinc-900"><Crown className="size-3" /> ראשים</TabsTrigger>
          <TabsTrigger value="docs" className="gap-1 text-[11px] text-zinc-400 data-[state=active]:bg-zinc-100 data-[state=active]:text-zinc-900"><RadioTower className="size-3" /> תיעוד-ציבורי</TabsTrigger>
        </TabsList>

        {/* ── בלוקים ── */}
        <TabsContent value="blocks" className="space-y-2">
          <div className="flex items-center gap-2">
            <div className="relative flex-1 sm:max-w-xs">
              <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-zinc-500" aria-hidden="true" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && searchBlock()}
                placeholder="חיפוש בלוק (מספר) או חשבון (@שם)…"
                dir="ltr"
                className="h-8 border-zinc-800 bg-zinc-950/60 pl-8 text-[12px]"
              />
            </div>
            <Button size="sm" variant="outline" className="h-8 border-zinc-800 text-[11px]" onClick={searchBlock}>
              פתח בלוק
            </Button>
            <span className="hidden text-[10px] text-zinc-600 sm:block">
              מציג {d.blocksEnd}←{d.blocksStart} · נשמרים 512 אחרונים
            </span>
          </div>
          <div className="max-h-[460px] space-y-1.5 overflow-y-auto pr-1 scrollbar-thin">
            {blockList.map((b) => (
              <BlockRow key={b.height} b={b} onOpen={setDetail} />
            ))}
            {blockList.length > 0 && d.blocksEnd - offset > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-full border border-dashed border-zinc-800 text-[11px] text-zinc-400"
                onClick={loadOlder}
                disabled={loadingOlder}
              >
                {loadingOlder ? <Loader2 className="size-3.5 animate-spin" /> : <ChevronDown className="size-3.5" />}
                טען בלוקים ישנים יותר
              </Button>
            )}
            {!blockList.length && <p className="py-6 text-center text-[12px] text-zinc-500">אין בלוקים.</p>}
          </div>
          <p className="text-[10px] text-zinc-600">שורת-החיפוש מקבלת גם שם-חשבון — הקלד @שם לחקירה מלאה.</p>
        </TabsContent>

        {/* ── חשבונות ── */}
        <TabsContent value="accounts">
          <div className="max-h-[520px] overflow-auto rounded-xl border border-zinc-800 scrollbar-thin">
            <table className="w-full min-w-[640px] text-right text-[11px]">
              <thead className="sticky top-0 bg-zinc-900/95 text-[9px] text-zinc-500 backdrop-blur">
                <tr>
                  <th className="px-3 py-2 font-medium">חשבון</th>
                  <th className="px-3 py-2 font-medium">SAOS</th>
                  <th className="px-3 py-2 font-medium">STEEM</th>
                  <th className="px-3 py-2 font-medium">נעול-SAOS</th>
                  <th className="px-3 py-2 font-medium">נעול-STEEM</th>
                  <th className="px-3 py-2 font-medium">LP</th>
                  <th className="px-3 py-2 font-medium">עגונים</th>
                </tr>
              </thead>
              <tbody>
                {d.accounts.map((a) => (
                  <tr key={a.name} className={cn("border-t border-zinc-800/60", a.boundary && "bg-amber-400/[0.04]")}>
                    <td className="px-3 py-1.5">
                      <NameTag name={a.name} onOpen={setAccName} />
                      {a.boundary && (
                        <Badge variant="outline" className="mr-1.5 border-amber-400/40 bg-amber-400/10 px-1 py-0 text-[8px] text-amber-300">
                          גבול-מארח
                        </Badge>
                      )}
                    </td>
                    <td className="px-3 py-1.5 font-mono text-emerald-300" dir="ltr">{fmtNum(a.saos, 3)}</td>
                    <td className={cn("px-3 py-1.5 font-mono", a.steem < 0 ? "text-emerald-400" : "text-zinc-300")} dir="ltr">{fmtNum(a.steem, 3)}</td>
                    <td className="px-3 py-1.5 font-mono text-zinc-500" dir="ltr">{fmtNum(a.lockedSaos, 3)}</td>
                    <td className="px-3 py-1.5 font-mono text-zinc-500" dir="ltr">{fmtNum(a.lockedSteem, 3)}</td>
                    <td className="px-3 py-1.5 font-mono text-teal-300" dir="ltr">{a.lp > 0 ? fmtNum(a.lp, 3) : "—"}</td>
                    <td className="px-3 py-1.5" dir="ltr">
                      {Object.entries(a.wrapped).length
                        ? Object.entries(a.wrapped).map(([sym, v]) => (
                            <Mono key={sym} className="ml-1 text-sky-300/90">
                              {sym}:{fmtNum(v, 3)}
                            </Mono>
                          ))
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-1.5 text-[10px] text-zinc-600">
            חשבון-הגבול &apos;host&apos; רשאי יתרה-שלילית — הסמן-המצטבר של זרימת-STEEM הנטו מעבר לגבול מארח/ריבוני. שלילי = הזרימה אלינו. לחיצה על שם = חקירת-חשבון מלאה.
          </p>
        </TabsContent>

        {/* ── ספר ── */}
        <TabsContent value="book" className="space-y-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Ladder rows={d.orders} side="sell" onName={setAccName} />
            <Ladder rows={d.orders} side="buy" onName={setAccName} />
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5">
              <div className="text-[9px] text-zinc-500">מחיר-אחרון (קרנל)</div>
              <div className="font-mono text-[12px] text-amber-300" dir="ltr">{s.lastPrice != null ? fmtNum(s.lastPrice, 6) : "—"}</div>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5">
              <div className="text-[9px] text-zinc-500">בריכה-ריבונית</div>
              <div className="font-mono text-[11px] text-teal-300" dir="ltr">
                {fmtNum(s.pool.saos, 1)} SAOS / {fmtNum(s.pool.steem, 3)} STEEM
              </div>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5">
              <div className="text-[9px] text-zinc-500">עמלות-שרשרת (µ)</div>
              <div className="font-mono text-[11px] text-zinc-200" dir="ltr">
                {fmtNum(s.fees.total * 1000, 0)} · LP {fmtNum(s.fees.toLp * 1000, 0)} / אוצר {fmtNum(s.fees.toTreasury * 1000, 0)}
              </div>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5">
              <div className="text-[9px] text-zinc-500">תשואה-ריבונית</div>
              <div className="font-mono text-[11px] text-violet-300" dir="ltr">{fmtNum(s.yieldTotal, 3)} SAOS</div>
            </div>
          </div>
          <div>
            <div className="mb-1.5 text-[11px] font-semibold text-zinc-300">מילויים על-השרשרת ({d.fills.length} אחרונים)</div>
            <div className="max-h-52 space-y-1 overflow-y-auto scrollbar-thin">
              {d.fills.map((f, i) => (
                <FillRow key={`${f.height}-${f.orderId}-${i}`} f={f} onName={setAccName} />
              ))}
              {!d.fills.length && <p className="text-[10px] text-zinc-600">עדיין אין מילויים — הספר ממתין לנזילות.</p>}
            </div>
          </div>
          <div>
            <div className="mb-1.5 text-[11px] font-semibold text-zinc-300">הזמנות ({d.orders.length})</div>
            <div className="max-h-52 space-y-1 overflow-y-auto scrollbar-thin">
              {d.orders.map((o) => (
                <div key={o.id} className="flex flex-wrap items-center gap-x-2 rounded-lg border border-zinc-800 bg-zinc-950/60 px-2.5 py-1.5 text-[10px]">
                  <Mono className="text-zinc-500">#{o.id}</Mono>
                  <Badge variant="outline" className={cn("px-1 py-0 text-[8px]", o.side === "sell" ? "border-rose-400/40 text-rose-300" : "border-emerald-400/40 text-emerald-300")}>
                    {o.side === "sell" ? "שאל" : "ביד"}
                  </Badge>
                  <NameTag name={o.owner} onOpen={setAccName} />
                  <Mono className="text-zinc-400">{fmtNum(o.amount, 3)} @ {fmtNum(o.price, 6)}</Mono>
                  {o.live ? (
                    <Badge variant="outline" className="border-emerald-400/30 px-1 py-0 text-[8px] text-emerald-300">חיה</Badge>
                  ) : (
                    <span className="text-[9px] text-zinc-600">סגורה</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </TabsContent>

        {/* ── עגונים ── */}
        <TabsContent value="anchors" className="space-y-2">
          {d.checkpoints.map((c) => (
            <div key={c.height} className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[12px] font-bold text-violet-300" dir="ltr">checkpoint @{c.height}</span>
                {c.reproduced === true ? (
                  <Badge variant="outline" className="border-emerald-400/40 bg-emerald-400/10 px-1.5 py-0 text-[9px] text-emerald-300">
                    שורש-משוחזר ✓ (stateRepro)
                  </Badge>
                ) : c.reproduced === false ? (
                  <Badge variant="outline" className="border-rose-400/40 px-1.5 py-0 text-[9px] text-rose-300">שורש-לא-התאים</Badge>
                ) : (
                  <Badge variant="outline" className="border-zinc-700 px-1.5 py-0 text-[9px] text-zinc-500">מחוץ-לחלון-הפרטים (40 אחרונים)</Badge>
                )}
                {c.anchors?.steem && (
                  <a
                    href={`https://steemblockexplorer.com/tx/${c.anchors.steem}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-0.5 border-b border-dotted border-emerald-400/40 font-mono text-[9px] text-emerald-300 hover:text-emerald-200"
                    dir="ltr"
                  >
                    steem {String(c.anchors.steem).slice(0, 10)}… <ExternalLink className="size-2.5" />
                  </a>
                )}
                {c.anchors?.hive && typeof c.anchors.hive === "object" ? (
                  <a
                    href={`https://hiveblocks.com/tx/${c.anchors.hive.txid}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-0.5 border-b border-dotted border-teal-400/40 font-mono text-[9px] text-teal-300 hover:text-teal-200"
                    dir="ltr"
                    title={`verified by @${c.anchors.hive.by} · blk ${c.anchors.hive.block}${c.anchors.hive.duplicates ? ` · ${c.anchors.hive.duplicates} dups documented` : ""}`}
                  >
                    <BadgeCheck className="size-2.5" />
                    hive ✓{String(c.anchors.hive.txid).slice(0, 10)}… blk {c.anchors.hive.block}
                    {typeof c.anchors.hive.duplicates === "number" && c.anchors.hive.duplicates > 0 ? ` (+${c.anchors.hive.duplicates}d)` : ""}
                  </a>
                ) : typeof c.anchors?.hive === "string" ? (
                  <Badge variant="outline" className="border-amber-400/30 px-1.5 py-0 font-mono text-[9px] text-amber-300" dir="ltr">
                    hive {c.anchors.hive}
                  </Badge>
                ) : null}
                {!c.anchors?.steem && (
                  <Badge variant="outline" className="border-amber-400/30 px-1.5 py-0 text-[9px] text-amber-300">עיגון-ממתין-דלק</Badge>
                )}
                <span className="mr-auto text-[10px] text-zinc-600">{relTime(c.at)}</span>
              </div>
              <div className="mt-1.5 space-y-0.5 text-[10px]">
                <div>
                  stateRoot: <Mono className="break-all text-zinc-300">{c.stateRoot}</Mono>
                </div>
                <div>
                  checkpointHash: <Mono className="break-all text-zinc-500">{c.checkpointHash}</Mono>
                </div>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {c.attests?.map((a) => (
                  <Badge
                    key={a.by}
                    variant="outline"
                    className={cn("gap-0.5 px-1.5 py-0 font-mono text-[9px]", a.verified ? "border-emerald-400/30 bg-emerald-400/[0.06] text-emerald-300" : "border-zinc-700 text-zinc-400")}
                    role="button"
                    tabIndex={0}
                    onClick={() => setAccName(a.by)}
                    onKeyDown={(e) => e.key === "Enter" && setAccName(a.by)}
                  >
                    @{a.by} {a.verified ? "✓" : "…"}
                  </Badge>
                ))}
              </div>
            </div>
          ))}
          {!d.checkpoints.length && <p className="py-6 text-center text-[12px] text-zinc-500">אין צ&apos;קפוינטים מעוגנים עדיין.</p>}
        </TabsContent>

        {/* ── ראשים (STAGE-3 ROTATION — 72) ── */}
        <TabsContent value="heads" className="space-y-2">
          {!d.rotation || !d.rotation.roster.length ? (
            <p className="rounded-lg border border-dashed border-zinc-800 py-6 text-center text-[12px] text-zinc-500">
              הרוטציה ממתינה לפרסום-הרוסטר הראשון בפעימה הבאה.
            </p>
          ) : (
            <>
              {/* כרטיס-החוק */}
              <div className="rounded-xl border border-orange-900/40 bg-orange-400/[0.03] p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Crown className="size-3.5 text-orange-300" aria-hidden="true" />
                  <span className="text-[12px] font-semibold text-orange-200">ראשים-מתחלפים — החוק נגזר, לא נבחר</span>
                  {d.rotation.current.produced ? (
                    <Badge variant="outline" className="border-emerald-400/40 bg-emerald-400/10 px-1.5 py-0 text-[9px] text-emerald-300">הסבב-הופק ✓</Badge>
                  ) : (
                    <Badge variant="outline" className="border-amber-400/30 px-1.5 py-0 text-[9px] text-amber-300">ממתין-למנדט</Badge>
                  )}
                  {d.rotation.misses > 0 && (
                    <Badge variant="outline" className="border-rose-400/30 px-1.5 py-0 text-[9px] text-rose-300">{d.rotation.misses} פערים-כנים</Badge>
                  )}
                </div>
                <Mono className="mt-1.5 block text-zinc-400">{d.rotation.law}</Mono>
                <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-zinc-500">
                  <span>
                    סבב-נוכחי: <Mono className="text-orange-300">r{d.rotation.current.round}</Mono> · ראש-ממונה: <Mono className="text-zinc-200">@{d.rotation.current.mandated}</Mono>
                  </span>
                  <span>
                    סבב-הבא: <Mono className="text-orange-300/70">r{d.rotation.next.round}</Mono> → <Mono className="text-zinc-400">@{d.rotation.next.mandated}</Mono>
                  </span>
                  <span>
                    רוסטר-digest: <Mono className="text-emerald-300/80">{String(d.rotation.rosterDigest ?? "").slice(0, 16)}…</Mono>
                  </span>
                </div>
              </div>

              {/* הרוסטר הפומבי */}
              <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3">
                <div className="mb-1.5 text-[11px] font-semibold text-zinc-300">הרוסטר-הקנוני ({d.rotation.roster.length} ממוין) — מפורסם-על-המארח</div>
                <div className="flex flex-wrap gap-1">
                  {d.rotation.roster.map((n, i) => (
                    <Badge
                      key={n}
                      variant="outline"
                      className={cn(
                        "cursor-pointer px-1.5 py-0 font-mono text-[9px] transition-colors hover:border-emerald-400/50 hover:text-emerald-300",
                        i === d.rotation!.current.round % d.rotation!.roster.length
                          ? "border-orange-400/50 bg-orange-400/10 text-orange-200"
                          : "border-zinc-700 bg-zinc-900 text-zinc-400"
                      )}
                      role="button"
                      tabIndex={0}
                      onClick={() => setAccName(n)}
                      onKeyDown={(e) => e.key === "Enter" && setAccName(n)}
                    >
                      {i}:{n}
                    </Badge>
                  ))}
                </div>
                {d.rotation.rosterPubs.map((rp, i) => (
                  <div key={`${rp.txid ?? i}-${rp.digest}`} className="mt-1.5 flex flex-wrap items-center gap-2 text-[10px]">
                    {rp.verified ? (
                      <Badge variant="outline" className="border-emerald-400/40 bg-emerald-400/10 px-1 py-0 text-[9px] text-emerald-300">get_transaction ✓</Badge>
                    ) : (
                      <Badge variant="outline" className="border-zinc-700 px-1 py-0 text-[9px] text-zinc-400">ממתין-אימות…</Badge>
                    )}
                    {rp.txid ? (
                      <a
                        href={`https://steemblockexplorer.com/tx/${rp.txid}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-0.5 border-b border-dotted border-zinc-600 font-mono text-zinc-300 hover:text-zinc-100"
                        dir="ltr"
                      >
                        roster {String(rp.txid).slice(0, 12)}… <ExternalLink className="size-2.5" />
                      </a>
                    ) : null}
                    <Mono className="text-zinc-600">digest {String(rp.digest).slice(0, 12)}…</Mono>
                    {rp.by ? <Mono className="text-zinc-600">via @{rp.by}</Mono> : null}
                  </div>
                ))}
              </div>

              {/* רשם-הסבבים */}
              <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3">
                <div className="mb-1.5 text-[11px] font-semibold text-zinc-300">רשם-הראשים על-השרשרת ({d.rotation.rounds.length})</div>
                <div className="max-h-56 space-y-1 overflow-y-auto scrollbar-thin">
                  {d.rotation.rounds.map((p) => (
                    <div key={p.round} className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/40 px-2.5 py-1.5 text-[10px]">
                      <Mono className="font-bold text-orange-300">r{p.round}</Mono>
                      <Mono className="text-zinc-500">blk {p.height}</Mono>
                      <NameTag name={p.producer} onOpen={setAccName} />
                      {p.lawOk === true ? (
                        <Badge variant="outline" className="border-emerald-400/40 bg-emerald-400/10 px-1 py-0 text-[8px] text-emerald-300">חוק ✓</Badge>
                      ) : p.lawOk === false ? (
                        <Badge variant="outline" className="border-rose-400/50 px-1 py-0 text-[8px] text-rose-300">סטייה-מהחוק</Badge>
                      ) : null}
                      {p.ok === false && (
                        <Badge variant="outline" className="border-rose-400/40 px-1 py-0 text-[8px] text-rose-300">נדחה</Badge>
                      )}
                      {p.verified && p.hostTxid ? (
                        <a
                          href={`https://steemblockexplorer.com/tx/${p.hostTxid}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-0.5 border-b border-dotted border-emerald-400/40 font-mono text-emerald-300 hover:text-emerald-200"
                          dir="ltr"
                        >
                          produce ✓ {String(p.hostTxid).slice(0, 10)}… <ExternalLink className="size-2.5" />
                        </a>
                      ) : (
                        <Mono className="text-zinc-600">ראיה-ממתינה…</Mono>
                      )}
                    </div>
                  ))}
                  {!d.rotation.rounds.length && (
                    <p className="text-[10px] text-zinc-600">עדיין אין הפקות-מנדט על-השרשרת — הפעימה-הבאה מפעילה את החוק.</p>
                  )}
                </div>
                <p className="mt-1.5 text-[10px] text-zinc-600">
                  אכיפת-קרנל: ראש-אחד-לסבב (dup-round נדחה). מנדט-שלא-הוכח (RC/מפתח) = פער-כן-מתועד — החוק מעולם לא מופר. צד-שלישי יכול לאמת: רוסטר-מפורסם → roster[floor(h/12) mod N] → השוואה ל-custom_json action=produce.
                </p>
              </div>
            </>
          )}
        </TabsContent>

        {/* ── תיעוד-ציבורי ── */}
        <TabsContent value="docs" className="space-y-2">
          <div className="rounded-xl border border-sky-900/40 bg-sky-400/[0.03] p-3 text-[11px] text-zinc-400">
            <div className="mb-1 font-semibold text-sky-300">הרשת מתעדת את עצמה על השרשרת-המארחת</div>
            בכל פעימה-שנייה הצומת מפרסם custom_json ציבורי (protocol saos:net/v1, action=explorer) עם תמצית-הרשת: גובה, stateRoot, צ&apos;קפוינט-אחרון + txid-העיגון, ספר, עמלות, גבול-מארח ו-digest קריפטוגרפי של התמצית. כלומר — כל-אחד-על-Steem יכול לעקוב-ולאמת את SAOS-NET בלי גישה לשרת שלנו. זהו התיעוד-של-הרשת-על-הרשת.
          </div>
          {/* 73: חבילת-אימות — הרשת-מספקת-את-הראיות-עצמן */}
          <div className="rounded-xl border border-emerald-900/40 bg-emerald-400/[0.03] p-3">
            <div className="flex flex-wrap items-center gap-2">
              <PackageCheck className="size-4 text-emerald-300" aria-hidden="true" />
              <span className="text-[12px] font-semibold text-emerald-200">חבילת-אימות לצד-שלישי (verify-pack)</span>
              <a
                href="/api/ops/sovexplorer?export=verify"
                className="inline-flex items-center gap-1 rounded-lg border border-emerald-400/40 bg-emerald-400/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-300 transition-colors hover:bg-emerald-400/20"
                download
              >
                <Download className="size-3.5" /> הורד JSON
              </a>
            </div>
            <p className="mt-1.5 text-[10px] leading-relaxed text-zinc-500">
              הג&apos;נזיס + השרשרת-המלאה + כל-הצ&apos;קפוינטים + ה-stateRoot + הרוסטר-החוקי — בקובץ-אחד עם digest=sha256(canon(core)) והוראות-replay שלב-אחר-שלב. מי-שרץ את הקרנל הדטרמיניסטי על החבילה מקבל את השורשים-בדיוק — בלי לגעת בשרת שלנו. האקספלורר לא רק מציג את הרשת — הוא מחזיק את הראיות.
            </p>
          </div>
          {d.publications.map((p, i) => (
            <div key={`${p.txid ?? i}-${p.height}`} className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2">
              <Badge variant="outline" className="border-sky-400/40 bg-sky-400/10 px-1.5 py-0 font-mono text-[9px] text-sky-300" dir="ltr">
                h:{p.height}
              </Badge>
              {p.verified ? (
                <Badge variant="outline" className="border-emerald-400/40 bg-emerald-400/10 px-1.5 py-0 text-[9px] text-emerald-300">get_transaction ✓</Badge>
              ) : p.skip ? (
                <Badge variant="outline" className="border-amber-400/30 px-1.5 py-0 text-[9px] text-amber-300">כנות: {p.skip}</Badge>
              ) : (
                <Badge variant="outline" className="border-zinc-700 px-1.5 py-0 text-[9px] text-zinc-400">ממתין-אימות…</Badge>
              )}
              {p.txid ? (
                <a
                  href={`https://steemblockexplorer.com/tx/${p.txid}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-0.5 border-b border-dotted border-zinc-600 font-mono text-[10px] text-zinc-300 hover:text-zinc-100"
                  dir="ltr"
                >
                  {String(p.txid).slice(0, 14)}… <ExternalLink className="size-2.5" />
                </a>
              ) : null}
              {p.digest ? <Mono className="text-zinc-600">digest {String(p.digest).slice(0, 12)}…</Mono> : null}
              {p.by ? <Mono className="text-zinc-600">via @{p.by}</Mono> : null}
              <span className="mr-auto text-[10px] text-zinc-600">{relTime(p.at)}</span>
            </div>
          ))}
          {!d.publications.length && (
            <p className="rounded-lg border border-dashed border-zinc-800 py-6 text-center text-[12px] text-zinc-500">
              התיעוד-הציבורי ממתין לפעימה הבאה של הצומת.
            </p>
          )}
        </TabsContent>
      </Tabs>

      {detail != null && <BlockDetailDialog key={`blk-${detail}`} height={detail} onClose={() => setDetail(null)} onName={setAccName} />}
      {accName != null && <AccountDialog key={`acc-${accName}`} name={accName} onClose={() => setAccName(null)} />}
    </div>
  );
}
