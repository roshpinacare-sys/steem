# SRS Cloud — AWS/GCP Deployment Templates

## AWS Deployment

### Quick Deploy (CloudFormation)

```bash
# Deploy SRS to AWS ECS Fargate with RDS PostgreSQL
aws cloudformation deploy \
  --template-file deploy/cloud/aws/srs-cloudformation.yaml \
  --stack-name srs-production \
  --parameter-overrides \
    DBPassword=$(openssl rand -base64 32) \
    AdminEmail=admin@your-company.com \
  --capabilities CAPABILITY_IAM
```

**AWS Resources:**
| Resource | Type | Purpose |
|----------|------|---------|
| ECS Cluster | Fargate | SRS API container |
| RDS PostgreSQL | db.t3.medium | Persistent storage + replication |
| Application Load Balancer | ALB | HTTPS termination + health checks |
| CloudWatch | Log group | Centralized logging |
| Secrets Manager | Secret | BLS private keys + DB password |
| IAM Role | Task role | SRS container permissions |

### Architecture

```
                    ┌──────────────────┐
                    │  Route 53 (DNS)  │
                    └────────┬─────────┘
                             │
                    ┌────────┴─────────┐
                    │  ALB (HTTPS:443)  │
                    └────────┬─────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
     ┌────────┴───┐ ┌───────┴────┐ ┌───────┴────┐
     │ ECS Task 1 │ │ ECS Task 2 │ │ ECS Task 3 │
     │ (SRS API)  │ │ (SRS API)  │ │ (SRS API)  │
     └────────┬───┘ └───────┬────┘ └───────┬────┘
              │              │              │
              └──────────────┼──────────────┘
                             │
                    ┌────────┴─────────┐
                    │ RDS PostgreSQL   │
                    │ (Multi-AZ)       │
                    └──────────────────┘
```

---

## GCP Deployment

### Quick Deploy (Cloud Run)

```bash
# Build + deploy to GCP Cloud Run
gcloud builds submit --tag gcr.io/your-project/srs:6.0.0
gcloud run deploy srs-api \
  --image gcr.io/your-project/srs:6.0.0 \
  --region us-central1 \
  --memory 1Gi \
  --cpu 1 \
  --min-instances 1 \
  --max-instances 10 \
  --set-env-vars SRS_ENV=production
```

**GCP Resources:**
| Resource | Type | Purpose |
|----------|------|---------|
| Cloud Run | Managed | SRS API auto-scaling |
| Cloud SQL | PostgreSQL | Persistent storage |
| Secret Manager | Secret | BLS keys + DB password |
| Cloud Monitoring | Metrics | Prometheus-compatible |
| Cloud Logging | Logs | Centralized logging |
| Cloud Load Balancing | HTTPS LB | Global access |

---

## Multi-Region Setup

### Active-Active (Recommended for Enterprise)

```
    ┌─────────────────────────────────────────────────┐
    │              Global Load Balancer                 │
    │         (Route 53 / Cloud Load Balancing)        │
    └──────────┬──────────────────┬────────────────────┘
               │                  │
    ┌──────────┴──────┐ ┌────────┴──────────┐
    │  US-East-1      │ │  EU-West-1        │
    │  ┌───────────┐  │ │  ┌───────────┐    │
    │  │ SRS API   │  │ │  │ SRS API   │    │
    │  │ (3 tasks) │  │ │  │ (3 tasks) │    │
    │  └─────┬─────┘  │ │  └─────┬─────┘    │
    │        │        │ │        │          │
    │  ┌─────┴─────┐  │ │  ┌─────┴─────┐    │
    │  │ RDS PG    │←─┼─┼──│ RDS PG    │    │
    │  │ (primary) │  │ │  │ (replica) │    │
    │  └───────────┘  │ │  └───────────┘    │
    └─────────────────┘ └──────────────────┘
```

### Failover

```python
from api.connection_pool import StreamingReplicationConfig, FailoverHandler

config = StreamingReplicationConfig(
    primary_host="us-east-1.db.srs.cloud",
    replica_hosts=["eu-west-1.db.srs.cloud", "ap-south-1.db.srs.cloud"],
)
failover = FailoverHandler(config, failover_timeout_s=30)

# Automatic failover check (run every 5 seconds)
if failover.check_failover():
    new_primary = failover.execute_failover()
    print(f"Failed over to: {new_primary}")
```

---

## SRS Cloud Beta

### Sign Up

```bash
# Create a cloud tenant
curl -X POST https://cloud.srs.z.ai/v1/cloud/signup \
  -H "Content-Type: application/json" \
  -d '{
    "tenant_id": "your-company",
    "tier": "pro",
    "billing_email": "billing@your-company.com"
  }'
```

### Tiers

| Tier | Price | Agents | Mutations/day | Storage | Support |
|------|-------|--------|---------------|---------|---------|
| Free | $0 | 1 | 100 | 100MB | Community |
| Pro | $499/mo | 50 | 10K | 10GB | Email |
| Enterprise | $4,999/mo | Unlimited | Unlimited | Unlimited | 24/7 + SLA 99.99% |

### Migration from Self-Hosted

```bash
# Export your self-hosted data
python3 -c "
from governance.persistence import PersistentAuditChain
chain = PersistentAuditChain('srs_audit.db')
import json
print(json.dumps(chain.export()))
" > audit_export.json

# Import to SRS Cloud
curl -X POST https://cloud.srs.z.ai/v1/cloud/import \
  -H "Authorization: Bearer $CLOUD_API_KEY" \
  -H "Content-Type: application/json" \
  -d @audit_export.json
```

---

## Security Hardening Checklist (Cloud)

- [ ] TLS 1.3 enforced (ALB/Cloud Load Balancing)
- [ ] WAF rules (AWS WAF / Cloud Armor)
- [ ] DDoS protection (CloudFront / Cloud CDN)
- [ ] Secrets in Secrets Manager / Secret Manager
- [ ] IAM least-privilege roles
- [ ] VPC/private network (no public DB)
- [ ] Encryption at rest (RDS encryption)
- [ ] Encryption in transit (TLS everywhere)
- [ ] Audit log streaming to SIEM
- [ ] Regular security scans (bandit + SAST)
