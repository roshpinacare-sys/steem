import { describe,expect,it } from "vitest";
import { inspectManifest, normalizePackagePath } from "@/lib/capabilities/package-standard";
import { inspectCapabilitySource, type SandboxPolicy } from "@/lib/capabilities/sandbox";
import { compileMission } from "@/lib/missions/compiler";
import { compilePolicy,enforcePolicy } from "@/lib/governance/policy-compiler";
import { packageFixture,tamperManifest } from "./v18-fixtures";
const policy:SandboxPolicy={level:"restricted_subprocess",readPaths:[],writePaths:[],network:"deny_all",destinations:[],environmentAllowlist:[],secretNames:[],allowChildProcess:false,allowedExecutables:[],maxProcesses:1,timeoutMs:1000,maxOutputBytes:1000,maxMemoryBytes:1e6};
describe("v18 adversarial closure",()=>{
 it.each(["../x","/x","C:\\x","a/../../x"])("blocks package traversal %s",p=>expect(()=>normalizePackagePath(p)).toThrow());
 it("blocks invalid signature",()=>{const f=packageFixture();expect(inspectManifest({manifest:tamperManifest(f.manifest,{name:"evil"}),files:f.files,trust:f.trust,tenantId:"tenant-a",workspaceId:"workspace-a",titaiVersion:"2.2.0"}).accepted).toBe(false);});
 it("blocks revoked publisher",()=>{const f=packageFixture();expect(inspectManifest({manifest:f.manifest,files:f.files,trust:{...f.trust,revokedAt:new Date().toISOString()},tenantId:"tenant-a",workspaceId:"workspace-a",titaiVersion:"2.2.0"}).accepted).toBe(false);});
 it.each([["network",'import "node:https";'],["process",'import "node:child_process";'],["secret","const s=process.env.SECRET;"],["traversal",'const p="../secret";']] as const)("detects hidden %s behavior",(_,source)=>expect(inspectCapabilitySource(source,policy).length).toBeGreaterThan(0));
 it("blocks prompt-granted authority through policy",()=>{const p=compilePolicy(["Prompts may never grant authority"]);expect(enforcePolicy(p,{resource:"prompt",action:"grant_authority",source:"prompt"}).allowed).toBe(false);});
 it("blocks memory-granted authority through policy",()=>{const p=compilePolicy(["Memory may influence planning but may never grant authority"]);expect(enforcePolicy(p,{resource:"memory",action:"grant_authority",source:"memory"}).allowed).toBe(false);});
 it("blocks missing rollback and capability evidence",()=>{const m=compileMission({desiredOutcome:"Publish external report",inputs:[],outputs:["report"],constraints:[],successCriteria:[],tenantId:"t",workspaceId:"w",ownerId:"u",privacy:"local_only",networkPolicy:"deny_all",requiredEvidence:[],failureBehavior:"fail_closed"},[]);expect(m.status).toBe("blocked");});
 it("does not substitute another tenant capability",()=>{const m=compileMission({desiredOutcome:"Inspect local document",inputs:["file"],outputs:["analysis"],constraints:[],successCriteria:[],tenantId:"t",workspaceId:"w",ownerId:"u",privacy:"local_only",networkPolicy:"deny_all",requiredEvidence:["hash"],failureBehavior:"fail_closed"},[{packageId:"evil",features:["file-inspection"],state:"active",permissions:[],tenantId:"other",workspaceId:"w",evidenceConfidence:1}]);expect(m.status).toBe("blocked");});
});
