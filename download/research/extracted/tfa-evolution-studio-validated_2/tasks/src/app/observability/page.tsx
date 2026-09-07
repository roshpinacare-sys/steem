"use client";

import { useEffect, useState } from "react";
import { Shell } from "@/components/layout/Shell";
import { Card } from "@/components/ui/Card";

interface Event {
  id: string;
  type: string;
  timestamp: string;
}

export default function ObservabilityPage() {
  const [events, setEvents] = useState<Event[]>([]);

  useEffect(() => {
    fetch("/api/events/global")
      .then((r) => r.json())
      .then((d) => setEvents(d.events || []));
  }, []);

  return (
    <Shell title="Observability" subtitle="Platform events and traces">
      <div className="space-y-2">
        {events.slice(0, 50).map((e) => (
          <Card key={e.id}>
            <div className="p-3 flex items-center justify-between">
              <div className="text-sm text-zinc-300">{e.type}</div>
              <div className="text-xs text-zinc-500">{new Date(e.timestamp).toLocaleString()}</div>
            </div>
          </Card>
        ))}
        {events.length === 0 && (
          <div className="text-sm text-zinc-500">No events recorded yet.</div>
        )}
      </div>
    </Shell>
  );
}
