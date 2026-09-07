import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { REQUIRED_EXTERNAL_GATE_IDS } from '../dist/src/qualification/external-qualification-integrity-v32_12.js';
import { parseStrictJsonV32_12 } from '../dist/src/validation/strict-json-v32_12.js';

const out = resolve(process.env.V32_6_RUN_DIR || 'evidence/generated'); mkdirSync(out, { recursive: true });
const gates = REQUIRED_EXTERNAL_GATE_IDS.map((gateId) => {
  const manifestPath = `external-qualification/v32.12/${gateId}/manifest.json`;
  const manifest = parseStrictJsonV32_12(readFileSync(resolve(manifestPath), 'utf8'));
  const failures = [];
  if (manifest.schemaVersion !== '32.12' || manifest.gateId !== gateId) failures.push('manifest_identity_invalid');
  if (manifest.status !== 'not_executed') failures.push('external_execution_overclaim');
  if (manifest.productionSatisfyingMode !== 'independent-organization') failures.push('production_mode_invalid');
  if (!Array.isArray(manifest.negativeControls) || manifest.negativeControls.length < 8) failures.push('negative_controls_incomplete');
  if (!Array.isArray(manifest.acceptanceCriteria) || manifest.acceptanceCriteria.length < 13) failures.push('acceptance_criteria_incomplete');
  if (!/trust-anchor\.json.*signed-trust-bundle\.json.*evidence-root.*replay-state\.json/.test(String(manifest.verificationCommand))) failures.push('verification_command_trust_inputs_missing');
  if (manifest.trustModel?.trustAnchor !== 'out-of-band-pinned' || manifest.trustModel?.evaluationClock !== 'verifier-system-clock' || manifest.trustModel?.rawEvidenceObservation !== 'verifier-filesystem') failures.push('trust_model_incomplete');
  return { gateId, readiness: failures.length === 0 ? 'ready-for-authorized-external-execution' : 'blocked', executionStatus: 'not_executed', productionQualified: false, manifestPath, failures };
});
const material = {
  version: '32.12', generatedAt: new Date().toISOString(), status: gates.every((g) => g.readiness === 'ready-for-authorized-external-execution') ? 'READY' : 'BLOCK',
  externalQualification: 'not_executed', productionPromotion: 'blocked', gatesReady: gates.filter((g) => g.readiness.startsWith('ready')).length, gatesTotal: gates.length, gates,
  verifier: 'scripts/verify-external-qualification-v32_12.mjs', schemas: ['schemas/external-qualification-verification-v32_12.schema.json','schemas/external-qualification-trust-anchor-v32_12.schema.json','schemas/external-qualification-trust-bundle-v32_12.schema.json','schemas/external-qualification-replay-state-v32_12.schema.json'], trustBoundary: { trustAnchor: 'out-of-band-pinned', trustBundle: 'root-signed', observations: 'verifier-filesystem', clock: 'verifier-system-clock', replayState: 'local-integrity-with-external-rollback-blocker' },
};
material.reportDigest = createHash('sha256').update(JSON.stringify(material)).digest('hex');
writeFileSync(join(out, 'V32_12_EXTERNAL_QUALIFICATION_READINESS.json'), `${JSON.stringify(material, null, 2)}\n`);
console.log(JSON.stringify(material, null, 2));
if (material.status !== 'READY') process.exit(1);
