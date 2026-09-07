# SRS — Quick Start (5 Minutes)

## Install

```bash
git clone https://github.com/your-org/srs-sovereign-runtime-substrate.git
cd srs-sovereign-runtime-substrate
pip install -r requirements.txt -r requirements-dev.txt
```

## Verify

```bash
make test          # 399 tests pass (~80 seconds)
make compile-c     # C isolation engine + 12 unit tests
make prove-safety  # Z3 formal proof (¬safety → UNSAT)
```

## Run Your First Mutation

```python
from governance.identity import IdentityProvider, Role, Permission
from governance.audit import AuditChain
from governance.policy import default_policy_set, Effect
from governance.cost import CostTracker
from governance.sqa_aggregator import SQAAggregator, Validator, ValidatorVerdict, Verdict, ValidatorType
from governance.seg_controller import SEGController, Mutation

# 1. Set up identity + audit + policy + cost
idp = IdentityProvider()
idp.create_tenant("my-company")
idp.create_identity("agent-001", "my-company", Role.AGENT, "My Agent")
key_id, plaintext = idp.issue_api_key("agent-001")
ctx = idp.authenticate(plaintext)

audit = AuditChain()
policy = default_policy_set()
cost = CostTracker()

# 2. Set up governance (SQA quorum + SEG admission gate)
sqa = SQAAggregator()
seg = SEGController(sqa)
seg.set_epoch(1)

# Register 3 validators (formal + empirical + heuristic)
for vid, vtype in [("z3-01", ValidatorType.FORMAL),
                    ("emp-02", ValidatorType.EMPIRICAL),
                    ("heu-03", ValidatorType.HEURISTIC)]:
    sqa.register_validator(Validator(vid, vtype, 0))

# 3. Submit a mutation
verdicts = [
    ValidatorVerdict(Validator("z3-01", ValidatorType.FORMAL, 0), Verdict.ADMIT, 0.95, "Z3 ok", ""),
    ValidatorVerdict(Validator("emp-02", ValidatorType.EMPIRICAL, 0), Verdict.ADMIT, 0.88, "HIL ok", ""),
    ValidatorVerdict(Validator("heu-03", ValidatorType.HEURISTIC, 0), Verdict.ADMIT, 0.81, "ok", ""),
]

mutation = Mutation(
    mutation_id="mut-001",
    description="FPGA clock tree rebalance",
    risk_class="medium",
    evidence_chain={
        "admissible": True, "seq": 1,
        "sqa_certificate_ref": "quorum:self#bls_evidence_binding",
        "z3_witness_hash": "sha256:abc123",
    },
    z3_witness_hash="sha256:abc123",
    validators=verdicts,
)

# 4. Check policy + cost before SEG evaluation
policy_ctx = {
    "request_tenant": "my-company",
    "resource_tenant": "my-company",
    "action": "mutation:submit",
    "risk_class": "medium",
}
assert policy.evaluate(policy_ctx) == Effect.ALLOW
assert cost.can_spend("my-company", "agent-001", "seg_admission")

# 5. SEG evaluates (5 mandatory checks)
decision = seg.evaluate(mutation)
print(f"Mutation admissible: {decision.admissible}")
print(f"Reason: {decision.reason}")

# 6. Record in audit trail
audit.append("my-company", "agent-001", "mutation:submit", "mut-001",
             outcome="success" if decision.admissible else "denied")
cost.record("my-company", "agent-001", "seg_admission")

# 7. Verify audit trail integrity
assert audit.verify()
print(f"Audit trail: {len(audit.events)} events, valid: {audit.verify()}")
```

## Enterprise Deploy

```bash
# Docker (includes gcc + rustc + clang + libbpf)
make docker

# Inside the container:
docker run --rm srs-sovereign-runtime-substrate:latest make test
```

## What You Get

| Capability | How |
|-----------|-----|
| **Formal safety proof** | `python3 verification/z3_power_proof.py --prove-safety` |
| **TLA+ verified scheduler** | `verification/TemporalBankerScheduler.tla` (220K states, 0 violations) |
| **BLS12-381 governance** | `governance/bls_signatures.py` (real pairing crypto) |
| **Mutation testing** | `python3 scripts/mutation_test.py` (100% kill score) |
| **96.8% test coverage** | `make coverage` |
| **0 mypy errors** | `make static-analysis` |
| **Tamper-evident audit** | `governance/audit.py` (SHA-256 hash chain) |
| **Policy engine** | `governance/policy.py` (RBAC + tenant isolation + rate limit) |
| **Cost tracking** | `governance/cost.py` (per-operation budget enforcement) |
