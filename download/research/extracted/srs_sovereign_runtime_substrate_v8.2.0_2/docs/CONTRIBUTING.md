# Contributing to the SRS

Thank you for contributing to the Sovereign Runtime Substrate! This
document describes the workflow and conventions for contributing code,
tests, and documentation.

## Repository Layout

```
kernel/        Omnivisor, SMPU/SPPU, eBPF telemetry
cognition/     AgeMem, ESR, Adm mapper, GRPO trainer
verification/  Z3 proofs, TLA+ spec, Saarthi SVA generator
simulation/    AdaQC compiler, photonic bus emulator
governance/    SQA aggregator, BLS signatures, SEG controller
self_healing/  Digital DNA, antibody maturation
tests/         pytest suite + integration test
docs/          Architecture docs, contributing guide, changelog
```

## Development Setup

```bash
git clone <repo-url> srs
cd srs
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
make smoke    # run every module's self-test
make test     # run the pytest suite
```

## Adm Linkage (Final Constraint)

Every new file must be linked to the Admissible Behavior Set (Adm).
Add an entry to `adm_linker_manifest.json` with:

- `path`: the file path
- `phase`: 1–6
- `role`: `implements` | `enforces` | `tests`
- `adm_rules`: list of Adm rules (`Adm_spatial`, `Adm_temporal`, `Adm_thermal`, `Adm_behavioural`)
- `description`: one-paragraph explanation of the linkage
- `self_test`: the command to verify the file

The CI pipeline verifies that every file in the manifest exists and
that every Python file has at least one Adm rule.

## Coding Conventions

- **Python 3.10+** with type hints.
- **Line length**: 100 chars (enforced by ruff).
- **Imports**: `from __future__ import annotations` at the top.
- **Self-tests**: every module has a `self_test()` function and a
  `if __name__ == "__main__":` block.
- **Docstrings**: every module, class, and public function has a
  docstring with an "Adm linkage" section explaining how it links to
  the Admissible Behavior Set.

## Testing

- Every module has a self-test runnable via `python3 path/to/module.py`.
- The pytest suite in `tests/` covers unit and integration tests.
- The integration test (`tests/integration_test.py`) exercises the full
  pipeline end-to-end.
- Run everything: `make smoke && make test && make integration`.

## Pull Request Checklist

- [ ] Every new file has an entry in `adm_linker_manifest.json`.
- [ ] Every module self-test passes (`make smoke`).
- [ ] The pytest suite passes (`make test`).
- [ ] The integration test passes (`make integration`).
- [ ] `make lint` passes (ruff + mypy).
- [ ] The PR description explains the Adm linkage of any new logic.

## Release Process

1. Update `CHANGELOG.md` with the new version and changes.
2. Tag the release: `git tag v1.x.0`.
3. Build the zip: `make zip`.
4. The zip artifact is the distributable.

## License

All contributions are licensed under the Apache License 2.0.
