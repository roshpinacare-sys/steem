# Contributing to SRS Runtime

## Development Setup

```bash
git clone <repo>
cd srs
pip install -r requirements.txt -r requirements-dev.txt
```

## Running Tests

```bash
# Quick: module self-tests
python3 srs/cli.py self-test

# Full: pytest suite
python3 -m pytest tests/test_srs_runtime.py tests/test_integration_v7.py -v

# Lint
mypy srs/ --ignore-missing-imports
ruff check srs/ --select E,F,W,I,N,B,C4,UP

# Benchmark
python3 srs/cli.py bench
```

## Code Style

- Type annotations required on all public functions
- mypy and ruff must pass with 0 issues
- Comments explain WHY, not WHAT
- No roast-ID references (R1.x, R4.x) in code — use plain English
- Test names describe the behavior being tested

## Adding a New Primitive

1. Create `srs/primitives/<name>.py` with `execute_identify()` and `self_test()`
2. Add to `srs/primitives/__init__.py`
3. Add to `srs/planner.py` `TASK_PLAN` and `estimate_cost`
4. Add to `srs/pipeline.py` as a stage function
5. Add tests in `tests/test_srs_runtime.py`
6. Run `python3 srs/cli.py self-test` to verify

## Security Considerations

- All file writes use `_atomic_write_json` (`tempfile` + `fsync` + `os.replace`)
- All user-controlled values logged via `_safe_log_value` (strips control chars)
- All `task_id`s sanitized via `_sanitize_task_id`
- All snapshots HMAC-protected via `_compute_snapshot_hash`
- Never use `pickle`, `yaml.load`, `eval`, or `exec`

## Internationalization (i18n)

The runtime ships with gettext infrastructure (`srs/i18n.py`) so
user-facing strings CAN be wrapped for translation. By default no
translations are bundled — the `_()` callable is a no-op that returns
its input unchanged.

To mark a string for translation in user-facing code:

```python
from srs.i18n import _
print(_("SRS Runtime v{}".format(version)))
```

Internal log messages and exception messages do NOT need wrapping
(they're for developers, not end users). Wrap strings that end users
will see: CLI output, error messages printed to stderr, human-format
result lines.

To add a translation:

1. Create `srs/locale/<lang>/LC_MESSAGES/` (e.g. `srs/locale/fr/LC_MESSAGES/`).
2. Generate a `.po` file from the source (use `pygettext` or `xgettext`
   with `--keyword=_`).
3. Translate the strings.
4. Compile to `.mo` with `msgfmt`.
5. Set `LANGUAGE=<lang>` (or `LANG=<lang>`) — the runtime picks it up
   automatically on import.

The `LOCALE_DIR` and `DOMAIN` constants in `srs/i18n.py` are exposed
for tooling that wants to discover or refresh catalogs.
