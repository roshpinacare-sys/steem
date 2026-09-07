# V33.14 — Executed Controls and External Isolation Qualification Kit

## Purpose

Replace inferred host capabilities with executed probes and prepare a signed, fail-closed path for qualification on independently operated hosts.

## Locally executed controls

- `openat2`: compiled syscall probe using `RESOLVE_BENEATH | RESOLVE_NO_SYMLINKS`.
- seccomp: compiled strict-mode probe that must kill a forbidden syscall.
- cgroup v2: filesystem, controller and delegated-write probe.
- second runtime: Node WebAssembly worker, explicitly limited to portable WASM challenges.

A missing control is recorded as `VERIFIED_UNAVAILABLE` or `PROBE_FAILED`; it is never inferred as available.

## External gate

The signed challenge requires two hosts, two organizations and two runtime implementations. Observations must be externally observed, signed by a non-executing operator and contain every required control. Synthetic observations are retained for contract testing but excluded from accepted evidence.

## Truth boundary

This release does not prove a second external host, a general second repository runtime, openat2, seccomp, delegated cgroup v2, an external witness, microVM isolation or production readiness.
