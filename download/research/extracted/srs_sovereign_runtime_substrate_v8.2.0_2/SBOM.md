# Software Bill of Materials (SBOM) — SRS Runtime v8.1.0

This document is the Software Bill of Materials for the SRS Runtime
v8.1.0 release. It lists every third-party dependency the runtime
depends on (directly or via the dev/test stack), the exact pinned
version, the license, the package's home page, and the canonical
download URL on PyPI.

## Format

Each row in the table below corresponds to one package. The fields are:

- **Package**: The PyPI package name (note: PyPI names are
  case-insensitive; we use the canonical casing from the package
  metadata).
- **Version**: The exact version pinned in `requirements.txt` or
  `requirements-dev.txt`. The lockfile (`requirements.lock`) pins the
  same versions with SHA-256 hashes for `--require-hashes` installs.
- **License**: The SPDX license identifier (or the license name from
  the package metadata when SPDX is not provided).
- **Purpose**: Why this package is needed by SRS.
- **Homepage**: The upstream project URL.
- **Download URL**: The canonical PyPI download URL for the pinned
  version's wheel (or sdist when no wheel is published).

## Direct Runtime Dependencies

| Package | Version | License | Purpose | Homepage | Download URL |
|---------|---------|---------|---------|----------|--------------|
| numpy | 1.26.4 | BSD-3-Clause | Numerical core (hash_bit oracle, alive_set bitset ops) | https://numpy.org | https://pypi.org/project/numpy/1.26.4/#files |
| torch | 2.2.2 | BSD-3-Clause | GRPO trainer policy network (cognition/ only; optional) | https://pytorch.org | https://pypi.org/project/torch/2.2.2/#files |
| z3-solver | 4.13.0.0 | MIT | Formal verification (Z3 SMT solver for power proofs) | https://github.com/Z3Prover/z3 | https://pypi.org/project/z3-solver/4.13.0.0/#files |
| pypdf | 4.2.0 | BSD-3-Clause | PDF report assembly (cover/ESR pipeline) | https://pypi.org/project/pypdf/ | https://pypi.org/project/pypdf/4.2.0/#files |
| Pillow | 10.3.0 | MIT-CMU | Image processing (cover PNG → PDF embedding) | https://python-pillow.org | https://pypi.org/project/Pillow/10.3.0/#files |
| matplotlib | 3.8.4 | PSF-based | GRPO advantage map visualization (PNG) | https://matplotlib.org | https://pypi.org/project/matplotlib/3.8.4/#files |
| fastapi | 0.111.0 | MIT | API server stack (api/) | https://fastapi.tiangolo.com | https://pypi.org/project/fastapi/0.111.0/#files |
| uvicorn | 0.30.1 | BSD-3-Clause | ASGI server for fastapi | https://www.uvicorn.org | https://pypi.org/project/uvicorn/0.30.1/#files |
| psycopg2-binary | 2.9.9 | LGPL-3.0-or-later | PostgreSQL adapter (api/postgres_adapter.py) | https://www.psycopg.org | https://pypi.org/project/psycopg2-binary/2.9.9/#files |

## Development / Test Dependencies

These packages are NOT shipped in the production runtime image. They
are declared in `requirements-dev.txt` and used only by the test suite,
linters, type-checkers, and the qiskit simulation adapters.

| Package | Version | License | Purpose | Homepage | Download URL |
|---------|---------|---------|---------|----------|--------------|
| pytest | 8.2.1 | MIT | Test framework | https://docs.pytest.org | https://pypi.org/project/pytest/8.2.1/#files |
| pytest-cov | 5.0.0 | MIT | Coverage reporting | https://pypi.org/project/pytest-cov/ | https://pypi.org/project/pytest-cov/5.0.0/#files |
| pytest-xdist | 3.6.1 | MIT | Parallel test execution | https://pypi.org/project/pytest-xdist/ | https://pypi.org/project/pytest-xdist/3.6.1/#files |
| hypothesis | 6.103.0 | MPL-2.0 | Property-based testing | https://hypothesis.readthedocs.io | https://pypi.org/project/hypothesis/6.103.0/#files |
| ruff | 0.4.7 | MIT | Linter (E,F,W,I,N,B,C4,UP rule sets) | https://docs.astral.sh/ruff | https://pypi.org/project/ruff/0.4.7/#files |
| mypy | 1.10.0 | MIT | Static type checker | https://mypy-lang.org | https://pypi.org/project/mypy/1.10.0/#files |
| bandit | 1.7.9 | Apache-2.0 | Security linter | https://bandit.readthedocs.io | https://pypi.org/project/bandit/1.7.9/#files |
| qiskit | 2.0.0 | Apache-2.0 | Quantum simulation (tests only) | https://qiskit.org | https://pypi.org/project/qiskit/2.0.0/#files |
| qiskit-aer | 0.15.1 | Apache-2.0 | Qiskit noise simulator | https://qiskit.org/ecosystem/aer | https://pypi.org/project/qiskit-aer/0.15.1/#files |
| py_ecc | 7.0.0 | MIT | BLS12-381 cryptography (governance/bls_signatures.py) | https://github.com/ethereum/py_ecc | https://pypi.org/project/py_ecc/7.0.0/#files |

## Transitive Dependencies

The runtime's transitive dependency closure is resolved by pip at
install time. The lockfile (`requirements.lock`) records the SHA-256
hashes of every direct dependency's wheel; transitive dependencies are
resolved to whatever versions pip chooses from the version specifiers
of the direct dependencies. For full transitive pinning with hashes,
regenerate the lockfile via `pip-compile --generate-hashes`.

For a full machine-readable SBOM (CycloneDX or SPDX format), use:

```bash
# CycloneDX SBOM (JSON)
pip install cyclonedx-bom
cyclonedx-py requirements -o sbom.cdx.json -i requirements.txt

# SPDX SBOM (tag-value format)
pip install spdx-tools
```

## CVE Posture

The pinned versions were chosen to avoid the following high-severity
CVEs that were current as of v7.5 (2025-07):

| CVE | Package | Pinned-Around Version | Reason |
|-----|---------|-----------------------|--------|
| CVE-2024-7565 | torch | 2.2.2 | DoS in torch.load (torch 2.0.x) |
| CVE-2024-48026 | torch | 2.2.2 | Arbitrary code execution via crafted .pt archive |
| CVE-2023-50447 | Pillow | 10.3.0 | Arbitrary code execution in ICNS parser (10.0.x/10.1.x) |
| CVE-2024-28219 | Pillow | 10.3.0 | Buffer overflow in Pillow 10.0.x |

A weekly Dependabot scan (`.github/dependabot.yml`) opens PRs to bump
these pins when new CVEs are disclosed.

## SBOM Provenance

- **Generated by**: F19 (Dependency Infra + Performance + Docs Fixer agent)
- **Date**: 2025-07-19
- **Runtime version**: 8.1.0
- **Source files**: `requirements.txt`, `requirements-dev.txt`,
  `requirements.lock`
- **License of the SRS runtime itself**: see `LICENSE` at the repo root
