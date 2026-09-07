import { describe,expect,it } from "vitest";
import { compileMission, type MissionIntent } from "@/lib/missions/compiler";
const intent=(patch:Partial<MissionIntent>={}):MissionIntent=>({desiredOutcome:"Inspect local PDF files and create a report",inputs:["local files"],outputs:["report artifact"],constraints:["No external network"],successCriteria:["Report produced"],tenantId:"tenant-a",workspaceId:"workspace-a",ownerId:"user-a",privacy:"local_only",networkPolicy:"deny_all",approvals:["file write"],requiredEvidence:["artifact hash"],failureBehavior:"fail_closed",...patch});
const caps=[{packageId:"doc",features:["file-inspection","report-generation"],state:"active" as const,permissions:["filesystem.read","filesystem.write"],tenantId:"tenant-a",workspaceId:"workspace-a",evidenceConfidence:.95}];
describe("v18 mission compiler",()=>{
 it("compiles a stable reviewable mission",()=>{const a=compileMission(intent(),caps),b=compileMission(intent(),caps);expect(a.status).toBe("draft");expect(a.steps[1].approvalRequired).toBe(true);expect(a.semanticDiff.length).toBeGreaterThan(3);expect(a.missionHash).not.toBe(b.missionHash);expect(a.steps[1].idempotencyKey).toBe(b.steps[1].idempotencyKey);});
 it("does not interpret an offline prohibition as external authority",()=>expect(compileMission(intent(),caps).findings.some(x=>x.code==="network_policy_conflict")).toBe(false));
 it("blocks missing capabilities",()=>{const m=compileMission(intent(),[]);expect(m.status).toBe("blocked");expect(m.gaps.some(g=>g.resolution==="create")).toBe(true);});
 it("excludes cross tenant capability",()=>{const m=compileMission(intent(),[{...caps[0],tenantId:"tenant-b"}]);expect(m.status).toBe("blocked");expect(m.findings.some(x=>x.code==="cross_tenant_capability_ignored")).toBe(true);});
 it("blocks external action under deny all",()=>{const m=compileMission(intent({desiredOutcome:"Upload the report to an external API",constraints:[]}),caps);expect(m.findings.some(x=>x.code==="network_policy_conflict")).toBe(true);});
});
