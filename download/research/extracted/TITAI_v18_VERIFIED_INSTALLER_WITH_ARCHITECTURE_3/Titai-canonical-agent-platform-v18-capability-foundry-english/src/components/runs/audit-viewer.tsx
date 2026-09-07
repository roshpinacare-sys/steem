"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { ShieldCheck, ShieldX, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/misc";
import { formatRelativeTime } from "@/lib/utils";

interface AuditEntry {
  id: number;
  ts: number;
  actorType: string;
  action: string;
  subjectType: string | null;
  subjectId: string | null;
  hash: string;
  prevHash: string;
}

export function AuditChainViewer() {
  const t = useTranslations();
  const locale = useLocale();
  const [loading, setLoading] = React.useState(true);
  const [entries, setEntries] = React.useState<AuditEntry[]>([]);
  const [verify, setVerify] = React.useState<{
    ok: boolean;
    length: number;
    brokenAtId?: number;
  } | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/audit/verify?entries=1");
    const body = await res.json();
    setVerify({ ok: body.ok, length: body.length, brokenAtId: body.brokenAtId });
    setEntries(body.entries ?? []);
    setLoading(false);
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex justify-center py-10">
        <Spinner />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        {verify && (
          <div
            className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm ${
              verify.ok
                ? "border-status-completed/40 bg-status-completed/10 text-status-completed"
                : "border-status-failed/40 bg-status-failed/10 text-status-failed"
            }`}
          >
            {verify.ok ? (
              <ShieldCheck className="size-4" />
            ) : (
              <ShieldX className="size-4" />
            )}
            {verify.ok
              ? t("audit.chainValid", { length: verify.length })
              : t("audit.chainBroken", { id: verify.brokenAtId ?? 0 })}
          </div>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            load();
            toast.success(t("audit.verifyChain"));
          }}
        >
          {t("audit.verifyChain")}
        </Button>
      </div>

      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-surface-raised text-xs text-subtle-foreground">
            <tr>
              <th className="px-3 py-2 text-start font-medium">#</th>
              <th className="px-3 py-2 text-start font-medium">{t("audit.action")}</th>
              <th className="px-3 py-2 text-start font-medium">{t("audit.actor")}</th>
              <th className="hidden px-3 py-2 text-start font-medium sm:table-cell">
                {t("audit.time")}
              </th>
              <th className="hidden px-3 py-2 text-start font-medium md:table-cell">
                {t("audit.hash")}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {entries.map((e) => (
              <tr key={e.id} className="hover:bg-surface-hover/50">
                <td className="px-3 py-2 font-mono text-xs tabular-nums text-subtle-foreground">
                  {e.id}
                </td>
                <td className="px-3 py-2">
                  <code className="font-mono text-xs text-foreground">{e.action}</code>
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {e.actorType}
                </td>
                <td className="hidden px-3 py-2 text-xs text-muted-foreground sm:table-cell">
                  {formatRelativeTime(e.ts, locale)}
                </td>
                <td className="hidden px-3 py-2 md:table-cell">
                  <span className="flex items-center gap-1 font-mono text-[11px] text-subtle-foreground">
                    <Link2 className="size-3" />
                    {e.hash.slice(0, 10)}…
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
