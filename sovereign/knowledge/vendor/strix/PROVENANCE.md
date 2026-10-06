# PROVENANCE — vendored strix skills (r160)

- **Source**: https://github.com/usestrix/strix
- **Commit**: `99c0711687ac7d6acbe5a214143f97b8d6f8f282` (2026-10-02, main)
- **License**: Apache-2.0 (see upstream `LICENSE`) — verbatim vendoring permitted with attribution.
- **Vendored by**: r160 wave, trace 1a0ff89853f34b5d, operator pointed the repo ("מה לגבי זה").
- **Measured at scout time**: 66.2k stars, 7.3k forks, 842 commits, 174 branches, 30 tags,
  last commit 2026-10-02. PyPI `strix-agent` v1.6.2. 9 agent skills upstream; 5 vendored here.

## Why these 5 (out of 9) — system-integrity selection

Strix is NOT a revenue engine here (see `security-doctrine.json` → activation routes).
What serves the sovereign system today is the **security-review methodology** — we hold the
@headcorner posting key and run 9 services; integrity protects revenue even when it does not
directly mint it.

| Vendored skill | Source path (upstream) | Purpose here |
|---|---|---|
| `find-security-vulnerabilities-in-code` | skills/find-security-vulnerabilities-in-code | White-box review doctrine: scope the risky subtree, state tenancy/trust boundaries explicitly, diff-scoped review, PoC-or-it-is-not-a-finding, exit-0 semantics. |
| `penetration-testing-with-strix` | skills/penetration-testing-with-strix | Master reference (install, LLM config, all flags, headless mode, budgets) — the base the other skills defer to. |
| `ci-security-scanning-with-strix` | skills/ci-security-scanning-with-strix | Security-gate pattern for change waves (diff scope, block-on-findings, SARIF) — maps to our init.sh gate doctrine. |
| `owasp-top-10-testing` | skills/owasp-top-10-testing | Compact vulnerability taxonomy (injection, IDOR, SSRF, XSS, auth, business logic) — feed for guard-pack hardening audits. |
| `fix-security-vulnerabilities-with-strix` | skills/fix-security-vulnerabilities-with-strix | Patch-root-cause-then-reprove loop — matches our "fix root cause, re-verify" census/init.sh fix patterns. |

Not vendored (4): `api-security-testing`, `application-security-testing`, `web-app-penetration-testing`
(duplicative of the above for our context) and `managed-pentesting-with-strix` (23KB cloud-platform
manual — activation route noted in the doctrine JSON; re-evaluate if the cloud path opens).

## Hard evidence — local feasibility (measured this wave)

- `pip3 install strix-agent` → OK; `strix --version` → **1.6.2** (installed in `/home/z/.venv`, ready).
- `strix -n -t /tmp/strix-test --scan-mode quick` → **blocked at startup with banner
  "DOCKER NOT INSTALLED"** — the tool's own gate, corroborating r158 boundary measurement
  (docker/podman/kvm absent in sandbox).
- No `LLM_API_KEY` / provider key present in environment (env scan); z-ai SDK authenticates
  internally and cannot feed strix's key-based config.

Until one of the activation routes opens (docker, strix cloud, CI with secrets), these skills are
doctrine reference only — exactly like the r157 `loop-library` precedent.
