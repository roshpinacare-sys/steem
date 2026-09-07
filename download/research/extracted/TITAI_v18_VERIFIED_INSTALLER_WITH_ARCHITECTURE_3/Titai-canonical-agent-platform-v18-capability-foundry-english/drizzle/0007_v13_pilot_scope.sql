PRAGMA foreign_keys=OFF;

CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  created_at INTEGER
);

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at INTEGER,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS workspaces_tenant_idx ON workspaces(tenant_id);

CREATE TABLE IF NOT EXISTS workspace_memberships (
  user_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'operator',
  created_at INTEGER,
  CONSTRAINT workspace_memberships_pk UNIQUE(user_id, workspace_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS workspace_memberships_scope_idx ON workspace_memberships(tenant_id, workspace_id);

INSERT OR IGNORE INTO tenants(id, name, created_at)
SELECT 'tenant-' || id, name || ' Personal Tenant', COALESCE(created_at, CAST(strftime('%s','now') AS INTEGER) * 1000)
FROM users;

INSERT OR IGNORE INTO workspaces(id, tenant_id, name, created_at)
SELECT 'workspace-' || id, 'tenant-' || id, 'Primary Workspace', COALESCE(created_at, CAST(strftime('%s','now') AS INTEGER) * 1000)
FROM users;

INSERT OR IGNORE INTO workspace_memberships(user_id, tenant_id, workspace_id, role, created_at)
SELECT id, 'tenant-' || id, 'workspace-' || id,
       CASE WHEN role = 'admin' THEN 'owner' ELSE 'operator' END,
       COALESCE(created_at, CAST(strftime('%s','now') AS INTEGER) * 1000)
FROM users;

ALTER TABLE agents ADD COLUMN tenant_id TEXT;
ALTER TABLE agents ADD COLUMN workspace_id TEXT;
ALTER TABLE agents ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private';
UPDATE agents SET tenant_id='tenant-' || owner_id, workspace_id='workspace-' || owner_id WHERE owner_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS agents_scope_idx ON agents(tenant_id, workspace_id);

ALTER TABLE runs ADD COLUMN tenant_id TEXT;
ALTER TABLE runs ADD COLUMN workspace_id TEXT;
ALTER TABLE runs ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private';
UPDATE runs SET tenant_id='tenant-' || user_id, workspace_id='workspace-' || user_id WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS runs_scope_idx ON runs(tenant_id, workspace_id);

ALTER TABLE run_steps ADD COLUMN tenant_id TEXT;
ALTER TABLE run_steps ADD COLUMN workspace_id TEXT;
UPDATE run_steps
SET tenant_id=(SELECT tenant_id FROM runs WHERE runs.id=run_steps.run_id),
    workspace_id=(SELECT workspace_id FROM runs WHERE runs.id=run_steps.run_id);
CREATE INDEX IF NOT EXISTS run_steps_scope_idx ON run_steps(tenant_id, workspace_id);

ALTER TABLE approvals ADD COLUMN tenant_id TEXT;
ALTER TABLE approvals ADD COLUMN workspace_id TEXT;
ALTER TABLE approvals ADD COLUMN continuation_key TEXT;
ALTER TABLE approvals ADD COLUMN durable_job_id TEXT;
ALTER TABLE approvals ADD COLUMN continuation_checkpoint TEXT;
UPDATE approvals
SET tenant_id=(SELECT tenant_id FROM runs WHERE runs.id=approvals.run_id),
    workspace_id=(SELECT workspace_id FROM runs WHERE runs.id=approvals.run_id),
    durable_job_id='durable:' || run_id;
CREATE INDEX IF NOT EXISTS approvals_scope_idx ON approvals(tenant_id, workspace_id);
CREATE UNIQUE INDEX IF NOT EXISTS approvals_continuation_uq ON approvals(run_id, continuation_key) WHERE continuation_key IS NOT NULL;

ALTER TABLE policies ADD COLUMN tenant_id TEXT;
ALTER TABLE policies ADD COLUMN workspace_id TEXT;
ALTER TABLE policies ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private';
UPDATE policies SET tenant_id='tenant-' || owner_id, workspace_id='workspace-' || owner_id WHERE owner_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS policies_scope_idx ON policies(tenant_id, workspace_id);

ALTER TABLE artifacts ADD COLUMN tenant_id TEXT;
ALTER TABLE artifacts ADD COLUMN workspace_id TEXT;
ALTER TABLE artifacts ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private';
UPDATE artifacts
SET tenant_id=(SELECT tenant_id FROM runs WHERE runs.id=artifacts.run_id),
    workspace_id=(SELECT workspace_id FROM runs WHERE runs.id=artifacts.run_id);
CREATE INDEX IF NOT EXISTS artifacts_scope_idx ON artifacts(tenant_id, workspace_id);

ALTER TABLE templates ADD COLUMN tenant_id TEXT;
ALTER TABLE templates ADD COLUMN workspace_id TEXT;
ALTER TABLE templates ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private';
UPDATE templates SET tenant_id='tenant-' || owner_id, workspace_id='workspace-' || owner_id WHERE owner_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS templates_scope_idx ON templates(tenant_id, workspace_id);

ALTER TABLE memories ADD COLUMN tenant_id TEXT;
ALTER TABLE memories ADD COLUMN workspace_id TEXT;
ALTER TABLE memories ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private';
UPDATE memories SET tenant_id='tenant-' || owner_id, workspace_id='workspace-' || owner_id WHERE owner_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS memories_scope_idx ON memories(tenant_id, workspace_id);

ALTER TABLE model_profiles ADD COLUMN tenant_id TEXT;
ALTER TABLE model_profiles ADD COLUMN workspace_id TEXT;
ALTER TABLE model_profiles ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private';
UPDATE model_profiles SET tenant_id='tenant-' || owner_id, workspace_id='workspace-' || owner_id WHERE owner_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS model_profiles_scope_idx ON model_profiles(tenant_id, workspace_id);

ALTER TABLE durable_jobs ADD COLUMN tenant_id TEXT;
ALTER TABLE durable_jobs ADD COLUMN workspace_id TEXT;
UPDATE durable_jobs
SET tenant_id=(SELECT tenant_id FROM runs WHERE runs.id=json_extract(durable_jobs.payload, '$.runId')),
    workspace_id=(SELECT workspace_id FROM runs WHERE runs.id=json_extract(durable_jobs.payload, '$.runId'));
CREATE INDEX IF NOT EXISTS durable_jobs_scope_idx ON durable_jobs(tenant_id, workspace_id);

ALTER TABLE durable_receipts ADD COLUMN tenant_id TEXT;
ALTER TABLE durable_receipts ADD COLUMN workspace_id TEXT;
UPDATE durable_receipts
SET tenant_id=(SELECT tenant_id FROM durable_jobs WHERE durable_jobs.id=durable_receipts.job_id),
    workspace_id=(SELECT workspace_id FROM durable_jobs WHERE durable_jobs.id=durable_receipts.job_id);
CREATE INDEX IF NOT EXISTS durable_receipts_scope_idx ON durable_receipts(tenant_id, workspace_id);

ALTER TABLE verification_attestations ADD COLUMN tenant_id TEXT;
ALTER TABLE verification_attestations ADD COLUMN workspace_id TEXT;
UPDATE verification_attestations
SET tenant_id=(SELECT tenant_id FROM runs WHERE runs.id=verification_attestations.run_id),
    workspace_id=(SELECT workspace_id FROM runs WHERE runs.id=verification_attestations.run_id);
CREATE INDEX IF NOT EXISTS verification_attestations_scope_idx ON verification_attestations(tenant_id, workspace_id);

PRAGMA foreign_keys=ON;
