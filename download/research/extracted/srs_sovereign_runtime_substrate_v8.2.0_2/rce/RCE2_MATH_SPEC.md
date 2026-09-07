# RCE-2 Mathematical Specification

**Document type:** Formal mathematical specification
**Status:** [DERIVED] — all definitions are implemented in `rce/rce2.py` and verified by `tests/test_rce2.py` and `tests/test_rce2_adversarial.py`.

---

## 1. State Universe

### 1.1 Definition

The state universe is a typed family of state sets:

$$\mathcal{S} = \bigcup_{\tau \in \mathcal{T}} \mathcal{S}_\tau$$

where $\mathcal{T}$ is the set of computation types (e.g. `"seg"`, `"policy"`, `"hash"`) and each $\mathcal{S}_\tau \subseteq \mathbb{R}^d \times \mathcal{Y}$ is a set of *observed* states for that type.

A state $s \in \mathcal{S}_\tau$ is a tuple:

$$s = (\text{id}, \tau, \mathbf{x}, y, c, \kappa, u, t)$$

where:
- $\mathbf{x} \in \mathbb{R}^d$ — feature vector
- $y \in \mathcal{Y}$ — observed outcome
- $c \in [0,1]$ — compression score (fraction of features that are irrelevant)
- $\kappa \in [0,1]$ — confidence in the prediction
- $u \in [0,1]$ — uncertainty ($u = 1 - \kappa$)
- $t \in \mathbb{R}$ — timestamp

### 1.2 Feature extraction

For each computation type $\tau$, a feature map $\phi_\tau: \mathcal{C}_\tau \to \mathbb{R}^d$ maps a concrete computation $c \in \mathcal{C}_\tau$ to a feature vector. Feature extractors are hand-designed per type (see `extract_seg_features`, `extract_policy_features`).

The design constraint is that $\phi_\tau$ must be *causally relevant*: features should correspond to known or suspected determinants of the outcome. RCE-2 will *discover* which features are actually used.

---

## 2. Transition Laws

### 2.1 Definition

A transition law $L$ is a 6-tuple:

$$L = (\text{id}, \tau, M, \boldsymbol{\mu}, r, y, \kappa)$$

where:
- $M \subseteq \{0, 1, \ldots, d-1\}$ — feature mask (the features that matter)
- $\boldsymbol{\mu} \in \mathbb{R}^{|M|}$ — centroid in masked feature space
- $r \in \mathbb{R}_{>0}$ — radius
- $y \in \mathcal{Y}$ — predicted outcome
- $\kappa \in [0,1]$ — confidence

The law asserts:

$$\forall \mathbf{x} \in \mathbb{R}^d : \|\mathbf{x}_M - \boldsymbol{\mu}\|_2 \leq r \implies c(\mathbf{x}) = y \text{ with confidence } \kappa$$

where $\mathbf{x}_M = (x_i)_{i \in M}$ is the projection of $\mathbf{x}$ onto the masked coordinates.

### 2.2 Law application

Given a query $\mathbf{x}$, find any law $L$ whose region contains $\mathbf{x}_M$:

$$\text{queryLaws}(\tau, \mathbf{x}) = \begin{cases}
L & \text{if } \exists L \in \mathcal{L}_\tau : \|\mathbf{x}_M - \boldsymbol{\mu}_L\|_2 \leq r_L \\
\bot & \text{otherwise}
\end{cases}$$

### 2.3 Confidence semantics

The confidence $\kappa$ of a law is:

$$\kappa = \frac{|\{\text{states in the law's region}\}|}{|\mathcal{S}_\tau|}$$

i.e. the fraction of observed states that the law covers. A law with $\kappa = 0.05$ covers 5% of observed states — it is a local law, valid only where it applies.

---

## 3. Invariants

### 3.1 Definition

An invariant $I$ is a triple:

$$I = (M, \mathbf{v}, y)$$

where $M \subseteq \{0, \ldots, d-1\}$, $\mathbf{v} \in \mathbb{R}^{|M|}$, $y \in \mathcal{Y}$. The invariant asserts:

$$\forall \mathbf{x} \in \mathbb{R}^d : \mathbf{x}_M = \mathbf{v} \implies c(\mathbf{x}) = y \text{ with confidence } 1.0$$

Invariants are the *strongest* form of compression: they identify a feature subset that *determines* the outcome exactly.

### 3.2 Discovery

Single-feature invariants are discovered by:

$$\text{discover}(\tau) = \{(i), y) : \exists v \in \mathbb{R} : \forall s \in \mathcal{S}_\tau, s.\mathbf{x}_i = v \implies s.y = y \text{ and } |\{s : s.\mathbf{x}_i = v\}| \geq 5\}$$

The 5-sample minimum prevents spurious invariants from tiny clusters.

### 3.3 Confidence semantics (corrected)

The confidence of an invariant is:

$$\kappa = P(y = \hat{y} \mid \mathbf{x}_M = \mathbf{v}) = 1.0 \text{ whenever all matching states agree}$$

This is *not* coverage. A group of 5 states out of 1000 can still yield an invariant with confidence 1.0, valid for those 5 states' worth of inputs.

---

## 4. Consensus

### 4.1 Definition

Consensus is the weakest prediction mechanism. For a query $\mathbf{x}$:

$$\text{consensus}(\tau, \mathbf{x}, k) = \begin{cases}
(\hat{y}, \kappa) & \text{if } |\mathcal{S}_\tau| \geq k \text{ and } d_{\min} \leq d_{\max} \\
\bot & \text{otherwise}
\end{cases}$$

where:
- $d_{\min}$ is the distance from $\mathbf{x}$ to its nearest neighbor in $\mathcal{S}_\tau$
- $d_{\max}$ is the **out-of-distribution gate** (default 0.5)
- $\hat{y} = \arg\max_y \sum_{i \in N_k(\mathbf{x})} w_i \cdot \mathbb{1}[s_i.y = y]$
- $w_i = 1 / (d_i + \epsilon)$ — inverse-distance weight
- $\kappa = (\sum_{i \in N_k : s_i.y = \hat{y}} w_i) / (\sum_{i \in N_k} w_i)$

### 4.2 Out-of-distribution gate

The gate $d_{\max}$ prevents consensus from predicting when the query is far outside the training support. Without it, RCE-2 would apply training-region beliefs to inputs it has never seen — a serious honesty violation (cf. adversarial test 7).

---

## 5. Reality Simulator

### 5.1 Prediction cascade

The simulator's prediction is a 4-stage cascade:

$$\text{predict}(\tau, \mathbf{x}) = \begin{cases}
(I.\hat{y}, \text{INVARIANT}, 1.0) & \text{if } \exists I \in \mathcal{I}_\tau : \mathbf{x}_{I.M} = I.\mathbf{v} \\
(L.\hat{y}, \text{LAW}, L.\kappa) & \text{elif } \exists L \in \mathcal{L}_\tau : \|\mathbf{x}_{L.M} - L.\boldsymbol{\mu}\| \leq L.r \text{ and } L.\kappa \geq \kappa_{\min} \\
(\hat{y}, \text{CONSENSUS}, \kappa) & \text{elif } \text{consensus}(\tau, \mathbf{x}, k) = (\hat{y}, \kappa) \text{ and } \kappa \geq \kappa_{\min} \\
(c(\mathbf{x}), \text{ESCALATED}, 1.0) & \text{otherwise}
\end{cases}$$

The cascade is ordered by *strength*: invariants are strongest (zero uncertainty), then laws (region-bounded), then consensus (local vote), then escalation (ground truth).

### 5.2 Cost model

The cost of a prediction is:

$$\text{cost}(\tau, \mathbf{x}) = \begin{cases}
t_{\text{lookup}} & \text{INVARIANT} \\
t_{\text{lookup}} & \text{LAW} \\
t_{\text{lookup}} + t_{\text{knn}} & \text{CONSENSUS} \\
t_{\text{lookup}} + t_{\text{knn}} + c_{\text{original}}(\mathbf{x}) & \text{ESCALATED}
\end{cases}$$

where:
- $t_{\text{lookup}} \approx 1 \mu s$ (in-memory dict lookup)
- $t_{\text{knn}} \approx 10 \mu s$ for 100 states, linear scan
- $c_{\text{original}}$ is the cost of the original computation

### 5.3 Online learning

Every escalated prediction is *recorded* (added to $\mathcal{S}_\tau$) unless `record_outcome=False`. Every 10 escalations, laws and invariants are re-discovered. This is the *self-improvement* mechanism: RCE-2 gets better the more it runs.

---

## 6. Compression Discovery

### 6.1 Invariant discovery (single-feature)

For each feature $i$ and each observed value $v$:

$$\text{group}_i(v) = \{s \in \mathcal{S}_\tau : s.\mathbf{x}_i = v\}$$

$$\text{invariant}_i(v) = \begin{cases}
(\{i\}, v, y) & \text{if } |\text{group}_i(v)| \geq 5 \text{ and } |\{s.y : s \in \text{group}_i(v)\}| = 1 \\
\bot & \text{otherwise}
\end{cases}$$

### 6.2 Decision region discovery

For each state $s$ not already covered by an existing law:

1. Find neighbors $N_r(s) = \{s' \in \mathcal{S}_\tau : \|\mathbf{s}'.\mathbf{x} - s.\mathbf{x}\| \leq r\}$
2. If $|N_r(s)| \geq m_{\min}$ and all outcomes in $N_r(s)$ are equal to $\hat{y}$:
   - Create law $L = (\text{id}, \tau, \{0, \ldots, d-1\}, \text{centroid}(N_r(s)), r, \hat{y}, |N_r(s)|/|\mathcal{S}_\tau|)$
   - Mark all states in $N_r(s)$ as *claimed* — they will not seed new laws

The claiming step is the **anti-overfitting** mechanism: it prevents the law database from growing one-per-state.

### 6.3 Compression score

$$\text{compression}(\tau) = \frac{d - |\text{best invariant mask}|}{d}$$

where the best invariant is the one with the largest feature mask among discovered invariants. If no invariants are discovered, compression score is 0.

---

## 7. Theorems (verified by tests)

### Theorem 1 (Honest escalation)

*If the underlying computation is a random oracle, RCE-2 escalates on ≥ 50% of test inputs.*

**Proof sketch:** By the random-oracle property, no feature subset determines the outcome, so no invariant is discovered. Decision regions require ≥5 same-outcome neighbors within radius $r$; for a random oracle, the probability that 5 random points in $[0,1]^d$ fall within radius $r$ AND share the same random outcome is $O(r^d \cdot 0.5^5)$ — vanishingly small for reasonable $r$. Consensus requires $\kappa \geq 0.9$, but k-NN of random labels has $\kappa \to 0.5$ — below threshold. Hence the cascade falls through to escalation.

**Test:** `tests/test_rce2_adversarial.py::TestAttack1RandomOracle`

### Theorem 2 (No out-of-distribution prediction)

*If query $\mathbf{x}$ is farther than $d_{\max}$ from every training state, RCE-2 escalates.*

**Proof:** The consensus stage's out-of-distribution gate rejects any query with $d_{\min} > d_{\max}$. Laws require $\|\mathbf{x}_M - \boldsymbol{\mu}\| \leq r_L$ — but $\boldsymbol{\mu}$ is a centroid of training states, so $\|\mathbf{x}_M - \boldsymbol{\mu}\| \geq d_{\min} - r_L > d_{\max} - r_L$, which exceeds $r_L$ for reasonable parameters. Invariants require exact feature matches — impossible for OOD continuous features.

**Test:** `tests/test_rce2_adversarial.py::TestAttack7DistributionShift`

### Theorem 3 (Law economy)

*After law discovery, $|\mathcal{L}_\tau| / |\mathcal{S}_\tau| \leq 1/m_{\min}$.*

**Proof:** Each law claims at least $m_{\min}$ states (the minimum samples to form a law). Once claimed, states do not seed new laws. Therefore the number of laws is at most $|\mathcal{S}_\tau| / m_{\min}$, giving the ratio $\leq 1/m_{\min}$.

For $m_{\min} = 5$, the ratio is $\leq 0.2$.

**Test:** `tests/test_rce2_adversarial.py::TestAttack6LawExplosion`

### Theorem 4 (Verification updates statistics)

*If a prediction is wrong, `stats.law_incorrect` increments by 1.*

**Proof:** Direct from `verify_prediction` implementation — `correct = (predicted == actual_result)`, and the appropriate counter increments.

**Test:** `tests/test_rce2_adversarial.py::TestAttack9AdversarialInputs`

---

## 8. Complexity Analysis

### 8.1 Per-prediction cost

| Stage | Time complexity |
|-------|-----------------|
| Invariant query | $O(|\mathcal{I}_\tau| \cdot |M_{\max}|)$ |
| Law query | $O(|\mathcal{L}_\tau| \cdot d)$ |
| Consensus | $O(|\mathcal{S}_\tau| \cdot d)$ — linear scan |
| Escalation | $O(c_{\text{original}})$ |

With $|\mathcal{I}_\tau|, |\mathcal{L}_\tau| \ll |\mathcal{S}_\tau|$, the dominant cost is consensus ($O(N \cdot d)$) when it runs.

### 8.2 Discovery cost

| Operation | Time complexity |
|-----------|-----------------|
| Invariant discovery | $O(d \cdot N)$ — group by each feature |
| Decision region discovery | $O(N^2 \cdot d)$ — pairwise distances |
| Compression score | $O(d \cdot N)$ — reuse invariant discovery |

Discovery is $O(N^2 \cdot d)$ — quadratic in state count. For $N = 1000$, this is $10^6 \cdot d$ operations, ~1s in Python.

### 8.3 Memory

$$\text{memory} = O\left(|\mathcal{S}_\tau| \cdot d + |\mathcal{L}_\tau| \cdot d + |\mathcal{I}_\tau| \cdot |M_{\max}|\right)$$

For workloads where compression works, $|\mathcal{L}_\tau|, |\mathcal{I}_\tau| \ll |\mathcal{S}_\tau|$, so memory is dominated by state storage — same as a cache. But each state is *reused* across many predictions, so the per-prediction memory cost is amortized.

---

## 9. Limits ( honesty disclosure )

### 9.1 What RCE-2 cannot do

1. **Predict computations with no compressible structure.** SHA-256, AES, true random oracles — RCE-2 will escalate on 100% of calls. (Verified by W3, W4 workloads.)

2. **Predict far outside training support.** The out-of-distribution gate forces escalation when $d_{\min} > d_{\max}$. (Verified by W6 workload, Test 7.)

3. **Predict through sharp boundaries with wide-radius laws.** A law with radius $r$ that straddles a decision boundary will produce false positives. (Tested by Test 4 — RCE-2 must use small radii near boundaries.)

4. **Predict under heavy label noise.** With 5% label noise, no invariant will be discovered (groups won't be uniform); consensus will hover near 50% confidence. RCE-2 escalates. (Observed in W5 — accuracy was high only because the underlying law was learnable through the noise.)

### 9.2 What RCE-2 does NOT claim

1. **No "intelligence for free."** Every prediction is bounded by the confidence threshold and verified against ground truth on escalation.

2. **No "zero energy computation."** The cost model includes real wall-clock lookup and consensus costs.

3. **No "quantum equivalent."** RCE-2 is classical; it does not exploit any quantum structure.

4. **No claim of universality.** RCE-2 works only on workloads with compressible structure. The adversarial test suite enforces this.

---

## 10. Reference: File Inventory

| Artifact | Location |
|----------|----------|
| Core implementation | `rce/rce2.py` |
| Functional tests | `tests/test_rce2.py` (18 tests, all passing) |
| Adversarial tests | `tests/test_rce2_adversarial.py` (12 tests, all passing) |
| Experiment runner | `scripts/run_rce2_experiments.py` |
| Experiment results | `rce/rce2_experiment_results.json` |
| Architectural hypotheses | `rce/RCE2_HYPOTHESES.md` |
| This specification | `rce/RCE2_MATH_SPEC.md` |
