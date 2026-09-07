# Infrastructure and Sovereignty

## Deployment profiles

### Embedded local

Application, worker, database, artifacts, and optional local model on user-controlled
hardware. Lowest operational burden and mandatory zero-key recovery path.

### Local worker

Separate execution process for durability and isolation while retaining local storage
and a simple install.

### Private server

Server database, queue, workers, object storage, workload identity, and stronger
isolation for team or higher-load operation.

### Optional burst

Explicit policy can send selected non-sensitive workloads to an approved remote service.
It requires credentials, observable routing, revocation, data boundaries, cost ceilings,
and a tested exit path.

## Sovereignty tests

Disconnect the network, disable every remote adapter, export all user state, restore to
a clean machine, delete selected data and derived indexes, replace a model provider, and
verify audit continuity. A platform that fails these tests is not operationally sovereign.
