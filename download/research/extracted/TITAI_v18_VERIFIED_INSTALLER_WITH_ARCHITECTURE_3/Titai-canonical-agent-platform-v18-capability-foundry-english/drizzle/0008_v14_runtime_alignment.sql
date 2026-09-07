-- TITAI v14: align persisted runtime schema with the active outbox contract.
ALTER TABLE durable_outbox ADD COLUMN lease_token INTEGER NOT NULL DEFAULT 0;
