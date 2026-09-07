import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { evaluateSarifSecurityEvidence, evaluateAttestationEvidence } from '../dist/src/validation/security-evidence-import.js';
import { evaluatePolicyEvidence, evaluateFormalModelEvidence, evaluateFuzzEvidence } from '../dist/src/validation/policy-formal-fuzz-assurance.js';
const [type,inputPath,expectedPath,outputPath]=process.argv.slice(2);
if(!type||!inputPath||!expectedPath||!outputPath)throw new Error('usage: TYPE INPUT EXPECTED OUTPUT');
const input=JSON.parse(readFileSync(resolve(inputPath),'utf8'));
const expected=JSON.parse(readFileSync(resolve(expectedPath),'utf8'));
let result;
switch(type){
  case 'SARIF': result=evaluateSarifSecurityEvidence(input,expected); break;
  case 'ATTESTATION': result=evaluateAttestationEvidence(input,expected); break;
  case 'POLICY': result=evaluatePolicyEvidence(input,expected); break;
  case 'FORMAL_MODEL': result=evaluateFormalModelEvidence(input,expected); break;
  case 'FUZZ': result=evaluateFuzzEvidence(input,expected); break;
  default: throw new Error(`unsupported_evidence_type:${type}`);
}
const report={version:'32.9',evidenceType:type,executionBoundary:'FILE_ONLY_NO_NETWORK_NO_RUNTIME_AUTHORITY',...result};
writeFileSync(resolve(outputPath),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({type,status:result.status,reportDigest:result.reportDigest}));
if(result.status!=='PASS')process.exit(2);
