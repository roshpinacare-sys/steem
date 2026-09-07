#!/usr/bin/env python3
"""SRS Runtime CLI.

CLI surface:
  - ``--home`` global flag overrides the default home directory
    (default: ``~/.srs/snapshots/``). Lets users isolate runs.
  - ``cmd_execute`` no longer auto-persists by default. Use ``--persist``
    to write a snapshot after execution.
  - ``--format {json,human}`` global flag (default: ``human``, readable
    text; ``json`` emits machine-parseable JSON for all commands).
  - ``list-kinds`` subcommand prints all valid task kinds.
  - Exit code for ``verify`` tasks: ``r.correct is None`` no longer
    triggers exit 2; only explicit ``False`` does.
  - ``cmd_execute`` validates ``target_idx`` is in range before calling
    the runtime, producing a helpful ValueError instead of IndexError.
  - ``cmd_execute`` caps ``n`` at ``MAX_N = 1_000_000`` to prevent
    OOM-killing on ``execute identify 999999999``. ``Task.__post_init__``
    independently enforces the same cap on ``payload['hypotheses']``
    for Python-API callers (defense in depth).

Exit codes:
  0: success
  1: usage error / runtime error
  2: task executed but result was incorrect (NOT budget-dependent)
  3: task executed but verification failed
"""
from __future__ import annotations

import argparse
import hashlib
import json
import logging
import os
import sys
from pathlib import Path
from typing import Any

# ``srs`` is imported below. We do NOT mutate ``sys.path`` at module
# import time — that's a side effect visible to any code that imports
# this module (including pytest, which has its own sys.path management).
# The repo-root insertion is deferred to ``main()`` so it only fires
# when this module is executed as a CLI entry point. Tests that import
# ``srs.cli`` directly already have the project root on sys.path via
# conftest.py / sys.path.insert in their own bootstrap.

try:
    from srs import Runtime, Task, __version__
    from srs.persistence import SafeFormatter, _safe_log_value
    from srs.planner import TASK_AXIS, plan  # task kinds
    from srs.types import MAX_HYPOTHESES  # share the cap with types.py
except ImportError:
    # Allow the module to import even when the project root is not on
    # sys.path yet (e.g. when the CLI is invoked as
    # ``python3 /path/to/srs/cli.py`` from outside the repo). The
    # deferred ``main()`` call below inserts the repo root and then
    # re-imports the names. This block is a no-op when ``srs`` is
    # already importable (the normal pytest / installed-package case).
    Runtime = None  # type: ignore[assignment,misc]
    Task = None  # type: ignore[assignment,misc]
    __version__ = "0.0.0"
    SafeFormatter = None  # type: ignore[assignment,misc]

    def _safe_log_value(value, max_len=64):  # type: ignore[assignment,misc]
        return str(value)

    TASK_AXIS = {}  # type: ignore[assignment,misc]
    plan = None  # type: ignore[assignment,misc]
    MAX_HYPOTHESES = 1_000_000

# NO_COLOR policy. Per https://no-color.org we honor the NO_COLOR
# environment variable (any non-empty value disables color) regardless
# of TTY. We also disable color when stdout is not a TTY (so piped
# output never contains escape codes). The CLI doesn't currently emit
# any color codes, but this gate is documented here as the canonical
# check that any future color-emitting code MUST use before emitting.
# Example: `if USE_COLOR: print("\033[31mError\033[0m")` else `print("Error")`.
USE_COLOR = (
    os.environ.get("NO_COLOR") is None
    and sys.stdout.isatty()
    and os.environ.get("TERM", "") not in ("", "dumb")
)


def _add_logging_flags(parser, is_subparser: bool = False) -> None:
    """Add --verbose/-v and --quiet/-q flags to a parser.

    These flags can appear GLOBALLY (before the subcommand) OR on the
    subcommand itself. Both forms work:
        srs --verbose execute identify 64
        srs execute identify 64 --verbose

    For subparsers, we use default=argparse.SUPPRESS so that if the
    flag isn't passed on the subcommand, the global value (set by the
    parent parser) is preserved. Otherwise the subparser's default=False
    would silently overwrite a global --verbose=True when the user
    relies on the global form.

    The merge semantics after parsing:
      - global --verbose, no subcommand flag     -> verbose=True  (inherited)
      - no global flag, subcommand --verbose     -> verbose=True  (subparser set it)
      - global --verbose, subcommand --verbose   -> verbose=True  (idempotent)
      - global --verbose, subcommand --quiet     -> verbose=True AND quiet=True
        (verbose wins in _configure_logging because it's checked first)
      - no flags anywhere                        -> verbose=False (default)
    """
    # For the global parser: default=False so the attribute always exists.
    # For subparsers: default=SUPPRESS so the attribute is only set if the
    # user actually passes the flag (otherwise the global value persists).
    default = argparse.SUPPRESS if is_subparser else False
    parser.add_argument("--verbose", "-v", action="store_true", default=default,
                        help="Enable DEBUG logging (shows per-stage and "
                             "per-primitive diagnostics). Default: INFO.")
    parser.add_argument("--quiet", "-q", action="store_true", default=default,
                        help="Suppress INFO logging (only WARNING/ERROR). "
                             "Implied by --format json.")
    # --accessibility flag. Like --verbose / --quiet, it can be
    # passed either globally (before the subcommand) or on the subcommand
    # itself. The default=SUPPRESS on subparsers means a global
    # --accessibility=True is preserved unless the subcommand explicitly
    # overrides it. When set, the human-format renderers add plain-English
    # descriptions of each field for screen-reader users.
    parser.add_argument("--accessibility", action="store_true", default=default,
                        help="Enable enhanced accessibility mode "
                             "(screen-reader-friendly output with field "
                             "descriptions; ASCII-only, no emoji).")


# Structured logging via Python's `logging` module.
# Operational diagnostics go through `logger.*` calls; print() is reserved
# for human-readable CLI output (results, capabilities, errors to stderr).
logger = logging.getLogger("srs.cli")


def _configure_logging(args: argparse.Namespace) -> None:
    """Set logging level from --verbose / --quiet / --format.

    Default: INFO (matches earlier behavior — quiet by default).
    --verbose: DEBUG (shows per-stage / per-primitive diagnostics).
    --quiet:   WARNING (suppresses INFO/DEBUG).
    --format json implies ERROR (suppresses INFO/DEBUG/WARNING) so the
        machine-readable JSON output on stdout is not polluted with
        human-readable WARNING/INFO lines on stderr. ``--verbose`` wins
        over ``--format json`` so a developer can still see DEBUG while
        emitting JSON.

    --verbose / --quiet can be set EITHER globally OR on the subcommand.
    getattr() with a False default handles the case where the flag wasn't
    passed at all (e.g. when default=argparse.SUPPRESS was used on a
    subparser).

    Defense in depth: the handler is configured with
    ``SafeFormatter`` which strips ``\\n`` / ``\\r`` from the FINAL
    formatted log message. This is the second layer of defense on top
    of ``_safe_log_value``: even if a user-controlled value slips past
    the helper (e.g. an exception's ``__str__`` returns a multiline
    traceback), the log line stays single-line and a fake "INFO
    execute: complete" line cannot be injected.

    Timestamp format: ISO 8601 with timezone
    (``%Y-%m-%dT%H:%M:%S%z``) instead of bare ``%H:%M:%S``. ISO 8601
    is sortable, grep-able across days, and unambiguous across time
    zones. Previously two log lines from different days could appear
    adjacent and the bare HH:MM:SS would not reveal the day boundary.

    ``--format json`` suppresses WARNING/INFO/DEBUG (sets level to
    ERROR) so stderr stays clean while JSON goes to stdout. Previously
    ``--format json`` only went to WARNING level, which still emitted
    WARNING lines on stderr — a JSON consumer had to either ignore
    stderr or filter these lines out. ``--verbose`` overrides this so
    debug-level diagnostics are still available with JSON output for
    developer use.
    """
    verbose = getattr(args, "verbose", False)
    quiet = getattr(args, "quiet", False)
    fmt = getattr(args, "format", "human")
    if verbose:
        level = logging.DEBUG
    elif fmt == "json":
        # In JSON mode, suppress everything below ERROR so the
        # machine-readable stdout stream is not interleaved with
        # human-readable WARNING/INFO on stderr.
        level = logging.ERROR
    elif quiet:
        level = logging.WARNING
    else:
        level = logging.INFO
    # Build the formatter and handler explicitly so we control the
    # formatter class (logging.basicConfig installs a plain
    # logging.Formatter and does not let us override it cleanly).
    # ISO 8601 datefmt with timezone for sortable, unambiguous
    # timestamps across days and time zones.
    formatter = SafeFormatter(
        fmt="%(asctime)s %(levelname)-5s %(name)s: %(message)s",
        datefmt="%Y-%m-%dT%H:%M:%S%z",
    )
    handler = logging.StreamHandler(stream=sys.stderr)
    handler.setFormatter(formatter)
    # Replace the root logger's handlers with our SafeFormatter-wrapped
    # handler. Using ``handlers = [handler]`` (instead of basicConfig)
    # ensures we don't accumulate duplicate handlers on repeat calls
    # (which would otherwise happen if a test invokes main() twice in
    # the same process).
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(level)
    # Also bump the srs namespace logger so module-level DEBUG comes through.
    logging.getLogger("srs").setLevel(level)
    logger.debug("logging configured: level=%s", logging.getLevelName(level))


# Hard cap on `n` for the `execute` subcommand. Without this,
# `execute identify 999999999` would try to allocate ~1 GB of sha256
# digests and OOM-kill the process. 10**6 is far beyond any realistic
# problem size for this runtime's planner (whose cost model is at worst
# O(N log N)). The cap is also enforced in Task.__post_init__ so Python-
# API callers can't bypass it.
MAX_N = MAX_HYPOTHESES


# ----------------------------------------------------------------------
# Output formatting
# ----------------------------------------------------------------------

def emit(args: argparse.Namespace, data: Any, human_text: str = "") -> None:
    """Emit output in the requested format.

    --format {json,human} global flag.
    - json: emit `data` as JSON (machine-parseable)
    - human: emit `human_text` (readable text); fall back to JSON if no text
    """
    if getattr(args, "format", "human") == "json":
        print(json.dumps(data, indent=2, default=str))
    else:
        if human_text:
            print(human_text)
        else:
            print(json.dumps(data, indent=2, default=str))


# ----------------------------------------------------------------------
# Human-readable formatters for --format human output. Previously
# `cmd_capabilities` and `cmd_recover` ignored the --format flag and
# always dumped raw JSON, which screen-reader users had to wade through
# line-by-line. These renderers produce a short summary suitable for
# at-a-glance reading or screen-reader pronunciation.
# ----------------------------------------------------------------------

def _format_human_capabilities(caps: dict, accessibility: bool = False) -> str:
    """Format capabilities as human-readable text.

    Output is a short summary (version, totals, advice count, snapshots)
    followed by a per-primitive breakdown table. Each line is one logical
    record so screen readers can navigate by line.

    When ``accessibility=True`` (set via ``--accessibility`` flag),
    each numeric / boolean field is followed by a brief in-plain-English
    description of what the value means. This adds redundancy that
    benefits screen-reader users who hear the value without seeing the
    label-column alignment, and benefits users unfamiliar with the
    runtime's vocabulary (e.g. "advice entries" is jargon for "cached
    answers from previous runs"). All output is ASCII-only (no emoji,
    no box-drawing characters beyond the ASCII ``=`` separator).
    """
    total_tasks = caps.get("total_tasks", caps.get("total_executions", 0))
    total_queries = caps.get("total_queries_made", 0)
    avg_queries = caps.get("avg_queries_per_execution", 0.0)
    success_rate = caps.get("success_rate", 0.0)
    advice_entries = caps.get("advice_entries", 0)
    snapshots = caps.get("snapshots", 0)
    interrupted = caps.get("interrupted_tasks", 0)
    primitives = caps.get("primitives", [])
    last_snap = caps.get("last_snapshot_id")

    lines: list[str] = []
    lines.append(f"SRS Runtime v{caps.get('version', '?')}")
    lines.append("=" * 40)
    lines.append(f"Primitives: {', '.join(primitives) if primitives else '(none)'}")
    if accessibility:
        lines.append(
            "(Primitives are the runtime's fundamental operations; "
            "the list above shows which are loaded and available for execution.)"
        )
    lines.append(f"Total tasks:        {total_tasks}")
    if accessibility:
        lines.append(
            "(Total tasks is the number of execute() calls since the "
            "runtime was initialized.)"
        )
    lines.append(f"Total queries made: {total_queries}")
    if accessibility:
        lines.append("(Total queries made sums information-gain queries across all tasks.)")
    lines.append(f"Avg queries/task:   {avg_queries:.2f}")
    if accessibility:
        lines.append(
            "(Avg queries per task is total queries divided by total tasks; "
            "lower is better and indicates the advice cache is being reused.)"
        )
    lines.append(f"Success rate:       {success_rate * 100:.1f}%")
    if accessibility:
        lines.append("(Success rate is the percentage of tasks that returned the correct answer.)")
    lines.append(f"Advice entries:     {advice_entries}")
    if accessibility:
        lines.append(
            "(Advice entries is the number of cached answers from previous runs; "
            "a hit on the next run skips the search and uses 0 queries.)"
        )
    lines.append(f"Snapshots on disk:  {snapshots}")
    if accessibility:
        lines.append(
            "(Snapshots on disk is the number of persisted state files "
            "in the home directory.)"
        )
    lines.append(f"Interrupted tasks:  {interrupted}")
    if accessibility:
        lines.append(
            "(Interrupted tasks is the number of tasks that started but did not finish; "
            "they can be resumed with execute(resume=True).)"
        )
    if last_snap:
        lines.append(f"Last snapshot id:   {last_snap}")
        if accessibility:
            lines.append(
                "(Last snapshot id is the identifier of the most recent "
                "persisted state; pass it to recover().)"
            )
    lines.append("")

    prim_stats = caps.get("primitive_stats")
    if prim_stats and isinstance(prim_stats, dict):
        lines.append("Per-primitive breakdown:")
        if accessibility:
            lines.append(
                "(Each line below shows one primitive's run count, success "
                "count, success rate, and total queries. Primitives are "
                "listed alphabetically.)"
            )
        for prim in sorted(prim_stats.keys()):
            stats = prim_stats[prim]
            if isinstance(stats, dict):
                runs = stats.get("runs", 0)
                succ = stats.get("successes", 0)
                q = stats.get("total_queries", 0)
                # Rate as percentage of runs that succeeded.
                rate = (succ / runs * 100) if runs > 0 else 0.0
                lines.append(
                    f"  {prim}: {succ}/{runs} successes "
                    f"({rate:.1f}%), {q} queries"
                )
                if accessibility:
                    lines.append(
                        f"  ({prim} ran {runs} time{'s' if runs != 1 else ''}, "
                        f"succeeded {succ} time{'s' if succ != 1 else ''}, "
                        f"and used {q} queries total.)"
                    )
    return "\n".join(lines)


def _format_human_result(result: dict, accessibility: bool = False) -> str:
    """Format execution result as human-readable text.

    Each field is on its own line with a clear label and (where useful)
    a units suffix, so a screen-reader user hearing "twenty-two point
    nine six" immediately knows it is milliseconds.

    When ``accessibility=True`` (set via ``--accessibility`` flag),
    each field is followed by a plain-English description of what the
    value represents and (for numeric fields) the unit's long form.
    This redundancy helps screen-reader users who hear values without
    the visual column alignment, and helps users unfamiliar with the
    runtime's vocabulary.
    """
    task_id = result.get("task_id", "?")
    primitives = result.get("primitives_used", [])
    answer = result.get("answer")
    correct = result.get("correct")
    verified = result.get("verified")
    queries = result.get("queries", 0)
    storage = result.get("storage_bytes", 0)
    work_units = result.get("work_units", 0)
    depth = result.get("depth", 0)
    wall_time = result.get("wall_time_ms", 0)

    lines: list[str] = [
        f"Task ID:     {task_id}",
        f"Answer:      {answer}",
        f"Correct:     {correct}",
        f"Verified:    {verified}",
        f"Primitives:  {', '.join(primitives) if primitives else '(none)'}",
        f"Queries:     {queries}",
        f"Storage:     {storage} bytes",
        f"Work units:  {work_units}",
        f"Depth:       {depth}",
        f"Wall time:   {wall_time:.2f} ms",
    ]
    if accessibility:
        lines.append("")
        lines.append("Field descriptions:")
        lines.append(
            f"- Task ID: {task_id} is the unique identifier for this task; "
            "use it to reference the task in subsequent commands."
        )
        lines.append(
            f"- Answer: {answer} is the index of the hypothesis the runtime "
            "identified as the target (the identified hypothesis index)."
        )
        if correct is True:
            lines.append(
                "- Correct: True means the identified answer matches the "
                "actual target index."
            )
        elif correct is False:
            lines.append(
                "- Correct: False means the identified answer does NOT match "
                "the target (budget was likely too small)."
            )
        else:
            lines.append(
                "- Correct: None means correctness could not be determined "
                "(e.g. a compute task has no target)."
            )
        if verified is True:
            lines.append(
                "- Verified: True means an independent verification primitive "
                "confirmed the answer."
            )
        elif verified is False:
            lines.append(
                "- Verified: False means verification rejected the answer "
                "(treat with caution)."
            )
        else:
            lines.append("- Verified: None means no verification primitive was run for this task.")
        lines.append(
            f"- Primitives: {', '.join(primitives) if primitives else '(none)'} "
            "are the runtime operations invoked during execution (A = adaptivity, "
            "C = compression, E = execution, V = verification, Adv = advice, "
            "Q = quantum, S = scheduling)."
        )
        lines.append(
            f"- Queries: {queries} is the number of information-gain queries "
            "made during execution (lower is better; 0 means an advice hit "
            "short-circuited the search)."
        )
        lines.append(
            f"- Storage: {storage} bytes is the cumulative size of the query "
            "transcript persisted in the snapshot."
        )
        lines.append(
            f"- Work units: {work_units} is a synthetic cost metric "
            "(proportional to budget times the number of hypotheses) "
            "used for planner comparison."
        )
        lines.append(
            f"- Depth: {depth} is the maximum pipeline depth reached "
            "(1 for a single-stage run; higher for multi-stage plans)."
        )
        lines.append(
            f"- Wall time: {wall_time:.2f} ms (milliseconds) is the "
            "elapsed real time for this execution."
        )
    return "\n".join(lines)


# ----------------------------------------------------------------------
# Command handlers
# ----------------------------------------------------------------------

def cmd_self_test(args: argparse.Namespace) -> int:
    """Run every module's self-test."""
    logger.debug("self-test: starting")
    from srs import improvement, persistence, pipeline, planner, runtime
    from srs.primitives import (
        adaptivity,
        adversarial,
        advice,
        compression,
        execution,
        quantum,
        scheduling,
        verification,
    )

    modules = [
        ("srs.primitives.execution", execution),
        ("srs.primitives.compression", compression),
        ("srs.primitives.adaptivity", adaptivity),
        ("srs.primitives.scheduling", scheduling),
        ("srs.primitives.verification", verification),
        ("srs.primitives.advice", advice),
        ("srs.primitives.quantum", quantum),
        ("srs.primitives.adversarial", adversarial),
        ("srs.planner", planner),
        ("srs.persistence", persistence),
        ("srs.improvement", improvement),
        ("srs.pipeline", pipeline),
        ("srs.runtime", runtime),
    ]
    results = []
    passed = 0
    failed = 0
    for name, mod in modules:
        try:
            mod.self_test()
            results.append({"module": name, "status": "pass"})
            passed += 1
            logger.debug("self-test: PASS %s", name)
        except Exception as e:
            results.append({"module": name, "status": "fail", "error": str(e)})
            failed += 1
            logger.error("self-test: FAIL %s: %s", name, _safe_log_value(e))

    summary = f"{passed}/{passed + failed} modules passed"
    if getattr(args, "format", "human") == "json":
        # Machine-parseable self-test output
        emit(args, {"modules": results, "passed": passed,
                    "failed": failed, "total": passed + failed})
    else:
        for r in results:
            if r["status"] == "pass":
                print(f"  PASS  {r['module']}")
            else:
                print(f"  FAIL  {r['module']}: {r['error']}")
        print(f"\n{summary}")
    return 0 if failed == 0 else 1


def cmd_capabilities(args: argparse.Namespace) -> int:
    """Print capability report."""
    rt = Runtime(home=args.home)
    c = rt.capabilities()
    if getattr(args, "format", "human") == "json":
        emit(args, c)
    else:
        # Real human renderer (was: raw JSON dump).
        # --accessibility triggers screen-reader-friendly extra descriptions.
        accessibility = getattr(args, "accessibility", False)
        print(_format_human_capabilities(c, accessibility=accessibility))
    return 0


def cmd_execute(args: argparse.Namespace) -> int:
    """Execute a synthetic task.

    --persist flag controls whether a snapshot is written.
              Default is NO auto-persist.
    Exit code 2 only when r.correct is False (not None).
    Validate target_idx is in range before calling runtime.
    Cap n at MAX_N = 1_000_000 to prevent OOM kill on
              `execute identify 999999999`.
    """
    logger.debug("execute: kind=%s n=%d budget=%d persist=%s candidate=%s",
                 _safe_log_value(args.kind), args.n, args.budget,
                 args.persist, args.candidate)
    rt = Runtime(home=args.home)
    n = args.n
    # Plain-English error message (no jargon). The hard cap prevents
    # trying to allocate too much memory for very large inputs; the
    # limit is shared between the CLI and Task.__init__.
    if n > MAX_N:
        print(f"Error: n={n} is too large. Maximum supported value is "
              f"{MAX_N}. Please use a smaller value.", file=sys.stderr)
        return 1
    if n < 0:
        print(f"Error: n={n} must be 0 or greater.", file=sys.stderr)
        return 1
    hyps = [hashlib.sha256(f"h{i}".encode()).digest() for i in range(n)]
    target_idx = n // 2

    # Validate target_idx is in range. Plain English range description
    # instead of half-open math notation `[0, n)`.
    if not (0 <= target_idx < n) and n > 0:
        print(f"Error: target_idx {target_idx} is out of range. "
              f"Valid range is 0 to {n - 1} (for {n} hypotheses).",
              file=sys.stderr)
        return 1

    # Accept candidate from payload for verify tasks
    payload: dict[str, Any] = {
        "hypotheses": hyps,
        "target_idx": target_idx,
        "n_features": 12,
    }
    if args.candidate is not None:
        # Allow user to specify a candidate for verify tasks.
        # Plain-English range description.
        if not (0 <= args.candidate < n):
            print(f"Error: candidate {args.candidate} is out of range. "
                  f"Valid range is 0 to {n - 1} (for {n} hypotheses).",
                  file=sys.stderr)
            return 1
        payload["candidate"] = args.candidate

    try:
        task = Task(kind=args.kind, payload=payload, budget=args.budget)
        r = rt.execute(task)
    except (ValueError, TypeError) as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1

    # Only persist if --persist flag is set
    if args.persist:
        rt.store_state()

    # Format output
    if getattr(args, "format", "human") == "json":
        emit(args, r.to_dict())
    else:
        # Human-readable result, not raw JSON.
        # --accessibility triggers screen-reader-friendly field descriptions.
        accessibility = getattr(args, "accessibility", False)
        print(_format_human_result(r.to_dict(), accessibility=accessibility))

    # Only exit 2 on explicit False (not None)
    if r.correct is False:
        return 2  # task ran but answer wrong (likely budget too small)
    if r.verified is False:
        return 3  # verification failed
    return 0


def cmd_snapshot(args: argparse.Namespace) -> int:
    """Save state snapshot."""
    rt = Runtime(home=args.home)
    path = rt.store_state()
    if getattr(args, "format", "human") == "json":
        emit(args, {"snapshot_path": str(path)})
    else:
        print(f"Snapshot saved: {path}")
    return 0


def cmd_recover(args: argparse.Namespace) -> int:
    """Reload last snapshot + check for interrupted tasks."""
    rt = Runtime(home=args.home)
    accessibility = getattr(args, "accessibility", False)
    if rt.recover():
        caps = rt.capabilities()
        inflight = rt.resume_interrupted()
        if getattr(args, "format", "human") == "json":
            out = {"recovered": True, "capabilities": caps}
            if inflight:
                out["interrupted_task"] = inflight
            emit(args, out)
        else:
            # Human-readable recovery summary instead of dumping the full
            # capabilities JSON blob.
            print("Recovered snapshot "
                  f"{caps.get('last_snapshot_id', '<unknown>')}")
            print(f"  Snapshots on disk: {caps.get('snapshots', 0)}")
            print(f"  Total tasks run:   {caps.get('total_tasks', 0)}")
            print(f"  Advice entries:    {caps.get('advice_entries', 0)}")
            print(f"  Interrupted tasks: {caps.get('interrupted_tasks', 0)}")
            if accessibility:
                print("  (Snapshots on disk is the number of persisted state files.)")
                print("  (Total tasks run is the number of execute() calls since initialization.)")
                print("  (Advice entries is the number of cached answers from previous runs.)")
                print("  (Interrupted tasks is the number of tasks that"
                      " started but did not finish.)")
            if inflight:
                print()
                print(f"Interrupted task found: {inflight['task_id']}")
                print(f"  Kind:         {inflight.get('kind', '?')}")
                print(f"  Queries made: "
                      f"{inflight.get('queries_made', 0)} / "
                      f"{inflight.get('budget_total', 0)}")
                if accessibility:
                    print("  (Kind is the task type; Queries made shows progress "
                          "out of the total budget; the task can be resumed with "
                          "execute(resume=True).)")
        return 0
    if getattr(args, "format", "human") == "json":
        emit(args, {"recovered": False})
    else:
        print("No snapshot found")
    return 1


def cmd_plan(args: argparse.Namespace) -> int:
    """Show plan for a task kind.

    Validate task kind; raise ValueError instead of AttributeError.
    """
    kind = args.kind
    # Validate task kind
    if kind not in TASK_AXIS:
        valid = sorted(TASK_AXIS.keys())
        print(f"Error: unknown task kind {kind!r}. Valid kinds: {valid}",
              file=sys.stderr)
        return 1

    rt = Runtime(home=args.home)
    advice_available = bool(rt.advice)
    axis, prims, cost = plan(kind, n=args.n, budget=args.budget,
                              advice_available=advice_available)
    plan_data = {
        "task_kind": kind,
        "primary_axis": axis,
        "primitives": prims,
        "estimated_cost": {
            "queries": cost.queries,
            "storage_bytes": cost.storage_bytes,
            "work_units": cost.work_units,
            "depth": cost.depth,
            "communication_bits": cost.communication_bits,
            "verification_calls": cost.verification_calls,
            "soundness_epsilon": cost.soundness_epsilon,
            "confidence": cost.confidence,
        },
    }
    if getattr(args, "format", "human") == "json":
        emit(args, plan_data)
    else:
        print(f"Task kind: {kind}")
        print(f"Primary axis: {axis}")
        print(f"Primitives: {prims}")
        print("Estimated cost:")
        print(f"  queries: {cost.queries}")
        print(f"  storage_bytes: {cost.storage_bytes}")
        print(f"  work_units: {cost.work_units}")
        print(f"  depth: {cost.depth}")
        print(f"  communication_bits: {cost.communication_bits}")
        print(f"  verification_calls: {cost.verification_calls}")
        print(f"  soundness_epsilon: {cost.soundness_epsilon}")
        print(f"  confidence: {cost.confidence}")
    return 0


def cmd_list_kinds(args: argparse.Namespace) -> int:
    """List all valid task kinds.

    Prints the TASK_AXIS mapping: task_kind -> primary_axis.
    """
    kinds = sorted(TASK_AXIS.keys())
    if getattr(args, "format", "human") == "json":
        emit(args, {"task_kinds": kinds, "axis_mapping": dict(TASK_AXIS)})
    else:
        print(f"Valid task kinds ({len(kinds)}):")
        for k in kinds:
            print(f"  {k:<15} primary_axis: {TASK_AXIS[k]}")
    return 0


def _ensure_imports() -> None:
    """Import (or re-import) the ``srs`` package on first CLI invocation.

    Why this exists: the module-level ``try: from srs import ...`` block
    succeeds when ``srs`` is already on ``sys.path`` (the pytest case —
    ``conftest.py`` inserts the project root). When ``srs/cli.py`` is
    invoked directly (``python3 srs/cli.py ...``) the script's parent
    dir is on ``sys.path`` instead of the project root, so the
    module-level import fails and the module-level names are left as
    ``None``. This helper is called from :func:`main` to insert the
    project root and bind the names lazily — keeping ``sys.path``
    mutation out of import time. Tests that import ``srs.cli`` directly
    already have the project root on sys.path via conftest.py /
    sys.path.insert in their own bootstrap.
    """
    global Runtime, Task, __version__, SafeFormatter, _safe_log_value
    global TASK_AXIS, plan, MAX_HYPOTHESES, MAX_N
    if Runtime is not None:
        return  # already imported (pytest path)
    # Insert the project root (parent of ``srs/``) so ``from srs import ...``
    # works. Idempotent — a second invocation is a no-op.
    project_root = str(Path(__file__).resolve().parent.parent)
    if project_root not in sys.path:
        sys.path.insert(0, project_root)
    from srs import Runtime as _Runtime  # type: ignore[import-not-found]
    from srs import Task as _Task
    from srs import __version__ as _version
    from srs.persistence import SafeFormatter as _SafeFormatter  # type: ignore[import-not-found]
    from srs.persistence import _safe_log_value as _safe_log  # type: ignore[import-not-found]
    from srs.planner import TASK_AXIS as _TASK_AXIS  # type: ignore[import-not-found]
    from srs.planner import plan as _plan
    from srs.types import MAX_HYPOTHESES as _MAX_HYPOTHESES  # type: ignore[import-not-found]
    Runtime = _Runtime  # type: ignore[assignment,misc]
    Task = _Task  # type: ignore[assignment,misc]
    __version__ = _version
    SafeFormatter = _SafeFormatter  # type: ignore[assignment,misc]
    _safe_log_value = _safe_log  # type: ignore[assignment,misc]
    TASK_AXIS = _TASK_AXIS  # type: ignore[assignment,misc]
    plan = _plan  # type: ignore[assignment,misc]
    MAX_HYPOTHESES = _MAX_HYPOTHESES
    MAX_N = _MAX_HYPOTHESES


def main(argv: list | None = None) -> int:
    # Defer ``sys.path`` mutation until the CLI is actually invoked.
    # This keeps ``import srs.cli`` (e.g. from pytest) side-effect-free.
    _ensure_imports()
    parser = argparse.ArgumentParser(
        prog="srs",
        # ASCII-only description (the em-dash breaks on ASCII-only
        # terminals, Windows cmd.exe with non-UTF-8 code page, and screen
        # readers configured with strict ASCII pronunciation). Version is
        # derived from __version__ so --help and capabilities() always agree.
        description=(f"SRS Runtime v{__version__} -- "
                     "unified 7-primitive platform "
                     "(real compression + structured logging)"))
    # global --home flag
    parser.add_argument("--home", type=str, default=None,
                        help="Override home directory (default: ~/.srs/snapshots/). "
                             "Use this to isolate runs and avoid sharing advice state.")
    # global --format flag
    parser.add_argument("--format", choices=["json", "human"], default="human",
                        help="Output format (default: human)")
    # --verbose / --quiet logging control. Also added to each subparser
    # below so the flags work BOTH globally (`srs --verbose execute ...`)
    # AND on the subcommand (`srs execute ... --verbose`).
    _add_logging_flags(parser, is_subparser=False)
    sub = parser.add_subparsers(dest="cmd", required=True)

    # Every subparser gets --verbose / --quiet too. Use is_subparser=True
    # so default=argparse.SUPPRESS doesn't clobber a global --verbose when
    # the subcommand doesn't repeat the flag.
    for sp_name in ("self-test", "capabilities", "snapshot",
                    "recover", "bench", "list-kinds"):
        sp = sub.add_parser(sp_name, help={
            "self-test": "Run all self-tests",
            "capabilities": "Print capability report",
            "snapshot": "Save state snapshot",
            "recover": "Reload last snapshot + check for interrupted tasks",
            "bench": "Run benchmark suite",
            "list-kinds": "List all valid task kinds and their primary axes",
        }[sp_name])
        _add_logging_flags(sp, is_subparser=True)

    p_exec = sub.add_parser("execute", help="Execute a synthetic task")
    _add_logging_flags(p_exec, is_subparser=True)
    p_exec.add_argument("kind", choices=["identify", "identify_hard", "search",
                                          "verify", "compute"])
    p_exec.add_argument("n", type=int, help="Number of hypotheses")
    p_exec.add_argument("--budget", type=int, default=16)
    # --persist flag (default: no auto-persist)
    p_exec.add_argument("--persist", action="store_true",
                        help="Persist state snapshot after execution (default: off)")
    # --candidate flag for verify tasks
    p_exec.add_argument("--candidate", type=int, default=None,
                        help="Candidate index for verify tasks (default: target_idx). "
                             "Use this to actually test verification on a wrong candidate.")

    p_plan = sub.add_parser("plan", help="Show plan for a task kind")
    _add_logging_flags(p_plan, is_subparser=True)
    p_plan.add_argument("kind", help="Task kind (see `list-kinds` for valid values)")
    p_plan.add_argument("--n", type=int, default=64)
    p_plan.add_argument("--budget", type=int, default=16)

    args = parser.parse_args(argv)
    _configure_logging(args)
    logger.debug("cli: invoked cmd=%s home=%s format=%s verbose=%s quiet=%s",
                 _safe_log_value(args.cmd), _safe_log_value(getattr(args, "home", None)),
                 _safe_log_value(getattr(args, "format", "human")),
                 getattr(args, "verbose", False),
                 getattr(args, "quiet", False))

    if args.cmd == "self-test":
        return cmd_self_test(args)
    elif args.cmd == "capabilities":
        return cmd_capabilities(args)
    elif args.cmd == "execute":
        return cmd_execute(args)
    elif args.cmd == "snapshot":
        return cmd_snapshot(args)
    elif args.cmd == "recover":
        return cmd_recover(args)
    elif args.cmd == "plan":
        return cmd_plan(args)
    elif args.cmd == "list-kinds":
        return cmd_list_kinds(args)
    elif args.cmd == "bench":
        from benchmarks.srs.run_benchmarks import main as bench_main
        return bench_main()
    return 1


if __name__ == "__main__":
    sys.exit(main())
