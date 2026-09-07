"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ShieldAlert, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RiskBadge } from "./badges";
import type { RiskLevel } from "@/lib/db/schema";

export interface ApprovalView {
  id: string;
  runId: string;
  toolName: string;
  riskLevel: RiskLevel;
  revision: number;
  requestPayload: { arguments: Record<string, unknown>; policyReason?: string };
}

export function ApprovalCard({
  approval,
  onResolved,
  compact,
}: {
  approval: ApprovalView;
  onResolved?: () => void;
  compact?: boolean;
}) {
  const t = useTranslations();
  const qc = useQueryClient();
  const [busy, setBusy] = React.useState(false);
  const [showReject, setShowReject] = React.useState(false);
  const [reason, setReason] = React.useState("");

  async function resolve(decision: "approve" | "reject") {
    setBusy(true);
    const res = await fetch(`/api/approvals/${approval.id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision, reason: reason || undefined, expectedRevision: approval.revision }),
    });
    setBusy(false);
    if (!res.ok) {
      const payload = await res.json().catch(() => ({})) as { error?: string };
      toast.error(payload.error === "approval_revision_conflict" ? "This approval was already changed. Refresh before acting again." : t("errors.generic"));
      return;
    }
    toast.success(decision === "approve" ? t("approvals.approved") : t("approvals.rejected"));
    qc.invalidateQueries({ queryKey: ["pending-approvals"] });
    onResolved?.();
  }

  return (
    <div className="rounded-lg border border-status-awaiting/40 bg-status-awaiting/[0.06] p-4">
      <div className="mb-2 flex items-center gap-2">
        <ShieldAlert className="size-4 text-status-awaiting" />
        <span className="text-sm font-medium">{t("approvals.title")}</span>
        <RiskBadge risk={approval.riskLevel} />
      </div>
      {!compact && (
        <p className="mb-3 text-sm text-muted-foreground">
          {t("approvals.subtitle")}
        </p>
      )}
      <div className="mb-3 space-y-1.5 text-sm">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-subtle-foreground">
            {t("approvals.tool")}
          </span>
          <code className="rounded bg-surface-raised px-1.5 py-0.5 font-mono text-xs text-foreground">
            {approval.toolName}
          </code>
        </div>
        {approval.requestPayload.policyReason && (
          <p className="text-xs text-muted-foreground">
            {approval.requestPayload.policyReason}
          </p>
        )}
        <pre className="mt-1 max-h-32 overflow-auto rounded-md border border-border bg-surface p-2 font-mono text-[11px] text-muted-foreground">
          {JSON.stringify(approval.requestPayload.arguments, null, 2)}
        </pre>
      </div>

      {showReject && (
        <Input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={t("approvals.rejectReasonPlaceholder")}
          className="mb-2"
          autoFocus
        />
      )}

      <div className="flex gap-2">
        <Button
          size="sm"
          variant="success"
          disabled={busy}
          onClick={() => resolve("approve")}
        >
          <Check className="size-4" />
          {t("approvals.approve")}
        </Button>
        {showReject ? (
          <Button size="sm" variant="danger" disabled={busy} onClick={() => resolve("reject")}>
            <X className="size-4" />
            {t("approvals.reject")}
          </Button>
        ) : (
          <Button size="sm" variant="outline" onClick={() => setShowReject(true)}>
            {t("approvals.reject")}
          </Button>
        )}
      </div>
    </div>
  );
}
