import { auth } from "@/auth";
import { CapabilityOperatingSystem } from "@/components/capability-os/capability-operating-system";
import { resolvePilotScope } from "@/lib/auth/pilot-scope";
import { capabilitySnapshot } from "@/lib/capabilities/persistence";
export const dynamic="force-dynamic";
export default async function CapabilityOsPage(){const session=await auth();if(!session?.user?.id)return null;const scope=resolvePilotScope(session.user.id),s=capabilitySnapshot(scope);return <CapabilityOperatingSystem initial={{packages:s.packages.map(p=>({id:p.id,name:p.name,version:p.version,state:p.state})),candidates:s.candidates.map(c=>({id:c.id,name:c.name,state:c.state,reuseDecision:c.reuseDecision})),missions:s.missions.map(m=>({id:m.id,missionHash:m.missionHash,status:m.status}))}}/>;}
