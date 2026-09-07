# V33.13 — Runtime Adapter Separation and Independent Verification

## Purpose

V33.13 separates repository orchestration from the low-level isolation runtime and makes missing host controls explicit, signed and fail-closed.

## Delivered

- signed host capability attestation with a validity window;
- a provider-neutral isolation runtime adapter contract;
- a local namespace adapter delegating to the V33.12 reference runtime;
- descriptor-pinned `O_NOFOLLOW` plus double-`fstat` repository manifests;
- independent admission, host-capability, runtime, orchestration and verification roles;
- a signed orchestration bundle binding source manifests, runtime receipt and adapter evidence;
- an independent signed verdict with a research-only promotion ceiling.

## Truth boundary

The current host does not prove openat2, seccomp, delegated cgroup v2, a second runtime, multi-host reproduction or an external witness. Those controls remain `UNAVAILABLE_FAIL_CLOSED` or `NOT_PROBED`; they are never inferred from the namespace result.

The descriptor-pinned manifest is a stronger reference than path-only hashing, but it is not equivalent to an `openat2(RESOLVE_BENEATH|RESOLVE_NO_SYMLINKS)` snapshot implementation.

## Authority boundary

The admission signer, capability attestor, runtime signer, orchestrator and verifier must be distinct. The verifier has no execution key. A self-verdict is signed but must be `REJECTED`.

## Promotion boundary

- evidence class: `LOCAL_REFERENCE_MULTI_ROLE_QUALIFICATION`;
- promotion ceiling: `research`;
- production promotion: blocked;
- external qualification: not executed.

## Next bounded step

Run the same adapter contract with a genuinely independent implementation and host, then qualify openat2, seccomp and cgroup v2 through executed evidence rather than host feature assumptions.
