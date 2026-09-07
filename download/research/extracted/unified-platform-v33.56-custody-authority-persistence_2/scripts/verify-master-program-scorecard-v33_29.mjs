import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { KeyRegistry, sha256 } from '../dist/src/contracts/crypto.js';
import { verifyMasterProgramScorecardV33_29, verifyStrategicRebalanceVerdictV33_29 } from '../dist/src/app/master-program-scorecard-v33_29.js';
const read=(n)=>JSON.parse(readFileSync(resolve('release-evidence/v33.29',n),'utf8'));
const keys=read('V33_29_PROOF_PUBLIC_KEYS.json'); const registries=new Map();
for(const item of keys){const r=new KeyRegistry();r.registerExported(item);registries.set(item.role,r);}
const scorecard=read('V33_29_MASTER_PROGRAM_SCORECARD.json'); const ledger=read('V33_29_PARAMETER_LEDGER.json'); const verdict=read('V33_29_STRATEGIC_REBALANCE_VERDICT.json'); const plan=read('V33_29_PRIORITY_EXECUTION_PLAN.json'); const proof=read('V33_29_MASTER_SCORECARD_PROOF.json');
verifyMasterProgramScorecardV33_29({scorecard,registry:registries.get('scorecard'),trustedSignerIds:[scorecard.issuerKeyId]});
verifyStrategicRebalanceVerdictV33_29({verdict,registry:registries.get('verdict'),trustedSignerIds:[verdict.issuerKeyId],expectedScorecardDigest:scorecard.payload.scorecardDigest,expectedParameterLedgerDigest:ledger.payload.ledgerDigest});
const verifyGeneric=(envelope,role,digestField)=>{const r=registries.get(role);if(!r||!r.verify(envelope))throw new Error(`${role}_signature_invalid`);const {[digestField]:digest,...material}=envelope.payload;if(sha256(material)!==digest)throw new Error(`${role}_digest_invalid`);};
verifyGeneric(ledger,'parameter','ledgerDigest');verifyGeneric(plan,'plan','planDigest');verifyGeneric(proof,'proof','proofDigest');
if(scorecard.payload.metricCount!==54||scorecard.payload.historicalScorecardStatus!=='HISTORICAL_BASELINE_ONLY_RESCORING_REQUIRED')throw new Error('scorecard_semantics_invalid');
if(verdict.payload.status!=='LOCAL_ASSURANCE_STRONG_EXTERNAL_PRODUCT_MARKET_CRITICAL_GAP'||verdict.payload.localSecurityFeatureExpansionAllowed!==false)throw new Error('rebalance_semantics_invalid');
if(proof.payload.externalProgress.buyerInterviews!==0||proof.payload.externalProgress.paidPilots!==0||proof.payload.productionPromotion!=='blocked')throw new Error('external_boundary_invalid');
console.log(JSON.stringify({status:'passed',metricCount:54,parameterCount:14,strategicVerdict:verdict.payload.status,priorityOrder:plan.payload.priorityOrder,productionPromotion:'blocked'},null,2));
