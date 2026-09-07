"use client";

import { useEffect, useState } from "react";
import { Shell } from "@/components/layout/Shell";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";

interface Project {
  id: string;
  name: string;
  status: string;
  createdAt: string;
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);

  useEffect(() => {
    fetch("/api/projects")
      .then((r) => r.json())
      .then((d) => setProjects(d.projects || []))
      .catch(() => setProjects([]));
  }, []);

  return (
    <Shell title="Projects" subtitle="Manage and explore all platform projects">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {projects.map((p) => (
          <Card key={p.id}>
            <div className="p-4">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold text-zinc-100">{p.name}</div>
                <Badge variant={p.status === "completed" ? "success" : "default"}>{p.status}</Badge>
              </div>
              <div className="text-xs text-zinc-500 mt-2">{p.id}</div>
            </div>
          </Card>
        ))}
        {projects.length === 0 && (
          <div className="text-sm text-zinc-500">No projects yet. Create one via the API.</div>
        )}
      </div>
    </Shell>
  );
}
