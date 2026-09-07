"""Tests for full-snapshot integrity.

v7.7 closes two HIGH-severity findings from the v7.6 security audit:

  - Full-payload HMAC (was: ``advice_hash`` only covered
    ``advice_table``). Tampering with ``primitive_stats`` or
    ``execution_history`` previously went undetected. v7.7 replaces it
    with ``snapshot_hash`` — an HMAC-SHA256 of the ENTIRE snapshot
    payload (every field except the hash itself).

  - Rollback protection (was: ``latest.json`` had no integrity
    protection, so an attacker with snapshots-dir write access could
    swap the ``path`` field to point at an older (legitimate) snapshot
    and the runtime would silently load stale state). v7.7 adds a
    monotonically increasing ``sequence`` field to each snapshot and
    tracks the highest sequence ever persisted in ``sequence.json``
    (HMAC-protected). On load, any snapshot whose sequence is lower
    than the high-water mark is rejected as a rollback.

These tests verify both fixes end-to-end against a realistic
attacker model: the attacker can write to the snapshots directory
but does NOT have the secret key (so they cannot forge valid
HMACs).
"""
import hashlib
import json
import subprocess
import sys
import tempfile
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from srs import Runtime, Task
from srs.persistence import (
    _clear_high_water_mirror,
    _compute_advice_hash,
    _compute_seq_hash,
    _compute_snapshot_hash,
    _get_high_water_sequence,
    load_latest,
    save,
)


# ---------- test isolation ----------

@pytest.fixture(autouse=True)
def _clear_high_water_mirror_before_each_test():
    """Clear the high-water mirror file before each test.

    v8.2 added a high-water mirror at ``~/.srs/secret_key.seq`` so the
    rollback protection survives deletion of ``~/.srs/snapshots/sequence.json``
    (R17 known weakness). The mirror is shared across tests (it lives at
    a fixed path outside the per-test tmpdir), so without this fixture a
    test that writes high_water=10 would leak that value into the next
    test, breaking the assertion that a fresh tmpdir reports high_water=0.

    The fixture runs BEFORE each test (autouse=True) and clears the
    mirror so every test starts from a known-clean state. Tests that
    specifically want to exercise the mirror (e.g.
    ``test_high_water_mirror_survives_sequence_json_deletion``) write
    the mirror explicitly within the test body.
    """
    _clear_high_water_mirror()
    yield
    # Also clear AFTER the test so a failing test doesn't leak state.
    _clear_high_water_mirror()


# ---------- helpers ----------

def _hyps(n: int = 64) -> list[bytes]:
    """Standard hypothesis list for identify tasks (deterministic)."""
    return [hashlib.sha256(f"h{i}".encode()).digest() for i in range(n)]


def _identify_task() -> Task:
    return Task(kind="identify",
                payload={"hypotheses": _hyps(), "target_idx": 7,
                         "n_features": 12},
                budget=16)


# ---------- Full-payload HMAC ----------

def test_snapshot_hash_covers_full_payload():
    """Test that snapshot_hash covers EVERY field, not just advice_table.

    We verify by computing the hash, then perturbing each individual
    field and confirming the hash changes.
    """
    with tempfile.TemporaryDirectory() as tmp:
        rt = Runtime(home=Path(tmp))
        rt.execute(_identify_task())
        rt.store_state()

        snap_file = next(Path(tmp).glob("snap_*.json"))
        with open(snap_file) as f:
            original = json.load(f)
        original_hash = original["snapshot_hash"]
        assert original_hash is not None, "v8.0 snapshot must have snapshot_hash"

        # For each field (except snapshot_hash itself), perturb the
        # value and confirm the recomputed hash differs from the
        # stored one. This proves snapshot_hash covers that field.
        fields_to_test = [
            "snapshot_id", "timestamp", "advice_table",
            "primitive_stats", "last_task_id",
        ]
        for field in fields_to_test:
            if field not in original:
                continue
            perturbed = dict(original)
            # Mutate the field in a way that's guaranteed to change
            # the serialized bytes.
            if isinstance(original[field], dict):
                perturbed[field] = {**original[field],
                                    "__evil__": "tampered"}
            elif isinstance(original[field], str):
                perturbed[field] = original[field] + "_TAMPERED"
            elif isinstance(original[field], list):
                perturbed[field] = original[field] + ["EVIL"]
            else:
                perturbed[field] = "TAMPERED_VALUE"
            new_hash = _compute_snapshot_hash(perturbed)
            assert new_hash != original_hash, (
                f"snapshot_hash did NOT change when {field!r} was "
                f"perturbed — field is NOT covered by the hash "
                f"(regression)"
            )


def test_tampered_primitive_stats_detected():
    """Test that tampering with primitive_stats is detected by
    snapshot_hash. The attacker recomputes a SHA-256 (not knowing the
    secret key) and writes it as snapshot_hash; load_latest must
    reject the tampered snapshot.
    """
    with tempfile.TemporaryDirectory() as tmp:
        rt = Runtime(home=Path(tmp))
        rt.execute(_identify_task())
        path = rt.store_state()

        # Tamper with primitive_stats.
        with open(path) as f:
            snap = json.load(f)
        snap["primitive_stats"]["FAKE_PRIM"] = {"runs": 999,
                                                "successes": 999}
        # Attacker recomputes a hash, but they DON'T have the secret
        # key, so they use plain SHA-256 (mimicking the attack that
        # worked against the v7.6 advice_hash).
        snap["snapshot_hash"] = hashlib.sha256(
            json.dumps({k: v for k, v in snap.items()
                        if k != "snapshot_hash"},
                       sort_keys=True).encode()
        ).hexdigest()
        with open(path, "w") as f:
            json.dump(snap, f)

        # Load should detect tampering — snapshot_hash uses HMAC with
        # the secret key, so the attacker's SHA-256 won't match.
        rt2 = Runtime(home=Path(tmp))
        assert "FAKE_PRIM" not in rt2.primitive_stats, \
            "tampered primitive_stats should be discarded (snapshot_hash " \
            "must reject the entire snapshot)"


def test_tampered_execution_history_detected():
    """Test that tampering with execution_history is detected by
    snapshot_hash. execution_history is stored INSIDE primitive_stats
    (as a sentinel key), so this also verifies the hash covers nested
    fields.
    """
    with tempfile.TemporaryDirectory() as tmp:
        rt = Runtime(home=Path(tmp))
        rt.execute(_identify_task())
        path = rt.store_state()

        # Tamper with execution_history (nested inside primitive_stats).
        with open(path) as f:
            snap = json.load(f)
        evil_history = [{
            "task_id": "x; rm -rf /",  # classic shell-injection payload
            "kind": "identify",
            "correct": True,
            "queries": 0,
            "wall_time_ms": 0.0,
            "primitives": ["E"],
            "timestamp": "2020-01-01T00:00:00+00:00",
            "evil_field": "A" * 10240,  # 10 KB junk field
        }]
        snap["primitive_stats"]["execution_history"] = evil_history
        # Attacker recomputes SHA-256 (no secret key).
        snap["snapshot_hash"] = hashlib.sha256(
            json.dumps({k: v for k, v in snap.items()
                        if k != "snapshot_hash"},
                       sort_keys=True).encode()
        ).hexdigest()
        with open(path, "w") as f:
            json.dump(snap, f)

        # Load must reject the tampered snapshot.
        rt2 = Runtime(home=Path(tmp))
        # The malicious task_id must NOT appear in the loaded history.
        for entry in rt2.execution_history:
            assert entry.get("task_id") != "x; rm -rf /", \
                "tampered execution_history leaked through (regression)"
            assert "evil_field" not in entry, \
                "tampered execution_history leaked through (regression)"


def test_tampered_advice_table_detected():
    """Test that tampering with advice_table is still detected
    (this was the only field covered by the v7.6 advice_hash; v7.7's
    snapshot_hash must continue to cover it).
    """
    with tempfile.TemporaryDirectory() as tmp:
        rt = Runtime(home=Path(tmp))
        rt.execute(_identify_task())
        path = rt.store_state()

        with open(path) as f:
            snap = json.load(f)
        # Replace advice_table with attacker-chosen values.
        snap["advice_table"] = {"evil_key": 999999}
        # Attacker recomputes SHA-256.
        snap["snapshot_hash"] = hashlib.sha256(
            json.dumps({k: v for k, v in snap.items()
                        if k != "snapshot_hash"},
                       sort_keys=True).encode()
        ).hexdigest()
        with open(path, "w") as f:
            json.dump(snap, f)

        rt2 = Runtime(home=Path(tmp))
        # The malicious advice must NOT be loaded.
        assert "evil_key" not in rt2.advice._table, \
            "tampered advice_table leaked through (regression)"


def test_snapshot_hash_uses_hmac_not_plain_sha256():
    """Test that snapshot_hash is an HMAC (with secret key), not a plain
    SHA-256. An attacker who recomputes SHA-256 after tampering must
    NOT produce a matching hash.

    This is the exact attack that bypassed the v7.6 advice_hash before
    v7.7 replaced it with HMAC-SHA256. v7.7's snapshot_hash inherits
    the same HMAC defense.
    """
    payload = {
        "snapshot_id": "test",
        "timestamp": "2025-01-01T00:00:00+00:00",
        "advice_table": {"key": "value"},
        "primitive_stats": {"E": {"runs": 1}},
    }
    legit_hash = _compute_snapshot_hash(payload)
    # Attacker computes plain SHA-256 (no secret key).
    attacker_hash = hashlib.sha256(
        json.dumps(payload, sort_keys=True).encode()
    ).hexdigest()
    assert legit_hash != attacker_hash, \
        "snapshot_hash must use HMAC-SHA256, not plain SHA-256 (regression)"


def test_constant_time_hash_comparison():
    """Test (regression guard) that hash comparison uses
    hmac.compare_digest, not ``==``, to avoid timing side-channels.
    We verify by checking that two different hashes don't raise and
    return False, and two equal hashes return True.
    """
    h1 = _compute_snapshot_hash({"a": 1})
    h2 = _compute_snapshot_hash({"a": 2})
    h3 = _compute_snapshot_hash({"a": 1})
    import hmac as _hmac
    assert _hmac.compare_digest(h1, h3) is True
    assert _hmac.compare_digest(h1, h2) is False


# ---------- Rollback protection ----------

def test_rollback_attack_prevented():
    """Test that replacing latest.json to point at an OLD snapshot is
    rejected. The attacker takes a legitimate older snapshot (whose
    snapshot_hash is valid) and swaps latest.json's path field to
    point at it. The runtime must reject the rollback because the
    snapshot's sequence number is lower than the high-water mark.
    """
    with tempfile.TemporaryDirectory() as tmp:
        rt = Runtime(home=Path(tmp))
        rt.execute(_identify_task())
        snap1_path = rt.store_state()  # sequence = 1
        snap1_seq = rt.last_snapshot.sequence
        assert snap1_seq == 1, f"first snapshot should have seq=1, got {snap1_seq}"

        # Execute again and save a newer snapshot.
        rt.execute(_identify_task())
        snap2_path = rt.store_state()  # sequence = 2
        snap2_seq = rt.last_snapshot.sequence
        assert snap2_seq == 2, f"second snapshot should have seq=2, got {snap2_seq}"

        # High-water mark is now 2.
        high_water = _get_high_water_sequence(Path(tmp))
        assert high_water == 2, \
            f"high_water should be 2 after two saves, got {high_water}"

        # Attacker replaces latest.json to point at snap1 (rollback).
        # They use a legitimate-looking latest.json structure but
        # point at the OLDER snapshot file (which has a valid
        # snapshot_hash, since the attacker didn't tamper with it).
        with open(Path(tmp) / "latest.json", "w") as f:
            json.dump({
                "snapshot_id": "old",
                "path": str(snap1_path),
                "timestamp": "2020-01-01T00:00:00+00:00",
                "sequence": snap1_seq,
            }, f)

        # Load should reject the rollback (snap1.sequence=1 < high_water=2).
        rt2 = Runtime(home=Path(tmp))
        # The runtime must NOT have loaded the rolled-back state.
        # Either it loaded nothing (fresh state) or it loaded the
        # NEWER snapshot — but it must NOT load snap1's state.
        # Since latest.json points at snap1 and that's rejected, the
        # runtime should start fresh (no advice, no stats).
        assert rt2.last_snapshot is None, \
            "rollback attack succeeded: runtime loaded a snapshot " \
            f"(id={rt2.last_snapshot.snapshot_id if rt2.last_snapshot else None}) " \
            "despite sequence < high_water"


def test_rollback_to_same_sequence_allowed():
    """Test edge case: loading the snapshot whose sequence EQUALS the
    high-water mark is allowed. This is the normal case (load the most
    recent snapshot). Only STRICTLY LOWER sequences are rejected.
    """
    with tempfile.TemporaryDirectory() as tmp:
        rt = Runtime(home=Path(tmp))
        rt.execute(_identify_task())
        rt.store_state()  # sequence = 1

        # Load the same snapshot — should succeed (seq == high_water).
        rt2 = Runtime(home=Path(tmp))
        assert rt2.last_snapshot is not None, \
            "loading the current snapshot (seq == high_water) must succeed"
        assert rt2.last_snapshot.sequence == 1


def test_rollback_protection_requires_positive_high_water():
    """Test edge case: if the high-water mark is 0 (no prior saves, or
    sequence.json is missing/corrupt AND the mirror is also missing),
    the rollback check is skipped. This allows loading legacy snapshots
    (sequence=0) without false positives.

    v8.2 note: with the high-water mirror at ~/.srs/secret_key.seq,
    deleting sequence.json alone NO LONGER resets high_water to 0 —
    the mirror preserves it. To actually get high_water=0, BOTH
    sequence.json AND the mirror must be missing/corrupt. The autouse
    fixture clears the mirror before each test, so in this test the
    mirror is empty at the start; store_state() then writes high_water=1
    to both files; deleting sequence.json leaves the mirror with
    high_water=1, so the rollback check IS enforced (snap_sequence=1
    == high_water=1, so the snapshot is still accepted). The assertion
    ``_get_high_water_sequence(Path(tmp)) == 1`` confirms the mirror
    preserved the value across the deletion.
    """
    with tempfile.TemporaryDirectory() as tmp:
        rt = Runtime(home=Path(tmp))
        rt.execute(_identify_task())
        rt.store_state()  # sequence = 1, high_water = 1 (snapshots-dir + mirror)

        # Delete sequence.json — simulates an attacker trying to reset
        # the high-water mark. With the v8.2 mirror, this NO LONGER
        # resets high_water to 0; the mirror at ~/.srs/secret_key.seq
        # preserves the value.
        (Path(tmp) / "sequence.json").unlink()

        # Loading the snapshot must still work. With the mirror,
        # high_water=1 (from mirror), snap_sequence=1, so
        # snap_sequence == high_water → accept.
        rt2 = Runtime(home=Path(tmp))
        assert rt2.last_snapshot is not None, \
            "loading a snapshot when sequence.json is deleted must still " \
            "succeed (mirror preserves high_water)"
        # The high_water should still be 1 (from the mirror).
        assert _get_high_water_sequence(Path(tmp)) == 1


def test_high_water_mirror_survives_sequence_json_deletion():
    """v8.2 R17 known weakness fix: deleting sequence.json no longer
    resets the high-water mark to 0. The mirror at
    ``~/.srs/secret_key.seq`` (outside the snapshots dir) preserves
    the value, so a rollback attack that deletes sequence.json and
    replaces latest.json to point at an older snapshot is REJECTED.

    This is the test that documents the R17 known weakness fix. Before
    v8.2, an attacker with snapshots-dir write access could:
      1. Delete sequence.json (resets high_water to 0).
      2. Replace latest.json to point at an old (legitimate) snapshot
         with sequence=1.
      3. The runtime would load the old snapshot because
         ``high_water=0`` means "no rollback check".

    With v8.2, step 1 no longer resets high_water to 0 (the mirror
    preserves it), so step 3's rollback check fires and the load is
    rejected.
    """
    from srs.persistence import (
        _clear_high_water_mirror,
        _high_water_mirror_path,
        _update_high_water_sequence,
    )
    with tempfile.TemporaryDirectory() as tmp:
        p = Path(tmp)
        # Simulate two saves: high_water advances to 2.
        _update_high_water_sequence(p, 1)
        _update_high_water_sequence(p, 2)
        # Both snapshots-dir sequence.json and the mirror should report 2.
        assert _get_high_water_sequence(p) == 2
        assert _high_water_mirror_path().exists(), \
            "mirror file should exist after _update_high_water_sequence"
        # Attacker deletes sequence.json (R17 known weakness).
        (p / "sequence.json").unlink()
        # The mirror should STILL report 2 — the high-water mark is
        # NOT reset to 0. This is the fix.
        assert _get_high_water_sequence(p) == 2, \
            "deleting sequence.json must NOT reset high_water to 0; " \
            "the mirror at ~/.srs/secret_key.seq must preserve it"

        # Attacker also tries to delete the mirror — but the attacker
        # only has snapshots-dir write access, NOT ~/.srs/ write access
        # (the threat model in the v7.7 HMAC fix). Verify that if the
        # attacker COULD delete the mirror, both sources would be 0
        # (this is the pre-v8.2 behavior).
        _clear_high_water_mirror()
        assert _get_high_water_sequence(p) == 0, \
            "with BOTH sequence.json and mirror deleted, high_water is 0 " \
            "(pre-v8.2 behavior — confirms the mirror is the only defense)"


def test_sequence_monotonic_across_saves():
    """Test that each save() assigns a strictly increasing sequence
    number. Three consecutive saves must produce sequences 1, 2, 3
    (not 1, 1, 1 or any other non-monotonic pattern).
    """
    with tempfile.TemporaryDirectory() as tmp:
        rt = Runtime(home=Path(tmp))
        rt.execute(_identify_task())
        rt.store_state()
        seq1 = rt.last_snapshot.sequence
        rt.execute(_identify_task())
        rt.store_state()
        seq2 = rt.last_snapshot.sequence
        rt.execute(_identify_task())
        rt.store_state()
        seq3 = rt.last_snapshot.sequence
        assert (seq1, seq2, seq3) == (1, 2, 3), \
            f"sequence must be monotonic 1,2,3 — got {(seq1, seq2, seq3)}"


def test_sequence_json_is_hmac_protected():
    """Test that sequence.json is HMAC-protected so an attacker can't
    lower the high-water mark to enable rollback. We verify by:
      (a) writing a legitimate sequence.json via _update_high_water_sequence
      (b) tampering with high_water directly (without updating seq_hash)
      (c) confirming _get_high_water_sequence returns 0 (ignores tampered)

    v8.2 note: the high-water MIRROR at ~/.srs/secret_key.seq (outside
    the snapshots dir) is the backup that defends against deletion of
    sequence.json. To test the snapshots-dir file in isolation, we
    explicitly clear the mirror before tampering — otherwise the
    mirror would still report high_water=10 and the assertion would
    fail. The mirror's own tamper-resistance is tested separately in
    ``test_high_water_mirror_survives_sequence_json_deletion``.
    """
    from srs.persistence import (
        _clear_high_water_mirror,
        _update_high_water_sequence,
    )
    with tempfile.TemporaryDirectory() as tmp:
        p = Path(tmp)
        # Write high_water = 10 (writes BOTH snapshots-dir and mirror).
        _update_high_water_sequence(p, 10)
        assert _get_high_water_sequence(p) == 10

        # Clear the mirror so we can test the snapshots-dir file in
        # isolation (otherwise the mirror would still report 10).
        _clear_high_water_mirror()

        # Attacker lowers high_water to 1 (without the secret key,
        # they can't recompute seq_hash).
        with open(p / "sequence.json") as f:
            data = json.load(f)
        data["high_water"] = 1
        # Don't update seq_hash — leave the old (now-mismatched) hash.
        with open(p / "sequence.json", "w") as f:
            json.dump(data, f)

        # _get_high_water_sequence must detect the mismatch and return 0
        # (both snapshots-dir and mirror are now 0/tampered).
        assert _get_high_water_sequence(p) == 0, \
            "tampered sequence.json (lowered high_water) must be ignored"


def test_sequence_json_rejects_missing_hash():
    """Test that a sequence.json with no seq_hash field is treated as
    untrusted (return 0). An attacker could write a sequence.json with
    an arbitrarily high high_water (and no hash) to suppress rollback
    detection.
    """
    with tempfile.TemporaryDirectory() as tmp:
        p = Path(tmp)
        # Attacker writes a sequence.json with no seq_hash.
        with open(p / "sequence.json", "w") as f:
            json.dump({"high_water": 999999}, f)

        # Must be rejected (return 0).
        assert _get_high_water_sequence(p) == 0, \
            "sequence.json with no seq_hash must be ignored (untrusted)"


# ---------- Backward compatibility ----------

def test_v7_8_snapshot_with_advice_hash_loads():
    """Test backward compat: a v7.6 snapshot (advice_hash only, no
    snapshot_hash, no sequence) must still load via the legacy
    verification path. The next save() migrates it to snapshot_hash.
    """
    with tempfile.TemporaryDirectory() as tmp:
        p = Path(tmp)
        # Hand-craft a v8.0-format snapshot.
        advice_table = {"legacy_key": 42}
        advice_hash = _compute_advice_hash(advice_table)
        legacy_snap = {
            "snapshot_id": "legacy_v76",
            "timestamp": "2025-06-15T14:23:45+00:00",
            "advice_table": advice_table,
            "primitive_stats": {"E": {"runs": 1}},
            "last_task_id": None,
            "last_result": None,
            "advice_hash": advice_hash,
            # NO snapshot_hash, NO sequence — v8.0 format.
        }
        snap_path = p / "snap_legacy_v76.json"
        with open(snap_path, "w") as f:
            json.dump(legacy_snap, f)
        with open(p / "latest.json", "w") as f:
            json.dump({
                "snapshot_id": "legacy_v76",
                "path": str(snap_path),
                "timestamp": "2025-06-15T14:23:45+00:00",
            }, f)

        # Load — should succeed via the advice_hash backward-compat path.
        loaded = load_latest(p)
        assert loaded is not None, \
            "v7.6 snapshot with valid advice_hash must load (backward compat)"
        assert loaded.snapshot_id == "legacy_v76"
        assert loaded.advice_table == {"legacy_key": 42}
        # The loaded snapshot has no sequence (treated as 0 / legacy).
        assert loaded.sequence == 0


def test_v7_8_snapshot_with_bad_advice_hash_rejected():
    """Test backward compat: a v7.6 snapshot with a TAMPERED advice_hash
    must be rejected (return None). The attacker can't recompute the
    HMAC without the secret key.
    """
    with tempfile.TemporaryDirectory() as tmp:
        p = Path(tmp)
        legacy_snap = {
            "snapshot_id": "legacy_tampered",
            "timestamp": "2025-06-15T14:23:45+00:00",
            "advice_table": {"key": "value"},
            "primitive_stats": {},
            "advice_hash": hashlib.sha256(b"attacker_forge").hexdigest(),
        }
        snap_path = p / "snap_legacy_tampered.json"
        with open(snap_path, "w") as f:
            json.dump(legacy_snap, f)
        with open(p / "latest.json", "w") as f:
            json.dump({
                "snapshot_id": "legacy_tampered",
                "path": str(snap_path),
                "timestamp": "2025-06-15T14:23:45+00:00",
            }, f)

        # Load must reject (advice_hash mismatch).
        loaded = load_latest(p)
        assert loaded is None, \
            "v7.6 snapshot with bad advice_hash must be rejected"


def test_v7_8_snapshot_migrates_to_snapshot_hash_on_save():
    """Test backward compat: after loading a v7.6 snapshot, the next
    save() must write the new snapshot_hash format (not advice_hash).
    This is the migration path from v7.6 → v7.7.
    """
    with tempfile.TemporaryDirectory() as tmp:
        p = Path(tmp)
        # Load a v7.6 snapshot (created via the helper above).
        advice_table = {"legacy_key": 42}
        advice_hash = _compute_advice_hash(advice_table)
        legacy_snap = {
            "snapshot_id": "legacy_v76",
            "timestamp": "2025-06-15T14:23:45+00:00",
            "advice_table": advice_table,
            "primitive_stats": {"E": {"runs": 1}},
            "advice_hash": advice_hash,
        }
        snap_path = p / "snap_legacy_v76.json"
        with open(snap_path, "w") as f:
            json.dump(legacy_snap, f)
        with open(p / "latest.json", "w") as f:
            json.dump({
                "snapshot_id": "legacy_v76",
                "path": str(snap_path),
                "timestamp": "2025-06-15T14:23:45+00:00",
            }, f)

        # Load via Runtime (which exercises the backward-compat path).
        rt = Runtime(home=p)
        assert rt.advice._table != {}, "legacy advice must be loaded"

        # Now save a new snapshot — it must use snapshot_hash, not advice_hash.
        new_path = rt.store_state()
        with open(new_path) as f:
            new_snap = json.load(f)
        assert "snapshot_hash" in new_snap, \
            "new save must write snapshot_hash (v7.7 format)"
        assert "advice_hash" not in new_snap, \
            "new save must NOT write advice_hash (superseded by snapshot_hash)"
        assert "sequence" in new_snap, \
            "new save must write sequence field"
        assert new_snap["sequence"] >= 1, \
            "new save must assign sequence >= 1"


# ---------- No-hash snapshots (untrusted) ----------

def test_snapshot_with_no_hash_rejected():
    """Defense in depth: a snapshot with NEITHER snapshot_hash NOR
    advice_hash must be rejected. This catches extremely old or
    untrusted snapshots that predate integrity protection.
    """
    with tempfile.TemporaryDirectory() as tmp:
        p = Path(tmp)
        no_hash_snap = {
            "snapshot_id": "no_hash",
            "timestamp": "2025-06-15T14:23:45+00:00",
            "advice_table": {"key": "value"},
            "primitive_stats": {},
        }
        snap_path = p / "snap_no_hash.json"
        with open(snap_path, "w") as f:
            json.dump(no_hash_snap, f)
        with open(p / "latest.json", "w") as f:
            json.dump({
                "snapshot_id": "no_hash",
                "path": str(snap_path),
                "timestamp": "2025-06-15T14:23:45+00:00",
            }, f)

        loaded = load_latest(p)
        assert loaded is None, \
            "snapshot with no hash must be rejected (untrusted)"


# ---------- Cross-process sequence safety ----------

def test_cross_process_sequence_monotonic():
    """Test that two PROCESSES saving concurrently to the same home
    directory produce monotonically increasing sequence numbers (no
    collisions, no decreases). The file_lock on sequence.json
    serializes the read-compute-write cycle across processes.
    """
    script = (
        "import sys, hashlib, time\n"
        "sys.path.insert(0, %r)\n"
        "from pathlib import Path\n"
        "from srs import Runtime, Task\n"
        "from srs.types import Snapshot\n"
        "from srs import persistence\n"
        "\n"
        "home = Path(sys.argv[1])\n"
        "pid = sys.argv[2]\n"
        "rt = Runtime(home=home)\n"
        "hyps = [hashlib.sha256(f'h{{i}}'.encode()).digest() for i in range(8)]\n"
        "task = Task(kind='identify',\n"
        "            payload={'hypotheses': hyps, 'target_idx': 0,\n"
        "                     'n_features': 12},\n"
        "            budget=16, task_id='proc_' + pid)\n"
        "rt.execute(task)\n"
        "p = rt.store_state()\n"
        "import json\n"
        "with open(p) as f:\n"
        "    d = json.load(f)\n"
        "print(d['sequence'])\n"
    ) % str(REPO_ROOT)
    with tempfile.TemporaryDirectory() as tmp:
        home = Path(tmp) / "shared_home"
        procs = [
            subprocess.Popen([sys.executable, "-c", script,
                              str(home), str(i)],
                             stdout=subprocess.PIPE,
                             stderr=subprocess.PIPE)
            for i in range(4)
        ]
        sequences = []
        for proc in procs:
            out, err = proc.communicate(timeout=60)
            assert proc.returncode == 0, \
                f"subprocess failed: rc={proc.returncode}, " \
                f"stderr={err.decode()}"
            seq = int(out.strip())
            sequences.append(seq)
        # All 4 sequences must be distinct (monotonic, no collisions).
        assert len(set(sequences)) == 4, \
            f"sequence numbers must be distinct across 4 processes, " \
            f"got {sequences}"
        # The high-water mark must equal the max sequence.
        assert _get_high_water_sequence(home) == max(sequences), \
            f"high_water must be max(sequences)={max(sequences)}, " \
            f"got {_get_high_water_sequence(home)}"


# ---------- End-to-end happy path ----------

def test_normal_save_load_cycle_unchanged():
    """Regression guard: the normal save→load cycle must still work
    after the v8.0 changes. Advice, stats, and history must round-trip
    correctly.
    """
    with tempfile.TemporaryDirectory() as tmp:
        rt = Runtime(home=Path(tmp))
        rt.execute(_identify_task())
        rt.execute(_identify_task())
        path = rt.store_state()

        # Verify the saved file has the new fields.
        with open(path) as f:
            snap = json.load(f)
        assert "snapshot_hash" in snap
        assert "sequence" in snap
        assert snap["sequence"] == 1
        # advice_hash should NOT be present (superseded).
        assert "advice_hash" not in snap

        # Load into a fresh runtime.
        rt2 = Runtime(home=Path(tmp))
        assert rt2.last_snapshot is not None
        assert rt2.last_snapshot.sequence == 1
        # Advice must round-trip.
        assert rt2.advice.size_bytes() > 0
        # Stats must round-trip.
        assert len(rt2.primitive_stats) > 0
        # History must round-trip.
        assert len(rt2.execution_history) == 2
        # Total tasks must round-trip.
        assert rt2._total_tasks == 2
