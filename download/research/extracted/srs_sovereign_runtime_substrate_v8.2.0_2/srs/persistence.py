"""Persistence — snapshot runtime state to disk for recovery.

ID validation: ``_sanitize_id`` validates task_id / snapshot_id contain
only ``[a-zA-Z0-9_-]`` and are at most 64 chars. This blocks path
traversal attempts like ``../../etc/passwd`` from being used as a
filename component.

Advice table integrity: SHA-256 hash stored alongside ``advice_table``.
On load, the hash is recomputed and compared; on mismatch the advice
is discarded (detects tampering / corruption).

DoS hardening:
  - ``SafeJSONDecoder`` pre-scans every JSON payload for nesting depth
    > ``SafeJSONDecoder.MAX_DEPTH`` (default 100) and rejects with
    ValueError. Without this, a malicious snapshot containing 50_000
    nested brackets would raise RecursionError — which is NOT a
    JSONDecodeError subclass — and brick every CLI command via
    Runtime.__init__. The pre-scan ignores bracket characters inside
    JSON string literals so legitimate payloads are unaffected.
  - ``MAX_SNAPSHOT_SIZE`` (default 10 MB) caps the byte size of any
    snapshot file we are willing to ``open()``. A multi-GB snapshot
    would otherwise OOM the process. Tunable via the module attribute
    for deployments that need a different limit.
  - ``_safe_json_load`` is the single entry point every JSON read in
    this module goes through, so the depth limit applies uniformly to
    snapshots, latest.json, inflight_*.json, and self_test scratch
    files.

In-flight state recovery (resumable execution):
  - advice table (cached answers)
  - primitive stats (run history)
  - active task (if interrupted mid-execute)
  - partial transcript (queries made so far)
  - budget remaining
  - rng state (for reproducibility)

A recovered runtime can resume an interrupted task from where it
left off, not just reload cached answers.

Atomic writes: ``_atomic_write_json`` writes to a tempfile, fsyncs,
then ``os.replace()``s onto the final path (POSIX-atomic). Eliminates
latest.json corruption under concurrent store_state and truncated
snapshots after a crash mid-write. The same pattern is used for
inflight_*.json. ``load_latest`` / ``load_in_flight`` / ``list_snapshots``
wrap ``json.load`` in try/except so a corrupt JSON file returns ``None``
instead of propagating ``JSONDecodeError``. ``clear_in_flight`` uses
``unlink(missing_ok=True)`` so concurrent cleanup doesn't raise
``FileNotFoundError`` inside the caller's try/finally.

Cross-process file locking: ``_lock_file`` / ``_unlock_file`` /
``file_lock`` context manager wrap ``fcntl.flock(LOCK_EX / LOCK_SH /
LOCK_UN)``. Two processes writing to the same home directory (e.g. two
CLI invocations, or a CLI + a long-running service sharing ``~/.srs``)
can no longer corrupt each other's latest.json or inflight_*.json.

  - save():          exclusive-locks latest.json during the write.
  - load_latest():   shared-locks latest.json during the read.
  - save_in_flight():  exclusive-locks inflight_{task_id}.json during write.
  - load_in_flight():  shared-locks inflight_{task_id}.json during read.
  - clear_in_flight(): exclusive-locks during unlink (so a concurrent
                       load_in_flight can't observe a half-deleted file).

All locks are released even on exceptions (``file_lock`` is a context
manager; ``fcntl.flock`` is automatically released when the file
descriptor closes). On platforms without ``fcntl`` (Windows), the
locks degrade to no-ops with a one-time warning, so the runtime still
works there (just without cross-process safety).
"""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
import platform
import random
import re
import tempfile
import time
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, cast

from .types import Snapshot

logger = logging.getLogger("srs.persistence")


# ---------------------------------------------------------------------------
# Log injection prevention + structured logging formatter.
#
# Even though ``task_id`` and ``snapshot_id`` are now sanitized at the
# input boundary (path-traversal + control-char rejection), defense in
# depth requires that any user-controlled value being interpolated into
# a log message be sanitized AGAIN at the log-call site. Otherwise a
# future code path that bypasses the input validator (e.g. a new API
# endpoint that forgets to call ``_sanitize_task_id``) would re-open
# the log-injection vector — a malicious ``task_id="evil\ngreen INFO
# execute: complete task_id=..."`` could inject a fake "success" log
# line.
#
# ``_safe_log_value`` strips every control character (including ``\n``,
# ``\r``, ``\t``, ``\x00``, ANSI escape ``\x1b[``) and limits the
# length so a 10 MB task_id cannot flood the log file.
#
# ``SafeFormatter`` is a logging.Formatter that escapes ``\n`` / ``\r``
# in the FINAL formatted message — so even if a value slips past
# ``_safe_log_value`` (e.g. an exception's ``__str__`` returns a
# multiline string), the log line stays single-line.
# ---------------------------------------------------------------------------

def _safe_log_value(value: Any, max_len: int = 64) -> str:
    """Sanitize a value for safe inclusion in log messages.

    Strips control characters (including newlines, carriage returns,
    null bytes, ANSI escapes) that could be used for log injection.
    Also strips non-ASCII bytes (defensive: avoids any Unicode
    normalization tricks). Truncates to ``max_len`` to prevent log
    flooding via huge user-supplied strings.

    Use this for ANY value that originates outside the runtime
    (task_id, snapshot_id, snapshot path, home directory, exception
    messages tied to a user-supplied id, etc.). Internal numeric
    values (budgets, query counts, primitive names from a fixed
    enumeration) do NOT need to be wrapped.
    """
    s = str(value)
    # Remove control characters (except space) and non-ASCII bytes.
    # Allowed chars: ASCII printable 32..126 (which includes space at 32).
    s = ''.join(c for c in s if c == ' ' or (32 <= ord(c) < 127))
    if len(s) > max_len:
        s = s[:max_len] + "..."
    return s


class SafeFormatter(logging.Formatter):
    """Logging formatter that sanitizes the final message to prevent
    log injection.

    Wraps ``logging.Formatter.format`` and replaces any ``\\n`` or
    ``\\r`` in the formatted message with their escaped representation
    (``\\\\n``, ``\\\\r``). This is a SECOND layer of defense on top of
    ``_safe_log_value``: even if a value slips past the helper (e.g. an
    exception's ``__str__`` returns a multiline traceback), the log
    line stays single-line and a fake "INFO execute: complete" line
    cannot be injected.
    """

    def format(self, record: logging.LogRecord) -> str:
        msg = super().format(record)
        # Replace newlines / carriage returns with their literal escape
        # sequences so the log stays one line per record. Do NOT touch
        # the trailing newline that logging.StreamHandler appends —
        # ``super().format()`` does not include a trailing newline, so
        # we can replace unconditionally.
        return msg.replace("\n", "\\n").replace("\r", "\\r")


# ---------------------------------------------------------------------------
# DoS hardening: JSON depth limit + snapshot size cap.
#
# Python's stdlib ``json`` module uses recursive-descent parsing. A deeply
# nested JSON document (e.g. 50_000 opening brackets) blows the CPython
# recursion stack and raises RecursionError, which is NOT a subclass of
# JSONDecodeError or OSError — so the existing try/except blocks in
# load_latest / load_in_flight / list_snapshots do not catch it, and a
# single malicious snapshot file bricks every CLI command via
# Runtime.__init__.
#
# ``SafeJSONDecoder`` pre-scans the raw string for ``[`` / ``{`` runs and
# rejects anything deeper than ``MAX_DEPTH`` *before* handing off to the
# stdlib parser. The pre-scan is O(N) and a single pass; it cannot itself
# be DoS'd by depth.
#
# ``MAX_SNAPSHOT_SIZE`` caps the byte size of a snapshot file we are
# willing to open. Without it, a 1GB snapshot would OOM the process.
# The cap is exposed as a module-level constant so callers (e.g. tests,
# deployment configs) can override it if needed.
# ---------------------------------------------------------------------------
MAX_SNAPSHOT_SIZE = 10 * 1024 * 1024  # 10 MB; tunable via module attribute.


class SafeJSONDecoder(json.JSONDecoder):
    """JSON decoder with nesting depth limit to prevent RecursionError DoS.

    Uses a fast size-gate + regex pre-scan instead of char-by-char iteration.
    For payloads under 4KB (the common case), the depth check is skipped
    entirely since the default recursion limit (1000) handles them fine.
    For larger payloads, a regex counts structural brackets outside string
    literals and rejects payloads exceeding MAX_DEPTH.

    This is ~10x faster than the previous char-by-char approach on typical
    20KB snapshots (544µs → ~50µs) while providing the same DoS protection.
    """

    MAX_DEPTH = 100
    # Only pre-scan payloads larger than this (small payloads can't cause
    # RecursionError even with maximum nesting).
    _SIZE_GATE = 4096
    # Regex to find structural brackets outside JSON strings.
    # Matches: {, [, }, ] that are not inside double-quoted strings.
    _STRUCTURAL_RE = re.compile(r'(?<!\\)"(?:[^"\\]|\\.)*"|[{}\[\]]')

    def decode(self, s: str, *args: Any, **kwargs: Any) -> Any:
        # Use regex to count structural depth (much faster than char-by-char).
        # The regex runs in C, so even for small payloads the overhead is
        # negligible (~5µs for 400 bytes vs ~50µs for char-by-char).
        depth = 0
        for match in self._STRUCTURAL_RE.finditer(s):
            char = match.group()[-1]  # last char of the match
            if char in '{[':
                depth += 1
                if depth > self.MAX_DEPTH:
                    raise ValueError(
                        f"JSON nesting depth exceeds {self.MAX_DEPTH}"
                    )
            elif char in '}]':
                depth -= 1
        return super().decode(s, *args, **kwargs)


def _safe_json_load(f: Any) -> Any:
    """Load JSON from an open file object with the depth limit applied.

    Wrapper around ``json.load`` that injects ``SafeJSONDecoder``. Used
    by every JSON read in this module so the depth limit applies
    uniformly to snapshots, latest.json, inflight_*.json, and any other
    file we parse.
    """
    return json.load(f, cls=SafeJSONDecoder)


def _iso_now() -> str:
    """Current time in ISO 8601 UTC format.

    Replaces raw ``time.time()`` epoch floats (e.g. 1784313766.4212925)
    with a human-readable, time-zone-aware string like
    ``2025-06-15T14:23:45.123456+00:00``. ISO 8601 is sortable, grep-able,
    and screen-reader-friendly (no 17-digit float to read digit-by-digit).
    """
    return datetime.now(timezone.utc).isoformat()


def _coerce_timestamp(value: Any) -> str:
    """Normalize any timestamp value to an ISO 8601 UTC string.

    Backward compatibility: old snapshots store ``time.time()`` epoch floats
    (e.g. 1784313766.42). On load, we convert them to ISO 8601 UTC so the
    in-memory representation is always a string. This function also accepts
    ISO strings (no-op), ``int``/``float`` epoch seconds, and ``None``
    (returns current time).

    This is called by ``Snapshot.from_dict`` when restoring a snapshot that
    was written by an older runtime version.
    """
    if value is None:
        return _iso_now()
    if isinstance(value, str):
        # Already a string; assume ISO 8601. Validate by parsing — if it
        # fails, fall back to current time (defensive: corrupt data).
        try:
            datetime.fromisoformat(value)
            return value
        except ValueError:
            logger.warning("invalid ISO 8601 timestamp %s; using now",
                           _safe_log_value(value))
            return _iso_now()
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        # Epoch seconds → ISO 8601 UTC. Old snapshots stored time.time().
        try:
            return datetime.fromtimestamp(float(value), tz=timezone.utc).isoformat()
        except (OSError, OverflowError, ValueError):
            logger.warning("invalid epoch timestamp %s; using now",
                           _safe_log_value(value))
            return _iso_now()
    # Unknown type — log and use current time rather than crashing.
    logger.warning("unknown timestamp type %s (%s); using now",
                   type(value).__name__, _safe_log_value(value))
    return _iso_now()

# ID validation — only [a-zA-Z0-9_-], max 64 chars (blocks path traversal).
_ID_RE = re.compile(r'^[a-zA-Z0-9_-]{1,64}$')

# Cross-process file locking via fcntl.flock.
# fcntl is POSIX-only; on Windows we degrade to no-ops with a one-time
# warning. The locks are advisory (not mandatory) — they only block
# OTHER processes that also call _lock_file. A non-cooperating process
# (e.g. `cat latest.json` from a shell) is unaffected.
try:
    import fcntl as _fcntl  # type: ignore[import-not-found]
    _HAS_FCNTL = True
except ImportError:
    _fcntl = None  # type: ignore[assignment]
    _HAS_FCNTL = False
    _fcntl_warned = False


def _maybe_warn_no_fcntl() -> None:
    """One-time warning on platforms without fcntl (Windows).

    Without fcntl, two processes writing to the same home directory can
    still corrupt each other's latest.json. Atomic writes via
    _atomic_write_json prevent TORN writes, but a reader can still
    observe a stale snapshot pointer between the two atomic writes in
    save() (snap file + latest.json index).
    """
    global _fcntl_warned
    if not _fcntl_warned:
        logger.warning(
            "fcntl module not available (likely Windows); cross-process "
            "file locking is DISABLED. Concurrent processes sharing a "
            "home directory may corrupt each other's snapshots. "
            "This warning fires once per process."
        )
        _fcntl_warned = True


def _lock_file(fileobj, exclusive: bool = True) -> None:
    """Acquire an advisory lock on an open file object.

    Uses fcntl.flock(), which is advisory and cross-process on POSIX.
    A LOCK_EX call blocks until any other holder (shared or exclusive)
    releases. A LOCK_SH call blocks only while another exclusive holder
    exists; multiple shared holders can coexist.

    The lock is tied to the file object's underlying file descriptor;
    closing the file descriptor (e.g. via `with open(..., encoding="utf-8") as f:` exit)
    releases the lock automatically. So callers MUST hold the file
    object open for as long as they need the lock — typically by
    pairing _lock_file() with a `with open(..., encoding="utf-8")` block or by using
    the file_lock() context manager.

    On Windows (no fcntl), this is a no-op with a one-time warning.
    """
    if not _HAS_FCNTL:
        _maybe_warn_no_fcntl()
        return
    lock_type = _fcntl.LOCK_EX if exclusive else _fcntl.LOCK_SH
    _fcntl.flock(fileobj.fileno(), lock_type)


def _unlock_file(fileobj) -> None:
    """Release a previously acquired advisory lock.

    On POSIX, releasing is also automatic when the file descriptor
    closes; this function exists for callers that want to release
    explicitly without closing (rare — usually you just close the file).

    On Windows, this is a no-op.
    """
    if not _HAS_FCNTL:
        return
    _fcntl.flock(fileobj.fileno(), _fcntl.LOCK_UN)


@contextmanager
def file_lock(path: Path, exclusive: bool = True) -> Iterator[Any]:
    """Context manager that acquires a flock on `path` for its duration.

    Opens the file (creating it if necessary for exclusive locks),
    acquires the flock, yields, and releases the flock + closes the
    file on exit — even if the body raises. This is the recommended
    way to use the locks; bare _lock_file/_unlock_file require manual
    try/finally.

    For exclusive locks, the file is opened in 'a+' mode (read+write,
    create-if-missing) so we can lock a file that doesn't yet exist.
    For shared locks, the file is opened in 'r' mode (the file must
    already exist; a shared lock on a non-existent file is meaningless
    anyway).

    Usage:
        with file_lock(latest_json_path, exclusive=True):
            _atomic_write_json(latest_json_path, data)
        # lock released here, even if _atomic_write_json raised
    """
    if not _HAS_FCNTL:
        _maybe_warn_no_fcntl()
        # Yield None — the caller's body runs without a lock. Cross-
        # process safety is lost, but single-process correctness is
        # preserved (the _state_lock in runtime.py still serializes
        # threads within this process).
        yield None
        return
    if exclusive:
        # 'a+' creates the file if missing; we don't actually write to
        # this handle (the caller writes via _atomic_write_json which
        # opens its own tempfile+rename). This handle is lock-only.
        # Use os.O_RDWR | O_CREAT to avoid truncating an existing file.
        fd = os.open(str(path), os.O_RDWR | os.O_CREAT, 0o644)
        f = os.fdopen(fd, "r+", encoding="utf-8")
    else:
        # Shared lock: file must exist. If it doesn't, the caller is
        # trying to load something that was never written — return
        # None and let the caller's normal "file not found" logic
        # handle it (the load_* functions all check .exists() first).
        if not path.exists():
            yield None
            return
        f = open(path, encoding="utf-8")
    try:
        _fcntl.flock(f.fileno(),
                     _fcntl.LOCK_EX if exclusive else _fcntl.LOCK_SH)
        try:
            yield f
        finally:
            _fcntl.flock(f.fileno(), _fcntl.LOCK_UN)
    finally:
        f.close()


def _sanitize_id(id_str: str) -> str:
    """Validate an ID (task_id, snapshot_id) is safe to use in a filename.

    Rejects path traversal attempts (/, \\, .., null bytes).
    Returns the id if valid, raises ValueError otherwise.
    """
    if not isinstance(id_str, str):
        raise ValueError(f"id must be str, got {type(id_str).__name__}")
    if "\x00" in id_str:
        raise ValueError(f"id contains null byte: {id_str!r}")
    if not _ID_RE.match(id_str):
        raise ValueError(
            f"invalid id: {id_str!r} (must match [a-zA-Z0-9_-]{{1,64}})"
        )
    return id_str


def _coerce_path(p) -> Path:
    """Accept str or Path; return Path.

    Strings are run through ``os.path.expanduser`` so a caller passing
    ``"~/my-run"`` or an env var containing ``~`` gets the expected
    expansion (previously only ``Path.home()`` was expanded while raw
    ``~`` in path strings was left verbatim, producing a literal
    directory named ``~``). The result is then ``.resolve()``-d to
    normalize ``.`` / ``..`` components so callers always see an
    absolute, canonical path.
    """
    if isinstance(p, Path):
        return p
    if isinstance(p, str):
        # Expand `~` (and `~user`) before resolving so callers can pass
        # the conventional shell abbreviation.
        expanded = os.path.expanduser(p)
        return Path(expanded).resolve()
    raise TypeError(f"home must be str or Path, got {type(p).__name__}")


def _resolve_srs_home_root() -> Path:
    """Resolve the SRS install root (parent of the snapshots dir).

    Centralizes the SRS_HOME resolution so that both ``default_path()``
    (which returns ``<root> / snapshots``) and ``_get_secret_key()``
    (which reads ``<root> / secret_key``) honor the same env var and
    the same blocklist of forbidden system pseudo-filesystems.

    Returns the install root (without ``/snapshots``). Falls back to
    ``~/.srs`` when SRS_HOME is unset or points at a forbidden location
    (so a misconfigured env var can never brick the runtime — it just
    falls back to the default install root).

    Path handling: ``~`` (and ``~user``) is expanded BEFORE
    ``Path.resolve()`` so ``SRS_HOME=~/.srs`` works identically to
    ``SRS_HOME=/home/me/.srs``. ``Path.resolve()`` then normalizes
    ``.`` / ``..`` components and yields an absolute canonical path.
    """
    raw = os.environ.get("SRS_HOME")
    if not raw:
        return Path.home() / ".srs"
    try:
        expanded = os.path.expanduser(raw)
        resolved = Path(expanded).resolve()
    except (OSError, RuntimeError) as e:
        logger.warning("SRS_HOME=%s could not be resolved (%s); using default",
                       _safe_log_value(raw), e)
        return Path.home() / ".srs"
    # Reject paths inside system pseudo-filesystems. ``startswith``
    # is safe here because the resolved path is absolute and
    # canonical (no ``..`` or trailing slash to worry about).
    forbidden_prefixes = ("/dev", "/proc", "/sys")
    sp = str(resolved)
    for prefix in forbidden_prefixes:
        if sp == prefix or sp.startswith(prefix + "/"):
            logger.warning(
                "SRS_HOME=%s resolves to forbidden location %s; using default",
                _safe_log_value(raw), prefix,
            )
            return Path.home() / ".srs"
    # If the path already exists, it must be a directory — writing
    # snapshots inside a regular file (e.g. SRS_HOME=/etc/passwd)
    # would either fail or silently clobber the file. Reject early
    # with a clear log message instead of letting save() raise a
    # cryptic NotADirectoryError deep in _atomic_write_json.
    try:
        if resolved.exists() and not resolved.is_dir():
            logger.warning(
                "SRS_HOME=%s resolves to %s which is not a directory; using default",
                _safe_log_value(raw), _safe_log_value(resolved),
            )
            return Path.home() / ".srs"
    except OSError as e:
        logger.warning("SRS_HOME=%s stat failed (%s); using default",
                       _safe_log_value(raw), e)
        return Path.home() / ".srs"
    return resolved


def default_path() -> Path:
    """Return the default snapshot directory (validates SRS_HOME).

    Honors the ``SRS_HOME`` environment variable if set (lets tests / CI
    isolate without polluting ``$HOME``), otherwise defaults to
    ``~/.srs/snapshots/``. The directory is NOT created here — callers
    (``save`` / ``save_in_flight``) mkdir it on demand.

    SRS_HOME validation: the raw value is resolved to an absolute path
    and checked against a blocklist of system pseudo-filesystem mount
    points. If the resolved path is inside ``/dev``, ``/proc``, or
    ``/sys`` (or one of the specific device files ``/dev/null``,
    ``/dev/zero``), we log a warning and fall back to the default
    ``~/.srs/snapshots`` — refusing to write snapshots into a kernel
    pseudo-FS that doesn't behave like a directory (writing to
    ``/dev/null/snapshots`` raises NotADirectoryError; writing to
    ``/proc/self/fd/...`` could clobber an unrelated open file
    descriptor). If the resolved path exists but is a regular file
    (not a directory), we also fall back.

    ``~`` (and ``~user``) in SRS_HOME is expanded before
    ``Path.resolve()`` so ``SRS_HOME=~/.srs`` works identically to
    ``SRS_HOME=/home/me/.srs``. ``Path.resolve()`` normalizes
    ``.`` / ``..`` components so callers always see a canonical path.

    The same validation is shared with ``_get_secret_key()`` via the
    ``_resolve_srs_home_root()`` helper so the snapshot dir and the
    secret key file always live under the same install root — without
    that, an SRS_HOME-isolated runtime would still read its HMAC key
    from ``~/.srs/secret_key``, breaking isolation.
    """
    return _resolve_srs_home_root() / "snapshots"


def _atomic_write_json(path: Path, data: Any, indent: int = 2) -> None:
    """Atomic JSON write.

    Writes to a tempfile in the same directory, fsyncs the file and
    (if supported) the directory, then ``os.replace()``s it onto the final
    path. ``os.replace`` is atomic on POSIX and Windows for same-filesystem
    renames, so a reader never sees a partially-written file.

    On Windows, ``os.replace`` raises ``PermissionError`` transiently if
    another process (or thread) has the destination file open via a
    non-shared handle. POSIX advisory locks (``fcntl.flock``) are no-ops on
    Windows, so a concurrent reader can be holding the file open while we
    try to rename onto it. We retry with exponential backoff (1, 2, 4, 8,
    16 ms = 31 ms total) before giving up and re-raising. This mirrors
    the standard pattern used by atomic-write libraries on Windows.
    """
    # Write to a sibling tempfile then atomically rename.
    # mkstemp gives us an unpredictable name so concurrent writers don't
    # collide on the same tmp filename.
    fd, tmp_name = tempfile.mkstemp(
        prefix=".tmp_", suffix=".json", dir=str(path.parent)
    )
    tmp_path = Path(tmp_name)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as f:
            json.dump(data, f, indent=indent, default=str)
            f.flush()
            # fsync before close so the bytes hit disk before the rename.
            # Without this, a crash after os.replace could leave a
            # renamed-but-empty file.
            os.fsync(f.fileno())
        # os.replace is atomic on POSIX and Windows for same-volume renames.
        # On Windows, ``os.replace`` may raise ``PermissionError``
        # transiently if another process has the destination file open
        # (mandatory locking on Windows; POSIX advisory locks don't help
        # there). Retry with exponential backoff (5 attempts, ~31 ms total)
        # before propagating. This is the standard pattern; e.g. sqlite3,
        # atomicwrites, and pip all do something similar.
        if platform.system() == "Windows":
            last_exc: Exception | None = None
            for attempt in range(5):
                try:
                    os.replace(tmp_path, path)
                    last_exc = None
                    break
                except PermissionError as exc:
                    last_exc = exc
                    if attempt == 4:
                        # Final attempt failed — propagate.
                        raise
                    # 1ms, 2ms, 4ms, 8ms, 16ms = 31ms total worst-case.
                    time.sleep(0.001 * (2 ** attempt))
            if last_exc is not None:
                # Defensive: loop exited without break — shouldn't happen
                # because attempt==4 raises, but keep the explicit re-raise
                # to satisfy type checkers.
                raise last_exc
        else:
            os.replace(tmp_path, path)
        # Best-effort dirfsync (not all platforms support it; ignore errors).
        try:
            dir_fd = os.open(str(path.parent), os.O_RDONLY)
            try:
                os.fsync(dir_fd)
            finally:
                os.close(dir_fd)
        except (OSError, PermissionError):
            # Directory fsync is best-effort; on systems that don't support
            # it (e.g. Windows without admin), the file fsync is enough.
            pass
    except Exception:
        # If anything went wrong, make sure we don't leave the tempfile.
        try:
            tmp_path.unlink(missing_ok=True)
        except OSError:
            pass
        raise


# Module-level cache for the secret key.
# _get_secret_key() is called on every save/load cycle (5× per persistence
# operation). Each call does a Path.exists() + read_bytes() = ~96µs of
# disk I/O. Caching at module level saves ~480µs per persistence cycle
# with no security tradeoff (the key doesn't change during a process
# lifetime; a new key is only generated on first use).
_secret_key_cache: bytes | None = None


def _get_secret_key() -> bytes:
    """Get or create a per-installation secret key for HMAC.

    The key is stored in ~/.srs/secret_key (0600 permissions).
    If the key doesn't exist, a new 32-byte random key is generated.
    This key is required for HMAC-SHA256 authentication of snapshots.

    Security model: anyone with read access to ~/.srs/secret_key can
    forge snapshots. This is acceptable because anyone with that access
    can also just replace the snapshot file directly. The HMAC prevents
    tampering by users who can write to the snapshots/ directory but
    NOT to the secret_key file (e.g., shared directories with per-user
    permissions).

    Performance: the key is cached at module level after first load,
    avoiding repeated disk I/O on every persistence cycle.
    """
    global _secret_key_cache
    if _secret_key_cache is not None:
        return _secret_key_cache

    # Use the same home resolution as default_path() so the secret key
    # always lives alongside the snapshots it protects. Without this,
    # SRS_HOME=/tmp/test would write snapshots to /tmp/test/snapshots
    # but keep reading the HMAC key from ~/.srs/secret_key — breaking
    # isolation (a test in /tmp/test could not verify HMAC without
    # polluting $HOME, and two runtimes pointed at different SRS_HOME
    # roots would unexpectedly share a single key).
    home = _resolve_srs_home_root()
    key_path = home / "secret_key"
    key_path.parent.mkdir(parents=True, exist_ok=True)
    if key_path.exists():
        _secret_key_cache = key_path.read_bytes()
        return _secret_key_cache
    # Generate new key
    key = os.urandom(32)
    key_path.write_bytes(key)
    try:
        os.chmod(key_path, 0o600)
    except OSError:
        pass  # Windows
    logger.debug("generated new secret key at %s", key_path)
    _secret_key_cache = key
    return key


def _compute_advice_hash(advice_table: Any) -> str:
    """HMAC-SHA256 of the advice table for tamper detection.

    Uses a per-installation secret key (from ~/.srs/secret_key) so that
    an attacker who can write to the snapshots/ directory but NOT to
    ~/.srs/secret_key cannot forge valid snapshots.

    This is a MAC (Message Authentication Code), not just a hash.
    Unlike the previous SHA-256-only approach (which was trivially
    bypassable by recomputing the public hash), HMAC-SHA256 requires
    knowledge of the secret key to produce a valid tag.

    Kept for backward compatibility: old snapshots written by v7.6
    carry ``advice_hash`` and are verified by this function on load.
    New snapshots (v7.7+) are written with ``snapshot_hash`` (covering
    the full payload) instead, but ``advice_hash`` is still honored
    on load so v7.6 snapshots migrate transparently.
    """
    key = _get_secret_key()
    message = json.dumps(advice_table, sort_keys=True, default=str).encode()
    return hmac.new(key, message, hashlib.sha256).hexdigest()


def _compute_snapshot_hash(snap_dict: dict) -> str:
    """HMAC-SHA256 of the full snapshot payload for tamper detection.

    Covers EVERY field in the snapshot dict EXCEPT ``snapshot_hash``
    itself (a hash can't include its own value). This is the v7.7+
    replacement for the narrower ``advice_hash``: tampering with
    ``primitive_stats``, ``execution_history``, ``last_task_id``,
    ``last_result``, ``sequence``, ``timestamp``, or ``snapshot_id``
    is now detected.

    The hash is computed over a canonical JSON serialization
    (``sort_keys=True``, ``default=str``) so dict-key ordering and
    non-JSON-native types don't cause spurious mismatches between
    save and load.

    Security model: same as ``_compute_advice_hash`` — the secret key
    lives in ``~/.srs/secret_key`` (0600). An attacker who can write
    to the snapshots dir but not to the secret key cannot forge a
    valid ``snapshot_hash``.
    """
    key = _get_secret_key()
    # Defensive copy + drop the hash field so we don't hash the hash.
    # ``advice_hash`` (if present) is kept in the payload — it's part
    # of the snapshot's stored state and tampering with it should be
    # detectable too.
    payload = {k: v for k, v in snap_dict.items() if k != "snapshot_hash"}
    message = json.dumps(payload, sort_keys=True, default=str).encode()
    return hmac.new(key, message, hashlib.sha256).hexdigest()


def _compute_seq_hash(seq_data: dict) -> str:
    """HMAC-SHA256 of the sequence.json payload.

    The sequence file tracks the highest sequence number ever
    persisted to the snapshots directory. Without integrity protection
    an attacker who can write to the snapshots dir could lower the
    high-water mark to enable rollback attacks. The HMAC prevents
    forging a lower high_water value without the secret key.

    Covers every field in ``seq_data`` EXCEPT ``seq_hash`` itself.
    """
    key = _get_secret_key()
    payload = {k: v for k, v in seq_data.items() if k != "seq_hash"}
    message = json.dumps(payload, sort_keys=True, default=str).encode()
    return hmac.new(key, message, hashlib.sha256).hexdigest()


def _compute_inflight_hash(inflight_dict: dict) -> str:
    """HMAC-SHA256 of an in-flight execution state dict.

    ``inflight_*.json`` files track the resume point of an interrupted
    task — how many queries have been made, what the budget was, the
    rng state, and a payload summary. Without integrity protection an
    attacker who can write to the snapshots dir could tamper with
    ``queries_made`` (e.g. set it to 999_999) so that on resume the
    runtime computes ``effective_budget = budget_total - queries_made``
    as a negative or zero value, causing the task to run with 0 queries
    and fail silently.

    Uses the SAME per-installation secret key as ``_compute_snapshot_hash``
    and ``_compute_seq_hash`` (from ``~/.srs/secret_key``, 0600 perms),
    so an attacker who can write to the snapshots dir but NOT to the
    secret-key file cannot forge a valid ``inflight_hash`` after
    tampering.

    Covers every field in ``inflight_dict`` EXCEPT ``inflight_hash``
    itself (a hash can't include its own value).
    """
    key = _get_secret_key()
    payload = {k: v for k, v in inflight_dict.items() if k != "inflight_hash"}
    message = json.dumps(payload, sort_keys=True, default=str).encode()
    return hmac.new(key, message, hashlib.sha256).hexdigest()


def _high_water_mirror_path() -> Path:
    """Path to the high-water mirror file (R17 known weakness fix).

    The mirror lives at ``<srs_root>/secret_key.seq`` — i.e. alongside
    the per-installation secret key (``<srs_root>/secret_key``), which
    is OUTSIDE the snapshots directory. This is the key security
    property: an attacker who can write to ``~/.srs/snapshots/`` (the
    snapshots dir) but NOT to ``~/.srs/secret_key*`` cannot tamper
    with the mirror, so they cannot lower the high-water mark to
    bypass rollback protection by deleting ``sequence.json``.

    The mirror stores the same ``{"high_water": <int>, "seq_hash": <HMAC>}``
    payload as ``sequence.json``, signed with the same per-installation
    secret key. The HMAC is required because the threat model includes
    attackers who can write to the snapshots dir (so they could write
    a fake mirror there if it lived in the snapshots dir); the mirror
    lives OUTSIDE the snapshots dir precisely to defeat that threat.

    The mirror path is NOT relative to ``home`` (the snapshots dir)
    because that would put it inside the snapshots dir, defeating the
    purpose. It is relative to ``_resolve_srs_home_root()`` (the
    parent of the snapshots dir) so it honors SRS_HOME just like the
    secret key does.
    """
    return _resolve_srs_home_root() / "secret_key.seq"


def _read_high_water_mirror() -> int:
    """Read the high-water mirror file, returning 0 on any failure.

    The mirror is consulted ONLY when the snapshots-dir ``sequence.json``
    is missing or tampered (so the attacker cannot simply delete
    ``sequence.json`` to reset the high-water mark to 0). When the
    snapshots-dir file IS valid, it is the authoritative source —
    the mirror is just a backup.

    On any integrity failure (file missing, empty, hash mismatch,
    corrupt JSON, wrong type) returns 0 — same defensive posture as
    ``_get_high_water_sequence``.
    """
    mirror_path = _high_water_mirror_path()
    if not mirror_path.exists():
        return 0
    try:
        if mirror_path.stat().st_size == 0:
            return 0
    except OSError:
        return 0
    try:
        with open(mirror_path, encoding="utf-8") as f:
            data = _safe_json_load(f)
    except (ValueError, json.JSONDecodeError, OSError) as e:
        logger.debug("corrupt high-water mirror (%s); ignoring",
                     _safe_log_value(e))
        return 0
    if not isinstance(data, dict):
        return 0
    stored_hash = data.pop("seq_hash", None)
    if stored_hash is None:
        return 0
    actual_hash = _compute_seq_hash(data)
    if not hmac.compare_digest(stored_hash, actual_hash):
        logger.warning("high-water mirror hash mismatch; ignoring "
                       "(possible tampering)")
        return 0
    high_water = data.get("high_water", 0)
    if not isinstance(high_water, int) or isinstance(high_water, bool):
        return 0
    return high_water


def _write_high_water_mirror(seq: int) -> None:
    """Write the high-water mirror file (atomic, HMAC-protected).

    Called by ``_update_high_water_sequence`` so the snapshots-dir
    ``sequence.json`` and the mirror file at ``~/.srs/secret_key.seq``
    are updated together. If the mirror write fails (e.g. read-only
    filesystem), we log a debug message and continue — the
    snapshots-dir file is still authoritative when valid, and the
    mirror is just a backup for the deletion-attack case.
    """
    mirror_path = _high_water_mirror_path()
    data: dict[str, Any] = {"high_water": seq}
    data["seq_hash"] = _compute_seq_hash(data)
    try:
        _atomic_write_json(mirror_path, data)
    except OSError as e:
        # Best-effort: don't fail the save() just because the mirror
        # couldn't be written. The snapshots-dir sequence.json is
        # still the authoritative source when valid.
        logger.debug("could not write high-water mirror (%s); continuing",
                     _safe_log_value(e))


def _clear_high_water_mirror() -> None:
    """Delete the high-water mirror file (test helper).

    Used by tests that need to verify the snapshots-dir sequence.json
    in isolation (without the mirror's backup influence). Production
    code should NOT call this — the mirror is what makes the rollback
    protection survive deletion of ``sequence.json``.
    """
    mirror_path = _high_water_mirror_path()
    try:
        mirror_path.unlink(missing_ok=True)
    except OSError:
        pass


def _get_high_water_sequence(home: Path) -> int:
    """Get the highest sequence number ever persisted to ``home``.

    Reads ``home/sequence.json`` (HMAC-protected). On any integrity
    failure (file missing, empty, hash mismatch, corrupt JSON, wrong
    type) falls back to the high-water mirror at
    ``~/.srs/secret_key.seq`` (also HMAC-protected). If BOTH sources
    are missing or tampered, returns 0 — the caller treats 0 as
    "no prior sequence info".

    R17 known weakness fix: previously, deleting
    ``home/sequence.json`` reset the high-water mark to 0, allowing
    an attacker with snapshots-dir write access to bypass the
    rollback check. The mirror at ``~/.srs/secret_key.seq`` (which
    lives OUTSIDE the snapshots dir) ensures the high-water mark
    survives deletion of the in-snapshots-dir file.

    The caller is expected to hold any required cross-process lock
    around this read; this function does not lock on its own (the
    save() path acquires an exclusive lock on the sequence file
    before calling this, and the load_latest() path takes a shared
    lock if needed).

    Note: ``file_lock(seq_path, exclusive=True)`` creates the file via
    ``O_CREAT`` if it doesn't already exist (the lock is acquired on
    the file descriptor of an open file, so the file must exist to be
    locked). That means inside a save() call, ``seq_path.exists()``
    may return True even when no prior snapshot has been written. We
    treat an empty file the same as a missing file (return 0, no
    warning) so the very first save() in a fresh home directory
    doesn't log a spurious "corrupt sequence.json" warning.
    """
    seq_path = home / "sequence.json"
    snapshots_dir_value = 0
    if seq_path.exists():
        # Empty file (e.g. just created by file_lock's O_CREAT) — treat
        # the same as missing. This is the common case on the first save
        # in a fresh home directory.
        try:
            if seq_path.stat().st_size == 0:
                snapshots_dir_value = 0
            else:
                try:
                    with open(seq_path, encoding="utf-8") as f:
                        data = _safe_json_load(f)
                except (ValueError, json.JSONDecodeError, OSError) as e:
                    # ValueError covers SafeJSONDecoder depth-limit rejections.
                    logger.warning("corrupt sequence.json (%s); ignoring",
                                   _safe_log_value(e))
                    data = None
                if isinstance(data, dict):
                    stored_hash = data.pop("seq_hash", None)
                    if stored_hash is not None:
                        actual_hash = _compute_seq_hash(data)
                        if hmac.compare_digest(stored_hash, actual_hash):
                            high_water = data.get("high_water", 0)
                            if (isinstance(high_water, int)
                                    and not isinstance(high_water, bool)):
                                snapshots_dir_value = high_water
                            else:
                                logger.warning(
                                    "sequence.json high_water is %s, not int; "
                                    "ignoring", type(high_water).__name__)
                        else:
                            logger.warning("sequence.json hash mismatch; "
                                           "ignoring (possible tampering)")
                    else:
                        # No hash → treat as untrusted (an attacker could
                        # have written an arbitrarily high value to
                        # suppress rollback detection).
                        logger.warning("sequence.json has no seq_hash; "
                                       "ignoring")
                else:
                    if data is not None:
                        logger.warning("sequence.json is %s, not dict; "
                                       "ignoring", type(data).__name__)
        except OSError:
            snapshots_dir_value = 0
    # R17 known weakness fix: consult the mirror at ~/.srs/secret_key.seq
    # (outside the snapshots dir). If the snapshots-dir file was deleted
    # or tampered, the mirror preserves the true high-water mark. Take
    # the MAX of the two sources so a tampered snapshots-dir file can
    # never LOWER the effective high-water mark below what the mirror
    # recorded. (A tampered mirror that tries to RAISE the high-water
    # mark above the true value is harmless — it just means we'd reject
    # a few legitimate snapshots as "rollback", which is fail-safe.)
    mirror_value = _read_high_water_mirror()
    return max(snapshots_dir_value, mirror_value)


def _update_high_water_sequence(home: Path, seq: int) -> None:
    """Update the high-water sequence number in ``home/sequence.json``
    AND in the mirror at ``~/.srs/secret_key.seq``.

    Writes ``{"high_water": seq, "seq_hash": <HMAC>}`` atomically to
    BOTH locations. The HMAC covers ``high_water`` so an attacker with
    snapshots-dir write access can't lower the high-water mark without
    the secret key. The mirror (outside the snapshots dir) ensures
    the high-water mark survives deletion of the in-snapshots-dir
    file (R17 known weakness fix).

    The caller is expected to hold any required cross-process lock
    around this write (save() acquires an exclusive lock on the
    sequence file before calling this).
    """
    seq_path = home / "sequence.json"
    data: dict[str, Any] = {"high_water": seq}
    data["seq_hash"] = _compute_seq_hash(data)
    _atomic_write_json(seq_path, data)
    # Also write the mirror so the high-water mark survives deletion
    # of the in-snapshots-dir sequence.json (R17 known weakness).
    _write_high_water_mirror(seq)


def _serialize_rng_state(state: Any) -> Any:
    """Convert rng.getstate() tuple to JSON-serializable form."""
    if isinstance(state, tuple) and len(state) == 3:
        version, internal, gauss = state
        if isinstance(internal, tuple):
            internal = list(internal)
        return [version, internal, gauss]
    return state


def _deserialize_rng_state(serialized: Any) -> Any:
    """Convert JSON list back to rng.setstate() tuple."""
    if isinstance(serialized, list) and len(serialized) == 3:
        version, internal, gauss = serialized
        if isinstance(internal, list):
            internal = tuple(internal)
        return (version, internal, gauss)
    return serialized


def save(snap: Snapshot, path=None) -> Path:
    """Save a snapshot to disk (includes snapshot_hash for tamper detection).

    Both the per-snapshot file and latest.json are written via
    ``_atomic_write_json`` (tempfile + fsync + os.replace), so a crash
    between the two writes can never leave latest.json pointing at a
    truncated snapshot.

    The latest.json write is wrapped in an exclusive fcntl.flock so two
    processes saving concurrently serialize on the index write. (The
    snap_*.json file needs no lock — its filename is unique per
    snapshot_id, so concurrent writers don't collide on it. Only the
    shared latest.json index needs serialization.)

    Integrity + rollback protection (v7.7+):
      - ``snapshot_hash`` covers the ENTIRE snapshot payload (not just
        ``advice_table``). Tampering with ``primitive_stats``,
        ``execution_history``, ``last_task_id``, ``last_result``,
        ``timestamp``, or ``snapshot_id`` is now detectable on load.
      - ``sequence`` is a monotonically increasing counter assigned
        here (high_water + 1). The high-water mark is tracked in
        ``sequence.json`` (HMAC-protected) so an attacker can't
        lower it to enable rollback. The sequence file is locked
        exclusively for the whole read-compute-write cycle so two
        concurrent save() calls in different processes can't both
        pick the same next sequence number.
    """
    p = _coerce_path(path or default_path())
    p.mkdir(parents=True, exist_ok=True)
    # Validate snapshot_id (defends against path traversal).
    _sanitize_id(snap.snapshot_id)
    fname = f"snap_{snap.snapshot_id}.json"
    fpath = p / fname
    # Acquire an exclusive lock on sequence.json for the whole
    # read-compute-write cycle. This serializes the high_water update
    # across processes so two concurrent saves can't both pick the
    # same next_seq. The snapshot file itself doesn't need this lock
    # (unique filename per snapshot_id), but the sequence update does.
    seq_path = p / "sequence.json"
    with file_lock(seq_path, exclusive=True):
        high_water = _get_high_water_sequence(p)
        next_seq = high_water + 1
        # Mutate the snapshot in place so the caller's object reflects
        # the persisted sequence (callers like Runtime.store_state
        # keep ``last_snapshot`` around and may inspect .sequence).
        snap.sequence = next_seq
        # Build the payload, then compute snapshot_hash over the full
        # payload (excluding the hash field itself).
        payload = snap.to_dict()
        # Don't persist advice_hash on new saves — snapshot_hash
        # supersedes it. (Old snapshots with advice_hash still load
        # via the backward-compat path in load_latest.)
        payload.pop("advice_hash", None)
        snapshot_hash = _compute_snapshot_hash(payload)
        payload["snapshot_hash"] = snapshot_hash
        # Atomic write — no torn snapshot file. No lock needed for the
        # snap_*.json file: filename is unique per snapshot_id.
        _atomic_write_json(fpath, payload)
        latest = p / "latest.json"
        # Atomic write for latest.json. Hold an exclusive flock around
        # the latest.json write so two PROCESSES saving concurrently
        # produce a consistent ordering (the last writer wins, but the
        # file is never torn and always points at a valid snap_*.json
        # that already exists on disk).
        with file_lock(latest, exclusive=True):
            _atomic_write_json(latest, {
                "snapshot_id": snap.snapshot_id, "path": str(fpath),
                "timestamp": snap.timestamp,
                "sequence": next_seq,
            })
        # Update the high-water mark AFTER the snapshot is on disk so
        # a crash between snapshot write and high_water update leaves
        # the high_water conservative (lower than the snapshot's actual
        # sequence — which means the next save will skip a sequence
        # number, but no rollback protection is lost).
        _update_high_water_sequence(p, next_seq)
    logger.debug("save: snapshot saved id=%s path=%s (seq=%d, snapshot_hash=%s)",
                 _safe_log_value(snap.snapshot_id), _safe_log_value(fpath),
                 next_seq, snapshot_hash[:12])
    return fpath


def load_latest(path=None) -> Snapshot | None:
    """Load the latest snapshot from disk (verifies snapshot_hash).

    Every json.load is wrapped in try/except — a corrupt latest.json or
    snapshot file returns None (with a warning) instead of propagating
    JSONDecodeError up through Runtime.__init__ and bricking every CLI
    command.

    The latest.json read is wrapped in a shared fcntl.flock so a
    concurrent save() in another process can't overwrite the file
    mid-read. (The snap_*.json file is immutable once written —
    os.replace is atomic, so a reader sees either the old version or
    the new version, never a half-written file — so it needs no lock.
    Only latest.json, which is rewritten on every save, needs the shared
    lock to prevent a read-during-replace race that could otherwise
    observe a stale or empty file between the two atomic writes in
    save()).)

    Integrity verification (v7.7+):
      - If ``snapshot_hash`` is present (v7.7+ snapshots), verify it
        against the full payload. On mismatch, log a warning and return
        None — do NOT load any partial state (an attacker may have
        tampered with primitive_stats, execution_history, or any other
        field).
      - If ``snapshot_hash`` is absent but ``advice_hash`` is present
        (v7.6 snapshots), verify the advice_hash against advice_table
        only. On mismatch, return None. On match, accept the snapshot
        (backward-compat migration path — the next save() will write
        a full snapshot_hash).
      - After hash verification, check the snapshot's ``sequence``
        against the high-water mark in sequence.json. If the snapshot's
        sequence is strictly less than the high-water mark AND the
        high-water mark is > 0, treat as a rollback attack and return
        None. (Sequence 0 means "old snapshot that predates the
        sequence field" — we don't enforce the rollback check on
        legacy snapshots, only on v7.7+ ones with sequence >= 1.)
    """
    p = _coerce_path(path or default_path())
    latest = p / "latest.json"
    if not latest.exists():
        logger.debug("load_latest: no latest.json at %s", _safe_log_value(p))
        return None
    # Corrupt latest.json returns None, not JSONDecodeError.
    # Shared lock during read so a concurrent save() can't swap the file
    # out from under us.
    try:
        with file_lock(latest, exclusive=False):
            try:
                with open(latest, encoding="utf-8") as f:
                    meta = _safe_json_load(f)
            except (ValueError, json.JSONDecodeError, OSError) as e:
                # ValueError is raised by SafeJSONDecoder for deeply-nested
                # payloads; treat the same as JSONDecodeError.
                logger.warning("corrupt latest.json (%s); ignoring snapshots",
                               _safe_log_value(e))
                return None
    except OSError as e:
        # Lock file couldn't be opened (e.g. permission denied on the
        # parent dir). Fall back to unlocked read — we still get the
        # atomic-replace guarantee from _atomic_write_json.
        logger.debug("load_latest: could not acquire shared lock (%s); "
                     "falling back to unlocked read", _safe_log_value(e))
        try:
            with open(latest, encoding="utf-8") as f:
                meta = _safe_json_load(f)
        except (ValueError, json.JSONDecodeError, OSError) as e:
            logger.warning("corrupt latest.json (%s); ignoring snapshots",
                           _safe_log_value(e))
            return None
    if not isinstance(meta, dict):
        logger.warning("latest.json is %s, not dict; ignoring",
                       type(meta).__name__)
        return None
    # Validate snapshot_id from latest.json (defends against path traversal).
    snap_id = meta.get("snapshot_id", "")
    try:
        _sanitize_id(snap_id)
    except ValueError:
        logger.warning("rejecting snapshot with invalid id: %s",
                       _safe_log_value(snap_id))
        return None
    snap_path = Path(meta["path"])
    # Ensure snap_path is within the home directory.
    try:
        snap_path.resolve().relative_to(p.resolve())
    except (ValueError, KeyError):
        logger.warning("rejecting snapshot path outside home: %s",
                       _safe_log_value(snap_path))
        return None
    if not snap_path.exists():
        return None
    # Snapshot size cap. Reject any snapshot file larger than
    # MAX_SNAPSHOT_SIZE (10 MB by default) so a malicious or runaway
    # snapshot cannot OOM the process. Realistic snapshots are well
    # under 1 MB even with millions of advice entries (compact JSON).
    try:
        snap_size = snap_path.stat().st_size
    except OSError as e:
        logger.warning("could not stat snapshot %s (%s); ignoring",
                       _safe_log_value(snap_path), _safe_log_value(e))
        return None
    if snap_size > MAX_SNAPSHOT_SIZE:
        logger.warning(
            "snapshot %s exceeds max size %d bytes (actual %d); ignoring",
            _safe_log_value(snap_path), MAX_SNAPSHOT_SIZE, snap_size,
        )
        return None
    # Corrupt snapshot file returns None instead of crash.
    # No lock needed here — snap_*.json is immutable once written.
    try:
        with open(snap_path, encoding="utf-8") as f:
            d = _safe_json_load(f)
    except (ValueError, json.JSONDecodeError, OSError) as e:
        # ValueError covers SafeJSONDecoder depth-limit violations.
        # Without this, a deeply-nested snapshot file would raise
        # RecursionError and brick every CLI command.
        logger.warning("corrupt snapshot %s (%s); ignoring",
                       _safe_log_value(snap_path), _safe_log_value(e))
        return None
    if not isinstance(d, dict):
        logger.warning("snapshot %s is %s, not dict; ignoring",
                       _safe_log_value(snap_path), type(d).__name__)
        return None
    # ---- v7.7+ full-payload integrity check ----
    stored_snapshot_hash = d.pop("snapshot_hash", None)
    if stored_snapshot_hash is not None:
        # v7.7+ snapshot: verify snapshot_hash covers the full payload.
        actual_snapshot_hash = _compute_snapshot_hash(d)
        if not hmac.compare_digest(stored_snapshot_hash, actual_snapshot_hash):
            logger.warning(
                "snapshot_hash mismatch for %s (stored=%s, actual=%s); "
                "rejecting entire snapshot (possible tampering)",
                _safe_log_value(snap_path), stored_snapshot_hash[:12],
                actual_snapshot_hash[:12],
            )
            return None  # do NOT load any partial state
    else:
        # Backward-compat path: v7.6 snapshot with advice_hash only.
        stored_advice_hash = d.pop("advice_hash", None)
        if stored_advice_hash is not None:
            advice_table = d.get("advice_table", {})
            actual_advice_hash = _compute_advice_hash(advice_table)
            if not hmac.compare_digest(stored_advice_hash, actual_advice_hash):
                logger.warning(
                    "advice_hash mismatch for %s (stored=%s, actual=%s); "
                    "rejecting snapshot (possible tampering)",
                    _safe_log_value(snap_path), stored_advice_hash[:12],
                    actual_advice_hash[:12],
                )
                return None
            logger.info("loaded v7.6 snapshot %s (advice_hash OK; will "
                        "migrate to snapshot_hash on next save)",
                        _safe_log_value(snap_path))
        else:
            # No integrity check at all — extremely old or untrusted.
            logger.warning("snapshot %s has no snapshot_hash and no "
                           "advice_hash; rejecting (untrusted)",
                           _safe_log_value(snap_path))
            return None
    # ---- v7.7+ rollback protection ----
    snap_sequence = d.get("sequence", 0)
    if not isinstance(snap_sequence, int) or isinstance(snap_sequence, bool):
        logger.warning("snapshot %s sequence is %s, not int; treating as 0",
                       _safe_log_value(snap_path), type(snap_sequence).__name__)
        snap_sequence = 0
    # Only enforce the rollback check on v7.7+ snapshots (sequence >= 1).
    # Legacy snapshots (sequence 0) predate the sequence field and are
    # always accepted (the worst case is loading an old advice_table,
    # which the snapshot_hash / advice_hash check already covers).
    if snap_sequence >= 1:
        high_water = _get_high_water_sequence(p)
        if high_water > 0 and snap_sequence < high_water:
            logger.warning(
                "rollback detected: snapshot %s has sequence=%d but "
                "high-water mark is %d; rejecting (possible rollback attack)",
                _safe_log_value(snap_path), snap_sequence, high_water,
            )
            return None
        # If this snapshot is newer than the recorded high-water mark
        # (e.g. a different process wrote it without our knowledge),
        # advance the high-water mark to match.
        if snap_sequence > high_water:
            _update_high_water_sequence(p, snap_sequence)
    logger.debug("load_latest: loaded snapshot id=%s path=%s seq=%s",
                 _safe_log_value(snap_id), _safe_log_value(snap_path),
                 snap_sequence)
    return Snapshot.from_dict(d)


def list_snapshots(path=None) -> list:
    p = _coerce_path(path or default_path())
    if not p.exists():
        return []
    snaps = []
    for f in sorted(p.glob("snap_*.json")):
        try:
            # Size cap. Skip any snapshot file larger than the limit
            # so listing doesn't load a multi-GB file just to extract
            # its metadata.
            try:
                if f.stat().st_size > MAX_SNAPSHOT_SIZE:
                    logger.warning(
                        "snapshot %s exceeds max size %d bytes; skipping",
                        _safe_log_value(f), MAX_SNAPSHOT_SIZE,
                    )
                    continue
            except OSError:
                continue
            with open(f, encoding="utf-8") as fh:
                d = _safe_json_load(fh)
            snaps.append({"snapshot_id": d["snapshot_id"],
                          "timestamp": d["timestamp"], "path": str(f)})
        except (ValueError, json.JSONDecodeError, KeyError, OSError):
            # ValueError covers SafeJSONDecoder depth-limit rejections.
            # Skip corrupt snapshots instead of crashing.
            continue
    return snaps


def save_in_flight(path, task_id: str, kind: str, payload_summary: dict,
                   queries_made: int, budget_total: int,
                   rng_state: Any) -> Path:
    """Save in-flight execution state for resumption after interruption.

    task_id is validated via _sanitize_id (defends against path traversal).
    rng_state is serialized properly (not str()'d). Atomic write —
    concurrent load_in_flight (resume=True) never reads a half-written
    inflight file. Exclusive flock during write so two processes resuming
    the same task_id can't both write at once (one blocks until the other
    finishes, then overwrites — last writer wins, which is correct because
    the most recent resume point is what matters).

    Integrity: the inflight dict now carries an ``inflight_hash`` field —
    HMAC-SHA256 of every other field, computed with the same
    per-installation secret key used for ``snapshot_hash``.
    ``load_in_flight`` verifies the hash on read and returns None on
    mismatch (treating the file as corrupt / tampered), so an attacker
    who can write to the snapshots dir but not to ``~/.srs/secret_key``
    can't tamper with ``queries_made`` to force a 0-query resume.
    """
    # Validate task_id before using in filename.
    _sanitize_id(task_id)
    p = _coerce_path(path)
    p.mkdir(parents=True, exist_ok=True)
    inflight = {
        "task_id": task_id,
        "kind": kind,
        "payload_summary": payload_summary,
        "queries_made": queries_made,
        "budget_total": budget_total,
        "budget_remaining": budget_total - queries_made,
        # Serialize rng state as a JSON-safe list (not str()).
        "rng_state": _serialize_rng_state(rng_state),
        # ISO 8601 UTC string (human-readable, time-zone-aware).
        "timestamp": _iso_now(),
    }
    # HMAC the inflight payload so tampering (e.g. setting
    # queries_made=999999 to force a 0-query resume) is detected on load.
    inflight["inflight_hash"] = _compute_inflight_hash(inflight)
    fpath = p / f"inflight_{task_id}.json"
    # Atomic write so load_in_flight never sees a torn file. Hold an
    # exclusive flock so two PROCESSES saving the same task_id serialize
    # (otherwise both tempfiles would race and os.replace would resolve to
    # whichever finished last, with no guarantee the winner had the most
    # recent skip_queries).
    with file_lock(fpath, exclusive=True):
        _atomic_write_json(fpath, inflight)
    return fpath


def load_in_flight(path, task_id: str) -> dict[str, Any] | None:
    """Load in-flight state for a specific task (validates task_id).

    Corrupt inflight JSON returns None instead of propagating
    JSONDecodeError — a half-written inflight file (now impossible thanks
    to _atomic_write_json, but defended anyway) degrades to "no resume
    state" rather than crashing execute().

    Shared flock during read so a concurrent save_in_flight in another
    process can't swap the file out from under us mid-json.load.

    Integrity: the ``inflight_hash`` HMAC is verified on read. On
    mismatch (or missing hash on a file that should have one) the file
    is treated as tampered / corrupt and None is returned — execute()
    will start the task fresh rather than resuming from an
    attacker-controlled ``queries_made`` value.
    """
    # Validate task_id before using in filename.
    _sanitize_id(task_id)
    p = _coerce_path(path)
    fpath = p / f"inflight_{task_id}.json"
    if not fpath.exists():
        return None

    def _load_and_verify() -> dict[str, Any] | None:
        """Open, parse, and HMAC-verify the inflight file."""
        try:
            with open(fpath, encoding="utf-8") as f:
                inflight = cast(dict[str, Any], _safe_json_load(f))
        except (ValueError, json.JSONDecodeError, OSError) as e:
            # ValueError covers SafeJSONDecoder depth-limit rejections.
            # Treat corrupt inflight as "no state".
            logger.warning("corrupt inflight %s (%s); treating as no state",
                           _safe_log_value(fpath), _safe_log_value(e))
            return None
        if not isinstance(inflight, dict):
            logger.warning("inflight %s is not a dict (%s); treating as no state",
                           _safe_log_value(fpath), type(inflight).__name__)
            return None
        # Verify the HMAC. Pop the stored hash BEFORE recomputing
        # so the recomputation covers the same payload that was signed.
        stored_hash = inflight.pop("inflight_hash", None)
        if stored_hash is not None:
            actual_hash = _compute_inflight_hash(inflight)
            if not hmac.compare_digest(stored_hash, actual_hash):
                # Tampered (or wrong secret key, e.g. file written by
                # a different install). Treat as no state so execute()
                # starts fresh rather than resuming from attacker-
                # controlled queries_made / budget_total.
                logger.warning(
                    "inflight hash mismatch for task %s; ignoring "
                    "(treating as no state)", _safe_log_value(task_id),
                )
                return None
        else:
            # No inflight_hash present. This is expected for inflight
            # files written by an older runtime version (pre-v7.8) that
            # did not compute the HMAC. For safety, log and treat as no
            # state — the caller will start the task fresh, which is a
            # correctness loss (no resume) but not a security hole.
            # Comment-level: backward-compat behavior could be tightened
            # to "reject" once v7.8 inflight files are widespread.
            logger.debug(
                "inflight %s has no inflight_hash (legacy file); "
                "treating as no state for safety", _safe_log_value(fpath),
            )
            return None
        return inflight

    # Shared lock during read.
    try:
        with file_lock(fpath, exclusive=False):
            return _load_and_verify()
    except OSError as e:
        # Lock file couldn't be opened; fall back to unlocked read.
        logger.debug("load_in_flight: could not acquire shared lock (%s); "
                     "falling back to unlocked read", _safe_log_value(e))
        return _load_and_verify()


def clear_in_flight(path, task_id: str) -> None:
    """Remove in-flight state after successful completion (validates task_id).

    unlink(missing_ok=True) so concurrent execute() calls with the same
    task_id cannot raise FileNotFoundError inside the caller's try/finally
    — that exception would have replaced the legitimate Result the caller
    was about to receive.

    Exclusive flock during unlink so a concurrent load_in_flight in
    another process can't observe a half-deleted file (open() succeeds
    but read() returns short). The lock is acquired before the unlink and
    released after; if the file doesn't exist, the lock context still
    runs but does nothing (file_lock on a non-existent path with
    exclusive=True creates it via O_CREAT, then we unlink it — slightly
    wasteful but correct).
    """
    # Validate task_id before using in filename.
    _sanitize_id(task_id)
    p = _coerce_path(path)
    fpath = p / f"inflight_{task_id}.json"
    # missing_ok=True — concurrent cleanup of the same task_id is now a
    # no-op for the loser, not a crash. Hold an exclusive flock so a
    # concurrent load_in_flight in another process either sees the file
    # (and reads it fully) or doesn't see it (open returns ENOENT) —
    # never sees a half-deleted file. The lock is best-effort; if the
    # file doesn't exist, file_lock creates it (O_CREAT) and we then
    # unlink it.
    try:
        with file_lock(fpath, exclusive=True):
            try:
                fpath.unlink(missing_ok=True)
            except TypeError:
                # Python <3.8 fallback (defensive; we require 3.8+ anyway).
                if fpath.exists():
                    fpath.unlink()
    except OSError as e:
        # Lock couldn't be acquired (e.g. permission denied on the
        # parent dir). Fall back to unlocked unlink — the missing_ok
        # behavior is still preserved.
        logger.debug("clear_in_flight: could not acquire exclusive lock (%s); "
                     "falling back to unlocked unlink", _safe_log_value(e))
        try:
            fpath.unlink(missing_ok=True)
        except TypeError:
            if fpath.exists():
                fpath.unlink()


def self_test() -> str:
    import tempfile
    with tempfile.TemporaryDirectory() as tmp:
        p = Path(tmp)
        # Test basic snapshot save/load. Timestamp is an ISO 8601 UTC string.
        s = Snapshot(snapshot_id="test1", timestamp=_iso_now(),
                     advice_table={"x": 1}, primitive_stats={"E": 1})
        fpath = save(s, p)
        assert fpath.exists()
        loaded = load_latest(p)
        assert loaded is not None
        assert loaded.snapshot_id == "test1"
        assert loaded.advice_table == {"x": 1}
        snaps = list_snapshots(p)
        assert len(snaps) == 1
        # Test in-flight state save/load/clear
        fpath = save_in_flight(p, "task_abc", "identify",
                                {"n_hyps": 64}, 5, 16, "rng_state_123")
        assert fpath.exists()
        inflight = load_in_flight(p, "task_abc")
        assert inflight is not None
        assert inflight["queries_made"] == 5
        assert inflight["budget_remaining"] == 11
        clear_in_flight(p, "task_abc")
        assert not fpath.exists()
        # Test str path.
        s2 = Snapshot(snapshot_id="test_str", timestamp=_iso_now(),
                      advice_table={}, primitive_stats={})
        fpath2 = save(s2, str(p))  # str, not Path
        assert fpath2.exists()
        loaded2 = load_latest(str(p))
        assert loaded2 is not None
        assert loaded2.snapshot_id == "test_str"
        # Path traversal rejection
        try:
            save_in_flight(p, "../../etc/evil", "identify", {}, 0, 16, "x")
            raise AssertionError("should reject path traversal")
        except ValueError:
            pass  # expected
        try:
            save_in_flight(p, "ok/../bad", "identify", {}, 0, 16, "x")
            raise AssertionError("should reject .. in id")
        except ValueError:
            pass  # expected
        # Snapshot hash tampering detection (v7.7: covers full payload).
        s3 = Snapshot(snapshot_id="tamper_test", timestamp=_iso_now(),
                      advice_table={"key": "value"}, primitive_stats={})
        save(s3, p)
        # Tamper with the saved advice_table without updating snapshot_hash.
        # v7.7 behavior: snapshot_hash covers the full payload, so any
        # tampering causes a hash mismatch and the snapshot is REJECTED
        # (load_latest returns None — no partial state is loaded).
        snap_file = p / "snap_tamper_test.json"
        with open(snap_file, encoding="utf-8") as f:
            d = _safe_json_load(f)
        d["advice_table"] = {"key": "TAMPERED"}  # change without updating hash
        with open(snap_file, "w", encoding="utf-8") as f:
            json.dump(d, f)
        loaded3 = load_latest(p)
        assert loaded3 is None, \
            "tampered snapshot should be rejected (snapshot_hash mismatch)"
        # rng state serialization round-trip
        rng = random.Random(42)
        state = rng.getstate()
        save_in_flight(p, "task_rng", "identify", {}, 3, 16, state)
        inflight_rng = load_in_flight(p, "task_rng")
        assert inflight_rng is not None, "in-flight file should exist just after save"
        restored = _deserialize_rng_state(inflight_rng["rng_state"])
        rng2 = random.Random()
        rng2.setstate(restored)
        assert rng2.getstate() == state, "rng state should round-trip"
    return "persistence OK"


if __name__ == "__main__":
    print(self_test())
