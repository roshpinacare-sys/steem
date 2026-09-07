# Titai v8 Roast Audit

This directory contains the adversarial project audit and repeatable regression mechanism.

- `ROAST_REPORT.md` — complete human-readable audit.
- `ROAST_FINDINGS.json` — machine-readable source of truth for findings.
- `ROAST_MATRIX.md` — finding-to-task/evidence summary.
- `ROAST_PLAYBOOK.md` — repeatable operating procedure.
- `evidence/` — command output and generated static scan results.

The audit is intentionally conservative. A fixed finding is not automatically independently verified, and a static pass is not a production-security proof.
