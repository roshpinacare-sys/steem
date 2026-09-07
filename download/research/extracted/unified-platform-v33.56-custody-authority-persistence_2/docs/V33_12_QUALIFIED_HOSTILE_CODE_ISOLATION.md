# V33.12 — Qualified Hostile-Code Isolation Reference

## Purpose

V33.12 advances the repository-admission firewall from static quarantine to bounded execution of explicitly authorized qualification fixtures. It does **not** grant production authority and does not claim microVM, seccomp, cgroup-v2, multi-host or independent external qualification.

## Execution boundary

The local reference runtime uses:

- Linux user, mount, network, PID, IPC and UTS namespaces.
- A minimal chroot assembled from host-pinned BusyBox and `setpriv` binaries plus their dynamic libraries.
- A separately copied immutable repository snapshot; the source repository is hashed before and after snapshot creation.
- A deterministic re-scan of the snapshot under the exact signed V33.11 admission policy. A stale admission report fails closed.
- A read-only, `nosuid,nodev,noexec` input bind mount.
- A bounded, `nosuid,nodev,noexec` tmpfs workspace.
- An empty network namespace.
- UID/GID 65534, cleared supplementary groups, `no-new-privileges`, and an empty capability bounding, inheritable and ambient set.
- RLIMIT controls for CPU time, virtual memory, process count, file size, open files and core files.
- A wall-clock timeout that terminates the namespace process tree.
- A sanitized allowlist-only environment with no secret injection.
- A signed execution receipt and verified runtime-root destruction.

## Quarantined fixture authorization

A quarantined repository cannot execute merely because isolation exists. Execution requires an independently signed, time-bounded challenge authorization tied to:

- tenant and repository;
- the signed admission report digest;
- the exact entrypoint path and bytes;
- an adversarial-qualification-only purpose;
- zero external effects and blocked production promotion.

The admission signer cannot self-authorize the challenge.

## Adversarial campaign

Twelve scenarios are executed:

1. benign completion;
2. network egress attempt;
3. host filesystem read;
4. `/proc/1/root` escape attempt;
5. source mutation;
6. parent-environment secret leakage;
7. wall-time exhaustion;
8. process fan-out;
9. file growth;
10. memory growth;
11. CPU exhaustion;
12. native executable attempt on a `noexec` input mount.

The campaign requires signed receipts, unchanged source repositories, destroyed runtime roots, zero external effects and successful observation of every common boundary.

## Truth boundary

Evidence class: `LOCAL_LINUX_NAMESPACE_ISOLATION_REFERENCE`.

Explicit limitations:

- single local host and trusted host kernel;
- trusted host BusyBox, `setpriv`, loader and libraries;
- no seccomp profile;
- RLIMITs rather than cgroup-v2 accounting;
- no microVM, confidential-computing or hardware boundary;
- no independent external red team or witness;
- shell entrypoints only;
- snapshot copying is not yet hardened with `openat2`/file-descriptor-walk race resistance;
- no live provider repository, merge or deployment.

Production promotion remains blocked.
