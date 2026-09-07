# SRS — Developer Onboarding Guide

## Welcome to SRS!

SRS (Sovereign Runtime Substrate) is the infrastructure layer that makes AI
agents provably safe, auditable, and compliant. This guide gets you from
zero to your first formally-verified agent mutation in 10 minutes.

---

## What You'll Learn

1. What SRS does and why you need it
2. Install + run the SRS API server
3. Authenticate your first agent
4. Submit a mutation through the governance gate
5. Query the audit trail
6. Integrate with your existing AI framework

---

## 1. What SRS Does

SRS sits between your AI agent framework and your infrastructure:

```
Your AI Agent (LangChain, etc.)
        ↓ submits mutations
    SRS Runtime
    ├── Z3 formal verification (is this safe?)
    ├── BLS12-381 governance (who approved this?)
    ├── SEG admission gate (5 mandatory checks)
    ├── Audit trail (tamper-evident record)
    └── Policy engine (tenant isolation, rate limits)
        ↓ certified mutations
    Your Infrastructure (database, APIs, files)
```

**Every mutation your agent makes is:**
- Formally verified against safety invariants (Z3)
- Cryptographically signed (BLS12-381)
- Approved by a heterogeneous quorum (formal + empirical + heuristic)
- Recorded in a tamper-evident audit trail
- Checked against governance policies

---

## 2. Install + Run

```bash
# Clone + install
git clone https://github.com/your-org/srs.git
cd srs
pip install -r requirements.txt -r requirements-dev.txt

# Verify (399+ tests, 97% coverage)
make test

# Start the API server
python3 api/server.py
# → Admin API key: <printed once>
# → Server: http://localhost:8000
# → Swagger UI: http://localhost:8000/docs
```

---

## 3. Your First Agent Mutation (Python)

```python
from api.srs_sdk import SRSCClient

# Connect (use the admin key from server output)
client = SRSCClient("http://localhost:8000", api_key="<admin-key>")

# Create an agent identity
key = client.issue_api_key(
    tenant_id="my-startup",
    identity_id="my-agent",
    role="agent",
)
agent = SRSCClient("http://localhost:8000", api_key=key["api_key"])

# Submit a mutation
result = agent.submit_mutation(
    mutation_id="my-first-mutation",
    description="Update model config",
    risk_class="low",
    z3_witness_hash="sha256:my-proof",
    evidence_chain={
        "admissible": True,
        "seq": 1,
        "sqa_certificate_ref": "quorum:self#bls_evidence_binding",
        "z3_witness_hash": "sha256:my-proof",
    },
    validators=[
        {"validator_id": "v1", "validator_type": "FORMAL",
         "admit": True, "assurance": 0.95},
        {"validator_id": "v2", "validator_type": "EMPIRICAL",
         "admit": True, "assurance": 0.88},
        {"validator_id": "v3", "validator_type": "HEURISTIC",
         "admit": True, "assurance": 0.81},
    ],
    seq=1,
)

print(f"Admissible: {result.admissible}")
print(f"Reason: {result.reason}")
```

---

## 4. TypeScript Agent

```typescript
import { SRSCClient } from './api/srs_sdk';

const client = new SRSCClient('http://localhost:8000', '<api-key>');
const result = await client.submitMutation({
  mutation_id: 'ts-mutation',
  description: 'Update config',
  risk_class: 'low',
  z3_witness_hash: 'sha256:proof',
  evidence_chain: { /* ... */ },
  validators: [ /* ... */ ],
  seq: 1,
});
console.log(result.admissible);
```

---

## 5. Go Agent

```go
client := srs_sdk.NewSRSCClient("http://localhost:8000", "<api-key>")
result, _ := client.SubmitMutation(&srs_sdk.MutationRequest{
    MutationID:    "go-mutation",
    Description:   "Update config",
    RiskClass:     "low",
    Z3WitnessHash: "sha256:proof",
    EvidenceChain: map[string]interface{}{ /* ... */ },
    Validators:    []map[string]interface{}{ /* ... */ },
    Seq:           1,
})
fmt.Println(result.Admissible)
```

---

## 6. MCP Integration (Claude, GPT)

SRS exposes 6 MCP tools that any MCP-compatible agent can call:

```json
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "srs_submit_mutation",
    "arguments": { /* mutation params */ }
  }
}
```

---

## 7. Dashboard

Open `http://localhost:8000/api/dashboard.html` for the real-time monitoring
dashboard, or `http://localhost:8000/api/admin.html` for identity + policy
management.

---

## Next Steps

- Read `QUICKSTART.md` for the 5-minute guide
- Read `DEPLOYMENT_GUIDE.md` for enterprise deployment
- Read `ENGINEERING_REPORT.md` for the honest assessment
- Browse `examples/` for complete agent examples
- Check `docs/SPEC.md` for the full technical specification

---

## Need Help?

- **Docs**: `docs/` directory (12+ markdown files)
- **API docs**: `http://localhost:8000/docs` (Swagger UI)
- **Examples**: `examples/example_agent.py` (Python, TypeScript, Go)
- **Tests**: `tests/` (554+ tests, 97% coverage)
- **Issues**: GitHub Issues
