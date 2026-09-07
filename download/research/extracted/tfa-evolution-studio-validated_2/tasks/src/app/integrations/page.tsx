"use client";

import { useEffect, useState } from "react";
import { Shell } from "@/components/layout/Shell";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";

interface Integration {
  id: string;
  name: string;
  kind: string;
  healthStatus: string;
  enabled: boolean;
}

export default function IntegrationsPage() {
  const [integrations, setIntegrations] = useState<Integration[]>([]);

  useEffect(() => {
    fetch("/api/integrations")
      .then((r) => r.json())
      .then((d) => setIntegrations(d.integrations || []));
  }, []);

  return (
    <Shell title="Integrations" subtitle="Connectors and external service health">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {integrations.map((i) => (
          <Card key={i.id}>
            <div className="p-4">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold text-zinc-100">{i.name}</div>
                <Badge variant={i.healthStatus === "healthy" ? "success" : "danger"}>{i.healthStatus}</Badge>
              </div>
              <div className="text-xs text-zinc-500 mt-1">{i.kind}</div>
              <div className="text-xs text-zinc-500 mt-1">{i.enabled ? "Enabled" : "Disabled"}</div>
            </div>
          </Card>
        ))}
        {integrations.length === 0 && (
          <div className="text-sm text-zinc-500">No integrations configured.</div>
        )}
      </div>
    </Shell>
  );
}
