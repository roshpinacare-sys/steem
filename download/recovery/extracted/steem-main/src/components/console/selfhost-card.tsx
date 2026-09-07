"use client";

// ─────────────────────────────────────────────────────────────────────────────
// SelfhostCard — Task 84: "does the network sit on its own server?"
// answered by deduction (מדע ההיסק) from witnesses that cannot lie:
// the LIVING-ATTEST on Steem/Hive + the origin/main commit stream + Actions.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

type SelfhostData = {
  at?: string;
  verdict?: string;
  error?: string;
  attest?: { height: number; chain: string; txid: string; at: string; ageMin: number } | null;
  attestFresh?: boolean;
  localDaemon?: { alive: boolean };
  cloudExecutor?: { commits: number; last: { author: string; at: string; hash: string }; ageMin: number } | null;
  cloudFresh?: boolean;
  actions?: { total?: number; runs?: { id: number; event: string; status: string; conclusion: string | null; at: string; head: string }[]; skipped?: string; error?: string };
  drill?: { killedAt: string; revivedAt: string | null; sandboxDeadNow?: boolean; cloudFingerprintInsideWindow?: boolean };
  deduction?: { attestFresh: boolean; cloudFingerprintFresh: boolean; sandboxDaemonAlive: boolean; proofWhileSandboxDead: boolean };
};

const VERDICT_STYLE: Record<string, { cls: string; he: string }> = {
  "SELF-HOSTED-PROVEN": { cls: "border-emerald-400/50 bg-emerald-400/10 text-emerald-300", he: "הרשת יושבת על השרת של עצמה — מוכח" },
  "CLOUD-TAKEOVER-PENDING": { cls: "border-amber-400/50 bg-amber-400/10 text-amber-300", he: "סנדבוקס מת — הענן לוקח פיקוד עד 30 דק׳" },
  "SANDBOX-PRIMARY · CLOUD-STANDBY": { cls: "border-violet-400/50 bg-violet-400/10 text-violet-300", he: "הסנדבוקס ראשי · הענן על-המשמר" },
  "DARK": { cls: "border-red-400/50 bg-red-400/10 text-red-300", he: "חושך — שום-דבר לא חי בשום מקום" },
};

export function SelfhostCard() {
  const [d, setD] = useState<SelfhostData | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/ops/selfhost", { cache: "no-store" });
      setD(await r.json());
    } catch { setD({ verdict: "DARK", error: "api unreachable" }); }
    finally { setBusy(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const v = d?.verdict ?? null;
  const style = (v && VERDICT_STYLE[v]) || { cls: "border-zinc-700 bg-zinc-800 text-zinc-400", he: "בודק…" };
  const lastRun = d?.actions?.runs?.[0] ?? null;

  return (
    <Card className="border-amber-900/40 bg-amber-400/[0.03]">
      <CardContent className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-semibold text-amber-300">שרת-עצמי — הרשת על השרת של עצמה (84)</span>
          <Badge variant="outline" className={`px-1.5 py-0 font-mono text-[10px] ${style.cls}`}>
            {v || "…"}
          </Badge>
          <Button variant="ghost" size="sm" className="ml-auto h-7 w-7 p-0 text-zinc-400 hover:text-amber-300" onClick={load} disabled={busy} aria-label="רענון">
            <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />
          </Button>
        </div>
        <div className="mt-1 text-[11px] text-zinc-500">{style.he}</div>

        <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] lg:grid-cols-4">
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5">
            <div className="text-zinc-500">עדות-חיה על השרשרת</div>
            <div className={d?.attestFresh ? "font-mono text-emerald-400" : "font-mono text-red-400"} dir="ltr">
              {d?.attest ? `h${d.attest.height} · ${d.attest.chain} · ${d.attest.ageMin}m` : "—"}
            </div>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5">
            <div className="text-zinc-500">טביעת-אצבע של הענן</div>
            <div className={d?.cloudFresh ? "font-mono text-emerald-400" : "font-mono text-zinc-500"} dir="ltr">
              {d?.cloudExecutor ? `${d.cloudExecutor.last.hash} · ${d.cloudExecutor.ageMin}m` : "—"}
            </div>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5">
            <div className="text-zinc-500">רץ-מקומי</div>
            <div className={`font-mono ${d?.localDaemon?.alive ? "text-emerald-400" : "text-amber-400"}`} dir="ltr">
              {d?.localDaemon ? (d.localDaemon.alive ? "alive" : "dead") : "—"}
            </div>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5">
            <div className="text-zinc-500">פעימות-ענן (Actions)</div>
            <div className="font-mono text-zinc-300" dir="ltr">
              {lastRun ? `${lastRun.event} · ${lastRun.status}${lastRun.conclusion ? ` · ${lastRun.conclusion}` : ""}` : (d?.actions?.total != null ? `${d.actions.total} runs` : "—")}
            </div>
          </div>
        </div>

        {d?.drill && (
          <div className="mt-2 rounded-lg border border-zinc-800 bg-zinc-950/60 p-2 text-[10px] leading-relaxed text-zinc-500" dir="ltr">
            drill window: killed {d.drill.killedAt}{d.drill.revivedAt ? ` · revived ${d.drill.revivedAt}` : " · STILL DEAD"}{d.drill.cloudFingerprintInsideWindow ? " · ☁ cloud fingerprint INSIDE window — proof" : ""}
          </div>
        )}

        <div className="mt-2 text-[10px] leading-relaxed text-zinc-600">
          ההיסק: אם העדות-על-השרשרת והקומיטים של cloud-heart[bot] חיים בזמן שהרץ-המקומי מת — הרשת מוכחת-עצמאית. העדים (השרשרת + origin/main) לא יכולים לשקר.
        </div>
      </CardContent>
    </Card>
  );
}
