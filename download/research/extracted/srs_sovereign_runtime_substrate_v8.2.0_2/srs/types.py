"""Data classes shared across the SRS runtime.

This module defines the small set of types that cross module boundaries:
``Task`` (a unit of work), ``Result`` (its outcome), ``Snapshot``
(persisted runtime state), and the helpers that validate them.

Type-safety additions:
  - ``TaskKind`` enum: a string enum whose members are the only
    admissible ``Task.kind`` values. Existing string callers continue
    to work — ``TaskKind.IDENTIFY == "identify"`` is ``True`` because
    the enum subclasses ``str``.
  - ``IdentifyPayload`` / ``VerifyPayload`` / ... TypedDicts: one per
    task kind, documenting the shape of ``Task.payload``. They are not
    enforced at runtime (the pipeline still reaches into ``payload``
    with bare subscripts, and ``_validate_task`` is the runtime guard);
    they exist so callers who want static type-safety can opt in via
    the ``TaskPayload`` union alias.
"""
from __future__ import annotations

import hashlib
import json
import re
import time
import uuid
from dataclasses import asdict, dataclass, field, fields
from enum import Enum
from typing import Any, TypedDict

# --- Task kinds (enum so typos like "idenitfy" are caught by IDEs) ---


class TaskKind(str, Enum):
    """Admissible values for ``Task.kind``.

    Subclasses ``str`` so ``TaskKind.IDENTIFY == "identify"`` is ``True``
    and the enum serializes transparently to JSON. Callers may pass
    either the enum member or its string value to ``Task(kind=...)``;
    ``__post_init__`` normalizes the enum form back to the plain string
    so downstream code (persistence, logging, equality checks) sees a
    consistent ``str`` value.
    """

    IDENTIFY = "identify"
    IDENTIFY_HARD = "identify_hard"
    SEARCH = "search"
    OPTIMIZE = "optimize"
    VERIFY = "verify"
    COMPUTE = "compute"
    STORE = "store"
    AMORTIZE = "amortize"


# --- Payload shapes (TypedDicts document the per-kind contract) ---


class IdentifyPayload(TypedDict):
    """Payload for ``TaskKind.IDENTIFY`` / ``TaskKind.IDENTIFY_HARD``."""

    hypotheses: list[bytes]
    target_idx: int
    n_features: int


class IdentifyHardPayload(TypedDict):
    """Payload for ``TaskKind.IDENTIFY_HARD`` (advice-required variant)."""

    hypotheses: list[bytes]
    target_idx: int
    n_features: int


class SearchPayload(TypedDict):
    """Payload for ``TaskKind.SEARCH`` (Grover-style search)."""

    hypotheses: list[bytes]
    target_idx: int
    n_features: int


class OptimizePayload(TypedDict):
    """Payload for ``TaskKind.OPTIMIZE``."""

    hypotheses: list[bytes]
    target_idx: int
    n_features: int


class VerifyPayload(TypedDict):
    """Payload for ``TaskKind.VERIFY`` (carries the candidate to check)."""

    hypotheses: list[bytes]
    target_idx: int
    candidate_idx: int
    n_features: int
    verify_budget: int


class ComputePayload(TypedDict):
    """Payload for ``TaskKind.COMPUTE`` (target-free compute task)."""

    hypotheses: list[bytes]
    n_features: int


class StorePayload(TypedDict):
    """Payload for ``TaskKind.STORE`` (compress + persist)."""

    hypotheses: list[bytes]
    n_features: int


class AmortizePayload(TypedDict):
    """Payload for ``TaskKind.AMORTIZE`` (seed advice from prior runs)."""

    hypotheses: list[bytes]
    target_idx: int
    n_features: int


# Union of all per-kind payload shapes. Callers who want static type
# safety can annotate their payload with this alias; the runtime itself
# keeps ``Task.payload`` as ``dict[str, Any]`` because the pipeline
# reaches into it with bare subscripts and ``_validate_task`` is the
# runtime guard (raising typed errors on missing keys).
TaskPayload = (
    IdentifyPayload
    | IdentifyHardPayload
    | SearchPayload
    | OptimizePayload
    | VerifyPayload
    | ComputePayload
    | StorePayload
    | AmortizePayload
)


# Payload validation map: keys that each task kind REQUIRES in its payload.
# The pipeline stages reach into payload with bare subscripts; without this
# validation a missing key surfaces as a cryptic KeyError deep inside a
# stage function. ``_validate_task`` raises a typed ValueError listing
# the missing keys so the caller gets an actionable message.
PAYLOAD_REQUIRED_KEYS: dict[str, tuple[str, ...]] = {
    TaskKind.IDENTIFY.value:      ("hypotheses", "target_idx", "n_features"),
    TaskKind.IDENTIFY_HARD.value: ("hypotheses", "target_idx", "n_features"),
    TaskKind.SEARCH.value:        ("hypotheses", "target_idx", "n_features"),
    TaskKind.OPTIMIZE.value:      ("hypotheses", "target_idx", "n_features"),
    TaskKind.VERIFY.value:        ("hypotheses", "target_idx", "n_features"),
    TaskKind.COMPUTE.value:       ("hypotheses", "target_idx"),  # needs target for hash_bit
    TaskKind.STORE.value:         ("hypotheses", "target_idx"),
    TaskKind.AMORTIZE.value:      ("hypotheses", "target_idx", "n_features"),
}

# Valid task kinds (for unknown-kind rejection at validation time).
VALID_TASK_KINDS: frozenset[str] = frozenset(PAYLOAD_REQUIRED_KEYS.keys())

# n_features valid range (an n_features > 64 causes OverflowError because
# rng.getrandbits(n_features) produces >64-bit int, and x.to_bytes(8, "big")
# in hash_bit raises OverflowError).
MAX_N_FEATURES = 64

# Cap on the number of hypotheses we will accept in a Task.
# Without this, ``execute identify 999999999`` would attempt to allocate
# ~1 GB of hashlib.sha256 digests and OOM-kill the process. 10**6 is
# already far beyond any realistic problem size for the current planner
# (whose cost model is O(N log N) at worst).
MAX_HYPOTHESES = 1_000_000

# task_id validation regex. The default factory produces
# ``uuid.uuid4().hex[:12]`` which always matches this pattern, but a
# caller can pass a custom ``task_id``. Without validation, a hostile
# or buggy caller could inject control characters (e.g. ``"evil\x00task"``)
# that propagate to logging (log injection) and execution_history
# (untrusted-history exposure). ``_sanitize_task_id`` below uses
# this regex; ``Task.__post_init__`` calls it.
_TASK_ID_RE = re.compile(r'^[a-zA-Z0-9_-]{1,64}$')

# Windows reserved device names. On Windows, filenames like
# ``CON.json``, ``PRN.json``, ``AUX.json``, ``NUL.json``, ``COM1.json``
# and ``LPT1.json`` (through ``LPT9``) are interpreted as references
# to legacy DOS device files — the OS will refuse to create them, will
# return the device's contents on read, or will hang indefinitely.
# Snapshot / inflight files are written as ``snap_{task_id}.json`` and
# ``inflight_{task_id}.json``, so a task_id like ``CON`` would produce
# ``snap_CON.json`` — which Windows interprets as a CON device write.
# The regex below matches these names with ANY extension (the trailing
# ``(\.|$)`` covers both ``CON`` and ``CON.txt``). It is case-insensitive
# because Windows filesystems are case-insensitive. ``_sanitize_task_id``
# prefixes any task_id that matches with ``srs_`` so the resulting
# filename is safe on Windows as well as POSIX.
_WINDOWS_RESERVED_RE = re.compile(
    r'^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)',
    re.IGNORECASE,
)


def _sanitize_task_id(task_id: Any) -> str:
    """Validate / sanitize a task_id.

    The default factory ``uuid.uuid4().hex[:12]`` always produces a
    safe id, so for the common case this is a no-op (just a regex
    check). For a caller-supplied ``task_id``, we:

      - Reject non-string types with TypeError (programmer error).
      - For string ids that already match ``_TASK_ID_RE`` (alphanumeric,
        underscore, hyphen; 1-64 chars), return unchanged — UNLESS the
        sanitized id matches a Windows reserved device name (CON, PRN,
        AUX, NUL, COM1-9, LPT1-9). In that case we prefix with ``srs_``
        so the resulting snapshot filename (``snap_{task_id}.json``)
        is safe on Windows as well as POSIX.
      - For string ids that DON'T match, sanitize by replacing every
        character outside ``[a-zA-Z0-9_-]`` with ``_`` and truncating
        to 64 chars. This preserves caller intent (e.g. ``"my task 1"``
        becomes ``"my_task_1"``) while guaranteeing the result is safe
        to use in filenames, logs, and JSON. The Windows reserved-name
        check is then applied to the sanitized result.

    Sanitization rather than rejection is chosen deliberately: existing
    callers may pass ids with spaces or other punctuation that worked
    by accident before; raising would break them. Sanitization keeps
    them working while closing the security hole.
    """
    if not isinstance(task_id, str):
        raise TypeError(
            f"task_id must be str, got {type(task_id).__name__}"
        )
    if _TASK_ID_RE.match(task_id):
        sanitized = task_id
    else:
        # Replace any character outside the safe set with '_'.
        sanitized = re.sub(r'[^a-zA-Z0-9_-]', '_', task_id)
        # Truncate to 64 chars (the regex's max length).
        sanitized = sanitized[:64]
        # Edge case: if the result is empty (e.g. input was all invalid
        # chars), fall back to a uuid so the Task always has a non-empty id.
        if not sanitized:
            sanitized = uuid.uuid4().hex[:12]
    # Prefix Windows reserved device names so the resulting
    # filename (snap_{task_id}.json / inflight_{task_id}.json) is safe
    # to create on Windows as well as POSIX. Without this prefix, a
    # task_id of "CON" would produce snap_CON.json which Windows
    # interprets as a write to the CON device (hangs / fails / silently
    # writes to the console instead of a file). The prefix is only
    # applied when needed so existing task_ids are unchanged.
    if _WINDOWS_RESERVED_RE.match(sanitized):
        sanitized = f"srs_{sanitized}"
    return sanitized


@dataclass
class Task:
    """A unit of work submitted to the runtime.

    ``kind`` accepts either a plain string (``"identify"``) or a
    ``TaskKind`` member; ``__post_init__`` normalizes the enum form to
    its string value so downstream code (persistence, JSON dumps,
    equality checks) always sees ``str``.

    ``payload`` is typed ``dict[str, Any]`` for runtime flexibility
    (the pipeline accesses it with bare subscripts); callers who want
    static type-safety should annotate their payload with one of the
    ``IdentifyPayload`` / ``VerifyPayload`` / ... TypedDicts.
    """

    kind: str | TaskKind
    payload: dict[str, Any]
    budget: int = 16
    required_primitives: list[str] | None = None
    task_id: str = field(default_factory=lambda: uuid.uuid4().hex[:12])

    def __post_init__(self) -> None:
        """Defense-in-depth input validation at construction.

        Kept deliberately cheap: type checks + a length cap on the
        (optional) hypotheses list. Full payload-key validation is
        done by ``_validate_task`` at execute()/plan_task() entry, not
        here, because constructing a Task without intending to execute
        it (e.g. for inspection) should not require a complete payload.

        Note: ``task_id`` sanitization is enforced by
        ``__setattr__`` below rather than here. That override catches
        BOTH the dataclass-``__init__`` assignment (construction-time)
        AND any subsequent ``task.task_id = ...`` mutation
        (post-construction). The previous version of this method used
        ``object.__setattr__(self, 'task_id', _sanitize_task_id(...))``
        which only fired at construction, leaving post-construction
        mutation unsanitized.
        """
        # Normalize TaskKind → str so persistence/logging see a plain string.
        if isinstance(self.kind, TaskKind):
            self.kind = self.kind.value
        # Type validation — fail fast on programmer error.
        if not isinstance(self.payload, dict):
            raise TypeError(
                f"Task.payload must be dict, got {type(self.payload).__name__}"
            )
        if not isinstance(self.budget, int) or isinstance(self.budget, bool):
            raise TypeError(
                f"Task.budget must be int, got {type(self.budget).__name__}"
            )
        # Negative budget makes no sense and breaks the planner
        # (log2 / sqrt of negative). Reject up front.
        if self.budget < 0:
            raise ValueError(
                f"Task.budget must be 0 or greater, got {self.budget}"
            )
        # Cap hypotheses length so we never allocate too much memory
        # for an oversized input. The cap is shared with the CLI.
        hyps = self.payload.get("hypotheses")
        if hyps is not None:
            try:
                n = len(hyps)
            except TypeError as exc:
                raise TypeError(
                    "Task.payload['hypotheses'] must be a sized iterable, "
                    f"got {type(hyps).__name__}"
                ) from exc
            if n > MAX_HYPOTHESES:
                # Plain-English message (was: jargon-y "(prevents OOM)"
                # parenthetical and internal cap name).
                raise ValueError(
                    f"Task.payload['hypotheses'] length {n} is too large. "
                    f"Maximum supported length is {MAX_HYPOTHESES}. "
                    f"Please use a smaller list."
                )
        # task_id sanitization is now done in
        # ``__setattr__`` (see below), which fires on EVERY assignment
        # — both the dataclass-``__init__`` assignment that just
        # happened and any future ``task.task_id = ...`` mutation. The
        # previous ``object.__setattr__(self, 'task_id', ...)`` line
        # here only fired at construction, leaving post-construction
        # mutation unsanitized.

    def __setattr__(self, name: str, value: Any) -> None:
        """Sanitize ``task_id`` on EVERY assignment.

        The dataclass-generated ``__init__`` does
        ``self.task_id = <caller value or default>`` which goes through
        this override, so construction-time sanitization is covered.
        Any later ``task.task_id = ...`` (e.g. a caller reassigning
        to a hostile value AFTER construction) is also caught.

        An earlier fix (``__post_init__`` calling
        ``object.__setattr__(self, 'task_id', _sanitize_task_id(...))``)
        ONLY sanitized at construction. Post-construction mutation
        like ``task.task_id = "../../etc/passwd"`` bypassed it entirely
        because ``task_id`` was a plain dataclass field with no setter
        validation. This override closes that gap.

        ``None`` is passed through unchanged (defensive: a caller who
        explicitly sets ``task.task_id = None`` gets ``None``; the
        ``_sanitize_task_id`` function would raise ``TypeError`` on
        ``None``, but we don't want to break callers who rely on the
        ``Optional``-ness for testing/inspection — they'd hit the
        ``TypeError`` themselves the moment they tried to USE the id).
        """
        if name == "task_id" and value is not None:
            value = _sanitize_task_id(value)
        super().__setattr__(name, value)

    def fingerprint(self) -> str:
        h = hashlib.sha256(json.dumps({
            "kind": self.kind,
            "payload": self.payload,
            "budget": self.budget,
        }, sort_keys=True, default=str).encode()).hexdigest()
        return h[:16]


def _validate_task(task: Task) -> None:
    """Validate that a Task's payload has the keys its kind requires.

    The 6 stage functions in srs/pipeline.py reach into
    ``task.payload["hypotheses"]`` / ``task.payload["target_idx"]`` with
    bare subscripts. A missing key surfaces as a cryptic KeyError deep
    inside the pipeline. This function raises a typed ValueError
    listing the missing keys so the caller gets an actionable message.

    Called at the top of ``Runtime.execute()`` and ``Runtime.plan_task()`` —
    the two entry points where a Task transitions from user input to
    pipeline input.

    Empty hypotheses list is rejected for task kinds that require a
    target_idx (identify, identify_hard, search, optimize, verify,
    amortize). Previously the ``n > 0`` guard in the target_idx range
    check SKIPPED validation when n==0, so an empty hypotheses list
    slipped through and crashed the pipeline with IndexError on
    ``hypotheses[target_idx]``. Negative target_idx is also rejected
    explicitly (was previously caught by the range check when n > 0,
    but the error message "out of range [0, n)" was unclear for
    negatives).
    """
    if not isinstance(task, Task):
        raise TypeError(f"expected Task, got {type(task).__name__}")
    # Reject unknown task kinds explicitly (was: silently return,
    # letting the pipeline crash with IndexError on hypotheses[target_idx]).
    if task.kind not in VALID_TASK_KINDS:
        raise ValueError(
            f"Unknown task kind {task.kind!r}. Valid kinds: "
            f"{sorted(VALID_TASK_KINDS)}"
        )
    required = PAYLOAD_REQUIRED_KEYS.get(task.kind)
    if not required:
        return  # unreachable (VALID_TASK_KINDS check above), defensive
    missing = [k for k in required if k not in task.payload]
    if missing:
        raise ValueError(
            f"task kind {task.kind!r} requires payload keys "
            f"{list(required)}; missing: {missing} "
            f"(present: {list(task.payload.keys())})"
        )
    # Validate n_features is in [0, 64] to prevent OverflowError
    # in hash_bit (rng.getrandbits(n_features) for n_features > 64 produces
    # a >64-bit int; x.to_bytes(8, "big") raises OverflowError).
    if "n_features" in required:
        n_features = task.payload["n_features"]
        if not isinstance(n_features, int) or isinstance(n_features, bool):
            raise TypeError(
                f"payload['n_features'] must be int, got {type(n_features).__name__}"
            )
        if n_features < 0 or n_features > MAX_N_FEATURES:
            raise ValueError(
                f"payload['n_features']={n_features} is out of range. "
                f"Valid range is 0 to {MAX_N_FEATURES}."
            )
    # Validate target_idx is in range if hypotheses is present.
    if "target_idx" in required and "hypotheses" in task.payload:
        hyps = task.payload["hypotheses"]
        try:
            n = len(hyps)
        except TypeError as exc:
            raise TypeError(
                "payload['hypotheses'] must be a sized iterable, "
                f"got {type(hyps).__name__}"
            ) from exc
        tgt = task.payload["target_idx"]
        if not isinstance(tgt, int) or isinstance(tgt, bool):
            raise TypeError(
                f"payload['target_idx'] must be int, got {type(tgt).__name__}"
            )
        # Empty hypotheses list must be rejected for task kinds that
        # require a target_idx — otherwise the pipeline crashes with
        # IndexError on `hypotheses[target_idx]` (the previous `n > 0`
        # guard skipped the range check when n==0, letting the empty
        # list through).
        if n == 0:
            raise ValueError(
                f"task kind {task.kind!r} requires a non-empty "
                f"hypotheses list (got length 0); target_idx={tgt} "
                f"has nothing to index into"
            )
        # Negative target_idx is never valid (the range check below
        # would catch it when n > 0, but the error message was unclear
        # for negatives). Plain-English range wording (was: math
        # half-open notation `[0, n)`).
        if tgt < 0:
            raise ValueError(
                f"payload['target_idx']={tgt} is negative. Valid range "
                f"is 0 to {n - 1} (for {n} hypotheses)."
            )
        if tgt >= n:
            raise ValueError(
                f"payload['target_idx']={tgt} is out of range. Valid "
                f"range is 0 to {n - 1} (for {n} hypotheses)."
            )


@dataclass
class Result:
    """Outcome of executing a Task."""

    task_id: str
    answer: Any
    correct: bool | None = None
    verified: bool | None = None
    primitives_used: list[str] = field(default_factory=list)
    queries: int = 0
    storage_bytes: int = 0
    work_units: int = 0
    depth: int = 0
    communication_bits: int = 0
    verification_calls: int = 0
    wall_time_ms: float = 0.0
    notes: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class Snapshot:
    """A persistent runtime state snapshot.

    ``snapshot_hash`` stores the HMAC-SHA256 of the ENTIRE snapshot
    payload (everything except the hash field itself) for tamper
    detection on load. This covers ``advice_table``,
    ``primitive_stats``, ``last_task_id``, ``last_result``,
    ``execution_history``, and ``sequence`` — not just ``advice_table``
    as the older ``advice_hash`` did. Optional (default None) so
    ``from_dict`` can load older snapshots that predate the
    full-payload hash; on first save the snapshot is migrated to
    ``snapshot_hash``.

    ``advice_hash`` is kept as a backward-compatibility field: old
    snapshots written by v7.6 carry ``advice_hash`` (HMAC of
    ``advice_table`` only). On load, if ``snapshot_hash`` is absent
    but ``advice_hash`` is present, the loader verifies the
    ``advice_hash`` (and migrates to ``snapshot_hash`` on the next
    save). New snapshots are written with ``snapshot_hash`` only.

    ``sequence`` is a monotonically increasing counter assigned by
    ``persistence.save()``. The current high-water sequence number
    is tracked in ``sequence.json`` (HMAC-protected) in the snapshot
    directory; on load, any snapshot whose sequence is lower than
    the high-water mark is rejected as a rollback attempt. Default 0
    for backward compatibility with old snapshots that predate the
    sequence field — the loader treats 0 as "no sequence info, do
    not enforce the rollback check on this snapshot".

    ``timestamp`` is an ISO 8601 UTC string
    (e.g. ``"2025-06-15T14:23:45.123456+00:00"``) instead of an epoch
    float (e.g. ``1784313766.4212925``). The dataclass annotation is
    ``str`` for new snapshots; the ``from_dict`` loader accepts either
    str (new format) or float/int (old format) and normalizes to ISO
    8601 UTC for backward compatibility with snapshots written by an
    older runtime.
    """

    snapshot_id: str
    timestamp: str
    advice_table: dict[str, Any]
    primitive_stats: dict[str, Any]
    last_task_id: str | None = None
    last_result: dict[str, Any] | None = None
    advice_hash: str | None = None  # legacy integrity check (advice_table only)
    snapshot_hash: str | None = None  # full-payload HMAC (v7.7+)
    sequence: int = 0  # monotonic counter for rollback protection (v7.7+)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> Snapshot:
        # Ignore unknown keys, fill missing with defaults. Lets older
        # snapshots (missing newer fields) load cleanly.
        known = {f.name for f in fields(cls)}
        filtered = {k: v for k, v in d.items() if k in known}
        # Backward-compatible timestamp coercion. Old snapshots stored
        # ``time.time()`` epoch floats here. We normalize to ISO 8601 UTC
        # on load so the in-memory model is always a string. This is a
        # one-way conversion (we never write floats back to disk).
        if "timestamp" in filtered:
            # Local import avoids a circular dependency (types.py is
            # imported by persistence.py at module load time).
            from .persistence import _coerce_timestamp
            filtered["timestamp"] = _coerce_timestamp(filtered["timestamp"])
        else:
            # No timestamp in the dict (e.g. constructed by hand without
            # one) — fill in the current time so the dataclass invariant
            # (timestamp is a string) holds.
            from .persistence import _iso_now
            filtered["timestamp"] = _iso_now()
        return cls(**filtered)


def now_ms() -> float:
    return time.perf_counter() * 1000.0
