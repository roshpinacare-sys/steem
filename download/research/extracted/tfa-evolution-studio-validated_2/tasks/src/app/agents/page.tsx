"use client";

import { useEffect, useState } from "react";
import { Shell } from "@/components/layout/Shell";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Users, Cog, ShieldCheck, Package } from "lucide-react";

type Agent = { role: string; layer: "executive" | "engineering" | "quality" | "release"; title: string; responsibility: string };

const LAYER_META: Record<string, { label: string; Icon: typeof Users; color: string }> = {
  executive: { label: "Executive Layer", Icon: Users, color: "text-purple-300" },
  engineering: { label: "Engineering Layer", Icon: Cog, color: "text-blue-300" },
  quality: { label: "Quality Layer", Icon: ShieldCheck, color: "text-green-300" },
  release: { label: "Release Layer", Icon: Package, color: "text-amber-300" },
};

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  useEffect(() => { fetch("/api/agents").then((r) => r.json()).then((d) => setAgents(d.agents)); }, []);

  const byLayer = (l: string) => agents.filter((a) => a.layer === l);

  return (
    <Shell title="Agent Organization" subtitle="The autonomous software development team">
      <div className="space-y-8">
        {(["executive", "engineering", "quality", "release"] as const).map((layer) => {
          const meta = LAYER_META[layer];
          const Icon = meta.Icon;
          const ags = byLayer(layer);
          return (
            <div key={layer}>
              <div className="flex items-center gap-3 mb-3">
                <Icon className={`h-5 w-5 ${meta.color}`} />
                <h3 className="text-lg font-semibold text-studio-text">{meta.label}</h3>
                <Badge>{ags.length}</Badge>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {ags.map((a) => (
                  <Card key={a.role}>
                    <div className="p-4">
                      <div className="text-sm font-semibold text-studio-text">{a.title}</div>
                      <div className="text-[10px] font-mono text-studio-muted mt-0.5">{a.role}</div>
                      <p className="text-xs text-studio-muted mt-3 leading-relaxed">{a.responsibility}</p>
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </Shell>
  );
}
