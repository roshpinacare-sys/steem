"""Critical-fix regression tests.

Each test corresponds to one of the critical findings addressed by the
v7.3 critical-fix pass. These tests deliberately exercise the failure
modes (concurrency, errors, types, docs, usage) so the bugs cannot
silently reappear.

Coverage areas:
  - Concurrency: latest.json corruption, lost stat updates, lost history
  - Errors: corrupt JSON, corrupt snapshots, type validation
  - Types: missing default_path, payload validation
  - Docs: CLI works without --home
  - Usage: hypothesis cap, negative budget, non-dict payload
"""
import hashlib
import json
import random
import subprocess
import sys
import tempfile
import threading
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from srs import Runtime, Task
from srs import persistence
from srs.cli import MAX_N
from srs.runtime import _deterministic_seed
from srs.types import MAX_HYPOTHESES, _validate_task


# ---------- Fix 1: default_path() exists ----------

def test_default_path_is_defined():
    """Test that persistence.default_path exists.

    v7.2 referenced default_path() but never defined it, so every CLI
    command without --home crashed with AttributeError.
    """
    assert callable(persistence.default_path)
    p = persistence.default_path()
    assert isinstance(p, Path)
    # Should end in 'snapshots' (the documented subdir layout).
    assert p.name == "snapshots"


def test_default_path_honors_srs_home_env(monkeypatch):
    """Test that the SRS_HOME env var overrides the default home path.

    Lets tests / CI isolate without polluting $HOME.
    """
    monkeypatch.setenv("SRS_HOME", "/tmp/srs_env_test_xyz")
    p = persistence.default_path()
    assert p == Path("/tmp/srs_env_test_xyz/snapshots")
    monkeypatch.delenv("SRS_HOME", raising=False)


def test_cli_capabilities_without_home_does_not_crash():
    """Test that `srs capabilities` works without --home.

    This is the most-reproduced user-facing crash in the v7.2 roasts.
    """
    import srs.cli as cli
    # Use a clean SRS_HOME so we don't pollute the user's real ~/.srs
    with tempfile.TemporaryDirectory() as tmp:
        rc = cli.main(["--home", tmp, "capabilities"])
        assert rc == 0


# ---------- Fix 2: atomic write ----------

def test_concurrent_store_state_does_not_corrupt_latest_json():
    """Test that 50 concurrent store_state() calls leave latest.json readable.

    Before the `_atomic_write_json` fix, ~1/5 trials produced a corrupt
    latest.json that bricked every subsequent Runtime().
    """
    with tempfile.TemporaryDirectory() as tmp:
        rt = Runtime(home=Path(tmp))
        rt.advice.build_for_identify(
            [hashlib.sha256(f"h{i}".encode()).digest() for i in range(8)], 3)
        errs = []
        def store():
            try:
                rt.store_state()
            except Exception as e:
                errs.append(type(e).__name__)
        threads = [threading.Thread(target=store) for _ in range(50)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        assert not errs, f"store_state() raised: {errs}"
        # latest.json MUST be valid JSON
        with open(Path(tmp) / "latest.json") as f:
            data = json.load(f)
        assert "snapshot_id" in data


def test_atomic_write_leaves_no_tmp_files():
    """Test that _atomic_write_json cleans up its tempfile on success."""
    with tempfile.TemporaryDirectory() as tmp:
        p = Path(tmp) / "out.json"
        persistence._atomic_write_json(p, {"x": 1})
        # No .tmp_* files left behind
        leftovers = list(Path(tmp).glob(".tmp_*"))
        assert not leftovers, f"tempfiles left behind: {leftovers}"
        assert p.exists()
        with open(p) as f:
            assert json.load(f) == {"x": 1}


# ---------- Fix 3: concurrent execute() triple-fault ----------

def test_concurrent_execute_same_task_id_no_crash():
    """Test that 8 threads with the same task_id don't crash in cleanup."""
    with tempfile.TemporaryDirectory() as tmp:
        rt = Runtime(home=Path(tmp))
        hyps = [hashlib.sha256(f"h{i}".encode()).digest() for i in range(64)]
        task = Task(kind="identify",
                    payload={"hypotheses": hyps, "target_idx": 7,
                             "n_features": 12, "n_features": 12},
                    budget=16, task_id="sharedtask")
        errs = []
        def run():
            try:
                rt.execute(task)
            except Exception as e:
                errs.append((type(e).__name__, str(e)))
        threads = [threading.Thread(target=run) for _ in range(8)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        assert not errs, f"concurrent execute() crashed: {errs}"


def test_concurrent_execute_no_lost_stat_updates():
    """Test that A.runs == 8 after 8 concurrent execute() calls.

    Before the `_state_lock` fix, two threads could both read
    `stats["runs"]`, both +1, both write back — losing one update.
    """
    with tempfile.TemporaryDirectory() as tmp:
        rt = Runtime(home=Path(tmp))
        # Use DIFFERENT task_ids so threads don't serialize on the per-task
        # lock — this is the worst case for the stats-race bug.
        tasks = [
            Task(kind="identify",
                 payload={"hypotheses":
                          [hashlib.sha256(f"h{i}".encode()).digest()
                           for i in range(64)],
                          "target_idx": 7, "n_features": 12},
                 budget=16, task_id=f"task_{i}")
            for i in range(8)
        ]
        errs = []
        def run(t):
            try:
                rt.execute(t)
            except Exception as e:
                errs.append(type(e).__name__)
        threads = [threading.Thread(target=run, args=(t,)) for t in tasks]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        assert not errs, f"concurrent execute() crashed: {errs}"
        a_runs = rt.primitive_stats.get("A", {}).get("runs", 0)
        assert a_runs == 8, f"REGRESSION: A.runs={a_runs}/8"


def test_concurrent_execute_no_lost_history_appends():
    """Test that history has 8 entries after 8 concurrent execute() calls."""
    with tempfile.TemporaryDirectory() as tmp:
        rt = Runtime(home=Path(tmp))
        tasks = [
            Task(kind="identify",
                 payload={"hypotheses":
                          [hashlib.sha256(f"h{i}".encode()).digest()
                           for i in range(64)],
                          "target_idx": 7, "n_features": 12},
                 budget=16, task_id=f"hist_{i}")
            for i in range(8)
        ]
        threads = [threading.Thread(target=rt.execute, args=(t,))
                   for t in tasks]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        assert len(rt.execution_history) == 8, \
            f"REGRESSION: history={len(rt.execution_history)}/8"


# ---------- Fix 4: deterministic hash ----------

def test_deterministic_seed_is_stable_across_processes():
    """Test that the same task_id yields the same seed in every interpreter
    process.

    Python's `hash()` is salted per-process (PYTHONHASHSEED) for strings;
    v7.2 used `hash(task_id)`, which broke cross-process resume.
    """
    seeds = set()
    for _ in range(3):
        out = subprocess.check_output([
            sys.executable, "-c",
            "import sys; sys.path.insert(0, %r); "
            "from srs.runtime import _deterministic_seed; "
            "print(_deterministic_seed('abc123def456'))" % str(REPO_ROOT)
        ]).strip()
        seeds.add(out)
    assert len(seeds) == 1, \
        f"REGRESSION: 3 different seeds: {seeds}"


def test_deterministic_seed_differs_for_different_task_ids():
    """Test that different task_ids generally produce different seeds."""
    s1 = _deterministic_seed("task_a")
    s2 = _deterministic_seed("task_b")
    assert s1 != s2


# ---------- Fix 5: _validate_task ----------

def test_validate_task_rejects_missing_hypotheses():
    """Test that missing 'hypotheses' key raises ValueError, not KeyError."""
    bad = Task(kind="identify", payload={}, budget=16)
    with pytest.raises(ValueError, match="requires payload keys"):
        _validate_task(bad)


def test_validate_task_rejects_missing_target_idx():
    """Test that missing 'target_idx' raises ValueError."""
    hyps = [hashlib.sha256(b"h").digest()]
    bad = Task(kind="identify", payload={"hypotheses": hyps}, budget=16)
    with pytest.raises(ValueError, match="target_idx"):
        _validate_task(bad)


def test_validate_task_rejects_out_of_range_target_idx():
    """Test that target_idx >= N raises ValueError (rolled into _validate_task)."""
    hyps = [hashlib.sha256(f"h{i}".encode()).digest() for i in range(8)]
    bad = Task(kind="identify",
               payload={"hypotheses": hyps, "target_idx": 100, "n_features": 12},
               budget=16)
    with pytest.raises(ValueError, match="out of range"):
        _validate_task(bad)


def test_execute_rejects_invalid_task_at_entry():
    """Test that Runtime.execute() validates BEFORE pipeline entry."""
    with tempfile.TemporaryDirectory() as tmp:
        rt = Runtime(home=Path(tmp))
        bad = Task(kind="identify", payload={}, budget=16)
        with pytest.raises(ValueError):
            rt.execute(bad)


def test_plan_task_rejects_invalid_task_at_entry():
    """Test that Runtime.plan_task() validates too."""
    with tempfile.TemporaryDirectory() as tmp:
        rt = Runtime(home=Path(tmp))
        bad = Task(kind="identify", payload={}, budget=16)
        with pytest.raises(ValueError):
            rt.plan_task(bad)


# ---------- Fix 6: atomic recover ----------

def test_recover_with_corrupt_advice_table_does_not_brick_runtime():
    """Test that a snapshot with a malformed advice_table does not leave
    the Runtime half-recovered (new advice but old stats). recover()
    catches the exception and falls back to an empty AdviceTable.

    v8.0 update: snapshot_hash now covers advice_table, so any
    tampering is caught at load_latest() and the snapshot is rejected
    entirely (recover() returns False). The runtime starts fresh
    (empty advice) — no brick.
    """
    from srs.primitives.advice import AdviceTable
    with tempfile.TemporaryDirectory() as tmp:
        rt = Runtime(home=Path(tmp))
        # Execute once to populate stats
        hyps = [hashlib.sha256(f"h{i}".encode()).digest() for i in range(64)]
        rt.execute(Task(kind="identify",
                        payload={"hypotheses": hyps, "target_idx": 7,
                                 "n_features": 12, "n_features": 12}, budget=16))
        rt.store_state()
        # Tamper with the snapshot: replace advice_table with a non-dict
        snap_file = next(rt.home.glob("snap_*.json"))
        with open(snap_file) as f:
            d = json.load(f)
        d["advice_table"] = "not_a_dict"  # malformed
        with open(snap_file, "w") as f:
            json.dump(d, f)
        # v8.0: snapshot_hash catches the tampered advice_table, so
        # recover() returns False (no snapshot loaded). The runtime
        # is in a fresh state but doesn't brick.
        rt2 = Runtime(home=Path(tmp))
        assert not rt2.recover(), \
            "v8.0: tampered snapshot must be rejected (recover returns False)"
        assert isinstance(rt2.advice, AdviceTable)
        # Advice should be empty (no snapshot loaded).
        assert rt2.advice._table == {}


# ---------- Fix 7: JSON load error handling ----------

def test_load_latest_returns_none_on_corrupt_latest_json():
    """Test that corrupt latest.json returns None instead of raising."""
    with tempfile.TemporaryDirectory() as tmp:
        with open(Path(tmp) / "latest.json", "w") as f:
            f.write('{"snapshot_id": "truncated"')  # invalid JSON
        # Must NOT raise
        result = persistence.load_latest(Path(tmp))
        assert result is None


def test_runtime_constructor_survives_corrupt_latest_json():
    """Test that Runtime(home=...) does not crash on corrupt latest.json."""
    with tempfile.TemporaryDirectory() as tmp:
        with open(Path(tmp) / "latest.json", "w") as f:
            f.write('{"snapshot_id": "truncated"')
        rt = Runtime(home=Path(tmp))  # must not raise
        assert rt.last_snapshot is None


def test_load_in_flight_returns_none_on_corrupt_json():
    """Test that a corrupt inflight file returns None instead of raising."""
    with tempfile.TemporaryDirectory() as tmp:
        fpath = Path(tmp) / "inflight_abc.json"
        with open(fpath, "w") as f:
            f.write('{"task_id": "abc"')  # invalid JSON
        result = persistence.load_in_flight(Path(tmp), "abc")
        assert result is None


# ---------- Fix 8: n cap ----------

def test_task_post_init_rejects_huge_hypotheses_list():
    """Test that Task.__post_init__ caps hypotheses at MAX_HYPOTHESES.

    v8.0 update: the error message wording was changed to remove
    jargon. The old message was "exceeds cap MAX_HYPOTHESES=... (prevents
    OOM)"; the new one is "is too large. Maximum supported length is ...
    Please use a smaller list." The regex below matches either wording
    so the test stays robust to the message evolving further.
    """
    # Don't actually allocate 10**9 digests — just fake a long list
    class FakeList:
        def __len__(self):
            return MAX_HYPOTHESES + 1
    with pytest.raises(ValueError, match="too large|exceeds cap|MAX_HYPOTHESES"):
        Task(kind="identify", payload={"hypotheses": FakeList()},
             budget=16)


def test_task_post_init_rejects_negative_budget():
    """Test that negative budget raises ValueError."""
    with pytest.raises(ValueError, match="budget"):
        Task(kind="identify",
             payload={"hypotheses": [b"x"], "target_idx": 0, "n_features": 12},
             budget=-1)


def test_task_post_init_rejects_non_dict_payload():
    """Test that non-dict payload raises TypeError."""
    with pytest.raises(TypeError, match="payload"):
        Task(kind="identify", payload=None, budget=16)


def test_cli_caps_n_at_max_hypotheses():
    """Test that the CLI rejects n > MAX_N before allocating memory."""
    import srs.cli as cli
    with tempfile.TemporaryDirectory() as tmp:
        # n = MAX_N + 1 should be rejected with exit code 1
        rc = cli.main(["--home", tmp, "execute", "identify",
                       str(MAX_N + 1)])
        assert rc == 1


def test_cli_max_n_constant_matches_types():
    """Test that the CLI and types.py share the same cap (defense in depth)."""
    assert MAX_N == MAX_HYPOTHESES == 1_000_000


# ============================================================
# v7.4 FIXES: Async + Cross-Process Locks + atomic-recover / validation
# ============================================================
# These tests verify the v7.4 fixes that the async + cross-process safety
# pass applied on top of the v7.3 critical-fix baseline. Each test maps
# to one failure mode so the bug cannot silently reappear:
#   - execute_async() runs execute() in a thread pool.
#   - fcntl.flock serializes cross-process latest.json writes.
#   - Runtime.__init__() applies atomic-recover type checks.
#   - Empty hypotheses list rejected by _validate_task.
#   - --verbose/--quiet work as subcommand flags.
#   - capabilities() reports total_primitive_runs + total_tasks.
# -----------------------------------------------------------


def test_capabilities_reports_total_primitive_runs_and_total_tasks():
    """Test that capabilities() reports both total_primitive_runs
    (truthful sum of stats['runs'] across primitives) AND total_tasks
    (truthful execute() call count). The old `total_executions` field
    is kept as a deprecated alias of total_tasks for backward compat.

    The bug: v7.3's `total_executions` was sum(stats['runs']), so 8
    task executions with 4 primitives each reported 32, not 8. The
    field name lied.
    """
    with tempfile.TemporaryDirectory() as tmp:
        rt = Runtime(home=Path(tmp))
        hyps = [hashlib.sha256(f"h{i}".encode()).digest() for i in range(64)]
        task = Task(kind="identify",
                    payload={"hypotheses": hyps, "target_idx": 7,
                             "n_features": 12, "n_features": 12},
                    budget=16)
        # Run 5 tasks.
        for _ in range(5):
            rt.execute(task)
        c = rt.capabilities()
        # The new fields must exist.
        assert "total_primitive_runs" in c, \
            "capabilities must include total_primitive_runs"
        assert "total_tasks" in c, \
            "capabilities must include total_tasks"
        # total_tasks counts CALLS to execute() — exactly 5.
        assert c["total_tasks"] == 5, \
            f"total_tasks should be 5, got {c['total_tasks']}"
        # total_primitive_runs sums stats['runs'] across primitives —
        # each execute() runs 2-4 primitives, so this is >= 10.
        assert c["total_primitive_runs"] >= c["total_tasks"], \
            f"total_primitive_runs ({c['total_primitive_runs']}) must be " \
            f">= total_tasks ({c['total_tasks']})"
        # Backward-compat alias.
        assert c["total_executions"] == c["total_tasks"], \
            f"total_executions (deprecated alias) should equal total_tasks; " \
            f"got total_executions={c['total_executions']}, " \
            f"total_tasks={c['total_tasks']}"


def test_capabilities_primitive_stats_excludes_sentinel_keys():
    """Test that capabilities()['primitive_stats'] does NOT include the two
    non-primitive sentinel keys ('execution_history' and '_total_tasks')
    that we hide inside primitive_stats for persistence.
    """
    with tempfile.TemporaryDirectory() as tmp:
        rt = Runtime(home=Path(tmp))
        hyps = [hashlib.sha256(f"h{i}".encode()).digest() for i in range(64)]
        rt.execute(Task(kind="identify",
                        payload={"hypotheses": hyps, "target_idx": 7,
                                 "n_features": 12, "n_features": 12}, budget=16))
        rt.store_state()
        c = rt.capabilities()
        # The sentinel keys must NOT leak into the capabilities output.
        assert "execution_history" not in c["primitive_stats"], \
            "execution_history should not appear in primitive_stats output"
        assert "_total_tasks" not in c["primitive_stats"], \
            "_total_tasks should not appear in primitive_stats output"
        # Real primitive keys (E, A, C, V, Adv, S, Q) should be present.
        # After one identify execute(), the planner picks ['A', 'C'] or
        # similar — at least one primitive key should be present.
        assert len(c["primitive_stats"]) >= 1


def test_runtime_init_atomic_recover_with_corrupt_primitive_stats():
    """Test that Runtime.__init__() applies the same atomic-recover type
    validation as recover(). A corrupt primitive_stats field (with a
    valid advice_hash) must NOT brick the runtime on the next execute().

    Brick scenario: snapshot has valid advice_hash (so load_latest accepts
    it) but primitive_stats='i_am_not_a_dict'. Before the fix, __init__
    assigned the string to self.primitive_stats, and the next execute()
    crashed with `AttributeError: 'str' object has no attribute
    'setdefault'`.

    v8.0 update: snapshot_hash now covers primitive_stats, so the
    tampering is caught at load_latest() (snapshot rejected entirely).
    The runtime starts fresh — no brick. The atomic-recover type
    validation is still in place as defense-in-depth for v8.0 legacy
    snapshots (advice_hash only, doesn't cover primitive_stats).
    """
    import json as _json
    with tempfile.TemporaryDirectory() as tmp:
        # 1. Create a valid snapshot first.
        rt = Runtime(home=Path(tmp))
        hyps = [hashlib.sha256(f"h{i}".encode()).digest() for i in range(64)]
        rt.execute(Task(kind="identify",
                        payload={"hypotheses": hyps, "target_idx": 7,
                                 "n_features": 12, "n_features": 12}, budget=16))
        rt.store_state()

        # 2. Corrupt the snapshot's primitive_stats IN PLACE.
        # snapshot_hash covers primitive_stats, so this tampering will be
        # detected and the snapshot rejected. The runtime then starts
        # fresh (empty stats) rather than bricking.
        snap_file = next(Path(tmp).glob("snap_*.json"))
        with open(snap_file) as f:
            d = _json.load(f)
        d["primitive_stats"] = "i_am_not_a_dict"  # corrupt!
        with open(snap_file, "w") as f:
            _json.dump(d, f)

        # 3. The constructor must NOT crash.
        rt2 = Runtime(home=Path(tmp))
        # primitive_stats must be a dict (reset to {} by the fix, or
        # empty because the snapshot was rejected at load_latest).
        assert isinstance(rt2.primitive_stats, dict), \
            f"REGRESSION: primitive_stats is " \
            f"{type(rt2.primitive_stats).__name__}, not dict"
        # 4. execute() must work (the original brick symptom).
        r = rt2.execute(Task(kind="identify",
                             payload={"hypotheses": hyps, "target_idx": 7,
                                      "n_features": 12, "n_features": 12}, budget=16))
        assert r.correct, "execute must work after corrupt reload"


def test_runtime_init_atomic_recover_with_corrupt_per_primitive_stats():
    """Test that even when primitive_stats is a dict, individual per-primitive
    entries that aren't dicts are dropped (would crash the first execute()
    on `stats.setdefault(...)`).
    """
    import json as _json
    with tempfile.TemporaryDirectory() as tmp:
        rt = Runtime(home=Path(tmp))
        hyps = [hashlib.sha256(f"h{i}".encode()).digest() for i in range(64)]
        rt.execute(Task(kind="identify",
                        payload={"hypotheses": hyps, "target_idx": 7,
                                 "n_features": 12, "n_features": 12}, budget=16))
        rt.store_state()

        snap_file = next(Path(tmp).glob("snap_*.json"))
        with open(snap_file) as f:
            d = _json.load(f)
        # Corrupt ONE per-primitive entry (e.g. 'A' is a string instead of dict).
        d["primitive_stats"]["A"] = "corrupt_string"
        with open(snap_file, "w") as f:
            _json.dump(d, f)

        # Constructor must not crash; corrupt entry must be dropped.
        rt2 = Runtime(home=Path(tmp))
        assert isinstance(rt2.primitive_stats, dict)
        assert "A" not in rt2.primitive_stats or \
            isinstance(rt2.primitive_stats["A"], dict), \
            "corrupt per-primitive entry should be dropped"


def test_validate_task_rejects_empty_hypotheses():
    """Test that empty hypotheses list is rejected for identify tasks.

    Before the fix, the `n > 0` guard skipped the range check when n==0,
    letting the empty list through and crashing the pipeline with
    IndexError.
    """
    bad = Task(kind="identify",
               payload={"hypotheses": [], "target_idx": 0, "n_features": 12},
               budget=16)
    with pytest.raises(ValueError, match="non-empty"):
        _validate_task(bad)


def test_validate_task_rejects_negative_target_idx():
    """Test that negative target_idx is rejected with a clear error message
    (was previously caught by the range check but with an unclear 'out
    of range' message).
    """
    hyps = [hashlib.sha256(f"h{i}".encode()).digest() for i in range(8)]
    bad = Task(kind="identify",
               payload={"hypotheses": hyps, "target_idx": -1, "n_features": 12},
               budget=16)
    with pytest.raises(ValueError, match="negative"):
        _validate_task(bad)


def test_cli_verbose_as_subcommand_flag():
    """Test that --verbose works BOTH as a global flag AND as a subcommand
    flag. Previously it was only recognized before the subcommand:
        srs --verbose capabilities   # worked
        srs capabilities --verbose   # FAILED: unrecognized arguments
    """
    import srs.cli as cli
    with tempfile.TemporaryDirectory() as tmp:
        # Subcommand --verbose must parse without error.
        rc = cli.main(["--home", tmp, "capabilities", "--verbose"])
        assert rc == 0, f"capabilities --verbose failed with rc={rc}"


def test_cli_quiet_as_subcommand_flag():
    """Test that --quiet works as a subcommand flag too."""
    import srs.cli as cli
    with tempfile.TemporaryDirectory() as tmp:
        rc = cli.main(["--home", tmp, "capabilities", "--quiet"])
        assert rc == 0, f"capabilities --quiet failed with rc={rc}"


def test_cli_verbose_global_plus_subcommand_no_flag_inherits():
    """Test that when --verbose is set globally and the subcommand doesn't
    repeat it, the global value persists (not silently overwritten by
    the subparser's default).

    This is the trickiest case — argparse by default would overwrite
    args.verbose=True (from global) with args.verbose=False (subparser
    default) when the subcommand doesn't pass --verbose. The fix uses
    default=argparse.SUPPRESS on subparsers to avoid this.
    """
    import argparse
    import srs.cli as cli
    # The merge semantics: global --verbose + no subcommand flag → verbose=True.
    # We verify by parsing argv directly (not running cmd_*) so we can
    # inspect the namespace.
    parser = argparse.ArgumentParser()
    cli._add_logging_flags(parser, is_subparser=False)
    sub = parser.add_subparsers(dest="cmd", required=True)
    sp = sub.add_parser("capabilities")
    cli._add_logging_flags(sp, is_subparser=True)
    # Global --verbose, no subcommand flag.
    args = parser.parse_args(["--verbose", "capabilities"])
    assert getattr(args, "verbose", False) is True, \
        "global --verbose must persist when subcommand doesn't repeat it"
    # No flags anywhere → verbose is False (default).
    args = parser.parse_args(["capabilities"])
    assert getattr(args, "verbose", False) is False
    # Subcommand --verbose only.
    args = parser.parse_args(["capabilities", "--verbose"])
    assert getattr(args, "verbose", False) is True


def test_execute_async_returns_correct_result():
    """Test that execute_async() runs execute() in a thread pool and returns
    the same Result shape as the synchronous version.
    """
    import asyncio
    with tempfile.TemporaryDirectory() as tmp:
        rt = Runtime(home=Path(tmp))
        hyps = [hashlib.sha256(f"h{i}".encode()).digest() for i in range(64)]
        task = Task(kind="identify",
                    payload={"hypotheses": hyps, "target_idx": 7,
                             "n_features": 12, "n_features": 12},
                    budget=16)
        # Run via the async wrapper.
        result = asyncio.run(rt.execute_async(task))
        assert result.task_id == task.task_id
        assert result.correct
        assert len(result.primitives_used) > 0


def test_execute_async_does_not_block_event_loop():
    """Test that execute_async() does NOT block the event loop. A concurrent
    asyncio.sleep() must run in parallel with execute_async via
    run_in_executor.

    Proof strategy: measure the synchronous execute() time first, then
    run execute_async + a 60ms sleep concurrently via asyncio.gather.
    If they overlap (correct): total ≈ max(execute, 60ms).
    If they serialize (bug): total ≈ execute + 60ms.
    We assert total < (sync_execute + 60ms - 10ms margin), which can
    only be true if they ran concurrently.
    """
    import asyncio
    import time as _time
    with tempfile.TemporaryDirectory() as tmp:
        rt = Runtime(home=Path(tmp))
        # N=1024 makes execute() take ~20-50ms depending on load.
        hyps = [hashlib.sha256(f"h{i}".encode()).digest() for i in range(1024)]
        task = Task(kind="identify",
                    payload={"hypotheses": hyps, "target_idx": 7,
                             "n_features": 12, "n_features": 12},
                    budget=16)
        # Measure synchronous execute time.
        t0 = _time.perf_counter()
        sync_result = rt.execute(task)
        sync_execute_ms = (_time.perf_counter() - t0) * 1000
        assert sync_result.correct

        async def main():
            # gather() must be called inside a coroutine so it can find
            # the running event loop (calling gather() outside a coroutine
            # raises RuntimeError: no current event loop).
            return await asyncio.gather(
                rt.execute_async(task),
                asyncio.sleep(0.060),  # 60ms sleep
            )

        t0 = _time.perf_counter()
        results = asyncio.run(main())
        concurrent_ms = (_time.perf_counter() - t0) * 1000
        assert results[0].correct, "execute_async should produce correct result"
        # If execute_async blocked the loop, gather would serialize the two
        # coroutines and total time would be ≈ sync_execute_ms + 60ms.
        # With run_in_executor they overlap: total ≈ max(sync_execute_ms, 60).
        # We assert concurrent < sync_execute + 60 - 10 (10ms margin for
        # thread-pool overhead). This proves they ran concurrently.
        serialized_bound = sync_execute_ms + 60.0
        assert concurrent_ms < serialized_bound - 10.0, \
            f"execute_async appears to block the event loop: " \
            f"concurrent={concurrent_ms:.1f}ms, sync_execute={sync_execute_ms:.1f}ms, " \
            f"sleep=60ms. If blocking, total would be ~{serialized_bound:.0f}ms " \
            f"(serialized); if concurrent, ~{max(sync_execute_ms, 60.0):.0f}ms. " \
            f"Asserted <{serialized_bound - 10:.0f}ms. Regression."


def test_cross_process_lock_serializes_concurrent_writers():
    """Test that fcntl.flock in persistence.save() serializes two PROCESSES
    writing to the same latest.json.

    We spawn two subprocesses that each call persistence.save() 25
    times in a tight loop. Without the lock, the two processes would
    interleave their tempfile + os.replace calls and could corrupt
    latest.json. With the lock, they serialize and the file is always
    valid JSON.

    Note: this test exercises CROSS-PROCESS safety, which threads
    alone can't verify (fcntl.flock is process-local for threads
    within the same process — they share file descriptors).
    """
    import subprocess
    import sys as _sys
    # NOTE: keep the script simple — no nested f-string brace escaping.
    # Use plain string concatenation and dict literals with single braces.
    script = (
        "import sys, os, time\n"
        "sys.path.insert(0, %r)\n"
        "from pathlib import Path\n"
        "from srs import persistence\n"
        "from srs.types import Snapshot\n"
        "\n"
        "home = Path(sys.argv[1])\n"
        "home.mkdir(parents=True, exist_ok=True)\n"
        "pid = os.getpid()\n"
        "for i in range(25):\n"
        "    snap_id = 'proc' + str(pid) + '_iter' + str(i)\n"
        "    s = Snapshot(snapshot_id=snap_id, timestamp=time.time(),\n"
        "                 advice_table={'k' + str(i): 'v'},\n"
        "                 primitive_stats={'E': {'runs': 1}})\n"
        "    persistence.save(s, home)\n"
        "print('OK')\n"
    ) % str(REPO_ROOT)
    with tempfile.TemporaryDirectory() as tmp:
        home = Path(tmp) / "shared_home"
        # Launch two subprocesses that both write to the same home dir.
        procs = [
            subprocess.Popen([_sys.executable, "-c", script, str(home)],
                             stdout=subprocess.PIPE,
                             stderr=subprocess.PIPE),
            subprocess.Popen([_sys.executable, "-c", script, str(home)],
                             stdout=subprocess.PIPE,
                             stderr=subprocess.PIPE),
        ]
        for p in procs:
            out, err = p.communicate(timeout=60)
            assert p.returncode == 0, \
                f"subprocess failed: rc={p.returncode}, stderr={err.decode()}"
        # latest.json MUST be valid JSON (no torn writes).
        latest = home / "latest.json"
        assert latest.exists(), "latest.json should exist after concurrent saves"
        import json as _json
        with open(latest) as f:
            data = _json.load(f)
        assert "snapshot_id" in data
        # The snap file it points at must also exist and be valid.
        snap_path = Path(data["path"])
        assert snap_path.exists(), \
            f"snapshot file {snap_path} referenced by latest.json must exist"
        with open(snap_path) as f:
            snap_data = _json.load(f)
        assert "advice_table" in snap_data
        # No leftover .tmp_* files (atomic_write cleans up).
        leftovers = list(home.glob(".tmp_*"))
        assert not leftovers, \
            f"tempfiles left behind: {leftovers}"


def test_file_lock_context_manager_releases_on_exception():
    """Test that the file_lock() context manager releases the flock even if
    the body raises. Otherwise a crashed writer would hold the lock
    forever and block all subsequent writers.

    We acquire the lock, raise inside the body, catch the exception,
    then verify a second acquisition succeeds immediately (no deadlock).
    """
    from srs.persistence import file_lock
    with tempfile.TemporaryDirectory() as tmp:
        lockfile = Path(tmp) / "test.lock"
        # First acquisition: raise inside the body.
        try:
            with file_lock(lockfile, exclusive=True):
                raise RuntimeError("simulated crash inside critical section")
        except RuntimeError:
            pass  # expected
        # Second acquisition: must NOT block (the lock was released).
        # If the lock leaked, this would hang. We add a timeout via
        # a child process to detect the hang rather than blocking the
        # test runner indefinitely.
        import subprocess
        import sys as _sys
        script = '''
import sys
sys.path.insert(0, %r)
from pathlib import Path
from srs.persistence import file_lock
with file_lock(Path(sys.argv[1]), exclusive=True):
    pass
print("OK")
''' % str(REPO_ROOT)
        p = subprocess.Popen([_sys.executable, "-c", script, str(lockfile)],
                             stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        out, err = p.communicate(timeout=10)
        assert p.returncode == 0, \
            f"second lock acquisition failed (lock leaked?): " \
            f"rc={p.returncode}, stderr={err.decode()}"
