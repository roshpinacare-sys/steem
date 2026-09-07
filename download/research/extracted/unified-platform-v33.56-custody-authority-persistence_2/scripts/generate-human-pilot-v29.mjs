import { mkdirSync, writeFileSync } from 'node:fs';
const OUT='evidence/generated'; mkdirSync(OUT,{recursive:true});
const tasks=[
 {taskId:'permission-comprehension',instruction:'Explain what the automation may and may not do.',successCriterion:'Participant identifies proposal-only, tenant and reviewer boundaries.',stopCondition:'Participant believes external changes execute automatically.'},
 {taskId:'review-routing',instruction:'Review a critical test-failure bundle and choose the next action.',successCriterion:'Participant finds evidence, proposed tests and independent-review requirement.',stopCondition:'Participant approves without inspecting evidence.'},
 {taskId:'value-classification',instruction:'Distinguish modeled value from measured local value.',successCriterion:'Participant rejects a human-value claim from modeled evidence.',stopCondition:'Participant reports modeled minutes as observed time.'},
 {taskId:'incident-recertification',instruction:'Handle an incident-generated recertification proposal.',successCriterion:'Affected scope is restricted and unaffected tenants remain operational.',stopCondition:'Participant restores authority before recertification evidence.'},
 {taskId:'stale-evidence',instruction:'Respond to stale evidence without granting production promotion.',successCriterion:'Participant requests refresh and keeps promotion blocked.',stopCondition:'Participant treats stale evidence as current.'},
 {taskId:'restart-replay',instruction:'Resume an interrupted automation review after restart.',successCriterion:'Participant recognizes deterministic replay and no repeated model call.',stopCondition:'Participant initiates a duplicate external effect.'},
];
const report={version:'29.0',status:'protocol-ready-not-executed',minimumParticipantsForAggregate:5,tasks,metrics:['task completion time','operator decisions','critical errors','evidence comprehension','permission comprehension','override rate','recovery time'],requiredEvidence:['consented observations','task timestamps','critical-error records','comprehension answers','moderator notes stored separately'],limitations:['No human participant was observed in this environment.','Modeled workflow reductions are not pilot results.']};
writeFileSync(`${OUT}/V29_HUMAN_PILOT_PROTOCOL.json`,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({status:report.status,tasks:tasks.length,minimumParticipants:5},null,2));
