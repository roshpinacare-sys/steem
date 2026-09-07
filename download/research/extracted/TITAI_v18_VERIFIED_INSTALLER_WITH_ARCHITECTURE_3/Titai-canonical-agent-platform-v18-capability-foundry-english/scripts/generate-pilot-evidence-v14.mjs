import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
const root=process.cwd(), out=resolve(root,"docs/canonical/evidence/v14");mkdirSync(out,{recursive:true});
const sha=(b)=>createHash("sha256").update(b).digest("hex");
const json=(file)=>{const p=resolve(root,file);if(!existsSync(p))return null;try{return JSON.parse(readFileSync(p,"utf8"));}catch{return null;}};
const exists=(file)=>existsSync(resolve(root,file));
const files=[
 "docs/canonical/evidence/v14/test-full.log","docs/canonical/evidence/v14/build-production.log","docs/canonical/evidence/v14/build-production.json",
 "docs/canonical/evidence/v14/pilot-failure-matrix.json","docs/canonical/evidence/v14/multiprocess-lease-proof.json",
 "docs/canonical/evidence/v14/approval-restart-process-proof.json","docs/canonical/evidence/v14/multiprocess-outbox-proof.json",
 "docs/canonical/evidence/v14/database-lock-proof.json","docs/canonical/evidence/v14/disk-full-proof.json",
 "docs/canonical/evidence/v14/clean-restore-proof.json","docs/canonical/evidence/v14/browser-policy-block.json",
 "docs/canonical/evidence/v13/mutation-probes.json","docs/canonical/evidence/durable-vertical-slice.json"
];
const artifacts=files.filter(exists).map(file=>{const b=readFileSync(resolve(root,file));return{path:relative(root,resolve(root,file)).replaceAll("\\","/"),sha256:sha(b),bytes:b.length};});
const matrix=json("docs/canonical/evidence/v14/pilot-failure-matrix.json"); const build=json("docs/canonical/evidence/v14/build-production.json"); const lease=json("docs/canonical/evidence/v14/multiprocess-lease-proof.json"); const approval=json("docs/canonical/evidence/v14/approval-restart-process-proof.json"); const outbox=json("docs/canonical/evidence/v14/multiprocess-outbox-proof.json"); const restore=json("docs/canonical/evidence/v14/clean-restore-proof.json"); const browser=json("docs/canonical/evidence/v14/browser-policy-block.json"); const mutations=json("docs/canonical/evidence/v13/mutation-probes.json");
const gates={
 canonicalIntegrity:{state:exists("docs/canonical/evidence/v14/gates/canonical.pass")?"pass":"unknown"},
 languageAndSourceAudit:{state:exists("docs/canonical/evidence/v14/gates/language.pass")&&exists("docs/canonical/evidence/v14/gates/lint.pass")?"pass":"unknown"},
 completeTestSuite:{state:exists("docs/canonical/evidence/v14/test-full.pass")?"pass":"unknown",evidence:"node:sqlite complete repository suite"},
 canonicalMigrations:{state:exists("tests/canonical-migrations.test.ts")&&exists("docs/canonical/evidence/v14/gates/migrations.pass")?"pass":"unknown"},
 productionBuild:{state:build?.exitCode===0?"pass":build?"fail":"unknown",evidence:build},
 persistenceFallback:{state:exists("docs/canonical/evidence/v14/gates/persistence.pass")?"pass":"unknown"},
 durableCrashRecovery:{state:exists("docs/canonical/evidence/durable-vertical-slice.json")?"pass":"unknown"},
 multiProcessLeaseAndFencing:{state:lease?.passed?"pass":"unknown"},
 restartProofApproval:{state:approval?.passed?"pass":"unknown"},
 duplicateSafeOutbox:{state:outbox?.passed?"pass":"unknown"},
 cleanEncryptedRestore:{state:restore?.passed?"pass":"unknown"},
 mutationThreshold:{state:mutations?.summary?.killed===mutations?.summary?.total&&mutations?.summary?.total>=10?"pass":"unknown",evidence:mutations?.summary??null},
 failureMatrix:{state:matrix?.summary?.blocked===0?"pass":matrix?"partial":"unknown",evidence:matrix?.summary??null},
 browserE2e:{state:browser?.status==="environment_blocked"?"blocked_environment":"unknown",evidence:browser},
 accessibilityAndVisualRegression:{state:"blocked_environment",evidence:"managed Chromium policy blocks localhost"},
 independentFinalVerification:{state:"pending_final_zip"},
};
const blocking=Object.values(gates).filter(g=>g.state!=="pass").length;
const report={schemaVersion:3,generatedAt:new Date().toISOString(),pilotScope:"bounded local artifact workflow in a personal tenant/workspace",releaseClassification:blocking===0?"CONTROLLED INTERNAL PILOT":"DEVELOPMENT ONLY",blockingGates:blocking,gates,artifacts};
writeFileSync(resolve(out,"pilot-evidence-bundle.json"),JSON.stringify(report,null,2)+"\n");console.log(`v14 pilot evidence: ${report.releaseClassification}; ${blocking} blocking gate(s).`);
