import { requireUser } from "@/lib/auth/session";
import {
  getRunStats,
  listActiveRuns,
  listRuns,
} from "@/lib/db/queries/runs";
import { listAgents } from "@/lib/db/queries/agents";
import { MissionControl } from "@/components/mission-control/mission-control";

export default async function MissionControlPage() {
  const user = await requireUser();
  const stats = getRunStats(user.id);
  const active = listActiveRuns(user.id);
  const recent = listRuns(user.id, 8).filter((r) =>
    ["completed", "failed", "cancelled"].includes(r.status),
  );
  const agents = listAgents(user.id);

  return (
    <MissionControl
      stats={stats}
      initialActive={active}
      initialRecent={recent}
      hasAgents={agents.length > 0}
    />
  );
}
