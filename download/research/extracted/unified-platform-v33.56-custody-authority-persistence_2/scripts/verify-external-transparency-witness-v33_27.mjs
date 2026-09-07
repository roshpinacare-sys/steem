import { readFileSync } from 'node:fs';
import { KeyRegistry, sha256 } from '../dist/src/contracts/crypto.js';
import { verifySignedProgramParameterLedgerV33_27 } from '../dist/src/app/external-transparency-witness-v33_27.js';
const load=(name)=>JSON.parse(readFileSync(`release-evidence/v33.27/${name}`,'utf8'));
const keys=load('V33_27_PROOF_PUBLIC_KEYS.json'); const registry=new KeyRegistry(); for(const key of keys) registry.registerExported(key);
const ledger=load('V33_27_PARAMETER_LEDGER.json'); verifySignedProgramParameterLedgerV33_27(ledger,registry,[ledger.issuerKeyId],new Date('2026-07-22T04:00:00.000Z'));
for(const name of ['V33_27_EXTERNAL_WITNESS_PROOF.json','V33_27_WITNESS_GOSSIP_TRACE.json','V33_27_EXTERNAL_QUALIFICATION_VERDICT.json','V33_27_SPLIT_VIEW_VERDICT.json']){const item=load(name);if(!registry.verifyAt(item,new Date('2026-07-22T04:00:00.000Z')))throw new Error(`signature_invalid:${name}`);const field=Object.keys(item.payload).find(k=>k.endsWith('Digest'));if(!field)throw new Error(`digest_missing:${name}`);const material={...item.payload};const digest=material[field];delete material[field];if(sha256(material)!==digest)throw new Error(`digest_invalid:${name}`);}
const proof=load('V33_27_EXTERNAL_WITNESS_PROOF.json').payload; const verdict=load('V33_27_EXTERNAL_QUALIFICATION_VERDICT.json').payload; const split=load('V33_27_SPLIT_VIEW_VERDICT.json').payload;
if(proof.parameterCount!==14||proof.preservedParameters!==8||proof.strengthenedParameters!==3||proof.externalEvidencePendingParameters!==3)throw new Error('parameter_counts_invalid');
if(verdict.status!=='EXTERNAL_WITNESS_AND_SCANNER_OPERATOR_QUALIFICATION_REQUIRED'||verdict.liveScannerReceiptCount!==0||verdict.liveWitnessObservationCount!==0)throw new Error('qualification_boundary_invalid');
if(split.status!=='SPLIT_VIEW_DETECTED_QUARANTINE'||split.splitViewDetected!==true)throw new Error('split_view_boundary_invalid');
console.log(JSON.stringify({status:'passed',parameterLedgerVerified:true,qualification:verdict.status,splitView:split.status},null,2));
