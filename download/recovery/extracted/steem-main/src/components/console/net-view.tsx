"use client";

// ─────────────────────────────────────────────────────────────────────────────
// NetView — SAOS-Net v1: the smart network ON the chain.
// Registry (saos:// names), KV storage (hash-verified), measured chain walls,
// the mission queue (task→assign→encrypted command→soldier-signed result),
// and the value-unlock tracker (HE unstake schedule). Everything on this
// screen is measured from result files the agent wrote after real broadcasts.
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from "react";
import { Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

import { relTime, runExec, submitMission, useNet, type ConformsResult, type GenesisResult, type NetLimits, type NetRegistryEntry, type NetSite } from "./api";

const TYPE_LABEL: Record<string, string> = {
  server: "שרת",
  hq: "מפקדה",
  service: "שירות",
  agent: "חייל",
};

function VerifiedBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "px-1.5 py-0 font-mono text-[10px]",
        ok ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300" : "border-amber-400/30 bg-amber-400/10 text-amber-300",
      )}
    >
      {label}
    </Badge>
  );
}

function LimitsCard({ limits }: { limits: NetLimits | null }) {
  const walls = limits?.probes?.filter((p) => p.verdict === "wall") ?? [];
  const passes = limits?.probes?.filter((p) => p.verdict === "pass") ?? [];
  return (
    <Card className="border-zinc-800 bg-zinc-900/60">
      <CardContent className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-[13px] font-semibold text-zinc-100">📏 גבולות-הרשת — נמדדו חי (לא מהדוקים)</div>
          {limits?.summary ? (
            <VerifiedBadge ok label={`${limits.summary.passed} עברו · ${limits.summary.walls} חומות`} />
          ) : (
            <Badge variant="outline" className="border-zinc-700 px-1.5 py-0 text-[10px] text-zinc-500">
              טרם נמדד — הרצת limits בפיקוד
            </Badge>
          )}
          <span className="ms-auto text-[10px] text-zinc-500">{relTime(limits?.at ?? null)}</span>
        </div>
        <p className="mt-1.5 text-[10px] leading-relaxed text-zinc-500">
          כל חומה כאן היא שגיאה אמיתית שהשרשרת החזירה בזמן שידור חי — המסמך הזה הוא מפת-היכולת של הרשת שלנו.
        </p>
        {!limits ? (
          <Skeleton className="mt-3 h-16 w-full bg-zinc-800/60" />
        ) : (
          <>
            <div className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
              {[
                { k: "custom_json", v: "≤8192B" },
                { k: "קצב פרסום", v: "≤5 לבלוק" },
                { k: "memo", v: "<2048B" },
                { k: "סמכויות", v: "≤40" },
                { k: "בלוק", v: `${(limits.blockCadenceSec ?? 3).toFixed(3)}s` },
                { k: "היסטוריה", v: `cap ${limits.historyWindow?.cap ?? 100}` },
                { k: "דיוק", v: "3 ספרות" },
                { k: "דופליקטים", v: "נדחים" },
              ].map((x) => (
                <div key={x.k} className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2">
                  <div className="text-[9px] text-zinc-500">{x.k}</div>
                  <div className="font-mono text-[11px] font-semibold text-amber-300" dir="ltr">
                    {x.v}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-2 max-h-40 space-y-1 overflow-y-auto pr-1 scrollbar-thin">
              {walls.map((w, i) => (
                <div key={i} className="rounded-md border border-red-400/20 bg-red-400/5 px-2 py-1">
                  <div className="text-[10px] font-semibold text-red-300">חומה · {w.name}</div>
                  <div className="font-mono text-[9px] leading-tight text-zinc-500" dir="ltr">
                    {w.got.slice(0, 110)}
                  </div>
                </div>
              ))}
              {passes.slice(0, 4).map((p, i) => (
                <div key={i} className="rounded-md border border-zinc-800 bg-zinc-950/60 px-2 py-1">
                  <div className="text-[10px] font-semibold text-emerald-300">עבר · {p.name}</div>
                  <div className="font-mono text-[9px] leading-tight text-zinc-500" dir="ltr">
                    {p.got.slice(0, 110)}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function RegistryCard() {
  const net = useNet();
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();
  const reg = net?.registry;
  const entries: NetRegistryEntry[] = reg?.registry ? Object.values(reg.registry) : [];
  const agents = entries.filter((e) => e.type === "agent");
  const services = entries.filter((e) => e.type !== "agent");

  const rerun = async () => {
    setBusy(true);
    try {
      const r = await runExec("registry");
      toast({ title: r.ok ? "רישום חדש משודר" : "ההרצה נדחתה", description: r.ok ? `runId ${r.runId?.slice(0, 8)}…` : r.error });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="border-zinc-800 bg-zinc-900/60">
      <CardContent className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-[13px] font-semibold text-zinc-100">🗂️ מרשם saos:// — על-השרשרת (לא DNS)</div>
          {reg?.verified ? (
            <VerifiedBadge ok label={`${reg.onChainResolved}/${reg.entries} שמות`} />
          ) : (
            <Badge variant="outline" className="border-zinc-700 px-1.5 py-0 text-[10px] text-zinc-500">
              טרם נרשם
            </Badge>
          )}
          <Button
            size="sm"
            variant="outline"
            className="ms-auto h-7 border-zinc-700 px-2 text-[11px] hover:bg-zinc-800"
            onClick={rerun}
            disabled={busy}
          >
            {busy ? <Loader2 className="size-3 animate-spin" /> : null}
            רישום/אימות מחדש
          </Button>
        </div>
        <p className="mt-1.5 text-[10px] leading-relaxed text-zinc-500">
          ריבונות-שמות: כל רישום custom_json חתום במפתח-הפרסום של הבעלים — השרשרת מאמתת בעלות, כל צד-שלישי יכול לקרוא.
          כלל פתרון: הרישום האחרון לשם מנצח, ההיסטוריה בלתי-ניתנת לשינוי.
        </p>
        {entries.length === 0 ? (
          <Skeleton className="mt-3 h-16 w-full bg-zinc-800/60" />
        ) : (
          <div className="mt-3 max-h-64 space-y-1 overflow-y-auto pr-1 scrollbar-thin">
            {services.map((e) => (
              <div key={e.name} className="flex flex-wrap items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-950/60 px-2 py-1.5">
                <span className="font-mono text-[11px] font-semibold text-zinc-100" dir="ltr">
                  {e.name}
                </span>
                <Badge variant="outline" className="border-violet-400/30 bg-violet-400/10 px-1 py-0 text-[9px] text-violet-300">
                  {TYPE_LABEL[e.type] ?? e.type}
                </Badge>
                <span className="text-[9px] text-zinc-500" dir="ltr">
                  {(e.caps ?? []).slice(0, 3).join(" · ")}
                </span>
                <span className="ms-auto font-mono text-[9px] text-zinc-600" dir="ltr">
                  blk {e.block ?? "—"}
                </span>
              </div>
            ))}
            <div className="pt-1 text-[10px] text-zinc-500">
              חיילים ({agents.length}):{" "}
              <span className="font-mono text-zinc-400" dir="ltr">
                {agents.map((a) => a.name.replace("saos://", "")).join(", ")}
              </span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function KvCard() {
  const net = useNet();
  const kv = net?.kv;
  const doc = (kv?.readBack?.doc ?? {}) as Record<string, unknown>;
  return (
    <Card className="border-zinc-800 bg-zinc-900/60">
      <CardContent className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-[13px] font-semibold text-zinc-100">💾 SAOS-KV — אחסון ממוען-תוכן על-השרשרת</div>
          {kv?.verified || kv?.hashMatch ? (
            <VerifiedBadge ok label="roundtrip ✓ sha256" />
          ) : (
            <Badge variant="outline" className="border-zinc-700 px-1.5 py-0 text-[10px] text-zinc-500">
              טרם אומת
            </Badge>
          )}
          <span className="ms-auto text-[10px] text-zinc-500">{relTime(kv?.at ?? null)}</span>
        </div>
        <p className="mt-1.5 text-[10px] leading-relaxed text-zinc-500">
          put → קריאה מהשרשרת → הרכבה מחדש → השוואת sha256. מסמך שלא חוזר זהה = אין הוכחה. חלוקה לחלקים עוברת את
          חומת 8192B שנמדדה.
        </p>
        {!kv ? (
          <Skeleton className="mt-3 h-14 w-full bg-zinc-800/60" />
        ) : (
          <div className="mt-3 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950/60 px-2 py-1.5">
              <span className="font-mono text-[11px] font-semibold text-zinc-100" dir="ltr">
                {kv.put?.key ?? (kv.readBack?.doc?.doc as string | undefined) ?? "saos://manifest"}
              </span>
              <span className="font-mono text-[9px] text-zinc-500" dir="ltr">
                {kv.readBack?.size ?? kv.put?.size ?? 0}B · {kv.readBack?.parts ?? 1} part
              </span>
              <span className="ms-auto font-mono text-[9px] text-emerald-300/80" dir="ltr">
                sha256 {String(kv.readBack?.sha256 ?? kv.put?.sha256 ?? "").slice(0, 16)}…
              </span>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-2 py-1.5 text-[9px] text-zinc-500" dir="ltr">
              {doc.worldlog ? `wlog seq ${JSON.stringify(doc.worldlog).slice(0, 80)} · ` : ""}
              {doc.army ? `army ${JSON.stringify(doc.army)} · ` : ""}
              {doc.limits ? `limits walls ${JSON.stringify(doc.limits).slice(0, 60)}…` : ""}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MissionsCard() {
  const net = useNet();
  const [busy, setBusy] = useState(false);
  const [cmd, setCmd] = useState<string>("report");
  const { toast } = useToast();
  const m = net?.missions;

  const submit = async () => {
    setBusy(true);
    try {
      const r = await submitMission(cmd);
      if (r.ok) toast({ title: "משימה נרשמה בתור", description: `${r.id} — הדמון ישדר saos_task וינתב חייל תוך ~3 דק'` });
      else toast({ title: "נדחה", description: r.error, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const statusColor = (s?: string) =>
    s === "done"
      ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
      : s === "assigned"
        ? "border-amber-400/30 bg-amber-400/10 text-amber-300"
        : "border-zinc-700 text-zinc-400";

  return (
    <Card className="border-zinc-800 bg-zinc-900/60">
      <CardContent className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-[13px] font-semibold text-zinc-100">🎯 תור-משימות — ניתוב חיילים על-השרשרת</div>
          {m ? (
            <VerifiedBadge ok label={`${m.total} משימות · ${m.done} הושלמו`} />
          ) : (
            <Skeleton className="h-4 w-28 bg-zinc-800" />
          )}
        </div>
        <p className="mt-1.5 text-[10px] leading-relaxed text-zinc-500">
          saos_task (הגשה) → saos_net assign (ניתוב round-robin) → פקודה מוצפנת memo-ECDH → החייל מודה ומפרסם
          saos_result חתום במפתח-שלו. כל שלב ציבורי וניתן לביקורת צד-שלישי.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Select value={cmd} onValueChange={setCmd}>
            <SelectTrigger className="h-8 w-40 border-zinc-700 bg-zinc-950 text-[12px]">
              <SelectValue placeholder="פקודה" />
            </SelectTrigger>
            <SelectContent className="border-zinc-700 bg-zinc-900">
              <SelectItem value="report" className="text-[12px]">
                report — סטטוס מלא
              </SelectItem>
              <SelectItem value="status" className="text-[12px]">
                status — פינג סטטוס
              </SelectItem>
              <SelectItem value="drill" className="text-[12px]">
                drill — תרגיל רשת
              </SelectItem>
            </SelectContent>
          </Select>
          <Button size="sm" className="h-8 bg-emerald-500 px-3 text-[12px] font-semibold text-emerald-950 hover:bg-emerald-400" onClick={submit} disabled={busy}>
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : "הקצה משימה"}
          </Button>
        </div>
        <div className="mt-3 max-h-64 space-y-1.5 overflow-y-auto pr-1 scrollbar-thin">
          {(m?.tasks ?? []).slice().reverse().map((t) => (
            <div key={t.id} className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-2 py-1.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-mono text-[10px] text-zinc-400" dir="ltr">
                  {t.id}
                </span>
                <Badge variant="outline" className={cn("px-1 py-0 text-[9px]", statusColor(t.status))}>
                  {t.status === "done" ? "הושלם" : t.status === "assigned" ? "שובץ" : "פתוח"}
                </Badge>
                {t.assignedTo ? (
                  <span className="font-mono text-[10px] text-zinc-300" dir="ltr">
                    @{t.assignedTo}
                  </span>
                ) : null}
                {t.resultTxid ? (
                  <a
                    className="ms-auto font-mono text-[9px] text-emerald-400/70 hover:text-emerald-300"
                    href={`https://steemblockexplorer.com/tx/${t.resultTxid}`}
                    target="_blank"
                    rel="noreferrer"
                    dir="ltr"
                  >
                    {t.resultTxid.slice(0, 10)}…
                  </a>
                ) : null}
                {t.payTxid ? (
                  <a
                    className="font-mono text-[9px] text-amber-300/90 hover:text-amber-200"
                    href={`https://steemblockexplorer.com/tx/${t.payTxid}`}
                    target="_blank"
                    rel="noreferrer"
                    title={`משכורת ${t.payAmount ?? "0.004"} STEEM על-השרשרת`}
                    dir="ltr"
                  >
                    💰{String(t.payAmount ?? "0.004")}
                  </a>
                ) : null}
              </div>
              {t.resultData ? (
                <div className="mt-1 font-mono text-[9px] leading-tight text-zinc-500" dir="ltr">
                  {t.resultData.exists
                    ? `SP ${String(t.resultData.sp)} · VP ${String(t.resultData.vp)}% · RC ${String(t.resultData.rc)}% · ${String(t.resultData.steem)}`
                    : JSON.stringify(t.resultData).slice(0, 110)}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function UnlockCard() {
  const net = useNet();
  const rows = net?.unstake?.results ?? [];
  return (
    <Card className="border-zinc-800 bg-zinc-900/60">
      <CardContent className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-[13px] font-semibold text-zinc-100">🔓 פתיחת-ערך — unstake חי ב-Hive-Engine</div>
          {rows.length > 0 ? <VerifiedBadge ok label={`${rows.length} נכסים בשחרור`} /> : null}
        </div>
        <p className="mt-1.5 text-[10px] leading-relaxed text-zinc-500">
          נכסים מתים שהיו נעולים ב-stake — שוחררו לשחרור-הדרגתי (שנמדד מהשרשרת). כל טרנש מגיע לארנק ונמכר לפי
          דוקטרינת עצלנות-המחיר.
        </p>
        {rows.length === 0 ? (
          <Skeleton className="mt-3 h-12 w-full bg-zinc-800/60" />
        ) : (
          <div className="mt-3 space-y-1.5">
            {rows.map((r, i) => (
              <div key={i} className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-2 py-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[11px] font-semibold text-zinc-100" dir="ltr">
                    {r.symbol}
                  </span>
                  <span className="font-mono text-[10px] text-zinc-400" dir="ltr">
                    {r.stakedBefore} → שחרור {r.schedule?.transactionsLeft ?? "?"}× כל{" "}
                    {r.schedule && r.schedule.periodMs ? Math.round(parseInt(r.schedule.periodMs) / 86400000) : "?"} יום
                  </span>
                  {r.unlockValueHive != null ? (
                    <Badge variant="outline" className="border-amber-400/30 bg-amber-400/10 px-1 py-0 font-mono text-[9px] text-amber-300" dir="ltr">
                      ≈{r.unlockValueHive.toFixed(3)} HIVE
                    </Badge>
                  ) : null}
                  {r.txid ? (
                    <a
                      className="ms-auto font-mono text-[9px] text-emerald-400/70 hover:text-emerald-300"
                      href={`https://he.dtools.dev/tx/${r.txid}`}
                      target="_blank"
                      rel="noreferrer"
                      dir="ltr"
                    >
                      tx {r.txid.slice(0, 10)}…
                    </a>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function GenesisCard() {
  const net = useNet();
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();
  const g = net?.genesis ?? (null as GenesisResult | null);
  const bee = g?.ladder?.bee?.after ?? 0;
  const pct = Math.min(100, (bee / 100) * 100);
  const created = g?.token?.created === true;

  const run = async () => {
    setBusy(true);
    try {
      const r = await runExec("genesis");
      toast({ title: r.ok ? "מדרגת-הג׳נזיס רצה עכשיו" : "ההרצה נדחתה", description: r.ok ? "מכירות → SWAP.HIVE → BEE → (≥100) יצירת SAOS" : r.error });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="border-zinc-800 bg-zinc-900/60">
      <CardContent className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-[13px] font-semibold text-zinc-100">🧬 ג׳נזיס-טוקן — מדרגת ערך חיה אל הטוקן שלנו</div>
          {created ? (
            <VerifiedBadge ok label={`SAOS נולד על Hive-Engine`} />
          ) : g ? (
            <Badge variant="outline" className="border-amber-400/30 bg-amber-400/10 px-1.5 py-0 font-mono text-[10px] text-amber-300" dir="ltr">
              {bee.toFixed(2)}/100 BEE
            </Badge>
          ) : (
            <Badge variant="outline" className="border-zinc-700 px-1.5 py-0 text-[10px] text-zinc-500">טרם רץ</Badge>
          )}
          <Button size="sm" variant="outline" className="ms-auto h-7 border-zinc-700 px-2 text-[11px] hover:bg-zinc-800" onClick={run} disabled={busy}>
            {busy ? <Loader2 className="size-3 animate-spin" /> : "הרצה עכשיו"}
          </Button>
        </div>
        <p className="mt-1.5 text-[10px] leading-relaxed text-zinc-500">
          נכסים מתים → SWAP.HIVE → BEE (המטבע שממנו בונים טוקן) → ב-100 BEE נולד SAOS: precision 3 · maxSupply 1e9 ·
          staking+delegation+market. כל שלב מאומת בדלתא-יתרה, לא בסתם שידור.
        </p>
        {!g ? (
          <Skeleton className="mt-3 h-14 w-full bg-zinc-800/60" />
        ) : (
          <>
            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-zinc-800">
              <div className={cn("h-full rounded-full transition-all", created ? "bg-emerald-400" : "bg-amber-400/80")} style={{ width: `${Math.max(2, pct)}%` }} />
            </div>
            <div className="mt-1 flex flex-wrap gap-3 font-mono text-[9px] text-zinc-500" dir="ltr">
              <span>swap.hive {g.ladder?.swapHive?.after?.toFixed(3) ?? "—"}</span>
              <span>bee {bee.toFixed(3)}</span>
              <span>ever bought {(g.ladder?.totalBeeBoughtEver ?? 0).toFixed(3)}</span>
              <span>run #{g.run ?? "—"}</span>
            </div>
            <div className="mt-2 max-h-40 space-y-1 overflow-y-auto pr-1 scrollbar-thin">
              {(g.steps ?? []).slice().reverse().map((s, i) => (
                <div key={i} className="rounded-md border border-zinc-800 bg-zinc-950/60 px-2 py-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className={cn("text-[10px] font-semibold", s.ok ? "text-emerald-300" : "text-red-300")}>{s.ok ? "✓" : "✗"} {s.step}</span>
                    {s.txid ? (
                      <a className="ms-auto font-mono text-[9px] text-emerald-400/70 hover:text-emerald-300" href={`https://he.dtools.dev/tx/${s.txid}`} target="_blank" rel="noreferrer" dir="ltr">
                        {String(s.txid).slice(0, 10)}…
                      </a>
                    ) : null}
                  </div>
                  <div className="font-mono text-[9px] leading-tight text-zinc-500" dir="ltr">
                    {(s.detail ?? "").slice(0, 120)}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function ConformsCard() {
  const net = useNet();
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();
  const c = net?.conforms ?? (null as ConformsResult | null);

  const run = async () => {
    setBusy(true);
    try {
      const r = await runExec("conforms");
      toast({ title: r.ok ? "מטריצת-הקצה רצה — 13 טענות על-השרשרת" : "ההרצה נדחתה", description: r.ok ? "כל טענה מאומתת בדלתא-מצב, לא בסתם שידור" : r.error });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="border-zinc-800 bg-zinc-900/60">
      <CardContent className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-[13px] font-semibold text-zinc-100">📜 חוזים-חכמים HE — מטריצת קצה מדודה</div>
          {c?.summary ? (
            <VerifiedBadge ok label={`${c.summary.passCount}/${c.summary.total} עברו · ${c.summary.walls} חומות`} />
          ) : (
            <Badge variant="outline" className="border-zinc-700 px-1.5 py-0 text-[10px] text-zinc-500">טרם נמדד</Badge>
          )}
          <Button size="sm" variant="outline" className="ms-auto h-7 border-zinc-700 px-2 text-[11px] hover:bg-zinc-800" onClick={run} disabled={busy}>
            {busy ? <Loader2 className="size-3 animate-spin" /> : "מיפוי מחדש"}
          </Button>
        </div>
        <p className="mt-1.5 text-[10px] leading-relaxed text-zinc-500">
          שידור מצליח ≠ החוזה קיבל. כל טענה נמדדת בדלתא-מצב על הצד-השני: יתרות + ספרי-הזמנות זהים לפני/אחרי = החוזה
          דחה. זו מפת-הכוח האמיתית של חוזי-ה-HE שלנו.
        </p>
        {!c ? (
          <Skeleton className="mt-3 h-14 w-full bg-zinc-800/60" />
        ) : (
          <div className="mt-3 max-h-44 space-y-1 overflow-y-auto pr-1 scrollbar-thin">
            {(c.asserts ?? []).map((a, i) => (
              <div key={i} className="rounded-md border border-zinc-800 bg-zinc-950/60 px-2 py-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className={cn("text-[10px] font-semibold", a.pass ? "text-emerald-300" : "text-red-300")}>
                    {a.pass ? "✓" : "✗"} {a.id}
                  </span>
                  <Badge variant="outline" className="px-1 py-0 font-mono text-[8px] text-zinc-400" dir="ltr">
                    expect: {a.expect}
                  </Badge>
                </div>
                <div className="font-mono text-[9px] leading-tight text-zinc-500" dir="ltr">
                  {(a.got ?? "").slice(0, 110)}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SiteCard() {
  const net = useNet();
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();
  const site = net?.site ?? (null as NetSite | null);

  const publish = async () => {
    setBusy(true);
    try {
      const r = await runExec("site");
      toast({ title: r.ok ? "האתר נשדר אל תוך השרשרת" : "ההרצה נדחתה", description: r.ok ? "roundtrip sha256 כפוי לפני ההגשה" : r.error });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="border-zinc-800 bg-zinc-900/60">
      <CardContent className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-[13px] font-semibold text-zinc-100">🌐 SAOS-Web — אתר שנשכר בתוך הבלוקצ׳יין</div>
          {site?.verified ? <VerifiedBadge ok label="roundtrip ✓ sha256" /> : <Badge variant="outline" className="border-zinc-700 px-1.5 py-0 text-[10px] text-zinc-500">טרם פורסם</Badge>}
          <a
            href="/api/net/site"
            target="_blank"
            rel="noreferrer"
            className="ms-auto rounded-md border border-emerald-400/30 bg-emerald-400/10 px-2 py-1 text-[11px] font-semibold text-emerald-300 hover:bg-emerald-400/20"
          >
            פתח את האתר ↗
          </a>
          <Button size="sm" variant="outline" className="h-7 border-zinc-700 px-2 text-[11px] hover:bg-zinc-800" onClick={publish} disabled={busy}>
            {busy ? <Loader2 className="size-3 animate-spin" /> : "פרסום מחדש"}
          </Button>
        </div>
        <p className="mt-1.5 text-[10px] leading-relaxed text-zinc-500">
          אין שרת, אין דומיין, אין DNS: כל בייט שודר כ-custom_json (id=saos_kv) ונשלף מההיסטוריה הציבורית בזמן
          הבקשה. ההגשה חתומה בכותרות X-SAOS-* — כל צומת Steem בעולם מאמת.
        </p>
        {site?.verified ? (
          <div className="mt-3 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950/60 px-2 py-1.5">
              <span className="font-mono text-[11px] text-zinc-100" dir="ltr">saos://www/index.html</span>
              <span className="font-mono text-[9px] text-zinc-500" dir="ltr">{site.size ?? "—"}B · {site.parts ?? 1} part</span>
              <span className="ms-auto font-mono text-[9px] text-emerald-300/80" dir="ltr">blk {site.headBlock ?? "—"}</span>
            </div>
            <div className="font-mono text-[9px] text-zinc-500" dir="ltr">sha256 {String(site.sha256 ?? "").slice(0, 24)}…</div>
          </div>
        ) : (
          <Skeleton className="mt-3 h-12 w-full bg-zinc-800/60" />
        )}
      </CardContent>
    </Card>
  );
}

export function NetView() {
  const net = useNet();
  const agents = net?.registry?.registry ? Object.values(net.registry.registry).filter((e) => e.type === "agent").length : 0;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-black text-zinc-100">רשת SAOS</h1>
          <p className="text-[11px] text-zinc-500">
            תשתית חכמה על-גבי השרשראות — מרשם, אחסון, ביצוע, גבולות. הכל נמדד, הכל חתום, הכל ניתן לאימות צד-שלישי.
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <Badge variant="outline" className="border-emerald-400/30 bg-emerald-400/10 font-mono text-[10px] text-emerald-300">
            {agents} חיילים ברשת
          </Badge>
          <Badge variant="outline" className="border-zinc-700 font-mono text-[10px] text-zinc-400">
            saos-net/v1
          </Badge>
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <MissionsCard />
        <RegistryCard />
        <GenesisCard />
        <SiteCard />
        <ConformsCard />
        <KvCard />
        <UnlockCard />
        <div className="lg:col-span-2">
          <LimitsCard limits={net?.limits ?? null} />
        </div>
      </div>
    </div>
  );
}
