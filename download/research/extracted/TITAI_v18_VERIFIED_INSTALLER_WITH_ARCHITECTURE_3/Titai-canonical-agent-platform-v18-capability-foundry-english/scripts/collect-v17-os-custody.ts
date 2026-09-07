import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { detectOsCustodyCapabilities } from "../src/lib/sovereignty/os-key-custody";
const output=resolve(process.env.TITAI_V17_OS_CUSTODY_EVIDENCE??"docs/canonical/evidence/v17/os-custody/capabilities.json");
const capabilities=detectOsCustodyCapabilities();
const result={format:"titai-v17-os-custody-capabilities",version:1,generatedAt:new Date().toISOString(),status:capabilities.provenBackend==="none"?"blocked":"passed",capabilities,reason:capabilities.provenBackend==="none"?"No operating-system or hardware-backed custody backend was executed in this environment.":null};
mkdirSync(dirname(output),{recursive:true});writeFileSync(output,`${JSON.stringify(result,null,2)}\n`);console.log(JSON.stringify({output,status:result.status,blockers:capabilities.blockers},null,2));process.exit(result.status==="passed"?0:2);
