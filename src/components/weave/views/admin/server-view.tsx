"use client";

// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · Admin - שרת וסנכרון.
//
// מצב השרת המקומי מול הענן במדידה כנה: מרווח הסנכרון בין ה-DB
// המקומי לספר החי, מצב הגיט, וזמן ריצה. מה שמת - נראה מת.
// ─────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from "react";
import {
  ArrowDownUp,
  Database,
  GitBranch,
  HardDrive,
  RefreshCw,
  Server,
  Timer,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { AdminGate, useOperator } from "@/components/weave/operator";
import { HashChip } from "../../shared";

interface ServerData {
  server: { node: string; uptimeSec: number; platform: string; pid: number };
  local: {
    db: { attestations: number; checkpoints: number; agents: number; note: string };
    ledgerFile: {
      exists: boolean;
      attestations: number;
      checkpoints: number;
      headHash: string | null;
      updatedAt: string | null;
    };
    git: { head: string; branch: string; ahead: number; behind: number };
  };
  cloud: {
    attestations: number;
    checkpoints: number;
    agents: number;
    headHash: string;
    generatedAt: string;
  } | null;
  syncGap: number | null;
  measuredInMs: number;
  servedAt: string;
}

function uptime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}שע׳ ${m}דק׳` : `${m}דק׳ ${sec % 60}שנ׳`;
}

export function AdminServerView() {
  const { authedFetch, status } = useOperator();
  const [data, setData] = useState<ServerData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authedFetch("/api/admin/server");
      const j = (await res.json()) as { ok: boolean; error?: string } & ServerData;
      if (!res.ok || !j.ok) {
        throw new Error(
          j.error ??
            (res.status === 401 ? "אזור האדמין נעול — התחבר עם מפתח המפעיל" : "שגיאה")
        );
      }
      setData(j);
    } catch (e) {
      setError(e instanceof Error ? e.message : "המדידה נכשלה");
    } finally {
      setLoading(false);
    }
  }, [authedFetch]);

  useEffect(() => {
    if (status === "in") void load();
  }, [load, status]);

  return (
    <AdminGate>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight sm:text-3xl">
            <Server className="size-7 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
            שרת וסנכרון
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            האמת על הסביבה הזאת: מה חי כאן, מה חי בענן, ומה הפער ביניהם. השרת
            המקומי הוא חלון תצוגה ומרחב טסט - הספר האמיתי חי בענן ובגיט.
          </p>
        </div>
        <Button variant="outline" size="sm" className="gap-2" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={cn("size-4", loading && "animate-spin")} aria-hidden="true" />
          מדוד שוב
        </Button>
      </div>

      {loading && !data ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-48" />
          ))}
        </div>
      ) : error ? (
        <Card className="border-rose-500/40">
          <CardContent className="p-4 text-sm">{error}</CardContent>
        </Card>
      ) : data ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {/* השרת */}
          <Card>
            <CardContent className="flex flex-col gap-3 p-5">
              <div className="flex items-center gap-2 text-sm font-bold">
                <HardDrive className="size-4 text-muted-foreground" aria-hidden="true" />
                השרת המקומי
              </div>
              <div className="grid grid-cols-3 gap-3 text-center">
                <div>
                  <div className="text-2xl font-bold tabular-nums leading-none">
                    {uptime(data.server.uptimeSec)}
                  </div>
                  <div className="mt-1 text-[11px] text-muted-foreground">זמן ריצה</div>
                </div>
                <div>
                  <div className="font-mono text-lg font-bold leading-none" dir="ltr">
                    {data.server.node}
                  </div>
                  <div className="mt-1 text-[11px] text-muted-foreground">Node</div>
                </div>
                <div>
                  <div className="text-2xl font-bold tabular-nums leading-none">
                    {data.measuredInMs}ms
                  </div>
                  <div className="mt-1 text-[11px] text-muted-foreground">זמן המדידה</div>
                </div>
              </div>
              <div className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <Timer className="size-3.5" aria-hidden="true" />
                  platform {data.server.platform} · pid {data.server.pid}
                </span>
              </div>
            </CardContent>
          </Card>

          {/* הגיט */}
          <Card>
            <CardContent className="flex flex-col gap-3 p-5">
              <div className="flex items-center gap-2 text-sm font-bold">
                <GitBranch className="size-4 text-muted-foreground" aria-hidden="true" />
                גיט (הריפו הריבוני Zip)
              </div>
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <span className="font-mono" dir="ltr">
                  {data.local.git.head}
                </span>
                <Badge variant="outline" className="font-mono text-xs">
                  {data.local.git.branch}
                </Badge>
                {data.local.git.behind >= 0 ? (
                  <>
                    <Badge
                      variant="outline"
                      className={
                        data.local.git.behind > 0
                          ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                          : "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                      }
                    >
                      מאחור ב-{data.local.git.behind} קומיטים
                    </Badge>
                    {data.local.git.ahead > 0 && (
                      <Badge variant="outline">{data.local.git.ahead} מקומיים לפני</Badge>
                    )}
                  </>
                ) : (
                  <Badge variant="outline">מרחק לא נמדד</Badge>
                )}
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                הענן ממשיך לפעום גם כשהסביבה נופלת - הפער מצטבר מקומיטי הפעימות
                של הסוכנים. אין למשוך אוטומטית בזמן עבודה מקומית; בסיום - מזג
                מעל origin/main.
              </p>
            </CardContent>
          </Card>

          {/* מסד הנתונים המקומי */}
          <Card>
            <CardContent className="flex flex-col gap-3 p-5">
              <div className="flex items-center gap-2 text-sm font-bold">
                <Database className="size-4 text-muted-foreground" aria-hidden="true" />
                מסד הנתונים המקומי (סנדבוקס)
              </div>
              <div className="grid grid-cols-3 gap-3 text-center">
                <div>
                  <div className="text-2xl font-bold tabular-nums leading-none">
                    {data.local.db.attestations}
                  </div>
                  <div className="mt-1 text-[11px] text-muted-foreground">אימותים</div>
                </div>
                <div>
                  <div className="text-2xl font-bold tabular-nums leading-none">
                    {data.local.db.checkpoints}
                  </div>
                  <div className="mt-1 text-[11px] text-muted-foreground">צ'קפוינטים</div>
                </div>
                <div>
                  <div className="text-2xl font-bold tabular-nums leading-none">
                    {data.local.db.agents}
                  </div>
                  <div className="mt-1 text-[11px] text-muted-foreground">זהויות</div>
                </div>
              </div>
              <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-700 dark:text-amber-300">
                {data.local.db.note}
              </p>
              <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>
                  קובץ הספר המקומי:{" "}
                  {data.local.ledgerFile.exists
                    ? `${data.local.ledgerFile.attestations} אימותים`
                    : "לא נמצא"}
                </span>
                <HashChip value={data.local.ledgerFile.headHash} label="HEAD" head={6} tail={4} />
              </div>
            </CardContent>
          </Card>

          {/* הענן */}
          <Card className="border-emerald-500/30">
            <CardContent className="flex flex-col gap-3 p-5">
              <div className="flex items-center gap-2 text-sm font-bold">
                <ArrowDownUp className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                הספר החי בענן (אמת הייחוס)
              </div>
              {data.cloud ? (
                <>
                  <div className="grid grid-cols-3 gap-3 text-center">
                    <div>
                      <div className="text-2xl font-bold tabular-nums leading-none">
                        {data.cloud.attestations.toLocaleString("he-IL")}
                      </div>
                      <div className="mt-1 text-[11px] text-muted-foreground">אימותים</div>
                    </div>
                    <div>
                      <div className="text-2xl font-bold tabular-nums leading-none">
                        {data.cloud.checkpoints.toLocaleString("he-IL")}
                      </div>
                      <div className="mt-1 text-[11px] text-muted-foreground">צ'קפוינטים</div>
                    </div>
                    <div>
                      <div className="text-2xl font-bold tabular-nums leading-none">
                        {data.syncGap ?? "-"}
                      </div>
                      <div className="mt-1 text-[11px] text-muted-foreground">פער סנכרון</div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      מראה עודכנה{" "}
                      {new Date(data.cloud.generatedAt).toLocaleString("he-IL", {
                        day: "2-digit",
                        month: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    <HashChip value={data.cloud.headHash} label="HEAD" head={6} tail={4} />
                  </div>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  הענן לא נענה במדידה זו — החיות שלו טרם נמדדה מכאן; נסה שוב.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      ) : null}
    </AdminGate>
  );
}
