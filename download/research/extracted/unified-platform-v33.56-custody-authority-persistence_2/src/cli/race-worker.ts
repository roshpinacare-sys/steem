import { SqliteRuntimeStore } from '../runtime/sqlite-store.js';

const [databasePath, missionId, workerId, nowText] = process.argv.slice(2);
let store: SqliteRuntimeStore | undefined;
try {
  if (databasePath === undefined || missionId === undefined || workerId === undefined || nowText === undefined) {
    throw new Error('usage: race-worker <db> <mission> <worker> <now-ms>');
  }
  store = new SqliteRuntimeStore(databasePath);
  const lease = store.acquireLease(missionId, workerId, 30_000, Number(nowText));
  const outbox = store.prepareOutbox(lease, { capability: 'race-proof' }, Number(nowText));
  process.stdout.write(JSON.stringify({ ok: true, lease, outbox }));
} catch (error) {
  process.stdout.write(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
} finally {
  store?.close();
}
