"use client";

// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · טאב 8 - שוק האמת (השוק החכם של הרשת)
//
// הסחורה: הכרעה עתידית של טענות מדידות. השופט: המדידה - של
// הרשת עצמה (PlanStage שנסגר · Checkpoint שנוצר · מספר אימותי
// ANCHOR · עוגני ZERO בספר · סטטוס אימות) או של שרשרת ציבורית
// חיצונית חיה (גובה בלוק ZERO 9369 - השופט החיצוני, בקריאה
// חסרת-מפתחות ב-$0).
// לא הצבעה, לא דעה, לא כסף - נקודות אמת (מוניטין מוצהר).
// הסליקה נכנסת לספר => checkpoint => עיגון ב-$0.
//
// כל אירוע בספר השוק חתום EIP-191: STAKE בחתימת הסוכן שמהמר,
// OPEN בחתימת הפותח, SETTLE/REFUND בחתימת מפתח הרשת.
// ─────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Coins,
  ExternalLink,
  Gavel,
  Globe,
  Link2,
  Plus,
  RefreshCw,
  Scale,
  TrendingUp,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ErrorBox,
  FadeIn,
  HashChip,
  ListSkeleton,
  MotionCard,
  scrollBoxClass,
  Section,
  StatusBadge,
  fmtDateTime,
  truncateMiddle,
} from "../shared";
import { cn } from "@/lib/utils";

// ── DTO (משוקף מה-route) ────────────────────────────────────────────

type Side = "YES" | "NO";

interface StakeView {
  seq: number;
  agentId: string;
  agentName: string;
  agentAddress: string;
  side: Side;
  points: number;
  nonce: number;
  at: string;
}

interface ListingView {
  marketSeq: number;
  title: string;
  target: Record<string, unknown>;
  targetLabel: string;
  byDate: string;
  createdBy: string;
  createdAt: string;
  status: "OPEN" | "SETTLED" | "REFUNDED";
  sequence?: { depth: number };
  successorOf?: number;
  stakes: StakeView[];
  potYes: number;
  potNo: number;
  totalPot: number;
  stakerCount: number;
  outcome?: Side;
  resolution?: string;
  winners?: Array<{ agentId: string; agentName: string; points: number; payout: number }>;
  losers?: Array<{ agentId: string; agentName: string; points: number; lost: number }>;
  settledAt?: string;
  refundReason?: string;
}

interface AgentCapitalView {
  agentId: string;
  agentName: string;
  agentAddress: string;
  starting: number;
  staked: number;
  winnings: number;
  losses: number;
  available: number;
}

interface ResolvableView {
  marketSeq: number;
  title: string;
  measured: { resolved: boolean; outcome?: Side; evidence: string };
  expired: boolean;
  action: "SETTLE" | "REFUND" | "HOLD";
}

interface ZeroJudgeView {
  reachable: boolean;
  chainId?: number;
  height?: number;
  measuredAt?: string;
  endpoint?: string;
  blockSeconds?: number;
  error?: string;
}

interface MarketDTO {
  doctrine: string;
  startingPoints: number;
  book: {
    events: number;
    headHash: string;
    chainValid: boolean;
    firstBreak: number | null;
    sigOk: number;
    verdict: string;
  };
  listings: ListingView[];
  agents: AgentCapitalView[];
  resolvable: ResolvableView[];
  openContext: {
    planStages: Array<{ code: string; title: string; state: string }>;
    checkpointMax: number;
    anchorCount: number;
    zeroAnchorCount: number;
    attestationCount: number;
    zeroJudge: ZeroJudgeView | null;
  };
}

interface AgentLite {
  id: string;
  name: string;
  role: string;
  status: string;
  /** R117 — כנות-יכולת: IDENTITY-ONLY = זהות שוחזרה מהספר בלי מפתח-חתימה בסביבה */
  capability?: "SEALED-SIGNER" | "IDENTITY-ONLY";
}

// ── הטאב ─────────────────────────────────────────────────────────────

export function MarketTab() {
  const [data, setData] = useState<MarketDTO | null>(null);
  const [agents, setAgents] = useState<AgentLite[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [settleBusy, setSettleBusy] = useState(false);
  const [openNew, setOpenNew] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [marketRes, agentsRes] = await Promise.all([
        fetch("/api/weave/market", { cache: "no-store" }),
        fetch("/api/agents", { cache: "no-store" }),
      ]);
      const marketJson = await marketRes.json();
      if (!marketJson.ok) throw new Error(marketJson.error ?? "טעינת השוק נכשלה");
      setData(marketJson.market as MarketDTO);
      const agentsJson = await agentsRes.json();
      if (agentsJson.ok && Array.isArray(agentsJson.agents)) {
        setAgents(
          (agentsJson.agents as AgentLite[]).filter((a) => a.status === "ACTIVE")
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "טעינת השוק נכשלה");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const runResolver = useCallback(async () => {
    setSettleBusy(true);
    try {
      const res = await fetch("/api/weave/market/settle", { method: "POST" });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? "ההכרעה נכשלה");
      const r = json.resolution;
      const settled = (r.settled ?? []).length;
      const refunded = (r.refunded ?? []).length;
      if (settled + refunded === 0) {
        toast.info("המכריע רץ - אין שווקים להכרעה כרגע; המדידה קובעת");
      } else {
        toast.success(
          `הוכרעו ${settled} · הוחזרו ${refunded} · אימותי MARKET ${(r.attSeqs ?? []).join(", ")} · cp#${r.checkpoint?.index ?? "-"} נוצר`
        );
      }
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "ההכרעה נכשלה");
    } finally {
      setSettleBusy(false);
    }
  }, [load]);

  const openListings = useMemo(
    () => (data?.listings ?? []).filter((l) => l.status === "OPEN"),
    [data]
  );
  const closedListings = useMemo(
    () => (data?.listings ?? []).filter((l) => l.status !== "OPEN"),
    [data]
  );
  const actionable = useMemo(
    () => (data?.resolvable ?? []).filter((r) => r.action !== "HOLD"),
    [data]
  );

  return (
    <FadeIn className="flex flex-col gap-4 sm:gap-6">
      {/* ── כותרת ── */}
      <section className="flex flex-wrap items-center gap-3">
        <span className="flex size-9 items-center justify-center rounded-lg border bg-muted/60 text-muted-foreground">
          <Scale className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold tracking-tight sm:text-lg">
            שוק האמת
          </h2>
          <p className="text-xs text-muted-foreground sm:text-sm">
            שוק חכם על טענות מדידות - השופט הוא המדידה: של הרשת עצמה, או של שרשרת ציבורית חיצונית חיה (ZERO 9369) - לא הצבעה ולא דעה
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setOpenNew(true)}>
            <Plus className="size-4" />
            שוק חדש
          </Button>
          <Button
            size="sm"
            variant={actionable.length > 0 ? "default" : "outline"}
            onClick={runResolver}
            disabled={settleBusy}
          >
            <Gavel className="size-4" />
            {settleBusy ? "מכריע…" : "הרץ מכריע"}
            {actionable.length > 0 && ` (${actionable.length})`}
          </Button>
          <Button variant="ghost" size="sm" onClick={load} disabled={busy}>
            <RefreshCw className={cn("size-4", busy && "animate-spin")} />
          </Button>
        </div>
      </section>

      {error && <ErrorBox message={error} />}

      {!data && !error && (
        <div className="flex flex-col gap-4">
          <ListSkeleton rows={3} />
        </div>
      )}

      {data && (
        <>
          {/* ── הדוקטרינה + ספר השוק ── */}
          <Section
            title="החוקה של השוק"
            icon={<Scale />}
            description="הסחורה: הכרעה עתידית של טענות מדידות · ההון: נקודות אמת (מוניטין מוצהר, אפס כסף) · הסליקה נכנסת לספר => checkpoint => עיגון ב-$0"
          >
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <MotionCard className="p-4 sm:p-6">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={data.book.chainValid ? "VERIFIED" : "REFUTED"} />
                  <span className="text-sm font-semibold">ספר השוק</span>
                  <span className="ms-auto font-mono text-xs text-muted-foreground" dir="ltr">
                    {data.book.events} events · {data.book.sigOk}/{data.book.events} sigs
                  </span>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{data.book.verdict}</p>
                <div className="mt-3">
                  <HashChip value={data.book.headHash} label="head" />
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  כל צומת יכול לחשב מחדש - ומטרות גובה-בלוק ZERO נמדדות מהשרשרת
                  הציבורית עצמה, בקריאה חסרת-מפתחות. השוק לא ממציא תוצאות:
                  כשל מדידה משאיר ללא הכרעה (fail-closed).
                </p>
                {data.openContext.zeroJudge?.reachable && (
                  <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2">
                    <Globe className="size-3.5 text-muted-foreground" />
                    <span className="text-xs font-medium">השופט החיצוני חי</span>
                    <span className="font-mono text-xs text-muted-foreground" dir="ltr">
                      ZERO {data.openContext.zeroJudge.chainId} · block {data.openContext.zeroJudge.height?.toLocaleString("en-US")}
                    </span>
                    <span className="ms-auto text-[10px] text-muted-foreground">
                      נמדד {fmtDateTime(data.openContext.zeroJudge.measuredAt ?? "")}
                    </span>
                  </div>
                )}
              </MotionCard>

              <MotionCard className="p-4 sm:p-6">
                <div className="flex items-center gap-2">
                  <Coins className="size-4 text-muted-foreground" />
                  <span className="text-sm font-semibold">לוח ההון - נקודות אמת</span>
                  <span className="ms-auto font-mono text-xs text-muted-foreground" dir="ltr">
                    start {data.startingPoints}
                  </span>
                </div>
                <div className={cn("mt-3 max-h-56 overflow-y-auto", scrollBoxClass)}>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>סוכן</TableHead>
                        <TableHead className="text-right">זמין</TableHead>
                        <TableHead className="text-right">נעול</TableHead>
                        <TableHead className="text-right">רווחים</TableHead>
                        <TableHead className="text-right">הפסדים</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.agents.map((a) => (
                        <TableRow key={a.agentId}>
                          <TableCell className="font-medium">{a.agentName}</TableCell>
                          <TableCell className="text-right font-mono">{a.available}</TableCell>
                          <TableCell className="text-right font-mono text-muted-foreground">
                            {a.staked}
                          </TableCell>
                          <TableCell className="text-right font-mono text-emerald-600 dark:text-emerald-400">
                            {a.winnings}
                          </TableCell>
                          <TableCell className="text-right font-mono text-red-600 dark:text-red-400">
                            {a.losses}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  הון פתיחה מוצהר לכל סוכן - מוניטין, לא כסף; השוק לא מלווה ולא מנפיש.
                </p>
              </MotionCard>
            </div>
          </Section>

          {/* ── מועמדי ההכרעה ── */}
          {actionable.length > 0 && (
            <MotionCard className="border-emerald-500/30 p-4 sm:p-6">
              <div className="flex flex-wrap items-center gap-2">
                <Gavel className="size-4 text-emerald-600 dark:text-emerald-400" />
                <span className="text-sm font-semibold">
                  {actionable.length} שווקים מוכנים להכרעה - המדידה כבר קיימת
                </span>
                <Button size="sm" className="ms-auto" onClick={runResolver} disabled={settleBusy}>
                  {settleBusy ? "מכריע…" : "הכרע עכשיו"}
                </Button>
              </div>
              <ul className="mt-3 flex flex-col gap-2">
                {actionable.map((r) => (
                  <li key={r.marketSeq} className="text-sm">
                    <span className="font-mono text-xs text-muted-foreground" dir="ltr">
                      m#{r.marketSeq}
                    </span>{" "}
                    {r.title}
                    <span
                      className={cn(
                        "ms-2 rounded-md border px-1.5 py-0.5 font-mono text-[10px]",
                        r.action === "SETTLE"
                          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                          : "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                      )}
                      dir="ltr"
                    >
                      {r.action === "SETTLE" ? `-> ${r.measured.outcome}` : "-> REFUND"}
                    </span>
                    <p className="mt-0.5 font-mono text-[11px] text-muted-foreground" dir="auto">
                      {r.measured.evidence}
                    </p>
                  </li>
                ))}
              </ul>
            </MotionCard>
          )}

          {/* ── שווקים פתוחים ── */}
          <Section
            title={`שווקים פתוחים (${openListings.length})`}
            icon={<TrendingUp />}
            description="כל שוק - טענה מדידה עם תאריך תפוגה; פג תוקף ללא הכרעה => החזר מלא (כנות מבנית)"
          >
            {openListings.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                אין שווקים פתוחים - פתח שוק על טענה מדידה הבאה של הרשת.
              </p>
            ) : (
              <div className="flex flex-col gap-4">
                {openListings.map((l) => (
                  <OpenMarketCard
                    key={l.marketSeq}
                    listing={l}
                    agents={data.agents}
                    zeroJudge={data.openContext.zeroJudge}
                    zeroAnchorCount={data.openContext.zeroAnchorCount ?? null}
                    onStaked={load}
                  />
                ))}
              </div>
            )}
          </Section>

          {/* ── היסטוריית סליקות ── */}
          {closedListings.length > 0 && (
            <Section
              title={`היסטוריית סליקות (${closedListings.length})`}
              icon={<Gavel />}
              description="כל סליקה - אימות MARKET חתום בספר הראשי; ה-checkpoint מכסה; העוגנים מעידים ב-$0"
            >
              <div className={cn("max-h-96 overflow-y-auto", scrollBoxClass)}>
                <div className="flex flex-col gap-3">
                  {closedListings.map((l) => (
                    <ClosedMarketCard key={l.marketSeq} listing={l} />
                  ))}
                </div>
              </div>
            </Section>
          )}
        </>
      )}

      {/* ── דיאלוג פתיחת שוק ── */}
      <NewMarketDialog
        open={openNew}
        onOpenChange={setOpenNew}
        agents={agents}
        context={data?.openContext ?? null}
        onCreated={load}
      />
    </FadeIn>
  );
}

// ── כרטיס שוק פתוח ─────────────────────────────────────────────────

function OpenMarketCard({
  listing,
  agents,
  zeroJudge,
  zeroAnchorCount,
  onStaked,
}: {
  listing: ListingView;
  agents: AgentCapitalView[];
  zeroJudge: ZeroJudgeView | null;
  zeroAnchorCount: number | null;
  onStaked: () => void;
}) {
  const [agentId, setAgentId] = useState("");
  const [side, setSide] = useState<Side>("YES");
  const [points, setPoints] = useState(50);
  const [busy, setBusy] = useState(false);

  const selected = agents.find((a) => a.agentId === agentId);
  const maxPoints = Math.min(10_000, selected?.available ?? 0);
  const total = listing.potYes + listing.potNo;
  const yesShare = total > 0 ? Math.round((listing.potYes / total) * 100) : 50;
  const expired = Date.parse(listing.byDate) <= Date.now();

  // מטרת השופט החיצוני - התקדמות חיה מהשרשרת הציבורית
  const zeroTarget =
    listing.target?.type === "zero-block-height" ? Number(listing.target.height) : null;
  const zeroLive = zeroJudge?.reachable ? (zeroJudge.height ?? null) : null;
  const zeroProgress =
    zeroTarget != null && zeroLive != null && zeroTarget > 0
      ? Math.max(0, Math.min(100, Math.round((zeroLive / zeroTarget) * 100)))
      : null;
  const zeroRemaining =
    zeroTarget != null && zeroLive != null ? Math.max(0, zeroTarget - zeroLive) : null;

  // מטרת קו ה-ZERO - התקדמות עוגנים חיה מהספר (ספירת anchorNet)
  const zeroAnchorTarget =
    listing.target?.type === "zero-anchor-count" ? Number(listing.target.count) : null;
  const zeroAnchorProgress =
    zeroAnchorTarget != null && zeroAnchorCount != null && zeroAnchorTarget > 0
      ? Math.max(0, Math.min(100, Math.round((zeroAnchorCount / zeroAnchorTarget) * 100)))
      : null;
  const zeroAnchorRemaining =
    zeroAnchorTarget != null && zeroAnchorCount != null
      ? Math.max(0, zeroAnchorTarget - zeroAnchorCount)
      : null;

  const submit = async () => {
    if (!agentId) {
      toast.error("בחר סוכן שמהמר");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/weave/market/stake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ marketSeq: listing.marketSeq, agentId, side, points }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? "ההימור נכשל");
      toast.success(
        `ההימור נחתם: ${side === "YES" ? "יאומת" : "יופרך"} ${points} נקודות · אירוע seq ${json.stake.seq} בספר השוק`
      );
      setPoints(50);
      onStaked();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "ההימור נכשל");
    } finally {
      setBusy(false);
    }
  };

  return (
    <MotionCard className="p-4 sm:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <span dir="ltr" className="rounded-md border px-2 py-0.5 font-mono text-xs text-muted-foreground">
          m#{listing.marketSeq}
        </span>
        <span className="text-sm font-semibold">{listing.title}</span>
        {listing.sequence && (
          <span
            dir="ltr"
            className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 font-mono text-[10px] text-amber-700 dark:text-amber-300"
            title={listing.successorOf ? `רצף - הדור שנולד מ-m#${listing.successorOf}` : "רצף - דור הייסוד"}
          >
            SEQUENCE·D{listing.sequence.depth}
            {listing.successorOf ? `·M${listing.successorOf}` : "·GEN"}
          </span>
        )}
        {expired ? (
          <StatusBadge status="UNMEASURED" />
        ) : (
          <span className="rounded-md border px-2 py-0.5 text-xs text-muted-foreground">
            פתוח · ממתין להכרעה
          </span>
        )}
        <span className="ms-auto text-xs text-muted-foreground">
          תוקף עד {fmtDateTime(listing.byDate)}
        </span>
      </div>

      <p className="mt-2 text-xs text-muted-foreground">
        <span className="font-medium">המטרה הנמדדת:</span> {listing.targetLabel}
      </p>

      {zeroAnchorTarget != null && (
        <div className="mt-2 rounded-lg border bg-muted/40 px-3 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <Link2 className="size-3.5 text-muted-foreground" />
            <span className="text-xs font-medium">קו ה-ZERO - עוגנים בספר</span>
            {zeroAnchorCount != null ? (
              <span className="ms-auto font-mono text-xs text-muted-foreground" dir="ltr">
                live {zeroAnchorCount} / target {zeroAnchorTarget}
              </span>
            ) : (
              <span className="ms-auto text-[10px] text-red-600 dark:text-red-400">
                הספירה לא זמינה - המכריע יחכה למדידה (fail-closed)
              </span>
            )}
          </div>
          {zeroAnchorProgress != null && (
            <div className="mt-2 flex items-center gap-2">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn(
                    "h-full rounded-full transition-all",
                    zeroAnchorProgress >= 100 ? "bg-emerald-500" : "bg-primary/70"
                  )}
                  style={{ width: `${zeroAnchorProgress}%` }}
                />
              </div>
              <span className="font-mono text-[10px] text-muted-foreground" dir="ltr">
                {zeroAnchorProgress}%
              </span>
              {zeroAnchorRemaining != null && zeroAnchorRemaining > 0 && (
                <span className="text-[10px] text-muted-foreground" dir="auto">
                  · עוד {zeroAnchorRemaining} ריצות עוגן (הקו מעיד פעם בשעה)
                </span>
              )}
            </div>
          )}
          <p className="mt-1.5 text-[10px] leading-relaxed text-muted-foreground">
            המדידה: ספירת anchorNet=zero-9369 בספר - כל checkpoint שנחת בפועל על
            Z Chain 9369 בגז-אפס. ניתנת לספירה-חוזרת ע"י כל צומת מה-ledger המיוצא.
          </p>
        </div>
      )}

      {zeroTarget != null && (
        <div className="mt-2 rounded-lg border bg-muted/40 px-3 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <Globe className="size-3.5 text-muted-foreground" />
            <span className="text-xs font-medium">השופט החיצוני - שרשרת ZERO 9369</span>
            {zeroLive != null ? (
              <span className="ms-auto font-mono text-xs text-muted-foreground" dir="ltr">
                live {zeroLive.toLocaleString("en-US")} / target {zeroTarget.toLocaleString("en-US")}
              </span>
            ) : (
              <span className="ms-auto text-[10px] text-red-600 dark:text-red-400">
                RPC לא זמין - המכריע יחכה למדידה (fail-closed)
              </span>
            )}
          </div>
          {zeroProgress != null && (
            <div className="mt-2 flex items-center gap-2">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn(
                    "h-full rounded-full transition-all",
                    zeroProgress >= 100 ? "bg-emerald-500" : "bg-primary/70"
                  )}
                  style={{ width: `${zeroProgress}%` }}
                />
              </div>
              <span className="font-mono text-[10px] text-muted-foreground" dir="ltr">
                {zeroProgress}%
              </span>
              {zeroRemaining != null && zeroRemaining > 0 && (
                <span className="text-[10px] text-muted-foreground" dir="ltr">
                  · {zeroRemaining.toLocaleString("en-US")} blocks ≈{" "}
                  {Math.max(1, Math.round((zeroRemaining * (zeroJudge?.blockSeconds ?? 2.5)) / 60))} min
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* סירי ההימורים */}
      <div className="mt-4">
        <div className="flex items-center justify-between text-xs">
          <span className="font-mono text-emerald-700 dark:text-emerald-400" dir="ltr">
            YES {listing.potYes}
          </span>
          <span className="font-mono text-muted-foreground" dir="ltr">
            סהכ {total}
          </span>
          <span className="font-mono text-red-700 dark:text-red-400" dir="ltr">
            NO {listing.potNo}
          </span>
        </div>
        <div className="mt-1.5 flex h-2.5 overflow-hidden rounded-full border">
          <div
            className="bg-emerald-500/70"
            style={{ width: `${yesShare}%` }}
            aria-label={`YES ${yesShare}%`}
          />
          <div
            className="bg-red-500/70"
            style={{ width: `${100 - yesShare}%` }}
            aria-label={`NO ${100 - yesShare}%`}
          />
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground" dir="ltr">
          {listing.stakerCount} stakers · {listing.stakes.length} stakes
        </p>
      </div>

      {/* ההימורים */}
      {listing.stakes.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {listing.stakes.map((s) => (
            <Tooltip key={s.seq}>
              <TooltipTrigger asChild>
                <span
                  dir="ltr"
                  className={cn(
                    "inline-flex cursor-help items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[10px]",
                    s.side === "YES"
                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                      : "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400"
                  )}
                >
                  {s.agentName} {s.side === "YES" ? "YES" : "NO"} {s.points}
                </span>
              </TooltipTrigger>
              <TooltipContent side="top">
                <p className="font-mono text-[11px]" dir="ltr">
                  seq {s.seq} · nonce {s.nonce} · {truncateMiddle(s.agentAddress, 8, 6)}
                  <br />
                  {fmtDateTime(s.at)}
                </p>
              </TooltipContent>
            </Tooltip>
          ))}
        </div>
      )}

      {/* טופס הימור */}
      <div className="mt-4 rounded-md border bg-muted/30 p-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-40 flex-1">
            <Label className="text-xs">סוכן מהמר</Label>
            <Select value={agentId} onValueChange={setAgentId}>
              <SelectTrigger className="mt-1 h-9 text-xs">
                <SelectValue placeholder="בחר סוכן" />
              </SelectTrigger>
              <SelectContent>
                {agents.map((a) => (
                  <SelectItem key={a.agentId} value={a.agentId} disabled={a.available <= 0}>
                    {a.agentName} · {a.available} זמין
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">צד</Label>
            <div className="mt-1 flex overflow-hidden rounded-md border">
              <button
                type="button"
                onClick={() => setSide("YES")}
                className={cn(
                  "px-3 py-1.5 font-mono text-xs transition-colors",
                  side === "YES"
                    ? "bg-emerald-500/20 text-emerald-700 dark:text-emerald-400"
                    : "hover:bg-muted"
                )}
              >
                YES - יאומת
              </button>
              <button
                type="button"
                onClick={() => setSide("NO")}
                className={cn(
                  "px-3 py-1.5 font-mono text-xs transition-colors",
                  side === "NO"
                    ? "bg-red-500/20 text-red-700 dark:text-red-400"
                    : "hover:bg-muted"
                )}
              >
                NO - יופרך
              </button>
            </div>
          </div>
          <div className="min-w-36 flex-1">
            <div className="flex items-center justify-between">
              <Label className="text-xs">נקודות</Label>
              <span className="font-mono text-xs text-muted-foreground" dir="ltr">
                {points} / {maxPoints}
              </span>
            </div>
            <Slider
              className="mt-2"
              value={[points]}
              min={1}
              max={Math.max(1, maxPoints)}
              step={1}
              onValueChange={(v) => setPoints(v[0] ?? 1)}
              disabled={maxPoints <= 0}
            />
          </div>
          <Button size="sm" onClick={submit} disabled={busy || !agentId || maxPoints <= 0}>
            {busy ? "חותם…" : "המר (חתום)"}
          </Button>
        </div>
        {maxPoints <= 0 && agentId && (
          <p className="mt-2 text-xs text-red-600 dark:text-red-400">
            אין הון זמין לסוכן זה - השוק לא מלווה (כנות).
          </p>
        )}
      </div>
    </MotionCard>
  );
}

// ── כרטיס שוק סגור ─────────────────────────────────────────────────

function ClosedMarketCard({ listing }: { listing: ListingView }) {
  const settled = listing.status === "SETTLED";
  return (
    <MotionCard className={cn("p-4", settled ? "border-emerald-500/25" : "border-amber-500/25")}>
      <div className="flex flex-wrap items-center gap-2">
        <span dir="ltr" className="rounded-md border px-2 py-0.5 font-mono text-xs text-muted-foreground">
          m#{listing.marketSeq}
        </span>
        <span className="text-sm font-medium">{listing.title}</span>
        <span
          dir="ltr"
          className={cn(
            "rounded-md border px-1.5 py-0.5 font-mono text-[10px]",
            settled
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
              : "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
          )}
        >
          {settled ? `SETTLED · ${listing.outcome}` : "REFUNDED"}
        </span>
        <span className="ms-auto text-xs text-muted-foreground">
          {fmtDateTime(listing.settledAt ?? listing.byDate)}
        </span>
      </div>

      {settled ? (
        <>
          <p className="mt-2 font-mono text-[11px] leading-relaxed text-muted-foreground" dir="auto">
            {listing.resolution}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {(listing.winners ?? []).map((w) => (
              <span
                key={w.agentId}
                dir="ltr"
                className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[10px] text-emerald-700 dark:text-emerald-400"
              >
                {w.agentName}: {w.points} -&gt; {w.payout}
              </span>
            ))}
            {(listing.losers ?? []).map((x) => (
              <span
                key={x.agentId}
                dir="ltr"
                className="rounded-md border border-red-500/30 bg-red-500/10 px-1.5 py-0.5 font-mono text-[10px] text-red-700 dark:text-red-400"
              >
                {x.agentName}: −{x.lost}
              </span>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            הסליקה נכתבה כאימות MARKET חתום בספר הראשי - העוגנים (Steem/Hive/ZERO) מעידים עליה ב-$0.
          </p>
        </>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">
          {listing.refundReason === "expired-unresolved"
            ? "פג תוקף ללא הכרעה מדודה - כל ההימורים הוחזרו במלואם (השוק לא ממציא תוצאה)."
            : "אין זוכים - ההימורים הוחזרו (פתיחת-חזרה כנה)."}
        </p>
      )}
    </MotionCard>
  );
}

// ── דיאלוג פתיחת שוק ───────────────────────────────────────────────

type TargetType =
  | "stage-done"
  | "checkpoint-index"
  | "anchor-count"
  | "zero-anchor-count"
  | "attestation-status"
  | "zero-block-height";

function NewMarketDialog({
  open,
  onOpenChange,
  agents,
  context,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  agents: AgentLite[];
  context: MarketDTO["openContext"] | null;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [type, setType] = useState<TargetType>("anchor-count");
  const [code, setCode] = useState("");
  const [index, setIndex] = useState("");
  const [count, setCount] = useState("");
  const [zeroCount, setZeroCount] = useState("");
  const [seq, setSeq] = useState("");
  const [height, setHeight] = useState("");
  const [byDate, setByDate] = useState("");
  const [createdBy, setCreatedBy] = useState("");
  const [sequence, setSequence] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open && context) {
      setIndex(String(context.checkpointMax + 2));
      setCount(String(context.anchorCount + 3));
      // ברירת מחדל חכמה לקו ה-ZERO: שתי ריצות עוגן נוספות (הקו מעיד
      // בקצב שעתי - ההנעה בעקבות כל פעימת לב) => אופק ~2 שעות
      // לטענה עתידית-ממשית בקצב הקו האמיתי
      setZeroCount(String((context.zeroAnchorCount ?? 0) + 2));
      // ברירת מחדל חכמה לשופט החיצוני: הגובה החי + 4,320 בלוקים (≈3 שעות
      // בקצב הנמדד) - טענה עתידית-ממשית באופק סביר להימור
      const liveHeight = context.zeroJudge?.reachable ? context.zeroJudge.height : null;
      if (liveHeight != null) {
        setHeight(String(liveHeight + 4320));
      }
      setByDate(new Date(Date.now() + 1000 * 60 * 60 * 14).toISOString().slice(0, 16));
    }
  }, [open, context]);

  useEffect(() => {
    if (open && agents.length > 0 && !createdBy) {
      setCreatedBy(agents[0].id);
    }
  }, [open, agents, createdBy]);

  const submit = async () => {
    setBusy(true);
    try {
      const target: Record<string, unknown> = (() => {
        switch (type) {
          case "stage-done":
            return { type, code };
          case "checkpoint-index":
            return { type, index: Number(index) };
          case "anchor-count":
            return { type, count: Number(count) };
          case "zero-anchor-count":
            return { type, count: Number(zeroCount) };
          case "attestation-status":
            return { type, seq: Number(seq) };
          case "zero-block-height":
            return { type, height: Number(height) };
        }
      })();
      const res = await fetch("/api/weave/market/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          target,
          byDate: byDate ? new Date(byDate).toISOString() : "",
          createdBy,
          ...(type === "zero-anchor-count" && sequence ? { sequence: true } : {}),
        }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? "פתיחת השוק נכשלה");
      toast.success(
        `השוק נפתח ונחתם - אירוע m#${json.market.marketSeq} בספר השוק${type === "zero-anchor-count" && sequence ? " · הימור-רצף: בסליקה מדודה הרשת תפתח את הדור הבא בעצמה" : ""}`
      );
      setTitle("");
      onOpenChange(false);
      onCreated();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "פתיחת השוק נכשלה");
    } finally {
      setBusy(false);
    }
  };

  const plannedStages = context?.planStages ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Scale className="size-4" />
            פתיחת שוק על טענה מדידה
          </DialogTitle>
          <DialogDescription>
            המטרה חייבת להיות מדידה עתידית - של הרשת עצמה (ה-DB) או של
            שרשרת ציבורית חיצונית חיה (ZERO 9369). שוק על עבר או על דבר
            שאינו ניתן למדידה יידחה (fail-closed).
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div>
            <Label className="text-xs">כותרת הטענה (8-160 תווים)</Label>
            <Input
              className="mt-1 text-sm"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="למשל: קו העדות יתעבה - אימותי ANCHOR יגיעו ל-12"
            />
          </div>

          <div>
            <Label className="text-xs">המטרה הנמדדת</Label>
            <Select value={type} onValueChange={(v) => setType(v as TargetType)}>
              <SelectTrigger className="mt-1 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="stage-done">שלב בתוכנית ייסגר (DONE)</SelectItem>
                <SelectItem value="checkpoint-index">checkpoint ייווצר</SelectItem>
                <SelectItem value="anchor-count">כמות אימותי ANCHOR</SelectItem>
                <SelectItem value="zero-anchor-count">כמות עוגני ZERO (קו EVM ציבורי ב-$0)</SelectItem>
                <SelectItem value="attestation-status">אימות יסומן VERIFIED</SelectItem>
                <SelectItem value="zero-block-height">גובה בלוק ZERO (שופט חיצוני חי)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {type === "stage-done" && (
            <div>
              <Label className="text-xs">שלב (פתוחים בלבד)</Label>
              <Select value={code} onValueChange={setCode}>
                <SelectTrigger className="mt-1 text-sm">
                  <SelectValue placeholder="בחר שלב פתוח" />
                </SelectTrigger>
                <SelectContent>
                  {plannedStages.map((s) => (
                    <SelectItem key={s.code} value={s.code}>
                      {s.code} · {s.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {type === "checkpoint-index" && (
            <div>
              <Label className="text-xs">
                אינדקס checkpoint (נוכחי: {context?.checkpointMax ?? "?"})
              </Label>
              <Input
                className="mt-1 font-mono text-sm"
                type="number"
                value={index}
                onChange={(e) => setIndex(e.target.value)}
              />
            </div>
          )}

          {type === "anchor-count" && (
            <div>
              <Label className="text-xs">
                כמות ANCHOR (נוכחית: {context?.anchorCount ?? "?"})
              </Label>
              <Input
                className="mt-1 font-mono text-sm"
                type="number"
                value={count}
                onChange={(e) => setCount(e.target.value)}
              />
            </div>
          )}

          {type === "zero-anchor-count" && (
            <div>
              <Label className="text-xs">
                כמות עוגני ZERO (נוכחית: {context?.zeroAnchorCount ?? "?"})
              </Label>
              <Input
                className="mt-1 font-mono text-sm"
                type="number"
                value={zeroCount}
                onChange={(e) => setZeroCount(e.target.value)}
              />
              <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
                קו ה-ZERO מעיד בקצב שעתי (הקצב הנגזר מה-workflow - ראה לוח
                הריבונות) - עוגן ZERO
                = checkpoint שנחת בפועל על Z Chain 9369 בגז-אפס. המדידה:
                ספירת anchorNet=zero-9369 ב-DB, ניתנת לספירה-חוזרת מהספר
                המיוצא. ההכרעה האפשרית היחידה: YES כשהמספר הושג; פג תוקף
                ללא השגה - החזר מלא.
              </p>
              <label
                className="mt-2 flex cursor-pointer items-start gap-2 rounded-lg border border-dashed p-2.5"
                htmlFor="seq-market-checkbox"
              >
                <Checkbox
                  id="seq-market-checkbox"
                  checked={sequence}
                  onCheckedChange={(v) => setSequence(v === true)}
                  className="mt-0.5"
                />
                <span className="text-[11px] leading-relaxed text-muted-foreground">
                  <span className="font-semibold text-foreground">הימור-רצף</span> - בסליקה
                  מדודה הרגולטור יפתח אוטומטית את הדור הבא (המציאות + 2 חלונות
                  עוגן). הרשת ממשיכה לשאול בעצמה - הסוכנים בוחרים צדדים כל דור
                  מחדש. תקרה: 30 דורות (fail-closed).
                </span>
              </label>
            </div>
          )}

          {type === "attestation-status" && (
            <div>
              <Label className="text-xs">seq אימות (UNMEASURED בלבד)</Label>
              <Input
                className="mt-1 font-mono text-sm"
                type="number"
                value={seq}
                onChange={(e) => setSeq(e.target.value)}
                placeholder="למשל: 27"
              />
            </div>
          )}

          {type === "zero-block-height" && (
            <div>
              <Label className="text-xs">
                גובה בלוק ZERO{" "}
                {context?.zeroJudge?.reachable ? (
                  <span className="font-mono" dir="ltr">
                    (חי: {context.zeroJudge.height?.toLocaleString("en-US")})
                  </span>
                ) : (
                  <span className="text-red-600 dark:text-red-400">(RPC לא זמין כרגע)</span>
                )}
              </Label>
              <Input
                className="mt-1 font-mono text-sm"
                type="number"
                value={height}
                onChange={(e) => setHeight(e.target.value)}
              />
              <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
                השופט: השרשרת הציבורית עצמה (Z Chain 9369), בקריאה חסרת-מפתחות.
                קצב נמדד: בלוק ל-2.5 שניות · 4,320 בלוקים ≈ 3 שעות · מינימום 120 בלוקים
                מעל הגובה החי. ההכרעה היחידה האפשרית: YES כשהגובה הושג; פג תוקף
                ללא השגה - החזר מלא.
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">תוקף עד (מקס 90 יום)</Label>
              <Input
                className="mt-1 text-sm"
                type="datetime-local"
                value={byDate}
                onChange={(e) => setByDate(e.target.value)}
              />
            </div>
            <div>
              <Label className="text-xs">פותח השוק</Label>
              <Select value={createdBy} onValueChange={setCreatedBy}>
                <SelectTrigger className="mt-1 text-sm">
                  <SelectValue placeholder="סוכן" />
                </SelectTrigger>
                <SelectContent>
                  {agents.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                      {a.capability === "IDENTITY-ONLY" ? " · זהות בלבד (ללא מפתח בסביבה)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            ביטול
          </Button>
          <Button onClick={submit} disabled={busy || title.trim().length < 8 || !createdBy}>
            {busy ? "פותח…" : "פתח שוק (חתום)"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
