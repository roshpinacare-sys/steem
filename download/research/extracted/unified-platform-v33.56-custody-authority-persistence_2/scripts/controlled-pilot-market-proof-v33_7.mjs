import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createV33_7ReadinessSummary } from '../dist/src/product/controlled-pilot-and-market-v33_7.js';
import { sha256 } from '../dist/src/contracts/crypto.js';

const root = resolve('.');
const outputDir = resolve(root, 'release-evidence/v33.7');
mkdirSync(outputDir, { recursive: true });
const readiness = createV33_7ReadinessSummary();
const material = {
  version: '33.7',
  status: 'READY_FOR_CONTROLLED_EXECUTION',
  readiness,
  implementedContracts: [
    'immutable-signed-controlled-human-pilot-protocol',
    'device-signed-pseudonymous-participant-consent',
    'independent-observation-binding-to-protocol-consent-and-base-evidence',
    'controlled-human-pilot-gate-with-fixed-thresholds',
    'credentialled-provider-run-and-independent-witness-verification',
    'buyer-interview-design-partner-and-paid-pilot-evidence-gate',
  ],
  antiGamingControls: [
    'one-device-cannot-create-multiple-participants',
    'study-authority-cannot-be-independent-observer',
    'same-organization-provider-witness-cannot-qualify',
    'same-buyer-organization-counts-once-at-its-strongest-evidence-level',
    'simulated-readiness-does-not-count-as-human-provider-or-buyer-proof',
  ],
  officialProviderContractBasis: {
    APNS: ['HTTP2', 'TLS1.2_OR_LATER', 'ES256_PROVIDER_JWT', 'SANDBOX_BEFORE_PRODUCTION'],
    FCM: ['HTTP_V1_PROJECTS_MESSAGES_SEND', 'SHORT_LIVED_OAUTH2_OR_WORKLOAD_IDENTITY', 'ISOLATED_TEST_PROJECT'],
  },
  observedExternalEvidence: {
    humanParticipants: 0,
    credentialledProviderRuns: 0,
    buyerInterviews: 0,
    designPartners: 0,
    paidPilots: 0,
  },
  gates: { G0: 'passed', G1: 'passed', G2: 'in-progress-not-passed', G3: 'in-progress-not-passed' },
  productionPromotion: 'blocked',
  externalEffectsExecuted: 0,
};
const proof = { ...material, proofDigest: sha256(material) };
writeFileSync(resolve(outputDir, 'V33_7_CONTROLLED_PILOT_PROVIDER_BUYER_PROOF.json'), JSON.stringify(proof, null, 2) + '\n');
console.log(JSON.stringify({ status: proof.status, gates: proof.gates, externalEvidence: proof.observedExternalEvidence, proofDigest: proof.proofDigest }, null, 2));
