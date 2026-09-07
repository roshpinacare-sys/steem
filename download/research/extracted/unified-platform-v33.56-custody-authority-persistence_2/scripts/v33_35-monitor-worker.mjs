import { generateSigningIdentity, KeyRegistry } from '../dist/src/contracts/crypto.js';
import { createMonitorGossipStatementV33_35, createMonitorRetrievalReceiptV33_35 } from '../dist/src/app/expired-coordinator-takeover-v33_35.js';
const config = JSON.parse(Buffer.from(process.argv[2], 'base64url').toString('utf8'));
const identity = generateSigningIdentity(config.keyId);
const registry = new KeyRegistry(); registry.register(identity.keyId, identity.publicKey);
const descriptor = { witnessId: config.monitorId, keyId: identity.keyId, keyFingerprint: registry.fingerprint(identity.keyId), organizationId: config.organizationId, hostId: config.hostId };
let ownReceipt;
async function run() {
  const response = await fetch(config.endpointUri, { cache: 'no-store' });
  if (response.status !== 200) throw new Error(`fetch_status_${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  ownReceipt = createMonitorRetrievalReceiptV33_35({ monitor: identity, monitorDescriptor: descriptor, publicationReceipt: config.publicationReceipt, content: bytes, transport: 'HTTP_LOOPBACK', processId: process.pid, observedAt: new Date(config.observedAt) });
  process.send?.({ type: 'retrieval', pid: process.pid, descriptor, receipt: ownReceipt, publicKey: registry.exportPublicKey(identity.keyId) });
}
process.on('message', (message) => {
  if (message?.type === 'gossip') {
    const peers = message.receipts.filter((row) => row.payload.monitorKeyId !== identity.keyId);
    const gossip = createMonitorGossipStatementV33_35({ monitor: identity, ownReceipt, peerReceipts: peers, observedAt: new Date(message.observedAt) });
    process.send?.({ type: 'gossip', pid: process.pid, gossip });
  }
  if (message?.type === 'shutdown') process.exit(0);
});
run().catch((error) => { process.send?.({ type: 'error', error: error instanceof Error ? error.message : String(error) }); process.exit(1); });
