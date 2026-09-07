import { createHash } from 'node:crypto';
const [workerId, attemptedRaw, acceptedRaw, rejectedRaw, drainedRaw] = process.argv.slice(2);
const attempted=Number(attemptedRaw),accepted=Number(acceptedRaw),rejected=Number(rejectedRaw),drained=Number(drainedRaw);
if(!workerId||![attempted,accepted,rejected,drained].every(Number.isInteger)||attempted!==accepted+rejected)throw new Error('invalid_metrics');
const metrics={workerId,attemptedOperations:attempted,acceptedOperations:accepted,rejectedOperations:rejected,drainedBacklogCount:drained};
console.log(JSON.stringify({...metrics,processId:process.pid,metricsDigest:createHash('sha256').update(JSON.stringify(metrics)).digest('hex')}));
