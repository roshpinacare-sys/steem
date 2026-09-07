"use client";

import { useEffect, useState } from "react";
import { Shell } from "@/components/layout/Shell";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";

interface Rule {
  id: string;
  name: string;
  enabled: boolean;
  trigger: { event: string };
}

export default function AutomationPage() {
  const [rules, setRules] = useState<Rule[]>([]);

  useEffect(() => {
    fetch("/api/automation")
      .then((r) => r.json())
      .then((d) => setRules(d.rules || []));
  }, []);

  return (
    <Shell title="Automation" subtitle="Event-driven rules and actions">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {rules.map((r) => (
          <Card key={r.id}>
            <div className="p-4">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold text-zinc-100">{r.name}</div>
                <Badge variant={r.enabled ? "success" : "default"}>{r.enabled ? "On" : "Off"}</Badge>
              </div>
              <div className="text-xs text-zinc-500 mt-1">Trigger: {r.trigger.event}</div>
            </div>
          </Card>
        ))}
        {rules.length === 0 && (
          <div className="text-sm text-zinc-500">No automation rules defined.</div>
        )}
      </div>
    </Shell>
  );
}
