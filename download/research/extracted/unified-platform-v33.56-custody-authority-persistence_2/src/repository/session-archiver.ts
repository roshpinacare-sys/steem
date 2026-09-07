import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { sha256 } from '../contracts/crypto.js';
import { ContentAddressedArtifactStore, type ArtifactRecord } from '../artifacts/content-addressed-store.js';
import { loadChangeSession } from './change-assurance.js';

export interface ArchivedChangeSession {
  readonly sessionId: string;
  readonly tenantId: string;
  readonly artifactRecords: readonly ArtifactRecord[];
  readonly archiveRoot: string;
}

export function archiveChangeSession(options: {
  readonly sessionsRoot: string;
  readonly sessionId: string;
  readonly artifactStore: ContentAddressedArtifactStore;
  readonly now?: Date;
}): ArchivedChangeSession {
  const state = loadChangeSession(options.sessionsRoot, options.sessionId);
  if (!['AWAITING_REVIEW', 'APPROVED_SHADOW', 'ROLLED_BACK'].includes(state.status)) throw new Error('session_not_archivable');
  const createdAt = options.now ?? new Date();
  const files = [
    ['change.patch', 'change-patch', 'text/x-diff'],
    ['rollback.patch', 'rollback-patch', 'text/x-diff'],
    ['test-report.json', 'test-report', 'application/json'],
    ['security-report.json', 'security-report', 'application/json'],
    ['change-manifest.json', 'change-manifest', 'application/json'],
    ['unsupported-claims.json', 'unsupported-claims', 'application/json'],
    ['human-review-checklist.md', 'human-review-checklist', 'text/markdown'],
  ] as const;
  const records: ArtifactRecord[] = [];
  for (const [filename, kind, mediaType] of files) {
    const path = join(resolve(state.artifactDirectory), filename);
    if (!existsSync(path)) throw new Error(`session_artifact_missing:${filename}`);
    records.push(options.artifactStore.put({
      tenantId: state.plan.tenantId, kind, mediaType, bytes: readFileSync(path), createdAt,
      metadata: { sessionId: state.sessionId, evidenceRoot: state.evidenceRoot ?? 'missing' },
      retention: kind === 'security-report' || kind === 'change-manifest' ? 'long-term' : 'standard',
    }));
  }
  if (state.passport !== undefined) {
    records.push(options.artifactStore.put({ tenantId: state.plan.tenantId, kind: 'action-passport', mediaType: 'application/json', bytes: Buffer.from(JSON.stringify(state.passport, null, 2)), createdAt, metadata: { sessionId: state.sessionId }, retention: 'long-term' }));
  }
  if (state.trustSnapshot !== undefined) {
    records.push(options.artifactStore.put({ tenantId: state.plan.tenantId, kind: 'trust-snapshot', mediaType: 'application/json', bytes: Buffer.from(JSON.stringify(state.trustSnapshot, null, 2)), createdAt, metadata: { sessionId: state.sessionId }, retention: 'long-term' }));
  }
  const archiveRoot = sha256(records.map((record) => ({ recordId: record.recordId, recordDigest: record.recordDigest, blobDigest: record.blobDigest })));
  return { sessionId: state.sessionId, tenantId: state.plan.tenantId, artifactRecords: records, archiveRoot };
}
