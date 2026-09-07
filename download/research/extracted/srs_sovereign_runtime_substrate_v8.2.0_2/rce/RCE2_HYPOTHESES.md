# RCE-2 Architectural Hypotheses — 10 New Substrate Inventions

**Document type:** Research hypotheses for computational reality substrates
**Status:** [HYPOTHESIZED] unless marked [IMPLEMENTED] / [TESTED]
**Constraint:** None of these are cache, memoization, retrieval, or normal ML prediction. Each is a distinct computational substrate.

---

## Preamble — The Space Being Explored

RCE-2's central question: can a *smaller computational reality* reproduce the *outputs* of a larger computation by learning the *laws* that generate those outputs, rather than the outputs themselves?

The 10 hypotheses below each propose a *different kind of law* — a different primitive that a computational world model can use to predict without executing. They are mutually distinct: each rests on a different mathematical structure (topology, algebra, category, logic, dynamics, information theory).

For each hypothesis:
- **Mechanism** — what the substrate actually does
- **Mathematical model** — formal definition
- **Implementation plan** — how to build it
- **Falsification test** — how to prove it does not work

---

## H1 — Topological Manifold Substrate

### Mechanism
Treat the input space not as ℝᵈ but as a low-dimensional manifold ℳ embedded in ℝᵈ. The computation's output is a smooth function on ℳ. Most of the apparent dimensionality is gauge redundancy — the true intrinsic dimension is dim(ℳ) ≪ d.

### Mathematical model
Let φ: ℝᵈ → ℳ be the projection. The computation c: ℝᵈ → Y factors as c = g ∘ φ where g: ℳ → Y. We learn φ (via ISOMAP / Laplacian eigenmaps on observed states) and g (a low-degree polynomial on ℳ). Prediction: ĉ(x) = g(φ(x)).

The compression is real iff dim(ℳ) < d AND g has bounded Lipschitz constant on ℳ.

### Implementation plan
1. Collect N states s_i = (x_i, y_i).
2. Build k-NN graph on {x_i}; compute graph Laplacian L.
3. Take eigenvectors of L with smallest eigenvalues → embedding φ: ℝᵈ → ℝᵏ, k ≪ d.
4. Fit g on the embedded points.
5. Prediction: ĉ(x) = g(φ(x)); escalate if x is far from the manifold (large projection residual).

### Falsification test
If the true computation does not factor through a low-dim manifold (e.g. SHA-256 prefix), the projection residual will be O(1) for all inputs — RCE-2 must escalate on 100% of calls. If it claims to predict, the manifold is hallucinated.

---

## H2 — Causal Circuit Substrate

### Mechanism
Treat the computation as a Boolean / arithmetic circuit C. Learn a *causal abstraction* C̃ — a smaller circuit with the same input-output behavior on the observed distribution but with fewer gates. The compression is the gate reduction ratio |C̃| / |C|.

### Mathematical model
C: {0,1}ⁿ → {0,1}ᵐ. Causal abstraction: π: {0,1}ⁿ → {0,1}ᵏ (k < n) and C̃: {0,1}ᵏ → {0,1}ᵐ such that C = C̃ ∘ π on the support of the input distribution. We search for (π, C̃) minimizing |C̃| subject to consistency with observed (x, C(x)) pairs.

### Implementation plan
1. Observe pairs (x_i, C(x_i)).
2. For each candidate k = n-1, n-2, …: try to find π (a projection onto k input bits) and C̃ (a k-input Boolean function) consistent with all observations.
3. If found, prediction = C̃(π(x)); else escalate.

### Falsification test
A cryptographically mixed computation (AES, SHA) admits no nontrivial causal abstraction. The smallest valid π must have k = n. If RCE-2 reports k < n for AES, the abstraction is leaking key bits into the predictor.

---

## H3 — Algebraic Invariant Substrate

### Mechanism
Discover polynomial invariants P(x, y) = 0 that hold on all observed (input, output) pairs. The set of invariants defines an algebraic variety V ⊆ ℝᵈ × Y. To predict y for new x, solve the invariant system on the slice {x} × Y. If the slice is a single point, the prediction is unique; if multiple points, escalate.

### Mathematical model
Ideal I = ⟨P₁, P₂, …⟩ ⊆ ℝ[x, y]. Variety V(I) = {(x, y) : P(x, y) = 0 ∀ P ∈ I}. Prediction: y(x) = the unique y with (x, y) ∈ V(I), if unique; else escalate.

Compute I via Gröbner basis reduction on observed pairs.

### Implementation plan
1. Collect (x_i, y_i) pairs.
2. Build monomial features up to degree δ.
3. Find null space of feature matrix → polynomial relations P_k.
4. For prediction: substitute x, solve for y in the resulting zero-dimensional system.

### Falsification test
On a computation with no polynomial structure (e.g. modular exponentiation), the only invariant is the trivial 0 = 0; the variety is the full product space; prediction is never unique → 100% escalation. If RCE-2 predicts, the polynomial degree was too high and overfit the training set.

---

## H4 — Category-Theoretic Rewriting Substrate

### Mechanism
Treat computations as morphisms in a category 𝒞. Discover rewrite rules α: f ⇒ g that replace an expensive morphism f with an equivalent cheaper morphism g. The compression is the ratio of execution costs ∑ cost(f) / ∑ cost(g) over the workload.

### Mathematical model
𝒞 = (Obj, Hom). Equational theory E over Hom. For each f ∈ Hom, find g with f ≡_E g and cost(g) < cost(f). Prediction: replace f by g, execute g.

The laws are the rewrite rules; the states are morphism equivalence classes [f]_E.

### Implementation plan
1. Symbolic representation of computations as morphism terms.
2. Enumerate rewrite candidates (fusion, deforestation, partial evaluation).
3. Verify equivalence by checking on a finite test set; if verified, install as a rewrite.
4. At runtime: normalize the incoming term using installed rewrites; execute the normal form.

### Falsification test
If two computations are equivalent under E but produce different outputs on any input, the rewrite is invalid. Falsification: maintain a held-out verification set; any rewrite that fails verification is rejected, and the rate of rejected rewrites is reported as the substrate's honesty metric.

---

## H5 — Dynamical Systems Substrate

### Mechanism
Treat the computation as the time-evolution of a dynamical system ẋ = F(x). The output is a Poincaré section — the value of x at the next intersection with a hyperplane. The compression is replacing a long trajectory integration with a learned section map P: section → section.

### Mathematical model
State x(t) ∈ ℝⁿ, dynamics ẋ = F(x). Poincaré section Σ = {x : h(x) = 0}. Section map P: Σ → Σ, P(x) = next intersection of trajectory from x with Σ. If F has a low-dimensional attractor (slow manifold), P factors through that attractor and is cheap to evaluate.

### Implementation plan
1. Instrument the computation to expose intermediate state snapshots.
2. Estimate F via SINDy (sparse regression on candidate library).
3. Identify the slow manifold via POD/DMC.
4. Learn the section map P on the slow manifold.
5. Predict: project initial state onto slow manifold, apply P, read off output.

### Falsification test
For a chaotic system (Lorenz with default parameters), the section map has positive Lyapunov exponent — small input perturbations produce exponentially diverging outputs. RCE-2 cannot predict beyond the predictability horizon; it must escalate. If it predicts accurately past the horizon, the model is overfit.

---

## H6 — Information-Theoretic Sufficient-Statistic Substrate

### Mechanism
For a family of computations {c_θ : θ ∈ Θ} parameterized by θ, find a sufficient statistic T(x) such that the output y = c_θ(x) depends on x only through T(x). The compression is dim(T) / dim(x).

### Mathematical model
By the Fisher-Neyman factorization: c_θ(x) = h(T(x), θ) for some h. Then prediction factors as ĉ_θ(x) = h(T(x), θ). The sufficient statistic T is the smallest summary of x that preserves the output.

Compute T by minimizing mutual information I(X; Y | T(X)) subject to dim(T) ≤ k.

### Implementation plan
1. Sample (x, y, θ) triples.
2. For each candidate k = 1, 2, …: train a neural compressor T_k: ℝᵈ → ℝᵏ.
3. Measure I(X; Y | T_k(X)) — should be ≈ 0 when k is large enough.
4. Use the smallest k that achieves I < ε.

### Falsification test
A universal hash function has no sufficient statistic of dimension < d (every input bit carries independent output information). If RCE-2 reports a low-dim T for a hash, the mutual information estimate is biased.

---

## H7 — Probabilistic Program Substrate

### Mechanism
Treat the computation as a probabilistic program with latent variables z. The output y = c(x) is the mode (or posterior mean) of p(y | x, z) marginalized over z. Learn the program structure and the posterior; predict via posterior mode without executing the original sampler.

### Mathematical model
Joint p(x, z, y) = p(x) p(z | x) p(y | x, z). Output ĉ(x) = argmax_y ∫ p(y | x, z) p(z | x) dz. Learn p(y | x, z) and p(z | x) via variational inference.

### Implementation plan
1. Observe (x_i, y_i) pairs.
2. Posit latent z with dim(z) ≪ dim(x).
3. Train encoder q(z | x) and decoder p(y | x, z) via VAE-style training.
4. Predict: ĉ(x) = E_z [p(y | x, z)] using the trained decoder.

### Falsification test
If the computation is deterministic and the latent is forced to be low-dim, the reconstruction loss will plateau above zero — RCE-2 must escalate on every input where reconstruction error exceeds threshold. If it predicts anyway, it has crossed into "normal ML prediction" territory (forbidden).

---

## H8 — Modal Logic Substrate

### Mechanism
Encode the computation's preconditions and effects in modal logic: □φ means "after this computation, φ holds in all reachable worlds." The compression replaces concrete execution with theorem proving in the modal logic.

### Mathematical model
Kripke frame (W, R) where W = world states, R = computation transitions. Computation c is a modality [c]φ. Prediction: query whether [c]φ holds at the current world w. If derivable from axioms, the answer is yes; if refutable, no; otherwise escalate.

### Implementation plan
1. Axiomatize the computation domain: preconditions, postconditions, monotonicity.
2. Build a tableau prover for the modal logic K + domain axioms.
3. For each prediction query: invoke the prover with a budget; if proven, predict; if refuted, predict negation; if undecided, escalate.

### Falsification test
For computations outside the axiomatized theory (e.g. floating-point ops with rounding), the prover will return "undecided" on most queries — RCE-2 must escalate. If it confidently predicts, the axiomatization is unsound.

---

## H9 — Symmetry Group Substrate

### Mechanism
Discover the symmetry group G of the computation: transformations g: x ↦ g·x that leave the output invariant, c(g·x) = c(x). Predict by quotienting — replace x with its orbit [x]_G, predict from the orbit representative.

### Mathematical model
Group G acts on input space. Orbit [x] = {g·x : g ∈ G}. Output factors as c(x) = ĉ([x]) for some ĉ: X/G → Y. Compression: dim(X/G) < dim(X) when G is nontrivial.

Discover G by finding transformations that map observed (x_i, y_i) to (x_j, y_i) — same output → likely same orbit.

### Implementation plan
1. Cluster inputs by output.
2. Within each cluster, fit a Lie group generator (continuous) or permutation group (discrete) that maps members to each other.
3. Define orbit representatives via a fundamental domain.
4. Predict: compute orbit of x, find representative, apply ĉ.

### Falsification test
A computation with no nontrivial symmetry (e.g. AES with random key) has trivial G = {e}, so dim(X/G) = dim(X) — no compression. If RCE-2 reports compression, it has found spurious symmetries that fail on held-out inputs.

---

## H10 — Game-Theoretic Equilibrium Substrate

### Mechanism
For computations that arise from multi-agent interactions (auctions, markets, protocol negotiations), the output is an equilibrium of a game. Learn the game's payoff structure and compute equilibria directly — bypassing the simulation of all agents' reasoning.

### Mathematical model
Game Γ = (N, {Sᵢ}, {uᵢ}). Computation c(input) = equilibrium strategy profile. By Nash's theorem, equilibria exist; for many games they are unique and efficiently computable from payoffs. The compression replaces a long reasoning chain with a direct equilibrium solve.

### Implementation plan
1. Observe (input, output) pairs where output is an equilibrium.
2. Regress payoffs uᵢ from observed deviations.
3. For new input: instantiate game, solve for Nash equilibrium (Lemke-Howson / support enumeration).
4. Predict the equilibrium strategy.

### Falsification test
For games with multiple equilibria (e.g. coordination games), the substrate cannot uniquely predict without a refinement (e.g. risk-dominance). It must escalate on ambiguous inputs. If RCE-2 reports a single answer on a known-multi-equilibrium game, it has cherry-picked.

---

## Summary Table

| #  | Substrate              | Primitive                  | Compression source          |
|----|------------------------|----------------------------|-----------------------------|
| H1 | Topological manifold   | Manifold projection        | Gauge redundancy            |
| H2 | Causal circuit         | Causal abstraction π       | Irrelevant input bits       |
| H3 | Algebraic invariant    | Polynomial ideal / variety | Algebraic relations         |
| H4 | Category rewriting     | Equational rewrite α       | Equivalent cheaper morphism |
| H5 | Dynamical systems      | Poincaré section map       | Slow manifold reduction     |
| H6 | Sufficient statistic   | Fisher-Neyman T(x)         | Information bottleneck      |
| H7 | Probabilistic program  | Variational posterior      | Latent variable marginalization |
| H8 | Modal logic            | Kripke frame theorem       | Axiomatic derivability      |
| H9 | Symmetry group         | Orbit quotient X/G         | Equivariance                |
| H10| Game equilibrium       | Nash equilibrium solve     | Equilibrium shortcut        |

---

## What RCE-2 (current implementation) actually instantiates

RCE-2 as built is a *hybrid* of:
- **H1** (topological): k-NN consensus on feature space = local manifold
- **H2** (causal circuit): invariant discovery = find irrelevant input bits
- **H3** (algebraic): invariant registration = trivial polynomial relation (feature = const ⇒ outcome = const)
- **H6** (sufficient statistic): feature masking = T(x) = (x_{i₁}, …, x_{iₖ})

The remaining six (H4, H5, H7, H8, H9, H10) are *open* — they require new implementations beyond the current RCE-2 prototype. Each is a candidate for the next substrate layer.

---

## Falsification Discipline

Every hypothesis above has a falsification test. The rule is:

> If the substrate claims compression on a workload that has no compressible structure (cryptographic hash, random oracle, chaotic dynamics), the substrate is overclaiming and must be revised.

The adversarial test suite (`tests/test_rce2_adversarial.py`) operationalizes this discipline for H1, H2, H3, H6 — the four substrates that RCE-2 currently instantiates. The other six await implementation.
