import https from 'node:https';
import { createHash } from 'node:crypto';
import { closeSync, fsyncSync, mkdirSync, openSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { KeyRegistry, generateSigningIdentity, sha256, signEnvelope } from '../dist/src/contracts/crypto.js';
import {
  createDurableMonitorRetrievalReceiptV33_36,
  createMonitorGossipStatementV33_36,
  createMonitorPartitionStatementV33_36,
  createReplacementMonitorActivationV33_36,
} from '../dist/src/app/external-https-monitor-qualification-v33_36.js';
const config = JSON.parse(Buffer.from(process.argv[2], 'base64url').toString('utf8'));
const identity = generateSigningIdentity(config.keyId);
const keys = new KeyRegistry(); keys.register(identity.keyId, identity.publicKey);
const descriptor = { keyId: identity.keyId, keyFingerprint: keys.fingerprint(identity.keyId), organizationId: config.organizationId, hostId: config.hostId, administratorId: config.administratorId };
process.send?.({ type: 'ready', pid: process.pid, descriptor, publicKey: keys.exportPublicKey(identity.keyId) });
function fetchPinned(endpointUri, expectedPin) {
  return new Promise((resolve, reject) => {
    const req = https.get(endpointUri, { rejectUnauthorized: false, minVersion: 'TLSv1.3', maxVersion: 'TLSv1.3', servername: new URL(endpointUri).hostname }, (res) => {
      const certificate = res.socket.getPeerCertificate(true);
      const raw = certificate.raw;
      const pin = raw ? createHash('sha256').update(raw).digest('hex') : '';
      const protocol = res.socket.getProtocol();
      const chunks = [];
      res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      res.on('end', () => resolve({ bytes: Buffer.concat(chunks), status: res.statusCode, pin, protocol }));
    });
    req.on('error', reject);
  });
}
function durableWrite(path, bytes) {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.tmp-${process.pid}`;
  const fd = openSync(temp, 'w', 0o600); writeFileSync(fd, bytes); fsyncSync(fd); closeSync(fd); renameSync(temp, path);
  const dirFd = openSync(dirname(path), 'r'); fsyncSync(dirFd); closeSync(dirFd);
}
process.on('message', async (message) => {
  try {
    if (message?.type === 'fetch') {
      const fetched = await fetchPinned(message.publication.payload.endpointUri, message.publication.payload.certificateSha256);
      if (fetched.pin !== message.publication.payload.certificateSha256) throw new Error('worker_tls_pin_mismatch');
      durableWrite(message.durablePath, fetched.bytes);
      const receipt = createDurableMonitorRetrievalReceiptV33_36({ monitor: identity, monitorDescriptor: descriptor, monitorId: config.monitorId, monitorSetVersion: message.monitorSetVersion, publication: message.publication, content: fetched.bytes, observedCertificateSha256: fetched.pin, observedTlsProtocol: fetched.protocol, httpStatus: fetched.status, processId: process.pid, timeAttestations: message.timeAttestations, durableStoreId: config.durableStoreId, durableStorePath: message.durablePath, durableFileBytes: fetched.bytes, fsyncObserved: true, observedAt: new Date(message.observedAt), topology: 'LOCAL_HTTPS_REHEARSAL', externalHostEvidenceDigest: null });
      process.send?.({ type: 'retrieval', receipt, bytesBase64: fetched.bytes.toString('base64') });
    } else if (message?.type === 'gossip') {
      const own = message.retrievals.find((row) => row.payload.monitorKeyId === identity.keyId);
      const gossip = createMonitorGossipStatementV33_36({ monitor: identity, monitorDescriptor: descriptor, monitors: message.monitors, monitorSetVersion: message.monitorSetVersion, retrieval: own, peerRetrievals: message.retrievals, observedAt: new Date(message.observedAt) });
      process.send?.({ type: 'gossip', gossip });
    } else if (message?.type === 'partition') {
      const statement = createMonitorPartitionStatementV33_36({ observer: identity, observerDescriptor: descriptor, monitors: message.monitors, monitorSetVersion: message.monitorSetVersion, unavailableMonitorKeyId: message.unavailableMonitorKeyId, partitionStartedAt: new Date(message.partitionStartedAt), observedAt: new Date(message.observedAt), minimumPartitionMs: message.minimumPartitionMs });
      process.send?.({ type: 'partition', statement });
    } else if (message?.type === 'activation') {
      const activation = createReplacementMonitorActivationV33_36({ replacement: identity, replacementDescriptor: descriptor, predecessorMonitors: message.predecessorMonitors, predecessorMonitorSetVersion: message.predecessorMonitorSetVersion, unavailableMonitorKeyId: message.unavailableMonitorKeyId, challengeDigest: message.challengeDigest, activatedAt: new Date(message.activatedAt) });
      process.send?.({ type: 'activation', activation });
    } else if (message?.type === 'forge-split') {
      const payload = message.receipt.payload;
      const material = { ...payload, contentDigest: sha256({ attack: 'split-view' }) }; delete material.retrievalDigest;
      process.send?.({ type: 'split', receipt: signEnvelope({ ...material, retrievalDigest: sha256(material) }, identity) });
    } else if (message?.type === 'stop') process.exit(0);
  } catch (error) { process.send?.({ type: 'error', error: error instanceof Error ? error.message : String(error) }); }
});
