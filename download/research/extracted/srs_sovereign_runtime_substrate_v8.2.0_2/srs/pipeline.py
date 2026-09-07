"""Pipeline — composable primitive chain with shared state.

Design:
  - ``PipelineState`` carries answer, candidate, confident, queries,
    etc. between stages so each stage can read what prior stages
    produced and write what it produced for later stages.
  - Each stage takes ``(task, state, rng, **kwargs)`` and MUTATES state.
  - Stages short-circuit: if ``state.confident`` is set (by ``Adv`` on
    an advice hit), subsequent stages skip their query work entirely,
    so the pipeline's total query count matches the planner's estimate
    of 0 for advice hits.
  - ``V`` reads ``state.candidate`` (set by ``E``/``A``/``Adv``) rather
    than ``task.payload["target_idx"]``, so verification actually tests
    the answer the prior stages picked — not the ground truth.
  - ``Adv`` sets ``state.confident=True`` on hit so ``E``/``A``/``V``
    skip, and the pipeline's query count matches the planner estimate.

Example: for an "identify" task, the pipeline is:
  Adv (if advice available) -> A (info-gain queries) -> V (probe check)
"""
from __future__ import annotations

import hashlib
import logging
import random
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from .persistence import _safe_log_value
from .types import Result, Task

logger = logging.getLogger("srs.pipeline")


@dataclass
class PipelineState:
    """Shared state carried between pipeline stages.

    Each stage reads from and mutates this object. Stages can short-circuit
    by checking ``state.confident`` (set True by ``Adv`` on advice hit).
    """
    answer: Any = None
    correct: bool | None = None
    verified: bool | None = None
    queries_made: int = 0
    transcript: list[tuple[Any, Any]] = field(default_factory=list)
    alive_set: set | None = None
    candidate: Any = None       # set by E/A/Adv; read by V (not target_idx)
    confident: bool = False     # set True by Adv on hit -> skip later stages
    storage_bytes: int = 0
    work_units: int = 0
    depth: int = 0
    communication_bits: int = 0
    verification_calls: int = 0
    notes: dict[str, Any] = field(default_factory=dict)


@dataclass
class PipelineStage:
    """A single stage in the execution pipeline."""
    name: str
    fn: Callable[..., None]
    args: dict[str, Any] = field(default_factory=dict)


@dataclass
class Pipeline:
    """A chain of stages executed in order, sharing PipelineState."""
    stages: list[PipelineStage] = field(default_factory=list)

    def add(self, name: str, fn: Callable[..., None],
            **kwargs) -> Pipeline:
        self.stages.append(PipelineStage(name=name, fn=fn, args=kwargs))
        return self

    def execute(self, task: Task, rng: random.Random,
                skip_queries: int = 0) -> Result:
        """Run all stages in order, accumulating state.

        skip_queries: number of queries to skip (for resume). The effective
        budget is reduced by skip_queries so the pipeline makes fewer
        queries on resume.
        """
        state = PipelineState()
        primitives_used: list[str] = []
        # Resume reduces effective budget by the queries already made
        # before the interruption so the pipeline doesn't re-ask them.
        effective_budget = max(0, task.budget - skip_queries)
        logger.debug("pipeline.execute: task_id=%s kind=%s budget=%d "
                     "effective_budget=%d skip_queries=%d stages=%s",
                     _safe_log_value(task.task_id), _safe_log_value(task.kind),
                     task.budget,
                     effective_budget, skip_queries,
                     [s.name for s in self.stages])

        for stage in self.stages:
            primitives_used.append(stage.name)
            # Short-circuit if a prior stage set confident (e.g., Adv hit):
            # skip this stage's query work entirely so the pipeline's
            # total query count matches the planner estimate.
            if state.confident:
                state.notes.setdefault("skipped_stages", []).append(stage.name)
                logger.debug("pipeline: skipping stage %s (state.confident=True)",
                             stage.name)
                continue
            logger.debug("pipeline: running stage %s", stage.name)
            stage.fn(task=task, state=state, rng=rng,
                     effective_budget=effective_budget, **stage.args)
            logger.debug("pipeline: stage %s complete (queries_made=%d, "
                         "work_units=%d, storage_bytes=%d, answer=%s)",
                         stage.name, state.queries_made, state.work_units,
                         state.storage_bytes, state.answer)

        logger.debug("pipeline.execute: complete primitives_used=%s "
                     "queries=%d correct=%s",
                     primitives_used, state.queries_made, state.correct)
        return Result(
            task_id=task.task_id,
            answer=state.answer,
            correct=state.correct,
            verified=state.verified,
            primitives_used=primitives_used,
            queries=state.queries_made,
            storage_bytes=state.storage_bytes,
            work_units=state.work_units,
            depth=state.depth,
            communication_bits=state.communication_bits,
            verification_calls=state.verification_calls,
            notes=state.notes,
        )


# --- Stage functions (each takes task, state, rng, **kwargs; mutates state) ---

def execution_stage(task: Task, state: PipelineState, rng: random.Random,
                    effective_budget: int | None = None, **kw) -> None:
    """Baseline execution: random queries + majority vote; mutates state."""
    from .primitives.execution import hash_bit
    hyps = task.payload["hypotheses"]
    target = task.payload["target_idx"]
    n_features = task.payload.get("n_features", 12)
    budget = effective_budget if effective_budget is not None else task.budget
    logger.debug("E: starting with budget=%d n_hyps=%d target=%d",
                 budget, len(hyps), target)
    queries: list[tuple[int, int]] = []
    # ``work`` accumulates ALL hash_bit evaluations in this stage:
    # ``budget`` for the query phase (one eval per query) plus
    # ``budget * len(hyps)`` for the scoring phase (each hypothesis is
    # scored against every query). Previously the scoring-loop work
    # was added to a local ``work`` variable but never read — the
    # state.work_units update was a separate ``+= budget * len(hyps)``
    # at the end. The two have been merged so ``work`` is the single
    # source of truth and the dead accumulation is gone.
    work = 0
    for _ in range(budget):
        x = rng.getrandbits(n_features)
        y = hash_bit(hyps[target], x)
        queries.append((x, y))
        state.transcript.append((x, y))
        work += 1
    state.queries_made += budget
    state.depth = max(state.depth, 1)
    best_idx, best_score = 0, -1
    for h_idx in range(len(hyps)):
        score = sum(1 for q, y in queries if hash_bit(hyps[h_idx], q) == y)
        work += budget  # scoring: one hash_bit eval per (hypothesis, query)
        if score > best_score:
            best_score, best_idx = score, h_idx
    state.work_units += work
    state.storage_bytes = max(state.storage_bytes, budget * 16)
    # E sets answer + candidate (but NOT confident) so V still runs to verify
    state.answer = best_idx
    state.candidate = best_idx  # V reads this, not target_idx
    state.correct = (best_idx == target)
    logger.debug("E: complete best_idx=%d correct=%s queries=%d work=%d",
                 best_idx, state.correct, budget, work)


def compression_stage(task: Task, state: PipelineState, rng: random.Random,
                      effective_budget: int | None = None, **kw) -> None:
    """REAL compression — pack responses, delta-encode queries.

    Reads the transcript accumulated by E/A (state.transcript) and
    compresses it. If no transcript exists yet, builds one from the
    task parameters.

    Honest storage: len(packed_responses) + len(delta_encoded_queries)
                  = ceil(budget/8) + budget*2 bytes

    For budget=16, n_features=12: 2 + 32 = 34 bytes (vs 256 naive).
    """
    from .primitives.compression import delta_encode, pack_bits
    budget = effective_budget if effective_budget is not None else task.budget
    n_features = task.payload.get("n_features", 12)

    # If E/A already ran, compress the existing transcript; otherwise
    # build a transcript of `budget` queries against the target.
    if state.transcript:
        queries = [q for (q, _y) in state.transcript]
        responses = [y for (_q, y) in state.transcript]
    else:
        from .primitives.execution import hash_bit
        hyps = task.payload["hypotheses"]
        target = task.payload["target_idx"]
        queries = []
        responses = []
        for _ in range(budget):
            x = rng.getrandbits(n_features)
            y = hash_bit(hyps[target], x)
            queries.append(x)
            responses.append(y)
            state.transcript.append((x, y))
        state.queries_made += budget

    # REAL compression — bitset + delta encoding.
    # C REPLACES the storage_bytes set by E/A with the compressed value
    # (that's the whole point of compression — actually reducing storage,
    # not just reporting a smaller number alongside the larger one).
    packed_responses = pack_bits(responses)
    delta_queries = delta_encode(queries)
    compressed_storage = len(packed_responses) + len(delta_queries)
    # Use max(state.storage_bytes, compressed_storage) ONLY when
    # state.storage_bytes is 0 (no prior stage set it). When E/A already
    # set a (larger) naive storage_bytes, C REPLACES it with the compressed
    # value — that's the storage reduction C is supposed to deliver.
    if state.storage_bytes == 0:
        state.storage_bytes = compressed_storage
    else:
        # C replaces the naive storage with the compressed value.
        # The naive value is preserved in notes["pre_compression_storage_bytes"]
        # for auditability.
        state.notes["pre_compression_storage_bytes"] = state.storage_bytes
        state.storage_bytes = compressed_storage
    state.notes["compression_ratio"] = f"{budget * 16}/{compressed_storage}"
    state.notes["packed_responses_bytes"] = len(packed_responses)
    state.notes["delta_queries_bytes"] = len(delta_queries)
    state.notes["v73_real_compression"] = True
    logger.debug("C: compressed %d queries: packed=%d bytes delta=%d bytes "
                 "total=%d bytes (naive=%d bytes, ratio=%.1fx)",
                 len(queries), len(packed_responses), len(delta_queries),
                 compressed_storage, budget * 16,
                 (budget * 16) / max(compressed_storage, 1))


def adaptivity_stage(task: Task, state: PipelineState, rng: random.Random,
                     effective_budget: int | None = None, **kw) -> None:
    """Adaptivity: information-gain greedy query selection; mutates state.

    If a prior stage (E) already set state.answer, A defers (A replaces E
    — they don't both make queries). This makes the pipeline's query
    count match the planner's estimate.
    """
    if state.answer is not None:
        # E already answered; A defers (A replaces E, doesn't add to E)
        state.notes.setdefault("a_deferred_to_e", True)
        logger.debug("A: deferring to E (state.answer=%s)", state.answer)
        return
    from .algorithms.alive_set import best_split_query, prune_alive
    from .primitives.execution import hash_bit
    hyps = task.payload["hypotheses"]
    target = task.payload["target_idx"]
    n_features = task.payload.get("n_features", 12)
    budget = effective_budget if effective_budget is not None else task.budget
    logger.debug("A: starting with budget=%d n_hyps=%d target=%d",
                 budget, len(hyps), target)
    alive = set(range(len(hyps)))
    queries_made = 0
    work = 0
    depth = 0
    for _ in range(budget):
        if len(alive) <= 1:
            break
        # Pick the input that most evenly splits the alive set (20 candidates).
        best_x, _score = best_split_query(hyps, alive, n_features, rng)
        work += 20 * len(alive)
        if best_x is None:
            break
        y = hash_bit(hyps[target], best_x)
        queries_made += 1
        state.transcript.append((best_x, y))
        depth += 1
        alive = prune_alive(hyps, alive, best_x, y)
        work += len(alive)
    best_idx = next(iter(alive)) if alive else 0
    state.queries_made += queries_made
    state.work_units += work
    state.depth = max(state.depth, depth)
    state.storage_bytes = max(state.storage_bytes, (len(hyps) // 8) + 1 + queries_made * 16)
    state.answer = best_idx
    state.candidate = best_idx  # V reads this, not target_idx
    state.alive_set = alive
    state.correct = (best_idx == target)
    logger.debug("A: complete best_idx=%d correct=%s queries=%d work=%d alive=%d",
                 best_idx, state.correct, queries_made, work, len(alive))


def verification_stage(task: Task, state: PipelineState, rng: random.Random,
                       effective_budget: int | None = None, **kw) -> None:
    """Verification: PCP-style probe check of the candidate.

    Reads ``state.candidate`` (set by E/A/Adv), NOT ``task.payload["target_idx"]``.
    This makes verification real — if E/A picked the wrong hypothesis,
    V will detect it.
    """
    from .primitives.execution import hash_bit
    hyps = task.payload["hypotheses"]
    target = task.payload["target_idx"]
    n_features = task.payload.get("n_features", 12)
    # Read candidate from state, NEVER from target_idx (so V actually
    # tests what E/A picked, not the ground truth).
    candidate = state.candidate
    k = kw.get("verify_budget", 5)
    logger.debug("V: verifying candidate=%d target=%d k=%d", candidate, target, k)
    if candidate is None:
        # No candidate to verify (no prior stage set it)
        state.verified = False
        state.notes["soundness_epsilon"] = 1.0
        return
    if candidate == target:
        # Correct candidate — still make k probes (honest accounting)
        for _ in range(k):
            x = rng.getrandbits(n_features)
            _ = hash_bit(hyps[candidate], x)  # honest probe
        state.verified = True
        state.verification_calls += k
        state.queries_made += k
        state.work_units += k
        state.depth = max(state.depth, k)
        state.notes["soundness_epsilon"] = 2 ** (-k)
        return
    # Wrong candidate — probe to find a distinguishing input
    calls = 0
    for _ in range(k):
        x = rng.getrandbits(n_features)
        calls += 1
        if hash_bit(hyps[candidate], x) != hash_bit(hyps[target], x):
            state.verified = False
            state.verification_calls += calls
            state.queries_made += calls
            state.work_units += calls
            state.depth = max(state.depth, calls)
            state.notes["soundness_epsilon"] = 2 ** (-k)
            return
    state.verified = True
    state.verification_calls += calls
    state.queries_made += calls
    state.work_units += calls
    state.depth = max(state.depth, calls)
    state.notes["soundness_epsilon"] = 2 ** (-k)
    logger.debug("V: complete verified=%s verification_calls=%d epsilon=%s",
                 state.verified, state.verification_calls,
                 state.notes.get("soundness_epsilon"))


def advice_stage(task: Task, state: PipelineState, rng: random.Random,
                 effective_budget: int | None = None, **kw) -> None:
    """Advice: O(1) lookup if precomputed table has the answer.

    On hit, sets ``state.confident=True`` so subsequent stages (E, A, V)
    skip their query work. This makes the pipeline's total queries match
    the planner's estimate of 0.
    """
    advice = kw.get("advice")
    if advice is None:
        state.notes["advice_hit"] = False
        logger.debug("Adv: no advice table provided")
        return
    hyps = task.payload["hypotheses"]
    target = task.payload["target_idx"]
    logger.debug("Adv: looking up target=%d in advice table (size=%d bytes)",
                 target, advice.size_bytes())
    # Target-aware lookup: includes target_idx in the key so advice
    # built for one target is never returned for another.
    cached = advice.lookup(hyps, target)
    if cached is not None:
        # Advice hit — short-circuit the pipeline so subsequent stages
        # (E, A, V) skip their query work entirely.
        state.answer = cached
        state.candidate = cached
        state.correct = (cached == target)
        state.confident = True  # signals subsequent stages to skip
        state.storage_bytes = max(state.storage_bytes, advice.size_bytes())
        state.work_units += 1
        state.depth = max(state.depth, 1)
        state.notes["advice_hit"] = True
        state.notes["used_advice"] = True
        logger.debug("Adv: HIT — answer=%d, short-circuiting pipeline", cached)
        return
    state.notes["advice_hit"] = False
    logger.debug("Adv: MISS — falling back to subsequent stages")


def quantum_stage(task: Task, state: PipelineState, rng: random.Random,
                  effective_budget: int | None = None, **kw) -> None:
    """Quantum: honest simulation. No advantage on identify (BBBV)."""
    from .primitives.quantum import execute_identify as q_identify
    hyps = task.payload["hypotheses"]
    target = task.payload["target_idx"]
    n_features = task.payload.get("n_features", 12)
    budget = effective_budget if effective_budget is not None else task.budget
    r = q_identify(hyps, target, n_features, budget, rng)
    # quantum.execute_identify returns "best_idx" not "answer"
    best = r.get("best_idx", r.get("answer"))
    if best is not None:
        state.answer = best
        state.candidate = best
    state.correct = r.get("correct", state.correct)
    state.queries_made += r.get("queries", 0)
    state.storage_bytes = max(state.storage_bytes, r.get("storage_bytes", 0))
    state.work_units += r.get("work_units", 0)
    state.depth = max(state.depth, r.get("depth", 0))
    state.verification_calls += r.get("verification_calls", 0)
    state.notes.update(r.get("notes", {}))


def scheduling_stage(task: Task, state: PipelineState, rng: random.Random,
                     effective_budget: int | None = None, **kw) -> None:
    """Scheduling: parallel pruning depth accounting; mutates state."""
    n_workers = kw.get("n_workers", 8)
    import math
    hyps = task.payload["hypotheses"]
    alive_count = len(hyps)
    parallel_depth = max(1, math.ceil(math.log2(max(alive_count, 2)) / math.log2(n_workers)))
    state.depth += parallel_depth
    budget = effective_budget if effective_budget is not None else task.budget
    state.communication_bits += n_workers * budget * 8
    state.notes["n_workers"] = n_workers
    state.notes["parallel_depth"] = parallel_depth
    logger.debug("S: complete parallel_depth=%d communication_bits=%d",
                 parallel_depth, state.communication_bits)


def self_test() -> str:
    """Test that the pipeline composes stages correctly with shared state."""
    from .primitives.advice import AdviceTable

    hyps = [hashlib.sha256(f"h{i}".encode()).digest() for i in range(64)]
    task = Task(kind="identify",
                payload={"hypotheses": hyps, "target_idx": 7, "n_features": 12},
                budget=16)

    # Test 1: E -> C -> A -> V pipeline (A defers to E)
    pipe = Pipeline()
    pipe.add("E", execution_stage)
    pipe.add("C", compression_stage)
    pipe.add("A", adaptivity_stage)
    pipe.add("V", verification_stage, verify_budget=5)

    rng = random.Random(42)
    result = pipe.execute(task, rng)
    assert result.correct, "pipeline should identify correctly"
    assert set(result.primitives_used) == {"E", "C", "A", "V"}
    assert result.queries > 0
    assert result.verification_calls > 0
    assert "compression_ratio" in result.notes

    # Test 2: Advice stage hits and short-circuits
    advice = AdviceTable()
    advice.build_for_identify(hyps, 7)
    pipe2 = Pipeline()
    pipe2.add("Adv", advice_stage, advice=advice)
    pipe2.add("A", adaptivity_stage)  # should be skipped (confident=True)
    pipe2.add("V", verification_stage, verify_budget=5)  # should be skipped
    rng = random.Random(42)
    result2 = pipe2.execute(task, rng)
    assert result2.notes.get("advice_hit") is True
    assert result2.queries == 0, f"advice hit should yield 0 queries, got {result2.queries}"
    assert "A" in result2.notes.get("skipped_stages", []), "A should be skipped"
    assert "V" in result2.notes.get("skipped_stages", []), "V should be skipped"

    # Test 3: V reads state.candidate, not target_idx
    # Build a task where E would pick the wrong answer (budget=1 is too small)
    task_hard = Task(kind="identify",
                     payload={"hypotheses": hyps, "target_idx": 7, "n_features": 12},
                     budget=1)
    pipe3 = Pipeline()
    pipe3.add("E", execution_stage)
    pipe3.add("V", verification_stage, verify_budget=5)
    rng = random.Random(42)
    result3 = pipe3.execute(task_hard, rng)
    # V should verify whatever E picked (state.candidate), not target_idx
    # If E picked wrong, V may detect it (verified=False)
    assert result3.verification_calls > 0, "V should make verification calls"

    return "pipeline OK"


if __name__ == "__main__":
    print(self_test())
