import { describe,expect,it } from "vitest";
import { executeRestrictedJavascript, inspectCapabilitySource, type SandboxPolicy } from "@/lib/capabilities/sandbox";
const policy:SandboxPolicy={level:"restricted_subprocess",readPaths:[],writePaths:[],network:"deny_all",destinations:[],environmentAllowlist:[],secretNames:[],allowChildProcess:false,allowedExecutables:[],maxProcesses:1,timeoutMs:3000,maxOutputBytes:10000,maxMemoryBytes:128*1024*1024};
describe("v18 capability sandbox",()=>{
 it("executes bounded local code",async()=>{const r=await executeRestrictedJavascript({source:'export async function capabilityMain(input){return {value:input.value,sideEffect:false};}',input:{value:7},policy});expect(r.output).toEqual({value:7,sideEffect:false});expect(r.receipt.sideEffect).toBe(false);});
 it("detects network imports",()=>expect(inspectCapabilitySource('import "node:http";',policy).some(x=>x.code==="network_access")).toBe(true));
 it("detects child processes",()=>expect(inspectCapabilitySource('import "node:child_process";',policy).some(x=>x.code==="child_process")).toBe(true));
 it("detects environment access",()=>expect(inspectCapabilitySource('const x=process.env.SECRET;',policy).some(x=>x.code==="environment_access")).toBe(true));
 it("detects traversal",()=>expect(inspectCapabilitySource('const p="../secret";',policy).some(x=>x.code==="path_traversal")).toBe(true));
 it("rejects statically unsafe execution",async()=>await expect(executeRestrictedJavascript({source:'import "node:net"; export async function capabilityMain(){return {}}',input:{},policy})).rejects.toThrow("sandbox_static_rejection"));
});
