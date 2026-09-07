# V33.11 — Malicious Repository Admission Firewall

## Goal

Prevent untrusted repository content from reaching local execution merely because a scanner reported no obvious error.

## Admission controls

- Symlink quarantine without following the target.
- Active Git hook detection without execution.
- Submodule quarantine.
- Prompt-injection and authority-confusion detection as untrusted data.
- Secret candidate detection.
- npm lifecycle script and unsafe dependency locator rejection.
- Executable script and native/binary artifact quarantine.
- Bounded files, bytes and text scanning.
- Signed, tenant-bound admission reports.

## Campaign

Twenty synthetic malicious repositories are scanned. Every repository must be quarantined, remain byte-for-byte unchanged and produce a trusted signed report. No command, hook, test, package lifecycle script or external effect may execute.

## Boundary

A clean report does not authorize local execution. It yields `QUALIFIED_ISOLATION_REQUIRED`. V33.11 does not prove containers, microVMs, WASM isolation or hostile-code execution safety.
