"use client";

// ─────────────────────────────────────────────────────────────────────────────
// Shell — RTL rail navigation (first child = right side), sticky topbar with
// live chips, sticky footer. Ten views: command / vault / treasury /
// liquidity / knowledge / system / net / explorer / weave / plans. The default
// view is פיקוד — the operator lands on actions; the vault is one click away
// and always visible via key chips.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useSyncExternalStore } from "react";
import {
  Activity,
  Banknote,
  BrainCircuit,
  Crosshair,
  Droplets,
  KeyRound,
  LockKeyhole,
  LockOpen,
  Network,
  Radar,
  Telescope,
  Waypoints,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import { fmtNum, relTime, useBrain, useChainBeat, useProofs, useStatus, useTick, useVaultMatrix } from "./api";
import { ActionsView } from "./actions-view";
import { ExplorerView } from "./explorer-view";
import { KnowledgeView } from "./knowledge-view";
import { LiquidityView } from "./liquidity-view";
import { NetView } from "./net-view";
import { PlansView } from "./plans-view";
import { SystemView } from "./system-view";
import { TreasuryView } from "./treasury-view";
import { VaultView } from "./vault-view";
import { WeaveView } from "./weave-view";

type ViewId = "command" | "vault" | "treasury" | "liquidity" | "knowledge" | "system" | "net" | "explorer" | "weave" | "plans";

/** 87 — hydration gate: false on the server snapshot, true on the client —
 *  the canonical linter-safe "is mounted" (a server wall-clock can never
 *  match the client's first paint, so anything ticking renders post-hydration). */
const emptySubscribe = () => () => {};
function useMounted(): boolean {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
}

/** Live clock + data age — re-renders every second so the operator can SEE
 *  the console breathing: the age resets each time fresh data lands.
 *  87 — hydration-safe: the wall-clock renders only after mount (a server
 *  timestamp can never match the client's first paint). */
function LiveClock({ updatedAt }: { updatedAt: string | null }) {
  useTick(1000);
  const mounted = useMounted();
  const now = new Date();
  const ageSec = updatedAt
    ? Math.max(0, Math.floor((now.getTime() - new Date(updatedAt).getTime()) / 1000))
    : null;
  const fresh = ageSec != null && ageSec < 90;
  return (
    <span
      className="flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900/80 px-2 py-0.5 font-mono text-[10px]"
      dir="ltr"
      title="שעון-חי + גיל-הדיווח האחרון — מתעדכן כל שנייה"
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          fresh ? "animate-pulse bg-emerald-400" : ageSec == null ? "bg-zinc-600" : "bg-amber-400",
        )}
        aria-hidden="true"
      />
      <span className="text-zinc-300">{mounted ? now.toLocaleTimeString("he-IL", { hour12: false }) : "--:--:--"}</span>
      {mounted && ageSec != null && (
        <span className={fresh ? "text-emerald-300" : "text-amber-300"}>
          · {ageSec}s
        </span>
      )}
    </span>
  );
}

/** SAOS-NET pulse chip — sovereign chain height + seconds since the last beat,
 *  polled every 20s, ticking every second. The chain's heartbeat, visible. */
function ChainBeatChip() {
  const beat = useChainBeat();
  const h = beat?.summary.height ?? null;
  const age = beat?.ageSec ?? null;
  const fresh = age != null && age < 120;
  return (
    <span
      className="hidden items-center gap-1 rounded-full border border-zinc-800 bg-zinc-900/80 px-2 py-0.5 font-mono text-[10px] sm:flex"
      dir="ltr"
      title="פעימת SAOS-NET — גובה השרשרת הריבונית (סקר חי כל 20 שניות)"
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          h != null ? (fresh ? "animate-pulse bg-emerald-400" : "bg-amber-400") : "bg-zinc-600",
        )}
        aria-hidden="true"
      />
      <span className={h != null ? "text-emerald-300" : "text-zinc-500"}>H:{h ?? "—"}</span>
      {age != null && <span className="text-zinc-500">· {age}s</span>}
    </span>
  );
}

const NAV: { id: ViewId; label: string; sub: string; icon: LucideIcon }[] = [
  { id: "command", label: "פיקוד", sub: "פעולות ושליטה", icon: Crosshair },
  { id: "vault", label: "כספת", sub: "מפתחות וחיבור מפתח-ראשי", icon: KeyRound },
  { id: "treasury", label: "כספים", sub: "יתרות, ספר, P&L", icon: Banknote },
  { id: "liquidity", label: "נזילות", sub: "בריכת-AMM, grid-MM, חיילי-LP", icon: Droplets },
  { id: "knowledge", label: "ידע", sub: "גילויים והוכחות", icon: BrainCircuit },
  { id: "system", label: "מערכת", sub: "דמון, גשר, זהות", icon: Activity },
  { id: "net", label: "רשת", sub: "SAOS-Net — מרשם, אחסון, משימות", icon: Network },
  { id: "explorer", label: "אקספלורר", sub: "SAOS-NET — בלוקים, חשבונות, ספר, עגונים, תיעוד-ציבורי", icon: Telescope },
  { id: "weave", label: "אריגה", sub: "THE WEAVE — רשת-האמת: חותמות, איטומים, עגונים, תעודות", icon: Waypoints },
  { id: "plans", label: "תוכניות", sub: "צעדים וחשבונות", icon: Radar },
];

function TopBar({
  view,
  setView,
  account,
  realMode,
  daemonAlive,
  proofsVerdict,
  proofsAgeMs,
  price,
  postingArmed,
  activeArmed,
  updatedAt,
  onProofsClick,
}: {
  view: ViewId;
  setView: (v: ViewId) => void;
  account: string | null;
  realMode: boolean;
  daemonAlive: boolean;
  proofsVerdict: string | null;
  proofsAgeMs: number | null;
  price: number | null;
  postingArmed: boolean;
  activeArmed: boolean;
  updatedAt: string | null;
  onProofsClick: () => void;
}) {
  return (
    <header className="sticky top-0 z-30 border-b border-zinc-800 bg-zinc-950/90 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center gap-x-3 gap-y-1 px-4 py-2">
        <div className="flex items-center gap-2">
          <span className="flex size-7 items-center justify-center rounded-lg border border-emerald-400/30 bg-emerald-400/10 text-sm">
            ⬢
          </span>
          <div className="leading-tight">
            <div className="text-[13px] font-black text-zinc-100">SAOS Console</div>
            <div className="hidden text-[9px] text-zinc-500 sm:block">מערכת ריבונית על-שרשרתית</div>
          </div>
        </div>

        <nav className="scrollbar-hide mx-1 flex flex-1 items-center gap-0.5 overflow-x-auto" aria-label="ניווט ראשי">
          {NAV.map((n) => {
            const Icon = n.icon;
            const active = view === n.id;
            return (
              <button
                key={n.id}
                onClick={() => setView(n.id)}
                aria-current={active ? "page" : undefined}
                title={n.sub}
                className={cn(
                  "flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] transition-colors",
                  active
                    ? "bg-zinc-800 font-semibold text-zinc-100"
                    : "text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300",
                )}
              >
                <Icon className="size-3.5" aria-hidden="true" />
                {n.label}
              </button>
            );
          })}
        </nav>

        <div className="flex shrink-0 items-center gap-1.5">
          <ChainBeatChip />
          <LiveClock updatedAt={updatedAt} />
          <button
            onClick={() => setView("vault")}
            title={`כספת המפתחות — posting ${postingArmed ? "חובר" : "לא חובר"} · active ${activeArmed ? "חובר" : "לא חובר"}`}
            className={cn(
              "flex items-center gap-1 rounded-full border px-1.5 py-0.5 font-mono text-[10px] transition-colors",
              postingArmed && activeArmed
                ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300 hover:bg-emerald-400/20"
                : postingArmed || activeArmed
                  ? "border-amber-400/30 bg-amber-400/5 text-amber-300 hover:bg-amber-400/15"
                  : "border-zinc-700 bg-zinc-900 text-zinc-500 hover:bg-zinc-800",
            )}
            aria-label="מצב הכספת — לחיצה: מסך הכספת"
          >
            {postingArmed && activeArmed ? (
              <LockKeyhole className="size-3" aria-hidden="true" />
            ) : (
              <LockOpen className="size-3" aria-hidden="true" />
            )}
            <span dir="ltr" className="hidden sm:inline">
              P{postingArmed ? 1 : 0}·A{activeArmed ? 1 : 0}
            </span>
          </button>
          <button
            onClick={onProofsClick}
            title="מטריצת ההוכחות — לחיצה: הרץ אימות מלא"
            className={cn(
              "flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[10px] transition-colors",
              proofsVerdict
                ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300 hover:bg-emerald-400/20"
                : "border-zinc-700 bg-zinc-900 text-zinc-500",
            )}
          >
            {proofsVerdict ?? "אין עדות"}
            {proofsVerdict && proofsAgeMs != null && (
              <span
                dir="ltr"
                className={cn(
                  "rounded-full px-1 py-px text-[9px] font-semibold",
                  proofsAgeMs < 45 * 60_000
                    ? "bg-emerald-400/15 text-emerald-300" // טרי — לולאת-המטריצה חיה
                    : proofsAgeMs < 3 * 3_600_000
                      ? "bg-amber-400/15 text-amber-300" // מתיישן — הרענון הבא בדרך
                      : "bg-rose-400/15 text-rose-300", // קפוא — מגיע-ה-94: אין-עוד צ'יפ-קפוא
                )}
              >
                {proofsAgeMs < 90_000
                  ? "now"
                  : proofsAgeMs < 3_600_000
                    ? `${Math.round(proofsAgeMs / 60_000)}m`
                    : proofsAgeMs < 86_400_000
                      ? `${Math.round(proofsAgeMs / 3_600_000)}h`
                      : `${Math.round(proofsAgeMs / 86_400_000)}d`}
              </span>
            )}
          </button>
          {price != null && (
            <Badge variant="outline" className="hidden border-zinc-700 bg-zinc-900 px-1.5 py-0 font-mono text-[10px] text-amber-300 sm:inline-flex" dir="ltr" title="מחיר STEEM חי">
              ${fmtNum(price, 4)}
            </Badge>
          )}
          <span
            className={cn("size-1.5 rounded-full", daemonAlive ? "saos-live-dot bg-emerald-400" : "bg-zinc-600")}
            title={daemonAlive ? "הדמון חי" : "הדמון לא מדווח"}
            aria-hidden="true"
          />
          {realMode && (
            <Badge variant="outline" className="border-emerald-400/30 bg-emerald-400/10 px-1 py-0 text-[9px] text-emerald-300">
              REAL
            </Badge>
          )}
          {account && (
            <span className="hidden font-mono text-[11px] text-zinc-300 md:inline" dir="ltr">
              @{account}
            </span>
          )}
        </div>
      </div>
    </header>
  );
}

export function Shell() {
  const [view, setView] = useState<ViewId>("command");
  const [proofsKey, setProofsKey] = useState(0);
  const status = useStatus();
  const brain = useBrain();
  const { proofs } = useProofs();
  const vault = useVaultMatrix();
  const price = useBrainPrice();

  const daemonAlive =
    status != null && Date.now() - new Date(status.updatedAt).getTime() < 20 * 60 * 1000;
  const postingArmed = vault?.stored.some((s) => s.role === "posting") ?? brain?.autonomy?.keyConfigured ?? false;
  const activeArmed = vault?.stored.some((s) => s.role === "active") ?? brain?.autonomy?.activeKeyInVault ?? false;

  return (
    <div className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100">
      <TopBar
        view={view}
        setView={(v) => {
          if (v === "knowledge") setProofsKey((k) => k + 1);
          setView(v);
        }}
        account={status?.account ?? null}
        realMode={status ? !status.dryRun : (brain?.autonomy?.realMode ?? false)}
        daemonAlive={daemonAlive}
        proofsVerdict={proofs?.proofs ? proofs.proofs.verdict : null}
        proofsAgeMs={proofs?.ageMs ?? null}
        price={price}
        postingArmed={postingArmed}
        activeArmed={activeArmed}
        updatedAt={status?.updatedAt ?? null}
        onProofsClick={() => {
          setView("system");
          setProofsKey((k) => k + 1);
        }}
      />

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-5">
        {view === "command" && (
          <ActionsView
            status={status}
            brain={brain}
            onNavigate={(v) => {
              if (v === "knowledge") setProofsKey((k) => k + 1);
              setView(v as ViewId);
            }}
          />
        )}
        {view === "vault" && (
          <VaultView
            onNavigate={(v) => {
              if (v === "knowledge") setProofsKey((k) => k + 1);
              setView(v as ViewId);
            }}
          />
        )}
        {view === "treasury" && <TreasuryView status={status} brain={brain} />}
        {view === "liquidity" && <LiquidityView />}
        {view === "knowledge" && <KnowledgeView key={proofsKey} />}
        {view === "system" && <SystemView key={proofsKey} status={status} brain={brain} />}
        {view === "net" && <NetView />}
        {view === "explorer" && <ExplorerView />}
        {view === "weave" && <WeaveView />}
        {view === "plans" && <PlansView brain={brain} />}
      </main>

      <footer className="mt-auto border-t border-zinc-800 bg-zinc-950/90 pb-[calc(env(safe-area-inset-bottom,0px)+0.75rem)] pt-2.5">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 text-[10px] text-zinc-600">
          <FooterLive updatedAt={status?.updatedAt ?? null} />
          <span className="font-mono" dir="ltr">
            {status?.account ? `@${status.account}` : "—"} · pid keepalive armed
          </span>
        </div>
      </footer>
    </div>
  );
}

/** price chip — read from live endpoint lightly (60s). */
import { useLive } from "./api";
function useBrainPrice(): number | null {
  const live = useLive();
  return live?.steemUsd ?? live?.chain?.steemUsd ?? null;
}

/** footer line that ticks every second — "דיווח אחרון" visibly counts up.
 *  87 — hydration-safe: age text renders only after mount. */
function FooterLive({ updatedAt }: { updatedAt: string | null }) {
  useTick(1000);
  const mounted = useMounted();
  const beat = useChainBeat();
  return (
    <span>
      SAOS Console v9 · {NAV.length} מסכים · הכל נמדד מהשרשראות ומקומית ·{" "}
      {updatedAt && mounted ? `דיווח אחרון ${relTime(updatedAt)}` : "אין דיווח"}
      {beat?.summary.height != null && (
        <span className="font-mono" dir="ltr">
          {" "}
          · SAOS-NET H:{beat.summary.height}
        </span>
      )}
    </span>
  );
}
