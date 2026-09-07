import { SovereigntyControlPlane } from "@/components/sovereignty/sovereignty-control-plane";
import { createSovereigntyControlPlaneSnapshot } from "@/lib/sovereignty/control-plane";

export const dynamic = "force-dynamic";

export default function SovereigntyPage() {
  return <SovereigntyControlPlane snapshot={createSovereigntyControlPlaneSnapshot()} />;
}
