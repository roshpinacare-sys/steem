# Federated External Human UX Pilot Runbook — V33.32

## Hard stop before recruitment

Do not recruit or instrument a participant until the privacy notice, withdrawal channel, retention deletion job, role keys, witness quorum and incident abort path are approved and tested.

## Required topology

Assign separate organizations, hosts and keys for pilot operator, researcher, registrar, exporter, importer, observer, verifier, witness coordinator and privacy officer. Deploy five witness identities on distinct hosts and organizations; require three votes for every imported checkpoint.

## Participant flow

1. Provide the approved notice and obtain signed consent before instrumentation.
2. Enroll the participant through the registrar-signed V33.31 role proof.
3. Run the preregistered baseline and governed scenarios.
4. Collect only schema-allowed observation JSON.
5. Honor withdrawal immediately and complete deletion within the approved SLA.
6. Export the exact canonical bytes under a one-time challenge.
7. Import through V33.31 and prepare the candidate checkpoint.
8. Obtain three distinct witness votes over the same proposal.
9. Verify the certificate and federated anchor independently.
10. Issue only a shadow-only V33.32 verdict.

## Abort conditions

Abort on invalid consent, quorum loss, excessive clock skew, out-of-scope data, participant distress or a security incident. Preserve evidence of the abort without collecting additional participant data.

## No promotion

A passed human-pilot verdict does not authorize production, external mutation or customer deployment. Promotion is a separate authorized decision after all remaining external gates pass.
