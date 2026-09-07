"use client";

import { useEffect, useState } from "react";
import { Shell } from "@/components/layout/Shell";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";

interface Approval {
  id: string;
  action: string;
  status: string;
  requestedAt: string;
}

export default function GovernancePage() {
  const [approvals, setApprovals] = useState<Approval[]>([]);

  useEffect(() => {
    fetch("/api/governance/approvals")
      .then((r) => r.json())
      .then((d) => setApprovals(d.approvals || []));
  }, []);

  return (
    <Shell title="Governance" subtitle="Approval gates and audit trails">
      <div className="space-y-4">
        <div className="text-sm font-semibold text-zinc-100">Pending Approvals</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {approvals.map((a) => (
            <Card key={a.id}>
              <div className="p-4">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold text-zinc-100">{a.action}</div>
                  <Badge variant={a.status === "approved" ? "success" : a.status === "rejected" ? "danger" : "warning"}>
                    {a.status}
                  </Badge>
                </div>
                <div className="text-xs text-zinc-500 mt-1">
                  {new Date(a.requestedAt).toLocaleString()}
                </div>
              </div>
            </Card>
          ))}
          {approvals.length === 0 && (
            <div className="text-sm text-zinc-500">No approvals recorded.</div>
          )}
        </div>
      </div>
    </Shell>
  );
}
