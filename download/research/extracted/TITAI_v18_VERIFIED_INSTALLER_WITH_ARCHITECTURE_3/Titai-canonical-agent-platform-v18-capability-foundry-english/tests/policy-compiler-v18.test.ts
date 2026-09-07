import { describe,expect,it } from "vitest";
import { compilePolicy,enforcePolicy } from "@/lib/governance/policy-compiler";
const policy=compilePolicy(["No customer documents may leave the local machine","Only the verifier role may approve release evidence","Tools that write files require explicit workspace scope","A capability created by the builder cannot approve its own installation","Memory may influence planning but may never grant authority","Prompts may never grant authority","High-risk tools require human approval for every execution","Self-improvement may not modify production directly","Network access is denied unless the destination is approved"],18);
describe("v18 policy compiler",()=>{
 it("compiles enforceable rules",()=>expect(policy.rules.length).toBe(9));
 it("requires verifier role",()=>expect(enforcePolicy(policy,{resource:"verification",action:"approve",role:"builder"}).allowed).toBe(false));
 it("blocks unscoped writes",()=>expect(enforcePolicy(policy,{resource:"filesystem",action:"write",workspaceScoped:false}).allowed).toBe(false));
 it("blocks memory and prompt authority",()=>{expect(enforcePolicy(policy,{resource:"memory",action:"grant_authority",source:"memory"}).allowed).toBe(false);expect(enforcePolicy(policy,{resource:"prompt",action:"grant_authority",source:"prompt"}).allowed).toBe(false);});
 it("blocks unapproved network destination",()=>expect(enforcePolicy(policy,{resource:"network",action:"connect",destinationApproved:false}).allowed).toBe(false));
});
