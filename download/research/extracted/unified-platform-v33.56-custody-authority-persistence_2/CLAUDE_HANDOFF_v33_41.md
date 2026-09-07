# CLAUDE HANDOFF — V33.41

Canonical version: **33.41**  
Phase: **External Provider Onboarding, Conformance and Safe Replacement**

Read `CLAUDE.md`, `MASTER_DIRECTIVE.md`, `PROGRAM_CHARTER.md`, `governance-state/PROGRAM_STATE.json`, `governance-state/NEXT_ACTION.json` and `governance-state/OPEN_DECISIONS.json` before acting.

V33.41 implements exact signed trust-root registration, adapter and remote-attestation reverification, byte-bound PKCS#11/provider conformance, monotonic attestation revocation, quorum-preserving provider replacement, public checkpoint anchoring, three-monitor durable retrieval and cross-site recovery. The proof is local rehearsal only. External mutation and production promotion remain forbidden. Private key material must never be exported. G3 remains blocked because the external human participant count is zero.

Next cycle: execute the provider onboarding protocol on independently administered HSMs and laboratories, publish the checkpoint outside platform control, test revocation propagation and provider replacement, and import exact evidence without enabling production promotion.
