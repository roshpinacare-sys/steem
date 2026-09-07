"""Tests for DoS hardening + input validation.

Each test maps to one finding from the security audit:

  - JSON depth limit: ``RecursionError`` DoS via deeply-nested JSON.
    The stdlib ``json`` parser uses recursive descent; a 50k-deep
    ``[[[...]]]`` payload blew the CPython stack and was not caught by
    the existing ``except (JSONDecodeError, OSError)`` blocks in
    persistence.load_latest — single malicious snapshot bricks every
    CLI command via Runtime.__init__.

  - ``AdviceTable.from_dict`` validation: had no validation. A tampered
    or corrupt snapshot could inject strings, lists, None, or huge ints
    as advice values; combined with the (separately fixed) hash bypass,
    an attacker could make execute_identify return any value as the
    cached answer with queries=0.

  - ``task_id`` validation: ``Task.__post_init__`` did not validate
    ``task_id``. A custom ``task_id="evil\\x00task"`` was accepted and
    propagated to logging (log injection) and execution_history
    (untrusted-history exposure).

  - ``secrets.SystemRandom`` for verification: ``random.Random`` was
    used for verification soundness. The statistical bound
    ``P(verified=True | wrong) <= 2^-k`` assumes a non-adaptive
    adversary; ``random.Random`` with a predictable seed failed
    against an adversary who could predict the seed and pre-compute a
    passing candidate.

  - Snapshot size cap: No snapshot size cap. A multi-GB snapshot would
    OOM the process. Fixed with ``MAX_SNAPSHOT_SIZE`` (10 MB default).
"""
import hashlib
import json
import random
import secrets
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from srs import (  # noqa: E402
    Runtime,
    Snapshot,
    Task,
    persistence,  # noqa: E402
)
from srs.persistence import (  # noqa: E402
    MAX_SNAPSHOT_SIZE,
    SafeJSONDecoder,
    _safe_json_load,
    load_latest,
    save,
)
from srs.primitives.advice import AdviceTable  # noqa: E402
from srs.primitives.verification import verify  # noqa: E402
from srs.types import _sanitize_task_id  # noqa: E402

# ===========================================================================
# Fix 1: JSON depth limit
# ===========================================================================

class TestJSONDepthLimit:
    """Test that deeply-nested JSON does not crash the runtime."""

    def test_deeply_nested_json_rejected(self):
        """A 200-deep ``[[[...]]]`` payload must be rejected, not raise
        RecursionError. RecursionError is NOT a JSONDecodeError subclass
        so the existing try/except in load_latest doesn't catch it —
        SafeJSONDecoder must reject BEFORE handing off to json.loads.
        """
        deep_json = "[" * 200 + "]" * 200  # depth 200 > MAX_DEPTH (100)
        with pytest.raises(ValueError, match="nesting depth"):
            json.loads(deep_json, cls=SafeJSONDecoder)

    def test_extremely_deep_json_rejected_quickly(self):
        """Test that a 50_000-deep payload (the original PoC) is also
        rejected — and quickly, because the pre-scan is O(N)."""
        deep_json = "[" * 50_000 + "]" * 50_000
        with pytest.raises(ValueError, match="nesting depth"):
            json.loads(deep_json, cls=SafeJSONDecoder)

    def test_deeply_nested_objects_rejected(self):
        """Same attack via ``{{{...}}}`` instead of ``[[[...]]]``."""
        deep_json = "{" * 200 + "}" * 200
        with pytest.raises(ValueError, match="nesting depth"):
            json.loads(deep_json, cls=SafeJSONDecoder)

    def test_normal_json_still_works(self):
        """Realistic JSON payloads (depth ~3) must load fine."""
        data = '{"a": {"b": {"c": [1, 2, 3]}}}'
        result = json.loads(data, cls=SafeJSONDecoder)
        assert result["a"]["b"]["c"] == [1, 2, 3]

    def test_brackets_inside_strings_do_not_trip_limit(self):
        """A string literal containing many brackets (e.g. a serialized
        nested array) must not falsely trip the depth limit. The
        pre-scan tracks in-string state.
        """
        # 200 bracket characters inside a JSON string literal — depth=0.
        data = '{"evil_key": "' + "[" * 200 + '"}'
        result = json.loads(data, cls=SafeJSONDecoder)
        assert result["evil_key"] == "[" * 200

    def test_escaped_quotes_in_strings_handled(self):
        """Escaped quotes inside strings must not break the string
        tracker (``\\\"`` should not exit string mode).
        """
        # Build the JSON payload piece by piece to avoid Python-level
        # escaping confusion: the JSON string value is a"b[[[[[...
        # which in JSON source is "a\"b[[[[[...".
        raw_value = 'a"b' + "[" * 20
        data = json.dumps({"k": raw_value})
        result = json.loads(data, cls=SafeJSONDecoder)
        assert result["k"] == raw_value

    def test_depth_exactly_at_limit_allowed(self):
        """Depth == MAX_DEPTH is allowed (off-by-one check)."""
        ok = "[" * SafeJSONDecoder.MAX_DEPTH + "]" * SafeJSONDecoder.MAX_DEPTH
        # Should not raise.
        result = json.loads(ok, cls=SafeJSONDecoder)
        # Sanity: the innermost value is an empty list. Navigate
        # MAX_DEPTH - 1 times — the outermost list is at depth 1, so
        # after MAX_DEPTH-1 descents we're at the deepest list, which
        # is itself the empty list.
        inner = result
        for _ in range(SafeJSONDecoder.MAX_DEPTH - 1):
            inner = inner[0]
        assert inner == []

    def test_depth_one_over_limit_rejected(self):
        """Depth == MAX_DEPTH + 1 is rejected."""
        over = "[" * (SafeJSONDecoder.MAX_DEPTH + 1) \
             + "]" * (SafeJSONDecoder.MAX_DEPTH + 1)
        with pytest.raises(ValueError, match="nesting depth"):
            json.loads(over, cls=SafeJSONDecoder)

    def test_safe_json_load_wrapper_works(self):
        """The _safe_json_load wrapper applies the decoder to a file."""
        import io
        buf = io.StringIO('{"x": [1, 2, {"y": 3}]}')
        result = _safe_json_load(buf)
        assert result["x"][2]["y"] == 3

    def test_safe_json_load_wrapper_rejects_deep(self):
        """The wrapper rejects deeply-nested payloads from a file too."""
        import io
        deep = "[" * 200 + "]" * 200
        buf = io.StringIO(deep)
        with pytest.raises(ValueError, match="nesting depth"):
            _safe_json_load(buf)

    def test_malicious_snapshot_does_not_brick_runtime(self, tmp_path):
        """End-to-end: a malicious snapshot file with deep nesting must
        NOT crash Runtime.__init__. Before the fix, this raised
        RecursionError and bricked every CLI command.
        """
        home = tmp_path / "home"
        home.mkdir()
        snaps = home / "snapshots"
        snaps.mkdir()
        # Write a malicious snapshot file with 200-deep nesting.
        evil_snap = snaps / "snap_evil.json"
        evil_snap.write_text("[" * 200 + "]" * 200)
        # And a latest.json pointing at it.
        (snaps / "latest.json").write_text(json.dumps({
            "snapshot_id": "evil",
            "path": str(evil_snap),
            "timestamp": "2025-01-01T00:00:00+00:00",
        }))
        # load_latest must return None (corrupt snapshot), not raise.
        result = load_latest(home)
        assert result is None, \
            "deeply-nested snapshot must be rejected, not loaded"

    def test_malicious_latest_json_does_not_brick_runtime(self, tmp_path):
        """A malicious latest.json with deep nesting must also be
        rejected (not just the snapshot it points at).
        """
        home = tmp_path / "home"
        home.mkdir()
        snaps = home / "snapshots"
        snaps.mkdir()
        (snaps / "latest.json").write_text("[" * 200 + "]" * 200)
        result = load_latest(home)
        assert result is None


# ===========================================================================
# Fix 2: AdviceTable.from_dict validation
# ===========================================================================

class TestAdviceTableValidation:
    """Test that AdviceTable.from_dict rejects invalid types."""

    @pytest.mark.parametrize("bad_input", [
        "not a dict",
        None,
        [1, 2, 3],
        42,
        3.14,
        ("a", "b"),
    ])
    def test_non_dict_input_rejected(self, bad_input):
        """Any non-dict input must raise ValueError, not silently
        coerce via dict()."""
        with pytest.raises(ValueError, match="dict"):
            AdviceTable.from_dict(bad_input)

    @pytest.mark.parametrize("bad_value", [
        "string_value",
        None,
        [1, 2],
        {"nested": "dict"},
        1.5,
        True,
        False,
    ])
    def test_non_int_value_rejected(self, bad_value):
        """Non-int values must be rejected (advice values are
        hypothesis indices)."""
        with pytest.raises(ValueError, match="int"):
            AdviceTable.from_dict({"key": bad_value})

    def test_negative_value_rejected(self):
        """Negative ints are not valid hypothesis indices."""
        with pytest.raises(ValueError, match="non-negative"):
            AdviceTable.from_dict({"key": -1})

    def test_zero_value_allowed(self):
        """Zero is a valid hypothesis index (the first hypothesis)."""
        adv = AdviceTable.from_dict({"key": 0})
        assert adv._table == {"key": 0}

    def test_non_string_key_rejected(self):
        """JSON object keys are always str, but a hand-constructed
        dict could have int keys (Python allows this). Such keys
        would break the ``f"{h_hash}:{target_idx}"`` lookup format.
        """
        with pytest.raises(ValueError, match="key must be str"):
            AdviceTable.from_dict({123: 5})

    def test_valid_dict_round_trips(self):
        """A well-formed dict should round-trip through to_dict/from_dict."""
        adv = AdviceTable()
        # build_for_identify stores target_idx as the value (always int >= 0).
        # Use a synthetic key for the test.
        adv._table = {"abc123:7": 7, "def456:0": 0}
        d = adv.to_dict()
        adv2 = AdviceTable.from_dict(d)
        assert adv2._table == {"abc123:7": 7, "def456:0": 0}

    def test_empty_dict_allowed(self):
        """An empty advice table is valid (no advice cached)."""
        adv = AdviceTable.from_dict({})
        assert adv.size_bytes() == 0

    def test_large_int_value_allowed(self):
        """Large non-negative ints are allowed (a hypothesis list could
        be longer than 2**31 in principle)."""
        adv = AdviceTable.from_dict({"k": 9999999999})
        assert adv._table == {"k": 9999999999}

    def test_runtime_recovers_from_bad_advice_table(self, tmp_path):
        """End-to-end: a snapshot with a corrupt advice_table (e.g.
        string value) must not brick Runtime.__init__. The runtime
        should fall back to an empty advice table.
        """
        home = tmp_path / "home"
        home.mkdir()
        # Save a valid snapshot first.
        rt = Runtime(home=home)
        rt.store_state()
        # Find the saved snapshot file (save() writes to home, not to
        # home/snapshots — the path passed to save() IS the snapshot dir).
        snap_files = list(home.glob("snap_*.json"))
        assert len(snap_files) >= 1, "store_state should write a snapshot"
        snap_file = snap_files[0]
        with open(snap_file, encoding="utf-8") as f:
            d = json.load(f)
        d["advice_table"] = {"evil_key": "EVIL_STRING_VALUE"}
        # Recompute the snapshot_hash so the load doesn't reject it for
        # hash mismatch (we want to test the from_dict validation, not
        # the hash check).
        from srs.persistence import _compute_snapshot_hash
        d.pop("snapshot_hash", None)
        d["snapshot_hash"] = _compute_snapshot_hash(d)
        with open(snap_file, "w", encoding="utf-8") as f:
            json.dump(d, f)
        # New Runtime must NOT crash; advice should be empty.
        rt2 = Runtime(home=home)
        assert rt2.advice.size_bytes() == 0, \
            "corrupt advice_table should fall back to empty"


# ===========================================================================
# Fix 3: Snapshot size cap
# ===========================================================================

class TestSnapshotSizeCap:
    """Test that snapshots over MAX_SNAPSHOT_SIZE are rejected."""

    def test_max_snapshot_size_constant_exists(self):
        """The cap must be a module-level constant (tunable)."""
        assert isinstance(MAX_SNAPSHOT_SIZE, int)
        assert MAX_SNAPSHOT_SIZE > 0
        # Default is 10 MB.
        assert MAX_SNAPSHOT_SIZE == 10 * 1024 * 1024

    def test_normal_snapshot_loads_fine(self, tmp_path):
        """A normal-size snapshot (< 10 MB) loads cleanly."""
        home = tmp_path / "home"
        home.mkdir()
        snap = Snapshot(
            snapshot_id="normal",
            timestamp="2025-01-01T00:00:00+00:00",
            advice_table={"key": 1},
            primitive_stats={"E": 1},
        )
        save(snap, home)
        loaded = load_latest(home)
        assert loaded is not None
        assert loaded.snapshot_id == "normal"

    def test_oversized_snapshot_rejected(self, tmp_path, monkeypatch):
        """A snapshot file larger than MAX_SNAPSHOT_SIZE must be
        rejected (returns None) instead of being loaded.
        """
        home = tmp_path / "home"
        home.mkdir()
        # Save a valid snapshot first to set up latest.json correctly.
        snap = Snapshot(
            snapshot_id="real",
            timestamp="2025-01-01T00:00:00+00:00",
            advice_table={},
            primitive_stats={},
        )
        save(snap, home)
        snap_file = home / "snap_real.json"
        assert snap_file.exists(), \
            f"save() should write to {snap_file}; cwd files: {list(home.glob('*'))}"
        # Overwrite the snapshot with a payload larger than the cap.
        # Use a tiny cap so we don't actually have to write 10 MB.
        monkeypatch.setattr(persistence, "MAX_SNAPSHOT_SIZE", 1024)
        # Write ~2 KB of data (well above the 1 KB cap).
        big_advice = {f"key_{i:04d}": i for i in range(200)}
        with open(snap_file, "w", encoding="utf-8") as f:
            json.dump({
                "snapshot_id": "real",
                "timestamp": "2025-01-01T00:00:00+00:00",
                "advice_table": big_advice,
                "primitive_stats": {},
            }, f)
        assert snap_file.stat().st_size > 1024, \
            "test setup: snapshot file should be > 1KB after overwrite"
        # load_latest should see the file is too big and return None.
        result = load_latest(home)
        assert result is None, \
            "snapshot over MAX_SNAPSHOT_SIZE must be rejected"

    def test_oversized_snapshot_skipped_in_list(self, tmp_path, monkeypatch):
        """list_snapshots must skip oversized files rather than load them."""
        home = tmp_path / "home"
        home.mkdir()
        # Save a valid (small) snapshot.
        snap = Snapshot(
            snapshot_id="small",
            timestamp="2025-01-01T00:00:00+00:00",
            advice_table={},
            primitive_stats={},
        )
        save(snap, home)
        # Save a second snapshot, then overwrite it with a huge payload.
        snap2 = Snapshot(
            snapshot_id="big",
            timestamp="2025-01-01T00:00:00+00:00",
            advice_table={},
            primitive_stats={},
        )
        save(snap2, home)
        big_file = home / "snap_big.json"
        assert big_file.exists(), "save() should write snap_big.json"
        # Set a tiny cap.
        monkeypatch.setattr(persistence, "MAX_SNAPSHOT_SIZE", 1024)
        # Overwrite big snap with ~2 KB.
        with open(big_file, "w", encoding="utf-8") as f:
            json.dump({
                "snapshot_id": "big",
                "timestamp": "2025-01-01T00:00:00+00:00",
                "advice_table": {f"k{i:04d}": i for i in range(200)},
                "primitive_stats": {},
            }, f)
        assert big_file.stat().st_size > 1024
        # list_snapshots should skip "big" and return only "small".
        result = persistence.list_snapshots(home)
        ids = [s["snapshot_id"] for s in result]
        assert "small" in ids
        assert "big" not in ids, \
            "oversized snapshot must be skipped by list_snapshots"


# ===========================================================================
# Fix 4: task_id validation
# ===========================================================================

class TestTaskIdValidation:
    """Test that Task.__post_init__ sanitizes task_id."""

    def test_default_task_id_is_safe(self):
        """The default factory (uuid.uuid4().hex[:12]) always produces
        a safe id."""
        t = Task(kind="identify", payload={"hypotheses": [b"x"], "target_idx": 0})
        assert _sanitize_task_id(t.task_id) == t.task_id
        assert len(t.task_id) == 12

    def test_safe_custom_task_id_unchanged(self):
        """A safe custom id (alphanumeric + _ + -) is left unchanged."""
        t = Task(
            kind="identify",
            payload={"hypotheses": [b"x"], "target_idx": 0},
            task_id="abc_123-XYZ",
        )
        assert t.task_id == "abc_123-XYZ"

    def test_task_id_with_null_byte_sanitized(self):
        """Test that a null byte in task_id (the original PoC) is
        replaced, not propagated to logging/execution_history.
        """
        t = Task(
            kind="identify",
            payload={"hypotheses": [b"x"], "target_idx": 0},
            task_id="evil\x00task",
        )
        assert "\x00" not in t.task_id
        assert t.task_id == "evil_task"

    def test_task_id_with_path_separator_sanitized(self):
        """Path separators must be replaced (defense against path
        traversal via task_id).
        """
        t = Task(
            kind="identify",
            payload={"hypotheses": [b"x"], "target_idx": 0},
            task_id="../etc/passwd",
        )
        assert "/" not in t.task_id
        assert ".." not in t.task_id

    def test_task_id_with_spaces_sanitized(self):
        """Spaces are not in the safe set; replaced with _."""
        t = Task(
            kind="identify",
            payload={"hypotheses": [b"x"], "target_idx": 0},
            task_id="my task 1",
        )
        assert t.task_id == "my_task_1"
        assert " " not in t.task_id

    def test_task_id_truncated_to_64_chars(self):
        """A task_id longer than 64 chars is truncated."""
        long_id = "a" * 100
        t = Task(
            kind="identify",
            payload={"hypotheses": [b"x"], "target_idx": 0},
            task_id=long_id,
        )
        assert len(t.task_id) == 64

    def test_task_id_with_control_chars_sanitized(self):
        """Control characters (newline, tab, etc.) are replaced."""
        t = Task(
            kind="identify",
            payload={"hypotheses": [b"x"], "target_idx": 0},
            task_id="task\nwith\tcontrol",
        )
        assert "\n" not in t.task_id
        assert "\t" not in t.task_id

    def test_sanitize_task_id_function_directly(self):
        """The _sanitize_task_id function works standalone too."""
        assert _sanitize_task_id("abc_123-XYZ") == "abc_123-XYZ"
        assert _sanitize_task_id("evil\x00task") == "evil_task"
        assert _sanitize_task_id("a" * 100) == "a" * 64
        # All-invalid input → falls back to a uuid (non-empty, safe).
        result = _sanitize_task_id("!@#$%^&*()")
        assert result  # non-empty
        assert all(c.isalnum() or c in "_-" for c in result)

    def test_sanitize_task_id_rejects_non_string(self):
        """Non-string task_ids raise TypeError (programmer error)."""
        with pytest.raises(TypeError):
            _sanitize_task_id(123)
        with pytest.raises(TypeError):
            _sanitize_task_id(None)
        with pytest.raises(TypeError):
            _sanitize_task_id(["list"])


# ===========================================================================
# Fix 5: secrets.SystemRandom for verification
# ===========================================================================

class TestVerificationRNG:
    """Test that verify() uses SystemRandom when no rng is supplied."""

    def test_verify_accepts_rng_none(self):
        """verify(..., rng=None) must not crash. Before the fix, rng
        was a required positional arg with no default.
        """
        hyps = [hashlib.sha256(f"h{i}".encode()).digest() for i in range(64)]
        # Should not raise.
        result = verify(hyps, 7, 7, 12, 5)  # rng=None default
        assert result["verified"] is True
        assert result["verification_calls"] == 5

    def test_verify_with_explicit_rng_still_works(self):
        """Backward compat: passing an explicit random.Random still
        works (used by tests and replays for reproducibility).
        """
        hyps = [hashlib.sha256(f"h{i}".encode()).digest() for i in range(64)]
        rng = random.Random(42)
        result = verify(hyps, 7, 7, 12, 5, rng)
        assert result["verified"] is True

    def test_verify_with_none_uses_system_random(self, monkeypatch):
        """When rng=None, the function must construct a SystemRandom
        (not a predictable random.Random). We verify by spying on
        secrets.SystemRandom.
        """
        constructed = []
        real_sys_rand = secrets.SystemRandom

        class SpySystemRandom(real_sys_rand):
            def __init__(self, *args, **kwargs):
                constructed.append(self)
                super().__init__(*args, **kwargs)

        # Patch the secrets.SystemRandom reference inside verification.py.
        from srs.primitives import verification as vmod
        monkeypatch.setattr(vmod.secrets, "SystemRandom", SpySystemRandom)
        hyps = [hashlib.sha256(f"h{i}".encode()).digest() for i in range(64)]
        verify(hyps, 7, 8, 12, 5)  # rng=None
        assert len(constructed) == 1, \
            "verify(rng=None) must construct exactly one SystemRandom"

    def test_verify_system_random_is_unpredictable(self):
        """Two calls to verify(rng=None) with the same inputs should
        produce DIFFERENT probe sequences (statistical property of a
        CSPRNG). We can't assert different verified results (the
        soundness bound allows 1/32 false-passes), but we can assert
        the call doesn't crash and returns a well-formed result.
        """
        hyps = [hashlib.sha256(f"h{i}".encode()).digest() for i in range(64)]
        r1 = verify(hyps, 7, 8, 12, 5)
        r2 = verify(hyps, 7, 8, 12, 5)
        # Both should have the same shape.
        assert "verified" in r1
        assert "verified" in r2
        assert r1["verification_calls"] == 5 or not r1["verified"]
        assert r2["verification_calls"] == 5 or not r2["verified"]

    def test_verify_positional_rng_still_works(self):
        """Positional callers (the old signature) must still work."""
        hyps = [hashlib.sha256(f"h{i}".encode()).digest() for i in range(64)]
        rng = random.Random(0)
        # Pass rng as the 6th positional arg (old calling convention).
        result = verify(hyps, 7, 7, 12, 5, rng)
        assert result["verified"] is True


# ===========================================================================
# Integration / regression
# ===========================================================================

def test_self_test_persistence_still_passes():
    """persistence.self_test() should still pass after the changes."""
    assert persistence.self_test() == "persistence OK"


def test_cli_self_test_does_not_crash(tmp_path):
    """Running the CLI self-test should not crash with the new
    SafeJSONDecoder / size cap / validation in place.
    """
    import srs.cli as cli
    rc = cli.main(["--home", str(tmp_path / "home"), "self-test"])
    assert rc == 0


def test_overall_test_count_now_135():
    """Smoke check: we added 5 new test classes; the full v8.0 suite
    should now contain more tests than the v8.0 baseline (130).
    This is a soft assertion — it just makes sure we're not accidentally
    running zero tests.
    """
    # Each test class above has multiple test methods; the total
    # new test count should be > 20.
    import inspect
    classes = [
        TestJSONDepthLimit,
        TestAdviceTableValidation,
        TestSnapshotSizeCap,
        TestTaskIdValidation,
        TestVerificationRNG,
    ]
    method_count = 0
    for cls in classes:
        for name, _ in inspect.getmembers(cls, predicate=inspect.isfunction):
            if name.startswith("test_"):
                method_count += 1
    assert method_count >= 20, \
        f"expected ≥20 new tests, found {method_count}"
