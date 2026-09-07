# SRS — Sovereign Runtime Substrate
# Reproducible runtime for development and testing.
#
# Usage:
#   docker build -t srs:latest .
#   docker run --rm srs:latest make smoke
#   docker run --rm srs:latest make test
#   docker run --rm srs:latest make integration
#   docker run --rm srs:latest make compile-rust    # attempt Rust skeleton build
#   docker run --rm srs:latest make compile-ebpf    # attempt eBPF build
#
# Toolchains:
#   - Python 3.12 + z3-solver + torch + py_ecc + qiskit  (production path)
#   - gcc + make                                          (C isolation engine)
#   - rustc + cargo (rustup)                              (Rust supervisory skeleton — research)
#   - clang + libbpf + bpftool                            (eBPF telemetry — research)
#
# The Rust and eBPF toolchains are installed so that CI can ATTEMPT
# compilation. The Rust supervisory skeleton (kernel/rust/) and the
# eBPF C sources (bpf/) are research prototypes and may not compile
# without further work — see docs/CAPABILITY_AUDIT.md for status.
#
# v7.5 supply-chain hygiene:
#   - Base image pinned to python:3.12.4-slim. For production reproducibility
#     pin by digest as well so a re-built python:3.12.4-slim (same tag, new
#     contents) cannot silently change the build. The digest-pinned form is:
#
#       # Pin by digest for reproducibility (D20 fix).
#       # To discover the current digest, run:
#       #   docker pull python:3.12.4-slim
#       #   docker inspect --format='{{index .RepoDigests 0}}' python:3.12.4-slim
#       # … then paste the sha256 digest into the FROM line below:
#       # FROM python:3.12.4-slim@sha256:<paste-digest-here>
#
#     The digest-pinned FROM line is commented out below because the digest
#     changes every time the upstream image is rebuilt; the team must
#     rotate the digest manually after verifying the new image's SBOM and
#     CVE scan pass.
#   - apt packages are NOT version-pinned because Debian package versions
#     drift between point releases and pinning them tightly makes the
#     image unreproducible across Debian minor bumps. The recommended
#     hardening is to build against a pinned Debian release (e.g.
#     `bookworm-20240701`) and use `apt-get install -y --no-install-recommends`
#     with version suffixes (`=version`) for security-critical packages
#     (libz3-dev, libssl3, libc6) once a specific Debian release is chosen.
#   - Rust installed via rustup with a pinned toolchain (1.75.0). For
#     production reproducibility, prefer a vendored Rust toolchain or a
#     multi-stage build FROM rust:1.75.0-slim.
#   - Python deps installed with --require-hashes once a hash-pinned
#     lockfile is generated (see requirements.txt header).

# Production: pin the base image by digest (D20 fix). The tag-only form
# below is the minimum bar; replace with the digest-pinned line above
# once you've verified the current digest against the upstream SBOM.
# To rotate:
#   1. `docker pull python:3.12.4-slim`
#   2. `docker inspect --format='{{index .RepoDigests 0}}' python:3.12.4-slim`
#   3. Paste the printed `python@sha256:...` digest into the FROM line.
#   4. Bump the digest in `.github/dependabot.yml` so Dependabot can
#      detect future digest-only updates.
FROM python:3.12.4-slim AS base

# System deps for z3 + matplotlib + PIL + C build + eBPF.
# NOTE on apt pinning (D17 fix): exact version pinning (e.g. `gcc=4:12.2.0-3`)
# is intentionally NOT used here because Debian package versions drift between
# point releases and would make the image unreproducible across minor Debian
# bumps. The recommended hardening for production is:
#   1. Pin the Debian base via `FROM debian:bookworm-20240701-slim` (or use
#      `python:3.12.4-slim-bookworm` and pin the parent digest).
#   2. For security-critical packages (libssl3, libc6, libz3-dev), add the
#      version suffix once the Debian release is fixed, e.g.
#      `apt-get install -y --no-install-recommends libssl3=3.0.13-1~deb12u1`.
#   3. Run `apt-get upgrade -y` after install to capture security updates
#      within the pinned Debian release.
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    gcc \
    make \
    libc6-dev \
    libz3-dev \
    libfreetype6-dev \
    libpng-dev \
    clang \
    llvm \
    libbpf-dev \
    linux-libc-dev \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install Rust via rustup (pinned channel for reproducibility).
# NOTE (D18 fix): Rust 1.75.0 was released Dec 2023 and is past the 6-week
# support window. Bump to a current stable (e.g. 1.83.0) before production
# deployment. For full supply-chain assurance, replace the curl|sh antipattern
# with a multi-stage build FROM rust:1.83.0-slim and COPY --from=rust.
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain 1.75.0
ENV PATH="/root/.cargo/bin:${PATH}"

WORKDIR /app

# Install Python deps first (better layer caching).
# v7.5: py_ecc is now declared in requirements-dev.txt (D12 fix — was
# previously installed in a separate `pip install py_ecc` line, creating
# a duplicate source of truth). To enable --require-hashes, generate a
# hash-pinned lock file with `pip-compile --generate-hashes` and replace
# the -r flags below with the lock file.
COPY requirements.txt requirements-dev.txt ./
RUN pip install --no-cache-dir -r requirements.txt -r requirements-dev.txt

# Copy the repository
COPY . .

# Verify the Python install (heavy deps now declared + pinned).
RUN python3 -c "import z3; print('z3', z3.get_version_string())"
RUN python3 -c "import torch; print('torch', torch.__version__)"
RUN python3 -c "import fastapi; print('fastapi', fastapi.__version__)"
RUN python3 -c "import uvicorn; print('uvicorn', uvicorn.__version__)"
RUN python3 -c "import psycopg2; print('psycopg2', psycopg2.__version__)"

# Verify the C toolchain
RUN gcc --version | head -1

# Verify the Rust toolchain
RUN rustc --version && cargo --version

# Verify the eBPF toolchain
RUN clang --version | head -1

# Build the C isolation engine (production-ready)
RUN cd kernel/c && make

# Run C unit tests at build time — fail fast if C is broken
RUN cd kernel/c && make test

# NOTE: Rust supervisory skeleton (kernel/rust/) and eBPF (bpf/) are
# NOT built at image-build time because they are research prototypes.
# Use `make compile-rust` and `make compile-ebpf` inside a container
# to attempt compilation and view diagnostics.

# Default: run the smoke test
CMD ["python3", "tests/integration_test.py"]
