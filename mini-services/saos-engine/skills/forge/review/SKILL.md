---
name: review
description: Code-review forge tasks — security first, findings cite file:line you actually read, small one-commit diffs, mechanical fixes before style, report what the leash forbids.
---
# Review Skill Card (T-41)

Pattern law adopted from examining vercel-labs/openreview — IDEAS ONLY, ZERO
CODE: that repo carries no license file, so its code is forbidden; the review
discipline below is written in this machine's own words.

## Review order (never skip downward)
1. SECURITY: injection, secrets exposure, unchecked external input, auth gaps.
2. CORRECTNESS: error paths, fail-closed behavior, state writes, race windows.
3. FORMAT/LINT: only after 1-2 are clean — and only mechanical fixes.

## Findings law
- Every finding cites the file:line you ACTUALLY read this loop — a claim
  without a read is fiction, same as an uncited digest.
- Prefer small one-commit diffs over rewrites: candidate-eval-then-commit
  judges small diffs well and reverts big ones painfully.
- A fix beyond the leash (deps, git history, network, installs) is REPORTED,
  never attempted — the report is the artifact.
- Approve-then-apply is human-shaped: propose the change, let the gates and
  the operator decide — do not self-approve sweeping rewrites.
