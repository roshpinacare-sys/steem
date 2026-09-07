# SRS — Enterprise Deployment Guide

## Quick Deploy (5 Minutes)

### Option 1: Docker Compose (Recommended)

```bash
git clone https://github.com/your-org/srs.git
cd srs
docker-compose up -d
```

**Services:**
| Service | Port | Purpose |
|---------|------|---------|
| srs-api | 8000 | REST API + Swagger UI |
| prometheus | 9090 | Metrics collection |
| grafana | 3000 | Dashboards (admin/admin) |

**Verify:**
```bash
curl http://localhost:8000/v1/health
# {"status":"ok","version":"5.9.0","tests_passing":554,"coverage":"97.4%"}
```

### Option 2: Kubernetes (Helm)

```bash
helm install srs ./deploy/helm
kubectl get pods -l app=srs-api
```

### Option 3: Bare Metal

```bash
pip install -r requirements.txt -r requirements-dev.txt
python3 api/server.py
```

---

## Enterprise Setup (1 Hour)

### Step 1: Create Your Tenant

```bash
# Get admin API key from server logs
ADMIN_KEY=$(docker logs srs-api 2>&1 | grep "Admin API key" | awk '{print $NF}')

# Create your tenant + agent identity
curl -X POST http://localhost:8000/v1/auth/api-key \
  -H "Authorization: Bearer $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "tenant_id": "your-company",
    "identity_id": "production-agent",
    "role": "agent",
    "display_name": "Production Agent"
  }'
```

### Step 2: Configure Policies

The default policy set includes:
- **Tenant Isolation** — deny cross-tenant access
- **High-Risk Approval** — high-risk mutations require human approval
- **Rate Limiting** — 100 mutations/minute per agent
- **DELETE Quorum** — memory DELETE requires SQA quorum

Customize via the policy API or `governance/policy.py`.

### Step 3: Set Up OIDC (Optional)

For enterprise identity (Okta, Auth0, Keycloak):

```python
from api.oidc import OIDCConfig, OIDCVerifier

config = OIDCConfig(
    issuer="https://your-org.okta.com",
    client_id="srs-client",
    client_secret="your-secret",
)
verifier = OIDCVerifier(config)
```

### Step 4: Configure Secrets (Vault)

```bash
export SRS_VAULT_URL=https://vault.your-company.com:8200
export SRS_VAULT_TOKEN=your-vault-token
```

### Step 5: Set Up Webhooks

```python
from api.webhooks import WebhookManager, WebhookEvent

mgr = WebhookManager()
mgr.subscribe(
    sub_id="pagerduty",
    url="https://events.pagerduty.com/v2/enqueue",
    events=[WebhookEvent.POLICY_VIOLATION, WebhookEvent.BUDGET_EXHAUSTED],
    tenant_id="your-company",
)
```

### Step 6: Enable Compliance Reports

```python
from api.compliance import ComplianceGenerator

gen = ComplianceGenerator(audit_chain, identity_provider, policy_engine)
sox_report = gen.generate_sox()  # SOX compliance
hipaa_report = gen.generate_hipaa()  # HIPAA compliance
fedramp_report = gen.generate_fedramp()  # FedRAMP compliance
```

### Step 7: Deploy Your First Agent

```python
from api.srs_sdk import SRSCClient

client = SRSCClient("http://srs-api:8000", api_key="your-agent-key")
result = client.submit_mutation(
    mutation_id="mut-001",
    description="Deploy new model version",
    risk_class="medium",
    z3_witness_hash="sha256:proof123",
    evidence_chain={...},
    validators=[...],
)
print(f"Admissible: {result.admissible}")
```

---

## Production Checklist

- [ ] Docker Compose or Kubernetes deployed
- [ ] Admin API key secured (not in source code)
- [ ] Tenant + agent identities created
- [ ] Policies reviewed + customized
- [ ] OIDC/OAuth2 configured (if using external IdP)
- [ ] Vault configured for BLS private keys
- [ ] Webhooks registered for alerts
- [ ] Prometheus + Grafana dashboards configured
- [ ] Compliance reports generated (SOX/HIPAA/FedRAMP)
- [ ] Rate limits configured per tenant
- [ ] Cost budgets set per agent
- [ ] Audit trail verified (tamper-evident)
- [ ] Backup strategy (SQLite/PostgreSQL persistence)
- [ ] Agent certification pipeline run
- [ ] Example agent tested end-to-end

---

## SRS Cloud (SaaS)

Don't want to self-host? Use SRS Cloud:

| Tier | Price | Agents | Mutations/day | Features |
|------|-------|--------|---------------|----------|
| Free | $0 | 1 | 100 | Basic policy + audit + REST API |
| Pro | $499/mo | 50 | 10,000 | + gRPC + Prometheus + Compliance + Marketplace |
| Enterprise | $4,999/mo | Unlimited | Unlimited | + OIDC + Replication + Sandboxing + SLA 99.99% |

Contact: sovereign@srs.z.ai
