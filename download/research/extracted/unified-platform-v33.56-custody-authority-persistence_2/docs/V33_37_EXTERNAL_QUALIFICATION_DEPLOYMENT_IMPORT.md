# V33.37 External Qualification Deployment and Evidence Import

V33.37 converts the local HTTPS qualification protocol into a deployable, fail-closed external execution kit. It does not claim that external infrastructure was provisioned or observed.

## Controls

- A deployment authority signs the exact artifact, DNS allowlist, provider-evidence policy and eleven role assignments.
- Publisher, three monitors, two topology auditors, two time sources, exporter, importer and recovery verifier must use distinct keys, organizations, hosts and administrators.
- Every role signs an acceptance proving key possession and binding itself to the exact deployment manifest.
- The importer issues a fresh, expiring challenge. Exported evidence is bound to that challenge and cannot be replayed.
- The evidence inventory is exact: missing, additional, renamed, traversing or byte-changed files fail closed.
- A separate recovery verifier restores one durable receipt and signs the digest of the restored bytes.
- A local rehearsal cannot be relabelled as live external evidence.
- Accepted evidence never grants production authority; G3 and production remain blocked.

## Current proof boundary

The included proof creates a signed deployment kit and executes a local import rehearsal. It verifies 15 signatures and three inventory files. No public DNS, external host, external time source, topology auditor observation or human participant was observed.
