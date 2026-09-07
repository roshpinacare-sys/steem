import { FileReplayLedger } from '../platform/replay-ledger.js';
const [root, replayKey] = process.argv.slice(2);
if (root === undefined || replayKey === undefined) throw new Error('usage: replay-consume-worker <root> <key>');
const ledger = new FileReplayLedger(root);
const consumed = ledger.tryConsume({ replayKey, tenantId: 'tenant-concurrent', subjectId: 'subject-concurrent', evidenceRoot: 'a'.repeat(64), consumedAt: '2026-07-17T10:00:00.000Z', consumerId: `pid-${process.pid}` });
process.stdout.write(consumed ? 'CONSUMED\n' : 'REPLAY\n');
