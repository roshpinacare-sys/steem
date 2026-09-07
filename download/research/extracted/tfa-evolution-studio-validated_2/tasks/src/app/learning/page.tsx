"use client";

import { useEffect, useState } from "react";
import { Shell } from "@/components/layout/Shell";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";

interface Lesson {
  id: string;
  title: string;
  category: string;
  occurrences: number;
  resolved: boolean;
}

export default function LearningPage() {
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [projectId, setProjectId] = useState("demo");

  useEffect(() => {
    if (!projectId) return;
    fetch(`/api/learning/${projectId}`)
      .then((r) => r.json())
      .then((d) => setLessons(d.lessons || []));
  }, [projectId]);

  return (
    <Shell title="Learning" subtitle="Lessons and patterns distilled from cycles">
      <div className="mb-4">
        <input
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          placeholder="Project ID"
          className="rounded-md bg-zinc-900 border border-zinc-700 px-3 py-2 text-sm text-zinc-100"
        />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {lessons.map((l) => (
          <Card key={l.id}>
            <div className="p-4">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold text-zinc-100">{l.title}</div>
                <Badge variant={l.resolved ? "success" : "warning"}>{l.resolved ? "Resolved" : "Open"}</Badge>
              </div>
              <div className="text-xs text-zinc-500 mt-1">
                {l.category} · {l.occurrences} occurrence{l.occurrences > 1 ? "s" : ""}
              </div>
            </div>
          </Card>
        ))}
        {lessons.length === 0 && (
          <div className="text-sm text-zinc-500">No lessons for this project.</div>
        )}
      </div>
    </Shell>
  );
}
