import { describe,expect,it } from "vitest";
import { buildCases,runEvaluation } from "@/lib/evaluation/lab";
describe("v18 evaluation lab",()=>{
 it("runs version-bound benchmark suites",async()=>{const cases=buildCases("mission",30,"mission-compile");const r=await runEvaluation({suiteId:"mission",revision:"18",cases,execute:async x=>x,score:(out,expected)=>({passed:(out as {index:number}).index===expected.index,score:1}),environment:"test",codeRevision:"v18",policyRevision:"18"});expect(r.summary.cases).toBe(30);expect(r.summary.passRate).toBe(1);expect(r.datasetHash).toHaveLength(64);});
 it("records failures without aborting the suite",async()=>{const r=await runEvaluation({suiteId:"fail",revision:"1",cases:buildCases("f",2,"x"),execute:async x=>{if(x.index===1)throw new Error("failure");return x;},score:()=>({passed:true,score:1}),environment:"test",codeRevision:"v18"});expect(r.summary.passed).toBe(1);});
});
