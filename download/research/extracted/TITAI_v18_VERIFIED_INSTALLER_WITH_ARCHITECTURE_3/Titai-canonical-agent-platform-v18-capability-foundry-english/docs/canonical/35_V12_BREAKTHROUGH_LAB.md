# TITAI v12 Breakthrough Engineering Lab

Ten repository-grounded hypotheses were evaluated with explicit success and kill criteria.

## BH-001 — Verification-aware model routing
- **Mechanism:** Weight measured verifier quality and model health for review tasks.
- **Expected benefit:** Reduce weak-review selection.
- **Failure mode:** Self-reported scores may be inaccurate.
- **Experiment:** Compare verifier-task selection under competing builder and verifier profiles.
- **Success:** Eligible high-verification model wins deterministically.
- **Kill criterion:** Routing remains unchanged or selects unavailable model.
- **Cost / risk:** low / low
- **Status:** `implemented_tested`

## BH-002 — Task risk-adjusted autonomy
- **Mechanism:** Derive autonomy from risk, effect, idempotency, reversibility, evidence, and human authority.
- **Expected benefit:** Increase safe autonomy for reads while constraining dangerous effects.
- **Failure mode:** Scoring can create false precision.
- **Experiment:** Challenge dry-run writes, external effects, low-risk reads, and prompt-derived authority.
- **Success:** Unsafe cases deny or require human control; bounded reads remain autonomous.
- **Kill criterion:** Any prompt-derived authority or dry-run side effect is permitted.
- **Cost / risk:** low / medium
- **Status:** `implemented_tested`

## BH-003 — Evidence-weighted agent planning
- **Mechanism:** Prefer plans whose steps declare evidence and verification outputs.
- **Expected benefit:** Reduce untestable work.
- **Failure mode:** Agents may game evidence declarations.
- **Experiment:** Compare completion correctness on equal-length plans with and without evidence requirements.
- **Success:** Higher verified-task rate without excessive latency.
- **Kill criterion:** More ceremony without higher verification rate.
- **Cost / risk:** medium / medium
- **Status:** `designed`

## BH-004 — Counterfactual recovery simulation
- **Mechanism:** Simulate failure at each checkpoint before approving a high-risk workflow.
- **Expected benefit:** Expose unrecoverable paths before execution.
- **Failure mode:** Simulation model may omit real side effects.
- **Experiment:** Compare predicted recovery action with injected-failure outcomes.
- **Success:** No unsafe-retry mismatch across the selected matrix.
- **Kill criterion:** Predictions diverge materially from injected outcomes.
- **Cost / risk:** medium / low
- **Status:** `designed`

## BH-005 — Memory confidence decay
- **Mechanism:** Reduce authority as evidence ages or conflicts accumulate.
- **Expected benefit:** Lower stale-memory influence.
- **Failure mode:** Valuable stable facts may decay unnecessarily.
- **Experiment:** Evaluate stale and corrected memories over simulated time.
- **Success:** Lower contradiction rate without unacceptable recall loss.
- **Kill criterion:** Recall loss exceeds safety benefit.
- **Cost / risk:** medium / medium
- **Status:** `proposed`

## BH-006 — Reconciliation-first tool protocol
- **Mechanism:** Persist intent before ambiguous external effects and require resolver-specific reconciliation.
- **Expected benefit:** Avoid blind retries after uncertain outcomes.
- **Failure mode:** Many tools cannot query effect status.
- **Experiment:** Inject timeout after remote acceptance and compare retry behavior.
- **Success:** No duplicate effect and explicit operator action when status is unknowable.
- **Kill criterion:** Protocol still retries blindly.
- **Cost / risk:** high / medium
- **Status:** `partially_implemented`

## BH-007 — Adaptive context knapsack
- **Mechanism:** Optimize context under token budget while reserving mandatory policy and evidence slots.
- **Expected benefit:** Lower cost and contamination.
- **Failure mode:** Utility estimates may be wrong.
- **Experiment:** Ablate fixed, semantic, and governed adaptive context.
- **Success:** Equal or better correctness with lower token cost and unsafe selection.
- **Kill criterion:** Correctness falls or policy context is displaced.
- **Cost / risk:** medium / medium
- **Status:** `partially_implemented`

## BH-008 — Signed verifier worker
- **Mechanism:** Execute tests in a clean checkout and sign hashes with an independent service identity.
- **Expected benefit:** Make verification hard to fake.
- **Failure mode:** Signing infrastructure becomes a privileged bottleneck.
- **Experiment:** Attempt stale-source and replaced-artifact verification.
- **Success:** Mismatched hashes are rejected and signatures verify offline.
- **Kill criterion:** Service can attest mutable or unexecuted evidence.
- **Cost / risk:** high / high
- **Status:** `proposed`

## BH-009 — Energy-aware local-first routing
- **Mechanism:** Include measured energy and idle cost in the routing Pareto frontier.
- **Expected benefit:** Improve sovereign efficiency.
- **Failure mode:** Energy estimates may be too coarse.
- **Experiment:** Measure fixed local workloads on representative hardware.
- **Success:** Lower energy per verified task without quality regression.
- **Kill criterion:** Measurement noise dominates decisions.
- **Cost / risk:** medium / low
- **Status:** `designed`

## BH-010 — Operator uncertainty visualization
- **Mechanism:** Represent evidence gaps, unknowns, and reconciliation as first-class visual states.
- **Expected benefit:** Reduce false confidence and unsafe retries.
- **Failure mode:** Additional signals may increase cognitive load.
- **Experiment:** Timed walkthrough comparing status-only and evidence-control interfaces.
- **Success:** Faster correct identification of next safe action.
- **Kill criterion:** No comprehension gain or higher operator error.
- **Cost / risk:** medium / low
- **Status:** `implemented_partial`

## Selected experiments

- `BH-001`
- `BH-002`

## Decision
BH-001 and BH-002 were selected because they were low-cost, directly testable, reversible, and closed control gaps in active code. BH-008 was not selected because clean independent execution and signing infrastructure are unavailable in the current environment.

The two implemented experiments are verification-aware model routing and task risk-adjusted autonomy. Their evidence is limited to deterministic repository tests; field-quality improvement still requires measured production or controlled-pilot data.
