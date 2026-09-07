import { mkdirSync, writeFileSync } from 'node:fs';
const OUT='evidence/generated';mkdirSync(OUT,{recursive:true});
const tasks=[
 {id:'P30-01',task:'Turn a broad engineering objective into a bounded five-perspective campaign',success:'operator identifies scope, authority, budgets and stop conditions without hidden execution'},
 {id:'P30-02',task:'Resolve a disagreement between security and product perspectives',success:'conflict remains visible and blocks planning until evidence or human decision resolves it'},
 {id:'P30-03',task:'Review and approve a campaign item',success:'two independent signed reviewers bind status and evidence digest'},
 {id:'P30-04',task:'Resume a campaign after restart',success:'receipts and progress are reused without repeated model calls or lost state'},
 {id:'P30-05',task:'Recover from concurrent result submissions',success:'no lost update and the operator can explain the final snapshot'},
 {id:'P30-06',task:'Reject an unsupported completion claim',success:'missing proof obligations prevent completion'},
 {id:'P30-07',task:'Use the action center to identify the next permitted step',success:'operator distinguishes local proof from external production blockers'}
];
const report={version:'32.0',status:'protocol-ready-not-executed',minimumParticipantsForAggregate:5,comparisonDesign:'within-subject manual-workflow versus governed-campaign workflow with counterbalanced order',tasks,metrics:['task completion time','operator decisions','critical errors','evidence comprehension','authority comprehension','conflict resolution quality','override rate','recovery time','model calls avoided after restart'],requiredEvidence:['informed consent','task timestamps','critical-error records','comprehension answers','campaign receipts','moderator notes stored separately'],stopConditions:['any privacy breach','participant cannot distinguish proposal from execution','critical authority misunderstanding','test data escapes the isolated pilot environment'],limitations:['No human participant was observed in this environment.','Modeled workflow reductions are not pilot results.','Five participants is a minimum mechanism/usability signal, not market validation.']};
writeFileSync(`${OUT}/V32_HUMAN_PILOT_PROTOCOL.json`,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,tasks:tasks.length,minimumParticipants:report.minimumParticipantsForAggregate},null,2));
