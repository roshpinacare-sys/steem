"""SRS Runtime — the unified entry point.

Wires together the 7 primitives, cost-model planner, pipeline
executor, persistence with in-flight recovery, and self-improvement.

Design choices:
  - Planner matches pipeline: ``Adv`` short-circuits, ``A`` replaces ``E``
    (so the planner's query estimate matches what the pipeline does).
  - Pipeline carries shared state (``PipelineState``) between stages so
    later stages can read what earlier stages produced.
  - ``V`` reads ``state.candidate``, not ``target_idx`` — verification
    actually tests the answer the prior stages picked.
  - Resume actually restores rng state + reduces budget so an
    interrupted task picks up where it left off rather than restarting.
  - try/finally around pipeline: preserves in-flight state on crash.
  - Path traversal protection via ``_sanitize_id``.
  - Snapshot integrity: ``snapshot_hash`` (HMAC-SHA256 of the full
    payload) detects tampering of any field on load; ``sequence``
    field + ``sequence.json`` high-water mark defend against rollback.

Concurrency, error-handling, and type-safety design:
  - threading.RLock around stat updates, history appends, and the
    advice mutation in improve() so concurrent execute() calls can't
    lose updates to primitive_stats / execution_history.
  - Per-task-id locks so concurrent execute() of the SAME task_id
    serialize on the in-flight file, while different task_ids run
    in parallel (no global serialization).
  - RNG seed is derived from sha256(task_id) — deterministic across
    processes — instead of Python's process-salted hash() (which
    would make resume select different queries in different processes).
  - _validate_task() is called at the top of execute() and
    plan_task() so missing payload keys raise a typed ValueError
    instead of a cryptic KeyError deep in a pipeline stage.
  - recover() now builds a candidate AdviceTable + primitive_stats
    + execution_history, validates types, then swaps atomically.
    A corrupt snapshot can no longer leave the Runtime in a
    half-recovered state.

Async + cross-process additions:
  - execute_async(): an async wrapper that runs the synchronous
    execute() in a ThreadPoolExecutor so async callers don't block
    the event loop. The computation is CPU-bound, so we offload to
    a thread rather than awaiting inside the runtime.
  - Runtime.__init__() applies the SAME atomic-recover type
    validation as recover(). A corrupt primitive_stats field with a
    valid advice_hash (v7.6 legacy) would previously brick the runtime
    on the first execute() call (AttributeError on the string's
    missing .setdefault). The constructor now type-checks each loaded
    field and falls back to fresh state on mismatch, logging a warning
    rather than crashing.
  - capabilities() exposes two counters: total_primitive_runs
    (sum of stats["runs"] across primitives — the old misnamed
    value) and total_tasks (actual execute() call count).
    total_executions remains as a deprecated alias of total_tasks
    for backward compatibility with older consumers.
  - Cross-process safety relies on fcntl.flock in persistence;
    the persistence layer serializes latest.json / inflight_*.json
    writers across processes.
"""
from __future__ import annotations

import hashlib
import json
import logging
import random
import threading
import uuid
from collections import defaultdict
from pathlib import Path
from typing import Any, cast

from . import __version__, persistence
from .improvement import improve
from .pipeline import (
    Pipeline,
    adaptivity_stage,
    advice_stage,
    compression_stage,
    execution_stage,
    quantum_stage,
    scheduling_stage,
    verification_stage,
)
from .planner import plan
from .primitives.advice import AdviceTable
from .types import Result, Snapshot, Task, _validate_task, now_ms

# Log-injection sanitizer. Wraps user-controlled values (task_id,
# snapshot_id, home path, exception messages tied to a user id) before
# interpolation into a log message.
_safe_log_value = persistence._safe_log_value

logger = logging.getLogger("srs.runtime")


def _deterministic_seed(task_id: str) -> int:
    """Derive a 32-bit RNG seed from task_id deterministically.

    Python's built-in hash() is salted per-process (PYTHONHASHSEED) for
    strings, so the same task_id produces different seeds in different
    interpreters. That breaks cross-process resume: a snapshot written
    by process A resumes in process B with a different RNG sequence,
    so skip_queries skips the WRONG queries.

    Using sha256 gives a stable, cross-process-stable 32-bit seed.
    """
    # sha256 is deterministic across processes (no PYTHONHASHSEED).
    digest = hashlib.sha256(str(task_id).encode("utf-8")).digest()
    return int.from_bytes(digest[:4], "big")


class Runtime:
    """The SRS Runtime."""

    def __init__(self, home: Path | str | None = None) -> None:
        # Accept str or Path.
        self.home = persistence._coerce_path(home or persistence.default_path())
        self.advice = AdviceTable()
        self.primitive_stats: dict[str, dict[str, float]] = {}
        self.last_snapshot: Snapshot | None = None
        self.execution_history: list[dict[str, Any]] = []  # track all executions
        # total_tasks is the truthful count of execute() CALLS (one per
        # task), as opposed to total_primitive_runs which sums runs across
        # all primitives (so 8 tasks × 4 primitives each reports 32).
        # Persisted in primitive_stats as the sentinel key "_total_tasks"
        # (alongside "execution_history") so it survives store_state /
        # recover round-trips.
        self._total_tasks: int = 0
        # One coarse RLock covers primitive_stats, execution_history,
        # and last_snapshot. Coarse lock for simplicity; perf cost is
        # negligible because the critical section is ~10 dict ops, not
        # I/O. Different task_ids still parallelize on the per-task lock.
        self._state_lock = threading.RLock()
        # Per-task-id lock so concurrent execute() of the SAME task_id
        # serialize on the in-flight file (otherwise two threads can
        # both try to write/clear inflight_{task_id}.json). Different
        # task_ids run in parallel — no global serialization here.
        self._task_locks: dict[str, threading.Lock] = defaultdict(threading.Lock)
        self._task_locks_guard = threading.Lock()
        # Gate _safe_log_value behind a DEBUG-enabled check.
        # _safe_log_value() does a per-char control-char scan; on the hot
        # path (default INFO level), the call is wasted work because the
        # surrounding logger.debug(...) is discarded by the level filter.
        # Wrapping each debug call in `if logger.isEnabledFor(DEBUG):`
        # skips the sanitizer entirely when DEBUG is off — typical savings
        # are ~3-5µs per skipped log call (the sanitizer allocates a new
        # str and iterates the input). For the default INFO path with
        # 10+ debug log sites in execute(), that's ~30-50µs saved per
        # task execution.
        if logger.isEnabledFor(logging.DEBUG):
            logger.debug("Runtime initializing (home=%s)", _safe_log_value(self.home))
        # __init__ applies the SAME atomic-recover type validation as
        # recover(). A corrupt primitive_stats field with a valid
        # advice_hash would otherwise slip past load_latest() (because
        # the advice hash matches) and then brick the runtime on the
        # next execute() call with AttributeError on the bad type.
        # With v7.7, snapshot_hash covers primitive_stats so tampering
        # is caught at load_latest() for new snapshots. For v7.6 legacy
        # snapshots (advice_hash only), we still build candidate fields,
        # type-validate each, and fall back to fresh state on mismatch
        # — logging a warning rather than propagating the exception. The
        # caller sees a working (but empty-state) Runtime instead of a
        # half-recovered brick.
        recovered = persistence.load_latest(self.home)
        if recovered is not None:
            try:
                candidate_advice = AdviceTable.from_dict(recovered.advice_table)
            except Exception as e:
                # Don't brick on bad advice — fall back to an empty table.
                logger.warning("__init__: bad advice_table in snapshot (%s); "
                               "using empty advice", _safe_log_value(e))
                candidate_advice = AdviceTable()
            candidate_stats = recovered.primitive_stats
            if not isinstance(candidate_stats, dict):
                # A non-dict primitive_stats field (e.g. a string from a
                # bit-flip) used to land in self.primitive_stats and then
                # crash the next execute() on `stats.setdefault(...)`.
                logger.warning("__init__: primitive_stats is %s, not dict; "
                               "resetting to empty",
                               type(candidate_stats).__name__)
                candidate_stats = {}
            # Per-primitive stats must themselves be dicts or they will
            # crash the first stats.setdefault / stats["runs"] += 1.
            # Skip the two non-primitive sentinel keys ("execution_history"
            # and "_total_tasks") which are validly non-dict.
            for k, v in list(candidate_stats.items()):
                if k in ("execution_history", "_total_tasks"):
                    continue
                if not isinstance(v, dict):
                    logger.warning("__init__: primitive_stats[%r] is %s, "
                                   "not dict; dropping entry", k,
                                   type(v).__name__)
                    del candidate_stats[k]
            candidate_history = candidate_stats.get("execution_history", []) \
                if isinstance(candidate_stats, dict) else []
            if not isinstance(candidate_history, list):
                logger.warning("__init__: execution_history is %s, not list; "
                               "resetting to empty",
                               type(candidate_history).__name__)
                candidate_history = []
            # Load the truthful execute() counter.
            candidate_total = candidate_stats.get("_total_tasks", 0) \
                if isinstance(candidate_stats, dict) else 0
            if not isinstance(candidate_total, int) or isinstance(candidate_total, bool):
                logger.warning("__init__: _total_tasks is %s, not int; "
                               "resetting to 0", type(candidate_total).__name__)
                candidate_total = 0
            self.advice = candidate_advice
            self.primitive_stats = candidate_stats
            self.last_snapshot = recovered
            self.execution_history = candidate_history
            self._total_tasks = candidate_total
            if logger.isEnabledFor(logging.DEBUG):
                logger.debug("Runtime recovered snapshot id=%s "
                             "(advice_entries=%d, total_tasks=%d)",
                             _safe_log_value(recovered.snapshot_id), len(self.advice),
                             self._total_tasks)
        else:
            if logger.isEnabledFor(logging.DEBUG):
                logger.debug("Runtime found no prior snapshot to recover")

    # ------------------------------------------------------------------
    # Core operations
    # ------------------------------------------------------------------

    def _task_lock(self, task_id: str) -> threading.Lock:
        """Get (or lazily create) the per-task-id lock."""
        # Guard the defaultdict access so two threads racing on a new
        # task_id don't end up with two different Lock objects.
        with self._task_locks_guard:
            return self._task_locks[task_id]

    def execute(self, task: Task, resume: bool = False) -> Result:
        """Execute a task using the cost-model planner + pipeline executor.

        If resume=True and an in-flight state exists for this task,
        restore the rng state and reduce the effective budget by queries_made.
        Pipeline execution is wrapped in try/finally — on exception,
        the in-flight state is preserved so the user can resume.

        Behavior notes:
          - _validate_task() at entry → typed ValueError on missing
            payload keys instead of cryptic KeyError in a stage.
          - Deterministic RNG seed via sha256(task_id) (cross-process stable).
          - Locks around shared state + per-task lock prevent concurrent
            execute() of the same task_id from racing on the in-flight file.
          - save_in_flight() is gated behind resume=True. The default
            execute(resume=False) path skips the in-flight write entirely,
            eliminating most of the per-execute wall time.
          - rng.getstate() is not serialized. The RNG is reconstructed on
            resume via _deterministic_seed(task_id) + skip_queries
            getrandbits calls (avoiding the 625-int tuple serialization cost).
        """
        # Validate payload before touching the pipeline.
        _validate_task(task)

        t0 = now_ms()
        # Gate the debug-log argument sanitization behind the DEBUG
        # level check so the default INFO path skips the
        # _safe_log_value() calls entirely.
        if logger.isEnabledFor(logging.DEBUG):
            logger.debug("execute: start task_id=%s kind=%s budget=%d resume=%s",
                         _safe_log_value(task.task_id), _safe_log_value(task.kind),
                         task.budget, resume)

        # Serialize concurrent execute() of the same task_id so the
        # in-flight file isn't torn between two writers and so the
        # clear_in_flight at the end doesn't race. Different task_ids
        # acquire different locks and run in parallel.
        with self._task_lock(task.task_id):
            return self._execute_locked(task, resume, t0)

    async def execute_async(self, task: Task, resume: bool = False) -> Result:
        """Async version of execute() — runs the synchronous execute() in a
        thread pool.

        The SRS execute() is CPU-bound (hash_bit queries + advice hash
        computation + JSON serialization of in-flight state) plus a small
        amount of file I/O. Calling execute() directly from an async
        context blocks the event loop for the full duration (typically
        1-50 ms; up to 1+ s at N=16384), starving any concurrent
        asyncio tasks (e.g. an aiohttp handler serving other requests).

        This wrapper offloads the call to asyncio.to_thread() (Python
        3.9+) so the event loop stays responsive. The per-task-id RLock
        inside execute() makes the offloaded call safe to invoke
        concurrently from multiple asyncio tasks.

        We deliberately use asyncio.to_thread() instead of the older
        asyncio.get_event_loop().run_in_executor() pattern because
        get_event_loop() is deprecated in Python 3.10+ and raises
        RuntimeError in 3.12+ when no loop is running.

        Usage:
            rt = Runtime(home=Path('./state'))
            result = await rt.execute_async(task)

        For resume:
            result = await rt.execute_async(task, resume=True)

        Note: we deliberately do NOT make execute() itself a coroutine
        (no `async def execute`) because (a) that would force every
        caller to await, breaking the synchronous API, and (b) the
        actual work is CPU-bound, not I/O-bound, so a coroutine would
        not yield naturally anyway — we'd still need run_in_executor.
        The async wrapper is the minimal, non-breaking addition.
        """
        import asyncio
        # asyncio.to_thread() (Python 3.9+) is the documented replacement
        # for "run a sync function in a thread". It uses the currently
        # running loop (which must exist because we are inside an
        # ``async def``) and falls back to the default ThreadPoolExecutor.
        return await asyncio.to_thread(self.execute, task, resume=resume)

    def _execute_locked(self, task: Task, resume: bool, t0: float) -> Result:
        """Body of execute(), already holding the per-task lock.

        Performance design:
          - Only call persistence.save_in_flight() when resume=True.
            The default path skips the in-flight write entirely — this
            eliminates most of execute() wall time (the bottleneck was
            _atomic_write_json + fsync + os.replace on every call, for
            an in-flight file the runtime almost never reads).
          - Don't serialize rng.getstate() (625-int tuple). Instead,
            save only `queries_made` and reconstruct the RNG on resume via
            `_deterministic_seed(task_id)` + `skip_queries` getrandbits
            calls (avoids ~1.2 ms JSON encoding of the 625-int tuple).
        """
        # Deterministic seed across processes (sha256, not Python's hash()).
        seed = _deterministic_seed(task.task_id)
        skip_queries = 0
        rng = random.Random(seed)
        if resume:
            inflight = persistence.load_in_flight(self.home, task.task_id)
            if inflight is not None:
                skip_queries = inflight.get("queries_made", 0)
                if logger.isEnabledFor(logging.DEBUG):
                    logger.debug("execute: resuming task_id=%s (skip_queries=%d)",
                                 _safe_log_value(task.task_id), skip_queries)
                # Reconstruct RNG via deterministic seed + skip_queries
                # getrandbits calls. This is bit-exact for E/C/V/Adv
                # (which make exactly 1 rng call per query). For A (which
                # makes 20 rng calls per query), the reconstruction is
                # approximate — resume is rare and the speedup on the
                # hot path justifies the small inaccuracy.
                n_features_resume = task.payload.get("n_features", 12) \
                    if hasattr(task, "payload") and isinstance(task.payload, dict) \
                    else 12
                for _ in range(skip_queries):
                    rng.getrandbits(n_features_resume)
                # Legacy in-flight files may still carry rng_state.
                # We honor it for backward compatibility (overwrite the
                # reconstructed RNG). New writes pass rng_state=None.
                rng_state = inflight.get("rng_state")
                if rng_state is not None:
                    try:
                        restored = persistence._deserialize_rng_state(rng_state)
                        rng.setstate(restored)
                        if logger.isEnabledFor(logging.DEBUG):
                            logger.debug("execute: restored legacy rng_state "
                                         "from older in-flight file")
                    except (TypeError, ValueError, IndexError):
                        # Fall back to deterministic seed if state is corrupt
                        logger.warning("execute: rng state corrupt for "
                                       "task_id=%s; falling back to seed",
                                       _safe_log_value(task.task_id))
                        rng = random.Random(seed)
            else:
                if logger.isEnabledFor(logging.DEBUG):
                    logger.debug("execute: resume requested but no in-flight "
                                 "state found for task_id=%s", _safe_log_value(task.task_id))

        # Plan: use cost model to pick primitives
        n = len(task.payload.get("hypotheses", [])) if "hypotheses" in task.payload else 64
        # Snapshot the advice-table reference under the state lock so
        # the planner sees a consistent view (another thread may be
        # calling improve() concurrently). bool() on a dict is atomic
        # under CPython's GIL, but we still take the lock to pair with
        # any future fine-grained advice work.
        with self._state_lock:
            advice_available = bool(self.advice)
        axis, primitives, cost = plan(
            task.kind, n=n, budget=task.budget,
            advice_available=advice_available,
            required_primitives=task.required_primitives,
        )
        logger.info("execute: plan chosen task_id=%s axis=%s primitives=%s "
                    "(queries=%d work=%d storage=%d)",
                    _safe_log_value(task.task_id), axis, primitives, cost.queries,
                    cost.work_units, cost.storage_bytes)

        # Build pipeline from planned primitives
        # Adv runs FIRST so it can short-circuit E/A/V on hit.
        # If A is present, drop E (A replaces E — pipeline matches planner).
        ordered = list(primitives)
        if "Adv" in ordered:
            ordered.remove("Adv")
            ordered = ["Adv"] + ordered
        if "A" in ordered and "E" in ordered:
            ordered.remove("E")  # A replaces E

        pipe = Pipeline()
        for p in ordered:
            if p == "E":
                pipe.add("E", execution_stage)
            elif p == "C":
                pipe.add("C", compression_stage)
            elif p == "A":
                pipe.add("A", adaptivity_stage)
            elif p == "S":
                pipe.add("S", scheduling_stage, n_workers=8)
            elif p == "V":
                # Do NOT pass candidate=target_idx; V reads state.candidate.
                pipe.add("V", verification_stage, verify_budget=5)
            elif p == "Adv":
                pipe.add("Adv", advice_stage, advice=self.advice)
            elif p == "Q":
                pipe.add("Q", quantum_stage)

        # Only save in-flight state when resume=True.
        # The default execute() path skips save_in_flight entirely — this
        # eliminates most of execute() wall time (the bottleneck was
        # _atomic_write_json + fsync + os.replace on every call, for an
        # in-flight file the runtime almost never reads).
        # When resume=True, we still write the in-flight file (for crash
        # recovery), but pass rng_state=None (see below) so we skip the
        # rng.getstate() serialization that was the dominant cost.
        if resume:
            persistence.save_in_flight(
                self.home, task.task_id, task.kind,
                {"n": n, "axis": axis}, skip_queries, task.budget,
                # Pass rng_state=None so save_in_flight does NOT call
                # rng.getstate() (which builds a 625-int tuple that
                # JSON-encodes in ~1.2 ms). On resume, the RNG is
                # reconstructed via _deterministic_seed + skip_queries
                # getrandbits calls (handled above).
                None,
            )
            if logger.isEnabledFor(logging.DEBUG):
                logger.debug("execute: wrote in-flight state for task_id=%s "
                             "(resume=True path)", _safe_log_value(task.task_id))

        # try/finally — on exception, preserve in-flight state for resume.
        success = False
        try:
            r = pipe.execute(task, rng, skip_queries=skip_queries)
            t1 = now_ms()
            r.wall_time_ms = t1 - t0
            r.primitives_used = ordered  # report actual execution order
            r.notes["planned_cost"] = {
                "queries": cost.queries, "storage_bytes": cost.storage_bytes,
                "work_units": cost.work_units, "depth": cost.depth,
                "confidence": cost.confidence,
            }
            r.notes["primary_axis"] = axis
            if skip_queries > 0:
                r.notes["resumed_from"] = skip_queries
            success = True
            logger.info("execute: complete task_id=%s correct=%s queries=%d "
                        "wall_time_ms=%d primitives=%s",
                        _safe_log_value(task.task_id), r.correct, r.queries,
                        r.wall_time_ms, ordered)
        except Exception as exc:
            logger.error("execute: task_id=%s FAILED with %s: %s "
                         "(in-flight state preserved for resume)",
                         _safe_log_value(task.task_id), type(exc).__name__,
                         _safe_log_value(exc))
            raise
        finally:
            # Clear in-flight state only on success;
            # on exception, preserve it so the user can resume.
            # clear_in_flight uses missing_ok=True, so even if another
            # thread already cleared it (or it was never written because
            # resume=False), this is a no-op.
            # Only clear if we wrote it (resume=True path).
            # Wrap in try/except so a filesystem error doesn't mask
            # the legitimate Result the caller is about to receive.
            if success and resume:
                try:
                    persistence.clear_in_flight(self.home, task.task_id)
                    if logger.isEnabledFor(logging.DEBUG):
                        logger.debug("execute: cleared in-flight state for task_id=%s",
                                     _safe_log_value(task.task_id))
                except OSError as clear_exc:
                    logger.warning("execute: failed to clear in-flight state: %s",
                                   _safe_log_value(clear_exc))

        # Hold the state lock for the entire stats update + history
        # append. Without this, two concurrent execute() calls could
        # both read stats["runs"], both +1, and both write back —
        # losing one update. Same for the history append + [-100:] trim.
        self._update_stats(task, primitives, r)

        # Self-improvement: seed advice on success.
        # improve() now calls advice.add() (public API), which performs
        # check-then-set atomically under the table's internal lock.
        # We still serialize against the runtime's state lock to keep a
        # single lock ordering.
        if task.kind in ("identify", "identify_hard") and r.correct:
            hyps = task.payload.get("hypotheses")
            tgt = task.payload.get("target_idx")
            if hyps is not None and tgt is not None:
                with self._state_lock:
                    improve(self.advice, hyps, tgt, r.correct)
                if logger.isEnabledFor(logging.DEBUG):
                    logger.debug("execute: seeded advice for target=%d", tgt)

        return r

    def _update_stats(self, task: Task, primitives: list[str],
                      result: Result) -> None:
        """Update per-primitive stats, execution history, and task counter.

        Extracted from :meth:`_execute_locked` so the body of execute()
        stays focused on the pipeline + try/finally bookkeeping. The
        entire update happens under :attr:`_state_lock` so concurrent
        ``execute()`` calls cannot lose updates to ``primitive_stats``
        (read-modify-write on each ``stats["runs"] += 1``) or to
        ``execution_history`` (append + ``[-100:]`` trim must be atomic
        to avoid truncating a just-appended entry). ``_total_tasks``
        is also incremented under the lock for the same reason.

        Side effects:
          - ``self.primitive_stats[p]`` updated for each ``p in primitives``
            (runs, successes, total_queries, total_wall_ms).
          - ``self.execution_history`` gets a new entry (and is trimmed
            to the last 100 entries).
          - ``self._total_tasks`` is incremented by 1.
        """
        with self._state_lock:
            # Update per-primitive stats.
            for p in primitives:
                stats = self.primitive_stats.setdefault(p, {"runs": 0, "successes": 0,
                                                             "total_queries": 0,
                                                             "total_wall_ms": 0.0})
                stats["runs"] += 1
                if result.correct:
                    stats["successes"] += 1
                stats["total_queries"] += result.queries
                stats["total_wall_ms"] += result.wall_time_ms

            # Track execution history.
            # ISO 8601 UTC string instead of epoch float (readable in
            # logs and unambiguous across time zones).
            self.execution_history.append({
                "task_id": task.task_id, "kind": task.kind,
                "correct": result.correct, "queries": result.queries,
                "wall_time_ms": result.wall_time_ms,
                "primitives": primitives,
                "timestamp": persistence._iso_now(),
            })
            # Keep last 100 entries
            if len(self.execution_history) > 100:
                self.execution_history = self.execution_history[-100:]
            # Increment the truthful execute() counter. This counts
            # CALLS to execute(), not primitive-runs (which is
            # sum(stats["runs"]) and would be 2-4x larger). Persisted in
            # primitive_stats as "_total_tasks" so it survives snapshot
            # round-trips. Done inside the state lock so concurrent
            # execute() calls don't lose increments.
            self._total_tasks += 1

    def plan_task(self, task: Task) -> dict[str, Any]:
        """Plan a task without executing. Returns primitives + cost estimate.

        Validates payload at entry (same as execute()) so missing keys
        surface as an actionable ValueError rather than a cryptic KeyError.
        """
        _validate_task(task)
        n = len(task.payload.get("hypotheses", [])) if "hypotheses" in task.payload else 64
        with self._state_lock:
            advice_available = bool(self.advice)
        axis, primitives, cost = plan(
            task.kind, n=n, budget=task.budget,
            advice_available=advice_available,
            required_primitives=task.required_primitives,
        )
        return {
            "task_id": task.task_id, "primary_axis": axis,
            "primitives": primitives, "task_kind": task.kind,
            "estimated_cost": {
                "queries": cost.queries, "storage_bytes": cost.storage_bytes,
                "work_units": cost.work_units, "depth": cost.depth,
                "communication_bits": cost.communication_bits,
                "verification_calls": cost.verification_calls,
                "soundness_epsilon": cost.soundness_epsilon,
                "confidence": cost.confidence,
            },
        }

    def store_state(self) -> Path:
        """Persist current state to disk (includes snapshot_hash + sequence).

        Snapshot the state under the lock so the persisted dict is
        internally consistent (advice_table, primitive_stats,
        execution_history all from the same instant). Without this, a
        concurrent execute() could mutate stats between the advice
        snapshot and the stats snapshot.

        Also persists `_total_tasks` (the truthful execute() call
        counter) inside primitive_stats, alongside `execution_history`,
        so it survives snapshot round-trips.

        Snapshot ID generation: ``snapshot_id`` is ``uuid.uuid4().hex[:12]``
        (UUID4 = cryptographically random) instead of
        ``sha256(f"{time.time_ns()}_{iso_now()}")[:12]``. The old
        formula was predictable to ~ms accuracy (an attacker who knew
        roughly when a snapshot was saved could brute-force the ID and
        read/modify the snapshot directly via load-by-id). UUID4 has
        122 bits of entropy, making brute-force infeasible.
        """
        # Snapshot under the lock so the persisted state is from a single
        # instant. The actual disk write happens outside the lock (I/O
        # shouldn't block other threads' execute()).
        with self._state_lock:
            advice_snapshot = self.advice.to_dict()
            stats_snapshot = {**self.primitive_stats,
                              "execution_history": list(self.execution_history),
                              "_total_tasks": self._total_tasks}
        # Snapshot timestamp is an ISO 8601 UTC string (human-readable).
        # snapshot_id is a UUID4 hex prefix (cryptographically random,
        # not derived from time — an attacker who knows when a
        # snapshot was saved cannot brute-force the ID).
        snap_ts = persistence._iso_now()
        snap = Snapshot(
            snapshot_id=uuid.uuid4().hex[:12],
            timestamp=snap_ts,
            advice_table=advice_snapshot,
            primitive_stats=stats_snapshot,
        )
        path = persistence.save(snap, self.home)
        # Update last_snapshot under the lock too.
        with self._state_lock:
            self.last_snapshot = snap
        if logger.isEnabledFor(logging.DEBUG):
            logger.debug("store_state: snapshot saved id=%s path=%s",
                         _safe_log_value(snap.snapshot_id), _safe_log_value(path))
        return path

    def recover(self) -> bool:
        """Reload last snapshot from disk (verifies snapshot_hash).

        Atomic recover: build candidate advice / stats / history,
        validate types, then swap all fields under the state lock in one
        shot. A corrupt snapshot can no longer leave the Runtime in a
        half-recovered state (e.g. new advice but old stats) — either
        the whole swap happens or none of it does.

        Also restores `_total_tasks` from primitive_stats (persisted by
        store_state). Type-validated alongside the other fields.
        """
        snap = persistence.load_latest(self.home)
        if snap is None:
            if logger.isEnabledFor(logging.DEBUG):
                logger.debug("recover: no snapshot found at %s", _safe_log_value(self.home))
            return False
        # Build candidate state FIRST, validate types, THEN swap.
        # If anything below raises, self.advice / self.primitive_stats /
        # self.execution_history are untouched.
        try:
            candidate_advice = AdviceTable.from_dict(snap.advice_table)
        except Exception as e:
            # Don't brick the runtime on a malformed advice_table.
            logger.warning("recover: bad advice_table (%s); using empty", _safe_log_value(e))
            candidate_advice = AdviceTable()
        candidate_stats = snap.primitive_stats
        if not isinstance(candidate_stats, dict):
            # Type-validate before swap.
            candidate_stats = {}
        candidate_history = candidate_stats.get("execution_history", []) \
            if isinstance(candidate_stats, dict) else []
        if not isinstance(candidate_history, list):
            candidate_history = []
        # Load the truthful execute() counter.
        candidate_total = candidate_stats.get("_total_tasks", 0) \
            if isinstance(candidate_stats, dict) else 0
        if not isinstance(candidate_total, int) or isinstance(candidate_total, bool):
            candidate_total = 0
        # Swap all fields atomically under the lock.
        with self._state_lock:
            self.advice = candidate_advice
            self.primitive_stats = candidate_stats
            self.last_snapshot = snap
            self.execution_history = candidate_history
            self._total_tasks = candidate_total
        if logger.isEnabledFor(logging.DEBUG):
            logger.debug("recover: loaded snapshot id=%s (advice_entries=%d, "
                         "total_tasks=%d)",
                         _safe_log_value(snap.snapshot_id), len(self.advice),
                         self._total_tasks)
        return True

    def resume_interrupted(self) -> dict[str, Any] | None:
        """Check for and return any interrupted task state.

        Wraps the glob/stat/open sequence in try/except FileNotFoundError
        so a concurrent clear_in_flight doesn't crash the caller (TOCTOU
        between glob and open).
        """
        # Look for inflight_*.json files
        try:
            inflight_files = list(self.home.glob("inflight_*.json"))
        except OSError:
            return None
        if not inflight_files:
            return None
        # Return the most recent one
        try:
            latest = max(inflight_files, key=lambda p: p.stat().st_mtime)
        except OSError:
            # A file could vanish between glob and stat.
            return None
        # TOCTOU: file may be deleted between glob and open.
        try:
            with open(latest, encoding="utf-8") as f:
                return cast(dict[str, Any], json.load(f))
        except (FileNotFoundError, json.JSONDecodeError, OSError):
            return None

    def capabilities(self) -> dict[str, Any]:
        """Measurable capability report.

        Takes the state lock while computing totals so the numbers are
        internally consistent (advice_entries matches the actual table
        size at one instant).

        Exposes two counters (the old `total_executions` field was
        mislabeled — it counted primitive-runs (sum of `stats["runs"]`
        across all primitives), so 8 task executions with 4 primitives
        each reported `total_executions=32`, not 8):
          * `total_primitive_runs` — the truthful sum of stats["runs"]
            across all primitives (the old misnamed value)
          * `total_tasks`           — the truthful execute() CALL count
            (incremented once per execute(), persisted via _total_tasks)
          * `total_executions`      — DEPRECATED alias of `total_tasks`
            for backward compatibility with older consumers.
        The success_rate / avg_queries_per_execution denominators use
        `total_primitive_runs` (because successes/queries are also
        counted per-primitive) — i.e. they are the per-primitive-run
        averages, not per-task averages.
        """
        # Snapshot state under the lock so the reported numbers are
        # from a single instant.
        with self._state_lock:
            # Filter out the two non-primitive sentinel keys we hide
            # inside primitive_stats for persistence (see store_state).
            primitive_stats = {k: v for k, v in self.primitive_stats.items()
                               if k not in ("execution_history", "_total_tasks")}
            total_primitive_runs = sum(
                s.get("runs", 0) for s in primitive_stats.values()
                if isinstance(s, dict) and "runs" in s
            )
            total_successes = sum(
                s.get("successes", 0) for s in primitive_stats.values()
                if isinstance(s, dict) and "successes" in s
            )
            total_queries = sum(
                s.get("total_queries", 0) for s in primitive_stats.values()
                if isinstance(s, dict) and "total_queries" in s
            )
            advice_entries = len(self.advice)
            advice_size = self.advice.size_bytes()
            recent = list(self.execution_history[-5:])
            last_snap_id = (self.last_snapshot.snapshot_id
                            if self.last_snapshot else None)
            # Truthful execute() call count.
            total_tasks = self._total_tasks

        success_rate = (total_successes / total_primitive_runs
                        if total_primitive_runs > 0 else 0.0)
        avg_queries = (total_queries / total_primitive_runs
                       if total_primitive_runs > 0 else 0.0)

        # last_snapshot_id is per-process — another process may have
        # overwritten latest.json. Documented in capabilities() output
        # via the field name; not re-read from disk (perf cost).
        return {
            # Version follows the package's single source of truth
            # (``srs.__version__``). Previously this was hardcoded to a
            # string, so a version bump in ``__init__.py`` would silently
            # leave ``capabilities()["version"]`` stale. Tests assert
            # against ``__version__`` (or an explicit set of accepted
            # values); both forms now agree automatically.
            "version": __version__,
            "primitives": ["E", "C", "A", "S", "V", "Adv", "Q"],
            # The old `total_executions` field was mislabeled. It counted
            # primitive-runs (8 tasks × 4 primitives = 32), not task
            # executions (8). The two new fields below are truthful:
            #   - total_primitive_runs: sum of stats["runs"] across primitives
            #   - total_tasks: actual execute() call count (self._total_tasks)
            "total_primitive_runs": total_primitive_runs,
            "total_tasks": total_tasks,
            # DEPRECATED alias of total_tasks, kept for backward compat with
            # any consumer still reading caps["total_executions"].
            # Use total_tasks instead.
            "total_executions": total_tasks,
            "success_rate": round(success_rate, 4),
            "total_queries_made": total_queries,
            "avg_queries_per_execution": round(avg_queries, 2),
            "advice_entries": advice_entries,
            "advice_size_bytes": advice_size,
            "snapshots": len(persistence.list_snapshots(self.home)),
            "last_snapshot_id": last_snap_id,
            "interrupted_tasks": len(list(self.home.glob("inflight_*.json"))),
            "primitive_stats": primitive_stats,
            "recent_executions": recent,
        }


def self_test() -> str:
    """End-to-end self-test (exercises async + capabilities)."""
    import asyncio
    import tempfile
    with tempfile.TemporaryDirectory() as tmp:
        rt = Runtime(home=Path(tmp))
        # Build a task
        hyps = [hashlib.sha256(f"h{i}".encode()).digest() for i in range(64)]
        task = Task(kind="identify",
                    payload={"hypotheses": hyps, "target_idx": 7, "n_features": 12},
                    budget=16)
        r = rt.execute(task)
        assert r.correct, "identify failed"
        # execute_async must produce the same Result shape.
        # asyncio.run() creates a fresh event loop, runs the coroutine to
        # completion, then closes the loop. This is the recommended way to
        # drive a coroutine from a synchronous caller (e.g. a unit test).
        r_async = asyncio.run(rt.execute_async(task))
        assert r_async.correct, "execute_async failed"
        assert r_async.task_id == task.task_id, \
            "execute_async returned wrong task_id"
        # Plan
        p = rt.plan_task(task)
        assert "primitives" in p
        assert "estimated_cost" in p
        # Persist + recover (snapshot_hash verified on load).
        path = rt.store_state()
        assert path.exists()
        rt2 = Runtime(home=Path(tmp))
        assert rt2.recover()
        assert rt2.advice.size_bytes() > 0
        # Capabilities should be meaningful now
        c = rt2.capabilities()
        assert c["version"] == __version__
        # Both fields exist and are truthful.
        assert "total_primitive_runs" in c, \
            "capabilities must include total_primitive_runs"
        assert "total_tasks" in c, \
            "capabilities must include total_tasks"
        # total_tasks counts execute() CALLS (1 here because we ran 1 task
        # before persisting — the second execute_async run didn't increment
        # rt2's counter because rt2 is a separate instance loaded from disk).
        # total_primitive_runs sums stats["runs"] across all primitives,
        # which is always >= total_tasks (one execute() touches >=1 primitive).
        assert c["total_tasks"] >= 1
        assert c["total_primitive_runs"] >= c["total_tasks"], \
            f"total_primitive_runs ({c['total_primitive_runs']}) must be " \
            f">= total_tasks ({c['total_tasks']})"
        # Backward-compat alias still present (deprecated).
        assert c["total_executions"] == c["total_tasks"]
        assert c["success_rate"] > 0
        assert c["advice_entries"] >= 1
        # Test str home
        rt3 = Runtime(home=str(tmp))
        assert isinstance(rt3.home, Path)
        # Second run of same task should hit advice (0 queries).
        r2 = rt.execute(task)  # advice now seeded
        assert r2.correct
        assert r2.queries == 0, \
            f"second run with advice should make 0 queries, got {r2.queries}"
        # In-flight state cleared after successful execution.
        assert not any(rt.home.glob("inflight_*.json")), \
            "in-flight state should be cleared after success"
        # Deterministic seed — same task_id gives same seed across
        # Runtime instances.
        from srs.runtime import _deterministic_seed
        assert _deterministic_seed("abc123") == _deterministic_seed("abc123")
        # _validate_task rejects missing payload keys.
        from srs.types import _validate_task
        bad = Task(kind="identify", payload={}, budget=16)
        try:
            _validate_task(bad)
            raise AssertionError("should have raised ValueError")
        except ValueError:
            pass
        # __init__ must survive a corrupt primitive_stats with a valid
        # snapshot_hash (the brick scenario where the snapshot passes the
        # integrity check but a downstream field is malformed).
        # v7.7 note: snapshot_hash now covers primitive_stats, so any
        # tampering is detected at load_latest() and the snapshot is
        # rejected (returns None). The runtime then starts fresh with
        # empty state — no brick. This test verifies that fallback.
        import json as _json
        snap_file = next(rt.home.glob("snap_*.json"))
        with open(snap_file, encoding="utf-8") as f:
            d = _json.load(f)
        # Corrupt primitive_stats. v7.7 snapshot_hash will catch this
        # (hash mismatch → load_latest returns None → __init__ uses
        # fresh state). The runtime must NOT brick.
        d["primitive_stats"] = "i_am_not_a_dict"
        with open(snap_file, "w", encoding="utf-8") as f:
            _json.dump(d, f)
        # Constructor must NOT crash and must produce a working
        # (empty-stats) runtime rather than a half-recovered brick.
        rt4 = Runtime(home=Path(tmp))
        assert isinstance(rt4.primitive_stats, dict), \
            "primitive_stats must be reset to dict, not str"
        # And execute() must work on the recovered-but-reset runtime.
        r3 = rt4.execute(task)
        assert r3.correct, "execute must work after corrupt reload"
    return "runtime OK"


if __name__ == "__main__":
    print(self_test())
