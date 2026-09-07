import { requireUser } from "@/lib/auth/session";
import { listAgents } from "@/lib/db/queries/agents";
import { AgentsList } from "@/components/agents/agents-list";

export default async function AgentsPage() {
  const user = await requireUser();
  return <AgentsList initial={listAgents(user.id)} />;
}
