# Quantitative Engineering and Breakthrough Playbook

This document forces architectural discussions into measurable hypotheses. Equations are
models, not facts. Every use must name assumptions, units, data sources, uncertainty, and
the decision that the result can change.

## 1. Quality-constrained system objective

Do not optimize a single metric. For workload `w` and configuration `x`, define:

```text
maximize    U(x,w) = Q - aL - bC - cE - dO
subject to  Safety >= S_min
            Privacy >= P_min
            Reliability >= R_min
            Quality >= Q_min
            Resource_i <= Budget_i
```

Where `Q` is task quality, `L` latency, `C` total cost, `E` full-system energy, and `O`
is operator effort. Coefficients are explicit policy choices. First discard configurations
that violate hard constraints; then compare the Pareto frontier. Never hide a safety or
privacy regression inside an averaged utility score.

## 2. Workload model

Every benchmark declares:

- Arrival process and burst shape.
- Task classes and their probability or observed frequency.
- Input, context, output, artifact, and tool-use sizes.
- Required quality and maximum failure cost.
- Locality, sensitivity, residency, and offline requirements.
- Hardware, software, model, quantization, and thermal state.

Use a workload vector:

```text
W = (arrival_rate, burst_factor, service_distribution, context_size,
     output_size, tool_calls, risk_class, quality_floor)
```

A benchmark without a named workload is not evidence for architecture.

## 3. Queueing and capacity

Start with measured service-time distributions. For a rough single-worker estimate:

```text
utilization rho = arrival_rate * mean_service_time
```

`rho >= 1` is unstable. High tail latency can occur well before that point. For a first-order
G/G/1 waiting-time estimate, use Kingman's approximation:

```text
Wq approximately = [rho / (1 - rho)] * [(Ca^2 + Cs^2) / 2] * mean_service_time
```

`Ca` and `Cs` are coefficients of variation for arrivals and service. Validate the estimate
with replay or load tests because model calls, batching, cold starts, and tool waits violate
simple queue assumptions.

Capacity experiments must report p50, p95, p99, throughput, queue depth, rejection,
timeouts, resource saturation, and quality under overload. Define admission control and
gracious degradation before adding workers.

## 4. DAG scheduling and critical path

Represent a run as a dependency graph. The theoretical minimum completion time is bounded
by the weighted critical path:

```text
T_min >= max_path sum(duration(node))
```

Estimate available parallelism as total work divided by critical-path work. Parallelize only
independent nodes. Shared context, rate limits, memory writes, approvals, and side effects are
explicit resources or dependencies. Detect cycles before execution. Apply per-node deadlines
and propagate cancellation.

## 5. Durable execution and checkpoint economics

For failure rate `lambda` and checkpoint overhead `C`, a first-order checkpoint interval is:

```text
interval approximately sqrt(2 * C / lambda)
```

This is only a starting model. Real experiments must include restore cost, checkpoint size,
side-effect replay, correlated failure, and non-memory state. A checkpoint is valid only if a
clean process can resume from it without duplicate side effects.

For each side effect, define an idempotency key, attempt identity, commit point, timeout,
retry class, compensation or rollback, and terminal-state rule. Fault injection occurs before
and after each commit boundary.

## 6. Reliability and error budgets

For a target availability `A_target` over window `T`:

```text
error_budget = T * (1 - A_target)
```

Track failure by class, not only aggregate success. Include wrong-success outcomes, duplicate
side effects, stuck approvals, unrecoverable runs, audit gaps, and silent data loss. Recovery
objectives specify RPO, RTO, restore success rate, and maximum operator steps. A backup is not
accepted until a clean restore drill passes.

## 7. Context engineering

Treat context as a scarce, permissioned cache. Candidate item `i` may be scored with a tested
function such as:

```text
score_i = wr*relevance + wt*trust + wp*provenance + wf*freshness
          + wu*expected_utility - wc*token_cost - wx*conflict_risk
```

Permission is a hard gate, not a score. The selected set solves a budgeted coverage problem:
maximize expected task value under token, latency, privacy, and contamination constraints.
Compare lexical, embedding, graph, recency, and hybrid selection against a no-retrieval
baseline. Test distractors, poisoned sources, conflicting versions, stale records, and cache
leakage across workspaces.

Compression is evaluated by answer quality and requirement retention, not compression ratio
alone. Keep source links and hashes so summaries can be challenged and rebuilt.

## 8. Governed memory

A memory candidate is promoted only when it has owner, purpose, provenance, confidence,
classification, retention, correction, supersession, and deletion semantics. One possible
promotion model is:

```text
promotion_value = expected_reuse * verified_quality * provenance_strength
                  - privacy_risk - staleness_risk - conflict_cost
```

Hard policy gates override the score. Measure useful-recall, harmful-recall, stale-recall,
false-memory rate, correction latency, deletion closure, cross-tenant leakage, and operator
burden. Deleting a source must invalidate every derived chunk, embedding, summary, cache,
index entry, and exported replica reachable from its provenance graph.

## 9. Model and provider routing

Maintain an empirical capability vector for each model configuration:

```text
M = (task_quality, tool_reliability, structured_output, context_limit,
     latency_distribution, memory_footprint, energy, cost, privacy,
     offline_support, license_constraints)
```

Routing is constrained selection, not a brand preference. A candidate is eligible only if it
passes policy, data locality, license, hardware, quality, and availability gates. Among eligible
candidates, choose using measured utility and uncertainty. Keep an exploration budget for
controlled experiments; do not explore on high-risk production work.

Use champion-challenger promotion. Require reproducible evaluation, regression bounds,
rollback, model and tokenizer hashes, prompt and skill versions, quantization, runtime, and
hardware profile. Detect drift with fixed anchor workloads plus representative recent workloads.

## 10. Adaptive reasoning controller

The controller chooses among direct execution, decomposition, retrieval, tool use, simulation,
critique, independent verification, escalation, clarification, or stop. Define state:

```text
S = (risk, ambiguity, novelty, reversibility, evidence_gap, uncertainty,
     remaining_time, remaining_tokens, remaining_calls, operator_budget)
```

Each action has expected information gain, task value, latency, risk, and resource cost. Stop
when acceptance criteria are met, the expected marginal value of another step is below its
cost, a hard budget is reached, or safe progress is impossible.

Never optimize hidden chain-of-thought length. Evaluate observable plans, evidence, artifacts,
checks, decisions, corrections, and outcomes. Compare direct, fixed-depth, adaptive, and
planner-builder-verifier modes under equal budgets.

## 11. Multi-agent coordination

Use role separation only when it improves measured outcomes. Define ownership of each artifact,
write locks or merge rules, message schemas, deadlines, cancellation, and a maximum delegation
depth. Prevent recursive delegation with ancestry and budget propagation.

Evaluate:

- Duplicate work ratio.
- Contradiction and merge failure rate.
- Critical-path latency.
- Communication overhead.
- Defect escape after verifier review.
- Quality gain versus a single-agent baseline at equal resource budget.

A verifier must receive the requirement and evidence, not the builder's confidence statement.
Use independent test generation or adversarial review for high-impact changes.

## 12. Capability and sandbox risk model

A capability is an explicit tuple:

```text
Capability = (identity, action, resource_scope, data_class, network_scope,
              side_effect_class, budget, approval, expiry, audit, rollback)
```

Risk can be prioritized with an FMEA-style score, while preserving hard policy gates:

```text
priority = likelihood * impact * exposure * irreversibility / detectability
```

Scores organize work; they never authorize it. Test argument smuggling, malicious descriptions,
indirect injection, output-to-command injection, confused deputy, stale approval, replay,
resource exhaustion, exfiltration, and escape. External MCP or A2A support stays behind the
internal capability, identity, policy, and audit boundary. See `SRC-MCP` and `SRC-A2A`.

## 13. Data lifecycle and provenance closure

Model provenance as a directed graph of entities, activities, and agents. See `SRC-W3C-PROV`.
Each transformation records source version and activity. A deletion or correction request runs
an impact query over all descendants, applies policy, rebuilds affected indexes, and emits a
verifiable completion report.

Measure deletion completeness, deletion latency, orphan derivative count, provenance coverage,
unattributed fact rate, and export/restore fidelity. Test partial failure during deletion and
replay until convergence.

## 14. Supply-chain decision model

Inventory source, version, hash, signature, provenance, build process, license, vulnerabilities,
maintainer health, transitive dependencies, model weights, datasets where known, tokenizer,
quantization, runtime, and deployment image. Use software and AI inventory formats where useful;
see `SRC-SLSA`, `SRC-SPDX`, `SRC-CYCLONEDX-MLBOM`, and `SRC-SIGSTORE`.

Promotion gates reject unknown provenance, failed signature or hash verification, incompatible
license, unacceptable vulnerability, missing rollback, or unrepeatable build. A popular package
is not automatically low risk.

## 15. Cost and local-versus-remote break-even

For period `T`, compare:

```text
local_total = hardware_amortization + electricity + storage + maintenance
              + operator_time + backup + incident_cost
remote_total = usage_fees + storage + egress + operator_time + integration
               + compliance + outage_and_exit_risk
```

The break-even workload is where expected totals are equal under the same quality and SLO.
Perform sensitivity analysis for utilization, electricity, hardware life, model efficiency,
remote price, and operator time. Include the value of offline availability and data control
explicitly rather than treating them as zero.

## 16. Energy measurement

For full-system power `P(t)`:

```text
energy_Wh = integral(P(t) dt) / 3600
quality_normalized_energy = energy_Wh / accepted_work_units
```

Measure idle baseline, warm-up, workload, cooldown, wall-clock duration, accepted quality,
throughput, thermal throttling, and hardware configuration. Report AC wall energy when possible;
label software counters as proxies. Follow comparable workload and quality rules inspired by
`SRC-MLPERF` rather than comparing unmatched models or outputs.

## 17. Experimental design

Each experiment has hypothesis, baseline, independent variables, controlled variables, fixtures,
metrics, minimum meaningful effect, stopping rule, adverse-event rule, analysis method, and
promotion decision. Use multiple seeds or repeated samples where nondeterminism matters. Report
distributions and confidence intervals, not only averages.

Required experiment families:

- Ablation: remove one component to test whether it creates value.
- Differential: compare implementations on identical fixtures.
- Metamorphic: transform input while preserving an expected invariant.
- Counterfactual: vary one decision condition and inspect outcome.
- Fault injection: kill, delay, corrupt, duplicate, partition, exhaust, or revoke.
- Adversarial: poison context, tools, memory, protocol metadata, and approvals.
- Shadow and replay: evaluate a challenger without controlling production actions.
- Sensitivity: vary uncertain inputs and identify dominant assumptions.

A negative result remains in the experiment ledger and prevents repeated speculation.

## 18. Breakthrough search loop

1. State the bottleneck in measurable terms.
2. Build a causal map and identify assumptions.
3. Establish the simplest reproducible baseline.
4. Generate at least three mechanisms, including one architecture-level alternative.
5. Derive predictions that distinguish the mechanisms.
6. Design the cheapest decisive experiment.
7. Run adversarial and failure cases before scale tests.
8. Update claims, confidence, ADRs, risks, and task dependencies.
9. Promote only a bounded vertical slice with rollback.
10. Search again at the new bottleneck; do not keep optimizing a solved layer.

## 19. Required quantitative evidence for major decisions

A high-impact ADR is incomplete unless it includes:

- Named workload and user outcome.
- Baseline and at least two alternatives, including “do nothing.”
- Assumptions and uncertainty ranges.
- Quality, safety, privacy, reliability, latency, resource, operator, cost, and energy effects.
- Failure modes and recovery.
- Sensitivity or scenario analysis.
- Experiment or prototype evidence.
- Migration, rollback, and replacement path.
- Decision expiry or review trigger.
