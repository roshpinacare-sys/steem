# v32.12 Breakthrough Hypothesis Laboratory

| # | Hypothesis | Repository evidence and falsification | Decision |
|---|---|---|---|
| 1 | A verifier-only path can eliminate legacy unbound PASS aggregation | The legacy aggregate accepted forged PASS objects | Implemented |
| 2 | A verifier can still self-attest if keys and policy arrive in the evidence document | A fully attacker-created one-gate document received `QUALIFIED` before hardening | Implemented out-of-band root trust |
| 3 | Caller-selected time can defeat freshness and credential windows | The old document supplied `evaluatedAt` | Replaced by verifier system clock |
| 4 | Caller-supplied observations do not prove raw bytes | A nonexistent file could be represented by a fabricated observation | Replaced by verifier filesystem reads and hashes |
| 5 | Replay protection must persist outside the evidence document | Consumed nonces supplied by the document could be omitted | Implemented verifier-owned state |
| 6 | Local state locking can itself create a concurrency vulnerability | Failed lock acquisition deleted another verifier's lock | Repaired with explicit lock ownership |
| 7 | Production semantics must be independent of a valid policy digest | A correctly digested subset or witness-free policy would otherwise be structurally valid | Exact six-gate, organization and witness rules enforced |
| 8 | Actor signatures are insufficient without root-authorized roles | Attacker actor keys can produce valid signatures | Root-signed role/gate authorizations implemented |
| 9 | Witness receipts need a verifier-held monotonic predecessor | Evidence-local checkpoint sequences are replayable | Persistent checkpoint chain implemented |
| 10 | Duplicate JSON keys can produce cross-parser ambiguity | Ordinary JSON parsing accepts last-key wins | Strict duplicate-key parser retained |
| 11 | Qualification runbooks are part of the trusted product | Operational commands previously described the obsolete two-argument verifier | Manifests/runbooks upgraded and source-bound |
| 12 | A minimal verifier package can reduce the trusted computing base further | Current CLI still imports repository crypto and integrity modules | Selected for a future independently built verifier artifact |
| 13 | Local hash-chained state cannot prove cross-host non-rollback | An older valid state can be restored by a privileged host operator | Explicit external monotonic-witness blocker retained |
| 14 | Runtime capability telemetry may reveal static false closure | Current capability closure is mainly code/test graph evidence | Deferred to an observed runtime environment |

The highest-value discoveries were not additional features. They were trust-boundary corrections: independent trust bootstrap, independent observation, independent time, persistent replay state and correct lock ownership. These materially reduce false qualification risk and are exercised by a 24-mutant campaign rather than being documented only.
