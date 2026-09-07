import { readFileSync } from 'node:fs';
import { MonotonicTrustCheckpointStore } from '../security/trust-checkpoint-store.js';
import type { TrustSnapshot } from '../security/key-lifecycle.js';

const [file, snapshotFile, tenantId, channel] = process.argv.slice(2);
if (!file || !snapshotFile || !tenantId || !channel) throw new Error('usage: worker <store> <snapshot> <tenant> <channel>');
const snapshot = JSON.parse(readFileSync(snapshotFile, 'utf8')) as TrustSnapshot;
const result = new MonotonicTrustCheckpointStore(file).apply({ tenantId, channel, snapshot, approvedBy: ['custodian-a','custodian-b'] });
process.stdout.write(`${JSON.stringify(result)}\n`);
