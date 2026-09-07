-- =============================================================================
--  ECOS B2B Core - Persistence Schema (Postgres 15+)
-- -----------------------------------------------------------------------------
--  Authoritative state for the fiat-pegged AaaS + HITL marketplace.
--
--  Design tenets:
--    * BigInt-safe.    All monetary columns are BIGINT microcents (1 USD = 10_000 μ¢).
--                     We never round in the database. Application repos pass
--                     stringified BigInts; pg returns BIGINT as string by default.
--    * Append-only.   `ledger_entries` and `audit_log` are immutable. There is
--                     no UPDATE/DELETE path. All mutation flows through INSERT.
--    * Crypto-chain.  `audit_log` is a SHA-256 hash chain. Each row stores
--                     `prev_hash` and `hash`; verification recomputes the chain.
--                     Appends are serialized with `pg_advisory_xact_lock`.
--    * Idempotent.    POST handlers persist their canonical response under
--                     (route, key_hash) so retries from the AI worker replay
--                     the cached payload instead of double-charging escrow.
--    * Non-negative.  Accounts.balance_micro carries a CHECK constraint that
--                     prevents overdraft at the storage layer, defense-in-depth
--                     against any future repo bug.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- Extensions
-- -----------------------------------------------------------------------------
-- pgcrypto for gen_random_uuid() in case routes want server-side ids.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- accounts
--   id is the same string used by fiatLedger.js (e.g. "sys::platform",
--   "sys::insurance_pool", "sys::escrow", "client_acme", "val_alice").
--   We do NOT auto-generate account ids -- the caller owns the namespace.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS accounts (
    id              TEXT        PRIMARY KEY,
    kind            TEXT        NOT NULL
                                CHECK (kind IN (
                                    'system',     -- sys::platform / sys::insurance_pool / sys::escrow
                                    'client',     -- B2B paying customer
                                    'validator',  -- human HITL resolver
                                    'external'    -- payout target outside the system
                                )),
    balance_micro   BIGINT      NOT NULL DEFAULT 0
                                CHECK (balance_micro >= 0),
    metadata        JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON COLUMN accounts.balance_micro
    IS 'Balance in microcents (BIGINT). 10_000 = $1.00. CHECK prevents overdraft.';

-- -----------------------------------------------------------------------------
-- ledger_entries
--   Append-only double-entry record. Every credit/debit/transfer/split
--   creates one or more rows here grouped by `tx_id`. The repo layer
--   guarantees that, per tx_id, sum(delta_micro) over non-mint kinds = 0.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ledger_entries (
    id              BIGSERIAL   PRIMARY KEY,
    tx_id           UUID        NOT NULL,
    account_id      TEXT        NOT NULL REFERENCES accounts(id),
    delta_micro     BIGINT      NOT NULL,    -- signed; positive = credit, negative = debit
    kind            TEXT        NOT NULL
                                CHECK (kind IN (
                                    'credit',           -- one-leg mint into an account
                                    'debit',            -- one-leg burn out of an account
                                    'transfer_out',     -- two-leg transfer source
                                    'transfer_in',      -- two-leg transfer destination
                                    'split_escrow',     -- 40/40/20: client -> escrow
                                    'split_platform',   -- 40/40/20: escrow -> platform
                                    'split_validator',  -- 40/40/20: escrow -> validator
                                    'split_insurance'   -- 40/40/20: escrow -> insurance
                                )),
    ref_type        TEXT,                                  -- 'mission' | 'approval' | 'payout' | NULL
    ref_id          TEXT,
    meta            JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ledger_tx          ON ledger_entries(tx_id);
CREATE INDEX IF NOT EXISTS idx_ledger_account_ts  ON ledger_entries(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ledger_ref         ON ledger_entries(ref_type, ref_id);

-- -----------------------------------------------------------------------------
-- audit_log
--   SHA-256 chained, append-only. seq is monotonically increasing per
--   pg_advisory_xact_lock serialization in auditRepo.appendAudit().
--   `prev_hash` of the first row is sixty-four zeros (NULL_HASH).
--   `hash` is sha256( seq || ts_iso || canonical(payload) || prev_hash )
--   exactly matching the in-memory AuditLog so a snapshot can round-trip.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
    seq             BIGSERIAL   PRIMARY KEY,
    ts              TIMESTAMPTZ NOT NULL DEFAULT now(),
    type            TEXT        NOT NULL CHECK (length(type) BETWEEN 1 AND 128),
    domain          TEXT        NOT NULL CHECK (length(domain) BETWEEN 1 AND 128) DEFAULT 'default_domain', -- Added for delta_trace_heads
    payload         JSONB       NOT NULL,
    prev_hash       CHAR(64)    NOT NULL,
    hash            CHAR(64)    NOT NULL,
    -- The same logical event must never appear twice under different seqs.
    -- We don't enforce a unique constraint on `hash` directly because the
    -- chain itself plus the advisory lock guarantees uniqueness; a UNIQUE
    -- index would make append a 2-step (lock + dup-check), which the lock
    -- already obviates. We keep this index instead for fast head lookup:
    CONSTRAINT audit_log_hash_hex CHECK (hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT audit_log_prev_hex CHECK (prev_hash ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_hash  ON audit_log(hash);
CREATE INDEX        IF NOT EXISTS idx_audit_type  ON audit_log(type, seq DESC);
CREATE INDEX        IF NOT EXISTS idx_audit_domain_seq ON audit_log(domain, seq DESC);

-- -----------------------------------------------------------------------------
-- delta_trace_heads
--   Stores the latest audit_log hash (state root) for each domain.
--   This table is updated transactionally with audit_log appends to ensure
--   that the latest state root is always quickly accessible without scanning
--   the entire audit_log.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS delta_trace_heads (
    domain          TEXT        PRIMARY KEY,
    last_audit_seq  BIGINT      NOT NULL REFERENCES audit_log(seq),
    last_audit_hash CHAR(64)    NOT NULL REFERENCES audit_log(hash),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE delta_trace_heads
    IS 'Stores the latest audit_log hash (state root) for each domain for fast lookup.';

COMMENT ON COLUMN delta_trace_heads.last_audit_seq
    IS 'The sequence number of the last audit entry for this domain.';

COMMENT ON COLUMN delta_trace_heads.last_audit_hash
    IS 'The hash of the last audit entry for this domain (the state root).';


-- -----------------------------------------------------------------------------
-- missions
--   Top-level B2B work container. Approvals belong to missions.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS missions (
    id                      TEXT        PRIMARY KEY,
    client_account_id       TEXT        NOT NULL REFERENCES accounts(id),
    title                   TEXT        NOT NULL,
    description             TEXT,
    status                  TEXT        NOT NULL DEFAULT 'open'
                                        CHECK (status IN ('open','in_progress','awaiting_review','completed','cancelled')),
    metadata                JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_missions_client ON missions(client_account_id);
CREATE INDEX IF NOT EXISTS idx_missions_status ON missions(status);

-- -----------------------------------------------------------------------------
-- approvals
--   HITL approval state machine. One row per pending/resolved approval.
--   The one-shot guarantee is enforced by repo-level UPDATE ... WHERE status='pending'.
--   If 0 rows are updated -> 409 Conflict.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS approvals (
    id                      TEXT        PRIMARY KEY,
    mission_id              TEXT        NOT NULL REFERENCES missions(id),
    client_account_id       TEXT        NOT NULL REFERENCES accounts(id),
    validator_account_id    TEXT                 REFERENCES accounts(id),
    status                  TEXT        NOT NULL DEFAULT 'pending'
                                        CHECK (status IN ('pending','approved','modified','rejected','expired')),
    decision                TEXT
                                        CHECK (decision IS NULL OR decision IN ('approve','modify','reject')),
    price_usd               TEXT        NOT NULL,           -- decimal string; canonical money input
    price_micro             BIGINT      NOT NULL CHECK (price_micro > 0),
    confidence              NUMERIC(5,4),                   -- 0..1 if provided
    ai_output               JSONB       NOT NULL,
    final_output            JSONB,
    context                 JSONB       NOT NULL DEFAULT '{}'::jsonb,
    note                    TEXT,
    settlement_tx_id        UUID,                           -- the splitPay tx_id, when billable
    audit_create_hash       CHAR(64)    NOT NULL,
    audit_resolve_hash      CHAR(64),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at             TIMESTAMPTZ,
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_approvals_mission        ON approvals(mission_id);
CREATE INDEX IF NOT EXISTS idx_approvals_mission_status ON approvals(mission_id, status);
CREATE INDEX IF NOT EXISTS idx_approvals_validator      ON approvals(validator_account_id);

-- -----------------------------------------------------------------------------
-- idempotency_keys
--   Caches the final (status_code, response_body) of a successful POST so
--   retries with the same Idempotency-Key replay the cached payload instead
--   of re-executing the handler. The request_fingerprint guards against
--   the dangerous case where the same key is reused with a different body.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS idempotency_keys (
    route                   TEXT        NOT NULL,
    key_hash                CHAR(64)    NOT NULL,
    request_fingerprint     CHAR(64)    NOT NULL,
    status_code             INTEGER     NOT NULL CHECK (status_code BETWEEN 100 AND 599),
    response_body           JSONB       NOT NULL,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at              TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (route, key_hash)
);

CREATE INDEX IF NOT EXISTS idx_idem_expires ON idempotency_keys(expires_at);

-- -----------------------------------------------------------------------------
-- Bootstrap the three reserved system accounts. These ids are the same
-- strings as fiatLedger.SYSTEM_ACCOUNTS so the in-memory and DB layers
-- share the same identifier namespace.
-- -----------------------------------------------------------------------------
INSERT INTO accounts (id, kind) VALUES
    ('sys::platform',       'system'),
    ('sys::insurance_pool', 'system'),
    ('sys::escrow',         'system')
ON CONFLICT (id) DO NOTHING;

COMMIT;
