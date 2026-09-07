import { SqliteRuntimeStore } from '../runtime/sqlite-store.js';

const [databasePath, outboxId, missionId, workerId, fenceText, nowText] = process.argv.slice(2);
if ([databasePath, outboxId, missionId, workerId, fenceText, nowText].some((value) => value === undefined)) {
  throw new Error('usage: crash-worker <db> <outbox> <mission> <worker> <fence> <now-ms>');
}
const store = new SqliteRuntimeStore(databasePath!);
try {
  const outbox = store.getOutbox(outboxId!);
  store.recordEffect(outbox.outboxId, {
    missionId: missionId!,
    workerId: workerId!,
    fenceToken: Number(fenceText),
    expiresAt: Number(nowText) + 30_000,
  }, { appliedBy: 'crash-worker' }, new Date(Number(nowText)));
  process.stdout.write(JSON.stringify({ effectRecorded: true, effectKey: outbox.effectKey }));
  process.exitCode = 17;
} finally {
  store.close();
}
