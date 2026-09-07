"""Tests for reproducibility — same inputs should give same outputs (F9).

v8.0 Reproducibility Fixer (Agent F9).

These tests verify the four pillars of reproducibility for the SRS
Runtime:
  1. Same task_id + same hypotheses → same queries, same answer, same
     primitives_used (deterministic RNG seeding via sha256(task_id)).
  2. Same state → byte-identical snapshot content (minus the inherently
     time-based snapshot_id and timestamp fields).
  3. Same CLI command → same stdout output (minus wall_time_ms and
     task_id which are non-deterministic).
  4. _deterministic_seed(task_id) returns the same value across
     separate Python processes (cross-process determinism).

The tests run the same operation twice in separate processes /
instances and assert byte-identical (or JSON-equal modulo known
non-deterministic fields) results. They are the regression gate for
any future change that could introduce non-determinism (e.g. using
Python's hash() on strings, dict iteration order assumptions, RNG
seeding from time/pid/uuid).
"""
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from srs import Runtime, Task
from srs.runtime import _deterministic_seed


# ---------- Fix 1: same task → same result ----------

def test_same_task_gives_same_result():
    """Same task_id + same hypotheses → same queries, same answer,
    same primitives_used.

    The runtime derives its RNG seed from sha256(task_id), so two
    Tasks with the same task_id produce bit-identical RNG sequences.
    Combined with a deterministic pipeline (no time/random/os.urandom
    in the stages), the queries, the answer, and the primitives_used
    list must all match exactly.

    NOTE: we use TWO separate Runtime instances (in separate home
    directories) because the runtime self-improves after a successful
    execute() — the first run seeds the advice table, so a second run
    of the SAME task in the SAME runtime hits advice and returns 0
    queries (which is correct behavior, but it's a different test of
    advice short-circuiting, not of RNG-seed reproducibility). Using
    fresh runtimes isolates the RNG-seed reproducibility check from
    the advice-carryover effect.
    """
    hyps = [hashlib.sha256(f"h{i}".encode()).digest() for i in range(64)]
    task1 = Task(kind="identify",
                 payload={"hypotheses": hyps, "target_idx": 7,
                          "n_features": 12},
                 budget=16)
    task2 = Task(kind="identify",
                 payload={"hypotheses": hyps, "target_idx": 7,
                          "n_features": 12},
                 budget=16)
    # Force the same task_id so the RNG seed matches. (Without this
    # the two Tasks get distinct uuid4-based task_ids, so their RNG
    # seeds differ — by design, so concurrent runs of "the same"
    # task don't produce colliding query sequences.)
    task2.task_id = task1.task_id

    # Two fresh home dirs so neither runtime has advice for these hyps.
    with tempfile.TemporaryDirectory() as tmp1:
        with tempfile.TemporaryDirectory() as tmp2:
            rt1 = Runtime(home=Path(tmp1))
            rt2 = Runtime(home=Path(tmp2))
            r1 = rt1.execute(task1)
            r2 = rt2.execute(task2)
            assert r1.queries == r2.queries, (
                f"queries differ: {r1.queries} vs {r2.queries} "
                f"(RNG seed should be identical for same task_id)"
            )
            assert r1.answer == r2.answer, (
                f"answer differs: {r1.answer!r} vs {r2.answer!r}"
            )
            assert r1.primitives_used == r2.primitives_used, (
                f"primitives_used differs: {r1.primitives_used} vs "
                f"{r2.primitives_used}"
            )


def test_same_task_same_runtime_uses_advice_on_second_run():
    """Companion to test_same_task_gives_same_result: in the SAME
    Runtime, the second execution of an identical identify task hits
    the advice table that the first run seeded. This is NOT a
    violation of reproducibility — it's the runtime's documented
    self-improvement behavior. We test it here so the contrast with
    test_same_task_gives_same_result is explicit: the first run makes
    real queries (deterministic), the second run makes 0 queries
    (advice hit, also deterministic).
    """
    with tempfile.TemporaryDirectory() as tmp:
        rt = Runtime(home=Path(tmp))
        hyps = [hashlib.sha256(f"h{i}".encode()).digest() for i in range(64)]
        task1 = Task(kind="identify",
                     payload={"hypotheses": hyps, "target_idx": 7,
                              "n_features": 12},
                     budget=16)
        task2 = Task(kind="identify",
                     payload={"hypotheses": hyps, "target_idx": 7,
                              "n_features": 12},
                     budget=16)
        task2.task_id = task1.task_id
        r1 = rt.execute(task1)
        r2 = rt.execute(task2)
        # First run makes real queries (>=1); second run hits advice (0).
        assert r1.queries > 0, (
            f"first run should make real queries, got {r1.queries}"
        )
        assert r2.queries == 0, (
            f"second run should hit advice (0 queries), got {r2.queries}"
        )
        # Both should still agree on the answer.
        assert r1.answer == r2.answer == 7


def test_same_task_gives_same_result_across_processes():
    """Same task → same result ACROSS separate Python processes.

    This is the stronger form of test_same_task_gives_same_result:
    it spawns a fresh subprocess, builds the same Task, executes it,
    and asserts the queries / answer / primitives_used match what
    the parent process produced. Catches non-determinism that could
    creep in from PYTHONHASHSEED, pid-based seeds, or anything else
    that varies per-process.
    """
    hyps_src = "[hashlib.sha256(f'h{i}'.encode()).digest() for i in range(64)]"
    script = (
        "import sys, hashlib, json\n"
        "sys.path.insert(0, '.')\n"
        "from pathlib import Path\n"
        "import tempfile\n"
        "from srs import Runtime, Task\n"
        f"hyps = {hyps_src}\n"
        "task = Task(kind='identify', "
        "payload={'hypotheses': hyps, 'target_idx': 7, 'n_features': 12}, "
        "budget=16)\n"
        # Pin the task_id so the subprocess's seed matches the parent's.
        f"task.task_id = 'fixed_task_id_for_repro'\n"
        "rt = Runtime(home=Path(tempfile.mkdtemp()))\n"
        "r = rt.execute(task)\n"
        "print(json.dumps({'queries': r.queries, 'answer': r.answer, "
        "'primitives_used': r.primitives_used}))\n"
    )

    # Run the script in a fresh subprocess.
    r_sub = subprocess.run(
        [sys.executable, "-c", script],
        capture_output=True, text=True, cwd=str(REPO_ROOT),
    )
    assert r_sub.returncode == 0, (
        f"subprocess failed: {r_sub.stderr}"
    )
    sub_result = json.loads(r_sub.stdout.strip())

    # Compute the same result in the parent process for comparison.
    hyps = [hashlib.sha256(f"h{i}".encode()).digest() for i in range(64)]
    task = Task(kind="identify",
                payload={"hypotheses": hyps, "target_idx": 7,
                         "n_features": 12},
                budget=16)
    task.task_id = "fixed_task_id_for_repro"
    with tempfile.TemporaryDirectory() as tmp:
        rt = Runtime(home=Path(tmp))
        r_parent = rt.execute(task)

    assert r_parent.queries == sub_result["queries"], (
        f"queries differ across processes: parent={r_parent.queries} "
        f"subprocess={sub_result['queries']}"
    )
    assert r_parent.answer == sub_result["answer"], (
        f"answer differs across processes: parent={r_parent.answer!r} "
        f"subprocess={sub_result['answer']!r}"
    )
    assert r_parent.primitives_used == sub_result["primitives_used"], (
        f"primitives_used differs across processes: "
        f"parent={r_parent.primitives_used} "
        f"subprocess={sub_result['primitives_used']}"
    )


# ---------- Fix 2: snapshot content determinism ----------

def test_snapshot_content_is_deterministic():
    """Same state → same snapshot content (minus snapshot_id, timestamp).

    Two store_state() calls on the same Runtime instance (with no
    intervening execute() or improve()) must produce snapshots whose
    JSON content is identical after stripping the inherently
    time-based snapshot_id and timestamp fields.

    v8.0 update: also strip ``sequence`` (monotonically increases per
    save) and ``snapshot_hash`` (depends on sequence, so differs
    between the two snapshots). These are intentionally non-deterministic
    — sequence is the rollback-protection counter and snapshot_hash
    is the full-payload HMAC.
    """
    with tempfile.TemporaryDirectory() as tmp:
        rt = Runtime(home=Path(tmp))
        hyps = [hashlib.sha256(f"h{i}".encode()).digest() for i in range(64)]
        task = Task(kind="identify",
                    payload={"hypotheses": hyps, "target_idx": 7,
                             "n_features": 12},
                    budget=16)
        rt.execute(task)

        path1 = rt.store_state()
        with open(path1, "rb") as f:
            snap1 = f.read()

        path2 = rt.store_state()
        with open(path2, "rb") as f:
            snap2 = f.read()

        data1 = json.loads(snap1)
        data2 = json.loads(snap2)

        # Strip non-deterministic fields:
        #   - snapshot_id is sha256(time.time()) — varies per call.
        #   - timestamp is time.time() — varies per call.
        #   - sequence is high_water+1 — increments per save (v8.0).
        #   - snapshot_hash covers sequence, so it differs too (v8.0).
        for d in (data1, data2):
            d.pop("snapshot_id", None)
            d.pop("timestamp", None)
            d.pop("sequence", None)
            d.pop("snapshot_hash", None)

        assert data1 == data2, (
            f"snapshots differ after stripping snapshot_id/timestamp/"
            f"sequence/snapshot_hash:\n"
            f"data1={json.dumps(data1, indent=2, sort_keys=True)}\n"
            f"data2={json.dumps(data2, indent=2, sort_keys=True)}"
        )


def test_snapshot_bytes_are_deterministic_modulo_id_and_timestamp():
    """Byte-identical snapshots (modulo snapshot_id / timestamp).

    This is the strict form of test_snapshot_content_is_deterministic:
    it asserts that the on-disk JSON bytes match exactly after we
    replace the two time-based fields with placeholders. This catches
    dict-key ordering drift (which sort_keys=True in
    _atomic_write_json prevents) AND list-ordering drift in
    execution_history (which the (timestamp, task_id) sort in
    store_state() prevents).

    v8.0 update: also normalize ``sequence`` (increments per save) and
    ``snapshot_hash`` (depends on sequence). These are intentionally
    non-deterministic — sequence is the rollback-protection counter
    and snapshot_hash is the full-payload HMAC.
    """
    with tempfile.TemporaryDirectory() as tmp:
        rt = Runtime(home=Path(tmp))
        hyps = [hashlib.sha256(f"h{i}".encode()).digest() for i in range(64)]
        task = Task(kind="identify",
                    payload={"hypotheses": hyps, "target_idx": 7,
                             "n_features": 12},
                    budget=16)
        rt.execute(task)

        path1 = rt.store_state()
        with open(path1, "rb") as f:
            snap1 = f.read()

        path2 = rt.store_state()
        with open(path2, "rb") as f:
            snap2 = f.read()

        # Normalize: replace non-deterministic fields with placeholders.
        def normalize(raw: bytes) -> bytes:
            d = json.loads(raw)
            d["snapshot_id"] = "<STRIPPED>"
            # v8.0: timestamp is now an ISO 8601 UTC string (was: epoch
            # float). Use a placeholder string instead of 0.0 so the JSON
            # serialization preserves the type, and strip timestamps inside
            # execution_history (each entry carries an ISO timestamp too).
            d["timestamp"] = "<STRIPPED>"
            # v8.0: sequence increments per save; snapshot_hash depends
            # on sequence. Both must be normalized away for the
            # deterministic-bytes comparison.
            d["sequence"] = -1
            d["snapshot_hash"] = "<STRIPPED>"
            stats = d.get("primitive_stats", {})
            if isinstance(stats, dict):
                hist = stats.get("execution_history", [])
                if isinstance(hist, list):
                    for entry in hist:
                        if isinstance(entry, dict) and "timestamp" in entry:
                            entry["timestamp"] = "<STRIPPED>"
            # Re-serialize with sort_keys=True so key order is canonical.
            return json.dumps(d, indent=2, sort_keys=True,
                              default=str).encode()

        n1 = normalize(snap1)
        n2 = normalize(snap2)
        assert n1 == n2, (
            f"snapshot bytes differ after normalization:\n"
            f"--- snap1\n{n1.decode()}\n"
            f"--- snap2\n{n2.decode()}"
        )


# ---------- Fix 3: CLI output determinism ----------

def test_cli_output_is_deterministic():
    """Same CLI command → same stdout (modulo wall_time_ms and task_id).

    Runs `srs --format json execute identify 64 --budget 16` twice in
    fresh home directories and asserts the JSON output is identical
    after stripping the non-deterministic fields (wall_time_ms, task_id,
    queries, storage_bytes, work_units — which depend on the RNG seeded
    by task_id, and task_id is uuid4-random per run).

    Note: queries/storage/work_units vary because task_id is random and
    seeds the RNG. The deterministic fields are: correct, verified,
    primitives_used, primary_axis, planned_cost, advice_hit.
    """
    cmd_template = [
        sys.executable, "srs/cli.py", "--home", "<TMP>",
        "--format", "json", "execute", "identify", "64",
        "--budget", "16",
    ]

    def run_once() -> dict:
        with tempfile.TemporaryDirectory() as tmp:
            cmd = [c if c != "<TMP>" else tmp for c in cmd_template]
            r = subprocess.run(
                cmd, capture_output=True, text=True, cwd=str(REPO_ROOT),
            )
            assert r.returncode == 0, (
                f"CLI failed: stderr={r.stderr}"
            )
            return json.loads(r.stdout)

    out1 = run_once()
    out2 = run_once()

    # Strip non-deterministic fields:
    #   - wall_time_ms: time.perf_counter() varies per run.
    #   - task_id: uuid4() generates a fresh id per Task.
    #   - queries, storage_bytes, work_units: depend on RNG seeded by task_id.
    #   - depth: depends on queries.
    #   - notes.resumed_from: only if resume=True.
    # The DETERMINISTIC fields are: correct, verified, primitives_used,
    # primary_axis, planned_cost, advice_hit.
    for d in (out1, out2):
        d.pop("wall_time_ms", None)
        d.pop("task_id", None)
        d.pop("queries", None)
        d.pop("storage_bytes", None)
        d.pop("work_units", None)
        d.pop("depth", None)
        notes = d.get("notes", {})
        notes.pop("resumed_from", None)

    assert out1 == out2, (
        f"CLI output differs after stripping wall_time_ms/task_id:\n"
        f"--- run1\n{json.dumps(out1, indent=2, sort_keys=True)}\n"
        f"--- run2\n{json.dumps(out2, indent=2, sort_keys=True)}"
    )


def test_cli_capabilities_output_is_deterministic():
    """Same `srs capabilities` command → same stdout (fresh home).

    On a fresh home directory, capabilities() returns a known-zero
    state (advice_entries=0, total_tasks=0, etc.). The only field
    that could vary across runs is last_snapshot_id (None on a fresh
    home) — which is also constant. So the entire output must be
    byte-identical.
    """
    def run_once() -> str:
        with tempfile.TemporaryDirectory() as tmp:
            r = subprocess.run(
                [sys.executable, "srs/cli.py", "--home", tmp,
                 "--format", "json", "capabilities"],
                capture_output=True, text=True, cwd=str(REPO_ROOT),
            )
            assert r.returncode == 0, f"CLI failed: {r.stderr}"
            return r.stdout

    out1 = run_once().strip()
    out2 = run_once().strip()
    assert out1 == out2, (
        f"CLI capabilities output differs across runs:\n"
        f"--- run1\n{out1}\n--- run2\n{out2}"
    )


# ---------- Fix 4: deterministic seed across processes ----------

def test_deterministic_seed_is_stable_within_process():
    """_deterministic_seed returns the same value on repeated calls
    within a single process."""
    a = _deterministic_seed("test_123")
    b = _deterministic_seed("test_123")
    c = _deterministic_seed("test_123")
    assert a == b == c, f"non-stable within process: {a}, {b}, {c}"


def test_deterministic_seed_across_processes():
    """_deterministic_seed should give the same result across processes.

    Spawns 3 fresh Python subprocesses and asserts they all return
    the same seed for the same task_id. This catches non-determinism
    from PYTHONHASHSEED (which salts Python's built-in hash() per
    process) — the v7.3 fix uses sha256 specifically to avoid this.
    """
    results = []
    for _ in range(3):
        r = subprocess.run(
            [sys.executable, "-c",
             "import sys; sys.path.insert(0, '.'); "
             "from srs.runtime import _deterministic_seed; "
             "print(_deterministic_seed('test_123'))"],
            capture_output=True, text=True, cwd=str(REPO_ROOT),
        )
        assert r.returncode == 0, f"subprocess failed: {r.stderr}"
        results.append(r.stdout.strip())
    assert len(set(results)) == 1, (
        f"non-deterministic seed across processes: {results}"
    )


def test_deterministic_seed_with_pythonhashseed_random():
    """_deterministic_seed must NOT depend on PYTHONHASHSEED.

    Sets PYTHONHASHSEED=random (which salts Python's built-in hash())
    and asserts the seed is still the same as with PYTHONHASHSEED=0.
    Catches any regression that replaces sha256 with hash().
    """
    # First, get the baseline with PYTHONHASHSEED=0.
    env_base = dict(os.environ, PYTHONHASHSEED="0")
    r_base = subprocess.run(
        [sys.executable, "-c",
         "import sys; sys.path.insert(0, '.'); "
         "from srs.runtime import _deterministic_seed; "
         "print(_deterministic_seed('hashseed_test_456'))"],
        capture_output=True, text=True, cwd=str(REPO_ROOT), env=env_base,
    )
    assert r_base.returncode == 0, r_base.stderr
    base = r_base.stdout.strip()

    # Now run with PYTHONHASHSEED=random (the default on most systems).
    env_rand = dict(os.environ, PYTHONHASHSEED="random")
    seeds = set()
    for _ in range(3):
        r_rand = subprocess.run(
            [sys.executable, "-c",
             "import sys; sys.path.insert(0, '.'); "
             "from srs.runtime import _deterministic_seed; "
             "print(_deterministic_seed('hashseed_test_456'))"],
            capture_output=True, text=True, cwd=str(REPO_ROOT),
            env=env_rand,
        )
        assert r_rand.returncode == 0, r_rand.stderr
        seeds.add(r_rand.stdout.strip())

    # All random-seed runs should agree with each other AND with the
    # fixed-seed baseline.
    assert len(seeds) == 1, (
        f"seed varies with PYTHONHASHSEED=random: {seeds}"
    )
    assert seeds.pop() == base, (
        f"seed differs between PYTHONHASHSEED=0 and random: "
        f"base={base}, random={seeds}"
    )


# ---------- Fix 5: end-to-end reproducibility ----------

def test_load_resave_preserves_content():
    """A snapshot loaded and re-saved should have identical content
    (modulo snapshot_id / timestamp).

    This catches drift introduced by the load/save round-trip itself
    (e.g. dict iteration order changes, missing fields, type coercions).

    v8.0 update: also strip ``sequence`` (monotonically increases per
    save) and ``snapshot_hash`` (depends on sequence). Both are
    intentionally non-deterministic across saves.
    """
    with tempfile.TemporaryDirectory() as tmp:
        # First runtime: execute a task and save.
        rt1 = Runtime(home=Path(tmp))
        hyps = [hashlib.sha256(f"h{i}".encode()).digest() for i in range(64)]
        task = Task(kind="identify",
                    payload={"hypotheses": hyps, "target_idx": 7,
                             "n_features": 12},
                    budget=16)
        rt1.execute(task)
        path1 = rt1.store_state()
        with open(path1, "rb") as f:
            snap1 = json.loads(f.read())

        # Second runtime: load and re-save (no execute in between).
        rt2 = Runtime(home=Path(tmp))
        rt2.recover()
        path2 = rt2.store_state()
        with open(path2, "rb") as f:
            snap2 = json.loads(f.read())

        # Strip time-based and v8.0 non-deterministic fields.
        for d in (snap1, snap2):
            d.pop("snapshot_id")
            d.pop("timestamp")
            d.pop("sequence", None)
            d.pop("snapshot_hash", None)

        assert snap1 == snap2, (
            f"load+resave drifted content:\n"
            f"--- snap1\n{json.dumps(snap1, indent=2, sort_keys=True)}\n"
            f"--- snap2\n{json.dumps(snap2, indent=2, sort_keys=True)}"
        )


def test_two_independent_runtimes_same_result():
    """Two independent Runtime instances (in separate home dirs)
    executing the same task with the same task_id produce identical
    results. This is the strongest end-to-end reproducibility check:
    no shared state, fresh RNGs, fresh advice tables — the only thing
    that matters is the task_id and the deterministic pipeline.
    """
    hyps = [hashlib.sha256(f"h{i}".encode()).digest() for i in range(64)]

    def run_in_fresh_home() -> dict:
        with tempfile.TemporaryDirectory() as tmp:
            rt = Runtime(home=Path(tmp))
            task = Task(kind="identify",
                        payload={"hypotheses": hyps, "target_idx": 7,
                                 "n_features": 12},
                        budget=16)
            task.task_id = "shared_task_id_for_repro_test"
            r = rt.execute(task)
            return {
                "queries": r.queries,
                "answer": r.answer,
                "correct": r.correct,
                "primitives_used": list(r.primitives_used),
                "storage_bytes": r.storage_bytes,
                "work_units": r.work_units,
                "depth": r.depth,
                "communication_bits": r.communication_bits,
                "verification_calls": r.verification_calls,
            }

    r1 = run_in_fresh_home()
    r2 = run_in_fresh_home()
    assert r1 == r2, (
        f"two independent runtimes produced different results:\n"
        f"r1={json.dumps(r1, indent=2, sort_keys=True)}\n"
        f"r2={json.dumps(r2, indent=2, sort_keys=True)}"
    )
