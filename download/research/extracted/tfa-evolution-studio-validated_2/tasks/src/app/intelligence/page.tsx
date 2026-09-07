"use client";

import { useEffect, useState } from "react";
import { Shell } from "@/components/layout/Shell";
import { Card } from "@/components/ui/Card";

interface PortfolioSummary {
  totalProjects: number;
  totalRuns: number;
  avgPassRate: number;
  topPatterns: { pattern: string; frequency: number }[];
  recurringFailures: { pattern: string; frequency: number }[];
}

export default function IntelligencePage() {
  const [summary, setSummary] = useState<PortfolioSummary | null>(null);

  useEffect(() => {
    fetch("/api/intelligence")
      .then((r) => r.json())
      .then((d) => setSummary(d.summary || null));
  }, []);

  return (
    <Shell title="Intelligence" subtitle="Cross-project patterns and portfolio insights">
      {summary && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <div className="p-4">
                <div className="text-xs text-zinc-500">Projects</div>
                <div className="text-xl font-semibold text-zinc-100">{summary.totalProjects}</div>
              </div>
            </Card>
            <Card>
              <div className="p-4">
                <div className="text-xs text-zinc-500">Total Runs</div>
                <div className="text-xl font-semibold text-zinc-100">{summary.totalRuns}</div>
              </div>
            </Card>
            <Card>
              <div className="p-4">
                <div className="text-xs text-zinc-500">Avg Pass Rate</div>
                <div className="text-xl font-semibold text-zinc-100">
                  {(summary.avgPassRate * 100).toFixed(0)}%
                </div>
              </div>
            </Card>
          </div>

          <div>
            <div className="text-sm font-semibold text-zinc-100 mb-3">Top Patterns</div>
            <div className="space-y-2">
              {summary.topPatterns.map((p, i) => (
                <Card key={i}>
                  <div className="p-3 text-sm text-zinc-300">{p.pattern}</div>
                </Card>
              ))}
              {summary.topPatterns.length === 0 && (
                <div className="text-sm text-zinc-500">No patterns detected yet.</div>
              )}
            </div>
          </div>
        </div>
      )}
      {!summary && <div className="text-sm text-zinc-500">Loading portfolio summary...</div>}
    </Shell>
  );
}
