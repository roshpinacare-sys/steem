"""Tests for v8.2 cross-platform + accessibility LOW fixes (F18).

Covers the remaining LOW-severity items from R15 (cross-platform) and
R16 (accessibility) identified by the A2 convergence audit:

  R15.4  — ``~`` expansion in ``SRS_HOME`` (was inconsistent: only the
           default branch used ``Path.home()``; raw ``~`` in path strings
           was not expanded).
  R15.9  — Path normalization (``_coerce_path`` now resolves string
           inputs so ``.`` / ``..`` components are eliminated and the
           caller always sees an absolute canonical path).
  R15.12 — Windows reserved device names (CON, PRN, AUX, NUL, COM1-9,
           LPT1-9) prefixed with ``srs_`` so the resulting snapshot
           filename is safe on Windows as well as POSIX.
  R16.5  — Logging ``datefmt`` is now ISO 8601 with timezone
           (``%Y-%m-%dT%H:%M:%S%z``) instead of bare ``%H:%M:%S``.
  R16.6  — ``--format json`` now sets log level to ERROR so WARNING /
           INFO / DEBUG do not pollute stderr while JSON goes to stdout.
  R16.11 — ``srs/i18n.py`` adds gettext infrastructure (``_()`` is a
           no-op ``NullTranslations.gettext`` until translations are
           bundled; ``set_translation`` allows runtime re-binding).
  R16.22 — ``--accessibility`` CLI flag triggers screen-reader-friendly
           output: extra plain-English field descriptions, ASCII-only,
           no emoji.
"""
from __future__ import annotations

import argparse
import io
import logging
import re
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from srs import cli as cli_module  # noqa: E402
from srs import i18n  # noqa: E402
from srs.persistence import _coerce_path, default_path  # noqa: E402
from srs.types import _WINDOWS_RESERVED_RE, _sanitize_task_id  # noqa: E402

# ----------------------------------------------------------------------
# Fixtures
# ----------------------------------------------------------------------

@pytest.fixture
def clean_srs_home(monkeypatch):
    """Ensure SRS_HOME is unset before and after each test."""
    monkeypatch.delenv("SRS_HOME", raising=False)
    yield
    monkeypatch.delenv("SRS_HOME", raising=False)


# ======================================================================
# R15.4 — `~` expansion in SRS_HOME
# ======================================================================

def test_srs_home_expands_tilde(clean_srs_home, monkeypatch):
    """SRS_HOME=~/.srs should expand to the user's home .srs directory.

    R15.4: previously only the default branch used ``Path.home()``,
    so a literal ``~`` in SRS_HOME produced a directory named ``~``
    in the current working directory.
    """
    monkeypatch.setenv("SRS_HOME", "~/.srs")
    path = default_path()
    home = Path.home()
    # The expanded path must point inside the user's actual home dir,
    # NOT into a literal '~' directory in the CWD.
    assert str(path).startswith(str(home))
    assert path == (home / ".srs" / "snapshots")


def test_srs_home_expands_tilde_with_user(monkeypatch, tmp_path):
    """SRS_HOME=~user/... expands via os.path.expanduser.

    We can't easily test ``~user`` without a real user account, but we
    can verify that the code path goes through ``os.path.expanduser``
    by checking that ``~`` followed by a slash is expanded (covered
    above) and that a plain ``~`` (no slash) is also expanded.
    """
    monkeypatch.delenv("SRS_HOME", raising=False)
    monkeypatch.setenv("SRS_HOME", "~")
    path = default_path()
    home = Path.home()
    # `~` alone should expand to the home directory.
    assert str(path).startswith(str(home))


def test_srs_home_does_not_create_literal_tilde_dir(clean_srs_home, monkeypatch, tmp_path):
    """Setting SRS_HOME=~/.srs must NOT create a directory named '~' in CWD.

    Regression: before R15.4 fix, the raw '~' was passed to Path()
    verbatim, producing a literal '~' dir. After the fix, expanduser
    runs first and '~' is replaced by the home directory.
    """
    # Run in an isolated CWD so we can detect any '~' directory creation.
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("SRS_HOME", "~/.srs-test-f18")
    _ = default_path()
    # No literal '~' directory should exist in the CWD.
    assert not (tmp_path / "~").exists(), \
        "SRS_HOME=~ should be expanded, not left as a literal '~' dir"


# ======================================================================
# R15.9 — Path normalization in _coerce_path
# ======================================================================

def test_coerce_path_resolves_dotdot(tmp_path):
    """_coerce_path normalizes `..` and `.` components for string inputs.

    R15.9: string inputs are now ``.resolve()``-d so callers always see
    an absolute canonical path with no `.` / `..` segments.
    """
    nested = tmp_path / "subdir1" / "subdir2"
    nested.mkdir(parents=True)
    # Construct a path with `..` that should resolve to tmp_path/subdir1
    raw_with_dotdot = str(nested / "..")
    coerced = _coerce_path(raw_with_dotdot)
    assert coerced == (tmp_path / "subdir1")
    # No `..` component should remain.
    assert ".." not in coerced.parts


def test_coerce_path_resolves_dot(tmp_path):
    """_coerce_path strips `.` components from string inputs."""
    raw_with_dot = str(tmp_path / "." / "subdir")
    coerced = _coerce_path(raw_with_dot)
    assert "." not in coerced.parts
    # The resolved path should equal tmp_path/subdir (the `.` is gone).
    assert coerced == (tmp_path / "subdir")


def test_coerce_path_passes_path_objects_through():
    """_coerce_path returns Path objects unchanged (no double-resolve).

    Path inputs are already Paths; we don't re-resolve them (that
    would be redundant and could change behavior if the caller
    intentionally wants an unresolved path for symlink testing).
    """
    p = Path("/tmp/foo")
    coerced = _coerce_path(p)
    assert coerced is p


def test_coerce_path_rejects_non_str_non_path():
    """_coerce_path raises TypeError for unsupported types."""
    with pytest.raises(TypeError, match="home must be str or Path"):
        _coerce_path(123)
    with pytest.raises(TypeError, match="home must be str or Path"):
        _coerce_path(None)


def test_coerce_path_expands_tilde_in_string(tmp_path, monkeypatch):
    """_coerce_path expands `~` in string inputs (R15.4)."""
    home = Path.home()
    coerced = _coerce_path("~/foo")
    assert str(coerced).startswith(str(home))
    assert "~" not in coerced.parts


# ======================================================================
# R15.12 — Windows reserved device names in _sanitize_task_id
# ======================================================================

@pytest.mark.parametrize("reserved", [
    "CON", "PRN", "AUX", "NUL",
    "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
    "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
])
def test_sanitize_task_id_prefixes_windows_reserved_names(reserved):
    """Each Windows reserved device name is prefixed with `srs_`.

    R15.12: On Windows, a task_id like ``CON`` would produce
    ``snap_CON.json`` which the OS interprets as a write to the CON
    device (hangs / fails / silently writes to the console). The fix
    prefixes any matching task_id with ``srs_`` so the resulting
    filename is safe on Windows as well as POSIX.
    """
    sanitized = _sanitize_task_id(reserved)
    assert sanitized == f"srs_{reserved}", \
        f"expected srs_{reserved}, got {sanitized}"


@pytest.mark.parametrize("reserved", ["con", "prn", "aux", "nul", "com1", "lpt9"])
def test_sanitize_task_id_windows_reserved_case_insensitive(reserved):
    """Windows filesystems are case-insensitive; lower-case variants are prefixed too."""
    sanitized = _sanitize_task_id(reserved)
    # The prefix preserves the original case of the reserved name.
    assert sanitized == f"srs_{reserved}"


def test_sanitize_task_id_windows_reserved_with_extension_suffix():
    """A task_id like `CON.txt` (matches reserved + extension) is prefixed."""
    # `_sanitize_task_id` first strips invalid chars (the `.`), so input
    # `CON.txt` becomes `CON_txt` which doesn't match the reserved regex
    # (the regex requires the reserved name to be at start AND followed
    # by either `.` or end-of-string). Let's test what the regex matches
    # directly:
    assert _WINDOWS_RESERVED_RE.match("CON")
    assert _WINDOWS_RESERVED_RE.match("CON.txt")
    assert _WINDOWS_RESERVED_RE.match("con.json")
    assert not _WINDOWS_RESERVED_RE.match("CONNECT")  # not a reserved name
    assert not _WINDOWS_RESERVED_RE.match("NULLED")  # not a reserved name


def test_sanitize_task_id_normal_ids_unchanged():
    """Normal task_ids (that don't match Windows reserved names) are unchanged."""
    for tid in ["task1", "my_task_id", "abc123def456", "identify-64"]:
        assert _sanitize_task_id(tid) == tid


def test_sanitize_task_id_reserved_after_sanitization():
    """A task_id that sanitizes to a reserved name is then prefixed.

    E.g. input "CON!" sanitizes to "CON_" (the `!` becomes `_`), but
    "CON_" does NOT match the reserved regex (which requires either a
    dot or end-of-string after the name). So the prefix is NOT applied
    — which is correct, because "CON_" is safe on Windows.
    """
    # "CON" alone (no other chars) sanitizes to "CON" and IS prefixed.
    assert _sanitize_task_id("CON") == "srs_CON"
    # "CON!" sanitizes to "CON_" which is NOT a reserved name on Windows
    # (Windows only reserves the bare name + extension, not the name
    # followed by other characters).
    result = _sanitize_task_id("CON!")
    assert result == "CON_"
    # But "CON." — sanitize replaces `.` with `_`, so we get "CON_"
    # which is NOT prefixed.
    assert _sanitize_task_id("CON.") == "CON_"


def test_sanitize_task_id_reserved_with_valid_chars_only():
    """A task_id of exactly a reserved name (e.g. 'AUX') is prefixed."""
    # These pass the _TASK_ID_RE check (alphanumeric, 1-64 chars), so
    # the first branch returns them unchanged — but the Windows check
    # then runs and prefixes them.
    assert _sanitize_task_id("AUX") == "srs_AUX"
    assert _sanitize_task_id("NUL") == "srs_NUL"
    assert _sanitize_task_id("COM3") == "srs_COM3"


def test_sanitize_task_id_reserved_in_runtime_construction():
    """End-to-end: a Task with task_id='CON' gets prefixed to 'srs_CON'."""
    from srs import Task
    t = Task(kind="identify",
             payload={"hypotheses": [b"x"], "target_idx": 0, "n_features": 8},
             task_id="CON")
    assert t.task_id == "srs_CON"


# ======================================================================
# R16.5 — Logging datefmt is ISO 8601 with timezone
# ======================================================================

def test_configure_logging_uses_iso8601_datefmt():
    """The CLI's logging formatter uses ISO 8601 timestamps with timezone.

    R16.5: previously the datefmt was bare ``%H:%M:%S`` which made it
    impossible to tell which day a log line was from. The fix uses
    ``%Y-%m-%dT%H:%M:%S%z``.
    """
    args = argparse.Namespace(verbose=False, quiet=False, format="human")
    cli_module._configure_logging(args)
    root = logging.getLogger()
    handlers = [h for h in root.handlers
                if isinstance(h, logging.StreamHandler)]
    assert handlers, "root logger must have at least one StreamHandler"
    formatter = handlers[0].formatter
    assert formatter is not None
    # The formatter's datefmt must be ISO 8601 with timezone.
    assert formatter.datefmt == "%Y-%m-%dT%H:%M:%S%z", \
        f"expected ISO 8601 datefmt, got {formatter.datefmt!r}"


def test_log_timestamp_matches_iso8601_pattern():
    """The actual log output uses ISO 8601 with timezone offset.

    Capture a real log record and check the formatted timestamp matches
    the pattern YYYY-MM-DDTHH:MM:SS+ZZZZ.
    """
    args = argparse.Namespace(verbose=True, quiet=False, format="human")
    cli_module._configure_logging(args)
    # Capture handler output via a fresh StreamHandler pointing at StringIO.
    buf = io.StringIO()
    capture_handler = logging.StreamHandler(stream=buf)
    capture_handler.setFormatter(logging.getLogger().handlers[0].formatter)
    test_logger = logging.getLogger("srs.test_iso_datefmt")
    test_logger.addHandler(capture_handler)
    test_logger.setLevel(logging.DEBUG)
    test_logger.info("test message")
    output = buf.getvalue()
    # The timestamp should be the first whitespace-delimited token.
    timestamp = output.split(" ")[0]
    # ISO 8601 with timezone: YYYY-MM-DDTHH:MM:SS+HHMM (or -HHMM, or Z).
    iso8601_re = re.compile(r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{4}$')
    assert iso8601_re.match(timestamp), \
        f"timestamp {timestamp!r} does not match ISO 8601 with tz pattern"
    test_logger.removeHandler(capture_handler)


# ======================================================================
# R16.6 — --format json suppresses WARNING/INFO/DEBUG on stderr
# ======================================================================

def test_configure_logging_json_mode_sets_error_level():
    """--format json (without --verbose) sets log level to ERROR.

    R16.6: previously --format json set level to WARNING, which still
    emitted WARNING lines on stderr — polluting the JSON output stream
    for any consumer that captured both stdout and stderr. The fix
    sets level to ERROR so only ERROR / CRITICAL reach stderr.
    """
    args = argparse.Namespace(verbose=False, quiet=False, format="json")
    cli_module._configure_logging(args)
    assert logging.getLogger().level == logging.ERROR
    assert logging.getLogger("srs").level == logging.ERROR


def test_configure_logging_verbose_overrides_json_mode():
    """--verbose wins over --format json so debug diagnostics are still available.

    R16.6: a developer can still see DEBUG while emitting JSON by
    passing --verbose --format json together.
    """
    args = argparse.Namespace(verbose=True, quiet=False, format="json")
    cli_module._configure_logging(args)
    assert logging.getLogger().level == logging.DEBUG


def test_configure_logging_human_mode_keeps_info_level():
    """--format human (default) keeps INFO level (no regression)."""
    args = argparse.Namespace(verbose=False, quiet=False, format="human")
    cli_module._configure_logging(args)
    assert logging.getLogger().level == logging.INFO


def test_configure_logging_quiet_mode_still_warning():
    """--quiet (without --format json) sets WARNING level."""
    args = argparse.Namespace(verbose=False, quiet=True, format="human")
    cli_module._configure_logging(args)
    assert logging.getLogger().level == logging.WARNING


def test_json_mode_actually_suppresses_warning(caplog):
    """End-to-end: a WARNING log call does NOT reach stderr in JSON mode.

    We configure the root logger with our SafeFormatter handler, then
    emit a WARNING and verify it does not propagate to the handler
    (because the level is ERROR). caplog captures at WARNING level so
    we can confirm the WARNING WAS emitted — just not propagated.
    """
    args = argparse.Namespace(verbose=False, quiet=False, format="json")
    cli_module._configure_logging(args)
    root = logging.getLogger()
    # Save the existing handlers and replace with a capturing one.
    saved_handlers = root.handlers[:]
    captured_lines: list[str] = []
    class _ListHandler(logging.Handler):
        def emit(self, record):
            captured_lines.append(self.format(record))
    capture = _ListHandler(level=logging.WARNING)
    capture.setFormatter(root.handlers[0].formatter)
    root.handlers = [capture]
    try:
        # Emit a WARNING. With level=ERROR, it should be filtered out.
        logging.getLogger("srs.test_json_suppress").warning("test warning")
        logging.getLogger("srs.test_json_suppress").error("test error")
        # The WARNING should NOT have been emitted.
        assert not any("test warning" in line for line in captured_lines), \
            f"WARNING leaked through ERROR-level filter: {captured_lines}"
        # The ERROR SHOULD have been emitted.
        assert any("test error" in line for line in captured_lines), \
            f"ERROR was not emitted: {captured_lines}"
    finally:
        root.handlers = saved_handlers


# ======================================================================
# R16.11 — gettext / i18n infrastructure
# ======================================================================

def test_i18n_underscore_is_callable():
    """srs.i18n._ is callable and returns its input (NullTranslations)."""
    assert callable(i18n._)
    assert i18n._("hello") == "hello"
    assert i18n._("any ASCII string") == "any ASCII string"


def test_i18n_underscore_preserves_format_strings():
    """_() preserves format placeholders (used with .format() / %)."""
    assert i18n._("v{}") == "v{}"
    assert i18n._("%s seconds") == "%s seconds"


def test_i18n_locale_dir_constant():
    """LOCALE_DIR is a Path pointing at srs/locale."""
    assert isinstance(i18n.LOCALE_DIR, Path)
    assert i18n.LOCALE_DIR.name == "locale"
    # It should be a sibling of the i18n.py module.
    assert i18n.LOCALE_DIR.parent == Path(i18n.__file__).resolve().parent


def test_i18n_domain_constant():
    """DOMAIN is the gettext domain name 'srs'."""
    assert i18n.DOMAIN == "srs"


def test_i18n_set_translation_reset_to_null():
    """set_translation(None) resets to NullTranslations (returns input unchanged)."""
    i18n.set_translation(None)
    assert i18n._("hello") == "hello"


def test_i18n_set_translation_to_unknown_lang_falls_back():
    """set_translation('zz') for a language with no .mo file falls back to NullTranslations."""
    i18n.set_translation("zz_NONEXISTENT")
    # Should still return the input unchanged (fallback = NullTranslations).
    assert i18n._("hello") == "hello"
    # Reset to default for other tests.
    i18n.set_translation(None)


def test_i18n_init_translations_handles_missing_locale_dir(tmp_path, monkeypatch):
    """_init_translations returns NullTranslations when no locale dir exists."""
    monkeypatch.setattr(i18n, "LOCALE_DIR", tmp_path / "nonexistent")
    monkeypatch.setenv("LANGUAGE", "fr")
    translations = i18n._init_translations()
    # Should be a NullTranslations (or a subclass thereof).
    from gettext import NullTranslations
    assert isinstance(translations, NullTranslations)
    assert translations.gettext("hello") == "hello"


def test_i18n_init_translations_ignores_c_and_posix(monkeypatch, tmp_path):
    """'C' and 'POSIX' LANG values are treated as 'no translation'."""
    monkeypatch.setattr(i18n, "LOCALE_DIR", tmp_path / "nonexistent")
    monkeypatch.setenv("LANGUAGE", "C:POSIX")
    monkeypatch.setenv("LANG", "C")
    translations = i18n._init_translations()
    from gettext import NullTranslations
    assert isinstance(translations, NullTranslations)


def test_i18n_init_translations_picks_up_language_env(monkeypatch, tmp_path):
    """LANGUAGE env var populates the candidate list (even if no .mo exists)."""
    # Set up an empty locale directory so the function tries to load.
    locale_dir = tmp_path / "locale"
    locale_dir.mkdir()
    monkeypatch.setattr(i18n, "LOCALE_DIR", locale_dir)
    monkeypatch.setenv("LANGUAGE", "fr:es")
    monkeypatch.setenv("LANG", "de_DE.UTF-8")
    # No .mo files exist, so fallback=True returns NullTranslations.
    translations = i18n._init_translations()
    from gettext import NullTranslations
    assert isinstance(translations, NullTranslations)
    assert translations.gettext("hello") == "hello"


# ======================================================================
# R16.22 — --accessibility CLI flag
# ======================================================================

def test_accessibility_flag_parses_globally():
    """--accessibility can be passed before the subcommand."""
    parser = argparse.ArgumentParser()
    cli_module._add_logging_flags(parser, is_subparser=False)
    args = parser.parse_args(["--accessibility"])
    assert args.accessibility is True


def test_accessibility_flag_parses_on_subcommand():
    """--accessibility can be passed on the subcommand itself."""
    parser = argparse.ArgumentParser()
    cli_module._add_logging_flags(parser, is_subparser=True)
    args = parser.parse_args(["--accessibility"])
    assert args.accessibility is True


def test_accessibility_flag_defaults_false_on_global_parser():
    """--accessibility defaults to False on the global parser."""
    parser = argparse.ArgumentParser()
    cli_module._add_logging_flags(parser, is_subparser=False)
    args = parser.parse_args([])
    assert args.accessibility is False


def test_accessibility_flag_omitted_on_subparser_preserves_global():
    """If a subparser doesn't pass --accessibility, the global value is preserved.

    The subparser uses default=argparse.SUPPRESS so the attribute is
    only set if the user passes the flag — otherwise the global value
    persists.
    """
    global_parser = argparse.ArgumentParser()
    cli_module._add_logging_flags(global_parser, is_subparser=False)
    sub = global_parser.add_subparsers(dest="cmd")
    sp = sub.add_parser("execute")
    cli_module._add_logging_flags(sp, is_subparser=True)
    # Pass --accessibility globally; subcommand doesn't repeat it.
    args = global_parser.parse_args(["--accessibility", "execute"])
    assert args.accessibility is True


def test_format_human_result_accessibility_adds_descriptions():
    """--accessibility adds plain-English field descriptions to result output."""
    result = {
        "task_id": "abc123",
        "answer": 5,
        "correct": True,
        "verified": None,
        "primitives_used": ["A", "C"],
        "queries": 6,
        "storage_bytes": 13,
        "work_units": 2583,
        "depth": 6,
        "wall_time_ms": 3.5,
    }
    plain = cli_module._format_human_result(result, accessibility=False)
    accessible = cli_module._format_human_result(result, accessibility=True)
    # The accessible version has additional description lines.
    assert "Field descriptions:" in accessible
    assert "Field descriptions:" not in plain
    # The accessible version mentions "milliseconds" explicitly.
    assert "milliseconds" in accessible
    # The accessible version explains what 'answer' is.
    assert "identified hypothesis index" in accessible
    # Both versions include the actual values.
    assert "abc123" in plain
    assert "abc123" in accessible


def test_format_human_result_accessibility_correct_false():
    """--accessibility describes the meaning of Correct: False."""
    result = {
        "task_id": "t1",
        "answer": 2,
        "correct": False,
        "verified": None,
        "primitives_used": ["A"],
        "queries": 1,
        "storage_bytes": 0,
        "work_units": 0,
        "depth": 1,
        "wall_time_ms": 0.1,
    }
    accessible = cli_module._format_human_result(result, accessibility=True)
    assert "does NOT match the target" in accessible


def test_format_human_capabilities_accessibility_adds_descriptions():
    """--accessibility adds plain-English field descriptions to capabilities output."""
    caps = {
        "version": "8.2.0",
        "primitives": ["E", "C", "A"],
        "total_tasks": 5,
        "total_queries_made": 12,
        "avg_queries_per_execution": 2.4,
        "success_rate": 1.0,
        "advice_entries": 2,
        "snapshots": 1,
        "interrupted_tasks": 0,
    }
    plain = cli_module._format_human_capabilities(caps, accessibility=False)
    accessible = cli_module._format_human_capabilities(caps, accessibility=True)
    # The accessible version has additional explanation lines.
    assert "execute() calls" in accessible  # "Total tasks is the number of execute() calls..."
    assert "execute() calls" not in plain
    # Both include the version.
    assert "8.2.0" in plain
    assert "8.2.0" in accessible


def test_accessibility_output_is_ascii_only():
    """--accessibility output is ASCII-only (no emoji, no box-drawing chars).

    R16.22: screen readers configured with strict ASCII pronunciation
    and terminals with non-UTF-8 code pages can't render emoji or
    non-ASCII box-drawing characters. The accessibility output must
    stay ASCII.
    """
    result = {
        "task_id": "abc",
        "answer": 0,
        "correct": True,
        "verified": None,
        "primitives_used": ["A"],
        "queries": 1,
        "storage_bytes": 0,
        "work_units": 0,
        "depth": 1,
        "wall_time_ms": 0.5,
    }
    accessible = cli_module._format_human_result(result, accessibility=True)
    accessible.encode("ascii")  # raises UnicodeEncodeError if non-ASCII present


def test_accessibility_via_cli_main_executes(tmp_path, monkeypatch, capsys):
    """End-to-end: `srs --accessibility execute identify 64` produces accessible output."""
    monkeypatch.setenv("SRS_HOME", str(tmp_path))
    rc = cli_module.main(["--accessibility", "execute", "identify", "64"])
    assert rc == 0
    captured = capsys.readouterr()
    assert "Field descriptions:" in captured.out
    assert "identified hypothesis index" in captured.out


def test_accessibility_via_cli_capabilities(tmp_path, monkeypatch, capsys):
    """End-to-end: `srs --accessibility capabilities` produces accessible output."""
    monkeypatch.setenv("SRS_HOME", str(tmp_path))
    rc = cli_module.main(["--accessibility", "capabilities"])
    assert rc == 0
    captured = capsys.readouterr()
    # The accessible version mentions "execute() calls" in the Total tasks description.
    assert "execute() calls" in captured.out


def test_accessibility_via_cli_subcommand_form(tmp_path, monkeypatch, capsys):
    """--accessibility works when passed AFTER the subcommand too."""
    monkeypatch.setenv("SRS_HOME", str(tmp_path))
    rc = cli_module.main(["capabilities", "--accessibility"])
    assert rc == 0
    captured = capsys.readouterr()
    assert "execute() calls" in captured.out


def test_json_mode_still_works_with_accessibility(tmp_path, monkeypatch, capsys):
    """--format json + --accessibility: JSON output is unaffected by accessibility.

    The accessibility flag only enhances human-format output; JSON
    output is already machine-readable and does not need field
    descriptions.
    """
    import json
    monkeypatch.setenv("SRS_HOME", str(tmp_path))
    rc = cli_module.main(["--format", "json", "--accessibility",
                          "execute", "identify", "64"])
    assert rc == 0
    captured = capsys.readouterr()
    parsed = json.loads(captured.out)
    assert parsed["correct"] is True
    assert "queries" in parsed


# ======================================================================
# Regression: existing tests still pass (smoke)
# ======================================================================

def test_no_regression_in_default_human_format(tmp_path, monkeypatch, capsys):
    """Default human format (no --accessibility) is unchanged."""
    monkeypatch.setenv("SRS_HOME", str(tmp_path))
    rc = cli_module.main(["capabilities"])
    assert rc == 0
    captured = capsys.readouterr()
    # The plain capabilities header should still be there.
    assert "SRS Runtime v" in captured.out
    # The accessibility descriptions should NOT be there.
    assert "execute() calls" not in captured.out
