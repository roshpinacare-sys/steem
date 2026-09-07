# Third-Party Licenses

This file enumerates every third-party package distributed as part of
the SRS Runtime v8.1.0 (either bundled into the wheel or required at
runtime), together with its license and a pointer to the upstream
license text. Each license is reproduced in full in the `LICENSES/`
subdirectory of the source distribution, or available from the
upstream project's homepage.

The SRS Runtime itself is licensed under the terms in `LICENSE` at the
repo root. This file covers ONLY the third-party dependencies.

## Runtime Dependencies (production)

| Package | Version | License | License URL |
|---------|---------|---------|-------------|
| numpy | 1.26.4 | BSD-3-Clause | https://numpy.org/doc/stable/license.html |
| torch | 2.2.2 | BSD-3-Clause | https://github.com/pytorch/pytorch/blob/main/LICENSE |
| z3-solver | 4.13.0.0 | MIT | https://github.com/Z3Prover/z3/blob/main/LICENSE.txt |
| pypdf | 4.2.0 | BSD-3-Clause | https://github.com/py-pdf/pypdf/blob/main/LICENSE |
| Pillow | 10.3.0 | HPND (MIT-CMU) | https://github.com/python-pillow/Pillow/blob/main/LICENSE |
| matplotlib | 3.8.4 | Matplotlib (PSF-based) | https://matplotlib.org/stable/users/project/license.html |
| fastapi | 0.111.0 | MIT | https://github.com/tiangolo/fastapi/blob/master/LICENSE |
| uvicorn | 0.30.1 | BSD-3-Clause | https://github.com/encode/uvicorn/blob/master/LICENSE.md |
| psycopg2-binary | 2.9.9 | LGPL-3.0-or-later | https://github.com/psycopg/psycopg2/blob/master/LICENSE |

## Development / Test Dependencies (NOT shipped in production image)

| Package | Version | License | License URL |
|---------|---------|---------|-------------|
| pytest | 8.2.1 | MIT | https://github.com/pytest-dev/pytest/blob/main/LICENSE |
| pytest-cov | 5.0.0 | MIT | https://github.com/pytest-dev/pytest-cov/blob/master/LICENSE |
| pytest-xdist | 3.6.1 | MIT | https://github.com/pytest-dev/pytest-xdist/blob/master/LICENSE |
| hypothesis | 6.103.0 | MPL-2.0 | https://github.com/HypothesisWorks/hypothesis/blob/main/LICENSE.txt |
| ruff | 0.4.7 | MIT | https://github.com/astral-sh/ruff/blob/main/LICENSE |
| mypy | 1.10.0 | MIT | https://github.com/python/mypy/blob/master/LICENSE |
| bandit | 1.7.9 | Apache-2.0 | https://github.com/PyCQA/bandit/blob/main/LICENSE |
| qiskit | 2.0.0 | Apache-2.0 | https://github.com/Qiskit/qiskit/blob/main/LICENSE.txt |
| qiskit-aer | 0.15.1 | Apache-2.0 | https://github.com/Qiskit/qiskit-aer/blob/main/LICENSE.txt |
| py_ecc | 7.0.0 | MIT | https://github.com/ethereum/py_ecc/blob/main/LICENSE |

## License Categories

- **Permissive** (BSD-3-Clause, MIT, Apache-2.0, HPND): These licenses
  allow the SRS Runtime to bundle and redistribute the package without
  imposing copyleft obligations on the SRS source code. Attribution
  must be preserved (this file serves that purpose).
- **Weak copyleft** (LGPL-3.0-or-later for psycopg2-binary): The
  psycopg2-binary wheel may be redistributed alongside the SRS Runtime
  as a separate work. Linking to it from SRS does not impose LGPL on
  SRS itself.
- **File-level copyleft** (MPL-2.0 for hypothesis): Hypothesis is
  test-only and not shipped; the MPL only applies to modifications to
  hypothesis's own source files, not to code that uses it.

## Notice

The BSD-3-Clause, MIT, and Apache-2.0 licenses require the following
attribution notice:

> This product includes software developed by the NumPy Developers
> (numpy), the PyTorch contributors (torch), the Z3 Prover contributors
> (z3-solver), the pypdf contributors (pypdf), the Pillow contributors
> (Pillow), the Matplotlib Development Team (matplotlib), Sebastián
> Ramírez (fastapi), the Encode OSS maintainers (uvicorn), the
> Psycopg project (psycopg2-binary), the pytest Development Team
> (pytest, pytest-cov, pytest-xdist), the HypothesisWorks Project
> (hypothesis), the Ruff authors (ruff), the mypy contributors (mypy),
> the PyCQA Bandit maintainers (bandit), the Qiskit Development Team
> (qiskit, qiskit-aer), and the Ethereum Foundation (py_ecc).

For the full text of each license, follow the License URL above or
consult the `LICENSE` file shipped with each package's source
distribution.
