"""Tests for v8.0 log injection + SRS_HOME fixes.

v8.0 closes two LOW-severity findings from the security audit and
adds a structured logging formatter:

  - Log injection prevention: ``task_id`` is now sanitized at the
    input boundary (in Task.__post_init__ and via the task_id property
    setter), but defense in depth requires that logging ALSO sanitize
    user-controlled values. A future code path that bypasses the input
    validator (e.g. a new API endpoint that forgets to call
    ``_sanitize_task_id``) would re-open the log-injection vector.
    v8.0 adds ``_safe_log_value`` and wraps every logger call that
    interpolates a user-controlled value (task_id, snapshot_id,
    snapshot path, home dir, exception messages tied to a user id).

  - SRS_HOME validation: the ``SRS_HOME`` environment variable was
    read verbatim and used as the snapshots-directory base. A malicious
    or misconfigured ``SRS_HOME=/dev/null`` would cause every save()
    to raise ``NotADirectoryError`` deep in ``_atomic_write_json``, and
    ``SRS_HOME=/proc/self/fd/...`` could clobber an unrelated open
    file descriptor. v8.0 validates the resolved path against a
    blocklist of system pseudo-filesystem mount points and falls back
    to the default ``~/.srs/snapshots`` on rejection.

  - Structured logging formatter: the ``SafeFormatter`` class is a
    ``logging.Formatter`` subclass that escapes ``\\n`` / ``\\r`` in
    the FINAL formatted message. This is the second layer of defense:
    even if a value slips past ``_safe_log_value`` (e.g. an
    exception's ``__str__`` returns a multiline traceback), the log
    line stays single-line.
"""
import io
import logging
import os
import sys
import tempfile
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from srs.persistence import (  # noqa: E402
    SafeFormatter,
    _safe_log_value,
    default_path,
)


# ---------- _safe_log_value ----------

def test_safe_log_value_strips_control_chars():
    """Test that control characters are stripped from log values."""
    assert _safe_log_value("hello\nworld") == "helloworld"  # newline removed
    assert _safe_log_value("hello\rworld") == "helloworld"  # carriage return removed
    assert _safe_log_value("hello\x00world") == "helloworld"  # null removed
    assert _safe_log_value("hello\x01\x02world") == "helloworld"  # control chars removed


def test_safe_log_value_strips_ansi_escape():
    """Test that the ESC character (\\x1b) of ANSI sequences is stripped.

    Without this, an attacker could inject terminal-control codes that
    hide a fake "execute: complete" line by clearing the screen first.
    The remaining printable chars of the escape sequence (``[2J`` etc.)
    are left in place — they're just text without the leading ESC.
    """
    # \x1b is the ESC control char that starts an ANSI escape sequence.
    # It MUST be stripped (ord 27 < 32). The trailing printable chars
    # ([2J) are left as-is — they're harmless text without the ESC.
    assert _safe_log_value("\x1b[2Jfake_log_line") == "[2Jfake_log_line"
    # The ESC alone is stripped:
    assert _safe_log_value("evil\x1b[0m_safe") == "evil[0m_safe"
    # The SafeFormatter layer would also escape any embedded \n in the
    # final log message — see test_safe_formatter_strips_newlines.


def test_safe_log_value_truncates():
    """Test that huge values are truncated to prevent log flooding."""
    long_value = "a" * 100
    result = _safe_log_value(long_value, max_len=10)
    assert len(result) <= 13  # 10 + "..."
    assert result.endswith("...")
    assert result.startswith("a")


def test_safe_log_value_preserves_normal():
    """Normal ASCII values pass through unchanged."""
    assert _safe_log_value("normal_task_123") == "normal_task_123"
    assert _safe_log_value("snap_abc123def456") == "snap_abc123def456"
    # Path-like values are fine too.
    assert _safe_log_value("/tmp/foo/bar") == "/tmp/foo/bar"


def test_safe_log_value_preserves_space():
    """Space (0x20) is explicitly preserved (it's a printable char)."""
    assert _safe_log_value("hello world") == "hello world"
    # Tab (0x09) is NOT preserved (it's a control char).
    assert _safe_log_value("hello\tworld") == "helloworld"


def test_safe_log_value_non_string():
    """Non-string values are stringified then sanitized."""
    # Int — no control chars, passes through as str().
    assert _safe_log_value(42) == "42"
    # Path — stringified then sanitized.
    assert _safe_log_value(Path("/tmp/foo")) == "/tmp/foo"
    # None — stringified to "None".
    assert _safe_log_value(None) == "None"


def test_safe_log_value_default_max_len_64():
    """Default max_len is 64 (per the task spec)."""
    result = _safe_log_value("a" * 200)
    # 64 chars + "..." = 67 total.
    assert len(result) == 67
    assert result.endswith("...")


# ---------- SafeFormatter ----------

def test_safe_formatter_strips_newlines():
    """Test that SafeFormatter escapes \\n / \\r in the final message."""
    formatter = SafeFormatter("%(levelname)s: %(message)s")
    record = logging.LogRecord(
        name="test", level=logging.INFO, pathname="", lineno=0,
        msg="task_id=%s status=%s",
        args=("evil\ngreen INFO execute: complete", "ok"),
        exc_info=None,
    )
    out = formatter.format(record)
    # The newline MUST have been escaped — the line stays single-line.
    assert "\n" not in out
    assert "\\n" in out  # the literal escape sequence is present
    # The injected "green INFO execute: complete" must NOT appear as a
    # separate log line — it's collapsed onto the original line.
    assert "evil\\ngreen INFO execute: complete" in out


def test_safe_formatter_strips_carriage_returns():
    """Test that SafeFormatter escapes \\r in the final message."""
    formatter = SafeFormatter("%(message)s")
    record = logging.LogRecord(
        name="test", level=logging.INFO, pathname="", lineno=0,
        msg="task_id=%s",
        args=("evil\rreset_term",),
        exc_info=None,
    )
    out = formatter.format(record)
    assert "\r" not in out
    assert "\\r" in out


def test_safe_formatter_preserves_normal_messages():
    """Test that SafeFormatter passes through messages with no newlines unchanged."""
    formatter = SafeFormatter("%(levelname)s: %(message)s")
    record = logging.LogRecord(
        name="test", level=logging.INFO, pathname="", lineno=0,
        msg="execute: complete task_id=%s queries=%d",
        args=("task_abc", 5),
        exc_info=None,
    )
    out = formatter.format(record)
    assert out == "INFO: execute: complete task_id=task_abc queries=5"


# ---------- default_path / SRS_HOME validation ----------

@pytest.fixture
def clean_srs_home(monkeypatch):
    """Ensure SRS_HOME is unset before and after each test."""
    monkeypatch.delenv("SRS_HOME", raising=False)
    yield
    monkeypatch.delenv("SRS_HOME", raising=False)


def test_srs_home_rejects_dev(clean_srs_home, monkeypatch):
    """Test that SRS_HOME pointing to /dev is rejected."""
    monkeypatch.setenv("SRS_HOME", "/dev/null")
    path = default_path()
    assert not str(path).startswith("/dev"), \
        f"SRS_HOME=/dev/null should be rejected, got {path}"


def test_srs_home_rejects_proc(clean_srs_home, monkeypatch):
    """Test that SRS_HOME pointing to /proc is rejected."""
    monkeypatch.setenv("SRS_HOME", "/proc/self")
    path = default_path()
    assert not str(path).startswith("/proc"), \
        f"SRS_HOME=/proc/self should be rejected, got {path}"


def test_srs_home_rejects_sys(clean_srs_home, monkeypatch):
    """Test that SRS_HOME pointing to /sys is rejected."""
    monkeypatch.setenv("SRS_HOME", "/sys/kernel")
    path = default_path()
    assert not str(path).startswith("/sys"), \
        f"SRS_HOME=/sys/kernel should be rejected, got {path}"


def test_srs_home_rejects_dev_zero(clean_srs_home, monkeypatch):
    """Test that SRS_HOME pointing to /dev/zero is rejected."""
    monkeypatch.setenv("SRS_HOME", "/dev/zero")
    path = default_path()
    assert not str(path).startswith("/dev"), \
        f"SRS_HOME=/dev/zero should be rejected, got {path}"


def test_srs_home_rejects_existing_file(clean_srs_home, monkeypatch, tmp_path):
    """Test that SRS_HOME pointing to a regular file is rejected.

    Writing snapshots inside a regular file would either fail or
    silently clobber the file. Reject early with a clear log message
    instead of letting save() raise a cryptic NotADirectoryError.
    """
    regular_file = tmp_path / "i_am_a_file_not_a_dir"
    regular_file.write_text("hello")
    monkeypatch.setenv("SRS_HOME", str(regular_file))
    path = default_path()
    # Must fall back to the default — must NOT point inside the file.
    assert path != regular_file / "snapshots"
    assert path.name == "snapshots"


def test_srs_home_accepts_valid(clean_srs_home, monkeypatch, tmp_path):
    """Test that a legitimate SRS_HOME (tempdir) is accepted."""
    monkeypatch.setenv("SRS_HOME", str(tmp_path))
    path = default_path()
    assert str(path).startswith(str(tmp_path))
    assert path.name == "snapshots"


def test_srs_home_accepts_nested_subdir(clean_srs_home, monkeypatch, tmp_path):
    """Test that SRS_HOME pointing to a non-existent but valid subdir is OK.

    The path doesn't need to exist yet — save() will mkdir it on demand.
    """
    nested = tmp_path / "subdir1" / "subdir2"
    monkeypatch.setenv("SRS_HOME", str(nested))
    path = default_path()
    assert path == nested / "snapshots"


def test_srs_home_unset_falls_back_to_default(clean_srs_home):
    """Test that no SRS_HOME → default ~/.srs/snapshots."""
    path = default_path()
    expected = Path.home() / ".srs" / "snapshots"
    assert path == expected


def test_srs_home_dev_subdir_also_rejected(clean_srs_home, monkeypatch):
    """Test that /dev/something (any subdir) is rejected.

    Defense in depth — even if /dev/some_new_device is a real directory,
    we don't trust anything under /dev/ because the kernel can hot-plug
    device files there.
    """
    monkeypatch.setenv("SRS_HOME", "/dev/shm")  # /dev/shm is real on Linux
    path = default_path()
    assert not str(path).startswith("/dev"), \
        f"SRS_HOME=/dev/shm should be rejected, got {path}"


# ---------- Integration: end-to-end log injection prevention ----------

def test_log_injection_prevented_end_to_end(tmp_path, caplog):
    """Test that an evil task_id with newlines cannot inject fake log lines.

    Even though task_id is sanitized at the input boundary, we test
    the DEFENSE-IN-DEPTH layer: if a task_id with newlines ever reaches
    a logger call, the newline is stripped.
    """
    from srs import Runtime, Task
    from srs.persistence import _safe_log_value

    evil_id = "evil\ngreen INFO execute: complete task_id=fake"
    # Direct call to _safe_log_value simulates what every logger.debug
    # / logger.info call now does.
    sanitized = _safe_log_value(evil_id)
    assert "\n" not in sanitized
    assert "green INFO execute: complete" in sanitized  # still in the message
    # but on the SAME line, not a separate fake log line.

    # Also verify the SafeFormatter layer catches anything that slips
    # past _safe_log_value (e.g. an exception whose __str__ returns a
    # multiline traceback).
    formatter = SafeFormatter("%(message)s")
    record = logging.LogRecord(
        name="test", level=logging.INFO, pathname="", lineno=0,
        msg="error: %s",
        args=("evil\nfake INFO line",),
        exc_info=None,
    )
    assert "\n" not in formatter.format(record)


def test_safe_formatter_applied_to_cli_handler():
    """Test that the CLI's _configure_logging installs SafeFormatter on the
    root logger's StreamHandler.

    This is the integration test: the formatter isn't just defined, it's
    actually USED by the CLI when run.
    """
    import argparse
    import srs.cli as cli

    args = argparse.Namespace(verbose=False, quiet=True, format="human")
    cli._configure_logging(args)

    root = logging.getLogger()
    assert len(root.handlers) >= 1, "root logger must have at least one handler"
    # At least one handler should be using SafeFormatter.
    has_safe = any(
        isinstance(h, logging.StreamHandler)
        and isinstance(h.formatter, SafeFormatter)
        for h in root.handlers
    )
    assert has_safe, \
        f"root logger handlers must include a SafeFormatter-wrapped handler, " \
        f"got {[type(h).__name__ + '/' + type(h.formatter).__name__ if h.formatter else 'None' for h in root.handlers]}"


def test_runtime_logs_sanitized_task_id(tmp_path, caplog):
    """Test that when Runtime.execute logs a task_id, the value is sanitized.

    We use caplog to capture the log records emitted during a real
    execute() call and assert that none of them contain raw newlines
    in their formatted message — even if the task_id somehow contained
    one (it can't anymore thanks to input-boundary sanitization, but
    defense in depth).
    """
    from srs import Runtime, Task
    import hashlib

    rt = Runtime(home=tmp_path)
    hyps = [hashlib.sha256(f"h{i}".encode()).digest() for i in range(8)]
    task = Task(kind="identify",
                payload={"hypotheses": hyps, "target_idx": 3, "n_features": 12},
                budget=8)

    with caplog.at_level(logging.DEBUG, logger="srs.runtime"):
        rt.execute(task)

    # Every formatted log line must be single-line (no raw \n).
    for record in caplog.records:
        formatted = record.getMessage()
        assert "\n" not in formatted, \
            f"runtime log line contains newline (log injection): {formatted!r}"
        assert "\r" not in formatted, \
            f"runtime log line contains carriage return: {formatted!r}"


def test_persistence_logs_sanitized_paths(tmp_path, caplog):
    """Test that persistence.py log messages sanitize snap_path / fpath / p.

    We trigger a save + load cycle and assert that no log record's
    formatted message contains a raw newline.
    """
    from srs import Runtime, Task
    from srs.persistence import _iso_now, Snapshot, save, load_latest
    import hashlib

    # Save a snapshot.
    snap = Snapshot(snapshot_id="testsnap1", timestamp=_iso_now(),
                    advice_table={"x": 1}, primitive_stats={})
    save(snap, tmp_path)

    with caplog.at_level(logging.DEBUG, logger="srs.persistence"):
        load_latest(tmp_path)

    for record in caplog.records:
        formatted = record.getMessage()
        assert "\n" not in formatted, \
            f"persistence log line contains newline: {formatted!r}"
