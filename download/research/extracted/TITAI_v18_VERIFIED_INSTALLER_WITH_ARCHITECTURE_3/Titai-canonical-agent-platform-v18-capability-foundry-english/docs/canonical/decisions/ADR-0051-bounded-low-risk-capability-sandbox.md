# ADR-0051: Bounded low-risk capability sandbox

## Status
Accepted with explicit limitation.

## Decision
The controlled capability pilot permits only low-risk local JavaScript capability packages inside a restricted subprocess with static inspection, deny-all network policy, filtered environment, process, timeout, output, and path ceilings.

## Consequences
This boundary is not claimed as complete hostile-code containment. Native, privileged, arbitrary-shell, unrestricted-network, and irreversible package classes remain disabled.
