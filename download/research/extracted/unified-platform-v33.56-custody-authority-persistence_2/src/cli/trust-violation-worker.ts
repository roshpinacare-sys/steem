import { PersistentCapabilityTrustStore } from '../platform/capability-trust.js';

const [root, tenantId, capability, violationId] = process.argv.slice(2);
if (root === undefined || tenantId === undefined || capability === undefined || violationId === undefined) {
  console.error('usage: trust-violation-worker <root> <tenant> <capability-ref> <violation-id>');
  process.exit(64);
}

try {
  const store = new PersistentCapabilityTrustStore(root);
  const state = store.recordViolation(tenantId, capability, {
    violationId,
    kind: 'POLICY',
    severity: 'LOW',
    evidenceRef: `evidence-${violationId}`,
    observedAt: new Date().toISOString(),
    message: `concurrent violation ${violationId}`,
  });
  process.stdout.write(`${JSON.stringify({ violationId, revision: state.revision, violationCount: state.violationCount, status: state.status })}\n`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
