# V33.14 External Isolation Qualification Kit

This kit is an administrator-operated, external-evidence path. It does not contain credentials and it cannot promote production.

## Required external execution

Run the signed challenge on at least two independently operated hosts, under two independent organizations and two runtime implementations. Each external observation must include executed proof of:

- `openat2` beneath/no-symlink resolution;
- seccomp syscall blocking;
- delegated cgroup v2 CPU, memory and process enforcement;
- network and filesystem isolation;
- runtime destruction;
- zero external effects.

The observation signer must not be the execution signer or the challenge issuer. Synthetic results are accepted only for contract testing and never count toward qualification.

## Current local result

The current host executes the probes but does not qualify openat2, seccomp or cgroup v2. The Node WebAssembly worker is qualified only as a specialized portable challenge runtime, not as a general repository runtime. External qualification remains unexecuted.
